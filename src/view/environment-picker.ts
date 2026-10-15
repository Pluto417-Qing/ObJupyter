import path from "node:path";
import { App, Modal } from "obsidian";
import { createVaultEnvironment, defaultDiscoveryDeps, discoverEnvironments, installKernelDependencies, probePython, vaultEnvironmentPath, type PythonEnvironment } from "../kernel/environment-manager";

class EnvironmentPickerModal extends Modal {
  private settled = false;
  private closed = false;
  private busy = false;
  private controller: AbortController | null = null;
  private list!: HTMLElement;
  private status!: HTMLElement;
  private baseSelect!: HTMLSelectElement;
  private createButton!: HTMLButtonElement;
  private createHelp!: HTMLElement;
  private environments: PythonEnvironment[] = [];

  constructor(app: App, private root: string, private current: string, private configured: string[], private resolve: (value: string | null) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Python environment for this notebook");
    this.contentEl.createEl("p", { text: "Choose a discovered environment, enter a Python executable path, or create a vault .venv." });
    const top = this.contentEl.createDiv({ cls: "objupyter-environment-actions" });
    top.createEl("button", { text: "Refresh", attr: { type: "button" } }).onclick = () => void this.refresh();
    top.createEl("button", { text: "Use default", attr: { type: "button" } }).onclick = () => this.finish("");
    this.status = this.contentEl.createDiv({ cls: "objupyter-environment-status", attr: { "aria-live": "polite" } });
    this.list = this.contentEl.createDiv({ cls: "objupyter-environment-list" });

    const manual = this.contentEl.createDiv({ cls: "objupyter-environment-manual" });
    manual.createEl("label", { text: "Python executable path" });
    const input = manual.createEl("input", { type: "text", value: this.current, placeholder: "C:\\path\\to\\python.exe" });
    manual.createEl("button", { text: "Use path", attr: { type: "button" } }).onclick = () => void this.run(async () => {
      const chosen = input.value.trim();
      if (!chosen) throw new Error("Enter a Python executable path.");
      const checked = await probePython(chosen);
      this.finish(checked.executable);
    });

    const create = this.contentEl.createDiv({ cls: "objupyter-environment-create" });
    create.createEl("label", { text: "Create vault .venv using" });
    this.baseSelect = create.createEl("select", { attr: { "aria-label": "Base Python for new environment" } });
    this.createButton = create.createEl("button", { text: "Create .venv", attr: { type: "button" } });
    this.createButton.onclick = () => void this.run(async (signal) => {
      const base = this.baseSelect.value;
      if (!base) throw new Error("Choose a base Python installation first.");
      const executable = await createVaultEnvironment(this.root, base, (stage) => this.setStatus(stage), signal);
      this.finish(executable);
    });
    this.createHelp = create.createEl("small", { cls: "objupyter-environment-help" });
    void this.refresh();
  }

  private setStatus(message: string, error = false): void {
    if (this.closed) return;
    this.status.setText(message);
    this.status.toggleClass("is-error", error);
  }

  private async refresh(): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.setStatus("Finding Python environments…");
    try {
      this.environments = await discoverEnvironments(this.root, this.configured);
      if (this.closed) return;
      await this.renderEnvironments();
      this.setStatus(this.environments.length ? `${this.environments.length} environment(s) found.` : "No usable Python installation found. Enter an executable path to try one manually.");
    } catch (error) { this.setStatus((error as Error).message, true); }
    finally { this.busy = false; }
  }

  private async renderEnvironments(): Promise<void> {
    this.list.empty();
    const vaultPython = path.resolve(vaultEnvironmentPath(this.root)).toLowerCase();
    for (const environment of this.environments) {
      const row = this.list.createDiv({ cls: "objupyter-environment-row" });
      const info = row.createDiv({ cls: "objupyter-environment-info" });
      info.createDiv({ text: `${environment.source} · Python ${environment.version}${path.resolve(environment.executable).toLowerCase() === path.resolve(this.current).toLowerCase() ? " · Current" : ""}` });
      info.createEl("small", { text: environment.executable });
      if (environment.missing.length) info.createEl("small", { text: `Missing: ${environment.missing.join(", ")}`, cls: "objupyter-environment-warning" });
      const actions = row.createDiv({ cls: "objupyter-environment-row-actions" });
      actions.createEl("button", { text: "Use", attr: { type: "button", "aria-label": `Use ${environment.executable}` } }).onclick = () => this.finish(environment.executable);
      if (environment.missing.length) {
        actions.createEl("button", { text: "Install dependencies", attr: { type: "button", "aria-label": `Install Jupyter dependencies into ${environment.executable}` } }).onclick = () => void this.run(async (signal) => {
          const checked = await installKernelDependencies(environment.executable, (stage) => this.setStatus(stage), signal);
          environment.missing = checked.missing;
          this.setStatus(`Jupyter dependencies installed in ${environment.executable}.`);
        });
      }
    }
    this.baseSelect.empty();
    for (const environment of this.environments.filter((item) => item.isBase)) {
      this.baseSelect.createEl("option", { text: `Python ${environment.version} — ${environment.executable}`, value: environment.executable });
    }
    const exists = await defaultDiscoveryDeps.exists(path.join(this.root, ".venv"));
    if (this.closed) return;
    this.createButton.disabled = exists || this.baseSelect.options.length === 0;
    this.createButton.title = exists ? ".venv already exists in this vault. Select or repair it above; existing files will not be replaced." : "Create a virtual environment in the vault root";
    this.createHelp.setText(exists
      ? this.environments.some((item) => path.resolve(item.executable).toLowerCase() === vaultPython)
        ? "The vault .venv already exists; select it above or install its missing kernel packages."
        : "The vault .venv folder exists but has no usable Python. Repair or remove it manually before creating a new one."
      : "If creation stops, the partial .venv remains. Refresh to find and repair it.");
  }

  private async run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.controller = new AbortController();
    this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach((control) => { control.disabled = true; });
    try { await action(this.controller.signal); }
    catch (error) { this.setStatus((error as Error).message, true); }
    finally {
      this.controller = null;
      this.busy = false;
      if (!this.closed) {
        this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach((control) => { control.disabled = false; });
        await this.renderEnvironments();
      }
    }
  }

  private finish(value: string): void {
    if (this.closed || this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }

  onClose(): void {
    this.closed = true;
    this.controller?.abort();
    if (!this.settled) this.resolve(null);
    this.contentEl.empty();
  }
}

export function promptPythonEnvironment(app: App, vaultRoot: string, current: string, configured: string[]): Promise<string | null> {
  return new Promise((resolve) => new EnvironmentPickerModal(app, vaultRoot, current, configured, resolve).open());
}
