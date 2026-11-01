'use strict';
/* Rules and tools: one set for all of them. Claude reads CLAUDE.md, Codex reads AGENTS.md, and Gemini reads AGENTS.md
   in a project and GEMINI.md for every project, so the rules are written once and saved to each; the Tools tab shows
   each one's MCP servers side by side, and copies one across. For a project, or (no project) for every project. */

const RulesUI = { cwd: null, tab: 'rules', data: null, tools: null, from: 'claude' };
const RULE_FILE = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' };
const RULE_WHO = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
const rulesGemini = () => !!(S.gemini && S.gemini.enabled);
// Where a save goes. In a project Gemini reads AGENTS.md with Codex; for every project it has a file of its own.
const ruleTargets = () => (!RulesUI.cwd && rulesGemini() && RulesUI.data && RulesUI.data.gemini ? ['claude', 'codex', 'gemini'] : ['claude', 'codex']);
const andList = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

function rulesDialog() {
  let d = $('rulesDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="rulesDlg" class="wide rules-dlg" aria-labelledby="rdTitle">
    <div class="setup-head"><h3 id="rdTitle">Rules and tools</h3>
      <div class="stabs" role="tablist" aria-label="Rules or tools"><button role="tab" data-rdtab="rules" aria-selected="true">Rules</button><button role="tab" data-rdtab="tools" aria-selected="false">Tools</button></div>
      <button class="icon" data-rd="close" aria-label="Close">✕</button></div>
    <div class="rd-body" id="rdBody"><p class="loading">Reading…</p></div></dialog>`);
  d = $('rulesDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d) return closeRules();
    const tab = e.target.closest('[data-rdtab]'); if (tab) { if ($('rdText')) RulesUI.draft = { text: $('rdText').value, dirty: d.dataset.dirty }; RulesUI.tab = tab.dataset.rdtab; return renderRules(); }
    const b = e.target.closest('[data-rd]'); if (!b) return undefined;
    const act = b.dataset.rd;
    if (act === 'close') return closeRules();
    if (act === 'scope') { if (await rulesDirty()) return undefined; RulesUI.draft = null; RulesUI.cwd = b.dataset.cwd || null; RulesUI.data = RulesUI.tools = null; return loadRules(); }
    if (act === 'from') { RulesUI.draft = null; RulesUI.from = b.dataset.from; $('rdText').value = RulesUI.data[RulesUI.from].text; d.dataset.dirty = ''; return renderRulesState(); }
    if (act === 'gemfile') { if (await rulesDirty()) return undefined; d.dataset.dirty = ''; d.close(); return Viewer.open({ path: RulesUI.data.gemini.path, cwd: RulesUI.cwd }); }
    if (act === 'save') return saveRules();
    if (act === 'copy') return copyTool(b.dataset.name, b.dataset.to);
    return undefined;
  }));
  d.addEventListener('input', e => { if (e.target.id === 'rdText') d.dataset.dirty = '1'; });
  d.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); closeRules(); } });
  d.addEventListener('cancel', e => { if (e.cancelable) { e.preventDefault(); closeRules(); } });
  return d;
}

// cwd: a project's folder, or nothing for the rules every project gets.
async function openRules(cwd = null, tab = 'rules') {
  const d = rulesDialog();
  Object.assign(RulesUI, { cwd: cwd || null, tab, data: null, tools: null });
  d.dataset.dirty = '';
  if (!d.open) d.showModal();
  return loadRules();
}
async function rulesDirty() {
  return $('rulesDlg').dataset.dirty && !(await appConfirm('Discard your changes to the rules?\n\nThey haven’t been saved.', { ok: 'Discard', cancel: 'Keep editing', danger: true }));
}
async function closeRules() {
  if ($('confirmDlg')?.open) return;
  if (await rulesDirty()) return;
  $('rulesDlg').dataset.dirty = '';
  $('rulesDlg').close();
}
async function loadRules() {
  const q = RulesUI.cwd ? `?cwd=${encodeURIComponent(RulesUI.cwd)}` : '';
  renderRules();
  const [rules, tools] = await Promise.all([api(`/api/rules${q}`), api(`/api/tools${q}`).catch(err => ({ error: err.message, servers: [] }))]);
  RulesUI.data = rules; RulesUI.tools = tools;
  // Start from whichever has words in it (CLAUDE.md if both do).
  RulesUI.from = ['claude', 'codex', ...ruleTargets().slice(2)].find(k => rules[k].exists && rules[k].text.trim()) || 'claude';
  renderRules();
}

const projName = cwd => (S.projects.find(p => p.cwd === cwd) || {}).name || base(cwd);
function renderRules() {
  const d = $('rulesDlg'); if (!d) return;
  for (const t of d.querySelectorAll('[data-rdtab]')) t.setAttribute('aria-selected', String(t.dataset.rdtab === RulesUI.tab));
  const where = RulesUI.cwd ? `for ${projName(RulesUI.cwd)}` : 'for every project';
  $('rdTitle').textContent = `Rules and tools ${where}`;
  const box = $('rdBody');
  const scope = `<div class="rd-scope" role="radiogroup" aria-label="Where">${RulesUI.cwd || S.view === 'folder' ? `<button type="button" role="radio" data-rd="scope" data-cwd="${esc(RulesUI.cwd || S.folder || '')}" aria-checked="${!!RulesUI.cwd}">${esc(projName(RulesUI.cwd || S.folder))}</button>` : ''}<button type="button" role="radio" data-rd="scope" data-cwd="" aria-checked="${!RulesUI.cwd}">Every project</button></div>`;
  if (RulesUI.tab === 'tools') { box.innerHTML = scope + toolsHtml(); return; }
  const r = RulesUI.data;
  if (!r) { box.innerHTML = `${scope}<p class="loading">Reading…</p>`; return; }
  const targets = ruleTargets();
  const whom = rulesGemini() ? 'all three' : 'both';
  const reads = RulesUI.cwd && rulesGemini() ? 'Claude reads <code>CLAUDE.md</code>; Codex and Gemini read <code>AGENTS.md</code>.'
    : targets.length > 2 ? 'Claude reads <code>CLAUDE.md</code>, Codex <code>AGENTS.md</code> and Gemini <code>GEMINI.md</code>, each in its own folder.'
    : 'Claude reads <code>CLAUDE.md</code> and Codex reads <code>AGENTS.md</code>.';
  // A project's own GEMINI.md comes on top of AGENTS.md, for Gemini alone.
  const extra = RulesUI.cwd && rulesGemini() && r.gemini && r.gemini.exists ? `<p class="rd-state">This project also has a <b>GEMINI.md</b>, which only Gemini reads, on top of these. <button type="button" class="linkish" data-rd="gemfile">Open it</button></p>` : '';
  box.innerHTML = `${scope}
    <p class="rd-intro">${reads} Write your rules once: they’re saved to ${targets.length > 2 || !rulesGemini() ? whom : 'both files'}, so ${whom} work the same way${RulesUI.cwd ? ' in this project' : ' everywhere'}.</p>
    <p class="rd-state" id="rdState"></p>${extra}
    <textarea id="rdText" class="rd-text" spellcheck="false" placeholder="${RulesUI.cwd ? 'How this project works: how to run and test it, conventions, what not to touch…' : 'How you like to work, in every project: style, tone, tools, what to always or never do…'}"></textarea>
    <div class="d-row"><span class="rd-paths">${targets.map(k => esc(r[k].path)).join('<br>')}</span><span class="spacer"></span><button class="btn" data-rd="close">Close</button><button class="btn prime" data-rd="save">Save to ${targets.length > 2 ? 'all three' : 'both'}</button></div>`;
  // Back from the Tools tab: what you were writing is still there, unsaved.
  const draft = RulesUI.draft; RulesUI.draft = null;
  $('rdText').value = draft ? draft.text : r[RulesUI.from].text;
  d.dataset.dirty = draft ? draft.dirty : '';
  renderRulesState();
}
function renderRulesState() {
  const r = RulesUI.data, el = $('rdState'); if (!r || !el) return;
  const lines = t => { const n = t.trim() ? t.trim().split('\n').length : 0; return `${n} line${n === 1 ? '' : 's'}`; };
  const targets = ruleTargets(), three = targets.length > 2;
  const words = t => t.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const have = targets.filter(k => r[k].exists);
  const names = list => andList(list.map(k => `<b>${RULE_FILE[k]}</b>`));
  // In a project, Gemini reads what Codex reads.
  const who = k => (k === 'codex' && RulesUI.cwd && rulesGemini() ? 'Codex and Gemini' : RULE_WHO[k]);
  const agree = have.every(k => words(r[k].text) === words(r[have[0]].text));
  let html, cls = 'ok';
  if (have.length === targets.length && agree) html = `✓ ${names(targets)} say the same thing.`;
  else if (!have.length) { html = three ? 'None of these files exists yet. Saving creates all three.' : 'Neither file exists yet. Saving creates both.'; cls = ''; }
  else if (agree) { html = `Only ${names(have)} ${have.length > 1 ? 'exist' : 'exists'}, so only ${andList(have.map(who))} ${have.length > 1 || who(have[0]).includes(' and ') ? 'have' : 'has'} these rules. Saving gives them to ${three ? 'all three' : 'both'}.`; cls = 'warn'; }
  else {
    cls = 'warn';
    const others = have.filter(k => k !== RulesUI.from);
    html = `They’re different. You’re looking at <b>${RULE_FILE[RulesUI.from]}</b> (${lines(r[RulesUI.from].text)}); saving puts this text in ${three ? 'all three' : 'both'}. ${others.map(k => `<button type="button" class="linkish" data-rd="from" data-from="${k}">Start from ${RULE_FILE[k]} instead</button> (${lines(r[k].text)})`).join(' ')}`;
  }
  el.className = `rd-state ${cls}`;
  el.innerHTML = html;
}
async function saveRules() {
  const targets = ruleTargets();
  const r = await api('/api/rules', { cwd: RulesUI.cwd, text: $('rdText').value, to: targets });
  RulesUI.data = r; RulesUI.from = 'claude';
  $('rulesDlg').dataset.dirty = '';
  renderRulesState();
  toast(`Saved to ${andList(targets.map(k => RULE_FILE[k]))}${RulesUI.cwd ? ` in ${projName(RulesUI.cwd)}` : ''}. New messages use them; ${rulesGemini() ? 'each reads them' : 'Claude Code and Codex read them'} when a chat starts.`, 6000);
}

/* ---------- tools ---------- */
const scopeName = { user: 'yours', local: 'this project, yours only', project: 'this project (.mcp.json)' };
function toolsHtml() {
  const t = RulesUI.tools;
  if (!t) return `<p class="loading">Asking ${rulesGemini() ? 'each of them' : 'Claude Code and Codex'} which tools they have…</p>`;
  const gem = !!t.geminiOn;
  const runs = v => (v.transport === 'http' ? v.url : [v.command, ...v.args].filter(Boolean).join(' '));
  const cell = (v, own) => (!v ? '<span class="rd-no">—</span>'
    : `<span class="rd-yes ${own && v.enabled === false ? 'off' : ''}">✓ ${esc(own ? (v.enabled === false ? 'turned off' : v.own ? 'built in' : 'yours') : scopeName[v.scope] || v.scope)}</span>`);
  const action = r => {
    const lacking = ['claude', 'codex', ...(gem ? ['gemini'] : [])].filter(k => !r[k]);
    if (!lacking.length) return `<span class="rd-both">${gem ? 'All three have it' : 'Both have it'}</span>`;
    if (r.codex && r.codex.own) return '<span class="rd-note">Part of Codex</span>';
    return lacking.map(to => (to === 'codex' && !t.codexOn ? '<span class="rd-note">Codex is off</span>'
      : `<button type="button" class="btn sm" data-rd="copy" data-name="${esc(r.name)}" data-to="${to}"${window.REMOTE ? ' disabled title="Only on the PC"' : ''}>Add to ${RULE_WHO[to]}</button>`)).join(' ');
  };
  return `<p class="rd-intro">The tools (MCP servers) each one can use. Add a tool to ${gem ? 'another' : 'the other'} in a click: it’s set up for all your projects, with the same settings.</p>
    ${t.codexError ? `<p class="rd-state warn">Codex didn’t say which tools it has: ${esc(t.codexError)}</p>` : ''}
    ${t.servers.length ? `<table class="rd-tools"><thead><tr><th>Tool</th><th>Claude</th><th>Codex</th>${gem ? '<th>Gemini</th>' : ''}<th></th></tr></thead><tbody>${t.servers.map(r => {
      const v = r.claude || r.codex || r.gemini;
      return `<tr><td><b>${esc(r.name)}</b><small title="${esc(runs(v))}">${esc(v.transport === 'http' ? 'web' : 'runs')} ${esc(runs(v))}</small></td><td>${cell(r.claude)}</td><td>${cell(r.codex, true)}</td>${gem ? `<td>${cell(r.gemini, true)}</td>` : ''}<td>${action(r)}</td></tr>`;
    }).join('')}</tbody></table>` : `<p class="rd-state">${gem ? 'None of them has' : 'Neither has'} any tools set up yet.</p>`}`;
}
async function copyTool(name, to) {
  const r = RulesUI.tools.servers.find(x => x.name === name); if (!r) return;
  const v = r.claude || r.codex || r.gemini;
  const target = to === 'claude' ? 'Claude Code' : RULE_WHO[to];
  const what = v.transport === 'http' ? `It connects to ${v.url}.` : `It runs ${[v.command, ...v.args].join(' ')}.`;
  const settings = v.envNames.length ? `\n\nIts settings (${v.envNames.join(', ')}) are copied as they are.` : '';
  if (!(await appConfirm(`Add ${name} to ${target}?\n\n${what}${settings} ${target} will have it in every project.`, { ok: `Add to ${RULE_WHO[to]}` }))) return;
  const res = await api('/api/tools/copy', { name, to, cwd: RulesUI.cwd });
  RulesUI.tools = res;
  renderRules();
  toast(`${name} is now in ${target}.${to === 'codex' && v.transport === 'http' ? ` If it needs a sign-in, run “codex mcp login ${name}” in a terminal.` : ' New chats can use it.'}`, 7000);
}
