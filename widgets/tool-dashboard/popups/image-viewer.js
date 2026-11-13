// 圖片放大檢視：資料 { src, alt, theme } 由聊天視窗點圖片時傳入
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const img = $('img');
const msg = $('msg');
const zoomText = $('zoom');

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
let scale = 1;
let x = 0;
let y = 0;
let fitted = true; // 目前是「符合視窗」：視窗大小改變時跟著重算
let hintTimer = 0;

function apply() {
  img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  zoomText.textContent = `${Math.round(scale * 100)}%`;
  stage.classList.toggle('pixel', scale >= 3);
}

/** 縮放到指定比例，並讓 (cx, cy) 這個畫面位置維持在原處 */
function zoomAt(next, cx, cy) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  x = cx - (cx - x) * (s / scale);
  y = cy - (cy - y) * (s / scale);
  scale = s;
  fitted = false;
  apply();
}

/** 置中；小圖不放大，只有比視窗大時才縮小 */
function fit() {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return;
  const r = stage.getBoundingClientRect();
  scale = Math.min(1, r.width / w, r.height / h);
  x = (r.width - w * scale) / 2;
  y = (r.height - h * scale) / 2;
  fitted = true;
  apply();
}

function actualSize() {
  const r = stage.getBoundingClientRect();
  zoomAt(1, r.width / 2, r.height / 2);
}

function load(data) {
  if (!data || !data.src) return;
  document.body.dataset.theme = data.theme === 'light' ? 'light' : 'dark';
  const title = data.alt && data.alt !== '附加的圖片' ? data.alt : '圖片';
  $('title').textContent = title;
  document.title = title;
  msg.hidden = true;
  img.hidden = false;
  img.alt = data.alt || '';
  img.src = data.src;
}

img.addEventListener('load', fit);
img.addEventListener('error', () => {
  img.hidden = true;
  msg.hidden = false;
  msg.textContent = '無法顯示這張圖片';
  zoomText.textContent = '';
});

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { px: e.clientX, py: e.clientY, x, y };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  x = drag.x + e.clientX - drag.px;
  y = drag.y + e.clientY - drag.py;
  fitted = false;
  apply();
});
const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('dblclick', fit);

window.addEventListener('resize', () => { if (fitted) fit(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
  else if (e.key === '0') fit();
  else if (e.key === '1') actualSize();
  else if (e.key === '+' || e.key === '=' || e.key === '-') {
    const r = stage.getBoundingClientRect();
    zoomAt(scale * (e.key === '-' ? 1 / 1.25 : 1.25), r.width / 2, r.height / 2);
  }
});
$('fit').addEventListener('click', fit);
$('actual').addEventListener('click', actualSize);
$('close').addEventListener('click', () => window.popup.close());

// 操作提示幾秒後淡出
hintTimer = setTimeout(() => { $('hint').hidden = true; }, 3000);
stage.addEventListener('pointerdown', () => { clearTimeout(hintTimer); $('hint').hidden = true; }, { once: true });

window.popup.onData(load);
window.popup.getData().then(load);
