// Ctrl+K's matching, pages, empty and loading states and keyboard; and usage numbers that roll.
const { sleep } = require('./browser');
const demo = require('./demo');

// The options as shown, and which one the box points at.
const STATE = `const opts = [...document.querySelectorAll('#palList .pal-i')]; const q = document.getElementById('palQ');
  return { opts: opts.map(o => o.querySelector('.pi-t').textContent), marks: opts.map(o => [...o.querySelectorAll('.pal-hit')].map(m => m.textContent).join('|')), active: q.getAttribute('aria-activedescendant'), sel: (document.querySelector('#palList [aria-selected="true"]') || {}).id || null, crumb: document.getElementById('palCrumb') && !document.getElementById('palCrumb').hidden ? document.getElementById('palCrumb').textContent : '', empty: (document.querySelector('#palList .pal-empty') || {}).textContent || '', label: q.getAttribute('aria-label'), focus: document.activeElement.id, open: !document.getElementById('palette').hidden }`;

module.exports = [
  {
    name: 'command menu',
    async run(t) {
      const b = await t.open();
      await sleep(600);
      const look = async q => { await b.eval(`openPalette(${JSON.stringify(q)}); return 1`); await sleep(150); return b.eval(STATE); };
      // Fuzzy: initials, word starts, the item's own words; marked letters.
      let s = await look('nc');
      t.check('“nc” finds New chat first, its initials marked', s.opts[0] === 'New chat' && s.marks[0] === 'N|c', s.opts.slice(0, 4).concat(s.marks.slice(0, 1)));
      s = await look('phacc');
      t.check('“phacc” finds Phone access first', s.opts[0] === 'Phone access' && s.marks[0] === 'Ph|acc', s.opts.slice(0, 3));
      const mode = (await b.eval(`return Look.isLight()`)) ? 'dark' : 'light';
      s = await look(`s${mode[0]}m`);
      t.check(`“s${mode[0]}m” finds Switch to ${mode} mode (skipping “to”)`, s.opts[0] === `Switch to ${mode} mode`, s.opts.slice(0, 3));
      s = await look('settings');
      t.check('an item’s own words count (settings → Setup and health)', s.opts.includes('Setup and health'), s.opts.slice(0, 5));
      t.check('marks are escaped HTML', await b.eval(`return PalMatch.mark('<b>&x', [[3, 5]]) === '&lt;b&gt;<mark class="pal-hit">&amp;x</mark>'`));
      // Empty: said plainly, the full-text search still there and chosen.
      s = await look('zzqqxxv');
      t.check('nothing matching says so, with a hint, and the message search stays chosen', /Nothing matches “zzqqxxv”/.test(s.empty) && /Enter/.test(s.empty) && s.opts.length === 1 && /Search every message/.test(s.opts[0]) && s.active === 'pal-0' && s.sel === 'pal-0', s);
      // Keyboard: Ctrl+N / Ctrl+P, Home / End, with aria-activedescendant on the right option.
      s = await look('');
      const n = s.opts.length;
      await b.key('n', 'KeyN', 78, 2); await b.key('n', 'KeyN', 78, 2);
      s = await b.eval(STATE);
      t.check('Ctrl+N moves down', s.active === 'pal-2' && s.sel === 'pal-2' && s.focus === 'palQ', s);
      await b.key('p', 'KeyP', 80, 2);
      s = await b.eval(STATE);
      t.check('Ctrl+P moves up', s.active === 'pal-1' && s.sel === 'pal-1', s);
      await b.key('End', 'End', 35);
      s = await b.eval(STATE);
      t.check('End goes to the last', s.active === `pal-${n - 1}` && s.sel === s.active, s.active);
      await b.key('Home', 'Home', 36);
      s = await b.eval(STATE);
      t.check('Home goes to the first', s.active === 'pal-0' && s.sel === 'pal-0', s.active);
      await b.key('ArrowUp', 'ArrowUp', 38);
      s = await b.eval(STATE);
      t.check('↑ from the first wraps to the last', s.active === `pal-${n - 1}`, s.active);
      t.check('Ctrl+N didn’t open a new chat', await b.eval(`return !document.querySelector('dialog[open]')`));
      // Pages: Change theme… opens its list, with a breadcrumb; typing filters it; Backspace goes back.
      s = await look('change theme');
      t.check('an item with a list of its own says so', /Change theme/.test(s.opts[0]) && await b.eval(`return !!document.querySelector('#pal-0 .pi-more') && /opens a list/.test(document.getElementById('pal-0').textContent)`), s.opts.slice(0, 2));
      await b.key('Enter', 'Enter', 13); await sleep(150);
      s = await b.eval(STATE);
      t.check('Enter opens the page: breadcrumb, every theme, the box empty and still focused', /Themes/.test(s.crumb) && s.opts.includes('Sapphire') && s.opts.includes('Crimson') && s.open && s.focus === 'palQ' && /Themes/.test(s.label) && await b.eval(`return document.getElementById('palQ').value === ''`), s);
      t.check('and the hints say how to back out', await b.eval(`return document.getElementById('palEscKey').textContent === 'Esc or ⌫ back'`));
      await b.eval(`const q = document.getElementById('palQ'); q.value = 'sapph'; q.dispatchEvent(new Event('input')); return 1`); await sleep(100);
      s = await b.eval(STATE);
      t.check('typing filters the page', s.opts[0] === 'Sapphire' && s.marks[0] === 'Sapph', s.opts);
      await b.eval(`const q = document.getElementById('palQ'); q.value = ''; q.dispatchEvent(new Event('input')); return 1`); await sleep(100);
      await b.key('Backspace', 'Backspace', 8);
      s = await b.eval(STATE);
      t.check('Backspace on an empty box goes back a page', !s.crumb && s.opts.length > 10 && s.open && await b.eval(`return document.getElementById('palEscKey').textContent === 'Esc close'`), s);
      // Escape: out of the page, then closed with focus back where it was.
      await b.eval(`closePalette(); document.getElementById('seek').focus(); openPalette('change theme'); return 1`); await sleep(150);
      await b.key('Enter', 'Enter', 13); await sleep(150);
      await b.esc();
      s = await b.eval(STATE);
      t.check('Escape in a page goes back to the top', s.open && !s.crumb, s);
      await b.esc();
      s = await b.eval(STATE);
      t.check('and Escape at the top closes, giving the keyboard back', !s.open && s.focus === 'seek', s);
      // Picking from a page runs it and closes.
      await b.eval(`openPalette('change theme'); return 1`); await sleep(120);
      await b.key('Enter', 'Enter', 13); await sleep(120);
      await b.eval(`const q = document.getElementById('palQ'); q.value = 'sapphire'; q.dispatchEvent(new Event('input')); return 1`); await sleep(100);
      await b.key('Enter', 'Enter', 13); await sleep(400);
      t.check('a pick from a page runs and closes', await b.eval(`return Look.get().theme === 'sapphire' && document.getElementById('palette').hidden`));
      await b.eval(`Look.reset(); return 1`); await sleep(300);
      // Frecency: what you pick most comes first among equals.
      const order = () => b.eval(`return palItems('r').filter(x => x.t && !x.g).map(x => x.t)`);
      const before = await order();
      for (let i = 0; i < 4; i++) await b.eval(`PalFrec.note('Routines'); return 1`);
      const after = await order();
      t.check('picking something often moves it up', after.indexOf('Routines') < before.indexOf('Routines') && after.indexOf('Routines') === 0, { before: before.slice(0, 6), after: after.slice(0, 6) });
      t.check('and it’s remembered, capped', await b.eval(`const m = JSON.parse(localStorage.getItem('palette-frecency')); return m.Routines.n > 3 && Object.keys(m).length <= 80`));
      // Loading: documents still coming in say so, and the list fills in when they're here.
      const loading = await b.eval(`let done; worldsLoading = new Promise(r => { done = r; }); openPalette('zzqqxxv'); await new Promise(r => setTimeout(r, 100));
        const during = !!document.querySelector('#palList .pal-note.loading') && /yet/.test(document.querySelector('#palList .pal-empty').textContent);
        const w = worldsLoading; worldsLoading = null; done(); await w; await new Promise(r => setTimeout(r, 100));
        return { during, after: !document.querySelector('#palList .pal-note.loading') }`);
      t.check('documents still loading show a loading row, gone once they’re in', loading.during && loading.after, loading);
      // Sizes: the new pieces are all at least 11 px.
      await b.eval(`openPalette('change theme'); await new Promise(r => setTimeout(r, 100)); return 1`);
      await b.key('Enter', 'Enter', 13); await sleep(120);
      await b.eval(`const q = document.getElementById('palQ'); q.value = 'zzqq'; q.dispatchEvent(new Event('input')); return 1`); await sleep(120);
      await t.shot(b, 'page-empty');
      const sizes = await b.eval(`return [...document.querySelectorAll('.pal-crumb, .pal-crumb span, .pal-empty b, .pal-empty span, .pal-foot span')].filter(x => x.getBoundingClientRect().width).map(x => parseFloat(getComputedStyle(x).fontSize))`);
      t.check('the breadcrumb, empty state and hints are 11 px or more', sizes.length >= 4 && sizes.every(x => x >= 11), sizes);
      await b.esc(); await b.esc();
      if (process.env.SHOTS) {
        // How it sits in Ryan's Imperial and in light mode, for a person to look at.
        for (const look of [{ theme: 'imperial' }, { theme: 'sapphire', mode: 'light' }]) {
          await b.eval(`Look.set(${JSON.stringify(look)}); await new Promise(r => setTimeout(r, 400)); openPalette('nc'); return 1`); await sleep(200);
          await t.shot(b, `${look.theme}-matches`);
          await b.eval(`openPalette('change theme'); return 1`); await sleep(120);
          await b.key('Enter', 'Enter', 13); await sleep(200);
          await t.shot(b, `${look.theme}-page`);
          await b.esc(); await b.esc();
        }
        await b.eval(`Look.reset(); return 1`); await sleep(300);
      }
      // In a chat: its models, as a page.
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      const models = await b.eval(`const it = palItems('switch model').find(x => x.page); if (!it) return null; return it.page().map(x => x.t)`);
      t.check('in a chat, Switch model… lists its models', !!models && models.some(x => /Sonnet|Opus|Haiku|Fable/.test(x)), models);
      await b.eval(`openPalette(); await new Promise(r => setTimeout(r, 100)); return 1`);
      await t.shot(b, 'in-chat');
      t.check('and it’s offered under This chat', await b.eval(`const g = [...document.querySelectorAll('#palList li')]; const i = g.findIndex(x => x.textContent === 'This chat'); const j = g.findIndex((x, k) => k > i && x.classList.contains('pal-g')); return g.slice(i, j < 0 ? undefined : j).some(x => /Switch model/.test(x.textContent))`));
      await b.esc();
    },
  },
  {
    name: 'rolling numbers',
    async run(t) {
      const b = await t.open();
      await sleep(1200);
      const card = `document.querySelector('[data-acct-card="personal"] .aw-v')`;
      const first = await b.eval(`return { text: ${card}.textContent, rolling: document.querySelectorAll('.nf.rolling').length, anims: [...document.querySelectorAll('.nf-k')].reduce((n, el) => n + el.getAnimations().filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length, 0) }`);
      t.check('the first paint doesn’t roll', first.text === '92% left' && !first.rolling && !first.anims, first);
      const bump = (id, used) => `S.usage = JSON.parse(JSON.stringify(S.usage)); S.usage[${JSON.stringify(id)}].data.fiveHour.used = ${used}; renderLive(); renderNav(); if (window.ChatUI && ChatUI.refreshUsage) ChatUI.refreshUsage();`;
      const mid = await b.eval(`${bump('personal', 30)} await new Promise(r => setTimeout(r, 120));
        const el = ${card}; const roll = el.querySelector('.nf');
        return { text: el.textContent, rolling: roll.classList.contains('rolling'), digits: roll.querySelectorAll('.nf-d').length, hidden: [...roll.querySelectorAll('.nf-s')].every(s => s.getAttribute('aria-hidden') === 'true' || s.closest('[aria-hidden="true"]')),
          bar: document.querySelector('[data-acct-card="personal"] .aw-bar i').getAnimations().length, ring: [...document.querySelectorAll('[data-acct-card="personal"] .ac-dial circle.nf-k')].some(c => c.getAnimations().length) }`);
      t.check('a new value rolls, its text already the new number', mid.text === '70% left' && mid.rolling && mid.digits >= 1 && mid.hidden, mid);
      t.check('and its bar and ring move to it', mid.bar > 0 && mid.ring, mid);
      if (process.env.SHOTS) {
        // A still of the roll partway, for a person to look at.
        await b.eval(`document.querySelector('[data-acct-card="personal"]').scrollIntoView({ block: 'center' }); for (const a of document.getAnimations()) if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) { a.pause(); a.currentTime = 160; } return 1`);
        await t.shot(b, 'rolling');
        await b.eval(`for (const a of document.getAnimations()) if (a.playState === 'paused') a.play(); return 1`);
      }
      await sleep(900);
      const end = await b.eval(`const el = ${card}; return { text: el.textContent, html: el.innerHTML.replace(/<span[^>]*>/g, '').replace(/<\\/span>/g, ''), rolling: document.querySelectorAll('.nf.rolling').length }`);
      t.check('then it settles as plain text', end.text === '70% left' && end.html === '70% left' && !end.rolling, end);
      // Redrawn mid-roll with the same value: it carries on rather than jumping.
      const carry = await b.eval(`${bump('personal', 45)} await new Promise(r => setTimeout(r, 150)); renderLive(); await new Promise(r => setTimeout(r, 30)); const roll = ${card}.querySelector('.nf'); const a = roll.querySelector('.nf-s') && roll.querySelector('.nf-s').getAnimations()[0]; return { rolling: roll.classList.contains('rolling'), t: a ? a.currentTime : null }`);
      t.check('a redraw mid-roll carries on from where it was', carry.rolling && carry.t > 100, carry);
      await sleep(900);
      // The top bar's chip (its summary, in this look) and the chat's header roll too.
      const acct = await b.eval(`return S.acct`);
      const chip = await b.eval(`${bump(acct, 52)} await new Promise(r => setTimeout(r, 100)); const c = document.querySelector('#usechip .ac-summary'); return { rolling: !!c.querySelector('.nf.rolling'), text: c.textContent }`);
      t.check('the account chip rolls, readable all the while', chip.rolling && chip.text === '48% left', chip);
      await sleep(900);
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      const who = await b.eval(`return ChatUI.accountId()`);
      const head = await b.eval(`${bump(who, 61)} await new Promise(r => setTimeout(r, 100)); const cu = document.querySelector('#cAcct .cu'); return { rolling: !!cu.querySelector('.nf.rolling'), text: cu.textContent }`);
      t.check('the chat header rolls, readable all the while', head.rolling && head.text === '5h 39%', head);
      await sleep(900);
      await b.eval(`ChatUI.close(); await go('hub'); return 1`); await sleep(500);
      // No motion when it's turned off, or in Ryan's saga themes: the value is simply set.
      const still = await b.eval(`Local.motion = false; applyMotion(); ${bump('personal', 12)} await new Promise(r => setTimeout(r, 100)); const out = { text: ${card}.textContent, rolling: document.querySelectorAll('.nf.rolling').length }; Local.motion = true; applyMotion(); return out`);
      t.check('with motion off it just changes', still.text === '88% left' && !still.rolling, still);
      const saga = await b.eval(`Look.set({ theme: 'imperial' }); await new Promise(r => setTimeout(r, 600)); ${bump('personal', 20)} await new Promise(r => setTimeout(r, 100)); const n = document.querySelector('[data-acct-card="personal"] .w-v .nf'); const out = { text: n && n.parentElement.textContent, rolling: document.querySelectorAll('.nf.rolling').length, anims: [...document.querySelectorAll('.nf-k')].reduce((k, el) => k + el.getAnimations().filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length, 0), digits: n && [getComputedStyle(n).fontVariantNumeric, getComputedStyle(n.parentElement).fontVariantNumeric] }; Look.reset(); return out`);
      t.check('Imperial keeps its numbers as they were: no roll, its own figures', saga.text === '80% left' && !saga.rolling && !saga.anims && saga.digits[0] === saga.digits[1], saga);
    },
  },
];
