'use strict';
const { sleep } = require('./browser');
const demo = require('./demo');
const { responder } = require('./work.ui');
const id = demo.ID['s-bard'];
const second = demo.projects.flatMap(p => p.sessions).find(s => s.id !== id && (!s.provider || s.provider === 'claude')).id;
const history = Array.from({ length: 34 }, (_, n) => [
  { kind: 'user', itemId: `read-user-${n}`, at: new Date(1700000000000 + n * 120000).toISOString(), text: `Question ${n}: explain this part of the plan.`, images: [] },
  { kind: 'assistant', mid: `read-${n}`, at: new Date(1700000060000 + n * 120000).toISOString(), blocks: [{ type: 'text', text: `## Part ${n}\n\n${Array.from({ length: 4 }, (_, j) => `Paragraph ${j}. Here is enough detail about this step to read it in context. The next step builds on the earlier work and keeps the conversation easy to follow.`).join('\n\n')}` }] },
]).flat();

function fixture() {
  const drafts = new Map(), info = new Map(), calls = [], control = {}, work = responder();
  const respond = (p, q, body, method) => {
    if (p === '/api/chat/open') {
      const sid = body.sessionId || id;
      const r = { key: `return-${sid}`, provider: body.provider || 'claude', sessionId: sid, state: 'ready', title: 'Reading test', folder: 'Starfall Tavern', cwd: demo.projects[0].cwd, accountId: 'studio', permissionMode: 'acceptEdits', companionKey: null, companionThread: null };
      info.set(r.key, r); return { body: r };
    }
    if (p === '/api/chat/events') return { type: 'text/event-stream', body: `retry: 600000\n\nevent: hello\ndata: ${JSON.stringify(info.get(q.get('key')) || {})}\n\nevent: replayed\ndata: {}\n\n` };
    if (p === '/api/chat/history') {
      calls.push(Object.fromEntries(q));
      const reply = { body: q.get('cursor') ? { items: history.slice(0, 48), start: 0, cursor: null } : { items: history.slice(48), start: 48, cursor: 'older' } };
      return control.wait && q.get('id') === control.id ? control.wait.then(() => reply) : reply;
    }
    if (p === '/api/drafts') return { body: { drafts: [...drafts].map(([id, d]) => ({ id, at: d.at })) } };
    if (p === '/api/draft') {
      if (method === 'POST') { if (body.text.trim()) drafts.set(body.id, { text: body.text, at: body.at }); else drafts.delete(body.id); return { body: { ok: true } }; }
      return { body: drafts.get(q.get('id')) || { text: '', at: 0 } };
    }
    if (p === '/api/chat/send') return { body: { ok: true } };
    return work(p, q, body);
  };
  return { respond, drafts, calls, control };
}
async function waitFor(b, expr, ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await b.eval(`return !!(${expr})`)) return true; await sleep(100); }
  throw new Error(`Timed out waiting for ${expr}`);
}
async function open(b, sid = id) { await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(sid)} }); return 1`); await waitFor(b, '!ChatReading.holding()'); }
const place = n => `const s = scroller(), el = document.querySelector('[data-mid="read-${n}"] .md p'); s.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top + 12; ChatReading.capture(); return el.getBoundingClientRect().top - s.getBoundingClientRect().top`;
const position = n => `const el = document.querySelector('[data-mid="read-${n}"] .md p'); return el ? el.getBoundingClientRect().top - scroller().getBoundingClientRect().top : null`;

module.exports = [{
  name: 'chat reading position',
  async run(t) {
    const f = fixture(), b = await t.open({ respond: f.respond });
    t.check('reading-place script is loaded by the app', await b.eval('return !!window.ChatReading'));
    await open(b);
    t.check('a first visit opens at Latest', await b.eval('return nearBottom()'));
    await b.eval('await loadEarlier(); return 1');
    const at = await b.eval(place(8));
    await open(b, second);
    await b.eval(place(28));
    const before = f.calls.length;
    await open(b);
    let restored = await b.eval(position(8));
    t.check('returning loads earlier history and restores the same paragraph', restored !== null && Math.abs(restored - at) < 3, { at, restored });
    t.check('restoration fetched the missing page', f.calls.slice(before).some(q => q.cursor === 'older'));
    t.check('Latest is available while reading earlier messages', await b.eval('return !nearBottom() && !document.getElementById("cJump").hidden'));
    await t.shot(b, 'remembered-paragraph');
    await b.eval('ChatUI.close(); return 1');
    await b.send('Page.reload'); await sleep(3000);
    await open(b);
    restored = await b.eval(position(8));
    t.check('the reading place survives reloading the app', restored !== null && Math.abs(restored - at) < 3, restored);
    // A resized window changes paragraph wrapping; the same paragraph remains at the reading line.
    await b.eval('ChatUI.close(); return 1');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1050, height: 700, deviceScaleFactor: 1, mobile: false });
    await open(b);
    restored = await b.eval(position(8));
    t.check('changing window size keeps the paragraph, not an old pixel offset', restored !== null && Math.abs(restored - at) < 3, restored);
    await b.eval('jumpLatest(); return 1'); await waitFor(b, 'nearBottom()');
    await open(b, second); await open(b);
    t.check('Latest becomes the saved position after using it', await b.eval('return nearBottom()'));
    await open(b, second);
    const other = await b.eval(position(28));
    t.check('each conversation keeps its own reading place', other !== null && Math.abs(other + 12) < 3, other);
    // A delayed correction must release as soon as the person scrolls elsewhere.
    await b.eval('ChatUI.close(); return 1');
    await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(second)} }); return 1`);
    const manual = await b.eval(place(30)); await sleep(2100);
    t.check('manual scrolling cancels late restoration corrections', Math.abs((await b.eval(position(30))) - manual) < 3);
    // A read-only terminal view shares the same conversation's reading place.
    await b.eval(`await ChatUI.watch({ sessionId: ${JSON.stringify(second)}, source: 'terminal' }); return 1`);
    await waitFor(b, '!ChatReading.holding()');
    t.check('watching the same chat restores its reading place too', Math.abs((await b.eval(position(30))) - manual) < 3);
    const codex = demo.ID['c-harvest'];
    await open(b, codex); const cxAt = await b.eval(place(28));
    await open(b); await open(b, codex);
    t.check('Codex chats restore their own reading place', Math.abs((await b.eval(position(28))) - cxAt) < 3 && await b.eval('return C.provider === "codex"'));
    // Another window's newly saved conversation must survive this window saving its own.
    await b.eval(`const places = JSON.parse(store('chat-reading-v1')); places['claude:other-window'] = { bottom: true, at: Date.now() }; store('chat-reading-v1', JSON.stringify(places)); ChatReading.capture(); return 1`);
    t.check('saving preserves reading places from another app window', await b.eval(`return !!JSON.parse(store('chat-reading-v1'))['claude:other-window']`));
    f.control.id = id; let release;
    f.control.wait = new Promise(r => { release = r; });
    await b.eval(`window.pendingRead = ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`);
    await waitFor(b, `C.sessionId === ${JSON.stringify(id)}`);
    await open(b, second);
    const currentAt = await b.eval(position(30));
    release(); f.control.wait = null; await b.eval('await pendingRead; return 1');
    t.check('a late history response cannot move the chat opened after it', await b.eval(`return C.sessionId === ${JSON.stringify(second)}`) && Math.abs((await b.eval(position(30))) - currentAt) < 3);
  },
}, {
  name: 'visible chat drafts',
  async run(t) {
    const f = fixture(), b = await t.open({ respond: f.respond });
    t.check('draft index script is loaded by the app', await b.eval('return !!window.ChatDrafts'));
    await open(b);
    await b.eval(`document.getElementById('cText').value = 'Remember to mention the migration'; document.getElementById('cText').dispatchEvent(new Event('input', { bubbles: true })); return 1`);
    await waitFor(b, `ChatDrafts.has(${JSON.stringify(id)})`);
    await b.eval('renderRail(); return 1');
    let badges = await b.eval(`return [...document.querySelectorAll('[data-draft-id="${id}"]')].filter(x => !x.hidden).length`);
    t.check('writing a draft makes its label visible', badges > 0, badges);
    await b.eval('ChatUI.close(); go("recent"); return 1'); await sleep(700);
    t.check('the Recent chats list shows the draft label', await b.eval(`return !!document.querySelector('.row [data-draft-id="${id}"]:not([hidden])')`));
    await t.shot(b, 'draft-in-recent-chats');
    await b.eval(`openPalette('Chats with drafts'); return 1`); await b.key('Enter', 'Enter', 13);
    await waitFor(b, 'Pal.stack.length && !Pal.stack[0].loading');
    t.check('Ctrl+K lists the chat with the unsent message', await b.eval(`return Pal.items.some(x => x.id === 'draft:${id}')`));
    await t.shot(b, 'drafts-command');
    await b.key('Enter', 'Enter', 13);
    await waitFor(b, `C.sessionId === ${JSON.stringify(id)} && document.getElementById('cText').value.includes('migration')`);
    t.check('choosing the draft reopens its unsent words', true);
    await b.eval('await sendMessage(); return 1');
    await waitFor(b, `!ChatDrafts.has(${JSON.stringify(id)})`);
    t.check('sending removes every draft label for that chat', await b.eval(`return !document.querySelector('[data-draft-id="${id}"]:not([hidden])')`));
    f.drafts.set(second, { text: 'Written on the phone', at: Date.now() + 1000 });
    await b.eval('await ChatDrafts.refresh(true); return 1');
    t.check('drafts saved on another device appear in the command', await b.eval(`return ChatDrafts.items().some(x => x.id === 'draft:${second}')`));
    await open(b, second);
    await waitFor(b, `document.getElementById('cText').value === 'Written on the phone'`);
    t.check('opening a remote draft restores its text', true);
    f.drafts.delete(second); await b.eval('await ChatDrafts.refresh(true); return 1');
    t.check('a send from the other device removes the saved draft from the list', await b.eval(`return !ChatDrafts.has(${JSON.stringify(second)}) && !localStorage.getItem('draft:${second}')`));
    await b.eval(`document.getElementById('cText').value = '   '; writeDraft(); return 1`);
    t.check('whitespace alone is not a draft', await b.eval(`return !ChatDrafts.has(${JSON.stringify(second)})`));
    await b.eval(`openPalette('Chats with drafts'); pickPal(0); return 1`); await waitFor(b, 'Pal.stack.length && !Pal.stack[0].loading');
    t.check('the command explains when there are no drafts', await b.eval(`return document.getElementById('palList').textContent.includes('No unsent messages')`));
  },
}, {
  name: 'remember work filter',
  async run(t) {
    const b = await t.open({ respond: responder() });
    await b.eval(`go('work'); return 1`); await waitFor(b, `document.querySelector('[data-wk="filter"][data-value="attention"]')`);
    await b.clickOn('.wk-filters [data-value="attention"]');
    await b.send('Page.reload'); await sleep(3000); await b.eval(`go('work'); return 1`);
    await waitFor(b, `document.querySelector('.wk-filters [data-value="attention"][aria-pressed="true"]')`);
    t.check('Needs you stays selected after a reload', true);
    await b.clickOn('.wk-filters [data-value="chats"]');
    await b.eval(`go('hub'); go('work'); return 1`); await sleep(300);
    t.check('With a chat stays selected after leaving and returning', await b.eval(`return !!document.querySelector('.wk-filters [data-value="chats"][aria-pressed="true"]')`));
    await b.eval(`store('work-filter', 'removed-filter'); return 1`); await b.send('Page.reload'); await sleep(3000); await b.eval(`go('work'); return 1`);
    await waitFor(b, `document.querySelector('.wk-filters [data-value="all"][aria-pressed="true"]')`);
    t.check('an obsolete saved filter safely opens All work', true);
  },
}];
