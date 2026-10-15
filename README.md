# ObJupyter

<div align="center">
  <img src="docs/assets/objupyter-banner.svg" alt="ObJupyter：在 Obsidian 中编辑并运行本地 Jupyter 笔记本" width="100%" />
  <p><strong>让想法、代码与运行结果在同一座知识库相遇。</strong></p>
  <p>
    <a href="manifest.json"><img src="docs/assets/badge-version.svg" alt="版本 0.1.0" /></a>
    <a href="#安装"><img src="docs/assets/badge-obsidian.svg" alt="需要 Obsidian 1.5 或更新版本" /></a>
    <a href="#当前限制"><img src="docs/assets/badge-windows.svg" alt="面向 Windows 桌面端" /></a>
    <a href="#输出与文件行为"><img src="docs/assets/badge-nbformat.svg" alt="Notebook v4 格式" /></a>
    <a href="#支持项目"><img src="docs/assets/badge-coffee.svg" alt="支持 ObJupyter" /></a>
  </p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="#安装">安装</a> · <a href="#快速上手">快速上手</a> · <a href="#python-环境">Python 环境</a> · <a href="#支持项目">支持项目</a></p>
</div>

---

在 Obsidian 里编辑和运行 Jupyter 笔记本，让代码、说明文字与运行结果保存在同一个 `.ipynb` 文件中。

> ObJupyter 目前是面向 **Windows 版 Obsidian Desktop** 的早期版本。插件在本机启动 Python 内核；尚未发布到 Obsidian 社区插件目录。

## 能做什么

| 功能 | 当前实现 |
| --- | --- |
| 打开与创建笔记本 | 在仓库中直接打开 `.ipynb`，也可通过命令面板新建 |
| 编辑单元格 | 编辑 Code、Markdown、Raw 单元格；新增、删除、调整顺序和切换类型 |
| 运行 Python | 运行当前单元格或依次运行全部代码单元格；支持停止与重启内核 |
| 绑定环境 | 设置默认 Python，或为单个笔记本指定解释器路径 |
| 查看结果 | 显示文本、异常、PNG、SVG 和经过安全处理的 HTML；支持 `input()` |
| 保存文件 | 自动保存编辑和运行结果，保留笔记本中未修改的元数据与其他 MIME 数据 |

Code 单元格使用 CodeMirror 编辑器。Markdown 单元格可以在编辑与预览之间切换；预览使用 Obsidian 的 Markdown 渲染器。每个打开的笔记本有持续运行的内核，所以前一个单元格定义的变量可供后续单元格使用。

## 安装

### 需要准备

- Windows 桌面版 Obsidian，版本不低于 `1.5.0`。
- 一个可运行的 Python 解释器，例如普通安装、venv 或 Conda 环境中的 `python.exe`。查看和编辑笔记本时无需启动 Python；运行时才需要。
- 从源码构建插件时需要 Node.js 和 npm。

目前没有可供下载的正式发布包，请从本仓库构建：

```powershell
npm ci
npm run build
```

在目标 Obsidian 仓库中创建 `.obsidian/plugins/objupyter/`，把仓库根目录构建出的三个文件复制进去：

```text
<你的 Obsidian 仓库>/.obsidian/plugins/objupyter/
├── main.js
├── manifest.json
└── styles.css
```

重新加载 Obsidian，然后在 **设置 → 第三方插件** 中启用 **ObJupyter**。如果 Obsidian 使用了自定义配置目录，请将上面的 `.obsidian` 换成实际目录。插件运行时所需的 Python 桥接程序已经包含在 `main.js` 中，不需要额外复制 `.py` 文件。

## 快速上手

1. 将已有的 `.ipynb` 放进 Obsidian 仓库并打开；也可以在命令面板运行 **Create Jupyter notebook**。新文件会创建在当前文件所在文件夹，名称冲突时自动加编号。
2. 点击笔记本顶部的 **Choose Python…**，输入要使用的 `python.exe` 完整路径。也可以先在 ObJupyter 设置页配置默认解释器。
3. 在 Code 单元格中输入代码，点击该单元格的 **▶**，或使用顶部的 **Run cell**。例如：

   ```python
   numbers = [2, 4, 6]
   print(sum(numbers))
   ```

   运行结果会显示在单元格下方，并随笔记本保存。
4. 使用 **Run all** 按顺序运行所有 Code 单元格。遇到异常时停止后续运行；使用 **Stop** 中断当前代码，或用 **Restart** 清空内核变量后重新开始。

单元格标题栏提供类型选择、上移、下移和删除操作。底部可添加 Code 或 Markdown 单元格；Markdown 单元格的 **Preview** 按钮用于切换预览。

## Python 环境

环境绑定使用解释器的**完整路径**，例如 `C:\Projects\demo\.venv\Scripts\python.exe`。ObJupyter 直接启动该解释器，无需先激活 venv 或 Conda 环境，也不会自动搜索或创建环境。

默认路径保存在插件设置里；单个笔记本选择的路径会覆盖默认值。绑定关系按仓库内的笔记本路径记录在插件设置中，不写入 `.ipynb`。把仓库同步到另一台电脑后，通常需要重新选择当地的 Python 路径。

首次在某个环境运行时，插件检查 `jupyter_client` 与 `ipykernel`。如果缺少依赖，会显示以下命令，并在你确认后对**所选环境**执行安装：

```powershell
& "C:\path\to\python.exe" -m pip install jupyter_client ipykernel
```

如果自动安装失败，错误信息会包含手动执行的命令。你的代码使用的其他包（如 `numpy`）也必须安装在同一个 Python 环境中；ObJupyter 当前只负责检查和安装内核运行依赖。

每个打开的笔记本使用一个本地内核，工作目录是该 `.ipynb` 所在文件夹。关闭笔记本或卸载插件时会关闭内核。切换 Python 路径会关闭旧内核，下一次运行时再用新环境启动。

## 输出与文件行为

- 文本、异常、PNG、SVG 和常见 HTML 输出会显示在单元格下方。HTML 与 SVG 在显示前经过净化；无法显示的 MIME 类型仍保留在笔记本数据中。
- `input()` 会在运行中的单元格下显示输入框。密码输入不回显，也不会写进笔记本。
- 编辑和运行结果由 Obsidian 文件视图延迟自动保存为标准 Notebook v4 JSON。无效的 `.ipynb` 只显示错误，不会被空白内容覆盖。
- 如果文件在外部发生变化，而当前视图还有未保存编辑，插件会询问保留哪一份内容。
- **Stop** 若无法让 Windows 上的内核及时响应，会强制重启该内核；此时内存中的变量会丢失，文件中的代码与已保存输出仍在。

## 当前限制

- 仅面向 Windows 桌面版和仓库内文件；未连接远程 Jupyter Server。
- 不支持依赖 JavaScript 的 Jupyter 小组件。其他未实现的富输出会以文本占位显示，但原始数据会保留。
- 当前没有图形化的环境发现、创建或通用包管理界面；请直接输入解释器路径，并在该环境中安装代码所需的包。
- `.ipynb` 单元格不会自动进入 Obsidian 的图谱、反向链接或原生属性索引。

运行笔记本代码与在本机运行 Python 脚本具有相同的权限。请只运行你信任的笔记本；安装内核依赖也会修改所选 Python 环境。

## 常见问题

**文件列表里看不到 `.ipynb`？** 在 Obsidian 的文件与链接设置中打开“检测所有文件扩展名”，然后重新加载仓库。如果另一个插件也接管 `.ipynb`，请只启用其中一个文件视图。

**点击运行后提示找不到 Python？** 检查设置或笔记本顶部所填的完整路径，确认该 `python.exe` 仍存在且可运行。

**安装依赖失败？** 复制错误提示中的命令，在终端里手动运行。某些 Python 环境没有 `pip`，需要先按该环境的管理方式安装它。

**代码提示找不到第三方包？** 先确认顶部选择的环境，再用该解释器安装包，例如 `& "C:\path\to\python.exe" -m pip install numpy`。安装后重启笔记本内核。

## 支持项目

如果 ObJupyter 对你有帮助，欢迎通过微信或支付宝自愿支持后续开发与维护。赞助不解锁额外功能，也不是使用插件或反馈问题的前提。

<details>
<summary><img src="docs/assets/badge-coffee.svg" alt="Buy me a coffee，点击展开收款码" /> </summary>

| 微信支付 | 支付宝 |
| :---: | :---: |
| <img src="assets/support/wechat-pay.jpg" alt="微信支付收款码" width="240"> | <img src="assets/support/alipay.jpg" alt="支付宝收款码" width="240"> |

</details>

## 开发

项目使用 TypeScript、CodeMirror 6 与 esbuild；Python 桥接程序位于 `src/bridge/bridge.py`，通过 `jupyter_client` 管理内核。主要代码在 `src/notebook/`、`src/view/` 和 `src/kernel/`。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

真实内核集成测试建议在独立 Python 环境中运行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install jupyter_client ipykernel
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_bridge.py -v
```

自动化测试覆盖 Notebook 数据读写、环境绑定，以及真实内核的跨单元格状态、输出、交互输入、中断与重启。Obsidian 界面的手工验收仍需在测试仓库中进行。
