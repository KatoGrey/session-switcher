const { sleep } = require('./browser');
const demo = require('./demo');
const { responder } = require('./work.ui');

module.exports = [{
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
    // Imperial keeps its own layout, switch or not.
    await b.eval(`Look.set({ theme: 'imperial' }); ChatUI.open({ sessionId: ${id} }); return 1`); await sleep(2200);
    r = await shape();
    t.check('Imperial keeps its chat list and layout', r.rail && r.chatLeft === 0, r);
    await b.eval(`ChatUI.close(); Shell.setNext(false); Look.reset(); return 1`);
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
