const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_RE = /[A-Za-z0-9]+(?:['_-][A-Za-z0-9]+)*/g;

export function countProse(text) {
  const source = String(text || '');
  const characters = Array.from(source).length;
  const cjk = (source.match(CJK_RE) || []).length;
  const latinWords = (source.replace(CJK_RE, ' ').match(LATIN_RE) || []).length;
  return {
    characters,
    cjk,
    latinWords,
    words: cjk + latinWords
  };
}

export function countMarkdownStats(markdown, selectionText = '') {
  const raw = String(markdown || '').replace(/\n+$/, '');
  const lines = raw ? raw.split('\n').length : 0;
  const paragraphs = raw ? raw.split(/\n\s*\n/).filter((block) => block.trim()).length : 0;
  const selection = selectionText ? countProse(selectionText) : null;
  return { lines, paragraphs, selection };
}
