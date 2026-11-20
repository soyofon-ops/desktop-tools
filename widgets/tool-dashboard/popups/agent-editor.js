// 新增／編輯 Claude 角色：資料 { name | null, theme } 由主程序開啟時傳入；儲存後寫入 ~/.claude/agents/<代號>.md
const $ = (id) => document.getElementById(id);
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const COLOR_KEYS = Object.keys(window.AGENT_COLORS);
const MASCOT_KEYS = Object.keys(window.MASCOTS);

let editing = null;     // 原本的代號（新增時為 null）
let importedFile = '';  // 從現有子代理加入的角色：實際檔案路徑（保留原檔名與 name）
let color = 'blue';
let mascot = 'blob';
let avatarFile = '';    // 已儲存的自訂頭像檔名
let avatarSrc = '';     // 這次新上傳、尚未儲存的頭像（PNG／GIF data URL）
let useAvatar = false;  // 選中自訂頭像；改選吉祥物並儲存時，頭像會被移除
let extraTools = [];
let snapshot = '';      // 載入時的表單內容（payload 序列化），用來判斷有沒有未儲存的修改

const CUSTOM = 'custom';              // 吉祥物列中「自訂圖片」選項的 key
const AVATAR_SIZE = 96;               // 與主程序 src/agents/avatar.js 的存檔尺寸一致
const AVATAR_MAX_FILE = 10 * 1024 * 1024;
const GIF_MAX_FILE = 1024 * 1024;     // GIF 動畫不縮放，上限與主程序一致
let agentsDir = '';

const f = {
  displayName: $('displayName'), name: $('name'), description: $('description'), prompt: $('prompt'),
  model: $('model'), cwd: $('cwd'), err: $('err'), fileText: $('file-text'),
  scheduleEnabled: $('schedule-enabled'), scheduleTime: $('schedule-time'), scheduleMessage: $('schedule-message'),
  autoApprove: $('auto-approve')
};

function hex() { return (window.AGENT_COLORS[color] || window.AGENT_COLORS.blue).hex; }

/** 把子代理的 name 轉成烤肉串命名的代號；轉不出英數字時回傳空字串，由使用者自行填寫 */
function toKebabCase(value) {
  const text = String(value).trim();
  // 只有沒有分隔符號時才拆大小寫（codeReviewer），避免切開 LinkedIn、macOS 這類品牌名
  const words = /[^A-Za-z0-9]/.test(text) ? text : text.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 64).replace(/-+$/, '');
}

/** 圖示選項：吉祥物，有上傳過圖片時再加上自訂圖片 */
function lookKeys() {
  return hasAvatar() ? [...MASCOT_KEYS, CUSTOM] : MASCOT_KEYS;
}

function hasAvatar() {
  return !!(avatarSrc || avatarFile);
}

/** 給 avatarHtml 用的角色資料：新上傳的優先 */
function avatarRole() {
  return { avatar: avatarFile, avatarSrc, mascot };
}

function selectLook(k) {
  useAvatar = k === CUSTOM;
  if (!useAvatar) mascot = k;
}

function renderLook() {
  const c = hex();
  $('preview').style.setProperty('--c', c);
  // 自訂頭像填滿 56px 預覽外框內側，吉祥物維持 40px
  $('preview').innerHTML = useAvatar ? window.avatarHtml(avatarRole(), c, 54, false, 40) : window.MASCOTS[mascot].svg(c, 40);
  $('colors').innerHTML = COLOR_KEYS.map((k) => {
    const h = window.AGENT_COLORS[k].hex;
    return `<button class="swatch" role="radio" aria-checked="${k === color}" aria-label="${window.AGENT_COLORS[k].name}" title="${window.AGENT_COLORS[k].name}" data-color="${k}" style="background:${h};--sw:${h}"></button>`;
  }).join('');
  const custom = hasAvatar()
    ? `<button class="mascot" role="radio" aria-checked="${useAvatar}" aria-label="自訂圖片" title="自訂圖片" data-mascot="${CUSTOM}" style="--c:${c}">${window.avatarHtml(avatarRole(), c, 28, false, 20)}</button>`
    : '';
  // 按鈕寬度受限於預覽，畫面上用短字，完整說明放在 aria-label
  $('upload-text').textContent = hasAvatar() ? '更換' : '上傳';
  $('upload').setAttribute('aria-label', hasAvatar() ? '更換圖片' : '上傳圖片');
  $('mascots').innerHTML = MASCOT_KEYS.map((k) => `<button class="mascot" role="radio" aria-checked="${!useAvatar && k === mascot}" aria-label="${window.MASCOTS[k].name}" title="${window.MASCOTS[k].name}" data-mascot="${k}" style="--c:${c}">${window.MASCOTS[k].svg(c, 20)}</button>`).join('')
    + custom;
}

/** 讀成 data URL（GIF 要保留動畫，不經過 canvas） */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('無法讀取這張圖片'));
    r.readAsDataURL(file);
  });
}

/**
 * 讀取選取的圖片
 * - GIF：保留原檔與動畫，顯示時置中裁成圓形
 * - 其他：置中裁成正方形並縮小成 PNG data URL
 */
async function readAvatarFile(file) {
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) throw new Error('只支援 PNG、JPG、GIF、WebP、BMP 圖片');
  if (file.type === 'image/gif') {
    if (file.size > GIF_MAX_FILE) throw new Error('GIF 動畫太大（上限 1 MB）');
    try {
      (await createImageBitmap(file)).close(); // 確認解得開
    } catch {
      throw new Error('無法讀取這張圖片');
    }
    const src = await readAsDataUrl(file);
    await window.prepareAvatarSrc(src); // 先算好第一格，減少動態時預覽不播放
    return src;
  }
  if (file.size > AVATAR_MAX_FILE) throw new Error('圖片太大（上限 10 MB）');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('無法讀取這張圖片');
  }
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close();
  return canvas.toDataURL('image/png');
}

$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) { color = b.dataset.color; renderLook(); }
});
$('mascots').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mascot]');
  if (b) { selectLook(b.dataset.mascot); renderLook(); }
});
$('upload').addEventListener('click', () => $('avatar-file').click());
$('avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 同一張圖片再選一次也要觸發
  if (!file) return;
  try {
    avatarSrc = await readAvatarFile(file);
    useAvatar = true;
    f.err.textContent = '';
    renderLook();
    $('mascots').querySelector(`[data-mascot="${CUSTOM}"]`).focus();
  } catch (err) {
    f.err.textContent = err.message;
    f.err.scrollIntoView({ block: 'nearest' });
  }
});
// 方向鍵在顏色、圖示之間移動
for (const [id, keys, get, set] of [
  ['colors', () => COLOR_KEYS, () => color, (v) => { color = v; }],
  ['mascots', lookKeys, () => (useAvatar ? CUSTOM : mascot), selectLook]
]) {
  $(id).addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const list = keys();
    set(list[(list.indexOf(get()) + d + list.length) % list.length]);
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

function renderSchedule() {
  const on = f.scheduleEnabled.checked;
  f.scheduleTime.hidden = !on;
  $('schedule-body').hidden = !on;
}
f.scheduleEnabled.addEventListener('change', renderSchedule);

/** 排程說明依「不要再詢問」顯示會不會等你核准 */
function renderAutoApprove() {
  $('schedule-approve-hint').textContent = f.autoApprove.checked
    ? '已開啟「不要再詢問」，改檔案或執行指令時不會等你核准（設定檔要求詢問的動作除外）。'
    : '要改檔案或執行指令時，會等你核准才繼續。';
}
f.autoApprove.addEventListener('change', renderAutoApprove);

function fill(role) {
  editing = role ? role.name : null;
  const imported = !!(role && role.imported);
  importedFile = imported ? role.file : '';
  $('heading').textContent = role ? '編輯角色' : '新增角色';
  document.title = $('heading').textContent;
  $('remove').hidden = !role;
  color = role ? role.color : COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
  mascot = role ? role.mascot : MASCOT_KEYS[Math.floor(Math.random() * MASCOT_KEYS.length)];
  avatarFile = (role && role.avatar) || '';
  avatarSrc = '';
  useAvatar = !!avatarFile;
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
  const schedule = role && role.schedule;
  f.scheduleEnabled.checked = !!(schedule && schedule.enabled);
  f.scheduleTime.value = schedule ? schedule.time : '09:00';
  f.scheduleMessage.value = schedule ? schedule.message : '';
  renderSchedule();
  f.autoApprove.checked = !!(role && role.autoApprove);
  renderAutoApprove();
  f.err.textContent = '';
  // 複製模式的畫面還原；複製按鈕只在編輯模式顯示
  $('copy').hidden = !role;
  $('copy-from').hidden = true;
  $('copy-notice').hidden = true;
  $('confirm-copy').hidden = true;
  $('confirm-del').hidden = true;
  renderLook();
  updateFile();
  syncButtons();
  snapshot = JSON.stringify(payload());
}

function validate() {
  const n = f.name.value.trim();
  if (!f.displayName.value.trim()) return [f.displayName, '請填寫顯示名稱'];
  if (!importedFile && !NAME_RE.test(n)) return [f.name, '代號只能用英文小寫、數字和 -，並以字母開頭'];
  if (!f.description.value.trim()) return [f.description, '請填寫「何時使用」'];
  if (!f.prompt.value.trim()) return [f.prompt, '請填寫角色說明'];
  if (f.scheduleEnabled.checked && !f.scheduleTime.value) return [f.scheduleTime, '請設定排程時間'];
  if (f.scheduleEnabled.checked && !f.scheduleMessage.value.trim()) return [f.scheduleMessage, '請填寫排程要送出的訊息'];
  return null;
}

/** 儲存時送給主程序的資料 */
function payload() {
  return {
    oldName: editing,
    name: f.name.value.trim(),
    displayName: f.displayName.value.trim(),
    mascot, color,
    // 新上傳傳 data URL、沿用傳檔名、null 改回吉祥物並移除自訂頭像
    avatar: useAvatar ? avatarSrc || avatarFile : null,
    description: f.description.value.trim(),
    prompt: f.prompt.value.trim(),
    model: f.model.value,
    cwd: f.cwd.value.trim(),
    toolGroups: [...document.querySelectorAll('.tchip[aria-pressed="true"]')].map((c) => c.dataset.g),
    extraTools,
    autoApprove: f.autoApprove.checked,
    schedule: { enabled: f.scheduleEnabled.checked, time: f.scheduleTime.value, message: f.scheduleMessage.value.trim() }
  };
}

/**
 * 儲存角色
 * @param {{ close?: boolean }} [opts] close 為 false 時成功後不關窗（儲存後複製）
 * @returns {Promise<boolean>} 是否儲存成功
 */
async function save({ close = true } = {}) {
  const bad = validate();
  if (bad) { f.err.textContent = bad[1]; bad[0].focus(); return false; }
  $('save').disabled = true;
  syncButtons();
  f.err.textContent = '';
  try {
    await window.agents.call('saveRole', payload());
    if (close) window.popup.close();
    return true;
  } catch (err) {
    f.err.textContent = err.message;
    f.err.scrollIntoView({ block: 'nearest' }); // 錯誤訊息在表單最下方，捲到看得到
    return false;
  } finally {
    $('save').disabled = false;
    syncButtons();
  }
}

/** 儲存中或確認列開啟時停用複製；未儲存修改確認列開啟時停用移除，避免兩個確認列同時出現 */
function syncButtons() {
  const confirming = !$('confirm-del').hidden || !$('confirm-copy').hidden;
  $('copy').disabled = $('save').disabled || confirming;
  $('remove').disabled = !$('confirm-copy').hidden;
}

function setConfirm(id, show) {
  $(id).hidden = !show;
  syncButtons();
}

/** 複製用的顯示名稱：「原名稱 副本」，重複時改為「副本 2」「副本 3」…，超過欄位上限時截短原名稱 */
function copyDisplayName(src, taken) {
  const max = Number(f.displayName.maxLength) > 0 ? f.displayName.maxLength : 20;
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? ' 副本' : ` 副本 ${i}`;
    const head = [...src]; // 以字元為單位截短，避免切開表情符號
    while (head.length && head.join('').length + suffix.length > max) head.pop();
    const name = head.join('').trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

/** 複製用的代號：「原代號-copy」，重複時改為 -copy-2、-copy-3…；轉不出合法代號時回傳空字串，由使用者自行填寫 */
function copyCode(src, taken) {
  const base = NAME_RE.test(src) ? src : toKebabCase(src);
  if (!base) return '';
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '-copy' : `-copy-${i}`;
    const code = base.slice(0, 64 - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.has(code)) return code;
  }
}

/**
 * 以目前畫面內容切換成「新增角色」（原地切換，不開新視窗）
 * @param {boolean} carried 是否帶入了未儲存到原角色的修改
 */
async function enterCopyMode(carried) {
  $('copy').disabled = true; // 取狀態期間避免重複觸發
  let state;
  try {
    state = await window.agents.call('state'); // 「儲存後複製」可能剛改過代號或名稱，重新取得
  } catch (err) {
    f.err.textContent = err.message;
    syncButtons();
    return;
  }
  const srcDisplay = f.displayName.value.trim() || f.name.value.trim();
  const srcName = f.name.value.trim();
  const turnedOff = f.scheduleEnabled.checked || f.autoApprove.checked;
  const names = new Set([...state.roles.map((r) => r.name), ...(state.existing || [])]);
  const displays = new Set(state.roles.map((r) => r.displayName));

  editing = null;
  importedFile = '';
  f.displayName.value = copyDisplayName(srcDisplay, displays);
  f.name.value = copyCode(srcName, names);
  // 匯入角色的鎖定是為了保留原檔；複製出來的是新檔，代號必須可改
  f.name.readOnly = false;
  f.name.title = '';
  // 權限不靜默複製；排程關閉避免同時觸發兩次，但保留時間與訊息
  f.autoApprove.checked = false;
  renderAutoApprove();
  f.scheduleEnabled.checked = false;
  renderSchedule();

  $('heading').textContent = '新增角色';
  document.title = $('heading').textContent;
  $('copy-from').textContent = `複製自 ${srcDisplay}`;
  $('copy-from').title = `複製自 ${srcDisplay}（${srcName}）`;
  $('copy-from').hidden = false;
  $('copy').hidden = true;
  $('remove').hidden = true;
  $('confirm-del').hidden = true;
  $('confirm-copy').hidden = true;

  // 先顯示再填字，讓螢幕閱讀器唸出提示
  $('copy-notice').hidden = false;
  const text = $('copy-notice-text');
  text.textContent = '';
  if (carried) text.append('已帶入你剛才未儲存的修改，原角色沒有更新。');
  const b = document.createElement('b');
  b.textContent = '尚未儲存的新角色。';
  text.append(b, '儲存後會建立新的子代理檔案，原角色不受影響。'
    + (turnedOff ? '每日排程與「不要再詢問」已關閉，需要時請重新開啟。' : ''));

  f.err.textContent = '';
  updateFile();
  syncButtons();
  $('form').scrollTop = 0;
  f.displayName.focus();
  f.displayName.select();
}

$('save').addEventListener('click', () => save());
$('cancel').addEventListener('click', () => window.popup.close());
$('close').addEventListener('click', () => window.popup.close());
$('remove').addEventListener('click', () => { setConfirm('confirm-del', true); $('del-cancel').focus(); });
$('del-cancel').addEventListener('click', () => setConfirm('confirm-del', false));
$('del-ok').addEventListener('click', async () => {
  try {
    await window.agents.call('removeRole', editing);
    window.popup.close();
  } catch (err) {
    setConfirm('confirm-del', false);
    f.err.textContent = err.message;
  }
});
$('copy').addEventListener('click', () => {
  if (JSON.stringify(payload()) === snapshot) { enterCopyMode(false); return; }
  setConfirm('confirm-copy', true);
  $('copy-save').focus();
});
$('copy-cancel').addEventListener('click', () => { setConfirm('confirm-copy', false); $('copy').focus(); });
$('copy-discard').addEventListener('click', () => { setConfirm('confirm-copy', false); enterCopyMode(true); });
$('copy-save').addEventListener('click', async () => {
  setConfirm('confirm-copy', false);
  // 驗證或儲存失敗時留在編輯模式，錯誤顯示在 #err
  if (await save({ close: false })) enterCopyMode(false);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('confirm-copy').hidden) { setConfirm('confirm-copy', false); $('copy').focus(); }
    else if (!$('confirm-del').hidden) setConfirm('confirm-del', false);
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
