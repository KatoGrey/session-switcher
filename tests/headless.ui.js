const { sleep } = require('./browser');
const demo = require('./demo');

// Headless runs (ui/headless.js): chats a script or another agent started stay out of the everyday lists, and have a
// sidebar section, a page with ticks for several at once, a fold in each project, and Ctrl+K.
const RUNS = ['h-pr41', 'h-pr42', 'h-pr43', 'h-pr44', 'h-pr45', 'h-pr46'];

module.exports = [{
  name: 'headless runs',
  async run(t) {
    const b = await t.open({ headless: true, width: 1440, height: 900 });
    await sleep(900);
    const ids = JSON.stringify(RUNS.map(k => demo.ID[k].toLowerCase()));
    const runIn = sel => b.eval(`const runs = new Set(${ids}); return [...document.querySelectorAll('${sel}')].filter(el => runs.has(String(el.dataset.navchat || el.dataset.row || (el.dataset.navopen || '').replace(/^s:/, '')).toLowerCase())).length`);

    for (const next of [false, true]) {
      const tag = next ? 'new layout' : 'as before';
      await b.eval(`Shell.setNext(${next}); go('hub'); return 1`); await sleep(700);
      // Out of the everyday lists.
      t.check(`${tag}: no run in Recent`, await runIn('#nav .nav-sec[data-navsec="recent"] [data-navchat]') === 0);
      t.check(`${tag}: the run working somewhere else isn’t on Active now`, await runIn('#nav .nav-sec[data-navsec="active"] [data-navopen]') === 0, await b.eval(`return document.querySelector('#nav .nav-sec[data-navsec="active"]')?.textContent.slice(0, 300)`));
      t.check(`${tag}: a run that finished isn’t “your turn”`, await b.eval(`return !awaiting().some(x => x.headless) && !atWork().some(x => x.headless)`));
      t.check(`${tag}: and the hub doesn’t count it`, await b.eval(`return !document.title.includes('(2)') || awaiting().length === 2`), await b.eval(`return document.title`));
      t.check(`${tag}: no run among a project’s own chats`, await b.eval(`const runs = new Set(${ids}); return allSessions().filter(([s]) => runs.has(s.id.toLowerCase())).length === 0 && allHeadless().length === 6`));
      // The sidebar's section: what's working first.
      const sec = await b.eval(`const s = document.querySelector('#nav .nav-sec[data-navsec="headless"]'); return s ? { head: s.querySelector('.nav-h').textContent, first: s.querySelector('[data-navchat] .nc-t')?.textContent, rows: s.querySelectorAll('[data-navchat]').length, more: s.querySelector('[data-view="headless"]')?.textContent } : null`);
      t.check(`${tag}: a Headless runs section in the sidebar, with how many are working`, !!sec && /Headless runs/.test(sec.head) && /1 working/.test(sec.head) && /6/.test(sec.head), sec);
      t.check(`${tag}: the one working comes first, five at most, and all of them a click away`, !!sec && /PR 41/.test(sec.first) && sec.rows === 5 && /All 6 headless runs/.test(sec.more), sec);
      await t.shot(b, `sidebar-${next ? 'new' : 'before'}`);
      // Its page.
      await b.clickOn('#nav .nav-sec[data-navsec="headless"] [data-view="headless"]'); await sleep(700);
      const page = await b.eval(`return { h1: document.querySelector('#page h1')?.textContent, now: document.querySelectorAll('#hlNow .row').length, rest: document.querySelectorAll('#hlRest .row').length, nowH: document.getElementById('hlNowH')?.textContent }`);
      t.check(`${tag}: the page lists every run, the working one under Working now`, page.h1 === 'Headless runs' && page.now === 1 && page.rest === 5 && /Working now/.test(page.nowH), page);
      await t.shot(b, `page-${next ? 'new' : 'before'}`);
    }
    await b.eval(`Shell.setNext(false); go('headless'); return 1`); await sleep(500);

    // Narrowing it down.
    await b.eval(`const q = document.getElementById('hlQ'); q.value = 'queen'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(300);
    t.check('the filter narrows it to what has those words', await b.eval(`return document.querySelectorAll('#hlList .row').length`) === 1);
    await b.eval(`const q = document.getElementById('hlQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); const f = document.getElementById('hlFolder'); f.value = ${JSON.stringify('C:\\Projects\\Neon Courier')}; f.dispatchEvent(new Event('change', { bubbles: true })); return 1`); await sleep(300);
    t.check('the folder picker narrows it to one folder', await b.eval(`return document.querySelectorAll('#hlList .row').length`) === 2);
    await b.eval(`const f = document.getElementById('hlFolder'); f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true })); return 1`); await sleep(300);

    // Several at once: done, and back.
    const tick = k => b.eval(`const c = document.querySelector('input[data-hpick="${demo.ID[k]}"]'); c.click(); return c.checked`);
    t.check('a run can be ticked', await tick('h-pr44') && await tick('h-pr45'));
    const bar = await b.eval(`const a = document.getElementById('hlAct'); return { hidden: a.hidden, text: a.textContent.replace(/\\s+/g, ' ') }`);
    t.check('the bar says how many and what can be done', !bar.hidden && /2 runs selected/.test(bar.text) && /Mark done/.test(bar.text) && /Move to group/.test(bar.text) && /Back with my chats/.test(bar.text), bar);
    await t.shot(b, 'picked');
    await b.clickOn('#hlAct [data-hact="done"]'); await sleep(700);
    t.check('Mark done takes both off the list', await b.eval(`return document.querySelectorAll('#hlList .row').length`) === 4);
    t.check('they’re done (under Done in their project)', await b.eval(`return [${JSON.stringify(demo.ID['h-pr44'])}, ${JSON.stringify(demo.ID['h-pr45'])}].every(id => isDoneChat(sessionById(id)[0]))`));
    t.check('with an Undo', await b.eval(`return [...document.querySelectorAll('.toast, [role="status"]')].some(x => /2 runs done/.test(x.textContent) && /Undo/.test(x.textContent))`));
    await b.eval(`await headlessDone([${JSON.stringify(demo.ID['h-pr44'])}, ${JSON.stringify(demo.ID['h-pr45'])}], false, true); return 1`); await sleep(500);
    t.check('and back again', await b.eval(`return document.querySelectorAll('#hlList .row').length`) === 6);

    // Select all, then clear.
    await b.eval(`const a = document.getElementById('hlAll'); a.click(); return 1`); await sleep(300);
    t.check('Select all shown ticks every one shown', await b.eval(`return HL.picked.size === 6 && /6 runs selected/.test(document.getElementById('hlAct').textContent)`));
    await b.clickOn('#hlAct [data-hact="clear"]'); await sleep(300);
    t.check('Clear unticks them', await b.eval(`return HL.picked.size === 0 && document.getElementById('hlAct').hidden`));

    // Into a group, several at once.
    await b.eval(`S.org.groups = S.org.groups || []; return 1`);
    const moved = [];
    await b.eval(`window.__orgCalls = []; const _a = api; window.__apiBack = _a; api = async (p, body) => { if (p === '/api/organize') { __orgCalls.push(body); return { groups: S.org.groups, parents: S.org.parents || {}, commander: S.org.commander, made: body.action === 'create' ? { id: 'g-new' } : null }; } return _a(p, body); }; return 1`);
    await tick('h-pr41'); await tick('h-pr43');
    const items = await b.eval(`return headlessGroupItems(hlPicked()).filter(i => i !== '-').map(i => i.label)`);
    t.check('Move to group… offers a new group', items.includes('New group…'), items);
    await b.eval(`ask = async () => 'PR reviews'; await headlessGroupItems(hlPicked()).find(i => i.label === 'New group…').run(); return 1`); await sleep(300);
    moved.push(...await b.eval(`return __orgCalls.map(c => c.action + ':' + (c.chat || '') + ':' + (c.id || ''))`));
    t.check('a new group takes the first, and the rest follow', moved[0] === `create:${demo.ID['h-pr41']}:` && moved.some(m => m === `move:${demo.ID['h-pr43']}:g-new`), moved);
    await b.eval(`api = __apiBack; HL.picked.clear(); renderHeadless(); return 1`);

    // Back with your chats, and its menu.
    await tick('h-pr46');
    await b.clickOn('#hlAct [data-hact="mine"]'); await sleep(800);
    t.check('Back with my chats puts it with your chats', await b.eval(`return allSessions().some(([s]) => s.id === ${JSON.stringify(demo.ID['h-pr46'])}) && allHeadless().length === 5`));
    t.check('its menu can put it back in Headless runs', await b.eval(`return hlItems(${JSON.stringify(demo.ID['h-pr46'])})[0].label`) === 'Move to Headless runs');
    t.check('a run’s menu offers Back with my chats', await b.eval(`return hlItems(${JSON.stringify(demo.ID['h-pr43'])})[0].label`) === 'Back with my chats');
    await b.eval(`await setHeadless([${JSON.stringify(demo.ID['h-pr46'])}], null, true); return 1`); await sleep(500);
    t.check('and back to how it began', await b.eval(`return allHeadless().length`) === 6);
    // Undo puts back exactly what you'd said before: here, "with my chats".
    const pr46 = JSON.stringify(demo.ID['h-pr46']);
    await b.eval(`await setHeadless([${pr46}], false, true); await setHeadless([${pr46}], true); return 1`); await sleep(500);
    t.check('moved into Headless runs by hand', await b.eval(`return !!sessionById(${pr46})[0].headless`));
    await b.eval(`const u = [...document.querySelectorAll('#toast button, .toast button, [role="status"] button')].find(x => /Undo/.test(x.textContent)); u.click(); return 1`); await sleep(900);
    t.check('Undo puts it back with your chats, as you’d said before', await b.eval(`return !sessionById(${pr46})[0].headless`));
    await b.eval(`await setHeadless([${pr46}], null, true); return 1`); await sleep(400);

    // Imperial and Rebel keep their sidebar and pages as they were: the runs stay with your chats there.
    const theme = await b.eval(`return Look.theme().id`);
    await b.eval(`Look.set({ theme: 'imperial' }); return 1`); await sleep(900);
    t.check('in Imperial, the runs are with your chats as before', await b.eval(`return allHeadless().length === 0 && allSessions().some(([s]) => s.headless) && !document.querySelector('#nav .nav-sec[data-navsec="headless"]')`));
    await b.eval(`Look.set({ theme: ${JSON.stringify(theme)} }); return 1`); await sleep(900);
    t.check('and back on their own list in the usual themes', await b.eval(`return allHeadless().length`) === 6);

    // "Keep them with my chats…" opens Setup at its switch, in the new layout too (Setup in groups).
    await b.eval(`Shell.setNext(true); go('headless'); return 1`); await sleep(600);
    await b.clickOn('[data-hact="settings"]'); await sleep(1500);
    t.check('“Keep them with my chats…” opens Setup at its switch', await b.eval(`const el = document.getElementById('prefHeadless'); return !!(document.getElementById('setup').open && el && el.offsetParent)`));
    await b.eval(`document.getElementById('setup').close(); Shell.setNext(false); go('headless'); return 1`); await sleep(500);

    // A project keeps its own, folded away.
    await b.eval(`go('folder', ${JSON.stringify('C:\\Projects\\Neon Courier')}); return 1`); await sleep(900);
    const fold = await b.eval(`const d = document.querySelector('#wbList .headless-chats'); return d ? { hidden: d.hidden, open: d.open, label: d.querySelector('summary').textContent, rows: d.querySelectorAll('.row').length } : null`);
    t.check('a project has its runs folded away under its chats', !!fold && !fold.hidden && !fold.open && fold.label === 'Headless runs · 2' && fold.rows === 2, fold);
    t.check('and not among its chats', await runIn('#wbList > ul.rows > .row') === 0);

    // Ctrl+K.
    const pal = await b.eval(`openPalette(); const q = document.getElementById('palQ'); q.value = 'PR 43'; q.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); const t = document.getElementById('palList').textContent; closePalette(); return t`);
    t.check('Ctrl+K finds a run, saying it is one', /Review PR 43/.test(pal) && /Headless run/.test(pal), pal.slice(0, 300));
    const go = await b.eval(`openPalette(); const q = document.getElementById('palQ'); q.value = 'headless'; q.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 350)); const t = document.getElementById('palList').textContent; closePalette(); return t`);
    t.check('and goes to the page', /Headless runs/.test(go), go.slice(0, 300));

    // Kept with your chats (Setup): the everyday lists have them again, and the section goes.
    await b.eval(`S.prefs.headlessApart = false; sortDone(); go('hub'); return 1`); await sleep(700);
    t.check('kept with your chats, they’re in the lists as before', await b.eval(`return allHeadless().length === 0 && allSessions().length >= 6 + 16`));
    t.check('and the sidebar has no section for them', await b.eval(`return !document.querySelector('#nav .nav-sec[data-navsec="headless"]')`));
    t.check('a finished one counts as your turn again', await b.eval(`return awaiting().some(x => x.headless)`));
    await b.eval(`S.prefs.headlessApart = true; sortDone(); renderAll(); return 1`);

    // On a phone: the page fits, and the bar shows.
    const p = await t.open({ headless: true, mobile: true, width: 390, height: 844 });
    await sleep(900);
    await p.eval(`go('headless'); return 1`); await sleep(600);
    await p.eval(`document.querySelector('input[data-hpick]').click(); return 1`); await sleep(300);
    const fit = await p.eval(`return { over: document.documentElement.scrollWidth - innerWidth, bar: !document.getElementById('hlAct').hidden, rows: document.querySelectorAll('#hlList .row').length }`);
    t.check('on a phone the page fits the width, with its rows and the bar', fit.over <= 1 && fit.bar && fit.rows === 6, fit);
    await t.shot(p, 'phone');
  },
}];
