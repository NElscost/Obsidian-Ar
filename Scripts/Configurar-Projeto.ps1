param(
  [string]$VaultPath = "",
  [string]$BlenderPath = "",
  [string]$ObsidianPath = "",
  [string]$QuestIp = "",
  [string]$SiteUrl = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$projectConfigPath = Join-Path $workspace "space-ar.config.json"
$bridgeConfigPath = Join-Path $workspace "note-bridge.config.json"

if (-not $VaultPath -and (Test-Path -LiteralPath $bridgeConfigPath)) {
  $existing = Get-Content -Raw -LiteralPath $bridgeConfigPath | ConvertFrom-Json
  $VaultPath = [string]$existing.vaultPath
}
if (-not $VaultPath) {
  $VaultPath = Read-Host "Endereço absoluto do vault do Obsidian"
}
if (-not [IO.Path]::IsPathRooted($VaultPath) -or
    -not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
  throw "Vault inválido: informe uma pasta absoluta existente."
}
$VaultPath = [IO.Path]::GetFullPath($VaultPath)

if (-not $BlenderPath) {
  $blenderCommand = Get-Command blender -ErrorAction SilentlyContinue
  if ($blenderCommand) {
    $BlenderPath = $blenderCommand.Source
  } else {
    $BlenderPath = Read-Host "Endereço absoluto do blender.exe"
  }
}
if (-not (Test-Path -LiteralPath $BlenderPath -PathType Leaf)) {
  throw "Blender não encontrado: $BlenderPath"
}
$BlenderPath = [IO.Path]::GetFullPath($BlenderPath)

if (-not $ObsidianPath) {
  $candidates = @(
    "C:\Program Files\Obsidian\Obsidian.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Obsidian\Obsidian.exe")
  )
  $ObsidianPath = $candidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if (-not $ObsidianPath) {
    $ObsidianPath = Read-Host "Endereço absoluto do Obsidian.exe"
  }
}
if (-not (Test-Path -LiteralPath $ObsidianPath -PathType Leaf)) {
  throw "Obsidian não encontrado: $ObsidianPath"
}
$ObsidianPath = [IO.Path]::GetFullPath($ObsidianPath)

if (-not $QuestIp) {
  $QuestIp = Read-Host "IP do Quest para ADB sem fio (opcional; Enter para ignorar)"
}
if (-not $SiteUrl) {
  $SiteUrl = Read-Host "Endereço HTTPS publicado do site (opcional; Enter para configurar depois)"
}

@{
  vaultPath = $VaultPath
  blenderPath = $BlenderPath
  obsidianPath = $ObsidianPath
  siteUrl = $SiteUrl.TrimEnd("/")
  questIp = $QuestIp.Trim()
} | ConvertTo-Json |
  Set-Content -LiteralPath $projectConfigPath -Encoding UTF8

@{ vaultPath = $VaultPath } | ConvertTo-Json |
  Set-Content -LiteralPath $bridgeConfigPath -Encoding UTF8

Write-Host ""
Write-Host "Projeto configurado."
Write-Host "Vault:    $VaultPath"
Write-Host "Blender:  $BlenderPath"
Write-Host "Obsidian: $ObsidianPath"
Write-Host "Site:     $($SiteUrl.TrimEnd('/'))"
if ($QuestIp) { Write-Host "Quest IP: $QuestIp" }
