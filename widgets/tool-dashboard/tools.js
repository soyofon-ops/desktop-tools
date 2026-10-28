// 工具儀表盤的小功能清單
// 新增功能：在 TOOLS 加一筆 { id, name, icon, run }，超過 10 個會自動分頁
//   name ：工具名稱，滑鼠移入按鈕時以提示顯示
//   icon ：24×24 viewBox 的 SVG 內容（stroke 用 currentColor）
//   run  ：async () => ({ ok: true|false, message: '通知文字', color?: '#RRGGBB' })
//          有 color 時，通知左側顯示該顏色的色塊

/**
 * URL 解碼：盡量把文字中的 %XX 解開。
 * 整段解碼失敗（例如 %E4%B8 不完整）時，改成逐段解碼，解不開的保留原樣。
 */
function safeDecodeURL(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        // 一個一個位元組往前試，能解的先解
        let out = '';
        let rest = run;
        while (rest) {
          let done = false;
          for (let len = rest.length; len >= 3; len -= 3) {
            try {
              out += decodeURIComponent(rest.slice(0, len));
              rest = rest.slice(len);
              done = true;
              break;
            } catch { /* 試短一點 */ }
          }
          if (!done) {
            out += rest.slice(0, 3);
            rest = rest.slice(3);
          }
        }
        return out;
      }
    });
  }
}

/**
 * JSON 格式化：只調整空白與縮排，數值、字串原樣保留。
 * 不用 JSON.stringify(JSON.parse(text))，因為那會改掉資料：
 * 超過 2^53 的整數會失去精度（例如 ID）、1.0 變 1、1e3 變 1000。
 * 呼叫前須先確認 text 是合法 JSON。
 */
function formatJSON(text, indent = '  ') {
  let out = '';
  let depth = 0;
  const newline = () => '\n' + indent.repeat(depth);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // 整段字串原樣複製（含跳脫字元）
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '{' || ch === '[') {
      // 空物件／空陣列維持 {} 與 []
      let j = i + 1;
      while (/\s/.test(text[j])) j++;
      if (text[j] === (ch === '{' ? '}' : ']')) {
        out += ch + text[j];
        i = j;
      } else {
        depth++;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
      out += newline() + ch;
    } else if (ch === ',') {
      out += ',' + newline();
    } else if (ch === ':') {
      out += ': ';
    } else if (!/\s/.test(ch)) {
      out += ch; // 數字、true、false、null
    }
  }
  return out;
}

/**
 * Base64 編碼：先轉成 UTF-8 位元組再編碼（btoa 直接處理中文會丟錯誤）。
 */
function base64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  // 分段轉換，避免大量資料時 String.fromCharCode 參數過多
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Base64 解碼成 UTF-8 文字。
 * 容許：換行與空白、URL-safe（- _）、缺少 = 補位、data:…;base64, 前綴。
 * 回傳 { text } 或 { error: 'invalid' | 'binary' }。
 */
function base64Decode(input) {
  let s = input.trim().replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return { error: 'invalid' };
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (s.length % 4 === 1) return { error: 'invalid' };
  s += '='.repeat((4 - (s.length % 4)) % 4);

  let bin;
  try {
    bin = atob(s);
  } catch {
    return { error: 'invalid' };
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { error: 'binary' }; // 不是合法的 UTF-8，多半是圖片等二進位資料
  }
  // 含控制字元（Tab、換行除外）也視為二進位資料
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) return { error: 'binary' };
  return { text };
}

/** 把 '#rrggbb' 或 'rgb(r, g, b)' 統一成大寫 '#RRGGBB' */
function normalizeHex(value) {
  const s = String(value || '').trim();
  let m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) return '#' + m[1].toUpperCase();
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}

/**
 * 螢幕取色，回傳 '#RRGGBB'，取消時為 null。
 * macOS：用瀏覽器內建 EyeDropper（不需要螢幕錄製權限）。
 * Windows 等：Electron 的 EyeDropper 取不到視窗外的顏色，改用框架的截圖取色（widget.pickColor）。
 */
async function pickScreenColor() {
  if (window.widget.platform === 'darwin' && typeof EyeDropper === 'function') {
    try {
      const { sRGBHex } = await new EyeDropper().open();
      return normalizeHex(sRGBHex);
    } catch {
      return null; // 使用者按 Esc 取消
    }
  }
  return normalizeHex(await window.widget.pickColor());
}

window.TOOLS = [
  {
    id: 'url-decode',
    name: 'URL 解碼',
    icon: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    async run() {
      const text = await window.widget.readText();
      if (!text) return { ok: false, message: '剪貼簿是空的' };
      const decoded = safeDecodeURL(text);
      if (decoded === text) return { ok: false, message: '剪貼簿沒有可解碼的內容' };
      await window.widget.copyText(decoded);
      return { ok: true, message: '已解碼並複製到剪貼簿' };
    }
  },
  {
    id: 'json-format',
    name: 'JSON 格式化',
    icon: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    async run() {
      const raw = await window.widget.readText();
      const text = (raw || '').replace(/^\uFEFF/, '').trim(); // 去掉 BOM 與前後空白
      if (!text) return { ok: false, message: '剪貼簿是空的' };
      // 只處理物件或陣列；單純的數字、字串雖然也是合法 JSON，但沒有格式化的意義
      if (!/^[[{]/.test(text)) return { ok: false, message: '剪貼簿不是 JSON 物件或陣列' };
      try {
        JSON.parse(text);
      } catch {
        return { ok: false, message: '剪貼簿不是有效的 JSON' };
      }
      const formatted = formatJSON(text);
      await window.widget.copyText(formatted);
      return { ok: true, message: formatted === raw ? 'JSON 已是格式化狀態' : '已格式化並複製到剪貼簿' };
    }
  },
  {
    id: 'base64-encode',
    name: 'Base64 編碼',
    icon: '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
    async run() {
      const text = await window.widget.readText();
      if (!text) return { ok: false, message: '剪貼簿是空的' };
      await window.widget.copyText(base64Encode(text)); // 原樣編碼，不去除前後空白與換行
      return { ok: true, message: '已編碼並複製到剪貼簿' };
    }
  },
  {
    id: 'base64-decode',
    name: 'Base64 解碼',
    icon: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    async run() {
      const text = await window.widget.readText();
      if (!text || !text.trim()) return { ok: false, message: '剪貼簿是空的' };
      const r = base64Decode(text);
      if (r.error === 'invalid') return { ok: false, message: '剪貼簿不是有效的 Base64' };
      if (r.error === 'binary') return { ok: false, message: '解碼結果不是文字，剪貼簿不變' };
      await window.widget.copyText(r.text);
      return { ok: true, message: '已解碼並複製到剪貼簿' };
    }
  },
  {
    id: 'color-picker',
    name: '顏色吸管',
    icon: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    async run() {
      const hex = await pickScreenColor();
      if (!hex) return { ok: false, message: '已取消取色' };
      await window.widget.copyText(hex);
      return { ok: true, message: `已複製色碼 ${hex}`, color: hex };
    }
  }
];
