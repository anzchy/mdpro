@echo off
rem WI-E2E-W demo: start mdpro with APPDATA pointed elsewhere (config-isolation [推断] 2).
set APPDATA=C:\Users\jack\mdpro-audit\fakeappdata
if "%MDPRO_EXE%"=="" set MDPRO_EXE=D:\programs\mdpro\tauri-app.exe
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
start "" "%MDPRO_EXE%"
