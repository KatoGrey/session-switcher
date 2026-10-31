'use strict';
/* The prompt book, new projects, and making a copy of the app to share. */

/* ---------- the prompt book ---------- */
const today8601 = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// {project} becomes the folder's name ({world} still works too) and {date} today's date.
const fillPrompt = (text, name) => String(text).replace(/\{(project|world)\}/gi, name || 'this project').replace(/\{date\}/gi, today8601());
async function loadPrompts() { try { const j = await api('/api/prompts'); S.prompts = j.prompts || []; S.promptSets = j.sets || []; } catch { S.prompts = S.prompts || []; } }
// The Codex prompt that makes a cover picture, if there is one.
const coverPrompt = () => S.prompts.find(x => x.id === 'cover' || x.id === 'keyart') || null;
// Who a prompt runs in, and whether it can just now.
const promptProv = pr => (pr.provider === 'codex' || pr.provider === 'gemini' ? pr.provider : 'claude');
function promptRuns(pr) {
  const prov = promptProv(pr), a = current();
  if (prov === 'codex') return { prov, hint: 'runs in Codex', ok: codexReady(), why: 'Sign in to Codex first' };
  if (prov === 'gemini') return { prov, hint: 'runs in Gemini', ok: geminiReady(), why: 'Sign in to Gemini first (Setup → Gemini)' };
  return { prov, hint: '', ok: canLaunch(a), why: a.lockMessage || `Sign in to ${a.name} first` };
}
function startWithPrompt(cwd, pr) {
  const p = S.projects.find(x => x.cwd === cwd);
  return ChatUI.open({ cwd, mode: 'new', provider: promptProv(pr), initialText: fillPrompt(pr.text, p ? p.name : '') });
}
function openPromptEditor() {
  closeMenu();
  if (!$('promptDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="promptDlg" class="wide prompt-dlg" aria-labelledby="pdTitle">
      <div class="setup-head"><h3 id="pdTitle">Prompts</h3><button class="icon" data-pd="close" aria-label="Close">✕</button></div>
      <div class="setup-body"><p class="pd-hint">Reusable starts for the jobs you repeat. <code>{project}</code> becomes the project’s folder name and <code>{date}</code> today’s date. Anything else in braces, like <code>{describe it}</code>, is a blank: the message box selects it so you can type over it. Type <code>/</code> in an empty message box to pick a prompt.</p><div id="pdList"></div>
      <div class="d-row pd-row"><button class="btn quiet" data-pd="sets" aria-haspopup="menu" aria-expanded="false">Add a starter set</button><button class="btn quiet" data-pd="reset">Restore the starter prompts</button><button class="btn quiet" data-pd="export" title="Save your prompts as a file to share">Export…</button><button class="btn quiet" data-pd="import" title="Add prompts from a file someone shared">Import…</button><span class="spacer"></span><button class="btn" data-pd="add">Add a prompt</button><button class="btn prime" data-pd="save">Save</button></div></div></dialog>`);
    $('promptDlg').addEventListener('click', wrap(async e => {
      const b = e.target.closest('[data-pd]'); if (!b) return;
      const act = b.dataset.pd;
      if (act === 'close') return closePromptEditor();
      if (act === 'add') { $('promptDlg').dataset.dirty = '1'; $('pdList').insertAdjacentHTML('beforeend', promptRow({ id: '', title: '', text: '' })); $('pdList').lastElementChild.querySelector('input').focus(); return; }
      if (act === 'remove') { $('promptDlg').dataset.dirty = '1'; return b.closest('.pd-item').remove(); }
      if (act === 'export') return exportPrompts();
      if (act === 'import') return importPrompts();
      if (act === 'reset') { if (!(await appConfirm('Put back the starter prompts?\n\nYour own prompts will be replaced.', { ok: 'Put them back', danger: true }))) return; S.prompts = (await api('/api/prompts', { reset: true })).prompts; return renderPromptEditor(); }
      if (act === 'sets') {
        return showMenu(b, (S.promptSets || []).map(st => ({ label: st.title, hint: `${plural(st.count, 'prompt')}, added to yours`, run: async () => {
          const n0 = S.prompts.length, had = new Set(S.prompts.map(p => p.id));
          S.prompts = (await api('/api/prompts', { addSet: st.id })).prompts;
          // What you're in the middle of editing stays: the new ones join the list under it.
          if ($('promptDlg').dataset.dirty === '1') $('pdList').insertAdjacentHTML('beforeend', S.prompts.filter(p => !had.has(p.id)).map(promptRow).join('')); else renderPromptEditor();
          toast(S.prompts.length > n0 ? `Added ${plural(S.prompts.length - n0, 'prompt')} from ${st.title}.` : `You already have every prompt in ${st.title}.`, 3000); } })));
      }
      if (act === 'save') {
        const list = [...$('pdList').querySelectorAll('.pd-item')].map(el => ({ id: el.dataset.id, title: el.querySelector('.pd-t').value, text: el.querySelector('.pd-x').value, provider: ['codex', 'gemini'].includes(el.querySelector('.pd-p').value) ? el.querySelector('.pd-p').value : undefined }));
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
// Prompt sets to share: your prompts as a file, and prompts from someone else's file added to yours.
function exportPrompts() {
  const rows = [...$('pdList').querySelectorAll('.pd-item')].map(el => ({ title: el.querySelector('.pd-t').value.trim(), text: el.querySelector('.pd-x').value, provider: promptProv({ provider: el.querySelector('.pd-p').value }) })).filter(p => p.title && p.text.trim());
  if (!rows.length) { toast('There are no prompts to export yet.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'session-switcher', kind: 'prompts', prompts: rows }, null, 2)], { type: 'application/json' }));
  a.download = 'prompts.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Saved ${plural(rows.length, 'prompt')} as prompts.json in your Downloads, to share.`, 4000);
}
function importPrompts() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = wrap(async () => {
    const f = input.files && input.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('That file is too big for a prompt set.'); return; }
    addPromptsFrom(await f.text());
  });
  input.click();
}
// Adds the prompts in an exported file's text to the editor (to keep with Save).
function addPromptsFrom(textOfFile) {
  let j;
  try { j = JSON.parse(textOfFile); } catch { toast('That isn’t a prompt file (it should be the prompts.json someone exported).'); return; }
  const list = (Array.isArray(j) ? j : j && Array.isArray(j.prompts) ? j.prompts : []).filter(p => p && typeof p.title === 'string' && typeof p.text === 'string' && p.title.trim() && p.text.trim()).slice(0, 200);
  if (!list.length) { toast('No prompts in that file.'); return; }
  const have = new Set([...$('pdList').querySelectorAll('.pd-t')].map(x => x.value.trim().toLowerCase()));
  let added = 0, same = 0;
  for (const p of list) {
    if (have.has(p.title.trim().toLowerCase())) { same++; continue; }
    have.add(p.title.trim().toLowerCase());
    $('pdList').insertAdjacentHTML('beforeend', promptRow({ id: '', title: p.title.trim().slice(0, 80), text: p.text.slice(0, 20000), provider: promptProv(p) }));
    added++;
  }
  if (added) $('promptDlg').dataset.dirty = '1';
  toast(added ? `Added ${plural(added, 'prompt')}${same ? ` (${same} with a name you already have ${same === 1 ? 'was' : 'were'} skipped)` : ''}. Press Save to keep them.` : 'You already have all of those (by name).', 6000);
}
async function closePromptEditor() {
  const d = $('promptDlg');
  if ($('confirmDlg')?.open) return;
  if (d.dataset.dirty && !(await appConfirm('Discard your changes to the prompts?\n\nThey haven’t been saved.', { ok: 'Discard', cancel: 'Keep editing', danger: true }))) return;
  d.dataset.dirty = ''; d.close();
}
function promptRow(pr) {
  return `<div class="pd-item" data-id="${esc(pr.id || '')}"><div class="pd-top"><input class="pd-t" value="${esc(pr.title)}" placeholder="Name, like “Balance pass”" maxlength="80" aria-label="Prompt name">
    <select class="pd-p" aria-label="Runs in"><option value="claude" ${promptProv(pr) === 'claude' ? 'selected' : ''}>Claude</option><option value="codex" ${pr.provider === 'codex' ? 'selected' : ''}>Codex</option>${(S.gemini && S.gemini.enabled) || pr.provider === 'gemini' ? `<option value="gemini" ${pr.provider === 'gemini' ? 'selected' : ''}>Gemini</option>` : ''}</select>
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
    if (!$('npParent').value) $('npParent').value = (NP.places && NP.places.suggested) || '';
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
// Who the first chat runs as: any Claude account, Codex, Gemini, or no chat yet.
function npRenderAs() {
  const cur = current();
  const opts = S.accounts.map(a => {
    const ok = canLaunch(a);
    const why = !a.signedIn ? 'Not signed in' : !a.lock.ok ? (a.lockMessage || 'Not on its locked account') : usageLine(a.id, { short: true }) || a.email || 'Ready';
    return { v: a.id, ring: ringOf(a), name: a.name, sub: why, ok };
  });
  if (S.codex && S.codex.enabled) opts.push({ v: 'codex', ring: codexRing(S.codex.id), name: S.codex.name || 'Codex', sub: codexReady() ? (usageLine(S.codex.id, { short: true }) || (S.codex.kind === 'ollama' ? 'Ollama' : 'ChatGPT')) : 'Sign in to Codex first', ok: codexReady(), codex: true });
  if (S.gemini && S.gemini.enabled) opts.push({ v: 'gemini', ring: 'var(--gemini)', name: 'Gemini', sub: geminiReady() ? 'Your Google AI plan' : 'Sign in to Gemini first', ok: geminiReady() });
  opts.push({ v: 'none', name: 'Don’t start a chat yet', sub: NP.mode === 'new' ? 'Just make the folder and open the project' : 'Just open the project', ok: true, none: true });
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
  if (as === 'codex' || as === 'gemini') return ChatUI.open({ cwd: r.cwd, mode: 'new', provider: as, initialText });
  return ChatUI.open({ cwd: r.cwd, mode: 'new', accountId: as, initialText });
}

/* ---------- new chat: in any project, with any of them, from anywhere ---------- */
const NC = { cwd: null, prov: 'claude', q: '', as: null, with: [], how: 'turns' };
// Who you last started with in a project: it's who you probably want there again.
const ncMemo = cwd => { try { return JSON.parse(store(`nc:${cwd}`) || 'null'); } catch { return null; } };
function ncRecall() {
  const m = NC.cwd && ncMemo(NC.cwd);
  NC.prov = (m && m.prov) || store('nc-prov') || 'claude';
  NC.as = (m && m.as) || null;
  NC.with = m && Array.isArray(m.with) ? m.with.slice() : [];
  NC.how = (m && m.how) || 'turns';
}
// Of the accounts that can start a chat, the one with the most left, when that's known for at least two.
function ncRoom(opts) {
  let best = null, known = 0;
  for (const o of opts) {
    if (!o.ok) continue;
    const b = binding(usageOf(o.id)); if (!b) continue;
    known++;
    if (!best || b.left > best.left) best = { ...o, left: b.left };
  }
  return known >= 2 ? best : null;
}
const ncProjects = () => S.projects.filter(p => p.exists !== false && p.cwd !== cmdrSet().cwd).sort((a, b) => projLast(b) - projLast(a));
const ncWho = () => [
  { v: 'claude', name: 'Claude', on: S.accounts.some(canLaunch), why: 'Sign in to a Claude account first' },
  ...(S.codex && S.codex.enabled ? [{ v: 'codex', name: 'Codex', on: codexReady(), why: S.codex.installed === false ? 'Install Codex first (Setup)' : 'Sign in to Codex first' }] : []),
  ...(S.gemini && S.gemini.enabled ? [{ v: 'gemini', name: 'Gemini', on: geminiReady(), why: S.gemini.installed === false ? 'Install the Antigravity CLI first (Setup → Gemini)' : 'Sign in to Gemini first (Setup → Gemini)' }] : []),
];
// cwd: the project to start on (else the one you're in or on, else the one used last).
function openNewChat({ cwd = null, text = '' } = {}) {
  closeMenu(); closePalette();
  if (!$('ncDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="ncDlg" class="nc-dlg" aria-labelledby="ncTitle"><form id="ncForm" novalidate>
      <div class="nc-head"><h3 id="ncTitle">New chat</h3><button type="button" class="icon" data-nc="close" aria-label="Close">✕</button></div>
      <div><label class="nc-l" for="ncQ">Project</label>
        <input type="search" id="ncQ" placeholder="Filter projects" autocomplete="off" spellcheck="false" role="combobox" aria-controls="ncList" aria-expanded="true" aria-autocomplete="list">
        <ul class="nc-list" id="ncList" role="listbox" aria-label="Projects"></ul></div>
      <div class="nc-who"><div><span class="nc-l" id="ncWhoL">With</span><div class="nc-seg" id="ncSeg" role="group" aria-labelledby="ncWhoL"></div></div>
        <div class="nc-as" id="ncAsWrap" hidden><label class="nc-l" for="ncAs">As</label><select id="ncAs"></select></div></div>
      <div class="nc-crew" id="ncCrew" hidden></div>
      <div><label class="nc-l" for="ncText">First message <small>(optional; it waits in the box for you to send)</small></label><textarea id="ncText" rows="2"></textarea></div>
      <div class="nc-foot"><button type="button" class="btn quiet" data-nc="project">New project…</button><span class="spacer"></span><button type="button" class="btn" data-nc="close">Cancel</button><button type="submit" class="btn prime" id="ncGo">Start chat</button></div>
    </form></dialog>`);
    const d = $('ncDlg');
    d.addEventListener('click', wrap(async e => {
      if (e.target === d) return d.close();
      const b = e.target.closest('[data-nc]');
      if (b) { d.close(); return b.dataset.nc === 'project' ? openNewProject() : undefined; }
      const w = e.target.closest('[data-nc-who]'); if (w) { NC.prov = w.dataset.ncWho; NC.as = null; NC.with = NC.with.filter(k => k !== NC.prov); return ncRenderWho(); }
      const cw = e.target.closest('input[data-nc-with]');
      if (cw) { NC.with = NC.with.filter(k => k !== cw.dataset.ncWith); if (cw.checked) NC.with.push(cw.dataset.ncWith); return ncRenderCrew(); }
      const hw = e.target.closest('[data-nc-how]'); if (hw) { NC.how = hw.dataset.ncHow; return ncRenderCrew(); }
      const pr = e.target.closest('[data-nc-p]'); if (pr) { if (NC.cwd !== pr.dataset.ncP) { NC.cwd = pr.dataset.ncP; ncRecall(); ncRenderWho(); } ncRenderList(); return $('ncQ').focus(); }
      return undefined;
    }));
    d.addEventListener('dblclick', e => { if (e.target.closest('[data-nc-p]')) wrap(ncStart)(); });
    $('ncForm').addEventListener('submit', e => { e.preventDefault(); wrap(ncStart)(); });
    $('ncQ').addEventListener('input', () => { NC.q = $('ncQ').value; const was = NC.cwd; ncRenderList(); if (NC.cwd !== was) { ncRecall(); ncRenderWho(); } });
    $('ncQ').addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const list = ncShown(), i = list.findIndex(p => p.cwd === NC.cwd);
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { NC.cwd = next.cwd; ncRecall(); ncRenderWho(); ncRenderList(); }
    });
    $('ncAs').addEventListener('change', () => { NC.as = $('ncAs').value; });
  }
  const list = ncProjects();
  const here = cwd || (typeof paletteHere === 'function' ? paletteHere() : null);
  NC.cwd = (list.find(p => p.cwd === here) || list[0] || {}).cwd || null;
  NC.q = ''; $('ncQ').value = ''; $('ncText').value = text;
  ncRecall();
  ncRenderList(); ncRenderWho();
  $('ncDlg').showModal();
  $('ncQ').focus();
}
function ncShown() {
  const q = NC.q.trim().toLowerCase();
  return ncProjects().filter(p => !q || `${p.name} ${p.cwd}`.toLowerCase().includes(q));
}
function ncRenderList() {
  const list = ncShown();
  if (!list.some(p => p.cwd === NC.cwd)) NC.cwd = list[0] ? list[0].cwd : null;
  $('ncList').innerHTML = list.length ? list.map((p, i) => `<li class="nc-p" id="ncp-${i}" role="option" data-nc-p="${esc(p.cwd)}" aria-selected="${p.cwd === NC.cwd}" title="${esc(p.cwd)}">${crestHtml(p, 22)}<b>${esc(p.name)}</b>${S.projects.filter(x => x.name === p.name).length > 1 && parentName(p.cwd) ? `<span class="nc-in">in ${esc(parentName(p.cwd))}</span>` : ''}<small>${esc(agoL(projLast(p)))}</small></li>`).join('') : `<li class="nc-none">${NC.q.trim() ? 'No project has that in its name.' : 'No projects yet: make one with New project.'}</li>`;
  const sel = $('ncList').querySelector('[aria-selected="true"]');
  if (sel) { $('ncQ').setAttribute('aria-activedescendant', sel.id); sel.scrollIntoView({ block: 'nearest' }); } else $('ncQ').removeAttribute('aria-activedescendant');
  ncSync();
}
function ncRenderWho() {
  const who = ncWho();
  const pick = who.find(w => w.v === NC.prov && w.on) || who.find(w => w.on) || who[0];
  NC.prov = pick.v;
  $('ncSeg').innerHTML = who.map(w => `<button type="button" data-nc-who="${w.v}" aria-pressed="${w.v === NC.prov}" ${w.on ? '' : `disabled title="${esc(w.why)}"`}>${esc(w.name)}</button>`).join('');
  // Which account, when there's a choice.
  const opts = NC.prov === 'claude' ? S.accounts.map(a => ({ id: a.id, name: a.name, ok: canLaunch(a), label: `${a.name}${usageLine(a.id, { short: true }) ? ` · ${usageLine(a.id, { short: true })}` : ''}${a.signedIn ? '' : ' · not signed in'}` }))
    : NC.prov === 'codex' ? codexAccts().map(x => ({ id: x.id, name: x.name, ok: !!x.signedIn, label: `${x.name || 'Codex'}${usageLine(x.id, { short: true }) ? ` · ${usageLine(x.id, { short: true })}` : ''}${x.signedIn ? '' : ' · not signed in'}` })) : [];
  $('ncAsWrap').hidden = opts.length < 2;
  const room = ncRoom(opts);
  const had = NC.as === ':room' ? (room ? ':room' : null) : opts.some(o => o.id === NC.as && o.ok) ? NC.as : null;
  const was = had || (NC.prov === 'claude' ? (canLaunch(current()) ? S.acct : (opts.find(o => o.ok) || {}).id) : S.codex && S.codex.id);
  $('ncAs').innerHTML = `${room ? `<option value=":room" ${was === ':room' ? 'selected' : ''} title="Whichever has the most left when the chat starts">Most room: ${esc(room.name || 'Codex')} (${room.left}% left)</option>` : ''}${opts.map(o => `<option value="${esc(o.id)}" ${o.id === was ? 'selected' : ''} ${o.ok ? '' : 'disabled'}>${esc(o.label)}</option>`).join('')}`;
  ncRenderCrew();
  ncSync();
}
// Bring the others in from the start: they join with your first message, as Together does in a chat.
function ncRenderCrew() {
  const box = $('ncCrew'), others = ncWho().filter(w => w.v !== NC.prov && w.on);
  NC.with = NC.with.filter(k => others.some(w => w.v === k));
  box.hidden = !others.length;
  box.innerHTML = `<span class="nc-l">Together with</span><div class="nc-crew-row">${others.map(w => `<label class="nc-check"><input type="checkbox" data-nc-with="${w.v}" ${NC.with.includes(w.v) ? 'checked' : ''}>${esc(w.name)}</label>`).join('')}${NC.with.length ? `<div class="seg nc-how" role="group" aria-label="How they work"><button type="button" class="${NC.how === 'turns' ? 'on' : ''}" data-nc-how="turns" aria-pressed="${NC.how === 'turns'}">Take turns</button><button type="button" class="${NC.how === 'parallel' ? 'on' : ''}" data-nc-how="parallel" aria-pressed="${NC.how === 'parallel'}">At the same time</button></div>` : ''}</div>`;
  // At the same time, each needs its own part.
  const names = [NC.prov, ...NC.with].map(k => PROV_NAME[k]);
  $('ncText').placeholder = NC.with.length && NC.how === 'parallel' ? `Say who does what: “${names[0]}: the save code. ${names[1]}: the menu icons.”` : '';
}
function ncSync() { const who = ncWho().find(w => w.v === NC.prov); $('ncGo').disabled = !NC.cwd || !who || !who.on; }
async function ncStart() {
  if ($('ncGo').disabled) return;
  const cwd = NC.cwd, prov = NC.prov, chosen = $('ncAsWrap').hidden ? null : $('ncAs').value, initialText = $('ncText').value;
  // Most room: worked out now, whatever it was when the dialog opened.
  const room = chosen === ':room' ? ncRoom(prov === 'claude' ? S.accounts.map(a => ({ id: a.id, ok: canLaunch(a) })) : codexAccts().map(x => ({ id: x.id, ok: !!x.signedIn }))) : null;
  const as = chosen === ':room' ? (room && room.id) : chosen;
  store('nc-prov', prov);
  const crew = NC.with.slice(), how = NC.how;
  store(`nc:${cwd}`, JSON.stringify({ prov, as: chosen, with: crew, how }));
  $('ncDlg').close();
  if (prov === 'codex' && as && S.codex && as !== S.codex.id) await setCodexActive(as);
  const was = C.key;
  await ChatUI.open({ cwd, mode: 'new', ...(prov === 'claude' ? (as && as !== S.acct ? { accountId: as } : {}) : { provider: prov }), initialText });
  if (crew.length && ChatUI.isOpen() && C.key !== was) {
    C.group = { kinds: [prov, ...crew], how };
    store('together', JSON.stringify(C.group));
    setTarget('both', false);
  }
}

/* ---------- a copy of the app for someone else ---------- */
function shareCopy() {
  if (!$('shareDlg')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="shareDlg" aria-labelledby="shTitle"><form method="dialog" id="shForm">
      <h3 id="shTitle">Make a copy to share</h3>
      <p class="sh-p">A zip of Session Switcher for someone else. It has the app only: none of your accounts, sign-ins, chats, chat names, banners or projects go in it. They unzip it and double-click <b>Claude Switcher.vbs</b>, then sign in with their own accounts.</p>
      <label class="toggle"><input type="checkbox" id="shPrompts"><span><b>Include my prompts</b><span id="shCount"></span></span></label>
      <div class="d-row"><button type="button" class="btn" data-close-dlg>Cancel</button><button class="btn prime" value="ok" id="shGo">Make the copy</button></div>
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
    ...S.prompts.map(pr => { const r = promptRuns(pr); return { label: pr.title, hint: r.hint, disabled: !r.ok, why: r.why, run: () => startWithPrompt(cwd, pr) }; }),
    '-',
    { label: 'Edit prompts…', run: openPromptEditor },
  ]);
}
