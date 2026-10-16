/* global settings */
'use strict';

const FIELD_TYPES = [
  ['text', '文字'],
  ['longtext', '多行文字'],
  ['number', '數字'],
  ['boolean', '是／否'],
  ['date', '日期'],
  ['time', '時間'],
  ['select', '下拉選單'],
  ['ref', '資料表'],
  ['url', '網址']
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const REF_ID = '__id'; // 資料表欄位的值使用資料 id

// ---------------------------------------------------------------------------
// 小工具：建立 DOM（不用 innerHTML，避免資料內容被當成 HTML）
// ---------------------------------------------------------------------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (sel) => document.querySelector(sel);

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 3500 : 1600);
}

// run() 已經用提示訊息顯示錯誤，不要再當成未處理的錯誤
window.addEventListener('unhandledrejection', (e) => e.preventDefault());

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 對話框
// ---------------------------------------------------------------------------
function openModal({ title, body, okText = '確定', danger = false, onOk }) {
  const modal = $('#modal');
  const ok = $('#modal-ok');
  $('#modal-title').textContent = title;
  $('#modal-body').replaceChildren(body);
  $('#modal-error').textContent = '';
  ok.textContent = okText;
  ok.className = danger ? 'btn danger' : 'btn primary';
  modal.hidden = false;
  const first = body.querySelector('input, select, textarea');
  setTimeout(() => (first || ok).focus(), 0);

  const close = () => {
    modal.hidden = true;
    ok.onclick = null;
    $('#modal-cancel').onclick = null;
    modal.onkeydown = null;
  };
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      await onOk();
      close();
    } catch (err) {
      $('#modal-error').textContent = err.message;
    } finally {
      ok.disabled = false;
    }
  };
  $('#modal-cancel').onclick = close;
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') ok.click();
  };
}

function formRow(label, input, hint) {
  return h('div', { class: 'form-row' }, h('label', {}, label), input, hint && h('div', { class: 'hint' }, hint));
}

// ---------------------------------------------------------------------------
// 分頁
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
function showTab(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  try { localStorage.setItem('settings.tab', name); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 一般 & 小工具
// ---------------------------------------------------------------------------
let state = null;

function renderGeneral() {
  $('#version').textContent = `v${state.version}`;
  const auto = $('#opt-autostart');
  auto.checked = state.autoStart;
  auto.disabled = !state.isPackaged;
  $('#autostart-desc').textContent = state.isPackaged
    ? '登入系統後自動執行並還原小工具'
    : '開發模式（pnpm start）無法設定，打包安裝後才可使用';
  $('#opt-locked').checked = state.locked;
  for (const key of ['config', 'database', 'userWidgets']) $(`#path-${key}`).textContent = state.paths[key];
}

function renderWidgets() {
  const list = $('#widget-list');
  if (!state.widgets.length) {
    list.replaceChildren(h('div', { class: 'empty' }, '沒有找到小工具'));
    return;
  }
  list.replaceChildren(...state.widgets.map((w) =>
    h('div', { class: 'row' },
      h('div', {},
        h('div', { class: 'row-title' }, w.name, !w.builtin && h('span', { class: 'badge' }, '自訂')),
        h('div', { class: 'row-desc mono' }, w.id)
      ),
      h('div', { class: 'row-actions' },
        h('label', {},
          h('input', {
            type: 'checkbox', checked: w.alwaysOnTop,
            onchange: (e) => run(() => settings.update('widgetAlwaysOnTop', { id: w.id, value: e.target.checked }))
          }),
          '置頂'
        ),
        h('button', {
          class: 'btn small ghost', title: '移回螢幕右上角',
          onclick: () => run(() => settings.update('widgetResetPosition', { id: w.id }), '已重設位置')
        }, '重設位置'),
        h('label', { class: 'switch', title: w.enabled ? '顯示中' : '已隱藏' },
          h('input', {
            type: 'checkbox', checked: w.enabled,
            onchange: (e) => run(() => settings.update('widgetEnabled', { id: w.id, value: e.target.checked }))
          }),
          h('span', { class: 'track' })
        )
      )
    )
  ));
}

function applyState(s) {
  state = s;
  renderGeneral();
  renderWidgets();
}

$('#opt-autostart').addEventListener('change', (e) => run(() => settings.update('autoStart', { value: e.target.checked })));
$('#opt-locked').addEventListener('change', (e) => run(() => settings.update('locked', { value: e.target.checked })));
$('#btn-rescan').addEventListener('click', () => run(() => settings.update('rescan'), '已重新掃描'));
document.querySelectorAll('[data-open]').forEach((b) =>
  b.addEventListener('click', () => run(() => settings.update('openPath', { which: b.dataset.open })))
);
settings.onState(applyState);

// ---------------------------------------------------------------------------
// 資料庫
// ---------------------------------------------------------------------------
const dbView = {
  cats: [],
  current: null,      // 目前分類 id
  sub: 'items',       // items | fields | usage
  items: [],
  filter: '',
  draftFields: null,  // 欄位編輯中的草稿
  selfWrites: 0,      // 自己發出的寫入，收到變更通知時不必重繪
  pendingRefresh: false
};

const currentCat = () => dbView.cats.find((c) => c.id === dbView.current);

async function loadCats() {
  dbView.cats = await settings.db.categories();
  if (!dbView.cats.some((c) => c.id === dbView.current)) {
    dbView.current = dbView.cats[0] ? dbView.cats[0].id : null;
    dbView.draftFields = null;
  }
  renderCatList();
}

async function loadItems() {
  dbView.items = dbView.current ? await settings.db.items(dbView.current) : [];
  // 資料表欄位：載入被連結資料表的選項
  dbView.refOptions = {};
  const cat = currentCat();
  for (const f of cat ? cat.fields : []) {
    if (f.type !== 'ref') continue;
    try {
      dbView.refOptions[f.key] = await settings.db.fieldOptions(cat.id, f.key);
    } catch {
      dbView.refOptions[f.key] = [];
    }
  }
}

// 自己發出的寫入：先記一筆，收到對應的變更通知時跳過重繪
async function selfWrite(fn) {
  dbView.selfWrites++;
  try {
    return await fn();
  } catch (err) {
    dbView.selfWrites--;
    throw err;
  }
}
const write = (fn) => run(() => selfWrite(fn));

function renderCatList() {
  const list = $('#cat-list');
  if (!dbView.cats.length) {
    list.replaceChildren(h('div', { class: 'cat-empty' }, '還沒有分類。按「＋ 分類」建立第一個。'));
    return;
  }
  list.replaceChildren(...dbView.cats.map((c) =>
    h('button', {
      class: `cat-item${c.id === dbView.current ? ' active' : ''}`,
      onclick: () => selectCat(c.id)
    },
      h('span', { class: 'cat-name' }, c.name, h('span', { class: 'cat-id mono' }, c.id)),
      h('span', { class: 'count' }, c.count)
    )
  ));
}

async function selectCat(id) {
  if (dbView.current !== id && fieldsDirty() && !confirmDiscardFields()) return;
  dbView.current = id;
  dbView.draftFields = null;
  dbView.filter = '';
  await loadItems();
  renderCatList();
  renderDetail();
}

function fieldsDirty() {
  const cat = currentCat();
  if (!dbView.draftFields || !cat) return false;
  return JSON.stringify(cleanDraft(dbView.draftFields)) !== JSON.stringify(cat.fields);
}

// 把欄位草稿轉成要儲存的格式（只有下拉選單保留 options）
function cleanDraft(draft) {
  return draft.map(({ key, label, type, options, ref }) => {
    const f = { key, label, type };
    if (type === 'select') f.options = parseOptions(options);
    if (type === 'ref') {
      const r = ref || {};
      f.ref = { category: r.category || '', labelKey: r.labelKey || '', valueKey: r.valueKey || REF_ID };
    }
    return f;
  });
}

// 選項草稿 → [{ label, value }]；只填一邊時另一邊用同樣的文字，兩邊都空的列忽略
function parseOptions(list) {
  return (list || []).map((o) => {
    const label = String(o.label || '').trim();
    const value = String(o.value || '').trim();
    return { label: label || value, value: value || label };
  }).filter((o) => o.value !== '');
}

function confirmDiscardFields() {
  return window.confirm('欄位變更還沒儲存，要放棄這些變更嗎？');
}

function renderDetail() {
  const box = $('#db-detail');
  const cat = currentCat();
  if (!cat) {
    box.replaceChildren(
      h('div', { class: 'empty' },
        h('p', {}, '資料庫可以存放各種分類的資料，給小工具讀取使用。'),
        h('p', { class: 'hint' }, '例如：採集點清單、待辦事項、常用網址…'),
        h('br'),
        h('button', { class: 'btn primary', onclick: newCategory }, '＋ 建立分類')
      )
    );
    return;
  }

  const subtab = (key, label) => h('button', {
    class: `subtab${dbView.sub === key ? ' active' : ''}`,
    onclick: () => {
      if (dbView.sub === 'fields' && key !== 'fields' && fieldsDirty() && !confirmDiscardFields()) return;
      if (key !== 'fields') dbView.draftFields = null;
      dbView.sub = key;
      renderDetail();
    }
  }, label);

  box.replaceChildren(
    h('div', { class: 'detail-head' },
      h('div', {},
        h('h1', {}, cat.name, h('span', { class: 'id-chip mono', title: '分類代碼（小工具用這個讀取）' }, cat.id)),
        cat.description && h('div', { class: 'detail-desc' }, cat.description)
      ),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', title: '匯出這個分類的欄位與資料（JSON）', onclick: () => exportJson([cat.id]) }, '匯出'),
        h('button', { class: 'btn small', onclick: () => editCategory(cat) }, '編輯'),
        h('button', { class: 'btn small danger', onclick: () => deleteCategory(cat) }, '刪除')
      )
    ),
    h('div', { class: 'subtabs' },
      subtab('items', `資料（${cat.count}）`),
      subtab('fields', `欄位（${cat.fields.length}）`),
      subtab('usage', '小工具使用方式')
    ),
    dbView.sub === 'items' ? renderItems(cat)
      : dbView.sub === 'fields' ? renderFields(cat)
        : renderUsage(cat)
  );
}

// ---- 資料表 ----
function cellInput(field, value, onSave) {
  const save = (v) => onSave(field.key, v);
  switch (field.type) {
    case 'boolean':
      return h('input', { type: 'checkbox', checked: !!value, onchange: (e) => save(e.target.checked) });
    case 'number':
      return h('input', { type: 'number', value: value ?? '', step: 'any', onchange: (e) => save(e.target.value) });
    case 'date':
      return h('input', { type: 'date', value: value ?? '', onchange: (e) => save(e.target.value) });
    case 'select': {
      const opts = field.options || [];
      // 選項被移除後，舊資料仍保留並標示出來，避免默默消失
      const orphan = value && !opts.some((o) => o.value === value);
      return h('select', { onchange: (e) => save(e.target.value) },
        h('option', { value: '', selected: !value }, '—'),
        opts.map((o) => h('option', { value: o.value, selected: o.value === value, title: o.value }, o.label)),
        orphan && h('option', { value, selected: true }, `${value}（已移除）`)
      );
    }
    case 'ref': {
      const opts = (dbView.refOptions && dbView.refOptions[field.key]) || [];
      const has = value !== '' && value !== undefined && value !== null;
      const orphan = has && !opts.some((o) => String(o.value) === String(value));
      return h('select', {
        title: `來源：${field.ref.category}`,
        onchange: (e) => {
          const o = opts.find((x) => String(x.value) === e.target.value);
          save(o ? o.value : e.target.value);
        }
      },
        h('option', { value: '', selected: !has }, '—'),
        opts.map((o) => h('option', { value: String(o.value), selected: has && String(o.value) === String(value) }, o.label)),
        orphan && h('option', { value: String(value), selected: true }, `${value}（找不到）`)
      );
    }
    case 'time':
      return timeInput(value, save);
    case 'longtext':
      return h('textarea', { rows: 1, value: value ?? '', onchange: (e) => save(e.target.value) });
    case 'url':
      return h('input', { type: 'url', value: value ?? '', placeholder: 'https://', onchange: (e) => save(e.target.value) });
    default:
      return h('input', { type: 'text', value: value ?? '', onchange: (e) => save(e.target.value) });
  }
}

// 24 小時制時間輸入（瀏覽器內建的 time 輸入會依系統地區顯示上午／下午，這裡固定 HH:MM）
// 接受：14:30、1430、930（→ 09:30）、9（→ 09:00）、9:5（→ 09:05）
function parseTime24(text) {
  const t = String(text).trim().replace(/[：.]/g, ':');
  if (!t) return '';
  let h, m;
  const colon = /^(\d{1,2}):(\d{0,2})$/.exec(t);
  if (colon) {
    h = +colon[1];
    m = colon[2] === '' ? 0 : +colon[2];
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) { h = +t; m = 0; } else { h = +t.slice(0, -2); m = +t.slice(-2); }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeInput(value, save) {
  let last = value || '';
  return h('input', {
    type: 'text', class: 'time-input mono', value: last, placeholder: 'HH:MM', maxlength: 5,
    inputmode: 'numeric', title: '24 小時制，例如 14:30（也可以直接輸入 1430）',
    onchange: (e) => {
      const v = parseTime24(e.target.value);
      if (v === null) {
        toast('時間格式不正確，請輸入 00:00 ～ 23:59', true);
        e.target.value = last;
        return;
      }
      e.target.value = v;
      if (v !== last) {
        last = v;
        save(v);
      }
    },
    onkeydown: (e) => {
      // 上下鍵調整分鐘（按住 Shift 調整小時）
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = parseTime24(e.target.value) || '00:00';
      let mins = +cur.slice(0, 2) * 60 + +cur.slice(3);
      mins += (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 1);
      mins = (mins + 1440) % 1440;
      e.target.value = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
  });
}

function renderItems(cat) {
  const q = dbView.filter.trim().toLowerCase();
  const rows = dbView.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !q || Object.values(item.data).some((v) => String(v).toLowerCase().includes(q)));

  const search = h('input', {
    type: 'text', placeholder: '搜尋…', value: dbView.filter,
    oninput: (e) => {
      dbView.filter = e.target.value;
      const pos = e.target.selectionStart;
      renderDetail();
      const s = document.querySelector('#db-detail .toolbar input');
      s.focus();
      s.setSelectionRange(pos, pos);
    }
  });

  const toolbar = h('div', { class: 'toolbar' },
    search,
    h('button', { class: 'btn primary small', onclick: () => addRow(cat) }, '＋ 新增一筆')
  );

  if (!cat.fields.length) {
    return h('div', {}, toolbar, h('div', { class: 'card empty' }, '這個分類還沒有欄位，請先到「欄位」分頁新增。'));
  }
  if (!dbView.items.length) {
    return h('div', {}, toolbar, h('div', { class: 'card empty' }, '還沒有資料，按「＋ 新增一筆」開始。'));
  }

  const onSave = (item) => (key, value) =>
    write(() => settings.db.updateItem(cat.id, item.id, { [key]: value })).then((updated) => {
      item.data = updated.data;
    }).catch(() => {});

  const table = h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, '#'),
      cat.fields.map((f) => h('th', {}, f.label, h('small', { class: 'mono' }, f.key))),
      h('th', {})
    )),
    h('tbody', {}, rows.map(({ item, index }) =>
      h('tr', { dataset: { id: item.id } },
        h('td', { class: 'num' }, index + 1),
        cat.fields.map((f) => h('td', { class: f.type === 'boolean' ? 'center' : '' }, cellInput(f, item.data[f.key], onSave(item)))),
        h('td', { class: 'actions' },
          h('button', { class: 'icon-btn', title: '上移', disabled: index === 0 || !!q, onclick: () => moveRow(cat, item, index - 1) }, '↑'),
          h('button', { class: 'icon-btn', title: '下移', disabled: index === dbView.items.length - 1 || !!q, onclick: () => moveRow(cat, item, index + 1) }, '↓'),
          h('button', { class: 'icon-btn danger', title: '刪除', onclick: () => removeRow(cat, item) }, '✕')
        )
      )
    ))
  );
  return h('div', {}, toolbar, h('div', { class: 'table-wrap' }, table),
    q && h('div', { class: 'hint mt' }, `顯示 ${rows.length} / ${dbView.items.length} 筆（搜尋時無法排序）`));
}

async function addRow(cat) {
  const item = await write(() => settings.db.addItem(cat.id, {}));
  dbView.filter = '';
  await refreshCurrent();
  const tr = document.querySelector(`tr[data-id="${item.id}"]`);
  if (tr) {
    tr.classList.add('flash');
    tr.scrollIntoView({ block: 'nearest' });
    const input = tr.querySelector('input:not([type=checkbox]), textarea');
    if (input) input.focus();
  }
}

async function moveRow(cat, item, to) {
  await write(() => settings.db.moveItem(cat.id, item.id, to));
  await refreshCurrent();
}

function removeRow(cat, item) {
  const first = cat.fields[0] && item.data[cat.fields[0].key];
  openModal({
    title: '刪除這筆資料？',
    body: h('p', {}, first ? `「${first}」將被刪除，無法復原。` : '這筆資料將被刪除，無法復原。'),
    okText: '刪除',
    danger: true,
    onOk: async () => {
      await write(() => settings.db.removeItem(cat.id, item.id));
      await refreshCurrent();
    }
  });
}

// ---- 欄位 ----
function renderFields(cat) {
  if (!dbView.draftFields) {
    // orig：選項原本的實際值，儲存時用來把舊資料換成新值
    dbView.draftFields = cat.fields.map((f) => ({
      ...f,
      options: f.options ? f.options.map((o) => ({ ...o, orig: o.value })) : undefined,
      ref: f.ref ? { ...f.ref } : undefined,
      isNew: false
    }));
  }
  const draft = dbView.draftFields;
  const dirty = fieldsDirty();

  const rows = draft.map((f, i) => [
    h('div', { class: 'field-row' },
      h('input', { type: 'text', value: f.label, placeholder: '顯示名稱', oninput: (e) => { f.label = e.target.value; markDirty(); } }),
      h('input', {
        type: 'text', class: 'mono', value: f.key, placeholder: 'key（英文）', disabled: !f.isNew,
        title: f.isNew ? '小工具讀取時使用的欄位代碼' : '已建立的欄位代碼不能修改，避免舊資料對不上',
        oninput: (e) => { f.key = e.target.value; markDirty(); }
      }),
      h('select', {
        onchange: (e) => {
          f.type = e.target.value;
          if (f.type === 'select' && !(f.options && f.options.length)) f.options = [{ label: '', value: '' }];
          if (f.type === 'ref' && !f.ref) {
            // 預設連結第一個其他分類，顯示名稱取它的第一個文字欄位
            const other = dbView.cats.find((c) => c.id !== dbView.current) || dbView.cats[0];
            f.ref = { category: other ? other.id : '', labelKey: '', valueKey: REF_ID };
            pickRefLabel(f.ref);
          }
          renderDetail();
        }
      },
        FIELD_TYPES.map(([v, label]) => h('option', { value: v, selected: f.type === v }, label))
      ),
      h('div', { class: 'field-actions' },
        h('button', { class: 'icon-btn', title: '上移', disabled: i === 0, onclick: () => { draft.splice(i - 1, 0, draft.splice(i, 1)[0]); renderDetail(); } }, '↑'),
        h('button', { class: 'icon-btn', title: '下移', disabled: i === draft.length - 1, onclick: () => { draft.splice(i + 1, 0, draft.splice(i, 1)[0]); renderDetail(); } }, '↓'),
        h('button', { class: 'icon-btn danger', title: '移除欄位', onclick: () => { draft.splice(i, 1); renderDetail(); } }, '✕')
      )
    ),
    f.type === 'select' && renderOptionsEditor(f, markDirty),
    f.type === 'ref' && renderRefEditor(f, markDirty)
  ]);

  const saveBtn = h('button', { class: 'btn primary small', id: 'btn-save-fields', disabled: !dirty, onclick: () => saveFields(cat) }, '儲存欄位');
  function markDirty() { saveBtn.disabled = false; }

  return h('div', {},
    h('div', { class: 'toolbar' },
      h('span', { class: 'hint' }, '移除欄位不會刪除已存的資料，重新加回同樣的 key 就會再出現。'),
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn small', onclick: () => {
            let n = draft.length + 1;
            while (draft.some((f) => f.key === `field${n}`)) n++;
            draft.push({ key: `field${n}`, label: '', type: 'text', isNew: true });
            renderDetail();
            const last = [...document.querySelectorAll('.field-row:not(.head)')].pop();
            if (last) last.querySelector('input').focus();
          }
        }, '＋ 新增欄位'),
        dirty && h('button', { class: 'btn small ghost', onclick: () => { dbView.draftFields = null; renderDetail(); } }, '還原'),
        saveBtn
      )
    ),
    h('div', { class: 'card' },
      h('div', { class: 'field-row head' }, h('div', {}, '顯示名稱'), h('div', {}, '欄位代碼 key'), h('div', {}, '類型'), h('div', {})),
      rows.length ? rows : h('div', { class: 'empty' }, '沒有欄位')
    )
  );
}

// 資料表欄位設定：選擇資料表、顯示名稱欄位、值欄位
function pickRefLabel(ref) {
  const target = dbView.cats.find((c) => c.id === ref.category);
  const fields = target ? target.fields : [];
  if (!fields.some((x) => x.key === ref.labelKey)) {
    const first = fields.find((x) => x.type === 'text') || fields[0];
    ref.labelKey = first ? first.key : '';
  }
  if (ref.valueKey !== REF_ID && !fields.some((x) => x.key === ref.valueKey)) ref.valueKey = REF_ID;
}

function renderRefEditor(f, markDirty) {
  const ref = f.ref;
  const target = dbView.cats.find((c) => c.id === ref.category);
  const fields = target ? target.fields : [];
  const fieldOpts = (selected) => fields.map((x) =>
    h('option', { value: x.key, selected: x.key === selected }, `${x.label}（${x.key}）`));

  return h('div', { class: 'field-options ref-editor' },
    h('div', { class: 'ref-grid' },
      h('label', {}, h('span', { class: 'hint' }, '資料表'),
        h('select', {
          onchange: (e) => { ref.category = e.target.value; pickRefLabel(ref); renderDetail(); }
        },
          !target && h('option', { value: ref.category, selected: true }, ref.category ? `${ref.category}（不存在）` : '請選擇'),
          dbView.cats.map((c) => h('option', { value: c.id, selected: c.id === ref.category },
            `${c.name}（${c.id}）${c.id === dbView.current ? '・本分類' : ''}`))
        )
      ),
      h('label', {}, h('span', { class: 'hint' }, '顯示名稱'),
        h('select', { disabled: !fields.length, onchange: (e) => { ref.labelKey = e.target.value; markDirty(); } },
          !fields.length && h('option', { value: '' }, '（沒有欄位）'),
          fieldOpts(ref.labelKey))
      ),
      h('label', {}, h('span', { class: 'hint' }, '值（存進資料庫）'),
        h('select', { disabled: !target, onchange: (e) => { ref.valueKey = e.target.value; markDirty(); } },
          h('option', { value: REF_ID, selected: ref.valueKey === REF_ID }, '資料 ID（建議）'),
          fieldOpts(ref.valueKey))
      )
    ),
    h('div', { class: 'hint' }, '資料頁籤會以下拉選單列出所選資料表的資料。值選「資料 ID」時，之後改名稱也不會對不上。')
  );
}

// 下拉選單選項編輯：每列 顯示文字 / 實際值
function renderOptionsEditor(f, markDirty) {
  const opts = f.options = f.options || [];
  const focusLast = () => {
    const rows = document.querySelectorAll(`.field-options[data-key="${CSS.escape(f.key)}"] .opt-row`);
    const last = rows[rows.length - 1];
    if (last) last.querySelector('input').focus();
  };
  return h('div', { class: 'field-options', dataset: { key: f.key } },
    h('div', { class: 'opt-row opt-head' }, h('span', {}, '顯示文字'), h('span', {}, '實際值（存進資料庫）'), h('span', {})),
    opts.map((o, j) =>
      h('div', { class: 'opt-row' },
        h('input', { type: 'text', value: o.label, placeholder: '例如：採礦', oninput: (e) => { o.label = e.target.value; markDirty(); } }),
        h('input', {
          type: 'text', class: 'mono', value: o.value, placeholder: o.label || '留空＝同顯示文字',
          oninput: (e) => { o.value = e.target.value; markDirty(); },
          onkeydown: (e) => {
            if (e.key === 'Enter' && j === opts.length - 1) { opts.push({ label: '', value: '' }); renderDetail(); focusLast(); }
          }
        }),
        h('div', { class: 'field-actions' },
          h('button', { class: 'icon-btn', title: '上移', disabled: j === 0, onclick: () => { opts.splice(j - 1, 0, opts.splice(j, 1)[0]); renderDetail(); } }, '↑'),
          h('button', { class: 'icon-btn', title: '下移', disabled: j === opts.length - 1, onclick: () => { opts.splice(j + 1, 0, opts.splice(j, 1)[0]); renderDetail(); } }, '↓'),
          h('button', { class: 'icon-btn danger', title: '移除選項', onclick: () => { opts.splice(j, 1); renderDetail(); } }, '✕')
        )
      )
    ),
    h('button', {
      class: 'btn small ghost add-opt',
      onclick: () => { opts.push({ label: '', value: '' }); renderDetail(); focusLast(); }
    }, '＋ 新增選項')
  );
}

async function saveFields(cat) {
  const fields = cleanDraft(dbView.draftFields).map((f) => ({ ...f, label: f.label.trim() || f.key }));
  const renames = {};
  for (const f of dbView.draftFields) {
    if (f.type !== 'select' || f.isNew) continue;
    for (const o of f.options || []) {
      const value = String(o.value || '').trim() || String(o.label || '').trim();
      if (o.orig && value && o.orig !== value) (renames[f.key] = renames[f.key] || {})[o.orig] = value;
    }
  }
  await write(() => settings.db.updateCategory(cat.id, { fields, renames }));
  dbView.draftFields = null;
  toast('欄位已儲存');
  await refreshCurrent();
}

// ---- 使用方式 ----
function renderUsage(cat) {
  const sample = Object.fromEntries(cat.fields.slice(0, 3).map((f) => [f.key,
    f.type === 'number' ? 0 : f.type === 'boolean' ? true : f.type === 'date' ? '2026-01-01' : f.type === 'time' ? '08:00'
      : f.type === 'select' ? f.options[0].value
        : f.type === 'ref' ? (((dbView.refOptions || {})[f.key] || [])[0] || { value: '…' }).value : '…']));
  const code = [
    `// 讀取「${cat.name}」的所有資料`,
    `const items = await widget.db.items('${cat.id}');`,
    `items.forEach(({ id, data }) => console.log(${cat.fields[0] ? `data.${cat.fields[0].key}` : 'data'}));`,
    '',
    '// 新增 / 修改 / 刪除',
    `await widget.db.add('${cat.id}', ${JSON.stringify(sample)});`,
    `await widget.db.update('${cat.id}', id, { ... });`,
    `await widget.db.remove('${cat.id}', id);`,
    '',
    '// 資料有變動時（在設定視窗或其他小工具修改）重新載入',
    `widget.db.onChange(({ categoryId }) => {`,
    `  if (categoryId === '${cat.id}') reload();`,
    '});'
  ];
  return h('div', {},
    h('p', { class: 'hint' }, '在小工具的 JavaScript 中使用以下程式碼存取這個分類：'),
    h('pre', { class: 'code mono' }, code.map((line) => line.startsWith('//')
      ? h('span', { class: 'c' }, line + '\n') : line + '\n')),
    h('h2', {}, '欄位'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'key'), h('th', {}, '名稱'), h('th', {}, '類型'))),
      h('tbody', {}, cat.fields.map((f) => h('tr', {},
        h('td', { class: 'mono' }, f.key), h('td', {}, f.label), h('td', {}, TYPE_LABEL[f.type] || f.type,
          f.type === 'select' && h('div', { class: 'hint' },
            f.options.map((o) => (o.label === o.value ? o.value : `${o.label} = ${o.value}`)).join('、')),
          f.type === 'ref' && h('div', { class: 'hint' },
            `${f.ref.category}・顯示 ${f.ref.labelKey}・值 ${f.ref.valueKey === REF_ID ? '資料 ID' : f.ref.valueKey}`)))))
    ))
  );
}

// ---- 分類 新增／編輯／刪除 ----
function newCategory() {
  const name = h('input', { type: 'text', placeholder: '例如：採集鬧鐘' });
  const id = h('input', { type: 'text', class: 'mono', placeholder: '例如：ff14-alarms' });
  const desc = h('input', { type: 'text', placeholder: '（選填）' });
  openModal({
    title: '新增分類',
    body: h('div', {},
      formRow('分類名稱', name),
      formRow('分類代碼', id, '小工具用這個代碼讀取資料。小寫英文、數字、- 或 _，建立後不能修改。'),
      formRow('說明', desc)
    ),
    okText: '建立',
    onOk: async () => {
      const c = await selfWrite(() => settings.db.createCategory({ name: name.value, id: id.value, description: desc.value }));
      dbView.current = c.id;
      dbView.sub = 'fields';
      dbView.draftFields = null;
      await refreshCurrent();
      toast('分類已建立，可以設定欄位了');
    }
  });
}

function editCategory(cat) {
  const name = h('input', { type: 'text', value: cat.name });
  const desc = h('input', { type: 'text', value: cat.description || '' });
  openModal({
    title: '編輯分類',
    body: h('div', {},
      formRow('分類名稱', name),
      formRow('分類代碼', h('input', { type: 'text', class: 'mono', value: cat.id, disabled: true })),
      formRow('說明', desc)
    ),
    okText: '儲存',
    onOk: async () => {
      await selfWrite(() => settings.db.updateCategory(cat.id, { name: name.value, description: desc.value }));
      await refreshCurrent();
    }
  });
}

function deleteCategory(cat) {
  openModal({
    title: `刪除分類「${cat.name}」？`,
    body: h('div', {},
      h('p', {}, `分類內的 ${cat.count} 筆資料會一起刪除，無法復原。使用這個分類（${cat.id}）的小工具將讀不到資料。`),
      (cat.refBy || []).length > 0 && h('p', { class: 'warn-text' },
        `注意：${cat.refBy.map((r) => `「${r.categoryName}」的「${r.label}」`).join('、')} 連結到這個分類，刪除後這些欄位的選項會變成空的。`)
    ),
    okText: '刪除分類',
    danger: true,
    onOk: async () => {
      await selfWrite(() => settings.db.deleteCategory(cat.id));
      dbView.current = null;
      dbView.draftFields = null;
      await refreshCurrent();
      toast('分類已刪除');
    }
  });
}

$('#btn-new-cat').addEventListener('click', newCategory);
$('#btn-import').addEventListener('click', importJson);
$('#btn-export-all').addEventListener('click', () => exportJson(null));

// ---- 匯出／匯入 JSON ----
async function exportJson(ids) {
  if (!ids && !dbView.cats.length) {
    toast('還沒有任何分類可以匯出', true);
    return;
  }
  const r = await run(() => settings.db.exportJson(ids));
  if (r) toast(`已匯出 ${r.categories} 個分類、${r.items} 筆資料`);
}

async function importJson() {
  if (fieldsDirty() && !confirmDiscardFields()) return;
  const file = await run(() => settings.db.importOpen()).catch(() => null);
  if (!file) return;
  const { preview } = file;
  const selected = new Set(preview.map((c) => c.id));
  const hasConflict = () => preview.some((c) => c.exists && selected.has(c.id));
  let conflict = 'merge';

  const conflictBox = h('div', { class: 'import-conflict' },
    h('div', { class: 'hint' }, '分類代碼已存在時：'),
    [['merge', '合併', '保留現有資料；加入新欄位與新資料，相同 id 的資料以檔案內容更新'],
      ['replace', '取代', '用檔案的欄位與資料完全取代現有分類（現有資料會刪除）'],
      ['skip', '略過', '不匯入已存在的分類']
    ].map(([v, label, desc]) => h('label', { class: 'radio-row' },
      h('input', { type: 'radio', name: 'conflict', value: v, checked: v === conflict, onchange: () => { conflict = v; } }),
      h('span', {}, h('b', {}, label), h('span', { class: 'hint' }, ` — ${desc}`))
    ))
  );
  const syncConflict = () => { conflictBox.hidden = !hasConflict(); };

  const list = h('div', { class: 'import-list' }, preview.map((c) =>
    h('label', { class: 'import-row' },
      h('input', {
        type: 'checkbox', checked: true,
        onchange: (e) => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); syncConflict(); }
      }),
      h('span', { class: 'import-name' }, c.name, h('span', { class: 'mono hint' }, ` ${c.id}`)),
      h('span', { class: 'import-meta' },
        `${c.fields} 欄位・${c.items} 筆`,
        c.exists && h('span', { class: 'badge warn', title: `目前「${c.existingName}」有 ${c.existingItems} 筆資料` }, '已存在')
      )
    )
  ));
  syncConflict();

  openModal({
    title: `匯入「${file.fileName}」`,
    body: h('div', {}, h('p', { class: 'hint mb' }, '選擇要匯入的分類：'), list, conflictBox),
    okText: '匯入',
    onOk: async () => {
      if (!selected.size) throw new Error('請至少選擇一個分類');
      if (conflict === 'replace' && hasConflict()) {
        const names = preview.filter((c) => c.exists && selected.has(c.id)).map((c) => `「${c.existingName}」`).join('、');
        if (!window.confirm(`確定要取代 ${names} 嗎？現有的欄位與資料會被檔案內容覆蓋。`)) throw new Error('已取消');
      }
      const report = await settings.db.importApply({ conflict, onlyIds: [...selected] });
      const done = report.filter((r) => r.action !== 'skipped');
      const added = report.reduce((n, r) => n + r.added, 0);
      const updated = report.reduce((n, r) => n + r.updated, 0);
      if (done.length) dbView.current = done[0].id;
      dbView.sub = 'items';
      dbView.draftFields = null;
      await refreshCurrent();
      const skipped = report.length - done.length;
      toast(`匯入完成：${done.length} 個分類，新增 ${added} 筆${updated ? `、更新 ${updated} 筆` : ''}${skipped ? `，略過 ${skipped} 個` : ''}`);
    }
  });
}

async function refreshCurrent() {
  await loadCats();
  await loadItems();
  renderCatList();
  renderDetail();
}

// 資料變動通知（可能來自小工具）
settings.db.onChange(async () => {
  if (dbView.selfWrites > 0) {
    dbView.selfWrites--;
    return;
  }
  // 使用者正在表格裡輸入時先不重繪，等離開輸入框再更新
  if (document.activeElement && document.activeElement.closest('#db-detail table')) {
    dbView.pendingRefresh = true;
    return;
  }
  const draft = dbView.draftFields;
  await loadCats();
  await loadItems();
  dbView.draftFields = draft;
  renderDetail();
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (dbView.pendingRefresh && !(document.activeElement && document.activeElement.closest('#db-detail table'))) {
      dbView.pendingRefresh = false;
      refreshCurrent();
    }
  }, 0);
});

// ---------------------------------------------------------------------------
(async () => {
  try {
    const t = localStorage.getItem('settings.tab');
    if (t) showTab(t);
  } catch { /* ignore */ }
  applyState(await settings.getState());
  await loadCats();
  await loadItems();
  renderDetail();
})();
