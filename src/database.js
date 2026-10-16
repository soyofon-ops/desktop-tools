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

const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'time', 'select', 'ref', 'url', 'longtext'];
const REF_ID = '__id'; // 資料表欄位的「值」使用資料本身的 id
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
    if (type === 'ref') {
      // 資料表：從另一個分類取選項；labelKey 為顯示名稱欄位，valueKey 為值欄位（__id＝資料 id）
      const r = f.ref || {};
      const ref = {
        category: String(r.category || '').trim(),
        labelKey: String(r.labelKey || '').trim(),
        valueKey: String(r.valueKey || '').trim() || REF_ID
      };
      if (!ref.category) throw new Error(`資料表欄位「${label}」請選擇資料表`);
      if (!ref.labelKey) throw new Error(`資料表欄位「${label}」請選擇顯示名稱欄位`);
      return { key, label, type, ref };
    }
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
    case 'ref': {
      // 存被連結資料的「值」；傳入顯示名稱也會轉成對應的值。被連結的資料表不存在時原樣保留
      if (!get().items[field.ref.category]) return typeof value === 'number' ? value : String(value);
      const opts = refOptions(field);
      const hit = opts.find((o) => String(o.value) === String(value)) || opts.find((o) => o.label === String(value).trim());
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

// 資料表欄位的選項清單：[{ label, value }]（依被連結資料表的順序，值重複時取第一筆）
function refOptions(field) {
  const { category: catId, labelKey, valueKey } = field.ref;
  const seen = new Set();
  const out = [];
  for (const item of get().items[catId] || []) {
    const value = valueKey === REF_ID ? item.id : item.data[valueKey];
    if (value === undefined || value === null || value === '' || seen.has(String(value))) continue;
    seen.add(String(value));
    const label = item.data[labelKey];
    out.push({ label: label === undefined || label === null || label === '' ? String(value) : String(label), value });
  }
  return out;
}

// 欄位的可選項目（下拉選單或資料表欄位），其他類型回傳 []
function fieldOptions(categoryId, key) {
  const f = category(categoryId).fields.find((x) => x.key === key);
  if (!f) throw new Error(`找不到欄位「${key}」`);
  if (f.type === 'select') return clone(f.options);
  if (f.type === 'ref') return clone(refOptions(f));
  return [];
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
  return d.categories.map((c) => ({
    ...clone(c),
    count: (d.items[c.id] || []).length,
    // 哪些欄位連結到這個分類（刪除前提醒用）
    refBy: d.categories.flatMap((o) => o.fields
      .filter((f) => f.type === 'ref' && f.ref.category === c.id)
      .map((f) => ({ category: o.id, categoryName: o.name, key: f.key, label: f.label })))
  }));
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

// ---------------------------------------------------------------------------
// 匯出／匯入（JSON）
//
// 檔案格式：
// {
//   "format": "soyofon-desktop-tools/database", "version": 1, "exportedAt": "...",
//   "categories": [
//     { "id": "ff14-alerms", "name": "...", "description": "", "fields": [...],
//       "items": [ { "id": "...", "data": { ... } } ] }
//   ]
// }
// 匯入時 items 也接受直接寫資料物件：[{ "name": "黑檀木", "start": "02:00" }]
// ---------------------------------------------------------------------------
const EXPORT_FORMAT = 'soyofon-desktop-tools/database';

function exportData(ids) {
  const d = get();
  const cats = ids && ids.length ? d.categories.filter((c) => ids.includes(c.id)) : d.categories;
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: now(),
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      fields: clone(c.fields),
      items: (d.items[c.id] || []).map((it) => ({ id: it.id, data: clone(it.data) }))
    }))
  };
}

// 檢查匯入檔並轉成統一格式（不寫入），錯誤時丟出可讀的訊息
function parseImport(payload) {
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw new Error('不是有效的 JSON 檔案'); }
  }
  if (!payload || typeof payload !== 'object') throw new Error('檔案內容格式不正確');
  // 也接受單一分類物件
  const list = Array.isArray(payload.categories) ? payload.categories
    : (payload.id && payload.fields) ? [payload] : null;
  if (!list) throw new Error('找不到分類資料（需要 categories 陣列）');
  if (!list.length) throw new Error('檔案中沒有任何分類');

  const seen = new Set();
  return list.map((c, i) => {
    const where = `第 ${i + 1} 個分類`;
    const id = String(c.id || '').trim().toLowerCase();
    if (!ID_RE.test(id)) throw new Error(`${where}的分類代碼「${c.id ?? ''}」格式不正確`);
    if (seen.has(id)) throw new Error(`分類代碼「${id}」在檔案中重複`);
    seen.add(id);
    let fields;
    try {
      fields = normalizeFields(Array.isArray(c.fields) ? c.fields : []);
    } catch (err) {
      throw new Error(`分類「${id}」：${err.message}`);
    }
    const rawItems = Array.isArray(c.items) ? c.items : [];
    const items = rawItems.map((it) => {
      const wrapped = it && typeof it === 'object' && it.data && typeof it.data === 'object';
      return {
        id: wrapped && typeof it.id === 'string' && it.id ? it.id : null,
        data: wrapped ? it.data : (it && typeof it === 'object' ? it : {})
      };
    });
    return { id, name: String(c.name || id).trim() || id, description: String(c.description || ''), fields, items };
  });
}

// 欄位合併：保留現有欄位，加入檔案中新的 key；同 key 的下拉選單合併選項
function mergeFields(current, incoming) {
  const out = clone(current);
  for (const f of incoming) {
    const cur = out.find((x) => x.key === f.key);
    if (!cur) {
      out.push(clone(f));
    } else if (cur.type === 'select' && f.type === 'select') {
      for (const o of f.options) if (!cur.options.some((x) => x.value === o.value)) cur.options.push({ ...o });
    }
  }
  return out;
}

/**
 * 匯入
 * @param payload 檔案內容（物件或 JSON 字串）
 * @param conflict 分類代碼已存在時：'replace' 取代欄位與資料｜'merge' 合併（同 id 的資料更新，其餘新增）｜'skip' 略過
 * @param onlyIds  只匯入這些分類（省略＝全部）
 */
function importData(payload, { conflict = 'merge', onlyIds } = {}) {
  const d = get();
  const cats = parseImport(payload).filter((c) => !onlyIds || onlyIds.includes(c.id));
  const report = [];

  for (const inc of cats) {
    const existing = d.categories.find((c) => c.id === inc.id);
    if (existing && conflict === 'skip') {
      report.push({ id: inc.id, name: existing.name, action: 'skipped', added: 0, updated: 0 });
      continue;
    }

    let cat;
    let action;
    if (!existing) {
      cat = { id: inc.id, name: inc.name, description: inc.description, fields: inc.fields, createdAt: now(), updatedAt: now() };
      d.categories.push(cat);
      d.items[cat.id] = [];
      action = 'created';
    } else if (conflict === 'replace') {
      cat = existing;
      Object.assign(cat, { name: inc.name, description: inc.description, fields: inc.fields, updatedAt: now() });
      d.items[cat.id] = [];
      action = 'replaced';
    } else {
      cat = existing;
      cat.fields = mergeFields(cat.fields, inc.fields);
      cat.updatedAt = now();
      action = 'merged';
    }

    const list = d.items[cat.id] || (d.items[cat.id] = []);
    let added = 0;
    let updated = 0;
    for (const it of inc.items) {
      const hit = it.id && list.find((x) => x.id === it.id);
      if (hit) {
        hit.data = cleanData(cat, it.data, hit.data);
        hit.updatedAt = now();
        updated++;
      } else {
        const id = it.id && !list.some((x) => x.id === it.id) ? it.id : crypto.randomUUID();
        list.push({ id, createdAt: now(), updatedAt: now(), data: cleanData(cat, it.data) });
        added++;
      }
    }
    report.push({ id: cat.id, name: cat.name, action, added, updated });
    changed(cat.id);
  }
  saveNow();
  return report;
}

// 預覽：每個分類的筆數，以及是否與現有分類代碼衝突
function previewImport(payload) {
  const d = get();
  return parseImport(payload).map((c) => {
    const existing = d.categories.find((x) => x.id === c.id);
    return {
      id: c.id, name: c.name, fields: c.fields.length, items: c.items.length,
      exists: !!existing, existingName: existing ? existing.name : null,
      existingItems: existing ? (d.items[c.id] || []).length : 0
    };
  });
}

module.exports = {
  REF_ID, fieldOptions,
  exportData, importData, previewImport,
  FIELD_TYPES, events, load, file, saveNow,
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listItems, addItem, updateItem, removeItem, moveItem
};
