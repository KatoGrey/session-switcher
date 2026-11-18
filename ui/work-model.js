'use strict';
// Keep GitHub's review decision, check results, and merge state separate.
const WorkModel = (() => {
  const key = p => `${String(p.repo).toLowerCase()}#${p.number}`;
  const canChangeHead = p => p.headRepo === undefined || Boolean(p.headRepo && p.repo && p.headRepo.toLowerCase() === p.repo.toLowerCase());
  const reviewStatus = p => ({ APPROVED: ['Approved', 'ok'], CHANGES_REQUESTED: ['Changes requested', 'warn'], REVIEW_REQUIRED: ['Review required', 'muted'] })[p.reviewDecision] || ['No decision reported', 'muted'];
  const checkCounts = (c = {}) => ({ passed: c.passed || 0, failed: (c.failed || []).length, pending: c.pending || 0, cancelled: c.cancelled || 0, skipped: c.skipped || 0 });
  const failedRollup = c => ['FAILURE', 'ERROR'].includes(c.state);
  function checkGate(c = {}) {
    const known = c.requirementsKnown === true;
    const totals = checkCounts(c);
    const required = c.required || {};
    const failed = required.failed || 0, pending = required.pending || 0;
    const unclassifiedFailure = !known && (totals.failed > 0 || totals.cancelled > 0 || failedRollup(c));
    const unclassifiedPending = !known && (totals.pending > 0 || c.state === 'PENDING' || c.state === 'EXPECTED');
    return { known, failed, pending, unclassifiedFailure, unclassifiedPending, blocked: c.complete === false || failed > 0 || pending > 0 || unclassifiedFailure || unclassifiedPending };
  }
  function threadStatus(p) {
    if (p.open == null) return ['Count unavailable', 'muted'];
    if (p.threadsComplete === false) return [p.open ? `${p.open}+ open` : 'Partial list', p.open ? 'warn' : 'muted'];
    return p.open ? [`${p.open} open`, 'warn'] : ['None open', 'ok'];
  }
  function mergeStatus(p) {
    if (p.state === 'MERGED') return ['Merged', 'ok'];
    if (p.state === 'CLOSED') return ['Closed', 'muted'];
    if (p.isDraft) return ['Draft', 'muted'];
    if (p.mergeQueue) return ['In merge queue', 'accent'];
    if (p.mergeable === 'CONFLICTING') return ['Conflicts to resolve', 'bad'];
    return ({ CLEAN: ['Mergeable', 'ok'], HAS_HOOKS: ['Mergeable · hooks apply', 'muted'], BLOCKED: ['Blocked', 'muted'], BEHIND: ['Behind base branch', 'muted'], DIRTY: ['Conflicts to resolve', 'bad'], UNSTABLE: ['Mergeable · checks need attention', 'warn'], DRAFT: ['Draft', 'muted'] })[p.mergeState] || ['Unknown', 'muted'];
  }
  function requiredChecksStatus(c, gate = checkGate(c)) {
    if (gate.failed) return [`${gate.failed} ${gate.failed === 1 ? 'needs' : 'need'} attention`, 'bad'];
    if (gate.pending) return [`${gate.pending} pending`, 'muted'];
    if (c.complete === false) return ['Partial check list', 'muted'];
    if (gate.known) return c.required?.passed ? [`${c.required.passed} reported satisfied`, 'ok'] : ['None among reported checks', 'muted'];
    return ['Requirements unavailable', 'muted'];
  }
  function status(p) {
    const c = p.checks || {}, gate = checkGate(c), totals = checkCounts(c);
    const result = (label, tone, action, attention = false) => ({ label, tone, action, attention });
    if (p.state === 'MERGED') return result('Merged', 'ok', null);
    if (p.state === 'CLOSED') return result('Closed', 'muted', null);
    if (p.mergeQueue) return result('In merge queue', 'accent', null);
    // A pending or optional check must not hide a requested human review.
    if ((p.roles || []).includes('review') && !p.mine) return result('Your review requested', 'accent', 'review', true);
    if (p.mergeState === 'DIRTY' || p.mergeable === 'CONFLICTING') return result('Resolve conflicts', 'bad', canChangeHead(p) ? 'update' : null, !!p.mine);
    if (p.mine && p.open) return result(`${p.open}${p.threadsComplete === false ? '+' : ''} open thread${p.open === 1 && p.threadsComplete !== false ? '' : 's'}`, 'warn', canChangeHead(p) ? 'fix-comments' : 'feedback', true);
    const canFixChecks = p.mine && canChangeHead(p);
    if (gate.failed) return result(`${gate.failed} required check${gate.failed === 1 ? ' needs' : 's need'} attention`, 'bad', canFixChecks && (c.failed || []).some(x => x.required === true) ? 'fix-checks' : 'checks', !!p.mine);
    if (gate.unclassifiedFailure) return result('Checks need attention', 'bad', canFixChecks && totals.failed ? 'fix-checks' : 'checks', !!p.mine);
    if (p.reviewDecision === 'CHANGES_REQUESTED') return result('Changes requested', 'warn', 'review', !!p.mine);
    if (p.isDraft) return result('Draft', 'muted', p.mine ? 'ready' : 'review');
    if (gate.pending) return result('Required checks pending', 'muted', 'review');
    if (gate.unclassifiedPending) return result('Checks pending', 'muted', 'review');
    if (c.complete === false || p.threadsComplete === false || p.partial) return result('PR details incomplete', 'muted', 'review');
    if (p.mergeState === 'BEHIND') return result('Branch behind base', 'muted', 'review');
    if (p.autoMerge) return result('Auto-merge on', 'ok', null);
    if (!p.open && !gate.blocked && p.reviewDecision !== 'REVIEW_REQUIRED' && p.mergeState === 'CLEAN') return result(p.mergeQueueEnabled ? 'Ready for merge queue' : 'Ready to merge', 'ok', p.mine ? 'merge' : 'review', !!p.mine);
    if (p.reviewDecision === 'REVIEW_REQUIRED') return result('Review required', 'muted', 'review');
    if (p.mergeState === 'BLOCKED') return result('Merge blocked', 'muted', 'checks');
    if (p.mergeState === 'HAS_HOOKS') return result('Mergeable · hooks apply', 'muted', 'checks');
    if (gate.known && (totals.failed || totals.cancelled)) return result('Optional checks need attention', 'warn', 'checks');
    if (p.reviewDecision === 'APPROVED') return result('Approved', 'ok', 'review');
    if (p.open) return result(`${p.open} open review thread${p.open === 1 ? '' : 's'}`, 'muted', 'review');
    if (p.reviewers?.length) return result('Review requested', 'muted', 'review');
    return result(p.state === 'OPEN' ? 'Open' : 'Status unavailable', 'muted', 'review');
  }
  function readiness(p) {
    return [
      ['Review decision', reviewStatus(p), 'overview'],
      ['Required checks', requiredChecksStatus(p.checks || {}), 'checks'],
      ['Review threads', threadStatus(p), 'threads'],
      ['GitHub merge state', mergeStatus(p), 'checks'],
    ].map(([title, [value, tone], tab]) => ({ title, value, tone, tab }));
  }
  const area = file => { const parts = String(file || '').split('/'); return parts.length < 2 ? 'Repository root' : parts.slice(0, Math.min(parts.length - 1, parts[0] === 'packages' ? 3 : parts[0] === 'projects' ? 2 : 1)).join('/'); };
  function group(data) {
    const prs = data.prs || [], issues = data.issues || [];
    const open = prs.filter(p => p.state === 'OPEN');
    const linked = i => open.some(p => p.issue === i.identifier || (i.prs || []).some(l => key(l) === key(p)));
    const available = issues.filter(i => !linked(i));
    const doing = available.filter(i => i.state?.type === 'started' || i.chat?.key || i.chat?.sessionId);
    const todo = available.filter(i => !doing.includes(i)).sort((a, b) => (a.priority || 5) - (b.priority || 5) || Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    return { todo, doing, review: open.filter(p => p.mine || (p.roles || []).includes('linked')), waiting: open.filter(p => !p.mine && !(p.roles || []).includes('linked')), merged: prs.filter(p => p.state === 'MERGED'), attention: open.filter(p => status(p).attention) };
  }
  return { key, status, group, readiness, area, canChangeHead, checkCounts, checkGate, reviewStatus, requiredChecksStatus, mergeStatus, threadStatus };
})();
if (typeof module !== 'undefined') module.exports = WorkModel;
