# Purpose: bounded filtered (Administrators deny-only) same-user open diagnostic; not a restricted token.
# Require an elevated creator; rooted runas and File bound the program below 1024 characters.
# Tester only: no Scheduler or desktop input. Validate the eight-field reply, then clean owned resources.
param($PhaseMs = "5000", $PollMs = "25")
$ErrorActionPreference = "Stop"
$rc = 1; $scope = $null; $child = $null; $replyPath = $null; $scriptPath = $null
try {
  . "$PSScriptRoot\native-validation.ps1"
  $PhaseMs = Read-NativeInteger $PhaseMs 10 5000; $PollMs = Read-NativeInteger $PollMs 1 1000
  . "$PSScriptRoot\native-job.ps1"
  $creatorElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $creatorElevated) { throw "creator-not-elevated" }
  $nonce = [guid]::NewGuid().ToString("N")
  $jobName = "Global\mdpro-driver-$nonce"
  $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $replyPath = Join-Path ([IO.Path]::GetTempPath()) ("mdpro-cross-token-$nonce.json")
  $scriptPath = [IO.Path]::ChangeExtension($replyPath, ".ps1")
  $scope = New-Object NativeJobScope ($jobName, $false)
  "OK job-created"
  $body = @'
param([string]$ReplyPath, [string]$Nonce, [string]$JobName, [string]$ExpectedUserSid, [string]$Loader)
$ErrorActionPreference = "Stop"
. $Loader
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RestrictedTokenProbe { [DllImport("advapi32.dll")] public static extern bool IsTokenRestricted(IntPtr token); }'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$process = [Diagnostics.Process]::GetCurrentProcess(); $handle = [IntPtr]::Zero
try {
  $restricted = [RestrictedTokenProbe]::IsTokenRestricted($identity.Token)
  $principal = New-Object Security.Principal.WindowsPrincipal $identity
  $adminEnabled = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $flags = [Reflection.BindingFlags]"NonPublic,Static"
  $handle = [IntPtr][NativeJobScope].GetMethod("OpenJobObject", $flags).Invoke($null, [object[]]@([uint32]5, $false, $JobName))
  @{ nonce = $Nonce; job = $JobName; userSid = $identity.User.Value; restricted = $restricted;
     adminEnabled = $adminEnabled; opened = ($handle -ne [IntPtr]::Zero); pid = $process.Id;
     birth = $process.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress |
     Set-Content -LiteralPath $ReplyPath -Encoding UTF8
} finally {
  if ($handle -ne [IntPtr]::Zero) { [void][NativeJobScope].GetMethod("CloseHandle", [Reflection.BindingFlags]"NonPublic,Static").Invoke($null, [object[]]@($handle)) }
  $process.Dispose(); $identity.Dispose()
}
'@
  $body | Set-Content -LiteralPath $scriptPath -Encoding UTF8
  function Quote-Probe([string]$Value) { return '\"' + $Value + '\"' }
  $runas = Join-Path $env:SystemRoot 'System32\runas.exe'
  if (-not (Test-Path -LiteralPath $runas -PathType Leaf)) { throw "runas-missing $runas" }
  $engine = Join-Path $PSHOME "powershell.exe"
  $program = (Quote-Probe $engine) + ' -NoProfile -ExecutionPolicy Bypass -File ' + (Quote-Probe $scriptPath) +
    ' -ReplyPath ' + (Quote-Probe $replyPath) + ' -Nonce ' + (Quote-Probe $nonce) +
    ' -JobName ' + (Quote-Probe $jobName) + ' -ExpectedUserSid ' + (Quote-Probe $userSid) +
    ' -Loader ' + (Quote-Probe (Join-Path $PSScriptRoot "native-job.ps1"))
  if ($program.Length -ge 1024) { throw "program-too-long length=$($program.Length)" }
  $arguments = '/trustlevel:0x20000 "' + $program + '"'
  $child = $scope.StartOwned($runas, $arguments)
  "OK child-started"
  $end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $PhaseMs
  while (-not (Test-Path -LiteralPath $replyPath)) {
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $end) { throw "reply-timeout" }
    [Threading.Thread]::Sleep($PollMs)
  }
  $reply = Get-Content -LiteralPath $replyPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $diagnostic = $reply | Select-Object nonce, job, userSid, restricted, adminEnabled, opened, pid, birth | ConvertTo-Json -Compress
  $pidValue = 0
  if ($reply.nonce -cne $nonce -or $reply.job -cne $jobName -or $reply.userSid -cne $userSid -or
      $reply.restricted -isnot [bool] -or $reply.restricted -or $reply.adminEnabled -isnot [bool] -or $reply.adminEnabled -or
      $reply.opened -isnot [bool] -or -not $reply.opened -or [string]$reply.pid -cnotmatch '^[1-9][0-9]*$' -or
      -not [int]::TryParse([string]$reply.pid, [ref]$pidValue) -or [string]$reply.birth -cnotmatch '^[1-9][0-9]*$') {
    throw "filtered-reply-invalid $diagnostic"
  }
  "OK filtered-open $diagnostic"; $rc = 0
} catch { "FAIL filtered-open $($_.Exception.GetBaseException().Message)"; $rc = 1 }
finally {
  try {
    if ($scope) {
      $scope.Stop()
      $end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $PhaseMs
      while (@($scope.Snapshot()).Count -ne 0) {
        if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $end) { throw "owned-child-remains" }
        [Threading.Thread]::Sleep($PollMs)
      }
    }
    "OK cleanup"
  } catch { "FAIL cleanup $($_.Exception.GetBaseException().Message)"; $rc = 1 }
  finally {
    if ($replyPath -and (Test-Path -LiteralPath $replyPath)) { Remove-Item -LiteralPath $replyPath -Force }
    if ($scriptPath -and (Test-Path -LiteralPath $scriptPath)) { Remove-Item -LiteralPath $scriptPath -Force }
    if ($child) { $child.Dispose() }
    if ($scope) { $scope.Dispose() }
  }
}
exit $rc
