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
}];
