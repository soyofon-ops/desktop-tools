// JWT 解碼結果視窗：資料由儀表盤的 JWT 解碼工具傳入（window.popup.getData）
const $ = (id) => document.getElementById(id);
let data = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 已排版 JSON 的語法上色（先跳脫 HTML，再包上 span） */
function highlight(json) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let last = 0;
  for (const m of json.matchAll(re)) {
    out += esc(json.slice(last, m.index));
    if (m[1]) out += `<span class="${m[2] ? 'k' : 's'}">${esc(m[1])}</span>${m[2] ? esc(m[2]) : ''}`;
    else if (m[3]) out += `<span class="l">${m[3]}</span>`;
    else out += `<span class="n">${m[4]}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(json.slice(last));
}

const pad = (n) => String(n).padStart(2, '0');
function formatTime(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 相對時間，例如「2 小時 5 分」「3 天 4 小時」 */
function duration(ms) {
  const m = Math.floor(Math.abs(ms) / 60000);
  if (m < 1) return '不到 1 分鐘';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return h ? `${d} 天 ${h} 小時` : `${d} 天`;
  if (h) return mm ? `${h} 小時 ${mm} 分` : `${h} 小時`;
  return `${mm} 分`;
}
const relative = (sec) => {
  const diff = sec * 1000 - Date.now();
  return diff >= 0 ? `${duration(diff)}後` : `${duration(diff)}前`;
};

function renderStatus() {
  const { exp, nbf } = data.claims || {};
  const now = Date.now();
  let cls;
  let badge;
  let detail;
  if (Number.isFinite(nbf) && now < nbf * 1000) {
    cls = 'pending'; badge = '尚未生效'; detail = `${duration(nbf * 1000 - now)}後生效（${formatTime(nbf)}）`;
  } else if (Number.isFinite(exp) && now >= exp * 1000) {
    cls = 'expired'; badge = '已過期'; detail = `${duration(now - exp * 1000)}前過期（${formatTime(exp)}）`;
  } else if (Number.isFinite(exp)) {
    cls = 'valid'; badge = '有效'; detail = `剩 ${duration(exp * 1000 - now)}（${formatTime(exp)} 到期）`;
  } else {
    cls = 'none'; badge = '未設定到期時間'; detail = data.payloadIsJson ? '沒有 exp 欄位' : 'Payload 不是 JSON';
  }
  $('status').className = `status ${cls}`;
  $('badge').textContent = badge;
  $('detail').textContent = detail;
  $('detail').title = detail;

  const labels = { exp: '到期 exp', nbf: '生效 nbf', iat: '簽發 iat' };
  const rows = ['iat', 'nbf', 'exp'].filter((k) => Number.isFinite((data.claims || {})[k]));
  $('times').hidden = rows.length === 0;
  $('times').innerHTML = rows.map((k) => {
    const v = data.claims[k];
    return `<span class="name">${labels[k]}</span><span class="when">${formatTime(v)}</span><span class="rel">${relative(v)}</span>`;
  }).join('');
}

function render(d) {
  if (!d) return;
  data = d;
  document.body.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  $('chips').innerHTML = [d.alg, d.typ].filter(Boolean).map((t) => `<span class="chip mono">${esc(t)}</span>`).join('');
  $('header').innerHTML = highlight(d.header);
  $('payload').innerHTML = d.payloadIsJson ? highlight(d.payload) : esc(d.payload);
  $('signature').textContent = d.signature || '（沒有簽章）';
  renderStatus();
  document.querySelector('.content').scrollTop = 0;
}

// ---- 複製 ----
document.querySelectorAll('.copy').forEach((btn) => {
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!data) return;
    await window.popup.copyText(data[btn.dataset.copy] ?? '');
    btn.classList.add('done');
    const label = btn.querySelector('span');
    const original = label.dataset.text || label.textContent;
    label.dataset.text = original;
    label.textContent = '已複製';
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.classList.remove('done');
      label.textContent = original;
    }, 1500);
  });
});

// ---- 關閉 ----
$('close').addEventListener('click', () => window.popup.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popup.close();
});

// 剩餘時間每 15 秒更新一次
setInterval(() => data && renderStatus(), 15000);

window.popup.onData(render);
window.popup.getData().then(render);
