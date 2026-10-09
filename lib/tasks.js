'use strict';
// Queued tasks: a prompt for a project, for Claude or Codex, that starts as a new chat when its time
// comes and an account has room. Kept in tasks.json; the server starts them (see server.js).

const crypto = require('crypto');

const ROOM = 5;               // an account needs at least this much of its limits left to start a task
const KEEP_DONE = 6 * 3600e3; // started and failed tasks stay listed this long

// How much of an account's usage is left (the tighter of its 5-hour and weekly limits), or null if unknown.
function leftOf(u) {
  const d = u && u.data;
  if (!d || !d.available) return null;
  const used = [d.fiveHour, d.week].filter(w => w && typeof w.used === 'number').map(w => w.used);
  return used.length ? Math.max(0, Math.round(100 - Math.max(...used))) : null;
}

// Checks a new task: { cwd, provider, accountId ('auto' or an id), prompt, when ('now' | 'at'), at }.
function validTask(t, { projectAt, accounts }) {
  const fail = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  const p = projectAt(t && t.cwd);
  if (!p) fail('Pick one of your projects.');
  if (!p.exists) fail(`The folder ${p.cwd} no longer exists.`);
  const provider = t.provider === 'codex' ? 'codex' : 'claude';
  const prompt = String(t.prompt || '').trim();
  if (!prompt) fail('Write what the task should do.');
  if (prompt.length > 20000) fail('That’s too long for one task (20,000 characters).');
  const accountId = provider === 'codex' ? 'codex' : t.accountId === 'auto' || !t.accountId ? 'auto' : String(t.accountId);
  if (provider === 'claude' && accountId !== 'auto' && !accounts.some(a => a.id === accountId)) fail('That account isn’t in the switcher.');
  const when = t.when === 'at' ? 'at' : 'now';
  const at = when === 'at' ? Date.parse(t.at) : null;
  if (when === 'at' && !(at > 0)) fail('Pick when it should start.');
  return {
    id: crypto.randomBytes(6).toString('hex'), cwd: p.cwd, folder: p.name, provider, accountId, prompt, when,
    at: at ? new Date(at).toISOString() : null, state: 'queued', createdAt: new Date().toISOString(),
  };
}

// The account a queued task can start on now, or null (and why not).
function readyAccount(t, { accounts, usage, now = Date.now() }) {
  if (t.state !== 'queued') return { account: null, why: null };
  if (t.when === 'at' && Date.parse(t.at) > now) return { account: null, why: 'time' };
  if (t.provider === 'codex') {
    const left = leftOf(usage.codex);
    return left !== null && left < ROOM ? { account: null, why: 'room' } : { account: { id: 'codex' }, why: null };
  }
  const usable = accounts.filter(a => a.usable && (t.accountId === 'auto' || a.id === t.accountId));
  if (!usable.length) return { account: null, why: 'account' };
  const withRoom = usable.map(a => ({ a, left: leftOf(usage[a.id]) })).filter(x => x.left === null || x.left >= ROOM);
  if (!withRoom.length) return { account: null, why: 'room' };
  withRoom.sort((x, y) => (y.left === null ? 50 : y.left) - (x.left === null ? 50 : x.left));
  return { account: withRoom[0].a, why: null };
}

// Started and failed tasks drop off the list after a while.
const tidy = (tasks, now = Date.now()) => tasks.filter(t => t.state === 'queued' || now - Date.parse(t.doneAt || t.createdAt) < KEEP_DONE);

module.exports = { validTask, readyAccount, leftOf, tidy, ROOM };
