'use strict';
/* Never stuck on a limit. When Claude's account runs out of usage mid-chat, the chat offers to carry
   on as another of your accounts (the same conversation), to hand the work to Codex (which is caught
   up on it), or to say when the account is back. A new chat skips an account that's out. */

// Your other Claude accounts that can take over now, most room first: [{ a, left }].
function roomyAccounts(exceptId) {
  return S.accounts.filter(a => a.id !== exceptId && canLaunch(a))
    .map(a => { const b = binding(usageOf(a.id)); return { a, left: b ? b.left : null }; })
    .filter(x => x.left === null || x.left > 0)
    .sort((x, y) => (y.left === null ? 50 : y.left) - (x.left === null ? 50 : x.left));
}
const LIMIT_NAMES = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet' };
function backAt(iso) {
  const t = Date.parse(iso); if (!t) return '';
  const ms = t - Date.now();
  const clock = new Date(t).toLocaleString([], ms > 20 * 36e5 ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
  if (!(ms > 0)) return clock;
  const h = Math.floor(ms / 36e5), m = Math.max(1, Math.round((ms % 36e5) / 6e4));
  return `${clock} (in ${h ? `${h} h ` : ''}${m} min)`;
}

// src: which of the chat's two ran out ('main' or, in a duo chat, 'comp'). Claude out: carry on as
// another account (the chat's own Claude only), or hand it to Codex. Codex out: hand it to Claude.
// Either way, or carry on by itself when the limit resets (the PC sends "carry on" then).
function renderLimit(ev, src = 'main') {
  if (C.watch) return;
  const prov = provFor(src), other = prov === 'claude' ? 'codex' : 'claude';
  const feed = $c('cFeed');
  cardsOf('.limit-card', src).forEach(x => x.remove());   // only the latest one for each
  const me = src === 'main' && C.info && C.info.accountId;
  const acct = me && S.accounts.find(a => a.id === me);
  const others = prov === 'claude' && src === 'main' ? roomyAccounts(me).slice(0, 2) : [];
  const canHand = other === 'codex' ? codexOK() : (duo() || C.provider === 'claude');
  const auto = liveRender && justNow(ev) && src === 'main' && prov === 'claude' && others.length && (!S.prefs || S.prefs.autoSwitch !== false) ? others[0] : null;
  const card = document.createElement('div');
  card.className = `limit-card${liveRender ? ' fresh' : ''}`;
  card.dataset.src = src;
  card._kind = compKind(src);
  card._ev = ev;
  const who = prov === 'claude' ? (acct ? acct.name : 'Claude’s account') : 'Codex';
  card.innerHTML = `<p class="lm-h"><b>${esc(who)} is out of its ${LIMIT_NAMES[ev.which] || 'usage'} limit.</b>${ev.resetsAt ? ` It’s back at ${esc(backAt(ev.resetsAt))}.` : ''}</p>
    ${others.length || canHand ? '<p class="lm-s">Keep going without waiting:</p>' : ev.resetsAt ? '' : '<p class="lm-s">Nothing else has room right now.</p>'}
    <div class="lm-b">${others.map(x => `<button type="button" class="btn gilt" data-c="limitas" data-acct="${esc(x.a.id)}" title="The same conversation, carried on as ${esc(x.a.name)}">Continue as ${esc(x.a.name)}${x.left !== null ? ` <small>${x.left}% left</small>` : ''}</button>`).join('')}
      ${canHand ? `<button type="button" class="btn" data-c="limithand" data-to="${other}" title="${PROV_NAME[other]} is caught up on this chat and picks up the work">Hand it to ${PROV_NAME[other]}</button>` : ''}
      ${ev.resetsAt ? '<button type="button" class="btn quiet" data-c="limitwait" title="When it resets, it carries on where it left off by itself">Carry on when it’s back</button>' : ''}</div>
    <p class="lm-wait" hidden></p>${auto ? `<p class="lm-auto"><span class="gen-spin" aria-hidden="true"></span>Carrying on as <b>${esc(auto.a.name)}</b> in a moment, the same conversation. <button type="button" class="linkish" data-c="limitnoauto">Let me choose</button></p>` : ''}`;
  withStick(() => feed.appendChild(card));
  // Autopilot (Setup, on unless you turn it off): out of room as it happens, it carries on as the
  // account with the most room by itself, after a moment to say no.
  if (auto) card._auto = setTimeout(() => { if (card.isConnected && card._auto) { card._auto = 0; continueAs(auto.a.id).catch(err => toast(err.message, 8000, null, { tone: 'error' })); } }, 2500);
}
// Choosing anything on the card (wait for the reset, hand it over) calls off the autopilot: it would
// otherwise switch accounts a moment later anyway.
function noAutopilot(el) {
  const card = el && el.closest('.limit-card'); if (!card || !card._auto) return;
  clearTimeout(card._auto); card._auto = 0;
  card.querySelector('.lm-auto')?.remove();
}
// The PC has "carry on when it's back" set for one of them (or not any more).
function renderResumeAt(ev, src) {
  const card = cardsOf('.limit-card', src)[0]; if (!card) return;
  const note = card.querySelector('.lm-wait'), btn = card.querySelector('[data-c="limitwait"]');
  if (ev.at) { note.hidden = false; note.innerHTML = `${esc(PROV_NAME[provFor(src)])} carries on by itself at ${esc(backAt(ev.at).replace(/ \(.*\)$/, ''))}. <button type="button" class="linkish" data-c="limitnowait">Don’t</button>`; if (btn) btn.hidden = true; }
  else { note.hidden = true; if (btn) btn.hidden = false; }
}

// Your last message to Claude, to send again after switching.
function lastToClaude() {
  const u = [...$c('cFeed').querySelectorAll('.umsg:not(.to-partner)')].pop();
  return u ? (RAW.get(u) || '').trim() : '';
}
// Everything stopping a reply would lose: your messages since its last finished reply (the one it was answering,
// and any you sent while it replied: they were waiting their turn, and a stopped chat forgets them). Oldest first,
// to send again as one. '' when that can't be told (no finished reply seen in this chat): then just the last.
function unansweredToClaude() {
  const r = C.lastResult;
  if (!r || r.key !== C.key || !r.at) return '';
  const mine = [...$c('cFeed').querySelectorAll('.umsg:not(.to-partner)')].filter(u => (u._at || 0) > r.at).slice(-10);
  return mine.map(u => (RAW.get(u) || '').trim()).filter(Boolean).join('\n\n');
}
// The same conversation on another account: this chat stops, then resumes as that one, with your
// last message back in the box to send again (when it ran out; asked for from the menu, nothing was lost).
// A Codex chat does the same with your Codex accounts (they share one list of conversations).
async function continueAs(accountId, { outOfUsage = true } = {}) {
  const prov = C.provider === 'codex' ? 'codex' : 'claude';
  const a = prov === 'codex' ? codexAcct(accountId) : S.accounts.find(x => x.id === accountId); if (!a) return;
  const name = a.name || PROV_NAME[prov];
  const id = C.sessionId;
  if (!id) {
    // Not started yet (nothing sent): it starts again as that one, with what you'd typed still in the box.
    if (!C.key) { toast('Send a message first.'); return; }
    if ($c('cFeed').querySelector('.umsg')) { toast('It’s just starting: try again in a moment.'); return; }
    const cwd = C.info && C.info.cwd, typed = $c('cText').value;
    if (!cwd) return;
    await api('/api/chat/stop', { key: C.key, switching: true }).catch(() => {});
    await openChatView({ cwd, mode: 'new', accountId, provider: prov, separate: true });
    if (!ChatUI.isOpen()) return;
    if (typed.trim() && !$c('cText').value.trim()) placeText(typed, true);
    toast(`This chat starts as ${name}.`, 4000);
    return;
  }
  const last = outOfUsage ? unansweredToClaude() || lastToClaude() : '';
  await api('/api/chat/stop', { key: C.key, switching: true }).catch(() => {});
  await openChatView({ sessionId: id, mode: 'resume', accountId, provider: prov });
  if (!ChatUI.isOpen() || C.sessionId !== id) return;
  if (last) putInBox(last);
  // Codex's other account couldn't take the conversation over yet (the one before still had it).
  if (prov === 'codex' && C.info && C.info.accountId && C.info.accountId !== accountId) { toast(`It’s still running as ${(codexAcct(C.info.accountId) || {}).name || 'the same account'}: it couldn’t move to ${name} yet. Try again in a moment.`, 8000); return; }
  toast(`Now running as ${name}.${last ? ' Your last message is in the box: press Enter to send it again.' : ''}`, 6000);
}

/* ---------- the account at the top right: who this chat runs as, and switching it ---------- */
// Why this chat's account can't be changed here, or '' when it can.
function switchBlocked() {
  if (C.watch) return C.watch.source === 'terminal' ? 'This chat is running in a terminal, so it keeps the account it started with there.' : C.provider === 'openclaw' ? 'This chat carries on in OpenClaw, with its own sign-in.' : 'This chat is read-only here. Continue it here first, then choose its account.';
  if (!C.key) return 'This chat isn’t running here.';
  if (isCommander(C.sessionId)) return 'The Commander keeps the account it runs as.';
  if (PAGE_ARGS.get('aide') === '1' || PAGE_ARGS.get('aidepane') === '1') return 'The companion keeps the account it runs as.';
  if (C.provider === 'gemini') return 'Gemini runs as your one Google account (Antigravity’s sign-in), so there’s no other to switch to.';
  if (C.provider !== 'claude' && C.provider !== 'codex') return 'This chat keeps the account it runs as.';
  return '';
}
// The accounts this chat's assistant could run as: [{ id, name, why }] (why: it can't, and the reason).
function switchPool() {
  if (C.provider === 'codex') return codexAccts().map(x => ({ id: x.id, name: x.name || 'Codex', usage: x.kind !== 'ollama', why: S.codex && S.codex.installed === false ? 'Codex isn’t installed' : x.signedIn ? '' : x.kind === 'ollama' ? 'The Ollama app isn’t running' : 'Not signed in' }));
  return S.accounts.map(a => ({ id: a.id, name: a.name, usage: true, why: !a.signedIn ? 'Not signed in' : a.lock && !a.lock.ok ? (a.lockMessage || 'Not on its locked account') : '' }));
}
// Out of usage: when it's back ('' when it has room, or nobody knows).
function outUntil(id) {
  const b = binding(usageOf(id));
  return b && b.left <= 0 ? backAt(b.w && b.w.resetsAt) || 'it resets' : '';
}
function acctMenu(anchor) {
  const no = switchBlocked();
  if (no) return showMenu(anchor, [], { empty: no });
  const me = C.info && C.info.accountId, pool = switchPool(), P = PROV_NAME[C.provider];
  const mine = pool.find(x => x.id === me);
  if (pool.length < 2) {
    return showMenu(anchor, [], { empty: `This chat runs as ${mine ? mine.name : pool[0] ? pool[0].name : P}, your only ${P} account. Add another to switch this chat to it.`, action: { label: `Add a ${P} account`, hint: 'it shows here once it’s signed in', run: () => (C.provider === 'codex' ? addCodexAccount('chatgpt') : addAccount()) } });
  }
  const row = x => {
    const u = usageOf(x.id), d = x.usage && u && u.data && u.data.available ? u.data : null;
    const f = d ? leftOf(d.fiveHour) : null, w = d ? leftOf(d.week) : null, out = !x.why && x.usage ? outUntil(x.id) : '';
    const sub = x.why || (out ? `Out of usage until ${out}` : [f !== null ? `5h ${f}% left` : '', w !== null ? `week ${w}% left` : ''].filter(Boolean).join(' · ') || (!x.usage ? 'No usage limits shown' : u && u.checking ? 'Checking usage…' : 'No usage yet'));
    return {
      checked: x.id === me,
      disabled: !!x.why && x.id !== me, why: x.why,
      html: `${miniDial(x.id, 28)}<span class="m-t"><b>${esc(x.name)}${x.id === me ? ' <span class="tag">this chat</span>' : ''}</b><small class="${out ? 'm-out' : ''}" title="${esc(sub)}">${esc(sub)}</small></span>`,
      run: () => (x.id === me ? undefined : switchAccountTo(x.id)),
    };
  };
  return showMenu(anchor, [{ head: 'Run this chat as' }, ...pool.map(row)]);
}
// A switch asked for while it was replying: it happens when the reply finishes ({ key, id, name }).
// Work it left running in the background (a build, a helper) counts too: stopping would end it.
let switchAfter = null;
const chatBusy = () => C.state === 'busy' || C.state === 'waiting' || (C.state === 'ready' && (C.background || []).length > 0);
async function switchAccountTo(accountId) {
  const x = switchPool().find(p => p.id === accountId); if (!x || x.why) return;
  const P = PROV_NAME[C.provider];
  const out = x.usage ? outUntil(accountId) : '';
  if (out && !(await window.appConfirm(`${x.name} is out of usage until ${out}.\n\nSwitch this chat to it anyway? ${P} can’t reply as ${x.name} until then.`, { ok: `Switch to ${x.name}` }))) return;
  if (chatBusy()) {
    const key = C.key, replying = C.state !== 'ready';   // (ready: its reply is done, work in the background isn't)
    const later = await window.appConfirm(`${P} ${C.state === 'waiting' ? 'is waiting for your answer' : replying ? 'is still replying' : 'is still working in the background'}.\n\nSwitch to ${x.name} when ${replying ? 'this reply finishes' : 'that’s done'}, or stop it now and switch?${replying ? ' Stopping puts your last message back in the box, to send again.' : ''}`, { ok: 'Switch when this reply finishes', cancel: 'Stop it and switch now', escape: null });
    if (later === null || C.key !== key) return;
    if (later) { switchAfter = { key, id: accountId, name: x.name }; showSwitchNote(); switchWhenIdle(); return; }
    switchAfter = null; showSwitchNote();
    await continueAs(accountId, { outOfUsage: replying });
    return;
  }
  switchAfter = null; showSwitchNote();
  await continueAs(accountId, { outOfUsage: false });
}
function showSwitchNote() {
  const n = $c('cSwitchNote'); if (!n) return;
  const on = !!(switchAfter && switchAfter.key === C.key);
  n.hidden = !on;
  n.innerHTML = on ? `Switching to <b>${esc(switchAfter.name)}</b> after this reply · <button type="button" class="linkish" data-c="acctcancel">Cancel</button>` : '';
}
function cancelSwitch() {
  if (!switchAfter) return;
  const { name } = switchAfter;
  switchAfter = null; showSwitchNote();
  toast(`It stays on its account; it won’t switch to ${name}.`, 3000);
}
// Called whenever the chat's state changes (setState): once it's quiet for a moment, the switch happens.
function switchWhenIdle() {
  const w = switchAfter; if (!w) return;
  if (w.key !== C.key) {
    // You left the chat (or it was opened again) before the reply finished: it's called off.
    if (C.key) { switchAfter = null; showSwitchNote(); toast(`Didn’t switch to ${w.name}: that chat was left before its reply finished.`, 6000); }
    return;
  }
  if (chatBusy() || (C.state !== 'ready' && C.state !== 'ended')) return;
  clearTimeout(w.timer);
  // A queued message starts the next reply straight away: only quiet that lasts counts.
  w.timer = setTimeout(() => {
    if (switchAfter !== w || w.key !== C.key || chatBusy() || (C.state !== 'ready' && C.state !== 'ended')) return;
    switchAfter = null; showSwitchNote();
    continueAs(w.id, { outOfUsage: false }).catch(err => toast(err.message, 8000, null, { tone: 'error' }));
  }, 800);
}
// The other one picks up the work (it's caught up on the chat with your message).
function handOver(to) {
  const from = to === 'codex' ? 'Claude' : 'Codex';
  putInBox(`${from} has hit its usage limit. Please pick up the work where it left off.`, to === C.provider ? 'main' : 'comp');
}
// Carry on by itself when the limit resets: the PC keeps the time (server.js resumeAt), so it happens
// whether or not this window is open.
async function waitForReset(ev, src = 'main', cancel = false, key = keyFor(src)) {
  if (!cancel && !(Date.parse(ev.resetsAt) - Date.now() > -60000)) { toast('It should be back already: try sending again.'); return; }
  await api('/api/chat/resume-at', { key, at: ev.resetsAt, ...(cancel ? { cancel: true } : {}) });
}

// A new chat about to open as an account that's out: offer the one with the most room.
async function roomierAccount(a) {
  const b = binding(usageOf(a.id));
  if (!b || b.left > 0) return null;
  const alt = roomyAccounts(a.id)[0];
  if (!alt) return null;
  const ok = await window.appConfirm(`${a.name} is out of usage until ${backAt(b.w && b.w.resetsAt) || 'it resets'}.\n\nStart this chat as ${alt.a.name} instead${alt.left !== null ? ` (${alt.left}% left)` : ''}?`, { ok: `Use ${alt.a.name}`, cancel: `Use ${a.name} anyway` });
  return ok ? alt.a : null;
}
