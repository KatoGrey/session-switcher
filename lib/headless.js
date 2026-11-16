'use strict';
// Headless runs: chats a script or another agent started and ran without anyone typing in them (`claude -p`,
// the Claude Agent SDK, `codex exec`). Someone with a review pipeline can have dozens at once; they're kept
// out of the everyday lists (the page has them on a list of their own) and stay one click away.
//
// How a chat began is all there is to go by. Claude Code writes how it was started into each conversation
// ("entrypoint": cli or claude-desktop for a person's chat, sdk-cli for `claude -p`, sdk-ts or sdk-py for the
// Agent SDK), but Session Switcher's own chats run Claude Code the SDK way too, so they say sdk-cli as well.
// What tells them apart is the app's launch history (lib/sessions.js): a chat the app started has `born:
// 'app'` there for good; one it first met when it was opened here has `born: 'outside'`. A record from
// before `born` was kept has neither, and stays one of yours (as it always was). A chat with no record at all
// that's been used since the history's oldest record was never opened here: a script's. One older than that
// may have lost its record (to the old limit of 2,000, or a new data folder), so it stays one of yours.
// Codex marks its own: a thread `codex exec` started has the source exec. Either way, what you've said about
// a chat wins (chat-prefs.json: headless true or false).

const SDK = /^sdk-/;

// s: a chat as the session lists have it ({ provider, entrypoint, source, lastOpened, updated }).
// said: true or false when you've put it in or taken it out yourself, else undefined.
// since: when the launch history begins (sessions.historySince()); Infinity when it's empty.
function isHeadless(s, said, since = Infinity) {
  if (said === true || said === false) return said;
  if (!s) return false;
  const provider = s.provider || 'claude';
  if (provider === 'codex') return s.source === 'exec';
  if (provider !== 'claude') return false;
  if (!SDK.test(String(s.entrypoint || ''))) return false;
  const h = s.lastOpened;
  if (h) return h.born === 'outside';
  return (s.updated || 0) > since;
}

module.exports = { isHeadless };
