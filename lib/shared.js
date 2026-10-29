'use strict';
// One conversation, two assistants. In a Claude chat with its Codex helper, each message you send
// to one of them starts with what it hasn't seen yet (what the other one said, and what you said to
// it), between <shared-context> tags. These helpers find the part you actually wrote, for titles,
// previews and the "running now" board.

// The block is at the very start; a cut-off copy (a preview) may lack its closing tag.
const SHARED_RE = /^\s*<shared-context(?:\s+[^>]*)?>[\s\S]*?(?:<\/shared-context>\s*|$)/;
// Another chat brought in with "@chat[…]": its latest messages, in an <other-chat> block after that.
const OTHER_RE = /^\s*<other-chat(?:\s+[^>]*)?>[\s\S]*?(?:<\/other-chat>\s*|$)/;

function ownText(text) {
  let s = String(text || '');
  if (s.startsWith('<shared-context') || /^\s+<shared-context/.test(s)) s = s.replace(SHARED_RE, '');
  while (/^\s*<other-chat/.test(s)) s = s.replace(OTHER_RE, '');
  return s;
}

// Claude Code's, Codex's and Gemini's messages: one JSON message a line, read as bytes rather than
// with readline. A message can be enormous (a Codex chat's history, with every picture inline, ran past
// half a gigabyte), and a line longer than a JavaScript string can hold made readline throw on every
// piece that followed: the app was cut off from that program, for every chat it served, until a
// restart. A line over `max` is skipped instead; onTooLong gets its first bytes (which say what it
// was) and its size. (256 MB: half what a string can hold, and more than any one message needs.)
const LINE_MAX = 256 * 1024 * 1024;
function jsonLines(stream, onLine, onTooLong = () => {}, max = LINE_MAX) {
  let parts = [], size = 0, head = '', skipping = false;
  const finish = () => {
    if (skipping) onTooLong(head, size);
    else if (size) onLine((parts.length === 1 ? parts[0] : Buffer.concat(parts, size)).toString('utf8'));
    parts = []; size = 0; head = ''; skipping = false;
  };
  stream.on('data', chunk => {
    for (let i = 0; ;) {
      const nl = chunk.indexOf(10, i), end = nl === -1 ? chunk.length : nl;
      const piece = chunk.subarray(i, end);
      if (head.length < 200 && piece.length) head += piece.subarray(0, 200 - head.length).toString('latin1');
      if (!skipping && size + piece.length > max) { skipping = true; parts = []; }
      if (!skipping && piece.length) parts.push(piece);
      size += piece.length;
      if (nl === -1) break;
      finish(); i = nl + 1;
    }
  });
  stream.on('end', () => { if (size) finish(); });
}

module.exports = { ownText, SHARED_RE, OTHER_RE, jsonLines, LINE_MAX };
