import {
  FIND_MATCH_LIMIT,
  collectMatches,
  compileSearch,
  replaceRange,
  replaceAllMatches,
  lineNumberAt,
  visibleLineHint,
  toMarkdownImage,
  rewriteFileUrls,
  imageAltFromName,
  sanitizeMarkdownHtml,
  visibleProseFromMarkdown,
  cleanHeadingText,
  parseHeadingOutline
} from './text-search.js';
import { typesetChineseMarkdown } from './zh-typeset.js';
import { DOC_TEMPLATES, templateById, fileNameForTemplate } from './templates.js';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'node'], description: '网页与 Node.js' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'], description: '带类型的 JavaScript' },
  { id: 'java', label: 'Java', aliases: [], description: 'Java 代码' },
  { id: 'python', label: 'Python', aliases: ['py'], description: 'Python 脚本' },
  { id: 'html', label: 'HTML', aliases: ['markup', 'xml'], description: '网页标记语言' },
  { id: 'css', label: 'CSS', aliases: [], description: '网页样式' },
  { id: 'json', label: 'JSON', aliases: [], description: '结构化数据' },
  { id: 'bash', label: 'Shell / Bash', aliases: ['sh', 'shell'], description: '命令行脚本' },
  { id: 'c', label: 'C', aliases: [], description: 'C 语言' },
  { id: 'cpp', label: 'C++', aliases: ['c++'], description: 'C++ 语言' },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'], description: '.NET 语言' },
  { id: 'sql', label: 'SQL', aliases: [], description: '数据库查询' },
  { id: 'go', label: 'Go', aliases: ['golang'], description: 'Go 语言' },
  { id: 'rust', label: 'Rust', aliases: ['rs'], description: 'Rust 语言' },
  { id: 'markdown', label: 'Markdown', aliases: ['md'], description: 'Markdown 文档' },
  { id: 'mermaid', label: 'Mermaid', aliases: ['mmd', 'diagram'], description: '流程图 / 时序图' },
  { id: 'text', label: '纯文本', aliases: ['plaintext', 'txt'], description: '不使用语法高亮' }
];

const LANGUAGE_ALIASES = {
  js: 'javascript', node: 'javascript', ts: 'typescript', py: 'python',
  markup: 'html', xml: 'html', shell: 'bash', sh: 'bash', 'c++': 'cpp',
  cs: 'csharp', 'c#': 'csharp', golang: 'go', rs: 'rust', md: 'markdown',
  plaintext: 'text', txt: 'text', mmd: 'mermaid', diagram: 'mermaid'
};

const VDITOR_CDN = new URL('../../node_modules/vditor', import.meta.url).href;
const CONTENT_THEME_PATH = new URL('../../node_modules/vditor/dist/css/content-theme', import.meta.url).href;
const HISTORY_KEY = 'markl-open-history';
const HISTORY_OPEN_KEY = 'markl-history-open';
const HISTORY_LIMIT = 16;
const SIDEBAR_TAB_KEY = 'markl-sidebar-tab';
const SESSION_KEY = 'markl-session';
const APPEARANCE_KEY = 'markl-appearance';
const PINS_KEY = 'markl-pins';
const CARET_KEY = 'markl-carets';
const RECENT_KEY = 'markl-recent-files';
const PIN_LIMIT = 5;
const RECENT_LIMIT = 8;
const CARET_LIMIT = 40;
const THEME_IDS = ['light', 'mist', 'sepia', 'dark', 'ink', 'dusk'];
const DARK_THEMES = new Set(['dark', 'ink', 'dusk']);
const THEME_LABELS = {
  light: '浅色',
  mist: '青雾',
  sepia: '护眼',
  dark: '深色',
  ink: '墨夜',
  dusk: '海暮'
};
const THEME_SWATCHES = {
  light: '#f4f5f7',
  mist: '#d4ebf3',
  sepia: '#e4dac8',
  dark: '#2a2f37',
  ink: '#181b22',
  dusk: '#222c3a'
};
const FONT_STACKS = {
  default: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  song: 'SimSun, "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif',
  kai: 'KaiTi, STKaiti, "Kaiti SC", "Noto Serif SC", serif',
  fangsong: 'FangSong, STFangsong, "Fangsong SC", serif',
  hei: 'SimHei, "Heiti SC", "Microsoft YaHei UI", sans-serif',
  deng: 'DengXian, "Source Han Sans SC", "Microsoft YaHei UI", sans-serif'
};
const FONT_SIZES = {
  small: '15.5px',
  medium: '16.5px',
  large: '18px',
  xlarge: '20px'
};
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const DOCUMENT_FILE_RE = /\.(md|markdown|txt)$/i;
const SIDEBAR_WIDTH_KEY = 'markl-sidebar-width';
const SIDEBAR_MIN = 248;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 280;

const state = {
  filePath: null,
  savedContent: '',
  dirty: false,
  workspaceRoot: null,
  workspaceName: null,
  workspaceTree: [],
  expandedPaths: new Set(),
  outlineCollapsed: new Set(),
  sidebarTab: 'files',
  popup: { visible: false, query: '', items: [], selected: 0, suppressUntil: 0 },
  treeDraft: null,
  sourceMode: false,
  editorReady: false,
  restoringSession: false,
  appearance: { theme: 'light', font: 'default', fontSize: 'medium' },
  diskMtime: 0,
  fileMissing: false
};

const elements = {
  docTitle: document.getElementById('doc-title'),
  docPath: document.getElementById('doc-path'),
  dirtyDot: document.getElementById('dirty-dot'),
  modeLabel: document.getElementById('mode-label'),
  counts: document.getElementById('counts'),
  saveStatus: document.getElementById('save-status'),
  fileTree: document.getElementById('file-tree'),
  treeEmpty: document.getElementById('tree-empty'),
  headingTree: document.getElementById('heading-tree'),
  pinnedList: document.getElementById('pinned-list'),
  workspaceReplaceBar: document.getElementById('workspace-replace-bar'),
  workspaceReplaceInput: document.getElementById('workspace-replace-input'),
  workspaceReplaceAll: document.getElementById('workspace-replace-all'),
  findWord: document.getElementById('find-word'),
  findRegex: document.getElementById('find-regex'),
  templateBar: document.getElementById('template-bar'),
  templateBarActions: document.getElementById('template-bar-actions'),
  recentSwitcher: document.getElementById('recent-switcher'),
  revisionPanel: document.getElementById('revision-panel'),
  revisionList: document.getElementById('revision-list'),
  revisionClose: document.getElementById('revision-close'),
  assetPanel: document.getElementById('asset-panel'),
  assetList: document.getElementById('asset-list'),
  assetClose: document.getElementById('asset-close'),
  outlineDocName: document.getElementById('outline-doc-name'),
  outlineCount: document.getElementById('outline-count'),
  filesPanel: document.getElementById('files-panel'),
  outlinePanel: document.getElementById('outline-panel'),
  tabFiles: document.getElementById('tab-files'),
  tabOutline: document.getElementById('tab-outline'),
  tabSearch: document.getElementById('tab-search'),
  searchPanel: document.getElementById('search-panel'),
  workspaceSearchInput: document.getElementById('workspace-search-input'),
  workspaceSearchResults: document.getElementById('workspace-search-results'),
  workspaceHeading: document.getElementById('workspace-heading'),
  workspaceName: document.getElementById('workspace-name'),
  workspacePath: document.getElementById('workspace-path'),
  refreshTreeButton: document.getElementById('refresh-tree-button'),
  newTreeButton: document.getElementById('new-tree-button'),
  sidebar: document.getElementById('sidebar'),
  sidebarActions: document.getElementById('sidebar-actions'),
  openFolderButton: document.getElementById('open-folder-button'),
  openHistory: document.getElementById('open-history'),
  historyToggle: document.getElementById('history-toggle'),
  appMenubar: document.getElementById('app-menubar'),
  appMenuDropdown: document.getElementById('app-menu-dropdown'),
  appDialog: document.getElementById('app-dialog'),
  appDialogBackdrop: document.getElementById('app-dialog-backdrop'),
  appDialogTitle: document.getElementById('app-dialog-title'),
  appDialogBody: document.getElementById('app-dialog-body'),
  appDialogOk: document.getElementById('app-dialog-ok'),
  appDialogCancel: document.getElementById('app-dialog-cancel'),
  appDialogIcon: document.getElementById('app-dialog-icon'),
  languagePopup: document.getElementById('language-popup'),
  languageQueryInput: document.getElementById('language-query-input'),
  languageList: document.getElementById('language-list'),
  editorWrap: document.getElementById('editor-wrap'),
  sourceEditor: document.getElementById('source-editor'),
  historyList: document.getElementById('history-list'),
  clearHistoryButton: document.getElementById('clear-history-button'),
  tableToolbar: document.getElementById('table-toolbar'),
  tableInsertButton: document.getElementById('table-insert-button'),
  tableMoreButton: document.getElementById('table-more-button'),
  tableInsertMenu: document.getElementById('table-insert-menu'),
  tableMoreMenu: document.getElementById('table-more-menu'),
  tableSizeGrid: document.getElementById('table-size-grid'),
  tableSizeText: document.getElementById('table-size-text'),
  findBar: document.getElementById('find-bar'),
  findInput: document.getElementById('find-input'),
  findCount: document.getElementById('find-count'),
  findCase: document.getElementById('find-case'),
  findPrev: document.getElementById('find-prev'),
  findNext: document.getElementById('find-next'),
  findToggleReplace: document.getElementById('find-toggle-replace'),
  findClose: document.getElementById('find-close'),
  replaceRow: document.getElementById('replace-row'),
  replaceInput: document.getElementById('replace-input'),
  replaceOne: document.getElementById('replace-one'),
  replaceAll: document.getElementById('replace-all'),
  dropMask: document.getElementById('drop-mask'),
  quickOpen: document.getElementById('quick-open'),
  quickOpenInput: document.getElementById('quick-open-input'),
  quickOpenList: document.getElementById('quick-open-list'),
  updatePanel: document.getElementById('update-panel'),
  updateTitle: document.getElementById('update-title'),
  updateLead: document.getElementById('update-lead'),
  updateVersions: document.getElementById('update-versions'),
  updateCurrent: document.getElementById('update-current'),
  updateLatest: document.getElementById('update-latest'),
  updateMeta: document.getElementById('update-meta'),
  updateNotes: document.getElementById('update-notes'),
  updateError: document.getElementById('update-error'),
  updateDownload: document.getElementById('update-download'),
  updateSetup: document.getElementById('update-setup'),
  updateRetry: document.getElementById('update-retry'),
  updateLater: document.getElementById('update-later'),
  updateOk: document.getElementById('update-ok'),
  updateRelease: document.getElementById('update-release'),
  updateActions: document.getElementById('update-actions'),
  updateClose: document.getElementById('update-close'),
  checkUpdateButton: document.getElementById('check-update-button'),
  formatMenu: document.getElementById('format-menu')
};

function normalizeMarkdown(content = '') {
  return sanitizeMarkdownHtml(
    content.replace(/<\/?cener(\s[^>]*)?>/gi, (tag) => tag.replace(/cener/i, 'center'))
  );
}

function canonicalLanguage(language) {
  const value = String(language || '').toLowerCase();
  return LANGUAGE_ALIASES[value] || value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let vditor = null;

function getMarkdown() {
  const raw = state.sourceMode
    ? (elements.sourceEditor.value || '')
    : (vditor?.getValue?.() || '');
  return sanitizeImageMarkdown(raw);
}

function getHTML() {
  return sanitizeImageMarkdown(vditor?.getHTML?.() || '');
}

function setMarkdown(content, clearStack = true) {
  const value = content || '';
  elements.sourceEditor.value = value;
  if (vditor && state.editorReady) vditor.setValue(value, clearStack);
}

let editorComposing = false;

function getIrElement() {
  return document.querySelector('.vditor-ir pre.vditor-reset');
}

function irController() {
  return vditor?.vditor?.ir || null;
}

function isEditorComposing() {
  return editorComposing || Boolean(irController()?.composingLock);
}

function selectionHost() {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function isHiddenVisual(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.isConnected) return true;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  return false;
}

function isUnusableCaretHost(el) {
  if (!el) return true;
  if (el.closest('.markl-live-hl, .language-popup, .table-toolbar, .find-bar, .update-panel, #quick-open, #app-dialog, #source-editor, .format-menu')) return true;
  if (el.closest('.vditor-ir__preview')) return true;
  if (el.closest('[data-type$="-open-marker"], [data-type$="-close-marker"]')) return true;
  const ir = getIrElement();
  let node = el;
  while (node && node !== ir && node !== document.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (isHiddenVisual(node)) return true;
      if (node.classList?.contains('vditor-ir__marker')) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function isDeadFocusTarget(el) {
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el === elements.languageQueryInput) return !state.popup.visible || Boolean(el.closest('.hidden'));
  if (el.closest?.('.hidden, .markl-live-hl')) return true;
  if (el.nodeType === Node.ELEMENT_NODE && isHiddenVisual(el)) return true;
  return false;
}

function placeCaretIn(el, atStart = true) {
  if (!el) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(atStart);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function releaseComposingLock() {
  editorComposing = false;
  const ir = irController();
  if (ir) ir.composingLock = false;
}

function repairEditorCaret(options = {}) {
  if (state.sourceMode) return false;
  if (isEditorComposing()) return false;
  if (state.popup.visible && !options.ignorePopup) return false;
  if (document.activeElement?.closest?.('.tree-draft-row, .tree-draft-input')) return false;

  const ir = getIrElement();
  if (!ir) return false;
  if (ir.getAttribute('contenteditable') === 'false') ir.setAttribute('contenteditable', 'true');
  releaseComposingLock();

  const active = document.activeElement;
  if (active && !isDeadFocusTarget(active) && active !== ir && !ir.contains(active) && !options.forceFocus) {
    return false;
  }

  const host = selectionHost();
  const selectionInIr = Boolean(host && ir.contains(host));
  const selectionBad = !selectionInIr || isUnusableCaretHost(host);

  if (options.forceFocus || isDeadFocusTarget(active) || active !== ir) ir.focus();
  if (!selectionBad) return true;

  const block = host?.closest?.('[data-type="code-block"], [data-type="math-block"], [data-type="html-block"], [data-type="yaml-front-matter"]');
  const code = block?.querySelector('.vditor-ir__marker--pre code');
  if (code) {
    block.classList.add('vditor-ir__node--expand');
    block.classList.remove('vditor-ir__node--hidden');
    return placeCaretIn(code, true);
  }

  const visible = host?.closest?.('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote');
  if (visible && ir.contains(visible) && !isUnusableCaretHost(visible)) return placeCaretIn(visible, false);

  const last = [...ir.children].reverse().find((child) => child.nodeType === 1);
  return last ? placeCaretIn(last, false) : true;
}

function restoreEditorFocus() {
  requestAnimationFrame(() => {
    focusEditor();
    repairEditorCaret({ forceFocus: true, ignorePopup: true });
  });
}

function focusEditor() {
  if (state.sourceMode) {
    elements.sourceEditor.focus();
    return;
  }
  const ir = getIrElement();
  if (ir?.getAttribute('contenteditable') === 'false') ir.setAttribute('contenteditable', 'true');
  vditor?.focus?.();
  ir?.focus();
}

function baseName(filePath) {
  if (!filePath) return '未命名.md';
  return filePath.split(/[\\/]/).pop();
}

function directoryName(filePath) {
  if (!filePath) return '新文档';
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join(' / ') || '本地文件';
}

function isPathInside(filePath, rootPath) {
  if (!filePath || !rootPath) return false;
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function samePath(left, right) {
  return String(left || '').replace(/\\/g, '/').toLowerCase() === String(right || '').replace(/\\/g, '/').toLowerCase();
}

function parentFolderName(filePath) {
  const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.pop() || '';
}

function parentDisplay(filePath) {
  return parentFolderName(filePath);
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.path && (item.kind === 'file' || item.kind === 'folder'));
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
}

function rememberOpen(kind, filePath) {
  if (!filePath || (kind !== 'file' && kind !== 'folder')) return;
  const items = readHistory().filter((item) => !samePath(item.path, filePath));
  items.unshift({
    kind,
    path: filePath,
    name: baseName(filePath),
    at: Date.now()
  });
  writeHistory(items);
  renderHistory();
}

function forgetOpen(filePath) {
  writeHistory(readHistory().filter((item) => !samePath(item.path, filePath)));
  renderHistory();
}

function forgetOpenTree(targetPath) {
  writeHistory(readHistory().filter((item) => !isPathInside(item.path, targetPath)));
  renderHistory();
}

function rewriteHistoryPath(oldPath, nextPath) {
  if (!oldPath || !nextPath || samePath(oldPath, nextPath)) return;
  writeHistory(readHistory().map((item) => {
    if (!samePath(item.path, oldPath)) return item;
    return { ...item, path: nextPath, name: baseName(nextPath) };
  }));
  renderHistory();
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} 周前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

function renderHistory() {
  if (!elements.historyList) return;
  const items = readHistory();
  elements.clearHistoryButton.classList.toggle('hidden', !items.length);
  elements.historyList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '打开过的文件和文件夹会记在这里';
    elements.historyList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'history-item';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'history-row';
    openButton.dataset.path = item.path;
    openButton.dataset.kind = item.kind;
    openButton.title = item.path;
    if (item.kind === 'file' && samePath(item.path, state.filePath)) openButton.classList.add('is-active');
    if (item.kind === 'folder' && samePath(item.path, state.workspaceRoot)) openButton.classList.add('is-active');

    const copy = document.createElement('span');
    copy.className = 'history-copy';
    const nameRow = document.createElement('span');
    nameRow.className = 'history-name-row';
    const name = document.createElement('span');
    name.className = 'history-name';
    name.textContent = item.name || baseName(item.path);
    const timeLine = document.createElement('span');
    timeLine.className = 'history-time';
    timeLine.textContent = relativeTime(item.at);
    nameRow.append(name, timeLine);
    const pathLine = document.createElement('span');
    pathLine.className = 'history-path';
    pathLine.textContent = parentDisplay(item.path) || item.path;
    copy.append(nameRow, pathLine);

    openButton.append(item.kind === 'folder' ? folderIcon() : fileIcon(), copy);
    openButton.addEventListener('click', () => openHistoryItem(item));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-remove';
    remove.title = '从历史中移除';
    remove.setAttribute('aria-label', `从历史中移除 ${item.name || baseName(item.path)}`);
    remove.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"/></svg>';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      forgetOpen(item.path);
    });

    wrap.append(openButton, remove);
    elements.historyList.appendChild(wrap);
  });
}

async function openHistoryItem(item) {
  try {
    const stat = await window.markl.statPath(item.path);
    if (!stat?.exists) {
      forgetOpen(item.path);
      showOperationError('打开历史', new Error('这个文件或文件夹已经不在了，已从历史里去掉。'));
      return;
    }
    if (item.kind === 'folder' || stat.kind === 'directory') {
      const payload = await window.markl.refreshWorkspace(item.path);
      if (payload) {
        applyWorkspace(payload);
        rememberOpen('folder', payload.rootPath);
      }
      return;
    }
    if (item.path === state.filePath) return;
    if (!(await confirmDiscardIfDirty())) return;
    const result = await window.markl.readFile({ filePath: stat.path || item.path });
    loadContent(result.filePath, result.content);
  } catch (error) {
    showOperationError(item.kind === 'folder' ? '打开文件夹' : '打开文件', error);
  }
}

function updateTitle() {
  const name = baseName(state.filePath);
  const folder = parentFolderName(state.filePath);
  elements.docTitle.textContent = name;
  elements.docPath.textContent = state.filePath ? (folder || '本地文件') : '新文档';
  elements.docPath.title = state.filePath ? (parentDirectory(state.filePath) || state.filePath) : '新文档';
  elements.dirtyDot.classList.toggle('hidden', !state.dirty);
  elements.saveStatus.textContent = state.dirty ? '尚未保存' : '已保存';
  elements.saveStatus.classList.toggle('is-dirty', state.dirty);
  window.markl.setTitle(`${state.dirty ? '● ' : ''}${name} — MarkL`);
  updateActiveTreeItem();
}

function updateCounts() {
  const markdown = getMarkdown() || '';
  const raw = markdown.replace(/\n+$/, '');
  const text = visibleProseFromMarkdown(markdown);
  const characters = Array.from(text).length;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latinWords = (text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['_-][A-Za-z0-9]+)*/g) || []).length;
  const lines = raw ? raw.split('\n').length : 0;
  const paragraphs = raw ? raw.split(/\n\s*\n/).filter((b) => b.trim().length > 0).length : 0;
  elements.counts.textContent = (cjk + latinWords) + ' 字 · ' + characters + ' 字符 · ' + lines + ' 行 · ' + paragraphs + ' 段';
}

function markClean(content) {
  state.savedContent = content;
  state.dirty = false;
  state.fileMissing = false;
  updateTitle();
}

function recomputeDirty() {
  const dirty = state.fileMissing || getMarkdown() !== state.savedContent;
  if (dirty !== state.dirty) {
    state.dirty = dirty;
    updateTitle();
  }
  updateCounts();
  scheduleOutlineRefresh();
  persistDraftSoon();
  scheduleAutoSave();
  syncTemplateBar();
}

function loadContent(filePath, content) {
  if (state.filePath && state.filePath !== filePath) rememberCaret(state.filePath);
  state.filePath = filePath;
  const normalized = normalizeMarkdown(content);
  setMarkdown(normalized, true);
  markClean(normalized);
  updateCounts();
  renderHeadingTree();
  if (filePath) {
    rememberOpen('file', filePath);
    rememberRecentFile(filePath);
  }
  expandAncestors(filePath, state.workspaceRoot);
  updateActiveTreeItem();
  scheduleImageResolve();
  refreshFindMatches({ stay: true });
  persistSession();
  rememberDiskStamp(filePath);
  syncWatch();
  restoreCaret(filePath);
  syncTemplateBar();
  restoreEditorFocus();
}

let dialogResolver = null;

function isAppDialogOpen() {
  return Boolean(elements.appDialog && !elements.appDialog.classList.contains('hidden') && !elements.appDialog.classList.contains('is-leaving'));
}

function closeAppDialog(result) {
  if (!elements.appDialog) return;
  concealLayer(elements.appDialog);
  const resolve = dialogResolver;
  dialogResolver = null;
  if (resolve) resolve(Boolean(result));
  requestAnimationFrame(() => {
    if (!isAppDialogOpen()) restoreEditorFocus();
  });
}

const DIALOG_ICONS = {
  info: '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.35"/><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M8 7.15v4.05M8 5.2v.25"/></svg>',
  warning: '<svg viewBox="0 0 16 16" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" d="M8 2.7 13.7 13.1H2.3Z"/><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M8 6.4v3.2M8 11.35v.3"/></svg>',
  danger: '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.35"/><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M6.1 6.1l3.8 3.8M9.9 6.1l-3.8 3.8"/></svg>'
};

function showAppDialog({ title, message, ok = '确定', cancel = '', danger = false, type = '' } = {}) {
  return new Promise((resolve) => {
    if (!elements.appDialog) {
      resolve(false);
      return;
    }
    if (dialogResolver) closeAppDialog(false);
    dialogResolver = resolve;
    elements.appDialogTitle.textContent = title || '提示';
    elements.appDialogBody.textContent = message || '';
    elements.appDialogOk.textContent = ok;
    elements.appDialogOk.classList.toggle('is-danger', Boolean(danger));
    if (elements.appDialogIcon) {
      const iconType = type || (danger ? 'danger' : 'info');
      elements.appDialogIcon.className = `app-dialog-icon is-${iconType}`;
      elements.appDialogIcon.innerHTML = DIALOG_ICONS[iconType] || DIALOG_ICONS.info;
    }
    if (cancel) {
      elements.appDialogCancel.textContent = cancel;
      elements.appDialogCancel.classList.remove('hidden');
    } else {
      elements.appDialogCancel.classList.add('hidden');
    }
    revealLayer(elements.appDialog);
    elements.appDialogOk.focus();
  });
}

async function confirmDiscardIfDirty() {
  if (!state.dirty) return true;
  const ok = await showAppDialog({
    title: '未保存的更改',
    message: `「${baseName(state.filePath)}」还有未保存的更改。放弃后这些修改会丢掉。`,
    ok: '放弃更改',
    cancel: '继续编辑',
    danger: true
  });
  if (ok) await window.markl.clearDraft().catch(() => {});
  return ok;
}

function showOperationError(action, error) {
  console.error(action, error);
  return showAppDialog({
    title: `${action}失败`,
    message: error?.message || String(error),
    ok: '知道了'
  });
}

async function doNew() {
  if (!(await confirmDiscardIfDirty())) return;
  if (state.filePath) rememberCaret(state.filePath);
  state.filePath = null;
  setMarkdown('', true);
  markClean('');
  updateCounts();
  renderHeadingTree();
  updateActiveTreeItem();
  refreshFindMatches({ stay: false });
  persistSession();
  rememberDiskStamp(null);
  syncWatch();
  syncTemplateBar();
  focusEditor();
}

async function doOpen() {
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const result = await window.markl.openDialog();
    if (result) loadContent(result.filePath, result.content);
  } catch (error) {
    showOperationError('打开文件', error);
  } finally {
    restoreEditorFocus();
  }
}

async function openTreeFile(filePath) {
  if (filePath === state.filePath) return;
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const result = await window.markl.readFile({ filePath });
    loadContent(result.filePath, result.content);
  } catch (error) {
    showOperationError('读取文件', error);
  }
}

async function snapshotCurrentRevision() {
  if (!state.filePath || !state.savedContent) return;
  try {
    await window.markl.saveRevision?.({ filePath: state.filePath, content: state.savedContent });
  } catch {
    // 历史失败不影响保存。
  }
}

async function doSave() {
  try {
    if (!state.filePath) return doSaveAs();
    const content = getMarkdown();
    if (content !== state.savedContent) await snapshotCurrentRevision();
    await window.markl.writeFile({ filePath: state.filePath, content });
    markClean(content);
    rememberDiskStamp(state.filePath);
    rememberCaret(state.filePath);
    clearDraftSoon();
    return true;
  } catch (error) {
    showOperationError('保存文件', error);
    return false;
  }
}

async function doSaveAs() {
  try {
    const target = await window.markl.saveAsDialog({ defaultPath: baseName(state.filePath) });
    if (!target) return false;
    const content = getMarkdown();
    if (state.filePath && content !== state.savedContent) await snapshotCurrentRevision();
    await window.markl.writeFile({ filePath: target, content });
    state.filePath = target;
    markClean(content);
    rememberOpen('file', target);
    if (isPathInside(target, state.workspaceRoot)) await refreshWorkspace();
    scheduleImageResolve();
    persistSession();
    rememberDiskStamp(target);
    syncWatch();
    clearDraftSoon();
    restoreEditorFocus();
    return true;
  } catch (error) {
    showOperationError('另存为', error);
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function doExportHtml() {
  try {
    const target = await window.markl.exportHtmlDialog({ defaultPath: baseName(state.filePath) });
    if (!target) return;
    const title = baseName(target).replace(/\.html$/i, '');
    await window.markl.writeFile({ filePath: target, content: await buildStandaloneHtml(title) });
  } catch (error) {
    showOperationError('导出 HTML', error);
  } finally {
    restoreEditorFocus();
  }
}

async function doExportPdf() {
  try {
    const target = await window.markl.exportPdfDialog({ defaultPath: baseName(state.filePath) });
    if (!target) return;
    const title = baseName(target).replace(/\.pdf$/i, '');
    await window.markl.exportPdf({ filePath: target, html: await buildStandaloneHtml(title) });
  } catch (error) {
    showOperationError('导出 PDF', error);
  } finally {
    restoreEditorFocus();
  }
}

function parentDirectory(filePath) {
  if (!filePath) return state.workspaceRoot;
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join(pathSeparator(filePath));
}

function pathSeparator(filePath) {
  return String(filePath || '').includes('\\') ? '\\' : '/';
}

function svgNode(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function chevronIcon(expanded) {
  return svgNode(expanded
    ? '<svg class="tree-chevron-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M4.6 6.2 8 9.6 11.4 6.2"/></svg>'
    : '<svg class="tree-chevron-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M6.2 4.6 9.6 8 6.2 11.4"/></svg>');
}

function folderIcon(open = false) {
  if (open) {
    return svgNode(`<svg class="tree-type-icon is-folder is-open" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path class="folder-fill" d="M2.3 7.45h11.4l-.95 5.15c-.1.52-.55.9-1.08.9H4.33c-.53 0-.98-.38-1.08-.9L2.3 7.45Z"/>
      <path class="folder-line" d="M2.7 6.2V4.35c0-.4.32-.72.72-.72h1.82c.22 0 .42.1.56.27L6.7 5.05h5.35c.44 0 .8.35.8.78V6.3"/>
      <path class="folder-line" d="M2.25 7.5h11.5l-.98 5.15c-.1.5-.54.85-1.06.85H4.29c-.52 0-.96-.35-1.06-.85L2.25 7.5Z"/>
    </svg>`);
  }
  return svgNode(`<svg class="tree-type-icon is-folder" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path class="folder-fill" d="M2.7 5.55h10.65v6.5c0 .5-.4.9-.9.9H3.6c-.5 0-.9-.4-.9-.9v-6.5Z"/>
    <path class="folder-line" d="M2.65 5.5V4.32c0-.4.33-.72.74-.72h1.88c.23 0 .45.1.6.28L7.05 5.5h5.5c.48 0 .87.39.87.87v6.05c0 .55-.44 1-.98 1H3.56c-.54 0-.98-.45-.98-1V5.5h10.84"/>
  </svg>`);
}

function fileIcon() {
  return svgNode(`<svg class="tree-type-icon is-file" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path class="file-line" d="M4.4 2.75h4.05L11.65 6v6.3c0 .5-.4.9-.9.9H4.4c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z"/>
    <path class="file-line" d="M8.4 2.85v3.05h3.05"/>
    <path class="file-line" d="M5.5 9.2h5M5.5 11.15h3.45"/>
  </svg>`);
}

const FOLDER_BUTTON_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path class="folder-line" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" d="M2.65 5.5V4.32c0-.4.33-.72.74-.72h1.88c.23 0 .45.1.6.28L7.05 5.5h5.5c.48 0 .87.39.87.87v6.05c0 .55-.44 1-.98 1H3.56c-.54 0-.98-.45-.98-1V5.5h10.84"/></svg>';

function splitFileName(name) {
  const match = String(name || '').match(/^(.*?)(\.[^.]+)?$/);
  return { stem: match?.[1] || name, ext: match?.[2] || '' };
}

function createDraftRow(depth) {
  const draft = state.treeDraft;
  const row = document.createElement('div');
  row.className = 'tree-row tree-draft-row';
  row.style.setProperty('--tree-depth', depth);
  row.append(document.createElement('span'), draft.mode === 'create-folder' ? folderIcon() : fileIcon());

  const input = document.createElement('input');
  input.className = 'tree-draft-input';
  input.type = 'text';
  input.value = draft.value;
  input.setAttribute('aria-label', draft.mode === 'rename' ? '重命名' : '新名称');
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTreeDraft(input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelTreeDraft();
    }
  });
  input.addEventListener('blur', () => {
    if (state.treeDraft) commitTreeDraft(input.value);
  });
  row.append(input);
  requestAnimationFrame(() => {
    input.focus();
    const dot = input.value.lastIndexOf('.');
    if (draft.mode !== 'create-folder' && dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  });
  return row;
}

function createTreeNode(node, depth = 0) {
  const item = document.createElement('div');
  item.className = `tree-item tree-${node.type}`;

  const renaming = state.treeDraft?.mode === 'rename' && state.treeDraft.targetPath === node.path;
  if (renaming) {
    item.appendChild(createDraftRow(depth));
    return item;
  }

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row';
  row.style.setProperty('--tree-depth', depth);
  row.dataset.path = node.path;
  row.dataset.kind = node.type;
  row.title = node.path;

  const chevron = document.createElement('span');
  chevron.className = 'tree-chevron';
  const name = document.createElement('span');
  name.className = 'tree-label';

  if (node.type === 'directory') {
    const expanded = state.expandedPaths.has(node.path);
    chevron.append(chevronIcon(expanded));
    row.setAttribute('aria-expanded', String(expanded));
    name.textContent = node.name;
    row.addEventListener('click', () => {
      if (expanded) state.expandedPaths.delete(node.path);
      else state.expandedPaths.add(node.path);
      persistSession();
      renderFileTree();
    });
    row.append(chevron, folderIcon(expanded), name);
  } else {
    const { stem, ext } = splitFileName(node.name);
    const stemEl = document.createElement('span');
    stemEl.className = 'tree-stem';
    stemEl.textContent = stem;
    const extEl = document.createElement('span');
    extEl.className = 'tree-ext';
    extEl.textContent = ext;
    name.append(stemEl, extEl);
    row.addEventListener('click', () => openTreeFile(node.path));
    row.append(chevron, fileIcon(), name);
  }

  item.appendChild(row);

  if (node.type === 'directory' && state.expandedPaths.has(node.path)) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    node.children.forEach((child) => children.appendChild(createTreeNode(child, depth + 1)));
    if (state.treeDraft && state.treeDraft.mode !== 'rename' && state.treeDraft.parentPath === node.path) {
      children.prepend(createDraftRow(depth + 1));
    }
    item.appendChild(children);
  }
  return item;
}

function renderFileTree() {
  elements.fileTree.replaceChildren();
  if (!state.workspaceRoot) {
    elements.fileTree.appendChild(elements.treeEmpty);
    return;
  }

  if (!state.workspaceTree.length && !(state.treeDraft && state.treeDraft.mode !== 'rename' && state.treeDraft.parentPath === state.workspaceRoot)) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<p>还没有文档</p><span>在空白处右键，即可新建页面或文件夹。</span>';
    elements.fileTree.appendChild(empty);
    return;
  }

  if (state.treeDraft && state.treeDraft.mode !== 'rename' && state.treeDraft.parentPath === state.workspaceRoot) {
    elements.fileTree.appendChild(createDraftRow(0));
  }
  state.workspaceTree.forEach((node) => elements.fileTree.appendChild(createTreeNode(node)));
  updateActiveTreeItem();
}

function updateActiveTreeItem() {
  document.querySelectorAll('.tree-row').forEach((row) => {
    const active = row.dataset.path === state.filePath;
    row.classList.toggle('is-active', active);
    row.classList.toggle('is-dirty', active && state.dirty);
  });
  document.querySelectorAll('.history-row').forEach((row) => {
    const fileActive = row.dataset.kind === 'file' && samePath(row.dataset.path, state.filePath);
    const folderActive = row.dataset.kind === 'folder' && samePath(row.dataset.path, state.workspaceRoot);
    row.classList.toggle('is-active', Boolean(fileActive || folderActive));
  });
}

function nestHeadingItems(items) {
  const root = [];
  const stack = [];
  items.forEach((item, index) => {
    const node = { ...item, index, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root.push(node);
    stack.push(node);
  });
  return root;
}

function outlineKey(node) {
  return `${node.level}:${node.occurrence}:${node.text}`;
}

function visibleHeadingText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.vditor-ir__marker').forEach((node) => node.remove());
  return cleanHeadingText((clone.textContent || '').replace(/[\u200b\u00a0]/g, ''));
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const LAYER_EXIT_MS = 140;
const layerHideTimers = new WeakMap();

function revealLayer(el) {
  if (!el) return;
  const pending = layerHideTimers.get(el);
  if (pending) {
    window.clearTimeout(pending);
    layerHideTimers.delete(el);
  }
  el.classList.remove('hidden', 'is-leaving');
}

function concealLayer(el, options = {}) {
  if (!el || el.classList.contains('hidden')) return;
  const pending = layerHideTimers.get(el);
  if (pending) window.clearTimeout(pending);
  if (prefersReducedMotion() || options.instant) {
    el.classList.add('hidden');
    el.classList.remove('is-leaving');
    return;
  }
  el.classList.add('is-leaving');
  const timer = window.setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('is-leaving');
    layerHideTimers.delete(el);
  }, LAYER_EXIT_MS);
  layerHideTimers.set(el, timer);
}

function jumpToSourceLine(line) {
  const textarea = elements.sourceEditor;
  const text = textarea.value || '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  for (let index = 0; index < line && index < lines.length; index += 1) {
    start += lines[index].length + 1;
  }
  const end = start + (lines[line]?.length || 0);
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  textarea.scrollTop = Math.max(0, line * lineHeight - 72);
}

let outlineFlashTimer = 0;
let outlineFlashEl = null;

function headingFlashAlignment(element) {
  const attr = String(element.getAttribute('align') || '').toLowerCase();
  const css = String(window.getComputedStyle(element).textAlign || '').toLowerCase();
  if (attr === 'center' || attr === 'middle' || css === 'center' || css === 'middle' || css.includes('center')) {
    return 'center';
  }
  if (attr === 'right' || css === 'right' || css === 'end') return 'end';
  return '';
}

function clearOutlineFlash() {
  window.clearTimeout(outlineFlashTimer);
  outlineFlashEl?.classList.remove('outline-flash', 'outline-flash-center', 'outline-flash-end');
  outlineFlashEl = null;
}

function jumpToOutlineItem(item) {
  if (state.sourceMode) {
    jumpToSourceLine(item.line);
    return;
  }

  const nodes = [...document.querySelectorAll('#editor .vditor-reset :is(h1, h2, h3, h4, h5, h6)')];
  const match = nodes.filter((node) => visibleHeadingText(node) === item.text)[item.occurrence] || nodes[item.index];
  if (!match) return;
  match.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  clearOutlineFlash();
  outlineFlashEl = match;
  match.classList.add('outline-flash');
  const align = headingFlashAlignment(match);
  if (align === 'center') match.classList.add('outline-flash-center');
  if (align === 'end') match.classList.add('outline-flash-end');
  outlineFlashTimer = window.setTimeout(() => {
    if (outlineFlashEl === match) clearOutlineFlash();
  }, 5000);
}

function createHeadingNode(node, depth = 0) {
  const item = document.createElement('div');
  item.className = 'heading-item';
  item.style.setProperty('--tree-depth', depth);

  const hasChildren = node.children.length > 0;
  const key = outlineKey(node);
  const expanded = !hasChildren || !state.outlineCollapsed.has(key);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'heading-row';
  row.dataset.level = String(node.level);
  row.dataset.index = String(node.index);
  row.dataset.line = String(node.line);
  row.title = node.text;
  row.setAttribute('aria-label', `${node.text}，${node.level} 级标题`);

  const chevron = document.createElement('span');
  chevron.className = `tree-chevron${hasChildren ? '' : ' is-leaf'}`;
  if (hasChildren) {
    chevron.append(chevronIcon(expanded));
    row.setAttribute('aria-expanded', String(expanded));
  }

  const label = document.createElement('span');
  label.className = 'heading-label';
  label.textContent = node.text;

  row.append(chevron, label);
  row.addEventListener('click', (event) => {
    if (hasChildren && (event.target.closest('.tree-chevron') || event.offsetX < 22)) {
      if (state.outlineCollapsed.has(key)) state.outlineCollapsed.delete(key);
      else state.outlineCollapsed.add(key);
      renderHeadingTree();
      return;
    }
    jumpToOutlineItem(node);
    elements.headingTree.querySelectorAll('.heading-row').forEach((el) => {
      const on = el === row;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
    lastOutlineActive = node.index;
  });
  item.appendChild(row);

  if (hasChildren && expanded) {
    const children = document.createElement('div');
    children.className = 'heading-children';
    node.children.forEach((child) => children.appendChild(createHeadingNode(child, depth + 1)));
    item.appendChild(children);
  }
  return item;
}

function syncOutlineHeader(count) {
  if (elements.outlineDocName) elements.outlineDocName.textContent = baseName(state.filePath);
  if (!elements.outlineCount) return;
  if (count > 0) {
    elements.outlineCount.textContent = `${count} 个标题`;
    elements.outlineCount.classList.remove('is-empty');
  } else {
    elements.outlineCount.textContent = '';
    elements.outlineCount.classList.add('is-empty');
  }
}

function currentOutlineIndex() {
  const rows = [...(elements.headingTree?.querySelectorAll('.heading-row') || [])];
  if (!rows.length) return 0;

  if (state.sourceMode) {
    const textarea = elements.sourceEditor;
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
    const padding = Number.parseFloat(styles.paddingTop) || 0;
    const line = Math.max(0, Math.floor((textarea.scrollTop + 28 - padding) / lineHeight));
    let best = Number(rows[0].dataset.index) || 0;
    rows.forEach((row) => {
      if (Number(row.dataset.line) <= line) best = Number(row.dataset.index);
    });
    return best;
  }

  const ir = getIrElement();
  if (!ir) return Number(rows[0].dataset.index) || 0;
  const viewTop = ir.getBoundingClientRect().top + 36;
  const nodes = [...ir.querySelectorAll(':is(h1, h2, h3, h4, h5, h6)')];
  let best = Number(rows[0].dataset.index) || 0;
  rows.forEach((row) => {
    const index = Number(row.dataset.index);
    const node = nodes[index];
    if (node && node.getBoundingClientRect().top <= viewTop) best = index;
  });
  return best;
}

let lastOutlineActive = -1;
let outlineActiveFrame = 0;

function updateActiveOutline({ follow = false } = {}) {
  if (state.sidebarTab !== 'outline' || !elements.headingTree) return;
  const rows = [...elements.headingTree.querySelectorAll('.heading-row')];
  if (!rows.length) {
    lastOutlineActive = -1;
    return;
  }

  const activeIndex = currentOutlineIndex();
  let current = rows[0];
  rows.forEach((row) => {
    if (Number(row.dataset.index) <= activeIndex) current = row;
  });

  rows.forEach((row) => {
    const on = row === current;
    row.classList.toggle('is-active', on);
    if (on) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  });

  const changed = Number(current.dataset.index) !== lastOutlineActive;
  lastOutlineActive = Number(current.dataset.index);
  if (follow && changed && !elements.headingTree.matches(':hover')) {
    current.scrollIntoView({ block: 'nearest' });
  }
}

function scheduleOutlineActive() {
  if (outlineActiveFrame) return;
  outlineActiveFrame = window.requestAnimationFrame(() => {
    outlineActiveFrame = 0;
    updateActiveOutline({ follow: true });
  });
}

function renderHeadingTree() {
  if (!elements.headingTree) return;
  const scrollTop = elements.headingTree.scrollTop;
  const items = parseHeadingOutline(getMarkdown());
  const known = new Set(items.map((item) => outlineKey(item)));
  [...state.outlineCollapsed].forEach((key) => {
    if (!known.has(key)) state.outlineCollapsed.delete(key);
  });

  syncOutlineHeader(items.length);
  elements.headingTree.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = state.filePath
      ? '<p>这篇还没有标题</p><span>写一个 # 加空格，结构就会出现在这里。</span>'
      : '<p>还没有标题</p><span>打开一篇文档，或写一个 # 加空格。</span>';
    elements.headingTree.appendChild(empty);
    lastOutlineActive = -1;
    return;
  }

  nestHeadingItems(items).forEach((node) => elements.headingTree.appendChild(createHeadingNode(node)));
  elements.headingTree.scrollTop = scrollTop;
  updateActiveOutline({ follow: false });
}

let outlineTimer = 0;

function scheduleOutlineRefresh() {
  window.clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(renderHeadingTree, 140);
}

function normalizeSidebarTab(tab) {
  if (tab === 'outline' || tab === 'search') return tab;
  return 'files';
}

function setSidebarTab(tab, options = {}) {
  state.sidebarTab = normalizeSidebarTab(tab);
  localStorage.setItem(SIDEBAR_TAB_KEY, state.sidebarTab);
  const files = state.sidebarTab === 'files';
  const outline = state.sidebarTab === 'outline';
  const search = state.sidebarTab === 'search';
  elements.filesPanel.classList.toggle('hidden', !files);
  elements.outlinePanel.classList.toggle('hidden', !outline);
  elements.searchPanel?.classList.toggle('hidden', !search);
  elements.tabFiles.classList.toggle('is-active', files);
  elements.tabOutline.classList.toggle('is-active', outline);
  elements.tabSearch?.classList.toggle('is-active', search);
  elements.tabFiles.setAttribute('aria-selected', String(files));
  elements.tabOutline.setAttribute('aria-selected', String(outline));
  elements.tabSearch?.setAttribute('aria-selected', String(search));
  if (outline) renderHeadingTree();
  if (search) {
    runWorkspaceSearch().catch(() => {});
    if (options.focus !== false) {
      elements.workspaceSearchInput?.focus();
      elements.workspaceSearchInput?.select();
    }
  }
}

function openWorkspaceSearch() {
  const hidden = document.body.classList.contains('sidebar-hidden');
  if (hidden || window.matchMedia('(max-width: 820px)').matches) toggleSidebar(true);
  setSidebarTab('search');
}

function highlightQuery(text, query) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) return document.createTextNode(source);
  const index = source.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return document.createTextNode(source);
  const frag = document.createDocumentFragment();
  if (index > 0) frag.append(source.slice(0, index));
  const mark = document.createElement('mark');
  mark.textContent = source.slice(index, index + needle.length);
  frag.append(mark, source.slice(index + needle.length));
  return frag;
}

function renderWorkspaceSearchEmpty(message, detail) {
  const empty = document.createElement('div');
  empty.className = 'tree-empty';
  empty.innerHTML = `<p>${escapeHtml(message)}</p><span>${escapeHtml(detail || '')}</span>`;
  elements.workspaceSearchResults.replaceChildren(empty);
}

function appendSearchGroup(title) {
  const heading = document.createElement('div');
  heading.className = 'search-group-title';
  heading.textContent = title;
  elements.workspaceSearchResults.append(heading);
}

function appendNameHit(item, query) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `search-hit${item.type === 'file' && samePath(item.path, state.filePath) ? ' is-current' : ''}`;
  const top = document.createElement('div');
  top.className = 'search-hit-top';
  top.append(item.type === 'directory' ? folderIcon() : fileIcon());
  const name = document.createElement('span');
  name.className = 'search-hit-name';
  name.append(highlightQuery(item.name, query));
  top.append(name);
  const pathLabel = document.createElement('span');
  pathLabel.className = 'search-hit-path';
  pathLabel.textContent = item.relative || item.path;
  button.append(top, pathLabel);
  button.addEventListener('click', () => openWorkspaceSearchHit(item));
  elements.workspaceSearchResults.append(button);
}

function appendContentHit(item, query) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'search-hit search-hit-match';
  const line = document.createElement('div');
  line.className = 'search-hit-line';
  line.append(highlightQuery(item.text, query));
  const pathLabel = document.createElement('span');
  pathLabel.className = 'search-hit-path';
  pathLabel.textContent = `${item.name}  ·  第 ${item.line + 1} 行`;
  button.append(line, pathLabel);
  button.addEventListener('click', () => openWorkspaceSearchHit({
    type: 'file',
    path: item.path,
    line: item.line,
    column: item.column,
    query
  }));
  elements.workspaceSearchResults.append(button);
}

let workspaceSearchTimer = 0;
let workspaceSearchToken = 0;

function scheduleWorkspaceSearch() {
  window.clearTimeout(workspaceSearchTimer);
  workspaceSearchTimer = window.setTimeout(() => {
    runWorkspaceSearch().catch((error) => console.warn('搜索工作区失败：', error));
  }, 160);
}

async function runWorkspaceSearch() {
  const list = elements.workspaceSearchResults;
  if (!list) return;
  const query = (elements.workspaceSearchInput?.value || '').trim();
  if (!state.workspaceRoot) {
    renderWorkspaceSearchEmpty('先打开一个文件夹', '搜索会遍历这个文件夹里的文档和子目录。');
    return;
  }
  if (!query) {
    elements.workspaceReplaceBar?.classList.add('hidden');
    renderWorkspaceSearchEmpty('搜索工作区', '按文件名、文件夹名或正文内容查找。');
    return;
  }

  const token = (workspaceSearchToken += 1);
  list.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'tree-empty';
  loading.innerHTML = '<p>正在搜索</p><span>正在遍历文件夹里的文档。</span>';
  list.append(loading);

  const result = await window.markl.searchWorkspace({
    rootPath: state.workspaceRoot,
    query,
    caseSensitive: findState.caseSensitive,
    wholeWord: findState.wholeWord,
    regex: findState.regex
  });
  if (token !== workspaceSearchToken) return;

  const names = result?.names || [];
  const contents = result?.contents || [];
  list.replaceChildren();
  elements.workspaceReplaceBar?.classList.toggle('hidden', !contents.length);
  if (result?.error) {
    renderWorkspaceSearchEmpty('正则无效', '检查一下表达式后再搜。');
    return;
  }
  if (!names.length && !contents.length) {
    renderWorkspaceSearchEmpty('没有匹配', '换个文件名或正文里的词再试。');
    return;
  }
  if (names.length) {
    appendSearchGroup('文件与文件夹');
    names.forEach((item) => appendNameHit(item, query));
  }
  if (contents.length) {
    appendSearchGroup('正文');
    contents.forEach((item) => appendContentHit(item, query));
  }
}

function jumpToDocumentLine(line, query) {
  jumpToSearchMatch(line, 0, query);
}

function jumpToSearchMatch(line, column, query) {
  const markdown = getMarkdown();
  const lines = markdown.split('\n');
  let start = 0;
  for (let index = 0; index < line && index < lines.length; index += 1) {
    start += lines[index].length + 1;
  }
  const lineText = lines[line] || '';
  const needle = String(query || '');
  let offset = Number.isFinite(column) ? column : -1;
  if (offset < 0 || (needle && lineText.toLowerCase().slice(offset, offset + needle.length) !== needle.toLowerCase())) {
    offset = needle ? lineText.toLowerCase().indexOf(needle.toLowerCase()) : 0;
  }
  if (offset < 0) offset = 0;
  const matchStart = start + offset;
  const matchEnd = matchStart + Math.max(needle.length, 1);

  if (state.sourceMode) {
    selectSourceRange(matchStart, matchEnd);
    return;
  }

  const matches = needle ? collectMatches(markdown, needle) : [];
  const chosen = matches.find((item) => item.start === matchStart)
    || matches.find((item) => item.start >= start && item.start < start + lineText.length);
  if (chosen) {
    findState.query = needle;
    findState.matches = matches;
    findState.index = matches.indexOf(chosen);
    selectIrMatch(chosen, markdown);
    return;
  }

  const hint = visibleLineHint(lineText) || needle;
  const root = getIrElement();
  if (!root || !hint) {
    jumpToSourceLine(line);
    return;
  }
  const nodes = [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote')];
  const block = nodes.find((node) => (node.textContent || '').includes(hint));
  block?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

async function revealTreePath(targetPath) {
  setSidebarTab('files', { focus: false });
  expandAncestors(targetPath, state.workspaceRoot);
  state.expandedPaths.add(targetPath);
  persistSession();
  renderFileTree();
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll('.tree-row')].find((item) => samePath(item.dataset.path, targetPath));
    row?.scrollIntoView({ block: 'center' });
  });
}

async function openWorkspaceSearchHit(item) {
  if (item.type === 'directory') {
    await revealTreePath(item.path);
    return;
  }
  let loaded = false;
  if (!samePath(item.path, state.filePath)) {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      const result = await window.markl.readFile({ filePath: item.path });
      loadContent(result.filePath, result.content);
      loaded = true;
    } catch (error) {
      showOperationError('打开文件', error);
      return;
    }
  }
  if (typeof item.line !== 'number') return;
  const go = () => jumpToSearchMatch(item.line, item.column, item.query);
  if (loaded) window.setTimeout(go, 80);
  else go();
}

function applyWorkspace(payload, options = {}) {
  if (!payload) return;
  const previousExpanded = state.expandedPaths;
  state.workspaceRoot = payload.rootPath;
  state.workspaceName = payload.rootName;
  state.workspaceTree = payload.tree || [];
  if (options.keepExpanded) {
    state.expandedPaths = previousExpanded;
  } else if (Array.isArray(options.expandedPaths) && options.expandedPaths.length) {
    state.expandedPaths = new Set(options.expandedPaths);
  } else {
    state.expandedPaths = new Set(
      state.workspaceTree.filter((node) => node.type === 'directory').map((node) => node.path)
    );
  }
  elements.workspaceName.textContent = state.workspaceName;
  elements.workspacePath.textContent = state.workspaceName;
  elements.workspacePath.title = state.workspaceRoot;
  elements.workspaceHeading.classList.remove('hidden');
  elements.refreshTreeButton.classList.remove('hidden');
  elements.newTreeButton.classList.remove('hidden');
  syncWorkspaceChrome();
  renderFileTree();
  renderPinnedList();
  persistSession();
  syncWatch();
}

async function doOpenFolder() {
  try {
    const payload = await window.markl.openFolderDialog();
    if (payload) {
      applyWorkspace(payload);
      rememberOpen('folder', payload.rootPath);
    }
  } catch (error) {
    showOperationError('打开文件夹', error);
  } finally {
    restoreEditorFocus();
  }
}

async function refreshWorkspace() {
  if (!state.workspaceRoot) return;
  try {
    const payload = await window.markl.refreshWorkspace(state.workspaceRoot);
    if (payload) applyWorkspace(payload, { keepExpanded: true });
  } catch (error) {
    showOperationError('刷新目录', error);
  }
}

function syncModeButton() {
  if (!elements.modeLabel) return;
  elements.modeLabel.classList.toggle('is-source', state.sourceMode);
  const title = state.sourceMode
    ? 'Markdown 源码，点击切回即时渲染'
    : '即时渲染，点击查看 Markdown 源码';
  elements.modeLabel.title = title;
  elements.modeLabel.setAttribute('aria-label', title);
}

const formatMenuUi = { open: false };
let savedFormatSelection = null;

const INLINE_FORMAT = {
  bold: { selector: '[data-type="strong"]', wrap: (text) => `**${text}**` },
  italic: { selector: '[data-type="em"]', wrap: (text) => `*${text}*` },
  strike: { selector: '[data-type="s"], [data-type="strike"]', wrap: (text) => `~~${text}~~` },
  code: { selector: '[data-type="code"]', wrap: (text) => `\`${text}\`` },
  link: {
    selector: '[data-type="a"]',
    wrap: (text) => {
      const value = String(text || '').trim() || '链接';
      return /^https?:\/\//i.test(value) ? `[链接](${value})` : `[${value}](https://)`;
    }
  }
};

function closeFormatMenu() {
  if (!formatMenuUi.open || !elements.formatMenu) return;
  formatMenuUi.open = false;
  concealLayer(elements.formatMenu);
}

function snapshotFormatSelection() {
  if (state.sourceMode) {
    savedFormatSelection = {
      mode: 'source',
      start: elements.sourceEditor.selectionStart,
      end: elements.sourceEditor.selectionEnd
    };
    return;
  }
  const selection = window.getSelection();
  savedFormatSelection = selection?.rangeCount
    ? { mode: 'ir', range: selection.getRangeAt(0).cloneRange() }
    : null;
}

function restoreSavedFormatSelection() {
  if (!savedFormatSelection) return;
  if (savedFormatSelection.mode === 'source') {
    elements.sourceEditor.focus();
    elements.sourceEditor.setSelectionRange(savedFormatSelection.start, savedFormatSelection.end);
    return;
  }
  if (!savedFormatSelection.range) return;
  getIrElement()?.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  try {
    selection.addRange(savedFormatSelection.range);
  } catch {
    // 选区已经失效就算了。
  }
}

function getEditorSelectionText() {
  if (state.sourceMode) {
    const { selectionStart, selectionEnd, value } = elements.sourceEditor;
    return selectionStart === selectionEnd ? '' : value.slice(selectionStart, selectionEnd);
  }
  return (vditor?.getSelection?.() || window.getSelection()?.toString() || '').replace(/\u200b/g, '');
}

function selectCurrentParagraph() {
  if (state.sourceMode) {
    const textarea = elements.sourceEditor;
    const value = textarea.value;
    const pos = textarea.selectionStart;
    const start = value.lastIndexOf('\n', pos - 1) + 1;
    let end = value.indexOf('\n', pos);
    if (end < 0) end = value.length;
    if (end === start) return false;
    textarea.setSelectionRange(start, end);
    snapshotFormatSelection();
    return true;
  }
  const ir = getIrElement();
  const host = selectionHost();
  const block = host?.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote');
  if (!ir || !block || !ir.contains(block)) return false;
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  snapshotFormatSelection();
  return Boolean(selection.toString().trim());
}

function ensureFormatSelection() {
  if (getEditorSelectionText().trim()) return true;
  return selectCurrentParagraph();
}

function replaceEditorSelection(next) {
  if (state.sourceMode) {
    const textarea = elements.sourceEditor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (!document.execCommand('insertText', false, next)) {
      applyMarkdownEdit(replaceRange(textarea.value, start, end, next));
      textarea.setSelectionRange(start, start + next.length);
    }
    recomputeDirty();
    return;
  }
  if (vditor?.updateValue) vditor.updateValue(next);
  else if (vditor?.insertValue) vditor.insertValue(next);
  recomputeDirty();
  scheduleCodeHighlight();
  scheduleOutlineRefresh();
}

function visibleFormatText(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('.vditor-ir__marker').forEach((marker) => marker.remove());
  return (clone.textContent || '').replace(/[\u200b\u00a0]/g, '');
}

function unwrapIrFormatNode(node) {
  const text = visibleFormatText(node);
  node.classList.add('vditor-ir__node--expand');
  node.classList.remove('vditor-ir__node--hidden');
  const range = document.createRange();
  range.selectNode(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  replaceEditorSelection(text);
}

function unwrapMarkdownInline(text, kind) {
  const source = String(text || '');
  if (kind === 'bold') {
    const match = source.match(/^\*\*([\s\S]*)\*\*$/) || source.match(/^__([\s\S]*)__$/);
    return match ? match[1] : null;
  }
  if (kind === 'italic') {
    if (/^\*\*[\s\S]*\*\*$/.test(source) || /^__[\s\S]*__$/.test(source)) return null;
    const match = source.match(/^\*([\s\S]*)\*$/) || source.match(/^_([\s\S]*)_$/);
    return match ? match[1] : null;
  }
  if (kind === 'strike') {
    const match = source.match(/^~~([\s\S]*)~~$/);
    return match ? match[1] : null;
  }
  if (kind === 'code') {
    const match = source.match(/^`([\s\S]*)`$/);
    return match ? match[1] : null;
  }
  if (kind === 'link') {
    const match = source.match(/^\[([^\]]*)\]\([^)]*\)$/);
    return match ? match[1] : null;
  }
  return null;
}

function closestInlineFormat(kind) {
  const spec = INLINE_FORMAT[kind];
  if (!spec) return null;
  const host = selectionHost() || document.activeElement;
  const node = host?.closest?.(spec.selector);
  const ir = getIrElement();
  return node && ir?.contains(node) ? node : null;
}

function applyInlineToggle(kind) {
  restoreSavedFormatSelection();
  const spec = INLINE_FORMAT[kind];
  if (!spec) return;

  if (!state.sourceMode) {
    const node = closestInlineFormat(kind);
    if (node) {
      unwrapIrFormatNode(node);
      return;
    }
  }

  if (!getEditorSelectionText().trim() && !ensureFormatSelection()) return;
  const selected = getEditorSelectionText();
  const unwrapped = unwrapMarkdownInline(selected, kind);
  if (unwrapped !== null) {
    replaceEditorSelection(unwrapped);
    return;
  }
  replaceEditorSelection(spec.wrap(selected));
}

function stripBlockPrefix(line) {
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^\d+\.\s+/, '');
}

function applyLinePrefix(prefix) {
  restoreSavedFormatSelection();
  if (!ensureFormatSelection()) return;
  const selected = getEditorSelectionText();
  const lines = selected.split('\n');
  const already = Boolean(prefix) && lines.length > 0 && lines.every((line) => line.startsWith(prefix));
  const next = lines.map((line) => {
    const body = stripBlockPrefix(line);
    return already || !prefix ? body : `${prefix}${body}`;
  }).join('\n');
  replaceEditorSelection(next);
}

function applyClearFormat() {
  restoreSavedFormatSelection();
  if (!state.sourceMode) {
    const host = selectionHost() || document.activeElement;
    const node = host?.closest?.('[data-type="strong"], [data-type="em"], [data-type="s"], [data-type="code"], [data-type="a"]');
    if (node && getIrElement()?.contains(node)) {
      unwrapIrFormatNode(node);
      return;
    }
  }
  if (!ensureFormatSelection()) return;
  const cleaned = getEditorSelectionText()
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  replaceEditorSelection(cleaned);
}

function refreshFormatMenuState() {
  if (!elements.formatMenu) return;
  const host = selectionHost();
  const map = {
    bold: Boolean(host?.closest('[data-type="strong"], strong, b')),
    italic: Boolean(host?.closest('[data-type="em"], em, i')),
    strike: Boolean(host?.closest('[data-type="s"], s, del')),
    code: Boolean(host?.closest('[data-type="code"], code')),
    link: Boolean(host?.closest('[data-type="a"], a')),
    h1: Boolean(host?.closest('h1')),
    h2: Boolean(host?.closest('h2')),
    h3: Boolean(host?.closest('h3')),
    quote: Boolean(host?.closest('blockquote')),
    ul: Boolean(host?.closest('ul > li')),
    ol: Boolean(host?.closest('ol > li')),
    task: Boolean(host?.closest('[data-type="task-list-item"], .vditor-task'))
  };
  elements.formatMenu.querySelectorAll('[data-format]').forEach((button) => {
    button.classList.toggle('is-active', Boolean(map[button.dataset.format]));
  });
}

function positionFormatMenu(clientX, clientY) {
  const menu = elements.formatMenu;
  const wrap = elements.editorWrap;
  if (!menu || !wrap) return;
  revealLayer(menu);
  const wrapRect = wrap.getBoundingClientRect();
  const width = menu.offsetWidth || 280;
  const height = menu.offsetHeight || 72;
  let left = clientX - wrapRect.left;
  let top = clientY - wrapRect.top + 8;
  left = Math.max(8, Math.min(left, wrapRect.width - width - 8));
  if (top + height > wrapRect.height - 8) top = Math.max(8, clientY - wrapRect.top - height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openFormatMenu(event) {
  if (!elements.formatMenu) return;
  if (event.target.closest('#find-bar, #update-panel, #quick-open, #app-dialog, .language-popup, .table-toolbar, .table-menu')) return;
  const inEditor = event.target.closest('#editor, #source-editor');
  if (!inEditor) return;
  event.preventDefault();
  snapshotFormatSelection();
  const insideInline = Boolean(event.target.closest('[data-type="strong"], [data-type="em"], [data-type="s"], [data-type="code"], [data-type="a"]'));
  if (!getEditorSelectionText().trim() && !insideInline) selectCurrentParagraph();
  formatMenuUi.open = true;
  refreshFormatMenuState();
  positionFormatMenu(event.clientX, event.clientY);
}

function handleFormatAction(action) {
  restoreSavedFormatSelection();
  if (action === 'cut') {
    document.execCommand('cut');
  } else if (action === 'copy') {
    document.execCommand('copy');
  } else if (action === 'paste') {
    document.execCommand('paste');
  } else if (action === 'bold' || action === 'italic' || action === 'strike' || action === 'code' || action === 'link') {
    applyInlineToggle(action);
  } else if (action === 'h1') {
    applyLinePrefix('# ');
  } else if (action === 'h2') {
    applyLinePrefix('## ');
  } else if (action === 'h3') {
    applyLinePrefix('### ');
  } else if (action === 'quote') {
    applyLinePrefix('> ');
  } else if (action === 'ul') {
    applyLinePrefix('- ');
  } else if (action === 'ol') {
    applyLinePrefix('1. ');
  } else if (action === 'task') {
    applyLinePrefix('- [ ] ');
  } else if (action === 'clear') {
    applyClearFormat();
  }
  closeFormatMenu();
}

function toggleMode() {
  if (state.sourceMode) {
    const value = elements.sourceEditor.value || '';
    state.sourceMode = false;
    elements.sourceEditor.classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    if (vditor) vditor.setValue(value, true);
    syncModeButton();
    focusEditor();
  } else {
    const value = getMarkdown();
    state.sourceMode = true;
    elements.sourceEditor.value = value;
    document.getElementById('editor').classList.add('hidden');
    elements.sourceEditor.classList.remove('hidden');
    syncModeButton();
    elements.sourceEditor.focus();
    hideTableToolbar();
  }
  recomputeDirty();
  scheduleImageResolve();
  refreshFindMatches({ stay: true });
}

function startTreeDraft({ mode, parentPath, targetPath, value }) {
  if (!state.workspaceRoot && mode !== 'rename') {
    if (mode === 'create-folder') return doOpenFolder();
    return doNew();
  }
  if (parentPath) state.expandedPaths.add(parentPath);
  state.treeDraft = { mode, parentPath, targetPath: targetPath || null, value };
  renderFileTree();
}

function cancelTreeDraft() {
  state.treeDraft = null;
  renderFileTree();
}

async function commitTreeDraft(rawValue) {
  const draft = state.treeDraft;
  if (!draft) return;
  const value = String(rawValue || '').trim();
  state.treeDraft = null;
  if (!value) {
    renderFileTree();
    return;
  }

  try {
    if (draft.mode === 'create-file') {
      const result = await window.markl.createFile({
        dirPath: draft.parentPath || state.workspaceRoot,
        name: value,
        content: ''
      });
      await refreshWorkspace();
      loadContent(result.filePath, result.content);
    } else if (draft.mode === 'create-folder') {
      const folderPath = await window.markl.createFolder({
        dirPath: draft.parentPath || state.workspaceRoot,
        name: value
      });
      state.expandedPaths.add(folderPath);
      await refreshWorkspace();
    } else if (draft.mode === 'rename' && draft.targetPath) {
      const nextPath = await window.markl.renamePath({ oldPath: draft.targetPath, name: value });
      if (state.filePath === draft.targetPath) state.filePath = nextPath;
      rewriteHistoryPath(draft.targetPath, nextPath);
      await refreshWorkspace();
      updateTitle();
    }
  } catch (error) {
    renderFileTree();
    showOperationError(draft.mode === 'rename' ? '重命名' : '新建', error);
  }
}

function targetDirectoryFromContext(kind, targetPath) {
  if (kind === 'directory') return targetPath;
  if (kind === 'file') return parentDirectory(targetPath);
  return state.workspaceRoot;
}

async function handleTreeAction(action, kind, targetPath) {
  if (!action) return;
  if (action === 'open' && targetPath) return openTreeFile(targetPath);
  if (action === 'open-folder') return doOpenFolder();
  if (action === 'reveal' && targetPath) {
    try {
      await window.markl.revealInFolder(targetPath);
    } catch (error) {
      showOperationError('打开资源管理器', error);
    }
    return;
  }
  if (action === 'new-file') {
    startTreeDraft({
      mode: 'create-file',
      parentPath: targetDirectoryFromContext(kind, targetPath),
      value: '未命名.md'
    });
    return;
  }
  if (action === 'new-folder') {
    if (!state.workspaceRoot) return doOpenFolder();
    startTreeDraft({
      mode: 'create-folder',
      parentPath: targetDirectoryFromContext(kind, targetPath),
      value: '新建文件夹'
    });
    return;
  }
  if (action === 'rename' && targetPath) {
    startTreeDraft({
      mode: 'rename',
      parentPath: parentDirectory(targetPath),
      targetPath,
      value: baseName(targetPath)
    });
    return;
  }
  if ((action === 'pin' || action === 'unpin') && targetPath) {
    togglePin(targetPath);
    return;
  }
  if (action === 'delete' && targetPath) {
    const name = baseName(targetPath);
    const message = kind === 'directory'
      ? `确定删除文件夹“${name}”及其全部内容？此操作无法撤销。`
      : `确定删除“${name}”？此操作无法撤销。`;
    if (!(await showAppDialog({
      title: '删除',
      message,
      ok: '删除',
      cancel: '取消',
      danger: true
    }))) return;
    try {
      await window.markl.deletePath({ targetPath });
      if (state.filePath && isPathInside(state.filePath, targetPath)) {
        state.filePath = null;
        setMarkdown('', true);
        markClean('');
        updateCounts();
        renderHeadingTree();
        persistSession();
      }
      forgetOpenTree(targetPath);
      await refreshWorkspace();
    } catch (error) {
      showOperationError('删除', error);
    }
  }
}

async function onTreeContextMenu(event) {
  event.preventDefault();
  const row = event.target.closest('.tree-row');
  if (row?.classList.contains('tree-draft-row')) return;
  const kind = row?.dataset.kind || 'blank';
  const targetPath = row?.dataset.path || state.workspaceRoot;
  if ((kind === 'file' || kind === 'directory') && !targetPath) return;

  const action = await window.markl.showTreeMenu({
    kind: state.workspaceRoot ? kind : 'blank',
    targetPath,
    pinned: kind === 'file' && isPinned(targetPath)
  });
  return handleTreeAction(action, kind, targetPath);
}

function startRootDocument() {
  if (!state.workspaceRoot) return doNew();
  startTreeDraft({
    mode: 'create-file',
    parentPath: state.workspaceRoot,
    value: '未命名.md'
  });
}

function normalizeAppearance(value = {}) {
  const theme = THEME_IDS.includes(value.theme) ? value.theme : 'light';
  const font = FONT_STACKS[value.font] ? value.font : 'default';
  const fontSize = FONT_SIZES[value.fontSize] ? value.fontSize : 'medium';
  return { theme, font, fontSize };
}

function readStoredAppearance() {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) return normalizeAppearance(JSON.parse(raw));
  } catch {
    // 旧版本只存了主题名。
  }
  return normalizeAppearance({ theme: localStorage.getItem('markl-theme') || 'light' });
}

function applyVditorTheme(theme) {
  if (!vditor) return;
  const dark = DARK_THEMES.has(theme);
  vditor.setTheme(
    dark ? 'dark' : 'classic',
    dark ? 'dark' : 'light',
    dark ? 'github-dark-dimmed' : 'github',
    CONTENT_THEME_PATH
  );
}

function applyAppearance(appearance) {
  const next = normalizeAppearance(appearance);
  state.appearance = next;
  document.body.classList.remove('theme-light', 'theme-mist', 'theme-sepia', 'theme-dark', 'theme-ink', 'theme-dusk');
  document.body.classList.add(`theme-${next.theme}`);
  document.body.classList.toggle('is-dark-theme', DARK_THEMES.has(next.theme));
  document.body.dataset.font = next.font;
  document.body.dataset.fontSize = next.fontSize;
  document.documentElement.style.setProperty('--font-content', FONT_STACKS[next.font]);
  document.documentElement.style.setProperty('--content-size', FONT_SIZES[next.fontSize]);
  applyVditorTheme(next.theme);
  scheduleCodeHighlight();
  scheduleTableBalance();
  syncAppMenuChecks();
}

function persistAppearance() {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(state.appearance));
  localStorage.setItem('markl-theme', state.appearance.theme);
  window.markl.setAppearance?.(state.appearance);
}

function setAppearance(patch) {
  applyAppearance({ ...state.appearance, ...patch });
  persistAppearance();
}

function setTheme(theme) {
  setAppearance({ theme });
}

function toggleSidebar(force) {
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  if (narrow) {
    const open = typeof force === 'boolean' ? force : !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open);
  } else {
    const hidden = typeof force === 'boolean' ? !force : !document.body.classList.contains('sidebar-hidden');
    document.body.classList.toggle('sidebar-hidden', hidden);
  }
  persistSession();
  scheduleTableBalance();
}

function filteredLanguages(query) {
  const needle = String(query || '').toLowerCase();
  return LANGUAGES.filter((language) => {
    const haystack = [language.id, language.label, language.description, ...language.aliases].join(' ').toLowerCase();
    return !needle || haystack.includes(needle);
  }).sort((a, b) => {
    const aExact = [a.id, ...a.aliases].includes(needle) ? -1 : 0;
    const bExact = [b.id, ...b.aliases].includes(needle) ? -1 : 0;
    return aExact - bExact;
  }).slice(0, 8);
}

function getTypedFenceLine() {
  const selection = window.getSelection();
  if (!selection?.anchorNode) return null;
  const node = selection.anchorNode;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element || element.closest('[data-type="code-block"], [data-type="code-block-info"]')) return null;
  const block = element.closest('p, h1, h2, h3, h4, h5, h6, .vditor-ir__node');
  if (!block) return null;
  const text = (block.textContent || '').replace(/[\u200b\u00a0]/g, '').trim();
  const match = text.match(/^```([A-Za-z0-9_+#.-]*)$/);
  if (!match) return null;
  return { query: match[1] };
}

function positionLanguagePopup() {
  const wrapRect = elements.editorWrap.getBoundingClientRect();
  let top = 96;
  let left = 48;
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      left = rect.left - wrapRect.left;
      top = rect.bottom - wrapRect.top + 8;
    }
  }
  const popupWidth = elements.languagePopup.offsetWidth || 280;
  const popupHeight = elements.languagePopup.offsetHeight || 260;
  left = Math.min(Math.max(12, left), Math.max(12, wrapRect.width - popupWidth - 12));
  top = Math.min(Math.max(12, top), Math.max(12, wrapRect.height - popupHeight - 12));
  elements.languagePopup.style.left = `${left}px`;
  elements.languagePopup.style.top = `${top}px`;
}

function renderLanguagePopup() {
  const popup = state.popup;
  elements.languageList.replaceChildren();
  if (!popup.items.length) {
    const empty = document.createElement('div');
    empty.className = 'language-empty';
    empty.textContent = '没有匹配的语言';
    elements.languageList.appendChild(empty);
    return;
  }

  popup.items.forEach((language, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `language-option${index === popup.selected ? ' is-selected' : ''}`;
    option.setAttribute('role', 'option');
    const main = document.createElement('span');
    main.className = 'language-option-main';
    const name = document.createElement('strong');
    name.textContent = language.label;
    const code = document.createElement('code');
    code.textContent = language.aliases[0] || language.id;
    main.append(name, code);
    const description = document.createElement('span');
    description.className = 'language-description';
    description.textContent = language.description;
    option.append(main, description);
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectLanguage(index);
    });
    elements.languageList.appendChild(option);
  });
}

function openLanguagePopup(query = '') {
  state.popup.visible = true;
  state.popup.query = query;
  state.popup.items = filteredLanguages(query);
  state.popup.selected = 0;
  revealLayer(elements.languagePopup);
  elements.languageQueryInput.value = query;
  renderLanguagePopup();
  requestAnimationFrame(() => {
    positionLanguagePopup();
    elements.languageQueryInput.focus();
    elements.languageQueryInput.select();
  });
}

function closeLanguagePopup(options = {}) {
  const input = elements.languageQueryInput;
  const restore = options.restoreFocus ?? (document.activeElement === input);
  state.popup.visible = false;
  if (document.activeElement === input) input.blur();
  concealLayer(elements.languagePopup);
  if (restore) restoreEditorFocus();
}

let highlightingPreviews = false;
let highlightTimer = 0;

function previewLanguage(block, code) {
  const info = block?.querySelector('[data-type="code-block-info"]');
  const classLang = (code.className.match(/language-([\w#+-]+)/i) || [])[1];
  return canonicalLanguage(
    (info?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim()
    || block?.dataset.lang
    || classLang
    || ''
  );
}

function hasHighlightSpans(code) {
  return Boolean(code.querySelector('span[class*="hljs-"]'));
}

const HIGHLIGHT_EXTRAS = {
  java: {
    type: new Set([
      'String', 'StringBuilder', 'StringBuffer', 'CharSequence', 'Appendable',
      'Integer', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Character',
      'Object', 'Class', 'Void', 'Number', 'Enum', 'Record', 'System', 'Math',
      'Thread', 'Runnable', 'Throwable', 'Exception', 'RuntimeException', 'Error',
      'Iterable', 'Iterator', 'Comparable', 'Cloneable', 'AutoCloseable',
      'Collection', 'List', 'Set', 'Map', 'Queue', 'Deque', 'Optional',
      'ArrayList', 'LinkedList', 'HashMap', 'HashSet', 'TreeMap', 'TreeSet',
      'Arrays', 'Collections', 'Objects', 'Stream', 'Collectors',
      'LocalDate', 'LocalTime', 'LocalDateTime', 'Instant', 'Duration', 'Period',
      'Path', 'Paths', 'Files', 'File', 'Scanner', 'UUID', 'URL', 'URI',
      'BigDecimal', 'BigInteger', 'Date', 'Calendar', 'Locale', 'Pattern', 'Matcher',
      'Consumer', 'Function', 'Predicate', 'Supplier', 'Comparator',
      'Override', 'Deprecated', 'SuppressWarnings', 'SafeVarargs', 'FunctionalInterface',
      'int', 'boolean', 'byte', 'char', 'double', 'float', 'long', 'short', 'void'
    ]),
    pascalType: true
  },
  csharp: {
    type: new Set([
      'string', 'int', 'bool', 'byte', 'char', 'decimal', 'double', 'float', 'long',
      'object', 'short', 'uint', 'ulong', 'ushort', 'void', 'var', 'dynamic',
      'String', 'Object', 'Console', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack',
      'IEnumerable', 'IList', 'IDictionary', 'ICollection', 'IReadOnlyList',
      'StringBuilder', 'Task', 'ValueTask', 'Action', 'Func', 'Predicate',
      'DateTime', 'TimeSpan', 'Guid', 'Exception', 'ArgumentException',
      'InvalidOperationException', 'HttpClient', 'File', 'Path', 'Directory',
      'Math', 'Convert', 'Environment', 'Array', 'Type', 'Nullable', 'Span',
      'Memory', 'ReadOnlySpan', 'CancellationToken', 'Encoding'
    ]),
    pascalType: true
  },
  cpp: {
    built_in: new Set([
      'std', 'cout', 'cin', 'cerr', 'clog', 'endl', 'string', 'wstring', 'string_view',
      'vector', 'map', 'set', 'unordered_map', 'unordered_set', 'optional', 'variant',
      'unique_ptr', 'shared_ptr', 'weak_ptr', 'make_unique', 'make_shared',
      'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
      'int8_t', 'int16_t', 'int32_t', 'int64_t'
    ])
  },
  python: {
    type: new Set([
      'Path', 'PurePath', 'Enum', 'IntEnum', 'TypedDict', 'Protocol',
      'Final', 'ClassVar', 'Annotated', 'Self', 'LiteralString'
    ])
  },
  css: {
    caseInsensitive: true,
    literal: new Set([
      'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'none',
      'absolute', 'relative', 'fixed', 'sticky', 'static', 'hidden', 'visible',
      'auto', 'inherit', 'initial', 'unset', 'revert', 'center', 'wrap', 'nowrap',
      'row', 'column', 'solid', 'dashed', 'dotted', 'transparent', 'pointer',
      'default', 'bold', 'italic', 'space-between', 'space-around', 'space-evenly',
      'stretch', 'baseline', 'hidden', 'scroll'
    ])
  }
};

function isPascalTypeName(name) {
  return /^[A-Z][a-z][\w$]*$/.test(name) || /^[A-Z][A-Za-z0-9]*[a-z][\w$]*$/.test(name);
}

function extraClassForToken(name, extra) {
  const key = extra.caseInsensitive ? name.toLowerCase() : name;
  if (extra.type?.has(name) || extra.type?.has(key)) return 'hljs-type';
  if (extra.built_in?.has(name) || extra.built_in?.has(key)) return 'hljs-built_in';
  if (extra.literal?.has(name) || extra.literal?.has(key)) return 'hljs-literal';
  if (extra.keyword?.has(name) || extra.keyword?.has(key)) return 'hljs-keyword';
  if (extra.pascalType && isPascalTypeName(name)) return 'hljs-type';
  return '';
}

function decorateHighlightExtras(html, language) {
  const extra = HIGHLIGHT_EXTRAS[language];
  if (!extra) return html;
  const skip = [];
  return html.replace(/<[^>]+>|[^<]+/g, (token) => {
    if (token.startsWith('<')) {
      if (/^<span\b/i.test(token)) {
        const cls = (token.match(/class="([^"]*)"/) || [])[1] || '';
        skip.push(/\bhljs-(comment|string|regexp|doctag)\b/.test(cls));
      } else if (/^<\/span/i.test(token)) {
        skip.pop();
      }
      return token;
    }
    if (skip.some(Boolean)) return token;
    return token.replace(/\b[A-Za-z_][\w$-]*\b/g, (name) => {
      const cls = extraClassForToken(name, extra);
      return cls ? `<span class="${cls}">${name}</span>` : name;
    });
  });
}

function highlightSource(source, language) {
  const lang = language === 'jsp' ? 'java' : language;
  let html = window.hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
  return decorateHighlightExtras(html, lang);
}

function highlightCodePreviews() {
  if (!window.hljs || isEditorComposing()) return;
  highlightingPreviews = true;
  const selHost = selectionHost();
  try {
    document.querySelectorAll('[data-type="code-block"] .vditor-ir__preview code').forEach((code) => {
      const block = code.closest('[data-type="code-block"]');
      if (block?.classList.contains('vditor-ir__node--expand')) return;
      if (selHost && block?.contains(selHost)) return;
      const language = previewLanguage(block, code);
      if (!language || language === 'text' || !window.hljs.getLanguage(language)) return;
      const source = code.textContent.replace(/\u200b/g, '');
      const key = `${language}\0${source}`;
      if (code.dataset.marklHl === key && hasHighlightSpans(code)) return;
      code.className = `language-${language} hljs`;
      code.innerHTML = highlightSource(source, language);
      code.dataset.marklHl = key;
      if (block) block.dataset.lang = language;
    });
  } finally {
    highlightingPreviews = false;
  }
}

function scheduleCodeHighlight() {
  if (isEditorComposing()) return;
  updateLiveHighlight();
  highlightCodePreviews();
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    if (isEditorComposing()) return;
    highlightCodePreviews();
    updateLiveHighlight();
  }, 90);
}

function liveHighlightLayer() {
  let layer = elements.editorWrap.querySelector('.markl-live-hl');
  if (!layer) {
    layer = document.createElement('pre');
    layer.className = 'markl-live-hl';
    layer.setAttribute('aria-hidden', 'true');
    elements.editorWrap.appendChild(layer);
  }
  return layer;
}

function firstVisibleCharRect(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\u200b' || ch === '\ufeff' || ch === '\n' || ch === '\r') continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return rect;
    }
  }
  return null;
}

function activeCodeBlock() {
  return document.querySelector('[data-type="code-block"].vditor-ir__node--expand');
}

function setCodeIme(active) {
  const block = activeCodeBlock();
  const on = Boolean(active && block);
  document.body.classList.toggle('is-ime-code', on);
  document.querySelectorAll('[data-type="code-block"].is-ime').forEach((node) => {
    if (node !== block) node.classList.remove('is-ime');
  });
  if (block) block.classList.toggle('is-ime', on);
  const layer = elements.editorWrap?.querySelector('.markl-live-hl');
  if (on && layer) layer.classList.add('hidden');
}

function paintLiveHighlight() {
  const block = activeCodeBlock();
  const pre = block?.querySelector('.vditor-ir__marker--pre');
  const code = pre?.querySelector('code');
  const layer = liveHighlightLayer();
  if (!block || !pre || !code || isEditorComposing()) {
    layer.classList.add('hidden');
    if (!block || !pre || !code) layer.dataset.marklSrc = '';
    return;
  }

  const info = block.querySelector('[data-type="code-block-info"]');
  const language = canonicalLanguage((info?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim() || block.dataset.lang || '');
  const source = code.textContent || '';
  const key = `${language}\0${source}`;
  if (layer.dataset.marklSrc !== key) {
    if (window.hljs && language && language !== 'text' && window.hljs.getLanguage(language)) {
      layer.innerHTML = highlightSource(source, language);
    } else {
      layer.textContent = source;
    }
    layer.dataset.marklSrc = key;
  }

  const wrapRect = elements.editorWrap.getBoundingClientRect();
  const codeRect = code.getBoundingClientRect();
  const cs = getComputedStyle(code);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const borderL = parseFloat(cs.borderLeftWidth) || 0;
  const borderT = parseFloat(cs.borderTopWidth) || 0;
  const borderR = parseFloat(cs.borderRightWidth) || 0;
  const borderB = parseFloat(cs.borderBottomWidth) || 0;

  layer.style.fontFamily = cs.fontFamily;
  layer.style.fontSize = cs.fontSize;
  layer.style.fontWeight = cs.fontWeight;
  layer.style.fontStyle = cs.fontStyle;
  layer.style.lineHeight = cs.lineHeight;
  layer.style.letterSpacing = cs.letterSpacing;
  layer.style.wordSpacing = cs.wordSpacing;
  layer.style.tabSize = cs.tabSize;
  layer.style.whiteSpace = cs.whiteSpace;
  layer.style.wordBreak = cs.wordBreak;
  layer.style.overflowWrap = cs.overflowWrap;
  layer.style.fontVariantLigatures = 'none';
  layer.style.fontFeatureSettings = '"calt" 0, "liga" 0, "dlig" 0';

  const contentWidth = Math.max(0, codeRect.width - padL - padR - borderL - borderR);
  const contentHeight = Math.max(0, codeRect.height - padT - padB - borderT - borderB);
  layer.style.left = `${codeRect.left - wrapRect.left + padL + borderL}px`;
  layer.style.top = `${codeRect.top - wrapRect.top + padT + borderT}px`;
  layer.style.width = `${contentWidth}px`;
  layer.style.minHeight = `${contentHeight}px`;
  layer.classList.remove('hidden');

  const codeGlyph = firstVisibleCharRect(code);
  const layerGlyph = firstVisibleCharRect(layer);
  if (codeGlyph && layerGlyph) {
    const dx = codeGlyph.left - layerGlyph.left;
    const dy = codeGlyph.top - layerGlyph.top;
    if (dx) layer.style.left = `${parseFloat(layer.style.left) + dx}px`;
    if (dy) layer.style.top = `${parseFloat(layer.style.top) + dy}px`;
  }
}

let liveHlRaf = 0;

function updateLiveHighlight() {
  paintLiveHighlight();
  if (liveHlRaf) cancelAnimationFrame(liveHlRaf);
  liveHlRaf = requestAnimationFrame(() => {
    liveHlRaf = 0;
    paintLiveHighlight();
  });
}

const tableMeasureCanvas = document.createElement('canvas');
const tableMeasureCtx = tableMeasureCanvas.getContext('2d');
let tableBalanceTimer = 0;
let balancingTables = false;

function tableCellText(cell) {
  let text = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList.contains('vditor-ir__marker')) return;
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(cell);
  return text.replace(/[\u200b\u00a0]/g, '');
}

function tableAvailableWidth(table) {
  const paper = table.closest('.vditor-reset') || table.parentElement;
  if (!paper) return 0;
  const style = getComputedStyle(paper);
  return Math.max(0, paper.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
}

function preferredColumnWidths(table) {
  const rows = [...table.rows];
  const colCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const widths = Array(colCount).fill(0);
  rows.forEach((row) => {
    [...row.cells].forEach((cell, index) => {
      const style = getComputedStyle(cell);
      tableMeasureCtx.font = style.font;
      let textWidth = 0;
      tableCellText(cell).split('\n').forEach((line) => {
        textWidth = Math.max(textWidth, tableMeasureCtx.measureText(line).width);
      });
      cell.querySelectorAll('img').forEach((img) => {
        textWidth = Math.max(textWidth, img.naturalWidth || img.width || 0);
      });
      const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      widths[index] = Math.max(widths[index], textWidth + chrome);
    });
  });
  return widths;
}

function fitColumnWidths(preferred, available) {
  const count = preferred.length;
  if (!count || available <= 0) return preferred.slice();
  const minWidth = Math.max(48, Math.min(80, Math.floor(available / Math.max(count * 2, 1))));
  const floors = preferred.map((width) => Math.max(width, minWidth));
  let next = floors.slice();
  const sum = next.reduce((total, width) => total + width, 0);

  if (sum > available) {
    const minSum = minWidth * count;
    if (minSum >= available) {
      next = next.map(() => available / count);
    } else {
      let low = minWidth;
      let high = Math.max(...next, available);
      for (let step = 0; step < 20; step += 1) {
        const mid = (low + high) / 2;
        const total = next.reduce((acc, width) => acc + Math.min(width, mid), 0);
        if (total > available) high = mid;
        else low = mid;
      }
      next = next.map((width) => Math.min(width, low));
    }
  }

  const used = next.reduce((total, width) => total + width, 0);
  if (used <= 0) return next.map(() => available / count);
  return next.map((width) => (width / used) * available);
}

function applyTableColumnWidths(table, widths, available) {
  const total = widths.reduce((acc, width) => acc + width, 0) || 1;
  const signature = `${widths.map((width) => Math.round(width)).join(',')}@${Math.round(available)}`;
  if (table.dataset.marklCols === signature && table.style.width === '100%') return;
  table.dataset.marklCols = signature;
  table.dataset.marklBalanced = '1';
  table.style.width = '100%';
  table.style.minWidth = '100%';
  table.style.maxWidth = '100%';
  const first = table.rows[0];
  if (!first) return;
  [...first.cells].forEach((cell, index) => {
    const width = widths[index];
    if (width == null) return;
    cell.style.width = `${(width / total) * 100}%`;
  });
}

function balanceEditorTables() {
  if (state.sourceMode || balancingTables || isEditorComposing()) return;
  balancingTables = true;
  try {
    document.querySelectorAll('#editor .vditor-reset table').forEach((table) => {
      if (table.querySelector('[colspan], [rowspan]')) return;
      if (!table.rows.length) return;
      const available = tableAvailableWidth(table);
      if (available <= 0) return;
      applyTableColumnWidths(table, fitColumnWidths(preferredColumnWidths(table), available), available);
    });
    if (tableUi.table?.isConnected) positionTableToolbar(tableUi.table);
  } finally {
    balancingTables = false;
  }
}

function scheduleTableBalance() {
  window.clearTimeout(tableBalanceTimer);
  tableBalanceTimer = window.setTimeout(balanceEditorTables, 40);
}

function decorateCodeBlocks() {
  scheduleCodeHighlight();
  scheduleTableBalance();
}

const TABLE_PICKER_MIN = 10;
const TABLE_PICKER_MAX = 20;
const tableUi = { table: null, cell: null, menu: '', hoverCols: 0, hoverRows: 0 };
let tableToolbarTimer = 0;

function emptyTableCell(tag, align) {
  const safeAlign = align || 'left';
  return `<${tag} align="${safeAlign}">\u200b</${tag}>`;
}

function getSelectionTableCell() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let node = selection.anchorNode;
  if (!node) return null;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const cell = node?.closest?.('td, th');
  if (!cell || !document.getElementById('editor')?.contains(cell)) return null;
  return cell;
}

function cellColumnIndex(cell) {
  return [...cell.parentElement.cells].indexOf(cell);
}

function columnAlign(cell) {
  const table = cell.closest('table');
  const col = cellColumnIndex(cell);
  const source = table?.rows[0]?.cells[col] || cell;
  return (source.getAttribute('align') || (source.tagName === 'TH' ? 'center' : 'left')).toLowerCase();
}

function closeTableMenus() {
  tableUi.menu = '';
  tableUi.hoverCols = 0;
  tableUi.hoverRows = 0;
  concealLayer(elements.tableInsertMenu, { instant: true });
  concealLayer(elements.tableMoreMenu, { instant: true });
  elements.tableInsertButton.setAttribute('aria-expanded', 'false');
  elements.tableMoreButton.setAttribute('aria-expanded', 'false');
}

function hideTableToolbar() {
  closeTableMenus();
  tableUi.table = null;
  tableUi.cell = null;
  concealLayer(elements.tableToolbar, { instant: true });
}

function positionTableToolbar(table) {
  const wrap = elements.editorWrap;
  const wrapRect = wrap.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  if (tableRect.bottom < wrapRect.top + 8 || tableRect.top > wrapRect.bottom - 8) {
    concealLayer(elements.tableToolbar, { instant: true });
    return;
  }
  const barHeight = elements.tableToolbar.offsetHeight || 32;
  const top = Math.max(8, tableRect.top - wrapRect.top - barHeight - 4);
  const left = Math.max(8, tableRect.left - wrapRect.left);
  const maxWidth = wrapRect.width - left - 8;
  elements.tableToolbar.style.top = `${top}px`;
  elements.tableToolbar.style.left = `${left}px`;
  elements.tableToolbar.style.width = `${Math.min(Math.max(tableRect.width, 228), maxWidth)}px`;
  revealLayer(elements.tableToolbar);
}

function refreshTableToolbarState() {
  const cell = tableUi.cell;
  if (!cell) return;
  const align = columnAlign(cell);
  elements.tableToolbar.querySelectorAll('[data-table-action^="align-"]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tableAction === `align-${align}`);
  });
}

function showTableToolbar(cell) {
  const table = cell.closest('table');
  if (!table) return hideTableToolbar();
  tableUi.table = table;
  tableUi.cell = cell;
  positionTableToolbar(table);
  refreshTableToolbarState();
}

function scheduleTableToolbar() {
  window.clearTimeout(tableToolbarTimer);
  tableToolbarTimer = window.setTimeout(() => {
    if (state.sourceMode) return hideTableToolbar();
    if (elements.tableToolbar.contains(document.activeElement)) return;
    const cell = getSelectionTableCell();
    if (cell) showTableToolbar(cell);
    else if (!tableUi.menu) hideTableToolbar();
  }, 30);
}

function notifyTableEdit() {
  const core = vditor?.vditor;
  if (core) {
    const text = vditor.getValue();
    core.options?.input?.(text);
    core.undo?.addToUndoStack?.(core);
  } else {
    recomputeDirty();
  }
  scheduleTableBalance();
}

function focusTableCell(cell) {
  if (!cell) return;
  vditor?.vditor?.ir?.element?.focus?.({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  tableUi.cell = cell;
  tableUi.table = cell.closest('table');
}

function currentTableContext() {
  const cell = tableUi.cell?.isConnected ? tableUi.cell : getSelectionTableCell();
  const table = cell?.closest('table') || (tableUi.table?.isConnected ? tableUi.table : null);
  if (!cell || !table) return null;
  return { cell, table, col: cellColumnIndex(cell), row: cell.parentElement };
}

function currentTableSize() {
  const ctx = currentTableContext();
  return {
    cols: Math.max(1, ctx?.table.rows[0]?.cells.length || 1),
    rows: Math.max(1, ctx?.table.rows.length || 1)
  };
}

function highlightTableSizePicker(cols, rows) {
  elements.tableSizeGrid.querySelectorAll('.table-size-cell').forEach((cell) => {
    const col = Number(cell.dataset.col);
    const row = Number(cell.dataset.row);
    cell.classList.toggle('is-active', col <= cols && row <= rows);
  });
  elements.tableSizeText.textContent = `${cols} x ${rows}`;
}

function tablePickerViewSize() {
  const size = currentTableSize();
  return {
    cols: Math.min(TABLE_PICKER_MAX, Math.max(TABLE_PICKER_MIN, size.cols)),
    rows: Math.min(TABLE_PICKER_MAX, Math.max(TABLE_PICKER_MIN, size.rows))
  };
}

function renderTableSizePicker() {
  const view = tablePickerViewSize();
  const grid = elements.tableSizeGrid;
  if (grid.dataset.cols !== String(view.cols) || grid.dataset.rows !== String(view.rows)) {
    grid.dataset.cols = String(view.cols);
    grid.dataset.rows = String(view.rows);
    grid.style.gridTemplateColumns = `repeat(${view.cols}, 14px)`;
    const fragment = document.createDocumentFragment();
    for (let row = 1; row <= view.rows; row += 1) {
      for (let col = 1; col <= view.cols; col += 1) {
        const cell = document.createElement('div');
        cell.className = 'table-size-cell';
        cell.dataset.col = String(col);
        cell.dataset.row = String(row);
        cell.setAttribute('role', 'gridcell');
        fragment.appendChild(cell);
      }
    }
    grid.replaceChildren(fragment);
  }
  const size = currentTableSize();
  highlightTableSizePicker(tableUi.hoverCols || size.cols, tableUi.hoverRows || size.rows);
}

function resizeTable(targetCols, targetRows) {
  const ctx = currentTableContext();
  if (!ctx) return;
  const table = ctx.table;
  const cols = Math.max(1, Math.min(TABLE_PICKER_MAX, targetCols));
  const rows = Math.max(1, Math.min(TABLE_PICKER_MAX, targetRows));
  const currentCols = table.rows[0]?.cells.length || 0;
  const currentRows = table.rows.length;
  const originRow = ctx.row.rowIndex;
  const originCol = ctx.col;
  if (!currentCols) return;
  if (cols === currentCols && rows === currentRows) {
    closeTableMenus();
    return;
  }

  if (cols > currentCols) {
    [...table.rows].forEach((row, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      const align = row.cells[currentCols - 1]?.getAttribute('align') || (tag === 'th' ? 'center' : 'left');
      let html = '';
      for (let index = currentCols; index < cols; index += 1) html += emptyTableCell(tag, align);
      row.insertAdjacentHTML('beforeend', html);
    });
  } else if (cols < currentCols) {
    [...table.rows].forEach((row) => {
      while (row.cells.length > cols) row.lastElementChild.remove();
    });
  }

  if (rows > currentRows) {
    const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    const sample = table.rows[currentRows - 1];
    const aligns = [...table.rows[0].cells].map((_, index) => (
      sample?.cells[index]?.getAttribute('align') || 'left'
    ));
    let html = '';
    for (let index = currentRows; index < rows; index += 1) {
      html += `<tr>${aligns.map((align) => emptyTableCell('td', align)).join('')}</tr>`;
    }
    tbody.insertAdjacentHTML('beforeend', html);
  } else if (rows < currentRows) {
    for (let index = currentRows - 1; index >= rows; index -= 1) {
      const row = table.rows[index];
      const parent = row.parentElement;
      row.remove();
      if (parent.tagName === 'TBODY' && !parent.rows.length) parent.remove();
    }
  }

  const focusRow = Math.min(Math.max(originRow, 0), table.rows.length - 1);
  const focusCol = Math.min(Math.max(originCol, 0), table.rows[focusRow].cells.length - 1);
  focusTableCell(table.rows[focusRow].cells[focusCol]);
  notifyTableEdit();
  showTableToolbar(tableUi.cell);
  closeTableMenus();
}

function setTableColumnAlign(type) {
  const ctx = currentTableContext();
  if (!ctx) return;
  [...ctx.table.rows].forEach((row) => {
    const target = row.cells[ctx.col];
    if (target) target.setAttribute('align', type);
  });
  focusTableCell(ctx.table.rows[ctx.row.rowIndex]?.cells[ctx.col] || ctx.cell);
  refreshTableToolbarState();
  notifyTableEdit();
}

function insertTableRow(where) {
  const ctx = currentTableContext();
  if (!ctx) return;
  const html = [...ctx.row.cells].map((cell) => emptyTableCell('td', cell.getAttribute('align') || 'left')).join('');
  if (where === 'above' && ctx.cell.tagName === 'TH') {
    const aligns = [...ctx.row.cells].map((cell) => cell.getAttribute('align') || 'center');
    const oldHeader = ctx.row.innerHTML.replace(/<th/gi, '<td').replace(/<\/th>/gi, '</td>');
    ctx.row.innerHTML = aligns.map((align) => emptyTableCell('th', align)).join('');
    const tbody = ctx.table.tBodies[0] || ctx.table.appendChild(document.createElement('tbody'));
    tbody.insertAdjacentHTML('afterbegin', `<tr>${oldHeader}</tr>`);
    focusTableCell(ctx.table.rows[0].cells[ctx.col]);
  } else if (where === 'above') {
    ctx.row.insertAdjacentHTML('beforebegin', `<tr>${html}</tr>`);
    focusTableCell(ctx.row.previousElementSibling.cells[ctx.col]);
  } else if (ctx.cell.tagName === 'TH') {
    const tbody = ctx.table.tBodies[0] || ctx.table.appendChild(document.createElement('tbody'));
    tbody.insertAdjacentHTML('afterbegin', `<tr>${html}</tr>`);
    focusTableCell(tbody.rows[0].cells[ctx.col]);
  } else {
    ctx.row.insertAdjacentHTML('afterend', `<tr>${html}</tr>`);
    focusTableCell(ctx.row.nextElementSibling.cells[ctx.col]);
  }
  notifyTableEdit();
  showTableToolbar(tableUi.cell);
}

function insertTableColumn(where) {
  const ctx = currentTableContext();
  if (!ctx) return;
  const index = where === 'left' ? ctx.col : ctx.col + 1;
  [...ctx.table.rows].forEach((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td';
    const align = row.cells[ctx.col]?.getAttribute('align') || (tag === 'th' ? 'center' : 'left');
    const html = emptyTableCell(tag, align);
    if (index >= row.cells.length) row.insertAdjacentHTML('beforeend', html);
    else row.cells[index].insertAdjacentHTML('beforebegin', html);
  });
  const nextIndex = where === 'left' ? ctx.col : ctx.col + 1;
  focusTableCell(ctx.table.rows[ctx.row.rowIndex].cells[nextIndex]);
  notifyTableEdit();
  showTableToolbar(tableUi.cell);
}

function deleteTableRow() {
  const ctx = currentTableContext();
  if (!ctx) return;
  if (ctx.table.rows.length <= 1) {
    deleteWholeTable();
    return;
  }
  if (ctx.cell.tagName === 'TH') {
    const bodyRow = ctx.table.tBodies[0]?.rows[0];
    if (!bodyRow) {
      deleteWholeTable();
      return;
    }
    ctx.row.innerHTML = [...bodyRow.cells].map((cell) => {
      const align = cell.getAttribute('align') || 'center';
      return `<th align="${align}">${cell.innerHTML}</th>`;
    }).join('');
    bodyRow.remove();
    if (ctx.table.tBodies[0] && !ctx.table.tBodies[0].rows.length) ctx.table.tBodies[0].remove();
    focusTableCell(ctx.table.rows[0].cells[Math.min(ctx.col, ctx.table.rows[0].cells.length - 1)]);
  } else {
    const fallback = ctx.row.previousElementSibling || ctx.row.nextElementSibling || ctx.table.rows[0];
    const parent = ctx.row.parentElement;
    ctx.row.remove();
    if (parent.tagName === 'TBODY' && !parent.rows.length) parent.remove();
    focusTableCell(fallback.cells[Math.min(ctx.col, fallback.cells.length - 1)]);
  }
  notifyTableEdit();
  if (tableUi.cell) showTableToolbar(tableUi.cell);
}

function deleteTableColumn() {
  const ctx = currentTableContext();
  if (!ctx) return;
  if (ctx.table.rows[0].cells.length <= 1) {
    deleteWholeTable();
    return;
  }
  const nextIndex = Math.max(0, ctx.col - 1);
  [...ctx.table.rows].forEach((row) => row.cells[ctx.col]?.remove());
  const rowIndex = Math.min(ctx.row.rowIndex, ctx.table.rows.length - 1);
  focusTableCell(ctx.table.rows[rowIndex].cells[nextIndex]);
  notifyTableEdit();
  if (tableUi.cell) showTableToolbar(tableUi.cell);
}

function deleteWholeTable() {
  const ctx = currentTableContext();
  if (!ctx) return;
  ctx.table.insertAdjacentHTML('afterend', '<p data-block="0">\n</p>');
  const next = ctx.table.nextElementSibling;
  ctx.table.remove();
  hideTableToolbar();
  if (next) {
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  notifyTableEdit();
}

function toggleTableMenu(name) {
  const opening = tableUi.menu !== name;
  closeTableMenus();
  if (!opening) return;
  tableUi.menu = name;
  const menu = name === 'insert' ? elements.tableInsertMenu : elements.tableMoreMenu;
  const button = name === 'insert' ? elements.tableInsertButton : elements.tableMoreButton;
  if (name === 'insert') renderTableSizePicker();
  revealLayer(menu);
  button.setAttribute('aria-expanded', 'true');
}

function handleTableToolbarAction(action) {
  if (!action) return;
  if (action === 'toggle-insert') return toggleTableMenu('insert');
  if (action === 'toggle-more') return toggleTableMenu('more');
  closeTableMenus();
  if (action === 'align-left') return setTableColumnAlign('left');
  if (action === 'align-center') return setTableColumnAlign('center');
  if (action === 'align-right') return setTableColumnAlign('right');
  if (action === 'insert-row-above') return insertTableRow('above');
  if (action === 'insert-row-below') return insertTableRow('below');
  if (action === 'insert-col-left') return insertTableColumn('left');
  if (action === 'insert-col-right') return insertTableColumn('right');
  if (action === 'delete-row') return deleteTableRow();
  if (action === 'delete-column') return deleteTableColumn();
  if (action === 'delete-table') return deleteWholeTable();
}

function watchCodeHighlight() {
  const root = document.getElementById('editor');
  if (!root || root.dataset.marklWatch === '1') return;
  root.dataset.marklWatch = '1';
  const observer = new MutationObserver(() => {
    if (state.sourceMode || highlightingPreviews || isEditorComposing()) return;
    window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      highlightCodePreviews();
      updateLiveHighlight();
      balanceEditorTables();
    }, 90);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      scheduleTableBalance();
      updateLiveHighlight();
    }).observe(elements.editorWrap);
  }
}

function applyLanguageToActiveBlock(lang) {
  const name = lang || 'text';
  const info = document.querySelector('.vditor-ir__node--expand [data-type="code-block-info"]')
    || document.querySelector('[data-type="code-block-info"]');
  if (!info) return;
  info.textContent = `\u200b${name}`;
  const block = info.closest('[data-type="code-block"]');
  if (block) block.dataset.lang = name;
  block?.querySelectorAll('code').forEach((code) => {
    code.className = `language-${name}`;
  });
  const pre = info.nextElementSibling;
  const code = pre?.querySelector?.('code') || pre?.firstElementChild;
  if (!code) return;
  const ir = getIrElement();
  ir?.focus();
  const range = document.createRange();
  range.selectNodeContents(code);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectLanguage(index = state.popup.selected) {
  const language = state.popup.items[index];
  const query = elements.languageQueryInput.value.trim();
  const lang = language ? (language.id === 'text' ? 'text' : language.id) : canonicalLanguage(query) || 'text';
  closeLanguagePopup({ restoreFocus: false });
  if (!vditor || state.sourceMode) return;
  setTimeout(() => {
    applyLanguageToActiveBlock(lang);
    repairEditorCaret({ forceFocus: true, ignorePopup: true });
    updateLiveHighlight();
  }, 0);
}

function handlePopupKeydown(event) {
  if (!state.popup.visible) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const count = state.popup.items.length;
    if (count) state.popup.selected = (state.popup.selected + direction + count) % count;
    renderLanguagePopup();
    return true;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && (state.popup.items.length || elements.languageQueryInput.value.trim())) {
    event.preventDefault();
    selectLanguage();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLanguagePopup({ restoreFocus: true });
    return true;
  }
  return false;
}

function findCodeFence(markdown, language, oldCode) {
  const needle = String(oldCode || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lang = language || '';
  const pattern = new RegExp(`(\`\`\`${escapeRegExp(lang)}\\n)([\\s\\S]*?)(\\n\`\`\`)`, 'g');
  let match = pattern.exec(markdown);
  let fallback = null;
  while (match) {
    const body = match[2].replace(/\n+$/, '');
    if (body === needle) return { start: match.index, end: match.index + match[0].length, full: match[0] };
    if (!fallback) fallback = { start: match.index, end: match.index + match[0].length, full: match[0] };
    match = pattern.exec(markdown);
  }
  return fallback;
}

function getActiveCodeBlock() {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest('[data-type="code-block"]');
  if (!block) return null;
  const info = block.querySelector('[data-type="code-block-info"]');
  const lang = (info?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim();
  const codeNode = block.querySelector('.vditor-ir__marker--pre code, .vditor-ir__preview code');
  return {
    language: canonicalLanguage(lang),
    code: (codeNode?.textContent || '').replace(/\u200b/g, '')
  };
}

async function formatActiveCode() {
  if (state.sourceMode) {
    showOperationError('格式化', new Error('请在即时渲染模式的代码块中使用 Ctrl+Alt+L。'));
    return;
  }
  const active = getActiveCodeBlock();
  if (!active) {
    showOperationError('格式化', new Error('请把光标放在代码块里。'));
    return;
  }
  try {
    const formatted = await window.markl.formatCode(active);
    if (formatted === active.code) return;
    const markdown = getMarkdown();
    const fence = findCodeFence(markdown, active.language, active.code);
    if (!fence) {
      showOperationError('格式化', new Error('没有找到对应的代码块。'));
      return;
    }
    const lang = active.language || '';
    const next = `${markdown.slice(0, fence.start)}\`\`\`${lang}\n${formatted.replace(/\n+$/, '')}\n\`\`\`${markdown.slice(fence.end)}`;
    setMarkdown(next, false);
    recomputeDirty();
  } catch (error) {
    showOperationError('格式化', error);
  }
}

const findState = {
  open: false,
  replaceOpen: false,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  query: '',
  matches: [],
  error: '',
  index: 0
};

const imageUrlAliases = new Map();
let findRefreshTimer = 0;
let imageResolveTimer = 0;
let sessionTimer = 0;
let launchHandled = false;
const launchContextPromise = window.markl?.getLaunchContext?.() || Promise.resolve({ file: null });

function readSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    return {
      workspaceRoot: parsed.workspaceRoot || null,
      filePath: parsed.filePath || null,
      sidebarHidden: Boolean(parsed.sidebarHidden),
      sidebarWidth: Number(parsed.sidebarWidth) || 0,
      expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths : []
    };
  } catch {
    return { workspaceRoot: null, filePath: null, sidebarHidden: false, expandedPaths: [] };
  }
}

function persistSessionNow() {
  if (state.restoringSession) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    workspaceRoot: state.workspaceRoot,
    filePath: state.filePath,
    sidebarHidden: document.body.classList.contains('sidebar-hidden'),
    sidebarWidth: getSidebarWidth(),
    expandedPaths: [...state.expandedPaths],
    at: Date.now()
  }));
}

function persistSession() {
  if (state.restoringSession) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(persistSessionNow, 80);
}

function readJsonMap(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonMap(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function captureEditorView() {
  const ir = getIrElement();
  return {
    sourceMode: state.sourceMode,
    irScroll: ir?.scrollTop || 0,
    sourceScroll: elements.sourceEditor?.scrollTop || 0,
    sourceStart: elements.sourceEditor?.selectionStart || 0,
    sourceEnd: elements.sourceEditor?.selectionEnd || 0
  };
}

function restoreEditorView(view) {
  if (!view) return;
  window.requestAnimationFrame(() => {
    const ir = getIrElement();
    if (ir && Number.isFinite(view.irScroll)) ir.scrollTop = view.irScroll;
    if (elements.sourceEditor) {
      if (Number.isFinite(view.sourceScroll)) elements.sourceEditor.scrollTop = view.sourceScroll;
      if (state.sourceMode && Number.isFinite(view.sourceStart)) {
        elements.sourceEditor.setSelectionRange(view.sourceStart, view.sourceEnd ?? view.sourceStart);
      }
    }
  });
}

function readCaretMap() {
  const map = readJsonMap(CARET_KEY, {});
  return map && typeof map === 'object' ? map : {};
}

function rememberCaret(filePath) {
  if (!filePath) return;
  const map = readCaretMap();
  map[filePath] = { ...captureEditorView(), at: Date.now() };
  const keys = Object.keys(map).sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
  keys.slice(CARET_LIMIT).forEach((key) => {
    delete map[key];
  });
  writeJsonMap(CARET_KEY, map);
}

function restoreCaret(filePath) {
  if (!filePath) return;
  restoreEditorView(readCaretMap()[filePath]);
}

function readPins() {
  const pins = readJsonMap(PINS_KEY, []);
  return Array.isArray(pins) ? pins.filter(Boolean).slice(0, PIN_LIMIT) : [];
}

function writePins(pins) {
  writeJsonMap(PINS_KEY, pins.slice(0, PIN_LIMIT));
  renderPinnedList();
  updateActiveTreeItem();
}

function isPinned(filePath) {
  return readPins().some((item) => samePath(item, filePath));
}

function togglePin(filePath) {
  if (!filePath) return;
  const pins = readPins();
  if (pins.some((item) => samePath(item, filePath))) {
    writePins(pins.filter((item) => !samePath(item, filePath)));
    return;
  }
  writePins([filePath, ...pins.filter((item) => !samePath(item, filePath))].slice(0, PIN_LIMIT));
}

function readRecentFiles() {
  const items = readJsonMap(RECENT_KEY, []);
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function rememberRecentFile(filePath) {
  if (!filePath) return;
  const next = [filePath, ...readRecentFiles().filter((item) => !samePath(item, filePath))].slice(0, RECENT_LIMIT);
  writeJsonMap(RECENT_KEY, next);
}

function renderPinnedList() {
  if (!elements.pinnedList) return;
  const pins = readPins();
  elements.pinnedList.replaceChildren();
  if (!pins.length) {
    elements.pinnedList.classList.add('hidden');
    return;
  }
  elements.pinnedList.classList.remove('hidden');
  const label = document.createElement('div');
  label.className = 'pinned-label';
  label.textContent = '钉住';
  elements.pinnedList.appendChild(label);
  pins.forEach((filePath) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-row';
    row.dataset.path = filePath;
    row.title = filePath;
    if (samePath(filePath, state.filePath)) row.classList.add('is-active');
    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron is-leaf';
    const name = document.createElement('span');
    name.className = 'tree-label';
    name.textContent = baseName(filePath);
    row.append(chevron, fileIcon(), name);
    row.addEventListener('click', () => openTreeFile(filePath));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePin(filePath);
    });
    elements.pinnedList.appendChild(row);
  });
}

let draftTimer = 0;
let fileChangePromptOpen = false;

function persistDraftSoon() {
  if (state.restoringSession) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(persistDraftNow, 700);
}

function clearDraftSoon() {
  window.clearTimeout(draftTimer);
  window.markl.clearDraft?.().catch(() => {});
}

let autoSaveTimer = 0;
let lastRevisionAt = 0;

function scheduleAutoSave() {
  if (state.restoringSession || !state.filePath) return;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(runAutoSave, 1600);
}

async function runAutoSave() {
  if (!state.filePath || !state.dirty || state.fileMissing || state.restoringSession) return;
  const content = getMarkdown();
  if (content === state.savedContent) return;
  try {
    if (Date.now() - lastRevisionAt > 120000) {
      await snapshotCurrentRevision();
      lastRevisionAt = Date.now();
    }
    await window.markl.writeFile({ filePath: state.filePath, content });
    markClean(content);
    rememberDiskStamp(state.filePath);
    rememberCaret(state.filePath);
    clearDraftSoon();
    elements.saveStatus.textContent = '已自动保存';
    elements.saveStatus.classList.add('is-synced');
    elements.saveStatus.classList.remove('is-dirty');
    window.setTimeout(() => {
      if (!state.dirty) {
        elements.saveStatus.textContent = '已保存';
        elements.saveStatus.classList.remove('is-synced');
      }
    }, 1600);
  } catch {
    // 自动保存失败时保留未保存状态，下次再试。
  }
}

function syncTemplateBar() {
  if (!elements.templateBar) return;
  const empty = !state.filePath && !String(getMarkdown() || '').trim();
  elements.templateBar.classList.toggle('hidden', !empty);
}

function applyTemplate(id) {
  const template = templateById(id);
  setMarkdown(template.body || '', true);
  recomputeDirty();
  syncTemplateBar();
  focusEditor();
}

async function newFromTemplate(id) {
  closeAppMenu();
  if (state.workspaceRoot) {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      const result = await window.markl.createFile({
        dirPath: state.workspaceRoot,
        name: fileNameForTemplate(id),
        content: templateById(id).body || ''
      });
      await refreshWorkspace();
      loadContent(result.filePath, result.content);
    } catch (error) {
      showOperationError('从模板新建', error);
    }
    return;
  }
  if (!(await confirmDiscardIfDirty())) return;
  await doNew();
  applyTemplate(id);
}

function renderTemplateBar() {
  if (!elements.templateBarActions) return;
  elements.templateBarActions.replaceChildren();
  DOC_TEMPLATES.filter((item) => item.id !== 'blank').forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'template-chip';
    button.textContent = item.name;
    button.title = item.hint;
    button.addEventListener('click', () => applyTemplate(item.id));
    elements.templateBarActions.appendChild(button);
  });
}

async function openTemplateMenu() {
  closeAppMenu();
  if (state.filePath || String(getMarkdown() || '').trim()) {
    await doNew();
  }
  syncTemplateBar();
}

function typesetCurrentDocument() {
  const next = typesetChineseMarkdown(getMarkdown());
  if (next === getMarkdown()) {
    showAppDialog({ title: '中文排版', message: '这篇已经很干净，没有需要整理的地方。', ok: '知道了' });
    return;
  }
  applyMarkdownEdit(next);
}

function markdownImageNames(markdown) {
  const names = new Set();
  const text = String(markdown || '');
  const pattern = /!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let hit = pattern.exec(text);
  while (hit) {
    const src = String(hit[1] || hit[2] || '').split(/[?#]/)[0];
    const base = src.replace(/\\/g, '/').split('/').pop();
    if (base) names.add(decodeURIComponent(base));
    hit = pattern.exec(text);
  }
  return names;
}

async function openRevisionPanel() {
  closeAppMenu();
  concealLayer(elements.assetPanel);
  if (!state.filePath) {
    showAppDialog({ title: '本地历史', message: '先保存这篇文档，之后每次保存都会留下最近 10 个版本。', ok: '知道了' });
    return;
  }
  const items = await window.markl.listRevisions({ filePath: state.filePath }).catch(() => []);
  elements.revisionList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<p>还没有历史版本</p><span>保存一次之后，这里会出现最近 10 次内容。</span>';
    elements.revisionList.appendChild(empty);
  } else {
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'revision-item';
      const time = new Date(item.at).toLocaleString('zh-CN', { hour12: false });
      button.innerHTML = `<strong>${time}</strong><span>${escapeHtml(item.preview || '（空）')}</span>`;
      button.addEventListener('click', async () => {
        if (!(await confirmDiscardIfDirty())) return;
        try {
          const content = await window.markl.readRevision({ filePath: state.filePath, id: item.id });
          setMarkdown(content, true);
          recomputeDirty();
          concealLayer(elements.revisionPanel);
          focusEditor();
        } catch (error) {
          showOperationError('恢复历史', error);
        }
      });
      elements.revisionList.appendChild(button);
    });
  }
  revealLayer(elements.revisionPanel);
}

async function openAssetPanel() {
  closeAppMenu();
  concealLayer(elements.revisionPanel);
  if (!(await ensureDocumentOnDisk()) || !state.filePath) return;
  const assets = await window.markl.listAssets({ documentPath: state.filePath }).catch(() => []);
  elements.assetList.replaceChildren();
  if (!assets.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<p>还没有图片</p><span>粘贴或拖入图片后，会出现在文档旁的 assets 文件夹。</span>';
    elements.assetList.appendChild(empty);
  } else {
    assets.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'asset-item';
      const kb = Math.max(1, Math.round(item.bytes / 1024));
      button.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span>${kb} KB · ${escapeHtml(item.relative)}</span>`;
      button.addEventListener('click', () => {
        rememberImageAlias(item.fileUrl, item.relative);
        insertMarkdownSnippet(toMarkdownImage(imageAltFromName(item.name), item.relative));
        concealLayer(elements.assetPanel);
        focusEditor();
      });
      elements.assetList.appendChild(button);
    });
  }
  revealLayer(elements.assetPanel);
}

async function cleanUnusedImages() {
  closeAppMenu();
  if (!(await ensureDocumentOnDisk()) || !state.filePath) return;
  const assets = await window.markl.listAssets({ documentPath: state.filePath }).catch(() => []);
  const used = markdownImageNames(getMarkdown());
  const unused = assets.filter((item) => !used.has(item.name));
  if (!unused.length) {
    showAppDialog({ title: '清理图片', message: '这篇文档引用的图片都还在用，没有可以删的。', ok: '知道了' });
    return;
  }
  const ok = await showAppDialog({
    title: '清理未使用图片',
    message: `将删除 ${unused.length} 张未被正文引用的图片：\n${unused.map((item) => item.name).join('\n')}`,
    ok: '删除',
    cancel: '取消',
    danger: true
  });
  if (!ok) return;
  try {
    await window.markl.deleteImages({ documentPath: state.filePath, names: unused.map((item) => item.name) });
    if (isPathInside(state.filePath, state.workspaceRoot)) await refreshWorkspace();
  } catch (error) {
    showOperationError('清理图片', error);
  }
}

async function replaceInWorkspace() {
  const query = (elements.workspaceSearchInput?.value || '').trim();
  const replacement = elements.workspaceReplaceInput?.value ?? '';
  if (!query || !state.workspaceRoot) return;
  const compiled = compileSearch(query, findOptions());
  if (compiled.error) {
    showAppDialog({ title: '无法替换', message: compiled.error, ok: '知道了' });
    return;
  }
  const result = await window.markl.searchWorkspace({
    rootPath: state.workspaceRoot,
    query,
    ...findOptions()
  });
  const files = [...new Set((result?.contents || []).map((item) => item.path))];
  if (!files.length) {
    showAppDialog({ title: '全部替换', message: '正文里没有可替换的匹配。', ok: '知道了' });
    return;
  }
  const ok = await showAppDialog({
    title: '在文件夹中替换',
    message: `将在 ${files.length} 个文档里把「${query}」替换为「${replacement}」。此操作会立刻写盘。`,
    ok: '全部替换',
    cancel: '取消',
    danger: true
  });
  if (!ok) return;
  let count = 0;
  for (const filePath of files) {
    try {
      const source = samePath(filePath, state.filePath)
        ? getMarkdown()
        : (await window.markl.readFile({ filePath })).content;
      const next = replaceAllMatches(source, query, replacement, findOptions());
      if (!next.count) continue;
      if (samePath(filePath, state.filePath)) await snapshotCurrentRevision();
      await window.markl.writeFile({ filePath, content: next.text });
      count += next.count;
      if (samePath(filePath, state.filePath)) {
        setMarkdown(next.text, false);
        markClean(next.text);
      }
    } catch (error) {
      showOperationError('文件夹替换', error);
      return;
    }
  }
  await runWorkspaceSearch();
  showAppDialog({ title: '全部替换', message: `已替换 ${count} 处。`, ok: '知道了' });
}

const recentSwitch = { open: false, index: 0, items: [] };

function closeRecentSwitcher() {
  recentSwitch.open = false;
  concealLayer(elements.recentSwitcher, { instant: true });
}

function renderRecentSwitcher() {
  if (!elements.recentSwitcher) return;
  elements.recentSwitcher.replaceChildren();
  recentSwitch.items.forEach((filePath, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `recent-switch-item${index === recentSwitch.index ? ' is-active' : ''}`;
    button.innerHTML = `<span>${escapeHtml(baseName(filePath))}</span><span class="recent-switch-path">${escapeHtml(parentDirectory(filePath) || '')}</span>`;
    elements.recentSwitcher.appendChild(button);
  });
}

async function cycleRecentFile(back) {
  const items = readRecentFiles().filter((item) => item);
  if (items.length < 2) return;
  if (!recentSwitch.open) {
    recentSwitch.open = true;
    recentSwitch.items = items;
    recentSwitch.index = back ? items.length - 1 : 1;
    renderRecentSwitcher();
    revealLayer(elements.recentSwitcher);
    return;
  }
  const delta = back ? -1 : 1;
  recentSwitch.index = (recentSwitch.index + delta + items.length) % items.length;
  renderRecentSwitcher();
}

async function commitRecentSwitcher() {
  if (!recentSwitch.open) return;
  const target = recentSwitch.items[recentSwitch.index];
  closeRecentSwitcher();
  if (target && !samePath(target, state.filePath)) await openTreeFile(target);
}

function exportThemeColors() {
  const theme = state.appearance.theme;
  if (DARK_THEMES.has(theme)) {
    return { bg: '#2d333c', text: '#e8ecf1', muted: '#b4bcc8', border: '#414854', code: '#272c34', rule: '#414854' };
  }
  if (theme === 'sepia') {
    return { bg: '#eae4d5', text: '#3a3428', muted: '#5a5348', border: '#cfc6b4', code: '#e0d8c6', rule: '#cfc6b4' };
  }
  if (theme === 'mist') {
    return { bg: '#f7fafc', text: '#1a2430', muted: '#445566', border: '#d5e0e8', code: '#eaf1f5', rule: '#d5e0e8' };
  }
  return { bg: '#fbfbfc', text: '#1c2128', muted: '#5c6674', border: '#d5dbe3', code: '#eef1f5', rule: '#e8eaed' };
}

async function buildStandaloneHtml(title) {
  let body = getHTML();
  if (state.filePath && window.markl.inlineHtmlImages) {
    body = await window.markl.inlineHtmlImages({ documentPath: state.filePath, html: body });
  }
  const contentFont = FONT_STACKS[state.appearance.font] || FONT_STACKS.default;
  const theme = exportThemeColors();
  const dark = DARK_THEMES.has(state.appearance.theme);
  const hljsCss = dark
    ? `.hljs{color:#e6edf3}.hljs-keyword,.hljs-doctag,.hljs-type{color:#ff7b72}.hljs-title,.hljs-title.function_{color:#d2a8ff}.hljs-string,.hljs-meta .hljs-string{color:#a5d6ff}.hljs-number,.hljs-literal{color:#79c0ff}.hljs-comment{color:#8b949e}.hljs-built_in{color:#ffa657}`
    : `.hljs{color:#24292e}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}
.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}
.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#005cc5}
.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#032f62}
.hljs-built_in,.hljs-symbol{color:#e36209}
.hljs-code,.hljs-comment,.hljs-formula{color:#6a737d}
.hljs-name,.hljs-bullet,.hljs-deletion,.hljs-selector-pseudo,.hljs-selector-tag{color:#22863a}
.hljs-addition,.hljs-section,.hljs-selector-class,.hljs-title.class_{color:#005cc5}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<style>
body{max-width:760px;margin:48px auto;padding:0 24px 80px;font-family:${contentFont};line-height:1.8;color:${theme.text};background:${theme.bg};overflow-wrap:anywhere}
pre{background:${theme.code};padding:16px 20px;border-radius:8px;overflow:auto}code{font-family:"Cascadia Code",Consolas,monospace;font-size:13.5px}pre code{background:none;padding:0}
blockquote{color:${theme.muted};border-left:3px solid ${theme.border};margin-left:0;padding-left:16px}
table{width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;word-break:break-word}th,td{border:1px solid ${theme.border};padding:7px 12px;white-space:normal;overflow-wrap:break-word;word-break:break-word;vertical-align:top}img{max-width:100%}
h1,h2{border-bottom:1px solid ${theme.rule};padding-bottom:.3em}
center,font,div,span,p,section,article{font-family:inherit}center{text-align:center}
.katex-display{margin:1em 0;overflow-x:auto}
${hljsCss.trim()}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function persistDraftNow() {
  if (state.restoringSession) return;
  if (!state.dirty) {
    await window.markl.clearDraft().catch(() => {});
    return;
  }
  await window.markl.saveDraft({
    filePath: state.filePath,
    workspaceRoot: state.workspaceRoot,
    content: getMarkdown(),
    savedContent: state.savedContent
  }).catch(() => {});
}

function syncWatch() {
  window.markl.setWatch?.({
    workspaceRoot: state.workspaceRoot,
    filePath: state.filePath
  }).catch(() => {});
}

async function rememberDiskStamp(filePath) {
  if (!filePath) {
    state.diskMtime = 0;
    return;
  }
  try {
    const stat = await window.markl.statPath(filePath);
    state.diskMtime = stat?.mtimeMs || Date.now();
  } catch {
    state.diskMtime = Date.now();
  }
}

function flattenWorkspaceFiles(nodes, acc = []) {
  for (const node of nodes || []) {
    if (node.type === 'file') acc.push(node);
    else if (node.children?.length) flattenWorkspaceFiles(node.children, acc);
  }
  return acc;
}

function relativeToWorkspace(filePath) {
  if (!filePath) return '';
  if (!state.workspaceRoot) return String(filePath).replace(/\\/g, '/');
  const root = String(state.workspaceRoot).replace(/[\\/]+$/, '');
  const full = String(filePath);
  if (full.toLowerCase().startsWith(root.toLowerCase())) {
    return full.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') || full.replace(/\\/g, '/');
  }
  return full.replace(/\\/g, '/');
}

function subsequenceMatch(haystack, needle) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index >= needle.length) return true;
  }
  return false;
}

function scoreWorkspaceFile(query, file) {
  const q = String(query || '').trim().toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const rel = relativeToWorkspace(file.path).toLowerCase();
  if (!q) return 1;
  if (name === q || name === `${q}.md`) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (rel.includes(q)) return 40;
  if (subsequenceMatch(name, q)) return 20;
  return 0;
}

const quickOpen = { open: false, items: [], selected: 0 };

function closeQuickOpen({ restoreFocus = true } = {}) {
  if (!quickOpen.open) return;
  quickOpen.open = false;
  quickOpen.items = [];
  quickOpen.selected = 0;
  concealLayer(elements.quickOpen);
  if (restoreFocus) restoreEditorFocus();
}

function renderQuickOpenList() {
  const list = elements.quickOpenList;
  list.replaceChildren();
  if (!state.workspaceRoot) {
    const empty = document.createElement('div');
    empty.className = 'quick-open-empty';
    empty.textContent = '先打开一个文件夹';
    list.append(empty);
    return;
  }
  if (!quickOpen.items.length) {
    const empty = document.createElement('div');
    empty.className = 'quick-open-empty';
    empty.textContent = elements.quickOpenInput.value.trim() ? '没有匹配的文档' : '这个文件夹里还没有文档';
    list.append(empty);
    return;
  }
  quickOpen.items.forEach((file, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `quick-open-item${index === quickOpen.selected ? ' is-selected' : ''}${samePath(file.path, state.filePath) ? ' is-current' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === quickOpen.selected));
    const name = document.createElement('span');
    name.className = 'quick-open-name';
    name.textContent = file.name;
    const pathLabel = document.createElement('span');
    pathLabel.className = 'quick-open-path';
    pathLabel.textContent = relativeToWorkspace(file.path);
    button.append(name, pathLabel);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => openQuickOpenItem(index));
    list.append(button);
  });
  list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
}

function refreshQuickOpenItems() {
  const query = elements.quickOpenInput.value;
  const ranked = flattenWorkspaceFiles(state.workspaceTree)
    .map((file) => ({ file, score: scoreWorkspaceFile(query, file) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.file.name.localeCompare(right.file.name, 'zh-CN'));
  quickOpen.items = ranked.slice(0, 40).map((item) => item.file);
  if (quickOpen.selected >= quickOpen.items.length) quickOpen.selected = Math.max(0, quickOpen.items.length - 1);
  renderQuickOpenList();
}

function openQuickOpen() {
  closeLanguagePopup({ restoreFocus: false });
  quickOpen.open = true;
  quickOpen.selected = 0;
  revealLayer(elements.quickOpen);
  elements.quickOpenInput.value = '';
  refreshQuickOpenItems();
  elements.quickOpenInput.focus();
  elements.quickOpenInput.select();
}

async function openQuickOpenItem(index) {
  const file = quickOpen.items[index];
  if (!file) return;
  closeQuickOpen({ restoreFocus: false });
  await openTreeFile(file.path);
}

function moveQuickOpenSelection(delta) {
  if (!quickOpen.items.length) return;
  quickOpen.selected = (quickOpen.selected + delta + quickOpen.items.length) % quickOpen.items.length;
  renderQuickOpenList();
}

function jumpToHeadingHash(hash) {
  const raw = decodeURIComponent(String(hash || '').replace(/^#/, '')).trim();
  if (!raw) return false;
  const slug = raw.toLowerCase().replace(/\s+/g, '-');
  const items = parseHeadingOutline(getMarkdown());
  const item = items.find((entry) => {
    const text = String(entry.text || '');
    return text === raw || text.toLowerCase() === raw.toLowerCase() || text.toLowerCase().replace(/\s+/g, '-') === slug;
  });
  if (!item) return false;
  jumpToOutlineItem(item);
  return true;
}

function hrefFromEditorEvent(event) {
  const anchor = event.target.closest?.('a[href]');
  if (anchor && elements.editorWrap.contains(anchor)) {
    return (anchor.getAttribute('href') || '').trim();
  }
  const node = event.target.closest?.('[data-type="a"]');
  if (!node || !elements.editorWrap.contains(node)) return '';
  if (node.classList.contains('vditor-ir__node--expand') && event.target.closest('.vditor-ir__marker')) {
    return '';
  }
  const marked = node.querySelector('.vditor-ir__marker--link');
  const nested = node.querySelector('a[href]');
  return (nested?.getAttribute('href') || marked?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim();
}

async function handleEditorLink(href) {
  const raw = String(href || '').trim();
  if (!raw) return;
  if (raw.startsWith('#')) {
    if (!jumpToHeadingHash(raw)) showOperationError('打开链接', new Error('没有找到这个标题。'));
    return;
  }
  try {
    const result = await window.markl.resolveDocumentLink({
      documentPath: state.filePath,
      workspaceRoot: state.workspaceRoot,
      href: raw
    });
    if (result?.kind === 'external' && result.url) {
      await window.markl.openExternal(result.url);
      return;
    }
    if (result?.kind === 'heading') {
      if (!jumpToHeadingHash(result.hash)) showOperationError('打开链接', new Error('没有找到这个标题。'));
      return;
    }
    if (result?.kind === 'document' && result.path) {
      await openTreeFile(result.path);
      return;
    }
    if (result?.kind === 'missing') {
      showOperationError('打开链接', new Error('这个文件不在磁盘上。'));
      return;
    }
    if (result?.kind === 'other' && result.path) {
      await window.markl.revealInFolder(result.path);
    }
  } catch (error) {
    showOperationError('打开链接', error);
  }
}

function flashDiskSync() {
  const el = elements.saveStatus;
  if (!el) return;
  el.textContent = '已从磁盘更新';
  el.classList.remove('is-dirty');
  el.classList.add('is-synced');
  window.clearTimeout(flashDiskSync.timer);
  flashDiskSync.timer = window.setTimeout(() => {
    el.classList.remove('is-synced');
    updateTitle();
  }, 1600);
}

function applyExternalReload(filePath, content) {
  const wrap = elements.editorWrap;
  const top = wrap?.scrollTop || 0;
  const sourceTop = elements.sourceEditor?.scrollTop || 0;
  const ir = getIrElement();
  const hadFocus = Boolean(
    (ir && (document.activeElement === ir || ir.contains(document.activeElement)))
    || document.activeElement === elements.sourceEditor
  );
  state.filePath = filePath;
  const normalized = normalizeMarkdown(content);
  setMarkdown(normalized, true);
  markClean(normalized);
  updateCounts();
  renderHeadingTree();
  updateActiveTreeItem();
  scheduleCodeHighlight();
  scheduleImageResolve();
  scheduleTableBalance();
  refreshFindMatches({ stay: true, reveal: false });
  persistSession();
  rememberDiskStamp(filePath);
  if (wrap) wrap.scrollTop = top;
  if (elements.sourceEditor) elements.sourceEditor.scrollTop = sourceTop;
  if (hadFocus) restoreEditorFocus();
  flashDiskSync();
}

async function handleExternalFileChange() {
  if (!state.filePath || fileChangePromptOpen) return;
  try {
    const stat = await window.markl.statPath(state.filePath);
    if (!stat?.exists) {
      state.fileMissing = true;
      state.dirty = true;
      updateTitle();
      return;
    }
    if (state.diskMtime && stat.mtimeMs && stat.mtimeMs <= state.diskMtime + 20) return;
    if (!state.dirty) {
      const result = await window.markl.readFile({ filePath: state.filePath });
      applyExternalReload(result.filePath, result.content);
      return;
    }
    fileChangePromptOpen = true;
    const ok = await showAppDialog({
      title: '文件已更改',
      message: `磁盘上的「${baseName(state.filePath)}」已经改过了。用磁盘上的版本覆盖当前内容吗？`,
      ok: '用磁盘版本',
      cancel: '继续编辑'
    });
    fileChangePromptOpen = false;
    if (ok) {
      const result = await window.markl.readFile({ filePath: state.filePath });
      applyExternalReload(result.filePath, result.content);
    } else {
      state.diskMtime = stat.mtimeMs || Date.now();
    }
    restoreEditorFocus();
  } catch (error) {
    fileChangePromptOpen = false;
    console.warn('处理外部修改失败：', error);
  }
}

function handleFsChange(payload) {
  const paths = payload?.paths || [];
  if (!paths.length) return;
  if (state.workspaceRoot && !state.treeDraft) {
    const treeTouched = paths.some((item) => isPathInside(item, state.workspaceRoot));
    if (treeTouched) refreshWorkspace().catch(() => {});
  }
  if (state.filePath) {
    const parent = parentDirectory(state.filePath);
    const touched = paths.some((item) => (
      samePath(item, state.filePath)
      || samePath(item, parent)
      || samePath(item, state.workspaceRoot)
    ));
    if (touched) handleExternalFileChange();
  }
  if (state.sidebarTab === 'search' && elements.workspaceSearchInput?.value.trim()) {
    scheduleWorkspaceSearch();
  }
}

async function restoreDraftIfAny(launch) {
  const draft = await window.markl.readDraft().catch(() => null);
  if (!draft?.content) return;
  if (launch?.file && draft.filePath && !samePath(launch.file.filePath, draft.filePath)) return;
  if (draft.content === getMarkdown()) {
    await window.markl.clearDraft().catch(() => {});
    return;
  }
  const name = draft.filePath ? baseName(draft.filePath) : '未命名.md';
  const ok = await showAppDialog({
    title: '恢复草稿',
    message: `上次退出前，「${name}」还有未保存的内容。要恢复这份草稿吗？`,
    ok: '恢复草稿',
    cancel: '丢掉草稿'
  });
  if (!ok) {
    await window.markl.clearDraft().catch(() => {});
    restoreEditorFocus();
    return;
  }
  if (draft.filePath && !samePath(draft.filePath, state.filePath)) {
    state.filePath = draft.filePath;
  }
  setMarkdown(draft.content, true);
  state.savedContent = draft.savedContent ?? '';
  state.fileMissing = false;
  recomputeDirty();
  updateTitle();
  updateCounts();
  renderHeadingTree();
  persistSession();
  restoreEditorFocus();
}

function syncWorkspaceChrome() {
  const open = Boolean(state.workspaceRoot);
  if (elements.sidebarActions) elements.sidebarActions.classList.toggle('has-workspace', open);
  if (elements.openFolderButton) {
    elements.openFolderButton.classList.toggle('primary-button', !open);
    elements.openFolderButton.classList.toggle('text-button', open);
    elements.openFolderButton.classList.toggle('open-folder-quiet', open);
    elements.openFolderButton.innerHTML = FOLDER_BUTTON_SVG + (open ? '更换文件夹' : '打开文件夹');
    elements.openFolderButton.title = open ? '换一个文件夹作为工作区' : '选择一个包含 Markdown 文档的文件夹';
  }
  if (elements.workspacePath && !open) {
    elements.workspacePath.textContent = '.md · .markdown · .txt';
    elements.workspacePath.title = '';
  }
}

function isHistoryExpanded() {
  return localStorage.getItem(HISTORY_OPEN_KEY) === '1';
}

function setHistoryExpanded(open) {
  localStorage.setItem(HISTORY_OPEN_KEY, open ? '1' : '0');
  elements.openHistory?.classList.toggle('is-collapsed', !open);
  elements.historyToggle?.setAttribute('aria-expanded', String(open));
}

function getSidebarWidth() {
  const raw = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
  return Number.isFinite(raw) ? raw : SIDEBAR_DEFAULT;
}

function applySidebarWidth(width) {
  const next = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(width) || SIDEBAR_DEFAULT)));
  document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  return next;
}

function applySessionChrome() {
  const session = readSession();
  if (session.sidebarHidden) document.body.classList.add('sidebar-hidden');
  const storedWidth = session.sidebarWidth || Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  applySidebarWidth(storedWidth || SIDEBAR_DEFAULT);
  setHistoryExpanded(isHistoryExpanded());
  syncWorkspaceChrome();
}

function expandAncestors(filePath, rootPath) {
  if (!filePath || !rootPath || !isPathInside(filePath, rootPath)) return;
  let current = parentDirectory(filePath);
  while (current && isPathInside(current, rootPath)) {
    state.expandedPaths.add(current);
    const parent = parentDirectory(current);
    if (!parent || samePath(parent, current)) break;
    current = parent;
  }
}

function normalizeFileUrl(url) {
  try {
    return decodeURI(String(url || '')).replace(/\\/g, '/');
  } catch {
    return String(url || '');
  }
}

function rememberImageAlias(fileUrl, relative) {
  if (!fileUrl || !relative || /^(https?:|data:|blob:)/i.test(relative)) return;
  imageUrlAliases.set(fileUrl, relative);
  imageUrlAliases.set(normalizeFileUrl(fileUrl), relative);
}

function fileUrlToAbsolute(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return '';
    let pathname = decodeURIComponent(parsed.pathname || '');
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return pathname.replace(/\//g, pathSeparator(state.filePath || pathname));
  } catch {
    return '';
  }
}

function absoluteToDocumentRelative(absPath) {
  if (!state.filePath || !absPath) return null;
  const normalize = (value) => String(value).replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const from = normalize(parentDirectory(state.filePath));
  const to = normalize(absPath);
  const fromKey = from.toLowerCase();
  const toKey = to.toLowerCase();
  if (toKey === fromKey) return './';
  if (!toKey.startsWith(`${fromKey}/`)) return null;
  return `./${to.slice(from.length + 1)}`;
}

function sanitizeImageMarkdown(markdown) {
  if (!markdown || (!imageUrlAliases.size && !state.filePath) || !/file:/i.test(markdown)) return markdown;
  return rewriteFileUrls(markdown, (url) => (
    imageUrlAliases.get(url)
    || imageUrlAliases.get(normalizeFileUrl(url))
    || absoluteToDocumentRelative(fileUrlToAbsolute(url))
    || null
  ));
}

function scheduleImageResolve() {
  window.clearTimeout(imageResolveTimer);
  imageResolveTimer = window.setTimeout(() => {
    resolveEditorImages().catch((error) => console.warn('解析图片失败：', error));
  }, 80);
}

async function resolveEditorImages() {
  if (!state.filePath || state.sourceMode) return;
  const images = [...document.querySelectorAll('#editor img')];
  if (!images.length) return;

  const sources = images.map((image) => image.dataset.marklSrc || image.getAttribute('src') || '');
  const resolved = await window.markl.resolveImages({ documentPath: state.filePath, sources });

  images.forEach((image, index) => {
    const item = resolved[index];
    if (!item) return;
    if (!image.dataset.marklSrc && item.relative) image.dataset.marklSrc = item.relative;
    if (item.exists && item.fileUrl && !item.remote) {
      rememberImageAlias(item.fileUrl, item.relative || image.dataset.marklSrc || item.src);
      if (image.getAttribute('src') !== item.fileUrl) image.src = item.fileUrl;
    }
  });
}

function findOptions() {
  return {
    caseSensitive: findState.caseSensitive,
    wholeWord: findState.wholeWord,
    regex: findState.regex
  };
}

function currentSelectionText() {
  if (state.sourceMode) {
    const { selectionStart, selectionEnd, value } = elements.sourceEditor;
    if (selectionStart === selectionEnd) return '';
    return value.slice(selectionStart, selectionEnd);
  }
  return window.getSelection()?.toString() || '';
}

function queryFromSelection() {
  const selected = currentSelectionText().replace(/\r\n/g, '\n').split('\n')[0].trim();
  return selected.slice(0, 200);
}

function updateFindCount() {
  const { matches, index, query, error } = findState;
  if (error) {
    elements.findCount.textContent = error;
    elements.findCount.classList.add('is-empty');
  } else if (!query) {
    elements.findCount.textContent = '';
    elements.findCount.classList.remove('is-empty');
  } else if (!matches.length) {
    elements.findCount.textContent = '无结果';
    elements.findCount.classList.add('is-empty');
  } else {
    const capped = matches.length >= FIND_MATCH_LIMIT ? `${FIND_MATCH_LIMIT}+` : String(matches.length);
    elements.findCount.textContent = `${index + 1} / ${capped}`;
    elements.findCount.classList.remove('is-empty');
  }

  const hasMatches = matches.length > 0;
  elements.findPrev.disabled = !hasMatches;
  elements.findNext.disabled = !hasMatches;
  elements.replaceOne.disabled = !hasMatches;
  elements.replaceAll.disabled = !hasMatches;
}

function collectFindMatches() {
  findState.query = elements.findInput.value;
  const compiled = compileSearch(findState.query, findOptions());
  findState.error = compiled.error || '';
  findState.matches = compiled.matches(getMarkdown());
  if (!findState.matches.length) findState.index = 0;
  else if (findState.index >= findState.matches.length) findState.index = findState.matches.length - 1;
  updateFindCount();
}

function isSkippedFindHost(element) {
  if (!element?.closest) return true;
  if (element.closest('#quick-open, .update-panel, #app-dialog')) return true;
  if (element.closest('.language-popup, .table-toolbar, .find-bar, .markl-live-hl, .vditor-copy')) return true;
  if (element.closest('.vditor-ir__marker')) return true;

  const preview = element.closest('.vditor-ir__preview');
  if (preview) {
    const node = preview.closest('.vditor-ir__node');
    if (node?.classList.contains('vditor-ir__node--expand')) return true;
  }

  const code = element.closest('[data-type="code-block"]');
  if (code && !element.closest('.vditor-ir__preview') && !code.classList.contains('vditor-ir__node--expand')) {
    return true;
  }
  return false;
}

function walkVisibleTextNodes(root, visit) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const host = node.parentElement;
      if (isSkippedFindHost(host)) return NodeFilter.FILTER_REJECT;
      if (host?.closest('[hidden]')) return NodeFilter.FILTER_REJECT;
      const style = host ? window.getComputedStyle(host) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = walker.nextNode();
  while (node) {
    visit(node);
    node = walker.nextNode();
  }
}

function collectVisibleTextIndex(root) {
  const pieces = [];
  let value = '';
  walkVisibleTextNodes(root, (node) => {
    pieces.push({ node, start: value.length, end: value.length + node.nodeValue.length });
    value += node.nodeValue;
  });
  return { value, pieces };
}

function locateTextIndex(pieces, index, preferEnd) {
  for (const piece of pieces) {
    if (index < piece.end || (index === piece.end && (preferEnd || index === piece.start))) {
      return { node: piece.node, offset: Math.max(0, index - piece.start) };
    }
  }
  const last = pieces[pieces.length - 1];
  return last ? { node: last.node, offset: last.node.nodeValue.length } : null;
}

function rangeFromIndexes(pieces, start, end) {
  const from = locateTextIndex(pieces, start, false);
  const to = locateTextIndex(pieces, end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, Math.min(from.offset, from.node.nodeValue.length));
  range.setEnd(to.node, Math.min(to.offset, to.node.nodeValue.length));
  return range;
}

function selectSourceRange(start, end) {
  const textarea = elements.sourceEditor;
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  const line = (textarea.value.slice(0, start).match(/\n/g) || []).length;
  textarea.scrollTop = Math.max(0, line * lineHeight - 80);
}

function selectIrMatch(match, markdown) {
  const root = getIrElement();
  if (!root) return;
  const query = markdown.slice(match.start, match.end);
  if (!query) return;

  const visible = collectVisibleTextIndex(root);
  const visibleMatches = collectMatches(visible.value, query, findOptions());
  let chosen = visibleMatches[Math.min(findState.index, Math.max(visibleMatches.length - 1, 0))];

  if (visibleMatches.length !== findState.matches.length) {
    const line = lineNumberAt(markdown, match.start);
    const hint = visibleLineHint(markdown.split('\n')[line] || '');
    const hintIndex = hint ? visible.value.toLowerCase().indexOf(hint.toLowerCase()) : -1;
    if (hintIndex >= 0) {
      const nearby = visibleMatches.find((item) => item.start >= hintIndex && item.start <= hintIndex + Math.max(hint.length, query.length) + 40)
        || visibleMatches.find((item) => Math.abs(item.start - hintIndex) < 200);
      if (nearby) chosen = nearby;
    }
  }

  if (!chosen) {
    const line = lineNumberAt(markdown, match.start);
    const hint = visibleLineHint(markdown.split('\n')[line] || query);
    if (hint) {
      const nodes = [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote')];
      const block = nodes.find((node) => (node.textContent || '').includes(hint) || (node.textContent || '').includes(query));
      block?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    return;
  }

  const range = rangeFromIndexes(visible.pieces, chosen.start, chosen.end);
  if (!range) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const host = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  host?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function revealCurrentMatch() {
  if (!findState.open || !findState.matches.length) return;
  const markdown = getMarkdown();
  const match = findState.matches[findState.index];
  if (!match) return;
  if (state.sourceMode) selectSourceRange(match.start, match.end);
  else selectIrMatch(match, markdown);
}

function refreshFindMatches(options = {}) {
  if (!findState.open) return;
  const previous = findState.matches[findState.index];
  collectFindMatches();
  if (options.stay && previous) {
    const nextIndex = findState.matches.findIndex((item) => item.start === previous.start);
    if (nextIndex >= 0) findState.index = nextIndex;
  } else if (options.reset) {
    findState.index = 0;
  }
  updateFindCount();
  if (options.reveal !== false && findState.matches.length) revealCurrentMatch();
}

function scheduleFindRefresh() {
  if (!findState.open) return;
  window.clearTimeout(findRefreshTimer);
  findRefreshTimer = window.setTimeout(() => refreshFindMatches({ stay: true, reveal: false }), 80);
}

function setReplaceOpen(open) {
  findState.replaceOpen = Boolean(open);
  elements.replaceRow.classList.toggle('hidden', !findState.replaceOpen);
  elements.findToggleReplace.classList.toggle('is-active', findState.replaceOpen);
  elements.findToggleReplace.setAttribute('aria-expanded', String(findState.replaceOpen));
  elements.findToggleReplace.title = findState.replaceOpen ? '隐藏替换' : '显示替换';
}

function openFindBar(options = {}) {
  const selected = queryFromSelection();
  findState.open = true;
  revealLayer(elements.findBar);
  if (options.replace) setReplaceOpen(true);
  if (selected) elements.findInput.value = selected;
  refreshFindMatches({ reset: Boolean(selected), reveal: true });
  const focusTarget = options.replace && !selected ? elements.replaceInput : elements.findInput;
  focusTarget.focus();
  focusTarget.select();
}

function closeFindBar() {
  if (!findState.open) return;
  findState.open = false;
  concealLayer(elements.findBar);
  restoreEditorFocus();
}

function findStep(step) {
  if (!findState.open) openFindBar();
  collectFindMatches();
  if (!findState.matches.length) {
    updateFindCount();
    return;
  }
  findState.index = (findState.index + step + findState.matches.length) % findState.matches.length;
  updateFindCount();
  revealCurrentMatch();
}

function applyMarkdownEdit(next, options = {}) {
  const wrap = elements.editorWrap;
  const top = wrap.scrollTop;
  if (state.sourceMode) {
    elements.sourceEditor.value = next;
  } else if (vditor) {
    vditor.setValue(next, options.clearStack ?? false);
  }
  wrap.scrollTop = top;
  recomputeDirty();
  scheduleCodeHighlight();
  scheduleOutlineRefresh();
  scheduleImageResolve();
}

function replaceCurrentMatch() {
  collectFindMatches();
  const match = findState.matches[findState.index];
  if (!match) return;
  const replacement = elements.replaceInput.value;
  const markdown = getMarkdown();

  if (state.sourceMode) {
    selectSourceRange(match.start, match.end);
    if (!document.execCommand('insertText', false, replacement)) {
      applyMarkdownEdit(replaceRange(markdown, match.start, match.end, replacement));
    } else {
      recomputeDirty();
    }
  } else {
    applyMarkdownEdit(replaceRange(markdown, match.start, match.end, replacement));
  }

  refreshFindMatches({ stay: false });
  if (findState.matches.length) {
    findState.index = Math.min(findState.index, findState.matches.length - 1);
    updateFindCount();
    revealCurrentMatch();
  }
}

function replaceAllCurrent() {
  const query = elements.findInput.value;
  if (!query) return;
  const result = replaceAllMatches(getMarkdown(), query, elements.replaceInput.value, findOptions());
  if (!result.count) return;
  applyMarkdownEdit(result.text);
  refreshFindMatches({ reset: true, reveal: false });
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return IMAGE_FILE_RE.test(file.name || file.path || '');
}

function isDocumentFile(file) {
  return DOCUMENT_FILE_RE.test(file?.name || file?.path || '');
}

function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];
  const files = [];
  if (dataTransfer.files?.length) {
    files.push(...dataTransfer.files);
  } else if (dataTransfer.items?.length) {
    for (const item of dataTransfer.items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

function imageFilesFromDataTransfer(dataTransfer) {
  return filesFromDataTransfer(dataTransfer).filter(isImageFile);
}

async function openDroppedDocument(file) {
  const filePath = file?.path;
  if (!filePath) {
    showOperationError('打开文件', new Error('无法读取拖入的文件路径。'));
    return true;
  }
  if (samePath(filePath, state.filePath)) return true;
  if (!(await confirmDiscardIfDirty())) return true;
  try {
    const result = await window.markl.readFile({ filePath });
    loadContent(result.filePath, result.content);
  } catch (error) {
    showOperationError('打开文件', error);
  }
  return true;
}

async function ensureDocumentOnDisk() {
  if (state.filePath) {
    const stat = await window.markl.statPath(state.filePath);
    if (stat.exists) return true;
  }
  const ok = await showAppDialog({
    title: '先保存文档',
    message: '插入图片需要先把文档保存到磁盘。现在保存吗？',
    ok: '保存',
    cancel: '取消'
  });
  if (!ok) return false;
  return doSave();
}

function defaultPastedName(file) {
  const original = file?.name || '';
  if (original && original !== 'image.png' && original !== 'blob' && !/^image\.(png|jpe?g|gif)$/i.test(original)) {
    return original;
  }
  const stamp = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const ext = IMAGE_FILE_RE.test(original)
    ? original.slice(original.lastIndexOf('.'))
    : ({
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp'
    }[file?.type] || '.png');
  return `pasted-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}${ext}`;
}

function insertMarkdownSnippet(snippet) {
  if (state.sourceMode) {
    const textarea = elements.sourceEditor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    const caret = start + snippet.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    recomputeDirty();
    scheduleFindRefresh();
    return;
  }
  if (vditor?.insertValue) vditor.insertValue(snippet);
  else document.execCommand('insertText', false, snippet);
  scheduleImageResolve();
  scheduleCodeHighlight();
}

async function compressImageFile(file) {
  if (!file || file.type.includes('svg') || file.type.includes('gif')) return file;
  if (!String(file.type || '').startsWith('image/') || file.size < 350000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    bitmap.close?.();
    if (!blob || blob.size >= file.size) return file;
    const name = defaultPastedName(file).replace(/\.[^.]+$/, '.jpg');
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function insertImageFiles(files) {
  const images = [...files].filter(isImageFile);
  if (!images.length) return false;
  if (!(await ensureDocumentOnDisk()) || !state.filePath) return true;

  try {
    const snippets = [];
    for (const original of images) {
      const file = await compressImageFile(original);
      const saved = await window.markl.saveImage({
        documentPath: state.filePath,
        name: defaultPastedName(file),
        mime: file.type,
        bytes: await file.arrayBuffer()
      });
      rememberImageAlias(saved.fileUrl, saved.relative);
      snippets.push(toMarkdownImage(imageAltFromName(file.name), saved.relative));
    }
    insertMarkdownSnippet(snippets.join('\n\n'));
    if (isPathInside(state.filePath, state.workspaceRoot)) await refreshWorkspace();
  } catch (error) {
    showOperationError('插入图片', error);
  }
  return true;
}

function setDropActive(active) {
  elements.editorWrap.classList.toggle('is-dropping', active);
  if (elements.dropMask) elements.dropMask.setAttribute('aria-hidden', String(!active));
}

async function restoreWorkspaceFromSession(session, options = {}) {
  if (!session.workspaceRoot) return false;
  const stat = await window.markl.statPath(session.workspaceRoot);
  if (!stat.exists || stat.kind !== 'directory') return false;
  if (options.preferFile && !isPathInside(options.preferFile, session.workspaceRoot)) return false;
  const payload = await window.markl.refreshWorkspace(session.workspaceRoot);
  if (!payload) return false;
  applyWorkspace(payload, { expandedPaths: session.expandedPaths });
  rememberOpen('folder', payload.rootPath);
  return true;
}

async function restoreOnStartup() {
  state.restoringSession = true;
  let launch = null;
  try {
    launch = await launchContextPromise;
    appMenuDev = Boolean(launch?.dev);
    if (!launchHandled) {
      const session = readSession();
      if (launch?.file) {
        launchHandled = true;
        loadContent(launch.file.filePath, launch.file.content);
        await restoreWorkspaceFromSession(session, { preferFile: launch.file.filePath });
      } else {
        await restoreWorkspaceFromSession(session);
        if (session.filePath) {
          const stat = await window.markl.statPath(session.filePath);
          if (stat.exists && stat.kind === 'file') {
            const result = await window.markl.readFile({ filePath: stat.path || session.filePath });
            loadContent(result.filePath, result.content);
          }
        }
      }
    }
  } catch (error) {
    console.warn('恢复上次工作区失败：', error);
  } finally {
    state.restoringSession = false;
    if (!state.filePath) markClean(getMarkdown());
    persistSessionNow();
    updateCounts();
    renderHeadingTree();
    renderPinnedList();
    syncTemplateBar();
    scheduleImageResolve();
    if (findState.open) refreshFindMatches({ stay: true, reveal: false });
    focusEditor();
  }
  await restoreDraftIfAny(launch);
}

function createVditor() {
  if (!window.Vditor) {
    showAppDialog({
      title: '无法启动编辑器',
      message: '编辑器未能加载，请重新启动 MarkL。',
      ok: '知道了'
    });
    return;
  }

  vditor = new window.Vditor('editor', {
    cdn: VDITOR_CDN,
    _lutePath: new URL('../../node_modules/vditor/dist/js/lute/lute.min.js', import.meta.url).href,
    mode: 'ir',
    height: '100%',
    lang: 'zh_CN',
    theme: DARK_THEMES.has(state.appearance.theme) ? 'dark' : 'classic',
    icon: 'ant',
    tab: '    ',
    // placeholder: '输入 # 加空格开始标题；输入三个反引号后回车，选择代码语言。',
    cache: { enable: false },
    toolbar: [],
    toolbarConfig: { hide: true, pin: false },
    outline: { enable: false, position: 'left' },
    counter: { enable: false },
    preview: {
      delay: 80,
      math: {
        engine: 'KaTeX',
        inlineDigit: false
      },
      markdown: {
        sanitize: false,
        mermaid: true,
        codeBlockPreview: true,
        mathBlockPreview: true,
        mark: true
      },
      hljs: {
        enable: true,
        lineNumber: false,
        defaultLang: '',
        style: 'github'
      },
      theme: {
        current: DARK_THEMES.has(state.appearance.theme) ? 'dark' : 'light',
        path: CONTENT_THEME_PATH
      }
    },
    after() {
      state.editorReady = true;
      applyVditorTheme(state.appearance.theme);
      decorateCodeBlocks();
      watchCodeHighlight();
      scheduleTableToolbar();
      renderTemplateBar();
      renderPinnedList();
      restoreOnStartup();
    },
    input() {
      recomputeDirty();
      scheduleCodeHighlight();
      scheduleImageResolve();
      scheduleFindRefresh();
    },
    keydown(event) {
      if (event.isComposing) return;
      handlePopupKeydown(event);
    }
  });
}

document.getElementById('open-folder-button').addEventListener('click', doOpenFolder);
document.getElementById('refresh-tree-button').addEventListener('click', refreshWorkspace);
document.getElementById('new-tree-button').addEventListener('click', startRootDocument);
document.getElementById('new-button').addEventListener('click', doNew);
elements.fileTree.addEventListener('contextmenu', onTreeContextMenu);
elements.sidebar.addEventListener('contextmenu', (event) => {
  if (state.sidebarTab !== 'files') return;
  if (event.target.closest('#file-tree, #open-history, .sidebar-rail')) return;
  onTreeContextMenu(event);
});
elements.tabFiles.addEventListener('click', () => setSidebarTab('files', { focus: false }));
elements.tabOutline.addEventListener('click', () => setSidebarTab('outline', { focus: false }));
elements.tabSearch?.addEventListener('click', () => setSidebarTab('search'));
elements.workspaceSearchInput?.addEventListener('input', (event) => {
  if (event.isComposing) return;
  scheduleWorkspaceSearch();
});
elements.workspaceSearchInput?.addEventListener('compositionend', () => {
  scheduleWorkspaceSearch();
});
elements.workspaceSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    elements.workspaceSearchInput.value = '';
    scheduleWorkspaceSearch();
  }
});
document.getElementById('open-button').addEventListener('click', doOpen);
document.getElementById('save-button').addEventListener('click', doSave);
const updateUi = {
  open: false,
  busy: false,
  cancelled: false,
  status: '',
  payload: null
};

function formatReleaseDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function setUpdateBusy(busy) {
  updateUi.busy = busy;
  if (!elements.checkUpdateButton) return;
  elements.checkUpdateButton.disabled = busy;
  elements.checkUpdateButton.setAttribute('aria-busy', busy ? 'true' : 'false');
  const refreshSvg = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M3.3 8a4.7 4.7 0 0 1 7.95-3.35l.75-.75M12.75 2.7v2.85h-2.85M12.7 8a4.7 4.7 0 0 1-7.95 3.35l-.75.75M3.25 13.3V10.45h2.85"/></svg>';
  const spinSvg = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style="animation:spin .8s linear infinite"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M8 2.3a5.7 5.7 0 1 1-4.7 2.45"/></svg>';
  elements.checkUpdateButton.innerHTML = busy ? spinSvg : refreshSvg;
  elements.checkUpdateButton.title = busy ? '正在检查更新' : '检查更新';
  elements.checkUpdateButton.setAttribute('aria-label', busy ? '正在检查更新' : '检查更新');
}

function setUpdateShown(el, shown) {
  el.classList.toggle('hidden', !shown);
}

function closeUpdatePanel({ dismiss = false, restoreFocus = true } = {}) {
  if (updateUi.status === 'checking') updateUi.cancelled = true;
  if (dismiss && updateUi.payload?.latest) {
    window.markl.dismissUpdate(updateUi.payload.latest).catch(() => {});
  }
  updateUi.open = false;
  updateUi.status = '';
  updateUi.payload = null;
  concealLayer(elements.updatePanel);
  elements.updatePanel.classList.remove('is-checking');
  if (restoreFocus) restoreEditorFocus();
}

function renderUpdatePanel() {
  const status = updateUi.status;
  const data = updateUi.payload || {};
  elements.updatePanel.classList.toggle('is-checking', status === 'checking');
  elements.updatePanel.setAttribute('aria-busy', status === 'checking' ? 'true' : 'false');

  const titles = {
    checking: '检查更新',
    latest: '已是最新',
    available: '发现新版本',
    error: '检查更新'
  };
  const leads = {
    checking: '正在查看 GitHub Release',
    latest: '当前就是最新版本',
    available: '',
    error: '暂时连不上更新服务'
  };
  elements.updateTitle.textContent = titles[status] || '检查更新';
  elements.updateLead.textContent = leads[status] || '';
  setUpdateShown(elements.updateLead, Boolean(leads[status]));

  if (status === 'latest' && data.current) {
    elements.updateMeta.textContent = `版本 ${data.current}`;
    setUpdateShown(elements.updateMeta, true);
  } else if (status === 'available') {
    const bits = [];
    const published = formatReleaseDate(data.publishedAt);
    if (published) bits.push(published);
    if (data.portable?.size) bits.push(`绿色版 ${data.portable.size}`);
    elements.updateMeta.textContent = bits.join(' · ');
    setUpdateShown(elements.updateMeta, bits.length > 0);
  } else {
    elements.updateMeta.textContent = '';
    setUpdateShown(elements.updateMeta, false);
  }

  if (status === 'available' && data.current && data.latest) {
    elements.updateCurrent.textContent = data.current;
    elements.updateLatest.textContent = data.latest;
    setUpdateShown(elements.updateVersions, true);
  } else {
    setUpdateShown(elements.updateVersions, false);
    if (status === 'available') {
      elements.updateLead.textContent = data.latest ? `MarkL ${data.latest}` : '有新版本可下载';
      setUpdateShown(elements.updateLead, true);
    }
  }

  const notes = status === 'available' && Array.isArray(data.notes) ? data.notes : [];
  elements.updateNotes.replaceChildren();
  for (const line of notes) {
    const item = document.createElement('li');
    item.textContent = line;
    elements.updateNotes.append(item);
  }
  setUpdateShown(elements.updateNotes, notes.length > 0);

  if (status === 'error') {
    elements.updateError.textContent = data.message || '网络不可用。';
    setUpdateShown(elements.updateError, true);
  } else {
    elements.updateError.textContent = '';
    setUpdateShown(elements.updateError, false);
  }

  if (status === 'available') {
    elements.updateDownload.textContent = data.portable?.url ? '下载绿色版' : '打开发布页';
  }

  setUpdateShown(elements.updateDownload, status === 'available');
  setUpdateShown(elements.updateSetup, status === 'available' && Boolean(data.setup?.url));
  setUpdateShown(elements.updateRetry, status === 'error');
  setUpdateShown(elements.updateLater, status === 'available');
  setUpdateShown(elements.updateOk, status === 'latest');
  setUpdateShown(elements.updateRelease, status === 'available' && Boolean(data.url));
  setUpdateShown(elements.updateActions, status !== 'checking');

  const describedBy = status === 'error'
    ? 'update-error'
    : status === 'available'
      ? 'update-versions'
      : 'update-lead';
  elements.updatePanel.setAttribute('aria-describedby', describedBy);
}

function focusUpdatePanel() {
  const preferred = [
    elements.updateDownload,
    elements.updateOk,
    elements.updateRetry,
    elements.updateClose
  ].find((button) => button && !button.classList.contains('hidden'));
  preferred?.focus();
}

function showUpdatePanel(payload, { focus = false } = {}) {
  const next = payload || { status: 'error', message: '更新信息无法解析。' };
  if (updateUi.cancelled && next.status !== 'available') {
    updateUi.cancelled = false;
    return;
  }
  updateUi.cancelled = false;
  updateUi.open = true;
  updateUi.status = next.status || 'error';
  updateUi.payload = next;
  renderUpdatePanel();
  revealLayer(elements.updatePanel);
  if (focus) focusUpdatePanel();
}

async function openUpdateLink(url) {
  if (!url) return;
  try {
    await window.markl.openExternal(url);
    closeUpdatePanel({ dismiss: updateUi.status === 'available' });
  } catch (error) {
    showUpdatePanel({
      status: 'error',
      current: updateUi.payload?.current,
      message: error?.message || String(error)
    }, { focus: true });
  }
}

async function runManualUpdateCheck() {
  if (updateUi.busy) return;
  setUpdateBusy(true);
  showUpdatePanel({ status: 'checking', current: updateUi.payload?.current }, { focus: true });
  try {
    const result = await window.markl.checkUpdate();
    showUpdatePanel(result || { status: 'error', message: '更新信息无法解析。' }, { focus: true });
  } catch (error) {
    showUpdatePanel({ status: 'error', message: error?.message || String(error) }, { focus: true });
  } finally {
    setUpdateBusy(false);
  }
}

elements.checkUpdateButton.addEventListener('click', () => {
  runManualUpdateCheck();
});
elements.updateClose.addEventListener('click', () => {
  closeUpdatePanel({ dismiss: updateUi.status === 'available' });
});
elements.updateLater.addEventListener('click', () => {
  closeUpdatePanel({ dismiss: true });
});
elements.updateOk.addEventListener('click', () => {
  closeUpdatePanel();
});
elements.updateRetry.addEventListener('click', () => {
  runManualUpdateCheck();
});
elements.updateDownload.addEventListener('click', () => {
  const data = updateUi.payload || {};
  openUpdateLink(data.portable?.url || data.url);
});
elements.updateSetup.addEventListener('click', () => {
  openUpdateLink(updateUi.payload?.setup?.url);
});
elements.updateRelease.addEventListener('click', () => {
  openUpdateLink(updateUi.payload?.url);
});
document.getElementById('sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('status-sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
elements.modeLabel.addEventListener('click', toggleMode);
elements.sourceEditor.addEventListener('input', () => {
  recomputeDirty();
  scheduleFindRefresh();
});
elements.sourceEditor.addEventListener('scroll', () => {
  scheduleOutlineActive();
});

elements.findInput.addEventListener('input', (event) => {
  if (event.isComposing) return;
  refreshFindMatches({ reset: true, reveal: true });
});
elements.findInput.addEventListener('compositionend', () => {
  refreshFindMatches({ reset: true, reveal: true });
});
elements.findInput.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    findStep(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFindBar();
  }
});
elements.replaceInput.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.altKey) {
    event.preventDefault();
    replaceCurrentMatch();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    findStep(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFindBar();
  }
});
elements.findCase.addEventListener('click', () => {
  findState.caseSensitive = !findState.caseSensitive;
  elements.findCase.classList.toggle('is-active', findState.caseSensitive);
  elements.findCase.setAttribute('aria-pressed', String(findState.caseSensitive));
  if (findState.open) refreshFindMatches({ stay: true });
  if (state.sidebarTab === 'search') runWorkspaceSearch().catch(() => {});
});
elements.findWord?.addEventListener('click', () => {
  findState.wholeWord = !findState.wholeWord;
  elements.findWord.classList.toggle('is-active', findState.wholeWord);
  elements.findWord.setAttribute('aria-pressed', String(findState.wholeWord));
  if (findState.open) refreshFindMatches({ stay: true });
  if (state.sidebarTab === 'search') runWorkspaceSearch().catch(() => {});
});
elements.findRegex?.addEventListener('click', () => {
  findState.regex = !findState.regex;
  elements.findRegex.classList.toggle('is-active', findState.regex);
  elements.findRegex.setAttribute('aria-pressed', String(findState.regex));
  if (findState.open) refreshFindMatches({ stay: true });
  if (state.sidebarTab === 'search') runWorkspaceSearch().catch(() => {});
});
elements.findPrev.addEventListener('click', () => findStep(-1));
elements.findNext.addEventListener('click', () => findStep(1));
elements.findToggleReplace.addEventListener('click', () => {
  setReplaceOpen(!findState.replaceOpen);
  if (findState.replaceOpen) elements.replaceInput.focus();
});
elements.findClose.addEventListener('click', closeFindBar);
elements.workspaceReplaceAll?.addEventListener('click', () => {
  replaceInWorkspace().catch((error) => showOperationError('文件夹替换', error));
});
elements.revisionClose?.addEventListener('click', () => concealLayer(elements.revisionPanel));
elements.assetClose?.addEventListener('click', () => concealLayer(elements.assetPanel));
elements.quickOpenInput.addEventListener('input', () => {
  quickOpen.selected = 0;
  refreshQuickOpenItems();
});
elements.quickOpenInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveQuickOpenSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveQuickOpenSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    openQuickOpenItem(quickOpen.selected);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeQuickOpen();
  }
});
elements.replaceOne.addEventListener('click', replaceCurrentMatch);
elements.replaceAll.addEventListener('click', replaceAllCurrent);
elements.languageQueryInput.addEventListener('input', () => {
  state.popup.query = elements.languageQueryInput.value;
  state.popup.items = filteredLanguages(state.popup.query);
  state.popup.selected = 0;
  renderLanguagePopup();
});
elements.languageQueryInput.addEventListener('keydown', (event) => {
  handlePopupKeydown(event);
});
document.getElementById('editor').addEventListener('click', (event) => {
  const href = hrefFromEditorEvent(event);
  if (href) {
    event.preventDefault();
    event.stopPropagation();
    handleEditorLink(href);
    return;
  }
  const cell = event.target.closest('td, th');
  if (cell) showTableToolbar(cell);
  else if (!event.target.closest('.table-toolbar')) hideTableToolbar();
  window.setTimeout(() => repairEditorCaret(), 0);
}, true);

document.getElementById('editor').addEventListener('keyup', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || state.sourceMode || state.popup.visible) return;
  if (performance.now() < (state.popup.suppressUntil || 0)) return;
  const info = document.querySelector('.vditor-ir__node--expand [data-type="code-block-info"]');
  if (!info) return;
  const lang = (info.textContent || '').replace(/[\u200b\u00a0]/g, '').trim();
  if (!lang) openLanguagePopup('');
});

document.addEventListener('selectionchange', () => {
  scheduleOutlineActive();
  if (state.sourceMode) return;
  scheduleCodeHighlight();
  scheduleTableToolbar();
});

elements.editorWrap.addEventListener('scroll', () => {
  closeFormatMenu();
  updateLiveHighlight();
  scheduleOutlineActive();
  if (tableUi.table?.isConnected) positionTableToolbar(tableUi.table);
  else scheduleTableToolbar();
}, true);

elements.editorWrap.addEventListener('contextmenu', (event) => {
  openFormatMenu(event);
});

elements.formatMenu?.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

elements.formatMenu?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-format]');
  if (!button) return;
  event.preventDefault();
  handleFormatAction(button.dataset.format);
});

elements.editorWrap.addEventListener('mousedown', (event) => {
  if (state.popup.visible && !event.target.closest('.language-popup')) {
    closeLanguagePopup({ restoreFocus: false });
  }
  if (event.target.closest('.language-popup, .table-toolbar, .find-bar, .update-panel, #quick-open, #app-dialog, textarea, button, input')) return;
  releaseComposingLock();
  if (event.target.closest('.vditor-ir')) return;
  focusEditor();
});

elements.tableToolbar.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

elements.tableToolbar.addEventListener('click', (event) => {
  const sizeCell = event.target.closest('.table-size-cell');
  if (sizeCell) {
    event.preventDefault();
    resizeTable(Number(sizeCell.dataset.col), Number(sizeCell.dataset.row));
    return;
  }
  const button = event.target.closest('[data-table-action]');
  if (!button) return;
  event.preventDefault();
  handleTableToolbarAction(button.dataset.tableAction);
});

elements.tableSizeGrid.addEventListener('mouseover', (event) => {
  const cell = event.target.closest('.table-size-cell');
  if (!cell) return;
  tableUi.hoverCols = Number(cell.dataset.col);
  tableUi.hoverRows = Number(cell.dataset.row);
  renderTableSizePicker();
});

elements.tableSizeGrid.addEventListener('mouseleave', () => {
  tableUi.hoverCols = 0;
  tableUi.hoverRows = 0;
  renderTableSizePicker();
});

async function showAboutDialog() {
  let version = '';
  try {
    version = await window.markl.getVersion();
  } catch {
    version = '';
  }
  showAppDialog({
    title: version ? `MarkL ${version}` : 'MarkL',
    message: '面向中文用户的轻量 Markdown 编辑器。支持目录管理、即时渲染和代码高亮。',
    ok: '知道了'
  });
}

const APP_MENU_ORDER = ['file', 'edit', 'view', 'theme', 'font', 'help'];
let appMenuOpen = '';
let appMenuIndex = 0;
let appMenuDev = false;

function appMenuItems(id) {
  const theme = state.appearance.theme;
  const font = state.appearance.font;
  const size = state.appearance.fontSize;
  if (id === 'file') {
    return [
      { label: '新建文档', accel: 'Ctrl+N', action: 'new' },
      { label: '从模板新建…', action: 'new-template' },
      { label: '打开文件…', accel: 'Ctrl+O', action: 'open' },
      { label: '打开文件夹…', accel: 'Ctrl+Shift+O', action: 'open-folder' },
      { label: '快速打开…', accel: 'Ctrl+P', action: 'quick-open' },
      { type: 'sep' },
      { label: '保存', accel: 'Ctrl+S', action: 'save' },
      { label: '另存为…', accel: 'Ctrl+Shift+S', action: 'save-as' },
      { type: 'sep' },
      { label: '导出 HTML…', action: 'export-html' },
      { label: '导出 PDF…', action: 'export-pdf' },
      { label: '打印…', accel: 'Ctrl+Shift+P', action: 'print' },
      { type: 'sep' },
      { label: '本地历史…', action: 'revisions' },
      { type: 'sep' },
      { label: '退出 MarkL', action: 'quit' }
    ];
  }
  if (id === 'edit') {
    return [
      { label: '撤销', accel: 'Ctrl+Z', action: 'undo' },
      { label: '重做', accel: 'Ctrl+Y', action: 'redo' },
      { type: 'sep' },
      { label: '剪切', accel: 'Ctrl+X', action: 'cut' },
      { label: '复制', accel: 'Ctrl+C', action: 'copy' },
      { label: '粘贴', accel: 'Ctrl+V', action: 'paste' },
      { label: '删除', action: 'delete' },
      { type: 'sep' },
      { label: '全选', accel: 'Ctrl+A', action: 'select-all' },
      { type: 'sep' },
      { label: '查找', accel: 'Ctrl+F', action: 'find' },
      { label: '替换', accel: 'Ctrl+H', action: 'replace' },
      { label: '在文件夹中查找', accel: 'Ctrl+Shift+F', action: 'workspace-search' },
      { type: 'sep' },
      { label: '格式化代码块', accel: 'Ctrl+Alt+L', action: 'format' },
      { label: '整理中文排版', accel: 'Ctrl+Shift+L', action: 'typeset' },
      { type: 'sep' },
      { label: '插入已有图片…', action: 'insert-asset' },
      { label: '清理未使用图片…', action: 'clean-images' }
    ];
  }
  if (id === 'view') {
    const items = [
      { label: '切换即时渲染 / 源码', accel: 'Ctrl+/', action: 'toggle-mode' },
      { label: '显示/隐藏目录栏', accel: 'Ctrl+B', action: 'toggle-sidebar' },
      { type: 'sep' },
      { label: '重新加载', action: 'reload' },
      { label: '实际大小', action: 'zoom-reset' },
      { label: '放大', action: 'zoom-in' },
      { label: '缩小', action: 'zoom-out' },
      { type: 'sep' },
      { label: '切换全屏', action: 'fullscreen' }
    ];
    if (appMenuDev) items.push({ type: 'sep' }, { label: '开发者工具', action: 'devtools' });
    return items;
  }
  if (id === 'theme') {
    return THEME_IDS.map((id) => ({
      label: THEME_LABELS[id],
      action: 'theme',
      value: id,
      checked: theme === id,
      swatch: THEME_SWATCHES[id]
    }));
  }
  if (id === 'font') {
    return [
      { label: '默认', action: 'font', value: 'default', checked: font === 'default' },
      { label: '微软雅黑', action: 'font', value: 'yahei', checked: font === 'yahei' },
      { label: '宋体', action: 'font', value: 'song', checked: font === 'song' },
      { label: '楷体', action: 'font', value: 'kai', checked: font === 'kai' },
      { label: '仿宋', action: 'font', value: 'fangsong', checked: font === 'fangsong' },
      { label: '黑体', action: 'font', value: 'hei', checked: font === 'hei' },
      { label: '等线', action: 'font', value: 'deng', checked: font === 'deng' },
      { type: 'sep' },
      { label: '较小', action: 'font-size', value: 'small', checked: size === 'small' },
      { label: '标准', action: 'font-size', value: 'medium', checked: size === 'medium' },
      { label: '较大', action: 'font-size', value: 'large', checked: size === 'large' },
      { label: '更大', action: 'font-size', value: 'xlarge', checked: size === 'xlarge' }
    ];
  }
  return [
    { label: '检查更新…', action: 'check-update' },
    { type: 'sep' },
    { label: '官网', action: 'website' },
    { label: 'GitHub 仓库', action: 'github' },
    { type: 'sep' },
    { label: '关于 MarkL', action: 'about' }
  ];
}

function runAppMenuAction(action, value) {
  closeAppMenu();
  const run = {
    new: doNew,
    open: doOpen,
    'open-folder': doOpenFolder,
    'quick-open': openQuickOpen,
    save: doSave,
    'save-as': doSaveAs,
    'export-html': doExportHtml,
    'export-pdf': doExportPdf,
    'new-template': openTemplateMenu,
    revisions: openRevisionPanel,
    typeset: typesetCurrentDocument,
    'insert-asset': openAssetPanel,
    'clean-images': cleanUnusedImages,
    print: () => (window.markl.printDocument ? window.markl.printDocument().catch(() => window.print()) : window.print()),
    quit: () => window.markl.tryClose?.(),
    undo: () => document.execCommand('undo'),
    redo: () => document.execCommand('redo'),
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: () => document.execCommand('paste'),
    delete: () => document.execCommand('delete'),
    'select-all': () => document.execCommand('selectAll'),
    find: () => openFindBar({ replace: false }),
    replace: () => openFindBar({ replace: true }),
    'workspace-search': openWorkspaceSearch,
    format: formatActiveCode,
    'toggle-mode': toggleMode,
    'toggle-sidebar': () => toggleSidebar(),
    reload: () => window.markl.reloadWindow?.(),
    'zoom-reset': () => window.markl.zoom?.('reset'),
    'zoom-in': () => window.markl.zoom?.('in'),
    'zoom-out': () => window.markl.zoom?.('out'),
    fullscreen: () => window.markl.toggleFullScreen?.(),
    devtools: () => window.markl.toggleDevTools?.(),
    theme: () => setAppearance({ theme: value }),
    font: () => setAppearance({ font: value }),
    'font-size': () => setAppearance({ fontSize: value }),
    'check-update': runManualUpdateCheck,
    website: () => window.markl.openExternal('https://lcodecoder.github.io/markL/'),
    github: () => window.markl.openExternal('https://github.com/LcodeCoder/markL'),
    about: showAboutDialog
  };
  run[action]?.();
}

function selectableAppMenuItems(id) {
  return appMenuItems(id).filter((item) => item.type !== 'sep');
}

function renderAppMenuDropdown(id) {
  const menu = elements.appMenuDropdown;
  if (!menu) return;
  const items = appMenuItems(id);
  menu.replaceChildren();
  items.forEach((item) => {
    if (item.type === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'app-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-menu-option';
    button.role = 'menuitem';
    if (item.checked) button.classList.add('is-checked');
    const main = document.createElement('span');
    main.className = 'app-menu-option-main';
    const check = document.createElement('span');
    check.className = 'app-menu-check';
    check.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M3.4 8.2 6.5 11.2 12.6 4.8"/></svg>';
    if (item.swatch) {
      const swatch = document.createElement('span');
      swatch.className = 'app-menu-swatch';
      swatch.style.background = item.swatch;
      main.append(check, swatch);
    } else {
      main.append(check);
    }
    const label = document.createElement('span');
    label.className = 'app-menu-label';
    label.textContent = item.label;
    main.append(label);
    button.append(main);
    if (item.accel) {
      const accel = document.createElement('span');
      accel.className = 'app-menu-accel';
      accel.textContent = item.accel;
      button.append(accel);
    }
    button.addEventListener('mouseenter', () => {
      const selectable = selectableAppMenuItems(id);
      appMenuIndex = Math.max(0, selectable.findIndex((entry) => entry.label === item.label && entry.action === item.action));
      highlightAppMenuOption();
    });
    button.addEventListener('click', () => runAppMenuAction(item.action, item.value));
    menu.appendChild(button);
  });
  highlightAppMenuOption();
}

function highlightAppMenuOption() {
  const options = [...(elements.appMenuDropdown?.querySelectorAll('.app-menu-option') || [])];
  options.forEach((option, index) => option.classList.toggle('is-active', index === appMenuIndex));
  options[appMenuIndex]?.scrollIntoView({ block: 'nearest' });
}

function positionAppMenu(id) {
  const tab = elements.appMenubar?.querySelector(`[data-menu="${id}"]`);
  const menu = elements.appMenuDropdown;
  if (!tab || !menu) return;
  const rect = tab.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.left)}px`;
  const width = menu.offsetWidth || 228;
  if (rect.left + width > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - width - 8)}px`;
  }
}

function closeAppMenu() {
  if (!appMenuOpen) return;
  appMenuOpen = '';
  appMenuIndex = 0;
  elements.appMenubar?.querySelectorAll('.app-menu-tab').forEach((tab) => {
    tab.classList.remove('is-open');
    tab.setAttribute('aria-expanded', 'false');
  });
  concealLayer(elements.appMenuDropdown);
}

function openAppMenu(id) {
  if (!elements.appMenuDropdown) return;
  appMenuOpen = id;
  appMenuIndex = 0;
  elements.appMenubar?.querySelectorAll('.app-menu-tab').forEach((tab) => {
    const on = tab.dataset.menu === id;
    tab.classList.toggle('is-open', on);
    tab.setAttribute('aria-expanded', String(on));
  });
  renderAppMenuDropdown(id);
  revealLayer(elements.appMenuDropdown);
  positionAppMenu(id);
}

function toggleAppMenu(id) {
  if (appMenuOpen === id) closeAppMenu();
  else openAppMenu(id);
}

function syncAppMenuChecks() {
  if (appMenuOpen === 'theme' || appMenuOpen === 'font') {
    renderAppMenuDropdown(appMenuOpen);
    positionAppMenu(appMenuOpen);
  }
}

function handleAppMenuKey(event) {
  if (!appMenuOpen) return false;
  if (event.ctrlKey || event.metaKey) {
    closeAppMenu();
    return false;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAppMenu();
    return true;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const at = APP_MENU_ORDER.indexOf(appMenuOpen);
    const next = event.key === 'ArrowRight'
      ? APP_MENU_ORDER[(at + 1) % APP_MENU_ORDER.length]
      : APP_MENU_ORDER[(at + APP_MENU_ORDER.length - 1) % APP_MENU_ORDER.length];
    openAppMenu(next);
    return true;
  }
  const selectable = selectableAppMenuItems(appMenuOpen);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    appMenuIndex = (appMenuIndex + 1) % selectable.length;
    highlightAppMenuOption();
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    appMenuIndex = (appMenuIndex + selectable.length - 1) % selectable.length;
    highlightAppMenuOption();
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const item = selectable[appMenuIndex];
    if (item) runAppMenuAction(item.action, item.value);
    return true;
  }
  return false;
}

let altMenuArmed = false;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey) altMenuArmed = true;
  else altMenuArmed = false;
}, true);
document.addEventListener('keyup', (event) => {
  if (event.key === 'Control' || event.key === 'Meta') commitRecentSwitcher();
  if (event.key !== 'Alt') return;
  if (!altMenuArmed) return;
  altMenuArmed = false;
  event.preventDefault();
  if (appMenuOpen) closeAppMenu();
  else openAppMenu('file');
});

elements.appMenubar?.addEventListener('click', (event) => {
  const tab = event.target.closest('.app-menu-tab');
  if (!tab) return;
  event.preventDefault();
  toggleAppMenu(tab.dataset.menu);
});

elements.appMenubar?.addEventListener('mousemove', (event) => {
  if (!appMenuOpen) return;
  const tab = event.target.closest('.app-menu-tab');
  if (tab?.dataset.menu && tab.dataset.menu !== appMenuOpen) openAppMenu(tab.dataset.menu);
});

window.markl.on('file:opened', async ({ filePath, content }) => {
  launchHandled = true;
  if (await confirmDiscardIfDirty()) loadContent(filePath, content);
});
window.markl.on('menu:new', doNew);
window.markl.on('menu:open', doOpen);
window.markl.on('menu:open-folder', doOpenFolder);
window.markl.on('menu:save', doSave);
window.markl.on('menu:save-as', doSaveAs);
window.markl.on('menu:export-html', doExportHtml);
window.markl.on('menu:export-pdf', doExportPdf);
window.markl.on('menu:new-template', openTemplateMenu);
window.markl.on('menu:revisions', openRevisionPanel);
window.markl.on('menu:typeset', typesetCurrentDocument);
window.markl.on('menu:insert-asset', openAssetPanel);
window.markl.on('menu:clean-images', cleanUnusedImages);
window.markl.on('menu:print', () => {
  if (window.markl.printDocument) window.markl.printDocument().catch(() => window.print());
  else window.print();
});
window.markl.on('menu:toggle-mode', toggleMode);
window.markl.on('menu:toggle-sidebar', () => toggleSidebar());
window.markl.on('menu:theme', (theme) => setAppearance({ theme }));
window.markl.on('menu:font', (font) => setAppearance({ font }));
window.markl.on('menu:font-size', (fontSize) => setAppearance({ fontSize }));
window.markl.on('menu:format', formatActiveCode);
window.markl.on('menu:find', () => openFindBar({ replace: false }));
window.markl.on('menu:replace', () => openFindBar({ replace: true }));
window.markl.on('menu:workspace-search', () => openWorkspaceSearch());
window.markl.on('menu:check-update', () => runManualUpdateCheck());
window.markl.on('menu:quick-open', () => openQuickOpen());
window.markl.on('menu:about', () => {
  showAboutDialog();
});
window.markl.on('fs:change', (payload) => handleFsChange(payload));
window.markl.on('update:available', (payload) => {
  if (updateUi.open && updateUi.status !== 'checking') return;
  showUpdatePanel(payload, { focus: false });
});
window.markl.on('app:before-close', async () => {
  if (state.filePath) rememberCaret(state.filePath);
  persistSessionNow();
  await persistDraftNow();
  if (await confirmDiscardIfDirty()) window.markl.doClose();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('#app-menubar, #app-menu-dropdown')) closeAppMenu();
  if (!event.target.closest('.format-menu')) closeFormatMenu();
  if (state.sourceMode) return;
  scheduleCodeHighlight();
  if (!event.target.closest('.table-toolbar')) closeTableMenus();
});

document.addEventListener('compositionstart', () => {
  editorComposing = true;
  setCodeIme(true);
}, true);

document.addEventListener('compositionend', () => {
  editorComposing = false;
  const ir = irController();
  if (ir) ir.composingLock = false;
  setCodeIme(false);
  scheduleCodeHighlight();
}, true);

document.addEventListener('compositioncancel', () => {
  releaseComposingLock();
  setCodeIme(false);
  scheduleCodeHighlight();
}, true);

document.addEventListener('keydown', (event) => {
  if (handleAppMenuKey(event)) return;
  if (isAppDialogOpen()) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAppDialog(false);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      closeAppDialog(true);
    }
    return;
  }
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    cycleRecentFile(event.shiftKey);
    return;
  }
  if (modifier && event.shiftKey && key === 'l' && !event.altKey) {
    event.preventDefault();
    typesetCurrentDocument();
    return;
  }
  if (modifier && key === 's') {
    event.preventDefault();
    if (event.shiftKey) doSaveAs();
    else doSave();
    return;
  }
  if (modifier && key === 'p') {
    event.preventDefault();
    openQuickOpen();
    return;
  }
  if (modifier && key === 'f') {
    event.preventDefault();
    if (event.shiftKey) openWorkspaceSearch();
    else openFindBar({ replace: false });
    return;
  }
  if (modifier && key === 'h') {
    event.preventDefault();
    openFindBar({ replace: true });
    return;
  }
  if (event.key === 'F3') {
    event.preventDefault();
    findStep(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.ctrlKey && event.altKey && key === 'l') {
    event.preventDefault();
    formatActiveCode();
    return;
  }
  if (event.key === 'Escape' && quickOpen.open) {
    event.preventDefault();
    closeQuickOpen();
    return;
  }
  if (event.key === 'Escape' && formatMenuUi.open) {
    event.preventDefault();
    closeFormatMenu();
    return;
  }
  if (event.key === 'Escape' && tableUi.menu) {
    event.preventDefault();
    closeTableMenus();
    return;
  }
  if (event.key === 'Escape' && findState.open && !state.popup.visible) {
    event.preventDefault();
    closeFindBar();
    return;
  }
  if (event.key === 'Escape' && updateUi.open && !event.target.closest('#find-bar')) {
    event.preventDefault();
    closeUpdatePanel({ dismiss: updateUi.status === 'available' });
  }
  if (event.key === 'Escape' && elements.revisionPanel && !elements.revisionPanel.classList.contains('hidden')) {
    event.preventDefault();
    concealLayer(elements.revisionPanel);
  }
  if (event.key === 'Escape' && elements.assetPanel && !elements.assetPanel.classList.contains('hidden')) {
    event.preventDefault();
    concealLayer(elements.assetPanel);
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (state.sourceMode || state.popup.visible || event.isComposing) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.activeElement?.closest?.('.tree-draft-row, #find-bar, #update-panel, #quick-open, #app-dialog')) return;
  const ir = getIrElement();
  if (!ir) return;

  const active = document.activeElement;
  const liveControl = active?.closest?.('input, textarea, button, [contenteditable="true"]');
  if (liveControl && !isDeadFocusTarget(active) && active !== ir && !ir.contains(active)) return;

  const host = selectionHost();
  const focusDead = isDeadFocusTarget(active) || (active !== ir && !ir.contains(active));
  const caretBad = Boolean(host && ir.contains(host) && isUnusableCaretHost(host));
  if (!focusDead && !caretBad) return;

  const isChar = event.key.length === 1;
  const isEdit = event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter';
  if (!isChar && !isEdit) return;

  repairEditorCaret({ forceFocus: true, ignorePopup: true });
  if (isChar) {
    event.preventDefault();
    document.execCommand('insertText', false, event.key);
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    document.execCommand('delete');
  } else if (event.key === 'Delete') {
    event.preventDefault();
    document.execCommand('forwardDelete');
  } else if (event.key === 'Enter') {
    event.preventDefault();
    document.execCommand('insertParagraph');
  }
}, true);

window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 821px)').matches) document.body.classList.remove('sidebar-open');
  if (state.popup.visible) positionLanguagePopup();
  scheduleTableBalance();
  updateLiveHighlight();
  if (tableUi.table?.isConnected) positionTableToolbar(tableUi.table);
});

elements.clearHistoryButton.addEventListener('click', async () => {
  if (!readHistory().length) return;
  const ok = await showAppDialog({
    title: '清空打开历史',
    message: '确定清空全部打开历史？',
    ok: '清空',
    cancel: '取消',
    danger: true
  });
  if (!ok) return;
  writeHistory([]);
  renderHistory();
});
elements.historyToggle?.addEventListener('click', () => {
  setHistoryExpanded(!isHistoryExpanded());
});
elements.appDialogOk?.addEventListener('click', () => closeAppDialog(true));
elements.appDialogCancel?.addEventListener('click', () => closeAppDialog(false));
elements.appDialogBackdrop?.addEventListener('click', () => closeAppDialog(false));

function transferLooksLikeFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = [...(dataTransfer.types || [])];
  return types.includes('Files') || types.includes('application/x-moz-file');
}

document.addEventListener('paste', async (event) => {
  const files = imageFilesFromDataTransfer(event.clipboardData);
  if (!files.length) return;
  const target = event.target;
  if (target?.closest?.('#find-bar, #update-panel, #quick-open, #app-dialog, .tree-draft-row') || (target?.closest?.('input, textarea') && target !== elements.sourceEditor)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  await insertImageFiles(files);
}, true);

window.addEventListener('dragover', (event) => {
  if (!transferLooksLikeFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

elements.editorWrap.addEventListener('dragenter', (event) => {
  if (!transferLooksLikeFiles(event.dataTransfer)) return;
  event.preventDefault();
  setDropActive(true);
});

elements.editorWrap.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && elements.editorWrap.contains(event.relatedTarget)) return;
  setDropActive(false);
});

elements.editorWrap.addEventListener('drop', async (event) => {
  event.preventDefault();
  setDropActive(false);
  const files = filesFromDataTransfer(event.dataTransfer);
  const documentFile = files.find(isDocumentFile);
  if (documentFile) {
    await openDroppedDocument(documentFile);
    return;
  }
  const images = files.filter(isImageFile);
  if (images.length) await insertImageFiles(images);
});

window.addEventListener('drop', async (event) => {
  setDropActive(false);
  const files = filesFromDataTransfer(event.dataTransfer);
  if (!files.length && !transferLooksLikeFiles(event.dataTransfer)) return;
  event.preventDefault();
  if (event.target.closest?.('#editor-wrap')) return;
  const documentFile = files.find(isDocumentFile);
  if (documentFile) await openDroppedDocument(documentFile);
});

window.addEventListener('dragend', () => setDropActive(false));

function setupSidebarResize() {
  const handle = document.getElementById('sidebar-resizer');
  if (!handle) return;

  const startResize = (clientX) => {
    if (window.matchMedia('(max-width: 820px)').matches) return;
    if (document.body.classList.contains('sidebar-hidden')) return;
    const origin = clientX;
    const startWidth = getSidebarWidth();
    document.body.classList.add('is-resizing-sidebar');

    const onMove = (event) => {
      applySidebarWidth(startWidth + (event.clientX - origin));
      scheduleTableBalance();
    };
    const onUp = () => {
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistSession();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startResize(event.clientX);
  });
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    applySidebarWidth(getSidebarWidth() + (event.key === 'ArrowRight' ? 16 : -16));
    persistSession();
    scheduleTableBalance();
  });
}

applySessionChrome();
setupSidebarResize();
applyAppearance(readStoredAppearance());
persistAppearance();
updateTitle();
updateCounts();
updateFindCount();
renderFileTree();
renderHistory();
setSidebarTab(localStorage.getItem(SIDEBAR_TAB_KEY) || 'files');
createVditor();
