'use strict';
// Everything that touches the operating system: running `claude`, opening terminals,
// finding running sessions, opening windows and shortcuts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const DRY_RUN = !IS_WIN || process.env.SWITCHER_DRY_RUN === '1';
const LAUNCH_DIR = path.join(os.tmpdir(), 'claude-switcher');

// Variables that would make Claude Code ignore the account you picked.
const OVERRIDE_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];

// ---------- running commands ----------

// Runs a command line through the platform shell and captures its output.
function runCapture(cmdline, { env = process.env, cwd, timeoutMs = 15000 } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = IS_WIN
        ? spawn('cmd.exe', [`/d /s /c "${cmdline}"`], { env, cwd, windowsVerbatimArguments: true, windowsHide: true })
        : spawn('sh', ['-c', cmdline], { env, cwd });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: err.message });
    }
    let stdout = '', stderr = '', done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: -1, stdout, stderr: stderr + '\n(timed out)', timedOut: true }); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; if (stdout.length > 2e6) child.kill(); });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => finish({ code: -1, stdout, stderr: err.message }));
    child.on('close', code => finish({ code, stdout, stderr }));
  });
}

const quoteForShell = s => (/[\s&()^|<>]/.test(s) ? `"${s}"` : s);

// PowerShell via -EncodedCommand: no quoting rules to get wrong, whatever the paths contain.
function runPowerShell(script, opts = {}) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return runCapture(`powershell.exe -NoProfile -NonInteractive ${opts.sta ? '-STA ' : ''}-ExecutionPolicy Bypass -EncodedCommand ${b64}`, opts);
}

function claudeEnv(account) {
  const env = { ...process.env };
  if (account.isDefault) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = account.configDir;
  return env;
}

function cleanEnv(env) {
  const e = { ...env };
  for (const v of OVERRIDE_VARS) delete e[v];
  return e;
}

// ---------- Codex (OpenAI) ----------
// Codex keeps its sign-in and chats in CODEX_HOME (default ~/.codex), like CLAUDE_CONFIG_DIR for Claude.
const CODEX_OVERRIDE_VARS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'];
function codexEnv(cfg) {
  const env = { ...process.env };
  const c = cfg.codex || {};
  if (c.home) env.CODEX_HOME = c.home; else delete env.CODEX_HOME;
  if (cfg.prefs.cleanEnv) for (const v of CODEX_OVERRIDE_VARS) delete env[v];
  return env;
}
const codexCommand = cfg => (cfg.codex && cfg.codex.command) || 'codex';
function spawnCodex(cfg, cwd, args) {
  for (const a of args) if (!/^[\w.:=\/-]+$/.test(a)) throw new Error(`Unsafe argument: ${a}`);
  const cmdline = `${quoteForShell(codexCommand(cfg))} ${args.join(' ')}`;
  const env = codexEnv(cfg);
  return IS_WIN
    ? spawn('cmd.exe', [`/d /s /c "${cmdline}"`], { env, cwd, windowsVerbatimArguments: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('sh', ['-c', `exec ${cmdline}`], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
}
function codexLaunchScript(cfg, cwd, codexArgs, title) {
  const c = cfg.codex || {};
  const lines = IS_WIN
    ? ['@echo off', 'chcp 65001 >nul', `title ${titleSafe(title)}`,
        c.home ? `set "CODEX_HOME=${cmdValue(c.home)}"` : 'set "CODEX_HOME="',
        ...(cfg.prefs.cleanEnv ? CODEX_OVERRIDE_VARS.map(v => `set "${v}="`) : []),
        `cd /d "${cmdValue(cwd)}"`,
        `call ${quoteForShell(codexCommand(cfg))} ${codexArgs}`.trim()]
    : ['#!/bin/sh', c.home ? `export CODEX_HOME='${c.home}'` : 'unset CODEX_HOME',
        ...(cfg.prefs.cleanEnv ? CODEX_OVERRIDE_VARS.map(v => `unset ${v}`) : []),
        `cd '${cwd}'`, `${codexCommand(cfg)} ${codexArgs}`.trim()];
  return lines.join(IS_WIN ? '\r\n' : '\n') + (IS_WIN ? '\r\n' : '\n');
}
function codexManualCommand(cfg, cwd, codexArgs) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const c = cfg.codex || {};
  const parts = [`Set-Location ${q(cwd)}`];
  parts.push(c.home ? `$env:CODEX_HOME = ${q(c.home)}` : 'Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue');
  const cmd = codexCommand(cfg);
  parts.push(`${/\s/.test(cmd) ? `& ${q(cmd)}` : cmd} ${codexArgs}`.trim());
  return parts.join('; ');
}

// Runs `claude <args>` as the given account and captures the output.
function runClaude(cfg, account, args, opts = {}) {
  const env = cfg.prefs.cleanEnv ? cleanEnv(claudeEnv(account)) : claudeEnv(account);
  return runCapture(`${quoteForShell(cfg.claudeCommand)} ${args}`, { env, ...opts });
}

// Starts `claude <args>` as the account with pipes for the chat window. Arguments are only
// flags, ids and mode names (messages travel over stdin), so quoting stays simple.
function spawnClaude(cfg, account, cwd, args) {
  for (const a of args) if (!/^[\w.:=\/-]+$/.test(a)) throw new Error(`Unsafe argument: ${a}`);
  const env = cfg.prefs.cleanEnv ? cleanEnv(claudeEnv(account)) : claudeEnv(account);
  const cmdline = `${quoteForShell(cfg.claudeCommand)} ${args.join(' ')}`;
  return IS_WIN
    ? spawn('cmd.exe', [`/d /s /c "${cmdline}"`], { env, cwd, windowsVerbatimArguments: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('sh', ['-c', `exec ${cmdline}`], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
}

// Stops a process and everything it started (on Windows, cmd.exe sits between us and claude).
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (IS_WIN) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* gone */ }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  }
}

// ---------- facts about this computer (cached) ----------

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = fn().then(value => { cache.set(key, { at: Date.now(), value }); return value; })
    .catch(err => { cache.delete(key); throw err; });
  cache.set(key, { at: 0, pending, value: hit && hit.value });
  return pending;
}
const forget = key => cache.delete(key);

function parseVersion(s) {
  const m = String(s || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}
function versionAtLeast(v, min) {
  const a = Array.isArray(v) ? v : parseVersion(v), b = parseVersion(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}

async function claudeVersion(cfg) {
  return cached(`version:${cfg.claudeCommand}`, 5 * 60 * 1000, async () => {
    const r = await runCapture(`${quoteForShell(cfg.claudeCommand)} --version`, { timeoutMs: 20000 });
    const v = parseVersion(r.stdout);
    return { found: r.code === 0 && !!v, version: v ? v.join('.') : null, raw: (r.stdout || r.stderr).trim().slice(0, 200) };
  });
}

async function whereIs(name) {
  const r = await runCapture(IS_WIN ? `where ${name}` : `command -v ${name}`, { timeoutMs: 8000 });
  return r.code === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
}

async function hasWindowsTerminal() {
  if (!IS_WIN) return false;
  return cached('wt', 10 * 60 * 1000, async () => (await whereIs('wt')).length > 0);
}

// Finds `claude --resume <id>` processes that are running right now.
async function runningSessions() {
  return cached('running', 9000, async () => {
    // Windows filters the processes itself, so PowerShell never loads the whole list.
    const r = IS_WIN
      ? await runPowerShell("Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%--resume%' OR CommandLine LIKE '% -r %'\" | ForEach-Object { [string]$_.ProcessId + '|' + $_.CommandLine }", { timeoutMs: 12000 })
      : await runCapture('ps -eo pid=,args=', { timeoutMs: 5000 });
    return parseProcessList(r.stdout, IS_WIN);
  });
}

// Lines are "pid|command line" on Windows and "pid command line" elsewhere.
function parseProcessList(text, win) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = win ? line.match(/^(\d+)\|(.*)$/) : line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m || !/claude/i.test(m[2]) || /--fork-session/.test(m[2])) continue; // a copy writes to a new chat, not this one
    const id = (m[2].match(/(?:--resume|\s-r)\s+"?([0-9a-fA-F-]{8,64})/) || [])[1];
    if (id) (out[id.toLowerCase()] = out[id.toLowerCase()] || []).push(Number(m[1]));
  }
  return out;
}

// ---------- launching terminals ----------

const cmdValue = s => String(s).replace(/%/g, '%%');
const titleSafe = s => String(s).replace(/["&|<>^%;]/g, '').slice(0, 60);

// Builds a launcher script that sets everything explicitly, so it behaves the same
// however the terminal is opened (a new Windows Terminal tab doesn't inherit our environment).
function launchScript(cfg, account, cwd, claudeArgs, title) {
  const lines = IS_WIN
    ? ['@echo off', 'chcp 65001 >nul', `title ${titleSafe(title)}`,
        account.isDefault ? 'set "CLAUDE_CONFIG_DIR="' : `set "CLAUDE_CONFIG_DIR=${cmdValue(account.configDir)}"`,
        ...(cfg.prefs.cleanEnv ? OVERRIDE_VARS.map(v => `set "${v}="`) : []),
        `cd /d "${cmdValue(cwd)}"`,
        `call ${quoteForShell(cfg.claudeCommand)} ${claudeArgs}`.trim()]
    : ['#!/bin/sh', account.isDefault ? 'unset CLAUDE_CONFIG_DIR' : `export CLAUDE_CONFIG_DIR='${account.configDir}'`,
        ...(cfg.prefs.cleanEnv ? OVERRIDE_VARS.map(v => `unset ${v}`) : []),
        `cd '${cwd}'`, `${cfg.claudeCommand} ${claudeArgs}`.trim()];
  return lines.join(IS_WIN ? '\r\n' : '\n') + (IS_WIN ? '\r\n' : '\n');
}

function cleanupLaunchScripts() {
  try {
    for (const f of fs.readdirSync(LAUNCH_DIR)) {
      const p = path.join(LAUNCH_DIR, f);
      const st = fs.statSync(p);
      if (Date.now() - st.mtimeMs > 2 * 24 * 3600 * 1000) fs.unlinkSync(p);
    }
  } catch { /* nothing to clean */ }
}

function spawnDetached(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts }); }
    catch (err) { return resolve({ ok: false, error: err.message }); }
    let settled = false;
    child.on('error', err => { if (!settled) { settled = true; resolve({ ok: false, error: err.message }); } });
    child.on('spawn', () => { if (!settled) { settled = true; child.unref(); resolve({ ok: true }); } });
  });
}

// Opens a terminal running `claude <claudeArgs>` in `cwd` as `account`.
async function openTerminal(cfg, account, cwd, claudeArgs, label) {
  const title = `Claude - ${account.name}${label ? ` - ${label}` : ''}`;
  return runInTerminal(cfg, cwd, title, launchScript(cfg, account, cwd, claudeArgs, title));
}
// Opens a terminal running `codex <codexArgs>` in `cwd`.
async function openCodexTerminal(cfg, cwd, codexArgs, label) {
  const title = `Codex${label ? ` - ${label}` : ''}`;
  return runInTerminal(cfg, cwd, title, codexLaunchScript(cfg, cwd, codexArgs, title));
}
async function runInTerminal(cfg, cwd, title, script) {
  const wantWT = cfg.prefs.terminal === 'auto' || cfg.prefs.terminal.startsWith('wt');
  const wt = wantWT && await hasWindowsTerminal();
  const how = wt ? (cfg.prefs.terminal === 'wt-window' ? 'Windows Terminal window' : 'Windows Terminal tab') : 'console window';

  if (DRY_RUN) return { dryRun: true, how, script };

  fs.mkdirSync(LAUNCH_DIR, { recursive: true });
  const file = path.join(LAUNCH_DIR, `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.cmd`);
  fs.writeFileSync(file, script);

  if (wt) {
    // Windows Terminal treats ";" as a command separator, so escape it in paths.
    const wtPath = p => p.replace(/;/g, '\\;');
    const r = await spawnDetached('wt.exe', ['-w', cfg.prefs.terminal === 'wt-window' ? 'new' : '0', 'new-tab', '--title', titleSafe(title), '-d', wtPath(cwd), 'cmd.exe', '/k', wtPath(file)], { cwd });
    if (r.ok) return { ok: true, how };
  }
  const r = await spawnDetached('cmd.exe', [`/d /c start "${titleSafe(title)}" cmd.exe /k "${file}"`], { cwd, windowsVerbatimArguments: true });
  return r.ok ? { ok: true, how: 'console window' } : { ok: false, error: r.error };
}

// Runs `claude <args>` without a window (used for "open in desktop app").
async function runHidden(cfg, account, cwd, claudeArgs) {
  if (DRY_RUN) return { dryRun: true, how: 'background', script: launchScript(cfg, account, cwd, claudeArgs, 'hidden') };
  const r = await runClaude(cfg, account, claudeArgs, { cwd, timeoutMs: 30000 });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ') || 'Claude Code reported an error.' };
  return { ok: true };
}

// A PowerShell line that does the same thing by hand.
function manualCommand(cfg, account, cwd, claudeArgs) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const parts = [`Set-Location ${q(cwd)}`];
  parts.push(account.isDefault ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue' : `$env:CLAUDE_CONFIG_DIR = ${q(account.configDir)}`);
  const claude = /\s/.test(cfg.claudeCommand) ? `& ${q(cfg.claudeCommand)}` : cfg.claudeCommand;
  parts.push(`${claude} ${claudeArgs}`.trim());
  return parts.join('; ');
}

// ---------- windows, explorer, shortcuts ----------

function findAppBrowser() {
  if (!IS_WIN) return null;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function openAppWindow(url, prefs) {
  if (process.env.SWITCHER_NO_BROWSER === '1' || !IS_WIN) return { ok: false };
  const browser = prefs.appWindow ? findAppBrowser() : null;
  if (browser) {
    const r = await spawnDetached(browser, [`--app=${url}`, '--window-size=1280,860']);
    if (r.ok) return r;
  }
  return spawnDetached('cmd.exe', [`/d /c start "" "${url}"`], { windowsVerbatimArguments: true });
}

// Opens a link in the default browser (used for the ChatGPT sign-in page).
async function openUrl(url) {
  if (!/^https:\/\//.test(url)) return { ok: false, error: 'Only https links can be opened.' };
  if (DRY_RUN || process.env.SWITCHER_NO_BROWSER === '1') return { dryRun: true, how: 'browser', script: url };
  // rundll32 hands the link to the default browser without going through a shell.
  return spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
}

// claude.ai in its own browser profile per account, so each account stays signed in on the web too.
function webProfileDir(accountId) {
  const base = IS_WIN ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'SessionSwitcher', 'web', String(accountId).replace(/[^\w-]/g, '_'));
}
async function openWebProfile(url, accountId) {
  const dir = webProfileDir(accountId);
  if (DRY_RUN) return { dryRun: true, how: 'browser window', script: `chrome --app=${url} --user-data-dir="${dir}"` };
  const browser = findAppBrowser();
  if (!browser) return { ok: false, error: 'Chrome or Microsoft Edge is needed to keep each account signed in to claude.ai separately.' };
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* the browser will create it */ }
  return spawnDetached(browser, [`--app=${url}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1320,920']);
}

async function revealInExplorer(target, selectFile) {
  if (DRY_RUN) return { dryRun: true, how: 'Explorer', script: `explorer.exe ${selectFile ? '/select,' : ''}"${target}"` };
  return spawnDetached('explorer.exe', [selectFile ? `/select,"${target}"` : `"${target}"`], { windowsVerbatimArguments: true });
}

// Windows' own "choose a folder" window, on top of everything, starting at `start`.
async function pickFolder(start, title) {
  if (DRY_RUN) return { dryRun: true };
  const q = s => `'${String(s || '').replace(/'/g, "''")}'`;
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$f.Description = ${q(title || 'Choose a folder')}`,
    '$f.ShowNewFolderButton = $true',
    `$p = ${q(start)}`,
    'if ($p -and (Test-Path -LiteralPath $p)) { $f.SelectedPath = $p }',
    '$o = New-Object System.Windows.Forms.Form',
    "$o.TopMost = $true; $o.ShowInTaskbar = $false; $o.StartPosition = 'CenterScreen'; $o.Size = New-Object System.Drawing.Size(1,1); $o.Opacity = 0",
    '$o.Show(); $o.Activate()',
    '$r = $f.ShowDialog($o)',
    '$o.Close()',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }',
  ].join('; ');
  const r = await runPowerShell(ps, { sta: true, timeoutMs: 10 * 60 * 1000 });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 300) || 'The folder window couldn’t open.' };
  const picked = r.stdout.trim();
  return picked ? { ok: true, path: picked } : { cancelled: true };
}

async function createDesktopShortcut(appDir) {
  const vbs = path.join(appDir, 'Claude Switcher.vbs');
  const icon = path.join(appDir, 'icon.ico');
  if (DRY_RUN) return { dryRun: true, how: 'shortcut', script: `Shortcut to ${vbs}` };
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const ps = [
    `$d=[Environment]::GetFolderPath('Desktop')`,
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Claude Session Switcher.lnk'))`,
    `$s.TargetPath='wscript.exe'`,
    `$s.Arguments='"' + ${q(vbs)} + '"'`,
    `$s.WorkingDirectory=${q(appDir)}`,
    fs.existsSync(icon) ? `$s.IconLocation=${q(icon)}` : '',
    `$s.Description='Resume Claude Code chats as any of your accounts'`,
    `$s.Save()`,
  ].filter(Boolean).join('; ');
  const r = await runPowerShell(ps, { timeoutMs: 20000 });
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 300) || 'PowerShell could not create the shortcut.' };
}

module.exports = {
  IS_WIN, DRY_RUN, OVERRIDE_VARS,
  spawnClaude, killTree,
  runCapture, runPowerShell, runClaude, claudeVersion, whereIs, hasWindowsTerminal, runningSessions, parseProcessList, forget,
  parseVersion, versionAtLeast,
  launchScript, cleanupLaunchScripts, openTerminal, runHidden, manualCommand,
  spawnCodex, codexEnv, codexCommand, codexLaunchScript, codexManualCommand, openCodexTerminal, openUrl, runInTerminal,
  openAppWindow, revealInExplorer, pickFolder, createDesktopShortcut, findAppBrowser, openWebProfile, webProfileDir,
};
