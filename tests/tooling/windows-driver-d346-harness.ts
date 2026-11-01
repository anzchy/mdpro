import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";
import { powershell, quote, windows } from "./windows-driver-d344-harness";

export { powershell, quote, windows };
export const runId = "a".repeat(32);
export type Poll = {
  status: string; result: unknown; afterStatus?: string; commit?: string;
  lastRunTime?: string | null; progress?: Record<string, unknown> | string;
  removeProgress?: boolean; bootstrap?: string;
};
export const progress = (fields: Record<string, unknown> = {}) => ({
  runId, phase: "initialization", phaseStartedMs: Date.now(), phaseComplete: true,
  step: 0, op: "", completedSteps: 0, inputOutcome: "none", heldInput: "released",
  cleanup: "pending", log: [], ...fields,
});
export const bootstrapRecord = (fields: Record<string, unknown> = {}) => ({
  runId, job: `Global\\mdpro-driver-${runId}`, stage: "open", childCreated: false,
  childResumed: false, code: null, error: "", ...fields,
});
export const bootstrapLog = (fields: Record<string, unknown> = {}, preceding: Record<string, unknown>[] = []) => [
  bootstrapRecord(), ...preceding, bootstrapRecord({ code: 65, error: "Access denied 中文", ...fields }),
].map((r) => JSON.stringify(r)).join("\n") + "\n";

// Actual entry/supervisor/Scheduler scripts and real filesystem artifacts execute.
// Only Scheduler and kernel observations are substituted; I1/I2 are the named
// tester-owned Windows counterparts, and no local real ACL claim is made.
const schedulerBoundary = String.raw`
function Get-ScheduledTask {
  param($TaskName,$ErrorAction)
  if($r.op -ne 'poll') {
    if(Test-Path "$env:TEST_ROOT/task") { return [pscustomobject]@{State='Ready'} }
    return $null
  }
  if($null -eq $script:pollValue) {
    $all=@(Get-Content "$env:TEST_ROOT/polls.json" -Raw | ConvertFrom-Json)
    $script:pollIndex=if(Test-Path "$env:TEST_ROOT/poll-count"){[int][IO.File]::ReadAllText("$env:TEST_ROOT/poll-count")}else{0}
    $script:pollValue=$all[[math]::Min($script:pollIndex,$all.Count-1)]
    $script:readInfo=$false
  }
  $state=$script:pollValue.status
  if($script:readInfo -and $script:pollValue.afterStatus){$state=$script:pollValue.afterStatus}
  [pscustomobject]@{State=$state}
}
function Get-ScheduledTaskInfo {
  param($TaskName,$ErrorAction)
  $p=$script:pollValue; $script:readInfo=$true
  [IO.File]::WriteAllText("$env:TEST_ROOT/poll-count",[string]($script:pollIndex+1))
  $out="$env:TEST_ROOT/runs/$env:TEST_RUN_ID/ui-out.json"
  if($p.PSObject.Properties.Name -contains 'progress') {
    $text=if($p.progress -is [string]){$p.progress}else{$p.progress|ConvertTo-Json -Compress -Depth 10}
    [IO.File]::WriteAllText("$out.progress.json",$text)
  }
  if($p.PSObject.Properties.Name -contains 'bootstrap') {
    [IO.File]::WriteAllText("$env:TEST_ROOT/runs/$env:TEST_RUN_ID/bootstrap.log",[string]$p.bootstrap)
  }
  if($p.removeProgress){[IO.File]::Delete("$out.progress.json")}
  if($p.commit) {
    $v=@{runId=$env:TEST_RUN_ID;status=$p.commit;phase='worker-complete';cleanup='complete'}
    if($p.commit -eq 'wrong-run'){$v.runId='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'}
    [IO.File]::WriteAllText("$out.result.json",($v|ConvertTo-Json -Compress))
  }
  [IO.File]::WriteAllText("$env:TEST_ROOT/terminal-observed",[string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $when=[DateTime]::UtcNow
  if($p.PSObject.Properties.Name -contains 'lastRunTime') {
    $when=if($p.lastRunTime -eq 'stale'){[DateTime]::UtcNow.AddDays(-1)}else{$p.lastRunTime}
    if($p.lastRunTime -in @('equal','offset')) {
      $requests=@(Get-ChildItem -LiteralPath "$env:TEST_ROOT/runs/$env:TEST_RUN_ID" -Filter 'scheduler-*.json' | ForEach-Object {
        Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      } | Where-Object {$_.op -eq 'start'})
      if($requests.Count -ne 1 -or $null -eq $requests[0].startedAtMs){throw 'fixture start timestamp missing'}
      $equal=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$requests[0].startedAtMs)
      $when=if($p.lastRunTime -eq 'equal'){$equal.UtcDateTime}else{$equal.ToOffset([TimeSpan]::FromHours(8))}
    }
  }
  [pscustomobject]@{LastTaskResult=$p.result;LastRunTime=$when}
}
function Unregister-ScheduledTask {
  param($TaskName,$Confirm,$ErrorAction)
  if($env:D346_CLEANUP_FAIL -eq '1'){throw 'D346_CLEANUP_FAILED'}
  [IO.File]::Delete("$env:TEST_ROOT/task")
}
`;

type SnapshotKind = "identified" | "unreadable" | "exited";
// Extend the existing kernel substitute only in this fixture. The fake kernel's
// first observation has an owned lifetime; later drain observations are empty.
// A reused numeric PID names the independent canary, which must remain untouched.
async function snapshotAssembly(dir: string) {
  const harness = await readFile(path.join(__dirname, "windows-driver-native-supervisor-harness.ts"), "utf8");
  const sourceMarker = "const jobSource = String.raw`";
  const sourceIndex = harness.indexOf(sourceMarker);
  const start = sourceIndex + sourceMarker.length;
  const end = harness.indexOf("`;\nlet jobAssemblyBuild", start);
  if (sourceIndex < 0 || end < start) throw new Error("Kernel boundary source not found");
  let source = harness.slice(start, end);
  source = source.replace("public string exe; }", "public string exe; public string job; public bool alive; public bool exited; public string proof; }");
  source = source.replace("public string Name; List<int>", "int d346Snapshots; public string Name; List<int>");
  const marker = " public NativeJobMember[] Snapshot() {";
  if (!source.includes(marker)) throw new Error("Kernel Snapshot boundary not found");
  source = source.replace(marker, marker + String.raw`
   if (Environment.GetEnvironmentVariable("D346_TEST_SNAPSHOT") != null && ++d346Snapshots == 1) {
     int pid = Int32.Parse(Environment.GetEnvironmentVariable("D346_TEST_CANARY_PID"));
     string kind = Environment.GetEnvironmentVariable("D346_TEST_SNAPSHOT");
     using (Process p = Process.GetProcessById(pid)) {
       return new [] { new NativeJobMember { pid=pid,
         birth=kind=="identified" ? p.StartTime.ToUniversalTime().Ticks.ToString() : "",
         exe=kind=="identified" ? p.MainModule.FileName : "unreadable: exited-looking 中文",
         alive=kind=="unreadable", exited=kind=="exited",
         proof=kind=="exited" ? "pinned-handle-signaled" : null } };
     }
   }
`);
  const assembly = path.join(dir, "snapshot-kernel.dll");
  await powershell(`Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}'))) -OutputAssembly ${quote(assembly)}`);
  await writeFile(path.join(dir, "native-job.ps1"), `Add-Type -LiteralPath ${quote(assembly)}\n`);
}

export async function transaction(polls: Poll[], options: { cleanupFail?: boolean; snapshotKind?: SnapshotKind; canaryPid?: number } = {}) {
  const f = await supervisorFixture("success", {
    entry: { DeadlineMs: String(Date.now() + 16000), CleanupMs: "4000", PhaseMs: "5000", PollMs: "25" },
    env: { D346_CLEANUP_FAIL: options.cleanupFail ? "1" : "0", ...(options.snapshotKind ? {
      D346_TEST_SNAPSHOT: options.snapshotKind, D346_TEST_CANARY_PID: String(options.canaryPid),
    } : {}) },
  });
  if (options.snapshotKind) await snapshotAssembly(f.dir);
  const scheduler = path.join(f.dir, "native-scheduler.ps1");
  const original = await readFile(scheduler, "utf8");
  const marker = "\ntry {\n  # Only a definite";
  if (!original.includes(marker)) throw new Error("Scheduler harness entry changed");
  await writeFile(scheduler, original.replace(marker, "\n" + schedulerBoundary + marker));
  // A later completion bounds the deliberately wrong pre-fix wait. Tests assert
  // the exact consumed prefix, so it cannot hide a missed terminal observation.
  await writeFile(path.join(f.dir, "polls.json"), JSON.stringify([
    ...polls, { status: "Ready", result: 0, commit: "completed" },
  ]));
  await writeFile(path.join(f.dir, "worker.ps1"), "exit 1\n");
  await writeFile(path.join(f.dir, "unrelated-task"), "untouched 中文");
  const result = await f.start(runId).result;
  const line = result.lines.filter((v) => v.startsWith("OUTCOME ")).at(-1);
  const outcome = line ? JSON.parse(line.slice(8)) : null;
  const count = await readFile(path.join(f.dir, "poll-count"), "utf8").then(Number, () => 0);
  return { ...f, ...result, outcome, count };
}

export async function platform(stage: string) {
  return JSON.parse(await powershell(String.raw`
$ErrorActionPreference='Stop'; $script:effects=@(); $failure=$null
function Add-Type {param($AssemblyName,$TypeDefinition)
  $kind=if($script:effects.Count -eq 0){'assemblies'}else{'interop'}
  if($kind -eq ${quote(stage)}){throw 'HRESULT 0x80131047 中文'}
  $script:effects+=,$kind
}
try {. ${quote(path.join(windows, "native-platform.ps1"))}; $script:effects+=,'after-platform'}
catch {$failure=$_.Exception.Message}
@{error=$failure;effects=@($script:effects)}|ConvertTo-Json -Compress
`));
}
