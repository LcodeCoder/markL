function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

export function diffLines(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  const out = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
      continue;
    }

    let inB = -1;
    const look = Math.min(a.length, i + 80);
    for (let next = j; next < Math.min(b.length, j + 80); next += 1) {
      if (b[next] === a[i]) {
        inB = next;
        break;
      }
    }
    let inA = -1;
    for (let next = i; next < look; next += 1) {
      if (a[next] === b[j]) {
        inA = next;
        break;
      }
    }

    if (inB !== -1 && (inA === -1 || (inB - j) <= (inA - i))) {
      while (j < inB) {
        out.push({ type: 'add', text: b[j] });
        j += 1;
      }
      continue;
    }
    if (inA !== -1) {
      while (i < inA) {
        out.push({ type: 'del', text: a[i] });
        i += 1;
      }
      continue;
    }

    out.push({ type: 'del', text: a[i] });
    out.push({ type: 'add', text: b[j] });
    i += 1;
    j += 1;
  }

  while (i < a.length) {
    out.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: 'add', text: b[j] });
    j += 1;
  }
  return out;
}

export function collapseUnchanged(lines, context = 2) {
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'same') {
      result.push(lines[i]);
      i += 1;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].type === 'same') end += 1;
    const run = end - i;
    if (run <= context * 2 + 1) {
      for (let n = i; n < end; n += 1) result.push(lines[n]);
    } else {
      for (let n = i; n < i + context; n += 1) result.push(lines[n]);
      result.push({ type: 'skip', text: `…… 省略 ${run - context * 2} 行相同内容 ……` });
      for (let n = end - context; n < end; n += 1) result.push(lines[n]);
    }
    i = end;
  }
  return result;
}
