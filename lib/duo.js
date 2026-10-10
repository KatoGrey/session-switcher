'use strict';
// One conversation, two assistants: Claude and Codex in the same chat, each reading the other.
//
// Before each message one of them gets, it's told what it missed since it last caught up: what the
// other one said (and which files it changed, how many commands it ran), and what you said to the
// other. This is worked out on the PC from the two chats themselves (their replies as they happen,
// and across a restart their transcripts) from the time each one last caught up, so every window and
// the phone give the same answer, and nothing is told twice or skipped. It travels at the start of
// the message, in a <shared-context> block; the chat window shows it as a small fold-out.

const { ownText } = require('./shared');

const ITEM_MAX = 4000;     // characters per message (a long one keeps its start and end)
const TOTAL_MAX = 24000;   // characters in all
const ITEMS_MAX = 24;      // messages at most (the newest)
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CMD_TOOLS = new Set(['Bash', 'PowerShell']);
const NAME = { claude: 'Claude', codex: 'Codex' };
const other = p => (p === 'codex' ? 'claude' : 'codex');

const ms = at => (at ? Date.parse(at) || 0 : 0);
const clipMiddle = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.round(n * 0.7)).trimEnd()}\n[…]\n${s.slice(-Math.round(n * 0.25)).trimStart()}`);

// Messages and replies (transcript items, or a running chat's events), newer than `since`, as
// entries: what you said to the chat, and each reply (its text and what it did). A reply without a
// time of its own (Codex's transcripts) counts from its turn's start.
function entries(items, who, since = null) {
  const out = [], after = ms(since);
  let turn = null, at = null;
  for (const it of items || []) {
    if (it.at) at = it.at;
    if (it.kind === 'user') {
      turn = null;
      if (after && ms(it.at) <= after) continue;
      const text = ownText(it.text || '').trim();
      if (text) out.push({ from: 'you', to: who, text, at: it.at || null });
      continue;
    }
    if (it.kind !== 'assistant' || (after && ms(it.at || at) <= after)) continue;
    if (!turn) { turn = { from: who, text: '', files: new Set(), cmds: 0, at: it.at || at }; out.push(turn); }
    for (const b of it.blocks || []) {
      if (b.type === 'text' && b.text && b.text.trim()) turn.text += (turn.text ? '\n\n' : '') + b.text.trim();
      else if (b.type === 'tool' && FILE_TOOLS.has(b.name)) turn.files.add((b.meta && b.meta.path) || b.summary || '');
      else if (b.type === 'tool' && CMD_TOOLS.has(b.name)) turn.cmds++;
    }
    if (it.at) turn.at = it.at;
  }
  return out.filter(e => e.from === 'you' || e.text || e.files.size || e.cmds);
}

function describe(e) {
  if (e.from === 'you') return `The user, to ${NAME[e.to]}:\n${clipMiddle(e.text, ITEM_MAX)}`;
  const did = [], files = [...e.files].filter(Boolean);
  if (files.length) did.push(`changed ${files.slice(0, 12).join(', ')}${files.length > 12 ? ` and ${files.length - 12} more` : ''}`);
  if (e.cmds) did.push(`ran ${e.cmds} command${e.cmds === 1 ? '' : 's'}`);
  return `${NAME[e.from]}${e.partial ? ' (still working on it)' : ''}:\n${clipMiddle(e.text || '(no text)', ITEM_MAX)}${did.length ? `\n(${NAME[e.from]} ${did.join('; ')}.)` : ''}`;
}

// The block for the start of a message to `to` ('claude' or 'codex'), or '' when there's nothing new.
//   theirs: the other one's entries since `to` last caught up
//   heard:  what `to` was itself told meanwhile (your messages to it, this one included), so a message
//           sent to both, or passed on, isn't repeated back
//   undone: files you put back from `to`'s own earlier reply
//   busy:   the other one is still mid-reply
//   relay:  this is your message to both of them, passed on after the other one answered it
function catchUp({ to, theirs = [], heard = [], undone = [], busy = false, relay = false }) {
  const told = new Set(heard.map(t => String(t).trim()));
  const list = theirs.filter(e => !(e.from === 'you' && told.has(e.text)));
  if (busy && list.length && list[list.length - 1].from !== 'you') list[list.length - 1] = { ...list[list.length - 1], partial: true };
  const keep = [];
  let total = 0;
  for (let i = list.length - 1; i >= 0 && keep.length < ITEMS_MAX; i--) {
    const d = describe(list[i]);
    if (keep.length && total + d.length > TOTAL_MAX) break;
    total += d.length; keep.unshift(d);
  }
  const notes = [];
  const files = [...new Set(undone.flat())].filter(Boolean);
  if (files.length) notes.push(`The user undid the file changes from your earlier reply: ${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} back as before it. Check ${files.length === 1 ? 'it' : 'them'} again before building on that work.`);
  const left = list.length - keep.length;
  if (left) notes.push(`(${left} earlier message${left === 1 ? ' is' : 's are'} left out; ask the user if you need ${left === 1 ? 'it' : 'them'}.)`);
  if (!keep.length && !files.length) return '';
  const head = keep.length ? `You and ${NAME[other(to)]} share this chat; the user sees you both. Since you last caught up:\n\n` : '';
  const tail = relay ? `\n\nThe user sent the message below to both of you, and ${NAME[other(to)]} answered it first (above). Build on that answer (check it, add what it missed, do your part) rather than repeating it.` : '';
  return `<shared-context items="${keep.length}">\n${head}${[...notes, ...keep].join('\n\n')}${tail}\n</shared-context>\n\n`;
}

// What a partner is told about its place, when it joins a chat (its first instructions).
const NOTE = {
  codex: 'You are working alongside Claude (Anthropic’s assistant) in the same project folder, inside Session Switcher. You and Claude share one chat: the user sees you both. A message may begin with <shared-context>: what the user and Claude said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to both of you, Claude answers first and its answer is in that context: build on it (check it, add what it missed, do your part) rather than saying it again. When you make an image for the project, also save a copy in the project folder (for example in "art" or "images") and say where.',
  claude: 'You are working alongside Codex (OpenAI’s coding agent) in the same project folder, inside Session Switcher. You and Codex share one chat: the user sees you both. A message may begin with <shared-context>: what the user and Codex said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to both of you, Codex answers first and its answer is in that context: build on it (check it, add what it missed, do your part) rather than saying it again.',
};

module.exports = { entries, catchUp, describe, other, NAME, NOTE, ITEMS_MAX, TOTAL_MAX, ITEM_MAX };
