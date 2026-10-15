import type { Notebook, NotebookCell } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSource(value: unknown): boolean {
  return typeof value === "string" || (Array.isArray(value) && value.every((part) => typeof part === "string"));
}

export function parseNotebook(text: string): Notebook {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(value) || value.nbformat !== 4 || !Number.isInteger(value.nbformat_minor) || !isRecord(value.metadata) || !Array.isArray(value.cells)) {
    throw new Error("Only valid Jupyter Notebook v4 files are supported.");
  }
  const ids = new Set<string>();
  for (const [index, raw] of value.cells.entries()) {
    if (!isRecord(raw) || !["code", "markdown", "raw"].includes(String(raw.cell_type)) || !isRecord(raw.metadata) || !validSource(raw.source)) {
      throw new Error(`Invalid cell at index ${index}.`);
    }
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || ids.has(raw.id)) throw new Error(`Invalid or duplicate cell ID at index ${index}.`);
      ids.add(raw.id);
    }
    if (raw.cell_type === "code" && (!Array.isArray(raw.outputs) || raw.execution_count !== null && !Number.isInteger(raw.execution_count))) {
      throw new Error(`Invalid code cell at index ${index}.`);
    }
  }
  return value as unknown as Notebook;
}

export function serializeNotebook(notebook: Notebook): string {
  return `${JSON.stringify(notebook, null, 2)}\n`;
}

export function cellKey(cell: NotebookCell, index: number): string {
  return cell.id ?? `legacy-${index}`;
}
