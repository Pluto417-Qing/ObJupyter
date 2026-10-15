export type MimeBundle = Record<string, unknown>;

export interface NotebookOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: string;
  text?: string | string[];
  data?: MimeBundle;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  [key: string]: unknown;
}

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  metadata: Record<string, unknown>;
  source: string | string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
  attachments?: Record<string, MimeBundle>;
  [key: string]: unknown;
}

export interface Notebook {
  nbformat: 4;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
  [key: string]: unknown;
}

export function sourceText(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join("") : cell.source;
}

export function setSource(cell: NotebookCell, value: string): void {
  cell.source = value;
}

export function isOutputCollapsed(cell: NotebookCell): boolean {
  return cell.metadata.collapsed === true;
}

export function setOutputCollapsed(cell: NotebookCell, collapsed: boolean): void {
  if (collapsed) cell.metadata.collapsed = true;
  else delete cell.metadata.collapsed;
}

export function newCell(type: "code" | "markdown", source = ""): NotebookCell {
  const base: NotebookCell = {
    cell_type: type,
    id: crypto.randomUUID(),
    metadata: {},
    source
  };
  if (type === "code") {
    base.outputs = [];
    base.execution_count = null;
  }
  return base;
}

export function createNotebook(): Notebook {
  return {
    cells: [newCell("code")],
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5
  };
}

export function moveCell(notebook: Notebook, from: number, to: number): boolean {
  if (from < 0 || to < 0 || from >= notebook.cells.length || to >= notebook.cells.length || from === to) return false;
  const [cell] = notebook.cells.splice(from, 1);
  notebook.cells.splice(to, 0, cell);
  return true;
}
