# Purpose: run one command inside the logged-in user's interactive desktop session by
# registering a one-off scheduled task, starting it, waiting for it to finish and
# UNREGISTERING it again (try/finally), so no task is left on the user's machine.
# SSH sessions have no desktop, so screenshots, UI Automation, input and window
# messages only work from here.
# Exit: 124 when the task was stopped at the timeout; otherwise the task's own result
# (LastTaskResult), 0 when it succeeded. A result outside 0-125 exits 1 and prints the number: ssh
# keeps only 8 bits, and 255 would read as a lost connection on the Mac.
# Notes: the parameter cannot be called $Args (PowerShell automatic variable); the
# principal must be the resolved identity name ($env:USERDOMAIN\$env:USERNAME fails over SSH).
param([string]$Name, [string]$Exe, [string]$Arguments, [int]$TimeoutSec = 120)
if ($Name -notmatch '^mdpro-audit-[a-z0-9-]+$') { throw "task name must match mdpro-audit-*: $Name" }
$a = New-ScheduledTaskAction -Execute $Exe -Argument $Arguments
$p = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $Name -Action $a -Principal $p -Force | Out-Null
$code = 0
try {
  Start-ScheduledTask -TaskName $Name
  $t0 = Get-Date
  do { Start-Sleep -Milliseconds 300; $state = (Get-ScheduledTask -TaskName $Name).State }
  while ($state -eq "Running" -and ((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec)
  if ($state -eq "Running") { Stop-ScheduledTask -TaskName $Name; "runi: $Name stopped after $TimeoutSec s"; $code = 124 }
  else {
    $code = [int64](Get-ScheduledTaskInfo -TaskName $Name).LastTaskResult
    if ($code -lt 0 -or $code -gt 125) { "runi: $Name result $code"; $code = 1 }
  }
} finally {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}
exit $code
