// Codex: ~/.codex/sessions/YYYY/MM/DD/*.jsonl に記録される rate_limits を読む（通信なし）
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

const TAIL_BYTES = 512 * 1024;
const DAY_DIRS_TO_SCAN = 3;
const FILES_TO_CHECK = 5;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

async function subdirsDesc(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  } catch {
    return [];
  }
}

// 新しい日付フォルダから順に .jsonl を集め、更新日時の新しい順に返す
async function recentSessionFiles() {
  const root = path.join(codexHome(), 'sessions');
  const files = [];
  let days = 0;
  outer: for (const y of await subdirsDesc(root)) {
    for (const m of await subdirsDesc(path.join(root, y))) {
      for (const d of await subdirsDesc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        for (const name of await fsp.readdir(dir).catch(() => [])) {
          if (!name.endsWith('.jsonl')) continue;
          const p = path.join(dir, name);
          const st = await fsp.stat(p).catch(() => null);
          if (st) files.push({ path: p, mtime: st.mtimeMs, size: st.size });
        }
        if (++days >= DAY_DIRS_TO_SCAN) break outer;
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, FILES_TO_CHECK);
}

async function readTail(file) {
  const fh = await fsp.open(file.path, 'r');
  try {
    const len = Math.min(file.size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, file.size - len);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

// ファイル末尾から最後の rate_limits 付きイベントを探す
async function lastRateLimits(file) {
  const lines = (await readTail(file)).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"rate_limits"')) continue;
    try {
      const obj = JSON.parse(line);
      const rl = obj && obj.payload && obj.payload.rate_limits;
      if (rl && (rl.primary || rl.secondary)) {
        return { rl, timestamp: new Date(obj.timestamp) };
      }
    } catch {
      // 末尾読みで行頭が欠けた行などは無視
    }
  }
  return null;
}

function toWindow(key, label, w) {
  if (!w) return null;
  const resetsAt = w.resets_at ? new Date(w.resets_at * 1000) : null;
  const resetPassed = resetsAt != null && resetsAt.getTime() <= Date.now();
  return {
    key,
    label,
    usedPercent: resetPassed ? 0 : Number(w.used_percent) || 0,
    resetsAt: resetPassed ? null : resetsAt,
    windowMinutes: w.window_minutes || null,
    resetPassed,
  };
}

function labelFor(w, fallback) {
  if (!w || !w.window_minutes) return fallback;
  if (w.window_minutes === 300) return '5時間';
  if (w.window_minutes === 10080) return '週間';
  if (w.window_minutes % 1440 === 0) return `${w.window_minutes / 1440}日`;
  if (w.window_minutes % 60 === 0) return `${w.window_minutes / 60}時間`;
  return `${w.window_minutes}分`;
}

async function fetchCodex() {
  const files = await recentSessionFiles();
  if (files.length === 0) {
    throw new Error('Codex のセッションログが見つかりません');
  }
  let best = null;
  for (const f of files) {
    const found = await lastRateLimits(f).catch(() => null);
    if (found && (!best || found.timestamp > best.timestamp)) best = found;
  }
  if (!best) {
    throw new Error('直近のログに使用量情報がありません（Codex を一度使うと記録されます）');
  }
  const { rl, timestamp } = best;
  const windows = [
    toWindow('primary', labelFor(rl.primary, '短期'), rl.primary),
    toWindow('secondary', labelFor(rl.secondary, '長期'), rl.secondary),
  ].filter(Boolean);
  const anyReset = windows.some((w) => w.resetPassed);
  return {
    plan: rl.plan_type || null,
    asOf: timestamp,
    windows,
    note: anyReset
      ? '最後の記録以降にリセット時刻を過ぎた枠は 0% として表示しています'
      : '最後に Codex を使った時点の値です',
  };
}

module.exports = { id: 'codex', name: 'Codex', icon: 'terminal', fetch: fetchCodex };
