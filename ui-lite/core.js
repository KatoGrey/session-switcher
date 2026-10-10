'use strict';
/* Switcher Lite: state, the server, live updates, and the helpers every page uses.
   Data comes from /api/lite/state (projects, chats, what's live, routines, lite.json) and
   /api/lite/plans (each plan's week, reset, forecast and the use-next order). */

const TOKEN = window.TOKEN;
const REMOTE = !!window.REMOTE;
const $ = id => document.getElementById(id);
const DAY = 864e5;

// Ryan's own Codex folders, plus Feature and Done. Keys 1–7 set them. Names never change between skins.
const STAGES = [
  { id: 'priority', name: 'Priority' }, { id: 'explore', name: 'Exploration' }, { id: 'feature', name: 'Feature' },
  { id: 'bug', name: 'Bugs and polish' }, { id: 'waiting', name: 'Waiting' }, { id: 'final', name: 'Finish line' }, { id: 'done', name: 'Done' },
].map((s, i) => ({ ...s, key: String(i + 1), c: `var(--st-${s.id})` }));
const stageById = id => STAGES.find(s => s.id === id) || STAGES[2];
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

let loading = null;
function loadState() {
  if (loading) return loading;
  loading = api('/api/lite/state').then(j => {
    Object.assign(S, { lite: j.lite, projects: j.projects, chats: j.chats, live: j.live, routines: j.routines, now: j.now, appPermissions: j.appPermissions, permissionModes: j.permissionModes, loaded: true });
    index();
  }).finally(() => { loading = null; });
  return loading;
}
let plansLoading = null;
function loadPlans(fresh = false) {
  if (plansLoading && !fresh) return plansLoading;
  plansLoading = api(`/api/lite/plans${fresh ? '?fresh=1' : ''}`).then(j => { S.plans = j; }).finally(() => { plansLoading = null; });
  return plansLoading;
}

// Live updates: the full app's own event stream. Anything that changes chats, usage or lite.json
// reloads the matching data (gently: at most every second or so).
let reloadTimer = null, plansTimer = null;
function soon(fn, which) {
  if (which === 'plans') { clearTimeout(plansTimer); plansTimer = setTimeout(() => fn().then(render).catch(() => {}), 1500); return; }
  clearTimeout(reloadTimer); reloadTimer = setTimeout(() => fn().then(render).catch(() => {}), 700);
}
function connect() {
  const es = new EventSource(`/api/events?token=${TOKEN}`);
  es.onopen = () => { S.connected = true; renderConn(); };
  es.onerror = () => { S.connected = false; renderConn(); };
  for (const ev of ['sessions', 'live', 'activity', 'running', 'lite', 'organize', 'routines']) es.addEventListener(ev, () => soon(loadState));
  for (const ev of ['usage', 'accounts']) es.addEventListener(ev, () => soon(() => loadPlans(false), 'plans'));
  // Reply times and "how long ago" move on their own.
  setInterval(() => { S.now = Date.now(); if (!document.hidden && !activeTyping()) render(); }, 30e3);
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
const stageOf = c => c.stage;
// Needs you: asking for an OK or a question, or replied since you last looked.
const replied = x => x && !x.working && !(x.pending || []).length && x.finishedAt && S.now - x.finishedAt < 12 * 3600e3 && x.finishedAt > (S.seen[x.sessionId || x.key] || 0) && x.phase !== 'ended';
const asking = x => !!(x && (x.pending || []).length);
const needsLive = x => asking(x) || replied(x);
const needs = c => needsLive(liveOf(c));
const running = c => { const x = liveOf(c); return !!(x && x.working); };
// Quiet isn't a stage: nothing has moved for a few days. Chats asking for you, running or Waiting never go quiet.
const isQuiet = c => S.now - c.updated > quietDays() * DAY && !needs(c) && !running(c) && stageOf(c) !== 'waiting';
const visible = c => !c.archived && !c.desktopArchived && !c.auto && !(projOf(c).archived);
const allChats = () => S.chats.filter(visible);
const inBucket = c => S.bucket === 'all' || (S.bucket === 'unsorted' ? !projOf(c).bucket : projOf(c).bucket === S.bucket);
const live = cs => cs.filter(c => stageOf(c) !== 'done' && !isQuiet(c));
const chatsOfProject = k => allChats().filter(c => c.project === k);
const markSeen = id => { if (!id) return; S.seen[id] = Date.now(); const cut = Date.now() - 3 * DAY; for (const k of Object.keys(S.seen)) if (S.seen[k] < cut) delete S.seen[k]; local.set('seen', S.seen); };

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
  flag: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
};

/* ---------- opening a chat in the full app's chat window ---------- */
function openChat(id) {
  if (!id) return;
  markSeen(id);
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
  r.innerHTML = `<div class="toast"><span>${esc(text)}</span>${undo ? '<button id="undoBtn">Undo</button>' : ''}</div>`;
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
async function setChats(ids, patch, label) {
  const prev = ids.map(id => { const c = chatBy.get(id) || {}; return { id, stage: c.guessed ? null : c.stage, waitingOn: c.waitingOn || '' }; });
  await api('/api/lite/chats', { ids, patch });
  // Show it straight away; the server's own list follows.
  for (const id of ids) { const c = chatBy.get(id); if (c && patch.stage !== undefined) { c.stage = patch.stage; c.guessed = false; } if (c && patch.waitingOn !== undefined) c.waitingOn = patch.waitingOn || null; }
  S.sel.clear(); render();
  toast(label || `${ids.length === 1 ? 'Moved 1 chat' : `Moved ${ids.length} chats`}${patch.stage ? ` to ${stageById(patch.stage).name}` : ''}`, async () => {
    for (const p of prev) await api('/api/lite/chats', { ids: [p.id], patch: { stage: p.stage, waitingOn: p.waitingOn } });
    await loadState(); render();
  });
}
async function setLook(patch) {
  const j = await api('/api/lite/look', patch);
  Object.assign(S.lite.look, j.look); S.lite.plans.floor = j.floor; S.lite.quietDays = j.quietDays; S.lite.permissions = j.permissions;
  if (patch.skin) local.set('skin', patch.skin);
  if (patch.mode) local.set('mode', patch.mode);
  if (patch.floor) await loadPlans(false);
  render();
}
function applyLook() {
  const root = document.documentElement;
  const look = S.lite ? S.lite.look : { skin: local.get('skin', 'plain'), mode: local.get('mode', 'system') };
  root.dataset.skin = look.skin;
  if (look.mode === 'system') delete root.dataset.theme; else root.dataset.theme = look.mode;
}
