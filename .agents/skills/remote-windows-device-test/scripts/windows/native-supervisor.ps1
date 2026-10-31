# Purpose: bounded Scheduler phases and kernel lifetime cleanup for one invocation.
# Loaded by ui-run; all blocking cmdlets run in owned control processes, never this supervisor.
function Invoke-SchedulerPhase([string]$Name, $Request, [long]$Limit) {
  $requestPath = Join-Path $runDir ("scheduler-" + [guid]::NewGuid().ToString("N") + ".json")
  $resultPath = "$requestPath.result"
  $Request | ConvertTo-Json -Compress -Depth 6 | Set-Content -LiteralPath $requestPath -Encoding UTF8
  $args = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSScriptRoot + '\native-scheduler.ps1" -Request "' + $requestPath + '" -Result "' + $resultPath + '"'
  $child = $controlJob.StartOwned($powershellExe, $args)
  $end = [math]::Min([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $PhaseMs, $Limit)
  try {
    while (-not $child.HasExited) {
      if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $end) { throw "NATIVE_PHASE_TIMEOUT phase=$Name" }
      [Threading.Thread]::Sleep($PollMs)
    }
    if (-not (Test-Path -LiteralPath $resultPath)) { throw "NATIVE_SCHEDULER_NO_RESULT phase=$Name" }
    $answer = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($child.ExitCode -ne 0 -or -not $answer.ok) { throw "NATIVE_SCHEDULER_FAILED phase=$Name $($answer.error)" }
    return $answer.value
  } finally { $child.Dispose() }
}
function Read-WorkerProgress {
  if (Test-Path -LiteralPath "$outPath.progress.json") {
    try {
      $value = Get-Content -LiteralPath "$outPath.progress.json" -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($value.runId -cne $RunId) { throw "NATIVE_PROGRESS_RUN_MISMATCH" }
      return $value
    } catch { if ($_.Exception.Message -like "NATIVE_*") { throw }; return $script:lastProgress }
  }
  return $script:lastProgress
}
function Invoke-NativeSupervisor {
  $script:lastProgress = $null; $script:workerStatus = 1; $script:supervisorError = $null
  $script:ownedManifest = @(); $script:cleanupProof = "pending"
  $script:taskAttempted = $false
  $workEnd = $DeadlineMs - $CleanupMs
  try {
    $arguments = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('/c ""' + $PSScriptRoot + '\ui.cmd" "' + $runDir + '" ' + $RunId + ' ' + $DeadlineMs + ' ' + $PhaseMs + ' ' + $CleanupMs + '"'))
    $bootstrap = Join-Path $PSScriptRoot "native-job.exe"
    $script:taskAttempted = $true
    [void](Invoke-SchedulerPhase "scheduler-start" @{ op = "start"; name = $taskName; exe = $bootstrap; arguments = $inputJob.Name + ' "' + $env:ComSpec + '" ' + $arguments } $workEnd)
    $lastPoll = 0L
    while ($true) {
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $value = Read-WorkerProgress
      if ($value) { $script:lastProgress = $value }
      if ($now -ge $workEnd -and (-not $value -or $value.cleanup -eq "pending")) { throw "NATIVE_TRANSACTION_TIMEOUT phase=$($value.phase)" }
      if ($now -ge $DeadlineMs) { throw "NATIVE_TRANSACTION_TIMEOUT phase=cleanup" }
      if ($value -and -not $value.phaseComplete -and $now - [long]$value.phaseStartedMs -ge $PhaseMs) { throw "NATIVE_PHASE_TIMEOUT phase=$($value.phase)" }
      if ($now - $lastPoll -ge [math]::Max(100, $PollMs)) {
        $state = Invoke-SchedulerPhase "scheduler-poll" @{ op = "poll"; name = $taskName } $workEnd
        $lastPoll = $now
        if ($state.status -ne "Running" -and $state.status -ne "Queued") {
          # Ready also occurs before the just-started instance begins. Only this run's
          # committed worker result can prove that its execution has actually completed.
          if (-not (Test-Path -LiteralPath "$outPath.result.json")) { continue }
          $committed = Get-Content -LiteralPath "$outPath.result.json" -Raw -Encoding UTF8 | ConvertFrom-Json
          if ($committed.runId -cne $RunId) { throw "NATIVE_RESULT_RUN_MISMATCH" }
          if ($null -eq $state.result) { throw "NATIVE_TASK_NO_RESULT" }
          $script:workerStatus = [long]$state.result
          if ($script:workerStatus -lt 0 -or $script:workerStatus -gt 125) { $script:workerStatus = 70 }
          break
        }
      }
      [Threading.Thread]::Sleep($PollMs)
    }
  } catch {
    $script:supervisorError = $_.Exception.Message
    if ($script:lastProgress) { $script:supervisorError += " worker-phase=" + $script:lastProgress.phase }
    # Every Windows-side failure, timeouts included, exits 1 with its phase in OUTCOME; 124 is only the
    # Mac's own "no answer by the outer bound", so the two never share a code (opus M4, ops.md).
    $script:workerStatus = 1
  } finally {
    # A kernel job owns lifetimes even if their parents exit, detach or their PIDs are later reused.
    $errors = New-Object System.Collections.ArrayList
    try { $script:ownedManifest += @($inputJob.Snapshot()) } catch { [void]$errors.Add($_.Exception.Message) }
    try { $inputJob.Stop() } catch { [void]$errors.Add($_.Exception.Message) }
    $cleanupEnd = [math]::Min($DeadlineMs, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $CleanupMs)
    try {
      do {
        $remaining = @($inputJob.Snapshot())
        if ($remaining.Count -eq 0) { break }
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $cleanupEnd) { throw "NATIVE_OWNED_PROCESSES_REMAIN" }
        [Threading.Thread]::Sleep($PollMs)
      } while ($true)
    } catch { [void]$errors.Add($_.Exception.Message) }
    try { [void](Invoke-SchedulerPhase "scheduler-cleanup" @{ op = "cleanup"; name = $taskName } $cleanupEnd) } catch { [void]$errors.Add($_.Exception.Message) }
    try {
      $script:ownedManifest += @($controlJob.Snapshot())
    } catch { [void]$errors.Add($_.Exception.Message) }
    try {
      $controlJob.Stop()
      do {
        $remaining = @($controlJob.Snapshot())
        if ($remaining.Count -eq 0) { break }
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $cleanupEnd) { throw "NATIVE_CONTROL_PROCESSES_REMAIN" }
        [Threading.Thread]::Sleep($PollMs)
      } while ($true)
    } catch { [void]$errors.Add($_.Exception.Message) }
    if ($errors.Count) { $script:cleanupProof = "failed"; $script:workerStatus = 1; $script:supervisorError += "; cleanup: " + ($errors -join "; ") }
    else { $script:cleanupProof = "complete" }
    $script:ownedManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runDir "owned-processes.json") -Encoding UTF8
  }
}
