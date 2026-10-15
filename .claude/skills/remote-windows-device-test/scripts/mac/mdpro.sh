#!/bin/bash
# mdpro.sh debug --yes    close mdpro (WM_CLOSE) and restart it in the desktop session with the WebView2
#                         DevTools port 127.0.0.1:9222, maximize, check the page width
# mdpro.sh normal --yes   same, but restart without the port (end of a run)
# mdpro.sh status         process count, port 9222 owner, page list
# mdpro.sh cleanup        remove any mdpro-audit-* scheduled task (backstop; runi.ps1 removes its own)
# --yes is required for debug/normal: they restart the user's running mdpro. Pass it only after the
# user has confirmed that nothing in mdpro is unsaved (the window-close prompt is not verified with
# dirty documents on 0.3.1, and Exit there skips the quit guard).
source "$(dirname "$0")/common.sh"
D="$(dirname "$0")"
runi() {  # runi <name> <exe> <args> — args built only from constants and the validated WIN_DIR. A mutation (win)
  win "powershell -NoProfile -ExecutionPolicy Bypass -File '$WD\\runi.ps1' -Name '$(psq "$1")' -Exe '$(psq "$2")' -Arguments '$(psq "$3")'"
}
case "$1" in
  debug|normal)
    [ "$2" = "--yes" ] || { echo "refusing: restarting the user's mdpro needs --yes, after they confirm nothing is unsaved" >&2; exit 2; }
    trap '"$0" cleanup >/dev/null 2>&1' EXIT
    # Stop if a step fails or its outcome is unknown (exit 3): never relaunch over a close that may not have run.
    runi mdpro-audit-close powershell.exe "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"$WIN_DIR\\close.ps1\"" || exit $?
    left=$(win_read 'for ($i=0; $i -lt 20 -and @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }; @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count' | tr -d '\r\n ')
    if [ "$left" != 0 ]; then echo "mdpro did not close (an unsaved-changes prompt is probably waiting on the PC); not relaunching" >&2; exit 1; fi
    [ "$1" = debug ] && cmd=launch.cmd || cmd=launch-normal.cmd
    runi "mdpro-audit-$1" cmd.exe "/c \"$WIN_DIR\\$cmd\"" || exit $?
    sleep 4; "$0" status
    "$D/ui.sh" '[{"op":"max"},{"op":"wait","ms":800},{"op":"windows"}]'
    [ "$1" = debug ] && echo "page innerWidth: $("$D/cdp.sh" eval 'return innerWidth')  (expect ~1120 maximized at 270%)" ;;
  status)
    win_read '"tauri-app: " + @(Get-Process tauri-app -ErrorAction SilentlyContinue).Count; Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue | Select-Object LocalAddress,OwningProcess | Out-String; try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:9222/json/list).Content } catch { "port 9222 closed" }' ;;
  cleanup)
    win_read 'Get-ScheduledTask -TaskName "mdpro-audit-*" -ErrorAction SilentlyContinue | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; "removed " + $_.TaskName }' ;;
  *) sed -n 2,9p "$0"; exit 2 ;;
esac
