// 工具儀表盤功能（widgets/tool-dashboard/tools.js）的單元測試
// tools.js 是瀏覽器腳本（沒有 module.exports），用 vm 載入後取出頂層函式
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../widgets/tool-dashboard/tools.js'), 'utf8');
const ctx = vm.createContext({ TextEncoder, TextDecoder, btoa, atob, console });
ctx.window = ctx;
vm.runInContext(source, ctx, { filename: 'tools.js' });
const { safeDecodeURL, formatJSON, base64Encode, base64Decode, normalizeHex, parseJWT, parseRegexInput } = ctx;

const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');

test('TOOLS 清單載入且 id 不重複', () => {
  const ids = ctx.window.TOOLS.map((t) => t.id);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
});

test('URL 解碼：中文與不完整片段', () => {
  assert.equal(safeDecodeURL('%E5%8F%B0%E4%B8%AD'), '台中');
  // 不完整的位元組保留原樣，其餘照常解碼
  assert.equal(safeDecodeURL('%E5%8F%B0%E4%B8 a%20b'), '台%E4%B8 a b');
  assert.equal(safeDecodeURL('沒有編碼'), '沒有編碼');
});

test('JSON 格式化保留大整數、1.0 與 1e3', () => {
  const out = formatJSON('{"id":12345678901234567890,"a":1.0,"b":1e3,"s":"x,\\"y\\":z","e":[],"o":{}}');
  assert.equal(out, [
    '{',
    '  "id": 12345678901234567890,',
    '  "a": 1.0,',
    '  "b": 1e3,',
    '  "s": "x,\\"y\\":z",',
    '  "e": [],',
    '  "o": {}',
    '}'
  ].join('\n'));
});

test('Base64 編碼解碼來回一致（中文、emoji、換行）', () => {
  const text = '台中 😀\n第二行 ';
  const enc = base64Encode(text);
  assert.equal(enc, Buffer.from(text).toString('base64'));
  assert.deepEqual({ ...base64Decode(enc) }, { text });
});

test('Base64 解碼接受 URL-safe、缺少補位與 data: 前綴', () => {
  const text = '??>>';
  const urlsafe = Buffer.from(text).toString('base64url'); // 沒有 = 補位，含 - _
  assert.equal(base64Decode(urlsafe).text, text);
  assert.equal(base64Decode('data:text/plain;base64,5Y+w5Lit').text, '台中');
});

test('Base64 解碼：無效內容與二進位資料', () => {
  assert.equal(base64Decode('不是base64').error, 'invalid');
  assert.equal(base64Decode('A').error, 'invalid');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  assert.equal(base64Decode(png).error, 'binary');
});

test('色碼統一成大寫 #RRGGBB', () => {
  assert.equal(normalizeHex('#a1b2c3'), '#A1B2C3');
  assert.equal(normalizeHex('a1b2c3'), '#A1B2C3');
  assert.equal(normalizeHex('rgb(255, 0, 16)'), '#FF0010');
  assert.equal(normalizeHex('rgba(1,2,3,0.5)'), '#010203');
  assert.equal(normalizeHex('#abc'), null);
  assert.equal(normalizeHex(null), null);
});

test('JWT 解析：Bearer、Authorization 標頭、引號與時間欄位', () => {
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url('{"sub":"1","exp":1700000000,"big":12345678901234567890}')}.sig`;
  for (const input of [token, `Bearer ${token}`, `Authorization: Bearer ${token}`, `"${token}"`]) {
    const r = parseJWT(input);
    assert.equal(r.error, undefined, input);
    assert.equal(r.token, token);
    assert.equal(r.alg, 'HS256');
    assert.equal(r.signature, 'sig');
    assert.equal(r.claims.exp, 1700000000);
    assert.ok(r.payload.includes('12345678901234567890'), '大整數原樣保留');
  }
});

test('JWT 解析：無效與 JWE', () => {
  assert.equal(parseJWT('abc').error, 'invalid');
  assert.equal(parseJWT(`${b64url('not json')}.${b64url({})}.x`).error, 'invalid');
  assert.equal(parseJWT('a.b.c.d.e').error, 'jwe');
});

test('正規表示式輸入：字面值、純 pattern 與語法錯誤', () => {
  assert.deepEqual({ ...parseRegexInput('/^(a+)+$/gi') }, { source: '^(a+)+$', flags: 'gi' });
  assert.deepEqual({ ...parseRegexInput('a/b') }, { source: 'a/b', flags: '' });
  assert.ok(parseRegexInput('(').error);
});
