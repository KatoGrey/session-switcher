'use strict';
/* The command palette (Ctrl+K) and the file viewer. */

/* ---------- command palette ---------- */
const Pal = { items: [], sel: 0 };
function score(text, q) {
  const t = String(text || '').toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const term of terms) { const i = t.indexOf(term); if (i < 0) return -1; s += i === 0 ? 30 : /\W/.test(t[i - 1]) ? 20 : 8; }
  return s;
}
function palItems(q) {
  const out = [];
  const add = (g, list) => { if (list.length) out.push({ g }, ...list); };
  const run = S.activity.filter(x => !x.parentKey).map(x => ({ glyph: NEEDS.has(statusOf(x)) || statusOf(x) === 'reply' ? '✦' : '◉', t: x.title || 'New chat', s: `${{ approve: 'needs your OK', question: 'has a question', 'terminal-wait': 'waiting in its terminal', reply: 'your turn', working: 'at work', quiet: 'open', ended: 'stopped' }[statusOf(x)]}${x.folder ? ` · ${x.folder}` : ''}`, run: () => openActivity(x), text: `${x.title} ${x.folder}` }));
  const acts = [
    { glyph: '✦', t: 'Go to the hub', run: () => go('hub') },
    { glyph: '✧', t: 'Recent chats', run: () => go('recent') },
    { glyph: '⚙', t: 'Setup and health', run: openSetup, alias: 'settings options preferences config health' },
    { glyph: '✧', t: 'Take the tour', s: 'a minute on what’s where', run: () => startTour(), alias: 'tour help guide intro getting started' },
    { glyph: '⚑', t: 'Race Claude and Codex', s: 'the same task in two copies of a project; keep the better one', run: () => openRaceDialog(S.view === 'folder' ? S.folder : null), alias: 'race compete compare both versus head to head' },
    { glyph: '⏳', t: 'Queue a task', s: 'starts as a new chat when an account has room, or at a time', run: () => openTaskDialog(S.view === 'folder' ? S.folder : null), alias: 'queue later schedule task when limit resets' },
    { glyph: '§', t: 'Rules and tools', s: 'CLAUDE.md, AGENTS.md and MCP servers, shared by Claude and Codex', run: () => openRules(S.view === 'folder' ? S.folder : null), alias: 'claude.md agents.md mcp servers tools rules instructions memory' },
    { glyph: '◐', t: 'Appearance', s: 'themes, fonts, light or dark, text and interface size', run: () => openSetup('look'), alias: 'font fonts typeface' },
    { glyph: '?', t: 'Keyboard shortcuts', run: () => openShortcuts(), alias: 'keys hotkeys help' },
    { glyph: '◐', t: Look.isLight() ? 'Switch to dark mode' : 'Switch to light mode', run: () => Look.set({ mode: Look.isLight() ? 'dark' : 'light' }) },
    ...Look.THEMES.filter(t => t.id !== Look.get().theme).map(t => ({ glyph: '◉', t: `Theme: ${t.name}`, s: t.note, run: () => Look.set({ theme: t.id }) })),
    ...Look.FONT_SETS.filter(f => f.id !== Look.get().fontSet).map(f => ({ glyph: '¶', t: `Fonts: ${f.name}`, s: [...new Set([f.head, f.body, f.code])].map(id => Look.FAMILIES.find(x => x.id === id).name).join(' · '), run: () => Look.set({ fontSet: f.id, fBody: '', fHead: '', fCode: '' }), alias: 'font set typeface lettering' })),
    { glyph: '§', t: 'Fonts and licences', s: 'every bundled font and its licence', run: () => fontCredits(), alias: 'font license licence credits attribution ofl' },
    { glyph: '◈', t: 'Check usage for every account', run: () => refreshUsage() },
    ...S.accounts.filter(a => a.id !== S.acct).map(a => ({ glyph: '◆', t: `Work as ${a.name}`, s: usageLine(a.id, { short: true }), run: () => useAccount(a.id) })),
    ...S.accounts.map(a => ({ glyph: '❖', t: `Open claude.ai as ${a.name}`, s: 'regular Claude chats', run: () => openWeb(a.id) })),
    ...(S.codex && S.codex.enabled ? (S.codex.signedIn ? [{ glyph: '❖', t: 'Open chatgpt.com', s: 'regular ChatGPT', run: () => openWeb(S.codex.id) }, { glyph: '◈', t: 'Check Codex usage', run: () => refreshUsage(S.codex.id) }] : [{ glyph: '✥', t: 'Sign in to Codex with ChatGPT', run: codexSignIn }]) : []),
    { glyph: '✥', t: 'New project', s: 'make a folder and start a chat', run: () => openNewProject() },
    { glyph: '✥', t: 'Add an account', run: addAccount, alias: 'sign in login' },
    ...(window.REMOTE ? [] : [{ glyph: '↻', t: 'Restart Session Switcher', s: S.update ? 'a new version is ready' : 'your chats come back where they were', run: restartApp, alias: 'reboot relaunch reload update' }, { glyph: '⏻', t: 'Quit Session Switcher', run: quitApp, alias: 'exit close stop app' }]),
  ].map(x => ({ ...x, text: `${x.t} ${x.alias || ''}` }));
  const claudeNew = canLaunch(current()) ? S.projects.filter(p => p.exists).map(p => ({ glyph: '✦', t: `New Claude chat in ${p.name}`, s: `as ${current().name}`, run: () => ChatUI.open({ cwd: p.cwd, mode: 'new' }), text: `new chat claude ${p.name}` })) : [];
  const pinItems = S.projects.map(p => ({ glyph: '★', t: `${S.pins.has(p.cwd) ? 'Unpin' : 'Pin'} ${p.name}`, s: 'in the sidebar', run: () => togglePin(p.cwd), text: `pin unpin favorite ${p.name}` }));
  const folders = S.projects.map(p => ({ glyph: glyphFor(p.name), t: p.name, s: `${plural(p.sessions.length, 'chat')}`, run: () => go('folder', p.cwd), text: `${p.name} ${p.cwd}` }));
  const chats = allSessions().sort((x, y) => y[0].updated - x[0].updated).map(([s, p]) => ({ glyph: '❝', t: s.title, s: `${p.name} · ${agoL(s.updated)}`, run: () => (liveOf(s.id) ? ChatUI.open({ sessionId: s.id }) : isRunning(s.id) ? ChatUI.watch({ sessionId: s.id, source: 'terminal' }) : inApp() ? ChatUI.open({ sessionId: s.id }) : openDrawer(s.id)), text: `${s.title} ${p.name} ${s.firstPrompt || ''}` }));
  const cxNew = codexReady() ? S.projects.filter(p => p.exists).map(p => ({ glyph: '✥', t: `New Codex chat in ${p.name}`, s: 'Codex', run: () => ChatUI.open({ cwd: p.cwd, mode: 'new', provider: 'codex' }), text: `codex new ${p.name}` })) : [];
  // Prompts, in the project you're looking at first, then in every project.
  const here = S.view === 'folder' ? S.projects.find(p => p.cwd === S.folder) : null;
  const worldsFor = here ? [here, ...S.projects.filter(p => p !== here)] : S.projects;
  const prompts = worldsFor.filter(p => p.exists).flatMap(p => S.prompts.map(pr => ({ glyph: '❡', t: `${pr.title} in ${p.name}`, s: pr.provider === 'codex' ? 'Codex' : 'prompt', run: () => startWithPrompt(p.cwd, pr), text: `${pr.title} ${p.name} prompt start` })));
  const docs = Object.values(S.worlds).flatMap(w => { const p = S.projects.find(x => x.cwd === w.cwd); return p ? w.docs.slice(0, 60).map(d => ({ glyph: '❧', t: d.name, s: `${p.name} · ${agoL(d.mtime)}`, run: () => Viewer.open({ path: d.path, cwd: p.cwd }), text: `${d.rel} ${p.name}` })) : []; });
  const models = window.ChatUI && ChatUI.modelItems ? ChatUI.modelItems() : [];
  // The chat you're in: find, export, pin.
  const inChat = window.ChatUI && ChatUI.isOpen();
  const sid = inChat && ChatUI.sessionId ? ChatUI.sessionId() : null;
  const chatActs = inChat ? [
    { glyph: '⌕', t: 'Find in this chat', s: 'Ctrl F', run: () => ChatUI.find(), text: 'find search this chat' },
    { glyph: '❧', t: 'Export this chat as Markdown', run: () => ChatUI.exportChat(), text: 'export save download markdown chat' },
    ...(sid ? [{ glyph: '★', t: isFav(sid) ? 'Unpin this chat from the sidebar' : 'Pin this chat to the sidebar', run: () => toggleFav(sid), text: 'pin favorite star this chat' }] : []),
  ] : [];
  if (!q) {
    add('This chat', chatActs);
    add('Active now', run);
    if (here) add(`Start ${here.name} with a prompt`, prompts.slice(0, S.prompts.length));
    add('Recent chats', chats.slice(0, 6));
    add('Projects', folders.slice(0, 6));
    add('Actions', acts);
    return out;
  }
  const rank = list => list.map(x => ({ x, s: score(x.text, q) })).filter(r => r.s >= 0).sort((a, b) => b.s - a.s).map(r => r.x);
  add('Active now', rank(run).slice(0, 5));
  add('Chats', rank(chats).slice(0, 8));
  add('Projects', rank(folders).slice(0, 5));
  add('Documents', rank(docs).slice(0, 5));
  add('Start with a prompt', rank(prompts).slice(0, 4));
  add('Actions', rank(acts).slice(0, 5));
  add('This chat', rank(chatActs).slice(0, 3));
  add('Switch model in this chat', rank(models).slice(0, 6));
  add('Start a chat', rank([...claudeNew, ...cxNew]).slice(0, 4));
  add('Pin', rank(pinItems).slice(0, 3));
  out.push({ g: 'Inside every message' }, { glyph: '❝', t: `Search every message for “${q}”`, s: 'full text', run: () => runSearch(q) });
  return out;
}
function renderPal() {
  const q = $('palQ').value.trim();
  Pal.items = palItems(q);
  const picks = Pal.items.filter(x => !x.g);
  Pal.sel = Math.min(Pal.sel, Math.max(0, picks.length - 1));
  let n = -1;
  $('palList').innerHTML = Pal.items.map(x => {
    if (x.g) return `<li class="pal-g" role="presentation">${esc(x.g)}</li>`;
    n++;
    return `<li class="pal-i" role="option" id="pal-${n}" data-n="${n}" aria-selected="${n === Pal.sel}"><span class="glyph" aria-hidden="true">${esc(x.glyph || '·')}</span><span class="pi-t">${esc(x.t)}</span>${x.s ? `<span class="pi-s">${esc(x.s)}</span>` : ''}</li>`;
  }).join('') || '<li class="pal-empty">Nothing here yet.</li>';
  $('palQ').setAttribute('aria-activedescendant', `pal-${Pal.sel}`);
  $('palList').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
let palReturn = null;
function openPalette(prefill = '') {
  closeMenu();
  if ($('palette').hidden) palReturn = document.activeElement;
  $('palette').hidden = false; $('palQ').value = prefill; Pal.sel = 0; renderPal(); $('palQ').focus();
}
function closePalette() {
  $('palette').hidden = true;
  if (palReturn && document.contains(palReturn) && palReturn.focus) palReturn.focus({ preventScroll: true });
  palReturn = null;
}
function pickPal(n) { const x = Pal.items.filter(i => !i.g)[n]; if (!x) return; closePalette(); wrap(x.run)(); }
$('palQ').addEventListener('input', () => { Pal.sel = 0; renderPal(); });
$('palQ').addEventListener('keydown', e => {
  const count = Pal.items.filter(x => !x.g).length;
  if (e.key === 'ArrowDown') { Pal.sel = (Pal.sel + 1) % Math.max(1, count); renderPal(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { Pal.sel = (Pal.sel - 1 + count) % Math.max(1, count); renderPal(); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); pickPal(Pal.sel); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});
$('palList').addEventListener('mousemove', e => { const i = e.target.closest('.pal-i'); if (i && +i.dataset.n !== Pal.sel) { Pal.sel = +i.dataset.n; renderPal(); } });
$('palList').addEventListener('click', e => { const i = e.target.closest('.pal-i'); if (i) pickPal(+i.dataset.n); });
$('palette').addEventListener('mousedown', e => { if (e.target === $('palette')) closePalette(); });

let searchSeq = 0;
async function runSearch(q) {
  S.q = q; S.hits = null; go('search');
  const seq = ++searchSeq;
  const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (seq !== searchSeq || S.view !== 'search') return;
  S.hits = r; renderSearch();
  if (!r.progress.ready) setTimeout(() => { if (S.view === 'search' && S.q === q) wrap(runSearch)(q); }, 1500);
}

/* ---------- the file viewer: open what a chat links to ---------- */
const Viewer = (() => {
  const V = { ctx: {}, stack: [], cur: null, raw: false, list: null, idx: -1 };
  const dlg = () => $('viewer');
  function ensure() {
    if ($('viewer')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="viewer" class="wide viewer" aria-labelledby="vTitle"><div class="v-wrap"><div class="v-head" id="vHead"></div><div class="v-body" id="vBody"></div></div></dialog>`);
    dlg().addEventListener('click', wrap(onClick));
    dlg().addEventListener('close', () => { V.stack = []; V.list = null; });
    // In a project's gallery, ← and → step through its pictures.
    dlg().addEventListener('keydown', e => {
      if (!V.list || !V.cur || V.cur.kind !== 'image' || e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); wrap(step)(e.key === 'ArrowRight' ? 1 : -1); }
    });
  }
  const sizeOf = n => (n === null || n === undefined ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  function joinPath(dir, rel) {
    if (/^([A-Za-z]:[\\/]|\/|~)/.test(rel)) return rel;
    const sep = dir.includes('\\') ? '\\' : '/';
    const parts = dir.split(/[\\/]+/);
    for (const seg of rel.split(/[\\/]+/)) { if (!seg || seg === '.') continue; if (seg === '..') { if (parts.length > 1) parts.pop(); } else parts.push(seg); }
    return parts.join(sep) || sep;
  }
  function crumbs(p) {
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(/[\\/]+/).filter((x, i) => x || i === 0);
    let acc = '';
    return parts.map((seg, i) => {
      acc = i === 0 ? (seg || sep) : `${acc}${acc.endsWith(sep) ? '' : sep}${seg}`;
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) acc = `${seg}${sep}`;
      const last = i === parts.length - 1;
      const label = seg || sep;
      const el = last ? `<span class="v-crumb cur">${esc(label)}</span>` : `<button class="v-crumb" data-v="go" data-path="${esc(acc)}">${esc(label)}</button>`;
      return i === 0 || (i === 1 && !parts[0]) ? el : `<span class="v-sep">${esc(sep)}</span>${el}`;
    }).join('');
  }
  function render() {
    const f = V.cur;
    const kind = f.kind === 'dir' ? 'Folder' : f.kind === 'image' ? 'Image' : f.kind === 'text' ? (f.lang || 'text') : f.kind === 'video' ? 'Video' : f.kind === 'audio' ? 'Sound' : f.kind === 'pdf' ? 'PDF' : 'File';
    const meta = [kind, f.kind === 'dir' ? plural(f.entries.length, 'item') : sizeOf(f.size), f.mtime ? `changed ${agoL(f.mtime)}` : ''].filter(Boolean).join(' · ');
    $('vHead').innerHTML = `
      <div class="v-t">
        <p class="eyebrow">${esc(meta)}</p>
        <h3 id="vTitle">${V.stack.length ? '<button class="icon v-back" data-v="back" aria-label="Back">←</button>' : ''}${esc(f.name)}</h3>
        <p class="v-path">${crumbs(f.path)}</p>
      </div>
      <div class="v-act">
        ${f.kind === 'text' && f.markdown ? `<div class="seg" role="group" aria-label="View"><button class="${V.raw ? '' : 'on'}" data-v="rendered" aria-pressed="${!V.raw}">Formatted</button><button class="${V.raw ? 'on' : ''}" data-v="raw" aria-pressed="${V.raw}">Markdown</button></div>` : ''}
        ${f.kind === 'text' ? `<button class="btn prime sm" data-v="copy">Copy ${f.markdown ? 'markdown' : 'text'}</button>` : ''}
        ${inGallery() ? `<span class="v-step"><button class="icon" data-v="prev" aria-label="Previous picture" ${V.idx > 0 ? '' : 'disabled'}>‹</button><span class="count">${V.idx + 1} of ${V.list.length}</span><button class="icon" data-v="next" aria-label="Next picture" ${V.idx < V.list.length - 1 ? '' : 'disabled'}>›</button></span>
          ${isBanner() ? '<span class="tag gilt">Banner</span>' : '<button class="btn sm" data-v="banner">Use as banner</button>'}` : ''}
        <button class="btn sm" data-v="copypath">Copy path</button>
        <button class="btn quiet sm" data-v="reveal">Show in folder</button>
        <button class="icon" data-v="close" aria-label="Close">✕</button>
      </div>`;
    let body = '';
    if (f.kind === 'dir') {
      body = f.entries.length ? `<ul class="v-dir">${f.entries.map(e => `<li><button data-v="open" data-name="${esc(e.name)}"><span class="glyph" aria-hidden="true">${e.dir ? '❖' : '✧'}</span><span class="vd-n">${esc(e.name)}${e.dir ? '/' : ''}</span><span class="vd-s">${e.dir ? '' : esc(sizeOf(e.size))}</span><span class="vd-m">${e.mtime ? esc(agoL(e.mtime)) : ''}</span></button></li>`).join('')}</ul>${f.more ? '<p class="v-note">Showing the first 1,000 items.</p>' : ''}` : '<p class="v-note">This folder is empty.</p>';
    } else if (f.kind === 'image') body = `<div class="v-img"><img src="${esc(f.src)}" alt="${esc(f.name)}"></div>`;
    else if (f.kind === 'video') body = `<div class="v-media"><video controls autoplay preload="metadata" src="${esc(mediaSrc(f.path))}"></video></div>`;
    else if (f.kind === 'audio') body = `<div class="v-media audio"><audio controls preload="metadata" src="${esc(mediaSrc(f.path))}"></audio></div>`;
    else if (f.kind === 'pdf') body = `<iframe class="v-pdf" title="${esc(f.name)}" src="${esc(mediaSrc(f.path))}"></iframe>`;
    else if (f.kind === 'text') {
      body = (f.markdown && !V.raw ? `<article class="md v-md">${ChatUI.md(f.text)}</article>` : `<pre class="v-raw">${esc(f.text)}</pre>`) + (f.truncated ? '<p class="v-note">Only the first 2 MB are shown.</p>' : '');
    } else body = `<p class="v-note">${esc(f.note || 'This file can’t be shown here.')}</p>`;
    $('vBody').innerHTML = body;
    $('vBody').scrollTop = 0;
  }
  function mediaSrc(p) {
    const q = new URLSearchParams({ token: TOKEN, path: p });
    for (const k of ['key', 'session', 'cwd']) if (V.ctx[k]) q.set(k, V.ctx[k]);
    return `/api/media?${q}`;
  }
  async function load(pathArg, { push = true } = {}) {
    const params = new URLSearchParams({ path: pathArg });
    for (const k of ['key', 'session', 'cwd']) if (V.ctx[k]) params.set(k, V.ctx[k]);
    const f = await api(`/api/file?${params}`);
    if (push && V.cur) V.stack.push(V.cur.path);
    V.cur = f; V.raw = false; render();
  }
  const inGallery = () => !!(V.list && V.cur && V.cur.kind === 'image' && V.idx >= 0 && !V.stack.length);
  const isBanner = () => { const w = V.ctx.cwd && S.worlds[V.ctx.cwd]; return !!(w && w.banner === V.list[V.idx]); };
  async function step(d) {
    const j = V.idx + d; if (!V.list || j < 0 || j >= V.list.length) return;
    V.idx = j; await load(V.list[j], { push: false });
  }
  async function open({ path: p, key = null, session = null, cwd = null, list = null }) {
    ensure();
    V.ctx = { key, session, cwd }; V.stack = []; V.cur = null;
    V.list = list && list.length ? list : null; V.idx = V.list ? V.list.indexOf(p) : -1;
    $('vHead').innerHTML = ''; $('vBody').innerHTML = '<p class="loading">Opening…</p>';
    if (!dlg().open) dlg().showModal();
    try { await load(p, { push: false }); }
    catch (err) { $('vHead').innerHTML = `<div class="v-t"><p class="eyebrow">Couldn’t open</p><h3 id="vTitle">${esc(String(p).split(/[\\/]/).filter(Boolean).pop() || p)}</h3></div><div class="v-act"><button class="icon" data-v="close" aria-label="Close">✕</button></div>`; $('vBody').innerHTML = `<p class="v-note">${esc(err.message)}</p>`; }
  }
  async function onClick(e) {
    const fl = e.target.closest('.flink[data-path]'); if (fl) { e.preventDefault(); return load(joinPath(V.cur.dir, fl.dataset.path)); }
    const a = e.target.closest('.v-md a[href]');
    if (a && /^#/.test(a.getAttribute('href') || '')) { e.preventDefault(); return undefined; }
    const b = e.target.closest('[data-v]'); if (!b) { if (e.target === dlg()) dlg().close(); return undefined; }
    const f = V.cur;
    switch (b.dataset.v) {
      case 'close': return dlg().close();
      case 'back': { const p = V.stack.pop(); if (p) await load(p, { push: false }); return undefined; }
      case 'go': return load(b.dataset.path);
      case 'open': return load(joinPath(f.path, b.dataset.name));
      case 'prev': return step(-1);
      case 'next': return step(1);
      case 'banner': {
        const w = await api('/api/project/banner', { cwd: V.ctx.cwd, path: V.list[V.idx] });
        S.worlds[V.ctx.cwd] = { ...w, at: Date.now() };
        toast('Banner updated.', 2000); render();
        if (S.view === 'folder' && S.folder === V.ctx.cwd) renderFolder();
        return undefined;
      }
      case 'rendered': V.raw = false; return render();
      case 'raw': V.raw = true; return render();
      case 'copy': return copyText(f.text, null).then(ok => { if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = `Copy ${f.markdown ? 'markdown' : 'text'}`; }, 1600); } });
      case 'copypath': return copyText(f.path, 'Copied the path.');
      case 'reveal': { const r = await api('/api/reveal', { path: f.path, ...V.ctx }); if (r.dryRun) toast(`Would run: ${r.script}`); return undefined; }
      default: return undefined;
    }
  }
  return { open, joinPath };
})();
