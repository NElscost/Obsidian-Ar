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
    this.titleEl.setText("Meta Quest Sync pronto");
    this.contentEl.addClass("obsidian-ar-pairing");
    this.contentEl.createEl("p", {
      text: "Abra a câmera ou o navegador do Quest e leia o QR Code. A URL e o token ficam no fragmento e são removidos da barra após o pareamento."
    });
    const canvas = this.contentEl.createEl("canvas");
    void QRCode.toCanvas(canvas, this.pairingUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M"
    }).catch((error: unknown) => {
      console.error("Meta Quest Sync não conseguiu desenhar o QR Code.", error);
      canvas.replaceWith(this.contentEl.createEl("p", {
        cls: "obsidian-ar-status",
        text: "Não foi possível desenhar o QR Code. Use o botão Copiar link abaixo."
      }));
    });
    this.contentEl.createEl("p", {
      cls: "obsidian-ar-status",
      text: `Ponte ativa em ${this.session.url}`
    });
    const text = this.contentEl.createEl("textarea", {
      cls: "obsidian-ar-pairing-url"
    });
    text.value = this.pairingUrl;
    text.readOnly = true;
    const actions = this.contentEl.createDiv({ cls: "obsidian-ar-actions" });
    const copy = actions.createEl("button", { text: "Copiar link" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.pairingUrl).then(
        () => new Notice("Link de pareamento copiado."),
        () => {
          text.focus();
          text.select();
          new Notice("Selecione e copie o link exibido.");
        }
      );
    });
    const open = actions.createEl("button", { text: "Abrir visualizador" });
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
  sessionStatus = "Nenhuma sessão iniciada.";
  private exportGraphDebounced = debounce(() => {
    if (this.settings.autoExport) void this.exportGraph(false);
  }, 1500, true);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addRibbonIcon("glasses", "Iniciar Meta Quest Sync", () => void this.startAr());
    this.addCommand({
      id: "start-ar-session",
      name: "Iniciar sessão AR",
      callback: () => void this.startAr()
    });
    this.addCommand({
      id: "show-ar-pairing",
      name: "Mostrar QR Code da sessão AR",
      checkCallback: (checking) => {
        if (!this.activeSession) return false;
        if (!checking) this.showPairing();
        return true;
      }
    });
    this.addCommand({
      id: "export-ar-graph",
      name: "Atualizar snapshot do grafo",
      callback: () => void this.exportGraph(true)
    });
    this.addCommand({
      id: "stop-ar-session",
      name: "Encerrar sessão AR",
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
      throw new Error("Meta Quest Sync requer um vault local no aplicativo desktop.");
    }
    return adapter.getBasePath();
  }

  async exportGraph(showNotice: boolean): Promise<void> {
    const root = this.settings.projectRoot.trim();
    if (!root) {
      if (showNotice) new Notice("Configure a pasta do projeto Meta Quest Sync.");
      return;
    }
    const graph = exportVaultGraph(
      this.app,
      listSetting(this.settings.excludedFolders),
      listSetting(this.settings.excludedTags)
    );
    await fs.writeFile(path.join(root, "graph.json"), `${JSON.stringify(graph)}\n`, "utf8");
    if (showNotice) new Notice(`Grafo atualizado: ${graph.nodes.length} notas.`);
  }

  private setSessionStatus(message: string, report?: (message: string) => void): void {
    this.sessionStatus = message;
    report?.(message);
  }

  async startAr(report?: (message: string) => void): Promise<boolean> {
    if (this.activeSession) {
      this.showPairing();
      this.setSessionStatus("Sessão ativa. QR Code aberto novamente.", report);
      return true;
    }
    if (this.startPromise) {
      this.setSessionStatus("A sessão já está sendo iniciada…", report);
      return this.startPromise;
    }
    const root = this.settings.projectRoot.trim();
    if (!root) {
      new Notice("Abra Configurações → Meta Quest Sync e informe a pasta do projeto.");
      this.setSessionStatus("Informe a pasta do projeto antes de iniciar.", report);
      return false;
    }
    this.startPromise = (async () => {
      try {
        this.setSessionStatus("Exportando o grafo do vault…", report);
        new Notice("Meta Quest Sync: preparando grafo, ponte e túnel…", 8000);
        await this.exportGraph(false);
        this.setSessionStatus("Salvando a configuração segura da ponte…", report);
        await this.sessionManager.configure(this.settings, this.vaultPath());
        this.activeSession = await this.sessionManager.start(
          this.settings,
          (message) => this.setSessionStatus(message, report)
        );
        this.showPairing();
        this.setSessionStatus("Sessão pronta para parear com o Quest.", report);
        new Notice("Meta Quest Sync pronto para parear com o Quest.");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Meta Quest Sync não iniciou.", error);
        this.setSessionStatus(`Falha: ${message}`, report);
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
      this.sessionStatus = "Sessão encerrada.";
      new Notice("Sessão Meta Quest Sync encerrada.");
    } catch (error) {
      new Notice(`Não foi possível encerrar: ${String(error)}`, 10000);
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
      new Notice(`Pareamento inválido: ${String(error)}`);
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
    containerEl.createEl("h2", { text: "Meta Quest Sync" });
    new Setting(containerEl)
      .setName("Pasta do projeto")
      .setDesc("Pasta absoluta do clone Obsidian-Ar que contém Scripts e note-bridge-rs.")
      .addText((text) => text
        .setPlaceholder("C:\\Projetos\\Obsidian-Ar")
        .setValue(this.plugin.settings.projectRoot)
        .onChange(async (value) => {
          this.plugin.settings.projectRoot = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Visualizador HTTPS")
      .setDesc("Site WebXR que será aberto pelo QR Code.")
      .addText((text) => text
        .setValue(this.plugin.settings.viewerUrl)
        .onChange(async (value) => {
          this.plugin.settings.viewerUrl = value.trim();
          await this.plugin.saveSettings();
        }));
    if (process.platform !== "win32") {
      new Setting(containerEl)
        .setName("Executável Node.js")
        .setDesc("Use 'node' ou um caminho absoluto, por exemplo /opt/homebrew/bin/node.")
        .addText((text) => text
          .setValue(this.plugin.settings.nodeExecutable)
          .onChange(async (value) => {
            this.plugin.settings.nodeExecutable = value.trim() || "node";
            await this.plugin.saveSettings();
          }));
    }
    new Setting(containerEl)
      .setName("Porta local")
      .setDesc("Porta usada pela ponte Axum.")
      .addText((text) => text
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const port = Number.parseInt(value, 10);
          if (port >= 1024 && port <= 65535) this.plugin.settings.port = port;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Tipo de túnel")
      .setDesc("Quick Tunnel é temporário; Named Tunnel é indicado para uso recorrente.")
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
        .setName("URL do Named Tunnel")
        .addText((text) => text.setValue(this.plugin.settings.tunnelUrl).onChange(async (value) => {
          this.plugin.settings.tunnelUrl = value.trim();
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl)
        .setName("Arquivo do token do túnel")
        .addText((text) => text.setValue(this.plugin.settings.tunnelTokenFile).onChange(async (value) => {
          this.plugin.settings.tunnelTokenFile = value.trim();
          await this.plugin.saveSettings();
        }));
    }
    new Setting(containerEl)
      .setName("Pastas excluídas")
      .setDesc("Uma pasta por linha ou separada por vírgulas.")
      .addTextArea((text) => text.setValue(this.plugin.settings.excludedFolders).onChange(async (value) => {
        this.plugin.settings.excludedFolders = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Tags excluídas")
      .setDesc("Inclua #. Uma tag por linha ou separada por vírgulas.")
      .addTextArea((text) => text.setValue(this.plugin.settings.excludedTags).onChange(async (value) => {
        this.plugin.settings.excludedTags = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Atualizar grafo automaticamente")
      .setDesc("Reexporta o snapshot após alterações no vault, com debounce.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoExport).onChange(async (value) => {
        this.plugin.settings.autoExport = value;
        await this.plugin.saveSettings();
      }));
    const sessionSetting = new Setting(containerEl)
      .setName("Sessão AR")
      .setDesc(this.plugin.sessionStatus);
    sessionSetting
      .addButton((button) => button.setCta().setButtonText("Iniciar AR").onClick(async () => {
        button.setDisabled(true).setButtonText("Iniciando…");
        try {
          await this.plugin.startAr((message) => sessionSetting.setDesc(message));
        } finally {
          button.setDisabled(false).setButtonText("Iniciar AR");
        }
      }))
      .addButton((button) => button.setWarning().setButtonText("Encerrar").onClick(() => {
        void this.plugin.stopAr();
      }));
  }
}
