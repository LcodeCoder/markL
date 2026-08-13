// 将无文字方形 Logo 转为多尺寸 ICO，并用高质量缩小避免小图标锯齿。
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const srcPng = path.join(root, 'logo (1).png');
const srcWordmark = path.join(root, 'logo.png');
const outDir = path.join(root, 'assets');
const outIco = path.join(outDir, 'icon.ico');
const outPng = path.join(outDir, 'icon.png');
const outMark = path.join(outDir, 'logo-mark.png');
const outWordmark = path.join(outDir, 'logo-wordmark.png');
const sizes = [256, 128, 64, 48, 32, 24, 16];

async function renderSquare(size) {
  const source = await Jimp.read(srcPng);
  const work = Math.max(512, size * 8);
  const canvas = new Jimp(work, work, 0x00000000);
  const inner = Math.round(work * (size <= 24 ? 0.78 : 0.88));
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
    throw new Error('项目根目录中未找到 logo (1).png。');
  }
  if (!fs.existsSync(srcWordmark)) {
    throw new Error('项目根目录中未找到 logo.png。');
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(srcWordmark, outWordmark);
  const buffers = await Promise.all(sizes.map(renderSquare));
  fs.writeFileSync(outPng, buffers[0]);
  fs.writeFileSync(outMark, buffers[1]);
  fs.writeFileSync(outIco, await pngToIco(buffers));
  console.log('已同步品牌 Logo：assets/logo-wordmark.png、assets/logo-mark.png');
  console.log('已生成应用图标：assets/icon.png、assets/icon.ico');
}

main().catch((error) => {
  console.error(`图标生成失败：${error.message}`);
  process.exit(1);
});
