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
const { createGuesser, looksLikePrompt } = require('./lite-guess');
const { createSignin } = require('./lite-signin');
const { createModels } = require('./lite-models');
const { createOllamaAccount } = require('./ollama-account');
const desktop = require('./desktop');
const { createDesktopNames } = require('./lite-desktop-names');
const { createLiteRoutines, withSuffix, stripSuffix, ESCALATE_PROMPT } = require('./lite-routines');
const { createPipeline } = require('./lite-pipeline');

const DAY = 864e5;
const KEEP_DAYS = 120;          // chats older than this (and untouched by you) stay out of the lite lists
const WORKING = new Set(['thinking', 'writing', 'tool', 'starting']);
// Chats from the desktop app with no project, and ones run in temp folders, gather under "No folder".
const LOOSE = /scratch-workspaces|^\/private\/(tmp|var)\/|^\/tmp\/|^\/var\/folders\//;
const LOOSE_KEY = '~loose';
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
  const escalationAccount = () => { try { const o = lite.useNextOrder(plansNow(), store.get().plans.floor); if (o.claude[0]) return o.claude[0]; } catch { /* below */ } const c = config(); return ((c.accounts || []).find(a => a.isDefault) || (c.accounts || [])[0] || {}).id; };
  const pipeline = createPipeline({ log });
  const liteRoutines = createLiteRoutines({
    store, routinesList, log, broadcast, escalationAccount,
    lastReply: (id, provider) => (ctx.lastReply ? ctx.lastReply(id, provider) : Promise.resolve('')),
    startEscalation: opts => ctx.startEscalation({ ...opts, permissionMode: (store.get().permissions || {}).claude || 'default' }),
    notify: (kind, payload) => ops.notify(kind, payload),
    nameChat: (chat, title) => (ctx.nameChat ? ctx.nameChat(chat, title) : Promise.resolve()),
  });
  const models = createModels({ config, acc, codexAll, overrideVars: ctx.overrideVars || [], log });
  const guesser = createGuesser({ store, log, chats: () => stateView().chats });
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
    const order = lite.useNextOrder(plans, floor);
    const now = Date.now();
    for (const p of plans) {
      if (typeof p.left === 'number') p.forecast = lite.forecast(p, store.samplesFor(p.id), now, floor);
      const fam = order[p.family];
      p.rank = fam ? fam.indexOf(p.id) + 1 : 0;
    }
    try { ops.watchPlans(plans, order, floor); } catch (err) { log(`Lite: plan alerts: ${err.message}`); }
    return { plans, order, floor, at: now };
  }
  // Hourly: read every plan's usage and keep a sample, so the forecast can use the last day.
  let sampler = null;
  // A Claude or ChatGPT week only starts at its first use, so an idle plan quietly loses days.
  // Lite starts any plan whose week isn't running with one tiny message, in a folder of its own
  // that stays out of the lists. Claude: no reset time reported. ChatGPT: a reset time that's
  // always a week from now (it slides until first use).
  const STARTER_DIR = path.join(dataDir, 'lite-week-starter');
  const notStarted = (p, now = Date.now()) => !p.broken && (p.family === 'claude' || p.family === 'chatgpt') && p.left === 100
    && (p.family === 'claude' ? !p.resetsAt : !!p.resetsAt && Math.abs(Date.parse(p.resetsAt) - (now + 7 * DAY)) < 15 * 60e3);
  async function startIdleWeeks(plans) {
    const L = store.get(); if (L.autoStartWeeks === false || !ctx.startWeek) return [];
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
    liteRoutines.start();
    sampler = setInterval(tick, 3600e3); sampler.unref();
    // Phone alerts: what changed among live chats since a few seconds ago.
    const watch = () => { if (!ops.hasSubscribers()) return; try { ops.watchLive(liveView(), x => { const c = x.sessionId && chatTitles().get(x.sessionId.toLowerCase()); return c || x.title || 'A chat'; }); } catch (err) { log(`Lite: live alerts: ${err.message}`); } };
    setInterval(watch, 4000).unref();
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
        const kcwd = key === LOOSE_KEY ? null : key.split('#')[0];
        const here = kcwd === p.cwd;
        const krules = here ? rules : L.split[kcwd];
        const rule = sub && krules ? krules.find(r => r.project === sub) : null;
        const own = L.projects[key] || {};
        const folderName = here ? p.name : path.basename(String(kcwd || '').replace(/[\\/]+$/, '')) || kcwd;
        const base = key === LOOSE_KEY ? { cwd: null, folder: 'No folder', exists: false, mono: false, loose: true } : { cwd: kcwd, folder: folderName, exists: here ? p.exists : existsCached(kcwd), mono: !!(krules && krules.length) };
        const name = own.name || (rule && rule.name) || (key === LOOSE_KEY ? 'No folder' : sub ? sub[0].toUpperCase() + sub.slice(1) : folderName);
        const v = { key, ...base, name, bucket: own.bucket || null, image: own.image || null, archived: L.archived.projects.includes(key), total: 0, auto: 0, updated: 0 };
        projects.set(key, v);
        return v;
      };
      if (!p.sessions.length && !loose && !(L.projects[p.cwd] && L.projects[p.cwd].into)) ensure(p.cwd);
      for (const s of p.sessions) {
        if (isCommanderId(s.id)) continue;
        const mine = L.chats[s.id] || {};
        const g = L.guess[s.id] || {};
        let key = mine.project || (loose ? LOOSE_KEY : lite.splitKey(p.cwd, s.title, rules));
        for (let hops = 0; hops < 4 && L.projects[key] && L.projects[key].into; hops++) key = L.projects[key].into;
        const proj = ensure(key);
        // Codex runs started by scripts or other agents (codex exec): kept, but out of the calm lists.
        const auto = (s.provider === 'codex' && s.source === 'exec') || p.cwd === STARTER_DIR;
        proj.total++;
        if (auto) proj.auto++;
        proj.updated = Math.max(proj.updated, s.updated || 0);
        const live = liveBy.get(s.id.toLowerCase());
        const archived = L.archived.chats[s.id];
        if (!(mine.status || mine.kind || mine.focus || mine.waiting) && !live && !archived && now - (s.updated || 0) > KEEP_DAYS * DAY) continue;
        const ranIn = s.ranIn && s.ranIn !== p.cwd ? s.ranIn : null;
        chats.push({
          id: s.id, title: one(g.title && !s.renamed && looksLikePrompt(s.title) ? g.title : s.title, 160), fullTitle: one(s.title, 300), provider: s.provider || 'claude', updated: s.updated || 0, created: s.created || 0,
          project: key, status: mine.status || g.status || lite.guessStatus(s.title), kind: mine.kind || g.kind || lite.guessKind(s.title), guessed: { status: !mine.status, kind: !mine.kind }, focus: !!mine.focus, waiting: !!mine.waiting, waitingOn: mine.waitingOn || null, note: mine.note || null, remindAt: mine.remindAt || null,
          branch: s.branch || null, worktree: ranIn, worktreeExists: ranIn ? existsCached(ranIn) : null, folderExists: s.folderExists !== false && p.exists,
          // Where it actually runs (a chat can belong to a project but run in a worktree or a
          // scratch folder), and whether that's a git worktree (one with a branch to rebuild from).
          desktop: !!s.desktop, desktopRename: (L.desktopRenames || {})[String(s.id).toLowerCase()] ? L.desktopRenames[String(s.id).toLowerCase()].title : null,
          runDir: ranIn || p.cwd, runIsWorktree: !!ranIn && /[\\/]worktrees[\\/]/.test(ranIn),
          parent: mine.topLevel ? null : parentOf(s.id) || (s.desktop && s.desktop.parent) || null, model: s.model || null, account: s.accountName || (s.lastOpened ? s.lastOpened.accountName || null : null), accountId: s.accountId || (s.lastOpened ? s.lastOpened.account || null : null), ollama: !!s.ollama,
          auto, cwd: p.cwd, archived: !!archived, desktopArchived: !!(s.desktop && s.desktop.archived), firstPrompt: one(s.firstPrompt || '', 200),
        });
      }
    }
    // A routine's own run chats stay off the calm lists (they're on the Routines page); bug chats it started say so.
    const runChats = liteRoutines.runChats(), escChats = liteRoutines.escalationChats();
    for (const c of chats) { const k = String(c.id).toLowerCase(); if (runChats.has(k)) c.routineRun = runChats.get(k); if (escChats.has(k)) c.fromRoutine = escChats.get(k); }
    lite.families(chats, L.chats, key => key === LOOSE_KEY || /[\\/]scratch-workspaces[\\/]/.test(key));
    const live = liveView(liveList);
    const routines = (routinesList() || []).map(r => ({ id: r.id, name: r.name, enabled: !!r.enabled, nextAt: r.state && r.state.nextAt || null, when: r.triggerText || '', account: r.account, provider: r.provider, cwd: r.cwd, running: !!r.running, last: r.history && r.history[0] ? { at: r.history[0].at, status: r.history[0].status, line: one(r.history[0].line || '', 160) } : null }));
    // What a new chat starts in when Lite has no permission default of its own: the full app's setting.
    const prefs = config().prefs || {};
    const appPermissions = { claude: prefs.claudeMode || null, codex: prefs.codexMode || null };
    return { lite: L, projects: [...projects.values()], chats, live, routines, now, appPermissions, permissionModes: lite.PERMS };
  }
  // What's running, waiting on you, or just replied, from the same list Tyler's hub uses. The page
  // asks for just this on every live event; the whole state only when chats or lite.json change.
  function liveView(liveList = activityList()) {
    return liveList.filter(x => !x.parentKey && !(x.sessionId && isCommanderId(x.sessionId))).map(x => ({
      key: x.key || null, sessionId: x.sessionId || null, source: x.source, provider: x.provider || 'claude', title: x.title || null, folder: x.folder || null,
      phase: x.phase, working: WORKING.has(x.phase), tool: x.tool || null, detail: one(x.detail || '', 160), lastText: one(x.lastText || '', 280), lastPrompt: one(x.lastPrompt || '', 160),
      turnStartedAt: x.turnStartedAt || null, finishedAt: x.finishedAt || null, lastEventAt: x.lastEventAt || null, ok: x.ok,
      pending: (x.pending || []).map(q => ({ requestId: q.requestId, toolName: q.toolName, summary: q.summary || null, detail: q.detail || null, question: !!q.question, canAlways: !!q.canAlways })),
      accountName: x.accountName || null,
    }));
  }

  // Every routine with its recent runs and Lite's settings for it, plus what came of the runs.
  function routinesView() {
    const L = store.get();
    const list = (routinesList() || []).map(r => ({
      id: r.id, name: r.name, cwd: r.cwd, account: r.account, provider: r.provider, model: r.model || null, permissionMode: r.permissionMode, enabled: !!r.enabled,
      prompt: stripSuffix(r.prompt || ''), chat: r.chat, trigger: r.trigger, when: r.triggerText || '', nextAt: r.state && r.state.nextAt || null, running: !!r.running, watchError: r.watchError || null,
      runs: (r.history || []).slice(0, 15).map(h => ({ id: h.id, at: h.at, status: h.status, line: h.line || '', sessionId: h.sessionId || null, why: h.why || null })),
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
    if (method === 'GET' && route === '/api/lite/space') return ops.space(stateView().chats, { fresh: url.searchParams.get('fresh') === '1' });
    if (method === 'GET' && route === '/api/lite/worktree/state') return { state: ops.rebuildState(url.searchParams.get('id')) };
    if (method === 'GET' && route === '/api/lite/models') return models.get({ fresh: url.searchParams.get('fresh') === '1' });
    if (method === 'GET' && route === '/api/lite/signin') return signin.status(String(url.searchParams.get('id') || ''));
    if (method === 'GET' && route === '/api/lite/push') return ops.pushView(deviceOf(req));
    if (method === 'GET' && route === '/api/lite/images') return { images: images.list(), jobs: images.jobs() };
    if (method === 'GET' && route === '/api/lite/images/job') { const j = images.job(url.searchParams.get('id')); if (!j) throw fail(404, 'No such job.'); return { job: j }; }
    if (method === 'GET' && route === '/api/lite/plans') return plansView(url.searchParams.get('fresh') === '1');
    if (method !== 'POST') return undefined;
    const body = await readBody();
    const done = v => { broadcast('lite', {}); return v; };
    switch (route) {
      case '/api/lite/chats': return done({ chats: store.setChats(body.ids, body.patch || {}) });
      case '/api/lite/project': return done({ project: store.setProject(body.key, body.patch || {}) });
      case '/api/lite/buckets': return done({ buckets: store.setBuckets(body.buckets) });
      case '/api/lite/split': return done({ rules: store.setSplit(body.cwd, body.rules) });
      case '/api/lite/look': return done(store.setLook(body));
      case '/api/lite/archive': return done({ archived: store.archive(body, body.on !== false) });
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
      case '/api/lite/seen': return { seen: store.setSeen(Array.isArray(body.ids) ? body.ids : [], body.at) };
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
        if (!text.trim()) throw fail(400, 'Type a message.');
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
      case '/api/lite/desktop-rename': return done(desktopNames.queue(String(body.id || ''), body.title));
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
      case '/api/lite/push/subscribe': return ops.subscribe(deviceOf(req), body.subscription, req && req.headers['user-agent']);
      case '/api/lite/push/unsubscribe': return ops.unsubscribe(deviceOf(req));
      case '/api/lite/push/prefs': return { prefs: ops.setPrefs(body) };
      case '/api/lite/push/test': return { sent: await ops.notify('needs', { title: 'Switcher Lite', body: 'Phone alerts work. This is what a “Needs you” looks like.', tag: 'test', url: '/lite' }, { force: true }) };
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
  function routineAccount(id) {
    if (!store.get().routinesFollow || !id) return id;
    try {
      const plans = plansNow(), me = plans.find(p => p.id === id);
      if (!me || !['claude', 'chatgpt'].includes(me.family)) return id;
      const next = lite.useNextOrder(plans, store.get().plans.floor)[me.family][0];
      if (next && next !== id) log(`Lite: routine moved from ${me.label} to the use-next plan (${next})`);
      return next || id;
    } catch { return id; }
  }
  const deviceOf = req => (req && req.device ? req.device.id : 'mac');
  return { handle, plansView, stateView, startSampling, images, routineAccount };
}

module.exports = { createLiteRoutes };
