// 工具儀表盤的小功能清單
// 新增功能：在 TOOLS 加一筆 { id, name, icon, run }，超過 10 個會自動分頁
//   name ：工具名稱，滑鼠移入按鈕時以提示顯示
//   icon ：24×24 viewBox 的 SVG 內容（stroke 用 currentColor）
//   run  ：async () => ({ ok: true|false, message: '通知文字' })

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
  }
];
