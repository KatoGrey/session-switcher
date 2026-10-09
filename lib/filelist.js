'use strict';
// A project's files, for @ mentions in the message box: what git knows about (tracked, plus new
// files it isn't told to ignore), or, without git, a walk that skips the usual build and package
// folders. Paths are relative, with forward slashes. Kept for 30 seconds per folder.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX = 20000;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.cache', 'target', 'bin', 'obj', '.idea', '.vs', 'coverage']);
const cache = new Map();

function gitFiles(cwd) {
  return new Promise(resolve => execFile('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard', '-z'], { timeout: 15000, windowsHide: true, maxBuffer: 64 << 20 }, (err, out) => {
    if (err) return resolve(null);
    resolve(String(out).split('\0').filter(Boolean).slice(0, MAX));
  }));
}
function walk(cwd) {
  const out = [];
  const go = (dir, rel, depth) => {
    if (out.length >= MAX || depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) go(path.join(dir, e.name), r, depth + 1); } else if (e.isFile()) out.push(r);
    }
  };
  go(cwd, '', 0);
  return out;
}
async function listFiles(cwd) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 30000) return hit.files;
  const files = (await gitFiles(cwd)) || walk(cwd);
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

module.exports = { listFiles };
