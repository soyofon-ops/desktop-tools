// 角色的每日排程：判斷何時該觸發，以及定期檢查的計時器（不涉及實際送出訊息）
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIME = '09:00';
const CHECK_INTERVAL_MS = 30 * 1000; // 用短週期檢查，電腦睡眠或調整時鐘後才不會錯過
const RESUME_DELAY_MS = 10 * 1000;   // 電腦剛喚醒時網路通常還沒恢復，稍等再檢查

const pad = (n) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD */
function localDate(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 本地時間 HH:MM */
function localTime(now) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** 今天的時間已過且今天還沒跑過，就該觸發（也涵蓋錯過時間後的當天補跑） */
function isDue(schedule, now) {
  if (!schedule || !schedule.enabled || !TIME_RE.test(schedule.time)) return false;
  return (schedule.lastRun || '') < localDate(now) && localTime(now) >= schedule.time;
}

/**
 * 驗證編輯視窗傳入的排程，回傳要儲存的內容（沒有任何設定時回傳 null）。
 * 啟用或改時間時，若今天的時間已過，把今天記為已執行，避免一儲存就立刻觸發。
 */
function normalizeSchedule(input, prev, now) {
  const enabled = !!(input && input.enabled);
  const rawTime = String((input && input.time) || '');
  const message = String((input && input.message) || '').trim();
  if (enabled && !TIME_RE.test(rawTime)) throw new Error('請設定排程時間');
  if (enabled && !message) throw new Error('請填寫排程要送出的訊息');
  if (!enabled && !message && !prev) return null;
  const time = TIME_RE.test(rawTime) ? rawTime : DEFAULT_TIME;
  const sameTiming = !!prev && !!prev.enabled === enabled && prev.time === time;
  const lastRun = sameTiming ? prev.lastRun || null : (localTime(now) >= time ? localDate(now) : null);
  return { enabled, time, message, lastRun };
}

/** 啟動定期檢查，回傳停止函式。第一次檢查在一個週期之後，讓小工具視窗有時間開好 */
function startScheduler({ check, powerMonitor = null, intervalMs = CHECK_INTERVAL_MS, resumeDelayMs = RESUME_DELAY_MS }) {
  const interval = setInterval(check, intervalMs);
  let resumeTimer = null;
  const onResume = () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(check, resumeDelayMs);
  };
  if (powerMonitor) powerMonitor.on('resume', onResume);
  return () => {
    clearInterval(interval);
    clearTimeout(resumeTimer);
    if (powerMonitor) powerMonitor.removeListener('resume', onResume);
  };
}

module.exports = { isDue, normalizeSchedule, startScheduler, localDate, localTime };
