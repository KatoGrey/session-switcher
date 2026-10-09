'use strict';
// One conversation, two assistants. In a Claude chat with its Codex helper, each message you send
// to one of them starts with what it hasn't seen yet (what the other one said, and what you said to
// it), between <shared-context> tags. These helpers find the part you actually wrote, for titles,
// previews and the "running now" board.

// The block is at the very start; a cut-off copy (a preview) may lack its closing tag.
const SHARED_RE = /^\s*<shared-context(?:\s+[^>]*)?>[\s\S]*?(?:<\/shared-context>\s*|$)/;

function ownText(text) {
  const s = String(text || '');
  return s.startsWith('<shared-context') || /^\s+<shared-context/.test(s) ? s.replace(SHARED_RE, '') : s;
}

module.exports = { ownText, SHARED_RE };
