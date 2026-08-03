import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainUrl = new URL("../src/main.ts", import.meta.url);
const pairingUrl = new URL("../src/pairing.ts", import.meta.url);
const graphUrl = new URL("../src/graph-exporter.ts", import.meta.url);
const sessionUrl = new URL("../src/session-manager.ts", import.meta.url);

test("oferece comandos, ribbon e pareamento sem persistir o token", async () => {
  const [main, pairing] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(pairingUrl, "utf8")
  ]);
  assert.match(main, /addRibbonIcon\("glasses"/);
  assert.match(main, /id: "start-ar-session"/);
  assert.match(main, /id: "stop-ar-session"/);
  assert.match(main, /QRCode\.toCanvas/);
  assert.match(pairing, /viewer\.hash = `obsidian-ar=/);
  assert.doesNotMatch(main, /settings\.token/);
});

test("inicia a ponte no Windows, Linux e macOS", async () => {
  const session = await readFile(sessionUrl, "utf8");
  assert.match(session, /process\.platform === "win32"/);
  assert.match(session, /Start-ObsidianNoteBridge\.ps1/);
  assert.match(session, /note-bridge\.mjs/);
  assert.match(session, /\[script, "start", "--port"/);
  assert.doesNotMatch(session, /automatiza a ponte no Windows/);
});

test("gera o grafo pela API do Obsidian e respeita exclusões", async () => {
  const graph = await readFile(graphUrl, "utf8");
  assert.match(graph, /app\.vault\s*\.getMarkdownFiles\(\)/);
  assert.match(graph, /app\.metadataCache\.resolvedLinks/);
  assert.match(graph, /excludedFolders/);
  assert.match(graph, /excludedTags/);
  assert.match(graph, /generatedAt: new Date\(\)\.toISOString\(\)/);
});
