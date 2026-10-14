'use strict';
/* A chat in Lite: its conversation, and one quiet input bar.
   Reading a chat never starts anything: the history comes from disk, and the live stream is joined
   only if the chat is already running here. The chat is resumed on the first message you send.
   New chat is the same input bar on its own page, with the project, the assistant and how much it
   may do on its own as chips above it. */

const PERM_LABELS = {
  default: 'Ask before edits', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto', bypassPermissions: 'Bypass permissions',
  ask: 'Ask before acting', agent: 'Agent', 'read-only': 'Read only', full: 'Full access',
};
const permFam = provider => (provider === 'codex' ? 'codex' : 'claude');
const permDefault = provider => { const f = permFam(provider); return (S.lite.permissions && S.lite.permissions[f]) || (S.appPermissions && S.appPermissions[f]) || (f === 'claude' ? 'default' : 'agent'); };

/* ---------- Markdown, just enough (escaped first; links only to http(s)) ---------- */
// Pictures a reply names: a Markdown image, a link or address ending in .png/.jpg/.gif/.webp, or a
// file path in code. Each shows as a small picture under the paragraph that names it (click to
// enlarge). Files come from the chat's own folders through /api/image; ones that can't load hide.
const IMG_EXT = /\.(png|jpe?g|gif|webp)(\?[^\s]*)?$/i;
function picSrc(ref, session) {
  if (/^https?:\/\//i.test(ref) || /^data:image\//.test(ref)) return ref;
  if (!session) return null;
  return `/api/image?${new URLSearchParams({ token: TOKEN, path: ref.replace(/^file:\/\//, ''), session })}`;
}
function mdHtml(src, { session = typeof CV !== 'undefined' && S.view === 'chat' ? CV.id : null } = {}) {
  const blocks = [];
  let pics = [];
  const pic = ref => { const u = picSrc(ref, session); if (u && !pics.includes(u) && pics.length < 8) pics.push(u); };
  const thumbs = () => { if (!pics.length) return ''; const h = `<div class="md-thumbs">${pics.map(u => `<img src="${esc(u)}" alt="" loading="lazy" data-zoom="1" onerror="this.remove()">`).join('')}</div>`; pics = []; return h; };
  let t = String(src || '').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    code = code.replace(/\n$/, '');
    // HTML can be seen drawn, in a frame that runs no scripts and reaches nothing.
    const html = /^html?$/i.test(lang) ? `<details class="md-html"><summary>Show it drawn</summary><iframe sandbox="" srcdoc="${esc(code)}" title="The HTML, drawn"></iframe></details>` : '';
    blocks.push(`<pre><code>${esc(code)}</code></pre>${html}`); return `\u0000${blocks.length - 1}\u0000`;
  });
  // Code, links and bare addresses are set aside first, so bold and italics can't reach inside them.
  const inline = x => {
    const held = [], hold = h => `\u0001${held.push(h) - 1}\u0001`;
    // A Markdown image shows where it's written.
    x = String(x).replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, alt, ref) => { const u = picSrc(ref, session); return u ? `\u0002${held.push(`<img class="md-img" src="${esc(u)}" alt="${esc(alt)}" data-zoom="1" onerror="this.remove()">`) - 1}\u0002` : alt; });
    return esc(x)
      .replace(/\u0002(\d+)\u0002/g, (m, i) => hold(held[Number(i)]))
      .replace(/`([^`\n]+)`/g, (m, c) => (IMG_EXT.test(c.trim()) && typeof looksLikePath === 'function' && looksLikePath(c.trim()) ? pic(c.trim()) : null, hold(`<code${typeof looksLikePath === 'function' && looksLikePath(c) ? ' class="vpath" title="Open beside the chat"' : ''}>${c}</code>`)))
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, href) => (IMG_EXT.test(href) && pic(href), hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)))
      // A link to a file (a relative path, ~/…, /Users/…) opens it beside the chat.
      .replace(/\[([^\]\n]+)\]\(((?:~|\.{0,2}\/|[\w@-])[^\s)]*?)\)/g, (m, label, href) => (/^[a-z]+:/i.test(href) ? m : (IMG_EXT.test(href) && pic(href), hold(`<a href="#" class="vlink" data-viewfile="${href}">${label}</a>`))))
      // A bare address is a link too (without the full stop or bracket that ends its sentence).
      .replace(/\bhttps?:\/\/[^\s<>"')\]]+/g, u => { const t = u.replace(/(&quot;|&#39;|[.,;:!?*_])+$/, ''); if (IMG_EXT.test(t)) pic(t.replace(/&amp;/g, '&')); return hold(`<a href="${t}" target="_blank" rel="noopener noreferrer">${t}</a>`) + u.slice(t.length); })
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<i>$2</i>')
      .replace(/\u0001(\d+)\u0001/g, (m, i) => held[Number(i)]);
  };
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } const th = thumbs(); if (th) out.push(th); };
  const lines = t.split('\n');
  // A table: a row of cells, a |---|:--:| line under it, then its rows. Cells may hold links and code.
  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const isRule = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = /^\u0000(\d+)\u0000$/.exec(line.trim());
    if (code) { flush(); out.push(blocks[Number(code[1])]); continue; }
    if (line.includes('|') && isRule(lines[i + 1]) && (lines[i + 1].includes('|') || cells(line).length > 1)) {
      flush();
      const align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      const td = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${inline(c)}</${tag}>`;
      const head = cells(line).map((c, j) => td('th', c, j)).join('');
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(`<tr>${cells(lines[i]).map((c, j) => td('td', c, j)).join('')}</tr>`);
      i--;
      out.push(`<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    let m;
    if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flush();
      const q = [m[1]];
      while (i + 1 < lines.length && (m = /^\s*>\s?(.*)$/.exec(lines[i + 1]))) { q.push(m[1]); i++; }
      out.push(`<blockquote>${q.map(x => (x.trim() ? `<p>${inline(x)}</p>` : '')).join('')}</blockquote>`);
      continue;
    }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; } list.items.push(inline(m[1])); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; } list.items.push(inline(m[1])); continue; }
    flush();
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { out.push(`<p class="h">${inline(m[2])}</p>`); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); continue; }
    if (!line.trim()) { out.push(''); continue; }
    out.push(`<p>${inline(line)}</p>`);
    const th = thumbs(); if (th) out.push(th);
  }
  flush();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
}

/* ---------- what a turn did, in one line ---------- */
const STEP_WORDS = { Read: ['read', 'file', 'files'], Edit: ['edited', 'file', 'files'], MultiEdit: ['edited', 'file', 'files'], Write: ['wrote', 'file', 'files'], Bash: ['ran', 'command', 'commands'], Grep: ['searched', 'time', 'times'], Glob: ['looked for files', '', ''], WebSearch: ['searched the web', '', ''], WebFetch: ['opened', 'page', 'pages'], Task: ['started', 'helper', 'helpers'], Agent: ['started', 'helper', 'helpers'] };
function stepLine(tools) {
  const n = new Map();
  for (const t of tools) { const k = STEP_WORDS[t.name] ? t.name.replace('MultiEdit', 'Edit') : 'other'; n.set(k, (n.get(k) || 0) + 1); }
  const parts = [];
  for (const [k, c] of n) {
    if (k === 'other') { parts.push(`${c} other step${c === 1 ? '' : 's'}`); continue; }
    const [verb, one1, many] = STEP_WORDS[k];
    parts.push(one1 ? `${verb} ${c} ${c === 1 ? one1 : many}` : verb);
  }
  const s = parts.join(' · ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/* ---------- the chat's state ---------- */
const CV = { id: null, key: null, info: null, items: [], cursor: null, es: null, live: '', status: '', pending: new Map(), busy: false, startedAt: 0, loading: false, error: null, readOnly: null, provider: 'claude', perm: null, sending: false };

function chatTitle() { const c = chatBy.get(CV.id); return c ? c.title : (CV.info && CV.info.title) || 'New chat'; }

// Chats you've been in lately stay in memory, so going back to one shows it at once while it
// catches up. Leaving a chat keeps it; the newest twelve are kept.
const CHAT_CACHE = new Map();
function cacheChat() {
  if (!CV.id || CV.loading || CV.error || !CV.items.length) return;
  CHAT_CACHE.delete(CV.id);
  CHAT_CACHE.set(CV.id, { items: CV.items.filter(x => !x.onTheWay), cursor: CV.cursor, at: Date.now() });
  while (CHAT_CACHE.size > 12) CHAT_CACHE.delete(CHAT_CACHE.keys().next().value);
}
// Each open is numbered; an answer that comes back after you've opened another chat is dropped
// (before, a slow chat's messages could land in the chat you'd moved to).
let openSeq = 0;
async function openChatView(id, { key = null, provider = null, keepRead = false } = {}) {
  const seq = ++openSeq;
  if (CV.id && String(CV.id) !== String(id)) cacheChat();
  if (CV.es) { CV.es.close(); CV.es = null; }
  // When it catches up on a chat you're reading higher up in, you stay where you were; otherwise it opens at the end.
  const readAt = keepRead ? CV.readAt : null;
  Object.assign(CV, { readAt, id, key, inRepo: false, info: null, items: [], queue: queueFor(id), cursor: null, live: '', status: '', pending: new Map(), busy: false, startedAt: 0, loading: true, error: null, readOnly: null, sending: false });
  CV.to = toFor(id); partnerReset();
  CV.progressAt = 0; CV.lastStep = null;
  resetComposer();
  const hit = !keepRead && CHAT_CACHE.get(String(id));
  if (hit) { CV.items = hit.items.slice(); CV.cursor = hit.cursor; CV.loading = false; }
  const c = chatBy.get(id);
  CV.provider = provider || (c ? c.provider : 'claude');
  markSeen(id);
  const x = S.live.find(l => l.sessionId && l.sessionId.toLowerCase() === String(id).toLowerCase());
  if (!key && x && x.key && x.source === 'app' && x.phase !== 'ended') CV.key = x.key;
  // The Commander isn't in the running list; Now knows its key.
  if (!CV.key && S.cmd.key && S.cmd.sessionId && S.cmd.sessionId.toLowerCase() === String(id).toLowerCase()) CV.key = S.cmd.key;
  if (!CV.key && x && x.source !== 'app' && x.working) CV.readOnly = x.source === 'terminal' ? 'It’s running in a terminal. Answer it there, or wait for it to finish.' : 'It’s running in another app (like the Claude desktop app). Answer it there, or wait for it to finish.';
  try {
    let until = null;
    if (CV.key) { const info = await api('/api/chat/attach', { key: CV.key }); if (seq !== openSeq) return; CV.info = info; until = info.bufferFrom || info.startedAt || null; CV.provider = info.provider; }
    const q = new URLSearchParams({ id, lite: '1' });
    if (until) q.set('until', until);
    if (CV.provider === 'codex') q.set('provider', 'codex');
    const h = await api(`/api/chat/history?${q}`);
    if (seq !== openSeq) return;
    let items = h.items || [];
    // The live stream replays everything since this run started; history stops where that begins.
    if (until) { const bf = Date.parse(until) - 1000; const i = items.findIndex(it => it.at && Date.parse(it.at) >= bf); if (i >= 0) items = items.slice(0, i); }
    CV.items = items; CV.cursor = h.cursor || null;
    await partnerHistory(id);
    if (seq !== openSeq) return;
  } catch (err) { if (seq !== openSeq) return; CV.error = hit ? null : err.message; }
  CV.loading = false;
  if (S.view !== 'chat' || CV.id !== id) return;
  paintChat(); paintQueue();
  if (CV.key) { listen(CV.key); partnerFind(); }
  // Anything queued while you were away goes once it's free.
  if (CV.queue.length) setTimeout(sendQueued, 1500);
}
async function loadEarlier() {
  if (!CV.cursor || loadEarlier.busy) return;
  const id = CV.id, seq = openSeq;
  const q = new URLSearchParams({ id, cursor: CV.cursor, lite: '1' });
  if (CV.provider === 'codex') q.set('provider', 'codex');
  loadEarlier.busy = true;
  let h; try { h = await api(`/api/chat/history?${q}`); } finally { loadEarlier.busy = false; }
  // You've moved to another chat since: these belong to the one you left.
  if (seq !== openSeq || CV.id !== id) return;
  const sc = $('feed'), before = sc ? sc.scrollHeight - sc.scrollTop : 0;
  CV.items = [...(h.items || []), ...CV.items]; CV.cursor = h.cursor || null;
  paintFeed();
  if (sc) sc.scrollTop = sc.scrollHeight - before;
}

function listen(key) {
  if (CV.es) CV.es.close();
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  CV.es = es; CV.lastEventAt = Date.now();
  es.addEventListener('hello', e => { CV.lastEventAt = Date.now(); try { CV.info = JSON.parse(e.data); CV.busy = ['busy', 'waiting', 'starting'].includes(CV.info.state) || CV.sending; paintBar(); paintHead(); } catch { /* fine */ } });
  es.addEventListener('chat', e => { CV.lastEventAt = Date.now(); let ev; try { ev = JSON.parse(e.data); } catch { return; } onEvent(ev); });
}
// While it works: the time under it ticks every second, and if the stream has gone quiet for a
// while, Lite asks the server whether the chat actually finished; if it did, it catches up.
let healBusy = false;
setInterval(async () => {
  if (S.view !== 'chat' || !CV.busy || CV.sending) return;
  paintStatus();
  if (!CV.key || healBusy || Date.now() - (CV.lastEventAt || 0) < 15000) return;
  healBusy = true;
  try {
    // The chat itself says whether it's still on its turn (the running list can disagree).
    const key = CV.key, info = await api('/api/chat/attach', { key });
    if (CV.key === key && !['busy', 'starting', 'waiting'].includes(info.state) && S.view === 'chat') {
      const typed = $('msgBox') ? $('msgBox').value : '';
      await openChatView(CV.id, { key: CV.key, keepRead: true });
      if (typed && $('msgBox') && !$('msgBox').value) { $('msgBox').value = typed; autosize($('msgBox')); }
    }
    else CV.lastEventAt = Date.now();
  } catch { /* try again next time */ } finally { healBusy = false; }
}, 1000);
// One message arrives as several events under the same id (its text, then each tool call, and an
// update when a picture finishes): each adds to the message, and a block it already has is updated.
const blockKey = b => (b.id ? `id:${b.id}` : b.type === 'text' ? `text:${b.text}` : b.path ? `path:${b.path}` : JSON.stringify(b));
function mergeBlocks(have = [], more = []) {
  const out = [...have];
  for (const b of more) { const i = out.findIndex(x => blockKey(x) === blockKey(b)); if (i >= 0) out[i] = b; else out.push(b); }
  return out;
}
// When the page joins a turn already under way, the time counts from when the turn began.
const evAt = ev => Date.parse(ev.at) || Date.now();
// Both: a message can carry a catch-up on what the other assistant said; it's for them, not shown.
// A side chat's first message carries this chat's latest messages too; only your question shows.
const ownWords = t => String(t || '').replace(/<shared-context[^>]*>[\s\S]*?<\/shared-context>\s*/g, '').replace(/^[\s\S]*?You're a side chat opened beside[\s\S]*?Help with this:\n\n/, '');
// The last sign of real progress (words, thinking, a step, a question, the end of a turn), from
// each event's own time, so a chat that's gone quiet shows it even right after you open it.
const PROGRESS = new Set(['delta', 'assistant', 'tool_start', 'permission', 'result', 'user']);
function noteProgress(ev) {
  if (!PROGRESS.has(ev.kind)) return;
  const t = ev.at ? Date.parse(ev.at) : Date.now();
  if (!CV.progressAt || t > CV.progressAt) { CV.progressAt = t; CV.lastStep = ev.kind === 'tool_start' || (ev.kind === 'assistant' && (ev.blocks || []).some(b => b.type === 'tool')) ? 'tool' : ev.kind; }
}
function onEvent(ev) {
  noteProgress(ev);
  if (ev.kind === 'user' && ev.text) ev = { ...ev, text: ownWords(ev.text) };
  switch (ev.kind) {
    case 'state':
      // While a first message is on its way, the line under it stays up (no blink as it starts).
      CV.busy = ['busy', 'waiting', 'starting'].includes(ev.state) || CV.sending;
      if (CV.info) CV.info.state = ev.state;
      if (ev.state === 'busy' && !CV.startedAt) CV.startedAt = evAt(ev);
      if (ev.state === 'ended') { CV.busy = false; CV.status = ''; if (CV.es) { CV.es.close(); CV.es = null; } CV.key = null; }
      paintBar(); paintStatus(); break;
    case 'init': if (ev.sessionId && !CV.id) adoptChatId(ev.sessionId); break;
    case 'model': if (CV.info) Object.assign(CV.info, ev); paintBar(); break;
    case 'status': if (ev.permissionMode && CV.info) { CV.info.permissionMode = ev.permissionMode; paintBar(); } break;
    case 'user': {
      // The message you just sent is already on screen; the real one takes its place quietly.
      const same = x => String(x.text || '').trim() === String(ev.text || '').trim();
      const i = CV.items.findIndex(x => x.onTheWay && same(x));
      // (It goes to the bottom: joining a run in progress replays what came before it.)
      if (i >= 0) { const was = CV.items.splice(i, 1)[0]; CV.items.push({ ...ev, images: (was.images || []).length ? was.images : ev.images }); }
      else CV.items.push(ev);
      CV.live = ''; CV.thinking = ''; CV.startedAt = CV.startedAt || evAt(ev); appendItem(ev); break;
    }
    case 'delta': if (!ev.thinking) { CV.live += ev.text || ''; CV.status = 'Writing'; CV.thinking = ''; } else { CV.status = 'Thinking'; if (ev.text) CV.thinking = ((CV.thinking || '') + ev.text).slice(-600); } paintLive(); paintStatus(); break;
    case 'assistant': { CV.live = ''; const last = CV.items[CV.items.length - 1]; if (last && last.kind === 'assistant' && last.mid === ev.mid) last.blocks = mergeBlocks(last.blocks, ev.blocks); else CV.items.push({ ...ev, blocks: [...(ev.blocks || [])] }); paintFeed(); const tool = (ev.blocks || []).filter(b => b.type === 'tool').pop(); if (tool) CV.status = `${tool.name}${tool.summary ? ` · ${tool.summary}` : ''}`; paintStatus(); break; }
    case 'handoff': if (ev.state === 'sent') { const n = { kind: 'notice', level: 'info', text: `${NAME_OF[ev.to] || partnerName()} picks it up now.` }; CV.items.push(n); appendItem(n); } break;
    case 'tool_start': CV.status = `Using ${ev.name}`; CV.thinking = ''; paintStatus(); break;
    case 'notice': CV.items.push(ev); appendItem(ev); break;
    case 'permission': CV.pending.set(ev.requestId, ev); paintPending(); break;
    case 'permission_cancel': case 'permission_done': CV.pending.delete(ev.requestId); paintPending(); break;
    case 'result': CV.busy = false; CV.status = ''; CV.startedAt = 0; CV.live = ''; CV.thinking = ''; setTimeout(sendQueued, 300); markSeen(CV.id); if (!ev.ok && (ev.errors || []).length) { const n = { kind: 'notice', level: 'warning', text: ev.errors.join(' ') }; CV.items.push(n); appendItem(n); } paintLive(); paintStatus(); paintBar(); break;
    default: break;
  }
}

/* ---------- painting ---------- */
function itemHtml(it) {
  if (it.kind === 'user') {
    const text = ownWords(it.text);
    const cmdr = /^From Commander:\s*/.test(text);
    const pics = (it.images || []).map(i => i.src).concat((Array.isArray(it.imgRaw) ? it.imgRaw : []).filter(b => b && b.type === 'image' && b.source && b.source.data).map(b => `data:${b.source.media_type};base64,${b.source.data}`)).filter(src => /^data:image\/(png|jpeg|gif|webp);base64,/.test(src));
    const shown = text.replace(/^From Commander:\s*/, '').split('\n').filter(l => !/^Attached file: `[^`]+`/.test(l.trim()));
    const files = text.split('\n').map(l => /^Attached file: `([^`]+)`/.exec(l.trim())).filter(Boolean).map(m => m[1].split('/').pop());
    return `<div class="msg-you${cmdr ? ' from-cmdr' : ''}">${pics.length ? `<div class="msg-pics">${pics.map(src => `<img src="${src}" alt="" data-zoom="1">`).join('')}</div>` : ''}${cmdr ? '<span class="tag">from Commander</span> ' : ''}${linkText(shown.join('\n').trim())}${files.length ? `<div class="msg-files">${files.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}</div>`;
  }
  if (it.kind === 'assistant') {
    const blocks = it.blocks || [];
    const tools = blocks.filter(b => b.type === 'tool');
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    const steps = tools.length ? `<details class="step"><summary>${esc(stepLine(tools))}</summary><ul>${tools.map(t => { const p = typeof toolPath === 'function' ? toolPath(t) : null; return `<li><b>${esc(t.name)}</b> ${p ? `<button class="linkish vpath-btn" data-viewfile="${esc(p)}" title="Open beside the chat">${esc(t.summary || p)}</button>` : esc(t.summary || '')}</li>`; }).join('')}</ul></details>` : '';
    return `${steps}${text ? `<div class="msg-ai">${mdHtml(text)}</div>` : ''}`;
  }
  if (it.kind === 'notice') {
    // A long notice (a background command finishing prints the whole command) shows one short line;
    // the rest opens on a click.
    const t = String(it.text || ''), lv = esc(it.level || 'info');
    if (t.length <= 160) return `<div class="notice ${lv}">${esc(t)}</div>`;
    const m = /^(Background task \w+):\s*([\s\S]*)$/.exec(t);
    const head = m ? `${m[1]} · ${m[2].replace(/\s+/g, ' ').slice(0, 90)}…` : `${t.replace(/\s+/g, ' ').slice(0, 140)}…`;
    return `<details class="notice ${lv} notice-long"><summary>${esc(head)}</summary><div class="notice-full">${esc(m ? m[2] : t)}</div></details>`;
  }
  return '';
}
// Consecutive tool-only replies read as one step line; the text between them stays. Each message
// (or run of steps) is one segment, so only what changed is redrawn.
function feedSegments() {
  const segs = []; let tools = [];
  // With a partner in the chat (Both), each reply says who wrote it.
  const duo = CV.items.some(x => x.partner);
  const who = it => (duo ? `<span class="who">${esc(it.partner || selfName())}</span>` : '');
  const flushTools = () => { if (tools.length) { segs.push(`<details class="step"><summary>${esc(stepLine(tools))}</summary><ul>${tools.map(t => `<li><b>${esc(t.name)}</b> ${esc(t.summary || '')}</li>`).join('')}</ul></details>`); tools = []; } };
  for (const it of CV.items) {
    if (it.kind === 'assistant') {
      // In the order it happened: what it said, then the steps it took after saying it.
      for (const b of it.blocks || []) {
        if (b.type === 'tool') tools.push(b);
        else if (b.type === 'text' && String(b.text || '').trim()) { flushTools(); segs.push(`<div class="msg-ai${it.partner ? ' from-partner' : ''}">${who(it)}${mdHtml(b.text)}</div>`); }
        else if (b.type === 'image') { flushTools(); segs.push(genImageHtml(b)); }
      }
      continue;
    }
    flushTools();
    segs.push(itemHtml(it));
  }
  flushTools();
  return segs;
}
// A picture Codex drew (its own image tool): a placeholder while it draws, then the picture, its
// prompt, and a button to put it in your next message (to this chat, or after switching chats).
function genImageSrc(b) {
  if (b.src) return b.src;
  if (!b.path) return null;
  const q = new URLSearchParams({ token: TOKEN, path: b.path });
  if (CV.key) q.set('key', CV.key);
  if (CV.id) q.set('session', CV.id);
  return `/api/image?${q}`;
}
function genImageHtml(b) {
  const src = genImageSrc(b);
  const frame = src ? `<img src="${esc(src)}" alt="${esc(b.prompt || 'Generated picture')}" data-zoom="1">`
    : b.status === 'failed' ? `<div class="gen-wait failed">${esc(b.failure || 'The picture couldn’t be made.')}</div>`
    : '<div class="gen-wait"><span class="live-dot"></span>Drawing the picture…</div>';
  return `<figure class="gen-fig ${esc(b.status || '')}">${frame}${b.prompt ? `<figcaption>${esc(b.prompt)}</figcaption>` : ''}${src ? `<div class="gen-act"><button type="button" class="btn sm" data-addimg="${esc(src)}">Add to my message</button></div>` : ''}</figure>`;
}
async function addImageFromUrl(src, { quiet = false } = {}) {
  const r = await fetch(src); if (!r.ok) throw new Error('Couldn’t read that picture.');
  const blob = await r.blob();
  addFiles([new File([blob], 'picture.' + ((blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: blob.type || 'image/png' })]);
  if (!quiet) toast('Added to your message.');
}
// Every picture in this conversation (yours and the ones Codex drew), newest first.
function chatPictures() {
  const out = [];
  for (const it of CV.items || []) {
    if (it.kind === 'user') for (const im of it.images || []) if (im.src) out.push({ src: im.src, who: 'You' });
    if (it.kind === 'assistant') for (const b of it.blocks || []) if (b.type === 'image') { const src = genImageSrc(b); if (src) out.push({ src, who: 'Codex', prompt: b.prompt || '' }); }
  }
  return out.reverse();
}
function picturesMenu(anchor) {
  const pics = chatPictures();
  pop(anchor, `<div class="ph">Pictures in this chat · ${pics.length}</div><div class="pic-grid">${pics.map(p => `<button class="pic" data-v="${esc(p.src)}" title="${esc(p.prompt || p.who)}"><img src="${esc(p.src)}" alt=""></button>`).join('')}</div>`, v => showPicture(v));
}
// The header only changes when what's in it does.
function paintHead() {
  const h = $('chatHead'); if (!h) return;
  const n = chatHead(); if (h._h === n) return;
  h.outerHTML = n; const nh = $('chatHead'); if (nh) nh._h = n;
}

// Every link the chat mentioned (its PRs, previews, local servers, threads), newest first, named
// for what it is, so they're a click away at the top instead of somewhere up the scroll.
function linkLabel(u) {
  let m;
  if ((m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(u))) return { kind: 'pr', label: `PR #${m[2]}${m[1] === 'latitude' ? '' : ` · ${m[1]}`}` };
  if ((m = /\/\/pr-(\d+)\.preview\.(voyage\.io|aidungeon\.com)/.exec(u))) return { kind: 'preview', label: `Preview #${m[1]} · ${m[2] === 'voyage.io' ? 'Voyage' : 'AI Dungeon'}` };
  if ((m = /\/\/(localhost|127\.0\.0\.1)(:\d+)?/.exec(u))) return { kind: 'local', label: `localhost${m[2] || ''}` };
  if ((m = /linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/.exec(u))) return { kind: 'other', label: m[1] };
  if ((m = /github\.com\/[^/]+\/([^/?#]+)/.exec(u))) return { kind: 'other', label: `GitHub · ${m[1]}` };
  if (/slack\.com\/archives\//.test(u)) return { kind: 'other', label: 'Slack thread' };
  if (/discord\.com\/channels\//.test(u)) return { kind: 'other', label: 'Discord' };
  try { const x = new URL(u); return { kind: 'other', label: (x.host.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : '')).slice(0, 48) }; } catch { return { kind: 'other', label: u.slice(0, 48) }; }
}
function chatLinks() {
  const key = `${CV.id}:${CV.items.length}`;
  if (chatLinks.memo && chatLinks.memo.key === key) return chatLinks.memo.list;
  const seen = new Set(), list = [];
  const add = u => {
    u = String(u).replace(/[.,;:!?)\]}>'"`*_]+$/, '');
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u)) return;
    try { const h = new URL(u).hostname; if (!h.includes('.') && h !== 'localhost') return; } catch { return; }
    const k = u.replace(/\/+$/, '');
    if (seen.has(k)) return; seen.add(k); list.push({ url: u, ...linkLabel(u) });
  };
  for (const it of [...CV.items].reverse()) {
    const text = it.kind === 'assistant' ? (it.blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n') : it.kind === 'user' ? it.text || '' : '';
    const found = [...String(text).matchAll(/https?:\/\/[^\s<>()\[\]"'`]+/g)].map(x => x[0]);
    for (const u of found.reverse()) add(u);
  }
  // A bug chat's PR is known even when the chat never wrote its link.
  const c = chatBy.get(CV.id), it = c && typeof pipeItem === 'function' ? pipeItem(c) : null;
  if (it && it.pr && it.pr.url) { add(it.pr.url); const prev = typeof previewUrl === 'function' ? previewUrl(it.pr) : null; if (prev) add(prev); }
  chatLinks.memo = { key, list: list.slice(0, 20) };
  return chatLinks.memo.list;
}
function headLinks() {
  const all = chatLinks(); if (!all.length) return '';
  const top = [all.find(l => l.kind === 'pr'), all.find(l => l.kind === 'preview')].filter(Boolean);
  const chip = l => `<a class="hlink ${l.kind === 'preview' ? 'prev' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${l.kind === 'pr' ? IC.pr : ''}${esc(l.label)}</a>`;
  const rest = all.length - top.length;
  return `<span class="hlinks">${top.map(chip).join('')}${rest > 0 ? `<button class="iconbtn links-btn" data-chatlinks="1" aria-haspopup="menu" title="Every link in this chat, newest first">Links ${all.length}</button>` : ''}</span>`;
}
function linksMenu(anchor) {
  const all = chatLinks();
  pop(anchor, all.map(l => `<button class="lk" data-v="${esc(l.url)}" title="${esc(l.url)}">${esc(l.label)}</button>`).join(''), u => { window.open(u, '_blank', 'noopener'); });
}
function chatHead() {
  const c = chatBy.get(CV.id);
  // A chat the list hasn't caught up with yet still shows where it runs.
  const p = c ? projOf(c) : CV.info && CV.info.cwd ? S.projects.find(x => x.cwd === CV.info.cwd && !x.key.includes('#')) || null : null;
  const st = c ? statusById(statusOf(c)) : null;
  return `<div class="chat-h" id="chatHead"><button class="iconbtn back" data-go="back" aria-label="Back">‹</button>
      <div class="ch-name"><div class="crumb">${p ? `<span>${esc(bucketName(p.bucket))}</span>›<button data-project="${esc(p.key)}">${esc(p.name)}</button>` : ''}</div>${c ? `<button class="ttl" id="chatTitle" data-renamechat="1" title="Rename">${esc(chatTitle())}</button>` : `<span class="ttl" id="chatTitle">${esc(chatTitle())}</span>`}</div>
      ${st ? `${kindTag(c)}${waitTag(c)}<button class="stage" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" title="Status, kind, Focus (s)">${c.focus ? '<span class="focus-star">★</span>' : `<span class="dot" style="background:${st.c}"></span>`}${st.name}</button>` : ''}
      ${(n => (n ? `<button class="iconbtn pics-btn" data-chatpics="1" aria-haspopup="menu" title="Pictures in this chat">${IC.image}<span>${n}</span></button>` : ''))(chatPictures().length)}
      ${headLinks()}
      ${c ? '<button class="iconbtn side-btn" data-sidechat="1" title="Side chat: ask or try something beside this chat, without derailing it">Side chat</button>' : ''}
      ${typeof chatFiles === 'function' && chatFiles().length ? `<button class="iconbtn files-btn" data-viewfiles="1" title="Files this chat read or changed (opens beside the chat)">Files</button>` : ''}
      <button class="iconbtn" data-chatmenu="1" aria-haspopup="menu" aria-label="More">${IC.dots}</button></div>`;
}
// A chat whose folder was deleted can't run until the folder is there again.
function folderNotice() {
  const c = chatBy.get(CV.id);
  const gone = c && (c.folderExists === false || (c.worktree && c.worktreeExists === false));
  if (!gone || (CV.info && CV.info.state && CV.info.state !== 'ended')) return '';
  const dir = c.runDir || c.cwd || '';
  const scratch = /[\\/]scratch-workspaces[\\/]/.test(dir);
  const where = scratch ? 'This chat ran in a Claude scratch folder, which was cleaned up.' : `It ran in <span class="mono">${esc(dir.replace(/^\/Users\/[^/]+/, '~'))}</span>, which was deleted or moved.`;
  if (c.runIsWorktree && c.provider === 'codex') {
    if (CV.inRepo) return `<div class="folder-gone" id="folderGone"><p><b>Asking from the main checkout, read-only.</b> It can look things up (GitHub, Slack, the repo) but won’t change files there. Its branch’s own files aren’t in that folder.</p></div>`;
    return `<div class="folder-gone" id="folderGone"><p><b>Its worktree is gone.</b> ${where} You can still ask it things from the main checkout (read-only), or archive it and rebuild the worktree on the Archived page.</p>
    <button class="btn sm prime" data-inrepo="1">Ask from the main checkout</button></div>`;
  }
  if (c.runIsWorktree) return `<div class="folder-gone" id="folderGone"><p><b>Its worktree is gone.</b> ${where} Archive the chat, then rebuild the worktree from its branch on the Archived page.</p></div>`;
  return `<div class="folder-gone" id="folderGone"><p><b>Its folder is gone.</b> ${where} Make the folder again (empty) and the chat carries on with its whole history; files that were in that folder are gone${scratch ? ', but work it did in your repos is untouched' : ''}.</p>
    <button class="btn sm prime" data-recreate="${esc(c.id)}">Make the folder again</button></div>`;
}
// Click the title to rename it in place: Enter or clicking away saves, Esc leaves it.
function editTitleInline() {
  const el = $('chatTitle'); const c = chatBy.get(CV.id); if (!el || !c) return;
  const inp = document.createElement('input');
  inp.className = 'ttl ttl-edit'; inp.autocomplete = 'off'; inp.setAttribute('autocorrect', 'on'); inp.setAttribute('autocapitalize', 'sentences'); inp.enterKeyHint = 'done'; inp.value = c.title; inp.setAttribute('aria-label', 'Chat name'); inp.maxLength = 120;
  el.replaceWith(inp); inp.focus(); inp.select();
  // Name ideas under the box; picking one renames at once.
  const ideas = document.createElement('div'); ideas.className = 'name-ideas name-ideas-pop';
  inp.after(ideas);
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    ideas.remove();
    const v = inp.value, h = $('chatHead'); if (h) h._h = null; paintHead();
    if (save) wrap(renameChat)(c.id, v);
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
  nameIdeas(ideas, c.id, n => { inp.value = n; finish(true); });
}
function chatView() {
  return `<div class="chat" id="chatView">${chatHead()}
    <div class="feed" id="feed" tabindex="-1"><div class="inner" id="feedInner"></div></div>
    ${folderNotice()}<div class="queue-box" id="queueBox" hidden></div><div class="composer">${composerHtml()}</div>
  </div>`;
}
function paintChat() {
  if (S.view !== 'chat' || !$('chatView')) return;
  const h = $('chatHead'); if (h && !h._h) h._h = chatHead();
  paintFeed(); paintPending(); paintBar(); paintStatus();
  if (typeof paintViewer === 'function') { if (VW.open && VW.chat !== CV.id) closeViewer(); else paintViewer(); }
  const f = $('feed'); f.scrollTop = CV.readAt != null ? CV.readAt : f.scrollHeight;
  // Where you're reading: null at the end (it follows new messages), else how far down you are.
  // Near the top, earlier messages load by themselves (no button to press).
  if (!f._watching) {
    f._watching = true;
    f.addEventListener('scroll', () => {
      CV.readAt = f.scrollHeight - f.scrollTop - f.clientHeight < 160 ? null : f.scrollTop;
      if (f.scrollTop < 900 && CV.cursor && !CV.loading && !loadEarlier.busy) loadEarlier().catch(() => {});
    }, { passive: true });
  }
  if (!REMOTE && !matchMedia('(max-width: 760px)').matches) $('msgBox')?.focus();
}
const nearBottom = () => { const f = $('feed'); return !f || f.scrollHeight - f.scrollTop - f.clientHeight < 160; };
// Messages already on screen stay as they are (pictures don't reload, open step lists stay open);
// new ones are added at the end and only a segment that changed is swapped.
function paintFeed() {
  const el = $('feedInner'); if (!el) return;
  const stick = nearBottom();
  if (!$('feedSegs')) el.innerHTML = '<div id="feedTop" class="segs"></div><div id="feedSegs" class="segs"></div><div id="liveText" class="msg-ai live"></div><div id="pendingBox"></div><div id="statusLine" class="step live-status"></div>';
  const top = `${CV.cursor ? '<button class="linkish earlier" data-earlier="1">Earlier messages</button>' : ''}${CV.loading ? '<p class="empty-note">Loading…</p>' : CV.error ? `<p class="empty-note">${esc(CV.error)}</p>` : !CV.items.length ? '<p class="empty-note">Nothing here yet.</p>' : ''}`;
  const t = $('feedTop'); if (t._h !== top) { t.innerHTML = top; t._h = top; }
  const box = $('feedSegs'), segs = feedSegments(), kids = box.children;
  for (let i = 0; i < segs.length; i++) {
    const k = kids[i];
    if (k && k._h === segs[i]) continue;
    const d = document.createElement('div'); d.className = 'segs'; d.innerHTML = segs[i]; d._h = segs[i];
    if (k) box.replaceChild(d, k); else box.appendChild(d);
  }
  while (kids.length > segs.length) box.lastChild.remove();
  paintLive(); paintPending(); paintStatus(); paintHead();
  if (stick) $('feed').scrollTop = $('feed').scrollHeight;
}
function appendItem() { paintFeed(); }
function paintLive() { const el = $('liveText'); if (!el) return; const stick = nearBottom(); const pl = typeof PARTNER !== 'undefined' ? PARTNER.live : ''; el.innerHTML = (CV.live ? mdHtml(CV.live) : '') + (pl ? `<div class="from-partner"><span class="who">${esc(partnerName())}</span>${mdHtml(pl)}</div>` : ''); el.hidden = !CV.live && !pl; if (stick) $('feed').scrollTop = $('feed').scrollHeight; }
// How long it's been working, to the second (the page's own clock, not the list's).
const workedFor = t => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`; };
// The line under the conversation while it works: what it's doing, the end of its thinking when the
// model shares it (Claude does; Codex only says it's thinking), and the time.
function paintStatus() {
  const el = $('statusLine'); if (!el) return;
  const quietMin = CV.busy && CV.progressAt && CV.lastStep !== 'tool' && !CV.pending.size ? Math.floor((Date.now() - CV.progressAt) / 60000) : 0;
  if (quietMin >= 4) {
    el.hidden = false;
    const h = `<span class="live-dot stall"></span><span class="st-what">Nothing from it for ${quietMin} min. It may be stuck.</span><button type="button" class="btn sm" data-nudge="1" title="Stop this turn and tell it to carry on">Nudge</button><span class="st-time">${CV.startedAt ? workedFor(CV.startedAt) : ''}</span>`;
    if (el._h !== h) { el.innerHTML = h; el._h = h; }
    return;
  }
  el._h = null;
  const pBusy = typeof PARTNER !== 'undefined' && PARTNER.busy;
  el.hidden = !CV.busy && !pBusy;
  if (!CV.busy && pBusy) { el.innerHTML = `<span class="live-dot"></span><span class="st-what">${esc(partnerName())} is working</span>`; return; }
  if (!CV.busy) { el.innerHTML = ''; return; }
  // While it waits on a question or an approval, the card says what; this line just says it's waiting.
  const what = CV.pending.size ? 'Waiting for your answer' : String(CV.status || 'Thinking').replace(/^mcp__(.+?)__/, '$1: ');
  const tail = what === 'Thinking' && CV.thinking ? CV.thinking.replace(/\s+/g, ' ').trim().split(/(?<=[.!?:])\s+/).filter(Boolean).pop() || '' : '';
  el.innerHTML = `<span class="live-dot"></span><span class="st-what">${esc(what)}</span>${tail ? `<span class="st-think">${esc(tail.slice(-160))}</span>` : ''}<span class="st-time">${CV.startedAt ? workedFor(CV.startedAt) : ''}</span>`;
}
function paintPending() {
  paintStatus();
  const el = $('pendingBox'); if (!el) return;
  // Only redrawn when what's asked changes, so answers you've started picking stay picked.
  const sig = [...CV.pending.keys()].join(',');
  if (el._sig === sig && el.innerHTML) { if (CV.pending.size && nearBottom()) $('feed').scrollTop = $('feed').scrollHeight; return; }
  el._sig = sig;
  el.innerHTML = [...CV.pending.values()].map(p => {
    if (p.questions && p.questions.length) return questionCard(p);
    const v = p.view || {};
    return `<div class="ask-card" data-req="${esc(p.requestId)}"><p class="q">Wants to ${esc(wantsTo(p.toolName))}</p>${v.detail || v.summary ? `<code class="ask-code">${esc(v.detail || v.summary)}</code>` : ''}
      <div class="opts"><button class="btn prime" data-perm-c="allow" data-req="${esc(p.requestId)}">Allow <kbd>a</kbd></button>${p.canAlways ? `<button class="btn" data-perm-c="always" data-req="${esc(p.requestId)}">Always allow</button>` : ''}<button class="btn" data-perm-c="deny" data-req="${esc(p.requestId)}">Deny <kbd>d</kbd></button></div></div>`;
  }).join('');
  if (CV.pending.size && nearBottom()) $('feed').scrollTop = $('feed').scrollHeight;
}
// A question the chat asks while it works (Claude's AskUserQuestion). One question with one answer:
// tap an option (or press its number) and it goes. Several questions, or pick-any: choose in each,
// then Send answers. Every question takes your own words too.
const quickQ = p => p.questions.length === 1 && !p.questions[0].multiSelect;
function questionCard(p) {
  const quick = quickQ(p), rid = esc(p.requestId);
  const qs = p.questions.map((q, qi) => `<fieldset class="ask-q" data-qi="${qi}"><legend>${q.header ? `<span class="tag">${esc(q.header)}</span> ` : ''}${esc(q.question)}${q.multiSelect ? ' <small>(pick any)</small>' : ''}</legend>
    ${q.options.map((o, oi) => quick
      ? `<button type="button" class="ask-opt" data-answer="${rid}" data-q="${qi}" data-o="${oi}"><kbd>${oi + 1}</kbd><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></button>`
      : `<label class="ask-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${rid}-${qi}" value="${oi}"><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}
    <label class="ask-opt other">${quick ? '' : `<input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${rid}-${qi}" value="other">`}<span><b>Other</b><input type="text" class="other-t field" placeholder="Your own answer${quick ? ', then ↵' : ''}" aria-label="Your own answer" data-otherq="${rid}"></span></label></fieldset>`).join('');
  return `<div class="ask-card ask" data-req="${rid}"><p class="q">${p.questions.length === 1 ? 'It has a question' : `It has ${p.questions.length} questions`}</p>${qs}
    <div class="opts">${quick ? '' : `<button class="btn prime" data-sendanswers="${rid}">Send answers</button>`}<button class="btn" data-perm-c="deny" data-req="${rid}">Skip</button></div></div>`;
}
// Answers from the card, as the full app sends them: each question's picks, joined.
function answersFrom(card, p) {
  const out = {};
  for (const fs of card.querySelectorAll('fieldset.ask-q')) {
    const q = p.questions[Number(fs.dataset.qi)];
    const other = fs.querySelector('.other-t').value.trim();
    const picked = quickQ(p) ? (other ? [other] : []) : [...fs.querySelectorAll('input:checked')].map(i => (i.value === 'other' ? other || 'Other' : q.options[Number(i.value)].label));
    if (!picked.length) { toast(`Pick an answer for “${q.question}”.`); return null; }
    out[q.question] = picked.join(', ');
  }
  return out;
}
const wantsTo = name => ({ Bash: 'run a command', PowerShell: 'run a command', Edit: 'edit a file', MultiEdit: 'edit a file', Write: 'create or overwrite a file', WebFetch: 'open a web page', WebSearch: 'search the web', NotebookEdit: 'edit a notebook' })[name] || `use ${String(name || 'a tool').replace(/^mcp__(.+?)__/, '$1: ')}`;

/* ---------- the input bar ----------
   One box: what you type, the pictures and files going with it, and three quiet controls: + to add
   (or paste, or drop, several at once), the model, and the effort. How much it may do without
   asking lives in Conversation settings (the gear), and defaults to yours. */
const COMP = { images: [], files: [], converting: 0, model: null, effort: null, perm: null };
// What you'd typed in each chat and not sent, kept on this device, so moving between chats doesn't lose it.
const DRAFTS = new Map(Object.entries(local.get('drafts', {})));
const saveDrafts = () => { clearTimeout(saveDrafts.t); saveDrafts.t = setTimeout(() => local.set('drafts', Object.fromEntries([...DRAFTS].slice(-40))), 400); };
document.addEventListener('input', e => {
  if (e.target.id !== 'msgBox' || S.view !== 'chat' || !CV.id) return;
  const v = e.target.value; if (v.trim()) DRAFTS.set(String(CV.id), v); else DRAFTS.delete(String(CV.id));
  saveDrafts();
});
function restoreDraft() { const d = CV.id && DRAFTS.get(String(CV.id)); const box = $('msgBox'); if (d && box && !box.value) { box.value = d; autosize(box); } }
function resetComposer() { for (const i of COMP.images) if (i.url) URL.revokeObjectURL(i.url); Object.assign(COMP, { images: [], files: [], converting: 0, model: null, effort: null, perm: null, fast: null }); }
function composerHtml({ fresh = false } = {}) {
  return `<form class="box" id="composer" autocomplete="off">
    ${fresh ? '' : '<div class="readonly-note" id="roNote" hidden></div>'}
    <div class="att-strip" id="attStrip" hidden></div>
    <textarea autocomplete="off" id="msgBox" rows="1" placeholder="${fresh ? 'What should it do?' : 'Reply…'}" aria-label="Message"></textarea>
    <div class="tools" id="barTools"></div>
    <input type="file" id="attIn" multiple hidden>
  </form>`;
}
// Models and efforts each assistant offers, remembered from the last chat that reported them, so
// the chips work before a chat is running.
// From the Mac (/api/lite/models: real names, and what a new chat gets by default); else what a
// chat last reported.
const MD = prov => (S.models && S.models[prov === 'ollama' ? 'ollama' : prov === 'codex' ? 'codex' : 'claude']) || null;
const modelsFor = prov => (MD(prov) ? [...MD(prov).models, ...MD(prov).more] : local.get(`models:${prov}`, []));
const effortsFor = prov => (MD(prov) && MD(prov).efforts) || local.get(`efforts:${prov}`, prov === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh']);
function loadModels() { if (S.models || loadModels.p) return loadModels.p; loadModels.p = api('/api/lite/models').then(j => { S.models = j; if (S.view === 'newchat') paintNewChat(); else if (S.view === 'chat') paintBar(); }).catch(() => {}); return loadModels.p; }
function rememberModels(prov, info) {
  if (info && Array.isArray(info.models) && info.models.length) local.set(`models:${prov}`, info.models.map(m => ({ value: m.value, label: m.label })).slice(0, 30));
  if (info && Array.isArray(info.efforts) && info.efforts.length) local.set(`efforts:${prov}`, info.efforts);
}
const provNow = () => (S.view === 'newchat' ? (NC.who === 'claude' ? 'claude' : NC.who === 'ollama' ? 'ollama' : 'codex') : CV.provider === 'gemini' ? 'gemini' : CV.provider === 'codex' ? ((CV.info && /ollama/i.test(CV.info.accountName || '')) || (chatBy.get(CV.id) || {}).ollama ? 'ollama' : 'codex') : 'claude');
const prettyModel = m => String(m).replace(/^claude-/, '').replace(/-(\d)-(\d)/, ' $1.$2').replace(/\[1m\]$/, ' 1M').replace(/^(\w)/, c => c.toUpperCase());
const modelLabel = (prov, v) => { const base = String(v).replace(/\[1m\]$/, ''); const m = modelsFor(prov).find(x => x.value === v || x.value === base); return m ? `${m.label}${/\[1m\]$/.test(v) ? ' 1M' : ''}` : prettyModel(v); };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
function toolsHtml({ fresh }) {
  const prov = provNow();
  const info = fresh ? null : CV.info;
  const model = (info && (info.replyModel || info.resolvedModel || info.model)) || COMP.model || (!fresh && chatBy.get(CV.id) && chatBy.get(CV.id).model) || null;
  const effort = (info && info.effort) || COMP.effort || null;
  const md0 = MD(prov);
  const busy = !fresh && CV.busy;
  return `<button type="button" class="iconbtn att-btn" data-attach="1" aria-label="Add images or files" title="Add images or files (or paste, or drop)">+</button>
    <button type="button" class="model${!fresh && CV.to && CV.to !== 'chat' ? ' to-on' : ''}" data-barmodel="1" aria-haspopup="menu" title="Model, and who answers">${esc((model ? modelLabel(prov, model) : md0 && md0.defaultModel ? md0.defaultModel : 'Model'))}${!fresh && CV.to === 'both' ? ` + ${esc(partnerName())}` : !fresh && CV.to === 'partner' ? ` → ${esc(partnerName())}` : ''}${prov === 'codex' && ((info && info.fast) || (!info && COMP.fast)) ? ' ⚡' : ''}<span>▾</span></button>
    <button type="button" class="model" data-bareffort="1" aria-haspopup="menu" title="Effort">${esc(effort ? cap(effort) : md0 && md0.defaultEffort ? cap(md0.defaultEffort) : 'Auto effort')}<span>▾</span></button>
    <span class="bar-hint" id="barHint"></span>
    <button type="button" class="iconbtn gear" data-chatsettings="1" aria-label="Conversation settings" title="Conversation settings">${IC.gear}</button>
    ${busy ? '<button type="button" class="iconbtn stop-sm" data-stopchat="1" aria-label="Stop (⌘.)" title="Stop (⌘.)">■</button><button type="submit" class="send" aria-label="Queue (↵) · tell it now (⌥↵)" title="↵ queues it for when it finishes · ⌥↵ tells it now, while it works">↑</button>' : `<button type="submit" class="send" aria-label="${fresh ? 'Start' : 'Send'} (↵)" title="${fresh ? 'Start' : 'Send'} (↵)">↑</button>`}`;
}
function paintBar() {
  const t = $('barTools'); if (!t || S.view !== 'chat') return;
  if (CV.info) rememberModels(provNow(), CV.info);
  const ro = $('roNote');
  if (ro) { ro.hidden = !CV.readOnly; ro.textContent = CV.readOnly || ''; }
  const th = toolsHtml({ fresh: false }); if (t._h !== th) { t.innerHTML = th; t._h = th; }
  const box = $('msgBox'); if (box) box.disabled = !!CV.readOnly;
  paintAttachments();
}
function autosize(el) { el.style.height = 'auto'; const cap = parseFloat(getComputedStyle(el).maxHeight) || 280; el.style.height = Math.min(el.scrollHeight, cap, 280) + 'px'; }

/* ----- pictures and files ----- */
const readData = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
// Over 5 MB or a type Claude can't take (HEIC, say): redrawn as a JPEG that fits.
async function shrinkImage(f) {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    for (const q of [0.88, 0.8, 0.7]) { const out = await new Promise(res => c.toBlob(res, 'image/jpeg', q)); if (out && out.size <= 5 * 1024 * 1024) return out; }
  } catch { /* not decodable here */ }
  return null;
}
async function addImage(f) {
  COMP.converting++; paintAttachments();
  try {
    let blob = f;
    if (f.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) blob = await shrinkImage(f);
    if (!blob) { addFile(f); return; }
    COMP.images.push({ mediaType: blob.type || f.type, data: await readData(blob), url: URL.createObjectURL(blob), name: f.name || 'image' });
  } finally { COMP.converting = Math.max(0, COMP.converting - 1); paintAttachments(); }
}
function addFile(f) {
  if (f.size > 2 * 1024 * 1024 * 1024) { toast(`${f.name} is over 2 GB.`); return; }
  COMP.files.push({ file: f, name: f.name || 'file', size: f.size, rel: null, error: null, progress: 0 });
  paintAttachments();
  if (CV.key && S.view === 'chat') uploadPending(CV.key).catch(() => {});
}
function addFiles(list) {
  for (const f of list) {
    if (/^image\//.test(f.type) && !/svg/.test(f.type)) { if (COMP.images.length + COMP.converting >= 10) { toast('Up to 10 pictures at a time.'); continue; } addImage(f).catch(() => addFile(f)); }
    else addFile(f);
  }
  sfx('chip');
  $('msgBox')?.focus();
}
const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function paintAttachments() {
  const el = $('attStrip'); if (!el) return;
  const n = COMP.images.length + COMP.files.length + COMP.converting;
  el.hidden = !n;
  el.innerHTML = `${COMP.images.map((im, i) => `<span class="att"><img src="${im.url}" alt=""><button type="button" data-rmimg="${i}" aria-label="Remove ${esc(im.name)}">×</button></span>`).join('')}${COMP.converting ? '<span class="att loading" aria-label="Preparing a picture"></span>' : ''}${COMP.files.map((f, i) => `<span class="att-file ${f.error ? 'err' : ''}" title="${esc(f.error || f.name)}"><b>${esc(f.name)}</b><small>${f.error ? 'failed' : f.rel ? sizeText(f.size) : f.progress ? `${Math.round(f.progress * 100)}%` : sizeText(f.size)}</small><button type="button" data-rmfile="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('')}`;
}
// Files other than pictures go into the chat's folder (the full app's upload), then the message names them.
function uploadOne(key, f) {
  return new Promise(resolve => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/chat/upload?${new URLSearchParams({ key, name: f.name })}`);
    x.setRequestHeader('X-Switcher-Token', TOKEN);
    x.upload.onprogress = e => { if (e.lengthComputable) { f.progress = e.loaded / e.total; paintAttachments(); } };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ } if (x.status === 200) { f.rel = j.rel; f.size = j.size || f.size; } else f.error = j.error || `Upload failed (${x.status}).`; paintAttachments(); resolve(); };
    x.onerror = () => { f.error = 'The upload was interrupted.'; paintAttachments(); resolve(); };
    x.send(f.file);
  });
}
async function uploadPending(key, files = COMP.files) { for (const f of files) if (!f.rel && !f.error && !f.uploading) { f.uploading = true; await uploadOne(key, f); f.uploading = false; } }
const fileLines = (files = COMP.files) => files.filter(f => f.rel).map(f => `Attached file: \`${f.rel}\` (${sizeText(f.size)})`).join('\n');
const withFiles = (text, files = COMP.files) => { const l = fileLines(files); return l ? `${text.replace(/\s+$/, '')}${text.trim() ? '\n\n' : ''}${l}` : text; };
const imagesOut = () => COMP.images.map(i => ({ mediaType: i.mediaType, data: i.data }));

// While it works: ↵ queues a message for when the turn ends (shown above the box, with Steer
// to tell it straight away); ⌥↵ tells it now.
// Queues are kept per chat, so leaving a chat (or reloading) doesn't lose them; while you're
// elsewhere, sendBackgroundQueues sends the next one when that chat finishes its turn. Pictures stay
// only for this visit (too big to keep in the browser).
const QUEUES = (() => { try { return JSON.parse(localStorage.getItem('lite.queues') || '{}') || {}; } catch { return {}; } })();
const queueFor = id => (id ? (QUEUES[id] = QUEUES[id] || []) : []);
function saveQueues() {
  for (const k of Object.keys(QUEUES)) if (!QUEUES[k].length) delete QUEUES[k];
  try { localStorage.setItem('lite.queues', JSON.stringify(Object.fromEntries(Object.entries(QUEUES).map(([k, v]) => [k, v.map(q => ({ text: q.text, images: [] }))])))); } catch { /* fine */ }
}
let bgSending = false;
async function sendBackgroundQueues() {
  if (bgSending) return;
  for (const [id, q] of Object.entries(QUEUES)) {
    if (!q.length || (S.view === 'chat' && CV.id === id)) continue;
    const x = S.live.find(l => l.sessionId && l.sessionId.toLowerCase() === id.toLowerCase());
    if (!x || !x.key || x.source !== 'app' || x.working || (x.pending || []).length) continue;
    const item = q.shift(); saveQueues(); bgSending = true;
    try { await api('/api/chat/send', { key: x.key, text: item.text, ...(item.images.length ? { images: item.images.map(i => ({ mediaType: i.mediaType, data: i.data })) } : {}) }); toast('Sent a queued message.'); }
    catch (err) { q.unshift(item); saveQueues(); toast(err.message); }
    finally { bgSending = false; }
    return;
  }
}
function paintQueue() {
  if (CV.id && CV.queue && CV.queue.length) QUEUES[CV.id] = CV.queue;
  saveQueues();
  const el = $('queueBox'); if (!el) return;
  el.innerHTML = (CV.queue || []).map((q, i) => `<div class="q-item"><span class="tag">Queued</span><span class="q-text">${esc(q.text.slice(0, 160))}${q.images.length ? ` · ${q.images.length} picture${q.images.length === 1 ? '' : 's'}` : ''}</span><button type="button" class="btn" data-steerq="${i}" title="Tell it now, while it works">Steer</button><button type="button" class="iconbtn" data-unqueue="${i}" aria-label="Remove from the queue">×</button></div>`).join('');
  el.hidden = !(CV.queue || []).length;
}
async function sendQueued() {
  if (!CV.queue || !CV.queue.length || CV.busy || CV.sending) return;
  const q = CV.queue.shift(); paintQueue();
  const box = $('msgBox'); const typed = box ? box.value : '';
  if (box) box.value = q.text;
  const saved = COMP.images; COMP.images = q.images;
  await sendInChat({ fromQueue: true });
  COMP.images = saved; if (box && !box.value) { box.value = typed; autosize(box); }
}
// /draw <what> (or /draw 3 <what>) in any input bar: Codex draws it on your use-next ChatGPT plan,
// and the picture lands in this message's attachments, ready to send (to Claude, Codex, anyone).
const DRAW_RE = /^\/draw\s+(?:(\d)\s+)?([\s\S]+)$/i;
async function drawIntoMessage(text) {
  const m = DRAW_RE.exec(text); if (!m) return false;
  const n = Math.min(4, Math.max(1, Number(m[1]) || 1)), prompt = m[2].trim();
  const box = $('msgBox'); if (box) { box.value = ''; autosize(box); }
  const { job } = await api('/api/lite/images/generate', { prompt, n });
  drawIntoMessage.pending = (drawIntoMessage.pending || 0) + 1; paintDrawHint();
  sfx('fan'); toast(`Drawing ${n === 1 ? 'it' : `${n} versions`} on ${job.account || 'ChatGPT'}… keep typing; ${n === 1 ? 'it lands' : 'they land'} in your message.`);
  const poll = async () => {
    let j; try { j = (await api(`/api/lite/images/job?id=${encodeURIComponent(job.id)}`)).job; } catch { j = { state: 'failed', error: 'Lost track of the drawing.' }; }
    if (j.state === 'working') { setTimeout(poll, 3000); return; }
    drawIntoMessage.pending -= 1; paintDrawHint();
    if (j.state !== 'done' || !j.images.length) { toast(j.error || 'Codex didn’t draw it.'); return; }
    for (const im of j.images) await addImageFromUrl(`/api/lite/gimg?token=${TOKEN}&thread=${encodeURIComponent(im.thread)}&file=${encodeURIComponent(im.file)}`, { quiet: true });
    sfx('card'); toast(`${j.images.length === 1 ? 'The picture is' : `${j.images.length} pictures are`} in your message.`);
  };
  setTimeout(poll, 4000);
  return true;
}
function paintDrawHint() { const h = $('barHint'); if (h) h.textContent = drawIntoMessage.pending ? `Drawing ${drawIntoMessage.pending === 1 ? 'a picture' : `${drawIntoMessage.pending} pictures`}…` : ''; }
// Into the running turn now: on screen at once, and it reads it while it works.
async function steerIn(text, imgs) {
  const images = imgs.map(i => ({ mediaType: i.mediaType, data: i.data }));
  const local = { kind: 'user', text, images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  CV.items.push(local); paintFeed(); sfx('slide');
  try { await api('/api/lite/steer', { key: CV.key, text, ...(images.length ? { images } : {}) }); }
  catch (err) {
    CV.items = CV.items.filter(x => x !== local); paintFeed();
    CV.queue.unshift({ text, images: imgs }); paintQueue();
    toast(`${err.message} It’s back in the queue.`);
  }
}
function steerQueued(i) {
  const q = CV.queue.splice(i, 1)[0]; paintQueue();
  if (!q) return;
  if (!CV.busy) { CV.queue.unshift(q); sendQueued(); return; }
  steerIn(q.text, q.images);
}
async function sendInChat({ fromQueue = false } = {}) {
  const box = $('msgBox'); const text = box.value.trim();
  if ((!text && !COMP.images.length && !COMP.files.length) || CV.sending) return;
  if (DRAW_RE.test(text)) return wrap(drawIntoMessage)(text);
  if (!fromQueue && CV.busy && CV.key) {
    const steer = COMP.steerNow; COMP.steerNow = false;
    const imgs = COMP.images.slice();
    box.value = ''; autosize(box); resetComposer(); paintAttachments(); DRAFTS.delete(String(CV.id)); saveDrafts();
    if (!steer) { CV.queue.push({ text, images: imgs }); paintQueue(); sfx('chip'); return undefined; }
    return steerIn(text, imgs);
  }
  if (COMP.converting) return toast('One moment: a picture is still being prepared.');
  // The message belongs to the chat it was written in. Starting a chat that wasn't running takes a
  // few seconds; if you open another chat meanwhile, it still goes here (Oct 13: it went to the chat
  // you'd moved to), and only this chat's view is touched.
  const id = CV.id, provider = CV.provider, inRepo = CV.inRepo, perm = COMP.perm || (CV.provider === 'gemini' ? null : permDefault(CV.provider)), model = COMP.model, effort = COMP.effort, fast = COMP.fast;
  const to = CV.to && CV.to !== 'chat' ? CV.to : null;
  const here = () => S.view === 'chat' && CV.id === id;
  let key = CV.key;
  CV.sending = true;
  // On screen at once: your message, and the line under it, while the chat starts up.
  const images = imagesOut();
  // The pictures and files go with the message at once: off the input bar now, back on it if it doesn't go.
  const sentImages = COMP.images, files = COMP.files;
  COMP.images = []; COMP.files = []; paintAttachments();
  const local = { kind: 'user', text: withFiles(text, files), images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  CV.items.push(local);
  box.value = ''; autosize(box); DRAFTS.delete(String(id)); saveDrafts();
  if (!CV.busy) { CV.busy = true; CV.status = key ? 'Sending' : 'Starting'; CV.startedAt = Date.now(); }
  sfx('slide'); paintFeed(); paintStatus(); $('feed').scrollTop = $('feed').scrollHeight;
  try {
    if (!key) {
      // First message: picked up here, always in your permission default (or what you chose for it
      // with the gear), and on the model you picked if you did.
      // Claude picks up on the use-next Claude plan (else the account it last ran as); Codex on its own.
      const c = chatBy.get(id);
      const claudeAcct = provider !== 'codex' ? accountFor('claude') || (c && c.accountId) || null : null;
      // An Ollama chat goes back to the Ollama account (its thread isn't OpenAI's).
      const info = await api('/api/chat/open', { sessionId: id, mode: 'resume', ...(inRepo ? { inRepo: true } : {}), ...(provider === 'codex' ? { provider: 'codex', ...(c && c.ollama && c.accountId ? { account: c.accountId } : {}) } : {}), ...(claudeAcct ? { account: claudeAcct } : {}), permissionMode: perm, ...(model ? { model } : {}), ...(fast != null ? { fast: !!fast } : {}) });
      key = info.key;
      if (here()) {
        CV.key = key; CV.info = info;
        // Already running (picked up from elsewhere): its stream replays this run, so history stops where it starts.
        if (info.attached) { const from = Date.parse(info.bufferFrom || info.startedAt || '') - 1000; if (from) { CV.items = CV.items.filter(x => x === local || !x.at || Date.parse(x.at) < from); paintFeed(); } }
        listen(key);
      }
      await waitReadyFor(key);
      if (effort) await api('/api/chat/model', { key, effort }).then(m => { if (here() && CV.info) Object.assign(CV.info, m); }).catch(() => {});
    }
    await uploadPending(key, files);
    const out = withFiles(text, files); local.text = out;
    for (const i of sentImages) if (i.url) URL.revokeObjectURL(i.url);
    if (here()) { resetComposer(); paintAttachments(); }
    try { await api('/api/chat/send', { key, text: out, ...(images.length ? { images } : {}), ...toBody(to) }); }
    catch (err) {
      // It stopped since Lite last looked (idle for a while, or the app restarted): started again, then sent.
      if (!(err.status === 409 || err.status === 404) || !/stopped|isn.t running|not running/i.test(err.message)) throw err;
      const c = chatBy.get(id);
      const claudeAcct = provider !== 'codex' ? accountFor('claude') || (c && c.accountId) || null : null;
      const info = await api('/api/chat/open', { sessionId: id, mode: 'resume', ...(provider === 'codex' ? { provider: 'codex', ...(c && c.ollama && c.accountId ? { account: c.accountId } : {}) } : {}), ...(claudeAcct ? { account: claudeAcct } : {}), permissionMode: perm, ...(model ? { model } : {}), ...(fast != null ? { fast: !!fast } : {}) });
      key = info.key;
      if (here()) { CV.key = key; CV.info = info; listen(key); }
      await waitReadyFor(key);
      await api('/api/chat/send', { key, text: out, ...(images.length ? { images } : {}), ...toBody(to) });
    }
    if (here()) {
      if (to) { const b = toBody(to); partnerSoon(b.kinds || (b.kind ? [b.kind] : [])); }
      CV.busy = true; if (CV.status === 'Starting' || CV.status === 'Sending') CV.status = ''; paintBar(); paintStatus();
    }
  } catch (err) {
    // Didn't go: the message comes back to the box, as you wrote it (or as that chat's draft, if you've moved on).
    if (here()) {
      CV.items = CV.items.filter(x => x !== local);
      const b = $('msgBox'); if (b && !b.value) { b.value = text; autosize(b); }
      COMP.images = [...sentImages, ...COMP.images]; COMP.files = [...files, ...COMP.files]; paintAttachments();
      CV.busy = false; CV.status = ''; paintFeed(); paintStatus();
      toast(err.message);
    } else {
      if (!DRAFTS.get(String(id))) { DRAFTS.set(String(id), text); saveDrafts(); }
      const c = chatBy.get(id);
      toast(`Your message to “${(c && c.title) || 'that chat'}” didn’t go (${err.message}). It’s back in that chat’s box.`);
    }
  } finally { if (here()) CV.sending = false; }
}
// Ready for a message: this chat's own stream says so while you're in it; otherwise asked directly.
const waitReadyFor = key => new Promise(res => {
  const t0 = Date.now();
  const tick = async () => {
    let st = null;
    if (CV.key === key && CV.info) st = CV.info.state;
    else { try { st = (await api('/api/chat/attach', { key })).state; } catch { return res(); } }
    if ((st && st !== 'starting') || Date.now() - t0 > 45e3) return res();
    return setTimeout(tick, CV.key === key ? 100 : 400);
  };
  tick();
});

function chatMenu(anchor) {
  const c = chatBy.get(CV.id);
  pop(anchor, `${c ? '<button data-v="rename">Rename…</button>' : ''}<button data-v="settings">Conversation settings…</button><button data-v="full">Open in the full app<small>diffs, files, history</small></button>${c ? `<hr><button data-v="routine">Make this a routine…</button><button data-v="nest">Put under another chat…</button>${parentOn(c) ? '<button data-v="top">Make it top-level</button>' : ''}<button data-v="wait">Waiting on…<kbd>w</kbd></button><button data-v="arch">Archive<kbd>e</kbd></button>` : ''}${CV.key ? '<hr><button data-v="stop">Stop it running here</button>' : ''}`, v => {
    if (v === 'settings') return settingsMenu(anchor);
    if (v === 'rename') return editTitleInline();
    if (v === 'nest') return pickParent(anchor, [c.id]);
    if (v === 'routine') return routineFromChat(c);
    if (v === 'top') return wrap(nestChats)([c.id], null);
    if (v === 'full') return openChat(CV.id, { full: true });
    if (v === 'wait') return askWaiting([CV.id]);
    if (v === 'arch') return wrap(archiveChats)([CV.id]).then(() => go('back'));
    if (v === 'stop') return wrap(async () => { await api('/api/chat/stop', { key: CV.key }); toast('Stopped. It stays in the list; send a message to pick it up again.'); })();
    return undefined;
  });
}
// One list of every model you have, grouped by who runs it. In New chat, picking one also picks
// the plan (your use-next Claude or ChatGPT plan, or Ollama). In a chat, the same provider's models
// switch in place; another provider's start a new chat there that picks up where this one is.
const PROVS = [['claude', 'Claude'], ['codex', 'ChatGPT'], ['ollama', 'Ollama']];
const provName = p => (PROVS.find(x => x[0] === p) || [p, p === 'gemini' ? 'Gemini' : p])[1];
const hasProv = p => (p === 'claude' ? plans().some(x => x.family === 'claude' && !x.broken) : p === 'codex' ? plans().some(x => x.family === 'chatgpt' && !x.broken) : plans().some(x => x.family === 'ollama' && !x.broken));
// The models offered (Ryan's picks): five Claude models, and the current GPT ones (not GPT-5.6 or
// the older GPT-6 Sol). Ollama lists whatever is pulled.
const CLAUDE_PICKS = ['opus', 'fable', 'sonnet', 'haiku', 'claude-opus-4-8'];
const CLAUDE_NAMES = { opus: 'Opus 5.5', fable: 'Fable 5.1', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5', 'claude-opus-4-8': 'Opus 4.8' };
function offered(p, list) {
  if (p === 'claude') return CLAUDE_PICKS.map(v => ({ value: v, ...(list.find(m => m.value === v) || {}), label: CLAUDE_NAMES[v] }));
  if (p === 'codex') return list.filter(m => !/^gpt-5\.6/.test(m.value) && m.value !== 'gpt-6-sol');
  return list;
}
function modelMenu(anchor) {
  const prov = provNow();
  const inChat = S.view === 'chat';
  const running = inChat && CV.key && CV.info;
  const cur = running ? CV.info.model : COMP.model;
  if (!S.models) { loadModels().then(() => modelMenu(anchor)); return toast('Reading the models…'); }
  const item = (p, m) => `<button class="mm" data-v="${esc(p)}|${esc(m.value)}" role="menuitemradio" aria-checked="${p === prov && m.value === cur}" title="${esc(m.note || '')}"><span class="mm-name">${esc(String(m.label || prettyModel(m.value)).replace(/:cloud$/, ""))}</span>${m.note && m.note !== 'In Ollama' ? `<span class="mm-note">${esc(m.note.replace(/^[^·]*· /, ''))}</span>` : ''}</button>`;
  const group = p => {
    if (p === 'gemini') return p === prov && running && (CV.info.models || []).length ? `<div class="ph">Gemini</div>${CV.info.models.map(m => item(p, m)).join('')}` : '';
    const md0 = MD(p); if (!md0 || !hasProv(p)) return '';
    const here = p === prov;
    const runList = here && running && CV.info.models && CV.info.models.length ? CV.info.models.filter(m => m.value !== 'default') : null;
    const all = offered(p, runList || [...md0.models, ...md0.more]);
    const main = all, more = [];
    const plan = p === 'ollama' ? null : useNext(p === 'claude' ? 'claude' : 'chatgpt');
    const sub = inChat && !here ? 'starts a new chat there' : p === 'ollama' ? 'no plan limits' : plan ? `${plan.label} · ${plan.left}%` : '';
    return `<div class="ph">${provName(p)}${sub ? ` · ${esc(sub)}` : ''}${here && md0.defaultModel ? ` · default ${esc(md0.defaultModel)}` : ''}</div>${main.map(m => item(p, m)).join('')}${more.length ? `<details class="pop-more"><summary>More ${provName(p)} models</summary>${more.map(m => item(p, m)).join('')}</details>` : ''}`;
  };
  const order = [prov, ...PROVS.map(x => x[0]).filter(p => p !== prov)];
  // Who answers in this chat: it, its partner (the other assistant, in this same chat), or both in turn.
  const crew = crewKindsLite();
  const duoOk = inChat && prov !== 'ollama' && crew.length > 0;
  const to = CV.to === 'partner' ? `partner:${partnerProv()}` : CV.to || 'chat';
  const allName = crew.length > 1 ? 'All' : 'Both';
  const who = duoOk ? `<div class="ph">Who answers</div><div class="who-seg">${[['chat', selfName()], ...crew.map(k => [`partner:${k}`, NAME_OF[k]]), ['both', allName]].map(([v, l]) => `<button class="mm who-opt" data-v="to|${v}" role="menuitemradio" aria-checked="${to === v}" title="${v === 'both' ? `${selfName()} answers, then ${crew.map(k => NAME_OF[k]).join(', then ')} picks it up` : v !== 'chat' ? `${l} answers in this chat, caught up on it first` : 'This chat, as usual'}">${esc(l)}</button>`).join('')}</div><hr>` : '';
  // Fast (Codex): its priority tier, about twice as quick, using more of the plan.
  const codexHere = inChat ? prov === 'codex' : (typeof NC !== 'undefined' && NC.who === 'codex');
  const fastOn = running ? !!CV.info.fast : !!COMP.fast;
  const fast = codexHere ? `<button class="mm" data-v="fast|${fastOn ? 'off' : 'on'}" role="menuitemcheckbox" aria-checked="${fastOn}"><span class="mm-name">⚡ Fast</span><span class="mm-note">about 2x speed, uses more of the plan</span></button><hr>` : '';
  pop(anchor, who + fast + order.map(group).filter(Boolean).join('<hr>'), raw => {
    const [p, v] = raw.split('|');
    if (p === 'fast') {
      const on = v === 'on';
      if (running) return wrap(async () => { Object.assign(CV.info, await api('/api/chat/model', { key: CV.key, fast: on })); paintBar(); toast(on ? 'Fast is on for this chat.' : 'Fast is off.'); })();
      COMP.fast = on; paintBar(); if (S.view === 'newchat') paintNewChat(); toast(on ? 'Fast: on for this chat when it starts.' : 'Fast is off.'); return undefined;
    }
    if (p === 'to') { CV.to = v; setTo(CV.id, v); paintBar(); if (v !== 'chat') toast(v === 'both' ? `${toName('both')}: ${selfName()} answers, then ${crewKindsLite().map(k => NAME_OF[k]).join(', then ')}, each building on the last.` : `${toName(v)} answers in this chat.`); return undefined; }
    if (inChat && p !== prov) return continueElsewhere(p, v);
    if (running) return wrap(async () => { Object.assign(CV.info, await api('/api/chat/model', { key: CV.key, model: v })); paintBar(); })();
    if (S.view === 'newchat' && p !== prov) {
      NC.who = p === 'claude' ? 'claude' : p === 'ollama' ? 'ollama' : 'codex'; NC.account = null; COMP.effort = null; COMP.perm = null;
      const plan = planById(accountFor(NC.who));
      toast(`${modelLabel(p, v)} runs on ${p === 'ollama' ? 'Ollama' : `${provName(p)}${plan ? ` · ${plan.label} (use next)` : ''}`}.`);
    }
    COMP.model = v;
    return S.view === 'newchat' ? paintNewChat() : paintBar();
  });
}
// Another provider can't take over this conversation, so a new chat there starts with where this
// one got to, in the same project, as its sub-chat.
function continueElsewhere(p, model) {
  const c = chatBy.get(CV.id);
  const lastAi = [...CV.items].reverse().find(it => it.kind === 'assistant' && (it.blocks || []).some(b => b.type === 'text'));
  const lastText = lastAi ? lastAi.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim() : '';
  const title = c ? c.title : chatTitle();
  const prefill = `Picking up from the chat “${title}” (on ${provName(provNow())}).${lastText ? ` Where it got to:\n\n${lastText.slice(0, 1800)}${lastText.length > 1800 ? '…' : ''}` : ''}\n\nNext: `;
  const parent = CV.id;
  go('newchat', { ncProject: c ? c.project : null, prefill });
  NC.who = p === 'claude' ? 'claude' : p === 'ollama' ? 'ollama' : 'codex'; NC.account = null; NC.parent = parent;
  COMP.model = model; COMP.effort = null; COMP.perm = null;
  paintNewChat();
  setTimeout(() => { const b = $('msgBox'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 50);
}
function effortMenu(anchor) {
  const prov = provNow();
  const running = S.view === 'chat' && CV.key && CV.info;
  const list = running && CV.info.efforts && CV.info.efforts.length ? CV.info.efforts : effortsFor(prov);
  const cur = running ? CV.info.effort : COMP.effort;
  const md0 = MD(prov);
  pop(anchor, `<div class="ph">Effort${md0 && md0.defaultEffort ? ` · default ${esc(cap(md0.defaultEffort))}` : ''}</div>${list.map(e => `<button data-v="${esc(e)}" role="menuitemradio" aria-checked="${e === cur}">${esc(cap(e))}</button>`).join('')}`,
    v => { if (running) return wrap(async () => { Object.assign(CV.info, await api('/api/chat/model', { key: CV.key, effort: v })); paintBar(); })(); COMP.effort = v; return S.view === 'newchat' ? paintNewChat() : paintBar(); });
}
// Conversation settings: how much it may do without asking. Your default is preselected.
function settingsMenu(anchor) {
  // Gemini: its own modes, from the running chat.
  if (S.view === 'chat' && CV.provider === 'gemini') {
    const modes = (CV.info && CV.info.modes) || [];
    if (!CV.key || !modes.length) return toast('Gemini’s modes show once the chat is running.');
    return pop(anchor, `<div class="ph">Gemini · without asking, it may</div>${modes.map(m => `<button data-v="${esc(m.value)}" role="menuitemradio" aria-checked="${m.value === CV.info.permissionMode}">${esc(m.label)}</button>`).join('')}`,
      v => wrap(async () => { await api('/api/chat/mode', { key: CV.key, mode: v }); CV.info.permissionMode = v; toast(`This chat: ${(modes.find(m => m.value === v) || {}).label || v}.`); })());
  }
  const prov = permFam(S.view === 'newchat' ? (NC.who === 'claude' ? 'claude' : 'codex') : CV.provider);
  const running = S.view === 'chat' && CV.key && CV.info;
  const cur = (running && CV.info.permissionMode) || COMP.perm || permDefault(prov);
  const modes = (S.permissionModes || {})[prov] || [];
  const def = permDefault(prov);
  pop(anchor, `<div class="ph">Conversation settings · without asking, it may</div>${modes.map(m => `<button data-v="${esc(m)}" role="menuitemradio" aria-checked="${m === cur}">${esc(PERM_LABELS[m] || m)}${m === def ? '<small>your default</small>' : ''}</button>`).join('')}<hr><button data-v="__default">Make “${esc(PERM_LABELS[cur] || cur)}” my default</button>`,
    v => {
      if (v === '__default') return wrap(setLook)({ permissions: { [prov]: cur } }).then(() => toast(`New ${prov === 'claude' ? 'Claude' : 'Codex'} chats start in ${PERM_LABELS[cur]}.`));
      if (running) return wrap(async () => { await api('/api/chat/mode', { key: CV.key, mode: v }); CV.info.permissionMode = v; toast(`This chat: ${PERM_LABELS[v]}.`); })();
      COMP.perm = v; toast(`This chat will start in ${PERM_LABELS[v]}.`); return undefined;
    });
}

/* ---------- New chat: the same input bar, centered ---------- */
// Who a new chat runs as: an assistant and an account. "Use next" (the default) follows the
// use-next order; you can also pick a particular account.
const NC = { project: null, who: 'claude', account: null };
function accountFor(who) {
  if (who === 'ollama') { const o = plans().find(p => p.family === 'ollama' && !p.broken); return o ? o.id : null; }
  if (S.view === 'newchat' && NC.who === who && NC.account) return NC.account;
  const p = useNext(who === 'claude' ? 'claude' : 'chatgpt');
  return p ? p.id : null;
}
function accountMenu(anchor) {
  const row = (who, id, label, sub, checked) => `<button data-v="${who}:${id}" role="menuitemradio" aria-checked="${checked}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  const group = (who, fam, title) => {
    const ps = plans().filter(p => p.family === fam && !p.broken && typeof p.left === 'number');
    const nx = useNext(fam);
    return `<div class="ph">${title}</div>${row(who, 'auto', `Use next${nx ? ` · ${nx.label}` : ''}`, nx ? `${nx.left}%` : '', NC.who === who && !NC.account)}${ps.map(p => row(who, p.id, p.label, `${p.left}% · ${wd(p.resetsAt) || ''}`, NC.who === who && NC.account === p.id)).join('')}`;
  };
  const ol = plans().find(p => p.family === 'ollama' && !p.broken);
  pop(anchor, `${group('claude', 'claude', 'Claude')}<hr>${group('codex', 'chatgpt', 'ChatGPT (Codex)')}${ol ? `<hr>${row('ollama', 'auto', 'Ollama', 'no plan limits', NC.who === 'ollama')}` : ''}`, v => {
    const [who, id] = v.split(':');
    if (who !== NC.who) { COMP.model = null; COMP.effort = null; COMP.perm = null; }
    NC.who = who; NC.account = id === 'auto' ? null : id;
    paintNewChat(); $('msgBox')?.focus();
  });
}
const ncProjects = () => S.projects.filter(p => p.cwd && p.exists && !p.archived && !p.loose).sort((a, b) => (b.bucket ? 1 : 0) - (a.bucket ? 1 : 0) || b.updated - a.updated);
function newChatView() {
  const ps = ncProjects();
  if (!NC.project || !ps.some(p => p.key === NC.project)) NC.project = (ps[0] || {}).key || null;
  return `<div class="newchat"><div class="nc-inner">
    <button class="iconbtn back" data-go="back" aria-label="Back">‹</button>
    <h1 class="nc-h">What should we work on?</h1>
    <div class="nc-chips" id="ncChips"></div>
    ${composerHtml({ fresh: true })}
    <p class="hint-line nc-foot"><kbd>↵</kbd> start · <kbd>⇧↵</kbd> new line · <kbd>⌘P</kbd> project · paste or drop pictures · /draw a picture · <kbd>esc</kbd> back</p>
  </div></div>`;
}
function paintNewChat() {
  if (!$('ncChips')) return;
  const p = projBy.get(NC.project);
  const acc = accountFor(NC.who), plan = acc && planById(acc);
  $('ncChips').innerHTML = `<button type="button" class="chip big" data-ncproject="1">${p ? `<span class="thumb-xs" style="${artStyle(p)};width:16px;height:16px;border-radius:4px"></span>${esc(p.name)}` : 'Pick a project'} ▾</button>
    <button type="button" class="chip big" data-ncwho="1">${NC.who === 'ollama' ? 'Ollama' : `${NC.who === 'claude' ? 'Claude' : 'ChatGPT'}${plan ? ` · ${esc(plan.label)}` : ''}`}${plan && NC.who !== 'ollama' ? ` <small>${NC.account ? '' : 'use next · '}${typeof plan.left === 'number' ? `${plan.left}%` : ''}</small>` : ''} ▾</button>`;
  $('barTools').innerHTML = toolsHtml({ fresh: true });
  $('barHint').textContent = '';
  loadModels();
  paintAttachments();
}
async function startNewChat() {
  const box = $('msgBox'); const text = box.value.trim();
  const p = projBy.get(NC.project);
  if (!text && !COMP.images.length) return box.focus();
  if (DRAW_RE.test(text)) return wrap(drawIntoMessage)(text);
  if (!p) return toast('Pick a project first.');
  if (COMP.converting) return toast('One moment: a picture is still being prepared.');
  const prov = NC.who === 'claude' ? 'claude' : 'codex';
  const perm = COMP.perm || permDefault(prov);
  const account = accountFor(NC.who);
  const model = COMP.model, effort = COMP.effort, images = imagesOut(), files = COMP.files.slice();
  // Straight to the conversation: your message is on screen with Starting… under it while the chat
  // starts, and everything else happens behind it.
  const local = { kind: 'user', text: files.length ? `${text}${text ? '\n\n' : ''}${files.map(f => `Attached file: \`${f.name}\``).join('\n')}` : text, images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  resetComposer();
  if (CV.es) { CV.es.close(); CV.es = null; }
  const run = {};
  const continues = NC.parent || null; NC.parent = null;
  Object.assign(CV, { run, continues, id: null, key: null, info: { cwd: p.cwd, state: 'starting', title: 'New chat' }, items: [local], cursor: null, live: '', status: 'Starting', pending: new Map(), busy: true, startedAt: Date.now(), loading: false, error: null, readOnly: null, sending: true, provider: prov });
  const mine = () => CV.run === run && S.view === 'chat';
  sfx('slide');
  go('chat', { draft: true }, { push: false });
  try {
    const info = await api('/api/chat/open', { mode: 'new', cwd: p.cwd, provider: prov, ...(account ? { account } : {}), permissionMode: perm, ...(model ? { model } : {}), ...(prov === 'codex' && COMP.fast ? { fast: true } : {}) });
    if (mine()) { CV.key = info.key; CV.info = { ...info, cwd: info.cwd || p.cwd }; listen(info.key); }
    const id = await startAndSend(info.key, text, images, async () => {
      if (effort) await api('/api/chat/model', { key: info.key, effort }).catch(() => {});
      for (const f of files) if (!f.rel && !f.error) await uploadOne(info.key, f);
      const lines = files.filter(f => f.rel).map(f => `Attached file: \`${f.rel}\` (${sizeText(f.size)})`).join('\n');
      const out = lines ? `${text}${text ? '\n\n' : ''}${lines}` : text;
      local.text = out;
      return out;
    });
    if (mine()) { if (id) adoptChatId(id); CV.sending = false; if (CV.status === 'Starting') CV.status = ''; paintStatus(); paintBar(); }
  } catch (err) {
    toast(err.message);
    if (CV.run !== run) return;
    CV.sending = false; CV.busy = false;
    // Didn't start: back to New chat with what you wrote.
    go('newchat', { ncProject: p.key });
    setTimeout(() => { const b = $('msgBox'); if (b && !b.value) { b.value = text; autosize(b); } }, 60);
  }
}
// A new chat learns its id once it has started: the page, the address and the list follow along
// without redrawing the conversation.
function adoptChatId(id) {
  if (!id || CV.id) return;
  CV.id = id;
  // A chat that continues another one (from another provider) sits under it.
  // (A new Ollama chat takes a few seconds to reach the list, so this tries for a little while.)
  if (CV.continues) {
    const parent = CV.continues; CV.continues = null;
    const tryLink = n => api('/api/lite/parent', { id, parent }).then(() => loadState()).catch(() => { if (n > 0) setTimeout(() => tryLink(n - 1), 5000); });
    tryLink(8);
  }
  const m = $('main'); if (m && S.view === 'chat') m.dataset.shownChat = String(id);
  try { history.replaceState({ view: 'chat', project: S.project, chat: id }, '', `/lite?chat=${encodeURIComponent(id)}`); } catch { /* fine */ }
  markSeen(id);
}
// Waits for a new chat to be ready, sends its first message, and returns its id once it has one.
function startAndSend(key, text, images = [], beforeSend = null) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
    let state = 'starting', id = null, sent = false;
    const finish = (err, v) => { clearTimeout(timer); es.close(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(null, id), 60e3);
    const maybeSend = async () => {
      if (sent || state === 'starting') return;
      if (state === 'ended') { finish(new Error('The chat stopped as it started. Open the full app to see why.')); return; }
      sent = true;
      try {
        const out = beforeSend ? await beforeSend() : text;
        await api('/api/chat/send', { key, text: out, ...(images.length ? { images } : {}) });
      } catch (err) { finish(err); return; }
      if (id) finish(null, id);
    };
    es.addEventListener('hello', e => { try { const i = JSON.parse(e.data); state = i.state; id = i.sessionId || id; } catch { /* fine */ } maybeSend(); });
    es.addEventListener('chat', e => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.kind === 'state') state = ev.state;
      if (ev.kind === 'init' && ev.sessionId) id = ev.sessionId;
      maybeSend();
      if (sent && id) finish(null, id);
    });
  });
}
function pickProject(anchor, onPick, { personal = false } = {}) {
  // By bucket, in the sidebar's order; each bucket's projects in their set order, then the busiest.
  const bi = k => { const i = buckets().findIndex(b => b.id === k); return i < 0 ? 99 : i; };
  const ord = p => (typeof p.order === 'number' ? p.order : 1e9);
  const ps = ncProjects().sort((a, b) => bi(a.bucket) - bi(b.bucket) || ord(a) - ord(b) || b.updated - a.updated);
  const own = personal && buckets().find(b => b.id === 'personal');
  pop(anchor, `<div class="ph">Project</div><input class="pop-q" id="ppQ" placeholder="Type to filter" aria-label="Filter projects"><div id="ppList">${own ? `<button data-v="__own__"><b>${esc(own.name)}, as its own project</b><small>One line in ${esc(own.name)}</small></button>` : ''}${ps.map(p => `<button data-v="${esc(p.key)}">${esc(p.name)}<small>${esc(bucketName(p.bucket))}</small></button>`).join('')}</div>`, onPick);
  const q = $('ppQ'); if (!q) return;
  q.focus();
  q.addEventListener('input', () => { const t = q.value.toLowerCase(); for (const b of $('ppList').querySelectorAll('button')) b.hidden = !b.textContent.toLowerCase().includes(t); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = [...$('ppList').querySelectorAll('button')].find(x => !x.hidden); if (b) { e.preventDefault(); b.click(); } } });
}
// In a one-question ask, ↵ in Other sends what you typed.
document.addEventListener('keydown', e => {
  const t = e.target; if (e.key !== 'Enter' || !t.matches || !t.matches('.other-t[data-otherq]')) return;
  const p = CV.pending.get(t.dataset.otherq); if (!p) return;
  e.preventDefault();
  if (!quickQ(p)) { t.closest('.ask-card').querySelector('[data-sendanswers]')?.click(); return; }
  const v = t.value.trim(); if (v) answerInChat(p.requestId, 'allow', { [p.questions[0].question]: v });
});

// Pointing at a chat (sidebar, lists) starts reading it, so it's usually there by the time you click.
// One at a time, and not again for a minute.
let prefetching = null;
document.addEventListener('pointerover', e => {
  const row = e.target.closest && e.target.closest('[data-chat], [data-open]');
  const id = row && (row.dataset.chat || row.dataset.open);
  if (!id || id === CV.id || prefetching) return;
  const had = CHAT_CACHE.get(id);
  if (had && Date.now() - had.at < 60e3) return;
  clearTimeout(document._pf);
  document._pf = setTimeout(async () => {
    if (prefetching || !row.matches(':hover')) return;
    prefetching = id;
    try {
      const c = chatBy.get(id);
      const q = new URLSearchParams({ id, lite: '1', ...(c && c.provider === 'codex' ? { provider: 'codex' } : {}) });
      const h = await api(`/api/chat/history?${q}`);
      if (id !== CV.id) { CHAT_CACHE.delete(id); CHAT_CACHE.set(id, { items: h.items || [], cursor: h.cursor || null, at: Date.now() }); while (CHAT_CACHE.size > 12) CHAT_CACHE.delete(CHAT_CACHE.keys().next().value); }
    } catch { /* it loads when opened */ } finally { prefetching = null; }
  }, 120);
}, { passive: true });

// Nudge a chat that's gone quiet: stop the turn that never got going, then tell it to carry on.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-nudge]'); if (!b || !CV.key) return;
  b.disabled = true;
  const key = CV.key;
  wrap(async () => {
    await api('/api/chat/interrupt', { key });
    for (let i = 0; i < 20 && CV.key === key && CV.busy; i++) await new Promise(r => setTimeout(r, 250));
    await api('/api/chat/send', { key, text: 'You went quiet (nothing for several minutes), so I stopped that turn. Carry on where you left off.' });
    CV.progressAt = Date.now(); toast('Nudged. It should pick up again in a moment.');
  })();
});
