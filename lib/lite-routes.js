'use strict';
// The /api/lite/* routes for Switcher Lite. The server passes in what it already has (its config,
// accounts, usage, Codex accounts, chat list, live chats, routines), so this stays a thin layer:
// it reads those, adds lite.json on top, and never changes how the full app works.

const fs = require('fs');
const path = require('path');
const os = require('os');
const lite = require('./lite');
const { createLiteOps } = require('./lite-ops');
const { createLiteImages } = require('./lite-images');
const { createGuesser, looksLikePrompt, genericTitle } = require('./lite-guess');
const { createSignin } = require('./lite-signin');
const { createModels } = require('./lite-models');
const { createOllamaAccount } = require('./ollama-account');
const desktop = require('./desktop');
const { createDesktopNames } = require('./lite-desktop-names');
const { createLiteRoutines, withSuffix, stripSuffix, ESCALATE_PROMPT } = require('./lite-routines');
const { createPipeline } = require('./lite-pipeline');
const { createWaits } = require('./lite-waits');
const { createTokens, tokensView, chatSizes, isSmallChat, isOngoingChat } = require('./lite-tokens');

const DAY = 864e5;
const KEEP_DAYS = 120;          // chats older than this (and untouched by you) stay out of the lite lists
// A routine run's title: "<routine name> · Oct 11, 9:33 AM".
const RUN_TITLE = / · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/;
const WORKING = new Set(['thinking', 'writing', 'tool', 'starting']);
// A chat here that's on a turn but hasn't said or done anything yet (a queued message just went, or it's
// waiting on a background agent it started) is working too: its last step was the end of the one before.
// Background work that isn't work: a watch on an artifact the chat published (Claude Code arms one
// on every publish, for comments and edits), which stays up for as long as the chat runs. Counting
// it kept finished chats "working" for hours, so they blinked instead of showing they'd replied.
const WATCH_ONLY = /^live updates for artifact\b/i;
const realBackground = x => (x.background || []).filter(d => !WATCH_ONLY.test(String(d)));
const busyIdle = x => x.source === 'app' && (x.state === 'busy' || x.state === 'starting') && (x.phase === 'idle' || !x.phase) && !(x.pending || []).length;
// Chats from the desktop app with no project, and ones run in temp folders, gather under "No folder".
const LOOSE = /scratch-workspaces|^\/private\/(tmp|var)\/|^\/tmp\/|^\/var\/folders\/|[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i;
const LOOSE_KEY = '~loose';
// Quick: a project of odds and ends. Its chats run in their own folders, wherever those are.
const QUICK_KEY = '~quick';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const one = (s, n = 200) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const fail = (status, message) => Object.assign(new Error(message), { status });

function createLiteRoutes(ctx) {
  const { store, config, acc, usage, codexAll, sessionsWithCodex, activityList, routinesList, parentOf, isCommanderId, broadcast, log, dataDir, codexMainHome, codexHomeFor } = ctx;
  const ops = createLiteOps({ dataDir, log, store });
  const signin = createSignin({ log, config, acc, overrideVars: ctx.overrideVars || [], afterSignIn: ctx.afterSignIn || (() => {}) });
  const ollamaAcct = createOllamaAccount({ log });
  const desktopNames = createDesktopNames({ store, desktop, log });
  // A routine's bug chat runs on the use-next Claude plan (else the main account), in your permission default.
  const escalationAccount = (family = 'claude') => {
    try { const o = lite.useNextOrder(plansNow(), store.get().plans.floor, Date.now(), store.get().plans.preferred); const list = family === 'codex' ? o.chatgpt : o.claude; if (list && list[0]) return list[0]; } catch { /* below */ }
    if (family === 'codex') return 'codex';
    const c = config(); return ((c.accounts || []).find(a => a.isDefault) || (c.accounts || [])[0] || {}).id;
  };
  const pipeline = createPipeline({ log, lastReply: (id, provider) => (ctx.lastReply ? ctx.lastReply(id, provider) : Promise.resolve('')), recentReplies: ctx.recentReplies || null });
  const liteRoutines = createLiteRoutines({
    store, routinesList, log, broadcast, escalationAccount,
    lastReply: (id, provider) => (ctx.lastReply ? ctx.lastReply(id, provider) : Promise.resolve('')),
    // The bug chat starts in the routine's own mode if it set one, else your default for that
    // assistant (a Codex chat takes Codex's modes: it didn't know Claude's "bypassPermissions" and
    // fell back to asking before every command).
    startEscalation: opts => {
      const codexChat = !!(codexAll() || []).find(x => x.ACCOUNT && x.ACCOUNT.id === opts.account);
      const perms = store.get().permissions || {};
      const fallback = codexChat ? (perms.codex || 'full') : (perms.claude || 'default');
      const ok = codexChat ? ['ask', 'agent', 'read-only', 'full'] : ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'];
      return ctx.startEscalation({ ...opts, permissionMode: ok.includes(opts.permissionMode) ? opts.permissionMode : fallback });
    },
    notify: (kind, payload) => ops.notify(kind, payload),
    nameChat: (chat, title) => (ctx.nameChat ? ctx.nameChat(chat, title) : Promise.resolve()),
  });
  const waits = createWaits({
    dataDir, log, broadcast, notify: (kind, payload) => ops.notify(kind, payload), chats: () => stateView().chats,
    recentReplies: (id, provider) => (ctx.recentReplies ? ctx.recentReplies(id, provider) : ctx.lastReply ? ctx.lastReply(id, provider) : Promise.resolve('')),
  });
  const models = createModels({ config, acc, codexAll, geminiModels: ctx.geminiModels, overrideVars: ctx.overrideVars || [], log });
  const guesser = createGuesser({ store, log, chats: () => stateView().chats, context: ctx.titleContext, changed: () => broadcast('lite', {}), working: () => new Set(liveView().filter(x => x.working && x.sessionId).map(x => String(x.sessionId).toLowerCase())), ongoing: id => isOngoingChat(sizes().get(String(id).toLowerCase())) });
  // Each chat's real size (remade when the token count updates).
  let sizesOf = { led: null, map: new Map() };
  function sizes() { const led = tokens.ledger(); if (led !== sizesOf.led) sizesOf = { led, map: chatSizes(led) }; return sizesOf.map; }
  // Tokens used, from every chat's own records (lib/lite-tokens.js): each Claude account's
  // transcripts and Codex's session files (its accounts share one folder).
  const tokens = createTokens({ dataDir, log, roots: () => {
    const out = [];
    for (const a of config().accounts || []) if (a.configDir) out.push({ dir: path.join(a.configDir, 'projects'), kind: 'claude' });
    const cx = codexMainHome();
    if (cx) out.push({ dir: path.join(cx, 'sessions'), kind: 'codex' }, { dir: path.join(cx, 'archived_sessions'), kind: 'codex' });
    return out;
  } });
  // Which Lite project (and title) a chat's tokens belong to: as in the lists, or for a chat the
  // lists don't keep (older, or a helper's run), by its folder.
  function tokenPlaces() {
    const st = stateView(), L = store.get();
    const projects = new Map(st.projects.map(p => [p.key, p]));
    const chats = new Map(st.chats.map(c => [String(c.id).toLowerCase(), c]));
    const byCwd = new Map();
    const byName = new Map();
    for (const p of st.projects) if (p.cwd && !byCwd.has(p.cwd) && !p.key.includes('#')) byCwd.set(p.cwd, p);
    for (const p of st.projects) if (p.cwd && !byName.has(path.basename(p.cwd))) byName.set(path.basename(p.cwd), p.cwd);
    // A worktree (a helper's or Codex's copy of a repo) counts toward the repo it came from.
    const repoOf = cwd => {
      let m = /^(.*?)\/\.claude\/worktrees\//.exec(cwd); if (m) return m[1];
      m = /\/\.codex(?:-workspaces)?\/worktrees\/[^/]+\/([^/]+)/.exec(cwd); if (m && byName.has(m[1])) return byName.get(m[1]);
      return cwd;
    };
    return (sid, rawCwd) => {
      const cwd = rawCwd ? repoOf(rawCwd) : rawCwd;
      const c = sid && chats.get(String(sid).toLowerCase());
      if (c) { const p = projects.get(c.project); return { key: c.project, name: p ? p.name : c.project, title: c.title }; }
      if (!cwd) return { key: '~unknown', name: 'Unknown folder', title: null };
      const key = L.split[cwd] ? lite.splitKey(cwd, '', L.split[cwd]) : cwd;
      const p = projects.get(key) || byCwd.get(cwd);
      if (p) return { key: p.key, name: p.name, title: null };
      if (LOOSE.test(cwd)) return { key: LOOSE_KEY, name: 'No folder', title: null };
      return { key: cwd, name: path.basename(cwd) || cwd, title: null };
    };
  }
  const images = createLiteImages({ dataDir, log, mainHome: codexMainHome, homeFor: codexHomeFor, codexCommand: () => (config().codex && config().codex.command) || 'codex' });

  /* ---------- plans ---------- */

  function claudePlan(c, a, snap) {
    const pub = acc.publicAccount(c, a);
    const u = snap[a.id] || {};
    const d = u.data;
    let broken = null;
    if (!pub.signedIn) broken = 'Not signed in. Sign in from Setup in the full app.';
    else if (pub.lock && !pub.lock.ok) broken = pub.lockMessage || 'Signed in as a different account than expected. Sign in again.';
    else if (d && !d.available) broken = 'Claude Code didn’t report plan limits for this account. Sign in again to count it.';
    const week = d && d.week, five = d && d.fiveHour;
    const fable = d && (d.models || []).find(m => /fable|opus/i.test(m.name || ''));
    return {
      id: a.id, family: 'claude', name: a.name, email: pub.email || null, kind: pub.plan || 'Claude',
      broken, checking: !!u.checking, checkedAt: u.at || null, error: u.error || null,
      left: !broken && week ? Math.round(100 - (week.used || 0)) : null,
      resetsAt: !broken && week ? week.resetsAt || null : null,
      startedAt: !broken && week ? week.startedAt || null : null,
      windowMins: 7 * 24 * 60,
      fiveLeft: !broken && five ? Math.round(100 - (five.used || 0)) : null,
      fiveResetsAt: !broken && five ? five.resetsAt || null : null,
      models: !broken && d ? (d.models || []).map(m => ({ name: m.name, left: m.used === null ? null : Math.round(100 - m.used), resetsAt: m.resetsAt || null })) : [],
      fableLeft: fable && typeof fable.used === 'number' ? Math.round(100 - fable.used) : null,
      credits: null,
    };
  }
  function codexPlan(x, snap) {
    const st = x.publicState();
    const u = snap[st.id] || {};
    const d = u.data;
    if (st.kind === 'ollama') return { id: st.id, family: 'ollama', name: st.name, kind: st.plan || 'Ollama', unlimited: true, broken: st.signedIn ? null : (st.error || 'The Ollama app isn’t running.'), email: st.email || null };
    let broken = null;
    if (!st.enabled) broken = 'Codex is turned off in Setup.';
    else if (!st.signedIn) broken = st.error || 'Not signed in to ChatGPT.';
    const week = d && d.week, five = d && d.fiveHour;
    const rc = d && d.resetCredits;
    return {
      id: st.id, family: 'chatgpt', name: st.name, email: st.email || null, kind: st.plan || 'ChatGPT',
      broken, checking: !!u.checking, checkedAt: u.at || null, error: u.error || null,
      left: !broken && week ? Math.round(100 - (week.used || 0)) : null,
      resetsAt: !broken && week ? week.resetsAt || null : null,
      startedAt: null,
      windowMins: week && week.mins ? week.mins : 7 * 24 * 60,
      fiveLeft: !broken && five ? Math.round(100 - (five.used || 0)) : null,
      fiveResetsAt: !broken && five ? five.resetsAt || null : null,
      models: [],
      credits: rc ? { count: rc.count, list: (rc.credits || []).slice().sort((a, b) => (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) - (b.expiresAt ? Date.parse(b.expiresAt) : Infinity)) } : null,
    };
  }
  async function refreshAll() {
    const c = config();
    const jobs = [];
    for (const a of c.accounts) if (acc.signInInfo(a).signedIn) jobs.push(usage.refresh(c, a, { maxAgeMs: 5 * 60e3 }).catch(() => null));
    for (const x of codexAll()) if (x.publicState().signedIn) jobs.push(x.refreshUsage().catch(() => null));
    await Promise.all(jobs);
  }
  function plansNow() {
    const c = config(), snap = usage.snapshot(), L = store.get();
    const plans = [...c.accounts.map(a => claudePlan(c, a, snap)), ...codexAll().map(x => codexPlan(x, snap))];
    for (const p of plans) {
      p.label = L.plans.labels[p.id] || p.name;
      p.endsAt = (L.plans.endsAt || {})[p.id] || null;
      p.manualResets = L.plans.manualResets.filter(r => r.plan === p.id && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now()));
    }
    return plans;
  }
  async function plansView(fresh) {
    if (fresh) await Promise.race([refreshAll(), sleep(25000)]);
    const plans = plansNow();
    // Ollama: request counts from ollama.com (it doesn't report a percentage of the plan), turned
    // into an estimate of the week from the last reading of its settings page.
    const ol = plans.find(p => p.family === 'ollama' && !p.broken);
    if (ol) {
      const u = await Promise.race([ollamaAcct.usage(), sleep(fresh ? 15000 : 2500).then(() => null)]);
      if (u) {
        ol.requests = u;
        const est = lite.ollamaWeek(u.byDay, store.get().plans.ollamaReadings || []);
        ol.estimate = est;
        ol.resetsAt = est.resetsAt; ol.startedAt = est.startedAt; ol.windowMins = 7 * 24 * 60;
        if (est.used !== null) { ol.left = Math.round(100 - est.used); ol.unlimited = false; }
      }
    }
    store.sample(plans);
    const floor = store.get().plans.floor;
    const order = lite.useNextOrder(plans, floor, Date.now(), store.get().plans.preferred);
    const now = Date.now();
    for (const p of plans) {
      if (typeof p.left === 'number') p.forecast = lite.forecast(p, store.samplesFor(p.id), now, floor);
      const fam = order[p.family];
      p.rank = fam ? fam.indexOf(p.id) + 1 : 0;
    }
    try { ops.watchPlans(plans, order, floor); } catch (err) { log(`Lite: plan alerts: ${err.message}`); }
    return { plans, order, floor, preferred: store.get().plans.preferred, at: now };
  }
  // Hourly: read every plan's usage and keep a sample, so the forecast can use the last day.
  let sampler = null;
  // A Claude or ChatGPT week only starts at its first use, so an idle plan quietly loses days.
  // Switched on (Look → Start idle weeks for me; off unless you turn it on), Lite starts any plan
  // whose week isn't running with one tiny message, in a folder of its own
  // that stays out of the lists. Claude: no reset time reported. ChatGPT: a reset time that's
  // always a week from now (it slides until first use).
  const STARTER_DIR = path.join(dataDir, 'lite-week-starter');
  const notStarted = (p, now = Date.now()) => !p.broken && (p.family === 'claude' || p.family === 'chatgpt') && p.left === 100
    && (p.family === 'claude' ? !p.resetsAt : !!p.resetsAt && Math.abs(Date.parse(p.resetsAt) - (now + 7 * DAY)) < 15 * 60e3);
  async function startIdleWeeks(plans) {
    const L = store.get(); if (L.autoStartWeeks !== true || !ctx.startWeek) return [];
    const started = [];
    for (const p of plans) {
      if (!notStarted(p) || Date.now() - ((L.weekStarts || {})[p.id] || 0) < 6 * 3600e3) continue;
      try {
        fs.mkdirSync(STARTER_DIR, { recursive: true });
        store.noteWeekStart(p.id);
        await ctx.startWeek({ account: p.id, family: p.family, cwd: STARTER_DIR });
        started.push(p.label); log(`Lite: started the week on ${p.label} ${p.family === 'claude' ? 'Claude' : 'ChatGPT'}`);
      } catch (err) { log(`Lite: couldn’t start the week on ${p.label} (${err.message})`); }
    }
    return started;
  }
  function startSampling() {
    if (sampler) return;
    const tick = () => plansView(true).then(v => startIdleWeeks(v.plans)).catch(err => log(`Lite: usage sample failed (${err.message})`));
    setTimeout(tick, 60e3).unref();
    guesser.start();
    desktopNames.start();
    waits.start();
    liteRoutines.start();
    sampler = setInterval(tick, 3600e3); sampler.unref();
    tokens.start();
  }
  let titles = { at: 0, map: new Map() };
  function chatTitles() {
    if (Date.now() - titles.at < 30e3) return titles.map;
    const map = new Map();
    for (const p of sessionsWithCodex().projects) for (const s of p.sessions) map.set(s.id.toLowerCase(), s.title);
    titles = { at: Date.now(), map };
    return map;
  }

  /* ---------- projects and chats ---------- */

  const exists = new Map();
  const existsCached = p => { const hit = exists.get(p); if (hit && Date.now() - hit.at < 60e3) return hit.v; const v = fs.existsSync(p); exists.set(p, { at: Date.now(), v }); return v; };

  // Chats on Ollama (Codex with Ollama as its provider) aren't in Codex's own list, which only
  // shows OpenAI's; the Ollama account's own Codex lists them. Merged in by folder, Lite only.
  function withOllama(projects) {
    const extra = [];
    for (const x of codexAll()) {
      const st = x.publicState(); if (st.kind !== 'ollama' || !st.signedIn) continue;
      const before = x.cached().length;
      x.list({ maxAgeMs: 20000 }).then(l => { if (l.length !== before) broadcast('lite', {}); }).catch(() => {});
      for (const s of x.cached()) extra.push({ ...s, ollama: true, accountId: st.id, accountName: st.name });
    }
    if (!extra.length) return projects;
    const seen = new Set(projects.flatMap(p => p.sessions.map(s => String(s.id).toLowerCase())));
    const byCwd = new Map(projects.map(p => [String(p.cwd || '').replace(/[\\/]+$/, ''), p]));
    const out = projects.map(p => ({ ...p, sessions: p.sessions.slice() }));
    const outBy = new Map(out.map(p => [String(p.cwd || '').replace(/[\\/]+$/, ''), p]));
    for (const s of extra) {
      if (seen.has(String(s.id).toLowerCase()) || !s.cwd) continue;
      const k = String(s.cwd).replace(/[\\/]+$/, '');
      let p = outBy.get(k);
      if (!p) { p = { cwd: s.cwd, name: path.basename(k) || k, exists: fs.existsSync(s.cwd), notes: 0, sessions: [], updated: 0 }; out.push(p); outBy.set(k, p); }
      p.sessions.push({ ...s, folderExists: p.exists });
      seen.add(String(s.id).toLowerCase());
    }
    return byCwd.size ? out : projects;
  }
  // The names of your routines, to recognise their runs by title (cached for a minute).
  let rtNames = { at: 0, set: new Set() };
  function routineNames() {
    if (Date.now() - rtNames.at > 60e3) { try { rtNames = { at: Date.now(), set: new Set((routinesList() || []).map(r => String(r.name || '').trim()).filter(Boolean)) }; } catch { rtNames.at = Date.now(); } }
    return rtNames.set;
  }
  function stateView() {
    const L = store.get(), now = Date.now();
    const projects = new Map();
    const chats = [];
    const liveList = activityList();
    const liveBy = new Map();
    for (const x of liveList) if (x.sessionId) liveBy.set(x.sessionId.toLowerCase(), x);
    for (const p of withOllama(sessionsWithCodex().projects)) {
      if (/[\\/]commander$/.test(p.cwd) && p.sessions.every(s => isCommanderId(s.id))) continue;
      const rules = L.split[p.cwd];
      const loose = LOOSE.test(p.cwd);
      const ensure = key => {
        if (projects.has(key)) return projects.get(key);
        const sub = key.includes('#') ? key.slice(key.indexOf('#') + 1) : null;
        // A chat moved or merged elsewhere: the project is described by its own folder, not this one.
        const kcwd = key === LOOSE_KEY || key === QUICK_KEY ? null : key.split('#')[0];
        const here = kcwd === p.cwd;
        const krules = here ? rules : L.split[kcwd];
        const rule = sub && krules ? krules.find(r => r.project === sub) : null;
        const own = L.projects[key] || {};
        const folderName = here ? p.name : path.basename(String(kcwd || '').replace(/[\\/]+$/, '')) || kcwd;
        const base = key === QUICK_KEY ? { cwd: null, folder: 'Quick', exists: false, mono: false, loose: true, quick: true } : key === LOOSE_KEY ? { cwd: null, folder: 'No folder', exists: false, mono: false, loose: true } : { cwd: kcwd, folder: folderName, exists: here ? p.exists : existsCached(kcwd), mono: !!(krules && krules.length) };
        const name = own.name || (rule && rule.name) || (key === QUICK_KEY ? 'Quick' : key === LOOSE_KEY ? 'No folder' : sub ? sub[0].toUpperCase() + sub.slice(1) : folderName);
        const v = { key, ...base, name, bucket: own.bucket || null, order: typeof own.order === 'number' ? own.order : null, image: own.image || null, archived: L.archived.projects.includes(key), total: 0, auto: 0, updated: 0 };
        projects.set(key, v);
        return v;
      };
      if (!p.sessions.length && !loose && !(L.projects[p.cwd] && L.projects[p.cwd].into)) ensure(p.cwd);
      // How many recent chats each of this folder's projects has (a guess never empties one).
      const homeCount = new Map();
      for (const s of p.sessions) { if (now - (s.updated || 0) > 14 * DAY || L.archived.chats[s.id] || s.entrypoint === 'sdk-cli' && !(s.lastOpened && ['app', 'fork'].includes(s.lastOpened.mode)) || (s.provider === 'codex' && s.source === 'exec')) continue; const k = (L.chats[s.id] || {}).project || (loose ? LOOSE_KEY : lite.splitKey(p.cwd, s.title, rules)); homeCount.set(k, (homeCount.get(k) || 0) + 1); }
      for (const s of p.sessions) {
        if (isCommanderId(s.id)) continue;
        const mine = L.chats[s.id] || {};
        const g = L.guess[s.id] || {};
        let key = mine.project || (loose ? LOOSE_KEY : lite.splitKey(p.cwd, s.title, rules));
        for (let hops = 0; hops < 4 && L.projects[key] && L.projects[key].into; hops++) key = L.projects[key].into;
        // Runs started by scripts, other agents or routines: kept, but out of the calm lists (the
        // Automation page shows them). Codex exec runs, Claude Code runs from a script (claude -p),
        // a routine's runs ("<routine> · Oct 11, 9:33 AM"), and Lite's own starter folder.
        const routineTitle = RUN_TITLE.test(s.title || '') && routineNames().has(String(s.title).replace(RUN_TITLE, '').trim());
        // (Switcher's own chats run the same way as a script's, so ones it opened itself aren't counted.)
        const openedHere = s.lastOpened && ['app', 'fork'].includes(s.lastOpened.mode);
        const autoKind = s.provider === 'codex' && s.source === 'exec' ? 'helper' : s.provider !== 'codex' && s.entrypoint === 'sdk-cli' && !openedHere ? 'script' : routineTitle ? 'routine' : p.cwd === STARTER_DIR ? 'starter' : null;
        const auto = !!autoKind;
        // Into Quick: your say, or the small model's guess if the chat really is small (it moves back
        // by itself if it grows) and isn't all its project has.
        // (Only a guess from the current definition counts; many chats have their home folder's project
        // saved, which isn't a choice, so only a project other than that one holds a guess back.)
        const placed = mine.project && mine.project !== (loose ? LOOSE_KEY : lite.splitKey(p.cwd, s.title, rules));
        const guessQuick = !placed && (g.v || 0) >= 6 && !!g.quick && isSmallChat(sizes().get(String(s.id).toLowerCase())) && (homeCount.get(key) || 0) > 1;
        if (!auto && !L.archived.chats[s.id] && (typeof mine.quick === 'boolean' ? mine.quick : guessQuick)) key = QUICK_KEY;
        const proj = ensure(key);
        proj.total++;
        if (auto) proj.auto++;
        proj.updated = Math.max(proj.updated, s.updated || 0);
        const live = liveBy.get(s.id.toLowerCase());
        const archived = L.archived.chats[s.id];
        if (!(mine.status || mine.kind || mine.focus || mine.waiting) && !live && !archived && now - (s.updated || 0) > KEEP_DAYS * DAY) continue;
        const ranIn = s.ranIn && s.ranIn !== p.cwd ? s.ranIn : null;
        chats.push({
          id: s.id, title: one(g.title && !mine.titleLocked && ((!s.renamed && ((g.replyNamed && !isOngoingChat(sizes().get(String(s.id).toLowerCase()))) || looksLikePrompt(s.title))) || genericTitle(s.title)) ? g.title : s.title, 160), fullTitle: one(s.title, 300), autoTitle: !mine.titleLocked && (!s.renamed || genericTitle(s.title)), provider: s.provider || 'claude', updated: s.updated || 0, created: s.created || 0,
          project: key, status: mine.status || g.status || lite.guessStatus(s.title), kind: mine.kind || g.kind || lite.guessKind(s.title), guessed: { status: !mine.status, kind: !mine.kind }, quick: key === QUICK_KEY, focus: !!mine.focus, waiting: !!mine.waiting, waitingOn: mine.waitingOn || null, note: mine.note || null, remindAt: mine.remindAt || null,
          branch: s.branch || null, worktree: ranIn, worktreeExists: ranIn ? existsCached(ranIn) : null, folderExists: s.folderExists !== false && p.exists,
          // Where it actually runs (a chat can belong to a project but run in a worktree or a
          // scratch folder), and whether that's a git worktree (one with a branch to rebuild from).
          desktop: !!s.desktop, desktopRename: (L.desktopRenames || {})[String(s.id).toLowerCase()] ? L.desktopRenames[String(s.id).toLowerCase()].title : null,
          runDir: ranIn || p.cwd, runIsWorktree: !!ranIn && /[\\/]worktrees[\\/]/.test(ranIn),
          preferredModel: ctx.modelPreference?.({ sessionId: s.id, cwd: ranIn || p.cwd, provider: s.ollama ? 'ollama' : s.provider || 'claude' }) || null,
          parent: mine.topLevel ? null : parentOf(s.id) || (s.desktop && s.desktop.parent) || null, model: s.model || null, account: s.accountName || (s.lastOpened ? s.lastOpened.accountName || null : null), accountId: s.accountId || (s.lastOpened ? s.lastOpened.account || null : null), ollama: !!s.ollama,
          auto, autoKind, cwd: p.cwd, archived: !!archived, desktopArchived: !!(s.desktop && s.desktop.archived), firstPrompt: one(s.firstPrompt || '', 200),
        });
      }
    }
    // A routine's own run chats stay off the calm lists (they're on the Routines page); bug chats it started say so.
    const runChats = liteRoutines.runChats(), escChats = liteRoutines.escalationChats();
    for (const c of chats) { const k = String(c.id).toLowerCase(); if (runChats.has(k)) c.routineRun = runChats.get(k); if (escChats.has(k)) c.fromRoutine = escChats.get(k); }
    lite.families(chats, L.chats, key => key === LOOSE_KEY || key === QUICK_KEY || /[\\/]scratch-workspaces[\\/]/.test(key));
    const live = liveView(liveList);
    const routines = (routinesList() || []).map(r => ({ id: r.id, name: r.name, enabled: !!r.enabled, nextAt: r.state && r.state.nextAt || null, when: r.triggerText || '', account: r.account, provider: r.provider, cwd: r.cwd, running: !!r.running, untilAt: r.untilAt || null, last: r.history && r.history[0] ? { at: r.history[0].at, status: r.history[0].status, line: one(r.history[0].line || '', 160) } : null }));
    // What a new chat starts in when Lite has no permission default of its own: the full app's setting.
    const prefs = config().prefs || {};
    const appPermissions = { claude: prefs.claudeMode || null, codex: prefs.codexMode || null, gemini: (config().gemini || {}).mode || null };
    waits.decorate(chats);
    return { modelDefaults: Object.fromEntries(['claude', 'codex', 'ollama', 'gemini'].map(p => [p, ctx.modelDefault?.(p) || null])), lite: L, projects: [...projects.values()], chats, live, routines, now, appPermissions, permissionModes: lite.PERMS, gemini: !!(ctx.geminiReady && ctx.geminiReady()) };
  }
  // What's running, waiting on you, or just replied, from the same list Tyler's hub uses. The page
  // asks for just this on every live event; the whole state only when chats or lite.json change.
  function liveView(liveList = activityList()) {
    // The Commander stays off the lists unless it's waiting on you (asking to do something).
    return liveList.filter(x => !x.parentKey && !(x.sessionId && isCommanderId(x.sessionId) && !(x.pending || []).length)).map(x => {
      const crew = x.key ? liveList.filter(y => y.parentKey === x.key && y.key && y.phase !== 'ended') : [];
      // Partners share this sidebar row, so their work must keep its activity light on too.
      const workers = [x, ...crew].filter(y => y.phase !== 'ended');
      return {
      key: x.key || null, companionKey: x.companionKey || null, companionProvider: x.companionKey ? ((liveList.find(y => y.key === x.companionKey) || {}).provider || null) : null, crew: crew.map(y => ({ key: y.key, provider: y.provider || 'claude' })), sessionId: x.sessionId || null, source: x.source, provider: x.provider || 'claude', title: x.title || null, folder: x.folder || null,
      phase: busyIdle(x) ? 'thinking' : x.phase, working: workers.some(y => WORKING.has(y.phase) || busyIdle(y) || realBackground(y).length > 0), background: workers.flatMap(realBackground), tool: x.tool || null, detail: one(x.detail || '', 160), lastText: one(x.lastText || '', 280), lastPrompt: one(x.lastPrompt || '', 160),
      turnStartedAt: x.turnStartedAt || null, finishedAt: x.finishedAt || null, lastEventAt: x.lastEventAt || null, ok: x.ok,
      pending: (x.pending || []).map(q => ({ requestId: q.requestId, toolName: q.toolName, summary: q.summary || null, detail: q.detail || null, question: !!q.question, canAlways: !!q.canAlways })),
      accountName: x.accountName || null,
      // Kept at it until a time (Keep working), and files another chat changed at the same time.
      keep: x.keep ? { until: x.keep.until, state: x.keep.state || null, nextAt: x.keep.nextAt || null, backAt: x.keep.backAt || null, nudges: x.keep.nudges || 0, how: x.keep.how || null, quietMinutes: x.keep.quietMinutes || null, note: x.keep.note || '' } : null,
      overlaps: (x.overlaps || []).slice(0, 6).map(o => ({ file: o.file, rel: o.rel, at: o.at, others: (o.others || []).map(y => ({ sessionId: y.sessionId, provider: y.provider })) })),
      };
    });
  }

  // Every routine with its recent runs and Lite's settings for it, plus what came of the runs.
  function routinesView() {
    const L = store.get();
    const list = (routinesList() || []).map(r => ({
      id: r.id, name: r.name, cwd: r.cwd, account: r.account, provider: r.provider, model: r.model || null, permissionMode: r.permissionMode, enabled: !!r.enabled, untilAt: r.untilAt || null,
      prompt: stripSuffix(r.prompt || ''), chat: r.chat, trigger: r.trigger, when: r.triggerText || '', nextAt: r.state && r.state.nextAt || null, running: !!r.running, watchError: r.watchError || null,
      runs: (r.history || []).slice(0, 15).map(h => ({ id: h.id, at: h.at, status: h.status, line: h.line || '', sessionId: h.sessionId || null, provider: h.provider || null, why: h.why || null })),
      flow: liteRoutines.flowOf(r.id),
    }));
    return { routines: list, events: (L.routineEvents || []).slice(0, 60), escalatePrompt: ESCALATE_PROMPT, now: Date.now() };
  }

  /* ---------- routes ---------- */

  async function handle(method, route, url, readBody, req = null) {
    if (method === 'GET' && route === '/api/lite/state') return stateView();
    if (method === 'GET' && route === '/api/lite/routines') return routinesView();
    if (method === 'GET' && route === '/api/lite/pipeline') { if (url.searchParams.get('refresh')) pipeline.refresh(); return pipeline.view(stateView().chats, liveView()); }
    if (method === 'GET' && route === '/api/lite/live') return { live: liveView(), now: Date.now() };
    // Both: the other assistant's conversation in this chat, if it has one.
    if (method === 'GET' && route === '/api/lite/companion') { const thread = (ctx.companionOf && ctx.companionOf(String(url.searchParams.get('id') || ''))) || null; return { thread, provider: thread && ctx.threadKind ? ctx.threadKind(thread) : null, crew: ctx.crewOf ? ctx.crewOf(String(url.searchParams.get('id') || '')) : {} }; }
    if (method === 'GET' && route === '/api/lite/space') return ops.space(stateView().chats, { fresh: url.searchParams.get('fresh') === '1' });
    if (method === 'GET' && route === '/api/lite/worktree/state') return { state: ops.rebuildState(url.searchParams.get('id')) };
    if (method === 'GET' && route === '/api/lite/models') return models.get({ fresh: url.searchParams.get('fresh') === '1' });
    if (method === 'GET' && route === '/api/lite/signin') return signin.status(String(url.searchParams.get('id') || ''));
    // The gallery's missing thumbnails are made first (in the background, a few at a time), so its
    // pictures load small; it answers after 15 seconds at most either way.
    if (method === 'GET' && route === '/api/lite/images') { const list = images.list(); images.warm(list).catch(() => {}); return { images: list, jobs: images.jobs() }; }   // thumbnails are made meanwhile; each picture waits for its own
    if (method === 'GET' && route === '/api/lite/images/job') { const j = images.job(url.searchParams.get('id')); if (!j) throw fail(404, 'No such job.'); return { job: j }; }
    if (method === 'GET' && route === '/api/lite/plans') return plansView(url.searchParams.get('fresh') === '1');
    if (method === 'GET' && route === '/api/lite/tokens') {
      if (url.searchParams.get('refresh') === '1') tokens.refresh();
      const led = tokens.ledger();
      if (!led && !tokens.scanning()) tokens.refresh();
      return { ...tokensView(led, tokenPlaces()), counting: tokens.scanning(), ready: !!led };
    }
    if (method !== 'POST') return undefined;
    const body = await readBody();
    const done = v => { broadcast('lite', {}); return v; };
    switch (route) {
      case '/api/lite/chats': return done({ chats: store.setChats(body.ids, body.patch || {}) });
      case '/api/lite/project': return done({ project: store.setProject(body.key, body.patch || {}) });
      case '/api/lite/buckets': return done({ buckets: store.setBuckets(body.buckets) });
      case '/api/lite/split': return done({ rules: store.setSplit(body.cwd, body.rules) });
      case '/api/lite/look': return done(store.setLook(body));
      case '/api/lite/plans/select': {
        const family = body.family, id = body.account || null;
        if (!['claude', 'chatgpt'].includes(family)) throw fail(400, 'Choose Claude or ChatGPT.');
        if (id) {
          const p = plansNow().find(p => p.id === id && p.family === family);
          if (!p || p.broken || p.fiveLeft === 0 || !(p.left > 0) || (p.endsAt && Date.parse(p.endsAt) <= Date.now())) throw fail(400, 'That account has no available allowance. Choose another account.');
        }
        store.setPreferredPlan(family, id);
        broadcast('accounts', {});
        return done(await plansView(false));
      }
      case '/api/lite/archive': {
        // Keep what's needed to bring a chat back where it was, even when the caller only sent ids.
        const records = { ...(body.records || {}) };
        const ids = (Array.isArray(body.chats) ? body.chats : []).map(String);
        if (body.on !== false && ids.some(id => !records[id])) {
          const by = new Map(stateView().chats.map(c => [c.id, c]));
          for (const id of ids) { const c = by.get(id); if (c && !records[id]) records[id] = { title: c.title, project: c.project, kind: c.kind, status: c.status, model: c.model, branch: c.branch, worktree: c.worktree, provider: c.provider }; }
        }
        return done({ archived: store.archive({ ...body, records }, body.on !== false) });
      }
      case '/api/lite/hackathon': return done(store.setHackathon(body));
      case '/api/lite/reset/add': return done({ reset: store.addManualReset(body) });
      case '/api/lite/ollama/reading': {
        const u = await ollamaAcct.usage({ maxAgeMs: 0 });
        if (!u) throw fail(502, 'Couldn’t read the request count from ollama.com just now. Try again in a minute.');
        const prev = store.get().plans.ollamaReadings || [];
        const wk = lite.ollamaWeek(u.byDay, body.resetsAt ? [{ resetsAt: body.resetsAt }] : prev);
        return done({ reading: store.addOllamaReading({ pct: body.pct, requests: wk.requests, resetsAt: body.resetsAt || (prev.length ? prev[prev.length - 1].resetsAt : undefined) }) });
      }
      case '/api/lite/reset/remove': return done({ resets: store.removeManualReset(String(body.id || '')) });
      case '/api/lite/signin/start': return signin.start(String(body.account || ''));
      case '/api/lite/signin/code': return done(await signin.code(String(body.id || ''), body.code));
      case '/api/lite/signin/cancel': return signin.cancel(String(body.id || ''));
      case '/api/lite/seen': { const ids = Array.isArray(body.ids) ? body.ids : []; for (const id of ids) waits.seen(String(id)); return { seen: store.setSeen(ids, body.at) }; }
      case '/api/lite/guess/run': return done(await guesser.run());
      case '/api/lite/free': return done({ freed: await ops.freeSpace(Array.isArray(body.paths) ? body.paths.map(String) : []) });
      case '/api/lite/worktree/remove': return done(await ops.removeWorktree(String(body.id || ''), String(body.path || '')));
      // A chat whose folder was deleted (a Claude scratch folder that was cleaned up, say): make the
      // folder again, empty, at the same path. Claude and Codex find a conversation by its folder, so
      // the whole history comes back; files that were in the folder don't. Never for a worktree
      // (Rebuild worktree puts its branch back) and only inside your home folder.
      // Families: nest a chat under another (the same links the full app keeps), or take it out.
      case '/api/lite/parent': {
        const all = stateView().chats, by = new Map(all.map(c => [String(c.id).toLowerCase(), c]));
        const c = by.get(String(body.id || '').toLowerCase());
        if (!c) throw fail(404, 'That chat isn’t in the list.');
        if (body.parent) {
          const p = by.get(String(body.parent).toLowerCase());
          if (!p) throw fail(404, 'That chat isn’t in the list.');
          for (let x = p, i = 0; x && i < 50; i++, x = x.parent ? by.get(String(x.parent).toLowerCase()) : null) if (x === c) throw fail(400, 'That would put a chat inside its own sub-chat.');
          ctx.linkParent(c.id, p.id);
          store.setChats([c.id], { topLevel: false, project: null });
        } else {
          ctx.unlinkParent(c.id);
          const d = desktop.get(c.id);
          if (d && d.parentCli) store.setChats([c.id], { topLevel: true });
        }
        return done({ ok: true });
      }
      case '/api/lite/steer': {
        const text = typeof body.text === 'string' ? body.text.slice(0, 200000) : '';
        if (!text.trim() && !(Array.isArray(body.images) && body.images.length)) throw fail(400, 'Type a message.');
        return ctx.steerChat(String(body.key || ''), text, Array.isArray(body.images) ? body.images.slice(0, 10) : []);
      }
      // Routines: save one (the full app's routine plus Lite's triage and escalation), see events.
      case '/api/lite/routines/save': {
        const f = body.flow || {};
        const input = { ...body.routine, prompt: f.triage === false ? stripSuffix(body.routine && body.routine.prompt) : withSuffix(body.routine && body.routine.prompt) };
        const out = await ctx.routinesApi('/api/routines', input);
        store.setRoutineFlow(out.routine.id, f);
        return done(routinesView());
      }
      case '/api/lite/routines/remove': await ctx.routinesApi('/api/routines/remove', { id: body.id }); store.setRoutineFlow(String(body.id || ''), null); return done(routinesView());
      case '/api/lite/routines/seen': store.seeRoutineEvents(body.all ? 'all' : (Array.isArray(body.ids) ? body.ids.map(String) : [])); return done(routinesView());
      case '/api/lite/routines/check': await liteRoutines.tick(); return done(routinesView());
      // Rename in the Claude desktop app too: written now if it's closed, else when it next is.
      case '/api/lite/desktop-rename': return done(await desktopNames.queue(String(body.id || ''), body.title));
      case '/api/lite/folder/recreate': {
        const id = String(body.id || '').toLowerCase();
        const c = stateView().chats.find(x => String(x.id).toLowerCase() === id);
        if (!c) throw fail(404, 'That chat isn’t in the list.');
        if (c.runIsWorktree) throw fail(400, 'This chat ran in a worktree. Rebuild the worktree from its branch instead (Archived page).');
        const dir = path.resolve(c.runDir || c.cwd || '');
        if (fs.existsSync(dir)) { exists.delete(dir); exists.delete(c.runDir); return done({ cwd: dir, existed: true }); }
        if (!dir.startsWith(os.homedir() + path.sep)) throw fail(400, 'Only folders inside your home folder are made again.');
        fs.mkdirSync(dir, { recursive: true });
        exists.delete(dir); exists.delete(c.runDir);
        log(`Lite: made ${dir} again (empty) so chat ${c.id} can carry on`);
        return done({ cwd: dir, created: true });
      }
      case '/api/lite/worktree/rebuild': return done(await ops.rebuildWorktree(String(body.id || '')));
      case '/api/lite/images/generate': {
        // Draws on the ChatGPT plan that's next in the use-next order.
        const pv = await plansView(false);
        const id = (pv.order.chatgpt || [])[0] || null;
        const plan = id && pv.plans.find(p => p.id === id);
        return { job: images.generate({ prompt: body.prompt, n: body.n, cwd: body.cwd ? String(body.cwd) : null, out: body.out ? String(body.out) : null, account: id, accountName: plan ? `${plan.label} ChatGPT` : null }) };
      }
      case '/api/lite/reset/use': {
        // Spends one of a ChatGPT plan's manual resets. The page asks first; this is the real thing.
        const x = codexAll().find(c => c.publicState().id === body.plan);
        if (!x || x.publicState().kind === 'ollama') throw fail(404, 'That isn’t one of your ChatGPT plans.');
        const r = await x.consumeResetCredit(body.creditId ? String(body.creditId) : null);
        log(`Lite: used a manual reset on ${x.publicState().name}: ${r.outcome}`);
        return done({ ...r, plans: await plansView(false) });
      }
      default: return undefined;
    }
  }

  // Routines take the use-next plan of their family when they start, if lite.json says so.
  // The plans to use next for a family, in order (the same order New chat and routines follow).
  function useNextIds(family) {
    try { return lite.useNextOrder(plansNow(), store.get().plans.floor, Date.now(), store.get().plans.preferred)[family] || []; } catch { return []; }
  }
  function routineAccount(id) {
    if (!store.get().routinesFollow || !id) return id;
    try {
      const plans = plansNow(), me = plans.find(p => p.id === id);
      if (!me || !['claude', 'chatgpt'].includes(me.family)) return id;
      const next = lite.useNextOrder(plans, store.get().plans.floor, Date.now(), store.get().plans.preferred)[me.family][0];
      if (next && next !== id) log(`Lite: routine moved from ${me.label} to the use-next plan (${next})`);
      return next || id;
    } catch { return id; }
  }
  return { handle, plansView, stateView, startSampling, images, routineAccount, useNextIds, replyFinished: guesser.replyFinished, usePush: ops.usePush };
}

module.exports = { createLiteRoutes };
