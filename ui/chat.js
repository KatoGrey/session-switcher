'use strict';
/* Opening and closing chats, the header and the rail, keyboard and mouse, right-click inside a chat, and ChatUI (what the hub calls). */

/* ---------- header, rail ---------- */
function headerAccount(id, fallbackName) {
  const a = id && acctById(id);
  const u = id ? usageOf(id) : null, d = u && u.data && u.data.available ? u.data : null;
  const pct = (label, w) => { if (!w) return ''; const l = leftOf(w); return `<span class="cu ${hot(l) ? 'hot' : ''}" title="${label}: ${l}% left${w.resetsAt ? `, resets ${esc(when(w.resetsAt))}` : ''}">${label} ${l}%</span>`; };
  $c('cAcct').hidden = !a && !fallbackName;
  $c('cAcct').innerHTML = `${id ? miniDial(id, 22) : ''}<span class="ca-n">${esc(a ? a.name : fallbackName || '')}</span>${d ? `${pct('5h', d.fiveHour)}${pct('wk', d.week)}` : ''}`;
  $c('cAcct').title = a ? `This chat runs as ${a.name}${a.email ? ` (${a.email})` : ''}` : '';
  const ring = a ? ringById(id) : 'var(--seam-2)';
  $c('chat').style.setProperty('--acct', ring);
  if (typeof renderBar === 'function') renderBar();
}
function refreshChatUsage() { if (!$c('chat').hidden) { headerAccount(C.info ? C.info.accountId : null, C.info ? C.info.accountName : ''); renderLedgerSoon(); } }
function isViewing(x) {
  if (!x || $c('chat').hidden) return false;
  if (C.key && x.key) return x.key === C.key || !!(C.comp && x.key === C.comp.key);
  const sid = C.watch ? C.watch.sessionId : C.sessionId;
  return !!(sid && x.sessionId && x.sessionId.toLowerCase() === String(sid).toLowerCase());
}
function railItem(x) {
  // A pinned chat that isn't running: it stays listed, and a click opens it again.
  if (x.pinnedOnly) return `<li><button type="button" class="ri closed" data-navchat="${esc(x.sessionId)}" aria-current="${isViewing(x)}">${crestHtml(projectOf(x), 28, 'ri-crest')}<span class="ash-dot ri-dot" aria-hidden="true"></span><span class="ri-t"><span class="ri-n">${esc(x.title || 'New chat')}</span><span class="ri-s">Closed${x.folder ? ` · ${esc(x.folder)}` : ''}</span></span></button></li>`;
  const st = statusOf(x), w = x.partner && st !== ownStatus(x) ? x.partner : x;   // w: the one the status is about
  const dot = NEEDS.has(st) ? 'gilt-dot' : st === 'working' ? (w.source === 'app' ? 'ember-dot' : 'violet-dot') : st === 'reply' ? 'reply-dot' : st === 'ended' ? 'ash-dot' : x.source === 'app' ? 'ready-dot' : 'violet-dot';
  const doing = w.phase === 'tool' && (w.detail || w.tool) ? `${VERB_NOW[w.tool] || 'Using'} ${w.detail || w.tool}` : w.phase === 'writing' ? 'Writing…' : w.phase === 'starting' ? 'Starting…' : 'Thinking…';
  let sub = { approve: 'Needs your OK', question: 'Has a question', 'terminal-wait': 'Waiting in its terminal', reply: 'Your turn', working: doing, quiet: x.source === 'terminal' ? 'In a terminal' : x.source === 'elsewhere' ? 'In another app' : 'Ready', ended: 'Stopped' }[st];
  if (w !== x) sub = `${PROV_NAME[w.provider || 'claude']}: ${sub}`;
  else if (x.partner && (st === 'quiet' || st === 'reply')) sub += ` · with ${PROV_NAME[x.partner.provider || 'claude']}`;
  return `<li><button type="button" class="ri ${NEEDS.has(st) ? 'needs' : st === 'reply' ? 'replied' : ''}" aria-current="${isViewing(x)}">${crestHtml(projectOf(x), 28, 'ri-crest')}<span class="${dot} ri-dot" aria-hidden="true"></span><span class="ri-t"><span class="ri-n">${esc(x.title || 'New chat')}</span><span class="ri-s">${esc(sub)}${x.folder ? ` · ${esc(x.folder)}` : ''}</span></span></button></li>`;
}
// The rail: chats you pinned (they stay, running or not), then the rest of what's open, each list in
// the order you dragged it into. Chats it hasn't placed yet keep their places after those.
let railOrder = []; try { railOrder = JSON.parse(store('railOrder') || '[]'); } catch { /* none yet */ }
const railId = x => (x.sessionId ? `s:${String(x.sessionId).toLowerCase()}` : x.key);
const railKey = x => (x.pinnedOnly ? `pin:${railId(x)}` : keyOf(x));
function inRailOrder(list) {
  const pos = new Map(railOrder.map((id, i) => [id, i]));
  const at = x => { for (const id of activityIds(x)) if (id && pos.has(id)) return pos.get(id); return Infinity; };
  return list.map((x, i) => [at(x), i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(r => r[2]);
}
function railRows() {
  const open = S.activity.filter(x => !x.parentKey);
  const pinned = open.filter(x => isFav(x.sessionId)), active = open.filter(x => !isFav(x.sessionId));
  for (const id of S.favs) {
    if (pinned.some(x => String(x.sessionId).toLowerCase() === id)) continue;
    const [s, p] = sessionById(id);
    if (s) pinned.push({ pinnedOnly: true, sessionId: s.id, title: s.title, folder: p.name });
  }
  return { pinned: inRailOrder(pinned), active: inRailOrder(active) };
}
const railOpen = () => { const { pinned, active } = railRows(); return [...pinned, ...active].filter(x => !x.pinnedOnly); };
function renderRail() {
  if ($c('chat').hidden || (Rail.drag && Rail.drag.on)) return;
  const { pinned, active } = railRows();
  $c('cPinH').hidden = !pinned.length;
  $c('cPinCount').textContent = pinned.length ? String(pinned.length) : '';
  $c('cRailCount').textContent = active.length ? String(active.length) : '';
  // Changes glide: a pinned chat rises into Pinned, a closed one fades where it stood, a new one fades in.
  flip([$c('cPinList'), $c('cRailList')], () => {
    patch($c('cPinList'), pinned, railKey, railItem);
    patch($c('cRailList'), active, railKey, railItem, `<li class="ri-empty">${pinned.length ? 'Nothing else is open.' : 'Only this chat is open.'}</li>`);
  });
}
function switchRail(step) {
  const list = railOpen(); if (!list.length) return;
  const i = list.findIndex(isViewing);
  const next = list[(i + step + list.length) % list.length];
  if (next && !isViewing(next)) openActivity(next);
}
// Where to go when the chat you're in is closed: the next open one down the list, else the one above.
function railNeighbor(x) {
  const list = railOpen(), i = list.findIndex(y => keyOf(y) === keyOf(x));
  return list[i + 1] || list[i - 1] || null;
}
// Remembers the order the lists are in now, after a drag or Alt+Shift+↑/↓.
function saveRailOrder() {
  const ids = [...$c('cPinList').children, ...$c('cRailList').children].map(li => li.dataset.k).filter(Boolean)
    .map(k => { if (k.startsWith('pin:')) return k.slice(4); const x = findActivity(k); return x ? railId(x) : null; }).filter(Boolean);
  railOrder = [...ids, ...railOrder.filter(id => !ids.includes(id))].slice(0, 200);
  store('railOrder', JSON.stringify(railOrder));
  $c('cPinList')._sig = $c('cRailList')._sig = '';
  renderRail();
}
// Alt+Shift+↑/↓: the chat you're in trades places with its neighbor, both gliding.
function moveInRail(step) {
  const li = [...$c('cPinList').children, ...$c('cRailList').children].find(el => el.querySelector('.ri[aria-current="true"]'));
  const sib = li && (step < 0 ? li.previousElementSibling : li.nextElementSibling);
  if (!sib || !sib.dataset.k) return;
  flip([li.parentElement], () => { if (step < 0) sib.before(li); else sib.after(li); });
  saveRailOrder();
}
// Drag a chat up or down its list (with a mouse or pen; on a touch screen a drag scrolls). Nothing in
// the list moves until you let go: the chat lifts and follows the pointer, the others slide aside to
// open its new place, and on release it settles into it. Esc puts it back. Near the list's top or
// bottom edge, the list scrolls.
const Rail = { drag: null, dropped: 0 };
function railDown(e) {
  const ri = e.target.closest('#cPinList .ri, #cRailList .ri');
  if (!ri || e.button !== 0 || e.pointerType === 'touch' || Rail.drag) return;
  const li = ri.closest('li');
  Rail.drag = { li, list: li.parentElement, x0: e.clientX, y0: e.clientY, y: e.clientY, id: e.pointerId, on: false };
}
function railStart(d) {
  d.items = [...d.list.children].filter(el => el.dataset.k && !el.classList.contains('flip-ghost'));
  for (const el of d.items) for (const a of el.getAnimations()) a.finish();
  d.from = d.to = d.items.indexOf(d.li);
  d.scroller = d.list.closest('.rail-scroll');
  d.s0 = d.scroller ? d.scroller.scrollTop : 0;
  // Where each chat sits in the list (these don't change as the list scrolls).
  d.tops = d.items.map(el => el.offsetTop); d.hs = d.items.map(el => el.offsetHeight);
  const n = d.items.length;
  d.step = n < 2 ? d.hs[d.from] : d.from < n - 1 ? d.tops[d.from + 1] - d.tops[d.from] : d.tops[d.from] - d.tops[d.from - 1];
  d.on = true;
  d.li.classList.add('dragging');
  for (const el of d.items) if (el !== d.li) el.classList.add('making-room');
  document.body.classList.add('rail-dragging');
  try { d.li.setPointerCapture(d.id); } catch { /* fine without */ }
  d.raf = requestAnimationFrame(() => railScroll(d));
}
function railPlace(d) {
  const scrolled = d.scroller ? d.scroller.scrollTop - d.s0 : 0, last = d.tops.length - 1;
  // It follows the pointer, though not far past either end of its list.
  const dy = Math.max(d.tops[0] - d.tops[d.from] - 10, Math.min(d.tops[last] - d.tops[d.from] + 10, d.y - d.y0 + scrolled));
  d.li.style.transform = `translateY(${dy}px) scale(1.02)`;
  // Its new place: past the middle of each chat it has crossed.
  const mid = d.tops[d.from] + dy + d.hs[d.from] / 2;
  let to = 0;
  d.items.forEach((el, i) => { if (i !== d.from && d.tops[i] + d.hs[i] / 2 < mid) to++; });
  if (to === d.to) return;
  d.to = to;
  d.items.forEach((el, i) => {
    if (i === d.from) return;
    const shift = d.from < to && i > d.from && i <= to ? -d.step : to < d.from && i >= to && i < d.from ? d.step : 0;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
function railMove(e) {
  const d = Rail.drag; if (!d || e.pointerId !== d.id || d.settling) return;
  d.y = e.clientY;
  if (!d.on) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return; railStart(d); }
  e.preventDefault();
  railPlace(d);
}
function railScroll(d) {
  if (Rail.drag !== d || d.settling) return;
  const s = d.scroller;
  if (s && s.scrollHeight > s.clientHeight) {
    const r = s.getBoundingClientRect(), edge = 40;
    const v = d.y < r.top + edge ? -Math.ceil((r.top + edge - d.y) / 5) : d.y > r.bottom - edge ? Math.ceil((d.y - r.bottom + edge) / 5) : 0;
    if (v) { const was = s.scrollTop; s.scrollTop += v; if (s.scrollTop !== was) railPlace(d); }
  }
  d.raf = requestAnimationFrame(() => railScroll(d));
}
function railUp(e) {
  const d = Rail.drag; if (!d || e.pointerId !== d.id || d.settling) return;
  if (!d.on) { Rail.drag = null; return; }
  Rail.dropped = Date.now();
  railSettle(d, e.type === 'pointerup');
}
// Letting go: the chat settles into its new place (or back into its old one), and only then does the
// list really change, to just where everything already appears to be.
function railSettle(d, keep) {
  d.settling = true;
  cancelAnimationFrame(d.raf);
  try { d.li.releasePointerCapture(d.id); } catch { /* not captured */ }
  const to = keep ? d.to : d.from, li = d.li;
  const end = to > d.from ? d.tops[to] + d.hs[to] - d.tops[d.from] - d.hs[d.from] : d.tops[to] - d.tops[d.from];
  li.classList.add('settling');
  li.style.transform = `translateY(${end}px)`;
  if (!keep) for (const el of d.items) if (el !== li) el.style.transform = '';
  const done = () => {
    if (d.finished) return;
    d.finished = true;
    for (const el of d.items) { el.classList.remove('making-room', 'dragging', 'settling'); el.style.transform = ''; }
    const moved = keep && to !== d.from;
    if (moved) { const others = d.items.filter(el => el !== li); if (to < others.length) others[to].before(li); else others[others.length - 1].after(li); }
    document.body.classList.remove('rail-dragging');
    Rail.drag = null;
    if (moved) saveRailOrder(); else { $c('cPinList')._sig = $c('cRailList')._sig = ''; renderRail(); }
  };
  li.addEventListener('transitionend', e => { if (e.target === li && e.propertyName === 'transform') done(); });
  setTimeout(done, 380);
}

/* ---------- open / close ---------- */
function findSession(id) { const want = String(id || '').toLowerCase(); for (const p of S.projects) { const s = p.sessions.find(x => x.id.toLowerCase() === want); if (s) return [s, p]; } return [null, null]; }

async function loadHistory(before) {
  if (!C.sessionId) return null;
  const gen = C.gen;
  const params = new URLSearchParams({ id: C.sessionId, provider: C.provider });
  // Up to where the open chat's live replay begins, so nothing shows twice or goes missing.
  const until = C.info && !C.watch ? C.info.bufferFrom || C.info.startedAt : null;
  if (until) params.set('until', until);
  if (before !== undefined && C.historyCursor) params.set('cursor', C.historyCursor);
  const h = await api(`/api/chat/history?${params}`);
  if (gen !== C.gen) return null;   // you've moved on to another chat
  C.historyStart = h.start;
  C.historyCursor = h.cursor || null;
  let rows = h.items.map(it => ({ it, prov: C.provider }));
  // The partner's earlier messages (Codex in a Claude chat, or Claude in a Codex chat) slot in by time.
  if (before === undefined && C.compThread) {
    try { rows = mergeHelper(rows, (await api(`/api/chat/history?${new URLSearchParams({ id: C.compThread, provider: partnerProv() })}`)).items); } catch { /* shown without them */ }
    if (gen !== C.gen) return null;
  }
  const tmp = document.createElement('div');
  for (const r of rows) { curProv = r.prov; try { renderItem(tmp, r.it, false); } finally { curProv = null; } }
  const feed = $c('cFeed');
  if (before === undefined) { feed.prepend(...tmp.childNodes); feed.prepend($c('cEarlier')); }
  else {
    const s = scroller(), oldH = s.scrollHeight;
    $c('cEarlier').after(...tmp.childNodes);
    s.scrollTop += s.scrollHeight - oldH;
  }
  $c('cEarlier').hidden = h.start <= 0;
  $c('cEarlier').textContent = 'Show earlier messages';
  return h;
}
// Waits (briefly) for the last pictures to size themselves, so "the bottom" is really the bottom.
async function settle() {
  const imgs = [...$c('cFeed').querySelectorAll('img')].slice(-6).filter(i => !i.complete);
  if (imgs.length) await Promise.race([Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : null))), new Promise(r => setTimeout(r, 1500))]);
}

function mergeHelper(rows, items) {
  // The partner's turns, each starting at your message; ones from a partner still running come live.
  // Codex keeps a turn's time to the second, so its turn counts from the end of that second (a turn
  // handed over within a second of the other's reply still comes after it).
  const cutoff = C.comp && C.comp.startedAt ? Date.parse(C.comp.startedAt) : Infinity;
  const late = partnerProv() === 'codex' ? 999 : 0;
  const groups = [];
  for (const it of items) {
    if (it.kind === 'user' || !groups.length) groups.push({ t: it.at ? Date.parse(it.at) + late : -Infinity, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  const keep = groups.filter(g => !(g.t >= cutoff));
  const out = [];
  let gi = 0, last = -Infinity;
  for (const r of rows) {
    const t = r.it.at ? Date.parse(r.it.at) : last; last = t;
    while (gi < keep.length && keep[gi].t <= t) out.push(...keep[gi++].items.map(it => ({ it, prov: partnerProv() })));
    out.push(r);
  }
  while (gi < keep.length) out.push(...keep[gi++].items.map(it => ({ it, prov: partnerProv() })));
  return out;
}

function connect() {
  if (C.es) C.es.close();
  const key = C.key;
  C.es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}&after=${C.lastSeq}`);
  C.es.addEventListener('hello', e => { try { const info = JSON.parse(e.data); C.info = { ...C.info, ...info }; C.sessionId = info.sessionId || C.sessionId; headerAccount(info.accountId, info.accountName); if (info.permissionMode) setMode(info.permissionMode); if (info.context) setCtx('main', info.context); } catch { /* ignore */ } });
  C.es.addEventListener('chat', e => { if (C.key !== key) return; try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  C.es.onerror = () => { if (C.state === 'ended' && C.es) { C.es.close(); C.es = null; } };
}

function reset() {
  if (C.es) { C.es.close(); C.es = null; }
  clearTimeout(C.liveTimer);
  if (C.comp && C.comp.es) C.comp.es.close();
  // Each chat has its own message box: what you typed stays with the chat it was for (as a draft).
  clearTimeout(draftTimer);
  clearInterval(C.watchTimer);
  dropAttachments();
  $c('cText').value = ''; C.attachments = []; C.files = []; C.converting = 0; renderAttachments(); grow();
  closeFind(); unseen = 0;
  C.gen = (C.gen || 0) + 1;   // anything still loading for the previous chat is ignored
  $c('chat').classList.remove('openclaw');
  Object.assign(C, { compPending: null, watchPending: false, key: null, info: null, sessionId: null, lastSeq: 0, state: null, liveText: {}, liveTimer: null, historyStart: 0, historyCursor: null, watch: null, watchSig: '', model: '', provider: 'claude', comp: null, compThread: null, target: 'main', mi: { main: null, comp: null } });
  C.ctx = { main: null, comp: null }; C.ctxWarned = {}; C.handoff = null; C.status = ''; C.changedBy = new Map();
  closePreview();
  Review.loop = null;
  closePick();
  $c('cFeed').innerHTML = '<button type="button" class="c-earlier" id="cEarlier" hidden></button>';
  clearPermissions();
  ledgerReset();
  $c('cStatus').textContent = ''; $c('cModel').textContent = '';
  const sel = $c('cMode'); sel.innerHTML = ['default', 'acceptEdits', 'plan', 'auto'].map(m => `<option value="${m}">${MODE_LABELS[m]}</option>`).join('');
  sel.hidden = false;
  $c('cCompose').hidden = false; $c('cWatch').hidden = true; $c('cWatch').innerHTML = '';
  closeSlash(); Slash.dismissed = null;
}
// Opening a chat from a card or a row: the window grows out of what you clicked.
let launchFrom = null;
document.addEventListener('pointerdown', e => {
  const el = e.target instanceof Element && e.target.closest('.omen, .qchip, .row, .wb-chip, .welcome, .dial-card, .pal-i, .nav-chat');
  launchFrom = el ? { rect: el.getBoundingClientRect(), at: Date.now() } : null;
}, true);
function growFrom(chat) {
  const p = launchFrom; launchFrom = null;
  if (!p || Date.now() - p.at > 1500 || !motionOk()) return;
  const r = chat.getBoundingClientRect(), s = p.rect;
  if (!r.width || !r.height) return;
  const px = n => `${Math.max(0, Math.round(n))}px`;
  const from = `inset(${px(s.top - r.top)} ${px(r.right - s.right)} ${px(r.bottom - s.bottom)} ${px(s.left - r.left)} round 14px)`;
  chat.animate([{ clipPath: from, opacity: 0.4 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }], { duration: 440, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function show() {
  const chat = $c('chat'), opening = chat.hidden;
  chat.hidden = false;
  chat.classList.remove('show-rail', 'show-ledger');
  let noLedger = false; try { noLedger = localStorage.getItem('ledger') === 'off'; } catch { /* default */ }
  chat.classList.toggle('no-ledger', noLedger);
  document.body.classList.add('chat-open');
  document.body.classList.remove('nav-open');
  if (!$c('drawer').hidden) $c('drawer').hidden = true;
  renderRail();
  if (opening) growFrom(chat);
}

async function begin(info, { mode = 'resume', sessionId = null, cwd = null } = {}) {
  reset();
  const gen = C.gen;
  C.key = info.key; C.info = info; C.sessionId = info.sessionId || sessionId;
  C.provider = info.provider || 'claude';
  if (info.modes) modeOptions(info.modes);
  if (info.models && info.models.length) C.mi.main = info;
  C.compThread = info.companionThread || null;
  if (info.companionKey) { try { const ci = await api('/api/chat/attach', { key: info.companionKey }); if (gen !== C.gen) return; attachComp(ci); } catch { /* the helper has stopped */ } }
  if (gen !== C.gen) return;
  setTarget('main', false);
  $c('chat').classList.toggle('codex', C.provider === 'codex');
  const [s, p] = findSession(C.sessionId);
  noteLastChat(C.sessionId, (s && s.title) || info.title, p && p.name);
  C.title = info.title && info.title !== 'New chat' ? info.title : mode === 'new' ? 'New chat' : mode === 'fork' ? `${s ? s.title : 'Chat'} (copy)` : (s ? s.title : info.title || 'Chat');
  C.folder = info.folder || (p ? p.name : (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : ''));
  $c('cCrest').innerHTML = crestHtml(p || (C.folder ? { name: C.folder, cwd: info.cwd || cwd } : null), 40);
  $c('cTitle').textContent = C.title;
  $c('cFolder').textContent = C.folder;
  headerAccount(info.accountId, info.accountName);
  setState(info.state || 'starting');
  show();
  if (mode !== 'new' && C.sessionId) {
    // A quiet placeholder while the conversation loads, instead of an empty window.
    $c('cFeed').insertAdjacentHTML('beforeend', '<div class="c-skel" aria-hidden="true"><i class="u"></i><i></i><i class="s"></i><i class="u"></i><i></i></div>');
    try { await loadHistory(); } catch (err) {
      // A chat that's running but hasn't saved any history yet (a new one) simply has nothing earlier.
      if (!(err.status === 404 && C.key && C.state !== 'ended')) toast(`Couldn’t load earlier messages: ${err.message}`);
    }
    if (gen !== C.gen) return;
    $c('cFeed').querySelector('.c-skel')?.remove();
  }
  if (mode === 'new') welcome(info.cwd || cwd);
  restoreDraft();
  toBottom();
  connect();
  settle().then(() => { if (gen === C.gen && !unseen) toBottom(); });
  markSeen(findActivity(info.key) || { key: info.key, sessionId: C.sessionId, finishedAt: Date.now() });
  renderRail(); renderLedgerSoon(); syncFav();
  $c('cText').focus();
}

async function open({ sessionId = null, cwd = null, mode = 'resume', force = false, accountId = null, provider = null, initialText = '', separate = false } = {}) {
  const a = (accountId && S.accounts.find(x => x.id === accountId)) || current();
  const [known] = sessionId ? findSession(sessionId) : [null];
  // An OpenClaw agent's session is read here; it carries on in OpenClaw.
  if (known && known.provider === 'openclaw') return watch({ sessionId: known.id, source: 'openclaw' });
  const prov = provider || (known && known.provider) || 'claude';
  // One chat per project: a new Codex chat where a Claude chat is open (or the other way round) adds
  // that one to the open chat instead, unless you'd rather have a separate chat. Esc does neither.
  if (mode === 'new' && cwd && !separate) {
    const same = d => String(d || '').replace(/[\\/]+$/, '').toLowerCase();
    const here = S.activity.find(x => x.source === 'app' && !x.parentKey && x.phase !== 'ended' && same(x.cwd) === same(cwd) && (x.provider || 'claude') !== prov);
    if (here) {
      const name = PROV_NAME[prov];
      const join = await window.appConfirm(`Add ${name} to “${here.title || 'the open chat'}”?\n\nThat chat is already open in this project. ${name} joins it and reads everything in it, so the work stays in one place.`, { ok: `Add ${name} to it`, cancel: `Start a separate ${name} chat`, escape: null });
      if (join === null) return undefined;
      if (!join) return open({ sessionId, cwd, mode, force, accountId, provider, initialText, separate: true });
      await openKey(here.key);
      setTarget('comp');
      if (initialText) placeText(initialText, true);
      return undefined;
    }
  }
  // A new Claude chat about to open as an account that's out of usage: offer the one with room.
  if (mode === 'new' && prov === 'claude' && !accountId && a) {
    const alt = await roomierAccount(a);
    if (alt) return open({ sessionId, cwd, mode, force, accountId: alt.id, provider, initialText });
  }
  let info;
  try {
    info = await api('/api/chat/open', { account: a.id, sessionId, cwd, mode, force, provider: prov });
  } catch (err) {
    if (err.reason === 'codex-signin' || err.reason === 'codex-missing') { toast(err.message, 9000); return undefined; }
    if (err.reason === 'running') {
      if (await window.appConfirm(`${err.message}\n\nOpen it here anyway, or watch it live without touching it?`, { ok: 'Open it here anyway', cancel: 'Watch it live' })) return open({ sessionId, cwd, mode, force: true, accountId: a.id, provider, initialText });
      return watch({ sessionId, source: 'terminal' });
    }
    throw err;
  }
  if (prov !== 'codex' && info.attached && info.accountId !== a.id) toast(`This chat was already open here as ${info.accountName}, so it continues as ${info.accountName}.`, 7000);
  else if (info.remembered && info.permissionMode) {
    const label = ((info.modes || []).find(m => m.value === info.permissionMode) || {}).label || MODE_LABELS[info.permissionMode] || info.permissionMode;
    toast(`Opened in “${label}”, as you left it${mode === 'new' ? ' in this project' : ''}.`, 3500);
  }
  await begin(info, { mode, sessionId, cwd });
  // Started from a prompt: it waits in the message box so you can adjust it before sending.
  if (initialText) placeText(initialText, true);
  return undefined;
}

async function openKey(key) {
  const info = await api('/api/chat/attach', { key });
  return begin(info, { mode: 'resume', sessionId: info.sessionId });
}

// Read-only, live view of a chat running somewhere else (a terminal, the desktop app).
async function watch({ sessionId, source = 'terminal' }) {
  reset();
  C.watch = { sessionId, source }; C.sessionId = sessionId;
  const [s, p] = findSession(sessionId);
  C.provider = s && (s.provider === 'codex' || s.provider === 'openclaw') ? s.provider : 'claude';
  const oc = C.provider === 'openclaw';
  if (oc) PROV_NAME.openclaw = s.agentName || 'OpenClaw';
  $c('chat').classList.toggle('openclaw', oc);
  C.title = s ? s.title : 'Chat'; C.folder = p ? p.name : '';
  C.info = { cwd: p ? p.cwd : null, accountId: s && s.lastOpened ? s.lastOpened.account : null, accountName: s && s.lastOpened ? s.lastOpened.accountName : '' };
  $c('cTitle').textContent = C.title; $c('cFolder').textContent = C.folder;
  $c('cCrest').innerHTML = crestHtml(p, 40);
  headerAccount(C.info.accountId, C.info.accountId ? C.info.accountName : (oc ? `OpenClaw · ${PROV_NAME.openclaw}` : source === 'terminal' ? 'In a terminal' : 'In another app'));
  setState(source === 'terminal' || source === 'openclaw' ? 'watching' : 'readonly');
  $c('cMode').hidden = true;
  // An OpenClaw session is live AND writable: what you send becomes a follow-up turn in it.
  $c('cCompose').hidden = !oc;
  if (oc) { $c('cText').placeholder = `Write to ${PROV_NAME[C.provider]}…`; $c('cText').rows = 1; }
  $c('cWatch').hidden = false;
  $c('cWatch').innerHTML = oc ? '<p><b>Live.</b> This OpenClaw agent’s session carries on in OpenClaw; new messages appear here by themselves, and what you send becomes your next turn in it.</p>'
    : source === 'terminal'
    ? '<p><b>Watching live.</b> This chat is running in a terminal, so you can read along here and reply in its terminal window. New messages appear by themselves.</p><button type="button" class="btn" data-c="fork">Open a copy here</button>'
    : '<p><b>Read-only.</b> This chat was last used in another app, like the desktop app. Continue it here if it’s closed there.</p><button type="button" class="btn prime" data-c="takeover">Continue it here</button><button type="button" class="btn quiet" data-c="fork">Open a copy</button>';
  show();
  const gen = C.gen;
  try { const h = await loadHistory(); if (gen !== C.gen) return; C.watchSig = sigOf(h); } catch (err) { toast(`Couldn’t read this chat: ${err.message}`); }
  if (gen !== C.gen) return;
  syncFav();
  toBottom();
  markSeen(findActivity(`s:${sessionId}`) || { sessionId, finishedAt: Date.now() });
  renderRail(); renderLedgerSoon();
  clearInterval(C.watchTimer);
  C.watchTimer = setInterval(() => { if (C.watch && !document.hidden) refreshWatch(); }, 4000);
}
const sigOf = h => (h ? `${h.start}:${h.items.length}:${JSON.stringify(h.items[h.items.length - 1] || '').length}` : '');
let watchBusy = false;
async function refreshWatch() {
  if (!C.watch || watchBusy) return;
  const id = C.watch.sessionId, gen = C.gen;
  watchBusy = true;
  try {
    const h = await api(`/api/chat/history?${new URLSearchParams({ id, provider: C.provider })}`);
    if (gen !== C.gen || !C.watch || C.watch.sessionId !== id || sigOf(h) === C.watchSig) return;
    // Reading further up? Don't move the page; count it, and catch up when you come back down.
    if (!nearBottom()) { C.watchPending = true; if (!unseen) { unseen = 1; syncJump(); } return; }
    C.watchSig = sigOf(h); C.watchPending = false;
    const open = new Set([...$c('cFeed').querySelectorAll('details[open][data-tool-id]')].map(d => d.dataset.toolId));
    ledgerReset();
    $c('cFeed').innerHTML = '<button type="button" class="c-earlier" id="cEarlier" hidden></button>';
    for (const it of h.items) renderItem($c('cFeed'), it, false);
    for (const d of $c('cFeed').querySelectorAll('details[data-tool-id]')) if (open.has(d.dataset.toolId)) d.open = true;
    C.historyStart = h.start; C.historyCursor = h.cursor || null;
    $c('cEarlier').hidden = h.start <= 0;
    $c('cEarlier').textContent = 'Show earlier messages';
    toBottom();
  } catch { /* try again next time */ } finally { watchBusy = false; }
}

function close(silent) {
  if (C.es) { C.es.close(); C.es = null; }
  if (C.comp && C.comp.es) { C.comp.es.close(); C.comp.es = null; }
  closePick();
  clearInterval(C.watchTimer);
  $c('chat').hidden = true;
  document.body.classList.remove('chat-open');
  C.key = null; C.watch = null;
  updateTitle(); renderBar();
  if (!silent) loadSessions().then(() => { renderSide(); renderMain(); }).catch(() => {});
}

/* ---------- selecting ---------- */
// Select all (a phone's, or Ctrl+A) takes the whole page: the header, every button, the message box.
// In a chat it keeps to what you were in instead: the code block, else the message. Once that's all
// selected, Select all again takes the whole conversation (still not the page around it).
const Sel = { in: null, whole: false };
const selHost = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el ? el.closest('#cFeed pre, #cFeed .md, #cFeed .ububble') : null; };
const flat = s => s.replace(/\s+/g, ' ').trim();
function onSelection() {
  if ($c('chat').hidden) return;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0), a = selHost(r.startContainer);
  if (a && a === selHost(r.endContainer)) { Sel.in = a; Sel.whole = !r.collapsed && flat(r.toString()) === flat(a.textContent); return; }
  if (r.collapsed) { Sel.in = null; return; }
  // A selection that runs from the chat's header to its message box is Select all.
  const head = $c('chat').querySelector('.c-head'), foot = $c('cCompose');
  if (!Sel.in || !Sel.in.isConnected || !r.intersectsNode(head) || !r.intersectsNode(foot)) return;
  sel.selectAllChildren(Sel.whole ? $c('cFeed') : Sel.in);
}
document.addEventListener('selectionchange', onSelection);

/* ---------- events ---------- */
function lightbox(src) { $c('cLight').querySelector('img').src = src; $c('cLight').hidden = false; $c('cLight').focus(); }
function openFile(p) { return Viewer.open({ path: p, key: C.key, session: C.sessionId || (C.watch && C.watch.sessionId), cwd: C.info && C.info.cwd }); }

document.addEventListener('DOMContentLoaded', () => {
  const chat = $c('chat');
  $c('cRail').addEventListener('pointerdown', railDown);
  document.addEventListener('pointermove', railMove);
  document.addEventListener('pointerup', railUp);
  document.addEventListener('pointercancel', railUp);
  // The click at the end of a drag doesn't open the chat that was dragged.
  $c('cRail').addEventListener('click', e => { if (Date.now() - Rail.dropped < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  chat.addEventListener('click', wrap(async e => {
    const t = e.target;
    const pv = t.closest('[data-pv]');
    if (pv) { const at = pv.dataset.turn ? { turn: +pv.dataset.turn, src: pv.dataset.src || 'main', path: pv.dataset.pv } : null; if (at) { const ev = (pv.closest('.chg') || {})._ev; const f = ev && ev.files.find(x => x.path === at.path); if (f) Object.assign(at, { add: f.add, del: f.del, status: f.status }); } return showPreview(pv.dataset.pv, pv.dataset.kind, at); }
    const po = t.closest('[data-pvopen]'); if (po) return openFile(po.dataset.pvopen);
    if (t.closest('[data-pvclose]')) return closePreview();
    const fl = t.closest('.flink[data-path], [data-file]');
    if (fl) { e.preventDefault(); return openFile(fl.dataset.path || fl.dataset.file); }
    const rv = t.closest('[data-reveal]');
    if (rv) { const r = await api('/api/reveal', { path: rv.dataset.reveal, key: C.key, session: C.sessionId }); if (r.dryRun) toast(`Would run: ${r.script}`); return; }
    const cp = t.closest('[data-copy]');
    if (cp) return copyText(cp.dataset.copy);
    const ri = t.closest('.ri');
    if (ri && ri.dataset.navchat) {
      // A pinned chat that's closed: open it again, in this window (or watch it, if it's in a terminal).
      const id = ri.dataset.navchat;
      chat.classList.remove('show-rail'); S.closed.delete(`s:${id.toLowerCase()}`);
      if (isViewing({ sessionId: id })) return;
      return isRunning(id) ? watch({ sessionId: id, source: 'terminal' }) : open({ sessionId: id });
    }
    if (ri) { const li = ri.closest('li'); const x = li && findActivity(li.dataset.k); chat.classList.remove('show-rail'); if (x && !isViewing(x)) return openActivity(x); return; }
    const thumb = t.closest('.thumb'); if (thumb) return lightbox(thumb.dataset.full);
    const cc = t.closest('.code-copy');
    if (cc) return copyText(cc.closest('.code').querySelector('code').textContent, null).then(ok => { if (ok) copiedButton(cc); });
    const more = t.closest('.tg-more'); if (more) { const g = more.closest('.tools'); g.classList.toggle('open'); updateGroup(g); return; }
    const rm = t.closest('[data-rm]'); if (rm) { const [a] = C.attachments.splice(+rm.dataset.rm, 1); if (a && a.url) URL.revokeObjectURL(a.url); renderAttachments(); return; }
    const rmf = t.closest('[data-rmf]'); if (rmf) { const f = C.files.splice(+rmf.dataset.rmf, 1)[0]; if (f && f.xhr && !f.rel) f.xhr.abort(); renderAttachments(); return; }
    if (t.closest('#cEarlier')) return loadHistory(C.historyStart);
    const pb = t.closest('[data-p]'); if (pb) return answer(pb.closest('.perm'), pb.dataset.p);
    const rl = t.closest('[data-relay]'); if (rl) return setTarget(rl.dataset.relay);
    const crew = t.closest('[data-crew]');
    if (crew) { const src = crew.dataset.crew; if (src === 'both') return setTarget(C.target === 'both' ? 'main' : 'both'); if (duo() && C.target !== src) return setTarget(src); return !$c('cPick').hidden && Pick.src === src ? closePick() : openPick(src); }
    const pm = t.closest('#cPick [data-model]'); if (pm) return pickModel(Pick.src, { model: pm.dataset.model });
    const pp = t.closest('#cPick [data-preset]');
    if (pp) { const p = presetsFor(Pick.src).find(x => x.id === pp.dataset.preset); if (p) return pickModel(Pick.src, { model: p.model, ...(p.effort ? { effort: p.effort } : {}) }); return undefined; }
    const ps = t.closest('#cPick [data-picksrc]'); if (ps) return openPick(ps.dataset.picksrc);
    if (t.closest('#cPick [data-pickdone]')) return closePick();
    const pe = t.closest('#cPick [data-effort]'); if (pe) return pickModel(Pick.src, { effort: pe.dataset.effort });
    const ts = t.closest('.tg-sum');
    if (ts) { const g = ts.closest('.tools'); g.classList.toggle('folded'); g._opened = !g.classList.contains('folded'); return updateGroup(g); }
    const gi = t.closest('[data-giveimg]'); if (gi) return giveImage(gi.dataset.giveimg);
    const c = t.closest('[data-c]'); if (!c) return;
    switch (c.dataset.c) {
      case 'back': if (SOLO) { window.close(); return undefined; } return close();
      case 'rail': return chat.classList.toggle('show-rail');
      case 'ledger': {
        if (matchMedia('(max-width: 1320px)').matches) return chat.classList.toggle('show-ledger');
        const off = !chat.classList.contains('no-ledger');
        chat.classList.toggle('no-ledger', off);
        try { localStorage.setItem('ledger', off ? 'off' : 'on'); } catch { /* fine */ }
        return renderLedgerSoon();
      }
      case 'attach': return attachMenu(c);
      case 'prompts': return c.getAttribute('aria-expanded') === 'true' ? closeMenu() : promptsMenu(c);
      case 'chip': { const pr = S.prompts.find(x => x.id === c.dataset.pid); if (pr) insertPrompt(pr, true); return undefined; }
      case 'stop': if (C.provider === 'openclaw') return; C.interruptedAt = Date.now(); return Promise.all(targetsNow().filter(x => x.key && (x.state === 'busy' || x.state === 'waiting')).map(x => api('/api/chat/interrupt', { key: x.key })));
      case 'compact': return compactNow(c.dataset.src || 'main');
      case 'chgview': return viewChanges(c.closest('.chg'));
      case 'chgundo': return undoChanges(c.closest('.chg'));
      case 'review': return startReview(c.dataset.base || null);
      case 'limitas': return continueAs(c.dataset.acct);
      case 'limitcodex': return handToCodex();
      case 'limitwait': { const card = c.closest('.limit-card'); return card && card._ev ? waitForReset(card._ev) : undefined; }
      case 'rvfix': case 'rvfixall': case 'rvloop': case 'rvstop': return reviewAction(c.dataset.c, c.closest('.review'), Number(c.dataset.i));
      case 'relay': return relay(c.closest('.turn'));
      case 'fav': { const id = C.sessionId || (C.watch && C.watch.sessionId); if (id) window.toggleFav(id); return undefined; }
      case 'copyturn': {
        // The reply as written (Markdown), not as shown: headings, lists and code fences come along.
        const text = turnMarkdown(c.closest('.turn'));
        if (!text) { toast('This reply has no text to copy yet.', 2500); return undefined; }
        return copyText(text, null).then(ok => { if (ok) copiedButton(c); });
      }
      case 'restart': { const id = C.sessionId, accountId = C.info && C.info.accountId, provider = C.provider; return open({ sessionId: id, mode: 'resume', accountId: provider === 'codex' ? null : accountId, provider }); }
      case 'fork': { const id = C.watch && C.watch.sessionId; return open({ sessionId: id, mode: 'fork' }); }
      case 'takeover': { const id = C.watch && C.watch.sessionId; return open({ sessionId: id, mode: 'resume' }); }
      case 'more': return showMenu(c, C.watch && C.provider === 'openclaw' ? chatHeadItems() : C.watch ? [
        { glyph: '⧉', label: 'Open a copy here', hint: 'keeps the original', run: () => open({ sessionId: C.watch.sessionId, mode: 'fork' }) },
        '-',
        ...chatHeadItems(),
        { label: 'Copy terminal command', run: async () => { const r = await api('/api/command', { account: S.acct, sessionId: C.watch.sessionId }); return copyText(r.command, 'Copied the command.'); } },
      ] : [
        ...chatHeadItems().filter(x => x === '-' || !/^Stop this chat/.test(x.label)),
        '-',
        { glyph: '➤', label: 'Move to a terminal', hint: 'same account', disabled: !C.sessionId, why: 'Send a message first', run: async () => {
          if (!(await window.appConfirm('Continue this chat in a terminal?\n\nIt stops here and resumes in a terminal window as the same account.', { ok: 'Move it' }))) return;
          const key = C.key; close(); const r = await api('/api/chat/handoff', { key });
          toast(r.dryRun ? `Would open a ${r.how}:\n${r.script}` : `Continuing in a ${r.how}.`, 7000);
        } },
        { label: 'Copy terminal command', disabled: !C.sessionId, run: async () => { const r = await api('/api/command', { account: C.info.accountId, sessionId: C.sessionId }); return copyText(r.command, 'Copied the command.'); } },
        '-',
        stopItem(),
      ]);
      default: return undefined;
    }
  }));
  chat.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('code.flink')) { e.preventDefault(); wrap(openFile)(e.target.dataset.path); }
  });
  $c('cMode').addEventListener('change', wrap(async e => { await api('/api/chat/mode', { key: C.key, mode: e.target.value }); toast(`Mode: ${(e.target.selectedOptions[0] || {}).textContent || e.target.value}. Remembered for this chat and new ones in ${C.folder || 'this project'}.`, 3000); renderLedgerSoon(); }));
  $c('cCompose').addEventListener('submit', e => { e.preventDefault(); wrap(sendMessage)(); });
  $c('cText').addEventListener('input', () => { grow(); Slash.moved = false; renderSlash(); saveDraft(); });
  $c('cText').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $c('cText')) closeSlash(); }, 120));
  $c('cSlash').addEventListener('mousedown', e => { const li = e.target.closest('[data-si]'); if (!li) return; e.preventDefault(); pickSlash(+li.dataset.si); });
  $c('cPending').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('why-t')) { e.preventDefault(); wrap(() => answer(e.target.closest('.perm'), 'deny'))(); }
  });
  $c('cText').addEventListener('keydown', e => {
    if (Slash.open && !e.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); Slash.moved = true; Slash.sel = (Slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + Slash.items.length) % Slash.items.length; return renderSlash(); }
      if (e.key === 'Tab' || (e.key === 'Enter' && (Slash.moved || Slash.kind === 'file') && !e.shiftKey)) { e.preventDefault(); return pickSlash(Slash.sel); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Slash.dismissed = $c('cText').value; return closeSlash(); }
      if (e.key === 'Enter') closeSlash();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wrap(sendMessage)(); }
    if (e.key === '.' && e.ctrlKey && duo()) { e.preventDefault(); setTarget(C.target === 'main' ? 'comp' : C.target === 'comp' ? 'both' : 'main'); return; }
    if (e.key === 'Escape' && !$c('cPick').hidden) { e.preventDefault(); closePick(); return; }
    // Esc twice stops whoever your next message goes to (both, when it goes to both).
    const working = targetsNow().filter(x => x.key && (x.state === 'busy' || x.state === 'waiting'));
    if (e.key === 'Escape' && working.length) {
      e.preventDefault();
      if (Date.now() - (C.escArmed || 0) > 1600) { armEsc(working.map(x => x.name).join(' and ')); return; }
      disarmEsc();
      C.interruptedAt = Date.now();
      for (const x of working) wrap(() => api('/api/chat/interrupt', { key: x.key }))();
    }
  });
  $c('cText').addEventListener('paste', e => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  for (const id of ['cFile', 'cMedia', 'cCam', 'cVid']) $c(id).addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
  chat.addEventListener('dragover', e => { if (!C.watch && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); chat.classList.add('drop'); } });
  chat.addEventListener('dragleave', e => { if (e.target === chat || !chat.contains(e.relatedTarget)) chat.classList.remove('drop'); });
  chat.addEventListener('drop', e => { e.preventDefault(); chat.classList.remove('drop'); if (!C.watch) addFiles([...e.dataTransfer.files]); });
  $c('cLight').addEventListener('click', () => { $c('cLight').hidden = true; });
  if ('ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${Math.round(document.querySelector('.c-dock').getBoundingClientRect().height)}px`)).observe(document.querySelector('.c-dock'));
  $c('cScroll').addEventListener('scroll', () => { if (!jumpRaf) jumpRaf = requestAnimationFrame(() => { jumpRaf = 0; syncJump(); }); }, { passive: true });
  $c('cJump').addEventListener('click', jumpLatest);
  $c('cFindQ').addEventListener('input', runFind);
  $c('cFindQ').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? 1 : -1); }   // Enter goes up, to older matches
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); $c('cText').focus(); }
  });
  $c('cFind').addEventListener('click', e => { const b = e.target.closest('[data-find]'); if (!b) return; if (b.dataset.find === 'close') closeFind(); else stepFind(b.dataset.find === 'up' ? -1 : 1); });
  document.addEventListener('keydown', e => {
    if ($c('chat').hidden || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(String(window.getSelection() || '').trim().slice(0, 80)); return; }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    if (!typing && e.key === 'End') { e.preventDefault(); jumpLatest(); }
  });
  document.addEventListener('keydown', e => {
    if ($c('cPick').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePick(); return; }
    if (!$c('cPick').contains(document.activeElement) || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = [...$c('cPick').querySelectorAll('button:not([hidden]), summary')].filter(x => x.offsetParent);
    const i = all.indexOf(document.activeElement);
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    all[(i + d + all.length) % all.length]?.focus({ preventScroll: true });
    e.preventDefault();
  }, true);
  document.addEventListener('mousedown', e => { if (!$c('cPick').hidden && !(e.target.closest && e.target.closest('#cPick, [data-crew]'))) closePick(); });
  $c('pickBack').addEventListener('pointerdown', e => e.preventDefault());
  $c('pickBack').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closePick(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && Rail.drag && Rail.drag.on && !Rail.drag.settling) { e.preventDefault(); e.stopPropagation(); Rail.dropped = Date.now(); railSettle(Rail.drag, false); return; }
    if (e.key === 'Escape' && !$c('cLight').hidden) { $c('cLight').hidden = true; e.stopPropagation(); return; }
    if ($c('chat').hidden) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); (e.shiftKey ? moveInRail : switchRail)(e.key === 'ArrowDown' ? 1 : -1); }
  }, true);
});

/* ---------- right-click inside the chat ---------- */
const copyOut = (text, what = 'Copied.') => copyText(text, what);
// A Copy button says so for a moment once it has copied.
function copiedButton(b) {
  clearTimeout(b._copied);
  if (!b.dataset.label) b.dataset.label = b.textContent;
  b.textContent = 'Copied ✓'; b.classList.add('copied');
  b._copied = setTimeout(() => { b.textContent = b.dataset.label; b.classList.remove('copied'); }, 1600);
}
const quote = text => text.trim().split('\n').map(l => `> ${l}`).join('\n');
async function copyImage(src) {
  try {
    let blob = await (await fetch(src)).blob();
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Picture copied.', 1500);
  } catch { toast(window.REMOTE || !window.isSecureContext ? 'Press and hold the picture to copy or save it.' : 'This picture can’t be copied here. Use “Show in folder” instead.'); }
}
function modelItems(src) {
  const name = PROV_NAME[provFor(src)];
  return [
    { glyph: '◈', label: `Choose ${name}’s model…`, run: () => openPick(src) },
    ...presetsFor(src).map(p => ({ glyph: p.glyph, label: `${p.name}: ${p.label}${p.effort ? ` · ${p.effort}` : ''}`, hint: p.note, checked: C.mi[src] && C.mi[src].model === p.model && C.mi[src].effort === p.effort, run: () => pickModel(src, { model: p.model, ...(p.effort ? { effort: p.effort } : {}) }) })),
  ];
}
// ★ in the header pins this chat to the top of the sidebar.
function syncFav() {
  const b = $c('cFav'); if (!b) return;
  const id = C.sessionId || (C.watch && C.watch.sessionId);
  const on = !!(id && window.isFav && window.isFav(id));
  b.hidden = !id; b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Unpin from the sidebar' : 'Pin to the sidebar';
  b.innerHTML = on ? '★' : '☆';
}
function chatHeadItems() {
  const id = C.sessionId;
  return [
    ...(id ? [{ glyph: window.isFav(id) ? '☆' : '★', label: window.isFav(id) ? 'Unpin from the sidebar' : 'Pin to the sidebar', run: () => window.toggleFav(id) }, '-'] : []),
    ...(reviewAvailable() ? [{ glyph: '◆', label: 'Have Codex review the changes', hint: 'read-only', disabled: C.state === 'ended', why: 'Start the chat again first', run: () => startReview() }, '-'] : []),
    ...(canPopOut() && !C.watch ? [{ glyph: '⧉', label: 'Open in a new window', hint: 'side by side', disabled: !id, why: 'Send a message first', run: () => { const sid = id; close(); popOutChat(sid); } }] : []),
    { glyph: '⌕', label: 'Find in this chat', keys: 'Ctrl F', run: () => openFind() },
    { glyph: '↓', label: 'Jump to the latest message', keys: 'End', run: jumpLatest },
    '-',
    { glyph: '❧', label: 'Export as Markdown', hint: window.Android ? 'copies it' : 'saves a .md file', run: exportChat },
    { label: 'Copy the whole chat as Markdown', run: () => copyOut(chatMarkdown(), 'Copied the chat as Markdown.') },
    ...(window.Android ? [] : [{ glyph: '❦', label: 'Save as a web page', hint: 'to read or send anywhere', run: savePage }]),
    ...(C.ctx.main && !C.watch && C.state !== 'ended' ? [{ glyph: '⇲', label: 'Summarize the conversation now', hint: ctxLine('main'), disabled: C.state !== 'ready', why: 'Wait for the reply to finish', run: () => compactNow('main') }] : []),
    ...(id && !C.watch ? [{ label: 'Rename chat', run: async () => { await renameChat(id); const [s] = findSession(id); if (s) { C.title = s.title; $c('cTitle').textContent = s.title; } } }] : []),
    ...(id ? [{ label: 'Copy chat ID', run: () => copyOut(id) }] : []),
    { label: 'Browse this chat’s folder', run: () => openFile('.') },
    ...(C.info && C.info.cwd ? [{ glyph: '§', label: 'Rules and tools…', hint: 'for Claude and Codex', run: () => openRules(C.info.cwd) }] : []),
    ...(!C.watch && C.state !== 'ended' ? ['-', stopItem()] : []),
  ];
}
function stopItem() {
  return { label: 'Stop this chat', danger: true, disabled: C.state === 'ended', run: async () => {
    if ((C.state === 'busy' || C.state === 'waiting') && !(await window.appConfirm(`Stop this chat?\n\n${PROV_NAME[C.provider]} is working on a reply; it stops now. The conversation is kept, and you can start it again.`, { ok: 'Stop it', danger: true }))) return;
    await api('/api/chat/stop', { key: C.key });
  } };
}
// Returns menu items for what was right-clicked, or undefined to let the app decide.
function chatContextItems(t, at) {
  if (C.watch && !t.closest('#cFeed')) return undefined;
  const sel = window.getSelection();
  const picked = sel && !sel.isCollapsed ? String(sel).trim() : '';
  if (picked && sel.anchorNode && $c('cFeed').contains(sel.anchorNode) && t.closest('#cFeed')) {
    const short = picked.length > 40 ? `${picked.slice(0, 39)}…` : picked;
    return [
      { glyph: '⧉', label: 'Copy', keys: 'Ctrl C', run: () => copyOut(picked) },
      ...(!C.watch ? [{ glyph: '❝', label: 'Quote in my message', run: () => placeText(`${quote(picked)}\n\n`, false) }] : []),
      ...(duo() ? [{ glyph: '◆', label: `Ask ${PROV_NAME[C.target === 'comp' ? C.provider : partnerProv()]} about this`, run: () => { setTarget(C.target === 'comp' ? 'main' : 'comp', false); placeText(`${quote(picked)}\n\n`, false); } }] : []),
      { glyph: '⌕', label: `Find “${short}” in this chat`, run: () => openFind(picked) },
      { glyph: '✦', label: `Search every chat for “${short}”`, run: () => openPalette(picked) },
    ];
  }
  const gen = t.closest('.gen, .thumb, .af-media');
  if (gen) {
    const img = gen.querySelector('img'), vid = gen.querySelector('video');
    const p = gen.querySelector('[data-file]')?.dataset.file || gen.querySelector('[data-reveal]')?.dataset.reveal || null;
    const inProject = p && C.info && C.info.cwd && p.toLowerCase().startsWith(C.info.cwd.toLowerCase());
    return [
      ...(img ? [{ glyph: '⤢', label: 'View full size', run: () => lightbox((gen.querySelector('[data-full]') || gen).dataset.full || img.src) }, { glyph: '⧉', label: 'Copy picture', run: () => copyImage(img.src) }] : []),
      ...(vid ? [{ glyph: '▶', label: vid.paused ? 'Play' : 'Pause', run: () => (vid.paused ? vid.play() : vid.pause()) }] : []),
      ...(p && C.provider === 'claude' && img ? [{ glyph: '✦', label: 'Give to Claude', run: () => giveImage(p) }] : []),
      ...(p ? ['-', { label: 'Open in the viewer', run: () => openFile(p) }, { label: 'Show in folder', disabled: !!window.REMOTE, why: 'Only on the PC', run: () => api('/api/reveal', { path: p, key: C.key, session: C.sessionId }) }, { label: 'Copy path', run: () => copyOut(p) }] : []),
      ...(inProject && img ? [{ label: 'Use as the project’s banner', run: async () => { await api('/api/project/banner', { cwd: C.info.cwd, path: p }); toast('Banner set.', 1800); } }] : []),
    ];
  }
  const code = t.closest('.code');
  if (code) {
    const text = code.querySelector('code').textContent, lang = code.querySelector('.code-h span').textContent;
    return [
      { glyph: '⧉', label: 'Copy code', run: () => copyOut(text) },
      { label: 'Copy as Markdown', run: () => copyOut(`\`\`\`${lang === 'code' ? '' : lang}\n${text}\n\`\`\``) },
      ...(!C.watch ? [{ glyph: '❝', label: 'Put it in my message', run: () => placeText(`\`\`\`${lang === 'code' ? '' : lang}\n${text}\n\`\`\`\n\n`, false) }] : []),
    ];
  }
  const fl = t.closest('.flink[data-path], [data-file]');
  if (fl) {
    const p = fl.dataset.path || fl.dataset.file;
    return [
      { glyph: '❧', label: 'Open', run: () => openFile(p) },
      { label: 'Show in folder', disabled: !!window.REMOTE, why: 'Only on the PC', run: () => api('/api/reveal', { path: p, key: C.key, session: C.sessionId }) },
      { label: 'Copy path', run: () => copyOut(p) },
      ...(!C.watch ? [{ label: 'Mention it in my message', run: () => placeText(`\`${p}\` `, false) }] : []),
    ];
  }
  if (t.closest('a[href^="http"]')) return undefined;
  const tool = t.closest('.tool');
  if (tool) {
    const v = tool._view || {}, out = tool.querySelector('.t-out');
    const input = typeof v.detail === 'string' ? v.detail : v.detail && v.detail.new ? v.detail.new : '';
    const path = (v.meta && v.meta.path) || (v.name === 'Read' ? v.summary : null);
    return [
      { glyph: tool.open ? '▴' : '▾', label: tool.open ? 'Collapse' : 'Show details', run: () => { tool.open = !tool.open; } },
      ...(input ? [{ glyph: '⧉', label: v.detailKind === 'command' ? 'Copy command' : 'Copy input', run: () => copyOut(input) }] : []),
      ...(out && out.textContent ? [{ label: 'Copy output', run: () => copyOut(out.textContent) }] : []),
      ...(path ? [{ label: `Open ${base(path)}`, run: () => openFile(path) }] : []),
    ];
  }
  const um = t.closest('.umsg');
  if (um) {
    const text = RAW.get(um) || um.innerText;
    return [
      { glyph: '⧉', label: 'Copy message', run: () => copyOut(text) },
      ...(!C.watch ? [{ glyph: '↺', label: 'Edit and send again', hint: 'puts it back in the message box', run: () => { if (um.classList.contains('to-partner')) setTarget('comp', false); placeText(text, true); } },
        { glyph: '❝', label: 'Quote it', run: () => placeText(`${quote(text)}\n\n`, false) }] : []),
    ];
  }
  const turn = t.closest('.turn');
  if (turn) {
    const text = turnMarkdown(turn), prov = turn.dataset.prov || C.provider;
    return [
      ...(text ? [{ glyph: '⧉', label: 'Copy reply', run: () => copyOut(turn.querySelector('.final > .md') ? [...turn.querySelectorAll('.final > .md')].map(x => x.innerText.trim()).join('\n\n') : text) },
        { label: 'Copy as Markdown', run: () => copyOut(text) }] : []),
      ...(text && !C.watch ? [{ glyph: '❝', label: 'Quote in my message', run: () => placeText(`${quote(text)}\n\n`, false) }] : []),
      ...(text && duo() ? [{ glyph: prov === 'codex' ? '✦' : '◆', label: prov === C.provider ? `Ask ${PROV_NAME[partnerProv()]} about this` : `Send to ${PROV_NAME[C.provider]}`, run: () => relay(turn) }] : []),
      '-',
      ...chatHeadItems().filter(x => x !== '-' && /^(Find|Jump)/.test(x.label)),
    ];
  }
  const crew = t.closest('[data-crew]');
  if (crew && crew.dataset.crew === 'both') return [{ glyph: '⇄', label: C.target === 'both' ? 'Write to Claude only' : 'Write to Claude and Codex at once', keys: 'Ctrl .', run: () => setTarget(C.target === 'both' ? 'main' : 'both') }];
  if (crew) {
    const src = crew.dataset.crew, name = PROV_NAME[provFor(src)];
    return [
      ...(duo() && C.target !== src ? [{ glyph: '➤', label: `Write to ${name}`, keys: 'Ctrl .', run: () => setTarget(src) }] : []),
      ...modelItems(src),
      ...(src === 'comp' && C.comp && !C.comp.ended ? ['-', { label: `Stop ${PROV_NAME[partnerProv()]} in this chat`, hint: `your next message to ${PROV_NAME[partnerProv()]} starts it again`, danger: true, run: () => api('/api/chat/stop', { key: C.comp.key }) }] : []),
    ];
  }
  if (t.closest('.c-head, #cFeed, .c-scroll')) return chatHeadItems();
  return undefined;
}

window.ChatUI = {
  open, openKey, watch, close, md, renderRail, refreshUsage: refreshChatUsage, isViewing, neighbor: railNeighbor,
  accountId: () => (!$c('chat').hidden && C.info ? C.info.accountId || null : null),
  showLedger: () => { const chat = $c('chat'); if (matchMedia('(max-width: 1320px)').matches) chat.classList.add('show-ledger'); else { chat.classList.remove('no-ledger'); try { localStorage.setItem('ledger', 'on'); } catch { /* fine */ } } renderLedgerSoon(); },
  sessionsChanged: () => { if (C.watch) refreshWatch(); },
  refreshCrew: () => { if (!$c('chat').hidden) renderCrew(); },
  refreshFav: () => syncFav(),
  sessionId: () => C.sessionId || (C.watch && C.watch.sessionId) || null,
  contextItems: chatContextItems, modelName,
  find: q => openFind(q), exportChat, jumpLatest,
  // Ctrl+K: "Sonnet 5.5", "GPT-6-Luna"… for the chat you're in.
  modelItems: () => {
    if ($c('chat').hidden || C.watch) return [];
    const out = [];
    if (reviewAvailable() && C.state !== 'ended') out.push({ glyph: '◆', t: 'Have Codex review this chat’s changes', s: 'in a read-only sandbox', run: () => startReview(), text: 'review code codex check changes second opinion bugs' });
    for (const src of duo() ? ['main', 'comp'] : ['main']) {
      const mi = C.mi[src]; const name = PROV_NAME[provFor(src)];
      if (src === 'comp' && (!mi || !mi.models)) { out.push({ glyph: '◆', t: `Choose ${name}’s model…`, s: `${name}, in this chat`, run: () => openPick('comp'), text: `${name.toLowerCase()} model switch effort` }); continue; }
      if (C.ctx[src]) out.push({ glyph: '⇲', t: `${name}: summarize the conversation now`, s: ctxLine(src), run: () => compactNow(src), text: `${name} summarize compact context full memory` });
      for (const m of (mi && mi.models) || []) if (m.value !== mi.model) out.push({ glyph: src === 'comp' ? '◆' : '✦', t: `${name}: ${m.label}`, s: m.description, run: () => pickModel(src, { model: m.value }), text: `model switch ${name} ${m.label} ${m.value}` });
      for (const e of (mi && (((mi.models || []).find(x => x.value === mi.model) || {}).efforts || mi.efforts)) || []) if (e !== mi.effort) out.push({ glyph: '◈', t: `${name}: ${e} effort`, run: () => pickModel(src, { effort: e }), text: `effort ${name} ${e} think` });
    }
    return out;
  },
  // For the phone's Back button: closes the picker, then the chat. True if it did something.
  back: () => { if (!$c('cLight').hidden) { $c('cLight').hidden = true; return true; } if (!$c('cPick').hidden) { closePick(); return true; } if ($c('chat').classList.contains('show-rail') || $c('chat').classList.contains('show-ledger')) { $c('chat').classList.remove('show-rail', 'show-ledger'); return true; } if (!$c('chat').hidden) { close(); return true; } return false; },
  isOpen: () => !$c('chat').hidden, key: () => C.key,
};
