'use strict';
// A local review journal. A launched chat is never treated as proof of a successful check.
// Revisions are immutable: results for an earlier commit remain attached to that commit.
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const store = require('./store');
const KINDS = ['validate', 'review', 'cross-review', 'handoff', 'fix-comments', 'fix-checks', 'update'];
const fail = (status, message) => Object.assign(new Error(message), { status });
function target(repo, n) {
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(s => s === '.' || s === '..')) throw fail(400, 'Choose a GitHub repository.');
  if (!Number.isSafeInteger(Number(n)) || Number(n) < 1) throw fail(400, 'Choose a pull request number.');
  return { repo: repo.toLowerCase(), n: Number(n) };
}
const revision = head => {
  if (typeof head !== 'string' || !/^[a-f0-9]{40,64}$/i.test(head)) throw fail(400, 'Refresh the PR to read its revision.');
  return head.toLowerCase();
};
function resultFields(body) {
  if (!KINDS.includes(body.kind)) throw fail(400, 'Choose the kind of work recorded.');
  if (!['passed', 'failed', 'notes'].includes(body.outcome)) throw fail(400, 'Choose a result.');
  if (typeof body.notes !== 'string' || !body.notes.trim() || body.notes.length > 6000) throw fail(400, 'Add a note of up to 6,000 characters describing what was checked.');
  return { kind: body.kind, outcome: body.outcome, notes: body.notes.trim() };
}
function createPrRecords({ dataDir, log = () => {}, now = () => Date.now() }) {
  const dir = path.join(dataDir, 'pr-records');
  const fileFor = t => path.join(dir, createHash('sha256').update(`${t.repo}#${t.n}`).digest('hex') + '.json');
  function read(t) { const value = store.loadOwnJson(fileFor(t), { entries: [] }, log); return Array.isArray(value?.entries) ? value.entries : []; }
  function write(t, entries) { fs.mkdirSync(dir, { recursive: true }); store.writeJsonAtomic(fileFor(t), { ...t, entries }, { keepBackup: true }); }
  const list = (repo, n) => read(target(repo, n)).sort((a, b) => b.at - a.at);
  function append(t, entry) {
    const entries = read(t);
    if (entries.length >= 500) throw fail(409, 'This PR has 500 journal entries. Remove an unneeded entry before saving another.');
    write(t, [entry, ...entries]); return entry;
  }
  function started(pr, kind, chat) {
    const t = target(pr.repo, pr.number), head = revision(pr.headSha);
    if (!KINDS.includes(kind)) throw fail(400, 'Unknown PR action.');
    return append(t, { id: randomUUID(), head, kind, outcome: 'started', notes: '', at: now(),
      chat: { key: chat.key, sessionId: chat.sessionId || null, provider: chat.provider || 'claude' } });
  }
  // Only a new result needs a current-head read. Finishing an old record keeps its old head.
  async function save(body, currentHead) {
    const t = target(body.repo, body.n), head = revision(body.head), fields = resultFields(body);
    if (body.id) {
      const entries = read(t), index = entries.findIndex(e => e.id === body.id);
      if (index < 0) throw fail(404, 'That journal entry is no longer here. Refresh the PR.');
      if (entries[index].head !== head) throw fail(409, 'A result must stay with the revision it checked. Add a new result for the new revision.');
      entries[index] = { ...entries[index], ...fields, updatedAt: now() };
      write(t, entries); return entries[index];
    }
    if (revision(await currentHead(t)) !== head) throw fail(409, 'This PR has new commits. Refresh it before recording a result for the current revision.');
    return append(t, { id: randomUUID(), head, ...fields, at: now(), chat: null });
  }
  function bindSession(repo, n, id, sessionId) {
    const t = target(repo, n), entries = read(t), entry = entries.find(e => e.id === id);
    if (!entry?.chat || !sessionId || entry.chat.sessionId === sessionId) return;
    entry.chat.sessionId = sessionId; write(t, entries);
  }
  function remove(repo, n, id) {
    const t = target(repo, n), entries = read(t), rest = entries.filter(e => e.id !== id);
    if (entries.length === rest.length) throw fail(404, 'That journal entry is no longer here.');
    write(t, rest); return { ok: true };
  }
  return { list, started, save, bindSession, remove };
}
module.exports = { createPrRecords };
