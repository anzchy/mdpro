# Purpose: called over SSH. Writes the base64 step list, runs ui.cmd once in the interactive
# desktop session (runi.ps1: one-off task, waited for, then unregistered) and prints
# ui-out.json base64-encoded (the SSH console is code page 936, so raw UTF-8 would be mangled).
# steps.json and ui-out.json are deleted afterwards, so nothing can replay them.
param([string]$StepsB64, [int]$TimeoutSec = 90)
$d = $PSScriptRoot
try {
  [IO.File]::WriteAllBytes("$d\steps.json", [Convert]::FromBase64String($StepsB64))
  Remove-Item "$d\ui-out.json" -ErrorAction SilentlyContinue
  & "$d\runi.ps1" -Name mdpro-audit-ui -Exe cmd.exe -Arguments "/c `"$d\ui.cmd`"" -TimeoutSec $TimeoutSec | Out-Null
  if (Test-Path "$d\ui-out.json") { [Convert]::ToBase64String([IO.File]::ReadAllBytes("$d\ui-out.json")) }
  else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["TIMEOUT: no ui-out.json after ' + $TimeoutSec + ' s"]')) }
} finally {
  Remove-Item "$d\steps.json", "$d\ui-out.json" -ErrorAction SilentlyContinue
}
