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

module.exports = { loadQuery, nativeBinary, buildQueryOptions, childEnv, localAuthStatus };
