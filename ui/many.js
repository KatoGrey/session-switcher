'use strict';
/* Several chats at once: the same message to each of them ("sync up", "commit what you have"), or a stop
   for everything that's working. Only chats open in this app: one in a terminal is told in its terminal. */

const Many = { keys: new Set() };
// Chats that can take a message from here: open in the app, their partners inside them.
const manyChats = () => S.activity.filter(x => x.source === 'app' && x.key && !x.parentKey && statusOf(x) !== 'ended' && !isCommander(x.sessionId));
const manyWorking = () => manyChats().filter(x => statusOf(x) === 'working');

function openManyDialog({ keys = null, title = null } = {}) {
  closeMenu(); closePalette();
  const list = manyChats();
  if (!list.length) return toast('No chats are open here yet.', 3000);
  if (!$('manyDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="manyDlg" class="many-dlg" aria-labelledby="manyTitle"><form id="manyForm" novalidate>
      <div class="nc-head"><h3 id="manyTitle">Message several chats</h3><button type="button" class="icon" data-many="close" aria-label="Close">✕</button></div>
      <div role="group" aria-labelledby="manyL"><span class="nc-l" id="manyL">To</span><ul class="many-list" id="manyList"></ul></div>
      <div><label class="nc-l" for="manyText">Message</label><textarea id="manyText" rows="4"></textarea></div>
      <p class="many-note">It goes to each as if you’d typed it there. One that’s working reads it when it’s ready.</p>
      <div class="nc-foot"><span class="spacer"></span><button type="button" class="btn" data-many="close">Cancel</button><button type="submit" class="btn prime" id="manyGo">Send</button></div>
    </form></dialog>`);
    const d = $('manyDlg');
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-many="close"]')) d.close();
      const row = e.target.closest('input[data-many-key]');
      if (row) { if (row.checked) Many.keys.add(row.dataset.manyKey); else Many.keys.delete(row.dataset.manyKey); manySync(); }
    });
    $('manyText').addEventListener('input', manySync);
    $('manyText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrap(manySend)(); } });
    $('manyForm').addEventListener('submit', e => { e.preventDefault(); wrap(manySend)(); });
  }
  Many.keys = new Set(keys ? keys.filter(k => list.some(x => x.key === k)) : list.map(x => x.key));
  $('manyTitle').textContent = title || 'Message several chats';
  $('manyList').innerHTML = list.map(x => { const s = chatState(x), p = projectOf(x); return `<li><label class="many-row"><input type="checkbox" data-many-key="${esc(x.key)}" ${Many.keys.has(x.key) ? 'checked' : ''}><span class="${s.dot}" aria-hidden="true"></span><span class="many-t" title="${esc(x.title || 'New chat')}">${esc(x.title || 'New chat')}</span><small>${esc(s.word)}${p ? ` · ${esc(p.name)}` : ''}</small></label></li>`; }).join('');
  $('manyText').value = '';
  manySync();
  $('manyDlg').showModal();
  $('manyText').focus();
  return undefined;
}
function manySync() {
  const n = Many.keys.size;
  $('manyGo').disabled = !n || !$('manyText').value.trim();
  $('manyGo').textContent = n ? `Send to ${n === 1 ? '1 chat' : `${n} chats`}` : 'Send';
}
async function manySend() {
  if ($('manyGo').disabled) return;
  const text = $('manyText').value, keys = [...Many.keys];
  $('manyGo').disabled = true;
  const results = await Promise.allSettled(keys.map(key => api('/api/chat/send', { key, text })));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length === results.length) { manySync(); throw failed[0].reason; }   // nothing went: the box stays as it is
  $('manyDlg').close();
  toast(failed.length ? `Sent to ${results.length - failed.length} of ${results.length}. ${failed[0].reason.message}` : `Sent to ${results.length === 1 ? '1 chat' : `${results.length} chats`}.`, failed.length ? 8000 : 3000);
}
// Everything that's working stops where it is: the chats stay open, as if you'd pressed Stop in each.
async function stopEverything() {
  const list = manyWorking();
  if (!list.length) return toast('Nothing here is working just now.', 3000);
  if (!(await window.appConfirm(`Stop what ${list.length === 1 ? 'this chat is' : `these ${list.length} chats are`} doing?\n\n${list.slice(0, 8).map(x => `• ${x.title || 'New chat'}`).join('\n')}${list.length > 8 ? `\nand ${list.length - 8} more` : ''}\n\nThey stay open, and you can carry on in each.`, { ok: 'Stop them', danger: true }))) return undefined;
  const results = await Promise.allSettled(list.map(x => api('/api/chat/interrupt', { key: x.key })));
  const failed = results.filter(r => r.status === 'rejected').length;
  return toast(failed ? `Stopped ${results.length - failed} of ${results.length}.` : `Stopped ${results.length === 1 ? 'it' : `all ${results.length}`}.`, 3500);
}
