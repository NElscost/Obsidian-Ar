#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(scriptsDir);
const statePath = path.join(workspace, ".note-bridge-processes.json");
const tokenPath = path.join(workspace, ".note-bridge-token");
const configPath = path.join(workspace, "note-bridge.config.json");
const pendingPath = path.join(workspace, "PendenteParaOtimização.json");
const graphPath = path.join(workspace, "graph.json");
const rustProject = path.join(workspace, "note-bridge-rs");
const executable = process.platform === "win32" ? "obsidian-note-bridge.exe" : "obsidian-note-bridge";
const serverPath = path.join(rustProject, "target", "release", executable);
const logDir = path.join(workspace, "note-bridge-logs");

function extendExecutablePath() {
  const home = homedir();
  const candidates = process.platform === "win32"
    ? [
        path.join(home, ".cargo", "bin"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Cloudflare", "Cloudflared"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "cloudflared")
      ]
    : [
        path.join(home, ".cargo", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/opt/local/bin",
        "/home/linuxbrew/.linuxbrew/bin"
      ];
  const current = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  process.env.PATH = [...new Set([...current, ...candidates.filter(existsSync)])].join(path.delimiter);
}

extendExecutablePath();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanJson = (value) => value.replace(/^\uFEFF/u, "");
const readJson = (file) => JSON.parse(cleanJson(readFileSync(file, "utf8")));

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false });
  return !result.error && result.status === 0;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function stopPid(pid) {
  if (!processAlive(pid)) return false;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { return false; }
  }
  for (let attempt = 0; attempt < 20 && processAlive(pid); attempt += 1) await sleep(100);
  if (processAlive(pid)) {
    try { process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
  return true;
}

async function stopBridge() {
  let state = {};
  if (existsSync(statePath)) {
    try { state = readJson(statePath); } catch { console.warn("Registro anterior da ponte inválido."); }
  }
  const pids = [...new Set([state.serverPid, state.tunnelPid].filter(Number.isInteger))];
  let stopped = 0;
  for (const pid of pids) if (await stopPid(pid)) stopped += 1;
  rmSync(statePath, { force: true });
  console.log(stopped ? `Ponte encerrada (${stopped} processo(s)).` : "Nenhuma ponte registrada estava ativa.");
}

function sourceIsNewer() {
  if (!existsSync(serverPath)) return true;
  const binaryTime = statSync(serverPath).mtimeMs;
  const candidates = [path.join(rustProject, "Cargo.toml"), path.join(rustProject, "Cargo.lock")];
  const sourceDir = path.join(rustProject, "src");
  if (existsSync(sourceDir)) {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.isFile()) candidates.push(path.join(sourceDir, entry.name));
    }
  }
  return candidates.some((file) => existsSync(file) && statSync(file).mtimeMs > binaryTime);
}

function buildBridge() {
  if (!sourceIsNewer()) return;
  if (!commandAvailable("cargo")) throw new Error("Cargo não encontrado. Instale Rust com rustup.rs.");
  if (!commandAvailable("cmake")) throw new Error("CMake não encontrado. Instale CMake antes de compilar a ponte.");
  console.log("Compilando a ponte Axum otimizada...");
  const result = spawnSync("cargo", ["build", "--release", "--manifest-path", path.join(rustProject, "Cargo.toml")], { stdio: "inherit" });
  if (result.status !== 0 || !existsSync(serverPath)) throw new Error("Não foi possível compilar a ponte Axum.");
}

function scanPending(vaultPath) {
  const notes = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".obsidian") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const content = readFileSync(absolute, "utf8");
        const displayMath = (content.match(/\$\$|\\begin\{|\\\[|\\\(/gu) ?? []).length;
        const inlineMath = (content.match(/(?<!\\)\$(?!\$)[^\r\n$]+(?<!\\)\$/gu) ?? []).length;
        const codeMarkers = (content.match(/^\s*(?:```|~~~)/gmu) ?? []).length;
        const codeFences = Math.floor(codeMarkers / 2);
        const videoReferences = (content.match(
          /(?:!\[\[[^\]]+\.(?:mp4|m4v|mov|webm|ogv)\]\]|<video\b|\]\([^\r\n)]+\.(?:mp4|m4v|mov|webm|ogv)(?:[?#][^)]*)?\))/giu
        ) ?? []).length;
        const score = displayMath * 4 + inlineMath + codeFences * 8 + videoReferences * 12;
        if (score > 0) notes.push({
          path: path.relative(vaultPath, absolute).split(path.sep).join("/"),
          score,
          displayMath,
          inlineMath,
          codeFences,
          videoReferences
        });
      }
    }
  };
  visit(vaultPath);
  notes.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  writeFileSync(pendingPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), vault: vaultPath, notes }, null, 2)}\n`);
  console.log(`Fila de otimização: ${notes.length} notas em PendenteParaOtimização.json`);
}

function spawnLogged(command, args, stdoutPath, stderrPath, env = process.env) {
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  try {
    const child = spawn(command, args, { cwd: workspace, detached: true, env, stdio: ["ignore", stdout, stderr], windowsHide: true });
    child.unref();
    return child;
  } finally {
    closeSync(stdout); closeSync(stderr);
  }
}

async function waitForLog(files, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = files.filter(existsSync).map((file) => readFileSync(file, "utf8")).join("\n");
    const result = predicate(text);
    if (result) return result;
    await sleep(300);
  }
  return null;
}

async function waitForOwnedBridge(port, token, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/verify`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_000)
      });
      if (response.ok) return true;
      if (response.status === 401) {
        throw new Error(
          `A porta ${port} pertence a outra ponte. Encerre a sessão antiga antes de iniciar uma nova.`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("pertence a outra ponte")) throw error;
    }
    await sleep(200);
  }
  return false;
}

async function bridgePortIsOccupied(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800)
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function startBridge(port, debug) {
  await stopBridge();
  if (!existsSync(configPath)) throw new Error("note-bridge.config.json não encontrado. Copie e edite note-bridge.config.example.json.");
  const config = readJson(configPath);
  const vaultPath = path.resolve(String(config.vaultPath ?? ""));
  if (!path.isAbsolute(String(config.vaultPath ?? "")) || !existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new Error("vaultPath precisa ser um diretório absoluto existente em note-bridge.config.json.");
  }
  const defaultWhisperModel = path.join(workspace, ".models", "ggml-tiny.bin");
  const whisperModelSetting = String(
    config.whisperModelPath ?? (existsSync(defaultWhisperModel) ? defaultWhisperModel : "")
  ).trim();
  const whisperModelPath = whisperModelSetting
    ? path.resolve(workspace, whisperModelSetting)
    : "";
  if (whisperModelPath && (!existsSync(whisperModelPath) || !statSync(whisperModelPath).isFile())) {
    throw new Error(`whisperModelPath não encontrado: ${whisperModelPath}`);
  }
  if (!commandAvailable("cloudflared")) {
    throw new Error("cloudflared não encontrado. Instale-o e reinicie o Obsidian para atualizar o PATH.");
  }
  if (await bridgePortIsOccupied(port)) {
    throw new Error(
      `A porta ${port} ainda está ocupada por uma ponte não registrada. Encerre o processo antigo e tente novamente.`
    );
  }
  buildBridge();
  scanPending(vaultPath);
  mkdirSync(logDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, { mode: 0o600 });
  const serverLog = path.join(logDir, "server.log");
  const serverError = path.join(logDir, "server-error.log");
  const tunnelLog = path.join(logDir, "tunnel.log");
  const tunnelError = path.join(logDir, "tunnel-error.log");
  const serverEnv = { ...process.env, SPACE_NOTE_PORT: String(port), SPACE_NOTE_TOKEN: token, SPACE_VAULT_PATH: vaultPath, SPACE_PENDING_OPTIMIZATION_PATH: pendingPath, SPACE_WHISPER_LANGUAGE: String(config.whisperLanguage || "pt") };
  if (existsSync(graphPath)) serverEnv.SPACE_GRAPH_PATH = graphPath;
  if (whisperModelPath) serverEnv.SPACE_WHISPER_MODEL = whisperModelPath;
  const server = spawnLogged(serverPath, [], serverLog, serverError, serverEnv);
  let tunnel;
  try {
    if (!await waitForOwnedBridge(port, token)) {
      const details = [serverLog, serverError]
        .filter(existsSync)
        .map((file) => readFileSync(file, "utf8").trim())
        .filter(Boolean)
        .join("\n");
      throw new Error(details || `A ponte não respondeu na porta ${port}.`);
    }
    const mode = String(config.tunnelMode || "quick").toLowerCase();
    if (!["quick", "named"].includes(mode)) throw new Error("tunnelMode deve ser 'quick' ou 'named'.");
    let publishedUrl;
    if (mode === "named") {
      publishedUrl = new URL(String(config.tunnelUrl)).origin;
      if (!publishedUrl.startsWith("https://")) throw new Error("tunnelUrl do Named Tunnel precisa usar HTTPS.");
      let tokenFile = String(config.tunnelTokenFile || ".cloudflare-tunnel-token");
      if (!path.isAbsolute(tokenFile)) tokenFile = path.join(workspace, tokenFile);
      const tunnelToken = readFileSync(tokenFile, "utf8").trim();
      tunnel = spawnLogged("cloudflared", ["tunnel", "--no-autoupdate", "run"], tunnelLog, tunnelError, { ...process.env, TUNNEL_TOKEN: tunnelToken });
      const connected = await waitForLog([tunnelLog, tunnelError], (text) => text.includes("Registered tunnel connection"), 30_000);
      if (!connected) throw new Error("O Named Tunnel não conectou em 30 segundos.");
    } else {
      console.warn("Quick Tunnel ativo; prefira Named Tunnel para uso recorrente.");
      tunnel = spawnLogged("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], tunnelLog, tunnelError);
      publishedUrl = await waitForLog([tunnelLog, tunnelError], (text) => text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/u)?.[0], 30_000);
      if (!publishedUrl) throw new Error("O Quick Tunnel não anunciou uma URL em 30 segundos.");
      const deadline = Date.now() + 35_000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        try { ready = (await fetch(`${publishedUrl}/health`, { signal: AbortSignal.timeout(5000) })).ok; } catch { await sleep(600); }
      }
      if (!ready) throw new Error("O Quick Tunnel foi criado, mas sua URL pública não respondeu.");
    }
    const state = { serverPid: server.pid, tunnelPid: tunnel.pid, url: publishedUrl, tunnelMode: mode, startedAt: new Date().toISOString() };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    console.log(`\nPonte pronta.\nURL:   ${publishedUrl}\nToken: ${token}\nVault: ${vaultPath}`);
    if (debug) {
      console.log("Debug ativo. Logs:", serverLog);
      let offset = 0;
      while (processAlive(server.pid)) {
        if (existsSync(serverLog)) {
          const contents = readFileSync(serverLog, "utf8");
          if (contents.length > offset) process.stdout.write(contents.slice(offset));
          offset = contents.length;
        }
        await sleep(400);
      }
    }
  } catch (error) {
    await stopPid(server.pid);
    if (tunnel?.pid) await stopPid(tunnel.pid);
    throw error;
  }
}

const [command = "start", ...args] = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8765;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Porta inválida.");

try {
  if (command === "start") await startBridge(port, args.includes("--debug"));
  else if (command === "stop") await stopBridge();
  else throw new Error("Uso: node Scripts/note-bridge.mjs <start|stop> [--port 8765] [--debug]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
