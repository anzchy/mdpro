# Purpose: observe D346 bootstrap artifacts and existing job access without replay or repair.
# No task/process/job creation, compilation, UI calls, imports, latch access or persistent writes.
# SSH observations cannot prove the departed Interactive Limited task's access or worker startup.
param([string]$RunId = "b2985c578fd74fe68cbeea4b6ba36a46")
$ErrorActionPreference = "Stop"
$script:failures = 0; $script:nativeType = $null; $script:request = $null
$script:vector = $null; $script:decoded = $null; $script:command = $null
$script:openMethod = $null; $script:closeMethod = $null; $script:allAccess = 0
$script:assembly = $null; $script:parseFiles = @(); $script:entryReady = $false
$script:handles = @{ all = [IntPtr]::Zero; query = [IntPtr]::Zero }
$script:validRun = $RunId -cmatch '\A[a-f0-9]{32}\z'
$script:windows51 = $false
$binary = Join-Path $PSScriptRoot "native-job.exe"

function Check-Probe([string]$CheckLabel, [scriptblock]$Body) {
  try {
    $detail = @(& $Body) -join " "
    "OK $CheckLabel $detail" -replace '[\r\n]+', ' '
  } catch {
    $script:failures++
    "FAIL $CheckLabel $($_.Exception.GetBaseException().Message)" -replace '[\r\n]+', ' '
  }
}
function Read-BootstrapVector([string]$Text) {
  if ($Text.Length -gt 65536 -or $Text -match '[\x00-\x1F\x7F]') { throw "argument-size-or-control" }
  $match = [regex]::Match($Text, '\A(Global\\mdpro-driver-[a-f0-9]{32}) "([^"\r\n]+)" ([A-Za-z0-9+/]+={0,2})(?: "([^"\r\n]+)")?\z')
  if (-not $match.Success) { throw "expected-three-or-four-arguments job quoted-exe base64 optional-quoted-dir" }
  $dir = if ($match.Groups[4].Success) { $match.Groups[4].Value } else { $null }
  if ($dir) {
    $decoded = (New-Object Text.UTF8Encoding($false, $true)).GetString([Convert]::FromBase64String($match.Groups[3].Value))
    $command = Read-BootstrapCommand $decoded
    if ($command.dir -cne $dir -or $command.run -cne $match.Groups[1].Value.Substring($match.Groups[1].Value.Length - 32) -or
        $dir -cnotmatch ('\\runs\\' + $command.run + '\z')) { throw "bootstrap-directory-run-mismatch" }
  }
  return [pscustomobject]@{ job = $match.Groups[1].Value; exe = $match.Groups[2].Value; base64 = $match.Groups[3].Value; dir = $dir }
}
function Read-BootstrapCommand([string]$Text) {
  $pattern = '\A/c ""(?<ui>[A-Za-z]:\\[^"\r\n]+\\ui\.cmd)" "(?<dir>[A-Za-z]:\\[^"\r\n]+)" (?<run>[a-f0-9]{32}) (?<deadline>[0-9]+) (?<phase>[0-9]+) (?<cleanup>[0-9]+)"\z'
  if ($Text.Length -gt 65536 -or $Text -match '[\x00-\x1F\x7F]') { throw "command-size-or-control" }
  $match = [regex]::Match($Text, $pattern)
  if (-not $match.Success) { throw "unsupported-cmd-command-shape" }
  $fields = @{}
  foreach ($key in @("ui", "dir", "run", "deadline", "phase", "cleanup")) { $fields[$key] = $match.Groups[$key].Value }
  foreach ($key in @("deadline", "phase", "cleanup")) {
    $number = 0L
    if (-not [long]::TryParse($fields[$key], [ref]$number)) { throw "integer-overflow field=$key" }
  }
  return [pscustomobject]$fields
}

Check-Probe "run-id" {
  if (-not $script:validRun) { throw "expected-lowercase-32hex" }
  $script:runDir = Join-Path (Join-Path $PSScriptRoot "runs") $RunId
  "run=$RunId"
}
Check-Probe "host" {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
      $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw "requires-Windows-PowerShell-5.1" }
  $self = [Diagnostics.Process]::GetCurrentProcess()
  try {
    $session = $self.SessionId
    $script:windows51 = $true
    "ps=$($PSVersionTable.PSVersion) clr=$([Environment]::Version) bits=$([IntPtr]::Size * 8) session=$session"
  }
  finally { $self.Dispose() }
}
Check-Probe "bootstrap-load" {
  if (-not $script:windows51) { throw "prerequisite=host" }
  $manifest = Join-Path $PSScriptRoot "native-job-build.json"
  $source = Join-Path $PSScriptRoot "native-job.cs"
  foreach ($path in @($binary, $manifest, $source)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "missing=$path" }
  }
  $build = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $binaryHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ($binaryHash -ine [string]$build.binary -or $sourceHash -ine [string]$build.source) { throw "NATIVE_BOOTSTRAP_STALE" }
  $script:assembly = [Reflection.Assembly]::LoadFrom($binary)
  "binary=$binaryHash source=$sourceHash runtime=$($script:assembly.ImageRuntimeVersion)"
}
Check-Probe "entry-point" {
  if (-not $script:assembly) { throw "prerequisite=bootstrap-load" }
  $entry = $script:assembly.EntryPoint
  if (-not $entry -or -not $entry.IsStatic -or $entry.Name -cne "Main" -or
      $entry.ReturnType.FullName -cne "System.Int32" -or $entry.DeclaringType.FullName -cne "NativeJobScope") { throw "unexpected-entry-point" }
  $parameters = @($entry.GetParameters())
  if ($parameters.Count -ne 1 -or $parameters[0].ParameterType.FullName -cne "System.String[]") { throw "unexpected-Main-parameters" }
  $script:nativeType = $entry.DeclaringType
  $flags = [Reflection.BindingFlags]"NonPublic,Static"
  $script:openMethod = $script:nativeType.GetMethod("OpenJobObject", $flags)
  $script:closeMethod = $script:nativeType.GetMethod("CloseHandle", $flags)
  if (-not $script:openMethod -or -not $script:closeMethod) { throw "native-method-missing" }
  $openTypes = (@($script:openMethod.GetParameters()) | ForEach-Object { $_.ParameterType.FullName }) -join ","
  $closeTypes = (@($script:closeMethod.GetParameters()) | ForEach-Object { $_.ParameterType.FullName }) -join ","
  if ($openTypes -cne "System.UInt32,System.Boolean,System.String" -or $script:openMethod.ReturnType -ne [IntPtr] -or
      $closeTypes -cne "System.IntPtr" -or $script:closeMethod.ReturnType -ne [bool]) { throw "native-signature-mismatch" }
  $script:allAccess = [uint32]$script:nativeType.GetField("ALL", $flags).GetRawConstantValue()
  if ($script:allAccess -ne 0x1F003F) { throw "unexpected-ALL-mask" }
  $script:entryReady = $true
  "NativeJobScope.Main(String[])->Int32 open=0x1F003F metadata-only"
}
Check-Probe "scheduler-request" {
  if (-not $script:validRun) { throw "prerequisite=run-id" }
  $files = @(Get-ChildItem -LiteralPath $script:runDir -Filter "scheduler-*.json" -File)
  if ($files.Count -eq 0 -or $files.Count -gt 256) { throw "request-count=$($files.Count)" }
  $starts = @()
  foreach ($file in $files) {
    if ($file.Length -gt 65536) { throw "request-too-large=$($file.Name)" }
    $value = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($value.op -ceq "start") { $starts += ,$value }
  }
  if ($starts.Count -ne 1) { throw "start-request-count=$($starts.Count)" }
  $candidate = $starts[0]
  if ($candidate.name -cne "mdpro-audit-ui-$RunId" -or $candidate.exe -ine $binary -or $candidate.arguments -isnot [string]) { throw "start-request-identity" }
  $script:request = $candidate
  "count=1 exe=$($candidate.exe)"
}
Check-Probe "scheduler-arguments" {
  if (-not $script:request) { throw "prerequisite=scheduler-request" }
  $candidate = Read-BootstrapVector $script:request.arguments
  if ($candidate.job -cne "Global\mdpro-driver-$RunId") { throw "job-run-mismatch" }
  if (-not (Test-Path -LiteralPath $candidate.exe -PathType Leaf) -or $candidate.exe -ine $env:ComSpec) { throw "ComSpec-path-mismatch" }
  $script:vector = $candidate
  "argc=$(if ($candidate.dir) { 4 } else { 3 }) job=$($candidate.job) exe=$($candidate.exe) base64=$($candidate.base64)"
}
Check-Probe "decoded-command" {
  if (-not $script:vector) { throw "prerequisite=scheduler-arguments" }
  $bytes = [Convert]::FromBase64String($script:vector.base64)
  if ([Convert]::ToBase64String($bytes) -cne $script:vector.base64) { throw "noncanonical-base64" }
  $text = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes)
  $candidate = Read-BootstrapCommand $text
  $script:command = $candidate; $script:decoded = $text
  $text
}
Check-Probe "command-match" {
  if (-not $script:command) { throw "prerequisite=decoded-command" }
  $c = $script:command
  if ($c.ui -ine (Join-Path $PSScriptRoot "ui.cmd") -or $c.dir -ine $script:runDir -or $c.run -cne $RunId) { throw "worker-path-or-run-mismatch" }
  if ($RunId -ceq "b2985c578fd74fe68cbeea4b6ba36a46" -and
      ($c.deadline -cne "1793497694190" -or $c.phase -cne "5000" -or $c.cleanup -cne "5000")) { throw "historical-budget-mismatch" }
  $expected = '/c ""' + $c.ui + '" "' + $c.dir + '" ' + $RunId + ' ' + $c.deadline + ' ' + $c.phase + ' ' + $c.cleanup + '"'
  if ($expected -cne $script:decoded) { throw "command-roundtrip-mismatch" }
  "run=$RunId deadline=$($c.deadline) phase=$($c.phase) cleanup=$($c.cleanup) historical-data-not-replayed"
}
Check-Probe "worker-paths" {
  foreach ($name in @("ui.cmd", "ui.ps1", "native-platform.ps1", "native-runtime.ps1")) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "missing=$name" }
  }
  $engine = Get-Command powershell.exe -CommandType Application -ErrorAction Stop
  "engine=$($engine.Source) current-SSH-PATH-only"
}
Check-Probe "worker-inventory" {
  $script:parseFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.ps1" -File)
  if ($script:parseFiles.Count -eq 0) { throw "no-worker-scripts" }
  "files=$($script:parseFiles.Count)"
}
foreach ($file in @($script:parseFiles)) {
  Check-Probe ("worker-parse:" + $file.Name) {
    $tokens = $null; $parseErrors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    if (@($parseErrors).Count -gt 0) { throw (($parseErrors | ForEach-Object { $_.Message }) -join "; ") }
    "errors=0 parse-only"
  }
}
foreach ($name in @("UIAutomationClient", "UIAutomationTypes", "System.Windows.Forms", "System.Drawing")) {
  Check-Probe ("assembly:" + $name) {
    if (-not $script:windows51) { throw "prerequisite=host" }
    $loaded = [Reflection.Assembly]::LoadWithPartialName($name)
    if (-not $loaded -or $loaded.GetName().Name -cne $name) { throw "assembly-unresolved=$name" }
    $loaded.FullName
  }
}
try {
  foreach ($label in @("all", "query")) {
    Check-Probe ("job-open:" + $label) {
      if (-not $script:validRun) { throw "prerequisite=run-id" }
      if (-not $script:windows51 -or -not $script:entryReady) { throw "prerequisite=entry-point/host" }
      $access = if ($label -ceq "all") { [uint32]$script:allAccess } else { [uint32]4 }
      $handle = [IntPtr]$script:openMethod.Invoke($null, [object[]]@($access, $false, "Global\mdpro-driver-$RunId"))
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $script:handles[$label] = $handle
      if ($handle -eq [IntPtr]::Zero) {
        $meaning = if ($errorCode -eq 2) { "object-absent-now cleaned-original-expected historical-denial-unproved" } elseif ($errorCode -eq 5) { "current-SSH-token-denied historical-token-unproved" } else { "open-failed-current-SSH-token" }
        throw "win32=$errorCode $meaning"
      }
      "opened-current-SSH-token-only access=$access interactive-token-NOT-EXERCISED"
    }
  }
} finally {
  foreach ($label in @("all", "query")) {
    Check-Probe ("job-close:" + $label) {
      $handle = $script:handles[$label]
      if ($handle -eq [IntPtr]::Zero) { throw "prerequisite=job-open:$label no-handle-acquired" }
      $closed = [bool]$script:closeMethod.Invoke($null, [object[]]@($handle))
      # The existing CloseHandle declaration has no SetLastError=true; its error cache is stale.
      if (-not $closed) { throw "CloseHandle-failed win32=unavailable(SetLastError-not-enabled)" }
      $script:handles[$label] = [IntPtr]::Zero
      "closed-probe-owned-handle"
    }
  }
}
Check-Probe "observation-scope" { "read-only SSH-only; no task/self-assignment/child/worker/native-input/journal-write exercised; no historical-root-cause or smoke PASS" }
if ($script:failures -gt 0) { exit 1 }
exit 0
