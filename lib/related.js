'use strict';
// What a chat belongs to: the Linear issue it was started for, the pull request it worked on, the other chats on
// the same piece of work, and what started it (a routine, a queued task). The chat side panel shows it, so a chat
// knows its work the way the work board already knows its chats.
//
// Only records count as fact: a chat started from an issue (work.json) or a PR action (the PR journal). A PR found
// only because a chat sat on its branch is a guess, and says so: a shared checkout's branch isn't proof that a
// particular chat made the PR.

const RUNS_KEPT = 20;   // per issue
const RUNS_SHOWN = 8;   // in the panel

// work.json's entry for an issue: { key, sessionId, at } before 6.13; { ..., runs: [...] } since. Newest first.
function runsOf(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const runs = Array.isArray(entry.runs) ? entry.runs : entry.key || entry.sessionId ? [{ key: entry.key || null, sessionId: entry.sessionId || null, at: entry.at || 0, role: 'start' }] : [];
  return runs.filter(r => r && (r.key || r.sessionId)).sort((a, b) => (b.at || 0) - (a.at || 0));
}

// A new chat on an issue joins its runs (rather than replacing the last one). The top-level fields stay the
// newest run's, for anything that still reads them.
function addRun(entry, run) {
  const was = runsOf(entry).filter(r => !(run.key && r.key === run.key) && !(run.sessionId && r.sessionId === run.sessionId));
  const runs = [run, ...was].slice(0, RUNS_KEPT);
  return { key: run.key || null, sessionId: run.sessionId || null, at: run.at, runs };
}

// The same chat, by either name: its key while it's running, its session id once it has one.
const same = (a, b) => !!a && !!b && ((a.key && b.key && a.key === b.key) || (a.sessionId && b.sessionId && a.sessionId === b.sessionId));

const CHANGE_ROLES = new Set(['fix-comments', 'fix-checks', 'update']);
function prChatLinks(entries, findChat) {
  let chat = null, resumeChat = null;
  for (const e of entries) {
    if (!e.chat) continue;
    const c = findChat(e.chat);
    if (!c) continue;
    chat ||= c;
    if (!resumeChat && c.sessionId && !c.key && c.provider === 'claude' && CHANGE_ROLES.has(e.kind)) resumeChat = c;
    if (chat && resumeChat) break;
  }
  return { chat, resumeChat };
}

// chat: { key, sessionId, cwd, branch }.
// board: the work board ({ issues, prs }), where each PR may carry cwds (the folders here with its repo).
// work: work.json ({ [issue]: entry }). records: the PR journal's entries for this chat ([{ repo, n, entry }]).
// journal(repo, n): that PR's journal entries. prChats(pr): the chats seen on its branch (best effort).
// origins: what started chats ([{ kind, id, name, key, sessionId }]).
function relatedFor({ chat, board = {}, work = {}, records = [], journal = () => [], prChats = () => [], origins = [] }) {
  const issues = board.issues || [], prs = board.prs || [];
  const norm = p => /^[a-z]:[\\/]|^\\\\/i.test(p || '') ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : String(p || '').replace(/\/+$/, '');
  const prKey = (repo, n) => `${String(repo).toLowerCase()}#${Number(n)}`;
  const prBy = new Map(prs.map(p => [prKey(p.repo, p.number), p]));

  // The issue: one this chat was started for.
  let issueId = null, issueRun = null;
  for (const [id, entry] of Object.entries(work)) {
    const r = runsOf(entry).find(x => same(x, chat));
    if (r) { issueId = id; issueRun = r; break; }
  }
  // The PR, from the surest record down: one whose journal has this chat; the one linked to its issue in Linear;
  // else (a guess) one whose branch this chat is on, in a folder with its repo.
  let pr = null, prGuess = false, prRole = null;
  const rec = records[0];
  if (rec) { pr = prBy.get(prKey(rec.repo, rec.n)) || { repo: rec.repo, number: rec.n }; prRole = rec.entry && rec.entry.kind; }
  let issue = issueId ? issues.find(i => i.identifier === issueId) || { identifier: issueId } : null;
  if (!pr && issue && Array.isArray(issue.prs) && issue.prs.length) {
    const linked = issue.prs.map(l => prBy.get(prKey(l.repo, l.number)) || { repo: l.repo, number: l.number, title: l.title, url: l.url, state: l.state });
    pr = linked.find(p => !p.state || /open/i.test(p.state)) || linked[0];
  }
  if (!pr && chat.cwd && chat.branch && !/^(main|master|develop|trunk|HEAD)$/i.test(chat.branch)) {
    const here = norm(chat.cwd);
    const inside = c => c && (here === norm(c) || here.startsWith(`${norm(c)}/`));
    const matching = prs.filter(p => p.head === chat.branch && p.state !== 'MERGED' && p.state !== 'CLOSED' && (p.headRepo === undefined || (p.headRepo && p.headRepo.toLowerCase() === p.repo.toLowerCase())) && (p.cwds || []).some(inside));
    if (matching.length === 1) pr = matching[0];
    prGuess = !!pr;
  }
  // A PR leads to its issue.
  if (!issue && pr && pr.issue) issue = issues.find(i => i.identifier === pr.issue) || { identifier: pr.issue };

  // The other chats on this work: the issue's runs, the PR journal's chats, and (guesses) the chats on its branch.
  const runs = [];
  const add = (r, how) => { if (!r || same(r, chat) || runs.some(x => same(x, r))) return; runs.push({ ...r, how }); };
  if (issue) for (const r of runsOf(work[issue.identifier])) add({ key: r.key || null, sessionId: r.sessionId || null, at: r.at || 0, role: r.role || 'start', provider: r.provider || null }, 'issue');
  if (pr) {
    for (const e of journal(pr.repo, pr.number) || []) if (e.chat) add({ key: e.chat.key || null, sessionId: e.chat.sessionId || null, at: e.at || 0, role: e.kind, provider: e.chat.provider || null }, 'pr');
    for (const c of prChats(pr) || []) add({ key: null, sessionId: c.id || c.sessionId || null, at: c.updated || 0, role: null, provider: c.provider || null, title: c.title || null }, 'branch');
  }
  runs.sort((a, b) => (b.at || 0) - (a.at || 0));

  const origin = origins.find(o => same(o, chat)) || null;
  const role = (issueRun && issueRun.role) || prRole || null;
  if (!issue && !pr && !runs.length && !origin) return { none: true, branch: chat.branch || null };
  return {
    branch: chat.branch || null,
    role,
    issue: issue && { identifier: issue.identifier, title: issue.title || null, state: issue.state || null, url: issue.url || null },
    pr: pr && { repo: pr.repo, number: pr.number, title: pr.title || null, url: pr.url || null, state: pr.state || null, draft: !!(pr.isDraft || pr.draft), head: pr.head || null,
      checks: checksLine(pr.checks), review: pr.reviewDecision || null, guess: prGuess },
    runs: runs.slice(0, RUNS_SHOWN),
    more: Math.max(0, runs.length - RUNS_SHOWN),
    origin: origin && { kind: origin.kind, id: origin.id, name: origin.name || null },
  };
}

// A PR's checks, as much as the panel needs: how many passed, failed and are still running.
function checksLine(c) {
  if (!c || typeof c !== 'object') return null;
  const failed = Array.isArray(c.failed) ? c.failed.length : Number(c.failed) || 0;
  return { state: c.state || null, passed: Number(c.passed) || 0, failed, pending: Number(c.pending) || 0,
    ...(c.cancelled ? { cancelled: Number(c.cancelled) || 0 } : {}), ...(c.complete === false ? { complete: false } : {}) };
}

module.exports = { runsOf, addRun, relatedFor, prChatLinks, RUNS_KEPT };
