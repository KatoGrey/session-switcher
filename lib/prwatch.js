'use strict';
// Your pull requests, watched: every few minutes the server reads them (lib/prs.js board) and compares them with last
// time. What changed on yours (checks failing or passing, review decisions, more unresolved threads, or a queued
// PR merging) and who asked for your review become notices: a line on the hub's welcome-back card and on
// a paired phone. The first look only remembers how things are; nothing is said about what was already so.

// How a PR stands, in the few things that are compared. me: your GitHub login (a review asked of a team you're in,
// as CODEOWNERS do, isn't asked of you by name, so it isn't a notice).
function stateOf(p, me = null) {
  const c = p.checks || {};
  const failed = Array.isArray(c.failed) ? c.failed : [];
  const checkState = c.complete === false ? null : failed.length ? 'failed' : c.pending || ['PENDING', 'EXPECTED'].includes(c.state) ? 'pending' :
    c.passed && !c.cancelled && (!c.state || c.state === 'SUCCESS') ? 'passed' : null;
  return {
    repo: p.repo, number: p.number, title: String(p.title || '').slice(0, 200), url: p.url,
    mine: !!p.mine, author: p.author || null,
    review: (p.roles || []).includes('review') && (!me || (p.reviewers || []).some(r => String(r).toLowerCase() === String(me).toLowerCase())),
    checks: checkState, checksSha: c.sha || p.headSha || null,
    failed: failed.slice(0, 3).map(x => String(x.name || x).slice(0, 60)), failedN: failed.length,
    decision: p.reviewDecision || null,
    by: { APPROVED: (p.reviews || []).filter(r => r.state === 'APPROVED').map(r => r.author), CHANGES_REQUESTED: (p.reviews || []).filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.author) },
    open: p.threadsComplete === false ? null : Number(p.open) || 0,
    merged: !!p.mergedAt || p.state === 'MERGED', autoMerge: !!p.autoMerge, mergeQueue: !!p.mergeQueue,
  };
}
const keyOf = p => `${String(p.repo).toLowerCase()}#${p.number}`;
function snapshot(prs, me = null, before = null) {
  const out = {};
  for (const p of prs || []) {
    if (!p?.repo || !p.number) continue;
    const key = keyOf(p), s = stateOf(p, me), was = before?.[key];
    if (was && p.checks?.complete === false && was.checksSha === s.checksSha) {
      s.checks = was.checks; s.failed = was.failed; s.failedN = was.failedN;
    }
    if (was && s.open === null) s.open = was.open;
    out[key] = s;
  }
  return out;
}
const names = list => { const l = [...new Set(list.filter(Boolean))]; return l.length > 2 ? `${l.slice(0, 2).join(', ')} and ${l.length - 2} more` : l.join(' and '); };
// What changed between two snapshots, as notices (newest look: after). asked: the review requests already told, so a
// PR that drops out of GitHub's list and comes back isn't told again.
function changes(before, after, at = Date.now(), asked = new Set()) {
  const out = [];
  const add = (kind, s, title, body, extra = {}) => out.push({ id: `${kind}:${keyOf(s)}:${at}`, kind, at, repo: s.repo, number: s.number, url: s.url, prTitle: s.title, title, body, ...extra });
  for (const [k, s] of Object.entries(after || {})) {
    const was = before && before[k];
    // Someone asked for your review (a PR new to that list).
    if (!s.mine && s.review && !(was && was.review) && !asked.has(k)) add('review-asked', s, `${s.author || 'Someone'} asked for your review`, `#${s.number} ${s.title}`);
    if (!was || !s.mine) continue;
    if (s.merged && !was.merged) { if (was.autoMerge || was.mergeQueue) add('merged', s, `#${s.number} merged`, s.title); continue; }
    if (s.checks === 'failed' && was.checks !== 'failed') add('checks-failed', s, `Checks failed on #${s.number}`, `${s.title} · ${s.failedN} failing${s.failed.length ? ` (${s.failed.join(', ')})` : ''}`);
    else if (s.checks === 'passed' && (was.checks === 'pending' || was.checks === 'failed')) add('checks-passed', s, `Checks passed on #${s.number}`, s.title);
    if (s.decision !== was.decision && s.decision === 'APPROVED') add('approved', s, `#${s.number} was approved`, `${names(s.by.APPROVED) || 'A reviewer'} approved ${s.title}`);
    if (s.decision !== was.decision && s.decision === 'CHANGES_REQUESTED') add('changes', s, `Changes asked on #${s.number}`, `${names(s.by.CHANGES_REQUESTED) || 'A reviewer'} asked for changes on ${s.title}`);
    if (Number.isFinite(was.open) && s.open > was.open) add('comments', s, `More unresolved review threads on #${s.number}`, `${s.title} now has ${s.open} unresolved review thread${s.open === 1 ? '' : 's'}.`);
  }
  return out;
}
// The page's button for each notice: it opens the PR in Your work, where its next step is.
const ACTION = { 'checks-failed': 'See what failed', 'checks-passed': 'Open it', approved: 'Open it', changes: 'See what they asked', comments: 'See the comments', merged: 'Open it', 'review-asked': 'Open it' };

module.exports = { snapshot, changes, stateOf, keyOf, ACTION };
