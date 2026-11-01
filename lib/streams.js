'use strict';
// One live connection per window. A browser keeps at most six connections open to one address, across
// all its windows together, and a stream holds one for as long as it's open. A chat with two partners
// took four (the app's own, one per chat), so a second window could leave none for anything else, and
// every click waited. Now a window's chats all come over its one connection (/api/events?stream=<id>):
// it asks for a chat with POST /api/chat/watch, and each of the chat's events arrives named for that
// request, in the order it happened.
//
//   event: c     data: <sub> <seq>\n<the chat's event>     (ch: its hello, cr: the end of its replay)

// A window that's stopped reading (a phone asleep with its connection open, say) would pile up everything
// it's sent, in memory here, for as long as it stayed connected. Once it's far behind and has stayed there it's
// cut off, and asks for what it missed when it's back. Far behind for a moment is fine: a long chat's replay
// is a lot at once, and a window that's reading gets through it. Any further behind than HARD_MAX and it goes
// at once, however little time that took; picking up from where it got to, it still gets the rest.
const BEHIND_MAX = 16 * 1024 * 1024, BEHIND_MS = 30000, HARD_MAX = 256 * 1024 * 1024;
function boundedWrite(res, text, now = Date.now()) {
  const queued = res.writableLength;
  if (queued > BEHIND_MAX) {
    if (!res.behindSince) res.behindSince = now;
    if (queued > HARD_MAX || now - res.behindSince > BEHIND_MS) { try { res.destroy(); } catch { /* gone */ } return false; }
  } else if (res.behindSince) res.behindSince = 0;
  try { res.write(text); return true; } catch { return false; }
}

function createStreams() {
  const streams = new Map();   // id -> { res, subs: Map(sub -> { chat, client }) }

  // What a chat writes to its clients, as a window's stream needs it. (chat.emit writes
  // "id: <seq>\nevent: chat\ndata: <json>\n\n".)
  const clientFor = (st, sub) => ({
    write(data) {
      const m = /^id: (\d+)\n/.exec(data);
      boundedWrite(st.res, `event: c\ndata: ${sub} ${m ? m[1] : 0}\ndata: ${data.slice(data.indexOf('data: ') + 6)}`);
    },
  });
  const drop = (st, sub) => { const x = st.subs.get(sub); if (x) { x.chat.clients.delete(x.client); st.subs.delete(sub); } };

  // A window connected (or reconnected: what it had is dropped, and it asks again).
  function open(id, res) {
    // Its old connection may not have noticed it's gone: nothing more goes down it, and it's ended.
    const was = streams.get(id);
    if (was) { for (const sub of [...was.subs.keys()]) drop(was, sub); try { was.res.end(); } catch { /* gone */ } }
    const st = { res, subs: new Map() };
    streams.set(id, st);
    res.write('event: mux\ndata: 1\n\n');
    return () => {
      for (const sub of [...st.subs.keys()]) drop(st, sub);
      if (streams.get(id) === st) streams.delete(id);
    };
  }
  // Its chat's hello, then what's happened since `after`, then the end of the replay, then what happens.
  function watch(id, sub, chat, after = 0) {
    const st = streams.get(id);
    if (!st) return false;
    drop(st, sub);
    const client = clientFor(st, sub);
    boundedWrite(st.res, `event: ch\ndata: ${sub} 0\ndata: ${JSON.stringify(chat.info())}\n\n`);
    for (const ev of chat.buffer) if (ev.seq > after && !boundedWrite(st.res, `event: c\ndata: ${sub} ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`)) return true;   // cut off: it asks again from where it got to
    boundedWrite(st.res, `event: cr\ndata: ${sub} 0\ndata: {}\n\n`);
    chat.clients.add(client);
    st.subs.set(sub, { chat, client });
    return true;
  }
  function unwatch(id, sub) { const st = streams.get(id); if (st) drop(st, sub); }

  return { open, watch, unwatch, has: id => streams.has(id), size: () => streams.size };
}

const cleanId = s => String(s || '').replace(/[^\w-]/g, '').slice(0, 48);

module.exports = { createStreams, cleanId, boundedWrite };
