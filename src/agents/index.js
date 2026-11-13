// Claude Code 角色：儀表盤的角色面板、快速聊天與角色編輯
// - 角色本體是 ~/.claude/agents/<name>.md 子代理（終端機的 Claude Code 也讀得到）
// - 面板資訊（顯示名稱、吉祥物、工作資料夾、順序）存在 <設定資料夾>/agents.json
// - 每個角色各自一個對話 session，對話紀錄存在 <設定資料夾>/agent-chats/<name>.json
const fs = require('fs');
const path = require('path');
const files = require('./agent-files');
const { AgentSession } = require('./session');
const { createKeyStore, looksLikeKey } = require('./api-key');
const {
  planUsage: fetchPlanUsage, loadToolKit: defaultLoadToolKit, localAuthLogin: defaultLocalAuthLogin,
  listCommands: defaultListCommands, normalizeCommands
} = require('./runtime');
const { HANDOFF_TOOL, routingPrompt, handoffMessage, createHandoffs, handoffServer } = require('./handoff');
const { isDue, normalizeSchedule, startScheduler, localDate } = require('./schedule');

const AUTH_MODES = ['apiKey', 'claudeCode'];
const MAX_HISTORY = 300;
const MASCOTS = ['blob', 'robot', 'cat', 'ghost', 'drop', 'cloud', 'owl', 'bear'];

/** 「可用工具」選項與 Claude Code 工具名稱的對應 */
const TOOL_GROUPS = {
  read: ['Read'],
  search: ['Grep', 'Glob'],
  edit: ['Edit', 'Write', 'NotebookEdit'],
  bash: ['Bash'],
  web: ['WebSearch', 'WebFetch']
};

/** 等待使用者處理的卡片（工具核准、AskUserQuestion）：程序結束後無法再回應，不保存也不顯示 */
function isPendingCard(item) {
  return item.role === 'permission' || item.role === 'question';
}

function hashPick(str, list) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** 工具清單 → 勾選的群組（null 代表全部） */
function toolsToGroups(tools) {
  if (!tools) return { groups: Object.keys(TOOL_GROUPS), extra: [] };
  const set = new Set(tools);
  const groups = Object.keys(TOOL_GROUPS).filter((g) => TOOL_GROUPS[g].some((t) => set.has(t)));
  const known = new Set(Object.values(TOOL_GROUPS).flat());
  return { groups, extra: tools.filter((t) => !known.has(t)) };
}

function groupsToTools(groups, extra = []) {
  const all = Object.keys(TOOL_GROUPS);
  if (all.every((g) => groups.includes(g)) && !extra.length) return null; // 全選 = 繼承全部工具（含 MCP、子代理…）
  return [...groups.flatMap((g) => TOOL_GROUPS[g] || []), ...extra];
}

function setupAgents(deps) {
  const {
    ipcMain, userDataDir, homeDir, safeStorage, fetch, trash, pickFolder,
    openPopup, isAllowedSender, broadcast, loadQuery, loadToolKit = defaultLoadToolKit, buildQueryOptions = () => ({}),
    getTheme = () => 'dark', openPath = async () => {}, powerMonitor = null,
    localAuthStatus = async () => ({ ok: false, loggedIn: false, error: '無法檢查' }),
    localAuthLogin = defaultLocalAuthLogin,
    listCommands = defaultListCommands
  } = deps;
  const agentsDir = files.agentsDir(homeDir);
  const panelFile = path.join(userDataDir, 'agents.json');
  const chatsDir = path.join(userDataDir, 'agent-chats');
  // 保留原名的角色可能含 / 等不能當檔名的字元，編碼後才不會寫到其他路徑
  const chatFile = (name) => path.join(chatsDir, `${String(name).replace(/[\\/:*?"<>|%]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}.json`);
  const keys = createKeyStore({ dir: userDataDir, safeStorage, fetch });
  let localAuthFailed = false; // 聊天時遇到本機登入失效（只存在記憶體）
  let localLogin = null; // 進行中的本機登入：{ ctl, url, done }

  // ---- 面板資料 ----
  // authMode：'apiKey'（預設）或 'claudeCode'（沿用本機 Claude Code 的登入）
  // handoffs：還沒送達的轉派工作
  let panel = { roles: [], sessions: {}, authMode: 'apiKey', handoffs: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(panelFile, 'utf8'));
    panel = {
      roles: Array.isArray(raw.roles) ? raw.roles : [],
      sessions: raw.sessions || {},
      authMode: AUTH_MODES.includes(raw.authMode) ? raw.authMode : 'apiKey',
      handoffs: Array.isArray(raw.handoffs) ? raw.handoffs : []
    };
  } catch { /* 第一次使用 */ }

  function savePanel() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(`${panelFile}.tmp`, JSON.stringify(panel, null, 2), 'utf8');
      fs.renameSync(`${panelFile}.tmp`, panelFile);
    } catch (err) {
      console.error('儲存角色面板失敗', err);
    }
  }

  let defs = new Map(); // name → 子代理定義
  function reloadDefs() {
    defs = new Map(files.readAll(agentsDir).map((d) => [d.name, d]));
    // 檔案被刪掉的角色從面板移除
    const before = panel.roles.length;
    panel.roles = panel.roles.filter((r) => defs.has(r.name));
    if (panel.roles.length !== before) savePanel();
  }
  reloadDefs();

  // ---- 對話 ----
  const sessions = new Map();   // name → AgentSession
  const histories = new Map();  // name → { items, cost, model }
  let chatOpenFor = null;       // 聊天視窗目前顯示的角色
  let disposed = false;

  function isBusy(name) {
    const s = sessions.get(name);
    return !!s && (s.state !== 'idle' || !!s.starting);
  }

  const handoffs = createHandoffs({
    roles: () => panel.roles.map((r) => ({ name: r.name, displayName: r.displayName || r.name })),
    queue: panel.handoffs,
    save: savePanel,
    canDeliver: (name) => !disposed && canChat() && !isBusy(name),
    deliver: async (item) => {
      historyOf(item.to).items.push({ role: 'handoff', from: item.fromDisplay, text: item.task });
      saveHistory(item.to);
      broadcast('agents:event', { name: item.to, event: { type: 'handoff', from: item.fromDisplay, text: item.task } });
      try {
        await sessionFor(item.to).send(handoffMessage(item));
      } catch (err) {
        onEvent(item.to, { type: 'error', message: String((err && err.message) || err).slice(0, 300) });
      }
    },
    reportDropped: (from, message) => onEvent(from, { type: 'error', message })
  });

  /**
   * 每次啟動程序時重新產生，新增或改名的角色才會出現。
   * 分工規則放在 MCP instructions：resume 會沿用舊的系統提示，附加在角色說明裡對既有對話無效（SDK 0.3.318 實測）。
   */
  async function handoffServers(name) {
    const views = panel.roles.map((r) => ({
      name: r.name,
      displayName: r.displayName || r.name,
      description: defs.get(r.name)?.description || ''
    }));
    const routing = routingPrompt(views.find((r) => r.name === name), views.filter((r) => r.name !== name));
    return { 'role-handoff': handoffServer(await loadToolKit(), name, handoffs, routing) };
  }

  function historyOf(name) {
    if (!histories.has(name)) {
      let h = { items: [], cost: null, model: null };
      try { h = { ...h, ...JSON.parse(fs.readFileSync(chatFile(name), 'utf8')) }; } catch { /* 沒有紀錄 */ }
      h.items = h.items.filter((i) => !isPendingCard(i));
      histories.set(name, h);
    }
    return histories.get(name);
  }

  function saveHistory(name) {
    const h = histories.get(name);
    if (!h) return;
    try {
      fs.mkdirSync(chatsDir, { recursive: true });
      const items = h.items.filter((i) => !isPendingCard(i) && !i.streaming).slice(-MAX_HISTORY);
      fs.writeFileSync(chatFile(name), JSON.stringify({ items, cost: h.cost, model: h.model }), 'utf8');
    } catch (err) {
      console.error('儲存對話紀錄失敗', err);
    }
  }

  // ---- 斜線指令（聊天視窗輸入 / 時的選單） ----
  const COMMANDS_TTL_MS = 60 * 1000; // 沒有執行中的程序時，快取多久後重新讀取（skill 檔案可能被新增或修改）
  const commandCache = new Map();    // name → { cwd, at, list }
  const commandQueries = new Map();  // name → 進行中的讀取

  function roleCwd(name) {
    const role = panel.roles.find((r) => r.name === name);
    return role && role.cwd && fs.existsSync(role.cwd) ? role.cwd : homeDir;
  }

  function setCommands(name, raw, { push = true } = {}) {
    const s = sessions.get(name);
    const list = normalizeCommands(raw, s ? s.terminalCommands : []);
    commandCache.set(name, { cwd: roleCwd(name), at: Date.now(), list });
    if (push) broadcast('agents:event', { name, event: { type: 'commands', commands: list } });
    return list;
  }

  /** 正式對話啟動後改向它讀取，清單才會包含這個角色專用的 MCP 指令，並套用終端機指令的過濾 */
  async function refreshFromSession(name) {
    const s = sessions.get(name);
    const raw = s ? await s.commands() : null;
    if (raw && sessions.get(name) === s) setCommands(name, raw);
  }

  async function commandsFor(name, { refresh = false } = {}) {
    if (!panel.roles.some((r) => r.name === name)) throw new Error('找不到這個角色');
    if (!canChat()) return [];
    const cwd = roleCwd(name);
    const cached = commandCache.get(name);
    const s = sessions.get(name);
    const fresh = cached && cached.cwd === cwd && (s ? !!s.query : Date.now() - cached.at < COMMANDS_TTL_MS);
    if (fresh && !refresh) return cached.list;
    if (commandQueries.has(name)) return commandQueries.get(name);
    const job = (async () => {
      const raw = s ? await s.commands() : null;
      if (raw) return setCommands(name, raw, { push: false });
      const list = await listCommands({ loadQuery, options: buildQueryOptions({ mode: panel.authMode, apiKey: keys.get() }), cwd });
      commandCache.set(name, { cwd, at: Date.now(), list });
      return list;
    })().finally(() => { commandQueries.delete(name); });
    commandQueries.set(name, job);
    return job;
  }

  /** session 事件 → 更新紀錄並轉送聊天視窗 */
  function onEvent(name, ev) {
    if (ev.type === 'commands_raw') {
      setCommands(name, ev.commands);
      return;
    }
    if (ev.type === 'ready') refreshFromSession(name).catch(() => {});
    if (ev.type === 'error' || (ev.type === 'result' && ev.isError)) {
      // 聊天時遇到本機登入失效：記在記憶體，設定頁據此顯示「登入 Claude」
      if (panel.authMode === 'claudeCode' && isLoginError(ev.message) && !localAuthFailed) {
        localAuthFailed = true;
        setImmediate(broadcastState);
      }
      ev = { ...ev, message: authHint(ev.message) };
    }
    const h = historyOf(name);
    const last = h.items[h.items.length - 1];
    // API 錯誤會先後以 error 與 result 各傳一次，同樣的訊息只顯示一次
    if (ev.type === 'result' && ev.isError && last && last.role === 'error' && last.text === ev.message) ev = { ...ev, message: '' };
    switch (ev.type) {
      case 'delta':
        if (last && last.role === 'assistant' && last.streaming) last.text += ev.text;
        else h.items.push({ role: 'assistant', text: ev.text, streaming: true });
        break;
      case 'assistant':
        if (last && last.role === 'assistant' && last.streaming) { last.text = ev.text; delete last.streaming; }
        else h.items.push({ role: 'assistant', text: ev.text });
        break;
      case 'tool':
        h.items.push({ role: 'tool', id: ev.id, verb: ev.verb, detail: ev.detail, status: 'running' });
        break;
      case 'tool_done': {
        const t = h.items.find((i) => i.role === 'tool' && i.id === ev.id);
        if (t) t.status = ev.isError ? 'error' : 'done';
        break;
      }
      case 'permission':
        h.items.push({ role: 'permission', id: ev.id, title: ev.title, code: ev.code, note: ev.note, allowSession: ev.allowSession });
        break;
      case 'question':
        h.items.push({ role: 'question', id: ev.id, questions: ev.questions });
        break;
      case 'permission_done': {
        const i = h.items.findIndex((x) => isPendingCard(x) && x.id === ev.id);
        if (i >= 0) h.items.splice(i, 1);
        break;
      }
      case 'ready':
        h.model = ev.model || h.model;
        break;
      case 'session':
        panel.sessions[name] = ev.sessionId;
        savePanel();
        break;
      case 'result':
        if (last && last.streaming) delete last.streaming;
        if (ev.cost != null) h.cost = ev.cost;
        if (ev.isError && ev.message) h.items.push({ role: 'error', text: ev.message });
        for (const t of h.items) if (t.role === 'tool' && t.status === 'running') t.status = 'done';
        saveHistory(name);
        break;
      case 'error':
        h.items.push({ role: 'error', text: ev.message });
        saveHistory(name);
        break;
      case 'state':
        broadcastState();
        // 等呼叫端做完（例如關閉對話後從 sessions 移除）再送，才不會送進已關閉的 session
        if (ev.state === 'idle') setImmediate(() => handoffs.drain(name));
        break;
      default:
        break;
    }
    broadcast('agents:event', { name, event: ev, cost: h.cost, model: h.model });
  }

  function sessionFor(name) {
    if (sessions.has(name)) return sessions.get(name);
    const def = defs.get(name);
    const role = panel.roles.find((r) => r.name === name);
    if (!def || !role) throw new Error('找不到這個角色');
    const s = new AgentSession({
      name,
      definition: {
        ...files.sdkExtras(def),
        description: def.description,
        prompt: def.prompt,
        // 限定工具的角色也要看得到轉派工具（只在執行時加入，不寫回子代理檔案）
        ...(def.tools ? { tools: [...def.tools, HANDOFF_TOOL] } : {}),
        ...(def.model ? { model: def.model } : {})
      },
      mcpServers: () => handoffServers(name),
      cwd: role.cwd && fs.existsSync(role.cwd) ? role.cwd : homeDir,
      resume: panel.sessions[name] || null,
      loadQuery,
      buildOptions: () => buildQueryOptions({ mode: panel.authMode, apiKey: keys.get() }),
      emit: (ev) => onEvent(name, ev),
      // 每次核准時重新查，切換後不必重開對話
      isAutoApprove: () => !!panel.roles.find((r) => r.name === name)?.autoApprove
    });
    sessions.set(name, s);
    return s;
  }

  function closeSession(name) {
    const s = sessions.get(name);
    if (s) { s.close(); sessions.delete(name); }
  }

  // ---- 狀態 ----
  function roleView(r) {
    const d = defs.get(r.name) || {};
    const s = sessions.get(r.name);
    return {
      name: r.name,
      displayName: r.displayName || r.name,
      mascot: MASCOTS.includes(r.mascot) ? r.mascot : hashPick(r.name, MASCOTS),
      color: d.color || hashPick(r.name, files.COLORS),
      cwd: r.cwd || '',
      imported: !!r.imported,
      model: d.model || null,
      state: s ? s.state : 'idle',
      autoApprove: !!r.autoApprove,
      open: chatOpenFor === r.name
    };
  }

  function stateView() {
    return {
      roles: panel.roles.map(roleView),
      hasKey: !!keys.get(),
      authMode: panel.authMode,
      ready: canChat(),
      existing: [...defs.keys()].filter((n) => !panel.roles.some((r) => r.name === n)),
      agentsDir,
      localAuthFailed,
      localLogin: localLogin ? { running: true, url: localLogin.url } : { running: false }
    };
  }

  function canChat() {
    return panel.authMode === 'claudeCode' || !!keys.get();
  }

  function isLoginError(message) {
    return /not logged in|please run \/login|login expired|authentication_error|OAuth token|API Key 無效/i.test(String(message || ''));
  }

  /** 錯誤訊息依登入方式補上該怎麼處理 */
  function authHint(message) {
    const m = String(message || '');
    if (panel.authMode === 'claudeCode') {
      if (isLoginError(m)) {
        return '本機的 Claude Code 尚未登入或登入已過期。請到「設定 → 一般 → Claude 角色」按「登入 Claude」，或在終端機執行 claude 並完成登入，也可以改用 API Key。';
      }
      if (/usage limit|rate.?limit|額度|太頻繁/i.test(m)) return `${m}（使用的是你 Claude 方案的額度）`;
      return m;
    }
    if (/credit balance is too low|餘額不足/i.test(m)) {
      return 'API 帳戶餘額不足：請到 Claude Console（platform.claude.com）的 Settings → Billing 儲值，或到「設定 → Claude 角色」改用本機 Claude Code 登入。';
    }
    return m;
  }

  function broadcastState() {
    broadcast('agents:changed', stateView());
  }

  const stopWatch = files.watch(agentsDir, () => {
    const before = JSON.stringify([...defs.values()].map((d) => [d.name, d.description, d.prompt, d.tools, d.model, d.color]));
    reloadDefs();
    const after = JSON.stringify([...defs.values()].map((d) => [d.name, d.description, d.prompt, d.tools, d.model, d.color]));
    if (before !== after) {
      // 定義改了：關閉程序，下次傳訊息用新定義接續
      for (const [name, s] of sessions) if (s.state === 'idle') { s.close(); sessions.delete(name); }
      broadcastState();
      handoffs.drainAll(); // 檔案被刪掉的角色，它的佇列要清掉
    }
  });

  // ---- 本機 Claude Code 登入 ----
  async function startLocalLogin() {
    if (panel.authMode !== 'claudeCode') throw new Error('目前不是使用本機 Claude Code 登入');
    if (localLogin) return localLogin.done; // 同時間只有一個登入流程
    // Claude Console 帳號沿用同一種登入方式；查不到時用預設的 Claude 訂閱帳號
    let status = null;
    try { status = await localAuthStatus(); } catch { /* 查不到就用預設 */ }
    if (localLogin) return localLogin.done;
    const entry = { ctl: null, url: null, done: null };
    entry.ctl = localAuthLogin({
      console: !!status && status.rawMethod === 'oauth_api_key',
      onUpdate: ({ url }) => { entry.url = url; broadcastState(); }
    });
    entry.done = entry.ctl.done.then((r) => {
      localLogin = null;
      if (r.ok) {
        localAuthFailed = false;
        // 閒置的程序換新登入重新啟動，下次傳訊息時接續；回覆中的不中斷
        for (const [name, s] of sessions) if (s.state === 'idle') { s.close(); sessions.delete(name); }
        handoffs.drainAll();
      }
      broadcastState();
      return r;
    });
    localLogin = entry;
    broadcastState();
    return entry.done;
  }

  // ---- 呼叫 ----
  let usageQuery = null; // 進行中的方案使用量查詢
  const api = {
    state: () => stateView(),

    getRole(name) {
      const r = panel.roles.find((x) => x.name === name);
      const d = defs.get(name);
      if (!r || !d) return null;
      const { groups, extra } = toolsToGroups(d.tools);
      return {
        ...roleView(r),
        description: d.description,
        prompt: d.prompt,
        model: d.model || '',
        toolGroups: groups,
        extraTools: extra,
        file: d.file,
        schedule: r.schedule || null
      };
    },

    async saveRole(p = {}) {
      const oldName = p.oldName || null;
      const isNew = !oldName;
      const prev = oldName ? defs.get(oldName) : null;
      // 從現有子代理加入的角色一律保留原檔名與 name，不採用傳入的代號
      const prevRole = oldName ? panel.roles.find((r) => r.name === oldName) : null;
      const imported = !!prevRole?.imported;
      // 先驗證排程，格式不對時不要寫入子代理檔案；沒傳入時沿用原本的設定
      const schedule = p.schedule === undefined
        ? prevRole?.schedule || null
        : normalizeSchedule(p.schedule, prevRole?.schedule || null, new Date());
      const tools = groupsToTools(Array.isArray(p.toolGroups) ? p.toolGroups : [], Array.isArray(p.extraTools) ? p.extraTools : []);
      const def = {
        name: imported ? oldName : String(p.name || '').trim(),
        description: String(p.description || '').trim(),
        prompt: String(p.prompt || '').trim(),
        tools,
        model: p.model ? String(p.model) : null,
        color: files.COLORS.includes(p.color) ? p.color : null,
        extra: prev ? prev.extra : []
      };
      const file = await files.save(agentsDir, def, { oldName, trash, keepName: imported });
      const meta = {
        name: def.name,
        displayName: String(p.displayName || '').trim() || def.name,
        mascot: MASCOTS.includes(p.mascot) ? p.mascot : hashPick(def.name, MASCOTS),
        cwd: String(p.cwd || '').trim(),
        ...(imported ? { imported: true } : {}),
        // 沒傳入時沿用原本的設定
        ...((p.autoApprove === undefined ? prevRole?.autoApprove : p.autoApprove) ? { autoApprove: true } : {}),
        ...(schedule ? { schedule } : {})
      };
      if (isNew) {
        panel.roles.push(meta);
      } else {
        const i = panel.roles.findIndex((r) => r.name === oldName);
        if (i >= 0) panel.roles[i] = meta;
        if (oldName !== def.name) {
          handoffs.rename(oldName, def.name);
          panel.sessions[def.name] = panel.sessions[oldName];
          delete panel.sessions[oldName];
          const h = histories.get(oldName);
          if (h) { histories.set(def.name, h); histories.delete(oldName); }
          try { fs.renameSync(chatFile(oldName), chatFile(def.name)); } catch { /* 沒有紀錄 */ }
          if (chatOpenFor === oldName) chatOpenFor = def.name;
        }
        closeSession(oldName); // 下次傳訊息用新設定
      }
      savePanel();
      reloadDefs();
      broadcastState();
      handoffs.drainAll(); // 改代號時關閉的是舊名稱的 session，佇列要用新名稱再送一次
      return { name: def.name, file };
    },

    addExisting(name) {
      if (!defs.has(name)) throw new Error('找不到這個子代理');
      if (!panel.roles.some((r) => r.name === name)) {
        panel.roles.push({ name, displayName: name, mascot: hashPick(name, MASCOTS), cwd: '', imported: true });
        savePanel();
        broadcastState();
      }
      return true;
    },

    async removeRole(name) {
      closeSession(name);
      // 從現有子代理加入的角色只從面板移除，檔案留在子代理資料夾
      const imported = !!panel.roles.find((r) => r.name === name)?.imported;
      if (!imported) await files.remove(agentsDir, name, { trash });
      panel.roles = panel.roles.filter((r) => r.name !== name);
      delete panel.sessions[name];
      histories.delete(name);
      try { fs.unlinkSync(chatFile(name)); } catch { /* 沒有紀錄 */ }
      handoffs.resetChain(name);
      savePanel();
      reloadDefs();
      broadcastState();
      handoffs.drainAll(); // 轉派給這個角色、還沒送達的工作要取消
      return true;
    },

    reorder(names = []) {
      const byName = new Map(panel.roles.map((r) => [r.name, r]));
      const next = names.filter((n) => byName.has(n)).map((n) => byName.get(n));
      for (const r of panel.roles) if (!next.includes(r)) next.push(r);
      panel.roles = next;
      savePanel();
      broadcastState();
      return true;
    },

    history(name) {
      const h = historyOf(name);
      const s = sessions.get(name);
      const items = s ? h.items : h.items.filter((i) => !isPendingCard(i));
      return { items, cost: h.cost, model: h.model, state: s ? s.state : 'idle' };
    },

    async send(name, text) {
      if (!canChat()) throw new Error('請先設定 API Key，或改用本機 Claude Code 登入');
      const t = String(text || '').trim();
      if (!t) return false;
      handoffs.resetChain(name); // 使用者直接交辦的是新工作，轉派鏈重新計算
      historyOf(name).items.push({ role: 'user', text: t });
      broadcast('agents:event', { name, event: { type: 'user', text: t } });
      try {
        await sessionFor(name).send(t);
      } catch (err) {
        onEvent(name, { type: 'error', message: String((err && err.message) || err).slice(0, 300) });
      }
      return true;
    },

    async stop(name) {
      const s = sessions.get(name);
      if (s) await s.interrupt();
      return true;
    },

    newChat(name) {
      closeSession(name);
      handoffs.resetChain(name);
      delete panel.sessions[name];
      histories.set(name, { items: [], cost: null, model: null });
      saveHistory(name);
      savePanel();
      broadcastState();
      return true;
    },

    /** 切換「不要再詢問」：立即生效，已顯示的核准卡片仍需手動處理 */
    setAutoApprove(name, on) {
      const r = panel.roles.find((x) => x.name === name);
      if (!r) throw new Error('找不到這個角色');
      if (on) r.autoApprove = true;
      else delete r.autoApprove;
      savePanel();
      broadcastState();
      return !!r.autoApprove;
    },

    /** 可用的斜線指令（skill、自訂指令與內建指令），聊天視窗輸入 / 時顯示 */
    commands: (name, refresh = false) => commandsFor(name, { refresh: !!refresh }),

    /** answers 只用於 AskUserQuestion 題目卡片：題目文字 → 答案 */
    answer(name, id, decision, answers) {
      const s = sessions.get(name);
      return s ? s.answer(id, decision, answers) : false;
    },

    keyStatus: () => ({ hasKey: !!keys.get(), authMode: panel.authMode }),

    setAuthMode(mode) {
      if (!AUTH_MODES.includes(mode)) throw new Error('未知的登入方式');
      if (panel.authMode === mode) return true;
      panel.authMode = mode;
      savePanel();
      for (const [name] of sessions) closeSession(name); // 換一份憑證重新啟動，對話會接續
      commandCache.clear(); // 不同帳號可用的指令可能不同
      broadcastState();
      handoffs.drainAll();
      return true;
    },

    /** 本機 Claude Code 的登入狀態（只有狀態，不含憑證） */
    localAuthStatus: () => localAuthStatus(),

    /** 以 claude auth login 登入；登入結束（成功、失敗或取消）才回傳結果 */
    startLocalLogin: () => startLocalLogin(),

    /** 瀏覽器顯示授權碼時，把授權碼交給進行中的登入程序 */
    submitLoginCode(code) {
      if (!localLogin) throw new Error('目前沒有進行中的登入');
      if (!localLogin.ctl.sendCode(code)) throw new Error('授權碼格式不正確');
      return true;
    },

    cancelLocalLogin() {
      if (localLogin) localLogin.ctl.cancel();
      return true;
    },

    /** 方案使用量（只有本機 Claude Code 登入才有方案額度）；同時間只查一次 */
    planUsage() {
      if (panel.authMode !== 'claudeCode') return { available: false, reason: 'apiKey' };
      if (!usageQuery) {
        usageQuery = fetchPlanUsage({ loadQuery, options: buildQueryOptions({ mode: 'claudeCode' }), cwd: homeDir })
          .catch((err) => ({ available: false, reason: 'error', message: String((err && err.message) || err) }))
          .finally(() => { usageQuery = null; });
      }
      return usageQuery;
    },

    async setKey(key) {
      const k = String(key || '').trim();
      if (!looksLikeKey(k)) return { ok: false, message: 'API Key 格式不正確（應以 sk-ant- 開頭）' };
      const r = await keys.validate(k);
      if (!r.ok) return r;
      keys.set(k);
      for (const [name] of sessions) closeSession(name); // 用新金鑰重新啟動
      commandCache.clear();
      broadcastState();
      handoffs.drainAll();
      return { ok: true };
    },

    clearKey() {
      keys.clear();
      for (const [name] of sessions) closeSession(name);
      broadcastState();
      return true;
    },

    pickFolder: (current) => pickFolder(current || homeDir),

    async openAgentsDir() {
      fs.mkdirSync(agentsDir, { recursive: true });
      await openPath(agentsDir);
      return true;
    },

    openChat(name) {
      if (!panel.roles.some((r) => r.name === name)) return false;
      chatOpenFor = name;
      const win = openPopup({ page: 'popups/agent-chat.html', width: 440, height: 600, data: { name, theme: getTheme() } });
      if (win && !win.__agentsHooked) {
        win.__agentsHooked = true;
        win.on('closed', () => { chatOpenFor = null; broadcastState(); });
      }
      broadcastState();
      return true;
    },

    openEditor(name = null) {
      openPopup({ page: 'popups/agent-editor.html', width: 440, height: 720, data: { name, theme: getTheme() } });
      return true;
    }
  };

  ipcMain.handle('agents:call', async (e, method, ...args) => {
    if (!isAllowedSender(e.sender)) throw new Error('沒有權限');
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`未知的方法：${method}`);
    return api[method](...args);
  });

  // ---- 每日排程 ----
  /** 觸發一次排程：每次開新對話再送出訊息，無法執行時把原因寫進聊天紀錄 */
  function runSchedule(role, now) {
    // 先記錄再送出，就算送出途中程式結束，當天也不會重複觸發
    role.schedule = { ...role.schedule, lastRun: localDate(now) };
    savePanel();
    const s = sessions.get(role.name);
    // 無法執行時保留舊對話：開新對話會中斷進行中的工作，也會清掉還用得到的紀錄
    if (!canChat()) {
      onEvent(role.name, { type: 'error', message: '排程未執行：請先設定 API Key，或改用本機 Claude Code 登入' });
      return;
    }
    if (s && (s.state !== 'idle' || s.starting)) {
      onEvent(role.name, { type: 'error', message: '排程未執行：這個角色正在回覆或等待核准，今天不會再補跑' });
      return;
    }
    api.newChat(role.name);
    broadcast('agents:event', { name: role.name, event: { type: 'cleared' } });
    api.send(role.name, role.schedule.message).catch((err) => console.error('排程送出失敗', err));
  }

  function runDueSchedules(now = new Date()) {
    for (const role of panel.roles) if (isDue(role.schedule, now)) runSchedule(role, now);
  }

  const stopScheduler = startScheduler({ check: () => runDueSchedules(), powerMonitor });

  handoffs.drainAll(); // 上次關閉程式前還沒送達的轉派

  return {
    api,
    runDueSchedules,
    dispose() {
      disposed = true; // 下面關閉對話時，不要再送出佇列中的工作
      stopScheduler();
      stopWatch();
      if (localLogin) localLogin.ctl.cancel(); // 關閉程式時不留下登入程序
      for (const [name] of sessions) closeSession(name);
    }
  };
}

module.exports = { setupAgents, toolsToGroups, groupsToTools };
