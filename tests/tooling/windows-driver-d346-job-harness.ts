import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sourcePath = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows/native-job.cs");
export const RUN = "a".repeat(32);

// Kernel, identity and descriptor serialization are OS boundaries. Real constructor,
// Main, snapshot policy, file writes and child effects run. D346 I1/I2 exercise Windows.
const bodies: Record<string, string> = {
  CreateJobObject: `
    Marshal.SetLastPInvokeError(0); bool explicitDescriptor=attr!=IntPtr.Zero;
    if(explicitDescriptor) explicitDescriptor=Marshal.ReadIntPtr(attr,IntPtr.Size)!=IntPtr.Zero;
    var h=new IntPtr(++Next); Jobs[h]=new List<Process>(); Names[name]=h;
    Security[h]=explicitDescriptor?BoundaryDescriptor.Last:""; return h;`,
  OpenJobObject: `
    ObservedAccess=access; if(FailOpen) { Marshal.SetLastPInvokeError(5); return IntPtr.Zero; }
    var h=Names[name]; string d=Security[h];
    bool admitted=d.Contains(";;;"+TokenSid+")") || (AdminEnabled && d.Contains(";;;BA)"));
    if(!admitted) { Marshal.SetLastPInvokeError(5); return IntPtr.Zero; }
    return h;`,
  SetInformationJobObject: `return true;`,
  QueryInformationJobObject: `
    used=0; if(FailQuery) return false;
    var ids=new List<int>(); foreach(var p in Jobs[h]) if(!p.HasExited) ids.Add(p.Id);
    Marshal.WriteInt32(data,0,ids.Count); Marshal.WriteInt32(data,4,ids.Count);
    for(int i=0;i<ids.Count;i++) Marshal.WriteInt64(data,8+i*8,ids[i]);
    used=(uint)(8+ids.Count*8); return true;`,
  AssignProcessToJobObject: `
    var p=Resolve(process); if(p==null) { Trace("assign:self"); return !FailAssign; }
    if(FailAssign) return false; Jobs[job].Add(p); Assigned.Add(p.Id); Trace("assign:"+p.Id); return true;`,
  IsProcessInJob: `
    member=false; if(FailMembership) return false;
    var p=Resolve(process); member=!RejectMember && (p==null || Assigned.Contains(p.Id)); return true;`,
  TerminateJobObject: `
    foreach(var p in Jobs[job]) if(!p.HasExited) { p.Kill(); p.WaitForExit(2000); }
    return true;`,
  CloseHandle: `return true;`,
  ResumeThread: `
    var p=Resolve(h); Trace("resume:"+p.Id+":"+Assigned.Contains(p.Id));
    if(FailResume) return uint.MaxValue;
    File.WriteAllText(Path.Combine(Root,"gate-"+p.Id),Assigned.Contains(p.Id)?"owned":"unowned");
    return 1;`,
  TerminateProcess: `
    if(FailTerminate) return false; var p=Resolve(h);
    if(!p.HasExited) { p.Kill(); p.WaitForExit(2000); } Trace("terminate:"+p.Id); return true;`,
  WaitForSingleObject: `
    if(ms==0) { LastZeroWaitHandle=h.ToInt64(); Trace("pinned-wait:"+h);
      if(ZeroWaitOutcome>=0 && IdentityHandle==h.ToInt64()) return (uint)ZeroWaitOutcome; }
    if(FailWait && ms!=0) return uint.MaxValue;
    var p=Resolve(h); if(p==null) return uint.MaxValue;
    return p.WaitForExit(ms==uint.MaxValue?3000:checked((int)ms))?0u:258u;`,
  GetExitCodeProcess: `
    code=0; if(FailExitCode) return false; var p=Resolve(h);
    code=p.HasExited?(OverrideCode?ExitCode:unchecked((uint)p.ExitCode)):259u; return true;`,
  CreateProcess: `
    process=new PROCESS(); if(FailLaunch) return false;
    var info=new ProcessStartInfo(app,command.ToString().Substring(app.Length+3));
    info.UseShellExecute=false; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
    var p=Process.Start(info); var h=new IntPtr(++Next); Handles[h]=p; Children.Add(p); LastPid=p.Id;
    process=new PROCESS { process=h,thread=h,pid=(uint)p.Id,tid=(uint)p.Id }; Trace("create:"+p.Id); return true;`,
};

const boundaryClasses = String.raw`
public sealed class BoundaryIdentity : IDisposable {
  public BoundaryIdentity User { get { return this; } }
  public string Value { get { return "S-1-5-21-1003"; } }
  public override string ToString() { return Value; }
  public static BoundaryIdentity GetCurrent() { return new BoundaryIdentity(); }
  public void Dispose() { }
}
public sealed class BoundaryDescriptor {
  public static string Last=""; readonly byte[] bytes;
  public BoundaryDescriptor(string text) { Last=text; bytes=Encoding.UTF8.GetBytes(text+"\0"); }
  public int BinaryLength { get { return bytes.Length; } }
  public void GetBinaryForm(byte[] target,int offset) { Array.Copy(bytes,0,target,offset,bytes.Length); }
}
`;

/** Substitute Windows identity/descriptor boundaries while retaining CreateUserJob's checks. */
export function substituteJobSecurity(source: string) {
  return source.replace(/(?:System\.)?Security\.Principal\.WindowsIdentity/g, "BoundaryIdentity")
    .replace(/\bWindowsIdentity\b/g, "BoundaryIdentity")
    .replace(/(?:System\.)?Security\.AccessControl\.RawSecurityDescriptor/g, "BoundaryDescriptor")
    .replace(/\bRawSecurityDescriptor\b/g, "BoundaryDescriptor") + boundaryClasses;
}
const kernelState = String.raw`
  public static string Root=Environment.GetEnvironmentVariable("JOB_TEST_ROOT");
  public static string TokenSid="S-1-5-21-1003";
  public static bool AdminEnabled=true, FailOpen, FailAssign, FailLaunch, FailResume, FailWait, FailExitCode, FailTerminate;
  public static bool FailMembership, RejectMember, FailQuery, ThrowIdentity, ExitAtIdentity, OverrideCode;
  public static int LastPid;
  public static long ZeroWaitOutcome=-1;
  public static uint ObservedAccess, ExitCode;
  public static long IdentityHandle, LastZeroWaitHandle;
  static long Next=100;
  static Dictionary<IntPtr,List<Process>> Jobs=new Dictionary<IntPtr,List<Process>>();
  static Dictionary<string,IntPtr> Names=new Dictionary<string,IntPtr>();
  static Dictionary<IntPtr,string> Security=new Dictionary<IntPtr,string>();
  static Dictionary<IntPtr,Process> Handles=new Dictionary<IntPtr,Process>();
  static HashSet<int> Assigned=new HashSet<int>();
  static List<Process> Children=new List<Process>();
  static Process Resolve(IntPtr h) {
    if(Handles.ContainsKey(h)) return Handles[h];
    foreach(var p in Children) { try { if(p.Handle==h) return p; } catch { } }
    return null;
  }
  static Process ObserveProcess(int pid) {
    var p=Process.GetProcessById(pid); Handles[p.Handle]=p; return p;
  }
  static DateTime ObserveStartTime(Process p) {
    if(ThrowIdentity) { ThrowIdentity=false; IdentityHandle=p.Handle.ToInt64();
      if(ExitAtIdentity && !p.HasExited) { p.Kill(); p.WaitForExit(2000); }
      throw new InvalidOperationException("identity became unreadable"); }
    return p.StartTime;
  }
  static void Trace(string text) { File.AppendAllText(Path.Combine(Root,"trace"),text+"\n"); }
  public static string Descriptor { get { return BoundaryDescriptor.Last; } }
  public static void ReapFixtures() { foreach(var p in Children) { if(!p.HasExited) p.Kill(); p.WaitForExit(2000); } }
`;

export async function d346KernelSource() {
  let source = await readFile(sourcePath, "utf8");
  const replaced: string[] = [];
  source = source.replace(/\[DllImport\([^\n]*\)\]\s*static extern ([^;]+);/g, (_whole, declaration: string) => {
    const name = /\b(\w+)\(/.exec(declaration)?.[1];
    if (!name || !bodies[name]) throw new Error("unknown kernel entry point: " + declaration);
    replaced.push(name);
    return "static " + declaration + " { " + bodies[name] + " }";
  });
  if (replaced.length !== Object.keys(bodies).length) throw new Error("kernel API inventory changed");
  source = source.replaceAll("p.StartTime", "ObserveStartTime(p)")
    .replaceAll("Process.GetProcessById(", "ObserveProcess(");
  const end = source.lastIndexOf("}");
  return substituteJobSecurity("using System.IO;\n" + source.slice(0, end) + kernelState + source.slice(end));
}

export async function runD346Job(body: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "d346-kernel-"));
  const runDir = path.join(dir, "runs", RUN);
  await mkdir(runDir, { recursive: true });
  const worker = `const fs=require('fs'),path=require('path');
const root=process.env.JOB_TEST_ROOT;
const poll=setInterval(()=>{const gate=path.join(root,'gate-'+process.pid);
if(fs.existsSync(gate)){fs.writeFileSync(path.join(root,'effect-'+process.pid),fs.readFileSync(gate));clearInterval(poll);process.exit(3)}},10);`;
  const script = `$ErrorActionPreference='Stop'
Add-Type -Path "$PSScriptRoot/kernel.cs"
$scope=$null
try {
  $scope=New-Object NativeJobScope ('Global\\mdpro-driver-' + ('a' * 32))
  $node=$env:JOB_TEST_NODE
  $arguments='"' + "$PSScriptRoot/worker.cjs" + '"'
  $runDir=Join-Path (Join-Path $PSScriptRoot 'runs') ('a' * 32)
  ${body}
} finally { if($scope){$scope.Dispose()}; [NativeJobScope]::ReapFixtures() }
`;
  await Promise.all([
    writeFile(path.join(dir, "kernel.cs"), await d346KernelSource()), writeFile(path.join(dir, "worker.cjs"), worker),
    writeFile(path.join(dir, "run.ps1"), script), writeFile(path.join(dir, "trace"), ""),
  ]);
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", path.join(dir, "run.ps1")], {
      env: { ...process.env, JOB_TEST_ROOT: dir, JOB_TEST_NODE: process.execPath },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); });
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("error", reject);
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const trace = (await readFile(path.join(dir, "trace"), "utf8")).trim().split("\n").filter(Boolean);
  const log = await readFile(path.join(runDir, "bootstrap.log"), "utf8").catch(() => "");
  let value: Record<string, unknown> = {};
  try { value = JSON.parse(result.stdout); } catch { /* compile/fixture output is surfaced by status assertions */ }
  return { ...result, dir, trace, log, value };
}
