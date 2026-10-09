'use strict';
// Routines: chats that start on their own. A routine runs on a schedule (every day at a time,
// weekdays, every few hours or minutes, or a cron line), or when a watched source has something new
// (a Slack channel, or new lines from a command you already have). Runs go through the app's own
// chat engines, so they show on the hub like any chat, and each run is written down in the
// routine's history.
//
// Nothing here ever posts anywhere. Sources are only read, and every run's first message tells the
// chat to write messages as drafts.
//
// The server passes in what this needs (startChat, nameChat, usageFor, accountInfo, prompts), so
// this file stays self-contained. create() is the way in for anything else that wants to make one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const store = require('./store');

const HISTORY_MAX = 40;
const SEEN_MAX = 2000;
const QUEUE_MAX = 50;
const PER_HOUR = 6;            // a watcher starts at most this many chats an hour
const LATE_MS = 5 * 60 * 1000; // a run this far past its time ran late (the Mac slept, or the app was closed)
const TICK_MS = 15 * 1000;
const RUN_WATCH_MS = 3 * 60 * 60 * 1000; // stop following a run's chat after this long
// The app stops a chat nobody has looked at 30 minutes after it goes quiet, which would take a finished
// run off the hub before you've seen it. A run's chat stays open this long (at most WARM_MAX of them).
const WARM_MS = 6 * 60 * 60 * 1000;
const WARM_MAX = 8;
const KEYCHAIN_SERVICE = 'Session Switcher';
const NO_SEND = 'Don’t post, send or reply on Slack, Discord, email or anywhere else. If a message is needed, write it here as a draft; I’ll send it myself.';

const one = (s, n = 220) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const pad = n => String(n).padStart(2, '0');
const clock = (h, m) => new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dateTag = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/* ---------- schedules ---------- */

// Five-field cron: minute hour day-of-month month day-of-week, with *, */n, a-b, a-b/n and lists.
const CRON_FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) throw bad('A cron line has five parts: minute, hour, day of month, month and day of week. For example “0 9 * * 1-5”.');
  const sets = parts.map((p, i) => {
    const [lo, hi] = CRON_FIELDS[i];
    const out = new Set();
    for (const piece of p.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(piece);
      if (!m) throw bad(`“${piece}” isn’t something cron understands.`);
      const step = m[4] ? Number(m[4]) : 1;
      let a = m[1] === '*' ? lo : Number(m[2]);
      let b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : (m[4] ? hi : a);
      if (a < lo || b > hi || a > b || step < 1) throw bad(`“${piece}” is out of range (${lo}–${hi}).`);
      for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v);
    }
    return out;
  });
  return { min: sets[0], hour: sets[1], dom: sets[2], mon: sets[3], dow: sets[4], domAll: parts[2] === '*', dowAll: parts[4] === '*' };
}
function cronDay(c, d) {
  if (c.domAll && c.dowAll) return true;
  if (c.domAll) return c.dow.has(d.getDay());
  if (c.dowAll) return c.dom.has(d.getDate());
  return c.dom.has(d.getDate()) || c.dow.has(d.getDay());
}
function cronNext(c, from) {
  const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  const limit = from + 5 * 366 * 864e5; // far enough for 29 February
  while (d.getTime() < limit) {
    if (!c.mon.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!cronDay(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!c.min.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    return d.getTime();
  }
  return null;
}

// The first time after `from` this schedule says to run.
function nextRun(s, from) {
  if (s.kind === 'every') return from + s.every * (s.unit === 'hours' ? 3600e3 : 60e3);
  if (s.kind === 'cron') return cronNext(parseCron(s.cron), from);
  const [h, m] = s.time.split(':').map(Number);
  const d = new Date(from); d.setHours(h, m, 0, 0);
  for (let i = 0; i < 9; i++) {
    if (d.getTime() > from && (s.kind !== 'weekdays' || (d.getDay() > 0 && d.getDay() < 6))) return d.getTime();
    d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0);
  }
  return null;
}

function describeSchedule(s) {
  if (s.kind === 'every') return s.every === 1 ? `Every ${s.unit === 'hours' ? 'hour' : 'minute'}` : `Every ${s.every} ${s.unit}`;
  if (s.kind === 'cron') return `Cron: ${s.cron}`;
  const [h, m] = s.time.split(':').map(Number);
  return `${s.kind === 'weekdays' ? 'Weekdays' : 'Every day'} at ${clock(h, m)}`;
}

/* ---------- secrets (macOS Keychain) ---------- */

// Tokens live in the login Keychain as “Session Switcher” items, never in the routines file.
// Elsewhere (no Keychain) they come from an environment variable, like SWITCHER_SLACK_TOKEN.
const IS_MAC = process.platform === 'darwin';
function readSecret(name) {
  if (!IS_MAC) return Promise.resolve(process.env[`SWITCHER_${name.toUpperCase()}_TOKEN`] || null);
  return new Promise(resolve => {
    cp.execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'], { timeout: 15000 }, (err, out) => resolve(err ? null : String(out).trim() || null));
  });
}
// The value goes to `security` on its standard input (its -i mode), so it never shows in a process list.
function writeSecret(name, value) {
  if (!IS_MAC) return Promise.reject(bad(`Set SWITCHER_${name.toUpperCase()}_TOKEN before starting the app instead.`));
  const line = value
    ? `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a ${name} -l "${KEYCHAIN_SERVICE} (${name})" -w ${value}\n`
    : `delete-generic-password -s "${KEYCHAIN_SERVICE}" -a ${name}\n`;
  return new Promise((resolve, reject) => {
    const p = cp.spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('exit', code => (code === 0 && !/error|could not/i.test(err) ? resolve() : value || !/could not be found/i.test(err) ? reject(new Error('The Keychain didn’t take it. Is the login Keychain unlocked?')) : resolve()));
    p.stdin.end(line);
  });
}

/* ---------- sources ---------- */

// Each source reads what's new. check(src, st, ctx) returns { items: [{ id, text, link, who }], st }.
// The first check only notes what's already there, so turning a watcher on doesn't start a chat for
// every old post.
const SOURCES = {
  slack: {
    label: src => `Slack channel ${src.channelName ? `#${src.channelName}` : src.channel}`,
    async check(src, st) {
      const token = await readSecret('slack');
      if (!token) throw new Error('Add a Slack token first (Edit → Slack token).');
      const call = async (method, params) => {
        const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
        const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
        if (!j.ok) throw new Error(SLACK_ERRORS[j.error] || `Slack said “${j.error}”.`);
        return j;
      };
      if (!st.channelName) { try { st.channelName = (await call('conversations.info', { channel: src.channel })).channel.name; } catch { /* needs channels:read; the id will do */ } }
      if (!st.cursor) {
        const j = await call('conversations.history', { channel: src.channel, limit: '1' });
        st.cursor = (j.messages && j.messages[0] && j.messages[0].ts) || String(Date.now() / 1000);
        return { items: [], st };
      }
      const j = await call('conversations.history', { channel: src.channel, oldest: st.cursor, limit: '100' });
      const msgs = (j.messages || []).filter(m => Number(m.ts) > Number(st.cursor)).sort((a, b) => Number(a.ts) - Number(b.ts));
      if (msgs.length) st.cursor = msgs[msgs.length - 1].ts;
      const want = textFilter(src.filter);
      const items = [];
      for (const m of msgs) {
        if (m.thread_ts && m.thread_ts !== m.ts) continue;                  // replies in a thread
        if (m.subtype && !['bot_message', 'file_share'].includes(m.subtype)) continue; // joins, edits, broadcasts
        const text = [m.text || '', ...(m.files || []).map(f => `[file: ${f.name || f.title || 'attachment'}]`), ...(m.attachments || []).map(a => a.fallback || a.text || '')].filter(Boolean).join('\n');
        if (!want(text)) continue;
        let link = null;
        try { link = (await call('chat.getPermalink', { channel: src.channel, message_ts: m.ts })).permalink; } catch { /* no link, then */ }
        items.push({ id: m.ts, text, link, who: m.user_profile ? m.user_profile.real_name : m.username || m.user || null });
      }
      return { items, st };
    },
  },
  command: {
    label: src => `the command “${one(src.command, 60)}”`,
    async check(src, st, ctx) {
      const out = await runCommand(src.command, ctx.cwd);
      const want = textFilter(src.filter);
      const items = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(lineItem).filter(x => want(x.text));
      if (!st.seeded) { st.seeded = true; return { items: [], seed: items.map(x => x.id), st }; }
      return { items, st };
    },
  },
};
const SLACK_ERRORS = {
  invalid_auth: 'Slack didn’t accept the token. Check it, then save it again.',
  not_authed: 'Slack didn’t get a token. Save it again.',
  account_inactive: 'That Slack token’s app or user is no longer active.',
  token_revoked: 'That Slack token was revoked. Make a new one.',
  channel_not_found: 'Slack can’t find that channel. Check its ID, and invite the app to it (/invite @your-app).',
  not_in_channel: 'The app isn’t in that channel yet. In Slack, type /invite @your-app in the channel.',
  missing_scope: 'The Slack token needs the channels:history scope (and groups:history for a private channel).',
  ratelimited: 'Slack asked us to slow down. It will try again next time.',
};
// “bug” matches anything containing bug; /bug|crash/i is a regular expression.
function textFilter(f) {
  const s = String(f || '').trim();
  if (!s) return () => true;
  const m = /^\/(.+)\/([a-z]*)$/.exec(s);
  if (m) { try { const re = new RegExp(m[1], m[2]); return t => re.test(t); } catch { /* treat it as text */ } }
  return t => t.toLowerCase().includes(s.toLowerCase());
}
// A line of output is one item. A JSON line can say { id, text, link }; otherwise the line is the text,
// its first URL is the link, and the line itself is the id.
function lineItem(line) {
  if (line[0] === '{') {
    try {
      const o = JSON.parse(line);
      const text = String(o.text || o.title || o.content || o.message || line);
      return { id: String(o.id ?? hashOf(line)), text, link: o.link || o.url || null, who: o.who || o.author || null };
    } catch { /* plain text */ }
  }
  const url = /https?:\/\/\S+/.exec(line);
  return { id: hashOf(line), text: line, link: url ? url[0] : null, who: null };
}
const hashOf = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : ['/bin/sh', ['-c', command]];
    cp.execFile(shell[0], shell[1], { cwd, timeout: 90000, maxBuffer: 2 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.killed ? 'The command took longer than 90 seconds.' : `The command failed: ${one(stderr || err.message, 240)}`));
      resolve(String(stdout));
    });
  });
}

/* ---------- starter templates ---------- */

const TEMPLATES = [
  {
    id: 'qa-triage', name: 'Community QA bug triage',
    blurb: 'When Community QA posts in a Slack channel, read the post, check whether the bug is verified, list open questions and draft a reply.',
    trigger: { type: 'watch', source: { type: 'slack', channel: '', filter: '', every: 2 } },
    permissionMode: 'default', chat: { mode: 'new' },
    prompt: 'A new post just came in from Community QA (it’s below). Please:\n\n1. Read it closely. If you can open the link, look at any screenshots and replies too.\n2. Say whether the bug is verified: has someone on the team or another tester reproduced it, or is there a clear way to reproduce it? Check this project’s code, issues or logs if that helps confirm it.\n3. List the open questions we’d need answered (steps, device and build, expected versus actual, logs).\n4. Draft a short, friendly reply to the poster that thanks them and asks those questions.\n\nEnd with a one-line verdict: Verified, Not yet verified, or Needs info.',
  },
  {
    id: 'discord-bugs', name: 'New Discord bug reports',
    blurb: 'Runs a command you already have (a bot, a CLI or a database query) and starts a chat for each new bug it prints.',
    trigger: { type: 'watch', source: { type: 'command', command: '', filter: '', every: 5 } },
    permissionMode: 'default', chat: { mode: 'new' },
    prompt: 'A new bug report came in from Discord (it’s below). Find where in {project} this happens, explain the likely cause, and propose a fix. Don’t change any files yet: describe the fix and wait for my OK.',
  },
  {
    id: 'morning', name: 'Morning check',
    blurb: 'Every weekday morning, look over a project and say what needs attention today.',
    trigger: { type: 'schedule', schedule: { kind: 'weekdays', time: '09:00' } },
    permissionMode: 'plan', chat: { mode: 'new' },
    prompt: 'Good morning. Look over {project} as of {date}: recent commits, open TODOs and anything that looks broken. Give me a short list of what needs attention today, most important first.',
  },
];

/* ---------- the routines ---------- */

function createRoutines({ dataDir, log = () => {}, broadcast = () => {}, accountInfo, startChat, nameChat = () => {}, usageFor = async () => null, prompts = () => [] }) {
  const file = path.join(dataDir, 'routines.json');
  const saved = store.loadOwnJson(file, { routines: [] }, log);
  const list = Array.isArray(saved.routines) ? saved.routines : [];
  const runs = new Map(); // run id -> { routine id, chat, sentAt } for runs being followed
  const warm = new Map(); // chat key -> { chat, until }: finished runs kept open until you see them
  let timer = null, saveTimer = null, ticking = false;

  for (const r of list) { r.history = r.history || []; r.state = r.state || {}; for (const h of r.history) if (['starting', 'working'].includes(h.status)) Object.assign(h, { status: 'stopped', line: 'Session Switcher closed before this run finished.' }); }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
  }
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    try { store.writeJsonAtomic(file, { routines: list }, { keepBackup: true }); } catch (err) { log(`Routines: couldn’t save (${err.message})`); }
    broadcast('routines', {});
  }
  const byId = id => { const r = list.find(x => x.id === id); if (!r) throw Object.assign(new Error('That routine isn’t there any more.'), { status: 404 }); return r; };

  /* ----- checking what's asked for ----- */

  function clean(input, old) {
    const name = one(input.name, 80);
    if (!name) throw bad('Give the routine a name.');
    const cwd = String(input.cwd || '').trim();
    if (!cwd || !path.isAbsolute(cwd)) throw bad('Choose the folder it works in.');
    let st = null; try { st = fs.statSync(cwd); } catch { /* checked below */ }
    if (!st || !st.isDirectory()) throw bad(`The folder ${cwd} doesn’t exist.`);
    const acct = accountInfo(String(input.account || ''));
    if (!acct) throw bad('Choose which account runs it.');
    const prompt = String(input.prompt || '').slice(0, 20000);
    const promptId = input.promptId ? String(input.promptId) : null;
    if (!prompt.trim() && !(promptId && prompts().some(p => p.id === promptId))) throw bad('Write what it should do (or pick a saved prompt).');
    const permissionMode = acct.modes.includes(input.permissionMode) ? input.permissionMode : acct.modes[0];
    const model = input.model && /^[\w.:\[\]-]{1,80}$/.test(input.model) ? input.model : null;
    const chatMode = input.chat && input.chat.mode === 'continue' ? 'continue' : 'new';
    const chat = { mode: chatMode, sessionId: chatMode === 'continue' && input.chat.sessionId ? String(input.chat.sessionId).slice(0, 80) : null };
    if (chat.mode === 'continue' && old && old.chat && old.chat.mode === 'continue' && !input.chat.sessionId && old.account === input.account) chat.sessionId = old.chat.sessionId;
    const limit = Math.max(50, Math.min(100, Math.round(Number(input.limit) || 90)));
    const t = input.trigger || {};
    let trigger;
    if (t.type === 'watch') {
      const s = t.source || {};
      const every = Math.max(1, Math.min(1440, Math.round(Number(s.every) || 5)));
      const filter = String(s.filter || '').slice(0, 200);
      if (s.type === 'slack') {
        const channel = String(s.channel || '').trim().toUpperCase();
        if (!/^[CGD][A-Z0-9]{6,}$/.test(channel)) throw bad('Enter the Slack channel’s ID, like C0123ABCD (in Slack: the channel’s name → About, at the bottom).');
        trigger = { type: 'watch', source: { type: 'slack', channel, filter, every } };
      } else if (s.type === 'command') {
        const command = String(s.command || '').trim();
        if (!command) throw bad('Enter the command to run.');
        if (command.length > 2000) throw bad('That command is too long.');
        trigger = { type: 'watch', source: { type: 'command', command, filter, every } };
      } else throw bad('Choose what to watch.');
    } else {
      const s = t.schedule || {};
      if (['daily', 'weekdays'].includes(s.kind)) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(s.time || ''));
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw bad('Enter a time like 9:00 or 17:30.');
        trigger = { type: 'schedule', schedule: { kind: s.kind, time: `${pad(Number(m[1]))}:${m[2]}` } };
      } else if (s.kind === 'every') {
        const unit = s.unit === 'minutes' ? 'minutes' : 'hours';
        const every = Math.round(Number(s.every));
        if (!(every >= 1 && every <= (unit === 'hours' ? 168 : 1440))) throw bad(unit === 'hours' ? 'Run every 1 to 168 hours.' : 'Run every 1 to 1440 minutes.');
        trigger = { type: 'schedule', schedule: { kind: 'every', every, unit } };
      } else if (s.kind === 'cron') {
        const cron = String(s.cron || '').trim().replace(/\s+/g, ' ');
        if (cronNext(parseCron(cron), Date.now()) === null) throw bad('That cron line never comes round.');
        trigger = { type: 'schedule', schedule: { kind: 'cron', cron } };
      } else throw bad('Choose when it runs.');
    }
    return { name, cwd, account: acct.id, provider: acct.provider, prompt, promptId, permissionMode, model, chat, limit, trigger };
  }

  // What it does next: its next run time, or its next look at the source.
  function plan(r, from = Date.now()) {
    if (r.trigger.type === 'schedule') { r.state.nextAt = nextRun(r.trigger.schedule, from); r.state.checkAt = null; }
    else { r.state.nextAt = null; r.state.checkAt = r.state.checkAt && r.state.checkAt > from ? r.state.checkAt : from + 2000; }
  }

  function create(input) {
    const r = { id: crypto.randomBytes(6).toString('hex'), ...clean(input), enabled: input.enabled !== false, created: Date.now(), history: [], state: {}, watch: {} };
    plan(r);
    list.push(r);
    log(`Routine added: ${r.name} (${triggerText(r)})`);
    save();
    return view(r);
  }
  function update(id, input) {
    const r = byId(id);
    const next = clean(input, r);
    const sourceChanged = JSON.stringify(r.trigger) !== JSON.stringify(next.trigger) || r.cwd !== next.cwd;
    Object.assign(r, next);
    if (sourceChanged) { r.watch = {}; r.state.checkAt = null; plan(r); }
    save();
    return view(r);
  }
  function remove(id) {
    const r = byId(id);
    list.splice(list.indexOf(r), 1);
    log(`Routine removed: ${r.name}`);
    save();
  }
  function pause(id, paused) {
    const r = byId(id);
    r.enabled = !paused;
    // Coming back, it starts from now rather than catching up on what it missed while paused: a
    // schedule waits for its next time, and a watcher's next look only notes what's there.
    if (r.enabled) {
      r.state.checkAt = null; r.state.retryAt = null;
      if (r.trigger.type === 'watch') r.watch = { seen: r.watch.seen || [], channelName: r.watch.channelName };
      plan(r);
    }
    save();
    return view(r);
  }

  /* ----- what the page shows ----- */

  function triggerText(r) {
    if (r.trigger.type === 'schedule') return describeSchedule(r.trigger.schedule);
    const s = r.trigger.source;
    const what = s.type === 'slack' ? `New posts in ${r.watch.channelName ? `#${r.watch.channelName}` : s.channel}` : 'New lines from a command';
    return `${what}${s.filter ? ` matching “${s.filter}”` : ''}, checked every ${s.every === 1 ? 'minute' : `${s.every} minutes`}`;
  }
  function view(r) {
    const { watch, ...rest } = r;
    return { ...rest, triggerText: triggerText(r), queue: (watch.queue || []).length, watchError: watch.error || null, lastCheck: watch.lastCheck || null, channelName: watch.channelName || null, running: [...runs.values()].some(x => x.routine === r.id) };
  }
  const listView = () => list.map(view);

  /* ----- the clock ----- */

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      for (const r of list.slice()) {
        if (!r.enabled) continue;
        try {
          if (r.trigger.type === 'schedule') {
            if (!r.state.nextAt) plan(r, now);
            const due = r.state.retryAt && r.state.retryAt < r.state.nextAt ? r.state.retryAt : r.state.nextAt;
            if (due && now >= due) {
              const late = now - due > LATE_MS && !r.state.retryAt ? due : null;
              // The next time is worked out from now, so a run missed while the Mac slept happens once, not once per missed time.
              r.state.retryAt = null;
              plan(r, now);
              save();
              fire(r, { why: late ? 'late' : 'schedule', dueAt: late }).catch(err => log(`Routine ${r.name}: ${err.message}`));
            }
          } else {
            if (!r.state.checkAt || now >= r.state.checkAt) await check(r);
            if ((r.watch.queue || []).length && !(r.state.retryAt && now < r.state.retryAt)) startQueued(r);
          }
        } catch (err) { log(`Routine ${r.name}: ${err.message}`); }
      }
    } finally { ticking = false; }
  }

  // Looks at a watcher's source once and queues anything new.
  async function check(r) {
    const s = r.trigger.source;
    r.state.checkAt = Date.now() + s.every * 60e3;
    const w = r.watch;
    w.seen = w.seen || [];
    try {
      const st = { cursor: w.cursor, seeded: w.seeded, channelName: w.channelName };
      const got = await SOURCES[s.type].check(s, st, { cwd: r.cwd });
      Object.assign(w, { cursor: got.st.cursor, seeded: got.st.seeded, channelName: got.st.channelName, lastCheck: Date.now(), error: null });
      const seen = new Set(w.seen);
      if (got.seed) for (const id of got.seed) seen.add(id);
      const fresh = got.items.filter(x => !seen.has(x.id));
      for (const x of fresh) seen.add(x.id);
      w.seen = [...seen].slice(-SEEN_MAX);
      if (fresh.length) {
        w.queue = [...(w.queue || []), ...fresh.map(x => ({ ...x, text: String(x.text).slice(0, 8000), at: Date.now() }))];
        if (w.queue.length > QUEUE_MAX) { const dropped = w.queue.length - QUEUE_MAX; w.queue = w.queue.slice(-QUEUE_MAX); note(r, 'skipped', `${dropped} older new items were left out: more than ${QUEUE_MAX} were waiting.`); }
        log(`Routine ${r.name}: ${fresh.length} new from ${SOURCES[s.type].label({ ...s, channelName: w.channelName })}`);
      }
    } catch (err) {
      const msg = one(err.message, 300);
      if (w.error !== msg) log(`Routine ${r.name}: ${msg}`);
      Object.assign(w, { error: msg, lastCheck: Date.now() });
    }
    save();
  }
  function startQueued(r) {
    const hourAgo = Date.now() - 3600e3;
    const lastHour = r.history.filter(h => h.why === 'item' && h.at > hourAgo && h.status !== 'skipped').length;
    if (lastHour >= PER_HOUR) {
      if (!r.state.capNoted || r.state.capNoted < hourAgo) { r.state.capNoted = Date.now(); note(r, 'skipped', `Already started ${PER_HOUR} chats in the last hour, so ${plural(r.watch.queue.length, 'new item')} will wait a little.`); }
      return;
    }
    const item = r.watch.queue.shift();
    save();
    fire(r, { why: 'item', item }).catch(err => log(`Routine ${r.name}: ${err.message}`));
  }

  /* ----- a run ----- */

  function note(r, status, line, extra = {}) {
    const h = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), status, line, ...extra };
    r.history.unshift(h);
    if (r.history.length > HISTORY_MAX) r.history.length = HISTORY_MAX;
    save();
    return h;
  }

  function promptFor(r, item) {
    const saved = r.promptId ? prompts().find(p => p.id === r.promptId) : null;
    const base = [saved ? saved.text : '', r.prompt].filter(x => x && x.trim()).join('\n\n');
    const d = new Date();
    const folder = path.basename(r.cwd.replace(/[\\/]+$/, '')) || r.cwd;
    let text = base.replace(/\{(project|world)\}/gi, folder).replace(/\{date\}/gi, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    if (item) {
      const src = r.trigger.source;
      text += `\n\n---\nNew in ${SOURCES[src.type].label({ ...src, channelName: r.watch.channelName })}${item.who ? `, from ${item.who}` : ''}:\n\n${item.text}${item.link ? `\n\nLink: ${item.link}` : ''}`;
    }
    return `${text}\n\n(Started by the routine “${r.name}”. ${NO_SEND})`;
  }

  // Starts one run: checks the account has room, opens (or continues) the chat and sends the prompt.
  async function fire(r, { why, item = null, dueAt = null }) {
    const u = await usageFor(r.account).catch(() => null);
    const d = u && u.data;
    const five = d && d.fiveHour, week = d && d.week;
    const full = week && week.used >= 99 ? ['weekly limit', week] : five && five.used >= r.limit ? ['five-hour window', five] : null;
    if (full) {
      const [what, w] = full;
      const reset = w.resetsAt ? Date.parse(w.resetsAt) : null;
      const left = Math.max(0, Math.round(100 - w.used));
      // Try again once the window resets, unless the next regular run comes sooner.
      const retry = reset && reset > Date.now() ? reset + 60e3 : Date.now() + 30 * 60e3;
      r.state.retryAt = retry;
      if (item) r.watch.queue.unshift(item);
      const prev = r.history[0];
      const line = `Waiting: ${u.name || 'the account'} has ${left}% of its ${what} left${reset ? ` (resets ${dateTag(reset)})` : ''}. It will try again then.`;
      if (prev && prev.status === 'skipped' && prev.usage) { Object.assign(prev, { at: Date.now(), line, count: (prev.count || 1) + 1 }); save(); }
      else note(r, 'skipped', line, { why, usage: true });
      return;
    }
    const usageNote = !d ? ' Its usage couldn’t be checked, so it ran anyway.' : '';
    const first = why === 'late' ? `Ran late: it was due ${dateTag(dueAt)}, while the Mac was asleep or the app was closed.` : why === 'manual' ? 'Started with Run now.' : why === 'item' ? `New: ${one(item.text, 140)}` : 'Started on schedule.';
    const startLine = `${first}${usageNote}`;
    const h = note(r, 'starting', startLine, { why, item: item ? { text: one(item.text, 400), link: item.link || null, who: item.who || null } : null, provider: r.provider, account: r.account });
    try {
      const title = r.chat.mode === 'continue' ? r.name : `${r.name} · ${dateTag(Date.now())}`;
      const sessionId = r.chat.mode === 'continue' ? r.chat.sessionId : null;
      const chat = await startChat({ account: r.account, cwd: r.cwd, sessionId, permissionMode: r.permissionMode, model: r.model, title });
      // Continuing a chat that's still busy (with the last run, or with you) would talk over it.
      if (['busy', 'waiting'].includes(chat.state)) throw Object.assign(new Error('That chat was still busy, so this run was skipped.'), { skip: true });
      if (!chat.title || chat.title === 'New chat') chat.title = title;
      chat.routineRun = h.id;
      // A chat it started gets the routine's name; a chat you picked keeps yours.
      runs.set(h.id, { routine: r.id, chat, sentAt: 0, title, named: !!sessionId });
      Object.assign(h, { status: 'working', key: chat.key, sessionId: chat.sessionId || null, line: startLine });
      save();
      await whenStarted(chat);
      if (chat.state === 'ended') throw new Error(endedWhy(chat));
      runs.get(h.id).sentAt = Date.now();
      chat.send(promptFor(r, item));
      log(`Routine ${r.name}: ${why} run in ${r.cwd} as ${r.account}`);
    } catch (err) {
      runs.delete(h.id);
      Object.assign(h, { status: err.skip ? 'skipped' : 'failed', line: one(err.message, 300) });
      log(`Routine ${r.name} couldn’t start: ${err.message}`);
      save();
    }
  }
  // A new Claude chat is ready for its first message once Claude Code has started; Codex queues it anyway.
  function whenStarted(chat) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const look = () => (chat.state !== 'starting' || Date.now() - t0 > 30000 ? resolve() : setTimeout(look, 250));
      look();
    });
  }
  const endedWhy = chat => one((chat.stderr || '').trim().split(/\r?\n/).pop() || 'The chat stopped before it started.', 300);

  // Called for every change in a running chat; follows the ones routines started.
  function onActivity(chat) {
    const id = chat.routineRun;
    const run = id && runs.get(id);
    if (!run) return;
    const r = list.find(x => x.id === run.routine);
    const h = r && r.history.find(x => x.id === id);
    if (!h) { runs.delete(id); return; }
    const before = JSON.stringify(h);
    if (chat.sessionId) {
      h.sessionId = chat.sessionId;
      if (r.chat.mode === 'continue' && r.chat.sessionId !== chat.sessionId) r.chat.sessionId = chat.sessionId;
    }
    const a = chat.activity;
    if (!run.sentAt) return;
    if (chat.state === 'ended') {
      Object.assign(h, { status: a.finishedAt && a.finishedAt >= run.sentAt ? 'done' : 'stopped', line: a.finishedAt >= run.sentAt && a.lastText ? one(lastPara(a.lastText)) : 'The chat stopped before it finished.' });
      runs.delete(id);
    } else if (chat.pending && chat.pending.size) {
      const p = [...chat.pending.values()][0];
      h.status = 'needs-you';
      h.line = p.event && p.event.questions ? 'Has a question for you.' : `Waiting for your OK${p.event && p.event.toolName ? ` to use ${p.event.toolName}` : ''}.`;
    } else if (a.finishedAt && a.finishedAt >= run.sentAt) {
      h.status = a.ok === false ? 'failed' : 'done';
      h.line = one(lastPara(a.lastText) || (a.ok === false ? 'The run ended with an error.' : 'Finished.'));
      h.finishedAt = a.finishedAt;
      runs.delete(id);
      warm.set(chat.key, { chat, until: Date.now() + WARM_MS });
      if (warm.size > WARM_MAX) warm.delete(warm.keys().next().value);
      if (!run.named && chat.sessionId) { run.named = true; Promise.resolve(nameChat(chat, run.title)).catch(() => {}); }
    } else if (h.status !== 'working') h.status = 'working';
    if (JSON.stringify(h) !== before) save();
  }
  // The end of a reply is usually its verdict or summary.
  const lastPara = t => String(t || '').trim().split(/\n\s*\n/).filter(s => s.trim()).pop() || '';

  // Runs nobody finished in three hours stop being followed (the chat itself is left alone).
  function sweep() {
    const now = Date.now();
    // Finished runs nobody has opened yet stay on the hub; once you open one, it's like any other chat.
    for (const [key, w] of warm) {
      if (w.chat.state === 'ended' || w.chat.clients.size || now > w.until) warm.delete(key);
      else if (w.chat.state === 'ready') w.chat.lastActivity = now;
    }
    for (const [id, run] of runs) {
      if (now - (run.sentAt || now) < RUN_WATCH_MS) continue;
      runs.delete(id);
      const r = list.find(x => x.id === run.routine), h = r && r.history.find(x => x.id === id);
      if (h && ['working', 'starting'].includes(h.status)) { h.line = `Still going after three hours. ${h.line}`; save(); }
    }
  }

  /* ----- from the page ----- */

  async function runNow(id) {
    const r = byId(id);
    if (r.trigger.type === 'watch') {
      await check(r);
      if ((r.watch.queue || []).length) { r.state.retryAt = null; startQueued(r); return { started: true, view: view(r) }; }
      return { started: false, view: view(r), message: r.watch.error || `Nothing new in ${SOURCES[r.trigger.source.type].label({ ...r.trigger.source, channelName: r.watch.channelName })}.` };
    }
    r.state.retryAt = null;
    await fire(r, { why: 'manual' });
    return { started: true, view: view(r) };
  }
  function clearHistory(id) { const r = byId(id); r.history = r.history.filter(h => runs.has(h.id)); save(); return view(r); }

  async function secrets() { return { slack: !!(await readSecret('slack')) }; }
  async function setSecret(name, value) {
    if (name !== 'slack') throw bad('Unknown secret.');
    const v = String(value || '').trim();
    if (v && !/^xox[abpe]-[A-Za-z0-9-]{10,200}$/.test(v)) throw bad('A Slack token starts with xoxb- (a bot) or xoxp- (you).');
    await writeSecret(name, v);
    log(v ? 'Saved a Slack token in the Keychain.' : 'Removed the Slack token from the Keychain.');
    for (const r of list) if (r.trigger.type === 'watch' && r.trigger.source.type === 'slack') { r.watch.error = null; r.state.checkAt = Date.now(); }
    save();
    return secrets();
  }

  // The routes, under /api/routines. Returns undefined for anything else.
  async function api(method, route, body) {
    if (method === 'GET' && route === '/api/routines') return { routines: listView(), templates: TEMPLATES, secrets: await secrets(), now: Date.now() };
    if (method !== 'POST') return undefined;
    switch (route) {
      case '/api/routines': return { routine: body.id ? update(String(body.id), body) : create(body) };
      case '/api/routines/remove': remove(String(body.id)); return { ok: true };
      case '/api/routines/pause': return { routine: pause(String(body.id), !!body.paused) };
      case '/api/routines/run': return runNow(String(body.id));
      case '/api/routines/clear': return { routine: clearHistory(String(body.id)) };
      case '/api/routines/secret': return { secrets: await setSecret(String(body.name), body.value) };
      default: return undefined;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { tick(); sweep(); }, TICK_MS);
    setTimeout(tick, 4000);
    const n = list.filter(r => r.enabled).length;
    if (n) log(`Routines: ${plural(n, 'routine')} on.`);
  }
  function stop() { clearInterval(timer); timer = null; if (saveTimer) flush(); }

  return { api, create, update, remove, pause, runNow, list: listView, start, stop, onActivity, tick };
}
const plural = (n, w) => `${n} ${n === 1 ? w : `${w}s`}`;

module.exports = { createRoutines, parseCron, cronNext, nextRun, describeSchedule, lineItem, textFilter, TEMPLATES };
