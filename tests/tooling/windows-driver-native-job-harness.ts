import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SOURCE = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows/native-job.cs");

// Compile the real NativeJobScope. Only kernel entry points are substituted:
// assignment, resume ordering, membership validation, inspection and Stop stay production code.
const bodies: Record<string, string> = {
  CreateJobObject: `Marshal.SetLastPInvokeError(0); var h=new IntPtr(++Next); Jobs[h]=new List<Process>(); Names[name]=h; return h;`,
  OpenJobObject: `return Names[name];`,
  SetInformationJobObject: `ObservedFlags=value.Basic.Flags; Limits[h]=value.Basic.Flags; return true;`,
  QueryInformationJobObject: `
    if (FailQuery) { used=0; return false; }
    var ids=new List<int>();
    if (ReportedPid>0) ids.Add(ReportedPid);
    else foreach(var p in Jobs[h]) if(!p.HasExited) ids.Add(p.Id);
    Marshal.WriteInt32(data,0,ids.Count); Marshal.WriteInt32(data,4,ids.Count);
    for(int i=0;i<ids.Count;i++) Marshal.WriteInt64(data,8+i*8,ids[i]);
    used=(uint)(8+ids.Count*8); return true;`,
  AssignProcessToJobObject: `
    if(!Handles.ContainsKey(process)) { Trace("assign:self"); return !FailAssign; } // the bootstrap assigns itself
    var p=Handles[process]; Trace("assign:"+p.Id);
    if(FailAssign) return false;
    Jobs[job].Add(p); Assigned.Add(p.Id); AssignedJob[p.Id]=job; return true;`,
  IsProcessInJob: `member=!RejectMember && (!Handles.ContainsKey(process) || Assigned.Contains(Handles[process].Id)); return true;`,
  // JOB_TEST_STOP_DELAY_MS models Windows' asynchronous job termination; unset keeps it synchronous.
  TerminateJobObject: `if(FailJobStop) return false;
    var members=new List<Process>(Jobs[job]); int delay=Int32.Parse(Environment.GetEnvironmentVariable("JOB_TEST_STOP_DELAY_MS") ?? "0");
    System.Threading.ThreadStart stop=()=>{ if(delay>0) System.Threading.Thread.Sleep(delay); foreach(var p in members) if(!p.HasExited) { p.Kill(); p.WaitForExit(2000); } };
    if(delay>0) { new System.Threading.Thread(stop){ IsBackground=true }.Start(); Trace("job-stop-async:"+delay); } else { stop(); Trace("job-stop"); }
    return true;`,
  CloseHandle: `return true;`,
  ResumeThread: `
    var p=Handles[h]; Trace("resume:"+p.Id+":"+Assigned.Contains(p.Id));
    if(FailResume) return uint.MaxValue;
    if(Environment.GetEnvironmentVariable("JOB_TEST_BREAKAWAY")=="1" && AssignedJob.ContainsKey(p.Id)) {
      bool allowed=(Limits[AssignedJob[p.Id]]&0x800)!=0;
      Trace(allowed?"breakaway-allowed":"breakaway-denied");
      if(allowed) { var escaped=Process.Start("node", @"-e ""setInterval(()=>{},1000)"""); Children.Add(escaped); File.WriteAllText(Path.Combine(Root,"escaped"),escaped.Id.ToString()); }
    }
    File.WriteAllText(Path.Combine(Root,"gate-"+p.Id),Assigned.Contains(p.Id)?"owned":"unowned"); return 1;`,
  TerminateProcess: `if(FailTerminate) return false; var p=Handles[h]; if(!p.HasExited) { p.Kill(); p.WaitForExit(2000); } Trace("terminate:"+p.Id); return true;`,
  WaitForSingleObject: `Trace("wait:"+ms); if(FailWait) return uint.MaxValue; if(WaitTimeoutCount-->0) return 258u; return Handles[h].WaitForExit(ms==uint.MaxValue?3000:checked((int)ms))?0u:258u;`,
  GetExitCodeProcess: `code=Handles[h].HasExited?(uint)Handles[h].ExitCode:259u; return true;`, // 259 = STILL_ACTIVE
  CreateProcess: `
    var info=new ProcessStartInfo(app, command.ToString().Substring(app.Length+3));
    info.UseShellExecute=false; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
    var p=Process.Start(info); var handle=new IntPtr(++Next);
    Handles[handle]=p; Children.Add(p); LastPid=p.Id; LastCreationFlags=flags;
    process=new PROCESS { process=handle, thread=handle, pid=(uint)p.Id, tid=(uint)p.Id };
    Trace("create:"+p.Id+":"+flags); return true;`,
};

const kernelState = `
  public static string Root=Environment.GetEnvironmentVariable("JOB_TEST_ROOT");
  public static bool FailAssign, FailQuery, RejectMember, FailTerminate, FailResume, FailJobStop, FailWait;
  public static int ReportedPid, LastPid, WaitTimeoutCount;
  public static uint ObservedFlags, LastCreationFlags;
  static long Next=100;
  static Dictionary<IntPtr,List<Process>> Jobs=new Dictionary<IntPtr,List<Process>>();
  static Dictionary<string,IntPtr> Names=new Dictionary<string,IntPtr>();
  static Dictionary<IntPtr,Process> Handles=new Dictionary<IntPtr,Process>();
  static HashSet<int> Assigned=new HashSet<int>();
  static Dictionary<IntPtr,uint> Limits=new Dictionary<IntPtr,uint>();
  static Dictionary<int,IntPtr> AssignedJob=new Dictionary<int,IntPtr>();
  static List<Process> Children=new List<Process>();
  static void Trace(string value) { File.AppendAllText(Path.Combine(Root,"trace"),value+"\\n"); }
  public static void ReapFixtures() { foreach(var p in Children) { if(!p.HasExited) p.Kill(); p.WaitForExit(2000); } }
`;

export async function kernelSource() {
  let source = await readFile(SOURCE, "utf8");
  const replaced: string[] = [];
  source = source.replace(/\[DllImport\([^\n]*\)\]\s*static extern ([^;]+);/g, (_whole, declaration: string) => {
    const name = /\b(\w+)\(/.exec(declaration)?.[1];
    if (!name || !bodies[name]) throw new Error("unknown kernel entry point: " + declaration);
    replaced.push(name);
    return "static " + declaration + " { " + bodies[name] + " }";
  });
  if (replaced.length !== Object.keys(bodies).length) throw new Error("kernel fixture did not replace every API");
  const end = source.lastIndexOf("}");
  source = "using System.IO;\n" + source.slice(0, end) + kernelState + source.slice(end);
  return source;
}

export async function runJob(body: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-kernel-job-"));
  const source = await kernelSource();
  const worker = `const fs=require('fs'),path=require('path');
const root=process.env.JOB_TEST_ROOT;
const poll=setInterval(()=>{const gate=path.join(root,'gate-'+process.pid);
if(fs.existsSync(gate)){fs.writeFileSync(path.join(root,'effect-'+process.pid),fs.readFileSync(gate));clearInterval(poll);setInterval(()=>{},1000);}},10);`;
  const script = `$ErrorActionPreference="Stop"
Add-Type -Path "$PSScriptRoot/kernel.cs"
$scope=$null
try {
  $scope=New-Object NativeJobScope ("Global\\mdpro-driver-" + ("a" * 32))
  $node=$env:JOB_TEST_NODE
  $arguments='"' + "$PSScriptRoot/worker.cjs" + '"'
  ${body}
} finally {
  if($scope){$scope.Dispose()}
  [NativeJobScope]::ReapFixtures()
}
`;
  await Promise.all([
    writeFile(path.join(dir, "kernel.cs"), source), writeFile(path.join(dir, "worker.cjs"), worker),
    writeFile(path.join(dir, "run.ps1"), script), writeFile(path.join(dir, "trace"), ""),
  ]);
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", path.join(dir, "run.ps1")], {
      env: { ...process.env, JOB_TEST_ROOT: dir, JOB_TEST_NODE: process.execPath },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); });
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const trace = (await readFile(path.join(dir, "trace"), "utf8")).trim().split("\n").filter(Boolean);
  let value: Record<string, unknown> = {};
  try { value = JSON.parse(result.stdout); } catch { /* Compilation/fixture failure remains visible to the test. */ }
  return { ...result, dir, trace, value };
}
