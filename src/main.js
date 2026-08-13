const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.haiyu.markl';
const ICON_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');

app.setName('MarkL');
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('lang', 'zh-CN');

function registerWindowsIdentity() {
  if (process.platform !== 'win32') return;
  const iconForShell = app.isPackaged ? process.execPath : ICON_ICO;
  const key = 'HKCU\\Software\\Classes\\AppUserModelId\\com.haiyu.markl';
  try {
    const { execFileSync } = require('child_process');
    execFileSync('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'MarkL', '/f'], { windowsHide: true });
    execFileSync('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconForShell, '/f'], { windowsHide: true });
  } catch (error) {
    console.warn('注册应用标识失败：', error.message);
  }

  if (app.isPackaged) return;

  const appRoot = path.join(__dirname, '..');
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(programs, { recursive: true });
  const shortcut = path.join(programs, 'MarkL.lnk');
  const operation = fs.existsSync(shortcut) ? 'replace' : 'create';
  const wrote = shell.writeShortcutLink(shortcut, operation, {
    target: process.execPath,
    args: `"${appRoot}"`,
    cwd: appRoot,
    appUserModelId: APP_ID,
    icon: ICON_ICO,
    iconIndex: 0,
    description: 'MarkL'
  });
  if (!wrote) console.warn('写入开始菜单快捷方式失败：', shortcut);
}

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
    backgroundColor: '#eef1f5',
    icon: ICON_ICO,
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
        nodes.push({ type: 'directory', name: entry.name, path: fullPath, children });
        itemCount += 1;
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
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '格式化代码块', accelerator: 'Ctrl+Alt+L', click: send('menu:format') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换即时渲染 / 源码', accelerator: 'CmdOrCtrl+/', click: send('menu:toggle-mode') },
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

ipcMain.handle('path:stat', async (_event, targetPath) => {
  if (!targetPath) return { exists: false };
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return { exists: false, path: resolved };
  const stat = fs.statSync(resolved);
  return {
    exists: true,
    path: resolved,
    kind: stat.isDirectory() ? 'directory' : 'file'
  };
});

const beautify = require('js-beautify');

function indentPlain(code) {
  const lines = String(code || '').replace(/\t/g, '    ').replace(/\r\n/g, '\n').split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const width = (line.match(/^ */) || [''])[0].length;
    if (width < min) min = width;
  }
  if (!Number.isFinite(min) || min === 0) return lines.join('\n');
  return lines.map((line) => (line.startsWith(' '.repeat(min)) ? line.slice(min) : line)).join('\n');
}

ipcMain.handle('code:format', async (_event, { language, code }) => {
  const lang = String(language || '').toLowerCase();
  const source = String(code || '').replace(/\r\n/g, '\n');
  const js = { indent_size: 4, indent_char: ' ', end_with_newline: false, preserve_newlines: true, max_preserve_newlines: 2 };
  try {
    if (['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'json'].includes(lang)) {
      return beautify.js(source, { ...js, indent_size: lang === 'json' ? 2 : 4 });
    }
    if (['css', 'scss', 'less'].includes(lang)) return beautify.css(source, js);
    if (['html', 'xml', 'markup', 'svg'].includes(lang)) return beautify.html(source, js);
    return indentPlain(source);
  } catch (error) {
    throw new Error(error?.message || '无法格式化这段代码');
  }
});

function assertInsideWorkspace(targetPath) {
  if (!currentWorkspace) throw new Error('请先打开文件夹。');
  const resolved = path.resolve(targetPath);
  const root = path.resolve(currentWorkspace);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('只能在当前文件夹内操作。');
  }
  return resolved;
}

function sanitizeEntryName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('名称不能为空。');
  if (/[\\/:*?"<>|]/.test(trimmed)) throw new Error('名称不能包含 \\ / : * ? " < > |');
  if (trimmed === '.' || trimmed === '..') throw new Error('名称无效。');
  return trimmed;
}

function uniquePath(dirPath, fileName) {
  const parsed = path.parse(fileName);
  let dest = path.join(dirPath, fileName);
  let index = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(dirPath, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return dest;
}

ipcMain.handle('file:create', async (_event, { dirPath, name, content }) => {
  const directory = assertInsideWorkspace(dirPath || currentWorkspace);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('目标文件夹不存在。');
  }
  let fileName = sanitizeEntryName(name || '未命名.md');
  if (!DOCUMENT_RE.test(fileName)) fileName += '.md';
  const dest = uniquePath(directory, fileName);
  fs.writeFileSync(dest, content ?? '', 'utf8');
  return readDocument(dest);
});

ipcMain.handle('file:mkdir', async (_event, { dirPath, name }) => {
  const directory = assertInsideWorkspace(dirPath || currentWorkspace);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('目标文件夹不存在。');
  }
  const dest = uniquePath(directory, sanitizeEntryName(name || '新建文件夹'));
  fs.mkdirSync(dest);
  return dest;
});

ipcMain.handle('file:rename', async (_event, { oldPath, name }) => {
  const source = assertInsideWorkspace(oldPath);
  if (!fs.existsSync(source)) throw new Error('目标不存在。');
  const nextName = sanitizeEntryName(name);
  const dest = path.join(path.dirname(source), nextName);
  if (path.resolve(source) === path.resolve(dest)) return source;
  assertInsideWorkspace(dest);
  if (fs.existsSync(dest)) throw new Error('同名文件或文件夹已存在。');
  if (fs.statSync(source).isFile() && !DOCUMENT_RE.test(dest)) {
    throw new Error('仅支持 Markdown 或文本文件。');
  }
  fs.renameSync(source, dest);
  return dest;
});

ipcMain.handle('file:delete', async (_event, { targetPath }) => {
  const resolved = assertInsideWorkspace(targetPath);
  if (!fs.existsSync(resolved)) throw new Error('目标不存在。');
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
});

ipcMain.handle('shell:reveal', async (_event, targetPath) => {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) throw new Error('目标不存在。');
  shell.showItemInFolder(resolved);
  return true;
});

ipcMain.handle('tree:context-menu', async (event, payload = {}) => {
  const kind = payload.kind || 'blank';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      resolve(action);
    };

    const items = [];
    if (kind === 'file') {
      items.push({ label: '打开', click: () => finish('open') }, { type: 'separator' });
    }
    items.push(
      { label: '新建文档', click: () => finish('new-file') },
      { label: '新建文件夹', click: () => finish('new-folder') }
    );
    if (kind === 'file' || kind === 'directory') {
      items.push(
        { type: 'separator' },
        { label: '重命名', click: () => finish('rename') },
        { label: '删除', click: () => finish('delete') },
        { type: 'separator' },
        { label: '在资源管理器中显示', click: () => finish('reveal') }
      );
    }
    if (kind === 'blank') {
      items.push({ type: 'separator' }, { label: '打开文件夹…', click: () => finish('open-folder') });
    }

    const menu = Menu.buildFromTemplate(items);
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => setTimeout(() => finish(null), 40)
    });
  });
});

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
    registerWindowsIdentity();
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
