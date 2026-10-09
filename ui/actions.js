'use strict';
/* A chat’s details drawer, menus, and what the buttons and menu items do. */

/* ---------- drawer ---------- */
let drawerSeq = 0;
async function openDrawer(id, quiet) {
  const seq = ++drawerSeq;
  const d = $('drawer');
  S.drawerId = id;
  if (!quiet) { d.innerHTML = '<div class="d-body"><p class="loading">Reading the chat…</p></div>'; d.hidden = false; }
  document.querySelectorAll('.row').forEach(el => el.classList.toggle('current', el.dataset.row === id));
  let p;
  try { p = await api(`/api/session?id=${encodeURIComponent(id)}`); }
  catch (err) { if (seq === drawerSeq) d.innerHTML = `<div class="d-body"><p class="loading">${esc(err.message)}</p></div>`; return; }
  if (seq !== drawerSeq || S.drawerId !== id) return;
  const s = p.session, st = p.stats, a = current();
  const scroller = d.querySelector('.d-body'); const keep = quiet && scroller ? scroller.scrollTop : null;
  const opened = s.lastOpened ? `Last opened from here as <b>${esc(s.lastOpened.accountName)}</b>, ${esc(agoL(s.lastOpened.at))}${s.lastOpened.mode === 'fork' ? ' (as a copy)' : s.lastOpened.mode === 'desktop' ? ' (in the desktop app)' : ''}.` : 'Not opened from Session Switcher yet.';
  const stat = (k, v) => (v ? `<div><dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd></div>` : '');
  const live = liveOf(s.id);
  d.innerHTML = `
    <div class="d-top">
      <div class="d-head">
        <div><p class="eyebrow">${esc(s.folder)}${live ? ' · open in the chat window' : p.running ? ' · open in a terminal' : ''}</p><h2 class="d-title">${esc(s.title)}</h2></div>
        <button class="icon" data-dclose aria-label="Close details">✕</button>
      </div>
      <div class="d-actions">
        ${live ? `<button class="btn prime" data-chat="${esc(s.id)}">Return to this chat</button>` : p.running ? `<button class="btn prime" data-watch="${esc(s.id)}">Watch it live</button>` : `
        <button class="btn ${inApp() ? 'prime' : ''}" data-chat="${esc(s.id)}" ${canLaunch(a) && s.folderExists ? '' : 'disabled'}>Open as ${esc(a.name)}</button>
        <button class="btn ${inApp() ? '' : 'prime'}" data-open="${esc(s.id)}" ${canLaunch(a) && s.folderExists ? '' : 'disabled'}>Resume in a terminal</button>`}
        <button class="icon" data-more="${esc(s.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions">${ICON.more}</button>
      </div>
    </div>
    <div class="d-body">
      <dl class="d-stats">
        ${stat('Messages', `${st.prompts} from you, ${st.replies} from Claude`)}
        ${stat('Tool calls', st.tools ? String(st.tools) : '')}
        ${stat('Started', st.first ? stamp(Date.parse(st.first)) : '')}
        ${stat('Last activity', stamp(s.updated))}
        ${stat('Branch', s.branch)}
        ${stat('Model', st.models.length ? (window.ChatUI && ChatUI.modelName ? ChatUI.modelName(st.models[st.models.length - 1]) : st.models[st.models.length - 1]) : '')}
        ${stat('Claude Code', st.version)}
        ${stat('Size', s.sizeKB >= 1024 ? `${(s.sizeKB / 1024).toFixed(1)} MB` : `${s.sizeKB} KB`)}
      </dl>
      <p class="d-opened">${opened}</p>
      <p class="d-h">Latest messages</p>
      ${p.messages.length ? `<ol class="msgs">${p.messages.map(m => `<li class="msg ${m.role}"><span class="who">${m.role === 'you' ? 'You' : 'Claude'}${m.at ? `, ${esc(stamp(Date.parse(m.at)))}` : ''}</span>${m.role === 'you' ? esc(m.text) : `<div class="md">${ChatUI.md(m.text)}</div>`}</li>`).join('')}</ol>` : '<p class="loading">No messages to show.</p>'}
    </div>`;
  const body = d.querySelector('.d-body');
  body.scrollTop = keep !== null ? keep : body.scrollHeight;
  if (!quiet) d.focus();
}
function closeDrawer() {
  $('drawer').hidden = true; S.drawerId = null; drawerSeq++;
  document.querySelectorAll('.row.current').forEach(el => el.classList.remove('current'));
}

/* ---------- menus ---------- */
let menuAnchor = null, menuReturn = null;
// anchor: the button it belongs to, or { x, y } for a right-click menu at the pointer.
function showMenu(anchor, items) {
  const m = $('menu');
  closeMenu();
  items = items.filter((it, i, all) => it !== '-' || (i > 0 && i < all.length - 1 && all[i - 1] !== '-'));
  // Labels line up whether or not an item has an icon.
  const glyphs = items.some(it => it !== '-' && it.glyph);
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button role="${it.checked !== undefined ? 'menuitemradio' : 'menuitem'}" ${it.checked !== undefined ? `aria-checked="${!!it.checked}"` : ''} data-i="${i}" ${it.disabled ? `disabled title="${esc(it.why || '')}"` : ''} class="${it.danger ? 'danger' : ''} ${it.html ? 'm-acct' : ''}">${it.html || `${it.glyph || glyphs ? `<span class="m-g" aria-hidden="true">${esc(it.glyph || '')}</span>` : ''}<span class="m-l">${esc(it.label)}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</span>${it.keys ? `<kbd class="m-k">${esc(it.keys)}</kbd>` : ''}`}</button>`)).join('');
  menuReturn = document.activeElement;
  $('menuBack').hidden = false;
  m.hidden = false;
  placeAt(m, anchor);
  m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
  menuAnchor = anchor instanceof Element ? anchor : null;
  if (menuAnchor) menuAnchor.setAttribute('aria-expanded', 'true');
  m.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b || b.disabled) return; const it = items[+b.dataset.i]; closeMenu(true); wrap(it.run)(); };
  m.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
// Puts a popup under (or above) its anchor. Works in screen pixels, then divides by the interface
// size, since the page is scaled by it.
const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--look-ui')) || 1;
function placeAt(m, anchor, align = 'start') {
  const z = uiScale();
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const W = window.innerWidth, H = window.innerHeight;
  const w = m.offsetWidth * z, h = m.offsetHeight * z;
  let left = align === 'end' || r.left + w > W - 8 ? r.right - w : r.left;
  left = Math.max(8, Math.min(W - w - 8, left));
  const up = r.bottom + h + 8 > H;
  const top = up ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  m.style.left = `${left / z}px`; m.style.top = `${top / z}px`;
  // Grows out of the point it was opened from.
  m.style.transformOrigin = `${Math.max(0, Math.min(w, r.left - left)) / z}px ${up ? '100%' : '0'}`;
}
function closeMenu(refocus) {
  const m = $('menu'); if (m.hidden) return;
  m.hidden = true;
  $('menuBack').hidden = true;
  if (menuAnchor) menuAnchor.setAttribute('aria-expanded', 'false');
  if (refocus) {
    const back = menuAnchor && document.contains(menuAnchor) ? menuAnchor : menuReturn && document.contains(menuReturn) ? menuReturn : null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }
  menuAnchor = null; menuReturn = null;
}
$('menu').addEventListener('keydown', e => {
  const btns = [...$('menu').querySelectorAll('button:not(:disabled)')];
  const i = btns.indexOf(document.activeElement);
  const go = j => { btns[(j + btns.length) % btns.length]?.focus({ preventScroll: true }); e.preventDefault(); };
  if (e.key === 'ArrowDown') return go(i + 1);
  if (e.key === 'ArrowUp') return go(i - 1);
  if (e.key === 'Home') return go(0);
  if (e.key === 'End') return go(btns.length - 1);
  if (e.key === 'Escape' || e.key === 'Tab') { closeMenu(true); e.preventDefault(); return undefined; }
  // Type a letter to jump to the next item that starts with it.
  if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase();
    const label = b => (b.querySelector('.m-l') || b).textContent.trim().toLowerCase();
    const next = [...btns.slice(i + 1), ...btns.slice(0, i + 1)].find(b => label(b).startsWith(k));
    if (next) { next.focus({ preventScroll: true }); e.preventDefault(); }
  }
  return undefined;
});
// The pointer and the keyboard highlight the same row.
$('menu').addEventListener('pointermove', e => { const b = e.target.closest('button:not(:disabled)'); if (b && document.activeElement !== b) b.focus({ preventScroll: true }); });
// Outside the menu: a click or tap closes it (and isn't passed to what's underneath); a right-click
// opens the right menu there instead; the wheel closes it.
// (Closing on the whole click, not the press, so the release can't land on what's underneath.)
$('menuBack').addEventListener('pointerdown', e => e.preventDefault());
$('menuBack').addEventListener('click', e => {
  e.preventDefault(); e.stopPropagation();
  const was = menuAnchor;
  closeMenu();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const other = el && el.closest && el.closest('[aria-haspopup]');
  if (other && other !== was && !other.closest('#menu')) other.click();
});
$('menuBack').addEventListener('contextmenu', e => {
  e.preventDefault();
  closeMenu();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }));
});
$('menuBack').addEventListener('wheel', () => closeMenu(), { passive: true });
$('menu').addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('menu').hidden && !$('menu').contains(document.activeElement)) { closeMenu(true); e.stopPropagation(); } }, true);
window.addEventListener('resize', () => closeMenu());
window.addEventListener('blur', () => closeMenu());
document.addEventListener('scroll', e => { if (!$('menu').hidden && !(e.target instanceof Element && $('menu').contains(e.target))) closeMenu(); }, true);

function codexChatItems(s) {
  const ok = codexReady(), why = 'Sign in to Codex first';
  const live = liveOf(s.id);
  return [
    live ? { label: 'Return to this chat', run: () => ChatUI.open({ sessionId: s.id }) } : { label: 'Open in the chat window', hint: 'Codex', disabled: !ok, why, run: () => ChatUI.open({ sessionId: s.id }) },
    { label: 'Resume in a terminal', hint: 'codex resume', disabled: !ok || !!live, why: live ? 'It’s open in the chat window' : why, run: () => resume(s.id, 'resume') },
    { label: 'Open a copy in the chat window', hint: 'keeps the original', disabled: !ok, why, run: () => ChatUI.open({ sessionId: s.id, mode: 'fork' }) },
    { label: 'Resume a copy in a terminal', hint: 'codex fork', disabled: !ok, why, run: () => resume(s.id, 'fork') },
    '-',
    { label: 'Show details and messages', run: () => openDrawer(s.id) },
    { label: 'Browse this chat’s folder', run: () => Viewer.open({ path: '.', session: s.id }) },
    { label: 'Rename chat', run: () => renameChat(s.id) },
    { label: 'Copy terminal command', run: () => copyCommand(s.id) },
  ];
}
function codexChatMenu(anchor, s) { const items = codexChatItems(s); if (items && items.length) showMenu(anchor, [...items, '-', favItem(s.id)]); }
function chatItems(id) {
  const [s] = sessionById(id); if (!s) return [];
  if (isCodex(s)) return codexChatItems(s);
  const a = current(); const ok = canLaunch(a);
  const why = !a.signedIn ? `Sign in to ${a.name} first` : (a.lockMessage || '');
  const live = liveOf(id), run = isRunning(id);
  const watchIt = { label: 'Watch it live here', hint: 'read-only while it runs in its terminal', run: () => ChatUI.watch({ sessionId: id, source: 'terminal' }) };
  return [
    ...(run && !live ? [watchIt] : []),
    live ? { label: 'Return to this chat', run: () => ChatUI.open({ sessionId: id }) }
      : { label: `Open in the chat window as ${a.name}`, hint: run ? 'it’s also open in a terminal' : '', disabled: !ok, why, run: () => ChatUI.open({ sessionId: id }) },
    { label: `Resume in a terminal as ${a.name}`, disabled: !ok || !!live, why: live ? 'It’s open in the chat window' : why, run: () => resume(id, 'resume') },
    { label: 'Open a copy in the chat window', hint: 'keeps the original', disabled: !ok, why, run: () => ChatUI.open({ sessionId: id, mode: 'fork' }) },
    { label: 'Resume a copy in a terminal', hint: 'keeps the original', disabled: !ok, why, run: () => resume(id, 'fork') },
    { label: 'Open in the desktop app', run: () => resume(id, 'desktop') },
    '-',
    { label: 'Show details and messages', run: () => openDrawer(id) },
    { label: 'Browse this chat’s folder', run: () => Viewer.open({ path: '.', session: id }) },
    { label: 'Rename chat', run: () => renameChat(id) },
    { label: 'Copy terminal command', run: () => copyCommand(id) },
    { label: 'Show transcript file', run: async () => { const r = await api('/api/reveal', { sessionId: id }); if (r.dryRun) toast(`Would run: ${r.script}`); } },
  ];
}
function chatMenu(anchor, id) { const items = chatItems(id); if (items && items.length) showMenu(anchor, [...items, '-', favItem(id)]); }
const favItem = id => ({ glyph: isFav(id) ? '☆' : '★', label: isFav(id) ? 'Unpin from the sidebar' : 'Pin to the sidebar', run: () => toggleFav(id) });

function sealMenu(anchor) {
  showMenu(anchor, [
    ...S.accounts.map(a => {
      const b = binding(usageOf(a.id));
      return {
        checked: a.id === S.acct,
        html: `${miniDial(a.id, 28)}<span class="m-t"><b>${esc(a.name)}</b><small>${esc(a.signedIn ? `${a.email || 'Signed in'}${a.plan ? `, ${a.plan}` : ''}` : 'Not signed in')}</small></span><span class="m-u">${b ? `${b.left}%` : ''}</span>`,
        run: () => useAccount(a.id),
      };
    }),
    '-',
    { label: 'Add an account', run: addAccount },
    { label: `Open claude.ai as ${current().name}`, hint: 'regular Claude chats, in its own window', run: () => openWeb(current().id) },
    { label: 'Accounts and usage', hint: 'on the hub', run: () => hubTo('secAccounts') },
  ]);
}

function accountItems(id) {
  const a = S.accounts.find(x => x.id === id) || current();
  return [
    { label: `Open claude.ai as ${a.name}`, hint: 'regular Claude chats, in its own window', run: () => openWeb(a.id) },
    '-',
    { label: 'Check sign-in now', run: async () => { await api('/api/accounts/verify', { account: a.id }); await reload(); toast(`Checked ${a.name} with Claude Code.`); } },
    { label: 'Check usage now', disabled: !a.signedIn, run: () => refreshUsage(a.id) },
    ...((a.pinnedOrg || a.expectEmail) ? [{ label: 'Unlock', hint: 'let it open chats on any account or plan', run: () => accountAction('unlock', a.id) }] : []),
    { label: 'Rename', run: () => accountAction('rename', a.id) },
    { label: 'Sign out', disabled: !a.signedIn, run: () => accountAction('signout', a.id) },
    ...(a.isDefault ? [] : ['-', { label: 'Remove from list', danger: true, run: () => accountAction('remove', a.id) }]),
  ];
}
function accountMenu(anchor, id) { const items = accountItems(id); if (items && items.length) showMenu(anchor, items); }

/* ---------- actions ---------- */
function reportLaunch(r, msg) {
  if (r.dryRun) toast(`Would open a ${r.how}:\n${r.script}`, 12000);
  else toast(`${msg}${r.how ? ` in a ${r.how}` : ''}.${r.note ? `\n${r.note}` : ''}`, r.note ? 9000 : 5000);
}
// Regular claude.ai chats, in a window that keeps this account's own web sign-in.
async function openWeb(id) {
  const a = acctById(id) || current();
  const r = await api('/api/web', { account: a.id });
  if (r.dryRun) return toast(`Would open: ${r.script}`, 9000);
  const seen = store(`web:${a.id}`);
  store(`web:${a.id}`, '1');
  const site = id === 'codex' ? 'chatgpt.com' : 'claude.ai';
  return toast(seen ? `Opened ${site}${id === 'codex' ? '' : ` as ${a.name}`}.` : `Opened ${site} in its own window. The first time, sign in there${a.email ? ` as ${a.email}` : ''}; it stays signed in after that, separately from your other accounts.`, seen ? 2500 : 12000);
}
function useAccount(id) {
  S.acct = id; store('acct', id);
  renderAll(); if (S.drawerId) openDrawer(S.drawerId, true);
  const a = current(); toast(`New chats open as ${a.name}.`, 2500);
}
async function refreshUsage(id) {
  if (id) { S.usage[id] = { ...(S.usage[id] || {}), checking: true }; renderLive(); }
  const r = await api('/api/usage/refresh', id ? { account: id } : {});
  S.usage = r.usage || S.usage; renderLive();
}
async function resume(id, mode = 'resume', force = false) {
  const a = current();
  const [s] = sessionById(id);
  if (mode === 'resume' && !force && s && s.active && !isRunning(id) &&
      !(await appConfirm('This chat changed in the last few minutes, so it may still be open somewhere, like the desktop app. Opening it twice can mix up its history.\n\nResume anyway?', { ok: 'Resume anyway' }))) return;
  try {
    if (isCodex(s)) { const r = await api('/api/open', { provider: 'codex', sessionId: id, mode }); return reportLaunch(r, mode === 'fork' ? 'Opening a copy in Codex' : 'Resuming in Codex'); }
    const r = await api('/api/open', { account: a.id, sessionId: id, mode, force });
    reportLaunch(r, mode === 'desktop' ? 'Opening in the desktop app' : mode === 'fork' ? `Opening a copy as ${a.name}` : `Resuming as ${a.name}`);
  } catch (err) {
    if (err.reason === 'running' && await appConfirm(`${err.message}\n\nOpen it anyway?`, { ok: 'Open anyway' })) return resume(id, mode, true);
    throw err;
  }
}
async function renameChat(id) {
  const [s] = sessionById(id); if (!s) return;
  const name = await ask('Rename chat', 'Only changes the name shown here. Leave it empty to go back to the original title.', s.title, 'Rename', { maxLength: 120, allowEmpty: true });
  if (name === null) return;
  await api('/api/chat/rename', { sessionId: id, name });
  await loadSessions(); renderPage(); if (S.drawerId === id) openDrawer(id, true);
}
async function copyCommand(id) {
  const r = await api('/api/command', { account: S.acct, sessionId: id });
  try { await navigator.clipboard.writeText(r.command); toast(`Copied a PowerShell command that resumes this chat${isCodex(sessionById(id)[0]) ? ' in Codex' : ''}.`); }
  catch { prompt('Copy this command:', r.command); }
}
async function accountAction(act, id) {
  if (codexAcct(id)) { if (act === 'usage') return refreshUsage(id); if (act === 'web') return openWeb(id); return undefined; }
  const a = S.accounts.find(x => x.id === id) || current();
  if (act === 'use') return useAccount(a.id);
  if (act === 'web') return openWeb(a.id);
  if (act === 'usage') return refreshUsage(a.id);
  if (act === 'signin' || act === 'signin-direct') {
    let email = a.expectEmail;
    if (act === 'signin' || !email) {
      email = await ask(`Sign in to ${a.name}`,
        'Which Claude account should this profile use? A terminal opens with this email filled in, then you finish in your browser. Tip: if your browser is already signed in to a different Claude account, copy the sign-in link into a private window.',
        a.expectEmail || a.email || '', 'Open sign-in', { type: 'email', maxLength: 120, placeholder: 'name@example.com' });
      if (!email) return;
    }
    const r = await api('/api/signin', { account: a.id, email });
    if (r.dryRun) { reportLaunch(r); return reload(); }
    const org = a.pinnedOrg && a.pinnedOrg.email && a.pinnedOrg.email.toLowerCase() === String(email).toLowerCase() ? a.pinnedOrg.name : 'the one whose plan this account should use';
    toast(`Signing ${a.name} in as ${email} in a ${r.how}. Finish in your browser; if it asks which organization to use, choose ${org}. This page picks up the new sign-in by itself.`, 14000);
    return reload();
  }
  if (act === 'lock') {
    const r = await api('/api/accounts/lock', { account: a.id, lock: true });
    await reload(); return toast(`${a.name} is locked to ${r.account.expectEmail}, ${r.account.pinnedOrg.name}. Chats won’t open on any other account or plan.`);
  }
  if (act === 'unlock') {
    if (!(await appConfirm(`Unlock ${a.name}?\n\nChats will open with it no matter which account or plan it’s signed into.`, { ok: 'Unlock' }))) return;
    await api('/api/accounts/lock', { account: a.id, lock: false }); await reload(); return toast(`${a.name} is unlocked.`);
  }
  if (act === 'rename') {
    const name = await ask('Rename account', 'Shown on its card. It doesn’t change anything on your Claude account.', a.name, 'Rename');
    if (name && name !== a.name) { await api('/api/accounts/rename', { account: a.id, name }); await reload(); }
    return;
  }
  if (act === 'signout') {
    if (!(await appConfirm(`Sign ${a.name} out of ${a.email || 'its account'}?\n\nYour chats aren’t affected. You can sign in again any time.`, { ok: 'Sign out', danger: true }))) return;
    await api('/api/signout', { account: a.id }); await reload(); return toast(`${a.name} is signed out.`);
  }
  if (act === 'remove') {
    if (!(await appConfirm(`Remove “${a.name}” from the switcher?\n\nIts sign-in folder stays on disk at ${a.configDir}, and your chats aren’t touched. Adding an account with the same name later brings its sign-in back.`, { ok: 'Remove', danger: true }))) return;
    await api('/api/accounts/remove', { account: a.id }); if (S.acct === a.id) S.acct = null; await reload(); toast(`Removed ${a.name}.`);
  }
}
function ask(title, text, value, okLabel, opts = {}) {
  return new Promise(resolve => {
    const d = $('dlg'), inp = $('dlgInput');
    $('dlgTitle').textContent = title; $('dlgText').textContent = text; $('dlgOk').textContent = okLabel;
    inp.type = opts.type || 'text'; inp.maxLength = opts.maxLength || 40; inp.placeholder = opts.placeholder || '';
    inp.required = !opts.allowEmpty;
    inp.value = value || '';
    d.returnValue = '';
    d.onclose = () => resolve(d.returnValue === 'ok' ? inp.value.trim() : null);
    d.showModal(); inp.select();
  });
}
async function addAccount() {
  const name = await ask('Add a Claude account', 'For another Claude login. Chats, checkpoints, saved notes, skills and settings stay shared, so every account sees the same list. (Codex and ChatGPT have their own card; you don’t add them here.)', '', 'Add account');
  if (!name) return;
  if (/codex|chat\s*gpt|openai|\bgpt\b/i.test(name) && S.codex && S.codex.enabled) {
    if (!(await appConfirm(`“${name}” sounds like Codex.\n\nCodex signs in with your ChatGPT account on its own card, under Accounts and usage.`, { ok: 'Sign in to Codex instead', cancel: `Add “${name}” as a Claude account` }))) { /* add as Claude account */ }
    else return codexSignIn();
  }
  const r = await api('/api/accounts', { name });
  S.acct = r.account.id; store('acct', S.acct);
  await reload();
  await accountAction('signin', r.account.id);
}
