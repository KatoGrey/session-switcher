'use strict';
// Your accounts, chats' extras and settings live in the app's data folder (%APPDATA%\Session Switcher,
// or ~/Library/Application Support/Session Switcher), not next to the app, which an update replaces.
// The first time, it offers to bring them in from a folder copy of Session Switcher. It copies: the
// folder copy keeps its own and still works.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILES = ['accounts.json', 'history.json', 'chat-names.json', 'projects.json', 'banners.json', 'worlds.json', 'prompts.json',
  'chat-prefs.json', 'openclaw-titles.json', 'pairs.json', 'devices.json', 'push.json', 'drafts.json', 'tasks.json', 'races.json', 'reopen.json'];
const DIRS = ['chat-extras', 'openclaw-messages', 'theme-studio'];

// Folder copies it can find: the one that ran last (it leaves a note), and the usual places.
function candidates(port) {
  const out = [];
  try { const j = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${port}.json`), 'utf8')); if (j.dir) out.push(j.dir); } catch { /* none ran */ }
  const home = os.homedir();
  for (const base of [path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Desktop'), home, path.join(home, 'Documents')]) {
    for (const name of ['claude-switcher', 'session-switcher', 'Session Switcher', 'SubSharer']) out.push(path.join(base, name));
  }
  return [...new Set(out.map(p => path.resolve(p)))].filter(d => fs.existsSync(path.join(d, 'accounts.json')) && fs.existsSync(path.join(d, 'server.js')));
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}
function importFrom(dir, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const done = [];
  for (const f of FILES) { const a = path.join(dir, f); if (fs.existsSync(a)) { fs.copyFileSync(a, path.join(dataDir, f)); done.push(f); } }
  for (const d of DIRS) { const a = path.join(dir, d); if (fs.existsSync(a)) { copyDir(a, path.join(dataDir, d)); done.push(`${d}/`); } }
  return done;
}

const notesFile = dataDir => path.join(dataDir, 'desktop.json');
function notes(dataDir) { try { return JSON.parse(fs.readFileSync(notesFile(dataDir), 'utf8')) || {}; } catch { return {}; } }
function setNotes(dataDir, patch) { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(notesFile(dataDir), JSON.stringify({ ...notes(dataDir), ...patch }, null, 2)); } catch { /* read-only */ } }

// Asks once, before the first start: only when this app has no accounts yet and a folder copy does.
async function offerImport({ dataDir, port, ask, log = () => {} }) {
  if (fs.existsSync(path.join(dataDir, 'accounts.json')) || notes(dataDir).importAsked) return null;
  const found = candidates(port)[0];
  if (!found) return null;
  setNotes(dataDir, { importAsked: true });
  if (!(await ask(found))) return null;
  const done = importFrom(found, dataDir);
  setNotes(dataDir, { importedFrom: found, importedAt: new Date().toISOString() });
  log(`Brought in ${done.length} items from ${found}: ${done.join(', ')}`);
  return { from: found, done };
}

module.exports = { offerImport, importFrom, candidates, notes, setNotes, FILES, DIRS };
