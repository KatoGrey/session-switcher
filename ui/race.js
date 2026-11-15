'use strict';
/* Race: two of Claude, Codex and Gemini take the same task, each in its own copy of the project. The hub shows each
   race with what both have changed; keep the better one (its changes come into your project) or
   discard both. Split the work: each takes its own part instead, and you keep both at once. */

async function loadRaces() { S.races = (await api('/api/races')).races || []; renderRaces(); }

// Who races in this one (Claude and Codex in races from before there was a choice).
const RACE_NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const racersOf = r => (r.who && r.who.length ? r.who : Object.keys(r.racers || {}).length ? Object.keys(r.racers) : ['claude', 'codex']).map(w => [w, RACE_NAME[w] || w]);
// Both have changed something (so there's something to compare, or to pick from).
const both = r => racersOf(r).every(([w]) => ((r.racers[w] || {}).files || []).length);
const racerState = x => (x.state === 'busy' || x.state === 'starting' ? 'working' : x.state === 'waiting' ? 'needs your OK' : x.state === 'ended' ? (x.sessionId ? 'paused' : 'stopped') : 'done');
function raceCard(r) {
  const head = `<p class="race-h"><span class="glyph" aria-hidden="true">${r.split ? '⑂' : '⚑'}</span><b>${r.split ? 'Split' : 'Race'}</b> in ${esc(r.folder || base(r.cwd))}<small>${esc(stamp(Date.parse(r.createdAt)))}</small></p>${r.split && r.prompt === racersOf(r).map(([w]) => r.split[w]).join(' · ') ? '' : `<p class="race-p">${esc(r.prompt.split('\n')[0].slice(0, 200))}</p>`}`;
  if (r.state !== 'running') return `<li class="race over" data-race="${esc(r.id)}" tabindex="-1">${head}<p class="race-end">${r.state === 'kept' ? (r.kept === 'both' ? 'Kept both sets of changes.' : r.kept === 'files' ? 'Kept the files you picked from each.' : `Kept ${RACE_NAME[r.kept] || 'its'}’s changes.`) : 'Discarded.'}</p></li>`;
  const col = ([who, name]) => {
    const x = r.racers[who] || {};
    const f = x.files;
    const add = f ? f.reduce((n, y) => n + (y.add || 0), 0) : 0, del = f ? f.reduce((n, y) => n + (y.del || 0), 0) : 0;
    return `<div class="racer ${who}"><p class="rc-h"><span class="crew-dot" aria-hidden="true"></span><b>${name}</b><span class="rc-st ${racerState(x).replace(/\W+/g, '-')}">${esc(racerState(x))}</span></p>
      ${r.split ? `<p class="rc-part" title="${esc(r.split[who])}">${esc(r.split[who].split('\n')[0].slice(0, 160))}</p>` : ''}
      <p class="rc-f">${f === null || f === undefined ? '…' : f.length ? `${f.length} file${f.length === 1 ? '' : 's'} changed <i class="d-add">+${add}</i> <i class="d-del">−${del}</i>` : 'No changes yet'}</p>
      <p class="rc-b">${x.key ? `<button class="btn quiet sm" data-act="race-open" data-key="${esc(x.key)}">Open chat</button>` : x.sessionId ? `<button class="btn quiet sm" data-act="race-open" data-sid="${esc(x.sessionId)}" data-who="${who}" title="Starts it again where it left off">Open chat</button>` : ''}${f && f.length ? `<button class="btn quiet sm" data-act="race-diff" data-id="${esc(r.id)}" data-who="${who}">See changes</button>` : ''}</p>
      <button class="btn${f && f.length && !r.split ? ' gilt' : ''} sm" data-act="race-keep" data-id="${esc(r.id)}" data-who="${who}" ${f && f.length ? '' : 'disabled'}>Keep ${name}’s</button></div>`;
  };
  return `<li class="race${flashing(r) ? ' race-flash' : ''}" data-race="${esc(r.id)}" tabindex="-1">${head}<div class="race-cols">${racersOf(r).map(col).join('')}</div>${r.judge ? `<p class="race-j"><span class="glyph" aria-hidden="true">⚖</span><b>Judge</b> ${esc(racerState(r.judge))}${r.judge.key ? ` <button class="btn quiet sm" data-act="race-open" data-key="${esc(r.judge.key)}">Read its verdict</button>` : r.judge.sessionId ? ` <button class="btn quiet sm" data-act="race-open" data-sid="${esc(r.judge.sessionId)}" data-who="${esc(r.judge.provider || 'claude')}">Read its verdict</button>` : ''}</p>` : ''}<p class="race-b">${both(r) ? `${r.judge ? '' : `<button class="btn quiet sm" data-act="race-judge" data-id="${esc(r.id)}" title="A chat that can only look compares both and says which to keep">Ask a judge</button>`}<button class="btn quiet sm" data-act="race-files" data-id="${esc(r.id)}">Pick files…</button>` : ''}<button class="btn quiet sm" data-act="race-discard" data-id="${esc(r.id)}">Discard both</button>${r.split ? `<button class="btn gilt sm" data-act="race-both" data-id="${esc(r.id)}" ${racersOf(r).some(([w]) => (r.racers[w] || {}).files && r.racers[w].files.length) ? '' : 'disabled'}>Keep both</button>` : ''}</p></li>`;
}
function renderRaces() {
  const sec = $('secRaces'), list = $('raceList');
  if (!sec || !list) return;
  const races = S.races || [];
  sec.hidden = !races.length;
  // Drawn again only when something changed, and the keyboard stays where it was: on a card, or on its button.
  const h = races.map(raceCard).join('');
  if (list._h !== h) {
    const a = list.contains(document.activeElement) ? document.activeElement : null, card = a && a.closest('[data-race]');
    const at = card && `[data-race="${CSS.escape(card.dataset.race)}"]${a === card ? '' : ` [data-act="${CSS.escape(a.dataset.act || '')}"]${a.dataset.who ? `[data-who="${CSS.escape(a.dataset.who)}"]` : ''}`}`;
    list.innerHTML = h; list._h = h;
    if (at) list.querySelector(at)?.focus({ preventScroll: true });
  }
  setSecCount('races', races.length); renderJump();
}
// The card of a race you've just started lights up for a moment, so you can see which it is.
const RaceFlash = { id: null, until: 0, timer: 0 };
const flashing = r => RaceFlash.id === r.id && Date.now() < RaceFlash.until;
// Takes you to a race's card on the hub: brought into view, lit up for a moment, and the keyboard on it.
async function showRace(id) {
  if (S.view !== 'hub' || (window.ChatUI && ChatUI.isOpen())) await go('hub');
  const card = () => document.querySelector(`#raceList [data-race="${CSS.escape(id)}"]`);
  for (let i = 0; i < 40 && !card(); i++) await new Promise(r => setTimeout(r, 50));   // (the hub may still be drawing)
  if (!card()) return;
  if ($('secRaces').classList.contains('folded')) toggleSec('races', true);
  clearTimeout(RaceFlash.timer);
  Object.assign(RaceFlash, { id, until: Date.now() + 2400 });
  renderRaces();
  RaceFlash.timer = setTimeout(renderRaces, 2500);
  card().scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto', block: 'center' });
  card().focus({ preventScroll: true });
}
// A race needs two assistants: when there aren't, where to set up the next one (the first that isn't ready).
function raceSetup() {
  const claude = S.accounts.some(canLaunch), ready = [claude, codexReady(), geminiReady()].filter(Boolean).length;
  const say = `A race needs two assistants, and ${ready ? 'only one is' : 'none is'} ready yet.`;
  if (!claude) return { say: `${say} Sign in to Claude${ready ? '' : ', then set up Codex or Gemini too'}.`, label: 'Sign in to Claude', run: () => openSetupAt('st-health') };
  const say2 = `${say} Set up Codex or Gemini beside Claude.`;
  // Gemini first only when it's turned on and Codex isn't; Codex turned on but not signed in signs in with the
  // checks at the top of Setup.
  if (S.gemini && S.gemini.enabled && !(S.codex && S.codex.enabled)) return { say: say2, label: 'Set up Gemini', run: () => openSetupAt('st-gemini') };
  return { say: say2, label: 'Set up Codex', run: () => openSetupAt(S.codex && S.codex.enabled ? 'st-health' : 'st-codex') };
}

function raceDialog() {
  let d = $('raceDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="raceDlg" class="wide task-dlg" aria-labelledby="rcTitle"><form method="dialog" id="rcForm">
    <div class="setup-head"><h3 id="rcTitle">Race</h3><button type="button" class="icon" data-rc="close" aria-label="Close">✕</button></div>
    <div class="tk-body">
      <div class="rc-mode seg" role="radiogroup" aria-label="How they work"><label><input type="radio" name="rcMode" value="race" checked> Race: the same task</label><label><input type="radio" name="rcMode" value="split"> Split the work</label></div>
      <p class="rd-intro">Both take the same task, each in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Your project isn’t touched until you keep one. Needs a git project.</p>
      <div class="tk-grid"><label>Project<select id="rcProject"></select></label><label>Who<select id="rcWho"></select></label><label id="rcAcctWrap">Claude’s account<select id="rcAcct"></select></label></div>
      <div class="tk-grid rc-run" id="rcRun"></div>
      <p class="tk-note" id="rcNote" role="alert" hidden></p>
      <label class="tk-prompt">The task<select id="rcFrom" aria-label="Start from a saved prompt"><option value="">Start from a saved prompt…</option></select><textarea id="rcText" rows="7" aria-label="The task" placeholder="Fix the save-file bug on Steam Deck, and add a test that shows it’s fixed."></textarea></label>
      <div class="rc-parts" hidden><label class="tk-prompt"><span id="rcPartA">Claude’s part</span><textarea id="rcClaude" rows="3" placeholder="The save code: find why it fails on Steam Deck and fix it."></textarea></label><label class="tk-prompt"><span id="rcPartB">Codex’s part</span><textarea id="rcCodex" rows="3" placeholder="A test that shows the bug, in tests/save.test.js."></textarea></label></div>
      <div class="d-row"><span class="spacer"></span><button type="button" class="btn" data-rc="close">Cancel</button><button type="submit" class="btn prime">Start the race</button></div>
    </div></form></dialog>`);
  d = $('raceDlg');
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-rc="close"]')) d.close(); });
  d.addEventListener('change', e => {
    if (e.target.name === 'rcMode') return raceMode(e.target.value);
    if (e.target.id === 'rcWho') return raceWho();
    const side = e.target.closest('[data-side]');
    if (side && e.target.dataset.rcRun) {
      const st = RaceRun[side.dataset.side];
      st[e.target.dataset.rcRun] = e.target.value;
      // A new model has its own efforts: back to its usual one.
      if (e.target.dataset.rcRun === 'model') { st.effort = ''; raceRunDraw(); }
      return undefined;
    }
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
      const who = $('rcWho').value.split('+');
      const run = await raceRuns(who);
      if (!run) return;
      const r = await api('/api/race', { action: 'start', who, cwd: $('rcProject').value, accountId: $('rcAcct').value, prompt: $('rcText').value, run, ...(split ? { split: { [who[0]]: $('rcClaude').value, [who[1]]: $('rcCodex').value } } : {}) });
      S.races = r.races; renderRaces(); d.close();
      // On the hub its card is brought into view; anywhere else, the toast offers to take you there.
      const here = S.view === 'hub' && !(window.ChatUI && ChatUI.isOpen()) && !!$('raceList');
      const card = here ? 'this card' : 'its card on the hub';
      toast(split ? `They’re on it, each on its own part, both under At work. Keep both on ${card} when they’re done.` : `The race is on, both under At work. Compare them on ${card}.`, 7000, here || !r.id ? null : { label: 'Show it', run: () => showRace(r.id) });
      if (here && r.id) showRace(r.id);
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
  raceWho();
  d.querySelector('.rd-intro').firstChild.textContent = split ? 'Each takes its own part, in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Keep both and the two parts come into your project together; if they touched the same file, nothing changes and it says which. Needs a git project.' : 'Both take the same task, each in its own copy of the project (your uncommitted work included; ignored files like node_modules aren’t copied). Your project isn’t touched until you keep one. Needs a git project.';
  $('rcText').placeholder = split ? 'Optional: the whole task, so each knows what it’s part of.' : 'Fix the save-file bug on Steam Deck, and add a test that shows it’s fixed.';
  d.querySelector('[type="submit"]').textContent = split ? 'Start both parts' : 'Start the race';
}
// The pairs that can race now: any two of the assistants that are set up.
function racePairs() {
  const ok = { claude: S.accounts.some(canLaunch), codex: codexReady(), gemini: geminiReady() };
  return [['claude', 'codex'], ['claude', 'gemini'], ['codex', 'gemini']].filter(([a, b]) => ok[a] && ok[b]);
}
function raceWho() {
  const d = raceDialog(), split = d.querySelector('[name="rcMode"]:checked').value === 'split';
  const [a, b] = ($('rcWho').value || 'claude+codex').split('+');
  $('rcTitle').textContent = split ? `Split the work: ${RACE_NAME[a]} and ${RACE_NAME[b]}` : `Race ${RACE_NAME[a]} and ${RACE_NAME[b]}`;
  $('rcPartA').textContent = `${RACE_NAME[a]}’s part`; $('rcPartB').textContent = `${RACE_NAME[b]}’s part`;
  $('rcAcctWrap').hidden = ![a, b].includes('claude');
  raceRunDraw();
}
// Claude's account: the shared picker's choices and words (ui/pickwho.js). "Most room" goes to the server as "auto",
// so it's worked out as the race starts; it's what's picked when it's offered.
function raceAccounts() {
  const opts = Who.options({ providers: ['claude'] }), val = o => (o.account === 'room' ? 'auto' : o.account);
  const pick = opts.find(o => o.account === 'room') || opts.find(o => o.ok && o.account === S.acct) || opts.find(o => o.ok) || {};
  $('rcAcct').innerHTML = opts.map(o => `<option value="${esc(val(o))}"${o === pick ? ' selected' : ''}${o.ok ? '' : ' disabled'}${o.account === 'room' ? ' title="Whichever has the most left when the race starts"' : ''}>${esc(o.short)}${o.ok ? '' : ` · ${esc(o.why.charAt(0).toLowerCase() + o.why.slice(1))}`}</option>`).join('');
}
// Each side's model and effort, with the shared picker's lists: as last time, a preset (Quick, Balanced, Deep, Max),
// or any model it has, and an effort when that model offers a choice. Kept for each assistant while the dialog is
// open, so changing who races keeps what you picked for the one that stays.
const RaceRun = {};
// The list a side's models come from: Codex's side runs as the Codex account in use, which may be an Ollama one.
const raceKind = w => Who.kindOf(w, w === 'codex' ? (S.codex && S.codex.id) : null);
function raceRunDraw() {
  const box = $('rcRun'); if (!box) return;
  $('rcNote').hidden = true;   // (what it said was about the choice before)
  const was = box.contains(document.activeElement) ? document.activeElement.id : null;
  box.innerHTML = ($('rcWho').value || 'claude+codex').split('+').map(w => {
    const st = RaceRun[w] || (RaceRun[w] = { model: '', effort: '' }), name = RACE_NAME[w] || w;
    const choices = Who.modelChoices(raceKind(w));
    if (!choices.some(c => c.value === st.model)) st.model = '';
    const efforts = Who.effortChoices(raceKind(w), st.model);
    if (!efforts.includes(st.effort)) st.effort = '';
    return `<div class="rc-side" data-side="${esc(w)}"><label>${esc(name)}’s model<select id="rcModel-${esc(w)}" data-rc-run="model">${choices.map(c => `<option value="${esc(c.value)}"${c.value === st.model ? ' selected' : ''} title="${esc(c.title || '')}">${esc(c.label)}</option>`).join('')}</select></label>`
      + (efforts.length ? `<label>${esc(name)}’s effort<select id="rcEffort-${esc(w)}" data-rc-run="effort"><option value="">Its usual</option>${efforts.map(e => `<option value="${esc(e)}"${e === st.effort ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>` : '')
      + '</div>';
  }).join('');
  if (was && $(was)) $(was).focus();
}
// What each side starts on ({ claude: { model, effort }, … }; nothing for "as last time"). A preset is placed on one
// of the assistant's models now; when it can't be, it says why and gives null (the race doesn't start).
async function raceRuns(who) {
  if (who.some(w => /^preset:/.test((RaceRun[w] || {}).model || ''))) await Who.loadModels(true);
  const run = {};
  for (const w of who) {
    const st = RaceRun[w] || {}, r = Who.runOf(raceKind(w), st.model, st.effort);
    if (r.preset) { $('rcNote').textContent = Who.presetMiss(raceKind(w), r.preset); $('rcNote').hidden = false; $(`rcModel-${w}`)?.focus(); return null; }
    if (r.model) run[w] = r;
  }
  return run;
}
function openRaceDialog(cwd = null, mode = 'race', who = null) {
  const pairs = racePairs();
  if (!pairs.length) { const fix = raceSetup(); toast(fix.say, 9000, fix); return; }
  const projects = S.projects.filter(p => p.exists).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!projects.length) { toast('A race works in a copy of a project, and there’s no project yet.', 7000, { label: 'New project', run: openNewProject }); return; }
  const d = raceDialog();
  const pick = cwd || (S.view === 'folder' ? S.folder : null) || (projects[0] && projects[0].cwd);
  $('rcProject').innerHTML = projects.map(p => `<option value="${esc(p.cwd)}"${p.cwd === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  const want = who && pairs.find(p => p.join('+') === who) ? who : pairs[0].join('+');
  $('rcWho').innerHTML = pairs.map(p => `<option value="${p.join('+')}"${p.join('+') === want ? ' selected' : ''}>${RACE_NAME[p[0]]} and ${RACE_NAME[p[1]]}</option>`).join('');
  raceAccounts();
  // Each side starts as last time until you pick otherwise; the models come from the server, and are drawn once known.
  for (const k of Object.keys(RaceRun)) delete RaceRun[k];
  Who.loadModels().then(() => { if (d.open) raceRunDraw(); });
  $('rcFrom').innerHTML = `<option value="">Start from a saved prompt…</option>${S.prompts.map(pr => `<option value="${esc(pr.id)}">${esc(pr.title)}</option>`).join('')}`;
  $('rcFrom').hidden = !S.prompts.length;
  $('rcText').value = ''; $('rcClaude').value = ''; $('rcCodex').value = '';
  raceMode(mode);
  d.showModal(); (mode === 'split' ? $('rcClaude') : $('rcText')).focus();
}

async function raceAction(act, b) {
  if (act === 'race-new') return openRaceDialog(b.dataset.cwd || null);
  if (act === 'split-new') return openRaceDialog(b.dataset.cwd || null, 'split');
  if (act === 'race-open') return b.dataset.key ? ChatUI.openKey(b.dataset.key) : ChatUI.open({ sessionId: b.dataset.sid, provider: b.dataset.who || null });
  const r = (S.races || []).find(x => x.id === b.dataset.id); if (!r) return undefined;
  const name = RACE_NAME[b.dataset.who] || 'its';
  if (act === 'race-diff') return viewRaceChanges(r, b.dataset.who);
  if (act === 'race-discard') {
    if (!(await appConfirm('Discard both?\n\nBoth chats stop and both copies are deleted. Your project stays as it is.', { ok: 'Discard both', danger: true }))) return undefined;
    S.races = (await api('/api/race', { action: 'discard', id: r.id })).races; renderRaces();
    return toast('Discarded.', 2500);
  }
  if (act === 'race-judge') {
    const res = await api('/api/race', { action: 'judge', id: r.id });
    S.races = res.races; renderRaces();
    toast('The judge is looking. Its verdict shows on the race’s card.', 4000);
    return undefined;
  }
  if (act === 'race-files') return pickRaceFiles(r);
  if (act === 'race-both') {
    const n = racersOf(r).reduce((k, [w]) => k + ((r.racers[w] || {}).files || []).length, 0);
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
// File by file: tick the files to keep from each copy (a file both changed comes from one of them).
async function pickRaceFiles(r) {
  const files = {}, all = new Map();
  for (const [w] of racersOf(r)) for (const f of (r.racers[w] || {}).files || []) { (files[w] || (files[w] = [])).push(f); const k = f.path.toLowerCase(); all.set(k, [...(all.get(k) || []), w]); }
  const row = (w, f) => { const shared = all.get(f.path.toLowerCase()).length > 1; return `<label class="pf-row"><input type="${shared ? 'radio' : 'checkbox'}" name="${shared ? `pf-${esc(f.path.toLowerCase())}` : ''}" data-who="${w}" data-path="${esc(f.path)}"><span class="pf-p">${esc(f.path)}</span><span class="pf-n"><i class="d-add">+${f.add || 0}</i> <i class="d-del">−${f.del || 0}</i>${shared ? ' · both changed it' : ''}</span></label>`; };
  const d = document.createElement('dialog');
  d.className = 'wide pick-files';
  d.innerHTML = `<form method="dialog"><div class="setup-head"><h3>Pick files to keep</h3><button type="button" class="icon" data-pf="x" aria-label="Close">✕</button></div>
    <div class="pf-body">${racersOf(r).map(([w, name]) => (files[w] || []).length ? `<p class="pf-h"><span class="crew-dot ${w}" aria-hidden="true"></span>From ${name}’s copy</p>${files[w].map(f => row(w, f)).join('')}` : '').join('')}
    <p class="pf-note">A file both changed comes from one of them. The files come into ${esc(r.folder || 'your project')} together, all or nothing; both chats stop and both copies are deleted.</p>
    <div class="d-row"><span class="spacer"></span><button type="button" class="btn" data-pf="x">Cancel</button><button type="submit" class="btn prime">Keep these files</button></div></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  const picks = await new Promise(res => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-pf="x"]')) { d.close(); res(null); } });
    d.addEventListener('cancel', () => res(null));
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const out = {};
      for (const i of d.querySelectorAll('input:checked')) (out[i.dataset.who] || (out[i.dataset.who] = [])).push(i.dataset.path);
      if (!Object.keys(out).length) { toast('Tick at least one file.'); return; }
      d.close(); res(out);
    });
  });
  d.remove();
  if (!picks) return;
  let res = await api('/api/race', { action: 'keepfiles', id: r.id, picks });
  if (!res.kept && res.why === 'changed' && await appConfirm(`${r.folder || 'Your project'} changed since the race began.\n\nTry to bring the files in anyway? If anything clashes, nothing is changed.`, { ok: 'Try anyway' })) res = await api('/api/race', { action: 'keepfiles', id: r.id, picks, force: true });
  S.races = res.races; renderRaces();
  if (res.kept) toast(`Kept ${res.files.length} file${res.files.length === 1 ? '' : 's'}.`, 4000);
  else if (res.why === 'conflict') toast(`Those files clash with what changed in your project, so nothing was changed.${res.detail ? `\n${res.detail}` : ''}`, 12000);
  else if (res.why === 'overlap') toast('A file can come from one copy only.', 5000);
}
// A racer's changes, file by file (the same view as a reply's changes).
async function viewRaceChanges(r, who) {
  const files = (r.racers[who] && r.racers[who].files) || [];
  const fake = { _ev: { files, turn: null }, dataset: { src: 'main' } };
  await viewChanges(fake, `/api/race/diff?id=${encodeURIComponent(r.id)}&who=${who}`, `What ${RACE_NAME[who] || 'it'} changed in its copy`);
}

// While a race runs, its card follows what each one has changed (on the hub, while it's on screen).
setInterval(() => { if ((S.races || []).some(r => r.state === 'running') && S.view === 'hub' && !document.hidden && !ChatUI.isOpen()) loadRaces().catch(() => {}); }, 8000);
