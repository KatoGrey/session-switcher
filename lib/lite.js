'use strict';
// Switcher Lite: a calmer view over the same chats (ui-lite/, served at /lite). This file holds what
// it adds on the server: lite.json (buckets, which project lives in which bucket, how a monorepo
// splits into projects, each chat's stage, the archive and the look), an hourly record of plan usage
// for pace forecasts, and the use-next order across plans.
//
// The pure parts (useNextOrder, forecast, cleanup filter, stage guess, split) take data in and touch
// nothing, so tests/lite.test.js can check them on their own. createLite() keeps the two files.

const fs = require('fs');
const path = require('path');
const store = require('./store');

const DAY = 864e5;
const WEEK = 7 * DAY;
// Each chat answers three questions apart: what kind of work it is, where it is (the status, keys
// 1–4 in the page), and two flags that can sit on any status: Focus (your top few) and Waiting (on
// someone, with a reminder).
const KINDS = ['feature', 'bug', 'prototype', 'idea'];
const STATUSES = ['exploring', 'building', 'finishing', 'done'];
// The single "stage" list this replaced, and where each old stage lands.
const OLD_STAGES = { priority: { focus: true }, explore: { status: 'exploring' }, feature: { kind: 'feature', status: 'building' }, bug: { kind: 'bug', status: 'building' }, waiting: { waiting: true }, final: { status: 'finishing' }, done: { status: 'done' } };
const FLOORS = [10, 15, 20];
const SKINS = ['plain', 'imperial', 'rebel'];
const MODES = ['system', 'light', 'dark'];
const QUIET_DAYS = [2, 4, 7];
const HISTORY_DAYS = 8;
// Permission modes a new chat from Lite can start in. Unset follows the full app's own setting.
const PERMS = { claude: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'], codex: ['ask', 'agent', 'read-only', 'full'] };

const DEFAULTS = () => ({
  buckets: [],
  projects: {},
  split: {},
  chats: {},
  archived: { chats: {}, projects: [] },
  look: { skin: 'plain', mode: 'system' },
  plans: { floor: 15, labels: {}, manualResets: [], ollamaReadings: [] },
  quietDays: 4,
  permissions: { claude: null, codex: null },
  routinesFollow: false,
  guess: {},
  seen: {},
  hackathon: null,
  ideas: [],
});

/* ---------- plans: use-next order and pace ---------- */

const usableFor = (p, floor) => p && !p.broken && !p.unlimited && typeof p.left === 'number' && p.left > floor && (p.family === 'claude' || p.family === 'chatgpt');

// Per family, the plan that resets soonest goes first, and each is drained to the floor before the
// next. Plans at or below the floor drop out. A plan whose week hasn't started (no reset time yet)
// goes last: nothing lapses by waiting on it. Ties: the one with less left first, so it empties.
function useNextOrder(plans, floor = 15) {
  const out = { claude: [], chatgpt: [] };
  for (const fam of Object.keys(out)) {
    out[fam] = plans.filter(p => p.family === fam && usableFor(p, floor))
      .sort((a, b) => (a.resetsAt ? Date.parse(a.resetsAt) : Infinity) - (b.resetsAt ? Date.parse(b.resetsAt) : Infinity) || a.left - b.left || String(a.id).localeCompare(String(b.id)))
      .map(p => p.id);
  }
  return out;
}

// How fast a plan is being used, from the last day of hourly samples ({ t, left }), or this week's
// average when there isn't a day of history yet. A reset inside the window (left jumps up) starts
// the measurement again from there. Returns the rate (% a day), where it would be at reset, when it
// would run dry, and a plain verdict.
function forecast(plan, samples = [], now = Date.now(), floor = 15) {
  if (!plan || typeof plan.left !== 'number') return null;
  const resetsAt = plan.resetsAt ? Date.parse(plan.resetsAt) : null;
  const recent = samples.filter(s => s && typeof s.left === 'number' && s.t <= now && now - s.t <= DAY).sort((a, b) => a.t - b.t);
  // Only the stretch since the last reset counts.
  let from = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i].left > recent[i - 1].left + 2) from = i;
  const run = recent.slice(from);
  if (!run.length || run[run.length - 1].t < now - 5 * 60e3) run.push({ t: now, left: plan.left });
  let rate = null, source = 'day';
  const span = run.length > 1 ? (run[run.length - 1].t - run[0].t) / DAY : 0;
  if (span >= 3 / 24) rate = Math.max(0, (run[0].left - run[run.length - 1].left) / span);
  if (rate === null) {
    source = 'week';
    const windowMs = plan.windowMins ? plan.windowMins * 60e3 : WEEK;
    const started = plan.startedAt ? Date.parse(plan.startedAt) : resetsAt ? resetsAt - windowMs : null;
    if (!started) return { rate: 0, source, atReset: plan.left, dryAt: null, kind: 'untouched' };
    const elapsed = Math.max(0.25, (now - started) / DAY);
    rate = Math.max(0, (100 - plan.left) / elapsed);
  }
  const daysLeft = resetsAt ? Math.max(0, (resetsAt - now) / DAY) : null;
  const atReset = daysLeft === null ? null : plan.left - rate * daysLeft;
  const dryAt = rate > 0 ? now + (plan.left / rate) * DAY : null;
  let kind;
  if (rate < 1) kind = 'untouched';
  else if (resetsAt && dryAt && dryAt < resetsAt - 6 * 3600e3) kind = 'dry';
  else if (atReset !== null && atReset <= floor) kind = 'onTarget';
  else kind = 'room';
  return { rate: Math.round(rate * 10) / 10, source, atReset: atReset === null ? null : Math.round(atReset), dryAt, kind, moreToUse: atReset === null ? null : Math.max(0, Math.round(atReset - floor)) };
}

/* ---------- Ollama: an estimate of the week, from request counts ---------- */

// ollama.com tells a signed-in app how many requests it made (per UTC day), not how much of the plan
// is used; only its settings page shows that. So you read the page now and then, and between
// readings the share is worked out from requests: the last reading's % per request, times this
// week's requests. Its week runs Monday 00:00 UTC to Monday (the page says so), unless a reading
// gives another reset time.
const MONDAY0 = Date.UTC(2026, 0, 5);
function ollamaWeek(byDay, readings = [], now = Date.now()) {
  const last = readings.length ? readings[readings.length - 1] : null;
  const anchor = last && last.resetsAt ? Date.parse(last.resetsAt) : MONDAY0;
  const start = now - ((((now - anchor) % WEEK) + WEEK) % WEEK);
  const requests = (byDay || []).filter(d => Date.parse(d.from) >= start).reduce((n, d) => n + (d.n || 0), 0);
  const out = { startedAt: new Date(start).toISOString(), resetsAt: new Date(start + WEEK).toISOString(), requests, used: null, reading: last };
  if (!last || !(last.requests > 0) || typeof last.pct !== 'number') return out;
  const perRequest = last.pct / last.requests;
  const sameWeek = Date.parse(last.at) >= start;
  const used = sameWeek ? last.pct + Math.max(0, requests - last.requests) * perRequest : requests * perRequest;
  return { ...out, used: Math.round(Math.min(100, Math.max(0, used)) * 10) / 10, perRequest, sameWeek };
}

/* ---------- stages, quiet, projects ---------- */

// First guesses from the title, until you set one (yours always wins and is never re-guessed).
function guessKind(title = '') {
  const t = String(title).toLowerCase();
  if (/\b(fix|bug|broken|crash|error|regression|polish|flaky|fails?|failing)\b/.test(t)) return 'bug';
  if (/\b(prototyp|spike|mock-?up|proof of concept|poc)/.test(t)) return 'prototype';
  if (/\b(idea|brainstorm|what if)\b/.test(t)) return 'idea';
  return null;
}
function guessStatus(title = '') {
  const t = String(title).toLowerCase();
  if (/\b(release notes|ship it|pr open|open (a )?pr|merge)\b/.test(t)) return 'finishing';
  if (/\b(investigat|explor|research|review|audit|assess|plan|prototyp|spike|compare|analy[sz]|why|what|how|look into|brainstorm|idea)/.test(t)) return 'exploring';
  return 'building';
}
// An old single stage moved onto kind, status and the flags. Leaves anything already set alone.
function fromOldStage(rec) {
  if (!rec || !rec.stage) return rec;
  const out = { ...rec }, m = OLD_STAGES[rec.stage] || {};
  delete out.stage;
  if (m.kind && !out.kind) out.kind = m.kind;
  if (m.status && !out.status) out.status = m.status;
  if (m.focus) out.focus = true;
  if (m.waiting) out.waiting = true;
  return out;
}

const isQuiet = (updated, now = Date.now(), days = 4) => !!updated && now - updated > days * DAY;

// A monorepo folder can hold several projects: rules match a chat's title (case-insensitive regex
// source). The first rule that matches wins; no match leaves it in the folder's own project.
function splitKey(cwd, title, rules) {
  if (!Array.isArray(rules) || !rules.length) return cwd;
  for (const r of rules) {
    if (!r || !r.project || !r.match) continue;
    let re; try { re = new RegExp(r.match, 'i'); } catch { continue; }
    if (re.test(String(title || ''))) return `${cwd}#${r.project}`;
  }
  const fallback = rules.find(r => r && r.project && r.default);
  return fallback ? `${cwd}#${fallback.project}` : cwd;
}

/* ---------- Free space: what may be removed from a worktree ---------- */

// Only dependencies, build output and caches. Never source, never .git, never anything outside the
// worktree, and never through a link. The caller also asks git that each one is ignored, so a
// committed folder named "build" stays.
const HEAVY = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', '.cache', '.parcel-cache', '.vite', '.svelte-kit', '.expo', '.nuxt', '.output']);
function isRemovable(root, target) {
  if (!root || !target) return false;
  const r = path.resolve(root), t = path.resolve(r, target);
  const rel = path.relative(r, t);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  if (parts.includes('.git')) return false;
  if (!HEAVY.has(parts[parts.length - 1])) return false;
  // Inside another heavy folder it goes with that one; don't list it twice.
  if (parts.slice(0, -1).some(p => HEAVY.has(p))) return false;
  return true;
}
function cleanupTargets(root, entries) { return (entries || []).filter(e => isRemovable(root, e)); }

/* ---------- checking what the page sends ---------- */

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const slug = v => str(v, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const isoOrNull = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null; };

function createLite({ dataDir, log = () => {}, onChange = () => {} }) {
  const FILE = path.join(dataDir, 'lite.json');
  const HIST = path.join(dataDir, 'lite-usage.json');
  let data = load();
  let hist = (() => { const j = store.loadOwnJson(HIST, null, log); return j && Array.isArray(j.samples) ? j.samples : []; })();

  function load() {
    const j = store.loadOwnJson(FILE, null, log) || {};
    const d = { ...DEFAULTS(), ...j };
    d.archived = { chats: {}, projects: [], ...(j.archived || {}) };
    if (Array.isArray(d.archived.chats)) d.archived.chats = Object.fromEntries(d.archived.chats.map(id => [id, { at: null }]));
    d.plans = { ...DEFAULTS().plans, ...(j.plans || {}) };
    d.look = { ...DEFAULTS().look, ...(j.look || {}) };
    d.permissions = { ...DEFAULTS().permissions, ...(j.permissions || {}) };
    d.guess = j.guess && typeof j.guess === 'object' ? j.guess : {};
    // Stages → kind, status and flags (once; the old key goes, so nothing reads it twice).
    for (const box of [d.chats, d.guess, d.archived.chats]) for (const [id, r] of Object.entries(box || {})) if (r && r.stage) box[id] = fromOldStage(r);
    if (d.guess) for (const g of Object.values(d.guess)) { if (g) { delete g.focus; delete g.waiting; } }
    d.seen = j.seen && typeof j.seen === 'object' ? j.seen : {};
    return d;
  }
  function save() {
    try { store.writeJsonAtomic(FILE, data, { keepBackup: true }); } catch (err) { log(`Lite: couldn’t save lite.json (${err.message})`); }
    onChange();
  }
  const get = () => data;

  /* ----- changes from the page ----- */

  function setChats(ids, patch) {
    const list = (Array.isArray(ids) ? ids : []).map(x => str(x, 80)).filter(Boolean).slice(0, 500);
    if (!list.length) throw Object.assign(new Error('Which chats?'), { status: 400 });
    for (const id of list) {
      const cur = { ...(data.chats[id] || {}) };
      // A page from before the change may still send a stage.
      if ('stage' in patch && patch.stage) { if (!OLD_STAGES[patch.stage]) throw Object.assign(new Error('Unknown stage.'), { status: 400 }); Object.assign(cur, fromOldStage({ stage: patch.stage })); }
      if ('status' in patch) { if (patch.status === null) delete cur.status; else if (STATUSES.includes(patch.status)) cur.status = patch.status; else throw Object.assign(new Error('Unknown status.'), { status: 400 }); }
      if ('kind' in patch) { if (patch.kind === null) delete cur.kind; else if (KINDS.includes(patch.kind)) cur.kind = patch.kind; else throw Object.assign(new Error('Unknown kind.'), { status: 400 }); }
      if ('focus' in patch) { if (patch.focus) cur.focus = true; else delete cur.focus; }
      const startsWaiting = 'waiting' in patch ? !!patch.waiting && !cur.waiting : cur.waiting && 'stage' in patch;
      if ('waiting' in patch) { if (patch.waiting) cur.waiting = true; else delete cur.waiting; }
      if ('waitingOn' in patch) { const w = str(patch.waitingOn, 60); if (w) cur.waitingOn = w; else delete cur.waitingOn; }
      if ('note' in patch) { const n = str(patch.note, 300); if (n) cur.note = n; else delete cur.note; }
      if ('remindAt' in patch) { const r = isoOrNull(patch.remindAt); if (r) cur.remindAt = r; else delete cur.remindAt; }
      if ('project' in patch) { const p = str(patch.project, 600); if (p) cur.project = p; else delete cur.project; }
      if (startsWaiting && !cur.remindAt) cur.remindAt = new Date(Date.now() + 2 * DAY).toISOString();
      if (!cur.waiting) { delete cur.remindAt; }
      if (Object.keys(cur).length) data.chats[id] = cur; else delete data.chats[id];
    }
    save();
    return list.map(id => ({ id, ...(data.chats[id] || {}) }));
  }
  function setProject(key, patch) {
    const k = str(key, 600);
    if (!k) throw Object.assign(new Error('Which project?'), { status: 400 });
    const cur = { ...(data.projects[k] || {}) };
    if ('bucket' in patch) { const b = patch.bucket === null ? '' : slug(patch.bucket); if (b && !data.buckets.some(x => x.id === b)) throw Object.assign(new Error('That bucket doesn’t exist.'), { status: 400 }); if (b) cur.bucket = b; else delete cur.bucket; }
    if ('image' in patch) { const i = str(patch.image, 400); if (i) cur.image = i; else delete cur.image; }
    if ('name' in patch) { const n = str(patch.name, 80); if (n) cur.name = n; else delete cur.name; }
    // Merged into another project: its chats show there, and it leaves the lists.
    if ('into' in patch) { const t = str(patch.into, 600); if (t && t !== k) cur.into = t; else delete cur.into; }
    if (Object.keys(cur).length) data.projects[k] = cur; else delete data.projects[k];
    save();
    return { key: k, ...cur };
  }
  function setBuckets(list) {
    if (!Array.isArray(list)) throw Object.assign(new Error('Send the list of buckets.'), { status: 400 });
    const seen = new Set();
    data.buckets = list.slice(0, 24).map(b => ({ id: slug(b.id || b.name), name: str(b.name, 40), stages: b.stages === undefined ? true : !!b.stages, account: b.account && typeof b.account === 'object' ? { claude: str(b.account.claude, 60) || undefined, codex: str(b.account.codex, 60) || undefined } : undefined }))
      .filter(b => b.id && b.name && !seen.has(b.id) && seen.add(b.id));
    save();
    return data.buckets;
  }
  function setSplit(cwd, rules) {
    const k = str(cwd, 600);
    if (!k) throw Object.assign(new Error('Which folder?'), { status: 400 });
    const clean = (Array.isArray(rules) ? rules : []).slice(0, 20).map(r => ({ project: slug(r.project), name: str(r.name, 60) || undefined, match: str(r.match, 300), default: !!r.default || undefined }))
      .filter(r => r.project && (r.match || r.default));
    for (const r of clean) { if (r.match) { try { new RegExp(r.match, 'i'); } catch { throw Object.assign(new Error(`“${r.match}” isn’t a pattern I can use.`), { status: 400 }); } } }
    if (clean.length) data.split[k] = clean; else delete data.split[k];
    save();
    return data.split[k] || [];
  }
  function setLook(patch) {
    if (SKINS.includes(patch.skin)) data.look.skin = patch.skin;
    if (MODES.includes(patch.mode)) data.look.mode = patch.mode;
    if (FLOORS.includes(Number(patch.floor))) data.plans.floor = Number(patch.floor);
    if (QUIET_DAYS.includes(Number(patch.quietDays))) data.quietDays = Number(patch.quietDays);
    if (patch.permissions && typeof patch.permissions === 'object') {
      for (const fam of ['claude', 'codex']) if (fam in patch.permissions) { const v = patch.permissions[fam]; data.permissions[fam] = PERMS[fam].includes(v) ? v : null; }
    }
    if ('routinesFollow' in patch) data.routinesFollow = !!patch.routinesFollow;
    if ('openLite' in patch) data.openLite = !!patch.openLite;
    if (patch.labels && typeof patch.labels === 'object') for (const [id, v] of Object.entries(patch.labels).slice(0, 20)) { const n = str(v, 40); if (n) data.plans.labels[str(id, 60)] = n; else delete data.plans.labels[str(id, 60)]; }
    save();
    return { look: data.look, floor: data.plans.floor, quietDays: data.quietDays, labels: data.plans.labels, permissions: data.permissions, routinesFollow: data.routinesFollow, openLite: !!data.openLite };
  }
  // Claude Code doesn't report Claude's manual resets, so they're added by hand.
  function addManualReset({ plan, expiresAt, note }) {
    const p = str(plan, 60), e = isoOrNull(expiresAt);
    if (!p) throw Object.assign(new Error('Which plan?'), { status: 400 });
    const r = { id: `mr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, plan: p, expiresAt: e, note: str(note, 120) || undefined, addedAt: new Date().toISOString() };
    data.plans.manualResets.push(r); save();
    return r;
  }
  // What Ollama's settings page said (% of the week used), with this week's requests at that moment.
  function addOllamaReading({ pct, requests, resetsAt, at = Date.now() }) {
    const p = Number(pct);
    if (!(p >= 0 && p <= 100)) throw Object.assign(new Error('Type the weekly % used, from 0 to 100.'), { status: 400 });
    const r = { at: new Date(at).toISOString(), pct: Math.round(p * 10) / 10, requests: Math.max(0, Math.round(Number(requests) || 0)), resetsAt: isoOrNull(resetsAt) || undefined };
    data.plans.ollamaReadings = [...(data.plans.ollamaReadings || []), r].slice(-12);
    save();
    return r;
  }
  function removeManualReset(id) {
    data.plans.manualResets = data.plans.manualResets.filter(r => r.id !== id); save();
    return data.plans.manualResets;
  }
  function setHackathon(patch) {
    const start = isoOrNull(patch.start), end = isoOrNull(patch.end);
    if ('start' in patch || 'end' in patch) data.hackathon = start && end ? { start, end } : null;
    if (Array.isArray(patch.ideas)) data.ideas = patch.ideas.slice(0, 60).map(x => ({ id: str(x.id, 40) || `i-${Math.random().toString(36).slice(2, 8)}`, text: str(x.text, 200) })).filter(x => x.text);
    save();
    return { hackathon: data.hackathon, ideas: data.ideas };
  }
  // Archive keeps a record of each chat (title, project, kind, status, model, branch, worktree), so Bring back
  // can put it where it was.
  function archive({ chats = [], projects = [], records = {} }, on = true) {
    for (const id of chats.map(x => str(x, 80)).filter(Boolean).slice(0, 500)) {
      if (on) { const r = records[id] && typeof records[id] === 'object' ? records[id] : {}; data.archived.chats[id] = { at: new Date().toISOString(), title: str(r.title, 200) || undefined, project: str(r.project, 600) || undefined, kind: KINDS.includes(r.kind) ? r.kind : undefined, status: STATUSES.includes(r.status) ? r.status : undefined, model: str(r.model, 80) || undefined, branch: str(r.branch, 200) || undefined, worktree: str(r.worktree, 600) || undefined, provider: str(r.provider, 20) || undefined }; }
      else delete data.archived.chats[id];
    }
    const ps = new Set(data.archived.projects);
    for (const k of projects.map(x => str(x, 600)).filter(Boolean)) { if (on) ps.add(k); else ps.delete(k); }
    data.archived.projects = [...ps];
    save();
    return data.archived;
  }

  /* ----- usage history ----- */

  // One row per plan per sample; a plan sampled less than 15 minutes ago isn't sampled again.
  function sample(plans, now = Date.now()) {
    let added = 0;
    for (const p of plans) {
      if (typeof p.left !== 'number') continue;
      const last = hist.filter(s => s.id === p.id).pop();
      if (last && now - last.t < 15 * 60e3 && last.left === p.left) continue;
      if (last && now - last.t < 15 * 60e3) { last.t = now; last.left = p.left; added++; continue; }
      hist.push({ id: p.id, t: now, left: p.left, ...(typeof p.fiveLeft === 'number' ? { five: p.fiveLeft } : {}) });
      added++;
    }
    if (!added) return;
    hist = hist.filter(s => now - s.t < HISTORY_DAYS * DAY);
    try { store.writeJsonAtomic(HIST, { samples: hist }); } catch (err) { log(`Lite: couldn’t save usage history (${err.message})`); }
  }
  const samplesFor = id => hist.filter(s => s.id === id);

  // Adds to an archived chat's record (its worktree was removed or rebuilt, say).
  function noteArchived(id, patch) {
    const r = data.archived.chats[id]; if (!r) return null;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null) delete r[k]; else r[k] = typeof v === 'string' ? v.slice(0, 600) : v; }
    save();
    return r;
  }

  // A first guess for a chat (kind, status, short title), never over one you set.
  function setGuess(id, g) {
    const k = str(id, 80); if (!k) return;
    // A git guess (pushed → Finishing) only adds to what the model guessed before.
    const base = g.keep ? { ...(data.guess[k] || {}) } : {};
    if (KINDS.includes(g.kind)) base.kind = g.kind;
    if (STATUSES.includes(g.status)) base.status = g.status;
    if (g.title) base.title = str(g.title, 60);
    data.guess[k] = { ...base, by: str(g.by, 60) || base.by || undefined, at: Date.now(), ...(g.none ? { none: true } : {}), ...(g.v ? { v: g.v } : {}) };
    saveSoon();
  }
  // What you've read, shared by every screen (Mac and phone). Kept for two weeks.
  function setSeen(ids, at = Date.now()) {
    for (const id of (ids || []).map(x => str(x, 80)).filter(Boolean).slice(0, 200)) data.seen[id] = Math.max(data.seen[id] || 0, Number(at) || Date.now());
    const cut = Date.now() - 14 * DAY;
    for (const k of Object.keys(data.seen)) if (data.seen[k] < cut) delete data.seen[k];
    saveSoon();
    return data.seen;
  }
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); };

  return { get, noteArchived, setGuess, setSeen, setChats, setProject, setBuckets, setSplit, setLook, addManualReset, removeManualReset, addOllamaReading, setHackathon, archive, sample, samplesFor, file: FILE };
}

module.exports = { PERMS, createLite, useNextOrder, forecast, ollamaWeek, guessKind, guessStatus, fromOldStage, isQuiet, splitKey, isRemovable, cleanupTargets, KINDS, STATUSES, HEAVY, DEFAULTS };
