'use strict';
// Keep chats live in the background (ui/motion.js, Setup): a window that's open but not focused, on a second
// monitor say, keeps moving; with it off, it holds still to save power. Either way, a reply that arrives while
// the window holds still is shown at once, not held at the first, invisible frame of its fade-in.
const { sleep } = require('./browser');
const demo = require('./demo');

module.exports = [{
  name: 'stays live',
  async run(t) {
    const b = await t.open({ width: 1440, height: 900 });
    await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1800);
    const cls = () => b.eval(`const c = document.documentElement.classList; return { rest: c.contains('at-rest'), still: c.contains('still') }`);
    // Looking away: focus elsewhere for a minute, with the mouse touched a moment ago and a chat working.
    const away = (working = true) => b.eval(`document.hasFocus = () => false; awaySince = Date.now() - 60000; restSeen = Date.now() - 1000;
      S.activity = ${working ? `[{ source: 'app', phase: 'writing', key: 'k1' }]` : '[]'}; restCheck(); return 1`);

    t.check('it’s on unless turned off', await b.eval(`return stayLive() && store('stayLive') !== 'off'`));
    await away();
    let c = await cls();
    t.check('on: a window open on another monitor keeps moving', !c.rest && !c.still, c);

    await b.eval(`store('stayLive', 'off'); restCheck(); return 1`);
    c = await cls();
    t.check('off: it holds still after a while away, as before', c.still && !c.rest, c);
    // A reply arriving while it holds still: shown at once, not held invisible.
    const seen = await b.eval(`handle({ kind: 'assistant', mid: 'live-1', at: new Date().toISOString(), model: 'claude-opus-5-5', seq: 900001, blocks: [{ type: 'text', text: 'Hello from the other monitor' }] });
      await new Promise(r => setTimeout(r, 120));
      const el = [...document.querySelectorAll('#cFeed .turn')].find(x => /Hello from the other monitor/.test(x.textContent));
      return el && { opacity: getComputedStyle(el).opacity, fresh: el.classList.contains('fresh'), anim: getComputedStyle(el).animationName }`);
    t.check('a reply arriving while it holds still is shown at once', seen && seen.opacity === '1' && seen.anim === 'none', seen);
    // Back in the window: it's there already, so it counts as played; nothing fades in again later.
    await b.eval(`document.hasFocus = () => true; awaySince = 0; restSeen = Date.now(); restCheck(); return 1`); await sleep(900);
    const back = await b.eval(`const el = [...document.querySelectorAll('#cFeed .turn')].find(x => /Hello from the other monitor/.test(x.textContent)); return { fresh: el.classList.contains('fresh'), opacity: getComputedStyle(el).opacity }`);
    t.check('back in the window, it stays shown and isn’t replayed later', !back.fresh && back.opacity === '1', back);

    await b.eval(`store('stayLive', 'on'); return 1`);
    // Untouched for a while with nothing working: it rests even when on; something working keeps it awake.
    await b.eval(`restSeen = Date.now() - 3 * 60000; S.activity = []; restCheck(); return 1`);
    c = await cls();
    t.check('untouched for a while with nothing working, it rests', c.rest, c);
    await b.eval(`S.activity = [{ source: 'app', phase: 'tool', key: 'k1' }]; restCheck(); return 1`);
    c = await cls();
    t.check('a chat at work keeps it awake', !c.rest && !c.still, c);

    // Fade-ins that keep their class (the sidebar's, handovers) don't play again after a pause; what arrived on low
    // battery isn't all faded in together when it charges.
    const replay = await b.eval(`const root = document.documentElement.classList; const motion = root.contains('motion');
      const kept = document.createElement('div'); kept.className = 'nav-h fresh'; kept.textContent = 'x'; document.body.appendChild(kept);
      await new Promise(r => setTimeout(r, 700));
      const shown = kept.classList.contains('shown');
      setResting('at-rest', true); await new Promise(r => setTimeout(r, 50)); setResting('at-rest', false); await new Promise(r => setTimeout(r, 50));
      const again = kept.getAnimations().length;
      setResting('low-power', true);
      const late = document.createElement('div'); late.className = 'fresh'; late.textContent = 'y'; document.body.appendChild(late);
      await new Promise(r => setTimeout(r, 50)); setResting('low-power', false); await new Promise(r => setTimeout(r, 50));
      const out = { motion, shown, again, late: late.classList.contains('fresh'), lateAnims: late.getAnimations().length, newMark: kept.classList.contains('fresh') };
      kept.remove(); late.remove(); return out`);
    t.check('a fade-in that keeps its class plays once, not again after a pause', !replay.motion || (replay.shown && replay.again === 0 && replay.newMark), replay);
    t.check('what arrived on low battery is just shown when it charges', !replay.late && replay.lateAnims === 0, replay);

    // Setup has the switch, on.
    await b.eval(`if (ChatUI.isOpen()) ChatUI.close(); openSetup(); return 1`); await sleep(1500);
    t.check('Setup has the switch, on', await b.eval(`const x = document.querySelector('[data-local="stayLive"]'); return !!x && x.checked && /Keep chats live in the background/.test(x.closest('label').textContent)`));
    await b.eval(`document.querySelector('[data-local="stayLive"]').click(); return 1`); await sleep(300);
    t.check('turning it off is kept on this device', await b.eval(`return store('stayLive') === 'off'`));
    await b.eval(`document.querySelector('[data-local="stayLive"]').click(); return 1`); await sleep(300);
    t.check('and back on', await b.eval(`return store('stayLive') === 'on'`));
  },
}];
