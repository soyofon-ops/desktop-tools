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
  }
];
