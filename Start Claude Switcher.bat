@echo off
title Session Switcher
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Session Switcher needs Node.js. Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
echo Starting Session Switcher. This window shows its log; closing it stops the app.
echo For everyday use, double-click "Claude Switcher.vbs" instead (no console window).
echo.
node server.js
pause
