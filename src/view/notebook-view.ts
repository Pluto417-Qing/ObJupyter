import path from "node:path";
import { FileSystemAdapter, MarkdownRenderer, Modal, Notice, setIcon, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import type ObJupyterPlugin from "../main";
import type { BridgeEvent, BridgeClient } from "../kernel/bridge-client";
import type { Notebook, NotebookCell, NotebookOutput } from "../notebook/model";
import { isOutputCollapsed, moveCell, newCell, setOutputCollapsed, setSource, sourceText } from "../notebook/model";
import { parseNotebook, serializeNotebook } from "../notebook/serializer";
import { pythonForNotebook } from "../settings";
import { createCellEditor } from "./cell-editor";
import { markdownWithAttachments, outputPlaceholderText, renderCellOutputs } from "./output-renderer";
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
  private lastDeleteKey = 0;
  private busy = false;
  private bridge: BridgeClient | null = null;
  private sessionPath: string | null = null;
  private editors: EditorView[] = [];
  private cellElements: HTMLElement[] = [];
  private cellTypeSelect: HTMLSelectElement | null = null;
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
    this.cellElements = [];
    this.cellTypeSelect = null;
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
    this.cellElements = [];
    this.cellTypeSelect = null;
    this.outputElements.clear();
    this.countElements.clear();
    this.statusElements.clear();
    this.inputElements.clear();
    this.contentEl.empty();
    this.contentEl.addClass("objupyter-view");
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.notebook.cells.length - 1));
    const layout = this.contentEl.createDiv({ cls: "objupyter-layout" });
    layout.addEventListener("keydown", this.handleNotebookKeyDown, true);
    const python = this.file ? pythonForNotebook(this.plugin.settings, this.file.path) : "";
    this.cellTypeSelect = renderToolbar(layout, python, this.notebook.cells[this.selectedIndex]?.cell_type ?? null, {
      create: () => this.addCell("code"),
      runCurrent: () => void this.runCurrentCell(),
      runAll: () => void this.runAll(),
      interrupt: () => void this.interrupt(),
      restart: () => void this.restart(),
      choosePython: () => void this.choosePython(),
      changeCellType: (type) => {
        const cell = this.notebook?.cells[this.selectedIndex];
        if (cell) this.changeCellType(cell, type);
      }
    });
    const list = layout.createDiv({ cls: "objupyter-cells" });
    this.notebook.cells.forEach((cell, index) => this.renderCell(list, cell, index));
    this.selectCell(this.selectedIndex);
    const footer = layout.createDiv({ cls: "objupyter-footer" });
    footer.createEl("button", { text: "+ Code" }).onclick = () => this.addCell("code");
    footer.createEl("button", { text: "+ Markdown" }).onclick = () => this.addCell("markdown");
  }

  private renderCell(parent: HTMLElement, cell: NotebookCell, index: number): void {
    const card = parent.createDiv({ cls: `objupyter-cell objupyter-${cell.cell_type}-cell`, attr: { tabindex: "0", "aria-label": `${cell.cell_type} cell ${index + 1}` } });
    this.cellElements.push(card);
    card.addEventListener("focusin", () => {
      this.selectCell(index);
    });
    card.addEventListener("click", (event) => {
      this.selectCell(index);
      if (event.target instanceof Element && !event.target.closest(".cm-editor, button, a, input, select")) card.focus();
    });
    const header = card.createDiv({ cls: "objupyter-cell-header" });
    const status = header.createSpan({ cls: "objupyter-status", attr: { "aria-live": "polite" } });
    this.statusElements.set(cell, status);
    const action = (icon: string, label: string, click: () => void, disabled = false) => {
      const control = header.createEl("button", { cls: "objupyter-cell-action", attr: { type: "button", "aria-label": label, title: label } });
      setIcon(control, icon);
      control.disabled = disabled;
      control.onclick = (event) => { event.stopPropagation(); click(); };
    };
    if (cell.cell_type === "code") action("play", "Run cell", () => void this.runCell(index));
    if (cell.cell_type === "markdown") action("eye", "Toggle Markdown preview", () => this.toggleMarkdownPreview(card, cell));
    action("arrow-up", "Move cell up", () => this.move(index, index - 1), index === 0);
    action("arrow-down", "Move cell down", () => this.move(index, index + 1), index === (this.notebook?.cells.length ?? 0) - 1);
    action("trash-2", "Delete cell", () => this.deleteCell(index));
    const inputRow = card.createDiv({ cls: "objupyter-input-row" });
    const count = inputRow.createSpan({ text: cell.cell_type === "code" ? `In [${cell.execution_count ?? " "}]:` : "", cls: "objupyter-count" });
    this.countElements.set(cell, count);
    const inputBody = inputRow.createDiv({ cls: "objupyter-input-body" });
    const editorHost = inputBody.createDiv({ cls: `objupyter-editor${cell.cell_type === "markdown" ? " is-hidden" : ""}` });
    const editor = createCellEditor(editorHost, cell, (source) => { setSource(cell, source); this.markDirty(); });
    this.editors.push(editor);
    const preview = inputBody.createDiv({ cls: `objupyter-markdown-preview${cell.cell_type === "markdown" ? "" : " is-hidden"}` });
    if (cell.cell_type === "markdown") {
      void MarkdownRenderer.render(this.app, markdownWithAttachments(cell), preview, this.file?.path ?? "", this);
      preview.addEventListener("dblclick", () => this.enterEditMode(index));
    }
    if (cell.cell_type === "code") {
      const outputWrapper = card.createDiv({ cls: "objupyter-output-wrapper" });
      const collapser = outputWrapper.createEl("button", { cls: "objupyter-output-collapser", attr: { type: "button" } });
      const outputHost = outputWrapper.createDiv({ cls: "objupyter-outputs" });
      outputHost.id = `objupyter-output-${crypto.randomUUID()}`;
      collapser.setAttribute("aria-controls", outputHost.id);
      const placeholder = outputWrapper.createEl("button", { cls: "objupyter-output-placeholder", attr: { type: "button", title: "Click to expand output", "aria-label": "Expand output", "aria-expanded": "false", "aria-controls": outputHost.id } });
      placeholder.createSpan({ cls: "objupyter-output-placeholder-prompt" });
      const summary = placeholder.createSpan({ cls: "objupyter-output-placeholder-summary" });
      summary.createSpan({ cls: "objupyter-output-placeholder-text" });
      summary.createSpan({ text: "⋯", cls: "objupyter-output-placeholder-ellipsis", attr: { "aria-hidden": "true" } });
      const toggle = (event: MouseEvent) => {
        event.stopPropagation();
        this.selectCell(index);
        setOutputCollapsed(cell, !isOutputCollapsed(cell));
        this.updateOutputCollapse(cell);
        this.markDirty();
        collapser.focus();
      };
      collapser.onclick = toggle;
      placeholder.onclick = toggle;
      this.outputElements.set(cell, outputHost);
      this.refreshOutputs(cell);
    }
    this.inputElements.set(cell, card.createDiv({ cls: "objupyter-input-area" }));
  }

  private selectCell(index: number): void {
    if (!this.notebook?.cells[index]) return;
    if (index !== this.selectedIndex) this.lastDeleteKey = 0;
    this.selectedIndex = index;
    this.cellElements.forEach((element, position) => element.toggleClass("is-selected", position === index));
    if (this.cellTypeSelect) this.cellTypeSelect.value = this.notebook.cells[index].cell_type;
  }

  private enterEditMode(index: number): void {
    const cell = this.notebook?.cells[index];
    if (!cell) return;
    this.selectCell(index);
    if (cell.cell_type === "markdown") this.setMarkdownPreview(index, false);
    this.editors[index]?.focus();
  }

  private enterCommandMode(index: number): void {
    if (!this.notebook?.cells[index]) return;
    if (this.notebook.cells[index].cell_type === "markdown") this.setMarkdownPreview(index, true);
    this.selectCell(index);
    this.cellElements[index]?.focus();
  }

  private setMarkdownPreview(index: number, show: boolean): void {
    const cell = this.notebook?.cells[index];
    const card = this.cellElements[index];
    if (cell?.cell_type !== "markdown" || !card) return;
    const editor = card.querySelector<HTMLElement>(".objupyter-editor");
    const preview = card.querySelector<HTMLElement>(".objupyter-markdown-preview");
    if (!editor || !preview) return;
    const wasHidden = preview.hasClass("is-hidden");
    editor.toggleClass("is-hidden", show);
    preview.toggleClass("is-hidden", !show);
    if (show && wasHidden) {
      preview.empty();
      void MarkdownRenderer.render(this.app, markdownWithAttachments(cell), preview, this.file?.path ?? "", this);
    }
  }

  private toggleMarkdownPreview(card: HTMLElement, cell: NotebookCell): void {
    const preview = card.querySelector<HTMLElement>(".objupyter-markdown-preview");
    const index = this.notebook?.cells.indexOf(cell) ?? -1;
    if (!preview || index < 0) return;
    if (preview.hasClass("is-hidden")) this.enterCommandMode(index);
    else this.enterEditMode(index);
  }

  private handleNotebookKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || !(event.target instanceof Element)) return;
    const card = event.target.closest<HTMLElement>(".objupyter-cell");
    if (!card || event.target.closest("button, input, select, a")) return;
    const index = this.cellElements.indexOf(card);
    if (index < 0 || !this.notebook?.cells[index]) return;
    const editing = Boolean(event.target.closest(".cm-editor"));
    const key = event.key.toLowerCase();
    const runKey = key === "enter" && !event.repeat && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey);
    if (runKey) {
      event.preventDefault();
      event.stopPropagation();
      this.lastDeleteKey = 0;
      if (event.altKey) {
        this.runAndAdvance(index, true);
      } else if (event.shiftKey) {
        this.runAndAdvance(index, false);
      } else {
        if (this.notebook.cells[index].cell_type !== "code") this.enterCommandMode(index);
        else void this.runCell(index);
      }
      return;
    }
    if (key === "escape" && editing) {
      event.preventDefault();
      event.stopPropagation();
      this.lastDeleteKey = 0;
      this.enterCommandMode(index);
      return;
    }
    if (editing || event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && key !== "enter")) return;
    const command = ["enter", "arrowup", "arrowdown", "a", "b", "m", "y", "r", "d"].includes(key);
    if (!command) { this.lastDeleteKey = 0; return; }
    event.preventDefault();
    event.stopPropagation();
    if (key === "d") {
      if (!event.repeat && Date.now() - this.lastDeleteKey < 1000) {
        this.lastDeleteKey = 0;
        this.deleteCell(index);
      } else this.lastDeleteKey = Date.now();
      return;
    }
    this.lastDeleteKey = 0;
    if (key === "enter") this.enterEditMode(index);
    else if (key === "arrowup") this.enterCommandMode(Math.max(0, index - 1));
    else if (key === "arrowdown") this.enterCommandMode(Math.min(this.notebook.cells.length - 1, index + 1));
    else if (key === "a") this.insertCell(index, "code");
    else if (key === "b") this.insertCell(index + 1, "code");
    else if (key === "m") this.changeCellType(this.notebook.cells[index], "markdown");
    else if (key === "y") this.changeCellType(this.notebook.cells[index], "code");
    else if (key === "r") this.changeCellType(this.notebook.cells[index], "raw");
  };

  private runAndAdvance(index: number, insert: boolean): void {
    const notebook = this.notebook;
    const cell = notebook?.cells[index];
    if (!cell) return;
    if (cell.cell_type === "code") void this.runCell(index);
    else if (cell.cell_type === "markdown") this.setMarkdownPreview(index, true);
    if (insert || index === notebook.cells.length - 1) this.insertCell(index + 1, "code");
    else this.enterCommandMode(index + 1);
  }

  private addCell(type: "code" | "markdown"): void {
    this.insertCell(this.selectedIndex + 1, type);
  }

  private insertCell(index: number, type: "code" | "markdown"): void {
    if (!this.notebook) return;
    this.notebook.nbformat_minor = Math.max(5, this.notebook.nbformat_minor);
    this.notebook.cells.splice(index, 0, newCell(type));
    this.selectedIndex = index;
    this.markDirty();
    this.render();
    this.enterCommandMode(index);
  }

  private deleteCell(index: number): void {
    if (!this.notebook) return;
    this.notebook.cells.splice(index, 1);
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.notebook.cells.length - 1));
    this.markDirty();
    this.render();
    this.enterCommandMode(this.selectedIndex);
  }

  private move(from: number, to: number): void {
    if (!this.notebook || !moveCell(this.notebook, from, to)) return;
    this.selectedIndex = to;
    this.markDirty();
    this.render();
    this.enterCommandMode(to);
  }

  private changeCellType(cell: NotebookCell, type: NotebookCell["cell_type"]): void {
    if (this.busy || cell.cell_type === type) {
      if (this.cellTypeSelect) this.cellTypeSelect.value = cell.cell_type;
      return;
    }
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
    this.enterCommandMode(this.selectedIndex);
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
      this.countElements.get(cell)?.setText(`In [${cell.execution_count ?? " "}]:`);
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
    if (!element) return;
    renderCellOutputs(element, cell);
    this.updateOutputCollapse(cell);
  }

  private updateOutputCollapse(cell: NotebookCell): void {
    const output = this.outputElements.get(cell);
    const wrapper = output?.parentElement;
    if (!output || !wrapper) return;
    const collapsed = isOutputCollapsed(cell);
    wrapper.toggleClass("has-outputs", Boolean(cell.outputs?.length));
    wrapper.toggleClass("is-collapsed", collapsed);
    const collapser = wrapper.querySelector<HTMLButtonElement>(".objupyter-output-collapser");
    if (collapser) {
      collapser.setAttribute("aria-label", collapsed ? "Expand output" : "Collapse output");
      collapser.setAttribute("aria-expanded", String(!collapsed));
      collapser.title = collapsed ? "Expand output" : "Collapse output";
    }
    wrapper.querySelector<HTMLElement>(".objupyter-output-placeholder-text")?.setText(outputPlaceholderText(cell));
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
    this.countElements.get(cell)?.setText("In [ ]:");
    this.markDirty();
    const result = await bridge.request<{ status: string; execution_count: number | null }>("execute", { cellId: cell.id, code: sourceText(cell) });
    cell.execution_count = result.execution_count;
    this.countElements.get(cell)?.setText(`In [${result.execution_count ?? " "}]:`);
    this.refreshOutputs(cell);
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
