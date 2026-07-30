@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Confirmar-PonteAnterior.ps1"
if errorlevel 2 (
  echo.
  echo Inicializacao cancelada. A ponte anterior continua ativa.
  pause
  exit /b 2
)
if errorlevel 1 (
  echo.
  echo Nao foi possivel verificar ou encerrar a ponte anterior.
  pause
  exit /b 1
)

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
