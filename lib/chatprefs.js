'use strict';
// What you chose for a chat, remembered: its mode (what it may do without asking), its model and
// effort, and the Codex helper paired with a Claude chat. Choices are kept per chat and as the
// project's default for new chats, separately for Claude and Codex.
//
//   chat-prefs.json  { projects: { <folder>: { claude: {...}, codex: {...} } },
//                      chats: { <chat id>: { mode, model, effort, companion } } }

const path = require('path');
const store = require('./store');

const KEYS = ['mode', 'model', 'effort'];
const MAX_CHATS = 4000;
const normCwd = p => { const x = String(p || '').replace(/[\\/]+$/, ''); return process.platform === 'win32' ? x.toLowerCase() : x; };
const clean = v => (typeof v === 'string' && v.length <= 120 && /^[\w.:\[\]-]+$/.test(v) ? v : null);

function createChatPrefs({ dataDir, log = () => {} }) {
  const file = path.join(dataDir, 'chat-prefs.json');
  let data = store.loadOwnJson(file, null, log) || {};
  data = { projects: data.projects || {}, chats: data.chats || {} };
  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Forget the oldest chats once the list gets long; project defaults are kept.
      const ids = Object.keys(data.chats);
      if (ids.length > MAX_CHATS) ids.sort((a, b) => (data.chats[a].at || 0) - (data.chats[b].at || 0)).slice(0, ids.length - MAX_CHATS).forEach(id => delete data.chats[id]);
      try { store.writeJsonAtomic(file, data); } catch (err) { log(`Couldn’t save chat-prefs.json: ${err.message}`); }
    }, 250);
  }

  const chatOf = id => (id ? data.chats[String(id).toLowerCase()] || null : null);
  const projectOf = (cwd, provider) => ((data.projects[normCwd(cwd)] || {})[provider === 'codex' ? 'codex' : 'claude']) || null;

  // The choices a chat should open with: its own, else its project's, else none (the tool's default).
  function get({ sessionId = null, cwd = null, provider = 'claude' } = {}) {
    const c = chatOf(sessionId) || {}, p = projectOf(cwd, provider) || {};
    const out = {};
    for (const k of KEYS) out[k] = c[k] || p[k] || null;
    return out;
  }

  // Remembers a choice for the chat (if it has an id yet) and as the project's default.
  function set({ sessionId = null, cwd = null, provider = 'claude' } = {}, changes = {}) {
    const vals = {};
    for (const k of KEYS) if (k in changes) vals[k] = changes[k] === null ? null : clean(changes[k]);
    if (!Object.keys(vals).length) return;
    if (sessionId) {
      const id = String(sessionId).toLowerCase();
      const c = data.chats[id] || (data.chats[id] = {});
      for (const [k, v] of Object.entries(vals)) { if (v) c[k] = v; else delete c[k]; }
      c.at = Date.now();
    }
    if (cwd) {
      const key = normCwd(cwd);
      const p = data.projects[key] || (data.projects[key] = {});
      const prov = provider === 'codex' ? 'codex' : 'claude';
      const d = p[prov] || (p[prov] = {});
      for (const [k, v] of Object.entries(vals)) { if (v) d[k] = v; else delete d[k]; }
    }
    save();
  }

  // A chat and its partner (Codex in a Claude chat, or Claude in a Codex chat), both ways.
  function companionOf(sessionId) { const c = chatOf(sessionId); return c && c.companion ? c.companion : null; }
  // A partner is the chat's current one; one it had before (it started a new conversation since) is a
  // chat of its own again.
  function parentOf(threadId) {
    const c = chatOf(threadId), lead = c && c.parent ? chatOf(c.parent) : null;
    return lead && String(lead.companion || '').toLowerCase() === String(threadId).toLowerCase() ? c.parent : null;
  }
  function link(leadId, partnerId) {
    if (!leadId || !partnerId) return;
    const a = String(leadId).toLowerCase(), b = String(partnerId).toLowerCase();
    (data.chats[a] || (data.chats[a] = {})).companion = partnerId;
    (data.chats[b] || (data.chats[b] = {})).parent = leadId;
    data.chats[a].at = data.chats[b].at = Date.now();
    save();
  }
  // Every chat that's another chat's partner (it lives inside that chat, not in the lists), by id.
  function partners() { const out = new Map(); for (const [id, c] of Object.entries(data.chats)) if (c.parent && parentOf(id)) out.set(id, c.parent); return out; }
  // When a chat last caught up on its partner (see lib/duo.js).
  function heard(sessionId) { const c = chatOf(sessionId); return c && c.heard ? c.heard : null; }
  function setHeard(sessionId, at) {
    if (!sessionId || !at) return;
    const id = String(sessionId).toLowerCase(), c = data.chats[id] || (data.chats[id] = {});
    c.heard = at; c.at = Date.now();
    save();
  }

  return { get, set, companionOf, parentOf, link, partners, heard, setHeard, flush: () => { if (timer) { clearTimeout(timer); timer = null; store.writeJsonAtomic(file, data); } } };
}

module.exports = { createChatPrefs };
