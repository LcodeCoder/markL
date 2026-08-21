export function baseName(filePath) {
  if (!filePath) return '未命名.md';
  return filePath.split(/[\\/]/).pop();
}

export function directoryName(filePath) {
  if (!filePath) return '新文档';
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join(' / ') || '本地文件';
}

export function parentDirectory(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[\\/]/);
  parts.pop();
  if (/^[A-Za-z]:$/.test(parts[parts.length - 1] || '')) return parts.join('\\');
  return parts.join(filePath.includes('\\') ? '\\' : '/') || '';
}

export function parentFolderName(filePath) {
  const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.pop() || '';
}

export function samePath(left, right) {
  return String(left || '').replace(/\\/g, '/').toLowerCase() === String(right || '').replace(/\\/g, '/').toLowerCase();
}

export function isPathInside(filePath, rootPath) {
  if (!filePath || !rootPath) return false;
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

export function pathSeparator(filePath) {
  return String(filePath || '').includes('\\') ? '\\' : '/';
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} 周前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}
