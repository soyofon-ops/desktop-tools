// BEM 檢查（widgets/tool-dashboard/bem-lint.js）的單元測試
const test = require('node:test');
const assert = require('node:assert/strict');
const BEM = require('../widgets/tool-dashboard/bem-lint.js');

const names = (r) => r.items.map((i) => i.name);

test('合法的經典 BEM 名稱通過', () => {
  for (const n of ['card', 'card__title', 'card__title--active', 'icon--2x', 'main-nav__item--is-open']) {
    assert.equal(BEM.checkClassName(n, 'classic').valid, true, n);
  }
});

test('camelCase 會被擋下並建議 kebab-case 與元素寫法', () => {
  const r = BEM.checkClassName('cardTitle', 'classic');
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'uppercase');
  assert.equal(r.suggestion, 'card-title');
  assert.deepEqual(r.alternatives.map((a) => a.name), ['card__title']);
});

test('修飾詞 key_value 依慣例判斷', () => {
  assert.equal(BEM.checkClassName('btn--size_l', 'twodash').valid, true);
  assert.equal(BEM.checkClassName('card__title_size_l', 'yandex').valid, true);
  const classic = BEM.checkClassName('btn--size_l', 'classic');
  assert.equal(classic.valid, false);
  assert.equal(classic.suggestion, 'btn--size-l');
});

test('從空白與逗號分隔的名稱取出 class', () => {
  const r = BEM.extractClassNames('card card__title, btn--primary');
  assert.equal(r.mode, 'names');
  assert.deepEqual(names(r), ['card', 'card__title', 'btn--primary']);
});

test('SCSS 展開 & 巢狀，略過註解與 @keyframes', () => {
  const r = BEM.extractClassNames('.card { &__title { color: red; } &--dark {} } /* .x__y */ @keyframes spin { from {} }');
  assert.equal(r.mode, 'css');
  assert.deepEqual(names(r), ['card', 'card__title', 'card--dark']);
});

test('HTML 的 class 與 className 屬性', () => {
  const r = BEM.extractClassNames('<div class="a b__c" className="d"></div>');
  assert.equal(r.mode, 'html');
  assert.deepEqual(names(r), ['a', 'b__c', 'd']);
});

test('空白內容取不到 class', () => {
  assert.deepEqual(BEM.extractClassNames('   ').items, []);
});

test('analyze 對每個慣例都給出結果', () => {
  const r = BEM.analyze('btn--size_l');
  assert.deepEqual(Object.keys(r.items[0].results).sort(), Object.keys(BEM.CONVENTIONS).sort());
});
