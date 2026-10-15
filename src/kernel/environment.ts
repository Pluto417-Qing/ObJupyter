import { App, Modal } from "obsidian";
import { probePython } from "./environment-manager";

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
  constructor(app: App, private pythonPath: string, private missing: string[], private done: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Jupyter dependencies missing");
    this.contentEl.createEl("p", { text: `The selected Python environment is missing ${this.missing.join(", ")}. Install the packages yourself in a terminal, then run the cell again.` });
    this.contentEl.createEl("code", { text: `& "${this.pythonPath}" -m pip install ${this.missing.join(" ")}` });
    const buttons = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    buttons.createEl("button", { text: "Close", cls: "mod-cta" }).onclick = () => this.close();
  }
  onClose(): void { this.done(); this.contentEl.empty(); }
}

export async function ensureEnvironment(app: App, pythonPath: string): Promise<string> {
  const initial = await checkEnvironment(pythonPath);
  if (!initial.missing.length) return initial.executable;
  await new Promise<void>((resolve) => new MissingDependenciesModal(app, initial.executable, initial.missing, resolve).open());
  throw new Error("Install the missing Jupyter packages in your Python environment, then run the cell again.");
}
