import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WINDOWS = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
// Orchestration harness: NativeJobScope and Scheduler OS observations are substitutes.
// Real supervisor/deadline/run-lock/artifact decisions execute. Kernel containment
// policy itself is covered separately by windows-driver-native-job-harness.ts.
const jobBoundary = String.raw`Add-Type @"
using System;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
public sealed class NativeJobMember { public int pid; public string birth; public string exe; }
public sealed class NativeJobScope : IDisposable {
 public string Name; List<int> children = new List<int>(); static List<Process> inputs = new List<Process>();
 bool Input { get { return Name.EndsWith(Environment.GetEnvironmentVariable("TEST_RUN_ID")); } }
 string Root { get { return Environment.GetEnvironmentVariable("TEST_ROOT"); } }
 public NativeJobScope(string name) { Name = name; }
 public Process StartOwned(string exe, string args) {
   var request = System.Text.RegularExpressions.Regex.Match(args, "-Request \"([^\"]+)\"");
   if (request.Success && File.ReadAllText(request.Groups[1].Value).Contains("\"op\":\"start\"")) {
     var start = new ProcessStartInfo("pwsh", "-NoProfile -File \"" + Path.Combine(Root,"worker.ps1") + "\"");
     start.UseShellExecute = false; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
     var worker = Process.Start(start); inputs.Add(worker); File.WriteAllText(Path.Combine(Root,"rootpid"),worker.Id.ToString());
   }
   var info = new ProcessStartInfo("pwsh", args.Replace("powershell.exe", "pwsh"));
   info.UseShellExecute = false; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
   var p = Process.Start(info); children.Add(p.Id); return p;
 }
 public NativeJobMember[] Snapshot() {
   var result = new List<NativeJobMember>();
   var ids = new List<int>();
   if (Input && File.Exists(Path.Combine(Root,"members"))) {
     foreach (var line in File.ReadAllLines(Path.Combine(Root,"members"))) { int id; if (Int32.TryParse(line,out id)) ids.Add(id); }
   } else if (!Input) foreach (var id in children) ids.Add(id);
   foreach (int id in ids) {
     try { var p = Process.GetProcessById(id); if (!p.HasExited) result.Add(new NativeJobMember { pid=id, birth=p.StartTime.ToUniversalTime().Ticks.ToString(), exe=p.MainModule.FileName }); }
     catch (ArgumentException) { } catch (InvalidOperationException) { }
   }
   return result.ToArray();
 }
 public void Stop() {
   foreach (var m in Snapshot()) { try { Process.GetProcessById(m.pid).Kill(); } catch (ArgumentException) { } }
   foreach (var p in inputs) { try { if (!p.HasExited) p.Kill(); p.WaitForExit(1000); } catch (InvalidOperationException) { } }
 }
 public void Dispose() { Stop(); }
}
"@`;
const schedulerBoundary = `
function New-ScheduledTaskAction { param($Execute,$Argument) [pscustomobject]@{ Execute=$Execute; Argument=$Argument } }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) [pscustomobject]@{ UserId=$UserId } }
function Register-ScheduledTask { param($TaskName,$Action,$Principal) [IO.File]::WriteAllText("$env:TEST_ROOT/task",$TaskName) }
function Start-ScheduledTask {
 param($TaskName)
 # The fake kernel boundary starts this real child from the test host so it can reap it.
 [void][IO.File]::ReadAllText("$env:TEST_ROOT/rootpid")
}
function Get-ScheduledTask {
 param($TaskName,$ErrorAction)
 # TEST_SCHED_QUERY models the real cmdlet's errors, honouring -ErrorAction: "denied" is an access failure,
 # "not-found" the definite absence (a localized message; only the ObjectNotFound category is stable).
 $ea = if ($ErrorAction) { $ErrorAction } else { $ErrorActionPreference }
 # TEST_SCHED_DENY_OP denies only inside one scheduler op (the script-scope request $r names it).
 if ($env:TEST_SCHED_QUERY -eq "denied" -or ($env:TEST_SCHED_DENY_OP -and $env:TEST_SCHED_DENY_OP -eq $r.op)) { Write-Error -Message "Zugriff verweigert" -Category PermissionDenied -ErrorId "HRESULT 0x80070005,Get-ScheduledTask" -ErrorAction $ea; return }
 if (-not (Test-Path "$env:TEST_ROOT/task")) {
   if ($env:TEST_SCHED_QUERY -eq "not-found") { Write-Error -Message "Keine MSFT_ScheduledTask-Objekte gefunden" -Category ObjectNotFound -ErrorId "CmdletizationQuery_NotFound_TaskName,Get-ScheduledTask" -ErrorAction $ea }
   return $null
 }
 $id = [int][IO.File]::ReadAllText("$env:TEST_ROOT/rootpid")
 $p = Get-Process -Id $id -ErrorAction SilentlyContinue
 if ($env:TEST_SCENARIO -eq "early-ready" -and -not (Test-Path "$env:TEST_ROOT/polled")) {
   [IO.File]::WriteAllText("$env:TEST_ROOT/polled", "ready-before-run")
   return [pscustomobject]@{ State="Ready" }
 }
 [pscustomobject]@{ State = $(if ($p -and -not $p.HasExited) { "Running" } else { "Ready" }) }
}
function Get-ScheduledTaskInfo {
 param($TaskName,$ErrorAction)
 # TEST_TASK_EXIT_FILE models native-job.exe propagating its child's exit code; without it the code reads 0.
 $code = if ($env:TEST_TASK_EXIT_FILE -and (Test-Path -LiteralPath $env:TEST_TASK_EXIT_FILE)) { [int][IO.File]::ReadAllText($env:TEST_TASK_EXIT_FILE) } else { 0 }
 [pscustomobject]@{ LastTaskResult = $code }
}
function Stop-ScheduledTask { param($TaskName,$ErrorAction) }
function Unregister-ScheduledTask {
 param($TaskName,$Confirm,$ErrorAction)
 if ($env:TEST_SCENARIO -eq "cleanup-stall") { [Threading.Thread]::Sleep(10000) }
 [IO.File]::Delete("$env:TEST_ROOT/task")
}
`;
const worker = `
$ErrorActionPreference="Stop"
[IO.File]::AppendAllText("$env:TEST_ROOT/members", "$PID" + [Environment]::NewLine)
$runDir="$env:TEST_ROOT/runs/$env:TEST_RUN_ID"
$out="$runDir/ui-out.json"
$phase=$env:TEST_SCENARIO
$partial=$phase -eq "after-input" -or $phase -eq "held" -or $phase -eq "lost-progress"
$state=@{ runId=$env:TEST_RUN_ID; phase=$phase; phaseStartedMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); phaseComplete=$false;
 step=1; op="clickat"; elapsedMs=0; completedSteps=$(if($partial){1}else{0}); inputOutcome=$(if($partial){"partial"}else{"none"});
 heldInput=$(if($phase -eq "held"){"uncertain"}else{"released"}); cleanup="pending"; log=@("phase:start $phase") }
if($phase -ne "missing-progress") { $state|ConvertTo-Json -Compress|Set-Content "$out.progress.json" }
if($phase -eq "corrupt-progress") { [IO.File]::WriteAllText("$out.progress.json", "{") }
if($phase -eq "lost-progress") {
 $state.phaseComplete=$true
 $state|ConvertTo-Json -Compress|Set-Content "$out.progress.json"
 Start-Process pwsh -ArgumentList @("-NoProfile","-Command", "[Threading.Thread]::Sleep(2500); [IO.File]::Delete('$out.progress.json')")
}
[IO.File]::WriteAllText("$env:TEST_ROOT/started","ready")
if($phase -eq "tree") {
 $child=Start-Process pwsh -ArgumentList @("-NoProfile","-File","$env:TEST_ROOT/descendant.ps1","-Depth","1") -PassThru
 [Threading.Thread]::Sleep(500)
 exit 0
}
if($phase -eq "early-ready") {
 $state.phaseComplete=$true
 $state|ConvertTo-Json -Compress|Set-Content "$out.progress.json"
 [Threading.Thread]::Sleep(2200)
}
if($phase -eq "success" -or $phase -eq "cleanup-stall" -or $phase -eq "early-ready" -or $phase -eq "wrong-result" -or $phase -eq "wrong-progress") {
 $state.phaseComplete=$true; $state.cleanup="complete"; $state.status="completed"
 if($phase -eq "wrong-result") {
   $state.runId="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
   $state|ConvertTo-Json -Compress|Set-Content "$out.result.json"
   $state.runId=$env:TEST_RUN_ID
 } else { $state|ConvertTo-Json -Compress|Set-Content "$out.result.json" }
 if($phase -eq "wrong-progress") { $state.runId="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }
 $state|ConvertTo-Json -Compress|Set-Content "$out.progress.json"
 exit 0
}
[Threading.Thread]::Sleep(10000)
`;
const descendant = `param([int]$Depth)
[IO.File]::AppendAllText("$env:TEST_ROOT/members","$PID"+[Environment]::NewLine)
if($Depth -eq 1) { Start-Process pwsh -ArgumentList @("-NoProfile","-File","$env:TEST_ROOT/descendant.ps1","-Depth","2") }
[Threading.Thread]::Sleep(10000)
`;

export async function supervisorFixture(scenario: string, options: {
  entry?: Record<string, string>; steps?: unknown; rawSteps?: string; env?: Record<string, string>;
} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-supervisor-"));
  await cp(WINDOWS, dir, { recursive: true });
  let scheduler = await readFile(path.join(dir, "native-scheduler.ps1"), "utf8");
  scheduler = scheduler.replace("try {", schedulerBoundary + "\ntry {")
    .replace("([Security.Principal.WindowsIdentity]::GetCurrent().Name)", '"fixture-user"');
  await Promise.all([
    writeFile(path.join(dir, "native-job.ps1"), jobBoundary), writeFile(path.join(dir, "native-scheduler.ps1"), scheduler),
    writeFile(path.join(dir, "worker.ps1"), worker), writeFile(path.join(dir, "descendant.ps1"), descendant),
  ]);
  const runId = "a".repeat(32);
  function start(id = runId, env: Record<string, string> = {}): { child: ChildProcess; result: Promise<{ status: number | null; lines: string[]; stderr: string }> } {
    const entry = { StepsB64: Buffer.from(options.rawSteps ?? JSON.stringify(options.steps ?? [])).toString("base64"), RunId: id,
      DeadlineMs: String(Date.now() + 10000), PhaseMs: "1500", CleanupMs: "4000", PollMs: "10", ...options.entry };
    const child = spawn("pwsh", ["-NoProfile", "-File", path.join(dir, "ui-run.ps1"),
      ...Object.entries(entry).flatMap(([name, value]) => ["-" + name, value])], {
      env: { ...process.env, TEST_ROOT: dir, TEST_RUN_ID: id, TEST_SCENARIO: scenario, ...options.env, ...env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); }); child.stderr.on("data", (v) => { stderr += String(v); });
    const result = new Promise<{ status: number | null; lines: string[]; stderr: string }>((done) => {
      child.on("close", (status) => {
        let lines: string[] = [];
        try { const decoded = JSON.parse(Buffer.from(stdout.trim(), "base64").toString("utf8")); lines = Array.isArray(decoded) ? decoded : [decoded]; }
        catch { lines = [stdout]; }
        done({ status, lines, stderr });
      });
    });
    return { child, result };
  }
  return { dir, runId, start };
}
