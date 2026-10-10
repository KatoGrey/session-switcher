'use strict';
/* The day at a glance (the last 24 hours, so a late night still reads as one day): a lane for each project with a bar wherever its chats were busy through the day
   (Claude's messages and replies, Codex's turns), a mark for now (lit where a chat is working), and a
   line that sums the day up. Hover a bar for what happened then; click it to open that chat, or a
   project's name to open the project. Drawn from the chat index (GET /api/today), at most once a minute. */

const Today = { data: null, at: 0, loading: false };
const SLOT = 15 * 60 * 1000;
function loadToday(force = false) {
  if (Today.loading || (!force && Date.now() - Today.at < 60000)) return;
  Today.loading = true;
  api(`/api/today?since=${Date.now() - 864e5}`)
    .then(d => { Today.data = d; Today.at = Date.now(); renderToday(); })
    .catch(() => {})
    .finally(() => { Today.loading = false; });
}
const hourLabel = t => new Date(t).toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, ' ');
const timeLabel = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function todayHtml() {
  const d = Today.data; if (!d || !Array.isArray(d.chats)) return '';
  const now = Date.now();
  const lanes = new Map();
  let first = Infinity, total = 0;
  const ids = new Set();
  for (const c of d.chats) {
    const [s, p] = sessionById(c.id);
    if (!s || !p) continue;
    for (const t of c.times) if (t < first) first = t;
    total += c.times.length; ids.add(c.id);
    if (!lanes.has(p.cwd)) lanes.set(p.cwd, { p, chats: [] });
    lanes.get(p.cwd).chats.push({ s, prov: c.provider || provOf(s), times: c.times });
  }
  // From the hour of the first thing in the last day (at least the last three hours) to now.
  const hour = 3600e3;
  const start = Math.max(now - 864e5, Math.min(Math.floor((first === Infinity ? now : first) / hour) * hour, Math.floor((now - 3 * hour) / hour) * hour));
  const slots = Math.max(1, Math.ceil((now - start) / SLOT));
  const pct = t => Math.min(100, Math.max(0, ((t - start) / (now - start)) * 100));
  if (!lanes.size) return `<section class="sec today" id="secToday">${secHead('The last day', 'Your day at a glance')}${emptyArt('today', 'Nothing in the last day. Your chats show up here as they work, hour by hour.')}</section>`;
  // Each lane's busiest stretch in each quarter hour: how many messages, and which chat had most of them.
  const working = new Set(atWork().map(x => String(x.cwd || '').toLowerCase()));
  const byHour = new Map();
  let max = 1;
  const built = [...lanes.values()].map(l => {
    const slot = Array.from({ length: slots }, () => ({ n: 0, claude: 0, codex: 0, by: new Map() }));
    let n = 0;
    for (const c of l.chats) for (const t of c.times) {
      if (t < start) continue;
      const i = Math.min(slots - 1, Math.floor((t - start) / SLOT)), b = slot[i];
      b.n++; b[c.prov === 'codex' ? 'codex' : 'claude']++; b.by.set(c.s, (b.by.get(c.s) || 0) + 1); n++;
      const h = Math.floor(t / hour) * hour; byHour.set(h, (byHour.get(h) || 0) + 1);
    }
    for (const b of slot) if (b.n > max) max = b.n;
    return { ...l, slot, n };
  }).sort((a, b) => b.n - a.n);
  const shown = built.slice(0, 7);
  const lane = l => {
    const bars = l.slot.map((b, i) => {
      if (!b.n) return '';
      const top = [...b.by.entries()].sort((x, y) => y[1] - x[1])[0][0];
      const from = start + i * SLOT;
      const tip = `${timeLabel(from)}: ${b.n} message${b.n === 1 ? '' : 's'}${b.by.size > 1 ? ` in ${b.by.size} chats` : ''}, most in “${top.title}”`;
      return `<button type="button" class="td-b ${b.codex > b.claude ? 'codex' : 'claude'}" style="left:${pct(from).toFixed(2)}%;width:${(pct(Math.min(now, from + SLOT)) - pct(from)).toFixed(3)}%;--v:${(0.3 + 0.7 * (b.n / max)).toFixed(2)}" data-today="${esc(top.id)}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
    }).join('');
    const live = working.has(l.p.cwd.toLowerCase());
    return `<div class="td-lane"><button type="button" class="td-name" data-view="folder" data-cwd="${esc(l.p.cwd)}" title="Open ${esc(l.p.name)}">${crestHtml(l.p, 20)}<span>${esc(l.p.name)}</span></button><div class="td-track">${bars}<span class="td-now${live ? ' on' : ''}" aria-hidden="true"></span></div></div>`;
  };
  const span = (now - start) / hour, step = span <= 6 ? 1 : span <= 12 ? 2 : 3;
  const ticks = [];
  // (an hour too close to "now" is left out, so the two don't overlap)
  for (let t = Math.ceil(start / hour) * hour; t <= now; t += step * hour) if (pct(t) < 90) ticks.push(`<span style="left:${pct(t).toFixed(2)}%">${esc(hourLabel(t))}</span>`);
  const busiest = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const sum = [`${ids.size} chat${ids.size === 1 ? '' : 's'} in ${lanes.size} project${lanes.size === 1 ? '' : 's'}`, `${total} message${total === 1 ? '' : 's'}`, busiest && busiest[1] > 2 ? `busiest around ${hourLabel(busiest[0])}` : ''].filter(Boolean).join(' · ');
  return `<section class="sec today" id="secToday">${secHead('The last day', 'Your day at a glance')}
    <p class="td-sum">${esc(sum)}${built.length > shown.length ? ` · and ${built.length - shown.length} more project${built.length - shown.length === 1 ? '' : 's'}` : ''}</p>
    <div class="td-grid"><div class="td-axis" aria-hidden="true"><span class="td-gap"></span><div class="td-ticks">${ticks.join('')}<span class="td-nowl" style="left:100%">now</span></div></div>${shown.map(lane).join('')}</div></section>`;
}
function renderToday() {
  const slot = $('todaySlot'); if (!slot) return;
  const h = todayHtml();
  if (slot._h !== h) { slot.innerHTML = h; slot._h = h; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-today]'); if (!b) return;
  ChatUI.open({ sessionId: b.dataset.today });
});

// An empty spot with a small picture: the theme's own painting if it brings one (Look.theme().empty,
// art/<name>.webp per kind), else a quiet drawing in the theme's colors.
const EMPTY_SVG = {
  await: '<path class="s" d="M6 40h52"/><path class="f" d="M40 8a12 12 0 1 0 9 20.5A10 10 0 1 1 40 8z"/><path class="g" d="M16 12l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/><circle class="f" cx="26" cy="9" r="1.2"/><circle class="f" cx="54" cy="16" r="1"/><path class="s" d="M14 40c4-5 8-5 12 0M30 40c5-7 11-7 16 0"/>',
  work: '<path class="s" d="M22 8h20M22 40h20"/><path class="s" d="M25 8c0 9 14 10 14 16S25 31 25 40M39 8c0 9-14 10-14 16s14 7 14 16"/><path class="g" d="M28 36h8l-4-5z"/><path class="s" d="M8 40h8M48 40h8"/>',
  today: '<path class="s" d="M6 38h52"/><path class="s" d="M19 38a13 13 0 0 1 26 0"/><path class="g" d="M32 12v7M17 18l4.5 4.5M47 18l-4.5 4.5M10 30h5M49 30h5"/><path class="s" d="M14 44h36"/>',
  search: '<circle class="s" cx="27" cy="21" r="12"/><path class="s" d="M36 30l11 11"/><path class="g" d="M48 8l1.2 2.8 2.8 1.2-2.8 1.2L48 16l-1.2-2.8L44 12l2.8-1.2z"/><path class="s" d="M21 18a7 7 0 0 1 6-4"/>',
  chats: '<path class="s" d="M10 10h26a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5H21l-7 6v-6h-4a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5z"/><path class="s" d="M45 18h4a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5h-2v5l-6-5h-8"/><path class="g" d="M14 18h16M14 23h10"/>',
};
function emptyArt(kind, html) {
  const t = Look.theme(), pic = t.empty && t.empty[kind];
  const art = pic ? `<img src="/art/${esc(pic)}.webp" alt="" loading="lazy" decoding="async">` : `<svg viewBox="0 0 64 48" aria-hidden="true">${EMPTY_SVG[kind] || EMPTY_SVG.await}</svg>`;
  return `<div class="empty-art${pic ? ' painted' : ''}" data-kind="${kind}"><span class="ea-pic" aria-hidden="true">${art}</span><p class="empty-line">${html}</p></div>`;
}
