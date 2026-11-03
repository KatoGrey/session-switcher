'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sleep } = require('./browser');
const game = { title: 'Where Winds Meet', process: 'wwm', path: 'C:/Steam/steamapps/common/Where Winds Meet/wwm.exe', fullscreen: true };
async function waitFor(b, expr) {
  for (let i = 0; i < 100; i++) { if (await b.eval(`return !!(${expr})`)) return; await sleep(100); }
  throw new Error(`Timed out: ${expr}`);
}
async function panel(t, calls, width = 760) {
  const b = await t.open({ aide: true, desktopStub: {}, noHistory: true, path: '?solo=1&aide=1', width, height: 530, seen: (p, u, body) => calls.push([p, body]) });
  await waitFor(b, 'window.aideBooted');
  await b.eval(`window.__show({ app: ${JSON.stringify(game)}, moved: false });`);
  await waitFor(b, 'C.key && !Aide.opening');
  return b;
}

module.exports = [
  {
    name: 'companion: recent questions and notes',
    async run(t) {
      const calls = [], b = await panel(t, calls);
      await b.eval(`document.getElementById('cText').value = 'A draft for my sword build'; document.getElementById('cText').dispatchEvent(new Event('input', { bubbles: true })); C.attachments = [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]; renderAttachments();`);
      await b.clickOn('#aoBrowse');
      t.check('the game name opens recent questions without losing the draft', await b.eval(`return !document.getElementById('aoDrawer').hidden && document.querySelectorAll('[data-aide-recent]').length === 6 && document.getElementById('cText').value === 'A draft for my sword build'`));
      t.check('this game comes first and the current conversation is marked', await b.eval(`const rows = [...document.querySelectorAll('[data-aide-recent]')]; return rows[0].dataset.aideRecent === 'aide-1' && rows[0].getAttribute('aria-current') === 'true'`));
      await t.shot(b, 'recent');
      await b.eval(`const q = document.getElementById('aoRecentQ'); q.value = 'Liurnia'; q.dispatchEvent(new Event('input', { bubbles: true }));`);
      t.check('search finds an older conversation in another game', await b.eval(`return document.querySelectorAll('[data-aide-recent]').length === 1 && document.querySelector('[data-aide-recent]').dataset.aideRecent === 'aide-4'`));
      await b.clickOn('[data-aide-recent="aide-4"]');
      await waitFor(b, 'C.sessionId === "aide-4" && !Aide.opening');
      t.check('the selected question opens in place, with the right game', await b.eval(`return document.getElementById('aoName').textContent === 'Elden Ring' && document.getElementById('aoDrawer').hidden`));
      t.check('another conversation does not inherit the previous draft or picture', await b.eval(`return document.getElementById('cText').value === '' && C.attachments.length === 0`));
      await b.clickOn('#aoBrowse');
      await b.eval(`const q = document.getElementById('aoRecentQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.clickOn('[data-aide-recent="aide-1"]'); await waitFor(b, 'C.sessionId === "aide-1" && !Aide.opening');
      t.check('returning restores the original draft and attachment', await b.eval(`return document.getElementById('cText').value === 'A draft for my sword build' && C.attachments.length === 1`));
      await b.clickOn('#aoBrowse'); await b.clickOn('[data-aide-tab="notes"]');
      await waitFor(b, 'Aide.notebooks.get("where-winds-meet").loaded');
      await b.eval(`const n = document.getElementById('aiNoteText'); n.value = 'Sword build. PC. No story spoilers.'; n.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.esc();
      t.check('Escape returns to the chat before hiding the overlay', await b.eval(`return document.getElementById('aoDrawer').hidden && !window.__asked.some(x => x[0] === 'hide')`));
      await b.clickOn('#aoBrowse'); await b.clickOn('[data-aide-tab="notes"]');
      t.check('unsaved notes survive closing and reopening the drawer', await b.eval(`return document.getElementById('aiNoteText').value === 'Sword build. PC. No story spoilers.'`));
      await b.clickOn('#aiNoteSave');
      await waitFor(b, 'Aide.notebooks.get("where-winds-meet").version === 1');
      t.check('saving is explicit and bound to this game', calls.some(([p, x]) => p === '/api/aide/notes' && x.group === 'where-winds-meet' && x.version === 0 && /Sword build/.test(x.text)));
      await t.shot(b, 'notes');
      // Another window saved while this editor remained open.
      await b.eval(`await api('/api/aide/notes', { group: 'where-winds-meet', text: 'Saved elsewhere', version: 1 }); const n = document.getElementById('aiNoteText'); n.value = 'My newer draft'; n.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.clickOn('#aiNoteSave');
      await waitFor(b, 'Aide.notebooks.get("where-winds-meet").error');
      t.check('a stale editor explains the conflict and keeps the typed notes', await b.eval(`return /another window/.test(document.getElementById('aiNoteStatus').textContent) && document.getElementById('aiNoteText').value === 'My newer draft'`));
      await b.clickOn('[data-aide-note-reload]');
      await waitFor(b, 'Aide.notebooks.get("where-winds-meet").version === 2');
      t.check('loading the saved version is deliberate', await b.eval(`return document.getElementById('aiNoteText').value === 'Saved elsewhere'`));
      await b.eval(`const n = document.getElementById('aiNoteText'); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.clickOn('#aiNoteSave'); await waitFor(b, 'Aide.notebooks.get("where-winds-meet").version === 3');
      t.check('notes can be cleared', await b.eval(`return Aide.notebooks.get('where-winds-meet').saved === '' && /No saved notes/.test(document.getElementById('aiNoteStatus').textContent)`));
      await b.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 480, deviceScaleFactor: 1, mobile: false });
      await sleep(100);
      t.check('notes controls fit the narrow overlay and can be reached', await b.eval(`const x = document.getElementById('aiNoteSave').getBoundingClientRect(), a = document.getElementById('aoDrawerBody'); return x.left >= 10 && x.right <= innerWidth - 10 && a.clientWidth >= a.scrollWidth`));
      await t.shot(b, 'notes-narrow');
      await b.eval(`document.documentElement.dataset.mode = 'light';`);
      await t.shot(b, 'notes-light');
      await b.eval(`document.documentElement.dataset.mode = 'dark';`);
      await b.clickOn('[data-aide-back]');
      await b.eval(`const nl = String.fromCharCode(10); handle({ kind: 'user', text: '<companion-notes>' + nl + JSON.stringify({ group: 'Where Winds Meet', notes: 'Sword build <script>literal</script>', version: 1 }) + nl + '</companion-notes>' + nl + nl + 'Is this useful?', at: new Date().toISOString() }, 'main');`);
      t.check('sent notes are inspectable without becoming the visible question', await b.eval(`const m = document.querySelector('#cFeed .umsg:last-child'); return m && m.querySelector('.utext').textContent === 'Is this useful?' && /Sword build/.test(m.querySelector('.aide-notes').textContent) && !m.querySelector('script')`));
      await b.clickOn('[data-ao="new"]'); await waitFor(b, 'C.sessionId && C.sessionId.startsWith("aide-new-") && !Aide.opening');
      t.check('New question is explicit and stays in the same game', calls.some(([p, x]) => p === '/api/aide/open' && x.fresh && x.group === 'where-winds-meet'));
    },
  },
  {
    name: 'companion: notes in the app stay with their group',
    async run(t) {
      const calls = [], b = await t.open({ aide: true, width: 1120, seen: (p, u, body) => calls.push([p, body]) });
      await waitFor(b, 'window.aideBooted');
      await b.clickOn('[data-view="aide"]');
      await b.clickOn('[data-aide-notes="where-winds-meet"]');
      await waitFor(b, 'Aide.notebooks.get("where-winds-meet").loaded');
      await b.eval(`const n = document.getElementById('aiNoteText'); n.value = 'Game-specific progress'; n.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.esc();
      await b.clickOn('[data-aide-notes="general"]');
      await waitFor(b, 'Aide.notebooks.get("general").loaded');
      t.check('General starts with its own notes', await b.eval(`return document.getElementById('aiNoteText').value === '' && /personal notes/.test(document.querySelector('#aiNotebook label').textContent)`));
      await b.eval(`const n = document.getElementById('aiNoteText'); n.value = 'Explain unfamiliar terms'; n.dispatchEvent(new Event('input', { bubbles: true }));`);
      await b.clickOn('#aiNoteSave'); await waitFor(b, 'Aide.notebooks.get("general").version === 1');
      await t.shot(b, 'app-notes');
      await b.clickOn('#aiNotesDialog form button');
      await b.clickOn('[data-aide-notes="where-winds-meet"]');
      t.check('switching groups keeps the unsaved game draft', await b.eval(`return document.getElementById('aiNoteText').value === 'Game-specific progress'`));
      await b.clickOn('#aiNoteSave'); await waitFor(b, 'Aide.notebooks.get("where-winds-meet").version === 1');
      t.check('each Save uses the editor’s group', calls.some(([p, x]) => p === '/api/aide/notes' && x.group === 'general' && x.text === 'Explain unfamiliar terms') && calls.some(([p, x]) => p === '/api/aide/notes' && x.group === 'where-winds-meet' && x.text === 'Game-specific progress'));
    },
  },
  {
    name: 'companion: a failed switch keeps the current question',
    async run(t) {
      const calls = [], b = await panel(t, calls);
      await b.eval(`window.__realApi = api; window.__beforeKey = C.key; api = async (url, ...args) => { if (url === '/api/aide/open') { await new Promise(r => setTimeout(r, 100)); throw new Error('Could not open this assistant'); } return window.__realApi(url, ...args); }; const text = document.getElementById('cText'); text.value = 'Do not send this to the previous chat'; text.dispatchEvent(new Event('input', { bubbles: true })); aidePickModel('gemini', 'gemini-4-argon-high'); text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);
      await waitFor(b, '!Aide.opening');
      t.check('failure preserves the draft and current assistant', await b.eval(`return C.key === window.__beforeKey && Aide.who === 'claude:opus' && document.getElementById('aoMName').textContent === 'Opus 5.5' && document.getElementById('cText').value === 'Do not send this to the previous chat'`));
      t.check('a queued Enter does not send to the wrong assistant', !calls.some(([p]) => p === '/api/chat/send'));
      t.check('a failed switch does not change the default assistant', !calls.some(([p]) => p === '/api/aide/settings'));
      await b.eval('api = window.__realApi;');
      await b.clickOn('#aoBrowse');
      await b.clickOn('[data-aide-recent="aide-3"]');
      await waitFor(b, 'C.sessionId === "aide-3" && !Aide.opening');
      t.check('opening an older Gemini question selects its actual assistant and model', await b.eval(`return C.provider === 'gemini' && Aide.who === 'gemini:gemini-4-argon-medium' && document.getElementById('aoMName').textContent === 'Gemini 4 Argon (Medium)'`));
    },
  },
  {
    name: 'companion: region capture attaches only a chosen crop',
    async run(t) {
      const calls = [], b = await panel(t, calls, 440);
      await b.clickOn('#aoLookMore');
      t.check('capture options offer the whole screen and a region', await b.eval(`return /Whole screen/.test(document.getElementById('menu').textContent) && /Choose a region/.test(document.getElementById('menu').textContent)`));
      await b.eval(`const original = window.desktop.aide.ask; window.__regionReply = null; window.desktop.aide.ask = async (w,v) => { if (w !== 'region') return original(w,v); window.__asked.push([w,v]); return window.__regionReply; }; [...document.querySelectorAll('#menu button')].find(x => /Choose a region/.test(x.textContent)).click();`);
      await sleep(200);
      t.check('cancelling selection attaches nothing and restores the controls', await b.eval(`return C.attachments.length === 0 && !document.getElementById('aoLook').disabled && !document.getElementById('aoLookMore').disabled`));
      await b.eval(`window.__regionReply = { mediaType: 'image/png', data: 'CROPPED_ONLY' }; await aideCapture(true);`);
      t.check('the chosen crop is visible as an attachment before sending', await b.eval(`return C.attachments.length === 1 && C.attachments[0].data === 'CROPPED_ONLY' && document.querySelectorAll('#cAtt img').length === 1`));
      t.check('capturing never sends the question automatically', !calls.some(([p]) => p === '/api/chat/send'));
      await b.eval(`window.__regionReply = { error: 'Could not capture this display.' }; await aideCapture(true);`);
      t.check('capture failures keep existing attachments', await b.eval(`return C.attachments.length === 1 && /Could not capture/.test(document.getElementById('toast').textContent)`));
    },
  },
  {
    name: 'companion: region selection with mouse and keyboard',
    async run(t) {
      const b = await t.open({ demo: false, width: 800, height: 600 });
      await b.intercept('http://region.test/*', url => {
        const name = new URL(url).pathname.slice(1);
        if (!['aide-region.html', 'aide-region.css', 'aide-region-ui.js'].includes(name)) return { status: 404, body: '' };
        return { type: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(__dirname, '../desktop/shell', name)) };
      });
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__selections = []; window.regionCapture = { shown() {}, select: r => window.__selections.push(r), ready: f => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#29333b'; x.fillRect(0,0,1600,1200); x.fillStyle = '#b9b3a0'; x.fillRect(250,300,900,500); f(c.toDataURL()); } };` });
      await b.nav('http://region.test/aide-region.html', 400);
      await waitFor(b, 'document.getElementById("screen").complete');
      await b.key('Enter', 'Enter', 13);
      t.check('Enter cannot attach the whole screen before a selection', await b.eval('return window.__selections.length === 0'));
      for (const p of [{ type: 'mousePressed', x: 600, y: 420 }, { type: 'mouseMoved', x: 200, y: 180 }, { type: 'mouseReleased', x: 200, y: 180 }]) await b.send('Input.dispatchMouseEvent', { ...p, button: 'left', buttons: p.type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      t.check('dragging backwards makes the intended rectangle and focuses confirmation', await b.eval(`const r = document.getElementById('selection').getBoundingClientRect(); return r.x === 200 && r.y === 180 && r.width === 400 && r.height === 240 && document.activeElement.id === 'use'`));
      await t.shot(b, 'region');
      await b.key('Enter', 'Enter', 13);
      t.check('confirming passes normalized coordinates only', await b.eval(`const r = window.__selections[0]; return window.__selections.length === 1 && r.x === .25 && r.y === .3 && r.width === .5 && r.height === .4 && !r.data`));
      await b.nav('http://region.test/aide-region.html', 300); await b.esc();
      t.check('Escape cancels without selecting or attaching anything', await b.eval('return window.__selections.length === 1 && window.__selections[0] === null'));
    },
  },
];
