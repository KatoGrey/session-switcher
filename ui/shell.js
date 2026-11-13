'use strict';
// The standard shell shares destinations and context between the workspace and a conversation.
// Collapsing the desktop sidebar is a device preference; opening the phone drawer is temporary.
const Shell = (() => {
  const desktop = matchMedia('(min-width:981px)');
  const standard = () => document.documentElement.matches('.hub2:not([data-family])');
  let collapsed = store('sidebar-collapsed') === 'true';
  let returnPoint = null;
  const location = () => S.view === 'folder' ? (S.projects.find(p => p.cwd === S.folder)?.name || 'Project')
    : ({ hub: 'The hub', work: 'Your work', recent: 'Recent chats', search: 'Search results', routines: 'Routines', aide: 'Companion' }[S.view] || 'The hub');
  function sync() {
    const wide = desktop.matches, compact = standard() && wide && collapsed;
    const inChat = !!(window.ChatUI && ChatUI.isOpen());
    const chatFocus = inChat && $('chat').classList.contains('focus');
    document.body.classList.toggle('nav-collapsed', compact);
    const open = wide ? !compact : document.body.classList.contains('nav-open');
    const nav = $('nav'), toggle = $('navToggle');
    nav.inert = !open;
    if ($('cRail')) $('cRail').inert = compact || chatFocus;
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
  document.addEventListener('lookchange', sync);
  document.addEventListener('click', e => {
    const view = e.target.closest('[data-shell-view]');
    if (view) go(view.dataset.shellView);
    if (e.target.closest('[data-shell-new]')) openNewChat();
    if (e.target.closest('[data-shell-connections]')) { setNavOpen(false); openConnections(); }
    if (e.target.closest('[data-shell-subagents]')) { setNavOpen(false); openSubagents(); }
  });
  return { sync, toggle, location, captureReturn, restoreReturn, canCollapse: () => desktop.matches && standard() };
})();
function setNavOpen(on, restoreFocus = false) {
  document.body.classList.toggle('nav-open', on);
  Shell.sync();
  if (on) ($('nav').querySelector('[aria-current="true"]') || $('nav').querySelector('button'))?.focus({ preventScroll: true });
  else if (restoreFocus) $('navToggle').focus({ preventScroll: true });
}
