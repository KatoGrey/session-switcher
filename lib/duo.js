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
const LAST_MAX = 20000;    // the other one's newest reply, nearly always passed on whole
const TOTAL_MAX = 24000;   // characters in all
const ITEMS_MAX = 24;      // messages at most (the newest)
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CMD_TOOLS = new Set(['Bash', 'PowerShell']);
const NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
// The usual partner: Codex for Claude, Claude for Codex and for Gemini (a chat can pick another).
const other = p => (p === 'claude' ? 'codex' : 'claude');

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

function describe(e, max = ITEM_MAX) {
  if (e.from === 'you') return `The user, to ${NAME[e.to]}:\n${clipMiddle(e.text, max)}`;
  const did = [], files = [...e.files].filter(Boolean);
  if (files.length) did.push(`changed ${files.slice(0, 12).join(', ')}${files.length > 12 ? ` and ${files.length - 12} more` : ''}`);
  if (e.cmds) did.push(`ran ${e.cmds} command${e.cmds === 1 ? '' : 's'}`);
  return `${NAME[e.from]}${e.partial ? ' (still working on it)' : ''}:\n${clipMiddle(e.text || '(no text)', max)}${did.length ? `\n(${NAME[e.from]} ${did.join('; ')}.)` : ''}`;
}

// The block for the start of a message to `to` ('claude' or 'codex'), or '' when there's nothing new.
//   theirs: the other one's entries since `to` last caught up
//   heard:  what `to` was itself told meanwhile (your messages to it, this one included), so a message
//           sent to both, or passed on, isn't repeated back
//   undone: files you put back from `to`'s own earlier reply
//   theirUndone: files you put back from the other one's earlier reply (`to` may have built on them)
//   busy:   the other one is still mid-reply
//   relay:  this is your message to both of them, passed on after the other one answered it
//   intro:  tell `to` it has a partner (the first time it catches up)
//   first:  your message to both of them, and `to` answers first (the other picks it up after)
//   plan:   the other one's task list, when it changed: [{ content, status }]
//   mate:   who the other one is (its usual partner, unless said), or a list of them (a crew of three)
//   planBy: whose task list `plan` is
//   group:  the ones you picked to take turns (Together), in order, `to` among them; when given, the
//           message says exactly who it went to and who answers before and after `to`
//   together: with group, they all got it at once (At the same time): each does only its own part
function catchUp({ to, mate = other(to), planBy = null, theirs = [], heard = [], undone = [], theirUndone = [], busy = false, relay = false, intro = false, first = false, plan = null, group = null, together = false }) {
  const mates = (Array.isArray(mate) ? mate : [mate]).filter(m => m && m !== to);
  if (!mates.length) mates.push(other(to));
  const one = mates.length === 1;
  // "Codex", or "Codex and Gemini".
  const names = mates.map(m => NAME[m]).join(' and ');
  mate = mates[0];
  const told = new Set(heard.map(t => String(t).trim()));
  // A reply you quoted into your message ("Ask Codex") is already in it, so it isn't passed on twice.
  const quoted = heard.map(t => String(t).replace(/^> ?/gm, ''));
  const inQuote = e => e.from !== 'you' && e.text && quoted.some(q => q.includes(e.text.slice(0, 300).trim()));
  const list = theirs.filter(e => !(e.from === 'you' && told.has(e.text)) && !inQuote(e));
  if (busy && list.length && list[list.length - 1].from !== 'you') list[list.length - 1] = { ...list[list.length - 1], partial: true };
  const keep = [];
  let total = 0;
  const lastReply = list.map(e => mates.includes(e.from)).lastIndexOf(true);
  for (let i = list.length - 1; i >= 0 && keep.length < ITEMS_MAX; i--) {
    const d = describe(list[i], i === lastReply ? LAST_MAX : ITEM_MAX);
    if (keep.length && total + d.length > TOTAL_MAX) break;
    total += d.length; keep.unshift(d);
  }
  const notes = [];
  const files = [...new Set(undone.flat())].filter(Boolean);
  if (files.length) notes.push(`The user undid the file changes from your earlier reply: ${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} back as before it. Check ${files.length === 1 ? 'it' : 'them'} again before building on that work.`);
  const gone = [...new Set(theirUndone.flat())].filter(Boolean);
  if (gone.length) notes.push(`The user undid ${one ? `${NAME[mate]}’s` : 'one of the others’'} file changes from one of its replies: ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} back as before. If you built on ${gone.length === 1 ? 'it' : 'them'}, check again before going on.`);
  const left = list.length - keep.length;
  if (left) notes.push(`(${left} earlier message${left === 1 ? ' is' : 's are'} left out; ask the user if you need ${left === 1 ? 'it' : 'them'}.)`);
  if (intro) notes.unshift(one ? noteFor(to, mate) : noteForCrew(to, mates));
  // The crew plan: what the other one has set itself, so the two can split the work, not double it.
  if (plan && plan.length) notes.push(`${NAME[planBy && mates.includes(planBy) ? planBy : mate]}’s plan right now (its own steps; leave them to it unless the user says otherwise):\n${plan.slice(0, 30).map(s => `${s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '▸' : '○'} ${String(s.content || '').slice(0, 200)}`).join('\n')}`);
  const g = Array.isArray(group) && group.length > 1 && group.includes(to) ? group : null;
  if (!keep.length && !files.length && !gone.length && !intro && !first && !(g && together) && !(plan && plan.length)) return '';
  const head = keep.length ? (one ? `You and ${NAME[mate]} share this chat; the user sees you both. Since you last caught up:\n\n` : `You, ${names} share this chat; the user sees you all. Since you last caught up:\n\n`) : '';
  const tail = g && together ? atOnceTail(g, to, !!(keep.length || notes.length))
    : g && (first || relay) ? roundTail(g, to, !!(keep.length || notes.length))
    : first ? (one ? `${keep.length || notes.length ? '\n\n' : ''}The user sent the message below to both of you. You answer first; ${NAME[mate]} picks it up after you and sees your answer. Do your part, and say plainly what you leave for ${NAME[mate]}.`
      : `${keep.length || notes.length ? '\n\n' : ''}The user sent the message below to all of you. You answer first; ${names} pick it up after you, in turn, each seeing the answers before theirs. Do your part, and say plainly what you leave for the others.`)
    : relay ? (one ? `\n\nThe user sent the message below to both of you, and ${NAME[mate]} answered it first (above). Build on that answer (check it, add what it missed, do your part) rather than repeating it.`
      : `\n\nThe user sent the message below to all of you, and the others before you answered it (above). Build on those answers (check them, add what they missed, do your part) rather than repeating them.`) : '';
  return `<shared-context items="${keep.length}">\n${head}${[...notes, ...keep].join('\n\n')}${tail}\n</shared-context>\n\n`;
}
// Where `to` comes in a round you picked: "…to Gemini, Codex and you. Gemini answered it before you
// (above); Codex picks it up after you."
function roundTail(group, to, gap) {
  const say = ks => (ks.length > 1 ? `${ks.slice(0, -1).map(k => NAME[k]).join(', ')} and ${NAME[ks[ks.length - 1]]}` : NAME[ks[0]]);
  const at = group.indexOf(to), before = group.slice(0, at), after = group.slice(at + 1);
  const sent = `The user sent the message below to ${say(group.filter(k => k !== to))} and you, to take turns in this order: ${group.map(k => (k === to ? 'you' : NAME[k])).join(', then ')}.`;
  const prior = before.length ? ` ${say(before)} answered it before you (above): build on ${before.length > 1 ? 'those answers' : 'that answer'} (check, add what's missing, do your part) rather than repeating it.` : ' You answer first.';
  const next = after.length ? ` ${say(after)} ${after.length > 1 ? 'pick' : 'picks'} it up after you and ${after.length > 1 ? 'see' : 'sees'} your answer, so say plainly what you leave for ${after.length > 1 ? 'them' : NAME[after[0]]}.` : ' You are the last one; finish what the others left.';
  return `${gap || before.length ? '\n\n' : ''}${sent}${prior}${next}`;
}

// At the same time: "…to Claude and you, to work on at the same time…" and to keep to its own part.
function atOnceTail(group, to, gap) {
  const others = group.filter(k => k !== to);
  const say = others.length > 1 ? `${others.slice(0, -1).map(k => NAME[k]).join(', ')} and ${NAME[others[others.length - 1]]}` : NAME[others[0]];
  return `${gap ? '\n\n' : ''}The user sent the message below to ${say} and you at the same time: you all work on it at once, in the same project folder. Do only your own part of it (where the message says who does what, yours is what it gives ${NAME[to]}); leave the rest to ${others.length > 1 ? 'them' : say}. Don't edit files ${others.length > 1 ? 'they' : 'it'} may be working on; if you need a change there, say so instead. You won't see ${others.length > 1 ? 'their answers' : 'its answer'} before you reply.`;
}

// What a partner is told about its place, when it joins a chat (its first instructions).
const NOTE = {
  codex: 'You are working alongside Claude (Anthropic’s assistant) in the same project folder, inside Session Switcher. You and Claude share one chat: the user sees you both. A message may begin with <shared-context>: what the user and Claude said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to both of you, Claude answers first and its answer is in that context: build on it (check it, add what it missed, do your part) rather than saying it again. When you make an image for the project, also save a copy in the project folder (for example in "art" or "images") and say where.',
  claude: 'You are working alongside Codex (OpenAI’s coding agent) in the same project folder, inside Session Switcher. You and Codex share one chat: the user sees you both. A message may begin with <shared-context>: what the user and Codex said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to both of you, one answers first and the other sees that answer in its context: if it is yours to build on, check it, add what it missed and do your part rather than saying it again. Codex can make images, so if a picture is wanted, leave it to Codex rather than saying it can’t be done.',
};

// The same, for any pair: who the partner is, and what only it can do.
const WHO = { claude: 'Claude (Anthropic’s assistant)', codex: 'Codex (OpenAI’s coding agent)', gemini: 'Gemini (Google’s model, through its Antigravity agent)' };
function noteFor(me, mate) {
  if (mate === other(me) && NOTE[me]) return NOTE[me];
  const extra = mate === 'codex' ? ' Codex can make images, so if a picture is wanted, leave it to Codex rather than saying it can’t be done.' : '';
  return `You are working alongside ${WHO[mate] || NAME[mate]} in the same project folder, inside Session Switcher. You and ${NAME[mate]} share one chat: the user sees you both. A message may begin with <shared-context>: what the user and ${NAME[mate]} said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to both of you, one answers first and the other sees that answer in its context: if it is yours to build on, check it, add what it missed and do your part rather than saying it again.${extra}`;
}

// Joining a crew of three: who the others are.
function noteForCrew(me, mates) {
  const names = mates.map(m => NAME[m]).join(' and ');
  const extra = mates.includes('codex') ? ' Codex can make images, so if a picture is wanted, leave it to Codex rather than saying it can’t be done.' : '';
  return `You are working alongside ${mates.map(m => WHO[m] || NAME[m]).join(' and ')} in the same project folder, inside Session Switcher. You, ${names} share one chat: the user sees you all. A message may begin with <shared-context>: what the user and the others said and did since you last caught up. Use it, and don’t repeat it back. When the user writes to all of you, you answer in turn and each sees the answers before theirs: build on them (check, add what was missed, do your part) rather than saying it again.${extra}`;
}

module.exports = { entries, catchUp, describe, other, noteFor, noteForCrew, NAME, NOTE, ITEMS_MAX, TOTAL_MAX, ITEM_MAX };
