'use strict';
// The standard shell shares destinations and context between the workspace and a conversation.
// Collapsing the desktop sidebar is a device preference; opening the phone drawer is temporary.
const Shell = (() => {
  const desktop = matchMedia('(min-width:981px)');
  const standard = () => document.documentElement.matches('.hub2:not([data-family])');
  let collapsed = store('sidebar-collapsed') === 'true';
  let returnPoint = null;
  const location = () => S.view === 'folder' ? (S.projects.find(p => p.cwd === S.folder)?.name || 'Project')
    : ({ hub: 'The hub', work: 'Your work', recent: 'Recent chats', headless: 'Headless runs', search: 'Search results', routines: 'Routines', aide: 'Companion' }[S.view] || 'The hub');
  // Where focus goes in an open chat: its message box, or (a chat you're only watching has none) the first button in
  // its header.
  const intoChat = () => [$('cText'), ...$('chat').querySelectorAll('.c-head button')].find(x => x && x.getClientRects().length && !x.closest('[inert]')) || null;
  function sync() {
    const wide = desktop.matches, compact = standard() && wide && collapsed;
    const inChat = !!(window.ChatUI && ChatUI.isOpen());
    const chatFocus = inChat && $('chat').classList.contains('focus');
    document.body.classList.toggle('nav-collapsed', compact);
    const open = wide ? !compact : document.body.classList.contains('nav-open');
    const nav = $('nav'), toggle = $('navToggle'), chat = $('chat'), rail = $('cRail');
    // What an open chat sits over can't be reached with Tab or a screen reader either: the page under it, and the
    // sidebar unless it's beside the chat (the new layout). (Not Companion's own window, where the chat is all there is.)
    const covers = inChat && !document.body.matches('.aide-panel, .aide-pane');
    // (Where they're laid out, not where an opening chat's animation has it for the moment.)
    const navCovered = covers && open && nav.offsetWidth > 0 && chat.offsetLeft < nav.offsetLeft + nav.offsetWidth - 1;
    const was = document.activeElement;
    nav.inert = !open || navCovered;
    $('page').inert = covers;
    $('skipLink').textContent = inChat ? 'Skip to the conversation' : 'Skip to the page';   // (where it goes: Shell.intoChat)
    // Focus on what the chat has just covered goes into the chat, not lost.
    if (covers && was && ($('page').contains(was) || (navCovered && nav.contains(was)))) intoChat()?.focus({ preventScroll: true });
    // The chat's own list: tucked away in focus mode or with the sidebar collapsed, and on a narrow screen slid off
    // to the side until its button shows it. (Focus in it goes to that button, or into the chat.)
    if (rail) {
      const away = compact || chatFocus || (!wide && !chat.classList.contains('show-rail'));
      if (away && rail.contains(was)) [chat.querySelector('[data-c="rail"]'), intoChat()].find(x => x && x.getClientRects().length)?.focus({ preventScroll: true });
      rail.inert = away;
    }
    toggle.setAttribute('aria-expanded', String(open && !chatFocus));
    toggle.setAttribute('aria-label', wide && standard() ? (compact || chatFocus ? 'Show sidebar' : 'Hide sidebar') : (open ? 'Hide folders and views' : 'Show folders and views'));
    toggle.title = wide && standard() ? (compact || chatFocus ? 'Show sidebar' : 'Hide sidebar') : 'Folders and views';
    const ctx = $('shellContext');
    ctx.querySelector('b').textContent = inChat ? 'Conversation' : location();
    document.querySelectorAll('[data-return-label]').forEach(el => { el.textContent = standard() ? `Back to ${location()}` : 'The hub'; });
    const railGlyph = document.querySelector('.rail-back .glyph'); if (railGlyph) railGlyph.textContent = standard() ? '←' : '✦';
  }
  function toggle() {
    if (!desktop.matches || !standard()) return setNavOpen(!document.body.classList.contains('nav-open'));
    if (window.ChatUI?.isOpen() && $('chat').classList.contains('focus')) { toggleFocus(false); collapsed = false; }
    else collapsed = !collapsed;
    store('sidebar-collapsed', String(collapsed));
    if (collapsed && $('nav').contains(document.activeElement)) $('navToggle').focus();
    sync();
  }
  function captureReturn() {
    const focused = document.activeElement;
    returnPoint = { view: S.view, folder: S.folder, y: scrollY, id: focused?.id,
      workKey: focused?.dataset?.key, workAction: focused?.dataset?.wk, workValue: focused?.dataset?.value };
  }
  function restoreReturn() {
    if (!returnPoint || window.ChatUI?.isOpen() || returnPoint.view !== S.view || returnPoint.folder !== S.folder) return;
    const p = returnPoint; returnPoint = null;
    const workControl = p.workAction && `[data-wk="${CSS.escape(p.workAction)}"]${p.workKey ? `[data-key="${CSS.escape(p.workKey)}"]` : ''}${p.workValue ? `[data-value="${CSS.escape(p.workValue)}"]` : ''}`;
    const el = (p.id && $(p.id)) || (workControl && $('page').querySelector(workControl)) || $('page');
    el.focus({ preventScroll: true }); window.scrollTo({ top: p.y, behavior: 'instant' });
  }
  desktop.addEventListener('change', () => { document.body.classList.remove('nav-open'); sync(); });
  // A chat opening or closing, its list sliding in or out, and focus mode change what can be reached.
  let chatWas = '';
  new MutationObserver(() => {
    const c = $('chat'), now = `${c.hidden}|${c.classList.contains('show-rail')}|${c.classList.contains('focus')}`;
    if (now !== chatWas) { chatWas = now; sync(); }
  }).observe($('chat'), { attributes: true, attributeFilter: ['class', 'hidden'] });
  document.addEventListener('lookchange', sync);
  document.addEventListener('click', e => {
    const view = e.target.closest('[data-shell-view]');
    if (view) go(view.dataset.shellView);
    if (e.target.closest('[data-shell-new]')) openNewChat();
    if (e.target.closest('[data-shell-connections]')) { setNavOpen(false); openConnections(); }
    if (e.target.closest('[data-shell-subagents]')) { setNavOpen(false); openSubagents(); }
  });
  // Try the new layout (Setup → Appearance, saved on this device): the main themes' sidebar stays beside a chat
  // instead of giving way to the chat's own list, so the hub, Your work and your projects stay one click away.
  // Imperial, Rebel and the other theme families keep their layout.
  const next = () => store('layout-next') === 'true';
  function setNext(on) {
    store('layout-next', String(!!on));
    document.documentElement.classList.toggle('layout-next', !!on);
    if (typeof renderNav === 'function') renderNav();
    if (S.view === 'hub' && typeof renderPage === 'function') renderPage();
    sync();
  }
  document.documentElement.classList.toggle('layout-next', next());
  return { sync, toggle, location, captureReturn, restoreReturn, canCollapse: () => desktop.matches && standard(), next, setNext, intoChat };
})();
function setNavOpen(on, restoreFocus = false) {
  document.body.classList.toggle('nav-open', on);
  Shell.sync();
  if (on) ($('nav').querySelector('[aria-current="true"]') || $('nav').querySelector('button'))?.focus({ preventScroll: true });
  else if (restoreFocus) $('navToggle').focus({ preventScroll: true });
}
