param(
  [int]$Port = 8765,
  [switch]$DebugConsole
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
$projectConfigPath = Join-Path $workspace "space-ar.config.json"
$pendingOptimizationPath = Join-Path $workspace "PendenteParaOtimização.json"
$logDir = Join-Path $workspace "note-bridge-logs"
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
  throw "graph.json não encontrado. Execute .\Scripts\Update-SpaceModel.ps1 -Mode Graph."
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
  Write-Output "Compilando a ponte Axum otimizada..."
  & $cargo build --release --manifest-path (Join-Path $rustProjectPath "Cargo.toml")
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $serverPath)) {
    throw "Não foi possível compilar a ponte Axum."
  }
}

if (-not (Test-Path -LiteralPath $bridgeConfigPath)) {
  & (Join-Path $scriptDir "Configurar-NoteBridge.ps1")
}
$bridgeConfig = Get-Content -Raw -LiteralPath $bridgeConfigPath | ConvertFrom-Json
$projectConfig = if (Test-Path -LiteralPath $projectConfigPath) {
  Get-Content -Raw -LiteralPath $projectConfigPath | ConvertFrom-Json
} else {
  [pscustomobject]@{}
}
$siteUrl = [string]$projectConfig.siteUrl
if ([string]::IsNullOrWhiteSpace($siteUrl)) {
  throw "siteUrl não configurado. Execute .\Scripts\Configurar-Projeto.bat."
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

if (-not (Test-Path -LiteralPath $tokenPath)) {
  $bytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  (-join ($bytes | ForEach-Object { $_.ToString("x2") })) |
    Set-Content -LiteralPath $tokenPath -NoNewline
}
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
  SPACE_GRAPH_PATH = $graphPath
  SPACE_PENDING_OPTIMIZATION_PATH = $pendingOptimizationPath
  SPACE_ALLOWED_ORIGIN = ([uri]$siteUrl).GetLeftPart([UriPartial]::Authority)
}
foreach ($entry in $serverEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

$server = Start-Process -FilePath $serverPath `
  -WindowStyle Hidden -RedirectStandardOutput $serverLog `
  -RedirectStandardError $serverErrorLog -PassThru

$tunnel = Start-Process -FilePath $cloudflared `
  -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate") `
  -WindowStyle Hidden -RedirectStandardOutput $tunnelLog `
  -RedirectStandardError $tunnelErrorLog -PassThru

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

@{
  serverPid = $server.Id
  tunnelPid = $tunnel.Id
  url = $match.Value
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Output ""
Write-Output "Ponte do Obsidian pronta."
Write-Output "URL:   $($match.Value)"
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
