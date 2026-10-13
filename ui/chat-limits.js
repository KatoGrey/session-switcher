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
  feed.querySelectorAll(`.limit-card[data-src="${src}"]`).forEach(x => x.remove());   // only the latest one for each
  const me = src === 'main' && C.info && C.info.accountId;
  const acct = me && S.accounts.find(a => a.id === me);
  const others = prov === 'claude' && src === 'main' ? roomyAccounts(me).slice(0, 2) : [];
  const canHand = other === 'codex' ? codexOK() : (duo() || C.provider === 'claude');
  const auto = liveRender && src === 'main' && prov === 'claude' && others.length && (!S.prefs || S.prefs.autoSwitch !== false) ? others[0] : null;
  const card = document.createElement('div');
  card.className = `limit-card${liveRender ? ' fresh' : ''}`;
  card.dataset.src = src;
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
  if (auto) card._auto = setTimeout(() => { if (card.isConnected && card._auto) { card._auto = 0; continueAs(auto.a.id).catch(err => toast(err.message)); } }, 2500);
}
// The PC has "carry on when it's back" set for one of them (or not any more).
function renderResumeAt(ev, src) {
  const card = $c('cFeed').querySelector(`.limit-card[data-src="${src}"]`); if (!card) return;
  const note = card.querySelector('.lm-wait'), btn = card.querySelector('[data-c="limitwait"]');
  if (ev.at) { note.hidden = false; note.innerHTML = `${esc(PROV_NAME[provFor(src)])} carries on by itself at ${esc(backAt(ev.at).replace(/ \(.*\)$/, ''))}. <button type="button" class="linkish" data-c="limitnowait">Don’t</button>`; if (btn) btn.hidden = true; }
  else { note.hidden = true; if (btn) btn.hidden = false; }
}

// Your last message to Claude, to send again after switching.
function lastToClaude() {
  const u = [...$c('cFeed').querySelectorAll('.umsg:not(.to-partner)')].pop();
  return u ? (RAW.get(u) || '').trim() : '';
}
// The same conversation on another account: this chat stops, then resumes as that one, with your
// last message back in the box to send again.
async function continueAs(accountId) {
  const id = C.sessionId; if (!id) { toast('Send a message first.'); return; }
  const a = S.accounts.find(x => x.id === accountId); if (!a) return;
  const last = lastToClaude();
  await api('/api/chat/stop', { key: C.key }).catch(() => {});
  await openChatView({ sessionId: id, mode: 'resume', accountId, provider: 'claude' });
  if (!ChatUI.isOpen() || C.sessionId !== id) return;
  if (last) putInBox(last);
  toast(`Now running as ${a.name}.${last ? ' Your last message is in the box: press Enter to send it again.' : ''}`, 6000);
}
// The other one picks up the work (it's caught up on the chat with your message).
function handOver(to) {
  const from = to === 'codex' ? 'Claude' : 'Codex';
  putInBox(`${from} has hit its usage limit. Please pick up the work where it left off.`, to === C.provider ? 'main' : 'comp');
}
// Carry on by itself when the limit resets: the PC keeps the time (server.js resumeAt), so it happens
// whether or not this window is open.
async function waitForReset(ev, src = 'main', cancel = false) {
  if (!cancel && !(Date.parse(ev.resetsAt) - Date.now() > -60000)) { toast('It should be back already: try sending again.'); return; }
  await api('/api/chat/resume-at', { key: keyFor(src), at: ev.resetsAt, ...(cancel ? { cancel: true } : {}) });
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
