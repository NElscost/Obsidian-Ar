$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$statePath = Join-Path $workspace ".note-bridge-processes.json"
$serverPath = Join-Path $workspace "note-bridge-rs\target\release\obsidian-note-bridge.exe"
$processIds = [System.Collections.Generic.HashSet[int]]::new()

if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    foreach ($processId in @($state.serverPid, $state.tunnelPid)) {
      if ($processId) { [void]$processIds.Add([int]$processId) }
    }
  } catch {
    Write-Warning "O registro da ponte estava inválido."
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
if ($processIds.Count -eq 0) {
  Write-Host "Nenhuma instância da ponte estava ativa."
} else {
  Write-Host "Ponte do Obsidian encerrada ($($processIds.Count) processo(s))."
}
