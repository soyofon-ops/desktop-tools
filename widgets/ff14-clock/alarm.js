// 鬧鈴：讀取資料庫「素材」分類，在開始前 3 分鐘（現實時間）於時鐘下方彈出通知，
// 顯示素材名稱與開始→結束的進度條，結束時間到才消失。
//
// 欄位自動偵測（依欄位名稱／代碼）：
//   名稱      文字欄位，名稱含「名稱 / name」，否則第一個文字欄位
//   時間類型  名稱含「類型 / type」，或選項含 ET、LT、艾奧傑亞、本地 的下拉選單
//             值或顯示文字含 LT / 本地 / 現實 → 本地時間，其餘 → 艾奧傑亞時間
//   開始時間  時間欄位，名稱含「開始 / start」，否則第一個時間欄位
//   結束時間  時間欄位，名稱含「結束 / end」，否則第二個時間欄位
//   啟用      （選填）是／否欄位，名稱含「啟用 / 鬧鈴 / 提醒 / enable」；為否時不提醒
//
// 依賴 clock.js 的 EORZEA_MULTIPLIER、pad。
(() => {
  const LEAD_MS = 3 * 60 * 1000;         // 提前 3 分鐘（現實時間）
  const ET_DAY = 24 * 60 * 60 * 1000;    // 艾奧傑亞一天（ET 毫秒）
  const CATEGORY_MATCH = /素材|material/i;

  const box = document.getElementById('alarms');
  const bell = document.getElementById('bell');
  const bellCount = document.getElementById('bell-count');
  let muted = false;          // 靜音：不響提示音（通知照常顯示），存在小工具設定裡

  // 點鈴鐺切換靜音（不觸發時鐘的 ET/LT 切換）
  bell.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setMuted(!muted);
    if (window.widget) window.widget.saveSettings({ muted });
  });
  function setMuted(v) {
    muted = !!v;
    bell.classList.toggle('muted', muted);
    updateBellText();
  }
  const BASE_HEIGHT = 112;               // widget.json 的 height

  let source = null;     // { cat, f: { name, type, start, end, enabled } }
  let items = [];
  const dismissed = new Set();   // `${itemId}@${開始時間}`：手動關閉的這一次
  const announced = new Set();   // 已響過提示音的
  const cards = new Map();       // key -> 元素

  const text = (f) => `${f.label} ${f.key}`;

  function detect(cat) {
    const fields = cat.fields;
    const times = fields.filter((f) => f.type === 'time');
    const start = times.find((f) => /開始|start|begin|from/i.test(text(f))) || times[0];
    const end = times.find((f) => f !== start && /結束|end|until|to\b/i.test(text(f))) || times.find((f) => f !== start);
    const type = fields.find((f) => f.type !== 'time' && /類型|種類|type/i.test(text(f)))
      || fields.find((f) => f.type === 'select' && (f.options || []).some((o) => /\bET\b|\bLT\b|艾奧|本地/i.test(`${o.label} ${o.value}`)));
    const name = fields.find((f) => f.type === 'text' && /名稱|name|素材/i.test(text(f))) || fields.find((f) => f.type === 'text');
    const enabled = fields.find((f) => f.type === 'boolean' && /啟用|鬧鈴|提醒|enable|alarm/i.test(text(f)));
    if (!start || !end) return null;
    return { name, type, start, end, enabled };
  }

  async function load() {
    try {
      const cats = await window.widget.db.categories();
      const cat = cats.find((c) => CATEGORY_MATCH.test(c.name)) || cats.find((c) => CATEGORY_MATCH.test(c.id));
      const f = cat && detect(cat);
      source = f ? { cat, f } : null;
      items = source ? await window.widget.db.items(cat.id) : [];
    } catch (err) {
      console.error('讀取素材資料失敗', err);
      source = null;
      items = [];
    }
    updateBell();
    tick();
  }

  // 有啟用的鬧鈴才顯示鈴鐺：開始／結束時間都有填，且「啟用」欄位不是否（沒有啟用欄位時視為啟用）
  let enabledCount = 0;
  function updateBell() {
    enabledCount = source ? items.filter((item) =>
      (!source.f.enabled || item.data[source.f.enabled.key] !== false) &&
      toMinutes(item.data[source.f.start.key]) !== null &&
      toMinutes(item.data[source.f.end.key]) !== null
    ).length : 0;
    bell.hidden = enabledCount === 0;
    updateBellText();
  }

  // 鈴鐺旁的數字＝目前跳出的通知數量
  let noticeCount = 0;
  function updateBellText() {
    bellCount.textContent = noticeCount > 0 ? noticeCount : '';
    bell.title = [
      `已啟用 ${enabledCount} 個素材鬧鈴`,
      noticeCount ? `目前 ${noticeCount} 個通知` : '目前沒有通知',
      muted ? '🔇 靜音中（點擊恢復提示音）' : '點擊切換靜音'
    ].join('\n');
  }

  // 這筆資料是艾奧傑亞時間還是本地時間
  function clockOf(item) {
    const tf = source.f.type;
    if (!tf) return 'et';
    const v = item.data[tf.key];
    const opt = (tf.options || []).find((o) => o.value === v);
    const s = `${v ?? ''} ${opt ? opt.label : ''}`;
    return /\bLT\b|本地|現實|local|real/i.test(s) ? 'lt' : 'et';
  }

  const toMinutes = (hhmm) => {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
    return m ? +m[1] * 60 + +m[2] : null;
  };

  // 找出「現在正在提醒範圍內」的那一次：[開始-3分, 結束)；回傳現實時間毫秒
  function windowOf(item, now) {
    const s = toMinutes(item.data[source.f.start.key]);
    const e = toMinutes(item.data[source.f.end.key]);
    if (s === null || e === null) return null;
    const durMin = ((e - s + 1440) % 1440) || 1440;   // 結束 ≤ 開始 視為跨過午夜；相同視為一整天

    if (clockOf(item) === 'et') {
      const etNow = now * EORZEA_MULTIPLIER;
      const dayStart = Math.floor(etNow / ET_DAY) * ET_DAY;
      for (const k of [-1, 0, 1]) {
        const startEt = dayStart + k * ET_DAY + s * 60000;
        const ws = startEt / EORZEA_MULTIPLIER;
        const we = (startEt + durMin * 60000) / EORZEA_MULTIPLIER;
        if (now >= ws - LEAD_MS && now < we) return { ws, we, clock: 'et', s, e };
      }
    } else {
      const base = new Date(now);
      for (const k of [-1, 0, 1]) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k, 0, s, 0, 0);
        const ws = d.getTime();
        const we = ws + durMin * 60000;
        if (now >= ws - LEAD_MS && now < we) return { ws, we, clock: 'lt', s, e };
      }
    }
    return null;
  }

  const hm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const mmss = (ms) => {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
  };

  function makeCard(key) {
    const el = document.createElement('div');
    el.className = 'alarm';
    el.innerHTML = `
      <button class="alarm-close" title="關閉這次提醒">✕</button>
      <div class="alarm-top"><span class="alarm-name"></span><span class="alarm-status"></span></div>
      <div class="alarm-range"></div>
      <div class="bar"><div class="bar-fill"></div></div>`;
    const nameEl = el.querySelector('.alarm-name');
    nameEl.title = '點擊複製素材名稱';
    nameEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const name = nameEl.dataset.name;
      if (!name) return;
      try {
        await window.widget.copyText(name);
        nameEl.dataset.copiedUntil = Date.now() + 1200;
        nameEl.classList.add('copied');
        nameEl.textContent = '已複製 ✓';
      } catch { /* ignore */ }
    });
    el.querySelector('.alarm-close').addEventListener('click', (ev) => {
      ev.stopPropagation();
      dismissed.add(key);
      tick();
    });
    return el;
  }

  function tick() {
    const now = Date.now();
    const active = [];
    if (source) {
      for (const item of items) {
        if (source.f.enabled && item.data[source.f.enabled.key] === false) continue;
        const w = windowOf(item, now);
        if (!w) continue;
        const key = `${item.id}@${Math.round(w.ws)}`;
        if (dismissed.has(key)) continue;
        active.push({ item, w, key });
      }
    }
    active.sort((a, b) => a.w.ws - b.w.ws);

    // 移除結束的
    const keys = new Set(active.map((a) => a.key));
    for (const [key, el] of cards) {
      if (!keys.has(key)) {
        el.remove();
        cards.delete(key);
      }
    }

    active.forEach(({ item, w, key }, i) => {
      let el = cards.get(key);
      if (!el) {
        el = makeCard(key);
        cards.set(key, el);
        if (!announced.has(key)) {
          announced.add(key);
          if (!muted) chime();
        }
      }
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);

      const upcoming = now < w.ws;
      const p = upcoming ? 0 : Math.min(1, (now - w.ws) / (w.we - w.ws));
      const name = (source.f.name && item.data[source.f.name.key]) || '（未命名）';
      el.classList.toggle('upcoming', upcoming);
      const nameEl = el.querySelector('.alarm-name');
      nameEl.dataset.name = name;
      if (Date.now() > +(nameEl.dataset.copiedUntil || 0)) {
        nameEl.classList.remove('copied');
        nameEl.textContent = name;
      }
      el.querySelector('.alarm-status').textContent = upcoming ? `${mmss(w.ws - now)} 後開始` : `剩 ${mmss(w.we - now)}`;
      const range = el.querySelector('.alarm-range');
      const tag = w.clock === 'et' ? 'ET' : 'LT';
      range.innerHTML = `<b class="${w.clock}">${tag}</b> ${hm(w.s)} – ${hm(w.s + (((w.e - w.s + 1440) % 1440) || 1440))}`;
      const fill = el.querySelector('.bar-fill');
      fill.style.width = `${(p * 100).toFixed(2)}%`;
      // 綠（剛開始）→ 黃 → 紅（快結束）
      fill.style.backgroundColor = `hsl(${Math.round(120 * (1 - p))}, 75%, 48%)`;
    });

    bell.classList.toggle('ringing', active.length > 0);
    if (noticeCount !== active.length) {
      noticeCount = active.length;
      updateBellText();
    }
    fitWindow();
  }

  let lastHeight = 0;
  function fitWindow() {
    const extra = box.children.length ? box.offsetHeight + 6 + 8 : 0; // 6 = margin-top, 8 = 陰影空間
    const h = BASE_HEIGHT + extra;
    if (h !== lastHeight && window.widget && window.widget.setHeight) {
      lastHeight = h;
      window.widget.setHeight(h);
    }
  }

  // 簡短的兩聲提示音
  let audio;
  function chime() {
    try {
      audio = audio || new AudioContext();
      const t0 = audio.currentTime;
      [[880, 0], [1320, 0.16]].forEach(([freq, at]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 0.5);
      });
    } catch { /* 沒有音效裝置時忽略 */ }
  }

  if (!window.widget || !window.widget.db) return; // 一般瀏覽器預覽時沒有資料庫
  window.widget.db.onChange(() => load());
  setInterval(tick, 250);
  window.widget.getState().then((s) => setMuted(s.settings && s.settings.muted)).catch(() => {});
  load();
})();
