'use strict';
// Your pull requests, watched: every few minutes the server reads them (lib/prs.js board) and compares them with last
// time. What changed on yours (checks failing or passing, an approval, changes asked for, new comments, merged by
// itself) and who asked for your review become notices: a notification, a line on the hub's welcome-back card, and on
// a paired phone. The first look only remembers how things are; nothing is said about what was already so.

// How a PR stands, in the few things that are compared. me: your GitHub login (a review asked of a team you're in,
// as CODEOWNERS do, isn't asked of you by name, so it isn't a notice).
function stateOf(p, me = null) {
  const c = p.checks || {};
  const failed = Array.isArray(c.failed) ? c.failed : [];
  return {
    repo: p.repo, number: p.number, title: String(p.title || '').slice(0, 200), url: p.url,
    mine: !!p.mine, author: p.author || null,
    review: (p.roles || []).includes('review') && (!me || (p.reviewers || []).some(r => String(r).toLowerCase() === String(me).toLowerCase())),
    checks: failed.length ? 'failed' : c.pending ? 'pending' : c.passed ? 'passed' : null,
    failed: failed.slice(0, 3).map(x => String(x.name || x).slice(0, 60)), failedN: failed.length,
    decision: p.reviewDecision || null,
    by: { APPROVED: (p.reviews || []).filter(r => r.state === 'APPROVED').map(r => r.author), CHANGES_REQUESTED: (p.reviews || []).filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.author) },
    open: Number(p.open) || 0, merged: !!p.mergedAt || /merged/i.test(p.state || ''), autoMerge: !!p.autoMerge,
  };
}
const keyOf = p => `${String(p.repo).toLowerCase()}#${p.number}`;
function snapshot(prs, me = null) {
  const out = {};
  for (const p of prs || []) if (p && p.repo && p.number) out[keyOf(p)] = stateOf(p, me);
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
    if (s.merged && !was.merged) { if (was.autoMerge) add('merged', s, `#${s.number} merged`, `${s.title} merged by itself once it was ready.`); continue; }
    if (s.checks === 'failed' && was.checks !== 'failed') add('checks-failed', s, `Checks failed on #${s.number}`, `${s.title} · ${s.failedN} failing${s.failed.length ? ` (${s.failed.join(', ')})` : ''}`);
    else if (s.checks === 'passed' && (was.checks === 'pending' || was.checks === 'failed')) add('checks-passed', s, `Checks passed on #${s.number}`, s.title);
    if (s.decision !== was.decision && s.decision === 'APPROVED') add('approved', s, `#${s.number} was approved`, `${names(s.by.APPROVED) || 'A reviewer'} approved ${s.title}`);
    if (s.decision !== was.decision && s.decision === 'CHANGES_REQUESTED') add('changes', s, `Changes asked on #${s.number}`, `${names(s.by.CHANGES_REQUESTED) || 'A reviewer'} asked for changes on ${s.title}`);
    if (s.open > was.open) { const n = s.open - was.open; add('comments', s, `${n} new review thread${n === 1 ? '' : 's'} on #${s.number}`, s.title); }
  }
  return out;
}
// The page's button for each notice: it opens the PR in Your work, where its next step is.
const ACTION = { 'checks-failed': 'See what failed', 'checks-passed': 'Open it', approved: 'Open it', changes: 'See what they asked', comments: 'See the comments', merged: 'Open it', 'review-asked': 'Open it' };

module.exports = { snapshot, changes, stateOf, keyOf, ACTION };
