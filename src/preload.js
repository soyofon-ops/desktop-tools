// 所有小工具共用的 preload：
// 1. 處理拖曳移動（拖曳跟點擊分開判斷，所以小工具內的 click 事件可以正常使用）
// 2. 右鍵選單
// 3. 提供 window.widget API 讓小工具讀寫自己的設定
const { contextBridge, ipcRenderer } = require('electron');

let locked = false;
const lockedListeners = new Set();

ipcRenderer.on('widget:locked', (_e, value) => {
  locked = value;
  lockedListeners.forEach(fn => fn(value));
});

contextBridge.exposeInMainWorld('widget', {
  /** 取得 { id, locked, settings } */
  getState: async () => {
    const s = await ipcRenderer.invoke('widget:get-state');
    locked = s.locked;
    return s;
  },
  /** 合併儲存此小工具的設定，下次啟動時 getState() 會拿到 */
  saveSettings: (settings) => ipcRenderer.send('widget:set-settings', settings),
  onLockedChange: (fn) => lockedListeners.add(fn)
});

// ---- 拖曳 ----
const DRAG_THRESHOLD = 4;
let drag = null;        // { pointerId, sx, sy, wx, wy, moved }
let suppressClick = false;

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || locked) return;
  if (e.target.closest && e.target.closest('[data-no-drag], input, textarea, select, button')) return;
  drag = { pointerId: e.pointerId, sx: e.screenX, sy: e.screenY, moved: false };
  ipcRenderer.send('widget:press'); // 主程序記下此刻的游標與視窗位置
  try { e.target.setPointerCapture(e.pointerId); } catch {}
}, true);

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    document.documentElement.classList.add('widget-dragging');
  }
  ipcRenderer.send('widget:drag-move'); // 實際位置由主程序依系統游標計算
}, true);

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.moved) {
    suppressClick = true;
    document.documentElement.classList.remove('widget-dragging');
  }
  ipcRenderer.send('widget:drag-end');
  drag = null;
}
window.addEventListener('pointerup', endDrag, true);
window.addEventListener('pointercancel', endDrag, true);

// 拖曳結束時吃掉那一次 click，避免拖完就觸發小工具的點擊動作
window.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// ---- 右鍵選單 ----
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ipcRenderer.send('widget:context-menu');
});
