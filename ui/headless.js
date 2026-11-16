'use strict';
/* Headless runs: chats a script or another agent started (`claude -p`, the Agent SDK, `codex exec`; the PC marks them,
   lib/headless.js). A review pipeline can leave dozens at once, so they're out of the everyday lists (ui/base.js,
   sortDone) and here instead: a sidebar section with what's working first, and a page of their own with a filter, a
   folder picker, and ticks for doing several at once: done, into a group, or back with your chats. Each project
   still has its own, folded away under its chats. */

const HL = { q: '', folder: '', picked: new Set(), shown: 100 };
const HL_ABOUT = 'Chats a script or another agent started (claude -p, the Agent SDK, codex exec), kept out of your other lists.';

// What a run is doing, in a word, from what's running (S.activity). k: needs, working, open or '' (it's finished).
// tag: whether its row needs to say so (a row already says Open, or In a terminal, by itself).
function headlessState(s) {
  const x = S.activity.find(y => y.sessionId && lowId(y.sessionId) === lowId(s.id) && !y.parentKey);
  if (x) {
    const st = statusOf(x);
    if (NEEDS.has(st)) return { k: 'needs', word: chatState(x).word, tag: true };
    if (st === 'working') return { k: 'working', word: 'Working', tag: true };
    if (x.source === 'app') return { k: 'open', word: 'Open here', tag: false };
    return { k: '', word: 'Just finished', tag: true };
  }
  if (liveOf(s.id)) return { k: 'open', word: 'Open here', tag: false };
  if (isRunning(s.id)) return { k: 'working', word: 'In a terminal', tag: false };
  return { k: '', word: '', tag: false };
}
const HL_RANK = { needs: 0, working: 1, open: 2, '': 3 };

// The sidebar's section: the ones working or needing you first, then the latest, and all of them a click away.
function navHeadlessHtml(viewing) {
  const all = allHeadless();
  if (!all.length) return '';
  const rows = all.map(([s, p]) => ({ s, p, st: headlessState(s) }));
  const busy = rows.filter(r => r.st.k === 'needs' || r.st.k === 'working').length;
  const pick = [...rows].sort((a, b) => HL_RANK[a.st.k] - HL_RANK[b.st.k] || (b.s.updated || 0) - (a.s.updated || 0)).slice(0, 5);
  const folded = S.navFold.has('headless');
  const head = `<button class="nav-h prov headless fold" data-fold="headless" aria-expanded="${!folded}"><span class="pmark" aria-hidden="true"></span>Headless runs<span class="count">${busy ? `${busy} working · ` : ''}${all.length}<span class="sr"> headless runs</span></span><span class="fold-c" aria-hidden="true">▾</span></button>`;
  if (folded) return head;
  const dot = k => (k === 'needs' ? 'gilt-dot' : k === 'working' ? 'violet-dot' : k === 'open' ? 'ready-dot' : '');
  const row = ({ s, p, st }) => `<button class="nav-i nav-chat hl-chat ${provOf(s) === 'claude' ? '' : provOf(s)}" data-navchat="${esc(s.id)}" title="${esc(s.title)} · ${esc(p.name)}" aria-current="${!!(viewing && lowId(s.id) === viewing)}">${crestHtml(p, 20, 'ni-crest')}<span class="ni-t"><span class="nc-t">${esc(s.title)}</span><small>${st.word ? `${esc(st.word)} · ` : ''}${esc(p.name)}${st.k ? '' : ` · ${esc(agoL(s.updated))}`}</small></span>${dot(st.k) ? `<span class="${dot(st.k)} nav-dot" aria-hidden="true"></span>` : ''}</button>`;
  return `${head}${pick.map(row).join('')}<button class="nav-i nav-more" data-view="headless" aria-current="${S.view === 'headless'}"><span class="glyph" aria-hidden="true">⚙</span><span class="ni-t">${all.length > pick.length ? `All ${all.length} headless runs` : 'Headless runs page'}</span></button>`;
}

// The ones the filter and folder picker leave, each with its state, working ones first.
function headlessShown() {
  const q = HL.q.trim().toLowerCase();
  return allHeadless()
    .filter(([s, p]) => (!HL.folder || p.cwd === HL.folder) && (!q || `${s.title || ''} ${s.firstPrompt || ''} ${s.lastPrompt || ''} ${p.name}`.toLowerCase().includes(q)))
    .map(([s, p]) => ({ s, p, st: headlessState(s) }));
}

function renderHeadless() {
  if (S.view !== 'headless') return;
  const all = allHeadless();
  // Ticks for runs that have gone (done, or back with your chats) go too.
  const ids = new Set(all.map(([s]) => lowId(s.id)));
  for (const id of [...HL.picked]) if (!ids.has(id)) HL.picked.delete(id);
  const folders = [...new Map(all.map(([, p]) => [p.cwd, p])).values()].sort((a, b) => a.name.localeCompare(b.name));
  if (HL.folder && !folders.some(p => p.cwd === HL.folder)) HL.folder = '';
  if (!$('hlList')) {
    $('page').innerHTML = `<header class="f-head"><div><p class="eyebrow">⚙ Started by scripts and agents</p><h1>Headless runs</h1><p class="f-meta" id="hlMeta"></p></div>
        <div class="f-act"><button class="btn quiet" data-hact="settings" title="Setup → Preferences">Keep them with my chats…</button></div></header>
      <div class="hl-bar" id="hlBar">
        <label class="wb-filter"><span class="sr">Filter headless runs</span><input type="search" id="hlQ" placeholder="Filter by name or first words" autocomplete="off" spellcheck="false"></label>
        <label class="hl-folder"><span class="sr">Folder</span><select id="hlFolder"></select></label>
        <label class="hl-all"><input type="checkbox" id="hlAll"> <span>Select all shown</span></label>
      </div>
      <div class="hl-act" id="hlAct" role="toolbar" aria-label="Selected headless runs" hidden></div>
      <div id="hlList"></div>`;
    $('hlQ').value = HL.q;
  }
  const meta = all.length ? `${plural(all.length, 'run')} in ${plural(folders.length, 'folder')}. ${HL_ABOUT}` : HL_ABOUT;
  if ($('hlMeta').textContent !== meta) $('hlMeta').textContent = meta;
  const opts = `<option value="">Every folder</option>${folders.map(p => `<option value="${esc(p.cwd)}" ${p.cwd === HL.folder ? 'selected' : ''}>${esc(p.name)} (${all.filter(([, q]) => q === p).length})</option>`).join('')}`;
  if ($('hlFolder')._h !== opts) { $('hlFolder').innerHTML = opts; $('hlFolder')._h = opts; $('hlFolder').value = HL.folder; }
  $('hlBar').hidden = !all.length;
  renderHeadlessList();
}

function renderHeadlessList() {
  const box = $('hlList'); if (!box) return;
  const all = allHeadless();
  if (!all.length) { box.innerHTML = emptyArt('chats', 'No headless runs right now. When a script or another agent starts a chat (<code>claude -p</code>, the Agent SDK, <code>codex exec</code>), it comes here instead of your other lists.'); box._sig = null; renderHeadlessActs([]); return; }
  const shown = headlessShown();
  if (!shown.length) { box.innerHTML = '<p class="empty-line">No headless run here has that in its name or first words.</p>'; box._sig = null; renderHeadlessActs(shown); return; }
  const now = shown.filter(r => r.st.k).sort((a, b) => HL_RANK[a.st.k] - HL_RANK[b.st.k] || (b.s.updated || 0) - (a.s.updated || 0));
  const rest = shown.filter(r => !r.st.k);
  if (!box.querySelector('#hlNow')) { box.innerHTML = '<h2 class="hl-h" id="hlNowH"></h2><ul class="rows" id="hlNow"></ul><h2 class="hl-h" id="hlRestH"></h2><ul class="rows" id="hlRest"></ul><p class="hl-more" id="hlMore"></p>'; box._sig = null; }
  // Ticks only on rows that show: one the filter hides is let go, so nothing out of sight is done or moved.
  const showing = new Set(hlVisible(shown).map(r => lowId(r.s.id)));
  for (const id of [...HL.picked]) if (!showing.has(id)) HL.picked.delete(id);
  const row = r => rowHtml(r.s, r.p.name, null, { pick: HL.picked.has(lowId(r.s.id)), state: r.st.tag ? r.st : null });
  $('hlNowH').hidden = !now.length; $('hlNowH').innerHTML = `Working now <span class="count">${now.length}</span>`;
  $('hlRestH').hidden = !rest.length || !now.length; $('hlRestH').innerHTML = `Finished <span class="count">${rest.length}</span>`;
  patch($('hlNow'), now, r => r.s.id, row);
  patch($('hlRest'), rest.slice(0, HL.shown), r => r.s.id, row);
  const more = rest.length - Math.min(rest.length, HL.shown);
  $('hlMore').innerHTML = more > 0 ? `<button class="btn quiet sm" data-hact="more">Show ${Math.min(more, 100)} more</button> <span>of ${more} not shown</span>` : '';
  renderHeadlessActs(shown);
}

// The rows showing: every one working or open, and the finished ones up to Show more.
const hlVisible = shown => shown.filter(r => r.st.k).concat(shown.filter(r => !r.st.k).slice(0, HL.shown));
// The bar for the ticked ones: what can be done to all of them at once.
function renderHeadlessActs(shown) {
  const bar = $('hlAct'); if (!bar) return;
  const n = HL.picked.size;
  const visible = hlVisible(shown);
  const allBox = $('hlAll');
  if (allBox) { const on = visible.filter(r => HL.picked.has(lowId(r.s.id))).length; allBox.checked = !!visible.length && on === visible.length; allBox.indeterminate = on > 0 && on < visible.length; }
  const h = n ? `<span class="hl-n" aria-live="polite">${plural(n, 'run')} selected</span>
    <button class="btn sm" data-hact="done">✓ Mark done</button>
    <button class="btn sm" data-hact="group" aria-haspopup="menu">▤ Move to group…</button>
    ${n === 1 ? '<button class="btn sm" data-hact="open">Open</button>' : ''}
    <button class="btn sm quiet" data-hact="mine" title="Out of Headless runs, into your other lists">Back with my chats</button>
    <button class="btn sm quiet" data-hact="clear">Clear</button>` : '';
  if (bar._h !== h) { bar.innerHTML = h; bar._h = h; }
  bar.hidden = !n;
}

const hlPicked = () => [...HL.picked].map(id => sessionById(id)[0]).filter(Boolean).map(s => s.id);
// A request each 500 chats (one request's words are limited), one after another.
async function hlInBatches(addr, ids, body) {
  let last = null;
  for (let i = 0; i < ids.length; i += 500) last = await api(addr, { ...body, ids: ids.slice(i, i + 500) });
  return last;
}

async function headlessDone(ids, done = true, quiet = false) {
  if (!ids.length) return;
  const r = await hlInBatches('/api/chats/done', ids, { done });
  S.doneMarks = r.doneMarks || {};
  if (!done) for (const id of ids) { const m = S.doneMarks[lowId(id)]; if (m) m.undone = Date.now(); }
  for (const id of ids) HL.picked.delete(lowId(id));
  sortDone(); renderAll();
  if (!quiet) offerUndo(done ? `${plural(ids.length, 'run')} done. Each is under Done in its project, and comes back if it’s used again.` : `${plural(ids.length, 'run')} back.`, () => headlessDone(ids, !done, true));
}
// Into Headless runs (true), back with your chats (false), or back to how each began (null). Undo puts back what
// you'd said about each before.
async function setHeadless(ids, on, quiet = false) {
  if (!ids.length) return;
  const was = {};
  for (let i = 0; i < ids.length; i += 500) Object.assign(was, (await api('/api/chats/headless', { ids: ids.slice(i, i + 500), on })).was || {});
  for (const id of ids) HL.picked.delete(lowId(id));
  await Promise.all([loadSessions(), loadActivity()]); renderAll();
  if (quiet) return;
  const n = ids.length === 1 ? 'It' : plural(ids.length, 'chat');
  offerUndo(on === false ? `${n} ${ids.length === 1 ? 'is' : 'are'} back with your chats.` : `${n} ${ids.length === 1 ? 'is' : 'are'} in Headless runs now.`, async () => {
    const back = new Map();
    for (const id of ids) { const v = was[id] === true || was[id] === false ? was[id] : null; back.set(v, [...(back.get(v) || []), id]); }
    for (const [v, list] of back) await setHeadless(list, v, true);
  });
}
// Into a group, every one of them (a new group takes the first, then the rest follow).
function headlessGroupItems(ids) {
  const move = async gid => { for (const id of ids) await api('/api/organize', { action: 'move', chat: id, id: gid }); await orgDo({ action: 'collapse', id: gid, collapsed: false }); };
  return [
    ...S.org.groups.map(g => ({ label: g.name, run: async () => { await move(g.id); toast(`Moved ${plural(ids.length, 'run')} to ${g.name}.`, 3000); } })),
    ...(S.org.groups.length ? ['-'] : []),
    { glyph: '+', label: 'New group…', run: async () => {
      const name = await ask('New group', `Name the group. ${ids.length === 1 ? 'This run moves' : `These ${ids.length} runs move`} into it.`, '', 'Create group');
      if (!name) return;
      const r = await orgDo({ action: 'create', name, chat: ids[0] });
      if (r && r.made) await move(r.made.id);
      toast(`Made the group “${name}”.`, 2500);
    } },
  ];
}
// Its right-click menu: into Headless runs, or back with your chats (only while they're kept apart).
function headlessItem(id) {
  const [s] = sessionById(id);
  // (Not for OpenClaw's sessions, which are never runs, nor anything without a chat id of the usual kind.)
  if (!s || !headlessApart() || isCommander(id) || isOpenClaw(s) || !/^[\w-]{8,80}$/.test(s.id)) return [];
  return s.headless
    ? [{ glyph: '⚙', label: 'Back with my chats', hint: 'out of Headless runs', run: () => setHeadless([s.id], false) }]
    : [{ glyph: '⚙', label: 'Move to Headless runs', hint: 'with the runs scripts and agents started', run: () => setHeadless([s.id], true) }];
}

// Imperial and Rebel keep them with your chats (ui/base.js headlessApart): sorted again when the look changes family.
document.addEventListener('lookchange', () => {
  if (!Array.isArray(S.projects) || S.hlApart === undefined || headlessApart() === S.hlApart) return;
  sortDone(); renderAll();
  if (!S.hlApart && S.view === 'headless') go('hub');
});

document.addEventListener('input', e => {
  if (e.target.id === 'hlQ') { HL.q = e.target.value; HL.shown = 100; renderHeadlessList(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'hlFolder') { HL.folder = t.value; HL.shown = 100; renderHeadlessList(); return; }
  if (t.matches && t.matches('input[data-hpick]')) { const id = lowId(t.dataset.hpick); if (t.checked) HL.picked.add(id); else HL.picked.delete(id); renderHeadlessList(); return; }
  if (t.id === 'hlAll') {
    for (const r of hlVisible(headlessShown())) { if (t.checked) HL.picked.add(lowId(r.s.id)); else HL.picked.delete(lowId(r.s.id)); }
    renderHeadlessList();
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-hact]'); if (!b) return;
  const a = b.dataset.hact, ids = hlPicked();
  if (a === 'more') { HL.shown += 100; return renderHeadlessList(); }
  if (a === 'clear') { HL.picked.clear(); return renderHeadlessList(); }
  if (a === 'settings') return openSetup('health').then(() => { if (typeof setupShowSection === 'function') setupShowSection('prefHeadless'); const el = $('prefHeadless'); if (el) { el.scrollIntoView({ block: 'center' }); el.querySelector('input').focus({ preventScroll: true }); } });
  if (a === 'done') return wrap(() => headlessDone(ids, true))();
  if (a === 'mine') return wrap(() => setHeadless(ids, false))();
  if (a === 'open' && ids[0]) return openChatFromNav(ids[0]);
  if (a === 'group') return showMenu(b, headlessGroupItems(ids));
  return undefined;
});
