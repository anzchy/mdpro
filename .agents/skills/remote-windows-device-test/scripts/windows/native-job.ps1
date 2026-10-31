# Purpose: load only the precompiled, hash-bound kernel-job bootstrap. Never compile during input.
# Reflection loads the executable assembly on Windows PowerShell 5.1 and PowerShell 7.
$nativeBinary = Join-Path $PSScriptRoot "native-job.exe"
$nativeManifest = Join-Path $PSScriptRoot "native-job-build.json"
if (-not (Test-Path -LiteralPath $nativeBinary) -or -not (Test-Path -LiteralPath $nativeManifest)) { throw "NATIVE_BOOTSTRAP_MISSING: run native-build.ps1 before input" }
$build = Get-Content -LiteralPath $nativeManifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $nativeBinary -Algorithm SHA256).Hash -cne $build.binary -or
    (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot "native-job.cs") -Algorithm SHA256).Hash -cne $build.source) { throw "NATIVE_BOOTSTRAP_STALE" }
[void][System.Reflection.Assembly]::LoadFrom($nativeBinary)
