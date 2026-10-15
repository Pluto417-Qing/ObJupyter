import { basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { NotebookCell } from "../notebook/model";
import { sourceText } from "../notebook/model";

export function createCellEditor(parent: HTMLElement, cell: NotebookCell, onChange: (source: string) => void): EditorView {
  const state = EditorState.create({
    doc: sourceText(cell),
    extensions: [
      basicSetup,
      EditorView.lineWrapping,
      ...(cell.cell_type === "code" ? [python()] : cell.cell_type === "markdown" ? [markdown()] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      })
    ]
  });
  return new EditorView({ state, parent });
}
