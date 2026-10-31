'use strict';
// A stand-in for `codex app-server` (tests/fake-world.js): signed in, one model, threads kept in a file in its home.
// A message gets a reply; one with "write" in it makes a file, as a reply with a change does. Never touches the network.
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), readline = require('readline');

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0); }
if (args[0] !== 'app-server') { console.log('{}'); process.exit(0); }

const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'fake-threads.json');
let threads = {};
try { threads = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(threads)); };
const secs = () => Math.floor(Date.now() / 1000);
const out = o => process.stdout.write(`${JSON.stringify(o)}\n`);
const note = (method, params) => out({ method, params });
const threadView = t => ({ id: t.id, name: t.name || null, preview: t.preview || '', cwd: t.cwd, createdAt: t.createdAt, updatedAt: t.updatedAt, model: 'gpt-fake', source: 'appServer', status: { type: 'idle' } });
const newThread = cwd => { const t = { id: crypto.randomUUID(), cwd, createdAt: secs(), updatedAt: secs(), preview: '', turns: [] }; threads[t.id] = t; save(); return t; };

function turn(t, params) {
  const id = crypto.randomUUID();
  const text = (params.input || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  if (!t.preview) t.preview = text.slice(0, 200);
  const reply = `Fake Codex reply to: ${text.replace(/\s+/g, ' ').slice(-160)}`;
  const items = [{ id: crypto.randomUUID(), type: 'userMessage', content: [{ type: 'text', text }] }];
  setImmediate(() => {
    note('turn/started', { threadId: t.id, turn: { id, status: 'inProgress' } });
    if (/\bwrite\b/i.test(text)) {
      const target = path.join(t.cwd, 'codex-note.txt');
      try { fs.writeFileSync(target, 'written by the stand-in\n'); } catch { /* not there */ }
      const item = { id: crypto.randomUUID(), type: 'fileChange', status: 'completed', changes: [{ path: target, kind: { type: 'add' }, diff: '+written by the stand-in\n' }] };
      note('item/started', { threadId: t.id, turnId: id, item: { ...item, status: 'inProgress' } });
      note('item/completed', { threadId: t.id, turnId: id, item });
      items.push(item);
    }
    const msg = { id: crypto.randomUUID(), type: 'agentMessage', text: reply };
    note('item/started', { threadId: t.id, turnId: id, item: { ...msg, text: '' } });
    note('item/agentMessage/delta', { threadId: t.id, turnId: id, itemId: msg.id, delta: reply });
    note('item/completed', { threadId: t.id, turnId: id, item: msg });
    items.push(msg);
    t.turns.push({ id, status: 'completed', startedAt: secs(), completedAt: secs(), items });
    t.updatedAt = secs();
    save();
    note('turn/completed', { threadId: t.id, turn: { id, status: 'completed' } });
  });
  return { turn: { id, status: 'inProgress' } };
}

const answers = {
  initialize: () => ({ userAgent: 'fake-codex/9.9.9' }),
  'account/read': () => ({ account: { type: 'chatgpt', email: 'tester@example.com', planType: 'plus' }, requiresOpenaiAuth: true }),
  'account/rateLimits/read': () => ({ rateLimits: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: secs() + 3600 }, secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: secs() + 3 * 86400 } } }),
  'model/list': () => ({ data: [{ id: 'gpt-fake', model: 'gpt-fake', displayName: 'GPT-Fake', description: 'A stand-in', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'medium' }] }),
  'thread/list': () => ({ data: Object.values(threads).filter(t => t.preview).sort((a, b) => b.updatedAt - a.updatedAt).map(threadView), nextCursor: null }),
  'thread/turns/list': p => ({ data: (threads[p.threadId] ? threads[p.threadId].turns : []).slice().reverse().slice(0, p.limit || 12), nextCursor: null }),
  'thread/start': p => ({ thread: threadView(newThread(p.cwd)), model: 'gpt-fake', reasoningEffort: 'medium' }),
  'thread/resume': p => { const t = threads[p.threadId] || newThread(p.cwd); return { thread: threadView(t), model: 'gpt-fake', reasoningEffort: 'medium' }; },
  'thread/fork': p => { const from = threads[p.threadId], t = newThread(p.cwd); if (from) { t.turns = from.turns.slice(); t.preview = from.preview; } save(); return { thread: threadView(t), model: 'gpt-fake', reasoningEffort: 'medium' }; },
  'thread/name/set': p => { if (threads[p.threadId]) { threads[p.threadId].name = p.name; save(); } return {}; },
  'thread/archive': p => { delete threads[p.threadId]; save(); return {}; },
  'turn/start': p => { const t = threads[p.threadId]; if (!t) throw new Error('thread not loaded'); return turn(t, p); },
  'turn/steer': () => ({}),
};
readline.createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || !m.method) return;   // a notification, or an answer to something it asked
  try { out({ id: m.id, result: (answers[m.method] || (() => ({})))(m.params || {}) }); }
  catch (err) { out({ id: m.id, error: { code: -32000, message: err.message } }); }
}).on('close', () => process.exit(0));
