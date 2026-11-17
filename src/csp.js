// CSP Evaluator：用 Google 的 csp_evaluator 檢查 Content Security Policy
// 輸入可以是：policy 本身、整行（或多行）Content-Security-Policy 標頭、<meta http-equiv> 標籤，或 http(s) 網址（抓回應標頭）。
const { CspParser } = require('csp_evaluator/dist/parser.js');
const { CspEvaluator } = require('csp_evaluator/dist/evaluator.js');
const { Version, Directive } = require('csp_evaluator/dist/csp.js');
const securityChecks = require('csp_evaluator/dist/checks/security_checks.js');
const strictcspChecks = require('csp_evaluator/dist/checks/strictcsp_checks.js');

const MAX_INPUT = 64 * 1024;       // 太長的輸入不分析
const FETCH_TIMEOUT_MS = 10000;    // 抓網址的時間上限
const MAX_HTML = 1024 * 1024;      // 找 <meta> 時最多讀取的 HTML 位元組數
const KNOWN_DIRECTIVES = new Set(Object.values(Directive));

// 依原始 policy 檢查（建議性質的 Strict CSP 與回報設定），其餘用預設檢查（作用在瀏覽器實際生效的 policy）
const PARSED_CHECKS = [
  strictcspChecks.checkStrictDynamic,
  strictcspChecks.checkStrictDynamicNotStandalone,
  strictcspChecks.checkUnsafeInlineFallback,
  strictcspChecks.checkAllowlistFallback,
  strictcspChecks.checkRequiresTrustedTypesForScripts,
  securityChecks.checkHasConfiguredReporting
];

/** 解開 HTML 屬性值中常見的字元參照 */
function decodeEntities(s) {
  return s
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

/** 讀取標籤屬性：name="v"、name='v' 或 name=v */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** 從 HTML 找出 <meta http-equiv="Content-Security-Policy"> 的 content */
function metaPolicies(html) {
  const out = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const equiv = (attr(tag, 'http-equiv') || '').trim().toLowerCase();
    const content = attr(tag, 'content');
    if (content == null) continue;
    if (equiv === 'content-security-policy') out.push({ kind: 'meta', text: content });
  }
  return out;
}

/**
 * 把剪貼簿文字拆成一或多個 policy：[{ kind: 'enforce' | 'report-only' | 'meta', text }]
 * 一個標頭內以逗號分隔多個 policy（CSP 規範），各自分析。
 */
function extractPolicies(input) {
  let s = String(input ?? '').replace(/^﻿/, '').trim().replace(/^(["'`])([\s\S]*)\1$/, '$2').trim();
  let found = [];

  if (/<meta\b/i.test(s)) {
    found = metaPolicies(s);
  } else {
    // 貼上整段回應標頭時，只取 CSP 那幾行
    const lines = s.split(/\r?\n/);
    const header = /^\s*content-security-policy(-report-only)?\s*:\s*(.*)$/i;
    if (lines.some((l) => header.test(l))) {
      for (const l of lines) {
        const m = l.match(header);
        if (m) found.push({ kind: m[1] ? 'report-only' : 'enforce', text: m[2] });
      }
    } else {
      found.push({ kind: 'enforce', text: s.replace(/\s*\r?\n\s*/g, ' ') });
    }
  }

  const policies = [];
  for (const p of found) {
    // <meta> 只能放一個 policy，不以逗號拆開
    for (const part of p.kind === 'meta' ? [p.text] : p.text.split(',')) {
      const text = part.trim().replace(/;\s*$/, '');
      if (text) policies.push({ kind: p.kind, text });
    }
  }
  return policies;
}

/** 分析單一 policy，回傳可透過 IPC 傳送的純資料 */
function evaluatePolicy({ kind, text }) {
  const csp = new CspParser(text).csp;
  const findings = new CspEvaluator(csp, Version.CSP3).evaluate(PARSED_CHECKS);
  // 套件對 script-src、-attr、-elem 會各產生一次相同的「已忽略」結果，去除重複
  const seen = new Set();
  const unique = findings.filter((f) => {
    const key = [f.type, f.severity, f.directive, f.value, f.description].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    kind,
    text,
    directives: Object.entries(csp.directives).map(([name, values]) => ({ name, values: values || [] })),
    findings: unique.map((f) => ({
      type: f.type,
      severity: f.severity,
      directive: f.directive,
      value: f.value ?? null,
      description: f.description
    }))
  };
}

/** 看起來不是 CSP：沒有任何已知的指令名稱 */
function looksLikeCSP(policies) {
  return policies.some((p) => p.text.split(';').some((d) => {
    const name = d.trim().split(/\s+/)[0].toLowerCase();
    return KNOWN_DIRECTIVES.has(name);
  }));
}

/** 分析文字中的 CSP；回傳 { status: 'done', policies } 或 { status: 'error', error: { kind, message } } */
function evaluateText(input, extra = {}) {
  const text = String(input ?? '');
  if (text.length > MAX_INPUT) {
    return { status: 'error', ...extra, error: { kind: 'too-long', message: `超過 ${MAX_INPUT / 1024} KB` } };
  }
  const policies = extractPolicies(text);
  if (!policies.length || !looksLikeCSP(policies)) {
    return { status: 'error', ...extra, error: { kind: 'not-csp', message: '' } };
  }
  try {
    return { status: 'done', ...extra, policies: policies.map(evaluatePolicy) };
  } catch (err) {
    return { status: 'error', ...extra, error: { kind: 'unexpected', message: String(err && err.message || err) } };
  }
}

/** 讀取回應內容，最多 limit 位元組（大頁面不整個下載） */
async function readLimited(res, limit) {
  if (!res.body || typeof res.body.getReader !== 'function') return (await res.text()).slice(0, limit);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, limit).toString('utf8');
}

/**
 * 抓網址的 CSP 並分析。只接受 http / https。
 * 優先使用回應標頭（Content-Security-Policy、-Report-Only），都沒有時從 HTML 找 <meta>。
 * @param {string} url
 * @param {Function} fetchImpl 預設為全域 fetch；主程序傳入 Electron 的 net.fetch（走系統代理）
 */
async function evaluateURL(url, fetchImpl = globalThis.fetch) {
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return { status: 'error', url, error: { kind: 'bad-url', message: '' } };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 'error', url, error: { kind: 'bad-url', message: '只支援 http 與 https' } };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const extra = { url: parsed.href };
  try {
    const res = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
    extra.finalUrl = res.url || parsed.href;
    extra.httpStatus = res.status;

    // Headers.get 會把同名的多個標頭以 ", " 合併，正好是 CSP 的多 policy 分隔方式
    const lines = [];
    const enforce = res.headers.get('content-security-policy');
    const reportOnly = res.headers.get('content-security-policy-report-only');
    if (enforce) lines.push(`Content-Security-Policy: ${enforce}`);
    if (reportOnly) lines.push(`Content-Security-Policy-Report-Only: ${reportOnly}`);
    if (lines.length) {
      res.body?.cancel?.().catch(() => {});
      return evaluateText(lines.join('\n'), { ...extra, from: 'header' });
    }

    const type = res.headers.get('content-type') || '';
    if (/html/i.test(type)) {
      const meta = metaPolicies(await readLimited(res, MAX_HTML));
      if (meta.length) {
        const html = meta.map((m) => `<meta http-equiv="Content-Security-Policy" content="${m.text.replace(/"/g, '&quot;')}">`).join('\n');
        return evaluateText(html, { ...extra, from: 'meta' });
      }
    } else {
      res.body?.cancel?.().catch(() => {});
    }
    return { status: 'error', ...extra, error: { kind: 'no-csp', message: '' } };
  } catch (err) {
    const kind = ac.signal.aborted ? 'timeout' : 'network';
    return { status: 'error', ...extra, error: { kind, message: String(err && err.message || err) } };
  } finally {
    clearTimeout(timer);
  }
}

/** 整段文字只有一個 http(s) 網址時視為網址模式 */
function isURL(text) {
  return /^https?:\/\/\S+$/i.test(String(text ?? '').trim());
}

/**
 * 入口：文字是網址就抓取，否則直接分析。
 * @returns {Promise<object>} { status: 'done' | 'error', policies?, error?, url?, finalUrl?, httpStatus?, from?, elapsed }
 */
async function evaluateCSP(text, fetchImpl) {
  const t0 = Date.now();
  const r = isURL(text) ? await evaluateURL(text, fetchImpl) : evaluateText(text);
  return { ...r, elapsed: Date.now() - t0 };
}

module.exports = { evaluateCSP, extractPolicies, isURL };
