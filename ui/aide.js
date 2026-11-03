'use strict';
/* Companion: quick questions of your own, over a game or anything else, with your own subscriptions.
   (The aide, in the code: "companion" already means a chat's partner here.) Three places, one set of chats:
   - the panel: this same page in a see-through window (?solo=1&aide=1), the real chat with the rest put away,
     brought up by a key from anywhere (desktop/shell/aide.js);
   - its page in the app, with your games and General down the side and the chat beside them;
   - a short section on the hub.
   Turned on in Setup, where its keys can be changed. */

const AIDE_PANEL = PAGE_ARGS.get('aide') === '1';
const AIDE_PANE = PAGE_ARGS.get('aidepane') === '1';
const Aide = { typed: '', sel: null, frame: null, q: '', fold: new Set(), seq: 0, opening: false, sendAfter: false, app: null, group: null, who: null, pinned: false, moved: false, keys: null, capturing: null, drawer: null, recentQ: '', notebooks: new Map() };
const aideOn = () => !!(S.aide && S.aide.on);
const aideGroups = () => (S.aide && S.aide.groups) || [];
const aideChats = () => aideGroups().flatMap(g => g.chats.map(c => ({ ...c, group: g.key, groupName: g.name })));
// Who answers next: what was chosen here last, or in Setup once it's changed there.
async function loadAide() { S.aide = await api('/api/aide'); if (S.aide.who !== Aide.savedWho) { Aide.savedWho = S.aide.who; Aide.who = S.aide.who; } return S.aide; }

/* ---------- its keys, as they read ---------- */
const AIDE_MAC = !!(window.desktop && window.desktop.platform === 'darwin');
const AIDE_KEYS = { aideKey: AIDE_MAC ? 'Control+Q' : 'Alt+Q', aideLookKey: AIDE_MAC ? 'Control+Shift+Q' : 'Alt+Shift+Q' };
const aideKey = which => (Aide.keys && Aide.keys[which]) || AIDE_KEYS[which];
const keyCaps = acc => String(acc).split('+').map(k => `<kbd class="ak">${esc(k === 'CommandOrControl' ? (AIDE_MAC ? '⌘' : 'Ctrl') : k === 'Control' ? (AIDE_MAC ? '⌃' : 'Ctrl') : k === 'Alt' && AIDE_MAC ? '⌥' : k === 'Shift' && AIDE_MAC ? '⇧' : k)}</kbd>`).join('<span class="ak-p">+</span>');
const keyWords = acc => String(acc).replace(/\+/g, ' + ').replace('CommandOrControl', AIDE_MAC ? '⌘' : 'Ctrl');
async function aideLoadKeys() { if (!window.desktop) return; try { const o = await window.desktop.settings(); if (o) Aide.keys = { aideKey: o.aideKey, aideLookKey: o.aideLookKey, on: o.aideOn, aideOk: o.aideOk, aideLookOk: o.aideLookOk }; } catch { /* the app is closing */ } }
// Another program has the key: said plainly, since a key that does nothing looks like Companion is broken.
const aideKeyBusy = which => !!(Aide.keys && Aide.keys.on && (which === 'aideKey' ? Aide.keys.aideOk === false : Aide.keys.aideLookOk === false));
// What to offer instead: easy with the left hand, and not what a game or graphics overlay usually takes.
const AIDE_SPARE = { aideKey: ['Alt+X', 'Control+Alt+Q', 'Alt+`'], aideLookKey: ['Alt+Shift+X', 'Control+Alt+Shift+Q', 'Alt+Shift+`'] };

// A letter on a tile in the colors of its name, so a game can be spotted down a list.
function aideTile(g, size = 30) {
  if (g.key === 'general') return `<span class="ai-tile general" style="--s:${size}px" aria-hidden="true">✦</span>`;
  let h = 0; for (const ch of g.name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="ai-tile" style="--s:${size}px;--h:${h}" aria-hidden="true">${esc(g.name.trim().charAt(0).toUpperCase())}</span>`;
}
const aideProvName = p => ({ codex: 'Codex', gemini: 'Gemini' }[p] || 'Claude');

/* ---------- in the sidebar and on the hub ---------- */
function aideNav() {
  if (!aideOn()) return '';
  const n = aideChats().length;
  return `<button class="nav-i" data-view="aide" aria-current="${S.view === 'aide'}"><span class="glyph" aria-hidden="true">◈</span><span class="ni-t">Companion</span>${n ? `<span class="count">${n}</span>` : ''}</button>`;
}
function aideHubSection() {
  if (!aideOn()) return '';
  return `<section class="sec${secFold('companion')}" id="secCompanion" data-sec="companion">
    ${secHead('Your helper', 'Companion', '<button class="btn quiet sm" data-view="aide">All questions</button>', 'companion')}
    <div class="ai-hub" id="aideHub"></div>
  </section>`;
}
function renderAideHub() {
  const box = $('aideHub'); if (!box) return;
  const list = aideGroups().filter(g => g.chats.length).slice(0, 4);
  const h = list.length ? list.map(g => { const c = g.chats[0]; return `<button type="button" class="ai-card" data-aide-open="${esc(c.id)}">${aideTile(g, 34)}<span class="ai-card-t"><b>${esc(g.name)}</b><span>${esc(c.title)}</span></span><span class="ai-card-m">${esc(agoL(c.updated))}${g.chats.length > 1 ? `<small>${g.chats.length} chats</small>` : ''}</span></button>`; }).join('')
    : `<p class="ai-hub-none">${window.desktop ? `Press ${keyCaps(aideKey('aideKey'))} over anything to ask a quick question. Your chats gather here, by game.` : 'Your quick questions gather here, by game.'}</p>`;
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
}

/* ---------- its page ---------- */
function renderAidePage() {
  if (!S.aide) loadAide().then(aideRefresh).catch(() => {});
  if (!$('aidePage')) {
    $('page').innerHTML = `<div class="aide-page" id="aidePage">
      <aside class="ai-side" aria-label="Companion’s chats">
        <div class="ai-top"><div><p class="eyebrow">Your questions</p><h1>Companion</h1></div><button type="button" class="btn prime sm" id="aideNew" data-aide="new">New question</button></div>
        <input type="search" class="ai-q" id="aideQ" placeholder="Find a chat" aria-label="Find a chat" autocomplete="off" spellcheck="false" value="${esc(Aide.q)}">
        <div class="ai-groups" id="aideGroups"></div>
        <p class="ai-foot" id="aideFoot"></p>
      </aside>
      <section class="ai-main" id="aideMain" aria-label="The chat"><div class="ai-backbar"><button type="button" class="btn quiet sm" data-aide="list">← All questions</button><span id="aideContext"></span></div></section>
    </div>`;
  }
  renderAideGroups();
  renderAideMain();
  aideFrame();    // loaded ahead, so the first chat you pick opens at once
}
function renderAideGroups() {
  const box = $('aideGroups'); if (!box) return;
  const q = Aide.q.trim().toLowerCase();
  const gs = aideGroups().map(g => ({ ...g, chats: q ? g.chats.filter(c => c.title.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) : g.chats })).filter(g => g.chats.length || (!q && (g.key === 'general' || g.hasNotes)));
  const h = gs.map(g => {
    const open = !Aide.fold.has(g.key) || !!q;
    return `<div class="ai-g" data-g="${esc(g.key)}">
      <div class="ai-gh"><button type="button" class="ai-gb" data-aide-fold="${esc(g.key)}" aria-expanded="${open}">${aideTile(g)}<span class="ai-gn">${esc(g.name)}</span><span class="count">${g.chats.length}</span><span class="ai-chevron" aria-hidden="true">›</span></button>${g.key === 'general' ? '' : `<button type="button" class="icon ai-gm" data-aide-gmenu="${esc(g.key)}" aria-haspopup="menu" aria-label="More for ${esc(g.name)}">⋯</button>`}</div>
      ${open ? `<ul class="ai-rows">${g.chats.map(c => `<li><button type="button" class="ai-row" data-aide-open="${esc(c.id)}" aria-current="${Aide.sel === c.id}" title="${esc(c.title)}"><span class="ai-row-copy"><span class="ai-rt">${esc(c.title)}</span><span class="ai-row-meta"><span class="ai-dot ${esc(c.provider)}" aria-hidden="true"></span>${esc(aideProvName(c.provider))}<span aria-hidden="true">·</span><span class="ai-ago">${esc(agoL(c.updated))}</span></span></span></button><button type="button" class="icon ai-rm" data-aide-rmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="More for ${esc(c.title)}">⋯</button></li>`).join('')}</ul>` : ''}
      ${open ? `<button type="button" class="ai-notes-link" data-aide-notes="${esc(g.key)}">${g.hasNotes ? 'Edit' : 'Add'} ${g.key === 'general' ? 'personal notes' : 'game notes'}</button>` : ''}
      ${open && !g.chats.length ? '<p class="ai-none">Nothing here yet.</p>' : ''}
    </div>`;
  }).join('') || '<p class="ai-none">Nothing matches.</p>';
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
  const foot = $('aideFoot');
  if (foot) foot.innerHTML = window.desktop ? `${aideKeyBusy('aideKey') ? `<button type="button" class="ai-busy" data-aide-setup>Another program has ${esc(keyWords(aideKey('aideKey')))}. Choose another key</button>` : `<span>${keyCaps(aideKey('aideKey'))} ask</span>`}<span>${keyCaps(aideKey('aideLookKey'))} ask about the screen</span>` : '<span>The key and the see-through panel are in the installed app.</span>';
}
function renderAideMain() {
  const box = $('aideMain'); if (!box) return;
  $('aidePage').classList.toggle('ai-has-chat', !!Aide.sel);
  const group = aideGroups().find(g => g.key === aideNewGroup());
  $('aideContext').textContent = group ? group.name : 'General';
  $('aideNew').setAttribute('aria-label', `New question in ${group ? group.name : 'General'}`);
  $('aideNew').title = `New question in ${group ? group.name : 'General'}`;
  $('aideNew').disabled = !!Aide.newOpening;
  $('aideNew').textContent = Aide.newOpening ? 'Opening…' : 'New question';
  if (Aide.frame && document.contains(Aide.frame)) Aide.frame.hidden = !Aide.sel;
  let empty = $('aideEmpty');
  if (Aide.sel) { if (empty) empty.remove(); return; }
  if (!empty) { box.insertAdjacentHTML('beforeend', '<div class="ai-empty" id="aideEmpty"></div>'); empty = $('aideEmpty'); }
  const any = aideChats().length > 0;
  empty.innerHTML = `<div class="ai-empty-in"><span class="ai-mark" aria-hidden="true">◈</span>
    <h2>${any ? 'Pick a chat, or ask something new.' : 'Ask anything, over anything.'}</h2>
    ${window.desktop ? `<div class="ai-keys">
      <div class="ai-key">${keyCaps(aideKey('aideKey'))}<p>Brings up a see-through box over whatever you’re doing. Ask, get the answer, and <kbd class="ak">Esc</kbd> puts you straight back.</p></div>
      <div class="ai-key">${keyCaps(aideKey('aideLookKey'))}<p>The same, with a picture of your screen attached, so you can just ask “what is this?”</p></div>
    </div><p class="ai-note">It sees your screen only when you ask it to. What’s asked in a game is kept under that game; everything else goes in General.</p>`
    : '<p class="ai-note">The key and the see-through box are in the installed desktop app. You can ask from here too.</p>'}
    <button type="button" class="btn prime" data-aide="new">New question</button></div>`;
}
// The chat beside the list: one frame, kept, so going from chat to chat is immediate.
function aideFrame() {
  if (Aide.frame && document.contains(Aide.frame)) return Aide.frame;
  const f = document.createElement('iframe');
  f.className = 'ai-frame'; f.title = 'The chat'; f.src = '/?solo=1&aidepane=1'; f.hidden = !Aide.sel;
  $('aideMain').appendChild(f);
  Aide.frame = f;
  return f;
}
const aideFrameReady = async f => { for (let i = 0; i < 600; i++) { try { if (f.contentWindow && f.contentWindow.aideBooted) return f.contentWindow; } catch { /* still loading */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('The chat didn’t open.'); };
async function aideSelect(id, title = null) {
  Aide.sel = id;
  if (S.view !== 'aide') await go('aide');
  renderAideGroups(); renderAideMain();
  const w = await aideFrameReady(aideFrame());
  if (Aide.sel !== id) return;
  const row = aideChats().find(c => c.id === id);
  await w.ChatUI.open({ sessionId: id, provider: row ? row.provider : null });
  try {
    w.document.getElementById('cTitle').textContent = title || (row && row.title) || 'A question';
    w.document.getElementById('cText').placeholder = 'Ask anything…';
  } catch { /* it moved on */ }
}
const aideNewGroup = () => (aideChats().find(c => c.id === Aide.sel) || {}).group || (Aide.sel && Aide.pageGroup) || 'general';
async function aideNew() {
  if (Aide.newOpening) return;
  const group = aideNewGroup();
  const previous = Aide.sel;
  Aide.newOpening = true;
  Aide.pageGroup = group;
  try {
    if (S.view !== 'aide') await go('aide');
    Aide.sel = 'new';
    renderAideGroups(); renderAideMain();
    const w = await aideFrameReady(aideFrame());
    if (Aide.sel !== 'new' || S.view !== 'aide') return;
    const r = await api('/api/aide/open', { group, fresh: true, who: S.aide.who, account: aideAccount() });
    if (Aide.sel !== 'new' || S.view !== 'aide') return;
    await w.ChatUI.openKey(r.key);
    if (Aide.sel !== 'new' || S.view !== 'aide') return;
    try { w.document.getElementById('cText').placeholder = 'Ask anything…'; w.document.getElementById('cText').focus(); } catch { /* it moved on */ }
    Aide.sel = r.sessionId || 'new';
  } catch (err) {
    if (Aide.sel === 'new') Aide.sel = previous;
    throw err;
  } finally {
    Aide.newOpening = false;
    if (S.view === 'aide') { renderAideGroups(); renderAideMain(); }
  }
}
// Whichever of your Claude accounts has the most left.
function aideAccount() {
  let best = null, left = -1;
  for (const a of S.accounts || []) {
    if (!canLaunch(a)) continue;
    const b = binding(usageOf(a.id)), l = b ? b.left : 50;
    if (l > left) { left = l; best = a; }
  }
  return (best || current() || {}).id;
}

document.addEventListener('click', wrap(async e => {
  const t = e.target.closest('[data-aide-open],[data-aide-fold],[data-aide],[data-aide-gmenu],[data-aide-rmenu]');
  if (!t) return;
  const d = t.dataset;
  if (d.aideOpen) return aideSelect(d.aideOpen);
  if (d.aideFold) { if (Aide.fold.has(d.aideFold)) Aide.fold.delete(d.aideFold); else Aide.fold.add(d.aideFold); return renderAideGroups(); }
  if (d.aide === 'new') return aideNew();
  if (d.aide === 'list') { Aide.sel = null; Aide.pageGroup = null; renderAideGroups(); renderAideMain(); $('aideQ').focus(); return; }
  if (d.aideGmenu) {
    const g = aideGroups().find(x => x.key === d.aideGmenu); if (!g) return undefined;
    return showMenu(t, [{ label: 'Rename', run: async () => {
      const name = await ask('Rename', 'What should this group be called?', g.name, 'Rename', { maxLength: 50 });
      if (name && name.trim()) { S.aide = await api('/api/aide/rename', { group: g.key, name }); aideRefresh(); }
    } }]);
  }
  if (d.aideRmenu) {
    const c = aideChats().find(x => x.id === d.aideRmenu); if (!c) return undefined;
    const others = aideGroups().filter(g => g.key !== c.group);
    return showMenu(t, [
      ...others.map(g => ({ label: `Move to ${g.name}`, run: async () => { S.aide = await api('/api/aide/move', { id: c.id, group: g.key }); aideRefresh(); } })),
      ...(others.length ? ['-'] : []),
      { label: 'Remove from this list', hint: 'it won’t show here any more', run: async () => { S.aide = await api('/api/aide/forget', { id: c.id }); if (Aide.sel === c.id) Aide.sel = null; aideRefresh(); } },
    ]);
  }
  return undefined;
}));
document.addEventListener('input', e => { if (e.target.id === 'aideQ') { Aide.q = e.target.value; renderAideGroups(); } });
function aideRefresh() {
  if (AIDE_PANEL) { aideAlpha(); renderAidePick(); if (Aide.drawer === 'recent') renderAideRecent(); return; }
  if (SOLO) return;
  // Turned on, or known only now: the hub gains its section.
  if (S.view === 'hub' && $('page') && !sagaLook() && aideOn() !== !!$('secCompanion') && $('hubJump')) renderHub();
  renderNav(); renderAideHub();
  if (S.view === 'aide' && $('aidePage')) { renderAideGroups(); renderAideMain(); }
  if (typeof renderJump === 'function' && S.view === 'hub') renderJump();
}

/* ---------- the panel ---------- */
const AIDE_CARET = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function aidePanelInit() {
  document.body.classList.add('aide-panel');
  document.title = 'Companion';
  const main = document.querySelector('#chat .c-main');
  main.insertAdjacentHTML('afterbegin', `<header class="ao-bar" id="aoBar">
    <button type="button" class="ao-who" id="aoBrowse" data-ao="browse" aria-expanded="false" aria-controls="aoDrawer" title="Recent questions and saved notes"><span class="ao-tile" id="aoTile"></span><span class="ao-name" id="aoName">Companion</span><span class="ao-down" aria-hidden="true">${AIDE_CARET}</span></button>
    <span class="ao-room" id="aoRoom"></span>
    <span class="ao-pinhint" id="aoPinHint" hidden></span>
    <span class="ao-acts">
      <button type="button" class="ao-b" data-ao="center" id="aoCenter" hidden title="Back to the middle of the screen" aria-label="Back to the middle of the screen"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="currentColor"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
      <button type="button" class="ao-b" data-ao="new" title="A new question" aria-label="A new question"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <button type="button" class="ao-b" data-ao="app" title="Open this chat in the app" aria-label="Open this chat in the app"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3H3.8A.8.8 0 0 0 3 3.8v8.4c0 .44.36.8.8.8h8.4a.8.8 0 0 0 .8-.8V9.5M9.5 3H13v3.5M13 3 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="ao-b" data-ao="pin" id="aoPin" aria-pressed="false" title="Keep the answer on screen while you play: clicks go through to your game" aria-label="Keep the answer on screen"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 2.2 13.8 6.4l-1.5.4-2.5 2.5-.1 2.6-1 1-2.1-2.1-3 3 3-3-2.1-2.1 1-1 2.6-.1 2.5-2.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>
      <button type="button" class="ao-b" data-ao="hide" title="Put away (Esc)" aria-label="Put away"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    </span>
  </header>`);
  $('aoBar').insertAdjacentHTML('afterend', '<section class="ao-drawer" id="aoDrawer" aria-label="Questions and notes" hidden></section>');
  for (const [cls, x] of [['l', 'left'], ['r', 'right'], ['b', 'bottom']]) document.body.insertAdjacentHTML('beforeend', `<div class="ao-grip ${cls}" data-grip="${x}" aria-hidden="true"></div>`);
  const row = document.querySelector('#cCompose .c-row');
  row.insertAdjacentHTML('afterbegin', `<button type="button" class="ao-look" id="aoLook" title="Attach a picture of your screen (${esc(keyWords(aideKey('aideLookKey')))})"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="7.5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 14.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>Look at screen</span></button><div class="ao-pick" id="aoPick"><button type="button" class="ao-model" id="aoModel" data-ao="models" aria-haspopup="true" aria-expanded="false" aria-controls="aoModels"><span class="ao-mdot" id="aoMDot" aria-hidden="true"></span><span class="ao-mname" id="aoMName">…</span><span class="ao-meff" id="aoMEff"></span><span class="ao-mcaret" aria-hidden="true">${AIDE_CARET}</span></button></div>`);
  $('aoLook').insertAdjacentHTML('afterend', `<button type="button" class="ao-look-more" id="aoLookMore" data-ao="capture-menu" aria-label="Screen capture options" aria-haspopup="menu" title="Choose a region or the whole screen">${AIDE_CARET}</button>`);
  $('cCompose').insertAdjacentHTML('afterend', '<div class="ao-models" id="aoModels" role="group" aria-label="Who answers" hidden></div>');
  aideModelsInit();
  $('chat').hidden = false;
  $('cText').placeholder = 'Ask anything…';
  $('cText').setAttribute('aria-label', 'Ask anything');
  $('cText').addEventListener('input', () => { if (Aide.opening) Aide.typed = $('cText').value; });
  // Sent before the chat's there: it goes as soon as it is.
  $('cCompose').addEventListener('submit', e => { if (Aide.opening || !C.key) { e.preventDefault(); e.stopImmediatePropagation(); Aide.sendAfter = true; } }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'cText' && (Aide.opening || !C.key)) { e.preventDefault(); e.stopImmediatePropagation(); Aide.sendAfter = true; return; }
    if (e.key !== 'Escape') return;
    if (aideCloseModels(true)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (Aide.drawer) { e.preventDefault(); e.stopImmediatePropagation(); aideCloseDrawer(); return; }
    // Esc closes what's open inside first; otherwise it puts the panel away, whatever's being written.
    const inner = !$c('cLight').hidden || !$('menu').hidden || document.querySelector('dialog[open]') || !$c('cPick').hidden || !$c('cFind').hidden || !$c('cSlash').hidden;
    if (inner) return;
    e.preventDefault(); e.stopImmediatePropagation();
    aideAsk('hide');
  }, true);
  document.addEventListener('click', wrap(aidePanelClick));
  aideGrips();
  const again = () => aideFitSoon();
  new ResizeObserver(again).observe($('cFeed'));
  new ResizeObserver(again).observe($('cCompose'));
  new MutationObserver(again).observe($('cFeed'), { childList: true, subtree: true, characterData: true });
  setInterval(aideRoomLine, 10000);
}
const aideAlpha = () => document.documentElement.style.setProperty('--aide-alpha', String((S.aide && S.aide.alpha) || 100));
const aideAsk = (what, v) => (window.desktop && window.desktop.aide ? window.desktop.aide.ask(what, v) : Promise.resolve(null));
/* Who answers: a button with the model's name, and under it every model of every assistant you're signed
   in to, by its real name. The ones used most are offered first (Claude's Opus and Fable, the newest of
   the others); the rest are under More. Another model of the same assistant carries on the same
   conversation; another assistant opens its own chat in the same group, what you've written coming along. */
const EFFORT_NAME = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
const aideSplitWho = who => { const m = /^(claude|codex|gemini)(?::(.*))?$/.exec(String(who || '')); return m ? { provider: m[1], model: m[2] || null } : { provider: 'claude', model: 'opus' }; };
const aideAssistant = p => ((S.aide && S.aide.assistants) || []).find(a => a.provider === p) || null;
// The model a choice stands for: when it names none, its assistant's usual one.
function aideModelOf(provider, model) {
  const ms = (aideAssistant(provider) || { models: [] }).models;
  return ms.find(m => m.value === (model || '')) || (!model ? ms.find(m => m.isDefault) || ms[0] : null) || null;
}
const aideSameWho = (a, b) => { const x = aideSplitWho(a), y = aideSplitWho(b), mx = aideModelOf(x.provider, x.model), my = aideModelOf(y.provider, y.model); return x.provider === y.provider && (mx && my ? mx.value === my.value : x.model === y.model); };
// The open chat's own model once it has said; until then, who was chosen.
function aideCurrent() {
  const mi = C.key && C.mi && C.mi.main;
  // (Claude's resolved model is a full id, not one of the names in its list.)
  if (mi && C.provider && (mi.model || mi.resolvedModel)) return { provider: C.provider, model: mi.model || (C.provider === 'claude' ? null : mi.resolvedModel) || null, effort: mi.effort || null, mi };
  return { ...aideSplitWho(Aide.who), effort: null, mi: null };
}
function aideModelsInit() {
  const box = $('aoModels');
  const note = text => { const n = $('aoMNote'); if (n) n.textContent = text; };
  const own = () => { const cur = aideCurrent(), m = aideModelOf(cur.provider, cur.model); return (m && m.note) || ''; };
  box.addEventListener('mouseover', e => { const c = e.target.closest('[data-ao-model]'); note(c ? c.dataset.note || '' : own()); });
  box.addEventListener('focusin', e => { const c = e.target.closest('[data-ao-model]'); if (c) note(c.dataset.note || ''); });
  box.addEventListener('mouseleave', () => note(own()));
  // The arrow keys go from one choice to the next.
  box.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const all = [...box.querySelectorAll('button')], i = all.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    all[(n + all.length) % all.length].focus();
  });
  document.addEventListener('mousedown', e => { if (!box.hidden && !e.target.closest('#aoModels, #aoModel')) aideCloseModels(); });
  $('cText').addEventListener('focus', () => aideCloseModels());
  // The chat says when its model or effort changes.
  new MutationObserver(() => renderAidePick()).observe($('cModel'), { childList: true, characterData: true, subtree: true });
}
function renderAidePick() {
  const btn = $('aoModel'); if (!btn || !S.aide) return;
  const cur = aideCurrent(), a = aideAssistant(cur.provider), m = aideModelOf(cur.provider, cur.model);
  const anyOk = (S.aide.assistants || []).some(x => x.ok), usable = !!(a && a.ok);
  const name = usable ? (cur.mi && modelLabel(cur.mi)) || (m && m.label) || a.name : anyOk ? 'Choose a model' : 'Sign in…';
  const effort = usable && cur.effort ? EFFORT_NAME[cur.effort] || cur.effort : '';
  $('aoMName').textContent = name;
  $('aoMEff').textContent = effort;
  $('aoMDot').className = `ao-mdot${usable ? ` ${cur.provider}` : ''}`;
  btn.disabled = !anyOk || Aide.opening;
  btn.title = usable ? `Who answers: ${a.name}, ${name}${effort ? `, ${effort.toLowerCase()} effort` : ''}` : 'Choose an assistant you’re signed in to';
  btn.setAttribute('aria-label', btn.title);
  if (!$('aoModels').hidden) renderAideModels();
}
function renderAideModels() {
  const box = $('aoModels'); if (!box || !S.aide) return;
  const cur = aideCurrent(), curM = aideModelOf(cur.provider, cur.model);
  const rows = (S.aide.assistants || []).filter(a => a.ok);
  const isCur = (a, m) => a.provider === cur.provider && !!curM && m.value === curM.value;
  const chip = (a, m) => `<button type="button" class="ao-chip" data-ao-model="${esc(m.value)}" data-prov="${esc(a.provider)}" data-note="${esc(m.note)}" aria-pressed="${isCur(a, m)}">${esc(m.label)}</button>`;
  const list = rows.map(a => `<div class="ao-mrow" role="group" aria-label="${esc(a.name)}"><span class="ao-mprov">${esc(a.name)}</span><div class="ao-mchips">${a.models.filter(m => m.top || Aide.moreModels || isCur(a, m)).map(m => chip(a, m)).join('')}</div></div>`).join('');
  // Effort, for the model answering now. (Gemini's is part of its models' names.)
  const mi = cur.mi, live = mi && (mi.models || []).find(x => x.value === mi.model);
  const efforts = mi ? (live && live.efforts && live.efforts.length ? live.efforts : mi.efforts) || [] : [];
  const eff = efforts.length ? `<div class="ao-mrow ao-erow" role="group" aria-label="Effort"><span class="ao-mprov">Effort</span><div class="ao-mchips">${efforts.map(e => `<button type="button" class="ao-chip" data-ao-effort="${esc(e)}" aria-pressed="${e === mi.effort}">${esc(EFFORT_NAME[e] || e)}</button>`).join('')}</div></div>` : '';
  const more = rows.some(a => a.models.some(m => !m.top));
  const h = rows.length ? `${list}${eff}<div class="ao-mfoot"><span class="ao-mnote" id="aoMNote">${esc((curM && curM.note) || '')}</span>${more ? `<button type="button" class="ao-more" data-ao="more-models" aria-expanded="${!!Aide.moreModels}">${Aide.moreModels ? 'Fewer models' : 'More models'}</button>` : ''}</div>`
    : '<p class="ao-quiet">Sign in to Claude, Codex or Gemini in Setup to ask here.</p>';
  if (box._h !== h) { box.innerHTML = h; box._h = h; }
}
function aideOpenModels() {
  const box = $('aoModels');
  renderAideModels();
  box.hidden = false;
  $('aoModel').setAttribute('aria-expanded', 'true');
  aideFitSoon();
  (box.querySelector('.ao-chip[aria-pressed="true"]') || box.querySelector('button'))?.focus({ preventScroll: true });
}
function aideCloseModels(focus = false) {
  const box = $('aoModels');
  if (!box || box.hidden) return false;
  box.hidden = true;
  $('aoModel').setAttribute('aria-expanded', 'false');
  aideFitSoon();
  if (focus) $('cText').focus();
  return true;
}
async function aidePickModel(provider, value) {
  const who = value ? `${provider}:${value}` : provider;
  aideCloseModels();
  const cur = aideCurrent(), curM = aideModelOf(cur.provider, cur.model);
  if (provider === cur.provider && curM && curM.value === value) { $('cText').focus(); return; }
  if (Aide.opening) return;
  if (value && C.key && C.provider === provider && C.state !== 'ended') {
    await pickModel('main', { model: value });
    Aide.who = who; renderAidePick();
    api('/api/aide/settings', { who }).catch(() => {});
  } else if (await aidePanelOpen({ who, ...(Aide.group ? { group: Aide.group.key } : {}) })) api('/api/aide/settings', { who }).catch(() => {});
  $('cText').focus();
}
async function aidePickEffort(effort) {
  aideCloseModels();
  if (C.key) await pickModel('main', { effort });
  renderAidePick();
  $('cText').focus();
}
function aideRoomLine() {
  const el = $('aoRoom'); if (!el) return;
  const prov = (C.info && C.info.provider) || 'claude';
  const b = prov === 'claude' ? binding(usageOf((C.info && C.info.accountId) || aideAccount())) : null;
  el.innerHTML = b ? `<span class="ao-ring" style="--p:${Math.round(b.left)}" aria-hidden="true"></span><span>${Math.round(b.left)}% left</span>` : '';
  el.title = b ? 'How much is left on this account' : '';
}
function aideBarLine() {
  const g = Aide.group || { key: 'general', name: 'General' };
  $('aoTile').innerHTML = aideTile(g, 22);
  $('aoName').textContent = g.name;
  $('aoName').title = (C.info && C.title) || g.name;
  aideRoomLine();
}
// Opens the chat this belongs to; what you've typed and attached comes along.
async function aidePanelOpen({ fresh = false, group = null, who = null, sessionId = null, carryDraft = true } = {}) {
  if (Aide.opening) return false;
  const seq = ++Aide.seq;
  Aide.opening = true;
  let opened = false;
  $('aoModel').disabled = true;
  try {
    if (!S.aide) await loadAide();
    const r = await api('/api/aide/open', { app: Aide.app, fresh, ...(group ? { group } : {}), ...(sessionId ? { sessionId } : {}), who: who || Aide.who, account: aideAccount() });
    if (seq !== Aide.seq) return;
    if (C.key !== r.key) {
      // What's been typed or attached so far stays in the box, including while this chat opens.
      const shots = carryDraft ? (C.attachments || []).slice() : [];
      Aide.typed = carryDraft ? $('cText').value : '';
      await ChatUI.openKey(r.key);
      if (Aide.typed && $('cText').value !== Aide.typed) { $('cText').value = Aide.typed; $('cText').dispatchEvent(new Event('input', { bubbles: true })); }
      if (shots.length) { C.attachments = [...shots, ...(C.attachments || []).filter(a => !shots.some(s => s.data === a.data && s.mediaType === a.mediaType))]; renderAttachments(); }
    }
    Aide.group = r.group;
    Aide.who = r.who || who || Aide.who;
    opened = true;
    $('cText').placeholder = 'Ask anything…';
    aideBarLine(); renderAidePick();
    // (Who's signed in is only known a moment after the app starts.)
    loadAide().then(() => { renderAidePick(); aideAlpha(); }).catch(() => {});
  } catch (err) { toast(err.message, 7000); } finally {
    if (seq === Aide.seq) {
      Aide.opening = false;
      renderAidePick();
      aideFit();
      if (Aide.sendAfter) { Aide.sendAfter = false; if (opened && C.key) wrap(sendMessage)(); }
    }
  }
  return opened;
}
function aideAttachShot(r) {
  if (!r) return;
  if (r.error) { toast(r.error, 7000); return; }
  if (r.black) { toast('That came back black: this game is in true fullscreen or blocks being captured. In its settings, borderless windowed usually works.', 9000); return; }
  C.attachments = [...(C.attachments || []), { mediaType: r.mediaType, data: r.data }];
  renderAttachments();
  aideFitSoon();
}
async function aideCapture(region) {
  if (Aide.shotBusy) return;
  Aide.shotBusy = true;
  const key = C.key;
  $('aoLook').disabled = $('aoLookMore').disabled = true;
  try {
    const r = await aideAsk(region ? 'region' : 'look');
    if (key === C.key) aideAttachShot(r);
    else if (r && r.data) toast('The conversation changed. Capture again to attach it here.');
  } finally {
    Aide.shotBusy = false;
    $('aoLook').disabled = $('aoLookMore').disabled = false;
    $('cText').focus();
  }
}

/* Recent questions and a small notebook, kept out of the way until the game name is opened. */
function aideCloseDrawer(focus = true) {
  Aide.drawer = null;
  if (!$('aoDrawer')) return;
  $('aoDrawer').hidden = true;
  $('aoBrowse').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('ao-drawer-open');
  aideFitSoon();
  if (focus) $('cText').focus();
}
async function aideOpenDrawer(tab) {
  const g = Aide.group || { key: 'general', name: 'General' };
  aideCloseModels();
  Aide.drawer = tab;
  const box = $('aoDrawer');
  box.hidden = false;
  document.body.classList.add('ao-drawer-open');
  $('aoBrowse').setAttribute('aria-expanded', 'true');
  box.innerHTML = `<div class="ao-drawer-head"><div class="ao-tabs" aria-label="Questions and notes"><button type="button" data-aide-tab="recent" aria-pressed="${tab === 'recent'}">Recent questions</button><button type="button" data-aide-tab="notes" aria-pressed="${tab === 'notes'}">${g.key === 'general' ? 'Personal notes' : 'Game notes'}</button></div><button type="button" class="ao-back" data-aide-back>Back to chat</button></div><div class="ao-drawer-body" id="aoDrawerBody"></div>`;
  if (tab === 'recent') {
    $('aoDrawerBody').innerHTML = `<input type="search" id="aoRecentQ" placeholder="Find a question or game" aria-label="Find a question or game" autocomplete="off" value="${esc(Aide.recentQ)}"><div id="aoRecentList" class="ao-recent-list"></div><div class="ao-recent-foot"><button type="button" data-ao="new">New question in ${esc(g.name)}</button><button type="button" data-ao="app">All questions in the app ↗</button></div>`;
    renderAideRecent();
    $('aoRecentQ').focus();
    loadAide().then(() => { if (Aide.drawer === 'recent') renderAideRecent(); }).catch(() => {});
  } else {
    aideRenderNotes(g, $('aoDrawerBody'));
    await aideLoadNotes(g.key);
    if (Aide.drawer === 'notes' && $('aiNoteText')) $('aiNoteText').focus();
  }
  aideFitSoon();
}
function renderAideRecent() {
  const box = $('aoRecentList'); if (!box) return;
  const q = Aide.recentQ.trim().toLowerCase(), group = Aide.group && Aide.group.key;
  const rows = aideChats().filter(c => !q || `${c.title} ${c.groupName} ${aideProvName(c.provider)}`.toLowerCase().includes(q));
  rows.sort((a, b) => Number(b.group === group) - Number(a.group === group) || b.updated - a.updated);
  box.innerHTML = rows.slice(0, 30).map(c => `<button type="button" class="ao-recent-row" data-aide-recent="${esc(c.id)}" aria-current="${C.sessionId === c.id}"><span>${esc(c.title)}</span><small>${esc(c.groupName)} · ${esc(aideProvName(c.provider))} · ${esc(agoL(c.updated))}${C.sessionId === c.id ? ' · Current' : ''}</small></button>`).join('') || `<p class="ao-quiet">${q ? 'No matching questions.' : 'Your questions will appear here.'}</p>`;
}
function aideNotebook(key) {
  if (!Aide.notebooks.has(key)) Aide.notebooks.set(key, { text: '', saved: '', version: 0, loaded: false, busy: false, error: '' });
  return Aide.notebooks.get(key);
}
function aideRenderNotes(g, host) {
  const n = aideNotebook(g.key);
  host.innerHTML = `<div class="ai-notebook" id="aiNotebook" data-group="${esc(g.key)}"><label for="aiNoteText">${esc(g.name)} · ${g.key === 'general' ? 'personal notes' : 'game notes'}</label><p>Shared with whichever assistant answers here. Save your changes to use them with the next question.</p><textarea id="aiNoteText" maxlength="6000" spellcheck="true" placeholder="${g.key === 'general' ? 'Preferences, interests, or context you want to keep…' : 'Current objective, build, platform, and how much you want revealed…'}">${esc(n.text)}</textarea><div class="ai-note-status"><span id="aiNoteStatus" role="status" aria-live="polite"></span><span id="aiNoteCount"></span></div><div class="ai-note-actions"><button type="button" id="aiNoteSave" data-aide-note-save>Save notes</button><button type="button" data-aide-note-reload>Load saved version</button></div></div>`;
  aideNoteStatus(g.key);
}
function aideNoteStatus(key) {
  const host = $('aiNotebook'); if (!host || host.dataset.group !== key) return;
  const n = aideNotebook(key), dirty = n.text !== n.saved;
  $('aiNoteStatus').textContent = n.error || (n.busy ? 'Saving…' : !n.loaded ? 'Loading…' : dirty ? 'Unsaved changes' : n.text ? 'Saved · used with your next question' : 'No saved notes');
  $('aiNoteCount').textContent = `${n.text.length.toLocaleString()} / 6,000`;
  $('aiNoteSave').disabled = !n.loaded || n.busy || !dirty;
  const reload = host.querySelector('[data-aide-note-reload]');
  reload.disabled = n.busy;
  reload.hidden = !n.error && (!n.loaded || !dirty);
  reload.textContent = !n.loaded ? 'Try again' : n.error ? 'Load saved version' : 'Discard edits';
}
async function aideLoadNotes(key, reload = false) {
  const n = aideNotebook(key);
  if (n.busy || (!reload && n.loaded && n.text !== n.saved)) { aideNoteStatus(key); return; }
  const seq = n.seq = (n.seq || 0) + 1, typed = n.text;
  try {
    const r = await api(`/api/aide/notes?group=${encodeURIComponent(key)}`);
    if (seq !== n.seq) return;
    n.saved = r.text; n.version = r.version; n.loaded = true; n.error = '';
    // Typing while the fetch was in flight wins; loading never erases a draft.
    if (n.text === typed) n.text = r.text;
    const host = $('aiNotebook');
    if (host && host.dataset.group === key) $('aiNoteText').value = n.text;
  } catch (err) { if (seq === n.seq) n.error = err.message; }
  aideNoteStatus(key);
}
async function aideSaveNotes(key) {
  const n = aideNotebook(key); if (!n.loaded || n.busy || n.text === n.saved) return;
  n.busy = true; n.error = ''; ++n.seq;
  const text = n.text;
  aideNoteStatus(key);
  try {
    const r = await api('/api/aide/notes', { group: key, text, version: n.version });
    n.saved = r.text; n.version = r.version;
    loadAide().then(aideRefresh).catch(() => {});
  } catch (err) { n.error = err.message; }
  finally { n.busy = false; aideNoteStatus(key); }
}
async function aideNotesDialog(key) {
  const g = aideGroups().find(x => x.key === key); if (!g) return;
  let d = $('aiNotesDialog');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'aiNotesDialog'; d.className = 'ai-notes-dialog';
    d.setAttribute('aria-label', 'Companion notes'); document.body.appendChild(d);
  }
  d.innerHTML = '<div id="aiNotesDialogBody"></div><form method="dialog"><button class="btn" type="submit">Close</button></form>';
  aideRenderNotes(g, $('aiNotesDialogBody'));
  d.showModal();
  await aideLoadNotes(key);
}
document.addEventListener('input', e => {
  if (e.target.id === 'aoRecentQ') { Aide.recentQ = e.target.value; renderAideRecent(); }
  if (e.target.id === 'aiNoteText') {
    const key = $('aiNotebook').dataset.group, n = aideNotebook(key);
    n.text = e.target.value; n.error = ''; aideNoteStatus(key);
  }
});
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('[data-aide-tab],[data-aide-back],[data-aide-recent],[data-aide-notes],[data-aide-note-save],[data-aide-note-reload]');
  if (!b) return;
  const d = b.dataset;
  if (d.aideTab) return aideOpenDrawer(d.aideTab);
  if ('aideBack' in d) return aideCloseDrawer();
  if (d.aideRecent) {
    if (Aide.opening) return;
    b.disabled = true;
    try { if (await aidePanelOpen({ sessionId: d.aideRecent, carryDraft: false })) aideCloseDrawer(); }
    finally { if (document.contains(b)) b.disabled = false; }
  }
  if (d.aideNotes) return aideNotesDialog(d.aideNotes);
  if ('aideNoteSave' in d) return aideSaveNotes($('aiNotebook').dataset.group);
  if ('aideNoteReload' in d) return aideLoadNotes($('aiNotebook').dataset.group, true);
  return undefined;
}));
async function aidePanelClick(e) {
  const look = e.target.closest('#aoLook');
  if (look) { await aideCapture(false); return; }
  const mc = e.target.closest('[data-ao-model]'); if (mc) { await aidePickModel(mc.dataset.prov, mc.dataset.aoModel); return; }
  const ec = e.target.closest('[data-ao-effort]'); if (ec) { await aidePickEffort(ec.dataset.aoEffort); return; }
  const b = e.target.closest('[data-ao]'); if (!b) return;
  const what = b.dataset.ao;
  if (what === 'models') { if ($('aoModels').hidden) aideOpenModels(); else aideCloseModels(true); }
  if (what === 'more-models') { Aide.moreModels = !Aide.moreModels; renderAideModels(); aideFitSoon(); $('aoModels').querySelector('[data-ao="more-models"]')?.focus(); }
  if (what === 'hide') aideAsk('hide');
  if (what === 'browse') { if (Aide.drawer) aideCloseDrawer(); else await aideOpenDrawer('recent'); }
  if (what === 'capture-menu') showMenu(b, [{ label: 'Whole screen', run: () => aideCapture(false) }, { label: 'Choose a region…', run: () => aideCapture(true) }]);
  if (what === 'center') { await aideAsk('center'); $('cText').focus(); }
  if (what === 'pin') { aideCloseDrawer(false); aideCloseModels(); aideAsk('pin', true); }
  if (what === 'app') aideAsk('openInApp', C.sessionId || null);
  if (what === 'new') { if (await aidePanelOpen({ fresh: true, carryDraft: false, ...(Aide.group ? { group: Aide.group.key } : {}) })) aideCloseDrawer(); }
}
// The panel's height follows what's in it, so a short answer stays a small box.
let aideFitTimer = null;
function aideFitSoon() { if (!aideFitTimer) aideFitTimer = setTimeout(() => { aideFitTimer = null; aideFit(); }, 70); }
function aideFit() {
  if (!AIDE_PANEL) return;
  const feed = $('cFeed'), scroll = $('cScroll');
  const empty = !feed.querySelector(':scope > :not(.c-earlier):not(.c-welcome):not([hidden])');
  document.body.classList.toggle('ao-empty', empty);
  const z = feed.getBoundingClientRect().width / (feed.offsetWidth || 1) || 1;
  const inner = $('aoBar').offsetHeight + (Aide.drawer ? 390 : (Aide.pinned ? 0 : document.querySelector('.c-dock').offsetHeight) + (empty ? 0 : Math.min(feed.scrollHeight, 4000)));
  const h = Math.ceil((inner + 2) * z) + 24;    // the panel's outer inset
  aideAsk('size', h);
  if (!empty && scroll.dataset.stuck !== 'no') scroll.scrollTop = scroll.scrollHeight;
}
// Dragging an edge: wider from either side, and how tall it may grow from the bottom.
function aideGrips() {
  let drag = null;
  document.addEventListener('pointerdown', async e => {
    const g = e.target.closest('[data-grip]'); if (!g) return;
    e.preventDefault();
    const b = await aideAsk('bounds'); if (!b) return;
    drag = { side: g.dataset.grip, x: e.screenX, y: e.screenY, b };
    g.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y, b = drag.b;
    if (drag.side === 'right') aideAsk('resize', { width: b.width + dx });
    if (drag.side === 'left') aideAsk('resize', { width: b.width - dx, x: b.x + dx });
    if (drag.side === 'bottom') { aideAsk('resize', { maxH: b.height + dy }); aideAsk('size', b.height + dy); }
  });
  document.addEventListener('pointerup', () => { drag = null; });
}
if (AIDE_PANEL) {
  aidePanelInit();
  if (window.desktop && window.desktop.aide) {
    const a = window.desktop.aide;
    a.onShow(v => {
      Aide.app = v.app; Aide.moved = !!v.moved;
      $('aoCenter').hidden = !Aide.moved;
      aideAlpha();
      $('cText').focus();
      // A deliberately selected older question stays selected on the next visit to this game.
      const previous = Aide.appGroup, nextApp = JSON.stringify(v.app || null);
      Aide.appGroup = nextApp;
      if (C.key && previous === nextApp && C.state !== 'ended') return;
      wrap(async () => { aideCloseDrawer(false); await aidePanelOpen({ carryDraft: !C.key }); })();
    });
    a.onShot(aideAttachShot);
    a.onHidden(() => { Aide.pinned = false; aideCloseModels(); });
    a.onMoved(m => { Aide.moved = !!m; $('aoCenter').hidden = !m; });
    a.onPinned(on => {
      Aide.pinned = !!on;
      document.body.classList.toggle('ao-pinned', Aide.pinned);
      $('aoPin').setAttribute('aria-pressed', String(Aide.pinned));
      $('aoPinHint').hidden = !Aide.pinned;
      $('aoPinHint').innerHTML = Aide.pinned ? `${esc(keyWords(aideKey('aideKey')))} to bring it back` : '';
      aideFit();
      if (!Aide.pinned) $('cText').focus();
    });
  }
}
if (AIDE_PANE) document.body.classList.add('aide-pane');

// Once the page's data has loaded (ui/events.js).
async function aideBoot() {
  await loadAide().catch(() => null);
  await aideLoadKeys();
  if (AIDE_PANEL) {
    aideAlpha();
    renderAidePick(); aideBarLine(); aideFit();
    aideAsk('ready');
  } else if (!SOLO) {
    // The desktop app starts with what it last knew; the page has the last word.
    if (window.desktop && Aide.keys && S.aide && !!Aide.keys.on !== !!S.aide.on) window.desktop.set({ aideOn: !!S.aide.on }).catch(() => {});
    aideRefresh();
  }
  window.aideBooted = true;
}

/* ---------- Setup → Companion ---------- */
const aideSetupHtml = () => `<p class="d-h" id="st-companion">Companion</p><div class="prefs" id="aideBox"><p class="loading">Checking…</p></div>`;
async function loadAideBox() {
  if (!$('aideBox')) return;
  await Promise.all([loadAide().catch(() => null), aideLoadKeys()]);
  renderAideBox();
}
function renderAideBox() {
  const box = $('aideBox'); if (!box || !S.aide) return;
  const on = S.aide.on, desk = !!window.desktop;
  const capBtn = which => `<button type="button" class="ai-capture" data-aide-cap="${which}" aria-label="Change this key">${Aide.capturing === which ? '<span class="ai-capturing">Press the keys…</span>' : keyCaps(aideKey(which))}</button>`;
  const busyLine = which => (aideKeyBusy(which) ? `<div class="ai-busyline"><p><b>Another program on this computer has ${esc(keyWords(aideKey(which)))}</b>, so pressing it won’t bring Companion up. If it lets go (a game closing, say), Companion takes it by itself. Or use:</p><p class="ai-spare">${AIDE_SPARE[which].filter(k => k !== aideKey(which)).map(k => `<button type="button" class="btn sm" data-aide-spare="${which}" data-key="${esc(k)}">${esc(keyWords(k))}</button>`).join('')}</p></div>` : '');
  box.innerHTML = `<label class="toggle"><input type="checkbox" data-aideset="on" ${on ? 'checked' : ''}><span><b>Enable Companion</b><span>Quick questions, kept together by game${desk ? ', with a panel you can open from anywhere' : ''}. Uses your subscriptions. It can search the web, and it can’t touch your files or run anything.</span></span></label>
    ${on ? `${desk ? `<div class="ai-set"><div class="ai-set-r"><span><b>Ask</b><small>Brings it up from anywhere; again puts it away.</small></span>${capBtn('aideKey')}</div>${busyLine('aideKey')}
      <div class="ai-set-r"><span><b>Ask about the screen</b><small>The same, with a picture of your screen attached. It sees your screen only when you press this or Look at screen.</small></span>${capBtn('aideLookKey')}</div>${busyLine('aideLookKey')}</div>` : ''}
    <div class="ai-set"><div class="ai-set-r"><span><b>Who answers first</b><small>You can change it in the panel any time.</small></span><select data-aideset="who" aria-label="Who answers first">${(S.aide.assistants || []).map(a => `<optgroup label="${esc(a.name)}${a.ok ? '' : ' (not signed in)'}">${a.models.map(m => { const id = m.value ? `${a.provider}:${m.value}` : a.provider; return `<option value="${esc(id)}" ${aideSameWho(id, S.aide.who) ? 'selected' : ''} ${a.ok ? '' : 'disabled'}>${esc(m.label)}</option>`; }).join('')}</optgroup>`).join('')}</select></div>
    ${desk ? `<div class="ai-set-r"><span><b>Panel background</b><small>Lower shows more of your game. Higher makes text easier to read.</small></span><div class="ai-alpha"><input id="aideAlpha" type="range" min="55" max="100" step="1" value="${S.aide.alpha}" data-aideset="alpha" aria-label="Panel background opacity"><output id="aideAlphaValue" for="aideAlpha">${S.aide.alpha}%</output></div></div>` : ''}</div>
    <p class="pb-none">Pictures of your screen stay in that chat’s history on this computer, like any picture you paste, and go to the assistant you’re asking.</p>` : ''}`;
}
document.addEventListener('input', e => {
  if (e.target.id === 'aideAlpha' && $('aideAlphaValue')) $('aideAlphaValue').textContent = `${e.target.value}%`;
});
document.addEventListener('change', wrap(async e => {
  const b = e.target.closest('[data-aideset]'); if (!b) return;
  const what = b.dataset.aideset;
  const patch = what === 'on' ? { on: b.checked } : what === 'alpha' ? { alpha: Number(b.value) } : { who: b.value };
  S.aide = await api('/api/aide/settings', patch);
  if (what === 'who') Aide.who = S.aide.who;
  if (what === 'on') {
    if (window.desktop) {
      const r = await window.desktop.set({ aideOn: S.aide.on });
      await aideLoadKeys();
      if (S.aide.on && r && r.aideOk === false) { toast(`Companion is on, but another program has ${keyWords(aideKey('aideKey'))}. Choose another key below.`, 8000); renderAideBox(); aideRefresh(); return; }
    }
    if (!S.aide.on && S.view === 'aide') go('hub');
    if (S.view === 'hub') renderHub();
    toast(S.aide.on ? `Companion is on.${window.desktop ? ` Press ${keyWords(aideKey('aideKey'))} over anything.` : ''}` : 'Companion is off.', 4000);
  } else toast('Saved.', 1500);
  renderAideBox(); aideRefresh();
}));
// Pressing the keys you want. A letter by itself would be taken from every program, so it needs Ctrl or Alt.
const ELECTRON_KEY = code => { if (/^Key[A-Z]$/.test(code)) return code.slice(3); if (/^Digit\d$/.test(code)) return code.slice(5); if (/^F\d{1,2}$/.test(code)) return code; return { Backquote: '`', Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Tab: 'Tab', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }[code] || null; };
function aideKeyFrom(e) {
  const k = ELECTRON_KEY(e.code); if (!k) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (AIDE_MAC ? 'Command' : 'Super')].filter(Boolean);
  if (!/^F\d/.test(k) && !mods.some(m => m !== 'Shift')) return null;
  return [...mods, k].join('+');
}
async function aideSetKey(which, acc) {
  const was = aideKey(which);
  const r = await window.desktop.set({ [which]: acc });
  if (r && (which === 'aideKey' ? r.aideOk === false : r.aideLookOk === false) && was !== acc) {
    await window.desktop.set({ [which]: was });
    toast(`Another program already uses ${keyWords(acc)}. Yours stays ${keyWords(was)}.`, 7000);
  } else toast(`Now ${keyWords(acc)}.`, 3000);
  await aideLoadKeys();
  renderAideBox(); aideRefresh();
}
document.addEventListener('click', wrap(async e => {
  const sp = e.target.closest('[data-aide-spare]'); if (sp) return aideSetKey(sp.dataset.aideSpare, sp.dataset.key);
  if (e.target.closest('[data-aide-setup]')) { await openSetup(); setTimeout(() => $('st-companion')?.scrollIntoView({ block: 'start' }), 500); }
  return undefined;
}));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-aide-cap]'); if (!b) return;
  Aide.capturing = Aide.capturing === b.dataset.aideCap ? null : b.dataset.aideCap;
  renderAideBox();
});
document.addEventListener('keydown', wrap(async e => {
  if (!Aide.capturing) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { Aide.capturing = null; renderAideBox(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  const acc = aideKeyFrom(e);
  if (!acc) { toast('It needs Ctrl or Alt with it, so it isn’t taken from everything you type.', 4000); return; }
  const which = Aide.capturing, other = which === 'aideKey' ? 'aideLookKey' : 'aideKey';
  Aide.capturing = null;
  if (acc === aideKey(other)) { toast('The other Companion key is already that.', 4000); renderAideBox(); return; }
  await aideSetKey(which, acc);
}), true);
