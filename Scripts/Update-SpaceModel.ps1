param(
  [switch]$FromClipboard,
  [switch]$FromObsidian,
  [switch]$Force,
  [switch]$SkipOptimization,
  [ValidateSet("Graph", "Build", "Publish", "All")]
  [string]$Mode = "Build",
  [string]$SiteUrl = "",
  [int]$MaxTriangles = 650000,
  [int]$MaxDecodedMB = 96,
  [int]$MaxPackageMB = 15
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $scriptDir
$configPath = Join-Path $workspace "space-ar.config.json"
$graphPath = Join-Path $workspace "graph.json"
$blendPath = Join-Path $workspace "space2.blend"
$rawGltfPath = Join-Path $workspace "graph2.gltf"
$rawBinPath = Join-Path $workspace "graph2.bin"
$buildDir = Join-Path $workspace "model-build"
$statePath = Join-Path $buildDir "pipeline-state.json"
$reportPath = Join-Path $buildDir "pipeline-report.json"
$inspectPath = Join-Path $buildDir "gltf-inspect.txt"
$tokenPath = Join-Path $workspace "sites-space-ar\.model-upload-token"
$exportScriptPath = Join-Path $workspace "export-obsidian-graph.js"
$optimizerProject = Join-Path $workspace "model-pipeline"
$optimizer = Join-Path $optimizerProject "node_modules\.bin\gltf-transform.cmd"
$generateFromObsidian = $FromObsidian -or $Mode -eq "All"
$shouldBuild = $Mode -in @("Build", "Publish", "All")
$shouldPublish = $Mode -in @("Publish", "All")

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-CombinedHash([string[]]$Paths) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = New-Object IO.MemoryStream
    try {
      foreach ($path in $Paths) {
        $bytes = [IO.File]::ReadAllBytes($path)
        $stream.Write($bytes, 0, $bytes.Length)
      }
      $stream.Position = 0
      return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha.Dispose()
  }
}

function Resolve-Executable(
  [string]$Configured,
  [string]$Command,
  [string[]]$Candidates,
  [string]$DisplayName
) {
  if ($Configured -and (Test-Path -LiteralPath $Configured -PathType Leaf)) {
    return [IO.Path]::GetFullPath($Configured)
  }
  $found = Get-Command $Command -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  foreach ($candidate in $Candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw "$DisplayName não encontrado. Execute .\Scripts\Configurar-Projeto.bat."
}

function Get-AccessorComponents([string]$Type) {
  switch ($Type) {
    "SCALAR" { return 1 }
    "VEC2" { return 2 }
    "VEC3" { return 3 }
    "VEC4" { return 4 }
    "MAT2" { return 4 }
    "MAT3" { return 9 }
    "MAT4" { return 16 }
    default { return 0 }
  }
}

function Get-ComponentBytes([int]$Type) {
  switch ($Type) {
    5120 { return 1 }
    5121 { return 1 }
    5122 { return 2 }
    5123 { return 2 }
    5125 { return 4 }
    5126 { return 4 }
    default { return 0 }
  }
}

function Get-GltfStats([string]$GltfPath, [string]$BinPath) {
  $gltf = Get-Content -Raw -LiteralPath $GltfPath | ConvertFrom-Json
  $decodedBytes = [int64]0
  foreach ($accessor in @($gltf.accessors)) {
    $decodedBytes +=
      [int64]$accessor.count *
      (Get-AccessorComponents ([string]$accessor.type)) *
      (Get-ComponentBytes ([int]$accessor.componentType))
  }
  $triangles = [int64]0
  foreach ($mesh in @($gltf.meshes)) {
    foreach ($primitive in @($mesh.primitives)) {
      $mode = if ($null -eq $primitive.mode) { 4 } else { [int]$primitive.mode }
      if ($mode -ne 4) { continue }
      if ($null -ne $primitive.indices) {
        $triangles += [math]::Floor(
          [double]$gltf.accessors[[int]$primitive.indices].count / 3
        )
      } elseif ($null -ne $primitive.attributes.POSITION) {
        $triangles += [math]::Floor(
          [double]$gltf.accessors[[int]$primitive.attributes.POSITION].count / 3
        )
      }
    }
  }
  $packageBytes = (Get-Item -LiteralPath $GltfPath).Length +
    (Get-Item -LiteralPath $BinPath).Length
  return [pscustomobject]@{
    nodes = @($gltf.nodes).Count
    meshes = @($gltf.meshes).Count
    materials = @($gltf.materials).Count
    textures = @($gltf.textures | Where-Object { $null -ne $_ }).Count
    triangles = $triangles
    decodedMB = [math]::Round($decodedBytes / 1MB, 2)
    packageMB = [math]::Round($packageBytes / 1MB, 2)
    draco = @($gltf.extensionsUsed) -contains "KHR_draco_mesh_compression"
  }
}

if (Test-Path -LiteralPath $configPath) {
  $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
} else {
  $config = [pscustomobject]@{}
}
if (-not $SiteUrl) {
  $SiteUrl = [string]$config.siteUrl
}
if ($shouldPublish -and [string]::IsNullOrWhiteSpace($SiteUrl)) {
  throw "siteUrl não configurado. Execute .\Scripts\Configurar-Projeto.bat ou informe -SiteUrl."
}

$obsidian = if ($generateFromObsidian) {
  Resolve-Executable ([string]$config.obsidianPath) "obsidian" @(
    "C:\Program Files\Obsidian\Obsidian.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Obsidian\Obsidian.exe")
  ) "Obsidian"
} else {
  $null
}
$blender = if ($shouldBuild) {
  Resolve-Executable ([string]$config.blenderPath) "blender" @(
    "C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"
  ) "Blender"
} else {
  $null
}

if ($FromClipboard -and $generateFromObsidian) {
  throw "Use apenas -FromClipboard ou -FromObsidian."
}

if ($generateFromObsidian) {
  $obsidianConfigPath = Join-Path $env:APPDATA "obsidian\obsidian.json"
  if (-not (Test-Path -LiteralPath $exportScriptPath)) {
    throw "Script de exportação do Obsidian não encontrado."
  }
  if (-not (Test-Path -LiteralPath $obsidianConfigPath)) {
    throw "Configuração do Obsidian não encontrada."
  }
  $obsidianConfig = Get-Content -Raw -LiteralPath $obsidianConfigPath | ConvertFrom-Json
  $openVault = $obsidianConfig.vaults.PSObject.Properties |
    ForEach-Object { $_.Value } |
    Where-Object { $_.open -eq $true } |
    Select-Object -First 1
  if (-not $openVault) {
    throw "Nenhum vault aberto foi encontrado. Abra o Obsidian primeiro."
  }
  $automationGraphPath = Join-Path $openVault.path ".obsidian\space-ar-graph.json"
  $exportStartedAt = Get-Date
  $exportCode = Get-Content -Raw -LiteralPath $exportScriptPath
  $exportBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($exportCode))
  & $obsidian command "id=3d-graph-new:open-3d-graph-global"
  Start-Sleep -Seconds 3
  & $obsidian eval "code=eval(atob('$exportBase64'))"
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $exported = Get-Item -LiteralPath $automationGraphPath -ErrorAction SilentlyContinue
  } until (($exported -and $exported.LastWriteTime -ge $exportStartedAt) -or (Get-Date) -ge $deadline)
  if (-not $exported -or $exported.LastWriteTime -lt $exportStartedAt) {
    throw "O Obsidian não gerou o grafo em 30 segundos."
  }
  $exportedGraph = Get-Content -Raw -LiteralPath $automationGraphPath | ConvertFrom-Json
  $invalidExportedNodes = @($exportedGraph.nodes | Where-Object {
    $null -eq $_.x -or $null -eq $_.y -or $null -eq $_.z
  })
  if (
    $exportedGraph.metadata.source -ne "Obsidian 3D Graph New" -or
    -not $exportedGraph.nodes -or
    -not $exportedGraph.links -or
    $invalidExportedNodes.Count -gt 0
  ) {
    throw "O Obsidian gerou um grafo incompleto; graph.json anterior foi preservado."
  }
  Copy-Item -LiteralPath $automationGraphPath -Destination $graphPath -Force
}

if ($FromClipboard) {
  $clipboardJson = Get-Clipboard -Raw
  try { $null = $clipboardJson | ConvertFrom-Json }
  catch { throw "A área de transferência não contém JSON válido." }
  Set-Content -LiteralPath $graphPath -Value $clipboardJson -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $graphPath)) {
  throw "graph.json não encontrado."
}
$graph = Get-Content -Raw -LiteralPath $graphPath | ConvertFrom-Json
if (-not $graph.nodes -or -not $graph.links) {
  throw "graph.json precisa conter arrays nodes e links."
}
$invalidNodes = @($graph.nodes | Where-Object {
  $null -eq $_.x -or $null -eq $_.y -or $null -eq $_.z
})
if ($invalidNodes.Count -gt 0) {
  throw "graph.json incompatível: $($invalidNodes.Count) nó(s) sem x/y/z."
}
if ($Mode -eq "Graph") {
  Write-Host "graph.json gerado: $($graph.nodes.Count) nós, $($graph.links.Count) links."
  return
}

if (-not $shouldBuild) { return }
foreach ($path in @($blendPath, $optimizerProject)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Dependência local ausente: $path" }
}
if (-not (Test-Path -LiteralPath $optimizer)) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) { throw "Node.js/npm não encontrado. Instale Node.js 20 ou superior." }
  & $npm.Source ci --prefix $optimizerProject
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $optimizer)) {
    throw "Não foi possível instalar o glTF Transform."
  }
}

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$inputHashPaths = @(
  $graphPath,
  $blendPath,
  $exportScriptPath,
  $MyInvocation.MyCommand.Path,
  (Join-Path $optimizerProject "package-lock.json")
)
$inputHash = Get-CombinedHash $inputHashPaths
$priorState = if (Test-Path -LiteralPath $statePath) {
  Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
} else {
  $null
}
$canReuse = (
  -not $Force -and
  $priorState -and
  $priorState.inputHash -eq $inputHash -and
  (Test-Path -LiteralPath (Join-Path $buildDir ([string]$priorState.gltf))) -and
  (Test-Path -LiteralPath (Join-Path $buildDir ([string]$priorState.bin))) -and
  (Test-Path -LiteralPath (Join-Path $buildDir ([string]$priorState.graph)))
)

if ($canReuse) {
  $version = [string]$priorState.version
  $versionedGltf = [string]$priorState.gltf
  $versionedBin = [string]$priorState.bin
  $versionedGraph = [string]$priorState.graph
  $outGltf = Join-Path $buildDir $versionedGltf
  $outBin = Join-Path $buildDir $versionedBin
  $outGraph = Join-Path $buildDir $versionedGraph
  $reusedStats = Get-GltfStats $outGltf $outBin
  if (
    $reusedStats.triangles -gt $MaxTriangles -or
    $reusedStats.decodedMB -gt $MaxDecodedMB -or
    $reusedStats.packageMB -gt $MaxPackageMB
  ) {
    throw "O modelo armazenado ultrapassa os limites atuais. Execute novamente com -Force."
  }
  Write-Host "Entradas inalteradas; reutilizando modelo otimizado $version."
} else {
  $buildStartedAt = Get-Date
  & $blender -b $blendPath --python-expr `
    "import bpy; exec(compile(bpy.data.texts['Text'].as_string(), 'Text', 'exec'))"
  if ($LASTEXITCODE -ne 0) { throw "O Blender terminou com erro." }
  foreach ($path in @($rawGltfPath, $rawBinPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Arquivo não gerado: $path" }
    if ((Get-Item -LiteralPath $path).LastWriteTime -lt $buildStartedAt) {
      throw "O Blender não atualizou $path."
    }
  }

  $stage = Join-Path $buildDir ("staging-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  try {
    $stageGltf = Join-Path $stage "Space.gltf"
    if ($SkipOptimization) {
      Copy-Item -LiteralPath $rawGltfPath -Destination $stageGltf
      Copy-Item -LiteralPath $rawBinPath -Destination (Join-Path $stage "graph2.bin")
    } else {
      & $optimizer optimize $rawGltfPath $stageGltf `
        --compress draco `
        --texture-compress false `
        --simplify false `
        --palette false `
        --instance true `
        --join true `
        --flatten true `
        --weld true `
        --prune true
      if ($LASTEXITCODE -ne 0) { throw "A otimização glTF terminou com erro." }
    }
    $stageJson = Get-Content -Raw -LiteralPath $stageGltf | ConvertFrom-Json
    if (-not $stageJson.buffers -or $stageJson.buffers.Count -ne 1) {
      throw "O modelo otimizado precisa conter exatamente um buffer externo."
    }
    $stageBin = Join-Path $stage ([string]$stageJson.buffers[0].uri)
    if (-not (Test-Path -LiteralPath $stageBin)) {
      throw "Buffer otimizado não encontrado: $stageBin"
    }
    $contentHash = Get-CombinedHash @($stageGltf, $stageBin)
    $version = $contentHash.Substring(0, 12)
    $versionedBin = "Space-$version.bin"
    $versionedGltf = "Space-$version.gltf"
    $versionedGraph = "Graph-$version.json"
    $stageJson.buffers[0].uri = $versionedBin
    $finalStageGltf = Join-Path $stage $versionedGltf
    $stageJson | ConvertTo-Json -Depth 100 -Compress |
      Set-Content -LiteralPath $finalStageGltf -Encoding UTF8
    $stats = Get-GltfStats $finalStageGltf $stageBin
    if ($stats.triangles -gt $MaxTriangles) {
      throw "Modelo recusado: $($stats.triangles) triângulos; limite $MaxTriangles."
    }
    if ($stats.decodedMB -gt $MaxDecodedMB) {
      throw "Modelo recusado: $($stats.decodedMB) MB decodificados; limite $MaxDecodedMB MB."
    }
    if ($stats.packageMB -gt $MaxPackageMB) {
      throw "Modelo recusado: $($stats.packageMB) MB; limite $MaxPackageMB MB."
    }
    if (-not $SkipOptimization -and -not $stats.draco) {
      throw "Modelo recusado: extensão Draco ausente."
    }

    $outGltf = Join-Path $buildDir $versionedGltf
    $outBin = Join-Path $buildDir $versionedBin
    $outGraph = Join-Path $buildDir $versionedGraph
    Copy-Item -LiteralPath $finalStageGltf -Destination $outGltf -Force
    Copy-Item -LiteralPath $stageBin -Destination $outBin -Force
    Copy-Item -LiteralPath $graphPath -Destination $outGraph -Force
    & $optimizer inspect $outGltf 2>&1 |
      Set-Content -LiteralPath $inspectPath -Encoding UTF8

    @{
      generatedAt = (Get-Date).ToUniversalTime().ToString("o")
      input = @{
        graphNodes = @($graph.nodes).Count
        graphLinks = @($graph.links).Count
        rawGltfMB = [math]::Round(
          ((Get-Item $rawGltfPath).Length + (Get-Item $rawBinPath).Length) / 1MB,
          2
        )
      }
      output = $stats
      limits = @{
        maxTriangles = $MaxTriangles
        maxDecodedMB = $MaxDecodedMB
        maxPackageMB = $MaxPackageMB
      }
      version = $version
      optimized = -not $SkipOptimization
    } | ConvertTo-Json -Depth 6 |
      Set-Content -LiteralPath $reportPath -Encoding UTF8

    @{
      inputHash = $inputHash
      version = $version
      gltf = $versionedGltf
      bin = $versionedBin
      graph = $versionedGraph
      completedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json |
      Set-Content -LiteralPath $statePath -Encoding UTF8
  } finally {
    if (
      $stage -and
      (Test-Path -LiteralPath $stage) -and
      ([IO.Path]::GetFullPath($stage)).StartsWith([IO.Path]::GetFullPath($buildDir))
    ) {
      Remove-Item -LiteralPath $stage -Recurse -Force
    }
  }
}

$publicDir = Join-Path $workspace "sites-space-ar\public"
if (Test-Path -LiteralPath $publicDir) {
  $fallbackGltf = Get-Content -Raw -LiteralPath $outGltf | ConvertFrom-Json
  $fallbackGltf.buffers[0].uri = "Space.bin"
  $fallbackGltf | ConvertTo-Json -Depth 100 -Compress |
    Set-Content -LiteralPath (Join-Path $publicDir "Space.gltf") -Encoding UTF8
  Copy-Item -LiteralPath $outBin -Destination (Join-Path $publicDir "Space.bin") -Force
}

@{
  url = "/models/$versionedGltf"
  graphUrl = "/models/$versionedGraph"
  version = $version
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $buildDir "model-manifest.json") -Encoding UTF8

if ($shouldPublish) {
  if (-not (Test-Path -LiteralPath $tokenPath)) {
    throw "Token de upload não encontrado em sites-space-ar\.model-upload-token."
  }
  $token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
  $headers = @{ Authorization = "Bearer $token" }
  $base = $SiteUrl.TrimEnd("/")
  Invoke-RestMethod -Method Put -Uri "$base/api/models/$versionedBin" `
    -Headers $headers -InFile $outBin -ContentType "application/octet-stream"
  Invoke-RestMethod -Method Put -Uri "$base/api/models/$versionedGltf" `
    -Headers $headers -InFile $outGltf -ContentType "model/gltf+json"
  Invoke-RestMethod -Method Put -Uri "$base/api/models/$versionedGraph" `
    -Headers $headers -InFile $outGraph -ContentType "application/json"
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $buildDir "model-manifest.json")
  Invoke-RestMethod -Method Put -Uri "$base/api/model-manifest" `
    -Headers $headers -ContentType "application/json" -Body $manifest
  Write-Host "Modelo $version publicado: $($graph.nodes.Count) nós, $($graph.links.Count) links."
} else {
  Write-Host "Modelo offline $version pronto em model-build."
}
