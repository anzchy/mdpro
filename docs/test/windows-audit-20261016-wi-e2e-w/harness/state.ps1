$c = "$env:USERPROFILE\.mdpro\config.json"
"procs " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count
"config " + (Get-FileHash $c -Algorithm SHA256).Hash.Substring(0,16) + " " + (Get-Item $c).Length + " " + (Get-Item $c).LastWriteTime.ToString("HH:mm:ss.fff")
$l = Get-Item "$env:USERPROFILE\.mdpro\mdpro.log"; "log " + $l.Length + " created " + $l.CreationTimeUtc.Ticks
"dot-mdpro:"; Get-ChildItem "$env:USERPROFILE\.mdpro" -Recurse -File | ? { $_.Name -ne 'mdpro.log' } | % { "  " + $_.FullName.Substring($env:USERPROFILE.Length) + " " + $_.Length + " " + $_.LastWriteTime.ToString("MM-dd HH:mm:ss") }
"appdata-mdpro:"; Get-ChildItem "$env:APPDATA\mdpro" -Recurse -File -ErrorAction SilentlyContinue | % { "  " + $_.FullName.Substring($env:APPDATA.Length) + " " + $_.Length + " " + $_.LastWriteTime.ToString("MM-dd HH:mm:ss") }
"tasks: " + (@(Get-ScheduledTask -TaskName "mdpro-audit-*" -ErrorAction SilentlyContinue).Count)
