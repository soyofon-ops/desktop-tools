// 工具儀表盤：倒梯形面板，每頁 5 × 2 個圓形圖示按鈕，超過 10 個自動分頁
const PER_PAGE = 10;
const PAGE_STEP = 204;      // 一頁 188（5 × 28 + 4 × 12）+ 頁間距 16
const BASE_HEIGHT = 126;    // widget.json 的 height
const TOAST_HEIGHT = 38;    // 6px 間距 + 32px 通知
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
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toast-text')
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
  btn.title = tool.title;
  btn.setAttribute('aria-label', tool.title);
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
  showToast(result || { ok: false, message: '執行失敗' });
}

// ---- 通知 ----
let toastTimer = null;
let hideTimer = null;

function showToast({ ok, message }) {
  clearTimeout(toastTimer);
  clearTimeout(hideTimer);
  els.toastText.textContent = message;
  els.toast.classList.toggle('error', !ok);
  els.toast.setAttribute('role', ok ? 'status' : 'alert');

  // 先把視窗往下長，再顯示通知
  if (hasApi()) window.widget.setHeight(BASE_HEIGHT + TOAST_HEIGHT);
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));

  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  els.toast.classList.remove('show');
  hideTimer = setTimeout(() => {
    els.toast.hidden = true;
    if (hasApi()) window.widget.setHeight(BASE_HEIGHT);
  }, 200);
}

// ---- 深淺色 ----
function setTheme(theme) {
  els.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  els.theme.setAttribute('aria-label', theme === 'light' ? '切換為深色模式' : '切換為淺色模式');
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
