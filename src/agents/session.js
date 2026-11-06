// 一個角色的對話 session：用 Agent SDK 的串流輸入模式保持 Claude Code 程序，持續送入訊息。
// 把 SDK 訊息轉成聊天視窗用的事件，並把工具核准交給聊天視窗決定。
const path = require('path');
const { HANDOFF_TOOL } = require('./handoff');

const IDLE_CLOSE_MS = 10 * 60 * 1000; // 閒置 10 分鐘關閉程序，下次傳訊息時用 resume 接續

/** 工具動作的中文摘要（顯示在聊天視窗的工具列） */
function toolSummary(name, input = {}, cwd = '') {
  const rel = (p) => {
    if (!p || typeof p !== 'string') return '';
    const r = cwd ? path.relative(cwd, p) : p;
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p;
  };
  const cut = (s, n = 120) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  switch (name) {
    case 'Read': return { verb: '讀取', detail: rel(input.file_path) };
    case 'Write': return { verb: '建立檔案', detail: rel(input.file_path) };
    case 'Edit':
    case 'MultiEdit': return { verb: '修改', detail: rel(input.file_path) };
    case 'NotebookEdit': return { verb: '修改', detail: rel(input.notebook_path) };
    case 'Bash': return { verb: '執行', detail: cut(input.command) };
    case 'Grep': return { verb: '搜尋', detail: `"${cut(input.pattern, 60)}"` };
    case 'Glob': return { verb: '尋找檔案', detail: cut(input.pattern, 80) };
    case 'WebSearch': return { verb: '搜尋網路', detail: `"${cut(input.query, 80)}"` };
    case 'WebFetch': return { verb: '讀取網頁', detail: cut(input.url, 100) };
    case 'Agent':
    case 'Task': return { verb: '交給子代理', detail: cut(input.description || input.subagent_type, 80) };
    case 'TodoWrite': return { verb: '更新待辦清單', detail: '' };
    case HANDOFF_TOOL: return { verb: '轉派給', detail: cut(input.role, 60) };
    default: return { verb: '使用工具', detail: name };
  }
}

/** 核准卡片的內容 */
function permissionCard(name, input = {}, cwd = '') {
  const s = toolSummary(name, input, cwd);
  switch (name) {
    case 'Bash': return { title: '要執行指令', code: String(input.command || ''), note: input.description || '' };
    case 'Write': return { title: '要建立檔案', code: s.detail, note: '' };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': return { title: '要修改檔案', code: s.detail, note: '' };
    case 'WebFetch': return { title: '要讀取網頁', code: String(input.url || ''), note: '' };
    case 'WebSearch': return { title: '要搜尋網路', code: String(input.query || ''), note: '' };
    default: {
      let json = '';
      try { json = JSON.stringify(input, null, 2); } catch { json = ''; }
      if (json.length > 600) json = `${json.slice(0, 600)}…`;
      return { title: `要使用工具 ${name}`, code: json, note: '' };
    }
  }
}

class AgentSession {
  /**
   * @param {object} o
   * @param {string} o.name        子代理代號
   * @param {object} o.definition  { description, prompt, tools, model }
   * @param {string} o.cwd         工作資料夾
   * @param {string|null} o.resume 要接續的 session id
   * @param {() => Promise<Function>} o.loadQuery 取得 SDK 的 query 函式
   * @param {() => object} o.buildOptions 額外的 query 選項（env、執行檔路徑等）
   * @param {() => Promise<object>} o.mcpServers 這個角色專用的 MCP 伺服器（每次啟動程序都要新建）
   * @param {(event: object) => void} o.emit 對聊天視窗送出事件
   */
  constructor(o) {
    Object.assign(this, {
      name: o.name,
      definition: o.definition,
      cwd: o.cwd,
      sessionId: o.resume || null,
      loadQuery: o.loadQuery,
      buildOptions: o.buildOptions || (() => ({})),
      mcpServers: o.mcpServers || (async () => ({})),
      emit: o.emit
    });
    this.query = null;
    this.queue = [];
    this.wake = null;
    this.state = 'idle';         // idle | running | waiting
    this.pending = new Map();    // 等待核准：id → { resolve, input, suggestions }
    this.idleTimer = null;
    this.closed = false;
    this.streamText = '';
    this.gen = 0;                // 每次啟動程序換一代，舊的輸入產生器會自行結束
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: 'state', state: s });
  }

  async *input(gen) {
    while (!this.closed && gen === this.gen) {
      if (!this.queue.length) await new Promise((r) => { this.wake = r; });
      if (this.closed || gen !== this.gen) return;
      const msg = this.queue.shift();
      if (msg) yield msg;
    }
  }

  push(msg) {
    this.queue.push(msg);
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
  }

  async start() {
    const query = await this.loadQuery();
    const mcpServers = await this.mcpServers();
    // 以另一個名稱傳入同一份定義：~/.claude/agents 有同名檔案時，Claude Code 會忽略主執行緒的 agent 設定
    // （Claude Code 2.1.318 實測），換個名稱就能確定套用角色說明、工具與模型
    // 從現有子代理加入的角色會保留原名，可能含空白或符號，這裡只取安全字元；合法代號不受影響
    const agentKey = `dashboard-role-${this.name.replace(/[^A-Za-z0-9-]+/g, '-')}`;
    const options = {
      agent: agentKey,
      agents: { [agentKey]: this.definition },
      mcpServers,
      settingSources: ['user', 'project', 'local'],    // 完整 Claude Code：載入 ~/.claude 與專案的設定、CLAUDE.md、技能、MCP
      cwd: this.cwd,
      includePartialMessages: true,
      // 轉派不需要核准；目標角色要動手時仍會在自己的聊天視窗核准
      canUseTool: async (toolName, input, opts) => (toolName === HANDOFF_TOOL
        ? { behavior: 'allow', updatedInput: input }
        : this.askPermission(toolName, input, opts)),
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...this.buildOptions()
    };
    this.gen += 1;
    this.query = query({ prompt: this.input(this.gen), options });
    this.loop();
  }

  async loop() {
    const q = this.query;
    try {
      for await (const m of q) this.handle(m);
    } catch (err) {
      if (!this.closed) {
        this.emit({ type: 'error', message: friendlyError(err) });
      }
    } finally {
      if (this.query === q) {
        this.query = null;
        this.rejectAllPending('對話已結束');
        this.setState('idle');
      }
    }
  }

  handle(m) {
    if (m.session_id && m.session_id !== this.sessionId) {
      this.sessionId = m.session_id;
      this.emit({ type: 'session', sessionId: m.session_id });
    }
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') this.emit({ type: 'ready', model: m.model });
        else if (m.subtype === 'api_retry') this.emit({ type: 'retry', attempt: m.attempt, max: m.max_retries, error: m.error });
        break;
      case 'stream_event': {
        if (m.parent_tool_use_id) break; // 子代理內部的串流不顯示
        const ev = m.event || {};
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          this.streamText += ev.delta.text;
          this.emit({ type: 'delta', text: ev.delta.text });
        }
        break;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) break;
        const blocks = (m.message && m.message.content) || [];
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (text) this.emit({ type: 'assistant', text });
        this.streamText = '';
        for (const b of blocks) {
          if (b.type === 'tool_use') this.emit({ type: 'tool', id: b.id, name: b.name, ...toolSummary(b.name, b.input, this.cwd) });
        }
        if (m.error) this.emit({ type: 'error', message: apiErrorText(m.error) });
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id) break;
        const content = (m.message && m.message.content) || [];
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'tool_result') this.emit({ type: 'tool_done', id: b.tool_use_id, isError: !!b.is_error });
          }
        }
        break;
      }
      case 'result':
        this.emit({
          type: 'result',
          isError: !!m.is_error,
          message: m.is_error ? resultErrorText(m) : '',
          cost: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : null
        });
        this.setState('idle');
        this.armIdleClose();
        break;
      default:
        break;
    }
  }

  async send(text) {
    if (this.closed) throw new Error('對話已關閉');
    clearTimeout(this.idleTimer);
    if (!this.query) {
      // 同時送出多則訊息時只啟動一次
      this.starting = this.starting || this.start().finally(() => { this.starting = null; });
      await this.starting;
    }
    this.setState('running');
    this.push({ type: 'user', message: { role: 'user', content: String(text) }, parent_tool_use_id: null });
  }

  askPermission(toolName, input, opts = {}) {
    const id = opts.toolUseID || `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, input, suggestions: opts.suggestions || [], toolName });
      const card = permissionCard(toolName, input, this.cwd);
      this.emit({
        type: 'permission',
        id,
        toolName,
        ...card,
        allowSession: !opts.suppressAlwaysAllowRule
      });
      this.setState('waiting');
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          this.emit({ type: 'permission_done', id, decision: 'cancelled' });
          resolve({ behavior: 'deny', message: '已取消' });
        }, { once: true });
      }
    });
  }

  /** decision: 'allow' | 'allow_session' | 'deny' */
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    let result;
    if (decision === 'allow' || decision === 'allow_session') {
      result = { behavior: 'allow', updatedInput: p.input };
      if (decision === 'allow_session') {
        // 只在這個對話有效：建議的規則改成 session 範圍；沒有建議時允許這個工具
        const rules = p.suggestions.length
          ? p.suggestions.map((s) => ({ ...s, destination: 'session' }))
          : [{ type: 'addRules', rules: [{ toolName: p.toolName }], behavior: 'allow', destination: 'session' }];
        result.updatedPermissions = rules;
      }
    } else {
      result = { behavior: 'deny', message: '使用者拒絕了這個動作。請不要重試，改問使用者要怎麼做。' };
    }
    this.emit({ type: 'permission_done', id, decision });
    if (!this.pending.size) this.setState('running');
    p.resolve(result);
    return true;
  }

  rejectAllPending(message) {
    for (const [id, p] of this.pending) {
      this.emit({ type: 'permission_done', id, decision: 'cancelled' });
      p.resolve({ behavior: 'deny', message });
    }
    this.pending.clear();
  }

  async interrupt() {
    if (!this.query) return;
    this.rejectAllPending('使用者停止了回覆');
    try { await this.query.interrupt(); } catch { /* 已結束 */ }
  }

  armIdleClose() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stopProcess(), IDLE_CLOSE_MS);
  }

  /** 結束 Claude Code 程序，但保留 sessionId 以便之後接續 */
  stopProcess() {
    clearTimeout(this.idleTimer);
    const q = this.query;
    this.query = null;
    this.gen += 1;
    this.rejectAllPending('對話已結束');
    this.queue = [];
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
    if (q) { try { q.close(); } catch { /* 已結束 */ } }
    this.setState('idle');
  }

  close() {
    this.closed = true;
    this.stopProcess();
  }
}

function apiErrorText(kind) {
  return ({
    authentication_failed: 'API Key 無效，請重新設定',
    billing_error: 'API 帳戶餘額不足或帳單有問題',
    rate_limit: '請求太頻繁，請稍後再試',
    overloaded: 'Claude 目前太忙碌，請稍後再試',
    invalid_request: '請求格式有誤',
    model_not_found: '找不到指定的模型，請在角色設定改用其他模型',
    server_error: 'Claude 伺服器發生錯誤，請稍後再試'
  })[kind] || `發生錯誤（${kind}）`;
}

function resultErrorText(m) {
  if (m.subtype === 'error_max_turns') return '已達到回合上限';
  if (m.subtype === 'error_max_budget_usd') return '已達到費用上限';
  const errs = Array.isArray(m.errors) ? m.errors.filter(Boolean) : [];
  return errs.length ? String(errs[0]).slice(0, 300) : (typeof m.result === 'string' && m.result ? m.result.slice(0, 300) : '回覆時發生錯誤');
}

function friendlyError(err) {
  const msg = String((err && err.message) || err);
  if (/Native CLI binary .* not found/.test(msg)) return '找不到 Claude Code 執行檔，請重新安裝 Soyofon Desktop Tools';
  return msg.slice(0, 300);
}

module.exports = { AgentSession, toolSummary, permissionCard };
