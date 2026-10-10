// What a person sees and does: menus, dialogs, the chat window, the model picker, themes and the
// phone layout. Each suite drives a real (headless) browser with real clicks and key presses,
// against the demo world in demo.js, so the results never depend on anyone's own chats.
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

      // Fix and recheck until clean: sends now, rechecks when Claude's done, stops when it's clean.
      await b.clickOn('[data-c="rvloop"]'); await sleep(400);
      const sent = calls.filter(([p]) => p === '/api/chat/send');
      t.check('“until clean” sends the findings to Claude right away', sent.length === 1 && /Name the bonus/.test(sent[0][1].text));
      t.check('the card says which round it’s on', /Round 1 of 3/.test(await b.eval(`return document.querySelector('.review').textContent`)));
      const before = calls.filter(([p]) => p === '/api/chat/review').length;
      await b.eval(`handle({ kind: 'result', ok: true, errors: [], seq: 500 }); return 1`); await sleep(400);
      const recheck = calls.filter(([p]) => p === '/api/chat/review');
      t.check('when Claude finishes, Codex checks again', recheck.length === before + 1);
      t.check('from the same starting point as the first review', recheck.at(-1)[1].base === 'abc0000000000000000000000000000000000def', recheck.at(-1)[1]);
      const expect = await b.eval(`return Review.loop && Review.loop.expect`);
      // Another review finishing meanwhile doesn't count.
      await b.eval(`handle({ kind: 'review', id: 'stray', what: 'something else', state: 'done', overall: 'Fine.', findings: [], seq: 501 }); return 1`); await sleep(200);
      t.check('only the review the loop asked for counts', !!(await b.eval(`return Review.loop && Review.loop.expect`)) && !/Clean after/.test(await b.eval(`return document.querySelector('.review[data-rid="stray"]').textContent`)));
      await b.eval(`handle({ kind: 'review', id: ${JSON.stringify(expect)}, what: ${JSON.stringify(what)}, state: 'done', overall: 'The encore path is fixed.', findings: [], seq: 502 }); return 1`); await sleep(300);
      const end = await b.eval(`const c = document.querySelector('.review[data-rid="${expect}"]'); return c && c.textContent.replace(/\\s+/g, ' ')`);
      t.check('and once it’s clean, it says so and stops', /All clear/.test(end) && /Clean after 1 round of fixes/.test(end) && calls.filter(([p]) => p === '/api/chat/send').length === 1, end);
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
      t.check('a pinned chat moves up to Pinned', (await names('cPinList')).some(n => /^Tavern brawl/.test(n)) && !(await names('cRailList')).some(n => /^Tavern brawl/.test(n)), [await names('cPinList'), await names('cRailList')]);
      t.check('Pinned has its own heading', await b.eval(`return !document.getElementById('cPinH').hidden`));
      await t.shot(b, 'pinned');
      await push(now.filter(x => x.key !== 'k-brawl'));
      const pin = () => b.eval(`const el = document.querySelector('#cPinList .ri'); return el && { n: el.querySelector('.ri-n').textContent, s: el.querySelector('.ri-s').textContent }`);
      const p1 = await pin();
      t.check('and stays there when it’s no longer running', !!p1 && /^Tavern brawl/.test(p1.n) && /^Closed/.test(p1.s), p1);

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
      p = await at('cPinList', 0);
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
      t.check('or Codex, or a nudge when it’s back', card && card.buttons.includes('Hand it to Codex') && card.buttons.includes('Tell me when it’s back'), card && card.buttons);
      await t.shot(b, 'card');

      await b.clickOn('[data-c="limitcodex"]'); await sleep(300);
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
      await b.clickOn('[data-act="race-discard"]'); await sleep(300); await b.clickOn('#cfYes'); await sleep(400);
      t.check('Discard both ends it', /Discarded/.test((await card()).text));
      const items = await b.eval(`return projectItems(${JSON.stringify(demo.projects[0].cwd)}).filter(x => x !== '-').map(x => x.label)`);
      t.check('a project’s menu can start a race', items.includes('Race Claude and Codex…'), items);
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
      await t.shot(b, 'hub');
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
      await t.shot(b, 'waiting');
      await b.eval(`document.querySelector('#restartBar [data-restart="cancel"]').click(); return 1`); await sleep(300);
      t.check('Cancel calls it off', await b.eval(`return !document.getElementById('restartBar')`));
      // Restart now, from inside a chat: it shows that it's restarting and remembers where you were.
      await b.eval(`S.live = {}; ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      await b.eval(`restartApp(); return 1`); await sleep(300);
      await b.eval(`document.getElementById('cfYes').click(); return 1`); await sleep(400);
      const rs = await b.eval(`return { veil: !!document.getElementById('restarting'), back: JSON.parse(localStorage.getItem('restart-return') || 'null') }`);
      t.check('it shows that it’s restarting', rs.veil, rs);
      t.check('and notes the chat you were in', rs.back && rs.back.chat === demo.ID['s-bard'], rs);
      await t.shot(b, 'restarting');
      // The new page: back in that chat.
      await b.eval(`location.reload(); return 1`); await sleep(2500);
      const back = await b.eval(`return { open: ChatUI.isOpen(), left: localStorage.getItem('restart-return') }`);
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
        isekai: { fonts: ['20px Orbitron', '16px "M PLUS Rounded 1c"'], home: 'Guild hall', word: /another world/, sky: 'motes', emblem: 'an-glow' },
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
