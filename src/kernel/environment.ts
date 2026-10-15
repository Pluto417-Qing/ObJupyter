import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { App, Modal } from "obsidian";

const runFile = promisify(execFile);

export interface EnvironmentCheck {
  executable: string;
  missing: string[];
}

export async function checkEnvironment(pythonPath: string): Promise<EnvironmentCheck> {
  if (!pythonPath.trim()) throw new Error("Choose a Python executable first.");
  const script = "import importlib.util,json,sys; print(json.dumps({'executable':sys.executable,'missing':[x for x in ('jupyter_client','ipykernel') if importlib.util.find_spec(x) is None]}))";
  try {
    const { stdout } = await runFile(pythonPath, ["-c", script], { timeout: 15_000, windowsHide: true });
    const result = JSON.parse(stdout.trim()) as EnvironmentCheck;
    if (!result.executable || !Array.isArray(result.missing)) throw new Error("Unexpected Python response");
    return result;
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
