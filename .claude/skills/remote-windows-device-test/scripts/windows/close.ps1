# Purpose: ask every mdpro window to close (WM_CLOSE via CloseMainWindow) so the app's own
# unsaved-changes prompt runs. Never Stop-Process mdpro unless the test is about a crash.
Get-Process tauri-app -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
