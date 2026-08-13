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

const state = {
  filePath: null,
  savedContent: '',
  dirty: false,
  workspaceRoot: null,
  workspaceName: null,
  workspaceTree: [],
  expandedPaths: new Set(),
  popup: { visible: false, query: '', items: [], selected: 0, suppressUntil: 0 },
  treeDraft: null,
  sourceMode: false,
  editorReady: false
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
  workspaceHeading: document.getElementById('workspace-heading'),
  workspaceName: document.getElementById('workspace-name'),
  workspacePath: document.getElementById('workspace-path'),
  refreshTreeButton: document.getElementById('refresh-tree-button'),
  newTreeButton: document.getElementById('new-tree-button'),
  sidebar: document.getElementById('sidebar'),
  languagePopup: document.getElementById('language-popup'),
  languageQueryInput: document.getElementById('language-query-input'),
  languageList: document.getElementById('language-list'),
  editorWrap: document.getElementById('editor-wrap'),
  sourceEditor: document.getElementById('source-editor')
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
  if (state.sourceMode) return elements.sourceEditor.value || '';
  return vditor?.getValue?.() || '';
}

function getHTML() {
  return vditor?.getHTML?.() || '';
}

function setMarkdown(content, clearStack = true) {
  const value = content || '';
  elements.sourceEditor.value = value;
  if (vditor && state.editorReady) vditor.setValue(value, clearStack);
}

function focusEditor() {
  if (state.sourceMode) {
    elements.sourceEditor.focus();
    return;
  }
  vditor?.focus?.();
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
}

function loadContent(filePath, content) {
  state.filePath = filePath;
  const normalized = normalizeMarkdown(content);
  setMarkdown(normalized, true);
  markClean(normalized);
  updateCounts();
  focusEditor();
}

async function confirmDiscardIfDirty() {
  if (!state.dirty) return true;
  return window.confirm(
    `“${baseName(state.filePath)}”还有未保存的更改。\n\n确定：放弃更改\n取消：继续编辑`
  );
}

function showOperationError(action, error) {
  console.error(action, error);
  window.alert(`${action}失败：\n${error?.message || error}`);
}

async function doNew() {
  if (!(await confirmDiscardIfDirty())) return;
  state.filePath = null;
  setMarkdown('', true);
  markClean('');
  updateCounts();
  focusEditor();
}

async function doOpen() {
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const result = await window.markl.openDialog();
    if (result) loadContent(result.filePath, result.content);
  } catch (error) {
    showOperationError('打开文件', error);
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
    if (isPathInside(target, state.workspaceRoot)) await refreshWorkspace();
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
table{border-collapse:collapse}th,td{border:1px solid #d5dbe3;padding:7px 12px}img{max-width:100%}center{text-align:center}
</style>
</head>
<body>
${body}
</body>
</html>`;
    await window.markl.writeFile({ filePath: target, content: fullHtml });
  } catch (error) {
    showOperationError('导出 HTML', error);
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
}

function applyWorkspace(payload) {
  if (!payload) return;
  state.workspaceRoot = payload.rootPath;
  state.workspaceName = payload.rootName;
  state.workspaceTree = payload.tree || [];
  state.expandedPaths = new Set(
    state.workspaceTree.filter((node) => node.type === 'directory').map((node) => node.path)
  );
  elements.workspaceName.textContent = state.workspaceName;
  elements.workspacePath.textContent = state.workspaceRoot;
  elements.workspaceHeading.classList.remove('hidden');
  elements.refreshTreeButton.classList.remove('hidden');
  elements.newTreeButton.classList.remove('hidden');
  renderFileTree();
}

async function doOpenFolder() {
  try {
    const payload = await window.markl.openFolderDialog();
    if (payload) applyWorkspace(payload);
  } catch (error) {
    showOperationError('打开文件夹', error);
  }
}

async function refreshWorkspace() {
  if (!state.workspaceRoot) return;
  try {
    const payload = await window.markl.refreshWorkspace(state.workspaceRoot);
    if (payload) {
      const expanded = state.expandedPaths;
      applyWorkspace(payload);
      state.expandedPaths = expanded;
      renderFileTree();
    }
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
  }
  recomputeDirty();
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
      }
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

function applyVditorTheme(theme) {
  if (!vditor) return;
  const dark = theme === 'dark';
  vditor.setTheme(
    dark ? 'dark' : 'classic',
    dark ? 'dark' : 'light',
    dark ? 'native' : 'github',
    CONTENT_THEME_PATH
  );
}

function setTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', selected === 'dark');
  document.body.classList.toggle('theme-light', selected === 'light');
  applyVditorTheme(selected);
  localStorage.setItem('markl-theme', selected);
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

function closeLanguagePopup() {
  state.popup.visible = false;
  elements.languagePopup.classList.add('hidden');
}

function highlightCodePreviews() {
  if (!window.hljs) return;
  document.querySelectorAll('[data-type="code-block"] .vditor-ir__preview code').forEach((code) => {
    const block = code.closest('[data-type="code-block"]');
    const info = block?.querySelector('[data-type="code-block-info"]');
    const classLang = (code.className.match(/language-([\w#+-]+)/i) || [])[1];
    const language = canonicalLanguage((info?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim() || classLang || '');
    if (!language || !window.hljs.getLanguage(language)) return;
    const source = code.textContent.replace(/\u200b/g, '');
    if (code.dataset.marklHl === `${language}\0${source}`) return;
    code.className = `language-${language} hljs`;
    code.innerHTML = window.hljs.highlight(source, { language, ignoreIllegals: true }).value;
    code.dataset.marklHl = `${language}\0${source}`;
  });
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

function updateLiveHighlight() {
  const block = document.querySelector('[data-type="code-block"].vditor-ir__node--expand');
  const pre = block?.querySelector('.vditor-ir__marker--pre');
  const code = pre?.querySelector('code');
  const layer = liveHighlightLayer();
  if (!block || !pre || !code) {
    layer.classList.add('hidden');
    return;
  }

  const info = block.querySelector('[data-type="code-block-info"]');
  const language = canonicalLanguage((info?.textContent || '').replace(/[\u200b\u00a0]/g, '').trim() || block.dataset.lang || '');
  const source = code.textContent.replace(/\u200b/g, '');
  if (window.hljs && language && window.hljs.getLanguage(language)) {
    layer.innerHTML = `${window.hljs.highlight(source, { language, ignoreIllegals: true }).value}\n`;
  } else {
    layer.textContent = `${source}\n`;
  }

  const wrapRect = elements.editorWrap.getBoundingClientRect();
  const preRect = pre.getBoundingClientRect();
  layer.style.top = `${preRect.top - wrapRect.top}px`;
  layer.style.left = `${preRect.left - wrapRect.left}px`;
  layer.style.width = `${preRect.width}px`;
  layer.style.minHeight = `${preRect.height}px`;
  layer.classList.remove('hidden');
}

function decorateCodeBlocks() {
  highlightCodePreviews();
  updateLiveHighlight();
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
  closeLanguagePopup();
  if (!vditor || state.sourceMode) return;
  setTimeout(() => {
    applyLanguageToActiveBlock(lang);
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
    closeLanguagePopup();
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
    theme: document.body.classList.contains('theme-dark') ? 'dark' : 'classic',
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
        current: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
        path: CONTENT_THEME_PATH
      }
    },
    after() {
      state.editorReady = true;
      applyVditorTheme(localStorage.getItem('markl-theme') || 'light');
      if (state.savedContent) vditor.setValue(state.savedContent, true);
      else markClean(getMarkdown());
      decorateCodeBlocks();
      focusEditor();
      updateCounts();
    },
    input() {
      recomputeDirty();
      updateLiveHighlight();
      if (!document.querySelector('[data-type="code-block"].vditor-ir__node--expand')) {
        highlightCodePreviews();
      }
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
  if (event.target.closest('#file-tree')) return;
  onTreeContextMenu(event);
});
document.getElementById('open-button').addEventListener('click', doOpen);
document.getElementById('save-button').addEventListener('click', doSave);
document.getElementById('sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('status-sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
elements.modeLabel.addEventListener('click', toggleMode);
elements.sourceEditor.addEventListener('input', recomputeDirty);
elements.languageQueryInput.addEventListener('input', () => {
  state.popup.query = elements.languageQueryInput.value;
  state.popup.items = filteredLanguages(state.popup.query);
  state.popup.selected = 0;
  renderLanguagePopup();
});
elements.languageQueryInput.addEventListener('keydown', (event) => {
  handlePopupKeydown(event);
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
  updateLiveHighlight();
  if (!document.querySelector('[data-type="code-block"].vditor-ir__node--expand')) {
    highlightCodePreviews();
  }
});

elements.editorWrap.addEventListener('scroll', updateLiveHighlight, true);

elements.editorWrap.addEventListener('mousedown', (event) => {
  if (event.target.closest('.language-popup, .vditor-ir, textarea, button, input')) return;
  focusEditor();
});

window.markl.on('file:opened', async ({ filePath, content }) => {
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
window.markl.on('menu:theme', setTheme);
window.markl.on('menu:format', formatActiveCode);
window.markl.on('app:before-close', async () => {
  if (await confirmDiscardIfDirty()) window.markl.doClose();
});

document.addEventListener('selectionchange', () => {
  if (state.sourceMode) return;
  highlightIdleCodeBlocks();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) doSaveAs();
    else doSave();
  }
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    formatActiveCode();
  }
});

window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 821px)').matches) document.body.classList.remove('sidebar-open');
  if (state.popup.visible) positionLanguagePopup();
});

setTheme(localStorage.getItem('markl-theme') || 'light');
updateTitle();
updateCounts();
renderFileTree();
createVditor();
