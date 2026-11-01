'use strict';
// The real search route must include provider transcript words and open a crew's lead chat for a
// partner-only hit. Isolated homes and fake provider transport keep real accounts out of this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { build } = require('./fake-world');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await sleep(100); }
  assert.fail(typeof message === 'function' ? message() : message);
}
const codexLine = text => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } }) + '\n';

test('workflow: search finds Codex and Gemini conversation text, including a hidden crew partner and later appends', {
  skip: process.platform !== 'win32' ? 'Fake provider launchers currently use Windows .cmd files.' : process.versions.electron ? 'Not for the installed app self-check.' : false,
}, async () => {
  const world = await build();
  try {
    const html = await (await fetch(world.base)).text(), token = html.match(/TOKEN = '([a-f0-9]+)'/)[1];
    const headers = { 'x-switcher-token': token, 'content-type': 'application/json' };
    const get = async route => { const r = await fetch(world.base + route, { headers }); const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data; };
    const post = async (route, body) => { const r = await fetch(world.base + route, { method: 'POST', headers, body: JSON.stringify(body) }); const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data; };
    const ready = (key, needsId = true) => {
      let latest;
      return until(async () => {
        latest = await post('api/chat/attach', { key });
        return latest.state === 'ready' && (!needsId || latest.sessionId) && latest;
      }, () => `The stand-in provider did not become ready: ${JSON.stringify({ provider: latest?.provider, state: latest?.state, sessionId: latest?.sessionId, needsId })}\n${world.serverLog().slice(-2000)}`);
    };
    const start = async provider => {
      const c = await post('api/chat/open', { provider, account: provider === 'claude' ? 'main' : undefined, cwd: world.tavern, mode: 'new' });
      await ready(c.key, false); // Gemini gets its conversation id on the first send.
      await post('api/chat/send', { key: c.key, text: 'Please help with this small task.' });
      return ready(c.key);
    };
    const rollout = (id, text) => {
      const file = path.join(world.home, '.codex', 'sessions', '2026', '10', '31', `rollout-2026-10-31-${id}.jsonl`);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, codexLine(text)); return file;
    };
    const codex = await start('codex');
    const codexFile = rollout(codex.sessionId, 'The saved answer mentions cobalt-orchard-needle.');
    const gemini = await start('gemini');
    const geminiFile = path.join(world.home, '.gemini', 'antigravity-cli', 'brain', gemini.sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.dirname(geminiFile), { recursive: true });
    fs.appendFileSync(geminiFile, JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'The other saved answer mentions amber-harbour-needle.' }) + '\n');
    const lead = await start('claude');
    const sent = await post('api/chat/send', { key: lead.key, to: 'partner', kind: 'codex', text: 'Please help with the crew task.' });
    const partner = await ready(sent.key);
    const partnerFile = rollout(partner.sessionId, 'Only the crew partner knows violet-citadel-needle.');
    fs.writeFileSync(partnerFile + '.zst', zstdCompressSync(fs.readFileSync(partnerFile)));
    fs.unlinkSync(partnerFile);

    const search = async (q, id) => until(async () => {
      const result = await get('api/search?q=' + encodeURIComponent(q));
      assert.ok(result.progress && Number.isFinite(result.progress.done) && Number.isFinite(result.progress.total));
      assert.ok(result.progress.done <= result.progress.total);
      const hit = result.hits.find(x => x.id === id);
      return hit && { hit, result };
    }, `Search did not find ${q} in the expected conversation.`);
    const first = await search('cobalt-orchard-needle', codex.sessionId);
    assert.match(first.hit.snippet, /cobalt-orchard-needle/);
    const second = await search('amber-harbour-needle', gemini.sessionId);
    assert.match(second.hit.snippet, /amber-harbour-needle/);
    const third = await search('violet-citadel-needle', lead.sessionId);
    assert.match(third.hit.snippet, /violet-citadel-needle/);
    assert.ok(!third.result.hits.some(x => x.id === partner.sessionId), 'a partner-only hit opens the shared lead chat');
    const listed = (await get('api/sessions')).projects.flatMap(p => p.sessions || []);
    assert.ok(listed.some(x => x.id === lead.sessionId));
    assert.ok(!listed.some(x => x.id === partner.sessionId), 'the partner is actually hidden from normal chat rows');

    fs.appendFileSync(codexFile, codexLine('A later answer adds silver-comet-append.'));
    assert.match((await search('silver-comet-append', codex.sessionId)).hit.snippet, /silver-comet-append/);
    // Codex compresses finished rollouts. A cached raw path must not hide the conversation
    // when it becomes an archive between searches.
    fs.writeFileSync(codexFile + '.zst', zstdCompressSync(Buffer.concat([fs.readFileSync(codexFile), Buffer.from(codexLine('The completed archive adds golden-lantern-transition.'))])));
    fs.unlinkSync(codexFile);
    assert.match((await search('golden-lantern-transition', codex.sessionId)).hit.snippet, /golden-lantern-transition/);
    await until(async () => (await get('api/search?q=cobalt-orchard-needle')).progress.ready, 'Search progress never settled.');
  } finally { await world.done(); }
});
