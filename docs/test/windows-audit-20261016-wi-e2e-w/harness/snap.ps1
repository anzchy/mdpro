for ($i=0; $i -lt 20 -and @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
"procs " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count
if (@(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0) { "NOT CLOSED, no snapshot"; exit 1 }
$s = "$env:USERPROFILE\mdpro-audit\snap\e2e-20261016-1"
if (Test-Path $s) { "snapshot dir exists, refusing"; exit 1 }
robocopy "$env:USERPROFILE\.mdpro" "$s\dot-mdpro" /E /COPY:DAT /R:0 /W:0 /XF mdpro.log /NJH /NP | Out-Null; "robocopy dot-mdpro " + $LASTEXITCODE
robocopy "$env:APPDATA\mdpro" "$s\appdata-mdpro" /E /COPY:DAT /R:0 /W:0 /NJH /NP | Out-Null; "robocopy appdata-mdpro " + $LASTEXITCODE
Get-ChildItem $s -Recurse -File | % { "  " + $_.FullName.Substring($s.Length) + " " + $_.Length }
"config hash " + (Get-FileHash "$env:USERPROFILE\.mdpro\config.json").Hash.Substring(0,16) + " snap " + (Get-FileHash "$s\dot-mdpro\config.json").Hash.Substring(0,16)
