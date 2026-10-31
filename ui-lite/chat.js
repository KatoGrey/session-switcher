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
const permDefault = provider => { if (provider === 'gemini') return S.lite.permissions?.gemini || 'accept-edits'; const f = permFam(provider); return (S.lite.permissions && S.lite.permissions[f]) || (S.appPermissions && S.appPermissions[f]) || (f === 'claude' ? 'default' : 'agent'); };

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
// Videos a reply names (a Markdown image, a link, a file path in code, or an address ending in
// .mp4/.mov/.webm/.m4v) play in the chat, with a Download button. Files on this Mac stream from
// /api/media (it seeks, which Safari needs); ones that can't load hide.
const VID_EXT = /\.(mp4|m4v|webm|mov)(\?[^\s]*)?$/i;
function vidSrc(ref, session, download = false) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (!session) return null;
  return `/api/media?${new URLSearchParams({ token: TOKEN, path: ref.replace(/^file:\/\//, ''), session, ...(download ? { download: '1' } : {}) })}`;
}
function videoHtml(ref, session) {
  const src = vidSrc(ref, session); if (!src) return '';
  const name = decodeURIComponent(ref.split(/[\\/]/).pop().split('?')[0]);
  const remote = /^https?:/i.test(ref);
  // Spans (shown as blocks), so a player written inside a paragraph doesn't break it.
  // #t=0.1: Safari then shows the opening frame instead of a black box until you press play.
  return `<span class="md-video"><video src="${esc(src.includes('#') ? src : `${src}#t=0.1`)}" controls playsinline preload="metadata" onerror="this.closest('.md-video').remove()"></video>`
    + `<span class="md-video-bar"><span class="md-video-name" title="${esc(ref)}">${esc(name)}</span><a class="btn sm" href="${esc(remote ? src : vidSrc(ref, session, true))}" download="${esc(name)}"${remote ? ' target="_blank" rel="noopener noreferrer"' : ''}>Download</a></span></span>`;
}
// Sound files (.mp3/.wav/.m4a/.ogg/.flac/.aac/.opus) play the same way, with a Download button.
const AUD_EXT = /\.(mp3|wav|m4a|ogg|oga|flac|aac|opus)(\?[^\s]*)?$/i;
function audioHtml(ref, session) {
  const src = vidSrc(ref, session); if (!src) return '';
  const name = decodeURIComponent(ref.split(/[\\/]/).pop().split('?')[0]);
  const remote = /^https?:/i.test(ref);
  return `<span class="md-audio"><span class="md-video-bar"><span class="md-video-name" title="${esc(ref)}">♪ ${esc(name)}</span><a class="btn sm" href="${esc(remote ? src : vidSrc(ref, session, true))}" download="${esc(name)}"${remote ? ' target="_blank" rel="noopener noreferrer"' : ''}>Download</a></span>`
    + `<audio src="${esc(src)}" controls preload="metadata" onerror="this.closest('.md-audio').remove()"></audio></span>`;
}
// A link to music on Spotify, YouTube (and YouTube Music), Apple Music or SoundCloud plays in the
// chat in that service's own player. Returns the player's address and its height, or null.
function musicEmbed(url) {
  let u; try { u = new URL(String(url).replace(/&amp;/g, '&')); } catch { return null; }
  const h = u.hostname.replace(/^www\./, ''), parts = u.pathname.split('/').filter(Boolean);
  if (h === 'open.spotify.com') {
    const i = parts.findIndex(x => /^(track|album|playlist|episode|show|artist)$/.test(x));
    if (i < 0 || !parts[i + 1]) return null;
    return { src: `https://open.spotify.com/embed/${parts[i]}/${encodeURIComponent(parts[i + 1])}`, h: parts[i] === 'track' || parts[i] === 'episode' ? 152 : 352, kind: 'spotify' };
  }
  const yt = h === 'youtu.be' ? parts[0] : /(^|\.)youtube\.com$/.test(h) ? (u.searchParams.get('v') || (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed' ? parts[1] : null)) : null;
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { src: `https://www.youtube-nocookie.com/embed/${yt}`, ratio: true, kind: 'youtube' };
  if (/(^|\.)youtube\.com$/.test(h) && parts[0] === 'playlist' && u.searchParams.get('list')) return { src: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(u.searchParams.get('list'))}`, ratio: true, kind: 'youtube' };
  if (h === 'music.apple.com' && parts.length >= 3) return { src: `https://embed.music.apple.com${u.pathname}${u.search}`, h: u.searchParams.get('i') ? 175 : 450, kind: 'apple' };
  if (h === 'soundcloud.com' && parts.length >= 2) return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com${u.pathname}`)}&visual=false&show_comments=false`, h: parts.includes('sets') ? 352 : 166, kind: 'soundcloud' };
  return null;
}
function embedHtml(url) {
  const m = musicEmbed(url); if (!m) return '';
  return `<span class="md-embed k-${m.kind}${m.ratio ? ' ratio' : ''}"${m.h ? ` style="height:${m.h}px"` : ''}><iframe src="${esc(m.src)}" loading="lazy" title="Music player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></span>`;
}
const isMedia = ref => VID_EXT.test(ref) || AUD_EXT.test(ref);
const mediaHtml = (ref, session) => (/^https?:/i.test(ref) && musicEmbed(ref) ? embedHtml(ref) : AUD_EXT.test(ref) ? audioHtml(ref, session) : videoHtml(ref, session));
function mdHtml(src, { session = typeof CV !== 'undefined' && S.view === 'chat' ? CV.id : null } = {}) {
  const blocks = [];
  let pics = [], vids = [];
  const pic = ref => { if (isMedia(ref) || (/^https?:/i.test(ref) && musicEmbed(ref))) return vid(ref); const u = picSrc(ref, session); if (u && !pics.includes(u) && pics.length < 8) pics.push(u); };
  const vid = ref => { if (!vids.includes(ref) && vids.length < 4) vids.push(ref); };
  const thumbs = () => {
    const v = vids.map(r => mediaHtml(r, session)).join(''); vids = [];
    if (!pics.length) return v;
    const h = `<div class="md-thumbs">${pics.map(u => `<img src="${esc(u)}" alt="" loading="lazy" data-zoom="1" onerror="this.remove()">`).join('')}</div>`; pics = []; return h + v;
  };
  let t = String(src || '').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    code = code.replace(/\n$/, '');
    // HTML can be seen drawn, in a frame that runs no scripts and reaches nothing.
    const html = /^html?$/i.test(lang) ? `<details class="md-html"><summary>Show it drawn</summary><iframe sandbox="" srcdoc="${esc(code)}" title="The HTML, drawn"></iframe></details>` : '';
    blocks.push(`<pre><code>${esc(code)}</code></pre>${html}`); return `\u0000${blocks.length - 1}\u0000`;
  });
  // Code, links and bare addresses are set aside first, so bold and italics can't reach inside them.
  const inline = x => {
    const held = [], hold = h => `\u0001${held.push(h.replace(/\u0001(\d+)\u0001/g, (m, i) => held[Number(i)] || m)) - 1}\u0001`;
    // A Markdown image shows where it's written.
    x = String(x).replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, alt, ref) => { if (isMedia(ref)) { const v = mediaHtml(ref, session); return v ? `\u0002${held.push(v) - 1}\u0002` : alt; } const u = picSrc(ref, session); return u ? `\u0002${held.push(`<img class="md-img" src="${esc(u)}" alt="${esc(alt)}" data-zoom="1" onerror="this.remove()">`) - 1}\u0002` : alt; });
    return esc(x)
      .replace(/\u0002(\d+)\u0002/g, (m, i) => hold(held[Number(i)]))
      .replace(/`([^`\n]+)`/g, (m, c) => ((IMG_EXT.test(c.trim()) || isMedia(c.trim())) && typeof looksLikePath === 'function' && looksLikePath(c.trim()) ? pic(c.trim()) : null, hold(`<code${typeof looksLikePath === 'function' && looksLikePath(c) ? ' class="vpath" title="Open beside the chat"' : ''}>${c}</code>`)))
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, href) => ((IMG_EXT.test(href) || isMedia(href) || musicEmbed(href)) && pic(href.replace(/&amp;/g, '&')), hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)))
      // Gemini cites local files with file:// URLs, sometimes with a line fragment.
      .replace(/\[([^\]\n]+)\]\((file:\/\/[^\s)]+)\)/gi, (m, label, href) => {
        try {
          const u = new URL(href.replace(/&amp;/g, '&'));
          if (u.hostname && u.hostname !== 'localhost') return m;
          const file = decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
          if (IMG_EXT.test(file) || isMedia(file)) pic(file);
          return hold(`<a href="#" class="vlink" data-viewfile="${esc(file)}">${label}</a>`);
        } catch { return m; }
      })
      // A link to a file (a relative path, ~/…, /Users/…) opens it beside the chat.
      .replace(/\[([^\]\n]+)\]\(((?:~|\.{0,2}\/|[\w@-])[^\s)]*?)\)/g, (m, label, href) => (/^[a-z]+:/i.test(href) ? m : ((IMG_EXT.test(href) || isMedia(href)) && pic(href), hold(`<a href="#" class="vlink" data-viewfile="${href}">${label}</a>`))))
      // A bare address is a link too (without the full stop or bracket that ends its sentence).
      .replace(/\bhttps?:\/\/[^\s<>"')\]]+/g, u => { const t = u.replace(/(&quot;|&#39;|[.,;:!?*_])+$/, ''); if (IMG_EXT.test(t) || isMedia(t) || musicEmbed(t)) pic(t.replace(/&amp;/g, '&')); return hold(`<a href="${t}" target="_blank" rel="noopener noreferrer">${t}</a>`) + u.slice(t.length); })
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<i>$2</i>')
      .replace(/\u0001(\d+)\u0001/g, (m, i) => held[Number(i)]);
  };
  const out = [];
  let list = null;
  const levels = [];
  const renderList = l => `<${l.tag}${l.tag === 'ol' ? ` start="${l.start}"` : ''}>${l.items.map(parts => `<li>${parts.map(p => typeof p === 'string' ? (l.loose ? `<p>${p}</p>` : p) : renderList(p)).join('')}</li>`).join('')}</${l.tag}>`;
  const flush = () => { if (list) { out.push(renderList(list)); list = null; levels.length = 0; } const th = thumbs(); if (th) out.push(th); };
  const indentOf = line => /^\s*/.exec(line)[0].replace(/\t/g, '    ').length;
  const listMarker = line => /^\s*(?:([-+*•])|(\d+)[.)])\s+(.*)$/.exec(line || '');
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
    if ((m = listMarker(line))) {
      const indent = indentOf(line), tag = m[1] ? 'ul' : 'ol';
      while (levels.length > 1 && levels[levels.length - 1].indent > indent) levels.pop();
      if (levels.length && levels[0].indent > indent) flush();
      let current = levels[levels.length - 1];
      if (current && current.indent === indent && current.tag !== tag) {
        if (levels.length === 1) flush(); else levels.pop();
        current = levels[levels.length - 1];
      }
      if (!current || current.indent < indent) {
        const child = { tag, indent, start: Number(m[2]), items: [] };
        if (current) current.items[current.items.length - 1].push(child); else list = child;
        levels.push(child); current = child;
      }
      current.items.push([inline(m[3])]); continue;
    }
    // Blank lines keep loose lists together; indentation still decides the level.
    if (list && !line.trim()) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const indent = indentOf(lines[next] || '');
      if (listMarker(lines[next]) || (lines[next]?.trim() && indent > levels[levels.length - 1].indent)) {
        const level = [...levels].reverse().find(l => l.indent <= indent) || list;
        level.loose = true;
        if (!listMarker(lines[next])) level.items[level.items.length - 1].push('');
        i = next - 1; continue;
      }
    }
    if (list && line.trim() && indentOf(line) > levels[levels.length - 1].indent) {
      const parts = levels[levels.length - 1].items.at(-1);
      const text = inline(line.trim());
      if (typeof parts.at(-1) === 'string') parts[parts.length - 1] += (parts.at(-1) ? ' ' : '') + text;
      else parts.push(text);
      continue;
    }
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
function externalChatNotice() {
  if (CV.key || !CV.id) return null;
  const x = S.live.find(l => l.sessionId && l.sessionId.toLowerCase() === String(CV.id).toLowerCase());
  // An idle desktop/terminal process still owns the history until that session is closed.
  if (x?.source === 'terminal') return 'This chat is open in Claude desktop or a terminal, even if it has finished replying. Close that session there to continue here. Your draft stays here.';
  if (x && x.source !== 'app' && x.working) return 'This chat is working in another app. Continue there, or close that session before replying here. Your draft stays here.';
  return null;
}
async function openChatView(id, { key = null, provider = null, keepRead = false } = {}) {
  const seq = ++openSeq;
  if (CV.id && String(CV.id) !== String(id)) cacheChat();
  if (CV.es) { CV.es.close(); CV.es = null; }
  // When it catches up on a chat you're reading higher up in, you stay where you were; otherwise it opens at the end.
  const readAt = keepRead ? CV.readAt : null;
  Object.assign(CV, { readAt, id, key, inRepo: false, info: null, items: [], queue: queueFor(id), cursor: null, live: '', status: '', pending: new Map(), busy: false, startedAt: 0, loading: true, error: null, readOnly: null, sending: false, replaying: null });
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
  CV.readOnly = externalChatNotice();
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
  // A running chat is painted once its stream has caught up (see listen), so the end of the
  // conversation doesn't vanish and then play back step by step.
  if (CV.key) { listen(CV.key, { paint: true }); partnerFind(); } else paintChat();
  paintQueue();
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
  if (sc) CV.readAt = sc.scrollTop;
  CV.items = [...(h.items || []), ...CV.items]; CV.cursor = h.cursor || null;
  paintFeed();
  if (sc) sc.scrollTop = sc.scrollHeight - before;
}

function listen(key, { paint = false } = {}) {
  if (CV.es) CV.es.close();
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  CV.es = es; CV.lastEventAt = Date.now();
  // On connecting, the stream first replays this run so far (its steps, the "working" line, the
  // reply). That's taken in without painting and shown once at the end ("replayed"); before, opening
  // a chat showed its reply, played the last turn back, then showed the reply again.
  CV.replaying = es;
  const caughtUp = () => { if (CV.replaying !== es) return; CV.replaying = null; if (paint) paintChat(); else { paintFeed(); paintBar(); } };
  es.addEventListener('replayed', caughtUp);
  setTimeout(caughtUp, 4000);
  es.addEventListener('hello', e => { if (CV.es !== es) return; CV.lastEventAt = Date.now(); try { CV.info = JSON.parse(e.data); CV.busy = ['busy', 'waiting', 'starting'].includes(CV.info.state) || CV.sending; paintBar(); paintHead(); } catch { /* fine */ } });
  es.addEventListener('chat', e => { if (CV.es !== es) return; CV.lastEventAt = Date.now(); let ev; try { ev = JSON.parse(e.data); } catch { return; } onEvent(ev); });
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
    case 'result': CV.busy = false; CV.status = ''; CV.startedAt = 0; CV.live = ''; CV.thinking = ''; setTimeout(sendQueued, 300); markSeen(CV.id); if (!ev.ok && (ev.errors || []).length) { const n = { kind: 'notice', level: 'warning', text: ev.errors.join(' ') }; const last = CV.items[CV.items.length - 1]; if (last?.kind !== 'notice' || last.text !== n.text) { CV.items.push(n); appendItem(n); } } paintLive(); paintStatus(); paintBar(); break;
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
    const attached = text.split('\n').map(l => /^Attached file: `([^`]+)`/.exec(l.trim())).filter(Boolean).map(m => m[1]);
    const files = attached.map(f => f.split('/').pop());
    const clips = attached.filter(isMedia).map(f => mediaHtml(f, CV.id)).join('');
    return `<div class="msg-you${cmdr ? ' from-cmdr' : ''}">${pics.length ? `<div class="msg-pics">${pics.map(src => `<img src="${src}" alt="" data-zoom="1">`).join('')}</div>` : ''}${cmdr ? '<span class="tag">from Commander</span> ' : ''}${linkText(shown.join('\n').trim())}${files.length ? `<div class="msg-files">${files.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}${clips}</div>`;
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
  pop(anchor, `<div class="ph">Pictures in this chat · ${pics.length}</div><div class="pic-grid">${pics.map(p => `<button class="pic" data-v="${esc(p.src)}" title="${esc(p.prompt || p.who)}"><img src="${esc(p.src)}" alt=""></button>`).join('')}</div>`, v => showPicture(v, pics.map(p => p.src)));
}
// The header only changes when what's in it does.
function paintHead() {
  const h = $('chatHead'); if (!h) return;
  const n = chatHead(); if (h._h === n) return;
  h.outerHTML = n; const nh = $('chatHead'); if (nh) nh._h = n;
}

// Every link the chat mentioned (its PRs, previews, local servers, threads), newest first, named
// for what it is, so they're a click away at the top instead of somewhere up the scroll.
// own: the chat's repo and its PR's preview, from the Bugs pipeline, when it has a PR there.
function linkLabel(u, own = null) {
  let m;
  // A PR in the chat's own repo (or Latitude's) is just "PR #n"; one elsewhere says which repo.
  if ((m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(u))) return { kind: 'pr', label: `PR #${m[3]}${m[2] === 'latitude' || (own && own.repo && `${m[1]}/${m[2]}`.toLowerCase() === own.repo.toLowerCase()) ? '' : ` · ${m[2]}`}` };
  // Latitude's preview sites by name; any other repo's preview link (see REPOS in lib/lite-pipeline.js) as its PR's.
  if ((m = /\/\/pr-(\d+)\.preview\.(voyage\.io|aidungeon\.com)/.exec(u))) return { kind: 'preview', label: `Preview #${m[1]} · ${m[2] === 'voyage.io' ? 'Voyage' : 'AI Dungeon'}` };
  if (own && own.preview && u.replace(/\/+$/, '') === own.preview.replace(/\/+$/, '')) return { kind: 'preview', label: `Preview #${own.n}` };
  if ((m = /\/\/(localhost|127\.0\.0\.1)(:\d+)?/.exec(u))) return { kind: 'local', label: `localhost${m[2] || ''}` };
  if ((m = /linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/.exec(u))) return { kind: 'other', label: m[1] };
  if ((m = /github\.com\/[^/]+\/([^/?#]+)/.exec(u))) return { kind: 'other', label: `GitHub · ${m[1]}` };
  if (/slack\.com\/archives\//.test(u)) return { kind: 'other', label: 'Slack thread' };
  if (/discord\.com\/channels\//.test(u)) return { kind: 'other', label: 'Discord' };
  try { const x = new URL(u); return { kind: 'other', label: (x.host.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : '')).slice(0, 48) }; } catch { return { kind: 'other', label: u.slice(0, 48) }; }
}
function chatLinks() {
  const c = chatBy.get(CV.id), it = c && typeof pipeItem === 'function' ? pipeItem(c) : null;
  const prev = it && it.pr && typeof previewUrl === 'function' ? previewUrl(it.pr) : null;
  const own = it && it.pr ? { repo: it.repo || null, preview: prev, n: it.pr.number } : null;
  const key = `${CV.id}:${CV.items.length}:${own ? own.n : ''}`;
  if (chatLinks.memo && chatLinks.memo.key === key) return chatLinks.memo.list;
  const seen = new Set(), list = [];
  const add = u => {
    u = String(u).replace(/[.,;:!?)\]}>'"`*_]+$/, '');
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u)) return;
    try { const h = new URL(u).hostname; if (!h.includes('.') && h !== 'localhost') return; } catch { return; }
    const k = u.replace(/\/+$/, '');
    if (seen.has(k)) return; seen.add(k); list.push({ url: u, ...linkLabel(u, own) });
  };
  for (const it of [...CV.items].reverse()) {
    const text = it.kind === 'assistant' ? (it.blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n') : it.kind === 'user' ? it.text || '' : '';
    const found = [...String(text).matchAll(/https?:\/\/[^\s<>()\[\]"'`]+/g)].map(x => x[0]);
    for (const u of found.reverse()) add(u);
  }
  // A bug chat's PR is known even when the chat never wrote its link.
  if (it && it.pr && it.pr.url) { add(it.pr.url); if (prev) add(prev); }
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
      <div class="ch-name"><div class="crumb${p && c && p.name.trim().toLowerCase() === chatTitle().trim().toLowerCase() ? ' same' : ''}">${p ? `<button data-project="${esc(p.key)}">${esc(p.name)}</button>` : ''}</div>${c ? `<button class="ttl" id="chatTitle" data-renamechat="1" title="Rename">${esc(chatTitle())}</button>` : `<span class="ttl" id="chatTitle">${esc(chatTitle())}</span>`}</div>
      <div class="ch-tools">${st ? `<button class="stage" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" title="Status, kind, Focus (s)">${c.focus ? '<span class="focus-star">★</span>' : `<span class="dot" style="background:${st.c}"></span>`}${st.name}</button>${kindTag(c)}${waitTag(c)}` : ''}
      ${(n => (n ? `<button class="iconbtn pics-btn" data-chatpics="1" aria-haspopup="menu" title="Pictures in this chat">${IC.image}<span>${n}</span></button>` : ''))(chatPictures().length)}
      ${headLinks()}
      ${c ? '<button class="iconbtn side-btn" data-sidechat="1" title="Side chat: ask or try something beside this chat, without derailing it">Side chat</button>' : ''}
      ${typeof chatFiles === 'function' && chatFiles().length ? `<button class="iconbtn files-btn" data-viewfiles="1" title="Files this chat read or changed (opens beside the chat)">Files</button>` : ''}</div>
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
  if (c.runIsWorktree && ['claude', 'codex'].includes(c.provider)) {
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
  const hadMessages = !!$('feedSegs')?.children.length;
  paintFeed(); paintPending(); paintBar(); paintStatus();
  if (typeof paintViewer === 'function') { if (VW.open && VW.chat !== CV.id) closeViewer(); else paintViewer(); }
  const f = $('feed'); if (CV.readAt == null) f.scrollTop = f.scrollHeight; else if (!hadMessages) f.scrollTop = CV.readAt;
  // Where you're reading: null at the end (it follows new messages), else how far down you are.
  // Near the top, earlier messages load by themselves (no button to press).
  if (!f._watching) {
    f._watching = true;
    // Images, fonts, replay and the composer can change the layout after we scroll
    // to the end. That is not a request to start reading an older message.
    const size = () => `${f.scrollHeight}:${f.clientHeight}:${f.clientWidth}`;
    let layout = size();
    // While you're scrolling yourself (a finger down, a wheel or trackpad, a scrollbar drag, keys,
    // and the glide after a flick), a change in size is never a reason to jump to the end: on a
    // phone the header's chip row tucking away, or Safari's address bar, resizes the feed mid-scroll,
    // and following then snapped you back to the bottom as you tried to read up.
    let touching = false, handAt = 0;
    const hand = () => { handAt = Date.now(); };
    const yours = () => touching || Date.now() - handAt < 600;
    f.addEventListener('touchstart', () => { touching = true; hand(); }, { passive: true });
    f.addEventListener('touchend', () => { touching = false; hand(); }, { passive: true });
    f.addEventListener('touchcancel', () => { touching = false; hand(); }, { passive: true });
    f.addEventListener('wheel', hand, { passive: true });
    f.addEventListener('keydown', hand);
    f.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { touching = true; hand(); } });
    addEventListener('pointerup', () => { if (touching) { touching = false; hand(); } });
    const follow = () => {
      if (CV.readAt == null && !yours()) f.scrollTop = f.scrollHeight;
      layout = size();
    };
    const resize = new ResizeObserver(() => {
      if (!f.isConnected) { resize.disconnect(); return; }
      if (f === $('feed') && S.view === 'chat') follow();
    });
    resize.observe(f);
    resize.observe($('feedInner'));
    // (prevY: the last position; turnY: where the current direction of scrolling began.)
    let prevY = f.scrollTop, turnY = f.scrollTop, dir = 0;
    f.addEventListener('scroll', () => {
      if (f !== $('feed') || S.view !== 'chat') return;
      if (yours()) hand();   // the glide after a flick is still you
      else if (layout !== size()) { follow(); prevY = f.scrollTop; return; }
      layout = size();
      CV.readAt = f.scrollHeight - f.scrollTop - f.clientHeight < 160 ? null : f.scrollTop;
      // On a phone the header's chip row tucks away while you read back through the conversation,
      // and comes back as you scroll down again (40px or more) or reach the newest message.
      if (matchMedia('(max-width: 760px)').matches) {
        const v = $('chatView'), y = f.scrollTop, atEnd = f.scrollHeight - y - f.clientHeight < 80;
        const d = Math.sign(y - prevY);
        if (d && d !== dir) { dir = d; turnY = prevY; }
        prevY = y;
        if (v) {
          const want = atEnd ? false : dir < 0 && y < turnY - 40 ? true : dir > 0 && y > turnY + 40 ? false : null;
          if (want !== null && want !== v.classList.contains('ch-tucked')) v.classList.toggle('ch-tucked', want);
        }
      }
      if (CV.readAt != null && f.scrollTop < 900 && CV.cursor && !CV.loading && !CV.replaying && !loadEarlier.busy) loadEarlier().catch(() => {});
    }, { passive: true });
  }
  if (!REMOTE && !matchMedia('(max-width: 760px)').matches) $('msgBox')?.focus();
}
const nearBottom = () => { const f = $('feed'); return !f || f.scrollHeight - f.scrollTop - f.clientHeight < 160; };
// Messages already on screen stay as they are (pictures don't reload, open step lists stay open);
// new ones are added at the end and only a segment that changed is swapped.
function paintFeed() {
  const el = $('feedInner'); if (!el || CV.replaying) return;
  const stick = CV.readAt == null;
  if (!$('feedSegs')) el.innerHTML = '<div id="feedTop" class="segs"></div><div id="feedSegs" class="segs"></div><div id="liveText" class="msg-ai live"></div><div id="pendingBox"></div><div id="statusLine" class="step live-status"></div>';
  const top = `${CV.cursor ? '<button class="linkish earlier" data-earlier="1">Earlier messages</button>' : ''}${CV.loading ? '<p class="empty-note">Loading…</p>' : CV.error ? `<p class="empty-note">${esc(CV.error)}</p>` : !CV.items.length ? '<p class="empty-note">Nothing here yet.</p>' : ''}`;
  const t = $('feedTop'); if (t._h !== top) { t.innerHTML = top; t._h = top; }
  const box = $('feedSegs'), segs = feedSegments(), feed = $('feed');
  const oldTop = feed.scrollTop, edge = feed.getBoundingClientRect().top;
  const anchor = !stick && [...box.children].find(k => k.getBoundingClientRect().bottom > edge);
  const offset = anchor ? anchor.getBoundingClientRect().top - edge : 0;
  // History can prepend steps or regroup them after replay. Reuse matching nodes
  // instead of replacing every later segment by index (which collapses the feed).
  const available = new Map();
  for (const k of box.children) { const list = available.get(k._h) || []; list.push(k); available.set(k._h, list); }
  for (let i = 0; i < segs.length; i++) {
    let d = available.get(segs[i])?.shift();
    if (!d) { d = document.createElement('div'); d.className = 'segs'; d.innerHTML = segs[i]; d._h = segs[i]; }
    if (box.children[i] !== d) box.insertBefore(d, box.children[i] || null);
  }
  while (box.children.length > segs.length) box.lastChild.remove();
  paintLive(); paintPending(); paintStatus(); paintHead();
  if (stick) feed.scrollTop = feed.scrollHeight;
  else {
    feed.scrollTop = anchor?.isConnected ? feed.scrollTop + anchor.getBoundingClientRect().top - edge - offset : oldTop;
    CV.readAt = feed.scrollTop;
  }
}
function appendItem() { paintFeed(); }
function paintLive() { const el = $('liveText'); if (!el || CV.replaying) return; const pl = typeof PARTNER !== 'undefined' ? PARTNER.live : ''; el.innerHTML = (CV.live ? mdHtml(CV.live) : '') + (pl ? `<div class="from-partner"><span class="who">${esc(partnerName())}</span>${mdHtml(pl)}</div>` : ''); el.hidden = !CV.live && !pl; if (CV.readAt == null) $('feed').scrollTop = $('feed').scrollHeight; }
// How long it's been working, to the second (the page's own clock, not the list's).
const workedFor = t => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`; };
// The line under the conversation while it works: what it's doing, the end of its thinking when the
// model shares it (Claude does; Codex only says it's thinking), and the time.
function paintStatus() {
  const el = $('statusLine'); if (!el || CV.replaying) return;
  // Quiet since its last sign of progress, and never since before this turn began (a time left from another chat).
  const since = Math.max(CV.progressAt || 0, CV.startedAt || 0);
  const quietMin = CV.busy && since && CV.lastStep !== 'tool' && !CV.pending.size ? Math.floor((Date.now() - since) / 60000) : 0;
  if (quietMin >= 4) {
    el.hidden = false;
    const h = `<span class="live-dot stall"></span><span class="st-what">Nothing from it for ${quietMin} min. It may be stuck.</span><button type="button" class="btn sm" data-nudge="1" title="Stop this turn and tell it to carry on">Nudge</button><span class="st-time">${CV.startedAt ? workedFor(CV.startedAt) : ''}</span>`;
    if (el._h !== h) { el.innerHTML = h; el._h = h; }
    return;
  }
  el._h = null;
  const pBusy = typeof PARTNER !== 'undefined' && PARTNER.busy;
  el.hidden = !CV.busy && !pBusy && !CV.pending.size;
  if (CV.pending.size) { el.innerHTML = '<span class="live-dot"></span><span class="st-what">Waiting for your answer</span>'; return; }
  if (!CV.busy && pBusy) { el.innerHTML = `<span class="live-dot"></span><span class="st-what">${esc(partnerName())} is working</span>`; return; }
  if (!CV.busy) { el.innerHTML = ''; return; }
  const what = String(CV.status || 'Thinking').replace(/^mcp__(.+?)__/, '$1: ');
  const tail = what === 'Thinking' && CV.thinking ? CV.thinking.replace(/\s+/g, ' ').trim().split(/(?<=[.!?:])\s+/).filter(Boolean).pop() || '' : '';
  el.innerHTML = `<span class="live-dot"></span><span class="st-what">${esc(what)}</span>${tail ? `<span class="st-think">${esc(tail.slice(-160))}</span>` : ''}<span class="st-time">${CV.startedAt ? workedFor(CV.startedAt) : ''}</span>`;
}
function paintPending() {
  paintStatus();
  const el = $('pendingBox'); if (!el || CV.replaying) return;
  // Only redrawn when what's asked changes, so answers you've started picking stay picked.
  const sig = [...CV.pending.keys()].join(',');
  if (el._sig === sig && el.innerHTML) { if (CV.pending.size && nearBottom()) $('feed').scrollTop = $('feed').scrollHeight; return; }
  el._sig = sig;
  el.innerHTML = [...CV.pending.values()].map(p => {
    if (p.questions && p.questions.length) return questionCard(p);
    const v = p.view || {};
    return `<div class="ask-card" data-req="${esc(p.requestId)}"><p class="q">${p.partner ? `${esc(p.partner)} wants` : 'Wants'} to ${esc(wantsTo(p.toolName))}</p>${p.reason ? `<p>${esc(p.reason)}</p>` : ''}${v.detail || v.summary ? `<code class="ask-code">${esc(v.detail || v.summary)}</code>` : ''}
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
  return `<div class="ask-card ask" data-req="${rid}"><p class="q">${esc(p.partner || 'It')} has ${p.questions.length === 1 ? 'a question' : `${p.questions.length} questions`}</p>${qs}
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
    <div class="delivery-bar" id="deliveryBar" hidden></div>
    <div class="tools" id="barTools"></div>
    <input type="file" id="attIn" multiple hidden>
  </form>`;
}
// Models and efforts each assistant offers, remembered from the last chat that reported them, so
// the chips work before a chat is running.
// From the Mac (/api/lite/models: real names, and what a new chat gets by default); else what a
// chat last reported.
const MD = prov => S.models?.[prov] || null;
const modelsFor = prov => (MD(prov) ? [...MD(prov).models, ...MD(prov).more] : local.get(`models:${prov}`, []));
const effortsFor = prov => (MD(prov) && MD(prov).efforts) || local.get(`efforts:${prov}`, prov === 'gemini' ? [] : prov === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh']);
function loadModels() { if (S.models || loadModels.p) return loadModels.p; loadModels.p = api('/api/lite/models').then(j => { S.models = j; if (S.view === 'newchat') paintNewChat(); else if (S.view === 'chat') paintBar(); }).catch(() => {}); return loadModels.p; }
const defaultReplyModel = prov => S.modelDefaults?.[prov] || MD(prov)?.defaultValue || null;
const selectedReplyModel = (prov, fresh = false) => {
  const info = fresh ? null : prov === provNow() ? CV.info : prov === replyProv() ? replyTarget().info : null;
  const own = fresh || prov === provNow(), chat = !fresh && own ? chatBy.get(CV.id) : null;
  return info?.model || info?.resolvedModel || info?.replyModel || (own && COMP.model) || chat?.preferredModel || defaultReplyModel(prov) || chat?.model || null;
};
async function rememberModelChoice(prov, model) {
  await api('/api/chat/model-default', { provider: prov, model });
  S.modelDefaults = { ...S.modelDefaults, [prov]: model };
}
function rememberModels(prov, info) {
  if (info && Array.isArray(info.models) && info.models.length) local.set(`models:${prov}`, info.models.map(m => ({ value: m.value, label: m.label })).slice(0, 30));
  if (info && Array.isArray(info.efforts) && info.efforts.length) local.set(`efforts:${prov}`, info.efforts);
}
const provNow = () => (S.view === 'newchat' ? NC.who : CV.provider === 'gemini' ? 'gemini' : CV.provider === 'codex' ? ((CV.info && /ollama/i.test(CV.info.accountName || '')) || (chatBy.get(CV.id) || {}).ollama ? 'ollama' : 'codex') : 'claude');
// The composer controls the assistant selected to answer, which can be a partner of this chat.
const replyProv = () => S.view === 'chat' && toKind(CV.to) || provNow();
function replyTarget() {
  const kind = S.view === 'chat' && toKind(CV.to);
  if (!kind) return { key: CV.key, info: CV.info, busy: CV.busy };
  return [...PARTNERS.values()].find(p => p.prov === kind) || { key: null, info: null, busy: false };
}
const replyBusy = () => CV.to === 'both' ? CV.busy || PARTNER.busy : replyTarget().busy;
let switchingChat = null;

// Start only the processes needed for the selection. No message is sent by changing a control.
async function ensureReply(p) {
  if (CV.readOnly) throw new Error(CV.readOnly);
  const id = CV.id, seq = openSeq;
  const check = () => { if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) throw new Error('The chat changed. Pick the assistant again here.'); };
  let lead = CV.info;
  if (!CV.key) {
    lead = await api('/api/chat/open', { sessionId: id, mode: 'resume', ...(CV.inRepo ? { inRepo: true } : {}), provider: CV.provider, account: accountFor(provNow()) || (chatBy.get(id) || {}).accountId, permissionMode: COMP.perm || permDefault(CV.provider), ...(selectedReplyModel(provNow()) ? { model: selectedReplyModel(provNow()) } : {}) });
    check(); CV.key = lead.key; CV.info = lead; listen(lead.key);
  }
  await waitReadyFor(CV.key); check();
  let info = p === provNow() ? CV.info : await api('/api/chat/companion', { key: CV.key, kind: p, account: accountFor(p) });
  check();
  if (info.key !== CV.key) {
    if (!PARTNERS.has(info.key)) partnerListen(info.key, p);
    PARTNERS.get(info.key).info = info;
    await waitReadyFor(info.key); check();
    info = await api('/api/chat/attach', { key: info.key }); check();
    PARTNERS.get(info.key).info = info;
  }
  return info;
}
async function changeReply(p, changes = {}, fromSend = false) {
  if (switchingChat || (CV.sending && !fromSend)) return toast('One moment: the chat is connecting.');
  const id = CV.id, seq = openSeq;
  const keepBoth = CV.to === 'both' && p === provNow() && ['model', 'effort', 'fast'].some(k => k in changes);
  switchingChat = id;
  toast('Connecting…');
  try {
    let info = await ensureReply(p);
    if (changes.account && info.accountId !== changes.account) {
      // Stopping a lead also stops its partners. Never discard an active turn to change accounts.
      let fresh = await api('/api/chat/attach', { key: info.key });
      if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
      let crew = info.key === CV.key ? await Promise.all(Object.values(fresh.crew?.running || {}).map(key => api('/api/chat/attach', { key }))) : [];
      if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
      if ([fresh, ...crew].some(p => ['busy', 'waiting', 'starting'].includes(p.state))) throw new Error('Let the current reply finish, or stop it, before changing accounts.');
      const background = [fresh, ...crew].flatMap(p => p.background || []);
      if (background.length) {
        const tasks = background.map(t => esc(t.description || 'Background task')).join('; ');
        if (!await confirmBox({ title: 'Stop background work and switch accounts?', body: `Still running: ${tasks}. Switching accounts stops this background work. Your conversation and draft stay.`, yes: 'Stop work and switch' })) throw new Error('Account change cancelled.');
        if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
        // A reply may have started on another device while the confirmation was open.
        fresh = await api('/api/chat/attach', { key: info.key });
        crew = info.key === CV.key ? await Promise.all(Object.values(fresh.crew?.running || {}).map(key => api('/api/chat/attach', { key }))) : [];
        if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
        if ([fresh, ...crew].some(p => ['busy', 'waiting', 'starting'].includes(p.state))) throw new Error('A reply started while you were choosing. Stop it before changing accounts.');
      }
      if (!fresh.sessionId) throw new Error('The chat is still starting. Try the account again in a moment.');
      const isLead = info.key === CV.key;
      await api('/api/chat/stop', { key: info.key });
      if (S.view === 'chat' && CV.id === id && openSeq === seq) {
        if (isLead) partnerReset();
        else { const old = PARTNERS.get(info.key); if (old && old.es) old.es.close(); PARTNERS.delete(info.key); }
      }
      // Reopen the partner itself, rather than the default route back to its parent chat.
      for (let attempt = 0; ; attempt++) {
        try {
          info = await api('/api/chat/open', { sessionId: fresh.sessionId, mode: 'resume', ...(CV.inRepo ? { inRepo: true } : {}), provider: fresh.provider, account: changes.account, alone: true, permissionMode: fresh.permissionMode, model: fresh.model, fast: fresh.fast });
          break;
        } catch (err) {
          // The keeper can report exit just before the OS process listing catches up.
          if (attempt >= 15 || err.status !== 409 || !/already open.*process/i.test(err.message)) throw err;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
      if (info.accountId !== changes.account) throw new Error('The account did not change. Try again once the chat has stopped.');
      if (isLead) { CV.key = info.key; CV.info = info; listen(info.key); }
      else {
        // Reattach the resumed process to its lead before the next message is routed to it.
        info = await api('/api/chat/companion', { key: CV.key, kind: p });
        if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
        if (!PARTNERS.has(info.key)) partnerListen(info.key, p);
        PARTNERS.get(info.key).info = info;
      }
      await waitReadyFor(info.key);
    }
    const modelChanges = { ...changes }; delete modelChanges.account;
    if (Object.keys(modelChanges).length) Object.assign(info, await api('/api/chat/model', { key: info.key, ...modelChanges }));
    if (changes.model) {
      S.modelDefaults = { ...S.modelDefaults, [p]: info.model || changes.model };
      const chat = chatBy.get(info.sessionId); if (chat) chat.preferredModel = info.model || changes.model;
    }
    if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return;
    if (info.key === CV.key) CV.info = info;
    else if (PARTNERS.has(info.key)) PARTNERS.get(info.key).info = info;
    CV.to = keepBoth ? 'both' : p === provNow() ? 'chat' : `partner:${p}`;
    setTo(id, CV.to); paintBar();
    toast(keepBoth ? `${toName('both')} will answer your next message.` : `${p === 'codex' ? 'Codex' : provName(p)}${info.accountName ? ` · ${info.accountName}` : ''} answers your next message here.`);
  } finally { switchingChat = null; paintBar(); }
}
// Account selection belongs to the Bridge. Apply it when a message is about to start, and fall
// back automatically when the current plan is exhausted. Changing a plan never submits a prompt.
async function applyReplyPlan() {
  const id = CV.id, seq = openSeq, to = CV.to;
  const kinds = to === 'both' ? [provNow(), ...crewKindsLite()] : [replyProv()];
  for (const p of kinds) {
    if (!['claude', 'codex'].includes(p)) continue;
    const family = p === 'claude' ? 'claude' : 'chatgpt', next = useNext(family);
    const target = p === provNow() ? CV.info || chatBy.get(id) : ([...PARTNERS.values()].find(x => x.prov === p) || {}).info;
    const current = target && planById(target.accountId);
    if (!next || (target && target.accountId === next.id)) continue;
    if (!preferredPlan(family) && !(current && (current.broken || current.left === 0 || current.fiveLeft === 0))) continue;
    await changeReply(p, { account: next.id }, true);
    if (S.view !== 'chat' || CV.id !== id || openSeq !== seq) return false;
    CV.to = to; setTo(id, to); paintBar();
  }
  return true;
}
const prettyModel = m => String(m).replace(/^claude-/, '').replace(/-(\d)-(\d)/, ' $1.$2').replace(/\[1m\]$/, ' 1M').replace(/^(\w)/, c => c.toUpperCase());
const modelLabel = (prov, v) => { const base = String(v).replace(/\[1m\]$/, ''); const m = modelsFor(prov).find(x => x.value === v || x.value === base); return m ? `${m.label}${/\[1m\]$/.test(v) ? ' 1M' : ''}` : prettyModel(v); };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const followUpDelivery = () => local.get('followUpDelivery', 'queue') === 'steer' ? 'steer' : 'queue';
const sendShortcut = (queue = false) => /Mac|iPhone|iPad/.test(navigator.platform) ? `⌘${queue ? '⇧' : ''}↵` : `Ctrl+${queue ? 'Shift+' : ''}Enter`;
function deliveryMenu(anchor) {
  pop(anchor, `<div class="ph">While the assistant is working</div>${[['queue', 'Queue', 'After the current reply', `${sendShortcut(true)}`], ['steer', 'Steer now', 'Guide the current work', `${sendShortcut()}`]].map(([v, label, note, key]) => `<button data-v="${v}" role="menuitemradio" aria-checked="${followUpDelivery() === v}"><span>${label}<span class="delivery-note">${note}</span></span><kbd>${key}</kbd></button>`).join('')}<div class="ph">Sets the send button and Enter. Shortcuts override it once.</div>`, v => {
    local.set('followUpDelivery', v); paintBar(); $('msgBox')?.focus({ preventScroll: true });
  });
}
function toolsHtml({ fresh }) {
  const prov = replyProv();
  const info = fresh ? null : replyTarget().info;
  const own = fresh || prov === provNow();
  const model = selectedReplyModel(prov, fresh);
  const effort = (info && info.effort) || (own && COMP.effort) || null;
  const md0 = MD(prov);
  const busy = !fresh && replyBusy();
  const delivery = followUpDelivery();
  const sendLabel = fresh ? 'Start' : busy ? delivery === 'steer' ? 'Steer now' : 'Queue' : 'Send';
  const sendHint = `${sendLabel}${TOUCH() ? '' : ' (Enter)'}${busy ? ` · ${sendShortcut()} to steer · ${sendShortcut(true)} to queue` : ''}`;
  return `<button type="button" class="iconbtn att-btn" data-attach="1" aria-label="Add images or files" title="Add images or files (or paste, or drop)">+</button>
    <button type="button" class="model${!fresh && CV.to && CV.to !== 'chat' ? ' to-on' : ''}" data-barmodel="1" aria-haspopup="menu" title="Model, and who answers">${esc((model ? modelLabel(prov, model) : md0 && md0.defaultModel ? md0.defaultModel : 'Model'))}${!fresh && CV.to === 'both' ? ` + ${esc(partnerName())}` : ''}${prov === 'codex' && ((info && info.fast) || (!info && COMP.fast)) ? ' ⚡' : ''}<span>▾</span></button>
    ${prov !== 'gemini' || effortsFor(prov).length ? `<button type="button" class="model" data-bareffort="1" aria-haspopup="menu" title="Effort">${esc(effort ? cap(effort) : md0 && md0.defaultEffort ? cap(md0.defaultEffort) : 'Auto effort')}<span>▾</span></button>` : ''}
    <span class="bar-hint" id="barHint"></span>
    <button type="button" class="iconbtn gear" data-chatsettings="1" aria-label="Conversation settings" title="Conversation settings">${IC.gear}</button>
    ${busy ? '<button type="button" class="iconbtn stop-sm" data-stopchat="1" aria-label="Stop (⌘.)" title="Stop (⌘.)">■</button>' : ''}
    <button type="submit" class="send" ${!fresh && CV.readOnly ? 'disabled' : ''} aria-label="${sendHint}" title="${sendHint}">↑</button>`;
}
function paintBar() {
  const t = $('barTools'); if (!t || S.view !== 'chat' || CV.replaying) return;
  CV.readOnly = externalChatNotice();
  if (CV.info) rememberModels(provNow(), CV.info);
  const ro = $('roNote');
  if (ro) { ro.hidden = !CV.readOnly; ro.textContent = CV.readOnly || ''; }
  const th = toolsHtml({ fresh: false }); if (t._h !== th) { t.innerHTML = th; t._h = th; }
  const box = $('msgBox'); if (box) box.readOnly = !!CV.readOnly;
  const deliveryBar = $('deliveryBar');
  if (deliveryBar) {
    deliveryBar.hidden = !replyBusy();
    const steer = followUpDelivery() === 'steer';
    const h = `<button type="button" data-delivery="1" aria-haspopup="menu" title="Choose what the send button does">${steer ? 'Steer current work' : 'Queue after reply'} <span>▾</span></button><span class="delivery-shortcut">${sendShortcut()} steer · ${sendShortcut(true)} queue</span>`;
    if (deliveryBar._h !== h) { deliveryBar.innerHTML = h; deliveryBar._h = h; }
    if (box) box.placeholder = replyBusy() ? steer ? 'Guide the current work…' : 'Add a follow-up…' : 'Reply…';
  }
  paintAttachments();
}
// Measured on a hidden copy. Collapsing the box itself to measure it resized the conversation above
// on every keystroke, which on a phone moved the text off the bottom and back. The box changes
// height only when a line is really added or removed.
let sizer = null;
function autosize(el) {
  if (!el.offsetWidth) return;
  const cs = getComputedStyle(el);
  if (!sizer) {
    sizer = document.createElement('textarea'); sizer.tabIndex = -1; sizer.setAttribute('aria-hidden', 'true');
    sizer.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;height:auto;max-height:none;overflow:hidden;pointer-events:none;resize:none';
    document.body.appendChild(sizer);
  }
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'borderStyle', 'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'minHeight', 'width']) sizer.style[p] = cs[p];
  sizer.rows = el.rows || 1; sizer.value = el.value;
  const h = `${Math.min(sizer.scrollHeight, parseFloat(cs.maxHeight) || 280, 280)}px`;
  if (el.style.height !== h) el.style.height = h;
}

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

// Follow-ups wait for the actual turn to finish, independent of the selected view.
// Queues survive navigation and reloads; images stay only for this visit.
const QUEUES = (() => { try { return JSON.parse(localStorage.getItem('lite.queues') || '{}') || {}; } catch { return {}; } })();
const queueFor = id => (id ? (QUEUES[id] = QUEUES[id] || []) : []);
function saveQueues() {
  for (const k of Object.keys(QUEUES)) if (!QUEUES[k].length) delete QUEUES[k];
  try { localStorage.setItem('lite.queues', JSON.stringify(Object.fromEntries(Object.entries(QUEUES).map(([k, v]) => [k, v.map(q => ({ text: q.text, images: [], route: q.route, editText: q.editText, error: q.error }))])))); } catch { /* fine */ }
}
let bgSending = false;
async function sendBackgroundQueues() {
  if (bgSending) return;
  bgSending = true;
  try {
    for (const [id, q] of Object.entries(QUEUES)) {
      const item = q[0];
      const here = () => S.view === 'chat' && String(CV.id).toLowerCase() === id.toLowerCase();
      const held = () => q[0] !== item || !item || item.sending || item.editText !== undefined || item.error || (here() && (CV.sending || switchingChat || CV.loading || CV.replaying));
      if (held()) continue;
      const x = S.live.find(l => l.sessionId && l.sessionId.toLowerCase() === id.toLowerCase());
      const key = here() && CV.key || (x && x.source === 'app' && x.key);
      if (!key) continue;
      // "Working" also includes background helpers. Only a real turn or approval holds the queue.
      let info, states;
      try {
        info = await api('/api/chat/attach', { key });
        const route = item.route || {};
        const crew = Object.entries(info.crew?.running || {}).filter(([kind]) => route.to === 'partner' ? kind === route.kind : route.to === 'both' ? !route.kind || kind === route.kind : !route.kinds?.length || route.kinds.includes(kind));
        states = route.to ? await Promise.all(crew.map(([, k]) => api('/api/chat/attach', { key: k }))) : [];
        if (route.to !== 'partner') states.push(info);
      } catch { continue; }
      if (held() || info.state === 'ended' || states.some(p => p.state !== 'ready')) continue;
      item.sending = true;
      const inView = here();
      if (inView) { CV.sending = true; paintQueue(); }
      try {
        await api('/api/chat/send', { key, text: item.text, ...(item.route || {}), ...(item.images.length ? { images: item.images.map(i => ({ mediaType: i.mediaType, data: i.data })) } : {}) });
        q.splice(q.indexOf(item), 1);
      } catch (err) { item.error = err.message; toast(err.message); }
      finally { delete item.sending; saveQueues(); if (here()) { if (inView) CV.sending = false; paintQueue(); } }
    }
  } finally { bgSending = false; }
}
// A missed stream event or an unchanged live list must not strand a follow-up.
setInterval(() => sendBackgroundQueues().catch(() => {}), 3000);

function paintQueue() {
  if (CV.id && CV.queue && CV.queue.length) QUEUES[CV.id] = CV.queue;
  saveQueues();
  const el = $('queueBox'); if (!el) return;
  keepFocused(el, () => { el.innerHTML = `<div class="queue-heading"><span>${(CV.queue || []).length} queued</span><span>Sent in order after each reply</span></div>` + (CV.queue || []).map((q, i) => `<div class="q-item${q.editText !== undefined ? ' q-editing' : ''}"><div class="q-main"><span class="q-meta">${q.sending ? 'Sending…' : q.error ? 'Not sent' : `${i + 1} · ${esc(q.route?.to === 'partner' ? NAME_OF[q.route.kind] || q.route.kind : q.route?.to === 'both' ? 'Both' : q.route?.to === 'all' ? 'All' : selfName())}`}</span><span class="q-text" title="${esc(q.text)}">${esc(q.text)}${q.images.length ? ` · ${q.images.length} picture${q.images.length === 1 ? '' : 's'}` : ''}</span></div>
    ${q.editText !== undefined ? `<textarea class="field" id="queuedEdit-${i}" data-qedit="${i}" rows="3" aria-label="Edit queued message">${esc(q.editText)}</textarea><div class="q-actions"><button type="button" class="btn prime" data-qsave="${i}">Save</button><button type="button" class="btn" data-qcancel="${i}">Cancel</button></div>` : `<div class="q-actions"><button type="button" class="btn" data-steerq="${i}" ${q.sending || CV.sending ? 'disabled' : ''} title="Send into the current work, or start now if idle">${q.error ? 'Retry now' : 'Steer now'}</button><button type="button" class="btn" data-qedit-start="${i}" ${q.sending ? 'disabled' : ''}>Edit</button><button type="button" class="iconbtn" data-unqueue="${i}" ${q.sending ? 'disabled' : ''} aria-label="Remove queued message">×</button></div>`}
    ${q.error ? `<small class="q-error">${esc(q.error)} · Kept here for you to retry.</small>` : ''}</div>`).join(''); });
  el.hidden = !(CV.queue || []).length;
}
function editQueued(i, action) {
  const q = CV.queue[i]; if (!q || q.sending) return;
  if (action === 'start') q.editText = q.text;
  else {
    if (action === 'save') {
      if (!q.editText.trim() && !q.images.length) return toast('Type a message, or cancel the edit.');
      q.text = q.editText.trim();
    }
    delete q.editText;
  }
  paintQueue();
  if (action === 'start') document.querySelector(`[data-qedit="${i}"]`)?.focus();
  else sendQueued();
}
function sendQueued() { return sendBackgroundQueues(); }
// A queued message keeps the recipient it had when written. With Both selected, live steering
// goes to the assistant currently working; the shared conversation carries it to the next one.
function queueTarget(route = {}) {
  if (route.to === 'partner') return [...PARTNERS.values()].find(p => p.prov === route.kind) || { key: null, busy: false };
  if (route.to === 'both' || route.to === 'all') {
    if (!CV.busy) { const p = [...PARTNERS.values()].find(p => p.busy && (route.to === 'both' ? !route.kind || p.prov === route.kind : !route.kinds?.length || route.kinds.includes(p.prov))); if (p) return p; }
  }
  return { key: CV.key, busy: CV.busy };
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
async function steerIn(text, imgs, route = {}) {
  const id = CV.id, key = queueTarget(route).key;
  if (!key) { toast('That assistant is not running yet. The message stays queued.'); return false; }
  const here = () => S.view === 'chat' && CV.id === id;
  const images = imgs.map(i => ({ mediaType: i.mediaType, data: i.data }));
  const local = { kind: 'user', text, images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  CV.sending = true; CV.items.push(local); paintFeed(); sfx('slide');
  try { await api('/api/lite/steer', { key, text, ...(images.length ? { images } : {}) }); if (here()) toast('Steering sent to the current work.'); return true; }
  catch (err) {
    if (here()) { CV.items = CV.items.filter(x => x !== local); paintFeed(); }
    toast(`${err.message} The message stays queued.`);
    return false;
  } finally { if (here()) { CV.sending = false; paintQueue(); } }
}
async function steerQueued(i) {
  const q = CV.queue[i];
  if (!q || q.sending || q.editText !== undefined || CV.sending || switchingChat) return;
  const queue = CV.queue, id = CV.id;
  q.sending = true; delete q.error; paintQueue();
  const sent = queueTarget(q.route).busy ? await steerIn(q.text, q.images, q.route) : await sendInChat({ queued: q });
  delete q.sending;
  if (sent) queue.splice(queue.indexOf(q), 1);
  else q.error = q.error || 'Could not send the message.';
  saveQueues();
  if (CV.id === id) paintQueue();
}
async function sendInChat({ queued = null, delivery = 'queue' } = {}) {
  const external = externalChatNotice();
  if (external) { paintBar(); toast(external); return false; }
  if (switchingChat) return toast('One moment: the assistant or account is changing.');
  const box = $('msgBox'); const text = queued ? queued.text : box.value.trim();
  if ((!text && !(queued ? queued.images.length : COMP.images.length + COMP.files.length)) || CV.sending) return;
  if (!queued && DRAW_RE.test(text)) return wrap(drawIntoMessage)(text);
  if (!queued && COMP.converting) return toast('One moment: a picture is still being prepared.');
  if (!queued && replyBusy() && CV.key) {
    if (COMP.files.some(f => !f.rel)) return toast('Wait for the attached files to finish uploading, or remove failed uploads.');
    const q = { text: withFiles(text), images: COMP.images.slice(), route: toBody(CV.to) };
    const queue = CV.queue, id = CV.id;
    box.value = ''; autosize(box); resetComposer(); paintAttachments(); DRAFTS.delete(String(id)); saveDrafts();
    if (delivery !== 'steer') { queue.push(q); paintQueue(); sfx('chip'); return; }
    if (!await steerIn(q.text, q.images, q.route)) { q.error = 'Live steering did not go through.'; queue.unshift(q); QUEUES[id] = queue; saveQueues(); if (CV.id === id) paintQueue(); }
    return;
  }
  // The message belongs to the chat it was written in. Starting a chat that wasn't running takes a
  // few seconds; if you open another chat meanwhile, it still goes here (Oct 13: it went to the chat
  // you'd moved to), and only this chat's view is touched.
  const id = CV.id, provider = CV.provider, inRepo = CV.inRepo, perm = COMP.perm || permDefault(CV.provider), model = selectedReplyModel(provNow()), effort = COMP.effort, fast = COMP.fast;
  const to = queued ? null : CV.to && CV.to !== 'chat' ? CV.to : null;
  const route = queued ? queued.route || {} : toBody(to), wasBusy = CV.busy;
  const here = () => S.view === 'chat' && CV.id === id;
  let key = CV.key;
  CV.sending = true;
  // On screen at once: your message, and the line under it, while the chat starts up.
  const images = queued ? queued.images.map(i => ({ mediaType: i.mediaType, data: i.data })) : imagesOut();
  // The pictures and files go with the message at once: off the input bar now, back on it if it doesn't go.
  const sentImages = queued ? queued.images : COMP.images, files = queued ? [] : COMP.files;
  if (!queued) { COMP.images = []; COMP.files = []; paintAttachments(); }
  const local = { kind: 'user', text: withFiles(text, files), images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  CV.items.push(local);
  if (!queued) { box.value = ''; autosize(box); DRAFTS.delete(String(id)); saveDrafts(); }
  if (!CV.busy) { CV.busy = true; CV.status = key ? 'Sending' : 'Starting'; CV.startedAt = Date.now(); }
  // Your message is progress: the "may be stuck" line counts from now, not from the last old event.
  CV.progressAt = Date.now(); CV.lastStep = 'user';
  sfx('slide'); paintFeed(); paintStatus(); $('feed').scrollTop = $('feed').scrollHeight;
  try {
    // Show the message before account checks or reconnects. Keep the send lock while
    // switching, and use the reopened process rather than the captured old key.
    if (!queued) {
      if (!await applyReplyPlan() || !here()) throw new Error('The chat changed before the message was sent.');
      key = CV.key;
    }
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
    if (here() && !queued) { resetComposer(); paintAttachments(); }
    try { await api('/api/chat/send', { key, text: out, ...(images.length ? { images } : {}), ...route }); }
    catch (err) {
      // It stopped since Lite last looked (idle for a while, or the app restarted): started again, then sent.
      if (!(err.status === 409 || err.status === 404) || !/stopped|isn.t running|not running/i.test(err.message)) throw err;
      const c = chatBy.get(id);
      const claudeAcct = provider !== 'codex' ? accountFor('claude') || (c && c.accountId) || null : null;
      const info = await api('/api/chat/open', { sessionId: id, mode: 'resume', ...(inRepo ? { inRepo: true } : {}), ...(provider === 'codex' ? { provider: 'codex', ...(c && c.ollama && c.accountId ? { account: c.accountId } : {}) } : {}), ...(claudeAcct ? { account: claudeAcct } : {}), permissionMode: perm, ...(model ? { model } : {}), ...(fast != null ? { fast: !!fast } : {}) });
      key = info.key;
      if (here()) { CV.key = key; CV.info = info; listen(key); }
      await waitReadyFor(key);
      await api('/api/chat/send', { key, text: out, ...(images.length ? { images } : {}), ...route });
    }
    if (here()) {
      if (route.to) partnerSoon(route.kinds || (route.kind ? [route.kind] : []));
      if (route.to === 'partner') {
        CV.busy = ['busy', 'waiting', 'starting'].includes(CV.info && CV.info.state);
        const partner = [...PARTNERS.values()].find(p => p.prov === route.kind); if (partner) partner.busy = true;
      } else CV.busy = true;
      if (CV.status === 'Starting' || CV.status === 'Sending') CV.status = ''; paintBar(); paintStatus();
    }
    return true;
  } catch (err) {
    if (queued) { queued.error = err.message; if (here()) { CV.busy = wasBusy; CV.status = ''; paintStatus(); paintBar(); CV.items = CV.items.filter(x => x !== local); paintFeed(); } return false; }
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
const waitReadyFor = key => new Promise((res, reject) => {
  const t0 = Date.now();
  const tick = async () => {
    let st = null;
    if (CV.key === key && CV.info) st = CV.info.state;
    else { try { st = (await api('/api/chat/attach', { key })).state; } catch (err) { return reject(err); } }
    if (st === 'ended') return reject(new Error('The chat could not start. Your message has not been sent.'));
    if (st && st !== 'starting') return res();
    if (Date.now() - t0 > 45e3) return reject(new Error('The chat is taking too long to start. Your message has not been sent.'));
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
// switch in place; Claude and Codex answer in the same chat through its partners.
const PROVS = [['claude', 'Claude'], ['codex', 'ChatGPT'], ['ollama', 'Ollama'], ['gemini', 'Gemini']];
const provName = p => (PROVS.find(x => x[0] === p) || [p, p === 'gemini' ? 'Gemini' : p])[1];
const hasProv = p => (p === 'gemini' ? !!S.gemini : p === 'claude' ? plans().some(x => x.family === 'claude' && !x.broken) : p === 'codex' ? plans().some(x => x.family === 'chatgpt' && !x.broken) : plans().some(x => x.family === 'ollama' && !x.broken));
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
  const prov = replyProv();
  const inChat = S.view === 'chat';
  const info = inChat ? replyTarget().info : null;
  const running = info && info.key;
  const cur = selectedReplyModel(prov, !inChat);
  if (!S.models) { loadModels().then(() => modelMenu(anchor)); return toast('Reading the models…'); }
  const item = (p, m) => `<button class="mm" data-v="${esc(p)}|${esc(m.value)}" role="menuitemradio" aria-checked="${p === prov && m.value === cur}" title="${esc(m.note || '')}"><span class="mm-name">${esc(String(m.label || prettyModel(m.value)).replace(/:cloud$/, ""))}</span>${m.note && m.note !== 'In Ollama' ? `<span class="mm-note">${esc(m.note.replace(/^[^·]*· /, ''))}</span>` : ''}</button>`;
  const group = p => {
    const md0 = MD(p); if ((!md0 || !hasProv(p)) && !(p === 'gemini' && p === prov && running && info.models?.length)) return '';
    const here = p === prov;
    const runList = here && running && info.models && info.models.length ? info.models.filter(m => m.value !== 'default') : null;
    const all = offered(p, runList || [...md0.models, ...md0.more]);
    const main = all, more = [];
    const plan = p === 'ollama' || p === 'gemini' ? null : (here && info && planById(info.accountId)) || useNext(p === 'claude' ? 'claude' : 'chatgpt');
    const sub = inChat && !here ? p === 'ollama' || provNow() === 'ollama' ? 'starts a new chat there' : 'answers in this chat' : p === 'ollama' ? 'no plan limits' : plan ? `${plan.label} · ${plan.left}%` : '';
    return `<div class="ph">${provName(p)}${sub ? ` · ${esc(sub)}` : ''}${here && defaultReplyModel(p) ? ` · default ${esc(modelLabel(p, defaultReplyModel(p)))}` : ''}</div>${main.map(m => item(p, m)).join('')}${more.length ? `<details class="pop-more"><summary>More ${provName(p)} models</summary>${more.map(m => item(p, m)).join('')}</details>` : ''}`;
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
  const fastOn = running ? !!info.fast : !!COMP.fast;
  const fast = codexHere ? `<button class="mm" data-v="fast|${fastOn ? 'off' : 'on'}" role="menuitemcheckbox" aria-checked="${fastOn}"><span class="mm-name">⚡ Fast</span><span class="mm-note">about 2x speed, uses more of the plan</span></button><hr>` : '';
  pop(anchor, who + fast + order.map(group).filter(Boolean).join('<hr>'), raw => {
    const [p, v] = raw.split('|');
    if (p === 'fast') {
      const on = v === 'on';
      if (inChat) return wrap(changeReply)(prov, { fast: on });
      COMP.fast = on; paintBar(); if (S.view === 'newchat') paintNewChat(); toast(on ? 'Fast: on for this chat when it starts.' : 'Fast is off.'); return undefined;
    }
    if (p === 'to') {
      if (v !== 'both') return wrap(changeReply)(v === 'chat' ? provNow() : toKind(v));
      CV.to = v; setTo(CV.id, v); paintBar(); return undefined;
    }
    if (inChat) {
      if (p !== provNow() && (p === 'ollama' || provNow() === 'ollama')) return continueElsewhere(p, v);
      return wrap(changeReply)(p, { model: v });
    }
    if (S.view === 'newchat' && p !== prov) {
      NC.who = p; NC.account = null; COMP.effort = null; COMP.perm = null;
      const plan = planById(accountFor(NC.who));
      toast(`${modelLabel(p, v)} runs on ${p === 'ollama' ? 'Ollama' : `${provName(p)}${plan ? ` · ${plan.label} (use next)` : ''}`}.`);
    }
    COMP.model = v;
    wrap(rememberModelChoice)(p, v);
    return S.view === 'newchat' ? paintNewChat() : paintBar();
  });
}
// Ollama uses its own Codex backend, so moving to or from it starts a sub-chat.
function continueElsewhere(p, model) {
  const c = chatBy.get(CV.id);
  const lastAi = [...CV.items].reverse().find(it => it.kind === 'assistant' && (it.blocks || []).some(b => b.type === 'text'));
  const lastText = lastAi ? lastAi.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim() : '';
  const title = c ? c.title : chatTitle();
  const prefill = `Picking up from the chat “${title}” (on ${provName(provNow())}).${lastText ? ` Where it got to:\n\n${lastText.slice(0, 1800)}${lastText.length > 1800 ? '…' : ''}` : ''}\n\nNext: `;
  const parent = CV.id;
  go('newchat', { ncProject: c ? c.project : null, prefill });
  NC.who = p; NC.account = null; NC.parent = parent;
  COMP.model = model; COMP.effort = null; COMP.perm = null;
  paintNewChat();
  setTimeout(() => { const b = $('msgBox'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 50);
}
function effortMenu(anchor) {
  const prov = replyProv(), inChat = S.view === 'chat';
  const info = inChat ? replyTarget().info : null;
  const list = info && info.efforts && info.efforts.length ? info.efforts : effortsFor(prov);
  if (!list.length) return;
  const cur = info ? info.effort : prov === provNow() ? COMP.effort : null;
  const md0 = MD(prov);
  pop(anchor, `<div class="ph">Effort${md0 && md0.defaultEffort ? ` · default ${esc(cap(md0.defaultEffort))}` : ''}</div>${list.map(e => `<button data-v="${esc(e)}" role="menuitemradio" aria-checked="${e === cur}">${esc(cap(e))}</button>`).join('')}`,
    v => { if (inChat) return wrap(changeReply)(prov, { effort: v }); COMP.effort = v; return paintNewChat(); });
}
// Conversation settings: how much it may do without asking. Your default is preselected.
function settingsMenu(anchor) {
  const follow = `<hr><div class="ph">Follow-up behavior · on this browser</div>${[['queue', 'Queue', 'Wait until the current turn finishes'], ['steer', 'Steer', 'Guide the current work now']].map(([v, label, note]) => `<button data-v="follow:${v}" role="menuitemradio" aria-checked="${followUpDelivery() === v}">${label}<small>${note}</small></button>`).join('')}<div class="ph">${sendShortcut()} steers · ${sendShortcut(true)} queues</div>`;
  const setFollow = v => {
    if (!v.startsWith('follow:')) return false;
    local.set('followUpDelivery', v.slice(7));
    if (S.view === 'newchat') paintNewChat(); else paintBar();
    return true;
  };
  // Gemini's permission modes also apply before its first message.
  if (provNow() === 'gemini') {
    const running = S.view === 'chat' && CV.key && CV.info;
    const modes = (running && CV.info.modes) || [{ value: 'plan', label: 'Plan only' }, { value: 'accept-edits', label: 'Edit files' }, { value: 'full', label: 'Full access' }];
    const def = permDefault('gemini');
    const cur = (running && CV.info.permissionMode) || COMP.perm || def;
    return pop(anchor, `<div class="ph">Gemini · without asking, it may</div>${modes.map(m => `<button data-v="${esc(m.value)}" role="menuitemradio" aria-checked="${m.value === cur}">${esc(m.label)}${m.value === def ? '<small>your default</small>' : ''}</button>`).join('')}<hr><button data-v="__default">Make “${esc((modes.find(m => m.value === cur) || {}).label || cur)}” my default</button>${follow}`,
      v => {
        if (setFollow(v)) return undefined;
        if (v === '__default') return wrap(setLook)({ permissions: { gemini: cur } }).then(() => toast('Gemini permission default saved.'));
        const label = (modes.find(m => m.value === v) || {}).label || v;
        if (running) return wrap(async () => { await api('/api/chat/mode', { key: CV.key, mode: v }); CV.info.permissionMode = v; toast(`This chat: ${label}.`); })();
        COMP.perm = v; toast(`This chat will start in ${label}.`); return undefined;
      });
  }
  const prov = permFam(S.view === 'newchat' ? (NC.who === 'claude' ? 'claude' : 'codex') : CV.provider);
  const running = S.view === 'chat' && CV.key && CV.info;
  const cur = (running && CV.info.permissionMode) || COMP.perm || permDefault(prov);
  const modes = (S.permissionModes || {})[prov] || [];
  const def = permDefault(prov);
  const nextTurn = running && CV.provider === 'codex' && CV.busy;
  const permissionNote = nextTurn ? '<p class="pd-note">The current turn keeps its original permissions, including when you steer it. To apply a change now, stop this turn, then send a new message.</p>' : '';
  pop(anchor, `<div class="ph">${nextTurn ? 'Codex permissions · for the next turn' : 'Conversation settings · without asking, it may'}</div>${permissionNote}${modes.map(m => `<button data-v="${esc(m)}" role="menuitemradio" aria-checked="${m === cur}">${esc(PERM_LABELS[m] || m)}${m === def ? '<small>your default</small>' : ''}</button>`).join('')}<hr><button data-v="__default">Make “${esc(PERM_LABELS[cur] || cur)}” my default</button>${follow}`,
    v => {
      if (setFollow(v)) return undefined;
      if (v === '__default') return wrap(setLook)({ permissions: { [prov]: cur } }).then(() => toast(`New ${prov === 'claude' ? 'Claude' : 'Codex'} chats start in ${PERM_LABELS[cur]}.`));
      if (running) return wrap(async () => { await api('/api/chat/mode', { key: CV.key, mode: v }); CV.info.permissionMode = v; toast(nextTurn ? `${PERM_LABELS[v]} is saved for the next turn. The current turn keeps its original permissions.` : `This chat: ${PERM_LABELS[v]}.`); })();
      COMP.perm = v; toast(`This chat will start in ${PERM_LABELS[v]}.`); return undefined;
    });
}

/* ---------- New chat: the same input bar, centered ---------- */
// Who a new chat runs as: an assistant and an account. "Use next" (the default) follows the
// use-next order; you can also pick a particular account.
const NC = { project: null, who: 'claude', account: null };
function accountFor(who) {
  if (who === 'gemini') return 'gemini';
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
  pop(anchor, `${group('claude', 'claude', 'Claude')}<hr>${group('codex', 'chatgpt', 'ChatGPT (Codex)')}${ol ? `<hr>${row('ollama', 'auto', 'Ollama', 'no plan limits', NC.who === 'ollama')}` : ''}${S.gemini ? `<hr>${row('gemini', 'auto', 'Gemini', 'Google models', NC.who === 'gemini')}` : ''}`, v => {
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
    <button type="button" class="chip big" data-ncwho="1">${provName(NC.who)}${plan && NC.who !== 'ollama' ? ` · ${esc(plan.label)}` : ''}${plan && NC.who !== 'ollama' ? ` <small>${NC.account ? '' : 'use next · '}${typeof plan.left === 'number' ? `${plan.left}%` : ''}</small>` : ''} ▾</button>`;
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
  const prov = NC.who === 'ollama' ? 'codex' : NC.who;
  const perm = COMP.perm || permDefault(prov);
  const account = accountFor(NC.who);
  const model = selectedReplyModel(NC.who, true), effort = COMP.effort, images = imagesOut(), files = COMP.files.slice();
  // Straight to the conversation: your message is on screen with Starting… under it while the chat
  // starts, and everything else happens behind it.
  const local = { kind: 'user', text: files.length ? `${text}${text ? '\n\n' : ''}${files.map(f => `Attached file: \`${f.name}\``).join('\n')}` : text, images: images.map(i => ({ src: `data:${i.mediaType};base64,${i.data}` })), onTheWay: true };
  resetComposer();
  if (CV.es) { CV.es.close(); CV.es = null; }
  const run = {};
  const continues = NC.parent || null; NC.parent = null;
  Object.assign(CV, { progressAt: Date.now(), lastStep: 'user', run, continues, id: null, key: null, info: { cwd: p.cwd, state: 'starting', title: 'New chat', model }, items: [local], cursor: null, live: '', status: 'Starting', pending: new Map(), busy: true, startedAt: Date.now(), loading: false, error: null, readOnly: null, sending: true, provider: prov });
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
    // Started from a project that shares its folder with others (Labs and Platform in one repo, say):
    // it belongs to the one you started it from, not to whichever its title suggests.
    if (id && p.key !== p.cwd) api('/api/lite/chats', { ids: [id], patch: { project: p.key } }).then(() => loadState()).catch(() => {});
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
