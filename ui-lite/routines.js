'use strict';
/* Routines: chats that start on their own (the full app's routines), made and followed here.
   A routine can be a cheap checker (say GLM on Ollama, read-only) that ends each run with a verdict:
   ALL CLEAR stays quiet; ESCALATE tells you (Now, the phone) and can start a bug-report chat on your
   use-next Claude plan. The Routines page shows every routine, its runs and what each one found. */

S.rt = { list: null, events: [], prompt: '' };
async function loadRoutines() {
  const j = await api('/api/lite/routines');
  const before = new Set((S.rt.events || []).map(e => e.id));
  S.rt = { list: j.routines, events: j.events, prompt: j.escalatePrompt, runIds: new Set(j.routines.flatMap(r => r.runs.map(h => String(h.sessionId || '').toLowerCase()).filter(Boolean))) };
  // Something new that matters: a knock, and a desktop notification if the window is in the back.
  const fresh = j.events.filter(e => !e.seen && !before.has(e.id) && e.kind !== 'ran');
  if (loadRoutines.ready && fresh.length) {
    sfx('knock');
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') for (const e of fresh.slice(0, 3)) new Notification(`${e.name}: ${e.title}`.slice(0, 120), { body: e.note || (e.kind === 'escalate' ? 'A routine flagged this.' : ''), tag: `rt-${e.id}` });
  }
  loadRoutines.ready = true;
  return S.rt;
}
const rtEventsOpen = () => (S.rt.events || []).filter(e => !e.seen);

const runsOnLabel = r => { const p = planById(r.account); const name = p ? (p.family === 'ollama' ? 'Ollama' : `${p.label} ${famName(p.family)}`) : r.account; return `${name}${r.model ? ` · ${r.model.replace(/:cloud$/, '')}` : ''}`; };
const RUN_ICONS = { done: '✓', failed: '✕', stopped: '✕', skipped: '–', 'needs-you': '!', working: '…', starting: '…' };
const runIcon = (st, line = '') => (st === 'done' && /^\W*ESCALATE/i.test(line) ? '!' : RUN_ICONS[st] || '·');
const rtProjName = cwd => { const p = S.projects.find(x => x.cwd === cwd && !x.key.includes('#')) || S.projects.find(x => x.cwd === cwd); return p ? p.name : (cwd || '').split('/').pop(); };

/* ---------- the Routines page ---------- */
function routinesView() {
  if (!S.rt.list) { loadRoutines().then(() => S.view === 'routines' && render()).catch(err => toast(err.message)); return '<div class="wrap"><p class="empty-note">Reading your routines…</p></div>'; }
  const list = S.rt.list;
  const row = r => {
    const last = r.runs[0];
    const open = S.more[`rt:${r.id}`];
    const ev = (S.rt.events || []).find(e => e.routine === r.id);
    const lastLine = last ? `${runIcon(last.status, last.line)} ${last.line}` : 'No runs yet';
    return `<div class="row rt-row ${r.enabled ? '' : 'is-quiet'}" role="button" tabindex="-1" data-rt="${esc(r.id)}" data-cur="rt:${esc(r.id)}">
        <span>${r.running ? '<span class="live-dot"></span>' : ev && !ev.seen && ev.kind === 'escalate' ? '<span class="dot needs-dot"></span>' : ''}</span>
        <span class="t"><b>${esc(r.name)}</b><small>${esc(r.when)} · ${esc(runsOnLabel(r))} · ${esc(rtProjName(r.cwd))}${r.flow.triage ? ' · checks and escalates' : ''}</small><small class="rt-last">${esc(lastLine.slice(0, 200))}</small></span>
        <span class="side-tags">${r.enabled ? '' : '<span class="tag">Paused</span>'}${r.watchError ? `<span class="tag warn" title="${esc(r.watchError)}">Can’t read its source</span>` : ''}</span>
        <span class="when">${r.enabled && r.nextAt ? esc(inWords(r.nextAt)) : ''}</span>
        <button class="iconbtn rmenu" data-rtmenu="${esc(r.id)}" aria-haspopup="menu" aria-label="Routine options">${IC.dots}</button>
      </div>${open ? `<div class="rt-runs">${r.runs.length ? r.runs.map(h => `<div class="row rt-run" role="button" tabindex="-1" ${h.sessionId ? `data-rtrun="${esc(h.sessionId)}" data-prov="${esc(r.provider)}"` : ''} data-cur="rr:${esc(h.id)}"><span class="rt-ic st-${esc(/^\W*ESCALATE/i.test(h.line || '') ? 'needs-you' : h.status)}">${runIcon(h.status, h.line)}</span><span class="t"><small>${esc(h.line || h.status)}</small></span><span class="side-tags"></span><span class="when">${ago(h.at)}</span><span></span></div>`).join('') : '<p class="empty-note">No runs yet. Run now tries it.</p>'}</div>` : ''}`;
  };
  return `<div class="wrap"><div class="page-h"><div class="proj-h">${BACK}<h1>Routines</h1></div><div style="display:flex;gap:6px"><button class="btn prime" data-rtnew="check">New routine</button></div></div>
    <p class="hint-line" style="margin-top:-12px">Chats that start on their own. A checker runs on a small model, reads what you point it at, and only bothers you when something needs attention; then a bug chat on your use-next Claude plan writes it up. Never posts anywhere.</p>
    ${list.length ? `<div class="rows">${list.map(row).join('')}</div>` : `<div class="rt-presets">${presetCards()}</div>`}
    ${eventsSection(true)}
  </div>`;
}
function presetCards() {
  return [['check', 'Daily check, on a small model', 'GLM 5.3 Flash on Ollama looks at Linear, a folder or a command’s output every weekday morning, and escalates bugs.'],
    ['watch', 'Watch a command', 'Runs a command every few minutes; anything new it prints is triaged (good for Discord or a helpdesk export).'],
    ['blank', 'Anything else', 'Any prompt, any plan, any schedule.']]
    .map(([k, t, d]) => `<button class="card rt-preset" data-rtnew="${k}"><span class="body"><span class="name">${esc(t)}</span><span class="meta">${esc(d)}</span></span></button>`).join('');
}

/* ---------- what came of the runs (on Now and on Routines) ---------- */
// On Now: one row per routine (its latest report; tap it to read the run, × clears it and the
// earlier ones), and the bug chats a sweep started as a single line that goes to Bugs.
function nowEventsSection() {
  const evs = rtEventsOpen();
  if (!evs.length) return '';
  const bugs = evs.filter(e => e.escalation && e.escalation.sessionId);
  const groups = new Map();
  for (const e of evs.filter(x => !bugs.includes(x))) { if (!groups.has(e.name)) groups.set(e.name, []); groups.get(e.name).push(e); }
  const icon = e => (e.kind === 'failed' ? '<span class="rt-ic st-failed">✕</span>' : e.kind === 'needs-you' || e.kind === 'escalate' ? '<span class="dot needs-dot"></span>' : '<span class="rt-ic st-done">✓</span>');
  const rows = [...groups.values()].map(g => {
    const e = g[0], earlier = g.length - 1;
    return `<div class="row ev-row" ${e.sessionId ? `data-rtrun="${esc(e.sessionId)}" data-prov="${esc(e.provider || '')}" role="button" title="Read the run"` : ''} data-cur="ev:${esc(e.id)}"><span>${icon(e)}</span>
      <span class="t"><b class="ev-t">${esc(e.title)}</b><small>${esc(e.name)} · ${esc(ago(e.at))}${earlier ? ` · ${earlier} earlier` : ''}</small></span><span></span><span class="when"></span>
      <button class="iconbtn" data-evseen="${esc(g.map(x => x.id).join(','))}" aria-label="Clear" title="Clear${earlier ? ' (and the earlier ones)' : ''}">×</button></div>`;
  });
  if (bugs.length) rows.push(`<div class="row ev-row" data-go="bugs" role="button" title="Open Bugs"><span><span class="dot needs-dot"></span></span>
      <span class="t"><b>${bugs.length === 1 ? 'A new bug chat' : `${bugs.length} new bug chats`}</b><small>${esc(bugs.slice(0, 3).map(e => e.title).join(' · '))}${bugs.length > 3 ? ' …' : ''}</small></span><span></span><span class="when">Bugs ›</span>
      <button class="iconbtn" data-evseen="${esc(bugs.map(x => x.id).join(','))}" aria-label="Clear" title="Clear">×</button></div>`);
  return `<section class="section"><div class="sec-h"><h2>From your routines</h2><span class="n">${rows.length}</span><button class="hint nowrap" data-evseen="all">Clear all</button><button class="hint nowrap" data-go="routines" style="margin-left:12px">Routines ›</button></div>
    <div class="rows">${rows.join('')}</div></section>`;
}
function eventsSection(all = false) {
  if (!all) return nowEventsSection();
  const evs = all ? (S.rt.events || []).slice(0, 20) : rtEventsOpen();
  if (!evs.length) return all ? '' : '';
  const icon = e => (e.kind === 'escalate' ? '<span class="dot needs-dot"></span>' : e.kind === 'failed' ? '<span class="rt-ic st-failed">✕</span>' : e.kind === 'needs-you' ? '<span class="dot needs-dot"></span>' : '<span class="rt-ic st-done">✓</span>');
  const row = e => `<div class="row ev-row ${e.seen ? 'is-quiet' : ''}" data-cur="ev:${esc(e.id)}"><span>${icon(e)}</span>
      <span class="t"><b>${esc(e.title)}</b><small>${esc(e.name)} · ${esc(ago(e.at))}${e.note ? ` · ${esc(e.note)}` : e.escalation ? ' · a bug chat is on it' : ''}</small></span>
      <span class="side-tags">${e.escalation && e.escalation.sessionId ? `<button class="btn sm prime" data-open="${esc(e.escalation.sessionId)}">Bug chat</button>` : ''}${e.sessionId ? `<button class="btn sm" data-rtrun="${esc(e.sessionId)}" data-prov="${esc(e.provider || '')}">The check</button>` : ''}</span>
      <span class="when"></span>${e.seen ? '<span></span>' : `<button class="iconbtn" data-evseen="${esc(e.id)}" aria-label="Dismiss" title="Dismiss">×</button>`}</div>`;
  return `<section class="section"><div class="sec-h"><h2>${all ? 'What the routines found' : 'From your routines'}</h2><span class="n">${evs.filter(e => !e.seen).length || ''}</span>${!all && evs.length > 1 ? '<button class="hint" data-evseen="all">Dismiss all</button>' : ''}${!all ? '<button class="hint" data-go="routines" style="margin-left:12px">Routines ›</button>' : ''}</div>
    <div class="rows">${evs.map(row).join('')}</div></section>`;
}
async function seeEvents(ids) {
  const j = await api('/api/lite/routines/seen', ids === 'all' ? { all: true } : { ids });
  S.rt.events = j.events; render(); updateBadge();
}

/* ---------- making and editing one ---------- */
const PRESETS = {
  check: () => ({ name: 'Daily check', prompt: 'Look for new problems reported since yesterday (in Linear, and anything else you can read from here). Ignore things already being handled.', trigger: { type: 'schedule', schedule: { kind: 'weekdays', time: '09:00' } }, small: true, chat: 'continue' }),
  watch: () => ({ name: 'Watch for new reports', prompt: 'New lines came in from the source below. Decide whether any of them is a real bug or an outage that needs a developer.', trigger: { type: 'watch', source: { type: 'command', command: '', every: 10, filter: '' } }, small: true, chat: 'new' }),
  blank: () => ({ name: '', prompt: '', trigger: { type: 'schedule', schedule: { kind: 'daily', time: '09:00' } }, small: false, chat: 'new' }),
};
function smallModel() { const m = MD('ollama'); const all = m ? [...m.models, ...(m.more || [])].map(x => x.value) : []; return all.find(v => /^glm-5\.3-flash/.test(v)) || all.find(v => /flash/.test(v)) || 'glm-5.3-flash:cloud'; }
function newRoutine(kind, draft = {}) {
  Promise.resolve(loadModels()).then(() => { if (S.view === 'routine' && S.rtEdit) { readRoutineForm(); render(); } });
  const p = PRESETS[kind] ? PRESETS[kind]() : PRESETS.blank();
  const ol = plans().find(x => x.family === 'ollama' && !x.broken), cl = useNext('claude') || plans().find(x => x.family === 'claude' && !x.broken);
  const proj = draft.cwd ? null : (S.view === 'project' ? projBy.get(S.project) : null);
  const account = p.small && ol ? ol.id : (cl ? cl.id : (plans()[0] || {}).id);
  S.rtEdit = {
    id: null, name: draft.name || p.name, prompt: draft.prompt || p.prompt, cwd: draft.cwd || (proj && proj.cwd) || '', account,
    model: p.small && ol ? smallModel() : null, permissionMode: p.small ? 'read-only' : ((S.lite.permissions || {}).claude || 'default'),
    trigger: p.trigger, chat: { mode: p.chat }, flow: { triage: p.small, notify: 'important', escalate: { on: p.small, prompt: '' } },
  };
  go('routine');
}
function editRoutine(id) {
  const r = (S.rt.list || []).find(x => x.id === id); if (!r) return;
  Promise.resolve(loadModels()).then(() => { if (S.view === 'routine' && S.rtEdit) { readRoutineForm(); render(); } });
  S.rtEdit = { id: r.id, name: r.name, prompt: r.prompt, cwd: r.cwd, account: r.account, model: r.model, permissionMode: r.permissionMode, trigger: JSON.parse(JSON.stringify(r.trigger)), chat: { mode: r.chat ? r.chat.mode : 'new' }, flow: JSON.parse(JSON.stringify(r.flow)) };
  go('routine');
}
const provOfPlan = id => { const p = planById(id); return !p ? 'claude' : p.family === 'claude' ? 'claude' : 'codex'; };
const rtModelsFor = id => { const p = planById(id); const m = MD(!p ? 'claude' : p.family === 'ollama' ? 'ollama' : p.family === 'chatgpt' ? 'codex' : 'claude'); return m ? [...m.models, ...(m.more || [])] : []; };
const permsFor = id => (provOfPlan(id) === 'codex' ? ['read-only', 'ask', 'agent', 'full'] : ['default', 'acceptEdits', 'plan', 'bypassPermissions']);
const PERM_NAMES = { 'read-only': 'Read-only', ask: 'Ask', agent: 'Agent', full: 'Full access', default: 'Ask first', acceptEdits: 'Accept edits', plan: 'Plan only', bypassPermissions: 'Bypass permissions' };
function routineEditorView() {
  const d = S.rtEdit; if (!d) { setTimeout(() => go('routines'), 0); return ''; }
  const t = d.trigger, s = t.schedule || {}, src = t.source || {};
  const kind = t.type === 'watch' ? (src.type === 'slack' ? 'slack' : 'command') : s.kind || 'weekdays';
  const accts = plans().filter(p => !p.broken).map(p => `<option value="${esc(p.id)}" ${p.id === d.account ? 'selected' : ''}>${esc(p.family === 'ollama' ? 'Ollama (outside your Claude and ChatGPT limits)' : `${famName(p.family)} · ${p.label}`)}</option>`).join('');
  const models = rtModelsFor(d.account);
  // The chosen model stays on the list even before the lists have loaded.
  if (d.model && !models.some(m => m.value === d.model)) models.unshift({ value: d.model, label: d.model.replace(/:cloud$/, '') });
  const proj = d.cwd ? rtProjName(d.cwd) : 'Pick a project';
  return `<div class="wrap rt-edit"><div class="page-h"><div class="proj-h"><button class="iconbtn back" data-go="routines" aria-label="Back">‹</button><h1>${d.id ? 'Edit routine' : 'New routine'}</h1></div></div>
  <form id="rtForm" class="rt-form" autocomplete="off">
    <label class="fl"><span>Name</span><input class="field" name="name" value="${esc(d.name)}" placeholder="Morning bug check" required></label>
    <label class="fl"><span>What it should do</span><textarea class="field" name="prompt" rows="5" placeholder="Look at … and tell me about …">${esc(d.prompt)}</textarea></label>
    <div class="fl"><span>When</span><div class="rt-when">
      <select class="field" name="kind">${[['weekdays', 'Every weekday at'], ['daily', 'Every day at'], ['weekly', 'Every week on'], ['every-hours', 'Every few hours'], ['every-minutes', 'Every few minutes'], ['command', 'When a command prints something new'], ['slack', 'When a Slack channel has something new'], ['cron', 'A cron line']].map(([v, n]) => `<option value="${v}" ${(kind === v || (kind === 'every' && v === `every-${s.unit || 'hours'}`)) ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${kind === 'weekly' ? `<select class="field" name="day" aria-label="Day of the week">${DAY_NAMES.map((n, i) => `<option value="${i}" ${i === (s.day ?? 1) ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="unit">at</span>` : ''}
      ${kind === 'weekdays' || kind === 'daily' || kind === 'weekly' ? `<input class="field" name="time" type="time" value="${esc(s.time || '09:00')}">` : ''}
      ${kind === 'every' || kind === 'every-hours' || kind === 'every-minutes' ? `<input class="field num" name="every" type="number" min="1" value="${esc(s.every || 2)}"><span class="unit">${s.unit === 'minutes' || kind === 'every-minutes' ? 'minutes' : 'hours'}</span>` : ''}
      ${kind === 'cron' ? `<input class="field mono" name="cron" value="${esc(s.cron || '0 9 * * 1-5')}" placeholder="0 9 * * 1-5">` : ''}
    </div>
    ${kind === 'command' ? `<input class="field mono" name="command" value="${esc(src.command || '')}" placeholder="a command that prints one line per new message"><div class="rt-when"><span class="unit">look every</span><input class="field num" name="srcEvery" type="number" min="1" value="${esc(src.every || 10)}"><span class="unit">minutes, only lines containing</span><input class="field" name="filter" value="${esc(src.filter || '')}" placeholder="(anything)"></div>` : ''}
    ${kind === 'slack' ? `<input class="field mono" name="channel" value="${esc(src.channel || '')}" placeholder="C0123ABCD"><p class="hint-line">Needs a Slack token, set once in the full app (Routines → Slack). It only reads.</p>` : ''}
    </div>
    <div class="fl"><span>Works in</span><button type="button" class="btn" data-rtproj="1">${esc(proj)}</button></div>
    <div class="fl"><span>Runs on</span><div class="rt-when"><select class="field" name="account">${accts}</select>
      <select class="field" name="model"><option value="">Its default model</option>${models.map(m => `<option value="${esc(m.value)}" ${m.value === d.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <select class="field" name="perm">${permsFor(d.account).map(p => `<option value="${p}" ${p === d.permissionMode ? 'selected' : ''}>${PERM_NAMES[p] || p}</option>`).join('')}</select></div>
      <p class="hint-line">${S.lite.routinesFollow ? 'Claude and ChatGPT routines follow your use-next order when they run. ' : ''}A small model on Ollama costs none of your Claude or ChatGPT room.</p></div>
    <div class="fl"><span>Each run</span><div class="seg" role="group"><button type="button" data-rtchat="new" aria-pressed="${d.chat.mode !== 'continue'}">Starts a new chat</button><button type="button" data-rtchat="continue" aria-pressed="${d.chat.mode === 'continue'}">Continues one chat (it remembers)</button></div></div>
    <div class="fl"><span>Triage</span><label class="chk"><input type="checkbox" name="triage" ${d.flow.triage ? 'checked' : ''}> Ends each run with ALL CLEAR or ESCALATE, and Lite reads it</label>
      <label class="chk"><input type="checkbox" name="escalate" ${d.flow.escalate.on ? 'checked' : ''} ${d.flow.triage ? '' : 'disabled'}> On ESCALATE, start a bug-report chat on your use-next Claude plan (in your permission default; at most 3 a day; the same problem twice in a week joins the first)</label>
      <details class="rt-esc"><summary>What the bug chat is told</summary><textarea class="field" name="escPrompt" rows="5">${esc(d.flow.escalate.prompt || S.rt.prompt || '')}</textarea><p class="hint-line">{name} is the routine, {findings} what it found.</p></details></div>
    <div class="fl"><span>Tell me</span><select class="field" name="notify">${[['important', 'When it escalates, fails or needs me'], ['always', 'After every run'], ['never', 'Never (I’ll look)']].map(([v, n]) => `<option value="${v}" ${d.flow.notify === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="acts"><button type="button" class="btn" data-go="routines">Cancel</button><button type="submit" class="btn prime">${d.id ? 'Save' : 'Create'}</button>${d.id ? '' : '<span class="hint-line">New routines start paused until you Run now or turn them on.</span>'}</div>
  </form></div>`;
}
// What's on the form, back into the draft (so switching "When" keeps the rest).
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function readRoutineForm() {
  const f = $('rtForm'), d = S.rtEdit; if (!f || !d) return d;
  d.name = f.name.value; d.prompt = f.prompt.value;
  const kind = f.kind.value;
  if (kind === 'weekdays' || kind === 'daily' || kind === 'weekly') d.trigger = { type: 'schedule', schedule: { kind, time: f.time ? f.time.value : '09:00', ...(kind === 'weekly' ? { day: f.day ? Number(f.day.value) : 1 } : {}) } };
  else if (kind === 'every-hours' || kind === 'every-minutes') d.trigger = { type: 'schedule', schedule: { kind: 'every', every: f.every ? Number(f.every.value) || 2 : 2, unit: kind === 'every-minutes' ? 'minutes' : 'hours' } };
  else if (kind === 'cron') d.trigger = { type: 'schedule', schedule: { kind: 'cron', cron: f.cron ? f.cron.value : '0 9 * * 1-5' } };
  else if (kind === 'command') d.trigger = { type: 'watch', source: { type: 'command', command: f.command ? f.command.value : '', every: f.srcEvery ? Number(f.srcEvery.value) || 10 : 10, filter: f.filter ? f.filter.value : '' } };
  else if (kind === 'slack') d.trigger = { type: 'watch', source: { type: 'slack', channel: f.channel ? f.channel.value : '', every: 5 } };
  if (f.account.value !== d.account) { d.account = f.account.value; d.model = planById(d.account) && planById(d.account).family === 'ollama' ? smallModel() : null; d.permissionMode = permsFor(d.account)[0]; }
  else { d.model = f.model.value || null; d.permissionMode = f.perm.value; }
  d.flow.triage = f.triage.checked; d.flow.escalate.on = f.triage.checked && f.escalate.checked; d.flow.escalate.prompt = f.escPrompt.value.trim() === (S.rt.prompt || '').trim() ? '' : f.escPrompt.value;
  d.flow.notify = f.notify.value;
  return d;
}
async function saveRoutine() {
  const d = readRoutineForm();
  if (!d.cwd) return toast('Pick the project it works in.');
  const routine = { ...(d.id ? { id: d.id } : {}), name: d.name, prompt: d.prompt, cwd: d.cwd, account: d.account, model: d.model, permissionMode: d.permissionMode, trigger: d.trigger, chat: { mode: d.chat.mode } };
  const j = await api('/api/lite/routines/save', { routine, flow: d.flow });
  S.rt.list = j.routines; S.rt.events = j.events;
  const made = !d.id && j.routines.find(r => r.name === d.name);
  if (made && made.enabled) await api('/api/routines/pause', { id: made.id, paused: true }).catch(() => {});
  S.rtEdit = null; sfx('card'); go('routines');
  await loadRoutines(); render();
  toast(d.id ? 'Saved.' : 'Made. It’s paused: Run now to try it, then turn it on.');
}
async function routineAct(id, act) {
  const r = (S.rt.list || []).find(x => x.id === id); if (!r) return;
  if (act === 'run') { await api('/api/routines/run', { id }); toast(`Running ${r.name}…`); sfx('slide'); S.more[`rt:${id}`] = true; }
  if (act === 'pause') { await api('/api/routines/pause', { id, paused: r.enabled }); toast(r.enabled ? 'Paused.' : 'On: it runs on its schedule.'); }
  if (act === 'remove') { if (!(await confirmBox(`Remove “${r.name}”?`, 'Its past runs stay as chats. This can’t be undone.', 'Remove'))) return; await api('/api/lite/routines/remove', { id }); }
  await loadRoutines(); render();
}
function routineMenu(anchor, id) {
  const r = (S.rt.list || []).find(x => x.id === id); if (!r) return;
  pop(anchor, `<div class="ph">${esc(r.name)}</div><button data-v="run">Run now</button><button data-v="pause">${r.enabled ? 'Pause' : 'Turn on'}</button><button data-v="edit">Edit…</button><button data-v="runs">${S.more[`rt:${id}`] ? 'Hide runs' : 'Show runs'}</button><hr><button data-v="remove">Remove…</button>`, v => {
    if (v === 'edit') return editRoutine(id);
    if (v === 'runs') { S.more[`rt:${id}`] = !S.more[`rt:${id}`]; return render(); }
    return wrap(routineAct)(id, v);
  });
}
// A chat that worked, as a routine: its project and first message to start from.
function routineFromChat(c) {
  const p = projOf(c);
  newRoutine('blank', { name: c.title.slice(0, 60), prompt: c.firstPrompt || c.title, cwd: p.cwd || c.cwd || '' });
}
