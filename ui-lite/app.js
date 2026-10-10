'use strict';
/* The sidebar (pages, bucket switcher, stage labels with quiet folding), routing, and every click,
   key and drag on the page. */

const VIEWS = ['now', 'home', 'hack', 'recent', 'project', 'search', 'side'];

function sideChat(c) {
  const marks = (stageOf(c) === 'waiting' && c.waitingOn ? `<span class="tag wait-tag">${esc(c.waitingOn)}</span>` : '') + (needs(c) ? '<span class="dot needs-dot" title="Needs you"></span>' : running(c) ? '<span class="live-dot" title="Running"></span>' : '');
  return `<button class="nav-i chat-i" draggable="true" data-chat="${esc(c.id)}" title="${esc(c.title)} · ${esc(projOf(c).name)}"><span class="lbl">${esc(c.title)}</span>${marks}</button>`;
}
function renderSide() {
  renderChip();
  $('brand').textContent = L('Switcher');
  $('q').placeholder = L('Search chats');
  const b = buckets().find(x => x.id === S.bucket);
  const chats = allChats().filter(inBucket).sort((x, y) => y.updated - x.updated);
  const nNeed = S.live.filter(needsLive).length;
  const top = `<div class="group">
      <button class="nav-i" data-newchat=""><span class="ic">${IC.pen}</span><span class="lbl">${L('New chat')}</span></button>
      <button class="nav-i" data-go="now" aria-current="${S.view === 'now'}"><span class="ic">${IC.pulse}</span><span class="lbl">${L('Now')}</span>${nNeed ? `<span class="badge">${nNeed}</span>` : ''}</button>
      <button class="nav-i" data-go="home" aria-current="${S.view === 'home'}"><span class="ic">${IC.grid}</span><span class="lbl">${L('Projects')}</span></button>
      <button class="nav-i" data-go="hack" aria-current="${S.view === 'hack'}"><span class="ic">${IC.flag}</span><span class="lbl">Hackathon</span><span class="n">${esc(hackLabel())}</span></button>
    </div>
    <button class="bucket-pick" data-pickbucket="1" aria-haspopup="menu"><span class="lbl">${esc(S.bucket === 'all' ? 'All buckets' : S.bucket === 'unsorted' ? 'Unsorted' : b ? b.name : 'All buckets')}</span><span style="color:var(--muted)">▾</span></button>`;
  const folders = STAGES.map(st => {
    const all = chats.filter(c => stageOf(c) === st.id);
    const act = all.filter(c => !isQuiet(c)), quiet = all.filter(isQuiet);
    const open = all.length && !S.folded[st.id];
    const showQuiet = S.more[st.id];
    const shown = act.slice(0, S.more['all-' + st.id] ? 400 : 12);
    return `<div class="group folder ${act.length ? '' : 'empty'}" data-open="${!!open}">
      <button class="nav-i folder-btn" data-fold="${st.id}" data-drop-stage="${st.id}" aria-expanded="${!!open}"><span class="ic"><span class="label-dot" style="background:${st.c}"></span></span><span class="lbl">${st.name}</span><span class="n">${act.length || ''}</span></button>
      <div class="folder-items">${shown.map(sideChat).join('')}${act.length > shown.length ? `<button class="nav-i chat-i quiet-toggle" data-more-all="${st.id}"><span class="lbl">${act.length - shown.length} more</span></button>` : ''}${quiet.length ? (showQuiet ? `<div class="quiet-chats">${quiet.slice(0, 60).map(sideChat).join('')}</div>` : '') + `<button class="nav-i chat-i quiet-toggle" data-more-st="${st.id}"><span class="lbl">${showQuiet ? 'Hide quiet' : `${quiet.length} quiet`}</span></button>` : ''}</div>
    </div>`;
  }).join('');
  $('sideScroll').innerHTML = top + `<div class="group"><div class="side-h">Stages</div>${folders}</div>`
    + `<div class="group"><button class="nav-i" data-go="recent" aria-current="${S.view === 'recent'}"><span class="ic">${IC.history}</span><span class="lbl">${L('Recents')}</span></button></div>`;
}

function render() {
  applyLook();
  if (!S.loaded) { $('main').innerHTML = '<div class="wrap"><p class="empty-note">Loading your chats…</p></div>'; return; }
  // The sidebar is its own page only on a phone; a wider window always shows a page beside it.
  if (S.view === 'side' && !matchMedia('(max-width: 760px)').matches) { S.view = local.get('view', 'now'); document.body.classList.add('in-main'); }
  renderSide();
  if (S.view === 'side') return;
  const m = $('main');
  const keep = m.scrollTop;
  const typed = [...m.querySelectorAll('input[data-qr]')].map(i => [i.dataset.qr, i.value]).filter(x => x[1]);
  const focus = document.activeElement && m.contains(document.activeElement) && document.activeElement.dataset.qr;
  const cmdTyped = $('cmdInput') ? $('cmdInput').value : '';
  const cmdFocus = document.activeElement && document.activeElement.id === 'cmdInput';
  m.innerHTML = S.view === 'project' ? project() : S.view === 'hack' ? hackView() : S.view === 'home' ? home()
    : S.view === 'recent' ? listView('recent') : S.view === 'search' ? listView('search') : now();
  // A re-render keeps what you were typing and where you were.
  for (const [k, v] of typed) { const i = m.querySelector(`input[data-qr="${CSS.escape(k)}"]`); if (i) i.value = v; }
  if (focus) m.querySelector(`input[data-qr="${CSS.escape(focus)}"]`)?.focus();
  if ($('cmdInput')) { $('cmdInput').value = cmdTyped; if (cmdFocus) $('cmdInput').focus(); }
  m.scrollTop = keep;
}
function go(view, extra = {}) {
  Object.assign(S, { view }, extra);
  S.sel.clear();
  if (view !== 'side' && view !== 'search' && view !== 'project') local.set('view', view);
  document.body.classList.toggle('in-main', view !== 'side');
  render(); $('main').scrollTop = 0;
  if (view === 'now' || view === 'hack') loadPlans(false).then(render).catch(() => {});
}

/* ---------- clicks ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  const el = sel => t.closest(sel);
  let b;
  if ((b = el('[data-go]'))) { if (b.tagName === 'A') return; e.preventDefault(); return go(b.dataset.go); }
  if ((b = el('[data-newchat]'))) return newChat(b.dataset.newchat || null);
  if ((b = el('[data-perm]'))) {
    b.disabled = true;
    return wrap(async () => { await api('/api/chat/permission', { key: b.dataset.key, requestId: b.dataset.req, decision: b.dataset.perm }); toast(b.dataset.perm === 'deny' ? 'Denied.' : 'Allowed.'); await loadState(); render(); })();
  }
  if ((b = el('[data-send]'))) return sendQuick(b.dataset.send);
  if ((b = el('[data-dismiss]'))) { e.stopPropagation(); markSeen(b.dataset.dismiss); return render(); }
  if ((b = el('[data-open]'))) { if (el('input, [data-perm], [data-send]')) return undefined; return b.dataset.open ? openChat(b.dataset.open) : toast('That chat hasn’t started yet.'); }
  if ((b = el('[data-cmd]'))) { if ($('cmdInput')) $('cmdInput').value = b.dataset.cmd; return askCommander(b.dataset.cmd); }
  if ((b = el('[data-floor]'))) return wrap(setLook)({ floor: Number(b.dataset.floor) });
  if ((b = el('[data-refreshplans]'))) { S.plansRefreshing = true; render(); return loadPlans(true).catch(err => toast(err.message)).finally(() => { S.plansRefreshing = false; render(); }); }
  if ((b = el('[data-usereset]'))) return wrap(useReset)(b.dataset.usereset);
  if ((b = el('[data-addreset]'))) return addReset(b.dataset.addreset, b);
  if ((b = el('[data-delreset]'))) return wrap(async () => { await api('/api/lite/reset/remove', { id: b.dataset.delreset }); await loadPlans(false); render(); })();
  if ((b = el('[data-hackdates]'))) return editHackDates();
  if ((b = el('[data-delidea]'))) return wrap(saveIdeas)((S.lite.ideas || []).filter(i => i.id !== b.dataset.delidea));
  if ((b = el('[data-rowmenu]'))) { e.stopPropagation(); return rowMenu(b, b.dataset.rowmenu); }
  if ((b = el('[data-projmenu]'))) return projMenu(b, b.dataset.projmenu);
  if ((b = el('[data-fold]'))) { S.folded[b.dataset.fold] = b.getAttribute('aria-expanded') === 'true'; local.set('folded', S.folded); return renderSide(); }
  if ((b = el('[data-more-st]'))) { S.more[b.dataset.moreSt] = !S.more[b.dataset.moreSt]; return renderSide(); }
  if ((b = el('[data-more-all]'))) { S.more['all-' + b.dataset.moreAll] = true; return renderSide(); }
  if ((b = el('[data-pfold]'))) { S.more['p-done'] = !S.more['p-done']; return render(); }
  if ((b = el('[data-pq]'))) { S.more['pq-' + b.dataset.pq] = !S.more['pq-' + b.dataset.pq]; return render(); }
  if ((b = el('[data-pickbucket]'))) {
    return pop(b, `${[['all', 'All buckets'], ...buckets().map(x => [x.id, x.name]), ['unsorted', 'Unsorted']].map(([id, n]) => `<button data-v="${esc(id)}" role="menuitemradio" aria-checked="${S.bucket === id}">${esc(n)}</button>`).join('')}`, v => { S.bucket = v; local.set('bucket', v); render(); });
  }
  if ((b = el('#lookBtn'))) return lookMenu(b);
  if ((b = el('[data-project]'))) return go('project', { project: b.dataset.project });
  if ((b = el('[data-chat]'))) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) { const id = b.dataset.chat; if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); return render(); }
    return openChat(b.dataset.chat);
  }
  return undefined;
});
document.addEventListener('contextmenu', e => {
  const r = e.target.closest('[data-chat]'), p = e.target.closest('[data-project]');
  if (r) { e.preventDefault(); rowMenu(r, r.dataset.chat, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }); }
  else if (p) { e.preventDefault(); projMenu(p, p.dataset.project, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'cmdForm') { e.preventDefault(); const v = $('cmdInput').value; $('cmdInput').value = ''; return askCommander(v); }
  if (e.target.dataset.addidea) {
    e.preventDefault();
    const text = e.target.idea.value.trim(); if (!text) return undefined;
    return wrap(saveIdeas)([...(S.lite.ideas || []), { text }]);
  }
  return undefined;
});
document.addEventListener('keydown', e => {
  if (e.target.dataset && e.target.dataset.qr && e.key === 'Enter') { e.preventDefault(); return sendQuick(e.target.dataset.qr); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('q').focus(); }
  if (e.key === 'Escape') { if ($('popRoot').innerHTML) return closePop(); if (S.sel.size) { S.sel.clear(); return render(); } }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (!typing && /^[1-7]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const hover = document.querySelector('[data-chat]:hover');
    const ids = S.sel.size ? [...S.sel] : hover ? [hover.dataset.chat] : [];
    if (ids.length) { e.preventDefault(); return wrap(setChats)(ids, { stage: STAGES[Number(e.key) - 1].id }); }
  }
  if (!typing && e.key === 'Enter' && e.target.dataset && e.target.dataset.chat) return openChat(e.target.dataset.chat);
  return undefined;
});
$('q').addEventListener('input', e => { S.q = e.target.value.trim(); if (S.q) go('search'); else if (S.view === 'search') go('now'); });

async function sendQuick(key) {
  const input = document.querySelector(`input[data-qr="${CSS.escape(key)}"]`);
  const text = input && input.value.trim();
  if (!text) return;
  input.disabled = true;
  try { await api('/api/chat/send', { key, text }); markSeen(input.dataset.id); toast('Sent.'); await loadState(); }
  catch (err) { toast(err.message); input.disabled = false; return; }
  render();
}

function lookMenu(anchor) {
  const look = S.lite.look;
  pop(anchor, `<div class="ph">Skin</div>${[['plain', 'Plain'], ['imperial', 'Imperial'], ['rebel', 'Rebel']].map(([v, n]) => `<button data-v="skin:${v}" role="menuitemradio" aria-checked="${look.skin === v}">${n}</button>`).join('')}
    <hr><div class="ph">Light or dark</div>${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<button data-v="mode:${v}" role="menuitemradio" aria-checked="${look.mode === v}">${n}</button>`).join('')}
    <hr><div class="ph">Go quiet after</div>${[2, 4, 7].map(d => `<button data-v="quiet:${d}" role="menuitemradio" aria-checked="${quietDays() === d}">${d} days</button>`).join('')}`,
  v => { const [k, x] = v.split(':'); wrap(setLook)(k === 'skin' ? { skin: x } : k === 'mode' ? { mode: x } : { quietDays: Number(x) }); });
}

/* ---------- dragging a chat onto a stage (sidebar folder, project section, board column) ---------- */
let dragIds = null;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-chat]');
  if (!c) return;
  dragIds = S.sel.has(c.dataset.chat) && S.sel.size > 1 ? [...S.sel] : [c.dataset.chat];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragIds.join(','));
});
document.addEventListener('dragover', e => {
  const z = dragIds && e.target.closest && e.target.closest('[data-drop-stage]');
  if (!z) return;
  e.preventDefault();
  document.querySelectorAll('.drop-hot').forEach(x => x !== z && x.classList.remove('drop-hot'));
  z.classList.add('drop-hot');
});
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('[data-drop-stage]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('drop-hot'); });
document.addEventListener('drop', e => {
  const z = dragIds && e.target.closest && e.target.closest('[data-drop-stage]');
  document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot'));
  if (!z) return;
  e.preventDefault();
  const ids = dragIds; dragIds = null;
  wrap(setChats)(ids, { stage: z.dataset.dropStage });
});
addEventListener('resize', () => { if (S.view === 'side' && !matchMedia('(max-width: 760px)').matches) render(); });
document.addEventListener('dragend', () => { dragIds = null; document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot')); });

/* ---------- start ---------- */
(async () => {
  applyLook();
  if (!VIEWS.includes(S.view) || S.view === 'project' || S.view === 'search') S.view = 'now';
  const small = matchMedia('(max-width: 760px)').matches;
  // On a phone the sidebar is the home screen; everything else slides over it.
  if (small && !new URLSearchParams(location.search).get('view')) S.view = 'side';
  const v = new URLSearchParams(location.search).get('view');
  if (v && VIEWS.includes(v)) S.view = v;
  document.body.classList.toggle('in-main', S.view !== 'side');
  render();
  connect();
  try { await loadState(); } catch (err) { $('main').innerHTML = `<div class="wrap"><p class="empty-note">${esc(err.message)}</p></div>`; return; }
  render();
  loadPlans(false).then(render).catch(err => toast(err.message));
  // The Commander's answer from earlier is still there if it's running.
  api('/api/commander').then(c => { if (c.live && c.live.key) { S.cmd.sessionId = c.live.sessionId; cmdListen(c.live.key); } }).catch(() => {});
})();
