'use strict';
// Starting claude, codex or a package manager on Windows, for Lite and its helper scripts (bin/), with
// the arguments as separate words. Mac and Linux keep each caller's own way; this is only for Windows,
// where there's no sh and a program installed by npm is a batch file (claude.cmd, codex.cmd):
//  - a real program (claude.exe from Anthropic's installer, gh.exe) starts directly;
//  - an npm shim only starts a Node script, so that script starts with Node directly instead, and the
//    arguments still go exactly as they are (a batch file can only run through cmd.exe);
//  - anything else runs through cmd.exe the way the rest of the app runs commands (lib/system.js),
//    each argument quoted, and refused when even quotes can't keep cmd.exe off it (% ! or a line break).

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
// An environment variable whatever its case (a copy of process.env keeps Windows' "Path").
const envVar = (env, name) => { const k = Object.keys(env || {}).find(x => x.toUpperCase() === name); return k ? env[k] : process.env[name]; };

// Where a command is: as given when it's a path, else the first match on the PATH, by PATHEXT.
function findOnWindows(command, env = process.env) {
  const c = String(command || '').trim();
  if (!c) return null;
  const exts = String(envVar(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  const names = exts.includes(path.extname(c).toLowerCase()) ? [c] : exts.map(e => c + e);
  const dirs = /[\\/]/.test(c) ? [''] : String(envVar(env, 'PATH') || '').split(';').filter(Boolean);
  for (const d of dirs) for (const n of names) { const f = d ? path.join(d, n) : path.resolve(n); if (isFile(f)) return f; }
  return null;
}

// The script an npm shim starts and the node it would start it with, or null when it isn't one.
function npmShim(file, env = process.env) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = /"%~?dp0%?\\([^"%]+\.[cm]?js)"\s+%\*/i.exec(text);
  if (!m) return null;
  const dir = path.dirname(file), script = path.join(dir, m[1]);
  const node = isFile(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : findOnWindows('node', env);
  return isFile(script) && node ? { node, script } : null;
}

// One argument on a cmd.exe command line: bare when it's plain, else quoted the way programs read
// their arguments back (\" for a quote), refused when cmd.exe would still read something in it.
function cmdArg(a) {
  const s = String(a);
  if (/^[\w.:\/\\@+-]+$/.test(s)) return s;
  if (/[%!\r\n]/.test(s) || (s.includes('"') && /[&|<>^()]/.test(s))) throw new Error(`That can’t be passed through cmd.exe safely: ${s.slice(0, 80)}`);
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
// The command itself, quoted as lib/system.js quotes it.
const cmdQuote = s => (/[\s&()^|<>]/.test(s) ? `"${s}"` : s);

// How it would start: { file, args, verbatim }. Pure apart from looking at files, for tests.
function planWindows(command, args = [], env = process.env) {
  const file = findOnWindows(command, env);
  if (file && /\.(exe|com)$/i.test(file)) return { file, args: args.map(String) };
  const shim = file && /\.(cmd|bat)$/i.test(file) ? npmShim(file, env) : null;
  if (shim) return { file: shim.node, args: [shim.script, ...args.map(String)] };
  const line = [cmdQuote(String(command)), ...args.map(cmdArg)].join(' ');
  return { file: 'cmd.exe', args: [`/d /s /c "${line}"`], verbatim: true };
}

// Starts it, with spawn's options. Never detached (that gives it a console window of its own); stop
// it with stopTree, which takes whatever it started too.
function spawnWin(command, args = [], opts = {}) {
  const { detached, ...rest } = opts;
  const p = planWindows(command, args, opts.env || process.env);
  return cp.spawn(p.file, p.args, { ...rest, windowsHide: true, ...(p.verbatim ? { windowsVerbatimArguments: true } : {}) });
}

// Stops a process and everything it started (cmd.exe may sit between us and the program).
function stopTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode || !proc.pid) return;
  try { cp.spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch { /* gone */ }
}

module.exports = { spawnWin, stopTree, planWindows, findOnWindows, npmShim, cmdArg };
