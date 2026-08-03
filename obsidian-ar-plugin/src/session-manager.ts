import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface SessionSettings {
  projectRoot: string;
  nodeExecutable?: string;
  port: number;
  tunnelMode: "quick" | "named";
  tunnelUrl: string;
  tunnelTokenFile: string;
}

export interface ActiveSession {
  url: string;
  token: string;
  serverPid: number;
  tunnelPid: number;
}

export type SessionStatusReporter = (message: string) => void;

interface ProcessState {
  url: string;
  serverPid: number;
  tunnelPid: number;
}

function parseProcessState(contents: string): ProcessState {
  return JSON.parse(contents.replace(/^\uFEFF/u, "")) as ProcessState;
}

function safeDiagnostics(contents: string): string {
  return contents
    .replace(/^Token:\s*[^\r\n]+/gimu, "Token: [oculto]")
    .replace(/^Vault:\s*[^\r\n]+/gimu, "Vault: [oculto]")
    .trim();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class SessionManager {
  private child: ReturnType<typeof spawn> | null = null;

  async configure(settings: SessionSettings, vaultPath: string): Promise<void> {
    const configPath = path.join(settings.projectRoot, "note-bridge.config.json");
    const config = {
      vaultPath,
      tunnelMode: settings.tunnelMode,
      tunnelUrl: settings.tunnelUrl.trim().replace(/\/+$/u, ""),
      tunnelTokenFile: settings.tunnelTokenFile.trim() || ".cloudflare-tunnel-token"
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  async start(
    settings: SessionSettings,
    reportStatus: SessionStatusReporter = () => undefined
  ): Promise<ActiveSession> {
    const windows = process.platform === "win32";
    const script = windows
      ? path.join(settings.projectRoot, "Scripts", "Start-ObsidianNoteBridge.ps1")
      : path.join(settings.projectRoot, "Scripts", "note-bridge.mjs");
    if (!(await exists(script))) throw new Error(`${path.basename(script)} não foi encontrado.`);
    const statePath = path.join(settings.projectRoot, ".note-bridge-processes.json");
    const tokenPath = path.join(settings.projectRoot, ".note-bridge-token");
    const launchTime = Date.now();
    let diagnostics = "";
    let launchError: Error | null = null;
    reportStatus("Iniciando a ponte Axum e o túnel HTTPS…");
    const command = windows ? "powershell.exe" : (settings.nodeExecutable?.trim() || "node");
    const commandArgs = windows ? [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Port",
        String(settings.port)
      ] : [script, "start", "--port", String(settings.port)];
    this.child = spawn(
      command,
      commandArgs,
      { cwd: settings.projectRoot, windowsHide: true }
    );
    this.child.stdout?.on("data", (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-6000);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-6000);
    });
    this.child.on("error", (error) => {
      launchError = error;
    });
    const startedAt = Date.now();
    let lastProgressStep = -1;
    while (Date.now() - startedAt < 95_000) {
      if (launchError) throw launchError;
      if (await exists(statePath) && await exists(tokenPath)) {
        try {
          const metadata = await fs.stat(statePath);
          if (metadata.mtimeMs >= launchTime - 1000) {
            const state = parseProcessState(await fs.readFile(statePath, "utf8"));
            const token = (await fs.readFile(tokenPath, "utf8")).trim();
            if (state.url?.startsWith("https://") && token.length >= 32) {
              reportStatus("Sessão pronta. Abrindo o QR Code…");
              return { ...state, token };
            }
          }
        } catch {
          // PowerShell may still be replacing the JSON; retry on the next poll.
        }
      }
      if (this.child.exitCode !== null) {
        throw new Error(safeDiagnostics(diagnostics) || `A ponte terminou com código ${this.child.exitCode}.`);
      }
      const elapsed = Date.now() - startedAt;
      const progressStep = Math.floor(elapsed / 5000);
      if (progressStep !== lastProgressStep) {
        lastProgressStep = progressStep;
        reportStatus(elapsed < 12_000
          ? "A ponte iniciou; aguardando a URL pública do Cloudflare…"
          : `Verificando a URL HTTPS… ${Math.floor(elapsed / 1000)} s`);
      }
      await delay(500);
    }
    throw new Error(`A ponte não ficou pronta em 95 segundos. ${safeDiagnostics(diagnostics)}`);
  }

  async stop(settings: SessionSettings): Promise<void> {
    const projectRoot = settings.projectRoot;
    const windows = process.platform === "win32";
    const script = windows
      ? path.join(projectRoot, "Scripts", "Stop-ObsidianNoteBridge.ps1")
      : path.join(projectRoot, "Scripts", "note-bridge.mjs");
    if (!(await exists(script))) throw new Error(`${path.basename(script)} não foi encontrado.`);
    await new Promise<void>((resolve, reject) => {
      const command = windows ? "powershell.exe" : (settings.nodeExecutable?.trim() || "node");
      const commandArgs = windows
        ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]
        : [script, "stop"];
      const child = spawn(
        command,
        commandArgs,
        { cwd: projectRoot, windowsHide: true }
      );
      let errorText = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        errorText += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(errorText.trim() || `Falha ao encerrar a ponte (${code}).`));
      });
    });
    this.child = null;
  }
}
