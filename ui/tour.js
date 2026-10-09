'use strict';
/* A short tour the first time Session Switcher opens (on a computer): a few cards, each pointing at
   one part of the hub. Skip ends it; it's never shown again unless you ask (Setup, or Ctrl+K). */

const TOUR = [
  { at: '#heroSlot', title: 'Every chat, in one place', text: 'All the Claude Code and Codex chats on this computer. What needs you comes first; what’s working is under At work, and you can queue tasks for later there.' },
  { at: '#seal', title: 'Your accounts', text: 'New chats open as this account: click it to switch. The top bar shows how much of its plan is left, and if one runs out mid-chat, the chat offers another.' },
  { at: '#nav', title: 'Your projects', text: 'Each project, with its chats. Right-click anything (a chat, a project, a card) for what you can do with it, like pinning it here or setting its rules for Claude and Codex.' },
  { at: '#seek', title: 'Jump anywhere', text: 'Ctrl+K finds any chat, project, prompt or action, and searches inside every message.' },
  { at: null, title: 'Claude and Codex, together', text: 'In a chat, they share the conversation: write to Claude, Codex or Both, and each catches up on what the other said. Codex can review Claude’s changes, any reply can be undone, and ? lists every shortcut.' },
];
const Tour = { i: 0 };

function startTour() {
  if (!$('tour')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="tour" class="tour" hidden><div class="tour-spot" id="tourSpot"></div>
      <div class="tour-card" id="tourCard" role="dialog" aria-modal="true" aria-labelledby="tourT"><p class="tour-n" id="tourN"></p><h3 id="tourT"></h3><p id="tourX"></p>
      <div class="tour-b"><button type="button" class="btn quiet" data-tour="skip">Skip the tour</button><span class="spacer"></span><button type="button" class="btn" data-tour="back">Back</button><button type="button" class="btn prime" data-tour="next">Next</button></div></div></div>`);
    $('tour').addEventListener('click', e => {
      const b = e.target.closest('[data-tour]'); if (!b) return;
      if (b.dataset.tour === 'skip') endTour();
      else showTourStep(Tour.i + (b.dataset.tour === 'next' ? 1 : -1));
    });
    document.addEventListener('keydown', e => {
      if ($('tour').hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); showTourStep(Tour.i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); showTourStep(Tour.i - 1); }
    }, true);
    addEventListener('resize', () => { if (!$('tour').hidden) showTourStep(Tour.i); });
  }
  if (S.view !== 'hub') go('hub');
  $('tour').hidden = false;
  showTourStep(0);
}
function showTourStep(i) {
  if (i >= TOUR.length) return endTour();
  Tour.i = Math.max(0, i);
  const step = TOUR[Tour.i];
  $('tourN').textContent = `${Tour.i + 1} of ${TOUR.length}`;
  $('tourT').textContent = step.title;
  $('tourX').textContent = step.text;
  $('tour').querySelector('[data-tour="back"]').hidden = Tour.i === 0;
  $('tour').querySelector('[data-tour="next"]').textContent = Tour.i === TOUR.length - 1 ? 'Done' : 'Next';
  const el = step.at && document.querySelector(step.at);
  const spot = $('tourSpot'), card = $('tourCard');
  const r = el && el.offsetParent ? el.getBoundingClientRect() : null;
  if (!r || !r.width) {
    // Nothing to point at: a card in the middle, over a dimmed page.
    Object.assign(spot.style, { left: '50%', top: '50%', width: '0px', height: '0px' });
    Object.assign(card.style, { left: `${Math.max(16, (innerWidth - 420) / 2)}px`, top: `${Math.max(16, innerHeight / 2 - 120)}px` });
  } else {
    const pad = 6, top = Math.max(8, r.top - pad), height = Math.min(r.height + pad * 2, innerHeight - top - 8);
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${top}px`, width: `${r.width + pad * 2}px`, height: `${height}px` });
    // Beside it if there's room on the right, else below it, else above it.
    const cw = 400, ch = 210;
    let left, y;
    if (r.right + cw + 24 < innerWidth) { left = r.right + 16; y = Math.min(Math.max(16, r.top), innerHeight - ch - 16); }
    else if (top + height + ch + 16 < innerHeight) { left = Math.min(Math.max(16, r.left), innerWidth - cw - 16); y = top + height + 12; }
    else { left = Math.min(Math.max(16, r.left), innerWidth - cw - 16); y = Math.max(16, top - ch - 12); }
    Object.assign(card.style, { left: `${left}px`, top: `${y}px` });
  }
  $('tour').querySelector('[data-tour="next"]').focus({ preventScroll: true });
}
function endTour() {
  $('tour').hidden = true;
  store('toured', '1');
}
// The first time, on a computer, on the hub.
function maybeTour() {
  let seen = false;
  try { seen = !!localStorage.getItem('toured'); } catch { /* storage off */ }
  if (seen || window.REMOTE || window.Android || SOLO || innerWidth < 980) return;
  setTimeout(() => { if (S.view === 'hub' && !document.querySelector('dialog[open]') && !ChatUI.isOpen()) startTour(); }, 1200);
}
