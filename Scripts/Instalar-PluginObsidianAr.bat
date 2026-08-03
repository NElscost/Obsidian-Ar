@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-PluginObsidianAr.ps1" %*
if errorlevel 1 (
  echo.
  echo A instalacao do plugin terminou com erro.
  pause
  exit /b 1
)
echo.
echo Plugin Obsidian AR instalado.
pause
