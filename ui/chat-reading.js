'use strict';
// A reading place belongs to this device and conversation, not to a process or window size. Use a
// message identity and a block within it so prepended history and changed picture heights don't shift it.
window.ChatReading = (() => {
  const storageKey = 'chat-reading-v1', limit = 150;
  let places = {}, active = null, saveTimer = null;
  function readPlaces() {
    try { const p = JSON.parse(store(storageKey)); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch { /* unavailable */ }
    return places;
  }
  places = readPlaces();
  const key = () => C.sessionId ? `${C.provider || 'claude'}:${String(C.sessionId).toLowerCase()}` : null;
  const valid = a => active === a && a.gen === C.gen && !$c('chat').hidden;
  const hash = text => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
  function identity(el) {
    const prov = el.closest('[data-prov]')?.dataset.prov || (el.classList.contains('to-partner') ? partnerProv() : C.provider);
    if (el.dataset.mid) return `part:${prov}:${el.dataset.mid}`;
    if (el.dataset.item) return `user:${el.dataset.item}`;
    if (el.classList.contains('umsg')) return `user:${prov}:${el._at || 0}:${hash((RAW.get(el) || el.querySelector('.utext')?.textContent || '').slice(0, 400))}`;
    return null;
  }
  const messages = () => [...$c('cFeed').querySelectorAll('.umsg, .part[data-mid]')];
  const blocks = el => [...el.querySelectorAll('.utext > *, .final > .md > *, .live > *, .tool, .gen, .chg')].filter(x => x.getClientRects().length);
  function capture() {
    const a = active, k = key();
    if (!a || !k || !valid(a) || !a.ready || a.hold || !$c('cFeed').querySelector('.umsg, .part')) return;
    const s = scroller(), y = s.getBoundingClientRect().top;
    const p = { bottom: nearBottom(), at: Date.now() };
    if (!p.bottom) {
      const all = messages();
      const el = all.find(x => x.getBoundingClientRect().bottom > y + 2) || all[all.length - 1];
      if (!el) return;
      const bs = blocks(el), b = bs.find(x => x.getBoundingClientRect().bottom > y + 2);
      Object.assign(p, { message: identity(el), block: b ? bs.indexOf(b) : -1, offset: (b || el).getBoundingClientRect().top - y });
    }
    places = { ...readPlaces(), [k]: p }; // Preserve places saved by another open app window.
    places = Object.fromEntries(Object.entries(places).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, limit));
    store(storageKey, JSON.stringify(places));
  }
  function disconnect(a) { if (!a) return; clearTimeout(a.timer); clearTimeout(a.soon); a.resize?.disconnect(); a.mutations?.disconnect(); }
  function leave() { clearTimeout(saveTimer); capture(); disconnect(active); active = null; }
  function start() {
    disconnect(active);
    places = readPlaces();
    const p = places[key()], usable = p && (p.bottom === true || (p.bottom === false && typeof p.message === 'string' && Number.isFinite(p.offset)));
    active = { gen: C.gen, saved: usable ? p : null, ready: false, hold: !!(usable && !p.bottom), touched: false, replay: !!C.watch };
  }
  function cancel() {
    const a = active; if (!a) return;
    a.touched = true; a.hold = false; disconnect(a);
  }
  function apply(a) {
    if (!valid(a) || a.touched) return false;
    const p = a.saved, el = messages().find(x => identity(x) === p.message);
    if (!el) return false;
    const b = blocks(el)[p.block] || el, s = scroller();
    const offset = Math.max(-Math.max(0, b.getBoundingClientRect().height - 8), p.offset);
    s.scrollTop += b.getBoundingClientRect().top - s.getBoundingClientRect().top - offset;
    syncJump(); return true;
  }
  async function restore() {
    const a = active; if (!a || !valid(a)) return;
    if (!a.saved || a.saved.bottom) {
      a.ready = true;
      if (!a.touched) toBottom();
      await settle();
      if (valid(a) && !a.touched && !unseen) toBottom();
      return;
    }
    // History may end before the saved message: that message is in the live replay. A crew's
    // replays merge before the reading place is picked. Neither wait may outlive this conversation.
    const until = Date.now() + 5500;
    while (valid(a) && !a.touched && (!a.replay || Merge.on) && Date.now() < until) await new Promise(r => setTimeout(r, 40));
    if (!valid(a)) return;
    let found = !a.touched && apply(a), pages = 0;
    const pageUntil = Date.now() + 10000;
    while (!found && !a.touched && !$c('cEarlier').hidden && pages++ < 30 && Date.now() < pageUntil) {
      const before = `${C.historyStart}:${C.historyCursor}:${$c('cFeed').childElementCount}`;
      try { await loadEarlier(); } catch { break; }
      if (!valid(a)) return;
      found = apply(a);
      if (before === `${C.historyStart}:${C.historyCursor}:${$c('cFeed').childElementCount}`) break;
    }
    if (!valid(a)) return;
    a.ready = true;
    if (a.touched) return;
    if (!found) { a.hold = false; toBottom(); return; }
    // Correct for fonts, images and folded tool groups settling after the initial render. Real
    // pointer, wheel, touch or keyboard input releases this immediately, so it never fights reading.
    const again = () => { clearTimeout(a.soon); a.soon = setTimeout(() => apply(a), 40); };
    a.resize = new ResizeObserver(again); a.resize.observe($c('cFeed'));
    a.mutations = new MutationObserver(again); a.mutations.observe($c('cFeed'), { childList: true, subtree: true });
    a.timer = setTimeout(() => { if (!valid(a)) return; apply(a); a.hold = false; disconnect(a); capture(); }, 1800);
  }
  $c('cScroll').addEventListener('scroll', () => {
    clearTimeout(saveTimer); saveTimer = setTimeout(capture, 250);
  }, { passive: true });
  for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) $c('chat').addEventListener(name, cancel, { passive: true, capture: true });
  window.addEventListener('pagehide', capture);
  document.addEventListener('visibilitychange', () => { if (document.hidden) capture(); });
  return { start, leave, restore, cancel, capture, holding: () => !!(active && valid(active) && active.hold), replayed: () => { if (active) active.replay = true; } };
})();
