// 資料庫（src/database.js）的單元測試
// database.js 會 require('electron') 取得 userData 路徑，測試時換成假的 electron，資料寫到暫存資料夾
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tools-db-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { getPath: () => tmpDir } }
};
const db = require('../src/database.js');

test.after(() => {
  db.saveNow(); // 清掉延遲存檔的計時器
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const FIELDS = [
  { key: 'name', label: '名稱', type: 'text' },
  { key: 'count', label: '數量', type: 'number' },
  { key: 'enabled', label: '啟用', type: 'boolean' },
  { key: 'start', label: '開始', type: 'time' },
  { key: 'job', label: '職業', type: 'select', options: [{ label: '採礦', value: 'miner' }, '園藝'] }
];

test('寫入時依欄位類型轉換', () => {
  db.createCategory({ id: 'coerce', name: '轉換', fields: FIELDS });
  const item = db.addItem('coerce', { name: 123, count: '8', enabled: 'true', start: '8:5', job: '採礦', extra: { a: 1 } });
  assert.deepEqual(item.data, { name: '123', count: 8, enabled: true, start: '08:05', job: 'miner', extra: { a: 1 } });
});

test('不合法的值存成空值', () => {
  const item = db.addItem('coerce', { count: 'abc', start: '24:00', job: '不存在', enabled: undefined });
  assert.equal(item.data.count, '');
  assert.equal(item.data.start, '');
  assert.equal(item.data.job, '');
  assert.equal(item.data.enabled, false);
});

test('字串選項的 label 與 value 相同', () => {
  assert.equal(db.addItem('coerce', { job: '園藝' }).data.job, '園藝');
});

test('分類代碼與欄位代碼驗證', () => {
  assert.throws(() => db.createCategory({ id: 'Bad ID', name: 'x' }), /分類代碼/);
  assert.throws(() => db.createCategory({ id: 'coerce', name: 'x' }), /已存在/);
  assert.throws(() => db.createCategory({ id: 'dup', name: 'x', fields: [{ key: 'a' }, { key: 'a' }] }), /重複/);
});

test('修改下拉選單實際值時既有資料跟著換', () => {
  db.createCategory({ id: 'rename', name: '改名', fields: [{ key: 'job', type: 'select', options: [{ label: '採礦', value: 'miner' }] }] });
  const item = db.addItem('rename', { job: 'miner' });
  db.updateCategory('rename', {
    fields: [{ key: 'job', type: 'select', options: [{ label: '採礦', value: 'mining' }] }],
    renames: { job: { miner: 'mining' } }
  });
  assert.equal(db.listItems('rename').find((i) => i.id === item.id).data.job, 'mining');
});

test('匯入合併：同 id 更新、新資料新增、新欄位加入', () => {
  db.createCategory({ id: 'merge', name: '合併', fields: [{ key: 'name', type: 'text' }] });
  const existing = db.addItem('merge', { name: '舊' });
  const report = db.importData({
    categories: [{
      id: 'merge', name: '合併',
      fields: [{ key: 'name', type: 'text' }, { key: 'hour', type: 'time' }],
      items: [{ id: existing.id, data: { name: '新', hour: '9:30' } }, { name: '手寫的資料' }]
    }]
  }, { conflict: 'merge' });
  assert.deepEqual(report.map(({ action, added, updated }) => ({ action, added, updated })), [{ action: 'merged', added: 1, updated: 1 }]);
  const items = db.listItems('merge');
  assert.equal(items.length, 2);
  assert.deepEqual(items.find((i) => i.id === existing.id).data, { name: '新', hour: '09:30' });
  assert.ok(db.getCategory('merge').fields.some((f) => f.key === 'hour'));
  // importData 會立即存檔
  assert.ok(fs.existsSync(path.join(tmpDir, 'database.json')));
});

test('匯入略過與取代', () => {
  const payload = { categories: [{ id: 'merge', name: '取代後', fields: [{ key: 'name', type: 'text' }], items: [{ name: 'only' }] }] };
  assert.equal(db.importData(payload, { conflict: 'skip' })[0].action, 'skipped');
  assert.equal(db.listItems('merge').length, 2);
  assert.equal(db.importData(payload, { conflict: 'replace' })[0].action, 'replaced');
  assert.deepEqual(db.listItems('merge').map((i) => i.data.name), ['only']);
  assert.equal(db.getCategory('merge').name, '取代後');
});

test('匯入格式錯誤時給出可讀訊息', () => {
  assert.throws(() => db.importData('{bad'), /不是有效的 JSON/);
  assert.throws(() => db.importData({}), /找不到分類資料/);
  assert.throws(() => db.importData({ categories: [] }), /沒有任何分類/);
});
