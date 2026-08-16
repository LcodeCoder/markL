const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const APP_ID = 'com.haiyu.markl';
const ICON_GENERATION = 3;
const ICON_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');
const GITHUB_REPO = 'LcodeCoder/markL';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

app.setName('MarkL');
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('lang', 'zh-CN');

function shellIconPath() {
  if (app.isPackaged) return process.execPath;
  const dest = path.join(app.getPath('userData'), `markl-shell-${ICON_GENERATION}.ico`);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < fs.statSync(ICON_ICO).mtimeMs) {
      fs.copyFileSync(ICON_ICO, dest);
    }
    return dest;
  } catch {
    return ICON_ICO;
  }
}

function notifyShellIconsChanged() {
  const { execFileSync } = require('child_process');
  const script = path.join(__dirname, '..', 'scripts', 'refresh-shell-icons.ps1');
  try {
    if (fs.existsSync(script)) {
      execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
      return;
    }
  } catch {
    // 继续尝试系统自带的刷新命令。
  }
  try {
    const ie4 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
    execFileSync(ie4, ['-show'], { windowsHide: true });
  } catch {
    // Windows 图标缓存刷新失败时不影响启动。
  }
}

function registerWindowsIdentity() {
  if (process.platform !== 'win32') return;
  const iconForShell = shellIconPath();
  const key = 'HKCU\\Software\\Classes\\AppUserModelId\\com.haiyu.markl';
  try {
    const { execFileSync } = require('child_process');
    execFileSync('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'MarkL', '/f'], { windowsHide: true });
    execFileSync('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconForShell, '/f'], { windowsHide: true });
  } catch (error) {
    console.warn('注册应用标识失败：', error.message);
  }

  if (app.isPackaged) {
    notifyShellIconsChanged();
    return;
  }

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
    icon: iconForShell,
    iconIndex: 0,
    description: 'MarkL'
  });
  if (!wrote) console.warn('写入开始菜单快捷方式失败：', shortcut);
  notifyShellIconsChanged();
}

let mainWindow = null;
let launchDocument = null;
let currentWorkspace = null;
let currentAppearance = { theme: 'light', font: 'default', fontSize: 'medium' };

const WINDOW_BG = {
  light: '#f4f5f7',
  dark: '#22262d',
  sepia: '#e6e0d2'
};
const THEME_IDS = new Set(['light', 'dark', 'sepia']);
const FONT_IDS = new Set(['default', 'yahei', 'song', 'kai', 'fangsong', 'hei', 'deng']);
const FONT_SIZE_IDS = new Set(['small', 'medium', 'large', 'xlarge']);

function appearancePath() {
  return path.join(app.getPath('userData'), 'appearance.json');
}

function normalizeAppearance(value = {}) {
  return {
    theme: THEME_IDS.has(value.theme) ? value.theme : 'light',
    font: FONT_IDS.has(value.font) ? value.font : 'default',
    fontSize: FONT_SIZE_IDS.has(value.fontSize) ? value.fontSize : 'medium'
  };
}

function readAppearance() {
  try {
    return normalizeAppearance(JSON.parse(fs.readFileSync(appearancePath(), 'utf8')));
  } catch {
    return normalizeAppearance({});
  }
}

function writeAppearance(value) {
  try {
    fs.writeFileSync(appearancePath(), JSON.stringify(value), 'utf8');
  } catch (error) {
    console.warn('保存外观设置失败：', error.message);
  }
}

function applyNativeAppearance(value, options = {}) {
  currentAppearance = normalizeAppearance(value);
  nativeTheme.themeSource = currentAppearance.theme === 'dark' ? 'dark' : 'light';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(WINDOW_BG[currentAppearance.theme]);
  }
  if (options.persist) writeAppearance(currentAppearance);
  if (options.rebuildMenu) buildMenu();
}

const DOCUMENT_RE = /\.(md|markdown|txt)$/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const MIME_IMAGE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/avif': '.avif'
};
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', 'node_modules', 'dist', 'build', '.cache']);
const MAX_TREE_DEPTH = 16;
const MAX_TREE_ITEMS = 2500;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
    backgroundColor: WINDOW_BG[currentAppearance.theme],
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

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      notifySilentUpdate().catch(() => {});
    }, 2500);
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on('close', (event) => {
    if (!mainWindow.__forceClose) {
      event.preventDefault();
      mainWindow.webContents.send('app:before-close');
    }
  });

  mainWindow.on('closed', () => {
    closeWatcher(workspaceWatcher);
    closeWatcher(fileWatcher);
    workspaceWatcher = null;
    fileWatcher = null;
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

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
}

function sendOpenFile(filePath) {
  try {
    mainWindow.webContents.send('file:opened', readDocument(filePath));
  } catch (error) {
    dialog.showErrorBox('无法打开文件', `${filePath}\n\n${error.message}`);
    focusMainWindow();
  }
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '').replace(/^v/i, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function updateStatePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function readDismissedVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(updateStatePath(), 'utf8'));
    return parsed.dismissed || null;
  } catch {
    return null;
  }
}

function writeDismissedVersion(version) {
  fs.writeFileSync(updateStatePath(), JSON.stringify({ dismissed: version, at: Date.now() }), 'utf8');
}

function formatAssetSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size / (1024 * 1024))} MB`;
}

function pickReleaseAsset(assets, kind) {
  const list = Array.isArray(assets) ? assets : [];
  const match = list.find((asset) => {
    const name = String(asset?.name || '');
    if (!/\.exe$/i.test(name)) return false;
    const isSetup = /setup/i.test(name);
    return kind === 'setup' ? isSetup : !isSetup;
  });
  const url = match?.browser_download_url;
  if (!match || !/^https:\/\//i.test(url || '')) return null;
  return {
    name: match.name,
    url,
    size: formatAssetSize(match.size)
  };
}

function sanitizeReleaseNotes(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim())
    .filter((line) => (
      line
      && !/^<!/.test(line)
      && !/^[-_|:\s]+$/.test(line)
      && !/^\|.*\|$/.test(line)
      && !/^\d+(\.\d+)+$/.test(line)
    ))
    .slice(0, 8);
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: RELEASES_API });
    request.setHeader('User-Agent', `MarkL/${app.getVersion()}`);
    request.setHeader('Accept', 'application/vnd.github+json');

    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('检查更新超时。'));
    }, 12000);

    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode === 404) {
          reject(new Error('还没有发布版本。'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`无法连接更新服务（${response.statusCode}）。`));
          return;
        }
        try {
          const data = JSON.parse(body);
          const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
          if (!latest) {
            reject(new Error('更新信息无法解析。'));
            return;
          }
          resolve({
            latest,
            url: /^https:\/\//i.test(data.html_url) ? data.html_url : RELEASES_PAGE,
            publishedAt: data.published_at || data.created_at || '',
            notes: sanitizeReleaseNotes(data.body),
            portable: pickReleaseAsset(data.assets, 'portable'),
            setup: pickReleaseAsset(data.assets, 'setup')
          });
        } catch {
          reject(new Error('更新信息无法解析。'));
        }
      });
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.message || '网络不可用。'));
    });
    request.end();
  });
}

let updateCheckPromise = null;

async function inspectLatestRelease() {
  const current = app.getVersion();
  const release = await fetchLatestRelease();
  return {
    current,
    latest: release.latest,
    newer: compareVersions(release.latest, current) > 0,
    url: release.url,
    publishedAt: release.publishedAt,
    notes: release.notes,
    portable: release.portable,
    setup: release.setup
  };
}

async function runUpdateCheck({ silent = false } = {}) {
  try {
    const info = await inspectLatestRelease();
    if (!info.newer) return { status: 'latest', ...info };
    if (silent && readDismissedVersion() === info.latest) {
      return { status: 'dismissed', ...info };
    }
    return { status: 'available', ...info };
  } catch (error) {
    return {
      status: 'error',
      current: app.getVersion(),
      message: error?.message || String(error)
    };
  }
}

function checkForUpdate({ silent = false } = {}) {
  if (!updateCheckPromise) {
    updateCheckPromise = runUpdateCheck({ silent }).finally(() => {
      updateCheckPromise = null;
    });
    return updateCheckPromise;
  }
  return updateCheckPromise.then((result) => {
    if (silent) return result;
    if (result.status === 'dismissed' && result.newer) {
      return { ...result, status: 'available' };
    }
    return result;
  });
}

async function notifySilentUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await checkForUpdate({ silent: true });
  if (result.status !== 'available' || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update:available', result);
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

const ownWrites = new Map();
let workspaceWatcher = null;
let fileWatcher = null;
let watchWorkspaceRoot = null;
let watchFilePath = null;
let fsNotifyTimer = 0;
const pendingFsPaths = new Set();

function noteOwnWrite(targetPath) {
  if (!targetPath) return;
  ownWrites.set(path.resolve(targetPath).toLowerCase(), Date.now());
}

function isOwnWrite(targetPath) {
  if (!targetPath) return false;
  const key = path.resolve(targetPath).toLowerCase();
  const at = ownWrites.get(key);
  if (!at) return false;
  if (Date.now() - at < 2000) return true;
  ownWrites.delete(key);
  return false;
}

function shouldIgnoreWatchName(relativeName) {
  const parts = String(relativeName || '').split(/[\\/]/);
  return parts.some((part) => !part || part.startsWith('.') || IGNORED_DIRECTORIES.has(part));
}

function flushFsNotify() {
  fsNotifyTimer = 0;
  if (!mainWindow || mainWindow.isDestroyed() || !pendingFsPaths.size) {
    pendingFsPaths.clear();
    return;
  }
  const paths = [...pendingFsPaths];
  pendingFsPaths.clear();
  const visible = paths.filter((item) => !isOwnWrite(item));
  if (!visible.length) return;
  mainWindow.webContents.send('fs:change', { paths: visible });
}

function queueFsNotify(targetPath) {
  if (!targetPath || isOwnWrite(targetPath)) return;
  pendingFsPaths.add(path.resolve(targetPath));
  if (fsNotifyTimer) clearTimeout(fsNotifyTimer);
  fsNotifyTimer = setTimeout(flushFsNotify, 180);
}

function closeWatcher(watcher) {
  try {
    watcher?.close();
  } catch {
    // 监视器关闭失败时忽略。
  }
}

function startWorkspaceWatch(rootPath) {
  closeWatcher(workspaceWatcher);
  workspaceWatcher = null;
  watchWorkspaceRoot = rootPath || null;
  if (!rootPath || !fs.existsSync(rootPath)) return;
  try {
    workspaceWatcher = fs.watch(rootPath, { persistent: true, recursive: true }, (_event, filename) => {
      if (filename && shouldIgnoreWatchName(filename)) return;
      queueFsNotify(filename ? path.join(rootPath, filename) : rootPath);
    });
    workspaceWatcher.on('error', () => {});
  } catch {
    workspaceWatcher = null;
  }
}

function startFileWatch(filePath) {
  closeWatcher(fileWatcher);
  fileWatcher = null;
  watchFilePath = filePath || null;
  if (!filePath || !fs.existsSync(filePath)) return;
  if (watchWorkspaceRoot && isPathInsideWatch(filePath, watchWorkspaceRoot)) return;
  try {
    fileWatcher = fs.watch(filePath, { persistent: true }, () => {
      queueFsNotify(filePath);
    });
    fileWatcher.on('error', () => {});
  } catch {
    fileWatcher = null;
  }
}

function isPathInsideWatch(filePath, rootPath) {
  const file = path.resolve(filePath).toLowerCase();
  const root = path.resolve(rootPath).toLowerCase();
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function draftFilePath() {
  return path.join(app.getPath('userData'), 'crash-draft.json');
}

function readCrashDraft() {
  try {
    const parsed = JSON.parse(fs.readFileSync(draftFilePath(), 'utf8'));
    if (!parsed || typeof parsed.content !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCrashDraft(payload) {
  fs.writeFileSync(draftFilePath(), JSON.stringify({
    filePath: payload?.filePath || null,
    workspaceRoot: payload?.workspaceRoot || null,
    content: String(payload?.content || ''),
    savedContent: String(payload?.savedContent || ''),
    at: Date.now()
  }), 'utf8');
}

function clearCrashDraft() {
  try {
    fs.unlinkSync(draftFilePath());
  } catch {
    // 没有草稿就算了。
  }
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
        { label: '快速打开…', accelerator: 'CmdOrCtrl+P', click: send('menu:quick-open') },
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
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: send('menu:find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: send('menu:replace') },
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
        {
          label: '浅色',
          type: 'radio',
          checked: currentAppearance.theme === 'light',
          click: () => mainWindow?.webContents.send('menu:theme', 'light')
        },
        {
          label: '深色',
          type: 'radio',
          checked: currentAppearance.theme === 'dark',
          click: () => mainWindow?.webContents.send('menu:theme', 'dark')
        },
        {
          label: '护眼',
          type: 'radio',
          checked: currentAppearance.theme === 'sepia',
          click: () => mainWindow?.webContents.send('menu:theme', 'sepia')
        }
      ]
    },
    {
      label: '字体',
      submenu: [
        {
          label: '默认',
          type: 'radio',
          checked: currentAppearance.font === 'default',
          click: () => mainWindow?.webContents.send('menu:font', 'default')
        },
        {
          label: '微软雅黑',
          type: 'radio',
          checked: currentAppearance.font === 'yahei',
          click: () => mainWindow?.webContents.send('menu:font', 'yahei')
        },
        {
          label: '宋体',
          type: 'radio',
          checked: currentAppearance.font === 'song',
          click: () => mainWindow?.webContents.send('menu:font', 'song')
        },
        {
          label: '楷体',
          type: 'radio',
          checked: currentAppearance.font === 'kai',
          click: () => mainWindow?.webContents.send('menu:font', 'kai')
        },
        {
          label: '仿宋',
          type: 'radio',
          checked: currentAppearance.font === 'fangsong',
          click: () => mainWindow?.webContents.send('menu:font', 'fangsong')
        },
        {
          label: '黑体',
          type: 'radio',
          checked: currentAppearance.font === 'hei',
          click: () => mainWindow?.webContents.send('menu:font', 'hei')
        },
        {
          label: '等线',
          type: 'radio',
          checked: currentAppearance.font === 'deng',
          click: () => mainWindow?.webContents.send('menu:font', 'deng')
        },
        { type: 'separator' },
        {
          label: '较小',
          type: 'radio',
          checked: currentAppearance.fontSize === 'small',
          click: () => mainWindow?.webContents.send('menu:font-size', 'small')
        },
        {
          label: '标准',
          type: 'radio',
          checked: currentAppearance.fontSize === 'medium',
          click: () => mainWindow?.webContents.send('menu:font-size', 'medium')
        },
        {
          label: '较大',
          type: 'radio',
          checked: currentAppearance.fontSize === 'large',
          click: () => mainWindow?.webContents.send('menu:font-size', 'large')
        },
        {
          label: '更大',
          type: 'radio',
          checked: currentAppearance.fontSize === 'xlarge',
          click: () => mainWindow?.webContents.send('menu:font-size', 'xlarge')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => mainWindow?.webContents.send('menu:check-update')
        },
        {
          label: 'GitHub 仓库',
          click: () => shell.openExternal(`https://github.com/${GITHUB_REPO}`)
        },
        {
          label: '关于 MarkL',
          click: () => mainWindow?.webContents.send('menu:about')
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
  focusMainWindow();
  if (result.canceled || !result.filePaths.length) return null;
  return readDocument(result.filePaths[0]);
});

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Markdown 文件夹',
    properties: ['openDirectory']
  });
  focusMainWindow();
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
  focusMainWindow();
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle('dialog:export-html', async (_event, { defaultPath }) => {
  const name = (defaultPath || '未命名').replace(/\.(md|markdown|txt)$/i, '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 HTML',
    defaultPath: `${name}.html`,
    filters: [{ name: 'HTML 网页', extensions: ['html'] }]
  });
  focusMainWindow();
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle('file:write', async (_event, { filePath, content }) => {
  const resolved = path.resolve(filePath);
  noteOwnWrite(resolved);
  fs.writeFileSync(resolved, content, 'utf8');
  return true;
});

function toPosixRelative(fromDir, target) {
  let relative = path.relative(fromDir, target).split(path.sep).join('/');
  if (!relative || relative === '.') return './';
  if (!relative.startsWith('.') && !path.isAbsolute(relative)) relative = `./${relative}`;
  return relative;
}

function ensureImageFileName(name, mime) {
  const fallbackExt = MIME_IMAGE_EXT[String(mime || '').toLowerCase()] || '.png';
  let fileName = String(name || `pasted${fallbackExt}`).trim() || `pasted${fallbackExt}`;
  fileName = path.basename(fileName).replace(/[\\/:*?"<>|]/g, '-');
  if (!fileName || fileName === '.' || fileName === '..') fileName = `pasted${fallbackExt}`;
  const ext = path.extname(fileName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) fileName += fallbackExt;
  return fileName;
}

function bufferFromIpcBytes(bytes) {
  if (!bytes) return Buffer.alloc(0);
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Buffer.from(bytes);
  if (typeof bytes === 'object') return Buffer.from(Uint8Array.from(Object.values(bytes)));
  return Buffer.alloc(0);
}

ipcMain.handle('image:save', async (_event, { documentPath, name, mime, bytes }) => {
  if (!documentPath) throw new Error('请先保存文档，再插入图片。');
  const documentFile = path.resolve(documentPath);
  if (!fs.existsSync(documentFile) || !fs.statSync(documentFile).isFile()) {
    throw new Error('当前文档还不在磁盘上。');
  }

  const buffer = bufferFromIpcBytes(bytes);
  if (!buffer.length) throw new Error('没有可用的图片数据。');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 25 MB。');

  const assetsDir = path.join(path.dirname(documentFile), 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const dest = uniquePath(assetsDir, ensureImageFileName(name, mime));
  noteOwnWrite(dest);
  noteOwnWrite(assetsDir);
  fs.writeFileSync(dest, buffer);
  return {
    filePath: dest,
    relative: toPosixRelative(path.dirname(documentFile), dest),
    fileUrl: pathToFileURL(dest).href
  };
});

ipcMain.handle('image:resolve', async (_event, { documentPath, sources }) => {
  if (!documentPath || !Array.isArray(sources)) return [];
  const baseDir = path.dirname(path.resolve(documentPath));
  return sources.map((raw) => {
    const src = String(raw || '').trim();
    if (!src) return { src, exists: false };
    if (/^(https?:|data:|blob:)/i.test(src)) {
      return { src, fileUrl: src, relative: src, exists: true, remote: true };
    }

    try {
      if (/^file:/i.test(src)) {
        const absolute = fileURLToPath(src);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
          return { src, exists: false };
        }
        return {
          src,
          fileUrl: pathToFileURL(absolute).href,
          relative: toPosixRelative(baseDir, absolute),
          exists: true
        };
      }

      const decoded = decodeURI(src.split(/[?#]/)[0]);
      const absolute = path.resolve(baseDir, decoded);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return { src, exists: false };
      }
      return {
        src,
        fileUrl: pathToFileURL(absolute).href,
        relative: src,
        exists: true
      };
    } catch {
      return { src, exists: false };
    }
  });
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('app:launch-context', async () => {
  const document = launchDocument;
  launchDocument = null;
  return { file: document };
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
    kind: stat.isDirectory() ? 'directory' : 'file',
    mtimeMs: stat.mtimeMs
  };
});

ipcMain.handle('path:resolve-doc', async (_event, { documentPath, workspaceRoot, href }) => {
  const raw = String(href || '').trim();
  if (!raw) return { kind: 'none' };
  if (raw.startsWith('#')) return { kind: 'heading', hash: raw.slice(1) };
  if (/^(https?:|mailto:|data:|blob:)/i.test(raw)) return { kind: 'external', url: raw };
  if (/^file:/i.test(raw)) {
    try {
      const absolute = fileURLToPath(raw.split(/[?#]/)[0]);
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile() && DOCUMENT_RE.test(absolute)) {
        return { kind: 'document', path: absolute };
      }
    } catch {
      return { kind: 'none' };
    }
    return { kind: 'missing', path: raw };
  }

  const cleaned = decodeURI(raw.split(/[?#]/)[0]);
  const baseDir = documentPath
    ? path.dirname(path.resolve(documentPath))
    : (workspaceRoot ? path.resolve(workspaceRoot) : null);
  if (!baseDir) return { kind: 'none' };

  let absolute = path.resolve(baseDir, cleaned);
  if (!fs.existsSync(absolute) && !path.extname(absolute)) {
    for (const ext of ['.md', '.markdown', '.txt']) {
      if (fs.existsSync(`${absolute}${ext}`)) {
        absolute = `${absolute}${ext}`;
        break;
      }
    }
  }
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile() && DOCUMENT_RE.test(absolute)) {
    return { kind: 'document', path: absolute };
  }
  if (fs.existsSync(absolute)) return { kind: 'other', path: absolute };
  return { kind: 'missing', path: absolute };
});

ipcMain.handle('watch:set', async (_event, { workspaceRoot, filePath }) => {
  startWorkspaceWatch(workspaceRoot || null);
  startFileWatch(filePath || null);
  return true;
});

ipcMain.handle('draft:save', async (_event, payload) => {
  writeCrashDraft(payload || {});
  return true;
});

ipcMain.handle('draft:read', async () => readCrashDraft());

ipcMain.handle('draft:clear', async () => {
  clearCrashDraft();
  return true;
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
  noteOwnWrite(dest);
  fs.writeFileSync(dest, content ?? '', 'utf8');
  return readDocument(dest);
});

ipcMain.handle('file:mkdir', async (_event, { dirPath, name }) => {
  const directory = assertInsideWorkspace(dirPath || currentWorkspace);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('目标文件夹不存在。');
  }
  const dest = uniquePath(directory, sanitizeEntryName(name || '新建文件夹'));
  noteOwnWrite(dest);
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
  noteOwnWrite(source);
  noteOwnWrite(dest);
  fs.renameSync(source, dest);
  return dest;
});

ipcMain.handle('file:delete', async (_event, { targetPath }) => {
  const resolved = assertInsideWorkspace(targetPath);
  if (!fs.existsSync(resolved)) throw new Error('目标不存在。');
  noteOwnWrite(resolved);
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
});

ipcMain.handle('shell:reveal', async (_event, targetPath) => {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) throw new Error('目标不存在。');
  shell.showItemInFolder(resolved);
  return true;
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error('仅支持 HTTPS 链接。');
  }
  await shell.openExternal(url);
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
ipcMain.on('appearance:set', (_event, payload) => {
  applyNativeAppearance(payload, { persist: true, rebuildMenu: true });
});

ipcMain.handle('update:check', async () => checkForUpdate({ silent: false }));

ipcMain.handle('update:dismiss', async (_event, version) => {
  const value = String(version || '').replace(/^v/i, '').trim();
  if (value) writeDismissedVersion(value);
  return true;
});

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
    applyNativeAppearance(readAppearance());
    const launchPath = extractFileArg(process.argv);
    if (launchPath) {
      try {
        launchDocument = readDocument(launchPath);
      } catch (error) {
        dialog.showErrorBox('无法打开文件', `${launchPath}\n\n${error.message}`);
      }
    }
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
