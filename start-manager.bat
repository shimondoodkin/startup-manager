@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="--wait-open" goto :waitopen

echo === Startup Manager ===

if not exist node_modules (
    echo [1/3] Installing dependencies...
    call npm install
    if errorlevel 1 goto :fail
)

if not exist dist\server.js (
    echo [2/3] Building server...
    call npm run build:server
    if errorlevel 1 goto :fail
)

if not exist .next\BUILD_ID (
    echo [2/3] Building web UI...
    call npm run build
    if errorlevel 1 goto :fail
)

echo [3/3] Starting server...
echo.
echo   Open http://localhost:3777  (login from .env: demo / demo)
echo   Close this window to stop the manager. tmux sessions keep running.
echo.
set NODE_ENV=production
start "" /b "%~f0" --wait-open
node dist\server.js
goto :end

:waitopen
rem Open the browser only once the server answers on port 3777
for /l %%i in (1,1,60) do (
    powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('localhost',3777)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        start "" http://localhost:3777
        exit /b
    )
    timeout /t 1 /nobreak >nul
)
exit /b

:fail
echo.
echo *** FAILED - see errors above ***
pause

:end
endlocal
