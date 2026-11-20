// Claude Code の settings.json にステータスライン中継スクリプトを登録・解除する（vscode に依存しない）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const MARKER = 'limit-radar/statusline.js';

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function paths() {
  const dir = claudeDir();
  const bridgeDir = path.join(dir, 'limit-radar');
  return {
    claudeDir: dir,
    settings: path.join(dir, 'settings.json'),
    bridgeDir,
    script: path.join(bridgeDir, 'statusline.js'),
    config: path.join(bridgeDir, 'config.json'),
    data: path.join(bridgeDir, 'rate_limits.json'),
  };
}

function isOurs(statusLine) {
  return !!(statusLine && typeof statusLine.command === 'string' && statusLine.command.replace(/\\/g, '/').includes(MARKER));
}

async function readSettings(file) {
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} を JSON として読めないため、変更を中止しました`);
  }
}

async function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

async function status() {
  const p = paths();
  const settings = await readSettings(p.settings).catch(() => ({}));
  const installed = isOurs(settings.statusLine);
  const scriptExists = fs.existsSync(p.script);
  return {
    installed: installed && scriptExists,
    claudeExists: fs.existsSync(p.claudeDir),
    otherStatusLine: !installed && settings.statusLine ? settings.statusLine : null,
  };
}

// bridgeSource: 拡張に同梱した bridge/statusline.js のパス
async function install(bridgeSource) {
  const p = paths();
  const settings = await readSettings(p.settings);
  await fsp.mkdir(p.bridgeDir, { recursive: true });
  // 拡張の更新でパスが変わらないよう、スクリプトは ~/.claude/limit-radar にコピーして使う
  await fsp.copyFile(bridgeSource, p.script);
  if (isOurs(settings.statusLine)) return { alreadyInstalled: true };

  const previous = settings.statusLine || null;
  await writeJsonAtomic(p.config, { previous });
  if (fs.existsSync(p.settings)) {
    await fsp.copyFile(p.settings, path.join(p.bridgeDir, 'settings.backup.json'));
  }
  settings.statusLine = {
    ...(previous && typeof previous === 'object' ? previous : {}),
    type: 'command',
    command: `node "${p.script.replace(/\\/g, '/')}"`,
  };
  await writeJsonAtomic(p.settings, settings);
  return { alreadyInstalled: false, chained: !!previous };
}

async function uninstall() {
  const p = paths();
  const settings = await readSettings(p.settings);
  if (!isOurs(settings.statusLine)) return { wasInstalled: false };
  let previous = null;
  try {
    previous = JSON.parse(await fsp.readFile(p.config, 'utf8')).previous || null;
  } catch {}
  if (previous) settings.statusLine = previous;
  else delete settings.statusLine;
  await writeJsonAtomic(p.settings, settings);
  await fsp.unlink(p.config).catch(() => {});
  return { wasInstalled: true, restored: !!previous };
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const readData = () => readJson(paths().data);
const readLastRun = () => readJson(path.join(paths().bridgeDir, 'last_run.json'));

module.exports = { paths, status, install, uninstall, readData, readLastRun, isOurs };
