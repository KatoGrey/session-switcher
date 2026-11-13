'use strict';
// The app bundles the skill, so every installation has the same review workflow.
function openCrossReview(pr = {}) {
  let d = $('crossReviewDlg');
  if (d) d.remove();
  d = document.createElement('dialog'); d.id = 'crossReviewDlg'; d.className = 'wide xr-dlg';
  d.setAttribute('aria-labelledby', 'xrTitle');
  d.innerHTML = `<form id="xrForm"><div class="setup-head"><h3 id="xrTitle">Cross-model review</h3><button type="button" class="icon" data-xr-close aria-label="Close">✕</button></div>
    <div class="xr-body"><p class="xr-intro">Two perspectives. One considered result.</p><p class="xr-sub">Claude reviews your PR. Codex checks each finding, makes worthwhile fixes, and returns to the same Claude chat until the work is settled.</p>
    <div class="xr-flow" aria-label="Review workflow"><span><b>01</b> Claude reviews</span><i aria-hidden="true">→</i><span><b>02</b> Codex decides</span><i aria-hidden="true">↻</i><span><b>03</b> Re-review</span></div>
    <label class="xr-field">Pull request URL<input name="url" type="url" required autocomplete="off" placeholder="https://github.com/latitudegames/latitude/pull/…" value="${esc(pr.url || '')}"></label>
    ${(pr.clones || []).length > 1 ? `<label class="xr-field">Local folder<select name="cwd">${pr.clones.map(c => `<option value="${esc(c)}"${c === pr.cwd ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
    <label class="xr-field">Your instructions <span>optional</span><textarea name="instructions" rows="3" maxlength="6000" placeholder="What should Codex pay particular attention to?"></textarea></label>
    <details class="xr-options"><summary>Claude model and effort <span>CLI defaults</span></summary><div class="xr-picks"><label class="xr-field">Model<input name="model" maxlength="100" placeholder="Use CLI default"></label><label class="xr-field">Effort<input name="effort" maxlength="100" placeholder="Use CLI default"></label></div><p>Leave these empty to keep Claude’s defaults. A selection applies to every review turn.</p></details>
    <p class="xr-note">Uses Codex and your Claude CLI sign-in in the repo’s local folder. Codex may edit files. The skill preserves one Claude session, avoids test bloat, and has no fixed round limit.</p>
    <p class="xr-error" role="alert" hidden></p><div class="xr-footer"><span>Bundled skill · cross-model-pr-review</span><button type="button" class="btn quiet" data-xr-close>Cancel</button><button type="submit" class="btn prime">Start review <span aria-hidden="true">↗</span></button></div></div></form>`;
  document.body.appendChild(d);
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
