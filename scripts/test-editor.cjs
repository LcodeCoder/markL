// Real Chromium/Electron regressions; the user's files and profile are never used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { stdio: 'inherit', env });
  child.on('error', (error) => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'markl-editor-test-'));
  app.setPath('userData', profile);
  app.setName('MarkL Editor Test');
  const rootPath = path.resolve(__dirname, '..');
  const sample = '# 排版与 HTML 对照\n\n' +
    '普通文字，<span style="color:#d33;font-size:22px" title="a > b">红色大字</span>，继续普通文字。\n\n' +
    '<font color="#2674bf">蓝色文字</font>\n\n' +
    '<div style="text-align:center;color:#21884b">居中的绿色文字<br>第二行</div>\n\n' +
    'HTML 后面的段落。\n\n## 代码示例\n\n' +
    '```javascript\nfunction greet(name) {\n  const message = `你好，${name}`;\n  console.log(message);\n  return message;\n}\n```\n\n' +
    '```python\ndef square(x):\n    return x * x\n```\n\n最后一段普通文字。\n';
  const prefs = { autoSave: false, measure: 'standard', lineNumbers: false };
  const file = { filePath: '/virtual/html-layout.md', content: sample, encoding: 'UTF-8' };
  const writes = [];
  const defaults = {
    'app:launch-context': { file, prefs, appearance: { theme: 'light', font: 'default', fontSize: 'medium' }, dev: true },
    'app:version': 'test', 'prefs:get': prefs, 'path:stat': { exists: false },
    'draft:read': null, 'image:resolve': [], 'revision:list': [], 'image:list-assets': []
  };
  const preload = fs.readFileSync(path.join(rootPath, 'src/preload.js'), 'utf8');
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]);
  for (const channel of new Set(channels)) {
    ipcMain.handle(channel, (_event, payload) => {
      if (channel === 'file:write') { writes.push(payload); return { ...file, mtimeMs: 1 }; }
      if (channel === 'prefs:set') return { ...prefs, ...payload };
      if (channel === 'file:read') return file;
      return defaults[channel] ?? null;
    });
  }
  let win;
  const errors = [];
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const waitFor = async (fn, message) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await evaluate(fn)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Timeout: ${message}`);
  };
  const test = async (name, run) => { await run(); console.log(`✓ ${name}`); };
  async function run() {
    await app.whenReady();
    win = new BrowserWindow({
      show: Boolean(process.env.MARKL_TEST_VISIBLE), width: 1200, height: 900,
      webPreferences: { preload: path.join(rootPath, 'src/preload.js'), contextIsolation: true, backgroundThrottling: false }
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3 && !/Electron Security Warning|Content Security Policy/i.test(message)) errors.push(message);
    });
    win.webContents.on('render-process-gone', (_event, details) => errors.push(JSON.stringify(details)));
    await win.loadFile(path.join(rootPath, 'src/renderer/index.html'));
    await waitFor(() => document.querySelector('.vditor-ir pre.vditor-reset')?.textContent.includes('最后一段普通文字'), 'document loaded');
    await evaluate(async () => {
      window.editorTest = {
        root: () => document.querySelector('.vditor-ir pre.vditor-reset'),
        markdown: () => Lute.New().VditorIRDOM2Md(document.querySelector('.vditor-ir pre.vditor-reset').innerHTML),
        decorate: (await import('./html-editing.js')).decorateInlineHtml,
        setSelection(node, offset = 0, end = offset) {
          document.querySelector('.vditor-ir pre.vditor-reset').focus({ preventScroll: true });
          const selection = getSelection();
          selection.setBaseAndExtent(node, offset, node, end);
        },
        async setMarkdown(markdown) {
          const button = document.getElementById('mode-label');
          if (!button.classList.contains('is-source')) button.click();
          const textarea = document.getElementById('source-editor');
          textarea.value = markdown;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          button.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      };
    });
    await test('a freshly typed <center> remains visible and accepts its text and closing tag', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '\n');
      await evaluate(async () => {
        let paragraph = editorTest.root().querySelector('p');
        if (!paragraph) {
          paragraph = document.createElement('p');
          paragraph.dataset.block = '0';
          editorTest.root().appendChild(paragraph);
        }
        editorTest.setSelection(paragraph, 0);
        for (const character of '<center>') {
          document.execCommand('insertText', false, character);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      });
      const first = await evaluate(() => {
        const block = editorTest.root().querySelector('[data-type="html-block"].markl-html-block');
        const code = block.querySelector('.vditor-ir__marker--pre code');
        return { source: editorTest.markdown(), height: code.getBoundingClientRect().height,
          caret: code.contains(getSelection().anchorNode),
          sourceDisplay: getComputedStyle(code.parentElement).display,
          previewDisplay: getComputedStyle(block.querySelector('.vditor-ir__preview')).display };
      });
      assert.equal(first.source, '<center>\n');
      assert.equal(first.caret, true, 'typing the opening tag keeps the caret in its source');
      assert.ok(first.height > 10, 'open tag has a visible editable line');
      assert.equal(first.sourceDisplay, 'block');
      assert.equal(first.previewDisplay, 'none');
      await evaluate(() => document.execCommand('insertText', false, '居中内容</center>'));
      assert.match(await evaluate(() => editorTest.markdown()), /<center>居中内容<\/center>/);
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.markl-html-block > .vditor-ir__marker--pre')).display), 'block', 'finishing the tag keeps the caret visible');
      await evaluate(() => {
        const paragraph = document.createElement('p');
        paragraph.dataset.block = '0';
        paragraph.textContent = '后面的普通段落';
        editorTest.root().appendChild(paragraph);
        editorTest.setSelection(paragraph.firstChild, 0);
      });
      await waitFor(() => !editorTest.root().querySelector('.markl-html-draft'), 'complete HTML collapses to styled content');
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.vditor-ir__preview center')).textAlign), 'center');
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('fast consecutive HTML keystrokes keep the complete tag, content and caret', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '快速输入：\n');
      await evaluate(() => {
        const paragraph = editorTest.root().querySelector('p');
        editorTest.setSelection(paragraph.firstChild, paragraph.firstChild.length);
        // Start the block on a fresh paragraph, but deliberately do not wait
        // for render frames between keystrokes.
        const empty = document.createElement('p');
        empty.dataset.block = '0';
        editorTest.root().appendChild(empty);
        editorTest.setSelection(empty, 0);
        for (const character of '<center>快速输入的内容</center>') {
          const host = getSelection().anchorNode.nodeType === Node.ELEMENT_NODE ? getSelection().anchorNode : getSelection().anchorNode.parentElement;
          const event = new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true });
          host.dispatchEvent(event);
          if (!event.defaultPrevented) document.execCommand('insertText', false, character);
        }
      });
      assert.match(await evaluate(() => editorTest.markdown()), /<center>快速输入的内容<\/center>/);
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.equal(await evaluate(() => {
        const code = editorTest.root().querySelector('.markl-html-draft .vditor-ir__marker--pre code');
        return code?.contains(getSelection().anchorNode) && code.getBoundingClientRect().height > 10;
      }), true);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('pasting an opening HTML tag keeps the caret inside its editable source', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '\n');
      const original = await evaluate(() => {
        let paragraph = editorTest.root().querySelector('p');
        if (!paragraph) {
          paragraph = document.createElement('p');
          paragraph.dataset.block = '0';
          editorTest.root().appendChild(paragraph);
        }
        editorTest.setSelection(paragraph, 0);
        const original = editorTest.markdown();
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', '<center>');
        paragraph.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        return original;
      });
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.equal(await evaluate(() => {
        const code = editorTest.root().querySelector('.markl-html-draft .vditor-ir__marker--pre code');
        return code?.contains(getSelection().anchorNode) && code.getBoundingClientRect().height > 10;
      }), true, 'plain-text paste leaves the caret in the new HTML draft');
      assert.equal(await evaluate(() => editorTest.markdown()), '<center>\n');
      const shortcut = (key) => evaluate((key) => editorTest.root().dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true })), key);
      await shortcut('z');
      await waitFor(() => !editorTest.markdown().includes('<center>'), 'undo the newly pasted opening tag');
      assert.equal(await evaluate(() => editorTest.markdown()), original);
      await shortcut('y');
      await waitFor(() => editorTest.markdown().includes('<center>'), 'redo the newly pasted opening tag');
      assert.equal(await evaluate(() => editorTest.root().querySelector('.markl-html-draft code')?.contains(getSelection().anchorNode)), true);
      await evaluate(() => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', '\n居中内容\n</center>');
        getSelection().anchorNode.parentElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      });
      assert.match(await evaluate(() => editorTest.markdown()), /<center>\n居中内容\n<\/center>/);
      assert.match(await evaluate(() => document.getElementById('counts').textContent), /4 字/);
      await evaluate(() => {
        getSelection().anchorNode.parentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      });
      await waitFor(() => !editorTest.root().querySelector('.markl-html-draft'), 'pasted HTML finishes on Enter');
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.vditor-ir__preview center')).textAlign), 'center');
      await evaluate(() => document.execCommand('insertText', false, '继续写正文。'));
      assert.match(await evaluate(() => editorTest.markdown()), /<center>\n居中内容\n<\/center>\n\n继续写正文。/);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('multiline HTML drafts keep surrounding paragraphs and render after leaving the source', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '前面的段落。\n\n<center>\n\n后面的段落。\n');
      await evaluate(async () => {
        const code = editorTest.root().querySelector('.markl-html-draft .vditor-ir__marker--pre code');
        editorTest.setSelection(code.firstChild, code.firstChild.length);
        const enter = () => getSelection().anchorNode.parentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        enter();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        document.execCommand('insertText', false, '多行居中内容');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        enter();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        document.execCommand('insertText', false, '</center>');
      });
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const draft = await evaluate(() => {
        const code = editorTest.root().querySelector('.markl-html-draft .vditor-ir__marker--pre code');
        return { markdown: editorTest.markdown(), visible: getComputedStyle(code.parentElement).display, caret: code.contains(getSelection().anchorNode) };
      });
      assert.match(draft.markdown, /前面的段落。/);
      assert.match(draft.markdown, /<center>\n+多行居中内容\n<\/center>/);
      assert.match(draft.markdown, /后面的段落。/);
      assert.equal(draft.visible, 'block');
      assert.equal(draft.caret, true);
      await evaluate(() => {
        const paragraph = [...editorTest.root().querySelectorAll('p')].find((p) => p.textContent === '后面的段落。');
        editorTest.setSelection(paragraph.firstChild, 0);
      });
      await waitFor(() => !editorTest.root().querySelector('.markl-html-draft'), 'multiline HTML finishes');
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.vditor-ir__preview center')).textAlign), 'center');
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('pasted HTML drafts undo, redo and finish with Enter without losing surrounding text', async () => {
      const original = '前面的段落。\n\n<center>\n\n后面的段落。\n';
      await evaluate((markdown) => editorTest.setMarkdown(markdown), original);
      await evaluate(() => {
        const code = editorTest.root().querySelector('.markl-html-draft .vditor-ir__marker--pre code');
        editorTest.setSelection(code.firstChild, code.firstChild.length);
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', '\n粘贴的居中内容\n</center>');
        code.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      });
      const pasted = await evaluate(() => editorTest.markdown());
      assert.match(pasted, /<center>\n粘贴的居中内容\n<\/center>/);
      const shortcut = (key) => evaluate((key) => editorTest.root().dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true })), key);
      await shortcut('z');
      await waitFor(() => !editorTest.markdown().includes('粘贴的居中内容'), 'HTML draft undo');
      assert.equal(await evaluate(() => editorTest.markdown()), original);
      await shortcut('y');
      await waitFor(() => editorTest.markdown().includes('粘贴的居中内容'), 'HTML draft redo');
      assert.equal(await evaluate(() => editorTest.markdown()), pasted);
      await evaluate(() => {
        getSelection().anchorNode.parentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      });
      await waitFor(() => !editorTest.root().querySelector('.markl-html-draft'), 'Enter finishes the HTML draft');
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.vditor-ir__preview center')).textAlign), 'center');
      await evaluate(() => document.execCommand('insertText', false, '继续写正文。'));
      const final = await evaluate(() => editorTest.markdown());
      assert.match(final, /前面的段落。/);
      assert.match(final, /继续写正文。\n\n后面的段落。/);
      assert.match(final, /<center>\n粘贴的居中内容\n<\/center>/);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('typing paired inline HTML and continuing text preserves source and visible caret', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '前文 \n');
      await evaluate(async () => {
        const paragraph = editorTest.root().querySelector('p');
        editorTest.setSelection(paragraph.firstChild, paragraph.firstChild.length);
        for (const character of '<span style="color:red">红字</span> 后文') {
          document.execCommand('insertText', false, character);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      });
      const result = await evaluate(() => {
        const wrapper = editorTest.root().querySelector('.markl-html-inline');
        return { markdown: editorTest.markdown(), color: getComputedStyle(wrapper).color, selectedText: getSelection().anchorNode.textContent };
      });
      assert.match(result.markdown, /前文\s*<span style="color:red">红字<\/span> 后文/);
      assert.equal(result.color, 'rgb(255, 0, 0)');
      assert.match(result.selectedText, /后文/);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('inline HTML applies color, font size and quoted attributes', async () => {
      const result = await evaluate(() => {
        const wrapper = editorTest.root().querySelector('.markl-html-inline[style]');
        return wrapper && { color: getComputedStyle(wrapper).color, size: getComputedStyle(wrapper).fontSize, title: wrapper.title };
      });
      assert.deepEqual(result, { color: 'rgb(221, 51, 51)', size: '22px', title: 'a > b' });
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('font.markl-html-inline')).color), 'rgb(38, 116, 191)');
    });
    await test('HTML decoration preserves source on save and source-mode round trip', async () => {
      assert.equal(await evaluate(() => editorTest.markdown()), sample);
      const source = await evaluate(() => {
        document.getElementById('mode-label').click();
        return document.getElementById('source-editor').value;
      });
      assert.equal(source, sample);
      await evaluate(() => document.getElementById('mode-label').click());
      await waitFor(() => document.querySelector('.markl-html-inline[style]'), 'inline render after source mode');
      win.webContents.send('menu:save');
      await waitFor(() => document.getElementById('save-status').textContent === '已保存', 'saved');
      assert.equal(writes.at(-1)?.content, sample);
    });
    await test('editing block HTML never inserts a source row into document layout', async () => {
      const result = await evaluate(() => {
        const block = editorTest.root().querySelector('[data-type="html-block"]');
        const next = block.nextElementSibling;
        const top = next.getBoundingClientRect().top;
        const preview = block.querySelector('.vditor-ir__preview');
        const center = preview.querySelector('div');
        block.classList.add('vditor-ir__node--expand');
        preview.click();
        return { delta: next.getBoundingClientRect().top - top,
          sourceDisplay: getComputedStyle(block.querySelector('.vditor-ir__marker--pre')).display,
          color: getComputedStyle(center).color, align: getComputedStyle(center).textAlign,
          popup: !document.querySelector('.html-source-popover').classList.contains('hidden') };
      });
      assert.deepEqual(result, { delta: 0, sourceDisplay: 'none', color: 'rgb(33, 136, 75)', align: 'center', popup: true });
      await evaluate(() => {
        const panel = document.querySelector('.html-source-popover');
        panel.querySelector('textarea').value = '<div style="text-align:right;color:#2674bf">已修改<br>第二行</div>';
        panel.querySelector('[data-action="apply"]').click();
      });
      await waitFor(() => editorTest.root().querySelector('.vditor-ir__preview div')?.textContent.includes('已修改'), 'HTML apply');
      assert.match(await evaluate(() => editorTest.markdown()), /<div style="text-align:right;color:#2674bf">已修改<br>第二行<\/div>/);
    });
    await test('HTML source changes undo and redo in one step', async () => {
      await evaluate(() => editorTest.root().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true })));
      await waitFor(() => editorTest.markdown().includes('居中的绿色文字'), 'undo HTML');
      assert.equal(await evaluate(() => editorTest.markdown()), sample);
      await evaluate(() => editorTest.root().dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true })));
      await waitFor(() => editorTest.markdown().includes('已修改'), 'redo HTML');
    });
    await test('nested HTML, Markdown and line breaks preserve text and selection', async () => {
      const nested = '前面<span style="color:red">红字 <strong style="font-size:20px">**粗体**</strong>尾部</span><br>下一行，<span style="color:blue">蓝字</span>结束。\n';
      await evaluate((markdown) => editorTest.setMarkdown(markdown), nested);
      assert.equal(await evaluate(() => editorTest.markdown()), nested);
      assert.equal(await evaluate(() => editorTest.root().querySelectorAll('.markl-html-inline').length), 3);
      const result = await evaluate(() => {
        const root = editorTest.root();
        // Repeat decoration with a backwards element-offset selection in a fresh IR paragraph.
        root.innerHTML = Lute.New().Md2VditorIRDOM('前面<span style="color:red">红字</span>后面');
        const paragraph = root.firstElementChild;
        getSelection().setBaseAndExtent(paragraph, 5, paragraph, 2);
        const expected = getSelection().toString();
        editorTest.decorate(root);
        return { same: getSelection().toString() === expected, anchor: getSelection().anchorNode.nodeName,
          focus: getSelection().focusNode.nodeName, focusOffset: getSelection().focusOffset };
      });
      assert.equal(result.same, true);
      assert.equal(result.focus, 'SPAN');
      assert.equal(result.focusOffset, 1);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('typing inside styled text keeps the style, HTML and caret', async () => {
      await evaluate(() => {
        const wrapper = editorTest.root().querySelector('.markl-html-inline[style]');
        const text = [...wrapper.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        editorTest.setSelection(text, 2);
        document.execCommand('insertText', false, '新增');
      });
      await waitFor(() => editorTest.root().querySelector('.markl-html-inline[style]')?.textContent.includes('红色新增大字'), 'styled typing');
      const result = await evaluate(() => ({
        source: editorTest.markdown(),
        color: getComputedStyle(editorTest.root().querySelector('.markl-html-inline[style]')).color,
        caretText: getSelection().anchorNode.textContent, caret: getSelection().anchorOffset
      }));
      assert.equal(result.source, sample.replace('红色大字', '红色新增大字'));
      assert.equal(result.color, 'rgb(221, 51, 51)');
      assert.equal(result.caretText.slice(0, result.caret), '红色新增');
      await waitFor(() => document.getElementById('save-status').textContent === '尚未保存', 'typing recorded');
      await evaluate(() => editorTest.root().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true })));
      await waitFor(() => !editorTest.markdown().includes('红色新增大字'), 'undo typing');
      assert.equal(await evaluate(() => editorTest.markdown()), sample);
      await waitFor(() => editorTest.root().querySelector('.markl-html-inline[style]'), 'styled render after undo');
    });
    await test('inline HTML popup applies styles and cancel preserves the original content', async () => {
      await evaluate(() => editorTest.root().querySelector('.markl-html-inline[style]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
      assert.equal(await evaluate(() => document.querySelector('.html-source-popover textarea').value), '<span style="color:#d33;font-size:22px" title="a > b">红色大字</span>');
      await evaluate(() => {
        const panel = document.querySelector('.html-source-popover');
        panel.querySelector('textarea').value = '<span style="color:purple;font-size:24px">紫色大字</span>';
        panel.querySelector('[data-action="cancel"]').click();
      });
      assert.equal(await evaluate(() => editorTest.markdown()), sample);
      await evaluate(() => {
        editorTest.root().querySelector('.markl-html-inline[style]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        const panel = document.querySelector('.html-source-popover');
        panel.querySelector('textarea').value = '<span style="color:purple;font-size:24px">紫色大字</span>';
        panel.querySelector('[data-action="apply"]').click();
      });
      assert.equal(await evaluate(() => getComputedStyle(editorTest.root().querySelector('.markl-html-inline[style]')).color), 'rgb(128, 0, 128)');
      assert.match(await evaluate(() => editorTest.markdown()), /<span style="color:purple;font-size:24px">紫色大字<\/span>/);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('clicking outside the HTML source panel applies valid edits and keeps invalid edits reachable', async () => {
      await evaluate(() => {
        const wrapper = editorTest.root().querySelector('.markl-html-inline[style]');
        wrapper.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        document.querySelector('.html-source-popover textarea').value = '<span style="color:purple">保留修改</span>';
        document.getElementById('doc-title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
      assert.match(await evaluate(() => editorTest.markdown()), /<span style="color:purple">保留修改<\/span>/);
      assert.equal(await evaluate(() => document.querySelector('.html-source-popover').classList.contains('hidden')), true);
      await evaluate(() => {
        const wrapper = editorTest.root().querySelector('.markl-html-inline[style]');
        wrapper.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        document.querySelector('.html-source-popover textarea').value = '<div>块级内容</div>\n\n另一个段落';
        document.getElementById('doc-title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
      assert.equal(await evaluate(() => document.querySelector('.html-source-popover').classList.contains('hidden')), false);
      assert.equal(await evaluate(() => document.querySelector('.html-source-error').textContent), '行内 HTML 请在同一段中编辑。');
      assert.match(await evaluate(() => editorTest.markdown()), /保留修改/);
      await evaluate(() => document.querySelector('.html-source-popover [data-action="cancel"]').click());
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('JavaScript and Python code previews are highlighted without an idle mutation loop', async () => {
      await waitFor(() => [...document.querySelectorAll('[data-type="code-block"] .vditor-ir__preview code')].every((code) => code.querySelector('[class^="hljs-"]')), 'code highlights');
      const mutations = await evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let recordsSeen = [];
        const observer = new MutationObserver((records) => { recordsSeen.push(...records.map((record) => ({ type: record.type, attribute: record.attributeName, host: record.target.outerHTML?.slice(0, 180) || record.target.textContent }))); });
        observer.observe(editorTest.root(), { subtree: true, childList: true, characterData: true, attributes: true });
        await new Promise((resolve) => setTimeout(resolve, 250));
        observer.disconnect();
        return recordsSeen;
      });
      assert.deepEqual(mutations, []);
    });
    await test('live code highlighting keeps block height and glyphs aligned during typing and IME', async () => {
      const collapsed = await evaluate(() => {
        const block = editorTest.root().querySelector('[data-type="code-block"]');
        const height = block.getBoundingClientRect().height;
        const code = block.querySelector('.vditor-ir__marker--pre code');
        block.classList.add('vditor-ir__node--expand');
        editorTest.setSelection(code.firstChild, 0);
        return height;
      });
      await waitFor(() => !document.querySelector('.markl-live-hl').classList.contains('hidden'), 'live highlight');
      const focused = await evaluate(() => {
        const block = editorTest.root().querySelector('[data-type="code-block"]');
        const code = block.querySelector('.vditor-ir__marker--pre code');
        const overlay = document.querySelector('.markl-live-hl');
        const glyph = (node) => {
          const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
          const range = document.createRange();
          range.setStart(text, 0); range.setEnd(text, 1);
          const rect = range.getBoundingClientRect();
          return [rect.x, rect.y];
        };
        const a = glyph(code), b = glyph(overlay);
        return { height: block.getBoundingClientRect().height, dx: a[0] - b[0], dy: a[1] - b[1], tokens: overlay.querySelectorAll('[class^="hljs-"]').length };
      });
      assert.ok(Math.abs(focused.height - collapsed) < 1, 'entering code does not shift the document');
      assert.ok(Math.abs(focused.dx) < 1 && Math.abs(focused.dy) < 1, 'overlay lines up with the caret');
      assert.ok(focused.tokens > 0);
      const caret = await evaluate(() => {
        const selection = getSelection();
        return { collapsed: selection.isCollapsed, offset: selection.anchorOffset, text: selection.anchorNode.textContent };
      });
      assert.equal(caret.collapsed, true);
      assert.equal(caret.offset, 0);
      assert.match(caret.text, /^function greet/);
      await evaluate(() => document.execCommand('insertText', false, '// 新增注释 '));
      await waitFor(() => document.querySelector('.markl-live-hl').textContent.startsWith('// 新增注释'), 'highlight follows input');
      const typed = await evaluate(() => editorTest.markdown());
      assert.match(typed, /```javascript\n\/\/ 新增注释/);
      assert.match(typed, /function greet\(name\)/);
      assert.match(typed, /return message;/);
      const duringIme = await evaluate(() => {
        editorTest.root().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }));
        const source = editorTest.root().querySelector('[data-type="code-block"].vditor-ir__node--expand .vditor-ir__marker--pre code');
        return { color: getComputedStyle(source).color, hidden: document.querySelector('.markl-live-hl').classList.contains('hidden') };
      });
      assert.notEqual(duringIme.color, 'rgba(0, 0, 0, 0)');
      assert.equal(duringIme.hidden, true);
      await evaluate(() => editorTest.root().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' })));
      await waitFor(() => !document.querySelector('.markl-live-hl').classList.contains('hidden'), 'highlight resumes after IME');
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('three backticks plus Enter creates a code block and language selection', async () => {
      await evaluate((markdown) => editorTest.setMarkdown(markdown), '\n');
      await evaluate(async () => {
        let paragraph = editorTest.root().querySelector('p');
        if (!paragraph) {
          paragraph = document.createElement('p');
          paragraph.dataset.block = '0';
          editorTest.root().appendChild(paragraph);
        }
        editorTest.setSelection(paragraph, 0);
        for (const character of '```') {
          document.execCommand('insertText', false, character);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        const host = getSelection().anchorNode.parentElement;
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        host.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      });
      await waitFor(() => editorTest.root().querySelector('[data-type="code-block"]'), 'backtick code creation');
      await waitFor(() => !document.getElementById('language-popup').classList.contains('hidden') && document.activeElement === document.getElementById('language-query-input'), 'language selection');
      await evaluate(() => {
        const option = document.querySelector('.language-option');
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
      await waitFor(() => document.getElementById('language-popup').classList.contains('hidden') && editorTest.root().querySelector('[data-type="code-block"] .vditor-ir__marker--pre code')?.contains(getSelection().anchorNode) && document.activeElement === editorTest.root(), 'language selected and code caret restored');
      await evaluate(() => document.execCommand('insertText', false, 'const value = 42;'));
      assert.match(await evaluate(() => editorTest.markdown()), /const value = 42;/);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    await test('continuous typing in a long document preserves all HTML, code and paragraphs', async () => {
      const content = '# 长文档输入检查\n\n' + Array.from({ length: 400 }, (_,i) =>
        `第 ${i+1} 段，<span style="color:#2674bf">蓝色文字</span>，普通正文保持完整。`).join('\n\n') +
        '\n\n' + Array.from({ length: 20 }, (_,i) => '```javascript\nconst value' + i + ' = ' + i + ';\n```').join('\n\n') + '\n\n输入位置。\n';
      await evaluate((markdown) => editorTest.setMarkdown(markdown), content);
      const text = '连续输入保持正文和样式。';
      const duration = await evaluate(async (text) => {
        const paragraph = [...editorTest.root().querySelectorAll('p')].find((p) => p.textContent === '输入位置。');
        editorTest.setSelection(paragraph.firstChild, paragraph.firstChild.length);
        const start = performance.now();
        for (const character of text) {
          document.execCommand('insertText', false, character);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return performance.now() - start;
      }, text);
      assert.equal(await evaluate(() => editorTest.markdown()), content.replace('输入位置。', '输入位置。' + text));
      assert.equal(await evaluate(() => editorTest.root().querySelectorAll('.markl-html-inline').length), 400);
      assert.equal(await evaluate(() => editorTest.root().querySelectorAll('.vditor-ir__node[data-type="code-block"]').length), 20);
      console.log(`  Long document: ${Math.round(duration)} ms for ${text.length} characters with a frame between inputs.`);
      await evaluate((markdown) => editorTest.setMarkdown(markdown), sample);
    });
    assert.deepEqual(errors, [], 'renderer errors');
    console.log('Electron editor regression checks passed.');
    if (process.env.MARKL_TEST_VISIBLE) {
      console.log(`Visible test profile: ${profile}`);
      return;
    }
    win.destroy();
    app.quit();
  }
  run().catch(async (error) => {
    console.error(error);
    if (errors.length) console.error('Renderer errors:', errors);
    if (win && !win.isDestroyed()) {
      fs.writeFileSync(path.join(profile, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(profile, 'failure.html'), await evaluate(() => document.documentElement.outerHTML));
      console.error(`Failure artifacts: ${profile}`);
    }
    app.exit(1);
  });
}
