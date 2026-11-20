// Claude の使用量
//
// source = "statusline"（既定・推奨）
//   Claude Code 公式のステータスライン機能に渡される rate_limits を、中継スクリプトがファイルに保存したものを読む。
//   トークンには触れず、通信もしない。値は最後に Claude Code を使った時点のもの。
//
// source = "api"（上級者向け・自己責任）
//   Claude Code の OAuth トークンで非公開の使用量エンドポイントを問い合わせる。
//   サブスクリプションのトークンを Claude Code 以外で使うことは規約で制限されている場合があるため既定ではオフ。
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const bridge = require('../claudeStatusline');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

class NotSetupError extends Error {}

// ---------- statusline ----------

function windowFromBridge(key, label, w, windowMinutes) {
  // Claude Code はリセット時刻を過ぎた枠を rate_limits から外すので、無い枠はリセット済みとして扱う
  const resetsAt = w && w.resets_at ? new Date(w.resets_at * 1000) : null;
  const resetPassed = !w || (resetsAt != null && resetsAt.getTime() <= Date.now());
  return {
    key,
    label,
    usedPercent: resetPassed ? 0 : Number(w.used_percentage) || 0,
    resetsAt: resetPassed ? null : resetsAt,
    windowMinutes,
    resetPassed,
  };
}

async function fetchViaStatusline() {
  const st = await bridge.status();
  if (!st.installed) {
    throw new NotSetupError('Claude 連携が未セットアップです');
  }
  const data = await bridge.readData();
  if (!data || !data.rate_limits) {
    const lastRun = await bridge.readLastRun();
    if (!lastRun) {
      throw new Error(
        'Claude Code からまだ呼ばれていません。ステータスラインはターミナル版の Claude Code でのみ動きます' +
          '（VS Code の Claude 拡張やデスクトップアプリでは動きません）。それらが中心の場合は設定 limitRadar.claude.source を api にしてください（自己責任）'
      );
    }
    throw new Error(
      'Claude Code から呼ばれていますが、使用率が含まれていません（Pro / Max / Ultra プランのみ。セッションで最初の応答が返った後に記録されます）'
    );
  }
  const rl = data.rate_limits;
  return {
    plan: null,
    asOf: new Date(data.writtenAt),
    windows: [
      windowFromBridge('five_hour', '5時間', rl.five_hour, 300),
      windowFromBridge('seven_day', '週間', rl.seven_day, 10080),
    ],
    note: '最後に Claude Code を使った時点の値です',
  };
}

// ---------- api ----------

function readMacKeychain() {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim())
    );
  });
}

async function readOAuth() {
  let raw = null;
  try {
    raw = await fsp.readFile(path.join(bridge.paths().claudeDir, '.credentials.json'), 'utf8');
  } catch {
    if (process.platform === 'darwin') raw = await readMacKeychain();
  }
  if (!raw) throw new Error('Claude Code のログイン情報が見つかりません');
  const oauth = JSON.parse(raw).claudeAiOauth;
  if (!oauth || !oauth.accessToken) throw new Error('Claude のサブスクリプションでログインしていません');
  return oauth;
}

function windowFromApi(key, label, w, windowMinutes) {
  if (!w || w.utilization == null) return null;
  return {
    key,
    label,
    usedPercent: Number(w.utilization) || 0,
    resetsAt: w.resets_at ? new Date(w.resets_at) : null,
    windowMinutes,
  };
}

async function fetchViaApi() {
  const oauth = await readOAuth();
  // トークンの更新（リフレッシュ）はしない。Claude Code 側のログインを壊さないため
  if (oauth.expiresAt && oauth.expiresAt <= Date.now()) {
    throw new Error('トークンの期限切れです（Claude Code を起動すると更新されます）');
  }
  let res;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error(`通信に失敗しました: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('トークンが無効です（Claude Code で再ログインしてください）');
  if (res.status === 429) throw new Error('問い合わせが多すぎます。しばらくして自動で再試行します');
  if (!res.ok) throw new Error(`使用量の取得に失敗しました (HTTP ${res.status})`);
  const data = await res.json();
  const windows = [
    windowFromApi('five_hour', '5時間', data.five_hour, 300),
    windowFromApi('seven_day', '週間', data.seven_day, 10080),
    windowFromApi('seven_day_opus', '週間 (Opus)', data.seven_day_opus, 10080),
    windowFromApi('seven_day_sonnet', '週間 (Sonnet)', data.seven_day_sonnet, 10080),
  ].filter(Boolean);
  if (windows.length === 0) throw new Error('応答に使用量情報が含まれていません（仕様が変わった可能性があります）');
  return { plan: oauth.subscriptionType || null, asOf: new Date(), windows, note: null };
}

function fetchClaude(options = {}) {
  return options.claudeSource === 'api' ? fetchViaApi() : fetchViaStatusline();
}

module.exports = { id: 'claude', name: 'Claude', icon: 'sparkle', fetch: fetchClaude, NotSetupError };
