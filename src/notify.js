// 通知の重複防止（vscode に依存しない）
//
// 同じサービス・同じ枠・同じレベル（warn / critical）の通知は、そのリセットまでに1回だけ出す。
// Claude の API はリセット時刻をミリ秒単位で毎回少しずつずらして返すため、
// リセット時刻は完全一致ではなく TOLERANCE_MS 以内なら同じ枠とみなす。

const TOLERANCE_MS = 30 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function isEntry(h) {
  return h && typeof h === 'object' && typeof h.resetsAt === 'number';
}

function alreadyNotified(history, entry) {
  return history.some(
    (h) =>
      isEntry(h) &&
      h.service === entry.service &&
      h.window === entry.window &&
      h.level === entry.level &&
      Math.abs(h.resetsAt - entry.resetsAt) < TOLERANCE_MS
  );
}

// リセットから1日以上たった記録と、旧形式の記録を捨てる
function prune(history, now = Date.now()) {
  return history.filter((h) => isEntry(h) && h.resetsAt > now - KEEP_MS).slice(-MAX_ENTRIES);
}

module.exports = { alreadyNotified, prune, TOLERANCE_MS };
