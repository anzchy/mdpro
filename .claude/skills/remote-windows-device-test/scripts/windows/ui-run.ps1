# Purpose: called over SSH. Writes the base64 step list, runs ui.cmd once in the interactive
# desktop session (runi.ps1: one-off task, waited for, then unregistered) and prints
# ui-out.json base64-encoded (the SSH console is code page 936, so raw UTF-8 would be mangled).
# steps.json and ui-out.json are deleted afterwards, so nothing can replay them.
# Exit: 0 when every step ran; 1 when ui.ps1 aborted (ABORTED at step N) or failed; 124 when no
# log came back (timeout). The log is printed in every case.
param([string]$StepsB64, [int]$TimeoutSec = 90)
$d = $PSScriptRoot
$rc = 0
try {
  [IO.File]::WriteAllBytes("$d\steps.json", [Convert]::FromBase64String($StepsB64))
  Remove-Item "$d\ui-out.json" -ErrorAction SilentlyContinue
  $global:LASTEXITCODE = 0
  & "$d\runi.ps1" -Name mdpro-audit-ui -Exe cmd.exe -Arguments "/c `"$d\ui.cmd`"" -TimeoutSec $TimeoutSec | Out-Null
  $rc = $LASTEXITCODE
  if (Test-Path "$d\ui-out.json") {
    $bytes = [IO.File]::ReadAllBytes("$d\ui-out.json")
    # Backstop for a lost task result: the log itself says whether the run stopped.
    if ($rc -eq 0 -and [Text.Encoding]::UTF8.GetString($bytes) -match 'ABORTED at step') { $rc = 1 }
    [Convert]::ToBase64String($bytes)
  } else {
    $msg = if ($rc -eq 0 -or $rc -eq 124) { $rc = 124; 'TIMEOUT: no ui-out.json after ' + $TimeoutSec + ' s' } else { 'NO LOG: ui.ps1 exited ' + $rc }
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["' + $msg + '"]'))
  }
} finally {
  Remove-Item "$d\steps.json", "$d\ui-out.json" -ErrorAction SilentlyContinue
}
exit $rc
