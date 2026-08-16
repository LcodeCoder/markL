// 从 markL_logo.png 生成多尺寸应用图标，从 tab_logo.png 同步侧栏字标。
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const srcPng = path.join(root, 'markL_logo.png');
const srcWordmark = path.join(root, 'tab_logo.png');
const outDir = path.join(root, 'assets');
const docsBrand = path.join(root, 'docs', 'brand');
const outIco = path.join(outDir, 'icon.ico');
const outPng = path.join(outDir, 'icon.png');
const outIcns = path.join(outDir, 'icon.icns');
const outMark = path.join(outDir, 'logo-mark.png');
const outWordmark = path.join(outDir, 'logo-wordmark.png');
const sizes = [256, 128, 64, 48, 32, 24, 16];

function icnsChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

async function writeIcns(filePath, square) {
  const entries = [
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512]
  ];
  const chunks = [];
  for (const [type, size] of entries) {
    chunks.push(icnsChunk(type, await renderSquare(square, size)));
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

function cropOpaque(source, minRowOccupancy = 20) {
  const width = source.getWidth();
  const height = source.getHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      if (source.bitmap.data[(y * width + x) * 4 + 3] > 16) count += 1;
    }
    rows.push(count);
  }

  let top = rows.findIndex((count) => count >= minRowOccupancy);
  let bottom = rows.length - 1 - [...rows].reverse().findIndex((count) => count >= minRowOccupancy);
  if (top < 0 || bottom < 0) {
    throw new Error('markL_logo.png 没有可用的不透明内容。');
  }

  let left = width;
  let right = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (source.bitmap.data[(y * width + x) * 4 + 3] <= 16) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  const pad = 2;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  return source.clone().crop(left, top, right - left + 1, bottom - top + 1);
}

function squareFromMark(cropped) {
  const side = Math.max(cropped.getWidth(), cropped.getHeight());
  const canvas = new Jimp(side, side, 0x00000000);
  canvas.composite(
    cropped,
    Math.round((side - cropped.getWidth()) / 2),
    Math.round((side - cropped.getHeight()) / 2)
  );
  return canvas;
}

async function renderSquare(square, size) {
  const work = Math.max(size * 4, 512);
  const canvas = new Jimp(work, work, 0x00000000);
  const source = square.clone();
  const inner = Math.round(work * (size <= 16 ? 0.92 : 0.98));
  source.contain(
    inner,
    inner,
    Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE,
    Jimp.RESIZE_BICUBIC
  );
  canvas.composite(
    source,
    Math.round((work - source.getWidth()) / 2),
    Math.round((work - source.getHeight()) / 2)
  );
  canvas.resize(size, size, Jimp.RESIZE_HERMITE);
  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

async function main() {
  if (!fs.existsSync(srcPng)) {
    throw new Error('项目根目录中未找到 markL_logo.png。');
  }
  if (!fs.existsSync(srcWordmark)) {
    throw new Error('项目根目录中未找到 tab_logo.png。');
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(docsBrand, { recursive: true });
  fs.copyFileSync(srcWordmark, outWordmark);

  const square = squareFromMark(cropOpaque(await Jimp.read(srcPng)));
  const buffers = await Promise.all(sizes.map((size) => renderSquare(square, size)));
  fs.writeFileSync(outPng, buffers[0]);
  fs.writeFileSync(outMark, buffers[1]);
  fs.writeFileSync(outIco, await pngToIco(buffers));
  await writeIcns(outIcns, square);

  fs.copyFileSync(outWordmark, path.join(docsBrand, 'logo-wordmark.png'));
  fs.copyFileSync(outMark, path.join(docsBrand, 'logo-mark.png'));
  fs.copyFileSync(outPng, path.join(docsBrand, 'icon.png'));

  console.log('已同步侧栏字标：assets/logo-wordmark.png ← tab_logo.png');
  console.log('已生成应用图标：assets/icon.png、assets/icon.ico、assets/icon.icns ← markL_logo.png');
}

main().catch((error) => {
  console.error(`图标生成失败：${error.message}`);
  process.exit(1);
});
