import {
  collectMatches,
  replaceRange,
  replaceAllMatches,
  lineNumberAt,
  visibleLineHint,
  toMarkdownImage,
  rewriteFileUrls,
  imageAltFromName,
  sanitizeMarkdownHtml,
  visibleProseFromMarkdown
} from './text-search.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const text = 'Foo foo FOO food';
assert(collectMatches(text, 'foo').length === 4, 'case-insensitive should find 4');
assert(collectMatches(text, 'foo', { caseSensitive: true }).length === 2, 'case-sensitive should find foo and food prefix');
assert(collectMatches('aaa', 'aa').length === 1, 'matches should not overlap');

const replaced = replaceRange('hello world', 6, 11, 'MarkL');
assert(replaced === 'hello MarkL', `replaceRange failed: ${replaced}`);

const all = replaceAllMatches('# 标题\n标题', '标题', '目录');
assert(all.count === 2 && all.text === '# 目录\n目录', `replaceAll failed: ${all.text}`);

assert(lineNumberAt('a\nb\nc', 4) === 2, 'lineNumberAt failed');
assert(visibleLineHint('## 安装说明') === '安装说明', 'heading hint failed');
assert(visibleLineHint('- [链接](./a.md)') === '链接', 'link hint failed');
assert(toMarkdownImage('截图', './assets/a.png') === '![截图](./assets/a.png)', 'image markdown failed');
assert(imageAltFromName('pasted-20260816-120000.png') === '', 'pasted alt should be empty');
assert(imageAltFromName('diagram.png') === 'diagram', 'file alt failed');

const rewritten = rewriteFileUrls(
  '![x](file:///C:/docs/assets/a.png)',
  (url) => (url.includes('a.png') ? './assets/a.png' : null)
);
assert(rewritten === '![x](./assets/a.png)', `rewrite failed: ${rewritten}`);

const cleaned = sanitizeMarkdownHtml('<center>安全</center><script>alert(1)</script><img src=x onerror="steal()">');
assert(cleaned.includes('<center>安全</center>'), 'center should remain');
assert(!/script/i.test(cleaned), 'script tags should be stripped');
assert(!/onerror/i.test(cleaned), 'event handlers should be stripped');
assert(!sanitizeMarkdownHtml('<iframe src="https://evil"></iframe>'), 'iframe should be stripped');
const fenced = sanitizeMarkdownHtml('```html\n<script>alert(1)</script>\n```\n<img src=x onerror="x">');
assert(fenced.includes('<script>alert(1)</script>'), 'fenced script sample should stay');
assert(!/onerror/i.test(fenced), 'HTML outside fences should still be cleaned');

const prose = visibleProseFromMarkdown('# 标题\n\n这是一段 [链接](./a.md) 和 `code`。\n\n```js\nconst x = 1;\n```\n');
assert(prose.includes('标题'), 'heading text should remain');
assert(prose.includes('链接'), 'link label should remain');
assert(!prose.includes('```'), 'fences should be removed');
assert(!prose.includes('const x'), 'code block body should be removed');
assert(!prose.includes('./a.md'), 'link target should be removed');

console.log('text-search tests passed');
