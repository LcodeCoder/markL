const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ASCII_TOKEN = /[A-Za-z0-9]/;
const PUNCT_MAP = {
  ',': '，',
  '.': '。',
  ':': '：',
  ';': '；',
  '?': '？',
  '!': '！',
  '(': '（',
  ')': '）'
};

function protectSegments(text) {
  const slots = [];
  const protectedText = String(text || '').replace(
    /(`{3,}[\s\S]*?`{3,}|`[^`\n]+`|\[[^\]]*\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|https?:\/\/[^\s)\u3400-\u9fff]+|<[^>]+>)/g,
    (chunk) => {
      const key = `\u0000${slots.length}\u0000`;
      slots.push(chunk);
      return key;
    }
  );
  return { text: protectedText, slots };
}

function restoreSegments(text, slots) {
  return String(text || '').replace(/\u0000(\d+)\u0000/g, (_, index) => slots[Number(index)] || '');
}

function convertPunct(prev, ch, next) {
  const mapped = PUNCT_MAP[ch];
  if (!mapped) return ch;
  if (ch === '.' && /\d/.test(prev) && /\d/.test(next)) return ch;
  if (ch === '.' && /\d/.test(prev) && /\s/.test(next)) return ch;
  if (CJK.test(prev) || CJK.test(next)) return mapped;
  return ch;
}

function typesetLine(line) {
  if (!line) return line;
  const lead = line.match(/^\s*/)[0];
  let body = line.slice(lead.length).replace(/[ \t]+$/g, '');
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = out[out.length - 1] || '';
    const next = body[i + 1] || '';
    const converted = convertPunct(prev, ch, next);
    if (prev && ((CJK.test(prev) && ASCII_TOKEN.test(converted)) || (ASCII_TOKEN.test(prev) && CJK.test(converted)))) {
      out += ' ';
    }
    out += converted;
  }
  return lead + out.replace(/ {2,}/g, ' ');
}

export function typesetChineseMarkdown(markdown) {
  const source = String(markdown || '').replace(/\r\n/g, '\n');
  const { text, slots } = protectSegments(source);
  const next = text.split('\n').map(typesetLine).join('\n');
  return restoreSegments(next, slots);
}
