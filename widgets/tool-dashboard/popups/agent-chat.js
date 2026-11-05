// Claude 角色的快速聊天視窗：資料 { name, theme } 由主程序開啟時傳入
const $ = (id) => document.getElementById(id);
const els = {
  avatar: $('avatar'), title: $('title'), model: $('model'), cwd: $('cwd'), cwdText: $('cwd-text'),
  messages: $('messages'), input: $('input'), send: $('send'), stop: $('stop'), paste: $('paste'), cost: $('cost'),
  composer: $('composer'), keyform: $('keyform'), key: $('key'), keySave: $('key-save'), keyErr: $('key-err'),
  newChat: $('new-chat'), edit: $('edit'), close: $('close'), confirm: $('confirm-new')
};

const ICON = {
  run: '<svg class="icon st-run" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>',
  done: '<svg class="icon st-done" width="12" height="12" viewBox="0 0 24 24" stroke-width="2.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  err: '<svg class="icon st-err" width="12" height="12" viewBox="0 0 24 24" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  term: '<svg class="icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>'
};

let name = null;
let role = null;
let ready = false; // 可以聊天：已設定 API Key，或選擇沿用本機 Claude Code 登入
let busy = false;
let stickToBottom = true;
let streamEl = null;  // 串流中的回覆
let streamText = '';

const esc = window.escapeHtml;

// ---- 標題 ----
function renderHeader() {
  if (!role) return;
  const color = (window.AGENT_COLORS[role.color] || window.AGENT_COLORS.blue).hex;
  els.avatar.style.setProperty('--c', color);
  els.avatar.innerHTML = (window.MASCOTS[role.mascot] || window.MASCOTS.blob).svg(color, 24);
  els.title.textContent = role.displayName;
  document.title = role.displayName;
  els.input.placeholder = `傳訊息給${role.displayName}…`;
  els.cwd.hidden = !role.cwd;
  els.cwdText.textContent = role.cwd;
  els.cwd.title = role.cwd;
}

function setModel(model) {
  els.model.hidden = !model;
  els.model.textContent = (model || '').replace(/^claude-/, '');
}

function setCost(cost) {
  els.cost.textContent = typeof cost === 'number' ? `本次對話約 $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}` : '';
}

function setBusy(state) {
  busy = state === 'running' || state === 'waiting';
  els.send.hidden = busy;
  els.stop.hidden = !busy;
  updateSend();
}

function updateSend() {
  els.send.disabled = !els.input.value.trim();
}

// ---- 對話內容 ----
function scrollToEnd(force) {
  if (force || stickToBottom) els.messages.scrollTop = els.messages.scrollHeight;
}
els.messages.addEventListener('scroll', () => {
  const m = els.messages;
  stickToBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
});

function showEmpty() {
  if (els.messages.children.length) return;
  const color = role ? (window.AGENT_COLORS[role.color] || window.AGENT_COLORS.blue).hex : '#6ea8fe';
  const m = role ? (window.MASCOTS[role.mascot] || window.MASCOTS.blob) : window.MASCOTS.blob;
  els.messages.innerHTML = `<div class="empty">${m.svg(color, 56)}<div>${role ? esc(role.displayName) : ''}準備好了<br>可以修改檔案、執行指令，動手前會先問你</div></div>`;
}

function clearEmpty() {
  const e = els.messages.querySelector('.empty');
  if (e) e.remove();
}

function addUser(text) {
  clearEmpty();
  const div = document.createElement('div');
  div.className = 'msg-user';
  div.textContent = text;
  els.messages.appendChild(div);
}

function aiBubble(text, streaming) {
  clearEmpty();
  const div = document.createElement('div');
  div.className = 'msg-ai';
  div.dataset.text = text;
  div.innerHTML = window.renderMarkdown(text) + (streaming ? '<span class="cursor"></span>' : '<button class="copy-msg" type="button">複製</button>');
  els.messages.appendChild(div);
  return div;
}

function toolsGroup() {
  const last = els.messages.lastElementChild;
  if (last && last.classList.contains('tools')) return last;
  clearEmpty();
  const g = document.createElement('div');
  g.className = 'tools';
  els.messages.appendChild(g);
  return g;
}

function addTool(t) {
  const line = document.createElement('div');
  line.className = `tool-line ${t.status || 'running'}`;
  line.dataset.id = t.id;
  line.innerHTML = `${ICON.run}${ICON.done}${ICON.err}<span>${esc(t.verb)}</span><span class="detail">${esc(t.detail || '')}</span>`;
  line.title = `${t.verb} ${t.detail || ''}`;
  toolsGroup().appendChild(line);
}

function addPermission(p) {
  clearEmpty();
  const card = document.createElement('div');
  card.className = 'perm';
  card.dataset.id = p.id;
  card.setAttribute('role', 'alert');
  card.innerHTML = `
    <div class="perm-title">${ICON.term}<span>${esc(p.title)}</span></div>
    ${p.code ? `<pre class="mono">${esc(p.code)}</pre>` : ''}
    ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
    <div class="perm-actions">
      <button class="btn primary" data-d="allow">允許</button>
      ${p.allowSession ? '<button class="btn" data-d="allow_session">這個對話都允許</button>' : ''}
      <button class="btn" data-d="deny">拒絕</button>
    </div>`;
  card.querySelectorAll('button[data-d]').forEach((b) => {
    b.addEventListener('click', () => {
      card.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      window.agents.call('answer', name, p.id, b.dataset.d);
    });
  });
  els.messages.appendChild(card);
  // 拒絕預設取得焦點，避免誤按 Enter 就允許
  const deny = card.querySelector('[data-d="deny"]');
  if (document.hasFocus()) deny.focus({ preventScroll: true });
}

function addError(text) {
  clearEmpty();
  const div = document.createElement('div');
  div.className = 'err';
  div.textContent = text;
  els.messages.appendChild(div);
}

function endStream() {
  if (streamEl) {
    const c = streamEl.querySelector('.cursor');
    if (c) c.remove();
    if (!streamEl.querySelector('.copy-msg')) streamEl.insertAdjacentHTML('beforeend', '<button class="copy-msg" type="button">複製</button>');
  }
  streamEl = null;
  streamText = '';
}

function renderHistory(h) {
  els.messages.textContent = '';
  streamEl = null;
  streamText = '';
  for (const it of h.items) {
    if (it.role === 'user') addUser(it.text);
    else if (it.role === 'assistant') {
      const el = aiBubble(it.text, !!it.streaming);
      if (it.streaming) { streamEl = el; streamText = it.text; }
    } else if (it.role === 'tool') addTool(it);
    else if (it.role === 'permission') addPermission(it);
    else if (it.role === 'error') addError(it.text);
  }
  setCost(h.cost);
  setModel(h.model || (role && role.model));
  setBusy(h.state);
  showEmpty();
  scrollToEnd(true);
}

// ---- 即時事件 ----
let streamFrame = 0;
function onEvent({ name: n, event: ev, cost, model }) {
  if (n !== name) return;
  switch (ev.type) {
    case 'user': addUser(ev.text); stickToBottom = true; break;
    case 'delta':
      streamText += ev.text;
      if (!streamEl) streamEl = aiBubble(streamText, true);
      else if (!streamFrame) {
        // 合併到下一個畫面再重畫，大量片段時不卡
        streamFrame = requestAnimationFrame(() => {
          streamFrame = 0;
          if (streamEl) { streamEl.innerHTML = `${window.renderMarkdown(streamText)}<span class="cursor"></span>`; streamEl.dataset.text = streamText; scrollToEnd(); }
        });
      }
      break;
    case 'assistant':
      if (streamEl) {
        cancelAnimationFrame(streamFrame); streamFrame = 0;
        streamEl.innerHTML = window.renderMarkdown(ev.text);
        streamEl.dataset.text = ev.text;
      } else {
        streamEl = aiBubble(ev.text, false);
      }
      endStream();
      break;
    case 'tool': endStream(); addTool({ ...ev, status: 'running' }); break;
    case 'tool_done': {
      const line = els.messages.querySelector(`.tool-line[data-id="${CSS.escape(ev.id)}"]`);
      if (line) line.className = `tool-line ${ev.isError ? 'error' : 'done'}`;
      break;
    }
    case 'permission': endStream(); addPermission(ev); break;
    case 'permission_done': {
      const card = els.messages.querySelector(`.perm[data-id="${CSS.escape(ev.id)}"]`);
      if (card) card.remove();
      break;
    }
    case 'ready': setModel(ev.model); break;
    case 'retry': setStatus(`連線不穩，重試中（${ev.attempt}/${ev.max}）…`); break;
    case 'result':
      endStream();
      setStatus('');
      els.messages.querySelectorAll('.tool-line.running').forEach((l) => { l.className = 'tool-line done'; });
      if (ev.isError && ev.message) addError(ev.message);
      break;
    case 'error': endStream(); setStatus(''); addError(ev.message); break;
    case 'state': setBusy(ev.state); break;
    default: break;
  }
  if (typeof cost === 'number') setCost(cost);
  if (model) setModel(model);
  scrollToEnd();
}

function setStatus(text) {
  let s = els.messages.querySelector('.status-line');
  if (!text) { if (s) s.remove(); return; }
  if (!s) { s = document.createElement('div'); s.className = 'status-line'; els.messages.appendChild(s); }
  s.textContent = text;
}

// 複製回覆或程式碼
els.messages.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-msg, .code-copy');
  if (!btn) return;
  const text = btn.classList.contains('code-copy')
    ? btn.closest('.code-block').querySelector('code').textContent
    : btn.closest('.msg-ai').dataset.text;
  await window.popup.copyText(text);
  const old = btn.textContent;
  btn.textContent = '已複製';
  setTimeout(() => { btn.textContent = old; }, 1200);
});

// ---- 輸入 ----
async function send() {
  const text = els.input.value.trim();
  if (!text || busy) return;
  els.input.value = '';
  autoSize();
  updateSend();
  try {
    await window.agents.call('send', name, text);
  } catch (err) {
    addError(err.message);
    if (/API Key/.test(err.message)) showKeyForm(true);
  }
}

function autoSize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(120, els.input.scrollHeight)}px`;
}

els.input.addEventListener('input', () => { autoSize(); updateSend(); });
els.input.addEventListener('keydown', (e) => {
  // 輸入法組字中按 Enter 是選字，不送出
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    send();
  }
});
els.send.addEventListener('click', send);
els.stop.addEventListener('click', () => window.agents.call('stop', name));
els.paste.addEventListener('click', async () => {
  const text = await window.popup.readText();
  if (!text) return;
  const { selectionStart: a, selectionEnd: b, value } = els.input;
  els.input.value = value.slice(0, a) + text + value.slice(b);
  els.input.selectionStart = els.input.selectionEnd = a + text.length;
  els.input.focus();
  autoSize();
  updateSend();
});

// ---- 標題列按鈕 ----
els.newChat.addEventListener('click', () => { els.confirm.hidden = false; $('confirm-ok').focus(); });
$('confirm-cancel').addEventListener('click', () => { els.confirm.hidden = true; });
$('confirm-ok').addEventListener('click', async () => {
  els.confirm.hidden = true;
  await window.agents.call('newChat', name);
  renderHistory(await window.agents.call('history', name));
  els.input.focus();
});
els.edit.addEventListener('click', () => window.agents.call('openEditor', name));
els.close.addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.confirm.hidden) { els.confirm.hidden = true; return; }
  window.popup.close();
});

// ---- API Key ----
function showKeyForm(show) {
  els.keyform.hidden = !show;
  els.messages.hidden = show;
  els.composer.hidden = show;
  els.newChat.disabled = show;
  if (show) setTimeout(() => els.key.focus(), 50);
}

async function saveKey() {
  els.keyErr.textContent = '';
  els.keySave.disabled = true;
  els.keySave.textContent = '驗證中…';
  try {
    const r = await window.agents.call('setKey', els.key.value);
    if (r.ok) {
      els.key.value = '';
      ready = true;
      showKeyForm(false);
      els.input.focus();
    } else {
      els.keyErr.textContent = r.message;
    }
  } catch (err) {
    els.keyErr.textContent = err.message;
  } finally {
    els.keySave.disabled = false;
    els.keySave.textContent = '驗證並儲存';
  }
}
els.keySave.addEventListener('click', saveKey);

// 沿用本機 Claude Code 登入：先問 Claude Code 本機是否已登入（只回傳狀態，不經手憑證）
$('use-local').addEventListener('click', async () => {
  const btn = $('use-local');
  els.keyErr.textContent = '';
  btn.disabled = true;
  btn.textContent = '檢查本機登入中…';
  try {
    const st = await window.agents.call('localAuthStatus');
    if (!st.loggedIn) {
      els.keyErr.textContent = st.ok ? '這台電腦的 Claude Code 尚未登入，請先在終端機執行 claude 並完成登入，再按一次。' : `無法確認登入狀態：${st.error}`;
      return;
    }
    await window.agents.call('setAuthMode', 'claudeCode');
    ready = true;
    showKeyForm(false);
    els.input.focus();
  } catch (err) {
    els.keyErr.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '沿用本機 Claude Code 登入';
  }
});
els.key.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });

// ---- 載入 ----
async function load(data) {
  if (!data || !data.name) return;
  document.body.dataset.theme = data.theme === 'light' ? 'light' : 'dark';
  const changed = data.name !== name;
  name = data.name;
  const state = await window.agents.call('state');
  ready = state.ready;
  role = state.roles.find((r) => r.name === name) || null;
  if (!role) { window.popup.close(); return; }
  renderHeader();
  if (changed) {
    els.confirm.hidden = true;
    els.input.value = '';
    autoSize();
    renderHistory(await window.agents.call('history', name));
  }
  showKeyForm(!ready);
  if (ready) els.input.focus();
}

window.agents.onEvent(onEvent);
window.agents.onChanged((state) => {
  ready = state.ready;
  const r = state.roles.find((x) => x.name === name);
  if (!r) {
    // 角色被移除或改名
    const renamed = state.roles.find((x) => x.open);
    if (renamed) { name = renamed.name; role = renamed; renderHeader(); return; }
    window.popup.close();
    return;
  }
  role = r;
  renderHeader();
  if (els.keyform.hidden !== ready) showKeyForm(!ready);
});
window.popup.onData(load);
window.popup.getData().then(load);
updateSend();
