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

function renderLimit(ev) {
  if (C.watch || C.provider !== 'claude') return;
  const feed = $c('cFeed');
  feed.querySelectorAll('.limit-card').forEach(x => x.remove());   // only the latest one
  const me = C.info && C.info.accountId;
  const acct = S.accounts.find(a => a.id === me);
  const others = roomyAccounts(me).slice(0, 2);
  const card = document.createElement('div');
  card.className = `limit-card${liveRender ? ' fresh' : ''}`;
  card._ev = ev;
  card.innerHTML = `<p class="lm-h"><b>${esc(acct ? acct.name : 'This account')} is out of its ${LIMIT_NAMES[ev.which] || 'usage'} limit.</b>${ev.resetsAt ? ` It’s back at ${esc(backAt(ev.resetsAt))}.` : ''}</p>
    ${others.length || codexOK() ? '<p class="lm-s">Keep going without waiting:</p>' : '<p class="lm-s">None of your other accounts has room right now.</p>'}
    <div class="lm-b">${others.map(x => `<button type="button" class="btn gilt" data-c="limitas" data-acct="${esc(x.a.id)}" title="The same conversation, carried on as ${esc(x.a.name)}">Continue as ${esc(x.a.name)}${x.left !== null ? ` <small>${x.left}% left</small>` : ''}</button>`).join('')}
      ${codexOK() ? '<button type="button" class="btn" data-c="limitcodex" title="Codex is caught up on this chat and picks up the work">Hand it to Codex</button>' : ''}
      ${ev.resetsAt ? '<button type="button" class="btn quiet" data-c="limitwait">Tell me when it’s back</button>' : ''}</div>`;
  withStick(() => feed.appendChild(card));
}

// Your last message to Claude, to send again after switching.
function lastToClaude() {
  const u = [...$c('cFeed').querySelectorAll('.umsg:not(.to-codex)')].pop();
  return u ? (RAW.get(u) || '').trim() : '';
}
// The same conversation on another account: this chat stops, then resumes as that one, with your
// last message back in the box to send again.
async function continueAs(accountId) {
  const id = C.sessionId; if (!id) { toast('Send a message first.'); return; }
  const a = S.accounts.find(x => x.id === accountId); if (!a) return;
  const last = lastToClaude();
  await api('/api/chat/stop', { key: C.key }).catch(() => {});
  await open({ sessionId: id, mode: 'resume', accountId, provider: 'claude' });
  if (!ChatUI.isOpen() || C.sessionId !== id) return;
  if (last) putInBox(last);
  toast(`Now running as ${a.name}.${last ? ' Your last message is in the box: press Enter to send it again.' : ''}`, 6000);
}
function handToCodex() {
  if (!codexOK()) return;
  putInBox('Claude has hit its usage limit. Please pick up the work where it left off.', 'comp');
}
function waitForReset(ev) {
  const ms = Date.parse(ev.resetsAt) - Date.now();
  if (!(ms > 0)) { toast('It should be back already: try sending again.'); return; }
  const acct = S.accounts.find(a => a.id === (C.info && C.info.accountId));
  const name = acct ? acct.name : 'Your account';
  setTimeout(() => { toast(`${name}’s usage is back. You can carry on.`, 12000); try { chime('needs'); } catch { /* no sound */ } }, Math.min(ms + 15000, 2 ** 31 - 1));
  toast(`I’ll tell you at ${backAt(ev.resetsAt).replace(/ \(.*\)$/, '')}.`, 3500);
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
