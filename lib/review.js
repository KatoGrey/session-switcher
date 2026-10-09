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

module.exports = { reviewTarget, EMPTY_TREE };
