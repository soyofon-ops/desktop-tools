// 螢幕取色：擷取每個螢幕的畫面，在上面蓋一層全螢幕的取色視窗，使用者點擊後回傳色碼。
// Windows 上 Electron 的 EyeDropper API 無法取到視窗外的顏色（electron/electron#27980），所以自己實作。
const { BrowserWindow, desktopCapturer, screen, ipcMain } = require('electron');
const path = require('path');

/** @type {{ promise: Promise<string|null>, resolve: Function, windows: BrowserWindow[], done: boolean } | null} */
let session = null;

/**
 * 進入取色模式。
 * @returns {Promise<string|null>} 例如 '#1A2B3C'；使用者取消或擷取失敗時為 null
 */
function pickColor() {
  if (session) return session.promise; // 已經在取色中
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  session = { promise, resolve, windows: [], done: false };
  start(session).catch((err) => {
    console.error('取色失敗', err);
    finish(null);
  });
  return promise;
}

async function start(s) {
  const displays = screen.getAllDisplays();

  // 每個螢幕以實際像素大小擷取（thumbnailSize 會縮放成這個大小，所以要逐一指定）
  const shots = await Promise.all(displays.map(async (d) => {
    const width = Math.round(d.size.width * d.scaleFactor);
    const height = Math.round(d.size.height * d.scaleFactor);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const src = sources.find((x) => x.display_id === String(d.id)) || (displays.length === 1 ? sources[0] : null);
    if (!src || src.thumbnail.isEmpty()) return null;
    const size = src.thumbnail.getSize();
    // toBitmap() 是 BGRA 原始像素，交給取色視窗轉成 RGBA
    return { display: d, width: size.width, height: size.height, bitmap: src.thumbnail.toBitmap() };
  }));

  if (s.done) return;
  const valid = shots.filter(Boolean);
  if (!valid.length) throw new Error('無法擷取螢幕畫面');

  const cursor = screen.getCursorScreenPoint();
  const active = screen.getDisplayNearestPoint(cursor);

  for (const shot of valid) {
    const b = shot.display.bounds;
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, 'picker', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    s.windows.push(win);

    win.webContents.once('did-finish-load', () => {
      if (s.done) return;
      win.webContents.send('picker:init', { width: shot.width, height: shot.height, bitmap: shot.bitmap });
    });
    // 畫面畫好才顯示，避免閃一下黑畫面
    win.__onReady = () => {
      if (s.done || win.isDestroyed()) return;
      win.setBounds(b); // 有些縮放設定下建立時的大小會被調整，再設定一次
      win.show();
      if (shot.display.id === active.id) win.focus(); // 游標所在的螢幕接收 Esc
    };
    // 使用者用 Alt+F4 等方式關掉時視為取消
    win.on('closed', () => {
      if (!s.done) finish(null);
    });
    win.loadFile(path.join(__dirname, 'picker', 'overlay.html'));
  }
}

function finish(hex) {
  const s = session;
  if (!s || s.done) return;
  s.done = true;
  session = null;
  for (const win of s.windows) if (!win.isDestroyed()) win.destroy();
  s.resolve(hex);
}

function fromSender(sender) {
  return session ? session.windows.find((w) => !w.isDestroyed() && w.webContents === sender) : null;
}

ipcMain.on('picker:ready', (e) => {
  const win = fromSender(e.sender);
  if (win) win.__onReady();
});

ipcMain.on('picker:pick', (e, hex) => {
  if (!fromSender(e.sender)) return;
  finish(/^#[0-9A-F]{6}$/.test(hex) ? hex : null);
});

ipcMain.on('picker:cancel', (e) => {
  if (fromSender(e.sender)) finish(null);
});

module.exports = { pickColor };
