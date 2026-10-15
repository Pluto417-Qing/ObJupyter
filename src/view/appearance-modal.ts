import { App, Modal } from "obsidian";
import type ObJupyterPlugin from "../main";
import type { AppearanceSettings } from "../settings";

const COLORS: { key: keyof AppearanceSettings; label: string; themeVariable: string }[] = [
  { key: "codeBackground", label: "Code cell background", themeVariable: "--background-primary-alt" },
  { key: "markdownBackground", label: "Markdown cell background", themeVariable: "--background-primary" },
  { key: "outputBackground", label: "Output background", themeVariable: "--background-primary" },
  { key: "accentColor", label: "Selection accent", themeVariable: "--interactive-accent" }
];

function themeColor(container: HTMLElement, variable: string): string {
  const sample = container.createSpan();
  sample.style.backgroundColor = `var(${variable})`;
  const rgb = getComputedStyle(sample).backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  sample.remove();
  return rgb ? `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : "#808080";
}

export class AppearanceModal extends Modal {
  constructor(app: App, private plugin: ObJupyterPlugin) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Notebook appearance");
    this.contentEl.createEl("p", { text: "Choose colors for notebook cells. Theme colors are used when a color is reset." });
    for (const { key, label, themeVariable } of COLORS) {
      const fallback = themeColor(this.contentEl, themeVariable);
      const row = this.contentEl.createDiv({ cls: "objupyter-color-setting" });
      const id = `objupyter-color-${key}`;
      row.createEl("label", { text: label, attr: { for: id } });
      const picker = row.createEl("input", { type: "color", cls: "objupyter-color-picker", attr: { id, "aria-label": label } });
      picker.value = this.plugin.settings.appearance[key] || fallback;
      picker.onchange = () => void this.plugin.setAppearanceColor(key, picker.value);
      const reset = row.createEl("button", { text: "Theme default", attr: { type: "button", "aria-label": `Reset ${label.toLowerCase()} to theme default` } });
      reset.disabled = !this.plugin.settings.appearance[key];
      picker.addEventListener("change", () => { reset.disabled = false; });
      reset.onclick = () => {
        void this.plugin.setAppearanceColor(key, "");
        picker.value = fallback;
        reset.disabled = true;
      };
    }
    const actions = this.contentEl.createDiv({ cls: "objupyter-modal-actions" });
    actions.createEl("button", { text: "Reset all colors", attr: { type: "button" } }).onclick = () => {
      void this.plugin.resetAppearance();
      this.close();
    };
    actions.createEl("button", { text: "Done", cls: "mod-cta", attr: { type: "button" } }).onclick = () => this.close();
  }
}
