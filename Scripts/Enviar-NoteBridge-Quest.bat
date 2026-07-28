@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Enviar-NoteBridge-Quest.ps1" %*
if errorlevel 1 (
  echo.
  echo O envio terminou com erro.
  pause
  exit /b 1
)

pause
