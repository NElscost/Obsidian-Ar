param(
  [int]$Port = 8765,
  [switch]$DebugConsole,
  [string]$SiteUrl = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$graphPath = Join-Path $workspace "graph.json"
$rustProjectPath = Join-Path $workspace "note-bridge-rs"
$serverPath = Join-Path $rustProjectPath "target\release\obsidian-note-bridge.exe"
$tokenPath = Join-Path $workspace ".note-bridge-token"
$statePath = Join-Path $workspace ".note-bridge-processes.json"
$bridgeConfigPath = Join-Path $workspace "note-bridge.config.json"
$pendingOptimizationPath = Join-Path $workspace "PendenteParaOtimização.json"
$logDir = Join-Path $workspace "note-bridge-logs"

function Stop-ExistingBridge {
  $processIds = [System.Collections.Generic.HashSet[int]]::new()
  if (Test-Path -LiteralPath $statePath) {
    try {
      $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
      foreach ($processId in @($state.serverPid, $state.tunnelPid)) {
        if ($processId) { [void]$processIds.Add([int]$processId) }
      }
    } catch {
      Write-Warning "O registro anterior da ponte estava inválido e será recriado."
    }
  }
  Get-Process -Name "obsidian-note-bridge" -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($serverPath)
      } catch {
        $false
      }
    } |
    ForEach-Object { [void]$processIds.Add($_.Id) }

  foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  if ($processIds.Count -gt 0) {
    Wait-Process -Id @($processIds) -Timeout 8 -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force
  }
  $locked = Get-Process -Name "obsidian-note-bridge" -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($serverPath)
      } catch {
        $false
      }
    }
  if ($locked) {
    throw "Uma instância antiga da ponte ainda está usando $serverPath."
  }
}

Stop-ExistingBridge

# Keep yt-dlp outside Program Files so it can update without administrator rights.
$toolsDir = Join-Path $workspace ".tools"
$localYtDlp = Join-Path $toolsDir "yt-dlp.exe"
if ($env:OS -eq "Windows_NT") {
  if (-not (Test-Path -LiteralPath $localYtDlp)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    Write-Host "Baixando yt-dlp atualizado para o projeto..."
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $localYtDlp
  } else {
    # YouTube changes frequently. A stale yt-dlp may still resolve metadata but
    # receive HTTP 403 when the media stream starts, so refresh it in place.
    Write-Host "Verificando atualização do yt-dlp..."
    & $localYtDlp --update-to stable
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Não foi possível atualizar o yt-dlp; continuando com a versão instalada."
    }
  }
  $env:Path = $toolsDir + [IO.Path]::PathSeparator + $env:Path
}

$cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflared = if ($cloudflaredCommand) {
  $cloudflaredCommand.Source
} else {
  "C:\Program Files (x86)\cloudflared\cloudflared.exe"
}
if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "cloudflared não está instalado. Instale com: winget install Cloudflare.cloudflared"
}
if (-not (Test-Path -LiteralPath $graphPath)) {
  Write-Warning "graph.json não encontrado; a ponte criará o grafo diretamente do vault."
}

$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
$cargo = if ($cargoCommand) {
  $cargoCommand.Source
} else {
  Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
}
if (-not (Test-Path -LiteralPath $cargo)) {
  throw "Rust não está instalado. Instale com: winget install Rustlang.Rustup"
}
$rustSources = @(
  (Join-Path $rustProjectPath "Cargo.toml"),
  (Join-Path $rustProjectPath "src\main.rs")
)
$needsBuild = -not (Test-Path -LiteralPath $serverPath)
if (-not $needsBuild) {
  $binaryTime = (Get-Item -LiteralPath $serverPath).LastWriteTimeUtc
  $needsBuild = @($rustSources | Where-Object {
    (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $binaryTime
  }).Count -gt 0
}
if ($needsBuild) {
  if ($env:OS -eq "Windows_NT") {
    $cmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue
    if (-not $cmakeCommand) {
      $bundledCmake = Get-ChildItem "$env:ProgramFiles\Microsoft Visual Studio" -Filter cmake.exe -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
      if ($bundledCmake) {
        $env:Path = "$(Split-Path -Parent $bundledCmake);$env:Path"
      } else {
        throw "CMake não encontrado. Instale com: winget install Kitware.CMake"
      }
    }
    if ([string]::IsNullOrWhiteSpace($env:LIBCLANG_PATH)) {
      $llvmBin = Join-Path $env:ProgramFiles "LLVM\bin"
      if (Test-Path -LiteralPath (Join-Path $llvmBin "libclang.dll")) {
        $env:LIBCLANG_PATH = $llvmBin
      } else {
        throw "LLVM/libclang não encontrado. Instale com: winget install LLVM.LLVM"
      }
    }
  }
  Write-Output "Compilando a ponte Axum otimizada..."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $cargo build --release --manifest-path (Join-Path $rustProjectPath "Cargo.toml")
    $cargoExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($cargoExitCode -ne 0 -or -not (Test-Path -LiteralPath $serverPath)) {
    throw "Não foi possível compilar a ponte Axum."
  }
}

if (-not (Test-Path -LiteralPath $bridgeConfigPath)) {
  & (Join-Path $scriptDir "Configurar-NoteBridge.ps1")
}
$bridgeConfig = Get-Content -Raw -LiteralPath $bridgeConfigPath | ConvertFrom-Json

if (-not [string]::IsNullOrWhiteSpace($SiteUrl)) {
  Write-Warning "-SiteUrl não é mais necessário: a ponte aceita qualquer visualizador HTTPS."
}
$vaultPath = [string]$bridgeConfig.vaultPath
if (
  [string]::IsNullOrWhiteSpace($vaultPath) -or
  -not [IO.Path]::IsPathRooted($vaultPath) -or
  -not (Test-Path -LiteralPath $vaultPath -PathType Container)
) {
  throw "vaultPath inválido em note-bridge.config.json. Execute .\Scripts\Configurar-NoteBridge.bat."
}
$vaultPath = [IO.Path]::GetFullPath($vaultPath)
$tunnelMode = ([string]$bridgeConfig.tunnelMode).Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($tunnelMode)) { $tunnelMode = "quick" }
if ($tunnelMode -notin @("quick", "named")) {
  throw "tunnelMode inválido em note-bridge.config.json. Use 'quick' ou 'named'."
}

$namedTunnelUrl = ""
$namedTunnelToken = ""
if ($tunnelMode -eq "named") {
  $namedTunnelUrl = ([string]$bridgeConfig.tunnelUrl).Trim().TrimEnd("/")
  $namedTunnelUri = $null
  if (
    -not [Uri]::TryCreate($namedTunnelUrl, [UriKind]::Absolute, [ref]$namedTunnelUri) -or
    $namedTunnelUri.Scheme -ne "https"
  ) {
    throw "tunnelUrl inválido. Configure o hostname HTTPS publicado pelo Named Tunnel."
  }
  $namedTunnelUrl = $namedTunnelUri.GetLeftPart([UriPartial]::Authority)
  $tunnelTokenFile = ([string]$bridgeConfig.tunnelTokenFile).Trim()
  if ([string]::IsNullOrWhiteSpace($tunnelTokenFile)) {
    $tunnelTokenFile = ".cloudflare-tunnel-token"
  }
  if (-not [IO.Path]::IsPathRooted($tunnelTokenFile)) {
    $tunnelTokenFile = Join-Path $workspace $tunnelTokenFile
  }
  if (-not (Test-Path -LiteralPath $tunnelTokenFile -PathType Leaf)) {
    throw "Token do Named Tunnel não encontrado: $tunnelTokenFile"
  }
  $namedTunnelToken = (Get-Content -Raw -LiteralPath $tunnelTokenFile).Trim()
  if ([string]::IsNullOrWhiteSpace($namedTunnelToken)) {
    throw "O arquivo do token do Named Tunnel está vazio."
  }
} else {
  Write-Warning "Quick Tunnel ativo: use tunnelMode='named' com Cloudflare Access para uso permanente."
}

$pendingNotes = Get-ChildItem -LiteralPath $vaultPath -Recurse -File -Filter "*.md" |
  Where-Object { $_.FullName -notmatch '[\\/]\.obsidian[\\/]' } |
  ForEach-Object {
    $content = [string](Get-Content -Raw -LiteralPath $_.FullName)
    $displayMath = [regex]::Matches($content, '\$\$|\\begin\{|\\\[|\\\(').Count
    $inlineMath = [regex]::Matches($content, '(?<!\\)\$(?!\$)[^\r\n$]+(?<!\\)\$').Count
    $codeBlocks = [regex]::Matches($content, '(?m)^\s*(?:```|~~~)').Count
    $score = ($displayMath * 4) + $inlineMath + ($codeBlocks * 2)
    if ($score -gt 0) {
      $relativePath = $_.FullName.Substring($vaultPath.Length).TrimStart('\', '/')
      [pscustomobject]@{
        path = $relativePath.Replace('\', '/')
        score = $score
        displayMath = $displayMath
        inlineMath = $inlineMath
        codeFences = [math]::Floor($codeBlocks / 2)
      }
    }
  } |
  Sort-Object -Property @{ Expression = "score"; Descending = $true }, path

@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  vault = $vaultPath
  notes = @($pendingNotes)
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pendingOptimizationPath -Encoding UTF8

Write-Output "Fila de otimização: $(@($pendingNotes).Count) notas em PendenteParaOtimização.json"

if (Test-Path -LiteralPath $statePath) {
  $oldState = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  foreach ($processId in @($oldState.serverPid, $oldState.tunnelPid)) {
    if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $processId -Force
    }
  }
}

$bytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($bytes)
$random.Dispose()
(-join ($bytes | ForEach-Object { $_.ToString("x2") })) |
  Set-Content -LiteralPath $tokenPath -NoNewline
$token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$serverLog = Join-Path $logDir "server.log"
$serverErrorLog = Join-Path $logDir "server-error.log"
$tunnelLog = Join-Path $logDir "tunnel.log"
$tunnelErrorLog = Join-Path $logDir "tunnel-error.log"

$serverEnvironment = @{
  SPACE_NOTE_PORT = "$Port"
  SPACE_NOTE_TOKEN = $token
  SPACE_VAULT_PATH = $vaultPath
  SPACE_PENDING_OPTIMIZATION_PATH = $pendingOptimizationPath
}
if (Test-Path -LiteralPath $graphPath) {
  $serverEnvironment.SPACE_GRAPH_PATH = $graphPath
} else {
  [Environment]::SetEnvironmentVariable("SPACE_GRAPH_PATH", $null, "Process")
}
foreach ($entry in $serverEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

$server = Start-Process -FilePath $serverPath `
  -WindowStyle Hidden -RedirectStandardOutput $serverLog `
  -RedirectStandardError $serverErrorLog -PassThru

$previousTunnelToken = [Environment]::GetEnvironmentVariable("TUNNEL_TOKEN", "Process")
try {
  if ($tunnelMode -eq "named") {
    [Environment]::SetEnvironmentVariable("TUNNEL_TOKEN", $namedTunnelToken, "Process")
    $tunnelArguments = @("tunnel", "--no-autoupdate", "run")
  } else {
    $tunnelArguments = @(
      "tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate"
    )
  }
  $tunnel = Start-Process -FilePath $cloudflared `
    -ArgumentList $tunnelArguments `
    -WindowStyle Hidden -RedirectStandardOutput $tunnelLog `
    -RedirectStandardError $tunnelErrorLog -PassThru
} finally {
  [Environment]::SetEnvironmentVariable(
    "TUNNEL_TOKEN",
    $previousTunnelToken,
    "Process"
  )
}

if ($tunnelMode -eq "named") {
  $deadline = (Get-Date).AddSeconds(30)
  $namedConnected = $false
  do {
    Start-Sleep -Milliseconds 300
    if ($tunnel.HasExited) { break }
    $log = @($tunnelLog, $tunnelErrorLog) |
      Where-Object { Test-Path -LiteralPath $_ } |
      ForEach-Object { Get-Content -Raw -LiteralPath $_ } |
      Out-String
    $namedConnected = $log -match "Registered tunnel connection"
  } until ($namedConnected -or (Get-Date) -ge $deadline)
  if (-not $namedConnected) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    throw "O Named Tunnel não conectou em 30 segundos. Consulte note-bridge-logs\tunnel-error.log."
  }
  $publishedUrl = $namedTunnelUrl
} else {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 300
    $log = @($tunnelLog, $tunnelErrorLog) |
      Where-Object { Test-Path -LiteralPath $_ } |
      ForEach-Object { Get-Content -Raw -LiteralPath $_ } |
      Out-String
    $match = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
  } until ($match.Success -or (Get-Date) -ge $deadline)

  if (-not $match.Success) {
    Stop-Process -Id $server.Id, $tunnel.Id -Force -ErrorAction SilentlyContinue
    throw "O túnel HTTPS não iniciou em 30 segundos. Consulte note-bridge-logs\tunnel.log."
  }
  $publishedUrl = $match.Value

  # O cloudflared pode anunciar o hostname antes de o DNS do Quick Tunnel
  # propagar. Só entregue a URL ao Quest depois que a rota pública responder.
  $publicDeadline = (Get-Date).AddSeconds(30)
  $publicReady = $false
  do {
    try {
      $health = Invoke-WebRequest -UseBasicParsing `
        -Uri "$publishedUrl/health" -TimeoutSec 5
      $publicReady = $health.StatusCode -eq 200
    } catch {
      Start-Sleep -Milliseconds 600
    }
  } until ($publicReady -or (Get-Date) -ge $publicDeadline)
  if (-not $publicReady) {
    Stop-Process -Id $server.Id, $tunnel.Id -Force -ErrorAction SilentlyContinue
    throw "O Quick Tunnel foi criado, mas sua URL pública não respondeu. Inicie a ponte novamente."
  }
}

$stateJson = @{
  serverPid = $server.Id
  tunnelPid = $tunnel.Id
  url = $publishedUrl
  tunnelMode = $tunnelMode
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json
[System.IO.File]::WriteAllText(
  $statePath,
  $stateJson,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Output ""
Write-Output "Ponte do Obsidian pronta."
Write-Output "URL:   $publishedUrl"
Write-Output "Token: $token"
Write-Output "Vault: $vaultPath"
if ($DebugConsole) {
  Write-Output "Debug: acompanhando cada pedido abaixo. Pressione Ctrl+C para sair da visualização."
}
Write-Output "Mantenha este computador e o Obsidian ligados."

if ($DebugConsole) {
  Write-Output ""
  Get-Content -LiteralPath $serverLog -Tail 20 -Wait
}
