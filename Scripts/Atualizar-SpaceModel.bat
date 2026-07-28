@echo off
setlocal
cd /d "%~dp0.."

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-SpaceModel.ps1" -Mode Build
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-SpaceModel.ps1" %*
)

if errorlevel 1 (
  echo.
  echo A atualizacao terminou com erro.
) else (
  echo.
  echo Pipeline concluido com sucesso.
)
pause
