'use strict';
/* Motion (banners carrying over, projects rising in, dials drawing) and the clocks. */

/* ---------- motion ---------- */
const motionOk = () => Local.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
// Runs a view change as a view transition when the browser can, so banners carry over between pages.
function transition(fn) {
  if (!document.startViewTransition || !motionOk() || document.hidden) { fn(); return null; }
  const t = document.startViewTransition(fn);
  t.updateCallbackDone.catch(err => toast(err.message || String(err)));
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
  if (S.view !== 'hub' || !$('awaitList')) return;
  const A = awaiting(), W = atWork(), Q = quietOpen();
  // The clock ticks on its own, so a new minute alone doesn't redraw the hero (and restart its scene).
  const heroNow = heroHtml(), heroKey = heroNow.replace(/<span data-clock>[^<]*<\/span>/, '');
  // Only when it changed: redrawing restarts the scene's animations (a forced refresh needn't).
  if ($('heroSlot')._h !== heroKey) { $('heroSlot').innerHTML = heroNow; $('heroSlot')._h = heroKey; }
  renderWelcome();
  // A chat moving between the boards (it finished, or wants you) glides across; new ones fade in.
  flip([$('awaitList'), $('board'), $('quietList')], () => {
    patch($('awaitList'), A, keyOf, awaitCard, '<p class="empty-line">Nothing is waiting on you. When Claude asks for your OK or finishes a reply, it shows up here first.</p>');
    patch($('board'), W, keyOf, workCard, `<p class="empty-line">${A.length ? 'Nothing else is working right now.' : 'Nothing is working right now. Open a chat and it appears here while it works.'}</p>`);
    patch($('quietList'), Q, keyOf, quietChip, '');
  });
  $('quietList').classList.toggle('has', Q.length > 0);
  const dials = S.accounts.map(a => ({ a }));
  if (S.codex && S.codex.enabled) for (const cx of codexAccts()) dials.push({ cx });
  patch($('dials'), [...dials, { add: true }], x => (x.add ? 'add' : x.cx ? `cx:${x.cx.id}` : x.a.id), x => (x.add ? '<button class="add-card" data-act="add"><span class="glyph" aria-hidden="true">✦</span>Add another Claude account</button>' : x.cx ? codexCard(x.cx) : dialCard(x.a)));
  tick();
}

function renderRecent() {
  const every = allSessions().sort((x, y) => y[0].updated - x[0].updated);
  const n = { claude: 0, codex: 0, openclaw: 0 }; for (const [x] of every) n[provOf(x)]++;
  const kinds = Object.keys(n).filter(k => n[k]);
  const f = kinds.length > 1 && kinds.includes(S.recentProv) ? S.recentProv : 'all';
  const all = f === 'all' ? every : every.filter(([x]) => provOf(x) === f);
  const tab = (v, label, n) => `<button class="${f === v ? 'on' : ''}" data-recent="${v}" aria-pressed="${f === v}">${label} <span class="count">${n}</span></button>`;
  $('page').innerHTML = `<div id="guardSlot">${guardHtml()}</div>
    <header class="f-head"><div><p class="eyebrow">✧ Every folder</p><h1>Recent chats</h1><p class="f-meta">Your latest chats${f === 'codex' ? ' in Codex' : f === 'claude' ? ` in Claude Code, ready to open as ${esc(current().name)}` : f === 'openclaw' ? ' from OpenClaw agents, to read here' : ''}.</p></div>
      ${kinds.length > 1 ? `<div class="seg provseg" role="group" aria-label="Show">${tab('all', 'All', every.length)}${kinds.map(k => tab(k, PROV_TITLE[k], n[k])).join('')}</div>` : ''}</header>
    ${all.length ? `<ul class="rows sec-gap">${all.slice(0, 60).map(([x, p]) => rowHtml(x, p.name)).join('')}</ul>` : '<p class="empty-line">Nothing here yet.</p>'}`;
}
// A project: its banner, then its chats, documents and pictures.
function renderFolder() {
  const a = current(), p = S.projects.find(x => x.cwd === S.folder);
  if (!p) { S.view = 'hub'; return renderPage(); }
  const w = S.worlds[p.cwd];
  if (p.exists && worldStale(p.cwd)) loadWorld(p.cwd).then(() => { if (S.view === 'folder' && S.folder === p.cwd) renderFolder(); }).catch(() => {});
  const pinned = S.pins.has(p.cwd);
  const prov = S.prov;
  const list = prov ? p.sessions.filter(x => provOf(x) === prov) : p.sessions;
  // Looking at one kind of chat: a link to the others here (Claude Code's first).
  const otherProv = prov ? ['claude', 'codex', 'openclaw'].find(v => v !== prov && p.sessions.some(x => provOf(x) === v)) : null;
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
    <div class="wp-in"><p class="eyebrow ${prov || ''}">${prov === 'codex' ? 'Codex chats in this project' : prov === 'claude' ? 'Claude Code chats in this project' : prov === 'openclaw' ? 'OpenClaw sessions in this project' : 'Project'}</p><h1>${esc(p.name)}</h1></div>${hint}`;
  const subH = `<div class="wp-where"><p class="f-path">${esc(p.cwd)}${p.exists ? '' : ' (this folder no longer exists)'}</p>
      <p class="f-meta">${esc(meta[0].toUpperCase() + meta.slice(1))}.${esc(todayLine)}${other ? ` <button class="linkish" data-view="folder" data-cwd="${esc(p.cwd)}" data-prov="${otherProv}">${other === 1 ? `1 ${otherName} ${otherWord}` : `${other} ${otherName} ${otherWord}s`} here too</button>` : ''}</p></div>
    <div class="wp-tools"><button class="btn quiet sm" data-act="browse" ${p.exists ? '' : 'disabled'}>Browse files</button><button class="btn quiet sm" data-act="reveal" ${p.exists ? '' : 'disabled'}>Open folder</button><button class="btn quiet sm" data-act="pin">${pinned ? 'Unpin' : 'Pin to top'}</button></div>`;
  const off = !canLaunch(a) || !p.exists;
  const cxOff = !codexReady() || !p.exists;
  const cxWhy = S.codex && S.codex.installed === false ? 'Install Codex first (Setup)' : 'Sign in to Codex first';
  const claudeBtn = `<button class="btn ${prov === 'codex' ? '' : 'prime'}" data-act="${inApp() ? 'newchat' : 'new'}" ${off ? `disabled title="${esc(a.lockMessage || `Sign in to ${a.name} first`)}"` : `title="As ${esc(a.name)}"`}>New Claude chat</button>`;
  const codexBtn = S.codex && S.codex.enabled ? `<button class="btn ${prov === 'codex' ? 'prime' : 'codexbtn'}" data-act="${inApp() ? 'newcodex' : 'newcodex-term'}" ${cxOff ? `disabled title="${cxWhy}"` : ''}>New Codex chat</button>` : '';
  const tab = (id, label, n) => `<button role="tab" class="wt" id="wt-${id}" data-wtab="${id}" aria-controls="wpBody" aria-selected="${S.worldTab === id}" tabindex="${S.worldTab === id ? 0 : -1}">${label}<span class="count">${n}</span></button>`;
  const barH = `<div class="wtabs" role="tablist" aria-label="${esc(p.name)}">${tab('chats', 'Chats', list.length)}${tab('docs', 'Documents', w ? `${w.docs.length}${w.docs.length >= 200 ? '+' : ''}` : '·')}${tab('gallery', 'Gallery', w ? `${w.images.length}${w.images.length >= 300 ? '+' : ''}` : '·')}</div>
    <div class="wp-act"><button class="btn quiet" data-act="world-prompt" aria-haspopup="menu" aria-expanded="false" ${p.exists ? '' : 'disabled'}><span class="glyph" aria-hidden="true">❡</span>Start with a prompt</button>${prov === 'codex' ? codexBtn + claudeBtn : claudeBtn + codexBtn}<button class="icon" data-act="world-more" aria-haspopup="menu" aria-expanded="false" aria-label="More for this world">${ICON.more}</button></div>`;
  const page = $('page');
  if (page.dataset.worldPage !== p.cwd || !$('wpHero')) {
    page.dataset.worldPage = p.cwd;
    page.innerHTML = `<div id="guardSlot">${prov === 'codex' ? '' : guardHtml()}</div>
      <header class="wp-hero ${hasArt ? 'has-art' : ''}" id="wpHero"></header>
      <div class="wp-sub" id="wpSub"></div>
      <div class="wp-bar" id="wpBar"></div>
      <section class="wp-body" id="wpBody" role="tabpanel"></section>`;
  } else if ($('guardSlot')) { const g = prov === 'codex' ? '' : guardHtml(); if ($('guardSlot')._h !== g) { $('guardSlot').innerHTML = g; $('guardSlot')._h = g; } }
  const put = (id, h) => { const el = $(id); if (el._h !== h) { el.innerHTML = h; el._h = h; } };
  put('wpHero', heroH); $('wpHero').classList.toggle('has-art', hasArt);
  put('wpSub', subH); put('wpBar', barH);
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
    const n = { claude: 0, codex: 0, openclaw: 0 }; for (const x of p.sessions) n[provOf(x)]++;
    const kinds = Object.keys(n).filter(k => n[k]);
    const list = prov ? p.sessions.filter(x => provOf(x) === prov) : p.sessions;
    const seg = kinds.length > 1 ? `<div class="seg provseg" role="group" aria-label="Show">${[['all', 'All', p.sessions.length], ...kinds.map(k => [k, PROV_TITLE[k], n[k]])].map(([v, l, n]) => `<button class="${(prov || 'all') === v ? 'on' : ''}" data-wprov="${v}" aria-pressed="${(prov || 'all') === v}">${l} <span class="count">${n}</span></button>`).join('')}</div>` : '';
    if (fresh || !$('wbList')) { box.innerHTML = '<div class="wb-top" id="wbTop"></div><div id="wbList"></div>'; box._h = null; }
    if ($('wbTop')._h !== seg) { $('wbTop').innerHTML = seg; $('wbTop')._h = seg; $('wbTop').hidden = !seg; }
    const lb = $('wbList');
    if (!list.length) { lb.innerHTML = `<p class="empty-line">No ${prov === 'codex' ? 'Codex chats' : prov === 'claude' ? 'Claude Code chats' : 'chats'} in this project yet. Start one above, or start with a prompt.</p>`; return; }
    if (!lb.querySelector(':scope > ul.rows')) lb.innerHTML = '<ul class="rows"></ul>';
    return patch(lb.firstElementChild, list, s => s.id, s => rowHtml(s, null));
  }
  if (!w) return set(`<p class="loading">${p.exists ? 'Reading this project’s files…' : 'This folder no longer exists.'}</p>`);
  if (S.worldTab === 'docs') {
    if (!w.docs.length) return set('<p class="empty-line">No markdown documents here yet. Notes, reviews and anything else chats write as markdown show up here, newest first.</p>');
    const t0 = midnight(), week = t0 - 6 * 864e5;
    const groups = [['Today', w.docs.filter(d => d.mtime >= t0)], ['This week', w.docs.filter(d => d.mtime < t0 && d.mtime >= week)], ['Earlier', w.docs.filter(d => d.mtime < week)]].filter(g => g[1].length);
    const row = d => { const dir = d.rel.slice(0, Math.max(0, d.rel.length - d.name.length)).replace(/[\\/]$/, ''); return `<li><button class="doc" data-doc="${esc(d.path)}" data-q="${esc(d.rel.toLowerCase())}"><span class="glyph" aria-hidden="true">❧</span><span class="doc-n">${esc(d.name.replace(/\.(md|markdown|mdx)$/i, ''))}</span><span class="doc-d">${esc(dir || '')}</span><span class="doc-w" data-ago="${d.mtime}">${esc(agoL(d.mtime))}</span></button></li>`; };
    set(`<div class="wb-top"><label class="wb-filter"><span class="sr">Filter documents</span><input type="search" id="docFilter" placeholder="Filter documents" autocomplete="off" spellcheck="false" value="${esc(S.docFilter || '')}"></label><span class="wb-note">${w.docs.length >= 200 ? 'The 200 newest documents' : plural(w.docs.length, 'document')}, newest first</span></div>
      ${groups.map(([g, list]) => `<div class="docgroup"><p class="dg-h">${g}<span class="count">${list.length}</span></p><ul class="docs">${list.map(row).join('')}</ul></div>`).join('')}`);
    return filterDocs();
  }
  if (!w.images.length) return set(`<p class="empty-line">No pictures here yet. Cover art, screenshots and anything Codex makes in this folder show up here.${codexReady() && coverPrompt() ? ` <button class="linkish" data-prompt="${esc(coverPrompt().id)}">Make a cover image with Codex</button>` : ''}</p>`);
  set(`<div class="wb-top"><span class="wb-note">${w.images.length >= 300 ? 'The 300 newest pictures' : plural(w.images.length, 'picture')}, newest first. Pick one as this project’s banner.</span>${w.bannerPicked ? '<button class="btn quiet sm" data-banner="-">Use the automatic banner</button>' : ''}</div>
    <ul class="gallery">${w.images.map((im, i) => `<li class="gi ${im.path === w.banner ? 'is-banner' : ''}" style="--i:${Math.min(i, 24)}"><button class="gi-img" data-img="${esc(im.path)}" aria-label="Open ${esc(im.name)}"><img src="${esc(imageSrc(im.path, p.cwd))}" alt="" loading="lazy" decoding="async"></button>
      <div class="gi-cap"><span class="gi-n" title="${esc(im.rel)}">${esc(im.name)}</span><span class="gi-w" data-ago="${im.mtime}">${esc(agoL(im.mtime))}</span></div>
      ${im.path === w.banner ? '<span class="gi-flag">Banner</span>' : `<button class="gi-use btn sm" data-banner="${esc(im.path)}">Use as banner</button>`}</li>`).join('')}</ul>`);
}
function filterDocs() {
  const q = (S.docFilter || '').trim().toLowerCase();
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
    { label: 'Edit prompts…', run: openPromptEditor },
    ...(p.added && !p.sessions.length ? ['-', { label: 'Remove from the list', hint: 'the folder itself stays', danger: true, run: async () => { await api('/api/project/forget', { cwd: p.cwd }); await loadSessions(); go('hub'); toast(`Removed ${p.name} from the list. Its folder is still there.`, 4000); } }] : []),
  ]);
}
function renderSearch() {
  const h = S.hits;
  const rows = h ? h.hits.map(x => { const [s, p] = sessionById(x.id); return s ? rowHtml(s, p.name, x) : ''; }).join('') : '';
  const pr = h && h.progress;
  $('page').innerHTML = `<header class="f-head"><div><p class="eyebrow">❝ Search</p><h1>“${esc(S.q)}”</h1><p class="f-meta">${h ? (h.hits.length === 1 ? 'One chat mentions it.' : `${nword(h.hits.length)} chats mention it.`) : 'Searching…'}</p></div>
      <div class="f-act"><button class="btn" data-act="search-again">Search again</button><button class="btn quiet" data-view="hub">Back to the hub</button></div></header>
    ${pr && !pr.ready ? `<p class="progress">Still reading chats (${pr.done} of ${pr.total}); results may grow.</p>` : ''}
    ${rows ? `<ul class="rows sec-gap">${rows}</ul>` : h ? '<p class="empty-line">Nothing matches. Search looks inside every message you and Claude wrote, plus titles and folder names.</p>' : ''}`;
}
function renderPage() {
  if (S.view === 'hub') renderHub();
  else if (S.view === 'recent') renderRecent();
  else if (S.view === 'folder') renderFolder();
  else if (S.view === 'search') renderSearch();
}
function renderAll() { renderNav(); renderPage(); renderBar(); updateTitle(); }
// Names the chat window uses.
const renderSide = () => renderNav();
const renderMain = () => renderPage();
function go(view, folder, prov) {
  const from = S.view === 'folder' && !(window.ChatUI && ChatUI.isOpen()) ? S.folder : null;
  if (view === 'folder' && folder !== undefined && folder !== S.folder) S.worldTab = 'chats';
  // The state changes now; the page redraws inside the transition.
  S.view = view; if (folder !== undefined) S.folder = folder;
  if (view === 'folder') S.prov = prov === 'claude' || prov === 'codex' ? prov : null;
  const run = () => {
    document.body.classList.remove('nav-open');
    if (window.ChatUI && ChatUI.isOpen()) ChatUI.close(true);
    renderNav(); renderPage(); window.scrollTo({ top: 0 });
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
// Go to the hub, then bring one of its sections into view.
const hubTo = id => (S.view !== 'hub' || (window.ChatUI && ChatUI.isOpen()) ? go('hub') : Promise.resolve()).then(() => setTimeout(() => $(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30));

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
