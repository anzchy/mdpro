import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const windows = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const SID = "S-1-5-21-1003";

// Only the kernel job/launcher and current Windows identity are doubled. The actual
// parent probe validates replies, waits, prints diagnostics and cleans real files.
// Paired real-boundary acceptance is matrix I2, owned by the Windows tester.
const kernel = String.raw`using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
public sealed class NativeJobScope : IDisposable {
  public string Name;
  Process child;
  static string Root { get { return Environment.GetEnvironmentVariable("D346_PROBE_ROOT"); } }
  static string Mode { get { return Environment.GetEnvironmentVariable("D346_PROBE_MODE"); } }
  static void Trace(string value) { File.AppendAllText(Path.Combine(Root,"trace"),value+"\n"); }
  public NativeJobScope(string name) : this(name,true) { }
  public NativeJobScope(string name,bool allowBreakaway) {
    Name=name; Trace("create:"+name+":"+allowBreakaway);
    if(Mode=="create-failed") throw new Exception("D346_JOB_CREATE_DENIED");
  }
  static string Argument(string args,string key) {
    var match=Regex.Match(args,"-"+key+@"\s+(?:""([^""]+)""|'([^']+)'|([^\s""']+))");
    if(!match.Success) throw new Exception("D346_FIXTURE_ARGUMENT_MISSING "+key+" "+args);
    for(int i=1;i<=3;i++) if(match.Groups[i].Success) return match.Groups[i].Value;
    throw new Exception("D346_FIXTURE_ARGUMENT_INVALID");
  }
  public Process StartOwned(string exe,string arguments) {
    if(!Path.IsPathRooted(exe)) throw new FileNotFoundException("The system cannot find the file specified",exe);
    Trace("launch:"+exe); Trace("arguments:"+arguments);
    var text=arguments.Replace("\\\"","\"");
    var encoded=Regex.Match(text,@"-EncodedCommand\s+([A-Za-z0-9+/=]+)",RegexOptions.IgnoreCase);
    if(encoded.Success) text=Encoding.Unicode.GetString(Convert.FromBase64String(encoded.Groups[1].Value));
    var file=Regex.Match(text,@"-File\s+""([^""]+)""",RegexOptions.IgnoreCase);
    if(file.Success) { Trace("script:"+file.Groups[1].Value); Trace("body:"+File.ReadAllText(file.Groups[1].Value).Length); }
    string reply=Argument(text,"ReplyPath"), nonce=Argument(text,"Nonce"), job=Argument(text,"JobName"), user=Argument(text,"ExpectedUserSid");
    Trace("reply:"+reply);
    if(Mode=="launch-failed") throw new Exception("D346_RUNAS_DENIED");
    if(Mode!="missing" && Mode!="timeout" && Mode!="launcher-only") {
      if(Mode=="malformed") File.WriteAllText(reply,"{");
      else {
        string restricted=Mode=="unrestricted"?"false":Mode=="truthy-restricted"?"\"true\"":"true";
        string opened=Mode=="denied"?"false":Mode=="truthy-opened"?"\"true\"":"true";
        if(Mode=="wrong-job") job="Global\\mdpro-driver-"+new string('b',32);
        if(Mode=="wrong-nonce") nonce="wrong-nonce";
        if(Mode=="wrong-user") user="S-1-5-21-9999";
        string admin=Mode=="admin-enabled"?"true":"false";
        string pid=Mode=="invalid-pid"?"0":"1234";
        string birth=Mode=="missing-birth"?"":"637134336000000000";
        string result="{\"job\":\""+job.Replace("\\","\\\\")+"\",\"nonce\":\""+nonce+"\",\"userSid\":\""+user+"\",\"restricted\":"+restricted+",\"adminEnabled\":"+admin+",\"opened\":"+opened+",\"pid\":"+pid+",\"birth\":\""+birth+"\"}";
        Trace("reply-json:"+result);
        File.WriteAllText(reply,result.Substring(0,result.Length-1)+",\"secret\":\"DO_NOT_PRINT\"}");
      }
    }
    // A launcher can report success before its child emits a reply; it is never
    // itself access proof. All other modes leave a real harmless owned lifetime.
    child=Process.Start("/bin/sleep",Mode=="launcher-only"?"0":"20");
    Trace("pid:"+child.Id);
    return child;
  }
  public object[] Snapshot() { return child==null || child.HasExited?new object[0]:new object[]{new { pid=child.Id }}; }
  public void Stop() {
    Trace("stop:"+Name);
    if(child!=null && !child.HasExited) { child.Kill(); child.WaitForExit(2000); }
    if(Mode=="cleanup-failed") throw new Exception("D346_PROBE_CLEANUP_FAILED");
  }
  public void Dispose() { Trace("dispose:"+Name); if(child!=null) child.Dispose(); }
}`;

export type ProbeMode = "success" | "unrestricted" | "admin-enabled" | "wrong-job" | "wrong-nonce" | "wrong-user"
  | "denied" | "malformed" | "missing" | "launcher-only" | "timeout" | "create-failed" | "launch-failed"
  | "truthy-restricted" | "truthy-opened" | "invalid-pid" | "missing-birth" | "cleanup-failed" | "runas-absent";

const exists = (file: string) => access(file).then(() => true, () => false);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function crossTokenProbe(mode: ProbeMode) {
  const root = await mkdtemp(path.join(os.tmpdir(), "d346-cross-token-"));
  const dir = path.join(root, "probe 中文 space");
  const systemRoot = path.join(root, "Windows System Root");
  await mkdir(path.join(systemRoot, "System32"), { recursive: true });
  if (mode !== "runas-absent") await writeFile(path.join(systemRoot, "System32", "runas.exe"), "");
  await cp(windows, dir, { recursive: true });
  const script = path.join(dir, "native-cross-token-probe.ps1");
  // An absent new entry is observable missing behavior, not a missing-module
  // runner error: the empty parent does no work and cannot emit the required OK.
  const source = await readFile(script, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  const identity = /\[(?:System\.)?Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value/g;
  await writeFile(script, source.replace(identity, quote(SID)));
  await writeFile(path.join(dir, "kernel.cs"), kernel);
  await writeFile(path.join(dir, "native-job.ps1"), `Add-Type -Path ${quote(path.join(dir, "kernel.cs"))}\n`);
  const protectedFiles = ["native-session-blocked.json", "owned-processes.json"];
  for (const name of protectedFiles) await writeFile(path.join(dir, name), `preserve-${name}`);
  await writeFile(path.join(root, "trace"), "");
  const before = Date.now();
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", script, "-PhaseMs", "150", "-PollMs", "10"], {
      env: { ...process.env, SystemRoot: systemRoot, D346_PROBE_ROOT: root, D346_PROBE_MODE: mode },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (bytes) => { stdout += String(bytes); });
    child.stderr.on("data", (bytes) => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const trace = (await readFile(path.join(root, "trace"), "utf8")).split(/\r?\n/).filter(Boolean);
  const children = trace.filter((line) => line.startsWith("pid:")).map((line) => Number(line.slice(4)));
  const survivors = children.filter(alive);
  // Measure before fixture reaping so an unsafe parent cannot earn cleanup PASS.
  for (const pid of survivors) process.kill(pid, "SIGKILL");
  const replies = trace.filter((line) => line.startsWith("reply:")).map((line) => line.slice(6));
  const scripts = replies.map((reply) => reply.replace(/\.json$/, ".ps1"));
  const retainedScripts = await Promise.all(scripts.map(exists));
  const retainedReplies = await Promise.all(replies.map(exists));
  const preserved = await Promise.all(protectedFiles.map((name) => readFile(path.join(dir, name), "utf8")));
  return { ...result, systemRoot, retainedScripts, source, trace, survivors, retainedReplies, preserved, elapsedMs: Date.now() - before };
}
