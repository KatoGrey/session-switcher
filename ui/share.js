'use strict';
/* Share to Session Switcher (the Android app): text, a link or pictures shared from any app. If a chat
   is open, they go into its message box, ready for a word from you; otherwise you pick the chat (or a
   new one), and they're waiting there. Nothing is sent until you press Send. */

const Share = { pending: null, timer: 0 };

async function takeAndroidShare() {
  if (!window.Android || !window.Android.takeShare) return;
  let got = null;
  try { got = JSON.parse(window.Android.takeShare() || 'null'); } catch { got = null; }
  if (!got || (!got.text && !(got.images || []).length)) { if (got && got.skipped) toast('That can’t be shared here: only text, links and pictures can.', 4000); return; }
  Share.pending = got;
  if (shareTarget()) return putShare();
  // Which chat: the ones at work or waiting first, then the newest; or a new chat.
  const chats = S.activity.filter(x => x.source === 'app' && x.key && x.phase !== 'ended').slice(0, 3);
  const what = got.images && got.images.length ? `${got.images.length === 1 ? 'A picture' : `${got.images.length} pictures`}${got.text ? ' and text' : ''}` : 'Text';
  const folder = S.folder || (S.projects.find(p => p.exists) || {}).cwd || null;
  const pick = await appChoice(`${what} to share.\n\nWhich chat should it go to? It waits in the message box; nothing is sent until you press Send.`, [
    ...chats.map((x, i) => ({ v: `c${i}`, label: x.title || 'A chat', kind: i ? '' : 'prime' })),
    ...(folder ? [{ v: 'new', label: `New chat in ${base(folder)}` }] : []),
    { v: '', label: 'Cancel', kind: 'quiet' },
  ]);
  if (!pick) { Share.pending = null; return; }
  if (pick === 'new') await ChatUI.open({ cwd: folder, mode: 'new' });
  else await openActivity(chats[Number(pick.slice(1))]);
  waitForComposer();
}
// The open chat, if you can write to it.
const shareTarget = () => window.ChatUI && ChatUI.isOpen() && C.key && !C.watch;
function waitForComposer() {
  clearInterval(Share.timer);
  const t0 = Date.now();
  Share.timer = setInterval(() => {
    if (shareTarget()) { clearInterval(Share.timer); putShare(); }
    else if (Date.now() - t0 > 20000) { clearInterval(Share.timer); Share.pending = null; toast('The chat didn’t open in time; share it again.', 4000); }
  }, 300);
}
function putShare() {
  const got = Share.pending; Share.pending = null; if (!got) return;
  for (const im of got.images || []) C.attachments.push({ mediaType: im.mediaType, data: im.data });
  if ((got.images || []).length) renderAttachments();
  if (got.text) placeText(got.text, false);
  else $c('cText').focus();
  toast(`Shared into this chat${got.skipped ? ` (${got.skipped} couldn’t come along)` : ''}. Add a word and send it.`, 4000);
}
window.onAndroidShare = () => { takeAndroidShare().catch(err => toast(err.message)); };
// Shared while the app was closed: taken once the page is up.
if (window.Android) setTimeout(() => window.onAndroidShare(), 1500);
