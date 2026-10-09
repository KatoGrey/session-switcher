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
