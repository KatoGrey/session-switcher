'use strict';
// Shared by the workspace and its checks. GitHub's merge state is authoritative;
// an approval alone doesn't mean a PR can merge.
const WorkModel = (() => {
  const key = p => `${String(p.repo).toLowerCase()}#${p.number}`;
  function checkGate(c = {}) {
    const known = c.requirementsKnown === true;
    const failed = known ? c.required?.failed || 0 : (c.failed || []).length + (c.cancelled || 0);
    const pending = known ? c.required?.pending || 0 : c.pending || 0;
    return { known, failed, pending, blocked: c.complete === false || failed > 0 || pending > 0 || (!known && ['FAILURE', 'ERROR', 'PENDING'].includes(c.state)) };
  }
  function status(p) {
    const c = p.checks || {}, gate = checkGate(c), failed = (c.failed || []).length;
    const result = (label, tone, action, attention = false) => ({ label, tone, action, attention });
    if (p.state === 'MERGED') return result('Merged', 'ok', null);
    if (p.state === 'CLOSED') return result('Closed', 'muted', null);
    // A pending or optional check must not hide a requested human review.
    if ((p.roles || []).includes('review') && !p.mine) return result('Your review requested', 'accent', 'review', true);
    if (p.mergeState === 'DIRTY' || p.mergeable === 'CONFLICTING') return result('Resolve conflicts', 'bad', 'update', !!p.mine);
    if (p.mine && p.open) return result(`${p.open} open thread${p.open === 1 ? '' : 's'}`, 'warn', 'fix-comments', true);
    if (gate.failed || (!gate.known && ['FAILURE', 'ERROR'].includes(c.state))) return result(gate.failed ? `${gate.failed} ${gate.known ? 'required ' : ''}check${gate.failed === 1 ? ' needs' : 's need'} attention` : 'Checks failing', 'bad', p.mine ? 'fix-checks' : 'review', !!p.mine);
    if (p.reviewDecision === 'CHANGES_REQUESTED') return result('Changes requested', 'warn', 'review', !!p.mine);
    if (p.isDraft) return result('Draft', 'muted', p.mine ? 'ready' : 'review');
    if (gate.pending || (!gate.known && c.state === 'PENDING')) return result('Checks running', 'muted', 'review');
    if (c.complete === false || p.threadsComplete === false) return result('More checks or threads to inspect', 'muted', 'review');
    if (p.mergeState === 'BEHIND') return result('Branch behind base', 'muted', 'review');
    if (p.autoMerge) return result('Auto-merge on', 'ok', null);
    if (p.reviewDecision === 'APPROVED' && !p.open && !gate.blocked && ['CLEAN', 'HAS_HOOKS'].includes(p.mergeState)) return result('Ready to merge', 'ok', p.mine ? 'merge' : 'review', !!p.mine);
    if (gate.known && (failed || c.cancelled)) return result('Optional checks need attention', 'warn', p.mine ? 'validate' : 'review');
    if (p.reviewDecision === 'APPROVED') return result('Approved · awaiting requirements', 'muted', 'review');
    if (p.open) return result(`${p.open} open review thread${p.open === 1 ? '' : 's'}`, 'muted', 'review');
    return result('Awaiting review', 'muted', 'review');
  }
  function readiness(p) {
    const c = p.checks || {}, gate = checkGate(c);
    const review = p.reviewDecision === 'APPROVED' ? ['Approved', 'ok'] : p.reviewDecision === 'CHANGES_REQUESTED' ? ['Changes requested', 'warn'] : ['Awaiting approval', 'muted'];
    const checks = gate.failed ? [`${gate.failed} need attention`, 'bad'] : gate.pending ? [`${gate.pending} running`, 'muted'] : c.complete === false ? ['More checks on GitHub', 'muted'] : gate.known && c.required ? [`${c.required.passed} satisfied`, 'ok'] : [gate.known ? 'None reported' : 'Open checks for requirements', 'muted'];
    const merge = ({ CLEAN: ['Clear', 'ok'], HAS_HOOKS: ['Hooks pending', 'muted'], BLOCKED: ['Requirements outstanding', 'muted'], BEHIND: ['Behind base branch', 'muted'], DIRTY: ['Conflicts to resolve', 'bad'], UNSTABLE: ['Check results need attention', 'warn'] })[p.mergeState] || ['Still calculating', 'muted'];
    return [
      { title: 'Review', value: p.isDraft ? 'Draft' : review[0], tone: p.isDraft ? 'muted' : review[1], tab: 'overview' },
      { title: 'Required checks', value: checks[0], tone: checks[1], tab: 'checks' },
      { title: 'Threads', value: p.threadsComplete === false ? `${p.open || 0}+ open · more on GitHub` : p.open ? `${p.open} open` : 'All resolved', tone: p.open ? 'warn' : p.threadsComplete === false ? 'muted' : 'ok', tab: 'threads' },
      { title: 'GitHub merge state', value: merge[0], tone: merge[1], tab: 'checks' },
    ];
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
  return { key, status, group, readiness, area, checkGate };
})();
if (typeof module !== 'undefined') module.exports = WorkModel;
