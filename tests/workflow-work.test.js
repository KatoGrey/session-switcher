'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { status, group } = require('../ui/work-model');
const skill = require('../lib/pr-review-skill');
const { startPrompt } = require('../lib/linear');

test('work: approval is not merge readiness while checks or requirements block it', () => {
  const pr = { state: 'OPEN', mine: true, reviewDecision: 'APPROVED', mergeState: 'CLEAN', checks: { passed: 4 } };
  assert.equal(status(pr).action, 'merge');
  for (const checks of [{ pending: 1 }, { cancelled: 1 }, { state: 'PENDING' }, { state: 'FAILURE' }, { failed: [{ name: 'CI' }] }]) assert.notEqual(status({ ...pr, checks }).action, 'merge');
  for (const mergeState of ['BLOCKED', 'BEHIND', 'UNKNOWN', 'UNSTABLE', 'DIRTY', null]) assert.notEqual(status({ ...pr, mergeState }).action, 'merge');
  assert.notEqual(status({ ...pr, open: 1 }).action, 'merge');
  assert.notEqual(status({ ...pr, isDraft: true }).action, 'merge');
  assert.equal(status({ ...pr, state: 'MERGED', checks: { failed: [{}] } }).label, 'Merged');
  assert.equal(status({ ...pr, isDraft: true, checks: { failed: [{}] } }).action, 'fix-checks', 'drafts still show CI failures');
  assert.equal(status({ ...pr, mine: false, roles: ['review'], checks: { pending: 1 } }).attention, true, 'review can begin while checks run');
  const optional = { state: 'FAILURE', requirementsKnown: true, complete: true, required: { passed: 4, failed: 0, pending: 0 }, failed: [{ name: 'advisory', required: false }] };
  assert.equal(status({ ...pr, checks: optional }).action, 'merge', 'optional failure is not a branch protection gate when GitHub reports clean');
  assert.notEqual(status({ ...pr, checks: { ...optional, complete: false } }).action, 'merge');
  assert.notEqual(status({ ...pr, threadsComplete: false }).action, 'merge');
});
test('work: Linear assignments include colleagues’ linked PRs without duplicating issues', () => {
  const issues = [{ identifier: 'VOY-1', priority: 2, prs: [{ repo: 'LatitudeGames/Latitude', number: 3 }] }, { identifier: 'VOY-2', priority: 1 }, { identifier: 'VOY-3', state: { type: 'started' } }];
  const prs = [{ repo: 'latitudegames/latitude', number: 3, state: 'OPEN', roles: ['linked', 'review'], mine: false }];
  const g = group({ issues, prs });
  assert.deepEqual(g.todo.map(x => x.identifier), ['VOY-2']);
  assert.deepEqual(g.doing.map(x => x.identifier), ['VOY-3']);
  assert.equal(g.review.length, 1); assert.equal(g.waiting.length, 0); assert.equal(g.attention.length, 1);
});
test('review skill: validates PR links and preserves literal model choices and instructions', () => {
  assert.deepEqual(skill.parseUrl('https://github.com/latitudegames/latitude/pull/123/files#x'), { repo: 'latitudegames/latitude', n: 123, url: 'https://github.com/latitudegames/latitude/pull/123' });
  for (const url of ['', 'https://evil.test/a/b/pull/3', 'https://github.com.evil.test/a/b/pull/3', 'https://github.com/a/b/issues/3']) assert.throws(() => skill.parseUrl(url), { status: 400 });
  const prompt = skill.prompt('https://github.com/a/b/pull/3', { instructions: 'Focus on scope. Keep `literal` $text.', model: 'opus', effort: 'high' });
  assert.match(prompt, /Focus on scope\. Keep `literal` \$text\./);
  assert.match(prompt, /User-selected Claude model \(literal CLI argument\): "opus"/);
  assert.match(prompt, /Never fork the session or start a replacement chat/);
  assert.match(prompt, /Do not impose a round limit/);
  const defaults = skill.prompt('https://github.com/a/b/pull/3');
  assert.match(defaults, /CLI default; omit --model/); assert.match(defaults, /CLI default; omit --effort/);
  assert.throws(() => skill.prompt('https://github.com/a/b/pull/3', { model: {} }), { status: 400 });
});
test('work: planning an issue does not instruct implementation or publication', () => {
  const p = startPrompt({ identifier: 'VOY-1', title: 'Fix this', url: 'https://linear.app/issue/VOY-1', description: 'A bug' }, { mode: 'plan' });
  assert.match(p, /planning only/); assert.match(p, /Wait for my instruction to implement/);
  assert.doesNotMatch(p, /When it works and the checks pass, push/);
});
