# ObJupyter

<div align="center">
  <img src="docs/assets/objupyter-banner.svg" alt="ObJupyter notebook editor with Markdown, Python, and output cells" width="100%" />
  <p><strong>Keep ideas, code, and results together in your knowledge base.</strong></p>
  <p>
    <a href="manifest.json"><img src="docs/assets/badge-version.svg" alt="Version 0.1.0" /></a>
    <a href="#getting-started"><img src="docs/assets/badge-obsidian.svg" alt="Requires Obsidian 1.5 or later" /></a>
    <a href="#getting-started"><img src="docs/assets/badge-windows.svg" alt="Windows desktop" /></a>
    <a href="#features"><img src="docs/assets/badge-nbformat.svg" alt="Notebook v4 format" /></a>
    <a href="#support"><img src="docs/assets/badge-coffee.svg" alt="Support ObJupyter" /></a>
  </p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="#features">Features</a> · <a href="#getting-started">Getting started</a> · <a href="#support">Support</a></p>
</div>

---

Open, edit, and run Jupyter notebooks in Obsidian. Keep code, Markdown, and results together in a standard `.ipynb` file.

## Features

- Open `.ipynb` files in your vault or create notebooks from the command palette.
- Edit Code, Markdown, and Raw cells; add, delete, move, or change cell types.
- Run a cell or all code cells in order, and interrupt or restart the Python kernel.
- View text, errors, images, and HTML output below cells, with support for `input()` prompts.
- Automatically save edits and results, and preview Markdown cells.
- Set a default Python interpreter or choose one for each notebook.

## Getting started

Open an `.ipynb` file in your vault, choose a local Python interpreter, and click a cell's run button. If the selected environment lacks `jupyter_client` or `ipykernel`, the plugin shows the missing packages and a command to run yourself in PowerShell, for example:

```powershell
& "C:\path\to\python.exe" -m pip install jupyter_client ipykernel
```

Run the cell again after installation; the plugin checks the environment again. The plugin does not install or update Python packages. Viewing and editing notebooks does not require Python. Running code requires local Python and those two packages. The plugin launches your selected interpreter and a kernel in that environment, so run only notebooks you trust.

ObJupyter currently supports **Obsidian Desktop on Windows** and requires Obsidian 1.5.0 or later. Running code requires a local Python environment.

## Installation and license

ObJupyter is not yet listed in the Obsidian Community plugin directory. Once listed, its plugin files can be installed directly from the directory; a Python runtime must still be provided separately. This project is licensed under the [MIT License](LICENSE).

## Support

If ObJupyter is useful to you, you can voluntarily support its continued development and maintenance through WeChat Pay or Alipay. Donations do not unlock features and are not required to use the plugin or report issues.

<details>
<summary><img src="docs/assets/badge-coffee.svg" alt="Buy me a coffee; click to reveal payment QR codes" /> Show payment QR codes</summary>

| WeChat Pay | Alipay |
| :---: | :---: |
| <img src="assets/support/wechat-pay.jpg" alt="WeChat Pay QR code" width="240"> | <img src="assets/support/alipay.jpg" alt="Alipay QR code" width="240"> |

</details>
