'use strict';
// Details share the workspace's data and actions. No second PR window or background patch polling.
const WorkDetail = (() => {
  const attrs = p => `data-repo="${esc(p.repo)}" data-n="${p.number}"`;
  const mark = tone => ({ ok: '✓', bad: '!', warn: '!', muted: '—' })[tone] || '—';
  function route(p) {
    const evidence = WorkRecord.summary(p);
    return `<nav class="wk-review-route" aria-label="Review this PR">${[['files', '01', 'Read the changes', p.changedFiles == null ? 'Inspect the patch' : `${p.changedFiles} changed files`], ['threads', '02', 'Review feedback', p.open ? `${p.open} open threads` : 'No open threads'], ['record', '03', 'Keep the evidence', evidence.text]].map(([tab, number, title, hint]) => `<button data-wk="detail-tab" data-value="${tab}"><span class="wk-route-number">${number}</span><span><b>${title}</b><small>${esc(hint)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</nav>`;
  }
  function evidence(p) {
    const s = WorkRecord.summary(p);
    return `<button class="wk-evidence-link" data-wk="detail-tab" data-value="record"><span class="wk-evidence-mark" aria-hidden="true">≡</span><span><b>Review journal</b><small>${esc(s.text)}${s.earlier ? ` · ${s.earlier} from earlier revisions` : ''}</small></span><span aria-hidden="true">→</span></button>`;
  }
  function summary(p, loaded) {
    const gates = loaded ? WorkModel.readiness(p) : [];
    return `${p.state === 'OPEN' ? `<section class="wk-readiness"><div class="wk-section-label"><h3>Before merging</h3><span>GitHub requirements</span></div>${gates.length ? gates.map(g => `<button class="wk-gate" data-wk="detail-tab" data-value="${g.tab}"><span class="wk-gate-mark ${g.tone}" aria-hidden="true">${mark(g.tone)}</span><span>${g.title}</span><b class="${g.tone}">${esc(g.value)}</b></button>`).join('') : '<p class="wk-muted">Reading the current review and check requirements…</p>'}<p class="wk-muted">Review can start while checks run. GitHub makes the final merge decision.</p></section>` : ''}
      ${p.issue ? `<button class="wk-issue-context" data-wk="issue-link" data-id="${esc(p.issue)}"><span>LINEAR ISSUE</span><b>${esc(p.issue)}</b><span aria-hidden="true">→</span></button>` : ''}
      <div class="wk-command-grid"><button class="wk-tool" data-wk="validate" ${attrs(p)}><span>Validate changes…</span><small>Run focused checks for the changed packages</small><span aria-hidden="true">→</span></button><button class="wk-tool" data-wk="handoff" ${attrs(p)}><span>Prepare handoff…</span><small>Draft review notes and verification evidence</small><span aria-hidden="true">→</span></button></div>`;
  }
  function checks(p) {
    const c = p.checks || {}, items = c.items || [];
    const row = x => `<a class="wk-check-row" href="${esc(x.url || p.url + '/checks')}" target="_blank" rel="noopener noreferrer"><span class="${x.state === 'passed' ? 'ok' : x.state === 'failed' ? 'bad' : 'wk-muted'}" aria-hidden="true">${{ passed: '✓', failed: '!', cancelled: '×', skipped: '—', pending: '◷' }[x.state]}</span><span>${esc(x.name)}</span><small>${esc(x.state)}</small><span aria-hidden="true">↗</span></a>`;
    const group = (title, rows, hint) => {
      if (!rows.length) return '';
      const settled = rows.filter(x => x.state === 'passed' || x.state === 'skipped');
      const fold = title !== 'Required' && settled.length > 3;
      const visible = fold ? rows.filter(x => !settled.includes(x)) : rows;
      return `<section class="wk-check-group"><div class="wk-section-label"><h3>${title}</h3><span>${rows.length}</span></div>${hint ? `<p class="wk-muted">${hint}</p>` : ''}${visible.map(row).join('')}${fold ? `<details class="wk-check-settled" data-preserve="${title}"><summary>${settled.length} passed or skipped</summary>${settled.map(row).join('')}</details>` : ''}</section>`;
    };
    const order = x => ({ failed: 0, cancelled: 1, pending: 2, passed: 3, skipped: 4 })[x.state] ?? 5;
    const sorted = [...items].sort((a, b) => order(a) - order(b));
    return `<div class="wk-check-summary"><span class="ok">${c.passed || 0} passed</span><span class="bad">${(c.failed || []).length} failing</span><span>${c.pending || 0} running</span></div>
      ${group('Required', sorted.filter(x => x.required === true), '')}
      ${group('Optional', sorted.filter(x => x.required === false), 'These results help assess the change. They do not replace the required checks.')}
      ${group('Requirements not reported', sorted.filter(x => x.required == null), 'GitHub has not identified which of these checks are required.')}
      ${!items.length ? '<p class="wk-muted">No individual check results were returned. Check GitHub for requirements that have not reported yet.</p>' : ''}
      ${c.complete === false ? '<p class="wk-action-note">This PR has more checks than the summary includes. Open GitHub for the complete list.</p>' : ''}
      ${String(p.repo).toLowerCase() === 'latitudegames/latitude' ? '<p class="wk-action-note">Latitude’s lightweight <code>ci</code> gate checks secrets. It does not prove typecheck, build, or local validation.</p>' : ''}
      <button class="btn" data-wk="validate" ${attrs(p)}>Validate changes…</button> <a class="wk-linked" href="${esc(p.url + '/checks')}" target="_blank" rel="noopener noreferrer">All checks on GitHub ↗</a>`;
  }
  function patch(file, lines = 600) {
    if (file.patch == null) return '<p class="wk-muted wk-patch-empty">GitHub did not provide a text patch for this file. It may be binary or too large. Open the full diff on GitHub.</p>';
    const all = file.patch.split('\n');
    return `<pre class="wk-patch" tabindex="0" aria-label="Patch for ${esc(file.path)}">${all.slice(0, lines).map(line => `<span class="${line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}">${esc(line) || ' '}</span>`).join('')}</pre>${all.length > lines ? `<button class="btn sm" id="wkMoreLines" data-wk="more-lines">Show more lines (${all.length - lines} remaining)</button>` : ''}${file.truncated ? '<p class="wk-muted">Patch excerpt. Open GitHub for the complete diff.</p>' : ''}`;
  }
  function files(p, state) {
    if (!state || (!state.files.length && state.loading)) return '<p class="wk-muted" role="status">Loading changed files for this revision…</p>';
    const error = state.error ? `<p class="wk-error" role="alert">${esc(state.error)} <button class="linkish" data-wk="${state.stale ? 'refresh-detail' : 'load-files'}">${state.stale ? 'Refresh PR' : 'Try again'}</button></p>` : '';
    if (!state.files.length) return error || '<p class="wk-muted">No changed files were returned.</p>';
    const selected = state.files.find(f => f.path === state.selected) || state.files[0];
    const groups = new Map();
    for (const f of state.files) { const area = WorkModel.area(f.path); if (!groups.has(area)) groups.set(area, []); groups.get(area).push(f); }
    const more = state.hasMore ? `<button class="btn sm" data-wk="load-files" ${state.loading ? 'disabled' : ''}>${state.loading ? 'Loading…' : 'Load more files'}</button>` : '';
    const shortPath = (f, area) => f.path.slice(area === 'Repository root' ? 0 : area.length + 1) || f.path.split('/').pop();
    return `${error}<div class="wk-files-meta"><span>${state.files.length} of ${state.total} files</span><span><b class="ok">+${p.additions || 0}</b> <b class="bad">−${p.deletions || 0}</b></span></div><div class="wk-file-mobile"><label for="wkFileSelect">Changed file</label><select id="wkFileSelect">${[...groups].map(([area, rows]) => `<optgroup label="${esc(area)}">${rows.map(f => `<option value="${esc(f.path)}" ${f.path === selected.path ? 'selected' : ''}>${esc(shortPath(f, area))}</option>`).join('')}</optgroup>`).join('')}</select>${more}</div><div class="wk-file-browser"><div class="wk-file-tree" aria-label="Changed files">${[...groups].map(([area, rows]) => `<section><h3>${esc(area)}</h3>${rows.map(f => `<button class="wk-file" data-wk="file" data-path="${esc(f.path)}" title="${esc(f.path)}" aria-pressed="${f.path === selected.path}"><span>${esc(shortPath(f, area))}</span><small><b class="ok">+${f.additions}</b> <b class="bad">−${f.deletions}</b></small></button>`).join('')}</section>`).join('')}${more}</div><div class="wk-file-content"><div class="wk-file-heading"><b>${esc(selected.path)}</b><span>${esc(selected.status)}</span></div>${selected.previousPath ? `<p class="wk-muted">Previously ${esc(selected.previousPath)}</p>` : ''}${patch(selected, state.lines)}<a class="wk-linked" href="${esc(p.url + '/files')}" target="_blank" rel="noopener noreferrer">Full diff on GitHub ↗</a></div></div>${state.limited ? '<p class="wk-action-note">GitHub’s file API covers the first 3,000 files. Use GitHub or a local diff for the rest.</p>' : ''}`;
  }
  return { summary, checks, files, route, evidence };
})();
