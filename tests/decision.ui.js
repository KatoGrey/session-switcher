// One decision control (ui/decision.js): a permission request or a simple question looks and behaves the same on a
// hub card, in the chat and on a phone, and an answer only ever goes to the request the card showed.
const { sleep } = require('./browser');
const demo = require('./demo');

const NUTRIENT = '#awaitList [data-k="k-nutrient"]';
const bash = (id, more = {}) => ({ requestId: id, toolName: 'Bash', summary: 'Run the nutrient tests', detail: 'npm test -- --grep nutrient', question: false, canAlways: true, alwaysScope: 'commands that start with “npm test” in this project', defaultToNo: false, reason: null, blockedPath: null, questions: null, ...more });
const question = (id, qs) => ({ requestId: id, toolName: 'AskUserQuestion', summary: '', detail: null, question: true, canAlways: false, alwaysScope: null, defaultToNo: false, questions: qs });
const SAVE_Q = { question: 'Which save format?', header: 'Format', multiSelect: false, options: [{ label: 'JSON', description: 'Readable' }, { label: 'Binary', description: '' }] };

// The PC's side, pretended: every answer is noted; the next one can say "already answered" or fail.
function pc() {
  const s = { calls: [], activity: 0, mode: 'ok' };
  s.respond = async (p, q, body) => {
    if (p === '/api/chat/permission') {
      s.calls.push(body);
      if (s.mode === 'stale') return { status: 409, body: { error: 'Already answered: that request isn’t waiting any more.', reason: 'answered' } };
      if (s.mode === 'fail') return { status: 500, body: { error: 'The PC said no.' } };
      return { body: { ok: true } };
    }
    if (p === '/api/activity') s.activity++;
    return null;
  };
  return s;
}
// The hub's card for the nutrient chat, waiting on these requests (drawn as the next live update would).
const waitOn = (b, list) => b.eval(`const x = S.activity.find(a => a.key === 'k-nutrient'); x.pending = ${JSON.stringify(list)}; x.phase = 'waiting'; renderLive(true); await new Promise(r => setTimeout(r, 150)); return document.querySelector(${JSON.stringify(NUTRIENT)})?.dataset.dec || null`);
const card = b => b.eval(`const c = document.querySelector(${JSON.stringify(NUTRIENT)}); if (!c) return null;
  const btn = p => c.querySelector('[data-p="' + p + '"]');
  const vis = el => !!el && !el.hidden && !!el.getClientRects().length;
  return { req: c.dataset.dec, text: c.textContent.replace(/\\s+/g, ' ').trim(),
    labels: [...c.querySelectorAll('.o-foot button')].filter(vis).map(x => x.textContent.trim()),
    gilt: [...c.querySelectorAll('.o-foot .btn.gilt')].filter(vis).map(x => x.dataset.p || x.dataset.a),
    reqs: [...c.querySelectorAll('[data-p]')].map(x => x.dataset.req),
    note: vis(c.querySelector('.dec-note')), allowShown: vis(btn('allow')), allowOff: !!(btn('allow') && btn('allow').disabled),
    focus: document.activeElement === c.querySelector('.dec-why') ? 'note' : document.activeElement && document.activeElement.dataset.p || null,
    more: c.querySelector('.dec-more')?.textContent.trim() || null, fieldset: !!c.querySelector('fieldset.q') }`);
const lastToast = b => b.eval(`return (document.getElementById('toast') || {}).innerText || ''`);

module.exports = [
  {
    name: 'decision control',
    async run(t) {
      const s = pc();
      const b = await t.open({ respond: s.respond });
      await sleep(900);

      // The card says why it's asking, what Always allow covers, with the chat's words.
      await waitOn(b, [bash('r1', { reason: 'It writes to the test database.' })]);
      let c = await card(b);
      t.check('hub: the card says why it’s asking and what Always allow covers', /Why it’s asking: It writes to the test database\./.test(c.text) && /Always allow: commands that start with “npm test” in this project/.test(c.text), c.text);
      t.check('hub: the chat’s words, Allow standing out, and every button carries the request’s id', c.labels.slice(0, 3).join() === 'Allow once,Always allow,Deny' && c.gilt.join() === 'allow' && c.reqs.every(r => r === 'r1'), c);
      t.check('hub: it says who asks', /Claude wants to run a command/.test(c.text), c.text);
      await b.eval(`document.querySelector(${JSON.stringify(NUTRIENT)}).scrollIntoView({ block: 'center' }); return 1`); await t.shot(b, 'hub-card');

      // The card showed r1; meanwhile the list moved on to r2 (not drawn yet). Allow answers r1, never r2.
      // (A first click into the window would focus it, and the hub redraws on focus: that comes first.)
      await b.clickOn(`${NUTRIENT} .o-where`); await sleep(200);
      await b.eval(`S.activity.find(a => a.key === 'k-nutrient').pending = ${JSON.stringify([bash('r2')])}; return 1`);
      const hit = await b.clickOn(`${NUTRIENT} [data-p="allow"]`); await sleep(300);
      t.check('hub: Allow posts the request the card showed', s.calls.length === 1 && s.calls[0].requestId === 'r1' && s.calls[0].key === 'k-nutrient' && s.calls[0].decision === 'allow', { calls: s.calls, hit, now: await card(b) });
      t.check('hub: and says so', /Allowed\. Hydroponics sim: fix nutrient drift carries on\./.test(await lastToast(b)), await lastToast(b));

      // Answered somewhere else meanwhile: it says so, catches up, and answers nothing else.
      s.mode = 'stale'; s.calls.length = 0;
      await waitOn(b, [bash('r3')]);
      const before = s.activity;
      await b.clickOn(`${NUTRIENT} [data-p="allow"]`); await sleep(700);
      c = await card(b);
      t.check('hub: a request answered elsewhere says “already answered” and touches nothing else', s.calls.length === 1 && s.calls[0].requestId === 'r3' && /Already answered/.test(await lastToast(b)), { calls: s.calls, toast: await lastToast(b) });
      t.check('hub: and the hub catches up', s.activity > before && c && c.req === 'r1' && !c.allowOff, { before, after: s.activity, c });

      // A call that fails: the buttons work again, and it says why.
      s.mode = 'fail'; s.calls.length = 0;
      await waitOn(b, [bash('r4')]);
      await b.clickOn(`${NUTRIENT} [data-p="allow"]`); await sleep(500);
      c = await card(b);
      t.check('hub: a failed call leaves the buttons working, says why and keeps your place', !c.allowOff && c.focus === 'allow' && /Couldn’t answer it: The PC said no\./.test(await lastToast(b)), { c, toast: await lastToast(b) });

      // Default to No: Deny is the one that stands out.
      s.mode = 'ok'; s.calls.length = 0;
      await waitOn(b, [bash('r5', { defaultToNo: true })]);
      c = await card(b);
      t.check('hub: when No is the safe default, Deny stands out', c.gilt.join() === 'deny', c);

      // Deny opens a note; Enter sends it.
      await waitOn(b, [bash('r6')]);
      await b.clickOn(`${NUTRIENT} [data-p="deny"]`); await sleep(250);
      c = await card(b);
      t.check('hub: Deny opens “tell it what to do instead”, with the keyboard in it', c.note && c.focus === 'note' && !c.allowShown && s.calls.length === 0, c);
      await b.send('Input.insertText', { text: 'Use the dry run' }); await sleep(100);
      // A redraw while you type (another request arrives) leaves what you're writing alone.
      await waitOn(b, [bash('r6'), bash('r6b')]);
      t.check('hub: a redraw while you type keeps your words', await b.eval(`return document.activeElement.value === 'Use the dry run'`));
      await b.key('Enter', 'Enter', 13); await sleep(300);
      t.check('hub: Enter sends the denial with your note', s.calls.length === 1 && s.calls[0].requestId === 'r6' && s.calls[0].decision === 'deny' && s.calls[0].message === 'Use the dry run', s.calls);
      t.check('hub: and says so', /Denied\./.test(await lastToast(b)), await lastToast(b));
      // Esc puts the note away; an empty note is fine.
      s.calls.length = 0;
      await waitOn(b, [bash('r7')]);
      await b.clickOn(`${NUTRIENT} [data-p="deny"]`); await sleep(200);
      await b.esc(); await sleep(150);
      c = await card(b);
      t.check('hub: Esc puts the note away and goes back to Deny', !c.note && c.allowShown && c.focus === 'deny' && s.calls.length === 0, c);
      await b.clickOn(`${NUTRIENT} [data-p="deny"]`); await sleep(200);
      await b.clickOn(`${NUTRIENT} [data-p="deny-send"]`); await sleep(300);
      t.check('hub: Deny with nothing written is fine', s.calls.length === 1 && s.calls[0].decision === 'deny' && s.calls[0].message === '' && s.calls[0].requestId === 'r7', s.calls);

      // More than one waiting: "+N more", which opens the chat.
      await waitOn(b, [bash('r8'), bash('r9'), bash('r10')]);
      c = await card(b);
      await b.eval(`window._opened = []; window._realOpenActivity = openActivity; openActivity = x => { _opened.push(x.key); }; return 1`);
      await b.clickOn(`${NUTRIENT} .dec-more`); await sleep(200);
      t.check('hub: “+2 more waiting” when more are waiting, and it opens the chat', c.more === '+2 more waiting' && c.req === 'r8' && (await b.eval(`return _opened.join()`)) === 'k-nutrient', { c, opened: await b.eval(`return _opened`) });
      await b.eval(`openActivity = _realOpenActivity; return 1`);

      // A simple question can be answered right on the card, with the chat's controls.
      s.calls.length = 0;
      await waitOn(b, [question('q1', [SAVE_Q])]);
      c = await card(b);
      t.check('hub: a simple question has its choices on the card', c.fieldset && /Has a question/.test(c.text) && /Claude asks:\s*Format\s*Which save format\?/.test(c.text) && c.labels.slice(0, 2).join() === 'Send answer,Skip', c);
      await t.shot(b, 'hub-question');
      await b.clickOn(`${NUTRIENT} [data-p="answer"]`); await sleep(250);
      t.check('hub: sending without a pick asks for one', s.calls.length === 0 && /Pick an answer for “Which save format\?”/.test(await lastToast(b)), await lastToast(b));
      await b.clickOn(`${NUTRIENT} input[data-label="Binary"]`); await sleep(100);
      await waitOn(b, [question('q1', [SAVE_Q]), bash('r11')]);   // redrawn meanwhile: the pick stays
      await b.clickOn(`${NUTRIENT} [data-p="answer"]`); await sleep(300);
      t.check('hub: answering a simple question from the hub', s.calls.length === 1 && s.calls[0].requestId === 'q1' && s.calls[0].decision === 'allow' && JSON.stringify(s.calls[0].answers) === JSON.stringify({ 'Which save format?': 'Binary' }), s.calls);
      await waitOn(b, [question('q2', [SAVE_Q, { ...SAVE_Q, question: 'Which slot?' }])]);
      c = await card(b);
      t.check('hub: a bigger question still opens the chat', !c.fieldset && /Open the chat to answer them/.test(c.text) && c.labels.join() === 'Answer it', c);

      // A new request never takes the keyboard from a quick reply you're typing.
      await waitOn(b, [bash('r12')]);
      await b.eval(`const ta = document.querySelector('#awaitList [data-k="k-brawl"] form.qr textarea'); ta.focus(); return 1`);
      await b.send('Input.insertText', { text: 'Half done' }); await sleep(100);
      await waitOn(b, [bash('r13'), bash('r14')]);
      t.check('hub: a new request doesn’t take the keyboard from a quick reply', await b.eval(`const a = document.activeElement; return a.matches('form.qr textarea') && a.value === 'Half done' && !!a.closest('[data-k="k-brawl"]')`));
      await b.eval(`document.activeElement.value = ''; document.activeElement.blur(); return 1`);

      // Imperial (Ryan's) keeps its card as it was: the answers in the footer, the same behaviour.
      s.calls.length = 0;
      await b.eval(`Look.set({ theme: 'imperial' }); await new Promise(r => setTimeout(r, 500)); return 1`);
      await waitOn(b, [bash('r15', { reason: 'Because.' })]);
      c = await card(b);
      await b.eval(`document.querySelector(${JSON.stringify(NUTRIENT)}).scrollIntoView({ block: 'center' }); return 1`); await t.shot(b, 'imperial-card');
      await b.clickOn(`${NUTRIENT} .o-foot [data-p="allow"]`); await sleep(300);
      t.check('Imperial: the same card and behaviour, its answers still in the footer', c.labels.slice(0, 3).join() === 'Allow once,Always allow,Deny' && s.calls.length === 1 && s.calls[0].requestId === 'r15' && !(await b.eval(`return document.documentElement.classList.contains('hub2')`)), { c, calls: s.calls });
      await b.eval(`Look.reset(); return 1`); await sleep(300);

      // The chat: the same words, the same default, the same Deny, the same identity.
      s.calls.length = 0; s.mode = 'ok';
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const perm = (id, more = {}) => JSON.stringify({ kind: 'permission', requestId: id, toolName: 'Bash', view: { summary: 'Clear the cache', detail: 'rm -rf .cache', detailKind: 'command' }, canAlways: true, alwaysScope: 'commands that start with “rm” in this project', defaultToNo: false, reason: 'It deletes files.', ...more });
      const chatCard = id => b.eval(`const c = document.querySelector('.perm[data-req="main:${id}"]'); if (!c) return null; const vis = el => !!el && !el.hidden && !!el.getClientRects().length;
        return { text: c.textContent.replace(/\\s+/g, ' ').trim(), labels: [...c.querySelectorAll('.perm-b button')].filter(vis).map(x => x.textContent.trim()), gilt: [...c.querySelectorAll('.perm-b .btn.gilt')].map(x => x.dataset.p), note: vis(c.querySelector('.dec-note')), reqs: [...c.querySelectorAll('[data-p]')].map(x => x.dataset.req),
          focus: document.activeElement === c.querySelector('.dec-why') ? 'note' : (document.activeElement.closest('.perm') === c ? document.activeElement.dataset.p : null), off: !!c.querySelector('[data-p="allow"]')?.disabled }`);
      await b.eval(`document.activeElement.blur(); handle(${perm('c1', { defaultToNo: true })}); return 1`); await sleep(300);
      let cc = await chatCard('c1');
      t.check('chat: the same words, why it’s asking and what Always allow covers', cc && cc.labels.join() === 'Allow once,Always allow,Deny' && /Why it’s asking: It deletes files\./.test(cc.text) && /Always allow: commands that start with “rm” in this project/.test(cc.text) && cc.reqs.every(r => r === 'c1'), cc);
      t.check('chat: when No is the safe default, Deny stands out (and has the keyboard)', cc.gilt.join() === 'deny' && cc.focus === 'deny', cc);
      await t.shot(b, 'chat-card');
      await b.clickOn('.perm[data-req="main:c1"] [data-p="deny"]'); await sleep(250);
      cc = await chatCard('c1');
      t.check('chat: Deny opens the same note, with the keyboard in it', cc.note && cc.focus === 'note' && !cc.labels.length && s.calls.length === 0, cc);
      await b.send('Input.insertText', { text: 'Keep the cache' }); await sleep(100);
      await b.key('Enter', 'Enter', 13); await sleep(300);
      t.check('chat: Enter sends the denial with your note, for that request', s.calls.length === 1 && s.calls[0].requestId === 'c1' && s.calls[0].key === 'k-bard' && s.calls[0].decision === 'deny' && s.calls[0].message === 'Keep the cache', s.calls);
      await b.eval(`handle({ kind: 'permission_done', requestId: 'c1' }); return 1`); await sleep(100);

      // A new request doesn't take the keyboard while you type, or from a button you've moved to; it does when nothing has it.
      await b.eval(`const t = document.getElementById('cText'); t.focus(); return 1`);
      await b.send('Input.insertText', { text: 'hello' }); await sleep(100);
      await b.eval(`handle(${perm('c2')}); return 1`); await sleep(300);
      t.check('chat: a new request doesn’t take the keyboard while you type', await b.eval(`return document.activeElement.id === 'cText' && document.activeElement.value === 'hello'`));
      await b.eval(`document.getElementById('cText').value = ''; document.querySelector('[data-crew="main"]').focus(); handle(${perm('c3')}); await new Promise(r => setTimeout(r, 200)); return 1`);
      t.check('chat: nor from a button you’ve moved to', await b.eval(`return document.activeElement.matches('[data-crew="main"]')`));
      await b.eval(`document.activeElement.blur(); handle(${perm('c4')}); await new Promise(r => setTimeout(r, 200)); return 1`);
      cc = await chatCard('c4');
      t.check('chat: with nothing else focused, the new request takes it (on Allow)', cc && cc.focus === 'allow', cc);

      // Answered elsewhere meanwhile: the card goes, and nothing else is answered.
      s.mode = 'stale'; s.calls.length = 0;
      await b.clickOn('.perm[data-req="main:c2"] [data-p="allow"]'); await sleep(400);
      t.check('chat: a request answered elsewhere says so and its card goes', s.calls.length === 1 && s.calls[0].requestId === 'c2' && !(await chatCard('c2')) && /Already answered/.test(await lastToast(b)), { calls: s.calls, toast: await lastToast(b) });
      // A failed call: the buttons work again, and it says why.
      s.mode = 'fail'; s.calls.length = 0;
      await b.clickOn('.perm[data-req="main:c3"] [data-p="always"]'); await sleep(400);
      cc = await chatCard('c3');
      t.check('chat: a failed call leaves the buttons working and says why', s.calls.length === 1 && s.calls[0].decision === 'always' && cc && !cc.off && /Couldn’t answer it: The PC said no\./.test(await lastToast(b)), { calls: s.calls, cc });
    },
  },
  {
    name: 'decision control on a phone',
    async run(t) {
      const s = pc();
      const b = await t.open({ width: 412, height: 880, mobile: true, respond: s.respond });
      await sleep(900);
      await waitOn(b, [bash('p1', { reason: 'It writes to the test database.' }), bash('p2')]);
      const size = () => b.eval(`const c = document.querySelector(${JSON.stringify(NUTRIENT)}); c.scrollIntoView({ block: 'center' });
        const h = sel => [...c.querySelectorAll(sel)].filter(x => !x.hidden && x.getClientRects().length).map(x => Math.round(x.getBoundingClientRect().height));
        return { buttons: h('.o-foot .btn'), more: h('.dec-more'), note: h('.dec-note .btn, .dec-note .dec-why'), wide: document.scrollingElement.scrollWidth <= innerWidth + 1, inside: c.getBoundingClientRect().right <= innerWidth + 1 }`);
      let z = await size();
      t.check('phone: the same card, every answer a finger’s size', z.buttons.length >= 4 && z.buttons.every(h => h >= 44) && z.more.every(h => h >= 44), z);
      t.check('phone: nothing scrolls sideways', z.wide && z.inside, z);
      await b.clickOn(`${NUTRIENT} [data-p="deny"]`); await sleep(250);
      z = await size();
      t.check('phone: Deny’s note and its buttons are a finger’s size too', z.note.length === 3 && z.note.every(h => h >= 44) && z.wide, z);
      await t.shot(b, 'phone-hub');
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      await b.eval(`handle({ kind: 'permission', requestId: 'pc1', toolName: 'Bash', view: { summary: 'Run the tests', detail: 'npm test', detailKind: 'command' }, canAlways: true, alwaysScope: 'commands that start with “npm test” in this project', defaultToNo: false }); return 1`); await sleep(400);
      const cz = await b.eval(`const c = document.querySelector('.perm[data-req="main:pc1"]'); const r = sel => Math.round(c.querySelector(sel).getBoundingClientRect().height); return { allow: r('[data-p="allow"]'), deny: r('[data-p="deny"]'), wide: document.scrollingElement.scrollWidth <= innerWidth + 1 }`);
      t.check('phone: in the chat, Allow and Deny are a finger’s size', cz.allow >= 44 && cz.deny >= 44 && cz.wide, cz);
      await t.shot(b, 'phone-chat');
    },
  },
];
