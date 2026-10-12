#!/usr/bin/env node
// 確保 Electron 執行檔有完整安裝。
//
// Electron 自己的安裝腳本用 extract-zip 解壓，在 Node 24 上可能解到一半就靜默結束
// （不報錯、沒有 path.txt），導致啟動時出現「Electron failed to install correctly」。
// 這個腳本會在安裝後檢查，若不完整就用系統內建工具從快取的 zip 重新解壓：
//   macOS: ditto（保留 .app 內的 symlink）   Windows: tar   Linux: unzip
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.dirname(require.resolve('electron/package.json'));
const { version } = require('electron/package.json');
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;

const platformPath = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  win32: 'electron.exe',
  linux: 'electron'
}[platform];

const distDir = path.join(electronDir, 'dist');

function isInstalled() {
  try {
    const v = fs.readFileSync(path.join(distDir, 'version'), 'utf8').replace(/^v/, '').trim();
    const p = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8');
    return v === version && p === platformPath && fs.existsSync(path.join(distDir, platformPath));
  } catch {
    return false;
  }
}

function cacheRoots() {
  const roots = [];
  if (process.env.electron_config_cache) roots.push(process.env.electron_config_cache);
  const home = os.homedir();
  if (process.platform === 'darwin') roots.push(path.join(home, 'Library', 'Caches', 'electron'));
  if (process.platform === 'win32') roots.push(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache'));
  roots.push(path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron'));
  return roots;
}

function findZip(dir, name, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findZip(full, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function runElectronInstaller() {
  console.log('[ensure-electron] 執行 Electron 下載…');
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
}

function extract(zip) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', zip, distDir], { stdio: 'inherit' });
  else if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', distDir], { stdio: 'inherit' });
  else execFileSync('unzip', ['-q', '-o', zip, '-d', distDir], { stdio: 'inherit' });

  const typeDefs = path.join(distDir, 'electron.d.ts');
  if (fs.existsSync(typeDefs)) fs.renameSync(typeDefs, path.join(electronDir, 'electron.d.ts'));
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
}

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || isInstalled()) process.exit(0);

const zipName = `electron-v${version}-${platform}-${arch}.zip`;
let zip = cacheRoots().map(r => findZip(r, zipName)).find(Boolean);

if (!zip) {
  // 快取沒有 zip：先讓 Electron 自己下載（就算它解壓失敗，zip 也會留在快取）
  try { runElectronInstaller(); } catch { /* 失敗也沒關係，下面再找一次 */ }
  if (isInstalled()) process.exit(0);
  zip = cacheRoots().map(r => findZip(r, zipName)).find(Boolean);
}

if (!zip) {
  console.error(`[ensure-electron] 找不到 ${zipName}，請確認網路後重新執行 pnpm install`);
  process.exit(1);
}

console.log(`[ensure-electron] Electron 未完整安裝，改用系統工具解壓：${zip}`);
extract(zip);

if (!isInstalled()) {
  console.error('[ensure-electron] 解壓後仍不完整，請刪除 node_modules 後重新安裝');
  process.exit(1);
}
console.log(`[ensure-electron] Electron v${version} 已就緒`);
