# Purpose: called over SSH. Writes the base64 step list, runs ui.cmd in the interactive
# desktop session through the one-off task "mdpro-audit-ui", waits for ui-out.json and
# prints it base64-encoded (the SSH console is code page 936, so raw UTF-8 would be mangled).
# A run still in progress is stopped first, so a stale ui-out.json is never returned as this
# run's result.
param([string]$StepsB64, [int]$TimeoutSec = 90)
$d = $PSScriptRoot
$task = Get-ScheduledTask -TaskName mdpro-audit-ui -ErrorAction SilentlyContinue
if ($task -and $task.State -eq "Running") { Stop-ScheduledTask -TaskName mdpro-audit-ui; Start-Sleep -Milliseconds 500 }
[IO.File]::WriteAllBytes("$d\steps.json", [Convert]::FromBase64String($StepsB64))
Remove-Item "$d\ui-out.json" -ErrorAction SilentlyContinue
if (-not $task) { & "$d\runi.ps1" -Name mdpro-audit-ui -Exe cmd.exe -Arguments "/c `"$d\ui.cmd`"" }
else { Start-ScheduledTask -TaskName mdpro-audit-ui }
$t0 = Get-Date
while (-not (Test-Path "$d\ui-out.json") -and ((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) { Start-Sleep -Milliseconds 300 }
Start-Sleep -Milliseconds 200
if (Test-Path "$d\ui-out.json") { [Convert]::ToBase64String([IO.File]::ReadAllBytes("$d\ui-out.json")) }
else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["TIMEOUT: no ui-out.json after ' + $TimeoutSec + ' s"]')) }
