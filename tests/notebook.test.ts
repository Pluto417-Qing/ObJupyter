import { describe, expect, it } from "vitest";
import { createNotebook, moveCell, newCell, setSource, sourceText } from "../src/notebook/model";
import { parseNotebook, serializeNotebook } from "../src/notebook/serializer";

describe("notebook files", () => {
  it("creates a valid v4.5 notebook and round-trips edits", () => {
    const notebook = createNotebook();
    const id = notebook.cells[0].id;
    setSource(notebook.cells[0], "answer = 42\nanswer");
    notebook.cells[0].outputs = [{ output_type: "execute_result", data: { "text/plain": "42" }, metadata: {}, execution_count: 1 }];
    const reopened = parseNotebook(serializeNotebook(notebook));
    expect(reopened.cells[0].id).toBe(id);
    expect(sourceText(reopened.cells[0])).toBe("answer = 42\nanswer");
    expect(reopened.cells[0].outputs?.[0].data?.["text/plain"]).toBe("42");
  });

  it("preserves unrecognized metadata and MIME data", () => {
    const notebook = createNotebook();
    notebook.metadata.custom = { a: 1 };
    notebook.cells[0].metadata.vendor = true;
    notebook.cells[0].outputs = [{ output_type: "display_data", data: { "application/vnd.example+json": { x: 7 } }, metadata: { vendor: "x" } }];
    const reopened = parseNotebook(serializeNotebook(notebook));
    expect(reopened.metadata.custom).toEqual({ a: 1 });
    expect(reopened.cells[0].metadata.vendor).toBe(true);
    expect(reopened.cells[0].outputs?.[0].data?.["application/vnd.example+json"]).toEqual({ x: 7 });
  });

  it("moves cells without changing their IDs", () => {
    const notebook = createNotebook();
    notebook.cells.push(newCell("markdown", "# Heading"));
    const ids = notebook.cells.map((cell) => cell.id);
    expect(moveCell(notebook, 1, 0)).toBe(true);
    expect(notebook.cells.map((cell) => cell.id)).toEqual(ids.reverse());
  });

  it("rejects invalid JSON and duplicate IDs", () => {
    expect(() => parseNotebook("{" )).toThrow("Invalid JSON");
    const notebook = createNotebook();
    notebook.cells.push({ ...newCell("markdown"), id: notebook.cells[0].id });
    expect(() => parseNotebook(serializeNotebook(notebook))).toThrow("duplicate cell ID");
  });
});
