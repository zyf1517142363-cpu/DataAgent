@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PYTHON_EXE=%PROJECT_DIR%.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
  set "PYTHON_EXE=python"
)

echo Starting AI media analysis system...
echo Project directory: %PROJECT_DIR%
echo.

echo Opening backend and frontend terminal windows...
start "AI Analysis Backend" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%PROJECT_DIR%'; & '%PYTHON_EXE%' -m uvicorn app:app --reload --host 0.0.0.0 --port 8000"
start "AI Analysis Frontend" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%PROJECT_DIR%'; npm run dev"

echo Waiting for the frontend dev server...
timeout /t 8 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'http://localhost:5173/'"

echo.
echo If the browser did not open automatically, visit:
echo http://localhost:5173/
echo.
echo You can close this window. Keep the backend and frontend windows running.
timeout /t 5 /nobreak >nul

endlocal
