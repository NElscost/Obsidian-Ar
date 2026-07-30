$ErrorActionPreference = "Stop"

$bridges = @(Get-Process -Name "obsidian-note-bridge" -ErrorAction SilentlyContinue)
if ($bridges.Count -eq 0) {
  exit 0
}

Write-Host ""
Write-Host "Foi encontrada uma ponte do Obsidian já ativa:" -ForegroundColor Yellow
foreach ($bridge in $bridges) {
  $path = try { $bridge.Path } catch { $null }
  if ([string]::IsNullOrWhiteSpace($path)) {
    $path = "(caminho não disponível)"
  }
  Write-Host "  PID $($bridge.Id): $path"
}

$answer = (Read-Host "Deseja encerrar a ponte anterior antes de iniciar? [S/N]").Trim()
if ($answer -notmatch '^(?i:s|sim|y|yes)$') {
  exit 2
}

$processIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($bridge in $bridges) {
  [void]$processIds.Add([int]$bridge.Id)
}

# Encerra somente túneis rápidos que encaminham para a porta padrão da ponte.
Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    [string]$_.CommandLine -match '(?i)\btunnel\b' -and
    [string]$_.CommandLine -match '(?i)--url(?:=|\s+)["'']?http://127\.0\.0\.1:8765\b'
  } |
  ForEach-Object { [void]$processIds.Add([int]$_.ProcessId) }

foreach ($processId in $processIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
Wait-Process -Id @($processIds) -Timeout 8 -ErrorAction SilentlyContinue

$remaining = @(Get-Process -Id @($processIds) -ErrorAction SilentlyContinue)
if ($remaining.Count -gt 0) {
  Write-Error "Não foi possível encerrar todos os processos da ponte anterior."
  exit 1
}

Write-Host "Ponte anterior encerrada." -ForegroundColor Green
exit 0
