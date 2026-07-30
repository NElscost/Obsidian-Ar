param([string]$QuestIp = "")

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$statePath = Join-Path $workspace ".note-bridge-processes.json"
$tokenPath = Join-Path $workspace ".note-bridge-token"
$accessConfigPath = Join-Path $workspace ".cloudflare-access.json"
$configPath = Join-Path $workspace "space-ar.config.json"

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) { throw "ADB não encontrado no PATH. Instale Android Platform Tools." }
if (-not (Test-Path -LiteralPath $statePath)) {
  throw "Ponte não iniciada. Execute .\Scripts\Iniciar-NoteBridge.bat."
}
if (-not (Test-Path -LiteralPath $tokenPath)) {
  throw "Token não encontrado. Execute .\Scripts\Iniciar-NoteBridge.bat."
}
if (-not $QuestIp -and (Test-Path -LiteralPath $configPath)) {
  $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  $QuestIp = [string]$config.questIp
}
if (-not $QuestIp) { $QuestIp = Read-Host "IP do Quest" }
$QuestIp = $QuestIp.Trim()
if ($QuestIp -notmatch '^[a-zA-Z0-9.:-]+$') { throw "IP do Quest inválido." }

& $adb.Source connect "${QuestIp}:5555"
if ($LASTEXITCODE -ne 0) { throw "Não foi possível conectar ao Quest." }
& $adb.Source get-state | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Nenhum Quest conectado por ADB." }

$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$url = [string]$state.url
$token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()

Write-Host ""
Write-Host "No Quest, toque no campo URL da ponte e pressione Enter aqui."
Read-Host | Out-Null
& $adb.Source shell input keycombination 113 29 | Out-Null
& $adb.Source shell input keyevent 67 | Out-Null
& $adb.Source shell input text $url | Out-Null

Write-Host ""
Write-Host "Agora toque no campo Token da ponte e pressione Enter aqui."
Read-Host | Out-Null
& $adb.Source shell input keycombination 113 29 | Out-Null
& $adb.Source shell input keyevent 67 | Out-Null
& $adb.Source shell input text $token | Out-Null

if (Test-Path -LiteralPath $accessConfigPath) {
  $access = Get-Content -Raw -LiteralPath $accessConfigPath | ConvertFrom-Json
  $accessClientId = ([string]$access.clientId).Trim()
  $accessClientSecret = ([string]$access.clientSecret).Trim()
  if ($accessClientId -and $accessClientSecret) {
    Write-Host ""
    Write-Host "Toque no campo Cloudflare Access Client ID e pressione Enter aqui."
    Read-Host | Out-Null
    & $adb.Source shell input keycombination 113 29 | Out-Null
    & $adb.Source shell input keyevent 67 | Out-Null
    & $adb.Source shell input text $accessClientId | Out-Null

    Write-Host ""
    Write-Host "Toque no campo Cloudflare Access Client Secret e pressione Enter aqui."
    Read-Host | Out-Null
    & $adb.Source shell input keycombination 113 29 | Out-Null
    & $adb.Source shell input keyevent 67 | Out-Null
    & $adb.Source shell input text $accessClientSecret | Out-Null
  }
}

Write-Host ""
Write-Host "Credenciais enviadas. Selecione 'Salvar acesso às notas' no Quest."
