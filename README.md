# ObJupyter

[English](README.en.md)

在 Obsidian 中打开、编辑和运行 Jupyter 笔记本。代码、Markdown 和运行结果保存在同一个 `.ipynb` 文件中。

## 功能

- 打开仓库中的 `.ipynb` 文件，或通过命令面板新建笔记本。
- 编辑 Code、Markdown 和 Raw 单元格，添加、删除、移动或切换单元格类型。
- 运行当前单元格或依次运行全部代码单元格，并可中断或重启 Python 内核。
- 在单元格下方查看文本、错误、图片及 HTML 输出，支持 `input()` 交互。
- 自动保存编辑内容和运行结果；Markdown 单元格支持预览。
- 设置默认 Python 解释器，也可为每个笔记本单独选择。

## 使用

在仓库中打开 `.ipynb` 文件，选择本机 Python 解释器，然后点击单元格旁的运行按钮。首次运行时，如果所选环境缺少 `jupyter_client` 或 `ipykernel`，插件会显示缺少的包及安装命令。请在 PowerShell 中自行运行，例如：

```powershell
& "C:\path\to\python.exe" -m pip install jupyter_client ipykernel
```

安装完成后重新运行单元格，插件会再次检查环境。插件本身不会安装或更新 Python 包。只查看和编辑笔记本时不需要 Python；执行代码需要本机 Python 以及上述两个包。插件会运行你指定的 Python 解释器，并在该环境中启动内核，因此请只运行可信的笔记本。

目前支持 **Windows 桌面版 Obsidian**，需要 Obsidian 1.5.0 或更新版本。运行代码需要本机 Python 环境。

## 安装与许可

目前尚未上架 Obsidian 社区插件目录。上架后，插件文件可直接从社区插件市场安装；Python 运行环境仍需单独准备。项目采用 [MIT 许可证](LICENSE)。
