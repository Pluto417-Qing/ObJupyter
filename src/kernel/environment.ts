import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { App, Modal, Notice } from "obsidian";

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

class InstallModal extends Modal {
  private settled = false;
  constructor(app: App, private pythonPath: string, private done: (install: boolean) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Install Jupyter dependencies?");
    this.contentEl.createEl("p", { text: "The selected Python environment is missing packages required to run notebooks." });
    this.contentEl.createEl("code", { text: `"${this.pythonPath}" -m pip install jupyter_client ipykernel` });
    const buttons = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => { this.close(); };
    buttons.createEl("button", { text: "Install", cls: "mod-cta" }).onclick = () => { this.settled = true; this.done(true); this.close(); };
  }
  onClose(): void { if (!this.settled) this.done(false); this.contentEl.empty(); }
}

export async function ensureEnvironment(app: App, pythonPath: string): Promise<string> {
  const initial = await checkEnvironment(pythonPath);
  if (!initial.missing.length) return initial.executable;
  const install = await new Promise<boolean>((resolve) => new InstallModal(app, initial.executable, resolve).open());
  if (!install) throw new Error("Jupyter dependencies were not installed.");
  new Notice("Installing Jupyter dependencies into the selected Python environment…");
  try {
    await runFile(initial.executable, ["-m", "pip", "install", "jupyter_client", "ipykernel"], {
      timeout: 600_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true
    });
  } catch (error) {
    const detail = (error as Error & { stderr?: string }).stderr || (error as Error).message;
    throw new Error(`Dependency installation failed: ${detail}\nRun manually: "${initial.executable}" -m pip install jupyter_client ipykernel`);
  }
  const verified = await checkEnvironment(initial.executable);
  if (verified.missing.length) throw new Error(`Still missing: ${verified.missing.join(", ")}`);
  new Notice("Jupyter dependencies installed.");
  return verified.executable;
}
