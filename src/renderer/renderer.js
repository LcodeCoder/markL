import {
  FIND_MATCH_LIMIT,
  collectMatches,
  replaceRange,
  replaceAllMatches,
  lineNumberAt,
  visibleLineHint,
  toMarkdownImage,
  rewriteFileUrls,
  imageAltFromName
} from './text-search.js';

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
  { id: 'text', label: '纯文本', aliases: ['plaintext', 'txt'], description: '不使用语法高亮' }
];

const LANGUAGE_ALIASES = {
  js: 'javascript', node: 'javascript', ts: 'typescript', py: 'python',
  markup: 'html', xml: 'html', shell: 'bash', sh: 'bash', 'c++': 'cpp',
  cs: 'csharp', 'c#': 'csharp', golang: 'go', rs: 'rust', md: 'markdown',
  plaintext: 'text', txt: 'text'
};

const VDITOR_CDN = new URL('../../node_modules/vditor', import.meta.url).href;
const CONTENT_THEME_PATH = new URL('../../node_modules/vditor/dist/css/content-theme', import.meta.url).href;
const HISTORY_KEY = 'markl-open-history';
const HISTORY_LIMIT = 16;
const SIDEBAR_TAB_KEY = 'markl-sidebar-tab';
const SESSION_KEY = 'markl-session';
const APPEARANCE_KEY = 'markl-appearance';
const THEME_IDS = ['light', 'dark', 'sepia'];
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
const GITHUB_REPO_URL = 'https://github.com/LcodeCoder/markL';
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

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
  appearance: { theme: 'light', font: 'default', fontSize: 'medium' }
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
  filesPanel: document.getElementById('files-panel'),
  outlinePanel: document.getElementById('outline-panel'),
  tabFiles: document.getElementById('tab-files'),
  tabOutline: document.getElementById('tab-outline'),
  workspaceHeading: document.getElementById('workspace-heading'),
  workspaceName: document.getElementById('workspace-name'),
  workspacePath: document.getElementById('workspace-path'),
  refreshTreeButton: document.getElementById('refresh-tree-button'),
  newTreeButton: document.getElementById('new-tree-button'),
  sidebar: document.getElementById('sidebar'),
  githubLink: document.getElementById('github-link'),
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
  dropMask: document.getElementById('drop-mask')
};

function normalizeMarkdown(content = '') {
  return content.replace(/<\/?cener(\s[^>]*)?>/gi, (tag) => tag.replace(/cener/i, 'center'));
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
  if (el.closest('.markl-live-hl, .language-popup, .table-toolbar, .find-bar, #source-editor')) return true;
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

function parentDisplay(filePath) {
  const parent = directoryName(filePath);
  return parent === '新文档' ? '' : parent;
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
    const name = document.createElement('span');
    name.className = 'history-name';
    name.textContent = item.name || baseName(item.path);
    const pathLine = document.createElement('span');
    pathLine.className = 'history-path';
    pathLine.textContent = parentDisplay(item.path) || item.path;
    copy.append(name, pathLine);

    openButton.append(item.kind === 'folder' ? folderIcon() : fileIcon(), copy);
    openButton.addEventListener('click', () => openHistoryItem(item));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-remove';
    remove.title = '从历史中移除';
    remove.setAttribute('aria-label', `从历史中移除 ${item.name || baseName(item.path)}`);
    remove.textContent = '×';
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
  elements.docTitle.textContent = name;
  elements.docPath.textContent = directoryName(state.filePath);
  elements.dirtyDot.classList.toggle('hidden', !state.dirty);
  elements.saveStatus.textContent = state.dirty ? '尚未保存' : '已保存';
  elements.saveStatus.classList.toggle('is-dirty', state.dirty);
  window.markl.setTitle(`${state.dirty ? '● ' : ''}${name} — MarkL`);
  updateActiveTreeItem();
}

function updateCounts() {
  const markdown = getMarkdown() || '';
  const text = markdown.replace(/\n+$/, '');
  const characters = Array.from(text).length;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latinWords = (text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['_-][A-Za-z0-9]+)*/g) || []).length;
  elements.counts.textContent = `${cjk + latinWords} 字 · ${characters} 字符`;
}

function markClean(content) {
  state.savedContent = content;
  state.dirty = false;
  updateTitle();
}

function recomputeDirty() {
  const dirty = getMarkdown() !== state.savedContent;
  if (dirty !== state.dirty) {
    state.dirty = dirty;
    updateTitle();
  }
  updateCounts();
  scheduleOutlineRefresh();
}

function loadContent(filePath, content) {
  state.filePath = filePath;
  const normalized = normalizeMarkdown(content);
  setMarkdown(normalized, true);
  markClean(normalized);
  updateCounts();
  renderHeadingTree();
  if (filePath) rememberOpen('file', filePath);
  expandAncestors(filePath, state.workspaceRoot);
  updateActiveTreeItem();
  scheduleImageResolve();
  refreshFindMatches({ stay: true });
  persistSession();
  restoreEditorFocus();
}

async function confirmDiscardIfDirty() {
  if (!state.dirty) return true;
  const ok = window.confirm(
    `“${baseName(state.filePath)}”还有未保存的更改。\n\n确定：放弃更改\n取消：继续编辑`
  );
  restoreEditorFocus();
  return ok;
}

function showOperationError(action, error) {
  console.error(action, error);
  window.alert(`${action}失败：\n${error?.message || error}`);
  restoreEditorFocus();
}

async function doNew() {
  if (!(await confirmDiscardIfDirty())) return;
  state.filePath = null;
  setMarkdown('', true);
  markClean('');
  updateCounts();
  renderHeadingTree();
  updateActiveTreeItem();
  refreshFindMatches({ stay: false });
  persistSession();
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

async function doSave() {
  try {
    if (!state.filePath) return doSaveAs();
    const content = getMarkdown();
    await window.markl.writeFile({ filePath: state.filePath, content });
    markClean(content);
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
    await window.markl.writeFile({ filePath: target, content });
    state.filePath = target;
    markClean(content);
    rememberOpen('file', target);
    if (isPathInside(target, state.workspaceRoot)) await refreshWorkspace();
    scheduleImageResolve();
    persistSession();
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
    const body = getHTML();
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body{max-width:760px;margin:48px auto;padding:0 24px 80px;font-family:"Microsoft YaHei UI","PingFang SC",sans-serif;line-height:1.8;color:#1a1f27;overflow-wrap:anywhere}
pre{background:#eef1f5;padding:16px 16px 28px;border-radius:8px;overflow:auto;position:relative}code{font-family:"Cascadia Code",Consolas,monospace}pre code{background:none;padding:0}
blockquote{color:#5c6674;border-left:3px solid #d5dbe3;margin-left:0;padding-left:16px}
table{width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;word-break:break-word}th,td{border:1px solid #d5dbe3;padding:7px 12px;white-space:normal;overflow-wrap:break-word;word-break:break-word;vertical-align:top}img{max-width:100%}center{text-align:center}
</style>
</head>
<body>
${body}
</body>
</html>`;
    await window.markl.writeFile({ filePath: target, content: fullHtml });
  } catch (error) {
    showOperationError('导出 HTML', error);
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
    ? '<svg class="tree-chevron-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06Z"/></svg>'
    : '<svg class="tree-chevron-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M6.2 4.2a.75.75 0 0 1 1.06 0l3.27 3.27a.75.75 0 0 1 0 1.06L7.26 11.8a.75.75 0 1 1-1.06-1.06L8.94 8 6.2 5.26a.75.75 0 0 1 0-1.06Z"/></svg>');
}

function folderIcon() {
  return svgNode('<svg class="tree-type-icon is-folder" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2.25 4.25A1.75 1.75 0 0 1 4 2.5h2.2c.3 0 .58.12.78.34L8.1 4h3.9A1.75 1.75 0 0 1 13.75 5.75v5.5A1.75 1.75 0 0 1 12 13H4A1.75 1.75 0 0 1 2.25 11.25v-7Z"/></svg>');
}

function fileIcon() {
  return svgNode('<svg class="tree-type-icon is-file" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4.25 1.75h5.1L12.75 5.2v8.05A1.5 1.5 0 0 1 11.25 14.75h-7A1.5 1.5 0 0 1 2.75 13.25v-10A1.5 1.5 0 0 1 4.25 1.75Zm4.6.7v2.9h2.85Z"/></svg>');
}

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
    row.append(chevron, folderIcon(), name);
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

function cleanHeadingText(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHeadingOutline(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const items = [];
  const seen = new Map();
  let inFence = false;
  let fenceChar = '';
  let start = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) start = end + 1;
  }

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = mark;
      } else if (mark === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) continue;

    const atx = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (atx) {
      const text = cleanHeadingText(atx[2].replace(/\s+#+\s*$/, ''));
      if (!text) continue;
      const occurrence = seen.get(text) || 0;
      seen.set(text, occurrence + 1);
      items.push({ level: atx[1].length, text, line: index, occurrence });
      continue;
    }

    const next = lines[index + 1];
    if (!line.trim() || line.startsWith('    ') || !next) continue;
    const setext = next.match(/^(=+|-+)\s*$/);
    if (!setext || /^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) continue;
    const text = cleanHeadingText(line);
    if (!text) continue;
    const occurrence = seen.get(text) || 0;
    seen.set(text, occurrence + 1);
    items.push({ level: setext[1].startsWith('=') ? 1 : 2, text, line: index, occurrence });
  }

  return items;
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

function headingIcon() {
  return svgNode('<svg class="tree-type-icon is-file" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2.5 3.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1 0-1.5Zm0 3.5h8a.75.75 0 0 1 0 1.5h-8a.75.75 0 0 1 0-1.5Zm0 3.5h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1 0-1.5Z"/></svg>');
}

function visibleHeadingText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.vditor-ir__marker').forEach((node) => node.remove());
  return cleanHeadingText((clone.textContent || '').replace(/[\u200b\u00a0]/g, ''));
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

function jumpToOutlineItem(item) {
  if (state.sourceMode) {
    jumpToSourceLine(item.line);
    return;
  }

  const nodes = [...document.querySelectorAll('#editor .vditor-reset :is(h1, h2, h3, h4, h5, h6)')];
  const match = nodes.filter((node) => visibleHeadingText(node) === item.text)[item.occurrence] || nodes[item.index];
  if (!match) return;
  match.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  match.classList.add('outline-flash');
  window.setTimeout(() => match.classList.remove('outline-flash'), 700);
}

function createHeadingNode(node, depth = 0) {
  const item = document.createElement('div');
  item.className = 'heading-item';

  const hasChildren = node.children.length > 0;
  const key = outlineKey(node);
  const expanded = !hasChildren || !state.outlineCollapsed.has(key);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'heading-row';
  row.style.setProperty('--tree-depth', depth);
  row.dataset.level = String(node.level);
  row.dataset.index = String(node.index);
  row.title = node.text;

  const chevron = document.createElement('span');
  chevron.className = `tree-chevron${hasChildren ? '' : ' is-leaf'}`;
  if (hasChildren) {
    chevron.append(chevronIcon(expanded));
    row.setAttribute('aria-expanded', String(expanded));
  }

  const level = document.createElement('span');
  level.className = 'heading-level';
  level.textContent = `H${node.level}`;

  const label = document.createElement('span');
  label.className = 'heading-label';
  label.textContent = node.text;

  row.append(chevron, headingIcon(), level, label);
  row.addEventListener('click', (event) => {
    if (hasChildren && (event.target.closest('.tree-chevron') || event.offsetX < 22)) {
      if (state.outlineCollapsed.has(key)) state.outlineCollapsed.delete(key);
      else state.outlineCollapsed.add(key);
      renderHeadingTree();
      return;
    }
    jumpToOutlineItem(node);
  });
  item.appendChild(row);

  if (hasChildren && expanded) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    node.children.forEach((child) => children.appendChild(createHeadingNode(child, depth + 1)));
    item.appendChild(children);
  }
  return item;
}

function renderHeadingTree() {
  if (!elements.headingTree) return;
  const scrollTop = elements.headingTree.scrollTop;
  const items = parseHeadingOutline(getMarkdown());
  const known = new Set(items.map((item) => outlineKey(item)));
  [...state.outlineCollapsed].forEach((key) => {
    if (!known.has(key)) state.outlineCollapsed.delete(key);
  });

  elements.headingTree.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<p>还没有标题结构</p><span>用 # 加空格写出标题后，这里会按层级列出当前文档的结构树。</span>';
    elements.headingTree.appendChild(empty);
    return;
  }

  nestHeadingItems(items).forEach((node) => elements.headingTree.appendChild(createHeadingNode(node)));
  elements.headingTree.scrollTop = scrollTop;
}

let outlineTimer = 0;

function scheduleOutlineRefresh() {
  window.clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(renderHeadingTree, 140);
}

function setSidebarTab(tab) {
  state.sidebarTab = tab === 'outline' ? 'outline' : 'files';
  localStorage.setItem(SIDEBAR_TAB_KEY, state.sidebarTab);
  const files = state.sidebarTab === 'files';
  elements.filesPanel.classList.toggle('hidden', !files);
  elements.outlinePanel.classList.toggle('hidden', files);
  elements.tabFiles.classList.toggle('is-active', files);
  elements.tabOutline.classList.toggle('is-active', !files);
  elements.tabFiles.setAttribute('aria-selected', String(files));
  elements.tabOutline.setAttribute('aria-selected', String(!files));
  if (!files) renderHeadingTree();
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
  elements.workspacePath.textContent = state.workspaceRoot;
  elements.workspaceHeading.classList.remove('hidden');
  elements.refreshTreeButton.classList.remove('hidden');
  elements.newTreeButton.classList.remove('hidden');
  renderFileTree();
  persistSession();
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

function toggleMode() {
  if (state.sourceMode) {
    const value = elements.sourceEditor.value || '';
    state.sourceMode = false;
    elements.sourceEditor.classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    if (vditor) vditor.setValue(value, true);
    elements.modeLabel.textContent = '即时渲染';
    focusEditor();
  } else {
    const value = getMarkdown();
    state.sourceMode = true;
    elements.sourceEditor.value = value;
    document.getElementById('editor').classList.add('hidden');
    elements.sourceEditor.classList.remove('hidden');
    elements.modeLabel.textContent = 'Markdown 源码';
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
  if (action === 'delete' && targetPath) {
    const name = baseName(targetPath);
    const message = kind === 'directory'
      ? `确定删除文件夹“${name}”及其全部内容？此操作无法撤销。`
      : `确定删除“${name}”？此操作无法撤销。`;
    if (!window.confirm(message)) return;
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

  const action = await window.markl.showTreeMenu({ kind: state.workspaceRoot ? kind : 'blank', targetPath });
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
  const dark = theme === 'dark';
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
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-sepia');
  document.body.classList.add(`theme-${next.theme}`);
  document.body.dataset.font = next.font;
  document.body.dataset.fontSize = next.fontSize;
  document.documentElement.style.setProperty('--font-content', FONT_STACKS[next.font]);
  document.documentElement.style.setProperty('--content-size', FONT_SIZES[next.fontSize]);
  applyVditorTheme(next.theme);
  scheduleCodeHighlight();
  scheduleTableBalance();
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
  elements.languagePopup.classList.remove('hidden');
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
  elements.languagePopup.classList.add('hidden');
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
  return (cell.getAttribute('align') || (cell.tagName === 'TH' ? 'center' : 'left')).toLowerCase();
}

function closeTableMenus() {
  tableUi.menu = '';
  tableUi.hoverCols = 0;
  tableUi.hoverRows = 0;
  elements.tableInsertMenu.classList.add('hidden');
  elements.tableMoreMenu.classList.add('hidden');
  elements.tableInsertButton.setAttribute('aria-expanded', 'false');
  elements.tableMoreButton.setAttribute('aria-expanded', 'false');
}

function hideTableToolbar() {
  closeTableMenus();
  tableUi.table = null;
  tableUi.cell = null;
  elements.tableToolbar.classList.add('hidden');
}

function positionTableToolbar(table) {
  const wrap = elements.editorWrap;
  const wrapRect = wrap.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  if (tableRect.bottom < wrapRect.top + 8 || tableRect.top > wrapRect.bottom - 8) {
    elements.tableToolbar.classList.add('hidden');
    return;
  }
  const barHeight = elements.tableToolbar.offsetHeight || 32;
  const top = Math.max(8, tableRect.top - wrapRect.top - barHeight - 4);
  const left = Math.max(8, tableRect.left - wrapRect.left);
  const maxWidth = wrapRect.width - left - 8;
  elements.tableToolbar.style.top = `${top}px`;
  elements.tableToolbar.style.left = `${left}px`;
  elements.tableToolbar.style.width = `${Math.min(Math.max(tableRect.width, 228), maxWidth)}px`;
  elements.tableToolbar.classList.remove('hidden');
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

function setTableCellAlign(type) {
  const ctx = currentTableContext();
  if (!ctx) return;
  ctx.cell.setAttribute('align', type);
  focusTableCell(ctx.cell);
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
  menu.classList.remove('hidden');
  button.setAttribute('aria-expanded', 'true');
}

function handleTableToolbarAction(action) {
  if (!action) return;
  if (action === 'toggle-insert') return toggleTableMenu('insert');
  if (action === 'toggle-more') return toggleTableMenu('more');
  closeTableMenus();
  if (action === 'align-left') return setTableCellAlign('left');
  if (action === 'align-center') return setTableCellAlign('center');
  if (action === 'align-right') return setTableCellAlign('right');
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
  query: '',
  matches: [],
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
    expandedPaths: [...state.expandedPaths],
    at: Date.now()
  }));
}

function persistSession() {
  if (state.restoringSession) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(persistSessionNow, 80);
}

function applySessionChrome() {
  if (readSession().sidebarHidden) document.body.classList.add('sidebar-hidden');
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
  return { caseSensitive: findState.caseSensitive };
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
  const { matches, index, query } = findState;
  if (!query) {
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
  findState.matches = collectMatches(getMarkdown(), findState.query, findOptions());
  if (!findState.matches.length) findState.index = 0;
  else if (findState.index >= findState.matches.length) findState.index = findState.matches.length - 1;
  updateFindCount();
}

function isSkippedFindHost(element) {
  if (!element?.closest) return true;
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
  elements.findBar.classList.remove('hidden');
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
  elements.findBar.classList.add('hidden');
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
  return IMAGE_FILE_RE.test(file.name || '');
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
  return files.filter(isImageFile);
}

async function ensureDocumentOnDisk() {
  if (state.filePath) {
    const stat = await window.markl.statPath(state.filePath);
    if (stat.exists) return true;
  }
  const ok = window.confirm('插入图片需要先保存文档。现在保存吗？');
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

async function insertImageFiles(files) {
  const images = [...files].filter(isImageFile);
  if (!images.length) return false;
  if (!(await ensureDocumentOnDisk()) || !state.filePath) return true;

  try {
    const snippets = [];
    for (const file of images) {
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
  try {
    const launch = await launchContextPromise;
    if (launchHandled) return;
    const session = readSession();
    if (launch?.file) {
      launchHandled = true;
      loadContent(launch.file.filePath, launch.file.content);
      await restoreWorkspaceFromSession(session, { preferFile: launch.file.filePath });
      return;
    }
    await restoreWorkspaceFromSession(session);
    if (session.filePath) {
      const stat = await window.markl.statPath(session.filePath);
      if (stat.exists && stat.kind === 'file') {
        const result = await window.markl.readFile({ filePath: stat.path || session.filePath });
        loadContent(result.filePath, result.content);
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
    scheduleImageResolve();
    if (findState.open) refreshFindMatches({ stay: true, reveal: false });
    focusEditor();
  }
}

function createVditor() {
  if (!window.Vditor) {
    window.alert('编辑器未能加载，请重新启动 MarkL。');
    return;
  }

  vditor = new window.Vditor('editor', {
    cdn: VDITOR_CDN,
    _lutePath: new URL('../../node_modules/vditor/dist/js/lute/lute.min.js', import.meta.url).href,
    mode: 'ir',
    height: '100%',
    lang: 'zh_CN',
    theme: state.appearance.theme === 'dark' ? 'dark' : 'classic',
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
      markdown: {
        sanitize: false,
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
        current: state.appearance.theme === 'dark' ? 'dark' : 'light',
        path: CONTENT_THEME_PATH
      }
    },
    after() {
      state.editorReady = true;
      applyVditorTheme(state.appearance.theme);
      decorateCodeBlocks();
      watchCodeHighlight();
      scheduleTableToolbar();
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
  if (event.target.closest('#file-tree, #open-history, .sidebar-tabs')) return;
  onTreeContextMenu(event);
});
elements.tabFiles.addEventListener('click', () => setSidebarTab('files'));
elements.tabOutline.addEventListener('click', () => setSidebarTab('outline'));
elements.githubLink.addEventListener('click', (event) => {
  event.preventDefault();
  window.markl.openExternal(GITHUB_REPO_URL).catch((error) => {
    showOperationError('打开 GitHub', error);
  });
});
document.getElementById('open-button').addEventListener('click', doOpen);
document.getElementById('save-button').addEventListener('click', doSave);
document.getElementById('check-update-button').addEventListener('click', async () => {
  try {
    await window.markl.checkUpdate();
  } catch (error) {
    showOperationError('检查更新', error);
  } finally {
    restoreEditorFocus();
  }
});
document.getElementById('sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('status-sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
elements.modeLabel.addEventListener('click', toggleMode);
elements.sourceEditor.addEventListener('input', () => {
  recomputeDirty();
  scheduleFindRefresh();
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
  refreshFindMatches({ reset: true, reveal: true });
});
elements.findPrev.addEventListener('click', () => findStep(-1));
elements.findNext.addEventListener('click', () => findStep(1));
elements.findToggleReplace.addEventListener('click', () => {
  setReplaceOpen(!findState.replaceOpen);
  if (findState.replaceOpen) elements.replaceInput.focus();
});
elements.findClose.addEventListener('click', closeFindBar);
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
  const cell = event.target.closest('td, th');
  if (cell) showTableToolbar(cell);
  else if (!event.target.closest('.table-toolbar')) hideTableToolbar();
  window.setTimeout(() => repairEditorCaret(), 0);
});

document.getElementById('editor').addEventListener('keyup', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || state.sourceMode || state.popup.visible) return;
  if (performance.now() < (state.popup.suppressUntil || 0)) return;
  const info = document.querySelector('.vditor-ir__node--expand [data-type="code-block-info"]');
  if (!info) return;
  const lang = (info.textContent || '').replace(/[\u200b\u00a0]/g, '').trim();
  if (!lang) openLanguagePopup('');
});

document.addEventListener('selectionchange', () => {
  if (state.sourceMode) return;
  scheduleCodeHighlight();
  scheduleTableToolbar();
});

elements.editorWrap.addEventListener('scroll', () => {
  updateLiveHighlight();
  if (tableUi.table?.isConnected) positionTableToolbar(tableUi.table);
  else scheduleTableToolbar();
}, true);

elements.editorWrap.addEventListener('mousedown', (event) => {
  if (state.popup.visible && !event.target.closest('.language-popup')) {
    closeLanguagePopup({ restoreFocus: false });
  }
  if (event.target.closest('.language-popup, .table-toolbar, .find-bar, textarea, button, input')) return;
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
window.markl.on('menu:toggle-mode', toggleMode);
window.markl.on('menu:toggle-sidebar', () => toggleSidebar());
window.markl.on('menu:theme', (theme) => setAppearance({ theme }));
window.markl.on('menu:font', (font) => setAppearance({ font }));
window.markl.on('menu:font-size', (fontSize) => setAppearance({ fontSize }));
window.markl.on('menu:format', formatActiveCode);
window.markl.on('menu:find', () => openFindBar({ replace: false }));
window.markl.on('menu:replace', () => openFindBar({ replace: true }));
window.markl.on('app:before-close', async () => {
  persistSessionNow();
  if (await confirmDiscardIfDirty()) window.markl.doClose();
});

document.addEventListener('click', (event) => {
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
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === 's') {
    event.preventDefault();
    if (event.shiftKey) doSaveAs();
    else doSave();
    return;
  }
  if (modifier && key === 'f') {
    event.preventDefault();
    openFindBar({ replace: false });
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
  if (event.key === 'Escape' && tableUi.menu) {
    event.preventDefault();
    closeTableMenus();
    return;
  }
  if (event.key === 'Escape' && findState.open && !state.popup.visible) {
    event.preventDefault();
    closeFindBar();
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (state.sourceMode || state.popup.visible || event.isComposing) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.activeElement?.closest?.('.tree-draft-row, #find-bar')) return;
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

elements.clearHistoryButton.addEventListener('click', () => {
  if (!readHistory().length) return;
  if (!window.confirm('确定清空全部打开历史？')) return;
  writeHistory([]);
  renderHistory();
});

function transferLooksLikeFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = [...(dataTransfer.types || [])];
  return types.includes('Files') || types.includes('application/x-moz-file');
}

document.addEventListener('paste', async (event) => {
  const files = filesFromDataTransfer(event.clipboardData);
  if (!files.length) return;
  const target = event.target;
  if (target?.closest?.('#find-bar, .tree-draft-row') || (target?.closest?.('input, textarea') && target !== elements.sourceEditor)) {
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
  if (files.length) await insertImageFiles(files);
});

window.addEventListener('drop', (event) => {
  setDropActive(false);
  if (transferLooksLikeFiles(event.dataTransfer) || filesFromDataTransfer(event.dataTransfer).length) {
    event.preventDefault();
  }
});

window.addEventListener('dragend', () => setDropActive(false));

applySessionChrome();
applyAppearance(readStoredAppearance());
persistAppearance();
updateTitle();
updateCounts();
updateFindCount();
renderFileTree();
renderHistory();
setSidebarTab(localStorage.getItem(SIDEBAR_TAB_KEY) || 'files');
createVditor();
