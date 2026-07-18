import Editor from '../../node_modules/@toast-ui/editor/dist/esm/index.js';
import '../../node_modules/@toast-ui/editor/dist/esm/i18n/zh-cn.js';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'node'], description: '网页与 Node.js' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'], description: '带类型的 JavaScript' },
  { id: 'java', label: 'Java', aliases: [], description: 'Java 代码' },
  { id: 'python', label: 'Python', aliases: ['py'], description: 'Python 脚本' },
  { id: 'markup', label: 'HTML / XML', aliases: ['html', 'xml'], description: '网页标记语言' },
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
  { id: 'plaintext', label: '纯文本', aliases: ['text', 'txt'], description: '不使用语法高亮' }
];

const LANGUAGE_ALIASES = {
  js: 'javascript', node: 'javascript', ts: 'typescript', py: 'python',
  html: 'markup', xml: 'markup', shell: 'bash', sh: 'bash', 'c++': 'cpp',
  cs: 'csharp', 'c#': 'csharp', golang: 'go', rs: 'rust', md: 'markdown',
  text: 'plaintext', txt: 'plaintext'
};

const state = {
  filePath: null,
  savedContent: '',
  dirty: false,
  workspaceRoot: null,
  workspaceName: null,
  workspaceTree: [],
  expandedPaths: new Set(),
  popup: { visible: false, query: '', items: [], selected: 0, context: null, suppressUntil: 0 }
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
  languagePopup: document.getElementById('language-popup'),
  languageQuery: document.getElementById('language-query'),
  languageList: document.getElementById('language-list'),
  editorWrap: document.getElementById('editor-wrap')
};

function normalizeMarkdown(content = '') {
  return content.replace(/<\/?cener(\s[^>]*)?>/gi, (tag) => tag.replace(/cener/i, 'center'));
}

function canonicalLanguage(language) {
  const value = String(language || '').toLowerCase();
  return LANGUAGE_ALIASES[value] || value;
}

function highlightPreview(html) {
  const normalized = normalizeMarkdown(html);
  if (!window.Prism) return normalized;

  const template = document.createElement('template');
  template.innerHTML = normalized;
  template.content.querySelectorAll('pre code').forEach((code) => {
    const classes = `${code.className} ${code.parentElement?.className || ''}`;
    const classMatch = classes.match(/(?:language|lang)-([\w#+-]+)/i);
    const declaredLanguage = code.dataset.language
      || code.closest('[data-language]')?.dataset.language
      || classMatch?.[1];
    if (!declaredLanguage) return;
    const language = canonicalLanguage(declaredLanguage);
    const grammar = window.Prism.languages[language];
    if (!grammar) return;
    code.className = `language-${language}`;
    code.innerHTML = window.Prism.highlight(code.textContent, grammar, language);
  });
  return template.innerHTML;
}

let highlightTimers = [];

function highlightRenderedCode() {
  if (!window.Prism) return;
  document.querySelectorAll('.toastui-editor-md-preview pre code, .toastui-editor-ww-container pre code').forEach((code) => {
    const classes = `${code.className} ${code.parentElement?.className || ''}`;
    const classMatch = classes.match(/(?:language|lang)-([\w#+-]+)/i);
    const declaredLanguage = code.dataset.language
      || code.closest('[data-language]')?.dataset.language
      || classMatch?.[1];
    if (!declaredLanguage) return;
    const language = canonicalLanguage(declaredLanguage);
    const grammar = window.Prism.languages[language];
    if (!grammar) return;
    const source = code.textContent;
    if (code.dataset.marklHighlighted === language && code.dataset.marklSource === source) return;
    code.className = `language-${language}`;
    code.innerHTML = window.Prism.highlight(source, grammar, language);
    code.dataset.marklHighlighted = language;
    code.dataset.marklSource = source;
  });
}

function scheduleSyntaxHighlight() {
  highlightTimers.forEach(clearTimeout);
  highlightTimers = [0, 80, 260].map((delay) => setTimeout(highlightRenderedCode, delay));
}

let languagePopupTimers = [];
let languagePopupPositionTimer = null;

function scheduleLanguagePopup() {
  languagePopupTimers.forEach(clearTimeout);
  languagePopupTimers = [0, 50, 140].map((delay) => setTimeout(updateLanguagePopup, delay));
}

const editor = new Editor({
  el: document.getElementById('editor'),
  height: '100%',
  initialEditType: 'markdown',
  previewStyle: 'vertical',
  usageStatistics: false,
  language: 'zh-CN',
  hideModeSwitch: true,
  initialValue: '',
  placeholder: '开始输入 Markdown，输入 ``` 可选择代码语言…',
  beforePreviewRender: highlightPreview
});

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
  const markdown = editor.getMarkdown() || '';
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
  const dirty = editor.getMarkdown() !== state.savedContent;
  if (dirty !== state.dirty) {
    state.dirty = dirty;
    updateTitle();
  }
  updateCounts();
}

function loadContent(filePath, content) {
  state.filePath = filePath;
  const normalized = normalizeMarkdown(content);
  editor.setMarkdown(normalized, false);
  markClean(normalized);
  updateCounts();
  editor.focus();
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
  editor.setMarkdown('', false);
  markClean('');
  updateCounts();
  editor.focus();
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
    const content = editor.getMarkdown();
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
    const content = editor.getMarkdown();
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
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body{max-width:860px;margin:40px auto;padding:0 24px;font-family:"Microsoft YaHei UI","PingFang SC",sans-serif;line-height:1.75;color:#20242c;overflow-wrap:anywhere}
pre{background:#f1f4f7;padding:16px;border-radius:6px;overflow:auto}code{font-family:"Cascadia Code",Consolas,monospace;background:#edf1f5;padding:.15em .35em;border-radius:3px}pre code{background:none;padding:0}.token.comment,.token.prolog,.token.doctype,.token.cdata{color:#6a737d}.token.punctuation{color:#4b5563}.token.property,.token.tag,.token.boolean,.token.number,.token.constant,.token.symbol{color:#b42318}.token.selector,.token.attr-name,.token.string,.token.char,.token.builtin{color:#067647}.token.operator,.token.entity,.token.url,.token.variable{color:#175cd3}.token.atrule,.token.attr-value,.token.function,.token.class-name{color:#6941c6}.token.keyword{color:#c11574}blockquote{color:#606978;border-left:4px solid #d7dde6;margin-left:0;padding-left:16px}table{border-collapse:collapse}th,td{border:1px solid #d7dde6;padding:7px 12px}img{max-width:100%}center{text-align:center}
</style>
</head>
<body>
${highlightPreview(editor.getHTML())}
</body>
</html>`;
    await window.markl.writeFile({ filePath: target, content: fullHtml });
  } catch (error) {
    showOperationError('导出 HTML', error);
  }
}

function createTreeNode(node, depth = 0) {
  const item = document.createElement('div');
  item.className = `tree-item tree-${node.type}`;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row';
  row.style.setProperty('--tree-depth', depth);
  row.dataset.path = node.path;
  row.title = node.path;

  const chevron = document.createElement('span');
  chevron.className = 'tree-chevron';
  const icon = document.createElement('span');
  icon.className = 'tree-file-icon';
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = node.name;

  if (node.type === 'directory') {
    const expanded = state.expandedPaths.has(node.path);
    chevron.textContent = expanded ? '⌄' : '›';
    icon.textContent = expanded ? '▾' : '▸';
    row.setAttribute('aria-expanded', String(expanded));
    row.addEventListener('click', () => {
      if (expanded) state.expandedPaths.delete(node.path);
      else state.expandedPaths.add(node.path);
      renderFileTree();
    });
  } else {
    chevron.textContent = '';
    icon.textContent = node.name.toLowerCase().endsWith('.txt') ? 'T' : 'M↓';
    row.addEventListener('click', () => openTreeFile(node.path));
  }

  row.append(chevron, icon, label);
  item.appendChild(row);

  if (node.type === 'directory' && state.expandedPaths.has(node.path)) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    node.children.forEach((child) => children.appendChild(createTreeNode(child, depth + 1)));
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

  if (!state.workspaceTree.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<div class="empty-icon" aria-hidden="true">空</div><p>没有可显示的文档</p><span>此目录中未找到 .md、.markdown 或 .txt 文件</span>';
    elements.fileTree.appendChild(empty);
    return;
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
  if (editor.isMarkdownMode()) {
    closeLanguagePopup();
    editor.changeMode('wysiwyg', true);
    elements.modeLabel.textContent = '所见即所得';
  } else {
    editor.changeMode('markdown', true);
    elements.modeLabel.textContent = 'Markdown';
  }
  editor.focus();
}

function setTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', selected === 'dark');
  document.body.classList.toggle('theme-light', selected === 'light');
  document.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', selected === 'dark');
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

function getFenceContext() {
  if (!editor.isMarkdownMode()) return null;

  // Toast UI document coordinates are more reliable than flattened DOM text.
  // This also prevents a stale native Selection from reopening the popup after insertion.
  const selection = editor.getSelection();
  if (!Array.isArray(selection?.[0]) || !Array.isArray(selection?.[1])) return null;
  const [line, column] = selection[0];
  if (line !== selection[1][0] || column !== selection[1][1]) return null;

  const lineText = editor.getMarkdown().split('\n')[line - 1] || '';
  const beforeCursor = lineText.slice(0, Math.max(0, column - 1));
  const match = beforeCursor.match(/^(\s*)```([A-Za-z0-9_+#.-]*)$/);
  if (!match) return null;
  return { line, column, indent: match[1], query: match[2] };
}

function filteredLanguages(query) {
  const needle = query.toLowerCase();
  const ranked = LANGUAGES.filter((language) => {
    const haystack = [language.id, language.label, language.description, ...language.aliases].join(' ').toLowerCase();
    return !needle || haystack.includes(needle);
  });
  return ranked.sort((a, b) => {
    const aExact = [a.id, ...a.aliases].includes(needle) ? -1 : 0;
    const bExact = [b.id, ...b.aliases].includes(needle) ? -1 : 0;
    return aExact - bExact;
  }).slice(0, 8);
}

function positionLanguagePopup() {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const rangeRect = range?.getClientRects?.()[0] || range?.getBoundingClientRect?.();
  const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode
    : selection?.anchorNode?.parentElement;
  const rawAnchorRect = anchorElement?.getBoundingClientRect();
  const anchorRect = rawAnchorRect && rawAnchorRect.height <= 64 ? rawAnchorRect : null;
  const wrapRect = elements.editorWrap.getBoundingClientRect();
  // Do not use the full ProseMirror container as a caret fallback: its bottom edge
  // would place the popup near the bottom of tall windows while selection settles.
  const rect = rangeRect && (rangeRect.width || rangeRect.height) ? rangeRect : anchorRect;
  const popupWidth = elements.languagePopup.offsetWidth || 300;
  const popupHeight = elements.languagePopup.offsetHeight || 300;
  const gap = 8;
  const margin = 12;

  const maxLeft = Math.max(margin, wrapRect.width - popupWidth - margin);
  const left = Math.min(
    Math.max(margin, (rect?.left || wrapRect.left + 40) - wrapRect.left + gap),
    maxLeft
  );

  const below = (rect?.bottom || wrapRect.top + 80) - wrapRect.top + gap;
  const above = (rect?.top || wrapRect.top + 80) - wrapRect.top - popupHeight - gap;
  const preferredTop = below + popupHeight <= wrapRect.height - margin || above < margin ? below : above;
  const maxTop = Math.max(margin, wrapRect.height - popupHeight - margin);
  const top = Math.min(Math.max(margin, preferredTop), maxTop);

  elements.languagePopup.style.left = `${left}px`;
  elements.languagePopup.style.top = `${top}px`;
}

function renderLanguagePopup() {
  const popup = state.popup;
  elements.languageQuery.textContent = popup.query
    ? `正在筛选：${popup.query}`
    : '继续输入语言名称，例如 java';
  elements.languageList.replaceChildren();

  if (!popup.items.length) {
    const empty = document.createElement('div');
    empty.className = 'language-empty';
    empty.textContent = '没有匹配的语言，按 Esc 关闭';
    elements.languageList.appendChild(empty);
    return;
  }

  popup.items.forEach((language, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `language-option${index === popup.selected ? ' is-selected' : ''}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === popup.selected));

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

function updateLanguagePopup() {
  if (performance.now() < state.popup.suppressUntil) {
    closeLanguagePopup();
    return;
  }

  const context = getFenceContext();
  if (!context) {
    closeLanguagePopup();
    return;
  }

  state.popup.context = context;
  state.popup.query = context.query;
  state.popup.items = filteredLanguages(context.query);
  state.popup.selected = Math.min(state.popup.selected, Math.max(0, state.popup.items.length - 1));
  state.popup.visible = true;
  elements.languagePopup.classList.remove('hidden');
  renderLanguagePopup();
  requestAnimationFrame(positionLanguagePopup);
  clearTimeout(languagePopupPositionTimer);
  languagePopupPositionTimer = setTimeout(() => {
    if (state.popup.visible) positionLanguagePopup();
  }, 220);
}

function closeLanguagePopup() {
  state.popup.visible = false;
  state.popup.context = null;
  clearTimeout(languagePopupPositionTimer);
  languagePopupPositionTimer = null;
  elements.languagePopup.classList.add('hidden');
}

function selectLanguage(index = state.popup.selected) {
  const language = state.popup.items[index];
  const context = getFenceContext() || state.popup.context;
  if (!language || !context) return closeLanguagePopup();

  const queryStart = context.indent.length + 4;
  const canonical = language.id === 'plaintext' ? 'text' : language.id;
  // Change events are asynchronous; briefly suppress checks so the popup stays closed.
  state.popup.suppressUntil = performance.now() + 400;
  languagePopupTimers.forEach(clearTimeout);
  languagePopupTimers = [];
  closeLanguagePopup();
  editor.replaceSelection(
    `${canonical}\n\n${context.indent}\`\`\``,
    [context.line, queryStart],
    [context.line, context.column]
  );
  editor.setSelection([context.line + 1, 1]);
  editor.focus();
}

function handleEditorKeydown(event) {
  if (event.isComposing) return;
  if (!state.popup.visible) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const count = state.popup.items.length;
    if (count) state.popup.selected = (state.popup.selected + direction + count) % count;
    renderLanguagePopup();
  } else if ((event.key === 'Enter' || event.key === 'Tab') && state.popup.items.length) {
    event.preventDefault();
    selectLanguage();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeLanguagePopup();
  }
}

editor.on('change', () => {
  recomputeDirty();
  scheduleLanguagePopup();
  scheduleSyntaxHighlight();
});

const previewObserver = new MutationObserver(scheduleSyntaxHighlight);
previewObserver.observe(document.getElementById('editor'), { childList: true, subtree: true });

const editorElement = document.getElementById('editor');
editorElement.addEventListener('input', (event) => {
  if (!event.isComposing) scheduleLanguagePopup();
});
editorElement.addEventListener('keyup', (event) => {
  if (!event.isComposing && !['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
    scheduleLanguagePopup();
  }
});
editorElement.addEventListener('keydown', handleEditorKeydown, true);
document.addEventListener('selectionchange', () => {
  const editable = document.querySelector('.toastui-editor-md-container .ProseMirror');
  if (editable && editable.contains(window.getSelection()?.anchorNode)) scheduleLanguagePopup();
});
editorElement.addEventListener('scroll', closeLanguagePopup, true);

document.getElementById('open-folder-button').addEventListener('click', doOpenFolder);
document.getElementById('refresh-tree-button').addEventListener('click', refreshWorkspace);
document.getElementById('new-button').addEventListener('click', doNew);
document.getElementById('open-button').addEventListener('click', doOpen);
document.getElementById('save-button').addEventListener('click', doSave);
document.getElementById('sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('status-sidebar-toggle').addEventListener('click', () => toggleSidebar());
document.getElementById('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
elements.modeLabel.addEventListener('click', toggleMode);

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
window.markl.on('app:before-close', async () => {
  if (await confirmDiscardIfDirty()) window.markl.doClose();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) doSaveAs();
    else doSave();
  }
});

window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 821px)').matches) document.body.classList.remove('sidebar-open');
  if (state.popup.visible) positionLanguagePopup();
});

scheduleSyntaxHighlight();
setTheme(localStorage.getItem('markl-theme') || 'light');
updateTitle();
updateCounts();
renderFileTree();
