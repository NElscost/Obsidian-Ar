import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const xrUrl = new URL("../public/xr.html", import.meta.url);
const viteConfigUrl = new URL("../vite.config.ts", import.meta.url);
const sitesPluginUrl = new URL("../sites-vite-plugin.ts", import.meta.url);
const blenderGeneratorUrl = new URL(
  "../../Scripts/Generate-SpaceBlend.py",
  import.meta.url
);

test("mantém o módulo WebXR sintaticamente válido", async () => {
  const html = await readFile(xrUrl, "utf8");
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, "módulo WebXR ausente");
  const withoutStaticImports = source.replace(/^\s*import\s+.*;\s*$/gm, "");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(withoutStaticImports));
});

test("declara os recursos WebXR necessários", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /immersive-ar/);
  assert.match(html, /hit-test/);
  assert.match(html, /anchors/);
  assert.match(html, /hand-tracking/);
  assert.match(html, /dom-overlay/);
  assert.match(html, /id="background-360"/);
  assert.match(html, /class="panorama-options" open/);
  assert.match(html, /max-height:\s*calc\(100dvh - 20px\)/);
  assert.match(html, /function prepareEnvironment360/);
  assert.match(html, /MAX_BACKGROUND_360_WIDTH\s*=\s*8192/);
  assert.match(html, /MAX_BACKGROUND_360_HEIGHT\s*=\s*4096/);
  assert.match(html, /function panoramaRenderDimensions/);
  assert.match(html, /renderer\.capabilities\.maxTextureSize/);
  assert.match(html, /const isQuest = \/OculusBrowser\|Meta Quest\|Quest/);
  assert.match(html, /isQuest \? 4096/);
  assert.match(html, /function decodePanoramaWithWebCodecs/);
  assert.match(html, /desiredWidth: target\.width/);
  assert.match(html, /decodePanoramaWithImageBitmap/);
  assert.match(html, /imageOrientation:\s*"flipY"/);
  assert.match(html, /environment360Texture\.flipY = false/);
  assert.match(html, /environment360Texture\.generateMipmaps = false/);
  assert.match(html, /disposeEnvironment360\(\)/);
});

test("mantém o carregamento do modelo e a ponte de notas", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /Space\.gltf/);
  assert.match(html, /GLTFLoader/);
  assert.match(html, /skip_zrok_interstitial/);
  assert.match(html, /loader\.setRequestHeader\(STATIC_ASSET_HEADERS\)/);
  assert.match(html, /function fetchStaticAsset/);
  assert.match(html, /async function fetchBridge/);
  assert.match(html, /BRIDGE_RETRY_DELAYS_MS\s*=\s*\[0, 1000, 3000, 7000, 12000\]/);
  assert.match(html, /Aguardando o túnel chegar ao Quest/);
  assert.match(html, /Quick Tunnel não está resolvendo/);
  assert.match(html, /function createGlbBuffer/);
  assert.match(html, /function createModelRevision/);
  assert.match(html, /binaryBuffer\.byteLength !== declaredLength/);
  assert.match(html, /bufferUrl\.searchParams\.set\(/);
  assert.match(html, /"space-model"/);
  assert.match(html, /createGlbBuffer\(modelJson, binaryBuffer\)/);
  assert.match(html, /loader\.parseAsync\(glbBuffer, resourcePath\)/);
  assert.doesNotMatch(html, /persistentModelBufferUrls/);
  assert.match(html, /graphUrl = "\.\/graph\.json"/);
  assert.match(html, /three-forcegraph@1\.43\.1/);
  assert.match(html, /\/graph/);
  assert.match(html, /fetchBridge\(config, "\/graph"/);
  assert.match(html, /GRAPH_LAYOUT_STORAGE_KEY/);
  assert.match(html, /NOTE_BRIDGE_STORAGE_KEY/);
  assert.match(html, /Markdown|markdown/);
  assert.match(html, /pulldown/i);
  assert.match(html, /function pairingConfigFromBootstrap/);
  assert.match(html, /get\("obsidian-ar"\)/);
  assert.match(html, /space-ar-pairing-bootstrap/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /sessionStorage\.setItem\(NOTE_BRIDGE_STORAGE_KEY, JSON\.stringify\(pairedBridge\)\)/);
});

test("protege credenciais e habilita Cloudflare Access", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' blob: https:/);
  assert.match(html, /script-src[^"]*https:\/\/esm\.sh/);
  assert.match(html, /CF-Access-Client-Id/);
  assert.match(html, /CF-Access-Client-Secret/);
  assert.match(html, /sessionStorage\.setItem\(NOTE_BRIDGE_STORAGE_KEY/);
  assert.doesNotMatch(html, /localStorage\.setItem\(NOTE_BRIDGE_STORAGE_KEY/);
});

test("microgestos usam referencial da palma e validação temporal", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /profiles\.includes\("oculus-hand"\)/);
  assert.match(html, /swipeLeft:\s*5/);
  assert.match(html, /swipeRight:\s*6/);
  assert.match(html, /function updateNativeNoteMicroGestures/);
  assert.match(html, /if \(updateNativeNoteMicroGestures\(inputSource, time\)\) continue/);
  assert.match(html, /nativeState\?\.pressed === true/);
  assert.match(html, /function jointAngle/);
  assert.match(html, /state\.filteredThumb/);
  assert.match(html, /state\.lateralAxis/);
  assert.match(html, /state\.handScale/);
  assert.match(html, /suppressRayUntil/);
  assert.match(html, /state\.lateralAxis\.copy\(microGestureCameraRight\)/);
  assert.match(html, /function setMicroGestureLateralAxis/);
  assert.match(html, /copy\(state\.bases\[0\]\)[\s\S]*sub\(state\.bases\[3\]\)/);
  assert.match(html, /microGesturePalmAxis\.dot\(microGestureCameraRight\) < 0/);
  assert.match(html, /inputSource\.handedness \|\| "none"/);
  assert.match(html, /state\.screenAxis\.copy\(microGestureCameraRight\)/);
  assert.match(html, /const screenMovement = microGestureDisplacement\.dot\(state\.screenAxis\)/);
  assert.match(html, /state\.screenTravel \+= Math\.abs\(screenStep\)/);
  assert.match(html, /Math\.abs\(screenMovement\) \/ Math\.max\(0\.001, state\.screenTravel\)/);
  assert.match(html, /const action = screenMovement > 0 \? "next" : "previous"/);
  assert.match(html, /lateralDistanceToNeutral <= state\.handScale \* 0\.12/);
  assert.match(html, /directionDominance/);
  assert.match(html, /monotonicity/);
  assert.match(html, /peakNormalizedSpeed/);
  assert.match(html, /state\.awaitingNeutral = true/);
});

test("apresenta o grafo inteiro com um pulso após a ancoragem", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /INITIAL_MODEL_YAW\s*=\s*0/);
  assert.match(
    html,
    /contentRoot\.rotation\.set\(0,\s*INITIAL_MODEL_YAW,\s*0\)/
  );
  assert.doesNotMatch(html, /contentRoot\.rotation\.set\(0,\s*Math\.PI,\s*0\)/);
  assert.match(html, /GRAPH_INTRO_PULSE_SCALE\s*=\s*4/);
  assert.match(html, /GRAPH_INTRO_PULSE_DURATION_MS\s*=\s*950/);
  assert.match(html, /graphIntroPulseStartedAt = performance\.now\(\)/);
  assert.match(html, /function updateGraphIntroPulse\(time\)/);
  assert.match(
    html,
    /contentRoot\.scale\.setScalar\(baseModelScale \* userScaleFactor \* pulseScale\)/
  );
});

test("anima pulsos sinápticos dos links inteiramente na GPU", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function createSynapseLinks/);
  assert.match(html, /new THREE\.LineSegments\(geometry, material\)/);
  assert.match(html, /new THREE\.ShaderMaterial/);
  assert.match(html, /attribute float pulseCoordinate/);
  assert.match(html, /attribute float pulsePhase/);
  assert.match(html, /attribute float pulseDirection/);
  assert.match(html, /pulseTime: synapsePulseTime/);
  assert.match(html, /synapsePulseTime\.value = time \* 0\.001/);
  assert.match(html, /createSynapseLinks\(graphData, false, 0\.02\)/);
});

test("mantém os rótulos do Blender legíveis pelos dois lados", async () => {
  const [html, blenderGenerator] = await Promise.all([
    readFile(xrUrl, "utf8"),
    readFile(blenderGeneratorUrl, "utf8"),
  ]);

  assert.match(html, /material\.name === "label_text"/);
  assert.match(html, /isLabelText \? THREE\.DoubleSide : THREE\.FrontSide/);
  assert.match(html, /material\.color\?\.set\(0xffffff\)/);
  assert.match(html, /material\.emissive\?\.set\(0xffffff\)/);
  assert.match(html, /material\.toneMapped = false/);
  assert.match(
    blenderGenerator,
    /text\.rotation_euler\s*=\s*\([\s\S]*math\.radians\(90\)[\s\S]*math\.radians\(180\)/
  );
});

test("prepara mídia remota, pagina conteúdo atômico e oferece áudio e vídeo sob demanda", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /async function fetchRemoteImage/);
  assert.match(html, /function decodePreparedImage/);
  assert.match(html, /async function fetchRemoteImageThroughBridge/);
  assert.match(html, /\/remote-image/);
  assert.match(html, /Proxy da imagem falhou; tentando URL direta/);
  assert.match(html, /image\.naturalWidth > 0/);
  assert.match(html, /redirect: "follow"/);
  assert.match(html, /URL\.createObjectURL\(blob\)/);
  assert.match(html, /function calculateNotePageRanges/);
  assert.match(html, /\.note-audio-card, \.obsidian-callout/);
  assert.match(html, /element\.querySelectorAll\("tr"\)/);
  assert.match(html, /NOTE_PAGE_HEIGHT\s*=\s*570/);
  assert.match(html, /function extractNoteAudioTracks/);
  assert.match(html, /function extractNoteVideoTracks/);
  assert.match(html, /function createArVideoSurface/);
  assert.match(html, /ordered\.sort\(\(left, right\) => left\.index - right\.index\)/);
  assert.match(html, /fetchYoutubeMediaTicket/);
  assert.match(html, /cc_load_policy: "1"/);
  assert.match(html, /cc_lang_pref: captionLanguage/);
  assert.match(html, /if \(track\.kind === "youtube"\)/);
  assert.match(html, /const preparedVideoSessionCache = new Map\(\)/);
  assert.match(html, /PREPARED_VIDEO_CACHE_TTL_MS = 25 \* 60 \* 1000/);
  assert.match(html, /activeNoteMediaPath !== arNotePath/);
  assert.match(html, /activeMediaMatches/);
  assert.match(html, /pendingPreparedVideoAutoplayKey/);
  assert.match(html, /queueMicrotask\(\(\) => void toggleNoteAudio\(track\)\)/);
  assert.match(html, /videoCloseIcon[\s\S]*?color: 0x000000/);
  assert.match(html, /preparedNoteVideo\?\.notePath === arNotePath/);
  assert.match(html, /track\.kind === "video" \|\| track\.kind === "youtube"/);
  assert.match(html, /activateNoteMediaAtUv/);
  assert.match(html, /function rebuildArNoteMediaHotspotControls/);
  assert.match(html, /noteAction = `media-track:/);
  assert.match(html, /action\.startsWith\("media-track:"\)/);
  assert.match(html, /control\.position\.set\([\s\S]*?0\.07/);
  assert.match(html, /videoArcAngle = THREE\.MathUtils\.degToRad\(14\)/);
  assert.match(html, /color: 0x000000/);
  assert.match(html, /videoClose[\s\S]*?color: 0xff6b6b/);
  assert.match(html, /activeNoteVideoGroup\.name = "note-video-window"/);
  assert.match(html, /activeNoteVideoGroup\.add\(videoBackdrop, activeNoteVideoSurface, videoClose\)/);
  assert.match(html, /new THREE\.VideoTexture\(video\)/);
  assert.match(html, /noteVideoTracks\[0\] \?\? noteAudioTracks\[0\]/);
  assert.match(html, /function describeVideoPlaybackError/);
  assert.match(html, /function beginNoteVideoPreparation/);
  assert.match(html, /async function ensureVideoBridge/);
  assert.match(html, /capabilities\?\.includes\("video-transcode"\)/);
  assert.match(html, /Tentando preparar o vídeo novamente/);
  assert.match(html, /Vídeo pronto\. Faça a pinça/);
  assert.match(html, /if \(isVideo && !activeMediaMatches && !preparedNoteVideo\)/);
  assert.match(html, /if \(isVideo && !activeNoteVideoSurface\) createArVideoSurface/);
  assert.match(html, /MP4 com H\.264 \+ AAC/);
  assert.match(html, /async function toggleNoteAudio\(requestedTrack = null\)/);
  assert.match(html, /function attachNoteMediaHotspots/);
  assert.match(html, /space-ar-note-cache-v9/);
  assert.match(html, /pageMeta: pages\.map/);
  assert.match(html, /hasMediaHotspotMetadata/);
  assert.match(html, /if \(isVideo\) void prepareVideoAmbilight\(track, arNotePath\)/);
  assert.match(html, /const ranges = calculateNotePageRanges\(\)/);
  assert.match(html, /if \(!Number\.isFinite\(page\.top\)\)/);
  assert.match(html, /function activateNoteMediaAtUv/);
  assert.match(html, /noteAction = "note-media"/);
  assert.match(html, /pointedNoteControlRatioY/);
  assert.match(html, /activeNoteAudio\.preload = isVideo \? "metadata" : "none"/);
  assert.match(html, /async function fetchVaultMediaTicket/);
  assert.match(html, /capabilities\?\.includes\("media-tickets"\)/);
  assert.match(html, /optionalFeatures: \["anchors", "hand-tracking", "local-floor", "dom-overlay"\]/);
  assert.match(html, /function tryCreateVideoMediaLayer/);
  assert.match(html, /new XRMediaBinding\(xrSession\)/);
  assert.match(html, /function updateVideoPresentation/);
  assert.match(html, /AR_VIDEO_CENTER_X = -\(/);
  assert.match(html, /new THREE\.ShaderMaterial/);
  assert.match(html, /async function recoverVideoWithBlob/);
  assert.match(html, /Streaming indisponível neste Quest/);
  assert.match(html, /createMediaElementSource/);
  assert.match(html, /async function ensureSpatialAudioContext/);
  assert.match(html, /spatialAudioContext\.state === "running"/);
  assert.match(html, /panningModel = "HRTF"/);
  assert.match(html, /function updateSpatialNoteAudio/);
  assert.match(html, /async function fetchVaultWaveform/);
  assert.match(html, /async function prepareAudioWaveform/);
  assert.match(html, /const timelineTrack = noteVideoTracks\[0\] \?\? noteAudioTracks\[0\]/);
  assert.match(html, /function onSelectStart/);
  assert.match(html, /waveformDragInputSource/);
  assert.match(html, /Arraste para buscar/);
  assert.match(html, /function updateAudioWaveformProgress/);
  assert.match(html, /audioWaveformCache = new Map/);
  assert.match(html, /AUDIO_BOOKMARK_STORAGE_KEY/);
  assert.match(html, /function addAudioBookmark/);
  assert.match(html, /function rebuildAudioBookmarkMeshes/);
  assert.match(html, /action === "waveform"/);
  assert.match(html, /bookmarkSeconds/);
  assert.match(html, /arNoteGroup\.getWorldPosition\(audioSourcePosition\)/);
  assert.match(html, /spatialAudioContext\.listener/);
  assert.match(html, /addArNoteControl\(\s*"audio"/);
  assert.match(html, /function noteControlIconTexture/);
  assert.match(html, /const tipX = action === "previous" \? 21 : 43/);
  assert.match(html, /Pushpin silhouette/);
  assert.match(html, /function setNoteControlIcon/);
  assert.match(html, /new THREE\.PlaneGeometry\(0\.024, 0\.024\)/);
  assert.match(html, /activeNoteAudio\.currentTime = 0/);
  assert.match(html, /space-ar-note-cache-v9/);
});

test("remove a captura de voz e preserva a busca local", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.doesNotMatch(html, /id="voice-search"/);
  assert.doesNotMatch(html, /SpeechRecognition|MediaRecorder|\/transcribe|voice-transcribe/);
  assert.match(html, /function findBestNoteMatch/);
  assert.match(html, /function findNoteMatches/);
  assert.match(html, /id="xr-search-input"/);
  assert.match(html, /function registerDoubleThumbTap/);
  assert.match(html, /searchHighlightUntil = performance\.now\(\) \+ 10_000/);
});
test("mostra uma cópia 3D local ao lado da nota sem nova simulação", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function createLocalNoteGraph/);
  assert.match(html, /graphHierarchy\?\.fullData \?\? graphData/);
  assert.match(html, /\.slice\(0, 27\)/);
  assert.match(html, /new THREE\.InstancedMesh/);
  assert.match(html, /new THREE\.LineSegments/);
  assert.match(html, /nodes\.userData\.noteAction = "local-note"/);
  assert.match(html, /nodes\.setColorAt\(index, new THREE\.Color\(localGraphNodeColor\(node\)\)\)/);
  assert.match(html, /function localGraphNodeColor/);
  assert.match(html, /const bounds = new THREE\.Box3\(\)\.setFromPoints\(sourcePositions\)/);
  assert.match(html, /createDynamicGraphLabels\(localNodes, \{/);
  assert.match(html, /trackGlobal: false/);
  assert.match(html, /const lines = createSynapseLinks/);
  assert.match(html, /action === "local-note"/);
  assert.match(html, /void requestNote\(path\)/);
  assert.match(html, /createLocalNoteGraph\(path, width\)/);
});

test("carrega mãos virtuais do IWSDK sob demanda com fallback Three.js", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /@iwsdk\/xr-input@0\.4\.2\?external=three/);
  assert.match(html, /new XRInputManager\(\{ scene, camera \}\)/);
  assert.match(html, /iwInputManager\.update\(renderer\.xr, delta, time \/ 1000\)/);
  assert.match(html, /XRHandModelFactory/);
  assert.match(html, /function styleVirtualHandMeshes/);
  assert.match(html, /outline\.scale\.setScalar\(1\.035\)/);
  assert.match(html, /color: 0xffffff/);
  assert.match(html, /opacity: 0\.5/);
  assert.match(html, /side: THREE\.BackSide/);
});

test("quebra trechos longos em blocos de código sem perder a formatação", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /\.note-content pre\s*\{[^}]*white-space:\s*pre-wrap;/s);
  assert.match(html, /\.note-content pre\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(html, /\.note-content pre code\s*\{[^}]*white-space:\s*inherit;/s);
});

test("reenquadra o grafo dinâmico depois que o layout termina", async () => {
  const html = await readFile(xrUrl, "utf8");
  const dynamicLoader = html.indexOf("async function loadDynamicGraph");
  const layoutWait = html.indexOf("await Promise.race", dynamicLoader);
  const finalNormalization = html.indexOf("normalizeModel(model)", layoutWait);

  assert.ok(dynamicLoader >= 0);
  assert.ok(layoutWait > dynamicLoader);
  assert.ok(finalNormalization > layoutWait);
  assert.match(html, /root\.position\.set\(0,\s*0,\s*0\)/);
  assert.match(html, /new THREE\.InstancedMesh/);
  assert.match(html, /new THREE\.LineSegments/);
  assert.match(html, /createDynamicGraphVisual\(data\)/);
  assert.match(html, /createDynamicGraphLabels\(labelNodes\)/);
  assert.match(html, /labelAtlas/);
  assert.match(html, /MAX_DYNAMIC_SCALE_FACTOR\s*=\s*10/);
  assert.match(html, /compact-v10-/);
  assert.match(html, /labelScale/);
  assert.match(html, /Modo direto ativo: informe a URL HTTPS e o token da ponte/);
  assert.match(html, /Falha ao preparar a experiência/);
  assert.doesNotMatch(html, /Grafo dinâmico indisponível; usando glTF/);
  assert.doesNotMatch(html, /nodeMaterial = new THREE\.MeshBasicMaterial\(\{\s*vertexColors:/);
});

test("exibe progresso com estimativa e tempo restante durante o grafo", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /id="graph-progress"/);
  assert.match(html, /function startGraphProgress/);
  assert.match(html, /function updateGraphProgress/);
  assert.match(html, /Decorrido.*restante/);
  assert.match(html, /finishGraphProgress/);
  assert.match(html, /graphProgress\.hidden = true/);
  assert.match(html, /graphProgressHideTimer = window\.setTimeout/);
});

test("ativa orçamento de renderização para vaults com mais de dez mil nós", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /HUGE_GRAPH_NODE_THRESHOLD = 9000/);
  assert.match(html, /MAX_DYNAMIC_LABELS = 384/);
  assert.match(html, /MAX_DYNAMIC_LINKS = 50000/);
  assert.match(html, /function applyLargeGraphLayout/);
  assert.match(html, /new THREE\.InstancedMesh\(proxyGeometry, proxyMaterial, nodes\.length\)/);
  assert.match(html, /data\.nodes\.length > MAX_DYNAMIC_LABELS/);
  assert.match(html, /Math\.ceil\(data\.links\.length \/ MAX_DYNAMIC_LINKS\)/);
});

test("reduz o custo por frame e mantém os rótulos nítidos", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /NODE_PICK_INTERVAL_LARGE_MS = 66/);
  assert.match(html, /time - lastNodeRaycastAt >= nodePickInterval/);
  assert.match(html, /if \(!scanNodes\) continue/);
  assert.match(html, /data\.nodes\.length >= LARGE_GRAPH_NODE_THRESHOLD \? 6 : 8/);
  assert.match(html, /const cellWidth = 384/);
  assert.match(html, /context\.font = "650 36px system-ui, sans-serif"/);
  assert.match(html, /viewPosition\.z \+= 0\.008 \* labelScale/);
  assert.match(html, /labels\.frustumCulled = true/);
});

test("espalha o grafo conforme a quantidade de nós", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /Math\.pow\(dynamicNodeCount \/ 120, 0\.36\)/);
  assert.match(html, /TARGET_SIZE_METERS\s*\* adaptiveSizeMultiplier\s*\* \(dynamicGraphActive \? GRAPH_SPACING_EXPERIMENT_FACTOR : 1\)/);
  assert.match(html, /charge\.strength\(-42 \* forceScale\)/);
  assert.match(html, /linkForce\.distance\(24 \* Math\.sqrt\(forceScale\)\)/);
  assert.match(html, /Preparando distribuição espacial/);
  assert.match(html, /function expandDenseGraphLayout/);
  assert.match(html, /Math\.pow\(normalizedRadius, 0\.68\)/);
  assert.match(html, /Separando regiões densas/);
  assert.match(html, /sourcePosition\.addScaledVector\(linkDirection, 2\.9\)/);
  assert.match(html, /GRAPH_SPACING_EXPERIMENT_FACTOR = 1/);
  assert.match(html, /function scaleGraphSpacing/);
  assert.match(html, /scaleGraphSpacing\(data, GRAPH_SPACING_EXPERIMENT_FACTOR\)/);
  assert.match(html, /NODE_RAY_MAX_DISTANCE = 4/);
});

test("agrupa vaults grandes e expande hubs por pinça", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /DEFAULT_RENDERED_NODES = 800/);
  assert.match(html, /MIN_RENDERED_NODES = 800/);
  assert.match(html, /MAX_RENDERED_NODES = 1200/);
  assert.match(html, /Math\.floor\(renderedNodeLimit \* 0\.8\)/);
  assert.match(html, /function buildHierarchicalGraph/);
  assert.match(html, /function expandedClusterData/);
  assert.match(html, /function expandClusterNode/);
  assert.match(html, /clusterChildren/);
  assert.match(html, /Agrupando.*nós em.*hubs/);
  assert.match(html, /revelar as notas agrupadas/);
  assert.match(html, /expandClusterNode\(hierarchyNode\)/);
  assert.match(html, /function collapseClusterGraph/);
  assert.match(html, /← Voltar ao grafo/);
  assert.match(html, /isClusterBack/);
  assert.match(html, /Use o polegar para a esquerda para voltar/);
});

test("permite configurar o limite de nós entre 800 e 1200", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /id="graph-node-limit"/);
  assert.match(html, /min="800" max="1200"/);
  assert.match(html, /GRAPH_NODE_LIMIT_STORAGE_KEY/);
  assert.match(html, /function normalizeRenderedNodeLimit/);
  assert.match(html, /graphNodeLimitInput\.addEventListener\("change"/);
  assert.match(html, /compact-v10-\$\{renderedNodeLimit\}/);
});

test("configuração pública não depende dos metadados privados do Sites", async () => {
  const [viteConfig, sitesPlugin] = await Promise.all([
    readFile(viteConfigUrl, "utf8"),
    readFile(sitesPluginUrl, "utf8"),
  ]);

  assert.doesNotMatch(viteConfig, /import hostingConfig/);
  assert.doesNotMatch(viteConfig, /\.\/build\/sites-vite-plugin/);
  assert.match(viteConfig, /\.\/sites-vite-plugin/);
  assert.match(viteConfig, /\.shares\.zrok\.io/);
  assert.match(viteConfig, /\.ngrok-free\.app/);
  assert.match(viteConfig, /SPACE_ALLOWED_DEV_HOSTS/);
  assert.match(sitesPlugin, /Public clones can build without/);
});


test("mantém a busca digitada dentro da sessão WebXR", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /function updateJointDoubleThumbTap/);
  assert.match(html, /thumbTapGestureStates/);
  assert.match(html, /function keyboardTexture/);
  assert.ok(html.includes('[..."1234567890"]'));
  assert.ok(html.includes('["@", "#", "&", "(", ")", "+", "/", "="]'));
  assert.ok(html.includes('new THREE.PlaneGeometry(0.72, 0.62)'));
  assert.match(html, /function frostedKeyboardTexture/);
  assert.match(html, /map: frostedKeyboardTexture\(\)/);
  assert.match(html, /no extra render pass/);
  assert.match(html, /id="real-glass-blur"/);
  assert.match(html, /function updateRealGlassBlur/);
  assert.match(html, /new THREE\.WebGLRenderTarget\(384, 320/);
  assert.match(html, /realGlassFrameCounter = \(realGlassFrameCounter \+ 1\) % 3/);
  assert.match(html, /offset\.value = 3\.5/);
  assert.match(html, /realGlassSlowFrames >= 3/);
  assert.match(html, /function disposeRealGlassBlur/);
  assert.match(html, /function addArSearchKey/);
  assert.match(html, /aspect: width \/ 0\.052/);
  assert.match(html, /arNoteGroup\.scale\.setScalar\(keyboardWindowPinned \? 0\.62 : 0\.78\)/);
  assert.match(html, /"search-pin"/);
  assert.match(html, /IW_HAND_OUTLINE_WIDTH = 1/);
  assert.match(html, /outlineMaterial\.uniforms\.outlineColor\.value\.set\(0xffffff\)/);
  assert.match(html, /function styleIwSdkHandFill/);
  assert.match(html, /color: 0x000000/);
  assert.match(html, /opacity: 0\.58/);
  assert.match(html, /outlineMaterial\.opacity = 0\.42/);
  assert.match(html, /depthWrite: true/);
  assert.ok(html.includes('renderPass: "*Silhouette*"'));
  assert.match(html, /function updateArSearchSuggestions/);
  assert.ok(html.includes('"search-result:" + encodeURIComponent'));
  assert.ok(html.includes("void requestNote(node.id)"));
  assert.ok(html.includes("keyboardWindowPinned ? 0.62 : 0.78"));
  assert.match(html, /let keyboardWindowAnchor = null/);
  assert.match(html, /const activeWindowAnchor = arSearchKeyboardActive/);
  assert.ok(html.includes("line.renderOrder = 2005"));
  assert.match(html, /arNoteControls\.push\(key\)/);
  assert.match(html, /Busca 3D aberta/);
  assert.match(html, /function searchResultGraphData/);
  assert.match(html, /replaceDynamicGraphView\(resultData\)/);
  assert.match(html, /expandedHubId = "__search__:"/);
  assert.match(html, /1\.55 \+ Math\.sin\([^\n]+\) \* 0\.55/);
  assert.doesNotMatch(html, /xrSearchInput\.focus\(\{ preventScroll: true \}\)/);
});

test("renderiza callouts do Obsidian e mostra a contagem de palavras", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /name:"obsidianCallout"/);
  assert.match(html, /class="obsidian-callout callout-/);
  assert.match(html, /CALLOUT_ALIASES/);
  assert.match(html, /let arNoteWordCount = 0/);
  assert.match(html, /wordsLabel/);
  assert.match(html, /fillText\(arNoteTitle\.slice\(0, 42\), 512, 58, 820\)/);
});

test("oferece ambilight e YouTube no overlay WebXR", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function youtubeVideoId/);
  assert.match(html, /function youtubeCardHtml/);
  assert.match(html, /function openYouTubeOverlay/);
  assert.match(html, /youtube-nocookie\.com\/embed/);
  assert.match(html, /frame-src https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com/);
  assert.match(html, /THREE\.AdditiveBlending/);
  assert.match(html, /topColor: \{ value: new THREE\.Color/);
  assert.match(html, /function prepareVideoAmbilight/);
  assert.match(html, /function updateVideoAmbilight/);
  assert.match(html, /AR_VIDEO_WIDTH \+ 0\.18/);
  assert.match(html, /innerHalfSize/);
  assert.match(html, /float outerGlow=/);
  assert.match(html, /AR_VIDEO_GAP = 0\.085/);
  assert.match(html, /float environmentFade=/);
  assert.match(html, /float noteSideFade=/);
  assert.match(html, /vec2 edge=max\(normalized-1\.0,0\.0\)/);
  assert.match(html, /const weatherParticleCount = 320/);
  assert.match(html, /WEATHER_EFFECT_STORAGE_KEY/);
  assert.match(html, /float planeFade=/);
  assert.match(html, /depthTest: true, depthWrite: false/);
  assert.match(html, /function syncAmbientAudio/);
  assert.match(html, /ambientAudio\.loop = true/);
  assert.match(html, /colorWrite: false, depthWrite: true, depthTest: true/);
  assert.match(html, /weatherField\.visible = Boolean\(xrSession\)/);
  assert.match(html, /youtubeVideoId\(track\.source\)/);
});

test("mantém o alvo destacado pela palma durante a pinça", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /const usesPointedControl = Boolean\(pointedNoteControl\)/);
  assert.match(html, /const control = pointedNoteControl \?\? hit\?\.object/);
  assert.match(html, /\? pointedNoteControlInstanceId/);
  assert.match(html, /key\.userData\.highlightScale = false/);
  assert.match(html, /function updateKeyboardTouch/);
  assert.match(html, /time - lastKeyboardTouchScanAt < 32/);
  assert.match(html, /keyboardOnSurface = false/);
  assert.match(html, /touchWidth = width/);
  assert.match(html, /function placeKeyboardAtHit/);
  assert.match(html, /keyboardSurfaceBasis\.makeBasis/);
  assert.match(html, /function applySearchSuggestionPose/);
  assert.match(html, /result\.userData\.touchWidth = 0\.29/);
  assert.match(html, /search-surface/);
});


test("preserva o vídeo no grafo local e usa painéis curvos", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function curvedPanelGeometry/);
  assert.match(html, /function placeAudioWaveformGroup/);
  assert.match(html, /activeNoteVideoGroup\.add\(audioWaveformGroup\)/);
  assert.match(html, /activeNoteMediaPath \|\| arNotePath/);
  assert.match(html, /preserveVideoOnNextNote = Boolean/);
  assert.match(html, /noteAction = "video-close"/);
  assert.match(html, /disposeArNote\(\{ preserveVideo \}\)/);
});


test("restaura a pose ancorada do teclado antes de exibi-lo", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /const keyboardAnchorPosition = new THREE\.Vector3/);
  assert.match(html, /arNoteGroup\.position\.copy\(keyboardAnchorPosition\)/);
  assert.match(html, /arNoteGroup\.visible = true;[\s\S]{0,100}setXrMessage\("Busca 3D aberta/);
  assert.match(html, /smoothstep\(0\.0,0\.82,outside\)/);
});
test("supports Timestamp Notes markers and lazy SMILES structures", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function extractNoteTimestamps/);
  assert.match(html, /data-note-timestamp/);
  assert.match(html, /async function activateNoteTimestamp/);
  assert.match(html, /marker\.userData\.noteAction = "timestamp"/);
  assert.ok(html.includes("/vendor/smiles-drawer/smiles-drawer.min.js"));
  assert.match(html, /async function renderSmilesBlocks/);
  assert.match(html, /compactDrawing: false/);
  assert.match(html, /function fallbackSmilesSvg/);
  assert.match(html, /showFallbackSmiles/);
  assert.match(html, /new SmilesDrawer\.Drawer/);
  assert.match(html, /document\.importNode\(documentSvg\.documentElement, true\)/);
});


test("serializes YouTube preparation, shows XR loading, and renders Avatar blocks", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /function createArVideoLoadingWindow/);
  assert.match(html, /activeNoteVideoLoadingSpinner.rotation.z/);
  assert.match(html, /timestamp-url|timestamp|smiles|avatar/);
  assert.match(html, /note-avatar-body/);
});

test("atualiza o grafo fora da thread principal", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /new Worker\(url\)/);
  assert.match(html, /\/graph\/status/);
  assert.match(html, /scheduler\.postTask\(apply, \{ priority: "background" \}\)/);
  assert.match(html, /seedLiveGraphPositions\(nextData\)/);
  assert.match(html, /stopGraphUpdateWorker\(\)/);
});

test("atualiza a nota aberta sem redesenhar o grafo inalterado", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /nextSignature === graphLayoutKey/);
  assert.match(html, /refreshOpenNoteAfterVaultChange\(config\)/);
  assert.match(html, /String\(result\.content \?\? ""\) === arNoteSource/);
  assert.match(html, /showNoteInAr\(result\.title, result\.content, path, null, false, previousPage\)/);
});

test("preserva a página durante atualização ao vivo da nota", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /const previousPage = arNotePage/);
  assert.match(html, /initialPage = 0/);
  assert.match(html, /arNotePage = THREE\.MathUtils\.clamp\(initialPage/);
});
test("reproduz MIDI com transporte leve, waveform e partitura lateral", async () => {
  const html = await readFile(xrUrl, "utf8");
  assert.match(html, /MIDI_VIZ_MAX_VOICES = 12/);
  assert.match(html, /function triggerMidiVizNote/);
  assert.match(html, /function midiVizWaveform/);
  assert.match(html, /function createMidiVizScorePanel/);
  assert.match(html, /function drawMidiVizScore/);
  assert.match(html, /MIDI_VIZ_MAX_DISPLAY_DURATION = 4/);
  assert.match(html, /belongsToMidi/);
  assert.match(html, /activeNoteTrack\?\.kind === "midi-viz"/);
});
