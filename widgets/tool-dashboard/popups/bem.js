// BEM 檢查結果視窗：資料由儀表盤的 BEM 檢查工具傳入（window.popup.getData）
// data: { mode, items: [{ name, line, results: { <慣例>: { valid, issues, suggestion, alternatives } } }], conventions, theme }
const $ = (id) => document.getElementById(id);
const STORE_KEY = 'bem.convention';
const MODE_LABELS = { css: 'CSS／SCSS', html: 'HTML', names: '名稱' };

let data = null;
let convention = 'classic';
try { convention = localStorage.getItem(STORE_KEY) || 'classic'; } catch { /* 讀不到就用預設 */ }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COPY_ICONS = '<svg class="icon cp" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon ok" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const copyButton = (text, label = '複製') =>
  `<button class="copy" data-text="${esc(text)}" title="複製 ${esc(text)}">${COPY_ICONS}<span>${label}</span></button>`;

function renderConventions() {
  const list = data.conventions || {};
  if (!list[convention]) convention = Object.keys(list)[0] || 'classic';
  $('conv').innerHTML = Object.entries(list).map(([id, c]) =>
    `<button data-conv="${esc(id)}" aria-pressed="${id === convention}" title="${esc(c.example)}">${esc(c.label)}<small>${esc(c.example)}</small></button>`
  ).join('');
}

function renderResults() {
  const items = data.items || [];
  const bad = items.filter((it) => !it.results[convention].valid);
  const ok = items.filter((it) => it.results[convention].valid);

  $('chips').innerHTML = [MODE_LABELS[data.mode] || '', `${items.length} 個 class`]
    .filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('');

  $('status').className = `status ${bad.length ? 'bad' : 'ok'}`;
  $('badge').textContent = bad.length ? `${bad.length} 個不符合` : '全部符合';
  $('detail').textContent = bad.length ? `${ok.length} 個符合，共 ${items.length} 個` : `共 ${items.length} 個 class`;

  $('sec-bad').hidden = !bad.length;
  $('bad-list').innerHTML = bad.map((it) => {
    const r = it.results[convention];
    const target = r.suggestion
      ? `<span class="name to mono">${esc(r.suggestion)}</span>${copyButton(r.suggestion)}`
      : '<span class="manual">無法自動修正，需手動命名</span>';
    const alts = r.alternatives.length
      ? `<div class="alts">${r.alternatives.map((a) =>
        `<div class="row"><span class="name alt mono">${esc(a.name)}</span><span class="note">${esc(a.note)}</span>${copyButton(a.name)}</div>`
      ).join('')}</div>`
      : '';
    return `<div class="item">
      <div class="row"><span class="name from mono">${esc(it.name)}</span><span class="line">第 ${it.line} 行</span></div>
      <div class="row"><span class="arrow" aria-hidden="true">→</span>${target}</div>
      <ul class="issues">${r.issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul>
      ${alts}
    </div>`;
  }).join('');

  $('sec-ok').hidden = !ok.length;
  $('ok-list').innerHTML = ok.map((it) => `<span class="chip mono">${esc(it.name)}</span>`).join('');
  $('copy-map').hidden = !bad.length;
}

function render(d) {
  if (!d) return;
  data = d;
  document.body.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  renderConventions();
  renderResults();
  document.querySelector('.content').scrollTop = 0;
}

// ---- 切換命名慣例（記住選擇） ----
$('conv').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-conv]');
  if (!btn || !data) return;
  convention = btn.dataset.conv;
  try { localStorage.setItem(STORE_KEY, convention); } catch { /* 存不了就只在這次有效 */ }
  renderConventions();
  renderResults();
});

// ---- 複製 ----
const timers = new WeakMap();
async function copyWithFeedback(btn, text) {
  await window.popup.copyText(text);
  const label = btn.querySelector('span');
  const original = label.dataset.text || label.textContent;
  label.dataset.text = original;
  label.textContent = '已複製';
  btn.classList.add('done');
  clearTimeout(timers.get(btn));
  timers.set(btn, setTimeout(() => {
    btn.classList.remove('done');
    label.textContent = original;
  }, 1500));
}

$('bad-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.copy');
  if (btn) copyWithFeedback(btn, btn.dataset.text);
});

// 對照表：每行「原名稱<Tab>建議名稱」，方便貼到試算表
$('copy-map').addEventListener('click', () => {
  if (!data) return;
  const rows = data.items
    .filter((it) => !it.results[convention].valid)
    .map((it) => `${it.name}\t${it.results[convention].suggestion || '（需手動命名）'}`);
  copyWithFeedback($('copy-map'), rows.join('\n'));
});

// ---- 關閉 ----
$('close').addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
});

window.popup.onData(render);
window.popup.getData().then(render);
