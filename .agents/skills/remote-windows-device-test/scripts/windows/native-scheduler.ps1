# Purpose: isolate blocking Scheduler COM/cmdlets in a killed-and-drained control-phase process.
param([string]$Request, [string]$Result)
$ErrorActionPreference = "Stop"
$r = Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json
try {
  # Only a definite not-found proves absence (by category: the message is localized). Any other error refuses.
  function Test-NativeTask([string]$Name) {
    try { return [bool](Get-ScheduledTask -TaskName $Name -ErrorAction Stop) }
    catch { if ($_.CategoryInfo.Category -ne [Management.Automation.ErrorCategory]::ObjectNotFound) { throw }; return $false }
  }
  switch ($r.op) {
    "start" {
      $a = New-ScheduledTaskAction -Execute $r.exe -Argument $r.arguments
      $p = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $r.name -Action $a -Principal $p | Out-Null
      Start-ScheduledTask -TaskName $r.name
      $value = @{ status = "started" }
    }
    "poll" {
      $task = Get-ScheduledTask -TaskName $r.name -ErrorAction Stop
      $info = Get-ScheduledTaskInfo -TaskName $r.name -ErrorAction Stop
      $value = @{ status = [string]$task.State; result = $info.LastTaskResult }
    }
    "exists" { $value = @{ exists = (Test-NativeTask $r.name) } }
    "cleanup" {
      if (Test-NativeTask $r.name) { Stop-ScheduledTask -TaskName $r.name -ErrorAction Stop; Unregister-ScheduledTask -TaskName $r.name -Confirm:$false -ErrorAction Stop }
      if (Test-NativeTask $r.name) { throw "NATIVE_TASK_STILL_REGISTERED" }
      $value = @{ status = "removed" }
    }
    default { throw "NATIVE_SCHEDULER_OP_INVALID" }
  }
  @{ ok = $true; value = $value } | ConvertTo-Json -Compress -Depth 6 | Set-Content -LiteralPath $Result -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $Result -Encoding UTF8
  exit 1
}
