import { collapseUnchanged, diffLines } from './text-diff.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const same = diffLines('a\nb', 'a\nb');
assert(same.every((line) => line.type === 'same') && same.length === 2, 'identical failed');

const changed = diffLines('hello\nworld', 'hello\nmarkl');
assert(changed.map((line) => line.type).join(',') === 'same,del,add', `edit failed: ${changed.map((line) => line.type)}`);

const added = diffLines('a', 'a\nb');
assert(added[1]?.type === 'add' && added[1].text === 'b', 'add failed');

const removed = diffLines('a\nb', 'a');
assert(removed[1]?.type === 'del' && removed[1].text === 'b', 'delete failed');

const manySame = collapseUnchanged(
  Array.from({ length: 12 }, () => ({ type: 'same', text: 'x' })),
  2
);
assert(manySame.some((line) => line.type === 'skip'), 'collapse should skip long unchanged runs');

console.log('text-diff tests passed');
