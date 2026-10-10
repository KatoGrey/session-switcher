'use strict';
// First guesses for Switcher Lite, so the sidebar is mostly right without you:
//  - a kind, a status and a short title for each new chat, from its title and first message, by a
//    small Ollama cloud model (outside the Claude and ChatGPT limits), once per chat;
//  - Finishing for a chat whose branch has been pushed with nothing left to push.
// Your own choice always wins and is never guessed over (lite.json chats[id].kind / .status).

const http = require('http');
const cp = require('child_process');
const fs = require('fs');

const OLLAMA = { host: '127.0.0.1', port: 11434 };
const KINDS = ['feature', 'bug', 'prototype', 'idea'];
const STATUSES = ['exploring', 'building', 'finishing'];
const DAY = 864e5;

function ollama(pathname, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ ...OLLAMA, path: pathname, method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, timeout: timeoutMs }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
      res.on('end', () => { try { const j = JSON.parse(s); if (res.statusCode >= 400) reject(new Error(j.error || `Ollama answered ${res.statusCode}`)); else resolve(j); } catch { reject(new Error('Ollama sent something unexpected.')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Ollama took too long.')));
    req.on('error', reject);
    req.end(data || undefined);
  });
}

// The JSON array in a model's answer, even if it wrapped it in prose or a code fence.
function parseGuesses(text) {
  const m = /\[[\s\S]*\]/.exec(String(text || ''));
  if (!m) return [];
  let arr; try { arr = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(arr) ? arr : []).map(x => ({
    id: String(x && x.id || ''),
    kind: KINDS.includes(x && x.kind) ? x.kind : null,
    status: STATUSES.includes(x && x.status) ? x.status : null,
    title: x && typeof x.title === 'string' ? x.title.replace(/\s+/g, ' ').replace(/^["'“]|["'”.]$/g, '').trim().slice(0, 60) : null,
  })).filter(x => x.id && (x.kind || x.status || x.title));
}

const PROMPT = `You sort a developer's AI coding chats. For each chat below, pick its kind and status and write a short title.
Kinds: "feature" (building something new for users), "bug" (fixing or polishing something that exists), "prototype" (a quick throwaway build to try or show something), "idea" (a product idea being shaped, nothing built yet). Research, reviews, retros, audits, setup and tests get null.
Status: "exploring" (research, audits, reviews, plans, questions), "building" (writing the code), "finishing" (release notes, PR, last polish).
Title: 3 to 6 plain words naming the work, like "Fix discover page spacing" or "Voyage daily challenges research". No quotes, no trailing period.
Answer with only a JSON array: [{"id": "...", "kind": "..." or null, "status": "...", "title": "..."}].

Chats:
`;

// A title that's really a pasted prompt: long, or starting the way prompts do.
const looksLikePrompt = t => { const s = String(t || ''); return s.length > 56 || /^(you are|read |build |attached|round \d|reply with|please |can you|could you|i want|#)/i.test(s); };

function createGuesser({ store, log = () => {}, chats: listChats, model: pickModel }) {
  let busy = false, timer = null, lastError = null;
  async function modelName() {
    const want = store.get().guessModel;
    if (want) return want;
    const tags = await ollama('/api/tags', null, 5000).catch(() => null);
    const names = ((tags && tags.models) || []).map(m => m.name || m.model);
    return (pickModel && pickModel(names)) || names.find(n => /flash/i.test(n)) || names.find(n => /cloud/i.test(n)) || names[0] || null;
  }
  // Pushed with nothing left to push → Finish line.
  function pushedFinal(c) {
    if (!c.worktree || !c.branch || !fs.existsSync(c.worktree)) return false;
    const up = cp.spawnSync('git', ['-C', c.worktree, 'rev-list', '--count', '@{upstream}..HEAD'], { encoding: 'utf8', timeout: 5000 });
    return up.status === 0 && up.stdout.trim() === '0';
  }
  async function run() {
    if (busy) return { skipped: true };
    busy = true;
    try {
      const L = store.get(), now = Date.now();
      const all = listChats().filter(c => !c.auto && !c.archived && !(L.chats[c.id] && L.chats[c.id].kind && L.chats[c.id].status));
      // Branches: cheap, every pass.
      let finals = 0;
      for (const c of all) if (c.worktree && !(L.chats[c.id] && L.chats[c.id].status) && (!L.guess[c.id] || L.guess[c.id].status !== 'finishing') && pushedFinal(c)) { store.setGuess(c.id, { status: 'finishing', by: 'git', keep: true }); finals++; }
      // Stages and titles: chats from the last 30 days the model hasn't seen yet, newest first.
      // Guesses from before kinds and statuses (no v: 2) are asked again, once.
      const todo = all.filter(c => (!L.guess[c.id] || L.guess[c.id].v !== 2) && now - c.updated < 30 * DAY).sort((a, b) => b.updated - a.updated).slice(0, 25);
      if (!todo.length) { lastError = null; return { finals, guessed: 0 }; }
      const model = await modelName();
      if (!model) { lastError = 'No Ollama model available.'; return { finals, guessed: 0 }; }
      const list = todo.map(c => `- id: ${c.id}\n  title: ${String(c.title).slice(0, 200)}\n  first message: ${String(c.firstPrompt || '').slice(0, 300)}`).join('\n');
      const r = await ollama('/api/chat', { model, stream: false, options: { temperature: 0.1 }, messages: [{ role: 'user', content: PROMPT + list }] });
      const got = parseGuesses(r && r.message && r.message.content);
      const ids = new Set(todo.map(c => c.id));
      let n = 0;
      for (const g of got) if (ids.has(g.id)) { store.setGuess(g.id, { kind: g.kind, status: g.status, title: g.title, by: model, v: 2 }); n++; }
      // Ones the model skipped are marked, so they aren't asked about forever.
      for (const c of todo) if (!got.some(g => g.id === c.id)) store.setGuess(c.id, { by: model, none: true, v: 2 });
      log(`Lite: guessed ${n} of ${todo.length} chats with ${model}${finals ? `; ${finals} pushed → Finishing` : ''}`);
      lastError = null;
      return { finals, guessed: n };
    } catch (err) { lastError = err.message; log(`Lite: guessing failed (${err.message})`); return { error: err.message }; }
    finally { busy = false; }
  }
  function start() {
    if (timer) return;
    setTimeout(() => run().catch(() => {}), 2 * 60e3).unref();
    timer = setInterval(() => run().catch(() => {}), 10 * 60e3); timer.unref();
  }
  return { run, start, status: () => ({ busy, lastError }) };
}

module.exports = { createGuesser, parseGuesses, looksLikePrompt };
