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
const openclawLib = require('./lib/openclaw');
const codexHomes = require('./lib/codexhomes');
const projectsLib = require('./lib/projects');
const shareLib = require('./lib/sharecopy');
const prefsLib = require('./lib/chatprefs');
const remoteLib = require('./lib/remote');
const { reviewTarget, fixText, reviewAsk, parseFindings, mergeFindings } = require('./lib/review');
const { createReviewLoop } = require('./lib/reviewloop');
const rulesLib = require('./lib/rules');
const store = require('./lib/store');
const { listFiles } = require('./lib/filelist');
const tasksLib = require('./lib/tasks');
const raceLib = require('./lib/race');
const pairsLib = require('./lib/pairs');
const handover = require('./lib/handover');
const restartLib = require('./lib/restart');
const themeStudioLib = require('./lib/theme-studio');
const pushLib = require('./lib/push');
const extrasLib = require('./lib/extras');
const { branchSession } = require('./lib/branch');
const runnerLib = require('./lib/runner');
const { ownText } = require('./lib/shared');

const APP_VERSION = '6.0.0';
const PORT = Number(process.env.SWITCHER_PORT) || 4777;
const APP_DIR = __dirname;
// Your accounts, history and settings live next to the app, unless SWITCHER_DATA_DIR points
// elsewhere (the tests use a throwaway folder, so they never touch your real data).
const DATA_DIR = process.env.SWITCHER_DATA_DIR ? path.resolve(process.env.SWITCHER_DATA_DIR) : APP_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'accounts.json');
const LOG_FILE = path.join(DATA_DIR, 'switcher.log');
const TOKEN = crypto.randomBytes(24).toString('hex');
// Which code this server is running, so a copy started later can tell if it's out of date.
const BUILD = handover.buildId(APP_DIR);
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

const sessions = createSessionStore({ root: path.join(config().mainConfigDir, 'projects'), dataDir: DATA_DIR, log });
const projectInfo = projectsLib.createProjects({ dataDir: DATA_DIR, log });
const themeStudio = themeStudioLib.createStudio(DATA_DIR);
const chatPrefs = prefsLib.createChatPrefs({ dataDir: DATA_DIR, log });
const openclaw = openclawLib.createOpenClaw({ log, run: sys.runCapture, found: async () => (await sys.whereIs('openclaw')).length > 0, dataDir: DATA_DIR });
openclaw.onSessionsChanged(() => { forgetMerged(); broadcast('sessions'); });

// ---------- live updates ----------

const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}

// Chats running inside the app's chat window.
const finishedSeen = new Map();
// Chats open in the app window, kept on disk as they come and go, so they can be reopened after a
// restart (or a crash). Quitting keeps the list as it was; the next start offers to reopen them.
const OPEN_FILE = path.join(DATA_DIR, 'open-chats.json');
const REOPEN_FILE = path.join(DATA_DIR, 'reopen.json');
let shuttingDown = false, openTimer = null;
function writeOpenChats() {
  const list = Object.values(chats.live()).filter(c => !c.parentKey && c.sessionId && !(chats.chats.get(c.key) || {}).aside).map(c => ({
    sessionId: c.sessionId, provider: c.provider || 'claude', accountId: c.accountId, accountName: c.accountName,
    cwd: c.cwd, title: c.title || null, folder: c.folder || null,
  }));
  try { store.writeJsonAtomic(OPEN_FILE, { at: Date.now(), chats: list }); return true; } catch (err) { log(`Couldn’t note the open chats: ${err.message}`); return false; }
}
function saveOpenChats() {
  if (shuttingDown) return;
  clearTimeout(openTimer);
  openTimer = setTimeout(() => { if (!shuttingDown) writeOpenChats(); }, 1500);
}
// At start: last time's open chats become the ones to offer.
try {
  if (fs.existsSync(OPEN_FILE)) {
    const was = store.loadOwnJson(OPEN_FILE, null, log);
    if (was && Array.isArray(was.chats) && was.chats.length) fs.renameSync(OPEN_FILE, REOPEN_FILE); else fs.unlinkSync(OPEN_FILE);
  }
} catch { /* nothing to offer */ }
const toReopen = () => { const j = store.loadOwnJson(REOPEN_FILE, null, () => {}); return (j && Array.isArray(j.chats) ? j.chats : []).filter(c => c && c.sessionId); };
// Started by Restart (in the last two minutes): the chats that were open are reopened straight away,
// not offered, and nothing is left to offer.
const RESTART_FILE = path.join(DATA_DIR, 'restart.json');
const restarted = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(RESTART_FILE, 'utf8'));
    fs.unlinkSync(RESTART_FILE);
    if (!j || !(Date.now() - j.at < 120000)) return null;
    const list = toReopen();
    try { fs.unlinkSync(REOPEN_FILE); } catch { /* nothing open */ }
    return { ...j, chats: list };
  } catch { return null; }
})();
function stopForQuit() { shuttingDown = true; clearTimeout(openTimer); chats.stopAll(); try { runner.stopAll(); } catch { /* not started yet */ } }

// Each conversation's changes, undos and reviews, kept beyond the chat's run (lib/extras.js).
const chatExtras = extrasLib.createExtras({ dir: path.join(DATA_DIR, 'chat-extras'), log });
// Run the project (lib/runner.js): one run per project, its output kept for the page.
const runner = runnerLib.createRunner({ dataDir: DATA_DIR, log, onChange: cwd => broadcast('run', { cwd }) });
const chats = chatLib.createChatManager({
  log,
  extras: chatExtras,
  onChange: chat => {
    // A partner doesn't outlive its chat: it would be left running with no window to show it.
    if (chat && chat.state === 'ended' && chat.companionKey) { const p = pairs.partnerOf(chat); if (p && p.state !== 'ended') p.stop(); }
    broadcast('live', chats.live()); scheduleActivity(); schedulePush(); saveOpenChats();
  },
  onSession: chat => {
    // A side question is set aside as done as soon as it has an id: it never sits in the lists.
    if (chat.aside && chat.sessionId) chatPrefs.setDone(chat.sessionId, true);
    if (chat.provider !== 'codex') sessions.recordLaunch(chat.sessionId, chat.account, chat.fork ? 'fork' : 'app');
    // Choices made before the chat had an id, a partner paired before then, and when it last caught
    // up on that partner, are kept now.
    if (chat.choices && Object.keys(chat.choices).length) chatPrefs.set({ sessionId: chat.sessionId }, chat.choices);
    if (chat.heardUntil) chatPrefs.setHeard(chat.sessionId, chat.heardUntil);
    pairs.link(chat);
    broadcast('live', chats.live());
    setTimeout(sessionsChanged, 1500);
  },
  onActivity: chat => {
    scheduleActivity(); schedulePush();
    // A finished turn changes the account's usage; check it shortly after.
    const f = chat.activity.finishedAt;
    if (f && finishedSeen.get(chat.key) !== f) {
      finishedSeen.set(chat.key, f); scheduleUsage(chat.account.id, 8000);
      for (const k of finishedSeen.keys()) if (!chats.chats.has(k)) finishedSeen.delete(k);
    }
  },
  onRateLimit: (chat, info) => usage.fromRateLimit(chat.account.id, info),
});

// ---------- Claude and Codex in one chat (lib/pairs.js; what each is told: lib/duo.js) ----------
const pairs = pairsLib.createPairs({
  chats, prefs: chatPrefs, log,
  onPaired: () => { broadcast('live', chats.live()); scheduleActivity(); },
  transcript: async (provider, id, until) => (provider === 'codex' ? (await codex.history(id, null, until)).items : (await chatLib.readHistory(sessions.fileFor(id), { until, limit: 80 })).items),
  lastChanged: (provider, id) => {
    try {
      if (provider === 'codex') { const x = codex.cached(sessions.lastOpened).find(t => t.id === id); return x ? x.updated || 0 : 0; }
      return sessions.find(id).session.updated || 0;
    } catch { return 0; }
  },
  // Claude in a Codex chat runs as the account you're working as (or the one it last ran as); Codex in
  // a Claude chat resumes its thread even when Codex's own list hasn't caught up yet.
  startPartner: async (lead, { remembered, accountId }) => {
    const c = config();
    if ((lead.provider || 'claude') === 'codex') {
      let sessionId = null;
      if (remembered) { try { sessionId = sessions.find(remembered).session.id; } catch { /* that conversation is gone */ } }
      const last = sessionId && sessions.lastOpened(sessionId);
      const a = acc.findAccount(c, accountId && !isCodexAccount(accountId) ? accountId : (last && !isCodexAccount(last.account) ? last.account : null));
      await guarded(a);
      acc.prepareForLaunch(c, a);
      const pref = chatPrefs.get({ sessionId, cwd: lead.cwd, provider: 'claude' });
      return chats.open({ cfg: c, account: a, cwd: lead.cwd, sessionId, permissionMode: chatLib.MODES.includes(pref.mode) ? pref.mode : null, model: pref.model, effort: pref.effort, title: `Claude · ${lead.title || 'New chat'}`, folder: lead.folder });
    }
    let inst = await codexChecked(codexForThread(remembered));
    if (!inst.publicState().signedIn) inst = await codexChecked(codexActive());
    requireCodexSignedIn(inst);
    const pref = chatPrefs.get({ sessionId: remembered, cwd: lead.cwd, provider: 'codex' });
    return inst.open({ cfg: c, cwd: lead.cwd, threadId: remembered || null, mode: pref.mode, model: modelFits(inst, pref.model) ? pref.model : null, effort: pref.effort, companion: true, title: `Codex · ${lead.title || 'New chat'}`, folder: lead.folder });
  },
});

// Plan usage per account (5-hour and weekly windows with reset times).
const usage = usageLib.createUsage({ log, chats, onChange: () => { scheduleUsageBroadcast(); queueOnUsage(); } });

// Codex (OpenAI): its own sign-in, chats and usage, through `codex app-server`.
// The main account uses the Codex home from Setup; extra ones (more ChatGPT accounts, or Ollama)
// have homes of their own that share its chats (lib/codexhomes.js). `codex` is the main one: the
// chat list, history and renames come from it, since every account shares them. Sign-in, usage
// and new chats go to the active account (codexActive()), like "New chats open as" for Claude.
let codexTimer = null;
const codexOnChange = () => { if (codexTimer) return; codexTimer = setTimeout(() => { codexTimer = null; broadcast('accounts'); }, 300); };
const makeCodex = account => codexLib.createCodex({ getConfig: () => config(), log, usage, chats, onChange: codexOnChange, account });
const codex = makeCodex(codexLib.ACCOUNT);
const codexExtra = new Map(); // id -> instance, for config().codexAccounts
function codexAll() {
  const want = (config().codexAccounts || []).filter(x => x && /^codex-[a-z0-9-]{1,30}$/.test(x.id));
  for (const [id, inst] of codexExtra) if (!want.some(x => x.id === id)) { inst.stop(); codexExtra.delete(id); }
  for (const x of want) {
    const home = codexHomes.homeFor(x.id);
    const cur = codexExtra.get(x.id);
    if (cur && cur.ACCOUNT.name === x.name && cur.ACCOUNT.kind === (x.kind || 'chatgpt')) continue;
    if (cur) cur.stop();
    codexExtra.set(x.id, makeCodex({ id: x.id, name: x.name, home, kind: x.kind || 'chatgpt', provider: 'codex' }));
  }
  return [codex, ...codexExtra.values()];
}
const codexById = id => (!id || id === 'codex' ? codex : (codexAll(), codexExtra.get(id)) || null);
const isCodexAccount = id => id === 'codex' || (config().codexAccounts || []).some(x => x.id === id);
const codexActive = () => codexById(config().codexActive) || codex;
// The account a Codex chat should resume as: the one that last opened it, else the active one.
function codexForThread(threadId, explicit) {
  if (explicit) { const x = codexById(explicit); if (x) return x; }
  const last = threadId && sessions.lastOpened(threadId);
  return (last && isCodexAccount(last.account) && codexById(last.account)) || codexActive();
}
// What the page shows: the active account in the shape it always had, plus every Codex account.
const codexPublic = () => ({ ...codexActive().publicState(), accounts: codexAll().map(x => x.publicState()) });
const refreshAllCodexUsage = () => Promise.all(codexAll().filter(x => x.publicState().signedIn).map(x => x.refreshUsage().catch(() => null)));
// A Codex model remembered from a ChatGPT account won't exist on Ollama, and the other way round.
const modelFits = (inst, model) => !model || ((inst.ACCOUNT.kind === 'ollama') === /:/.test(model));
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
// OpenClaw agents' sessions (read-only); refreshes in the background and tells the page when they change.
const openclawSessions = (maxAgeMs = 25000) => openclaw.sessions(maxAgeMs);
const normCwd = p => { const x = String(p || '').replace(/[\\/]+$/, ''); return process.platform === 'win32' ? x.toLowerCase() : x; };
// Claude Code's folders plus Codex chats and OpenClaw sessions, merged by folder, plus folders created or added here
// that don't have any chats yet.
// Reused for a second: banner, picture and media requests each look a project up in it.
let mergedMemo = null;
const forgetMerged = () => { mergedMemo = null; };
function sessionsWithCodex() {
  if (mergedMemo && Date.now() - mergedMemo.at < 1000) return mergedMemo.value;
  const merged = mergeSessions();
  // A race's copies aren't projects of yours: their chats live on the race's card.
  let value = merged.projects.some(p => raceLib.isRaceDir(p.cwd)) ? { ...merged, projects: merged.projects.filter(p => !raceLib.isRaceDir(p.cwd)) } : merged;
  // A partner's conversation lives inside the chat it belongs to: that chat's row says who's in it.
  const partners = chatPrefs.partners();
  if (partners.size) {
    const leads = new Map();
    for (const [pid, lid] of partners) leads.set(String(lid).toLowerCase(), pid);
    value = { ...value, projects: value.projects.map(p => {
      if (!p.sessions.some(x => partners.has(x.id.toLowerCase()) || leads.has(x.id.toLowerCase()))) return p;
      const byId = new Map(p.sessions.map(x => [x.id.toLowerCase(), x]));
      const list = [];
      for (const x of p.sessions) {
        const id = x.id.toLowerCase();
        if (partners.has(id) && byId.has(String(partners.get(id)).toLowerCase())) continue;
        const pid = leads.get(id), mate = pid && byId.get(pid.toLowerCase());
        list.push(pid ? { ...x, partner: { id: pid, provider: mate ? (mate.provider || 'claude') : ((x.provider || 'claude') === 'codex' ? 'claude' : 'codex') }, updated: Math.max(x.updated, mate ? mate.updated : 0) } : x);
      }
      return { ...p, sessions: list.sort((a, b) => b.updated - a.updated) };
    }) };
  }
  value = { ...value, projects: value.projects.map(p => { const art = themeStudio.project(p.cwd); return art ? { ...p, name: `Theme Studio · ${art.name}` } : p; }) };
  mergedMemo = { at: Date.now(), value };
  return value;
}
function mergeSessions() {
  const base = sessions.scan();
  const cx = codexSessions();
  const oc = openclawSessions();
  const extra = projectInfo.added();
  if (!cx.length && !oc.length && !extra.length) return base;
  const projects = base.projects.map(p => ({ ...p, sessions: p.sessions.slice() }));
  const byCwd = new Map(projects.map(p => [normCwd(p.cwd), p]));
  for (const t of [...cx, ...oc]) {
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
// Another chat's latest messages, for one that brings it in with "@chat[…]" (shown there as a fold-out).
async function otherChatBlock(ref) {
  const id = String((ref && ref.id) || '');
  let items = [], title = 'another chat', folder = '', who = 'Claude';
  try {
    const cx = codexFind(id);
    if (cx) { items = (await codex.history(id, null, null)).items || []; title = (cx.session && cx.session.title) || title; folder = cx.folder || ''; who = 'Codex'; }
    else { const f = sessions.find(id); title = f.session.title || title; folder = f.project.name || ''; items = (await chatLib.readHistory(sessions.fileFor(id), { limit: 40 })).items || []; }
  } catch { throw fail(404, 'That chat can’t be read. It may have been deleted.'); }
  const clipT = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const lines = [];
  for (const it of items) {
    if (it.kind === 'user') { const t = ownText(it.text || '').trim(); if (t) lines.push(`User: ${clipT(t, 1500)}`); }
    else if (it.kind === 'assistant') { const t = (it.blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); if (t) lines.push(`${who}: ${clipT(t, 2500)}`); }
  }
  const keep = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0 && keep.length < 12; i--) { if (keep.length && total + lines[i].length > 9000) break; total += lines[i].length; keep.unshift(lines[i]); }
  const attr = v => String(v).replace(/["<>\n]/g, ' ').slice(0, 120);
  return `<other-chat title="${attr(title)}" folder="${attr(folder)}" items="${keep.length}">\nFrom the user’s other chat “${title}”${folder ? ` (in ${folder})` : ''}, its latest messages, for context (that chat carries on separately):\n\n${(keep.join('\n\n') || '(Nothing in it yet.)').replace(/<\/other-chat>/gi, '</other‑chat>')}\n</other-chat>\n\n`;
}
function codexFind(id) {
  const t = id && codex.known(String(id));
  if (!t) return null;
  const s = codex.cached(sessions.lastOpened).find(x => x.id === t.id);
  return { thread: t, session: s, cwd: t.cwd, exists: !!t.cwd && fs.existsSync(t.cwd), folder: path.basename(String(t.cwd || '').replace(/[\\/]+$/, '')) };
}
const isCodexId = id => !!codexFind(id);
// ---------- queued tasks: started as new chats when their time comes and an account has room ----------
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
let taskList = (() => { const j = store.loadOwnJson(TASKS_FILE, null, log); return j && Array.isArray(j.tasks) ? j.tasks : []; })();
let queueRunning = null;   // the pass that is running, as a promise
function saveTasks() {
  taskList = tasksLib.tidy(taskList);
  try { store.writeJsonAtomic(TASKS_FILE, { tasks: taskList }); } catch (err) { log(`Couldn’t save tasks.json: ${err.message}`); }
  broadcast('tasks', { tasks: tasksView() });
}
function queueContext() {
  const c = config();
  const accounts = c.accounts.map(a => { const p = acc.publicAccount(c, a); return { id: a.id, name: a.name, usable: !!(p.signedIn && p.lock && p.lock.ok) }; });
  const snap = usage.snapshot();
  return { accounts, usage: { ...snap, codex: snap[codexActive().ACCOUNT.id] || snap.codex } };
}
// Each task with why it's waiting (a queued one), for the page.
function tasksView() {
  const ctx = queueContext();
  return tasksLib.tidy(taskList).map(t => (t.state === 'queued' ? { ...t, why: tasksLib.readyAccount(t, ctx).why } : t));
}
const waitReady = (chat, ms) => new Promise(res => { const t0 = Date.now(); const tick = () => (chat.state !== 'starting' || Date.now() - t0 > ms ? res() : setTimeout(tick, 250)); tick(); });
async function startTask(t, account) {
  const info = await openChat(config(), { account: account.id, cwd: t.cwd, mode: 'new', provider: t.provider });
  const chat = chats.get(info.key);
  await waitReady(chat, 45000);
  await chat.beforeTurn();
  // From "Do this later": the chat it came from, as background (its latest messages).
  const background = t.from && t.from.id ? await otherChatBlock({ id: t.from.id }).catch(() => '') : '';
  chat.send(background + t.prompt, []);
  Object.assign(t, { state: 'started', key: info.key, accountName: info.accountName || account.name || null, doneAt: new Date().toISOString(), error: null });
  // A routine: its next run waits in the queue.
  const next = tasksLib.nextOf(t);
  if (next) taskList.push(next);
  log(`Task started in ${t.folder}: ${t.prompt.split('\n')[0].slice(0, 80)}`);
}
async function runQueue(onlyId = null, force = false) {
  // A pass already running: "Start now" waits for it, then goes (rather than saying there's no room).
  if (queueRunning) { if (!onlyId) return; await queueRunning.catch(() => {}); if (queueRunning) return; }
  let done;
  queueRunning = new Promise(r => { done = r; });
  try {
    let changed = false;
    for (const t of taskList.slice()) {
      // Removed (or started) while an earlier one was starting: left alone.
      if (!taskList.includes(t) || t.state !== 'queued' || (onlyId && t.id !== onlyId)) continue;
      const ctx = queueContext();
      const r = tasksLib.readyAccount(force ? { ...t, when: 'now' } : t, ctx);
      if (!r.account) continue;
      try { await startTask(t, r.account); } catch (err) { Object.assign(t, { state: 'failed', error: err.message, doneAt: new Date().toISOString() }); log(`Task failed to start: ${err.message}`); if (t.repeat && !taskList.some(x => x.state === 'queued' && x.repeat && x.prompt === t.prompt && x.cwd === t.cwd)) { const next = tasksLib.nextOf(t); if (next) taskList.push(next); } }
      changed = true;
    }
    if (changed) saveTasks();
  } finally { const was = queueRunning; queueRunning = null; done(); void was; }
}
setInterval(() => { if (taskList.some(t => t.state === 'queued')) runQueue().catch(() => {}); }, 30000).unref();
// Usage changed (an account has room again, say): queued tasks may be able to start.
function queueOnUsage() { if (taskList.some(t => t.state === 'queued')) setTimeout(() => runQueue().catch(() => {}), 1000); }

// ---------- races: Claude and Codex on the same task, each in its own copy of the project ----------
const RACES_FILE = path.join(DATA_DIR, 'races.json');
let raceList = (() => { const j = store.loadOwnJson(RACES_FILE, null, log); return j && Array.isArray(j.races) ? j.races : []; })();
const raceCopyAt = cwd => (cwd && raceLib.isRaceDir(cwd) && raceList.some(r => r.state === 'running' && Object.values(r.copies).some(c => normCwd(c.cwd) === normCwd(cwd))) && fs.existsSync(cwd) ? { cwd: path.resolve(cwd), exists: true } : null);
function saveRaces() {
  const now = Date.now();
  raceList = raceList.filter(r => r.state === 'running' || now - Date.parse(r.doneAt || r.createdAt) < 6 * 3600e3);
  try { store.writeJsonAtomic(RACES_FILE, { races: raceList }); } catch (err) { log(`Couldn’t save races.json: ${err.message}`); }
  broadcast('races', {});
}
function raceOf(id) { const r = raceList.find(x => x.id === id); if (!r) throw fail(404, 'That race isn’t here any more.'); return r; }
// Each racer: its chat's state, and what it has changed so far.
async function racesView() {
  const out = [];
  let dirty = false;
  for (const r of raceList) {
    const racers = {};
    if (!r.sessions) r.sessions = {};
    for (const who of Object.keys(r.copies)) {
      let chat = null; try { chat = chats.get(r.keys[who]); } catch { /* stopped */ }
      // After a restart (or an idle stop and reopening) the chat runs under a new key: found by its conversation.
      if ((!chat || chat.state === 'ended') && r.sessions[who]) { const again = chats.bySession(r.sessions[who]); if (again) { chat = again; r.keys[who] = again.key; dirty = true; } }
      if (chat && chat.sessionId && r.sessions[who] !== chat.sessionId) { r.sessions[who] = chat.sessionId; dirty = true; }
      let files = null;
      if (r.state === 'running' && fs.existsSync(r.copies[who].path)) { try { files = (await raceLib.copyChanges(r, who)).files; } catch { files = null; } }
      racers[who] = { key: chat && chat.state !== 'ended' ? r.keys[who] : null, state: chat ? chat.state : 'ended', sessionId: (chat && chat.sessionId) || r.sessions[who] || null, files };
    }
    let judge = null;
    if (r.judge) { let jc = null; try { jc = chats.get(r.judge.key); } catch { /* stopped */ } judge = { key: jc && jc.state !== 'ended' ? r.judge.key : null, state: jc ? jc.state : 'ended', sessionId: (jc && jc.sessionId) || r.judge.sessionId || null }; if (jc && jc.sessionId) r.judge.sessionId = jc.sessionId; }
    out.push({ id: r.id, cwd: r.cwd, folder: r.folder, prompt: r.prompt, split: r.split || null, state: r.state, kept: r.kept || null, createdAt: r.createdAt, racers, judge });
  }
  if (dirty) { try { store.writeJsonAtomic(RACES_FILE, { races: raceList }); } catch { /* kept in memory */ } }
  return out;
}
// Split the work: one task, each taking its own part, told what the other is doing.
const splitText = (task, mine, theirs, other) => `${task ? `The task: ${task}\n\n` : ''}You and ${other} are splitting this, each in your own copy of the project; both sets of changes are put together afterwards.\n\nYour part: ${mine}\n\n${other}'s part (leave it to them, and don't edit the files it needs): ${theirs}`;
async function startRace({ cwd, prompt, accountId, split }) {
  const p = projectAt(cwd);
  if (!p || !p.exists) throw fail(404, 'Pick one of your projects.');
  const text = String(prompt || '').trim();
  const parts = split && String(split.claude || '').trim() && String(split.codex || '').trim() ? { claude: String(split.claude).trim(), codex: String(split.codex).trim() } : null;
  if (split && !parts) throw fail(400, 'Write each one’s part.');
  if (!text && !parts) throw fail(400, 'Write the task for both of them.');
  requireCodexSignedIn();
  const c = config();
  const account = accountId && accountId !== 'auto' ? acc.findAccount(c, accountId) : tasksLib.readyAccount({ state: 'queued', provider: 'claude', accountId: 'auto', when: 'now' }, queueContext()).account;
  if (!account) throw fail(409, 'None of your Claude accounts has room right now.');
  const made = await raceLib.makeRace(p.cwd);
  const r = { ...made, cwd: p.cwd, folder: p.name, prompt: text || `${parts.claude} · ${parts.codex}`, split: parts, keys: {}, state: 'running', createdAt: new Date().toISOString() };
  raceList.push(r); saveRaces();
  try {
    for (const [who, provider] of [['claude', 'claude'], ['codex', 'codex']]) {
      const info = await openChat(c, { account: provider === 'codex' ? null : account.id, cwd: r.copies[who].cwd, mode: 'new', provider });
      r.keys[who] = info.key;
      const chat = chats.get(info.key);
      chat.title = parts ? `Split: ${parts[who].split('\n')[0].slice(0, 60)}` : `Race: ${text.split('\n')[0].slice(0, 60)}`;
      await waitReady(chat, 45000);
      chat.send(parts ? splitText(text, parts[who], parts[who === 'claude' ? 'codex' : 'claude'], who === 'claude' ? 'Codex' : 'Claude') : text, []);
    }
  } catch (err) {
    for (const k of Object.values(r.keys)) { try { await chats.get(k).stop(); } catch { /* gone */ } }
    await raceLib.dropRace(r); raceList = raceList.filter(x => x !== r); saveRaces();
    throw err;
  }
  saveRaces();
  log(`${parts ? 'Split' : 'Race'} started in ${p.cwd}: ${r.prompt.split('\n')[0].slice(0, 80)}`);
  return r;
}
// What /api/race does to a running race: keep, keep both, keep files, ask a judge, or discard.
const raceBusy = new Set();
async function raceAction(r, body, res) {
  if (body.action === 'discard') {
    await stopRacers(r); await raceLib.dropRace(r);
    Object.assign(r, { state: 'discarded', doneAt: new Date().toISOString() }); saveRaces();
    return send(res, 200, { races: await racesView() });
  }
  if (body.action === 'keep') {
    if (!r.copies[body.who]) throw fail(400, 'Keep Claude’s or Codex’s?');
    const k = await raceLib.keepCopy(r, body.who, { force: !!body.force });
    if (!k.applied) return send(res, 200, { kept: false, why: k.why, detail: k.detail || null, races: await racesView() });
    await stopRacers(r); await raceLib.dropRace(r);
    Object.assign(r, { state: 'kept', kept: body.who, doneAt: new Date().toISOString() }); saveRaces();
    log(`Race in ${r.cwd}: kept ${body.who}'s changes (${k.files.length} file${k.files.length === 1 ? '' : 's'}).`);
    return send(res, 200, { kept: true, files: k.files, races: await racesView() });
  }
  if (body.action === 'keepfiles') {
    // File by file: the files picked from each copy.
    const picks = {};
    for (const who of Object.keys(r.copies)) picks[who] = Array.isArray(body.picks && body.picks[who]) ? body.picks[who].map(String).slice(0, 500) : [];
    const k = await raceLib.keepFiles(r, picks, { force: !!body.force });
    if (!k.applied) return send(res, 200, { kept: false, why: k.why, clash: k.clash || null, detail: k.detail || null, races: await racesView() });
    await stopRacers(r); await raceLib.dropRace(r);
    Object.assign(r, { state: 'kept', kept: 'files', doneAt: new Date().toISOString() }); saveRaces();
    log(`Race in ${r.cwd}: kept ${k.files.length} file${k.files.length === 1 ? '' : 's'}, picked from both.`);
    return send(res, 200, { kept: true, files: k.files, races: await racesView() });
  }
  if (body.action === 'judge') {
    if (r.judge) { let jc = null; try { jc = chats.get(r.judge.key); } catch { /* stopped */ } if (jc && jc.state !== 'ended') return send(res, 200, { key: r.judge.key, races: await racesView() }); }
    // A judge: a chat that can only look, given both copies' changes, says which is better and why.
    const d = await raceLib.bothDiffs(r);
    const task = r.split ? `Claude's part: ${r.split.claude}\nCodex's part: ${r.split.codex}` : r.prompt;
    const ask = `Claude and Codex each did this task in their own copy of the project:\n\n${task}\n\nHere is what each changed (as diffs from the same starting point). Compare them for correctness, completeness, risk and code quality. Say which you'd keep, or which files to take from each, and why, briefly. Don't change any files.\n\n--- Claude's changes ---\n${d.claude || '(none)'}\n\n--- Codex's changes ---\n${d.codex || '(none)'}`;
    const ready = tasksLib.readyAccount({ state: 'queued', provider: 'claude', accountId: 'auto', when: 'now' }, queueContext()).account;
    const prov = ready ? 'claude' : 'codex';
    const info = await openChat(config(), { account: ready ? ready.id : null, cwd: r.cwd, mode: 'new', provider: prov, permissionMode: prov === 'codex' ? 'read-only' : 'plan' });
    const chat = chats.get(info.key);
    chat.title = `Judge: ${(r.prompt || '').split('\n')[0].slice(0, 50)}`;
    await waitReady(chat, 45000);
    chat.send(ask, []);
    r.judge = { key: info.key, provider: prov }; saveRaces();
    return send(res, 200, { key: info.key, races: await racesView() });
  }
  if (body.action === 'keepboth') {
    const k = await raceLib.keepBoth(r, { force: !!body.force });
    if (!k.applied) return send(res, 200, { kept: false, why: k.why, clash: k.clash || null, detail: k.detail || null, races: await racesView() });
    await stopRacers(r); await raceLib.dropRace(r);
    Object.assign(r, { state: 'kept', kept: 'both', doneAt: new Date().toISOString() }); saveRaces();
    log(`Race in ${r.cwd}: kept both sets of changes (${k.files.length} file${k.files.length === 1 ? '' : 's'}).`);
    return send(res, 200, { kept: true, files: k.files, races: await racesView() });
  }
  throw fail(400, 'Start, keep or discard a race.');
}
async function stopRacers(r) { for (const k of [...Object.values(r.keys || {}), r.judge && r.judge.key].filter(Boolean)) { try { await chats.get(k).stop(); } catch { /* already stopped */ } } }

// Opens a chat in the app window (or attaches to it if it's already running here), returning its info.
// Two opens of the same conversation at once (a double click, the phone and the PC) start it once.
const opening = new Map();
function openChat(c, body) {
  const id = (!body.mode || body.mode === 'resume') && body.sessionId ? String(body.sessionId).toLowerCase() : null;
  if (!id) return openChatNow(c, body);
  if (opening.has(id)) return opening.get(id).catch(() => null).then(() => { const live = chats.bySession(id); return live ? attachedInfo(live) : openChat(c, body); });
  const p = openChatNow(c, body);
  opening.set(id, p);
  p.then(() => opening.delete(id), () => opening.delete(id));
  return p;
}
async function openChatNow(c, body) {
  // A partner's conversation opens inside the chat it belongs to.
  const lead = (!body.mode || body.mode === 'resume') && body.sessionId ? chatPrefs.parentOf(body.sessionId) : null;
  if (lead && !body.alone && !body.viaPartner) {
    const live = chats.bySession(lead);
    if (live) return attachedInfo(live);
    if (isCodexId(lead) || (() => { try { return !!sessions.find(lead); } catch { return false; } })()) return openChat(c, { ...body, sessionId: lead, viaPartner: true, provider: isCodexId(lead) ? 'codex' : undefined });
  }
  const info = await openChatInner(c, body);
  // Its partner from an earlier run, if that's still running, is its partner again.
  try { const chat = chats.get(info.key); if (pairs.adopt(chat)) return { ...chat.info(), attached: info.attached, companionThread: info.companionThread }; } catch { /* not running */ }
  return info;
}
async function openChatInner(c, body) {
  if (body.provider === 'codex' || (body.mode !== 'new' && isCodexId(body.sessionId))) {
    const inst = await codexChecked(body.mode === 'new' ? (codexById(body.account) || codexActive()) : codexForThread(body.sessionId, body.account));
    requireCodexSignedIn(inst);
    const mode = ['resume', 'fork', 'new'].includes(body.mode) ? body.mode : 'resume';
    let cwd, threadId = null, title = null;
    if (mode !== 'new') {
      const cx = codexFind(body.sessionId);
      if (!cx) throw fail(404, 'That Codex chat isn’t in the list any more.');
      if (!cx.exists) throw fail(400, `The folder ${cx.cwd} no longer exists, so this chat can’t run there.`);
      cwd = cx.cwd; threadId = cx.thread.id; title = cx.session ? cx.session.title : null;
      if (mode === 'resume') { const live = chats.bySession(threadId); if (live) return attachedInfo(live); }
      if (mode === 'fork' && title) title = `${title} (copy)`;
    } else {
      const p = projectAt(body.cwd) || raceCopyAt(body.cwd) || themeStudio.project(body.cwd);
      if (!p) throw fail(404, 'That folder isn’t in the list.');
      if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
      cwd = p.cwd;
    }
    const art = themeStudio.project(cwd);
    const folder = art ? `Theme Studio · ${art.name}` : cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
    const pref = chatPrefs.get({ sessionId: threadId, cwd, provider: 'codex' });
    const model = [body.model, pref.model].find(m => m && modelFits(inst, m)) || null;
    const chat = inst.open({ cfg: c, cwd, threadId, fork: mode === 'fork', mode: body.permissionMode || pref.mode, model, effort: pref.effort, title: title || (art ? `Paint ${art.name}` : 'New Codex chat'), folder });
    if (threadId && mode === 'resume') sessions.recordLaunch(threadId, inst.ACCOUNT, 'app');
    log(`Codex chat window: ${mode} ${threadId || '(new)'}`);
    return { ...chat.info(), attached: false, remembered: !!pref.mode, companionThread: threadId && mode !== 'new' ? chatPrefs.companionOf(threadId) : null };
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
      if (live) return attachedInfo(live);
      if (!body.force) {
        const now = await sys.runningSessions().catch(() => ({}));
        running = now;
        const pids = now[session.id.toLowerCase()];
        if (pids) throw fail(409, `This chat is already open in a terminal (process ${pids.join(', ')}). Opening it twice can mix up its history.`, 'running');
      }
    }
  } else {
    const p = projectAt(body.cwd) || raceCopyAt(body.cwd);
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
  return { ...chat.info(), attached: false, remembered: !!pref.mode && !body.permissionMode, companionThread: sessionId && mode !== 'new' ? chatPrefs.companionOf(sessionId) : null };

}

// Rules and tools: CLAUDE.md and AGENTS.md (for a project, or for every project), and each one's MCP servers.
function rulesPathsFor(cwd) {
  if (!cwd) return rulesLib.rulesPaths({ claudeDir: config().mainConfigDir, codexHome: codexHomes.MAIN_HOME() });
  const p = projectAt(cwd);
  if (!p) throw fail(404, 'That folder isn’t in the list.');
  if (!p.exists) throw fail(404, `The folder ${p.cwd} no longer exists.`);
  return rulesLib.rulesPaths({ cwd: p.cwd });
}
// Codex's MCP servers, as `codex mcp list --json` reports them.
function codexMcpList(cwd) {
  return new Promise(resolve => {
    let child;
    try { child = sys.spawnCodex(codexActive().config(), cwd || os.homedir(), ['mcp', 'list', '--json']); } catch (err) { return resolve({ error: err.message }); }
    let out = '', errText = '';
    const timer = setTimeout(() => { try { sys.killTree(child); } catch { /* gone */ } resolve({ error: 'Codex didn’t list its tools in time.' }); }, 20000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errText += d; });
    child.on('error', err => { clearTimeout(timer); resolve({ error: err.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      try { resolve({ list: JSON.parse(out) }); } catch { resolve({ error: code ? (errText.trim().split(/\r?\n/).pop() || `Codex stopped (code ${code}).`) : 'Codex’s list of tools couldn’t be read.' }); }
    });
  });
}
async function toolsFor(cwd) {
  const p = cwd ? projectAt(cwd) : null;
  const claudeJson = acc.mainStateFile(config());
  const claude = claudeJson ? rulesLib.claudeServers(claudeJson, p ? p.cwd : null) : [];
  const cx = config().codex.enabled ? await codexMcpList(p && p.exists ? p.cwd : null) : { list: [] };
  return { servers: rulesLib.merged(claude, rulesLib.codexServers(cx.list)), codexError: cx.error || null, codexOn: config().codex.enabled };
}
// Copies one server to the other: to Codex through its own settings (config/value/write), to Claude
// Code with `claude mcp add-json`, run directly (no shell), for all your projects.
async function copyTool(name, to, cwd) {
  if (!rulesLib.NAME.test(String(name || ''))) throw fail(400, 'That tool’s name has characters these settings can’t take.');
  const t = await toolsFor(cwd);
  const p = cwd ? projectAt(cwd) : null;
  const claudeJson = acc.mainStateFile(config());
  if (to === 'codex') {
    const src = rulesLib.claudeServers(claudeJson || '', p ? p.cwd : null).find(x => x.name === name);
    if (!src) throw fail(404, `Claude Code has no tool called ${name}.`);
    const v = rulesLib.forCodex(src.spec);
    if (v.why) throw fail(400, v.why);
    requireCodexSignedIn();
    const s = codexActive().server();
    await s.request('config/value/write', { keyPath: `mcp_servers.${name}`, value: v.value, mergeStrategy: 'upsert' }, 30000);
    await s.request('config/mcpServer/reload', {}, 30000).catch(() => {});
  } else if (to === 'claude') {
    const cx = await codexMcpList(p && p.exists ? p.cwd : null);
    const src = rulesLib.codexServers(cx.list).find(x => x.name === name);
    if (!src) throw fail(404, cx.error || `Codex has no tool called ${name}.`);
    const v = rulesLib.forClaude(src.spec);
    if (v.why) throw fail(400, v.why);
    const c = config();
    const found = path.isAbsolute(c.claudeCommand) ? [c.claudeCommand] : await sys.whereIs(c.claudeCommand || 'claude');
    const exe = found.find(rulesLib.runnable);
    const json = JSON.stringify(v.value);
    if (!exe) throw fail(409, `Claude Code here is a script, which this can’t run safely. Run this in a terminal instead:\n\nclaude mcp add-json ${name} '${json}' -s user`);
    const env = { ...process.env };
    delete env.CLAUDE_CONFIG_DIR;
    if (c.prefs.cleanEnv) for (const k of sys.OVERRIDE_VARS) delete env[k];
    const r = await rulesLib.runDirect(exe, ['mcp', 'add-json', name, json, '-s', 'user'], { env, cwd: os.homedir() });
    if (r.code !== 0) throw fail(500, `Claude Code didn’t add it: ${(r.stderr || r.stdout).trim().split(/\r?\n/).pop() || `code ${r.code}`}`);
  } else throw fail(400, 'Copy it to Claude or to Codex.');
  log(`Tools: copied ${name} to ${to === 'codex' ? 'Codex' : 'Claude Code'}.`);
  return { ...(await toolsFor(cwd)), copied: name, was: t.servers.find(x => x.name === name) || null };
}

// Codex reviews a chat's work; progress and the result arrive in that chat as 'review' events.
// `done` settles with the outcome ({ state: 'done', findings } or { state: 'failed' }).
async function runReview(chat, files, base, { quiet = false } = {}) {
  requireCodexSignedIn();
  const t = await reviewTarget(chat.cwd, files, base);
  const id = crypto.randomBytes(6).toString('hex');
  const ev = extra => { if (!quiet) chat.emit({ kind: 'review', id, by: 'codex', what: t.what, base: t.base, ...extra }); };
  ev({ state: 'running', progress: 'Starting…' });
  let last = 0;
  const done = codexActive().review({
    cwd: chat.cwd, target: t.target,
    onProgress: p => { const now = Date.now(); if (now - last > 700) { last = now; ev({ state: 'running', progress: p }); } },
  }).then(r => { ev({ state: 'done', overall: r.overall, findings: r.findings }); log(`Review of ${t.what} in ${chat.cwd}: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}.`); return { state: 'done', findings: r.findings }; })
    .catch(err => { ev({ state: 'failed', error: err.message }); log(`Review failed: ${err.message}`); return { state: 'failed', findings: [] }; });
  return { id, what: t.what, base: t.base, done };
}
// Claude reviews (usually Codex's work): asked in its own chat, it answers with its findings as JSON
// (lib/review.js), which arrive as the same kind of review card. quiet: no card of its own (a dual review).
async function runClaudeReview(chat, files, base, { quiet = false, ask = '' } = {}) {
  const lead = pairs.leadOf(chat);
  const claude = (lead.provider || 'claude') === 'claude' ? lead : await pairs.ensure(lead);
  const t = await reviewTarget(lead.cwd, files, base);
  const id = crypto.randomBytes(6).toString('hex');
  const ev = extra => { if (!quiet) lead.emit({ kind: 'review', id, by: 'claude', what: t.what, base: t.base, ...extra }); };
  ev({ state: 'running', progress: 'Claude is reading the changes…' });
  const sentAt = new Date().toISOString();
  const done = (async () => {
    await pairs.send(claude, reviewAsk(t, ask));
    const end = await claude.turnDone();
    if (end.kind === 'ended' || end.ok === false) throw new Error('Claude stopped before finishing the review.');
    const text = claude.buffer.filter(e => e.kind === 'assistant' && e.at >= sentAt).flatMap(e => (e.blocks || []).filter(b => b.type === 'text').map(b => b.text)).join('\n\n');
    const r = parseFindings(text);
    ev({ state: 'done', overall: r.overall, findings: r.findings });
    log(`Claude's review of ${t.what} in ${lead.cwd}: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}.`);
    return { state: 'done', overall: r.overall, findings: r.findings };
  })().catch(err => { ev({ state: 'failed', error: err.message }); return { state: 'failed', findings: [] }; });
  return { id, what: t.what, base: t.base, done };
}
// Both review the same changes at once; one card shows every finding, marking those they both made.
async function runBothReview(chat, files, base) {
  const lead = pairs.leadOf(chat);
  const t = await reviewTarget(lead.cwd, files, base);
  const id = crypto.randomBytes(6).toString('hex');
  const ev = extra => lead.emit({ kind: 'review', id, by: 'both', what: t.what, base: t.base, ...extra });
  ev({ state: 'running', progress: 'Codex and Claude are both reviewing…' });
  const [cx, cl] = await Promise.all([runReview(lead, files, base, { quiet: true }), runClaudeReview(lead, files, base, { quiet: true })]);
  Promise.all([cx.done, cl.done]).then(([a, b]) => {
    if (a.state === 'failed' && b.state === 'failed') return ev({ state: 'failed', error: 'Neither review finished.' });
    const findings = mergeFindings(a.findings || [], b.findings || []);
    const agree = findings.filter(f => f.by === 'both').length;
    ev({ state: 'done', findings, overall: `${a.state === 'failed' ? 'Codex’s review didn’t finish. ' : ''}${b.state === 'failed' ? 'Claude’s review didn’t finish. ' : ''}${findings.length ? `${agree ? `Both found ${agree === 1 ? 'one problem' : `${agree} problems`}; those come first.` : 'They found different things.'}` : 'Neither found a problem.'}` });
  });
  return { id, what: t.what, base: t.base, done: null };
}
async function startReview(chat, files, base, by = 'codex') {
  const r = by === 'both' ? await runBothReview(chat, files, base) : by === 'claude' ? await runClaudeReview(chat, files, base) : await runReview(chat, files, base);
  return { id: r.id, what: r.what, base: r.base };
}

// "Carry on when it's back": a minute after the account's limit resets, the chat is told to pick up
// where it left off (if it's still open and idle; otherwise it just says the usage is back). Kept here,
// not in a window, while the app runs.
const spentBook = new Map();   // session -> its token tally, kept after the chat closes (see /api/usage/chats)
const resumeTimers = new Map();   // chat key -> timeout
function resumeAt(chat, at, cancel = false) {
  clearTimeout(resumeTimers.get(chat.key)); resumeTimers.delete(chat.key);
  if (cancel) { chat.emit({ kind: 'resumeat', at: null }); return { ok: true }; }
  const ms = Date.parse(at) - Date.now() + 60000;
  if (!Number.isFinite(ms) || ms > 20 * 24 * 3600e3) throw fail(400, 'That reset time isn’t known.');
  resumeTimers.set(chat.key, setTimeout(() => {
    resumeTimers.delete(chat.key);
    chat.emit({ kind: 'resumeat', at: null });
    if (chat.state === 'ended') return;
    if (chat.state !== 'ready') return chat.emit(notice('info', 'Your usage is back.'));
    pairs.send(chat, 'Your usage is back. Please carry on where you left off.').catch(err => chat.emit(notice('warning', `Couldn’t carry on: ${err.message}`)));
  }, Math.max(5000, ms)));
  chat.emit({ kind: 'resumeat', at });
  return { ok: true, at };
}

// "Fix and recheck until clean" (lib/reviewloop.js), run here so it carries on whatever the window does.
const reviewLoop = createReviewLoop({ send: (chat, text) => pairs.send(chat, text), review: runReview, fixText });

// Right after the app starts, Codex's sign-in hasn't been checked yet; check it before saying it isn't.
async function codexChecked(inst = codexActive()) {
  if (!inst.publicState().checked) await inst.refreshAccount().catch(() => null);
  return inst;
}
function requireCodexSignedIn(inst = codexActive()) {
  const st = inst.publicState();
  if (!st.enabled) throw fail(409, 'Codex is turned off in Setup.');
  if (st.installed === false) throw fail(409, 'Codex isn’t installed on this PC yet. Open Setup to install it.', 'codex-missing');
  if (!st.signedIn) throw fail(409, st.kind === 'ollama' ? (st.error || 'Start the Ollama app first.') : `Sign in to ${st.name} first: on the hub, under Accounts and usage, click “Sign in with ChatGPT” on its card.`, 'codex-signin');
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
  const out = chats.summaries().filter(s => !s.aside).map(s => {
    const f = s.sessionId && s.provider !== 'codex' ? byId.get(s.sessionId.toLowerCase()) : null;
    if (f) { s.title = f.s.title; s.folder = f.p.name; }
    return s;
  });
  // A Codex helper is named after the Claude chat it works with.
  for (const s of out) if (s.parentKey) { const p = out.find(x => x.key === s.parentKey); s.title = `Codex · ${p ? p.title || 'New chat' : s.title || 'helper'}`; }
  const seen = new Set(out.filter(x => x.sessionId).map(x => x.sessionId.toLowerCase()));
  // Chats this app ran and has since stopped aren't "elsewhere"; they were here.
  const ranHere = new Set([...chats.chats.values()].filter(c => c.sessionId).map(c => c.sessionId.toLowerCase()));
  // The app's own Claude Code processes look like terminal chats to the process scan (they're started
  // to resume a conversation too): a conversation the app runs, or ran in the last minute, is never
  // "in a terminal" as well.
  const ownIds = new Set();
  for (const c of chats.chats.values()) if (c.state !== 'ended' || now - (c.lastAt || 0) < 60000) for (const id of [c.sessionId, c.fork ? null : c.startedAs]) if (id) ownIds.add(String(id).toLowerCase());
  for (const p of projects) {
    for (const s of p.sessions) {
      const id = s.id.toLowerCase();
      if (seen.has(id) || ownIds.has(id)) continue;
      // A partner's conversation belongs to its chat; it isn't a chat of its own here either.
      if (chatPrefs.parentOf(id)) continue;
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
  setInterval(() => { if (clients.size) { refreshAllUsage(4 * 60 * 1000); if (config().codex.enabled) refreshAllCodexUsage(); } }, 5 * 60 * 1000);
  setInterval(() => { if (clients.size && config().codex.enabled) codexSessions(15000); }, 20000);
  setInterval(() => { if (clients.size) openclawSessions(15000); }, 30000);
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
    // A plain object, always (null, a list or a number would trip the routes up).
    req.on('end', () => { try { const j = data ? JSON.parse(data) : {}; if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object'); resolve(j); } catch { reject(fail(400, 'Bad request.')); } });
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
    codex: codexPublic(),
    reopen: restarted ? [] : toReopen(),
    restart: restartState(), update: newBuildReady(), pid: process.pid,
  };
}

// ---------- routes ----------

// Things only the PC itself may do: quit the app, manage phone access, open windows on the PC that
// a phone couldn't see.
const LOCAL_ONLY = new Set(['/api/tools/copy', '/api/quit', '/api/restart', '/api/shortcut', '/api/share-copy', '/api/project/pick', '/api/codex/install', '/api/update-claude', '/api/openclaw/archive', '/api/openclaw/send']);

async function handleApi(req, res, url, remote = false) {
  const c = config();
  const route = `${req.method} ${url.pathname}`;
  if (remote && (LOCAL_ONLY.has(url.pathname) || url.pathname.startsWith('/api/phone'))) throw fail(403, 'That can only be done on the PC itself.');
  if (route === 'GET /api/phone') return send(res, 200, { ...phone.status(), pushPhones: pushes.count(), appsListening: [...new Set([...appWatchers].map(w => w.device.id))] });
  if (route === 'GET /api/run') { const p = projectAt(url.searchParams.get('cwd')); if (!p) throw fail(404, 'Pick one of your projects.'); return send(res, 200, runner.status(p.cwd)); }
  if (route === 'GET /api/phone/tailscale') return send(res, 200, await tailscaleStatus());
  if (route === 'POST /api/phone/tailscale-serve') return send(res, 200, await tailscaleServe());
  if (url.pathname.startsWith('/api/push') || url.pathname.startsWith('/api/notify')) return pushApi(req, res, route, remote);

  if (route === 'GET /api/state') return send(res, 200, stateFor());
  if (route === 'GET /api/themes') return send(res, 200, themeStudio.list());
  if (route === 'GET /api/themes/job') return send(res, 200, themeStudio.job(url.searchParams.get('id')));
  if (route === 'GET /api/themes/result') return send(res, 200, themeStudio.result(url.searchParams.get('id')));
  if (route === 'GET /api/themes/art') {
    const q = url.searchParams, art = themeStudio.asset(q.get('kind'), q.get('id'), q.get('mode'));
    res.writeHead(200, { 'Content-Type': art.type, 'Cache-Control': q.get('kind') === 'themes' ? 'private, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(art.bytes);
  }
  if (route === 'GET /api/sessions') return send(res, 200, { ...sessionsWithCodex(), running, live: chats.live(), doneMarks: chatPrefs.doneMarks() });
  if (route === 'GET /api/chat/history') {
    const id = url.searchParams.get('id'), q = url.searchParams;
    const running = chats.bySession(id);
    // An OpenClaw agent's session: read from its own store.
    if (q.get('provider') === 'openclaw') return send(res, 200, openclaw.history(id));
    // Codex: by its id, or because the page says so (a brand-new thread isn't in Codex's list yet).
    if (isCodexId(id) || q.get('provider') === 'codex' || (running && running.provider === 'codex')) return send(res, 200, await codex.history(id, q.get('cursor'), q.get('until') || null));
    let file;
    try { file = sessions.fileFor(id); } catch (err) {
      // A chat running here that hasn't written any history yet (it's new): nothing earlier to show.
      if (err.status === 404 && running) return send(res, 200, { items: [], start: 0, cursor: null });
      throw err;
    }
    return send(res, 200, await chatLib.readHistory(file, { until: q.get('until') || null, cursor: q.get('cursor'), limit: 60 }));
  }
  // What a chat showed besides its conversation (changes, undos, reviews), up to where its live replay begins.
  if (route === 'GET /api/chat/extras') return send(res, 200, { extras: chatExtras.list(url.searchParams.get('id') || '', url.searchParams.get('until') || null) });
  if (route === 'GET /api/chat/diff') {
    const q = url.searchParams;
    return send(res, 200, { diff: await chats.get(q.get('key')).turnDiff(q.get('turn'), q.get('path')) });
  }
  if (route === 'GET /api/chat/live') return send(res, 200, { live: chats.live() });
  if (route === 'GET /api/activity') return send(res, 200, { list: activityList(), at: Date.now() });
  if (route === 'GET /api/usage') return send(res, 200, { usage: usage.snapshot() });
  // Since you left (for the welcome-back card): files the chats changed and reviews that came back.
  if (route === 'GET /api/away') {
    const since = new Date(Number(url.searchParams.get('since')) || 0).toISOString();
    const files = new Set(), reviews = [];
    for (const c of chats.chats.values()) {
      for (const e of c.buffer) {
        if (!e.at || e.at < since) continue;
        if (e.kind === 'changes') for (const f of e.files || []) if (!f.meanwhile) files.add(`${c.cwd}|${f.path}`);
        if (e.kind === 'review' && e.state === 'done') reviews.push({ by: e.by || 'codex', findings: (e.findings || []).length });
      }
    }
    return send(res, 200, { files: files.size, reviews });
  }
  // What used each account's window: tokens per chat over the last five hours and the week, counted
  // while this app runs (kept after a chat closes).
  if (route === 'GET /api/usage/chats') {
    const now = Date.now(), out = {};
    for (const c of chats.chats.values()) if (c.spent && c.spent.length) spentBook.set(c.sessionId || c.key, { c, title: (c.info().title || c.title || ''), spent: c.spent, account: c.account.id, provider: c.provider || 'claude', sessionId: c.sessionId });
    for (const [k, e] of spentBook) {
      const five = e.spent.reduce((n, x) => n + (now - x.at < 5 * 3600e3 ? x.tokens : 0), 0), week = e.spent.reduce((n, x) => n + (now - x.at < 7 * 24 * 3600e3 ? x.tokens : 0), 0);
      if (!week) { spentBook.delete(k); continue; }
      (out[e.account] = out[e.account] || []).push({ sessionId: e.sessionId, title: e.title, provider: e.provider, five, week });
    }
    for (const list of Object.values(out)) list.sort((a, b) => b.five - a.five || b.week - a.week);
    return send(res, 200, { byAccount: out });
  }
  if (route === 'GET /api/file') {
    const q = Object.fromEntries(url.searchParams);
    return send(res, 200, filesLib.readEntry(fileBase(q), q.path));
  }
  // A chat's (or project's) files, for @ mentions in the message box.
  if (route === 'GET /api/files/list') {
    const cwd = fileBase(Object.fromEntries(url.searchParams));
    if (!cwd || !fs.existsSync(cwd)) throw fail(404, 'That folder isn’t available.');
    return send(res, 200, { cwd, files: await listFiles(cwd) });
  }
  if (route === 'GET /api/tasks') return send(res, 200, { tasks: tasksView() });
  if (route === 'GET /api/races') return send(res, 200, { races: await racesView() });
  if (route === 'GET /api/race/diff') {
    const q = url.searchParams, r = raceOf(q.get('id')), who = q.get('who');
    if (!r.copies[who]) throw fail(400, 'Claude or Codex?');
    return send(res, 200, { diff: await raceLib.copyDiff(r, who, q.get('path')) });
  }
  if (route === 'GET /api/rules') {
    const cwd = url.searchParams.get('cwd') || null;
    return send(res, 200, { scope: cwd ? 'project' : 'user', cwd, ...rulesLib.readRules(rulesPathsFor(cwd)) });
  }
  if (route === 'GET /api/tools') return send(res, 200, await toolsFor(url.searchParams.get('cwd') || null));
  // The day at a glance: when each chat was active since a moment (Claude's message by message, Codex's
  // last activity), for the hub's Today strip.
  if (route === 'GET /api/today') {
    const since = Math.max(Number(url.searchParams.get('since')) || 0, Date.now() - 2 * 864e5);
    const codexMarks = codexSessions().filter(x => x.updated >= since).map(x => ({ id: x.id, provider: 'codex', times: [x.updated] }));
    return send(res, 200, { at: Date.now(), since, chats: [...sessions.activity(since).map(x => ({ ...x, provider: 'claude' })), ...codexMarks] });
  }
  if (route === 'GET /api/project/crest-result') {
    const p = projectAt(url.searchParams.get('cwd'));
    if (!p || !p.exists) throw fail(404, 'That folder isn’t available.');
    return send(res, 200, { image: projectsLib.crestResult(p.cwd, url.searchParams.get('name')) });
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
      await Promise.all(codexAll().filter(x => x !== codexActive()).map(x => x.refreshAccount().catch(() => null)));
      const st = await codexActive().refreshAccount().then(() => codexActive().publicState()).catch(() => codexActive().publicState());
      if (st.installed === false) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: 'Codex isn’t installed. Install it to use your ChatGPT plan’s Codex here too, or turn Codex off below.', fix: { action: 'install-codex', label: 'Install Codex' } });
      else if (st.error && !st.signedIn) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: st.error, fix: { action: 'codex-signin', label: 'Sign in with ChatGPT' } });
      else if (!st.signedIn) checks.push({ id: 'codex', label: 'Codex', state: 'warn', detail: 'Installed, but not signed in.', fix: { action: 'codex-signin', label: 'Sign in with ChatGPT' } });
      else checks.push({ id: 'codex', label: 'Codex', state: 'ok', detail: `Signed in${st.email ? ` as ${st.email}` : ''}${st.plan ? ` (${st.plan})` : ''}.` });
    }
    return send(res, 200, { checks, prefs: c.prefs, claudeCommand: c.claudeCommand, codex: c.codex, appVersion: APP_VERSION });
  }

  if (route === 'POST /api/chat/upload') return uploadFile(req, res, url);
  if (req.method !== 'POST') throw fail(404, 'Not found.');
  const body = await readBody(req, url.pathname === '/api/chat/send' ? 40 * 1024 * 1024 : url.pathname === '/api/themes/save' ? 6 * 1024 * 1024 : 65536);

  if (url.pathname.startsWith('/api/chat/') && url.pathname !== '/api/chat/rename') return handleChat(req, res, url, body, c);

  switch (url.pathname) {
    case '/api/themes/create': return send(res, 200, themeStudio.create(body));
    case '/api/themes/save': { const theme = themeStudio.save(body); broadcast('themes'); return send(res, 200, { theme }); }
    case '/api/themes/dismiss': themeStudio.dismiss(body.id); return send(res, 200, { ok: true });
    case '/api/themes/delete': themeStudio.remove(body.id); broadcast('themes'); return send(res, 200, { ok: true });
    // Last time's open chats: reopened (each started again, as the account it ran as) or set aside.
    case '/api/reopen': {
      const list = toReopen();
      try { fs.unlinkSync(REOPEN_FILE); } catch { /* already gone */ }
      if (body.action !== 'reopen') return send(res, 200, { reopened: [], failed: [] });
      return send(res, 200, await reopenChats(list.filter(x => !body.only || body.only.includes(x.sessionId)), 'from last time'));
    }
    // Restart now, or once no chat in the window is working or waiting for an OK; or don't after all.
    case '/api/restart': {
      if (!['now', 'idle', 'cancel'].includes(body.when)) throw fail(400, 'Choose now, idle or cancel.');
      if (restartStarting || shuttingDown) throw fail(409, 'Restart is already in progress.');
      if (body.when === 'cancel') { cancelRestart(); return send(res, 200, restartState()); }
      if (body.when === 'idle' && busyChats()) { restartWhenIdle(); return send(res, 200, restartState()); }
      if (!(await restartNow(body.when === 'idle' ? 'nothing was working' : 'from the app'))) throw fail(503, restartError || 'Could not restart. This copy is still running.');
      return send(res, 200, { pending: false, restarting: true });
    }
    case '/api/rules': {
      const paths = rulesPathsFor(body.cwd || null);
      const to = (Array.isArray(body.to) ? body.to : ['claude', 'codex']).filter(k => k === 'claude' || k === 'codex');
      if (!to.length) throw fail(400, 'Save to CLAUDE.md, AGENTS.md or both.');
      rulesLib.writeRules(paths, body.text, to);
      log(`Rules: saved ${to.map(k => path.basename(paths[k])).join(' and ')} ${body.cwd ? `in ${body.cwd}` : 'for every project'}.`);
      return send(res, 200, { scope: body.cwd ? 'project' : 'user', cwd: body.cwd || null, ...rulesLib.readRules(paths) });
    }
    case '/api/tools/copy': return send(res, 200, await copyTool(body.name, body.to, body.cwd || null));
    case '/api/race': {
      if (body.action === 'start') { const r = await startRace(body); return send(res, 200, { id: r.id, races: await racesView() }); }
      const r = raceOf(body.id);
      if (r.state !== 'running') throw fail(409, 'That race is over.');
      // One action at a time per race (a double click, or the PC and the phone at once).
      if (raceBusy.has(r.id)) throw fail(409, 'Still working on that race. Try again in a moment.');
      raceBusy.add(r.id);
      try { return await raceAction(r, body, res); } finally { raceBusy.delete(r.id); }
    }
    case '/api/tasks': {
      if (body.action === 'add') {
        const t = tasksLib.validTask(body.task || {}, { projectAt, accounts: config().accounts });
        taskList.push(t); saveTasks();
        runQueue(t.id).catch(() => {});
        return send(res, 200, { task: t, tasks: tasksView() });
      }
      const t = taskList.find(x => x.id === body.id);
      if (!t) throw fail(404, 'That task isn’t in the queue any more.');
      if (body.action === 'remove') { taskList = taskList.filter(x => x !== t); saveTasks(); return send(res, 200, { tasks: tasksView() }); }
      if (body.action === 'start') {
        if (t.state !== 'queued') throw fail(409, 'That task has already started.');
        await runQueue(t.id, true);
        if (t.state === 'queued') { const why = tasksLib.readyAccount({ ...t, when: 'now' }, queueContext()).why; throw fail(409, why === 'room' ? 'No account has room for it right now; it starts as soon as one does.' : 'No account can start it right now: sign in first.'); }
        return send(res, 200, { task: t, tasks: tasksView() });
      }
      throw fail(400, 'Add, start or remove a task.');
    }
    case '/api/web': {
      if (isCodexAccount(body.account)) {
        const ollama = codexById(body.account).ACCOUNT.kind === 'ollama';
        const r = await sys.openWebProfile(ollama ? 'https://ollama.com/settings' : 'https://chatgpt.com/', body.account);
        if (!r.ok && !r.dryRun) throw fail(500, r.error || 'Couldn’t open a browser window.');
        return send(res, 200, r);
      }
      const a = acc.findAccount(c, body.account);
      const r = await sys.openWebProfile('https://claude.ai/new', a.id);
      if (!r.ok && !r.dryRun) throw fail(500, r.error || 'Couldn’t open a browser window.');
      return send(res, 200, r);
    }
    case '/api/openclaw/archive': {
      const r = await openclaw.archive((Array.isArray(body.ids) && body.ids) || (body.id ? [body.id] : []));
      if (!r.ok) throw fail(500, `OpenClaw couldn’t archive that: ${r.error}`);
      sessionsChanged();
      return send(res, 200, r);
    }
    case '/api/openclaw/send': {
      const r = await openclaw.sendMessage(String(body.id || ''), String(body.text || ''));
      if (!r.ok) throw fail(400, `OpenClaw couldn’t send that: ${r.error}`);
      sessionsChanged();
      return send(res, 200, r);
    }
    case '/api/usage/refresh': {
      if (isCodexAccount(body.account)) { const x = codexById(body.account); if (x) await x.refreshUsage(); return send(res, 200, { usage: usage.snapshot() }); }
      if (!body.account) refreshAllCodexUsage();
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
      const inst = codexById(body.account) || codexActive();
      const st = inst.publicState();
      if (st.installed === false) throw fail(409, 'Codex isn’t installed on this PC yet. Open Setup to install it.', 'codex-missing');
      if (st.kind === 'ollama') {
        // Ollama signs in with its own command; open it in a terminal.
        const r = await sys.runInTerminal(c, os.homedir(), 'Ollama sign-in', sys.IS_WIN ? '@echo off\r\nollama signin\r\n' : '#!/bin/sh\nollama signin\n');
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        return send(res, 200, { ollama: true, ...r });
      }
      const r = await inst.login(body.method === 'code' ? 'code' : 'browser');
      return send(res, 200, r);
    }
    case '/api/codex/login-cancel': { await (codexById(body.account) || codexActive()).cancelLogin(); return send(res, 200, { ok: true }); }
    case '/api/codex/accounts': {
      // Adds a Codex account: another ChatGPT sign-in, or Ollama. Its home shares the main one's chats.
      const name = String(body.name || '').trim();
      const kind = body.kind === 'ollama' ? 'ollama' : 'chatgpt';
      if (!/^[\w .'-]{1,40}$/.test(name)) throw fail(400, 'Use 1–40 letters, numbers, spaces, dots or dashes.');
      const list = c.codexAccounts = (c.codexAccounts || []);
      if ([codex.ACCOUNT.name, ...list.map(x => x.name)].some(n => n.toLowerCase() === name.toLowerCase())) throw fail(400, 'A Codex account with that name already exists.');
      let id = `codex-${codexHomes.slug(name)}`;
      // A home left from an account removed earlier is reused, sign-in and all.
      for (let i = 2; list.some(x => x.id === id); i++) id = `codex-${codexHomes.slug(name)}-${i}`;
      list.push({ id, name, kind });
      c.codexActive = id;
      save();
      const inst = codexById(id);
      const links = codexHomes.ensureHome(inst.ACCOUNT, (c.codex && c.codex.home) || codexHomes.MAIN_HOME());
      log(`Added Codex account ${name} (${kind}) at ${inst.ACCOUNT.home}${links.errors.length ? `; couldn’t link ${links.errors.join('; ')}` : ''}`);
      await inst.refreshAccount().catch(() => null);
      broadcast('accounts');
      return send(res, 200, { codex: codexPublic() });
    }
    case '/api/codex/accounts/remove': {
      // Removes it from the list. Its home (and sign-in) stays on disk, like a removed Claude account.
      const list = c.codexAccounts || [];
      const x = list.find(a => a.id === body.id);
      if (!x) throw fail(404, 'That Codex account isn’t in the list.');
      if (Object.values(chats.live()).some(l => l.accountId === x.id && l.state !== 'ended')) throw fail(409, 'A chat is running as this account. Stop it first.');
      c.codexAccounts = list.filter(a => a.id !== x.id);
      if (c.codexActive === x.id) delete c.codexActive;
      save(); codexAll(); usage.forget(x.id);
      broadcast('accounts');
      return send(res, 200, { codex: codexPublic() });
    }
    case '/api/codex/accounts/rename': {
      const name = String(body.name || '').trim();
      if (!/^[\w .'-]{1,40}$/.test(name)) throw fail(400, 'Use 1–40 letters, numbers, spaces, dots or dashes.');
      const x = (c.codexAccounts || []).find(a => a.id === body.id);
      if (!x) throw fail(404, 'Only added Codex accounts can be renamed.');
      x.name = name; save(); codexAll(); broadcast('accounts');
      return send(res, 200, { codex: codexPublic() });
    }
    case '/api/codex/active': {
      const inst = codexById(body.id);
      if (!inst) throw fail(404, 'That Codex account isn’t in the list.');
      if (inst === codex) delete c.codexActive; else c.codexActive = inst.ACCOUNT.id;
      save();
      inst.refreshAccount().then(st => { if (st.signedIn) inst.refreshUsage(); }).catch(() => {});
      broadcast('accounts');
      return send(res, 200, { codex: codexPublic() });
    }
    case '/api/project/crest': {
      const p = projectAt(body.cwd);
      if (!p || !p.exists) throw fail(404, 'That folder isn’t available.');
      const w = projectInfo.setCrest(p.cwd, body.path || null);
      broadcast('project-art', { cwd: p.cwd });
      return send(res, 200, w);
    }
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
    case '/api/codex/logout': { await (codexById(body.account) || codexActive()).logout(); return send(res, 200, { codex: codexPublic() }); }
    case '/api/codex/check': {
      await Promise.all(codexAll().map(x => x.refreshAccount().catch(() => null)));
      await refreshAllCodexUsage();
      codexSessions(0);
      return send(res, 200, { codex: codexPublic(), usage: usage.snapshot() });
    }
    case '/api/codex/settings': {
      if (typeof body.enabled === 'boolean') c.codex.enabled = body.enabled;
      if (body.command !== undefined) {
        const cmd = String(body.command).trim();
        if (!cmd || /["\r\n%&|<>^]/.test(cmd)) throw fail(400, 'Enter the full path to codex.cmd (or just “codex”).');
        c.codex.command = cmd;
      }
      save();
      for (const x of codexAll()) x.stop();
      setTimeout(() => { if (config().codex.enabled) for (const x of codexAll()) x.refreshAccount().then(st => { if (st.signedIn) x.refreshUsage(); }).catch(() => {}); broadcast('accounts'); broadcast('sessions'); }, 200);
      return send(res, 200, { codex: c.codex });
    }
    case '/api/codex/install': {
      const r = await sys.runInTerminal(c, os.homedir(), 'Install Codex', sys.IS_WIN
        ? '@echo off\r\ntitle Install Codex\r\necho Installing Codex (OpenAI)...\r\ncall npm install -g @openai/codex\r\necho.\r\necho Done. Close this window and click Check again in Session Switcher.\r\n'
        : '#!/bin/sh\necho "Installing Codex (OpenAI)..."\nnpm install -g @openai/codex\necho\necho "Done. Close this window and click Check again in Session Switcher."\n');
      return send(res, 200, r);
    }
    case '/api/open': {
      if (body.provider === 'codex' || isCodexId(body.sessionId)) {
        const inst = codexForThread(body.sessionId, body.account);
        requireCodexSignedIn(inst);
        const mode = body.mode === 'fork' ? 'fork' : 'resume';
        const cx = codexFind(body.sessionId);
        if (!cx) throw fail(404, 'That Codex chat isn’t in the list any more.');
        if (!cx.exists) throw fail(400, `The folder ${cx.cwd} no longer exists, so this chat can’t be opened there.`);
        if (chats.bySession(cx.thread.id) && mode === 'resume') throw fail(409, 'This chat is open in Session Switcher’s chat window. Stop it there first.', 'live');
        const r = await sys.openCodexTerminal(inst.config(), cx.cwd, `${mode} ${cx.thread.id}`, (cx.session && cx.session.title || '').slice(0, 32));
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        sessions.recordLaunch(cx.thread.id, inst.ACCOUNT, mode);
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
        const inst = codexById(body.account) || codexActive();
        requireCodexSignedIn(inst);
        const p = projectAt(body.cwd);
        if (!p) throw fail(404, 'That folder isn’t in the list.');
        if (!p.exists) throw fail(400, `The folder ${p.cwd} no longer exists.`);
        const r = await sys.openCodexTerminal(inst.config(), p.cwd, '', 'New chat');
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
    case '/api/chat/done': {
      // Done (off the lists until it's used again) or not done.
      if (!/^[\w-]{8,80}$/.test(String(body.id || ''))) throw fail(400, 'Which chat?');
      chatPrefs.setDone(String(body.id), !!body.done);
      return send(res, 200, { doneMarks: chatPrefs.doneMarks() });
    }
    case '/api/prefs': {
      const p = c.prefs;
      // Tidy up: chats with nothing new for this many days count as done (0: never).
      if (body.autoDone !== undefined) { const d = Number(body.autoDone); if (![0, 3, 7, 14, 30].includes(d)) throw fail(400, 'Unknown choice.'); p.autoDone = d; }
      if (body.terminal !== undefined) { if (!acc.TERMINALS.includes(body.terminal)) throw fail(400, 'Unknown terminal choice.'); p.terminal = body.terminal; }
      for (const k of ['syncSettings', 'syncState', 'cleanEnv', 'appWindow', 'autoSwitch', 'autoReview']) if (typeof body[k] === 'boolean') p[k] = body[k];
      if (body.openIn !== undefined) { if (!['app', 'terminal'].includes(body.openIn)) throw fail(400, 'Unknown choice.'); p.openIn = body.openIn; }
      if (body.claudeCommand !== undefined) {
        const cmd = String(body.claudeCommand).trim();
        if (!cmd || /["\r\n%&|<>^]/.test(cmd)) throw fail(400, `Enter the full path to ${sys.IS_WIN ? 'claude.exe' : 'claude'} (or just “claude”).`);
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
    case '/api/phone/forget': phone.forget(String(body.id || '')); pushes.forgetDevice(String(body.id || '')); for (const w of appWatchers) if (w.device.id === String(body.id || '')) { appWatchers.delete(w); try { w.res.end(); } catch { /* gone */ } } return send(res, 200, { ...phone.status(), pushPhones: pushes.count() });
    case '/api/quit': {
      send(res, 200, { ok: true });
      log('Quit from the app.');
      chatPrefs.flush();
      phone.stop();
      stopForQuit();
      for (const x of codexAll()) x.stop(true);
      setTimeout(() => process.exit(0), 300);
      return;
    }
  }
  throw fail(404, 'Not found.');
}

// ---------- restart ----------
// A fresh copy of the app takes over from this one. This one notes the open chats and stops them (as
// Quit does) and exits; the new copy waits for it to be gone, takes the port, and reopens those chats.
// The window reconnects by itself. "When replies finish" waits until no chat in the window is
// starting, working or waiting for an OK.
let restartWait = null, restartStarting = false, restartError = null;
const busyChats = () => Object.values(chats.live()).filter(c => ['starting', 'busy', 'waiting'].includes(c.state)).length;
function restartState() { return restartWait ? { pending: true, waitingOn: busyChats(), since: restartWait.since } : { pending: false }; }
async function restartNow(why) {
  if (shuttingDown || restartStarting) return false;
  restartStarting = true; restartError = null;
  log(`Restarting (${why}).`);
  if (restartWait) { clearInterval(restartWait.timer); restartWait = null; }
  try {
    chatPrefs.flush();
    if (!writeOpenChats()) throw new Error('Could not save the open chats.');
    store.writeJsonAtomic(RESTART_FILE, { at: Date.now(), from: process.pid });
    await restartLib.startReplacement({ executable: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), env: { ...process.env, SWITCHER_RESTART_FROM: String(process.pid) } });
  } catch (err) {
    restartStarting = false;
    restartError = `Couldn’t start the new copy: ${err.message}`;
    log(restartError);
    try { fs.unlinkSync(RESTART_FILE); } catch { /* already consumed */ }
    writeOpenChats();
    broadcast('restart', { pending: false, error: restartError });
    return false;
  }
  broadcast('restart', { pending: false, restarting: true });
  chatPrefs.flush();
  phone.stop();
  stopForQuit();
  for (const x of codexAll()) x.stop(true);
  setTimeout(() => process.exit(0), 300);
  return true;
}
function restartWhenIdle() {
  if (restartWait) return;
  let last = -1;
  restartWait = {
    since: Date.now(),
    timer: setInterval(() => {
      const n = busyChats();
      if (!n) return restartNow('replies finished');
      if (n !== last) { last = n; broadcast('restart', restartState()); }
      return undefined;
    }, 1000),
  };
  log('Will restart when replies finish.');
  broadcast('restart', restartState());
}
function cancelRestart() {
  if (!restartWait) return;
  clearInterval(restartWait.timer); restartWait = null;
  log('Restart called off.');
  broadcast('restart', restartState());
}
// The app's files changed since it started (an update, say): a restart would bring in the new version.
let diskBuild = { at: 0, id: BUILD };
function newBuildReady() {
  if (Date.now() - diskBuild.at > 20000) diskBuild = { at: Date.now(), id: handover.buildId(APP_DIR) };
  return diskBuild.id !== BUILD;
}
setInterval(() => { const was = diskBuild.id !== BUILD; if (newBuildReady() !== was) broadcast('update', { ready: !was }); }, 60000).unref();
// Reopens chats (each started again, resuming its conversation, as the account it ran as).
async function reopenChats(list, what) {
  const reopened = [], failed = [];
  for (const c of list) {
    try {
      if (chats.bySession(c.sessionId)) { reopened.push(c.sessionId); continue; }
      await openChat(config(), { account: c.accountId, sessionId: c.sessionId, mode: 'resume', provider: c.provider, force: true });
      reopened.push(c.sessionId);
    } catch (err) { failed.push({ sessionId: c.sessionId, title: c.title, error: err.message }); }
  }
  log(`Reopened ${reopened.length} chat${reopened.length === 1 ? '' : 's'} ${what}${failed.length ? `; ${failed.length} couldn’t` : ''}.`);
  return { reopened, failed };
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
  // The name is reserved as it's chosen (two of the same name at once get two names), and each has
  // a temporary file of its own while it arrives.
  let dest = null;
  for (let i = 1; !dest && i < 1000; i++) {
    const cand = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    try { fs.closeSync(fs.openSync(cand, 'wx')); dest = cand; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  if (!dest) throw fail(409, 'Too many files with that name today.');
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
  const unreserve = () => fs.unlink(dest, () => {});
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let got = 0;
    const failUpload = (status, msg) => { log(`Attach failed for ${name}: ${msg}`); fs.unlink(tmp, () => {}); unreserve(); reject(fail(status, msg)); };
    req.on('data', c => { got += c.length; if (got > UPLOAD_MAX) { req.destroy(); out.destroy(); failUpload(413, 'Files up to 2 GB can be attached.'); } });
    req.on('aborted', () => { out.destroy(); log(`Attach of ${name} was interrupted after ${Math.round(got / 1024)} KB.`); fs.unlink(tmp, () => {}); unreserve(); resolve(); });
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
    return require('stream').pipeline(fs.createReadStream(f.path, { start, end }), res, () => {});
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  return require('stream').pipeline(fs.createReadStream(f.path), res, () => {});
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
    case '/api/chat/open': return send(res, 200, await openChat(c, body));
    case '/api/chat/attach': return send(res, 200, attachedInfo(chats.get(body.key)));
    case '/api/chat/send': {
      // to: 'partner' (the other assistant in this chat, started if need be), 'both' (they take
      // turns), or the chat `key` itself.
      let text = typeof body.text === 'string' ? body.text.slice(0, 200000) : '';
      const images = validImages(body.images);
      if (!text.trim() && !images.length) throw fail(400, 'Type a message or attach an image.');
      const chat = chats.get(body.key), lead = pairs.leadOf(chat);
      // "@chat[…]": other chats you brought in; their latest messages go along, before your words.
      if (Array.isArray(body.refs) && body.refs.length) text = (await Promise.all(body.refs.slice(0, 3).map(otherChatBlock))).join('') + text;
      if (body.to === 'both') { await pairs.sendBoth(lead, text, images, { accountId: body.account }); return send(res, 200, { ok: true }); }
      if (body.to === 'plan') { await pairs.planFirst(lead, text, images, { accountId: body.account }); return send(res, 200, { ok: true }); }
      const target = body.to === 'partner' ? await pairs.ensure(lead, { accountId: body.account }) : chat;
      // after: wait for the other one to finish first (you chose "Send when it's done").
      await (body.after ? pairs.sendAfter(target, text, images) : pairs.send(target, text, images));
      return send(res, 200, { ok: true, key: target.key });
    }
    case '/api/run': {
      // Run, stop or restart a project, or set the command it runs with.
      const p = projectAt(body.cwd);
      if (!p || !p.exists) throw fail(404, 'Pick one of your projects.');
      if (body.command !== undefined) runner.setCommand(p.cwd, body.command);
      if (body.action === 'stop') return send(res, 200, await runner.stop(p.cwd));
      if (body.action === 'restart') { await runner.stop(p.cwd); return send(res, 200, runner.start(p.cwd)); }
      if (body.action === 'start') return send(res, 200, runner.start(p.cwd));
      return send(res, 200, runner.status(p.cwd));
    }
    case '/api/chat/branch': {
      // A new chat from one of this chat's replies (lib/branch.js); the original stays as it is.
      const id = String(body.sessionId || '');
      if (isCodexId(id)) throw fail(400, 'Branching works for Claude chats.');
      let f;
      try { f = sessions.find(id); } catch { throw fail(404, 'That chat’s file wasn’t found.'); }
      const r = branchSession(sessions.fileFor(id), String(body.mid || ''), crypto.randomUUID());
      try { sessions.rename(r.id, `↳ ${f.session.title || 'Branch'}`.slice(0, 120)); } catch { /* keeps its first message as its name */ }
      sessionsChanged();
      log(`Branched chat ${id} into ${r.id} (${r.lines} lines).`);
      return send(res, 200, { sessionId: r.id });
    }
    case '/api/chat/aside': {
      // A side question: a separate chat in the same project that can only look (Claude's plan mode,
      // Codex's read-only), told the chat's latest messages, so the chat itself isn't derailed.
      const lead = pairs.leadOf(chats.get(body.key));
      const q = typeof body.text === 'string' ? body.text.trim().slice(0, 20000) : '';
      if (!q) throw fail(400, 'Type your question.');
      const prov = lead.provider === 'codex' ? 'codex' : 'claude';
      const ctx = lead.sessionId ? await otherChatBlock({ id: lead.sessionId }).catch(() => '') : '';
      const info = await openChat(config(), { account: prov === 'codex' ? null : lead.account.id, cwd: lead.cwd, mode: 'new', provider: prov, permissionMode: prov === 'codex' ? 'read-only' : 'plan' });
      const aside = chats.get(info.key);
      aside.aside = true; aside.title = `Aside: ${q.split('\n')[0].slice(0, 50)}`;
      broadcast('live', chats.live()); scheduleActivity();
      await waitReady(aside, 45000);
      if (aside.sessionId) chatPrefs.setDone(aside.sessionId, true);   // in case its id came before it was marked a side question
      aside.send(`${ctx.replace('its latest messages, for context (that chat carries on separately)', 'its latest messages, for context. This is a quick side question about it, asked beside that chat; answer it briefly and don’t change any files')}${q}`, []);
      return send(res, 200, { key: aside.key, provider: prov });
    }
    case '/api/chat/aside-end': {
      // Closed: the side chat stops, and is set aside as done (it's still there, under Done).
      let aside = null; try { aside = chats.get(body.key); } catch { return send(res, 200, { ok: true }); }
      if (!aside.aside) throw fail(400, 'That isn’t a side question.');
      if (aside.sessionId) chatPrefs.setDone(aside.sessionId, true);
      await aside.stop().catch(() => {});
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
    case '/api/chat/compact': await chats.get(body.key).compact(); return send(res, 200, { ok: true });
    case '/api/chat/undo': {
      const chat = chats.get(body.key), r = await chat.undoTurn(body.turn, !!body.force);
      if (r && r.restored && r.restored.length) {
        (chat.undoneFiles || (chat.undoneFiles = [])).push(r.restored);
        // Its partner hears too: it may have built on what's gone.
        const mate = pairs.partnerOf(chat);
        if (mate) (mate.partnerUndone || (mate.partnerUndone = [])).push(r.restored);
      }
      return send(res, 200, r);
    }
    case '/api/chat/review': return send(res, 200, await startReview(chats.get(body.key), body.files, body.base, ['claude', 'both'].includes(body.by) ? body.by : 'codex'));
    // stop: stop after the current step; otherwise start, from a finished review with findings.
    case '/api/chat/resume-at': return send(res, 200, resumeAt(chats.get(body.key), String(body.at || ''), !!body.cancel));
    case '/api/chat/review-loop': {
      const chat = chats.get(body.key);
      if (body.stop) return send(res, 200, reviewLoop.stop(chat));
      const r = body.review || {};
      const findings = Array.isArray(r.findings) ? r.findings.slice(0, 40) : [];
      reviewLoop.start(chat, { id: String(r.id || ''), what: String(r.what || ''), base: r.base ? String(r.base) : null, findings, files: Array.isArray(body.files) ? body.files : [] });
      return send(res, 200, { ok: true });
    }
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
      // The other assistant, working inside this chat (Codex in a Claude chat, Claude in a Codex chat).
      const lead = pairs.leadOf(chats.get(body.key));
      return send(res, 200, (await pairs.ensure(lead, { accountId: body.account })).info());
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
        const inst = codexById(chat.account && chat.account.id) || codexActive();
        const r = await sys.openCodexTerminal(inst.config(), chat.cwd, `resume ${id}`, String(chat.title || '').slice(0, 32));
        if (!r.ok && !r.dryRun) throw fail(500, `Couldn’t open a terminal: ${r.error}`);
        sessions.recordLaunch(id, inst.ACCOUNT, 'resume');
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
  return { ...chat.info(), attached: true, companionThread: chat.sessionId && !chat.parentKey ? chatPrefs.companionOf(chat.sessionId) : null };
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
  // The end of the replay, so a window opening both of a duo's chats can put the two in time order.
  res.write('event: replayed\ndata: {}\n\n');
  chat.clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(ping); chat.clients.delete(res); });
}

// ---------- http ----------

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'";

// Serves the app. Phone access (lib/remote.js) checks the phone's pairing first, then calls this
// with remote = true; the PC's own window only ever comes through 127.0.0.1.
async function handleRequest(req, res, { remote = false } = {}) {
  const host = req.headers.host || '';
  if (!remote && host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.writeHead(403); return res.end('Forbidden'); }
  const fwd = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (req.headers.origin && (remote ? (req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}` && !(fwd && req.headers.origin === `https://${fwd}`)) : !ORIGINS.has(req.headers.origin))) { res.writeHead(403); return res.end('Forbidden'); }
  let url;
  try { url = new URL(req.url, `http://${host}`); } catch { res.writeHead(400); return res.end('Bad request'); }
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').replace('__TOKEN__', TOKEN).replace('__REMOTE__', remote ? 'true' : 'false');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(html);
    }
    // Fonts and their licence, sound cues and the themes' paintings (art/, WebP only; their originals in art/src/ stay unserved).
    if (req.method === 'GET' && /^\/(fonts\/(?:[a-z0-9-]+\.woff2|OFL\.txt)|sounds\/[a-z0-9-]+\.mp3|art\/[a-z0-9-]+\.webp)$/.test(url.pathname)) {
      let data;
      try { data = fs.readFileSync(path.join(APP_DIR, url.pathname.slice(1))); } catch { res.writeHead(404); return res.end(); }
      const ext = path.extname(url.pathname);
      res.writeHead(200, { 'Content-Type': ext === '.mp3' ? 'audio/mpeg' : ext === '.webp' ? 'image/webp' : ext === '.txt' ? 'text/plain; charset=utf-8' : 'font/woff2', 'Cache-Control': 'max-age=604800', 'X-Content-Type-Options': 'nosniff' });
      return res.end(data);
    }
    const STATIC = { '/theme.js': 'text/javascript', '/styles.css': 'text/css', ...(remote ? { '/sw.js': 'text/javascript' } : {}) };
    const type = STATIC[url.pathname] || (/^\/ui\/[a-z0-9-]+\.js$/.test(url.pathname) ? 'text/javascript' : null);
    if (req.method === 'GET' && type) {
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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
    // Asked by a copy that's starting up: is this the same app and the same code? Nothing private.
    if (req.method === 'GET' && url.pathname === '/api/version') return send(res, 200, { app: 'session-switcher', version: APP_VERSION, build: BUILD, pid: process.pid });
    if (url.pathname.startsWith('/api/')) {
      // Images shown with <img> can't send headers, so that one read-only route also takes the token in the URL.
      const imageGet = req.method === 'GET' && (url.pathname === '/api/image' || url.pathname === '/api/media' || url.pathname === '/api/themes/art') && url.searchParams.get('token') === TOKEN;
      if (imageGet && url.pathname === '/api/media') return sendMedia(req, res, url);
      // The notification's buttons and the Android app's connection have no page token: the phone's
      // pairing (and, for Allow/Deny, a one-time token) is what lets them in.
      const pushAct = remote && req.device && ((req.method === 'POST' && (url.pathname === '/api/push/act' || url.pathname === '/api/push/reply')) || (req.method === 'GET' && url.pathname === '/api/notify/stream'));
      if (req.headers['x-switcher-token'] !== TOKEN && !imageGet && !pushAct) return send(res, 403, { error: 'This page is out of date. Reload it.', reason: 'stale' });
      return await handleApi(req, res, url, remote);
    }
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    if (!err.status || err.status >= 500) log(`Error on ${req.method} ${url.pathname}: ${err.stack || err.message}`);
    // The app's own messages are written for you; a slip inside (a missing file, a code error) isn't, so it
    // says so plainly (the details are in switcher.log).
    const internal = !err.status && (err.code || err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError);
    if (!res.headersSent) send(res, err.status || 500, { error: internal ? 'Something went wrong on the PC. The details are in switcher.log; trying again usually helps.' : err.message, reason: err.reason });
  }
  return undefined;
}
const server = http.createServer((req, res) => { handleRequest(req, res); });

// Phone access: off unless turned on in Setup.
const phone = remoteLib.createRemote({ dataDir: DATA_DIR, appDir: APP_DIR, version: APP_VERSION, log, getPrefs: () => config().prefs, handle: handleRequest });

// ---------- notifications on phones (lib/push.js; the phone's side: the Android app, sw.js, ui/push.js) ----------
const pushes = pushLib.createPush({ dataDir: DATA_DIR, log });
pushes.keepDevices(phone.status().devices.map(d => d.id));
const pushSeen = { map: new Map(), primed: false };
// Allow/Deny on a notification: one-time tokens, each for one request, for an hour.
const pushActs = new Map();
// Reply from a notification: one-time tokens, each for one chat, for six hours.
const pushReplies = new Map();
setInterval(() => { const now = Date.now(); for (const m of [pushActs, pushReplies]) for (const [k, v] of m) if (v.exp < now) m.delete(k); }, 5 * 60e3).unref();
// The single question a chat is asking (its text and choices), if that's what it waits on.
function questionOf(key, requestId) {
  try {
    const p = chats.get(key).pending.get(requestId);
    const qs = p && p.event && p.event.questions;
    return qs && qs.length === 1 && qs[0].options ? qs[0] : null;
  } catch { return null; }
}
let pushTimer = null;
function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; sendPushes().catch(err => log(`Push: ${err.message}`)); }, 900);
}
const chatTitleOf = x => {
  if (x.parentKey) { try { const p = chats.get(x.parentKey); return `Codex · ${chatTitleOf(p.summary())}`; } catch { /* gone */ } }
  if (x.sessionId && x.provider !== 'codex') { try { const t = sessions.find(x.sessionId).session.title; if (t) return t; } catch { /* not saved yet */ } }
  return x.title || 'A chat';
};
const pushLine = t => String(t || '').replace(/`{3}[\s\S]*?(`{3}|$)/g, ' ').replace(/[*_#>`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || '';
function wantsToText(p) {
  if (p.question) return 'Has a question for you';
  if (p.detail) return `Wants to run: ${p.detail}`;
  return p.summary ? `Wants to ${p.toolName === 'Edit' || p.toolName === 'Write' ? 'edit' : 'use'}: ${p.summary}` : `Wants to use ${p.toolName || 'a tool'}`;
}
// The Android apps connected right now (each listens on /api/notify/stream while on your Wi-Fi).
const appWatchers = new Set();   // { res, device }
// You wrote to this chat (or its partner) in the last three hours: its replies are ones you're waiting for.
const RECENT_MS = 3 * 3600e3;
function yourRecentOf(x) {
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const wrote = c => { try { const ch = chats.get(c); return ch.buffer.some(e => e.kind === 'user' && e.local && (e.at || '') >= since); } catch { return false; } };
  return wrote(x.key) || (x.parentKey ? wrote(x.parentKey) : false);
}
const sidOf = x => (x.parentKey ? (() => { try { return chats.get(x.parentKey).sessionId; } catch { return null; } })() : x.sessionId);
// One notification's message. id tells the phone whether it has shown this one already.
function pushMessage(n, now = Date.now()) {
  const x = n.chat;
  if (n.kind === 'clear') return { kind: 'clear', tag: `needs-${x.key}`, key: x.key, at: now };
  const title = chatTitleOf(x), folder = x.folder ? ` · ${x.folder}` : '';
  if (n.kind === 'needs') {
    const p = n.pending;
    let act = null, choices = null, body = wantsToText(p);
    if (!p.question) { act = crypto.randomBytes(18).toString('base64url'); pushActs.set(act, { key: x.key, requestId: p.requestId, exp: now + 3600e3 }); }
    else {
      // One question with a few answers: each answer is a button on the notification.
      const q = questionOf(x.key, p.requestId);
      if (q) {
        body = q.question;
        if (!q.multiSelect && q.options.length >= 2 && q.options.length <= 3) {
          choices = q.options.map(o => { const t = crypto.randomBytes(18).toString('base64url'); pushActs.set(t, { key: x.key, requestId: p.requestId, answers: { [q.question]: o.label }, exp: now + 3600e3 }); return { label: o.label.slice(0, 40), token: t }; });
        }
      }
    }
    return { kind: 'needs', id: `${x.key}:${p.requestId}`, title: `${title} needs you`, body: String(body).slice(0, 220), chatTitle: title, tag: `needs-${x.key}`, key: x.key, sessionId: x.sessionId || null, act, choices, at: now, ttl: 3600 };
  }
  // A reply can be answered from the notification: a token for that chat, for six hours.
  const reply = crypto.randomBytes(18).toString('base64url');
  pushReplies.set(reply, { key: x.key, exp: now + 6 * 3600e3 });
  return { kind: 'reply', reply, who: x.provider === 'codex' ? 'Codex' : 'Claude', id: `${x.key}:${x.finishedAt}`, title: `${title} replied`, body: (pushLine(x.lastText) || 'Finished its turn.').slice(0, 200) + folder, chatTitle: title, tag: `reply-${x.key}`, key: x.key, sessionId: x.sessionId || null, at: now, ttl: 6 * 3600 };
}
const toApp = (w, msg) => { try { w.res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch { /* gone; its close handler tidies up */ } };
async function sendPushes() {
  const fresh = pushLib.news(chats.summaries(), pushSeen);
  if (!fresh.length || (!pushes.count() && !appWatchers.size)) return;
  const now = Date.now();
  for (const [k, v] of pushActs) if (v.exp < now) pushActs.delete(k);
  for (const [k, v] of pushReplies) if (v.exp < now) pushReplies.delete(k);
  for (const n of fresh) {
    const msg = pushMessage(n, now);
    // Per phone: its alert level for the chat (a partner goes by its chat), and its quiet hours.
    const recent = n.kind === 'reply' ? yourRecentOf(n.chat) : true;
    const want = prefs => msg.kind === 'clear' || pushLib.wants(prefs, { kind: n.kind, sessionId: sidOf(n.chat), yourRecent: recent });
    for (const w of appWatchers) if (want(pushes.appPrefs(w.device.id))) toApp(w, msg);
    if (msg.kind !== 'clear' && pushes.count()) await pushes.notify(msg, want);
  }
}
// What's waiting right now, for an app that has just connected (back on your Wi-Fi): approvals, and
// replies since it last heard.
function waitingNow(since) {
  const out = [];
  for (const x of chats.summaries()) {
    if (!x.key || x.aside) continue;   // as live: side questions never notify
    for (const p of x.pending || []) out.push({ kind: 'needs', chat: x, pending: p });
    if (x.phase === 'idle' && x.finishedAt && x.finishedAt > since && !(x.pending || []).length) out.push({ kind: 'reply', chat: x });
  }
  return out;
}
async function pushApi(req, res, route, remote) {
  const dev = remote ? req.device : null;
  // The Android app's connection: notifications as they happen, while it's on your Wi-Fi.
  if (route === 'GET /api/notify/stream') {
    if (!dev) throw fail(403, 'Only a paired phone listens here.');
    const since = Math.max(0, Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const w = { res, device: dev };
    res.write(`retry: 5000\ndata: ${JSON.stringify({ kind: 'hello', pc: os.hostname(), at: Date.now() })}\n\n`);
    const prefs = pushes.appPrefs(dev.id);
    for (const n of waitingNow(since)) if (pushLib.wants(prefs, { kind: n.kind, sessionId: sidOf(n.chat), yourRecent: n.kind === 'reply' ? yourRecentOf(n.chat) : true })) toApp(w, { ...pushMessage(n), catchUp: true });
    appWatchers.add(w);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(ping); appWatchers.delete(w); });
    return undefined;
  }
  const body = req.method === 'POST' ? await readBody(req) : {};
  if (route === 'GET /api/push') return send(res, 200, { key: pushes.publicKey(), phone: !!dev, subscribed: dev ? pushes.count(dev.id) > 0 : false, phones: pushes.count() });
  if (route === 'POST /api/push/act') {
    const a = pushActs.get(String(body.token || ''));
    if (!a || !dev || a.exp < Date.now()) throw fail(410, 'That one was already answered, or has expired.');
    pushActs.delete(String(body.token));
    const decision = body.decision === 'allow' ? 'allow' : 'deny';
    let chat;
    try { chat = chats.get(a.key); } catch { throw fail(410, 'That chat has stopped.'); }
    if (!chat.pending.has(a.requestId)) throw fail(410, 'That one was already answered.');
    // The other buttons on the same notification go with it.
    for (const [k, v] of pushActs) if (v.key === a.key && v.requestId === a.requestId) pushActs.delete(k);
    if (a.answers) chat.answer(a.requestId, { decision: 'allow', message: '', answers: a.answers });
    else chat.answer(a.requestId, { decision, message: '' });
    log(`Push: “${dev.name}” ${a.answers ? 'answered a question' : `chose ${decision}`} from a notification.`);
    return send(res, 200, { ok: true });
  }
  // Reply from a notification: your words go to that chat, caught up as usual (lib/pairs.js).
  if (route === 'POST /api/push/reply') {
    const a = pushReplies.get(String(body.token || ''));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 20000) : '';
    if (!a || !dev || a.exp < Date.now()) throw fail(410, 'That reply can’t be sent any more. Open the chat to answer.');
    if (!text) throw fail(400, 'Type a reply.');
    let chat;
    try { chat = chats.get(a.key); } catch { throw fail(410, 'That chat has stopped. Open it to answer.'); }
    if (chat.state === 'ended') throw fail(410, 'That chat has stopped. Open it to answer.');
    pushReplies.delete(String(body.token));
    await pairs.send(chat, text, []);
    log(`Push: “${dev.name}” replied from a notification.`);
    return send(res, 200, { ok: true });
  }
  if (!dev) throw fail(403, 'Turn notifications on from the phone itself.');
  if (route === 'POST /api/notify/prefs') { pushes.setAppPrefs(dev.id, body.prefs || {}); return send(res, 200, { ok: true }); }
  if (route === 'POST /api/notify/test') {
    let n = 0;
    for (const w of appWatchers) if (w.device.id === dev.id) { toApp(w, { kind: 'test', id: `test:${Date.now()}`, title: 'Session Switcher', body: 'Notifications work on this phone.', tag: 'test', at: Date.now() }); n++; }
    return send(res, 200, { ok: n > 0, why: n ? null : 'The app isn’t connected for notifications yet. Turn them on, and give it a moment.' });
  }
  const sub = body.subscription || {};
  if (route === 'POST /api/push/subscribe') { pushes.subscribe(dev.id, sub, body.prefs || {}); log(`Push: notifications on for “${dev.name}”.`); return send(res, 200, { ok: true }); }
  if (route === 'POST /api/push/prefs') return send(res, 200, { ok: pushes.setPrefs(dev.id, String(body.endpoint || ''), body.prefs || {}) });
  if (route === 'POST /api/push/unsubscribe') { pushes.unsubscribe(dev.id, String(body.endpoint || '')); return send(res, 200, { ok: true }); }
  if (route === 'POST /api/push/test') {
    const out = await pushes.notify({ kind: 'test', title: 'Session Switcher', body: 'Notifications work on this phone.', tag: 'test', at: Date.now(), ttl: 300 }, (p, sb) => sb.deviceId === dev.id);
    const ok = out.some(o => o.status >= 200 && o.status < 300);
    return send(res, 200, { ok, why: ok ? null : out.length ? `The push service said ${out[0].status || 'nothing'}.` : 'This phone isn’t signed up for notifications.' });
  }
  throw fail(404, 'Not found.');
}

// ---------- Tailscale: the phone's secure (https) address, which push notifications need ----------
const TS_EXE = process.platform === 'win32' ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'), 'tailscale'] : ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
function tailscale(args, timeout = 8000) {
  const { execFile } = require('child_process');
  const tryAt = i => new Promise(resolve => {
    if (i >= TS_EXE.length) return resolve({ ok: false, missing: true, out: '' });
    execFile(TS_EXE[i], args, { timeout, windowsHide: true }, (err, out, errOut) => {
      if (err && err.code === 'ENOENT') return resolve(tryAt(i + 1));
      resolve({ ok: !err, out: String(out || '') + String(errOut || ''), timedOut: !!(err && err.killed) });
    });
  });
  return tryAt(0);
}
async function tailscaleStatus() {
  const port = phone.status().port;
  const st = await tailscale(['status', '--json']);
  if (st.missing) return { installed: false };
  let j = {};
  try { j = JSON.parse(st.out.slice(st.out.indexOf('{'))); } catch { /* not running */ }
  const self = j.Self || {};
  const dns = String(self.DNSName || '').replace(/\.$/, '');
  const serve = await tailscale(['serve', 'status', '--json']);
  const serving = serve.ok && new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(serve.out);
  return { installed: true, running: j.BackendState === 'Running', dns, url: dns ? `https://${dns}` : null, serving, port };
}
async function tailscaleServe() {
  const port = phone.status().port;
  if (!phone.status().listening) throw fail(409, 'Turn phone access on first.');
  const r = await tailscale(['serve', '--bg', `http://127.0.0.1:${port}`], 20000);
  if (r.missing) throw fail(409, 'Tailscale isn’t installed on this PC.');
  // HTTPS certificates are off for this tailnet: Tailscale gives a link to turn them on.
  const link = (r.out.match(/https:\/\/login\.tailscale\.com\/\S+/) || [])[0] || null;
  if (link) return { ...(await tailscaleStatus()), enable: link };
  if (!r.ok) throw fail(500, `Tailscale couldn’t set it up: ${r.out.trim().split(/\r?\n/).slice(-3).join(' ')}`);
  log(`Phone access: Tailscale now serves it over https (port ${port}).`);
  return await tailscaleStatus();
}

const appUrl = `http://127.0.0.1:${PORT}/`;
const openRunning = () => { console.log(`Already running at ${appUrl}. Opening it.`); sys.openAppWindow(appUrl, config().prefs).finally(() => setTimeout(() => process.exit(0), 800)); };
let handedOver = false;
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && !handedOver) {
    // Something is on the port. If it's this same build, bring its window up. If it's an older
    // copy, or one started before an update, replace it, so the window isn't stuck on old code.
    handedOver = true;
    handover.takeOver({ port: PORT, version: APP_VERSION, build: BUILD, appDir: APP_DIR, sys, log })
      .then(next => {
        if (next === 'start') return server.listen(PORT, '127.0.0.1');
        if (next === 'busy') log(`Another program is using port ${PORT}. Close it, or set SWITCHER_PORT to start Session Switcher on a different port.`);
        return openRunning();
      })
      .catch(e => { log(`Couldn’t check the copy that’s running: ${e.message}`); openRunning(); });
  } else if (err.code === 'EADDRINUSE') {
    openRunning();
  } else {
    log(`Server error: ${err.stack || err.message}`);
    process.exit(1);
  }
});
process.on('uncaughtException', err => log(`Unexpected error: ${err.stack || err.message}`));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopForQuit(); for (const x of codexAll()) { try { x.stop(true); } catch { /* not running */ } } setTimeout(() => process.exit(0), 300); });
process.on('exit', () => { stopForQuit(); try { chatPrefs.flush(); } catch { /* best effort */ } handover.clearLock(PORT, process.pid); });
process.on('unhandledRejection', err => log(`Unexpected error: ${err && (err.stack || err.message)}`));

// Started by Restart: the copy being replaced is still exiting, so wait for it (up to 20 s) first.
const restartFrom = Number(process.env.SWITCHER_RESTART_FROM) || 0;
delete process.env.SWITCHER_RESTART_FROM;
function replacedGone() {
  const until = Date.now() + 20000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let alive = true;
      try { process.kill(restartFrom, 0); } catch (err) { alive = err.code === 'EPERM'; }
      if (!alive) return setTimeout(resolve, 150);
      if (Date.now() > until) return reject(new Error('The previous copy did not exit; leaving it running.'));
      return setTimeout(tick, 120);
    };
    tick();
  });
}
if (restartFrom && process.send) process.send({ type: restartLib.READY, pid: process.pid });
(restartFrom ? replacedGone() : Promise.resolve()).then(() => server.listen(PORT, '127.0.0.1', () => {
  log(`Session Switcher ${APP_VERSION} running at ${appUrl}${sys.DRY_RUN ? ' (preview mode: nothing is launched)' : ''}${restartFrom ? ' (restarted)' : ''}`);
  handover.writeLock(PORT, { pid: process.pid, version: APP_VERSION, build: BUILD, dir: APP_DIR, token: TOKEN });
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
  const accountsIn = pollAccounts(0);
  accountsIn.then(() => setTimeout(() => refreshAllUsage(0), 1500));
  if (restarted && restarted.chats.length) accountsIn.then(() => reopenChats(restarted.chats, 'after the restart')).catch(err => log(`Couldn’t reopen chats after the restart: ${err.message}`));
  if (config().codex.enabled) setTimeout(() => {
    codex.refreshAccount().then(() => codexSessions(0)).catch(() => {});
    for (const x of codexAll()) x.refreshAccount().then(st => { if (st.signedIn) x.refreshUsage(); }).catch(() => {});
  }, 2500);
  startWatching();
  phone.sync().catch(err => log(`Phone access: ${err.message}`));
  // After a restart the window that was open reconnects by itself.
  if (!restartFrom) sys.openAppWindow(appUrl, config().prefs);
})).catch(err => { log(`Couldn’t take over after restart: ${err.message}`); process.exit(1); });
