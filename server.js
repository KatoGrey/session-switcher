#!/usr/bin/env node
// Claude Session Switcher
// Resume your Claude Code chats as any of your Claude accounts, each locked to the account and plan you choose.
// No npm packages needed. Run with: node server.js
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sys = require('./lib/system');
const acc = require('./lib/accounts');
const health = require('./lib/health');
const { createSessionStore } = require('./lib/sessions');
const chatLib = require('./lib/chat');
const usageLib = require('./lib/usage');
const filesLib = require('./lib/files');
const codexLib = require('./lib/codex');
const projectsLib = require('./lib/projects');
const shareLib = require('./lib/sharecopy');
const prefsLib = require('./lib/chatprefs');
const remoteLib = require('./lib/remote');

const APP_VERSION = '5.4.0';
const PORT = Number(process.env.SWITCHER_PORT) || 4777;
const APP_DIR = __dirname;
const CONFIG_FILE = path.join(APP_DIR, 'accounts.json');
const LOG_FILE = path.join(APP_DIR, 'switcher.log');
const TOKEN = crypto.randomBytes(24).toString('hex');
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const EMAIL_RE = /^[A-Za-z0-9._+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DESKTOP_MIN = '2.1.285';

// ---------- logging ----------

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
  } catch { /* no log yet */ }
  try { fs.appendFileSync(LOG_FILE, line + os.EOL); } catch { /* read-only folder */ }
}

// ---------- config (reloaded when the file changes on disk) ----------

let cfg = acc.loadConfig(CONFIG_FILE, log);
let cfgMtime = 0;
function config() {
  const st = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE) : null;
  if (st && st.mtimeMs !== cfgMtime) { cfg = acc.loadConfig(CONFIG_FILE, log); cfgMtime = st.mtimeMs; }
  return cfg;
}
function save() {
  acc.saveConfig(CONFIG_FILE, cfg);
  try { cfgMtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch { /* ignore */ }
}

const sessions = createSessionStore({ root: path.join(config().mainConfigDir, 'projects'), dataDir: APP_DIR, log });
const projectInfo = projectsLib.createProjects({ dataDir: APP_DIR, log });
const chatPrefs = prefsLib.createChatPrefs({ dataDir: APP_DIR, log });

// ---------- live updates ----------

const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}

// Chats running inside the app's chat window.
const finishedSeen = new Map();
const chats = chatLib.createChatManager({
  log,
  onChange: () => { broadcast('live', chats.live()); scheduleActivity(); },
  onSession: chat => {
    if (chat.provider !== 'codex') sessions.recordLaunch(chat.sessionId, chat.account, chat.fork ? 'fork' : 'app');
    // Choices made before the chat had an id, and a Codex helper paired before then, are kept now.
    if (chat.choices && Object.keys(chat.choices).length) chatPrefs.set({ sessionId: chat.sessionId }, chat.choices);
    linkCompanion(chat);
    broadcast('live', chats.live());
    setTimeout(sessionsChanged, 1500);
  },
  onActivity: chat => {
    scheduleActivity();
    // A finished turn changes the account's usage; check it shortly after.
    const f = chat.activity.finishedAt;
    if (f && finishedSeen.get(chat.key) !== f) {
      finishedSeen.set(chat.key, f); scheduleUsage(chat.account.id, 8000);
      for (const k of finishedSeen.keys()) if (!chats.chats.has(k)) finishedSeen.delete(k);
    }
  },
  onRateLimit: (chat, info) => usage.fromRateLimit(chat.account.id, info),
});

// A Claude chat and its Codex helper remember each other once both have ids.
function linkCompanion(chat) {
  let parent = null, helper = null;
  try { if (chat.parentKey) { parent = chats.get(chat.parentKey); helper = chat; } else if (chat.companionKey) { parent = chat; helper = chats.get(chat.companionKey); } } catch { return; }
  if (parent && helper && parent.sessionId && helper.sessionId) chatPrefs.link(parent.sessionId, helper.sessionId);
}

// Plan usage per account (5-hour and weekly windows with reset times).
const usage = usageLib.createUsage({ log, chats, onChange: () => scheduleUsageBroadcast() });

// Codex (OpenAI): its own sign-in, chats and usage, through `codex app-server`.
let codexTimer = null;
const codex = codexLib.createCodex({
  getConfig: () => config(), log, usage, chats,
  onChange: () => { if (codexTimer) return; codexTimer = setTimeout(() => { codexTimer = null; broadcast('accounts'); }, 300); },
});
let codexSig = '';
// Codex chats as session rows; refreshes in the background and tells the page when the list changed.
function codexSessions(maxAgeMs = 20000) {
  if (!config().codex.enabled) return [];
  codex.list({ maxAgeMs, lastOpened: sessions.lastOpened }).then(list => {
    const sig = list.map(x => `${x.id}:${x.updated}:${x.title}`).join('|');
    if (sig !== codexSig) { const first = !codexSig; codexSig = sig; forgetMerged(); if (!first || list.length) broadcast('sessions'); }
  }).catch(() => {});
  return codex.cached(sessions.lastOpened);
}
const normCwd = p => { const x = String(p || '').replace(/[\\/]+$/, ''); return process.platform === 'win32' ? x.toLowerCase() : x; };
// Claude Code's folders plus Codex chats, merged by folder, plus folders created or added here
// that don't have any chats yet.
// Reused for a second: banner, picture and media requests each look a project up in it.
let mergedMemo = null;
const forgetMerged = () => { mergedMemo = null; };
function sessionsWithCodex() {
  if (mergedMemo && Date.now() - mergedMemo.at < 1000) return mergedMemo.value;
  const value = mergeSessions();
  mergedMemo = { at: Date.now(), value };
  return value;
}
function mergeSessions() {
  const base = sessions.scan();
  const cx = codexSessions();
  const extra = projectInfo.added();
  if (!cx.length && !extra.length) return base;
  const projects = base.projects.map(p => ({ ...p, sessions: p.sessions.slice() }));
  const byCwd = new Map(projects.map(p => [normCwd(p.cwd), p]));
  for (const t of cx) {
    if (!t.cwd) continue;
    let p = byCwd.get(normCwd(t.cwd));
    if (!p) {
      p = { cwd: t.cwd, name: path.basename(String(t.cwd).replace(/[\\/]+$/, '')) || t.cwd, exists: fs.existsSync(t.cwd), notes: 0, sessions: [], updated: 0 };
      byCwd.set(normCwd(t.cwd), p); projects.push(p);
    }
    p.sessions.push({ ...t, folderExists: p.exists });
  }
  for (const x of extra) {
    const p = byCwd.get(normCwd(x.cwd));
    if (p) { p.added = true; continue; }
    const np = { cwd: x.cwd, name: path.basename(x.cwd.replace(/[\\/]+$/, '')) || x.cwd, exists: x.exists, notes: 0, sessions: [], updated: x.created || 0, added: true };
    byCwd.set(normCwd(x.cwd), np); projects.push(np);
  }
  for (const p of projects) { p.sessions.sort((a, b) => b.updated - a.updated); p.updated = p.sessions.length ? p.sessions[0].updated : (p.updated || 0); }
  projects.sort((a, b) => b.updated - a.updated);
  return { ...base, projects };
}
// A folder in the list (Claude Code, Codex, or created here), by its path.
function projectAt(cwd) {
  if (!cwd) return null;
  const list = sessionsWithCodex().projects;
  return list.find(x => x.cwd === cwd) || list.find(x => normCwd(x.cwd) === normCwd(cwd)) || null;
}
// A Codex chat by id, with its folder, or null for anything else.
function codexFind(id) {
  const t = id && codex.known(String(id));
  if (!t) return null;
  const s = codex.cached(sessions.lastOpened).find(x => x.id === t.id);
  return { thread: t, session: s, cwd: t.cwd, exists: !!t.cwd && fs.existsSync(t.cwd), folder: path.basename(String(t.cwd || '').replace(/[\\/]+$/, '')) };
}
const isCodexId = id => !!codexFind(id);
function requireCodexSignedIn() {
  const st = codex.publicState();
  if (!st.enabled) throw fail(409, 'Codex is turned off in Setup.');
  if (st.installed === false) throw fail(409, 'Codex isn’t installed on this PC yet. Open Setup to install it.', 'codex-missing');
  if (!st.signedIn) throw fail(409, 'Sign in to Codex first: on the hub, under Accounts and usage, click “Sign in with ChatGPT” on the Codex card.', 'codex-signin');
}
let usageBroadcastTimer = null;
function scheduleUsageBroadcast() {
  if (usageBroadcastTimer) return;
  usageBroadcastTimer = setTimeout(() => { usageBroadcastTimer = null; broadcast('usage', usage.snapshot()); }, 250);
}
const usageTimers = new Map();
function scheduleUsage(accountId, delayMs = 0) {
  clearTimeout(usageTimers.get(accountId));
  usageTimers.set(accountId, setTimeout(() => {
    usageTimers.delete(accountId);
    const a = config().accounts.find(x => x.id === accountId);
    if (a && acc.signInInfo(a).signedIn) usage.refresh(cfg, a, { maxAgeMs: 20000 });
  }, delayMs));
}
function refreshAllUsage(maxAgeMs) {
  for (const a of config().accounts) if (acc.signInInfo(a).signedIn) usage.refresh(cfg, a, { maxAgeMs });
}

let running = {};
async function pollRunning() {
  if (!clients.size) return;
  try {
    const now = await sys.runningSessions();
    if (JSON.stringify(now) !== JSON.stringify(running)) { running = now; broadcast('running', running); scheduleActivity(); }
  } catch { /* try again next tick */ }
}

// Everything that's running right now: chats in the app's window, chats in terminals, and chats
// another program (like the desktop app) wrote to in the last two minutes.
// What a transcript's last part says, cached until the file changes (it's asked for often).
const tailCache = new Map();
function tailOf(file) {
  const st = fs.statSync(file);
  const k = `${st.size}:${st.mtimeMs}`, hit = tailCache.get(file);
  if (hit && hit.k === k) return hit.t;
  const t = chatLib.tailActivity(file, st);
  tailCache.set(file, { k, t });
  if (tailCache.size > 300) tailCache.delete(tailCache.keys().next().value);
  return t;
}
function activityList() {
  const now = Date.now();
  const { projects } = sessions.scan();
  const byId = new Map();
  for (const p of projects) for (const s of p.sessions) byId.set(s.id.toLowerCase(), { s, p });
  const out = chats.summaries().map(s => {
    const f = s.sessionId && s.provider !== 'codex' ? byId.get(s.sessionId.toLowerCase()) : null;
    if (f) { s.title = f.s.title; s.folder = f.p.name; }
    return s;
  });
  // A Codex helper is named after the Claude chat it works with.
  for (const s of out) if (s.parentKey) { const p = out.find(x => x.key === s.parentKey); s.title = `Codex · ${p ? p.title || 'New chat' : s.title || 'helper'}`; }
  const seen = new Set(out.filter(x => x.sessionId).map(x => x.sessionId.toLowerCase()));
  // Chats this app ran and has since stopped aren't "elsewhere"; they were here.
  const ranHere = new Set([...chats.chats.values()].filter(c => c.sessionId).map(c => c.sessionId.toLowerCase()));
  for (const p of projects) {
    for (const s of p.sessions) {
      const id = s.id.toLowerCase();
      if (seen.has(id)) continue;
      const pids = running[id] || null;
      const age = now - s.updated;
      // Chats elsewhere (like the desktop app) stay listed for a while after Claude replies, so a reply
      // waiting for you doesn't vanish; anything older is just history.
      if (!pids && (age > 10 * 60 * 1000 || ranHere.has(id))) continue;
      let t = { phase: 'idle', tool: null, detail: null, lastText: '', lastPrompt: s.lastPrompt || '', steps: 0 };
      try { t = tailOf(sessions.fileFor(s.id)); } catch { /* unreadable */ }
      if (!pids && age > 2 * 60 * 1000 && !(t.phase === 'idle' && t.lastText)) continue;
      let phase = t.phase;
      // A tool step with no result for a while, in a terminal, is usually a permission prompt waiting there.
      if (age > 25000 && (phase === 'thinking' || phase === 'tool')) phase = pids && phase === 'tool' ? 'waiting-terminal' : 'idle';
      out.push({
        source: pids ? 'terminal' : 'elsewhere', key: null, sessionId: s.id, title: s.title, folder: p.name, cwd: p.cwd,
        accountId: s.lastOpened ? s.lastOpened.account : null, accountName: s.lastOpened ? s.lastOpened.accountName : null,
        state: phase === 'idle' ? 'ready' : 'busy', phase, tool: t.tool, detail: t.detail, lastText: t.lastText, lastPrompt: t.lastPrompt, steps: t.steps,
        turnStartedAt: null, lastEventAt: s.updated, finishedAt: phase === 'idle' ? s.updated : null, ok: true, pending: [], pids, spark: [],
      });
    }
  }
  const working = ['thinking', 'writing', 'tool', 'starting'];
  const rank = x => (x.phase === 'waiting' || x.phase === 'waiting-terminal' ? 0 : working.includes(x.phase) ? 1 : x.source === 'app' && x.phase !== 'ended' ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b) || (b.lastEventAt || 0) - (a.lastEventAt || 0));
  return out;
}
// The folder a chat's relative file links are resolved against.
function fileBase(q) {
  if (q.key) { try { return chats.get(q.key).cwd; } catch { /* not running any more */ } }
  if (q.session) { try { return sessions.find(q.session).project.cwd; } catch { const cx = codexFind(q.session); if (cx) return cx.cwd; } }
  if (q.cwd) { const p = projectAt(q.cwd); if (p) return p.cwd; }
  return null;
}
let activityTimer = null;
function scheduleActivity() {
  if (activityTimer) return;
  activityTimer = setTimeout(() => {
    activityTimer = null;
    if (!clients.size) return;
    try { broadcast('activity', { list: activityList(), at: Date.now() }); } catch (err) { log(`Activity: ${err.message}`); }
  }, 350);
}

const statusSnapshot = () => JSON.stringify(config().accounts.map(a => acc.publicAccount(cfg, a)).map(x => [x.id, x.signedIn, x.email, x.orgId, x.plan, x.lock.ok, x.authMethod]));
async function pollAccounts(maxAgeMs = 60000) {
  const before = statusSnapshot();
  await Promise.all(config().accounts.map(a => acc.verify(cfg, a, { maxAgeMs }).catch(() => null)));
  if (statusSnapshot() !== before) broadcast('accounts');
}

// After a sign-in window opens, keep checking until the new sign-in shows up.
function watchSignIn(a) {
  for (const s of [10, 20, 30, 45, 60, 90, 120, 180, 240]) {
    setTimeout(async () => {
      const before = statusSnapshot();
      await acc.verify(cfg, a, { maxAgeMs: 0 }).catch(() => null);
      if (statusSnapshot() !== before) broadcast('accounts');
    }, s * 1000);
  }
}

let sessionsSig = '';
function sessionsSignature() {
  const { projects } = sessions.scan({ fresh: true });
  return projects.map(p => p.sessions.map(s => `${s.id}:${s.updated}`).join(',')).join('|');
}
function sessionsChanged() {
  const sig = sessionsSignature();
  if (sig !== sessionsSig) { sessionsSig = sig; forgetMerged(); broadcast('sessions'); sessions.refreshIndex(); scheduleActivity(); }
}

function startWatching() {
  let timer = null;
  try {
    fs.mkdirSync(sessions.root, { recursive: true });
    const w = fs.watch(sessions.root, { recursive: true }, (_ev, f) => {
      if (f && !String(f).endsWith('.jsonl')) return;
      clearTimeout(timer);
      timer = setTimeout(sessionsChanged, 600);
    });
    w.on('error', err => log(`File watching stopped (${err.message}); falling back to checking every few seconds.`));
  } catch (err) {
    log(`File watching unavailable (${err.message}); checking every few seconds instead.`);
  }
  setInterval(() => { if (clients.size) sessionsChanged(); }, 8000);       // safety net if watching misses something
  setInterval(pollRunning, 10000);
  setInterval(() => { if (clients.size) pollAccounts(); }, 90000);
  setInterval(() => { if (clients.size) { refreshAllUsage(4 * 60 * 1000); if (config().codex.enabled && codex.publicState().signedIn) codex.refreshUsage().catch(() => {}); } }, 5 * 60 * 1000);
  setInterval(() => { if (clients.size && config().codex.enabled) codexSessions(15000); }, 20000);
  setInterval(() => { if (clients.size && chats.summaries().some(s => s.state !== 'ended')) scheduleActivity(); }, 5000); // keeps elapsed times honest
}

// ---------- helpers ----------

const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, max = 65536) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', c => { data += c; if (data.length > max) { reject(fail(413, max > 65536 ? 'That’s too much to send at once. Try fewer or smaller images.' : 'Request too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(fail(400, 'Bad request.')); } });
    req.on('error', reject);
  });
}

const mainAccount = () => config().accounts.find(a => a.isDefault);

// Confirms with Claude Code who the account is signed in as, then applies its lock.
async function guarded(a) {
  await acc.verify(cfg, a, { maxAgeMs: 15000 }).catch(() => null);
  const info = acc.publicAccount(cfg, a);
  if (!info.lock.ok) throw fail(409, info.lockMessage, info.lock.reason);
  return info;
}

function prepareSummary(p) {
  const bits = [];
  if (p.links && p.links.done && p.links.done.length) bits.push(`linked ${p.links.done.join(', ')}`);
  if (p.settings && p.settings.length) bits.push(`updated ${p.settings.join(', ')}`);
  if (p.state && p.state.mcpServers && p.state.mcpServers.length) bits.push(`added MCP servers ${p.state.mcpServers.join(', ')}`);
  if (p.state && p.state.folders) bits.push(`carried over trust for ${p.state.folders} folder${p.state.folders === 1 ? '' : 's'}`);
  return bits.length ? `Before opening: ${bits.join('; ')}.` : '';
}

function stateFor() {
  const c = config();
  for (const a of c.accounts) if (acc.statusAge(a) > 60000) acc.verify(c, a).then(() => broadcast('accounts')).catch(() => {});
  return {
    accounts: c.accounts.map(a => acc.publicAccount(c, a)),
    prefs: c.prefs, claudeCommand: c.claudeCommand,
    dryRun: sys.DRY_RUN, appVersion: APP_VERSION, platform: process.platform,
    index: sessions.progress,
    codex: codex.publicState(),
  };
}

// ---------- routes ----------

// Things only the PC itself may do: quit the app, manage phone access, open windows on the PC that
// a phone couldn't see.
const LOCAL_ONLY = new Set(['/api/quit', '/api/shortcut', '/api/share-copy', '/api/project/pick', '/api/codex/install', '/api/update-claude']);

async function handleApi(req, res, url, remote = false) {
  const c = config();
  const route = `${req.method} ${url.pathname}`;
  if (remote && (LOCAL_ONLY.has(url.pathname) || url.pathname.startsWith('/api/phone'))) throw fail(403, 'That can only be done on the PC itself.');
  if (route === 'GET /api/phone') return send(res, 200, phone.status());

  if (route === 'GET /api/state') return send(res, 200, stateFor());
  if (route === 'GET /api/sessions') return send(res, 200, { ...sessionsWithCodex(), running, live: chats.live() });
  if (route === 'GET /api/chat/history') {
    // A Codex helper's thread may be too new for the Codex chat list, so the page can say it's Codex.
    if (isCodexId(url.searchParams.get('id')) || (url.searchParams.get('provider') === 'codex' && chatPrefs.parentOf(url.searchParams.get('id')))) return send(res, 200, await codex.history(url.searchParams.get('id'), url.searchParams.get('cursor'), url.searchParams.get('until') || null));
    const file = sessions.fileFor(url.searchParams.get('id'));
    return send(res, 200, await chatLib.readHistory(file, { until: url.searchParams.get('until') || null, cursor: url.searchParams.get('cursor'), limit: 60 }));
  }
  if (route === 'GET /api/chat/live') return send(res, 200, { live: chats.live() });
  if (route === 'GET /api/activity') return send(res, 200, { list: activityList(), at: Date.now() });
  if (route === 'GET /api/usage') return send(res, 200, { usage: usage.snapshot() });
  if (route === 'GET /api/file') {
    const q = Object.fromEntries(url.searchParams);
    return send(res, 200, filesLib.readEntry(fileBase(q), q.path));
  }
  if (route === 'GET /api/project/info') {
    const p = projectAt(url.searchParams.get('cwd'));
    if (!p) throw fail(404, 'That folder isn’t in the list.');
    if (!p.exists) return send(res, 200, { cwd: p.cwd, banner: null, docs: [], images: [], today: { docs: 0, images: 0 }, missing: true });
    return send(res, 200, projectInfo.info(p.cwd, { maxAgeMs: url.searchParams.get('fresh') ? 0 : 30000 }));
  }
  if (route === 'GET /api/prompts') return send(res, 200, { prompts: projectInfo.prompts(), sets: projectInfo.sets() });
  if (route === 'GET /api/project/places') return send(res, 200, projectInfo.places(sessionsWithCodex().projects.filter(p => p.exists).map(p => p.cwd)));
  if (route === 'GET /api/image') {
    // Images a chat shows by path (pictures Codex made or looked at). Same rules as the file viewer.
    const q = Object.fromEntries(url.searchParams);
    const f = filesLib.locate(fileBase(q), q.path);
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[path.extname(f.path).toLowerCase()];
    if (!f.isFile || !type) throw fail(400, 'That isn’t an image.');
    const st = fs.statSync(f.path);
    if (st.size > 25 * 1024 * 1024) throw fail(413, 'That image is too large to show.');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return res.end(fs.readFileSync(f.path));
  }
  if (route === 'GET /api/session' && isCodexId(url.searchParams.get('id'))) {
    const cx = codexFind(url.searchParams.get('id'));
    const messages = await codex.preview(cx.thread.id).catch(() => []);
    const s = { ...cx.session, folder: cx.folder, folderExists: cx.exists };
    return send(res, 200, { session: s, stats: { prompts: messages.filter(m => m.role === 'you').length, replies: messages.filter(m => m.role !== 'you').length, tools: 0, first: s.created ? new Date(s.created).toISOString() : null, models: s.model ? [s.model] : [], version: cx.thread.cliVersion ? `Codex ${cx.thread.cliVersion}` : null }, messages, running: false });
  }
  if (route === 'GET /api/session') {
    const p = await sessions.preview(url.searchParams.get('id'));
    return send(res, 200, { ...p, running: !!running[p.session.id.toLowerCase()] });
  }
  if (route === 'GET /api/search') return send(res, 200, sessions.search(url.searchParams.get('q')));
  if (route === 'GET /api/health') {
    const checks = await health.runChecks(c, sessions);
    if (c.codex.enabled) {
      const st = await codex.refreshAccount().then(() => codex.publicState()).catch(() => codex.publicState());
      if (st.installed === false) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: 'Codex isn’t installed. Install it to use your ChatGPT plan’s Codex here too, or turn Codex off below.', fix: { action: 'install-codex', label: 'Install Codex' } });
      else if (st.error && !st.signedIn) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: st.error, fix: { action: 'codex-signin', label: 'Sign in with ChatGPT' } });
      else if (!st.signedIn) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: 'Installed, but not signed in.', fix: { action: 'codex-signin', label: 'Sign in with ChatGPT' } });
      else checks.push({ id: 'codex', label: 'Codex', state: 'ok', detail: `Signed in${st.email ? ` as ${st.email}` : ''}${st.plan ? ` (${st.plan})` : ''}.` });
    }
    return send(res, 200, { checks, prefs: c.prefs, claudeCommand: c.claudeCommand, codex: c.codex, appVersion: APP_VERSION });
  }

  if (route === 'POST /api/chat/upload') return uploadFile(req, res, url);
  if (req.method !== 'POST') throw fail(404, 'Not found.');
  const body = await readBody(req, url.pathname === '/api/chat/send' ? 40 * 1024 * 1024 : 65536);

  if (url.pathname.startsWith('/api/chat/') && url.pathname !== '/api/chat/rename') return handleChat(req, res, url, body, c);

  switch (url.pathname) {
    case '/api/web': {
      if (body.account === 'codex') {
        const r = await sys.openWebProfile('https://chatgpt.com/', 'codex');
        if (!r.ok && !r.dryRun) throw fail(500, r.error || 'Couldn’t open a browser window.');
        return send(res, 200, r);
      }
      const a = acc.findAccount(c, body.account);
      const r = await sys.openWebProfile('https://claude.ai/new', a.id);
      if (!r.ok && !r.dryRun) throw fail(500, r.error || 'Couldn’t open a browser window.');
      return send(res, 200, r);
    }
    case '/api/usage/refresh': {
      if (body.account === 'codex') { await codex.refreshUsage(); return send(res, 200, { usage: usage.snapshot() }); }
      if (!body.account) codex.refreshUsage().catch(() => {});
      const list = body.account ? [acc.findAccount(c, body.account)] : c.accounts.filter(a => acc.signInInfo(a).signedIn);
      await Promise.all(list.map(a => usage.refresh(c, a, { maxAgeMs: 0 })));
      return send(res, 200, { usage: usage.snapshot() });
    }
    case '/api/accounts': {
      const name = String(body.name || '').trim();
      if (!/^[\w .'-]{1,40}$/.test(name)) throw fail(400, 'Use 1–40 letters, numbers, spaces, dots or dashes.');
      if (c.accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) throw fail(400, 'An account with that name already exists.');
      const { account, links } = acc.createAccount(c, name);
      save();
      if (links.errors.length) log(`Linking for ${name}: ${links.errors.join('; ')}`);
      broadcast('accounts');
      return send(res, 200, { account: acc.publicAccount(c, account) });
    }
    case '/api/accounts/rename': {
      const a = acc.findAccount(c, body.account);
      const name = String(body.name || '').trim();
      if (!/^[\w .'-]{1,40}$/.test(name)) throw fail(400, 'Use 1–40 letters, numbers, spaces, dots or dashes.');
      if (c.accounts.some(x => x !== a && x.name.toLowerCase() === name.toLowerCase())) throw fail(400, 'Another account already has that name.');
      a.name = name; save(); broadcast('accounts');
      return send(res, 200, { account: acc.publicAccount(c, a) });
    }
    case '/api/accounts/remove': {
      const a = acc.findAccount(c, body.account);
      if (a.isDefault) throw fail(400, 'The main account can’t be removed.');
      c.accounts = c.accounts.filter(x => x.id !== a.id);
      save(); acc.forgetStatus(a.id); usage.forget(a.id); broadcast('accounts');
      return send(res, 200, { ok: true, keptFolder: a.configDir });
    }
    case '/api/accounts/verify': {
      const a = acc.findAccount(c, body.account);
      await acc.verify(c, a, { maxAgeMs: 0 });
      broadcast('accounts');
      return send(res, 200, { account: acc.publicAccount(c, a) });
    }
    case '/api/accounts/lock': {
      const a = acc.findAccount(c, body.account);
      if (!body.lock) { delete a.pinnedOrg; delete a.expectEmail; save(); broadcast('accounts'); return send(res, 200, { account: acc.publicAccount(c, a) }); }
      await acc.verify(c, a, { maxAgeMs: 0 }).catch(() => null);
      const info = acc.signInInfo(a);
      if (!info.signedIn) throw fail(400, 'Sign in first, choosing the account and organization you want to lock to.');
      if (info.authMethod && info.authMethod !== 'claude.ai') throw fail(400, `This account is using ${info.authMethod.replace(/_/g, ' ')}, not a subscription sign-in. Sign in first.`);
      if (a.expectEmail && info.email && !acc.sameEmail(a.expectEmail, info.email)) throw fail(400, `This account is signed in as ${info.email}, not ${a.expectEmail}. Sign in as ${a.expectEmail} first.`);
      if (!info.orgId && !info.kind) throw fail(400, 'Can’t tell which organization this account is signed into yet. Try again in a moment.');
      a.pinnedOrg = { id: info.orgId, name: info.orgName || (info.kind === 'personal' ? 'Personal' : 'Team'), plan: info.plan, kind: info.kind, email: info.email };
      if (info.email) a.expectEmail = info.email;
      save(); broadcast('accounts');
      return send(res, 200, { account: acc.publicAccount(c, a) });
    }
    case '/api/signin': {
      const a = acc.findAccount(c, body.account);
      const email = String(body.email || '').trim();
      if (email && !EMAIL_RE.test(email)) throw fail(400, 'That doesn’t look like an email address.');
      if (email && !acc.sameEmail(email, a.expectEmail)) {
        if (a.pinnedOrg && a.pinnedOrg.email && !acc.sameEmail(a.pinnedOrg.email, email)) delete a.pinnedOrg;
        a.expectEmail = email;
        save(); broadcast('accounts');
      }
      if (!a.isDefault) acc.ensureLinks(c, a);
      const target = email || a.expectEmail;
      const r = await sys.openTerminal(c, a, os.homedir(), target ? `auth login --email ${target}` : 'auth login', 'Sign in');
      if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
      acc.forgetStatus(a.id); usage.forget(a.id);
      watchSignIn(a);
      for (const s of [30, 90, 180]) scheduleUsage(a.id, s * 1000);
      return send(res, 200, r);
    }
    case '/api/signout': {
      const a = acc.findAccount(c, body.account);
      const r = await sys.runClaude(c, a, 'auth logout', { timeoutMs: 30000 });
      acc.forgetStatus(a.id); usage.forget(a.id); scheduleUsageBroadcast();
      await acc.verify(c, a, { maxAgeMs: 0 }).catch(() => null);
      broadcast('accounts');
      if (r.code !== 0 && !sys.DRY_RUN) throw fail(500, `Claude Code couldn’t sign out: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      return send(res, 200, { account: acc.publicAccount(c, a) });
    }
    case '/api/codex/login': {
      const st = codex.publicState();
      if (st.installed === false) throw fail(409, 'Codex isn’t installed on this PC yet. Open Setup to install it.', 'codex-missing');
      const r = await codex.login(body.method === 'code' ? 'code' : 'browser');
      return send(res, 200, r);
    }
    case '/api/codex/login-cancel': { await codex.cancelLogin(); return send(res, 200, { ok: true }); }
    case '/api/project/banner': {
      const p = projectAt(body.cwd);
      if (!p || !p.exists) throw fail(404, 'That folder isn’t available.');
      const w = projectInfo.info(p.cwd, { maxAgeMs: 0 });
      if (body.path && !w.images.some(i => i.path === body.path)) throw fail(400, 'That picture isn’t in this project’s folder.');
      return send(res, 200, projectInfo.setBanner(p.cwd, body.path || null));
    }
    case '/api/prompts': {
      if (body.reset) return send(res, 200, { prompts: projectInfo.resetPrompts() });
      if (body.addSet) return send(res, 200, { prompts: projectInfo.addSet(body.addSet) });
      return send(res, 200, { prompts: projectInfo.savePrompts(body.prompts) });
    }
    case '/api/project/create': {
      const made = projectInfo.create({ parent: body.parent, name: body.name, existing: body.existing || null, useExisting: !!body.useExisting });
      log(`${made.created ? 'Created' : 'Added'} project ${made.cwd}`);
      forgetMerged();
      broadcast('sessions');
      return send(res, 200, { ...made, project: projectAt(made.cwd) });
    }
    case '/api/project/forget': {
      const p = projectAt(body.cwd);
      if (!p) throw fail(404, 'That folder isn’t in the list.');
      if (p.sessions.length) throw fail(400, 'This project has chats, so it stays in the list. Its folder isn’t touched either way.');
      projectInfo.forget(p.cwd);
      forgetMerged();
      broadcast('sessions');
      return send(res, 200, { ok: true });
    }
    case '/api/project/pick': {
      const r = await sys.pickFolder(body.start || os.homedir(), body.title || 'Choose a folder');
      if (r.dryRun) return send(res, 200, { unsupported: true });
      if (r.ok === false) throw fail(500, `The folder window couldn’t open: ${r.error}`);
      return send(res, 200, r);
    }
    case '/api/share-copy': {
      const r = shareLib.makeShareCopy({ appDir: APP_DIR, version: APP_VERSION, prompts: body.includePrompts ? projectInfo.prompts() : null });
      log(`Made a copy to share: ${r.path}`);
      if (body.reveal !== false) await sys.revealInExplorer(r.path, true).catch(() => {});
      return send(res, 200, r);
    }
    case '/api/codex/logout': { await codex.logout(); return send(res, 200, { codex: codex.publicState() }); }
    case '/api/codex/check': {
      await codex.refreshAccount();
      await codex.refreshUsage().catch(() => {});
      codexSessions(0);
      return send(res, 200, { codex: codex.publicState(), usage: usage.snapshot() });
    }
    case '/api/codex/settings': {
      if (typeof body.enabled === 'boolean') c.codex.enabled = body.enabled;
      if (body.command !== undefined) {
        const cmd = String(body.command).trim();
        if (!cmd || /["\r\n%&|<>^]/.test(cmd)) throw fail(400, 'Enter the full path to codex.cmd (or just “codex”).');
        c.codex.command = cmd;
      }
      save();
      codex.stop();
      setTimeout(() => { if (config().codex.enabled) codex.refreshAccount().then(() => codex.refreshUsage()).catch(() => {}); broadcast('accounts'); broadcast('sessions'); }, 200);
      return send(res, 200, { codex: c.codex });
    }
    case '/api/codex/install': {
      const r = await sys.runInTerminal(c, os.homedir(), 'Install Codex', sys.IS_WIN
        ? '@echo off\r\ntitle Install Codex\r\necho Installing Codex (OpenAI)...\r\ncall npm install -g @openai/codex\r\necho.\r\necho Done. Close this window and click Check again in Session Switcher.\r\n'
        : '#!/bin/sh\nnpm install -g @openai/codex\n');
      return send(res, 200, r);
    }
    case '/api/open': {
      if (body.provider === 'codex' || isCodexId(body.sessionId)) {
        requireCodexSignedIn();
        const mode = body.mode === 'fork' ? 'fork' : 'resume';
        const cx = codexFind(body.sessionId);
        if (!cx) throw fail(404, 'That Codex chat isn’t in the list any more.');
        if (!cx.exists) throw fail(400, `The folder ${cx.cwd} no longer exists, so this chat can’t be opened there.`);
        if (chats.bySession(cx.thread.id) && mode === 'resume') throw fail(409, 'This chat is open in Session Switcher’s chat window. Stop it there first.', 'live');
        const r = await sys.openCodexTerminal(c, cx.cwd, `${mode} ${cx.thread.id}`, (cx.session && cx.session.title || '').slice(0, 32));
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        sessions.recordLaunch(cx.thread.id, codexLib.ACCOUNT, mode);
        return send(res, 200, r);
      }
      const a = acc.findAccount(c, body.account);
      const mode = ['resume', 'fork', 'desktop'].includes(body.mode) ? body.mode : 'resume';
      const { project, session } = sessions.find(body.sessionId);
      if (!project.exists) throw fail(400, `The folder ${project.cwd} no longer exists, so this chat can’t be opened there.`);
      if (mode === 'desktop') {
        const v = await sys.claudeVersion(c).catch(() => ({}));
        if (!v.found) throw fail(400, 'Claude Code isn’t available. Check Setup.');
        if (!sys.versionAtLeast(v.version, DESKTOP_MIN)) throw fail(400, `Opening a chat in the desktop app needs Claude Code ${DESKTOP_MIN} or later; you have ${v.version}. Use “Update Claude Code” in Setup.`);
        const r = await sys.runHidden(c, mainAccount(), project.cwd, `--desktop --resume ${session.id}`);
        if (!r.ok && !r.dryRun) throw fail(500, `The desktop app didn’t open the chat: ${r.error}`);
        sessions.recordLaunch(session.id, mainAccount(), 'desktop');
        broadcast('sessions');
        return send(res, 200, r);
      }
      await guarded(a);
      const liveHere = chats.bySession(session.id);
      if (liveHere && mode === 'resume') throw fail(409, `This chat is open in Session Switcher’s chat window (as ${liveHere.account.name}). Stop it there first, or use “Move to a terminal” in the chat’s menu.`, 'live');
      if (!body.force && mode === 'resume') {
        const now = await sys.runningSessions().catch(() => ({}));
        running = now;
        const pids = now[session.id.toLowerCase()];
        if (pids) throw fail(409, `This chat is already open in a terminal (process ${pids.join(', ')}). Opening it twice can mix up its history.`, 'running');
      }
      const prepared = acc.prepareForLaunch(c, a);
      const args = mode === 'fork' ? `--resume ${session.id} --fork-session` : `--resume ${session.id}`;
      const r = await sys.openTerminal(c, a, project.cwd, args, session.title.slice(0, 32));
      if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
      sessions.recordLaunch(session.id, a, mode);
      broadcast('sessions');
      log(`Opened ${session.id} (${mode}) as ${a.name} via ${r.how}`);
      return send(res, 200, { ...r, note: prepareSummary(prepared) });
    }
    case '/api/new': {
      if (body.provider === 'codex') {
        requireCodexSignedIn();
        const p = projectAt(body.cwd);
        if (!p) throw fail(404, 'That folder isn’t in the list.');
        if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
        const r = await sys.openCodexTerminal(c, p.cwd, '', 'New chat');
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        return send(res, 200, r);
      }
      const a = acc.findAccount(c, body.account);
      const p = projectAt(body.cwd);
      if (!p) throw fail(404, 'That folder isn’t in the list.');
      if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
      await guarded(a);
      const prepared = acc.prepareForLaunch(c, a);
      const r = await sys.openTerminal(c, a, p.cwd, '', 'New chat');
      if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
      return send(res, 200, { ...r, note: prepareSummary(prepared) });
    }
    case '/api/command': {
      if (body.provider === 'codex' || isCodexId(body.sessionId)) {
        const cx = codexFind(body.sessionId);
        if (!cx) throw fail(404, 'That Codex chat isn’t in the list any more.');
        return send(res, 200, { command: sys.codexManualCommand(c, cx.cwd, `${body.mode === 'fork' ? 'fork' : 'resume'} ${cx.thread.id}`) });
      }
      const a = acc.findAccount(c, body.account);
      let cwd, args = '';
      if (body.sessionId) {
        const { project, session } = sessions.find(body.sessionId);
        cwd = project.cwd;
        args = body.mode === 'fork' ? `--resume ${session.id} --fork-session` : `--resume ${session.id}`;
      } else {
        const p = projectAt(body.cwd);
        if (!p) throw fail(404, 'That folder isn’t in the list.');
        cwd = p.cwd;
      }
      return send(res, 200, { command: sys.manualCommand(c, a, cwd, args) });
    }
    case '/api/reveal': {
      if (body.path) { const f = filesLib.locate(fileBase(body), body.path); return send(res, 200, await sys.revealInExplorer(f.path, f.isFile)); }
      if (body.sessionId) return send(res, 200, await sys.revealInExplorer(sessions.fileFor(body.sessionId), true));
      const p = projectAt(body.cwd);
      if (!p || !p.exists) throw fail(404, 'That folder isn’t available.');
      return send(res, 200, await sys.revealInExplorer(p.cwd, false));
    }
    case '/api/chat/rename': {
      if (isCodexId(body.sessionId)) {
        await codex.rename(body.sessionId, body.name);
        codexSessions(0);
        return send(res, 200, { title: body.name });
      }
      const title = sessions.rename(body.sessionId, body.name);
      broadcast('sessions');
      return send(res, 200, { title });
    }
    case '/api/prefs': {
      const p = c.prefs;
      if (body.terminal !== undefined) { if (!acc.TERMINALS.includes(body.terminal)) throw fail(400, 'Unknown terminal choice.'); p.terminal = body.terminal; }
      for (const k of ['syncSettings', 'syncState', 'cleanEnv', 'appWindow']) if (typeof body[k] === 'boolean') p[k] = body[k];
      if (body.openIn !== undefined) { if (!['app', 'terminal'].includes(body.openIn)) throw fail(400, 'Unknown choice.'); p.openIn = body.openIn; }
      if (body.claudeCommand !== undefined) {
        const cmd = String(body.claudeCommand).trim();
        if (!cmd || /["\r\n%&|<>^]/.test(cmd)) throw fail(400, 'Enter the full path to claude.exe (or just “claude”).');
        c.claudeCommand = cmd;
        sys.forget(`version:${cmd}`);
      }
      save();
      return send(res, 200, { prefs: c.prefs, claudeCommand: c.claudeCommand });
    }
    case '/api/fix-sharing': {
      const a = acc.findAccount(c, body.account);
      const result = acc.fixSharing(c, a);
      log(`Fix sharing for ${a.name}: ${JSON.stringify(result)}`);
      broadcast('accounts'); sessionsChanged();
      return send(res, 200, result);
    }
    case '/api/update-claude': {
      const r = await sys.openTerminal(c, mainAccount(), os.homedir(), 'update', 'Update');
      sys.forget(`version:${c.claudeCommand}`);
      if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
      return send(res, 200, r);
    }
    case '/api/shortcut': {
      const r = await sys.createDesktopShortcut(APP_DIR);
      if (!r.ok && !r.dryRun) throw fail(500, r.error);
      return send(res, 200, r);
    }
    case '/api/phone': {
      // Turns phone access on or off, or changes its port.
      const p = c.prefs.phone = { enabled: false, port: remoteLib.DEFAULT_PORT || 4788, ...(c.prefs.phone || {}) };
      if (typeof body.enabled === 'boolean') p.enabled = body.enabled;
      if (body.port !== undefined) {
        const port = Number(body.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === PORT) throw fail(400, `Pick a port from 1024 to 65535, other than ${PORT}.`);
        p.port = port;
      }
      save();
      const st = await phone.sync();
      if (!p.enabled) phone.cancelPairing();
      return send(res, 200, st);
    }
    case '/api/phone/pair': {
      const st = phone.status();
      if (!st.listening) throw fail(409, 'Turn phone access on first.');
      return send(res, 200, { ...phone.startPairing(), status: phone.status() });
    }
    case '/api/phone/pair-cancel': phone.cancelPairing(); return send(res, 200, phone.status());
    case '/api/phone/forget': phone.forget(String(body.id || '')); return send(res, 200, phone.status());
    case '/api/quit': {
      send(res, 200, { ok: true });
      log('Quit from the app.');
      chatPrefs.flush();
      phone.stop();
      chats.stopAll();
      codex.stop();
      setTimeout(() => process.exit(0), 300);
      return;
    }
  }
  throw fail(404, 'Not found.');
}

// ---------- chat window ----------

// "Attach file": anything that isn't an inline image (videos, PDFs, sound, documents) is saved in
// the chat's project folder under attachments/<date>/, so Claude or Codex can open it by path.
const UPLOAD_MAX = 2 * 1024 * 1024 * 1024;
function uploadFile(req, res, url) {
  const chat = chats.get(url.searchParams.get('key'));
  const raw = String(url.searchParams.get('name') || 'file').split(/[\\/]/).pop();
  const name = raw.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(-120) || 'file';
  // Phones often send files without saying their size first (chunked), so the size is checked as it arrives.
  const size = Number(req.headers['content-length'] || 0);
  if (size > UPLOAD_MAX) throw fail(413, 'Files up to 2 GB can be attached.');
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(chat.cwd, 'attachments', day);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let dest = path.join(dir, name);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${stem} (${i})${ext}`);
  const tmp = `${dest}.part`;
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let got = 0;
    const failUpload = (status, msg) => { log(`Attach failed for ${name}: ${msg}`); fs.unlink(tmp, () => {}); reject(fail(status, msg)); };
    req.on('data', c => { got += c.length; if (got > UPLOAD_MAX) { req.destroy(); out.destroy(); failUpload(413, 'Files up to 2 GB can be attached.'); } });
    req.on('aborted', () => { out.destroy(); log(`Attach of ${name} was interrupted after ${Math.round(got / 1024)} KB.`); fs.unlink(tmp, () => {}); });
    out.on('error', err => failUpload(500, `Couldn’t save that file: ${err.message}`));
    out.on('finish', () => {
      if (!got) return failUpload(400, 'That file arrived empty. Try attaching it again.');
      try { fs.renameSync(tmp, dest); } catch (err) { return failUpload(500, `Couldn’t save that file: ${err.message}`); }
      log(`Attached ${path.relative(chat.cwd, dest)} (${Math.round(got / 1024)} KB)`);
      send(res, 200, { path: dest, rel: path.relative(chat.cwd, dest).replace(/\\/g, '/'), name: path.basename(dest), size: got });
      resolve();
    });
    req.pipe(out);
  });
}

// Videos, sound and PDFs, streamed (with byte ranges, so players can seek). Same rules as the viewer.
function sendMedia(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const f = filesLib.locate(fileBase(q), q.path);
  const mime = filesLib.MEDIA_TYPES[path.extname(f.path).toLowerCase()];
  if (!f.isFile || !mime) throw fail(400, 'That file can’t be played here.');
  const size = fs.statSync(f.path).size;
  const head = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(f.path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  return fs.createReadStream(f.path).pipe(res);
}

function validImages(images) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length > 10) throw fail(400, 'Attach at most 10 images at a time.');
  return images.map(img => {
    if (!img || !chatLib.IMAGE_TYPES.has(img.mediaType) || typeof img.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(img.data)) throw fail(400, 'Images must be PNG, JPEG, GIF or WebP.');
    if (img.data.length * 0.75 > chatLib.LIMITS.imageBytes) throw fail(413, 'One of the images is over 5 MB. Try a smaller one.');
    return { mediaType: img.mediaType, data: img.data };
  });
}

async function handleChat(req, res, url, body, c) {
  switch (url.pathname) {
    case '/api/chat/open': {
      if (body.provider === 'codex' || (body.mode !== 'new' && isCodexId(body.sessionId))) {
        requireCodexSignedIn();
        const mode = ['resume', 'fork', 'new'].includes(body.mode) ? body.mode : 'resume';
        let cwd, threadId = null, title = null;
        if (mode !== 'new') {
          const cx = codexFind(body.sessionId);
          if (!cx) throw fail(404, 'That Codex chat isn’t in the list any more.');
          if (!cx.exists) throw fail(400, `The folder ${cx.cwd} no longer exists, so this chat can’t run there.`);
          cwd = cx.cwd; threadId = cx.thread.id; title = cx.session ? cx.session.title : null;
          if (mode === 'resume') { const live = chats.bySession(threadId); if (live) return send(res, 200, attachedInfo(live)); }
          if (mode === 'fork' && title) title = `${title} (copy)`;
        } else {
          const p = projectAt(body.cwd);
          if (!p) throw fail(404, 'That folder isn’t in the list.');
          if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
          cwd = p.cwd;
        }
        const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
        const pref = chatPrefs.get({ sessionId: threadId, cwd, provider: 'codex' });
        const chat = codex.open({ cfg: c, cwd, threadId, fork: mode === 'fork', mode: body.permissionMode || pref.mode, model: body.model || pref.model, effort: pref.effort, title: title || 'New Codex chat', folder });
        if (threadId && mode === 'resume') sessions.recordLaunch(threadId, codexLib.ACCOUNT, 'app');
        log(`Codex chat window: ${mode} ${threadId || '(new)'}`);
        return send(res, 200, { ...chat.info(), attached: false, remembered: !!pref.mode });
      }
      const a = acc.findAccount(c, body.account);
      const mode = ['resume', 'fork', 'new'].includes(body.mode) ? body.mode : 'resume';
      let cwd, sessionId = null;
      if (mode !== 'new') {
        const { project, session } = sessions.find(body.sessionId);
        if (!project.exists) throw fail(400, `The folder ${project.cwd} no longer exists, so this chat can’t run there.`);
        cwd = project.cwd; sessionId = session.id;
        if (mode === 'resume') {
          const live = chats.bySession(session.id);
          if (live) return send(res, 200, attachedInfo(live));
          if (!body.force) {
            const now = await sys.runningSessions().catch(() => ({}));
            running = now;
            const pids = now[session.id.toLowerCase()];
            if (pids) throw fail(409, `This chat is already open in a terminal (process ${pids.join(', ')}). Opening it twice can mix up its history.`, 'running');
          }
        }
      } else {
        const p = projectAt(body.cwd);
        if (!p) throw fail(404, 'That folder isn’t in the list.');
        if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
        cwd = p.cwd;
      }
      await guarded(a);
      acc.prepareForLaunch(c, a);
      // The mode, model and effort you last chose for this chat (or, for a new one, in this project).
      const pref = chatPrefs.get({ sessionId, cwd, provider: 'claude' });
      const permissionMode = chatLib.MODES.includes(body.permissionMode) ? body.permissionMode : chatLib.MODES.includes(pref.mode) ? pref.mode : null;
      let title = null;
      if (sessionId) { try { title = sessions.find(sessionId).session.title; } catch { /* untitled */ } }
      if (mode === 'fork' && title) title = `${title} (copy)`;
      const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
      const chat = chats.open({ cfg: c, account: a, cwd, sessionId, fork: mode === 'fork', permissionMode, model: body.model || pref.model, effort: pref.effort, title: title || 'New chat', folder });
      if (sessionId && mode === 'resume') sessions.recordLaunch(sessionId, a, 'app');
      log(`Chat window: ${mode} ${sessionId || '(new)'} as ${a.name}${permissionMode ? ` (${permissionMode})` : ''}`);
      return send(res, 200, { ...chat.info(), attached: false, remembered: !!pref.mode && !body.permissionMode, companionThread: sessionId && mode === 'resume' ? chatPrefs.companionOf(sessionId) : null });
    }
    case '/api/chat/attach': return send(res, 200, attachedInfo(chats.get(body.key)));
    case '/api/chat/send': {
      const text = typeof body.text === 'string' ? body.text.slice(0, 200000) : '';
      const images = validImages(body.images);
      if (!text.trim() && !images.length) throw fail(400, 'Type a message or attach an image.');
      chats.get(body.key).send(text, images);
      return send(res, 200, { ok: true });
    }
    case '/api/chat/permission': {
      const decision = ['allow', 'always', 'deny'].includes(body.decision) ? body.decision : null;
      if (!decision) throw fail(400, 'Choose allow or deny.');
      let answers;
      if (body.answers !== undefined) {
        if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) throw fail(400, 'Bad answers.');
        answers = {};
        for (const [k, v] of Object.entries(body.answers).slice(0, 10)) answers[String(k).slice(0, 2000)] = String(v).slice(0, 4000);
      }
      chats.get(body.key).answer(String(body.requestId || ''), { decision, message: typeof body.message === 'string' ? body.message.slice(0, 4000) : '', answers });
      return send(res, 200, { ok: true });
    }
    case '/api/chat/interrupt': await chats.get(body.key).interrupt(); return send(res, 200, { ok: true });
    case '/api/chat/mode': {
      const chat = chats.get(body.key);
      await chat.setMode(body.mode);
      remember(chat, { mode: chat.permissionMode });
      return send(res, 200, { ok: true });
    }
    case '/api/chat/model': {
      // Switches the model and/or effort for the next replies, and remembers the choice.
      const chat = chats.get(body.key);
      if (body.model) await chat.setModel(String(body.model));
      if (body.effort) await chat.setEffort(String(body.effort));
      remember(chat, { ...(body.model ? { model: chat.model } : {}), ...(body.effort ? { effort: chat.effort } : {}) });
      return send(res, 200, chat.modelInfo());
    }
    case '/api/chat/companion': {
      // Codex, working inside a Claude chat: one helper per chat, in the same folder, remembered.
      const chat = chats.get(body.key);
      if (chat.provider === 'codex') throw fail(400, 'This is already a Codex chat.');
      if (chat.companionKey) { try { const h = chats.get(chat.companionKey); if (h.state !== 'ended') return send(res, 200, h.info()); } catch { /* start a new one */ } }
      requireCodexSignedIn();
      const threadId = chat.sessionId ? chatPrefs.companionOf(chat.sessionId) : null;
      const known = threadId && codex.known(threadId);
      const pref = chatPrefs.get({ sessionId: threadId, cwd: chat.cwd, provider: 'codex' });
      const helper = codex.open({ cfg: c, cwd: chat.cwd, threadId: known ? threadId : null, mode: pref.mode, model: pref.model, effort: pref.effort, companion: true, title: `Codex · ${chat.title || 'New chat'}`, folder: chat.folder });
      helper.parentKey = chat.key; chat.companionKey = helper.key;
      log(`Codex helper for ${chat.sessionId || chat.key}: ${known ? `resume ${threadId}` : 'new'}`);
      broadcast('live', chats.live()); scheduleActivity();
      return send(res, 200, helper.info());
    }
    case '/api/chat/stop': {
      const chat = chats.get(body.key);
      if (chat.companionKey) { try { chats.get(chat.companionKey).stop(); } catch { /* already gone */ } }
      await chat.stop();
      return send(res, 200, { ok: true });
    }
    case '/api/chat/handoff': {
      // Moves a chat from the window to a terminal: stop it here, then resume it there as the same account.
      // Everything is checked before the chat is stopped, so a failure never leaves you with neither.
      const chat = chats.get(body.key);
      const id = chat.sessionId;
      if (!id) throw fail(400, 'This chat hasn’t started yet, so there’s nothing to move. Send a message first.');
      if (chat.provider === 'codex') {
        await chat.stop();
        const r = await sys.openCodexTerminal(c, chat.cwd, `resume ${id}`, String(chat.title || '').slice(0, 32));
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        sessions.recordLaunch(id, codexLib.ACCOUNT, 'resume');
        return send(res, 200, r);
      }
      const { project, session } = sessions.find(id);
      const a = acc.findAccount(c, chat.account.id);
      await guarded(a);
      await chat.stop();
      acc.prepareForLaunch(c, a);
      const r = await sys.openTerminal(c, a, project.cwd, `--resume ${session.id}`, session.title.slice(0, 32));
      if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
      sessions.recordLaunch(session.id, a, 'resume');
      return send(res, 200, r);
    }
  }
  throw fail(404, 'Not found.');
}

// A running chat's details for the window, with its paired Codex helper's id if it has one.
function attachedInfo(chat) {
  return { ...chat.info(), attached: true, companionThread: chat.provider !== 'codex' && chat.sessionId ? chatPrefs.companionOf(chat.sessionId) : null };
}
// Remembers what you chose for a chat, and as its project's default for new chats.
function remember(chat, changes) {
  chat.choices = { ...(chat.choices || {}), ...changes };
  chatPrefs.set({ sessionId: chat.sessionId, cwd: chat.cwd, provider: chat.provider || 'claude' }, changes);
}

function chatEvents(req, res, url) {
  const chat = chats.get(url.searchParams.get('key'));
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const after = Math.max(Number(url.searchParams.get('after') || 0), Number(req.headers['last-event-id'] || 0) || 0);
  res.write(`event: hello\ndata: ${JSON.stringify(chat.info())}\n\n`);
  for (const ev of chat.buffer) if (ev.seq > after) res.write(`id: ${ev.seq}\nevent: chat\ndata: ${JSON.stringify(ev)}\n\n`);
  chat.clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(ping); chat.clients.delete(res); });
}

// ---------- http ----------

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";

// Serves the app. Phone access (lib/remote.js) checks the phone's pairing first, then calls this
// with remote = true; the PC's own window only ever comes through 127.0.0.1.
async function handleRequest(req, res, { remote = false } = {}) {
  const host = req.headers.host || '';
  if (!remote && host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.writeHead(403); return res.end('Forbidden'); }
  if (req.headers.origin && (remote ? req.headers.origin !== `http://${host}` : !ORIGINS.has(req.headers.origin))) { res.writeHead(403); return res.end('Forbidden'); }
  const url = new URL(req.url, `http://${host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').replace('__TOKEN__', TOKEN).replace('__REMOTE__', remote ? 'true' : 'false');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(html);
    }
    if (req.method === 'GET' && /^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) {
      let data;
      try { data = fs.readFileSync(path.join(APP_DIR, url.pathname.slice(1))); } catch { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=604800', 'X-Content-Type-Options': 'nosniff' });
      return res.end(data);
    }
    const STATIC = { '/chat-ui.js': 'text/javascript', '/app.js': 'text/javascript', '/theme.js': 'text/javascript', '/styles.css': 'text/css' };
    if (req.method === 'GET' && STATIC[url.pathname]) {
      res.writeHead(200, { 'Content-Type': `${STATIC[url.pathname]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(APP_DIR, url.pathname.slice(1)), 'utf8'));
    }
    if (req.method === 'GET' && url.pathname === '/api/chat/events') {
      if (url.searchParams.get('token') !== TOKEN) { res.writeHead(403); return res.end(); }
      return chatEvents(req, res, url);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (url.searchParams.get('token') !== TOKEN) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      pollRunning();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      // Images shown with <img> can't send headers, so that one read-only route also takes the token in the URL.
      const imageGet = req.method === 'GET' && (url.pathname === '/api/image' || url.pathname === '/api/media') && url.searchParams.get('token') === TOKEN;
      if (imageGet && url.pathname === '/api/media') return sendMedia(req, res, url);
      if (req.headers['x-switcher-token'] !== TOKEN && !imageGet) return send(res, 403, { error: 'This page is out of date. Reload it.', reason: 'stale' });
      return await handleApi(req, res, url, remote);
    }
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    if (!err.status || err.status >= 500) log(`Error on ${req.method} ${url.pathname}: ${err.stack || err.message}`);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message, reason: err.reason });
  }
  return undefined;
}
const server = http.createServer((req, res) => { handleRequest(req, res); });

// Phone access: off unless turned on in Setup.
const phone = remoteLib.createRemote({ dataDir: APP_DIR, appDir: APP_DIR, version: APP_VERSION, log, getPrefs: () => config().prefs, handle: handleRequest });

const appUrl = `http://127.0.0.1:${PORT}/`;
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Already running at ${appUrl}. Opening it.`);
    sys.openAppWindow(appUrl, config().prefs).finally(() => setTimeout(() => process.exit(0), 800));
  } else {
    log(`Server error: ${err.stack || err.message}`);
    process.exit(1);
  }
});
process.on('uncaughtException', err => log(`Unexpected error: ${err.stack || err.message}`));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { chats.stopAll(); setTimeout(() => process.exit(0), 300); });
process.on('exit', () => { chats.stopAll(); try { chatPrefs.flush(); } catch { /* best effort */ } });
process.on('unhandledRejection', err => log(`Unexpected error: ${err && (err.stack || err.message)}`));

server.listen(PORT, '127.0.0.1', () => {
  log(`Session Switcher ${APP_VERSION} running at ${appUrl}${sys.DRY_RUN ? ' (preview mode: nothing is launched)' : ''}`);
  console.log('Keep this window open while you use it, or use “Quit” in the app.');
  sys.cleanupLaunchScripts();
  for (const a of config().accounts) {
    if (a.isDefault) continue;
    const r = acc.ensureLinks(cfg, a);
    if (r.done.length) log(`${a.name}: linked ${r.done.join(', ')}`);
    if (r.errors.length) log(`${a.name}: couldn’t link ${r.errors.join('; ')}`);
  }
  sessionsSig = sessionsSignature();
  sessions.refreshIndex();
  pollAccounts(0).then(() => setTimeout(() => refreshAllUsage(0), 1500));
  if (config().codex.enabled) setTimeout(() => codex.refreshAccount().then(st => { codexSessions(0); if (st.signedIn) codex.refreshUsage(); }).catch(() => {}), 2500);
  startWatching();
  phone.sync().catch(err => log(`Phone access: ${err.message}`));
  sys.openAppWindow(appUrl, config().prefs);
});
