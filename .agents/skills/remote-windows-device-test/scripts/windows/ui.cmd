@echo off
rem Per-run artifacts and absolute deadline; never consume a shared steps file.
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0ui.ps1" -Steps "%~1\steps.json" -Out "%~1\ui-out.json" -RunId %2 -DeadlineMs %3 -PhaseMs %4 -CleanupMs %5
exit /b %errorlevel%
