'use strict';
/* Shared helpers, plan usage, what each running chat is doing, the data the hub shows, and keyed patching (live updates that leave hover, focus and typing alone). */

const TOKEN = window.TOKEN;
// A chat popped out into its own window (?chat=<id>&solo=1): just that chat, side by side with the rest.
const PAGE_ARGS = new URLSearchParams(location.search);
const SOLO = PAGE_ARGS.get('solo') === '1';
const canPopOut = () => !window.REMOTE && !window.Android && !SOLO;
function popOutChat(id) {
  if (!id) { toast('Send a message first.'); return; }
  const w = window.open(`/?chat=${encodeURIComponent(id)}&solo=1`, `ss-chat-${id}`, 'popup=yes,width=980,height=1040');
  if (!w) toast('The window was blocked. Allow pop-ups for Session Switcher, then try again.', 7000);
}
const RINGS = ['#c98a7c', '#9d8ce0', '#c58a4f', '#b9a3c9', '#d79bb6', '#cfc3a6'];
const CODEX_RING = '#6f97d8';
const GLYPHS = ['❖', '◈', '◆', '☘', '☾', '✥', '⚑', '⚔', '✧', '❝', '➤', '◉'];
const WORKING = new Set(['thinking', 'writing', 'tool', 'starting']);
const $ = id => document.getElementById(id);
const S = {
  accounts: [], projects: [], running: {}, live: {}, acct: null, view: 'hub', folder: null, dryRun: false,
  pins: new Set(), prefs: {}, hits: null, q: '', index: null, drawerId: null,
  activity: [], usage: {}, connected: false, seen: {}, codex: null, worlds: {}, prompts: [], worldTab: 'chats',
};
const inApp = () => S.prefs.openIn !== 'terminal';
const liveOf = id => S.live[String(id).toLowerCase()] || null;

/* ---------- small helpers ---------- */
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; }
try { S.pins = new Set(JSON.parse(store('pins') || '[]')); } catch { /* none */ }
try { S.seen = JSON.parse(store('seen') || '{}') || {}; } catch { S.seen = {}; }
S.recentProv = store('recentProv') || 'all';
const savePins = () => store('pins', JSON.stringify([...S.pins]));
// Favorite chats (pinned to the top of the sidebar), and sidebar sections you've folded away.
try { S.favs = new Set(JSON.parse(store('favChats') || '[]')); } catch { S.favs = new Set(); }
try { S.navFold = new Set(JSON.parse(store('navFold') || '[]')); } catch { S.navFold = new Set(); }
function togglePin(cwd) {
  const on = !S.pins.has(cwd);
  if (on) S.pins.add(cwd); else S.pins.delete(cwd);
  savePins(); renderNav();
  if (S.view === 'hub') renderHubLists(); else if (S.view === 'folder') renderPage();
  toast(on ? `Pinned ${S.projects.find(p => p.cwd === cwd)?.name || 'it'} to the sidebar.` : 'Unpinned.', 4000, { label: 'Undo', run: () => togglePin(cwd) });
}
function toggleFav(id) {
  const k = String(id).toLowerCase(), on = !S.favs.has(k);
  if (on) S.favs.add(k); else S.favs.delete(k);
  store('favChats', JSON.stringify([...S.favs]));
  renderNav(); if (window.ChatUI && ChatUI.refreshFav) { ChatUI.refreshFav(); ChatUI.renderRail(); }
  toast(on ? 'Pinned the chat to the sidebar.' : 'Unpinned the chat.', 4000, { label: 'Undo', run: () => toggleFav(id) });
}
const isFav = id => !!id && S.favs.has(String(id).toLowerCase());
window.toggleFav = toggleFav; window.isFav = isFav;
function openChatFromNav(id) {
  const [s] = sessionById(id); if (!s) return toast('That chat isn’t in the list any more.');
  if (liveOf(s.id)) return ChatUI.open({ sessionId: s.id });
  if (isRunning(s.id)) return ChatUI.watch({ sessionId: s.id, source: 'terminal' });
  return inApp() ? ChatUI.open({ sessionId: s.id }) : openDrawer(s.id);
}

async function api(p, body) {
  let r;
  try {
    r = await fetch(p, { method: body ? 'POST' : 'GET', headers: { 'X-Switcher-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Session Switcher isn’t running. Start it again from its shortcut or “Start Claude Switcher.bat”.');
  }
  const j = await r.json().catch(() => ({ error: 'Unexpected answer from the app.' }));
  if (r.status === 403 && (j.reason === 'stale' || !j.error)) { location.reload(); throw new Error('Reloading…'); }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { reason: j.reason, status: r.status });
  return j;
}

let toastTimer;
// A short message at the bottom. With an action ({ label, run }), it carries a button, like Undo.
function toast(msg, ms = 5000, action = null) {
  const t = $('toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); wrap(action.run)(); };
    t.append(' ', b);
  }
  t.classList.toggle('has-act', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}
function wrap(fn) { return async (...args) => { try { return await fn(...args); } catch (err) { if (err.message !== 'Reloading…') toast(err.message, 9000); if (err.reason) reload().catch(() => {}); } return undefined; }; }

/* ---------- copying ---------- */
// Copies text wherever the app runs. The clipboard API only works on a secure page (the PC's own
// window); phone access is plain http on the home network, where phones refuse it. There the
// browser's older copy command still works, and if even that's refused, a sheet opens with the text
// selected, to copy by hand. Phones only allow copying during a tap, so call this straight from one.
// what: the toast to show (null: none). Resolves true when it copied.
function copyText(text, what = 'Copied.') {
  text = String(text ?? '');
  const done = () => { if (what) toast(what, 1600); return true; };
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(done, () => (legacyCopy(text) ? done() : copySheet(text)));
  }
  return Promise.resolve(legacyCopy(text) ? done() : copySheet(text));
}
function legacyCopy(text) {
  const active = document.activeElement, sel = document.getSelection(), ranges = [];
  for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Out of sight; 16px so an iPhone doesn't zoom in on it.
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:2em;height:2em;padding:0;border:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  let ok = false;
  try { ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  sel.removeAllRanges(); for (const r of ranges) sel.addRange(r);
  if (active && active !== document.body && active.focus) active.focus({ preventScroll: true });
  return ok;
}
// The last resort: the text in a sheet, selected. In a text box, a phone's Select all keeps to the box.
function copySheet(text) {
  let d = $('copyDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="copyDlg" class="copy-dlg" aria-labelledby="copyT"><div class="setup-head"><h3 id="copyT">Copy this</h3><button type="button" class="icon" data-copy-close aria-label="Close">✕</button></div>
      <p class="copy-hint">This device didn’t let the app copy it for you. Press and hold the text, choose Select all, then Copy.</p><textarea id="copyTa" readonly spellcheck="false"></textarea>
      <div class="d-row"><button type="button" class="btn" data-copy-all>Select all</button><button type="button" class="btn prime" data-copy-close>Done</button></div></dialog>`);
    d = $('copyDlg');
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-copy-close]')) d.close();
      else if (e.target.closest('[data-copy-all]')) { const ta = $('copyTa'); ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); }
    });
  }
  const ta = $('copyTa');
  ta.value = text;
  if (!d.open) d.showModal();
  ta.scrollTop = 0; ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
  return false;
}

// A saga theme's own words for a piece of text (theme.js); other themes keep the text as it is.
const voice = (text, vars) => Look.say(text, vars);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const glyphFor = name => GLYPHS[hash(name) % GLYPHS.length];
const initial = s => (String(s).trim()[0] || '?').toUpperCase();
const plural = (n, w, many) => `${n} ${n === 1 ? w : (many || `${w}s`)}`;
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const nword = (n, cap = true) => { const w = n < WORDS.length ? WORDS[n] : String(n); return cap ? w : w.toLowerCase(); };
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const agoL = t => { const v = ago(t); return /^[A-Z][a-z]{2} \d/.test(v) ? v : v.toLowerCase(); };
const stamp = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function dur(ms, withSeconds) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return withSeconds ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
// "6:12 PM", "tomorrow 9:48 AM", "Sat 9:48 PM" or "Oct 14".
function when(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const now = new Date(), day = 864e5;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= midnight && t < midnight + day) return clock(t);
  if (t >= midnight + day && t < midnight + 2 * day) return `tomorrow ${clock(t)}`;
  if (t > now.getTime() && t < midnight + 7 * day) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(t)}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const current = () => S.accounts.find(a => a.id === S.acct) || S.accounts[0];
const ringOf = a => RINGS[Math.max(0, S.accounts.indexOf(a)) % RINGS.length];
// Codex accounts: the main one plus any extra ChatGPT or Ollama accounts. S.codex is the active one
// (new Codex chats run as it); S.codex.accounts lists them all. Each keeps a Codex-family color.
const CODEX_RINGS = [CODEX_RING, '#5fc4c9', '#8f7fe0', '#7fb79a', '#c9a24c'];
const codexAccts = () => (S.codex ? (S.codex.accounts && S.codex.accounts.length ? S.codex.accounts : [S.codex]) : []);
const codexAcct = id => codexAccts().find(x => x.id === id) || null;
const codexRing = id => CODEX_RINGS[Math.max(0, codexAccts().findIndex(x => x.id === id)) % CODEX_RINGS.length];
async function setCodexActive(id) {
  if (!S.codex || !id || S.codex.id === id || !codexAcct(id)) return;
  const r = await api('/api/codex/active', { id });
  S.codex = r.codex; renderAll();
}
const ringById = id => { if (codexAcct(id)) return codexRing(id); const a = S.accounts.find(x => x.id === id); return a ? ringOf(a) : 'var(--ash-2)'; };
// A Claude account, or Codex shown as an account (for headers and the usage chip).
const acctById = id => (codexAcct(id) ? (x => ({ id: x.id, name: x.name, email: x.email, plan: x.plan, signedIn: x.signedIn, codex: true }))(codexAcct(id)) : S.accounts.find(x => x.id === id) || null);
const codexReady = () => !!(S.codex && S.codex.enabled && S.codex.signedIn);
const isCodex = s => !!(s && s.provider === 'codex');
// An OpenClaw agent's session (a Discord channel, a cron run…): listed with the rest, read-only here.
const isOpenClaw = s => !!(s && s.provider === 'openclaw');
const provOf = s => (isCodex(s) ? 'codex' : isOpenClaw(s) ? 'openclaw' : 'claude');
const PROV_TITLE = { claude: 'Claude Code', codex: 'Codex', openclaw: 'OpenClaw' };
const canLaunch = a => !!a && a.signedIn && a.lock.ok;
const isRunning = id => !!S.running[String(id).toLowerCase()];
function highlight(text, q) {
  const out = esc(text);
  const terms = String(q || '').trim().split(/\s+/).filter(t => t.length > 1).map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return out;
  return out.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
}
function allSessions() { const all = []; for (const p of S.projects) for (const s of p.sessions) all.push([s, p]); return all; }
function sessionById(id) { const want = String(id || '').toLowerCase(); for (const p of S.projects) { const s = p.sessions.find(x => x.id.toLowerCase() === want); if (s) return [s, p]; } return [null, null]; }
const lastLine = t => { const parts = String(t || '').trim().split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean); return parts.length ? parts[parts.length - 1] : ''; };
const plainMd = t => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>|]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();

const ICON = {
  lock: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.4" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="4" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="14" cy="9" r="1.5" fill="currentColor"/></svg>',
  caret: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* ---------- usage ---------- */
const SPAN = { fiveHour: 5 * 3600e3, week: 7 * 864e5 };
const usageOf = id => S.usage[id] || null;
const leftOf = w => (w && typeof w.used === 'number' ? Math.max(0, Math.round(100 - w.used)) : null);
function elapsed(w, span) {
  if (!w || !w.resetsAt) return null;
  const rem = Date.parse(w.resetsAt) - Date.now();
  if (!(rem >= 0)) return null;
  return Math.min(1, Math.max(0, 1 - rem / span));
}
// At the rate this window has been used so far, does it run out before it resets?
function paceOf(w, span) {
  const t = elapsed(w, span);
  if (t === null || t < 0.08 || !(w.used > 2) || w.used >= 100) return null;
  const spent = t * span, rate = w.used / spent, toReset = Date.parse(w.resetsAt) - Date.now();
  const toLimit = (100 - w.used) / rate;
  return toLimit < toReset ? { runsOut: Date.now() + toLimit, early: toReset - toLimit } : { projected: Math.min(100, Math.round(w.used + rate * toReset)) };
}
// The window that limits you first: the one with less left.
function binding(u) {
  if (!u || !u.data || !u.data.available) return null;
  const f = u.data.fiveHour, w = u.data.week;
  const fl = leftOf(f), wl = leftOf(w);
  if (fl === null && wl === null) return null;
  if (wl !== null && (fl === null || wl < fl)) return { key: 'week', label: 'this week', short: 'week', w, left: wl };
  return { key: 'fiveHour', label: 'five-hour window', short: '5 hr', w: f, left: fl };
}
const hot = left => left !== null && left <= 15;

// The dials draw themselves once, the first time the hub shows them.
let dialsDrawn = false;
function arc(r, frac, cls, width) {
  const c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return `<circle class="track" cx="100" cy="100" r="${r}" stroke-width="${width}"/>${f > 0 ? `<circle class="arc ${cls}${dialsDrawn ? '' : ' draw'}" style="--c:${c.toFixed(2)}" cx="100" cy="100" r="${r}" stroke-width="${width}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}" transform="rotate(-90 100 100)"/>` : ''}`;
}
function polar(r, frac) { const a = frac * 2 * Math.PI - Math.PI / 2; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; }
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function dialSvg(u) {
  const d = u && u.data && u.data.available ? u.data : null;
  const f = d && d.fiveHour, w = d && d.week;
  const fl = leftOf(f), wl = leftOf(w);
  let ticks = '';
  for (let i = 0; i < 7; i++) { const [x1, y1] = polar(92.5, i / 7), [x2, y2] = polar(97, i / 7); ticks += `<line class="tick major" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }
  for (let i = 0; i < 7; i++) { const [x, y] = polar(106, (i + 0.5) / 7); ticks += `<text class="rn" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${ROMAN[i]}</text>`; }
  for (let i = 0; i < 5; i++) { const [x1, y1] = polar(76.5, i / 5), [x2, y2] = polar(80.5, i / 5); ticks += `<line class="tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }
  const now = (r, frac) => { if (frac === null) return ''; const [x, y] = polar(r, frac); return `<circle class="now" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"/>`; };
  const fe = elapsed(f, SPAN.fiveHour), we = elapsed(w, SPAN.week);
  const center = fl !== null
    ? `<text class="lbl" x="100" y="80">five hours</text><text class="big ${hot(fl) ? 'hot' : ''}" x="100" y="113">${fl}%</text><text class="lbl" x="100" y="131">left</text>`
    : wl !== null
    ? `<text class="lbl" x="100" y="80">this week</text><text class="big ${hot(wl) ? 'hot' : ''}" x="100" y="113">${wl}%</text><text class="lbl" x="100" y="131">left</text>`
    : `<text class="lbl" x="100" y="96">usage</text><text class="lbl" x="100" y="112">not known yet</text>`;
  return `<svg class="dial ${d ? '' : 'unknown'}" viewBox="-14 -14 228 228" role="img" aria-label="${d ? [fl !== null ? `Five-hour window ${fl}% left` : '', wl !== null ? `week ${wl}% left` : ''].filter(Boolean).join(', ') : 'Usage not known yet'}">
    ${ticks}
    ${arc(86, w ? w.used / 100 : 0, `week ${hot(wl) ? 'hot' : ''}`, 7)}
    ${arc(68, f ? f.used / 100 : 0, `five ${hot(fl) ? 'hot' : ''}`, 10)}
    <circle class="face" cx="100" cy="100" r="58"/>
    ${now(86, we)}${now(68, fe)}
    ${center}
  </svg>`;
}
// A small two-ring dial: inner is the five-hour window, outer is the week.
function miniDial(id, size = 22) {
  const u = usageOf(id), d = u && u.data && u.data.available ? u.data : null;
  const ring = (r, frac, color, width) => { const c = 2 * Math.PI * r; const f = Math.max(0, Math.min(1, frac || 0)); return `<circle cx="20" cy="20" r="${r}" fill="none" style="stroke:rgb(var(--c-2a242e))" stroke-width="${width}"/>${f > 0 ? `<circle cx="20" cy="20" r="${r}" fill="none" style="stroke:${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}" transform="rotate(-90 20 20)"/>` : ''}`; };
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${ring(16.5, d && d.week ? d.week.used / 100 : 0, 'rgb(var(--c-7a3530))', 4.5)}${ring(9.5, d && d.fiveHour ? d.fiveHour.used / 100 : 0, 'rgb(var(--c-d08072))', 5)}</svg>`;
}
// One line for headers: "36% left of the five-hour window, resets 6:12 PM".
function usageLine(id, { short = false } = {}) {
  const u = usageOf(id);
  if (!u) return '';
  if (!u.data) return u.error ? 'Usage unavailable' : 'Checking usage…';
  if (!u.data.available) return '';
  const b = binding(u); if (!b) return '';
  if (b.left <= 0) return `Limit reached${b.w.resetsAt ? `, resets ${when(b.w.resetsAt)}` : ''}`;
  return short ? `${b.left}% left · ${b.short}` : `${b.left}% left ${b.key === 'week' ? 'this week' : 'in five hours'}${b.w.resetsAt ? `, resets ${when(b.w.resetsAt)}` : ''}`;
}

/* ---------- what each running chat is doing ---------- */
const seenKey = x => (x.sessionId ? `s:${String(x.sessionId).toLowerCase()}` : `k:${x.key}`);
const isSeen = x => (S.seen[seenKey(x)] || 0) >= (x.finishedAt || 0) - 1500;
function markSeen(x) {
  if (!x) return;
  const k = seenKey(x);
  if ((S.seen[k] || 0) >= (x.finishedAt || Date.now()) - 1500) return;
  S.seen[k] = Date.now();
  const cutoff = Date.now() - 3 * 864e5;
  for (const [key, t] of Object.entries(S.seen)) if (t < cutoff) delete S.seen[key];
  store('seen', JSON.stringify(S.seen));
  renderLive(); renderNav();
}
// approve | question | terminal-wait | reply | working | quiet | ended: a chat on its own.
function ownStatus(x) {
  if (x.phase === 'waiting') return (x.pending || []).some(p => p.question) ? 'question' : 'approve';
  if (x.phase === 'waiting-terminal') return 'terminal-wait';
  if (WORKING.has(x.phase)) return 'working';
  if (x.phase === 'ended') return 'ended';
  if (x.finishedAt && (x.source === 'app' || x.lastText) && !isSeen(x)) return 'reply';
  return 'quiet';
}
// A chat with its partner (Codex in it, or Claude): whichever of the two is further along the list
// above, so a chat reads "at work" while its partner works, and "needs your OK" when its partner does.
const STATUS_RANK = { approve: 0, question: 0, 'terminal-wait': 1, working: 2, reply: 3, quiet: 4, ended: 5 };
function statusOf(x) {
  const own = ownStatus(x), p = x.partner ? ownStatus(x.partner) : null;
  return p && STATUS_RANK[p] < STATUS_RANK[own] ? p : own;
}
// Running chats get their partner attached (it stays a row of its own too, for the cards that ask you).
function withPartners(list) {
  for (const x of list) if (!x.parentKey) x.partner = (x.key && list.find(y => y.parentKey === x.key)) || null;
  return list;
}
const NEEDS = new Set(['approve', 'question', 'terminal-wait']);
const waitsOnYou = x => NEEDS.has(ownStatus(x)) || ownStatus(x) === 'reply';
// Waiting on you: each one that asks (a partner too: its card has its question); at work and quiet:
// each chat once, with its partner.
const awaiting = () => S.activity.filter(waitsOnYou)
  .sort((a, b) => (NEEDS.has(ownStatus(b)) - NEEDS.has(ownStatus(a))) || ((b.finishedAt || b.lastEventAt || 0) - (a.finishedAt || a.lastEventAt || 0)));
const atWork = () => S.activity.filter(x => !x.parentKey && !waitsOnYou(x) && statusOf(x) === 'working');
const quietOpen = () => S.activity.filter(x => !x.parentKey && !waitsOnYou(x) && (statusOf(x) === 'quiet' || statusOf(x) === 'ended'));
const asked = x => /\?["”’)\]]*\s*$/.test(lastLine(x.lastText));
const VERB_NOW = { Bash: 'Running', PowerShell: 'Running', Read: 'Reading', Write: 'Writing', Edit: 'Editing', MultiEdit: 'Editing', NotebookEdit: 'Editing', Glob: 'Finding', Grep: 'Searching', WebFetch: 'Fetching', WebSearch: 'Searching', Agent: 'Delegating', Task: 'Delegating', TodoWrite: 'Planning', TaskCreate: 'Planning', TaskUpdate: 'Planning', Artifact: 'Publishing', AskUserQuestion: 'Asking' };
function wantsTo(p) {
  if (!p) return 'Wants your OK';
  switch (p.toolName) {
    case 'Bash': case 'PowerShell': return 'Wants to run a command';
    case 'Edit': case 'MultiEdit': return 'Wants to edit a file';
    case 'Write': return 'Wants to write a file';
    case 'WebFetch': return 'Wants to open a web page';
    case 'WebSearch': return 'Wants to search the web';
    default: return `Wants to use ${p.toolName}`;
  }
}
function whereOf(x) {
  const as = x.accountId ? `<span class="ring" style="--ring:${ringById(x.accountId)}"></span>as ${esc(x.accountName || '')}` : '';
  const place = x.source === 'terminal' ? 'in a terminal' : x.source === 'elsewhere' ? 'in another app' : '';
  return [x.folder ? esc(x.folder) : '', place, as].filter(Boolean).join(', ');
}
function sparkSvg(spark) {
  if (!spark || !spark.length) return '';
  const max = Math.max(1, ...spark);
  return `<svg class="spark" width="${spark.length * 4}" height="22" viewBox="0 0 ${spark.length * 4} 22" aria-hidden="true">${spark.map((v, i) => { const h = v ? Math.max(2, Math.round(20 * Math.min(1, v / max))) : 1; return `<rect x="${i * 4}" y="${22 - h}" width="2.6" height="${h}" rx="1"/>`; }).join('')}</svg>`;
}
const keyOf = x => x.key || `s:${x.sessionId}`;
// Lists that keep their order: each row gets its place the first time it shows up and keeps it, so
// a list doesn't reshuffle every time a chat in it does something (and you can click what you aimed
// at). New rows join at the end; a row that disappears keeps its place for two minutes, in case it's
// back (a chat restarting, say). idsOf gives a row's names (a running chat: its key and its session).
const PLACES = new Map();
function keepOrder(name, list, idsOf) {
  let places = PLACES.get(name);
  if (!places) PLACES.set(name, places = new Map());
  const now = Date.now(), seen = new Set();
  let next = 0;
  for (const p of places.values()) next = Math.max(next, p.n);
  const placeOf = x => {
    const ids = idsOf(x).filter(Boolean);
    const p = ids.map(id => places.get(id)).find(Boolean) || { n: ++next, gone: 0 };
    p.gone = 0;
    for (const id of ids) { places.set(id, p); seen.add(id); }
    return p.n;
  };
  const out = list.map(x => [placeOf(x), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  for (const [id, p] of places) if (!seen.has(id)) { if (!p.gone) p.gone = now; else if (now - p.gone > 120000) places.delete(id); }
  return out;
}
const activityIds = x => [x.key, x.sessionId && `s:${String(x.sessionId).toLowerCase()}`];
const findActivity = k => S.activity.find(x => keyOf(x) === k) || null;
// Chats you closed stay off the lists: one this app ran for good (that run is over; opening it again
// starts a new one), one in a terminal or another app until it does something new.
S.closed = new Map();
const closedKey = x => x.key || `s:${String(x.sessionId).toLowerCase()}`;
function isClosed(x) {
  if (x.parentKey && S.closed.has(x.parentKey)) return true;
  const t = S.closed.get(closedKey(x));
  return t !== undefined && !(!x.key && (x.lastEventAt || 0) > t);
}
const openOnly = list => list.filter(x => !isClosed(x));
function closeOff(x) {
  const now = Date.now();
  for (const [k, t] of S.closed) if (now - t > 864e5) S.closed.delete(k);
  S.closed.set(closedKey(x), now);
  S.activity = openOnly(S.activity);
  renderLive(); renderNav();
}
function openActivity(x) {
  if (!x) return;
  markSeen(x); if (x.partner) markSeen(x.partner);
  // A partner opens inside the chat it works in.
  if (x.source === 'app' && x.parentKey) return ChatUI.openKey(x.parentKey);
  if (x.source === 'app') return ChatUI.openKey(x.key);
  return ChatUI.watch({ sessionId: x.sessionId, source: x.source });
}

/* ---------- data ---------- */
async function loadState() {
  const j = await api('/api/state');
  S.accounts = j.accounts; S.dryRun = j.dryRun; S.platform = j.platform; S.prefs = j.prefs; S.index = j.index; S.appVersion = j.appVersion; S.codex = j.codex || null; S.reopen = j.reopen || [];
  const saved = store('acct');
  if (!S.accounts.some(a => a.id === S.acct)) S.acct = S.accounts.some(a => a.id === saved) ? saved : S.accounts[0].id;
}
async function loadSessions() {
  const j = await api('/api/sessions');
  S.projects = j.projects; S.root = j.root; S.running = j.running || {}; S.live = j.live || {};
  if (S.view === 'folder' && !S.projects.some(p => p.cwd === S.folder)) S.view = 'hub';
}
async function loadActivity() { const j = await api('/api/activity'); S.activity = withPartners(keepOrder('running', openOnly(j.list || []), activityIds)); }
async function loadUsage() { const j = await api('/api/usage'); S.usage = j.usage || {}; }
async function reload() {
  await loadState();
  await Promise.all([loadSessions(), loadActivity().catch(() => {}), loadUsage().catch(() => {})]);
  renderAll();
  if (S.drawerId) openDrawer(S.drawerId, true);
}

/* ---------- keyed patching, so live updates don't disturb hover, focus or typing ---------- */
function patch(container, items, keyFn, htmlFn, emptyHtml = '') {
  if (!container) return;
  const want = items.map(it => ({ k: keyFn(it), h: htmlFn(it).trim() }));
  const sig = want.map(w => `${w.k}\u0001${w.h}`).join('\u0002') || `empty:${emptyHtml}`;
  if (container._sig === sig) return;
  container._sig = sig;
  if (!want.length) { container.innerHTML = emptyHtml; return; }
  const old = new Map();
  for (const el of [...container.children]) { if (el.dataset && el.dataset.k) old.set(el.dataset.k, el); else el.remove(); }
  const active = document.activeElement;
  let prev = null;
  for (const w of want) {
    let el = old.get(w.k);
    // A card you're typing in stays as it is until you're done (no caret jumps, no lost input).
    const typingIn = el && active && el.contains(active) && active.matches('textarea, input[type="text"]') && !!active.value;
    if (!typingIn && (!el || el._h !== w.h)) {
      const t = document.createElement('template'); t.innerHTML = w.h;
      const n = t.content.firstElementChild; n.dataset.k = w.k; n._h = w.h;
      if (el) {
        // Carry over anything typed into a quick reply, and keep focus where it was.
        const oi = el.querySelector('textarea, input[type="text"]'), ni = n.querySelector('textarea, input[type="text"]');
        const hadFocus = active && el.contains(active);
        const focusAttr = hadFocus && active.dataset ? Object.entries(active.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('') : '';
        if (oi && ni) { ni.value = oi.value; }
        el.replaceWith(n);
        if (hadFocus) { const f = (oi && active === oi ? ni : null) || (focusAttr && n.querySelector(focusAttr)); if (f) { f.focus({ preventScroll: true }); if (f === ni && typeof ni.setSelectionRange === 'function') ni.setSelectionRange(ni.value.length, ni.value.length); } }
      }
      el = n;
    }
    old.delete(w.k);
    const next = prev ? prev.nextElementSibling : container.firstElementChild;
    if (next !== el) container.insertBefore(el, next);
    prev = el;
  }
  for (const el of old.values()) el.remove();
}
// Animates a change to keyed lists (patch's data-k): what stays glides from where it was to where it is
// now, even into another of the lists; what's new fades in; what's gone fades out where it stood. With
// less motion asked for, the change just happens.
const EASE = 'cubic-bezier(.2,.8,.2,1)';
function flip(lists, mutate) {
  lists = lists.filter(Boolean);
  if (typeof motionOk !== 'function' || !motionOk() || document.hidden) return mutate();
  const was = new Map();
  for (const l of lists) for (const el of l.children) if (el.dataset && el.dataset.k) was.set(el.dataset.k, { el, r: el.getBoundingClientRect(), list: l });
  mutate();
  const now = new Set();
  for (const l of lists) {
    for (const el of l.children) {
      if (!el.dataset || !el.dataset.k || el.classList.contains('flip-ghost')) continue;
      now.add(el.dataset.k);
      // One still gliding from an earlier change starts this one from where it appears to be now.
      for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
      const w = was.get(el.dataset.k), r = el.getBoundingClientRect();
      if (!w) { el.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE, id: 'flip' }); continue; }
      const dx = w.r.left - r.left, dy = w.r.top - r.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE, id: 'flip' });
    }
  }
  for (const [k, w] of was) {
    if (now.has(k) || !w.r.height || !w.list.isConnected) continue;
    // A stand-in where it was, fading out (the real one is gone already).
    const g = w.el.cloneNode(true), box = w.list.getBoundingClientRect();
    if (getComputedStyle(w.list).position === 'static') w.list.style.position = 'relative';
    g.classList.add('flip-ghost'); g.removeAttribute('data-k'); g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { position: 'absolute', left: `${w.r.left - box.left + w.list.scrollLeft}px`, top: `${w.r.top - box.top + w.list.scrollTop}px`, width: `${w.r.width}px`, height: `${w.r.height}px`, margin: '0', pointerEvents: 'none' });
    w.list.appendChild(g);
    g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, easing: 'ease-in' }).finished.then(() => g.remove(), () => g.remove());
  }
}
