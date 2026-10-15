@echo off
rem Run ui.ps1 on steps.json inside the desktop session (the scheduled task calls this file).
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0ui.ps1" -Steps "%~dp0steps.json" -Out "%~dp0ui-out.json"
exit /b %errorlevel%
