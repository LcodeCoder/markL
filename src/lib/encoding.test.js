import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const { decodeDocumentBuffer } = require('./encoding.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(decodeDocumentBuffer(Buffer.from('')).content === '', 'empty failed');
assert(decodeDocumentBuffer(Buffer.from('hello MarkL')).encoding === 'UTF-8', 'ascii should be utf-8');
assert(decodeDocumentBuffer(Buffer.from([0xEF, 0xBB, 0xBF, 0x61])).content === 'a', 'utf-8 bom failed');

const hello = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3]);
const gbk = decodeDocumentBuffer(hello);
assert(gbk.encoding === 'GBK', `gbk encoding failed: ${gbk.encoding}`);
assert(gbk.content === '你好', `gbk text failed: ${gbk.content}`);

const utf16 = Buffer.from([0xFF, 0xFE, 0x61, 0x00, 0x62, 0x00]);
assert(decodeDocumentBuffer(utf16).content === 'ab', 'utf16le failed');

console.log('encoding tests passed');
void path;
void fileURLToPath;
