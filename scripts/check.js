// VSCode を使わずに各サービスの取得結果を確認する: node scripts/check.js
const fmt = require('../src/format');
const providers = [
  require('../src/providers/codex'),
  require('../src/providers/claude'),
  require('../src/providers/antigravity'),
];

(async () => {
  for (const p of providers) {
    console.log(`\n== ${p.name} ==`);
    try {
      const d = await p.fetch();
      console.log(`プラン: ${d.plan || '-'} / ${fmt.agoText(d.asOf)}の値`);
      for (const w of d.windows) {
        const el = fmt.elapsedPercent(w);
        console.log(
          `  ${w.label.padEnd(10)} ${fmt.pct(w.usedPercent).padStart(4)}  ` +
            `${w.resetPassed ? 'リセット済み' : `${fmt.untilText(w.resetsAt)} (${fmt.dateText(w.resetsAt)})`}` +
            (el != null ? `  時間経過 ${Math.round(el)}%` : '')
        );
      }
      if (d.note) console.log(`  ※ ${d.note}`);
    } catch (e) {
      console.log(`  取得できません: ${e.message}`);
    }
  }
})();
