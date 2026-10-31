'use strict';
/* Two chats changing the same file at the same time: each works from what it last read, so the second
   write can undo the first without anyone saying so. The PC notices from their edit tools (lib/overlaps.js). Here: a card on
   the hub, a mark in the header of a chat it concerns, and what to do about it: look at the file, put the
   two side by side, or have this chat read it again before it goes on. Nothing is sent by itself. */

const Clash = { hidden: {}, told: new Map(), primed: false };
try { Clash.hidden = JSON.parse(store('clashHidden') || '{}') || {}; } catch { Clash.hidden = {}; }
const clashId = f => String(f).toLowerCase();

// Every file two open chats have both changed, newest first, without the ones you've hidden.
function clashList() {
  const files = new Map();
  for (const x of S.activity) {
    for (const o of x.overlaps || []) {
      const id = clashId(o.file);
      const row = files.get(id) || { id, file: o.file, rel: o.rel, at: 0, chats: new Map() };
      row.at = Math.max(row.at, o.at);
      row.chats.set(x.key, { key: x.key, sessionId: x.sessionId || null });
      for (const y of o.others || []) if (!row.chats.has(y.key)) row.chats.set(y.key, { key: y.key, sessionId: y.sessionId || null });
      files.set(id, row);
    }
  }
  return [...files.values()].filter(r => (Clash.hidden[r.id] || 0) < r.at).sort((a, b) => b.at - a.at);
}
const clashName = c => { const x = S.activity.find(y => y.key === c.key); return x ? x.title || 'New chat' : 'A chat that’s finished'; };
const clashNames = r => [...r.chats.values()].map(clashName).join(' and ');
function clashHide(rows) {
  for (const r of rows) Clash.hidden[r.id] = r.at;
  const keep = Object.entries(Clash.hidden).sort((a, b) => b[1] - a[1]).slice(0, 80);
  Clash.hidden = Object.fromEntries(keep);
  store('clashHidden', JSON.stringify(Clash.hidden));
  renderClash();
}
// A partner lives inside its chat: that's the chat to open.
function clashChat(c) {
  const x = S.activity.find(y => y.key === c.key), lead = x && x.parentKey && S.activity.find(y => y.key === x.parentKey);
  return lead ? { key: lead.key, sessionId: lead.sessionId || null } : c;
}
// The two side by side, so you can see what each did. A chat and its own partner are one chat.
async function clashSideBySide(r) {
  const seen = new Set(), list = [...r.chats.values()].map(clashChat).filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });
  const [a, b] = list;
  await openStillThere(a);
  if (b && window.Split && Split.can()) openBeside({ key: b.key, sessionId: b.sessionId, title: clashName(b) });
}
const clashLook = r => Viewer.open({ path: r.file, key: [...r.chats.values()][0].key });

function clashCard(rows) {
  if (!rows.length) return '';
  const shown = rows.slice(0, 4);
  return `<div class="guard clash" role="status">
    <div class="clash-in">
      <p><b>${rows.length === 1 ? 'Two chats were changing the same file at once.' : `Two chats were changing the same ${rows.length} files at once.`}</b> The later edit may have undone the earlier one.</p>
      <ul class="clash-list">${shown.map(r => `<li><button class="linkish clash-f" data-clash-look="${esc(r.id)}" title="${esc(r.file)}">${esc(r.rel)}</button><span class="clash-who">${esc(clashNames(r))} · <span data-ago="${r.at}">${esc(agoL(r.at))}</span></span><span class="clash-do"><button class="btn quiet sm" data-clash-open="${esc(r.id)}">Side by side</button><button class="btn quiet sm" data-clash-hide="${esc(r.id)}">Hide</button></span></li>`).join('')}</ul>
      ${rows.length > shown.length ? `<p class="clash-more">And ${rows.length - shown.length} more. <button class="linkish" data-clash-hide="*">Hide them all</button></p>` : ''}
    </div>
  </div>`;
}
// What concerns the chat you're looking at: its own, and its partners'.
function clashOfChat() {
  if (!window.ChatUI || !ChatUI.isOpen()) return [];
  const key = ChatUI.key(), mine = new Set([key, ...S.activity.filter(x => x.parentKey === key).map(x => x.key)]);
  return clashList().filter(r => [...r.chats.keys()].some(k => mine.has(k)));
}
function clashMenu(anchor) {
  const rows = clashOfChat(); if (!rows.length) return;
  const here = ChatUI.key(), mine = new Set([here, ...S.activity.filter(x => x.parentKey === here).map(x => x.key)]);
  const others = new Map();
  for (const r of rows) for (const c of r.chats.values()) if (!mine.has(c.key)) { const o = clashChat(c); if (!mine.has(o.key)) others.set(o.key, o); }
  const list = rows.map(r => r.rel).slice(0, 12);
  showMenu(anchor, [
    ...rows.slice(0, 6).map(r => ({ glyph: '⚠', label: r.rel, hint: `also ${[...r.chats.values()].filter(c => !mine.has(c.key)).map(clashName).join(', ') || 'its partner'}`, run: () => clashLook(r) })),
    '-',
    ...[...others.values()].slice(0, 3).map(c => ({ glyph: '◫', label: `Open ${clashName(c)} beside this one`, disabled: !(window.Split && Split.can()), why: 'There’s no room for two here', run: () => openBeside({ key: c.key, sessionId: c.sessionId, title: clashName(c) }) })),
    { glyph: '✎', label: 'Have this chat read them again', hint: 'in the message box, for you to send', run: () => placeText(`Another chat was changing ${list.length === 1 ? 'this file' : 'these files'} at the same time: ${list.join(', ')}. Read ${list.length === 1 ? 'it' : 'them'} again before you change ${list.length === 1 ? 'it' : 'them'}, and check your own edits are still there.`, false) },
    { glyph: '✕', label: rows.length === 1 ? 'Hide this' : 'Hide these', run: () => clashHide(rows) },
  ]);
}
function renderClash() {
  const rows = clashList();
  const slot = $('clashSlot');
  if (slot) { const h = clashCard(rows); if (slot._h !== h) { slot.innerHTML = h; slot._h = h; } }
  const chip = $('cClash');
  if (chip) {
    const n = clashOfChat().length;
    chip.hidden = !n;
    const say = n === 1 ? 'Another chat was changing a file this one changed' : `Other chats were changing ${n} files this one changed`;
    if (n && chip.getAttribute('aria-label') !== say) { chip.setAttribute('aria-label', say); chip.title = say; }
  }
  // Said once when it happens; not for what was already so when the app opened.
  const now = Date.now(), fresh = rows.filter(r => !Clash.told.has(r.id) || (Clash.told.get(r.id) < r.at && now - Clash.told.get(r.id) > 30 * 60e3));
  for (const r of fresh) Clash.told.set(r.id, r.at);
  if (Clash.primed && fresh.length && !SOLO) {
    const r = fresh[0];
    toast(`${clashNames(r)} were both changing ${r.rel}.`, 8000, { label: 'Side by side', run: () => clashSideBySide(r) });
  }
  if (S.activity.length) Clash.primed = true;
}
(function startClash() {
  document.addEventListener('click', wrap(async e => {
    const t = e.target; if (!(t instanceof Element)) return;
    if (t.closest('#cClash')) return clashMenu(t.closest('#cClash'));
    const b = t.closest('[data-clash-look], [data-clash-open], [data-clash-hide]'); if (!b) return;
    const rows = clashList(), by = id => rows.find(r => r.id === id);
    if (b.dataset.clashHide) return clashHide(b.dataset.clashHide === '*' ? rows : [by(b.dataset.clashHide)].filter(Boolean));
    if (b.dataset.clashLook && by(b.dataset.clashLook)) return clashLook(by(b.dataset.clashLook));
    if (b.dataset.clashOpen && by(b.dataset.clashOpen)) return clashSideBySide(by(b.dataset.clashOpen));
  }));
}());
