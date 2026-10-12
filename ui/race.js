'use strict';
/* Race: Claude and Codex take the same task, each in its own copy of the project. The hub shows each
   race with what both have changed; keep the better one (its changes come into your project) or
   discard both. Split the work: each takes its own part instead, and you keep both at once. */

async function loadRaces() { S.races = (await api('/api/races')).races || []; renderRaces(); }

const RACERS = [['claude', 'Claude'], ['codex', 'Codex']];
const racerState = x => (x.state === 'busy' || x.state === 'starting' ? 'working' : x.state === 'waiting' ? 'needs your OK' : x.state === 'ended' ? 'stopped' : 'done');
function raceCard(r) {
  const head = `<p class="race-h"><span class="glyph" aria-hidden="true">${r.split ? '⑂' : '⚑'}</span><b>${r.split ? 'Split' : 'Race'}</b> in ${esc(r.folder || base(r.cwd))}<small>${esc(stamp(Date.parse(r.createdAt)))}</small></p>${r.split && r.prompt === `${r.split.claude} · ${r.split.codex}` ? '' : `<p class="race-p">${esc(r.prompt.split('\n')[0].slice(0, 200))}</p>`}`;
  if (r.state !== 'running') return `<li class="race over">${head}<p class="race-end">${r.state === 'kept' ? (r.kept === 'both' ? 'Kept both sets of changes.' : `Kept ${r.kept === 'codex' ? 'Codex' : 'Claude'}’s changes.`) : 'Discarded.'}</p></li>`;
  const col = ([who, name]) => {
    const x = r.racers[who] || {};
    const f = x.files;
    const add = f ? f.reduce((n, y) => n + (y.add || 0), 0) : 0, del = f ? f.reduce((n, y) => n + (y.del || 0), 0) : 0;
    return `<div class="racer ${who}"><p class="rc-h"><span class="crew-dot" aria-hidden="true"></span><b>${name}</b><span class="rc-st ${racerState(x).replace(/\W+/g, '-')}">${esc(racerState(x))}</span></p>
      ${r.split ? `<p class="rc-part" title="${esc(r.split[who])}">${esc(r.split[who].split('\n')[0].slice(0, 160))}</p>` : ''}
      <p class="rc-f">${f === null || f === undefined ? '…' : f.length ? `${f.length} file${f.length === 1 ? '' : 's'} changed <i class="d-add">+${add}</i> <i class="d-del">−${del}</i>` : 'No changes yet'}</p>
      <p class="rc-b">${x.key ? `<button class="btn quiet sm" data-act="race-open" data-key="${esc(x.key)}">Open chat</button>` : ''}${f && f.length ? `<button class="btn quiet sm" data-act="race-diff" data-id="${esc(r.id)}" data-who="${who}">See changes</button>` : ''}</p>
      <button class="btn${f && f.length && !r.split ? ' gilt' : ''} sm" data-act="race-keep" data-id="${esc(r.id)}" data-who="${who}" ${f && f.length ? '' : 'disabled'}>Keep ${name}’s</button></div>`;
  };
  return `<li class="race">${head}<div class="race-cols">${RACERS.map(col).join('')}</div><p class="race-b"><button class="btn quiet sm" data-act="race-discard" data-id="${esc(r.id)}">Discard both</button>${r.split ? `<button class="btn gilt sm" data-act="race-both" data-id="${esc(r.id)}" ${RACERS.some(([w]) => (r.racers[w] || {}).files && r.racers[w].files.length) ? '' : 'disabled'}>Keep both</button>` : ''}</p></li>`;
}
function renderRaces() {
  const sec = $('secRaces'), list = $('raceList');
  if (!sec || !list) return;
  const races = S.races || [];
  sec.hidden = !races.length;
  list.innerHTML = races.map(raceCard).join('');
}

function raceDialog() {
  let d = $('raceDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="raceDlg" class="wide task-dlg" aria-labelledby="rcTitle"><form method="dialog" id="rcForm">
    <div class="setup-head"><h3 id="rcTitle">Race Claude and Codex</h3><button type="button" class="icon" data-rc="close" aria-label="Close">✕</button></div>
    <div class="tk-body">
      <div class="rc-mode seg" role="radiogroup" aria-label="How they work"><label><input type="radio" name="rcMode" value="race" checked> Race: the same task</label><label><input type="radio" name="rcMode" value="split"> Split the work</label></div>
      <p class="rd-intro">Both take the same task, each in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Your project isn’t touched until you keep one. Needs a git project.</p>
      <div class="tk-grid"><label>Project<select id="rcProject"></select></label><label>Claude’s account<select id="rcAcct"></select></label></div>
      <label class="tk-prompt">The task<select id="rcFrom"><option value="">Start from a saved prompt…</option></select><textarea id="rcText" rows="7" placeholder="Fix the save-file bug on Steam Deck, and add a test that shows it’s fixed."></textarea></label>
      <div class="rc-parts" hidden><label class="tk-prompt">Claude’s part<textarea id="rcClaude" rows="3" placeholder="The save code: find why it fails on Steam Deck and fix it."></textarea></label><label class="tk-prompt">Codex’s part<textarea id="rcCodex" rows="3" placeholder="A test that shows the bug, in tests/save.test.js."></textarea></label></div>
      <div class="d-row"><span class="spacer"></span><button type="button" class="btn" data-rc="close">Cancel</button><button type="submit" class="btn prime">Start the race</button></div>
    </div></form></dialog>`);
  d = $('raceDlg');
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-rc="close"]')) d.close(); });
  d.addEventListener('change', e => {
    if (e.target.name === 'rcMode') return raceMode(e.target.value);
    if (e.target.id !== 'rcFrom' || !e.target.value) return;
    const pr = S.prompts.find(x => x.id === e.target.value), p = S.projects.find(x => x.cwd === $('rcProject').value);
    if (pr) $('rcText').value = fillPrompt(pr.text, p ? p.name : '');
    e.target.value = '';
  });
  $('rcForm').addEventListener('submit', wrap(async e => {
    e.preventDefault();
    const split = d.querySelector('[name="rcMode"]:checked').value === 'split';
    if (split && (!$('rcClaude').value.trim() || !$('rcCodex').value.trim())) { toast('Write each one’s part.'); return; }
    const go = d.querySelector('[type="submit"]'), label = go.textContent; go.disabled = true; go.textContent = 'Making the copies…';
    try {
      const r = await api('/api/race', { action: 'start', cwd: $('rcProject').value, accountId: $('rcAcct').value, prompt: $('rcText').value, ...(split ? { split: { claude: $('rcClaude').value, codex: $('rcCodex').value } } : {}) });
      S.races = r.races; renderRaces(); d.close();
      toast(split ? 'They’re on it, each on its own part. Both are under At work; keep both on the card when they’re done.' : 'The race is on. Both are under At work; compare them on the race’s card.', 6000);
    } finally { go.disabled = false; go.textContent = label; }
  }));
  return d;
}
// Race (the same task for both) or Split (each its own part; the task is then optional background).
function raceMode(m) {
  const split = m === 'split';
  const d = raceDialog();
  d.querySelector(`[name="rcMode"][value="${split ? 'split' : 'race'}"]`).checked = true;
  d.querySelector('.rc-parts').hidden = !split;
  $('rcTitle').textContent = split ? 'Split the work' : 'Race Claude and Codex';
  d.querySelector('.rd-intro').firstChild.textContent = split ? 'Each takes its own part, in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Keep both and the two parts come into your project together; if they touched the same file, nothing changes and it says which. Needs a git project.' : 'Both take the same task, each in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Your project isn’t touched until you keep one. Needs a git project.';
  $('rcText').placeholder = split ? 'Optional: the whole task, so each knows what it’s part of.' : 'Fix the save-file bug on Steam Deck, and add a test that shows it’s fixed.';
  d.querySelector('[type="submit"]').textContent = split ? 'Start both parts' : 'Start the race';
}
function openRaceDialog(cwd = null, mode = 'race') {
  if (!codexReady()) { toast('A race needs Codex too: sign in to it first, under Accounts and usage.'); return; }
  const d = raceDialog();
  const projects = S.projects.filter(p => p.exists).slice().sort((a, b) => a.name.localeCompare(b.name));
  const pick = cwd || (S.view === 'folder' ? S.folder : null) || (projects[0] && projects[0].cwd);
  $('rcProject').innerHTML = projects.map(p => `<option value="${esc(p.cwd)}"${p.cwd === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('rcAcct').innerHTML = `<option value="auto">Whichever has the most room</option>${S.accounts.filter(canLaunch).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}`;
  $('rcFrom').innerHTML = `<option value="">Start from a saved prompt…</option>${S.prompts.map(pr => `<option value="${esc(pr.id)}">${esc(pr.title)}</option>`).join('')}`;
  $('rcFrom').hidden = !S.prompts.length;
  $('rcText').value = ''; $('rcClaude').value = ''; $('rcCodex').value = '';
  raceMode(mode);
  d.showModal(); (mode === 'split' ? $('rcClaude') : $('rcText')).focus();
}

async function raceAction(act, b) {
  if (act === 'race-new') return openRaceDialog(b.dataset.cwd || null);
  if (act === 'split-new') return openRaceDialog(b.dataset.cwd || null, 'split');
  if (act === 'race-open') return ChatUI.openKey(b.dataset.key);
  const r = (S.races || []).find(x => x.id === b.dataset.id); if (!r) return undefined;
  const name = b.dataset.who === 'codex' ? 'Codex' : 'Claude';
  if (act === 'race-diff') return viewRaceChanges(r, b.dataset.who);
  if (act === 'race-discard') {
    if (!(await appConfirm('Discard both?\n\nBoth chats stop and both copies are deleted. Your project stays as it is.', { ok: 'Discard both', danger: true }))) return undefined;
    S.races = (await api('/api/race', { action: 'discard', id: r.id })).races; renderRaces();
    return toast('Discarded.', 2500);
  }
  if (act === 'race-both') {
    const n = RACERS.reduce((k, [w]) => k + ((r.racers[w] || {}).files || []).length, 0);
    if (!(await appConfirm(`Keep both?\n\nBoth parts (${n} changed file${n === 1 ? '' : 's'}) come into ${r.folder || 'your project'} together; both chats stop and both copies are deleted.`, { ok: 'Keep both' }))) return undefined;
    let res = await api('/api/race', { action: 'keepboth', id: r.id });
    if (!res.kept && res.why === 'changed' && await appConfirm(`${r.folder || 'Your project'} changed since they began.\n\nTry to bring both parts in anyway? If anything clashes, nothing is changed.`, { ok: 'Try anyway' })) {
      res = await api('/api/race', { action: 'keepboth', id: r.id, force: true });
    }
    S.races = res.races; renderRaces();
    if (res.kept) toast(`Kept both parts (${res.files.length} file${res.files.length === 1 ? '' : 's'}).`, 5000);
    else if (res.why === 'overlap') toast(`Both changed ${res.clash.length === 1 ? res.clash[0] : `the same ${res.clash.length} files (${res.clash.slice(0, 3).join(', ')}${res.clash.length > 3 ? '…' : ''})`}, so nothing was changed. See each one’s changes and keep one, or ask one to bring in the other’s.`, 12000);
    else if (res.why === 'conflict') toast(`The two parts clash with what changed in your project, so nothing was changed.${res.detail ? `\n${res.detail}` : ''}`, 12000);
    return undefined;
  }
  if (act === 'race-keep') {
    const n = (r.racers[b.dataset.who].files || []).length;
    if (!(await appConfirm(`Keep ${name}’s changes?\n\nIts ${n} changed file${n === 1 ? '' : 's'} come into ${r.folder || 'your project'}; both chats stop and both copies are deleted.`, { ok: `Keep ${name}’s` }))) return undefined;
    let res = await api('/api/race', { action: 'keep', id: r.id, who: b.dataset.who });
    if (!res.kept && res.why === 'changed' && await appConfirm(`${r.folder || 'Your project'} changed since the race began.\n\nTry to bring ${name}’s changes in anyway? If anything clashes, nothing is changed.`, { ok: 'Try anyway' })) {
      res = await api('/api/race', { action: 'keep', id: r.id, who: b.dataset.who, force: true });
    }
    S.races = res.races; renderRaces();
    if (res.kept) toast(`Kept ${name}’s changes (${res.files.length} file${res.files.length === 1 ? '' : 's'}).`, 5000);
    else if (res.why === 'conflict') toast(`${name}’s changes clash with what changed in your project, so nothing was changed.${res.detail ? `\n${res.detail}` : ''}`, 12000);
  }
  return undefined;
}
// A racer's changes, file by file (the same view as a reply's changes).
async function viewRaceChanges(r, who) {
  const files = (r.racers[who] && r.racers[who].files) || [];
  const fake = { _ev: { files, turn: null }, dataset: { src: 'main' } };
  await viewChanges(fake, `/api/race/diff?id=${encodeURIComponent(r.id)}&who=${who}`, `What ${who === 'codex' ? 'Codex' : 'Claude'} changed in its copy`);
}

// While a race runs, its card follows what each one has changed (on the hub, while it's on screen).
setInterval(() => { if ((S.races || []).some(r => r.state === 'running') && S.view === 'hub' && !document.hidden && !ChatUI.isOpen()) loadRaces().catch(() => {}); }, 8000);
