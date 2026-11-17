const { sleep } = require('./browser');
const pt = require('../lib/playtest');

// Playtest (ui/playtest.js): the button on a Voyage world's page, the sheet from there and from Ctrl+K, quick starts
// filling the goal, presets, and Start sending the spec. The server's side is lib/playtest.js's own answers here; the
// real routes are checked in tests/playtest.test.js.
const TIDE = 'C:\\Projects\\Tidecaller';
const LIVE = 'https://voyage.io/world/tidecaller-live';

function stand() {
  const asked = [];
  const kept = { links: [{ url: LIVE, label: 'Live', lastUsed: Date.now() - 3600e3 }, { url: 'https://voyage.io/world/tidecaller-test', label: 'Test version' }], presets: [], runs: [] };
  const view = cwd => {
    const voyage = cwd === TIDE;
    return {
      cwd, links: voyage ? kept.links : [], found: voyage ? [{ url: 'https://beta.voyage.io/preview/tide-9', file: 'NOTES.md' }] : [], presets: voyage ? kept.presets : [], runs: voyage ? kept.runs : [],
      last: voyage ? LIVE : null, voyage, browser: 'app', maxTurns: pt.MAX_TURNS,
      patchNotes: voyage ? { newest: 'PATCH-NOTES-14-part-2.md', files: ['PATCH-NOTES-14-part-2.md', 'PATCH-NOTES-14-part-1.md'], at: Date.now() } : null,
      chips: pt.CHIPS, styles: Object.entries(pt.STYLES).map(([id, v]) => ({ id, label: v.label })), reports: Object.entries(pt.REPORTS).map(([id, v]) => ({ id, label: v.label })),
    };
  };
  const respond = async (p, q, body) => {
    if (!p.startsWith('/api/playtest')) return null;
    asked.push({ p, body, cwd: q.get('cwd') });
    if (p === '/api/playtest') return { body: view(q.get('cwd')) };
    if (p === '/api/playtest/preset') { const spec = pt.cleanSpec(body.spec); kept.presets.push({ id: 'p1', name: body.name, spec }); return { body: view(body.cwd) }; }
    if (p === '/api/playtest/link') return { body: view(body.cwd) };
    if (p === '/api/playtest/brief') return { body: { brief: pt.composeBrief(pt.cleanSpec(body.spec), { reportPath: `${body.cwd}\\playtests\\x.md`, provider: body.provider }), reportPath: 'x.md', title: pt.titleFor(body.spec) } };
    if (p === '/api/playtest/start') { const spec = pt.cleanSpec(body.spec); kept.runs.unshift({ at: Date.now(), spec, title: pt.titleFor(spec), reportPath: `${TIDE}\\playtests\\2026-11-17-1405-x.md`, who: { provider: body.provider, account: body.account } }); return { body: { key: 'k-bard', title: pt.titleFor(spec), reportPath: `${TIDE}\\playtests\\2026-11-17-1405-x.md`, where: body.where || 'new', cwd: TIDE } }; }
    return null;
  };
  return { asked, respond };
}
const sheetState = `const d = document.getElementById('ptDlg'); return d ? { open: d.open, url: document.getElementById('ptUrl').value, goal: document.getElementById('ptGoal').value, proj: !document.getElementById('ptProjWrap').hidden, projVal: document.getElementById('ptProj').value, links: [...document.querySelectorAll('#ptLinks .pt-link .chip')].map(x => x.textContent), found: document.getElementById('ptLinks').textContent, chips: [...document.querySelectorAll('#ptChips .chip')].map(x => x.textContent), patch: document.getElementById('ptPatch').hidden ? '' : document.getElementById('ptPatch').textContent, who: !!document.querySelector('#ptWho select'), where: !document.getElementById('ptWhereRow').hidden } : null`;

module.exports = [{
  name: 'playtest',
  async run(t) {
    const s = stand();
    const b = await t.open({ headless: true, width: 1440, height: 900, respond: s.respond });
    await sleep(900);
    // A Voyage world's page has the button; another project's doesn't.
    await b.eval(`go('folder', ${JSON.stringify('C:\\Projects\\Orbital Garden')}); return 1`); await sleep(900);
    t.check('a project that isn’t a Voyage world has no Playtest button', await b.eval(`return !document.querySelector('#wpBar [data-playtest]')`));
    await b.eval(`go('folder', ${JSON.stringify(TIDE)}); return 1`); await sleep(1200);
    t.check('a Voyage world’s page has a Playtest button with its main actions', await b.eval(`const x = document.querySelector('#wpBar .wp-act [data-playtest]'); return !!x && /Playtest/.test(x.textContent)`));
    await b.clickOn('#wpBar [data-playtest]'); await sleep(900);
    let st = await b.eval(sheetState);
    t.check('the sheet opens from the project', !!st && st.open, st);
    t.check('its link is the one used last, with the saved ones to pick from', st.url === LIVE && st.links.join('|') === 'Live|Test version', st);
    t.check('links found in the project’s files are offered', /beta\.voyage\.io\/preview\/tide-9/.test(st.found), st.found);
    t.check('opened from the project, it doesn’t ask which project', !st.proj && st.projVal === TIDE, st);
    t.check('every quick start is there', st.chips.length === 7 && st.chips.includes('Fights & companions') && st.chips.includes('Check the latest patch notes'), st.chips);
    t.check('who plays: the shared picker', st.who && !st.where, st);
    await t.shot(b, 'sheet');

    // Quick starts fill the goal; the patch notes one says which notes it reads.
    await b.clickOn('#ptChips [data-pt-chip="fights"]'); await sleep(200);
    st = await b.eval(sheetState);
    t.check('a quick start fills in the goal', st.goal === pt.CHIPS.find(c => c.id === 'fights').goal, st.goal.slice(0, 80));
    await b.clickOn('#ptChips [data-pt-chip="patch"]'); await sleep(200);
    st = await b.eval(sheetState);
    t.check('another replaces a goal you haven’t changed', st.goal === pt.CHIPS.find(c => c.id === 'patch').goal, st.goal.slice(0, 80));
    t.check('and the patch notes it reads are named', /PATCH-NOTES-14-part-2\.md/.test(st.patch) && /1 more/.test(st.patch), st.patch);
    await b.eval(`const g = document.getElementById('ptGoal'); g.value = 'Do the new healer abilities work? ' + g.value; g.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
    await b.clickOn('#ptChips [data-pt-chip="npcs"]'); await sleep(200);
    st = await b.eval(sheetState);
    t.check('a goal you’ve written is kept, the quick start after it', /^Do the new healer abilities work\?/.test(st.goal) && st.goal.endsWith(pt.CHIPS.find(c => c.id === 'npcs').goal) && !st.patch, st.goal.slice(0, 120));
    await b.clickOn('#ptChips [data-pt-chip="patch"]'); await sleep(200);

    // The specs.
    await b.eval(`document.querySelector('[name="ptTurns"][value="20"]').click();
      document.getElementById('ptOpening').value = 'The Drowned Bell';
      const k = document.getElementById('ptCharKind'); k.value = 'saved'; k.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('ptCharName').value = 'Kato';
      const s = document.getElementById('ptStyle'); s.value = 'fighter'; s.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[name="ptScreen"][value="phone"]').click();
      document.getElementById('ptPics').click();
      document.querySelector('#ptReport input[value="score"]').click();
      document.getElementById('ptExtra').value = 'Skip the tutorial.';
      return 1`); await sleep(200);
    t.check('a saved character asks for its name', await b.eval(`return !document.getElementById('ptCharWrap').hidden`));
    // See the brief.
    await b.clickOn('[data-pt="brief"]'); await sleep(500);
    const brief = await b.eval(`const p = document.getElementById('ptBrief'); return p.hidden ? '' : p.textContent`);
    t.check('See the brief shows what the agent is told', /# Playtest:/.test(brief) && /The Drowned Bell/.test(brief) && /voyage_act/.test(brief) && /Play 20 turns/.test(brief), brief.slice(0, 200));
    // Save as a preset.
    await b.eval(`ask = async () => 'Healers on live'; return 1`);
    await b.clickOn('[data-pt="preset"]'); await sleep(500);
    t.check('a preset is saved with the spec', s.asked.some(a => a.p === '/api/playtest/preset' && a.body.name === 'Healers on live' && a.body.spec.turns === 20));
    t.check('and listed at the top of the sheet, with Run again and Run', await b.eval(`const q = document.getElementById('ptQuick'); return !q.hidden && /Healers on live/.test(q.textContent) && !!q.querySelector('[data-pt-fill="p:p1"]') && !!q.querySelector('[data-pt-run="p:p1"]')`));

    // Start.
    await b.clickOn('#ptGo'); await sleep(1200);
    const start = s.asked.find(a => a.p === '/api/playtest/start');
    const sp = start && start.body.spec;
    t.check('Start calls the route with the spec', !!sp && sp.url === LIVE && /^Do the new healer abilities work\?/.test(sp.goal) && sp.chip === 'patch' && sp.turns === 20 && sp.opening === 'The Drowned Bell'
      && sp.character.kind === 'saved' && sp.character.name === 'Kato' && sp.style === 'fighter' && sp.screen === 'phone' && sp.pictures === true && sp.stopAsk === true
      && sp.report.join(',') === 'bugs,rules,pacing,score' && sp.extra === 'Skip the tutorial.' && sp.patchNotes.join(',') === 'PATCH-NOTES-14-part-2.md,PATCH-NOTES-14-part-1.md', start && start.body);
    t.check('in a new chat, as who was picked', !!start && start.body.where === 'new' && start.body.cwd === TIDE && start.body.provider === 'claude' && !!start.body.account, start && { where: start.body.where, provider: start.body.provider, account: start.body.account });
    t.check('the sheet closes, saying where the report goes', await b.eval(`return !document.getElementById('ptDlg').open && [...document.querySelectorAll('.toast, [role="status"]')].some(x => /Playtest started/.test(x.textContent) && /2026-11-17-1405-x\\.md/.test(x.textContent))`));
    await b.eval(`if (window.ChatUI && ChatUI.isOpen()) ChatUI.close(); go('hub'); return 1`); await sleep(700);

    // Ctrl+K, from the hub: the project is yours to choose, Voyage worlds first.
    const pal = await b.eval(`openPalette(); const q = document.getElementById('palQ'); q.value = 'playtest'; q.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); return document.getElementById('palList').textContent`);
    t.check('Ctrl+K has “Playtest a Voyage world…”', /Playtest a Voyage world…/.test(pal), pal.slice(0, 200));
    await b.key('Enter', 'Enter', 13); await sleep(1000);
    st = await b.eval(sheetState);
    t.check('it opens the sheet, asking which project, the Voyage world chosen', !!st && st.open && st.proj && st.projVal === TIDE, st);
    t.check('with the last run listed to run again', await b.eval(`const q = document.getElementById('ptQuick'); return !q.hidden && /Recent runs/.test(q.textContent) && !!q.querySelector('[data-pt-fill^="r:"]')`));
    await b.clickOn('#ptQuick [data-pt-fill^="r:"]'); await sleep(400);
    st = await b.eval(sheetState);
    t.check('Run again fills the sheet in as it was', /^Do the new healer abilities work\?/.test(st.goal) && await b.eval(`return document.querySelector('[name="ptTurns"]:checked').value === '20' && document.getElementById('ptCharName').value === 'Kato' && document.getElementById('ptStyle').value === 'fighter'`), st.goal.slice(0, 60));
    await b.eval(`document.getElementById('ptDlg').close(); return 1`); await sleep(300);

    // From a chat's ⋯ menu: it can run in that chat.
    await b.eval(`await ChatUI.openKey('k-bard'); return 1`); await sleep(1500);
    const item = await b.eval(`return typeof chatHeadItems === 'function' ? chatHeadItems().filter(x => x && x.label === 'Playtest…').length : -1`);
    t.check('an open chat’s ⋯ menu has Playtest…', item === 1, item);
    await b.eval(`const it = chatHeadItems().find(x => x && x.label === 'Playtest…'); it.run(); return 1`); await sleep(1200);
    st = await b.eval(sheetState);
    t.check('from a chat, it offers this chat or a new one', !!st && st.open && st.where && !st.proj, st);
    await b.eval(`document.querySelector('[name="ptWhere"][value="this"]').click(); return 1`); await sleep(200);
    t.check('in this chat, who plays is the chat’s own', await b.eval(`return document.getElementById('ptWhoRow').hidden`));
    await b.eval(`document.getElementById('ptDlg').close(); if (ChatUI.isOpen()) ChatUI.close(); return 1`); await sleep(400);
  },
}, {
  name: 'playtest phone',
  async run(t) {
    const s = stand();
    const b = await t.open({ headless: true, width: 390, height: 844, mobile: true, respond: s.respond });
    await sleep(900);
    await b.eval(`openPlaytest({ cwd: ${JSON.stringify(TIDE)} }); return 1`); await sleep(1200);
    const fit = await b.eval(`const d = document.getElementById('ptDlg'); const r = d.getBoundingClientRect(); const body = d.querySelector('.pt-body'); return { open: d.open, w: r.width, vw: innerWidth, over: body.scrollWidth - body.clientWidth, go: (() => { const g = document.getElementById('ptGo'); g.scrollIntoView({ block: 'nearest' }); const q = g.getBoundingClientRect(); return q.width > 0 && q.bottom <= innerHeight + 1; })() }`);
    t.check('on a phone it fills the screen, nothing wider than it, Start reachable', fit.open && fit.w <= fit.vw + 1 && fit.over <= 1 && fit.go, fit);
    await t.shot(b, 'phone');
  },
}];
