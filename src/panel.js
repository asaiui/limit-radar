const vscode = require('vscode');
const crypto = require('crypto');

// パネルから実行できるコマンドはこれだけ
const ALLOWED_COMMANDS = new Set(['limitRadar.setupClaude']);

class UsagePanelProvider {
  constructor(extensionUri, getModel, onRefresh) {
    this.extensionUri = extensionUri;
    this.getModel = getModel;
    this.onRefresh = onRefresh;
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html(crypto.randomBytes(16).toString('hex'), view.webview.cspSource);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'refresh') this.onRefresh();
      if (msg && msg.type === 'command' && ALLOWED_COMMANDS.has(msg.command)) {
        vscode.commands.executeCommand(msg.command);
      }
      if (msg && msg.type === 'ready') this.update(this.getModel());
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) this.update(this.getModel());
    });
    view.onDidDispose(() => (this.view = null));
  }

  update(model) {
    if (this.view) this.view.webview.postMessage({ type: 'model', model });
  }
}

function html(nonce, cspSource) {
  return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 8px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .card { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #8884)); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
  .head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; }
  .name { font-weight: 600; font-size: 1.1em; }
  .plan { font-size: .85em; opacity: .7; }
  .asof { margin-left: auto; font-size: .8em; opacity: .6; }
  .win { margin: 8px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; font-size: .9em; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pct { font-weight: 600; font-variant-numeric: tabular-nums; }
  .bar { position: relative; height: 8px; border-radius: 4px; background: var(--vscode-input-background, #8883); margin: 4px 0 3px; overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; background: var(--vscode-charts-green, #3fb950); }
  .fill.warn { background: var(--vscode-charts-yellow, #d29922); }
  .fill.critical { background: var(--vscode-charts-red, #f85149); }
  .pace { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--vscode-foreground, currentColor); opacity: .55; }
  .sub { display: flex; justify-content: space-between; font-size: .8em; opacity: .7; }
  .ahead { color: var(--vscode-charts-yellow, #d29922); opacity: 1; }
  .msg { font-size: .85em; padding: 6px 8px; border-radius: 4px; margin-top: 6px; background: var(--vscode-inputValidation-warningBackground, #d2992222); }
  .note { font-size: .8em; opacity: .6; margin-top: 6px; }
  .empty { font-size: .9em; opacity: .7; }
  .legend { font-size: .8em; opacity: .6; margin: 4px 0 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.action { margin-top: 8px; }
</style>
</head>
<body>
<div id="root"><div class="empty">読み込み中…</div></div>
<div class="legend">バーの縦線＝枠の時間経過。縦線より右まで伸びていたら使うペースが速めです。</div>
<button id="refresh">今すぐ更新</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(model) {
    root.replaceChildren();
    for (const s of model) {
      if (s.status === 'disabled') continue;
      const card = el('div', 'card');
      const head = el('div', 'head');
      head.append(el('span', 'name', s.name));
      if (s.plan) head.append(el('span', 'plan', s.plan));
      if (s.asOfText) head.append(el('span', 'asof', s.asOfText));
      card.append(head);

      if (s.windows.length === 0 && s.status === 'loading') card.append(el('div', 'empty', '取得中…'));
      for (const w of s.windows) {
        const win = el('div', 'win');
        const row = el('div', 'row');
        const label = el('span', 'label', w.label);
        label.title = w.label;
        row.append(label, el('span', 'pct', w.pctText));
        const bar = el('div', 'bar');
        const fill = el('div', 'fill ' + w.level);
        fill.style.width = w.percent + '%';
        bar.append(fill);
        if (w.elapsed != null) {
          const pace = el('div', 'pace');
          pace.style.left = 'calc(' + w.elapsed + '% - 1px)';
          pace.title = '時間経過 ' + Math.round(w.elapsed) + '%';
          bar.append(pace);
        }
        const sub = el('div', 'sub');
        const left = el('span', '', w.untilText);
        if (w.elapsed != null && w.percent > w.elapsed + 5) {
          left.className = 'ahead';
          left.textContent = w.untilText + '（ペース速め）';
        }
        sub.append(left, el('span', '', w.resetText));
        win.append(row, bar, sub);
        card.append(win);
      }
      if (s.message) card.append(el('div', 'msg', (s.status === 'stale' ? '前回の値を表示中: ' : '') + s.message));
      if (s.action) {
        const b = el('button', 'action', s.action.label);
        b.addEventListener('click', () => vscode.postMessage({ type: 'command', command: s.action.command }));
        card.append(b);
      }
      if (s.note && s.status === 'ok') card.append(el('div', 'note', s.note));
      root.append(card);
    }
    if (!root.firstChild) root.append(el('div', 'empty', 'すべてのサービスが無効になっています（設定 limitRadar.*.enabled）'));
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'model') render(e.data.model);
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

module.exports = { UsagePanelProvider };
