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

test("declara os recursos WebXR necessários", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /immersive-ar/);
  assert.match(html, /hit-test/);
  assert.match(html, /anchors/);
  assert.match(html, /hand-tracking/);
  assert.match(html, /dom-overlay/);
});

test("mantém o carregamento do modelo e a ponte de notas", async () => {
  const html = await readFile(xrUrl, "utf8");

  assert.match(html, /Space\.gltf/);
  assert.match(html, /GLTFLoader/);
  assert.match(html, /skip_zrok_interstitial/);
  assert.match(html, /loader\.setRequestHeader\(STATIC_ASSET_HEADERS\)/);
  assert.match(html, /function fetchStaticAsset/);
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
  assert.match(html, /GRAPH_LAYOUT_STORAGE_KEY/);
  assert.match(html, /NOTE_BRIDGE_STORAGE_KEY/);
  assert.match(html, /Markdown|markdown/);
  assert.match(html, /pulldown/i);
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

  assert.match(html, /function jointAngle/);
  assert.match(html, /state\.filteredThumb/);
  assert.match(html, /state\.lateralAxis/);
  assert.match(html, /state\.handScale/);
  assert.match(html, /suppressRayUntil/);
  assert.match(html, /state\.lateralAxis\.copy\(microGestureCameraRight\)/);
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
  assert.match(html, /createDynamicGraphLabels\(data\.nodes\)/);
  assert.match(html, /labelAtlas/);
  assert.match(html, /MAX_DYNAMIC_SCALE_FACTOR\s*=\s*10/);
  assert.match(html, /compact-v2-/);
  assert.match(html, /labelScale/);
  assert.match(html, /Modo direto ativo: informe a URL HTTPS e o token da ponte/);
  assert.match(html, /Falha ao preparar a experiência/);
  assert.doesNotMatch(html, /Grafo dinâmico indisponível; usando glTF/);
  assert.doesNotMatch(html, /nodeMaterial = new THREE\.MeshBasicMaterial\(\{\s*vertexColors:/);
});

test("configuração pública não depende dos metadados privados do Sites", async () => {
  const [viteConfig, sitesPlugin] = await Promise.all([
    readFile(viteConfigUrl, "utf8"),
    readFile(sitesPluginUrl, "utf8"),
  ]);

  assert.doesNotMatch(viteConfig, /import hostingConfig/);
  assert.doesNotMatch(viteConfig, /\.\/build\/sites-vite-plugin/);
  assert.match(viteConfig, /\.\/sites-vite-plugin/);
  assert.match(viteConfig, /space-ar\.shares\.zrok\.io/);
  assert.match(viteConfig, /SPACE_ALLOWED_DEV_HOSTS/);
  assert.match(sitesPlugin, /Public clones can build without/);
});
