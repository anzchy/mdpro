# Purpose: durable phase journal, absolute deadlines, bounded child I/O and truthful input outcomes.
# ui-run supervises this file externally because a blocked OS provider cannot interrupt itself.
$script:startedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($DeadlineMs -eq 0) { $DeadlineMs = $script:startedMs + 30000 }
$script:workDeadline = $DeadlineMs - $CleanupMs
$script:phase = "initialization"; $script:phaseStartedMs = $script:startedMs
$script:currentStep = 0; $script:currentOp = ""; $script:completedSteps = 0
$script:heldCount = 0; $script:releaseUncertain = $false; $script:inputTouched = $false
$script:cleanupMode = $false; $script:cleanupState = "pending"; $script:failedPhase = $null
$script:phaseComplete = $false
$log = New-Object System.Collections.ArrayList
function Write-Progress {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $state = @{ runId = $RunId; phase = $script:phase; phaseStartedMs = $script:phaseStartedMs;
    phaseComplete = $script:phaseComplete; step = $script:currentStep; op = $script:currentOp;
    elapsedMs = $now - $script:startedMs; completedSteps = $script:completedSteps;
    inputOutcome = $(if ($script:releaseUncertain) { "unknown" } elseif ($script:inputTouched) { "partial" } else { "none" });
    heldInput = $(if ($script:releaseUncertain -or $script:heldCount -gt 0) { "uncertain" } else { "released" });
    cleanup = $script:cleanupState; log = @($log) }
  $temp = "$Out.progress.$PID.tmp"
  [IO.File]::WriteAllText($temp, ($state | ConvertTo-Json -Compress -Depth 10), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination "$Out.progress.json" -Force
}
function L($o) { [void]$log.Add([string]$o); Write-Progress }
function Check-Deadline {
  $limit = if ($script:cleanupMode) { $DeadlineMs } else { $script:workDeadline }
  if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $limit) { throw "NATIVE_TRANSACTION_TIMEOUT phase=$($script:phase)" }
}
function Start-Phase([string]$Name, [switch]$Cleanup) {
  if ($script:heldCount -gt 0 -and $Name -notlike "input:*") { throw "NATIVE_HELD_BOUNDARY_REFUSED phase=$Name" }
  if ($Cleanup) { $script:cleanupMode = $true }
  Check-Deadline
  $script:phase = $Name; $script:phaseStartedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $script:phaseComplete = $false
  Write-Progress
}
function Complete-Phase { $script:phaseComplete = $true; Write-Progress }
function Set-HeldInput([int]$Delta) {
  $script:inputTouched = $true
  $script:heldCount += $Delta
  if ($script:heldCount -lt 0) { $script:heldCount = 0; $script:releaseUncertain = $true }
  Write-Progress
}
function Invoke-NodeBounded([string]$Name, [string[]]$Arguments, [switch]$Cleanup, [switch]$AllowFailure) {
  Start-Phase $Name -Cleanup:$Cleanup
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = "node"; $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
  # Every argument here is an internally generated path, native label, operation or base64.
  $quoted = @($Arguments | ForEach-Object { '"' + $_.Replace('\', '\').Replace('"', '\"') + '"' })
  $info.Arguments = $quoted -join ' '
  $child = New-Object Diagnostics.Process; $child.StartInfo = $info
  if (-not $child.Start()) { throw "NATIVE_CHILD_START_FAILED phase=$Name" }
  $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
  $limit = [math]::Min($script:phaseStartedMs + $PhaseMs, $(if ($Cleanup) { $DeadlineMs } else { $script:workDeadline }))
  try {
    while (-not $child.HasExited -or -not $stdout.IsCompleted -or -not $stderr.IsCompleted) {
      if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $limit) {
        try { if (-not $child.HasExited) { $child.Kill() } } catch {}
        throw "NATIVE_PHASE_TIMEOUT phase=$Name"
      }
      [Threading.Thread]::Sleep(5)
    }
    $global:LASTEXITCODE = $child.ExitCode
    $answer = $stdout.Result
    if ($child.ExitCode -ne 0 -and -not $AllowFailure) { throw "NATIVE_CHILD_FAILED phase=$Name exit=$($child.ExitCode) $($stderr.Result)" }
    Complete-Phase
    return $answer
  } finally { $child.Dispose() }
}
function Finish-Outcome([bool]$Failed) {
  if ($script:heldCount -gt 0) { $script:releaseUncertain = $true }
  $outcome = @{ runId = $RunId; status = $(if ($Failed) { "failed" } else { "completed" });
    phase = $(if ($script:failedPhase) { $script:failedPhase } else { $script:phase });
    step = $script:currentStep; op = $script:currentOp; completedSteps = $script:completedSteps;
    elapsedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $script:startedMs;
    inputOutcome = $(if ($script:releaseUncertain) { "unknown" } elseif ($script:inputTouched) { "partial" } else { "none" });
    heldInput = $(if ($script:releaseUncertain) { "uncertain" } else { "released" }); cleanup = $script:cleanupState }
  L ("OUTCOME " + ($outcome | ConvertTo-Json -Compress))
  [IO.File]::WriteAllText("$Out.result.tmp", ($outcome | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath "$Out.result.tmp" -Destination "$Out.result.json" -Force
}
Write-Progress
