import { sanitizeMarkdownHtml } from './text-search.js';

const INLINE_TAGS = new Set([
  'span', 'font', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'small',
  'big', 'mark', 'sub', 'sup', 'kbd', 'samp', 'abbr', 'ruby', 'rt', 'rp', 'a'
]);
const HTML_ATTRIBUTES = new Set(['style', 'color', 'face', 'size', 'align', 'dir', 'lang', 'title', 'href']);

function readTag(marker) {
  const source = marker.querySelector(':scope > code')?.textContent || '';
  const match = source.trim().match(/^<(\/)?([a-z][\w-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>$/i);
  if (!match) return null;
  return { source, closing: Boolean(match[1]), name: match[2].toLowerCase() };
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// The browser auto-closes an unfinished <center>/<div>, so an empty preview
// is not evidence that the user has finished writing the HTML source.
function isHtmlDraft(source, preview) {
  const stack = [];
  const tags = source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/)?([a-z][\w-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi);
  for (const match of tags) {
    const name = match[2].toLowerCase();
    if (VOID_TAGS.has(name) || /\/\s*>$/.test(match[0])) continue;
    if (match[1]) {
      if (stack.at(-1) === name) stack.pop();
    } else stack.push(name);
  }
  if (stack.length) return true;
  return !preview || (!preview.textContent.trim() && !preview.querySelector('img, hr, table, input, button, details'));
}

function selectionPoint(node, offset) {
  if (node.nodeType === Node.TEXT_NODE) return () => ({ node, offset: Math.min(offset, node.length) });
  const previous = node.childNodes[offset - 1];
  const next = node.childNodes[offset];
  return () => {
    if (!previous) return { node, offset: 0 };
    if (!next) return { node, offset: node.childNodes.length };
    if (!previous.isConnected || !next.isConnected) return null;
    // A paragraph offset can now lie inside a new presentation wrapper.
    // Find the same boundary between its original neighboring nodes.
    let parent = previous.parentNode;
    while (parent && !parent.contains(next)) parent = parent.parentNode;
    if (!parent) return null;
    let child = next;
    while (child.parentNode !== parent) child = child.parentNode;
    return { node: parent, offset: [...parent.childNodes].indexOf(child) };
  };
}

function rememberSelection(root) {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return () => {};
  const anchor = selectionPoint(selection.anchorNode, selection.anchorOffset);
  const focus = selectionPoint(selection.focusNode, selection.focusOffset);
  return () => {
    const a = anchor();
    const f = focus();
    if (a?.node.isConnected && f?.node.isConnected) {
      selection.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    }
  };
}

function applyTagAttributes(wrapper, source) {
  const template = wrapper.ownerDocument.createElement('template');
  template.innerHTML = sanitizeMarkdownHtml(source);
  const tag = template.content.firstElementChild;
  if (!tag) return;
  for (const name of HTML_ATTRIBUTES) {
    const value = tag.getAttribute(name);
    if (value === null) wrapper.removeAttribute(name);
    else if (wrapper.getAttribute(name) !== value) wrapper.setAttribute(name, value);
  }
  // Invisible content must remain reachable while editing; the source is untouched.
  const hidden = wrapper.style.display === 'none' || wrapper.style.visibility === 'hidden';
  if (hidden) {
    wrapper.style.removeProperty('display');
    wrapper.style.removeProperty('visibility');
  }
  wrapper.classList.toggle('markl-html-hidden', hidden);
}

/** Keep the original IR markers for Lute, and put their text in a real HTML element. */
export function decorateInlineHtml(root) {
  if (!root) return;
  const restoreSelection = rememberSelection(root);
  const pending = new Map();
  root.querySelectorAll('[data-type="html-inline"]').forEach((marker) => {
    if (marker.closest('.vditor-ir__preview, [data-type="code-block"], [data-type="html-block"]')) return;
    const tag = readTag(marker);
    if (!tag) return;
    if (tag.name === 'br' && !tag.closing) {
      marker.classList.add('markl-html-break');
      return;
    }
    if (!INLINE_TAGS.has(tag.name)) return;
    const parent = marker.parentElement;
    if (parent.classList.contains('markl-html-inline') &&
        (marker === parent.firstChild || marker === parent.lastChild)) {
      if (!tag.closing) applyTagAttributes(parent, tag.source);
      return;
    }
    const stack = pending.get(parent) || [];
    pending.set(parent, stack);
    if (!tag.closing) {
      stack.push({ marker, tag });
      return;
    }
    const open = stack.at(-1);
    if (!open || open.tag.name !== tag.name) return;
    stack.pop();
    const wrapper = root.ownerDocument.createElement(tag.name);
    wrapper.className = 'markl-html-inline';
    applyTagAttributes(wrapper, open.tag.source);
    parent.insertBefore(wrapper, open.marker);
    let node = open.marker;
    while (node) {
      const next = node.nextSibling;
      wrapper.appendChild(node);
      if (node === marker) break;
      node = next;
    }
    const empty = ![...wrapper.childNodes].some((node) =>
      node !== open.marker && node !== marker && (node.textContent?.trim() || node.nodeName === 'IMG'));
    wrapper.classList.toggle('markl-html-empty', empty);
  });
  restoreSelection();
}

export function createHtmlEditing({ root, getEditor, onChange, isComposing = () => false }) {
  const doc = root.ownerDocument;
  let frame = 0;
  let target = null;
  let originalSource = '';
  let savedRange = null;
  let draftGroup = null;
  let draftUndoTimer = 0;
  const previewSources = new WeakMap();
  const pastedHtml = new WeakMap();
  const panel = doc.createElement('div');
  panel.className = 'html-source-popover hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '编辑 HTML');
  panel.innerHTML = '<div class="html-source-title">HTML <span>修改标签和文字</span></div>' +
    '<textarea spellcheck="false" aria-label="HTML 源码"></textarea>' +
    '<div class="html-source-error" role="status"></div>' +
    '<div class="html-source-actions"><button type="button" data-action="cancel">取消</button>' +
    '<button type="button" data-action="apply">完成</button></div>';
  doc.body.appendChild(panel);
  const textarea = panel.querySelector('textarea');
  const error = panel.querySelector('.html-source-error');

  function position() {
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    const width = Math.min(520, doc.documentElement.clientWidth - 24);
    panel.style.width = `${width}px`;
    const height = panel.offsetHeight;
    const top = rect.bottom + 8;
    panel.style.left = `${Math.max(12, Math.min(rect.left, doc.documentElement.clientWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(top, doc.documentElement.clientHeight - height - 12))}px`;
  }

  function close(restoreFocus = true) {
    flushDraft();
    panel.classList.add('hidden');
    target = null;
    const range = savedRange;
    savedRange = null;
    if (!restoreFocus) return;
    root.focus({ preventScroll: true });
    if (range?.startContainer.isConnected && root.contains(range.startContainer)) {
      const selection = doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function decorate() {
    if (isComposing()) return;
    decorateInlineHtml(root);
    root.querySelectorAll('.vditor-ir__node[data-type="html-block"]').forEach((block) => {
      block.classList.add('markl-html-block');
      const preview = block.querySelector(':scope > .vditor-ir__preview');
      const code = block.querySelector(':scope > .vditor-ir__marker--pre code');
      const source = code?.textContent || '';
      if (preview && previewSources.get(block) !== source) {
        preview.innerHTML = sanitizeMarkdownHtml(source);
        previewSources.set(block, source);
      }
      const selection = doc.getSelection();
      // Keep the single source editor available until this newly typed block
      // is complete and the user has moved the caret away from its source.
      const editingDraft = code?.contains(selection?.anchorNode);
      block.classList.toggle('markl-html-draft', Boolean(editingDraft || isHtmlDraft(source, preview)));
      if (preview) preview.setAttribute('contenteditable', 'false');
    });
    // Ignore our own decoration mutations, otherwise every pass schedules another frame.
    observer.takeRecords();
    if (target && !target.isConnected) close(false);
  }

  function schedule() {
    if (frame || isComposing()) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      decorate();
    });
  }

  function open(node) {
    if (!node || isComposing()) return;
    const editor = getEditor();
    target = node;
    const selection = doc.getSelection();
    savedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    originalSource = node.matches('[data-type="html-block"]')
      ? node.querySelector('.vditor-ir__marker--pre code')?.textContent || ''
      : editor.vditor.lute.VditorIRDOM2Md(node.outerHTML).trimEnd();
    textarea.value = originalSource;
    error.textContent = '';
    panel.classList.remove('hidden');
    position();
    textarea.focus({ preventScroll: true });
  }

  function apply() {
    if (!target?.isConnected) { close(false); return false; }
    const source = sanitizeMarkdownHtml(textarea.value);
    if (source === originalSource) { close(); return true; }
    const editor = getEditor();
    const template = doc.createElement('template');
    template.innerHTML = editor.vditor.lute.Md2VditorIRDOM(source);
    const inline = target.classList.contains('markl-html-inline');
    if (inline && (template.content.childElementCount !== 1 || template.content.firstElementChild?.tagName !== 'P')) {
      error.textContent = '行内 HTML 请在同一段中编辑。';
      return false;
    }
    const replacement = inline ? template.content.firstElementChild : template.content;
    const parent = target.parentNode;
    const next = target.nextSibling;
    editor.vditor.undo.addToUndoStack(editor.vditor);
    target.replaceWith(...replacement.childNodes);
    close(false);
    decorate();
    root.focus({ preventScroll: true });
    const range = doc.createRange();
    range.setStart(parent, next?.parentNode === parent ? [...parent.childNodes].indexOf(next) : parent.childNodes.length);
    range.collapse(true);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.vditor.undo.addToUndoStack(editor.vditor);
    onChange();
    return true;
  }

  function draftCode() {
    const selection = doc.getSelection();
    if (!selection?.rangeCount) return null;
    const node = selection.anchorNode;
    const host = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const code = host?.closest('.vditor-ir__node[data-type="html-block"] > .vditor-ir__marker--pre > code');
    return code && root.contains(code) && code.contains(selection.focusNode) ? code : null;
  }

  function revealDraft() {
    const code = draftCode();
    if (code) code.closest('.vditor-ir__node').classList.add('markl-html-block', 'markl-html-draft');
  }

  function flushDraft() {
    clearTimeout(draftUndoTimer);
    draftUndoTimer = 0;
    if (draftGroup?.isConnected) {
      const editor = getEditor();
      editor.vditor.undo.addToUndoStack(editor.vditor);
    }
    draftGroup = null;
  }

  function beginDraft(code) {
    if (draftGroup === code) return;
    flushDraft();
    const editor = getEditor();
    editor.vditor.undo.addToUndoStack(editor.vditor);
    draftGroup = code;
  }

  function draftChanged() {
    clearTimeout(draftUndoTimer);
    draftUndoTimer = setTimeout(flushDraft, getEditor().vditor.options.undoDelay || 800);
    schedule();
    onChange();
  }

  function insertDraftText(code, text) {
    beginDraft(code);
    const selection = doc.getSelection();
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStart(node, node.length);
    range.collapse(true);
    // Chromium needs a final line break to keep a caret on the new empty line.
    const tail = range.cloneRange();
    tail.setEnd(code, code.childNodes.length);
    if (text.endsWith('\n') && !tail.toString()) code.appendChild(doc.createTextNode('\n'));
    selection.removeAllRanges();
    selection.addRange(range);
    draftChanged();
  }

  function finishDraft(code) {
    flushDraft();
    const block = code.closest('.markl-html-block');
    let paragraph = block.nextElementSibling;
    if (paragraph?.tagName !== 'P' || paragraph.textContent.trim()) {
      paragraph = doc.createElement('p');
      paragraph.dataset.block = '0';
      paragraph.appendChild(doc.createElement('br'));
      block.after(paragraph);
    }
    root.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    decorate();
    const editor = getEditor();
    editor.vditor.undo.addToUndoStack(editor.vditor);
    onChange();
  }

  // Keep unfinished HTML in one plain-text source. Spinning it through Markdown
  // after each newline would terminate the HTML block and move the caret outside.
  root.addEventListener('beforeinput', () => {
    const code = draftCode();
    if (code && !isComposing()) beginDraft(code);
  }, true);
  root.addEventListener('input', (event) => {
    const code = draftCode();
    if (!code) return;
    event.stopImmediatePropagation();
    draftChanged();
  }, true);
  // Vditor creates an HTML source during its input listener. Reveal that source
  // before the next keystroke, without waiting for a render frame or undo timer.
  root.addEventListener('input', revealDraft);
  root.addEventListener('paste', (event) => {
    const code = draftCode();
    if (!event.clipboardData?.types.includes('text/plain')) return;
    if (!code) {
      const source = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
      if (/^\s*<[a-z][\w-]*\b/i.test(source) && !event.clipboardData.getData('text/html').trim() && !event.clipboardData.files.length) {
        flushDraft();
        decorate();
        const editor = getEditor();
        editor.vditor.undo.addToUndoStack(editor.vditor);
        pastedHtml.set(event, { source, blocks: new Set(root.querySelectorAll('.vditor-ir__node[data-type="html-block"]')) });
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    insertDraftText(code, event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
  }, true);
  // Vditor pastes a new HTML block followed by an empty paragraph. Keep the
  // caret in unfinished HTML so the very next input can complete that source.
  root.addEventListener('paste', (event) => {
    const pasted = pastedHtml.get(event);
    if (!pasted) return;
    pastedHtml.delete(event);
    const selection = doc.getSelection();
    const host = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection?.anchorNode?.parentElement;
    const paragraph = host?.closest('p');
    const block = paragraph?.previousElementSibling;
    const code = block?.matches('.vditor-ir__node[data-type="html-block"]') ? block.querySelector(':scope > .vditor-ir__marker--pre code') : null;
    if (selection?.isCollapsed && paragraph && root.contains(paragraph) && !paragraph.textContent.trim() &&
        code && !pasted.blocks.has(block) && pasted.source.trimEnd().endsWith(code.textContent.trimEnd()) &&
        isHtmlDraft(code.textContent, block.querySelector(':scope > .vditor-ir__preview'))) {
      block.classList.add('markl-html-block', 'markl-html-draft');
      const range = doc.createRange();
      range.selectNodeContents(code);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      decorate();
      beginDraft(code);
    }
    schedule();
    onChange();
  });
  root.addEventListener('keydown', (event) => {
    const code = draftCode();
    if (!code || event.isComposing || isComposing()) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      flushDraft();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Enter' && (event.key !== 'Tab' || event.shiftKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      decorate();
      const preview = code.parentElement.nextElementSibling;
      const tail = doc.getSelection().getRangeAt(0).cloneRange();
      tail.setEnd(code, code.childNodes.length);
      if (!tail.toString().trim() && !isHtmlDraft(code.textContent, preview)) {
        finishDraft(code);
        return;
      }
    }
    insertDraftText(code, event.key === 'Enter' ? '\n' : '  ');
  }, true);

  root.addEventListener('click', (event) => {
    const block = event.target.closest('.markl-html-block');
    if (!block || !root.contains(block) || block.classList.contains('markl-html-draft')) return;
    const interactive = event.target.closest('a, button, input, select, textarea, summary, audio, video');
    if (interactive && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(block);
  }, true);
  root.addEventListener('dblclick', (event) => {
    const inline = event.target.closest('.markl-html-inline');
    if (!inline) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(inline);
  }, true);
  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="apply"]')) apply();
    if (event.target.closest('[data-action="cancel"]')) close();
  });
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); apply(); }
    if (event.key === 'Tab') { event.preventDefault(); doc.execCommand('insertText', false, '  '); }
  });
  doc.addEventListener('mousedown', (event) => {
    if (!target || panel.contains(event.target) || target.contains(event.target)) return;
    if (textarea.value === originalSource) close(false);
    else if (!apply()) event.preventDefault();
  }, true);
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  root.addEventListener('compositionstart', () => {
    const code = draftCode();
    if (code) beginDraft(code);
  });
  root.addEventListener('compositionend', schedule);
  doc.addEventListener('selectionchange', () => {
    revealDraft();
    if (draftGroup && draftCode() !== draftGroup) flushDraft();
    if (root.querySelector('.markl-html-draft')) schedule();
  });
  root.addEventListener('scroll', () => { if (target) position(); }, { passive: true });
  window.addEventListener('resize', () => { if (target) position(); });
  decorate();
  return { decorate, schedule, close, open, apply };
}
