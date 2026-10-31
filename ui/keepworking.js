'use strict';
/* Keep it working until a time you choose: a chat that's gone quiet is told to carry on, each of a crew by itself.
   The PC does it (lib/keepworking.js), whatever this window does, so it can run all night. */

const keepChatOf = key => S.activity.find(x => x.key === key) || null;
const keepOf = key => { const x = keepChatOf(key); return x && x.keep ? x.keep : null; };
// A time, with its day if it isn't soon.
function keepClock(t) {
  const far = t - Date.now() > 20 * 36e5;
  return new Date(t).toLocaleString([], far ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
}
const keepTimes = n => `${n} check-in${n === 1 ? '' : 's'}`;
function keepSays(k) {
  const mins = k.nextAt ? Math.ceil((k.nextAt - Date.now()) / 6e4) : 0;
  const now = k.state === 'out' ? `waiting for usage, back ${keepClock(k.backAt || k.nextAt)}`
    : k.state === 'asking' ? 'waiting on you'
    : k.state === 'closed' ? (k.error ? `can’t open yet: ${k.error}` : `opens again ${mins > 0 ? `in ${mins} min` : 'soon'}`)
    : k.state === 'opening' ? 'opening again'
    : (k.state === 'waiting' || k.state === 'working') && k.nextAt ? `next check-in ${mins > 0 ? `in ${mins} min` : 'now'}`
    : '';
  return [now, k.nudges ? `${keepTimes(k.nudges)} so far` : '', k.error && k.state !== 'closed' ? k.error : ''].filter(Boolean).join(' · ');
}
// The line over an open chat that's being kept at it.
function renderKeep() {
  const bar = typeof $c === 'function' ? $c('cKeep') : null; if (!bar) return;
  const k = typeof C !== 'undefined' && C.key && !C.watch ? keepOf(C.key) : null;
  bar.hidden = !k;
  if (!k) { bar._h = ''; return; }
  const h = `<span class="ck-t"><span class="ck-g" aria-hidden="true">⟳</span>Keeps working until <b>${esc(keepClock(k.until))}</b></span><span class="ck-s">${esc(keepSays(k))}</span><span class="spacer"></span><button type="button" class="linkish" data-keep-open>Change</button><button type="button" class="linkish" data-keep-off>Turn off</button>`;
  if (bar._h !== h) { bar.innerHTML = h; bar._h = h; }
}

const KeepDlg = { key: null, keys: null, quiet: 5, how: 'parallel' };
const QUIET_CHOICES = [[2, '2 min'], [5, '5 min'], [15, '15 min'], [30, '30 min']];
const keepLocal = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function keepTomorrow(hour = 8) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, 0, 0, 0); return d.getTime(); }
// keys: several chats at once (the open ones in a project or a group, or all of them).
function openKeepDialog({ key = C.key, title = C.title, how = null, keys = null } = {}) {
  closeMenu(); closePalette();
  if (keys && keys.length === 1) { key = keys[0]; title = null; keys = null; }
  if (keys ? !keys.length : !key) return toast('Send a message first: there’s nothing to keep going yet.', 3500);
  if (!$('keepDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="keepDlg" class="many-dlg keep-dlg" aria-labelledby="keepTitle"><form id="keepForm" novalidate>
      <div class="nc-head"><h3 id="keepTitle">Keep it working</h3><button type="button" class="icon" data-keep="close" aria-label="Close">✕</button></div>
      <p class="many-note" id="keepWho"></p>
      <p class="many-note keep-room" id="keepRoom" hidden></p>
      <div role="group" aria-labelledby="keepUntilL"><label class="nc-l" id="keepUntilL" for="keepUntil">Until</label>
        <div class="nc-seg keep-soon"><button type="button" data-keep-in="1">1 hour</button><button type="button" data-keep-in="3">3 hours</button><button type="button" data-keep-in="8">8 hours</button><button type="button" data-keep-at="tomorrow">8:00 tomorrow</button></div>
        <input id="keepUntil" type="datetime-local"></div>
      <div role="group" aria-labelledby="keepQuietL"><span class="nc-l" id="keepQuietL">Check in once it’s been quiet for</span>
        <div class="nc-seg" id="keepQuiet">${QUIET_CHOICES.map(([v, l]) => `<button type="button" data-keep-quiet="${v}">${l}</button>`).join('')}</div></div>
      <div role="group" aria-labelledby="keepHowL" id="keepHowBox"><span class="nc-l" id="keepHowL">How they’re told</span>
        <div class="nc-seg" id="keepHow"><button type="button" data-keep-how="parallel">Each when it’s quiet</button><button type="button" data-keep-how="turns">In turns, when all are</button></div></div>
      <div><label class="nc-l" for="keepNote">What it should carry on with <small>(optional, said each time)</small></label><textarea id="keepNote" rows="2" placeholder="The save system, then the map."></textarea></div>
      <p class="many-note">It leaves alone anything that’s working or needs you. Each check-in uses a little of its usage; out of usage, it moves to your account with room, or waits for the reset. It stops at the time, when nobody has anything left to do, or when you press Stop.</p>
      <p class="keep-err" id="keepErr" role="alert" hidden></p>
      <div class="nc-foot"><button type="button" class="btn quiet" data-keep="off" id="keepOff" hidden>Turn off</button><span class="spacer"></span><button type="button" class="btn" data-keep="close">Cancel</button><button type="submit" class="btn prime" id="keepGo">Keep it working</button></div>
    </form></dialog>`);
    const d = $('keepDlg');
    d.addEventListener('click', wrap(async e => {
      const t = e.target;
      if (t === d || t.closest('[data-keep="close"]')) return d.close();
      if (t.closest('[data-keep="off"]')) { d.close(); return keepOff(KeepDlg.key); }
      const soon = t.closest('[data-keep-in], [data-keep-at]');
      if (soon) { $('keepUntil').value = keepLocal(soon.dataset.keepAt ? keepTomorrow() : Date.now() + Number(soon.dataset.keepIn) * 36e5); return keepSync(); }
      const q = t.closest('[data-keep-quiet]');
      if (q) { KeepDlg.quiet = Number(q.dataset.keepQuiet); store('keepQuiet', String(KeepDlg.quiet)); return keepSync(); }
      const h = t.closest('[data-keep-how]');
      if (h) { KeepDlg.how = h.dataset.keepHow; return keepSync(); }
      return undefined;
    }));
    $('keepUntil').addEventListener('input', keepSync);
    $('keepForm').addEventListener('submit', e => { e.preventDefault(); wrap(keepStart)(); });
  }
  const on = keys ? null : keepOf(key);
  KeepDlg.key = keys ? null : key; KeepDlg.keys = keys;
  KeepDlg.quiet = on ? on.quietMinutes : (Number(store('keepQuiet')) || 5);
  KeepDlg.how = how || (on && on.how) || (C.group && C.group.how === 'turns' ? 'turns' : 'parallel');
  const chat = keys ? null : keepChatOf(key), crew = keys ? 0 : S.activity.filter(x => x.parentKey === key).length;
  $('keepHowBox').hidden = !crew;
  $('keepTitle').textContent = keys ? 'Keep them working' : 'Keep it working';
  $('keepWho').textContent = keys ? `${title || `These ${keys.length} open chats`}. When one stops and goes quiet, it gets a short message to carry on.` : `${title || (chat && chat.title) || 'This chat'}${crew ? `, and the ${crew === 1 ? 'one' : crew} working with it` : ''}. When it stops and goes quiet, it gets a short message to carry on.`;
  const room = S.activity.filter(x => (keys || [key]).includes(x.key) || (keys || [key]).includes(x.parentKey)).map(x => [x.accountName || PROV_NAME[x.provider || 'claude'], x.accountId && usageLine(x.accountId, { short: true })]).filter(x => x[0] && x[1]);
  const seen = new Set(), rows = room.filter(([n]) => !seen.has(n) && seen.add(n));
  $('keepRoom').hidden = !rows.length;
  $('keepRoom').textContent = rows.length ? `Usage left: ${rows.map(([n, u]) => `${n}, ${u}`).join('; ')}.` : '';
  $('keepUntil').value = keepLocal(on ? on.until : Date.now() + 8 * 36e5);
  $('keepNote').value = on ? on.note || '' : '';
  $('keepOff').hidden = !on;
  $('keepGo').textContent = on ? 'Change' : keys ? 'Keep them working' : 'Keep it working';
  $('keepErr').hidden = true;
  keepSync();
  $('keepDlg').showModal();
  $('keepGo').focus();
  return undefined;
}
function keepSync() {
  for (const b of document.querySelectorAll('#keepQuiet [data-keep-quiet]')) b.setAttribute('aria-pressed', String(Number(b.dataset.keepQuiet) === KeepDlg.quiet));
  for (const b of document.querySelectorAll('#keepHow [data-keep-how]')) b.setAttribute('aria-pressed', String(b.dataset.keepHow === KeepDlg.how));
  const t = Date.parse($('keepUntil').value);
  $('keepGo').disabled = !(t > Date.now() + 6e4);
}
async function keepStart() {
  if ($('keepGo').disabled) return;
  $('keepGo').disabled = true;
  const keys = KeepDlg.keys || [KeepDlg.key], until = Date.parse($('keepUntil').value);
  const results = await Promise.allSettled(keys.map(key => api('/api/chat/keep', { key, until, quiet: KeepDlg.quiet, how: KeepDlg.how, note: $('keepNote').value })));
  const failed = results.filter(r => r.status === 'rejected');
  // Nothing went: it stays open, saying why.
  if (failed.length === results.length) { $('keepErr').textContent = failed[0].reason.message; $('keepErr').hidden = false; keepSync(); return; }
  $('keepDlg').close();
  const n = results.length - failed.length, when = keepClock(until);
  toast(failed.length ? `${n} of ${results.length} keep working until ${when}. ${failed[0].reason.message}` : `${n === 1 ? 'It keeps' : `${n} chats keep`} working until ${when}.`, failed.length ? 7000 : 3500);
  if (window.loadActivity) await loadActivity().catch(() => {});
  renderKeep();
}
async function keepOff(key) {
  await api('/api/chat/keep', { key, action: 'off' });
  if (window.loadActivity) await loadActivity().catch(() => {});
  renderKeep();
}
// The little word on a chat's row.
function keepTag(id) {
  const x = S.activity.find(y => y.sessionId && y.sessionId.toLowerCase() === String(id).toLowerCase() && y.keep);
  return x ? `<span class="tag line keep-tag" title="Keeps working until ${esc(keepClock(x.keep.until))}${x.keep.nudges ? `, ${keepTimes(x.keep.nudges)} so far` : ''}">Until ${esc(keepClock(x.keep.until))}</span>` : '';
}
(function startKeep() {
  document.addEventListener('click', wrap(async e => {
    const t = e.target; if (!(t instanceof Element)) return undefined;
    if (t.closest('[data-keep-open]')) return openKeepDialog();
    if (t.closest('[data-keep-off]')) return keepOff(C.key);
    return undefined;
  }));
}());
