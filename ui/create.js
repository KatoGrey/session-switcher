'use strict';
/* The prompt book, new projects, and making a copy of the app to share. */

/* ---------- the prompt book ---------- */
const today8601 = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// {project} becomes the folder's name ({world} still works too) and {date} today's date.
const fillPrompt = (text, name) => String(text).replace(/\{(project|world)\}/gi, name || 'this project').replace(/\{date\}/gi, today8601());
async function loadPrompts() { try { const j = await api('/api/prompts'); S.prompts = j.prompts || []; S.promptSets = j.sets || []; } catch { S.prompts = S.prompts || []; } }
// The Codex prompt that makes a cover picture, if there is one.
const coverPrompt = () => S.prompts.find(x => x.id === 'cover' || x.id === 'keyart') || null;
function startWithPrompt(cwd, pr) {
  const p = S.projects.find(x => x.cwd === cwd);
  const provider = pr.provider === 'codex' ? 'codex' : 'claude';
  return ChatUI.open({ cwd, mode: 'new', provider, initialText: fillPrompt(pr.text, p ? p.name : '') });
}
function openPromptEditor() {
  closeMenu();
  if (!$('promptDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="promptDlg" class="wide prompt-dlg" aria-labelledby="pdTitle">
      <div class="setup-head"><h3 id="pdTitle">Prompts</h3><button class="icon" data-pd="close" aria-label="Close">✕</button></div>
      <div class="setup-body"><p class="pd-hint">Reusable starts for the jobs you repeat. <code>{project}</code> becomes the project’s folder name and <code>{date}</code> today’s date. Anything else in braces, like <code>{describe it}</code>, is a blank: the message box selects it so you can type over it. Type <code>/</code> in an empty message box to pick a prompt.</p><div id="pdList"></div>
      <div class="d-row pd-row"><button class="btn quiet" data-pd="sets" aria-haspopup="menu" aria-expanded="false">Add a starter set</button><button class="btn quiet" data-pd="reset">Restore the starter prompts</button><span class="spacer"></span><button class="btn" data-pd="add">Add a prompt</button><button class="btn prime" data-pd="save">Save</button></div></div></dialog>`);
    $('promptDlg').addEventListener('click', wrap(async e => {
      const b = e.target.closest('[data-pd]'); if (!b) return;
      const act = b.dataset.pd;
      if (act === 'close') return closePromptEditor();
      if (act === 'add') { $('promptDlg').dataset.dirty = '1'; $('pdList').insertAdjacentHTML('beforeend', promptRow({ id: '', title: '', text: '' })); $('pdList').lastElementChild.querySelector('input').focus(); return; }
      if (act === 'remove') { $('promptDlg').dataset.dirty = '1'; return b.closest('.pd-item').remove(); }
      if (act === 'reset') { if (!(await appConfirm('Put back the starter prompts?\n\nYour own prompts will be replaced.', { ok: 'Put them back', danger: true }))) return; S.prompts = (await api('/api/prompts', { reset: true })).prompts; return renderPromptEditor(); }
      if (act === 'sets') {
        return showMenu(b, (S.promptSets || []).map(st => ({ label: st.title, hint: `${plural(st.count, 'prompt')}, added to yours`, run: async () => { const n0 = S.prompts.length; S.prompts = (await api('/api/prompts', { addSet: st.id })).prompts; renderPromptEditor(); toast(S.prompts.length > n0 ? `Added ${plural(S.prompts.length - n0, 'prompt')} from ${st.title}.` : `You already have every prompt in ${st.title}.`, 3000); } })));
      }
      if (act === 'save') {
        const list = [...$('pdList').querySelectorAll('.pd-item')].map(el => ({ id: el.dataset.id, title: el.querySelector('.pd-t').value, text: el.querySelector('.pd-x').value, provider: el.querySelector('.pd-p').value === 'codex' ? 'codex' : undefined }));
        S.prompts = (await api('/api/prompts', { prompts: list })).prompts;
        toast(`Saved ${plural(S.prompts.length, 'prompt')}.`, 2000);
        $('promptDlg').dataset.dirty = '';
        return $('promptDlg').close();
      }
    }));
  }
  if (!$('promptDlg')._guard) {
    $('promptDlg')._guard = true;
    $('promptDlg').addEventListener('input', () => { $('promptDlg').dataset.dirty = '1'; });
    // Esc and clicks on the backdrop ask before throwing edits away. (A browser can refuse to hold
    // a dialog open on Esc; then it closes, and comes straight back to ask.)
    $('promptDlg').addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); closePromptEditor(); } });
    $('promptDlg').addEventListener('cancel', e => { if (!e.cancelable) return; e.preventDefault(); closePromptEditor(); });
    $('promptDlg').addEventListener('close', () => { if ($('promptDlg').dataset.dirty) { $('promptDlg').showModal(); closePromptEditor(); } });
    $('promptDlg').addEventListener('click', e => { if (e.target === $('promptDlg')) closePromptEditor(); });
  }
  renderPromptEditor();
  $('promptDlg').showModal();
}
async function closePromptEditor() {
  const d = $('promptDlg');
  if ($('confirmDlg')?.open) return;
  if (d.dataset.dirty && !(await appConfirm('Discard your changes to the prompts?\n\nThey haven’t been saved.', { ok: 'Discard', cancel: 'Keep editing', danger: true }))) return;
  d.dataset.dirty = ''; d.close();
}
function promptRow(pr) {
  return `<div class="pd-item" data-id="${esc(pr.id || '')}"><div class="pd-top"><input class="pd-t" value="${esc(pr.title)}" placeholder="Name, like “Balance pass”" maxlength="80" aria-label="Prompt name">
    <select class="pd-p" aria-label="Runs in"><option value="claude" ${pr.provider === 'codex' ? '' : 'selected'}>Claude</option><option value="codex" ${pr.provider === 'codex' ? 'selected' : ''}>Codex</option></select>
    <button class="icon" data-pd="remove" aria-label="Remove this prompt">✕</button></div>
    <textarea class="pd-x" rows="3" placeholder="What to ask. {project} and {date} fill in automatically." aria-label="Prompt text">${esc(pr.text)}</textarea></div>`;
}
function renderPromptEditor() { $('pdList').innerHTML = S.prompts.map(promptRow).join(''); $('promptDlg').dataset.dirty = ''; }
/* ---------- new project: make a folder (or pick one you have) and start a chat in it ---------- */
const NP = { mode: 'new', places: null, busy: false };
// The same rules the server uses, so mistakes show while you type.
function folderNameProblem(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (n.length > 80) return 'Keep the name under 80 characters.';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) return 'A folder name can’t contain < > : " / \\ | ? or *.';
  if (/[. ]$/.test(n)) return 'A folder name can’t end with a dot or a space.';
  if (/^\.+$/.test(n)) return 'Pick a name with letters or numbers in it.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return `Windows keeps the name “${n}” for itself. Pick another.`;
  return '';
}
const joinDir = (dir, name) => { const sep = (NP.places && NP.places.sep) || (dir.includes('\\') ? '\\' : '/'); return `${String(dir).replace(/[\\/]+$/, '')}${sep}${name}`; };
const shortDir = p => { const parts = String(p).split(/[\\/]+/).filter(Boolean); return parts.length > 2 ? `…${p.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(p.includes('\\') ? '\\' : '/')}` : p; };
async function openNewProject() {
  closeMenu(); closePalette();
  if (!$('npDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="npDlg" class="np-dlg" aria-labelledby="npTitle">
      <form id="npForm" novalidate>
        <div class="np-head"><h3 id="npTitle">New project</h3><button type="button" class="icon" data-np="close" aria-label="Close">✕</button></div>
        <div class="seg np-mode" role="group" aria-label="Where the project lives"><button type="button" data-np-mode="new" aria-pressed="true" class="on">Make a new folder</button><button type="button" data-np-mode="existing" aria-pressed="false">Use a folder I have</button></div>
        <div class="np-sec" id="npNew">
          <label class="np-f" for="npName"><span>Name</span></label>
          <input id="npName" maxlength="80" autocomplete="off" spellcheck="false" placeholder="My new project">
          <label class="np-f" for="npParent"><span>Location</span></label>
          <div class="np-loc"><input id="npParent" list="npPlaces" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-np="browse">Browse…</button></div>
          <datalist id="npPlaces"></datalist>
          <div class="np-chips" id="npChips"></div>
          <p class="np-path" id="npPath"></p>
        </div>
        <div class="np-sec" id="npHave" hidden>
          <label class="np-f" for="npExisting"><span>Folder</span></label>
          <div class="np-loc"><input id="npExisting" autocomplete="off" spellcheck="false" placeholder="The full path, like C:\\Users\\you\\Projects\\Something"><button type="button" class="btn" data-np="browse-existing">Browse…</button></div>
          <p class="np-path">Nothing in it is moved or changed. It just appears in your projects.</p>
        </div>
        <fieldset class="np-as"><legend>Start a chat in it as</legend><div id="npAs"></div></fieldset>
        <div class="np-sec" id="npPromptRow"><label class="np-f" for="npPrompt"><span>Start with</span></label><select id="npPrompt"></select></div>
        <div class="np-err" id="npErr" role="alert" hidden></div>
        <div class="d-row"><button type="button" class="btn" data-np="close">Cancel</button><button type="submit" class="btn prime" id="npGo">Create project</button></div>
      </form></dialog>`);
    const d = $('npDlg');
    d.addEventListener('click', wrap(async e => {
      if (e.target === d) return d.close();
      const m = e.target.closest('[data-np-mode]'); if (m) return npMode(m.dataset.npMode);
      const ch = e.target.closest('[data-np-place]'); if (ch) { $('npParent').value = ch.dataset.npPlace; return npRefresh(); }
      const b = e.target.closest('[data-np]'); if (!b) return;
      if (b.dataset.np === 'close') return d.close();
      if (b.dataset.np === 'browse' || b.dataset.np === 'browse-existing') {
        const input = b.dataset.np === 'browse' ? $('npParent') : $('npExisting');
        b.disabled = true;
        try {
          const r = await api('/api/project/pick', { start: input.value || (NP.places && NP.places.suggested) || '', title: b.dataset.np === 'browse' ? 'Choose where the new project’s folder goes' : 'Choose the project’s folder' });
          if (r.unsupported) toast('The folder window only opens on Windows and macOS. Type the path instead.', 4000);
          else if (r.path) { input.value = r.path; npRefresh(); }
        } finally { b.disabled = false; input.focus(); }
        return;
      }
      if (b.dataset.np === 'use-existing') return npSubmit(true);
    }));
    $('npForm').addEventListener('submit', e => { e.preventDefault(); wrap(npSubmit)(false); });
    $('npForm').addEventListener('input', () => npRefresh());
    $('npForm').addEventListener('change', e => { if (e.target.name === 'npAs') npRefresh(); });
  }
  NP.busy = false;
  npMode('new', true);
  $('npName').value = ''; $('npExisting').value = '';
  $('npErr').hidden = true;
  npRenderAs();
  $('npPrompt').innerHTML = `<option value="">Nothing yet, I’ll write the first message</option>${S.prompts.map(pr => `<option value="${esc(pr.id)}">${esc(pr.title)}</option>`).join('')}`;
  $('npDlg').showModal();
  $('npName').focus();
  try {
    NP.places = await api('/api/project/places');
    if (!$('npParent').value) $('npParent').value = NP.places.suggested;
    $('npPlaces').innerHTML = NP.places.places.map(x => `<option value="${esc(x.path)}">`).join('');
    $('npChips').innerHTML = NP.places.places.filter(x => x.projects).slice(0, 4).map(x => `<button type="button" class="chip" data-np-place="${esc(x.path)}" title="${esc(x.path)}">${esc(shortDir(x.path))}<span class="count">${x.projects}</span></button>`).join('');
  } catch { /* you can still type a location */ }
  npRefresh();
}
function npMode(mode, quiet) {
  NP.mode = mode;
  for (const b of document.querySelectorAll('#npDlg [data-np-mode]')) { const on = b.dataset.npMode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  $('npNew').hidden = mode !== 'new'; $('npHave').hidden = mode !== 'existing';
  $('npGo').textContent = mode === 'new' ? 'Create project' : 'Add project';
  $('npErr').hidden = true;
  if (!quiet) (mode === 'new' ? $('npName') : $('npExisting')).focus();
  npRefresh();
}
// Who the first chat runs as: any Claude account, Codex, or no chat yet.
function npRenderAs() {
  const cur = current();
  const opts = S.accounts.map(a => {
    const ok = canLaunch(a);
    const why = !a.signedIn ? 'Not signed in' : !a.lock.ok ? (a.lockMessage || 'Not on its locked account') : usageLine(a.id, { short: true }) || a.email || 'Ready';
    return { v: a.id, ring: ringOf(a), name: a.name, sub: why, ok };
  });
  if (S.codex && S.codex.enabled) opts.push({ v: 'codex', ring: codexRing(S.codex.id), name: S.codex.name || 'Codex', sub: codexReady() ? (usageLine(S.codex.id, { short: true }) || (S.codex.kind === 'ollama' ? 'Ollama' : 'ChatGPT')) : 'Sign in to Codex first', ok: codexReady(), codex: true });
  opts.push({ v: 'none', name: 'Don’t start a chat yet', sub: 'Just make the folder and open the project', ok: true, none: true });
  const pick = (canLaunch(cur) && cur.id) || (opts.find(o => o.ok) || {}).v;
  $('npAs').innerHTML = opts.map(o => `<label class="np-opt ${o.ok ? '' : 'off'} ${o.codex ? 'codex' : ''}"><input type="radio" name="npAs" value="${esc(o.v)}" ${o.v === pick ? 'checked' : ''} ${o.ok ? '' : 'disabled'}>
    ${o.none ? '<span class="np-ring none" aria-hidden="true"></span>' : `<span class="np-ring" style="--ring:${o.ring}" aria-hidden="true"></span>`}<span class="np-t"><b>${esc(o.name)}</b><small>${esc(o.sub)}</small></span></label>`).join('');
}
function npRefresh() {
  if (!$('npDlg') || !$('npDlg').open) return;
  const as = (document.querySelector('#npAs input:checked') || {}).value;
  $('npPromptRow').hidden = as === 'none';
  if (NP.mode === 'new') {
    const name = $('npName').value.trim(), parent = $('npParent').value.trim();
    const bad = folderNameProblem(name);
    $('npPath').innerHTML = bad ? `<span class="np-bad">${esc(bad)}</span>` : name && parent ? `Creates <code>${esc(joinDir(parent, name))}</code>` : 'Pick a name and where its folder goes.';
    $('npGo').disabled = NP.busy || !name || !parent || !!bad || !as;
  } else $('npGo').disabled = NP.busy || !$('npExisting').value.trim() || !as;
}
async function npSubmit(useExisting) {
  if ($('npGo').disabled && !useExisting) return;
  const as = (document.querySelector('#npAs input:checked') || {}).value || 'none';
  const pr = as === 'none' ? null : S.prompts.find(x => x.id === $('npPrompt').value) || null;
  const body = NP.mode === 'existing' ? { existing: $('npExisting').value } : { parent: $('npParent').value, name: $('npName').value, useExisting };
  NP.busy = true; npRefresh(); $('npErr').hidden = true;
  let r;
  try { r = await api('/api/project/create', body); }
  catch (err) {
    NP.busy = false; npRefresh();
    $('npErr').hidden = false;
    $('npErr').innerHTML = err.reason === 'exists'
      ? `<span>${esc(err.message)} Use it as this project? Nothing in it changes.</span><button type="button" class="btn sm" data-np="use-existing">Use that folder</button>`
      : `<span>${esc(err.message)}</span>`;
    return;
  }
  NP.busy = false;
  $('npDlg').close();
  await loadSessions(); renderNav();
  const name = r.name;
  toast(`${r.created ? 'Created' : 'Added'} ${name}.`, 2500);
  const initialText = pr ? fillPrompt(pr.text, name) : '';
  if (as === 'none') return go('folder', r.cwd);
  if (as === 'codex') return ChatUI.open({ cwd: r.cwd, mode: 'new', provider: 'codex', initialText });
  return ChatUI.open({ cwd: r.cwd, mode: 'new', accountId: as, initialText });
}

/* ---------- a copy of the app for someone else ---------- */
function shareCopy() {
  if (!$('shareDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="shareDlg" aria-labelledby="shTitle"><form method="dialog" id="shForm">
      <h3 id="shTitle">Make a copy to share</h3>
      <p class="sh-p">A zip of Session Switcher for someone else. It has the app only: none of your accounts, sign-ins, chats, chat names, banners or projects go in it. They unzip it and double-click <b>Claude Switcher.vbs</b>, then sign in with their own accounts.</p>
      <label class="toggle"><input type="checkbox" id="shPrompts"><span><b>Include my prompts</b><span id="shCount"></span></span></label>
      <div class="d-row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn prime" value="ok" id="shGo">Make the copy</button></div>
    </form></dialog>`);
    $('shareDlg').addEventListener('close', wrap(async () => {
      if ($('shareDlg').returnValue !== 'ok') return;
      const r = await api('/api/share-copy', { includePrompts: $('shPrompts').checked });
      const where = /[\\/]Desktop$/i.test(r.path.replace(/[\\/][^\\/]+$/, '')) ? 'on your Desktop' : `in ${r.path.replace(/[\\/][^\\/]+$/, '')}`;
      toast(`Saved “${r.path.split(/[\\/]/).pop()}” ${where}${r.withPrompts ? ', with your prompts' : ''}. That’s the file to send.`, 9000);
    }));
  }
  $('shCount').textContent = `So they start with your ${plural(S.prompts.length, 'prompt')}. Otherwise they get the starter set.`;
  $('shPrompts').checked = false;
  $('shareDlg').returnValue = '';
  $('shareDlg').showModal();
}

function promptMenu(anchor, cwd) {
  if (!S.prompts.length) return openPromptEditor();
  const a = current();
  showMenu(anchor, [
    ...S.prompts.map(pr => ({ label: pr.title, hint: pr.provider === 'codex' ? 'runs in Codex' : '', disabled: pr.provider === 'codex' ? !codexReady() : !canLaunch(a), why: pr.provider === 'codex' ? 'Sign in to Codex first' : (a.lockMessage || `Sign in to ${a.name} first`), run: () => startWithPrompt(cwd, pr) })),
    '-',
    { label: 'Edit prompts…', run: openPromptEditor },
  ]);
}
