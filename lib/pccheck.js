'use strict';
// PC check-up: what's running and what's taking space on this PC, looked at when you ask (never by itself). The
// programs using the most memory or CPU (a program's many processes as one line), any that have stopped responding,
// and space that can be freed: old temporary files, this app's own test leftovers, package caches, crash dumps, the
// Recycle Bin and big old downloads. Claude says in a few words what each is and whether it's safe to close or clear
// (from its name, publisher, description and folder: never its command line, which can hold passwords, or its
// window's title, which can be an email's subject).
// Nothing is closed or deleted unless you tick it and confirm, and only what the check itself found, checked again
// just before: Windows' own processes and Session Switcher's (its chats included) can't be ticked; a program is asked
// to close as it would be by its own close button, and is only forced if you say so; caches and temporary files are
// deleted for good (they come back as needed), a download goes to the Recycle Bin. Windows only, for now.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const MB = 1024 * 1024;
// Windows' own: never offered (closing one can log you out, or worse).
const SYSTEM = new Set(['system', 'system idle process', 'idle', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe', 'fontdrvhost.exe', 'memory compression', 'secure system', 'msmpeng.exe', 'nissrv.exe', 'securityhealthservice.exe', 'securityhealthsystray.exe', 'audiodg.exe', 'spoolsv.exe', 'sihost.exe', 'taskhostw.exe', 'ctfmon.exe', 'runtimebroker.exe', 'searchhost.exe', 'searchindexer.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe', 'textinputhost.exe', 'conhost.exe', 'dllhost.exe', 'wmiprvse.exe', 'lsm.exe', 'smartscreen.exe', 'applicationframehost.exe', 'systemsettings.exe', 'wudfhost.exe', 'dashost.exe', 'mpdefendercoreservice.exe']);

// What's running, twice 1.5 s apart (for how busy each is), the windows' state, the drives and the Recycle Bin. (Each
// program's description and maker are asked afterwards, for the few shown: reading them for every process is slow.)
const SCAN_PS = `$ErrorActionPreference='SilentlyContinue'
$ms = { param($d) if ($d) { [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 } }
$a = Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; exe=$_.ExecutablePath; cmd=$_.CommandLine; start=(& $ms $_.CreationDate); mem=[int64]$_.WorkingSetSize; cpu=[int64]($_.KernelModeTime + $_.UserModeTime); session=$_.SessionId } }
Start-Sleep -Milliseconds 1500
$b = Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; cpu=[int64]($_.KernelModeTime + $_.UserModeTime) } }
$g = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [pscustomobject]@{ pid=$_.Id; responding=$_.Responding; title=$_.MainWindowTitle } }
$d = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ id=$_.DeviceID; size=[int64]$_.Size; free=[int64]$_.FreeSpace } }
$rb = 0; try { $rb = [int64](((New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum).Sum) } catch {}
[pscustomobject]@{ a=@($a); b=@($b); g=@($g); drives=@($d); recycle=$rb; cores=[Environment]::ProcessorCount; mem=[int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory } | ConvertTo-Json -Depth 4 -Compress`;

const home = () => os.homedir();
const tidyPath = p => (p ? String(p).replace(home(), '~') : '');

// A program's description and maker, for the few shown.
const ABOUT_PS = pids => `$ErrorActionPreference='SilentlyContinue'; @(Get-Process -Id ${pids.map(Number).join(',')} | ForEach-Object { [pscustomobject]@{ pid=$_.Id; desc=$_.Description; company=$_.Company } }) | ConvertTo-Json -Compress`;
// Runtimes that run all sorts of things (one node.exe is a dev server, another a test run): a line for each process,
// with the script it runs.
const RUNTIMES = new Set(['node.exe', 'python.exe', 'pythonw.exe', 'java.exe', 'javaw.exe', 'dotnet.exe', 'ruby.exe', 'php.exe', 'deno.exe', 'bun.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe']);
// The script a runtime runs: its file's name only, never the rest of the command line (which can hold passwords).
function scriptOf(cmd) {
  const parts = String(cmd || '').match(/"[^"]+"|\S+/g) || [];
  for (const raw of parts.slice(1)) { const p = raw.replace(/^"|"$/g, ''); if (/\.(c?m?js|ts|py|ps1|bat|cmd|jar|rb|php|dll)$/i.test(p)) return path.basename(p).slice(0, 60); }
  return '';
}
// A Claude Code or Codex chat (one in a terminal, or one this app still keeps an eye on): closed from its chat, never
// here. The Claude desktop app is claude.exe too, but lives elsewhere.
function isAgent(p) {
  const n = String(p.name || '').toLowerCase(), exe = String(p.exe || '').toLowerCase(), cmd = String(p.cmd || '').toLowerCase();
  return (n === 'claude.exe' && /\\\.local\\bin\\|@anthropic-ai|claude-code/.test(exe)) || n === 'codex.exe' || /@openai[\\/]codex|@anthropic-ai[\\/]claude-code/.test(cmd);
}
// A process's parent, when it really is (Windows reuses a closed process's number, so the number a process was started
// under can belong to a newer, unrelated one by now: a parent started after its child isn't its parent).
function parentFinder(list) {
  const byPid = new Map(list.map(p => [p.pid, p]));
  return p => { const up = byPid.get(p.ppid); return up && up.pid !== p.pid && !(up.start && p.start && up.start > p.start) ? up : null; };
}
// Everything under a process (its children, theirs, and so on).
function treeUnder(list, pid) {
  const parentOf = parentFinder(list), kids = new Map();
  for (const p of list) { const up = parentOf(p); if (up) { if (!kids.has(up.pid)) kids.set(up.pid, []); kids.get(up.pid).push(p); } }
  const out = [], seen = new Set([pid]), stack = [pid];
  while (stack.length) for (const c of kids.get(stack.pop()) || []) if (!seen.has(c.pid)) { seen.add(c.pid); out.push(c); stack.push(c.pid); }
  return out;
}
// Processes into lines: a program's processes together (by name; Session Switcher's own apart from the rest; a
// runtime's one by one), with how much memory and CPU, since when, whether a window has stopped responding, and why
// it can't be ticked (Windows' own; Session Switcher's own; a chat; what a chat or this app runs inside; a service).
function readProcesses(raw, { selfPids = new Set(), seconds = 1.5 } = {}) {
  const a = Array.isArray(raw && raw.a) ? raw.a : [];
  const later = new Map((raw && Array.isArray(raw.b) ? raw.b : []).map(p => [p.pid, p.cpu]));
  const gui = new Map((raw && Array.isArray(raw.g) ? raw.g : []).map(p => [p.pid, p]));
  const cores = Math.max(1, Number(raw && raw.cores) || 1);
  const byPid = new Map(a.map(p => [p.pid, p]));
  const parentOf = parentFinder(a);
  // Session Switcher's own: this server, what it's under (the desktop app) and everything it started.
  const ours = new Set(selfPids);
  for (const pid of selfPids) for (const c of treeUnder(a, pid)) ours.add(c.pid);
  for (const pid of [...selfPids]) { let p = byPid.get(pid), n = 0; while (p && n++ < 4) { const up = parentOf(p); if (!up || !/session switcher|electron/i.test(up.name || '')) break; ours.add(up.pid); p = up; } }
  // A chat, and what it started (its tools).
  const agent = new Set();
  for (const p of a.filter(isAgent)) { agent.add(p.pid); for (const c of treeUnder(a, p.pid)) agent.add(c.pid); }
  // What a chat or this app runs inside (a terminal, an editor): closing that, with everything under it, would close
  // them too.
  const above = (pids, into) => { for (const pid of pids) { let p = byPid.get(pid), n = 0; while (p && n++ < 64) { const up = parentOf(p); if (!up || into.has(up.pid)) break; into.add(up.pid); p = up; } } return into; };
  const hostsOurs = above(selfPids, new Set()), hostsChat = above([...agent], new Set());
  const groups = new Map();
  for (const p of a) {
    const name = String(p.name || '').trim(); if (!name || p.pid === 0) continue;
    const lower = name.toLowerCase(), runtime = RUNTIMES.has(lower);
    // A program's processes together, by its name and its folder (two programs can share a file name); Session
    // Switcher's own and a chat's apart; a runtime's one by one.
    const dir = p.exe ? path.dirname(String(p.exe)).toLowerCase() : '';
    const whose = ours.has(p.pid) ? ':ours' : agent.has(p.pid) ? ':chat' : '';
    const k = runtime ? `${lower}#${p.pid}` : `${lower}${dir ? `@${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 6)}` : ''}${whose}`;
    const g = groups.get(k) || { id: `p:${k}`, kind: 'process', name, label: '', path: '', script: runtime ? scriptOf(p.cmd) : '', count: 0, memMB: 0, cpu: 0, since: 0, hung: false, title: '', company: '', pids: [], protected: null };
    const w = gui.get(p.pid) || {};
    g.count++;
    g.memMB += (Number(p.mem) || 0) / MB;
    const used = later.has(p.pid) ? Math.max(0, later.get(p.pid) - (Number(p.cpu) || 0)) : 0;   // 100-ns units
    g.cpu += used / (seconds * 1e7 * cores) * 100;
    if (p.start && (!g.since || p.start < g.since)) g.since = p.start;
    if (w.title && !g.title) g.title = String(w.title).slice(0, 80);
    if (w.desc && !g.label) g.label = String(w.desc).slice(0, 80);
    if (w.company && !g.company) g.company = String(w.company).slice(0, 60);
    if (p.exe && !g.path) g.path = tidyPath(path.dirname(p.exe));
    if (w.responding === false && w.title) g.hung = true;
    g.pids.push({ pid: p.pid, ppid: p.ppid, start: p.start || 0, ours: ours.has(p.pid), agent: agent.has(p.pid), hostsOurs: hostsOurs.has(p.pid), hostsChat: hostsChat.has(p.pid), session: p.session });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    g.memMB = Math.round(g.memMB); g.cpu = Math.round(g.cpu * 10) / 10;
    g.firstPid = g.pids[0] ? g.pids[0].pid : 0;
    const k = g.name.toLowerCase();
    g.protected = SYSTEM.has(k) ? 'Windows needs this' : g.pids.some(p => p.ours) || k === 'session switcher.exe' ? 'Session Switcher’s own'
      : g.pids.some(p => p.agent) ? 'Part of a Claude Code or Codex chat: close it from its chat'
        : g.pids.some(p => p.hostsOurs) ? 'Session Switcher runs inside it'
          : g.pids.some(p => p.hostsChat) ? 'A Claude Code or Codex chat runs inside it: close that first'
            : g.pids.every(p => p.session === 0) ? 'A Windows service' : null;
    // What to close: the processes at the top of the program's own tree (closing those closes the rest), apart from a
    // service's (a program can run as both: only your own copy is closed).
    const live = g.pids.filter(p => p.session !== 0), mine = new Set(live.map(p => p.pid));
    g.roots = live.filter(p => !mine.has(p.ppid)).map(p => ({ pid: p.pid, start: p.start }));
    delete g.pids;
  }
  return [...groups.values()];
}
// The ones worth showing: the most memory, the busiest, and any not responding.
function pickProcesses(groups) {
  const byMem = [...groups].sort((x, y) => y.memMB - x.memMB).slice(0, 12);
  const byCpu = [...groups].filter(g => g.cpu >= 1).sort((x, y) => y.cpu - x.cpu).slice(0, 6);
  const hung = groups.filter(g => g.hung);
  const out = new Map();
  for (const g of [...hung, ...byCpu, ...byMem]) out.set(g.id, g);
  return [...out.values()];
}

// How big a folder is, with a budget (a huge one is "at least" what was counted), and when it last changed.
async function sizeOf(target, { budgetMs = 4000, maxEntries = 400000 } = {}) {
  const until = Date.now() + budgetMs;
  let bytes = 0, entries = 0, newest = 0, partial = false;
  let top; try { top = await fs.promises.lstat(target); } catch { return { bytes, entries, newest, partial }; }
  newest = top.mtimeMs;
  if (top.isSymbolicLink() || !top.isDirectory()) return { bytes: top.isSymbolicLink() ? 0 : top.size, entries: 1, newest, partial };
  // A folder at a time: its folders go on the list, its files' sizes are read together (many at once is much faster
  // than one by one, on Windows especially). Links aren't followed.
  const stack = [target];
  while (stack.length) {
    if (Date.now() > until || entries > maxEntries) { partial = true; break; }
    const dir = stack.pop();
    let list = []; try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const files = [];
    for (const e of list) { entries++; if (e.isSymbolicLink()) continue; if (e.isDirectory()) stack.push(path.join(dir, e.name)); else if (e.isFile()) files.push(path.join(dir, e.name)); }
    for (let i = 0; i < files.length; i += 64) {
      const sts = await Promise.all(files.slice(i, i + 64).map(f => fs.promises.stat(f).catch(() => null)));
      for (const st of sts) if (st) { bytes += st.size; if (st.mtimeMs > newest) newest = st.mtimeMs; }
    }
  }
  return { bytes, entries, newest, partial };
}
// Where space can be freed, and how each is cleared: 'delete' (for good: temporary files and caches), 'recycle' (to
// the Recycle Bin: your own files), 'empty' (the Recycle Bin, emptied).
function spacePlaces(env = process.env) {
  const local = env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local');
  return [
    // (Its _npx folder is kept: the tools chats start with npx run from there.)
    { id: 's:npm', label: 'npm’s download cache', dir: path.join(local, 'npm-cache'), how: 'delete', inside: true, keep: ['_npx'] },
    { id: 's:yarn', label: 'Yarn’s download cache', dir: path.join(local, 'Yarn', 'Cache'), how: 'delete', inside: true },
    { id: 's:pnpm', label: 'pnpm’s package store', dir: path.join(local, 'pnpm', 'store'), how: 'delete', inside: true },
    { id: 's:pip', label: 'pip’s download cache', dir: path.join(local, 'pip', 'Cache'), how: 'delete', inside: true },
    { id: 's:dumps', label: 'Crash dumps', dir: path.join(local, 'CrashDumps'), how: 'delete', inside: true },
  ];
}
// This app's own test leftovers in the temp folder (ss-…), but never what it uses while running: a race's working
// copies (ss-race) and the subagents' relay (ss-relay-…).
const isTestLeftover = n => /^ss-[\w.-]+$/i.test(n) && !/^ss-(race|relay)/i.test(n);
// What this app and Claude Code keep in the temp folder while they run (the app's lock file, written once when it
// starts; its launch folder; Claude Code's own folder): never "old", however long since they changed.
const appsOwn = n => /^(session-switcher|claude-switcher|claude)([-.]|$)/i.test(n);
// A test run's folder names the run's process (ss-run-<pid>-…): while that's running, it's in use.
const runStillGoing = n => { const m = /^ss-run-(\d+)-/i.exec(n); if (!m) return false; try { process.kill(Number(m[1]), 0); return true; } catch (err) { return err.code === 'EPERM'; } };
async function spaceItems({ tmp = os.tmpdir(), now = Date.now(), env = process.env, recycle = 0, downloads = path.join(home(), 'Downloads'), budgetMs = 15000, known = new Map() } = {}) {
  const until = Date.now() + budgetMs, left = () => Math.max(300, until - Date.now());
  const out = [];
  // The temp folder: this app's own test leftovers, and anything else untouched for a week. A folder is only offered
  // once all of it has been looked at (time running out partway, it might be in use deeper down); what was looked at
  // is remembered for ten minutes (known: path → its size and newest date), so Check again gets further.
  let names = []; try { names = await fs.promises.readdir(tmp); } catch { /* none */ }
  const tests = { id: 's:tests', label: 'Session Switcher’s test leftovers', note: 'folders its tests left in the temp folder', how: 'delete', bytes: 0, newest: 0, paths: [], unlooked: 0 };
  const old = { id: 's:temp', label: 'Old temporary files', note: 'in your temp folder, untouched for a week', how: 'delete', bytes: 0, newest: 0, paths: [], unlooked: 0 };
  for (const n of names) {
    const p = path.join(tmp, n);
    let st; try { st = await fs.promises.lstat(p); } catch { continue; }
    if (st.isSymbolicLink() || appsOwn(n)) continue;
    const leftover = isTestLeftover(n);
    if (leftover && runStillGoing(n)) continue;
    if (!leftover && now - st.mtimeMs <= 7 * 864e5) continue;   // (changed this week at its top: in use)
    let s = null;
    if (!st.isDirectory()) s = { bytes: st.size, newest: st.mtimeMs, partial: false };
    else {
      const k = known.get(p);
      if (k && k.mtime === st.mtimeMs && now - k.at < 10 * 60000) s = k;
      else if (Date.now() < until) { s = await sizeOf(p, { budgetMs: Math.min(1500, until - Date.now()) }); if (!s.partial) known.set(p, { ...s, mtime: st.mtimeMs, at: now }); }
    }
    const into = leftover ? tests : old;
    if (!s || s.partial) { into.unlooked++; continue; }
    const newest = Math.max(s.newest, st.mtimeMs);
    if (now - newest <= (leftover ? 2 * 3600e3 : 7 * 864e5)) continue;
    into.bytes += s.bytes; into.paths.push(p); if (newest > into.newest) into.newest = newest;
  }
  for (const it of [tests, old]) {
    if (it.unlooked) it.note += `; ${it.unlooked.toLocaleString()} more still to look at (Check again)`;
    if (it.paths.length && it.bytes > 20 * MB) out.push(it);
  }
  for (const pl of spacePlaces(env)) {
    let st; try { st = await fs.promises.lstat(pl.dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    // (What it keeps isn't counted, or cleared.)
    let bytes = 0, newest = 0, partial = false;
    let list = []; try { list = await fs.promises.readdir(pl.dir); } catch { continue; }
    for (const n of list) {
      if ((pl.keep || []).includes(n)) continue;
      const s = await sizeOf(path.join(pl.dir, n), { budgetMs: Math.min(1200, left()) });
      bytes += s.bytes; newest = Math.max(newest, s.newest); partial = partial || s.partial;
    }
    if (bytes > 20 * MB) out.push({ id: pl.id, label: pl.label, note: `rebuilt by itself when it’s needed${(pl.keep || []).length ? ` (its ${pl.keep.join(', ')} folder, which running tools use, is kept)` : ''}`, how: pl.how, bytes, newest, paths: [pl.dir], inside: true, keep: pl.keep || [], partial });
  }
  if (recycle > 20 * MB) out.push({ id: 's:recycle', label: 'The Recycle Bin', note: 'emptied for good', how: 'empty', bytes: recycle, newest: 0, paths: [] });
  // Big downloads untouched for three months: your own files, so only ever to the Recycle Bin, and never suggested.
  let dl = []; try { dl = await fs.promises.readdir(downloads, { withFileTypes: true }); } catch { /* none */ }
  for (const e of dl) {
    if (!e.isFile()) continue;
    const p = path.join(downloads, e.name);
    let st; try { st = await fs.promises.stat(p); } catch { continue; }
    if (st.size > 200 * MB && now - Math.max(st.mtimeMs, st.atimeMs || 0) > 90 * 864e5) out.push({ id: `s:dl:${e.name.toLowerCase()}`, label: e.name, note: 'in Downloads, not opened for three months', how: 'recycle', bytes: st.size, newest: st.mtimeMs, paths: [p], personal: true });
  }
  return out;
}

// What Claude is asked: each line in a few words, and whether to close or clear it.
const ARGS = ['-p', '--model', 'sonnet', '--no-session-persistence', '--tools=', '--setting-sources=', '--strict-mcp-config', '--output-format', 'text'];
// A window's title isn't sent (it can be an email's subject or a document's name), and the folder has your user
// folder as ~.
const homeAs = (p, home = os.homedir()) => (p && home && p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p);
function explainPrompt(items) {
  const lines = items.map(it => it.kind === 'process'
    ? { id: it.id, kind: 'program', name: it.name, description: it.label || undefined, company: it.company || undefined, folder: homeAs(it.path) || undefined, script: it.script || undefined, processes: it.count, memoryMB: it.memMB, cpuPercent: it.cpu, runningForHours: it.since ? Math.round((Date.now() - it.since) / 36e5) : undefined, notResponding: it.hung || undefined, cannotClose: it.protected || undefined }
    : { id: it.id, kind: 'space', name: it.label, note: it.note, sizeMB: Math.round(it.bytes / MB), personalFile: it.personal || undefined });
  return [
    'These are programs running on my Windows PC and places taking up space on it. For each, say in a few plain words what it is, and whether I can close or clear it.',
    'Reply with JSON only: an array of {"id", "what", "advice", "why"}, one per item, same ids.',
    '- what: what it is, in under 10 words (like "Google Chrome, the web browser" or "A cache npm rebuilds when needed").',
    '- advice: "close" (safe to close or clear now), "careful" (fine to close, but save your work first, or it may be in use), or "leave" (needs to stay, or you probably want it).',
    '- why: under 12 words, only when it helps (like "Not responding for a while" or "Using 3 GB for an idle window").',
    'Programs marked cannotClose: advice "leave". Personal files: "careful" at most. Don’t guess beyond what the name, description, company and folder say.',
    `\nItems:\n${JSON.stringify(lines)}`,
  ].join('\n');
}
function parseExplain(out) {
  const text = String(out || '');
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return {};
  let arr = []; try { arr = JSON.parse(m[0]); } catch { return {}; }
  const res = {};
  for (const x of Array.isArray(arr) ? arr : []) {
    if (!x || typeof x.id !== 'string') continue;
    res[x.id] = { what: String(x.what || '').slice(0, 100), advice: ['close', 'careful', 'leave'].includes(x.advice) ? x.advice : 'careful', why: String(x.why || '').slice(0, 120) };
  }
  return res;
}

// A file to the Recycle Bin, only when the bin will take it: one bigger than the bin's limit on its drive, or on a drive
// whose bin is turned off, Windows would delete for good without a word, so it's left. (The path comes in by the
// environment, never in the script's text: a name can hold quotes of any kind.)
const RECYCLE_PS = String.raw`$ErrorActionPreference='SilentlyContinue'
$f = Get-Item -LiteralPath $env:PCK_PATH -Force
if (-not $f) { 'gone'; exit }
$root = [IO.Path]::GetPathRoot($f.FullName).TrimEnd('\')
$vol = Get-CimInstance Win32_Volume | Where-Object { $_.DriveLetter -eq $root } | Select-Object -First 1
if (-not $vol) { 'nobin'; exit }
$guid = ([regex]'\{[^}]+\}').Match([string]$vol.DeviceID).Value
$k = Get-ItemProperty -LiteralPath ('HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\' + $guid)
if ($k -and $k.NukeOnDelete -eq 1) { 'nobin'; exit }
$max = if ($k -and $k.MaxCapacity) { [int64]$k.MaxCapacity * 1MB } else { [int64]($vol.Capacity * 0.05) }
if ([int64]$f.Length -ge $max) { 'big'; exit }
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
'ok'`;
// A process still the one the check found (its number reused by another since: not touched).
const sameProcess = (now, was) => now && now.start === was.start;
const GONE = 'already closed';

function createPcCheck({ runPowerShell, spawnClaude, kill = c => c.kill(), selfPids = () => new Set([process.pid]), log = () => {}, env = process.env, tmp = os.tmpdir(), downloads = path.join(home(), 'Downloads') } = {}) {
  let last = null;   // the last check: what can be acted on comes from here, by id
  let scanning = null, acting = false;
  const known = new Map();   // temp folders looked at in full lately (spaceItems)
  // One check at a time: asked again meanwhile (from a phone, say), the same check answers both.
  function scan() {
    if (!scanning) scanning = doScan().finally(() => { scanning = null; });
    return scanning;
  }
  async function doScan() {
    if (!IS_WIN || !runPowerShell) return { supported: false, at: Date.now(), processes: [], space: [], drives: [] };
    // (The space is measured meanwhile, alongside; the Recycle Bin's size comes with the answer.)
    const [r, space0] = await Promise.all([runPowerShell(SCAN_PS, { timeoutMs: 60000 }), spaceItems({ tmp, env, recycle: 0, downloads, known })]);
    let raw = null; try { raw = JSON.parse(String(r.stdout || '').trim()); } catch { /* below */ }
    if (!raw) throw Object.assign(new Error(`Windows didn’t say what’s running${r.stderr ? `: ${String(r.stderr).trim().slice(0, 160)}` : '.'}`), { status: 502 });
    const groups = readProcesses(raw, { selfPids: selfPids() });
    const processes = pickProcesses(groups);
    // What each shown program is, as its file says (a runtime's script says more than its own name).
    const ids = processes.map(g => g.firstPid).filter(Boolean);
    if (ids.length) {
      const ab = await runPowerShell(ABOUT_PS(ids), { timeoutMs: 30000 });
      let list = []; try { const j = JSON.parse(String(ab.stdout || '').trim() || '[]'); list = Array.isArray(j) ? j : [j]; } catch { /* without */ }
      const by = new Map(list.filter(Boolean).map(x => [x.pid, x]));
      for (const g of processes) { const x = by.get(g.firstPid); if (x) { g.label = String(x.desc || '').slice(0, 80); g.company = String(x.company || '').slice(0, 60); } }
    }
    const rb = Number(raw.recycle) || 0;
    const space = rb > 20 * MB ? [...space0.filter(x => x.id !== 's:recycle'), { id: 's:recycle', label: 'The Recycle Bin', note: 'emptied for good', how: 'empty', bytes: rb, newest: 0, paths: [] }] : space0;
    const drives = (Array.isArray(raw.drives) ? raw.drives : []).map(d => ({ id: d.id, sizeGB: Math.round(d.size / 1024 / MB), freeGB: Math.round(d.free / 1024 / MB * 10) / 10 }));
    last = { at: Date.now(), processes, space };
    return { supported: true, at: last.at, processes, space: space.map(({ paths, ...rest }) => ({ ...rest, count: paths.length })), drives, memGB: Math.round((Number(raw.mem) || 0) / 1024 / MB) };
  }
  // Claude's word on each line of the last check (an empty answer: the list stands without it).
  function explain(account) {
    if (!last || !spawnClaude) return Promise.resolve({});
    const items = [...last.processes, ...last.space].slice(0, 40);
    return new Promise(res => {
      let child; try { child = spawnClaude(account, ARGS, os.tmpdir()); } catch (err) { log(`PC check-up: couldn’t ask Claude: ${err.message}`); res({}); return; }
      let out = '', done = false;
      const end = v => { if (done) return; done = true; clearTimeout(timer); res(v); };
      const timer = setTimeout(() => { try { kill(child); } catch { /* gone */ } end({}); }, 90000);
      if (timer.unref) timer.unref();
      child.on('error', () => end({}));
      child.stdout.on('data', d => { out += d; if (out.length > 60000) out = out.slice(-60000); });
      child.on('close', code => end(code === 0 ? parseExplain(out) : {}));
      child.stdin.on('error', () => {});
      child.stdin.end(explainPrompt(items));
    });
  }
  // Every process as it is now (with what it runs, to tell a chat): read again before each close.
  async function everything() {
    const r = await runPowerShell(`$ErrorActionPreference='SilentlyContinue'; $ms = { param($d) if ($d) { [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 } }; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; exe=$_.ExecutablePath; cmd=$_.CommandLine; start=(& $ms $_.CreationDate) } }) | ConvertTo-Json -Compress`, { timeoutMs: 30000 });
    let list = []; try { const j = JSON.parse(String(r.stdout || '').trim() || '[]'); list = Array.isArray(j) ? j : []; } catch { /* none */ }
    return list.filter(p => p && p.pid);
  }
  // The processes as they are now (number → start time), to check before closing.
  async function nowRunning(pids) {
    if (!pids.length) return new Map();
    const r = await runPowerShell(`$ErrorActionPreference='SilentlyContinue'; $ms = { param($d) [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }; @(Get-CimInstance Win32_Process -Filter "${pids.map(p => `ProcessId=${Number(p)}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; start=(& $ms $_.CreationDate) } }) | ConvertTo-Json -Compress`, { timeoutMs: 30000 });
    let list = []; try { const j = JSON.parse(String(r.stdout || '').trim() || '[]'); list = Array.isArray(j) ? j : [j]; } catch { /* none */ }
    return new Map(list.filter(Boolean).map(p => [p.pid, p]));
  }
  // Close the ticked programs (asked, as their close button would; force: ended at once) and clear the ticked places.
  // at: the check the ticks were made on (another check since, from a phone say: check again first). One at a time.
  async function act({ close = [], free = [], force = false, at = null } = {}) {
    if (!IS_WIN) throw Object.assign(new Error('PC check-up is for Windows for now.'), { status: 400 });
    if (!last) throw Object.assign(new Error('Check the PC first.'), { status: 409 });
    if (at !== null && at !== last.at) throw Object.assign(new Error('The list has changed since (it was checked again). Look it over and tick again.'), { status: 409 });
    if (Date.now() - last.at > 30 * 60000) throw Object.assign(new Error('That check is over half an hour old. Check again first.'), { status: 409 });
    if (acting) throw Object.assign(new Error('It’s still closing and clearing the last lot.'), { status: 409 });
    acting = true;
    // (The check the ticks were made on, kept as it was: one asked for meanwhile, from a phone say, changes nothing here.)
    try { return await doAct({ close, free, force, check: last }); } finally { acting = false; }
  }
  async function doAct({ close, free, force, check }) {
    const results = [];
    const groups = close.map(id => check.processes.find(g => g.id === id)).filter(Boolean);
    const roots = groups.flatMap(g => (g.protected ? [] : g.roots.map(r => ({ ...r, g }))));
    const asked = [], stopped = new Map();
    for (const r of roots) {
      // Right before each one: still the process the check found (closing an earlier one can end this one, and its
      // number go to a new process), and nothing inside it that must stay (a chat started in that terminal since, say).
      const now = await everything();
      if (!sameProcess(now.find(p => p.pid === r.pid), r)) continue;
      const self = selfPids();
      const tree = [now.find(p => p.pid === r.pid), ...treeUnder(now, r.pid)];
      const why = tree.some(p => self.has(p.pid) || /session switcher/i.test(p.name || '')) ? 'Session Switcher runs inside it'
        : tree.some(isAgent) ? 'a Claude Code or Codex chat runs inside it: close that first' : '';
      if (why) { stopped.set(r.g, why); continue; }
      // (Its start time checked once more in the same breath as closing it.)
      const res = await runPowerShell(`$ErrorActionPreference='SilentlyContinue'; $ms = { param($d) if ($d) { [int64](($d.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 } }; $p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(r.pid)}"; if ($p -and (& $ms $p.CreationDate) -eq ${Number(r.start)}) { taskkill /PID ${Number(r.pid)} /T${force ? ' /F' : ''} | Out-Null; 'asked' } else { 'gone' }`, { timeoutMs: 15000 });
      if (/asked/.test(String(res.stdout || ''))) asked.push(r);
    }
    for (const g of groups) if (g.protected) results.push({ id: g.id, name: g.name, ok: false, said: `not closed: ${g.protected}` });
    if (asked.length) await new Promise(r => setTimeout(r, force ? 1200 : 3500));
    const after = await nowRunning(asked.map(r => r.pid));
    for (const g of groups.filter(x => !x.protected)) {
      const mine = asked.filter(r => r.g === g);
      const still = mine.filter(r => sameProcess(after.get(r.pid), r));
      if (stopped.has(g) && !mine.length) { results.push({ id: g.id, name: g.name, ok: false, said: `not closed: ${stopped.get(g)}` }); continue; }
      results.push({ id: g.id, name: g.name, ok: !still.length, still: still.length, said: !mine.length ? GONE : still.length ? (force ? 'couldn’t be ended' : 'asked to close, still open (a Save prompt, maybe)') : 'closed' });
    }
    let freed = 0;
    // The Recycle Bin first: emptied after a download went into it, the download would be gone for good.
    const order = [...free].sort((x, y) => (y === 's:recycle') - (x === 's:recycle'));
    for (const id of order) {
      const it = check.space.find(s => s.id === id);
      if (!it) continue;
      try {
        if (it.how === 'empty') { await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', { timeoutMs: 120000 }); freed += it.bytes; results.push({ id, name: it.label, ok: true, said: 'emptied' }); continue; }
        let gone = 0, why = '';
        for (const p of it.paths) {
          if (!allowed(p, it)) continue;
          // (Deleting runs off the server's own thread, so chats carry on meanwhile. fs.promises.rm removes a link as a
          // link, never what it points at.)
          if (it.how === 'recycle') {
            const r = await runPowerShell(RECYCLE_PS, { timeoutMs: 60000, env: { ...process.env, PCK_PATH: p } });
            const said = String(r.stdout || '').trim().split(/\s+/).pop();
            if (said === 'big') why = 'too big for the Recycle Bin, so it’s left: delete it yourself if you’re sure';
            else if (said === 'nobin') why = 'that drive has no Recycle Bin, so it’s left: delete it yourself if you’re sure';
            if (!fs.existsSync(p)) gone++; else log(`PC check-up: didn’t recycle ${p}: ${said || String(r.stderr || '').slice(0, 200)}`);
          } else if (it.inside) {
            let list = []; try { list = await fs.promises.readdir(p); } catch { /* none */ }
            for (const n of list) { if ((it.keep || []).includes(n)) continue; try { await fs.promises.rm(path.join(p, n), { recursive: true, force: true, maxRetries: 2 }); } catch { /* in use: left */ } }
            gone++;
          } else { try { await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 2 }); } catch { /* in use: left */ } if (!fs.existsSync(p)) gone++; }
        }
        const share = it.paths.length ? gone / it.paths.length : 0;
        freed += Math.round(it.bytes * share);
        results.push({ id, name: it.label, ok: gone > 0, said: !gone ? why || 'nothing could be cleared (in use?)' : it.how === 'recycle' ? 'moved to the Recycle Bin' : gone < it.paths.length ? 'cleared, apart from what’s in use' : 'cleared' });
      } catch (err) { results.push({ id, name: it.label, ok: false, said: err.message.slice(0, 160) }); }
    }
    log(`PC check-up: ${results.map(r => `${r.name} ${r.said}`).join('; ')}.`);
    return { results, freed };
  }
  // A path the check found, in a place it may clear: the temp folder's own entries, a known cache, or a download.
  function allowed(p, it) {
    const inside = (dir, x) => { const rel = path.relative(dir, x); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
    if (it.id === 's:tests' || it.id === 's:temp') return path.dirname(p) === path.resolve(tmp);
    if (it.id.startsWith('s:dl:')) return path.dirname(p) === path.resolve(downloads);
    return spacePlaces(env).some(pl => pl.id === it.id && path.resolve(pl.dir) === path.resolve(p)) && !inside(p, path.resolve(tmp)) || false;
  }
  return { scan, explain, act, last: () => last };
}

module.exports = { createPcCheck, readProcesses, pickProcesses, spaceItems, sizeOf, explainPrompt, parseExplain, SYSTEM, SCAN_PS, spacePlaces };
