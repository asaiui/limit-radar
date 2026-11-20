// 表示用の整形（vscode に依存しない）

function untilText(date, now = Date.now()) {
  if (!date) return '';
  const ms = date.getTime() - now;
  if (ms <= 0) return 'まもなくリセット';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `あと${d}日${h}時間`;
  if (h > 0) return `あと${h}時間${m}分`;
  return `あと${m}分`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function dateText(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]}) ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function agoText(date, now = Date.now()) {
  if (!date) return '';
  const min = Math.floor((now - date.getTime()) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

// 枠の経過割合(%)。この値より使用率が高ければ「ペースが速い」
function elapsedPercent(w, now = Date.now()) {
  if (!w.resetsAt || !w.windowMinutes) return null;
  const total = w.windowMinutes * 60000;
  const left = w.resetsAt.getTime() - now;
  if (left <= 0 || left > total) return null;
  return Math.round(((total - left) / total) * 1000) / 10;
}

function level(percent, warn, critical) {
  if (percent >= critical) return 'critical';
  if (percent >= warn) return 'warn';
  return 'ok';
}

function maxUsed(result) {
  if (!result || !result.windows || result.windows.length === 0) return null;
  return Math.max(...result.windows.map((w) => w.usedPercent));
}

function pct(n) {
  return `${Math.round(n)}%`;
}

module.exports = { untilText, dateText, agoText, elapsedPercent, level, maxUsed, pct };
