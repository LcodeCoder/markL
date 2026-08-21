const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { decodeDocumentBuffer } = require('./lib/encoding.cjs');
const { DEFAULT_IGNORED, normalizePrefs } = require('./lib/prefs.cjs');

const APP_ID = 'com.haiyu.markl';
const ICON_GENERATION = 3;
const ICON_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');
const GITHUB_REPO = 'LcodeCoder/markL';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
const WEBSITE_URL = 'https://markl.lcode.space';

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
let currentPrefs = normalizePrefs({});
let ignoredDirectories = new Set(DEFAULT_IGNORED);

const WINDOW_BG = {
  light: '#f4f5f7',
  mist: '#eef3f6',
  sepia: '#e8dfcc',
  dark: '#22262d',
  ink: '#12141a',
  dusk: '#1b2430'
};
const DARK_THEMES = new Set(['dark', 'ink', 'dusk']);
const THEME_IDS = new Set(['light', 'mist', 'sepia', 'dark', 'ink', 'dusk']);
const FONT_IDS = new Set(['default', 'yahei', 'song', 'kai', 'fangsong', 'hei', 'deng']);
const FONT_SIZE_IDS = new Set(['small', 'medium', 'large', 'xlarge']);

function appearancePath() {
  return path.join(app.getPath('userData'), 'appearance.json');
}

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function applyIgnoredDirectories(list) {
  ignoredDirectories = new Set(list && list.length ? list : DEFAULT_IGNORED);
}

function writePrefs(value) {
  currentPrefs = normalizePrefs(value);
  applyIgnoredDirectories(currentPrefs.ignoredDirectories);
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(currentPrefs), 'utf8');
  } catch (error) {
    console.warn('保存偏好设置失败：', error.message);
  }
}

function readPrefs() {
  try {
    return normalizePrefs(JSON.parse(fs.readFileSync(prefsPath(), 'utf8')));
  } catch {
    return normalizePrefs({});
  }
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

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (!parsed || typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWindowState(value) {
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify(value), 'utf8');
  } catch (error) {
    console.warn('保存窗口位置失败：', error.message);
  }
}

function isVisibleOnAnyDisplay(bounds) {
  const displays = screen.getAllDisplays();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width) || 200;
  const height = Number(bounds.height) || 200;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return displays.some((display) => {
    const area = display.workArea;
    return x < area.x + area.width - 80
      && x + width > area.x + 80
      && y < area.y + area.height - 80
      && y + height > area.y + 40;
  });
}

function currentWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const isMaximized = mainWindow.isMaximized();
  const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  return { ...bounds, isMaximized };
}

let windowStateTimer = 0;

function persistWindowState() {
  const state = currentWindowState();
  if (state) writeWindowState(state);
}

function schedulePersistWindowState() {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(persistWindowState, 200);
}

function resolvedTheme(appearance = currentAppearance, prefs = currentPrefs) {
  if (prefs?.followSystemTheme) return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return appearance.theme;
}

function applyNativeAppearance(value, options = {}) {
  currentAppearance = normalizeAppearance(value);
  const theme = resolvedTheme(currentAppearance, currentPrefs);
  nativeTheme.themeSource = currentPrefs.followSystemTheme
    ? 'system'
    : (DARK_THEMES.has(theme) ? 'dark' : 'light');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(WINDOW_BG[theme] || WINDOW_BG.light);
  }
  if (options.persist) writeAppearance(currentAppearance);
  if (options.rebuildMenu) buildMenu();
}

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

function canAutoUpdate() {
  return app.isPackaged && !isPortableBuild();
}

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

function setupAutoUpdater() {
  if (!autoUpdater || !canAutoUpdate()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => {});
  autoUpdater.on('update-downloaded', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('update:downloaded');
  });
}

const DOCUMENT_RE = /\.(md|markdown|txt)$/i;
const WRITEABLE_RE = /\.(md|markdown|txt|html|pdf)$/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
};
const authorizedWrites = new Set();

function authorizeWritePath(filePath) {
  if (!filePath) return;
  authorizedWrites.add(path.resolve(filePath).toLowerCase());
}

function isInsideCurrentWorkspace(filePath) {
  if (!currentWorkspace || !filePath) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(currentWorkspace);
  const relative = path.relative(root, resolved);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertAuthorizedWrite(filePath) {
  if (!filePath) throw new Error('缺少文件路径。');
  const resolved = path.resolve(filePath);
  if (!WRITEABLE_RE.test(resolved)) {
    throw new Error('只能写入 Markdown、文本或 HTML 文件。');
  }
  if (authorizedWrites.has(resolved.toLowerCase())) return resolved;
  if (DOCUMENT_RE.test(resolved) && isInsideCurrentWorkspace(resolved)) {
    authorizeWritePath(resolved);
    return resolved;
  }
  throw new Error('不允许写入该路径。');
}
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
function isIgnoredDirectoryName(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  return ignoredDirectories.has(name);
}
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
  const saved = readWindowState();
  const windowOptions = {
    width: saved?.width || 1280,
    height: saved?.height || 820,
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
  };
  if (saved && isVisibleOnAnyDisplay(saved)) {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  if (saved?.isMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('resize', schedulePersistWindowState);
  mainWindow.on('move', schedulePersistWindowState);

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      notifySilentUpdate().catch(() => {});
    }, 2500);
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on('close', (event) => {
    persistWindowState();
    if (!mainWindow.__forceClose) {
      event.preventDefault();
      mainWindow.webContents.send('app:before-close');
    }
  });

  mainWindow.on('closed', () => {
    closeWatcher(workspaceWatcher);
    closeWatcher(fileWatcher);
    stopFilePoll();
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
  authorizeWritePath(resolved);
  const decoded = decodeDocumentBuffer(fs.readFileSync(resolved));
  return { filePath: resolved, content: decoded.content, encoding: decoded.encoding };
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
    if (!info.newer) return { status: 'latest', canAutoUpdate: canAutoUpdate(), ...info };
    if (silent && readDismissedVersion() === info.latest) {
      return { status: 'dismissed', canAutoUpdate: canAutoUpdate(), ...info };
    }
    return { status: 'available', canAutoUpdate: canAutoUpdate(), ...info };
  } catch (error) {
    return {
      status: 'error',
      current: app.getVersion(),
      canAutoUpdate: canAutoUpdate(),
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
        if (isIgnoredDirectoryName(entry.name)) continue;
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
let filePollTimer = 0;
let lastPolledMtime = 0;
const pendingFsPaths = new Set();

function noteOwnWrite(targetPath) {
  if (!targetPath) return;
  const resolved = path.resolve(targetPath);
  ownWrites.set(resolved.toLowerCase(), Date.now());
  if (watchFilePath && resolved.toLowerCase() === path.resolve(watchFilePath).toLowerCase()) {
    try {
      lastPolledMtime = fs.statSync(resolved).mtimeMs;
    } catch {
      // 自己写入后立刻读不到也没关系，轮询会再补。
    }
  }
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
  return parts.some((part) => !part || isIgnoredDirectoryName(part));
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

function isWatchedFileName(filename, filePath) {
  if (!filename || !filePath) return false;
  const target = path.basename(filePath).toLowerCase();
  const name = String(filename).toLowerCase();
  if (name === target) return true;
  return name.startsWith(`${target}.`) || name.startsWith(`${target}~`) || name === `~${target}`;
}

function readMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs || 0;
  } catch {
    return 0;
  }
}

function stopFilePoll() {
  if (filePollTimer) {
    clearInterval(filePollTimer);
    filePollTimer = 0;
  }
  lastPolledMtime = 0;
}

function startFilePoll(filePath) {
  stopFilePoll();
  if (!filePath) return;
  lastPolledMtime = readMtime(filePath);
  filePollTimer = setInterval(() => {
    if (!watchFilePath || isOwnWrite(watchFilePath)) return;
    const mtime = readMtime(watchFilePath);
    if (!mtime) {
      if (lastPolledMtime) queueFsNotify(watchFilePath);
      return;
    }
    if (lastPolledMtime && mtime > lastPolledMtime + 4) {
      lastPolledMtime = mtime;
      queueFsNotify(watchFilePath);
      return;
    }
    lastPolledMtime = mtime;
  }, 1500);
}

function startFileWatch(filePath) {
  closeWatcher(fileWatcher);
  fileWatcher = null;
  watchFilePath = filePath || null;
  stopFilePoll();
  if (!filePath) return;

  const directory = path.dirname(filePath);
  if (fs.existsSync(directory)) {
    try {
      fileWatcher = fs.watch(directory, { persistent: true }, (_event, filename) => {
        if (filename && !isWatchedFileName(filename, filePath) && shouldIgnoreWatchName(filename)) return;
        if (!filename || isWatchedFileName(filename, filePath)) {
          queueFsNotify(filePath);
        }
      });
      fileWatcher.on('error', () => {});
    } catch {
      fileWatcher = null;
    }
  }

  if (!fileWatcher && fs.existsSync(filePath)) {
    try {
      fileWatcher = fs.watch(filePath, { persistent: true }, () => {
        queueFsNotify(filePath);
      });
      fileWatcher.on('error', () => {});
    } catch {
      fileWatcher = null;
    }
  }

  startFilePoll(filePath);
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
        { label: '从模板新建…', click: send('menu:new-template') },
        { type: 'separator' },
        { label: '导出 HTML…', click: send('menu:export-html') },
        { label: '导出 PDF…', click: send('menu:export-pdf') },
        { label: '打印…', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu:print') },
        { type: 'separator' },
        { label: '本地历史…', click: send('menu:revisions') },
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
        { label: '在文件夹中查找', accelerator: 'CmdOrCtrl+Shift+F', click: send('menu:workspace-search') },
        { type: 'separator' },
        { label: '格式化代码块', accelerator: 'Ctrl+Alt+L', click: send('menu:format') },
        { label: '整理中文排版', accelerator: 'Ctrl+Shift+L', click: send('menu:typeset') },
        { type: 'separator' },
        { label: '插入已有图片…', click: send('menu:insert-asset') },
        { label: '清理未使用图片…', click: send('menu:clean-images') }
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
        ...((!app.isPackaged || process.env.NODE_ENV === 'development')
          ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }]
          : [])
      ]
    },
    {
      label: '主题',
      submenu: [
        { label: '浅色', type: 'radio', checked: resolvedTheme() === 'light', click: () => mainWindow?.webContents.send('menu:theme', 'light') },
        { label: '青雾', type: 'radio', checked: resolvedTheme() === 'mist', click: () => mainWindow?.webContents.send('menu:theme', 'mist') },
        { label: '护眼', type: 'radio', checked: resolvedTheme() === 'sepia', click: () => mainWindow?.webContents.send('menu:theme', 'sepia') },
        { label: '深色', type: 'radio', checked: resolvedTheme() === 'dark', click: () => mainWindow?.webContents.send('menu:theme', 'dark') },
        { label: '墨夜', type: 'radio', checked: resolvedTheme() === 'ink', click: () => mainWindow?.webContents.send('menu:theme', 'ink') },
        { label: '海暮', type: 'radio', checked: resolvedTheme() === 'dusk', click: () => mainWindow?.webContents.send('menu:theme', 'dusk') }
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
      label: '设置',
      submenu: [
        { label: '打开设置…', accelerator: 'CmdOrCtrl+,', click: send('menu:settings') }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => mainWindow?.webContents.send('menu:check-update')
        },
        { type: 'separator' },
        {
          label: '官网',
          click: () => shell.openExternal(WEBSITE_URL)
        },
        {
          label: 'GitHub 仓库',
          click: () => shell.openExternal(`https://github.com/${GITHUB_REPO}`)
        },
        { type: 'separator' },
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

function toWorkspaceRelative(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath).split(path.sep).join('/');
  return relative || path.basename(filePath);
}

function isSearchWordChar(ch) {
  return /[A-Za-z0-9_\u3400-\u9fff]/.test(ch || '');
}

function findInLine(line, needle, options = {}) {
  const hits = [];
  if (!needle) return hits;
  if (options.regex) {
    try {
      const re = new RegExp(needle, options.caseSensitive ? 'g' : 'gi');
      let hit = re.exec(line);
      while (hit) {
        if (!hit[0]) {
          re.lastIndex += 1;
          hit = re.exec(line);
          continue;
        }
        hits.push(hit.index);
        if (hits.length >= 20) break;
        hit = re.exec(line);
      }
    } catch {
      return hits;
    }
    return hits;
  }
  const haystack = options.caseSensitive ? line : line.toLowerCase();
  const find = options.caseSensitive ? needle : needle.toLowerCase();
  let from = 0;
  while (from <= haystack.length - find.length) {
    const column = haystack.indexOf(find, from);
    if (column === -1) break;
    const end = column + needle.length;
    const whole = !options.wholeWord
      || ((column === 0 || !isSearchWordChar(line[column - 1])) && (end >= line.length || !isSearchWordChar(line[end])));
    if (whole) hits.push(column);
    from = column + needle.length;
  }
  return hits;
}

ipcMain.handle('workspace:search', async (_event, { rootPath, query, caseSensitive, wholeWord, regex }) => {
  const needle = String(query || '').trim();
  const root = path.resolve(rootPath || currentWorkspace || '');
  if (!needle || !root || !fs.existsSync(root)) return { names: [], contents: [] };
  const options = { caseSensitive: Boolean(caseSensitive), wholeWord: Boolean(wholeWord), regex: Boolean(regex) };
  if (options.regex) {
    try {
      RegExp(needle, options.caseSensitive ? 'g' : 'gi');
    } catch {
      return { names: [], contents: [], error: '正则无效' };
    }
  }

  const find = needle.toLowerCase();
  const names = [];
  const contents = [];
  let scanned = 0;
  const maxNames = 60;
  const maxContents = 200;
  const maxBytes = 1.5 * 1024 * 1024;

  function considerName(type, name, fullPath) {
    if (names.length >= maxNames) return;
    const rel = toWorkspaceRelative(root, fullPath);
    if (options.regex) {
      try {
        const re = new RegExp(needle, options.caseSensitive ? '' : 'i');
        if (!re.test(name) && !re.test(rel)) return;
      } catch {
        return;
      }
    } else if (!name.toLowerCase().includes(find) && !rel.toLowerCase().includes(find)) {
      return;
    }
    names.push({ type, name, path: fullPath, relative: rel });
  }

  function searchFileContent(fullPath, name) {
    if (contents.length >= maxContents) return;
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > maxBytes) return;
    let text;
    try {
      text = decodeDocumentBuffer(fs.readFileSync(fullPath)).content;
    } catch {
      return;
    }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const relative = toWorkspaceRelative(root, fullPath);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const columns = findInLine(line, needle, options);
      for (const column of columns) {
        contents.push({
          name,
          path: fullPath,
          relative,
          line: index,
          column,
          text: line.replace(/\s+/g, ' ').trim().slice(0, 180)
        });
        if (contents.length >= maxContents) return;
      }
    }
  }

  async function walk(directory, depth) {
    if (depth > MAX_TREE_DEPTH || scanned >= MAX_TREE_ITEMS) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= MAX_TREE_ITEMS || entry.isSymbolicLink()) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) continue;
        considerName('directory', entry.name, fullPath);
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && DOCUMENT_RE.test(entry.name)) {
        scanned += 1;
        considerName('file', entry.name, fullPath);
        searchFileContent(fullPath, entry.name);
        if (scanned % 24 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  await walk(root, 0);
  return { names, contents };
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
  if (result.canceled || !result.filePath) return null;
  authorizeWritePath(result.filePath);
  return result.filePath;
});

ipcMain.handle('dialog:export-html', async (_event, { defaultPath }) => {
  const name = (defaultPath || '未命名').replace(/\.(md|markdown|txt)$/i, '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 HTML',
    defaultPath: `${name}.html`,
    filters: [{ name: 'HTML 网页', extensions: ['html'] }]
  });
  focusMainWindow();
  if (result.canceled || !result.filePath) return null;
  authorizeWritePath(result.filePath);
  return result.filePath;
});

ipcMain.handle('dialog:export-pdf', async (_event, { defaultPath }) => {
  const name = (defaultPath || '未命名').replace(/\.(md|markdown|txt|html|pdf)$/i, '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF',
    defaultPath: `${name}.pdf`,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  });
  focusMainWindow();
  if (result.canceled || !result.filePath) return null;
  authorizeWritePath(result.filePath);
  return result.filePath;
});

function revisionRoot() {
  return path.join(app.getPath('userData'), 'revisions');
}

function revisionKey(filePath) {
  return crypto.createHash('sha1').update(String(path.resolve(filePath)).toLowerCase()).digest('hex');
}

ipcMain.handle('revision:save', async (_event, { filePath, content }) => {
  if (!filePath || content == null) return false;
  const dir = path.join(revisionRoot(), revisionKey(filePath));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  fs.writeFileSync(path.join(dir, `${stamp}.md`), String(content), 'utf8');
  fs.writeFileSync(path.join(dir, 'path.txt'), path.resolve(filePath), 'utf8');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  while (files.length > 10) {
    const old = files.shift();
    fs.unlinkSync(path.join(dir, old));
  }
  return true;
});

ipcMain.handle('revision:list', async (_event, { filePath }) => {
  if (!filePath) return [];
  const dir = path.join(revisionRoot(), revisionKey(filePath));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort().reverse().map((name) => {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    const stamp = Number(path.basename(name, '.md'));
    const preview = fs.readFileSync(full, 'utf8').slice(0, 220).replace(/\s+/g, ' ').trim();
    return { id: name, at: stamp || stat.mtimeMs, bytes: stat.size, preview };
  });
});

ipcMain.handle('revision:read', async (_event, { filePath, id }) => {
  if (!filePath || !id) throw new Error('没有这条历史。');
  const dir = path.join(revisionRoot(), revisionKey(filePath));
  const full = path.join(dir, path.basename(String(id)));
  if (!full.startsWith(dir) || !full.endsWith('.md') || !fs.existsSync(full)) {
    throw new Error('没有这条历史。');
  }
  return fs.readFileSync(full, 'utf8');
});

ipcMain.handle('image:list-assets', async (_event, { documentPath }) => {
  if (!documentPath) return [];
  const dir = path.join(path.dirname(path.resolve(documentPath)), 'assets');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return [];
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) return [];
      return [{
        name,
        path: full,
        relative: toPosixRelative(path.dirname(path.resolve(documentPath)), full),
        fileUrl: pathToFileURL(full).href,
        bytes: stat.size
      }];
    } catch {
      return [];
    }
  });
});

ipcMain.handle('image:delete-files', async (_event, { documentPath, names }) => {
  if (!documentPath) return [];
  const dir = path.join(path.dirname(path.resolve(documentPath)), 'assets');
  const deleted = [];
  for (const raw of names || []) {
    const base = path.basename(String(raw || ''));
    if (!IMAGE_EXTENSIONS.has(path.extname(base).toLowerCase())) continue;
    const full = path.join(dir, base);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    noteOwnWrite(full);
    fs.unlinkSync(full);
    deleted.push(base);
  }
  return deleted;
});

ipcMain.handle('export:pdf', async (_event, { filePath, html }) => {
  if (!filePath) throw new Error('缺少保存路径。');
  let dest = path.resolve(filePath);
  if (!dest.toLowerCase().endsWith('.pdf')) dest += '.pdf';
  authorizeWritePath(dest);
  const resolved = assertAuthorizedWrite(dest);
  const tmp = path.join(app.getPath('temp'), `markl-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, String(html || ''), 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true }
  });
  try {
    await win.loadFile(tmp);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 }
    });
    fs.writeFileSync(resolved, data);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  return resolved;
});

ipcMain.handle('file:write', async (_event, { filePath, content }) => {
  const resolved = assertAuthorizedWrite(filePath);
  noteOwnWrite(resolved);
  fs.writeFileSync(resolved, String(content ?? ''), 'utf8');
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
        if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
          return { src, exists: false };
        }
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
      if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
        return { src, exists: false };
      }
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

function resolveLocalImagePath(documentPath, rawSrc) {
  const src = String(rawSrc || '').trim();
  if (!src || /^(https?:|data:|blob:)/i.test(src)) return null;
  const baseDir = path.dirname(path.resolve(documentPath));
  try {
    const absolute = /^file:/i.test(src)
      ? fileURLToPath(src.split(/[?#]/)[0])
      : path.resolve(baseDir, decodeURI(src.split(/[?#]/)[0]));
    if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return null;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
    return absolute;
  } catch {
    return null;
  }
}

ipcMain.handle('html:inline-images', async (_event, { documentPath, html }) => {
  const source = String(html || '');
  if (!documentPath || !source) return source;
  const replacements = new Map();
  const pattern = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let match = pattern.exec(source);
  while (match) {
    const src = match[1];
    if (!replacements.has(src)) {
      const absolute = resolveLocalImagePath(documentPath, src);
      if (absolute) {
        try {
          const buffer = fs.readFileSync(absolute);
          if (buffer.length && buffer.length <= MAX_IMAGE_BYTES) {
            const mime = IMAGE_MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
            replacements.set(src, `data:${mime};base64,${buffer.toString('base64')}`);
          }
        } catch {
          // 单张图读失败时保留原路径。
        }
      }
    }
    match = pattern.exec(source);
  }
  if (!replacements.size) return source;
  return source.replace(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi, (full, src) => {
    const dataUrl = replacements.get(src);
    return dataUrl ? full.replace(src, dataUrl) : full;
  });
});

ipcMain.handle('app:print', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return new Promise((resolve) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success) => {
      resolve(Boolean(success));
    });
  });
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('app:launch-context', async () => {
  const document = launchDocument;
  launchDocument = null;
  return {
    file: document,
    packaged: app.isPackaged,
    portable: isPortableBuild(),
    canAutoUpdate: canAutoUpdate(),
    prefs: currentPrefs,
    appearance: currentAppearance,
    systemDark: nativeTheme.shouldUseDarkColors,
    dev: !app.isPackaged || process.env.NODE_ENV === 'development'
  };
});

ipcMain.handle('prefs:get', async () => currentPrefs);

ipcMain.handle('prefs:set', async (_event, payload) => {
  writePrefs(payload || {});
  applyNativeAppearance(currentAppearance, { persist: true, rebuildMenu: true });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('prefs:changed', {
      prefs: currentPrefs,
      appearance: currentAppearance,
      theme: resolvedTheme(),
      systemDark: nativeTheme.shouldUseDarkColors
    });
  }
  return currentPrefs;
});

let katexCssCache = '';

function inlineKatexCss() {
  if (katexCssCache) return katexCssCache;
  const cssPath = path.join(__dirname, '..', 'node_modules', 'vditor', 'dist', 'js', 'katex', 'katex.min.css');
  if (!fs.existsSync(cssPath)) return '';
  let css = fs.readFileSync(cssPath, 'utf8');
  const fontDir = path.join(path.dirname(cssPath), 'fonts');
  css = css.replace(/url\((?:'|")?(fonts\/[^)"']+\.woff2)(?:'|")?\)/g, (full, rel) => {
    const file = path.join(path.dirname(cssPath), rel.split('/').join(path.sep));
    if (!fs.existsSync(file)) return full;
    return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
  });
  css = css.replace(/,url\((?:'|")?fonts\/[^)"']+\.(?:woff|ttf)(?:'|")?\)[^,;} ]*/g, '');
  void fontDir;
  katexCssCache = css;
  return katexCssCache;
}

ipcMain.handle('html:katex-css', async () => inlineKatexCss());

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
  authorizeWritePath(dest);
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
  if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) {
    throw new Error('仅支持网页或邮件链接。');
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
        { label: '删除', click: () => finish('delete') }
      );
      if (kind === 'file') {
        items.push({ label: payload.pinned ? '取消钉住' : '钉在顶部', click: () => finish(payload.pinned ? 'unpin' : 'pin') });
      }
      items.push({ type: 'separator' }, { label: '在资源管理器中显示', click: () => finish('reveal') });
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

ipcMain.on('app:try-close', () => {
  mainWindow?.close();
});

ipcMain.on('app:reload', () => {
  mainWindow?.reload();
});

ipcMain.on('app:zoom', (_event, dir) => {
  const contents = mainWindow?.webContents;
  if (!contents) return;
  if (dir === 'in') contents.setZoomLevel(contents.getZoomLevel() + 0.5);
  else if (dir === 'out') contents.setZoomLevel(contents.getZoomLevel() - 0.5);
  else contents.setZoomLevel(0);
});

ipcMain.on('app:fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('app:devtools', () => {
  mainWindow?.webContents.toggleDevTools();
});

ipcMain.on('app:set-title', (_event, title) => mainWindow?.setTitle(title));
ipcMain.on('appearance:set', (_event, payload) => {
  applyNativeAppearance(payload, { persist: true, rebuildMenu: true });
});

ipcMain.handle('update:check', async () => {
  const result = await checkForUpdate({ silent: false });
  return { ...result, canAutoUpdate: canAutoUpdate() };
});

ipcMain.handle('update:dismiss', async (_event, version) => {
  const value = String(version || '').replace(/^v/i, '').trim();
  if (value) writeDismissedVersion(value);
  return true;
});

ipcMain.handle('update:download', async () => {
  if (!canAutoUpdate() || !autoUpdater) throw new Error('当前版本不支持应用内安装。');
  await autoUpdater.downloadUpdate();
  return true;
});

ipcMain.handle('update:install', async () => {
  if (!canAutoUpdate() || !autoUpdater) throw new Error('当前版本不支持应用内安装。');
  autoUpdater.quitAndInstall();
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
    currentPrefs = readPrefs();
    applyIgnoredDirectories(currentPrefs.ignoredDirectories);
    applyNativeAppearance(readAppearance());
    setupAutoUpdater();
    nativeTheme.on('updated', () => {
      if (!currentPrefs.followSystemTheme) return;
      applyNativeAppearance(currentAppearance, { persist: false, rebuildMenu: true });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('prefs:changed', {
          prefs: currentPrefs,
          appearance: currentAppearance,
          theme: resolvedTheme(),
          systemDark: nativeTheme.shouldUseDarkColors
        });
      }
    });
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
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
