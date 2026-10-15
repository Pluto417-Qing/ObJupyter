import { setIcon } from "obsidian";
import type { NotebookCell } from "../notebook/model";

function environmentName(pythonPath: string): string {
  const parts = pythonPath.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1)?.toLowerCase();
  if (last === "python.exe" && parts.at(-2)?.toLowerCase() === "scripts") return parts.at(-3) ?? "Python";
  if (last === "python.exe") return parts.at(-2) ?? "Python";
  return parts.at(-1) ?? "Python";
}

export interface ToolbarActions {
  create(): void;
  runCurrent(): void;
  runAll(): void;
  interrupt(): void;
  restart(): void;
  choosePython(): void;
  openAppearance(): void;
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
  environment.createSpan({ text: pythonPath ? `Python: ${environmentName(pythonPath)}` : "Choose Python…" });
  environment.title = pythonPath || "Choose a Python executable";
  environment.onclick = actions.choosePython;
  const appearance = bar.createEl("button", { cls: "objupyter-toolbar-button objupyter-appearance-button", attr: { type: "button", "aria-label": "Notebook appearance settings", title: "Notebook appearance settings" } });
  setIcon(appearance, "settings-2");
  appearance.onclick = actions.openAppearance;
  return type;
}
