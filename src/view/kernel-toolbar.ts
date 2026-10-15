import { App, Modal } from "obsidian";

export interface ToolbarActions {
  create(): void;
  runCurrent(): void;
  runAll(): void;
  interrupt(): void;
  restart(): void;
  choosePython(): void;
}

export function renderToolbar(parent: HTMLElement, pythonPath: string, actions: ToolbarActions): HTMLElement {
  const bar = parent.createDiv({ cls: "objupyter-toolbar" });
  const button = (label: string, click: () => void) => {
    bar.createEl("button", { text: label }).onclick = click;
  };
  button("+ Cell", actions.create);
  button("Run cell", actions.runCurrent);
  button("Run all", actions.runAll);
  button("Stop", actions.interrupt);
  button("Restart", actions.restart);
  const environment = bar.createEl("button", { text: pythonPath ? `Python: ${pythonPath}` : "Choose Python…", cls: "objupyter-python-button" });
  environment.title = pythonPath || "Choose a Python executable";
  environment.onclick = actions.choosePython;
  return bar;
}

class PythonPathModal extends Modal {
  private settled = false;
  constructor(app: App, private current: string, private resolve: (path: string | null) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Python environment for this notebook");
    this.contentEl.createEl("p", { text: "Enter the full path to python.exe from a Python, venv, or Conda environment." });
    const input = this.contentEl.createEl("input", { type: "text", value: this.current, cls: "objupyter-path-input" });
    input.placeholder = "C:\\path\\to\\python.exe";
    const buttons = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    buttons.createEl("button", { text: "Use this Python", cls: "mod-cta" }).onclick = () => {
      this.settled = true;
      this.resolve(input.value.trim());
      this.close();
    };
    input.focus();
  }
  onClose(): void {
    if (!this.settled) this.resolve(null);
    this.contentEl.empty();
  }
}

export function promptPythonPath(app: App, current: string): Promise<string | null> {
  return new Promise((resolve) => new PythonPathModal(app, current, resolve).open());
}
