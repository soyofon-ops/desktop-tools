// 聊天附加圖片：縮小、存檔，並轉成送給 Claude 的 base64 內容。
// 對話紀錄只記檔名，圖片本體存在 <設定資料夾>/agent-chats/images/。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGES = 5;               // 一則訊息最多幾張
const MAX_SIDE = 1568;              // 長邊超過就縮小（Claude 建議的尺寸，更大只會多花 token）
const MAX_INPUT_CHARS = 30 * 1024 * 1024; // 收到的 data URL 長度上限
const PNG_LIMIT = 3.5 * 1024 * 1024;      // PNG 超過就改存 JPEG，避免超過 API 的單張上限
const NAME_RE = /^[a-f0-9]{16}\.(png|jpg)$/;

/**
 * @param {object} o
 * @param {string} o.dir 圖片資料夾
 * @param {object} o.nativeImage Electron 的 nativeImage
 */
function createChatImages({ dir, nativeImage }) {
  /** 檔名 → 絕對路徑；不合法的檔名回傳 null，避免讀到資料夾外的檔案 */
  function fullPath(name) {
    return NAME_RE.test(String(name)) ? path.join(dir, name) : null;
  }

  /**
   * 把聊天視窗傳來的 data URL 轉成可送出的圖片並存檔
   * @returns {{ name: string, mediaType: string, data: string }}
   */
  function save(dataUrl) {
    if (!nativeImage) throw new Error('目前無法處理圖片');
    const s = String(dataUrl || '');
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(s) || s.length > MAX_INPUT_CHARS) throw new Error('圖片格式不支援或檔案太大');
    let img = nativeImage.createFromDataURL(s);
    if (img.isEmpty()) throw new Error('無法讀取圖片');
    const { width, height } = img.getSize();
    const scale = MAX_SIDE / Math.max(width, height);
    if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' });
    let buf = img.toPNG();
    let ext = 'png';
    let mediaType = 'image/png';
    if (buf.length > PNG_LIMIT) {
      buf = img.toJPEG(85);
      ext = 'jpg';
      mediaType = 'image/jpeg';
    }
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return { name, mediaType, data: buf.toString('base64') };
  }

  /** 刪除不再被任何對話使用的圖片 */
  function removeUnused(names, inUse) {
    for (const n of new Set(names)) {
      if (inUse.has(n)) continue;
      const file = fullPath(n);
      if (file) { try { fs.unlinkSync(file); } catch { /* 已不存在 */ } }
    }
  }

  return { save, fullPath, removeUnused };
}

/** 對話紀錄中用到的圖片檔名 */
function imagesOf(items) {
  const out = [];
  for (const i of items || []) if (i && Array.isArray(i.images)) out.push(...i.images);
  return out;
}

module.exports = { createChatImages, imagesOf, MAX_IMAGES };
