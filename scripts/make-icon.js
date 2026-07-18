// 将无文字方形 Logo 转换为 Windows / Electron 应用图标。
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
const outWordmark = path.join(outDir, 'logo-wordmark.png');
const sizes = [256, 128, 64, 48, 32, 16];

async function renderSquare(size) {
  const logo = await Jimp.read(srcPng);
  logo.contain(size, size, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
  return logo.getBufferAsync(Jimp.MIME_PNG);
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
  fs.writeFileSync(outIco, await pngToIco(buffers));
  console.log('已同步品牌 Logo：assets/logo-wordmark.png');
  console.log('已生成应用图标：assets/icon.png、assets/icon.ico');
}

main().catch((error) => {
  console.error(`图标生成失败：${error.message}`);
  process.exit(1);
});
