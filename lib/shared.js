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

module.exports = { ownText, SHARED_RE, OTHER_RE };
