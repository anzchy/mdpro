# Purpose: run one command inside the logged-in user's interactive desktop session by
# registering (or replacing) a one-off scheduled task and starting it. SSH sessions have no
# desktop, so screenshots, UI Automation, input and window messages only work from here.
# Note: the parameter cannot be called $Args (PowerShell automatic variable), and the
# principal must be the resolved identity name ($env:USERDOMAIN\$env:USERNAME fails over SSH).
param([string]$Name, [string]$Exe, [string]$Arguments)
$a = New-ScheduledTaskAction -Execute $Exe -Argument $Arguments
$p = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $Name -Action $a -Principal $p -Force | Out-Null
Start-ScheduledTask -TaskName $Name
