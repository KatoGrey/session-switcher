'use strict';
// Notes and launched work stay attached to the revision they describe, on this computer.
const WorkRecord = (() => {
  const kinds = { validate: 'Validation', review: 'Review', 'cross-review': 'Cross-model review', handoff: 'Handoff', 'fix-comments': 'Review fixes', 'fix-checks': 'Check fixes', update: 'Branch update' };
  const outcomes = { started: 'Chat started', passed: 'Passed', failed: 'Needs work', notes: 'Notes only' };
  function parts(p) {
    const entries = p.record || [];
    return { current: entries.filter(e => e.head === p.headSha), earlier: entries.filter(e => e.head !== p.headSha) };
  }
  function summary(p) {
    if (!p.record) return { text: 'Reading saved results', count: 0, earlier: 0 };
    const { current, earlier } = parts(p), results = current.filter(e => e.outcome !== 'started');
    return { text: results.length ? `${results.length} recorded result${results.length === 1 ? '' : 's'}` : current.length ? 'Awaiting a result' : 'No results yet', count: results.length, earlier: earlier.length };
  }
  function render(p) {
    if (!p.record) return '<p class="wk-muted" role="status">Reading the review journal…</p>';
    const { current, earlier } = parts(p);
    const entry = (e, old = false) => `<article class="wk-record-entry${old ? ' earlier' : ''}" data-record-id="${esc(e.id)}">
      <span class="wk-record-node ${!old && e.outcome === 'passed' ? 'ok' : !old && e.outcome === 'failed' ? 'bad' : ''}" aria-hidden="true">${e.outcome === 'passed' ? '✓' : e.outcome === 'failed' ? '!' : '·'}</span>
      <div class="wk-record-line"><h4>${esc(kinds[e.kind] || e.kind)}</h4><span class="wk-record-outcome ${!old && e.outcome === 'passed' ? 'ok' : !old && e.outcome === 'failed' ? 'bad' : ''}">${esc(outcomes[e.outcome])}</span></div>
      <div class="wk-record-meta"><span title="${esc(new Date(e.updatedAt || e.at).toLocaleString())}">${esc(agoL(e.updatedAt || e.at))}</span><span>${e.outcome === 'started' && e.chat ? esc(PROV_NAME[e.chat.provider] || e.chat.provider) + ' chat' : 'Recorded by you'}</span>${old ? `<a href="${esc('https://github.com/' + p.repo + '/commit/' + e.head)}" target="_blank" rel="noopener noreferrer">${esc(e.head.slice(0, 7))} · earlier revision ↗</a>` : ''}</div>
      ${e.notes ? `<p class="wk-record-notes">${esc(e.notes)}</p>` : '<p class="wk-muted">Open the chat to inspect its work, then record the result.</p>'}
      <div class="wk-record-actions">${e.chat ? `<button class="linkish" data-wk="record-chat" data-id="${esc(e.id)}">Open chat ↗</button>` : ''}<button class="linkish" data-wk="record-edit" data-id="${esc(e.id)}">${e.outcome === 'started' ? 'Record result…' : 'Edit result'}</button><button class="linkish wk-record-remove" data-wk="record-remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(kinds[e.kind] || e.kind)} entry">Remove</button></div>
    </article>`;
    return `<section class="wk-journal"><div class="wk-journal-head"><div><p class="wk-eyebrow">REVIEW JOURNAL</p><h3 id="wkRecordTitle" tabindex="-1">Evidence for this revision.</h3></div><button class="btn" data-wk="record-add" ${p.headSha ? '' : 'disabled'}>+ Record result</button></div>
      <div class="wk-record-revision"><div><span>CURRENT REVISION</span><strong>${esc(p.headSha?.slice(0, 7) || 'Unknown')}</strong></div><p>${esc(summary(p).text)}<small>Local evidence · separate from GitHub requirements</small></p></div>
      <div class="wk-record-timeline">${current.length ? current.map(e => entry(e)).join('') : `<div class="wk-record-empty"><span aria-hidden="true">[ — ]</span><h4>No results for this revision.</h4><p>${earlier.length ? 'Earlier work is kept below. Check what the new commits changed before carrying its conclusions forward.' : 'Start validation or review, then save the commands, findings, and anything left unverified.'}</p><button class="btn" data-wk="validate" data-repo="${esc(p.repo)}" data-n="${p.number}">Validate changes…</button></div>`}</div>
      ${earlier.length ? `<details class="wk-record-earlier" data-preserve="earlier-records"><summary>${earlier.length} entr${earlier.length === 1 ? 'y' : 'ies'} from earlier revisions <span>Not evidence for ${esc(p.headSha?.slice(0, 7) || 'this revision')}</span></summary><div class="wk-record-timeline">${earlier.map(e => entry(e, true)).join('')}</div></details>` : ''}
      <p class="wk-muted wk-record-foot">Saved on this PC. Starting or finishing a chat does not mark a check as passed. Notes do not change GitHub or Linear.</p></section>`;
  }
  function edit(p, existing, saved) {
    let d = $('workRecordDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'workRecordDlg'; d.className = 'wide wk-record-dlg'; d.setAttribute('aria-labelledby', 'wrTitle');
    const head = existing?.head || p.headSha;
    d.innerHTML = `<form id="wrForm"><div class="setup-head"><h3 id="wrTitle">${existing ? 'Update' : 'Record'} a result</h3><button type="button" class="icon" data-wr-close aria-label="Close">✕</button></div><div class="wr-body">
      <p class="wr-target"><span>#${p.number}</span><b>${esc(p.title)}</b><code>${esc(head?.slice(0, 7) || '')}</code></p>
      <p class="wk-muted">${head !== p.headSha ? 'This result stays on its earlier revision.' : 'Record only what you checked on this revision.'} The note is saved on this PC.</p>
      <div class="wr-choices"><label>Work<select name="kind">${Object.entries(kinds).map(([value, label]) => `<option value="${value}" ${value === (existing?.kind || 'validate') ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Result<select name="outcome">${['notes', 'passed', 'failed'].map(value => `<option value="${value}" ${value === (existing?.outcome || 'notes') ? 'selected' : ''}>${outcomes[value]}</option>`).join('')}</select></label></div>
      <label class="wr-note">Evidence<textarea name="notes" rows="7" required maxlength="6000" placeholder="Commands run, checks performed, results, and anything left unverified.">${esc(existing?.notes || '')}</textarea></label>
      <p class="wr-error" role="alert" hidden></p><div class="wr-footer"><span>Revision stays attached to this note.</span><button type="button" class="btn quiet" data-wr-close>Cancel</button><button type="submit" class="btn prime">Save to journal</button></div></div></form>`;
    document.body.appendChild(d);
    const opener = document.activeElement;
    d.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); else $('wkRecordTitle')?.focus({ preventScroll: true }); });
    d.addEventListener('click', e => { if (!d.dataset.busy && e.target.closest('[data-wr-close]')) d.close(); });
    d.addEventListener('cancel', e => { if (d.dataset.busy) e.preventDefault(); });
    d.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); if (d.dataset.busy) return;
      const fields = Object.fromEntries(new FormData(e.target)), error = d.querySelector('.wr-error');
      d.dataset.busy = '1'; error.hidden = true; d.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = true; });
      try { const result = await api('/api/prs/record', { repo: p.repo, n: p.number, head, id: existing?.id, ...fields }); saved(result.entry); d.close(); toast('Result saved to this revision.'); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
      finally { delete d.dataset.busy; d.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = false; }); }
    });
    d.showModal(); d.querySelector('textarea').focus();
  }
  return { summary, render, edit };
})();
