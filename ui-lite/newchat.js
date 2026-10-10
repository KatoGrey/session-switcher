'use strict';
/* New chat from Lite: pick the project, the assistant and how much it may do on its own, write the
   first message. It runs on the use-next plan of that family, starts in your permission default
   (lite.json "permissions", else the full app's setting), then opens in the full app's chat window. */

const PERM_LABELS = {
  default: 'Ask before edits', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto', bypassPermissions: 'Bypass permissions',
  ask: 'Ask before acting', agent: 'Agent', 'read-only': 'Read only', full: 'Full access',
};
const permFam = who => (who === 'claude' ? 'claude' : 'codex');
const permDefault = who => { const f = permFam(who); return (S.lite.permissions && S.lite.permissions[f]) || (S.appPermissions && S.appPermissions[f]) || (f === 'claude' ? 'default' : 'agent'); };
// Which plan a new chat runs on: the use-next one of its family, or Ollama.
function accountFor(who) {
  if (who === 'ollama') { const o = plans().find(p => p.family === 'ollama' && !p.broken); return o ? o.id : null; }
  const p = useNext(who === 'claude' ? 'claude' : 'chatgpt');
  return p ? p.id : null;
}

function newChat(projectKey) {
  const ps = S.projects.filter(p => p.cwd && p.exists && !p.archived && !p.loose).sort((a, b) => (b.bucket ? 1 : 0) - (a.bucket ? 1 : 0) || b.updated - a.updated);
  const want = projectKey || (S.view === 'project' ? S.project : null);
  const cwdOf = k => (projBy.get(k) || {}).cwd;
  const pick = ps.find(p => p.key === want) || ps[0];
  const root = $('modalRoot');
  const permOpts = who => (S.permissionModes ? S.permissionModes[permFam(who)] : []).map(m => `<option value="${esc(m)}" ${m === permDefault(who) ? 'selected' : ''}>${esc(PERM_LABELS[m] || m)}${m === permDefault(who) ? ' (your default)' : ''}</option>`).join('');
  const planNote = who => { const id = accountFor(who); const p = id && planById(id); return p ? `Runs on ${esc(p.label)} ${esc(famName(p.family) || '')}${typeof p.left === 'number' ? `, ${p.left}% left` : ''}.` : 'No plan has room above your floor; it runs on the full app’s active account.'; };
  root.innerHTML = `<div class="modal-back"><form class="modal" id="ncForm" style="max-width:560px"><h3>${L('New chat')}</h3>
    <label class="nc-row"><span>Project</span><select name="project">${ps.map(p => `<option value="${esc(p.key)}" ${p === pick ? 'selected' : ''}>${esc(p.name)}${p.bucket ? ` · ${esc(bucketName(p.bucket))}` : ''}</option>`).join('')}</select></label>
    <label class="nc-row"><span>Assistant</span><select name="who"><option value="claude">Claude</option><option value="codex">Codex (ChatGPT)</option>${plans().some(p => p.family === 'ollama' && !p.broken) ? '<option value="ollama">Codex on Ollama</option>' : ''}</select></label>
    <label class="nc-row"><span>Permissions</span><select name="perm">${permOpts('claude')}</select></label>
    <label class="nc-check"><input type="checkbox" name="keep"> Make this my default for new ${'<span id="ncFam">Claude</span>'} chats</label>
    <textarea name="text" rows="5" placeholder="What should it do?" aria-label="First message"></textarea>
    <small class="nc-note" id="ncNote">${planNote('claude')}</small>
    <div class="acts"><button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Start</button></div></form></div>`;
  const form = root.querySelector('#ncForm');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-m="no"]').onclick = close;
  root.querySelector('.modal-back').addEventListener('click', e => { if (e.target.classList.contains('modal-back')) close(); });
  form.who.onchange = () => { form.perm.innerHTML = permOpts(form.who.value); $('ncFam').textContent = form.who.value === 'claude' ? 'Claude' : 'Codex'; $('ncNote').textContent = planNote(form.who.value).replace(/&[^;]+;/g, ''); };
  form.text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  form.onsubmit = wrap(async e => {
    e.preventDefault();
    const who = form.who.value, perm = form.perm.value, text = form.text.value.trim();
    const cwd = cwdOf(form.project.value);
    if (!text) { form.text.focus(); return; }
    const btn = form.querySelector('.btn.prime'); btn.disabled = true; btn.textContent = 'Starting…';
    try {
      if (form.keep.checked) await setLook({ permissions: { [permFam(who)]: perm } });
      const account = accountFor(who);
      const info = await api('/api/chat/open', { mode: 'new', cwd, provider: who === 'claude' ? 'claude' : 'codex', ...(account ? { account } : {}), permissionMode: perm });
      const id = await startAndSend(info.key, text);
      close();
      if (id) openChat(id); else toast('Started. It shows in the list once it has replied.');
      loadState().then(render).catch(() => {});
    } catch (err) { btn.disabled = false; btn.textContent = 'Start'; throw err; }
  });
  form.text.focus();
}

// Waits for a new chat to be ready, sends its first message, and returns its id once it has one.
function startAndSend(key, text) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
    let state = 'starting', id = null, sent = false;
    const finish = (err, v) => { clearTimeout(timer); es.close(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(null, id), 60e3);
    const maybeSend = () => {
      if (sent || state === 'starting') return;
      if (state === 'ended') return finish(new Error('The chat stopped as it started. Open the full app to see why.'));
      sent = true;
      api('/api/chat/send', { key, text }).catch(err => finish(err));
      if (id) finish(null, id);
    };
    es.addEventListener('hello', e => { try { const i = JSON.parse(e.data); state = i.state; id = i.sessionId || id; } catch { /* fine */ } maybeSend(); });
    es.addEventListener('chat', e => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.kind === 'state') state = ev.state;
      if (ev.kind === 'init' && ev.sessionId) id = ev.sessionId;
      maybeSend();
      if (sent && id) finish(null, id);
    });
  });
}
