// 角色吉祥物（原創簡易造型，24×24），身體用角色顏色
// 儀表盤、聊天視窗、角色編輯共用：MASCOTS[key].svg(color, size, animated)；只有儀表盤的 .agent 按鈕傳 animated
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

  window.MASCOTS = MASCOTS;
  window.AGENT_COLORS = AGENT_COLORS;
})();
