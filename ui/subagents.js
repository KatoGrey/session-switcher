'use strict';
// Subagents (lib/subagents.js): which assistant, model and reasoning effort the helpers a chat starts get. Defaults for
// Claude chats (every chat, and Your work's) and Codex chats, and your roster of named subagents, each run by Claude,
// Codex or Gemini with its own model, effort, tools and purpose.
const Subs = { data: null, draft: null, err: null, saving: false, models: null };

function subsDialog() {
  let d = $('subsDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="subsDlg" class="wide subs-dlg" aria-labelledby="subsTitle">
    <div class="setup-head"><h3 id="subsTitle">Subagents</h3><button class="icon" data-sa="close" aria-label="Close">✕</button></div>
    <div class="rd-body" id="subsBody"><p class="loading">Reading your subagents…</p></div></dialog>`);
  d = $('subsDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d) return d.close();
    const b = e.target.closest('[data-sa]'); if (!b) return undefined;
    const act = b.dataset.sa, i = Number(b.dataset.i);
    if (act === 'close') return d.close();
    if (act === 'add') { subsRead(); Subs.draft.roster.push({ name: '', description: '', model: 'sonnet', effort: 'medium', tools: 'all', prompt: '', fresh: true }); subsRender(); return d.querySelector('.sa-card:last-of-type [data-f="name"]')?.focus(); }
    if (act === 'remove') { subsRead(); Subs.draft.roster.splice(i, 1); return subsRender(); }
    if (act === 'starters') { subsRead(); const have = new Set(Subs.draft.roster.map(a => a.name)); for (const s of Subs.data.starters) if (!have.has(s.name)) Subs.draft.roster.push({ ...s }); return subsRender(); }
    if (act === 'save') return subsSave();
    return undefined;
  }));
  d.addEventListener('change', e => { if (e.target.matches('[data-f="engine"]')) { subsRead(); const i = Number(e.target.closest('.sa-card').dataset.i); Object.assign(Subs.draft.roster[i], { model: Subs.draft.roster[i].engine === 'claude' ? 'sonnet' : '', effort: '' }); subsRender(); } });
  d.addEventListener('input', () => { if (Subs.err) { Subs.err = null; const e = $('subsErr'); if (e) e.textContent = ''; } });
  return d;
}

async function openSubagents() {
  const d = subsDialog();
  if (!d.open) d.showModal();
  Subs.err = null;
  // Codex's and Gemini's models, as Your work lists them (the subagent of either can use any of them).
  if (!Subs.models) api('/api/work/models').then(m => { Subs.models = m || {}; if ($('subsDlg')?.open) { subsRead(); subsRender(); } }).catch(() => { Subs.models = {}; });
  try { Subs.data = await api('/api/subagents'); Subs.draft = JSON.parse(JSON.stringify({ defaults: Subs.data.defaults, work: Subs.data.work, codex: Subs.data.codex || { model: '', effort: '' }, roster: Subs.data.roster })); }
  catch (err) { Subs.err = err.message; }
  subsRender();
}

const saOpts = (list, cur, first) => `${first ? `<option value="">${esc(first)}</option>` : ''}${list.map(o => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}`;
const saModels = (cur, first) => saOpts(Subs.data.models.filter(m => !(first && m.value === 'inherit')), cur, first);
const effortWord = e => (e === 'xhigh' ? 'Extra high' : e[0].toUpperCase() + e.slice(1));
const saEfforts = (cur, first, engine = 'claude') => saOpts((engine === 'codex' ? Subs.data.codexEfforts || Subs.data.efforts : Subs.data.efforts).map(e => ({ value: e, label: effortWord(e) })), cur, first);
// Codex's or Gemini's models ('' is the assistant's own default); one saved that the list doesn't have stays choosable.
function saEngineModels(engine, cur) {
  const list = ((Subs.models || {})[engine] || {}).models || [];
  const def = ((Subs.models || {})[engine] || {}).defaultModel;
  const opts = [{ value: '', label: def ? `Default (${def})` : 'Its default model' }, ...list.map(m => ({ value: m.value, label: m.label || m.value }))];
  if (cur && !opts.some(o => o.value === cur)) opts.push({ value: cur, label: cur });
  return saOpts(opts, cur);
}
const saModelFor = a => (a.engine === 'claude' || !a.engine ? saModels(a.model) : saEngineModels(a.engine, a.model));

function subsRender() {
  const body = $('subsBody'); if (!body) return;
  if (!Subs.data) { body.innerHTML = `<p class="${Subs.err ? 'rd-note bad' : 'loading'}">${esc(Subs.err || 'Reading your subagents…')}</p>`; return; }
  const v = Subs.draft;
  const card = (a, i) => `<li class="sa-card" data-i="${i}">
      <div class="sa-card-top"><label class="sa-name"><span class="sr">Name</span><input data-f="name" value="${esc(a.name)}" placeholder="name, like scout" spellcheck="false" autocomplete="off" maxlength="40"></label>
        <label><span>Runs on</span><select data-f="engine" class="sa-engine" data-engine="${esc(a.engine || 'claude')}">${saOpts(Subs.data.engines || [{ value: 'claude', label: 'Claude' }], a.engine || 'claude')}</select></label>
        <label><span>Model</span><select data-f="model">${saModelFor(a)}</select></label>
        <label><span>Effort</span><select data-f="effort">${saEfforts(a.effort, 'Model’s default', a.engine)}</select></label>
        <label><span>Tools</span><select data-f="tools"><option value="all"${a.tools !== 'read' ? ' selected' : ''}>Can change files</option><option value="read"${a.tools === 'read' ? ' selected' : ''}>Reads only</option></select></label>
        <button type="button" class="icon sa-remove" data-sa="remove" data-i="${i}" aria-label="Remove ${esc(a.name || 'this subagent')}" title="Remove">✕</button></div>
      ${a.engine === 'codex' ? '<p class="sa-how">In Claude chats it hands the job to Codex and brings back the answer. In Codex chats it’s one of Codex’s own subagents.</p>' : a.engine === 'gemini' ? '<p class="sa-how">In Claude chats it hands the job to Gemini (Antigravity) and brings back the answer. Gemini chats have no subagents of their own.</p>' : ''}
      <label class="sa-what"><span>What it’s for <small>(the chat picks a subagent by this)</small></span><textarea data-f="description" rows="2" maxlength="600" placeholder="Fast look-ups across the code…">${esc(a.description)}</textarea></label>
      <details class="sa-more"${a.fresh ? ' open' : ''}><summary>Its instructions</summary><textarea data-f="prompt" rows="3" maxlength="4000" placeholder="What it should do, and what it must not.">${esc(a.prompt || '')}</textarea></details></li>`;
  body.innerHTML = `<p class="sa-intro">When a chat hands part of a job to a subagent (a search, a review, a check), it runs on the assistant, model and effort you set here. A quick model for look-ups and a strong one for reviews saves usage without losing quality, and a Codex or Gemini subagent gives a Claude chat a second opinion from another model family. New chats get these; open chats keep theirs until they restart.</p>
    <section class="sa-sec"><h4>Defaults</h4><p class="rd-note">For any subagent not in your list below (Claude’s own Explore, Plan and general-purpose, and Codex’s spawned agents).</p>
      <div class="sa-grid">
        <span class="sa-who">Claude chats <small>every chat</small></span><select id="saDefModel" aria-label="Default subagent model">${saModels(v.defaults.model)}</select><select id="saDefEffort" aria-label="Default subagent effort">${saEfforts(v.defaults.effort, 'Model’s default')}</select>
        <span class="sa-who">Your work <small>Claude’s PR and issue chats</small></span><select id="saWorkModel" aria-label="Subagent model for Your work">${saModels(v.work.model, 'Same as every chat')}</select><select id="saWorkEffort" aria-label="Subagent effort for Your work">${saEfforts(v.work.effort, 'Same as every chat')}</select>
        <span class="sa-who">Codex chats <small>any subagent Codex starts</small></span><select id="saCodexModel" aria-label="Subagent model for Codex chats">${saEngineModels('codex', v.codex ? v.codex.model : '').replace(/>(Default \([^)]*\)|Its default model)</, '>Same as the chat<')}</select><select id="saCodexEffort" aria-label="Subagent effort for Codex chats">${saEfforts(v.codex ? v.codex.effort : '', 'Model’s default', 'codex')}</select>
      </div></section>
    <section class="sa-sec"><h4>Your subagents <span class="sa-count">${v.roster.length}</span></h4><p class="rd-note">Claude chats get all of them (named <code>session-switcher:&lt;name&gt;</code>); Codex chats get the Codex ones, as their own subagents. A chat uses one when the job fits what it’s for.</p>
      <ul class="sa-list">${v.roster.map(card).join('') || '<li class="rd-note">None yet.</li>'}</ul>
      <div class="sa-row"><button type="button" class="btn sm" data-sa="add">+ Add a subagent</button>${Subs.data.starters.some(s => !v.roster.some(a => a.name === s.name)) ? '<button type="button" class="btn sm quiet" data-sa="starters">Put back the starters</button>' : ''}</div></section>
    <section class="sa-sec sa-tip"><h4>Ask in words</h4><p>In any chat, say what you want, like “do the searches on Haiku, low effort”, “have Codex review it” or “spawn the checks at low reasoning”. Claude chats’ <code>subagent-models</code> skill and Codex chats’ instructions pass that on to each subagent they start.</p></section>
    <div class="sa-foot"><span id="subsErr" class="sa-err" role="alert">${esc(Subs.err || '')}</span><button type="button" class="btn quiet" data-sa="close">Cancel</button><button type="button" class="btn prime" data-sa="save"${Subs.saving ? ' disabled' : ''}>${Subs.saving ? 'Saving…' : 'Save'}</button></div>`;
}

// What's typed so far, into the draft (so adding or removing one keeps the rest).
function subsRead() {
  const d = $('subsDlg'), v = Subs.draft; if (!d || !v) return v;
  const val = id => ($(id) || {}).value || '';
  v.defaults = { model: val('saDefModel') || 'inherit', effort: val('saDefEffort') };
  v.work = { model: val('saWorkModel'), effort: val('saWorkEffort') };
  v.codex = { model: val('saCodexModel'), effort: val('saCodexEffort') };
  v.roster = [...d.querySelectorAll('.sa-card')].map(li => {
    const f = k => (li.querySelector(`[data-f="${k}"]`) || {}).value || '';
    return { name: f('name').trim(), engine: f('engine') || 'claude', description: f('description').trim(), model: f('model'), effort: f('effort'), tools: f('tools'), prompt: f('prompt').trim() };
  });
  return v;
}

async function subsSave() {
  const v = subsRead();
  Subs.saving = true; subsRender();
  try {
    Subs.data = { ...Subs.data, ...(await api('/api/subagents', { defaults: v.defaults, work: v.work, codex: v.codex, roster: v.roster.map(({ fresh, ...a }) => a) })) };
    Subs.saving = false;
    $('subsDlg').close();
    toast('Saved. New Claude chats get these subagents.', 5000);
    document.dispatchEvent(new CustomEvent('subagents-saved', { detail: Subs.data }));
  } catch (err) { Subs.saving = false; Subs.err = err.message; subsRender(); }
}
