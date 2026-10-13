'use strict';
/* Both: Claude and Codex in one chat (the full app's pairs, lib/pairs.js). A message goes to this
   chat, to its partner (the other assistant, working in the same folder and caught up on this
   chat first), or to both, taking turns. The partner's replies show in this chat's feed, named. */

const PARTNER = { key: null, es: null, live: '', busy: false };
const NAME_OF = { claude: 'Claude', codex: 'Codex' };
const partnerName = () => NAME_OF[provNow() === 'codex' ? 'claude' : 'codex'];
const selfName = () => NAME_OF[provNow() === 'codex' ? 'codex' : 'claude'];

// Where your messages go in this chat, remembered per chat on this device.
const TO_KEY = 'lite-send-to';
function toFor(id) { try { return (JSON.parse(localStorage.getItem(TO_KEY) || '{}')[String(id)]) || 'chat'; } catch { return 'chat'; } }
function setTo(id, to) {
  try { const m = JSON.parse(localStorage.getItem(TO_KEY) || '{}'); if (to === 'chat') delete m[String(id)]; else m[String(id)] = to; localStorage.setItem(TO_KEY, JSON.stringify(m)); } catch { /* fine */ }
}

function partnerReset() {
  if (PARTNER.es) PARTNER.es.close();
  Object.assign(PARTNER, { key: null, es: null, live: '', busy: false });
}
// The running partner of this chat, if it has one (the live list names it).
function partnerFind() {
  if (!CV.key) return;
  const lead = (S.live || []).find(x => x.key === CV.key);
  const k = lead && lead.companionKey;
  if (k && k !== PARTNER.key) partnerListen(k);
}
function partnerListen(key) {
  partnerReset();
  PARTNER.key = key;
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  PARTNER.es = es;
  es.addEventListener('chat', e => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (PARTNER.key !== key) return;
    switch (ev.kind) {
      case 'delta': if (!ev.thinking) { PARTNER.live += ev.text || ''; PARTNER.busy = true; paintLive(); } break;
      case 'assistant': {
        PARTNER.live = '';
        // Its replies join this chat's feed, named; a repeat of one already shown (the replay when
        // the stream reconnects) only updates it.
        const had = CV.items.find(x => x.kind === 'assistant' && x.partner && x.mid === ev.mid);
        if (had) had.blocks = mergeBlocks(had.blocks, ev.blocks);
        else CV.items.push({ ...ev, partner: partnerName(), blocks: [...(ev.blocks || [])] });
        paintFeed(); break;
      }
      case 'notice': CV.items.push({ ...ev, text: `${partnerName()}: ${ev.text || ''}` }); appendItem(CV.items[CV.items.length - 1]); break;
      case 'permission': { const n = { kind: 'notice', level: 'warning', text: `${partnerName()} is asking to do something. Answer it in the full app.` }; CV.items.push(n); appendItem(n); break; }
      case 'state': PARTNER.busy = ['busy', 'waiting', 'starting'].includes(ev.state); if (ev.state === 'ended') { es.close(); PARTNER.es = null; PARTNER.key = null; } paintStatus(); break;
      case 'result': PARTNER.busy = false; PARTNER.live = ''; paintLive(); paintStatus(); break;
      default: break;
    }
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && PARTNER.es === es) { PARTNER.es = null; PARTNER.key = null; } };
}
// After a message to the partner or to both, its stream is picked up once it's running.
function partnerSoon() {
  let n = 0;
  const tick = async () => { if (PARTNER.key || n++ > 20) return; try { await loadLive(); } catch { /* next time */ } partnerFind(); if (!PARTNER.key) setTimeout(tick, 1500); };
  setTimeout(tick, 800);
}


// Opening a chat that has a partner: its replies (not the catch-ups it was sent) join the feed in
// time order, so a Both chat reads the same after a reload.
async function partnerHistory(id) {
  try {
    const { thread } = await api(`/api/lite/companion?id=${encodeURIComponent(id)}`);
    if (!thread || CV.id !== id) return;
    const prov = provNow() === 'codex' ? 'claude' : 'codex';
    const h = await api(`/api/chat/history?${new URLSearchParams({ id: thread, lite: '1', ...(prov === 'codex' ? { provider: 'codex' } : {}) })}`);
    const theirs = (h.items || []).filter(it => it.kind === 'assistant').map(it => ({ ...it, partner: NAME_OF[prov] }));
    if (!theirs.length || CV.id !== id) return;
    const t = it => (it.at ? Date.parse(it.at) : NaN);
    const out = []; let i = 0, j = 0;
    const mine = CV.items;
    while (i < mine.length || j < theirs.length) {
      if (j >= theirs.length) out.push(mine[i++]);
      else if (i >= mine.length) out.push(theirs[j++]);
      else if (!(t(theirs[j]) < t(mine[i]))) out.push(mine[i++]);
      else out.push(theirs[j++]);
    }
    CV.items = out;
  } catch { /* the chat reads fine without them */ }
}
