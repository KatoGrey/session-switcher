'use strict';
/* Both / All: Claude, Codex and Gemini in one chat (the full app's crews, lib/pairs.js). A message
   goes to this chat, to one of its partners (another assistant working in the same folder, caught up
   on this chat first), or to all of them in turn. The partners' replies show in this chat's feed,
   named. */

const NAME_OF = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
// The open chat's running partners, by key: { key, prov, es, live, busy }.
const PARTNERS = new Map();
// What the rest of the page reads: whether any partner is working, the words of the one replying,
// and (prov) the chat's last partner, named when nothing else says which.
const PARTNER = {
  get busy() { return [...PARTNERS.values()].some(p => p.busy); },
  get live() { const p = [...PARTNERS.values()].find(x => x.live); return p ? p.live : ''; },
  get key() { return PARTNERS.size ? [...PARTNERS.keys()][0] : null; },
  prov: null,
};
const selfKind = () => (provNow() === 'codex' || provNow() === 'ollama' ? 'codex' : provNow() === 'gemini' ? 'gemini' : 'claude');
const partnerProv = () => { const p = [...PARTNERS.values()].find(x => x.live || x.busy); return (p && p.prov) || PARTNER.prov || (selfKind() === 'claude' ? 'codex' : 'claude'); };
const partnerName = () => NAME_OF[partnerProv()];
const selfName = () => NAME_OF[selfKind()];
// The others that can answer in this chat: the ones you have (a Claude or ChatGPT plan, Gemini set up).
const crewKindsLite = () => ['claude', 'codex', 'gemini'].filter(k => k !== selfKind() && (k === 'gemini' ? !!S.gemini : hasProv(k)));
// "partner" (from before there could be several) means the chat's last partner.
const toKind = to => (to === 'partner' ? partnerProv() : String(to || '').startsWith('partner:') ? to.slice(8) : null);
const toName = to => (to === 'both' ? (crewKindsLite().length > 1 ? 'All' : 'Both') : to && to !== 'chat' ? NAME_OF[toKind(to)] : selfName());
// What a message says about who it's for: one partner (started and caught up if need be), or all in
// turn (the chat first, then each of the others, each knowing what the ones before said).
function toBody(to) {
  if (!to || to === 'chat') return {};
  const ks = crewKindsLite();
  if (to === 'both') return ks.length > 1 ? { to: 'all', kinds: ks } : { to: 'both', ...(ks[0] ? { kind: ks[0] } : {}) };
  return { to: 'partner', kind: toKind(to) };
}

// Where your messages go in this chat, remembered per chat on this device.
const TO_KEY = 'lite-send-to';
function toFor(id) { try { return (JSON.parse(localStorage.getItem(TO_KEY) || '{}')[String(id)]) || 'chat'; } catch { return 'chat'; } }
function setTo(id, to) {
  try { const m = JSON.parse(localStorage.getItem(TO_KEY) || '{}'); if (to === 'chat') delete m[String(id)]; else m[String(id)] = to; localStorage.setItem(TO_KEY, JSON.stringify(m)); } catch { /* fine */ }
}

function partnerReset() {
  for (const p of PARTNERS.values()) if (p.es) p.es.close();
  PARTNERS.clear();
  PARTNER.prov = null;
}
// The running partners of this chat (the live list names them; from before crews, just the one).
function partnerFind() {
  if (!CV.key) return;
  const lead = (S.live || []).find(x => x.key === CV.key);
  if (!lead) return;
  const crew = lead.crew && lead.crew.length ? lead.crew : lead.companionKey ? [{ key: lead.companionKey, provider: lead.companionProvider || null }] : [];
  for (const m of crew) if (!PARTNERS.has(m.key)) partnerListen(m.key, m.provider);
  if (lead.companionProvider) PARTNER.prov = lead.companionProvider;
}
function partnerListen(key, prov) {
  const me = { key, prov: prov || (selfKind() === 'claude' ? 'codex' : 'claude'), es: null, live: '', busy: false };
  PARTNERS.set(key, me);
  const name = () => NAME_OF[me.prov];
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  me.es = es;
  es.addEventListener('chat', e => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (PARTNERS.get(key) !== me) return;
    switch (ev.kind) {
      case 'delta': if (!ev.thinking) { me.live += ev.text || ''; me.busy = true; paintLive(); } break;
      case 'assistant': {
        me.live = '';
        // Its replies join this chat's feed, named; a repeat of one already shown (the replay when
        // the stream reconnects) only updates it.
        const had = CV.items.find(x => x.kind === 'assistant' && x.partner && x.mid === ev.mid);
        if (had) had.blocks = mergeBlocks(had.blocks, ev.blocks);
        else CV.items.push({ ...ev, partner: name(), blocks: [...(ev.blocks || [])] });
        paintFeed(); break;
      }
      case 'notice': CV.items.push({ ...ev, text: `${name()}: ${ev.text || ''}` }); appendItem(CV.items[CV.items.length - 1]); break;
      case 'permission': { const n = { kind: 'notice', level: 'warning', text: `${name()} is asking to do something. Answer it in the full app.` }; CV.items.push(n); appendItem(n); break; }
      case 'state': me.busy = ['busy', 'waiting', 'starting'].includes(ev.state); if (ev.state === 'ended') { es.close(); PARTNERS.delete(key); } paintStatus(); break;
      case 'result': me.busy = false; me.live = ''; paintLive(); paintStatus(); break;
      default: break;
    }
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && PARTNERS.get(key) === me) PARTNERS.delete(key); };
}
// After a message to a partner or to all, their streams are picked up once they're running.
function partnerSoon(want = []) {
  let n = 0;
  const have = () => want.every(k => [...PARTNERS.values()].some(p => p.prov === k)) && PARTNERS.size > 0;
  const tick = async () => { if (have() || n++ > 20) return; try { await loadLive(); } catch { /* next time */ } partnerFind(); if (!have()) setTimeout(tick, 1500); };
  setTimeout(tick, 800);
}

// Opening a chat that has partners: their replies (not the catch-ups they were sent) join the feed
// in time order, so a Both or All chat reads the same after a reload.
async function partnerHistory(id) {
  try {
    const { thread, provider, crew } = await api(`/api/lite/companion?id=${encodeURIComponent(id)}`);
    if (CV.id !== id) return;
    const threads = Object.entries(crew && Object.keys(crew).length ? crew : thread ? { [provider || (provNow() === 'codex' ? 'claude' : 'codex')]: thread } : {}).filter(([k, t]) => t && k !== selfKind());
    if (!threads.length) return;
    if (!PARTNER.prov) PARTNER.prov = provider || threads[0][0];
    const t = it => (it.at ? Date.parse(it.at) : NaN);
    const lists = await Promise.all(threads.map(async ([prov, th]) => {
      const h = await api(`/api/chat/history?${new URLSearchParams({ id: th, lite: '1', ...(prov !== 'claude' ? { provider: prov } : {}) })}`).catch(() => ({ items: [] }));
      return (h.items || []).filter(it => it.kind === 'assistant').map(it => ({ ...it, partner: NAME_OF[prov] }));
    }));
    const theirs = lists.flat().sort((a, b) => (t(a) || 0) - (t(b) || 0));
    if (!theirs.length || CV.id !== id) return;
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
