const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---- 只允許一個實例 ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const ROOT = path.join(__dirname, '..');
const BUILTIN_WIDGETS_DIR = path.join(ROOT, 'widgets');
const userWidgetsDir = () => path.join(app.getPath('userData'), 'widgets');

/** @type {Map<string, {manifest: any, dir: string, win: BrowserWindow|null}>} */
const widgets = new Map();
let tray = null;

// ---------------------------------------------------------------------------
// 小工具探索：每個子資料夾放一個 widget.json + index.html 即為一個小工具
// 內建：<app>/widgets/*    使用者自訂：%APPDATA%/Soyofon Desktop Tools/widgets/*
// ---------------------------------------------------------------------------
function discoverWidgets() {
  widgets.clear();
  for (const base of [BUILTIN_WIDGETS_DIR, userWidgetsDir()]) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      const manifestPath = path.join(dir, 'widget.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        m.id = m.id || name;
        m.name = m.name || m.id;
        m.entry = m.entry || 'index.html';
        m.width = m.width || 240;
        m.height = m.height || 120;
        widgets.set(m.id, { manifest: m, dir, win: null });
      } catch (err) {
        console.error(`讀取小工具 ${name} 失敗`, err);
      }
    }
  }
}

// 確保視窗位置在某個螢幕內（螢幕配置改變時避免小工具跑到看不到的地方）
function clampToDisplays(x, y, w, h) {
  const displays = screen.getAllDisplays();
  const visible = displays.some(d => {
    const a = d.workArea;
    return x + w > a.x + 20 && x < a.x + a.width - 20 && y + h > a.y + 20 && y < a.y + a.height - 20;
  });
  if (visible) return { x, y };
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - w - 40, y: a.y + 40 };
}

function defaultPosition(index, w) {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - w - 40, y: a.y + 40 + index * 140 };
}

function openWidget(id) {
  const entry = widgets.get(id);
  if (!entry || entry.win) return;
  const m = entry.manifest;
  const cfg = config.widget(id);

  let pos;
  if (Number.isFinite(cfg.x) && Number.isFinite(cfg.y)) {
    pos = clampToDisplays(cfg.x, cfg.y, m.width, m.height);
  } else {
    pos = defaultPosition([...widgets.keys()].indexOf(id), m.width);
  }

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: m.width,
    height: m.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: m.name,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--widget-id=${id}`]
    }
  });

  applyAlwaysOnTop(win, !!cfg.alwaysOnTop);
  win.loadFile(path.join(entry.dir, m.entry));
  win.once('ready-to-show', () => win.showInactive());

  // 記錄位置（拖曳中會一直觸發，config.save 會延遲寫檔）
  win.on('move', () => {
    const [x, y] = win.getPosition();
    const c = config.widget(id);
    c.x = x;
    c.y = y;
    config.save();
  });

  win.on('closed', () => {
    entry.win = null;
  });

  entry.win = win;
  cfg.enabled = true;
  config.save();
}

// 置頂：用 screen-saver 層級，才能蓋在全螢幕視窗／遊戲（無邊框視窗模式）上面
function applyAlwaysOnTop(win, on) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
  if (process.platform === 'darwin') {
    // macOS：置頂時也出現在全螢幕 App 的空間與所有桌面
    win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true });
  }
}

function setWidgetAlwaysOnTop(id, on) {
  const entry = widgets.get(id);
  config.widget(id).alwaysOnTop = on;
  config.save();
  if (entry) applyAlwaysOnTop(entry.win, on);
  rebuildTrayMenu();
}

function closeWidget(id, { remember = true } = {}) {
  const entry = widgets.get(id);
  if (!entry || !entry.win) return;
  entry.win.close();
  entry.win = null;
  if (remember) {
    config.widget(id).enabled = false;
    config.save();
  }
}

function widgetIdFromSender(sender) {
  for (const [id, e] of widgets) if (e.win && e.win.webContents === sender) return id;
  return null;
}

// ---------------------------------------------------------------------------
// IPC：拖曳、設定、右鍵選單
// ---------------------------------------------------------------------------
ipcMain.handle('widget:get-state', (e) => {
  const id = widgetIdFromSender(e.sender);
  const c = config.get();
  return { id, locked: c.locked, settings: id ? config.widget(id).settings : {} };
});

ipcMain.on('widget:set-settings', (e, settings) => {
  const id = widgetIdFromSender(e.sender);
  if (!id) return;
  config.widget(id).settings = { ...config.widget(id).settings, ...settings };
  config.save();
});

// 拖曳：以系統游標位置計算（不依賴網頁回報的座標，避免視窗移動時座標回饋造成漂移）
const drags = new Map(); // webContents.id -> { cx, cy, wx, wy }

ipcMain.on('widget:press', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  drags.set(e.sender.id, { cx: c.x, cy: c.y, wx, wy });
});

ipcMain.on('widget:drag-move', (e) => {
  if (config.get().locked) return;
  const d = drags.get(e.sender.id);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!d || !win) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(Math.round(d.wx + c.x - d.cx), Math.round(d.wy + c.y - d.cy));
});

ipcMain.on('widget:drag-end', (e) => {
  drags.delete(e.sender.id);
  config.saveNow();
});

ipcMain.on('widget:context-menu', (e) => {
  const id = widgetIdFromSender(e.sender);
  if (!id) return;
  const entry = widgets.get(id);
  const c = config.widget(id);
  Menu.buildFromTemplate([
    { label: entry.manifest.name, enabled: false },
    { type: 'separator' },
    {
      label: '永遠在最上層',
      type: 'checkbox',
      checked: !!c.alwaysOnTop,
      click: (item) => setWidgetAlwaysOnTop(id, item.checked)
    },
    lockMenuItem(),
    { label: '重新載入', click: () => entry.win && entry.win.reload() },
    { label: '隱藏此小工具', click: () => { closeWidget(id); rebuildTrayMenu(); } }
  ]).popup({ window: entry.win });
});

function lockMenuItem() {
  return {
    label: '鎖定位置',
    type: 'checkbox',
    checked: !!config.get().locked,
    click: (item) => {
      config.get().locked = item.checked;
      config.save();
      broadcast('widget:locked', item.checked);
      rebuildTrayMenu();
    }
  };
}

function broadcast(channel, ...args) {
  for (const e of widgets.values()) e.win && e.win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------------------
// 開機自動啟動（只在打包後生效，開發模式不會把 electron.exe 註冊進去）
// ---------------------------------------------------------------------------
function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: !!config.get().autoStart,
    path: process.execPath,
    args: ['--hidden']
  });
}

// ---------------------------------------------------------------------------
// 系統匣
// ---------------------------------------------------------------------------
function rebuildTrayMenu() {
  if (!tray) return;
  const widgetItems = [...widgets.values()].map(({ manifest, win }) => ({
    label: manifest.name,
    type: 'checkbox',
    checked: !!win,
    click: (item) => {
      item.checked ? openWidget(manifest.id) : closeWidget(manifest.id);
      rebuildTrayMenu();
    }
  }));

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '小工具', enabled: false },
    ...(widgetItems.length ? widgetItems : [{ label: '（沒有找到小工具）', enabled: false }]),
    { type: 'separator' },
    {
      label: '置頂顯示',
      submenu: [...widgets.values()].map(({ manifest }) => ({
        label: manifest.name,
        type: 'checkbox',
        checked: !!config.widget(manifest.id).alwaysOnTop,
        click: (item) => setWidgetAlwaysOnTop(manifest.id, item.checked)
      }))
    },
    lockMenuItem(),
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      checked: !!config.get().autoStart,
      enabled: app.isPackaged,
      click: (item) => {
        config.get().autoStart = item.checked;
        config.saveNow();
        applyAutoStart();
      }
    },
    { type: 'separator' },
    {
      label: '重新掃描小工具',
      click: () => {
        const open = [...widgets.values()].filter(e => e.win).map(e => e.manifest.id);
        open.forEach(id => closeWidget(id, { remember: false }));
        discoverWidgets();
        restoreWidgets();
        rebuildTrayMenu();
      }
    },
    {
      label: '開啟自訂小工具資料夾',
      click: () => {
        fs.mkdirSync(userWidgetsDir(), { recursive: true });
        shell.openPath(userWidgetsDir());
      }
    },
    { label: '開啟設定檔', click: () => shell.showItemInFolder(config.file()) },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() }
  ]));
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  // macOS 選單列圖示為 16pt（32px 圖當 @2x 用），Windows 系統匣維持原尺寸
  if (process.platform === 'darwin') icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Soyofon Desktop Tools');
  if (process.platform !== 'darwin') tray.on('click', () => tray.popUpContextMenu());
  rebuildTrayMenu();
}

function restoreWidgets() {
  for (const { manifest } of widgets.values()) {
    const c = config.widget(manifest.id);
    const enabled = c.enabled === undefined ? manifest.defaultEnabled !== false : c.enabled;
    if (enabled) openWidget(manifest.id);
  }
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.soyofon.desktoptools');
  // macOS：只放在選單列，不在 Dock 顯示圖示
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  config.load();
  discoverWidgets();
  applyAutoStart();
  createTray();
  restoreWidgets();
  rebuildTrayMenu();

  // 螢幕配置改變時把跑出畫面的小工具拉回來
  screen.on('display-removed', () => {
    for (const { win } of widgets.values()) {
      if (!win) continue;
      const [x, y] = win.getPosition();
      const [w, h] = win.getSize();
      const p = clampToDisplays(x, y, w, h);
      if (p.x !== x || p.y !== y) win.setPosition(p.x, p.y);
    }
  });
});

app.on('second-instance', () => tray && tray.popUpContextMenu());
app.on('window-all-closed', () => { /* 常駐系統匣，不因視窗全關而結束 */ });
app.on('before-quit', () => config.saveNow());
