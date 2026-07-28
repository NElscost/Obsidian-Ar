param(
  [string]$VaultPath
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$configPath = Join-Path $workspace "note-bridge.config.json"

if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = Read-Host "Informe o endereço absoluto do vault do Obsidian"
}
$VaultPath = $VaultPath.Trim().Trim('"')
if (-not [IO.Path]::IsPathRooted($VaultPath)) {
  throw "Use um endereço absoluto, por exemplo: C:\Users\Nome\Documentos\MeuVault"
}
$resolvedVaultPath = [IO.Path]::GetFullPath($VaultPath)
if (-not (Test-Path -LiteralPath $resolvedVaultPath -PathType Container)) {
  throw "Vault não encontrado: $resolvedVaultPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedVaultPath ".obsidian") -PathType Container)) {
  Write-Warning "A pasta não contém .obsidian. Confirme se este é realmente o vault desejado."
}

@{
  vaultPath = $resolvedVaultPath
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host ""
Write-Host "Vault configurado:"
Write-Host $resolvedVaultPath
Write-Host ""
Write-Host "Reinicie o .\Scripts\Iniciar-NoteBridge.bat para aplicar."
