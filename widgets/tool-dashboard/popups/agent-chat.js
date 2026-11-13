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
  term: '<svg class="icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
  ask: '<svg class="icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/></svg>'
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
  renderAutoApprove();
}

/** 「不要再詢問」：背景改暗紅色並顯示標籤，空白對話的說明一併更新 */
function renderAutoApprove() {
  const on = !!(role && role.autoApprove);
  document.body.classList.toggle('auto-approve', on);
  $('auto-chip').hidden = !on;
  const empty = els.messages.querySelector('.empty');
  if (empty) { empty.remove(); showEmpty(); }
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
  els.messages.innerHTML = `<div class="empty">${m.svg(color, 56)}<div>${role ? esc(role.displayName) : ''}準備好了<br>${role && role.autoApprove ? '已開啟免詢問，修改檔案、執行指令不會先問你' : '可以修改檔案、執行指令，動手前會先問你'}</div></div>`;
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

function addHandoff(from, text) {
  clearEmpty();
  const div = document.createElement('div');
  div.className = 'msg-handoff';
  const label = document.createElement('div');
  label.className = 'handoff-from';
  label.textContent = `來自「${from}」的轉派`;
  const body = document.createElement('div');
  body.textContent = text;
  div.append(label, body);
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

const OTHER = '\u0000other'; // 「其他」選項的內部值，不會與選項文字重複

/** AskUserQuestion：每題可單選或複選，另有「其他」自填；全部回答後才能送出 */
function addQuestion(q) {
  clearEmpty();
  const card = document.createElement('div');
  card.className = 'perm ask';
  card.dataset.id = q.id;
  card.setAttribute('role', 'alert');
  const questions = Array.isArray(q.questions) ? q.questions : [];
  /** 每題已選的值（選項文字或 OTHER） */
  const picked = questions.map(() => new Set());

  card.innerHTML = `
    <div class="perm-title">${ICON.ask}<span>想請你回答</span></div>
    ${questions.map((item, qi) => `
      <fieldset class="ask-q" data-q="${qi}">
        <legend>${item.header ? `<span class="ask-tag">${esc(item.header)}</span>` : ''}<span>${esc(item.question)}</span>${item.multiSelect ? '<span class="ask-hint">可複選</span>' : ''}</legend>
        <div class="ask-opts">
          ${item.options.map((o, oi) => `
            <button type="button" class="ask-opt" data-o="${oi}" aria-pressed="false">
              <span class="ask-label">${esc(o.label)}</span>
              ${o.description ? `<span class="ask-desc">${esc(o.description)}</span>` : ''}
            </button>`).join('')}
          <button type="button" class="ask-opt" data-o="other" aria-pressed="false"><span class="ask-label">其他</span></button>
        </div>
        <input class="ask-other" type="text" maxlength="2000" placeholder="輸入你的回答" aria-label="其他：${esc(item.question)}" hidden>
        <pre class="mono ask-preview" hidden></pre>
      </fieldset>`).join('')}
    <div class="perm-actions">
      <button class="btn primary" data-d="answer" disabled>送出</button>
      <button class="btn" data-d="skip">略過</button>
    </div>`;

  const submit = card.querySelector('[data-d="answer"]');

  /** 題目文字 → 答案；有題目沒回答時回傳 null */
  function collect() {
    const out = {};
    for (const [qi, item] of questions.entries()) {
      const box = card.querySelector(`.ask-q[data-q="${qi}"]`);
      const other = box.querySelector('.ask-other').value.trim();
      const values = item.options.filter((o) => picked[qi].has(o.label)).map((o) => o.label);
      if (picked[qi].has(OTHER) && other) values.push(other);
      if (!values.length) return null;
      out[item.question] = values.join(', ');
    }
    return out;
  }

  function refresh() {
    submit.disabled = !questions.length || !collect();
  }

  card.querySelectorAll('.ask-q').forEach((box) => {
    const qi = Number(box.dataset.q);
    const item = questions[qi];
    const otherInput = box.querySelector('.ask-other');
    const preview = box.querySelector('.ask-preview');
    box.querySelectorAll('.ask-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isOther = btn.dataset.o === 'other';
        const opt = isOther ? null : item.options[Number(btn.dataset.o)];
        const value = isOther ? OTHER : opt.label;
        const set = picked[qi];
        if (item.multiSelect) {
          if (set.has(value)) set.delete(value); else set.add(value);
        } else {
          set.clear();
          set.add(value);
        }
        box.querySelectorAll('.ask-opt').forEach((b) => {
          const v = b.dataset.o === 'other' ? OTHER : item.options[Number(b.dataset.o)].label;
          b.setAttribute('aria-pressed', String(set.has(v)));
        });
        otherInput.hidden = !set.has(OTHER);
        if (isOther && !otherInput.hidden) otherInput.focus();
        // 顯示最後點選且仍被選取的選項預覽
        const shown = opt && set.has(value) && opt.preview;
        preview.hidden = !shown;
        preview.textContent = shown ? opt.preview : '';
        refresh();
      });
    });
    otherInput.addEventListener('input', refresh);
    otherInput.addEventListener('keydown', (e) => {
      // 輸入法組字中按 Enter 是選字，不送出
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !submit.disabled) {
        e.preventDefault();
        submit.click();
      }
    });
  });

  card.querySelectorAll('button[data-d]').forEach((b) => {
    b.addEventListener('click', async () => {
      const decision = b.dataset.d;
      const answers = decision === 'answer' ? collect() : undefined;
      if (decision === 'answer' && !answers) return;
      card.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
      const ok = await window.agents.call('answer', name, q.id, decision, answers);
      // 沒被接受（例如答案不完整）就讓使用者繼續操作；成功時卡片由 permission_done 移除
      if (!ok && card.isConnected) {
        card.querySelectorAll('button, input').forEach((x) => { x.disabled = false; });
        refresh();
      }
    });
  });

  els.messages.appendChild(card);
  // 略過預設取得焦點，避免誤按 Enter 就送出
  if (document.hasFocus()) card.querySelector('[data-d="skip"]').focus({ preventScroll: true });
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
    else if (it.role === 'handoff') addHandoff(it.from, it.text);
    else if (it.role === 'assistant') {
      const el = aiBubble(it.text, !!it.streaming);
      if (it.streaming) { streamEl = el; streamText = it.text; }
    } else if (it.role === 'tool') addTool(it);
    else if (it.role === 'permission') addPermission(it);
    else if (it.role === 'question') addQuestion(it);
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
    // 排程開了新對話：清空畫面，接著送出的訊息才不會接在舊對話後面
    case 'cleared':
      cancelAnimationFrame(streamFrame); streamFrame = 0;
      els.messages.textContent = '';
      streamEl = null;
      streamText = '';
      setCost(null);
      showEmpty();
      break;
    case 'user': addUser(ev.text); stickToBottom = true; break;
    case 'handoff': endStream(); addHandoff(ev.from, ev.text); stickToBottom = true; break;
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
    case 'question': endStream(); addQuestion(ev); break;
    case 'permission_done': {
      // 工具核准與題目卡片都用 .perm，一起處理
      const card = els.messages.querySelector(`.perm[data-id="${CSS.escape(ev.id)}"]`);
      if (card) card.remove();
      break;
    }
    case 'ready': setModel(ev.model); break;
    // 對話啟動或中途發現新的 skill：主程序推送完整清單，直接取代
    case 'commands':
      commands = Array.isArray(ev.commands) ? ev.commands : [];
      commandsError = '';
      commandsJob = null;
      if (!cmdMenu.hidden) renderCmdMenu();
      return; // 不影響對話內容與捲動位置
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
  hideCmdMenu();
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

// ---- 斜線指令選單：輸入框以 / 開頭、還沒輸入空白時顯示 ----
const cmdMenu = $('cmd-menu');
const CMD_LIMIT = 50;   // 最多顯示幾項，避免一次建立太多元素
let commands = null;    // null：尚未載入
let commandsError = '';
let commandsJob = null; // 進行中的載入（記住是哪個角色，切換角色後舊結果不採用）
let cmdMatches = [];
let cmdIndex = 0;

function loadCommands(refresh = false) {
  if (!name || !ready) return;
  if (commandsJob && commandsJob.name === name && !refresh) return;
  const forName = name;
  const job = { name: forName };
  commandsJob = job;
  commandsError = '';
  window.agents.call('commands', forName, refresh).then((list) => {
    if (commandsJob !== job) return;
    commands = Array.isArray(list) ? list : [];
  }).catch((err) => {
    if (commandsJob !== job) return;
    commandsError = err.message || '無法讀取指令清單';
  }).finally(() => {
    if (commandsJob !== job) return;
    commandsJob = null;
    renderCmdMenu();
  });
}

function resetCommands() {
  commands = null;
  commandsError = '';
  commandsJob = null;
  hideCmdMenu();
}

/** 目前要搜尋的文字；不在指令輸入狀態時回傳 null */
function cmdQuery() {
  const v = els.input.value;
  return v.startsWith('/') && !/\s/.test(v) ? v.slice(1).toLowerCase() : null;
}

/** 名稱開頭符合的排前面，其次是名稱包含，最後是說明包含；同一組內維持原本順序（自訂在前、內建在後） */
function matchCommands(q) {
  if (!q) return commands.slice();
  const starts = [];
  const has = [];
  const desc = [];
  for (const c of commands) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) starts.push(c);
    else if (n.includes(q)) has.push(c);
    else if (c.description.toLowerCase().includes(q)) desc.push(c);
  }
  return starts.concat(has, desc);
}

function hideCmdMenu() {
  cmdMenu.hidden = true;
  cmdMenu.textContent = '';
  cmdMatches = [];
  els.input.removeAttribute('aria-activedescendant');
  els.input.setAttribute('aria-expanded', 'false');
}

function cmdNote(text) {
  cmdMenu.innerHTML = `<div class="cmd-empty">${esc(text)}</div>`;
  cmdMatches = [];
  els.input.removeAttribute('aria-activedescendant');
}

function renderCmdMenu() {
  const q = cmdQuery();
  if (q === null || !ready || !els.keyform.hidden) { hideCmdMenu(); return; }
  cmdMenu.hidden = false;
  els.input.setAttribute('aria-expanded', 'true');
  if (commands === null) {
    if (commandsError) cmdNote(`無法讀取指令清單：${commandsError}`);
    else { cmdNote('正在讀取可用的指令…'); loadCommands(); }
    return;
  }
  cmdMatches = matchCommands(q).slice(0, CMD_LIMIT);
  if (!cmdMatches.length) { cmdNote(commands.length ? '沒有符合的指令' : '沒有可用的指令'); return; }
  cmdIndex = Math.min(cmdIndex, cmdMatches.length - 1);
  cmdMenu.innerHTML = cmdMatches.map((c, i) => `
    <div class="cmd-item" role="option" id="cmd-${i}" data-i="${i}" aria-selected="${i === cmdIndex}">
      <div class="cmd-top">
        <span class="cmd-name">/${esc(c.name)}</span>
        ${c.argumentHint ? `<span class="cmd-hint">${esc(c.argumentHint)}</span>` : ''}
        ${c.builtin ? '<span class="cmd-tag">內建</span>' : ''}
      </div>
      ${c.description ? `<div class="cmd-desc">${esc(c.description)}</div>` : ''}
    </div>`).join('');
  markCmd();
}

function markCmd() {
  cmdMenu.querySelectorAll('.cmd-item').forEach((el, i) => el.setAttribute('aria-selected', String(i === cmdIndex)));
  const cur = $(`cmd-${cmdIndex}`);
  if (cur) {
    els.input.setAttribute('aria-activedescendant', cur.id);
    cur.scrollIntoView({ block: 'nearest' });
  }
}

/** 選取後只填入輸入框，由使用者補上參數再送出 */
function pickCmd(c) {
  els.input.value = `/${c.name} `;
  els.input.selectionStart = els.input.selectionEnd = els.input.value.length;
  hideCmdMenu();
  els.input.focus();
  autoSize();
  updateSend();
}

/** 選單開著時處理方向鍵、Enter、Tab、Esc；有處理就回傳 true */
function handleCmdKey(e) {
  if (cmdMenu.hidden || e.isComposing || e.keyCode === 229) return false;
  if (e.key === 'Escape') {
    // 只關閉選單，不要讓視窗的 Esc 關閉整個視窗
    e.preventDefault();
    e.stopPropagation();
    hideCmdMenu();
    return true;
  }
  if (!cmdMatches.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = cmdMatches.length;
    cmdIndex = (cmdIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    markCmd();
    return true;
  }
  if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    pickCmd(cmdMatches[cmdIndex]);
    return true;
  }
  return false;
}

// mousedown 先處理並阻止預設行為，輸入框才不會失去焦點
cmdMenu.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const item = e.target.closest('.cmd-item');
  if (item) pickCmd(cmdMatches[Number(item.dataset.i)]);
});
cmdMenu.addEventListener('mousemove', (e) => {
  const item = e.target.closest('.cmd-item');
  if (item && Number(item.dataset.i) !== cmdIndex) { cmdIndex = Number(item.dataset.i); markCmd(); }
});
els.input.setAttribute('aria-autocomplete', 'list');
els.input.setAttribute('aria-controls', 'cmd-menu');
els.input.addEventListener('blur', hideCmdMenu);

els.input.addEventListener('input', () => {
  autoSize();
  updateSend();
  cmdIndex = 0;
  renderCmdMenu();
});
els.input.addEventListener('keydown', (e) => {
  if (handleCmdKey(e)) return;
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
// Ctrl + Shift + A（macOS 為 ⌘ + Shift + A）切換「不要再詢問」
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
$('auto-key').textContent = IS_MAC ? '⌘ + Shift + A' : 'Ctrl + Shift + A';
window.addEventListener('keydown', async (e) => {
  if (e.code !== 'KeyA' || !e.shiftKey || e.altKey || !(IS_MAC ? e.metaKey : e.ctrlKey) || e.repeat) return;
  e.preventDefault();
  if (!role) return;
  try {
    await window.agents.call('setAutoApprove', name, !role.autoApprove); // 結果經由 onChanged 更新畫面
  } catch (err) {
    addError(err.message);
  }
});
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
    resetCommands();
    renderHistory(await window.agents.call('history', name));
  }
  showKeyForm(!ready);
  if (ready) {
    els.input.focus();
    loadCommands(); // 先在背景載入，輸入 / 時通常已經好了；主程序有快取，不會每次都啟動程序
  }
}

window.agents.onEvent(onEvent);
window.agents.onChanged((state) => {
  ready = state.ready;
  const r = state.roles.find((x) => x.name === name);
  if (!r) {
    // 角色被移除或改名
    const renamed = state.roles.find((x) => x.open);
    if (renamed) { name = renamed.name; role = renamed; resetCommands(); renderHeader(); return; }
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
