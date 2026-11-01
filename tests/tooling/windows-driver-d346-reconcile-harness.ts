import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const WINDOWS = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
export const RUN = "b2985c578fd74fe68cbeea4b6ba36a46";
export const OTHER = "d".repeat(32);
export const BIRTH = "637134336000000000";
export const legacy = (pid = 16044) => ({ pid, birth: "", exe: `unreadable: InvalidOperationException: 进程(${pid})已退出，因此无法处理请求。` });
export const complete = (pid = 16045) => ({ pid, birth: BIRTH, exe: "C:\\owned.exe" });
export const unresolved = (job: "input" | "control", pid = 16044) => ({ ...legacy(pid), job, alive: true });
export const exited = (job: "input" | "control", pid = 16044) => ({ pid, job, exited: true, proof: "pinned-handle-signaled" });
export const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
export async function exists(file: string) { return access(file).then(() => true, () => false); }
export function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

// The production reconcile/supervisor/scheduler scripts execute unchanged except OS boundaries.
// Real files, lock acquisition and Move-Item run; the observer records evidence ordering.
// Paired real-boundary acceptance: D346 matrix I1 (tester-owned Windows smoke/reconcile).
const jobSource = String.raw`using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
public sealed class NativeJobScope : IDisposable {
  public string Name;
  public NativeJobScope(string name) { Name=name; }
  static string Root { get { return Environment.GetEnvironmentVariable("D346_ROOT"); } }
  static void Trace(string text) { File.AppendAllText(Path.Combine(Root,"trace"),text+"\n"); }
  private static IntPtr OpenJobObject(uint access,bool inherit,string name) {
    Trace("open:"+name);
    if(name!="Global\\mdpro-driver-"+Environment.GetEnvironmentVariable("D346_RUN")) throw new Exception("WRONG_JOB_NAME");
    string state=Environment.GetEnvironmentVariable("D346_JOB");
    int error=state=="denied"?5:state=="unknown"?87:2;
    Marshal.SetLastPInvokeError(error);
    return state=="present"?new IntPtr(41):IntPtr.Zero;
  }
  private static bool CloseHandle(IntPtr handle) { Trace("close:"+handle.ToInt64()); return true; }
  public Process StartOwned(string exe,string args) {
    var info=new ProcessStartInfo("pwsh",args); info.UseShellExecute=false;
    info.RedirectStandardOutput=true; info.RedirectStandardError=true;
    return Process.Start(info);
  }
  public object[] Snapshot() { return new object[0]; }
  public void Stop() { }
  public void Dispose() { }
}`;
const schedulerBoundary = String.raw`
function Get-ScheduledTask {
  param($TaskName,$ErrorAction)
  if($TaskName -cne "mdpro-audit-ui-$env:D346_RUN") { throw "WRONG_TASK_NAME" }
  if($env:D346_TASK -eq "present") { return [pscustomobject]@{State="Ready"} }
  $category=if($env:D346_TASK -eq "denied"){ "PermissionDenied" }elseif($env:D346_TASK -eq "failure"){ "InvalidOperation" }else{ "ObjectNotFound" }
  Write-Error -Message "任务观察 / task lookup" -Category $category -ErrorId "D346TaskObservation" -ErrorAction $ErrorAction
}
`;
const processBoundary = String.raw`
function Get-Process {
  param($Id,$ErrorAction)
  [IO.File]::AppendAllText((Join-Path $env:D346_ROOT "trace"),"process:$Id"+[Environment]::NewLine)
  $modes=$env:D346_PROCESSES|ConvertFrom-Json
  $property=$modes.PSObject.Properties[[string]$Id]
  $mode=if($property){[string]$property.Value}else{[string]$env:D346_PROCESS}
  if($mode -eq "null") { return $null }
  if($mode -in @("absent","denied","failure")) {
    $category=if($mode -eq "absent"){"ObjectNotFound"}elseif($mode -eq "denied"){"PermissionDenied"}else{"InvalidOperation"}
    $exception=[Microsoft.PowerShell.Commands.ProcessCommandException]::new($env:D346_MESSAGE)
    $errorRecord=[Management.Automation.ErrorRecord]::new($exception,"NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.GetProcessCommand",[Management.Automation.ErrorCategory]::$category,$Id)
    Write-Error -ErrorRecord $errorRecord -ErrorAction $ErrorAction
    return
  }
  $p=[pscustomobject]@{ Id=$Id; Path=$(if($mode -eq "reused"){ "C:\replacement.exe" }else{ "C:\owned.exe" }); StartTime=[datetime]"2020-01-01T00:00:00Z" }
  if($mode -eq "unreadable") { $p|Add-Member -MemberType ScriptProperty -Name StartTime -Value { throw "身份读取失败 / unreadable" } -Force }
  return $p
}
function Move-Item {
  [CmdletBinding()]param([string]$LiteralPath,[string]$Destination,[switch]$Force)
  if($LiteralPath -eq (Join-Path $env:D346_ROOT "native-session-blocked.json")) {
    $proof=Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path $env:D346_ROOT "runs") $env:D346_RUN) "reconcile-checks.json")
    [IO.File]::AppendAllText((Join-Path $env:D346_ROOT "trace"),"latch-move-proof=$proof"+[Environment]::NewLine)
  }
  Microsoft.PowerShell.Management\Move-Item @PSBoundParameters
}
`;
let assembly: Promise<string> | undefined;
async function jobAssembly() {
  assembly ??= (async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "d346-reconcile-job-"));
    const source = path.join(dir, "job.cs"), output = path.join(dir, "job.dll");
    await writeFile(source, jobSource);
    await runFile("pwsh", ["-NoProfile", "-Command", `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(source)})) -OutputAssembly ${quote(output)} -OutputType Library`]);
    return output;
  })();
  return assembly;
}
export interface Options {
  manifest?: unknown; raw?: string; held?: string; task?: string; job?: string;
  process?: string; processes?: Record<string, string>; message?: string;
}
export interface Result { status: number | null; stdout: string; stderr: string; value: Record<string, unknown>; }
export async function reconcileFixture(options: Options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "d346-reconcile-"));
  await cp(WINDOWS, dir, { recursive: true });
  const script = path.join(dir, "native-reconcile.ps1");
  const original = await readFile(script, "utf8");
  await writeFile(script, original.replace('$ErrorActionPreference = "Stop"', '$ErrorActionPreference = "Stop"\n' + processBoundary));
  const scheduler = path.join(dir, "native-scheduler.ps1");
  const schedulerSource = await readFile(scheduler, "utf8");
  await writeFile(scheduler, schedulerSource.replace("try {", schedulerBoundary + "\ntry {"));
  await writeFile(path.join(dir, "native-job.ps1"), `Add-Type -LiteralPath ${quote(await jobAssembly())}\n`);
  const runDir = path.join(dir, "runs", RUN);
  await mkdir(runDir, { recursive: true });
  const latch = path.join(dir, "native-session-blocked.json");
  const manifest = path.join(runDir, "owned-processes.json");
  const latchBytes = JSON.stringify({ runId: RUN, heldInput: options.held ?? "uncertain", phase: "D346-original" });
  const manifestBytes = options.raw ?? JSON.stringify(options.manifest === undefined ? legacy() : options.manifest);
  await writeFile(latch, latchBytes);
  await writeFile(manifest, manifestBytes);
  await writeFile(path.join(dir, "unrelated"), "unrelated-task-and-job-must-remain");
  const environment = { ...process.env, D346_ROOT: dir, D346_RUN: RUN, D346_TASK: options.task ?? "absent", D346_JOB: options.job ?? "absent",
    D346_PROCESS: options.process ?? "absent", D346_PROCESSES: JSON.stringify(options.processes ?? {}), D346_MESSAGE: options.message ?? "进程已退出 / process absent" };
  async function run(args = ["-RunId", RUN, "-InputReleasedConfirmed"]): Promise<Result> {
    return new Promise((resolve, reject) => {
      const child = spawn("pwsh", ["-NoProfile", "-File", script, "-PhaseMs", "5000", "-PollMs", "10", ...args], { env: environment });
      let stdout = "", stderr = "";
      child.stdout.on("data", (data) => { stdout += String(data); });
      child.stderr.on("data", (data) => { stderr += String(data); });
      child.on("error", reject);
      child.on("close", (status) => {
        let value: Record<string, unknown>;
        try { value = JSON.parse(stdout.trim().split("\n").at(-1) ?? ""); }
        catch { reject(new Error(`No reconcile JSON: ${stdout}\n${stderr}`)); return; }
        resolve({ status, stdout, stderr, value });
      });
    });
  }
  async function trace() { return readFile(path.join(dir, "trace"), "utf8").catch(() => ""); }
  async function holdLock() {
    const ready = path.join(dir, "lock-ready");
    const child = spawn("pwsh", ["-NoProfile", "-Command", `$f=[IO.File]::Open(${quote(path.join(dir, "native-session.lock"))},[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); [IO.File]::WriteAllText(${quote(ready)},'held'); try { [Threading.Thread]::Sleep(30000) } finally { $f.Dispose() }`]);
    const end = Date.now() + 10000;
    while (!await exists(ready)) {
      if (Date.now() > end || child.exitCode !== null) { child.kill(); throw new Error("lock owner did not start"); }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return child;
  }
  return { dir, runDir, latch, manifest, latchBytes, manifestBytes, run, trace, holdLock };
}
export type Fixture = Awaited<ReturnType<typeof reconcileFixture>>;
export function canary(): ChildProcess { return spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]); }
