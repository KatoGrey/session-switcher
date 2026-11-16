const { sleep } = require('./browser');
const demo = require('./demo');
const { responder } = require('./work.ui');

module.exports = [{
  name: 'model in the chat',
  // A chat's model and effort can be changed from where you are in it, in either layout: the model in the message
  // box, the Model line in its side panel, Ctrl+K's Switch model…, and /model. (The shared picker for starting work
  // doesn't replace any of these.)
  async run(t) {
    const b = await t.open({ state: 'busy', width: 1440, height: 900, respond: responder() });
    await sleep(600);
    const id = JSON.stringify(demo.ID['s-bard']);
    for (const next of [false, true]) {
      const tag = next ? 'new layout' : 'as before';
      await b.eval(`Shell.setNext(${next}); ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(2200);
      await b.eval(`C.mi.main = { model: 'sonnet', effort: 'medium', efforts: ['low', 'medium', 'high'], models: [{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet', isDefault: true }, { value: 'haiku', label: 'Haiku' }] }; C.model = 'Sonnet'; renderCrew(); renderLedger(); window._model = []; window._api0 = api; api = async (u, body) => { if (u === '/api/chat/model') { _model.push(body); return { ...C.mi.main, ...(body.model ? { model: body.model } : {}), ...(body.effort ? { effort: body.effort } : {}) }; } return _api0(u, body); }; return 1`);
      // The model in the message box.
      await b.clickOn('[data-crew="main"]'); await sleep(500);
      t.check(`${tag}: the model in the message box opens the picker`, await b.eval(`return !document.getElementById('cPick').hidden`));
      await b.eval(`const o = [...document.querySelectorAll('#cPick [data-model]')].find(x => x.dataset.model === 'opus'); if (o) o.click(); return 1`); await sleep(300);
      t.check(`${tag}: picking a model there switches it`, await b.eval(`return _model.some(x => x.model === 'opus')`), await b.eval(`return _model`));
      await b.eval(`closePick(); return 1`); await sleep(150);
      // The Model line in the side panel.
      await b.eval(`if (document.getElementById('chat').classList.contains('no-ledger')) document.querySelector('[data-c="ledger"]').click(); const d = document.querySelector('#cLedgerBody details'); if (d) d.open = true; renderLedger(); return 1`); await sleep(300);
      const line = await b.eval(`const btn = document.querySelector('#cLedgerBody [data-c="model-pick"]'); if (!btn) return null; btn.click(); return btn.textContent`); await sleep(400);
      t.check(`${tag}: the Model line in the side panel opens the same picker`, !!line && await b.eval(`return !document.getElementById('cPick').hidden`), line);
      await b.eval(`closePick(); return 1`);
      // Ctrl+K.
      const pal = await b.eval(`openPalette(); document.getElementById('palQ').value = 'model'; document.getElementById('palQ').dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); const t = document.getElementById('palList').textContent; closePalette(); return t`);
      t.check(`${tag}: Ctrl+K offers Switch model…`, /Switch model/.test(pal), pal.slice(0, 200));
      // /model in the message box.
      await b.eval(`_model.length = 0; await quickSwitch('model', 'haiku'); return 1`); await sleep(200);
      t.check(`${tag}: /model switches it too`, await b.eval(`return _model.some(x => x.model === 'haiku')`), await b.eval(`return _model`));
      await b.eval(`api = _api0; ChatUI.close(); return 1`); await sleep(400);
    }
    await b.eval(`Shell.setNext(false); return 1`);
  },
}, {
  name: 'setup in groups',
  // With the new layout, Setup's Options show one group at a time; a link to a section opens its group. Subagents
  // and Switcher Lite have a place in Setup in every layout.
  async run(t) {
    const b = await t.open({ respond: responder() });
    await sleep(600);
    await b.eval(`await openSetup(); return 1`); await sleep(900);
    let r = await b.eval(`const body = document.getElementById('setupBody'); return { toc: !!body.querySelector('.setup-toc'), tabs: body.querySelectorAll('[data-sg-tab]').length, helpers: !!document.getElementById('st-helpers'), lite: !!document.getElementById('st-lite') }`);
    t.check('off: Options is one sheet with its jump list, as before', r.toc && !r.tabs, r);
    t.check('Subagents and Switcher Lite have a place in Setup', r.helpers && r.lite, r);
    await b.eval(`document.getElementById('setup').close(); Shell.setNext(true); await openSetup(); return 1`); await sleep(900);
    r = await b.eval(`const body = document.getElementById('setupBody'), vis = id => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
      return { tabs: [...body.querySelectorAll('[data-sg-tab]')].map(x => x.textContent), on: body.querySelector('[data-sg-tab][aria-selected="true"]')?.textContent, health: vis('st-health'), prefs: vis('st-prefs'), codex: vis('st-codex') }`);
    t.check('on: Options shows groups as tabs', ['Health', 'General', 'Assistants', 'Connections', 'Devices', 'About'].every(x => r.tabs.includes(x)), r.tabs);
    t.check('one group at a time, Health first', r.on === 'Health' && r.health && !r.prefs && !r.codex, r);
    await t.shot(b, 'setup-groups');
    await b.eval(`document.querySelector('[data-sg-tab="assistants"]').click(); return 1`); await sleep(200);
    r = await b.eval(`const vis = id => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; }; return { codex: vis('st-codex'), helpers: vis('st-helpers'), health: vis('st-health') }`);
    t.check('Assistants has Codex, Gemini and Subagents', r.codex && r.helpers && !r.health, r);
    await b.eval(`document.querySelector('[data-sg-tab="assistants"]').focus(); return 1`);
    await b.key('ArrowRight', 'ArrowRight', 39); await sleep(150);
    t.check('arrow keys move between the groups', await b.eval(`return document.activeElement.dataset.sgTab === 'connections' && document.querySelector('[data-sg-tab="connections"]').getAttribute('aria-selected') === 'true'`));
    // A link to a section (as Ctrl+K and Try again use) opens its group first.
    await b.eval(`document.getElementById('setup').close(); openSetupAt('st-lite'); return 1`); await sleep(1200);
    r = await b.eval(`const el = document.getElementById('st-lite'); return { shown: !!el && el.getClientRects().length > 0, on: document.querySelector('[data-sg-tab][aria-selected="true"]')?.textContent }`);
    t.check('a link to Switcher Lite opens Devices, with it in view', r.shown && r.on === 'Devices', r);
    await b.eval(`window._opened = []; window._open = window.open; window.open = (u, n) => { _opened.push([u, n]); return null; }; document.querySelector('[data-fix="lite"]').click(); window.open = _open; return 1`); await sleep(200);
    const opened = await b.eval(`return _opened`);
    t.check('Open Switcher Lite opens it', opened.length === 1 && /\/lite$/.test(opened[0][0]), opened);
    await b.eval(`document.getElementById('setup').close(); Shell.setNext(false); return 1`);
  },
}, {
  name: 'new layout',
  // Try the new layout: the sidebar stays beside a chat (main themes, wide screens); off, nothing changes.
  async run(t) {
    const b = await t.open({ state: 'busy', width: 1440, height: 900, respond: responder() });
    await sleep(600);
    const id = JSON.stringify(demo.ID['s-bard']);
    const shape = () => b.eval(`const nav = document.getElementById('nav').getBoundingClientRect(), chat = document.getElementById('chat').getBoundingClientRect(), rail = document.getElementById('cRail');
      const hit = document.elementFromPoint(nav.left + nav.width / 2, nav.top + 120);
      return { navShows: !!hit && document.getElementById('nav').contains(hit), chatLeft: Math.round(chat.left), navW: Math.round(nav.width), rail: !!rail && getComputedStyle(rail).display !== 'none' }`);
    await b.eval(`ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(2200);
    let r = await shape();
    t.check('off: a chat has its own list of open chats, as before', r.rail && !r.navShows && r.chatLeft === 0, r);
    await b.eval(`ChatUI.close(); openSetup && openSetup('look'); return 1`).catch(() => {}); await sleep(600);
    const toggle = await b.eval(`const c = document.querySelector('#setupBody input[data-layout-next]'); if (!c) return false; c.click(); return c.checked`);
    t.check('Appearance has “Try the new layout”', toggle === true, toggle);
    await b.eval(`document.getElementById('setup').open && document.getElementById('setup').close(); if (!Shell.next()) Shell.setNext(true); ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(2200);
    r = await shape();
    t.check('on: the sidebar stays beside the chat, and the chat starts where it ends', r.navShows && !r.rail && Math.abs(r.chatLeft - r.navW) <= 2, r);
    await t.shot(b, 'new-layout');
    t.check('the open chat is marked in the sidebar', await b.eval(`return !!document.querySelector('#nav .nav-chat[aria-current="true"]')`));
    await b.eval(`document.querySelector('#nav [data-view="work"]').click(); return 1`); await sleep(1200);
    t.check('a destination in the sidebar goes there from a chat', await b.eval(`return S.view === 'work' && !ChatUI.isOpen()`));
    // The hub keeps to what needs you and what's running: the sidebar has the rest.
    await b.eval(`go('hub'); return 1`); await sleep(1200);
    const hub = await b.eval(`const has = id => !!document.getElementById(id); return { jump: has('hubJump'), banner: !!document.querySelector('.wk-hub-entry'), prs: has('secPrs'), recent: has('secRecent'), projects: has('secWorlds'), await: has('secAwait'), work: has('secWork'), accounts: has('secAccounts') }`);
    t.check('on: the hub keeps to what needs you and what’s running, without the jump bar or what the sidebar has', !hub.jump && !hub.banner && !hub.prs && !hub.recent && !hub.projects && hub.await && hub.work && hub.accounts, hub);
    await t.shot(b, 'new-layout-hub');
    // Imperial keeps its own layout, switch or not.
    await b.eval(`Look.set({ theme: 'imperial' }); ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(2200);
    r = await shape();
    t.check('Imperial keeps its chat list and layout', r.rail && r.chatLeft === 0, r);
    await b.eval(`ChatUI.close(); Shell.setNext(false); Look.reset(); go('hub'); return 1`); await sleep(1200);
    t.check('off again: the hub is as it was', await b.eval(`return !!document.getElementById('hubJump') && !!document.getElementById('secRecent') && !!document.getElementById('secWorlds')`));
  },
}, {
  name: 'workspace shell',
  async run(t) {
    const calls = [];
    const b = await t.open({ state: 'busy', seen: p => calls.push(p), respond: responder() });
    const fit = async () => b.eval(`return document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.bar>button:not([hidden])')].filter(x => x.getBoundingClientRect().width).every(x => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })`);
    t.check('the header names the current destination', await b.eval(`return document.querySelector('#shellContext b').textContent === 'The hub'`));
    t.check('account sign-in problems take priority over cached quota', await b.eval(`const a = current(), was = a.signedIn; a.signedIn = false; renderBar(); const text = document.querySelector('.ac-summary').textContent; a.signedIn = was; renderBar(); return text === 'Not signed in'`));
    const stable = await b.eval(`const el = document.querySelector('.nav-destinations'); const top = el.getBoundingClientRect().top; document.querySelector('.nav-scroll').scrollTop = 500; return top === el.getBoundingClientRect().top && document.querySelector('#nav [data-view=work]').getBoundingClientRect().bottom < 300`);
    t.check('destinations stay reachable while the lists scroll', stable);
    await b.eval(`document.querySelector('.nav-scroll').scrollTop = 0; return 1`);
    await t.shot(b, 'hub-dark');
    await b.clickOn('#navToggle');
    t.check('collapsing frees the page and removes hidden navigation from the keyboard', await b.eval(`return document.getElementById('nav').inert && getComputedStyle(document.getElementById('nav')).display === 'none' && document.getElementById('navToggle').getAttribute('aria-expanded') === 'false' && document.getElementById('page').getBoundingClientRect().left < 80 && localStorage.getItem('sidebar-collapsed') === 'true'`));
    await b.send('Page.reload', {}); await sleep(3000);
    t.check('desktop sidebar choice survives reload', await b.eval(`return document.body.classList.contains('nav-collapsed') && document.getElementById('nav').inert`));
    await b.clickOn('#navToggle');
    await b.clickOn('#seek');
    t.check('command search puts destinations before recent chats', await b.eval(`const groups = [...document.querySelectorAll('.pal-g')].map(x => x.textContent); return groups.indexOf('Go to') >= 0 && groups.indexOf('Go to') < groups.indexOf('Recent chats')`));
    await b.key('Tab', 'Tab', 9); await b.key('Tab', 'Tab', 9, 8);
    t.check('Tab and Shift+Tab stay in command search', await b.eval(`return document.activeElement.id === 'palQ'`));
    await t.shot(b, 'commands');
    await b.esc();
    t.check('closing command search restores its trigger', await b.eval(`return document.activeElement.id === 'seek'`));
    t.check('closing an already closed palette does not move keyboard focus', await b.eval(`document.getElementById('page').focus(); closePalette(); return document.activeElement.id === 'page'`));
    await b.eval(`await go('work'); return 1`); await sleep(500);
    t.check('routing updates the location without waiting for a live event', await b.eval(`return document.querySelector('#shellContext b').textContent === 'Your work'`));
    await t.shot(b, 'work-overview');
    await b.clickOn('[data-wk="select"][data-key="latitudegames/latitude#18982"]'); await sleep(400);
    await t.shot(b, 'review-brief');
    await b.clickOn('[data-wk="detail-tab"][data-value="record"]');
    await b.eval(`document.getElementById('wkInspector').scrollTop = 150; window._shellScroll = document.getElementById('wkInspector').scrollTop; return 1`);
    await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(900);
    t.check('a conversation names its real return destination', await b.eval(`return document.querySelector('.c-return').textContent.includes('Your work') && document.querySelector('.rail-back').textContent.includes('Your work')`));
    t.check('busy recipients visibly Queue and offer Stop', await b.eval(`const s = document.querySelector('#cSend .ct'); return s.textContent === 'Queue' && s.getBoundingClientRect().width > 15 && !document.getElementById('cStop').hidden`));
    await b.clickOn('[data-crew="comp"]');
    t.check('switching to a ready recipient changes the visible action to Send', await b.eval(`return document.querySelector('#cSend .ct').textContent === 'Send' && document.getElementById('cStop').hidden`));
    await b.clickOn('[data-crew="main"]');
    t.check('switching back restores Queue for the working recipient', await b.eval(`return document.querySelector('#cSend .ct').textContent === 'Queue' && !document.getElementById('cStop').hidden`));
    await b.eval(`setStatus('main', 'Checking the package build'); return 1`);
    t.check('files and commands lead the inspector with account details available below', await b.eval(`const box = document.getElementById('cLedgerBody'); return box.textContent.indexOf('Files changed') < box.textContent.indexOf('Chat details') && !!box.querySelector('.lg-details') && !box.querySelector('.lg-details').open`));
    t.check('opened chat details stay open as output updates', await b.eval(`document.querySelector('.lg-details').open = true; renderLedger(); const on = document.querySelector('.lg-details').open; document.querySelector('.lg-details').open = false; return on`));
    await t.shot(b, 'chat-dark');
    await b.clickOn('#navToggle');
    t.check('focus mode expands chat and makes its hidden rail inert', await b.eval(`return document.getElementById('cRail').inert && document.querySelector('.c-main').getBoundingClientRect().left < 2 && document.querySelector('.c-return').getBoundingClientRect().width > 0`));
    await t.shot(b, 'chat-focus');
    await b.clickOn('#navToggle');
    await b.eval(`toggleFocus(true); return 1`);
    await b.clickOn('#navToggle');
    t.check('the sidebar control also exits the existing conversation focus mode', await b.eval(`return !document.getElementById('chat').classList.contains('focus') && !document.getElementById('cRail').inert`));
    await b.clickOn('.c-return'); await sleep(700);
    t.check('returning preserves the workspace and does not stop a chat', await b.eval(`return !ChatUI.isOpen() && S.view === 'work'`) && !calls.includes('/api/chat/stop') && !calls.includes('/api/chat/interrupt'));
    t.check('returning keeps the selected PR, journal tab, reading position, and keyboard focus', await b.eval(`return document.querySelector('.wk-row.selected')?.dataset.key === 'latitudegames/latitude#18982' && document.querySelector('[data-wk="detail-tab"][data-value="record"]').getAttribute('aria-pressed') === 'true' && document.getElementById('wkInspector').scrollTop === window._shellScroll && document.activeElement.matches('[data-wk="detail-tab"][data-value="record"]')`));
    await b.eval(`await go('hub'); Look.set({mode:'light'}); return 1`); await sleep(300);
    await t.shot(b, 'hub-light');
    t.check('desktop header fits in light mode', await fit());
    await b.eval(`Look.set({mode:'dark', ui:140}); return 1`); await sleep(350);
    t.check('header fits at 140% interface size', await fit());
    await t.shot(b, 'large-interface');
    await b.eval(`Look.set({ui:100}); return 1`);
    await b.clickOn('#navToggle');
    await b.eval(`Look.set({theme:'imperial'}); return 1`); await sleep(250);
    t.check('saga retains its sidebar despite the standard-shell preference', await b.eval(`return !document.body.classList.contains('nav-collapsed') && !document.getElementById('nav').inert && getComputedStyle(document.getElementById('shellContext')).display === 'none'`));

    const phone = await t.open({ width: 390, height: 844, mobile: true, state: 'busy', respond: responder() });
    const closed = () => phone.eval(`return !document.body.classList.contains('nav-open') && document.getElementById('nav').inert && document.getElementById('navToggle').getAttribute('aria-expanded') === 'false'`);
    t.check('closed phone navigation is absent from keyboard navigation', await closed());
    await phone.clickOn('#navToggle'); await sleep(250);
    t.check('phone navigation opens with focus inside and New chat available', await phone.eval(`return document.getElementById('nav').contains(document.activeElement) && !document.getElementById('nav').inert && document.querySelector('.nav-newchat').getBoundingClientRect().height >= 40`));
    await t.shot(phone, 'phone-nav');
    await phone.esc();
    t.check('Escape closes the drawer and restores its toggle', await closed() && await phone.eval(`return document.activeElement.id === 'navToggle'`));
    await phone.clickOn('#navToggle'); await sleep(250);
    await phone.clickOn('#nav [data-view="work"]'); await sleep(500);
    t.check('choosing a destination resets the drawer state', await closed() && await phone.eval(`return S.view === 'work' && document.querySelector('#shellContext b').textContent === 'Your work'`));
    t.check('phone header fits without hiding its account or commands', await phone.eval(`const controls = ['usechip','seek','navToggle']; return document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('#usechip .ac-who b').getBoundingClientRect().width > 0 && controls.every(id => {const r=document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth;})`));
    await phone.eval(`await ChatUI.open({sessionId:${JSON.stringify(demo.ID['s-bard'])}}); return 1`); await sleep(800);
    t.check('phone chat keeps a visible return and legible message actions', await phone.eval(`return document.querySelector('.c-return').getBoundingClientRect().width > 0 && document.querySelector('#cSend .ct').getBoundingClientRect().width > 15 && document.getElementById('cSend').getBoundingClientRect().right <= innerWidth && document.getElementById('cStop').getBoundingClientRect().height >= 40`));
    await t.shot(phone, 'phone-chat');
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(250);
    t.check('Fold-sized chat still keeps controls inside its pane', await phone.eval(`return document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('cSend').getBoundingClientRect().right <= innerWidth`));
  },
}, {
  name: 'setup scrolls',
  // Setup scrolls in its body only, in both layouts and at a bigger interface size. With more Health lines than the
  // demo has (as on a real PC), This PC and connections' "(set up)" words for a screen reader came below the dialog's
  // edge, reached out of the body to the dialog and gave it a second scroll bar: the wheel slid the head away and left
  // a blank space under the sheet. The jump list and the group tabs stay at the top while it scrolls, uncut.
  async run(t) {
    const b = await t.open({ width: 1280, height: 1000, respond: responder() });
    await sleep(600);
    // Fourteen more Health lines, as on a PC with several accounts and assistants.
    const open = next => b.eval(`Shell.setNext(${next}); await openSetup(); await new Promise(r => setTimeout(r, 900));
      const j = Places.health; renderSetup({ ...j, checks: [...j.checks, ...Array.from({ length: 14 }, (_, i) => ({ id: 'more-' + i, state: 'ok', label: 'Account ' + (i + 1), detail: 'Signed in, with room this week.' }))] });
      if (${next}) showSetupGroup('health', false); return 1`);
    // Anything placed (position: absolute) inside the body that isn't kept to it.
    const loose = () => b.eval(`const body = document.getElementById('setupBody');
      return [...body.querySelectorAll('*')].filter(el => el.getClientRects().length && getComputedStyle(el).position === 'absolute' && !(el.offsetParent && (el.offsetParent === body || body.contains(el.offsetParent)))).map(el => el.tagName.toLowerCase() + '.' + el.className)`);
    const state = () => b.eval(`const d = document.getElementById('setup'), body = document.getElementById('setupBody'), head = d.querySelector('.setup-head'), top = body.getBoundingClientRect().top;
      const bar = body.querySelector('.setup-toc, .st-groups'), first = bar && bar.querySelector('a, [role="tab"]');
      return { dialogScroll: d.scrollHeight - d.clientHeight, dialogAt: d.scrollTop, headIn: head.getBoundingClientRect().top >= d.getBoundingClientRect().top - 1,
        end: body.scrollTop + body.clientHeight >= body.scrollHeight - 2, bodyAt: Math.round(body.scrollTop),
        bar: bar ? Math.round(bar.getBoundingClientRect().top - top) : null, firstIn: first ? first.getBoundingClientRect().top >= top - 0.5 : null }`);
    const wheel = async dy => {
      const p = await b.eval(`const q = document.getElementById('setupBody').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]`);
      for (let i = 0; i < 30; i++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 0, deltaY: dy }); await sleep(30); }
      await sleep(700);
    };
    for (const next of [false, true]) {
      for (const ui of [100, 120]) {
        const tag = `${next ? 'new layout' : 'as before'}, ${ui}%`;
        await b.eval(`Look.set({ ui: ${ui} }); return 1`); await sleep(200);
        await open(next);
        let gone = await loose();
        if (next) for (const k of await b.eval(`return [...document.querySelectorAll('#setupBody [data-sg-tab]')].map(x => x.dataset.sgTab)`)) { await b.eval(`showSetupGroup(${JSON.stringify(k)}, false); return 1`); gone = gone.concat(await loose()); }
        if (next) await b.eval(`showSetupGroup('health', false); return 1`);
        t.check(`${tag}: nothing inside Setup reaches out of its body`, !gone.length, gone);
        let s = await state();
        t.check(`${tag}: the dialog has no scroll of its own`, s.dialogScroll <= 1, s);
        await wheel(400);
        s = await state();
        t.check(`${tag}: the wheel takes the body to its end, and the dialog and its head stay put`, s.end && s.dialogAt === 0 && s.headIn, s);
        t.check(`${tag}: the ${next ? 'group tabs stay' : 'jump list stays'} at the top, uncut`, s.bar !== null && s.bar >= -1 && s.bar <= 7 && s.firstIn, s);
        await t.shot(b, `${next ? 'new' : 'before'}-${ui}-scrolled`);
        await wheel(-400);
        s = await state();
        t.check(`${tag}: and back to the top`, s.bodyAt === 0 && s.dialogAt === 0 && s.headIn, s);
        await b.eval(`document.getElementById('setup').close(); return 1`); await sleep(350);
      }
    }
    await b.eval(`Look.set({ ui: 100 }); Shell.setNext(false); return 1`);

    // The dialogs Setup opens keep their insides to their scrolling bodies too (Subagents has a hidden "Name" on
    // each card).
    for (const [name, opener, id] of [['Subagents', 'openSubagents()', 'subsDlg'], ['Connections', 'openConnections()', 'connDlg'], ['Rules and tools', 'openRules()', 'rulesDlg']]) {
      const r = await b.eval(`await ${opener}; await new Promise(r => setTimeout(r, 1200)); const d = document.getElementById(${JSON.stringify(id)}) || document.querySelector('dialog[open]');
        if (!d || !d.open) return { open: false };
        const scroller = el => { for (let p = el.parentElement; p && p !== d; p = p.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)) return p; return null; };
        const loose = [...d.querySelectorAll('*')].filter(el => { if (!el.getClientRects().length || getComputedStyle(el).position !== 'absolute') return false; const s = scroller(el); return s && !(el.offsetParent && (el.offsetParent === s || s.contains(el.offsetParent))); }).map(el => el.tagName.toLowerCase() + '.' + el.className);
        const out = { open: true, id: d.id, loose, dialogScroll: d.scrollHeight - d.clientHeight }; d.close(); return out`);
      t.check(`${name}: nothing inside reaches out of its scrolling body`, r.open && !r.loose.length && r.dialogScroll <= 1, r);
      await sleep(300);
    }

    // A phone: Setup fills the screen, the body scrolls to its last button and the dialog doesn't move.
    const phone = await t.open({ width: 390, height: 844, mobile: true, respond: responder() });
    await sleep(600);
    await phone.eval(`await openSetup(); await new Promise(r => setTimeout(r, 900)); const body = document.getElementById('setupBody'); body.scrollTop = body.scrollHeight; return 1`); await sleep(400);
    const p = await phone.eval(`const d = document.getElementById('setup'), body = document.getElementById('setupBody'), last = [...body.querySelectorAll('.app-actions .btn')].pop();
      return { dialogScroll: d.scrollHeight - d.clientHeight, dialogAt: d.scrollTop, end: body.scrollTop + body.clientHeight >= body.scrollHeight - 2, lastIn: !!last && last.getBoundingClientRect().bottom <= innerHeight + 1 }`);
    t.check('phone: the body scrolls to its last button and the dialog stays put', p.dialogScroll <= 1 && p.dialogAt === 0 && p.end && p.lastIn, p);

    // Ctrl+K's list keeps its lines' hidden words to itself as well.
    await b.eval(`openPalette(); return 1`); await sleep(500);
    const pal = await b.eval(`const list = document.getElementById('palList'); return [...list.querySelectorAll('.sr')].filter(el => el.getClientRects().length && !(el.offsetParent === list || list.contains(el.offsetParent))).length`);
    t.check('Ctrl+K: nothing in its list reaches out of it', pal === 0, pal);
    await b.eval(`closePalette(); return 1`);
  },
}, {
  name: 'what a chat covers',
  // What an open chat sits over can't be reached with Tab or a screen reader: the page under it, and the sidebar
  // unless it's beside the chat (the new layout). On a phone the chat's list of open chats is slid off to the side
  // until its button shows it, and can't be reached until then; Tab stays in the chat.
  async run(t) {
    const id = JSON.stringify(demo.ID['s-bard']);
    const b = await t.open({ width: 1440, height: 900, state: 'busy', respond: responder() });
    await sleep(600);
    const st = () => b.eval(`return { page: document.getElementById('page').inert, nav: document.getElementById('nav').inert, rail: document.getElementById('cRail').inert, skip: document.getElementById('skipLink').textContent }`);
    for (const next of [false, true]) {
      const tag = next ? 'new layout' : 'as before';
      await b.eval(`Shell.setNext(${next}); await ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(1200);
      let s = await st();
      t.check(`${tag}: the page under a chat can't be reached`, s.page && /conversation/.test(s.skip), s);
      t.check(next ? `${tag}: the sidebar beside the chat can` : `${tag}: nor the sidebar it covers`, s.nav === !next, s);
      t.check(`${tag}: the chat's own list can`, !s.rail, s);
      await b.eval(`toggleFocus(true); return 1`); await sleep(300);
      t.check(`${tag}: focus mode tucks the list away`, (await st()).rail);
      await b.eval(`toggleFocus(false); ChatUI.close(); return 1`); await sleep(600);
      s = await st();
      t.check(`${tag}: closed, everything can be reached again`, !s.page && !s.nav && /page/.test(s.skip), s);
      // Opened from a button on the page, focus goes into the chat, not lost with the page; and going somewhere else
      // from the chat lands on that page.
      await b.eval(`await go('work'); return 1`); await sleep(500);
      await b.eval(`const btn = document.querySelector('#page button'); btn.focus(); await ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(1200);
      t.check(`${tag}: opened from the page, focus is in the chat`, await b.eval(`return document.getElementById('chat').contains(document.activeElement)`), await b.eval(`return document.activeElement.tagName + '#' + document.activeElement.id`));
      await b.eval(`await go('hub'); return 1`); await sleep(700);
      t.check(`${tag}: going to another page from a chat lands focus on it`, await b.eval(`return !ChatUI.isOpen() && !document.getElementById('page').inert && document.activeElement === document.getElementById('page')`), await b.eval(`return document.activeElement.tagName + '#' + document.activeElement.id`));
      // A chat you only watch has no message box: focus still goes into it, and so does the skip link.
      await b.eval(`document.querySelector('#page button').focus(); await ChatUI.watch({ sessionId: ${id}, source: 'terminal' }); return 1`); await sleep(1200);
      const w = await b.eval(`const inChat = () => document.getElementById('chat').contains(document.activeElement); const a = inChat(); document.body.focus(); document.getElementById('skipLink').click(); return { compose: !!document.getElementById('cText').getClientRects().length, opened: a, skip: inChat(), at: document.activeElement.tagName + '.' + document.activeElement.className }`);
      t.check(`${tag}: watching a chat (no message box), focus and the skip link go into it`, !w.compose && w.opened && w.skip, w);
      await b.eval(`ChatUI.close(); return 1`); await sleep(500);
    }
    await b.eval(`Shell.setNext(false); return 1`);

    const phone = await t.open({ width: 390, height: 844, mobile: true, state: 'busy', respond: responder() });
    await sleep(600);
    await phone.eval(`await ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(1200);
    t.check('phone: the open chats list is out of reach while slid away', await phone.eval(`return document.getElementById('cRail').inert && document.getElementById('page').inert`));
    const where = [];
    for (let i = 0; i < 40; i++) { await phone.key('Tab', 'Tab', 9); where.push(await phone.eval(`const a = document.activeElement; return a.closest('#cRail') ? 'list' : a.closest('#page') ? 'page' : a.closest('#nav') ? 'sidebar' : 'ok'`)); }
    t.check('phone: Tab stays out of the page, the sidebar and the hidden list', !where.some(w => w !== 'ok'), where.join(' '));
    await phone.clickOn('#chat [data-c="rail"]'); await sleep(400);
    t.check('phone: its button shows the list, and it can be reached', await phone.eval(`return document.getElementById('chat').classList.contains('show-rail') && !document.getElementById('cRail').inert`));
    await phone.eval(`document.querySelector('#cRail .rail-back, #cRail button').focus(); document.querySelector('#chat [data-c="rail"]').click(); return 1`); await sleep(400);
    t.check('phone: slid away again with focus in it, focus goes back to its button', await phone.eval(`return document.getElementById('cRail').inert && document.activeElement === document.querySelector('#chat [data-c="rail"]')`));
  },
}, {
  name: 'sidebar order',
  // The sidebar's sections go where you put them (ui/nav-order.js): dragged by a heading with the mouse, or from the
  // heading's right-click menu; kept on this device; Esc puts a drag back, a plain click still folds, and the block at
  // the top doesn't move. Imperial keeps its own sidebar.
  async run(t) {
    const b = await t.open({ width: 1440, height: 1500, state: 'busy', respond: responder() });   // (room for the whole sidebar)
    await sleep(800);
    const order = () => b.eval(`return [...document.querySelectorAll('#nav .nav-sec')].map(el => el.dataset.navsec)`);
    const head = k => b.eval(`const el = document.querySelector('#nav .nav-sec[data-navsec="${k}"] > .nav-h, #nav .nav-sec[data-navsec="${k}"] > .nav-hrow > .nav-h, #nav .nav-sec[data-navsec="${k}"] > .nav-tools'); const r = el.getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]`);
    const mouse = (type, x, y) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    const drag = async (from, toY, { cancel = false } = {}) => {
      const [x, y] = await head(from);
      await mouse('mousePressed', x, y);
      for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', x, y + (toY - y) * i / 12); await sleep(25); }
      if (cancel) await b.key('Escape', 'Escape', 27);
      await mouse('mouseReleased', x, toY); await sleep(600);
    };
    const first = await order();
    t.check('the usual order to start with', first.join() === ['tools', 'projects', 'active', 'recent', 'groups'].join(), first);
    t.check('the block at the top isn’t one of them', await b.eval(`return !document.querySelector('.nav-destinations').closest('.nav-sec') && !document.querySelector('.nav-sec .nav-newchat')`));

    // Recent, dragged above everything.
    const folded = await b.eval(`return document.querySelector('[data-fold="recent"]').getAttribute('aria-expanded')`);
    await drag('recent', await b.eval(`return document.querySelector('#nav .nav-sec').getBoundingClientRect().top + 4`));
    let now = await order();
    t.check('dragging Recent by its heading puts it at the top', now[0] === 'recent' && now.length === first.length, now);
    t.check('the drag doesn’t also fold it', await b.eval(`return document.querySelector('[data-fold="recent"]').getAttribute('aria-expanded')`) === folded);
    t.check('the order is kept on this device', await b.eval(`return JSON.parse(localStorage.getItem('nav-order'))[0] === 'recent'`));
    t.check('a heading at the top doesn’t bring its dividing line', await b.eval(`const h = document.querySelector('[data-fold="recent"]'), c = getComputedStyle(h).borderTopColor; return c === 'transparent' || /, 0\\)$/.test(c)`));

    // Pressed while a working chat redraws the sidebar, then dragged: it still goes where the pointer is.
    {
      const [x, y] = await head('projects');
      const target = await b.eval(`return document.querySelector('#nav .nav-sec').getBoundingClientRect().top + 4`);
      await mouse('mousePressed', x, y);
      await b.eval(`document.getElementById('nav')._h = ''; renderNav(); return 1`);
      for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', x, y + (target - y) * i / 12); await sleep(25); }
      await mouse('mouseReleased', x, target); await sleep(600);
      now = await order();
      t.check('a redraw while it’s pressed doesn’t send it to the wrong place', now[0] === 'projects', now);
    }

    // The Commander and Routines, the tallest block, dragged by a row below the last (short) section.
    await drag('tools', await b.eval(`const all = document.querySelectorAll('#nav .nav-sec'); return all[all.length - 1].getBoundingClientRect().bottom + 6`));
    now = await order();
    t.check('the Commander and Routines go to the bottom, below a short last section', now[now.length - 1] === 'tools', now);
    // Esc mid-drag puts it back.
    const before = await order();
    await drag('groups', (await head('recent'))[1] - 20, { cancel: true });
    t.check('Esc while dragging puts it back', (await order()).join() === before.join(), await order());
    // Esc, then let go a while later back on the heading it started on: it doesn't fold.
    {
      const [x, y] = await head('recent'), was = await b.eval(`return document.querySelector('[data-fold="recent"]').getAttribute('aria-expanded')`);
      await mouse('mousePressed', x, y);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', x, y + i * 12); await sleep(25); }
      await b.key('Escape', 'Escape', 27); await sleep(700);
      await mouse('mouseMoved', x, y); await mouse('mouseReleased', x, y); await sleep(400);
      t.check('letting go long after Esc doesn’t fold it', await b.eval(`return document.querySelector('[data-fold="recent"]').getAttribute('aria-expanded')`) === was);
    }
    // Groups' + gives the section's menu (its heading has nothing else to focus).
    await b.eval(`const p = document.querySelector('#nav .nav-sec[data-navsec="groups"] [data-gact="new"]'); p.focus(); p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return 1`); await sleep(300);
    t.check('Groups’ + opens its menu', await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].some(x => /Move Groups/.test(x.textContent))`));
    await b.eval(`closeMenu(); return 1`);

    // A plain click still folds a section.
    await b.clickOn('[data-fold="open"]'); await sleep(300);
    t.check('a click on a heading still folds it', await b.eval(`return document.querySelector('[data-fold="open"]').getAttribute('aria-expanded') === 'false'`));
    await b.clickOn('[data-fold="open"]'); await sleep(300);

    // While it's being dragged, the sidebar isn't redrawn under it.
    const [hx, hy] = await head('projects');
    await mouse('mousePressed', hx, hy); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', hx, hy + i * 30); await sleep(40); }
    await sleep(250); await t.shot(b, 'sidebar-dragging');
    const held = await b.eval(`const el = document.querySelector('.nav-sec-dragging'); document.getElementById('nav')._h = ''; renderNav(); return !!el && el.isConnected && el.classList.contains('nav-sec-dragging')`);
    await b.key('Escape', 'Escape', 27); await mouse('mouseReleased', hx, hy + 180); await sleep(600);
    t.check('a section being dragged isn’t redrawn away mid-drag, and the sidebar catches up after', held && !(await b.eval(`return !!document.querySelector('.nav-sec-dragging')`)) && (await order()).join() === before.join());

    // From the heading's menu (the keyboard's way too: the menu key or Shift+F10 on a heading).
    await b.eval(`const h = document.querySelector('[data-fold="recent"]'); h.focus(); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return 1`); await sleep(300);
    const items = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.trim())`);
    t.check('its heading’s menu moves it up, down, to the top or the bottom, hides it, or puts the sidebar back', ['Move Recent up', 'Move Recent to the top', 'Move Recent down', 'Move Recent to the bottom', 'Hide Recent', 'Put the sidebar back as it was'].every(w => items.some(x => x.includes(w))), items);
    await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => x.textContent.includes('Move Recent to the top')).click(); return 1`); await sleep(400);
    now = await order();
    t.check('Move to the top does it, and says so', now[0] === 'recent' && /Recent moved to the top/.test(await b.eval(`return document.getElementById('hubLive').textContent`)), now);
    t.check('focus stays on its heading', await b.eval(`return document.activeElement === document.querySelector('[data-fold="recent"]')`));

    // After a reload, the same order.
    const saved = await order();
    await b.eval(`location.reload(); return 1`); await sleep(2500);
    t.check('after a reload it’s the same', (await order()).join() === saved.join(), await order());

    // Back to the usual order.
    await b.eval(`const h = document.querySelector('[data-fold="recent"]'); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 300 })); return 1`); await sleep(300);
    await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => x.textContent.includes('back as it was')).click(); return 1`); await sleep(400);
    t.check('the usual order comes back, and nothing is kept', (await order()).join() === first.join() && await b.eval(`return !localStorage.getItem('nav-order')`), await order());

    // A section that's empty now keeps its place for when it's back (Pinned and Headless runs, here).
    await b.eval(`localStorage.setItem('nav-order', JSON.stringify(['recent', 'headless', 'pinned', 'tools', 'projects', 'active', 'groups', 'subs'])); document.getElementById('nav')._h = ''; renderNav(); return 1`); await sleep(200);
    await b.eval(`moveNavSec('groups', 'top'); return 1`); await sleep(200);
    t.check('moving one around keeps an empty section’s place among the rest', await b.eval(`return JSON.parse(localStorage.getItem('nav-order')).join()`) === 'groups,headless,pinned,recent,tools,projects,active,subs', await b.eval(`return localStorage.getItem('nav-order')`));
    await t.shot(b, 'sidebar-order');

    // A later version's section, unknown to this one, stays in the saved order after the one it followed.
    await b.eval(`localStorage.setItem('nav-order', JSON.stringify(['recent', 'later-thing', 'tools', 'projects', 'active', 'groups'])); document.getElementById('nav')._h = ''; renderNav(); moveNavSec('groups', 'top'); return 1`); await sleep(200);
    t.check('a later version’s section isn’t lost', await b.eval(`const o = JSON.parse(localStorage.getItem('nav-order')); return o.indexOf('later-thing') === o.indexOf('recent') + 1 && o[0] === 'groups'`), await b.eval(`return localStorage.getItem('nav-order')`));

    // Hiding a section, and showing it again (from a heading, or the sidebar's empty space).
    await b.eval(`localStorage.removeItem('nav-order'); document.getElementById('nav')._h = ''; renderNav(); return 1`); await sleep(200);
    await b.eval(`const h = document.querySelector('#nav .nav-sec[data-navsec="groups"] > .nav-h'); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 400 })); return 1`); await sleep(300);
    await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => x.textContent.includes('Hide Groups')).click(); return 1`); await sleep(400);
    t.check('Hide takes a section out of the sidebar, and says how to bring it back', !(await order()).includes('groups') && /Groups is hidden/.test(await b.eval(`return document.getElementById('toast').textContent`)), await order());
    await b.eval(`const foot = document.querySelector('#nav .nav-foot'); foot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 800 })); return 1`); await sleep(300);
    const back = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.trim())`);
    t.check('the sidebar’s empty space offers it back', back.some(x => /Show Groups again/.test(x)), back);
    await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /Show Groups again/.test(x.textContent)).click(); return 1`); await sleep(400);
    t.check('and it’s back in its place', (await order()).join() === first.join() && await b.eval(`return !localStorage.getItem('nav-hidden')`), await order());

    // The sidebar's width: dragged at its edge, the arrow keys there, and a double-click to put it back.
    const w0 = await b.eval(`return Math.round(document.getElementById('nav').getBoundingClientRect().width)`);
    const edge = await b.eval(`const r = document.getElementById('navSize').getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + 200] : null`);
    t.check('the sidebar has an edge to drag', !!edge, edge);
    if (edge) {
      await mouse('mousePressed', edge[0], edge[1]);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', edge[0] + i * 10, edge[1]); await sleep(30); }
      await mouse('mouseReleased', edge[0] + 80, edge[1]); await sleep(400);
      const w1 = await b.eval(`return Math.round(document.getElementById('nav').getBoundingClientRect().width)`);
      t.check('dragging its edge makes it wider, and it’s kept on this device', w1 >= w0 + 70 && Number(await b.eval(`return localStorage.getItem('nav-width')`)) === w1, { w0, w1 });
      await b.eval(`document.getElementById('navSize').focus(); return 1`); await b.key('ArrowLeft', 'ArrowLeft', 37); await sleep(200);
      t.check('the left arrow on its edge makes it narrower', Number(await b.eval(`return localStorage.getItem('nav-width')`)) === w1 - 16);
      await b.eval(`location.reload(); return 1`); await sleep(2500);
      t.check('after a reload it’s the same width', Math.round(await b.eval(`return document.getElementById('nav').getBoundingClientRect().width`)) === w1 - 16);
      const e2 = await b.eval(`const r = document.getElementById('navSize').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 200]`);
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: e2[0], y: e2[1], button: 'left', clickCount: 1 }); await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: e2[0], y: e2[1], button: 'left', clickCount: 1 });
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: e2[0], y: e2[1], button: 'left', clickCount: 2 }); await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: e2[0], y: e2[1], button: 'left', clickCount: 2 }); await sleep(400);
      t.check('a double-click puts it back to its usual width', Math.round(await b.eval(`return document.getElementById('nav').getBoundingClientRect().width`)) === w0 && !(await b.eval(`return localStorage.getItem('nav-width')`)));
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1000);
      t.check('with a chat over the sidebar (as before), its edge isn’t there to grab', await b.eval(`return !document.getElementById('navSize').getClientRects().length`));
      await b.eval(`Shell.setNext(true); return 1`); await sleep(300);
      t.check('in the new layout, beside a chat, it is', await b.eval(`return document.getElementById('navSize').getClientRects().length > 0`));
      await b.eval(`Shell.setNext(false); ChatUI.close(); return 1`); await sleep(400);
    }

    // Imperial keeps its own sidebar.
    await b.eval(`Look.set({ theme: 'imperial' }); renderNav(); return 1`); await sleep(300);
    t.check('Imperial’s sidebar is left as it is, with no edge to drag', await b.eval(`return !document.querySelector('#nav .nav-sec') && !document.getElementById('navSize').getClientRects().length`));
    await b.eval(`Look.set({ theme: '' }); localStorage.removeItem('nav-order'); return 1`);
  },
}, {
  name: 'short window chat',
  // On a short window (a laptop's), the chat's header, its relay and the hint under the message box take less height,
  // so more of the conversation shows; a tall window is as it was.
  async run(t) {
    const id = JSON.stringify(demo.ID['s-bard']);
    const size = async (w, h) => {
      const b = await t.open({ width: w, height: h, state: 'busy', respond: responder() });
      await sleep(600);
      await b.eval(`await ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(1200);
      const r = await b.eval(`const g = s => { const el = document.querySelector(s); return el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().height) : 0; }; return { head: g('#chat .c-head'), relay: g('#cRelay'), scroll: g('#cScroll'), title: !!document.getElementById('cTitle').textContent.trim(), back: document.querySelector('.c-return').getClientRects().length > 0, mode: document.getElementById('cMode').getClientRects().length > 0 }`);
      b.close();
      return r;
    };
    const short = await size(1366, 680), tall = await size(1440, 900);
    t.check('a short window gives the conversation more room (header and relay slimmer)', short.head <= 95 && short.relay <= 32 && short.scroll >= 340, short);
    t.check('with the title, the way back and the mode all still there', short.title && short.back && short.mode, short);
    t.check('a tall window keeps its header as it was', tall.head >= 120 && tall.relay >= 40, tall);
  },
}, {
  name: 'layout watch',
  // On your own data, a dialog that opens with a layout fault (two scroll bars, something reaching out of its scrolling
  // box, too wide) is noted in Setup → Problems once (ui/problems.js); a sound one isn't.
  async run(t) {
    const b = await t.open({ width: 1280, height: 900, respond: responder() });
    await sleep(600);
    await b.eval(`window._slips = []; const a0 = api; api = async (u, body) => { if (u === '/api/problems' && body && body.message) _slips.push(body.message); return a0(u, body); }; return 1`);
    await b.eval(`await openSetup(); return 1`); await sleep(4200);
    t.check('a sound Setup notes nothing', (await b.eval(`return _slips`)).length === 0, await b.eval(`return _slips`));
    await b.eval(`document.getElementById('setup').close(); return 1`); await sleep(400);
    // 6.13's fault, put back on purpose: the sheet no longer holds what's placed in it, the dialog scrolls itself, and the
    // connections come far down.
    await b.eval(`const st = document.createElement('style'); st.id = 'broken'; st.textContent = '#setupBody{position:static!important} #setup[open]{display:block!important;overflow:auto!important}'; document.head.append(st); return 1`);
    await b.eval(`await openSetup(); await new Promise(r => setTimeout(r, 600)); const sp = document.createElement('div'); sp.style.height = '1600px'; document.getElementById('st-places').before(sp); return 1`); await sleep(4200);
    const got = await b.eval(`return _slips`);
    t.check('with 6.13’s fault put back, it’s noted in Problems: two scroll bars, around the sheet', got.some(m => m.startsWith('Layout: setup: it scrolls itself around div#setupBody')), got);
    await b.eval(`document.getElementById('broken').remove(); document.getElementById('setup').close(); return 1`);
  },
}, {
  name: 'slack post: open slack',
  // Copy and open Slack: the first time it asks for your team's channel (kept on this device), then copies the post
  // and opens Slack at it (straight into the app from a Slack web address, by way of the browser from a copied link). A
  // PR you've copied one for says so next time.
  async run(t) {
    const base = responder();
    const b = await t.open({ respond: (p, q, body) => (p === '/api/prs/slack-post' ? { body: { text: `A draft about #${body.n}
https://github.com/${body.repo}/pull/${body.n}`, withChat: false } } : base(p, q, body)) });
    await sleep(600);
    await b.eval(`window._asked = []; window._opened = []; window._copied = []; window.ask = async (...a) => { _asked.push(a); return window._answer; }; window.copyText = async x => { _copied.push(x); return true; }; openSlackLink = (u) => { _opened.push(u); }; return 1`);
    const pr = JSON.stringify({ repo: 'latitudegames/latitude', number: 19079, title: 'S3 deadlines', url: 'https://github.com/latitudegames/latitude/pull/19079', state: 'OPEN' });
    await b.eval(`openSlackPost(${pr}); return 1`); await sleep(600);
    t.check('with no channel yet, it says it’ll ask', await b.eval(`return document.getElementById('spOpen').textContent === 'Copy and open Slack…' && !document.getElementById('spWhere').textContent`));
    await b.eval(`window._answer = 'https://app.slack.com/client/T0ABC123/C0DEF456'; document.getElementById('spOpen').click(); return 1`); await sleep(500);
    let r = await b.eval(`return { asked: _asked.length, maxLength: (_asked[0] || [])[4]?.maxLength, opened: _opened, copied: _copied, open: document.getElementById('spDlg').open, kept: localStorage.getItem('slack-channel'), posted: localStorage.getItem('slack-posted') }`);
    t.check('the first time it asks for the channel’s link (room for a whole link), and keeps it', r.asked === 1 && r.maxLength >= 200 && r.kept === 'https://app.slack.com/client/T0ABC123/C0DEF456', r);
    t.check('then copies the post, closes, and opens the Slack app at the channel', r.copied.length === 1 && /A draft about #19079/.test(r.copied[0]) && !r.open && r.opened[0] === 'slack://channel?team=T0ABC123&id=C0DEF456', r);
    t.check('it remembers that you copied one for this PR', (r.posted || '').includes('latitudegames/latitude#19079'), r.posted);
    await b.eval(`openSlackPost(${pr}); return 1`); await sleep(600);
    r = await b.eval(`return { intro: document.getElementById('spIntro').textContent, where: document.getElementById('spWhere').textContent, button: document.getElementById('spOpen').textContent }`);
    t.check('next time it says so, and where Copy and open Slack goes', /You copied a review request for it/.test(r.intro) && /the channel C0DEF456/.test(r.where) && r.button === 'Copy and open Slack', r);
    await b.eval(`_asked.length = 0; _opened.length = 0; document.getElementById('spOpen').click(); return 1`); await sleep(400);
    t.check('with a channel kept, it doesn’t ask again', await b.eval(`return _asked.length === 0 && _opened[0] === 'slack://channel?team=T0ABC123&id=C0DEF456'`));
    // A link copied in Slack (no workspace id in it): by way of the browser.
    await b.eval(`openSlackPost(${pr}); return 1`); await sleep(500);
    await b.eval(`window._answer = 'https://latitude.slack.com/archives/C0DEF456'; document.querySelector('[data-sp="channel"]').click(); return 1`); await sleep(300);
    t.check('Change takes a link copied in Slack, which goes by way of the browser', await b.eval(`return /by way of your browser/.test(document.getElementById('spWhere').textContent)`));
    await b.eval(`_opened.length = 0; document.getElementById('spOpen').click(); return 1`); await sleep(400);
    t.check('and opens it', await b.eval(`return _opened[0] === 'https://latitude.slack.com/archives/C0DEF456'`));
    // Not a Slack link: it says so and keeps the channel it had.
    await b.eval(`openSlackPost(${pr}); return 1`); await sleep(500);
    await b.eval(`window._answer = 'https://example.com/not-slack'; document.querySelector('[data-sp="channel"]').click(); return 1`); await sleep(300);
    t.check('a link that isn’t Slack’s is turned down, and the channel stays', await b.eval(`return localStorage.getItem('slack-channel') === 'https://latitude.slack.com/archives/C0DEF456' && /isn’t a Slack channel’s link/.test(document.getElementById('toast').textContent)`));
    await b.eval(`document.getElementById('spDlg').close(); return 1`);
  },
}, {
  name: 'pr notices',
  // What changed on your pull requests (from the PC's watcher): a notice with a button to the PR in Your work, several
  // at once as one notice, and the welcome-back card's own line and buttons. Setup has the switch, on to start with.
  async run(t) {
    const base = responder();
    const ev = (kind, n, title, body, action) => ({ id: `${kind}:${n}`, kind, at: Date.now() - 60000, repo: 'o/r', number: n, url: `https://github.com/o/r/pull/${n}`, title, body, action });
    const away = [ev('checks-failed', 7, 'Checks failed on #7', 'Faster lists · 1 failing (Lint)', 'See what failed'), ev('approved', 8, '#8 was approved', 'sam approved Cache it', 'Open it')];
    const b = await t.open({ respond: (p, q, body) => (p === '/api/away' ? { body: { files: 0, reviews: [], kept: [], prs: away } } : base(p, q, body)) });
    await sleep(600);
    await b.eval(`window._opened = []; openWorkPr = async u => { _opened.push(u); }; return 1`);
    await b.eval(`prEventsArrived([${JSON.stringify(away[0])}]); return 1`); await sleep(400);
    const one = await b.eval(`const t = document.getElementById('toaster'); return { text: t.textContent, button: [...t.querySelectorAll('button')].map(x => x.textContent.trim()).find(x => x === 'See what failed') || null }`);
    t.check('a change on your PR is a notice saying what happened, with its button', one.text.includes('Checks failed on #7: Faster lists · 1 failing (Lint)') && one.button === 'See what failed', one);
    await b.eval(`[...document.querySelectorAll('#toaster button')].find(x => x.textContent.trim() === 'See what failed').click(); return 1`); await sleep(300);
    t.check('which opens that PR in Your work', (await b.eval(`return _opened`))[0] === 'https://github.com/o/r/pull/7');
    await b.eval(`prEventsArrived(${JSON.stringify([...away, ev('comments', 9, '2 new comments on #9', 'Lists', 'See the comments')])}); return 1`); await sleep(400);
    t.check('several at once are one notice', /3 changes on your pull requests/.test(await b.eval(`return document.getElementById('toaster').textContent`)));

    // Back after a while: the welcome-back card says so, with a button for each.
    await b.eval(`await go('hub'); store('seen-at', String(Date.now() - 3600000)); Welcome.card = null; checkAway(); return 1`); await sleep(1200);
    const card = await b.eval(`const w = document.querySelector('.welcome'); return w ? { text: w.textContent.replace(/\\s+/g, ' '), chips: [...w.querySelectorAll('[data-welcome="pr"]')].map(x => x.textContent.trim()) } : null`);
    t.check('the welcome-back card counts them and has a button for each', !!card && /2 things happened on your pull requests/.test(card.text) && card.chips.join('|') === 'Checks failed on #7|#8 was approved', card);
    await b.eval(`_opened.length = 0; document.querySelector('.welcome [data-welcome="pr"]').click(); return 1`); await sleep(400);
    t.check('a button there opens the PR, and the card goes', (await b.eval(`return _opened`))[0] === 'https://github.com/o/r/pull/7' && await b.eval(`return !document.querySelector('.welcome')`));

    await b.eval(`await openSetup(); return 1`); await sleep(800);
    t.check('Setup has the switch, on to start with', await b.eval(`const c = document.querySelector('#setupBody input[data-pref="prNotices"]'); return !!c && c.checked`));
    await b.eval(`document.getElementById('setup').close(); return 1`);
  },
}, {
  name: 'open a pull request link',
  // Your work's Open a pull request takes a whole GitHub link (they're longer than a name box's 40 characters).
  async run(t) {
    const b = await t.open({ respond: responder() });
    await sleep(600);
    await b.eval(`await go('work'); return 1`); await sleep(1500);
    await b.eval(`openWorkPr(); return 1`); await sleep(400);
    const r = await b.eval(`const i = document.getElementById('dlgInput'); return { open: document.getElementById('dlg').open, max: i.maxLength }`);
    t.check('its box takes a whole PR link', r.open && r.max >= 200, r);
    await b.eval(`document.getElementById('dlg').close(); return 1`);
  },
}, {
  name: 'pc check-up',
  // PC check-up from Setup: what's running and what's taking space, Claude's word on each, a tick on each that can be
  // closed or cleared (Windows' own and Session Switcher's can't), and only what's ticked goes, after a confirmation. A
  // program that's still open after being asked can be forced, after another confirmation. (The PC's answers are stood
  // in for here: nothing is closed.)
  async run(t) {
    const base = responder(), acts = [];
    const scan = { supported: true, at: Date.now(), memGB: 32, drives: [{ id: 'C:', sizeGB: 950, freeGB: 120.5 }],
      processes: [
        { id: 'p:slack.exe', kind: 'process', name: 'Slack.exe', label: 'Slack', memMB: 1800, cpu: 0, count: 7, since: Date.now() - 3 * 864e5, hung: false, protected: null },
        { id: 'p:frozen.exe', kind: 'process', name: 'Frozen.exe', label: 'Frozen Tool', memMB: 300, cpu: 0, count: 1, since: Date.now() - 3600e3, hung: true, protected: null },
        { id: 'p:svchost.exe', kind: 'process', name: 'svchost.exe', label: '', memMB: 2500, cpu: 4, count: 99, since: 0, hung: false, protected: 'Windows needs this' },
      ],
      space: [{ id: 's:tests', label: 'Session Switcher’s test leftovers', note: 'folders its tests left', how: 'delete', bytes: 2.5 * 1024 ** 3, newest: Date.now() - 7 * 864e5, count: 3604, partial: true }] };
    const notes = { 'p:slack.exe': { what: 'Slack, the chat app', advice: 'careful', why: 'Idle for days' }, 's:tests': { what: 'Old test folders', advice: 'close', why: '' } };
    let still = true;
    const b = await t.open({ respond: (p, q, body) => {
      if (p === '/api/pc/scan') return { body: scan };
      if (p === '/api/pc/explain') return { body: { notes, signedIn: true } };
      if (p === '/api/pc/act') { acts.push(body); const close = (body.close || []).map(id => ({ id, name: id, ok: !!body.force || !still, still: body.force ? 0 : 1, said: body.force ? 'closed' : 'asked to close, still open (a Save prompt, maybe)' })); return { body: { results: [...close, ...(body.free || []).map(id => ({ id, name: id, ok: true, said: 'cleared' }))], freed: (body.free || []).length ? 2.5 * 1024 ** 3 : 0 } }; }
      return base(p, q, body);
    } });
    await sleep(600);
    await b.eval(`await openSetup(); return 1`); await sleep(800);
    await b.eval(`document.querySelector('#setupBody [data-fix="pccheck"]').click(); return 1`); await sleep(1500);
    const r = await b.eval(`const d = document.getElementById('pcDlg'); return { open: d.open, rows: [...d.querySelectorAll('.pck-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), locked: [...d.querySelectorAll('.pck-row.locked input')].map(i => i.disabled), heads: [...d.querySelectorAll('.pck-h')].map(h => h.textContent), go: document.getElementById('pcGo').disabled }`);
    t.check('Setup’s Check my PC opens it, with what’s not responding first, then programs and space', r.open && r.heads.join('|') === 'Not responding|Programs using the most|Space you can free', r.heads);
    t.check('each line says what it is (Claude’s word), the facts, and what to do', r.rows.some(x => /Slack.*Save your work first.*Slack, the chat app. Idle for days.*1.8 GB.*7 processes/.test(x)) && r.rows.some(x => /test leftovers.*Safe to clear.*over 2.5 GB.*deleted for good/.test(x)), r.rows);
    t.check('Windows’ own can’t be ticked, and nothing is ticked to start with', r.locked.length === 1 && r.locked[0] === true && r.go === true, r);
    await b.eval(`window.appConfirm = async () => true; document.querySelector('[data-pick="p:slack.exe"]').click(); document.querySelector('[data-pick="s:tests"]').click(); return 1`); await sleep(200);
    t.check('the button says what it’ll do', await b.eval(`return document.getElementById('pcGo').textContent`) === 'Close 1 and clear 2.5 GB…');
    await b.eval(`document.getElementById('pcGo').click(); return 1`); await sleep(1500);
    t.check('only what was ticked is sent', JSON.stringify(acts[0]) === JSON.stringify({ close: ['p:slack.exe'], free: ['s:tests'], at: scan.at }), acts[0]);
    t.check('one still open after being asked can be forced', await b.eval(`return !!document.querySelector('#pcDlg [data-pc="force"]')`));
    await b.eval(`document.querySelector('#pcDlg [data-pc="force"]').click(); return 1`); await sleep(1500);
    t.check('Force close sends that one, forced', JSON.stringify(acts[1]) === JSON.stringify({ close: ['p:slack.exe'], force: true, at: scan.at }), acts[1]);
    await t.shot(b, 'pc-checkup');
    await b.eval(`document.getElementById('pcDlg').close(); openPalette(); document.getElementById('palQ').value = 'free up space'; document.getElementById('palQ').dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(400);
    t.check('Ctrl+K finds it', /PC check-up/.test(await b.eval(`const t = document.getElementById('palList').textContent; closePalette(); return t`)));
  },
}];
