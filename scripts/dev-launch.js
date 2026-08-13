const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electronExe = require('electron');
const distDir = path.dirname(electronExe);
const brandedExe = path.join(distDir, 'MarkL.exe');
const iconIco = path.join(root, 'assets', 'icon.ico');
const stampFile = path.join(distDir, 'MarkL.exe.stamp');

function stampValue() {
  const electronStat = fs.statSync(electronExe);
  const iconStat = fs.existsSync(iconIco) ? fs.statSync(iconIco) : { mtimeMs: 0 };
  return `${electronStat.mtimeMs}:${iconStat.mtimeMs}:MarkL-v2`;
}

function needsRebuild() {
  if (!fs.existsSync(brandedExe) || !fs.existsSync(stampFile)) return true;
  return fs.readFileSync(stampFile, 'utf8') !== stampValue();
}

function brandExecutable() {
  const ResEdit = require('resedit');
  const data = fs.readFileSync(electronExe);
  const exe = ResEdit.NtExecutable.from(data);
  const res = ResEdit.NtExecutableResource.from(exe);

  if (fs.existsSync(iconIco)) {
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconIco));
    const icons = iconFile.icons.map((item) => item.data);
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    if (groups.length) {
      groups.forEach((group) => {
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons);
      });
    } else {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
    }
  }

  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  versions.forEach((info) => {
    const lang = info.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
    info.setStringValues(lang, {
      FileDescription: 'MarkL',
      ProductName: 'MarkL',
      InternalName: 'MarkL',
      OriginalFilename: 'MarkL.exe',
      CompanyName: 'Haiyu Information'
    });
    info.outputToResourceEntries(res.entries);
  });

  res.outputResource(exe);
  fs.writeFileSync(brandedExe, Buffer.from(exe.generate()));
  fs.writeFileSync(stampFile, stampValue());
}

if (process.platform === 'win32') {
  try {
    if (needsRebuild()) brandExecutable();
  } catch (error) {
    console.warn(`无法写入开发用 MarkL.exe，将回退到 Electron：${error.message}`);
    spawn(electronExe, ['.'], { cwd: root, stdio: 'inherit', windowsHide: false }).on('exit', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }
  spawn(brandedExe, ['.'], { cwd: root, stdio: 'inherit', windowsHide: false }).on('exit', (code) => {
    process.exit(code ?? 0);
  });
} else {
  spawn(electronExe, ['.'], { cwd: root, stdio: 'inherit' }).on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
