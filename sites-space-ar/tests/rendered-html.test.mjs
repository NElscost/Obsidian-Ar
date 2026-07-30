import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const xrUrl = new URL("../public/xr.html", import.meta.url);
const viteConfigUrl = new URL("../vite.config.ts", import.meta.url);
const sitesPluginUrl = new URL("../sites-vite-plugin.ts", import.meta.url);

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
  assert.match(html, /three-forcegraph@1\.43\.1/);
  assert.match(html, /\/graph/);
  assert.match(html, /GRAPH_LAYOUT_STORAGE_KEY/);
  assert.match(html, /NOTE_BRIDGE_STORAGE_KEY/);
  assert.match(html, /Markdown|markdown/);
  assert.match(html, /pulldown/i);
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
  assert.match(sitesPlugin, /Public clones can build without/);
});
