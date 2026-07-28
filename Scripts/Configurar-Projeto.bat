@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurar-Projeto.ps1" %*
if errorlevel 1 (
  echo.
  echo A configuracao terminou com erro.
  pause
  exit /b 1
)

echo.
echo Configuracao concluida.
pause
