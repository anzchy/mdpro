@echo off
rem Start mdpro with the WebView2 DevTools port on 127.0.0.1:9222 (testing only).
rem MDPRO_EXE overrides the install path.
if "%MDPRO_EXE%"=="" set MDPRO_EXE=D:\programs\mdpro\tauri-app.exe
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222
start "" "%MDPRO_EXE%"
