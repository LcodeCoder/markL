export const FIND_MATCH_LIMIT = 5000;

export function collectMatches(text, query, options = {}) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) return [];

  const caseSensitive = Boolean(options.caseSensitive);
  const haystack = caseSensitive ? source : source.toLowerCase();
  const find = caseSensitive ? needle : needle.toLowerCase();
  const matches = [];
  let from = 0;

  while (from <= haystack.length - find.length) {
    const index = haystack.indexOf(find, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    if (matches.length >= FIND_MATCH_LIMIT) break;
    from = index + needle.length;
  }

  return matches;
}

export function replaceRange(text, start, end, replacement) {
  const source = String(text || '');
  return source.slice(0, start) + String(replacement ?? '') + source.slice(end);
}

export function replaceAllMatches(text, query, replacement, options = {}) {
  const source = String(text || '');
  const matches = collectMatches(source, query, options);
  if (!matches.length) return { text: source, count: 0 };

  const insert = String(replacement ?? '');
  let result = source;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    result = replaceRange(result, matches[index].start, matches[index].end, insert);
  }
  return { text: result, count: matches.length };
}

export function lineNumberAt(text, index) {
  if (index <= 0) return 0;
  return String(text || '').slice(0, index).split('\n').length - 1;
}

export function visibleLineHint(lineText) {
  return String(lineText || '')
    .replace(/^\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*?|__?/g, '')
    .trim();
}

export function toMarkdownImage(alt, relativePath) {
  const name = String(alt || '').replace(/[[\]]/g, '');
  const src = String(relativePath || '').replace(/[()]/g, '');
  return `![${name}](${src})`;
}

export function rewriteFileUrls(markdown, resolveUrl) {
  return String(markdown || '').replace(/file:\/\/[^\s)"']+/gi, (url) => {
    const trimmed = url.replace(/[.,;]+$/, '');
    return resolveUrl(trimmed) || url;
  });
}

export function imageAltFromName(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/^pasted-\d{8}-\d{6}(?:-\d+)?$/i, '')
    .trim();
}
