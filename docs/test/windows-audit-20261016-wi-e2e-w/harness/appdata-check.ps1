"procs " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count
"real %APPDATA%\mdpro:"; Get-ChildItem "$env:APPDATA\mdpro" -Recurse -Force | % { "  " + $_.Name + " " + $_.LastWriteTime.ToString("MM-dd HH:mm:ss") }
"fake dir:"; Get-ChildItem "$env:USERPROFILE\mdpro-audit\fakeappdata" -Recurse -Force | % { "  " + $_.FullName.Substring(($env:USERPROFILE + "\mdpro-audit\fakeappdata").Length) + " " + $_.LastWriteTime.ToString("MM-dd HH:mm:ss") }
"fake count " + @(Get-ChildItem "$env:USERPROFILE\mdpro-audit\fakeappdata" -Recurse -Force).Count
$p = Get-CimInstance Win32_Process -Filter "Name='tauri-app.exe'" | Select-Object -First 1; "pid " + $p.ProcessId + " started " + $p.CreationDate.ToString("HH:mm:ss")
