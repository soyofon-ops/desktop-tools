// 設定檔：存在 %APPDATA%/Soyofon Desktop Tools/config.json
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  autoStart: true,     // 開機自動啟動
  locked: false,       // 鎖定所有小工具位置（不可拖曳）
  widgets: {}          // { [id]: { enabled, x, y, alwaysOnTop, settings } }
};

let data = null;
let saveTimer = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    data = { ...DEFAULTS, ...raw, widgets: { ...(raw.widgets || {}) } };
  } catch {
    data = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return data;
}

function get() {
  return data || load();
}

function widget(id) {
  const d = get();
  if (!d.widgets[id]) d.widgets[id] = { settings: {} };
  if (!d.widgets[id].settings) d.widgets[id].settings = {};
  return d.widgets[id];
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(get(), null, 2), 'utf8');
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('儲存設定失敗', err);
  }
}

// 拖曳時會頻繁更新，延遲寫入避免一直寫檔
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

module.exports = { load, get, widget, save, saveNow, file };
