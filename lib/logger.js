'use strict';
// switcher.log: one line a message, with its time, kept to about 1 MB (the one before it is
// switcher.log.old).
//
// The same message again and again (a fault that comes back with every piece of a program's output)
// is written once a minute, then how many more times: thousands a minute once pushed everything before
// them out of the log, the very part that said what went wrong.
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');

function createLog(file, { echo = true, max = 1024 * 1024, now = () => Date.now() } = {}) {
  const write = line => {
    if (echo) console.log(line);
    try { if (fs.statSync(file).size > max) fs.renameSync(file, `${file}.old`); } catch { /* no log yet */ }
    try { fs.appendFileSync(file, line + os.EOL); } catch { /* read-only folder */ }
  };
  const stamp = () => `[${new Date(now()).toISOString()}]`;
  // Several providers can fail together. Remember a bounded set of exact messages, so alternating
  // errors are suppressed too, while different details under the same first line remain visible.
  const recent = new Map();
  let lastWritten = null;
  const flush = () => {
    for (const [key, entry] of recent) {
      if (!entry.more) continue;
      const label = key === lastWritten ? 'the message above' : `“${entry.label}”`;
      write(`${stamp()} (${label}, ${entry.more} more time${entry.more === 1 ? '' : 's'})`);
      entry.more = 0;
      lastWritten = null;
    }
  };
  const log = msg => {
    msg = String(msg);
    // Hash the whole message rather than retaining up to 128 possibly enormous error strings.
    const key = createHash('sha256').update(msg).digest('hex'), at = now(), entry = recent.get(key);
    if (entry && at >= entry.at && at - entry.at < 60e3) { entry.more++; return; }
    flush();
    recent.delete(key);
    recent.set(key, { at, more: 0, label: msg.split('\n', 1)[0].replace(/\r/g, '').slice(0, 240) });
    while (recent.size > 128) recent.delete(recent.keys().next().value);
    write(`${stamp()} ${msg}`);
    lastWritten = key;
  };
  const timer = setInterval(flush, 30e3);
  if (timer.unref) timer.unref();
  log.flush = flush;
  log.close = () => { clearInterval(timer); flush(); recent.clear(); };
  return log;
}

module.exports = { createLog };
