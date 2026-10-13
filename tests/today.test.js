// The day at a glance: when each chat's messages and replies happened, from the chat index.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionStore } = require('../lib/sessions');

function chatFile(root, id, lines) {
  const dir = path.join(root, 'C--Projects-Demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return path.join(dir, `${id}.jsonl`);
}
const at = minsAgo => new Date(Date.now() - minsAgo * 60000).toISOString();
const you = (text, mins) => ({ type: 'user', timestamp: at(mins), cwd: 'C:\\Projects\\Demo', message: { role: 'user', content: text } });
const claude = (id, text, mins) => ({ type: 'assistant', timestamp: at(mins), message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });

test('today: each message and reply is noted once (a reply streamed in parts counts once), and only since the moment asked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-today-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-today-data-'));
  chatFile(root, 'aaaa1111-0000-0000-0000-000000000001', [
    you('Plan the tavern brawl', 300), claude('m1', 'Here is a plan', 299), claude('m1', '…and more of it', 299),
    you('Now build it', 30), claude('m2', 'Built.', 28),
  ]);
  chatFile(root, 'bbbb2222-0000-0000-0000-000000000002', [you('Old question', 2000), claude('m9', 'Old answer', 1999)]);
  const s = createSessionStore({ root, dataDir: data });
  await s.refreshIndex();
  const today = s.activity(Date.now() - 360 * 60000);
  assert.equal(today.length, 1, 'only the chat active in the last six hours');
  assert.equal(today[0].id, 'aaaa1111-0000-0000-0000-000000000001');
  assert.equal(today[0].times.length, 4, 'two messages and two replies');
  const recent = s.activity(Date.now() - 60 * 60000);
  assert.equal(recent[0].times.length, 2, 'the last hour: one message and its reply');
  // More is appended: it's picked up without reading the whole file again.
  fs.appendFileSync(path.join(root, 'C--Projects-Demo', 'aaaa1111-0000-0000-0000-000000000001.jsonl'), JSON.stringify(you('And test it', 1)) + '\n');
  await s.refreshIndex();
  assert.equal(s.activity(Date.now() - 60 * 60000)[0].times.length, 3);
});

test('search: any capitals, special characters as written, and a snippet around the first match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-search-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-search-data-'));
  chatFile(root, 'cccc3333-0000-0000-0000-000000000003', [
    you('Why does RALLY stack with itself?', 10), claude('m1', 'Because rally_bonus (a+b) is added per bard. Rally again.', 9),
  ]);
  const s = createSessionStore({ root, dataDir: data });
  await s.refreshIndex();
  const r = s.search('rally');
  assert.equal(r.hits.length, 1);
  assert.ok(r.hits[0].count >= 3, `counts every match, any capitals (${r.hits[0].count})`);
  assert.match(r.hits[0].snippet, /RALLY stack/);
  assert.equal(s.search('(a+b)').hits.length, 1, 'special characters are matched as written');
  assert.equal(s.search('rally lullaby').hits.length, 0, 'every word has to be there');
});
