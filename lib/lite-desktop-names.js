'use strict';
// Renaming a chat that came from the Claude desktop app, in the desktop app too.
//
// The desktop app keeps each chat's title in its own record (lib/desktop.js reads it):
//   ~/Library/Application Support/Claude/claude-code-sessions/<org>/<account>/local_<id>.json
// While it's running it holds those records in memory and writes them back on every change, so an
// edit made then is lost on its next write (tried: the old title came back on the chat's next
// turn). So a rename waits in lite.json (desktopRenames) and is written while the desktop app is
// closed; it reads the records when it starts. The write changes only what the app's own rename
// changes (title, previousTitles, titleTurn) and keeps everything else as it was.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const APP_RE = /\/Claude\.app\/Contents\/MacOS\/Claude$/;

// ps, not pgrep: pgrep leaves out the processes it runs under, and from a terminal opened in the
// desktop app that includes the app itself. Unsure counts as running (and elsewhere than macOS it
// always does, so nothing is written there). Resolves; ps runs alongside the server, not in its way.
function desktopRunning() {
  if (process.platform !== 'darwin') return Promise.resolve(true);
  return new Promise(resolve => cp.execFile('ps', ['-axo', 'args='], { encoding: 'utf8', timeout: 5000 }, (err, out) => {
    if (err || !out) return resolve(true);
    resolve(String(out).split('\n').some(l => APP_RE.test(l.trim())));
  }));
}

// The record file for a desktop session id (local_…), found by name under the app's folder.
function recordFile(root, desktopId) {
  const name = `${desktopId}.json`;
  if (!/^local_[\w-]+\.json$/.test(name)) return null;
  let orgs = [];
  try { orgs = fs.readdirSync(root); } catch { return null; }
  for (const org of orgs) {
    let accts = [];
    try { accts = fs.readdirSync(path.join(root, org)); } catch { continue; }
    for (const acct of accts) { const f = path.join(root, org, acct, name); if (fs.existsSync(f)) return f; }
  }
  return null;
}

// The record with its new title, the way the app's own rename leaves it. Pure, for tests.
function renamed(rec, title) {
  if (!rec || typeof rec !== 'object' || rec.title === title) return rec;
  const out = { ...rec, title };
  if (typeof rec.title === 'string' && rec.title) out.previousTitles = [...(Array.isArray(rec.previousTitles) ? rec.previousTitles : []), rec.title].slice(-20);
  if (typeof rec.completedTurns === 'number') out.titleTurn = rec.completedTurns;
  return out;
}

function createDesktopNames({ store, desktop, log = () => {}, isRunning = desktopRunning, root = desktop.ROOT }) {
  let timer = null;
  const pending = () => store.get().desktopRenames || {};

  // Throws at once for a chat that isn't the desktop app's; otherwise resolves to what happened.
  function queue(cli, title) {
    const id = String(cli || '').toLowerCase();
    if (!desktop.get(id)) throw Object.assign(new Error('That chat didn’t come from the Claude desktop app.'), { status: 400 });
    store.setDesktopRename(id, String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null);
    return apply().then(applied => ({ queued: !applied.done.includes(id), desktopOpen: applied.running }));
  }

  // Writes every waiting rename, if the desktop app is closed. Resolves to what it did.
  async function apply() {
    if (!Object.keys(pending()).length) return { running: false, done: [] };
    if (await isRunning()) return { running: true, done: [] };
    const list = Object.entries(pending());   // read again: another pass may have written some meanwhile
    const done = [];
    for (const [cli, want] of list) {
      const rec = desktop.get(cli);
      const file = rec && recordFile(root, rec.desktopId);
      if (!file) { store.setDesktopRename(cli, null); log(`Lite: no desktop record for ${cli}; rename dropped`); continue; }
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (j.title !== want.title) {
          const tmp = `${file}.switcher-tmp`;
          fs.writeFileSync(tmp, JSON.stringify(renamed(j, want.title)));
          JSON.parse(fs.readFileSync(tmp, 'utf8'));
          fs.renameSync(tmp, file);
          log(`Lite: renamed desktop chat ${rec.desktopId} to “${want.title}”`);
        }
        store.setDesktopRename(cli, null); done.push(cli);
      } catch (err) { log(`Lite: couldn’t rename desktop chat ${cli} (${err.message}); will try again`); }
    }
    return { running: false, done };
  }

  function start() {
    if (timer) return;
    setTimeout(() => { apply().catch(() => { /* next time */ }); }, 15000).unref();
    timer = setInterval(() => { apply().catch(() => { /* next time */ }); }, 20e3); timer.unref();
  }
  return { queue, apply, start, pending };
}

module.exports = { createDesktopNames, desktopRunning, recordFile, renamed };
