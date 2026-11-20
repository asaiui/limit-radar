const vscode = require('vscode');
const { execFile } = require('child_process');
const codex = require('./src/providers/codex');
const claude = require('./src/providers/claude');
const antigravity = require('./src/providers/antigravity');
const bridge = require('./src/claudeStatusline');
const fmt = require('./src/format');
const notify = require('./src/notify');
const { UsagePanelProvider } = require('./src/panel');

const PROVIDERS = [codex, claude, antigravity];
const TICK_MS = 30 * 1000;
// 各サービスの最短取得間隔（ミリ秒）。Claude の API 方式だけは設定値を使う
const BASE_INTERVAL = { codex: 30 * 1000, claude: 30 * 1000, antigravity: 60 * 1000 };
const SHORT_NAME = { codex: 'Codex', claude: 'Claude', antigravity: 'AG' };
const NOTIFIED_KEY = 'limitRadar.notifiedV2';
const SETUP_PROMPT_KEY = 'limitRadar.claudeSetupPromptDismissed';
const SETUP_ACTION = { command: 'limitRadar.setupClaude', label: 'Claude 連携をセットアップ' };

/** @type {Record<string, {data:any, error:string|null, offline:boolean, notSetup:boolean, lastAttempt:number, inFlight:boolean}>} */
const state = {};
const items = {};
let panel;
let context;

function cfg() {
  const c = vscode.workspace.getConfiguration('limitRadar');
  return {
    enabled: (id) => c.get(`${id}.enabled`, true),
    claudeSource: c.get('claude.source', 'statusline'),
    claudeApiInterval: Math.max(60, c.get('claude.refreshSeconds', 180)) * 1000,
    warn: c.get('warnPercent', 80),
    critical: c.get('criticalPercent', 95),
    notifications: c.get('notifications', true),
  };
}

function intervalFor(id, c) {
  return id === 'claude' && c.claudeSource === 'api' ? c.claudeApiInterval : BASE_INTERVAL[id];
}

function resetState(id) {
  state[id] = { data: null, error: null, offline: false, notSetup: false, lastAttempt: 0, inFlight: false };
}

async function refreshProvider(p, force) {
  const s = state[p.id];
  const c = cfg();
  if (!c.enabled(p.id) || s.inFlight) return;
  if (!force && Date.now() - s.lastAttempt < intervalFor(p.id, c)) return;
  s.inFlight = true;
  s.lastAttempt = Date.now();
  try {
    s.data = await p.fetch({ claudeSource: c.claudeSource });
    s.error = null;
    s.offline = false;
    s.notSetup = false;
  } catch (e) {
    // 失敗しても前回の値は残す（古い値として表示）
    s.error = e && e.message ? e.message : String(e);
    s.offline = e instanceof antigravity.OfflineError;
    s.notSetup = e instanceof claude.NotSetupError;
    if (s.notSetup) s.data = null;
  } finally {
    s.inFlight = false;
  }
  render();
  maybeNotify(p, c);
}

function refreshAll(force) {
  return Promise.all(PROVIDERS.map((p) => refreshProvider(p, force)));
}

function statusOf(id) {
  const s = state[id];
  if (!cfg().enabled(id)) return 'disabled';
  if (s.data && !s.error) return 'ok';
  if (s.data && s.error) return 'stale';
  if (s.notSetup) return 'setup';
  if (s.offline) return 'offline';
  if (s.error) return 'error';
  return 'loading';
}

function viewModel() {
  const c = cfg();
  return PROVIDERS.map((p) => {
    const s = state[p.id];
    const d = s.data;
    return {
      id: p.id,
      name: p.name,
      status: statusOf(p.id),
      message: s.error,
      action: s.notSetup ? SETUP_ACTION : null,
      plan: d ? d.plan : null,
      asOfText: d ? `${fmt.agoText(d.asOf)}の値` : '',
      note: d ? d.note : null,
      windows: d
        ? d.windows.map((w) => ({
            label: w.label,
            percent: Math.min(100, Math.max(0, w.usedPercent)),
            pctText: fmt.pct(w.usedPercent),
            level: fmt.level(w.usedPercent, c.warn, c.critical),
            elapsed: fmt.elapsedPercent(w),
            untilText: w.resetPassed ? 'リセット済み' : fmt.untilText(w.resetsAt),
            resetText: fmt.dateText(w.resetsAt),
          }))
        : [],
    };
  });
}

function render() {
  const c = cfg();
  for (const p of PROVIDERS) {
    const item = items[p.id];
    const status = statusOf(p.id);
    if (status === 'disabled') {
      item.hide();
      continue;
    }
    const d = state[p.id].data;
    const short = SHORT_NAME[p.id];
    let text;
    if (d && d.windows.length > 0) {
      const nums =
        p.id === 'antigravity'
          ? fmt.pct(fmt.maxUsed(d))
          : d.windows.slice(0, 2).map((w) => Math.round(w.usedPercent)).join('/') + '%';
      text = `$(${p.icon}) ${short} ${nums}${status === 'stale' ? ' $(history)' : ''}`;
    } else if (status === 'setup') {
      text = `$(gear) ${short}`;
    } else if (status === 'offline') {
      text = `$(circle-slash) ${short}`;
    } else if (status === 'error') {
      text = `$(warning) ${short}`;
    } else {
      text = `$(sync~spin) ${short}`;
    }
    item.text = text;
    item.command = status === 'setup' ? SETUP_ACTION.command : 'limitRadar.openPanel';
    const max = fmt.maxUsed(d);
    const lv = max == null ? 'ok' : fmt.level(max, c.warn, c.critical);
    item.backgroundColor =
      lv === 'critical'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : lv === 'warn'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
    item.tooltip = tooltip(p, d, state[p.id].error, status);
    item.show();
  }
  if (panel) panel.update(viewModel());
}

function tooltip(p, d, error, status) {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${p.name}**${d && d.plan ? ` (${d.plan})` : ''}\n\n`);
  if (d) {
    md.appendMarkdown('| 枠 | 使用率 | リセット |\n|---|---:|---|\n');
    for (const w of d.windows) {
      const reset = w.resetPassed ? 'リセット済み' : `${fmt.untilText(w.resetsAt)}（${fmt.dateText(w.resetsAt)}）`;
      md.appendMarkdown(`| ${w.label.replace(/\|/g, '/')} | ${fmt.pct(w.usedPercent)} | ${reset} |\n`);
    }
    md.appendMarkdown(`\n${fmt.agoText(d.asOf)}の値`);
    if (d.note) md.appendMarkdown(` — ${d.note}`);
  }
  if (error) md.appendMarkdown(`\n\n$(warning) ${error}`);
  md.appendMarkdown(status === 'setup' ? '\n\nクリックでセットアップ' : '\n\nクリックでパネルを開く');
  return md;
}

function maybeNotify(p, c) {
  const d = state[p.id].data;
  if (!c.notifications || !d || state[p.id].error) return;
  let history = notify.prune(context.globalState.get(NOTIFIED_KEY, []));
  let changed = false;
  for (const w of d.windows) {
    const lv = fmt.level(w.usedPercent, c.warn, c.critical);
    if (lv === 'ok' || !w.resetsAt) continue;
    // Antigravity は並び順で key が変わるので、枠の識別にはラベルを使う
    const entry = { service: p.id, window: w.label, level: lv, resetsAt: w.resetsAt.getTime() };
    if (notify.alreadyNotified(history, entry)) continue;
    history.push(entry);
    changed = true;
    const msg = `${p.name} の ${w.label} 枠が ${fmt.pct(w.usedPercent)} に達しました（${fmt.untilText(w.resetsAt)}でリセット）`;
    const show = lv === 'critical' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
    show(msg, 'パネルを開く').then((choice) => {
      if (choice) vscode.commands.executeCommand('limitRadar.openPanel');
    });
  }
  if (changed) context.globalState.update(NOTIFIED_KEY, notify.prune(history));
}

// ---------- Claude 連携のセットアップ ----------

function nodeAvailable() {
  return new Promise((resolve) => execFile('node', ['-v'], { timeout: 5000 }, (err) => resolve(!err)));
}

async function setupClaude() {
  const st = await bridge.status();
  if (st.installed) {
    await bridge.install(vscode.Uri.joinPath(context.extensionUri, 'bridge', 'statusline.js').fsPath);
    vscode.window.showInformationMessage('Claude 連携はセットアップ済みです（スクリプトを最新版に更新しました）');
    return refreshAll(true);
  }
  if (!(await nodeAvailable())) {
    vscode.window.showErrorMessage('Node.js が見つかりません。Claude 連携には Node.js が必要です（https://nodejs.org）');
    return;
  }
  const p = bridge.paths();
  const detail = [
    `Claude Code の設定ファイル (${p.settings}) の statusLine に、使用量を記録する小さなスクリプトを登録します。`,
    '',
    '・記録するのは 5時間/週間 の使用率とリセット時刻だけです。通信はしません',
    st.otherStatusLine
      ? '・今のステータスライン設定は引き継ぎ、これまでどおり表示されます'
      : '・Claude Code の画面の見た目は変わりません',
    `・変更前の設定は ${p.bridgeDir} にバックアップします`,
    '・コマンド「Limit Radar: Claude 連携を解除」でいつでも元に戻せます',
  ].join('\n');
  const ok = await vscode.window.showInformationMessage('Claude 連携をセットアップしますか？', { modal: true, detail }, 'セットアップ');
  if (ok !== 'セットアップ') return;
  try {
    await bridge.install(vscode.Uri.joinPath(context.extensionUri, 'bridge', 'statusline.js').fsPath);
    vscode.window.showInformationMessage('Claude 連携をセットアップしました。次に Claude Code でやり取りしたときから表示されます');
  } catch (e) {
    vscode.window.showErrorMessage(`セットアップに失敗しました: ${e.message}`);
  }
  refreshAll(true);
}

async function removeClaudeSetup() {
  try {
    const r = await bridge.uninstall();
    vscode.window.showInformationMessage(
      !r.wasInstalled
        ? 'Claude 連携はセットアップされていません'
        : r.restored
          ? 'Claude 連携を解除し、以前のステータスライン設定に戻しました'
          : 'Claude 連携を解除しました'
    );
  } catch (e) {
    vscode.window.showErrorMessage(`解除に失敗しました: ${e.message}`);
  }
  refreshAll(true);
}

async function maybePromptSetup() {
  const c = cfg();
  if (!c.enabled('claude') || c.claudeSource !== 'statusline') return;
  if (context.globalState.get(SETUP_PROMPT_KEY)) return;
  const st = await bridge.status();
  if (st.installed || !st.claudeExists) return;
  const choice = await vscode.window.showInformationMessage(
    'Limit Radar: Claude の使用量を表示するには、Claude Code との連携セットアップが必要です',
    'セットアップ',
    '今後表示しない'
  );
  if (choice === 'セットアップ') setupClaude();
  if (choice === '今後表示しない') context.globalState.update(SETUP_PROMPT_KEY, true);
}

// ---------- activate ----------

function activate(ctx) {
  context = ctx;
  PROVIDERS.forEach((p, i) => {
    resetState(p.id);
    const item = vscode.window.createStatusBarItem(`limitRadar.${p.id}`, vscode.StatusBarAlignment.Right, 100 - i);
    item.name = `Limit Radar: ${p.name}`;
    item.command = 'limitRadar.openPanel';
    items[p.id] = item;
    ctx.subscriptions.push(item);
  });

  panel = new UsagePanelProvider(ctx.extensionUri, () => viewModel(), () => refreshAll(true));
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('limitRadar.panel', panel),
    vscode.commands.registerCommand('limitRadar.refresh', () => refreshAll(true)),
    vscode.commands.registerCommand('limitRadar.openPanel', () =>
      vscode.commands.executeCommand('workbench.view.extension.limitRadar')
    ),
    vscode.commands.registerCommand('limitRadar.setupClaude', setupClaude),
    vscode.commands.registerCommand('limitRadar.removeClaudeSetup', removeClaudeSetup),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('limitRadar')) return;
      if (e.affectsConfiguration('limitRadar.claude.source')) resetState('claude');
      render();
      refreshAll(false);
    })
  );

  render();
  refreshAll(true).then(maybePromptSetup);
  // 30秒ごとに表示（残り時間）を更新し、取得間隔を過ぎたサービスだけ再取得
  const timer = setInterval(() => {
    render();
    refreshAll(false);
  }, TICK_MS);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {}

module.exports = { activate, deactivate };
