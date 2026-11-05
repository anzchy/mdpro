import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { reconcileProcessBoundary } from "./windows-driver-native-linux-start";

const execFileAsync = promisify(execFile);
const WINDOWS = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
// Orchestration harness: NativeJobScope and Scheduler OS observations are substitutes.
// Real supervisor/deadline/run-lock/artifact decisions execute. Kernel containment
// policy itself is covered separately by windows-driver-native-job-harness.ts.
// The NativeJobScope substitute is compiled once and loaded precompiled, as production loads
// native-job.exe (native-job.ps1: "Never compile during input"); see jobAssembly().
const jobSource = String.raw`using System;
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
   var p = Process.Start(info); children.Add(p.Id); File.AppendAllText(Path.Combine(Root,"scheduler-pids"),p.Id.ToString() + Environment.NewLine);
   if (request.Success && File.ReadAllText(request.Groups[1].Value).Contains("\"op\":\"poll\"") &&
       Environment.GetEnvironmentVariable("TEST_RECORD_FIRST_POLL_START") == "1" && !File.Exists(Path.Combine(Root,"first-poll-start")))
     File.WriteAllText(Path.Combine(Root,"first-poll-start"),DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString());
   return p;
 }
 public NativeJobMember[] Snapshot() {
   var result = new List<NativeJobMember>();
   var ids = new List<int>();
   if (Input && File.Exists(Path.Combine(Root,"members"))) {
     foreach (var line in File.ReadAllLines(Path.Combine(Root,"members"))) { int id; if (Int32.TryParse(line,out id)) ids.Add(id); }
   } else if (!Input) foreach (var id in children) ids.Add(id);
   foreach (int id in ids) {
     if (Reaped(id)) continue;
     try { var p = Process.GetProcessById(id); if (!p.HasExited) result.Add(new NativeJobMember { pid=id, birth=p.StartTime.ToUniversalTime().Ticks.ToString(), exe=p.MainModule.FileName }); }
     catch (ArgumentException) { } catch (InvalidOperationException) { }
     // As native-job.cs: a member whose identity cannot be read stays listed, with no birth.
     catch (Exception e) { result.Add(new NativeJobMember { pid=id, birth="", exe="unreadable: " + e.GetType().Name + ": " + e.Message }); }
   }
   return result.ToArray();
 }
 // A Linux zombie has exited but is not yet reaped: kill(pid, 0) still succeeds, so .NET's HasExited is
 // false for a process it did not start, and its MainModule is null. A Windows job no longer counts it.
 static bool Reaped(int id) {
   try { var stat = File.ReadAllText("/proc/" + id + "/stat"); return stat.Substring(stat.LastIndexOf(')') + 2, 1) == "Z"; }
   catch (IOException) { return false; } catch (UnauthorizedAccessException) { return false; }
 }
 public void Stop() {
   foreach (var m in Snapshot()) { try { Process.GetProcessById(m.pid).Kill(); } catch (ArgumentException) { } catch (InvalidOperationException) { } }
   foreach (var p in inputs) { try { if (!p.HasExited) p.Kill(); p.WaitForExit(1000); } catch (InvalidOperationException) { } }
 }
 public void Dispose() { Stop(); }
}
`;
let jobAssemblyBuild: Promise<string> | undefined;
/**
 * The substitute's assembly, compiled once per source text and cached in the temp dir. Compiling it inside
 * each run (Add-Type of source) cost every ui-run and reconcile pwsh about 0.4 s idle and over 2 s on a
 * loaded runner, before and inside the run's own phase budgets; production never compiles there.
 */
function jobAssembly() {
  jobAssemblyBuild ??= (async () => {
    const final = path.join(os.tmpdir(), `mdpro-native-job-fake-${createHash("sha256").update(jobSource).digest("hex").slice(0, 16)}.dll`);
    if (await access(final).then(() => true, () => false)) return final;
    const work = await mkdtemp(path.join(os.tmpdir(), "mdpro-native-job-fake-"));
    const env = { ...process.env, FAKE_SRC: path.join(work, "fake.cs"), FAKE_OUT: path.join(work, "fake.dll") };
    await writeFile(env.FAKE_SRC, jobSource);
    await execFileAsync("pwsh", ["-NoProfile", "-Command",
      "Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:FAKE_SRC)) -OutputAssembly $env:FAKE_OUT -OutputType Library"], { env });
    await rename(env.FAKE_OUT, final); // atomic: a concurrent worker sees no file or the whole assembly
    return final;
  })();
  return jobAssemblyBuild;
}
const schedulerBoundary = `
function New-ScheduledTaskAction { param($Execute,$Argument) [pscustomobject]@{ Execute=$Execute; Argument=$Argument } }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) [pscustomobject]@{ UserId=$UserId } }
function Register-ScheduledTask { param($TaskName,$Action,$Principal) [IO.File]::WriteAllText("$env:TEST_ROOT/task",$TaskName) }
function Start-ScheduledTask {
 param($TaskName)
 if ($env:TEST_SCHED_STALL_OP -eq "start") { [Threading.Thread]::Sleep([int]$env:TEST_SCHED_STALL_MS) }
 # The fake kernel boundary starts this real child from the test host so it can reap it.
 [void][IO.File]::ReadAllText("$env:TEST_ROOT/rootpid")
}
function Get-ScheduledTask {
 param($TaskName,$ErrorAction)
 if ($env:TEST_SCHED_STALL_OP -eq "poll") { [Threading.Thread]::Sleep([int]$env:TEST_SCHED_STALL_MS) }
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
 if ($env:TEST_SCHED_STALL_OP -eq "cleanup") { [Threading.Thread]::Sleep([int]$env:TEST_SCHED_STALL_MS) }
 if ($env:TEST_SCENARIO -eq "cleanup-stall" -or $env:TEST_SCENARIO -eq "deadline-stall") { [Threading.Thread]::Sleep(10000) }
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
if ($env:TEST_WORKER_PHASE_START_FUTURE_MS) {
 $state.phaseStartedMs += [int]$env:TEST_WORKER_PHASE_START_FUTURE_MS
}
if ($env:TEST_WORKER_EXPIRY_BEFORE_WORK_LIMIT_MS) {
 $state.phaseStartedMs = [long]$env:MDPRO_NATIVE_CLEANUP_DEADLINE_MS - [int]$env:TEST_CLEANUP_MS -
   [int]$env:TEST_WORKER_PHASE_MS - [int]$env:TEST_WORKER_EXPIRY_BEFORE_WORK_LIMIT_MS
}
$script:progressWrites=0
function Write-FakeProgress {
 $script:progressWrites++
 $temp="$out.progress.$PID.tmp"
 [IO.File]::WriteAllText($temp, ($state|ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
 if($env:TEST_ATOMIC_PAUSE_WRITE -and $script:progressWrites -eq [int]$env:TEST_ATOMIC_PAUSE_WRITE) {
  [IO.File]::WriteAllText("$env:TEST_ROOT/atomic-temp-ready", "ready")
  while(-not (Test-Path "$env:TEST_ROOT/atomic-release")) { [Threading.Thread]::Sleep(10) }
 }
 Move-Item -LiteralPath $temp -Destination "$out.progress.json" -Force
 if($env:TEST_ATOMIC_PAUSE_WRITE -and $script:progressWrites -eq [int]$env:TEST_ATOMIC_PAUSE_WRITE) {
  [IO.File]::WriteAllText("$env:TEST_ROOT/atomic-published", "ready")
 }
}
if($env:TEST_PROGRESS_ANCHOR_FIRST_POLL_START) {
 $until=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 8000
 while(-not (Test-Path "$env:TEST_ROOT/first-poll-start")) {
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $until) { throw "first poll start not observed" }
  [Threading.Thread]::Sleep(10)
 }
 $state.phaseStartedMs=[long][IO.File]::ReadAllText("$env:TEST_ROOT/first-poll-start") - [int]$env:TEST_PROGRESS_ANCHOR_FIRST_POLL_START
}
if($env:TEST_PROGRESS_AFTER_FIRST_POLL) {
 $until=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 8000
 while($true) {
  if(Test-Path "$env:TEST_ROOT/scheduler-times") {
   $times=[IO.File]::ReadAllText("$env:TEST_ROOT/scheduler-times")
   if($times -match 'scheduler-poll [0-9]+') { break }
  }
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $until) { throw "first poll not observed" }
  [Threading.Thread]::Sleep(10)
 }
 $state.phaseStartedMs=[long]([regex]::Match($times, 'scheduler-poll ([0-9]+)').Groups[1].Value)
}
if($phase -ne "missing-progress" -and $phase -ne "corrupt-progress") { Write-FakeProgress }
if($phase -eq "corrupt-progress" -and $env:TEST_CORRUPT_GAP_MS) { [Threading.Thread]::Sleep([int]$env:TEST_CORRUPT_GAP_MS) }
if($phase -eq "corrupt-progress") { [IO.File]::WriteAllText("$out.progress.json", "{") }
if($phase -eq "lost-progress") {
 $state.phaseComplete=$true
 Write-FakeProgress
 Start-Process pwsh -ArgumentList @("-NoProfile","-Command", "[Threading.Thread]::Sleep(2500); [IO.File]::Delete('$out.progress.json')")
}
[IO.File]::WriteAllText("$env:TEST_ROOT/started","ready")
[IO.File]::WriteAllText("$env:TEST_ROOT/worker-deadline","$env:MDPRO_NATIVE_CLEANUP_DEADLINE_MS")
# deadline-stall: every phase completes, the run never does, so only the transaction deadline ends it.
if($phase -eq "deadline-stall") { $state.phaseComplete=$true; Write-FakeProgress; [Threading.Thread]::Sleep(60000) }
if($phase -eq "tree") {
 $child=Start-Process pwsh -ArgumentList @("-NoProfile","-File","$env:TEST_ROOT/descendant.ps1","-Depth","1") -PassThru
 [Threading.Thread]::Sleep(500)
 exit 0
}
if($phase -eq "early-ready") {
 $state.phaseComplete=$true
 Write-FakeProgress
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
 Write-FakeProgress
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
  scheduler = scheduler.replace("try {", schedulerBoundary + `
if (-not $env:TEST_SCHED_BOOT_OP -or $env:TEST_SCHED_BOOT_OP -eq $r.op) {
  if ($env:TEST_SCHED_RACE_AFTER_SAMPLE) {
    $until=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 5000
    while(-not (Test-Path "$env:TEST_ROOT/supervisor-sampled")) {
      if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $until) { throw "supervisor sample not observed" }
      [Threading.Thread]::Sleep(10)
    }
  }
  if ($env:TEST_SCHED_READY_AFTER_BOOT_MS) { [Threading.Thread]::Sleep([int]$env:TEST_SCHED_READY_AFTER_BOOT_MS) }
  if ($env:TEST_SCHED_BAD_MARKER -and $r.readyPath) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $nonce = if ($env:TEST_SCHED_BAD_MARKER -eq "nonce") { "wrong" } else { $r.readyNonce }
    $pidValue = if ($env:TEST_SCHED_BAD_MARKER -eq "pid") { $PID + 1 } else { $PID }
    $time = if ($env:TEST_SCHED_BAD_MARKER -eq "stale") { $now - 60000 } elseif ($env:TEST_SCHED_BAD_MARKER -eq "future") { $now + 60000 } else { $now }
    @{ nonce=$nonce; pid=$pidValue; readyUtcMs=$time } | ConvertTo-Json -Compress | Set-Content -LiteralPath $r.readyPath -Encoding UTF8
    if ($env:TEST_SCHED_BAD_MARKER_GAP_MS) {
      [Threading.Thread]::Sleep([int]$env:TEST_SCHED_BAD_MARKER_GAP_MS)
      Remove-Item -LiteralPath $r.readyPath
    }
  }
  if ($env:TEST_SCHED_BOOT_MODE -eq "exit") { exit 8 }
  if ($env:TEST_SCHED_BOOT_MS) { [Threading.Thread]::Sleep([int]$env:TEST_SCHED_BOOT_MS) }
}
try {`)
    .replace("([Security.Principal.WindowsIdentity]::GetCurrent().Name)", '"fixture-user"');
  const reconcileScript = await readFile(path.join(dir, "native-reconcile.ps1"), "utf8");
  const supervisorScript = mutateSupervisorScript(await readFile(path.join(dir, "native-supervisor.ps1"), "utf8"), options.env);
  if (!reconcileScript.includes('$ErrorActionPreference = "Stop"')) throw new Error("native-reconcile.ps1 changed shape");
  if (!supervisorScript.includes('} finally { $child.Dispose() }')) throw new Error("native-supervisor.ps1 phase shape changed");
  const runScript = await readFile(path.join(dir, "ui-run.ps1"), "utf8");
  const mutatedRunScript = mutateRunScript(runScript);
  if (mutatedRunScript !== runScript) await writeFile(path.join(dir, "ui-run.ps1"), mutatedRunScript);
  await Promise.all([
    writeFile(path.join(dir, "native-supervisor.ps1"), supervisorScript.replace('} finally { $child.Dispose() }',
      '} finally { [IO.File]::AppendAllText("$env:TEST_ROOT/scheduler-times", "$Name $([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())`n"); $child.Dispose() }')),
    writeFile(path.join(dir, "native-reconcile.ps1"),
      reconcileScript.replace('$ErrorActionPreference = "Stop"', '$ErrorActionPreference = "Stop"\n' + reconcileProcessBoundary)),
    writeFile(path.join(dir, "native-job.ps1"), `Add-Type -LiteralPath '${await jobAssembly()}'\n`), writeFile(path.join(dir, "native-scheduler.ps1"), scheduler),
    writeFile(path.join(dir, "worker.ps1"), worker), writeFile(path.join(dir, "descendant.ps1"), descendant),
  ]);
  const runId = "a".repeat(32);
  // `entry` (D345) is merged last, so a caller can set a budget at the moment it starts the run rather than when the
  // fixture was built; two-argument callers are unchanged.
  function start(id = runId, env: Record<string, string> = {}, entryOverride: Record<string, string> = {}): { child: ChildProcess; result: Promise<{ status: number | null; lines: string[]; stderr: string }> } {
    // The child-ready signal gives each Scheduler op its phase budget after boot; the worker
    // retains the real reported phase start and the original transaction/cleanup limits.
    const entry = { StepsB64: Buffer.from(options.rawSteps ?? JSON.stringify(options.steps ?? [])).toString("base64"), RunId: id,
      DeadlineMs: String(Date.now() + 10000), PhaseMs: "3000", CleanupMs: "4000", PollMs: "10", ...options.entry, ...entryOverride };
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

// Native supervisor fixture mutations stay separate from orchestration so every test uses the same real PowerShell path.
function mutateSupervisorScript(source: string, fixtureEnv?: Record<string, string>): string {
  let supervisorScript = source;
  if (fixtureEnv?.TEST_SUPERVISOR_HOLD_UNREAD_POLL) {
    const clock = '$bootEnd = [math]::Min($launch + $SchedulerBootMs, $Limit)';
    if (!supervisorScript.includes(clock)) throw new Error("scheduler boot clock changed shape");
    supervisorScript = supervisorScript.replace(clock, clock + `
  if ($Name -eq "scheduler-poll") {
    @{ bootEnd=$bootEnd; limit=$Limit; readyPath=$readyPath } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath "$env:TEST_ROOT/poll-clock.json" -Encoding UTF8
  }`);
    const tick = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(tick)) throw new Error("scheduler tick changed shape");
    supervisorScript = supervisorScript.replace(tick, `while ($true) {
      if ($Name -eq "scheduler-poll" -and -not $script:heldPollTick) {
        $script:heldPollTick = $true
        while (-not (Test-Path -LiteralPath "$env:TEST_ROOT/release-poll-tick")) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (process.env.TEST_REVERT_UNREAD_MARKER_ORDER === "1") {
    const old = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })';
    const marker = 'if ($null -eq $end) {\n        $stamp = Read-SchedulerReadyStamp';
    if (!supervisorScript.includes(old) || !supervisorScript.includes(marker)) throw new Error("unread marker fix changed shape");
    supervisorScript = supervisorScript.replace(marker, old + '\n      ' + marker);
  }
  if (process.env.TEST_REVERT_BOOT_EFFECTIVE_END === "1") {
    const fixed = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })';
    if (!supervisorScript.includes(fixed)) throw new Error("boot effective end changed shape");
    supervisorScript = supervisorScript.replace(fixed, 'Assert-SchedulerDeadline $Name $now $Limit $end');
  }
  if (process.env.TEST_DISABLE_OUTER_WORKER_CHECK === "1") {
    const original = 'if ($workerEnd -le $effectiveLimit -and $now -ge $workerEnd)';
    if (!supervisorScript.includes(original)) throw new Error("outer worker check changed shape");
    supervisorScript = supervisorScript.replace(original, original.replace('if ($workerEnd', 'if ($false -and $workerEnd'));
  }
  for (const [name, guard] of [["NONCE", '$ready.nonce -ceq $ReadyNonce'], ["PID", '[long]$ready.pid -eq $ChildId'],
    ["STALE", '$stamp -ge $Launch']] as const) {
    if (process.env[`TEST_DISABLE_MARKER_${name}_CHECK`] === "1") {
      if (!supervisorScript.includes(guard)) throw new Error(`marker ${name} check changed shape`);
      supervisorScript = supervisorScript.replace(guard, "$true");
    }
  }
  if (process.env.TEST_DISABLE_DEADLINE_PRECEDENCE === "1") {
    const guard = '$workerEnd -le $schedulerEnd -and $Now -ge $workerEnd';
    if (!supervisorScript.includes(guard)) throw new Error("deadline precedence check changed shape");
    supervisorScript = supervisorScript.replace(guard, "$false -and " + guard);
  }
  if (process.env.TEST_DISABLE_POST_EXIT_WORKER_PRECEDENCE === "1") {
    const anchor = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })\n    if ($child.ExitCode -ne 0';
    if (!supervisorScript.includes(anchor)) throw new Error("post-exit precedence check changed shape");
    supervisorScript = supervisorScript.replace(anchor,
      'if ($now -ge [math]::Min($Limit, $(if ($null -eq $end) { $bootEnd } else { $end }))) { throw "NATIVE_PHASE_TIMEOUT phase=$Name" }\n    if ($child.ExitCode -ne 0');
  }
  if (fixtureEnv?.TEST_SUPERVISOR_READY_EXIT_RACE) {
    const anchor = '$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler tick changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
      if ($Name -eq "scheduler-start" -and -not (Test-Path "$env:TEST_ROOT/supervisor-sampled")) {
        [IO.File]::WriteAllText("$env:TEST_ROOT/supervisor-sampled", "sampled")
        while (-not $child.HasExited) { [Threading.Thread]::Sleep(10) }
      }`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_WAIT_FOR_LATE_READY) {
    const anchor = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler wait changed shape");
    supervisorScript = supervisorScript.replace(anchor, `while ($true) {
      if ($Name -eq "scheduler-start" -and -not $script:lateReadyObserved) {
        $script:lateReadyObserved = $true
        while (-not $child.HasExited) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_DELAY_POLL_TICK_PAST_LIMIT) {
    const anchor = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler wait changed shape");
    supervisorScript = supervisorScript.replace(anchor, `while ($true) {
      if ($Name -eq "scheduler-poll" -and $null -ne $end -and -not $script:pollTickDelayed) {
        $script:pollTickDelayed = $true
        while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $Limit + 150) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_DELAY_OUTER_PAST_WORK_END) {
    const anchor = '$lastPoll = $now';
    if (!supervisorScript.includes(anchor)) throw new Error("outer poll cadence changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
        if (-not $script:outerTickDelayed) {
          $script:outerTickDelayed = $true
          while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $workEnd + 150) { [Threading.Thread]::Sleep(10) }
        }`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_RESUME_AFTER_FIRST_POLL_WORKER_END) {
    const anchor = '$lastPoll = $now';
    if (!supervisorScript.includes(anchor)) throw new Error("outer poll cadence changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
        if (-not $script:firstPollWorkerWait) {
          $script:firstPollWorkerWait = $true
          while ($true) {
            $worker = Read-WorkerProgress
            if ($worker -and -not $worker.phaseComplete) { break }
            if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $workEnd) { throw "fixture worker progress missing" }
            [Threading.Thread]::Sleep(10)
          }
          while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt [long]$worker.phaseStartedMs + $PhaseMs + 100) {
            [Threading.Thread]::Sleep(10)
          }
        }`);
  }
  if (process.env.TEST_DISABLE_WORKER_PHASE_CHECKS === "1" || fixtureEnv?.TEST_DISABLE_WORKER_PHASE_CHECKS === "1") {
    const inWait = '$workerEnd -le $schedulerEnd -and $Now -ge $workerEnd';
    const outer = '$workerEnd -le $effectiveLimit -and $now -ge $workerEnd';
    if (!supervisorScript.includes(inWait) || !supervisorScript.includes(outer)) throw new Error("worker phase checks changed shape");
    supervisorScript = supervisorScript.replace(inWait, '$false -and ' + inWait).replace(outer, '$false -and ' + outer);
  }
  if (process.env.TEST_SKIP_POST_EXIT_LIMIT_CHECK === "1") {
    const check = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })\n    ';
    const resultAnchor = 'if (-not (Test-Path -LiteralPath $resultPath))';
    const answerAnchor = 'if ($child.ExitCode -ne 0';
    if (!supervisorScript.includes(check + resultAnchor) || !supervisorScript.includes(check + answerAnchor)) {
      throw new Error("post-exit limit checks changed shape");
    }
    supervisorScript = supervisorScript.replace(check + resultAnchor, resultAnchor).replace(check + answerAnchor, answerAnchor);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_RESULT_READ_DELAY_MS) {
    const anchor = 'if (-not (Test-Path -LiteralPath $resultPath))';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler result read changed shape");
    supervisorScript = supervisorScript.replace(anchor,
      'if ($Name -eq "scheduler-start") { [Threading.Thread]::Sleep([int]$env:TEST_SUPERVISOR_RESULT_READ_DELAY_MS) }\n    ' + anchor);
  }
  return supervisorScript;
}

function mutateRunScript(source: string): string {
  let runScript = source;
  if (process.env.TEST_BYPASS_NATIVE_LATCH === "1") {
    const check = 'if (Test-Path -LiteralPath $blocked) { throw "NATIVE_RECONCILIATION_REQUIRED" }';
    if (!runScript.includes(check)) throw new Error("native latch guard changed shape");
    runScript = runScript.replaceAll(check, 'if ($false -and (Test-Path -LiteralPath $blocked)) { throw "NATIVE_RECONCILIATION_REQUIRED" }');
  }
  if (process.env.TEST_BYPASS_COMMITTED_RESULT === "1") {
    const check = 'elseif ($rc -eq 0 -and $workerResult.status -ne "completed")';
    if (!runScript.includes(check)) throw new Error("committed result guard changed shape");
    runScript = runScript.replace(check, 'elseif ($false -and $rc -eq 0 -and $workerResult.status -ne "completed")');
  }
  if (process.env.TEST_MISLABEL_COMMITTED_FAILURE_AS_MISSING === "1") {
    const check = 'if ($rc -eq 0 -and -not $workerResult)';
    if (!runScript.includes(check)) throw new Error("committed failure guard changed shape");
    runScript = runScript.replace(check, 'if ($rc -eq 0)');
  }
  return runScript;
}
