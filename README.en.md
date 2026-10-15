# ObJupyter

<div align="center">
  <img src="docs/assets/objupyter-banner.svg" alt="ObJupyter notebook editor with Markdown, Python, and output cells" width="100%" />
  <p><strong>Keep ideas, code, and results together in your knowledge base.</strong></p>
  <p>
    <a href="manifest.json"><img src="docs/assets/badge-version.svg" alt="Version 0.1.0" /></a>
    <a href="#installation"><img src="docs/assets/badge-obsidian.svg" alt="Requires Obsidian 1.5 or later" /></a>
    <a href="#current-limitations"><img src="docs/assets/badge-windows.svg" alt="Windows desktop" /></a>
    <a href="#output-and-saving"><img src="docs/assets/badge-nbformat.svg" alt="Notebook v4 format" /></a>
    <a href="#support"><img src="docs/assets/badge-coffee.svg" alt="Support ObJupyter" /></a>
  </p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="#installation">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#python-environments">Python environments</a> · <a href="#support">Support</a></p>
</div>

---

Edit and run Jupyter notebooks inside Obsidian, keeping code, notes, and results together in a standard `.ipynb` file.

> ObJupyter is an early release for **Obsidian Desktop on Windows**. It starts a local Python kernel and is not listed in the Obsidian community plugin directory.

## Features

| Area | What ObJupyter provides |
| --- | --- |
| Notebook files | Open existing `.ipynb` files in your vault or create new ones from the command palette |
| Cell editing | Edit Code, Markdown, and Raw cells; add, delete, reorder, and change cell types |
| Python execution | Run one cell or all code cells in order; interrupt or restart the kernel |
| Environment binding | Set a default Python executable or override it for each notebook |
| Results | View text, errors, PNG, SVG, and sanitized HTML output; answer `input()` prompts |
| Saving | Automatically save edits and results while retaining untouched metadata and MIME data |

Code cells use CodeMirror. Markdown cells can switch between editing and an Obsidian-rendered preview. Each open notebook keeps a live kernel, so later cells can use variables created by earlier ones.

## Installation

### Requirements

- Obsidian Desktop for Windows, version `1.5.0` or later.
- A working Python executable, such as `python.exe` from a regular installation, venv, or Conda environment. Python is needed to run cells, but not to open and edit notebooks.
- Node.js and npm to build the plugin from source.

There is no prebuilt release yet. Build from this repository:

```powershell
npm ci
npm run build
```

Copy the three generated or supplied files to your vault:

```text
<your vault>/.obsidian/plugins/objupyter/
├── main.js
├── manifest.json
└── styles.css
```

Reload Obsidian and enable **ObJupyter** under **Settings → Community plugins**. If your vault uses a custom configuration directory, replace `.obsidian` in the path above. The Python bridge is embedded in `main.js`; no separate `.py` file is needed for installation.

## Quick start

1. Open an `.ipynb` file in your vault, or choose **Create Jupyter notebook** from the command palette. New files are placed beside the current file; a numeric suffix avoids overwriting an existing name.
2. Click **Choose Python…** in the notebook toolbar and enter the full path to `python.exe`. You can also set a default interpreter in ObJupyter settings.
3. Write Python in a Code cell and click its **▶** button, or choose **Run cell** in the toolbar. For example:

   ```python
   numbers = [2, 4, 6]
   print(sum(numbers))
   ```

   The result appears below the cell and is saved with the notebook.
4. Choose **Run all** to execute code cells in order. Execution stops after the first error. **Stop** interrupts the running cell; **Restart** starts a fresh kernel with no previous variables.

The cell header contains controls for type, moving, and deletion. Add Code or Markdown cells at the bottom. Use **Preview** on a Markdown cell to toggle its preview.

## Python environments

Enter an **absolute path** to the interpreter, such as `C:\Projects\demo\.venv\Scripts\python.exe`. ObJupyter starts that executable directly, so venv or Conda activation is unnecessary. It does not discover or create environments automatically.

The default path lives in plugin settings. A notebook-specific selection takes precedence and is stored under that notebook's vault path in plugin settings, not inside the `.ipynb` file. After syncing a vault to another computer, select a valid interpreter path on that device.

Before the first run, ObJupyter checks for `jupyter_client` and `ipykernel`. If either is missing, it shows the command and asks before installing into the **selected environment**:

```powershell
& "C:\path\to\python.exe" -m pip install jupyter_client ipykernel
```

If installation fails, the error includes a command you can run manually. Other packages used by your code, such as `numpy`, must also be installed in the selected environment. ObJupyter currently manages only the dependencies needed to start its kernel.

Each open notebook has a local kernel whose working directory is the notebook's folder. Closing the notebook or unloading the plugin shuts it down. Changing the Python selection closes the old kernel; the new one starts on the next run.

## Output and saving

- Text, errors, PNG, SVG, and common HTML results appear below the cell. HTML and SVG are sanitized before display. Unknown MIME data is retained in the notebook even when it cannot be rendered.
- `input()` prompts appear below the running cell. Password input is hidden and is not saved to the notebook.
- Obsidian's file view saves edits and results after a short delay as Notebook v4 JSON. Invalid `.ipynb` files show an error and are not replaced with a blank notebook.
- If a file changes outside Obsidian while the view has unsaved edits, ObJupyter asks which version to keep.
- If a Windows kernel does not respond to **Stop** promptly, ObJupyter restarts it. This clears in-memory variables but leaves code and saved output in the file.

## Current limitations

- This release targets Windows desktop and files inside an Obsidian vault. Remote Jupyter servers are unsupported.
- JavaScript-powered Jupyter widgets are unsupported. Other rich output formats may show a text placeholder, while their original data remains in the file.
- There is no environment discovery, environment creation, or general package manager UI. Enter an interpreter path and install your code's dependencies in that environment.
- Notebook cells do not automatically appear in Obsidian's graph, backlinks, or native Properties index.

Running notebook code has the same local permissions as running a Python script. Run only notebooks you trust. Installing kernel dependencies changes the selected Python environment.

## Troubleshooting

**The file explorer does not show `.ipynb` files.** Enable **Detect all file extensions** under Obsidian's **Files and links** settings, then reload the vault. If another plugin also handles `.ipynb`, use only one notebook view plugin at a time.

**Python cannot be started.** Check that the full path in settings or the notebook toolbar points to an existing, working `python.exe`.

**Dependency installation fails.** Run the command shown in the error message manually. Some Python environments do not include `pip`; install it using that environment's package manager first.

**Your code cannot import a third-party package.** Confirm the selected environment and install the package with that interpreter, for example `& "C:\path\to\python.exe" -m pip install numpy`. Restart the notebook kernel afterward.

## Support

If ObJupyter is useful to you, you can voluntarily support its continued development and maintenance through WeChat Pay or Alipay. Donations do not unlock features and are not required to use the plugin or report issues.

<details>
<summary><img src="docs/assets/badge-coffee.svg" alt="Buy me a coffee; click to reveal payment QR codes" /> Show payment QR codes</summary>

| WeChat Pay | Alipay |
| :---: | :---: |
| <img src="assets/support/wechat-pay.jpg" alt="WeChat Pay QR code" width="240"> | <img src="assets/support/alipay.jpg" alt="Alipay QR code" width="240"> |

</details>

## Development

The plugin uses TypeScript, CodeMirror 6, and esbuild. The bridge in `src/bridge/bridge.py` manages the kernel through `jupyter_client`. Main implementation areas are `src/notebook/`, `src/view/`, and `src/kernel/`.

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Run real-kernel integration tests in an isolated Python environment:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install jupyter_client ipykernel
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_bridge.py -v
```

Automated checks cover notebook serialization, environment bindings, and real-kernel state, output, input, interruption, and restart. Manual verification inside Obsidian still requires a test vault.
