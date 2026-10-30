# Purpose: one run-bound desktop transaction with a held session lock and retained evidence.
# No shared steps/output, name-wide cleanup or replay. Failed cleanup/held input latches refusal.
param([string]$StepsB64, [string]$RunId = ([guid]::NewGuid().ToString("N")),
      [string]$DeadlineMs = "0", [string]$PhaseMs = "5000", [string]$CleanupMs = "5000",
      [string]$PollMs = "25", [string]$TimeoutSec = "90")
$ErrorActionPreference = "Stop"
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$rc = 1; $lock = $null; $inputJob = $null; $controlJob = $null
$lines = New-Object System.Collections.ArrayList
$blocked = Join-Path $PSScriptRoot "native-session-blocked.json"
try {
  . "$PSScriptRoot\native-validation.ps1"
  $PhaseMs = Read-NativeInteger $PhaseMs 10 5000
  $CleanupMs = Read-NativeInteger $CleanupMs 10 5000
  $PollMs = Read-NativeInteger $PollMs 1 1000
  $DeadlineMs = Read-NativeInteger $DeadlineMs 0 ([long]::MaxValue)
  if ($DeadlineMs -eq 0) { $DeadlineMs = $started + 30000 }
  if ($TimeoutSec -notmatch '^[0-9]+(\.[0-9]{1,3})?$') { throw "UI_BUDGET_INVALID" }
  $TimeoutSec = [double]::Parse($TimeoutSec, [Globalization.CultureInfo]::InvariantCulture)
  if ($RunId -notmatch '^[a-f0-9]{32}$' -or $PhaseMs -lt 10 -or $PhaseMs -gt 5000 -or $CleanupMs -lt 10 -or $CleanupMs -gt 5000 -or
      $PollMs -lt 1 -or $PollMs -gt 1000 -or $DeadlineMs -lt $started + $PhaseMs + $CleanupMs -or $DeadlineMs -gt $started + 85000 -or $TimeoutSec -lt 0.1 -or $TimeoutSec -gt 90) { throw "UI_BUDGET_INVALID" }
  $bytes = Read-NativeSteps $StepsB64
  $env:MDPRO_NATIVE_POLL_MS = $PollMs.ToString()
  $env:MDPRO_NATIVE_CLEANUP_DEADLINE_MS = $DeadlineMs.ToString()
  if (Test-Path -LiteralPath $blocked) { throw "NATIVE_RECONCILIATION_REQUIRED" }
  try { $lock = [IO.File]::Open((Join-Path $PSScriptRoot "native-session.lock"), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  catch { throw "NATIVE_SESSION_BUSY" }
  if (Test-Path -LiteralPath $blocked) { throw "NATIVE_RECONCILIATION_REQUIRED" }
  $runDir = Join-Path (Join-Path $PSScriptRoot "runs") $RunId
  if (Test-Path -LiteralPath $runDir) { throw "NATIVE_RUN_ID_REUSED" }
  [void][IO.Directory]::CreateDirectory($runDir)
  $outPath = Join-Path $runDir "ui-out.json"
  $taskName = "mdpro-audit-ui-" + $RunId
  [IO.File]::WriteAllBytes((Join-Path $runDir "steps.json"), $bytes)
  . "$PSScriptRoot\native-job.ps1"
  . "$PSScriptRoot\native-supervisor.ps1"
  $inputJob = New-Object NativeJobScope ("Global\mdpro-driver-" + $RunId)
  $controlJob = New-Object NativeJobScope ("Global\mdpro-driver-" + [guid]::NewGuid().ToString("N"))
  $powershellExe = Join-Path $PSHOME "powershell.exe"
  Invoke-NativeSupervisor
  $rc = $script:workerStatus
  $progress = Read-WorkerProgress
  if ($progress) { foreach ($line in @($progress.log)) { [void]$lines.Add($line) } }
  $workerResult = $null
  if (Test-Path -LiteralPath "$outPath.result.json") {
    $workerResult = Get-Content -LiteralPath "$outPath.result.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($workerResult.runId -cne $RunId) { throw "NATIVE_RESULT_RUN_MISMATCH" }
  }
  # A task exit of 0 is not proof: only a committed "completed" result is. A present failed result keeps its phase.
  if ($rc -eq 0 -and -not $workerResult) { $rc = 1; $script:supervisorError = "NATIVE_WORKER_RESULT_MISSING" }
  elseif ($rc -eq 0 -and $workerResult.status -ne "completed") { $rc = 1 }
  $outcome = @{ runId = $RunId; status = $(if ($rc -eq 0) { "completed" } else { "failed" });
    phase = $(if ($script:supervisorError) { $script:supervisorError } elseif ($workerResult) { $workerResult.phase } else { "bootstrap" });
    step = $(if ($progress) { $progress.step } else { 0 }); op = $(if ($progress) { $progress.op } else { "" });
    elapsedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $started;
    completedSteps = $(if ($progress) { $progress.completedSteps } else { 0 });
    inputOutcome = $(if ($progress) { $progress.inputOutcome } else { "none" });
    heldInput = $(if ($progress) { $progress.heldInput } else { "released" }); cleanup = $script:cleanupProof }
  if ($workerResult -and $workerResult.cleanup -ne "complete") { $outcome.cleanup = "failed"; $rc = 1 }
  if (-not $workerResult -and $progress -and $progress.inputOutcome -ne "none") { $outcome.inputOutcome = "unknown" }
  if (-not $workerResult -and -not $progress -and $script:taskAttempted) { $outcome.inputOutcome = "unknown"; $outcome.heldInput = "uncertain" }
  if ($outcome.cleanup -ne "complete" -or $outcome.heldInput -eq "uncertain" -or (-not $workerResult -and $script:taskAttempted)) {
    $outcome | ConvertTo-Json -Compress | Set-Content -LiteralPath $blocked -Encoding UTF8
  }
  [void]$lines.Add("OUTCOME " + ($outcome | ConvertTo-Json -Compress))
  $temp = Join-Path $runDir "result.tmp"
  $outcome | ConvertTo-Json -Compress | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination (Join-Path $runDir "result.json")
} catch {
  [void]$lines.Add("ERROR UI: " + $_.Exception.Message)
  $rc = if ($_.Exception.Message -match "UI_.*INVALID|TOO_LARGE") { 2 } else { 1 }
  $outcome = @{ runId = $RunId; status = "failed"; phase = "setup: " + $_.Exception.Message;
    step = 0; op = ""; completedSteps = 0; elapsedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $started;
    inputOutcome = $(if ($script:taskAttempted) { "unknown" } else { "none" });
    heldInput = $(if ($script:taskAttempted) { "uncertain" } else { "released" });
    cleanup = $(if ($inputJob) { "failed" } else { "not-started" }) }
  [void]$lines.Add("OUTCOME " + ($outcome | ConvertTo-Json -Compress))
  if ($script:taskAttempted -and $lock) { $outcome | ConvertTo-Json -Compress | Set-Content -LiteralPath $blocked -Encoding UTF8 }
} finally {
  if ($inputJob) { $inputJob.Dispose() }
  if ($controlJob) { $controlJob.Dispose() }
  if ($lock) { $lock.Dispose() }
}
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@($lines) | ConvertTo-Json -Compress -Depth 10)))
exit $rc
