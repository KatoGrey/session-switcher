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

      // Codex made the key art since Claude last spoke: writing to Claude brings it along.
      await type('Thanks! Use that art in the patch notes.');
      let s = sends().at(-1);
      t.check('Claude is caught up on what Codex did', s && s.key === 'k-bard' && /^<shared-context items="2">/.test(s.text) && /The user, to Codex:/.test(s.text) && /Codex:\nHere it is\./.test(s.text), s && s.text.slice(0, 300));
      t.check('and what you wrote comes after it', s && s.text.endsWith('</shared-context>\n\nThanks! Use that art in the patch notes.'));
      // As the chat shows it: only your words, with the catch-up folded away.
      await b.eval(`handle({ kind: 'user', text: ${JSON.stringify(s.text)}, at: new Date().toISOString(), seq: 300 }); return 1`); await sleep(300);
      const um = await b.eval(`const u = [...document.querySelectorAll('.umsg')].pop(); return { bubble: u.querySelector('.ububble').textContent.trim(), fold: u.querySelector('details.shared summary')?.textContent, raw: RAW.get(u) }`);
      t.check('the chat shows only your words', um.bubble === 'Thanks! Use that art in the patch notes.' && um.raw === 'Thanks! Use that art in the patch notes.', um);
      t.check('with a fold-out saying what was shared', um.fold === 'Claude was caught up on 2 messages', um.fold);
      await t.shot(b, 'caught-up');

      // Claude suggests work for Codex; you switch to Codex and just say "do 2".
      await b.eval(`handle({ kind: 'assistant', mid: 'm9', at: new Date().toISOString(), model: 'claude-opus-5-5', seq: 301, blocks: [
        { type: 'tool', id: 't9', name: 'Edit', summary: 'notes/PATCH-1.4.md', meta: { path: 'notes/PATCH-1.4.md' }, detail: '', detailKind: 'text', result: { text: 'ok', isError: false, images: [] } },
        { type: 'text', text: 'Codex could take two jobs: 1. a 512px icon of the bard, 2. a quick load test of songs.lua.' }] }); return 1`); await sleep(300);
      await b.clickOn('[data-crew="comp"]'); await sleep(300);
      await type('Do number 2, please.');
      s = sends().at(-1);
      t.check('Codex sees Claude’s suggestion (and what it changed)', s && s.key === 'k-bard-cx' && /Claude:\nCodex could take two jobs/.test(s.text) && /\(Claude changed notes\/PATCH-1\.4\.md\.\)/.test(s.text) && /The user, to Claude:\nThanks! Use that art/.test(s.text), s && s.text.slice(0, 400));
      t.check('without repeating what Codex already said', s && !/Codex:\nHere it is/.test(s.text));

      // Both: one message, each caught up on its own; drawn once.
      await b.eval(`handle({ kind: 'user', text: ${JSON.stringify(s.text)}, at: new Date().toISOString(), seq: 302 }, 'comp'); handle({ kind: 'assistant', mid: 'cx9', at: new Date().toISOString(), seq: 303, blocks: [{ type: 'text', text: 'Load test done: 2,000 songs in 41 ms.' }] }, 'comp'); return 1`); await sleep(300);
      await b.clickOn('[data-crew="both"]'); await sleep(300);
      const tgt = await b.eval(`return { target: C.target, ph: document.getElementById('cText').placeholder, on: [...document.querySelectorAll('.crew.on')].map(x => x.dataset.crew).join() }`);
      t.check('“Both” writes to Claude and Codex', tgt.target === 'both' && /Claude and Codex/.test(tgt.ph) && tgt.on === 'main,comp,both', tgt);
      const n0 = sends().length;
      await type('Plan the 1.4 release together.');
      const two = sends().slice(n0);
      t.check('one message goes to each', two.length === 2 && two.some(x => x.key === 'k-bard') && two.some(x => x.key === 'k-bard-cx'), two.map(x => x.key));
      const toClaude = two.find(x => x.key === 'k-bard'), toCodex = two.find(x => x.key === 'k-bard-cx');
      t.check('each caught up on what it missed', /Codex:\nLoad test done/.test(toClaude.text) && !/Codex:\nLoad test done/.test(toCodex.text) && toCodex.text === 'Plan the 1.4 release together.', [toClaude.text.slice(0, 200), toCodex.text.slice(0, 200)]);
      await b.eval(`const at = new Date().toISOString(); handle({ kind: 'user', text: ${JSON.stringify(toClaude.text)}, at, seq: 304 }); handle({ kind: 'user', text: ${JSON.stringify(toCodex.text)}, at, seq: 305 }, 'comp'); return 1`); await sleep(300);
      const last = await b.eval(`const u = [...document.querySelectorAll('.umsg')].filter(x => /Plan the 1.4 release/.test(x.textContent)); return { n: u.length, tag: u[0] && u[0].querySelector('.to-tag')?.textContent, both: u[0] && u[0].classList.contains('to-both') }`);
      t.check('and it shows once: “to Claude & Codex”', last.n === 1 && last.both && last.tag === 'to Claude & Codex', last);
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
      t.check('your next message tells Claude what was undone', sent && /^<shared-context items="\d+">/.test(sent[1].text) && /The user undid the file changes from your earlier reply: scripts\/bard\/songs\.lua, data\/balance\/party\.json, notes\/rally\.md are back as before it\./.test(sent[1].text) && sent[1].text.endsWith('Try a gentler fix.'), sent && sent[1].text.slice(0, 300));
      await b.eval(`const ta = document.getElementById('cText'); ta.value = 'And another thing.'; return 1`);
      await b.key('Enter', 'Enter', 13); await sleep(500);
      t.check('only once', !/undid the file changes/.test(calls.filter(([p]) => p === '/api/chat/send').at(-1)[1].text));
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
      t.check('saying where they are', /Reopened 2 chats; they’re in Running now\./.test(await b.eval(`return document.getElementById('toast').textContent`)));
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
    name: 'looks',
    async run(t) {
      const b = await t.open();
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      const themes = await b.eval(`return Look.themes ? Look.themes().map(x => x.id) : ['crimson', 'sapphire', 'emerald', 'amethyst', 'amber', 'ocean', 'rose', 'graphite']`);
      for (const mode of ['light', 'dark']) {
        for (const theme of themes) {
          await b.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: ${JSON.stringify(mode)} }); return 1`); await sleep(120);
          const c = await b.eval(`const g = n => 'rgb(' + getComputedStyle(document.documentElement).getPropertyValue(n).trim().split(' ').join(',') + ')';
            const s = document.querySelector('.md strong');
            return { faint: g('--c-716a63'), text: g('--c-ede6d9'), bg: getComputedStyle(document.body).backgroundColor, strong: s ? getComputedStyle(s).color : null }`);
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
    name: 'phone',
    async run(t) {
      const b = await t.open({ width: 412, height: 880, mobile: true });
      t.check('nothing scrolls sideways', await b.eval(`return document.scrollingElement.scrollWidth <= innerWidth + 1`));
      await b.eval(`document.getElementById('navToggle').click(); return 1`); await sleep(400);
      const n = await b.eval(`const s = getComputedStyle(document.querySelector('.nav')); return { open: document.body.classList.contains('nav-open'), back: getComputedStyle(navBack).display, solid: /gradient/.test(s.backgroundImage) || !/rgba\\(.*, 0(\\.\\d+)?\\)$/.test(s.backgroundColor) }`);
      t.check('the menu opens over a backdrop, on a solid background', n.open && n.back !== 'none' && n.solid, n);
      await t.shot(b, 'phone-nav');
      await b.click(400, 500);
      t.check('a tap outside closes it', !(await b.eval(`return document.body.classList.contains('nav-open')`)));
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const c = await b.eval(`return { bar: getComputedStyle(document.querySelector('.bar')).display, top: document.querySelector('.chat').getBoundingClientRect().top, wide: document.scrollingElement.scrollWidth <= innerWidth + 1 }`);
      t.check('a chat uses the whole screen', c.bar === 'none' && c.top < 2 && c.wide, c);
      await t.shot(b, 'phone-chat');
    },
  },
  {
    name: 'real data',
    // No demo: the app as it starts on this machine (on a fresh test data folder).
    async run(t) {
      const b = await t.open({ demo: false });
      t.check('the hub loads', await b.eval(`return !!document.querySelector('.nav-i') && !!document.getElementById('page').children.length`));
      await b.eval(`openSetup(); return 1`); await sleep(2500);
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
