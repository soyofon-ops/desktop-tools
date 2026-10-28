// ReDoS 檢查：用 recheck 分析正規表示式是否有災難性回溯
// recheck 依序嘗試：原生執行檔（recheck-<os>-<arch>）→ Java（recheck-jar，需要安裝 Java）→ 純 JS（worker thread）。
// 打包後執行檔位在 app.asar 內無法執行，所以改指向 app.asar.unpacked（見 package.json 的 asarUnpack）。
const fs = require('fs');
const path = require('path');

const MAX_SOURCE = 5000;   // 太長的 pattern 不分析
const TIMEOUT_MS = 10000;  // 分析時間上限，超過回報 timeout

let recheck = null;

function nativeBinary() {
  const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) return null;
  try {
    const dir = path.dirname(require.resolve(`recheck-${os}-${arch}/package.json`));
    const bin = path.join(dir, os === 'windows' ? 'recheck.exe' : 'recheck')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null; // 這個平台沒有安裝原生版（例如在 macOS 交叉打包 Windows 版），會自動改用純 JS
  }
}

function load() {
  if (!recheck) {
    if (!process.env.RECHECK_BIN) {
      const bin = nativeBinary();
      if (bin) process.env.RECHECK_BIN = bin;
    }
    recheck = require('recheck'); // 約 3 MB，第一次使用才載入
  }
  return recheck;
}

/**
 * 分析正規表示式。
 * @returns {Promise<object>} 精簡過、可透過 IPC 傳送的結果：
 *   { status: 'safe'|'vulnerable'|'unknown', source, flags, checker, complexity, hotspot, attack, error, elapsed }
 */
async function checkRegex(source, flags) {
  source = String(source ?? '');
  flags = String(flags ?? '');
  const t0 = Date.now();
  const done = (r) => ({ source, flags, ...r, elapsed: Date.now() - t0 });

  if (source.length > MAX_SOURCE) {
    return done({ status: 'unknown', error: { kind: 'too-long', message: `超過 ${MAX_SOURCE} 字元` } });
  }
  try {
    const d = await load().check(source, flags, { timeout: TIMEOUT_MS });
    return done({
      status: d.status,
      checker: d.checker || null,
      complexity: d.complexity ? {
        type: d.complexity.type,
        degree: d.complexity.degree ?? null,
        summary: d.complexity.summary
      } : null,
      hotspot: Array.isArray(d.hotspot) ? d.hotspot.map((h) => ({ start: h.start, end: h.end, temperature: h.temperature })) : [],
      attack: d.attack ? { pattern: d.attack.pattern, string: d.attack.string } : null,
      error: d.error ? { kind: d.error.kind, message: d.error.message || '' } : null
    });
  } catch (err) {
    return done({ status: 'unknown', error: { kind: 'unexpected', message: String((err && err.message) || err) } });
  }
}

module.exports = { checkRegex };
