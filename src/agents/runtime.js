// 啟動 Claude Code（Agent SDK）需要的執行環境：SDK 載入、原生執行檔路徑、環境變數
const fs = require('fs');
const path = require('path');

let queryFn = null;

/** SDK 是 ESM，用動態 import 載入；第一次使用才載入 */
async function loadQuery() {
  if (!queryFn) ({ query: queryFn } = await import('@anthropic-ai/claude-agent-sdk'));
  return queryFn;
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
        finish({
          ok: true,
          loggedIn: !!j.loggedIn,
          method: j.loggedIn ? (AUTH_METHODS[j.authMethod] || j.authMethod || '') : '',
          source: j.apiKeySource || ''
        });
      } catch {
        finish({ ok: false, loggedIn: false, error: '無法讀取 Claude Code 的登入狀態' });
      }
    });
  });
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

module.exports = { loadQuery, nativeBinary, buildQueryOptions, childEnv, localAuthStatus, planUsage, summarizePlanUsage };
