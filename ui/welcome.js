'use strict';
/* Welcome back: after a while away (or a night off), the hub opens with what happened meanwhile:
   replies that came in, chats waiting for your OK, ones still at work, and one click back to the chat
   you were last in. It goes once you've acted on it or closed it. */

const AWAY_MS = 20 * 60 * 1000;
const Welcome = { card: null };
// When this window was last looked at, kept on this device (a phone and a PC each have their own).
const seenAt = () => Number(store('seen-at')) || 0;
const noteSeen = () => { if (!document.hidden && document.hasFocus()) store('seen-at', String(Date.now())); };
// The chat you were last in, for "pick up where you left off".
function noteLastChat(sessionId, title, folder) { if (sessionId) store('last-chat', JSON.stringify({ sessionId, title: title || '', folder: folder || '', at: Date.now() })); }
const lastChat = () => { try { return JSON.parse(store('last-chat') || 'null'); } catch { return null; } };

// Back after a while: the card is worked out from when you were last here.
function checkAway() {
  const was = seenAt(), now = Date.now();
  if (was && now - was >= AWAY_MS && !Welcome.card) Welcome.card = { since: was, at: now };
  noteSeen();
  if (Welcome.card && S.view === 'hub' && !(window.ChatUI && ChatUI.isOpen())) renderWelcome();
}
setInterval(noteSeen, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) return; checkAway(); });
window.addEventListener('focus', checkAway);
window.addEventListener('blur', noteSeen);
window.addEventListener('pagehide', noteSeen);

function welcomeHtml() {
  const w = Welcome.card; if (!w) return '';
  const since = w.since;
  const top = S.activity.filter(x => !x.parentKey);
  const replies = top.filter(x => ownStatus(x) === 'reply' && (x.finishedAt || 0) >= since);
  const needs = S.activity.filter(x => NEEDS.has(ownStatus(x)));
  const working = atWork();
  const last = lastChat();
  const lastOk = last && allSessions().some(([s]) => s.id === last.sessionId);
  if (!replies.length && !needs.length && !working.length && !lastOk) return '';
  const bits = [];
  if (replies.length) bits.push(`<b>${replies.length}</b> ${replies.length === 1 ? 'reply came in' : 'replies came in'}`);
  if (needs.length) bits.push(`<b>${needs.length}</b> ${needs.length === 1 ? 'needs your OK' : 'need your OK'}`);
  if (working.length) bits.push(`<b>${working.length}</b> still at work`);
  const chips = [...needs, ...replies].slice(0, 4).map(x => `<button class="wb-chip ${NEEDS.has(ownStatus(x)) ? 'needs' : ''}" data-welcome="open" data-k="${esc(keyOf(x))}" title="${esc(x.folder || '')}"><span class="${NEEDS.has(ownStatus(x)) ? 'gilt-dot' : 'reply-dot'}" aria-hidden="true"></span>${esc(x.title || 'Untitled chat')}</button>`).join('');
  return `<section class="welcome" aria-label="Welcome back">
    <div class="wb-in">
      <p class="eyebrow">${esc(voice('Welcome back'))} · away ${esc(dur(w.at - since))}</p>
      <p class="wb-h">${bits.length ? `While you were away, ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Nothing changed while you were away.'}</p>
      ${chips ? `<div class="wb-chips">${chips}</div>` : ''}
    </div>
    <div class="wb-act">
      ${lastOk ? `<button class="btn prime" data-welcome="continue" data-sid="${esc(last.sessionId)}" title="${esc(last.folder || '')}">Back to “${esc(last.title.length > 38 ? `${last.title.slice(0, 37)}…` : last.title || 'your last chat')}”</button>` : ''}
      <button class="icon wb-x" data-welcome="dismiss" aria-label="Close" title="Close">✕</button>
    </div>
  </section>`;
}
function renderWelcome() {
  const slot = $('welcomeSlot'); if (!slot) return;
  const h = welcomeHtml();
  if (slot._h === h) return;
  const fresh = !slot._h && h;
  slot.innerHTML = h; slot._h = h;
  if (fresh && motionOk()) slot.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function dropWelcome() {
  Welcome.card = null;
  const slot = $('welcomeSlot'); if (!slot || !slot.firstElementChild) return;
  const done = () => { slot.innerHTML = ''; slot._h = ''; };
  if (!motionOk()) return done();
  slot.firstElementChild.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 200, easing: 'ease-in' }).finished.then(done, done);
  return undefined;
}
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('[data-welcome]'); if (!b) return;
  const what = b.dataset.welcome;
  if (what === 'dismiss') return dropWelcome();
  if (what === 'continue') { dropWelcome(); return ChatUI.open({ sessionId: b.dataset.sid }); }
  if (what === 'open') {
    const x = S.activity.find(y => keyOf(y) === b.dataset.k);
    dropWelcome();
    if (x) return openActivity(x);
  }
  return undefined;
}));
