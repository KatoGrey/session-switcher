'use strict';
/* The quiet extras: table sounds (Kenney, CC0: a knock when something needs you, a card on felt
   when a reply lands, cards sliding as you move things), desktop notifications while the window is
   in the background, and the count in the tab title and its icon. */

const SFX = {
  knock: ['knock-1', 'knock-2'], card: ['card-1', 'card-2'], slide: ['slide-1', 'slide-2', 'slide-3'], shove: ['shove'],
  fan: ['fan'], close: ['close'], chip: ['chip-1', 'chip-2'], undo: ['undo'],
};
const VOL = { knock: 0.55, card: 0.5, slide: 0.32, shove: 0.35, fan: 0.3, close: 0.25, chip: 0.4, undo: 0.3 };
const prefs = { sound: local.get('sound', true), notify: local.get('notify', false) };
const audioCache = new Map();
let lastSound = 0;
function sfx(kind, { force = false } = {}) {
  if (!prefs.sound && !force) return;
  const list = SFX[kind]; if (!list) return;
  const now = performance.now();
  if (!force && now - lastSound < 70) return; // a burst of moves is one sound, not a drumroll
  lastSound = now;
  const name = list[Math.floor(Math.random() * list.length)];
  let a = audioCache.get(name);
  if (!a) { a = new Audio(`/sounds/lite-${name}.mp3`); a.preload = 'auto'; audioCache.set(name, a); }
  const play = a.cloneNode();
  play.volume = Math.min(1, (VOL[kind] || 0.4) * (0.85 + Math.random() * 0.3));
  play.playbackRate = 0.94 + Math.random() * 0.12;
  play.preservesPitch = false;
  play.play().catch(() => {});
  if (kind === 'knock') setTimeout(() => { const b = audioCache.get(list[1 - list.indexOf(name)]) || a; const k = b.cloneNode(); k.volume = play.volume * 0.85; k.playbackRate = play.playbackRate * 1.03; k.preservesPitch = false; k.play().catch(() => {}); }, 150);
}

/* ---------- what changed among live chats ---------- */
const keyOfLive = x => x.sessionId || x.key;
// Looking at a chat counts as reading it: no sound or notification for the one on screen.
const viewing = x => S.view === 'chat' && CV.id && x.sessionId && x.sessionId.toLowerCase() === String(CV.id).toLowerCase() && document.hasFocus() && !document.hidden;
function onLiveChange(before, after) {
  if (!S.loaded || !before) { updateBadge(); return; }
  const was = new Map(before.map(x => [keyOfLive(x), x]));
  let need = null, reply = null;
  for (const x of after) {
    const w = was.get(keyOfLive(x));
    if (viewing(x)) { if (replied(x)) markSeen(x.sessionId); continue; }
    const pend = (x.pending || []).map(p => p.requestId).join(','), wpend = w ? (w.pending || []).map(p => p.requestId).join(',') : '';
    if (pend && pend !== wpend) need = x;
    else if (x.finishedAt && w && w.finishedAt !== x.finishedAt && !x.working) reply = x;
  }
  if (need) { sfx('knock'); notifyDesktop(`Needs you · ${titleOf(need)}`, need.pending[0].question ? 'Asks you a question.' : `Wants to ${wantsTo(need.pending[0].toolName)}${need.pending[0].detail ? `: ${need.pending[0].detail}` : ''}`, need); }
  else if (reply) { sfx('card'); notifyDesktop(`Replied · ${titleOf(reply)}`, reply.lastText || 'Finished its turn.', reply); }
  updateBadge();
}
function notifyDesktop(title, body, x) {
  if (!prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body: String(body).slice(0, 180), tag: keyOfLive(x), silent: true });
    n.onclick = () => { window.focus(); if (x.sessionId) openChat(x.sessionId); n.close(); };
  } catch { /* not available */ }
}
async function setNotify(on) {
  if (on && 'Notification' in window && Notification.permission !== 'granted') {
    const r = await Notification.requestPermission().catch(() => 'denied');
    if (r !== 'granted') { toast('This browser blocked notifications. Allow them in its site settings to turn this on.'); on = false; }
  }
  prefs.notify = on; local.set('notify', on);
}
function setSound(on) { prefs.sound = on; local.set('sound', on); if (on) sfx('chip', { force: true }); }

/* ---------- the count in the title and the tab's icon ---------- */
const FAV = $('favicon');
let favBase = null;
function updateBadge() {
  const n = S.live.filter(needsLive).length + (typeof rtEventsOpen === 'function' ? rtEventsOpen().filter(e => e.kind !== 'ran').length : 0);
  document.title = n ? `(${n}) Switcher Lite` : 'Switcher Lite';
  if (!FAV) return;
  if (!favBase) favBase = FAV.href;
  if (!n) { FAV.href = favBase; return; }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--needs').trim() || '#3b78e7';
  FAV.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="#7a7b74"/><circle cx="12.5" cy="3.5" r="3.3" fill="${accent}"/></svg>`)}`;
}
