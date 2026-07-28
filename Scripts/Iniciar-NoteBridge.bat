@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ObsidianNoteBridge.ps1" -DebugConsole
if errorlevel 1 (
  echo.
  echo A ponte terminou com erro.
  pause
  exit /b 1
)

echo.
echo Ponte iniciada. Use .\Scripts\Enviar-NoteBridge-Quest.bat para preencher o Quest.
pause
