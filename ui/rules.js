'use strict';
/* Rules and tools: one set for both assistants. Claude reads CLAUDE.md and Codex reads AGENTS.md, so
   the rules are written once and saved to both; the Tools tab shows each one's MCP servers side by
   side, and copies one to the other. For a project, or (no project) for every project. */

const RulesUI = { cwd: null, tab: 'rules', data: null, tools: null, from: 'claude' };

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
    const tab = e.target.closest('[data-rdtab]'); if (tab) { RulesUI.tab = tab.dataset.rdtab; return renderRules(); }
    const b = e.target.closest('[data-rd]'); if (!b) return undefined;
    const act = b.dataset.rd;
    if (act === 'close') return closeRules();
    if (act === 'scope') { if (await rulesDirty()) return undefined; RulesUI.cwd = b.dataset.cwd || null; RulesUI.data = RulesUI.tools = null; return loadRules(); }
    if (act === 'from') { RulesUI.from = b.dataset.from; $('rdText').value = RulesUI.data[RulesUI.from].text; d.dataset.dirty = ''; return renderRulesState(); }
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
  RulesUI.from = rules.claude.exists && rules.claude.text.trim() ? 'claude' : rules.codex.exists && rules.codex.text.trim() ? 'codex' : 'claude';
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
  box.innerHTML = `${scope}
    <p class="rd-intro">Claude reads <code>CLAUDE.md</code> and Codex reads <code>AGENTS.md</code>. Write your rules once: they’re saved to both, so both work the same way${RulesUI.cwd ? ' in this project' : ' everywhere'}.</p>
    <p class="rd-state" id="rdState"></p>
    <textarea id="rdText" class="rd-text" spellcheck="false" placeholder="${RulesUI.cwd ? 'How this project works: how to run and test it, conventions, what not to touch…' : 'How you like to work, in every project: style, tone, tools, what to always or never do…'}"></textarea>
    <div class="d-row"><span class="rd-paths">${esc(r.claude.path)}<br>${esc(r.codex.path)}</span><span class="spacer"></span><button class="btn" data-rd="close">Close</button><button class="btn prime" data-rd="save">Save to both</button></div>`;
  $('rdText').value = r[RulesUI.from].text;
  d.dataset.dirty = '';
  renderRulesState();
}
function renderRulesState() {
  const r = RulesUI.data, el = $('rdState'); if (!r || !el) return;
  const lines = t => { const n = t.trim() ? t.trim().split('\n').length : 0; return `${n} line${n === 1 ? '' : 's'}`; };
  let html, cls = 'ok';
  if (r.same) html = '✓ <b>CLAUDE.md</b> and <b>AGENTS.md</b> say the same thing.';
  else if (!r.claude.exists && !r.codex.exists) { html = 'Neither file exists yet. Saving creates both.'; cls = ''; }
  else if (!r.claude.exists || !r.codex.exists) { const has = r.claude.exists ? 'CLAUDE.md' : 'AGENTS.md'; html = `Only <b>${has}</b> exists, so only ${has === 'CLAUDE.md' ? 'Claude' : 'Codex'} has these rules. Saving gives them to both.`; cls = 'warn'; }
  else {
    cls = 'warn';
    const other = RulesUI.from === 'claude' ? 'codex' : 'claude';
    html = `They’re different. You’re looking at <b>${RulesUI.from === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}</b> (${lines(r[RulesUI.from].text)}); saving puts this text in both. <button type="button" class="linkish" data-rd="from" data-from="${other}">Start from ${other === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'} instead</button> (${lines(r[other].text)})`;
  }
  el.className = `rd-state ${cls}`;
  el.innerHTML = html;
}
async function saveRules() {
  const r = await api('/api/rules', { cwd: RulesUI.cwd, text: $('rdText').value, to: ['claude', 'codex'] });
  RulesUI.data = r; RulesUI.from = 'claude';
  $('rulesDlg').dataset.dirty = '';
  renderRulesState();
  toast(`Saved to CLAUDE.md and AGENTS.md${RulesUI.cwd ? ` in ${projName(RulesUI.cwd)}` : ''}. New messages use them; Claude Code and Codex read them when a chat starts.`, 6000);
}

/* ---------- tools ---------- */
const scopeName = { user: 'yours', local: 'this project, yours only', project: 'this project (.mcp.json)' };
function toolsHtml() {
  const t = RulesUI.tools;
  if (!t) return '<p class="loading">Asking Claude Code and Codex which tools they have…</p>';
  const runs = v => (v.transport === 'http' ? v.url : [v.command, ...v.args].filter(Boolean).join(' '));
  const cell = (v, codex) => (!v ? '<span class="rd-no">—</span>'
    : `<span class="rd-yes ${codex && v.enabled === false ? 'off' : ''}">✓ ${esc(codex ? (v.enabled === false ? 'turned off' : v.own ? 'built in' : 'yours') : scopeName[v.scope] || v.scope)}</span>`);
  const action = r => {
    if (r.claude && r.codex) return '<span class="rd-both">Both have it</span>';
    if (r.codex && r.codex.own) return '<span class="rd-note">Part of Codex</span>';
    const to = r.claude ? 'codex' : 'claude';
    if (to === 'codex' && !t.codexOn) return '<span class="rd-note">Codex is off</span>';
    return `<button type="button" class="btn sm" data-rd="copy" data-name="${esc(r.name)}" data-to="${to}"${window.REMOTE ? ' disabled title="Only on the PC"' : ''}>Add to ${to === 'codex' ? 'Codex' : 'Claude'}</button>`;
  };
  return `<p class="rd-intro">The tools (MCP servers) each one can use. Add a tool to the other in a click: it’s set up for all your projects, with the same settings.</p>
    ${t.codexError ? `<p class="rd-state warn">Codex didn’t say which tools it has: ${esc(t.codexError)}</p>` : ''}
    ${t.servers.length ? `<table class="rd-tools"><thead><tr><th>Tool</th><th>Claude</th><th>Codex</th><th></th></tr></thead><tbody>${t.servers.map(r => {
      const v = r.claude || r.codex;
      return `<tr><td><b>${esc(r.name)}</b><small title="${esc(runs(v))}">${esc(v.transport === 'http' ? 'web' : 'runs')} ${esc(runs(v))}</small></td><td>${cell(r.claude)}</td><td>${cell(r.codex, true)}</td><td>${action(r)}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="rd-state">Neither has any tools set up yet.</p>'}`;
}
async function copyTool(name, to) {
  const r = RulesUI.tools.servers.find(x => x.name === name); if (!r) return;
  const v = r.claude || r.codex;
  const target = to === 'codex' ? 'Codex' : 'Claude Code';
  const what = v.transport === 'http' ? `It connects to ${v.url}.` : `It runs ${[v.command, ...v.args].join(' ')}.`;
  const settings = v.envNames.length ? `\n\nIts settings (${v.envNames.join(', ')}) are copied as they are.` : '';
  if (!(await appConfirm(`Add ${name} to ${target}?\n\n${what}${settings} ${target} will have it in every project.`, { ok: `Add to ${to === 'codex' ? 'Codex' : 'Claude'}` }))) return;
  const res = await api('/api/tools/copy', { name, to, cwd: RulesUI.cwd });
  RulesUI.tools = res;
  renderRules();
  toast(`${name} is now in ${target}.${to === 'codex' && v.transport === 'http' ? ` If it needs a sign-in, run “codex mcp login ${name}” in a terminal.` : ' New chats can use it.'}`, 7000);
}
