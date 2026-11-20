// ステータスバーのツールチップ（Markdown）を組み立てる（vscode に依存しない）
//
// VS Code のホバーでは <span style="color:...;"> と var(--vscode-*) の色だけが使えるので、
// それで使用率のバーと文字に色を付ける。表（table）は長いモデル名で横に伸びるため使わない。
const fmt = require('./format');

const COLOR = {
  ok: 'var(--vscode-charts-green)',
  warn: 'var(--vscode-charts-yellow)',
  critical: 'var(--vscode-charts-red)',
  muted: 'var(--vscode-descriptionForeground)',
  track: 'var(--vscode-disabledForeground)',
};
const BAR_CELLS = 20;
const BR = '  \n';

// Markdown として解釈される記号をエスケープ（span の外で使う）
function mdEscape(s) {
  return String(s).replace(/[\\`*_{}[\]()#+\-.!|<>~$]/g, '\\$&');
}

// HTML としてエスケープ（span の中で使う。span の中では Markdown は解釈されない）
function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colored(html, color) {
  return `<span style="color:${color};">${html}</span>`;
}

function bar(percent, level) {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)));
  return (
    (filled > 0 ? colored('█'.repeat(filled), COLOR[level]) : '') +
    (filled < BAR_CELLS ? colored('░'.repeat(BAR_CELLS - filled), COLOR.track) : '')
  );
}

// "Gemini 4 Neon / Gemini 4 Hydrogen / Orchestrator" → 見出し "Gemini 4 Neon ほか2" と一覧
function splitLabel(label) {
  const names = String(label).split(' / ');
  return {
    title: names.length > 1 ? `${names[0]} ほか${names.length - 1}` : names[0],
    members: names.length > 1 ? names : null,
  };
}

function windowBlock(w, warn, critical, now) {
  const level = fmt.level(w.usedPercent, warn, critical);
  const { title, members } = splitLabel(w.label);
  const lines = [];
  lines.push(`**${mdEscape(title)}**　${colored(`<strong>${htmlEscape(fmt.pct(w.usedPercent))}</strong>`, COLOR[level])}`);
  if (members) lines.push(colored(htmlEscape(members.join(' · ')), COLOR.muted));
  lines.push(bar(w.usedPercent, level));

  let reset;
  if (w.resetPassed) reset = 'リセット済み';
  else if (w.resetsAt) reset = `${fmt.untilText(w.resetsAt, now)} · ${fmt.dateText(w.resetsAt)}`;
  else reset = 'リセット時刻不明';
  const elapsed = fmt.elapsedPercent(w, now);
  const ahead = elapsed != null && w.usedPercent > elapsed + 5;
  lines.push(colored(htmlEscape(reset), COLOR.muted) + (ahead ? ` ${colored('ペース速め', COLOR.warn)}` : ''));
  return lines.join(BR);
}

/**
 * @param {{name:string, icon:string}} provider
 * @param {any} data 取得結果（無ければ null）
 * @param {{error?:string|null, status:string, warn:number, critical:number, now?:number}} opts
 */
function buildTooltip(provider, data, opts) {
  const now = opts.now || Date.now();
  const parts = [];
  parts.push(
    `$(${provider.icon}) **${mdEscape(provider.name)}**` +
      (data && data.plan ? `　${colored(htmlEscape(data.plan), COLOR.muted)}` : '')
  );

  if (data && data.windows.length > 0) {
    parts.push('---');
    for (const w of data.windows) parts.push(windowBlock(w, opts.warn, opts.critical, now));
  }

  const foot = [];
  if (data) {
    foot.push(colored(htmlEscape(`${fmt.agoText(data.asOf, now)}の値${data.note ? ` · ${data.note}` : ''}`), COLOR.muted));
  }
  if (opts.error) foot.push(`$(warning) ${mdEscape(opts.error)}`);
  foot.push(opts.status === 'setup' ? '$(gear) クリックでセットアップ' : '$(layout-sidebar-left) クリックでパネルを開く');
  parts.push('---');
  parts.push(foot.join(BR));

  return parts.join('\n\n');
}

module.exports = { buildTooltip, mdEscape, htmlEscape };
