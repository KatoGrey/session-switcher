'use strict';
/* Tips the first time, and What's new after an update.
   Tips: the first time something appears (a chat, a picture strip, Claude and Codex together, a
   project page, Ctrl+K), a one-line tip says what it can do: once each, at most one a day, never in
   the first minutes after opening or while you're typing. Setup → Preferences can turn them off.
   What's new: after an update, a card on the hub with the newest notes (docs/whats-new.md), once. */

const Tips = { last: Number(store('tips-last')) || 0, opened: Date.now() };
const TIP_GAP = 24 * 3600e3, TIP_SETTLE = 2 * 60e3;
const TIPS = [
  { id: 'chat', when: () => window.ChatUI && ChatUI.isOpen() && !C.watch, text: 'Tip: /btw asks a quick question beside the chat, and a reply’s ⋯ has Do this later and Branch from here.' },
  { id: 'pics', when: () => !!document.querySelector('#cFeed .pics, #cFeed .md-pic'), text: 'Tip: click a picture to see every picture in this chat; ← → steps through them.' },
  { id: 'duo', when: () => window.ChatUI && ChatUI.isOpen() && typeof duo === 'function' && duo(), text: 'Tip: Both sends your message to each in turn; Plan has one draft a plan and the other check it before anything changes.' },
  { id: 'project', when: () => S.view === 'folder', text: 'Tip: a project’s ⋯ has Rules and tools, Queue a task, Race and Split, and its chats that are done wait at the bottom.' },
  { id: 'palette', when: () => { const p = document.getElementById('palette'); return !!p && !p.hidden; }, text: 'Tip: Ctrl+K understands plain words: try “codex chat in <a project> to make the icons”.' },
];
const tipsOn = () => store('tips') !== 'off';
const tipsSeen = () => { try { return JSON.parse(store('tips-seen') || '{}') || {}; } catch { return {}; } };
function tipsTick() {
  if (!tipsOn() || document.hidden || Date.now() - Tips.last < TIP_GAP || Date.now() - Tips.opened < TIP_SETTLE) return;
  if ($('toast').classList.contains('show')) return;   // something else is being said
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)) && el.value) return;   // you're typing
  const seen = tipsSeen();
  const tip = TIPS.find(x => !seen[x.id] && (() => { try { return x.when(); } catch { return false; } })());
  if (!tip) return;
  seen[tip.id] = Date.now();
  store('tips-seen', JSON.stringify(seen));
  Tips.last = Date.now(); store('tips-last', String(Tips.last));
  toast(tip.text, 9000);
}
setInterval(tipsTick, 4000);

/* ---------- What's new ---------- */
async function loadWhatsNew() {
  if (store('whats-new-seen') === 'test') return;
  let w = null;
  try { w = await api('/api/whats-new'); } catch { return; }
  if (!w || !w.id || !w.md || store('whats-new-seen') === w.id) return;
  WhatsNew.card = w;
  renderWhatsNew();
}
const WhatsNew = { card: null, open: false };
function renderWhatsNew() {
  const slot = $('welcomeSlot'); if (!slot) return;
  let box = $('whatsNew');
  const w = WhatsNew.card;
  if (!w || S.view !== 'hub') { if (box) box.remove(); return; }
  if (!box) { slot.insertAdjacentHTML('afterend', '<section class="whats-new" id="whatsNew" aria-label="What’s new"></section>'); box = $('whatsNew'); }
  box.innerHTML = `<div class="wn-h"><p class="eyebrow">What’s new</p><b>${esc(w.title || 'Session Switcher was updated')}</b><button type="button" class="icon wn-x" data-wn="done" aria-label="Got it">✕</button></div>
    <div class="wn-body md ${WhatsNew.open || w.md.split('\n').length <= 3 ? 'open' : ''}">${md(w.md)}</div>
    <p class="wn-b">${w.md.split('\n').length > 3 ? `<button type="button" class="btn quiet sm" data-wn="more">${WhatsNew.open ? 'Show less' : 'Show it all'}</button>` : ''}<button type="button" class="btn sm" data-wn="done">Got it</button></p>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-wn]'); if (!b) return;
  if (b.dataset.wn === 'more') { WhatsNew.open = !WhatsNew.open; renderWhatsNew(); return; }
  if (WhatsNew.card) store('whats-new-seen', WhatsNew.card.id);
  WhatsNew.card = null;
  renderWhatsNew();
});
document.addEventListener('change', e => {
  const b = e.target.closest('[data-tips]'); if (!b) return;
  store('tips', b.checked ? '' : 'off');
  if (b.checked) store('tips-seen', '');
  toast(b.checked ? 'Tips are on; you’ll see each one once.' : 'No more tips.', 2500);
});
