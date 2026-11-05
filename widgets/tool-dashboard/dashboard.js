// 工具儀表盤：倒梯形面板，每頁 5 × 2 個圓形圖示按鈕，超過 10 個自動分頁
const PER_PAGE = 10;
const PAGE_STEP = 204;      // 一頁 188（5 × 28 + 4 × 12）+ 頁間距 16
const BASE_HEIGHT = 196;    // widget.json 的 height（角色面板 64 + 間距 6 + 梯形 104 + 上下留白）
const TOAST_HEIGHT = 38;    // 6px 間距 + 32px 通知
const TIP_HEIGHT = 20;      // 工具提示需要多出的高度（6px 間距 + 24px 提示 + 陰影，扣掉原本留白）
const TIP_DELAY = 350;      // 滑鼠停留多久才顯示提示
const TIP_MIN_X = 22;       // 提示的左右界線：面板下方斜邊在這個高度的位置
const TIP_MAX_X = 258;
const TIP_TOP_DASH = 180;   // 梯形下方的提示位置
const TIP_TOP_AGENTS = 70;  // 角色面板下方的提示位置（蓋在梯形上，不需要長高）
const TOAST_MS = 2500;
const CELL = 28;            // 按鈕直徑
const CELL_STEP = 40;       // 按鈕直徑 + 間距
const VIEW_PAD = 8;         // 按鈕區外擴的 padding（見 .viewport）
const DRAG_THRESHOLD = 4;   // 移動超過幾 px 才算拖曳，否則視為點擊
const ARROW_DELAY = 350;    // 拖到箭頭上停留多久換頁
const ARROW_REPEAT = 800;   // 一直停在箭頭上時，每隔多久再換一頁
const SLIDE_MS = 360;       // 換頁動畫時間

const tools = Array.isArray(window.TOOLS) ? window.TOOLS : [];
const pageCount = Math.max(1, Math.ceil(tools.length / PER_PAGE));

// 按鈕順序（可拖曳調整，存在小工具設定的 order）
let order = tools.slice();

const els = {
  body: document.body,
  dash: document.getElementById('dash'),
  agents: document.getElementById('agents'),
  viewport: document.querySelector('.viewport'),
  track: document.getElementById('track'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  dots: document.getElementById('dots'),
  theme: document.getElementById('theme'),
  tip: document.getElementById('tip'),
  tipText: document.getElementById('tip-text'),
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toast-text'),
  toastSwatch: document.getElementById('toast-swatch')
};

const hasApi = () => !!window.widget;
let page = 0;

// ---- 建立按鈕 ----
function buildPages() {
  els.track.textContent = '';
  for (let p = 0; p < pageCount; p++) {
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    for (let i = 0; i < PER_PAGE; i++) {
      const tool = order[p * PER_PAGE + i];
      pageEl.appendChild(tool ? toolButton(tool) : emptySlot());
    }
    els.track.appendChild(pageEl);
  }

  els.dots.textContent = '';
  if (pageCount > 1) {
    for (let p = 0; p < pageCount; p++) els.dots.appendChild(document.createElement('span'));
  }
}

function toolButton(tool) {
  const btn = document.createElement('button');
  btn.className = 'tool';
  btn.dataset.id = tool.id;
  btn.dataset.tip = tool.name;
  btn.setAttribute('aria-label', `${tool.name}（Alt + 方向鍵調整順序）`);
  if (drag && drag.started && drag.id === tool.id) btn.classList.add('placeholder'); // 拖曳中原本的位置
  bindTip(btn);
  btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${tool.icon}</svg>`;
  btn.addEventListener('click', () => {
    if (suppressClick) return; // 剛拖曳完，不執行功能
    runTool(tool, btn);
  });
  return btn;
}

/** 依目前 order 重建按鈕；animate 時讓位置改變的按鈕滑到新位置（FLIP） */
function render({ animate = false, from = null } = {}) {
  const before = animate ? snapshot() : null;
  if (before && from) Object.assign(before, from);
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  buildPages();
  goTo(page);
  if (focusedId) {
    const b = els.track.querySelector(`.tool[data-id="${focusedId}"]`);
    if (b) b.focus();
  }
  if (before) flip(before);
}

/** 目前頁面上每個按鈕的位置 */
function snapshot() {
  const map = {};
  const pg = els.track.children[page];
  if (pg) for (const b of pg.querySelectorAll('.tool')) map[b.dataset.id] = b.getBoundingClientRect();
  return map;
}

function flip(before) {
  const pg = els.track.children[page];
  if (!pg) return;
  for (const b of pg.querySelectorAll('.tool')) {
    const old = before[b.dataset.id];
    if (!old) continue;
    const now = b.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) continue;
    b.style.transition = 'none';
    b.style.transform = `translate(${dx}px, ${dy}px)`;
    b.getBoundingClientRect(); // 強制套用起始位置
    b.style.transition = 'transform 0.18s ease';
    b.style.transform = '';
    b.addEventListener('transitionend', () => { b.style.transition = ''; }, { once: true });
  }
}

function saveOrder() {
  if (hasApi()) window.widget.saveSettings({ order: order.map((t) => t.id) });
}

/** 套用儲存的順序：未知的 id 略過，新加入的工具排在最後 */
function applySavedOrder(ids) {
  if (!Array.isArray(ids)) return;
  const byId = new Map(tools.map((t) => [t.id, t]));
  const seen = new Set();
  const next = [];
  for (const id of ids) {
    if (byId.has(id) && !seen.has(id)) {
      next.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const t of tools) if (!seen.has(t.id)) next.push(t);
  order = next;
}

/** 把 order 中 from 位置的工具移到 to */
function moveTool(from, to) {
  const [t] = order.splice(from, 1);
  order.splice(to, 0, t);
}

function emptySlot() {
  const s = document.createElement('span');
  s.className = 'slot';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

// ---- 分頁 ----
function goTo(p) {
  page = Math.max(0, Math.min(pageCount - 1, p));
  els.track.style.transform = `translateX(-${page * PAGE_STEP}px)`;
  els.prev.hidden = page === 0;
  els.next.hidden = page === pageCount - 1;
  [...els.dots.children].forEach((d, i) => d.classList.toggle('on', i === page));
  // 被滑出畫面的按鈕不要被 Tab 選到
  [...els.track.children].forEach((pg, i) => { pg.inert = i !== page; });
}

// ---- 視窗高度：通知優先，其次是工具提示 ----
let toastOn = false;
let tipOn = false;
let tipExtra = 0;           // 目前的提示需要多出的視窗高度

function syncHeight() {
  if (!hasApi()) return;
  window.widget.setHeight(BASE_HEIGHT + (toastOn ? TOAST_HEIGHT : tipOn ? tipExtra : 0));
}

// ---- 工具提示 ----
let tipTimer = null;
let tipHideTimer = null;
let tipHiddenAt = 0;        // 上次收起提示的時間，用來判斷是否從一個按鈕直接移到另一個
let hovered = null;         // 目前滑鼠所在的按鈕（通知收起後要補顯示它的提示）

function bindTip(el) {
  el.addEventListener('pointerenter', () => { hovered = el; scheduleTip(el); });
  el.addEventListener('pointerleave', () => { if (hovered === el) hovered = null; hideTip(); });
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showTip(el); });
  el.addEventListener('blur', hideTip);
  el.addEventListener('click', hideTip);
}

function scheduleTip(el) {
  clearTimeout(tipTimer);
  if ((drag && drag.started) || (agentDrag && agentDrag.started)) return; // 拖曳中不顯示提示
  // 剛從另一個按鈕移過來（提示還在或剛收起）就直接顯示，不再等待
  const instant = tipOn || Date.now() - tipHiddenAt < 300;
  tipTimer = setTimeout(() => showTip(el), instant ? 0 : TIP_DELAY);
}

function showTip(el) {
  if (toastOn || !el.dataset.tip || (drag && drag.started) || (agentDrag && agentDrag.started)) return;
  clearTimeout(tipHideTimer);
  els.tipText.textContent = el.dataset.tip;
  els.tip.hidden = false;

  // 置中對齊按鈕，超出斜邊範圍時往內收，箭頭仍指向按鈕
  const stage = els.tip.offsetParent.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2 - stage.left;
  const w = els.tip.offsetWidth;
  const inAgents = !!el.closest('.agents');
  const left = inAgents
    ? Math.max(4, Math.min(276 - w, cx - w / 2)) // 角色面板是長方形，左右可以放寬
    : Math.max(TIP_MIN_X, Math.min(TIP_MAX_X - w, cx - w / 2));
  els.tip.style.left = `${left}px`;
  els.tip.style.top = `${inAgents ? TIP_TOP_AGENTS : TIP_TOP_DASH}px`;
  const extra = inAgents ? 0 : TIP_HEIGHT;
  if (tipOn && extra !== tipExtra) { tipExtra = extra; syncHeight(); }
  tipExtra = extra;
  // 箭頭盡量指向按鈕，但不超出提示本身的圓角範圍
  els.tip.style.setProperty('--caret', `${Math.max(10, Math.min(w - 10, cx - left))}px`);

  if (!tipOn) {
    tipOn = true;
    syncHeight(); // 先長高再顯示
  }
  requestAnimationFrame(() => els.tip.classList.add('show'));
}

function hideTip() {
  clearTimeout(tipTimer);
  if (!tipOn) return;
  tipOn = false;
  tipHiddenAt = Date.now();
  els.tip.classList.remove('show');
  tipHideTimer = setTimeout(() => {
    if (tipOn) return;
    els.tip.hidden = true;
    syncHeight(); // 淡出後再縮回
  }, 120);
}

[els.theme, els.prev, els.next].forEach(bindTip);

els.prev.addEventListener('click', () => goTo(page - 1));
els.next.addEventListener('click', () => goTo(page + 1));

// ---- 拖曳調整順序 ----
/** @type {null | { id, pointerId, sx, sy, offX, offY, started, index, origOrder, origPage, ghost }} */
let drag = null;
let suppressClick = false;
let sliding = false;
let arrowDir = 0;
let arrowTimer = null;

els.track.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag) return;
  const btn = e.target.closest('.tool');
  if (!btn || btn.classList.contains('busy')) return;
  const r = btn.getBoundingClientRect();
  drag = {
    id: btn.dataset.id,
    pointerId: e.pointerId,
    sx: e.clientX,
    sy: e.clientY,
    offX: e.clientX - r.left,
    offY: e.clientY - r.top,
    started: false,
    index: order.findIndex((t) => t.id === btn.dataset.id),
    origOrder: order.slice(),
    origPage: page,
    ghost: null
  };
});

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
    startDrag();
  }
  moveDrag(e.clientX, e.clientY);
});

window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.started) endDrag(true);
  else drag = null; // 沒有移動：一般點擊
});
window.addEventListener('pointercancel', () => { if (drag) endDrag(false); });
window.addEventListener('blur', () => { if (drag && drag.started) endDrag(false); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drag && drag.started) endDrag(false);
});

function startDrag() {
  drag.started = true;
  hideTip();
  // 指標移出按鈕或視窗也持續收到事件
  try { els.dash.setPointerCapture(drag.pointerId); } catch { /* 指標已放開 */ }
  document.documentElement.classList.add('tool-dragging');

  const src = els.track.querySelector(`.tool[data-id="${drag.id}"]`);
  const ghost = src.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.removeAttribute('data-id');
  ghost.setAttribute('aria-hidden', 'true');
  els.dash.appendChild(ghost);
  drag.ghost = ghost;
  render(); // 原位置改成虛線佔位
}

function moveDrag(x, y) {
  // 鬼影跟著指標，限制在面板範圍內
  const d = els.dash.getBoundingClientRect();
  const gx = Math.max(-4, Math.min(d.width - CELL + 4, x - d.left - drag.offX));
  const gy = Math.max(-4, Math.min(d.height - CELL + 4, y - d.top - drag.offY));
  drag.ghost.style.transform = `translate(${gx}px, ${gy}px) scale(1.12)`;

  // 拖到箭頭上：停留後換頁
  const dir = overArrow(x, y);
  if (dir !== arrowDir) setArrowHover(dir);
  drag.ghost.classList.toggle('over-arrow', !!dir);
  if (dir || sliding) return;

  const idx = hitIndex(x, y);
  if (idx !== null && idx !== drag.index) {
    moveTool(drag.index, idx);
    drag.index = idx;
    render({ animate: true });
  }
}

/** 指標在目前頁面的哪一格（回傳 order 的索引；超出工具數量時視為最後一個；不在按鈕區為 null） */
function hitIndex(x, y) {
  const v = els.viewport.getBoundingClientRect();
  const lx = x - (v.left + VIEW_PAD);
  const ly = y - (v.top + VIEW_PAD);
  const half = (CELL_STEP - CELL) / 2;
  if (lx < -half || ly < -half || lx >= 5 * CELL_STEP - half || ly >= 2 * CELL_STEP - half) return null;
  const col = Math.min(4, Math.floor((lx + half) / CELL_STEP));
  const row = Math.min(1, Math.floor((ly + half) / CELL_STEP));
  return Math.min(order.length - 1, page * PER_PAGE + row * 5 + col);
}

function overArrow(x, y) {
  for (const [el, dir] of [[els.prev, -1], [els.next, 1]]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 6 && y <= r.bottom + 6) return dir;
  }
  return 0;
}

function setArrowHover(dir) {
  clearTimeout(arrowTimer);
  els.prev.classList.toggle('drag-over', dir === -1);
  els.next.classList.toggle('drag-over', dir === 1);
  arrowDir = dir;
  if (!dir) return;
  const step = () => {
    const target = page + arrowDir;
    if (target < 0 || target >= pageCount) return;
    goTo(target);
    sliding = true;
    setTimeout(() => { sliding = false; }, SLIDE_MS);
    // 換到第一頁／最後一頁時箭頭會隱藏
    if ((arrowDir === -1 && els.prev.hidden) || (arrowDir === 1 && els.next.hidden)) {
      setArrowHover(0);
      return;
    }
    arrowTimer = setTimeout(step, ARROW_REPEAT);
  };
  arrowTimer = setTimeout(step, ARROW_DELAY);
}

function endDrag(commit) {
  const d = drag;
  setArrowHover(0);
  try { els.dash.releasePointerCapture(d.pointerId); } catch { /* 已釋放 */ }
  document.documentElement.classList.remove('tool-dragging');

  // 放開後按鈕從鬼影的位置滑進格子
  const from = {};
  if (d.ghost) {
    if (commit) from[d.id] = d.ghost.getBoundingClientRect();
    d.ghost.remove();
  }
  drag = null;

  if (commit) {
    render({ animate: true, from });
    if (order.some((t, i) => t !== d.origOrder[i])) saveOrder();
  } else {
    order = d.origOrder;
    page = d.origPage;
    render();
  }
  // 放開時瀏覽器會補送一次 click，吃掉它
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}

// ---- 鍵盤調整順序：Alt + ←→ 前後移一格，Alt + ↑↓ 移一列 ----
els.track.addEventListener('keydown', (e) => {
  const btn = e.target.closest('.tool');
  if (!btn || !e.altKey) return;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[e.key];
  if (!delta) return;
  e.preventDefault();
  const from = order.findIndex((t) => t.id === btn.dataset.id);
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  if (to === from) return;
  moveTool(from, to);
  const targetPage = Math.floor(to / PER_PAGE);
  if (targetPage !== page) {
    page = targetPage;
    render();
  } else {
    render({ animate: true });
  }
  saveOrder();
});

// ---- 執行功能 ----
async function runTool(tool, btn) {
  btn.classList.add('busy');
  let result;
  try {
    result = await tool.run();
  } catch (err) {
    console.error(`執行 ${tool.id} 失敗`, err);
    result = { ok: false, message: '執行失敗' };
  }
  btn.classList.remove('busy');
  if (result && result.ok) {
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), TOAST_MS);
  }
  if (result && result.silent) return; // 工具自己顯示結果（例如彈出視窗）
  showToast(result || { ok: false, message: '執行失敗' });
}

// ---- 通知 ----
let toastTimer = null;
let hideTimer = null;

function showToast({ ok, message, color }) {
  clearTimeout(toastTimer);
  clearTimeout(hideTimer);
  els.toastText.textContent = message;
  els.toast.classList.toggle('error', !ok);
  // 有顏色時以色塊取代打勾圖示
  els.toast.classList.toggle('has-color', !!(ok && color));
  els.toastSwatch.style.background = ok && color ? color : '';
  els.toast.setAttribute('role', ok ? 'status' : 'alert');

  // 通知與提示在同一個位置，通知優先
  hideTip();
  clearTimeout(tipHideTimer);
  els.tip.hidden = true;
  // 先把視窗往下長，再顯示通知
  toastOn = true;
  syncHeight();
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));

  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  els.toast.classList.remove('show');
  hideTimer = setTimeout(() => {
    els.toast.hidden = true;
    toastOn = false;
    syncHeight();
    // 滑鼠一直停在按鈕上時，通知收起後補顯示提示
    if (hovered) scheduleTip(hovered);
  }, 200);
}

// ---- 深淺色 ----
function setTheme(theme) {
  els.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const label = theme === 'light' ? '切換為深色模式' : '切換為淺色模式';
  els.theme.setAttribute('aria-label', label);
  els.theme.dataset.tip = label;
}

els.theme.addEventListener('click', () => {
  const next = els.body.dataset.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  if (hasApi()) window.widget.saveSettings({ theme: next });
});

// ---- Claude 角色面板 ----
const AGENT_STATE_LABEL = { running: '回覆中', waiting: '等待核准' };
const agentsApi = window.widget && window.widget.agents;
let agentState = { roles: [], max: 4 };
let agentDrag = null;
let agentSuppressClick = false;

// ---- 角色需要注意的提示（只有動畫，沒有聲音）----
const ATTN_ONCE_MS = 3200;  // 聊天視窗開著時的提示長度：動畫 1.6s × 2 次
const ATTN_LABEL = { done: '回覆完成', error: '回覆失敗' };
/** @type {Map<string, { kind: 'waiting'|'done'|'error', since: number, sticky: boolean, timer: any }>} */
const agentAttention = new Map();
const agentPrevState = new Map();

function clearAttention(name) {
  const cur = agentAttention.get(name);
  if (cur) clearTimeout(cur.timer);
  agentAttention.delete(name);
}

/** 聊天視窗沒開：持續提示到點開為止；已開著：只提示一下 */
function setAttention(name, kind) {
  const role = agentState.roles.find((r) => r.name === name);
  if (!role) return;
  clearAttention(name);
  const entry = { kind, since: Date.now(), sticky: !role.open, timer: null };
  if (!entry.sticky) {
    entry.timer = setTimeout(() => {
      agentAttention.delete(name);
      renderAgents();
    }, ATTN_ONCE_MS);
  }
  agentAttention.set(name, entry);
}

/** 依角色狀態的變化更新提示 */
function syncAttention() {
  const names = new Set(agentState.roles.map((r) => r.name));
  for (const name of agentAttention.keys()) if (!names.has(name)) clearAttention(name);

  for (const r of agentState.roles) {
    const prev = agentPrevState.get(r.name);
    agentPrevState.set(r.name, r.state);
    if (prev === undefined || prev === r.state) continue;
    const cur = agentAttention.get(r.name);
    if (r.state === 'waiting') setAttention(r.name, 'waiting');
    else if (prev === 'waiting') { if (cur && cur.kind === 'waiting') clearAttention(r.name); }
    else if (r.state === 'running') clearAttention(r.name); // 開始新一輪回覆
  }
}

/** 回覆結束的事件：不看 idle 狀態，因為手動關閉程序時也會變回 idle */
function onAgentEvent({ name, event }) {
  const failed = event.type === 'error' || (event.type === 'result' && event.isError);
  if (failed) {
    // API 錯誤會先後收到 error 與 result，第二次不要重播動畫
    const cur = agentAttention.get(name);
    if (!cur || cur.kind !== 'error') setAttention(name, 'error');
  } else if (event.type === 'result') {
    const cur = agentAttention.get(name);
    if (!cur || cur.kind !== 'error') setAttention(name, 'done');
  } else {
    return;
  }
  renderAgents();
}

function renderAgents() {
  const panel = els.agents;
  if (agentDrag && agentDrag.started) return; // 拖曳中不重畫，放開後再更新
  panel.textContent = '';
  for (const r of agentState.roles) {
    const color = (window.AGENT_COLORS[r.color] || window.AGENT_COLORS.blue).hex;
    const mascot = window.MASCOTS[r.mascot] || window.MASCOTS.blob;
    const btn = document.createElement('button');
    btn.className = `agent${r.state === 'running' ? ' running' : ''}${r.state === 'waiting' ? ' waiting' : ''}${r.open ? ' open' : ''}`;
    btn.dataset.name = r.name;
    btn.style.setProperty('--c', color);
    const attn = agentAttention.get(r.name);
    if (attn) {
      btn.classList.add('attn');
      btn.classList.toggle('attn-error', attn.kind === 'error');
      btn.classList.toggle('attn-sticky', attn.sticky);
      // 按鈕每次都會重建，用負的延遲接續動畫進度，避免重播
      btn.style.setProperty('--attn-delay', `-${Date.now() - attn.since}ms`);
    }
    const stateLabel = AGENT_STATE_LABEL[r.state] || (attn && attn.sticky && ATTN_LABEL[attn.kind]);
    const label = stateLabel ? `${r.displayName} · ${stateLabel}` : r.displayName;
    btn.dataset.tip = label;
    btn.setAttribute('aria-label', `${label}（Alt + ←→ 調整順序）`);
    btn.innerHTML = `${mascot.svg(color, 32)}<span class="badge" aria-hidden="true"></span><span class="open-dot" aria-hidden="true"></span>`;
    btn.addEventListener('click', () => {
      if (agentSuppressClick) return;
      hideTip();
      clearAttention(r.name);
      agentsApi.call('openChat', r.name);
    });
    bindTip(btn);
    panel.appendChild(btn);
  }
  if (agentState.roles.length < (agentState.max || 4)) {
    const add = document.createElement('button');
    add.className = 'agent-add';
    add.dataset.tip = '新增 Claude 角色';
    add.setAttribute('aria-label', '新增 Claude 角色');
    add.innerHTML = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    add.addEventListener('click', () => { hideTip(); agentsApi.call('openEditor', null); });
    bindTip(add);
    panel.appendChild(add);
  }
  // 提示顯示中的按鈕重畫後補回提示內容（例如狀態從「回覆中」變成閒置）
  if (hovered && !hovered.isConnected && hovered.dataset.name) {
    const again = panel.querySelector(`.agent[data-name="${CSS.escape(hovered.dataset.name)}"]`);
    if (again) { hovered = again; if (tipOn) showTip(again); }
  }
}

// 拖曳調整角色順序：放開後才儲存
els.agents.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.agent');
  if (!btn || e.button !== 0 || !agentsApi) return;
  const r = btn.getBoundingClientRect();
  agentDrag = { btn, name: btn.dataset.name, pointerId: e.pointerId, sx: e.clientX, offX: e.clientX - r.left, started: false, ghost: null };
});

window.addEventListener('pointermove', (e) => {
  const d = agentDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.started) {
    if (Math.abs(e.clientX - d.sx) < DRAG_THRESHOLD) return;
    d.started = true;
    hideTip();
    try { els.agents.setPointerCapture(d.pointerId); } catch { /* 已放開 */ }
    document.documentElement.classList.add('tool-dragging');
    d.ghost = d.btn.cloneNode(true);
    d.ghost.classList.add('agent-ghost');
    d.ghost.classList.remove('running');
    els.agents.appendChild(d.ghost);
    d.btn.classList.add('dragging');
  }
  const p = els.agents.getBoundingClientRect();
  const x = Math.max(4, Math.min(p.width - 48, e.clientX - p.left - d.offX));
  d.ghost.style.left = `${x}px`;
  d.ghost.style.top = '9px';
  // 依指標位置決定插入點，其他按鈕即時讓位
  const items = [...els.agents.querySelectorAll('.agent:not(.agent-ghost)')];
  const before = snapshotAgents(items);
  const target = items.find((b) => b !== d.btn && e.clientX < b.getBoundingClientRect().left + 22);
  const current = items.indexOf(d.btn);
  const targetIdx = target ? items.indexOf(target) : items.length;
  if (targetIdx !== current && targetIdx !== current + 1) {
    els.agents.insertBefore(d.btn, target || els.agents.querySelector('.agent-add') || d.ghost);
    flipAgents(items, before);
  }
});

function snapshotAgents(items) {
  return new Map(items.map((b) => [b, b.getBoundingClientRect().left]));
}

function flipAgents(items, before) {
  for (const b of items) {
    const dx = before.get(b) - b.getBoundingClientRect().left;
    if (!dx) continue;
    b.style.transition = 'none';
    b.style.transform = `translateX(${dx}px)`;
    b.getBoundingClientRect();
    b.style.transition = 'transform 0.18s ease';
    b.style.transform = '';
  }
}

function endAgentDrag(commit) {
  const d = agentDrag;
  agentDrag = null;
  if (!d || !d.started) return;
  try { els.agents.releasePointerCapture(d.pointerId); } catch { /* 已釋放 */ }
  document.documentElement.classList.remove('tool-dragging');
  d.ghost.remove();
  d.btn.classList.remove('dragging');
  const names = [...els.agents.querySelectorAll('.agent')].map((b) => b.dataset.name);
  agentSuppressClick = true;
  setTimeout(() => { agentSuppressClick = false; }, 0);
  if (commit && names.join() !== agentState.roles.map((r) => r.name).join()) {
    const byName = new Map(agentState.roles.map((r) => [r.name, r]));
    agentState.roles = names.map((n) => byName.get(n)).filter(Boolean);
    agentsApi.call('reorder', names);
  }
  renderAgents();
}

window.addEventListener('pointerup', (e) => {
  if (agentDrag && e.pointerId === agentDrag.pointerId) {
    if (agentDrag.started) endAgentDrag(true);
    else agentDrag = null;
  }
});
window.addEventListener('pointercancel', () => endAgentDrag(false));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && agentDrag && agentDrag.started) endAgentDrag(false); });

// 鍵盤調整順序：Alt + ←→
els.agents.addEventListener('keydown', (e) => {
  const btn = e.target.closest('.agent');
  if (!btn || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const names = agentState.roles.map((r) => r.name);
  const i = names.indexOf(btn.dataset.name);
  const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
  if (j < 0 || j >= names.length) return;
  [names[i], names[j]] = [names[j], names[i]];
  const byName = new Map(agentState.roles.map((r) => [r.name, r]));
  agentState.roles = names.map((n) => byName.get(n));
  renderAgents();
  els.agents.querySelector(`.agent[data-name="${CSS.escape(btn.dataset.name)}"]`).focus();
  agentsApi.call('reorder', names);
});

async function initAgents() {
  if (!agentsApi) { els.agents.hidden = true; return; }
  agentsApi.onChanged((s) => { agentState = s; syncAttention(); renderAgents(); });
  agentsApi.onEvent(onAgentEvent);
  try {
    agentState = await agentsApi.call('state');
  } catch (err) {
    console.error('讀取角色失敗', err);
  }
  syncAttention();
  renderAgents();
}

// ---- 啟動 ----
buildPages();
goTo(0);
initAgents();
setTheme('dark');

(async () => {
  try {
    const { settings } = await window.widget.getState();
    if (settings && settings.theme) setTheme(settings.theme);
    if (settings && settings.order) {
      applySavedOrder(settings.order);
      render();
    }
  } catch { /* 在一般瀏覽器開啟時沒有 widget API */ }
})();
