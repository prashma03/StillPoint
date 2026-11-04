@echo off
REM Start Stillpoint frontend + backend together for local development.
REM Two windows open (one per server); close both windows to stop everything.
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 goto :nopython
python --version >nul 2>&1
if errorlevel 1 goto :nopython
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found. Install Node.js 20+ from https://nodejs.org/,
  echo then run this file again.
  pause
  exit /b 1
)

if not exist frontend\node_modules (
  echo Installing frontend dependencies (one-time setup)...
  cd frontend
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. See the message above.
    pause
    exit /b 1
  )
  cd /d "%~dp0"
)

if not exist .env (
  echo NOTE: no .env file found. AI features will report "not configured".
  echo Copy .env.example to .env and add MODEL_API_KEY to enable them.
  echo.
)

start "Stillpoint backend :8787" /D "%~dp0" python -m backend.server
start "Stillpoint frontend :5173" /D "%~dp0frontend" cmd /c npm run dev

echo Both servers are starting in separate windows.
echo Open the app at:  http://localhost:5173/
echo Backend status at: http://127.0.0.1:8787/api/status
echo.
echo If the Guide says the backend is not running, check the backend window
echo for errors. Close both windows to stop everything.
exit /b 0

:nopython
echo ERROR: no working Python interpreter was found.
echo Install Python 3.10+ from https://www.python.org/downloads/
echo ^(check "Add python.exe to PATH"^) or run: winget install Python.Python.3.12
pause
exit /b 1
