'use strict';
// The app bundles the skill, so every installation has the same review workflow.

// The model and effort dropdowns: what each assistant offers (GET /api/work/models, the list Your work's defaults
// use), so a name can't be typed wrong. cur: { claude: { model, effort }, codex: {…} }.
const XR_WHO = [['claude', 'Claude', 'model', 'effort'], ['codex', 'Codex', 'codexModel', 'codexEffort']];
function xrPicksHtml(lists, cur) {
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const opt = (v, t, sel, note = '') => `<option value="${esc(v)}"${sel ? ' selected' : ''}${note ? ` title="${esc(note)}"` : ''}>${esc(t)}</option>`;
  return XR_WHO.map(([prov, name, mName, eName]) => {
    const list = lists && lists[prov], c = cur[prov] || {};
    const models = list ? list.models : [], m = models.find(x => x.value === c.model);
    const efforts = m && m.efforts.length ? m.efforts : (list && list.efforts) || [];
    const mo = [opt('', list && list.defaultModel ? `Default (${list.defaultModel})` : 'Default', !c.model), ...models.map(x => opt(x.value, x.label, x.value === c.model, x.note)), ...(c.model && !m ? [opt(c.model, c.model, true)] : [])];
    const eo = [opt('', list && list.defaultEffort ? `Default (${list.defaultEffort})` : 'Default', !c.effort), ...efforts.map(e => opt(e, cap(e), e === c.effort)), ...(c.effort && !efforts.includes(c.effort) ? [opt(c.effort, cap(c.effort), true)] : [])];
    return `<div class="xr-pick-row" role="group" aria-label="${name}"><span class="xr-pick-who">${name}</span><label class="xr-field">Model<select name="${mName}" data-xr-prov="${prov}" data-xr-what="model"${list || c.model ? '' : ' disabled'}>${mo.join('')}</select></label><label class="xr-field">Effort<select name="${eName}" data-xr-prov="${prov}" data-xr-what="effort"${efforts.length || c.effort ? '' : ' disabled'}>${eo.join('')}</select></label></div>`;
  }).join('');
}
function openCrossReview(pr = {}) {
  let d = $('crossReviewDlg');
  if (d) d.remove();
  d = document.createElement('dialog'); d.id = 'crossReviewDlg'; d.className = 'wide xr-dlg';
  const run = (typeof Work !== 'undefined' && Work.runPrefs ? Work.runPrefs() : null) || { claude: {}, codex: {} };
  let lists = typeof Work !== 'undefined' && Work.modelsFor ? { claude: Work.modelsFor('claude'), codex: Work.modelsFor('codex') } : null;
  if (lists && !lists.claude && !lists.codex) lists = null;
  const chosen = [run.claude.model, run.claude.effort, run.codex.model, run.codex.effort].some(Boolean);
  d.setAttribute('aria-labelledby', 'xrTitle');
  d.innerHTML = `<form id="xrForm"><div class="setup-head"><h3 id="xrTitle">Cross-model review</h3><button type="button" class="icon" data-xr-close aria-label="Close">✕</button></div>
    <div class="xr-body"><p class="xr-intro">Two perspectives. One considered result.</p><p class="xr-sub">Claude reviews your PR. Codex checks each finding, makes worthwhile fixes, and returns to the same Claude chat until the work is settled.</p>
    <div class="xr-flow" aria-label="Review workflow"><span><b>01</b> Claude reviews</span><i aria-hidden="true">→</i><span><b>02</b> Codex decides</span><i aria-hidden="true">↻</i><span><b>03</b> Re-review</span></div>
    <label class="xr-field">Pull request URL<input name="url" type="url" required autocomplete="off" placeholder="https://github.com/latitudegames/latitude/pull/…" value="${esc(pr.url || '')}"></label>
    ${(pr.clones || []).length > 1 ? `<label class="xr-field">Local folder<select name="cwd">${pr.clones.map(c => `<option value="${esc(c)}"${c === pr.cwd ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
    <label class="xr-field">Your instructions <span>optional</span><textarea name="instructions" rows="3" maxlength="6000" placeholder="What should Codex pay particular attention to?"></textarea></label>
    <details class="xr-options"${chosen ? ' open' : ''}><summary>Models and effort <span>${chosen ? 'from Your work' : 'each assistant’s defaults'}</span></summary><div class="xr-picks">${xrPicksHtml(lists, run)}</div><p>Default keeps each assistant’s own. A choice applies to every review turn.</p></details>
    <p class="xr-note">Uses Codex and your Claude CLI sign-in in the repo’s local folder. Codex may edit files. The skill preserves one Claude session, avoids test bloat, and has no fixed round limit.</p>
    <p class="xr-error" role="alert" hidden></p><div class="xr-footer"><span>Bundled skill · cross-model-pr-review</span><button type="button" class="btn quiet" data-xr-close>Cancel</button><button type="submit" class="btn prime">Start review <span aria-hidden="true">↗</span></button></div></div></form>`;
  document.body.appendChild(d);
  const picks = d.querySelector('.xr-picks');
  const now = () => { const f = d.querySelector('form'); return { claude: { model: f.model.value, effort: f.effort.value }, codex: { model: f.codexModel.value, effort: f.codexEffort.value } }; };
  // A model that doesn't offer the chosen effort goes back to its default effort.
  picks.addEventListener('change', e => {
    const sel = e.target.closest('[data-xr-what="model"]'); if (!sel) return;
    const cur = now(), prov = sel.dataset.xrProv, list = lists && lists[prov], m = list && list.models.find(x => x.value === cur[prov].model);
    const efforts = m && m.efforts.length ? m.efforts : (list && list.efforts) || [];
    if (cur[prov].effort && !efforts.includes(cur[prov].effort)) cur[prov].effort = '';
    picks.innerHTML = xrPicksHtml(lists, cur);
    picks.querySelector(`[data-xr-prov="${prov}"][data-xr-what="model"]`)?.focus();
  });
  if (!lists) api('/api/work/models').then(m => { if (!d.isConnected || d.dataset.busy) return; lists = m || {}; picks.innerHTML = xrPicksHtml(lists, now()); }).catch(() => { /* the defaults only */ });
  d.addEventListener('click', e => { if (!d.dataset.busy && (e.target.closest('[data-xr-close]') || e.target === d)) d.close(); });
  d.addEventListener('cancel', e => { if (d.dataset.busy) e.preventDefault(); });
  d.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = d.querySelector('[type=submit]'), err = d.querySelector('.xr-error');
    if (submit.disabled) return;
    err.hidden = true; submit.disabled = true; submit.textContent = 'Starting…'; d.dataset.busy = '1';
    d.querySelectorAll('[data-xr-close]').forEach(b => { b.disabled = true; });
    try {
      const fields = Object.fromEntries(new FormData(e.target));
      const r = await api('/api/prs/act', { action: 'cross-review', ...fields, cwd: fields.cwd || pr.cwd || undefined });
      d.close(); if ($('prDlg')) $('prDlg').close();
      await ChatUI.openKey(r.key);
      if (r.recordWarning) toast(r.recordWarning, 7000);
    } catch (error) { err.textContent = error.message; err.hidden = false; }
    finally { delete d.dataset.busy; submit.disabled = false; submit.textContent = 'Start review ↗'; d.querySelectorAll('[data-xr-close]').forEach(b => { b.disabled = false; }); }
  });
  d.showModal();
}
