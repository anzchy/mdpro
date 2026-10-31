# Purpose: clear the native-session latch for one named run, only after proving that run is over.
# Never deletes evidence and never replays input. Contract: ../../reference/ops.md (reconcile).
# Untyped budget parameters retain Read-NativeInteger's numeric results for the shared supervisor.
param([string]$RunId = "", [switch]$InputReleasedConfirmed, $PhaseMs = "5000", $PollMs = "25")
$ErrorActionPreference = "Stop"
$rc = 1; $checks = [ordered]@{}; $lock = $null; $controlJob = $null
$blocked = Join-Path $PSScriptRoot "native-session-blocked.json"
function Refuse([string]$Reason, [int]$Code = 1) { $script:rc = $Code; throw "REFUSE:$Reason" }
try {
  if ($RunId -cnotmatch '^[a-f0-9]{32}$') { Refuse "NATIVE_RECONCILE_INVALID" 2 }
  . "$PSScriptRoot\native-validation.ps1"
  try { $PhaseMs = Read-NativeInteger $PhaseMs 10 5000; $PollMs = Read-NativeInteger $PollMs 1 1000 } catch { Refuse "NATIVE_RECONCILE_INVALID" 2 }
  # The same exclusive lock ui-run holds for a whole transaction: no run can start or latch meanwhile.
  try { $lock = [IO.File]::Open((Join-Path $PSScriptRoot "native-session.lock"), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  catch { Refuse "NATIVE_SESSION_BUSY" }
  $checks.lock = "held"
  if (-not (Test-Path -LiteralPath $blocked)) { Refuse "NATIVE_RECONCILE_NOT_LATCHED" }
  $latch = Get-Content -LiteralPath $blocked -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$latch.runId -cne $RunId) { Refuse "NATIVE_RECONCILE_RUN_MISMATCH" }
  $checks.runId = "match"
  $runDir = Join-Path (Join-Path $PSScriptRoot "runs") $RunId
  # Scheduler cmdlets can block: query in an owned, bounded control process, as ui-run does.
  . "$PSScriptRoot\native-job.ps1"
  . "$PSScriptRoot\native-supervisor.ps1"
  $powershellExe = Join-Path $PSHOME "powershell.exe"
  $controlJob = New-Object NativeJobScope ("Global\mdpro-driver-" + [guid]::NewGuid().ToString("N"))
  $task = Invoke-SchedulerPhase "reconcile-task" @{ op = "exists"; name = "mdpro-audit-ui-" + $RunId } ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $PhaseMs)
  if ($task.exists) { Refuse "NATIVE_RECONCILE_TASK_PRESENT" }
  $checks.task = "absent"
  # Members are matched by pid, birth and exe (pid reuse is not the run's process). An identity
  # that cannot be read is treated as alive: the driver cannot prove that process is gone.
  $manifest = Join-Path $runDir "owned-processes.json"
  if (-not (Test-Path -LiteralPath $manifest)) { Refuse "NATIVE_RECONCILE_MANIFEST_MISSING" }
  try {
    $raw = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
    $members = if ([string]::IsNullOrWhiteSpace($raw)) { @() } else { @($raw | ConvertFrom-Json) }
    foreach ($m in $members) { if ([string]$m.pid -notmatch '^[1-9][0-9]*$' -or -not $m.birth -or -not $m.exe) { throw "member" } }
  } catch { Refuse "NATIVE_RECONCILE_MANIFEST_INVALID" }
  foreach ($m in $members) {
    $p = Get-Process -Id ([int]$m.pid) -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    try { $birth = $p.StartTime.ToUniversalTime().Ticks.ToString(); $exe = $p.Path } catch { $birth = $null }
    if (-not $birth -or -not $exe -or ($birth -ceq [string]$m.birth -and $exe -eq [string]$m.exe)) { Refuse "NATIVE_RECONCILE_OWNED_ALIVE pid=$($m.pid)" }
  }
  $checks.owned = "none-alive"; $checks.members = $members.Count
  # The driver cannot prove a key is up; only the operator, looking at the desktop, can.
  if ([string]$latch.heldInput -cne "released" -and -not $InputReleasedConfirmed) { Refuse "NATIVE_RECONCILE_INPUT_UNCONFIRMED" }
  $checks.heldInput = $(if ([string]$latch.heldInput -ceq "released") { "released" } else { "operator-confirmed" })
  # Evidence first, then a move of the latch's exact bytes: it is never rewritten or deleted.
  $record = [ordered]@{ runId = $RunId; reconciledAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();
    inputReleasedConfirmed = [bool]$InputReleasedConfirmed; checks = $checks }
  $temp = Join-Path $runDir "reconcile-checks.tmp"
  $record | ConvertTo-Json -Compress -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination (Join-Path $runDir "reconcile-checks.json") -Force
  Move-Item -LiteralPath $blocked -Destination (Join-Path $runDir "reconciled.json")
  $rc = 0
  [ordered]@{ runId = $RunId; status = "reconciled"; checks = $checks } | ConvertTo-Json -Compress -Depth 6
} catch {
  $message = $_.Exception.Message
  $reason = if ($message.StartsWith("REFUSE:")) { $message.Substring(7) } else { "NATIVE_RECONCILE_ERROR: " + $message }
  [ordered]@{ runId = $RunId; status = "refused"; reason = $reason; checks = $checks } | ConvertTo-Json -Compress -Depth 6
} finally {
  if ($controlJob) { $controlJob.Dispose() }
  if ($lock) { $lock.Dispose() }
}
exit $rc
