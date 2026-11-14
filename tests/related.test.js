'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runsOf, addRun, relatedFor } = require('../lib/related');

test('related: an issue keeps every chat started for it, newest first (it used to keep only the last)', () => {
  let e = null;
  e = addRun(e, { key: 'k1', sessionId: 's1', at: 1, role: 'plan', provider: 'claude' });
  e = addRun(e, { key: 'k2', sessionId: null, at: 2, role: 'start', provider: 'codex' });
  e = addRun(e, { key: 'k3', sessionId: 's3', at: 3, role: 'start', provider: 'gemini' });
  assert.deepStrictEqual(runsOf(e).map(r => r.key), ['k3', 'k2', 'k1']);
  assert.strictEqual(e.key, 'k3', 'the newest run stays at the top level for older readers');
  // The same chat again moves to the top instead of appearing twice.
  e = addRun(e, { key: 'k1', sessionId: 's1', at: 4, role: 'review' });
  assert.deepStrictEqual(runsOf(e).map(r => r.key), ['k1', 'k3', 'k2']);
});

test('related: a pre-6.13 entry (one chat) reads as one run', () => {
  assert.deepStrictEqual(runsOf({ key: 'k', sessionId: 's', at: 5 }), [{ key: 'k', sessionId: 's', at: 5, role: 'start' }]);
  assert.deepStrictEqual(runsOf(null), []);
});

const board = {
  issues: [{ identifier: 'VOY-1', title: 'Fix the tavern', state: 'In Progress', url: 'https://linear.app/x/VOY-1', prs: [{ repo: 'o/r', number: 7 }] }],
  prs: [{ repo: 'o/r', number: 7, title: 'Tavern fix', url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: false, head: 'tyler/voy-1-tavern', reviewDecision: 'REVIEW_REQUIRED', issue: 'VOY-1',
    checks: { state: 'FAILURE', passed: 12, failed: [{ name: 'lint' }], pending: 1 }, cwds: ['C:\\Repos\\latitude'] },
    { repo: 'o/r', number: 9, title: 'Other', head: 'someone/else', cwds: ['C:\\Repos\\latitude'] }],
};

test('related: a chat started for an issue knows the issue, its PR, and the other chats on it', () => {
  const work = { 'VOY-1': addRun(addRun(null, { key: 'plan', sessionId: 'sp', at: 1, role: 'plan', provider: 'claude' }), { key: 'build', sessionId: 'sb', at: 2, role: 'start', provider: 'codex' }) };
  const r = relatedFor({ chat: { key: 'build', sessionId: 'sb', cwd: 'C:\\Repos\\latitude', branch: 'tyler/voy-1-tavern' }, board, work });
  assert.strictEqual(r.issue.identifier, 'VOY-1');
  assert.strictEqual(r.pr.number, 7);
  assert.strictEqual(r.pr.guess, false, 'found through its issue, not guessed');
  assert.deepStrictEqual(r.pr.checks, { state: 'FAILURE', passed: 12, failed: 1, pending: 1 });
  assert.strictEqual(r.role, 'start');
  assert.deepStrictEqual(r.runs.map(x => x.sessionId), ['sp'], 'the planning chat, not this one');
});

test('related: the PR journal names the chats that reviewed or validated a PR', () => {
  const journal = () => [{ kind: 'review', at: 9, chat: { key: 'rev', sessionId: 'sr', provider: 'codex' } }];
  const r = relatedFor({ chat: { key: 'rev', sessionId: 'sr', cwd: 'C:\\Repos\\latitude', branch: 'main' }, board, records: [{ repo: 'o/r', n: 7, entry: { kind: 'review' } }], journal });
  assert.strictEqual(r.pr.number, 7);
  assert.strictEqual(r.role, 'review');
  assert.strictEqual(r.issue.identifier, 'VOY-1', 'and the PR leads to its issue');
});

test('related: a PR found only by the branch is a guess, and says so; main is never a match', () => {
  const r = relatedFor({ chat: { sessionId: 'x', cwd: 'c:\\repos\\latitude\\', branch: 'tyler/voy-1-tavern' }, board, prChats: () => [{ id: 'other', updated: 3, title: 'Earlier work' }, { id: 'x', updated: 4 }] });
  assert.strictEqual(r.pr.number, 7);
  assert.strictEqual(r.pr.guess, true);
  assert.deepStrictEqual(r.runs.map(x => [x.sessionId, x.how]), [['other', 'branch']]);
  assert.ok(relatedFor({ chat: { sessionId: 'x', cwd: 'C:\\Repos\\latitude', branch: 'main' }, board }).none);
  // A branch with the same name in another folder isn't this PR's.
  assert.ok(relatedFor({ chat: { sessionId: 'x', cwd: 'D:\\Elsewhere', branch: 'tyler/voy-1-tavern' }, board }).none);
});

test('related: what started a chat (a routine) shows, and an ordinary chat has nothing related', () => {
  const r = relatedFor({ chat: { key: 'k9', sessionId: null, cwd: 'C:\\Art', branch: null }, origins: [{ kind: 'routine', id: 'r1', name: 'Morning sweep', key: 'k9' }] });
  assert.deepStrictEqual(r.origin, { kind: 'routine', id: 'r1', name: 'Morning sweep' });
  assert.deepStrictEqual(relatedFor({ chat: { key: 'k', sessionId: 's', cwd: 'C:\\Art', branch: null } }), { none: true, branch: null });
});

test('related: the PR journal finds the entries naming a chat, across PRs', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'related-'));
  try {
    let t = 1;
    const rec = require('../lib/pr-records').createPrRecords({ dataDir, now: () => t++ });
    const head = 'a'.repeat(40);
    rec.started({ repo: 'o/r', number: 7, headSha: head }, 'review', { key: 'k1', sessionId: 's1', provider: 'codex' });
    rec.started({ repo: 'o/r', number: 8, headSha: head }, 'validate', { key: 'k2', sessionId: null });
    rec.started({ repo: 'o/other', number: 3, headSha: head }, 'fix-checks', { key: 'k1', sessionId: 's1' });
    const found = rec.findByChat({ sessionId: 's1' });
    assert.deepStrictEqual(found.map(x => [x.repo, x.n, x.entry.kind]), [['o/other', 3, 'fix-checks'], ['o/r', 7, 'review']]);
    assert.deepStrictEqual(rec.findByChat({ key: 'k2' }).map(x => x.n), [8]);
    assert.deepStrictEqual(rec.findByChat({}), []);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
