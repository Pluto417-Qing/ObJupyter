import type { ObJupyterSettings } from "../settings";

export async function saveNotebookEnvironmentBinding(settings: ObJupyterSettings, filePath: string, chosen: string, save: () => Promise<void>): Promise<void> {
  const previous = settings.notebookPythonPaths[filePath];
  if (chosen) settings.notebookPythonPaths[filePath] = chosen;
  else delete settings.notebookPythonPaths[filePath];
  try { await save(); }
  catch (error) {
    if (previous === undefined) delete settings.notebookPythonPaths[filePath];
    else settings.notebookPythonPaths[filePath] = previous;
    throw error;
  }
}
