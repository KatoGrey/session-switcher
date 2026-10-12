'use strict';
// "Fix and recheck until clean", run on the PC rather than in a window, so it carries on when you
// switch chats, reload, or put the phone down. The findings go to Claude; once it's done, Codex
// checks again from the same starting point, up to ROUNDS rounds. Each step arrives in the chat as a
// 'reviewloop' event: the review it's about, the round, and how it ended (clean, rounds, failed,
// stopped).
//
//   send(chat, text)               sends to the chat, caught up first (lib/pairs.js)
//   review(chat, files, base)      starts a Codex review; resolves to { id, done } where done
//                                  settles with { state: 'done' | 'failed', findings }
//   fixText(what, findings)        the message for Claude

const ROUNDS = 3;

function createReviewLoop({ send, review, fixText }) {
  const running = new Map();   // chat key -> { stopped }

  function start(chat, { id, what, base = null, findings, files = [] }) {
    if (running.has(chat.key)) throw Object.assign(new Error('A fix-and-recheck is already running in this chat.'), { status: 409 });
    if (chat.state !== 'ready') throw Object.assign(new Error('Claude is busy. Try again once it’s done.'), { status: 409 });
    if (!findings || !findings.length) throw Object.assign(new Error('There are no findings to fix.'), { status: 400 });
    const lp = { stopped: false };
    running.set(chat.key, lp);
    const say = extra => chat.emit({ kind: 'reviewloop', ...extra });
    const done = (async () => {
      let round = 1, list = findings, about = id;
      for (;;) {
        say({ id: about, round, state: 'fixing' });
        const sentAt = Date.now();
        await send(chat, fixText(what, list));
        const end = await chat.turnDone();
        if (lp.stopped || end.kind === 'ended' || end.ok === false || (chat.interruptedAt && chat.interruptedAt >= sentAt)) return say({ id: about, round, state: 'end', done: 'stopped' });
        const r = await review(chat, files, base);
        say({ id: r.id, round, state: 'checking' });
        const res = await r.done;
        if (lp.stopped) return say({ id: r.id, round, state: 'end', done: 'stopped' });
        if (res.state === 'failed') return say({ id: r.id, round, state: 'end', done: 'failed' });
        if (!res.findings.length) return say({ id: r.id, round, state: 'end', done: 'clean' });
        if (round >= ROUNDS) return say({ id: r.id, round, state: 'end', done: 'rounds' });
        round++; list = res.findings; about = r.id;
      }
    })().catch(err => say({ id, state: 'end', done: 'failed', error: err.message }))
      .finally(() => running.delete(chat.key));
    return { ok: true, done };
  }
  // Stops after the step it's on (nothing more is sent).
  function stop(chat) { const lp = running.get(chat.key); if (lp) lp.stopped = true; return { ok: true }; }

  return { start, stop, ROUNDS };
}

module.exports = { createReviewLoop };
