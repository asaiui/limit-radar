#!/usr/bin/env node
// Limit Radar — Claude Code ステータスライン中継スクリプト
//
// Claude Code がステータスライン用に渡す JSON から rate_limits（5時間・週間の使用率とリセット時刻）
// だけを取り出し、このファイルと同じフォルダの rate_limits.json に保存する。
// それ以外の情報（会話内容・パス・モデル名など）は保存しない。通信もしない。
// 以前に別のステータスラインを設定していた場合は、同じ入力でそれを実行して表示をそのまま引き継ぐ。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'rate_limits.json');
const CONFIG_FILE = path.join(DIR, 'config.json');
const LAST_RUN_FILE = path.join(DIR, 'last_run.json');
const PREVIOUS_TIMEOUT_MS = 5000;

function pickWindow(w) {
  if (!w || typeof w !== 'object') return undefined;
  const used = Number(w.used_percentage);
  const resets = Number(w.resets_at);
  if (!Number.isFinite(used)) return undefined;
  return { used_percentage: used, resets_at: Number.isFinite(resets) ? resets : null };
}

function writeAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

function saveRateLimits(input) {
  let json = null;
  try {
    json = JSON.parse(input);
  } catch {}
  const rl = json && json.rate_limits;
  const hasRateLimits = !!rl && typeof rl === 'object';
  // 拡張側で「呼ばれていない」と「呼ばれたが使用率が無い」を区別するための記録
  writeAtomic(LAST_RUN_FILE, { at: Date.now(), hasRateLimits });
  // rate_limits はセッションの最初の応答前などには含まれない。その場合は前回の値を残す
  if (!hasRateLimits) return;
  writeAtomic(DATA_FILE, {
    writtenAt: Date.now(),
    rate_limits: {
      five_hour: pickWindow(rl.five_hour),
      seven_day: pickWindow(rl.seven_day),
    },
  });
}

function previousCommand() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const prev = cfg && cfg.previous;
    return prev && prev.type === 'command' && typeof prev.command === 'string' ? prev.command : null;
  } catch {
    return null;
  }
}

function runPrevious(input) {
  const cmd = previousCommand();
  if (!cmd) return;
  const child = spawn(cmd, { shell: true, stdio: ['pipe', 'inherit', 'ignore'] });
  const timer = setTimeout(() => child.kill(), PREVIOUS_TIMEOUT_MS);
  child.on('exit', () => clearTimeout(timer));
  child.on('error', () => clearTimeout(timer));
  child.stdin.on('error', () => {});
  child.stdin.end(input);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  saveRateLimits(input);
  runPrevious(input);
});
