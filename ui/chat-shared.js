'use strict';
/* One conversation, two assistants. Whatever you send to Claude or to Codex starts with what that one
   hasn't seen yet: what the other one said (and changed), and what you said to it. In the chat that
   shows as a small fold-out, not as text you wrote. "Both" sends one message to each. */

const SHARE_ITEMS = 8;        // at most this many messages caught up at once (the newest)
const SHARE_ITEM_MAX = 2400;  // characters per message (long ones keep their start and end)
const SHARE_MAX = 9000;       // characters in all

// "<shared-context items="2">…</shared-context>" at the start of a message, and what follows it.
const SHARED_TAG = /^\s*<shared-context(?:\s+items="(\d+)")?[^>]*>\n?([\s\S]*?)(?:\n?<\/shared-context>\s*|$)/;
function splitShared(text) {
  const s = String(text || '');
  const m = /^\s*<shared-context/.test(s) && s.match(SHARED_TAG);
  return m ? { items: Number(m[1]) || 0, context: m[2].trim(), own: s.slice(m[0].length) } : { items: 0, context: '', own: s };
}
const clipMiddle = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.round(n * 0.7)).trimEnd()}\n[…]\n${s.slice(-Math.round(n * 0.25)).trimStart()}`);

// Who has heard a message in the feed: the one who wrote it, or the one(s) it was sent to.
function heardBy(el) {
  if (el.classList.contains('umsg')) return el.classList.contains('to-both') ? ['main', 'comp'] : el.classList.contains('to-codex') ? ['comp'] : ['main'];
  // A reply: the chat's own assistant is 'main' (Claude, or Codex in a Codex chat); the helper is 'comp'.
  if (el.classList.contains('turn')) return [(el.dataset.prov || C.provider) === C.provider ? 'main' : 'comp'];
  return null;
}
// "edited cart.js, README.md; ran 3 commands", from a reply's steps.
function didSummary(turn) {
  const steps = [...turn.querySelectorAll('.tool')].map(d => d._view).filter(Boolean);
  const files = [...new Set(steps.filter(b => FILE_TOOLS.has(b.name)).map(b => (b.meta && b.meta.path) || b.summary).filter(Boolean))];
  const cmds = steps.filter(b => b.name === 'Bash' || b.name === 'PowerShell').length;
  const out = [];
  if (files.length) out.push(`changed ${files.slice(0, 12).join(', ')}${files.length > 12 ? ` and ${files.length - 12} more` : ''}`);
  if (cmds) out.push(`ran ${cmds} command${cmds === 1 ? '' : 's'}`);
  return out.join('; ');
}

// What `to` ('main' for Claude, 'comp' for Codex) hasn't seen: everything in the feed since its own
// last message or yours to it. Returns null when it's up to date.
function catchUp(to) {
  const feed = $c('cFeed'); if (!feed) return null;
  const els = [];
  for (let el = feed.lastElementChild; el && els.length < SHARE_ITEMS; el = el.previousElementSibling) {
    const h = heardBy(el); if (!h) continue;
    if (h.includes(to)) break;
    els.unshift(el);
  }
  const entries = [];
  const undone = (C.undoNotes && C.undoNotes[to]) || [];
  if (undone.length) {
    const files = [...new Set(undone.flat())];
    entries.push(`The user undid the file changes from your earlier reply: ${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} back as before it. Check ${files.length === 1 ? 'it' : 'them'} again before building on that work.`);
  }
  for (const el of els) {
    if (el.classList.contains('umsg')) {
      const own = (RAW.get(el) || '').trim(); if (!own) continue;
      entries.push(`The user, to ${el.classList.contains('to-codex') ? 'Codex' : 'Claude'}:\n${clipMiddle(own, SHARE_ITEM_MAX)}`);
    } else {
      const who = PROV_NAME[el.dataset.prov || C.provider];
      const text = turnMarkdown(el), did = didSummary(el);
      if (!text && !did) continue;
      entries.push(`${who}:\n${clipMiddle(text || '(no text)', SHARE_ITEM_MAX)}${did ? `\n(${who} ${did}.)` : ''}`);
    }
  }
  const keep = [];
  for (let i = entries.length - 1, total = 0; i >= 0; i--) { total += entries[i].length; if (total > SHARE_MAX && keep.length) break; keep.unshift(entries[i]); }
  if (!keep.length) return null;
  const other = to === 'comp' ? 'Claude' : 'Codex';
  const shared = duo() ? `You and ${other} share this chat; the user sees you both. ` : '';
  return { items: keep.length, text: `${shared}Since your last message:\n\n${keep.join('\n\n')}` };
}
// The message as sent to `to`: what it missed, then what you wrote.
function withCatchUp(to, text) {
  const c = catchUp(to);
  if (C.undoNotes) C.undoNotes[to] = [];
  return c ? `<shared-context items="${c.items}">\n${c.text}\n</shared-context>\n\n${text}` : text;
}

// The ones your next message goes to (Codex counts even before its helper has started).
function targetsNow() {
  const main = { key: C.key, state: C.state, name: PROV_NAME[C.provider] };
  const comp = { key: C.comp && !C.comp.ended ? C.comp.key : null, state: C.comp && !C.comp.ended ? C.comp.state : 'ready', name: 'Codex' };
  if (!duo() || C.target === 'main') return [main];
  return C.target === 'comp' ? [comp] : [main, comp];
}

// A message sent to both arrives twice (once from each); the second joins the first, which then
// reads "to Claude & Codex". True if it joined (so it isn't drawn again).
function joinBoth(root, toCodex, own, at) {
  for (let prev = root.lastElementChild, n = 0; prev && n < 6; prev = prev.previousElementSibling, n++) {
    if (!prev.classList.contains('umsg') || prev.classList.contains('to-both')) continue;
    if (prev.classList.contains('to-codex') === toCodex) continue;
    if ((RAW.get(prev) || '').trim() !== own.trim() || Math.abs((prev._at || 0) - at) > 120000) continue;
    prev.classList.remove('to-codex'); prev.classList.add('to-both');
    const tag = prev.querySelector('.to-tag');
    if (tag) tag.textContent = 'to Claude & Codex';
    else prev.insertAdjacentHTML('afterbegin', '<span class="to-tag">to Claude & Codex</span>');
    return true;
  }
  return false;
}
