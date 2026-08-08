import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainUrl = new URL("../src/main.ts", import.meta.url);
const pairingUrl = new URL("../src/pairing.ts", import.meta.url);
const graphUrl = new URL("../src/graph-exporter.ts", import.meta.url);
const sessionUrl = new URL("../src/session-manager.ts", import.meta.url);
const i18nUrl = new URL("../src/i18n.ts", import.meta.url);

test("oferece comandos, ribbon e pareamento sem persistir o token", async () => {
  const [main, pairing] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(pairingUrl, "utf8")
  ]);
  assert.match(main, /addRibbonIcon\("glasses"/);
  assert.match(main, /id: "start-ar-session"/);
  assert.match(main, /id: "stop-ar-session"/);
  assert.match(main, /QRCode\.toCanvas/);
  assert.doesNotMatch(main, /setName\("Meta Quest Sync"\)\s*\.setHeading\(\)/);
  assert.doesNotMatch(main, /createEl\("h[1-6]"/);
  assert.match(pairing, /viewer\.hash = `obsidian-ar=/);
  assert.doesNotMatch(main, /settings\.token/);
});

test("inicia a ponte no Windows, Linux e macOS", async () => {
  const session = await readFile(sessionUrl, "utf8");
  assert.match(session, /note-bridge\.mjs/);
  assert.match(session, /\[script, "start", "--port"/);
  assert.match(session, /settings\.nodeExecutable\?\.trim\(\) \|\| "node"/);
  assert.doesNotMatch(session, /powershell\.exe/i);
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

test("usa português do sistema e inglês como fallback", async () => {
  const [main, session, pairing, i18n] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(sessionUrl, "utf8"),
    readFile(pairingUrl, "utf8"),
    readFile(i18nUrl, "utf8")
  ]);
  assert.match(i18n, /navigator\.language/);
  assert.match(i18n, /startsWith\("pt"\)/);
  assert.match(main, /tr\("Pasta do projeto", "Project folder"\)/);
  assert.match(session, /tr\("Iniciando a ponte Axum/);
  assert.match(pairing, /"The viewer must use HTTPS\."/);
});
