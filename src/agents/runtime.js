// 啟動 Claude Code（Agent SDK）需要的執行環境：SDK 載入、原生執行檔路徑、環境變數
const fs = require('fs');
const path = require('path');

let queryFn = null;

/** SDK 是 ESM，用動態 import 載入；第一次使用才載入 */
async function loadQuery() {
  if (!queryFn) ({ query: queryFn } = await import('@anthropic-ai/claude-agent-sdk'));
  return queryFn;
}

/** 建立自訂工具需要的 SDK 函式；zod 也用 import 載入，才會和 SDK 用同一份 */
async function loadToolKit() {
  const [{ createSdkMcpServer, tool }, { z }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('zod')
  ]);
  return { createSdkMcpServer, tool, z };
}

/**
 * SDK 附帶的 Claude Code 原生執行檔（@anthropic-ai/claude-agent-sdk-<平台>-<架構>）。
 * 打包後位在 app.asar 內無法執行，改指向 app.asar.unpacked（見 package.json 的 asarUnpack）。
 */
function nativeBinary() {
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!arch || !['win32', 'darwin', 'linux'].includes(process.platform)) return null;
  try {
    const dir = path.dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${arch}/package.json`));
    const bin = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null; // 找不到時交給 SDK 自己尋找
  }
}

/** 子程序環境：移除會干擾的變數，再依登入方式決定 Claude Code 用哪一份憑證 */
function childEnv({ mode = 'apiKey', apiKey = null } = {}) {
  const env = { ...process.env };
  // 從終端機的 Claude Code 裡啟動本程式時，避免子程序以為自己是巢狀 session
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // 這兩個在 Claude Code 的認證順序都排在本機登入之前，任一種模式都不讓它們蓋過使用者的選擇
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  // API Key 模式：明確傳入金鑰。本機登入模式：不給金鑰，Claude Code 自行讀取它的登入資料
  // （Windows：%USERPROFILE%\.claude\.credentials.json；macOS：鑰匙圈）；本程式不讀、不存這份資料
  if (mode !== 'claudeCode' && apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

/** 每次啟動對話時的額外選項 */
function buildQueryOptions(auth = {}, { appVersion = '' } = {}) {
  const env = childEnv(auth);
  env.CLAUDE_AGENT_SDK_CLIENT_APP = `soyofon-desktop-tools/${appVersion}`;
  const bin = nativeBinary();
  return { env, ...(bin ? { pathToClaudeCodeExecutable: bin } : {}) };
}

const AUTH_METHODS = {
  oauth_token: 'Claude 帳號',
  claude_ai: 'Claude 帳號',
  'claude.ai': 'Claude 帳號', // 實際回傳的值（2.1.318）
  api_key: 'API Key',
  oauth_api_key: 'Claude Console 帳號'
};

/**
 * 問 Claude Code 本機目前的登入狀態（`claude auth status --json`），只回傳狀態，不含任何憑證。
 * 結果：{ ok, loggedIn, method, source, error }
 */
function localAuthStatus({ timeoutMs = 20000, spawn = require('child_process').spawn } = {}) {
  const bin = nativeBinary();
  if (!bin) return Promise.resolve({ ok: false, loggedIn: false, error: '找不到 Claude Code 執行檔' });
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try {
      child = spawn(bin, ['auth', 'status', '--json'], { env: childEnv({ mode: 'claudeCode' }), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ ok: false, loggedIn: false, error: String(err.message || err) });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已結束 */ } finish({ ok: false, loggedIn: false, error: '檢查逾時' }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (err) => { clearTimeout(timer); finish({ ok: false, loggedIn: false, error: String(err.message || err) }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out.slice(out.indexOf('{')));
        // loginExpiresAt 沒有公開文件，意義不明確，只作為「可能已過期」的提示
        const expiresAt = typeof j.loginExpiresAt === 'string' ? j.loginExpiresAt : null;
        const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
        finish({
          ok: true,
          loggedIn: !!j.loggedIn,
          method: j.loggedIn ? (AUTH_METHODS[j.authMethod] || j.authMethod || '') : '',
          rawMethod: j.authMethod || '',
          source: j.apiKeySource || '',
          expiresAt,
          expired: !!j.loggedIn && Number.isFinite(expiresMs) && expiresMs <= Date.now()
        });
      } catch {
        finish({ ok: false, loggedIn: false, error: '無法讀取 Claude Code 的登入狀態' });
      }
    });
  });
}

/** 移除終端機跳脫碼（顏色、OSC 8 超連結），只留純文字 */
function stripAnsi(s) {
  return String(s)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, ' ')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * 以 Claude Code 的 `claude auth login` 登入本機帳號：Claude Code 會自己開啟瀏覽器並接收授權，
 * 瀏覽器無法自動回傳時會改為顯示授權碼，由使用者貼上（sendCode 寫入程序的標準輸入）。
 * 本程式不讀取、不保存任何憑證；授權碼只轉交給 Claude Code。
 * 回傳 { done: Promise<{ ok, cancelled?, error? }>, sendCode(code), cancel() }
 * onUpdate({ url })：從輸出讀到備用登入網址時呼叫
 */
function localAuthLogin({ console: useConsole = false, timeoutMs = 10 * 60 * 1000, onUpdate = () => {}, spawn = require('child_process').spawn, bin = nativeBinary() } = {}) {
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  if (!bin) {
    finish({ ok: false, error: '找不到 Claude Code 執行檔' });
    return { done, sendCode: () => false, cancel: () => {} };
  }
  let settled = false;
  let cancelled = false;
  let out = '';
  let url = null;
  let child;
  let timer = null;
  const end = (r) => { if (!settled) { settled = true; clearTimeout(timer); finish(r); } };
  const args = ['auth', 'login', ...(useConsole ? ['--console'] : [])];
  try {
    child = spawn(bin, args, { env: childEnv({ mode: 'claudeCode' }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    end({ ok: false, error: String(err.message || err) });
    return { done, sendCode: () => false, cancel: () => {} };
  }
  timer = setTimeout(() => {
    try { child.kill(); } catch { /* 已結束 */ }
    end({ ok: false, error: '登入逾時，請再試一次' });
  }, timeoutMs);
  const onData = (d) => {
    out = (out + d).slice(-8000);
    if (!url) {
      // 網址可能只出現在 OSC 8 超連結的參數裡，所以從原始輸出找，遇到跳脫碼即停止
      const m = out.match(/https:\/\/[^\s\u0007\u001b]+/);
      if (m) { url = m[0]; onUpdate({ url }); }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.stdin.on('error', () => { /* 程序已結束時寫入會失敗，交給 close 處理 */ });
  child.on('error', (err) => end({ ok: false, error: String(err.message || err) }));
  child.on('close', (code) => {
    if (cancelled) return end({ ok: false, cancelled: true });
    if (code === 0) return end({ ok: true });
    // 錯誤訊息取最後一行有內容的輸出（不含網址）；授權碼提示沒有換行，後面的錯誤會接在同一行，只移除提示字樣
    const lines = stripAnsi(out).split('\n')
      .map((l) => l.replace(/^\s*Paste code here if prompted\s*>\s*/i, '').trim())
      .filter((l) => l && !/https?:\/\//.test(l));
    end({ ok: false, error: lines[lines.length - 1] || `登入失敗（結束碼 ${code}）` });
  });
  return {
    done,
    sendCode(code) {
      const c = String(code || '').trim();
      if (settled || !c || c.length > 2000 || /\s/.test(c)) return false;
      child.stdin.write(`${c}\n`);
      return true;
    },
    cancel() {
      if (settled) return;
      cancelled = true;
      try { child.kill(); } catch { /* 已結束 */ }
    }
  };
}

/** 只取已知的額度欄位；SDK 回傳的其他欄位未公開，可能隨時變動 */
function summarizePlanUsage(raw) {
  const limits = (raw && raw.rate_limits) || null;
  if (!raw || !raw.rate_limits_available || !limits) {
    return { available: false, reason: 'unavailable', plan: (raw && raw.subscription_type) || null };
  }
  const windows = [];
  const add = (label, w) => {
    if (w && typeof w.utilization === 'number') windows.push({ label, percent: w.utilization, resetsAt: w.resets_at || null });
  };
  add('5 小時', limits.five_hour);
  add('7 天', limits.seven_day);
  add('Opus（7 天）', limits.seven_day_opus);
  add('Sonnet（7 天）', limits.seven_day_sonnet);
  for (const m of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) add(`${m.display_name}（7 天）`, m);
  if (limits.extra_usage && limits.extra_usage.is_enabled) add('額外用量', limits.extra_usage);
  return { available: true, plan: raw.subscription_type || null, windows };
}

/**
 * 查詢 Claude 方案使用量：啟動不送訊息的暫時 session，不呼叫模型、不留對話紀錄，查完立即關閉。
 * 憑證由 Claude Code 自行處理。SDK 的這個方法還是實驗性 API，失敗時由呼叫端顯示「無法取得」。
 */
async function planUsage({ loadQuery: load = loadQuery, options = {}, cwd, timeoutMs = 20000 } = {}) {
  const query = await load();
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  async function* prompt() { await released; } // 不送出任何訊息
  const q = query({ prompt: prompt(), options: { ...options, cwd, settingSources: [], tools: [], maxTurns: 1, persistSession: false } });
  // 要持續讀取訊息，控制請求才收得到回應；關閉時的錯誤可以忽略
  const drained = (async () => { for await (const _ of q) { /* 略過 */ } })().catch(() => {});
  let timer;
  try {
    const getUsage = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof getUsage !== 'function') throw new Error('目前的 Claude Code 版本不支援查詢使用量');
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('查詢逾時')), timeoutMs); });
    return summarizePlanUsage(await Promise.race([getUsage.call(q, { skipBehaviors: true }), timeout]));
  } finally {
    clearTimeout(timer);
    release();
    q.close();
    await drained;
  }
}

/**
 * 只取聊天視窗的指令選單需要的欄位；`__` 開頭是 Claude Code 內部用的指令，不顯示。
 * 自訂的（使用者、專案、外掛、MCP）排前面，內建的排後面，各自依名稱排序。
 * @param {object[]} list SDK 的 SlashCommand[]
 * @param {string[]} [hidden] 要隱藏的指令名稱（例如 init 訊息的 terminal_slash_commands）
 */
function normalizeCommands(list, hidden = []) {
  const hide = new Set(hidden);
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const name = String((c && c.name) || '').trim();
    const key = `${name}\u0000${c && c.builtin ? 1 : 0}`;
    if (!name || name.startsWith('__') || hide.has(name) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      description: String(c.description || ''),
      argumentHint: String(c.argumentHint || ''),
      builtin: !!c.builtin
    });
  }
  return out.sort((a, b) => (a.builtin - b.builtin) || a.name.localeCompare(b.name));
}

/**
 * 取得可用的斜線指令（skill 與指令）：啟動不送訊息的暫時 session，不呼叫模型、不留對話紀錄，取得後立即關閉。
 * settingSources 與正式對話相同，才會載入同一份使用者、專案的 skill。
 */
async function listCommands({ loadQuery: load = loadQuery, options = {}, cwd, timeoutMs = 20000 } = {}) {
  const query = await load();
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  async function* prompt() { await released; } // 不送出任何訊息
  const q = query({ prompt: prompt(), options: { ...options, cwd, settingSources: ['user', 'project', 'local'], persistSession: false, maxTurns: 1 } });
  // 要持續讀取訊息，控制請求才收得到回應；關閉時的錯誤可以忽略
  const drained = (async () => { for await (const _ of q) { /* 略過 */ } })().catch(() => {});
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('讀取指令清單逾時')), timeoutMs); });
    return normalizeCommands(await Promise.race([q.supportedCommands(), timeout]));
  } finally {
    clearTimeout(timer);
    release();
    q.close();
    await drained;
  }
}

module.exports = { loadQuery, loadToolKit, nativeBinary, buildQueryOptions, childEnv, localAuthStatus, localAuthLogin, stripAnsi, planUsage, summarizePlanUsage, listCommands, normalizeCommands };
