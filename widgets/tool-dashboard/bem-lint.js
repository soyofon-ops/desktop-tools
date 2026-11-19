// BEM 檢查：從 class 名稱、CSS／SCSS 或 HTML 取出 class，檢查是否符合 BEM 命名，並產生建議名稱。
// 工具儀表盤的「BEM 檢查」使用（window.BEM），也可在 Node 以 require 載入測試。
(function (root) {
  'use strict';

  /** 支援的命名慣例 */
  const CONVENTIONS = {
    classic: { label: '經典', example: 'block__elem--mod-value' },
    twodash: { label: '雙段修飾', example: 'block__elem--key_value' },
    yandex: { label: 'Yandex', example: 'block__elem_key_value' }
  };

  // 單一段落（block、element、modifier 名稱）：小寫 kebab-case
  const BLOCK = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
  const PART = '[a-z0-9]+(?:-[a-z0-9]+)*'; // element、modifier 可用數字開頭（例如 icon--2x）
  const PATTERNS = {
    classic: new RegExp(`^${BLOCK}(?:__${PART})?(?:--${PART})?$`),
    twodash: new RegExp(`^${BLOCK}(?:__${PART})?(?:--${PART}(?:_${PART})?)?$`),
    yandex: new RegExp(`^${BLOCK}(?:__${PART})?(?:_${PART}(?:_${PART})?)?$`)
  };

  // class 名稱的基本形狀（大寫也收，才能檢查出來）
  const IDENT = /^-?[A-Za-z_][\w-]*$/;

  // ---------------------------------------------------------------------------
  // 取出 class 名稱
  // ---------------------------------------------------------------------------

  /**
   * 從剪貼簿文字取出 class 名稱。
   * 回傳 { mode: 'html' | 'css' | 'names', items: [{ name, line }] }，line 為第一次出現的行，依行號排序。
   */
  function extractClassNames(text) {
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const found = new Map();
    const add = (name, line) => {
      if (!IDENT.test(name)) return;
      const it = found.get(name);
      if (!it) found.set(name, { name, line });
      else if (line < it.line) it.line = line; // <style> 先解析，行號可能比較後面
    };

    let mode;
    if (/<[A-Za-z][\w-]*[\s>]/.test(src) && /(?:^|[\s"'])(?:class|className)\s*=|<style[\s>]/i.test(src)) {
      mode = 'html';
      extractFromHTML(src, add);
    } else if (src.includes('{')) {
      mode = 'css';
      extractFromCSS(src, 0, add);
    } else {
      mode = 'names';
      extractFromNames(src, add);
    }
    return { mode, items: [...found.values()].sort((a, b) => a.line - b.line) };
  }

  /** 回傳查詢函式：index 位於第幾行（從 1 開始）。先記下所有換行位置再二分搜尋，大檔案也不會變慢 */
  function lineIndex(text) {
    const breaks = [];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) breaks.push(i);
    return (index) => {
      let lo = 0;
      let hi = breaks.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (breaks[mid] < index) lo = mid + 1;
        else hi = mid;
      }
      return lo + 1;
    };
  }

  /** 純名稱：空白、逗號分隔；有 .class 選擇器時改從選擇器取出 */
  function extractFromNames(src, add) {
    if (/(?:^|[^\w-])\.-?[A-Za-z_\\]/.test(src)) {
      src.split('\n').forEach((row, i) => classesInSelector(row).forEach((c) => add(c, i + 1)));
      return;
    }
    src.split('\n').forEach((row, i) => {
      for (const token of row.split(/[\s,]+/)) if (token) add(token, i + 1);
    });
  }

  /** HTML／JSX：class="…"、className='…'、class=xxx，以及 <style> 內的 CSS */
  function extractFromHTML(src, add) {
    // <style> 區塊交給 CSS 解析，行號以原始文字為準
    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    const lineAt = lineIndex(src); // 換掉 <style> 後行號不變，兩段共用
    for (const m of src.matchAll(styleRe)) {
      const start = m.index + m[0].indexOf('>') + 1;
      extractFromCSS(m[1], lineAt(start) - 1, add);
    }
    const rest = src.replace(styleRe, (all) => all.replace(/[^\n]/g, ' ')); // 保留行號
    const attrRe = /(?:^|[\s"'])(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
    for (const m of rest.matchAll(attrRe)) {
      const value = m[1] ?? m[2] ?? m[3] ?? '';
      if (/^[{[]/.test(value)) continue; // JSX 運算式，例如 className={styles.card}
      const line = lineAt(m.index + (m[0].match(/^[\s"']/) ? 1 : 0));
      // 樣板語法（{{ }}、${ }）裡的內容不是 class 名稱
      const plain = value.replace(/\{\{[\s\S]*?\}\}|\$\{[^}]*\}|<%[\s\S]*?%>/g, ' ');
      for (const token of plain.split(/\s+/)) if (token) add(token, line);
    }
  }

  /** 從單一選擇器取出 class（處理 \: 等跳脫字元；接著是 SCSS 插值的略過） */
  function classesInSelector(selector) {
    const s = selector.replace(/#\{[^}]*\}/g, '\u0000');
    const out = [];
    for (const m of s.matchAll(/\.((?:-?[A-Za-z_]|\\.)(?:[\w-]|\\.)*)/g)) {
      if (m.index > 0 && /[\w\\]/.test(s[m.index - 1])) continue; // 例如 1.5em、url(a.png)
      if (s[m.index + m[0].length] === '\u0000') continue; // .card-#{$x}：名稱不完整
      out.push(m[1].replace(/\\(.)/g, '$1'));
    }
    return out;
  }

  // at-rule 內是一般選擇器（繼承外層）的種類；其餘（@keyframes、@font-face、@mixin…）內容略過
  const TRANSPARENT_AT = /^@(?:media|supports|layer|container|document|include|if|else|each|for|while|scope|starting-style)\b/i;

  /**
   * CSS／SCSS：逐字掃描規則，展開 SCSS 巢狀與 &（例如 .card { &__title { } } → .card__title）。
   * lineOffset：src 在原始文字中的起始行 - 1。
   */
  function extractFromCSS(src, lineOffset, add) {
    // 堆疊每一層：{ selectors: string[] | null（null 表示略過內容） }
    const stack = [{ selectors: [] }];
    let prelude = '';
    let preludeLine = 0;
    let line = 1;
    let paren = 0;

    const top = () => stack[stack.length - 1];
    const reset = () => { prelude = ''; preludeLine = 0; paren = 0; };
    const push = (ch) => {
      if (!preludeLine && !/\s/.test(ch)) preludeLine = line;
      prelude += ch;
    };

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1];

      if (ch === '\n') { line++; prelude += ch; continue; }

      // 註解：/* */ 與 SCSS 的 //（網址的 // 前面是 :，或在括號內，不算註解）
      if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? src.length : end + 2;
        for (let j = i; j < stop; j++) if (src[j] === '\n') line++;
        i = stop - 1;
        continue;
      }
      if (ch === '/' && next === '/' && paren === 0 && src[i - 1] !== ':') {
        const end = src.indexOf('\n', i);
        i = (end < 0 ? src.length : end) - 1;
        continue;
      }
      // 字串原樣跳過，裡面的 { } ; 不算
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        push(src.slice(i, j + 1));
        i = j;
        continue;
      }
      // SCSS 插值 #{…}
      if (ch === '#' && next === '{') {
        const end = src.indexOf('}', i);
        const stop = end < 0 ? src.length : end + 1;
        push(src.slice(i, stop));
        i = stop - 1;
        continue;
      }
      if (ch === '(') paren++;
      if (ch === ')' && paren > 0) paren--;

      if (ch === '{') {
        const head = prelude.trim();
        const parent = top();
        if (parent.selectors === null) {
          stack.push({ selectors: null });
        } else if (head.startsWith('@')) {
          if (/^@at-root\b/i.test(head)) {
            const sel = head.replace(/^@at-root\s*/i, '');
            stack.push({ selectors: sel ? resolveSelectors(sel, []) : [] });
            if (sel) collect(stack[stack.length - 1].selectors, preludeLine);
          } else {
            stack.push({ selectors: TRANSPARENT_AT.test(head) ? parent.selectors : null });
          }
        } else if (/^[\w-]+\s*:\s*$/.test(head)) {
          stack.push({ selectors: null }); // SCSS 巢狀屬性，例如 font: { family: … }
        } else {
          const selectors = resolveSelectors(head, parent.selectors);
          stack.push({ selectors });
          collect(selectors, preludeLine);
        }
        reset();
        continue;
      }
      if (ch === '}') {
        if (stack.length > 1) stack.pop();
        reset();
        continue;
      }
      if (ch === ';') { reset(); continue; }
      push(ch);
    }

    function collect(selectors, at) {
      for (const sel of selectors) for (const c of classesInSelector(sel)) add(c, lineOffset + at);
    }
  }

  /** 以逗號分隔選擇器（括號內的逗號不算，例如 :is(.a, .b)） */
  function splitSelectorList(text) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      if ((ch === ')' || ch === ']') && depth > 0) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  /** 把巢狀選擇器與外層組合：有 & 就代入，沒有就當成子孫選擇器 */
  function resolveSelectors(text, parents) {
    const own = splitSelectorList(text);
    if (!parents.length) return own.map((s) => s.replace(/&/g, ''));
    const out = [];
    for (const p of parents) {
      for (const s of own) out.push(s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 檢查與建議
  // ---------------------------------------------------------------------------

  /** 把一段文字拆成小寫單字：kebab、snake、camelCase 都拆開 */
  function words(text, issues) {
    if (/[A-Z]/.test(text)) issues.add('uppercase');
    const spaced = text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return spaced.split(/[\s_-]+/).filter(Boolean).map((w) => w.toLowerCase());
  }

  /**
   * 把名稱拆成 { block, elems, mods }（不限原本的寫法），並記下發現的問題。
   * 單一底線的意義會依位置判斷，無法確定時記在 ambiguous。
   */
  function parseName(raw, convention) {
    const issues = new Set();
    let name = raw.replace(/^\./, '');

    // 不合法的字元換成連字號
    if (/[^A-Za-z0-9_-]/.test(name)) {
      issues.add('invalid-char');
      name = name.replace(/[^A-Za-z0-9_-]+/g, '-');
    }
    if (/___|---/.test(name)) issues.add('extra-separator');
    if (name.split(/_{2,}|-{2,}/).some((seg) => /^-|-$|-_|_-/.test(seg))) issues.add('stray-hyphen');

    // 依 __ 與 -- 切段
    const tokens = name.split(/(_{2,}|-{2,})/);
    const hasElemSep = /_{2,}/.test(name);
    const hasModSep = /-{2,}/.test(name);
    const segs = []; // { type: 'block' | 'elem' | 'mod', text }
    segs.push({ type: 'block', text: tokens[0] });
    for (let i = 1; i < tokens.length; i += 2) {
      segs.push({ type: tokens[i][0] === '_' ? 'elem' : 'mod', text: tokens[i + 1] || '' });
    }

    const result = { block: [], elems: [], mods: [], issues, ambiguous: null };
    const lastNonModIndex = segs.reduce((acc, s, i) => (s.type !== 'mod' ? i : acc), 0);
    let seenMod = false;

    segs.forEach((seg, i) => {
      if (seg.type === 'mod') {
        seenMod = true;
        // 修飾詞內第一個單底線是 key_value 分隔，其餘當單字分隔
        const at = seg.text.indexOf('_');
        if (at > 0 && at < seg.text.length - 1) {
          result.mods.push({ key: words(seg.text.slice(0, at), issues), val: words(seg.text.slice(at + 1), issues) });
          if (convention === 'classic') issues.add('mod-value-underscore');
          if (seg.text.indexOf('_', at + 1) >= 0) issues.add('snake-case');
        } else {
          result.mods.push({ key: words(seg.text, issues), val: null });
          if (/_/.test(seg.text)) issues.add('snake-case');
        }
        return;
      }

      if (seg.type === 'elem' && seenMod) issues.add('mod-before-elem');
      let text = seg.text;
      // 單底線：最後一個 block／element 段落、且沒有 -- 時，視為 Yandex 寫法的修飾詞
      if (text.includes('_')) {
        const asYandexMod = i === lastNonModIndex && !hasModSep;
        if (asYandexMod && (hasElemSep || convention === 'yandex')) {
          const [base, key, ...val] = text.split('_');
          text = base;
          if (key) result.mods.push({ key: words(key, issues), val: val.length ? words(val.join('-'), issues) : null });
          if (convention !== 'yandex') issues.add('yandex-mod');
          if (val.length > 1) issues.add('snake-case');
        } else if (asYandexMod) {
          // 沒有 __ 也沒有 --：可能是 snake_case 的名稱，也可能是 Yandex 修飾詞，兩個都提供
          const [base, key, ...val] = text.split('_');
          if (base && key) result.ambiguous = { base, key, val: val.join('-') };
          issues.add('snake-case');
        } else {
          issues.add('snake-case');
        }
      }
      const w = words(text, issues);
      if (seg.type === 'block') result.block = w;
      else result.elems.push(w);
    });

    if (convention === 'yandex' && hasModSep) issues.add('yandex-needs-underscore');
    if (result.elems.length > 1) issues.add('nested-elem');
    if (result.mods.length > 1) issues.add('multi-mod');
    if (result.elems.some((e) => !e.length)) issues.add('empty-elem');
    if (result.mods.some((m) => !m.key.length)) issues.add('empty-mod');
    if (!result.block.length) issues.add('no-block');
    else if (/^[0-9]/.test(result.block[0])) issues.add('block-digit');
    return result;
  }

  /** 依慣例組出名稱 */
  function build(convention, block, elem, mod) {
    let s = block.join('-');
    if (elem && elem.length) s += '__' + elem.join('-');
    if (mod && mod.key.length) {
      const key = mod.key.join('-');
      const val = mod.val && mod.val.length ? mod.val.join('-') : '';
      if (convention === 'classic') s += '--' + key + (val ? '-' + val : '');
      else if (convention === 'twodash') s += '--' + key + (val ? '_' + val : '');
      else s += '_' + key + (val ? '_' + val : '');
    }
    return s;
  }

  const MESSAGES = {
    'uppercase': '含大寫字母（camelCase），BEM 使用小寫 kebab-case',
    'invalid-char': '含不允許的字元，只能用小寫英文、數字、連字號與底線',
    'extra-separator': '分隔符號重複（___ 或 ---）',
    'stray-hyphen': '連字號位置不正確（開頭、結尾或緊鄰分隔符號）',
    'snake-case': '用底線分隔單字，單字之間應使用連字號',
    'yandex-mod': '修飾詞用單底線（Yandex 寫法），目前慣例應以 -- 分隔',
    'yandex-needs-underscore': '修飾詞用 --，Yandex 寫法應以單底線分隔',
    'mod-value-underscore': '修飾詞的值用底線分隔（key_value），經典寫法應改用連字號',
    'mod-before-elem': '修飾詞放在元素前面，順序應為 block__element--modifier',
    'nested-elem': '元素底下又有元素（block__elem__elem），BEM 不使用巢狀元素',
    'multi-mod': '一個 class 有多個修飾詞，應拆成多個 class',
    'empty-elem': '元素名稱是空的（__ 後面沒有名稱）',
    'empty-mod': '修飾詞名稱是空的',
    'no-block': '缺少 block 名稱',
    'block-digit': 'block 名稱不能以數字開頭'
  };

  /**
   * 以指定慣例檢查單一 class 名稱。
   * 回傳 { valid, issues: [{ code, message }], suggestion, alternatives: [{ name, note }] }
   * suggestion 為 null 表示無法自動產生（例如缺少 block 名稱）；多個修飾詞時建議以空白分隔多個 class。
   */
  function checkClassName(raw, convention = 'classic') {
    if (!PATTERNS[convention]) throw new Error(`未知的 BEM 慣例：${convention}`);
    if (PATTERNS[convention].test(raw)) return { valid: true, issues: [], suggestion: null, alternatives: [] };

    const p = parseName(raw, convention);
    const alternatives = [];
    let suggestion = null;

    const fatal = p.issues.has('no-block') || p.issues.has('block-digit')
      || p.issues.has('empty-elem') || p.issues.has('empty-mod');
    if (!fatal) {
      const elems = p.elems.filter((e) => e.length);
      // 巢狀元素：合併成一個元素（保留語意），另提供只留最後一層的寫法
      const elem = elems.length ? [].concat(...elems) : null;
      if (elems.length > 1) {
        alternatives.push({ name: build(convention, p.block, elems[elems.length - 1], null) + modTail(convention, p.mods), note: '只保留最後一層元素' });
      }
      if (p.mods.length > 1) {
        // 一個修飾詞一個 class
        suggestion = p.mods.map((m) => build(convention, p.block, elem, m)).join(' ');
      } else {
        suggestion = build(convention, p.block, elem, p.mods[0]);
      }
      if (p.ambiguous) {
        const a = p.ambiguous;
        const issues = new Set();
        const mod = { key: words(a.key, issues), val: a.val ? words(a.val, issues) : null };
        alternatives.push({ name: build(convention, words(a.base, issues), null, mod), note: `若「${a.key}」是修飾詞` });
      }
      if (p.issues.has('uppercase') && !elem && p.block.length > 1 && !p.mods.length) {
        alternatives.push({
          name: build(convention, [p.block[0]], p.block.slice(1), null),
          note: `若「${p.block.slice(1).join('-')}」是 ${p.block[0]} 的元素`
        });
      }
    }

    const issues = [...p.issues].map((code) => ({ code, message: MESSAGES[code] }));
    if (!issues.length) issues.push({ code: 'pattern', message: `不符合 ${CONVENTIONS[convention].example} 格式` });
    const seen = new Set([raw, suggestion]);
    return {
      valid: false,
      issues,
      suggestion: suggestion && suggestion !== raw ? suggestion : null,
      alternatives: alternatives.filter((a) => !seen.has(a.name) && seen.add(a.name))
    };
  }

  /** 只取第一個修飾詞組成結尾（給替代寫法用） */
  function modTail(convention, mods) {
    if (!mods.length) return '';
    return build(convention, ['x'], null, mods[0]).slice(1);
  }

  /**
   * 整段分析：取出 class 名稱並以三種慣例各檢查一次（視窗內切換慣例時不必重算）。
   * 回傳 { mode, items: [{ name, line, results: { classic, twodash, yandex } }] }
   */
  function analyze(text) {
    const { mode, items } = extractClassNames(text);
    return {
      mode,
      items: items.map((it) => ({
        ...it,
        results: Object.fromEntries(Object.keys(CONVENTIONS).map((c) => [c, checkClassName(it.name, c)]))
      }))
    };
  }

  const api = { CONVENTIONS, extractClassNames, checkClassName, analyze };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BEM = api;
})(typeof window !== 'undefined' ? window : globalThis);
