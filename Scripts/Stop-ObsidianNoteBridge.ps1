$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$statePath = Join-Path $workspace ".note-bridge-processes.json"

if (-not (Test-Path -LiteralPath $statePath)) {
  Write-Host "A ponte não está registrada como ativa."
  return
}

$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
foreach ($processId in @($state.serverPid, $state.tunnelPid)) {
  if ($processId) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath $statePath -Force
Write-Host "Ponte do Obsidian encerrada."
