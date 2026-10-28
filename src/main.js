const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./database');

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
let settingsWin = null;

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

function defaultPosition(index, m) {
  const a = screen.getPrimaryDisplay().workArea;
  // widget.json 可指定 "anchor": "top-right"，預設貼齊工作區右上角（距離 margin px）
  if (m.anchor === 'top-right') {
    const margin = Number.isFinite(m.margin) ? m.margin : 12;
    return { x: a.x + a.width - m.width - margin, y: a.y + margin };
  }
  return { x: a.x + a.width - m.width - 40, y: a.y + 40 + index * 140 };
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
    pos = defaultPosition([...widgets.keys()].indexOf(id), m);
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
      autoplayPolicy: 'no-user-gesture-required', // 鬧鈴提示音不需先點擊
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

// 小工具調整自己的視窗高度（例如時鐘下方彈出鬧鈴通知），寬度與位置不變
ipcMain.on('widget:set-height', (e, height) => {
  const id = widgetIdFromSender(e.sender);
  if (!id) return;
  const { win, manifest } = widgets.get(id);
  const h = Math.round(Math.max(manifest.height, Math.min(Number(height) || manifest.height, 900)));
  const b = win.getBounds();
  if (b.height !== h) win.setBounds({ x: b.x, y: b.y, width: manifest.width, height: h });
});

// 複製文字到系統剪貼簿（小工具視窗常沒有焦點，網頁的 clipboard API 會失敗）
ipcMain.handle('widget:copy-text', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

// 讀取系統剪貼簿文字（理由同上）
ipcMain.handle('widget:read-text', () => clipboard.readText());

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
    { label: '設定…', click: () => openSettings() },
    { label: '隱藏此小工具', click: () => { closeWidget(id); rebuildTrayMenu(); } }
  ]).popup({ window: entry.win });
});

function lockMenuItem() {
  return {
    label: '鎖定位置',
    type: 'checkbox',
    checked: !!config.get().locked,
    click: (item) => setLocked(item.checked)
  };
}

function setLocked(on) {
  config.get().locked = !!on;
  config.save();
  broadcast('widget:locked', !!on);
  rebuildTrayMenu();
}

function setAutoStart(on) {
  config.get().autoStart = !!on;
  config.saveNow();
  applyAutoStart();
  rebuildTrayMenu();
}

function setWidgetEnabled(id, on) {
  on ? openWidget(id) : closeWidget(id);
  rebuildTrayMenu();
}

function resetWidgetPosition(id) {
  const entry = widgets.get(id);
  if (!entry) return;
  const c = config.widget(id);
  delete c.x;
  delete c.y;
  const p = defaultPosition([...widgets.keys()].indexOf(id), entry.manifest);
  if (entry.win) entry.win.setPosition(p.x, p.y);
  config.saveNow();
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
  notifySettings();
  if (!tray) return;
  const widgetItems = [...widgets.values()].map(({ manifest, win }) => ({
    label: manifest.name,
    type: 'checkbox',
    checked: !!win,
    click: (item) => setWidgetEnabled(manifest.id, item.checked)
  }));

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '設定…', click: () => openSettings() },
    { type: 'separator' },
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
      click: (item) => setAutoStart(item.checked)
    },
    { type: 'separator' },
    {
      label: '重新掃描小工具',
      click: () => rescanWidgets()
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

function rescanWidgets() {
  const open = [...widgets.values()].filter(e => e.win).map(e => e.manifest.id);
  open.forEach(id => closeWidget(id, { remember: false }));
  discoverWidgets();
  restoreWidgets();
  rebuildTrayMenu();
}

// ---------------------------------------------------------------------------
// 設定視窗
// ---------------------------------------------------------------------------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 720,
    minHeight: 480,
    title: 'Soyofon Desktop Tools 設定',
    backgroundColor: '#14161f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function settingsState() {
  const c = config.get();
  return {
    autoStart: !!c.autoStart,
    locked: !!c.locked,
    isPackaged: app.isPackaged,
    platform: process.platform,
    version: app.getVersion(),
    paths: { config: config.file(), database: db.file(), userWidgets: userWidgetsDir() },
    widgets: [...widgets.values()].map(({ manifest, win, dir }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description || '',
      builtin: dir.startsWith(BUILTIN_WIDGETS_DIR),
      enabled: !!win,
      alwaysOnTop: !!config.widget(manifest.id).alwaysOnTop
    }))
  };
}

function notifySettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', settingsState());
}

ipcMain.handle('settings:get-state', () => settingsState());
ipcMain.handle('settings:update', (_e, action, payload = {}) => {
  switch (action) {
    case 'autoStart': setAutoStart(payload.value); break;
    case 'locked': setLocked(payload.value); break;
    case 'widgetEnabled': setWidgetEnabled(payload.id, payload.value); break;
    case 'widgetAlwaysOnTop': setWidgetAlwaysOnTop(payload.id, payload.value); break;
    case 'widgetResetPosition': resetWidgetPosition(payload.id); break;
    case 'rescan': rescanWidgets(); break;
    case 'openPath': {
      const target = settingsState().paths[payload.which];
      if (!target) break;
      if (payload.which === 'userWidgets') {
        fs.mkdirSync(target, { recursive: true });
        shell.openPath(target);
      } else {
        shell.showItemInFolder(target);
      }
      break;
    }
    default: throw new Error(`未知的設定動作：${action}`);
  }
  return settingsState();
});

// ---------------------------------------------------------------------------
// 資料庫 IPC（設定視窗與所有小工具共用）
// ---------------------------------------------------------------------------
const DB_METHODS = {
  read: ['listCategories', 'getCategory', 'listItems', 'fieldOptions'],
  write: ['addItem', 'updateItem', 'removeItem', 'moveItem'],
  schema: ['createCategory', 'updateCategory', 'deleteCategory']
};

ipcMain.handle('db:call', (e, method, ...args) => {
  const fromSettings = settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
  const allowed = [...DB_METHODS.read, ...DB_METHODS.write, ...(fromSettings ? DB_METHODS.schema : [])];
  if (!allowed.includes(method)) throw new Error(`不允許的資料庫操作：${method}`);
  return db[method](...args);
});

// ---- 匯出／匯入 JSON（只允許設定視窗呼叫）----
let pendingImport = null; // { text, filePath }

function assertSettings(e) {
  if (!settingsWin || settingsWin.isDestroyed() || e.sender !== settingsWin.webContents) {
    throw new Error('只能從設定視窗操作');
  }
}

ipcMain.handle('db:export', async (e, ids) => {
  assertSettings(e);
  const data = db.exportData(ids);
  if (!data.categories.length) throw new Error('沒有可以匯出的分類');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = data.categories.length === 1 && ids && ids.length === 1
    ? `${data.categories[0].id}-${stamp}.json`
    : `desktop-tools-database-${stamp}.json`;
  const r = await dialog.showSaveDialog(settingsWin, {
    title: '匯出資料庫',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
  return {
    filePath: r.filePath,
    categories: data.categories.length,
    items: data.categories.reduce((n, c) => n + c.items.length, 0)
  };
});

ipcMain.handle('db:import-open', async (e) => {
  assertSettings(e);
  const r = await dialog.showOpenDialog(settingsWin, {
    title: '匯入資料庫',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const filePath = r.filePaths[0];
  if (fs.statSync(filePath).size > 50 * 1024 * 1024) throw new Error('檔案太大（超過 50MB）');
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const preview = db.previewImport(text); // 格式錯誤會在這裡丟出
  pendingImport = { text, filePath };
  return { fileName: path.basename(filePath), preview };
});

ipcMain.handle('db:import-apply', (e, options) => {
  assertSettings(e);
  if (!pendingImport) throw new Error('請先選擇要匯入的檔案');
  const report = db.importData(pendingImport.text, options || {});
  pendingImport = null;
  return report;
});

db.events.on('change', (info) => {
  broadcast('db:changed', info);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('db:changed', info);
});

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
  db.load();
  // macOS 需要應用程式選單，輸入框的 ⌘C / ⌘V / ⌘Z 才會有作用
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  discoverWidgets();
  applyAutoStart();
  createTray();
  restoreWidgets();
  rebuildTrayMenu();
  if (process.argv.includes('--settings')) openSettings();

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

// 再次執行程式（例如點兩下捷徑）時開啟設定視窗
app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => { /* 常駐系統匣，不因視窗全關而結束 */ });
app.on('before-quit', () => { config.saveNow(); db.saveNow(); });
