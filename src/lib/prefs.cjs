'use strict';

const DEFAULT_IGNORED = ['.git', '.svn', 'node_modules', 'dist', 'build', '.cache'];
const MEASURE_IDS = ['narrow', 'standard', 'wide', 'full'];
const MEASURE_CSS = {
  narrow: '860px',
  standard: '1120px',
  wide: '1440px',
  full: 'none'
};

const DEFAULT_PREFS = {
  autoSave: true,
  followSystemTheme: false,
  defaultSourceMode: false,
  lineNumbers: false,
  measure: 'standard',
  ignoredDirectories: DEFAULT_IGNORED.slice()
};

function cleanIgnored(list) {
  const source = Array.isArray(list) ? list : String(list || '').split(/[,，\n]/);
  const unique = [];
  const seen = new Set();
  source.forEach((item) => {
    const name = String(item || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(name);
  });
  return unique.length ? unique.slice(0, 40) : DEFAULT_IGNORED.slice();
}

function normalizePrefs(value = {}) {
  return {
    autoSave: value.autoSave !== false,
    followSystemTheme: Boolean(value.followSystemTheme),
    defaultSourceMode: Boolean(value.defaultSourceMode),
    lineNumbers: Boolean(value.lineNumbers),
    measure: MEASURE_IDS.includes(value.measure) ? value.measure : 'standard',
    ignoredDirectories: cleanIgnored(value.ignoredDirectories)
  };
}

module.exports = {
  DEFAULT_IGNORED,
  DEFAULT_PREFS,
  MEASURE_CSS,
  MEASURE_IDS,
  cleanIgnored,
  normalizePrefs
};
