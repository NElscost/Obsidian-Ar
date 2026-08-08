import { promises as fs } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import {
  App,
  FileSystemAdapter,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  debounce
} from "obsidian";
import { exportVaultGraph } from "./graph-exporter";
import { createPairingUrl } from "./pairing";
import { ActiveSession, SessionManager } from "./session-manager";
import { tr } from "./i18n";

interface ObsidianArSettings {
  projectRoot: string;
  nodeExecutable: string;
  viewerUrl: string;
  port: number;
  tunnelMode: "quick" | "named";
  tunnelUrl: string;
  tunnelTokenFile: string;
  excludedFolders: string;
  excludedTags: string;
  autoExport: boolean;
}

const DEFAULT_SETTINGS: ObsidianArSettings = {
  projectRoot: "",
  nodeExecutable: "node",
  viewerUrl: "https://space-ar-quest.elscost.chatgpt.site/",
  port: 8765,
  tunnelMode: "quick",
  tunnelUrl: "",
  tunnelTokenFile: ".cloudflare-tunnel-token",
  excludedFolders: "",
  excludedTags: "",
  autoExport: true
};

function listSetting(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim().replace(/^\/+|\/+$/gu, ""))
    .filter(Boolean);
}

class PairingModal extends Modal {
  constructor(
    app: App,
    private readonly pairingUrl: string,
    private readonly session: ActiveSession
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(tr("Meta Quest Sync pronto", "Meta Quest Sync ready"));
    this.contentEl.addClass("obsidian-ar-pairing");
    this.contentEl.createEl("p", {
      text: tr("Abra a câmera ou o navegador do Quest e leia o QR Code. A URL e o token ficam no fragmento e são removidos da barra após o pareamento.", "Open the Quest camera or browser and scan the QR code. The URL and token are stored in the fragment and removed from the address bar after pairing.")
    });
    const canvas = this.contentEl.createEl("canvas");
    void QRCode.toCanvas(canvas, this.pairingUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M"
    }).catch((error: unknown) => {
      console.error(tr("Meta Quest Sync não conseguiu desenhar o QR Code.", "Meta Quest Sync could not render the QR code."), error);
      canvas.replaceWith(this.contentEl.createEl("p", {
        cls: "obsidian-ar-status",
        text: tr("Não foi possível desenhar o QR Code. Use o botão Copiar link abaixo.", "The QR code could not be rendered. Use the Copy link button below.")
      }));
    });
    this.contentEl.createEl("p", {
      cls: "obsidian-ar-status",
      text: tr(`Ponte ativa em ${this.session.url}`, `Bridge active at ${this.session.url}`)
    });
    const text = this.contentEl.createEl("textarea", {
      cls: "obsidian-ar-pairing-url"
    });
    text.value = this.pairingUrl;
    text.readOnly = true;
    const actions = this.contentEl.createDiv({ cls: "obsidian-ar-actions" });
    const copy = actions.createEl("button", { text: tr("Copiar link", "Copy link") });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.pairingUrl).then(
        () => new Notice(tr("Link de pareamento copiado.", "Pairing link copied.")),
        () => {
          text.focus();
          text.select();
          new Notice(tr("Selecione e copie o link exibido.", "Select and copy the displayed link."));
        }
      );
    });
    const open = actions.createEl("button", { text: tr("Abrir visualizador", "Open viewer") });
    open.addEventListener("click", () => window.open(this.pairingUrl, "_blank", "noopener"));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class ObsidianArPlugin extends Plugin {
  settings: ObsidianArSettings = DEFAULT_SETTINGS;
  private readonly sessionManager = new SessionManager();
  private activeSession: ActiveSession | null = null;
  private startPromise: Promise<boolean> | null = null;
  sessionStatus = tr("Nenhuma sessão iniciada.", "No session started.");
  private exportGraphDebounced = debounce(() => {
    if (this.settings.autoExport) void this.exportGraph(false);
  }, 1500, true);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addRibbonIcon("glasses", tr("Iniciar Meta Quest Sync", "Start Meta Quest Sync"), () => void this.startAr());
    this.addCommand({
      id: "start-ar-session",
      name: tr("Iniciar sessão AR", "Start AR session"),
      callback: () => void this.startAr()
    });
    this.addCommand({
      id: "show-ar-pairing",
      name: tr("Mostrar QR Code da sessão AR", "Show AR session QR code"),
      checkCallback: (checking) => {
        if (!this.activeSession) return false;
        if (!checking) this.showPairing();
        return true;
      }
    });
    this.addCommand({
      id: "export-ar-graph",
      name: tr("Atualizar snapshot do grafo", "Refresh graph snapshot"),
      callback: () => void this.exportGraph(true)
    });
    this.addCommand({
      id: "stop-ar-session",
      name: tr("Encerrar sessão AR", "Stop AR session"),
      callback: () => void this.stopAr()
    });
    this.addSettingTab(new ObsidianArSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", this.exportGraphDebounced));
    this.registerEvent(this.app.vault.on("delete", this.exportGraphDebounced));
    this.registerEvent(this.app.vault.on("rename", this.exportGraphDebounced));
    this.registerEvent(this.app.vault.on("modify", this.exportGraphDebounced));
  }

  onunload(): void {
    this.exportGraphDebounced.cancel();
  }

  private vaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error(tr("Meta Quest Sync requer um vault local no aplicativo desktop.", "Meta Quest Sync requires a local vault in the desktop app."));
    }
    return adapter.getBasePath();
  }

  async exportGraph(showNotice: boolean): Promise<void> {
    const root = this.settings.projectRoot.trim();
    if (!root) {
      if (showNotice) new Notice(tr("Configure a pasta do projeto Meta Quest Sync.", "Configure the Meta Quest Sync project folder."));
      return;
    }
    const graph = exportVaultGraph(
      this.app,
      listSetting(this.settings.excludedFolders),
      listSetting(this.settings.excludedTags)
    );
    await fs.writeFile(path.join(root, "graph.json"), `${JSON.stringify(graph)}\n`, "utf8");
    if (showNotice) new Notice(tr(`Grafo atualizado: ${graph.nodes.length} notas.`, `Graph updated: ${graph.nodes.length} notes.`));
  }

  private setSessionStatus(message: string, report?: (message: string) => void): void {
    this.sessionStatus = message;
    report?.(message);
  }

  async startAr(report?: (message: string) => void): Promise<boolean> {
    if (this.activeSession) {
      this.showPairing();
      this.setSessionStatus(tr("Sessão ativa. QR Code aberto novamente.", "Session active. QR code opened again."), report);
      return true;
    }
    if (this.startPromise) {
      this.setSessionStatus(tr("A sessão já está sendo iniciada…", "The session is already starting…"), report);
      return this.startPromise;
    }
    const root = this.settings.projectRoot.trim();
    if (!root) {
      new Notice(tr("Abra Configurações → Meta Quest Sync e informe a pasta do projeto.", "Open Settings → Meta Quest Sync and select the project folder."));
      this.setSessionStatus(tr("Informe a pasta do projeto antes de iniciar.", "Select the project folder before starting."), report);
      return false;
    }
    this.startPromise = (async () => {
      try {
        this.setSessionStatus(tr("Exportando o grafo do vault…", "Exporting the vault graph…"), report);
        new Notice(tr("Meta Quest Sync: preparando grafo, ponte e túnel…", "Meta Quest Sync: preparing graph, bridge and tunnel…"), 8000);
        await this.exportGraph(false);
        this.setSessionStatus(tr("Salvando a configuração segura da ponte…", "Saving the secure bridge configuration…"), report);
        await this.sessionManager.configure(this.settings, this.vaultPath());
        this.activeSession = await this.sessionManager.start(
          this.settings,
          (message) => this.setSessionStatus(message, report)
        );
        this.showPairing();
        this.setSessionStatus(tr("Sessão pronta para parear com o Quest.", "Session ready to pair with the Quest."), report);
        new Notice(tr("Meta Quest Sync pronto para parear com o Quest.", "Meta Quest Sync is ready to pair with the Quest."));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(tr("Meta Quest Sync não iniciou.", "Meta Quest Sync failed to start."), error);
        this.setSessionStatus(tr(`Falha: ${message}`, `Failure: ${message}`), report);
        new Notice(`Meta Quest Sync: ${message}`, 12000);
        return false;
      } finally {
        this.startPromise = null;
      }
    })();
    return this.startPromise;
  }

  async stopAr(): Promise<void> {
    const root = this.settings.projectRoot.trim();
    if (!root) return;
    try {
      await this.sessionManager.stop(this.settings);
      this.activeSession = null;
      this.sessionStatus = tr("Sessão encerrada.", "Session stopped.");
      new Notice(tr("Sessão Meta Quest Sync encerrada.", "Meta Quest Sync session stopped."));
    } catch (error) {
      new Notice(tr(`Não foi possível encerrar: ${String(error)}`, `Could not stop the session: ${String(error)}`), 10000);
    }
  }

  private showPairing(): void {
    if (!this.activeSession) return;
    try {
      const url = createPairingUrl(
        this.settings.viewerUrl,
        this.activeSession.url,
        this.activeSession.token
      );
      const modal = new PairingModal(this.app, url, this.activeSession);
      const settings = (this.app as App & {
        setting?: { close: () => void };
      }).setting;
      settings?.close();
      window.setTimeout(() => modal.open(), 120);
    } catch (error) {
      new Notice(tr(`Pareamento inválido: ${String(error)}`, `Invalid pairing: ${String(error)}`));
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ObsidianArSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianArPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(tr("Pasta do projeto", "Project folder"))
      .setDesc(tr("Pasta absoluta do clone Obsidian-Ar que contém Scripts e note-bridge-rs.", "Absolute path to the Obsidian-Ar clone containing Scripts and note-bridge-rs."))
      .addText((text) => text
        .setPlaceholder("C:\\Projetos\\Obsidian-Ar")
        .setValue(this.plugin.settings.projectRoot)
        .onChange(async (value) => {
          this.plugin.settings.projectRoot = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(tr("Visualizador HTTPS", "HTTPS viewer"))
      .setDesc(tr("Site WebXR que será aberto pelo QR Code.", "WebXR site opened by the QR code."))
      .addText((text) => text
        .setValue(this.plugin.settings.viewerUrl)
        .onChange(async (value) => {
          this.plugin.settings.viewerUrl = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(tr("Executável Node.js", "Node.js executable"))
      .setDesc(tr("Use 'node' ou um caminho absoluto. No macOS, tente /opt/homebrew/bin/node.", "Use 'node' or an absolute path. On macOS, try /opt/homebrew/bin/node."))
      .addText((text) => text
        .setValue(this.plugin.settings.nodeExecutable)
        .onChange(async (value) => {
          this.plugin.settings.nodeExecutable = value.trim() || "node";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(tr("Porta local", "Local port"))
      .setDesc(tr("Porta usada pela ponte Axum.", "Port used by the Axum bridge."))
      .addText((text) => text
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const port = Number.parseInt(value, 10);
          if (port >= 1024 && port <= 65535) this.plugin.settings.port = port;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(tr("Tipo de túnel", "Tunnel type"))
      .setDesc(tr("Quick Tunnel é temporário; Named Tunnel é indicado para uso recorrente.", "Quick Tunnel is temporary; Named Tunnel is recommended for recurring use."))
      .addDropdown((dropdown) => dropdown
        .addOption("quick", "Cloudflare Quick Tunnel")
        .addOption("named", "Cloudflare Named Tunnel")
        .setValue(this.plugin.settings.tunnelMode)
        .onChange(async (value: "quick" | "named") => {
          this.plugin.settings.tunnelMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));
    if (this.plugin.settings.tunnelMode === "named") {
      new Setting(containerEl)
        .setName(tr("URL do Named Tunnel", "Named Tunnel URL"))
        .addText((text) => text.setValue(this.plugin.settings.tunnelUrl).onChange(async (value) => {
          this.plugin.settings.tunnelUrl = value.trim();
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl)
        .setName(tr("Arquivo do token do túnel", "Tunnel token file"))
        .addText((text) => text.setValue(this.plugin.settings.tunnelTokenFile).onChange(async (value) => {
          this.plugin.settings.tunnelTokenFile = value.trim();
          await this.plugin.saveSettings();
        }));
    }
    new Setting(containerEl)
      .setName(tr("Pastas excluídas", "Excluded folders"))
      .setDesc(tr("Uma pasta por linha ou separada por vírgulas.", "One folder per line or separated by commas."))
      .addTextArea((text) => text.setValue(this.plugin.settings.excludedFolders).onChange(async (value) => {
        this.plugin.settings.excludedFolders = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(tr("Tags excluídas", "Excluded tags"))
      .setDesc(tr("Inclua #. Uma tag por linha ou separada por vírgulas.", "Include #. Enter one tag per line or separate them with commas."))
      .addTextArea((text) => text.setValue(this.plugin.settings.excludedTags).onChange(async (value) => {
        this.plugin.settings.excludedTags = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(tr("Atualizar grafo automaticamente", "Update graph automatically"))
      .setDesc(tr("Reexporta o snapshot após alterações no vault, com debounce.", "Re-exports the snapshot after vault changes, with debounce."))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoExport).onChange(async (value) => {
        this.plugin.settings.autoExport = value;
        await this.plugin.saveSettings();
      }));
    const sessionSetting = new Setting(containerEl)
      .setName(tr("Sessão AR", "AR session"))
      .setDesc(this.plugin.sessionStatus);
    sessionSetting
      .addButton((button) => button.setCta().setButtonText(tr("Iniciar AR", "Start AR")).onClick(async () => {
        button.setDisabled(true).setButtonText(tr("Iniciando…", "Starting…"));
        try {
          await this.plugin.startAr((message) => sessionSetting.setDesc(message));
        } finally {
          button.setDisabled(false).setButtonText(tr("Iniciar AR", "Start AR"));
        }
      }))
      .addButton((button) => button.setWarning().setButtonText(tr("Encerrar", "Stop")).onClick(() => {
        void this.plugin.stopAr();
      }));
  }
}
