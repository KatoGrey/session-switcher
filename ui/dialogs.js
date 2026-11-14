'use strict';
/* Every dialog behaves the same, wherever it's opened from (ui/dialogs.css for how they open and close).
   - Closing gives the keyboard back to what had it before it opened, if that's still on the page (or
     the same id, redrawn meanwhile); never to a dialog that has closed.
   - While a modal dialog is open on a phone, the page behind it doesn't scroll, and a dialog removed
     while it was open doesn't leave the page stuck.
   Where each dialog starts (the first field, or Cancel when yes can't be taken back) stays its own. */
const Dialogs = (() => {
  const open = new Set(), from = new WeakMap(), watched = new WeakSet();
  let poll = 0;
  const isModal = d => { try { return d.matches(':modal'); } catch { return true; } };
  const showing = d => d.isConnected && d.open;

  function lock() {
    document.documentElement.classList.toggle('dlg-open', [...open].some(d => showing(d) && isModal(d)));
    // A dialog taken off the page while open says nothing (no close event), so while any is open, look.
    if (open.size && !poll) poll = setInterval(check, 500);
    else if (!open.size && poll) { clearInterval(poll); poll = 0; }
  }
  function check() { for (const d of [...open]) if (!showing(d)) settle(d); }

  function remember(d) {
    if (d.open) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && !d.contains(a)) from.set(d, a);
  }
  function watch(d) {
    open.add(d);
    if (!watched.has(d)) { watched.add(d); d.addEventListener('close', () => settle(d)); }
    lock();
  }
  function settle(d) {
    if (showing(d)) return;   // opened again meanwhile
    open.delete(d);
    lock();
    const to = from.get(d);
    from.delete(d);
    giveBack(d, to);
  }
  // Only when the keyboard has nowhere better to be: nobody moved it on purpose after closing.
  function giveBack(d, to) {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && !d.contains(a)) return;
    let el = to && to.isConnected ? to : null;
    if (!el && to && to.id) el = document.getElementById(to.id);
    if (el && !el.disabled && !el.closest('[inert], [hidden], dialog:not([open])') && el.getClientRects().length) el.focus({ preventScroll: true });
    if (a && d.contains(a) && d.contains(document.activeElement)) a.blur();
  }

  const proto = window.HTMLDialogElement.prototype, nativeModal = proto.showModal, nativeShow = proto.show;
  proto.showModal = function showModal() { remember(this); const r = nativeModal.call(this); watch(this); return r; };
  proto.show = function show() { remember(this); const r = nativeShow.call(this); watch(this); return r; };

  return { open, check };
})();
