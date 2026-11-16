'use strict';
// Your pull requests, watched (lib/prwatch.js): what changed between two looks becomes a notice, worded for a person,
// and only what changed: a PR seen for the first time says nothing, and someone else's PR only matters when you're
// asked to review it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot, changes, ACTION } = require('../lib/prwatch');

const repo = 'latitudegames/latitude';
const pr = (number, extra = {}) => ({ repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, mine: true, roles: ['authored'], author: 'KatoGrey', state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', reviews: [], open: 0, checks: { failed: [], pending: 2, passed: 5 }, ...extra });
const kinds = list => list.map(e => `${e.kind} #${e.number}`).sort();

test('pr watch: checks failing, then passing again, on yours', () => {
  const a = snapshot([pr(1)]);
  const b = snapshot([pr(1, { checks: { failed: [{ name: 'Lint' }, { name: 'Typecheck' }], pending: 0, passed: 5 } })]);
  const failed = changes(a, b, 1000);
  assert.deepEqual(kinds(failed), ['checks-failed #1']);
  assert.equal(failed[0].title, 'Checks failed on #1');
  assert.equal(failed[0].body, 'PR 1 · 2 failing (Lint, Typecheck)');
  assert.equal(failed[0].url, `https://github.com/${repo}/pull/1`);
  const c = snapshot([pr(1, { checks: { failed: [], pending: 0, passed: 7 } })]);
  assert.deepEqual(kinds(changes(b, c)), ['checks-passed #1']);
  // Still failing, or passing all along: nothing new to say.
  assert.deepEqual(changes(b, b), []);
  assert.deepEqual(changes(c, c), []);
});

test('pr watch: an approval, changes asked for and new comments, with who', () => {
  const a = snapshot([pr(2), pr(3)]);
  const b = snapshot([
    pr(2, { reviewDecision: 'APPROVED', reviews: [{ author: 'sam', state: 'APPROVED' }] }),
    pr(3, { reviewDecision: 'CHANGES_REQUESTED', reviews: [{ author: 'ana', state: 'CHANGES_REQUESTED' }], open: 2 }),
  ]);
  const got = changes(a, b);
  assert.deepEqual(kinds(got), ['approved #2', 'changes #3', 'comments #3']);
  assert.equal(got.find(e => e.kind === 'approved').body, 'sam approved PR 2');
  assert.equal(got.find(e => e.kind === 'changes').body, 'ana asked for changes on PR 3');
  assert.equal(got.find(e => e.kind === 'comments').title, '2 new review threads on #3');
  // Comments resolved (fewer open) is nothing to be told about.
  assert.deepEqual(kinds(changes(b, snapshot([pr(2, { reviewDecision: 'APPROVED' }), pr(3, { reviewDecision: 'CHANGES_REQUESTED', open: 0 })]))), []);
});

test('pr watch: someone asking for your review, and nothing else about their PRs', () => {
  const theirs = extra => pr(9, { mine: false, author: 'ana', roles: ['review'], ...extra });
  const got = changes(snapshot([]), snapshot([theirs()]));
  assert.deepEqual(kinds(got), ['review-asked #9']);
  assert.equal(got[0].title, 'ana asked for your review');
  // Their checks failing isn't yours to hear about.
  assert.deepEqual(changes(snapshot([theirs()]), snapshot([theirs({ checks: { failed: [{ name: 'x' }], pending: 0, passed: 0 } })])), []);
});

test('pr watch: merged by itself is said; merged by you, or a PR seen for the first time, isn’t', () => {
  assert.deepEqual(kinds(changes(snapshot([pr(4, { autoMerge: true })]), snapshot([pr(4, { state: 'MERGED', mergedAt: '2026-11-16T10:00:00Z' })]))), ['merged #4']);
  assert.deepEqual(changes(snapshot([pr(5)]), snapshot([pr(5, { state: 'MERGED', mergedAt: '2026-11-16T10:00:00Z' })])), []);
  assert.deepEqual(changes(snapshot([]), snapshot([pr(6, { checks: { failed: [{ name: 'x' }], pending: 0, passed: 0 } })])), []);
});

test('pr watch: every notice has a button, and an id of its own', () => {
  const a = snapshot([pr(1), pr(2)]);
  const b = snapshot([pr(1, { checks: { failed: [{ name: 'x' }], pending: 0, passed: 0 } }), pr(2, { reviewDecision: 'APPROVED' })]);
  const got = changes(a, b, 42);
  for (const e of got) { assert.ok(ACTION[e.kind], e.kind); assert.match(e.id, /:42$/); }
  assert.equal(new Set(got.map(e => e.id)).size, got.length);
});

test('pr watch: a review asked of a team you’re in isn’t asked of you; one asked of you is told once', () => {
  const theirs = reviewers => pr(11, { mine: false, author: 'ana', roles: ['review'], reviewers });
  assert.deepEqual(changes(snapshot([], 'KatoGrey'), snapshot([theirs(['voyage-codeowners'])], 'KatoGrey')), [], 'a team’s request (CODEOWNERS)');
  assert.deepEqual(kinds(changes(snapshot([], 'KatoGrey'), snapshot([theirs(['katogrey'])], 'KatoGrey'))), ['review-asked #11'], 'by name, whatever the case');
  assert.deepEqual(changes(snapshot([], 'KatoGrey'), snapshot([theirs(['KatoGrey'])], 'KatoGrey'), 1, new Set(['latitudegames/latitude#11'])), [], 'told already');
});
