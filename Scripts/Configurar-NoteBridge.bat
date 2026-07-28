@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurar-NoteBridge.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel salvar a configuracao.
  pause
  exit /b 1
)

echo.
pause
