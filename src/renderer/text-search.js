export const FIND_MATCH_LIMIT = 5000;

function isWordChar(ch) {
  return /[A-Za-z0-9_\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch || '');
}

function isWholeWordBoundary(text, start, end) {
  return (start <= 0 || !isWordChar(text[start - 1])) && (end >= text.length || !isWordChar(text[end]));
}

export function compileSearch(query, options = {}) {
  const needle = String(query || '');
  if (!needle) return { error: '', matches: () => [] };
  if (options.regex) {
    try {
      const re = new RegExp(needle, options.caseSensitive ? 'g' : 'gi');
      return {
        error: '',
        matches(text) {
          const source = String(text || '');
          const out = [];
          re.lastIndex = 0;
          let hit = re.exec(source);
          while (hit) {
            if (!hit[0]) {
              re.lastIndex += 1;
              hit = re.exec(source);
              continue;
            }
            const start = hit.index;
            const end = start + hit[0].length;
            if (!options.wholeWord || isWholeWordBoundary(source, start, end)) {
              out.push({ start, end });
              if (out.length >= FIND_MATCH_LIMIT) break;
            }
            hit = re.exec(source);
          }
          return out;
        }
      };
    } catch {
      return { error: '正则无效', matches: () => [] };
    }
  }

  return {
    error: '',
    matches(text) {
      const source = String(text || '');
      const haystack = options.caseSensitive ? source : source.toLowerCase();
      const find = options.caseSensitive ? needle : needle.toLowerCase();
      const out = [];
      let from = 0;
      while (from <= haystack.length - find.length) {
        const index = haystack.indexOf(find, from);
        if (index === -1) break;
        const end = index + needle.length;
        if (!options.wholeWord || isWholeWordBoundary(source, index, end)) {
          out.push({ start: index, end });
          if (out.length >= FIND_MATCH_LIMIT) break;
        }
        from = index + needle.length;
      }
      return out;
    }
  };
}

export function collectMatches(text, query, options = {}) {
  return compileSearch(query, options).matches(text);
}

export function replaceRange(text, start, end, replacement) {
  const source = String(text || '');
  return source.slice(0, start) + String(replacement ?? '') + source.slice(end);
}

export function replaceAllMatches(text, query, replacement, options = {}) {
  const source = String(text || '');
  const compiled = compileSearch(query, options);
  if (compiled.error) return { text: source, count: 0, error: compiled.error };
  const matches = compiled.matches(source);
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

const DANGEROUS_HTML_TAGS = /^(script|iframe|object|embed|link|meta|base|form|svg|math|video|audio|source|track|frame|frameset|applet|html|head|body|style)$/i;

function sanitizeHtmlFragment(text) {
  let next = String(text || '');
  next = next.replace(/<(script|iframe|object|embed|link|meta|base|form|svg|math|video|audio|style|frame|frameset|applet)(\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
  next = next.replace(/<(script|iframe|object|embed|link|meta|base|form|svg|math|video|audio|style|frame|frameset|applet)(\s[^>]*)?\/?>/gi, '');
  return next.replace(/<([a-zA-Z][\w:-]*)([^>]*)>/g, (_full, tag, attrs) => {
    if (DANGEROUS_HTML_TAGS.test(tag)) return '';
    const cleaned = String(attrs || '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(href|src|xlink:href|action|formaction)\s*=\s*(['"]?)\s*(javascript|vbscript):[^'"\s>]*/gi, '')
      .replace(/\ssrc\s*=\s*(['"]?)\s*data:text\/html[^'"\s>]*/gi, '');
    return `<${tag}${cleaned}>`;
  });
}

export function sanitizeMarkdownHtml(markdown) {
  const source = String(markdown || '');
  const parts = [];
  const skip = /```[\s\S]*?```|`[^`]*`/g;
  let last = 0;
  let match = skip.exec(source);
  while (match) {
    parts.push(sanitizeHtmlFragment(source.slice(last, match.index)));
    parts.push(match[0]);
    last = match.index + match[0].length;
    match = skip.exec(source);
  }
  parts.push(sanitizeHtmlFragment(source.slice(last)));
  return parts.join('');
}

export function cleanHeadingText(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHeadingEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlHeadingText(raw) {
  return cleanHeadingText(decodeHeadingEntities(String(raw || '').replace(/<[^>]+>/g, ' ')));
}

function lineWithoutHtmlComments(line) {
  return String(line || '').replace(/<!--[\s\S]*?-->/g, '');
}

function readHtmlHeading(lines, index) {
  const line = lineWithoutHtmlComments(lines[index]);
  const open = line.match(/^\s{0,3}<h([1-6])\b[^>]*>/i);
  if (!open) return null;

  const level = Number(open[1]);
  const closeRe = new RegExp(`</h${level}\\s*>`, 'i');
  const after = line.slice(open[0].length);
  const closeAt = after.search(closeRe);
  if (closeAt >= 0) {
    return { level, text: after.slice(0, closeAt), end: index };
  }

  const parts = [after];
  let end = index;
  for (let next = index + 1; next < lines.length; next += 1) {
    const candidate = lineWithoutHtmlComments(lines[next]);
    if (!candidate.trim()) {
      end = next - 1;
      break;
    }
    const found = candidate.search(closeRe);
    if (found >= 0) {
      parts.push(candidate.slice(0, found));
      end = next;
      break;
    }
    if (/^\s{0,3}<h([1-6])\b/i.test(candidate) || /^(#{1,6})\s+/.test(candidate) || /^(`{3,}|~{3,})/.test(candidate)) {
      end = next - 1;
      break;
    }
    parts.push(candidate);
    end = next;
  }

  return { level, text: parts.join(' '), end };
}

function pushOutlineItem(items, seen, level, text, line) {
  if (!text) return;
  const occurrence = seen.get(text) || 0;
  seen.set(text, occurrence + 1);
  items.push({ level, text, line, occurrence });
}

export function parseHeadingOutline(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const items = [];
  const seen = new Map();
  let inFence = false;
  let fenceChar = '';
  let inHtmlComment = false;
  let start = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) start = end + 1;
  }

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const mark = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = mark;
      } else if (mark === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) continue;

    if (inHtmlComment) {
      if (line.includes('-->')) inHtmlComment = false;
      continue;
    }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) {
      inHtmlComment = true;
      continue;
    }

    const atx = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (atx) {
      pushOutlineItem(items, seen, atx[1].length, cleanHeadingText(atx[2].replace(/\s+#+\s*$/, '')), index);
      continue;
    }

    const htmlHeading = readHtmlHeading(lines, index);
    if (htmlHeading) {
      pushOutlineItem(items, seen, htmlHeading.level, htmlHeadingText(htmlHeading.text), index);
      index = htmlHeading.end;
      continue;
    }

    const next = lines[index + 1];
    if (!line.trim() || line.startsWith('    ') || !next) continue;
    const setext = next.match(/^(=+|-+)\s*$/);
    if (!setext || /^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) continue;
    pushOutlineItem(items, seen, setext[1].startsWith('=') ? 1 : 2, cleanHeadingText(line), index);
  }

  return items;
}

export function visibleProseFromMarkdown(markdown) {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/[-:]{3,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
