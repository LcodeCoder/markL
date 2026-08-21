import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { MEASURE_CSS, normalizePrefs } = require('./prefs.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = normalizePrefs({});
assert(defaults.autoSave === true, 'autosave default');
assert(defaults.followSystemTheme === false, 'follow default');
assert(defaults.measure === 'standard', 'measure default');
assert(MEASURE_CSS.standard === '1120px', 'measure css');

const next = normalizePrefs({
  autoSave: false,
  followSystemTheme: true,
  lineNumbers: true,
  measure: 'wide',
  ignoredDirectories: 'node_modules, dist, dist, ../hack, .git'
});
assert(next.autoSave === false, 'autosave off');
assert(next.measure === 'wide', 'wide measure');
assert(next.ignoredDirectories.includes('node_modules'), 'keep node_modules');
assert(!next.ignoredDirectories.includes('../hack'), 'reject path fragments');
assert(next.ignoredDirectories.filter((name) => name === 'dist').length === 1, 'dedupe');

console.log('prefs tests passed');
