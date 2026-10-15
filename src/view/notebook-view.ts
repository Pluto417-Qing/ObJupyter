import path from "node:path";
import { FileSystemAdapter, MarkdownRenderer, Modal, Notice, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import type ObJupyterPlugin from "../main";
import type { BridgeEvent, BridgeClient } from "../kernel/bridge-client";
import type { Notebook, NotebookCell, NotebookOutput } from "../notebook/model";
import { moveCell, newCell, setSource, sourceText } from "../notebook/model";
import { parseNotebook, serializeNotebook } from "../notebook/serializer";
import { pythonForNotebook } from "../settings";
import { createCellEditor } from "./cell-editor";
import { markdownWithAttachments, renderCellOutputs } from "./output-renderer";
import { promptPythonPath, renderToolbar } from "./kernel-toolbar";
import { ensureEnvironment } from "../kernel/environment";
import type { EditorView } from "@codemirror/view";

export const NOTEBOOK_VIEW_TYPE = "objupyter-notebook";

class ConflictModal extends Modal {
  constructor(app: ObJupyterPlugin["app"], private choose: (reload: boolean) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Notebook changed on disk");
    this.contentEl.createEl("p", { text: "This notebook also has unsaved changes in ObJupyter. Choose which version to keep." });
    const buttons = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    buttons.createEl("button", { text: "Reload disk version" }).onclick = () => { this.choose(true); this.close(); };
    buttons.createEl("button", { text: "Keep my edits", cls: "mod-cta" }).onclick = () => { this.choose(false); this.close(); };
  }
}

export class NotebookView extends TextFileView {
  private notebook: Notebook | null = null;
  private rawData = "";
  private lastLoaded = "";
  private dirty = false;
  private conflict = false;
  private selectedIndex = 0;
  private busy = false;
  private bridge: BridgeClient | null = null;
  private sessionPath: string | null = null;
  private editors: EditorView[] = [];
  private outputElements = new Map<NotebookCell, HTMLElement>();
  private countElements = new Map<NotebookCell, HTMLElement>();
  private statusElements = new Map<NotebookCell, HTMLElement>();
  private inputElements = new Map<NotebookCell, HTMLElement>();
  private displayOutputs = new Map<string, { cell: NotebookCell; output: NotebookOutput }>();
  private clearOnNextOutput = new Set<NotebookCell>();

  constructor(leaf: WorkspaceLeaf, private plugin: ObJupyterPlugin) { super(leaf); }
  getViewType(): string { return NOTEBOOK_VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? "Jupyter notebook"; }

  getViewData(): string {
    return this.notebook ? serializeNotebook(this.notebook) : this.rawData;
  }

  setViewData(data: string, clear: boolean): void {
    if (!clear && this.dirty && data !== this.getViewData() && data !== this.lastLoaded) {
      this.conflict = true;
      new ConflictModal(this.app, (reload) => {
        this.conflict = false;
        if (reload) this.loadDocument(data);
        else this.requestSave();
      }).open();
      return;
    }
    this.loadDocument(data);
  }

  private loadDocument(data: string): void {
    this.rawData = data;
    this.lastLoaded = data;
    this.dirty = false;
    this.clear();
    try {
      this.notebook = parseNotebook(data);
      this.render();
    } catch (error) {
      this.notebook = null;
      this.contentEl.createEl("p", { text: `Cannot open notebook: ${(error as Error).message}`, cls: "objupyter-error" });
      this.contentEl.createEl("pre", { text: data.slice(0, 2000), cls: "objupyter-invalid-preview" });
    }
  }

  clear(): void {
    for (const editor of this.editors) editor.destroy();
    this.editors = [];
    this.outputElements.clear();
    this.countElements.clear();
    this.statusElements.clear();
    this.inputElements.clear();
    this.contentEl.empty();
    this.notebook = null;
  }

  async save(clear?: boolean): Promise<void> {
    if (this.conflict || !this.notebook) return;
    await super.save(clear);
    this.lastLoaded = this.getViewData();
    this.dirty = false;
  }

  async onUnloadFile(file: TFile): Promise<void> {
    await super.onUnloadFile(file);
    await this.releaseBridge();
  }

  async onNotebookRenamed(oldPath: string, newPath: string): Promise<void> {
    if (this.sessionPath !== oldPath) return;
    this.sessionPath = newPath;
    if (path.dirname(oldPath) !== path.dirname(newPath)) {
      await this.releaseBridge();
      new Notice("Notebook moved; its Python kernel will restart in the new folder on the next run.");
    }
    this.render();
  }

  private markDirty(): void {
    if (!this.notebook) return;
    this.dirty = true;
    if (!this.conflict) this.requestSave();
  }

  private render(): void {
    if (!this.notebook) return;
    for (const editor of this.editors) editor.destroy();
    this.editors = [];
    this.outputElements.clear();
    this.countElements.clear();
    this.statusElements.clear();
    this.inputElements.clear();
    this.contentEl.empty();
    this.contentEl.addClass("objupyter-view");
    const python = this.file ? pythonForNotebook(this.plugin.settings, this.file.path) : "";
    renderToolbar(this.contentEl, python, {
      create: () => this.addCell("code"),
      runCurrent: () => void this.runCurrentCell(),
      runAll: () => void this.runAll(),
      interrupt: () => void this.interrupt(),
      restart: () => void this.restart(),
      choosePython: () => void this.choosePython()
    });
    const list = this.contentEl.createDiv({ cls: "objupyter-cells" });
    this.notebook.cells.forEach((cell, index) => this.renderCell(list, cell, index));
    const footer = this.contentEl.createDiv({ cls: "objupyter-footer" });
    footer.createEl("button", { text: "+ Code" }).onclick = () => this.addCell("code");
    footer.createEl("button", { text: "+ Markdown" }).onclick = () => this.addCell("markdown");
  }

  private renderCell(parent: HTMLElement, cell: NotebookCell, index: number): void {
    const card = parent.createDiv({ cls: "objupyter-cell" });
    card.addEventListener("focusin", () => { this.selectedIndex = index; });
    const header = card.createDiv({ cls: "objupyter-cell-header" });
    const count = header.createSpan({ text: cell.cell_type === "code" ? `[${cell.execution_count ?? " "}]` : cell.cell_type.toUpperCase(), cls: "objupyter-count" });
    this.countElements.set(cell, count);
    const status = header.createSpan({ cls: "objupyter-status" });
    this.statusElements.set(cell, status);
    const type = header.createEl("select", { cls: "objupyter-cell-type" });
    for (const name of ["code", "markdown", "raw"] as const) type.createEl("option", { text: name, value: name });
    type.value = cell.cell_type;
    type.onchange = () => this.changeCellType(cell, type.value as NotebookCell["cell_type"]);
    const action = (label: string, click: () => void) => { header.createEl("button", { text: label }).onclick = click; };
    if (cell.cell_type === "code") action("▶", () => void this.runCell(index));
    if (cell.cell_type === "markdown") action("Preview", () => void this.toggleMarkdownPreview(card, cell));
    action("↑", () => this.move(index, index - 1));
    action("↓", () => this.move(index, index + 1));
    action("Delete", () => this.deleteCell(index));
    const editorHost = card.createDiv({ cls: "objupyter-editor" });
    const editor = createCellEditor(editorHost, cell, (source) => { setSource(cell, source); this.markDirty(); });
    this.editors.push(editor);
    const preview = card.createDiv({ cls: "objupyter-markdown-preview is-hidden" });
    if (cell.cell_type === "markdown") void MarkdownRenderer.render(this.app, markdownWithAttachments(cell), preview, this.file?.path ?? "", this);
    const outputHost = card.createDiv({ cls: "objupyter-outputs" });
    this.outputElements.set(cell, outputHost);
    renderCellOutputs(outputHost, cell);
    this.inputElements.set(cell, card.createDiv({ cls: "objupyter-input-area" }));
  }

  private toggleMarkdownPreview(card: HTMLElement, cell: NotebookCell): void {
    const editor = card.querySelector<HTMLElement>(".objupyter-editor");
    const preview = card.querySelector<HTMLElement>(".objupyter-markdown-preview");
    if (!editor || !preview) return;
    const show = preview.hasClass("is-hidden");
    preview.toggleClass("is-hidden", !show);
    editor.toggleClass("is-hidden", show);
    if (show) {
      preview.empty();
      void MarkdownRenderer.render(this.app, markdownWithAttachments(cell), preview, this.file?.path ?? "", this);
    }
  }

  private addCell(type: "code" | "markdown"): void {
    if (!this.notebook) return;
    this.notebook.nbformat_minor = Math.max(5, this.notebook.nbformat_minor);
    this.notebook.cells.splice(this.selectedIndex + 1, 0, newCell(type));
    this.selectedIndex++;
    this.markDirty();
    this.render();
  }

  private deleteCell(index: number): void {
    if (!this.notebook) return;
    this.notebook.cells.splice(index, 1);
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.notebook.cells.length - 1));
    this.markDirty();
    this.render();
  }

  private move(from: number, to: number): void {
    if (!this.notebook || !moveCell(this.notebook, from, to)) return;
    this.selectedIndex = to;
    this.markDirty();
    this.render();
  }

  private changeCellType(cell: NotebookCell, type: NotebookCell["cell_type"]): void {
    if (this.busy || cell.cell_type === type) return;
    cell.cell_type = type;
    if (type === "code") {
      cell.outputs = [];
      cell.execution_count = null;
      delete cell.attachments;
    } else {
      delete cell.outputs;
      delete cell.execution_count;
    }
    this.markDirty();
    this.render();
  }

  private async choosePython(): Promise<void> {
    if (!this.file) return;
    const chosen = await promptPythonPath(this.app, pythonForNotebook(this.plugin.settings, this.file.path));
    if (chosen === null) return;
    if (chosen) this.plugin.settings.notebookPythonPaths[this.file.path] = chosen;
    else delete this.plugin.settings.notebookPythonPaths[this.file.path];
    await this.plugin.saveSettings();
    await this.releaseBridge();
    this.render();
  }

  private async getBridge(): Promise<BridgeClient> {
    if (this.bridge) return this.bridge;
    if (!this.file) throw new Error("Open a notebook file first.");
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("A local desktop vault is required.");
    const configured = pythonForNotebook(this.plugin.settings, this.file.path);
    const python = await ensureEnvironment(this.app, configured);
    const cwd = path.dirname(path.join(adapter.getBasePath(), this.file.path));
    const bridge = await this.plugin.sessions.acquire(this.file.path, python, cwd);
    this.bridge = bridge;
    this.sessionPath = this.file.path;
    bridge.on("event", this.handleBridgeEvent);
    return bridge;
  }

  private async releaseBridge(): Promise<void> {
    if (!this.bridge || !this.sessionPath) return;
    this.bridge.off("event", this.handleBridgeEvent);
    const path = this.sessionPath;
    this.bridge = null;
    this.sessionPath = null;
    await this.plugin.sessions.release(path);
  }

  private handleBridgeEvent = (event: BridgeEvent): void => {
    const cell = this.notebook?.cells.find((candidate) => candidate.id === event.cellId);
    if (!cell) return;
    if (event.event === "status") {
      const status = this.statusElements.get(cell);
      if (status) status.setText(String(event.state ?? ""));
    } else if (event.event === "execution_count") {
      cell.execution_count = typeof event.count === "number" ? event.count : null;
      this.countElements.get(cell)?.setText(`[${cell.execution_count ?? " "}]`);
      this.markDirty();
    } else if (event.event === "clear_output") {
      if (event.wait) this.clearOnNextOutput.add(cell);
      else { cell.outputs = []; this.refreshOutputs(cell); this.markDirty(); }
    } else if (event.event === "output") {
      if (this.clearOnNextOutput.delete(cell)) cell.outputs = [];
      const output = event.output as NotebookOutput;
      (cell.outputs ??= []).push(output);
      if (typeof event.displayId === "string") this.displayOutputs.set(event.displayId, { cell, output });
      this.refreshOutputs(cell);
      this.markDirty();
    } else if (event.event === "update_display" && typeof event.displayId === "string") {
      const target = this.displayOutputs.get(event.displayId);
      if (target) {
        target.output.data = event.data as Record<string, unknown>;
        target.output.metadata = event.metadata as Record<string, unknown>;
        this.refreshOutputs(target.cell);
        this.markDirty();
      }
    } else if (event.event === "input_request") {
      this.showInput(cell, String(event.prompt ?? ""), Boolean(event.password));
    }
  };

  private refreshOutputs(cell: NotebookCell): void {
    const element = this.outputElements.get(cell);
    if (element) renderCellOutputs(element, cell);
  }

  private showInput(cell: NotebookCell, prompt: string, password: boolean): void {
    const host = this.inputElements.get(cell);
    if (!host || !this.bridge) return;
    host.empty();
    host.createEl("label", { text: prompt });
    const input = host.createEl("input", { type: password ? "password" : "text" });
    const submit = () => {
      const value = input.value;
      host.empty();
      void this.bridge?.request("input_reply", { value }).catch((error) => new Notice((error as Error).message));
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
    host.createEl("button", { text: "Submit" }).onclick = submit;
    input.focus();
  }

  private async executeCell(index: number): Promise<boolean> {
    const cell = this.notebook?.cells[index];
    if (!cell || cell.cell_type !== "code") return true;
    if (!cell.id) {
      cell.id = crypto.randomUUID();
      if (this.notebook) this.notebook.nbformat_minor = Math.max(5, this.notebook.nbformat_minor);
    }
    const bridge = await this.getBridge();
    cell.outputs = [];
    cell.execution_count = null;
    for (const [displayId, target] of this.displayOutputs) {
      if (target.cell === cell) this.displayOutputs.delete(displayId);
    }
    this.inputElements.get(cell)?.empty();
    this.refreshOutputs(cell);
    this.countElements.get(cell)?.setText("[ ]");
    this.markDirty();
    const result = await bridge.request<{ status: string; execution_count: number | null }>("execute", { cellId: cell.id, code: sourceText(cell) });
    cell.execution_count = result.execution_count;
    this.countElements.get(cell)?.setText(`[${result.execution_count ?? " "}]`);
    this.inputElements.get(cell)?.empty();
    this.markDirty();
    return result.status === "ok";
  }

  async runCell(index: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.executeCell(index); }
    catch (error) { new Notice((error as Error).message, 10_000); }
    finally { this.busy = false; }
  }

  async runCurrentCell(): Promise<void> { await this.runCell(this.selectedIndex); }

  async runAll(): Promise<void> {
    if (this.busy || !this.notebook) return;
    this.busy = true;
    try {
      for (let index = 0; index < this.notebook.cells.length; index++) {
        if (!(await this.executeCell(index))) break;
      }
    } catch (error) { new Notice((error as Error).message, 10_000); }
    finally { this.busy = false; }
  }

  async interrupt(): Promise<void> {
    try {
      const result = await this.bridge?.request<{ restarted: boolean }>("interrupt", {}, 20_000);
      if (result?.restarted) new Notice("Kernel was restarted because it did not respond to Stop. Its variables were cleared.");
    }
    catch (error) { new Notice((error as Error).message); }
  }

  async restart(): Promise<void> {
    try { await this.bridge?.request("restart", {}, 45_000); }
    catch (error) { new Notice((error as Error).message); }
  }
}
