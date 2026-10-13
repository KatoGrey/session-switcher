'use strict';
/* A side question: something quick ("what does this flag do?") asked beside the chat, without
   derailing it. A separate chat in the same project answers it; it can only look, not change files,
   and it's told this chat's latest messages. It shows in a small card over the chat; closing the card
   ends it (it's kept under Done). "/btw …" in the message box, or the chat's ⋯ menu. */

const Aside = { key: null, es: null, text: new Map(), order: [], busy: false, q: [], gen: 0, seq: 0, starting: null };

function asideCard() {
  let card = $c('cAside');
  if (card) return card;
  document.querySelector('.c-dock').insertAdjacentHTML('beforebegin', `<section class="aside-card" id="cAside" hidden aria-label="Side question">
    <header class="as-h"><span class="glyph" aria-hidden="true">❦</span><b>Side question</b><small title="A separate chat answers it, so it uses a little of your account’s room">a separate chat answers; this one isn’t touched</small><button type="button" class="icon as-x" data-as="close" aria-label="Close the side question">✕</button></header>
    <div class="as-body" aria-live="polite"></div>
    <form class="as-f"><textarea rows="1" placeholder="Ask something quick…" aria-label="Side question"></textarea><button type="submit" class="btn sm">Ask</button></form>
    <p class="as-b"><button type="button" class="btn quiet sm" data-as="bring">Put it in my message</button></p>
  </section>`);
  card = $c('cAside');
  card.addEventListener('click', e => { const b = e.target.closest('[data-as]'); if (!b) return; if (b.dataset.as === 'close') closeAside(); if (b.dataset.as === 'bring') bringAside(); if (b.dataset.as === 'allow' || b.dataset.as === 'deny') wrap(asideAnswer)(b); });
  card.querySelector('.as-f').addEventListener('submit', wrap(async e => {
    e.preventDefault();
    const ta = card.querySelector('textarea'), q = ta.value.trim(); if (!q) return;
    ta.value = '';
    await askAside(q);
  }));
  card.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); card.querySelector('.as-f').requestSubmit(); } if (e.key === 'Escape') { e.stopPropagation(); closeAside(); } });
  return card;
}
async function askAside(q) {
  if (!C.key) { toast('Open the chat first.'); return; }
  const card = asideCard();
  card.hidden = false;
  // Still starting the first one: this question waits its turn (one side chat, not two).
  if (Aside.starting) { await Aside.starting.catch(() => {}); if (!Aside.key) return; }
  const gen = Aside.gen;
  Aside.q.push(q);
  Aside.busy = true;
  renderAside();
  try {
    if (Aside.key) { await api('/api/chat/send', { key: Aside.key, text: q }); return; }
    Aside.starting = api('/api/chat/aside', { key: C.key, text: q });
    const r = await Aside.starting;
    if (gen !== Aside.gen) { api('/api/chat/aside-end', { key: r.key }).catch(() => {}); return; }   // closed meanwhile
    Aside.key = r.key; Aside.seq = 0;
    const es = Aside.es = new EventSource(`/api/chat/events?key=${encodeURIComponent(r.key)}&token=${TOKEN}&after=0`);
    es.addEventListener('chat', e => {
      if (Aside.es !== es) return;
      try {
        const ev = JSON.parse(e.data);
        if (ev.seq && ev.seq <= Aside.seq) return;   // replayed after a reconnect: already shown
        if (ev.seq) Aside.seq = ev.seq;
        asideEvent(ev);
      } catch (err) { console.error(err); }
    });
  } catch (err) {
    if (gen === Aside.gen) { Aside.busy = false; renderAside(); }
    throw err;
  } finally { Aside.starting = null; }
}
function asideEvent(ev) {
  // It ended (stopped, or its account ran out): the next question starts a fresh one.
  if (ev.kind === 'ended') { if (Aside.es) Aside.es.close(); Aside.es = null; Aside.key = null; }
  if (ev.kind === 'delta' && !ev.thinking && ev.mid) { if (!Aside.text.has(ev.mid)) Aside.order.push(ev.mid); Aside.text.set(ev.mid, (Aside.text.get(ev.mid) || '') + ev.text); renderAsideSoon(); }
  else if (ev.kind === 'assistant' && ev.mid) {
    const t = (ev.blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    if (!Aside.text.has(ev.mid)) Aside.order.push(ev.mid);
    if (t) Aside.text.set(ev.mid, t); else if (!Aside.text.get(ev.mid)) { Aside.text.delete(ev.mid); Aside.order = Aside.order.filter(m => m !== ev.mid); }
    renderAsideSoon();
  } else if (ev.kind === 'result' || ev.kind === 'ended') { Aside.busy = false; Aside.perm = null; renderAside(); }
  else if (ev.kind === 'permission') { Aside.perm = ev; renderAside(); }
  else if (ev.kind === 'permission_done' || ev.kind === 'permission_cancel') { Aside.perm = null; renderAside(); }
}
let asideRaf = 0;
function renderAsideSoon() { if (!asideRaf) asideRaf = requestAnimationFrame(() => { asideRaf = 0; renderAside(); }); }
function renderAside() {
  const card = $c('cAside'); if (!card) return;
  const body = card.querySelector('.as-body');
  const answer = Aside.order.map(m => Aside.text.get(m)).filter(Boolean).join('\n\n');
  const p = Aside.perm;
  body.innerHTML = `${Aside.q.map(q => `<p class="as-q">${esc(q)}</p>`).join('')}${answer ? `<div class="as-a md">${md(answer)}</div>` : ''}${p ? `<p class="as-perm">It wants to ${esc(wantsTo(p))}. <button type="button" class="btn sm" data-as="allow">Allow</button> <button type="button" class="btn quiet sm" data-as="deny">Deny</button></p>` : ''}${Aside.busy ? `<p class="as-wait"><span class="gen-spin" aria-hidden="true"></span>${Aside.key ? 'Thinking it over…' : 'Starting a separate chat… (a few seconds; it uses a little of your account’s room)'}</p>` : ''}`;
  body.scrollTop = body.scrollHeight;
  card.querySelector('[data-as="bring"]').hidden = !answer || Aside.busy;
}
async function asideAnswer(b) {
  const p = Aside.perm; if (!p || !Aside.key) return;
  Aside.perm = null; renderAside();
  await api('/api/chat/permission', { key: Aside.key, requestId: p.requestId, decision: b.dataset.as, message: '' });
}
// The question and its answer, quoted into your message to the chat.
function bringAside() {
  const answer = Aside.order.map(m => Aside.text.get(m)).filter(Boolean).join('\n\n');
  if (!answer) return;
  placeText(`Side question: ${Aside.q.join(' / ')}\n\n${answer.split('\n').map(l => `> ${l}`).join('\n')}\n\n`, false);
  closeAside();
}
function closeAside() {
  const key = Aside.key;
  if (Aside.es) Aside.es.close();
  Object.assign(Aside, { key: null, es: null, text: new Map(), order: [], busy: false, q: [], perm: null, seq: 0, gen: Aside.gen + 1 });
  const card = $c('cAside'); if (card) { card.hidden = true; card.querySelector('.as-body').innerHTML = ''; }
  if (key) api('/api/chat/aside-end', { key }).catch(() => {});
}
function openAside(q = '') {
  const card = asideCard();
  card.hidden = false;
  if (q) return askAside(q);
  card.querySelector('textarea').focus();
  return undefined;
}
