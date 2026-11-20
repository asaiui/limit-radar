// Antigravity: 起動中の Antigravity が ~/.gemini/antigravity/daemon/hub_*.json に書き出す
// ローカルサーバーの情報（ポート・CSRF トークン）を使い、127.0.0.1 の GetUserStatus を呼ぶ
// - 通信先は自分の PC (127.0.0.1) だけ
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');

const RPC_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const REQUEST_BODY = JSON.stringify({
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'ja' },
});

class OfflineError extends Error {}

function daemonDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'daemon');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// 生きているプロセスの hub ファイルを新しい順に返す
async function liveHubs() {
  const dir = daemonDir();
  const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => /^hub_\d+\.json$/.test(n));
  const hubs = [];
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const st = await fsp.stat(p);
      const hub = JSON.parse(await fsp.readFile(p, 'utf8'));
      if (hub.pid && hub.csrfToken && isAlive(hub.pid)) hubs.push({ ...hub, mtime: st.mtimeMs });
    } catch {
      // 壊れたファイルや書き込み途中のファイルは無視
    }
  }
  return hubs.sort((a, b) => b.mtime - a.mtime);
}

function headers(csrf) {
  return {
    'Content-Type': 'application/json',
    'Connect-Protocol-Version': '1',
    'x-codeium-csrf-token': csrf,
  };
}

async function callHttp(port, csrf) {
  const res = await fetch(`http://127.0.0.1:${port}${RPC_PATH}`, {
    method: 'POST',
    headers: headers(csrf),
    body: REQUEST_BODY,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 自己署名証明書のため、127.0.0.1 に限り証明書検証を外す
function callHttps(port, csrf) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path: RPC_PATH,
        method: 'POST',
        headers: { ...headers(csrf), 'Content-Length': Buffer.byteLength(REQUEST_BODY) },
        rejectUnauthorized: false,
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(REQUEST_BODY);
  });
}

async function getUserStatus() {
  const hubs = await liveHubs();
  if (hubs.length === 0) {
    throw new OfflineError('Antigravity が起動していません（起動中のみ取得できます）');
  }
  const errors = [];
  for (const hub of hubs) {
    if (hub.httpPort) {
      try {
        return await callHttp(hub.httpPort, hub.csrfToken);
      } catch (e) {
        errors.push(`http:${hub.httpPort} ${e.message}`);
      }
    }
    if (hub.httpsPort) {
      try {
        return await callHttps(hub.httpsPort, hub.csrfToken);
      } catch (e) {
        errors.push(`https:${hub.httpsPort} ${e.message}`);
      }
    }
  }
  throw new Error(`Antigravity に接続できませんでした (${errors.join(', ')})`);
}

function pick(obj, ...paths) {
  for (const p of paths) {
    let v = obj;
    for (const k of p.split('.')) v = v == null ? undefined : v[k];
    if (v != null) return v;
  }
  return null;
}

async function fetchAntigravity() {
  const data = await getUserStatus();
  const configs = pick(data, 'userStatus.cascadeModelConfigData.clientModelConfigs') || [];
  // 同じ残量・同じリセット時刻のモデルは同じ枠を共有しているとみなしてまとめる
  const groups = new Map();
  for (const c of configs) {
    // プラン対象外などで使えないモデル（quotaInfo が空）は除外
    if (!c || c.disabled || !c.quotaInfo) continue;
    const q = c.quotaInfo;
    if (q.remainingFraction == null && !q.resetTime) continue;
    // proto3 の JSON では 0 は省略されるので、resetTime があって remainingFraction が無い = 残り 0
    const remaining = Number(q.remainingFraction) || 0;
    const resetTime = q.resetTime || '';
    const key = `${remaining}|${resetTime}`;
    if (!groups.has(key)) groups.set(key, { labels: [], remaining, resetTime });
    // "Gemini 4 Neon (High)" のような推論レベル違いはまとめて "Gemini 4 Neon" にする
    const base = (c.label || '不明なモデル').replace(/\s*\([^)]*\)\s*$/, '');
    const labels = groups.get(key).labels;
    if (!labels.includes(base)) labels.push(base);
  }
  if (groups.size === 0) {
    throw new Error('応答に残量情報が含まれていません（仕様が変わった可能性があります）');
  }
  const windows = [...groups.values()]
    .map((g, i) => ({
      key: `group${i}`,
      label: g.labels.join(' / '),
      usedPercent: Math.round((1 - g.remaining) * 1000) / 10,
      resetsAt: g.resetTime ? new Date(g.resetTime) : null,
      windowMinutes: null,
    }))
    .sort((a, b) => b.usedPercent - a.usedPercent);
  return {
    plan: pick(data, 'userStatus.planStatus.planInfo.planName', 'planInfo.planName', 'userStatus.userTier.name'),
    asOf: new Date(),
    windows,
    note: 'モデルごとの残り枠です（Antigravity 起動中のみ更新）',
  };
}

module.exports = {
  id: 'antigravity',
  name: 'Antigravity',
  icon: 'rocket',
  fetch: fetchAntigravity,
  OfflineError,
};
