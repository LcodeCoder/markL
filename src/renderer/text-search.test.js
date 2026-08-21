import {
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
  parseHeadingOutline
} from './text-search.js';
import { typesetChineseMarkdown } from './zh-typeset.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const text = 'Foo foo FOO food';
assert(collectMatches(text, 'foo').length === 4, 'case-insensitive should find 4');
assert(collectMatches(text, 'foo', { caseSensitive: true }).length === 2, 'case-sensitive should find foo and food prefix');
assert(collectMatches('aaa', 'aa').length === 1, 'matches should not overlap');
assert(collectMatches('foo food', 'foo', { wholeWord: true }).length === 1, 'whole word should skip food');
assert(collectMatches('ab12 ab', 'ab', { wholeWord: true }).length === 1, 'whole word should skip ab12');
assert(collectMatches('cat cot cut', 'c.t', { regex: true }).length === 3, 'regex should match c.t');
assert(compileSearch('(', { regex: true }).error === '正则无效', 'invalid regex should report error');
assert(replaceAllMatches('foo food', 'foo', 'bar', { wholeWord: true }).text === 'bar food', 'whole-word replace failed');

const typeset = typesetChineseMarkdown('写API文档,例如JSON。\n```js\nconst a=1\n```\n尾空格  \n看 http://a.com 即可');
assert(typeset.includes('写 API 文档，例如 JSON。'), `cjk spacing/punct failed: ${typeset}`);
assert(typeset.includes('```js\nconst a=1\n```'), 'fenced code should stay');
assert(typeset.includes('http://a.com'), 'url should stay');
assert(typeset.includes('\n尾空格\n'), `trailing spaces should be trimmed: ${JSON.stringify(typeset)}`);

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

const atxOutline = parseHeadingOutline('# 一\n## 二\n### 三');
assert(atxOutline.map((item) => `${item.level}:${item.text}`).join('|') === '1:一|2:二|3:三', 'atx outline failed');

const setextOutline = parseHeadingOutline('一级\n===\n\n二级\n---');
assert(setextOutline.map((item) => `${item.level}:${item.text}`).join('|') === '1:一级|2:二级', 'setext outline failed');

const htmlOutline = parseHeadingOutline('<h1 align="center">MarkL</h1>\n<h2>安装</h2>\n<H3>下载</H3>');
assert(
  htmlOutline.map((item) => `${item.level}:${item.text}`).join('|') === '1:MarkL|2:安装|3:下载',
  `html outline failed: ${htmlOutline.map((item) => item.text).join(',')}`
);

const mixedOutline = parseHeadingOutline('# Markdown 标题\n\n<h2>HTML 标题</h2>');
assert(mixedOutline.length === 2 && mixedOutline[1].level === 2 && mixedOutline[1].text === 'HTML 标题', 'mixed outline failed');

const innerHtmlOutline = parseHeadingOutline('<h1><strong>粗体</strong> 标题</h1>');
assert(innerHtmlOutline[0]?.text === '粗体 标题', `inner html heading failed: ${innerHtmlOutline[0]?.text}`);

const multilineOutline = parseHeadingOutline('<h1>\n多行标题\n</h1>');
assert(multilineOutline[0]?.text === '多行标题', `multiline html heading failed: ${multilineOutline[0]?.text}`);

const fencedOutline = parseHeadingOutline('```html\n<h1>代码里</h1>\n```\n# 真标题');
assert(fencedOutline.length === 1 && fencedOutline[0].text === '真标题', 'fenced html heading should be ignored');

const commentedOutline = parseHeadingOutline('<!-- <h1>隐藏</h1> -->\n<!--\n<h2>注释块</h2>\n-->\n# 可见');
assert(commentedOutline.length === 1 && commentedOutline[0].text === '可见', 'commented html heading should be ignored');

const emptyHtmlOutline = parseHeadingOutline('<h1></h1>\n<h2>有字</h2>');
assert(emptyHtmlOutline.length === 1 && emptyHtmlOutline[0].text === '有字', 'empty html heading should be skipped');

const unclosedHtmlOutline = parseHeadingOutline('<h1>半截\n# 后面的标题');
assert(
  unclosedHtmlOutline.map((item) => item.text).join('|') === '半截|后面的标题',
  `unclosed html heading should not swallow following markdown: ${unclosedHtmlOutline.map((item) => item.text).join(',')}`
);

console.log('text-search tests passed');
