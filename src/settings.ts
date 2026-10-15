export interface ObJupyterSettings {
  defaultPythonPath: string;
  notebookPythonPaths: Record<string, string>;
  appearance: AppearanceSettings;
}

export interface AppearanceSettings {
  codeBackground: string;
  markdownBackground: string;
  outputBackground: string;
  accentColor: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  codeBackground: "",
  markdownBackground: "",
  outputBackground: "",
  accentColor: ""
};

function color(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "";
}

export const DEFAULT_SETTINGS: ObJupyterSettings = {
  defaultPythonPath: "",
  notebookPythonPaths: {},
  appearance: { ...DEFAULT_APPEARANCE }
};

export function normalizeSettings(value: unknown): ObJupyterSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS, notebookPythonPaths: {}, appearance: { ...DEFAULT_APPEARANCE } };
  const input = value as Record<string, unknown>;
  const appearance = input.appearance && typeof input.appearance === "object" && !Array.isArray(input.appearance)
    ? input.appearance as Record<string, unknown> : {};
  const paths: Record<string, string> = {};
  if (input.notebookPythonPaths && typeof input.notebookPythonPaths === "object" && !Array.isArray(input.notebookPythonPaths)) {
    for (const [key, path] of Object.entries(input.notebookPythonPaths)) {
      if (typeof path === "string" && path.trim()) paths[key] = path;
    }
  }
  return {
    defaultPythonPath: typeof input.defaultPythonPath === "string" ? input.defaultPythonPath : "",
    notebookPythonPaths: paths,
    appearance: {
      codeBackground: color(appearance.codeBackground),
      markdownBackground: color(appearance.markdownBackground),
      outputBackground: color(appearance.outputBackground),
      accentColor: color(appearance.accentColor)
    }
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
