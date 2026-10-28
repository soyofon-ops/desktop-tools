// 工具儀表盤：倒梯形面板，每頁 5 × 2 個圓形圖示按鈕，超過 10 個自動分頁
const PER_PAGE = 10;
const PAGE_STEP = 204;      // 一頁 188（5 × 28 + 4 × 12）+ 頁間距 16
const BASE_HEIGHT = 126;    // widget.json 的 height
const TOAST_HEIGHT = 38;    // 6px 間距 + 32px 通知
const TIP_HEIGHT = 20;      // 工具提示需要多出的高度（6px 間距 + 24px 提示 + 陰影，扣掉原本留白）
const TIP_DELAY = 350;      // 滑鼠停留多久才顯示提示
const TIP_MIN_X = 22;       // 提示的左右界線：面板下方斜邊在這個高度的位置
const TIP_MAX_X = 258;
const TOAST_MS = 2500;

const tools = Array.isArray(window.TOOLS) ? window.TOOLS : [];
const pageCount = Math.max(1, Math.ceil(tools.length / PER_PAGE));

const els = {
  body: document.body,
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
      const tool = tools[p * PER_PAGE + i];
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
  btn.dataset.tip = tool.name;
  btn.setAttribute('aria-label', tool.name);
  bindTip(btn);
  btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${tool.icon}</svg>`;
  btn.addEventListener('click', () => runTool(tool, btn));
  return btn;
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

function syncHeight() {
  if (!hasApi()) return;
  window.widget.setHeight(BASE_HEIGHT + (toastOn ? TOAST_HEIGHT : tipOn ? TIP_HEIGHT : 0));
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
  // 剛從另一個按鈕移過來（提示還在或剛收起）就直接顯示，不再等待
  const instant = tipOn || Date.now() - tipHiddenAt < 300;
  tipTimer = setTimeout(() => showTip(el), instant ? 0 : TIP_DELAY);
}

function showTip(el) {
  if (toastOn || !el.dataset.tip) return;
  clearTimeout(tipHideTimer);
  els.tipText.textContent = el.dataset.tip;
  els.tip.hidden = false;

  // 置中對齊按鈕，超出斜邊範圍時往內收，箭頭仍指向按鈕
  const stage = els.tip.offsetParent.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2 - stage.left;
  const w = els.tip.offsetWidth;
  const left = Math.max(TIP_MIN_X, Math.min(TIP_MAX_X - w, cx - w / 2));
  els.tip.style.left = `${left}px`;
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

// ---- 啟動 ----
buildPages();
goTo(0);
setTheme('dark');

(async () => {
  try {
    const { settings } = await window.widget.getState();
    if (settings && settings.theme) setTheme(settings.theme);
  } catch { /* 在一般瀏覽器開啟時沒有 widget API */ }
})();
