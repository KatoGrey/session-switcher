#!/usr/bin/env node
// Lets a chat (say a routine's Opus) look after other chats through Switcher Lite:
//
//   node bin/switcher-lite.js fixes [text]        the bug-fix chats a routine started (title has
//                                                 "(from <routine>)"), optionally only those matching
//                                                 text: state, last activity, branch, latest reply
//   node bin/switcher-lite.js reply <chat id>     a chat's whole latest reply
//   node bin/switcher-lite.js send <chat id> <text>   send a chat a message (steers it if it's working;
//                                                 reopens it first if it isn't running)
//
// A chat id is the session id the fixes list prints. Talks to the Switcher on --port (default 4777).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const port = Number(opt('port', process.env.SWITCHER_PORT || 4777));
const permission = opt('permission', 'bypassPermissions'); // for a chat that has to be reopened
const [cmd, ...rest] = args;

function api(p, body) {
  return new Promise((resolve, reject) => {
    let lock;
    try { lock = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${port}.json`), 'utf8')); } catch { return reject(new Error(`Switcher isn't running on port ${port}.`)); }
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: p, method: data ? 'POST' : 'GET', timeout: 30000,
      headers: { Host: `127.0.0.1:${port}`, 'X-Switcher-Token': lock.token, ...(data ? { 'Content-Type': 'application/json' } : {}) } }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(s); } catch { /* not JSON */ }
        if (res.statusCode >= 400) return reject(new Error((j && j.error) || `HTTP ${res.statusCode}`));
        resolve(j);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Switcher took too long to answer.'))); req.on('error', reject); req.end(data || undefined);
  });
}
const ago = t => { if (!t) return 'unknown'; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const lastReply = async id => ((await api(`/api/chat/last-reply?id=${encodeURIComponent(id)}`)) || {}).text || '';

async function fixes(filter) {
  const s = await api('/api/lite/state');
  const live = new Map((s.live || []).filter(x => x.sessionId).map(x => [x.sessionId.toLowerCase(), x]));
  const f = String(filter || '').toLowerCase();
  const list = (s.chats || []).filter(c => !c.archived && (c.fromRoutine || /\(from [^)]+\)\s*$/.test(c.title || '')) && (!f || (c.title || '').toLowerCase().includes(f)))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!list.length) return console.log('No bug-fix chats from routines.');
  for (const c of list) {
    const l = live.get(String(c.id).toLowerCase());
    const state = l ? (l.pending && l.pending.length ? 'waiting on a permission' : l.working ? `working (${l.tool || l.phase})` : l.phase) : 'not running';
    const reply = await lastReply(c.id).catch(() => '');
    console.log(`## ${c.title}\nchat: ${c.id}\nstate: ${state}; last activity ${ago((l && l.lastEventAt) || c.updated)}\nbranch: ${c.branch || 'none'}; folder: ${c.runDir || c.cwd}`);
    console.log(`latest reply (first 1500 characters):\n${reply.slice(0, 1500).trim() || '(none)'}\n`);
  }
}

(async () => {
  if (cmd === 'fixes') return fixes(rest.join(' '));
  if (cmd === 'reply' && rest[0]) return console.log(await lastReply(rest[0]));
  if (cmd === 'send' && rest[0] && rest.length > 1) {
    const s = await api('/api/lite/state');
    const id = rest[0].toLowerCase();
    const text = rest.slice(1).join(' ');
    const l = (s.live || []).find(x => (x.sessionId || '').toLowerCase() === id || x.key === rest[0]);
    if (l && l.key) { await api('/api/lite/steer', { key: l.key, text }); return console.log('Sent.'); }
    // Not running (say Switcher restarted since): open it again where it left off, then send.
    const c = (s.chats || []).find(x => String(x.id).toLowerCase() === id);
    if (!c) throw new Error('That chat isn’t in Switcher’s list.');
    const info = await api('/api/chat/open', { sessionId: c.id, mode: 'resume', ...(c.provider === 'codex' ? { provider: 'codex', ...(c.ollama && c.accountId ? { account: c.accountId } : {}) } : (c.accountId ? { account: c.accountId } : {})),
      permissionMode: permission });
    await api('/api/chat/send', { key: info.key, text });
    return console.log('Reopened the chat and sent.');
  }
  console.error('Usage: switcher-lite.js fixes [text] | reply <chat id> | send <chat id> <text>');
  process.exit(2);
})().catch(err => { console.error(err.message); process.exit(1); });
