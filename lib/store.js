'use strict';
// Small, crash-safe JSON storage helpers.

const fs = require('fs');
const path = require('path');

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// Reads a JSON file the app owns. A corrupt file is set aside (never deleted); the last good
// backup is used if there is one, otherwise the fallback.
function loadOwnJson(p, fallback, log) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    const aside = `${p}.corrupt-${Date.now()}`;
    try { fs.renameSync(p, aside); } catch { /* leave it */ }
    const backup = readJson(`${p}.bak`);
    if (backup) {
      try { fs.copyFileSync(`${p}.bak`, p); } catch { /* use it from memory anyway */ }
      if (log) log(`${path.basename(p)} was damaged (${err.message}); restored the last good copy. The damaged file is ${path.basename(aside)}.`);
      return backup;
    }
    if (log) log(`Could not read ${path.basename(p)} (${err.message}); moved it to ${path.basename(aside)} and started fresh.`);
    return fallback;
  }
}

// Writes to a temp file and renames over the target, so a crash never leaves a half-written file.
// With keepBackup, the previous good version is kept as <file>.bak.
function writeJsonAtomic(p, data, { keepBackup = false } = {}) {
  if (keepBackup && fs.existsSync(p) && readJson(p)) { try { fs.copyFileSync(p, `${p}.bak`); } catch { /* best effort */ } }
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

const statOrNull = p => { try { return fs.statSync(p); } catch { return null; } };
const lstatOrNull = p => { try { return fs.lstatSync(p); } catch { return null; } };
const realOrNull = p => { try { return fs.realpathSync(p); } catch { return null; } };

module.exports = { readJson, loadOwnJson, writeJsonAtomic, statOrNull, lstatOrNull, realOrNull };
