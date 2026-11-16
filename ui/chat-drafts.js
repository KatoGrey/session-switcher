'use strict';
// Drafts already live on this device and on the PC. This index keeps their presence visible without
// fetching everyone's text. A pending edit (including a send) wins over an older index response.
window.ChatDrafts = (() => {
  const local = new Map(), remote = new Map(), changes = new Map();
  let revision = 0, acknowledgements = 0, busy = null, checked = 0;
  const idOf = id => String(id || '').toLowerCase();
  let synced = {};
  try { const s = JSON.parse(store('drafts-synced') || '{}'); if (s && typeof s === 'object' && !Array.isArray(s)) synced = s; } catch { /* none */ }
  function readLocal() {
    local.clear();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('draft:') || k.endsWith(':at') || k.startsWith('draft:new:')) continue;
        if ((localStorage.getItem(k) || '').trim()) local.set(idOf(k.slice(6)), { at: Number(localStorage.getItem(`${k}:at`)) || 0, key: k });
      }
    } catch { /* storage can be unavailable */ }
  }
  function has(id) {
    const k = idOf(id), c = changes.get(k);
    return c ? c.has : local.has(k) || remote.has(k);
  }
  function badge(id) {
    if (!id) return '';
    return `<span class="draft-badge" data-draft-id="${esc(idOf(id))}" title="Unsent message"${has(id) ? '' : ' hidden'}>Draft</span>`;
  }
  function paint() {
    for (const el of document.querySelectorAll('[data-draft-id]')) el.hidden = !has(el.dataset.draftId);
    document.dispatchEvent(new CustomEvent('draftschange'));
  }
  function changed(id, text, at = Date.now()) {
    const k = idOf(id); if (!k) return;
    const yes = !!String(text || '').trim(), was = has(k);
    changes.set(k, { has: yes, at, rev: ++revision, confirmed: false });
    if (yes) local.set(k, { at, key: `draft:${id}` }); else local.delete(k);
    if (was !== yes) paint();
    return revision;
  }
  function acknowledged(id, text, at, rev) {
    const k = idOf(id), c = changes.get(k);
    if (!k || !c || c.at !== at || (rev !== undefined && rev !== c.rev) || c.has !== !!String(text || '').trim()) return;
    c.confirmed = ++acknowledgements;
    if (c.has) remote.set(k, at); else remote.delete(k);
    synced[k] = at;
    const keep = Object.entries(synced).filter(([, n]) => Number.isFinite(n)).sort((a, b) => b[1] - a[1]).slice(0, 300);
    synced = Object.fromEntries(keep); store('drafts-synced', JSON.stringify(synced));
  }
  function refresh(force = false) {
    if (busy) return busy;
    if (!force && Date.now() - checked < 15000) return Promise.resolve();
    const start = revision, confirmedThrough = acknowledgements;
    checked = Date.now();
    busy = api('/api/drafts').then(r => {
      if (!r || !Array.isArray(r.drafts)) return; // An older server still has this device's drafts.
      const next = new Map(r.drafts.filter(d => d && typeof d.id === 'string').map(d => [idOf(d.id), Number(d.at) || 0]));
      remote.clear(); for (const [id, at] of next) remote.set(id, at);
      for (const [id, c] of changes) {
        // A request started after the save was acknowledged is authoritative: another device may
        // have sent that draft since. A request already in flight before the save is not.
        if (c.rev <= start && c.confirmed && c.confirmed <= confirmedThrough) changes.delete(id);
      }
      // A confirmed draft sent on another device must not reappear from this device's old cache.
      // Unconfirmed/offline edits stay: absence in the index is not permission to discard them.
      for (const [id, d] of local) {
        if (changes.has(id) || next.has(id) || !(Number(synced[id]) >= d.at)) continue;
        local.delete(id);
        try { localStorage.removeItem(d.key); localStorage.removeItem(`${d.key}:at`); } catch { /* unavailable */ }
      }
      paint();
    }).catch(() => {}).finally(() => { busy = null; });
    return busy;
  }
  function items() {
    const seen = new Set();
    return allSessions().filter(([s]) => {
      const id = idOf(s.id); if (seen.has(id) || !has(id)) return false;
      seen.add(id); return true;
    }).map(([s, p]) => ({
      id: `draft:${idOf(s.id)}`, glyph: '✎', t: s.title || 'New chat',
      s: `${p.name} · Draft`, text: `${s.title || ''} ${p.name} draft unsent`,
      at: changes.get(idOf(s.id))?.at || local.get(idOf(s.id))?.at || remote.get(idOf(s.id)) || 0,
      run: () => openChatFromNav(s.id),
    })).sort((a, b) => b.at - a.at);
  }
  readLocal();
  window.addEventListener('storage', e => {
    if (e.key !== null && !e.key.startsWith('draft:')) return;
    // Another window owns the same storage. Its newest write supersedes this window's pending view.
    if (e.key && !e.key.endsWith(':at') && !e.key.startsWith('draft:new:')) changes.delete(idOf(e.key.slice(6)));
    readLocal(); paint(); refresh(true);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  setTimeout(() => refresh(), 0);
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  return { has, badge, changed, acknowledged, refresh, items };
})();
