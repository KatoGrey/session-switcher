'use strict';
// What Codex's code review looks at, for a chat's folder.

const path = require('path');
const { execFile } = require('child_process');

// What a review should look at. In a git project: the uncommitted changes, else the last commit;
// a recheck (base given) looks at everything since the first review's starting point, so fixes and
// whatever wasn't fixed are both checked. Without git: the files the chat changed, as they are now.
const git = (cwd, args) => new Promise(res => execFile('git', ['-C', cwd, ...args], { timeout: 10000, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => res(err ? null : String(out))));
const SHA = /^[0-9a-f]{40}$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git's empty tree: "since the very beginning"
async function reviewTarget(cwd, files, base) {
  const inGit = ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])) || '').trim() === 'true';
  if (inGit && SHA.test(base || '')) {
    return {
      target: { type: 'custom', instructions: `Review every code change made since commit ${base}: run \`git diff ${base}\` to see them all (uncommitted changes and any commits since). Look for bugs, regressions, security problems and anything that doesn't do what it's meant to.` },
      what: base === EMPTY_TREE ? 'all the changes' : `the changes since ${base.slice(0, 7)}`, base,
    };
  }
  if (inGit) {
    const head = ((await git(cwd, ['rev-parse', 'HEAD'])) || '').trim();
    const status = await git(cwd, ['status', '--porcelain']);
    // If git couldn't answer (it timed out, say), that isn't "nothing changed": Codex looks for itself.
    if (status === null || status.trim()) return { target: { type: 'uncommittedChanges' }, what: 'your uncommitted changes', base: SHA.test(head) ? head : EMPTY_TREE };
    if (SHA.test(head)) {
      const parent = ((await git(cwd, ['rev-parse', 'HEAD^'])) || '').trim();
      return { target: { type: 'commit', sha: head, title: null }, what: `the last commit (${head.slice(0, 7)})`, base: SHA.test(parent) ? parent : EMPTY_TREE };
    }
  }
  const list = (Array.isArray(files) ? files : []).map(f => String(f || '').trim()).filter(Boolean).slice(0, 60);
  if (!list.length) throw Object.assign(new Error('There’s nothing to review yet: no uncommitted changes here, and this chat hasn’t changed any files.'), { status: 400 });
  return {
    target: { type: 'custom', instructions: `Review the recent changes to these files for bugs, regressions, security problems and anything that doesn't do what it's meant to. This folder has no git history, so read each file as it is now.\n\n${list.map(f => `- ${f}`).join('\n')}` },
    what: list.length === 1 ? path.basename(list[0]) : `${list.length} changed files`, base: null,
  };
}

// The same review target, written as instructions for an assistant reviewing in its own chat (Claude,
// who has no built-in reviewer).
function targetInstructions(t) {
  const x = t.target || {};
  if (x.type === 'custom') return x.instructions;
  if (x.type === 'uncommittedChanges') return 'Review the uncommitted changes in this project: run `git status` and `git diff HEAD` to see them. Look for bugs, regressions, security problems and anything that doesn\'t do what it\'s meant to.';
  if (x.type === 'commit') return `Review the last commit: run \`git show ${x.sha}\` to see it. Look for bugs, regressions, security problems and anything that doesn't do what it's meant to.`;
  return 'Review the recent changes in this project for bugs, regressions and security problems.';
}
const FINDINGS_FORMAT = 'Don\'t change any files. Reply with a short overall summary, then your findings as a JSON block exactly like this (an empty list if nothing is wrong; priority P0 = critical … P3 = minor):\n```json\n{"findings":[{"title":"…","body":"what is wrong and why","file":"path/from/project","start":12,"end":14,"priority":"P1"}]}\n```';
function reviewAsk(t, ask) {
  return `(Review) ${targetInstructions(t)}${ask ? `\n\nWhat was asked for: ${String(ask).slice(0, 600)}` : ''}\n\n${FINDINGS_FORMAT}`;
}
// Findings out of a reply written in that format: the last JSON block, checked; the rest is the summary.
function parseFindings(text) {
  const s = String(text || '');
  const blocks = [...s.matchAll(/```json\s*([\s\S]*?)```/g)];
  let findings = [];
  if (blocks.length) {
    try {
      const j = JSON.parse(blocks[blocks.length - 1][1]);
      findings = (Array.isArray(j) ? j : j.findings || []).filter(f => f && f.title).slice(0, 40).map(f => ({
        title: String(f.title).slice(0, 200), body: String(f.body || '').slice(0, 2000), file: f.file ? String(f.file).slice(0, 300) : null,
        start: Number.isFinite(+f.start) && +f.start > 0 ? Math.round(+f.start) : null, end: Number.isFinite(+f.end) && +f.end > 0 ? Math.round(+f.end) : null,
        priority: /^P[0-3]$/.test(f.priority) ? f.priority : null,
      }));
    } catch { /* not valid JSON: the summary alone */ }
  }
  const overall = (blocks.length ? s.slice(0, blocks[blocks.length - 1].index) : s).replace(/\(Review\)/g, '').trim().slice(0, 1500);
  return { overall, findings };
}
// Two reviews of the same changes, together: findings both made (same file, overlapping lines, or the
// same title) are marked 'both'; the rest keep who found them.
function mergeFindings(a, b) {
  const near = (x, y) => x.file && y.file && x.file.toLowerCase() === y.file.toLowerCase() && (x.start && y.start ? Math.abs(x.start - y.start) <= 4 : true);
  const same = (x, y) => near(x, y) || x.title.toLowerCase() === y.title.toLowerCase();
  const out = a.map(f => ({ ...f, by: 'codex' })), used = new Set();
  for (const f of b) {
    const i = out.findIndex((g, k) => !used.has(k) && g.by === 'codex' && same(g, f));
    if (i >= 0) { used.add(i); out[i] = { ...out[i], by: 'both', body: out[i].body || f.body }; } else out.push({ ...f, by: 'claude' });
  }
  const rank = f => (f.by === 'both' ? 0 : 1) * 10 + (f.priority ? +f.priority[1] : 4);
  return out.sort((x, y) => rank(x) - rank(y));
}

// A finding, written for Claude: what's wrong and where, with Codex's explanation. (The chat window
// uses the same wording for its "Ask Claude to fix" buttons.)
function findingText(f, n) {
  const where = f.file ? ` (${f.file}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `-${f.end}` : ''}` : ''})` : '';
  const body = f.body ? `\n${f.body.split('\n').map(l => `   ${l}`).join('\n')}` : '';
  return `${n ? `${n}. ` : ''}${f.priority ? `[${f.priority}] ` : ''}${f.title}${where}${body}`;
}
function fixText(what, list) {
  const one = list.length === 1;
  return `Codex reviewed ${what || 'the changes'} and found ${one ? 'this' : 'these'}:\n\n${list.map((f, i) => findingText(f, one ? 0 : i + 1)).join('\n\n')}\n\nPlease fix ${one ? 'it' : 'them'}. If you think a finding is wrong, say why instead of changing the code.`;
}

module.exports = { reviewTarget, fixText, reviewAsk, parseFindings, mergeFindings, EMPTY_TREE };
