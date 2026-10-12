// 艾奧傑亞時間 (Eorzea Time)
// 1 艾奧傑亞天 = 70 分鐘現實時間 → 時間流速為現實的 3600/175 ≈ 20.5714 倍
// ET 直接由 Unix 時間 × 倍率計算（與遊戲內相同的算法）
const EORZEA_MULTIPLIER = 3600 / 175;

function eorzeaTime(now = Date.now()) {
  const etMs = now * EORZEA_MULTIPLIER;
  const totalMinutes = Math.floor(etMs / 60000);
  return { h: Math.floor(totalMinutes / 60) % 24, m: totalMinutes % 60 };
}

const pad = (n) => String(n).padStart(2, '0');

const els = {
  body: document.body,
  panel: document.getElementById('panel'),
  content: document.getElementById('content'),
  label: document.getElementById('label'),
  time: document.getElementById('time'),
  sub: document.getElementById('sub')
};

let mode = 'et'; // 'et' | 'lt'

function render() {
  const now = new Date();
  const et = eorzeaTime(now.getTime());
  const etText = `${pad(et.h)}:${pad(et.m)}`;
  const ltText = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (mode === 'et') {
    els.label.textContent = '艾奧傑亞時間';
    els.time.textContent = etText;
    els.sub.innerHTML = `本地時間 <b>${ltText}</b>`;
  } else {
    els.label.textContent = '本地時間';
    els.time.textContent = ltText;
    els.sub.innerHTML = `艾奧傑亞時間 <b>${etText}</b>`;
  }
}

function setMode(next, animate) {
  mode = next;
  els.body.dataset.mode = mode;
  render();
  if (animate) {
    els.content.classList.remove('swap');
    void els.content.offsetWidth; // 重新觸發動畫
    els.content.classList.add('swap');
  }
}

els.panel.addEventListener('click', () => {
  setMode(mode === 'et' ? 'lt' : 'et', true);
  window.widget && window.widget.saveSettings({ mode });
});

// ET 每 ~2.9 秒走一分鐘，用 250ms 更新足夠即時
setInterval(render, 250);

(async () => {
  try {
    const state = await window.widget.getState();
    if (state.settings && (state.settings.mode === 'et' || state.settings.mode === 'lt')) {
      mode = state.settings.mode;
    }
  } catch { /* 在一般瀏覽器開啟時沒有 widget API */ }
  setMode(mode, false);
})();
