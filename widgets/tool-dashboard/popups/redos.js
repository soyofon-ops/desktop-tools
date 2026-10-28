// ReDoS 檢查結果視窗：資料由儀表盤的 ReDoS 檢查工具傳入（window.popup.getData）
// data: { state: 'loading' | 'done', source, flags, status, checker, complexity, hotspot, attack, error, elapsed, theme }
const $ = (id) => document.getElementById(id);
const ATTACK_PREVIEW = 160; // 攻擊字串只預覽前面這些字元
let data = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 顯示 /pattern/flags，並把 hotspot 範圍包上標示 */
function renderPattern(source, flags, hotspot) {
  const spots = (hotspot || [])
    .filter((h) => h.end > h.start && h.start >= 0 && h.end <= source.length)
    .sort((a, b) => a.start - b.start);
  let html = '';
  let pos = 0;
  for (const h of spots) {
    if (h.start < pos) continue; // 重疊的略過
    html += esc(source.slice(pos, h.start));
    html += `<mark class="${h.temperature === 'heat' ? 'heat' : 'warm'}">${esc(source.slice(h.start, h.end))}</mark>`;
    pos = h.end;
  }
  html += esc(source.slice(pos));
  $('pattern').innerHTML = `<span class="delim">/</span>${html}<span class="delim">/</span><span class="flags">${esc(flags)}</span>`;
}

const sup = (n) => String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c] || c).join('');

function complexityText(c) {
  if (!c) return '';
  switch (c.type) {
    case 'constant': return '常數 O(1)';
    case 'linear': return '線性 O(n)';
    case 'safe': return '沒有超線性回溯';
    case 'polynomial': return `多項式 O(n${sup(c.degree || 2)})`;
    case 'exponential': return '指數 O(2ⁿ)';
    default: return c.summary || c.type;
  }
}

const ERRORS = {
  timeout: ['分析逾時', '這個正規表示式太複雜，10 秒內無法完成分析'],
  invalid: ['不是有效的正規表示式', ''],
  unsupported: ['包含不支援的語法', ''],
  cancel: ['分析已取消', ''],
  'too-long': ['正規表示式太長', ''],
  unexpected: ['分析時發生錯誤', '']
};

function render(d) {
  if (!d) return;
  data = d;
  document.body.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  $('chips').innerHTML = d.flags ? `<span class="chip mono">${esc(d.flags)}</span>` : '';
  const done = d.state === 'done';
  const vuln = done && d.status === 'vulnerable'; // 分析完成前不顯示任何結果
  renderPattern(d.source, d.flags, vuln ? d.hotspot : []);

  const v = $('verdict');
  $('facts').hidden = !done || d.status === 'unknown';
  $('sec-attack').hidden = !vuln || !d.attack;
  $('sec-tips').hidden = !vuln;

  if (!done) {
    v.className = 'verdict loading';
    $('title').textContent = '分析中…';
    $('desc').textContent = '正在檢查是否有災難性回溯';
    return;
  }

  if (d.status === 'safe') {
    v.className = 'verdict safe';
    $('title').textContent = '安全';
    $('desc').textContent = '沒有發現 ReDoS 風險，比對時間不會因特定輸入而暴增';
  } else if (vuln) {
    v.className = 'verdict vulnerable';
    $('title').textContent = '有 ReDoS 風險';
    $('desc').textContent = d.complexity && d.complexity.type === 'exponential'
      ? '輸入稍微變長，比對時間就會成倍增加，可能卡住整個程式'
      : '輸入越長比對越慢，長字串可能造成明顯延遲';
  } else {
    const [title, desc] = ERRORS[(d.error && d.error.kind) || 'unexpected'] || ERRORS.unexpected;
    v.className = 'verdict unknown';
    $('title').textContent = title;
    $('desc').textContent = desc || (d.error && d.error.message) || '';
  }

  $('f-complexity').textContent = complexityText(d.complexity);
  $('f-checker').textContent = d.checker === 'fuzz'
    ? '模糊測試（沒找到攻擊字串不代表一定安全）'
    : '自動機分析（結果確定）';
  $('f-elapsed').textContent = `${d.elapsed} ms`;
  $('f-hot-label').hidden = !vuln || !(d.hotspot && d.hotspot.length);
  $('f-hot').hidden = $('f-hot-label').hidden;

  if (vuln && d.attack) {
    const s = d.attack.string;
    $('attack').textContent = d.attack.pattern;
    $('attack').title = s.length > ATTACK_PREVIEW ? `${s.slice(0, ATTACK_PREVIEW)}…` : s;
    const label = `複製攻擊字串（${s.length.toLocaleString()} 字元）`;
    $('attack-len').textContent = label;
    $('attack-len').dataset.text = label;
  }
  document.querySelector('.content').scrollTop = 0;
}

// ---- 複製 ----
function copyValue(key) {
  if (!data) return '';
  if (key === 'literal') return `/${data.source}/${data.flags || ''}`;
  if (key === 'attackPattern') return data.attack ? data.attack.pattern : '';
  if (key === 'attackString') return data.attack ? data.attack.string : '';
  return '';
}

document.querySelectorAll('.copy').forEach((btn) => {
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!data) return;
    await window.popup.copyText(copyValue(btn.dataset.copy));
    btn.classList.add('done');
    const label = btn.querySelector('span');
    const original = label.dataset.text || label.textContent;
    label.dataset.text = original;
    label.textContent = '已複製';
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.classList.remove('done');
      label.textContent = label.dataset.text || original;
    }, 1500);
  });
});

// ---- 關閉 ----
$('close').addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
});

window.popup.onData(render);
window.popup.getData().then(render);
