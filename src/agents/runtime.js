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

/** 每次啟動對話時的額外選項 */
function buildQueryOptions(apiKey, { appVersion = '' } = {}) {
  const env = { ...process.env };
  // 從終端機的 Claude Code 裡啟動本程式時，避免子程序以為自己是巢狀 session
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // 使用者選擇以 API Key 登入：不讓其他憑證蓋過
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = `soyofon-desktop-tools/${appVersion}`;
  const bin = nativeBinary();
  return { env, ...(bin ? { pathToClaudeCodeExecutable: bin } : {}) };
}

module.exports = { loadQuery, nativeBinary, buildQueryOptions };
