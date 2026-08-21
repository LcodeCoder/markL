import { countMarkdownStats, countProse } from './word-count.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const mixed = countProse('写 API 文档 two words');
assert(mixed.cjk === 3, `cjk failed: ${mixed.cjk}`);
assert(mixed.latinWords === 3, `latin failed: ${mixed.latinWords}`);
assert(mixed.words === 6, `words failed: ${mixed.words}`);

const stats = countMarkdownStats('# 标题\n\n一段\n\n两段', '选区');
assert(stats.lines === 5, `lines failed: ${stats.lines}`);
assert(stats.paragraphs === 3, `paragraphs failed: ${stats.paragraphs}`);
assert(stats.selection.words === 2, 'selection words failed');
assert(!countMarkdownStats('').selection, 'no selection should be null');

console.log('word-count tests passed');
