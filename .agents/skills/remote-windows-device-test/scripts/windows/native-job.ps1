# Purpose: load only the precompiled, hash-bound kernel-job bootstrap. Never compile during input.
$nativeBinary = Join-Path $PSScriptRoot "native-job.exe"
$nativeManifest = Join-Path $PSScriptRoot "native-job-build.json"
if (-not (Test-Path -LiteralPath $nativeBinary) -or -not (Test-Path -LiteralPath $nativeManifest)) { throw "NATIVE_BOOTSTRAP_MISSING: run native-build.ps1 before input" }
$build = Get-Content -LiteralPath $nativeManifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $nativeBinary -Algorithm SHA256).Hash -cne $build.binary -or
    (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot "native-job.cs") -Algorithm SHA256).Hash -cne $build.source) { throw "NATIVE_BOOTSTRAP_STALE" }
Add-Type -Path $nativeBinary
