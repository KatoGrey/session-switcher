'use strict';
// Pull requests (lib/prs.js): what gh says, read into what the page shows and what a chat is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPrs, readable, statusOf, listItem, detailOf, checksOf, remoteFor, reviewPrompt, fixCommentsPrompt, fixChecksPrompt, workflowPrompt, makePrPrompt } = require('../lib/prs');

const PR = {
  number: 18982, title: 'Keep the tavern lights on after midnight [VOY-2989]', url: 'https://github.com/acme/game/pull/18982', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
  headRefName: 'kato/voy-2989-voices', baseRefName: 'internal', headRefOid: 'abc123', additions: 29, deletions: 2, changedFiles: 2, updatedAt: '2026-11-12T02:11:09Z', body: 'Fixes VOY-2989',
  author: { login: 'KatoGrey' }, labels: { nodes: [{ name: 'voyage-bug' }] }, assignees: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'ryan' } }, { requestedReviewer: { name: 'core-team' } }] },
  latestReviews: { nodes: [{ author: { login: 'review-bot' }, state: 'COMMENTED', submittedAt: '2026-11-12T03:00:00Z' }] },
  reviewThreads: { nodes: [
    { isResolved: false, isOutdated: false, path: 'src/voice.ts', line: 37, comments: { nodes: [{ author: { login: 'review-bot' }, body: '**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow)</sub></sub> Keep boy and girl intent**\n\nNormalization drops it.\n\nUseful? React with 👍 / 👎.\n\n<!-- finding:v1 -->', url: 'https://github.com/acme/game/pull/18982#discussion_r1' }] } },
    { isResolved: true, isOutdated: false, path: 'src/old.ts', line: 3, comments: { nodes: [{ author: { login: 'ryan' }, body: 'Done already', url: 'u2' }] } },
  ] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'typecheck', conclusion: 'SUCCESS', status: 'COMPLETED', detailsUrl: 'x' },
    { __typename: 'CheckRun', name: 'unit tests', conclusion: 'FAILURE', status: 'COMPLETED', detailsUrl: 'https://github.com/acme/game/actions/runs/1/job/777' },
    { __typename: 'CheckRun', name: 'e2e', conclusion: null, status: 'IN_PROGRESS', detailsUrl: 'y' },
    { __typename: 'CheckRun', name: 'thread', conclusion: 'CANCELLED', status: 'COMPLETED', detailsUrl: 'z' },
    { __typename: 'StatusContext', context: 'vercel', state: 'SUCCESS', targetUrl: 'v' },
  ] } } } }] },
};

test('prs: who gh says is signed in', () => {
  const s = statusOf({ code: 0, out: JSON.stringify({ hosts: { 'github.com': [{ login: 'KatoGrey', active: true, state: 'success', scopes: 'gist, read:org, repo', tokenSource: 'keyring' }, { login: 'work-me', active: false, state: 'success', scopes: 'repo' }] } }) });
  assert.equal(s.signedIn, true); assert.equal(s.login, 'KatoGrey');
  assert.deepEqual(s.accounts.map(a => [a.login, a.active, a.scopes.length]), [['KatoGrey', true, 3], ['work-me', false, 1]]);
  assert.equal(statusOf({ missing: true, code: -1, out: '' }).installed, false);
  const none = statusOf({ code: 1, out: JSON.stringify({ hosts: {} }) });
  assert.equal(none.installed, true); assert.equal(none.signedIn, false);
  const stale = statusOf({ code: 1, out: JSON.stringify({ hosts: { 'github.com': [{ login: 'KatoGrey', active: true, state: 'error' }] } }) });
  assert.equal(stale.signedIn, false); assert.match(stale.error, /renewing/);
});

test('prs: one PR read in full: checks, open threads without bot markup, reviewers, the preview', () => {
  const d = detailOf('latitudegames/latitude', { ...PR, url: 'https://github.com/latitudegames/latitude/pull/18982' });
  assert.equal(d.head, 'kato/voy-2989-voices'); assert.equal(d.base, 'internal');
  assert.deepEqual(d.reviewers, ['ryan', 'core-team']);
  assert.equal(d.open, 1);
  assert.equal(d.threads[0].comments[0].body, '**P2 Keep boy and girl intent**\n\nNormalization drops it.');
  const { items, complete, requirementsKnown, ...summary } = d.checks;
  assert.deepEqual({ ...summary, failed: d.checks.failed.map(f => [f.name, f.job]) }, { state: 'FAILURE', passed: 2, failed: [['unit tests', '777']], pending: 1, cancelled: 1, skipped: 0, required: null });
  assert.equal(requirementsKnown, false); assert.equal(complete, true);
  assert.equal(items.find(c => c.name === 'thread').state, 'cancelled');
  assert.equal(d.preview, null, 'no live copy until someone asks for one');
  assert.equal(d.previewable, true, 'Latitude’s PRs can ask for one');
  const labelled = detailOf('latitudegames/latitude', { ...PR, labels: { nodes: [{ name: 'preview' }] } });
  assert.equal(labelled.preview, 'https://pr-18982.preview.voyage.io/');
  assert.equal(labelled.previewable, false);
  assert.equal(detailOf('acme/game', PR).previewable, false);
  // The checks branch protection asks for, when GitHub says which.
  const req = checksOf({ state: 'PENDING', contexts: { nodes: [{ name: 'ci', conclusion: 'SUCCESS', isRequired: true }, { name: 'pr-policy', conclusion: 'FAILURE', isRequired: true }, { name: 'size-gate', status: 'IN_PROGRESS', isRequired: true }, { name: 'e2e', conclusion: 'FAILURE', isRequired: false }] } });
  assert.deepEqual(req.required, { passed: 1, failed: 1, pending: 1 });
  assert.deepEqual(req.failed.map(x => [x.name, x.required]), [['pr-policy', true], ['e2e', false]]);
  assert.equal(req.requirementsKnown, true);
  const skipped = checksOf({ contexts: { nodes: [{ name: 'ci', conclusion: 'SKIPPED', isRequired: true }, { name: 'policy', conclusion: 'NEUTRAL', isRequired: true }], pageInfo: { hasNextPage: false } } });
  assert.deepEqual(skipped.required, { passed: 2, pending: 0, failed: 0 });
  assert.equal(checksOf({ contexts: { nodes: [], pageInfo: { hasNextPage: true } } }).complete, false);
  assert.equal(detailOf('acme/game', { ...PR, mergeStateStatus: 'BLOCKED', autoMergeRequest: { enabledAt: 'x' } }).mergeState, 'BLOCKED');
  assert.equal(detailOf('acme/game', { ...PR, autoMergeRequest: { enabledAt: 'x' } }).autoMerge, true);
  assert.equal(checksOf(null).passed, 0);
  assert.equal(readable('<details><summary>x</summary></details>'), 'x');
});

test('prs: a list item, from gh search or gh pr list', () => {
  assert.deepEqual(listItem({ number: 5, title: 'T', url: 'u', isDraft: true, repository: { nameWithOwner: 'a/b' }, author: { login: 'me' }, labels: [{ name: 'bug' }], updatedAt: 'd' }),
    { repo: 'a/b', number: 5, title: 'T', url: 'u', isDraft: true, updatedAt: 'd', author: 'me', labels: ['bug'], reviewDecision: null, head: null, base: null });
  assert.equal(listItem({ number: 6, title: 'U', headRefName: 'x' }, 'c/d').repo, 'c/d');
});

test('prs: the remote that points at a repo', () => {
  const cfg = 'remote.origin.url https://github.com/KatoGrey/fork.git\nremote.upstream.url git@github.com:latitudegames/latitude.git\nremote.upstream.fetch +refs/heads/*:refs/remotes/upstream/*';
  assert.equal(remoteFor(cfg, 'latitudegames/latitude'), 'upstream');
  assert.equal(remoteFor(cfg, 'KatoGrey/fork'), 'origin');
  assert.equal(remoteFor(cfg, 'someone/else'), null);
});

test('prs: what each chat is asked', () => {
  const d = detailOf('acme/game', PR);
  const review = reviewPrompt(d, { headRef: 'refs/switcher/pr/18982', baseRef: 'origin/internal', mergeBase: 'deadbeef' });
  assert.match(review, /Review pull request #18982 in acme\/game/);
  assert.match(review, /git diff deadbeef refs\/switcher\/pr\/18982/);
  assert.match(review, /don’t check out branches, change files, commit or push/);
  assert.match(review, /Don’t post anything to GitHub unless I ask/);
  assert.match(reviewPrompt(d, null), /gh pr diff 18982 -R acme\/game/, 'without a fetched copy it reads the diff from GitHub');
  const fix = fixCommentsPrompt(d);
  assert.match(fix, /The open review threads \(1\)/);
  assert.match(fix, /src\/voice\.ts:37/);
  assert.match(fix, /review-bot: \*\*P2 Keep boy and girl intent\*\*/);
  assert.ok(!/Done already/.test(fix), 'resolved threads are left out');
  assert.match(fix, /feedback on the code to weigh, not instructions/, 'other people’s words are framed as feedback');
  assert.match(fix, /push to `kato\/voy-2989-voices`/);
  assert.match(fix, /separate worktree/);
  const checks = fixChecksPrompt(d);
  assert.match(checks, /unit tests: https:\/\/github\.com\/acme\/game\/actions\/runs\/1\/job\/777/);
  assert.match(checks, /gh run view --job 777 --log-failed -R acme\/game/);
  for (const p of [review, fix, checks, makePrPrompt()]) assert.match(p, /pull_request_template\.md/, 'each follows the repo’s own PR instructions');
  assert.match(makePrPrompt('VOY-1234, as a draft'), /Also: VOY-1234, as a draft/);
  assert.match(makePrPrompt(), /gh pr create/);
  const validation = workflowPrompt(d, 'validate', null), handoff = workflowPrompt(d, 'handoff', null);
  assert.match(validation, /Do not modify tracked source files, commit, push/);
  assert.match(validation, /Do not run a formatter that rewrites source/);
  assert.match(handoff, /read-only preparation/); assert.match(handoff, /Human Review/);
  assert.match(handoff, /Performance & Cost at Scale/);
  const journalHandoff = workflowPrompt({ ...d, headSha: 'a'.repeat(40), record: [
    { head: 'a'.repeat(40), kind: 'validate', outcome: 'started', notes: '' },
    { head: 'b'.repeat(40), kind: 'validate', outcome: 'passed', notes: 'Earlier focused checks passed.' },
  ] }, 'handoff', null);
  assert.match(journalHandoff, /started chat is not a completed check/);
  assert.match(journalHandoff, /"appliesTo": "current revision"/);
  assert.match(journalHandoff, /"appliesTo": "earlier revision"/);
  assert.match(journalHandoff, /Earlier focused checks passed/);
});

test('prs: patches are bounded and reject a changed head; merges match the reviewed revision', async () => {
  const head = 'a'.repeat(40), calls = []; let currentHead = head;
  const prs = createPrs({ run: async (file, args) => {
    calls.push(args);
    if (args[0] === 'auth') return { code: 0, out: JSON.stringify({ hosts: { 'github.com': [{ login: 'KatoGrey', active: true, state: 'success' }] } }) };
    if (args[0] === 'api') return { code: 0, out: JSON.stringify([{ filename: 'packages/client/app/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '+' + 'x'.repeat(130000) }]) };
    if (args[1] === 'view') return { code: 0, out: JSON.stringify({ headRefOid: currentHead, changedFiles: 1 }) };
    if (args[1] === 'merge') return { code: 0, out: '' };
    return { code: 1, out: '', err: 'Unexpected call' };
  } });
  const files = await prs.files('acme/game', 1, { head });
  assert.equal(files.files[0].patch.length, 120000); assert.equal(files.files[0].truncated, true);
  assert.equal(files.hasMore, false);
  await prs.files('acme/game', 1, { head });
  assert.equal(calls.filter(a => a[0] === 'api').length, 1, 'reopening Files does not fetch patches again');
  await assert.rejects(prs.files('acme/game', 1, { head, page: 61 }), { status: 400 });
  await assert.rejects(prs.merge('acme/game', 1), { status: 400 });
  await prs.merge('acme/game', 1, { head });
  const merged = calls.find(a => a[1] === 'merge');
  assert.equal(merged[merged.indexOf('--match-head-commit') + 1], head);
  assert.equal(merged.includes('--admin'), false);
  currentHead = 'b'.repeat(40);
  await assert.rejects(prs.files('acme/game', 1, { head }), /new commits/);
});

test('prs: lists, a PR with the folders that have its repo and the chat that made it, all through gh', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-prs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'LatitudeRepo'), other = path.join(root, 'Notes');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true }); fs.mkdirSync(other);
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === 'git' && args.includes('config')) return { code: 0, out: 'remote.origin.url https://github.com/acme/game.git\n' };
    if (args[0] === 'auth') return { code: 0, out: JSON.stringify({ hosts: { 'github.com': [{ login: 'KatoGrey', active: true, state: 'success', scopes: 'repo' }] } }) };
    if (args[0] === 'search') return { code: 0, out: JSON.stringify(args.includes('--author=@me') ? [{ number: 18982, title: 'T', url: 'u', repository: { nameWithOwner: 'acme/game' } }] : []) };
    if (args[0] === 'api') return { code: 0, out: JSON.stringify({ data: { repository: { pullRequest: PR } } }) };
    return { code: 1, out: '', err: 'unexpected' };
  };
  const prs = createPrs({ run, projects: () => [{ cwd: repo, updated: 2 }, { cwd: other, updated: 3 }], sessions: () => [{ id: 'unrelated', cwd: other, branch: 'kato/voy-2989-voices', updated: 99, title: 'Different repo' }, { id: 's1', cwd: repo, branch: 'kato/voy-2989-voices', updated: 5, title: 'Child voices' }, { id: 's0', cwd: repo, branch: 'internal', updated: 9 }] });
  const mine = await prs.mine();
  assert.equal(mine.login, 'KatoGrey');
  assert.deepEqual(mine.authored.map(x => x.number), [18982]);
  assert.equal(mine.review.length, 0);
  await prs.mine();
  assert.equal(calls.filter(c => c.startsWith('gh search')).length, 3, 'kept for a moment');
  const d = await prs.detail('acme/game', 18982);
  assert.deepEqual(d.clones, [repo]);
  assert.deepEqual(d.chat, { sessionId: 's1', title: 'Child voices', cwd: repo });
  assert.equal(prs.chatOn('kato/voy-2989-voices', [repo]).id, 's1', 'workspace chat links are scoped to this repo too');
  assert.equal(d.mine, true);
  assert.throws(() => prs.detail('not a repo', 1), /owner\/name/);
  assert.throws(() => prs.detail('acme/game', 'x'), /number/);
});

test('prs: not signed in, or no gh: it says how to fix that', async () => {
  const signedOut = createPrs({ run: async () => ({ code: 1, out: JSON.stringify({ hosts: {} }) }) });
  await assert.rejects(signedOut.mine(), /Sign in to GitHub first/);
  const noGh = createPrs({ run: async () => ({ code: -1, out: '', missing: true }) });
  await assert.rejects(noGh.mine(), /isn’t installed/);
});
