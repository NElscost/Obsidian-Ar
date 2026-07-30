param(
  [string]$VaultPath,
  [ValidateSet("", "quick", "named")]
  [string]$TunnelMode = "",
  [string]$TunnelUrl = "",
  [string]$TunnelToken = "",
  [string]$AccessClientId = "",
  [string]$AccessClientSecret = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$configPath = Join-Path $workspace "note-bridge.config.json"
$tunnelTokenPath = Join-Path $workspace ".cloudflare-tunnel-token"
$accessConfigPath = Join-Path $workspace ".cloudflare-access.json"
$existing = if (Test-Path -LiteralPath $configPath) {
  Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
} else {
  [pscustomobject]@{}
}

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

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

if ([string]::IsNullOrWhiteSpace($TunnelMode)) {
  $currentMode = ([string]$existing.tunnelMode).Trim().ToLowerInvariant()
  if ($currentMode -notin @("quick", "named")) { $currentMode = "quick" }
  $answer = (Read-Host "Modo do Cloudflare Tunnel [quick/named] ($currentMode)").Trim()
  $TunnelMode = if ($answer) { $answer.ToLowerInvariant() } else { $currentMode }
}
if ($TunnelMode -notin @("quick", "named")) {
  throw "Modo inválido. Use quick ou named."
}

if ($TunnelMode -eq "named") {
  if ([string]::IsNullOrWhiteSpace($TunnelUrl)) {
    $defaultUrl = ([string]$existing.tunnelUrl).Trim()
    $TunnelUrl = (Read-Host "Hostname HTTPS do Named Tunnel ($defaultUrl)").Trim()
    if (-not $TunnelUrl) { $TunnelUrl = $defaultUrl }
  }
  $tunnelUri = $null
  if (
    -not [Uri]::TryCreate($TunnelUrl, [UriKind]::Absolute, [ref]$tunnelUri) -or
    $tunnelUri.Scheme -ne "https"
  ) {
    throw "Informe o hostname HTTPS publicado pelo Named Tunnel."
  }
  $TunnelUrl = $tunnelUri.GetLeftPart([UriPartial]::Authority)

  if ([string]::IsNullOrWhiteSpace($TunnelToken) -and
      -not (Test-Path -LiteralPath $tunnelTokenPath)) {
    $TunnelToken = Read-SecretText "Token do Named Tunnel"
  }
  if (-not [string]::IsNullOrWhiteSpace($TunnelToken)) {
    $TunnelToken.Trim() |
      Set-Content -LiteralPath $tunnelTokenPath -NoNewline -Encoding ascii
  }
  if (-not (Test-Path -LiteralPath $tunnelTokenPath)) {
    throw "O token do Named Tunnel não foi configurado."
  }

  if ([string]::IsNullOrWhiteSpace($AccessClientId) -and
      [string]::IsNullOrWhiteSpace($AccessClientSecret) -and
      -not (Test-Path -LiteralPath $accessConfigPath)) {
    $configureAccess = (Read-Host "Configurar um Service Token do Cloudflare Access agora? [S/N]").Trim()
    if ($configureAccess -match '^(?i:s|sim|y|yes)$') {
      $AccessClientId = (Read-Host "Cloudflare Access Client ID").Trim()
      $AccessClientSecret = Read-SecretText "Cloudflare Access Client Secret"
    }
  }
  if ($AccessClientId -or $AccessClientSecret) {
    if ([string]::IsNullOrWhiteSpace($AccessClientId) -or
        [string]::IsNullOrWhiteSpace($AccessClientSecret)) {
      throw "Informe Client ID e Client Secret do Cloudflare Access juntos."
    }
    @{
      clientId = $AccessClientId.Trim()
      clientSecret = $AccessClientSecret.Trim()
    } | ConvertTo-Json | Set-Content -LiteralPath $accessConfigPath -Encoding UTF8
  }
}

@{
  vaultPath = $resolvedVaultPath
  tunnelMode = $TunnelMode
  tunnelUrl = if ($TunnelMode -eq "named") { $TunnelUrl } else { "" }
  tunnelTokenFile = ".cloudflare-tunnel-token"
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host ""
Write-Host "Vault configurado:"
Write-Host $resolvedVaultPath
Write-Host "Tunnel: $TunnelMode"
if ($TunnelMode -eq "named") {
  Write-Host "URL:    $TunnelUrl"
  $accessStatus = if (Test-Path -LiteralPath $accessConfigPath) {
    "configurado"
  } else {
    "não configurado"
  }
  Write-Host "Access: $accessStatus"
}
Write-Host ""
Write-Host "Reinicie o .\Scripts\Iniciar-NoteBridge.bat para aplicar."
