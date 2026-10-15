export interface ObJupyterSettings {
  defaultPythonPath: string;
  notebookPythonPaths: Record<string, string>;
}

export const DEFAULT_SETTINGS: ObJupyterSettings = {
  defaultPythonPath: "",
  notebookPythonPaths: {}
};

export function normalizeSettings(value: unknown): ObJupyterSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS, notebookPythonPaths: {} };
  const input = value as Record<string, unknown>;
  const paths: Record<string, string> = {};
  if (input.notebookPythonPaths && typeof input.notebookPythonPaths === "object" && !Array.isArray(input.notebookPythonPaths)) {
    for (const [key, path] of Object.entries(input.notebookPythonPaths)) {
      if (typeof path === "string" && path.trim()) paths[key] = path;
    }
  }
  return {
    defaultPythonPath: typeof input.defaultPythonPath === "string" ? input.defaultPythonPath : "",
    notebookPythonPaths: paths
  };
}

export function pythonForNotebook(settings: ObJupyterSettings, path: string): string {
  return settings.notebookPythonPaths[path] || settings.defaultPythonPath;
}

export function renameNotebookBinding(settings: ObJupyterSettings, oldPath: string, newPath: string): boolean {
  if (!(oldPath in settings.notebookPythonPaths)) return false;
  settings.notebookPythonPaths[newPath] = settings.notebookPythonPaths[oldPath];
  delete settings.notebookPythonPaths[oldPath];
  return true;
}
