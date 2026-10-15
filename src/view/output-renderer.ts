import DOMPurify from "dompurify";
import type { NotebookCell, NotebookOutput } from "../notebook/model";

function asText(value: unknown): string {
  return Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "";
}

function appendText(parent: HTMLElement, text: string, className = ""): void {
  parent.createEl("pre", { text, cls: className });
}

function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style"]
  });
}

function safeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "animate", "set"],
    FORBID_ATTR: ["onload", "onclick", "href", "xlink:href", "style"]
  });
}

export function renderOutput(parent: HTMLElement, output: NotebookOutput): void {
  if (output.output_type === "stream") {
    appendText(parent, asText(output.text), output.name === "stderr" ? "objupyter-stderr" : "");
    return;
  }
  if (output.output_type === "error") {
    const traceback = output.traceback?.join("\n") || `${output.ename ?? "Error"}: ${output.evalue ?? ""}`;
    appendText(parent, traceback.replace(/\x1b\[[0-9;]*m/g, ""), "objupyter-error");
    return;
  }
  const data = output.data ?? {};
  const png = asText(data["image/png"]);
  if (png && /^[A-Za-z0-9+/=\s]+$/.test(png)) {
    parent.createEl("img", { attr: { src: `data:image/png;base64,${png.replace(/\s/g, "")}`, alt: "Notebook output" } });
    return;
  }
  const svg = asText(data["image/svg+xml"]);
  if (svg) {
    const clean = safeSvg(svg);
    parent.createEl("img", { attr: { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`, alt: "Notebook output" } });
    return;
  }
  const html = asText(data["text/html"]);
  if (html) {
    const element = parent.createDiv({ cls: "objupyter-html-output" });
    element.innerHTML = safeHtml(html);
    return;
  }
  appendText(parent, asText(data["text/plain"]) || "[Unsupported output type]");
}

export function renderCellOutputs(parent: HTMLElement, cell: NotebookCell): void {
  parent.empty();
  for (const output of cell.outputs ?? []) {
    const outputEl = parent.createDiv({ cls: "objupyter-output" });
    renderOutput(outputEl, output);
  }
}

export function markdownWithAttachments(cell: NotebookCell): string {
  const source = asText(cell.source);
  return source.replace(/attachment:([^\s)"']+)/g, (match, name: string) => {
    let decoded = name;
    try { decoded = decodeURIComponent(name); } catch { return match; }
    const bundle = cell.attachments?.[decoded];
    if (!bundle) return match;
    const png = asText(bundle["image/png"]);
    if (png && /^[A-Za-z0-9+/=\s]+$/.test(png)) return `data:image/png;base64,${png.replace(/\s/g, "")}`;
    const svg = asText(bundle["image/svg+xml"]);
    if (svg) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg(svg))}`;
    return match;
  });
}
