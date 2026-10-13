// 簡易資料庫：存在 <userData>/database.json
//
// 結構：
// {
//   version: 1,
//   categories: [
//     { id: 'ff14-alarms', name: '採集鬧鐘', description: '',
//       fields: [ { key: 'name', label: '名稱', type: 'text' }, ... ],
//       createdAt, updatedAt }
//   ],
//   items: { 'ff14-alarms': [ { id, createdAt, updatedAt, data: { name: '...' } } ] }
// }
//
// 分類 id 由使用者在設定視窗建立時指定（英數字與 - _），小工具用它來讀取資料。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { app } = require('electron');

const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'time', 'select', 'url', 'longtext'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const events = new EventEmitter();
let db = null;
let saveTimer = null;

const now = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

function file() {
  return path.join(app.getPath('userData'), 'database.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    db = { version: 1, categories: raw.categories || [], items: raw.items || {} };
    // 舊版下拉選單的選項是字串陣列，轉成 { label, value }
    for (const c of db.categories) {
      for (const f of c.fields || []) {
        if (f.type === 'select') f.options = (f.options || []).map(toOption).filter((o) => o.value !== '');
      }
    }
  } catch {
    db = { version: 1, categories: [], items: {} };
  }
  return db;
}

function get() {
  return db || load();
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
    console.error('儲存資料庫失敗', err);
  }
}

function changed(categoryId) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
  events.emit('change', { categoryId });
}

// ---------------------------------------------------------------------------
// 驗證
// ---------------------------------------------------------------------------
// 選項可以是 "採礦" 或 { label: '採礦', value: 'miner' }
function toOption(o) {
  if (o && typeof o === 'object') {
    const value = String(o.value ?? '').trim();
    const label = String(o.label ?? '').trim();
    return { label: label || value, value: value || label };
  }
  const s = String(o ?? '').trim();
  return { label: s, value: s };
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) throw new Error('欄位格式錯誤');
  const seen = new Set();
  return fields.map((f) => {
    const key = String(f.key || '').trim();
    if (!KEY_RE.test(key)) throw new Error(`欄位代碼「${key}」只能用英文字母、數字與底線，且不能以數字開頭`);
    if (seen.has(key)) throw new Error(`欄位代碼「${key}」重複`);
    seen.add(key);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const label = String(f.label || key).trim() || key;
    if (type !== 'select') return { key, label, type };
    // 下拉選單：每個選項有顯示文字 label 與實際值 value，value 不可重複
    const options = (Array.isArray(f.options) ? f.options : []).map(toOption).filter((o) => o.value !== '');
    const values = new Set();
    for (const o of options) {
      if (values.has(o.value)) throw new Error(`下拉選單欄位「${label}」的選項值「${o.value}」重複`);
      values.add(o.value);
    }
    if (!options.length) throw new Error(`下拉選單欄位「${label}」至少需要一個選項`);
    return { key, label, type, options };
  });
}

function coerce(field, value) {
  const type = field.type;
  if (value === undefined || value === null || value === '') return type === 'boolean' ? false : '';
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : '';
    }
    case 'boolean': return value === true || value === 'true' || value === 1;
    case 'select': {
      // 存實際值；傳入顯示文字也會轉成對應的值；不在選項中的一律存成空字串
      const v = String(value).trim();
      const hit = field.options.find((o) => o.value === v) || field.options.find((o) => o.label === v);
      return hit ? hit.value : '';
    }
    case 'time': {
      // 統一存成 24 小時制 "HH:MM"；接受 "8:5"、"08:05"、"08:05:00"
      const m = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(String(value).trim());
      if (!m || +m[1] > 23 || +m[2] > 59) return '';
      return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
    }
    default: return String(value);
  }
}

function category(id) {
  const c = get().categories.find((x) => x.id === id);
  if (!c) throw new Error(`找不到分類「${id}」`);
  return c;
}

function cleanData(cat, data, base = {}) {
  const out = { ...base };
  const fields = new Map(cat.fields.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(data || {})) {
    const f = fields.get(k);
    // 未定義的欄位也保留（小工具可自行存放額外資料），但只接受 JSON 可序列化的值
    out[k] = f ? coerce(f, v) : clone(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------------
function listCategories() {
  const d = get();
  return d.categories.map((c) => ({ ...clone(c), count: (d.items[c.id] || []).length }));
}

function getCategory(id) {
  return clone(category(id));
}

function createCategory({ id, name, description = '', fields = [] }) {
  const d = get();
  id = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error('分類代碼只能用小寫英文、數字、- 或 _，且需以英數字開頭');
  if (d.categories.some((c) => c.id === id)) throw new Error(`分類代碼「${id}」已存在`);
  name = String(name || '').trim();
  if (!name) throw new Error('請輸入分類名稱');
  const c = {
    id, name, description: String(description || ''),
    fields: normalizeFields(fields.length ? fields : [{ key: 'name', label: '名稱', type: 'text' }]),
    createdAt: now(), updatedAt: now()
  };
  d.categories.push(c);
  d.items[id] = [];
  changed(id);
  return clone(c);
}

function updateCategory(id, patch) {
  const c = category(id);
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new Error('請輸入分類名稱');
    c.name = name;
  }
  if (patch.description !== undefined) c.description = String(patch.description);
  if (patch.fields !== undefined) {
    c.fields = normalizeFields(patch.fields);
    migrateSelectValues(c, patch.renames || {});
  }
  c.updatedAt = now();
  changed(id);
  return clone(c);
}

// 下拉選單選項的實際值改名時，把既有資料一起換成新值。
// renames: { [fieldKey]: { 舊值: 新值 } }；另外若舊值剛好等於某個選項的顯示文字，也換成該選項的值
function migrateSelectValues(cat, renames) {
  const items = get().items[cat.id] || [];
  for (const f of cat.fields) {
    if (f.type !== 'select') continue;
    const map = renames[f.key] || {};
    const values = new Set(f.options.map((o) => o.value));
    for (const item of items) {
      const v = item.data[f.key];
      if (v === undefined || v === '' || values.has(v)) continue;
      const next = map[v] ?? (f.options.find((o) => o.label === v) || {}).value;
      if (next !== undefined && values.has(next)) {
        item.data[f.key] = next;
        item.updatedAt = now();
      }
    }
  }
}

function deleteCategory(id) {
  const d = get();
  category(id);
  d.categories = d.categories.filter((c) => c.id !== id);
  delete d.items[id];
  changed(id);
  return true;
}

// ---------------------------------------------------------------------------
// 資料
// ---------------------------------------------------------------------------
function listItems(categoryId) {
  category(categoryId);
  return clone(get().items[categoryId] || []);
}

function addItem(categoryId, data) {
  const c = category(categoryId);
  const d = get();
  const item = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), data: cleanData(c, data) };
  (d.items[categoryId] = d.items[categoryId] || []).push(item);
  changed(categoryId);
  return clone(item);
}

function updateItem(categoryId, itemId, data) {
  const c = category(categoryId);
  const item = (get().items[categoryId] || []).find((x) => x.id === itemId);
  if (!item) throw new Error('找不到這筆資料');
  item.data = cleanData(c, data, item.data);
  item.updatedAt = now();
  changed(categoryId);
  return clone(item);
}

function removeItem(categoryId, itemId) {
  category(categoryId);
  const d = get();
  const before = (d.items[categoryId] || []).length;
  d.items[categoryId] = (d.items[categoryId] || []).filter((x) => x.id !== itemId);
  if (d.items[categoryId].length !== before) changed(categoryId);
  return true;
}

function moveItem(categoryId, itemId, toIndex) {
  category(categoryId);
  const list = get().items[categoryId] || [];
  const from = list.findIndex((x) => x.id === itemId);
  if (from < 0) throw new Error('找不到這筆資料');
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, item);
  changed(categoryId);
  return true;
}

module.exports = {
  FIELD_TYPES, events, load, file, saveNow,
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listItems, addItem, updateItem, removeItem, moveItem
};
