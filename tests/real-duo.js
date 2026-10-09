// Claude and Codex in one chat, for real: run by hand, not by run.js (it uses your Claude and Codex
// sign-ins and a little of their usage: a handful of one-line replies, Claude on Haiku).
//
//   node tests/real-duo.js                     every step
//   node tests/real-duo.js claude-lead,ui      only those
//
// It starts its own copy of the app (its own port and data folder; your own app is never touched),
// makes scratch projects in the temp folder, and drives real chats through the app's API: Codex joins a
// Claude chat and reads it, Claude reads Codex back, Both takes turns, the lists keep the partner inside
// its chat, a restart picks up where it was, a Codex chat brings Claude in, a partner whose conversation
// is gone starts over, and the window shows it all in one feed. Afterwards it leaves nothing behind: the
// scratch folders, Claude's transcripts of them, and the Codex conversations (archived through Codex
// itself, so its own list stays right).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const repo = path.join(__dirname, '..');
const only = (process.argv[2] || '').split(',').filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const out = { dataDir: null, folders: [], claude: [], codex: [] };
const save = () => {};
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n     ${String(detail || '').slice(0, 900)}`}`); };

async function startServer(dataDir) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server.js'], { cwd: repo, env: { ...process.env, SWITCHER_PORT: String(port), SWITCHER_DATA_DIR: dataDir, SWITCHER_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logText = ''; proc.stdout.on('data', d => { logText += d; }); proc.stderr.on('data', d => { logText += d; });
  const base = `http://127.0.0.1:${port}`;
  let html = null;
  for (let i = 0; i < 150 && !html; i++) { try { html = await (await fetch(base + '/')).text(); } catch { await sleep(200); } }
  if (!html) throw new Error(`server didn't start:\n${logText}`);
  const token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
  const call = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-switcher-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${p}: ${r.status} ${j && j.error}`);
    return j;
  };
  // A chat's events, as they come (and everything it has so far).
  const streams = new Map();
  function watch(key) {
    if (streams.has(key)) return streams.get(key);
    const st = { events: [], waiters: [] };
    streams.set(key, st);
    (async () => {
      const r = await fetch(`${base}/api/chat/events?key=${encodeURIComponent(key)}&token=${token}&after=0`);
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(block), data = /data: (.*)/.exec(block);
          if (ev && ev[1] === 'chat' && data) { try { st.events.push(JSON.parse(data[1])); } catch { /* partial */ } for (const w of st.waiters.splice(0)) w(); }
        }
      }
    })().catch(() => {});
    return st;
  }
  async function waitFor(key, pred, ms = 180000, label = '') {
    const st = watch(key), until = Date.now() + ms;
    for (;;) {
      const hit = st.events.find(pred);
      if (hit) return hit;
      if (Date.now() > until) throw new Error(`timed out waiting for ${label}; last events: ${JSON.stringify(st.events.slice(-4)).slice(0, 600)}`);
      // Approvals: allow anything these tiny tasks ask for.
      for (const e of st.events) if (e.kind === 'permission' && !e._done) { e._done = true; await call('/api/chat/permission', { key, requestId: e.requestId, decision: 'allow' }).catch(() => {}); }
      await new Promise(r => { st.waiters.push(r); setTimeout(r, 1000); });
    }
  }
  const texts = key => watch(key).events.filter(e => e.kind === 'assistant').flatMap(e => e.blocks.filter(b => b.type === 'text').map(b => b.text)).join('\n');
  const results = key => watch(key).events.filter(e => e.kind === 'result').length;
  const waitTurn = async (key, n, label) => { await waitFor(key, () => results(key) >= n, 240000, label); };
  const stop = async () => { await call('/api/quit', {}).catch(() => {}); await new Promise(r => { proc.on('exit', r); setTimeout(() => { try { proc.kill(); } catch { /* gone */ } r(); }, 8000); }); };
  return { base, call, watch, waitFor, texts, results, waitTurn, stop, log: () => logText };
}

(async () => {
  if (!out.dataDir) { out.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-duo-data-')); save(); }
  let s = await startServer(out.dataDir);
  let st = await s.call('/api/state');
  for (let i = 0; i < 40 && !(st.codex && st.codex.signedIn); i++) { await sleep(1000); st = await s.call('/api/state'); }
  const acct = st.accounts.find(a => a.signedIn) || st.accounts[0];
  console.log(`codex: enabled=${st.codex && st.codex.enabled} installed=${st.codex && st.codex.installed} error=${st.codex && st.codex.error}`);
  console.log(`accounts: ${st.accounts.map(a => `${a.name}${a.signedIn ? '' : ' (signed out)'}`).join(', ')}; codex: ${st.codex && st.codex.signedIn ? 'signed in' : 'NOT signed in'}`);
  const run = name => !only.length || only.includes(name);

  // 1. A Claude chat, then Codex joins it and reads it; then Claude reads Codex.
  if (run('claude-lead')) {
    const made = await s.call('/api/project/create', { parent: os.tmpdir(), name: `ss-duo-${Date.now().toString(36)}` });
    out.folders.push(made.cwd); save();
    const lead = await s.call('/api/chat/open', { account: acct.id, cwd: made.cwd, mode: 'new', model: 'haiku' });
    console.log(`Claude chat ${lead.key} in ${made.cwd}`);
    await s.call('/api/chat/send', { key: lead.key, text: 'Reply with exactly this and nothing else: ALPHA-7' });
    await s.waitTurn(lead.key, 1, 'Claude’s first reply');
    check('Claude answers', /ALPHA-7/.test(s.texts(lead.key)), s.texts(lead.key));
    const r = await s.call('/api/chat/send', { key: lead.key, to: 'partner', text: 'What exact code did Claude just reply with? Answer with that code followed by " BRAVO-3", nothing else.' });
    check('a message to the partner starts Codex in this chat', !!r.key && r.key !== lead.key, JSON.stringify(r));
    const info = await s.call('/api/chat/attach', { key: r.key });
    check('it’s Codex, paired with the chat', info.provider === 'codex' && info.parentKey === lead.key, JSON.stringify({ provider: info.provider, parentKey: info.parentKey }));
    await s.waitTurn(r.key, 1, 'Codex’s first reply');
    const cx = s.texts(r.key);
    check('Codex read what Claude said (no window open)', /ALPHA-7/.test(cx) && /BRAVO-3/.test(cx), cx);
    const sent = s.watch(r.key).events.find(e => e.kind === 'user');
    check('its message carried the catch-up', sent && /^<shared-context/.test(sent.text) && /Claude:\nALPHA-7/.test(sent.text), sent && sent.text.slice(0, 400));
    await s.call('/api/chat/send', { key: lead.key, text: 'What exact text did Codex just reply with? Repeat it exactly, nothing else.' });
    await s.waitTurn(lead.key, 2, 'Claude’s second reply');
    const cl = s.texts(lead.key).split('\n').pop();
    check('Claude read what Codex said', /BRAVO-3/.test(cl), cl);
    // Both: Claude first, then Codex builds on it.
    await s.call('/api/chat/send', { key: lead.key, to: 'both', text: 'Name one fruit, in one word. (If you are answering second: name a different fruit than the first answer, also one word.)' });
    await s.waitTurn(lead.key, 3, 'Claude’s Both reply');
    const claudeFruit = s.texts(lead.key).split('\n').pop().trim();
    await s.waitFor(r.key, e => e.kind === 'user' && e.relay, 120000, 'the hand-over');
    await s.waitTurn(r.key, 2, 'Codex’s Both reply');
    const relay = s.watch(r.key).events.filter(e => e.kind === 'user' && e.relay).pop();
    const codexFruit = s.texts(r.key).split('\n').pop().trim();
    check('Both: Codex picked it up after Claude, with Claude’s answer', relay && relay.text.includes(claudeFruit) && /answered it first/.test(relay.text), relay && relay.text.slice(0, 500));
    check('and built on it (a different fruit)', codexFruit && claudeFruit && codexFruit.toLowerCase().replace(/\W/g, '') !== claudeFruit.toLowerCase().replace(/\W/g, ''), `${claudeFruit} / ${codexFruit}`);
    const ho = s.watch(lead.key).events.filter(e => e.kind === 'handoff').map(e => e.state).join();
    check('the chat showed the hand-over', ho === 'waiting,sent', ho);
    // The partner's conversation lives inside the chat, not as a chat of its own.
    await sleep(25000);   // Codex's own list refreshes about every 20 seconds
    const sess = await s.call('/api/sessions');
    const proj = sess.projects.find(p => p.cwd.toLowerCase() === made.cwd.toLowerCase());
    const leadId = (await s.call('/api/chat/attach', { key: lead.key })).sessionId, cxId = info.sessionId || (await s.call('/api/chat/attach', { key: r.key })).sessionId;
    out.claude.push(leadId); out.codex.push(cxId); save();
    const row = proj && proj.sessions.find(x => x.id === leadId);
    check('lists: the chat says who’s in it, and the partner isn’t a chat of its own', row && row.partner && row.partner.provider === 'codex' && !proj.sessions.some(x => x.id === cxId), JSON.stringify(proj && proj.sessions.map(x => ({ id: x.id.slice(0, 8), provider: x.provider, partner: x.partner }))));
    // Opening the partner's conversation opens the chat it belongs to.
    const viaPartner = await s.call('/api/chat/open', { account: acct.id, sessionId: cxId, mode: 'resume' });
    check('opening the partner’s conversation opens its chat', viaPartner.key === lead.key, `${viaPartner.key} vs ${lead.key}`);
    out.lead = { cwd: made.cwd, leadId, cxId }; save();
  }

  // 2. Across a restart: the chat and its partner pick up where they were.
  if (run('restart') && out.lead) {
    await s.stop();
    s = await startServer(out.dataDir);
    const lead = await s.call('/api/chat/open', { account: acct.id, sessionId: out.lead.leadId, mode: 'resume', model: 'haiku' });
    const r = await s.call('/api/chat/send', { key: lead.key, to: 'partner', text: 'Earlier in this chat you replied with a code ending in BRAVO-3. What was the full reply? Repeat it exactly.' });
    const info = await s.call('/api/chat/attach', { key: r.key });
    check('after a restart, Codex resumes its own conversation', info.sessionId === out.lead.cxId || !info.sessionId, `${info.sessionId} vs ${out.lead.cxId}`);
    await s.waitTurn(r.key, 1, 'Codex after the restart');
    const t = s.texts(r.key);
    check('and remembers it', /ALPHA-7/.test(t) && /BRAVO-3/.test(t), t);
    const info2 = await s.call('/api/chat/attach', { key: r.key });
    check('(the same Codex conversation)', info2.sessionId === out.lead.cxId, `${info2.sessionId} vs ${out.lead.cxId}`);
    // Two opens at once: one chat.
    const [a, b] = await Promise.all([s.call('/api/chat/open', { account: acct.id, sessionId: out.lead.leadId, mode: 'resume' }), s.call('/api/chat/open', { account: acct.id, sessionId: out.lead.leadId, mode: 'resume' })]);
    check('two opens at once give one chat', a.key === b.key && a.key === lead.key, `${a.key} ${b.key} ${lead.key}`);
  }

  // 3. A Codex chat brings in Claude.
  if (run('codex-lead')) {
    const made = await s.call('/api/project/create', { parent: os.tmpdir(), name: `ss-duo-cx-${Date.now().toString(36)}` });
    out.folders.push(made.cwd); save();
    const lead = await s.call('/api/chat/open', { account: acct.id, cwd: made.cwd, mode: 'new', provider: 'codex' });
    await s.call('/api/chat/send', { key: lead.key, text: 'Reply with exactly this and nothing else: CHARLIE-5' });
    await s.waitTurn(lead.key, 1, 'Codex’s first reply');
    check('Codex answers', /CHARLIE-5/.test(s.texts(lead.key)), s.texts(lead.key));
    const r = await s.call('/api/chat/send', { key: lead.key, to: 'partner', text: 'What exact code did Codex just reply with? Answer with that code followed by " DELTA-9", nothing else.', account: acct.id });
    const info = await s.call('/api/chat/attach', { key: r.key });
    check('Claude joins the Codex chat', info.provider === 'claude' && info.parentKey === lead.key, JSON.stringify({ provider: info.provider, parentKey: info.parentKey }));
    await s.waitTurn(r.key, 1, 'Claude’s reply as partner');
    const t = s.texts(r.key);
    check('Claude read what Codex said', /CHARLIE-5/.test(t) && /DELTA-9/.test(t), t);
    const li = await s.call('/api/chat/attach', { key: lead.key });
    out.codex.push(li.sessionId); out.claude.push(info.sessionId || (await s.call('/api/chat/attach', { key: r.key })).sessionId); save();
    // Closing the chat stops its partner too.
    await s.call('/api/chat/stop', { key: lead.key });
    await sleep(3000);
    const after = await s.call('/api/chat/attach', { key: r.key }).catch(e => ({ state: `gone (${e.message})` }));
    check('stopping the chat stops its partner', after.state === 'ended' || /gone/.test(after.state), after.state);
  }

  // 4. The window, on the real chat: both sides in one feed, in order, with the hand-over.
  if (run('ui') && out.lead) {
    const { launch } = require(path.join(repo, 'tests', 'browser.js'));
    const b = await launch({ width: 1440, height: 900 });
    await b.nav(s.base + '/', 3000);
    await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(out.lead.leadId)} }); return 1`); await sleep(5000);
    const v = await b.eval(`const f = document.getElementById('cFeed'); return {
      codexTurns: f.querySelectorAll('.turn[data-prov="codex"]').length, claudeTurns: f.querySelectorAll('.turn[data-prov="claude"]').length,
      toCodex: f.querySelectorAll('.umsg.to-partner.to-codex').length, handover: f.querySelectorAll('.handover').length,
      folds: [...f.querySelectorAll('details.shared summary')].map(x => x.textContent), crew: [...document.querySelectorAll('.crew .crew-n')].map(x => x.textContent),
      order: [...f.children].filter(x => x.matches('.umsg, .turn, .handover')).map(x => x.matches('.turn') ? x.dataset.prov : x.matches('.handover') ? 'handover' : (x.classList.contains('to-partner') ? 'you→codex' : 'you')) }`);
    check('the window shows both sides in one feed', v.codexTurns >= 2 && v.claudeTurns >= 2 && v.toCodex >= 1, JSON.stringify(v));
    check('with the Both hand-over in place', v.handover >= 1, JSON.stringify(v.order));
    check('and the crew: Claude and Codex', v.crew.join() === 'Claude,Codex,Both', v.crew.join());
    await b.shot(path.join(os.tmpdir(), 'real-duo-window.png'));
    b.close();
  }

  // 5. A partner whose earlier conversation is gone: it starts fresh, caught up, and gets the message.
  if (run('fallback') && out.lead) {
    await s.stop();
    const f = path.join(out.dataDir, 'chat-prefs.json'), prefs = JSON.parse(fs.readFileSync(f, 'utf8'));
    const lid = out.lead.leadId.toLowerCase();
    prefs.chats[lid] = { ...(prefs.chats[lid] || {}), companion: '019a0000-dead-7000-8000-00000000beef' };
    fs.writeFileSync(f, JSON.stringify(prefs));
    s = await startServer(out.dataDir);
    const lead = await s.call('/api/chat/open', { account: acct.id, sessionId: out.lead.leadId, mode: 'resume', model: 'haiku' });
    const r = await s.call('/api/chat/send', { key: lead.key, to: 'partner', text: 'Reply with exactly this and nothing else: ECHO-4' });
    const note = await s.waitFor(lead.key, e => e.kind === 'notice' && /couldn’t pick up its earlier conversation/.test(e.text), 120000, 'the start-over notice').catch(e => null);
    check('a partner whose conversation is gone says so and starts a new one', !!note, note && note.text);
    const info = await s.call('/api/chat/companion', { key: lead.key });
    check('your message went straight to the new one', info.key === r.key, JSON.stringify({ sentTo: r.key, partner: info.key }));
    await s.waitTurn(info.key, 1, 'the new partner’s reply');
    const now = await s.call('/api/chat/attach', { key: info.key });
    check('(a different, new conversation)', now.sessionId && now.sessionId !== '019a0000-dead-7000-8000-00000000beef', now.sessionId);
    check('and your message still gets there', /ECHO-4/.test(s.texts(info.key)), s.texts(info.key));
    const sent = s.watch(info.key).events.find(e => e.kind === 'user');
    check('caught up on the chat so far', sent && /ALPHA-7|BRAVO-3/.test(sent.text), sent && sent.text.slice(0, 300));
    const li = await s.call('/api/chat/attach', { key: info.key }); out.codex.push(li.sessionId); save();
  }

  await s.stop();
})().catch(err => { failed++; console.error(err.stack || err); })
  .then(cleanup)
  .then(() => { console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0); });

// Leaves nothing behind: Claude's transcripts of the scratch folders, the test's Codex conversations
// (archived through Codex itself), the scratch folders and the throwaway data folder.
async function cleanup() {
  const home = os.homedir(), ids = [];
  // Claude and Codex take a moment to close after the app does; until then their folders are in use.
  await sleep(5000);
  const retry = async (fn, tries = 5) => { for (let i = 1; ; i++) { try { return await fn(); } catch (err) { if (i >= tries) throw err; await sleep(2000); } } };
  // When something failed, what the app itself logged helps most.
  if ((failed || process.env.REAL_DUO_LOG) && out.dataDir) { try { console.log(`\n--- the app's log ---\n${fs.readFileSync(path.join(out.dataDir, 'switcher.log'), 'utf8').split('\n').slice(-60).join('\n')}`); } catch { /* none */ } }
  for (const f of out.folders) { try { fs.rmSync(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects', f.replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true, force: true }); } catch { /* not there */ } }
  // Codex keeps conversations under sessions/YYYY/MM/DD; the test's are from today (or yesterday, past midnight).
  const days = new Set();
  for (const t of [Date.now(), Date.now() - 864e5]) { const d = new Date(t); days.add([d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join(path.sep)); }
  for (const day of days) {
    const dir = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions', day);
    let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(n); if (!m) continue;
      let head = ''; try { const fd = fs.openSync(path.join(dir, n), 'r'); const b = Buffer.alloc(4096); const len = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); head = b.toString('utf8', 0, len); } catch { continue; }
      if (out.folders.some(f => head.includes(JSON.stringify(f).slice(1, -1)))) ids.push(m[1]);
    }
  }
  const left = [];
  if (ids.length) {
    const { CodexServer } = require(path.join(repo, 'lib', 'codex.js'));
    const srv = new CodexServer({ codex: { command: 'codex', enabled: true }, prefs: { cleanEnv: true } }, () => {});
    try {
      await srv.start();
      for (const id of ids) { try { await retry(() => srv.request('thread/archive', { threadId: id }, 30000), 3); } catch (err) { left.push(`Codex conversation ${id} (${err.message})`); } }
    } catch (err) { left.push(`${ids.length} Codex conversations (Codex didn't start: ${err.message})`); } finally { srv.stop(); }
  }
  for (const f of [...out.folders, out.dataDir].filter(Boolean)) { try { await retry(() => fs.rmSync(f, { recursive: true, force: true })); } catch (err) { left.push(`${f} (${err.code || err.message})`); } }
  console.log(`Cleaned up ${out.folders.length} scratch project${out.folders.length === 1 ? '' : 's'} and ${ids.length - left.filter(x => x.startsWith('Codex')).length} Codex conversation${ids.length === 1 ? '' : 's'}.`);
  if (left.length) console.log(`Couldn’t clean up (remove these by hand):\n  ${left.join('\n  ')}`);
}
