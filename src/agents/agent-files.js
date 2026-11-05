// Claude Code 子代理檔案（~/.claude/agents/<name>.md）的讀寫
// 格式：YAML frontmatter（name、description、tools、model、color…）＋ 內文為角色說明（系統提示）
// 只改我們認得的欄位，其他欄位（例如 permissionMode、skills）原樣保留，避免弄壞在終端機建立的設定。
const fs = require('fs');
const os = require('os');
const path = require('path');

const KNOWN = ['name', 'description', 'tools', 'model', 'color'];
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** Claude Code 支援的子代理顏色 */
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

function agentsDir(home = os.homedir()) {
  return path.join(home, '.claude', 'agents');
}

function unquote(v) {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/**
 * 解析 frontmatter：回傳 { entries: [{ key, lines }], body }
 * 每個欄位保留原始行，沒改到的欄位可以原樣寫回。
 */
function splitFrontmatter(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { entries: [], body: src.trim() };
  const entries = [];
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (km) entries.push({ key: km[1], lines: [line] });
    else if (entries.length) entries[entries.length - 1].lines.push(line); // 多行值、清單、註解
    else if (line.trim()) entries.push({ key: null, lines: [line] });
  }
  return { entries, body: src.slice(m[0].length).replace(/^\n+/, '').replace(/\s+$/, '') };
}

/** 取出欄位的值：一般字串、引號字串、| > 區塊、- 清單 */
function entryValue(entry) {
  const first = entry.lines[0].replace(/^[^:]*:/, '');
  const rest = entry.lines.slice(1);
  const t = first.trim();
  if (t === '|' || t === '>' || /^[|>][+-]?$/.test(t)) {
    const body = rest.map((l) => l.replace(/^\s{1,2}/, ''));
    return t.startsWith('>') ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n').trim();
  }
  if (!t && rest.some((l) => /^\s*-\s+/.test(l))) {
    return rest.filter((l) => /^\s*-\s+/.test(l)).map((l) => unquote(l.replace(/^\s*-\s+/, '')));
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1).split(',').map((x) => unquote(x)).filter(Boolean);
  }
  return unquote([t, ...rest.map((l) => l.trim())].join(' ').trim());
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return null;
}

/** 解析一個子代理檔案 */
function parseAgent(text, fileName = '') {
  const { entries, body } = splitFrontmatter(text);
  const get = (k) => {
    const e = entries.find((x) => x.key === k);
    return e ? entryValue(e) : undefined;
  };
  const fallbackName = path.basename(fileName, '.md');
  const name = typeof get('name') === 'string' && get('name') ? get('name') : fallbackName;
  return {
    name,
    description: typeof get('description') === 'string' ? get('description') : '',
    tools: toList(get('tools')), // null = 繼承全部工具
    model: typeof get('model') === 'string' && get('model') ? get('model') : null,
    color: typeof get('color') === 'string' && COLORS.includes(get('color')) ? get('color') : null,
    prompt: body,
    extra: entries.filter((e) => !KNOWN.includes(e.key)) // 其他欄位原樣保留
  };
}

/**
 * 其他欄位中 Agent SDK 也支援的設定（AgentDefinition），啟動對話時一併帶入。
 * 數字欄位轉成數字，清單欄位轉成陣列。
 */
function sdkExtras(def) {
  const out = {};
  for (const e of def.extra || []) {
    const v = entryValue(e);
    switch (e.key) {
      case 'disallowedTools':
      case 'skills':
        if (toList(v)) out[e.key] = toList(v);
        break;
      case 'permissionMode':
      case 'effort':
      case 'memory':
        if (typeof v === 'string' && v) out[e.key] = /^\d+$/.test(v) ? Number(v) : v;
        break;
      case 'maxTurns':
        if (/^\d+$/.test(String(v))) out.maxTurns = Number(v);
        break;
      default:
        break;
    }
  }
  return out;
}

/** YAML 字串：需要時加雙引號（JSON 字串也是合法的 YAML） */
function yamlString(s) {
  const str = String(s ?? '').replace(/\r?\n/g, ' ').trim();
  if (!str || /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|[\u0000-\u001f]/.test(str) || /^(true|false|null|yes|no|~|[-+]?\d)/i.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

/** 產生子代理檔案內容 */
function formatAgent(def) {
  const lines = ['---', `name: ${def.name}`, `description: ${yamlString(def.description)}`];
  const tools = toList(def.tools);
  if (tools && tools.length) lines.push(`tools: ${tools.join(', ')}`);
  if (def.model && def.model !== 'inherit-default') lines.push(`model: ${def.model}`);
  if (def.color && COLORS.includes(def.color)) lines.push(`color: ${def.color}`);
  for (const e of def.extra || []) lines.push(...e.lines);
  lines.push('---', '', String(def.prompt || '').replace(/\r\n/g, '\n').trim(), '');
  return lines.join('\n');
}

function validate(def) {
  if (!NAME_RE.test(def.name || '')) return '代號只能用英文小寫、數字和 -，並以字母開頭';
  if (!String(def.description || '').trim()) return '請填寫「何時使用」';
  if (!String(def.prompt || '').trim()) return '請填寫角色說明';
  return null;
}

function readAll(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const def = parseAgent(fs.readFileSync(path.join(dir, f), 'utf8'), f);
      out.push({ ...def, file: path.join(dir, f) });
    } catch { /* 讀不到的檔案略過 */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fileOf(dir, name) {
  // 先找 name 欄位相符的檔案（檔名不一定等於代號），找不到就用 <name>.md
  const found = readAll(dir).find((a) => a.name === name);
  return found ? found.file : path.join(dir, `${name}.md`);
}

/**
 * 儲存子代理。oldName 不同時代表改名：寫新檔後把舊檔交給 trash 處理。
 * @returns {string} 檔案路徑
 */
async function save(dir, def, { oldName = null, trash } = {}) {
  const err = validate(def);
  if (err) throw new Error(err);
  fs.mkdirSync(dir, { recursive: true });
  const all = readAll(dir);
  const existing = all.find((a) => a.name === (oldName || def.name));
  if ((!oldName || oldName !== def.name) && all.some((a) => a.name === def.name)) {
    throw new Error(`已經有名為 ${def.name} 的子代理`);
  }
  const extra = def.extra || (existing ? existing.extra : []);
  const target = oldName && oldName !== def.name ? path.join(dir, `${def.name}.md`) : (existing ? existing.file : path.join(dir, `${def.name}.md`));
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, formatAgent({ ...def, extra }), 'utf8');
  fs.renameSync(tmp, target);
  if (oldName && oldName !== def.name && existing && existing.file !== target && trash) await trash(existing.file);
  return target;
}

async function remove(dir, name, { trash }) {
  const file = fileOf(dir, name);
  if (fs.existsSync(file)) await trash(file);
}

/** 監看資料夾變更（建立資料夾後才監看得到），回傳停止函式 */
function watch(dir, onChange) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 無法建立就不監看 */ }
  let timer = null;
  let watcher = null;
  try {
    watcher = fs.watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 250);
    });
    watcher.on('error', () => {});
  } catch { /* 不支援監看時略過 */ }
  return () => { clearTimeout(timer); if (watcher) watcher.close(); };
}

module.exports = { agentsDir, parseAgent, formatAgent, validate, readAll, save, remove, watch, sdkExtras, COLORS, NAME_RE };
