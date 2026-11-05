// Anthropic API Key：以作業系統的加密功能（Windows DPAPI、macOS 鑰匙圈）保存在設定資料夾，不寫進 config.json
const fs = require('fs');
const path = require('path');

function createKeyStore({ dir, safeStorage, fetch }) {
  const file = path.join(dir, 'anthropic-key.bin');
  let cached;

  function get() {
    if (cached !== undefined) return cached;
    try {
      cached = safeStorage.decryptString(fs.readFileSync(file));
    } catch {
      cached = null;
    }
    return cached;
  }

  function set(key) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('這台電腦無法加密保存 API Key');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, safeStorage.encryptString(key));
    cached = key;
  }

  function clear() {
    try { fs.unlinkSync(file); } catch { /* 本來就沒有 */ }
    cached = null;
  }

  /** 用列出模型的 API 驗證金鑰（不花費 token） */
  async function validate(key) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      });
    } catch {
      return { ok: false, message: '無法連線到 Anthropic，請檢查網路' };
    }
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'API Key 無效' };
    return { ok: false, message: `驗證失敗（HTTP ${res.status}）` };
  }

  return { get, set, clear, validate };
}

/** 金鑰格式的初步檢查 */
function looksLikeKey(key) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(key || '').trim());
}

module.exports = { createKeyStore, looksLikeKey };
