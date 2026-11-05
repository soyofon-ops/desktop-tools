// 新增／編輯 Claude 角色：資料 { name | null, theme } 由主程序開啟時傳入；儲存後寫入 ~/.claude/agents/<代號>.md
const $ = (id) => document.getElementById(id);
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const COLOR_KEYS = Object.keys(window.AGENT_COLORS);
const MASCOT_KEYS = Object.keys(window.MASCOTS);

let editing = null;     // 原本的代號（新增時為 null）
let importedFile = '';  // 從現有子代理加入的角色：實際檔案路徑（保留原檔名與 name）
let color = 'blue';
let mascot = 'blob';
let extraTools = [];
let agentsDir = '';

const f = {
  displayName: $('displayName'), name: $('name'), description: $('description'), prompt: $('prompt'),
  model: $('model'), cwd: $('cwd'), err: $('err'), fileText: $('file-text')
};

function hex() { return (window.AGENT_COLORS[color] || window.AGENT_COLORS.blue).hex; }

/** 把子代理的 name 轉成烤肉串命名的代號；轉不出英數字時回傳空字串，由使用者自行填寫 */
function toKebabCase(value) {
  const text = String(value).trim();
  // 只有沒有分隔符號時才拆大小寫（codeReviewer），避免切開 LinkedIn、macOS 這類品牌名
  const words = /[^A-Za-z0-9]/.test(text) ? text : text.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 64).replace(/-+$/, '');
}

function renderLook() {
  const c = hex();
  $('preview').style.setProperty('--c', c);
  $('preview').innerHTML = window.MASCOTS[mascot].svg(c, 40);
  $('colors').innerHTML = COLOR_KEYS.map((k) => {
    const h = window.AGENT_COLORS[k].hex;
    return `<button class="swatch" role="radio" aria-checked="${k === color}" aria-label="${window.AGENT_COLORS[k].name}" title="${window.AGENT_COLORS[k].name}" data-color="${k}" style="background:${h};--sw:${h}"></button>`;
  }).join('');
  $('mascots').innerHTML = MASCOT_KEYS.map((k) => `<button class="mascot" role="radio" aria-checked="${k === mascot}" aria-label="${window.MASCOTS[k].name}" title="${window.MASCOTS[k].name}" data-mascot="${k}" style="--c:${c}">${window.MASCOTS[k].svg(c, 20)}</button>`).join('');
}

$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) { color = b.dataset.color; renderLook(); }
});
$('mascots').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mascot]');
  if (b) { mascot = b.dataset.mascot; renderLook(); }
});
// 方向鍵在顏色、吉祥物之間移動
for (const [id, keys, get, set] of [['colors', COLOR_KEYS, () => color, (v) => { color = v; }], ['mascots', MASCOT_KEYS, () => mascot, (v) => { mascot = v; }]]) {
  $(id).addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    set(keys[(keys.indexOf(get()) + d + keys.length) % keys.length]);
    renderLook();
    $(id).querySelector('[aria-checked="true"]').focus();
  });
}

document.querySelectorAll('.tchip').forEach((c) => {
  c.addEventListener('click', () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
});

function updateFile() {
  if (importedFile) {
    f.fileText.textContent = importedFile;
    f.name.classList.remove('invalid');
    return;
  }
  const n = f.name.value.trim();
  f.fileText.textContent = `${agentsDir || '~/.claude/agents'}${agentsDir.includes('\\') ? '\\' : '/'}${n || '代號'}.md`;
  f.name.classList.toggle('invalid', !!n && !NAME_RE.test(n));
}
f.name.addEventListener('input', updateFile);

$('pick').addEventListener('click', async () => {
  const dir = await window.agents.call('pickFolder', f.cwd.value.trim());
  if (dir) f.cwd.value = dir;
});

function setModelValue(v) {
  if (v && ![...f.model.options].some((o) => o.value === v)) f.model.add(new Option(v, v)); // 保留檔案裡的其他模型名稱
  f.model.value = v || '';
}

function fill(role) {
  editing = role ? role.name : null;
  const imported = !!(role && role.imported);
  importedFile = imported ? role.file : '';
  $('heading').textContent = role ? '編輯角色' : '新增角色';
  document.title = $('heading').textContent;
  $('remove').hidden = !role;
  color = role ? role.color : COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
  mascot = role ? role.mascot : MASCOT_KEYS[Math.floor(Math.random() * MASCOT_KEYS.length)];
  f.displayName.value = role ? role.displayName : '';
  // 從現有子代理加入的角色保留原名；其他已合法的代號維持原樣，舊資料不合法時才轉換
  f.name.value = !role ? '' : imported || NAME_RE.test(role.name) ? role.name : toKebabCase(role.name);
  f.name.readOnly = imported;
  f.name.title = imported ? '從現有子代理加入的角色會保留原檔名與代號' : '';
  $('del-text').textContent = imported
    ? '移除這個角色？子代理檔案會保留，對話紀錄會刪除。'
    : '移除這個角色？子代理檔案會移到資源回收筒，對話紀錄會刪除。';
  f.description.value = role ? role.description : '';
  f.prompt.value = role ? role.prompt : '';
  setModelValue(role ? role.model : '');
  f.cwd.value = role ? role.cwd : '';
  const groups = role ? role.toolGroups : ['read', 'search', 'edit', 'bash', 'web'];
  extraTools = role ? role.extraTools || [] : [];
  document.querySelectorAll('.tchip').forEach((c) => c.setAttribute('aria-pressed', String(groups.includes(c.dataset.g))));
  f.err.textContent = '';
  renderLook();
  updateFile();
}

function validate() {
  const n = f.name.value.trim();
  if (!f.displayName.value.trim()) return [f.displayName, '請填寫顯示名稱'];
  if (!importedFile && !NAME_RE.test(n)) return [f.name, '代號只能用英文小寫、數字和 -，並以字母開頭'];
  if (!f.description.value.trim()) return [f.description, '請填寫「何時使用」'];
  if (!f.prompt.value.trim()) return [f.prompt, '請填寫角色說明'];
  return null;
}

async function save() {
  const bad = validate();
  if (bad) { f.err.textContent = bad[1]; bad[0].focus(); return; }
  $('save').disabled = true;
  f.err.textContent = '';
  try {
    await window.agents.call('saveRole', {
      oldName: editing,
      name: f.name.value.trim(),
      displayName: f.displayName.value.trim(),
      mascot, color,
      description: f.description.value.trim(),
      prompt: f.prompt.value.trim(),
      model: f.model.value,
      cwd: f.cwd.value.trim(),
      toolGroups: [...document.querySelectorAll('.tchip[aria-pressed="true"]')].map((c) => c.dataset.g),
      extraTools
    });
    window.popup.close();
  } catch (err) {
    f.err.textContent = err.message;
    f.err.scrollIntoView({ block: 'nearest' }); // 錯誤訊息在表單最下方，捲到看得到
  } finally {
    $('save').disabled = false;
  }
}

$('save').addEventListener('click', save);
$('cancel').addEventListener('click', () => window.popup.close());
$('close').addEventListener('click', () => window.popup.close());
$('remove').addEventListener('click', () => { $('confirm-del').hidden = false; $('del-cancel').focus(); });
$('del-cancel').addEventListener('click', () => { $('confirm-del').hidden = true; });
$('del-ok').addEventListener('click', async () => {
  try {
    await window.agents.call('removeRole', editing);
    window.popup.close();
  } catch (err) {
    $('confirm-del').hidden = true;
    f.err.textContent = err.message;
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('confirm-del').hidden) $('confirm-del').hidden = true;
    else window.popup.close();
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); // Ctrl + Enter 儲存
});

$('import-btn').addEventListener('click', async () => {
  const n = $('existing').value;
  if (!n) return;
  try {
    await window.agents.call('addExisting', n);
    await window.agents.call('openEditor', n); // 接著補上顯示名稱與吉祥物
  } catch (err) {
    f.err.textContent = err.message;
  }
});

async function load(data) {
  document.body.dataset.theme = data && data.theme === 'light' ? 'light' : 'dark';
  const state = await window.agents.call('state');
  agentsDir = state.agentsDir || '';
  const name = data && data.name;
  const role = name ? await window.agents.call('getRole', name) : null;
  if (name && !role) { window.popup.close(); return; }
  // 新增時，如果已有在終端機建立的子代理，可以直接加入
  const existing = !role ? state.existing : [];
  $('import').hidden = !existing.length;
  $('existing').textContent = '';
  for (const n of existing) $('existing').add(new Option(n, n)); // 名稱來自檔案，用 DOM 建立避免當成 HTML
  fill(role);
  f.displayName.focus();
}

window.popup.onData(load);
window.popup.getData().then(load);
