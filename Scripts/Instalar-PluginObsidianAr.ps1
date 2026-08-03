param(
  [string]$VaultPath = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$pluginSource = Join-Path $workspace "obsidian-ar-plugin"
$bridgeConfigPath = Join-Path $workspace "note-bridge.config.json"

if ([string]::IsNullOrWhiteSpace($VaultPath) -and (Test-Path -LiteralPath $bridgeConfigPath)) {
  $config = Get-Content -Raw -LiteralPath $bridgeConfigPath | ConvertFrom-Json
  $VaultPath = [string]$config.vaultPath
}
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = Read-Host "Caminho absoluto do vault"
}
if (-not [IO.Path]::IsPathRooted($VaultPath) -or -not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
  throw "Vault inválido: $VaultPath"
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm não encontrado. Instale o Node.js 22.13 ou superior." }
if (-not (Test-Path -LiteralPath (Join-Path $pluginSource "node_modules"))) {
  & $npm.Source install --prefix $pluginSource
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível instalar as dependências do plugin." }
}
& $npm.Source run build --prefix $pluginSource
if ($LASTEXITCODE -ne 0) { throw "Não foi possível compilar o plugin." }

$pluginTarget = Join-Path ([IO.Path]::GetFullPath($VaultPath)) ".obsidian\plugins\meta-quest-sync"
New-Item -ItemType Directory -Path $pluginTarget -Force | Out-Null
foreach ($name in @("main.js", "manifest.json", "styles.css")) {
  Copy-Item -LiteralPath (Join-Path $pluginSource $name) -Destination (Join-Path $pluginTarget $name) -Force
}

Write-Host "Plugin instalado em $pluginTarget"
Write-Host "Habilite Meta Quest Sync em Configurações > Plugins da comunidade."
