'use strict';
/* Keyboard first. One cursor on whatever list is on screen: j/k move it, and every key acts on the
   row under it (or on the selection). g-chords jump between pages. ⌘K finds anything. ? shows it all. */

const SHORTCUTS = [
  ['Anywhere', [['⌘K', 'Find a chat, project or action'], ['c', 'New chat'], ['/', 'Search chats'], ['g n', 'Now'], ['g p', 'Projects'], ['g h', 'Hackathon'], ['g b', 'Bugs'], ['g o', 'Routines'], ['g r', 'Recents'], ['g u', 'Automation'], ['g i', 'Images'], ['g l', 'Alerts'], ['g a', 'Archived'], ['g c', 'Clean up'], ['[ / ] or ⌥↑ / ⌥↓', 'Previous / next chat in the sidebar (⌥ works while typing)'], ['n or ⌥⇧↓', 'Next chat that needs you'], ['m', 'Sounds on / off'], ['z', 'Undo the last move or archive'], ['?', 'This list'], ['esc', 'Back, or clear the selection']]],
  ['Needs you', [['t', 'Triage: one at a time, the next opens by itself'], ['a / d', 'Allow / deny'], ['r', 'Reply'], ['e', 'Done'], ['o', 'Open the chat']]],
  ['On a list', [['j / k', 'Next / previous'], ['↵ or o', 'Open'], ['x', 'Select (⇧-click and ⌘-click too)'], ['1–4', 'Status: Exploring, Building, Finishing, Done'], ['→ / ←', 'Open / fold a chat’s sub-chats'], ['f', 'Focus on / off'], ['w', 'Waiting on…'], ['s', 'Status, kind and more'], ['e', 'Archive (on Archived: bring back)'], ['a / d', 'Allow / deny (Needs you)'], ['r', 'Reply without opening']]],
  ['In a chat', [['↵', 'Send'], ['⇧↵', 'New line'], ['⌘.', 'Stop'], ['a / d', 'Allow / deny a request'], ['esc', 'Back to where you were']]],
];

/* ---------- the cursor ---------- */
let cur = -1;
const rows = () => [...$('main').querySelectorAll('[data-cur]')].filter(el => el.offsetParent);
function setCur(i, { scroll = true } = {}) {
  const list = rows(); if (!list.length) { cur = -1; return null; }
  cur = Math.max(0, Math.min(list.length - 1, i));
  for (const el of list) el.classList.toggle('cur', el === list[cur]);
  if (scroll) list[cur].scrollIntoView({ block: 'nearest' });
  return list[cur];
}
const curRow = () => { const list = rows(); return cur >= 0 && cur < list.length ? list[cur] : null; };
// After a redraw, the cursor stays on the same chat when it can.
function keepCur() {
  const list = rows(); if (cur < 0 || !list.length) return;
  const id = keepCur.id;
  const i = id ? list.findIndex(el => el.dataset.cur === id) : -1;
  setCur(i >= 0 ? i : Math.min(cur, list.length - 1), { scroll: false });
}
const idsAt = el => { const id = el && (el.dataset.chat || el.dataset.open); return S.sel.size && id && S.sel.has(id) ? [...S.sel] : S.sel.size && !id ? [...S.sel] : id ? [id] : []; };

let chord = null, chordTimer = null;
const GO = { n: 'now', p: 'home', h: 'hack', b: 'bugs', o: 'routines', r: 'recent', u: 'automation', i: 'images', l: 'alerts', a: 'archived', c: 'cleanup' };
// Rifling: the sidebar's chats in order, and the ones that need you.
function stepChat(dir) {
  const list = [...document.querySelectorAll('#sideScroll [data-chat]')].filter(b => b.offsetParent);
  if (!list.length) return;
  const here = list.findIndex(b => S.view === 'chat' && low(b.dataset.chat) === low(CV.id));
  const next = list[here < 0 ? (dir > 0 ? 0 : list.length - 1) : (here + dir + list.length) % list.length];
  next.scrollIntoView({ block: 'nearest' }); next.click();
}
function nextNeeding() {
  const list = needList().filter(x => x.sessionId);
  if (!list.length) return toast('Nothing needs you.');
  const here = list.findIndex(x => S.view === 'chat' && low(x.sessionId) === low(CV.id));
  openChat(list[(here + 1) % list.length].sessionId);
}
function onKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (mod && e.key === '.' && S.view === 'chat' && CV.key && CV.busy) { e.preventDefault(); sfx('close'); return wrap(() => api('/api/chat/interrupt', { key: CV.key }))(); }
  if ($('palRoot').innerHTML) return undefined; // the palette handles its own keys
  // Rifling works even while typing: ⌥↑ / ⌥↓ the sidebar's chats, ⌥⇧↓ the next that needs you.
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return e.shiftKey && e.key === 'ArrowDown' ? nextNeeding() : stepChat(e.key === 'ArrowDown' ? 1 : -1); }
  if (e.key === 'Escape') {
    if ($('modalRoot').innerHTML) { $('modalRoot').innerHTML = ''; return undefined; }
    if ($('popRoot').innerHTML) return closePop();
    // One step at a time: the first Esc leaves the box (so single-key shortcuts work), the next goes back.
    if (typing) { if (e.target.value && S.view !== 'chat') return undefined; e.target.blur(); if (S.view === 'chat') $('feed')?.focus(); return undefined; }
    if (S.sel.size) { S.sel.clear(); return render(); }
    if (S.view === 'triage') return go('now');
    if (S.view === 'chat' || S.view === 'newchat' || S.view === 'search' || S.view === 'project') return go('back');
    return undefined;
  }
  if (typing || mod || e.altKey) return undefined;
  if ($('modalRoot').innerHTML) return undefined;
  if (chord === 'g') { clearTimeout(chordTimer); chord = null; if (GO[e.key]) { e.preventDefault(); return go(GO[e.key]); } return undefined; }
  if (e.key === 'g') { chord = 'g'; chordTimer = setTimeout(() => { chord = null; }, 900); return undefined; }
  if (S.view === 'triage') {
    const map = { a: 'allow', d: 'deny', r: 'reply', e: 'done', o: 'open', Enter: 'open' };
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); TR.i = Math.min(TR.i + 1, Math.max(0, trItems().length - 1)); TR.replying = false; return render(); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); TR.i = Math.max(0, TR.i - 1); TR.replying = false; return render(); }
    const b = map[e.key] && document.querySelector(`[data-tr="${map[e.key]}"]`);
    if (b) { e.preventDefault(); b.click(); }
    return undefined;
  }
  const row = curRow();
  const hover = document.querySelector('[data-cur]:hover');
  const target = row || hover;
  switch (e.key) {
    case 'j': case 'ArrowDown': if (S.view === 'chat') return undefined; e.preventDefault(); keepCur.id = (setCur(cur + 1) || {}).dataset?.cur; return undefined;
    case 'k': case 'ArrowUp': if (S.view === 'chat') return undefined; e.preventDefault(); keepCur.id = (setCur(cur < 0 ? 0 : cur - 1) || {}).dataset?.cur; return undefined;
    case 'c': e.preventDefault(); return go('newchat', { ncProject: S.view === 'project' ? S.project : null });
    case '/': e.preventDefault(); $('q').focus(); return undefined;
    case '?': e.preventDefault(); return showShortcuts();
    case 'm': e.preventDefault(); return toggleSound();
    case '[': e.preventDefault(); return stepChat(-1);
    case ']': e.preventDefault(); return stepChat(1);
    case 'n': if (S.view !== 'triage') { e.preventDefault(); return nextNeeding(); } break;
    case 'z': if (lastUndo) { e.preventDefault(); const u = lastUndo; lastUndo = null; $('toastRoot').innerHTML = ''; return wrap(u)(); } return undefined;
    default: break;
  }
  if (S.view === 'now' && e.key === 't' && needList().length) { e.preventDefault(); return startTriage(); }
  if (S.view === 'chat') {
    const p = [...CV.pending.values()][0];
    if (p && !p.questions && (e.key === 'a' || e.key === 'd')) { e.preventDefault(); return answerInChat(p.requestId, e.key === 'a' ? 'allow' : 'deny'); }
    if (e.key === 's') { const b = document.querySelector('.chat-h .stage'); if (b) { e.preventDefault(); b.click(); } }
    if (e.key === 'e' && CV.id && chatBy.get(CV.id)) { e.preventDefault(); return wrap(archiveChats)([CV.id]).then(() => go('back')); }
    if (e.key === 'w' && CV.id && chatBy.get(CV.id)) { e.preventDefault(); return askWaiting([CV.id]); }
    if (e.key === 'f' && CV.id && chatBy.get(CV.id)) { e.preventDefault(); return wrap(toggleFocus)([CV.id]); }
    return undefined;
  }
  if (!target) return undefined;
  const ids = idsAt(target).filter(id => chatBy.get(id));
  if ((e.key === 'Enter' || e.key === 'o') && target) { e.preventDefault(); return target.click(); }
  if (e.key === 'x' && target.dataset.chat) { e.preventDefault(); const id = target.dataset.chat; if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); keepCur.id = target.dataset.cur; return render(); }
  if (/^[1-4]$/.test(e.key) && ids.length) { e.preventDefault(); keepCur.id = target.dataset.cur; return wrap(setChats)(ids, { status: STATUSES[Number(e.key) - 1].id }); }
  // → opens a family, ← folds it (from a sub-chat, back up to its parent).
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (target.dataset.fam || target.dataset.chat)) {
    const id = target.dataset.fam || target.dataset.chat, c = chatBy.get(id);
    if (e.key === 'ArrowRight' && kidsOf(id).length && !famOpen(id)) { e.preventDefault(); toggleFam(id, true); keepCur.id = target.dataset.cur; return render(); }
    if (e.key === 'ArrowLeft') {
      if (kidsOf(id).length && famOpen(id)) { e.preventDefault(); toggleFam(id, false); keepCur.id = target.dataset.cur; return render(); }
      const p = parentOn(c); if (p) { e.preventDefault(); toggleFam(p.id, false); keepCur.id = p.id; return render(); }
    }
    return undefined;
  }
  if (e.key === 'f' && ids.length) { e.preventDefault(); keepCur.id = target.dataset.cur; return wrap(toggleFocus)(ids); }
  if (e.key === 's' && ids.length) { e.preventDefault(); return rowMenu(target, ids[0]); }
  if (e.key === 'w' && ids.length) { e.preventDefault(); return askWaiting(ids); }
  if ((e.key === 'Backspace' || e.key === 'Delete') && target.dataset.idea) { e.preventDefault(); return wrap(saveIdeas)((S.lite.ideas || []).filter(i => i.id !== target.dataset.idea)); }
  if (e.key === 'e' && ids.length) { e.preventDefault(); return S.view === 'archived' ? wrap(unarchiveChats)(ids) : wrap(archiveChats)(ids); }
  const wrapEl = target.closest('.rowwrap');
  if ((e.key === 'a' || e.key === 'd') && wrapEl) { const b = wrapEl.querySelector(`[data-perm="${e.key === 'a' ? 'allow' : 'deny'}"]`); if (b) { e.preventDefault(); b.click(); } return undefined; }
  if (e.key === 'r' && wrapEl) { const i = wrapEl.querySelector('[data-qr]'), o = wrapEl.querySelector('[data-qreply]'); if (i || o) { e.preventDefault(); if (i) i.focus(); else openQuickReply(o.dataset.qreply); } return undefined; }
  return undefined;
}
document.addEventListener('keydown', onKey);
async function answerInChat(requestId, decision, answers) {
  try { await api('/api/chat/permission', { key: CV.key, requestId, decision, ...(answers ? { answers } : {}) }); sfx(decision === 'deny' ? 'shove' : 'chip'); }
  catch (err) { toast(err.message); }
}

/* ---------- ⌘K ---------- */
const Pal = { items: [], sel: 0 };
function score(text, q) {
  const t = String(text || '').toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const term of terms) { const i = t.indexOf(term); if (i < 0) return -1; s += i === 0 ? 30 : /\W/.test(t[i - 1]) ? 20 : 8; }
  return s;
}
function palItems(q) {
  const acts = [
    { t: L('Now'), s: 'g n', run: () => go('now') }, { t: L('Projects'), s: 'g p', run: () => go('home') }, { t: 'Hackathon', s: 'g h', run: () => go('hack') }, { t: 'Bugs', s: 'g b', run: () => go('bugs') }, { t: 'Routines', s: 'g o', run: () => go('routines'), alias: 'automation schedule checker cron' }, { t: 'New routine', run: () => newRoutine('check'), alias: 'automation schedule checker' },
    { t: L('Recents'), s: 'g r', run: () => go('recent') }, { t: 'Images', s: 'g i', run: () => go('images'), alias: 'pictures gallery gpt image' }, { t: 'Archived', s: 'g a', run: () => go('archived') },
    { t: 'Clean up', s: 'g c · free space, worktrees', run: () => go('cleanup'), alias: 'disk space node_modules worktree' }, { t: 'Phone alerts', run: () => go('alerts'), alias: 'push notifications iphone' },
    { t: L('New chat'), s: 'c', run: () => go('newchat'), alias: 'start' },
    ...(S.view === 'chat' && chatBy.get(CV.id) ? [{ t: 'Rename this chat', s: 'or click its title', run: () => editTitleInline(), alias: 'title name' }] : []),
    { t: 'Generate images with Codex', s: 'GPT Image, on the use-next ChatGPT plan', run: () => go('images', { genOpen: true }), alias: 'draw picture art cover' },
    { t: 'Check plan usage now', run: () => { go('now'); loadPlans(true).then(renderPlansOnly).catch(err => toast(err.message)); }, alias: 'usage limits refresh' },
    { t: prefs.sound ? 'Turn sounds off' : 'Turn sounds on', run: () => setSound(!prefs.sound), alias: 'audio mute' },
    { t: prefs.notify ? 'Turn desktop notifications off' : 'Turn desktop notifications on', run: () => setNotify(!prefs.notify), alias: 'alerts' },
    ...['plain', 'imperial', 'rebel'].filter(x => x !== skin()).map(x => ({ t: `Skin: ${x[0].toUpperCase() + x.slice(1)}`, run: () => wrap(setLook)({ skin: x }), alias: 'theme look' })),
    ...[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']].filter(([m]) => m !== S.lite.look.mode).map(([m, n]) => ({ t: `Appearance: ${n}`, run: () => wrap(setLook)({ mode: m }), alias: 'theme mode' })),
    { t: 'Keyboard shortcuts', s: '?', run: showShortcuts, alias: 'keys help hotkeys' },
    { t: 'Open the full app', run: () => { location.href = '/'; }, alias: 'tyler classic hub' },
  ].map(x => ({ ...x, kind: 'Go', text: `${x.t} ${x.alias || ''}` }));
  const chats = allChats().sort((a, b) => b.updated - a.updated).map(c => ({ kind: 'Chat', t: c.title, s: `${projOf(c).name} · ${statusById(statusOf(c)).name}${c.kind && c.kind !== 'feature' ? ` · ${kindById(c.kind).name}` : ''}${c.focus ? ' · Focus' : ''} · ${ago(c.updated)}`, run: () => openChat(c.id), text: `${c.title} ${projOf(c).name}`, boost: needs(c) ? 25 : running(c) ? 15 : 0 }));
  const projs = S.projects.filter(p => !p.archived && (p.bucket || chatsOfProject(p.key).length)).map(p => ({ kind: 'Project', t: p.name, s: bucketName(p.bucket), run: () => go('project', { project: p.key }), text: `${p.name} ${p.folder || ''}` }));
  const news = q ? S.projects.filter(p => p.cwd && p.exists && !p.archived && !p.loose).map(p => ({ kind: 'New chat', t: `New chat in ${p.name}`, run: () => go('newchat', { ncProject: p.key }), text: `new chat ${p.name}` })) : [];
  if (!q) return [...chats.filter(c => c.boost).slice(0, 6), ...acts.slice(0, 9), ...chats.filter(c => !c.boost).slice(0, 8)];
  return [...acts, ...projs, ...news, ...chats].map(x => ({ x, raw: score(x.text, q) })).filter(r => r.raw >= 0).map(r => ({ x: r.x, s: r.raw + (r.x.boost || 0) + (r.x.kind === 'Go' ? 4 : r.x.kind === 'Project' ? 3 : 0) })).sort((a, b) => b.s - a.s).slice(0, 40).map(r => r.x);
}
function openPalette() {
  sfx('fan');
  $('palRoot').innerHTML = `<div class="pal-back"><div class="pal" role="dialog" aria-label="Find anything"><input id="palQ" placeholder="Find a chat, project or action…" autocomplete="off" spellcheck="false"><div class="pal-list" id="palList" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div></div></div>`;
  const q = $('palQ');
  const paint = () => {
    Pal.items = palItems(q.value.trim()); Pal.sel = Math.min(Pal.sel, Math.max(0, Pal.items.length - 1));
    $('palList').innerHTML = Pal.items.map((it, i) => `<button class="pal-i" role="option" aria-selected="${i === Pal.sel}" data-pi="${i}"><span class="pal-k">${esc(it.kind)}</span><span class="pal-t">${esc(it.t)}</span>${it.s ? `<small>${esc(it.s)}</small>` : ''}</button>`).join('') || '<p class="empty-note">Nothing matches.</p>';
    $('palList').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const it = Pal.items[i]; closePalette(); if (it) it.run(); };
  q.addEventListener('input', () => { Pal.sel = 0; paint(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); Pal.sel = Math.min(Pal.items.length - 1, Pal.sel + 1); paint(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); Pal.sel = Math.max(0, Pal.sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(Pal.sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  $('palRoot').querySelector('.pal-back').addEventListener('click', e => { const b = e.target.closest('[data-pi]'); if (b) run(Number(b.dataset.pi)); else if (e.target.classList.contains('pal-back')) closePalette(); });
  Pal.sel = 0; paint(); q.focus();
}
function closePalette() { if (!$('palRoot').innerHTML) return; $('palRoot').innerHTML = ''; sfx('close'); }

function showShortcuts() {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><div class="modal keys-sheet" role="dialog" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3>${SHORTCUTS.map(([h, list]) => `<div class="ks-g"><p class="ks-h">${h}</p>${list.map(([k, d]) => `<div class="ks-r"><span>${esc(d)}</span><span>${k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</span></div>`).join('')}</div>`).join('')}</div></div>`;
  root.querySelector('.modal-back').addEventListener('click', e => { if (e.target.classList.contains('modal-back')) root.innerHTML = ''; });
}
