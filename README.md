<p align="center">
  <img src="assets/logo-wordmark.png" alt="MarkL" width="320" />
</p>

<h1 align="center">MarkL</h1>

<p align="center">
  面向中文用户的轻量级 Windows Markdown 编辑器
</p>

<p align="center">
  <a href="PRODUCT.md">产品说明</a> ·
  <a href="DESIGN.md">设计规范</a>
</p>

## 项目简介

MarkL 是一款使用 Electron 构建的桌面 Markdown 编辑器，整合了文件目录管理、Markdown 实时编辑与预览、所见即所得模式、代码语法高亮和 HTML 导出功能。项目以中文界面和 Windows 桌面使用体验为优先，适合编写技术文档、学习笔记、教程和项目说明。

## 功能特性

- **即时渲染编辑**：默认 Typora 式单页编辑，可切换到 Markdown 源码。
- **代码块语言与高亮**：输入三个反引号后回车选择语言，关键字即时高亮。
- **文件夹工作区**：打开文件夹后，通过左侧目录树浏览 `.md`、`.markdown` 和 `.txt` 文件。
- **代码语法高亮**：使用 highlight.js 高亮常见编程语言的代码块。
- **代码语言快捷选择**：输入三个反引号后可筛选语言，并使用方向键、`Enter` 或 `Tab` 完成选择。
- **完整文件操作**：支持新建、打开、保存、另存为以及未保存内容确认。
- **导出 HTML**：将当前 Markdown 文档导出为包含基础样式的独立 HTML 文件。
- **浅色 / 深色主题**：主题会保存在本地，下次启动时自动恢复。
- **状态信息**：显示保存状态、编辑模式、UTF-8 编码以及字数和字符数。
- **Windows 桌面集成**：安装包可关联 `.md` 和 `.markdown` 文件，并支持通过文件参数直接打开文档。
- **响应式侧栏**：在较窄窗口中可折叠或覆盖显示文件目录。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| [Electron](https://www.electronjs.org/) | Windows 桌面应用运行环境 |
| [Vditor](https://b3log.org/vditor) | Typora 式即时渲染 Markdown 编辑 |
| highlight.js | 代码块语法高亮 |
| [electron-builder](https://www.electron.build/) | Windows 安装包与便携版构建 |
| Jimp + png-to-ico | 应用图标生成 |

## 环境要求

- Windows 10 / 11（当前打包配置为 x64）
- Node.js 18 或更高版本
- npm

## 本地开发

```bash
git clone https://github.com/LcodeCoder/markL.git
cd markL
npm install
npm start
```

## 构建 Windows 版本

生成应用图标：

```bash
npm run make-icon
```

构建 Windows 安装包和便携版：

```bash
npm run build
```

也可以显式构建 NSIS 安装包与 Portable 版本：

```bash
npm run dist
```

构建结果会输出到 `dist/` 目录。该目录属于本地构建产物，不提交到 Git 仓库。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl + N` | 新建文档 |
| `Ctrl + O` | 打开文件 |
| `Ctrl + Shift + O` | 打开文件夹 |
| `Ctrl + S` | 保存 |
| `Ctrl + Shift + S` | 另存为 |
| `Ctrl + /` | 切换 Markdown / 所见即所得模式 |
| `Ctrl + B` | 显示或隐藏目录栏 |
| `↑` / `↓` | 在代码语言列表中移动选择 |
| `Enter` / `Tab` | 确认代码语言 |
| `Esc` | 关闭代码语言列表 |

## 项目结构

```text
MarkL/
├─ assets/                  # 应用图标与界面品牌资源
├─ scripts/
│  └─ make-icon.js          # 从根目录 Logo 生成 PNG / ICO 图标
├─ src/
│  ├─ main.js               # Electron 主进程、菜单、窗口和文件操作
│  ├─ preload.js            # 安全的主进程 / 渲染进程通信桥
│  └─ renderer/
│     ├─ index.html         # 应用界面结构
│     ├─ renderer.js        # 编辑器、文件树和交互逻辑
│     └─ styles.css         # 浅色 / 深色主题与响应式样式
├─ DESIGN.md                # 视觉与交互规范
├─ PRODUCT.md               # 产品定位与设计原则
├─ package.json             # 项目配置与 npm 命令
└─ README.md
```

## 安全设计

MarkL 的渲染进程启用了 `contextIsolation`，并关闭了 `nodeIntegration`。文件读写、文件选择和窗口控制通过 `preload.js` 中限定的 IPC 接口完成；网页链接会交由系统默认浏览器打开。

## 开发说明

- 当前目录树最多扫描 16 层、2,500 个项目，以避免大型目录阻塞界面。
- 隐藏目录以及 `.git`、`.svn`、`node_modules`、`dist`、`build`、`.cache` 默认不会出现在目录树中。
- 文档统一按 UTF-8 编码读写。
- 当前版本主要面向 Windows；其他桌面平台尚未提供正式打包配置。

## 贡献

欢迎提交 Issue 或 Pull Request。提交代码前，请确保应用可以正常启动，并验证文件打开、保存、目录树、主题切换和 HTML 导出等核心流程。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
