'use strict';
// How you've organized your chats: groups you made, sub-sessions (a chat started from another
// chat), and the Commander (one chat that can see and steer the others).
//
//   organize.json  { groups:    [{ id, name, collapsed, chats: [chat id, …] }],
//                    parents:   { <child chat id>: { parent: <chat id>, at } },
//                    commander: { sessionId, accountId, allowApprove } }
//
// Chat ids are Claude Code session ids or Codex thread ids, kept as they were given and compared
// without case.

const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const NAME_RE = /^[^\x00-\x1f]{1,40}$/;
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const MAX_GROUPS = 60, MAX_IN_GROUP = 400, MAX_PARENTS = 4000;
const low = s => String(s || '').toLowerCase();
const fail = (status, message) => Object.assign(new Error(message), { status });

function createOrganize({ dataDir, log = () => {} }) {
  const file = path.join(dataDir, 'organize.json');
  let data = store.loadOwnJson(file, null, log) || {};
  data = {
    groups: Array.isArray(data.groups) ? data.groups.filter(g => g && g.id && g.name) : [],
    parents: data.parents && typeof data.parents === 'object' ? data.parents : {},
    commander: { sessionId: null, accountId: null, allowApprove: false, ...(data.commander || {}) },
  };
  for (const g of data.groups) g.chats = Array.isArray(g.chats) ? g.chats.filter(id => ID_RE.test(String(id))) : [];
  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; write(); }, 200);
  }
  function write() {
    const ids = Object.keys(data.parents);
    if (ids.length > MAX_PARENTS) ids.sort((a, b) => (data.parents[a].at || 0) - (data.parents[b].at || 0)).slice(0, ids.length - MAX_PARENTS).forEach(id => delete data.parents[id]);
    try { store.writeJsonAtomic(file, data); } catch (err) { log(`Couldn’t save organize.json: ${err.message}`); }
  }

  const cleanName = n => {
    const s = String(n || '').replace(/\s+/g, ' ').trim();
    if (!NAME_RE.test(s)) throw fail(400, 'Give the group a name of 1 to 40 characters.');
    return s;
  };
  const checkId = id => { if (!ID_RE.test(String(id || ''))) throw fail(400, 'That isn’t a valid chat id.'); return String(id); };
  const group = id => { const g = data.groups.find(x => x.id === id); if (!g) throw fail(404, 'That group isn’t there any more.'); return g; };
  const groupOf = id => data.groups.find(g => g.chats.some(c => low(c) === low(id))) || null;

  // ---------- groups ----------

  function create(name) {
    if (data.groups.length >= MAX_GROUPS) throw fail(400, 'That’s a lot of groups. Remove one first.');
    const g = { id: `g-${crypto.randomBytes(5).toString('hex')}`, name: cleanName(name), collapsed: false, chats: [] };
    data.groups.push(g); save();
    return g;
  }
  function rename(id, name) { group(id).name = cleanName(name); save(); }
  function remove(id) { group(id); data.groups = data.groups.filter(g => g.id !== id); save(); }
  function collapse(id, on) { group(id).collapsed = !!on; save(); }
  // Moves a group up or down one place, or to an index.
  function reorder(id, { step = 0, to = null } = {}) {
    const i = data.groups.findIndex(g => g.id === id);
    if (i < 0) throw fail(404, 'That group isn’t there any more.');
    const j = Math.max(0, Math.min(data.groups.length - 1, to !== null && to !== undefined ? Number(to) : i + Number(step)));
    if (i === j || !Number.isInteger(j)) return;
    const [g] = data.groups.splice(i, 1);
    data.groups.splice(j, 0, g); save();
  }
  // Puts a chat in a group (taking it out of any other), or in none with groupId null.
  // Its sub-sessions come along, so a family stays together.
  function move(chatId, groupId) {
    checkId(chatId);
    const fam = [chatId, ...descendants(chatId)];
    for (const g of data.groups) g.chats = g.chats.filter(c => !fam.some(f => low(f) === low(c)));
    if (groupId) {
      const g = group(groupId);
      if (g.chats.length + fam.length > MAX_IN_GROUP) throw fail(400, 'That group is full.');
      g.chats.push(...fam);
    }
    save();
  }

  // ---------- sub-sessions ----------

  function parentOf(id) { const p = data.parents[low(id)]; return p ? p.parent : null; }
  function childrenOf(id) { return Object.entries(data.parents).filter(([, v]) => low(v.parent) === low(id)).map(([k, v]) => v.child || k); }
  function descendants(id, seen = new Set()) {
    const out = [];
    for (const c of childrenOf(id)) { if (seen.has(low(c))) continue; seen.add(low(c)); out.push(c, ...descendants(c, seen)); }
    return out;
  }
  // Remembers that `child` was started from `parent`, and puts it in the parent's group.
  function link(child, parent) {
    checkId(child); checkId(parent);
    if (low(child) === low(parent)) return;
    let up = parent;
    for (let i = 0; up && i < 50; i++) { if (low(up) === low(child)) return; up = parentOf(up); } // never a loop
    data.parents[low(child)] = { parent, child, at: Date.now() };
    const g = groupOf(parent);
    if (g && !g.chats.some(c => low(c) === low(child))) { for (const o of data.groups) o.chats = o.chats.filter(c => low(c) !== low(child)); g.chats.push(child); }
    save();
  }
  function unlink(child) { delete data.parents[low(child)]; save(); }

  // ---------- the Commander ----------

  function commander() { return { ...data.commander }; }
  function setCommander(changes) {
    const c = data.commander;
    if ('sessionId' in changes) c.sessionId = changes.sessionId ? checkId(changes.sessionId) : null;
    if ('accountId' in changes) c.accountId = changes.accountId ? String(changes.accountId).slice(0, 80) : null;
    if ('allowApprove' in changes) c.allowApprove = !!changes.allowApprove;
    save();
    return commander();
  }

  // What the page needs: groups in order, and every sub-session link.
  function view() {
    return {
      groups: data.groups.map(g => ({ id: g.id, name: g.name, collapsed: !!g.collapsed, chats: g.chats.slice() })),
      parents: Object.fromEntries(Object.entries(data.parents).map(([k, v]) => [k, v.parent])),
      commander: commander(),
    };
  }

  return {
    create, rename, remove, collapse, reorder, move, groupOf,
    link, unlink, parentOf, childrenOf, descendants,
    commander, setCommander, view,
    flush: () => { if (timer) { clearTimeout(timer); timer = null; write(); } },
  };
}

module.exports = { createOrganize };
