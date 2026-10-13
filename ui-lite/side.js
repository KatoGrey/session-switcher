'use strict';
/* The side chat: a sub-chat beside the one you're in, in the side panel. It starts knowing this
   chat's latest messages, so a quick question or a try at something doesn't derail the chat. It's a
   real chat: it stays under its parent in the sidebar, and opens in full from its header. */

const SD = { parent: null, key: null, sessionId: null, provider: null, items: [], live: '', busy: false, error: null, es: null, pending: '' };

function resetSide() {
  if (SD.es) SD.es.close();
  Object.assign(SD, { parent: null, key: null, sessionId: null, provider: null, items: [], live: '', busy: false, error: null, es: null, pending: '' });
}
function openSideChat() {
  if (SD.parent !== CV.id) resetSide();   // another chat: a fresh side chat
  SD.parent = CV.id;
  if (VW.open && VW.target && VW.kind !== 'side') VW.back.push({ kind: VW.kind, target: VW.target });
  Object.assign(VW, { open: true, chat: CV.id, kind: 'side', target: 'side', data: null, error: null, loading: false });
  paintViewer();
  setTimeout(() => $('sideBox')?.focus(), 30);
}

// What you asked, without the context it was sent with.
const sideAsked = t => String(t || '').split('Help with this:\n\n').pop();
function sideFeedHtml() {
  // Your first question shows at once, while the side chat starts (it takes a few seconds).
  if (SD.pending && !SD.items.length) return `<div class="msg-you">${esc(SD.pending).replace(/\n/g, '<br>')}</div><p class="sd-note"><span class="live-dot"></span> Starting the side chat…</p>`;
  if (!SD.key && !SD.sessionId) {
    return `<p class="empty-note">Ask or try something beside this chat. The side chat starts knowing this chat’s latest messages and stays under it in the sidebar; this chat isn’t touched.</p>${SD.error ? `<p class="sd-err">${esc(SD.error)}</p>` : ''}`;
  }
  const out = [];
  for (const it of SD.items) {
    if (it.kind === 'user') out.push(`<div class="msg-you">${esc(sideAsked(it.text)).replace(/\n/g, '<br>')}</div>`);
    else if (it.kind === 'assistant') {
      const blocks = it.blocks || [];
      const steps = blocks.filter(b => b.type === 'tool').length;
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
      if (steps) out.push(`<p class="sd-steps">${steps} step${steps === 1 ? '' : 's'}</p>`);
      if (text) out.push(`<div class="msg-ai">${mdHtml(text, { session: SD.sessionId })}</div>`);
    } else if (it.kind === 'permission') out.push('<p class="sd-note">It’s asking to do something. Open it in full to answer.</p>');
    else if (it.kind === 'notice' && it.text) out.push(`<p class="sd-note">${esc(it.text)}</p>`);
  }
  if (SD.live) out.push(`<div class="msg-ai live">${mdHtml(SD.live, { session: SD.sessionId })}</div>`);
  if (SD.busy && !SD.live) out.push('<p class="sd-note"><span class="live-dot"></span> Working…</p>');
  if (SD.error) out.push(`<p class="sd-err">${esc(SD.error)}</p>`);
  return out.join('');
}
function sideBody() {
  return `<div class="sd"><div class="sd-feed" id="sideFeed">${sideFeedHtml()}</div>
    <form class="sd-f" id="sideForm" autocomplete="off"><textarea id="sideBox" class="field" rows="2" placeholder="${SD.sessionId ? 'Reply…' : 'Ask something quick…'}" aria-label="Side chat message"></textarea><button class="btn prime" type="submit">${SD.sessionId ? 'Send' : 'Start'}</button></form></div>`;
}
// Only the messages redraw while it works, so what you're typing stays put.
function paintSide() {
  const f = $('sideFeed');
  if (!f || VW.kind !== 'side') return paintViewer();
  const stick = f.scrollHeight - f.scrollTop - f.clientHeight < 80;
  f.innerHTML = sideFeedHtml();
  if (stick) f.scrollTop = f.scrollHeight;
  const h = $('viewer')?.querySelector('.vw-h');
  if (h) h.outerHTML = viewerHead();
}

function sideListen(key) {
  if (SD.es) SD.es.close();
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  SD.es = es;
  es.addEventListener('hello', e => { try { const info = JSON.parse(e.data); SD.sessionId = info.sessionId || SD.sessionId; SD.busy = ['busy', 'waiting', 'starting'].includes(info.state); } catch { /* fine */ } paintSide(); });
  es.addEventListener('chat', e => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (SD.key !== key) return;
    if (ev.kind === 'init' && ev.sessionId) SD.sessionId = ev.sessionId;
    else if (ev.kind === 'user') { SD.items.push(ev); SD.busy = true; }
    else if (ev.kind === 'delta') { if (!ev.thinking) SD.live += ev.text || ''; }
    else if (ev.kind === 'assistant') {
      SD.live = '';
      const last = SD.items[SD.items.length - 1];
      if (last && last.kind === 'assistant' && last.mid === ev.mid) last.blocks = mergeBlocks(last.blocks, ev.blocks);
      else SD.items.push({ ...ev, blocks: [...(ev.blocks || [])] });
    } else if (ev.kind === 'permission' || ev.kind === 'notice') SD.items.push(ev);
    else if (ev.kind === 'result') { SD.busy = false; SD.live = ''; if (!ev.ok && (ev.errors || []).length) SD.error = ev.errors.join(' '); }
    else if (ev.kind === 'ended' || (ev.kind === 'state' && ev.state === 'ended')) { SD.busy = false; es.close(); SD.es = null; SD.key = null; }
    paintSide();
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && SD.es === es) { SD.es = null; SD.key = null; } };
}

async function sendSide() {
  const box = $('sideBox'); if (!box) return;
  const text = box.value.trim(); if (!text) return;
  box.value = ''; SD.error = null; SD.busy = true; paintSide();
  try {
    if (!SD.sessionId && !SD.key) {
      SD.pending = text; paintSide();
      const r = await api('/api/side-chat', { id: SD.parent, text }).finally(() => { SD.pending = ''; });
      Object.assign(SD, { key: r.key, sessionId: r.sessionId, provider: r.provider });
      sideListen(r.key);
      sfx('slide');
      return;
    }
    // It stopped since (an idle chat is stopped after a while): picked up again first.
    if (!SD.key) {
      const info = await api('/api/chat/open', { sessionId: SD.sessionId, mode: 'resume', ...(SD.provider === 'codex' ? { provider: 'codex' } : {}) });
      SD.key = info.key; SD.items = []; sideListen(info.key);
      for (let i = 0; i < 60 && SD.key && !SD.items.length && SD.busy; i++) await new Promise(r => setTimeout(r, 250));
    }
    await api('/api/chat/send', { key: SD.key, text });
    sfx('slide');
  } catch (err) {
    SD.busy = false; SD.error = err.message;
    if (!$('sideBox').value) $('sideBox').value = text;
    paintSide();
  }
}

document.addEventListener('submit', e => { if (e.target.id !== 'sideForm') return; e.preventDefault(); sendSide(); });
document.addEventListener('keydown', e => {
  if (e.target.id === 'sideBox' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !TOUCH()) { e.preventDefault(); sendSide(); }
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sidechat], [data-sideopen], [data-sidenew]'); if (!b) return;
  e.preventDefault();
  if (b.dataset.sidechat !== undefined) return void openSideChat();
  if (b.dataset.sidenew !== undefined) { const p = SD.parent; resetSide(); SD.parent = p; paintViewer(); setTimeout(() => $('sideBox')?.focus(), 30); return; }
  if (SD.sessionId) { const id = SD.sessionId; closeViewer(); openChat(id); }
});
