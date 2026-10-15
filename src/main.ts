import { Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { createNotebook } from "./notebook/model";
import { serializeNotebook } from "./notebook/serializer";
import { SessionManager } from "./kernel/session-manager";
import { DEFAULT_SETTINGS, normalizeSettings, renameNotebookBinding, type AppearanceSettings, type ObJupyterSettings } from "./settings";
import { NOTEBOOK_VIEW_TYPE, NotebookView } from "./view/notebook-view";

class ObJupyterSettingsTab extends PluginSettingTab {
  constructor(app: ObJupyterPlugin["app"], private plugin: ObJupyterPlugin) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Default Python executable")
      .setDesc("Full path to python.exe. Each notebook may override this from its toolbar.")
      .addText((text) => text
        .setPlaceholder("C:\\path\\to\\python.exe")
        .setValue(this.plugin.settings.defaultPythonPath)
        .onChange(async (value) => {
          this.plugin.settings.defaultPythonPath = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}

export default class ObJupyterPlugin extends Plugin {
  settings: ObJupyterSettings = { ...DEFAULT_SETTINGS, notebookPythonPaths: {}, appearance: { ...DEFAULT_SETTINGS.appearance } };
  sessions = new SessionManager();

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.registerView(NOTEBOOK_VIEW_TYPE, (leaf) => new NotebookView(leaf, this));
    this.registerExtensions(["ipynb"], NOTEBOOK_VIEW_TYPE);
    this.addSettingTab(new ObJupyterSettingsTab(this.app, this));

    this.addCommand({ id: "new-notebook", name: "Create Jupyter notebook", callback: () => void this.createNotebookFile() });
    this.addCommand({ id: "run-cell", name: "Run current Jupyter cell", checkCallback: (checking) => this.withActiveView(checking, (view) => void view.runCurrentCell()) });
    this.addCommand({ id: "run-all", name: "Run all Jupyter cells", checkCallback: (checking) => this.withActiveView(checking, (view) => void view.runAll()) });
    this.addCommand({ id: "interrupt", name: "Interrupt Jupyter kernel", checkCallback: (checking) => this.withActiveView(checking, (view) => void view.interrupt()) });
    this.addCommand({ id: "restart", name: "Restart Jupyter kernel", checkCallback: (checking) => this.withActiveView(checking, (view) => void view.restart()) });

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== "ipynb") return;
      if (renameNotebookBinding(this.settings, oldPath, file.path)) void this.saveSettings();
      void this.sessions.rename(oldPath, file.path).then(async () => {
        for (const leaf of this.app.workspace.getLeavesOfType(NOTEBOOK_VIEW_TYPE)) {
          if (leaf.view instanceof NotebookView) await leaf.view.onNotebookRenamed(oldPath, file.path);
        }
      });
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "ipynb" && this.settings.notebookPythonPaths[file.path]) {
        delete this.settings.notebookPythonPaths[file.path];
        void this.saveSettings();
      }
    }));
  }

  async onunload(): Promise<void> { await this.sessions.dispose(); }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async setAppearanceColor(key: keyof AppearanceSettings, value: string): Promise<void> {
    this.settings.appearance[key] = value;
    await this.saveAppearance();
  }

  async resetAppearance(): Promise<void> {
    this.settings.appearance = { ...DEFAULT_SETTINGS.appearance };
    await this.saveAppearance();
  }

  private async saveAppearance(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(NOTEBOOK_VIEW_TYPE)) {
      if (leaf.view instanceof NotebookView) leaf.view.applyAppearance();
    }
    await this.saveSettings();
  }

  private withActiveView(checking: boolean, action: (view: NotebookView) => void): boolean {
    const view = this.app.workspace.getActiveViewOfType(NotebookView);
    if (!view) return false;
    if (!checking) action(view);
    return true;
  }

  private async createNotebookFile(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const folder = active?.parent?.path || "";
    const prefix = folder ? `${folder}/` : "";
    let path = normalizePath(`${prefix}Untitled.ipynb`);
    let number = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${prefix}Untitled ${number++}.ipynb`);
    try {
      const file = await this.app.vault.create(path, serializeNotebook(createNotebook()));
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (error) {
      new Notice(`Could not create notebook: ${(error as Error).message}`);
    }
  }
}
