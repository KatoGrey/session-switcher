'use strict';
/* Share to Session Switcher (the Android app): text, a link or pictures shared from any app. If a chat
   is open, they go into its message box, ready for a word from you; otherwise you pick the chat (or a
   new one), and they're waiting there. Nothing is sent until you press Send. What was shared is kept
   until it's in a message box, so if getting it there fails, it can be tried again (the toast's Try
   again, or Setup → Problems while the app stays open). */

const Share = { pending: null, timer: 0 };

async function takeAndroidShare() {
  if (!window.Android || !window.Android.takeShare) return;
  let got = null;
  try { got = JSON.parse(window.Android.takeShare() || 'null'); } catch { got = null; }
  if (!got || (!got.text && !(got.images || []).length)) { if (got && got.skipped) toast('That can’t be shared here: only text, links and pictures can.', 4000); return; }
  await deliverShare(got);
}
// Into the open chat, or the one you pick. A failure keeps it, and says so.
async function deliverShare(got) {
  Share.pending = got;
  try {
    if (shareTarget()) return putShare(got);
    // Which chat: the ones at work or waiting first, then the newest; or a new chat.
    const chats = S.activity.filter(x => x.source === 'app' && x.key && x.phase !== 'ended').slice(0, 3);
    const what = got.images && got.images.length ? `${got.images.length === 1 ? 'A picture' : `${got.images.length} pictures`}${got.text ? ' and text' : ''}` : 'Text';
    const folder = S.folder || (S.projects.find(p => p.exists) || {}).cwd || null;
    const pick = await appChoice(`${what} to share.\n\nWhich chat should it go to? It waits in the message box; nothing is sent until you press Send.`, [
      ...chats.map((x, i) => ({ v: `c${i}`, label: x.title || 'A chat', kind: i ? '' : 'prime' })),
      ...(folder ? [{ v: 'new', label: `New chat in ${base(folder)}` }] : []),
      { v: '', label: 'Cancel', kind: 'quiet' },
    ]);
    if (!pick) { if (Share.pending === got) Share.pending = null; return undefined; }
    if (pick === 'new') await ChatUI.open({ cwd: folder, mode: 'new' });
    else await openActivity(chats[Number(pick.slice(1))]);
    waitForComposer(got);
  } catch (err) { shareFailed(got, err); }
  return undefined;
}
function shareFailed(got, err) {
  const what = (got.images || []).length ? ((got.images.length === 1 && !got.text) ? 'the picture' : 'what you shared') : got.text && /^\s*https?:\/\/\S+\s*$/.test(got.text) ? 'the link' : 'the text';
  const why = String((err && err.message) || 'something went wrong').replace(/[.\s]+$/, '');
  toast(`Couldn’t put ${what} into a chat: ${why}. It’s kept, so you can try again.`, 12000, null, { tone: 'error', retry: () => retryShare(got) });
}
function retryShare(got) {
  // Its chat shows behind Setup otherwise.
  if ($('setup') && $('setup').open) $('setup').close();
  return deliverShare(got);
}
// The open chat, if you can write to it.
const shareTarget = () => window.ChatUI && ChatUI.isOpen() && C.key && !C.watch;
function waitForComposer(got) {
  clearInterval(Share.timer);
  const t0 = Date.now();
  Share.timer = setInterval(() => {
    if (shareTarget()) { clearInterval(Share.timer); try { putShare(got); } catch (err) { shareFailed(got, err); } }
    else if (Date.now() - t0 > 20000) { clearInterval(Share.timer); shareFailed(got, new Error('the chat didn’t open in time')); }
  }, 300);
}
function putShare(got) {
  for (const im of got.images || []) C.attachments.push({ mediaType: im.mediaType, data: im.data });
  if ((got.images || []).length) renderAttachments();
  if (got.text) placeText(got.text, false);
  else $c('cText').focus();
  // In the message box now: nothing more to keep.
  if (Share.pending === got) Share.pending = null;
  toast(`Shared into this chat${got.skipped ? ` (${got.skipped} couldn’t come along)` : ''}. Add a word and send it.`, 4000);
}
window.onAndroidShare = () => { takeAndroidShare().catch(err => toast(err.message, 8000, null, { tone: 'error' })); };
// Shared while the app was closed: taken once the page is up.
if (window.Android) setTimeout(() => window.onAndroidShare(), 1500);
