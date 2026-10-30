# Purpose: compile the job bootstrap BEFORE any UI transaction, binding binary to source hashes.
# Called by deploy; compilation is deliberately outside the bounded desktop transaction.
$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "native-job.cs"
$binary = Join-Path $PSScriptRoot "native-job.exe"
$temp = Join-Path $PSScriptRoot ("native-job-" + [guid]::NewGuid().ToString("N") + ".exe")
try {
  Add-Type -Path $source -OutputAssembly $temp -OutputType ConsoleApplication
  Move-Item -LiteralPath $temp -Destination $binary -Force
  @{ source = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash;
     binary = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $PSScriptRoot "native-job-build.json") -Encoding UTF8
} finally { Remove-Item -LiteralPath $temp -ErrorAction SilentlyContinue }
