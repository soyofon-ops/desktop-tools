// 角色對話紀錄（src/agents/index.js 的 saveHistory）的測試：超過上限時截掉舊訊息並清掉只被它們用到的圖片
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setupAgents } = require('../src/agents');

const MAX_HISTORY = 300; // 與 src/agents/index.js 一致
const img = (c) => `${c.repeat(16)}.png`; // 符合 chat-images 的檔名格式

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tools-agents-'));
  const homeDir = path.join(root, 'home');
  const userDataDir = path.join(root, 'userData');
  const agentsDir = path.join(homeDir, '.claude', 'agents');
  const chatsDir = path.join(userDataDir, 'agent-chats');
  const imagesDir = path.join(chatsDir, 'images');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });
  for (const n of ['tester', 'other']) {
    fs.writeFileSync(path.join(agentsDir, `${n}.md`), `---\nname: ${n}\ndescription: 測試角色\n---\n角色說明\n`);
  }
  return { root, homeDir, userDataDir, chatsDir, imagesDir };
}

function start(env, roles) {
  fs.writeFileSync(path.join(env.userDataDir, 'agents.json'), JSON.stringify({ roles, sessions: {}, authMode: 'apiKey', handoffs: [] }));
  return setupAgents({
    ipcMain: { handle() {} },
    userDataDir: env.userDataDir,
    homeDir: env.homeDir,
    safeStorage: { decryptString() { throw new Error('沒有金鑰'); }, isEncryptionAvailable: () => false },
    fetch: async () => { throw new Error('測試不連網'); },
    trash: async () => {},
    pickFolder: async () => null,
    openPopup: () => null,
    isAllowedSender: () => true,
    broadcast: () => {},
    loadQuery: async () => { throw new Error('測試不啟動 Claude Code'); }
  });
}

test('超過上限時截掉舊訊息，只刪掉不再被使用的圖片', (t) => {
  const env = makeEnv();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

  // tester：305 筆，前 5 筆會被截掉
  const items = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({ role: 'user', text: `訊息 ${i}` }));
  items[0].images = [img('a')];          // 只有被截掉的訊息用到 → 刪除
  items[1].images = [img('b')];          // 保留的訊息也用到 → 保留
  items[2].images = [img('c')];          // 其他角色的對話用到 → 保留
  items[MAX_HISTORY + 4].images = [img('b')];
  fs.writeFileSync(path.join(env.chatsDir, 'tester.json'), JSON.stringify({ items }));
  fs.writeFileSync(path.join(env.chatsDir, 'other.json'), JSON.stringify({ items: [{ role: 'user', text: 'x', images: [img('c')] }] }));
  for (const c of 'abc') fs.writeFileSync(path.join(env.imagesDir, img(c)), 'png');

  // 沒有 API Key 時排程會寫入一則錯誤訊息並存檔，藉此觸發 saveHistory
  const agents = start(env, [
    { name: 'tester', schedule: { enabled: true, time: '00:00', message: '早安', lastRun: null } },
    { name: 'other' }
  ]);
  t.after(() => agents.dispose());
  agents.runDueSchedules(new Date(2026, 0, 1, 12, 0));

  const saved = JSON.parse(fs.readFileSync(path.join(env.chatsDir, 'tester.json'), 'utf8')).items;
  assert.equal(saved.length, MAX_HISTORY);
  assert.equal(saved[0].text, '訊息 6', '最舊的 6 筆被截掉（加入 1 筆錯誤訊息後共 306 筆）');
  assert.equal(saved.at(-1).role, 'error');
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('a'))), false, '只有被截掉的訊息用到的圖片要刪除');
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('b'))), true, '保留的訊息還在用的圖片不能刪');
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('c'))), true, '其他角色還在用的圖片不能刪');
  assert.equal(fs.existsSync(path.join(env.chatsDir, 'tester.json.tmp')), false, '暫存檔已改名');

  // 記憶體中的紀錄也一起截掉：再存一次不會再刪東西，筆數維持上限
  agents.api.newChat('other');
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('c'))), false, '清除 other 的對話後 c 不再被使用');
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('b'))), true);
});

test('未超過上限時不刪任何圖片', (t) => {
  const env = makeEnv();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(env.chatsDir, 'tester.json'), JSON.stringify({ items: [{ role: 'user', text: 'hi', images: [img('d')] }] }));
  fs.writeFileSync(path.join(env.imagesDir, img('d')), 'png');

  const agents = start(env, [{ name: 'tester', schedule: { enabled: true, time: '00:00', message: '早安', lastRun: null } }]);
  t.after(() => agents.dispose());
  agents.runDueSchedules(new Date(2026, 0, 1, 12, 0));

  const saved = JSON.parse(fs.readFileSync(path.join(env.chatsDir, 'tester.json'), 'utf8')).items;
  assert.equal(saved.length, 2);
  assert.equal(fs.existsSync(path.join(env.imagesDir, img('d'))), true);
});
