import { App, Modal, setIcon } from "obsidian";
import type { NotebookCell } from "../notebook/model";

export interface ToolbarActions {
  create(): void;
  runCurrent(): void;
  runAll(): void;
  interrupt(): void;
  restart(): void;
  choosePython(): void;
  changeCellType(type: NotebookCell["cell_type"]): void;
}

export function renderToolbar(parent: HTMLElement, pythonPath: string, selectedType: NotebookCell["cell_type"] | null, actions: ToolbarActions): HTMLSelectElement {
  const bar = parent.createDiv({ cls: "objupyter-toolbar" });
  const button = (icon: string, label: string, click: () => void) => {
    const control = bar.createEl("button", { cls: "objupyter-toolbar-button", attr: { type: "button", "aria-label": label, title: label } });
    setIcon(control, icon);
    control.createSpan({ text: label, cls: "objupyter-toolbar-label" });
    control.onclick = click;
  };
  button("plus", "Add cell", actions.create);
  bar.createSpan({ cls: "objupyter-toolbar-divider" });
  button("play", "Run cell", actions.runCurrent);
  button("list-video", "Run all", actions.runAll);
  button("square", "Stop", actions.interrupt);
  button("rotate-ccw", "Restart", actions.restart);
  bar.createSpan({ cls: "objupyter-toolbar-divider" });
  const type = bar.createEl("select", { cls: "objupyter-cell-type", attr: { "aria-label": "Current cell type", title: "Current cell type" } });
  for (const name of ["code", "markdown", "raw"] as const) type.createEl("option", { text: name[0].toUpperCase() + name.slice(1), value: name });
  type.value = selectedType ?? "code";
  type.disabled = selectedType === null;
  type.onchange = () => actions.changeCellType(type.value as NotebookCell["cell_type"]);
  const environment = bar.createEl("button", { cls: "objupyter-python-button", attr: { type: "button", "aria-label": "Choose Python environment" } });
  setIcon(environment, "circle-dot");
  environment.createSpan({ text: pythonPath ? `Python: ${pythonPath.split(/[\\/]/).pop()}` : "Choose Python…" });
  environment.title = pythonPath || "Choose a Python executable";
  environment.onclick = actions.choosePython;
  return type;
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
