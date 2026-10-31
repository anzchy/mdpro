# Purpose: check bootstrap loading, type resolution and step parsing without desktop activity.
# This probe never constructs a job, starts a task or invokes a native input operation.
$ErrorActionPreference = "Stop"
$loaded = $false
try {
  . "$PSScriptRoot\native-job.ps1"
  $loaded = $true
  "OK bootstrap-load"
} catch {
  "FAIL bootstrap-load " + ($_.Exception.Message -replace '[\r\n]+', ' ')
}
if ($loaded) {
  try {
    $nativeType = 'NativeJobScope' -as [type]
    if ($null -eq $nativeType) { throw "NativeJobScope unresolved" }
    "OK type-resolution"
  } catch {
    "FAIL type-resolution " + ($_.Exception.Message -replace '[\r\n]+', ' ')
  }
} else {
  "FAIL type-resolution bootstrap-load failed"
}
try {
  . "$PSScriptRoot\native-validation.ps1"
  $raw = '[{"op":"max"},{"op":"wait","ms":500},{"op":"windows"}]'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
  $bytes = Read-NativeSteps $encoded
  if ([Text.Encoding]::UTF8.GetString($bytes) -cne $raw) { throw "UI_STEPS_INVALID" }
  "OK steps-json"
} catch {
  "FAIL steps-json " + ($_.Exception.Message -replace '[\r\n]+', ' ')
}
