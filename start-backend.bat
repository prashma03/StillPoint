@echo off
REM Start the Stillpoint local backend (loopback only: http://127.0.0.1:8787).
REM Double-click this file, or run it from a terminal in this folder.
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 goto :nopython
python --version >nul 2>&1
if errorlevel 1 goto :nopython

if not exist .env (
  echo NOTE: no .env file found in this folder.
  echo Copy .env.example to .env and add your MODEL_API_KEY to enable AI replies.
  echo Without a key the backend answers 503 model_not_configured.
  echo.
)
echo Starting the Stillpoint backend on http://127.0.0.1:8787 ...
echo Keep this window open. Press Ctrl+C to stop the backend.
echo.
python -m backend.server
if errorlevel 1 (
  echo.
  echo The backend stopped with an error. See the message above.
)
pause
exit /b 0

:nopython
echo ERROR: no working Python interpreter was found.
echo.
echo Install Python 3.10 or newer, then run this file again:
echo   1. Download it from https://www.python.org/downloads/
echo      ^(on the first installer screen, check "Add python.exe to PATH"^), or run:
echo      winget install Python.Python.3.12
echo   2. If the Microsoft Store opens instead of Python, install real Python
echo      from python.org ^(the Store shortcut is not an interpreter^).
pause
exit /b 1
