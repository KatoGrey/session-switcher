'use strict';
/* Playtest: an agent plays a Voyage world in the browser beside its chat, toward a goal you set, and writes a report
   into the project's playtests/ folder (lib/playtest.js). Opened from a Voyage project's page (its Playtest button),
   Ctrl+K ("Playtest a Voyage world…") and an open chat's ⋯ menu ("Playtest…", which can run it in that chat). */

const PT = { looks: {}, cwd: null, key: null, view: null, patch: null, chip: null };

// Whether a project looks like a Voyage world (the server reads its files once in a while): its page shows the
// Playtest button once that's known.
function ptLook(cwd, fresh = false) {
  const had = PT.looks[cwd];
  if (had && (had.loading || (!fresh && Date.now() - had.at < 5 * 60e3))) return;
  PT.looks[cwd] = { voyage: !!(had && had.voyage), loading: true, at: Date.now() };
  api(`/api/playtest?cwd=${encodeURIComponent(cwd)}`).then(v => {
    const was = had && had.voyage;
    PT.looks[cwd] = { voyage: !!(v && v.voyage), at: Date.now() };
    if (!!was !== PT.looks[cwd].voyage && S.view === 'folder' && S.folder === cwd && typeof renderFolder === 'function') renderFolder();
  }).catch(() => { PT.looks[cwd] = { voyage: false, at: Date.now() }; });
}
// The button on a project's page (not in Imperial and Rebel, whose page stays as it is: Ctrl+K and ⋯ have it there).
function playtestBtn(p) {
  if (!p || !p.exists) return '';
  const k = PT.looks[p.cwd];
  if (!k || (!k.loading && Date.now() - k.at > 5 * 60e3)) ptLook(p.cwd);
  return k && k.voyage && !(typeof sagaLook === 'function' && sagaLook()) ? `<button class="btn quiet" data-playtest="${esc(p.cwd)}" title="An agent plays this world in the browser, toward a goal you set, and writes a report"><span class="glyph" aria-hidden="true">▶</span>Playtest</button>` : '';
}
const ptLooksVoyage = cwd => !!(PT.looks[cwd] && PT.looks[cwd].voyage);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-playtest]'); if (!b) return;
  openPlaytest({ cwd: b.dataset.playtest });   // (errors are said in a toast)
});

/* ---------- the sheet ---------- */
const PT_TURNS = [[5, '5'], [10, '10'], [20, '20'], ['goal', 'Until the goal is answered']];
function ptDialog() {
  let d = $('ptDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="ptDlg" class="wide pt-dlg" aria-labelledby="ptTitle"><form method="dialog" id="ptForm">
    <div class="setup-head"><h3 id="ptTitle">Playtest</h3><button type="button" class="icon" data-pt="close" aria-label="Close">✕</button></div>
    <div class="tk-body pt-body">
      <p class="rd-intro">An agent plays the world in the browser beside its chat, works toward your goal, and writes a report to <code>playtests</code> in the project.</p>
      <p class="pt-warn" id="ptWarn" hidden></p>
      <label class="tk-prompt" id="ptProjWrap">Project<select id="ptProj"></select></label>
      <div class="pt-quick" id="ptQuick"></div>
      <label class="tk-prompt">World link<input type="url" id="ptUrl" required placeholder="https://voyage.io/world/…" autocomplete="off" spellcheck="false"></label>
      <div class="pt-links" id="ptLinks"></div>
      <label class="tk-prompt">What should it find out?<textarea id="ptGoal" rows="3" required placeholder="The goal: what you want to know about this world, in your words."></textarea></label>
      <div class="chips pt-chips" id="ptChips" role="group" aria-label="Quick starts for the goal"></div>
      <p class="pt-note" id="ptPatch" hidden></p>
      <fieldset class="pt-specs"><legend class="lt-h">Specs</legend>
        <div class="pt-line" role="radiogroup" aria-label="Turns to play"><span class="lt-k">Turns to play</span><span id="ptTurns"></span></div>
        <div class="pt-grid">
          <label class="tk-prompt">Opening<input id="ptOpening" placeholder="Any" autocomplete="off" maxlength="120"></label>
          <label class="tk-prompt">Character<select id="ptCharKind"><option value="random">A new random one</option><option value="saved">A saved character…</option></select></label>
          <label class="tk-prompt" id="ptCharWrap" hidden>Saved character’s name<input id="ptCharName" autocomplete="off" maxlength="120"></label>
          <label class="tk-prompt">Player style<select id="ptStyle"></select></label>
          <label class="tk-prompt" id="ptStyleWrap" hidden>How they play<input id="ptStyleText" placeholder="For example: a cautious healer who avoids fights" maxlength="600"></label>
        </div>
        <div class="pt-line" role="radiogroup" aria-label="Screen"><span class="lt-k">Screen</span><label class="lt-chip"><input type="radio" name="ptScreen" value="desktop" checked> Desktop</label><label class="lt-chip"><input type="radio" name="ptScreen" value="phone"> Phone size</label></div>
        <label class="toggle"><input type="checkbox" id="ptStop" checked><span><b>Stop and ask me if something looks broken</b><span>Otherwise it notes it, tries once to get past it, and carries on.</span></span></label>
        <label class="toggle"><input type="checkbox" id="ptPics"><span><b>Take pictures of key moments</b><span>The start, big moments, anything broken. Costs more than reading the story as text.</span></span></label>
        <div class="pt-line" role="group" aria-label="What to report"><span class="lt-k">What to report</span><span id="ptReport"></span></div>
        <label class="tk-prompt">Extra instructions<textarea id="ptExtra" rows="2" placeholder="Anything else: what to focus on, what to skip."></textarea></label>
      </fieldset>
      <div class="lt-row pt-who" id="ptWhoRow"><div class="who-fields" id="ptWho"></div></div>
      <div class="pt-line" id="ptWhereRow" role="radiogroup" aria-label="Where" hidden><span class="lt-k">Where</span><label class="lt-chip"><input type="radio" name="ptWhere" value="new" checked> A new chat</label><label class="lt-chip"><input type="radio" name="ptWhere" value="this"> This chat</label></div>
      <pre class="pt-brief" id="ptBrief" hidden></pre>
      <div class="d-row pt-acts"><button type="button" class="btn quiet" data-pt="preset">Save as preset…</button><button type="button" class="btn quiet" data-pt="brief">See the brief</button><span class="spacer"></span><button type="button" class="btn" data-pt="close">Cancel</button><button type="submit" class="btn prime" id="ptGo">Start playtest</button></div>
    </div></form></dialog>`);
  d = $('ptDlg');
  $('ptTurns').innerHTML = PT_TURNS.map(([v, l]) => `<label class="lt-chip"><input type="radio" name="ptTurns" value="${v}"> ${l}</label>`).join('');
  d.addEventListener('click', wrap(ptClick));
  d.addEventListener('change', e => {
    if (e.target.id === 'ptCharKind') ptSync();
    if (e.target.id === 'ptStyle') ptSync();
    if (e.target.name === 'ptWhere') ptSync();
    if (e.target.id === 'ptProj') wrap(async () => { PT.cwd = $('ptProj').value; await ptLoad(); ptFill(null); })();
  });
  d.addEventListener('input', e => { if (e.target.id === 'ptUrl') ptRenderLinks(); $('ptBrief').hidden = true; });
  $('ptForm').addEventListener('submit', e => { e.preventDefault(); wrap(ptStart)(); });
  return d;
}
async function ptLoad(fresh = false) {
  PT.view = await api(`/api/playtest?cwd=${encodeURIComponent(PT.cwd)}${fresh ? '&fresh=1' : ''}`);
  PT.looks[PT.cwd] = { voyage: !!PT.view.voyage, at: Date.now() };
}
// Who plays to begin with: as new chats in this project start (the new-chat sheet's memory), else Claude as the
// account in use.
function ptWhoStart(cwd, saved) {
  if (saved && saved.provider) return { who: saved.provider === 'gemini' ? 'gemini' : `${saved.provider}:${saved.account || 'room'}`, model: saved.model || '', effort: saved.effort || '' };
  const m = typeof ncMemo === 'function' ? ncMemo(cwd) : null;
  const prov = (m && m.prov) || store('nc-prov') || 'claude';
  let model = (m && m.model) || '';
  if (/^(quick|balanced|deep|max)$/.test(model)) model = `preset:${model}`;
  const as = m && m.as ? (m.as === ':room' ? 'room' : m.as) : null;
  const who = prov === 'gemini' ? 'gemini' : as ? `${prov}:${as}` : prov === 'claude' && canLaunch(current()) ? `claude:${S.acct}` : Who.pickFor(prov);
  return { who, model, effort: (m && m.effort) || '' };
}
// The form, filled in from a spec (a preset's, a run's), or as a fresh one.
function ptFill(spec, who = null) {
  const v = PT.view || {};
  const s = spec || {};
  $('ptUrl').value = s.url || v.last || '';
  $('ptGoal').value = s.goal || '';
  PT.chip = s.chip || null;
  PT.patch = s.patchNotes && s.patchNotes.length ? s.patchNotes.slice() : null;
  const turns = String(s.turns || 10);
  for (const r of document.querySelectorAll('[name="ptTurns"]')) r.checked = r.value === turns;
  if (!document.querySelector('[name="ptTurns"]:checked')) document.querySelector('[name="ptTurns"][value="10"]').checked = true;
  $('ptOpening').value = s.opening || '';
  $('ptCharKind').value = s.character && s.character.kind === 'saved' ? 'saved' : 'random';
  $('ptCharName').value = (s.character && s.character.name) || '';
  $('ptStyle').innerHTML = (v.styles || []).map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('') + '<option value="custom">Your own…</option>';
  $('ptStyle').value = s.style || 'new';
  $('ptStyleText').value = s.styleText || '';
  for (const r of document.querySelectorAll('[name="ptScreen"]')) r.checked = r.value === (s.screen || 'desktop');
  $('ptStop').checked = s.stopAsk !== false;
  $('ptPics').checked = !!s.pictures;
  const rep = s.report || ['bugs', 'rules', 'pacing'];
  $('ptReport').innerHTML = (v.reports || []).map(x => `<label class="lt-chip"><input type="checkbox" value="${esc(x.id)}"${rep.includes(x.id) ? ' checked' : ''}> ${esc(x.label)}</label>`).join('');
  $('ptExtra').value = s.extra || '';
  // Who can play: the ones with a browser here (Gemini has none; your Chrome's extension is Claude's alone).
  const can = (PT.view && PT.view.browser) === 'chrome' ? ['claude'] : ['claude', 'codex'];
  const start = ptWhoStart(PT.cwd, who);
  if (!can.some(p => String(start.who).startsWith(p))) Object.assign(start, { who: canLaunch(current()) ? `claude:${S.acct}` : Who.pickFor('claude'), model: '', effort: '' });
  Who.mount($('ptWho'), { value: start, providers: can, labels: { who: 'Who plays' } });
  $('ptBrief').hidden = true;
  ptRenderQuick(); ptRenderLinks(); ptRenderChips(); ptSync();
}
function ptSync() {
  $('ptCharWrap').hidden = $('ptCharKind').value !== 'saved';
  $('ptStyleWrap').hidden = $('ptStyle').value !== 'custom';
  const here = !!PT.key && document.querySelector('[name="ptWhere"]:checked')?.value === 'this';
  $('ptWhereRow').hidden = !PT.key;
  $('ptWhoRow').hidden = here;
  const v = PT.view || {};
  const off = v.browser === 'off';
  $('ptWarn').hidden = !off && v.browser !== 'chrome';
  $('ptWarn').textContent = off ? 'Chats don’t get a browser now: Setup → Browser is set to Off. Turn it on to playtest.' : v.browser === 'chrome' ? 'It plays in Chrome, with Claude in Chrome, as Setup → Browser says.' : '';
  $('ptWarn').classList.toggle('bad', off);
  $('ptGo').disabled = off;
  const p = v.patchNotes, files = PT.patch || [];
  $('ptPatch').hidden = !files.length;
  if (files.length) $('ptPatch').innerHTML = `It reads <code>${esc(files[0])}</code>${files.length > 1 ? ` and ${files.length - 1} more from the same update` : ''} first, and tests what changed.${p && p.newest !== files[0] ? ' (Newer patch notes are here now.)' : ''}`;
}
const ptShortUrl = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
function ptRenderLinks() {
  const v = PT.view || {}, cur = $('ptUrl').value.trim();
  const saved = (v.links || []).map(l => `<span class="pt-link${l.url === cur ? ' on' : ''}"><button type="button" class="chip" data-pt-url="${esc(l.url)}" title="${esc(l.url)}">${esc(l.label || ptShortUrl(l.url))}</button><button type="button" class="icon pt-mini" data-pt-label="${esc(l.url)}" aria-label="Name this link" title="Name it">✎</button><button type="button" class="icon pt-mini" data-pt-forget="${esc(l.url)}" aria-label="Forget this link" title="Forget it">✕</button></span>`).join('');
  const found = (v.found || []).filter(l => l.url !== cur || !(v.links || []).some(x => x.url === cur)).slice(0, 3).map(l => `<button type="button" class="linkish" data-pt-url="${esc(l.url)}" title="In ${esc(l.file)}">${esc(ptShortUrl(l.url))}</button>`).join(', ');
  const isNew = /^https?:\/\/\S+\.\S+/i.test(cur) && !(v.links || []).some(l => l.url === cur || l.url === `${cur}/`);
  $('ptLinks').innerHTML = (saved ? `<div class="pt-saved">${saved}</div>` : '')
    + (found ? `<p class="pt-note">Found in this project’s files: ${found}</p>` : '')
    + (isNew ? '<p class="pt-note"><button type="button" class="linkish" data-pt="name-new">Save this link with a name…</button> (like “Live” or “Test version”)</p>' : '');
}
function ptRenderChips() {
  const v = PT.view || {};
  $('ptChips').innerHTML = (v.chips || []).map(c => {
    const off = c.id === 'patch' && !v.patchNotes;
    return `<button type="button" class="chip${PT.chip === c.id ? ' on' : ''}" data-pt-chip="${esc(c.id)}"${off ? ' disabled title="No PATCH-NOTES or CHANGELOG .md file in this project’s folder"' : ''} aria-pressed="${PT.chip === c.id}">${esc(c.label)}</button>`;
  }).join('');
}
function ptRenderQuick() {
  const v = PT.view || {};
  const pre = (v.presets || []).map(p => `<li class="pt-q"><span class="pt-q-t"><b>${esc(p.name)}</b><small>${esc(String(p.spec.goal || '').split('\n')[0].slice(0, 90))}</small></span><button type="button" class="btn quiet sm" data-pt-fill="p:${esc(p.id)}">Run again…</button><button type="button" class="btn sm" data-pt-run="p:${esc(p.id)}">Run</button><button type="button" class="icon pt-mini" data-pt-unpreset="${esc(p.id)}" aria-label="Delete the preset ${esc(p.name)}" title="Delete">✕</button></li>`).join('');
  const runs = (v.runs || []).slice(0, 3).map(r => `<li class="pt-q"><span class="pt-q-t"><b>${esc(r.title || 'Playtest')}</b><small><span data-ago="${r.at}">${esc(agoL(r.at))}</span>${r.reportPath ? ` · ${esc(base(r.reportPath))}` : ''}</small></span>${r.sessionId ? `<button type="button" class="btn quiet sm" data-pt-chat="${esc(r.sessionId)}">Its chat</button>` : ''}<button type="button" class="btn quiet sm" data-pt-fill="r:${r.at}">Run again…</button><button type="button" class="btn sm" data-pt-run="r:${r.at}">Run</button></li>`).join('');
  $('ptQuick').innerHTML = (pre ? `<p class="lt-h">Presets</p><ul class="pt-qs">${pre}</ul>` : '') + (runs ? `<p class="lt-h">Recent runs</p><ul class="pt-qs">${runs}</ul>` : '');
  $('ptQuick').hidden = !pre && !runs;
}
const ptPick = id => {
  const v = PT.view || {};
  if (id.startsWith('p:')) { const p = (v.presets || []).find(x => x.id === id.slice(2)); return p && { spec: p.spec }; }
  const r = (v.runs || []).find(x => String(x.at) === id.slice(2)); return r && { spec: r.spec, who: r.who };
};
// What the form says, as a spec (the server checks it again).
function ptSpec() {
  const turns = document.querySelector('[name="ptTurns"]:checked')?.value || '10';
  return {
    url: $('ptUrl').value.trim(), goal: $('ptGoal').value.trim(),
    turns: turns === 'goal' ? 'goal' : Number(turns),
    opening: $('ptOpening').value.trim(),
    character: $('ptCharKind').value === 'saved' ? { kind: 'saved', name: $('ptCharName').value.trim() } : { kind: 'random' },
    style: $('ptStyle').value, ...($('ptStyle').value === 'custom' ? { styleText: $('ptStyleText').value.trim() } : {}),
    screen: document.querySelector('[name="ptScreen"]:checked')?.value || 'desktop',
    stopAsk: $('ptStop').checked, pictures: $('ptPics').checked,
    report: [...$('ptReport').querySelectorAll('input:checked')].map(x => x.value),
    extra: $('ptExtra').value.trim(),
    ...(PT.patch && PT.patch.length ? { patchNotes: PT.patch } : {}),
    ...(PT.chip ? { chip: PT.chip } : {}),
  };
}
async function ptClick(e) {
  const d = $('ptDlg');
  if (e.target === d) return d.close();
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const ds = b.dataset;
  if (ds.pt === 'close') return d.close();
  if (ds.ptUrl) { $('ptUrl').value = ds.ptUrl; return ptRenderLinks(); }
  if (ds.ptChip) {
    const c = (PT.view.chips || []).find(x => x.id === ds.ptChip); if (!c) return;
    const had = $('ptGoal').value.trim(), was = (PT.view.chips || []).find(x => x.id === PT.chip);
    // A goal you've written yourself is kept: the quick start goes after it.
    $('ptGoal').value = !had || (was && had === was.goal) ? c.goal : `${had}\n\n${c.goal}`;
    PT.chip = c.id;
    PT.patch = c.id === 'patch' && PT.view.patchNotes ? PT.view.patchNotes.files.slice() : null;
    ptRenderChips(); ptSync();
    $('ptGoal').focus();
    return;
  }
  if (ds.ptLabel || ds.pt === 'name-new') {
    const url = ds.ptLabel || $('ptUrl').value.trim();
    const l = (PT.view.links || []).find(x => x.url === url);
    const label = await ask('Name this link', 'A short name for it, like “Live” or “Test version”.', (l && l.label) || '', 'Save', { maxLength: 60, allowEmpty: true });
    if (label === null) return;
    PT.view = await api('/api/playtest/link', { cwd: PT.cwd, url, label });
    if (!ds.ptLabel) $('ptUrl').value = (PT.view.links.find(x => x.url === url || x.url === `${url}/`) || { url }).url;
    return ptRenderLinks();
  }
  if (ds.ptForget) { PT.view = await api('/api/playtest/link', { cwd: PT.cwd, url: ds.ptForget, forget: true }); return ptRenderLinks(); }
  if (ds.ptUnpreset) {
    if (!(await appConfirm('Delete this preset?', { ok: 'Delete', danger: true }))) return;
    PT.view = await api('/api/playtest/preset', { cwd: PT.cwd, id: ds.ptUnpreset, forget: true });
    return ptRenderQuick();
  }
  if (ds.ptChat) { d.close(); return ChatUI.open({ sessionId: ds.ptChat }); }
  if (ds.ptFill) { const x = ptPick(ds.ptFill); if (x) { ptFill(x.spec, x.who); toast('Filled in. Change anything, then start it.', 2500); } return; }
  if (ds.ptRun) { const x = ptPick(ds.ptRun); if (x) { ptFill(x.spec, x.who); await ptStart(); } return; }
  if (ds.pt === 'preset') {
    const spec = ptSpec();
    if (!spec.url || !spec.goal) return toast('Fill in the world link and the goal first.', 4000);
    const name = await ask('Save as a preset', 'A name for this setup, like “Fights on the test version”. It’s listed at the top of this sheet, for this project.', '', 'Save', { maxLength: 60 });
    if (!name) return;
    PT.view = await api('/api/playtest/preset', { cwd: PT.cwd, name, spec });
    ptRenderQuick();
    return toast(`Saved “${name}”.`, 2500);
  }
  if (ds.pt === 'brief') {
    const pre = $('ptBrief');
    if (!pre.hidden) { pre.hidden = true; b.textContent = 'See the brief'; return; }
    const w = Who.read($('ptWho')) || {};
    const r = await api('/api/playtest/brief', { cwd: PT.cwd, spec: ptSpec(), provider: w.provider });
    pre.textContent = r.brief; pre.hidden = false; b.textContent = 'Hide the brief';
    pre.scrollIntoView({ block: 'nearest' });
  }
}
async function ptStart() {
  const d = $('ptDlg');
  if ($('ptGo').disabled) return;
  const spec = ptSpec();
  if (!spec.url) { $('ptUrl').focus(); throw new Error('Paste the world’s link (from voyage.io) first.'); }
  if (!spec.goal) { $('ptGoal').focus(); throw new Error('Say what it should find out: the goal.'); }
  const here = !!PT.key && document.querySelector('[name="ptWhere"]:checked')?.value === 'this';
  const who = here ? {} : await taskRunOf($('ptWho'));
  $('ptGo').disabled = true;
  try {
    const r = await api('/api/playtest/start', { cwd: PT.cwd, spec, where: here ? 'this' : 'new', key: here ? PT.key : null, ...(here ? {} : { provider: who.provider, account: who.accountId, model: who.model || null, effort: who.effort || null }) });
    PT.looks[PT.cwd] = { voyage: true, at: Date.now() };
    d.close();
    toast(`Playtest started: “${r.title}”. Its report goes to playtests${S.platform === 'win32' ? '\\' : '/'}${base(r.reportPath)}.`, 6000);
    if (r.where === 'new') await ChatUI.openKey(r.key);
    if (S.view === 'folder' && S.folder === PT.cwd && typeof renderFolder === 'function') renderFolder();
  } finally { $('ptGo').disabled = false; ptSync(); }
}
// opts: cwd (the project; else the one you're in, or a Voyage-looking one), key (an open chat it can run in),
// spec (to fill in).
function openPlaytest(opts) { return wrap(ptOpen)(opts); }
async function ptOpen({ cwd = null, key = null, spec = null } = {}) {
  const list = S.projects.filter(p => p.exists !== false);
  if (!list.length) { toast('A playtest runs in a project, and there’s no project yet.', 6000); return; }
  const same = (a, b) => normPath(a).replace(/\/+$/, '') === normPath(b).replace(/\/+$/, '');
  if (cwd && !list.some(p => p.cwd === cwd)) {
    const p = list.find(x => same(x.cwd, cwd));
    if (!p) { toast('This folder isn’t one of your projects, so a playtest can’t write its report there.', 6000); return; }
    cwd = p.cwd;
  }
  const last = p => (typeof projLast === 'function' ? projLast(p) : p.updated || 0);
  const here = cwd || (typeof paletteHere === 'function' ? paletteHere() : null);
  const sorted = list.slice().sort((a, b) => (ptLooksVoyage(b.cwd) - ptLooksVoyage(a.cwd)) || last(b) - last(a));
  const pick = (here && list.find(p => p.cwd === here)) || sorted.find(p => ptLooksVoyage(p.cwd)) || sorted[0];
  const d = ptDialog();
  PT.cwd = pick.cwd; PT.key = key || null;
  $('ptProj').innerHTML = sorted.map(p => `<option value="${esc(p.cwd)}"${p.cwd === PT.cwd ? ' selected' : ''}>${esc(p.name)}${ptLooksVoyage(p.cwd) ? ' · Voyage world' : ''}</option>`).join('');
  // From a project's page or a chat, the project is that one; from Ctrl+K anywhere else, it's yours to choose.
  $('ptProjWrap').hidden = !!(cwd || key);
  await ptLoad();
  for (const r of document.querySelectorAll('[name="ptWhere"]')) r.checked = r.value === 'new';
  ptFill(spec);
  d.showModal();
  ($('ptUrl').value ? $('ptGoal') : $('ptUrl')).focus();
}
window.openPlaytest = openPlaytest;
