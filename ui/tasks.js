'use strict';
/* Queued tasks: a prompt for a project, for Claude or Codex, that starts as a new chat when its time
   comes and an account has room (the server starts them). The hub lists them under "Queued". */

async function loadTasks() { S.tasks = (await api('/api/tasks')).tasks || []; renderQueue(); }

const taskWaiting = t => (t.why === 'time' ? `Starts ${new Date(t.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
  : t.why === 'room' ? 'Waiting for an account with room' : t.why === 'account' ? 'Waiting for a signed-in account' : 'Starting…');
function taskRow(t) {
  const first = t.prompt.split('\n').find(l => l.trim()) || t.prompt;
  const who = t.provider === 'codex' ? 'Codex' : t.accountName || (t.accountId === 'auto' ? 'Claude, whichever account has room' : `Claude as ${(S.accounts.find(a => a.id === t.accountId) || {}).name || t.accountId}`);
  const st = t.state === 'started' ? '<span class="tk-st ok">▶ Started</span>' : t.state === 'failed' ? `<span class="tk-st err" title="${esc(t.error || '')}">✕ Couldn’t start: ${esc(t.error || 'unknown error')}</span>` : `<span class="tk-st">${esc(taskWaiting(t))}</span>`;
  const btns = t.state === 'queued'
    ? `<button class="btn sm" data-act="task-start" data-id="${esc(t.id)}">Start now</button><button class="icon" data-act="task-remove" data-id="${esc(t.id)}" aria-label="Remove from the queue" title="Remove">✕</button>`
    : t.state === 'started' && t.key ? `<button class="btn sm" data-act="task-open" data-key="${esc(t.key)}">Open it</button><button class="icon" data-act="task-remove" data-id="${esc(t.id)}" aria-label="Clear" title="Clear">✕</button>`
      : `<button class="icon" data-act="task-remove" data-id="${esc(t.id)}" aria-label="Remove" title="Remove">✕</button>`;
  return `<li class="task ${t.state}" data-task="${esc(t.id)}"><div class="tk-in"><b class="tk-p">${esc(first.slice(0, 160))}</b><small>${esc(t.folder)} · ${esc(who)}</small>${st}</div><div class="tk-b">${btns}</div></li>`;
}
function renderQueue() {
  const sec = $('secQueue'), list = $('queueList');
  if (!sec || !list) return;
  const tasks = S.tasks || [];
  sec.hidden = !tasks.length;
  list.innerHTML = tasks.map(taskRow).join('');
}

/* ---------- the "Queue a task" dialog ---------- */
function taskDialog() {
  let d = $('taskDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="taskDlg" class="wide task-dlg" aria-labelledby="tkTitle"><form method="dialog" id="tkForm">
    <div class="setup-head"><h3 id="tkTitle">Queue a task</h3><button type="button" class="icon" data-tk="close" aria-label="Close">✕</button></div>
    <div class="tk-body">
      <p class="rd-intro">It starts as a new chat when its time comes and an account has room, so you can line work up for when a limit resets, or for later.</p>
      <div class="tk-grid">
        <label>Project<select id="tkProject"></select></label>
        <label>Who<select id="tkWho"></select></label>
        <label id="tkAcctWrap">Account<select id="tkAcct"></select></label>
        <label>When<select id="tkWhen"><option value="now">As soon as there’s room</option><option value="at">Not before…</option></select></label>
        <label id="tkAtWrap" hidden>Time<input type="datetime-local" id="tkAt"></label>
      </div>
      <label class="tk-prompt">What should it do?<select id="tkFrom"><option value="">Start from a saved prompt…</option></select><textarea id="tkText" rows="7" placeholder="Write the README for this project: how to install it, run it and test it."></textarea></label>
      <div class="d-row"><span class="spacer"></span><button type="button" class="btn" data-tk="close">Cancel</button><button type="submit" class="btn prime" id="tkGo">Queue it</button></div>
    </div></form></dialog>`);
  d = $('taskDlg');
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-tk="close"]')) d.close(); });
  d.addEventListener('change', e => {
    if (e.target.id === 'tkWho') $('tkAcctWrap').hidden = e.target.value === 'codex';
    if (e.target.id === 'tkWhen') $('tkAtWrap').hidden = e.target.value !== 'at';
    if (e.target.id === 'tkFrom' && e.target.value) {
      const pr = S.prompts.find(x => x.id === e.target.value);
      const p = S.projects.find(x => x.cwd === $('tkProject').value);
      if (pr) { $('tkText').value = fillPrompt(pr.text, p ? p.name : ''); if (pr.provider === 'codex' && codexReady()) { $('tkWho').value = 'codex'; $('tkAcctWrap').hidden = true; } }
      e.target.value = '';
    }
  });
  $('tkForm').addEventListener('submit', wrap(async e => {
    e.preventDefault();
    const when = $('tkWhen').value;
    const task = { cwd: $('tkProject').value, provider: $('tkWho').value, accountId: $('tkAcct').value, prompt: $('tkText').value, when, at: when === 'at' && $('tkAt').value ? new Date($('tkAt').value).toISOString() : null };
    const r = await api('/api/tasks', { action: 'add', task });
    S.tasks = r.tasks; renderQueue();
    d.close();
    toast(r.task.when === 'at' ? `Queued. It starts ${new Date(r.task.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}, once an account has room.` : 'Queued. It starts as soon as an account has room.', 5000);
  }));
  return d;
}
function openTaskDialog(cwd = null) {
  const d = taskDialog();
  const projects = S.projects.filter(p => p.exists).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!projects.length) { toast('Add a project first.'); return; }
  const pick = cwd || (S.view === 'folder' ? S.folder : null) || (projects[0] && projects[0].cwd);
  $('tkProject').innerHTML = projects.map(p => `<option value="${esc(p.cwd)}"${p.cwd === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('tkWho').innerHTML = `<option value="claude">Claude</option>${S.codex && S.codex.enabled ? `<option value="codex"${codexReady() ? '' : ' disabled'}>Codex</option>` : ''}`;
  $('tkAcct').innerHTML = `<option value="auto">Whichever has the most room</option>${S.accounts.filter(canLaunch).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}`;
  $('tkFrom').innerHTML = `<option value="">Start from a saved prompt…</option>${S.prompts.map(pr => `<option value="${esc(pr.id)}">${esc(pr.title)}</option>`).join('')}`;
  $('tkFrom').hidden = !S.prompts.length;
  $('tkWhen').value = 'now'; $('tkAtWrap').hidden = true; $('tkAcctWrap').hidden = false; $('tkText').value = '';
  const soon = new Date(Date.now() + 3600e3); soon.setMinutes(0, 0, 0);
  $('tkAt').value = new Date(soon - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  d.showModal();
  $('tkText').focus();
}
async function taskAction(act, b) {
  if (act === 'task-new') return openTaskDialog(b.dataset.cwd || null);
  if (act === 'task-open') return ChatUI.openKey ? ChatUI.openKey(b.dataset.key) : undefined;
  const r = await api('/api/tasks', { action: act === 'task-start' ? 'start' : 'remove', id: b.dataset.id });
  S.tasks = r.tasks; renderQueue();
  if (act === 'task-start') toast('Started. It’s under At work.', 3000);
  return undefined;
}
