'use strict';
// switcher.log: one line a message, with its time, kept to about 1 MB (the one before it is
// switcher.log.old).
//
// The same message again and again (a fault that comes back with every piece of a program's output)
// is written once a minute, then how many more times: thousands a minute once pushed everything before
// them out of the log, the very part that said what went wrong.
const fs = require('fs');
const os = require('os');

function createLog(file, { echo = true, max = 1024 * 1024, now = () => Date.now() } = {}) {
  const write = line => {
    if (echo) console.log(line);
    try { if (fs.statSync(file).size > max) fs.renameSync(file, `${file}.old`); } catch { /* no log yet */ }
    try { fs.appendFileSync(file, line + os.EOL); } catch { /* read-only folder */ }
  };
  const stamp = () => `[${new Date(now()).toISOString()}]`;
  let last = { key: '', at: 0, more: 0 };
  const flush = () => {
    if (!last.more) return;
    write(`${stamp()} (the message above, ${last.more} more time${last.more === 1 ? '' : 's'})`);
    last.more = 0;
  };
  const log = msg => {
    const key = String(msg).split('\n')[0];
    if (key === last.key && now() - last.at < 60e3) { last.more++; return; }
    flush();
    last = { key, at: now(), more: 0 };
    write(`${stamp()} ${msg}`);
  };
  const timer = setInterval(flush, 30e3);
  if (timer.unref) timer.unref();
  log.flush = flush;
  return log;
}

module.exports = { createLog };
