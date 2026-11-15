'use strict';
// Queued tasks: a prompt for a project, for Claude, Codex or Gemini, that starts as a new chat (on the model
// and effort it was queued with, if any) when its time comes and an account has room. Kept in tasks.json;
// the server starts them (see server.js).
// Routines: a task that repeats (every day, every weekday or every week, at its time); each time it
// starts, the next one is queued.

const crypto = require('crypto');

const ROOM = 5;               // an account needs at least this much of its limits left to start a task
const KEEP_DONE = 6 * 3600e3; // started and failed tasks stay listed this long
// Only names that look like a model or an effort get through; the chat checks them against what the assistant offers.
const MODEL = /^[\w.:[\]-]{1,80}$/;
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

// How much of an account's usage is left (the tighter of its 5-hour and weekly limits), or null if unknown.
function leftOf(u) {
  const d = u && u.data;
  if (!d || !d.available) return null;
  const used = [d.fiveHour, d.week].filter(w => w && typeof w.used === 'number').map(w => w.used);
  return used.length ? Math.max(0, Math.round(100 - Math.max(...used))) : null;
}

// Checks a new task: { cwd, provider, accountId ('auto' or an id), model, effort, prompt, when ('now' | 'at'), at }.
// 'auto' is whichever account has the most room when it starts. codex: the Codex accounts ([{ id }]), and
// codexActive: the one new Codex chats run as (a Codex task that names none runs as it).
function validTask(t, { projectAt, accounts, codex = [], codexActive = 'codex' }) {
  const fail = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  const p = projectAt(t && t.cwd);
  if (!p) fail('Pick one of your projects.');
  if (!p.exists) fail(`The folder ${p.cwd} no longer exists.`);
  const provider = ['codex', 'gemini'].includes(t.provider) ? t.provider : 'claude';
  const prompt = String(t.prompt || '').trim();
  if (!prompt) fail('Write what the task should do.');
  if (prompt.length > 20000) fail('That’s too long for one task (20,000 characters).');
  const codexId = () => {
    if (t.accountId === 'auto') return 'auto';
    if (!t.accountId || !codex.length) return codexActive;
    if (!codex.some(a => a.id === t.accountId)) fail('That Codex account isn’t in the switcher.');
    return String(t.accountId);
  };
  const accountId = provider === 'gemini' ? 'gemini' : provider === 'codex' ? codexId() : t.accountId === 'auto' || !t.accountId ? 'auto' : String(t.accountId);
  if (provider === 'claude' && accountId !== 'auto' && !accounts.some(a => a.id === accountId)) fail('That account isn’t in the switcher.');
  // The model and effort it starts on (none: what that assistant used last in the project).
  const model = typeof t.model === 'string' && MODEL.test(t.model.trim()) ? t.model.trim() : null;
  const effort = EFFORTS.includes(t.effort) ? t.effort : null;
  const when = t.when === 'at' ? 'at' : 'now';
  const at = when === 'at' ? Date.parse(t.at) : null;
  if (when === 'at' && !(at > 0)) fail('Pick when it should start.');
  const repeat = REPEATS.includes(t.repeat) ? t.repeat : null;
  // "Do this later": the chat (and reply) it came from; its latest messages go along as background.
  const fr = t.from && typeof t.from === 'object' && /^[\w-]{8,80}$/.test(String(t.from.id || '')) ? { id: String(t.from.id), title: String(t.from.title || '').slice(0, 120), mid: String(t.from.mid || '').slice(0, 120) || null } : null;
  if (repeat && when !== 'at') fail('A routine needs a time to start at.');
  return {
    id: crypto.randomBytes(6).toString('hex'), cwd: p.cwd, folder: p.name, provider, accountId, model, effort, prompt, when,
    at: at ? new Date(at).toISOString() : null, state: 'queued', createdAt: new Date().toISOString(), repeat, from: fr,
  };
}

const REPEATS = ['daily', 'weekdays', 'weekly'];
// A routine's next time after `after` (the same time of day, on its next day).
function nextRun(at, repeat, after = Date.now()) {
  const d = new Date(at);
  const step = () => { d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1)); if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); };
  do step(); while (d.getTime() <= after);
  return d.toISOString();
}
// The routine's next run, queued, once this one has started (or failed).
function nextOf(t, now = Date.now()) {
  if (!t.repeat || !t.at) return null;
  // Started early ("Start now"): its own time is still to come, and stays the next run.
  const at = Date.parse(t.at) > now ? t.at : nextRun(t.at, t.repeat, now);
  return { ...t, id: crypto.randomBytes(6).toString('hex'), at, state: 'queued', key: null, accountName: null, doneAt: null, error: null, createdAt: new Date(now).toISOString() };
}

// The account a queued task can start on now, or null (and why not). codex: each Codex account ([{ id, name, kind,
// usable }], the one in use first), when the caller knows them; without them Codex counts as one account.
function readyAccount(t, { accounts, codex = null, usage, now = Date.now() }) {
  if (t.state !== 'queued') return { account: null, why: null };
  if (t.when === 'at' && Date.parse(t.at) > now) return { account: null, why: 'time' };
  if (t.provider === 'gemini') return { account: { id: 'gemini' }, why: null };   // its plan's room isn't known here
  if (t.provider === 'codex' && !(codex && codex.length)) {
    const left = leftOf(usage.codex);
    return left !== null && left < ROOM ? { account: null, why: 'room' } : { account: { id: 'codex' }, why: null };
  }
  // Codex's "whichever has the most room" keeps to one kind of account, ChatGPT or Ollama (their models differ): the
  // kind its model is for (Ollama's have a colon), else the kind of the one in use.
  const ollama = a => a.kind === 'ollama';
  const sameKind = t.provider !== 'codex' ? () => true : t.model ? a => ollama(a) === t.model.includes(':') : a => ollama(a) === ollama(codex[0]);
  // The account it names, or (auto) whichever has the most room; one whose usage isn't known counts as half full.
  const usable = (t.provider === 'codex' ? codex : accounts).filter(a => a.usable && (t.accountId === 'auto' ? sameKind(a) : a.id === t.accountId));
  if (!usable.length) return { account: null, why: 'account' };
  const withRoom = usable.map(a => ({ a, left: leftOf(usage[a.id]) })).filter(x => x.left === null || x.left >= ROOM);
  if (!withRoom.length) return { account: null, why: 'room' };
  withRoom.sort((x, y) => (y.left === null ? 50 : y.left) - (x.left === null ? 50 : x.left));
  return { account: withRoom[0].a, why: null };
}

// Started and failed tasks drop off the list after a while.
const tidy = (tasks, now = Date.now()) => tasks.filter(t => t.state === 'queued' || now - Date.parse(t.doneAt || t.createdAt) < KEEP_DONE);

module.exports = { validTask, readyAccount, leftOf, tidy, nextRun, nextOf, REPEATS, ROOM };
