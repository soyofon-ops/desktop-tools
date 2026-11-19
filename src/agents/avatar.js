// 角色自訂頭像：存成 <設定資料夾>/agent-avatars/<雜湊>.png|gif，agents.json 只記檔名
// 狀態同步（agents:changed）只帶檔名，各視窗用 api.avatar(檔名) 取一次圖片後自行快取
// - PNG／JPEG：編輯視窗先裁成正方形並縮小，主程序再驗證並重新編碼成 96×96 PNG
// - GIF：保留動畫，不縮放也不重新編碼，只驗證檔頭、尺寸與大小；顯示時由 CSS 置中裁成圓形
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIZE = 96;                          // PNG 存檔尺寸（儀表盤 44px、編輯預覽 56px，高 DPI 也夠清楚）
const GIF_MAX_BYTES = 1024 * 1024;        // GIF 動畫大小上限
const GIF_MAX_SIDE = 1024;                // GIF 長寬上限，避免解碼後佔用太多記憶體
const MAX_INPUT_CHARS = Math.ceil(GIF_MAX_BYTES / 3) * 4 + 64; // 收到的 data URL 長度上限（base64 約為原檔的 4/3）
const NAME_RE = /^[a-f0-9]{16}\.(png|gif)$/;
const LEGACY_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/; // 舊版直接存在 agents.json 的頭像
const MIME = { png: 'image/png', gif: 'image/gif' };

/** 檢查 GIF 檔頭並讀出邏輯畫面尺寸 */
function gifSize(buf) {
  const sig = buf.subarray(0, 6).toString('latin1');
  if (buf.length < 13 || (sig !== 'GIF87a' && sig !== 'GIF89a')) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * @param {object} o
 * @param {string} o.dir 頭像資料夾
 * @param {object} o.nativeImage Electron 的 nativeImage
 */
function createAvatarStore({ dir, nativeImage }) {
  /** 檔名 → 絕對路徑；不合法的檔名回傳 null，避免讀到資料夾外的檔案 */
  function fullPath(name) {
    return NAME_RE.test(String(name)) ? path.join(dir, name) : null;
  }

  /** PNG／JPEG：置中裁成正方形、超過 SIZE 時縮小，重新編碼成 PNG */
  function encodeStill(s) {
    if (!nativeImage) throw new Error('目前無法處理圖片');
    let img = nativeImage.createFromDataURL(s);
    if (img.isEmpty()) throw new Error('無法讀取頭像圖片');
    const { width, height } = img.getSize();
    const side = Math.min(width, height);
    if (width !== height) {
      img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    }
    if (side > SIZE) img = img.resize({ width: SIZE, height: SIZE, quality: 'best' });
    const buf = img.toPNG();
    if (!buf.length) throw new Error('無法讀取頭像圖片');
    return { buf, ext: 'png' };
  }

  /** GIF：保留原檔，只做檢查 */
  function checkGif(s) {
    const buf = Buffer.from(s.slice(s.indexOf(',') + 1), 'base64');
    if (buf.length > GIF_MAX_BYTES) throw new Error('GIF 動畫太大（上限 1 MB）');
    const size = gifSize(buf);
    if (!size || !size.width || !size.height) throw new Error('無法讀取頭像圖片');
    if (size.width > GIF_MAX_SIDE || size.height > GIF_MAX_SIDE) throw new Error(`GIF 動畫尺寸太大（長寬上限 ${GIF_MAX_SIDE} px）`);
    return { buf, ext: 'gif' };
  }

  /**
   * 驗證並存檔，回傳檔名（內容相同的圖片共用同一個檔案）
   * @param {string} dataUrl 編輯視窗傳來的 data URL（PNG、JPEG 或 GIF）
   * @returns {string}
   */
  function save(dataUrl) {
    const s = String(dataUrl || '');
    const m = /^data:image\/(png|jpeg|gif);base64,/i.exec(s);
    if (!m || s.length > MAX_INPUT_CHARS) throw new Error('頭像圖片格式不支援或檔案太大');
    const { buf, ext } = m[1].toLowerCase() === 'gif' ? checkGif(s) : encodeStill(s);
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return name;
  }

  /** 讀取頭像給畫面顯示；檔案不存在或檔名不合法時回傳 null（畫面改顯示吉祥物） */
  function dataUrl(name) {
    const file = fullPath(name);
    if (!file) return null;
    try {
      return `data:${MIME[path.extname(file).slice(1)]};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** agents.json 裡的檔名；格式不對（例如手動改壞）時視為沒有頭像 */
  function stored(value) {
    return typeof value === 'string' && NAME_RE.test(value) ? value : null;
  }

  /** 存在的頭像檔名（編輯時沿用原本的頭像） */
  function exists(name) {
    const file = fullPath(name);
    return !!file && fs.existsSync(file);
  }

  /** 舊版存在 agents.json 的 data URL → 檔名；不是舊格式或轉換失敗時回傳 null，舊資料保持不動 */
  function migrate(value) {
    if (typeof value !== 'string' || !LEGACY_RE.test(value)) return null;
    try {
      return save(value);
    } catch (err) {
      console.error('轉換角色頭像失敗', err);
      return null;
    }
  }

  /** 刪除不再被任何角色使用的頭像 */
  function removeUnused(names, inUse) {
    for (const n of new Set(names)) {
      if (!n || inUse.has(n)) continue;
      const file = fullPath(n);
      if (file) { try { fs.unlinkSync(file); } catch { /* 已不存在 */ } }
    }
  }

  return { save, dataUrl, stored, exists, migrate, removeUnused };
}

module.exports = { createAvatarStore };
