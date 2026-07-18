const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep Electron and Chromium UI localized for Chinese users.
app.commandLine.appendSwitch('lang', 'zh-CN');

let mainWindow = null;
let fileToOpenOnLaunch = null;
let currentWorkspace = null;

const DOCUMENT_RE = /\.(md|markdown|txt)$/i;
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', 'node_modules', 'dist', 'build', '.cache']);
const MAX_TREE_DEPTH = 16;
const MAX_TREE_ITEMS = 2500;

function extractFileArg(argv) {
  for (let i = 1; i < argv.length; i += 1) {
    const candidate = argv[i];
    if (candidate && !candidate.startsWith('-') && DOCUMENT_RE.test(candidate) && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 520,
    backgroundColor: '#f7f8fa',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    title: 'MarkL',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpenOnLaunch) {
      sendOpenFile(fileToOpenOnLaunch);
      fileToOpenOnLaunch = null;
    }
  });

  mainWindow.on('close', (event) => {
    if (!mainWindow.__forceClose) {
      event.preventDefault();
      mainWindow.webContents.send('app:before-close');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function readDocument(filePath) {
  const resolved = path.resolve(filePath);
  if (!DOCUMENT_RE.test(resolved)) throw new Error('仅支持 Markdown 或文本文件。');
  return { filePath: resolved, content: fs.readFileSync(resolved, 'utf8') };
}

function sendOpenFile(filePath) {
  try {
    mainWindow.webContents.send('file:opened', readDocument(filePath));
  } catch (error) {
    dialog.showErrorBox('无法打开文件', `${filePath}\n\n${error.message}`);
  }
}

function buildDirectoryTree(rootPath) {
  let itemCount = 0;

  function walk(directory, depth) {
    if (depth > MAX_TREE_DEPTH || itemCount >= MAX_TREE_ITEMS) return [];

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    const nodes = [];
    for (const entry of entries) {
      if (itemCount >= MAX_TREE_ITEMS || entry.isSymbolicLink()) break;
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        const children = walk(fullPath, depth + 1);
        if (children.length) {
          nodes.push({ type: 'directory', name: entry.name, path: fullPath, children });
          itemCount += 1;
        }
      } else if (entry.isFile() && DOCUMENT_RE.test(entry.name)) {
        nodes.push({ type: 'file', name: entry.name, path: fullPath });
        itemCount += 1;
      }
    }
    return nodes;
  }

  return walk(rootPath, 0);
}

function workspacePayload(rootPath) {
  const resolved = path.resolve(rootPath);
  currentWorkspace = resolved;
  return {
    rootPath: resolved,
    rootName: path.basename(resolved),
    tree: buildDirectoryTree(resolved)
  };
}

function buildMenu() {
  const send = (channel) => () => mainWindow?.webContents.send(channel);
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建文档', accelerator: 'CmdOrCtrl+N', click: send('menu:new') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: send('menu:open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: send('menu:open-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu:save-as') },
        { type: 'separator' },
        { label: '导出 HTML…', click: send('menu:export-html') },
        { type: 'separator' },
        { role: 'quit', label: '退出 MarkL' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'delete', label: '删除' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换编辑模式', accelerator: 'CmdOrCtrl+/', click: send('menu:toggle-mode') },
        { label: '显示/隐藏目录栏', accelerator: 'CmdOrCtrl+B', click: send('menu:toggle-sidebar') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        ...(process.env.NODE_ENV === 'development'
          ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }]
          : [])
      ]
    },
    {
      label: '主题',
      submenu: [
        { label: '浅色主题', click: () => mainWindow?.webContents.send('menu:theme', 'light') },
        { label: '深色主题', click: () => mainWindow?.webContents.send('menu:theme', 'dark') }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 MarkL',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于 MarkL',
            message: 'MarkL 1.0.0',
            detail: '面向中文用户的轻量 Markdown 编辑器。\n支持目录管理、实时预览与代码语法高亮。',
            buttons: ['确定']
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开文档',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown 与文本文件', extensions: ['md', 'markdown', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return readDocument(result.filePaths[0]);
});

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Markdown 文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return workspacePayload(result.filePaths[0]);
});

ipcMain.handle('workspace:refresh', async (_event, rootPath) => {
  const target = rootPath || currentWorkspace;
  if (!target || !fs.existsSync(target)) return null;
  return workspacePayload(target);
});

ipcMain.handle('dialog:save-as', async (_event, { defaultPath }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: defaultPath || '未命名.md',
    filters: [
      { name: 'Markdown 文档', extensions: ['md'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle('dialog:export-html', async (_event, { defaultPath }) => {
  const name = (defaultPath || '未命名').replace(/\.(md|markdown|txt)$/i, '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 HTML',
    defaultPath: `${name}.html`,
    filters: [{ name: 'HTML 网页', extensions: ['html'] }]
  });
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle('file:write', async (_event, { filePath, content }) => {
  fs.writeFileSync(path.resolve(filePath), content, 'utf8');
  return true;
});

ipcMain.handle('file:read', async (_event, { filePath }) => readDocument(filePath));

ipcMain.on('app:do-close', () => {
  if (mainWindow) {
    mainWindow.__forceClose = true;
    mainWindow.close();
  }
});

ipcMain.on('app:set-title', (_event, title) => mainWindow?.setTitle(title));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = extractFileArg(argv);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (filePath) sendOpenFile(filePath);
  });

  app.whenReady().then(() => {
    fileToOpenOnLaunch = extractFileArg(process.argv);
    createWindow();
    buildMenu();
    mainWindow.setMenuBarVisibility(true);
    mainWindow.setAutoHideMenuBar(false);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
