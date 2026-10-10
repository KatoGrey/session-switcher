'use strict';
/* Groups, sub-sessions and the Commander. Loaded after the hub's scripts and before events.js,
   which draws the first page. Shares their scope (classic scripts). */
// The Commander's tools, in words.
const CMDR_TOOLS = { mcp__switcher__send_message: 'nudge another chat', mcp__switcher__answer_permission: 'answer another chat’s permission request', mcp__switcher__start_sub_session: 'start a sub-session', mcp__switcher__create_routine: 'set up a routine', mcp__switcher__list_sessions: 'look over your chats', mcp__switcher__read_session: 'read a chat' };
window.CMDR_TOOLS = CMDR_TOOLS;

const groupItem = id => ({ glyph: '▤', label: groupOfChat(id) ? `Move to another group…` : 'Move to group…', hint: groupOfChat(id) ? `in ${groupOfChat(id).name}` : '', run: () => showMenu(Ctx.at || { x: innerWidth / 2, y: innerHeight / 3 }, moveToGroupItems(id)) });

/* ---------- groups and sub-sessions ---------- */
// Groups you made, sub-sessions (chats started from another chat) and the Commander. Kept on the
// PC (organize.json) so the phone sees the same.
S.org = { groups: [], parents: {}, commander: {} };
const lowId = s => String(s || '').toLowerCase();
async function loadOrganize() { try { S.org = await api('/api/organize'); } catch { /* keep */ } }
const actOf = id => S.activity.find(y => y.sessionId && lowId(y.sessionId) === lowId(id)) || null;
// 'await' (needs you or replied), 'work' (at work) or null.
function chatMood(id) { const x = actOf(id); if (!x) return null; const st = statusOf(x); return NEEDS.has(st) || st === 'reply' ? 'await' : st === 'working' ? 'work' : null; }
const moodDot = id => { const m = chatMood(id); return m === 'await' ? '<span class="gilt-dot nav-dot" title="Waiting for you"></span>' : m === 'work' ? '<span class="ember-dot nav-dot" title="At work"></span>' : ''; };
const groupOfChat = id => S.org.groups.find(g => g.chats.some(c => lowId(c) === lowId(id))) || null;
const parentOfChat = id => S.org.parents[lowId(id)] || null;
const kidsOf = id => Object.keys(S.org.parents).filter(k => lowId(S.org.parents[k]) === lowId(id));
const isCommander = id => !!id && !!S.org.commander && lowId(S.org.commander.sessionId) === lowId(id);
function groupCounts(g) {
  let work = 0, wait = 0;
  for (const id of g.chats) { const m = chatMood(id); if (m === 'work') work++; else if (m === 'await') wait++; }
  return { work, wait };
}
const countsHtml = ({ work, wait }) => `${wait ? `<span class="g-n wait" title="${wait} awaiting you"><span class="gilt-dot" aria-hidden="true"></span>${wait}</span>` : ''}${work ? `<span class="g-n work" title="${work} at work"><span class="ember-dot" aria-hidden="true"></span>${work}</span>` : ''}`;
const countsWords = ({ work, wait }) => [wait ? `${wait} awaiting you` : '', work ? `${work} at work` : ''].filter(Boolean).join(', ') || 'all quiet';
// Chats in tree order: each chat followed by its sub-sessions (only those in the same list).
function treeOrder(ids) {
  const set = new Set(ids.map(lowId)), out = [], seen = new Set();
  const walk = (id, d) => { if (seen.has(lowId(id)) || d > 6) return; seen.add(lowId(id)); out.push([id, d]); for (const k of kidsOf(id)) if (set.has(k)) walk(ids.find(x => lowId(x) === k) || k, d + 1); };
  for (const id of ids) { const p = parentOfChat(id); if (!p || !set.has(lowId(p))) walk(id, 0); }
  for (const id of ids) walk(id, 0); // anything left (a loop that shouldn't happen)
  return out;
}
function navChatHtml(id, depth = 0) {
  const [c, p] = sessionById(id); if (!c) return '';
  const cur = !!(window.ChatUI && ChatUI.isOpen() && ChatUI.sessionId && lowId(ChatUI.sessionId()) === lowId(c.id));
  return `<button class="nav-i nav-chat ${isCodex(c) ? 'codex' : ''} ${depth ? 'nav-sub' : ''}" style="--depth:${depth}" data-navchat="${esc(c.id)}" draggable="true" title="${esc(c.title)} · ${esc(p.name)}" aria-current="${cur}"><span class="glyph" aria-hidden="true">${depth ? '↳' : '❝'}</span><span class="ni-t"><span class="nc-t">${esc(c.title)}</span><small>${esc(p.name)}${isCodex(c) ? ' · Codex' : ''}</small></span>${moodDot(c.id)}</button>`;
}
function navGroupsHtml() {
  const G = S.org.groups || [];
  const head = `<div class="nav-h prov groups"><span class="pmark" aria-hidden="true"></span>Groups<button class="nav-add" data-gact="new" title="New group" aria-label="New group">+</button></div>`;
  if (!G.length) return `${head}<p class="nav-empty">Right-click a chat and choose “Move to group”, or drag it onto a group.</p>`;
  return head + G.map(g => {
    const n = g.chats.filter(id => sessionById(id)[0]).length;
    return `<button class="nav-g" data-group="${esc(g.id)}" draggable="true" aria-expanded="${!g.collapsed}" title="${esc(g.name)}: ${esc(countsWords(groupCounts(g)))}"><span class="fold-c" aria-hidden="true">▾</span><span class="ni-t">${esc(g.name)}</span>${countsHtml(groupCounts(g))}<span class="count">${n}</span></button>
      ${g.collapsed ? '' : n ? treeOrder(g.chats).map(([id, d]) => navChatHtml(id, d)).join('') : '<p class="nav-empty g-empty">Empty. Drag chats here.</p>'}`;
  }).join('');
}
// Sub-sessions that aren't in a group, as trees under the chat they came from.
function navFamiliesHtml() {
  const ids = new Set();
  for (const [k, v] of Object.entries(S.org.parents || {})) for (const id of [k, v]) if (!groupOfChat(id) && !isCommander(id) && sessionById(id)[0]) ids.add(sessionById(id)[0].id);
  if (!ids.size) return '';
  const rows = treeOrder([...ids]);
  return `<button class="nav-h prov subs fold" data-fold="subs" aria-expanded="${!S.navFold.has('subs')}"><span class="pmark" aria-hidden="true"></span>Sub-sessions<span class="count">${rows.length}</span><span class="fold-c" aria-hidden="true">▾</span></button>
    ${S.navFold.has('subs') ? '' : rows.map(([id, d]) => navChatHtml(id, d)).join('')}`;
}

// The hub's "Your groups": one card per group with its chats and how they're doing.
function groupCard(g) {
  const c = groupCounts(g);
  const rows = treeOrder(g.chats).filter(([id]) => sessionById(id)[0]);
  const item = ([id, d]) => {
    const [s, p] = sessionById(id); const m = chatMood(id); const x = actOf(id);
    const word = m === 'await' ? (x && NEEDS.has(statusOf(x)) ? 'needs you' : 'replied') : m === 'work' ? 'at work' : liveOf(id) ? 'open' : agoL(s.updated);
    return `<li style="--depth:${d}"><button class="gc-chat ${m || ''}" draggable="true" data-gchat="${esc(s.id)}" title="${esc(s.title)} · ${esc(p.name)}"><span class="${m === 'await' ? 'gilt-dot' : m === 'work' ? 'ember-dot' : liveOf(id) ? 'ready-dot' : 'ash-dot'}" aria-hidden="true"></span>${d ? '<span class="gc-sub" aria-hidden="true">↳</span>' : ''}<span class="gc-t">${esc(s.title)}</span><span class="gc-s">${esc(word)}</span></button></li>`;
  };
  return `<article class="gcard ${c.wait ? 'needs' : c.work ? 'working' : ''}" data-gcard="${esc(g.id)}">
    <header class="gc-top"><h3 class="gc-name">${esc(g.name)}</h3><span class="gc-live">${countsHtml(c)}</span><button class="icon" data-gmore="${esc(g.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(g.name)}">${ICON.more}</button></header>
    <p class="gc-sum">${esc(plural(rows.length, 'chat'))} · ${esc(countsWords(c))}</p>
    ${rows.length ? `<ul class="gc-list">${rows.slice(0, 8).map(item).join('')}</ul>${rows.length > 8 ? `<p class="gc-more">and ${rows.length - 8} more in the sidebar</p>` : ''}` : '<p class="gc-empty">No chats yet. Right-click a chat and choose “Move to group”.</p>'}
  </article>`;
}

async function orgDo(body) { const r = await api('/api/organize', body); S.org = { groups: r.groups, parents: r.parents, commander: r.commander }; renderNav(); renderLive(); return r; }
async function newGroup(chatId) {
  const name = await ask('New group', chatId ? 'Name the group. This chat moves into it, with its sub-sessions.' : 'Name the group. Then move chats into it from their right-click menu, or drag them onto it in the sidebar.', '', 'Create group');
  if (!name) return;
  await orgDo({ action: 'create', name, chat: chatId || undefined });
  toast(`Made the group “${name}”.`, 2500);
}
// "Move to group…": every group, a new one, or out of its group.
function moveToGroupItems(id) {
  const cur = groupOfChat(id);
  return [
    ...S.org.groups.map(g => ({ checked: !!cur && cur.id === g.id, label: g.name, run: async () => { await orgDo({ action: 'move', chat: id, id: g.id }); toast(`Moved to ${g.name}.`, 3000, cur ? { label: 'Undo', run: () => orgDo({ action: 'move', chat: id, id: cur.id }) } : { label: 'Undo', run: () => orgDo({ action: 'move', chat: id, id: null }) }); } })),
    ...(S.org.groups.length ? ['-'] : []),
    { glyph: '+', label: 'New group…', run: () => newGroup(id) },
    ...(cur ? [{ label: `Take out of ${cur.name}`, run: () => orgDo({ action: 'move', chat: id, id: null }) }] : []),
  ];
}
function groupItems(gid) {
  const g = S.org.groups.find(x => x.id === gid); if (!g) return [];
  const i = S.org.groups.indexOf(g);
  return [
    { label: g.collapsed ? 'Expand in the sidebar' : 'Collapse in the sidebar', run: () => orgDo({ action: 'collapse', id: g.id, collapsed: !g.collapsed }) },
    { label: 'Rename…', run: async () => { const n = await ask('Rename group', 'Only changes the name shown here.', g.name, 'Rename'); if (n && n !== g.name) await orgDo({ action: 'rename', id: g.id, name: n }); } },
    { label: 'Move up', disabled: i === 0, run: () => orgDo({ action: 'reorder', id: g.id, step: -1 }) },
    { label: 'Move down', disabled: i === S.org.groups.length - 1, run: () => orgDo({ action: 'reorder', id: g.id, step: 1 }) },
    { glyph: '+', label: 'New group…', run: () => newGroup() },
    '-',
    { label: 'Remove the group', hint: 'its chats stay', danger: true, run: async () => { if (!(await appConfirm(`Remove the group “${g.name}”?\n\nIts chats aren’t touched; they just aren’t grouped any more.`, { ok: 'Remove group', danger: true }))) return; await orgDo({ action: 'remove', id: g.id }); } },
  ];
}
window.moveToGroupItems = moveToGroupItems;

// Sub-sessions: a new chat in the same folder, linked to the chat it came from. With a brief, its
// message box starts with that chat's latest reply and a blank for what the sub-session should do.
const quoteLines = t => String(t || '').split('\n').map(l => `> ${l}`).join('\n');
function briefText(s, last) {
  // The task goes first, so it becomes the sub-session's title.
  return `{describe what this sub-session should do}\n\nContext: you’re a sub-session of “${s.title}”, another chat in this folder.${last ? ` Its latest reply:\n\n${quoteLines(last)}` : ''}`;
}
async function startSubSession(id, withBrief) {
  const [s, p] = sessionById(id); if (!s) return toast('That chat isn’t in the list any more.');
  if (!p.exists) return toast(`The folder ${p.cwd} no longer exists.`);
  let text = '';
  if (withBrief) {
    let last = '';
    try { last = (await api(`/api/chat/last-reply?${new URLSearchParams({ id: s.id })}`)).text || ''; } catch (err) { toast(`Couldn’t read its last reply (${err.message}); the brief starts without it.`, 6000); }
    text = briefText(s, last);
  }
  const prov = isCodex(s) ? 'codex' : 'claude';
  const live = liveOf(s.id);
  const acct = prov === 'claude' ? [live && live.accountId, s.lastOpened && s.lastOpened.account].find(x => x && S.accounts.some(a => a.id === x && canLaunch(a))) : null;
  return ChatUI.open({ cwd: p.cwd, mode: 'new', provider: prov, accountId: acct || null, parent: s.id, initialText: text });
}
function subItems(id) {
  const par = parentOfChat(id), [ps] = par ? sessionById(par) : [null];
  return [
    { glyph: '↳', label: 'Start a sub-session', hint: 'a new chat here, linked to this one', run: () => startSubSession(id, false) },
    { glyph: '↳', label: 'Start a sub-session with a brief', hint: 'begins with this chat’s last reply', run: () => startSubSession(id, true) },
    ...(ps ? [{ glyph: '↑', label: 'Open the chat it came from', hint: ps.title, run: () => openChatFromNav(ps.id) }, { label: 'Unlink from that chat', hint: 'it stops being a sub-session', run: () => orgDo({ action: 'unlink', chat: id }) }] : []),
  ];
}
const orgItems = id => (isCommander(id) ? [{ glyph: '✪', label: 'Commander settings…', run: commanderSetup }] : [groupItem(id), ...subItems(id)]);
window.orgItems = orgItems;
// The chat window's breadcrumb: its group, then the chats it came from, then its sub-sessions.
function crumbHtml(id, pendingParent) {
  const bits = [];
  const g = (id && groupOfChat(id)) || (pendingParent && groupOfChat(pendingParent));
  if (g) bits.push(`<span class="cc-g" title="In the group ${esc(g.name)}">${esc(g.name)}</span>`);
  const chain = [];
  let up = (id && parentOfChat(id)) || pendingParent || null;
  for (let i = 0; up && i < 3; i++) { chain.unshift(up); up = parentOfChat(up); }
  if (up) bits.push('<span class="cc-more">…</span>');
  for (const c of chain) { const [s] = sessionById(c); bits.push(`<button type="button" class="cc-p" data-crumb="${esc(c)}" title="Open the chat this one came from">${esc(s ? s.title : 'Earlier chat')}</button>`); }
  let out = bits.map((b, i) => `${i ? '<span class="cc-sep" aria-hidden="true">›</span>' : ''}${b}`).join('');
  const kids = id ? kidsOf(id).filter(k => sessionById(k)[0]) : [];
  if (kids.length) out += `<button type="button" class="cc-k" data-crumb-kids="${esc(id)}" aria-haspopup="menu" aria-expanded="false">${esc(plural(kids.length, 'sub-session'))}</button>`;
  return out;
}
window.crumbHtml = crumbHtml;

// The Commander: one chat that sees and steers the others (list, read, nudge, sub-sessions, and
// permission answers only if you allow it). Pinned at the top of the sidebar.
const cmdrSet = () => S.org.commander || {};
const cmdrReady = () => !!cmdrSet().accountId;
const cmdrMood = () => { const id = cmdrSet().sessionId; if (!id) return null; return chatMood(id); };
function navCommanderHtml() {
  const set = cmdrSet(), m = cmdrMood();
  const live = set.sessionId && liveOf(set.sessionId);
  const cur = !!(window.ChatUI && ChatUI.isOpen() && ChatUI.sessionId && set.sessionId && lowId(ChatUI.sessionId()) === lowId(set.sessionId));
  return `<button class="nav-i nav-cmdr" data-cmdr="open" aria-current="${cur}" title="${cmdrReady() ? 'The Commander: a chat that watches your other chats and nudges them along' : 'Set up the Commander: a chat that watches your other chats and nudges them along'}"><span class="glyph" aria-hidden="true">✪</span><span class="ni-t">Commander</span>${m ? moodDot(set.sessionId) : live ? '<span class="ready-dot nav-dot" title="Running"></span>' : ''}${cmdrReady() ? '' : '<span class="tag ghost">Set up</span>'}</button>`;
}
async function openCommander({ fresh = false } = {}) {
  if (!cmdrReady()) return commanderSetup();
  const set = cmdrSet();
  if (!(set.sessionId && liveOf(set.sessionId))) toast('Starting the Commander…', 3000);
  const info = await api('/api/commander/open', { fresh });
  document.body.classList.remove('nav-open');
  const isNew = fresh || !set.sessionId || !info.sessionId;
  return ChatUI.openKey(info.key, isNew ? { initialText: 'Look over my chats. Tell me which ones need me, and nudge any that are stuck or waiting for a simple “carry on”.' } : {});
}
function commanderSetup() {
  let d = $('cmdrDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="cmdrDlg" class="cmdr-dlg" aria-labelledby="cmdrTitle"><form method="dialog" id="cmdrForm"></form></dialog>');
    d = $('cmdrDlg');
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    $('cmdrForm').addEventListener('submit', wrap(async e => {
      const v = e.submitter && e.submitter.value;
      if (v !== 'start' && v !== 'save' && v !== 'fresh') return;
      const accountId = (d.querySelector('input[name="cmdrAcct"]:checked') || {}).value;
      const allowApprove = $('cmdrApprove').checked;
      if (allowApprove && !cmdrSet().allowApprove && !(await appConfirm('Let the Commander answer permission requests?\n\nIt could allow commands and edits in your other chats without asking you first. Each answer shows in that chat as a note from the Commander. You can turn this off any time.', { ok: 'Let it answer', danger: true }))) { $('cmdrApprove').checked = false; return; }
      const r = await api('/api/commander/settings', { accountId, allowApprove });
      S.org.commander = { ...S.org.commander, ...r };
      renderNav();
      if (v === 'save') return toast(allowApprove ? 'Saved. The Commander may answer permission requests.' : 'Saved.', 3000);
      return openCommander({ fresh: v === 'fresh' });
    }));
  }
  const set = cmdrSet();
  const choices = S.accounts.map(a => `<label class="cmdr-acct ${canLaunch(a) ? '' : 'off'}"><input type="radio" name="cmdrAcct" value="${esc(a.id)}" ${(set.accountId || S.acct) === a.id ? 'checked' : ''} ${canLaunch(a) ? '' : 'disabled'}><span class="ring" style="--ring:${ringOf(a)}"></span><b>${esc(a.name)}</b><small>${esc(a.signedIn ? `${a.email || 'Signed in'}${a.plan ? `, ${a.plan}` : ''}` : 'Not signed in')}</small></label>`).join('');
  const running = !!(set.sessionId && liveOf(set.sessionId));
  $('cmdrForm').innerHTML = `<h3 id="cmdrTitle">The Commander</h3>
    <p>One chat that keeps an eye on your others. Ask it what needs you, and it can:</p>
    <ul class="cmdr-can"><li>list your chats and what each is doing</li><li>read a chat’s latest messages</li><li>nudge a chat with a message (it asks you first, unless you let it)</li><li>start a sub-session from a chat</li></ul>
    <p class="cmdr-note">Whatever it sends shows in that chat, marked “from Commander”, so you can always see what was nudged.</p>
    <p class="d-h">Runs as</p><div class="cmdr-accts">${choices}</div>
    <label class="cmdr-check"><input type="checkbox" id="cmdrApprove" ${set.allowApprove ? 'checked' : ''}><span><b>Let it answer permission requests</b><small>Allow or Deny a waiting command or edit in another chat. Off: it tells you what’s waiting instead.</small></span></label>
    ${running ? '<p class="cmdr-note">A new account takes effect the next time the Commander starts.</p>' : ''}
    <div class="d-row">${set.sessionId ? '<button class="btn quiet" value="fresh" formnovalidate title="Starts a new Commander chat; the old one stays in your chats">Start a fresh one</button><span class="spacer"></span>' : ''}<button class="btn" value="cancel" formnovalidate>Cancel</button>${cmdrReady() ? '<button class="btn" value="save">Save</button>' : ''}<button class="btn prime" value="start">${running ? 'Open the Commander' : cmdrReady() ? 'Save and open' : 'Start the Commander'}</button></div>`;
  d.showModal();
}
document.addEventListener('click', wrap(async e => {
  const t = e.target instanceof Element ? e.target : null; if (!t) return undefined;
  const cr = t.closest('[data-crumb]'); if (cr) return openChatFromNav(cr.dataset.crumb);
  const ck = t.closest('[data-crumb-kids]');
  if (ck) return ck.getAttribute('aria-expanded') === 'true' ? closeMenu() : showMenu(ck, kidsOf(ck.dataset.crumbKids).map(k => sessionById(k)[0]).filter(Boolean).map(s => ({ glyph: chatMood(s.id) === 'await' ? '●' : chatMood(s.id) === 'work' ? '◌' : '↳', label: s.title, hint: chatMood(s.id) === 'await' ? 'waiting for you' : chatMood(s.id) === 'work' ? 'at work' : agoL(s.updated), run: () => openChatFromNav(s.id) })));
  return undefined;
}));

// Dragging: a chat (from the sidebar, a list or a hub card) onto a group moves it there; a group
// onto another group puts it in that place.
const Drag = { chat: null, group: null };
document.addEventListener('dragstart', e => {
  const t = e.target instanceof Element ? e.target : null; if (!t) return;
  const g = t.closest('[data-group]');
  const c = t.closest('[data-navchat], [data-row], [data-gchat]');
  Drag.group = g && !c ? g.dataset.group : null;
  Drag.chat = c ? (c.dataset.navchat || c.dataset.row || c.dataset.gchat) : null;
  if (!Drag.group && !Drag.chat) return;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', Drag.chat || Drag.group); } catch { /* fine */ }
  document.body.classList.add('dragging');
});
document.addEventListener('dragend', () => { Drag.chat = Drag.group = null; document.body.classList.remove('dragging'); for (const el of document.querySelectorAll('.drop-on')) el.classList.remove('drop-on'); });
const dropTarget = e => (e.target instanceof Element ? e.target.closest('[data-group], [data-gcard], [data-gact="new"]') : null);
document.addEventListener('dragover', e => {
  if (!Drag.chat && !Drag.group) return;
  const t = dropTarget(e); if (!t || (Drag.group && !t.dataset.group)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  for (const el of document.querySelectorAll('.drop-on')) if (el !== t) el.classList.remove('drop-on');
  t.classList.add('drop-on');
});
document.addEventListener('dragleave', e => { const t = dropTarget(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-on'); });
document.addEventListener('drop', e => {
  const t = dropTarget(e); if (!t || (!Drag.chat && !Drag.group)) return;
  e.preventDefault();
  const chat = Drag.chat, grp = Drag.group, to = t.dataset.group || t.dataset.gcard;
  wrap(async () => {
    if (t.dataset.gact === 'new') return chat ? newGroup(chat) : undefined;
    if (grp) { if (grp !== to) await orgDo({ action: 'reorder', id: grp, to: S.org.groups.findIndex(x => x.id === to) }); return undefined; }
    const g = S.org.groups.find(x => x.id === to); if (!g) return undefined;
    const was = groupOfChat(chat);
    if (was && was.id === g.id) return undefined;
    await orgDo({ action: 'move', chat, id: g.id });
    return toast(`Moved to ${g.name}.`, 3000, { label: 'Undo', run: () => orgDo({ action: 'move', chat, id: was ? was.id : null }) });
  })();
});
