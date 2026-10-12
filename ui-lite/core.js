'use strict';
/* Switcher Lite: state, the server, live updates, and the helpers every page uses.
   Data comes from /api/lite/state (projects, chats, what's live, routines, lite.json) and
   /api/lite/plans (each plan's week, reset, forecast and the use-next order). */

const TOKEN = window.TOKEN;
const REMOTE = !!window.REMOTE;
const $ = id => document.getElementById(id);
const DAY = 864e5;

// Ryan's own Codex folders, plus Feature and Done. Keys 1–7 set them. Names never change between skins.
// Where a chat is (keys 1–4). What kind of work it is, and the two flags (Focus, Waiting), sit apart
// from it, so a bug can be explored and a chat can be your focus while it's building.
const STATUSES = [
  { id: 'exploring', name: 'Exploring', c: 'var(--st-explore)' }, { id: 'building', name: 'Building', c: 'var(--st-feature)' },
  { id: 'finishing', name: 'Finishing', c: 'var(--st-final)' }, { id: 'done', name: 'Done', c: 'var(--st-done)' },
].map((s, i) => ({ ...s, key: String(i + 1) }));
const statusById = id => STATUSES.find(s => s.id === id) || STATUSES[1];
// Set once. Feature is the plain default and carries no tag.
const KINDS = [{ id: 'feature', name: 'Feature' }, { id: 'bug', name: 'Bug' }, { id: 'prototype', name: 'Prototype' }, { id: 'idea', name: 'Idea' }];
const kindById = id => KINDS.find(k => k.id === id) || null;
// Each skin renames a few places. Stage names stay put, so they always mean the same thing.
const COPY = {
  imperial: { Now: 'Bridge', Projects: 'Systems', Routines: 'Standing orders', 'Needs you': 'Awaiting orders', Running: 'Units engaged', 'New chat': 'New directive', Recents: 'Fleet log', 'Search chats': 'Search fleet records' },
  rebel: { Now: 'Briefing room', Projects: 'Hangar', Routines: 'Patrols', 'Needs you': 'Calling you', Running: 'In flight', 'New chat': 'New sortie', Recents: 'Flight log', 'Search chats': 'Search comms' },
};

/* ---------- this browser's own conveniences (never the real state) ---------- */
const local = {
  get(k, d) { try { const v = localStorage.getItem('lite:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lite:' + k, JSON.stringify(v)); } catch { /* fine */ } },
};

const S = {
  view: local.get('view', 'now'), project: null, bucket: local.get('bucket', 'all'), q: '',
  lite: null, projects: [], chats: [], live: [], routines: [], plans: null, now: Date.now(),
  folded: local.get('folded', { done: true }), more: {}, sel: new Set(), seen: local.get('seen', {}),
  cmd: { key: null, events: [], state: 'idle', error: null, es: null, sentAt: 0 },
  loaded: false, connected: false,
};
const L = t => (COPY[skin()] && COPY[skin()][t]) || t;
const skin = () => (S.lite && S.lite.look.skin) || local.get('skin', 'plain');

/* ---------- server ---------- */
async function api(p, body) {
  let r;
  try {
    r = await fetch(p, { method: body ? 'POST' : 'GET', headers: { 'X-Switcher-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Session Switcher isn’t running on your Mac right now.'); }
  const j = await r.json().catch(() => ({ error: 'Unexpected answer from the app.' }));
  if (r.status === 403 && j.reason === 'stale') { location.reload(); throw new Error('Reloading…'); }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}
const wrap = fn => async (...a) => { try { return await fn(...a); } catch (err) { toast(err.message); return undefined; } };

// Whole state (projects, chats, lite.json) only when chats or lite.json change; just the live list
// (what's running or waiting on you) on every live event. Nothing redraws unless something changed.
let loading = null, stateSig = '';
function loadState() {
  if (loading) return loading;
  loading = fetch('/api/lite/state', { headers: { 'X-Switcher-Token': TOKEN } }).then(async r => {
    if (r.status === 403) { location.reload(); return false; }
    const text = await r.text();
    if (!r.ok) throw new Error((JSON.parse(text || '{}').error) || r.statusText);
    const j = JSON.parse(text);
    const sig = text.replace(/"now":\d+/, '');
    const changed = sig !== stateSig;
    stateSig = sig;
    Object.assign(S, { lite: j.lite, projects: j.projects, chats: j.chats, routines: j.routines, now: j.now, appPermissions: j.appPermissions, permissionModes: j.permissionModes, loaded: true });
    for (const [k, v] of Object.entries(j.lite.seen || {})) if (!S.seen[k] || S.seen[k] < v) S.seen[k] = v;
    setLive(j.live);
    index();
    return changed;
  }).finally(() => { loading = null; });
  return loading;
}
let liveSig = '';
function setLive(list) {
  const sig = JSON.stringify(list);
  if (sig === liveSig) return false;
  const before = S.live;
  liveSig = sig; S.live = list; index();
  if (typeof onLiveChange === 'function') onLiveChange(before, list);
  return true;
}
async function loadLive() {
  const j = await api('/api/lite/live');
  S.now = j.now;
  if (setLive(j.live)) renderLive();
}
let plansLoading = null;
function loadPlans(fresh = false) {
  if (plansLoading && !fresh) return plansLoading;
  plansLoading = api(`/api/lite/plans${fresh ? '?fresh=1' : ''}`).then(j => { S.plans = j; }).finally(() => { plansLoading = null; });
  return plansLoading;
}

// Live updates come over the full app's own event stream.
const timers = {};
const later = (name, ms, fn) => { clearTimeout(timers[name]); timers[name] = setTimeout(() => fn().catch(() => {}), ms); };
function connect() {
  const es = new EventSource(`/api/events?token=${TOKEN}`);
  es.onopen = () => { S.connected = true; renderConn(); };
  es.onerror = () => { S.connected = false; renderConn(); };
  for (const ev of ['live', 'activity', 'running']) es.addEventListener(ev, () => later('live', 350, loadLive));
  for (const ev of ['sessions', 'lite', 'organize', 'routines']) es.addEventListener(ev, () => later('state', 1200, async () => { if (await loadState()) renderWhenIdle(); }));
  for (const ev of ['lite', 'routines']) es.addEventListener(ev, () => later('routines', 1500, async () => { await loadRoutines(); updateBadge(); if (['now', 'routines'].includes(S.view)) renderWhenIdle(); }));
  for (const ev of ['usage', 'accounts']) es.addEventListener(ev, () => later('plans', 1500, async () => { await loadPlans(false); renderPlansOnly(); }));
  loadRoutines().then(() => updateBadge()).catch(() => {});
  // "How long ago" moves on its own; only the live parts redraw for it.
  setInterval(() => { S.now = Date.now(); if (!document.hidden) renderLive(); }, 30e3);
}
// Background changes never redraw under your pointer: they wait until you've been still a moment
// and no menu or dialog is open.
let touchAt = 0;
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { touchAt = Date.now(); }, { passive: true, capture: true });
function renderWhenIdle() {
  clearTimeout(renderWhenIdle.t);
  const busy = Date.now() - touchAt < 1500 || $('popRoot').innerHTML || $('modalRoot').innerHTML || $('palRoot').innerHTML || drag;
  if (busy) { renderWhenIdle.t = setTimeout(renderWhenIdle, 700); return; }
  render();
}
const activeTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.value; };
function renderConn() { const c = $('conn'); c.classList.toggle('on', S.connected); c.title = S.connected ? 'Live: updates as chats move' : 'Not connected to your Mac'; }

/* ---------- derived data ---------- */
let projBy = new Map(), chatBy = new Map(), liveBy = new Map();
function index() {
  projBy = new Map(S.projects.map(p => [p.key, p]));
  chatBy = new Map(S.chats.map(c => [c.id, c]));
  liveBy = new Map(S.live.filter(x => x.sessionId).map(x => [x.sessionId.toLowerCase(), x]));
}
const buckets = () => (S.lite ? S.lite.buckets : []);
const bucketName = id => (buckets().find(b => b.id === id) || {}).name || 'Unsorted';
const projOf = c => projBy.get(c.project) || { key: c.project, name: 'Unknown', bucket: null };
const liveOf = c => liveBy.get(String(c.id).toLowerCase()) || null;
const quietDays = () => (S.lite ? S.lite.quietDays : 4);
const floor = () => (S.lite ? S.lite.plans.floor : 15);
const statusOf = c => c.status;
const kindTag = c => (c.kind && c.kind !== 'feature' ? `<span class="tag kind-tag k-${c.kind}">${kindById(c.kind).name}</span>` : '');
const focusStar = c => (c.focus ? '<span class="focus-star" title="Focus">★</span>' : '');
const waitTag = c => (c.waiting ? `<span class="tag wait-tag">${esc(c.waitingOn || 'Waiting')}</span>` : '');
// Needs you: asking for an OK or a question, or replied since you last looked.
const replied = x => x && !x.working && !(x.pending || []).length && x.finishedAt && S.now - x.finishedAt < 12 * 3600e3 && x.finishedAt > (S.seen[x.sessionId || x.key] || 0) && x.phase !== 'ended';
const asking = x => !!(x && (x.pending || []).length);
// A routine's own runs don't ask for you here: what matters from them comes through "From your routines".
const isRoutineRun = x => !!(x && x.sessionId && S.rt && S.rt.runIds && S.rt.runIds.has(String(x.sessionId).toLowerCase()));
const needsLive = x => !isRoutineRun(x) && (asking(x) || replied(x));
const needs = c => needsLive(liveOf(c));
const running = c => { const x = liveOf(c); return !!(x && x.working); };
// Quiet isn't a status: nothing has moved for a few days. Chats asking for you, running, in Focus or Waiting never go quiet.
const isQuiet = c => S.now - c.updated > quietDays() * DAY && !needs(c) && !running(c) && !c.waiting && !c.focus;
const visible = c => !c.archived && !c.desktopArchived && !c.auto && !c.routineRun && !(projOf(c).archived);
const allChats = () => S.chats.filter(visible);
const inBucket = c => S.bucket === 'all' || (S.bucket === 'unsorted' ? !projOf(c).bucket : projOf(c).bucket === S.bucket);
const live = cs => cs.filter(c => statusOf(c) !== 'done' && !isQuiet(c));
/* ---------- families: a chat and the sub-chats started from it ---------- */
const low = x => String(x || '').toLowerCase();
S.openFam = new Set(local.get('openFam', []));
// Visible chats by id, and each one's visible sub-chats.
function famIndex() {
  const vis = allChats(), by = new Map(vis.map(c => [low(c.id), c])), kids = new Map();
  for (const c of vis) if (c.parent && by.has(low(c.parent))) { const k = low(c.parent); if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); }
  for (const l of kids.values()) l.sort((a, b) => b.updated - a.updated);
  return { by, kids };
}
let famMemo = null;
const fam = () => famMemo || (famMemo = famIndex());
const kidsOf = id => fam().kids.get(low(id)) || [];
const descOf = (id, seen = new Set()) => { const out = []; for (const k of kidsOf(id)) { if (seen.has(k)) continue; seen.add(k); out.push(k, ...descOf(k.id, seen)); } return out; };
const parentOn = c => (c && c.parent ? fam().by.get(low(c.parent)) || null : null);
// Top of its family here: no visible parent, the parent lives in another project, or the parent is
// Done while this one isn't (follow-up work on a finished chat doesn't fold away with it).
const isTop = c => { const p = parentOn(c); return !p || p.project !== c.project || (statusOf(p) === 'done' && statusOf(c) !== 'done'); };
// A family is as recent as its newest member, and quiet only if every member is.
const famUpdated = c => Math.max(c.updated, ...descOf(c.id).map(k => k.updated));
const famQuiet = c => isQuiet(c) && descOf(c.id).every(isQuiet);
const famOpen = id => S.openFam.has(low(id));
function toggleFam(id, on) { const k = low(id); if (on === undefined ? !S.openFam.has(k) : on) S.openFam.add(k); else S.openFam.delete(k); local.set('openFam', [...S.openFam].slice(-200)); }
// Every archived or visible descendant, from the whole list (for archive and Bring back).
function descAll(id, seen = new Set()) { const out = []; for (const c of S.chats) if (c.parent && low(c.parent) === low(id) && !seen.has(c.id)) { seen.add(c.id); out.push(c.id, ...descAll(c.id, seen)); } return out; }

const focusList = () => allChats().filter(c => c.focus && statusOf(c) !== 'done').sort((a, b) => b.updated - a.updated);
// Bug chats live under Bugs (the sidebar's Bugs group and page), not in their projects' lists.
// A bug: one you marked, or one the guesser marked that came from a sweep or names a tracker issue
// (VOY-2573). A title alone ("Fix carousel swipe stiffness") isn't enough; those stay in their project.
const isBug = c => c.kind === 'bug' && (!(c.guessed && c.guessed.kind) || /\(from [^)]+\)\s*$|\b[A-Z]{2,6}-\d+\b/.test(c.fullTitle || c.title || ''));
const bugList = () => allChats().filter(isBug);
/* A bug's stage: Exploring (no fix yet: investigating, blocked or waiting on a question), Working (a
   fix is being built right now), Finish line (a PR is up: review, preview, testers, waiting to
   merge), Done (merged, or marked done). Taken from its PR and whether it's running; a stage you
   set by hand wins over the guess. */
const BUG_STAGES = [
  { id: 'exploring', name: 'Exploring', c: 'var(--st-explore)' },
  { id: 'building', name: 'Working', c: 'var(--st-feature)' },
  { id: 'finishing', name: 'Finish line', c: 'var(--st-final)' },
  { id: 'done', name: 'Done', c: 'var(--st-done)' },
];
const pipeItem = c => (S.pipeline && S.pipeline.byChat ? S.pipeline.byChat.get(c.id) || null : null);
function bugStage(c) {
  const it = pipeItem(c), st = statusOf(c), byHand = c.guessed && c.guessed.status === false;
  if (it && it.stage === 'merged') return 'done';
  if (byHand && st === 'done') return 'done';
  if (it && it.pr) return 'finishing';
  if (running(c)) return 'building';
  if (byHand && (st === 'building' || st === 'finishing')) return st;
  return 'exploring';
}
const chatsOfProject = k => allChats().filter(c => c.project === k && !isBug(c));
// Runs started by scripts, agents and routines: out of every list, all on the Automation page.
const automationList = () => S.chats.filter(c => !c.archived && (c.auto || c.routineRun)).sort((a, b) => b.updated - a.updated);
// What you've read is shared by every screen: kept here and on the Mac.
let seenOut = new Set();
const markSeen = id => {
  if (!id) return;
  S.seen[id] = Date.now();
  const cut = Date.now() - 3 * DAY; for (const k of Object.keys(S.seen)) if (S.seen[k] < cut) delete S.seen[k];
  local.set('seen', S.seen);
  seenOut.add(id); clearTimeout(markSeen.t);
  markSeen.t = setTimeout(() => { const ids = [...seenOut]; seenOut = new Set(); api('/api/lite/seen', { ids }).catch(() => {}); }, 500);
};

/* ---------- words and pictures ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => { const m = Math.round((S.now - t) / 6e4); if (m < 60) return `${Math.max(1, m)}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`; const d = Math.round(h / 24); return d < 14 ? `${d}d` : `${Math.round(d / 7)}w`; };
const since = t => { const m = Math.max(0, Math.round((S.now - t) / 6e4)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const ms = v => (typeof v === 'number' ? v : v ? Date.parse(v) : null);
const days = t => (ms(t) - S.now) / DAY;
const inWords = t => { const h = (ms(t) - S.now) / 36e5; return h < 0 ? 'now' : h < 1 ? `in ${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `in ${Math.round(h)}h` : `in ${Math.round(h / 24)}d`; };
const dayName = t => new Date(ms(t)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const wd = t => new Date(ms(t)).toLocaleDateString('en-US', { weekday: 'short' });
const md = t => new Date(ms(t)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const clock = t => new Date(ms(t)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const word = (n, one, many) => `<b>${n}</b> ${n === 1 ? one : many}`;
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const initials = n => String(n).replace(/[-_]/g, ' ').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const artStyle = p => (p.image && p.cwd ? `background-image:url('/api/image?token=${TOKEN}&cwd=${encodeURIComponent(p.cwd)}&path=${encodeURIComponent(p.image)}')` : `background:linear-gradient(135deg, hsl(${hue(p.name)} 20% 42%), hsl(${(hue(p.name) + 40) % 360} 24% 28%))`);
const artInner = p => (p.image ? '' : `<span class="ini">${esc(initials(p.name))}</span>`);
const IC = {
  pen: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.3 1.9a1.5 1.5 0 0 1 2.1 2.1l-7 7-2.9.8.8-2.9 7-7ZM2 13.5h12v1.5H2z" fill="currentColor"/></svg>',
  grid: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  dots: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>',
  pulse: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8.5h3l2-5 3 9 2-4h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  history: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  box: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  spark: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6.3" r="1.2" fill="currentColor"/><path d="M2.5 12l3.8-3.6 2.6 2.4 2-1.8 2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  broom: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.8 7.6 7.4M4 8.2l5.6 2.6-1.5 3.4c-1.8.4-4.3-.5-5.9-2.4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM6.9 1.5h2.2l.4 1.8 1.2.7 1.8-.6 1.1 1.9-1.4 1.2v1.4l1.4 1.2-1.1 1.9-1.8-.6-1.2.7-.4 1.8H6.9l-.4-1.8-1.2-.7-1.8.6-1.1-1.9 1.4-1.2V7.1L2.4 5.9l1.1-1.9 1.8.6 1.2-.7Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  flag: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75M13.2 2.6v2.9h-2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bug: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="5" width="7" height="8.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 5.2a2 2 0 0 1 4 0M8 8v5.3M2 8.5h2.5M11.5 8.5H14M2.8 4.5l2 1.5M13.2 4.5l-2 1.5M2.8 13l2-1.5M13.2 13l-2-1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  pr: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6"/></g></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></g></svg>',
  people: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6" cy="5.5" r="2.2"/><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5"/><path d="M10.5 3.6a2 2 0 0 1 0 3.8M12 9.8c1.1.5 1.8 1.6 2 3.2"/></g></svg>',
};

/* ---------- opening a chat in the full app's chat window ---------- */
// Inside Lite by default; { full: true } opens the full app's chat window (images, files, diffs).
function openChat(id, { full = false, provider = null } = {}) {
  if (!id) return;
  markSeen(id);
  if (!full) { go('chat', { chat: id, provider }); return; }
  const url = `/?chat=${encodeURIComponent(id)}&solo=1`;
  if (REMOTE || matchMedia('(max-width: 760px)').matches) { location.href = url; return; }
  const w = window.open(url, `ss-chat-${id}`, 'popup=yes,width=980,height=1040');
  if (!w) location.href = url;
  render();
}

/* ---------- toasts, menus, confirmations ---------- */
let lastUndo = null;
function toast(text, undo = null) {
  lastUndo = undo;
  const r = $('toastRoot');
  r.innerHTML = `<div class="toast"><span>${esc(text)}</span>${undo ? '<button id="undoBtn">Undo <kbd>z</kbd></button>' : ''}</div>`;
  r.querySelector('#undoBtn')?.addEventListener('click', () => { const u = lastUndo; lastUndo = null; r.innerHTML = ''; if (u) wrap(u)(); });
  clearTimeout(toast.t); toast.t = setTimeout(() => { r.innerHTML = ''; lastUndo = null; }, 6000);
}
function closePop() { $('popRoot').innerHTML = ''; }
function pop(anchor, html, onPick, at) {
  const r = at || anchor.getBoundingClientRect();
  const root = $('popRoot');
  root.innerHTML = `<div class="pop-back"></div><div class="pop" role="menu">${html}</div>`;
  const el = root.querySelector('.pop');
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + 'px';
  el.style.top = Math.max(16, r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  root.querySelector('.pop-back').addEventListener('click', closePop);
  root.querySelector('.pop-back').addEventListener('contextmenu', e => { e.preventDefault(); closePop(); });
  el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; closePop(); onPick(b.dataset.v); });
  el.querySelector('button')?.focus();
}
// A plain yes/no before anything that can't be taken back (spending a manual reset, say).
function confirmBox({ title, body, yes = 'Go ahead', no = 'Cancel' }) {
  return new Promise(resolve => {
    const root = $('modalRoot');
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle"><h3 id="mTitle">${esc(title)}</h3><p>${body}</p><div class="acts"><button class="btn" data-m="no">${esc(no)}</button><button class="btn prime" data-m="yes">${esc(yes)}</button></div></div></div>`;
    const done = v => { root.innerHTML = ''; resolve(v); };
    root.querySelector('[data-m="yes"]').focus();
    root.querySelector('.modal-back').addEventListener('click', e => { if (e.target.classList.contains('modal-back')) done(false); const b = e.target.closest('[data-m]'); if (b) done(b.dataset.m === 'yes'); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); }, { once: true });
  });
}

/* ---------- changing things (each with Undo) ---------- */
const changeWords = (ids, patch) => {
  const n = ids.length === 1 ? '' : ` (${ids.length} chats)`;
  if (patch.status) return `Moved to ${statusById(patch.status).name}${n}`;
  if (patch.kind) return `Marked as ${kindById(patch.kind).name}${n}`;
  if ('focus' in patch) return patch.focus ? `In Focus${n}` : `Out of Focus${n}`;
  if (patch.waiting === false) return `No longer waiting${n}`;
  return ids.length === 1 ? 'Moved 1 chat' : `Moved ${ids.length} chats`;
};
async function setChats(ids, patch, label) {
  // Undo puts back exactly what was there, guesses included (a guessed status goes back to a guess).
  const prev = ids.map(id => { const c = chatBy.get(id) || {}, g = c.guessed || {}; return { id, patch: { status: g.status ? null : c.status, kind: g.kind ? null : c.kind || null, focus: !!c.focus, waiting: !!c.waiting, waitingOn: c.waitingOn || '', note: c.note || '', remindAt: c.remindAt || null } }; });
  await api('/api/lite/chats', { ids, patch });
  // Show it straight away; the server's own list follows.
  for (const id of ids) {
    const c = chatBy.get(id); if (!c) continue;
    for (const k of ['status', 'kind']) if (k in patch && patch[k]) { c[k] = patch[k]; c.guessed = { ...(c.guessed || {}), [k]: false }; }
    for (const k of ['focus', 'waiting']) if (k in patch) c[k] = !!patch[k];
    for (const k of ['waitingOn', 'note']) if (k in patch) c[k] = patch[k] || null;
  }
  S.sel.clear(); sfx('slide'); render();
  toast(label || changeWords(ids, patch), async () => {
    for (const p of prev) await api('/api/lite/chats', { ids: [p.id], patch: p.patch });
    sfx('undo'); await loadState(); render();
  });
}
// Renaming a chat: Claude chats keep the name in Switcher's own list, and one from the Claude desktop
// app is renamed there too (once the app is closed); Codex chats are renamed in Codex itself. Undo
// goes back to the name it had.
async function renameChat(id, name) {
  const c = chatBy.get(id);
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!n || (c && n === c.title)) return;
  const before = c ? c.fullTitle || c.title : '', shown = c ? c.title : '';
  const j = await api('/api/chat/rename', { sessionId: id, name: n });
  if (c) { c.title = j.title || n; c.fullTitle = c.title; }
  // A chat from the Claude desktop app is renamed there too, now if it's closed or when it next is.
  let where = '';
  if (c && c.desktop) {
    const d = await api('/api/lite/desktop-rename', { id, title: c.title }).catch(() => null);
    where = !d ? ' (Claude Desktop keeps its old name)' : d.queued ? '. Claude Desktop shows it after it next quits and reopens' : ', here and in Claude Desktop';
  }
  sfx('card'); render(); if (typeof paintHead === 'function') paintHead();
  toast(`Renamed to “${c ? c.title : n}”${where}`, async () => {
    await api('/api/chat/rename', { sessionId: id, name: before });
    if (c && c.desktop) await api('/api/lite/desktop-rename', { id, title: before }).catch(() => {});
    if (c) { c.title = shown; c.fullTitle = before; } sfx('undo'); render(); if (typeof paintHead === 'function') paintHead();
  });
}
function askRename(id) {
  const c = chatBy.get(id); if (!c) return;
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><form class="modal" id="rcForm"><h3>Rename chat</h3><input name="n" class="field" value="${esc(c.title)}" aria-label="Name"><div class="acts"><button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Rename</button></div></form></div>`;
  const f = root.querySelector('#rcForm'), close = () => { root.innerHTML = ''; };
  root.querySelector('[data-m="no"]').onclick = close;
  f.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  f.onsubmit = wrap(async e => { e.preventDefault(); const v = f.n.value; close(); await renameChat(id, v); });
  f.n.focus(); f.n.select();
}
// f: Focus on, or off when every one of them is already in Focus.
const toggleFocus = ids => setChats(ids, { focus: !ids.every(id => (chatBy.get(id) || {}).focus) });
async function setLook(patch) {
  const j = await api('/api/lite/look', patch);
  Object.assign(S.lite.look, j.look); S.lite.plans.floor = j.floor; S.lite.quietDays = j.quietDays; S.lite.permissions = j.permissions; S.lite.routinesFollow = j.routinesFollow; S.lite.openLite = j.openLite; S.lite.autoStartWeeks = j.autoStartWeeks;
  if (patch.skin) local.set('skin', patch.skin);
  if (patch.mode) local.set('mode', patch.mode);
  if (patch.floor) await loadPlans(false);
  render();
}
function applyLook() {
  const root = document.documentElement;
  const look = S.lite ? S.lite.look : { skin: local.get('skin', 'plain'), mode: local.get('mode', 'system') };
  root.dataset.skin = look.skin;
  if (typeof applyIcon === 'function') applyIcon(look.skin);
  if (look.mode === 'system') delete root.dataset.theme; else root.dataset.theme = look.mode;
}

/* ---------- archive (with a record, so Bring back puts it where it was) ---------- */
const recordOf = c => ({ title: c.title, project: c.project, kind: c.guessed && c.guessed.kind ? undefined : c.kind || undefined, status: c.guessed && c.guessed.status ? undefined : c.status, model: c.model || undefined, branch: c.branch || undefined, worktree: c.worktree || undefined, provider: c.provider });
// A family goes together: archiving a chat archives its sub-chats, and Bring back brings them back.
async function archiveChats(picked) {
  const ids = [...new Set([...picked, ...picked.flatMap(id => descOf(id).map(k => k.id))])];
  const extra = ids.length - picked.length;
  const records = Object.fromEntries(ids.map(id => [id, recordOf(chatBy.get(id) || {})]));
  await api('/api/lite/archive', { chats: ids, records });
  for (const id of ids) { const c = chatBy.get(id); if (c) c.archived = true; }
  S.sel.clear(); sfx('shove'); render();
  toast(`Archived ${picked.length === 1 ? '1 chat' : `${picked.length} chats`}${extra ? ` and ${extra === 1 ? 'its sub-chat' : `${extra} sub-chats`}` : ''}`, async () => { await api('/api/lite/archive', { chats: ids, on: false }); for (const id of ids) { const c = chatBy.get(id); if (c) c.archived = false; } sfx('undo'); render(); });
}
async function unarchiveChats(picked) {
  const ids = [...new Set([...picked, ...picked.flatMap(id => descAll(id).filter(k => (chatBy.get(k) || {}).archived))])];
  const extra = ids.length - picked.length;
  await api('/api/lite/archive', { chats: ids, on: false });
  for (const id of ids) { const c = chatBy.get(id); if (c) c.archived = false; }
  sfx('slide'); await loadState(); render();
  toast(`Brought back ${picked.length === 1 ? '1 chat' : `${picked.length} chats`}${extra ? ` and ${extra === 1 ? 'its sub-chat' : `${extra} sub-chats`}` : ''}`);
}
// Nest chats under another (or take them out with parent null). Undo puts each back where it was.
async function nestChats(ids, parentId) {
  const prev = ids.map(id => ({ id, parent: (parentOn(chatBy.get(id)) || {}).id || null }));
  for (const id of ids) if (low(id) !== low(parentId)) await api('/api/lite/parent', { id, parent: parentId || null });
  if (parentId) toggleFam(parentId, true);
  sfx('card'); await loadState(); render();
  const p = parentId ? chatBy.get(parentId) : null;
  toast(p ? `Now under “${p.title.slice(0, 50)}”` : `${ids.length === 1 ? 'It’s' : 'They’re'} on ${ids.length === 1 ? 'its' : 'their'} own now`, async () => {
    for (const x of prev) await api('/api/lite/parent', { id: x.id, parent: x.parent });
    sfx('undo'); await loadState(); render();
  });
}
// Pick a chat to nest under: the same project's chats first, then everything, filtered as you type.
function pickParent(anchor, ids) {
  const me = chatBy.get(ids[0]); if (!me) return;
  const not = new Set(ids.flatMap(id => [low(id), ...descOf(id).map(k => low(k.id))]));
  const list = allChats().filter(c => !not.has(low(c.id))).sort((a, b) => Number(b.project === me.project) - Number(a.project === me.project) || b.updated - a.updated);
  const rowsFor = q => list.filter(c => !q || c.title.toLowerCase().includes(q)).slice(0, 40).map(c => `<button data-v="${esc(c.id)}">${esc(c.title.slice(0, 60))}<small>${esc(projOf(c).name)}</small></button>`).join('') || '<div class="ph">No match</div>';
  pop(anchor, `<div class="ph">Put ${ids.length === 1 ? 'it' : 'them'} under…</div><input class="pop-q" id="npQ" placeholder="Type to filter" aria-label="Filter chats"><div id="npList">${rowsFor('')}</div>`, v => wrap(nestChats)(ids, v));
  const q = $('npQ'); if (q) { q.focus(); q.addEventListener('input', () => { $('npList').innerHTML = rowsFor(q.value.trim().toLowerCase()); }); }
}
async function archiveProject(k, on = true) {
  await api('/api/lite/archive', { projects: [k], on });
  const p = projBy.get(k); if (p) p.archived = on;
  if (on && S.view === 'project' && S.project === k) go('home');
  sfx(on ? 'shove' : 'slide'); render();
  if (on) toast(`Archived ${p ? p.name : 'the project'}`, () => archiveProject(k, false));
}
// Waiting on someone: who, and an optional note. A reminder comes after two days.
function askWaiting(ids) {
  const c = chatBy.get(ids[0]) || {};
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><form class="modal" id="wForm"><h3>Waiting on…</h3><p>${ids.length > 1 ? `${ids.length} chats` : esc(c.title || '')}. A reminder comes after two days.</p>
    <input name="who" class="field" placeholder="Who (CQA, a dev, legal…)" value="${esc(c.waitingOn || '')}" aria-label="Who">
    <input name="note" class="field" placeholder="Note (optional): what you’re waiting for" value="${esc(c.note || '')}" aria-label="Note">
    <div class="acts">${ids.some(id => (chatBy.get(id) || {}).waiting) ? '<button class="btn" type="button" data-m="stop" style="margin-right:auto">Not waiting any more</button>' : ''}<button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Set waiting</button></div></form></div>`;
  const f = root.querySelector('#wForm');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-m="no"]').onclick = close;
  const stop = root.querySelector('[data-m="stop"]'); if (stop) stop.onclick = wrap(async () => { close(); await setChats(ids, { waiting: false }); });
  f.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  f.onsubmit = wrap(async e => { e.preventDefault(); close(); await setChats(ids, { waiting: true, waitingOn: f.who.value.trim(), note: f.note.value.trim() }, `Waiting on ${f.who.value.trim() || 'someone'}. A reminder comes after two days.`); });
  f.who.focus(); f.who.select();
}
