#!/usr/bin/env node
'use strict';
// Presses every button the app shows, on the REAL server in a pretend computer (tests/fake-world.js), and everything
// each press brings up, one level down. Reports script errors, server errors, toasts that read like code, what the
// server refused, and buttons that did nothing. It's how "Mark done" and "Run the project" turned out never to have
// reached the server: tests/demo.js answers those itself. No real account or chat can be seen from there.
//
//   node tests/press-everything.js                 everything (half an hour or so)
//   node tests/press-everything.js chat "new chat" just those places
//   DEPTH=0 node tests/press-everything.js hub     only what's on the page, not what each press opens
//   ALL=1 node tests/press-everything.js setup     and the buttons that take things away
//   PHONE=1 node tests/press-everything.js         at a phone's size
//   MINUTES=10 node tests/press-everything.js chat stops pressing after that long, and says what it found
//
// Not part of tests/run.js: it's long, and reading what it found takes a person.
const path = require('path');
const { launch, sleep } = require('./browser');
const { build } = require('./fake-world');

const BAD = /Cannot read|is not a function|is not defined|\bundefined\b|\bnull\b|Unexpected token|NaN|\[object |ReferenceError|TypeError/;
// Not these: they'd end the run, change the world under the rest of it, or start something long. (ALL=1 presses the
// ones that take things away too: it's a pretend computer, so nothing real goes.)
const SKIP = process.env.ALL ? /\bquit\b|restart|\bupdate\b|install|^close$|^cancel$|^✕$|^×$/i
  : /\bquit\b|restart|\bupdate\b|install|uninstall|sign out|\bremove\b|\bdelete\b|stop everything|reset|forget|^close$|^cancel$|^✕$|^×$/i;
const DEPTH = process.env.DEPTH === undefined ? 1 : Number(process.env.DEPTH);
const STOP_AT = process.env.MINUTES ? Date.now() + Number(process.env.MINUTES) * 60e3 : Infinity;
const only = process.argv.slice(2);

(async () => {
  const w = await build();
  const b = await launch(process.env.PHONE ? { width: 412, height: 860, mobile: true } : { width: 1500, height: 950 });
  // Going somewhere can wait on a question in a dialog (a chat open in a terminal, say): that mustn't stop the whole run.
  const going = code => Promise.race([b.eval(code), sleep(20000).then(() => { throw new Error(`no answer in 20 s: ${code.slice(0, 60)}`); })]);
  const out = { problems: [], refused: [], toasts: new Map(), dead: [] };
  const say = (...a) => console.log(...a);
  const note = (where, what) => { out.problems.push(`${where}: ${what}`); say('PROBLEM', where, String(what).slice(0, 400)); };
  let logged = 0;

  const probe = () => b.eval(`
    if (!window._p) {
      window._p = { toasts: [], http: [], calls: 0, opened: 0 };
      const rt = window.toast; window.toast = Object.assign(function (m, ...a) { _p.toasts.push(String(m)); return rt.call(this, m, ...a); }, rt);
      // The file viewer can walk out of the pretend computer: nothing that changes anything goes to a path outside it.
      const bs = String.fromCharCode(92), plainPath = x => x.split(bs + bs).join(bs).split('/').join(bs).toLowerCase();
      const inside = plainPath(${JSON.stringify(w.W)});
      const outside = body => (String(body || '').match(/[A-Za-z]:[^"]*/g) || []).filter(x => x[2] === bs || x[2] === '/').some(x => !plainPath(x).startsWith(inside));
      const rf = window.fetch; window.fetch = async (...a) => { if (a[1] && a[1].method === 'POST' && outside(a[1].body)) { _p.http.push('blocked (outside the pretend computer) ' + String(a[0]).slice(0, 80)); return new Response(JSON.stringify({ error: 'Outside the pretend computer.' }), { status: 403, headers: { 'content-type': 'application/json' } }); } _p.calls++; const r = await rf(...a); if (!r.ok) { let t = ''; try { t = await r.clone().text(); } catch {} _p.http.push(r.status + ' ' + String(a[0]).slice(0, 140) + ' ' + t.slice(0, 240)); } return r; };
      window.open = () => { _p.opened++; return null; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText = async () => { _p.calls++; };
    }
    return 1`).catch(() => {});
  const tidy = () => b.eval(`
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    try { closeMenu(); } catch {}
    try { closeAcctPop(); } catch {}
    try { if (document.querySelector('.lightbox:not([hidden])')) closeLightbox(); } catch {}
    try { closePalette(); } catch {}
    try { const d = document.getElementById('drawer'); if (d && !d.hidden) { d.hidden = true; S.drawerId = null; } } catch {}
    return 1`).catch(() => {});
  const toHub = async () => { await tidy(); await going(`try { if (window.ChatUI && ChatUI.isOpen()) ChatUI.close(); } catch {} await go('hub'); window.scrollTo(0, 0); return 1`).catch(() => {}); await sleep(250); };

  // What can be pressed right now, by label and which of that label it is.
  const LIST = `
    const vis = el => { if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false; if (!el.getClientRects().length) return false; const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
    const nameOf = el => (el.getAttribute('aria-label') || el.textContent || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
    const all = () => { const seen = new Map(), list = []; for (const el of document.querySelectorAll('button, [role=button], [role=menuitem], [role=tab], summary, a[href="#"]')) { if (!vis(el)) continue; const n = nameOf(el); if (!n) continue; const i = seen.get(n) || 0; seen.set(n, i + 1); list.push({ n, i, el }); } return list; };`;
  const list = () => b.eval(`${LIST} return all().map(x => x.n + '#' + x.i)`).catch(() => []);
  const press = id => b.eval(`${LIST} const k = ${JSON.stringify(id)}; const it = all().find(x => x.n + '#' + x.i === k); if (!it) return false; it.el.scrollIntoView({ block: 'center' }); it.el.click(); return true`);
  const sig = () => b.eval(`const a = document.activeElement; return [document.body.innerHTML.length, document.querySelectorAll('dialog[open]').length, location.href, scrollY, _p.calls, _p.toasts.length, _p.opened, a ? a.tagName + (a.id || '') : ''].join('|')`).catch(() => '');
  const check = async where => {
    const fresh = b.logs.filter(l => /^EXC /.test(l)).slice(logged);
    logged += fresh.length;
    for (const f of fresh) note(where, f.split('\n').slice(0, 4).join(' | '));
    const p = await b.eval(`return { toasts: _p.toasts.splice(0), http: _p.http.splice(0) }`).catch(() => ({ toasts: [], http: [] }));
    for (const t of p.toasts) { if (!out.toasts.has(t)) out.toasts.set(t, where); if (BAD.test(t)) note(where, `toast: ${t}`); }
    for (const h of p.http) { out.refused.push(`${where}: ${h}`); if (/^5/.test(h) || /"Not found\."/.test(h)) note(where, `server: ${h}`); }
  };

  const pressed = {};
  let presses = 0;
  // One row's menu is enough for all of them: the same kind of thing, three times at most.
  const family = id => id.replace(/#\d+$/, '').replace(/More for .*/, 'More for X');
  async function explore(place, trail, depth) {
    const here = async () => { await place.go(); await probe(); for (const step of trail) { await press(step); await sleep(180); } };
    await here();
    const now = await list();
    const items = trail.length ? now.filter(x => !trail.parent.has(x)) : now;
    say(`${'  '.repeat(trail.length)}— ${place.name}${trail.length ? ` / ${trail.join(' / ')}` : ''}: ${items.length} to press`);
    for (const id of items) {
      if (Date.now() > STOP_AT) return;
      if (SKIP.test(id.replace(/#\d+$/, ''))) continue;
      const fam = `${place.name}|${trail.map(family).join('>')}|${family(id)}`;
      pressed[fam] = (pressed[fam] || 0) + 1;
      if (pressed[fam] > 3) continue;
      await here();
      const start = await sig();
      const where = `${place.name} / ${[...trail, id].join(' / ')}`;
      let ok = false;
      try { ok = await press(id); } catch (err) { note(where, err.message); }
      if (!ok) continue;
      presses++;
      await sleep(300);
      await check(where);
      if (start && (await sig()) === start) { await sleep(500); await check(where); if ((await sig()) === start) out.dead.push(where); }
      if (depth < DEPTH) {
        const fresh = (await list()).filter(x => !now.includes(x));
        if (fresh.length && fresh.length < 60) { const next = [...trail, id]; next.parent = new Set(now); await explore(place, next, depth + 1); }
      }
    }
  }

  const page = (name, view) => ({ name, go: async () => { await toHub(); await going(`await go(${JSON.stringify(view)}); return 1`).catch(() => {}); await sleep(300); } });
  const tab = (name, cwd, n) => ({ name, go: async () => { await toHub(); await going(`await go('folder', ${JSON.stringify(cwd)}); S.worldTab = ${JSON.stringify(n)}; renderFolder(); return 1`).catch(() => {}); await sleep(450); } });
  const inPage = (name, code, wait = 500) => ({ name, go: async () => { await toHub(); await going(`${code}; return 1`).catch(() => {}); await sleep(wait); } });
  const places = [
    { name: 'hub', go: toHub },
    ...['chats', 'docs', 'memory', 'changes', 'gallery'].map(n => tab(`project ${n}`, w.tavern, n)),
    tab('git project', w.courier, 'chats'), tab('git changes', w.courier, 'changes'),
    page('recent', 'recent'), page('routines', 'routines'),
    inPage('chat', `await ChatUI.open({ sessionId: ${JSON.stringify(w.ids.quest)} })`, 1200),
    inPage('chat with words', `await ChatUI.open({ sessionId: ${JSON.stringify(w.ids.route)} }); const t = document.getElementById('cText'); t.value = 'hello there'; t.dispatchEvent(new Event('input', { bubbles: true }))`, 1200),
    // A Codex chat, and a crew of all three in one chat: the same ones each time, made once.
    inPage('codex chat', `window._cx = window._cx || await (async () => { const c = await api('/api/chat/open', { provider: 'codex', cwd: ${JSON.stringify(w.courier)}, mode: 'new' }); for (let i = 0; i < 40 && (await api('/api/chat/attach', { key: c.key })).state === 'starting'; i++) await new Promise(r => setTimeout(r, 250)); await api('/api/chat/send', { key: c.key, text: 'Please write a note' }); await new Promise(r => setTimeout(r, 800)); return (await api('/api/chat/attach', { key: c.key })).sessionId; })(); await ChatUI.open({ sessionId: window._cx })`, 1500),
    inPage('gemini chat', `window._gm = window._gm || await (async () => { const c = await api('/api/chat/open', { provider: 'gemini', cwd: ${JSON.stringify(w.courier)}, mode: 'new' }); await api('/api/chat/send', { key: c.key, text: 'Please write a note' }); await new Promise(r => setTimeout(r, 1000)); return (await api('/api/chat/attach', { key: c.key })).sessionId; })(); await ChatUI.open({ sessionId: window._gm })`, 1500),
    inPage('gemini rows', `window._gm = window._gm || await (async () => { const c = await api('/api/chat/open', { provider: 'gemini', cwd: ${JSON.stringify(w.courier)}, mode: 'new' }); await api('/api/chat/send', { key: c.key, text: 'Please write a note' }); await new Promise(r => setTimeout(r, 1000)); const id = (await api('/api/chat/attach', { key: c.key })).sessionId; await api('/api/chat/stop', { key: c.key }); await new Promise(r => setTimeout(r, 6000)); await loadSessions(); return id; })(); await go('folder', ${JSON.stringify(w.courier)}); S.worldTab = 'chats'; renderFolder()`, 800),
    inPage('crew chat', `window._crew = window._crew || await (async () => { const c = await api('/api/chat/open', { account: S.accounts[0].id, cwd: ${JSON.stringify(w.courier)}, mode: 'new' }); for (let i = 0; i < 40 && (await api('/api/chat/attach', { key: c.key })).state === 'starting'; i++) await new Promise(r => setTimeout(r, 250)); await api('/api/chat/send', { key: c.key, text: 'Hello there' }); await new Promise(r => setTimeout(r, 800)); await api('/api/chat/send', { key: c.key, to: 'partner', kind: 'codex', text: 'Please write it' }); await new Promise(r => setTimeout(r, 800)); await api('/api/chat/send', { key: c.key, to: 'partner', kind: 'gemini', text: 'And you' }); await new Promise(r => setTimeout(r, 1200)); return (await api('/api/chat/attach', { key: c.key })).sessionId; })(); await ChatUI.open({ sessionId: window._crew })`, 1800),
    inPage('new chat', `await openNewChat({ cwd: ${JSON.stringify(w.tavern)} })`),
    inPage('setup', `await openSetup('health')`, 900),
    inPage('setup look', `await openSetup('look')`),
    inPage('a document', `await Viewer.open({ path: ${JSON.stringify(path.join(w.tavern, 'lore', 'queen.md'))}, cwd: ${JSON.stringify(w.tavern)} })`),
    inPage('a web page', `await Viewer.open({ path: ${JSON.stringify(path.join(w.tavern, 'site', 'index.html'))}, cwd: ${JSON.stringify(w.tavern)} })`),
  ];
  // What the browser itself complains of: a picture that didn't load, something the security rules blocked.
  const said = new Map();
  await b.send('Log.enable');
  b.on(m => { if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'info') { const e = m.params.entry, k = `${e.source}: ${e.text} ${String(e.url || '').replace(/token=[a-f0-9]+&?/, '')}`.slice(0, 300); said.set(k, (said.get(k) || 0) + 1); } });
  try {
    await b.nav(w.base, 2500);
    await sleep(2000);
    await probe();
    say('The pretend computer:', JSON.stringify(await b.eval(`return { projects: S.projects.map(p => [p.name, p.sessions.length]), accounts: S.accounts.map(a => [a.name, a.signedIn]) }`)));
    for (const place of places) {
      if (only.length && !only.includes(place.name)) continue;
      const t0 = Date.now();
      const trail = []; trail.parent = new Set();
      await explore(place, trail, 0).catch(err => note(place.name, `the run itself: ${err.message}`));
      say(`   (${place.name}: ${Math.round((Date.now() - t0) / 1000)} s, ${presses} presses so far)`);
    }
    const server = await b.eval(`const r = await api('/api/problems'); return r.problems.map(p => p.where + ' ' + p.count + 'x: ' + p.message + ' | ' + String(p.stack || '').split('\\n').slice(1, 3).join(' '))`).catch(err => [`(couldn't read problems: ${err.message})`]);
    say(`\n${presses} presses. ${out.problems.length} problems, ${out.refused.length} refused calls, ${out.dead.length} buttons that seemed to do nothing, ${out.toasts.size} different toasts.`);
    say('\nPROBLEMS'); for (const p of new Set(out.problems)) say(' -', p.slice(0, 500));
    say('\nWHAT THE APP’S OWN LOG OF PROBLEMS SAYS'); for (const p of server) say(' -', p.slice(0, 500));
    say('\nREFUSED'); for (const p of new Set(out.refused)) say(' -', p.slice(0, 400));
    say('\nWHAT THE BROWSER SAID'); for (const [k, n] of said) say(` - ${n}x`, k);
    say('\nDID NOTHING (often fine: it was already on that page)'); for (const p of out.dead) say(' -', p.slice(0, 200));
    say('\nTOASTS'); for (const [t, where] of out.toasts) say(' -', t.slice(0, 240), '   <-', where.slice(0, 100));
    process.exitCode = out.problems.length ? 1 : 0;
  } finally {
    b.close();
    await w.done();
    process.exit(process.exitCode || 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
