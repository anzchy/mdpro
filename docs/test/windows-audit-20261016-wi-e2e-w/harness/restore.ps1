for ($i=0; $i -lt 20 -and @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
"procs " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count
if (@(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0) { "NOT CLOSED, no restore"; exit 1 }
$s = "$env:USERPROFILE\mdpro-audit\snap\e2e-20261016-1"; $log = "$env:USERPROFILE\.mdpro\mdpro.log"
function L { $i = Get-Item $log; "log size " + $i.Length + " created " + $i.CreationTimeUtc.Ticks + " written " + $i.LastWriteTime.ToString("HH:mm:ss.fff") + " sha " + (Get-FileHash $log).Hash.Substring(0,16) }
"before restore:"; L
"config before restore " + (Get-FileHash "$env:USERPROFILE\.mdpro\config.json").Hash.Substring(0,16)
"appdata before restore:"; Get-ChildItem "$env:APPDATA\mdpro" -Recurse -Force | % { "  " + $_.FullName.Substring($env:APPDATA.Length) }
robocopy "$s\dot-mdpro" "$env:USERPROFILE\.mdpro" /MIR /COPY:DAT /R:0 /W:0 /XF mdpro.log /NJH /NP | Out-String | % { $_.Trim() }; "robocopy dot-mdpro exit " + $LASTEXITCODE
robocopy "$s\appdata-mdpro" "$env:APPDATA\mdpro" /MIR /COPY:DAT /R:0 /W:0 /NJH /NP | Out-Null; "robocopy appdata-mdpro exit " + $LASTEXITCODE
"after restore:"; L
"config after " + (Get-FileHash "$env:USERPROFILE\.mdpro\config.json").Hash.Substring(0,16) + " snapshot " + (Get-FileHash "$s\dot-mdpro\config.json").Hash.Substring(0,16)
"dot-mdpro now:"; Get-ChildItem "$env:USERPROFILE\.mdpro" -Force | % { "  " + $_.Name + " " + $_.Length }
"appdata now:"; Get-ChildItem "$env:APPDATA\mdpro" -Recurse -Force | % { "  " + $_.FullName.Substring($env:APPDATA.Length) }
