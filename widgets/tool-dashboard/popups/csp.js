// CSP 檢查結果視窗：資料由儀表盤的 CSP 檢查工具傳入（window.popup.getData）
// data: { state: 'loading' | 'done', input, status: 'done' | 'error', policies, error, url, finalUrl, httpStatus, from, elapsed, theme }
// policies[]: { kind: 'enforce' | 'report-only' | 'meta', text, directives: [{ name, values }], findings: [{ type, severity, directive, value, description }] }
// 注意：policy 內容可能來自任意網站，一律用 textContent 顯示，不組 HTML。
const $ = (id) => document.getElementById(id);
let data = null;
const VALUES_PREVIEW = 6; // 每個指令先顯示幾個沒有問題的來源

// ---- 嚴重度（對應 csp_evaluator 的 Severity 數值）----
const SEVERITY = {
  10: { key: 'high', label: '高風險' },
  20: { key: 'syntax', label: '語法錯誤' },
  30: { key: 'medium', label: '中風險' },
  40: { key: 'high-maybe', label: '可能高風險' },
  45: { key: 'strict', label: '建議' },
  50: { key: 'medium-maybe', label: '可能有風險' },
  60: { key: 'info', label: '資訊' },
  100: { key: 'none', label: '已忽略' }
};
const sevOf = (n) => SEVERITY[n] || { key: 'info', label: '資訊' };

const KIND_LABEL = {
  enforce: '強制執行',
  'report-only': 'Report-Only（只回報，不阻擋）',
  meta: '<meta> 標籤'
};

const ERRORS = {
  'not-csp': ['不是 CSP', '剪貼簿內容沒有可辨識的 CSP 指令'],
  'too-long': ['內容太長', ''],
  'bad-url': ['不是有效的網址', ''],
  'no-csp': ['這個網址沒有設定 CSP', '回應標頭沒有 Content-Security-Policy，HTML 中也沒有 <meta> CSP'],
  timeout: ['讀取逾時', '10 秒內沒有收到回應'],
  network: ['無法連線', ''],
  unexpected: ['分析時發生錯誤', '']
};

/** 把 csp_evaluator 的英文說明轉成中文；對不到的類型保留英文原文 */
function translate(f) {
  const v = f.value || '';
  const d = f.directive || '';
  const desc = f.description || '';
  switch (f.type) {
    case 100: return `「${v}」看起來是指令名稱而不是值，可能漏了分號`;
    case 101: return /colon/.test(desc) ? '指令名稱後面不需要加冒號' : `「${d}」不是已知的 CSP 指令`;
    case 102: return /single-ticks/.test(desc)
      ? `「${v}」可能少了單引號，關鍵字要寫成 '${v}'`
      : `${v} 不是有效的 CSP 關鍵字`;
    case 106: return 'nonce 只應使用 base64 字元';
    case 300:
      if (d === 'object-src') return "缺少 object-src，可能被注入能執行 JavaScript 的外掛，建議設為 'none'";
      if (d === 'script-src') return '缺少 script-src（也沒有 default-src），任何來源的腳本都能執行';
      if (d === 'base-uri') return "缺少 base-uri，攻擊者可插入 <base> 標籤，把相對路徑的腳本導向自己的網域，建議設為 'none' 或 'self'";
      return desc;
    case 301: return "'unsafe-inline' 允許執行頁面內的腳本與事件處理器（onclick 等），XSS 可以直接利用";
    case 302: return "'unsafe-eval' 允許 eval() 等把字串當成程式執行的 API";
    case 303: return `${d} 允許任何 ${v} 網址的腳本，形同沒有限制`;
    case 304: return `${d} 不應允許 '*' 任意來源`;
    case 305: {
      if (f.severity === 10) {
        const m = desc.match(/^(\S+) is known to host (.+?) which allow/);
        if (!m) return desc;
        const what = m[2].replace('JSONP endpoints', 'JSONP 端點').replace('Angular libraries', 'AngularJS 函式庫').replace(' and ', '與');
        return `${m[1]} 已知提供 ${what}，可用來繞過這個 CSP`;
      }
      if (v === "'self'") return "網站有 JSONP、AngularJS 或使用者上傳的檔案時，'self' 可能被用來繞過 CSP";
      return '沒有已知的繞過方式；請確認這個網址不提供 JSONP 回應或 AngularJS 函式庫';
    }
    case 306: {
      const m = desc.match(/^(\S+) is known to host Flash/);
      return m ? `${m[1]} 已知提供 Flash 檔案，可用來繞過這個 CSP` : "object-src 能不能只設為 'none'？";
    }
    case 307: return 'nonce 至少要 8 個字元';
    case 308: return /localhost/.test(desc)
      ? `${d} 允許 localhost，正式環境請移除`
      : `${d} 使用 IP 位址作為來源（瀏覽器會忽略）`;
    case 309: {
      const map = {
        'reflected-xss': 'reflected-xss 從 CSP2 起已棄用，請改用 X-XSS-Protection 標頭',
        referrer: 'referrer 從 CSP2 起已棄用，請改用 Referrer-Policy 標頭',
        'disown-opener': 'disown-opener 從 CSP3 起已棄用，請改用 Cross-Origin-Opener-Policy 標頭',
        'prefetch-src': 'prefetch-src 從 CSP3 起已棄用，隨時可能失效'
      };
      return map[d] || desc;
    }
    case 310: return d === 'report-uri' ? '請用 HTTPS 傳送違規回報' : '只允許透過 HTTPS 下載的資源';
    case 317: return "'unsafe-hashes' 比 'unsafe-inline' 安全，但只要雜湊值列在 CSP 中，頁面內的腳本與事件處理器仍可執行；可以的話請改寫成不使用行內腳本";
    case 400: return "網域白名單常常可以被繞過，建議改用 'strict-dynamic' 搭配 nonce 或 hash";
    case 401: return "'strict-dynamic' 沒有搭配 nonce 或 hash 時會擋下所有腳本";
    case 403: return "建議加上 'unsafe-inline'（支援 nonce／hash 的瀏覽器會忽略它），以相容舊瀏覽器";
    case 404: return "建議加上 https: 與 http:（支援 'strict-dynamic' 的瀏覽器會忽略它們），以相容舊瀏覽器";
    case 405: return /unsafe-inline/.test(desc)
      ? "有 nonce 或 hash 時，'unsafe-inline' 會被忽略（CSP2 以上）"
      : "因為有 'strict-dynamic'，這個來源在 CSP3 以上會被忽略";
    case 500: return "建議加上 require-trusted-types-for 'script'，用 Trusted Types 鎖住 DOM XSS 的注入點";
    case 600: return '沒有設定違規回報位置（report-uri／report-to），之後較難維護與發現問題';
    case 601: return '只用 report-to 設定回報位置，目前只有 Chromium 系瀏覽器支援，建議同時加上 report-uri';
    default: return desc;
  }
}

const bySeverity = (a, b) => a.severity - b.severity;
const worst = (findings) => findings.reduce((m, f) => Math.min(m, f.severity), Infinity);

/** 依指令整理：每個指令的值與各自的發現；policy 中沒有但被提到的指令列在最後，標示「未設定」 */
function groupByDirective(policy) {
  const groups = policy.directives.map((d) => ({ name: d.name, values: d.values, missing: false, findings: [] }));
  const find = (name) => groups.find((g) => g.name === name);
  for (const f of policy.findings) {
    let g = find(f.directive);
    if (!g) {
      g = { name: f.directive, values: [], missing: true, findings: [] };
      groups.push(g);
    }
    g.findings.push(f);
  }
  return groups;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function msgItem(f) {
  const sev = sevOf(f.severity);
  const m = el('div', `msg sev-${sev.key}`);
  m.append(el('b', null, sev.label), translate(f));
  m.title = f.description; // 原文英文說明
  return m;
}

function renderDirective(g) {
  const w = worst(g.findings.filter((f) => f.severity < 100)); // 「已忽略」不影響指令的標示
  const box = el('div', `dir ${Number.isFinite(w) ? 'sev-' + sevOf(w).key : ''}`);
  const head = el('div', 'dir-head');
  head.append(el('span', 'name', g.name));
  if (g.missing) head.append(el('span', 'missing', '未設定'));
  if (Number.isFinite(w)) head.append(el('span', 'badge', sevOf(w).label));
  box.append(head);

  // 針對特定值的發現，掛在該值底下；其餘（整個指令）列在後面
  // 來源很多時，沒有發現的值只先顯示前幾個，其餘收合
  const used = new Set();
  if (g.values.length) {
    const ul = el('ul', 'vals');
    const hidden = [];
    let clean = 0;
    for (const v of g.values) {
      const fs = g.findings.filter((f) => f.value === v).sort(bySeverity);
      fs.forEach((f) => used.add(f));
      const li = el('li', fs.length ? `sev-${sevOf(worst(fs)).key}` : '');
      li.append(el('code', null, v));
      fs.forEach((f) => li.append(msgItem(f)));
      if (!fs.length && ++clean > VALUES_PREVIEW && g.values.length > VALUES_PREVIEW + 2) {
        li.hidden = true;
        hidden.push(li);
      }
      ul.append(li);
    }
    box.append(ul);
    if (hidden.length) {
      const more = el('button', 'more', `顯示其他 ${hidden.length} 個來源`);
      more.addEventListener('click', () => {
        hidden.forEach((li) => { li.hidden = false; });
        more.remove();
      });
      box.append(more);
    }
  }
  g.findings.filter((f) => !used.has(f)).sort(bySeverity).forEach((f) => box.append(msgItem(f)));
  return box;
}

const COPY_ICON = '<svg class="icon cp" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon ok" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderPolicies(policies) {
  const root = $('policies');
  root.replaceChildren();
  policies.forEach((p, i) => {
    const sec = el('section');
    const head = el('div', 'sec-head');
    const h2 = el('h2', null, policies.length > 1 ? `POLICY ${i + 1}` : 'POLICY');
    h2.append(el('span', 'policy-kind', KIND_LABEL[p.kind] || ''));
    const btn = el('button', 'copy');
    btn.dataset.copy = `policy:${i}`;
    btn.innerHTML = COPY_ICON; // 固定的圖示字串，不含外部資料
    btn.append(el('span', null, '複製'));
    head.append(h2, btn);
    const list = el('div', 'dirs');
    groupByDirective(p).forEach((g) => list.append(renderDirective(g)));
    sec.append(head, list);
    root.append(sec);
  });
}

function renderFacts(d) {
  const dl = $('facts');
  dl.replaceChildren();
  const add = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
  if (d.url) {
    add('網址', d.url);
    if (d.finalUrl && d.finalUrl !== d.url) add('導向至', d.finalUrl);
    if (d.httpStatus) add('HTTP 狀態', String(d.httpStatus));
    if (d.from) add('CSP 來源', d.from === 'meta' ? 'HTML 的 <meta> 標籤' : '回應標頭');
  }
  if (d.state === 'done' && d.elapsed != null) add('耗時', `${d.elapsed} ms`);
  dl.hidden = !dl.childElementCount;
}

function render(d) {
  if (!d) return;
  data = d;
  document.body.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  const chips = $('chips');
  chips.replaceChildren(el('span', 'chip', d.url ? '網址' : '剪貼簿'));

  const v = $('verdict');
  const counts = $('counts');
  counts.replaceChildren();
  $('policies').replaceChildren();
  $('report-actions').hidden = true;
  renderFacts(d);

  if (d.state !== 'done') {
    v.className = 'verdict loading';
    $('title').textContent = '讀取中…';
    $('desc').textContent = d.input || '';
    return;
  }

  if (d.status !== 'done') {
    const kind = (d.error && d.error.kind) || 'unexpected';
    const [title, desc] = ERRORS[kind] || ERRORS.unexpected;
    v.className = 'verdict error';
    $('title').textContent = title;
    $('desc').textContent = desc || (d.error && d.error.message) || '';
    return;
  }

  // 摘要：依嚴重度計數（已忽略的不算）
  const all = d.policies.flatMap((p) => p.findings).filter((f) => f.severity < 100);
  const tally = new Map();
  for (const f of all) tally.set(f.severity, (tally.get(f.severity) || 0) + 1);
  [...tally.keys()].sort((a, b) => a - b).forEach((s) => {
    counts.append(el('span', `count sev-${sevOf(s).key}`, `${sevOf(s).label} ${tally.get(s)}`));
  });

  // 判定只看風險類（Severity 數值不是單調的：建議 45 介於可能高風險 40 與可能有風險 50 之間）
  const w = worst(all.filter((f) => f.severity !== 45 && f.severity < 60));
  if (w <= 10) {
    v.className = 'verdict sev-high';
    $('title').textContent = '有高風險設定';
    $('desc').textContent = '這個 CSP 擋不住常見的 XSS，請優先處理紅色項目';
  } else if (w <= 40) {
    v.className = `verdict sev-${sevOf(w).key}`;
    $('title').textContent = w === 20 ? '有語法錯誤' : '有需要注意的設定';
    $('desc').textContent = w === 20 ? '瀏覽器可能會忽略寫錯的部分' : '部分設定可能削弱保護效果';
  } else if (w === 50) {
    v.className = 'verdict sev-medium-maybe';
    $('title').textContent = '可能有風險';
    $('desc').textContent = '視網站內容而定，請確認標示的來源';
  } else {
    v.className = 'verdict sev-ok';
    $('title').textContent = '沒有發現明顯問題';
    $('desc').textContent = all.length ? '只剩建議事項' : '';
  }

  renderPolicies(d.policies);
  $('report-actions').hidden = false;
  document.querySelector('.content').scrollTop = 0;
}

/** 純文字報告（複製用） */
function reportText(d) {
  const lines = [];
  if (d.url) lines.push(`網址：${d.finalUrl || d.url}`, '');
  d.policies.forEach((p, i) => {
    lines.push(`[Policy ${i + 1}｜${KIND_LABEL[p.kind] || p.kind}]`, p.text, '');
    const fs = p.findings.filter((f) => f.severity < 100).sort(bySeverity);
    if (!fs.length) lines.push('（沒有發現）');
    for (const f of fs) {
      const where = f.value ? `${f.directive} ${f.value}` : f.directive;
      lines.push(`- ${sevOf(f.severity).label}｜${where}：${translate(f)}`);
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

function copyValue(key) {
  if (!data || data.status !== 'done') return '';
  if (key === 'report') return reportText(data);
  const m = /^policy:(\d+)$/.exec(key || '');
  return m && data.policies[m[1]] ? data.policies[m[1]].text : '';
}

// ---- 複製（按鈕是動態產生的，用事件委派）----
const copyTimers = new WeakMap();
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const text = copyValue(btn.dataset.copy);
  if (!text) return;
  await window.popup.copyText(text);
  btn.classList.add('done');
  const label = btn.querySelector('span');
  if (!label.dataset.text) label.dataset.text = label.textContent;
  label.textContent = '已複製';
  clearTimeout(copyTimers.get(btn));
  copyTimers.set(btn, setTimeout(() => {
    btn.classList.remove('done');
    label.textContent = label.dataset.text;
  }, 1500));
});

// ---- 關閉 ----
$('close').addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
});

window.popup.onData(render);
window.popup.getData().then(render);
