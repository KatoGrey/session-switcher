'use strict';
/* Motion (banners carrying over, projects rising in, dials drawing) and the clocks. */

/* ---------- motion ---------- */
const motionOk = () => Local.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
// Runs a view change as a view transition when the browser can, so banners carry over between pages.
function transition(fn) {
  if (!document.startViewTransition || !motionOk() || document.hidden) { fn(); return null; }
  const t = document.startViewTransition(fn);
  t.updateCallbackDone.catch(err => toast(err.message || String(err)));
  t.ready.catch(() => {});   // going somewhere else before this one's started: nothing's wrong
  t.finished.catch(() => {}).finally(() => { for (const el of document.querySelectorAll('.w-art[style*="view-transition-name"]')) el.style.viewTransitionName = ''; });
  return t;
}
function openWorld(cwd, el) {
  const art = el && (el.classList.contains('w-art') ? el : el.querySelector('.w-art'));
  S.worldTab = 'chats';
  if (art && motionOk()) art.style.viewTransitionName = 'world-banner';
  go('folder', cwd);
}

// The parts of the hub that change while chats run. Patched in place.
function renderLive(force) {
  renderBar(); updateTitle();
  if (window.ChatUI && ChatUI.renderRail) ChatUI.renderRail();
  if (typeof renderClash === 'function') renderClash();
  if (typeof renderKeep === 'function') renderKeep();
  if (typeof renderPicturesBack === 'function') renderPicturesBack();
  if (S.view === 'folder' && typeof renderProjectNow === 'function') renderProjectNow();
  if (S.view !== 'hub' || !$('awaitList')) return;
  const A = awaiting(), W = atWork(), Q = quietOpen();
  // The clock ticks on its own, so a new minute alone doesn't redraw the hero (and restart its scene).
  const heroNow = heroHtml(), heroKey = heroNow.replace(/<span data-clock>[^<]*<\/span>/, '');
  // Only when it changed: redrawing restarts the scene's animations (a forced refresh needn't).
  if ($('heroSlot')._h !== heroKey) { $('heroSlot').innerHTML = heroNow; $('heroSlot')._h = heroKey; }
  renderWelcome(); renderWhatsNew(); renderSelfCheckCard(); renderDeskUpdateCard();
  loadToday(); renderToday();
  const saga = sagaLook();
  // A chat moving between the boards (it finished, or wants you) glides across; new ones fade in.
  flip([$('awaitList'), $('board'), $('quietList')], () => {
    patch($('awaitList'), A, keyOf, awaitCard, saga ? emptyArt('await', 'Nothing is waiting on you. When Claude asks for your OK or finishes a reply, it shows up here first.') : '');
    patch($('board'), W, keyOf, workCard, saga ? emptyArt('work', A.length ? 'Nothing else is working right now.' : 'Nothing is working right now. Open a chat and it appears here while it works.') : '');
    patch($('quietList'), Q, keyOf, quietChip, '');
  if ($('secGroups')) { $('secGroups').hidden = !S.org.groups.length; patch($('gcards'), S.org.groups, g => g.id, groupCard, ''); }
  });
  $('quietList').classList.toggle('has', Q.length > 0);
  const dials = S.accounts.map(a => ({ a }));
  if (S.codex && S.codex.enabled) for (const cx of codexAccts()) dials.push({ cx });
  if (saga) patch($('dials'), [...dials, { add: true }], x => (x.add ? 'add' : x.cx ? `cx:${x.cx.id}` : x.a.id), x => (x.add ? '<button class="add-card" data-act="add"><span class="glyph" aria-hidden="true">✦</span>Add another Claude account</button>' : x.cx ? codexCard(x.cx) : dialCard(x.a)));
  else {
    // Nothing waiting, nothing working: those sections step aside (the hero says so).
    $('secAwait').hidden = !A.length;
    $('secWork').hidden = !W.length && !Q.length;
    const title = $('secWork').querySelector('.sec-fold > span:not(.sf-c):not(.sec-n)');
    if (title) title.textContent = W.length ? voice('At work') : 'Open chats';
    setSecCount('await', A.length); setSecCount('work', W.length + Q.length); setSecCount('recent', 0); setSecCount('projects', S.projects.filter(p => p.cwd !== cmdrSet().cwd).length); setSecCount('groups', S.org.groups.length); setSecCount('queue', (S.tasks || []).length); setSecCount('races', (S.races || []).length);
    patch($('dials'), [...dials, ...(S.gemini && S.gemini.enabled ? [{ gm: true }] : [])], x => (x.gm ? 'gemini' : x.cx ? `cx:${x.cx.id}` : x.a.id), x => (x.gm ? geminiAcct() : x.cx ? codexAcctCard(x.cx) : claudeAcct(x.a)));
    renderJump();
  }
  tick();
}

function renderRecent() {
  const every = allSessions().sort((x, y) => y[0].updated - x[0].updated);
  const n = { claude: 0, codex: 0, gemini: 0, openclaw: 0 }; for (const [x] of every) n[provOf(x)]++;
  const kinds = Object.keys(n).filter(k => n[k]);
  const f = kinds.length > 1 && kinds.includes(S.recentProv) ? S.recentProv : 'all';
  const all = f === 'all' ? every : every.filter(([x]) => provOf(x) === f);
  const tab = (v, label, n) => `<button class="${f === v ? 'on' : ''}" data-recent="${v}" aria-pressed="${f === v}">${label} <span class="count">${n}</span></button>`;
  $('page').innerHTML = `<div id="guardSlot">${guardHtml()}</div>
    <header class="f-head"><div><p class="eyebrow">✧ Every folder</p><h1>Recent chats</h1><p class="f-meta">Your latest chats${f === 'codex' ? ' in Codex' : f === 'claude' ? ` in Claude Code, ready to open as ${esc(current().name)}` : f === 'openclaw' ? ' from OpenClaw agents, to read here' : ''}.</p></div>
      ${kinds.length > 1 ? `<div class="seg provseg" role="group" aria-label="Show">${tab('all', 'All', every.length)}${kinds.map(k => tab(k, PROV_TITLE[k], n[k])).join('')}</div>` : ''}</header>
    ${all.length ? `<ul class="rows sec-gap">${all.slice(0, 60).map(([x, p]) => rowHtml(x, p.name)).join('')}</ul>` : emptyArt('chats', 'Nothing here yet.')}`;
}
// A project: its banner, then its chats, documents and pictures.
// The project briefing: this week at a glance (chats, files changed, reviews, what's queued and what
// was put off for later), with one click to have Claude sum it up.
const Brief = {};
function briefHtml(p) {
  const week = Date.now() - 7 * 864e5, b = Brief[p.cwd];
  if (p.exists && (!b || Date.now() - b.at > 60e3)) {
    Brief[p.cwd] = { at: Date.now(), r: b && b.r };
    api(`/api/away?since=${week}&cwd=${encodeURIComponent(p.cwd)}`).then(r => { Brief[p.cwd].r = r; if (S.view === 'folder' && S.folder === p.cwd) renderFolder(); }).catch(() => {});
  }
  const r = (Brief[p.cwd] && Brief[p.cwd].r) || { files: 0, reviews: [] };
  const chatsN = p.sessions.filter(x => x.updated >= week).length;
  const mine = (S.tasks || []).filter(t => t.cwd === p.cwd && t.state === 'queued');
  const later = mine.filter(t => t.from).length, queued = mine.length - later;
  const bits = [chatsN && plural(chatsN, 'chat'), r.files && `${plural(r.files, 'file')} changed`, r.reviews.length && plural(r.reviews.length, 'review'), queued && `${queued} queued`, later && `${later} for later`].filter(Boolean);
  if (!bits.length) return '';
  const ask = p.exists && canLaunch(current()) ? `<button class="linkish" data-brief="${esc(p.cwd)}">Ask Claude for a summary</button>` : '';
  return `<p class="wp-brief"><span class="eyebrow">This week</span> ${esc(bits.join(' · '))} ${ask}</p>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-brief]'); if (!b) return;
  ChatUI.open({ cwd: b.dataset.brief, mode: 'new', initialText: 'Sum up what happened in this project over the last week: look at the recent git history and changed files, and tell me in a few short paragraphs what was done, what is half-finished, and what you would do next.' });
});
function renderFolder() {
  const a = current(), p = S.projects.find(x => x.cwd === S.folder);
  if (!p) { S.view = 'hub'; return renderPage(); }
  const w = S.worlds[p.cwd];
  if (p.exists && worldStale(p.cwd)) loadWorld(p.cwd).then(() => { if (S.view === 'folder' && S.folder === p.cwd) renderFolder(); }).catch(() => {});
  const pinned = S.pins.has(p.cwd), saga = sagaLook();
  const prov = S.prov;
  const list = prov ? p.sessions.filter(x => provOf(x) === prov) : p.sessions;
  // Looking at one kind of chat: a link to the others here (Claude Code's first).
  const otherProv = prov ? ['claude', 'codex', 'gemini', 'openclaw'].find(v => v !== prov && p.sessions.some(x => provOf(x) === v)) : null;
  const other = otherProv ? p.sessions.filter(x => provOf(x) === otherProv).length : 0;
  const otherName = otherProv ? PROV_TITLE[otherProv] : '', otherWord = otherProv === 'openclaw' ? 'session' : 'chat';
  const today = midnight();
  const bits = [plural(p.sessions.filter(x => x.updated >= today).length, 'chat'), w && w.today.docs ? plural(w.today.docs, 'document') : '', w && w.today.images ? plural(w.today.images, 'image') : ''];
  const todayLine = bits.slice(1).some(Boolean) || p.sessions.some(x => x.updated >= today) ? ` Today: ${bits.filter(Boolean).join(', ')}.` : '';
  const meta = [plural(list.length, prov === 'codex' ? 'Codex chat' : prov === 'claude' ? 'Claude Code chat' : prov === 'openclaw' ? 'OpenClaw session' : 'chat'), p.notes && prov !== 'codex' ? plural(p.notes, 'saved note') : null, `last used ${agoL(list.length ? list[0].updated : p.updated)}`].filter(Boolean).join(', ');
  const hasArt = !!(w && w.banner);
  const art = coverPrompt();
  const hint = p.exists && w && !hasArt
    ? (w.images.length ? '<button class="wp-hint" data-wtab="gallery">Choose a banner from the gallery</button>'
      : art && codexReady() ? `<button class="wp-hint" data-prompt="${esc(art.id)}">Make a cover image with Codex</button>` : '')
    : '';
  const heroH = `<div class="wp-art" style="view-transition-name:world-banner">${worldArt(p, w, '', false)}</div><span class="wp-shade" aria-hidden="true"></span>
    <div class="wp-in"><p class="eyebrow ${prov || ''}">${prov === 'codex' ? 'Codex chats in this project' : prov === 'gemini' ? 'Gemini chats in this project' : prov === 'claude' ? 'Claude Code chats in this project' : prov === 'openclaw' ? 'OpenClaw sessions in this project' : 'Project'}</p><h1>${esc(p.name)}</h1></div>${hint}`;
  const subH = `${briefHtml(p)}<div class="wp-where"><p class="f-path">${esc(p.cwd)}${p.exists ? '' : ' (this folder no longer exists)'}</p>
      <p class="f-meta">${esc(meta[0].toUpperCase() + meta.slice(1))}.${esc(todayLine)}${other ? ` <button class="linkish" data-view="folder" data-cwd="${esc(p.cwd)}" data-prov="${otherProv}">${other === 1 ? `1 ${otherName} ${otherWord}` : `${other} ${otherName} ${otherWord}s`} here too</button>` : ''}</p></div>
    <div class="wp-tools">${saga ? `<button class="btn quiet sm" data-project-crest="${esc(p.cwd)}" ${p.exists ? '' : 'disabled'}>Project crest…</button>` : ''}<button class="btn quiet sm" data-act="browse" ${p.exists ? '' : 'disabled'}>Browse files</button><button class="btn quiet sm" data-act="reveal" ${p.exists ? '' : 'disabled'}>Open folder</button>${saga ? `<button class="btn quiet sm" data-act="pin">${pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}</button>` : ''}</div>`;
  const off = !canLaunch(a) || !p.exists;
  const cxOff = !codexReady() || !p.exists;
  const cxWhy = S.codex && S.codex.installed === false ? 'Install Codex first (Setup)' : 'Sign in to Codex first';
  const claudeBtn = `<button class="btn ${prov === 'codex' ? '' : 'prime'}" data-act="${inApp() ? 'newchat' : 'new'}" aria-label="New Claude chat" ${off ? `disabled title="${esc(a.lockMessage || `Sign in to ${a.name} first`)}"` : `title="New Claude chat, as ${esc(a.name)}"`}>${saga ? 'New Claude chat' : 'Claude'}</button>`;
  const codexBtn = S.codex && S.codex.enabled ? `<button class="btn ${prov === 'codex' ? 'prime' : 'codexbtn'}" data-act="${inApp() ? 'newcodex' : 'newcodex-term'}" aria-label="New Codex chat" ${cxOff ? `disabled title="${cxWhy}"` : 'title="New Codex chat"'}>${saga ? 'New Codex chat' : 'Codex'}</button>` : '';
  const gemOff = !geminiReady() || !p.exists;
  const geminiBtn = S.gemini && S.gemini.enabled ? `<button class="btn ${prov === 'gemini' ? 'prime' : 'geminibtn'}" data-act="newgemini" aria-label="New Gemini chat" ${gemOff ? `disabled title="${S.gemini.installed === false ? 'Install the Antigravity CLI first (Setup → Gemini)' : 'Sign in to Gemini first (Setup → Gemini)'}"` : 'title="New Gemini chat"'}>${saga ? 'New Gemini chat' : 'Gemini'}</button>` : '';
  const tab = (id, label, n) => `<button role="tab" class="wt" id="wt-${id}" data-wtab="${id}" aria-controls="wpBody" aria-selected="${S.worldTab === id}" tabindex="${S.worldTab === id ? 0 : -1}">${label}<span class="count">${n}</span></button>`;
  const barH = `<div class="wtabs" role="tablist" aria-label="${esc(p.name)}">${tab('chats', 'Chats', list.length)}${tab('docs', 'Documents', w ? `${w.docs.length}${w.docs.length >= 200 ? '+' : ''}` : '·')}${sagaLook() || !p.notes ? '' : tab('memory', 'Memory', p.notes)}${sagaLook() ? '' : tab('changes', 'Changes', typeof Changes !== 'undefined' && Changes[p.cwd] && Changes[p.cwd].list ? Changes[p.cwd].list.filter(c => c.at >= Date.now() - 7 * 864e5).length : '·')}${tab('gallery', 'Gallery', !sagaLook() && typeof Board !== 'undefined' && Board.cwd === p.cwd && Board.dirs.length ? Board.dirs.reduce((n, d) => n + d.n, 0) : w ? `${w.images.length}${w.images.length >= 300 ? '+' : ''}` : '·')}</div>
    <div class="wp-act"><button class="btn quiet" data-act="world-prompt" aria-haspopup="menu" aria-expanded="false" ${p.exists ? '' : 'disabled'}><span class="glyph" aria-hidden="true">❡</span>Start with a prompt</button>${saga ? '' : '<span class="wp-newl" aria-hidden="true">New chat</span>'}${prov === 'codex' ? codexBtn + claudeBtn + geminiBtn : prov === 'gemini' ? geminiBtn + claudeBtn + codexBtn : claudeBtn + codexBtn + geminiBtn}<button class="icon" data-act="world-more" aria-haspopup="menu" aria-expanded="false" aria-label="More for this world">${ICON.more}</button></div>`;
  const page = $('page');
  if (page.dataset.worldPage !== p.cwd || !$('wpHero')) {
    page.dataset.worldPage = p.cwd;
    page.innerHTML = `<div id="guardSlot">${prov === 'codex' ? '' : guardHtml()}</div>
      <header class="wp-hero ${hasArt ? 'has-art' : ''}" id="wpHero"></header>
      <div class="wp-sub" id="wpSub"></div>
      <div class="wp-now" id="wpNow"></div>
      <div class="wp-bar" id="wpBar"></div>
      <section class="wp-body" id="wpBody" role="tabpanel"></section>`;
  } else if ($('guardSlot')) { const g = prov === 'codex' ? '' : guardHtml(); if ($('guardSlot')._h !== g) { $('guardSlot').innerHTML = g; $('guardSlot')._h = g; } }
  const put = (id, h) => { const el = $(id); if (el._h !== h) { el.innerHTML = h; el._h = h; } };
  put('wpHero', heroH); $('wpHero').classList.toggle('has-art', hasArt);
  put('wpSub', subH); put('wpBar', barH);
  if (typeof renderProjectNow === 'function') renderProjectNow();
  renderWorldBody();
}
function renderWorldBody() {
  const box = $('wpBody'); if (!box) return;
  const p = S.projects.find(x => x.cwd === S.folder); if (!p) return;
  const w = S.worlds[p.cwd];
  for (const b of document.querySelectorAll('.wtabs [data-wtab]')) { const on = b.dataset.wtab === S.worldTab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  box.setAttribute('aria-labelledby', `wt-${S.worldTab}`);
  const fresh = box.dataset.tab !== S.worldTab;
  box.dataset.tab = S.worldTab;
  const set = h => { if (fresh || box._h !== h) { box.innerHTML = h; box._h = h; } };
  if (S.worldTab === 'chats') {
    const prov = S.prov;
    const n = { claude: 0, codex: 0, gemini: 0, openclaw: 0 }; for (const x of p.sessions) n[provOf(x)]++;
    const kinds = Object.keys(n).filter(k => n[k]);
    const byProv = prov ? p.sessions.filter(x => provOf(x) === prov) : p.sessions;
    // A long list gets a box to narrow it (not in Imperial and Rebel, whose page stays as it is).
    const canFilter = !sagaLook() && p.sessions.length > 8;
    const q = canFilter ? (S.chatFilter || '').trim().toLowerCase() : '';
    const list = q ? byProv.filter(x => `${x.title || ''} ${x.firstPrompt || ''} ${x.lastPrompt || ''}`.toLowerCase().includes(q)) : byProv;
    const seg = kinds.length > 1 ? `<div class="seg provseg" role="group" aria-label="Show">${[['all', 'All', p.sessions.length], ...kinds.map(k => [k, PROV_TITLE[k], n[k]])].map(([v, l, n]) => `<button class="${(prov || 'all') === v ? 'on' : ''}" data-wprov="${v}" aria-pressed="${(prov || 'all') === v}">${l} <span class="count">${n}</span></button>`).join('')}</div>` : '';
    if (fresh || !$('wbList')) { box.innerHTML = `<div class="wb-top" id="wbTop"><span id="wbSeg"></span>${canFilter ? `<label class="wb-filter"><span class="sr">Filter chats</span><input type="search" id="chatFilter" placeholder="Filter chats" autocomplete="off" spellcheck="false" value="${esc(S.chatFilter || '')}"></label>` : ''}</div><div id="wbList"></div>`; box._h = null; }
    if ($('wbSeg')._h !== seg) { $('wbSeg').innerHTML = seg; $('wbSeg')._h = seg; }
    $('wbTop').hidden = !seg && !canFilter;
    const lb = $('wbList');
    const done = q ? [] : (p.done || []).filter(x => !prov || provOf(x) === prov);
    if (q && !list.length) { lb.innerHTML = '<p class="empty-line">No chat here has that in its name or its messages’ first lines.</p>'; return; }
    if (!list.length && !done.length) { lb.innerHTML = emptyArt('chats', `No ${prov === 'codex' ? 'Codex chats' : prov === 'claude' ? 'Claude Code chats' : 'chats'} in this project yet. Start one above, or start with a prompt.`); return; }
    if (!lb.querySelector(':scope > ul.rows')) lb.innerHTML = '<ul class="rows"></ul><details class="done-chats"><summary></summary><ul class="rows"></ul></details>';
    const dz = lb.querySelector('.done-chats');
    dz.hidden = !done.length;
    dz.querySelector('summary').textContent = `Done · ${done.length}`;
    patch(dz.querySelector('ul.rows'), done, s => s.id, s => rowHtml(s, null));
    return patch(lb.firstElementChild, list, s => s.id, s => rowHtml(s, null));
  }
  if (S.worldTab === 'changes') return typeof renderProjectChanges === 'function' ? renderProjectChanges() : undefined;
  if (S.worldTab === 'memory') return typeof renderProjectMemory === 'function' ? renderProjectMemory() : undefined;
  if (!w) return set(`<p class="loading">${p.exists ? 'Reading this project’s files…' : 'This folder no longer exists.'}</p>`);
  if (S.worldTab === 'docs') {
    if (!w.docs.length) return set('<p class="empty-line">No markdown documents here yet. Notes, reviews and anything else chats write as markdown show up here, newest first.</p>');
    const t0 = midnight(), week = t0 - 6 * 864e5;
    const groups = [['Today', w.docs.filter(d => d.mtime >= t0)], ['This week', w.docs.filter(d => d.mtime < t0 && d.mtime >= week)], ['Earlier', w.docs.filter(d => d.mtime < week)]].filter(g => g[1].length);
    const row = d => { const dir = d.rel.slice(0, Math.max(0, d.rel.length - d.name.length)).replace(/[\\/]$/, ''); return `<li><button class="doc" data-doc="${esc(d.path)}" data-q="${esc(d.rel.toLowerCase())}"><span class="glyph" aria-hidden="true">❧</span><span class="doc-n">${esc(d.name.replace(/\.(md|markdown|mdx)$/i, ''))}</span><span class="doc-d">${esc(dir || '')}</span>${typeof DocNotes !== 'undefined' && DocNotes.count(d.path) ? `<span class="tag">${plural(DocNotes.count(d.path), 'note')}</span>` : ''}<span class="doc-w" data-ago="${d.mtime}">${esc(agoL(d.mtime))}</span></button></li>`; };
    set(`<div class="wb-top"><label class="wb-filter"><span class="sr">Filter documents</span><input type="search" id="docFilter" placeholder="Filter documents" autocomplete="off" spellcheck="false" value="${esc(S.docFilter || '')}"></label><span class="wb-note">${w.docs.length >= 200 ? 'The 200 newest documents' : plural(w.docs.length, 'document')}, newest first</span><button class="btn quiet sm" id="docDeep" data-doc-deep hidden></button></div><div id="docHits" hidden></div><div id="docLists">
      ${groups.map(([g, list]) => `<div class="docgroup"><p class="dg-h">${g}<span class="count">${list.length}</span></p><ul class="docs">${list.map(row).join('')}</ul></div>`).join('')}</div>`);
    return filterDocs();
  }
  if ((!sagaLook() || S.boardOn) && typeof renderBoard === 'function') return renderBoard(box, p, w, fresh);
  if (!w.images.length) return set(`<p class="empty-line">No pictures here yet. Cover art, screenshots and anything Codex makes in this folder show up here.${codexReady() && coverPrompt() ? ` <button class="linkish" data-prompt="${esc(coverPrompt().id)}">Make a cover image with Codex</button>` : ''}</p>`);
  set(`<div class="wb-top"><span class="wb-note">${w.images.length >= 300 ? 'The 300 newest pictures' : plural(w.images.length, 'picture')}, newest first. Pick one as this project’s banner.</span>${w.bannerPicked ? '<button class="btn quiet sm" data-banner="-">Use the automatic banner</button>' : ''}<button class="btn quiet sm" data-bd-on>Review by folder</button></div>
    <ul class="gallery">${w.images.map((im, i) => `<li class="gi ${im.path === w.banner ? 'is-banner' : ''}" style="--i:${Math.min(i, 24)}"><button class="gi-img" data-img="${esc(im.path)}" aria-label="Open ${esc(im.name)}"><img src="${esc(imageSrc(im.path, p.cwd))}" alt="" loading="lazy" decoding="async"></button>
      <div class="gi-cap"><span class="gi-n" title="${esc(im.rel)}">${esc(im.name)}</span><span class="gi-w" data-ago="${im.mtime}">${esc(agoL(im.mtime))}</span></div>
      ${im.path === w.banner ? '<span class="gi-flag">Banner</span>' : `<button class="gi-use btn sm" data-banner="${esc(im.path)}">Use as banner</button>`}</li>`).join('')}</ul>`);
}
function filterDocs() {
  const q = (S.docFilter || '').trim().toLowerCase();
  // Past the names: what's in them, when you ask (ui/project-now.js).
  if (typeof docDeepOffer === 'function') docDeepOffer(q);
  for (const g of document.querySelectorAll('#wpBody .docgroup')) {
    let n = 0;
    for (const b of g.querySelectorAll('.doc')) { const hit = !q || b.dataset.q.includes(q); b.parentElement.hidden = !hit; n += hit; }
    g.hidden = !n;
  }
}
function worldMenu(anchor) {
  const a = current(), p = S.projects.find(x => x.cwd === S.folder); if (!p) return;
  showMenu(anchor, [
    { label: inApp() ? 'New Claude chat in a terminal' : 'New Claude chat in the window', hint: `as ${a.name}`, disabled: !canLaunch(a) || !p.exists, run: () => (inApp() ? wrap(async () => reportLaunch(await api('/api/new', { account: a.id, cwd: p.cwd }), `Starting a new chat as ${a.name}`))() : ChatUI.open({ cwd: p.cwd, mode: 'new' })) },
    ...(S.codex && S.codex.enabled ? [{ label: inApp() ? 'New Codex chat in a terminal' : 'New Codex chat in the window', disabled: !codexReady() || !p.exists, run: () => (inApp() ? wrap(async () => reportLaunch(await api('/api/new', { provider: 'codex', cwd: p.cwd }), 'Starting a new Codex chat'))() : ChatUI.open({ cwd: p.cwd, mode: 'new', provider: 'codex' })) }] : []),
    '-',
    { label: 'Look for new files', hint: 'documents and pictures', disabled: !p.exists, run: async () => { await loadWorld(p.cwd, true); renderFolder(); toast('Up to date.', 1500); } },
    { label: 'Review pictures', hint: 'keep or redo, folder by folder', disabled: !p.exists, run: () => openBoard(p.cwd) },
    // Imperial and Rebel keep their row of tabs as it was: these are here instead.
    ...(sagaLook() ? [{ label: 'What changed here', hint: 'each reply, in every chat', run: () => { S.worldTab = 'changes'; renderWorldBody(); } },
      ...(p.notes ? [{ label: 'What Claude remembers', hint: plural(p.notes, 'note'), run: () => { S.worldTab = 'memory'; renderWorldBody(); } }] : [])] : []),
    { label: 'Edit prompts…', run: openPromptEditor },
    '-',
    ...projectItems(p.cwd).filter(it => it !== '-' && /^(Rules and tools|Queue a task|Race Claude|Split the work|Project crest)/.test(it.label)),
    ...(sagaLook() ? [] : [{ label: S.pins.has(p.cwd) ? 'Unpin from the sidebar' : 'Pin to the sidebar', run: () => { S.pins.has(p.cwd) ? S.pins.delete(p.cwd) : S.pins.add(p.cwd); savePins(); renderNav(); renderPage(); } }]),
    ...(p.added && !hasChats(p) ? ['-', { label: 'Remove from the list', hint: 'the folder itself stays', danger: true, run: async () => { await api('/api/project/forget', { cwd: p.cwd }); await loadSessions(); go('hub'); toast(`Removed ${p.name} from the list. Its folder is still there.`, 4000); } }] : []),
  ]);
}
function renderSearch() {
  const h = S.hits;
  // (Only what's in your lists: a race's copies aren't, and the count says what you can see.)
  const found = h ? h.hits.filter(x => sessionById(x.id)[0]) : [];
  const rows = found.map(x => { const [s, p] = sessionById(x.id); return rowHtml(s, p.name, x); }).join('');
  const pr = h && h.progress;
  $('page').innerHTML = `<header class="f-head"><div><p class="eyebrow">❝ Search</p><h1>“${esc(S.q)}”</h1><p class="f-meta">${h ? (found.length === 1 ? 'One chat mentions it.' : `${nword(found.length)} chats mention it.`) : 'Searching…'}</p></div>
      <div class="f-act"><button class="btn" data-act="search-again">Search again</button><button class="btn quiet" data-view="hub">Back to the hub</button></div></header>
    ${pr && !pr.ready ? `<p class="progress">Still reading chats (${pr.done} of ${pr.total}); results may grow.</p>` : ''}
    ${rows ? `<ul class="rows sec-gap">${rows}</ul>` : h ? emptyArt('search', 'Nothing matches. Search reads the text of every chat, Claude’s, Codex’s and Gemini’s, plus their names and folders. In a very long chat, that’s its beginning and its latest messages.') : ''}`;
}
function renderPage() {
  if (S.view === 'hub') renderHub();
  else if (S.view === 'recent') renderRecent();
  else if (S.view === 'folder') renderFolder();
  else if (S.view === 'search') renderSearch();
  else if (S.view === 'routines') Routines.render();
  else if (S.view === 'work') Work.render();
  else if (S.view === 'aide') renderAidePage();
}
function renderAll() { renderNav(); renderPage(); renderBar(); updateTitle(); }
// Names the chat window uses.
const renderSide = () => renderNav();
const renderMain = () => renderPage();
// Where you've been, so Back (a swipe from the left edge, or the phone's Back) returns to the page you
// came from rather than straight to the hub.
const Trail = [];
const placeKey = x => `${x.view}|${x.folder || ''}|${x.prov || ''}`;
function go(view, folder, prov) {
  const here = { view: S.view, folder: S.folder, prov: S.prov }, there = { view, folder: folder !== undefined ? folder : S.folder, prov: view === 'folder' ? prov || null : S.prov };
  if (!go.back && placeKey(here) !== placeKey(there)) { Trail.push(here); if (Trail.length > 40) Trail.shift(); if (typeof noteStep === 'function') noteStep(); }
  const from = S.view === 'folder' && !(window.ChatUI && ChatUI.isOpen()) ? S.folder : null;
  if (view === 'folder' && folder !== undefined && folder !== S.folder) S.worldTab = 'chats';
  // The state changes now; the page redraws inside the transition.
  S.view = view; if (folder !== undefined) S.folder = folder;
  if (view === 'folder') S.prov = ['claude', 'codex', 'gemini', 'openclaw'].includes(prov) ? prov : null;
  const run = () => {
    setNavOpen(false);
    if (window.ChatUI && ChatUI.isOpen()) ChatUI.close(true);
    renderNav(); renderPage(); renderBar(); window.scrollTo({ top: 0 });
    $('page').focus({ preventScroll: true });
    // Said to a screen reader, as a new page would be.
    announce(view === 'hub' ? voice('The hub') : view === 'recent' ? voice('Recent chats') : view === 'routines' ? voice('Routines') : view === 'work' ? voice('Your work') : view === 'folder' ? (S.projects.find(p => p.cwd === S.folder) || {}).name || '' : '');
    // Coming back from a project: its banner settles back into its card.
    if (view === 'hub' && from && motionOk()) {
      const art = document.querySelector(`#atlas > [data-k="${CSS.escape(from)}"] .w-art`);
      const r = art && art.getBoundingClientRect();
      if (r && r.top < innerHeight && r.bottom > 0) art.style.viewTransitionName = 'world-banner';
    }
  };
  const t = transition(run);
  return t ? t.updateCallbackDone.catch(() => {}) : Promise.resolve();
}
// Back to the page before this one (skipping any that are gone). False if there's nowhere to go back to.
function goBackPage() {
  const now = placeKey({ view: S.view, folder: S.folder, prov: S.prov });
  while (Trail.length) {
    const prev = Trail.pop();
    if (placeKey(prev) === now || (prev.view === 'folder' && !S.projects.some(p => p.cwd === prev.folder))) continue;
    go.back = true;
    try { go(prev.view, prev.folder, prev.prov); } finally { go.back = false; }
    return true;
  }
  return false;
}
// Go to the hub, then bring one of its sections into view.
const hubTo = id => (S.view !== 'hub' || (window.ChatUI && ChatUI.isOpen()) ? go('hub') : Promise.resolve()).then(() => setTimeout(() => { const el = $(id); if (!el) return; if (el.classList.contains('folded')) toggleSec(el.dataset.sec, true); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30));

/* ---------- clocks ---------- */
function tick() {
  if (document.hidden) return;
  const now = Date.now();
  const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  for (const el of document.querySelectorAll('[data-since]')) { const t = +el.dataset.since; set(el, t ? dur(now - t, true) : ''); }
  for (const el of document.querySelectorAll('[data-ago]')) { const t = +el.dataset.ago; if (t) set(el, agoL(t)); }
  for (const el of document.querySelectorAll('[data-until]')) { const t = +el.dataset.until; set(el, t > now ? `in ${dur(t - now)}` : 'any moment'); }
  for (const el of document.querySelectorAll('[data-clock]')) set(el, clock(now));
}
setInterval(tick, 1000);

/* ---------- rest ---------- */
// The world rests when you do: after a while with no one using the window (unfocused for 90 seconds,
// or untouched for 2 minutes), every looping animation pauses and the scene dims a little; the first
// touch, key or look back wakes it. Nothing redraws while you're away, however fast the screen.
//
// "Keep chats live in the background" (Setup, on unless turned off, kept on this device): a window that's
// open but not focused, on a second monitor say, keeps moving: replies, steps, spinners and the working
// dots, as if you were in it. It rests only when it can't be seen (minimized), or when it's been untouched
// for a while and nothing is working. Off: the power-saving pause below, as before.
const stayLive = () => store('stayLive') !== 'off';
const somethingWorking = () => (S.activity || []).some(x => x && x.phase && x.phase !== 'idle' && x.phase !== 'ended');
const REST_AWAY_MS = 90 * 1000, REST_IDLE_MS = 2 * 60 * 1000, STILL_AWAY_MS = 15 * 1000;
let restSeen = Date.now(), awaySince = document.hasFocus() ? 0 : Date.now();
// Still: working in another app with this one beside it, the looping decoration (petals, the seal,
// the pulsing dots) holds still after a few seconds, without dimming: the dots keep their colors, and
// the window stops redrawing itself many times a second. Back in it, it moves again.
function restCheck() {
  const now = Date.now(), idle = now - restSeen;
  const focused = document.hasFocus();
  if (focused) awaySince = 0; else if (!awaySince) awaySince = now;
  const live = stayLive();
  const rest = document.hidden || (live ? idle > REST_IDLE_MS && !somethingWorking() : (!focused && idle > REST_AWAY_MS) || idle > REST_IDLE_MS);
  setResting('at-rest', rest);
  setResting('still', !live && !rest && !focused && now - awaySince > STILL_AWAY_MS);
}
// A fade-in that has played is done, so a later pause and wake doesn't play it again: its class goes (the sidebar's
// and handovers' keep theirs, which also mean "new", and are marked shown instead).
const RESTING = ['at-rest', 'still', 'low-power'];
const freshDone = el => { if (el.classList.contains('nav-h') || el.classList.contains('handover')) el.classList.add('shown'); else el.classList.remove('fresh'); };
// Waking: what arrived while the window rested was shown at once, so it counts as played too (rather than everything
// that came in fading in together).
function setResting(cls, on) {
  const root = document.documentElement.classList;
  if (!on && root.contains(cls) && RESTING.every(c => c === cls || !root.contains(c))) for (const el of document.querySelectorAll('.fresh:not(.shown)')) freshDone(el);
  root.toggle(cls, on);
}
document.addEventListener('animationend', e => {
  const el = e.target; if (!el || !el.classList) return;
  if (e.animationName === 'fresh') freshDone(el);
  else if (e.animationName === 'perm-ping' || e.animationName === 'perm-ping-cx') el.classList.remove('arrive');
  else if (e.animationName === 'develop') { const g = el.closest('.gen'); if (g) g.classList.remove('develop'); }
}, true);
window.addEventListener('blur', () => { awaySince = Date.now(); setTimeout(restCheck, STILL_AWAY_MS + 200); });
window.addEventListener('focus', () => { awaySince = 0; restCheck(); });
function restWake() {
  restSeen = Date.now();
  if (document.documentElement.classList.contains('at-rest')) restCheck();
}
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus']) window.addEventListener(ev, restWake, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) restSeen = Date.now(); restCheck(); });
setInterval(restCheck, 15000);
// On battery and below 40% (a phone, a laptop unplugged), the scene stays still: the looping
// decoration pauses, as at rest, without dimming. Plugged in again, it moves again.
if (navigator.getBattery) navigator.getBattery().then(bat => {
  // A machine with no battery (a desktop, a virtual machine) can report "not charging, 0%": that's
  // no battery at all, not an empty one (nothing runs at 0%).
  const sync = () => setResting('low-power', !bat.charging && bat.level > 0 && bat.level < 0.4);
  for (const ev of ['chargingchange', 'levelchange']) bat.addEventListener(ev, sync);
  sync();
}).catch(() => {});
