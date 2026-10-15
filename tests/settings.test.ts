import { describe, expect, it } from "vitest";
import { normalizeSettings, pythonForNotebook, renameNotebookBinding } from "../src/settings";

describe("Python bindings", () => {
  it("uses notebook binding before the default", () => {
    const settings = normalizeSettings({ defaultPythonPath: "C:\\Python\\python.exe", notebookPythonPaths: { "a.ipynb": "D:\\venv\\python.exe" } });
    expect(pythonForNotebook(settings, "a.ipynb")).toBe("D:\\venv\\python.exe");
    expect(pythonForNotebook(settings, "b.ipynb")).toBe("C:\\Python\\python.exe");
  });

  it("moves a binding when its notebook is renamed", () => {
    const settings = normalizeSettings({ notebookPythonPaths: { "old.ipynb": "python.exe" } });
    expect(renameNotebookBinding(settings, "old.ipynb", "folder/new.ipynb")).toBe(true);
    expect(settings.notebookPythonPaths).toEqual({ "folder/new.ipynb": "python.exe" });
  });
});
