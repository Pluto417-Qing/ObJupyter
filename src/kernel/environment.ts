import { App, Modal } from "obsidian";
import { dependencyInstallCommand, probePython } from "./environment-manager";

export interface EnvironmentCheck {
  executable: string;
  missing: string[];
}

export async function checkEnvironment(pythonPath: string): Promise<EnvironmentCheck> {
  if (!pythonPath.trim()) throw new Error("Choose a Python executable first.");
  try {
    const result = await probePython(pythonPath);
    return { executable: result.executable, missing: result.missing };
  } catch (error) {
    throw new Error(`Could not run Python: ${(error as Error).message}`);
  }
}

class MissingDependenciesModal extends Modal {
  private result: string | null = null;
  private closed = false;
  constructor(app: App, private pythonPath: string, private missing: string[], private done: (result: string | null) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Jupyter dependencies missing");
    this.contentEl.createEl("p", { text: `The selected Python environment is missing ${this.missing.join(", ")}. Run this command in PowerShell, then check again:` });
    const command = dependencyInstallCommand(this.pythonPath, this.missing);
    this.contentEl.createEl("code", { text: command });
    const status = this.contentEl.createDiv({ cls: "objupyter-environment-status", attr: { "aria-live": "polite" } });
    const buttons = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    const close = buttons.createEl("button", { text: "Close", attr: { type: "button" } });
    close.onclick = () => this.close();
    const copy = buttons.createEl("button", { text: "Copy command", attr: { type: "button" } });
    copy.onclick = () => {
      void navigator.clipboard.writeText(command)
        .then(() => { if (!this.closed) { status.setText("Command copied. Run it in PowerShell, then click Check again."); status.removeClass("is-error"); } })
        .catch(() => { if (!this.closed) { status.setText("Copy failed. Select the command above to copy it manually."); status.addClass("is-error"); } });
    };
    const check = buttons.createEl("button", { text: "Check again", cls: "mod-cta", attr: { type: "button" } });
    check.onclick = () => {
      check.disabled = true;
      status.setText("Checking Python environment…");
      void checkEnvironment(this.pythonPath).then((result) => {
        if (this.closed) return;
        if (result.missing.length) {
          status.setText(`Still missing: ${result.missing.join(", ")}`);
          status.addClass("is-error");
        } else {
          this.result = result.executable;
          this.close();
        }
      }).catch((error: Error) => {
        if (this.closed) return;
        status.setText(error.message);
        status.addClass("is-error");
      }).finally(() => { if (!this.closed) check.disabled = false; });
    };
  }
  onClose(): void { this.closed = true; this.done(this.result); this.contentEl.empty(); }
}

export async function ensureEnvironment(app: App, pythonPath: string): Promise<string> {
  const initial = await checkEnvironment(pythonPath);
  if (!initial.missing.length) return initial.executable;
  const ready = await new Promise<string | null>((resolve) => new MissingDependenciesModal(app, initial.executable, initial.missing, resolve).open());
  if (ready) return ready;
  throw new Error("Install the missing Jupyter packages in your Python environment, then run the cell again.");
}
