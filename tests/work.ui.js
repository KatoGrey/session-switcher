'use strict';
const { sleep } = require('./browser');
const { textAudit } = require('./hub.ui');
// Synthetic Latitude work for repeatable interaction and layout checks.
const repo = 'latitudegames/latitude', now = new Date().toISOString();
const check = (name, state, required) => ({ name, state, required, url: `https://github.com/${repo}/actions/runs/1` });
const checks = items => ({ state: items.some(c => c.state === 'failed') ? 'FAILURE' : items.some(c => c.state === 'pending') ? 'PENDING' : 'SUCCESS',
  items, complete: true, requirementsKnown: true, passed: items.filter(c => c.state === 'passed').length,
  pending: items.filter(c => c.state === 'pending').length, failed: items.filter(c => c.state === 'failed'), cancelled: 0,
  required: { passed: items.filter(c => c.required && c.state === 'passed').length, pending: items.filter(c => c.required && c.state === 'pending').length, failed: items.filter(c => c.required && c.state === 'failed').length } });
const goodChecks = checks([check('ci', 'passed', true), check('pr-policy', 'passed', true), check('size-gate', 'passed', true), check('arc-helper-installed', 'passed', true), check('Typecheck', 'passed', false), ...['Lint', 'Unit tests', 'Build client', 'Build server'].map(name => check(name, 'passed', false))]);
const issue = (n, title, extra = {}) => ({ identifier: `VOY-${n}`, title, url: `https://linear.app/latitudegames/issue/VOY-${n}`, priority: 2, priorityLabel: 'High', state: { name: 'Backlog', type: 'backlog' }, team: { name: 'Voyage' }, updatedAt: now, prs: [], ...extra });
const pr = (number, title, extra = {}) => ({ repo, number, title, url: `https://github.com/${repo}/pull/${number}`, state: 'OPEN', mine: true, roles: ['authored'], author: 'KatoGrey', head: 'tyler/improve-story-flow', headSha: number.toString(16).padEnd(40, 'a'), base: 'internal', checks: goodChecks, open: 0, mergeState: 'BLOCKED', reviewers: ['teammate'], updatedAt: now, ...extra });
const fixture = {
  gh: { installed: true, signedIn: true, login: 'KatoGrey' }, linear: { connected: true, me: { id: 'tyler', name: 'Tyler' } }, at: Date.now(),
  issues: [issue(3012, 'Keep story context when switching characters'), issue(3008, 'Make the adventure summary easier to scan', { priority: 3, priorityLabel: 'Normal' }), issue(2997, 'Remember the selected voice between sessions', { state: { name: 'In progress', type: 'started' } }), issue(2985, 'Allies should defend the correct character', { prs: [{ repo, number: 19009 }] })],
  prs: [pr(18982, 'Preserve voice intent when normalizing characters', { open: 2, issue: 'VOY-2989', checks: checks(goodChecks.items.map(c => c.name === 'Typecheck' ? { ...c, state: 'failed' } : c)) }), pr(19014, 'Keep adventure settings in sync', { checks: checks(goodChecks.items.map(c => c.name === 'pr-policy' ? { ...c, state: 'failed' } : c)) }), pr(19009, 'Correct ally targeting during combat', { mine: false, author: 'teammate', roles: ['linked'], issue: 'VOY-2985', reviewDecision: 'APPROVED', checks: checks(goodChecks.items.map(c => c.name === 'size-gate' ? { ...c, state: 'pending' } : c)) }), pr(19021, 'Simplify the story creation flow', { mine: false, author: 'reviewer', roles: ['review'], checks: checks(goodChecks.items.map(c => c.name === 'ci' ? { ...c, state: 'pending' } : c)) }), pr(18964, 'Restore the last selected adventure', { state: 'MERGED', mergedAt: now })],
};
function responder(seen = [], controls = {}) {
  const records = [{ id: 'current-review', head: fixture.prs[0].headSha, kind: 'review', outcome: 'notes', notes: 'The shared voice helper is the right place for this change. Two call sites still need follow-up; keep the fix inside character normalization.', at: Date.now() - 1200000, chat: null },
    { id: 'current-validation', head: fixture.prs[0].headSha, kind: 'validate', outcome: 'started', notes: '', at: Date.now() - 600000, chat: { key: 'validation-chat', provider: 'codex', sessionId: 'validation-session' } },
    { id: 'earlier-validation', head: 'b'.repeat(40), kind: 'validate', outcome: 'passed', notes: 'Focused voice tests passed. The subsequent commit changes the fallback call site and needs checking again.', at: Date.now() - 86400000, chat: null }];
  return (p, q, body) => {
    if (p === '/api/work') return { body: fixture };
    if (p === '/api/prs/detail') { const x = fixture.prs.find(x => x.number === Number(q.get('n'))) || fixture.prs[0]; return { body: { ...x, headSha: controls.head || x.headSha, record: x.number === 18982 ? records : [], clones: ['C:\\Latitude'], additions: 42, deletions: 17, changedFiles: 3, reviews: [], body: 'Keep character intent intact through normalization.\n\nThis change follows the existing shared helper and keeps the PR focused on the reported issue.', threadsComplete: true, threads: [{ path: 'packages/shared/voices/src/normalize.ts', line: 42, resolved: false, comments: [{ author: 'teammate', body: 'The fallback drops the requested voice. Can this preserve the existing intent?', url: x.url }] }, { path: 'packages/server/voyage/src/actors.ts', line: 18, resolved: false, comments: [{ author: 'teammate', body: 'Use the same shared helper at this call site.', url: x.url }] }].slice(0, x.open) } }; }
    if (p === '/api/prs/record') {
      if (!body) return { body: { entries: records } };
      seen.push({ p, body });
      if (controls.staleRecord) return { status: 409, body: { error: 'This PR has new commits. Refresh it before recording a result for the current revision.' } };
      const entry = { id: body.id || 'saved-result', at: Date.now(), ...body }, index = records.findIndex(e => e.id === entry.id);
      if (index >= 0) records[index] = { ...records[index], ...entry }; else records.unshift(entry);
      return { body: { entry } };
    }
    if (p === '/api/prs/record-remove') { const index = records.findIndex(e => e.id === body.id); if (index >= 0) records.splice(index, 1); return { body: { ok: true } }; }
    if (p === '/api/prs/files') {
      seen.push({ p, query: Object.fromEntries(q) });
      if (controls.staleFiles) return { status: 409, body: { error: 'This PR has new commits. Refresh it before reviewing the changed files.' } };
      return { body: { head: q.get('head'), page: 1, total: 3, hasMore: false, files: [
        { path: 'packages/shared/voices/src/normalize.ts', status: 'modified', additions: 18, deletions: 9, patch: '@@ -38,6 +38,8 @@ export function normalizeCharacter(character) {\n   const requestedVoice = character.voice;\n-  return pickDefaultVoice(character);\n+  return resolveVoice({\n+    requested: requestedVoice,\n+    fallback: character.defaultVoice,\n+  });\n }' },
        { path: 'packages/server/voyage/src/actors.ts', status: 'modified', additions: 12, deletions: 6, patch: '@@ -16,3 +16,4 @@\n-const voice = actor.defaultVoice;\n+const voice = normalizeCharacter(actor).voice;\n+// <script>window.patchExecuted = true</script>' },
        { path: 'docs/voices.md', status: 'added', additions: 12, deletions: 2, patch: '@@ -0,0 +1,2 @@\n+# Voice selection\n+Preserve explicit voice intent before applying a fallback.' },
      ] } };
    }
    if (p === '/api/linear/issue') return { body: { ...(fixture.issues.find(i => i.identifier === q.get('id')) || issue(2989, 'Preserve voice intent')), description: 'Switching characters should preserve the story context and the current selection.', comments: [] } };
    if (p === '/api/prs/act' || p === '/api/work/start') { seen.push({ p, body }); return { status: 409, body: { error: 'Test launch captured. No model was started.' } }; }
    return null;
  };
}
module.exports = [{
  name: 'work workspace',
  async run(t) {
    const seen = [], controls = {}, b = await t.open({ respond: responder(seen, controls), width: 1512, height: 1000 });
    await t.shot(b, 'hub');
    await b.eval(`go('work'); return 1`); await sleep(1400);
    const audit = async mode => { const rows = await b.eval(textAudit); const bad = rows.filter(r => r.size < 11 || (!r.disabled && r.ratio < r.needed)); t.check(`${mode}: workspace text is readable`, !bad.length, bad.slice(0, 8)); };
    await audit('dark');
    t.check('shows Tyler’s Linear identity separately from GitHub', await b.eval(`return document.querySelector('.wk-identities').textContent.includes('Tyler') && document.querySelector('.wk-identities').textContent.includes('KatoGrey')`));
    t.check('linked colleague PR appears and its Linear issue is not duplicated', await b.eval(`return !!document.querySelector('.wk-row[data-key="latitudegames/latitude#19009"]') && !document.querySelector('.wk-row[data-key="VOY-2985"]')`));
    await t.shot(b, 'overview-dark');
    await b.eval(`document.querySelector('.wk-row').focus(); return 1`);
    await b.key('/', 'Slash', 191);
    t.check('slash focuses work search without opening the command menu', await b.eval(`return document.activeElement.id === 'wkSearch' && document.getElementById('palette').hidden`));
    await b.eval(`document.querySelector('.wk-row').focus(); return 1`);
    await b.key('ArrowDown', 'ArrowDown', 40);
    t.check('arrow keys move through the work queue', await b.eval(`return document.activeElement.dataset.key === 'latitudegames/latitude#19014'`));
    await b.key('Home', 'Home', 36);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(500);
    t.check('Enter opens the focused item and detail loading preserves focus', await b.eval(`return document.querySelector('.wk-row.selected')?.dataset.key === 'latitudegames/latitude#18982' && document.activeElement.id === 'wkDetailTitle'`));
    t.check('patches are not fetched before Files is opened', !seen.some(x => x.p === '/api/prs/files'));
    t.check('overview has readiness, linked issue, and validation tools', await b.eval(`return document.querySelectorAll('.wk-gate').length === 4 && !!document.querySelector('[data-wk="issue-link"]') && !!document.querySelector('[data-wk="validate"]') && !!document.querySelector('[data-wk="handoff"]')`));
    await t.shot(b, 'readiness');
    await b.clickOn('.wk-detail-tabs [data-value="record"]');
    t.check('journal distinguishes a launched chat from recorded evidence', await b.eval(`return document.querySelectorAll('.wk-journal > .wk-record-timeline .wk-record-entry').length >= 2 && document.querySelector('[data-record-id="current-validation"]').textContent.includes('Chat started') && document.querySelector('[data-record-id="current-review"]').textContent.includes('Notes only')`));
    t.check('earlier evidence is folded under its original revision', await b.eval(`return !document.querySelector('.wk-record-earlier').open && document.querySelector('.wk-record-earlier').textContent.includes('bbbbbbb')`));
    await t.shot(b, 'journal-dark');
    await b.clickOn('[data-wk="record-add"]');
    await b.eval(`document.querySelector('#wrForm [name=notes]').value = 'yarn test voices — 18 passed. Build not run. <script>window.recordExecuted = true</script>'; document.querySelector('#wrForm [name=outcome]').value = 'passed'; return 1`);
    controls.staleRecord = true;
    await b.eval(`document.getElementById('wrForm').requestSubmit(); return 1`); await sleep(250);
    t.check('a stale revision keeps the evidence draft and displays the error', await b.eval(`return document.getElementById('workRecordDlg').open && document.querySelector('.wr-error').textContent.includes('new commits') && document.querySelector('#wrForm [name=notes]').value.includes('18 passed')`));
    controls.staleRecord = false;
    await b.eval(`document.getElementById('wrForm').requestSubmit(); return 1`); await sleep(250);
    t.check('a saved result keeps its revision and escapes untrusted notes', await b.eval(`return !document.getElementById('workRecordDlg').open && document.querySelector('[data-record-id="saved-result"]').textContent.includes('Build not run') && !window.recordExecuted`));
    await b.clickOn('[data-wk="record-edit"][data-id="saved-result"]');
    const evidenceNote = 'yarn test voices — 18 passed.\nChecked explicit voice intent and fallback selection.\n\nBuild not run. The server call site still needs review.';
    await b.eval(`document.querySelector('#wrForm [name=notes]').value = ${JSON.stringify(evidenceNote)}; return 1`);
    await t.shot(b, 'record-result');
    await b.eval(`document.getElementById('wrForm').requestSubmit(); return 1`); await sleep(250);
    t.check('editing a result updates the same entry and retains its revision', seen.some(x => x.p === '/api/prs/record' && x.body.id === 'saved-result' && x.body.head === fixture.prs[0].headSha && x.body.notes.includes('server call site')));
    controls.head = 'c'.repeat(40);
    await b.clickOn('[data-wk="refresh-detail"]'); await sleep(250);
    t.check('a new commit cannot inherit a passing result from an older revision', await b.eval(`return document.querySelector('.wk-record-empty').textContent.includes('No results for this revision') && document.querySelector('.wk-record-revision').textContent.includes('ccccccc') && document.querySelector('.wk-record-earlier').textContent.includes('18 passed')`));
    delete controls.head;
    await b.clickOn('[data-wk="refresh-detail"]'); await sleep(250);
    await b.clickOn('.wk-detail-tabs [data-value="overview"]');
    await b.clickOn('[data-wk="issue-link"]'); await sleep(250);
    await b.clickOn('[data-wk="back-detail"]'); await sleep(250);
    t.check('linked issue returns to its PR without losing the queue', await b.eval(`return document.querySelector('.wk-row.selected')?.dataset.key === 'latitudegames/latitude#18982'`));
    await b.clickOn('.wk-detail-tabs [data-value="checks"]');
    t.check('checks distinguish required and optional failures', await b.eval(`const groups = [...document.querySelectorAll('.wk-check-group')]; return groups.some(x => x.textContent.includes('Required') && x.textContent.includes('pr-policy')) && groups.some(x => x.textContent.includes('Optional') && x.textContent.includes('Typecheck') && x.textContent.includes('failed'))`));
    t.check('successful optional checks fold away while failures stay visible', await b.eval(`const fold = document.querySelector('.wk-check-settled'); return fold && !fold.open && fold.querySelectorAll('.wk-check-row').length === 4 && [...document.querySelectorAll('.wk-check-row')].some(row => row.textContent.includes('Typecheck') && !row.closest('details'))`));
    const savedScroll = await b.eval(`document.querySelector('.wk-check-settled').open = true; document.getElementById('wkInspector').scrollTop = 250; const scroll = document.getElementById('wkInspector').scrollTop; await Work.load(false); return scroll`); await sleep(200);
    t.check('background updates preserve expanded checks and reading position', await b.eval(`return document.querySelector('.wk-check-settled').open && document.getElementById('wkInspector').scrollTop === ${savedScroll}`));
    await b.eval(`document.querySelector('.wk-check-settled').open = false; document.getElementById('wkInspector').scrollTop = 380; return 1`);
    await t.shot(b, 'checks');
    await b.clickOn('.wk-detail-tabs [data-value="files"]'); await sleep(350);
    t.check('Files opens a wide review desk with package groups and a patch', await b.eval(`return !!document.querySelector('.wk-content.detail-focus') && document.querySelectorAll('.wk-file').length === 3 && document.querySelector('.wk-patch').textContent.includes('resolveVoice')`));
    await audit('diff'); await t.shot(b, 'files');
    await b.clickOn('[data-wk="file"][data-path="packages/server/voyage/src/actors.ts"]');
    t.check('file content is escaped instead of executing markup', await b.eval(`return !window.patchExecuted && document.querySelector('.wk-patch').textContent.includes('<script>')`));
    controls.staleFiles = true;
    await b.clickOn('[data-wk="refresh-detail"]'); await sleep(350);
    t.check('a changed PR revision offers refresh rather than stale patches', await b.eval(`return document.querySelector('.wk-error')?.textContent.includes('new commits') && !document.querySelector('.wk-patch')`));
    controls.staleFiles = false;
    await b.clickOn('.wk-error [data-wk="refresh-detail"]'); await sleep(350);
    t.check('refresh recovers the file review after a changed revision', await b.eval(`return !!document.querySelector('.wk-patch')`));
    await b.clickOn('[data-wk="expand-detail"]');
    await b.clickOn('[data-wk="detail-tab"][data-value="threads"]');
    t.check('review feedback is readable in the workspace', await b.eval(`return document.getElementById('wkInspector').textContent.includes('fallback drops the requested voice')`));
    await t.shot(b, 'review-threads');
    await b.clickOn('[data-wk="close-detail"]');
    t.check('closing details returns keyboard focus to the selected row', await b.eval(`return document.activeElement.dataset.key === 'latitudegames/latitude#18982'`));
    await b.eval(`const q = document.getElementById('wkSearch'); q.value = '3008'; q.dispatchEvent(new Event('input', {bubbles:true})); return 1`);
    t.check('search finds a Linear issue by its number', await b.eval(`return document.querySelectorAll('.wk-row').length === 1 && document.querySelector('.wk-row').dataset.key === 'VOY-3008'`));
    await b.eval(`const q = document.getElementById('wkSearch'); q.value = ''; q.dispatchEvent(new Event('input', {bubbles:true})); return 1`);
    await b.clickOn('[data-wk="filter"][data-value="attention"]');
    t.check('attention filter excludes PRs still awaiting CI and merged PRs', await b.eval(`return document.querySelectorAll('.wk-row').length === 3 && !document.querySelector('.wk-row[data-key="latitudegames/latitude#19009"]')`));
    await b.clickOn('.wk-row'); await sleep(200);
    t.check('previous navigation stops at the first item', await b.eval(`return document.querySelector('[data-wk="previous"]').disabled`));
    await b.clickOn('[data-wk="next"]'); await sleep(200);
    await b.clickOn('[data-wk="next"]'); await sleep(200);
    t.check('detail navigation follows the filtered queue and stops at its end', await b.eval(`return document.querySelector('.wk-row.selected').dataset.key === 'latitudegames/latitude#19021' && document.querySelector('[data-wk="next"]').disabled && document.querySelector('.wk-detail-nav').textContent.includes('3 / 3')`));
    await b.clickOn('[data-wk="previous"]'); await sleep(200);
    t.check('previous item returns through the same queue', await b.eval(`return document.querySelector('.wk-row.selected').dataset.key === 'latitudegames/latitude#19014'`));
    await b.clickOn('[data-wk="close-detail"]');
    await b.clickOn('[data-wk="filter"][data-value="all"]');
    await b.clickOn('[data-wk="layout"][data-value="board"]');
    t.check('board view keeps all items available', await b.eval(`return !!document.querySelector('.wk-results.as-board') && document.querySelectorAll('.wk-row').length === 7`));
    await t.shot(b, 'board');
    await b.clickOn('[data-wk="layout"][data-value="list"]');
    await b.eval(`Look.set({mode:'light'}); return 1`); await sleep(400); await t.shot(b, 'overview-light');
    await audit('light');
    t.check('pasted PR URLs and issue IDs have direct command-palette actions', await b.eval(`return sayItems('https://github.com/latitudegames/latitude/pull/18982').length === 2 && sayItems('VOY-3012').some(x => x.t.includes('VOY-3012'))`));
    await b.clickOn('[data-wk="select"][data-key="latitudegames/latitude#18982"]'); await sleep(300);
    await b.clickOn('.wk-detail-tabs [data-value="record"]'); await t.shot(b, 'journal-light'); await audit('journal light');
    for (const [word, action] of [['Validate changes', 'validate'], ['Prepare handoff', 'handoff']]) {
      await b.eval(`const entry = palItems(${JSON.stringify(word)}).find(x => x.t?.includes('#18982')); if (!entry) throw new Error('Missing contextual command'); entry.run(); return 1`);
      await b.eval(`const choice = [...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Codex')); if (!choice) throw new Error('Missing provider choice'); choice.click(); return 1`); await sleep(250);
      t.check(`${word} keeps the selected PR and provider`, seen.some(x => x.p === '/api/prs/act' && x.body.action === action && x.body.n === 18982 && x.body.provider === 'codex' && x.body.fresh));
    }
    await b.clickOn('#wkInspector [data-wk="cross-review"]');
    t.check('review launcher carries the selected PR and preserves CLI defaults', await b.eval(`return document.querySelector('#xrForm [name=url]').value.endsWith('/18982') && document.querySelector('#xrForm [name=model]').value === '' && document.querySelector('#xrForm [name=effort]').value === ''`));
    await t.shot(b, 'cross-review');
    await b.eval(`document.querySelector('#xrForm [name=instructions]').value = 'Keep the scope small.'; document.querySelector('#xrForm').requestSubmit(); return 1`); await sleep(400);
    const launched = seen.find(x => x.p === '/api/prs/act' && x.body.action === 'cross-review');
    t.check('review launch submits the PR and user instructions', launched?.body.action === 'cross-review' && launched?.body.instructions === 'Keep the scope small.', seen);
    t.check('launch failure keeps the instructions and shows the server error', await b.eval(`return !document.querySelector('.xr-error').hidden && document.querySelector('.xr-error').textContent.includes('Test launch captured') && document.querySelector('#xrForm [name=instructions]').value === 'Keep the scope small.'`));
    await b.esc();
    await b.eval(`openPrs(); return 1`); await sleep(250);
    t.check('global Pull requests opens the workspace instead of a second PR window', await b.eval(`return S.view === 'work' && !document.getElementById('prDlg')?.open && document.querySelector('[data-wk="filter"][data-value="prs"]').getAttribute('aria-pressed') === 'true'`));
    await b.eval(`Look.set({theme:'malibu',mode:'dark'}); return 1`); await sleep(350); await t.shot(b, 'illustrated');
    const phone = await t.open({ respond: responder(), width: 390, height: 844, mobile: true });
    await phone.eval(`go('work'); return 1`); await sleep(900);
    t.check('phone page has no horizontal overflow', await phone.eval(`return document.documentElement.scrollWidth <= window.innerWidth`));
    await t.shot(phone, 'phone');
    await phone.clickOn('[data-wk="select"][data-key="latitudegames/latitude#18982"]'); await sleep(500);
    t.check('phone details are visible and in view', await phone.eval(`const r = document.getElementById('wkInspector').getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < innerHeight`));
    await phone.clickOn('#navToggle'); await phone.esc();
    t.check('Escape closes phone navigation while preserving the selected PR', await phone.eval(`return !document.body.classList.contains('nav-open') && document.querySelector('.wk-row.selected')?.dataset.key === 'latitudegames/latitude#18982' && document.activeElement.id === 'navToggle'`));
    await t.shot(phone, 'phone-detail');
    await phone.clickOn('.wk-detail-tabs [data-value="files"]'); await sleep(350);
    t.check('phone file review stays inside the screen', await phone.eval(`return !!document.querySelector('.wk-patch') && document.documentElement.scrollWidth <= innerWidth`));
    await phone.eval(`const picker = document.getElementById('wkFileSelect'); picker.value = 'docs/voices.md'; picker.dispatchEvent(new Event('change', {bubbles:true})); return 1`);
    t.check('phone file picker switches the patch without opening another page', await phone.eval(`return document.querySelector('.wk-patch').textContent.includes('# Voice selection') && document.getElementById('wkFileSelect').getBoundingClientRect().width > 0`));
    await phone.eval(`document.querySelector('.wk-detail-tabs').scrollIntoView({block:'start'}); return 1`);
    await t.shot(phone, 'phone-files');
    await phone.clickOn('.wk-detail-tabs [data-value="record"]'); await sleep(200);
    t.check('phone journal has no horizontal overflow', await phone.eval(`return !!document.querySelector('.wk-journal') && document.documentElement.scrollWidth <= innerWidth`));
    await phone.eval(`document.querySelector('.wk-detail-tabs').scrollIntoView({block:'start'}); return 1`); await t.shot(phone, 'phone-journal');
    await phone.clickOn('[data-wk="record-add"]');
    t.check('phone result entry fits the viewport', await phone.eval(`const d = document.getElementById('workRecordDlg').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth`));
    await t.shot(phone, 'phone-record-result'); await phone.esc();
    const large = await t.open({ respond: responder(), width: 1280, height: 900 });
    await large.eval(`Look.set({text:130,ui:125,contrast:true}); go('work'); return 1`); await sleep(700);
    t.check('larger interface and contrast keep the page inside the window', await large.eval(`return document.documentElement.scrollWidth <= innerWidth + 1`));
    await t.shot(large, 'large-interface');
    // The start-page preference is opt-in, and the same control undoes it.
    await b.eval(`Look.set({theme:'crimson',mode:'dark'}); document.querySelector('[data-wk="home"]').click(); location.reload(); return 1`); await sleep(1500);
    t.check('the chosen start page opens after a reload', await b.eval(`return S.view === 'work' && store('start-page') === 'work'`));
    await b.eval(`document.querySelector('[data-wk="home"]').click(); return 1`);
    t.check('the start-page preference can be undone', await b.eval(`return store('start-page') === 'hub'`));
  },
}];
module.exports.fixture = fixture;
module.exports.responder = responder;
