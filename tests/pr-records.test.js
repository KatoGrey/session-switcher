'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPrRecords } = require('../lib/pr-records');
const repo = 'latitudegames/latitude', head = 'a'.repeat(40), next = 'b'.repeat(40);
function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pr-record-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, book: createPrRecords({ dataDir, now: () => 1000 }) };
}
test('PR journal: starts are not results; evidence and chat links survive a restart', async t => {
  const { book, dataDir } = setup(t);
  const entry = book.started({ repo, number: 42, headSha: head }, 'validate', { key: 'chat-key', provider: 'codex' });
  assert.equal(entry.outcome, 'started'); assert.equal(entry.notes, '');
  book.bindSession(repo, 42, entry.id, 'persistent-session');
  const reopened = createPrRecords({ dataDir });
  assert.equal(reopened.list(repo, 42)[0].chat.sessionId, 'persistent-session');
  const result = await reopened.save({ repo, n: 42, id: entry.id, head, kind: 'validate', outcome: 'passed', notes: 'yarn test voices: 18 passed on this revision.' }, () => { throw new Error('An old entry must not be relabeled as the current revision'); });
  assert.equal(result.head, head); assert.equal(result.at, 1000); assert.equal(result.chat.key, 'chat-key');
  assert.equal(createPrRecords({ dataDir }).list(repo, 42)[0].outcome, 'passed');
  await assert.rejects(() => reopened.save({ ...result, repo, n: 42, head: next }, () => next), { status: 409 });
  assert.equal(reopened.list(repo, 42)[0].head, head);
});
test('PR journal: new results reject stale heads and invalid notes without changing saved evidence', async t => {
  const { book } = setup(t), body = { repo, n: 42, head, kind: 'review', outcome: 'notes', notes: 'One remaining scope question.' };
  await assert.rejects(() => book.save(body, () => next), { status: 409 });
  assert.equal(book.list(repo, 42).length, 0);
  for (const change of [{ head: '' }, { outcome: 'started' }, { notes: '' }, { notes: 'x'.repeat(6001) }, { repo: '../latitude' }, { n: 0 }]) {
    await assert.rejects(() => book.save({ ...body, ...change }, () => { throw new Error('Bad input reached GitHub'); }), { status: 400 });
  }
  const saved = await book.save(body, () => head);
  assert.equal(book.list(repo.toUpperCase(), 42)[0].id, saved.id);
  assert.throws(() => book.remove(repo, 43, saved.id), { status: 404 });
  assert.equal(book.list(repo, 42).length, 1);
  book.remove(repo, 42, saved.id);
  assert.equal(book.list(repo, 42).length, 0);
});
