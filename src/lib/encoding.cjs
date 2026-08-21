'use strict';

function decodeUtf16Be(buffer) {
  const swapped = Buffer.alloc(buffer.length);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
}

function decodeWith(label, buffer) {
  try {
    return new TextDecoder(label, { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function decodeDocumentBuffer(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buffer.length) return { content: '', encoding: 'UTF-8' };

  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { content: buffer.slice(3).toString('utf8'), encoding: 'UTF-8' };
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { content: buffer.slice(2).toString('utf16le'), encoding: 'UTF-16 LE' };
  }
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { content: decodeUtf16Be(buffer.slice(2)), encoding: 'UTF-16 BE' };
  }

  const utf8 = decodeWith('utf-8', buffer);
  if (utf8 != null) return { content: utf8, encoding: 'UTF-8' };

  const gbk = decodeWith('gb18030', buffer) || decodeWith('gbk', buffer);
  if (gbk != null) return { content: gbk, encoding: 'GBK' };

  return { content: buffer.toString('utf8'), encoding: 'UTF-8' };
}

module.exports = { decodeDocumentBuffer };
