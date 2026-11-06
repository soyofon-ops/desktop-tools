// 簡易 Markdown 轉 HTML（聊天回覆用）：先跳脫 HTML，再處理常見語法，不會執行回覆中的任何 HTML
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 行內語法：`程式碼`、**粗體**、*斜體*、[文字](https://網址)、自動連結 */
  function inline(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // { type: 'ul' | 'ol', items: [] }

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
      list = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 開頭可用 3 個以上的反引號，語言後可接屬性；標題列只顯示語言
      const fence = line.match(/^\s*(`{3,})\s*([^`]*)$/);
      if (fence) {
        flushPara(); flushList();
        const lang = fence[2].trim().split(/\s+/)[0];
        const isMarkdown = /^(markdown|md)$/i.test(lang);
        const body = [];
        let depth = 0; // Markdown 區塊內尚未結束的巢狀 fence 數
        i++;
        for (; i < lines.length; i++) {
          const inner = lines[i].match(/^\s*(`{3,})\s*([^`]*)$/);
          // 反引號少於開頭的 fence 視為內容
          if (inner && inner[1].length >= fence[1].length) {
            if (inner[2].trim()) {
              if (isMarkdown) depth++;
            } else if (depth > 0) {
              depth--;
            } else {
              break;
            }
          }
          body.push(lines[i]);
        }
        out.push(`<div class="code-block${isMarkdown ? ' code-wrap' : ''}"><div class="code-head"><span>${esc(lang)}</span><button class="code-copy" type="button">複製</button></div><pre><code>${esc(body.join('\n'))}</code></pre></div>`);
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushPara(); flushList(); out.push(`<h${Math.min(6, h[1].length + 2)}>${inline(h[2])}</h${Math.min(6, h[1].length + 2)}>`); continue; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push((ul || ol)[1]);
        continue;
      }
      if (/^\s*>\s?/.test(line)) { flushPara(); flushList(); out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    return out.join('');
  }

  window.renderMarkdown = render;
  window.escapeHtml = esc;
})();
