'use strict';
window.ThemeStudio = (() => {
  let library = { themes: [], jobs: [] }, busy = false, reviewing = null, serial = 0, loaded = false;
  const announced = new Set();
  const artUrl = (id, mode, kind = 'themes', revision = '') => `/api/themes/art?${new URLSearchParams({ id, mode, kind, token: TOKEN, v: revision })}`;
  const canPaint = () => codexReady() && S.codex.kind !== 'ollama';
  const error = e => {
    const message = e.message || String(e), p = $('studioStatus');
    if (p) p.textContent = message;
    if (message && !$('studioDlg')?.open) toast(message, 6500);
  };
  function install() {
    if ($('studioDlg')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="studioDlg" class="studio-dlg" aria-labelledby="studioTitle"><div class="setup-head"><h3 id="studioTitle">Theme Studio</h3><button class="icon" data-studio-close aria-label="Close Theme Studio">✕</button></div><div class="setup-body" id="studioBody"></div><p id="studioStatus" class="studio-status" role="status" aria-live="polite"></p></dialog>`);
    $('studioDlg').addEventListener('close', () => { serial++; reviewing = null; });
    $('studioDlg').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b || b.disabled || busy) return;
      try {
        if (b.hasAttribute('data-studio-close')) return $('studioDlg').close();
        if (b.hasAttribute('data-studio-back')) return open();
        if (b.hasAttribute('data-studio-review')) return await review(b.dataset.studioReview);
        if (b.hasAttribute('data-studio-use')) { Look.set({ theme: b.dataset.studioUse }); $('studioDlg').close(); $('setup').close(); return toast('Your world is ready.', 2500); }
        if (b.hasAttribute('data-studio-delete')) {
          const t = library.themes.find(t => t.id === b.dataset.studioDelete);
          if (await window.appConfirm(`Delete “${t.name}” from your saved themes? The original paintings stay in the art workspace.`, { ok: 'Delete theme' })) { await api('/api/themes/delete', { id: t.id }); await open(); }
        }
        if (b.hasAttribute('data-studio-dismiss')) { await api('/api/themes/dismiss', { id: b.dataset.studioDismiss }); await open(); }
        if (b.hasAttribute('data-studio-resume')) { await startChat(await api('/api/themes/job?id=' + encodeURIComponent(b.dataset.studioResume))); }
        if (b.hasAttribute('data-studio-save')) {
          if (!reviewing) return;
          busy = true; b.disabled = true; error('Saving your world…');
          const r = await api('/api/themes/save', { id: reviewing.theme.id, revision: reviewing.revision, dark: reviewing.dark, light: reviewing.light });
          await refresh(); Look.set({ theme: r.theme.id }); $('studioDlg').close(); $('setup').close(); toast('Theme saved and applied. It is available on your other devices too.', 4500);
        }
      } catch (e) { error(e); } finally { busy = false; b.disabled = false; }
    });
    $('studioDlg').addEventListener('submit', async e => {
      if (e.target.id !== 'studioForm') return; e.preventDefault(); if (busy) return;
      const name = $('studioName').value.trim(), description = $('studioWorld').value.trim(), font = $('studioFont').value;
      if (!description || !canPaint()) return;
      busy = true; const ticket = serial, button = e.target.querySelector('[type=submit]'); button.disabled = true;
      try {
        const j = await api('/api/themes/create', { name, description, font }); await refresh();
        if (ticket === serial && $('studioDlg').open) await startChat(j);
      }
      catch (e) { error(e); } finally { busy = false; button.disabled = false; }
    });
  }
  async function startChat(j) {
    if (!canPaint()) throw new Error('Sign in to a ChatGPT-backed Codex account to paint a world.');
    $('studioDlg').close(); $('setup').close();
    const live = S.activity.find(a => a.cwd === j.cwd && a.provider === 'codex' && a.source === 'app' && a.phase !== 'ended');
    if (live) return ChatUI.openKey(live.key);
    const project = S.projects.find(p => p.cwd === j.cwd), previous = project && project.sessions.find(s => s.provider === 'codex');
    if (previous) return ChatUI.open({ sessionId: previous.id, provider: 'codex' });
    await ChatUI.open({ cwd: j.cwd, mode: 'new', provider: 'codex', initialText: j.prompt });
    if (!ChatUI.isOpen() || !C.info || C.info.cwd !== j.cwd) return open();
    toast('Send the prepared brief to paint your world. Return to Theme Studio to review it.', 6500);
  }
  async function refresh() {
    const j = await api('/api/themes');
    if (!Array.isArray(j.themes) || !Array.isArray(j.jobs)) return;
    const changed = JSON.stringify(library.themes) !== JSON.stringify(j.themes);
    library = j;
    if (changed || !loaded) { loaded = true; Look.custom(library.themes); if (S.setupTab === 'look' && $('setup').open) renderLook(); if (S.view === 'hub' && $('heroSlot')) renderLive(true); }
  }
  const scene = ({ N, R, W, Q }) => {
    const t = Look.theme();
    return `<div class="hero-art studio-scene"><img src="${esc(artUrl(t.id, Look.isLight() ? 'light' : 'dark'))}" alt="" decoding="async"><div class="studio-counts">${[[N + R, 'need you'], [W, 'working'], [Q, 'idle']].map(([n, s]) => `<span><b>${n}</b>${s}</span>`).join('')}</div></div>`;
  };
  function paintCards() {
    return library.themes.map(t => `<article class="studio-saved"><img src="${esc(artUrl(t.id, Look.isLight() ? 'light' : 'dark'))}" alt="" loading="lazy"><div><b>${esc(t.name)}</b><p>${esc(t.note)}</p><div class="studio-actions"><button class="btn" data-studio-use="${t.id}">${Look.get().theme === t.id ? 'Use this world · current' : 'Use this world'}</button><button class="btn quiet" data-studio-delete="${t.id}">Delete</button></div></div></article>`).join('');
  }
  async function open() {
    install(); const mine = ++serial; reviewing = null;
    if (!$('studioDlg').open) $('studioDlg').showModal();
    $('studioBody').innerHTML = '<p class="loading">Opening your worlds…</p>'; error('');
    try { await refresh(); } catch (e) { return error(e); }
    if (mine !== serial || !$('studioDlg').open) return;
    $('studioBody').innerHTML = `<div class="studio-intro"><span class="eyebrow">A place of your own</span><h2>Where would you like to work?</h2><p>Describe a world. Codex paints its night and morning, and the colours follow it home.</p></div>
      <form id="studioForm"><div class="studio-form-row"><label for="studioName">World name<input id="studioName" maxlength="48" placeholder="Lantern Tide" required></label><label for="studioFont">Lettering<select id="studioFont">${Look.FONT_SETS.map(s => `<option value="${s.id}">${esc(s.name)} · ${esc([...new Set([s.head, s.body].map(id => Look.FAMILIES.find(f => f.id === id).name))].join(' · '))}</option>`).join('')}</select></label></div>
      <label for="studioWorld">Describe the place<textarea id="studioWorld" maxlength="1500" required placeholder="A quiet seaside town, paper lanterns above turquoise water, a little wonder at the edge of the day…"></textarea></label>
      <div class="studio-actions"><button class="btn prime" type="submit" ${canPaint() ? '' : 'disabled'}>Review art brief in Codex</button><span>Two paintings · your Codex usage</span></div>
      <p class="studio-help">Send the brief in your chat, then come back here to preview both modes. Your current theme stays as it is until you save and apply.</p>${canPaint() ? '' : '<p class="studio-help">Sign in to a ChatGPT-backed Codex account to create a world. Saved themes still work.</p>'}</form>
      ${library.jobs.length ? `<section><h3>In the studio</h3><div class="studio-drafts">${library.jobs.map(j => `<article><div><b>${esc(j.name)}</b><p>${j.ready ? 'Paintings found · ready to review' : 'Brief prepared · send it in Codex to paint'}</p></div><div class="studio-actions">${j.ready ? `<button class="btn prime" data-studio-review="${j.id}">Review</button>` : `<button class="btn" data-studio-resume="${j.id}" ${canPaint() ? '' : 'disabled'}>Open art brief</button>`}<button class="btn quiet" data-studio-dismiss="${j.id}">Dismiss</button></div></article>`).join('')}</div></section>` : ''}
      ${library.themes.length ? `<section><h3>Your worlds</h3><div class="studio-library">${paintCards()}</div></section>` : '<p class="studio-help">Your saved worlds will be here, shared with your paired devices. Each device chooses its own look.</p>'}`;
  }
  async function compress(url) {
    const im = new Image(); im.src = url; await im.decode();
    if (im.naturalWidth * im.naturalHeight > 32e6) throw new Error('This painting is too large.');
    const scale = Math.min(1, 1600 / im.naturalWidth, 1200 / im.naturalHeight), canvas = document.createElement('canvas');
    canvas.width = Math.round(im.naturalWidth * scale); canvas.height = Math.round(im.naturalHeight * scale);
    canvas.getContext('2d').drawImage(im, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .84);
    if (!data.startsWith('data:image/webp;base64,') || data.length > 2800000) throw new Error('This painting could not be compressed. Try a less detailed image.');
    return data.split(',')[1];
  }
  function sample(t, mode, data) {
    const c = h => `rgb(${Look.color(h, t, mode === 'light').join(',')})`, r = t.readability[mode];
    return `<article class="studio-sample" style="--ss-bg:${c('0a090c')};--ss-card:${c('1a161d')};--ss-ink:${c('ede6d9')};--ss-ash:${c('716a63')};--ss-gold:${c('d9bf74')};--ss-display:${esc(t.fonts.display)};--ss-body:${esc(t.fonts.body)}"><img src="data:image/webp;base64,${data}" alt="${mode === 'dark' ? 'Night' : 'Morning'} painting"><div><span class="studio-mode">${mode === 'dark' ? 'Night' : 'Morning'}</span><h3>${esc(t.name)}</h3><p>${esc(t.copy['Welcome back'] || 'Welcome back')}. Your work is right here.</p><div class="studio-sample-message"><b>Claude · Ready when you are</b><p>The change is ready to review.</p><small>Codex · Up next</small></div><small>Small text ${r.faint.toFixed(1)}:1 · Body ${r.body.toFixed(1)}:1</small></div></article>`;
  }
  async function review(id) {
    const mine = ++serial; reviewing = null; error('Loading paintings and checking readability…');
    const r = await api('/api/themes/result?id=' + encodeURIComponent(id));
    const [dark, light] = await Promise.all(['dark', 'light'].map(mode => compress(artUrl(id, mode, 'jobs', r.revision))));
    if (mine !== serial || !$('studioDlg').open) return;
    reviewing = { ...r, dark, light };
    const kb = Math.round((dark.length + light.length) * .75 / 1024);
    $('studioBody').innerHTML = `<div class="studio-intro"><span class="eyebrow">Your world is ready</span><h2>${esc(r.theme.name)}</h2><p>${esc(r.theme.note)}</p></div><div class="studio-previews">${sample(r.theme, 'dark', dark)}${sample(r.theme, 'light', light)}</div><p class="studio-help">Both modes pass the readability checks. The paintings total ${kb} KB. Text and actions sit on solid surfaces so the scene stays a backdrop.</p><div class="studio-actions"><button class="btn prime" data-studio-save>Save and use this world</button><button class="btn" data-studio-back>Back to the studio</button></div>`;
    $('studioBody').scrollTop = 0;
    error('');
  }
  async function check() {
    if (document.hidden || busy) return;
    try {
      await refresh();
      for (const j of library.jobs) if (j.ready && !announced.has(j.id)) { announced.add(j.id); toast(`“${j.name}” has paintings ready. Open Theme Studio to review them.`, 6500); }
    } catch { /* offline; try on focus */ }
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-studio-open]')) open().catch(error); });
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  document.addEventListener('DOMContentLoaded', () => refresh().catch(() => {}));
  setInterval(() => { if (library.jobs.length) check(); }, 20000);
  return { open, refresh, check, scene, artUrl, review };
})();
