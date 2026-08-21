import { baseName, escapeHtml, isPathInside, samePath } from './path-utils.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(baseName('C:/docs/说明.md') === '说明.md', 'basename failed');
assert(samePath('C:\\a\\b.md', 'c:/a/b.md'), 'samePath failed');
assert(isPathInside('C:/work/a.md', 'C:/work'), 'inside failed');
assert(!isPathInside('C:/other/a.md', 'C:/work'), 'outside failed');
assert(escapeHtml('<&>') === '&lt;&amp;&gt;', 'escape failed');

console.log('path-utils tests passed');
