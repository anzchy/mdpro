@echo off
rem Start mdpro normally (no DevTools port) - used for cleanup at the end of a run.
if "%MDPRO_EXE%"=="" set MDPRO_EXE=D:\programs\mdpro\tauri-app.exe
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
start "" "%MDPRO_EXE%"
