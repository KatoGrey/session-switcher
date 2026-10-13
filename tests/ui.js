// What a person sees and does: menus, dialogs, the chat window, the model picker, themes and the
// phone layout. Each suite drives a real (headless) browser with real clicks and key presses,
// against the demo world in demo.js, so the results never depend on anyone's own chats.
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./browser');
const demo = require('./demo');

const confirmOpen = `document.getElementById('confirmDlg')?.open`;
const promptOpen = `document.getElementById('promptDlg')?.open`;
const menuOpen = `!document.getElementById('menu').hidden`;
const typeIntoPrompts = `const t = document.querySelector('#promptDlg textarea, #promptDlg input'); t.focus(); t.value += ' edited'; t.dispatchEvent(new Event('input', { bubbles: true })); return 1`;
const contrast = (a, c) => {
  const lum = s => { const v = s.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

module.exports = [
  {
    name: 'dialogs',
    async run(t) {
      const b = await t.open();
      // Before any click on the page a browser won't hold a dialog open on Esc; the editor comes back to ask.
      await b.eval(`openPromptEditor(); return 1`); await sleep(400);
      await b.eval(typeIntoPrompts);
      await b.esc(); await sleep(200);
      t.check('prompts: Esc with unsaved edits asks first', await b.eval(`return ${confirmOpen} && ${promptOpen}`));
      await b.esc(); await sleep(200);
      t.check('prompts: Esc on the question keeps editing', await b.eval(`return !${confirmOpen} && ${promptOpen}`));
      await b.esc(); await sleep(200);
      t.check('prompts: asks again on the next Esc', await b.eval(`return ${confirmOpen} && ${promptOpen}`));
      await b.clickOn('#cfYes'); await sleep(200);
      t.check('prompts: Discard closes it', await b.eval(`return !${promptOpen} && !${confirmOpen}`));
      await b.eval(`openPromptEditor(); return 1`); await sleep(400);
      await b.eval(typeIntoPrompts);
      await b.esc();
      await b.clickOn('#cfNo'); await sleep(200);
      t.check('prompts: Keep editing keeps it open', await b.eval(`return ${promptOpen} && !${confirmOpen}`));
      await b.eval(`document.getElementById('promptDlg').dataset.dirty = ''; document.getElementById('promptDlg').close(); return 1`);
      await b.eval(`openPromptEditor(); return 1`); await sleep(300); await b.esc();
      t.check('prompts: no edits closes at once', await b.eval(`return !${promptOpen} && !${confirmOpen}`));

      await b.eval(`window._r = 'pending'; appConfirm('Remove it?\\n\\nIt goes away.', { ok: 'Remove', danger: true }).then(v => window._r = v); return 1`); await sleep(200);
      const d = await b.eval(`return { open: ${confirmOpen}, q: document.getElementById('cfQ').textContent, x: document.getElementById('cfX').textContent, focus: document.activeElement.id, cls: document.getElementById('cfYes').className }`);
      t.check('confirm: question and explanation', d.open && d.q === 'Remove it?' && d.x === 'It goes away.', d);
      t.check('confirm: dangerous ones start on Cancel', d.focus === 'cfNo' && /danger-prime/.test(d.cls), d);
      await b.esc();
      t.check('confirm: Esc answers no', (await b.eval(`return window._r`)) === false);
      // Asked right after another: the answer belongs to this question only.
      await b.eval(`window._r = 'pending'; appConfirm('Go?', { ok: 'Go' }).then(v => window._r = v); return 1`); await sleep(150);
      await b.clickOn('#cfYes');
      t.check('confirm: OK answers yes', (await b.eval(`return window._r`)) === true);
      // Enter confirms: an ordinary question, and a box asking for a name (it used to land on Cancel).
      const enter = async () => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(200); };
      await b.eval(`window._r = 'pending'; appConfirm('Go on?', { ok: 'Go on' }).then(v => window._r = v); return 1`); await sleep(150);
      await enter();
      t.check('confirm: Enter answers yes', (await b.eval(`return window._r`)) === true);
      await b.eval(`window._r = 'pending'; ask('Rename chat', 'A new name.', 'Old name', 'Rename', { maxLength: 120 }).then(v => window._r = v); return 1`); await sleep(150);
      await b.send('Input.insertText', { text: 'New name' }); await sleep(50);
      await enter();
      t.check('rename: Enter renames', (await b.eval(`return window._r`)) === 'New name', await b.eval(`return window._r`));
      await b.eval(`window._r = 'pending'; ask('Rename chat', 'A new name.', '', 'Rename').then(v => window._r = v); return 1`); await sleep(150);
      await enter();
      t.check('rename: Enter on an empty name keeps asking', (await b.eval(`return window._r === 'pending' && document.getElementById('dlg').open`)));
      await b.clickOn('#dlg [data-close-dlg]'); await sleep(200);
      t.check('rename: Cancel still cancels', (await b.eval(`return window._r === null && !document.getElementById('dlg').open`)));
    },
  },
  {
    name: 'menus',
    async run(t) {
      const b = await t.open();
      const st = () => b.eval(`return { open: ${menuOpen}, view: S.view, first: (document.querySelector('#menu .m-l') || {}).textContent || '' }`);
      const card = await b.eval(`const el = document.querySelector('#atlas > [data-k] .w-body'); el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return [q.left + 40, q.top + 30]`);
      await sleep(300);
      await b.click(card[0], card[1], 'right');
      t.check('right-click opens a menu', (await st()).open);
      await b.click(1300, 120);
      t.check('a click elsewhere closes it', !(await st()).open);
      await b.click(card[0], card[1], 'right');
      const navP = await b.eval(`const q = document.querySelector('.nav-i[data-cwd]').getBoundingClientRect(); return [q.left + 60, q.top + 10]`);
      await b.click(navP[0], navP[1], 'right');
      t.check('a right-click elsewhere opens that spot’s menu', (await st()).open);
      const recent = await b.eval(`const q = document.querySelector('.nav-i[data-view="recent"]').getBoundingClientRect(); return [q.left + 40, q.top + 10]`);
      await b.click(recent[0], recent[1]);
      const s1 = await st();
      t.check('closing click doesn’t press what’s underneath', !s1.open && s1.view === 'hub', s1);
      await b.click(card[0], card[1], 'right');
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', text: 'c' }); await sleep(100);
      t.check('typing a letter jumps to an item', /^c/i.test(await b.eval(`return document.activeElement.querySelector('.m-l')?.textContent || ''`)));
      await b.esc();
      t.check('Esc closes', !(await st()).open);
      await b.click(card[0], card[1], 'right');
      t.check('labels line up', (await b.eval(`return new Set([...document.querySelectorAll('#menu .m-l')].map(x => Math.round(x.getBoundingClientRect().left))).size`)) === 1);
      await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 500, deltaX: 0, deltaY: 120 }); await sleep(200);
      t.check('the wheel closes it', !(await st()).open);
      await b.click(card[0], card[1], 'right');
      await b.eval(`window.dispatchEvent(new Event('blur')); return 1`);
      t.check('leaving the window closes it', !(await st()).open);
      await b.eval(`window.scrollTo(0, 0); return 1`); await sleep(300);
      await b.clickOn('#livepill'); await sleep(250);
      await b.clickOn('#seal'); await sleep(300);
      t.check('one click switches to another menu', await b.eval(`return ${menuOpen} && document.getElementById('seal').getAttribute('aria-expanded') === 'true' && document.getElementById('livepill').getAttribute('aria-expanded') === 'false'`));
      await b.esc();
      t.check('focus returns to its button', await b.eval(`return !${menuOpen} && document.activeElement.id === 'seal'`));
      await b.clickOn('#seal'); await sleep(250);
      await b.clickOn('#seal'); await sleep(250);
      t.check('its button again closes it', !(await st()).open);
    },
  },
  {
    name: 'chat',
    async run(t) {
      const calls = [];
      const b = await t.open({ state: 'busy', seen: p => calls.push(p) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      t.check('the page knows the message box height', /^[1-9]\d*px$/.test((await b.eval(`return getComputedStyle(document.documentElement).getPropertyValue('--dock-h')`)).trim()));
      await b.eval(`toast('Hello there'); return 1`); await sleep(400);
      const tp = await b.eval(`return [document.getElementById('toast').getBoundingClientRect().bottom, document.querySelector('.c-dock').getBoundingClientRect().top]`);
      t.check('toasts sit above the message box', tp[0] <= tp[1] + 1, tp);
      await t.shot(b, 'chat');

      await b.eval(`document.getElementById('cText').focus(); return 1`);
      const stops = () => calls.filter(c => c === '/api/chat/interrupt').length;
      await b.esc();
      t.check('Esc once only asks', /Esc again/.test(await b.eval(`return document.getElementById('cEscArm')?.textContent || ''`)) && stops() === 0);
      await b.esc(); await sleep(300);
      t.check('Esc twice stops the reply', stops() === 1 && !(await b.eval(`return !!document.getElementById('cEscArm')`)));
      await b.esc(); await sleep(1900);
      t.check('the hint goes away by itself', !(await b.eval(`return !!document.getElementById('cEscArm')`)));

      await b.clickOn('[data-c="more"]'); await sleep(300);
      const items = await b.eval(`return [...document.querySelectorAll('#menu .m-l')].map(x => x.textContent)`);
      t.check('⋯ has the terminal hand-off and Stop', items.some(x => /Move to a terminal/.test(x)) && items.some(x => /Stop this chat/.test(x)), items);
      await b.eval(`[...document.querySelectorAll('#menu [role=menuitem]')].find(x => /Stop this chat/.test(x.textContent)).click(); return 1`); await sleep(300);
      t.check('Stop asks while a reply is coming', await b.eval(`return ${confirmOpen} && /Stop this chat/.test(document.getElementById('cfQ').textContent)`));
      await b.esc();
      t.check('answering no stops nothing', !calls.includes('/api/chat/stop'));

      await b.clickOn('[data-crew="main"]'); await sleep(700);
      const f1 = await b.eval(`return { open: !document.getElementById('cPick').hidden, inside: document.getElementById('cPick').contains(document.activeElement), f: document.activeElement.textContent.trim().slice(0, 40) }`);
      t.check('model picker takes the keyboard', f1.open && f1.inside, f1);
      await b.down();
      t.check('arrows move between choices', (await b.eval(`return document.activeElement.textContent.trim().slice(0, 40)`)) !== f1.f);
      await t.shot(b, 'picker');
      await b.esc();
      t.check('Esc closes it and gives focus back', await b.eval(`return document.getElementById('cPick').hidden && document.activeElement.matches('[data-crew="main"]') && ChatUI.isOpen()`));

      // A pasted screenshot previews in the message box (it used to show a broken picture).
      const r = await b.eval(`window._csp = []; document.addEventListener('securitypolicyviolation', e => _csp.push(e.violatedDirective));
        const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#4aa3df'; g.fillRect(20, 20, 200, 30);
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        document.getElementById('cText').focus(); document.getElementById('cText').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await new Promise(res => setTimeout(res, 1200));
        const img = document.querySelector('#cAtt .att img');
        if (!img) return { loaded: false };
        if (!img.complete) await new Promise(res => { img.onload = img.onerror = res; setTimeout(res, 2000); });
        return { loaded: img.naturalWidth === 320, csp: _csp };`);
      t.check('a pasted picture previews', r.loaded && !(r.csp || []).length, r);
    },
  },
  {
    name: 'context',
    async run(t) {
      const calls = [];
      const parts = [{ name: 'System prompt', tokens: 2400 }, { name: 'System tools', tokens: 11300 }, { name: 'Messages', tokens: 96000 }];
      // 110k of the 167k where Claude Code would summarize by itself: getting there (gold).
      const b = await t.open({ context: { used: 110000, max: 200000, percent: 55, autoAt: 167000, parts }, seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const ring = await b.eval(`const r = document.querySelector('[data-crew="main"] .crew-ctx'); return r && { cls: r.className, p: r.style.getPropertyValue('--p'), tip: r.closest('.crew').title }`);
      t.check('the Claude button shows how full the chat is', ring && ring.p === '66' && /warm/.test(ring.cls), ring);
      t.check('its tooltip says it in words', ring && /Context: 66% full · 110k of 167k tokens/.test(ring.tip), ring && ring.tip);
      t.check('no warning yet', !(await b.eval(`return !!document.querySelector('.ctx-warn')`)));
      await sleep(600);
      const about = await b.eval(`return document.querySelector('.lg-about')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('the This chat panel lists it', /Context ?66% full · 110k of 167k tokens/.test(about), about);

      await b.clickOn('[data-crew="main"]'); await sleep(600);
      const row = await b.eval(`const r = document.querySelector('#cPick .mp-ctx'); return r && { text: r.textContent.replace(/\\s+/g, ' '), meter: r.querySelector('[role=meter]').getAttribute('aria-valuenow') }`);
      t.check('the model picker shows the context, and what fills it', row && row.meter === '66' && /Messages 96k/.test(row.text) && /Summarize now/.test(row.text), row);
      await t.shot(b, 'picker');
      await b.clickOn('#cPick [data-c="compact"]'); await sleep(400);
      t.check('Summarize now summarizes this chat', calls.some(([p, body]) => p === '/api/chat/compact' && body.key === 'k-bard'));
      t.check('and closes the picker', await b.eval(`return document.getElementById('cPick').hidden`));

      // It gets fuller: a one-time offer to summarize between tasks.
      await b.eval(`ChatUI.close(); return 1`).catch(() => {});
      b.close();
      const calls2 = [];
      const b2 = await t.open({ context: { used: 150000, max: 200000, percent: 75, autoAt: 167000, parts }, events: [{ kind: 'context', used: 152000, max: 200000, percent: 76, autoAt: 167000, parts }], seen: (p, u, body) => calls2.push([p, body]) });
      await b2.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      t.check('nearly full: the ring turns red', /full/.test(await b2.eval(`return document.querySelector('[data-crew="main"] .crew-ctx').className`)));
      t.check('and the chat offers to summarize, once', (await b2.eval(`return document.querySelectorAll('.ctx-warn').length`)) === 1);
      await t.shot(b2, 'warning');
      await b2.clickOn('[data-crew="main"]'); await sleep(300); await b2.esc();
      await b2.clickOn('[data-c="more"]'); await sleep(300);
      t.check('the ⋯ menu can summarize too', /Summarize the conversation now/.test(await b2.eval(`return document.getElementById('menu').textContent`)));
      await b2.esc();
      await b2.eval(`openPalette('summarize'); return 1`); await sleep(500);
      t.check('and so can Ctrl+K', /summarize the conversation now/i.test(await b2.eval(`return document.getElementById('palette').textContent`)));
      await b2.eval(`closePalette(); return 1`);
      await b2.clickOn('.ctx-warn [data-c="compact"]'); await sleep(400);
      t.check('the offer’s button summarizes, and the offer goes away', calls2.some(([p]) => p === '/api/chat/compact') && !(await b2.eval(`return !!document.querySelector('.ctx-warn')`)));
    },
  },
  {
    name: 'review',
    async run(t) {
      const calls = [];
      const songs = 'C:\\Projects\\Starfall Tavern\\scripts\\bard\\songs.lua';
      const findings = [
        { priority: 'P1', title: 'Rally still stacks through the encore', file: songs, start: 12, end: 14, body: 'The encore path re-applies `rally.bonus` without checking `rally.stacks`, so two bards still get +30%.' },
        { priority: 'P3', title: 'Name the bonus', file: null, start: null, end: null, body: 'Use a named constant instead of `0.15`.' },
      ];
      const what = 'your uncommitted changes';
      const b = await t.open({
        seen: (p, u, body) => calls.push([p, body]),
        events: [
          { kind: 'review', id: 'r1', what, state: 'running', progress: 'Running git diff' },
          { kind: 'review', id: 'r1', what, base: 'abc0000000000000000000000000000000000def', state: 'done', overall: 'Rally mostly works, but the encore path slipped through.', findings },
        ],
      });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const btn = await b.eval(`return [...document.querySelectorAll('.turn')].map(tn => ({ edits: tn.classList.contains('edits'), shown: !!tn.querySelector('.ta.rv') && getComputedStyle(tn.querySelector('.ta.rv')).display !== 'none' }))`);
      t.check('a Claude reply that changed files offers a Codex review', btn.some(x => x.edits && x.shown), btn);
      t.check('replies that changed nothing don’t', btn.filter(x => !x.edits).every(x => !x.shown), btn);

      const card = await b.eval(`const c = document.querySelectorAll('.review'); return { n: c.length, text: c[0] && c[0].textContent.replace(/\\s+/g, ' '), p: [...document.querySelectorAll('.rv-p')].map(x => x.textContent) }`);
      t.check('progress and result land in one review card', card.n === 1, card);
      t.check('it shows the summary, each finding and its place', /2 findings/.test(card.text) && /encore path slipped/.test(card.text) && /Rally still stacks through the encore/.test(card.text) && /songs\.lua:12–14/.test(card.text), card.text);
      t.check('findings show their priority', card.p.join() === 'P1,P3', card.p);
      await t.shot(b, 'card');

      await b.eval(`[...document.querySelectorAll('.turn.edits .ta.rv')].pop().click(); return 1`); await sleep(400);
      const req = calls.find(([p]) => p === '/api/chat/review');
      t.check('Review with Codex starts a fresh review of this chat, with the files it changed', req && req[1].key === 'k-bard' && req[1].files.some(f => /songs\.lua/.test(f)) && !req[1].base, req && req[1]);

      await b.clickOn('.rv-f [data-c="rvfix"]'); await sleep(300);
      const box = await b.eval(`return document.getElementById('cText').value`);
      t.check('“fix this” puts that finding in the message box, for you to check', /^Codex reviewed your uncommitted changes and found this:/.test(box) && /\[P1\] Rally still stacks through the encore \(C:\\Projects\\Starfall Tavern\\scripts\\bard\\songs\.lua:12-14\)/.test(box) && !/Name the bonus/.test(box), box);
      t.check('nothing is sent until you press Enter', !calls.some(([p]) => p === '/api/chat/send'));
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
      await b.clickOn('[data-c="rvfixall"]'); await sleep(300);
      t.check('“fix all” lists every finding', /1\. \[P1\][\s\S]*2\. \[P3\] Name the bonus/.test(await b.eval(`return document.getElementById('cText').value`)));
      await b.eval(`document.getElementById('cText').value = ''; return 1`);

      // Fix and recheck until clean runs on the PC: the button starts it there, and the card follows its
      // steps (which round, then how it ended), so it carries on whatever the window does.
      const firstId = await b.eval(`return document.querySelector('.review').dataset.rid`);
      await b.clickOn('[data-c="rvloop"]'); await sleep(400);
      const start = calls.filter(([p]) => p === '/api/chat/review-loop');
      t.check('“until clean” starts on the PC, with this review’s findings and starting point', start.length === 1 && start[0][1].review.id === firstId && /Name the bonus/.test(JSON.stringify(start[0][1].review.findings)) && start[0][1].review.base === 'abc0000000000000000000000000000000000def', start[0] && start[0][1]);
      await b.eval(`handle({ kind: 'reviewloop', id: ${JSON.stringify(firstId)}, round: 1, state: 'fixing', seq: 500 }); return 1`); await sleep(200);
      t.check('the card says which round it’s on', /Round 1 of 3/.test(await b.eval(`return document.querySelector('.review').textContent`)));
      await b.eval(`handle({ kind: 'review', id: 'recheck1', what: ${JSON.stringify(what)}, state: 'running', progress: 'Reading…', seq: 501 }); handle({ kind: 'reviewloop', id: 'recheck1', round: 1, state: 'checking', seq: 502 }); return 1`); await sleep(200);
      t.check('then Codex checks again, in a new card', !!(await b.eval(`return document.querySelector('.review[data-rid="recheck1"]')`)));
      await b.eval(`handle({ kind: 'review', id: 'recheck1', what: ${JSON.stringify(what)}, state: 'done', overall: 'The encore path is fixed.', findings: [], seq: 503 }); handle({ kind: 'reviewloop', id: 'recheck1', round: 1, state: 'end', done: 'clean', seq: 504 }); return 1`); await sleep(300);
      const end = await b.eval(`const c = document.querySelector('.review[data-rid="recheck1"]'); return c && c.textContent.replace(/\\s+/g, ' ')`);
      t.check('and once it’s clean, it says so and stops', /All clear/.test(end) && /Clean after 1 round of fixes/.test(end) && !(await b.eval(`return Review.loop`)), end);
      t.check('the window itself sends nothing to Claude', calls.filter(([p]) => p === '/api/chat/send').length === 0);
      await t.shot(b, 'clean');

      await b.clickOn('[data-c="more"]'); await sleep(300);
      t.check('the ⋯ menu offers a review', /Have Codex review the changes/.test(await b.eval(`return document.getElementById('menu').textContent`)));
      await b.esc();
      await b.eval(`openPalette('review'); return 1`); await sleep(500);
      t.check('and so does Ctrl+K', /Have Codex review this chat’s changes/.test(await b.eval(`return document.getElementById('palette').textContent`)));
    },
  },
  {
    name: 'together',
    // One conversation, two assistants: each is caught up on what it missed; "Both" asks both.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const sends = () => calls.filter(([p]) => p === '/api/chat/send').map(([, body]) => body);
      const type = async text => { await b.eval(`const ta = document.getElementById('cText'); ta.focus(); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await b.key('Enter', 'Enter', 13); await sleep(500); };

      // Writing to Claude: your words, as you wrote them. The app itself catches Claude up (lib/pairs.js).
      await type('Thanks! Use that art in the patch notes.');
      let s = sends().at(-1);
      t.check('a message to Claude goes as you wrote it', s && s.key === 'k-bard' && !s.to && s.text === 'Thanks! Use that art in the patch notes.', s);
      // As the chat shows it once caught up: only your words, with the catch-up folded away.
      const caught = '<shared-context items="2">\nYou and Codex share this chat; the user sees you both. Since you last caught up:\n\nThe user, to Codex:\nMake the key art.\n\nCodex:\nHere it is.\n</shared-context>\n\nThanks! Use that art in the patch notes.';
      await b.eval(`handle({ kind: 'user', text: ${JSON.stringify(caught)}, at: new Date().toISOString(), seq: 300 }); return 1`); await sleep(300);
      const um = await b.eval(`const u = [...document.querySelectorAll('.umsg')].pop(); return { bubble: u.querySelector('.ububble').textContent.trim(), fold: u.querySelector('details.shared summary')?.textContent, raw: RAW.get(u) }`);
      t.check('the chat shows only your words', um.bubble === 'Thanks! Use that art in the patch notes.' && um.raw === 'Thanks! Use that art in the patch notes.', um);
      t.check('with a fold-out saying what was shared', um.fold === 'Claude was caught up on 2 messages', um.fold);
      await t.shot(b, 'caught-up');

      // Switching to Codex: the message goes to this chat's partner (started if need be).
      await b.clickOn('[data-crew="comp"]'); await sleep(300);
      await type('Do number 2, please.');
      s = sends().at(-1);
      t.check('a message to Codex goes to this chat’s partner', s && s.key === 'k-bard' && s.to === 'partner' && s.text === 'Do number 2, please.', s);
      await type('@claude what do you think?');
      s = sends().at(-1);
      t.check('@claude sends just that one to Claude', s && s.key === 'k-bard' && !s.to && s.text === 'what do you think?', s);

      // Both: they take turns. One message; Claude answers, then Codex picks it up and builds on it.
      await b.clickOn('[data-crew="both"]'); await sleep(300);
      const tgt = await b.eval(`return { target: C.target, ph: document.getElementById('cText').placeholder, on: [...document.querySelectorAll('.crew.on')].map(x => x.dataset.crew).join() }`);
      t.check('“Both”: Claude answers, then Codex builds on it', tgt.target === 'both' && /Claude answers, then Codex builds on it/.test(tgt.ph) && tgt.on === 'main,comp,both', tgt);
      const n0 = sends().length;
      await type('Plan the 1.4 release together.');
      const both = sends().slice(n0);
      t.check('one message, sent once for them to take turns', both.length === 1 && both[0].to === 'both' && both[0].key === 'k-bard' && both[0].text === 'Plan the 1.4 release together.', both);
      await b.eval(`handle({ kind: 'user', text: 'Plan the 1.4 release together.', at: new Date().toISOString(), seq: 301 }); handle({ kind: 'handoff', to: 'codex', state: 'waiting', seq: 302 }); return 1`); await sleep(300);
      const wait = await b.eval(`const u = [...document.querySelectorAll('.umsg')].pop(); return { tag: u.querySelector('.to-tag')?.textContent, next: document.querySelector('[data-crew="comp"] .crew-m')?.textContent }`);
      t.check('it says Claude first, then Codex, and Codex is up next', wait.tag === 'to Claude, then Codex' && /up next/.test(wait.next || ''), wait);
      const relayed = '<shared-context items="1">\nYou and Claude share this chat; the user sees you both. Since you last caught up:\n\nClaude:\nShip on Friday.\n\nThe user sent the message below to both of you, and Claude answered it first (above). Build on that answer (check it, add what it missed, do your part) rather than repeating it.\n</shared-context>\n\nPlan the 1.4 release together.';
      await b.eval(`handle({ kind: 'assistant', mid: 'm10', at: new Date().toISOString(), model: 'claude-opus-5-5', seq: 303, blocks: [{ type: 'text', text: 'Ship on Friday.' }] }); handle({ kind: 'handoff', to: 'codex', state: 'sent', seq: 304 }); handle({ kind: 'user', relay: true, text: ${JSON.stringify(relayed)}, at: new Date().toISOString(), seq: 305 }, 'comp'); return 1`); await sleep(300);
      const ho = await b.eval(`return { handover: !!document.querySelector('.handover[data-prov="codex"]'), text: (document.querySelector('.handover')?.textContent || '').replace(/\\s+/g, ' ').trim(), dupes: [...document.querySelectorAll('.umsg')].filter(x => /Plan the 1.4 release/.test(x.textContent)).length, next: document.querySelector('[data-crew="comp"] .crew-m')?.textContent }`);
      t.check('then “Codex takes it from here”, not your message again', ho.handover && /Codex takes it from here/.test(ho.text) && ho.dupes === 1 && !/up next/.test(ho.next || ''), ho);
      await t.shot(b, 'both');

      // Esc twice stops both.
      await b.eval(`handle({ kind: 'state', state: 'busy', seq: 306 }); handle({ kind: 'state', state: 'busy', seq: 307 }, 'comp'); document.getElementById('cText').focus(); return 1`); await sleep(200);
      await b.esc(); await b.esc(); await sleep(300);
      const stops = calls.filter(([p]) => p === '/api/chat/interrupt').map(([, body]) => body.key).sort();
      t.check('Esc twice stops both', stops.join() === 'k-bard,k-bard-cx', stops);
      await b.eval(`handle({ kind: 'state', state: 'ready', seq: 308 }); handle({ kind: 'state', state: 'ready', seq: 309 }, 'comp'); return 1`);

      // Ctrl+. goes round: Claude, Codex, both.
      const seq = [];
      for (let i = 0; i < 3; i++) { await b.key('.', 'Period', 190, 2); seq.push(await b.eval(`return C.target`)); }
      t.check('Ctrl+. goes Claude → Codex → both', seq.join() === 'main,comp,both', seq);
    },
  },
  {
    name: 'lists',
    // The lists on the left keep their order while chats work, so you can click what you aimed at.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const rail = () => b.eval(`return [...document.querySelectorAll('#cRailList .ri-n')].map(x => x.textContent.trim().slice(0, 24))`);
      const push = list => b.eval(`es.dispatchEvent(new MessageEvent('activity', { data: JSON.stringify({ list: ${JSON.stringify(list)} }) })); await new Promise(r => setTimeout(r, 300)); return 1`);
      const now = await b.eval(`return S.activity.map(x => ({ ...x }))`);
      const before = await rail();
      t.check('the running chats are listed', before.length >= 3, before);
      // The server sends the busiest first, and that changes with every step a chat takes.
      await push(now.slice().reverse().map((x, i) => ({ ...x, lastEventAt: Date.now() - i * 1000 })));
      t.check('a reordered update leaves the list where it was', JSON.stringify(await rail()) === JSON.stringify(before), await rail());
      const fresh = { ...now[0], key: 'k-new', sessionId: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb', title: 'Fresh chat about maps', parentKey: null };
      await push([fresh, ...now]);
      const added = await rail();
      t.check('a new chat joins at the end', added.length === before.length + 1 && /Fresh chat/.test(added.at(-1)) && JSON.stringify(added.slice(0, -1)) === JSON.stringify(before), added);
      await push(now.slice(1));
      await push(now.slice().reverse());
      t.check('a chat that drops out for a moment comes back to its place', JSON.stringify(await rail()) === JSON.stringify(before), await rail());

      const nav = () => b.eval(`return [...document.querySelectorAll('.nav-i[data-prov="claude"]')].map(x => x.dataset.cwd)`);
      await b.eval(`ChatUI.close ? ChatUI.close() : null; go('hub'); return 1`).catch(() => {}); await sleep(800);
      const n0 = await nav();
      await b.eval(`S.projects = S.projects.slice().reverse(); renderNav(); return 1`); await sleep(200);
      t.check('the sidebar’s projects don’t swap places either', n0.length >= 3 && JSON.stringify(await nav()) === JSON.stringify(n0), [n0, await nav()]);
    },
  },
  {
    name: 'rail',
    // The chat window's list on the left: what's open now, chats pinned there, drag to reorder, right-click to close.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, url, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const names = list => b.eval(`return [...document.querySelectorAll('#${list} .ri-n')].map(x => x.textContent.trim().slice(0, 18))`);
      const push = list => b.eval(`es.dispatchEvent(new MessageEvent('activity', { data: JSON.stringify({ list: ${JSON.stringify(list)} }) })); await new Promise(r => setTimeout(r, 300)); return 1`);
      const at = (list, i) => b.eval(`const q = document.querySelectorAll('#${list} .ri')[${i}].getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]`);
      const find = async (list, re) => at(list, (await names(list)).findIndex(n => re.test(n)));
      const menu = () => b.eval(`return [...document.querySelectorAll('#menu .m-l')].map(x => x.firstChild.textContent.trim())`);
      const pick = label => b.eval(`[...document.querySelectorAll('#menu [role=menuitem]')].find(x => x.querySelector('.m-l')?.firstChild.textContent.trim() === ${JSON.stringify(label)}).click(); await new Promise(r => setTimeout(r, 400)); return 1`);
      const viewing = () => b.eval(`return ChatUI.isOpen() ? String(ChatUI.sessionId() || '').toLowerCase() : 'closed'`);
      const now = await b.eval(`return S.activity.map(x => ({ ...x }))`);

      t.check('the list is called Active now', /^Active now/.test(await b.eval(`return document.getElementById('cActH').textContent.trim()`)));
      const before = await names('cRailList');
      t.check('every open chat is in it', before.length === 4, before);

      // Drag the last one to the top.
      const from = await at('cRailList', before.length - 1), to = await at('cRailList', 0);
      const mouse = (type, x, y, buttons) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
      await mouse('mouseMoved', from[0], from[1], 0); await mouse('mousePressed', from[0], from[1], 1);
      for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', from[0], from[1] + (to[1] - 14 - from[1]) * i / 10, 1); await sleep(30); }
      await sleep(250);
      const mid = await b.eval(`const lis = [...document.querySelectorAll('#cRailList > li')]; return { order: lis.map(li => li.querySelector('.ri-n').textContent.trim().slice(0, 18)), lifted: lis.some(li => li.classList.contains('dragging') && /translateY/.test(li.style.transform)), room: lis.filter(li => !li.classList.contains('dragging') && /translateY/.test(li.style.transform)).length }`);
      t.check('while dragging, the chat follows the pointer and the others make room', JSON.stringify(mid.order) === JSON.stringify(before) && mid.lifted && mid.room === before.length - 1, mid);
      await t.shot(b, 'dragging');
      await mouse('mouseReleased', from[0], to[1] - 14, 0); await sleep(700);
      const dragged = await names('cRailList');
      t.check('dragging moves a chat', dragged.length === before.length && dragged[0] === before.at(-1), dragged);
      t.check('and doesn’t open it', (await viewing()) === demo.ID['s-bard'].toLowerCase());
      await push(now.slice().reverse().map((x, i) => ({ ...x, lastEventAt: Date.now() - i * 1000 })));
      t.check('the order you chose stays while chats work', JSON.stringify(await names('cRailList')) === JSON.stringify(dragged), await names('cRailList'));
      t.check('and is remembered', (JSON.parse(await b.eval(`return localStorage.getItem('railOrder')`)) || []).length >= 4);
      // Esc while dragging puts the chat back where it was.
      const e0 = await names('cRailList'), p0 = await at('cRailList', 0);
      await mouse('mouseMoved', p0[0], p0[1], 0); await mouse('mousePressed', p0[0], p0[1], 1);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', p0[0], p0[1] + i * 20, 1); await sleep(30); }
      await b.key('Escape', 'Escape', 27); await sleep(150);
      await mouse('mouseReleased', p0[0], p0[1], 0); await sleep(500);
      t.check('Esc puts a dragged chat back', JSON.stringify(await names('cRailList')) === JSON.stringify(e0) && (await viewing()) === demo.ID['s-bard'].toLowerCase(), await names('cRailList'));
      await b.eval(`document.getElementById('cText').blur(); return 1`);
      await b.key('ArrowUp', 'ArrowUp', 38, 1 | 8); await sleep(200);
      const moved = await names('cRailList'), was = dragged.findIndex(n => /^Balance pass/.test(n));
      t.check('Alt+Shift+↑ moves the chat you’re in up one', was > 0 && moved.findIndex(n => /^Balance pass/.test(n)) === was - 1, [dragged, moved]);

      // Right-click: pin one, and it stays even after it stops.
      let p = await find('cRailList', /^Tavern brawl/);
      await b.click(p[0], p[1], 'right');
      const items = await menu();
      t.check('right-click offers Pin and Close', items.includes('Pin to the sidebar') && items.includes('Close'), items);
      await pick('Pin to the sidebar');
      t.check('a pinned chat that’s open stays in Active now, at the top, marked ★ (not split off)', /^★Tavern brawl/.test((await names('cRailList'))[0] || '') && (await names('cPinList')).length === 0, [await names('cPinList'), await names('cRailList')]);
      t.check('so there’s no second list while it’s open', await b.eval(`return document.getElementById('cPinH').hidden`));
      await t.shot(b, 'pinned');
      await push(now.filter(x => x.key !== 'k-brawl'));
      const pin = () => b.eval(`const el = document.querySelector('#cPinList .ri'); return el && { n: el.querySelector('.ri-n').textContent, s: el.querySelector('.ri-s').textContent }`);
      const p1 = await pin();
      t.check('when it’s no longer running, it waits under “Pinned, not open”', !!p1 && /^Tavern brawl/.test(p1.n) && /^Closed/.test(p1.s) && await b.eval(`return !document.getElementById('cPinH').hidden && /Pinned, not open/.test(document.getElementById('cPinH').textContent)`), p1);

      // Close: a chat in a terminal leaves the list (it keeps running there) until it does something new.
      await push(now);
      p = await find('cRailList', /^Route-finding/);
      await b.click(p[0], p[1], 'right'); await pick('Close');
      t.check('Close takes a chat off the list', !(await names('cRailList')).some(n => /^Route-finding/.test(n)), await names('cRailList'));
      await push(now);
      t.check('it stays off while nothing new happens in it', !(await names('cRailList')).some(n => /^Route-finding/.test(n)));
      await push(now.map(x => (x.sessionId === demo.ID['s-route'] ? { ...x, lastEventAt: Date.now() + 5000 } : x)));
      t.check('and comes back when something does', (await names('cRailList')).some(n => /^Route-finding/.test(n)));

      // Closing a chat this app runs stops it; a pinned one stays pinned, closed.
      p = await at('cRailList', 0);
      await b.click(p[0], p[1], 'right'); await pick('Close');
      t.check('closing a chat stops it', calls.some(([q, body]) => q === '/api/chat/stop' && body.key === 'k-brawl'), calls.filter(([q]) => /stop/.test(q)));
      const p2 = await pin();
      t.check('a pinned chat stays in the list, closed', !!p2 && /^Closed/.test(p2.s), p2);
      p = await at('cPinList', 0);
      await b.click(p[0], p[1], 'right'); await pick('Unpin from the sidebar');
      t.check('unpinned and closed, it’s gone', (await names('cPinList')).length === 0 && await b.eval(`return document.getElementById('cPinH').hidden`));

      // Closing the chat you're in moves you to the next one.
      await push(now.map(x => (x.key === 'k-bard' ? { ...x, phase: 'idle', state: 'ready', finishedAt: Date.now() } : x)));
      p = await find('cRailList', /^Balance pass/);
      await b.click(p[0], p[1], 'right'); await pick('Close'); await sleep(300);
      // Its Codex partner is still at work, so it asks first, and says who.
      const q = await b.eval(`return document.getElementById('confirmDlg')?.open ? cfX.textContent : ''`);
      t.check('closing a chat whose partner is at work asks first, naming it', /^Codex is in the middle of it; closing stops both of them now\./.test(q), q);
      await b.clickOn('#cfYes'); await sleep(1200);
      t.check('closing the chat you’re in moves on to another', calls.some(([q, body]) => q === '/api/chat/stop' && body.key === 'k-bard') && (await viewing()) !== demo.ID['s-bard'].toLowerCase(), await viewing());
      await t.shot(b, 'rail');
    },
  },
  {
    name: 'one chat per project',
    // Starting Codex where a Claude chat is open adds Codex to that chat (unless you'd rather not).
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      const bard = demo.projects.find(p => p.name === 'Starfall Tavern').cwd;
      const ask = async () => { await b.eval(`window._done = false; ChatUI.open({ cwd: ${JSON.stringify(bard)}, mode: 'new', provider: 'codex' }).then(() => { window._done = true; }); return 1`); await sleep(400); return b.eval(`return document.getElementById('confirmDlg')?.open ? cfQ.textContent + ' | ' + cfYes.textContent + ' | ' + cfNo.textContent : ''`); };
      const q = await ask();
      t.check('a new Codex chat where a Claude chat is open offers to join it', /^Add Codex to “(Tavern brawl|Balance pass)[^”]*”\? \| Add Codex to it \| Start a separate Codex chat$/.test(q), q);
      await b.esc(); await sleep(400);
      t.check('Esc does neither', !calls.some(([p]) => p === '/api/chat/open' || p === '/api/chat/attach') && !(await b.eval(`return ChatUI.isOpen()`)));
      await ask(); await b.clickOn('#cfYes'); await sleep(1500);
      const j = await b.eval(`return { open: ChatUI.isOpen(), target: C.target }`);
      const joined = calls.find(([p]) => p === '/api/chat/attach');
      t.check('joining opens that chat, writing to Codex', j.open && joined && ['k-brawl', 'k-bard'].includes(joined[1].key) && j.target === 'comp' && !calls.some(([p, body]) => p === '/api/chat/open' && body.mode === 'new'), [j, joined]);
      await b.eval(`ChatUI.close(); return 1`); await sleep(400);
      await ask(); await b.clickOn('#cfNo'); await sleep(1200);
      t.check('or a separate Codex chat, if you’d rather', calls.some(([p, body]) => p === '/api/chat/open' && body.mode === 'new' && body.provider === 'codex'));
    },
  },
  {
    name: 'copying',
    // On a phone, through phone access: plain http, where the clipboard API is refused.
    async run(t) {
      const b = await t.open({ width: 412, height: 880, mobile: true });
      await b.eval(`ChatUI.watch({ sessionId: ${JSON.stringify(demo.ID['s-brawl'])}, source: 'terminal' }); return 1`); await sleep(2200);
      // Like a phone on http: no clipboard API. The older copy command records what it copied.
      await b.eval(`Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        window._ok = true; document.execCommand = cmd => { if (cmd !== 'copy') return false; const a = document.activeElement; window._copied = a && a.value !== undefined ? a.value.slice(a.selectionStart, a.selectionEnd) : String(getSelection()); return window._ok; };
        return 1`);
      const code = await b.eval(`return document.querySelector('#cFeed .code code').textContent`);
      await b.eval(`document.querySelector('#cFeed .code').scrollIntoView({ block: 'center' }); return 1`); await sleep(300);
      const cc = await b.eval(`const q = document.querySelector('#cFeed .code-copy').getBoundingClientRect(); return { h: q.height, w: q.width }`);
      t.check('a code block’s Copy is big enough to tap', cc.h >= 34 && cc.w >= 60, cc);
      await b.clickOn('#cFeed .code-copy');
      t.check('it copies the code where the clipboard API is refused', (await b.eval(`return window._copied`)) === code, await b.eval(`return window._copied`));
      t.check('and says so', /Copied/.test(await b.eval(`return document.querySelector('#cFeed .code-copy').textContent`)));

      // A reply's buttons sit under it, roomy; the one beside the name is hidden.
      const foot = await b.eval(`const tn = [...document.querySelectorAll('#cFeed .turn')].find(x => x.querySelector('.final .md')); const f = tn.querySelector('.turn-foot'), top = tn.querySelector('.who .turn-act');
        const fy = f.getBoundingClientRect().top, below = [...tn.children].filter(x => x !== f && getComputedStyle(x).display !== 'none').every(x => x.getBoundingClientRect().bottom <= fy + 1);
        return { shown: getComputedStyle(f).display !== 'none', last: below, topHidden: getComputedStyle(top).display === 'none', h: Math.min(...[...f.querySelectorAll('.ta')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect().height)) }`);
      t.check('a reply’s buttons sit under it on a phone', foot.shown && foot.last && foot.topHidden, foot);
      t.check('big enough to tap', foot.h >= 36, foot);
      await b.eval(`window._copied = ''; return 1`);
      await b.eval(`const tn = [...document.querySelectorAll('#cFeed .turn')].find(x => x.querySelector('.final .md')); tn.querySelector('.turn-foot').scrollIntoView({ block: 'center' }); return 1`); await sleep(300);
      const fb = await b.eval(`const tn = [...document.querySelectorAll('#cFeed .turn')].find(x => x.querySelector('.final .md')); const q = tn.querySelector('.turn-foot [data-c="copyturn"]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]`);
      await b.click(fb[0], fb[1]);
      const md = await b.eval(`return window._copied`);
      t.check('Copy copies the reply as written (Markdown), not the buttons around it', /```lua/.test(md) && !/\\bCopy\\b/.test(md.replace(/Copy this/g, '')), md.slice(0, 160));

      // When even the older command is refused, the text opens in a sheet, selected, to copy by hand.
      await b.eval(`window._ok = false; return 1`);
      await b.click(fb[0], fb[1]); await sleep(300);
      const sheet = await b.eval(`const d = document.getElementById('copyDlg'), ta = document.getElementById('copyTa'); return { open: !!(d && d.open), all: ta && ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 20 }`);
      t.check('when a device refuses even that, the text opens in a sheet, selected', sheet.open && sheet.all, sheet);
      await t.shot(b, 'sheet');
      await b.eval(`document.getElementById('copyDlg').close(); return 1`);

      // Select all keeps to the code block you're in, then the conversation, never the whole page.
      await b.eval(`delete document.execCommand; return 1`);
      const sel = () => b.eval(`return String(getSelection())`);
      await b.eval(`const c = document.querySelector('#cFeed .code code'); const r = document.createRange(); r.setStart(c.firstChild.firstChild || c.firstChild, 1); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); await new Promise(r => setTimeout(r, 100)); document.execCommand('selectAll'); await new Promise(r => setTimeout(r, 200)); return 1`);
      t.check('Select all in a code block selects just the code', (await sel()).trim() === code.trim(), (await sel()).slice(0, 120));
      await b.eval(`document.execCommand('selectAll'); await new Promise(r => setTimeout(r, 200)); return 1`);
      const all = await sel(), title = await b.eval(`return document.getElementById('cTitle').textContent`);
      t.check('again, the whole conversation and not the page around it', all.includes(code.trim()) && /Harvest Festival/.test(all) && !all.includes(title) && !/Watching live/.test(all), all.slice(0, 120));
      await b.eval(`getSelection().removeAllRanges(); return 1`);
    },
  },
  {
    name: 'limits',
    // An account runs out mid-chat: carry on as another account, hand it to Codex, or wait.
    async run(t) {
      const calls = [];
      const resetsAt = new Date(Date.now() + 2 * 3600e3 + 12 * 60e3).toISOString();
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]), events: [{ kind: 'limit', which: 'five_hour', resetsAt }] });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const card = await b.eval(`const c = document.querySelector('.limit-card'); return c && { text: c.textContent.replace(/\\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('button')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()) }`);
      t.check('out of usage: the chat says so, and when it’s back', card && /Studio is out of its 5-hour limit\. It’s back at .+ \(in 2 h 1[12] min\)/.test(card.text), card && card.text);
      t.check('and offers your other account, with how much it has left', card && card.buttons.some(x => /^Continue as Personal \d+% left$/.test(x)), card && card.buttons);
      t.check('or Codex, or carrying on by itself when it’s back', card && card.buttons.includes('Hand it to Codex') && card.buttons.includes('Carry on when it’s back'), card && card.buttons);
      await t.shot(b, 'card');

      await b.clickOn('[data-c="limitwait"]');
      for (let i = 0; i < 30 && !calls.some(([p]) => p === '/api/chat/resume-at'); i++) await sleep(100);
      const wait = calls.find(([p]) => p === '/api/chat/resume-at');
      t.check('“Carry on when it’s back” asks the PC to send “carry on” at the reset', wait && wait[1].at === resetsAt && wait[1].key === 'k-bard', wait && wait[1]);
      await b.eval(`handle({ kind: 'resumeat', at: ${JSON.stringify(resetsAt)}, seq: 700 }); return 1`); await sleep(100);
      t.check('and the card says when it will', /Claude carries on by itself at/.test(await b.eval(`for (let i = 0; i < 50 && !document.querySelector('.limit-card .lm-wait'); i++) await new Promise(r => setTimeout(r, 100)); return document.querySelector('.limit-card .lm-wait')?.textContent || ''`)));
      await b.eval(`handle({ kind: 'limit', which: null, resetsAt: ${JSON.stringify(resetsAt)}, seq: 1 }, 'comp'); return 1`).catch(() => null);
      await b.clickOn('[data-c="limithand"]'); await sleep(300);
      const cx = await b.eval(`return { target: C.target, box: document.getElementById('cText').value }`);
      t.check('“Hand it to Codex” turns the message box to Codex', cx.target === 'comp' && /pick up the work where it left off/.test(cx.box), cx);
      await b.eval(`setTarget('main', false); document.getElementById('cText').value = ''; clearDraft(); return 1`);

      await b.clickOn('[data-c="limitas"]'); await sleep(3000);
      const stop = calls.findIndex(([p, body]) => p === '/api/chat/stop' && body.key === 'k-bard');
      const reopen = calls.findIndex(([p, body]) => p === '/api/chat/open' && body.account === 'personal' && body.mode === 'resume' && body.sessionId === demo.ID['s-bard']);
      t.check('“Continue as Personal” stops this chat, then resumes the same one as Personal', stop >= 0 && reopen > stop, calls.map(([p, body]) => `${p} ${body.account || body.key || ''}`).slice(-4));
      t.check('with your last message in the box to send again', /^Yes, do it\. And we need new key art/.test(await b.eval(`return document.getElementById('cText').value`)));

      // A new chat as an account that's out: offered the one with room.
      await b.eval(`ChatUI.close ? ChatUI.close() : null; S.acct = 'studio'; S.usage.studio = { at: Date.now(), data: { available: true, fiveHour: { used: 100, resetsAt: ${JSON.stringify(resetsAt)} }, week: { used: 60, resetsAt: null }, models: [] } }; window._open = ChatUI.open({ cwd: ${JSON.stringify(demo.projects[0].cwd)}, mode: 'new' }); return 1`); await sleep(500);
      const ask = await b.eval(`return document.getElementById('confirmDlg')?.open && document.getElementById('cfQ').textContent + ' | ' + document.getElementById('cfYes').textContent`);
      t.check('a new chat on an account that’s out offers one with room', /^Studio is out of usage until .+ \| Use Personal$/.test(ask || ''), ask);
      await b.clickOn('#cfYes'); await sleep(800);
      t.check('and opens as that one', calls.some(([p, body]) => p === '/api/chat/open' && body.mode === 'new' && body.account === 'personal'));
    },
  },
  {
    name: 'rules',
    // One set of rules for both (CLAUDE.md and AGENTS.md), and each one's tools side by side.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      const cwd = demo.projects.find(p => p.name === 'Starfall Tavern').cwd;
      const items = await b.eval(`return projectItems(${JSON.stringify(cwd)}).filter(x => x !== '-').map(x => x.label)`);
      t.check('a project’s menu has Rules and tools', items.includes('Rules and tools…'), items);
      await b.eval(`openRules(${JSON.stringify(cwd)}); return 1`); await sleep(800);
      const st = await b.eval(`return { title: rdTitle.textContent, state: document.getElementById('rdState').textContent.replace(/\\s+/g, ' '), text: document.getElementById('rdText').value }`);
      t.check('it says the two files differ', /Rules and tools for Starfall Tavern/.test(st.title) && /They’re different/.test(st.state) && /Start from AGENTS\.md instead/.test(st.state), st);
      t.check('and starts from CLAUDE.md', /Run `npm test` before you finish/.test(st.text), st.text);
      await t.shot(b, 'rules');
      await b.clickOn('#rdState [data-rd="from"]'); await sleep(200);
      t.check('you can start from AGENTS.md instead', /^# Old notes/.test(await b.eval(`return document.getElementById('rdText').value`)));
      await b.clickOn('#rdState [data-rd="from"]'); await sleep(200);
      await b.eval(`const ta = document.getElementById('rdText'); ta.value += 'Ask before deleting save files.\\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      await b.esc(); await sleep(200);
      t.check('closing with unsaved changes asks first', await b.eval(`return document.getElementById('confirmDlg').open && document.getElementById('rulesDlg').open`));
      await b.clickOn('#cfNo'); await sleep(200);
      await b.clickOn('[data-rd="save"]'); await sleep(500);
      const saved = calls.find(([p, body]) => p === '/api/rules' && body.text);
      t.check('Save writes the same text to both files', saved && saved[1].cwd === cwd && saved[1].to.join() === 'claude,codex' && /Ask before deleting save files/.test(saved[1].text), saved && saved[1]);
      t.check('and then they say the same thing', /say the same thing/.test(await b.eval(`return document.getElementById('rdState').textContent`)));

      await b.clickOn('[data-rdtab="tools"]'); await sleep(300);
      const rows = await b.eval(`return [...document.querySelectorAll('.rd-tools tbody tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\\s+/g, ' ').trim()))`);
      const row = n => rows.find(r => r[0].startsWith(n)) || [];
      t.check('Tools lists both sides', row('Blender')[2] === '✓ yours' && row('Blender')[1] === '—' && row('latitude')[1] === '✓ yours' && row('latitude')[2] === '—', rows);
      t.check('offers to add a tool to the other', row('Blender')[3] === 'Add to Claude' && row('latitude')[3] === 'Add to Codex', rows);
      t.check('but not Codex’s own', row('codex_app')[3] === 'Part of Codex', rows);
      await t.shot(b, 'tools');
      await b.clickOn('[data-rd="copy"][data-name="Blender"]'); await sleep(300);
      const q = await b.eval(`return document.getElementById('cfQ').textContent + ' | ' + document.getElementById('cfX').textContent`);
      t.check('adding asks first, saying what it runs and which settings come along', /^Add Blender to Claude Code\? \| It runs uvx blender-mcp\.\n\nIts settings \(BLENDER_PATH\) are copied as they are\. Claude Code will have it in every project\.$/.test(q), q);
      await b.clickOn('#cfYes'); await sleep(500);
      t.check('then adds it to Claude', calls.some(([p, body]) => p === '/api/tools/copy' && body.name === 'Blender' && body.to === 'claude'));
      t.check('and both have it', /Both have it/.test(await b.eval(`return [...document.querySelectorAll('.rd-tools tbody tr')].find(tr => tr.textContent.includes('Blender')).textContent`)));
      await b.eval(`document.getElementById('rulesDlg').close(); openPalette('agents.md'); return 1`); await sleep(500);
      t.check('Ctrl+K finds it by CLAUDE.md, AGENTS.md or MCP', /Rules and tools/.test(await b.eval(`return document.getElementById('palette').textContent`)));
    },
  },
  {
    name: 'share',
    // A chat as a web page of its own; prompt sets as a file to pass around.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b.clickOn('[data-c="more"]'); await sleep(300);
      t.check('the chat’s ⋯ menu can save it as a web page', /Save as a web page/.test(await b.eval(`return document.getElementById('menu').textContent`)));
      await b.esc();
      const page = await b.eval(`window._blobs = []; URL.createObjectURL = x => { _blobs.push(x); return 'blob:test'; }; savePage(); return await _blobs[0].text()`);
      t.check('it’s a page of its own', /^<!doctype html>/.test(page) && /<title>Balance pass on the bard’s songs<\/title>/.test(page) && /<style>/.test(page));
      t.check('with who said what', /<p class="who">You<\/p>/.test(page) && /<section class="m claude"><p class="who">Claude<\/p>/.test(page) && /<section class="m codex"><p class="who">Codex<\/p>/.test(page));
      t.check('replies formatted, code in color, steps in a line', /<table>/.test(page) && /class="tk-/.test(page) && /<p class="steps">Looked at 3 files<\/p>/.test(page));
      t.check('and nothing to click that wouldn’t work there', !/<button/.test(page));
      t.check('light or dark, as the reader likes', /prefers-color-scheme:dark/.test(page));

      await b.eval(`ChatUI.close(); openPromptEditor(); return 1`).catch(() => {}); await sleep(400);
      const exp = await b.eval(`_blobs = []; exportPrompts(); return JSON.parse(await _blobs[0].text())`);
      t.check('prompts export as a file to share', exp.app === 'session-switcher' && exp.kind === 'prompts' && exp.prompts.length >= 3 && exp.prompts.every(p => p.title && p.text && p.provider), exp.prompts.length);
      const n0 = await b.eval(`return document.querySelectorAll('#pdList .pd-item').length`);
      await b.eval(`addPromptsFrom(JSON.stringify({ app: 'session-switcher', kind: 'prompts', prompts: [{ title: 'Write a bard ballad', text: 'Write a ballad for {project}.', provider: 'claude' }, { title: ${JSON.stringify(exp.prompts[0].title)}, text: 'a duplicate', provider: 'claude' }] })); return 1`); await sleep(200);
      t.check('importing adds theirs, skipping names you already have', (await b.eval(`return document.querySelectorAll('#pdList .pd-item').length`)) === n0 + 1 && /Added 1 prompt \(1 with a name you already have was skipped\)\. Press Save to keep them\./.test(await b.eval(`return document.getElementById('toast').textContent`)));
      await b.eval(`addPromptsFrom('not json'); return 1`);
      t.check('and says plainly when a file isn’t a prompt file', /isn’t a prompt file/.test(await b.eval(`return document.getElementById('toast').textContent`)));
    },
  },
  {
    name: 'race',
    // Claude and Codex on the same task, each in its own copy; keep the better one.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await sleep(500);
      const card = () => b.eval(`const c = document.querySelector('#raceList .race'); return c && { text: c.textContent.replace(/\\s+/g, ' ').trim(), cols: [...c.querySelectorAll('.racer')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()) }`);
      let c = await card();
      t.check('the hub shows the race, and the task', c && /Race in Starfall Tavern/.test(c.text) && /Make Rally stop stacking/.test(c.text), c && c.text);
      t.check('with what each has changed so far', c && /^Claude ?done ?2 files changed \+21 −1/.test(c.cols[0]) && /^Codex ?working ?1 file changed \+1 −1/.test(c.cols[1]), c && c.cols);
      await t.shot(b, 'card');
      await b.clickOn('[data-act="race-diff"][data-who="claude"]'); await sleep(600);
      t.check('See changes shows a racer’s changes', await b.eval(`return chgDlg.open && /What Claude changed in its copy \\(2 files\\)/.test(chgTitle.textContent) && !!document.querySelector('.chg-diff .dl.add')`));
      await b.eval(`chgDlg.close(); return 1`);
      await b.clickOn('[data-act="race-keep"][data-who="claude"]'); await sleep(300);
      t.check('Keep asks first, saying what happens', /^Keep Claude’s changes\? \| Its 2 changed files come into Starfall Tavern; both chats stop and both copies are deleted\.$/.test(await b.eval(`return cfQ.textContent + ' | ' + cfX.textContent`)));
      await b.clickOn('#cfYes'); await sleep(500);
      t.check('if the project changed since, it asks before trying anyway', /changed since the race began/.test(await b.eval(`return document.getElementById('confirmDlg').open ? cfQ.textContent : ''`)));
      await b.clickOn('#cfYes'); await sleep(500);
      t.check('then keeps Claude’s', calls.some(([p, body]) => p === '/api/race' && body.action === 'keep' && body.who === 'claude' && body.force === true) && /Kept Claude’s changes/.test((await card()).text));
      // Starting one.
      await b.eval(`openRaceDialog(${JSON.stringify(demo.projects.find(p => p.name === 'Starfall Tavern').cwd)}); return 1`); await sleep(300);
      t.check('Race Claude and Codex asks for the project, account and task', await b.eval(`return raceDlg.open && rcProject.selectedOptions[0].textContent === 'Starfall Tavern' && rcAcct.options[0].textContent === 'Whichever has the most room'`));
      await b.eval(`rcText.value = 'Add a Lullaby cooldown.'; return 1`);
      await b.clickOn('#rcForm [type="submit"]'); await sleep(600);
      t.check('Start the race starts it', calls.some(([p, body]) => p === '/api/race' && body.action === 'start' && body.prompt === 'Add a Lullaby cooldown.') && /Add a Lullaby cooldown/.test((await card()).text));
      // A judge, and keeping file by file.
      await b.clickOn('[data-act="race-judge"]'); await sleep(500);
      t.check('Ask a judge starts one, and the card says so', calls.some(([p, body]) => p === '/api/race' && body.action === 'judge') && /Judge working Read its verdict/.test((await card()).text), (await card()).text);
      await b.clickOn('[data-act="race-files"]'); await sleep(400);
      const pf = await b.eval(`const d = document.querySelector('dialog.pick-files[open]'); return d && { rows: [...d.querySelectorAll('.pf-row')].map(x => x.querySelector('input').type + ':' + x.dataset?.who + ':' + x.querySelector('.pf-p').textContent) }`);
      t.check('Pick files lists each copy’s files; one both changed is a choice between them', pf && pf.rows.filter(x => /^radio:.*songs\.lua$/.test(x)).length === 2 && pf.rows.some(x => /^checkbox:.*rally_test\.lua$/.test(x)), pf);
      await b.eval(`const d = document.querySelector('dialog.pick-files[open]'); d.querySelector('input[data-who="codex"][data-path="scripts/bard/songs.lua"]').click(); d.querySelector('input[data-path="tests/rally_test.lua"]').click(); return 1`);
      await t.shot(b, 'pick');
      await b.eval(`document.querySelector('dialog.pick-files[open] [type="submit"]').click(); return 1`); await sleep(600);
      const kf = calls.find(([p, body]) => p === '/api/race' && body.action === 'keepfiles');
      t.check('Keep these files takes each from where you picked', kf && JSON.stringify(kf[1].picks.codex) === JSON.stringify(['scripts/bard/songs.lua']) && JSON.stringify(kf[1].picks.claude) === JSON.stringify(['tests/rally_test.lua']) && /Kept the files you picked/.test((await card()).text), kf && kf[1]);
      await b.eval(`openRaceDialog(${JSON.stringify(demo.projects.find(p => p.name === 'Starfall Tavern').cwd)}); rcText.value = 'Another go.'; return 1`); await sleep(300);
      await b.clickOn('#rcForm [type="submit"]'); await sleep(600);
      await b.clickOn('[data-act="race-discard"]'); await sleep(300); await b.clickOn('#cfYes'); await sleep(400);
      t.check('Discard both ends it', /Discarded/.test((await card()).text));
      const items = await b.eval(`return projectItems(${JSON.stringify(demo.projects[0].cwd)}).filter(x => x !== '-').map(x => x.label)`);
      t.check('a project’s menu can start a race', items.includes('Race Claude and Codex…'), items);
      // Split the work: each its own part, then keep both.
      t.check('…or split the work', items.includes('Split the work…'), items);
      await b.eval(`openRaceDialog(${JSON.stringify(demo.projects.find(p => p.name === 'Starfall Tavern').cwd)}, 'split'); return 1`); await sleep(300);
      t.check('Split shows a part for each, and the task is optional', await b.eval(`return rcTitle.textContent === 'Split the work' && !document.querySelector('.rc-parts').hidden && /Optional/.test(rcText.placeholder) && document.querySelector('#rcForm [type="submit"]').textContent === 'Start both parts'`));
      await b.eval(`rcClaude.value = 'Fix the rally math.'; rcCodex.value = 'A test for rally stacking.'; return 1`);
      await b.clickOn('#rcForm [type="submit"]'); await sleep(600);
      t.check('Start both parts sends each its part', calls.some(([p, body]) => p === '/api/race' && body.action === 'start' && body.split && body.split.claude === 'Fix the rally math.' && body.split.codex === 'A test for rally stacking.'));
      c = await card();
      t.check('the card says Split and shows each one’s part', /^⑂ ?Split in Starfall Tavern/.test(c.text) && /Fix the rally math\./.test(c.cols[0]) && /A test for rally stacking\./.test(c.cols[1]), c);
      await t.shot(b, 'split');
      await b.clickOn('[data-act="race-both"]'); await sleep(300); await b.clickOn('#cfYes'); await sleep(500);
      t.check('if both touched the same file, it says which and changes nothing', /Both changed scripts\/party\/rally\.lua, so nothing was changed/.test(await b.eval(`return document.body.textContent`)) && /Split in/.test((await card()).text) && !/Kept both/.test((await card()).text));
      await b.clickOn('[data-act="race-both"]'); await sleep(300); await b.clickOn('#cfYes'); await sleep(500);
      t.check('Keep both brings both in', /Kept both sets of changes/.test((await card()).text));
      await b.eval(`openRaceDialog(null); return 1`); await sleep(200);
      t.check('the race dialog opens as a race again', await b.eval(`return rcTitle.textContent === 'Race Claude and Codex' && document.querySelector('.rc-parts').hidden`));
      await b.eval(`raceDlg.close(); return 1`);
    },
  },
  {
    name: 'tour',
    // The first time: a few cards, each pointing at part of the hub. Once skipped, never again.
    async run(t) {
      const b = await t.open();
      await b.eval(`sessionStorage.setItem('tour-test', '1'); localStorage.removeItem('toured'); location.reload(); return 1`).catch(() => {});
      await sleep(4500);
      const step = () => b.eval(`const t = document.getElementById('tour'); if (!t || t.hidden) return null; const s = document.getElementById('tourSpot').getBoundingClientRect(); return { n: tourN.textContent, title: tourT.textContent, spot: [Math.round(s.left), Math.round(s.top), Math.round(s.width), Math.round(s.height)] }`);
      const near = (sel, spot) => b.eval(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const s = ${JSON.stringify(spot)}; return Math.abs(r.left - 6 - s[0]) < 3 && Math.abs(r.width + 12 - s[2]) < 3`);
      let s = await step();
      t.check('the first time, a tour starts', s && s.n === '1 of 5' && s.title === 'Every chat, in one place', s);
      t.check('pointing at what it describes', s && await near('#heroSlot', s.spot), s);
      await t.shot(b, 'first');
      await b.clickOn('[data-tour="next"]'); await sleep(400);
      s = await step();
      t.check('Next moves on (to the account)', s && s.title === 'Your accounts' && await near('#seal', s.spot), s);
      await t.shot(b, 'accounts');
      await b.key('ArrowRight', 'ArrowRight', 39); await sleep(400);
      t.check('→ moves on too', (await step()).title === 'Your projects');
      await b.esc(); await sleep(200);
      t.check('Esc ends it, and it’s remembered', !(await step()) && (await b.eval(`return localStorage.getItem('toured')`)) === '1');
      await b.eval(`location.reload(); return 1`).catch(() => {}); await sleep(4500);
      t.check('so it doesn’t come back', !(await step()));
      await b.eval(`openPalette('tour'); return 1`); await sleep(400);
      t.check('Ctrl+K can show it again', /Take the tour/.test(await b.eval(`return document.getElementById('palette').textContent`)));
    },
  },
  {
    name: 'queue',
    // Tasks that start as new chats when their time comes and an account has room.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await sleep(500);
      const rows = () => b.eval(`return [...document.querySelectorAll('#queueList .task')].map(li => li.textContent.replace(/\\s+/g, ' ').trim())`);
      let r = await rows();
      t.check('the hub lists queued tasks, and what each waits for', r.length === 2 && /Write patch notes for 1\.5 ?Tidecaller · Claude, whichever account has room ?Waiting for an account with room/.test(r[0]) && /Make a 512px app icon.*Neon Courier · Codex ?Starts /.test(r[1]), r);
      await t.shot(b, 'list');
      await b.clickOn('[data-act="task-new"]'); await sleep(400);
      const form = await b.eval(`return { open: taskDlg.open, projects: [...tkProject.options].map(o => o.textContent), who: [...tkWho.options].map(o => o.textContent), acct: [...tkAcct.options].map(o => o.textContent) }`);
      t.check('“Queue a task” asks for the project, who, account, when and what', form.open && form.projects.includes('Starfall Tavern') && form.who.join() === 'Claude,Codex' && form.acct[0] === 'Whichever has the most room' && form.acct.includes('Personal'), form);
      await b.eval(`tkProject.value = ${JSON.stringify(demo.projects.find(p => p.name === 'Starfall Tavern').cwd)}; tkWhen.value = 'at'; tkWhen.dispatchEvent(new Event('change', { bubbles: true })); tkText.value = 'Playtest the Harvest Festival quests and list what breaks.'; return 1`);
      t.check('“Not before…” shows a time to pick', !(await b.eval(`return tkAtWrap.hidden`)));
      await t.shot(b, 'dialog');
      await b.clickOn('#tkGo'); await sleep(500);
      const add = calls.find(([p, body]) => p === '/api/tasks' && body.action === 'add');
      t.check('Queue it sends the task', add && add[1].task.provider === 'claude' && add[1].task.accountId === 'auto' && add[1].task.when === 'at' && /T\d\d:\d\d/.test(add[1].task.at) && /Playtest the Harvest Festival/.test(add[1].task.prompt), add && add[1]);
      t.check('and it joins the list', (await rows()).length === 3 && !(await b.eval(`return taskDlg.open`)));
      await b.clickOn('#queueList [data-act="task-start"][data-id="tk1"]'); await sleep(400);
      r = await rows();
      t.check('Start now starts it, and says where it is', /Started/.test(r[0]) && /Open it/.test(r[0]) && /under At work/.test(await b.eval(`return document.getElementById('toast').textContent`)), r[0]);
      await b.clickOn('#queueList [data-act="task-remove"][data-id="tk2"]'); await sleep(400);
      t.check('✕ takes it off the list', (await rows()).length === 2 && !(await rows()).some(x => /512px app icon/.test(x)));
      const items = await b.eval(`return projectItems(${JSON.stringify(demo.projects[0].cwd)}).filter(x => x !== '-').map(x => x.label)`);
      t.check('a project’s menu can queue a task there', items.includes('Queue a task here…'), items);
    },
  },
  {
    name: 'windows',
    // A chat in its own window, to have two side by side.
    async run(t) {
      const id = demo.ID['s-bard'];
      const b = await t.open();
      t.check('a chat’s menu offers its own window', (await b.eval(`return chatItems(${JSON.stringify(id)}).filter(x => x !== '-').map(x => x.label)`)).includes('Open in a new window'));
      await b.eval(`window._opened = []; window.open = (...a) => { _opened.push(a); return {}; }; ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`); await sleep(2500);
      await b.clickOn('[data-c="more"]'); await sleep(300);
      await b.eval(`[...document.querySelectorAll('#menu [role=menuitem]')].find(x => /Open in a new window/.test(x.textContent)).click(); return 1`); await sleep(300);
      const opened = await b.eval(`return _opened`);
      t.check('it opens that chat in a window of its own', opened.length === 1 && opened[0][0] === `/?chat=${encodeURIComponent(id)}&solo=1` && /popup/.test(opened[0][2]), opened);
      t.check('and leaves this window’s chat for the hub', !(await b.eval(`return ChatUI.isOpen()`)));

      const w = await t.open({ width: 980, height: 1000, path: `?chat=${encodeURIComponent(id)}&solo=1` });
      await sleep(2500);
      const solo = await w.eval(`return { open: ChatUI.isOpen(), title: document.getElementById('cTitle').textContent, bar: getComputedStyle(document.querySelector('.bar')).display, rail: getComputedStyle(document.getElementById('cRail')).display, top: document.querySelector('.chat').getBoundingClientRect().top, wide: document.scrollingElement.scrollWidth <= innerWidth + 1 }`);
      t.check('the new window opens straight into the chat', solo.open && /Balance pass/.test(solo.title), solo);
      t.check('with just the chat: no top bar, no list of running chats', solo.bar === 'none' && solo.rail === 'none' && solo.top < 2 && solo.wide, solo);
      await t.shot(w, 'solo');
      await w.eval(`window._closed = false; window.close = () => { _closed = true; }; return 1`);
      await w.esc(); await w.eval(`document.querySelector('[data-c="back"]').click(); return 1`); await sleep(200);
      t.check('its back button closes the window', await w.eval(`return _closed`));
    },
  },
  {
    name: 'steps',
    // A reply's steps in one line, folded once it's done.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const groups = () => b.eval(`return [...document.querySelectorAll('.tools')].map(g => ({ folded: g.classList.contains('folded'), sum: g.querySelector('.tg-sum')?.textContent.replace(/\\s+/g, ' ').trim() || null, shown: [...g.querySelectorAll('.tool')].filter(x => x.offsetParent).length }))`);
      let gs = await groups();
      t.check('three steps from history fold to one line', gs[0] && gs[0].folded && gs[0].shown === 0 && /^✓ ?Looked at 3 files ?3 steps/.test(gs[0].sum), gs);
      t.check('two steps stay open, with their line', gs[1] && !gs[1].folded && gs[1].shown === 2 && /Edited songs\.lua · ran 1 command/.test(gs[1].sum), gs);
      await b.clickOn('.tools.folded .tg-sum'); await sleep(200);
      t.check('clicking the line shows the steps', (await groups())[0].shown === 3);
      await b.clickOn('.tools .tg-sum'); await sleep(200);
      t.check('and again folds them', (await groups())[0].folded);
      // Live: the steps show as they happen, and fold when the reply is done.
      const tool = (id, name, summary, res) => ({ type: 'tool', id, name, summary, meta: name === 'Edit' ? { path: summary } : null, detail: '', detailKind: 'text', result: res ? { text: 'ok', isError: res === 'err', images: [] } : null });
      await b.eval(`handle({ kind: 'assistant', mid: 'live1', at: new Date().toISOString(), seq: 600, blocks: ${JSON.stringify([tool('a', 'Read', 'a.lua', 'ok'), tool('b', 'Edit', 'b.lua', 'ok'), tool('c', 'Bash', 'npm test', 'err')])} }); return 1`); await sleep(200);
      gs = await groups();
      t.check('live steps stay visible while it works', !gs.at(-1).folded && gs.at(-1).shown === 3 && /✕ ?Edited b\.lua · ran 1 command · looked at 1 file · 1 failed/.test(gs.at(-1).sum), gs.at(-1));
      await b.eval(`handle({ kind: 'result', ok: true, errors: [], seq: 601 }); return 1`); await sleep(200);
      t.check('and fold when the reply is done', (await groups()).at(-1).folded);
      await t.shot(b, 'folded');
    },
  },
  {
    name: 'undo',
    // What a reply changed: a bar under it, the changes, and Undo (which the assistant then hears about).
    async run(t) {
      const calls = [];
      const files = [{ path: 'scripts/bard/songs.lua', status: 'changed', add: 1, del: 1 }, { path: 'data/balance/party.json', status: 'changed', add: 2, del: 0 }, { path: 'notes/rally.md', status: 'added', add: 4, del: 0 }];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]), events: [{ kind: 'changes', turn: 0, files, more: 0 }] });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const bar = await b.eval(`const c = document.querySelector('.chg'); return c && { text: c.textContent.replace(/\\s+/g, ' ').trim(), under: c.closest('.turn')?.dataset.prov }`);
      t.check('a reply that changed files says which, under it', bar && bar.under === 'claude' && /^Changed 3 files songs\.lua \+1 −1 · party\.json \+2 −0 · rally\.md new See the changes ?Undo$/.test(bar.text), bar);
      await t.shot(b, 'bar');
      await b.clickOn('.chg [data-c="chgview"]'); await sleep(800);
      const dlg = await b.eval(`return { open: document.getElementById('chgDlg').open, title: chgTitle.textContent, add: [...document.querySelectorAll('.chg-diff .dl.add')].map(x => x.textContent)[0], del: [...document.querySelectorAll('.chg-diff .dl.del')].map(x => x.textContent)[0] }`);
      t.check('“See the changes” shows each file’s changes', dlg.open && /What Claude changed \(3 files\)/.test(dlg.title) && /rally\.stacks = false/.test(dlg.add) && /rally\.stacks = true/.test(dlg.del), dlg);
      await t.shot(b, 'diff');
      await b.eval(`document.getElementById('chgDlg').close(); return 1`);

      await b.clickOn('.chg [data-c="chgundo"]'); await sleep(300);
      t.check('Undo asks first', /^Undo the changes from this reply\?/.test(await b.eval(`return cfQ.textContent`)));
      await b.clickOn('#cfYes'); await sleep(500);
      t.check('then puts the files back', calls.some(([p, body]) => p === '/api/chat/undo' && body.key === 'k-bard' && body.turn === 0 && !body.force));
      const ask = await b.eval(`return document.getElementById('confirmDlg').open ? cfQ.textContent + ' | ' + cfX.textContent : ''`);
      t.check('a file changed since is left alone, and you’re asked about it', /^party\.json has changed since this reply, so it was left as it is\. \| Undo it anyway\? Whatever changed since is lost: party\.json\.$/.test(ask), ask);
      await b.clickOn('#cfYes'); await sleep(500);
      t.check('“Undo anyway” forces it', calls.some(([p, body]) => p === '/api/chat/undo' && body.force === true));
      await b.eval(`handle({ kind: 'undone', turn: 0, restored: ['scripts/bard/songs.lua', 'data/balance/party.json', 'notes/rally.md'], skipped: [], seq: 400 }); return 1`); await sleep(200);
      t.check('the bar says it’s undone', /Undone: 3 files put back/.test(await b.eval(`return document.querySelector('.chg').textContent`)) && !(await b.eval(`return !!document.querySelector('.chg [data-c="chgundo"]')`)));

      // Claude hears about it with your next message (even in a chat without Codex).
      await b.eval(`const ta = document.getElementById('cText'); ta.focus(); ta.value = 'Try a gentler fix.'; return 1`);
      await b.key('Enter', 'Enter', 13); await sleep(500);
      const sent = calls.filter(([p]) => p === '/api/chat/send').at(-1);
      // The app itself tells Claude what was undone, with this message (see the pairs tests).
      t.check('your next message goes as you wrote it', sent && sent[1].text === 'Try a gentler fix.', sent && sent[1]);
    },
  },
  {
    name: 'mentions',
    // "@" and a few letters: the project's files, put in the message as a path.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const typeIn = async text => { await b.eval(`const ta = document.getElementById('cText'); ta.focus(); ta.value = ${JSON.stringify(text)}; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(400); };
      const pop = () => b.eval(`const box = document.getElementById('cSlash'); return box.hidden ? null : { head: box.querySelector('.cs-h')?.textContent, items: [...box.querySelectorAll('li .cs-x')].map(x => x.textContent) }`);
      await typeIn('Look at @son');
      let p = await pop();
      t.check('“@son” lists matching files, best first', p && /Files in Starfall Tavern/.test(p.head) && p.items[0] === 'scripts/bard/songs.lua', p);
      await t.shot(b, 'popup');
      await b.key('Tab', 'Tab', 9);
      t.check('Tab puts the path in, ready to keep typing', (await b.eval(`return document.getElementById('cText').value`)) === 'Look at @scripts/bard/songs.lua ');
      t.check('and the list closes', !(await pop()));
      await typeIn('Fix @enc');
      await b.key('Enter', 'Enter', 13); await sleep(200);
      t.check('Enter picks too (instead of sending)', (await b.eval(`return document.getElementById('cText').value`)) === 'Fix @scripts/bard/encore.lua ');
      await typeIn('see @song li');
      await typeIn('see @songli');
      p = await pop();
      t.check('letters in order find a file anywhere in its path', p && p.items.includes('docs/Song list.md'), p);
      await b.key('ArrowDown', 'ArrowDown', 40); await b.key('ArrowUp', 'ArrowUp', 38);
      await b.key('Tab', 'Tab', 9);
      t.check('a path with spaces goes in quotes', (await b.eval(`return document.getElementById('cText').value`)) === 'see @"docs/Song list.md" ');
      await typeIn('@codex');
      t.check('@codex still picks who it goes to (no file list)', !(await pop()));
      await typeIn('mail me at a@b');
      t.check('an @ inside a word is left alone', !(await pop()));
      await typeIn('Look at @rea');
      await b.esc();
      t.check('Esc closes the list and keeps your text', !(await pop()) && (await b.eval(`return document.getElementById('cText').value`)) === 'Look at @rea');
    },
  },
  {
    name: 'reopen',
    // After a restart: the chats that were open in the app window, offered in one click.
    async run(t) {
      const calls = [];
      const reopen = [
        { sessionId: demo.ID['s-bard'], provider: 'claude', accountId: 'studio', accountName: 'Studio', title: 'Balance pass on the bard’s songs', folder: 'Starfall Tavern' },
        { sessionId: 't-bard-codex', provider: 'codex', accountId: 'codex', title: 'Glass dome shader', folder: 'Orbital Garden' },
      ];
      const b = await t.open({ reopen, seen: (p, u, body) => calls.push([p, body]) });
      const card = await b.eval(`const c = document.querySelector('.reopen'); return c && c.textContent.replace(/\\s+/g, ' ').trim()`);
      t.check('the hub offers last time’s chats', card && /Pick up where you left off\. When Session Switcher closed, these 2 chats were open in its window:/.test(card) && /Balance pass on the bard’s songs/.test(card) && /Glass dome shader ?Orbital Garden · Codex/.test(card), card);
      await t.shot(b, 'card');
      await b.clickOn('[data-act="reopen"]'); await sleep(600);
      t.check('one click reopens them', calls.some(([p, body]) => p === '/api/reopen' && body.action === 'reopen'));
      t.check('and the offer goes away', !(await b.eval(`return !!document.querySelector('.reopen')`)));
      t.check('saying where they are', /Reopened 2 chats; they’re in Active now\./.test(await b.eval(`return document.getElementById('toast').textContent`)));
    },
  },
  {
    name: 'new chat',
    async run(t) {
      // A chat that's running but hasn't saved any history yet (a new one): no "couldn't load" message.
      const b = await t.open({ noHistory: true });
      await b.eval(`window._toasts = []; new MutationObserver(() => _toasts.push(document.getElementById('toast').textContent)).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); return 1`);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const toasts = await b.eval(`return _toasts`);
      t.check('opening it shows no “couldn’t load earlier messages”', !toasts.some(x => /Couldn’t load earlier/.test(x)), toasts);
      t.check('and the chat opens normally', await b.eval(`return ChatUI.isOpen() && !document.querySelector('.c-skel')`));
    },
  },
  {
    name: 'openclaw',
    // OpenClaw agents' sessions: listed with the rest, read here, never started or written to.
    async run(t) {
      const calls = [];
      const b = await t.open({ openclaw: true, seen: (p, u) => calls.push([p, u]) });
      const nav = await b.eval(`const h = document.querySelector('.nav-h.openclaw'); return h && h.textContent.replace(/\\s+/g, ' ').trim()`);
      t.check('the sidebar has an OpenClaw group', nav && /^OpenClaw ?2/.test(nav), nav);
      await b.eval(`go('folder', ${JSON.stringify('C:\\Projects\\Starfall Tavern')}); return 1`); await sleep(900);
      const row = await b.eval(`const r = document.querySelector('[data-row="agent:main:discord:channel:42"]'); return r && { tag: r.querySelector('.tag.openclaw')?.textContent, btn: r.querySelector('[data-chat]')?.textContent, sub: r.querySelector('.r-sub')?.textContent }`);
      t.check('its session sits in the project, tagged with the agent', row && row.tag === 'OpenClaw · Nova' && row.btn === 'Read' && row.sub === 'Stored session', row);
      const seg = await b.eval(`return [...document.querySelectorAll('[data-wprov]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('and the project can show just those', seg.includes('OpenClaw 1'), seg);
      await t.shot(b, 'folder');
      await b.clickOn('[data-row="agent:main:discord:channel:42"] [data-chat]'); await sleep(1500);
      const v = await b.eval(`return { open: ChatUI.isOpen(), box: document.getElementById('cCompose').hidden, note: document.getElementById('cWatch').textContent, who: [...document.querySelectorAll('#cFeed .turn .who-n')].map(x => x.textContent), text: document.getElementById('cFeed').textContent, acct: document.getElementById('cAcct').textContent }`);
      t.check('it opens live, its message box ready', v.open && !v.box && /Live\. This OpenClaw agent’s session/.test(v.note), v);
      t.check('showing the conversation, in the agent’s name', v.who.includes('Nova') && /Which quests still need dialogue\?/.test(v.text) && /Cellar Rats/.test(v.text) && /OpenClaw · Nova/.test(v.acct), v);
      t.check('read from OpenClaw’s store', calls.some(([p, u]) => p === '/api/chat/history' && /provider=openclaw/.test(u)));
      t.check('and never started as a chat', !calls.some(([p]) => p === '/api/chat/open' || p === '/api/open'));
      await b.clickOn('#chat [data-c="more"]'); await sleep(300);
      const menu = await b.eval(`return [...document.querySelectorAll('[role="menuitem"]')].filter(x => x.offsetParent).map(x => x.textContent.trim())`);
      t.check('its menu offers nothing that would change it', menu.length && !menu.some(x => /Open a copy|terminal command|Rename/.test(x)), menu);
      await b.key('Escape');
      await t.shot(b, 'viewer');
      const p = await t.open({ openclaw: true, width: 412, height: 880, mobile: true });
      await p.eval(`ChatUI.open({ sessionId: 'agent:scout:cron:nightly' }); return 1`); await sleep(1500);
      const ph = await p.eval(`return { open: ChatUI.isOpen(), box: document.getElementById('cCompose').hidden, wide: document.scrollingElement.scrollWidth <= innerWidth + 1 }`);
      t.check('on a phone too', ph.open && !ph.box && ph.wide, ph);
    },
  },
  {
    name: 'look checks',
    // Every theme, light and dark, the hub and a chat, compared with how it looked the last time
    // (kept outside the app folder). Run by name, and by the nightly self-check. It only looks: a
    // theme that changed shows here, it's never changed by this.
    onlyByName: true,
    async run(t) {
      const dir = process.env.LOOKS || path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'SessionSwitcher', 'looks');
      fs.mkdirSync(dir, { recursive: true });
      const b = await t.open();
      // Still pictures: no motion, the same clock.
      const still = `document.documentElement.classList.add('low-power'); document.body.classList.add('low-power'); for (const el of document.querySelectorAll('[data-clock]')) el.textContent = '9:00 AM'; for (const a of document.getAnimations()) { try { a.finish(); } catch {} } return 1`;
      const themes = await b.eval(`return Look.THEMES.filter(x => x.family !== 'custom').map(x => x.id)`);
      const changed = [];
      let kept = 0;
      for (const where of ['hub', 'chat']) {
        if (where === 'chat') { await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000); }
        for (const mode of ['dark', 'light']) {
          for (const theme of themes) {
            await b.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: ${JSON.stringify(mode)} }); return 1`); await sleep(350);
            await b.eval(still); await sleep(150);
            const now = await b.shotData();
            const file = path.join(dir, `${where}-${theme}-${mode}.png`);
            if (process.env.LOOKS_RESET || !fs.existsSync(file)) { fs.writeFileSync(file, Buffer.from(now, 'base64')); kept++; continue; }
            const was = fs.readFileSync(file).toString('base64');
            // Compared in the page: both drawn small, the share of spots that differ clearly.
            const diff = await b.eval(`const load = s => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + s; });
              const [x, y] = await Promise.all([load(${JSON.stringify(was)}), load(${JSON.stringify(now)})]);
              const w = 360, h = 225, px = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
              const a = px(x), z = px(y); let n = 0;
              for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - z[i]) + Math.abs(a[i + 1] - z[i + 1]) + Math.abs(a[i + 2] - z[i + 2]) > 60) n++;
              return n / (w * h)`);
            if (diff > 0.03) { changed.push(`${where} ${theme} ${mode}: ${(diff * 100).toFixed(1)}% looks different`); fs.writeFileSync(file.replace(/\.png$/, '.now.png'), Buffer.from(now, 'base64')); }
          }
        }
      }
      if (kept) console.log(`  · kept ${kept} new baseline picture${kept === 1 ? '' : 's'} in ${dir}`);
      t.check('every theme looks as it did last time', !changed.length, changed.join('; '));
      await b.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'looks',
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      const themes = await b.eval(`return Look.THEMES.map(x => x.id)`);
      for (const mode of ['light', 'dark']) {
        for (const theme of themes) {
          await b.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: ${JSON.stringify(mode)} }); return 1`); await sleep(120);
          const c = await b.eval(`const g = n => 'rgb(' + getComputedStyle(document.documentElement).getPropertyValue(n).trim().split(' ').join(',') + ')';
            const s = document.querySelector('.md strong');
            // A theme may paint the page with a gradient (no background color); its base is the page color then.
            const bg = getComputedStyle(document.body).backgroundColor;
            return { faint: g('--c-716a63'), text: g('--c-ede6d9'), bg: /, 0\\)$|^transparent$/.test(bg) ? g('--c-0a090c') : bg, strong: s ? getComputedStyle(s).color : null }`);
          t.check(`${theme} ${mode}: faint text readable (≥4.5:1)`, contrast(c.faint, c.bg) >= 4.5, `${contrast(c.faint, c.bg).toFixed(2)}`);
          t.check(`${theme} ${mode}: body text clear (≥7:1)`, contrast(c.text, c.bg) >= 7, `${contrast(c.text, c.bg).toFixed(2)}`);
          if (c.strong) t.check(`${theme} ${mode}: bold text clear (≥7:1)`, contrast(c.strong, c.bg) >= 7, `${contrast(c.strong, c.bg).toFixed(2)}`);
        }
      }
      await b.eval(`Look.set({ theme: 'crimson', mode: 'light' }); return 1`); await sleep(200);
      await t.shot(b, 'light');
      await b.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'fonts',
    // The font pack: ready-made sets, a pick per role, matched sizes, code ligatures on request, the
    // credits, and every file served.
    async run(t) {
      const b = await t.open();
      const cat = await b.eval(`return { n: Look.FAMILIES.filter(f => f.cat !== 'theme').length, sets: Look.FONT_SETS.length, files: Look.FAMILIES.flatMap(f => f.faces.map(x => x[0])) }`);
      t.check('42 families to choose from, in 11 ready-made sets', cat.n === 42 && cat.sets === 11, cat);
      const served = await b.eval(`const bad = []; for (const f of ${JSON.stringify(cat.files)}) { const r = await fetch('/fonts/' + f + '.woff2'); if (!r.ok || r.headers.get('content-type') !== 'font/woff2' || (await r.arrayBuffer()).byteLength < 2000) bad.push(f); } return bad`);
      t.check('every font file is served', served.length === 0, served);
      // The default look is untouched: Spectral replies, Playfair headings, JetBrains Mono code, no ligatures.
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      const read = `await document.fonts.ready; const ff = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily : null; }; const code = document.querySelector('#cFeed .md code, #cFeed pre');
        return { body: ff('#cFeed .md p'), code: code && getComputedStyle(code).fontFamily, liga: code && getComputedStyle(code).fontVariantLigatures, display: getComputedStyle(document.documentElement).getPropertyValue('--f-display').trim() }`;
      const def = await b.eval(read);
      t.check('out of the box: Spectral replies, Playfair headings, JetBrains Mono code', /^"?Spectral/.test(def.body) && /^"Playfair"/.test(def.display) && /^"?JetBrains Mono/.test(def.code), def);
      t.check('code ligatures start off', def.liga === 'none', def);
      // A set changes all three; its fonts load.
      await b.eval(`Look.set({ fontSet: 'editorial' }); return 1`); await sleep(400);
      const ed = await b.eval(read);
      const edLoaded = await b.eval(`await document.fonts.load('16px "Fit Source Serif 4"'); await document.fonts.load('20px "Young Serif"'); await document.fonts.load('14px "Fit Google Sans Code"'); return ['16px "Fit Source Serif 4"', '20px "Young Serif"', '14px "Fit Google Sans Code"'].every(f => document.fonts.check(f))`);
      t.check('a set changes replies, headings and code', /Source Serif 4/.test(ed.body) && /Young Serif/.test(ed.display) && /Google Sans Code/.test(ed.code), ed);
      t.check('and its fonts load', edLoaded);
      // A single pick wins over the set; reading fonts are scaled to match, headings aren't.
      await b.eval(`Look.set({ fBody: 'eb-garamond', fHead: 'big-shoulders' }); return 1`); await sleep(300);
      const pk = await b.eval(read);
      const fit = await b.eval(`const r = [...document.getElementById('fontPack').sheet.cssRules].map(x => x.cssText); return { garamond: r.find(x => x.includes('"Fit EB Garamond"'))?.match(/size-adjust: ([\\d.]+)%/)?.[1], plex: r.some(x => x.includes('"Fit IBM Plex Sans"')), shoulders: r.some(x => x.includes('"Fit Big Shoulders"')) }`);
      t.check('a single pick wins over the set', /Fit EB Garamond/.test(pk.body) && /Big Shoulders/.test(pk.display) && /Google Sans Code/.test(pk.code), pk);
      t.check('small-lettered reading fonts are scaled up to match (EB Garamond 115%); the reference and headings aren’t', fit.garamond === '115' && !fit.plex && !fit.shoulders, fit);
      t.check('Imperial and Rebel keep their own lettering under any set', await b.eval(`Look.set({ theme: 'rebel' }); const r = getComputedStyle(document.documentElement).getPropertyValue('--f-display'); Look.set({ theme: 'imperial' }); const i = getComputedStyle(document.documentElement).getPropertyValue('--f-display'); Look.set({ theme: 'crimson' }); return /Barlow Condensed/.test(r) && /Michroma/.test(i)`));
      t.check('Theme Studio and Setup share the same sets', await b.eval(`return Look.setFonts('storybook').body.includes('EB Garamond')`));
      await b.eval(`Look.set({ liga: true }); return 1`); await sleep(200);
      t.check('ligatures come on when asked for', (await b.eval(read)).liga === 'normal');
      // Setup: the cards, the picks, and choosing a set clears the picks.
      await b.eval(`ChatUI.close(); openSetup('look'); return 1`); await sleep(900);
      await b.eval(`document.querySelector('.lk-fonts').scrollIntoView(); return 1`); await sleep(900);
      const ui = await b.eval(`return { cards: document.querySelectorAll('.lk-set').length, checked: document.querySelector('.lk-set[aria-checked="true"]')?.dataset.v, picks: [...document.querySelectorAll('.lk-picks select')].map(s => s.value), options: [...document.querySelectorAll('#lk-fBody option, #lk-fHead option, #lk-fCode option')].length, credits: !!document.querySelector('[data-font-credits]') }`);
      t.check('Setup shows the theme’s own fonts and every set, drawn in its own letters', ui.cards === 12 && ui.checked === 'editorial', ui);
      t.check('with a pick for replies, headings and code', ui.picks.join() === 'eb-garamond,big-shoulders,' && ui.options > 42, ui);
      await t.shot(b, 'setup');
      await b.clickOn('.lk-set[data-v="scifi"]'); await sleep(500);
      const sc = await b.eval(`const o = Look.get(); return { set: o.fontSet, picks: [o.fBody, o.fHead, o.fCode].join(), display: getComputedStyle(document.documentElement).getPropertyValue('--f-display').trim() }`);
      t.check('choosing a set clears the single picks', sc.set === 'scifi' && sc.picks === ',,' && /Tektur/.test(sc.display), sc);
      await b.eval(`const s = document.getElementById('lk-fCode'); s.value = 'cascadia-code'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1`); await sleep(300);
      t.check('a pick from the list applies at once', await b.eval(`return Look.get().fCode === 'cascadia-code' && getComputedStyle(document.documentElement).getPropertyValue('--f-mono').includes('Cascadia Code')`));
      await b.clickOn('[data-font-credits]'); await sleep(900);
      const cr = await b.eval(`const d = document.getElementById('fontsDlg'); return { open: d.open, items: d.querySelectorAll('.fonts-list li').length, ofl: d.querySelector('.fonts-ofl').textContent }`);
      t.check('Fonts and licences lists every family with the licence and its notices', cr.open && cr.items === 47 && /SIL OPEN FONT LICENSE Version 1\.1/.test(cr.ofl) && /IBM Plex Sans: Copyright/.test(cr.ofl) && /Reserved Font Name "Plex"/.test(cr.ofl), { ...cr, ofl: cr.ofl.slice(0, 80) });
      await t.shot(b, 'credits');
      await b.eval(`document.getElementById('fontsDlg').close(); document.getElementById('setup').close(); return 1`);
      await b.eval(`openPalette('fonts'); return 1`); await sleep(500);
      const pal = await b.eval(`return document.getElementById('palette').textContent`);
      await b.esc(); await sleep(200);
      await b.eval(`openPalette('licence'); return 1`); await sleep(500);
      const lic = await b.eval(`return document.getElementById('palette').textContent`);
      t.check('Ctrl+K offers the font sets and the licences', /Fonts: Reading/.test(pal) && /Fonts and licences/.test(lic), lic.slice(0, 200));
      await b.esc(); await sleep(200);
      // The old reading-font choice carries over: Modern is the device's sans, Clean for headings too.
      // Clean edges with the widest sets: hero text stays clear of the picture (Ryan's Imperial and
      // Rebel are left as he made them), and long names in the chat's side panel end in "…".
      const lay = await t.open({ width: 1180, height: 800 });
      const over = [];
      for (const theme of ['crimson', 'malibu', 'isekai', 'highfantasy', 'dungeon']) {
        for (const set of ['', 'loud', 'pixel', 'scifi', 'easy']) {
          over.push(...await lay.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: 'dark', fontSet: ${JSON.stringify(set)} }); await document.fonts.ready; await new Promise(r => setTimeout(r, 200));
            const art = document.querySelector('.hero .hero-art'); if (!art || !art.getBoundingClientRect().width || getComputedStyle(art).display === 'none') return [];
            const a = art.getBoundingClientRect(), bad = [];
            for (const el of document.querySelectorAll('.hero h1, .hero .eyebrow, .hero p, .hero-act')) {
              const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
              while ((n = w.nextNode())) { const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 1 && r.right > a.left + 2 && r.left < a.right && r.bottom > a.top && r.top < a.bottom) bad.push(${JSON.stringify(theme)} + '/' + (${JSON.stringify(set)} || 'own') + ': ' + n.textContent.trim().slice(0, 30)); }
            }
            return bad`));
        }
      }
      t.check('with any font set, hero text stays clear of the picture', over.length === 0, over.slice(0, 6));
      await b.eval(`Look.set({ theme: 'crimson', fontSet: 'loud' }); ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const led = await b.eval(`const l = [...document.querySelectorAll('.lg-i .lg-t > .linkish')].find(x => x.scrollWidth > x.clientWidth + 1); return l ? { ellipsis: getComputedStyle(l).textOverflow, inside: l.getBoundingClientRect().right <= l.closest('.lg-i').getBoundingClientRect().right + 1 } : null`);
      t.check('a long name in the chat’s side panel ends in “…” inside its row', led && led.ellipsis === 'ellipsis' && led.inside, led);
      await b.eval(`localStorage.setItem('look', JSON.stringify({ theme: 'crimson', font: 'clean' })); location.reload(); return 1`); await sleep(2500);
      const mg = await b.eval(`const o = Look.get(); return { body: o.fBody, head: o.fHead, font: 'font' in o, css: getComputedStyle(document.documentElement).getPropertyValue('--f-body').trim() }`);
      t.check('the old Modern and Clean choices carry over', mg.body === 'system' && mg.head === 'system' && !mg.font && /Segoe UI/.test(mg.css), mg);
      await b.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'polish',
    // Small things that keep the app calm and clean: resting when no one's there, pictures that can't
    // load, long names, and titles that stay short.
    async run(t) {
      const b = await t.open();
      await b.eval(`Look.set({ theme: 'highfantasy', mode: 'dark' }); return 1`); await sleep(1200);
      const rest = await b.eval(`const running = () => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity).length;
        const before = running(); restSeen = 0; restCheck(); await new Promise(r => setTimeout(r, 100));
        const resting = document.documentElement.classList.contains('at-rest'), during = running();
        window.dispatchEvent(new Event('pointerdown')); await new Promise(r => setTimeout(r, 100));
        return { before, resting, during, awake: !document.documentElement.classList.contains('at-rest') && running() > 0 }`);
      t.check('left alone, the world rests: nothing loops, and a touch wakes it', rest.before > 0 && rest.resting && rest.during === 0 && rest.awake, rest);
      const pics = await b.eval(`const box = document.createElement('div'); document.body.appendChild(box);
        box.innerHTML = genImage({ src: '/art/none-such.webp', prompt: 'A lantern at dusk' }) + '<div class="w-art">' + worldArt({ name: 'Lost Banner', cwd: 'C:\\\\x' }, { banner: 'C:\\\\x\\\\missing.png' }, '', false) + '</div>';
        await new Promise(r => setTimeout(r, 800));
        const g = box.querySelector('.gen'); const out = { gone: g.classList.contains('gone'), note: getComputedStyle(box.querySelector('.gen-gone')).display, img: !!box.querySelector('.w-art img'), glyph: !!box.querySelector('.w-art .w-glyph') };
        box.remove(); return out`);
      t.check('a picture that can’t load shows a calm note, not its caption drawn over itself', pics.gone && pics.note === 'block', pics);
      t.check('a project banner that can’t load leaves its drawn tile', !pics.img && pics.glyph, pics);
      await b.eval(`Look.set({ theme: 'crimson' }); go('recent'); return 1`); await sleep(1000);
      const chip = await b.eval(`const c = document.querySelector('.r-chip'); if (!c) return null; c.textContent = 'An exceptionally long project name that keeps on going well past any sensible length'; const cs = getComputedStyle(c); return { ellipsis: cs.textOverflow, fits: c.getBoundingClientRect().width <= c.parentElement.getBoundingClientRect().width + 1 }`);
      t.check('long project names in Recent chats end in “…”', chip && chip.ellipsis === 'ellipsis' && chip.fits, chip);
      await b.eval(`go('hub'); return 1`); await sleep(900);
      const title = await b.eval(`const btn = document.querySelector('.o-title button'); if (!btn) return null; btn.textContent = 'A very long chat title about rebalancing every single song the bard knows, including the encore and the ballads nobody asked for'; const lh = parseFloat(getComputedStyle(btn.parentElement).lineHeight); return { lines: Math.round(btn.getBoundingClientRect().height / lh) }`);
      t.check('card titles stay at two lines', title && title.lines <= 2, title);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2200);
      t.check('scrollable code blocks can be reached by keyboard', await b.eval(`const p = document.querySelector('#cFeed .code pre'); return !p || p.tabIndex === 0`));
      const stuck = await b.eval(`handle({ kind: 'stuck', quietMin: 12, seq: 800 }); const c = document.querySelector('.stuck-card'); const text = c && c.textContent;
        const buttons = c ? [...c.querySelectorAll('button')].map(x => x.textContent) : [];
        handle({ kind: 'state', state: 'ready', seq: 801 }); return { text, buttons, gone: !document.querySelector('.stuck-card') }`);
      t.check('a chat quiet for a long while says so, offering to stop it or keep waiting', /working for 12 minutes without a word/.test(stuck.text) && stuck.buttons.join() === 'Stop Claude,Keep waiting', stuck);
      t.check('and the note goes once it moves on', stuck.gone, stuck);
      const al = await b.eval(`const played = [], real = window.chime; window.chime = k => played.push(k); Local.sound = true;
        const x = { sessionId: 'AbC-1', title: 'T', pending: [] };
        setAlertLevel('abc-1', 'needs'); notify('reply', x); notify('needs', x);
        setAlertLevel('abc-1', 'off'); notify('needs', x);
        setAlertLevel('abc-1', 'all');
        store('quiet-hours', JSON.stringify({ on: true, from: '22:00', to: '08:00' }));
        const night = inQuietHours(new Date(2026, 9, 11, 23, 30)), morning = inQuietHours(new Date(2026, 9, 11, 7, 59)), day = inQuietHours(new Date(2026, 9, 11, 12, 0));
        store('quiet-hours', JSON.stringify({ on: true, from: '00:00', to: '23:59' })); notify('needs', x);
        store('quiet-hours', 'null'); window.chime = real;
        return { played, night, morning, day }`);
      t.check('a chat can alert only when it needs you, or not at all', al.played.join() === 'needs', al);
      t.check('quiet hours hush alerts, overnight too', al.night && al.morning && !al.day, al);
      const used = await b.eval(`ChatUI.close(); S.spent = { studio: [{ sessionId: ${JSON.stringify(demo.ID['s-bard'])}, title: '', provider: 'claude', five: 7500, week: 9000 }, { sessionId: 'x', title: 'Old chat', provider: 'claude', five: 2500, week: 3000 }] };
        renderLive(true); await new Promise(r => setTimeout(r, 300));
        const p = document.querySelector('.dc-used'); return p && p.textContent.replace(/\\s+/g, ' ').trim()`);
      t.check('each account says which chats used most of its last five hours', /Used most, last 5 hours/.test(used) && /Balance pass on the bard’s songs 75%/.test(used) && /Old chat 25%/.test(used), used);
      // The mini window, with a frame standing in for the floating one (that needs a click and a screen).
      const mini = await b.eval(`const f = document.createElement('iframe'); document.body.appendChild(f);
        f.contentDocument.body.innerHTML = '<main class="mini-in"></main>'; f.contentDocument.body.className = 'mini';
        f.contentDocument.addEventListener('click', e => miniClick(e)); Mini.win = f.contentWindow; Mini.h = '';
        Look.set({ theme: 'isekai' }); syncMiniLook(); renderMini();
        const d = f.contentDocument, text = d.body.textContent.replace(/\\s+/g, ' ');
        const calls = [], real = window.api; window.api = async (p, body) => { calls.push([p, body]); return { ok: true }; };
        d.querySelector('[data-mini-a="allow"]')?.click(); await new Promise(r => setTimeout(r, 100)); window.api = real;
        const out = { text, theme: d.documentElement.dataset.theme, allow: calls.find(c => c[0] === '/api/chat/permission') };
        Mini.win = null; f.remove(); Look.set({ theme: 'crimson' }); return out`);
      t.check('the mini window shows what needs you and what’s at work, in the theme’s own words', /Awaiting your command/.test(mini.text) && /Casting/.test(mini.text) && mini.theme === 'isekai', mini);
      t.check('and an approval can be answered right there', mini.allow && mini.allow[1].decision === 'allow', mini);
    },
  },
  {
    name: 'crew order',
    // A duo chat reads as one conversation: replays from both chats land in time order, and the
    // partner's older messages page back alongside the chat's own.
    async run(t) {
      const b = await t.open();
      const order = await b.eval(`const seen = [], real = window.handle; window.handle = (ev, src) => seen.push(src + ':' + ev.n);
        const at = s => new Date(Date.parse('2026-10-11T10:00:00Z') + s * 1000).toISOString();
        mergeStart(true);
        for (const s of [1, 3, 5]) feedIn({ kind: 'x', n: s, at: at(s) }, 'comp');
        replayed('comp');
        const early = seen.length;
        for (const s of [2, 4, 6]) feedIn({ kind: 'x', n: s, at: at(s) }, 'main');
        feedIn({ kind: 'x', n: 'untimed' }, 'main');
        replayed('main');
        window.handle = real; mergeStart(false);
        return { early, seen }`);
      t.check('both replays wait for each other, then play in time order', order.early === 0 && order.seen.join() === 'comp:1,main:2,comp:3,main:4,comp:5,main:6,main:untimed', order);
      const paging = await b.eval(`const real = window.api, calls = [];
        const at = h => new Date(Date.parse('2026-10-11T00:00:00Z') + h * 3600000).toISOString();
        const turn = h => [{ kind: 'user', text: 'q' + h, at: at(h) }, { kind: 'assistant', blocks: [{ type: 'text', text: 'a' + h }] }];
        const pages = { '': { items: [...turn(8), ...turn(9)], cursor: 'p2', start: 1 }, p2: { items: [...turn(4), ...turn(6)], cursor: 'p3', start: 1 }, p3: { items: [...turn(1)], cursor: null, start: 0 } };
        window.api = async url => { const c = new URLSearchParams(url.split('?')[1]).get('cursor') || ''; calls.push(c || 'first'); return pages[c]; };
        C.compThread = 'T';
        const first = (await partnerBack(Date.parse(at(5)), C.gen, true)).filter(i => i.kind === 'user').map(i => i.text);
        const back = (await partnerBack(-Infinity, C.gen, false)).filter(i => i.kind === 'user').map(i => i.text);
        window.api = real; C.compThread = null;
        return { first, back, calls }`);
      t.check('the partner pages back as far as the chat’s own page, and keeps older turns for later', paging.first.join() === 'q6,q8,q9' && paging.back.join() === 'q1,q4', paging);
      const bars = await b.eval(`const at = s => new Date(Date.parse('2026-10-11T10:00:00Z') + s * 1000).toISOString();
        Recent.main = []; Recent.comp = [];
        const first = clashWith({ files: [{ path: 'scripts/songs.lua' }], since: at(0), at: at(60) }, 'comp');
        const ev = { turn: 1, since: at(30), at: at(90), files: [{ path: 'scripts/songs.lua' }, { path: 'data/party.json' }, { path: 'art/icon.png', meanwhile: true }] };
        const box = document.createElement('div'); box.innerHTML = changesBar(ev, 'main', clashWith(ev, 'main'));
        const out = { first, head: box.querySelector('.chg-h').textContent, clash: box.querySelector('.chg-clash')?.textContent || '', mw: box.querySelector('.chg-mw')?.textContent || '' };
        Recent.main = []; Recent.comp = []; return out`);
      t.check('a reply’s changes count only its own files, and say what changed meanwhile', bars.head === 'Changed 2 files' && /1 more changed meanwhile/.test(bars.mw), bars);
      t.check('both editing the same file at the same time is called out', bars.first.length === 0 && /also edited songs\.lua at the same time/.test(bars.clash), bars);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2200);
      const plan = await b.eval(`L.plans.claude = [{ content: 'Rebalance the songs', status: 'completed' }, { content: 'Write the tests', status: 'in_progress' }];
        L.plans.codex = [{ content: 'Paint the festival icons', status: 'pending' }];
        renderLedger(); const box = document.getElementById('cLedgerBody') || document.querySelector('.ledger');
        const text = box.textContent;
        Look.set({ theme: 'isekai' }); renderLedger(); const themed = (document.getElementById('cLedgerBody') || document.querySelector('.ledger')).textContent;
        Look.set({ theme: 'crimson' });
        return { crew: /Crew plan/i.test(text), owners: [...box.querySelectorAll('.lg-owner')].map(x => x.textContent), both: /Rebalance the songs/.test(text) && /Paint the festival icons/.test(text), themed: /Quest board/i.test(themed) }`);
      t.check('the crew plan shows each one’s steps under its own name', plan.crew && plan.both && plan.owners.length === 2, plan);
      t.check('and themed looks name it in their own words', plan.themed, plan);
      // Plan first: the Plan choice under the message box, then one card from drafting to who builds it.
      await b.eval(`handle({ kind: 'state', state: 'ready', seq: 900 }); return 1`);
      const pf = await b.eval(`const real = window.api, calls = []; window.api = async (p, body) => { calls.push([p, body]); return { ok: true }; };
        setTarget('plan', false);
        const placeholder = document.getElementById('cText').placeholder, pill = !!document.querySelector('[data-crew="plan"][aria-pressed="true"]');
        document.getElementById('cText').value = 'Add a save system.'; await sendMessage();
        const sent = calls.find(c => c[0] === '/api/chat/send');
        handle({ kind: 'planfirst', state: 'drafting', who: 'claude', to: 'codex', ask: 'Add a save system.', seq: 901 });
        const drafting = document.querySelector('.planfirst').textContent;
        handle({ kind: 'planfirst', state: 'checking', who: 'claude', to: 'codex', seq: 902 });
        handle({ kind: 'planfirst', state: 'ready', checked: true, seq: 903 });
        const ready = document.querySelector('.planfirst').textContent, last = document.getElementById('cFeed').lastElementChild.classList.contains('planfirst');
        await buildPlan(document.querySelector('[data-build="comp"]'));
        const build = calls.filter(c => c[0] === '/api/chat/send').pop();
        const after = document.querySelector('.planfirst').textContent;
        window.api = real; setTarget('main', false);
        return { placeholder, pill, sent: sent && sent[1], drafting, ready, last, build: build && build[1], after }`);
      t.check('Plan first is a choice under the message box', pf.pill && /Plan first/.test(pf.placeholder) && pf.sent && pf.sent.to === 'plan' && pf.sent.text === 'Add a save system.', pf);
      t.check('one card follows it: drafting, then who builds it, under the plan', /Claude is drafting a plan; Codex checks it next/.test(pf.drafting) && /checked by Codex\. Who builds it\?/.test(pf.ready) && pf.last, pf);
      t.check('picking a builder sends it the go-ahead', pf.build && pf.build.to === 'partner' && /Build it as planned above/.test(pf.build.text) && /Codex is building it/.test(pf.after), pf);
      // Reviews both ways: a dual review card shows who found each finding, and fixes go to the writer.
      const rv = await b.eval(`handle({ kind: 'review', id: 'dual1', by: 'both', what: 'your uncommitted changes', state: 'done', overall: 'Both found one problem.', findings: [{ title: 'Off by one', by: 'both', file: 'a.js', start: 10 }, { title: 'Typo', by: 'claude' }], seq: 950 });
        handle({ kind: 'review', id: 'cl1', by: 'claude', what: 'the last commit', state: 'done', overall: 'One thing.', findings: [{ title: 'Missing check' }], seq: 951 });
        const d = document.querySelector('.review[data-rid="dual1"]'), c = document.querySelector('.review[data-rid="cl1"]');
        return { dualHead: d.querySelector('.rv-h').textContent, tags: [...d.querySelectorAll('.rv-by')].map(x => x.textContent), clHead: c.querySelector('.rv-h').textContent, fix: c.querySelector('[data-c="rvfixall"]').textContent, loop: !!c.querySelector('[data-c="rvloop"]') }`);
      t.check('a dual review marks what both found', /Dual review/.test(rv.dualHead) && rv.tags.join() === 'Both found this,Claude', rv);
      t.check('Claude’s review of Codex’s work sends the fixes to Codex', /Claude review/.test(rv.clHead) && /Ask Codex to fix/.test(rv.fix) && !rv.loop, rv);
    },
  },
  {
    name: 'kept',
    // A chat opened again after a restart: its earlier changes and reviews are back under their replies.
    async run(t) {
      const ago = m => new Date(demo.NOW - m * 60000).toISOString();   // on the demo's clock
      const extras = [
        { kind: 'changes', turn: 0, files: [{ path: 'scripts/bard/songs.lua', status: 'changed', add: 3, del: 1 }], more: 0, since: ago(28), at: ago(27) },
        { kind: 'review', id: 'rv-old', state: 'done', by: 'codex', findings: [], at: ago(26) },
        { kind: 'changes', turn: 1, files: [{ path: 'data/balance/party.json', status: 'changed', add: 1, del: 1 }], more: 0, since: ago(22), at: ago(20) },
        { kind: 'undone', turn: 1, restored: ['data/balance/party.json'], skipped: [], at: ago(19) },
      ];
      const b = await t.open({ extras });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const r = await b.eval(`const turns = [...document.querySelectorAll('#cFeed .turn[data-prov="claude"]')];
        const where = el => el ? turns.indexOf(el.closest('.turn') || el.previousElementSibling) : -2;
        const c0 = document.querySelector('.chg[data-turn="0"]'), c1 = document.querySelector('.chg[data-turn="1"]'), rv = document.querySelector('.review[data-rid="rv-old"]');
        return { n: turns.length, c0: where(c0), c1: where(c1), undone: c1 && c1.classList.contains('undone'), rv: rv ? turns.indexOf(rv.previousElementSibling) : -2, rvText: rv && rv.textContent.replace(/\\s+/g, ' ') }`);
      t.check('earlier changes are back, each under its own reply', r.c0 === 0 && r.c1 === 1, r);
      t.check('…with what was undone', r.undone, r);
      t.check('a review is back where it came in, as it ended', r.rv === 0 && /All clear/.test(r.rvText || ''), r);
      await b.eval(`document.querySelector('.chg[data-turn="0"]').scrollIntoView({ block: 'center' }); return 1`); await sleep(300);
      await t.shot(b, 'kept');
      // Branch from the first reply, and rewind: the later reply's changes are undone, newest first.
      const calls = [];
      const b2 = await t.open({ extras: extras.slice(0, 3), seen: (p, u, body) => calls.push([p, body]) });
      await b2.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b2.eval(`document.querySelector('#cFeed .turn[data-prov="claude"] [data-c="turnmore"]').click(); [...document.querySelectorAll('#menu button')].find(x => x.textContent.includes('Branch from here')).click(); return 1`); await sleep(500);
      const opts = await b2.eval(`const d = document.querySelector('dialog.choice-dlg[open]'); return d ? [...d.querySelectorAll('button')].map(x => x.textContent) : null`);
      t.check('Branch from here offers to rewind the files later replies changed', opts && opts.includes('Branch from here') && opts.includes('Branch and rewind the files'), opts);
      await b2.eval(`[...document.querySelectorAll('dialog.choice-dlg[open] button')].find(x => x.textContent === 'Branch and rewind the files').click(); return 1`); await sleep(2500);
      const br = calls.find(([p]) => p === '/api/chat/branch'), un = calls.filter(([p]) => p === '/api/chat/undo');
      t.check('it branches from the end of that reply', br && br[1].mid === 'm1' && br[1].sessionId === demo.ID['s-bard'], br && br[1]);
      t.check('and undoes the later reply’s changes', un.length === 1 && un[0][1].turn === 1, un.map(x => x[1]));
      await sleep(1500);
      const now = await b2.eval(`return { sid: C.sessionId, title: document.getElementById('cTitle').textContent, toast: document.getElementById('toast').textContent }`);
      t.check('then opens the new chat', calls.some(([p, body]) => p === '/api/chat/open' && body.sessionId === demo.ID['s-brawl']), now);
    },
  },
  {
    name: 'bring in',
    // "@" and a chat's name brings that chat's latest messages along with yours.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b.eval(`const ta = document.getElementById('cText'); ta.focus(); ta.value = 'Compare with @Taver'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(700);
      const pick = await b.eval(`const box = document.getElementById('cSlash'); return { open: !box.hidden, chats: [...box.querySelectorAll('.cs-chat b')].map(x => x.textContent), head: box.textContent }`);
      t.check('@ lists your other chats that match', pick.open && pick.chats.some(x => /Tavern brawl/.test(x)), pick);
      await b.clickOn('#cSlash .cs-chat'); await sleep(300);
      const text = await b.eval(`return document.getElementById('cText').value`);
      t.check('picking one puts it in the message', /^Compare with @chat\[Tavern brawl[^\]]*\] $/.test(text), text);
      await b.clickOn('#cSend'); await sleep(600);
      const sent = calls.find(([p]) => p === '/api/chat/send');
      t.check('sending takes that chat along', sent && Array.isArray(sent[1].refs) && sent[1].refs.length === 1 && sent[1].refs[0].id === demo.ID['s-brawl'], sent && sent[1]);
      // As it shows in the chat: your words, and the other chat folded away.
      const shown = await b.eval(`const d = document.createElement('div'); renderItem(d, { kind: 'user', at: new Date().toISOString(), text: '<other-chat title="Tavern brawl encounter" folder="Starfall Tavern" items="2">\\nFrom the user’s other chat…\\n\\nUser: hi\\n\\nClaude: hello\\n</other-chat>\\n\\nCompare with @chat[Tavern brawl encounter]' }, false); return { sum: d.querySelector('.shared.other summary')?.textContent, own: d.querySelector('.utext')?.textContent }`);
      t.check('it shows as a fold-out, not as your words', /Brought in “Tavern brawl encounter”: its last 2 messages/.test(shown.sum || '') && shown.own === 'Compare with @chat[Tavern brawl encounter]', shown);
    },
  },
  {
    name: 'done',
    // A finished chat leaves the lists, waits under Done in its project, and comes back when asked.
    async run(t) {
      const b = await t.open();
      const id = demo.ID['s-brawl'];
      const inNav = () => b.eval(`return [...document.querySelectorAll('.nav-i, .r-row, .row')].some(x => /Tavern brawl/.test(x.textContent) && !x.closest('.done-chats'))`);
      t.check('a chat is on the lists to begin with', await inNav());
      await b.eval(`setChatDone(${JSON.stringify(id)}, true); return 1`); await sleep(600);
      t.check('marked done, it leaves the lists', !(await inNav()));
      await b.eval(`document.activeElement && document.activeElement.blur(); return 1`);
      await b.key('z', 'KeyZ', 90, 2); await sleep(700);
      t.check('Ctrl+Z takes it back', await inNav());
      await b.eval(`setChatDone(${JSON.stringify(id)}, true); return 1`); await sleep(600);
      await b.eval(`go('folder', ${JSON.stringify(demo.projects.find(p => p.name === 'Starfall Tavern').cwd)}); return 1`); await sleep(900);
      const dz = await b.eval(`const d = document.querySelector('.done-chats'); return d && { shown: !d.hidden, sum: d.querySelector('summary').textContent, rows: d.textContent }`);
      t.check('its project keeps it under Done', dz && dz.shown && /^Done · 1$/.test(dz.sum) && /Tavern brawl/.test(dz.rows), dz);
      await t.shot(b, 'done');
      t.check('its menu offers Not done', await b.eval(`return doneItem(${JSON.stringify(id)}).label === 'Not done'`));
      await b.eval(`setChatDone(${JSON.stringify(id)}, false); return 1`); await sleep(600);
      t.check('Not done brings it back', await b.eval(`const d = document.querySelector('.done-chats'); return !d || d.hidden`) && await b.eval(`return [...document.querySelectorAll('#wbList > ul.rows li')].some(x => /Tavern brawl/.test(x.textContent))`));
      // Tidy-up: with nothing new for longer than the chosen time, a chat counts as done.
      t.check('tidy-up counts old, quiet chats as done', await b.eval(`S.prefs.autoDone = 3; const old = { id: 'x-old', updated: Date.now() - 5 * 864e5 }, fresh = { id: 'x-new', updated: Date.now() - 864e5 }; const r = isDoneChat(old) && !isDoneChat(fresh); S.prefs.autoDone = 0; return r`));
    },
  },
  {
    name: 'aside',
    // A side question beside the chat, and a follow-up later from a reply.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const feedBefore = await b.eval(`return document.querySelectorAll('#cFeed .turn, #cFeed .umsg').length`);
      await b.eval(`const ta = document.getElementById('cText'); ta.value = '/btw what does rally_bonus do?'; return 1`);
      await b.clickOn('#cSend'); await sleep(1200);
      const card = await b.eval(`const c = document.getElementById('cAside'); return c && { shown: !c.hidden, q: c.querySelector('.as-q')?.textContent, a: c.querySelector('.as-a')?.textContent, bring: !c.querySelector('[data-as="bring"]').hidden }`);
      t.check('/btw asks beside the chat, in its own card', card && card.shown && card.q === 'what does rally_bonus do?', card);
      t.check('…and shows the answer there', card && /co-op bonus cap/.test(card.a || ''), card);
      t.check('the chat itself isn’t sent anything', !calls.some(([p]) => p === '/api/chat/send') && calls.some(([p, body]) => p === '/api/chat/aside' && body.text === 'what does rally_bonus do?') && (await b.eval(`return document.querySelectorAll('#cFeed .turn, #cFeed .umsg').length`)) === feedBefore);
      await t.shot(b, 'aside');
      await b.clickOn('[data-as="bring"]'); await sleep(300);
      const text = await b.eval(`return document.getElementById('cText').value`);
      t.check('“Put it in my message” brings the answer into your message, and closes it', /^Side question: what does rally_bonus do\?\n\n> It sets/.test(text) && await b.eval(`return document.getElementById('cAside').hidden`) && calls.some(([p]) => p === '/api/chat/aside-end'), text);
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
      // Run the project, beside the chat.
      await b.eval(`openRun(); return 1`); await sleep(800);
      const run = await b.eval(`const r = document.getElementById('cRun'); return r && { shown: !r.hidden, text: r.textContent.replace(/\\s+/g, ' ') }`);
      t.check('Run the project starts it and shows where it’s serving', run && run.shown && /Running ?npm run dev/.test(run.text) && /Open localhost:5173/.test(run.text) && /VITE v6\.0\.0 ready/.test(run.text), run);
      await t.shot(b, 'run');
      await b.clickOn('#cRun [data-run="tell"]'); await sleep(300);
      t.check('“Show Claude the output” puts it in your message', /^Here’s what `npm run dev` printed:\n\n```\n> starfall/.test(await b.eval(`return document.getElementById('cText').value`)));
      await b.clickOn('#cRun [data-run="stop"]'); await sleep(400);
      t.check('Stop stops it', /Stopped|Not running/.test(await b.eval(`return document.getElementById('cRun').textContent`)) && !!(await b.eval(`return document.querySelector('#cRun [data-run="start"]')`)));
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
      // Do this later: the reply's next steps, each its own chat later, knowing this one.
      await b.eval(`document.querySelector('#cFeed .turn[data-prov="claude"] [data-c="turnmore"]').click(); [...document.querySelectorAll('#menu button')].find(x => x.textContent.includes('Do this later')).click(); return 1`); await sleep(500);
      const lt = await b.eval(`const d = document.getElementById('laterDlg'); return d && { open: d.open, title: document.getElementById('ltTitle').textContent, intro: document.getElementById('ltIntro').textContent, steps: [...d.querySelectorAll('.lt-step textarea')].map(x => x.value), go: document.getElementById('ltGo').textContent }`);
      t.check('Do this later explains itself; a reply without next steps says so (no made-up ones)', lt && lt.open && lt.title === 'Do this later' && /its own chat in Starfall Tavern/.test(lt.intro) && lt.steps.length === 0 && await b.eval(`return !!document.querySelector('#ltSteps .lt-none')`), lt);
      t.check('a reply’s list of next steps is offered, without code or questions', await b.eval(`return JSON.stringify(laterSteps('Done.\\n\\n\`\`\`js\\nx()\\n\`\`\`\\n\\nNext:\\n1. Add a **co-op** test\\n2. Update the patch notes\\n\\nShould I push it?'))`) === '["Add a co-op test","Update the patch notes"]');
      await b.eval(`const d = document.getElementById('laterDlg'); d.querySelector('#ltSteps').innerHTML = '<label class="lt-step"><input type="checkbox" checked><textarea rows="1">Add a co-op test for four bards</textarea></label>'; document.getElementById('ltOwn').value = 'Write patch notes for the Rally change'; d.querySelector('[name="ltWhen"][value="tonight"]').click(); document.getElementById('ltOwn').dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      t.check('the button counts what it queues', await b.eval(`return document.getElementById('ltGo').textContent`) === 'Queue 2 tasks');
      await t.shot(b, 'later');
      await b.clickOn('#ltGo'); await sleep(900);
      const adds = calls.filter(([p, body]) => p === '/api/tasks' && body.action === 'add').map(([, body]) => body.task);
      t.check('each queues as its own task, for tonight, carrying where it came from', adds.length >= 2 && adds.every(x => x.when === 'at' && new Date(x.at).getHours() === 22 && x.from && x.from.id === demo.ID['s-bard'] && x.from.mid === 'm1') && adds.some(x => x.prompt === 'Write patch notes for the Rally change'), adds);
      const mark = await b.eval(`const m = document.querySelector('#cFeed .turn .later-mark'); return m && m.textContent.replace(/\\s+/g, ' ')`);
      t.check('the reply then says what’s queued from it', /\d+ queued for later/.test(mark || '') && /See the queue/.test(mark || ''), mark);
    },
  },
  {
    name: 'half loaded',
    // A script lost on the way (a patchy connection): the page reloads once by itself, then says so.
    async run(t) {
      const b = await t.open({ demo: false });   // its own interception, not the demo's
      let tries = 0, block = 2;
      await b.intercept('*/ui/base.js*', () => (block-- > 0 ? (tries++, { status: 503, type: 'text/plain', body: 'busy' }) : null));
      await b.nav(`${await b.eval('return location.origin')}/`, 4000);
      const r = await b.eval(`return { alert: document.querySelector('[role="alert"]')?.textContent || '', loaded: typeof wrap === 'function' }`);
      t.check('it reloads once by itself, and then says it didn’t load fully', tries === 2 && /didn’t load fully/.test(r.alert) && !r.loaded, { tries, ...r });
      await b.nav(`${await b.eval('return location.origin')}/`, 3000);
      t.check('the next time it loads, it’s whole again', await b.eval(`return typeof wrap === 'function' && !document.querySelector('[role="alert"]')`));
      b.logs.length = 0;   // the lost script's errors were the point of this test
    },
  },
  {
    name: 'long chat speed',
    // One live round (your message, a reply with steps and pictures, its changes) in a chat of 100,
    // 400 and 800 replies: it should stay quick however long the chat gets.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const res = await b.eval(`
        let n = 0, seq = 100000;
        const pic = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const round = () => {
          const i = n++, at = new Date().toISOString();
          handle({ kind: 'user', text: 'Round ' + i + ': tweak the rally numbers and check \`art/hero.png\`', images: [], at, local: true, seq: ++seq });
          handle({ kind: 'assistant', mid: 'bench' + i, at, model: 'claude-opus-5-5', seq: ++seq, blocks: [
            { type: 'tool', id: 'bt' + i, name: 'Read', summary: 'shots/round' + i + '.png', detail: '{}', detailKind: 'json', result: { text: '', isError: false, images: [{ src: pic }] } },
            { type: 'tool', id: 'bu' + i, name: 'Edit', summary: 'scripts/bard/songs.lua', detail: { old: 'a', new: 'b' }, detailKind: 'diff', meta: { path: 'scripts/bard/songs.lua' }, result: { text: 'ok', isError: false, images: [] } },
            { type: 'text', text: 'Done with round ' + i + '. Changed **songs.lua**; see \`art/hero.png\`.\\n\\n- a next step\\n- another one' },
          ] });
          handle({ kind: 'changes', turn: 10000 + i, files: [{ path: 'scripts/bard/songs.lua', status: 'changed', add: 1, del: 1 }, { path: 'art/hero' + i + '.png', status: 'added', add: 0, del: 0 }], more: 0, since: at, seq: ++seq });
          handle({ kind: 'result', ok: true, seq: ++seq });
        };
        const out = {};
        for (const size of [100, 400, 800]) {
          while (n < size) round();
          // As between real replies: a moment for older chapters out of sight to fold.
          const sc = document.getElementById('cScroll'); sc.scrollTop = sc.scrollHeight;
          await new Promise(r => setTimeout(r, 2600));
          const times = [];
          for (let k = 0; k < 5; k++) { const t0 = performance.now(); round(); await new Promise(r => requestAnimationFrame(() => r())); times.push(performance.now() - t0); }
          times.sort((a, b) => a - b);
          out[size] = { ms: Math.round(times[2] * 10) / 10, nodes: document.querySelectorAll('#cFeed *').length };
        }
        return out;`);
      console.log('    per round (median of 5, including the paint):', JSON.stringify(res));
      t.check('a live round stays quick in a chat of 800 replies', res[800].ms < (process.env.CI ? 250 : 40), res);   // GitHub's shared machines are slower and noisier
      t.check('and doesn’t grow much with the chat’s length', res[800].ms < res[100].ms * 4 + 20, res);
    },
  },
  {
    name: 'phone crew',
    // On a phone: the crew pills and the side question card fit, and nothing sits on anything else.
    async run(t) {
      const b = await t.open({ width: 412, height: 880, mobile: true });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b.eval(`if (C.comp) { C.comp.mode = 'full'; C.comp.modes = [{ value: 'full', label: 'Edit files without asking' }]; C.comp.accountId = 'codex'; } window.roomLeft = () => 4; renderCrew(); return 1`); await sleep(300);
      const crew = await b.eval(`const box = document.getElementById('cCrew').getBoundingClientRect(); const pills = [...document.querySelectorAll('#cCrew .crew')].map(p => p.getBoundingClientRect());
        const inside = pills.every(r => r.right <= innerWidth + 1 && r.left >= -1);
        const c = document.querySelector('#cCrew .crew.codex'), n = c && c.querySelector('.crew-n').getBoundingClientRect(), m = c && c.querySelector('.crew-mode');
        const overlap = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const room = c && c.querySelector('.crew-room');
        return { inside, modeShown: !!m && getComputedStyle(m).display !== 'none', roomOverName: !!room && overlap(n, room.getBoundingClientRect()) && room.getBoundingClientRect().left < n.right - 2 }`);
      t.check('the crew pills stay on the screen', crew.inside, crew);
      t.check('the partner’s mode moves into its menu on a phone, and its room doesn’t cover its name', !crew.modeShown && !crew.roomOverName, crew);
      await b.eval(`openAside(); return 1`); await sleep(300);
      const card = await b.eval(`const c = document.getElementById('cAside'); const bg = getComputedStyle(c).backgroundColor; const h = c.querySelector('.as-h b').getBoundingClientRect(); return { solid: !/rgba\\(.*,\\s*0?\\.\\d+\\)/.test(bg), bg, titleOneLine: h.height < 22, jumpHidden: getComputedStyle(document.getElementById('cJump')).display === 'none' }`);
      t.check('the side question card is solid, with its title on one line', card.solid && card.titleOneLine, card);
      t.check('and the jump button doesn’t hide under it', card.jumpHidden, card);
      await t.shot(b, 'crew');
    },
  },
  {
    name: 'long question',
    // A question with many answers, on a short screen and a phone: it scrolls, its Send button stays
    // in view, and the conversation and the message box stay on screen.
    async run(t) {
      for (const size of [{ width: 1366, height: 680 }, { width: 412, height: 780, mobile: true }]) {
        const b = await t.open(size);
        await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
        await b.eval(`addPermission({ requestId: 'q-long', toolName: 'AskUserQuestion', questions: [{ question: 'Which of these should the bard rework first? Pick the one that matters most for co-op balance.', header: 'Rework', multiSelect: false, options: Array.from({ length: 12 }, (_, i) => ({ label: 'Option ' + (i + 1) + ': Rally, Lullaby or Ballad of Embers, with a longer description', description: 'What this changes for four bards in a co-op party, explained at some length so the card gets tall.' })) }] }); return 1`); await sleep(400);
        const r = await b.eval(`const box = document.getElementById('cPending'), send = box.querySelector('[data-p="answer"]').getBoundingClientRect(), text = document.getElementById('cText').getBoundingClientRect(), feed = document.getElementById('cScroll').getBoundingClientRect();
          return { scrolls: box.scrollHeight > box.clientHeight + 10, sendVisible: send.top >= 0 && send.bottom <= innerHeight && send.top >= box.getBoundingClientRect().top - 1, composer: text.bottom <= innerHeight + 1 && text.height > 20, feedLeft: Math.round(feed.height) }`);
        t.check(`${size.mobile ? 'phone' : 'short screen'}: the answers scroll, with Send answers in view`, r.scrolls && r.sendVisible, r);
        t.check(`${size.mobile ? 'phone' : 'short screen'}: the message box and some of the conversation stay on screen`, r.composer && r.feedLeft >= 60, r);
        // The last answer can be reached.
        const last = await b.eval(`const box = document.getElementById('cPending'); box.scrollTop = box.scrollHeight; await new Promise(r => setTimeout(r, 100)); const opts = box.querySelectorAll('fieldset.q label, fieldset.q button, fieldset.q input'); const l = opts[opts.length - 1].getBoundingClientRect(), bb = box.getBoundingClientRect(); return l.bottom <= bb.bottom + 1 && l.top >= bb.top`);
        t.check(`${size.mobile ? 'phone' : 'short screen'}: the last answer can be scrolled to`, last);
        await t.shot(b, size.mobile ? 'phone' : 'short');
      }
    },
  },
  {
    name: 'screens',
    // Every screen size: a long menu stays on screen and scrolls to its last item; dialogs fit, at the
    // normal and the biggest interface size.
    async run(t) {
      const sizes = [{ width: 1280, height: 720 }, { width: 1366, height: 680, ui: 130 }, { width: 768, height: 1024, mobile: true }, { width: 412, height: 780, mobile: true }, { width: 412, height: 780, mobile: true, ui: 130 }];
      for (const size of sizes) {
        const name = `${size.width}×${size.height}${size.ui ? ` at ${size.ui}%` : ''}`;
        const b = await t.open(size);
        if (size.ui) { await b.eval(`Look.set({ ui: ${size.ui} }); return 1`); await sleep(400); }
        const bar = await b.eval(`const r = document.querySelector('.bar'); return { fits: r.scrollWidth <= innerWidth + 1 && [...r.children].every(c => c.getBoundingClientRect().right <= innerWidth + 1), w: r.scrollWidth, iw: innerWidth }`);
        t.check(`${name}: the top bar keeps to the screen`, bar.fits, bar);
        await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
        await b.eval(`document.querySelector('[data-c="more"]').click(); return 1`); await sleep(400);
        const m = await b.eval(`const m = document.getElementById('menu'), z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--look-ui')) || 1, r = m.getBoundingClientRect();
          const inView = r.top >= -1 && r.bottom * 1 <= innerHeight + 1;
          m.scrollTop = m.scrollHeight; await new Promise(r => setTimeout(r, 50));
          const items = m.querySelectorAll('button'), last = items[items.length - 1].getBoundingClientRect();
          return { inView, top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, lastReachable: last.bottom <= r.bottom + 1 && last.top >= r.top - 1, n: items.length }`);
        t.check(`${name}: the chat’s ⋯ menu stays on screen, and its last item can be scrolled to`, m.inView && m.lastReachable, m);
        if (!size.mobile && !size.ui) {
          const crew = await b.eval(`return [...document.querySelectorAll('#cCrew .crew:not(.both) .crew-m')].map(x => ({ t: x.textContent, cut: x.scrollWidth > x.clientWidth + 1 }))`);
          t.check(`${name}: the message box shows both models’ names in full`, crew.length === 2 && crew.every(x => !x.cut), crew);
          await t.shot(b, `${name.replace(/\W+/g, '-')}-crew`);
        }
        await b.eval(`closeMenu(); ChatUI.close(); openTaskDialog(); return 1`); await sleep(400);
        const d = await b.eval(`const d = document.getElementById('taskDlg'), r = d.getBoundingClientRect(); const go = d.querySelector('[type="submit"]'); go.scrollIntoView({ block: 'nearest' }); const g = go.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), w: innerWidth, h: innerHeight, goVisible: g.bottom <= innerHeight + 1 && g.top >= 0 }`);
        t.check(`${name}: a dialog fits the screen, with its button reachable`, d.top >= -1 && d.bottom <= d.h + 1 && d.right <= d.w + 1 && d.goVisible, d);
        await t.shot(b, name.replace(/\W+/g, '-'));
        await b.eval(`document.getElementById('taskDlg').close(); return 1`);
      }
    },
  },
  {
    name: 'menu in a dialog',
    // A menu opened from inside a dialog (the prompt editor's Add a starter set) shows above it, and works.
    async run(t) {
      const b = await t.open();
      await b.eval(`openPromptEditor(); return 1`); await sleep(500);
      await b.clickOn('[data-pd="sets"]'); await sleep(400);
      const r = await b.eval(`const m = document.getElementById('menu'); if (m.hidden) return { shown: false }; const q = m.querySelector('button').getBoundingClientRect(); const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { shown: true, open: m.matches(':popover-open'), backOpen: document.getElementById('menuBack').matches(':popover-open'), at: at && (at.id || at.className), onTop: !!at && m.contains(at), items: [...m.querySelectorAll('button')].map(x => x.textContent.trim()) }`);
      t.check('its menu shows above the dialog, where it can be clicked', r.shown && r.onTop, r);
      await t.shot(b, 'starter');
      await b.clickOn('#menu button'); await sleep(500);
      t.check('and picking from it closes the menu, leaving the dialog open', await b.eval(`return document.getElementById('menu').hidden && !!document.querySelector('dialog[open]')`));
    },
  },
  {
    name: 'palette finds',
    // Ctrl+K finds what you'd look for by name, and the chat's own actions while you're in one.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const find = q => b.eval(`openPalette(${JSON.stringify(q)}); await new Promise(r => setTimeout(r, 250)); const t = document.getElementById('palette').textContent; closePalette && closePalette(); return t`);
      const want = { phone: /Phone access/, 'quiet hours': /Alerts and quiet hours/, 'text size': /Text and interface size/, 'theme studio': /Theme Studio/, 'edit prompts': /Edit prompts/, 'mark done': /Mark done/, btw: /Ask a side question/, stop: /Stop this chat/, rename: /Rename chat/, find: /Find in this chat/ };
      const missing = [];
      for (const [q, re] of Object.entries(want)) if (!re.test(await find(q))) missing.push(q);
      t.check('Ctrl+K finds settings and the chat’s own actions by name', !missing.length, missing);
      t.check('Rules and tools from inside a chat is about that chat’s project', await b.eval(`return paletteHere() === C.info.cwd`));
      // Plain words for an action.
      const say = await find('codex chat in starfall to make the icons');
      t.check('“codex chat in starfall to make the icons” offers exactly that', /Start a Codex chat in Starfall Tavern: make the icons/.test(say), say.slice(0, 200));
      t.check('“queue … in … tonight” offers a queued task', /Queue in Starfall Tavern: write the patch notes \(tonight\)/.test(await find('queue write the patch notes in starfall tonight')));
      t.check('“race … in …” offers a race', /Race in Starfall Tavern: fixing the save bug/.test(await find('race fixing the save bug in starfall')));
    },
  },
  {
    name: 'feels instant',
    // The hub draws at once from last time; pointing at a chat fetches it ahead, so it opens at once.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u) => calls.push([p, u]) });
      await sleep(800);
      const cached = await b.eval(`const c = JSON.parse(localStorage.getItem('boot-cache') || 'null'); return !!c && !!c.sessions && !!c.state`);
      t.check('after a load, the hub is kept for next time', cached);
      const fromCache = await b.eval(`S.projects = []; renderAll(); const ok = await bootFromCache(); return { ok, projects: S.projects.length, marked: document.body.classList.contains('from-cache') }`);
      t.check('next time it draws from that at once (and says it’s catching up)', fromCache.ok && fromCache.projects > 0 && fromCache.marked, fromCache);
      await b.eval(`await reload(); return 1`);
      t.check('then it’s up to date, and the mark goes', !(await b.eval(`return document.body.classList.contains('from-cache')`)));
      // Point at a chat on the hub: its history is fetched ahead, and opening it doesn't fetch it again.
      const id = demo.ID['s-brawl'];
      const row = await b.eval(`const el = document.querySelector('[data-chat="${id}"]'); if (!el) return null; el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); return 1`);
      await sleep(500);
      const before = calls.filter(([p, u]) => p === '/api/chat/history' && u.includes(id)).length;
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`); await sleep(1500);
      const after = calls.filter(([p, u]) => p === '/api/chat/history' && u.includes(id)).length;
      t.check('pointing at a chat fetches it ahead; opening it uses that', row === 1 && before === 1 && after === 1, { row, before, after });
      // Focus mode: Ctrl+\ leaves just the conversation, and brings the rest back.
      await b.eval(`document.activeElement && document.activeElement.blur(); return 1`);
      await b.key('\\', 'Backslash', 220, 2); await sleep(300);
      const f1 = await b.eval(`return { rail: getComputedStyle(document.getElementById('cRail')).display, ledger: getComputedStyle(document.getElementById('cLedger')).display }`);
      await b.key('\\', 'Backslash', 220, 2); await sleep(300);
      const f2 = await b.eval(`return getComputedStyle(document.getElementById('cRail')).display`);
      t.check('Ctrl+\\ is focus mode: just the conversation, then everything back', f1.rail === 'none' && f1.ledger === 'none' && f2 !== 'none', { f1, f2 });
    },
  },
  {
    name: 'pick up',
    // What's new after an update (once), a tip the first time, Good morning with yesterday's chats,
    // and a project's week at a glance.
    async run(t) {
      const b = await t.open();
      await b.eval(`localStorage.removeItem('whats-new-seen'); await loadWhatsNew(); return 1`); await sleep(300);
      const wn = await b.eval(`const w = document.getElementById('whatsNew'); return w && w.textContent.replace(/\\s+/g, ' ')`);
      t.check('after an update, the hub says what’s new', !!wn && /Faster, and more out of your way/.test(wn) && /Opens instantly/.test(wn), wn);
      await t.shot(b, 'whats-new');
      await b.clickOn('#whatsNew .wn-b [data-wn="done"]'); await sleep(200);
      await b.eval(`await loadWhatsNew(); renderLive(true); return 1`);
      t.check('Got it puts it away for good', await b.eval(`return !document.getElementById('whatsNew') && localStorage.getItem('whats-new-seen') === 'wn-1'`));
      // Good morning: the first visit of a new day offers the chats from the last day you worked.
      const m = await b.eval(`const y = Date.now() - 864e5; const [s] = allSessions().find(([x]) => x.id === ${JSON.stringify(demo.ID['s-brawl'])}); s.updated = y + 1000;
        localStorage.setItem('seen-at', String(y)); Welcome.card = null; checkAway(); renderLive(true); await new Promise(r => setTimeout(r, 300));
        const w = document.querySelector('.welcome'); return w && { sub: w.querySelector('.wb-sub')?.textContent, chips: [...w.querySelectorAll('[data-welcome="continue"]')].map(x => x.textContent) }`);
      t.check('the first visit of a day offers yesterday’s chats to pick back up', !!m && /yesterday/.test(m.sub || '') && m.chips.length >= 1, m);
      await t.shot(b, 'morning');
      // A tip the first time something appears, once.
      await b.eval(`localStorage.removeItem('tips'); localStorage.removeItem('tips-seen'); Tips.last = 0; Tips.opened = 0; go('folder', S.projects[0].cwd); return 1`); await sleep(700);
      await b.eval(`document.getElementById('toast').classList.remove('show'); tipsTick(); return 1`);
      const tip = await b.eval(`return document.getElementById('toast').textContent`);
      t.check('a project page shows its tip the first time', /Rules and tools, Queue a task/.test(tip), tip);
      t.check('at most one a day', await b.eval(`localStorage.removeItem('tips-seen'); document.getElementById('toast').classList.remove('show'); document.getElementById('toast').textContent = ''; tipsTick(); return !/Rules and tools/.test(document.getElementById('toast').textContent)`));
      t.check('and only once', await b.eval(`Tips.last = 0; localStorage.setItem('tips-seen', JSON.stringify({ project: Date.now() })); document.getElementById('toast').classList.remove('show'); document.getElementById('toast').textContent = ''; tipsTick(); return !/Rules and tools/.test(document.getElementById('toast').textContent)`));
      // The project's week at a glance.
      await b.eval(`renderFolder(); return 1`); await sleep(500);
      const br = await b.eval(`return document.querySelector('.wp-brief')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('a project page sums up its week', /This week/.test(br) && /chat/.test(br) && /3 files changed/.test(br) && /Ask Claude for a summary/.test(br), br);
    },
  },
  {
    name: 'keeps itself good',
    // A slip on the page is noted; Setup lists problems with Ask Claude to fix this; last night's
    // self-check shows on the hub when it found something; speed is timed on this device.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await sleep(600);
      const card = await b.eval(`return document.getElementById('selfCheckCard')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('a self-check that found something shows on the hub', /1 check failed overnight/.test(card) && /crimson light/.test(card), card);
      await t.shot(b, 'card');
      await b.clickOn('#selfCheckCard [data-sc="seen"]'); await sleep(200);
      t.check('OK puts it away', await b.eval(`return !document.getElementById('selfCheckCard')`));
      t.check('the hub’s load time is noted', await b.eval(`return (JSON.parse(localStorage.getItem('speed') || '{}').hub || []).length >= 1`));
      // A slip in the page is sent to the PC, once.
      await b.eval(`setTimeout(() => { null.boom; }, 0); setTimeout(() => { null.boom; }, 10); await new Promise(r => setTimeout(r, 300)); return 1`);
      const slips = calls.filter(([p, body]) => p === '/api/problems' && body && body.message);
      t.check('a slip on the page is noted, once', slips.length === 1 && /null/.test(slips[0][1].message), slips.map(x => x[1].message));
      b.logs.length = 0;   // that slip was on purpose
      await b.eval(`openSetupAt('st-problems'); return 1`); await sleep(1200);
      const box = await b.eval(`return document.getElementById('problemsBox')?.textContent.replace(/\\s+/g, ' ') || ('no box: ' + document.getElementById('setup').open + ' ' + document.getElementById('setupBody').textContent.slice(0, 200))`);
      t.check('Setup lists the problems, newest first, with how often', /Cannot read properties of undefined/.test(box) && /3 times/.test(box) && /Ask Claude to fix this/.test(box), box.slice(0, 300));
      t.check('and the last self-check, and Speed', /The last self-check/.test(box) && /1 check failed/.test(box) && /The hub, from opening the app/.test(box), box.slice(0, 300));
      await b.eval(`document.getElementById('st-problems').scrollIntoView(); return 1`); await sleep(200);
      await t.shot(b, 'setup');
      await b.clickOn('#problemsBox .pb-row:last-child [data-pb="fix"]'); await sleep(1500);
      const fix = await b.eval(`return { open: ChatUI.isOpen(), cwd: C.info && C.info.cwd, text: document.getElementById('cText').value }`);
      t.check('Ask Claude to fix this opens a chat in the app’s folder with the error and the log', fix.open && /Cannot read properties of undefined/.test(fix.text) && /switcher\.log/.test(fix.text) && /usage\.js:42/.test(fix.text), fix);
    },
  },
  {
    name: 'offline',
    // Written with no connection to the PC (a phone off the Wi-Fi): it waits on the device, shows as
    // waiting, and sends by itself when the PC can be reached.
    async run(t) {
      const calls = [];
      const b = await t.open({ mobile: true, width: 390, height: 844, seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b.eval(`window._fetch = window.fetch; window.fetch = (u, o) => String(u).includes('/api/chat/send') ? Promise.reject(new TypeError('Failed to fetch')) : window._fetch(u, o);
        const box = document.getElementById('cText'); box.value = 'Add the bard’s second verse'; box.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      await b.clickOn('#cSend'); await sleep(600);
      const w = await b.eval(`return { shown: document.querySelector('#cFeed .outbox-msg')?.textContent || '', kept: JSON.parse(localStorage.getItem('outbox') || '[]').length, box: document.getElementById('cText').value }`);
      t.check('with no connection, the message waits on the device, shown as waiting', /second verse/.test(w.shown) && /Waiting for a connection/.test(w.shown) && w.kept === 1 && w.box === '', w);
      await t.shot(b, 'waiting');
      await b.eval(`window.fetch = window._fetch; await outboxFlush(); return 1`); await sleep(400);
      const sent = calls.filter(([p, body]) => p === '/api/chat/send' && /second verse/.test(body.text || ''));
      t.check('back in reach, it sends by itself, once', sent.length === 1 && await b.eval(`return !document.querySelector('#cFeed .outbox-msg') && JSON.parse(localStorage.getItem('outbox') || '[]').length === 0`), sent.length);
    },
  },
  {
    name: 'desktop app',
    // In the installed app (a stand-in for it here): what's waiting is told to it, an update shows as
    // a card on the hub, and Setup has its settings.
    async run(t) {
      const b = await t.open();
      await b.eval(`window._sent = []; window._set = [];
        window.desktop = { platform: 'win32', status: s => _sent.push(s), show: () => {}, onOpen: () => {}, onDo: () => {}, onUpdate: () => {},
          update: async () => Desk.update, checkUpdates: async () => ({ status: 'current', version: '6.1.0', checkedAt: Date.now() }), installUpdate: async () => { window._installed = true; },
          settings: async () => ({ version: '6.1.0', keepAwake: true, hotkey: 'CommandOrControl+Shift+Space', hotkeyOn: true, openAtLogin: false, dataDir: 'C:\\\\Users\\\\alex\\\\AppData\\\\Roaming\\\\Session Switcher' }),
          set: async p => { _set.push(p); return p; } };
        Desk.last = ''; deskStatus(); return 1`);
      const sent = await b.eval(`return _sent[0]`);
      t.check('what’s waiting is told to the app, with a count for the taskbar', !!sent && sent.needs >= 1 && sent.list.length === sent.needs && /^data:image\/png/.test(sent.badge || ''), sent && { needs: sent.needs, working: sent.working });
      await b.eval(`Desk.update = { status: 'ready', next: '6.2.0', version: '6.1.0' }; localStorage.removeItem('desk-update-seen'); renderLive(true); return 1`); await sleep(300);
      const card = await b.eval(`return document.getElementById('deskUpdate')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('an update that’s ready shows on the hub', /Session Switcher 6\.2\.0 is ready/.test(card) && /Restart to update/.test(card), card);
      await t.shot(b, 'update');
      await b.clickOn('#deskUpdate [data-desk="install"]'); await sleep(200);
      t.check('Restart to update asks the app to install it', await b.eval(`return !!window._installed`));
      await b.clickOn('#deskUpdate .wn-b [data-desk="later"]'); await sleep(200);
      t.check('Later puts the card away for that version', await b.eval(`return !document.getElementById('deskUpdate')`));
      await b.eval(`openSetupAt('st-desktop'); return 1`); await sleep(1300);
      const box = await b.eval(`return document.getElementById('deskBox')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('Setup has the desktop app: its version, updates and settings', /6\.1\.0/.test(box) && /Start with Windows/.test(box) && /Keep the PC awake/.test(box) && /Ctrl \+ Shift \+ Space/.test(box), box.slice(0, 240));
      await b.eval(`document.getElementById('st-desktop').scrollIntoView(); return 1`); await sleep(200);
      await t.shot(b, 'setup');
      await b.clickOn('#deskBox [data-deskset="keepAwake"]'); await sleep(300);
      t.check('a setting changes in the app', await b.eval(`return _set.some(p => p.keepAwake === false)`));
    },
  },
  {
    name: 'partner starts',
    // Bringing Codex in, in a chat whose partner's earlier messages are being paged: it starts and
    // its models are there (that list once stood in for the start, and nothing happened).
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const r = await b.eval(`C.comp = null; C.compPending = [{ kind: 'user', at: new Date().toISOString() }]; let err = null; try { await ensureCompanion(); } catch (e) { err = e.message; } return { err, comp: !!C.comp, models: !!(C.mi.comp && C.mi.comp.models && C.mi.comp.models.length) }`);
      t.check('Codex starts even while its earlier messages are being paged', !r.err && r.comp, r);
      t.check('and its models are listed', r.models, r);
    },
  },
  {
    name: 'crew extras',
    // Review big changes by itself (when on), and a heads-up before the account runs out.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const ev = n => JSON.stringify({ kind: 'changes', turn: 90 + n, files: [{ path: 'src/combat.js', status: 'changed', add: n, del: 4 }], more: 0 });
      await b.eval(`S.prefs.autoReview = false; liveRender = true; renderChanges(${ev(60)}, 'main'); liveRender = false; return 1`); await sleep(1800);
      t.check('off: big changes aren’t reviewed by themselves', !calls.some(([p]) => p === '/api/chat/review'));
      await b.eval(`S.prefs.autoReview = true; liveRender = true; renderChanges(${ev(10)}, 'main'); liveRender = false; return 1`); await sleep(1800);
      t.check('on: small changes aren’t either', !calls.some(([p]) => p === '/api/chat/review'));
      await b.eval(`liveRender = true; renderChanges(${ev(70)}, 'main'); liveRender = false; return 1`); await sleep(1800);
      t.check('on: a reply that changed 40 lines or more is reviewed by Codex, once', calls.filter(([p, body]) => p === '/api/chat/review' && body.by === 'codex').length === 1, calls.filter(([p]) => /review/.test(p)));
      // At this pace, the five-hour window runs out within the hour: said once, with who has room.
      const msg = await b.eval(`const id = current().id; S.usage[id] = { data: { available: true, fiveHour: { used: 80, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, week: { used: 30, resetsAt: new Date(Date.now() + 4 * 864e5).toISOString() } } };
        document.getElementById('toast').textContent = ''; forecastLimit(); const first = document.getElementById('toast').textContent;
        document.getElementById('toast').textContent = ''; forecastLimit(); return { first, again: document.getElementById('toast').textContent }`);
      t.check('a heads-up before the account runs out, with who has room', /five-hour window runs out around/.test(msg.first) && /Work as/.test(msg.first), msg.first);
      t.check('once per window', msg.again === '', msg.again);
    },
  },
  {
    name: 'co-workers',
    // A first start: Setup opens on Getting started; Claude Code installs from there. A problem's
    // report leaves nothing personal in. The phone: Windows Firewall checked, and fixed.
    async run(t) {
      const calls = [];
      const b = await t.open({ fresh: true, seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`localStorage.removeItem('getting-started'); S.firstRun = true; await openSetup(); return 1`); await sleep(800);
      const gs = await b.eval(`const g = document.querySelector('.gs'); return g && { text: g.textContent.replace(/\\s+/g, ' '), steps: g.querySelectorAll('.gs-step').length, done: g.querySelectorAll('.gs-step.ok').length }`);
      t.check('a first start opens Setup on Getting started', !!gs && gs.steps === 5 && /Two things and you’re ready/.test(gs.text) && /Install Claude Code/.test(gs.text) && /Sign in/.test(gs.text), gs);
      await t.shot(b, 'getting-started');
      await b.clickOn('.gs [data-fix="install-claude"]'); await sleep(500);
      t.check('Install Claude Code runs Anthropic’s installer', calls.some(([p]) => p === '/api/claude/install'));
      await b.clickOn('.gs-h [data-gs="done"]'); await sleep(600);
      t.check('put away, it stays away', await b.eval(`return !document.querySelector('.gs') && localStorage.getItem('getting-started') === 'done'`));
      t.check('someone already set up never sees it', await b.eval(`localStorage.removeItem('getting-started'); S.firstRun = false; await loadHealth(true); return !document.querySelector('.gs')`));
      // A problem's report: nothing personal in it.
      const rep = await b.eval(`return problemReport({ message: 'EPERM at C:\\\\Users\\\\alex\\\\proj for alex@studio.example', where: 'PC', count: 2, at: new Date().toISOString(), stack: 'token=abcdef0123456789abcdef0123456789abcd' }, 'GET /api/x ghp_abcdefghijklmnopqrstuvwxyz0123456789')`);
      t.check('a report says what happened, and nothing personal', /What happened/.test(rep) && /Version:/.test(rep) && !/alex|abcdef0123|ghp_/.test(rep), rep.slice(0, 300));
      // The phone and Windows Firewall.
      await b.eval(`openSetupAt('st-phone'); return 1`); await sleep(1500);
      const fw = await b.eval(`return document.getElementById('fwBox')?.textContent.replace(/\\s+/g, ' ') || ''`);
      t.check('Phone access says when Windows Firewall keeps the phone out', /blocking/.test(fw) && /public/.test(fw) && /Let my phone in/.test(fw), fw);
      await b.eval(`document.getElementById('fwBox').scrollIntoView({ block: 'center' }); return 1`); await sleep(200);
      await t.shot(b, 'firewall');
      await b.clickOn('#fwBox [data-fw="fix"]'); await sleep(800);
      const fixed = calls.find(([p, body]) => p === '/api/phone/firewall' && body && body.alsoPrivate !== undefined);
      t.check('Let my phone in fixes it (and sets the Wi-Fi as private, as ticked)', !!fixed && fixed[1].alsoPrivate === true && /lets your phone in/.test(await b.eval(`return document.getElementById('fwBox').textContent`)), fixed);
    },
  },
  {
    name: 'autopilot',
    // Out of room mid-chat, as it happens: it carries on as the account with the most room by itself,
    // after a moment to say no.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const ev = { kind: 'limit', which: 'five_hour', resetsAt: new Date(Date.now() + 3600e3).toISOString() };
      await b.eval(`liveRender = true; renderLimit(${JSON.stringify(ev)}, 'main'); liveRender = false; return 1`); await sleep(400);
      const note = await b.eval(`return document.querySelector('.limit-card .lm-auto')?.textContent.replace(/\\s+/g, ' ').trim() || ''`);
      t.check('it says it’s about to carry on as the other account', /Carrying on as Personal in a moment/.test(note), note);
      await b.clickOn('.limit-card [data-c="limitnoauto"]'); await sleep(3000);
      t.check('“Let me choose” stops it', !calls.some(([p, body]) => p === '/api/chat/open' && body.account === 'personal'));
      await b.eval(`liveRender = true; renderLimit(${JSON.stringify(ev)}, 'main'); liveRender = false; return 1`); await sleep(3500);
      t.check('left alone, it carries on as that account, the same conversation', calls.some(([p, body]) => p === '/api/chat/open' && body.account === 'personal' && body.sessionId === demo.ID['s-bard'] && body.mode === 'resume'), calls.filter(([p]) => /open|stop/.test(p)));
    },
  },
  {
    name: 'pictures',
    // A reply's pictures show under it (not folded in its steps); the viewer steps through them all.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      // What it made, what it looked at (sent inline), and a path in a sentence that isn't there.
      await b.eval(`const turn = lastTurnOf('claude');
        const pic = col => { const c = document.createElement('canvas'); c.width = 640; c.height = 400; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 640, 400); return c.toDataURL('image/png'); };
        const red = pic('#a5463f');
        addPic(turn, { src: red }, 'made', 'hero.png');
        addPic(turn, { src: pic('#3c5a96') }, 'looked', 'A screenshot');
        addPic(turn, { path: 'art/not-there.png' }, 'mentioned');
        addPic(turn, { src: red }, 'mentioned');
        return 1`); await sleep(900);
      const strip = await b.eval(`const p = lastTurnOf('claude').querySelector(':scope > .pics'); return p && { cls: p.className, caps: [...p.querySelectorAll('figcaption')].map(x => x.textContent), big: Math.round(p.querySelector('img').getBoundingClientRect().width) }`);
      t.check('a reply’s pictures show under it, each once, with what it did with them', strip && strip.caps.length === 2 && strip.caps[0] === 'Made hero.png' && strip.caps[1] === 'Looked at A screenshot' && /\bn2\b/.test(strip.cls), strip);
      t.check('a path to a picture that isn’t there leaves no empty box', strip && !strip.caps.some(c => /not-there/.test(c)));
      t.check('they’re big enough to see', strip && strip.big >= 150, strip);
      t.check('the same file by its full path and by a short one is one picture', await b.eval(`const tn = document.createElement('div'); addPic(tn, { path: 'C:/Projects/Game/art/hero.png' }, 'made'); addPic(tn, { path: 'art/hero.png' }, 'mentioned'); addPic(tn, { path: 'art\\\\hero.png' }, 'looked'); return picsOf(tn).list.length === 1 && picsOf(tn).list[0].how === 'made'`));
      // Written as Markdown: the picture itself; one on the web is a link.
      const m = await b.eval(`const h = md('Here: ![The key art](art/harvest-festival.png) and ![web](https://example.com/x.png)'); const d = document.createElement('div'); d.innerHTML = h; return { img: !!d.querySelector('.mdimg img'), cap: d.querySelector('.mdimg-cap')?.textContent, web: !!d.querySelector('a[href="https://example.com/x.png"]'), bang: /!/.test(d.textContent) }`);
      t.check('![alt](path) shows the picture, with its caption', m.img && m.cap === 'The key art', m);
      t.check('a picture on the web is a link, with no stray “!”', m.web && !m.bang, m);
      await b.eval(`lastTurnOf('claude').querySelector(':scope > .pics').scrollIntoView({ block: 'center' }); return 1`); await sleep(300);
      await t.shot(b, 'strip');
      // The viewer: every picture in the chat, in order.
      await b.clickOn('.pics .pic-b'); await sleep(400);
      const v = () => b.eval(`const l = document.getElementById('cLight'); return { open: !l.hidden, n: l.querySelector('.lb-n').textContent, cap: l.querySelector('.lb-cap').textContent, open1: !l.querySelector('[data-lb="open"]').hidden }`);
      let x = await v();
      t.check('a picture opens in the viewer, with its name and where it is in the chat', x.open && /^\d+ of \d+$/.test(x.n) && x.cap === 'hero.png', x);
      await t.shot(b, 'viewer');
      const first = x.n;
      await b.key('ArrowRight', 'ArrowRight', 39); await sleep(200);
      x = await v();
      t.check('the arrow keys step to the next picture', x.n !== first && x.cap === 'A screenshot', x);
      await b.esc(); await sleep(200);
      t.check('Escape closes it', !(await v()).open);
      t.check('nothing spills sideways', await b.eval(`return document.scrollingElement.scrollWidth <= innerWidth + 1`));
    },
  },
  {
    name: 'chapters',
    // A long chat divides into chapters after breaks, named after what you said; old ones fold.
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2200);
      const r = await b.eval(`const feed = document.getElementById('cFeed');
        for (const el of [...feed.children]) if (el.id !== 'cEarlier') el.remove();
        const t0 = Date.parse('2026-10-10T09:00:00Z'), topics = ['Plan the tavern brawl', 'Balance the bard songs', 'Paint the festival banner'];
        topics.forEach((topic, c) => { for (let i = 0; i < 110; i++) {
          const at = new Date(t0 + c * 3 * 3600000 + i * 60000).toISOString();
          renderItem(feed, { kind: 'user', text: i ? 'And the next step, please.' : topic, at }, false);
          renderItem(feed, { kind: 'assistant', at, blocks: [{ type: 'text', text: 'Done: step ' + i + ' of ' + topic + '.' }] }, false);
        } });
        toBottom(); await new Promise(r => setTimeout(r, 300));
        chapters(); await new Promise(r => setTimeout(r, 200));
        const heads = [...feed.querySelectorAll(':scope > .chapter .ch-t')].map(x => x.textContent);
        const folds = [...feed.querySelectorAll(':scope > .chapter-fold')].map(x => x.querySelector('.ch-t').textContent + ' | ' + x.querySelector('.ch-at').textContent);
        const turnsLeft = feed.querySelectorAll(':scope > .turn').length;
        return { heads, folds, turnsLeft }`);
      t.check('after a break, a new chapter starts, named after what you said; a long one goes on in parts', r.heads.includes('Paint the festival banner') && r.heads.includes('Paint the festival banner (part 2)') && !r.heads.some(h => /next step/.test(h)), r);
      t.check('in a long chat, chapters well behind you fold to one line, oldest first', /^Plan the tavern brawl \|/.test(r.folds[0]) && /40 messages, 40 replies/.test(r.folds[0]) && r.turnsLeft <= 200 && r.turnsLeft >= 150, r);
      await t.shot(b, 'chapters');
      await b.eval(`const f = document.querySelector('#cFeed > .chapter-fold:last-of-type'); const h = document.querySelector('#cFeed > .chapter'); (h || f).scrollIntoView({ block: 'center' }); return 1`); await sleep(400);
      await t.shot(b, 'heading');
      await b.clickOn('[data-chapopen]'); await sleep(300);
      const open = await b.eval(`chapters(); await new Promise(r => setTimeout(r, 200)); const feed = document.getElementById('cFeed'); return { turns: feed.querySelectorAll(':scope > .turn').length, folds: feed.querySelectorAll(':scope > .chapter-fold').length, marks: ChatMap.marks.filter(m => m.kind === 'chap').length }`);
      t.check('Show brings it back, and it stays open', open.turns === r.turnsLeft + 40 && open.folds === r.folds.length - 1, { open, before: r.turnsLeft });
      await b.eval(`drawMap(); return 1`); await sleep(200);
      t.check('chapters are marked on the conversation map', (await b.eval(`return ChatMap.marks.filter(m => m.kind === 'chap').length`)) >= 2);
    },
  },
  {
    name: 'malibu',
    // The glam theme: its own lettering, words, sunset, sparkles, hearts and chimes; light mode first.
    async run(t) {
      const b = await t.open();
      await b.eval(`Look.set({ theme: 'malibu', mode: 'light' }); return 1`); await sleep(1500);
      const h = await b.eval(`await document.fonts.ready; const dot = getComputedStyle(document.querySelector('.gilt-dot, .ember-dot')); return {
        fonts: document.fonts.check('20px Pacifico') && document.fonts.check('16px Nunito'),
        home: [...document.querySelectorAll('.nav-i .ni-t')].some(x => x.textContent === 'Home'),
        word: document.querySelector('.wordmark small').textContent,
        scene: !!document.querySelector('.hero-art.sunset svg.mb-scene'),
        hearts: document.querySelectorAll('.mb-hearts path').length,
        counts: [...document.querySelectorAll('.sunset .ha-read b')].map(x => +x.textContent),
        sky: !!document.querySelector('#petals .sky-sparkles'),
        heartDot: /svg/.test(dot.maskImage || dot.webkitMaskImage || ''),
        emblem: document.getElementById('sigil').innerHTML.includes('mb-hot') }`);
      t.check('its lettering loads', h.fonts, h);
      t.check('it speaks its own words', h.home && /all dolled up/.test(h.word), h);
      t.check('the hero has the sunset', h.scene, h);
      t.check('a heart in the sky for each chat waiting on you', h.counts.length === 3 && h.hearts === Math.min(h.counts[0], 7), h);
      t.check('sparkles behind the hub', h.sky, h);
      t.check('status dots are hearts', h.heartDot, h);
      t.check('the logo is a heart', h.emblem, h);
      t.check('it chimes with its own notes, not sound files', await b.eval(`return Array.isArray(Look.theme().tones.needs) && !Look.theme().sfx`));
      await t.shot(b, 'hub-light');
      await b.eval(`openSetup('look'); return 1`); await sleep(800);
      t.check('Setup lists it under Glam', await b.eval(`return [...document.querySelectorAll('[aria-label="Glam themes"] .lk-theme')].map(x => x.dataset.v).join() === 'malibu'`));
      await t.shot(b, 'setup');
      await b.eval(`document.getElementById('setup').close(); ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      await t.shot(b, 'chat-light');
      await b.eval(`Look.set({ mode: 'dark' }); return 1`); await sleep(600);
      await t.shot(b, 'chat-dark');
      await b.eval(`ChatUI.close(); return 1`); await sleep(1000);
      await t.shot(b, 'hub-dark');
      const p = await t.open({ width: 412, height: 880, mobile: true });
      await p.eval(`Look.set({ theme: 'malibu', mode: 'light' }); return 1`); await sleep(1200);
      t.check('on a phone, nothing scrolls sideways', await p.eval(`return document.scrollingElement.scrollWidth <= innerWidth + 1`));
      await t.shot(p, 'phone');
      await b.eval(`Look.reset(); return 1`); await p.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'phone back',
    // On a phone: the menu panel takes taps (its backdrop used to cover it), Back steps back through the
    // pages you came through (then the hub), and swiping in from the left edge goes back.
    async run(t) {
      const p = await t.open({ width: 412, height: 880, mobile: true });
      const touch = async (type, x, y) => p.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(40); await touch('touchEnd', x, y); };
      await p.eval(`document.getElementById('navToggle').click(); return 1`); await sleep(500);
      const at = await p.eval(`const nav = document.getElementById('nav'); const item = [...nav.querySelectorAll('.nav-i[data-view="recent"]')].find(x => x.offsetParent); const r = item.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, inNav: !!(el && nav.contains(el)) }`);
      t.check('the open menu panel is on top of its backdrop', at.inNav, at);
      await tap(at.x, at.y); await sleep(900);
      t.check('tapping an item in it works (and closes it)', await p.eval(`return S.view === 'recent' && !document.body.classList.contains('nav-open')`));
      // Back steps back through where you've been.
      const cwd = await p.eval(`const cwd = S.projects[0].cwd; go('folder', cwd); return cwd`); await sleep(500);
      await p.eval(`go('recent'); return 1`); await sleep(500);
      await p.eval(`window.__mobileBack(); return 1`); await sleep(600);
      t.check('Back goes to the page before (a project), not straight to the hub', await p.eval(`return S.view === 'folder' && S.folder === ${JSON.stringify(cwd)}`));
      await p.eval(`window.__mobileBack(); return 1`); await sleep(600);
      t.check('and Back again to the one before that', await p.eval(`return S.view === 'recent'`));
      // A swipe in from the left edge goes back; the arrow follows the finger.
      await touch('touchStart', 3, 420);
      for (const x of [20, 45, 70, 95, 120]) { await touch('touchMove', x, 422); await sleep(16); }
      const arrow = await p.eval(`const a = document.querySelector('.swipe-back'); return a ? a.className : null`);
      await touch('touchEnd', 120, 422); await sleep(700);
      t.check('swiping in from the left edge shows an arrow, lit once far enough', /ready/.test(arrow || ''), arrow);
      t.check('and letting go goes back (from recent chats to the hub, where this started)', await p.eval(`return S.view === 'hub'`));
      // A scroll that starts at the edge isn't a swipe.
      await p.eval(`go('recent'); return 1`); await sleep(500);
      await touch('touchStart', 3, 300); for (const y of [330, 380, 450]) { await touch('touchMove', 8, y); await sleep(16); } await touch('touchEnd', 8, 450); await sleep(500);
      t.check('scrolling from the edge doesn’t go back', await p.eval(`return S.view === 'recent' && !document.querySelector('.swipe-back')`));
      // In a chat, a swipe closes it.
      await p.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      await touch('touchStart', 3, 500); for (const x of [30, 70, 110, 140]) { await touch('touchMove', x, 500); await sleep(16); } await touch('touchEnd', 140, 500); await sleep(800);
      t.check('in a chat, swiping back closes it', await p.eval(`return !ChatUI.isOpen()`));
    },
  },
  {
    name: 'today',
    // The day at a glance (a lane per project, a bar per busy quarter hour, click to open that chat), and
    // empty spots with a small picture (a theme's own painting when it brings one).
    async run(t) {
      const b = await t.open();
      await b.eval(`loadToday(true); return 1`); await sleep(1200);
      const d = await b.eval(`const s = document.getElementById('secToday'); return s ? { lanes: s.querySelectorAll('.td-lane').length, bars: s.querySelectorAll('.td-b').length, sum: s.querySelector('.td-sum').textContent, tip: (s.querySelector('.td-b') || {}).title || '', ticks: [...s.querySelectorAll('.td-ticks span')].map(x => x.textContent), crest: !!s.querySelector('.td-name .crest') } : null`);
      t.check('the day at a glance: a lane per project, each with its crest', d && d.lanes >= 4 && d.crest, d);
      t.check('it sums the day up, and each bar says what happened then', d && /\d+ chats in \d+ projects · \d+ messages/.test(d.sum) && /: \d+ messages?.*most in “/.test(d.tip), d);
      t.check('hours along the top, ending at now', d && d.ticks.length >= 2 && d.ticks[d.ticks.length - 1] === 'now', d);
      await b.eval(`document.getElementById('secToday').scrollIntoView(); return 1`); await sleep(300);
      await t.shot(b, 'strip');
      await b.eval(`document.querySelector('.td-b').click(); return 1`); await sleep(1500);
      t.check('clicking a bar opens the chat that was busiest then', await b.eval(`return ChatUI.isOpen()`));
      await b.eval(`ChatUI.close(); return 1`); await sleep(600);
      // Empty spots get a picture.
      const e = await b.eval(`S.activity = []; renderLive(true); await new Promise(r => setTimeout(r, 300)); return { await: !!document.querySelector('#awaitList .empty-art[data-kind="await"] svg'), work: !!document.querySelector('#board .empty-art[data-kind="work"] svg'), text: (document.querySelector('#awaitList .empty-line') || {}).textContent || '' }`);
      t.check('nothing waiting, nothing working: a small picture and the usual words', e.await && e.work && /Nothing is waiting on you/.test(e.text), e);
      const pic = await b.eval(`Look.set({ theme: 'isekai' }); Look.theme().empty = { await: 'isekai-dark' }; renderLive(true); await new Promise(r => setTimeout(r, 300)); const img = document.querySelector('#awaitList .empty-art.painted img'); const ok = img && img.getAttribute('src') === '/art/isekai-dark.webp'; delete Look.theme().empty; return !!ok`);
      t.check('a theme that brings its own painting for an empty spot shows it', pic);
      await b.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'moments',
    // An approval arriving, a hand-over and a reply landing each get one brief motion, then it's still.
    async run(t) {
      const b = await t.open({ width: 1600, height: 900 });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1800);
      const ap = await b.eval(`handle({ kind: 'permission', requestId: 'm1', toolName: 'Bash', summary: 'Run the tests', detail: 'npm test' }); const c = document.querySelector('.perm[data-req="main:m1"]'); return { arrive: !!c && c.classList.contains('arrive'), anims: c ? c.getAnimations().map(a => a.animationName) : [] }`);
      t.check('an approval rises in with one gold ping', ap.arrive && ap.anims.includes('perm-in') && ap.anims.includes('perm-ping'), ap);
      const ho = await b.eval(`handle({ kind: 'handoff', to: 'codex', state: 'waiting' }); const flow = !!document.querySelector('.cr-link.flow'); handle({ kind: 'handoff', to: 'codex', state: 'sent' }); const pass = !!document.querySelector('.cr-link.pass'); await new Promise(r => setTimeout(r, 1600)); return { flow, pass, after: !!document.querySelector('.cr-link.pass') }`);
      t.check('a hand-over: the line flows while it’s coming, a light runs along it once when it’s made', ho.flow && ho.pass && !ho.after, ho);
      const done = await b.eval(`handle({ kind: 'state', state: 'busy' }); handle({ kind: 'state', state: 'ready' }); const side = document.querySelector('.cr-side.done'); const part = document.querySelector('.part.landed'); await new Promise(r => setTimeout(r, 2900)); return { side: side ? side.textContent : null, part: !!part, after: !!document.querySelector('.cr-side.done') }`);
      t.check('a reply landing: “Done” for a moment on its side, and its last part glows once', done.side && /Done/.test(done.side) && done.part && !done.after, done);
      t.check('replayed history doesn’t replay the moments', await b.eval(`liveRender = false; addPermission({ requestId: 'm2', toolName: 'Bash', summary: 'x' }); return !document.querySelector('.perm[data-req="main:m2"]').classList.contains('arrive')`));
    },
  },
  {
    name: 'preview',
    // Beside the chat: a changed file's change, line by line, from a reply's bar or the ledger, and a
    // picture it made; closed with ✕.
    async run(t) {
      const b = await t.open({ width: 1600, height: 900 });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1800);
      await b.eval(`renderChanges({ turn: 3, files: [{ path: 'scripts/bard/songs.lua', add: 1, del: 1, status: 'modified' }] }, 'main'); return 1`); await sleep(200);
      await b.eval(`document.querySelector('.chg .chg-fn').click(); return 1`); await sleep(800);
      const d = await b.eval(`const rows = [...document.querySelectorAll('#cPreview .pv-r')].map(r => [r.className.replace('pv-r', '').trim(), ...[...r.querySelectorAll('i')].map(i => i.textContent), r.querySelector('code').textContent]); return { title: (document.querySelector('#cPreview .pv-t b') || {}).textContent, rows }`);
      const del = d.rows.find(r => r[0] === 'del'), add = d.rows.find(r => r[0] === 'add');
      t.check('a file named in a reply’s bar shows that change beside the chat', d.title === 'songs.lua' && del && add, d);
      t.check('with line numbers: the removed line’s old number, the added line’s new one', del && del[1] === '13' && del[2] === '' && add && add[1] === '' && add[2] === '13' && /rally\.stacks = false/.test(add[3]), d);
      t.check('no stray empty line at the end', d.rows.length && d.rows[d.rows.length - 1][3].trim() !== '', d.rows);
      await t.shot(b, 'diff');
      // Comments on lines: click a line, write, and send them all to whoever made the change.
      const cm = await b.eval(`const row = document.querySelector('#cPreview .pv-r.add'); row.click(); await new Promise(r => setTimeout(r, 100));
        const ta = document.querySelector('#cPreview .pv-ce textarea'); ta.value = 'Keep stacking off, but say why in a comment.';
        document.querySelector('[data-pvc-add]').click(); await new Promise(r => setTimeout(r, 100));
        const note = document.querySelector('#cPreview .pv-cm')?.textContent || '', bar = document.querySelector('#cPreview .pv-cbar')?.textContent || '';
        document.getElementById('cText').value = '';
        document.querySelector('[data-pvsend]').click(); await new Promise(r => setTimeout(r, 200));
        return { note, bar, box: document.getElementById('cText').value, target: C.target, left: !!document.querySelector('#cPreview .pv-cbar') }`);
      t.check('a line can take a comment, shown under it', /say why in a comment/.test(cm.note) && /1 comment/.test(cm.bar) && /Send to Claude/.test(cm.bar), cm);
      t.check('sending puts every comment in the message box, with its line, for the one who made the change', /songs\.lua, line 13:\n> .*rally\.stacks = false[\s\S]*say why in a comment/.test(cm.box) && cm.target === 'main' && !cm.left, cm);
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
      await b.eval(`document.querySelector('[data-pvclose]').click(); return 1`); await sleep(200);
      t.check('✕ closes it', await b.eval(`return !document.querySelector('#cPreview .pv')`));
      // From the ledger: files changed (the latest change) and pictures it made.
      await b.eval(`const el = document.querySelector('#cLedgerBody [data-pv][data-kind="file"]'); el && el.click(); return 1`); await sleep(800);
      t.check('a file under “Files changed” opens its latest change', await b.eval(`return document.querySelectorAll('#cPreview .pv-r.add').length > 0`));
      await b.eval(`const el = document.querySelector('#cLedgerBody [data-pv][data-kind="image"]'); el && el.click(); return 1`); await sleep(500);
      t.check('a picture under “Images it made” shows there (or says it can’t)', await b.eval(`return !!document.querySelector('#cPreview .pv-img img') && !!document.querySelector('#cPreview .pv-gone')`));
      t.check('switching chats clears it', await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-brawl'])} }); await new Promise(r => setTimeout(r, 1500)); return !document.querySelector('#cPreview .pv')`));
    },
  },
  {
    name: 'performance',
    // Left alone, the hub in every theme (and a chat window) settles: what moves is drawn by the graphics
    // card, so the page isn't re-laid-out or re-styled every frame (each of those was a real CPU drain).
    async run(t) {
      const b = await t.open();
      await b.send('Performance.enable');
      const metrics = async () => { const r = await b.send('Performance.getMetrics'); const m = {}; for (const x of r.result.metrics) m[x.name] = x.value; return m; };
      const busy = [];
      const themes = await b.eval(`return Look.THEMES.map(x => x.id)`);
      for (const [theme, chat] of [...themes.map(x => [x, false]), ['isekai', true], ['crimson', true]]) {
        await b.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: 'dark' }); ${chat ? `ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} });` : 'if (ChatUI.isOpen()) ChatUI.close();'} return 1`);
        await sleep(1800);
        const a = await metrics(); await sleep(2500); const z = await metrics();
        const dt = z.Timestamp - a.Timestamp;
        const layouts = (z.LayoutCount - a.LayoutCount) / dt, styles = (z.RecalcStyleCount - a.RecalcStyleCount) / dt;
        if (layouts > 6 || styles > 12) busy.push(`${theme}${chat ? ' (chat)' : ''}: ${layouts.toFixed(1)} layouts/s, ${styles.toFixed(1)} style recalcs/s`);
      }
      t.check('every theme’s hub, and a chat, is quiet when left alone', !busy.length, busy);
      await b.eval(`if (ChatUI.isOpen()) ChatUI.close(); Look.reset(); return 1`);
    },
  },
  {
    name: 'welcome',
    // Back after a while: what happened meanwhile, and one click back to the chat you were last in.
    // And in a long chat, the map beside it: a mark per message you sent, click one to go there.
    async run(t) {
      const b = await t.open();
      await b.eval(`localStorage.setItem('seen-at', String(Date.now() - 2 * 3600e3)); localStorage.setItem('last-chat', JSON.stringify({ sessionId: ${JSON.stringify(demo.ID['s-brawl'])}, title: 'Tavern brawl encounter design', folder: 'Starfall Tavern', at: Date.now() - 2 * 3600e3 })); location.reload(); return 1`);
      await sleep(2500);
      const w = await b.eval(`const el = document.querySelector('.welcome'); return el ? { text: el.textContent.replace(/\\s+/g, ' '), chips: el.querySelectorAll('.wb-chip').length, back: !!el.querySelector('[data-welcome="continue"]') } : null`);
      t.check('after two hours away, the hub says what happened meanwhile', w && /away 2h/.test(w.text) && /While you were away, .*needs your OK/.test(w.text), w);
      t.check('with the chats that came in, and a way back to the last one', w && w.chips >= 2 && w.back && /Back to “Tavern brawl encounter design”/.test(w.text), w);
      t.check('and what the chats did meanwhile: files changed and reviews back', w && /3 files were changed/.test(w.text) && /a review came back with 2 findings/.test(w.text), w);
      await t.shot(b, 'hub');
      const partnerWelcome = await b.eval(`const previous = S.activity; try { S.activity = [{ key: 'welcome-owner', title: 'Owner', phase: 'idle' }, { key: 'welcome-partner', parentKey: 'welcome-owner', provider: 'codex', source: 'app', title: 'Partner reply', phase: 'idle', finishedAt: Date.now() }]; const el = document.createElement('div'); el.innerHTML = welcomeHtml(); return { text: el.textContent, chip: !!el.querySelector('[data-k="welcome-partner"]') }; } finally { S.activity = previous; }`);
      t.check('welcome back includes an unread reply from the second assistant', /1 reply came in/.test(partnerWelcome.text) && partnerWelcome.chip, partnerWelcome);
      const questionWelcome = await b.eval(`const previous = S.activity; try { S.activity = [{ key: 'welcome-question', title: 'A question', phase: 'waiting', pending: [{ question: true }] }, { key: 'welcome-terminal', title: 'Terminal', phase: 'waiting-terminal' }]; const el = document.createElement('div'); el.innerHTML = welcomeHtml(); return el.textContent; } finally { S.activity = previous; }`);
      t.check('questions and terminal waits ask for attention, not an approval', /2 need your attention/.test(questionWelcome) && !/your OK/.test(questionWelcome), questionWelcome);
      t.check('a quick look away doesn’t bring it back', await b.eval(`dropWelcome(); localStorage.setItem('seen-at', String(Date.now() - 60e3)); checkAway(); await new Promise(r => setTimeout(r, 300)); return !document.querySelector('.welcome')`));
      await b.eval(`localStorage.setItem('seen-at', String(Date.now() - 3 * 3600e3)); checkAway(); return 1`); await sleep(400);
      await b.eval(`document.querySelector('[data-welcome="continue"]').click(); return 1`); await sleep(1500);
      t.check('“Back to …” opens that chat, and the card goes', await b.eval(`return ChatUI.isOpen() && !document.querySelector('.welcome')`));
      // The map: a long chat gets one; each of your messages has a mark.
      await b.eval(`const f = document.getElementById('cFeed'); for (let i = 0; i < 30; i++) { const d = document.createElement('div'); d.className = 'umsg'; d.innerHTML = '<div class="ububble"><div class="utext">Message number ' + i + '</div></div>'; f.appendChild(d); const t = document.createElement('div'); t.className = 'turn'; t.dataset.prov = i % 3 ? 'claude' : 'codex'; t.innerHTML = '<div class="part"><div class="final"><div class="md"><p>' + 'A reply. '.repeat(40) + '</p></div></div></div>'; f.appendChild(t); } return 1`);
      await sleep(900);
      const m = await b.eval(`const map = document.getElementById('cMap'); return { shown: !map.hidden, you: map.querySelectorAll('.cm.you').length, codex: map.querySelectorAll('.cm.turn.codex').length, tip: (map.querySelector('.cm.you') || {}).title }`);
      t.check('a long chat gets a map, with a mark per message you sent', m.shown && m.you >= 30 && m.codex >= 10 && /^You: /.test(m.tip || ''), m);
      await t.shot(b, 'map');
      const jump = await b.eval(`const sc = document.getElementById('cScroll'); sc.scrollTop = sc.scrollHeight; await new Promise(r => setTimeout(r, 200)); const before = sc.scrollTop; document.querySelector('#cMap .cm.you').click(); await new Promise(r => setTimeout(r, 900)); return { before, after: sc.scrollTop }`);
      t.check('clicking a mark goes to that message', jump.after < jump.before - 200, jump);
      // A loaded image can increase the feed's height without adding any DOM nodes.
      const resized = await b.eval(`const f = document.getElementById('cFeed'); const spacer = document.createElement('div'); spacer.style.height = '1px'; f.prepend(spacer); await new Promise(r => setTimeout(r, 800)); const before = parseFloat(document.querySelector('#cMap .cm.you').style.top); spacer.style.height = '2400px'; await new Promise(r => setTimeout(r, 900)); const after = parseFloat(document.querySelector('#cMap .cm.you').style.top); spacer.remove(); return { before, after }`);
      t.check('the map follows content growth, including images loading', resized.after > resized.before + 5, resized);
      await b.eval(`Local.motion = false; applyMotion(); const spacer = document.createElement('div'); spacer.style.height = '100000px'; document.getElementById('cFeed').append(spacer); return 1`); await sleep(900);
      await b.eval(`document.getElementById('cMap').focus(); return 1`); await b.key('End', 'End', 35); await sleep(300);
      const end = await b.eval(`const map = document.getElementById('cMap'), v = map.querySelector('.cm-view'), sc = document.getElementById('cScroll'); return { end: sc.scrollHeight - sc.clientHeight - sc.scrollTop, bottom: v.getBoundingClientRect().bottom - map.getBoundingClientRect().bottom, role: map.getAttribute('role') }`);
      t.check('the map works from the keyboard and its thumb stays inside a very long chat', end.end < 2 && end.bottom <= 1 && end.role === 'scrollbar', end);
      await b.key('Home', 'Home', 36); await sleep(300);
      t.check('Home on the map returns to the start', await b.eval(`return document.getElementById('cScroll').scrollTop < 2 && /0%/.test(document.getElementById('cMap').getAttribute('aria-valuetext'))`));
      await b.eval(`localStorage.removeItem('seen-at'); localStorage.removeItem('last-chat'); return 1`);
    },
  },
  {
    name: 'restart',
    // Restart: offered when a new version is ready, asks how when chats are working, waits for replies
    // with a bar to restart now or cancel, shows that it's restarting, and comes back to the chat you were in.
    async run(t) {
      const b = await t.open();
      await b.eval(`S.update = true; renderBar(); return 1`);
      t.check('a new version ready shows a Restart pill', await b.eval(`return !document.getElementById('updPill').hidden && /Restart/.test(document.getElementById('updPill').textContent)`));
      await b.eval(`document.getElementById('updPill').click(); return 1`); await sleep(300);
      const q = await b.eval(`return document.getElementById('cfQ').textContent`);
      t.check('it asks first, and says a new version is ready', /^Restart Session Switcher\? A new version is ready\./.test(q), q);
      await b.eval(`document.getElementById('cfNo').click(); return 1`); await sleep(200);
      // With a chat working: three answers.
      await b.eval(`S.live = { x: { state: 'busy' } }; restartApp(); return 1`); await sleep(300);
      const ch = await b.eval(`const d = document.querySelector('.choice-dlg[open]'); return d ? [...d.querySelectorAll('.btn')].map(x => x.textContent) : null`);
      t.check('with a chat working it can wait for replies, restart now, or not', JSON.stringify(ch) === JSON.stringify(['Cancel', 'Restart now', 'When replies finish']), ch);
      t.check('Enter waits for replies (the main answer)', await b.eval(`return document.activeElement.textContent === 'When replies finish'`));
      await b.eval(`document.activeElement.click(); return 1`); await sleep(300);
      const bar = await b.eval(`const el = document.getElementById('restartBar'); return el ? el.textContent : null`);
      t.check('while it waits, a bar says so, with Restart now and Cancel', bar && /Restarting when replies finish/.test(bar) && /Restart now/.test(bar) && /Cancel/.test(bar), bar);
      t.check('waiting does not freeze a return location before the restart happens', await b.eval(`return sessionStorage.getItem('restart-return') === null`));
      await t.shot(b, 'waiting');
      await b.eval(`sessionStorage.setItem('restart-return', JSON.stringify({ at: Date.now(), chat: 'old-chat' })); return 1`);
      await b.eval(`document.querySelector('#restartBar [data-restart="cancel"]').click(); return 1`); await sleep(300);
      t.check('Cancel calls it off', await b.eval(`return !document.getElementById('restartBar')`));
      t.check('Cancel also clears an old return note', await b.eval(`return sessionStorage.getItem('restart-return') === null`));
      // Restart now, from inside a chat: it shows that it's restarting and remembers where you were.
      await b.eval(`S.live = {}; ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      await b.eval(`sessionStorage.setItem('restart-return', JSON.stringify({ at: Date.now() - 10 * 60e3, chat: 'old-chat', view: 'hub' })); return 1`);
      await b.eval(`restartApp(); return 1`); await sleep(300);
      await b.eval(`document.getElementById('cfYes').click(); return 1`); await sleep(400);
      const rs = await b.eval(`return { veil: !!document.getElementById('restarting'), back: JSON.parse(sessionStorage.getItem('restart-return') || 'null'), shared: localStorage.getItem('restart-return') }`);
      t.check('it shows that it’s restarting', rs.veil, rs);
      t.check('and notes the chat you were in', rs.back && rs.back.chat === demo.ID['s-bard'], rs);
      t.check('the return note belongs to this window, not every open window', rs.shared === null, rs);
      await t.shot(b, 'restarting');
      // The new page: back in that chat.
      await b.eval(`location.reload(); return 1`); await sleep(2500);
      const back = await b.eval(`return { open: ChatUI.isOpen(), left: sessionStorage.getItem('restart-return') }`);
      t.check('after the reload, the chat you were in opens again', back.open && back.left === null, back);
    },
  },
  {
    name: 'anime',
    // Isekai, High Fantasy and Dungeon: their lettering, words, skies, logos and chimes, and hub scenes
    // that read the same counts as the headline.
    async run(t) {
      const b = await t.open();
      const LOOKS = {
        isekai: { fonts: ['20px Tektur', '16px "M PLUS Rounded 1c"'], home: 'Guild hall', word: /another world/, sky: 'motes', emblem: 'an-glow' },
        highfantasy: { fonts: ['700 20px "Cinzel Decorative"', '16px "EB Garamond"'], home: 'The great hall', word: /scribes of the realm/, sky: 'fireflies', emblem: 'M20.0 5.5' },
        dungeon: { fonts: ['20px "Pirata One"', '16px Alegreya', '16px "Alegreya SC"'], home: 'Camp', word: /deep below/, sky: 'embers', emblem: 'an-iron' },
      };
      for (const [id, want] of Object.entries(LOOKS)) {
        await b.eval(`Look.set({ theme: ${JSON.stringify(id)}, mode: 'dark' }); return 1`); await sleep(1500);
        const h = await b.eval(`await document.fonts.ready; const dot = getComputedStyle(document.querySelector('.gilt-dot, .ember-dot')); return {
          fonts: ${JSON.stringify(want.fonts)}.every(f => document.fonts.check(f)),
          home: [...document.querySelectorAll('.nav-i .ni-t')].some(x => x.textContent === ${JSON.stringify(want.home)}),
          word: document.querySelector('.wordmark small').textContent,
          sky: !!document.querySelector('#petals .sky-glow.${want.sky}'),
          dot: /svg/.test(dot.maskImage || dot.webkitMaskImage || '') || dot.transform !== 'none',
          emblem: document.getElementById('sigil').innerHTML.includes(${JSON.stringify(want.emblem)}),
          tones: Array.isArray(Look.theme().tones.needs) && Array.isArray(Look.theme().tones.engage) && !Look.theme().sfx,
          clockless: !/data-clock>[^<]/.test(document.getElementById('heroSlot')._h || '') }`);
        t.check(`${id}: its lettering loads`, h.fonts, h);
        t.check(`${id}: it speaks its own words`, h.home && want.word.test(h.word), h);
        t.check(`${id}: its sky drifts behind the hub`, h.sky, h);
        t.check(`${id}: status dots take its shape`, h.dot, h);
        t.check(`${id}: the logo is its emblem`, h.emblem, h);
        t.check(`${id}: it chimes with its own notes (choosing it too)`, h.tones, h);
        t.check(`${id}: a new minute alone doesn’t redraw the hero`, h.clockless, h);
        await t.shot(b, `${id}-hub`);
      }
      // Codex's paintings: each theme's for the mode (the Dungeon's stays dark), with the live parts on top.
      for (const [id, mode, want] of [['isekai', 'dark', 'isekai-dark'], ['isekai', 'light', 'isekai-light'], ['highfantasy', 'dark', 'highfantasy-dark'], ['highfantasy', 'light', 'highfantasy-light'], ['dungeon', 'light', 'dungeon-dark']]) {
        await b.eval(`Look.set({ theme: ${JSON.stringify(id)}, mode: ${JSON.stringify(mode)} }); return 1`); await sleep(1200);
        const pt = await b.eval(`const im = document.querySelector('.hero-art.painted .an-paint'); return { href: im && im.getAttribute('href'), drawn: !!document.querySelector('.hero-art .ie-isle, .hero-art .hf-castle, .hero-art .dg-arch'), ok: im ? (await fetch(im.getAttribute('href'))).headers.get('content-type') : null }`);
        t.check(`${id} ${mode}: Codex's painting is the scene`, pt.href === `/art/${want}.webp` && pt.ok === 'image/webp' && !pt.drawn, pt);
      }
      await b.eval(`Look.set({ mode: 'dark' }); return 1`);
      // The scenes read the counts: Isekai's crystals and magic circle, High Fantasy's windows and
      // beacons, the Dungeon's torches, eyes and chests.
      await b.eval(`Look.set({ theme: 'isekai' }); return 1`); await sleep(600);
      const ie = await b.eval(`const n = [...document.querySelectorAll('.ie-sk b')].map(x => +x.textContent), hp = document.querySelector('.ie-bar.hp');
        return { n, crystals: document.querySelectorAll('.ie-crystal').length, on: !!document.querySelector('.ie-circle.on'), hp: hp.querySelector('em').textContent, width: hp.querySelector('i b').style.width, lv: +document.querySelector('.ie-lv b').textContent }`);
      t.check('isekai: a crystal floats up for each chat waiting on you', ie.n.length === 3 && ie.crystals === Math.min(ie.n[0], 6), ie);
      t.check('isekai: the magic circle glows while chats are at work', ie.on === ie.n[1] > 0, ie);
      t.check('isekai: HP is the five-hour window left', /^\d+%$/.test(ie.hp) && ie.width === ie.hp && ie.lv >= 1, ie);
      await b.eval(`Look.set({ theme: 'highfantasy' }); return 1`); await sleep(600);
      const hf = await b.eval(`return { n: [...document.querySelectorAll('.citadel .ha-read b')].map(x => +x.textContent), lit: document.querySelectorAll('.hf-win.lit').length, beacons: document.querySelectorAll('.hf-beacon').length, dragon: !!document.querySelector('.hf-dragon') }`);
      t.check('high fantasy: a window lights for each chat at work, a beacon for each one waiting', hf.n.length === 3 && hf.lit === Math.min(hf.n[1], 9) && hf.beacons === Math.min(hf.n[0], 6) && hf.dragon, hf);
      await b.eval(`Look.set({ theme: 'dungeon' }); return 1`); await sleep(600);
      const dg = await b.eval(`return { n: [...document.querySelectorAll('.delve .ha-read b')].map(x => +x.textContent), torches: document.querySelectorAll('.dg-torch.lit').length, eyes: document.querySelectorAll('.dg-eyes').length, chests: document.querySelectorAll('.dg-chest').length }`);
      t.check('dungeon: a torch for each chat at work, eyes for each one waiting, a chest for each one idle', dg.n.length === 3 && dg.torches === Math.min(dg.n[1], 4) && dg.eyes === Math.min(dg.n[0], 6) && dg.chests === Math.min(dg.n[2], 2), dg);
      await b.eval(`openSetup('look'); return 1`); await sleep(800);
      t.check('Setup lists them under Anime', await b.eval(`return [...document.querySelectorAll('[aria-label="Anime themes"] .lk-theme')].map(x => x.dataset.v).join() === 'isekai,highfantasy,dungeon'`));
      await t.shot(b, 'setup');
      // While a reply is being written, light runs along the top of the message box.
      await b.eval(`document.getElementById('setup').close(); ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      const band = await b.eval(`const was = C.state; setState('busy'); const on = document.getElementById('chat').classList.contains('is-working'); setState('ready'); const off = !document.getElementById('chat').classList.contains('is-working'); setState(was); return { on, off }`);
      t.check('a band of light runs along the message box while it writes', band.on && band.off, band);
      await t.shot(b, 'dungeon-chat');
      await b.eval(`ChatUI.close(); return 1`);
      const p = await t.open({ width: 412, height: 880, mobile: true });
      for (const id of Object.keys(LOOKS)) {
        await p.eval(`Look.set({ theme: ${JSON.stringify(id)}, mode: 'dark' }); return 1`); await sleep(900);
        t.check(`${id}: on a phone, nothing scrolls sideways`, await p.eval(`return document.scrollingElement.scrollWidth <= innerWidth + 1`));
        const fits = await p.eval(`const w = document.querySelector('.ie-win, .hero-art .ha-read'), a = document.querySelector('.hero-art'); const r = w.getBoundingClientRect(), q = a.getBoundingClientRect(); return r.right <= q.right + 1 && w.scrollWidth <= w.clientWidth + 1`);
        t.check(`${id}: on a phone, the scene's readout fits`, fits);
      }
      await t.shot(p, 'phone');
      await b.eval(`Look.reset(); return 1`); await p.eval(`Look.reset(); return 1`);
    },
  },
  {
    name: 'phone',
    async run(t) {
      const b = await t.open({ width: 412, height: 880, mobile: true });
      t.check('nothing scrolls sideways', await b.eval(`return document.scrollingElement.scrollWidth <= innerWidth + 1`));
      // Closed, the menu sits just off the left edge; its shadow mustn't spill onto the page (a grey band in light mode).
      await b.eval(`Look.set({ mode: 'light' }); return 1`); await sleep(300);
      t.check('the closed menu casts no shadow onto the page', await b.eval(`return getComputedStyle(document.querySelector('.nav')).boxShadow === 'none'`));
      await b.eval(`Look.reset(); return 1`);
      await b.eval(`document.getElementById('navToggle').click(); return 1`); await sleep(400);
      t.check('the open menu does', await b.eval(`return getComputedStyle(document.querySelector('.nav')).boxShadow !== 'none'`));
      const n = await b.eval(`const s = getComputedStyle(document.querySelector('.nav')); return { open: document.body.classList.contains('nav-open'), back: getComputedStyle(navBack).display, solid: /gradient/.test(s.backgroundImage) || !/rgba\\(.*, 0(\\.\\d+)?\\)$/.test(s.backgroundColor) }`);
      t.check('the menu opens over a backdrop, on a solid background', n.open && n.back !== 'none' && n.solid, n);
      await t.shot(b, 'phone-nav');
      await b.click(400, 500);
      t.check('a tap outside closes it', !(await b.eval(`return document.body.classList.contains('nav-open')`)));
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const c = await b.eval(`return { bar: getComputedStyle(document.querySelector('.bar')).display, top: document.querySelector('.chat').getBoundingClientRect().top, wide: document.scrollingElement.scrollWidth <= innerWidth + 1 }`);
      t.check('a chat uses the whole screen', c.bar === 'none' && c.top < 2 && c.wide, c);
      t.check('the closed chat list casts no shadow either', await b.eval(`return getComputedStyle(document.getElementById('cRail')).boxShadow === 'none'`));
      await t.shot(b, 'phone-chat');
    },
  },
  {
    name: 'push',
    // Notifications on the phone: the PC sets up Tailscale's https address; the phone turns them on.
    async run(t) {
      const calls = [];
      const b = await t.open({ seen: (p, u, body) => calls.push([p, body]) });
      await b.eval(`setup.showModal(); setupBody.innerHTML = '<div class="prefs" id="phoneBox"></div>'; loadPhone(); return 1`); await sleep(1200);
      const box = () => b.eval(`const x = document.getElementById('tsBox'); return x ? x.textContent.replace(/\\s+/g, ' ').trim() : ''`);
      t.check('Phone access starts with the Android app', /Notifications on your phone/.test(await box()) && /Android: in the app, open Setup/.test(await box()), await box());
      t.check('Tailscale is folded away, for an iPhone or a browser', await b.eval(`const d = document.querySelector('#tsBox details'); return !!d && !d.open && /iPhone, or a browser/.test(d.querySelector('summary').textContent)`));
      await b.eval(`document.querySelector('#tsBox details').open = true; return 1`);
      t.check('it offers to set up Tailscale’s address', /tavern-pc\.tail1234\.ts\.net/.test(await box()) && !!(await b.eval(`return !!document.querySelector('[data-ts="serve"]')`)));
      await b.clickOn('[data-ts="serve"]'); await sleep(600);
      t.check('then shows the address and what to do on the phone', calls.some(([p]) => p === '/api/phone/tailscale-serve') && /Secure address: https:\/\/tavern-pc/.test(await box()) && /Add to Home Screen/.test(await box()), await box());
      t.check('nothing spills out of Setup', await b.eval(`const d = document.getElementById('setupBody'); return d.scrollWidth <= d.clientWidth + 1`));
      await t.shot(b, 'tailscale');
      // The phone's side, by what it is.
      const html = what => b.eval(`${what}; const h = pushBoxHtml(); delete window.Android; return h.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ')`);
      t.check('an older Android app is asked to update', /Update the app to get notifications/.test(await html('window.Android = {}')));
      t.check('the new Android app gets its own switch', /Notifications on this phone/.test(await html(`window.Android = { notifyState: () => '{"on":false}' }`)) && /home Wi-Fi/.test(await html(`window.Android = { notifyState: () => '{"on":false}' }`)));
      t.check('…and says when Android blocks them', /Android is blocking/.test(await html(`window.Android = { notifyState: () => '{"on":true,"allowed":false,"battery":false}' }`)));
      t.check('…or when the battery saver would delay them', /while the phone sleeps/.test(await html(`window.Android = { notifyState: () => '{"on":true,"allowed":true,"battery":false}' }`)));
      t.check('a browser that can gets the switch', /Notifications on this phone/.test(await html('1')) && /Allow and Deny right on it/.test(await html('1')));
      // Shared from another Android app: into the open chat's message box, or you pick the chat.
      const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      await b.eval(`setup.close(); window.Android = { takeShare: () => JSON.stringify({ text: 'https://example.com/bug-report', images: [{ mediaType: 'image/png', data: '${pixel}' }], skipped: 0 }) }; onAndroidShare(); return 1`); await sleep(700);
      const ask = await b.eval(`const d = document.querySelector('dialog.choice-dlg[open]'); return d ? [...d.querySelectorAll('button')].map(x => x.textContent) : null`);
      t.check('with no chat open, it asks which chat (or a new one)', ask && ask.some(x => /^New chat in /.test(x)) && ask.length >= 3, ask);
      await b.eval(`document.querySelector('dialog.choice-dlg[open] button').click(); return 1`); await sleep(2800);
      const put = await b.eval(`return { text: document.getElementById('cText').value, att: C.attachments.length }`);
      t.check('then it waits in that chat’s message box: the text and the picture', put.text === 'https://example.com/bug-report' && put.att === 1, put);
      await b.eval(`C.attachments.length = 0; renderAttachments(); document.getElementById('cText').value = ''; delete window.Android; return 1`);
      t.check('quiet hours and alert levels go to the PC with the subscription', await b.eval(`store('quiet-hours', JSON.stringify({ on: true, from: '22:00', to: '07:00' })); const p = pushPrefs(); store('quiet-hours', ''); return p.quiet.on === true && typeof p.tz === 'string' && typeof p.levels === 'object'`));
    },
  },
  {
    name: 'real data',
    // No demo: the app as it starts on this machine (on a fresh test data folder).
    async run(t) {
      const b = await t.open({ demo: false });
      t.check('the hub loads', await b.eval(`return !!document.querySelector('.nav-i') && !!document.getElementById('page').children.length`));
      // The checks run real commands on this machine, after the app's own start-up work: wait for them, not a set time.
      await b.eval(`openSetup(); const t0 = Date.now(); while (!document.querySelector('.checks li') && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 200)); return Date.now() - t0`);
      const st = await b.eval(`const ids = [...document.querySelectorAll('.setup-toc a')].map(a => a.getAttribute('href')); return { ids, missing: ids.filter(h => !document.querySelector(h)), checks: document.querySelectorAll('.checks li').length, quit: document.querySelector('[data-fix="quit"]')?.className || '' }`);
      t.check('Setup runs its checks', st.checks >= 3, st);
      t.check('Setup quick links all lead somewhere', st.ids.length >= 5 && !st.missing.length, st);
      t.check('Quit looks dangerous', /danger/.test(st.quit), st);
      await t.shot(b, 'setup');
      await b.eval(`document.getElementById('setup').close(); openPalette('setup'); return 1`); await sleep(500);
      t.check('Ctrl+K finds actions', await b.eval(`return /Setup/.test(document.getElementById('palette').textContent)`));
    },
  },
];
