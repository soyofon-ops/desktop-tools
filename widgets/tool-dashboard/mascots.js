// 角色吉祥物（原創簡易造型，24×24），身體用角色顏色
// 儀表盤、聊天視窗、角色編輯共用：MASCOTS[key].svg(color, size, animated)；只有儀表盤的 .agent 按鈕傳 animated
// 顯示角色時用 avatarHtml(role, …)：角色有自訂頭像就改顯示圖片
// 分層與 class 只供儀表盤 .agent 按鈕的動畫使用，其他頁面沒有對應樣式，外觀不受影響
(function () {
  const D = '#12151B'; // 眼睛等深色部分（兩種主題都一樣，畫在彩色身體上）
  const num = (v) => Number(v.toFixed(2));

  /** 彎眼（回覆完成）與 X 眼（回覆失敗），預設隱藏，由 .agent[data-mood] 的樣式顯示 */
  function altEyes(xs, y, color = D) {
    const stroke = `stroke="${color}" stroke-width="1.3" stroke-linecap="round" fill="none"`;
    const happy = xs.map((x) => `<path d="M${num(x - 1.6)} ${num(y + 0.6)}Q${x} ${num(y - 1.4)} ${num(x + 1.6)} ${num(y + 0.6)}"></path>`).join('');
    const cross = xs
      .map((x) => `<path d="M${num(x - 1.4)} ${num(y - 1.4)}L${num(x + 1.4)} ${num(y + 1.4)}M${num(x + 1.4)} ${num(y - 1.4)}L${num(x - 1.4)} ${num(y + 1.4)}"></path>`)
      .join('');
    return `<g class="m-eyes-done" display="none" ${stroke}>${happy}</g><g class="m-eyes-error" display="none" ${stroke}>${cross}</g>`;
  }

  /** 眼睛分層：m-eyes 負責眨眼與放大，m-gaze 負責視線；socket 是不隨視線移動的眼眶 */
  const eyes = (pupils, socket = '') => `<g class="m-eyes">${socket}<g class="m-gaze">${pupils}</g></g>`;

  const defs = {
    blob: {
      name: '圓糰', ey: 11.5, oy: 21, my: 15.3,
      body: (c) => `<path d="M12 3c5 0 8.5 3.8 8.5 8.8 0 5.3-3.6 9.2-8.5 9.2S3.5 17.1 3.5 11.8C3.5 6.8 7 3 12 3z" fill="${c}"></path>${eyes(`<circle class="m-eye" cx="9" cy="11.5" r="1.4" fill="${D}"></circle><circle class="m-eye" cx="15" cy="11.5" r="1.4" fill="${D}"></circle>`)}${altEyes([9, 15], 11.5)}<path class="m-mouth" d="M10.5 15q1.5 1.2 3.0 0" stroke="${D}" stroke-width="1.3" fill="none" stroke-linecap="round"></path><circle class="m-cheek" cx="6.8" cy="14" r="1.3" fill="#FF7A85" opacity=".55"></circle><circle class="m-cheek" cx="17.2" cy="14" r="1.3" fill="#FF7A85" opacity=".55"></circle>`
    },
    robot: {
      name: '小機器人', ey: 12.8, oy: 20.5,
      body: (c) => `<g class="m-antenna"><path d="M12 2.8v3" stroke="${c}" stroke-width="1.6" stroke-linecap="round"></path><circle class="m-antenna-ball" cx="12" cy="2.6" r="1.5" fill="${c}"></circle></g><rect x="2" y="11" width="2.2" height="4.5" rx="1.1" fill="${c}"></rect><rect x="19.8" y="11" width="2.2" height="4.5" rx="1.1" fill="${c}"></rect><rect x="4" y="6" width="16" height="14.5" rx="4.5" fill="${c}"></rect><rect class="m-visor" x="6.5" y="9.2" width="11" height="7.2" rx="3" fill="${D}"></rect>${eyes(`<circle class="m-eye" cx="9.8" cy="12.8" r="1.3" fill="${c}"></circle><circle class="m-eye" cx="14.2" cy="12.8" r="1.3" fill="${c}"></circle>`)}${altEyes([9.8, 14.2], 12.8, c)}`
    },
    cat: {
      name: '小貓', ey: 12.6, oy: 21, my: 16.8,
      // 耳朵要單獨抖動才拆開畫；接縫的反鋸齒與單一路徑略有差異，所以其他頁面維持單一路徑
      body: (c, animated) => `${animated ? `<path class="m-ear-l" d="M4.4 10 5 3.6l4.4 3.4L9 11z" fill="${c}"></path><path class="m-ear-r" d="M19.6 10 19 3.6l-4.4 3.4L15 11z" fill="${c}"></path><path d="M4.4 10 9.4 7h5.2l5 3c.9 1.2 1.4 2.7 1.4 4.3 0 4.1-4 6.7-9 6.7s-9-2.6-9-6.7c0-1.6.5-3.1 1.4-4.3z" fill="${c}"></path>` : `<path d="M4.4 10 5 3.6l4.4 3.4h5.2L19 3.6l.6 6.4c.9 1.2 1.4 2.7 1.4 4.3 0 4.1-4 6.7-9 6.7s-9-2.6-9-6.7c0-1.6.5-3.1 1.4-4.3z" fill="${c}"></path>`}${eyes(`<circle class="m-eye" cx="8.8" cy="12.6" r="1.4" fill="${D}"></circle><circle class="m-eye" cx="15.2" cy="12.6" r="1.4" fill="${D}"></circle>`)}${altEyes([8.8, 15.2], 12.6)}<path class="m-nose" d="M11.3 15h1.4l-.7.8z" fill="${D}"></path><path class="m-mouth" d="M10.4 16.6q.8.7 1.6 0q.8.7 1.6 0" stroke="${D}" stroke-width="1.1" fill="none" stroke-linecap="round"></path>`
    },
    ghost: {
      name: '小幽靈', ey: 10.8, oy: 20.6,
      body: (c) => `<path d="M12 2.8a7.6 7.6 0 0 1 7.6 7.6V20.6l-2.53-1.9-2.54 1.9L12 18.7l-2.53 1.9-2.54-1.9-2.53 1.9V10.4A7.6 7.6 0 0 1 12 2.8z" fill="${c}"></path>${eyes(`<ellipse class="m-eye" cx="9.3" cy="10.8" rx="1.3" ry="1.8" fill="${D}"></ellipse><ellipse class="m-eye" cx="14.7" cy="10.8" rx="1.3" ry="1.8" fill="${D}"></ellipse>`)}${altEyes([9.3, 14.7], 10.8)}<ellipse class="m-mouth" cx="12" cy="14.6" rx="1.1" ry="1.3" fill="${D}"></ellipse>`
    },
    drop: {
      name: '水滴', ey: 14, oy: 21.9, my: 17.4,
      body: (c) => `<path d="M12 2.4c3.6 4.3 7.2 8.1 7.2 12.3a7.2 7.2 0 0 1-14.4 0c0-4.2 3.6-8 7.2-12.3z" fill="${c}"></path>${eyes(`<circle class="m-eye" cx="9.4" cy="14" r="1.3" fill="${D}"></circle><circle class="m-eye" cx="14.6" cy="14" r="1.3" fill="${D}"></circle>`)}${altEyes([9.4, 14.6], 14)}<path class="m-mouth" d="M10.7 17q1.3 1.2 2.6 0" stroke="${D}" stroke-width="1.3" fill="none" stroke-linecap="round"></path><path class="m-shine" d="M8.2 10.5q.6-1.8 2-3" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".55"></path>`
    },
    cloud: {
      name: '雲朵', ey: 13.6, oy: 19.5, my: 16.8,
      body: (c) => `<path d="M7 19.5a4.6 4.6 0 0 1-.7-9.1A6 6 0 0 1 17.9 9a5.2 5.2 0 0 1-.4 10.5z" fill="${c}"></path>${eyes(`<circle class="m-eye" cx="9.6" cy="13.6" r="1.3" fill="${D}"></circle><circle class="m-eye" cx="14.6" cy="13.6" r="1.3" fill="${D}"></circle>`)}${altEyes([9.6, 14.6], 13.6)}<path class="m-mouth" d="M10.8 16.4q1.2 1.2 2.4 0" stroke="${D}" stroke-width="1.3" fill="none" stroke-linecap="round"></path><circle class="m-cheek" cx="7.4" cy="15.4" r="1.3" fill="#FF7A85" opacity=".55"></circle><circle class="m-cheek" cx="16.8" cy="15.4" r="1.3" fill="#FF7A85" opacity=".55"></circle>`
    },
    owl: {
      name: '貓頭鷹', ey: 11, oy: 20.9,
      body: (c) => `<path d="M5.5 6 4.5 2.8 8.6 4.6A8.5 8.5 0 0 1 12 4a8.5 8.5 0 0 1 3.4.6l4.1-1.8-1 3.2a8.4 8.4 0 0 1 2.5 6c0 5-3.9 8.9-9 8.9s-9-3.9-9-8.9a8.4 8.4 0 0 1 2.5-6z" fill="${c}"></path>${eyes(`<circle class="m-eye" cx="8.9" cy="11.2" r="1.4" fill="${D}"></circle><circle class="m-eye" cx="15.1" cy="11.2" r="1.4" fill="${D}"></circle>`, `<circle class="m-socket" cx="8.8" cy="11" r="2.8" fill="#fff" opacity=".9"></circle><circle class="m-socket" cx="15.2" cy="11" r="2.8" fill="#fff" opacity=".9"></circle>`)}${altEyes([8.8, 15.2], 11)}<path class="m-beak" d="M11 14h2l-1 1.7z" fill="#F2C14E"></path>`
    },
    bear: {
      name: '小熊', ey: 11.6, oy: 21.2,
      body: (c) => `<circle class="m-ear-l" cx="6.2" cy="6.4" r="3.1" fill="${c}"></circle><circle class="m-ear-r" cx="17.8" cy="6.4" r="3.1" fill="${c}"></circle><circle cx="12" cy="13" r="8.2" fill="${c}"></circle><ellipse class="m-muzzle" cx="12" cy="15.6" rx="3.3" ry="2.5" fill="#fff" opacity=".4"></ellipse>${eyes(`<circle class="m-eye" cx="8.8" cy="11.6" r="1.3" fill="${D}"></circle><circle class="m-eye" cx="15.2" cy="11.6" r="1.3" fill="${D}"></circle>`)}${altEyes([8.8, 15.2], 11.6)}<ellipse class="m-nose" cx="12" cy="14.7" rx="1.2" ry=".9" fill="${D}"></ellipse>`
    }
  };
  const MASCOTS = {};
  for (const [key, m] of Object.entries(defs)) {
    const vars = `--m-oy:${m.oy}px;--m-ey:${m.ey}px${m.my ? `;--m-my:${m.my}px` : ''}`;
    MASCOTS[key] = {
      name: m.name,
      svg: (color, size = 24, animated = false) => `<svg class="m-${key}" style="${vars}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><g class="m-fx"><g class="m-motion">${m.body(color, animated)}</g></g></svg>`
    };
  }

  /** Claude Code 子代理的顏色名稱 → 顯示用色碼 */
  const AGENT_COLORS = {
    red: { name: '紅', hex: '#FF7A85' },
    blue: { name: '藍', hex: '#6EA8FE' },
    green: { name: '綠', hex: '#3DD6B5' },
    yellow: { name: '黃', hex: '#F2C14E' },
    purple: { name: '紫', hex: '#C792EA' },
    orange: { name: '橘', hex: '#F2994A' },
    pink: { name: '粉紅', hex: '#F78FB3' },
    cyan: { name: '青', hex: '#7FDBCA' }
  };

  // ---- 自訂頭像 ----
  // 狀態同步只帶檔名（role.avatar），圖片向主程序取一次後依檔名快取；編輯中尚未儲存的圖片用 role.avatarSrc 直接帶 data URL
  // 只接受 PNG／GIF data URL：字元集不含引號，可直接放進 src 屬性
  const SRC_RE = /^data:image\/(png|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const FILE_RE = /^[a-f0-9]{16}\.(png|gif)$/;
  const IMG_STYLE = 'display:block;border-radius:50%;object-fit:cover;pointer-events:none';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const avatarCache = new Map(); // 檔名 → { src, still } | null（找不到）；載入中不在表內
  const avatarLoading = new Set();
  const stillCache = new Map();  // GIF data URL → 第一格的 PNG data URL（減少動態時用）

  function agentsCall(...args) {
    // 儀表盤用 widget.agents、彈出視窗用 agents。儀表盤有 <div id="agents">，window.agents 會指到該元素，
    // 所以先找 widget.agents，並確認 call 是函式
    const api = [window.widget && window.widget.agents, window.agents].find((a) => a && typeof a.call === 'function');
    return api ? api.call(...args) : Promise.resolve(null);
  }

  /** GIF 的第一格轉成 PNG；data: 網址受 CSP 限制不能 fetch，改自行解 base64 */
  async function firstFrame(src) {
    if (stillCache.has(src)) return stillCache.get(src);
    const bin = atob(src.slice(src.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/gif' }));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const still = canvas.toDataURL('image/png');
    stillCache.set(src, still);
    return still;
  }

  /** 依目前的「減少動態」設定選擇動畫或第一格 */
  function pickSrc(entry) {
    return reducedMotion.matches && entry.still ? entry.still : entry.src;
  }

  function imgHtml(src, size, attrs = '') {
    return `<img class="m-avatar"${attrs}${src ? ` src="${src}"` : ''} width="${size}" height="${size}" alt="" draggable="false" style="${IMG_STYLE}">`;
  }

  /** 載入完成後填入畫面上等待中的圖片；找不到圖片時改回吉祥物 */
  async function loadAvatar(file) {
    avatarLoading.add(file);
    // avatarHtml 是在組 HTML 字串時呼叫的，先讓呼叫端把佔位圖片放進畫面，下面完成時才找得到它們
    await null;
    let entry = null;
    try {
      const src = await agentsCall('avatar', file);
      if (typeof src === 'string' && SRC_RE.test(src)) {
        entry = { src, still: null };
        if (src.startsWith('data:image/gif')) entry.still = await firstFrame(src).catch(() => null);
      }
    } catch { /* 視為找不到 */ }
    avatarCache.set(file, entry);
    avatarLoading.delete(file);
    for (const img of document.querySelectorAll(`img.m-avatar[data-avatar="${file}"]`)) {
      if (entry) img.src = pickSrc(entry);
      else img.outerHTML = (MASCOTS[img.dataset.mascot] || MASCOTS.blob).svg(img.dataset.color, Number(img.dataset.mascotSize), img.dataset.animated === '1');
    }
  }

  /**
   * 角色圖示：有自訂頭像時顯示圓形圖片（GIF 會播放動畫，減少動態時只顯示第一格），否則顯示吉祥物
   * 圖片填滿 size 大小，外框由外層容器以角色顏色畫出；mascotSize 是改顯示吉祥物時的大小
   * 圖片還沒載入時先輸出空白的 <img>，載入後自動填入，外層容器的角色顏色圓框會先顯示
   */
  function avatarHtml(role, color, size = 24, animated = false, mascotSize = size) {
    const mascot = () => (MASCOTS[role && role.mascot] || MASCOTS.blob).svg(color, mascotSize, animated);
    const direct = role && role.avatarSrc;
    if (typeof direct === 'string' && SRC_RE.test(direct)) {
      return imgHtml(reducedMotion.matches && stillCache.has(direct) ? stillCache.get(direct) : direct, size);
    }
    const file = role && role.avatar;
    if (typeof file !== 'string' || !FILE_RE.test(file)) return mascot();
    if (avatarCache.has(file)) {
      const entry = avatarCache.get(file);
      return entry ? imgHtml(pickSrc(entry), size) : mascot();
    }
    if (!avatarLoading.has(file)) loadAvatar(file);
    // color 只會是 AGENT_COLORS 的色碼，mascot 只會是內建 key，都不含引號
    const key = MASCOTS[role.mascot] ? role.mascot : 'blob';
    return imgHtml('', size, ` data-avatar="${file}" data-mascot="${key}" data-color="${color}" data-mascot-size="${mascotSize}" data-animated="${animated ? 1 : 0}"`);
  }

  /** 編輯中的 GIF 先算好第一格，減少動態時預覽也不播放 */
  function prepareAvatarSrc(src) {
    return src.startsWith('data:image/gif') ? firstFrame(src).catch(() => null) : Promise.resolve(null);
  }

  window.MASCOTS = MASCOTS;
  window.AGENT_COLORS = AGENT_COLORS;
  window.avatarHtml = avatarHtml;
  window.prepareAvatarSrc = prepareAvatarSrc;
})();
