@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0.."
set "SITE_DIR=%PROJECT_ROOT%\sites-space-ar"
set "SITE_PORT=3001"
set "ZROK_NAME=public:space-ar"
set "ZROK_HOST=space-ar.shares.zrok.io"

where npm >nul 2>&1 || (
  echo ERRO: npm nao foi encontrado no PATH.
  pause
  exit /b 1
)
where zrok2 >nul 2>&1 || (
  echo ERRO: zrok2 nao foi encontrado no PATH.
  pause
  exit /b 1
)
if not exist "%SITE_DIR%\package.json" (
  echo ERRO: site nao encontrado em "%SITE_DIR%".
  pause
  exit /b 1
)

call :PortaAtiva
if errorlevel 1 (
  echo Inicializando o site na porta %SITE_PORT%...
  start "Obsidian AR - Site" /D "%PROJECT_ROOT%" cmd /k "npm run dev --prefix .\sites-space-ar -- --port %SITE_PORT% --strictPort"
  echo Aguardando o servidor ficar disponivel...
  for /L %%I in (1,1,45) do (
    timeout /t 1 /nobreak >nul
    call :PortaAtiva
    if not errorlevel 1 goto SitePronto
  )
  echo ERRO: o site nao respondeu na porta %SITE_PORT% em 45 segundos.
  pause
  exit /b 1
) else (
  echo O site ja esta ativo na porta %SITE_PORT%.
)

:SitePronto
set "EXISTING_SHARE="
for /f "usebackq delims=" %%T in (`powershell.exe -NoLogo -NoProfile -Command "$raw = [string]::Join([Environment]::NewLine, @([string[]](& zrok2 list shares --json 2^>$null))); if ($LASTEXITCODE -eq 0 -and $raw) { $data = ConvertFrom-Json -InputObject $raw; foreach ($share in @($data.shares)) { if (@($share.frontendEndpoints) -contains '%ZROK_HOST%') { $share.shareToken; break } } }"`) do set "EXISTING_SHARE=%%T"

if defined EXISTING_SHARE (
  echo O endereco https://%ZROK_HOST%/ ja esta associado ao share %EXISTING_SHARE%.
  choice /C RN /N /M "[R] Reutilizar o share existente ou [N] encerrar e iniciar novamente? "
  if errorlevel 2 (
    echo Encerrando somente o share %EXISTING_SHARE%...
    zrok2 delete share %EXISTING_SHARE%
    if errorlevel 1 (
      echo ERRO: nao foi possivel encerrar o share antigo.
      pause
      exit /b 1
    )
    timeout /t 2 /nobreak >nul
  ) else (
    echo Share reutilizado: https://%ZROK_HOST%/
    pause
    exit /b 0
  )
)

echo Inicializando o servidor zrok...
echo Endereco local: http://localhost:%SITE_PORT%
zrok2 share public http://localhost:%SITE_PORT% -n %ZROK_NAME%
if errorlevel 1 (
  echo.
  echo O zrok terminou com erro.
  pause
  exit /b 1
)
exit /b 0

:PortaAtiva
powershell.exe -NoLogo -NoProfile -Command "try { $c = [Net.Sockets.TcpClient]::new(); $c.Connect('127.0.0.1', %SITE_PORT%); $c.Dispose(); exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%