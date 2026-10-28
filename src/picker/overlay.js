// 取色視窗：顯示凍結的螢幕畫面與放大鏡，點擊回傳游標下的像素色碼
const ZOOM_CELLS = 13;   // 放大鏡顯示 13 × 13 像素
const ZOOM_SCALE = 9;    // 每個像素放大 9 倍
const LENS_OFFSET = 24;  // 放大鏡離游標的距離
const LENS_SIZE = { w: 117, h: 145 }; // 含下方色碼標籤

const els = {
  screen: document.getElementById('screen'),
  lens: document.getElementById('lens'),
  zoom: document.getElementById('zoom'),
  swatch: document.getElementById('swatch'),
  hex: document.getElementById('hex'),
  hint: document.getElementById('hint')
};
const zctx = els.zoom.getContext('2d');
zctx.imageSmoothingEnabled = false;

let W = 0;
let H = 0;
let pixels = null; // RGBA
let current = null;

const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

/** 把 BGRA 原始像素轉成 RGBA（直接改寫，不另外配置記憶體） */
function bgraToRgba(u8) {
  for (let i = 0; i < u8.length; i += 4) {
    const b = u8[i];
    u8[i] = u8[i + 2];
    u8[i + 2] = b;
    u8[i + 3] = 255;
  }
  return u8;
}

function colorAt(x, y) {
  const i = (y * W + x) * 4;
  return '#' + hex2(pixels[i]) + hex2(pixels[i + 1]) + hex2(pixels[i + 2]);
}

function update(clientX, clientY) {
  if (!pixels) return;
  // 視窗座標（DIP）換算成截圖的實際像素
  const x = Math.min(W - 1, Math.max(0, Math.floor((clientX * W) / window.innerWidth)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((clientY * H) / window.innerHeight)));
  current = colorAt(x, y);

  const half = (ZOOM_CELLS - 1) / 2;
  zctx.fillStyle = '#000';
  zctx.fillRect(0, 0, els.zoom.width, els.zoom.height);
  zctx.drawImage(els.screen, x - half, y - half, ZOOM_CELLS, ZOOM_CELLS, 0, 0, ZOOM_CELLS * ZOOM_SCALE, ZOOM_CELLS * ZOOM_SCALE);
  els.hex.textContent = current;
  els.swatch.style.background = current;

  // 放大鏡放在游標右下，靠近邊緣時翻到另一側
  let lx = clientX + LENS_OFFSET;
  let ly = clientY + LENS_OFFSET;
  if (lx + LENS_SIZE.w > window.innerWidth) lx = clientX - LENS_OFFSET - LENS_SIZE.w;
  if (ly + LENS_SIZE.h > window.innerHeight) ly = clientY - LENS_OFFSET - LENS_SIZE.h;
  lx = Math.max(0, lx);
  ly = Math.max(0, ly);
  els.lens.style.transform = `translate(${lx}px, ${ly}px)`;
  els.lens.classList.add('on');
  // 游標靠近上方提示時淡出，才取得到被它蓋住的顏色
  els.hint.classList.toggle('away', clientY < 80);
}

window.picker.onInit(({ width, height, bitmap }) => {
  W = width;
  H = height;
  const u8 = bitmap instanceof Uint8Array ? bitmap : new Uint8Array(bitmap);
  pixels = new Uint8ClampedArray(bgraToRgba(u8).buffer, u8.byteOffset, u8.length);
  els.screen.width = W;
  els.screen.height = H;
  els.screen.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
  window.picker.ready();
});

// 用 pointer 事件：座標有小數，螢幕縮放 150%、200% 時才能對準每一個實際像素（mouse 事件只有整數）
window.addEventListener('pointermove', (e) => update(e.clientX, e.clientY));
window.addEventListener('pointerleave', () => els.lens.classList.remove('on'));

window.addEventListener('pointerdown', (e) => {
  if (e.button === 0) {
    update(e.clientX, e.clientY);
    if (current) window.picker.pick(current);
  } else if (e.button === 2) {
    window.picker.cancel();
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.cancel();
});
