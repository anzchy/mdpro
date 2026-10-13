#!/bin/bash
# mdpro.sh debug    close mdpro gracefully (WM_CLOSE: its own unsaved prompt runs), restart it in the
#                   desktop session with the WebView2 DevTools port 127.0.0.1:9222, maximize, check width
# mdpro.sh normal   same, but restart without the port (end of a run)
# mdpro.sh status   process count, port 9222 owner, page list
# mdpro.sh cleanup  remove the mdpro-audit-* scheduled tasks
# Say so to the user before debug/normal: it restarts THEIR running mdpro.
source "$(dirname "$0")/common.sh"
D="$(dirname "$0")"
runi() { win "powershell -NoProfile -ExecutionPolicy Bypass -File '$WIN_DIR\\runi.ps1' -Name $1 -Exe $2 -Arguments \"$3\""; }
case "$1" in
  debug|normal)
    runi mdpro-audit-close powershell.exe "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $WIN_DIR\\close.ps1"
    left=$(win 'for ($i=0; $i -lt 20 -and @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }; @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count' | tr -d '\r\n ')
    if [ "$left" != 0 ]; then echo "mdpro did not close (an unsaved-changes prompt is probably waiting on the PC); not relaunching" >&2; exit 1; fi
    [ "$1" = debug ] && cmd=launch.cmd || cmd=launch-normal.cmd
    runi "mdpro-audit-$1" cmd.exe "/c $WIN_DIR\\$cmd"
    sleep 6; "$0" status
    "$D/ui.sh" '[{"op":"max"},{"op":"wait","ms":800},{"op":"windows"}]'
    [ "$1" = debug ] && echo "page innerWidth: $("$D/cdp.sh" eval 'return innerWidth')  (expect ~1120 maximized at 270%)" ;;
  status)
    win '"tauri-app: " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count; Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue | Select-Object LocalAddress,OwningProcess | Out-String; try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:9222/json/list).Content } catch { "port 9222 closed" }' ;;
  cleanup)
    win 'Get-ScheduledTask -TaskName "mdpro-audit-*" -ErrorAction SilentlyContinue | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; "removed " + $_.TaskName }' ;;
  *) sed -n 2,7p "$0"; exit 2 ;;
esac
