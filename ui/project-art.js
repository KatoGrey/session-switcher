'use strict';
// Project identity: a picked picture stays local to the project. Image creation uses the normal
// Codex conversation, with an editable prompt and its existing permission and cancellation controls.
window.ProjectArt = (() => {
  const KEY = 'crest-pending-v1', MAX_AGE = 24 * 3600e3;
  let pending = {}, checking = false, cwd = null, request = 0;
  try { const saved = JSON.parse(store(KEY) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) pending = saved; } catch { /* no pending image */ }
  const save = () => store(KEY, JSON.stringify(pending));
  const canPaint = () => codexReady() && S.codex.kind !== 'ollama';
  const defaults = () => ({ isekai: 'A luminous anime crest: a floating crystal and an open portal, cyan and violet with a little gold.', highfantasy: 'A painted heraldic crest: an elegant citadel sigil, emerald enamel and aged gold.', dungeon: 'A painted dungeon crest: an ancient key and a small ember, dark iron and warm copper.' }[Look.get().theme] || 'A distinctive painted emblem that fits this project, with a clear silhouette and restrained colour.');
  function brief(p, direction, target) {
    return `Make a finished square project crest for ${JSON.stringify(p.name)}. Read the project's short README or introduction to understand its identity.\n\nArt direction: ${direction.trim() || defaults()}\n\nUse image generation to paint the image. One bold central emblem, legible at 24–48 pixels, with generous padding, clean edges and no text, lettering, watermark or tiny details. Ask for a transparent background if appropriate.\n\nSave the final image inside this project as ${JSON.stringify(target)}. Keep existing crests, logos, banners and other project files intact. Do not overwrite a file if that name already exists; report it instead. Do not edit application code for this task. If image generation is unavailable, say so rather than creating a placeholder. Once saved, show the image and report the exact path.`;
  }
  function repaint() {
    renderNav();
    if (window.ChatUI) {
      ChatUI.renderRail();
      if (ChatUI.isOpen() && C.info && C.info.cwd) {
        const p = S.projects.find(x => x.cwd === C.info.cwd);
        if (p && $('cCrest')) $('cCrest').innerHTML = crestHtml(p, 40);
      }
    }
    if (!(window.ChatUI && ChatUI.isOpen())) {
      if (S.view === 'folder') renderFolder();
      else if (S.view === 'hub') renderHub();
    }
  }
  async function refresh(dir) { if (!dir || !S.projects.some(p => p.cwd === dir)) return; delete pending[dir]; save(); await loadWorld(dir, true); repaint(); }
  async function choose(dir, path) {
    const w = await api('/api/project/crest', { cwd: dir, path });
    delete pending[dir]; save(); S.worlds[dir] = { ...w, at: Date.now() }; repaint();
    toast(path ? 'Project crest updated.' : 'Using the automatic crest.', 2500);
  }
  function install() {
    if ($('crestDlg')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="projectArtStyle">
      .crest-dlg{width:min(580px,calc(100vw - 28px));padding:0}.crest-dlg .setup-body{display:grid;gap:16px;max-height:75vh;overflow:auto}.crest-summary{display:flex;align-items:center;gap:18px}.crest-summary p{margin:5px 0;color:var(--ash);font:14px/1.5 var(--f-body)}.crest-dlg label{display:grid;gap:7px;color:var(--parch-2);font:15px/1.4 var(--f-body)}.crest-dlg textarea{box-sizing:border-box;width:100%;min-height:92px;resize:vertical;padding:12px;border:1px solid var(--seam-2);border-radius:8px;color:var(--parch);background:var(--abyss);font:15px/1.5 var(--f-body)}.crest-dlg .d-row{display:flex;gap:8px;flex-wrap:wrap}.crest-help{color:var(--ash);font:13px/1.5 var(--f-body);margin:0}.crest-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}.crest-option{padding:0;aspect-ratio:1;border:1px solid var(--seam-2);border-radius:9px;overflow:hidden;background:var(--vellum-2);cursor:pointer}.crest-option[aria-pressed=true]{outline:2px solid var(--gilt);outline-offset:2px}.crest-option img{width:100%;height:100%;object-fit:cover}.crest-option:focus-visible{outline:3px solid var(--parch);outline-offset:2px}.crest-dlg summary{cursor:pointer;color:var(--parch-2);padding:8px 0}.crest-dlg .btn{min-height:42px}.crest-pending{color:var(--gilt);font:13px/1.5 var(--f-body)}
    </style>`);
    document.body.insertAdjacentHTML('beforeend', `<dialog id="crestDlg" class="crest-dlg" aria-labelledby="crestTitle"><div class="setup-head"><h3 id="crestTitle">Project crest</h3><button type="button" class="icon" data-crest-close aria-label="Close">✕</button></div><div class="setup-body" id="crestBody"></div></dialog>`);
    $('crestDlg').addEventListener('click', wrap(async e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.hasAttribute('data-crest-close')) return $('crestDlg').close();
      if (b.hasAttribute('data-crest-pick')) { await choose(cwd, b.dataset.crestPick || null); return open(cwd); }
      if (b.hasAttribute('data-crest-cancel')) { delete pending[cwd]; save(); return open(cwd); }
      if (b.hasAttribute('data-crest-make')) {
        const p = S.projects.find(x => x.cwd === cwd); if (!p || !canPaint()) return;
        // getRandomValues also works on the phone's local HTTP connection; randomUUID requires HTTPS.
        const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(16)).join('-');
        const dir = cwd, target = `crest-${Date.now()}-${nonce}.png`;
        const prompt = brief(p, $('crestDirection').value, target);
        $('crestDlg').close();
        await ChatUI.open({ cwd: dir, mode: 'new', provider: 'codex', initialText: prompt });
        // This is a prepared prompt, not a claim that an image is being generated. Nothing is sent
        // until the user sends it in the conversation. Only that exact output can become the crest.
        if (ChatUI.isOpen() && C.info && C.info.cwd === dir && $('cText').value === prompt) { pending[dir] = { name: target, at: Date.now() }; save(); }
      }
    }));
  }
  async function open(dir) {
    closeMenu(); install(); cwd = dir;
    const id = ++request, p = S.projects.find(x => x.cwd === dir); if (!p || !p.exists) return;
    if (!$('crestDlg').open) $('crestDlg').showModal();
    $('crestBody').innerHTML = '<p class="loading">Loading this project’s pictures…</p>';
    let w;
    try { w = await loadWorld(dir, true); } catch (err) { if (id === request) $('crestBody').textContent = err.message; return; }
    if (id !== request || !$('crestDlg').open) return;
    const wait = pending[dir], images = (w.images || []).slice(0, 300);
    $('crestBody').innerHTML = `<div class="crest-summary">${crestHtml(p, 76)}<div><b>${esc(p.name)}</b><p>One recognisable picture across your projects, sidebar and chats.</p></div></div>
      <label for="crestDirection">Make a crest with Codex<textarea id="crestDirection" maxlength="1500">${esc(defaults())}</textarea></label>
      <p class="crest-help">Review the prompt in your Codex chat, then send it to create the image. The new picture becomes this project’s crest when it is saved. Your existing artwork stays in the folder.</p>
      <div class="d-row"><button class="btn prime" data-crest-make ${canPaint() ? '' : 'disabled'}>Review prompt in Codex</button><button class="btn quiet" data-crest-pick="">Use automatic crest</button></div>
      ${canPaint() ? '' : '<p class="crest-help">Sign in to a ChatGPT-backed Codex account to create images. You can still choose an existing picture.</p>'}
      ${wait ? '<p class="crest-pending">A crest prompt is prepared. Send it in Codex to create the picture. <button class="linkish" data-crest-cancel>Stop watching for it</button></p>' : ''}
      <details${images.length ? ' open' : ''}><summary>Choose an existing picture (${images.length}${w.images.length > images.length ? '+' : ''})</summary><div class="crest-gallery">${images.map(im => `<button type="button" class="crest-option" data-crest-pick="${esc(im.path)}" aria-label="Use ${esc(im.name)} as crest" aria-pressed="${w.crest === im.path}" title="${esc(im.rel || im.name)}"><img src="${esc(imageSrc(im.path, dir))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>${images.length ? '' : '<p class="crest-help">Images saved in this project appear here.</p>'}</details>`;
  }
  async function check() {
    if (checking || document.hidden || !Object.keys(pending).length) return;
    checking = true;
    try {
      for (const [dir, job] of Object.entries(pending)) {
        if (!job || !/^crest-[\w-]+\.png$/.test(job.name) || Date.now() - job.at > MAX_AGE || !Number.isFinite(job.at)) { delete pending[dir]; save(); continue; }
        if (!S.projects.some(p => p.cwd === dir && p.exists)) continue;
        try {
          const result = await api(`/api/project/crest-result?${new URLSearchParams({ cwd: dir, name: job.name })}`);
          if (pending[dir] !== job) continue;
          const image = result.image;
          if (!image) continue;
          // Wait for the decoder before adopting a file still being copied to disk.
          const im = new Image(); im.src = `${imageSrc(image.path, dir)}&v=${image.mtime}-${image.size}`; await im.decode();
          if (pending[dir] === job) await choose(dir, image.path);
        } catch { /* the file may still be being written; the next check tries again */ }
      }
    } finally { checking = false; }
  }
  document.addEventListener('click', wrap(e => { const b = e.target.closest('[data-project-crest]'); if (b) return open(b.dataset.projectCrest); }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  setInterval(check, 15000);
  return { open, refresh, check, brief };
})();
