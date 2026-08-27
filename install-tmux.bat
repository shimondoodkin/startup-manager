@echo off
rem Double-clickable wrapper: PowerShell's default execution policy blocks .ps1
rem files, so run the installer with a bypass scoped to this one process.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-tmux.ps1" %*
if errorlevel 1 (
    echo.
    echo *** Install failed - see errors above ***
)
pause
