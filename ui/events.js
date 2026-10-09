'use strict';
/* Clicks, the account dropdown, live updates, confirmations, right-click and the keyboard shortcuts sheet. */

/* ---------- clicks ---------- */
$('nav').addEventListener('click', wrap(async e => {
  const seal = e.target.closest('#seal'); if (seal) return seal.getAttribute('aria-expanded') === 'true' ? closeMenu() : sealMenu(seal);
  const f = e.target.closest('[data-fold]');
  if (f) { const id = f.dataset.fold; if (S.navFold.has(id)) S.navFold.delete(id); else S.navFold.add(id); store('navFold', JSON.stringify([...S.navFold])); return renderNav(); }
  const nc = e.target.closest('[data-navchat]'); if (nc) { document.body.classList.remove('nav-open'); return openChatFromNav(nc.dataset.navchat); }
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (b.dataset.view === 'palette') { document.body.classList.remove('nav-open'); return openPalette(); }
  if (b.dataset.view === 'newproject') { document.body.classList.remove('nav-open'); return openNewProject(); }
  go(b.dataset.view, b.dataset.cwd, b.dataset.prov);
}));
$('brand').addEventListener('click', () => go('hub'));
$('pulse').addEventListener('click', () => hubTo(awaiting().length ? 'secAwait' : 'secWork'));
$('usechip').addEventListener('click', e => { e.stopPropagation(); return $('acctPop').hidden ? openAcctPop() : closeAcctPop(); });

/* ---------- the account dropdown (top bar) ---------- */
function acctBars(id) {
  const u = usageOf(id), d = u && u.data && u.data.available ? u.data : null;
  if (!d) return `<span class="ap-none">${u && u.error ? 'Usage unavailable' : u && u.checking ? 'Checking…' : 'No usage yet'}</span>`;
  const bar = (label, w) => { if (!w) return ''; const l = leftOf(w); return `<span class="ap-bar ${hot(l) ? 'hot' : ''}" title="${esc(label)}: ${l}% left${w.resetsAt ? `, resets ${esc(when(w.resetsAt))}` : ''}"><small>${label}</small><i><b style="width:${l}%"></b></i><em>${l}%</em></span>`; };
  return bar('5h', d.fiveHour) + bar('Week', d.week);
}
function openAcctPop() {
  const pop = $('acctPop');
  const inChat = !!(window.ChatUI && ChatUI.isOpen());
  const chatAcct = inChat && ChatUI.accountId ? ChatUI.accountId() : null;
  const row = a => {
    const on = a.id === S.acct;
    const runs = chatAcct === a.id;
    const status = !a.signedIn ? 'Not signed in' : a.lock && !a.lock.ok ? 'Locked to another plan' : `${a.email || 'Signed in'}${a.plan ? ` · ${a.plan}` : ''}`;
    return `<button type="button" class="ap-row ${on ? 'on' : ''}" data-ap="${esc(a.id)}" style="--ring:${ringById(a.id)}" ${a.signedIn ? '' : 'aria-disabled="true"'}>
      <span class="ap-dial">${miniDial(a.id, 34)}</span>
      <span class="ap-t"><b>${esc(a.name)}${runs ? ' <span class="tag">this chat</span>' : ''}${on ? ' <span class="tag gold">new chats</span>' : ''}</b><small>${esc(status)}</small><span class="ap-bars">${acctBars(a.id)}</span></span></button>`;
  };
  const many = codexAccts().length > 1;
  const cxRow = x => `<button type="button" class="ap-row codex ${many && x.id === S.codex.id ? 'on' : ''}" data-ap="${esc(x.id)}" style="--ring:${codexRing(x.id)}">
      <span class="ap-dial">${miniDial(x.id, 34)}</span>
      <span class="ap-t"><b>${esc(x.name || 'Codex')}${chatAcct === x.id ? ' <span class="tag codex">this chat</span>' : ''}${many && x.id === S.codex.id ? ' <span class="tag gold">new Codex chats</span>' : ''}</b><small>${esc(x.signedIn ? `${x.email || 'Signed in'}${x.plan ? ` · ${x.plan}` : ''}` : x.kind === 'ollama' ? 'Ollama app not running' : 'Not signed in')}</small><span class="ap-bars">${x.signedIn && x.kind !== 'ollama' ? acctBars(x.id) : ''}</span></span></button>`;
  const cx = S.codex && S.codex.enabled ? `<p class="ap-h">${many ? 'Codex: new Codex chats open as' : 'Codex'}</p>${codexAccts().map(cxRow).join('')}` : '';
  pop.innerHTML = `<p class="ap-h">${inChat && chatAcct ? 'Pick the account new chats open as. This chat keeps its own.' : 'New chats open as'}</p>
    <div class="ap-list">${S.accounts.map(row).join('')}</div>${cx}
    <div class="ap-act">
      <button type="button" class="btn sm" data-apx="add">Add an account</button>
      <button type="button" class="btn quiet sm" data-apx="usage">Check usage</button>
      <button type="button" class="btn quiet sm" data-apx="web">Open claude.ai</button>
      <button type="button" class="btn quiet sm" data-apx="hub">All accounts on the hub</button>
    </div>`;
  pop.hidden = false;
  placeAt(pop, $('usechip'));
  $('usechip').setAttribute('aria-expanded', 'true');
  pop.querySelector('.ap-row.on, .ap-row')?.focus();
}
function closeAcctPop() { if ($('acctPop').hidden) return; $('acctPop').hidden = true; $('usechip').setAttribute('aria-expanded', 'false'); }
$('acctPop').addEventListener('click', wrap(async e => {
  const r = e.target.closest('[data-ap]');
  if (r) {
    const id = r.dataset.ap;
    closeAcctPop();
    if (codexAcct(id)) {
      const many = codexAccts().length > 1;
      await setCodexActive(id);
      if (!S.codex.signedIn) return S.codex.kind === 'ollama' ? hubTo('secAccounts') : codexSignIn();
      return many ? toast(`New Codex chats open as ${S.codex.name}.`, 2500) : hubTo('secAccounts');
    }
    const a = S.accounts.find(x => x.id === id);
    if (a && !a.signedIn) { S.acct = id; store('acct', id); renderAll(); return accountAction(a.expectEmail ? 'signin-direct' : 'signin', id); }
    return useAccount(id);
  }
  const x = e.target.closest('[data-apx]'); if (!x) return undefined;
  closeAcctPop();
  if (x.dataset.apx === 'add') return addAccount();
  if (x.dataset.apx === 'usage') { toast('Checking usage for every account…', 2500); return refreshUsage(); }
  if (x.dataset.apx === 'web') return openWeb(current().id);
  if (ChatUI.isOpen()) ChatUI.close();
  return hubTo('secAccounts');
}));
document.addEventListener('mousedown', e => { if (!$('acctPop').hidden && !(e.target.closest && e.target.closest('#acctPop, #usechip'))) closeAcctPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('acctPop').hidden) { closeAcctPop(); $('usechip').focus(); e.stopPropagation(); } }, true);
window.addEventListener('resize', closeAcctPop);
$('seek').addEventListener('click', () => openPalette());
$('setupBtn').addEventListener('click', openSetup);
$('navBack').addEventListener('click', () => { document.body.classList.remove('nav-open'); $('navToggle').setAttribute('aria-expanded', 'false'); });
$('navToggle').addEventListener('click', () => { const on = !document.body.classList.contains('nav-open'); document.body.classList.toggle('nav-open', on); $('navToggle').setAttribute('aria-expanded', String(on)); });

const pageClicks = wrap(async e => {
  const t = e.target;
  // Cards on the hub.
  const card = t.closest('.omen, .qchip');
  const ab = t.closest('[data-a]');
  if (card && ab && card.dataset.k && ab.tagName !== 'FORM') {
    const x = findActivity(card.dataset.k); if (!x) return;
    const p = (x.pending || [])[0];
    switch (ab.dataset.a) {
      case 'open': return openActivity(x);
      case 'seen': markSeen(x); return toast('Marked as read.', 1800);
      case 'resume': markSeen(x); return ChatUI.open({ sessionId: x.sessionId });
      case 'allow': case 'always': case 'deny':
        ab.disabled = true;
        await api('/api/chat/permission', { key: x.key, requestId: p.requestId, decision: ab.dataset.a, message: '' });
        return toast(ab.dataset.a === 'deny' ? `Denied. ${x.title || 'The chat'} will try something else.` : `Allowed. ${x.title || 'The chat'} carries on.`, 2500);
      default: return;
    }
  }
  const wd = t.closest('.w-art[data-world]'); if (wd) return openWorld(wd.dataset.world, wd);
  const ct = t.closest('[data-continue]'); if (ct) { const [cs] = sessionById(ct.dataset.continue); if (cs && isRunning(cs.id) && !liveOf(cs.id)) return ChatUI.watch({ sessionId: cs.id, source: 'terminal' }); return ChatUI.open({ sessionId: ct.dataset.continue }); }
  const dc = t.closest('[data-doc]'); if (dc) return Viewer.open({ path: dc.dataset.doc, cwd: S.folder });
  const gi = t.closest('[data-img]'); if (gi) { const w = S.worlds[S.folder]; return Viewer.open({ path: gi.dataset.img, cwd: S.folder, list: w ? w.images.map(x => x.path) : null }); }
  const wp = t.closest('[data-wprov]'); if (wp) { S.prov = wp.dataset.wprov === 'all' ? null : wp.dataset.wprov; renderNav(); return renderFolder(); }
  const bn = t.closest('[data-banner]'); if (bn) { const w = await api('/api/project/banner', { cwd: S.folder, path: bn.dataset.banner === '-' ? null : bn.dataset.banner }); S.worlds[S.folder] = { ...w, at: Date.now() }; toast(bn.dataset.banner === '-' ? 'Banner reset to the automatic pick.' : 'Banner updated.', 2000); return renderFolder(); }
  const tb = t.closest('[data-wtab]'); if (tb) { S.worldTab = tb.dataset.wtab; return renderWorldBody(); }
  const sp = t.closest('[data-prompt]'); if (sp) { const pr = S.prompts.find(x => x.id === sp.dataset.prompt); if (pr) return startWithPrompt(S.folder, pr); return; }
  const ch = t.closest('[data-chat]');
  if (ch) {
    if (S.drawerId) closeDrawer();
    const q = S.view === 'search' && S.q ? S.q : null;
    await ChatUI.open({ sessionId: ch.dataset.chat });
    if (q && ChatUI.isOpen()) ChatUI.find(q);
    return undefined;
  }
  const wt = t.closest('[data-watch]'); if (wt) { if (S.drawerId) closeDrawer(); return ChatUI.watch({ sessionId: wt.dataset.watch, source: 'terminal' }); }
  const o = t.closest('[data-open]'); if (o) return resume(o.dataset.open, 'resume');
  const m = t.closest('[data-more]'); if (m) return m.getAttribute('aria-expanded') === 'true' ? closeMenu() : chatMenu(m, m.dataset.more);
  const pv = t.closest('[data-preview]'); if (pv) return openDrawer(pv.dataset.preview);
  if (t.closest('[data-dclose]')) return closeDrawer();
  const hero = t.closest('[data-hero]');
  if (hero) {
    if (hero.dataset.hero === 'first') return openActivity(awaiting()[0]);
    if (hero.dataset.hero === 'switch') return useAccount(hero.dataset.acct);
    if (hero.dataset.hero === 'latest') return ChatUI.open({ sessionId: hero.dataset.sid });
  }
  const v = t.closest('[data-view]'); if (v) return go(v.dataset.view, v.dataset.cwd, v.dataset.prov);
  const rf = t.closest('[data-recent]'); if (rf) { S.recentProv = rf.dataset.recent; store('recentProv', S.recentProv); return renderRecent(); }
  const b = t.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'acct-more') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : accountMenu(b, b.dataset.acct);
  if (act === 'add') return addAccount();
  if (act === 'usage-all') return refreshUsage();
  if (act === 'search-again') return openPalette(S.q);
  if (b.dataset.acct || ['signin', 'signin-direct', 'lock', 'unlock'].includes(act)) return accountAction(act, b.dataset.acct);
  const a = current();
  if (act === 'new') return reportLaunch(await api('/api/new', { account: a.id, cwd: S.folder }), `Starting a new chat as ${a.name}`);
  if (act === 'newchat') return ChatUI.open({ cwd: S.folder, mode: 'new' });
  if (act === 'newcodex') return ChatUI.open({ cwd: S.folder, mode: 'new', provider: 'codex' });
  if (act === 'newcodex-term') return reportLaunch(await api('/api/new', { provider: 'codex', cwd: S.folder }), 'Starting a new Codex chat');
  if (b.dataset.acct && act.startsWith('codex-')) await setCodexActive(b.dataset.acct);
  if (act === 'codex-signin') return codexSignIn();
  if (act === 'codex-check') { const r = await api('/api/codex/check', {}); S.codex = r.codex; S.usage = r.usage || S.usage; renderAll(); return toast(S.codex.signedIn ? `${S.codex.name} is ready.` : (S.codex.error || 'Still not ready.'), 4000); }
  if (act === 'codex-install') return codexInstall();
  if (act === 'codex-more') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : codexMenu(b);
  if (act === 'codex-new') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : codexNewMenu(b);
  if (act === 'world-new') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : worldNewMenu(b, b.dataset.cwd);
  if (act === 'world-prompt') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : promptMenu(b, S.folder);
  if (act === 'project-new') return openNewProject();
  if (act === 'world-more') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : worldMenu(b);
  if (act === 'reveal') { const r = await api('/api/reveal', { cwd: S.folder }); if (r.dryRun) toast(`Would run: ${r.script}`); return; }
  if (act === 'browse') return Viewer.open({ path: S.folder, cwd: S.folder });
  if (act === 'pin') { S.pins.has(S.folder) ? S.pins.delete(S.folder) : S.pins.add(S.folder); savePins(); renderNav(); renderPage(); }
});
$('page').addEventListener('click', pageClicks);
$('drawer').addEventListener('click', pageClicks);

// Quick replies from the hub: type on the card, Enter sends, without opening the chat.
async function sendQuick(form) {
  const card = form.closest('.omen'); const x = card && findActivity(card.dataset.k);
  const ta = form.querySelector('textarea'); const text = ta.value.trim();
  if (!x || !text) return;
  form.querySelectorAll('button, textarea').forEach(el => { el.disabled = true; });
  try {
    await api('/api/chat/send', { key: x.key, text });
    ta.value = ''; markSeen(x);
    toast(`Sent to ${x.title || 'the chat'}.`, 2200);
  } finally { form.querySelectorAll('button, textarea').forEach(el => { el.disabled = false; }); }
}
$('page').addEventListener('submit', e => { const f = e.target.closest('form.qr'); if (!f) return; e.preventDefault(); wrap(sendQuick)(f); });
$('page').addEventListener('keydown', e => {
  if (e.target.matches('form.qr textarea')) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wrap(sendQuick)(e.target.closest('form')); }
    return;
  }
  if (e.target.matches('.wt') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const tabs = [...document.querySelectorAll('.wtabs .wt')], i = tabs.indexOf(e.target);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); S.worldTab = tabs[j].dataset.wtab; renderWorldBody(); tabs[j].focus(); return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const row = document.activeElement.closest('.row'); if (!row) return;
  const btns = [...$('page').querySelectorAll('.r-title')];
  const i = btns.indexOf(row.querySelector('.r-title'));
  btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); e.preventDefault();
});
$('page').addEventListener('input', e => { if (e.target.id === 'docFilter') { S.docFilter = e.target.value; return filterDocs(); } if (e.target.matches('form.qr textarea')) { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; } });

document.addEventListener('keydown', e => {
  const typing = e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('palette').hidden ? openPalette() : closePalette(); }
  if (!$('palette').hidden || document.querySelector('dialog[open]')) return;
  if (e.key === '/' && !typing && !document.body.classList.contains('chat-open')) { e.preventDefault(); return openPalette(); }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return; }
    if (!$('drawer').hidden && $('menu').hidden) { const id = S.drawerId; closeDrawer(); document.querySelector(`[data-preview="${CSS.escape(id || '')}"]`)?.focus(); }
  }
});

/* ---------- live updates ---------- */
let es = null, sessTimer = null;
// Pages behind the chat window, a dialog or a menu wait until they're visible again.
const idle = () => !document.hidden && !document.body.classList.contains('chat-open') && !document.querySelector('dialog[open]') && $('menu').hidden;
function connectLive() {
  try { es = new EventSource(`/api/events?token=${TOKEN}`); } catch { return; }
  es.onopen = () => { S.connected = true; renderLivePill(); Promise.all([loadActivity(), loadUsage()]).then(() => { watchActivity(); renderLive(); }).catch(() => {}); };
  es.onerror = () => { S.connected = false; renderLivePill(); setTimeout(() => api('/api/state').catch(() => {}), 4000); };
  es.addEventListener('sessions', () => {
    clearTimeout(sessTimer);
    sessTimer = setTimeout(wrap(async () => {
      await loadSessions(); renderNav();
      if (window.ChatUI && ChatUI.sessionsChanged) ChatUI.sessionsChanged();
      if (S.view === 'search') return;
      if (S.view === 'hub') { if ($('recentList') || !S.projects.length) renderHubLists(); else renderHub(); renderLive(); } else renderPage();
      if (S.drawerId) openDrawer(S.drawerId, true);
    }), 300);
  });
  es.addEventListener('accounts', wrap(async () => { await loadState(); renderNav(); if (S.view === 'hub') renderLive(); else renderPage(); codexLoginProgress(); if (window.ChatUI && ChatUI.refreshCrew) ChatUI.refreshCrew(); }));
  es.addEventListener('running', e => { try { S.running = JSON.parse(e.data); } catch { /* keep */ } if (S.view !== 'hub' && S.view !== 'search' && idle()) renderPage(); renderNav(); });
  es.addEventListener('live', e => { try { S.live = JSON.parse(e.data); } catch { /* keep */ } if (S.view !== 'hub' && S.view !== 'search' && idle()) renderPage(); });
  es.addEventListener('activity', e => { try { S.activity = keepOrder('running', JSON.parse(e.data).list || [], activityIds); } catch { return; } watchActivity(); renderLive(); renderNav(); });
  es.addEventListener('usage', e => { try { S.usage = JSON.parse(e.data) || {}; } catch { return; } renderLive(); renderNav(); if (window.ChatUI && ChatUI.refreshUsage) ChatUI.refreshUsage(); });
}
setInterval(() => { if (idle() && S.view === 'hub' && !document.activeElement.closest('form.qr')) renderLive(true); else renderBar(); }, 60000);
window.addEventListener('focus', () => { watchActivity(); renderLive(); });

/* ---------- confirmations ---------- */
// Asks before something that's hard to undo. The first paragraph is the question; the rest explains.
function appConfirm(text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  let d = $('confirmDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="confirmDlg" class="confirm-dlg"><form method="dialog"><h3 id="cfQ"></h3><p id="cfX"></p><div class="d-row"><button class="btn" value="cancel" id="cfNo"></button><button class="btn prime" value="ok" id="cfYes"></button></div></form></dialog>`);
    d = $('confirmDlg');
    // The answer is taken the moment it's given, so a question asked right after can't pick up this one's.
    const answer = v => { const r = d._resolve; d._resolve = null; if (r) r(v); };
    d.querySelector('form').addEventListener('submit', e => answer(e.submitter?.value === 'ok'));
    // Esc answers this question only, never the dialog underneath it.
    d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); d.close('cancel'); } });
    d.addEventListener('close', () => { if (!d.open) answer(d.returnValue === 'ok'); });
  }
  const [q, ...rest] = String(text).split(/\n\n/);
  $('cfQ').textContent = q; $('cfX').textContent = rest.join('\n\n'); $('cfX').hidden = !rest.length;
  $('cfYes').textContent = ok; $('cfNo').textContent = cancel;
  $('cfYes').className = `btn ${danger ? 'danger-prime' : 'prime'}`;
  d.returnValue = '';
  if (d._resolve) d._resolve(false);
  return new Promise(resolve => {
    d._resolve = resolve;
    if (!d.open) d.showModal();
    $(danger ? 'cfNo' : 'cfYes').focus();
  });
}
window.appConfirm = appConfirm;
async function quitApp() {
  if (!(await appConfirm('Quit Session Switcher?\n\nChats in terminals keep running; chats in its window stop. Start it again from its shortcut.', { ok: 'Quit', danger: true }))) return;
  await api('/api/quit', {}); document.body.innerHTML = '<p style="padding:40px;font-family:var(--f-body)">Session Switcher has quit. You can close this window.</p>';
}

/* ---------- right-click (and long-press on a phone) ---------- */
// Every chat, project, card and picture has its own menu; empty space gets the app's menu.
// Shift+right-click still opens the browser's own menu, and text boxes keep theirs.
async function copyText(text, what = 'Copied.') {
  try { await navigator.clipboard.writeText(text); toast(what, 1600); } catch { prompt('Copy this:', text); }
}
function projectItems(cwd) {
  const p = S.projects.find(x => x.cwd === cwd); if (!p) return [];
  const a = current();
  return [
    { glyph: '❖', label: `Open ${p.name}`, run: () => go('folder', cwd) },
    { glyph: S.pins.has(cwd) ? '☆' : '★', label: S.pins.has(cwd) ? 'Unpin from the sidebar' : 'Pin to the sidebar', run: () => togglePin(cwd) },
    ...(p.sessions[0] && p.exists ? [{ glyph: '❝', label: 'Continue the latest chat', hint: p.sessions[0].title, run: () => ChatUI.open({ sessionId: p.sessions[0].id }) }] : []),
    '-',
    { glyph: '✦', label: 'New Claude chat', hint: `as ${a.name}`, disabled: !canLaunch(a) || !p.exists, why: a.lockMessage || 'Sign in first', run: () => ChatUI.open({ cwd, mode: 'new' }) },
    ...(S.codex && S.codex.enabled ? [{ glyph: '◆', label: 'New Codex chat', disabled: !codexReady() || !p.exists, why: 'Sign in to Codex first', run: () => ChatUI.open({ cwd, mode: 'new', provider: 'codex' }) }] : []),
    ...(S.prompts.length ? [{ glyph: '❡', label: 'Start with a prompt…', disabled: !p.exists, run: () => showMenu(Ctx.at, worldNewItems(cwd).filter(x => x !== '-' && /^Start with|Edit prompts/.test(x.label || ''))) }] : []),
    { glyph: '§', label: 'Rules and tools…', hint: 'CLAUDE.md · AGENTS.md · MCP', disabled: !p.exists, why: 'The folder is gone', run: () => openRules(cwd) },
    '-',
    { label: S.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer', disabled: !p.exists || window.REMOTE, why: window.REMOTE ? 'Only on the PC' : 'The folder is gone', run: async () => { const r = await api('/api/reveal', { cwd }); if (r.dryRun) toast(`Would run: ${r.script}`); } },
    { label: 'Browse files', disabled: !p.exists, run: () => Viewer.open({ path: cwd, cwd }) },
    { label: 'Copy folder path', run: () => copyText(cwd) },
    ...(p.added && !p.sessions.length ? ['-', { label: 'Remove from the list', hint: 'the folder itself stays', danger: true, run: async () => { await api('/api/project/forget', { cwd }); await loadSessions(); renderAll(); } }] : []),
  ];
}
function activityItems(x) {
  const st = statusOf(x);
  return [
    { glyph: '❝', label: x.source === 'app' ? 'Open the chat' : x.source === 'terminal' ? 'Watch it live' : 'Read it here', run: () => { markSeen(x); return openActivity(x); } },
    ...(st === 'reply' ? [{ glyph: '✓', label: 'Mark as read', run: () => { markSeen(x); renderLive(true); renderNav(); } }] : []),
    ...(x.source === 'app' && x.key && x.phase !== 'ended' ? [{ label: 'Stop this chat', danger: true, run: () => api('/api/chat/stop', { key: x.key }) }] : []),
    ...(x.sessionId && !x.parentKey ? ['-', favItem(x.sessionId), ...chatItems(x.sessionId).filter(i => i === '-' || !/^(Return|Open in the chat window)/.test(i.label))] : []),
    ...(x.sessionId ? ['-', { label: 'Copy chat ID', run: () => copyText(x.sessionId) }] : []),
  ];
}
function appItems() {
  const light = Look.isLight();
  return [
    { glyph: '✦', label: 'Search everything', keys: 'Ctrl K', run: () => openPalette() },
    { glyph: '+', label: 'New project', run: () => openNewProject() },
    { glyph: '◉', label: 'The hub', run: () => go('hub') },
    { glyph: '✧', label: 'Recent chats', run: () => go('recent') },
    '-',
    { glyph: light ? '☾' : '☀', label: light ? 'Dark mode' : 'Light mode', run: () => Look.set({ mode: light ? 'dark' : 'light' }) },
    { glyph: '◐', label: 'Appearance…', run: () => openSetup('look') },
    { glyph: '⚙', label: 'Setup', run: () => openSetup() },
    { glyph: '?', label: 'Keyboard shortcuts', keys: '?', run: () => openShortcuts() },
    '-',
    { label: 'Reload the window', keys: 'F5', run: () => location.reload() },
  ];
}
function linkItems(a) {
  const url = a.href;
  return [
    { glyph: '↗', label: 'Open link', hint: a.host, run: () => window.open(url, '_blank', 'noopener') },
    { label: 'Copy link', run: () => copyText(url) },
  ];
}
const Ctx = { at: null };
function contextItems(t) {
  // The chat window knows its own pieces (replies, code, pictures, files, the crew).
  if (window.ChatUI && ChatUI.isOpen() && t.closest('#chat')) { const it = ChatUI.contextItems(t, Ctx.at); if (it) return it; }
  const withFav = id => [favItem(id), '-', ...chatItems(id), '-', { label: 'Copy chat ID', run: () => copyText(id) }];
  const nc = t.closest('[data-navchat]'); if (nc) return [{ glyph: '❝', label: 'Open', run: () => openChatFromNav(nc.dataset.navchat) }, ...withFav(nc.dataset.navchat)];
  const row = t.closest('[data-row]'); if (row) return withFav(row.dataset.row);
  const pv = t.closest('[data-preview], [data-continue]'); if (pv) return withFav(pv.dataset.preview || pv.dataset.continue);
  const card = t.closest('#awaitList > [data-k], #board > [data-k], #quietList > [data-k], #cRailList > [data-k]');
  if (card) { const x = findActivity(card.dataset.k); if (x) return activityItems(x); }
  const world = t.closest('#atlas > [data-k], [data-world], .nav-i[data-cwd]');
  if (world) { const cwd = world.dataset.world || world.dataset.cwd || (world.dataset.k !== '+new' ? world.dataset.k : null); if (cwd) return projectItems(cwd); }
  const acct = t.closest('[data-acct-card], [data-acct]'); const aid = acct && (acct.dataset.acctCard || acct.dataset.acct); if (aid && S.accounts.some(a => a.id === aid)) return accountItems(aid);
  if (t.closest('.codex-card')) return null;
  if (t.closest('#usechip')) { openAcctPop(); return []; }
  const link = t.closest('a[href^="http"]'); if (link) return linkItems(link);
  if (t.closest('dialog[open], .palette:not([hidden]), #acctPop')) return null;
  return appItems();
}
document.addEventListener('contextmenu', e => {
  if (e.shiftKey || e.defaultPrevented) return;
  const t = e.target;
  if (!(t instanceof Element) || t.closest('input, textarea, select, [contenteditable="true"]')) return;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // On a phone, a long press on text is for selecting it; only cards, pictures and controls get a menu.
  if (coarse && !t.closest('[data-row], [data-k], [data-world], .world, .gen, .thumb, .crew, .ri, .af-file, .umsg, .turn .who, .tool > summary, .nav-i')) return;
  if (e.button !== 2 && !e.clientX && !e.clientY) { const r = t.getBoundingClientRect(); Ctx.at = { x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(r.height, 28) }; }
  else Ctx.at = { x: e.clientX, y: e.clientY };
  const items = contextItems(t);
  if (items === null) return;
  e.preventDefault();
  if (items.length) showMenu(Ctx.at, items);
});

/* ---------- keyboard shortcuts sheet (press ?) ---------- */
function openShortcuts() {
  let d = $('keysDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="keysDlg" class="keys-dlg" aria-labelledby="keysTitle"><div class="setup-head"><h3 id="keysTitle">Keyboard shortcuts</h3><button class="icon" data-keys-close aria-label="Close">✕</button></div>
      <div class="keys-body">${[
        ['Anywhere', [['Ctrl K', 'Search chats, projects, documents, prompts and actions'], ['?', 'This list'], ['Right-click', 'Options for whatever you clicked (Shift for the browser’s menu)'], ['Esc', 'Close what’s open']]],
        ['In a chat', [['Enter', 'Send'], ['Shift Enter', 'New line'], ['Ctrl F', 'Find in this chat'], ['Ctrl .', 'Write to Claude or Codex'], ['@codex', 'Send one message to Codex'], ['/model sonnet', 'Switch model'], ['/effort high', 'Switch effort'], ['/', 'Pick a saved prompt'], ['Esc', 'Stop the one you’re writing to'], ['Alt ↑ Alt ↓', 'Switch between running chats'], ['End', 'Jump to the latest message']]],
        ['Pictures', [['← →', 'Step through a project’s pictures']]],
      ].map(([h, rows]) => `<section><p class="d-h">${esc(h)}</p><dl>${rows.map(([k, v]) => `<dt><kbd class="kbd">${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`).join('')}</div></dialog>`);
    d = $('keysDlg');
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-keys-close]')) d.close(); });
  }
  d.showModal();
}
document.addEventListener('keydown', e => {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault(); openShortcuts();
});

// On a phone (through phone access), hide what only makes sense at the PC.
if (window.REMOTE) document.body.classList.add('remote');
if (window.Android || / SessionSwitcherAndroid\//.test(navigator.userAgent)) document.body.classList.add('android');
// iPhone and iPad (Safari or the Home Screen app): same touch tweaks as the Android app.
if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) document.body.classList.add('android', 'ios');
// The Android app's Back button: close whatever is on top. Returns true if something closed.
window.__mobileBack = () => {
  if (!$('cLight')?.hidden) { $('cLight').hidden = true; return true; }
  if (!$('menu').hidden) { closeMenu(); return true; }
  if (!$('acctPop').hidden) { closeAcctPop(); return true; }
  if (!$('palette').hidden) { closePalette(); return true; }
  for (const d of document.querySelectorAll('dialog[open]')) { d.close(); return true; }
  if (!$('drawer').hidden) { closeDrawer(); return true; }
  if (window.ChatUI && ChatUI.back()) return true;
  if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return true; }
  if (S.view !== 'hub') { go('hub'); return true; }
  return false;
};

applyMotion();
petals();
renderLivePill();
wrap(async () => { await Promise.all([reload(), loadPrompts()]); connectLive(); watchActivity(); loadHealth(false).catch(() => {}); })();
