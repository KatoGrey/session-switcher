'use strict';
/* Tokens: how many you've gone through, from every chat's own records (lib/lite-tokens.js).
   A card on the Bridge (this month, the last 30 days, the projects using most) and a page of its
   own: the month as one number, every day for 90 days, each project and the biggest chats.
   "Tokens" counts everything the models read and wrote; most of it is reading back their own
   cache (cheap and fast), so the fresh part (new input and output) is shown beside it. */

S.tokens = null;
let tokLoading = null;
function loadTokens(refresh = false) {
  if (tokLoading) return tokLoading;
  tokLoading = api(`/api/lite/tokens${refresh ? '?refresh=1' : ''}`).then(t => { S.tokens = t; S.tokens.got = Date.now(); }).catch(() => {}).finally(() => { tokLoading = null; });
  return tokLoading;
}
// Fetched when shown, at most every five minutes; again in a minute while the count is running.
function tokensWanted() {
  const t = S.tokens;
  if (!t || Date.now() - t.got > 5 * 60e3 || (t.counting && Date.now() - t.got > 60e3)) loadTokens().then(() => { if (S.view === 'now' || S.view === 'tokens') paintTokens(); });
}
function paintTokens() {
  const box = $('tokBox'); if (box) box.innerHTML = tokensBoxHtml();
  if (S.view === 'tokens') { const m = $('main'); if (m) { const top = m.scrollTop; m.innerHTML = tokensView(); m.scrollTop = top; } }
}

// 1,234 / 12.3K / 4.5M / 1.23B
function fmtTok(n) {
  const a = Math.abs(n);
  const f = (x, u) => `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}${u}`;
  return a >= 1e12 ? f(n / 1e12, 'T') : a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
}
const longTok = n => Math.round(n).toLocaleString();
const dayLabel = (d, opts = { month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);
const monthName = m => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long' });

// The month so far against the same days of last month.
function tokDelta(t) {
  if (!t.prevMonthTo) return '';
  const d = t.monthTotal / t.prevMonthTo - 1;
  const pct = Math.round(Math.abs(d) * 100);
  const prev = new Date(`${t.month}-15T12:00:00`); prev.setMonth(prev.getMonth() - 1);
  const name = prev.toLocaleDateString(undefined, { month: 'short' });
  return `<span class="tk-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct}%</span> <span class="tk-vs">vs ${name} 1–${new Date().getDate()}</span>`;
}

/* ---------- the columns (one per day) ---------- */
// days: [{ day, total, claude, codex, fresh }]. This month's days in the accent; earlier ones quieter.
function tokColumns(days, { height = 160, axis = true, tips = true, id = 'tkc' } = {}) {
  const month = S.tokens ? S.tokens.month : '';
  const max = Math.max(1, ...days.map(d => d.total));
  // A clean top for the scale (1, 2 or 5 times a power of ten).
  const p = 10 ** Math.floor(Math.log10(max)), top = [1, 2, 5, 10].map(m => m * p).find(v => v >= max);
  const W = 720, H = height, pad = axis ? 34 : 0, gap = 2;
  const bw = Math.min(24, (W - pad) / days.length - gap), step = (W - pad) / days.length;
  const y = v => H - (v / top) * (H - 6);
  const r = Math.min(4, bw / 2);
  const bar = (d, i) => {
    const x = pad + i * step + (step - bw) / 2, yy = y(d.total), h = H - yy;
    const cls = d.day.startsWith(month) ? 'tk-bar' : 'tk-bar old';
    if (h < 0.5) return '';
    const rr = Math.min(r, h);
    return `<path class="${cls}" d="M${x},${H}V${yy + rr}Q${x},${yy} ${x + rr},${yy}H${x + bw - rr}Q${x + bw},${yy} ${x + bw},${yy + rr}V${H}Z"/>`;
  };
  const grid = axis ? [top / 2, top].map(v => `<line class="tk-grid" x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="tk-tick" x="${pad - 6}" y="${y(v) + 4}" text-anchor="end">${fmtTok(v)}</text>`).join('') + `<line class="tk-base" x1="${pad}" x2="${W}" y1="${H}" y2="${H}"/>` : '';
  // Month starts, under the axis.
  const marks = axis ? days.map((d, i) => (d.day.endsWith('-01') ? `<text class="tk-tick" x="${pad + i * step}" y="${H + 16}">${dayLabel(d.day, { month: 'short' })}</text>` : '')).join('') : '';
  const hits = tips ? days.map((d, i) => `<rect class="tk-hit" x="${pad + i * step}" y="0" width="${step}" height="${H}" data-tkday="${i}" tabindex="-1"/>`).join('') : '';
  return `<div class="tk-chart" id="${id}"><svg viewBox="0 0 ${W} ${H + (axis ? 22 : 0)}" preserveAspectRatio="none" role="img" aria-label="Tokens per day">${grid}${days.map(bar).join('')}${marks}${hits}</svg>${tips ? '<div class="tk-tip" hidden></div>' : ''}</div>`;
}
// The tooltip: the day's total first, then its date and the split.
document.addEventListener('pointermove', e => {
  const hit = e.target.closest && e.target.closest('[data-tkday]');
  const chart = (hit || e.target).closest && (hit || e.target).closest('.tk-chart');
  for (const tip of document.querySelectorAll('.tk-tip')) if (!chart || !chart.contains(tip)) tip.hidden = true;
  if (!hit || !chart || !S.tokens) return;
  const days = chart.id === 'tkc30' ? S.tokens.days.slice(-30) : S.tokens.days;
  const d = days[Number(hit.dataset.tkday)]; if (!d) return;
  const tip = chart.querySelector('.tk-tip');
  tip.innerHTML = '';
  const v = document.createElement('b'); v.textContent = `${fmtTok(d.total)} tokens`;
  const when = document.createElement('span'); when.textContent = dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' });
  tip.append(v, when);
  for (const [k, n] of [['Claude', d.claude], ['Codex', d.codex], ['Fresh (new input and output)', d.fresh]]) {
    if (!n) continue;
    const row = document.createElement('span'); row.className = 'tk-tip-row'; row.textContent = `${k}: ${fmtTok(n)}`; tip.append(row);
  }
  tip.hidden = false;
  const box = chart.getBoundingClientRect(), hb = hit.getBoundingClientRect();
  const left = Math.min(Math.max(0, hb.left - box.left + hb.width / 2 - 80), box.width - 170);
  tip.style.left = `${left}px`;
});

/* ---------- the card on the Bridge ---------- */
function tokensBoxHtml() {
  tokensWanted();
  const t = S.tokens;
  const head = `<div class="sec-h"><h2>Tokens</h2>${t && t.counting ? '<span class="hint">Counting…</span>' : ''}<button class="linkish" data-go="tokens" style="${t && t.counting ? '' : 'margin-left:auto'}">All of it ›</button></div>`;
  if (!t) return `${head}<p class="empty-note">Reading your chats’ records…</p>`;
  if (!t.ready) return `${head}<p class="empty-note">Counting every chat’s tokens for the first time. This takes a few minutes and runs in the background.</p>`;
  const top = t.projects.slice(0, 4), most = top.length ? top[0].total : 1;
  return `${head}<div class="tk-card">
    <div class="tk-stat"><span class="tk-label">This ${esc(monthName(t.month))}</span><span class="tk-big">${fmtTok(t.monthTotal)}</span><span class="tk-sub">${tokDelta(t)}</span></div>
    <div class="tk-spark">${tokColumns(t.days.slice(-30), { height: 64, axis: false, id: 'tkc30' })}<span class="tk-cap">Last 30 days</span></div>
    <div class="tk-proj">${top.map(p => `<button class="tk-prow" data-go-project="${esc(p.key)}" title="${esc(longTok(p.total))} tokens"><span class="tk-pname">${esc(p.name)}</span><span class="tk-ptrack"><i style="width:${Math.max(2, (p.total / most) * 100)}%"></i></span><span class="tk-pval">${fmtTok(p.total)}</span></button>`).join('')}</div>
  </div>`;
}

/* ---------- the page ---------- */
function tokensView() {
  tokensWanted();
  const t = S.tokens;
  const head = `<div class="page-h"><div class="proj-h">${typeof BACK !== 'undefined' ? BACK : ''}<h1>Tokens</h1></div>${t && t.ready ? `<button class="iconbtn refresh ${t.counting ? 'spinning' : ''}" data-tokrefresh="1" aria-label="${t.counting ? 'Counting' : 'Count again'}" title="${t.counting ? 'Counting…' : 'Count again'}">↻</button>` : ''}</div>`;
  if (!t || !t.ready) return `<div class="wrap">${head}<p class="empty-note">Counting every chat’s tokens for the first time (it reads gigabytes of records, in the background). This page fills in when it’s done.</p></div>`;
  const cache = t.monthTotal - t.monthFresh;
  const prov = Object.entries(t.monthByProv || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k === 'claude' ? 'Claude' : 'Codex'} ${fmtTok(n)}`).join(' · ');
  const best = t.best ? `<div class="tk-fact"><span>Biggest day</span><b>${fmtTok(t.best.total)}</b><small>${esc(dayLabel(t.best.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</small></div>` : '';
  const avg = (() => { const d = t.days.slice(-30).filter(x => x.total); return d.length ? d.reduce((n, x) => n + x.total, 0) / d.length : 0; })();
  const projects = t.projects.slice(0, 14), rest = t.projects.slice(14), most = projects.length ? projects[0].total : 1;
  if (rest.length) projects.push({ key: null, name: `${rest.length} more`, total: rest.reduce((n, p) => n + p.total, 0), share: rest.reduce((n, p) => n + p.share, 0), chats: rest.reduce((n, p) => n + p.chats, 0) });
  return `<div class="wrap tk-page">${head}
    <section class="tk-hero">
      <span class="tk-label">Tokens this ${esc(monthName(t.month))}</span>
      <span class="tk-hero-n" title="${esc(longTok(t.monthTotal))}">${fmtTok(t.monthTotal)}</span>
      <span class="tk-sub">${tokDelta(t)}</span>
      <p class="tk-split">${esc(fmtTok(t.monthFresh))} fresh (new input and output) · ${esc(fmtTok(cache))} read back from cache${prov ? ` · ${esc(prov)}` : ''}</p>
    </section>
    <div class="tk-facts">
      ${best}
      <div class="tk-fact"><span>A day, lately</span><b>${fmtTok(avg)}</b><small>average of the last 30 days</small></div>
      <div class="tk-fact"><span>Last month</span><b>${fmtTok(t.prevMonthTotal)}</b><small>all of ${esc(monthName(new Date(new Date(`${t.month}-15T12:00:00`).setMonth(new Date(`${t.month}-15T12:00:00`).getMonth() - 1)).toISOString().slice(0, 7)))}</small></div>
      <div class="tk-fact"><span>Since ${t.since ? esc(dayLabel(t.since, { month: 'short', day: 'numeric', year: 'numeric' })) : 'the start'}</span><b>${fmtTok(t.all)}</b><small>everything on record</small></div>
    </div>
    <section class="section"><div class="sec-h"><h2>Every day</h2><span class="hint">90 days · this month in colour</span></div>${tokColumns(t.days, { height: 180 })}
      <details class="tk-table"><summary>As a table</summary><table><thead><tr><th>Day</th><th>Total</th><th>Claude</th><th>Codex</th><th>Fresh</th></tr></thead><tbody>${t.days.slice().reverse().filter(d => d.total).map(d => `<tr><td>${esc(dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' }))}</td><td>${fmtTok(d.total)}</td><td>${fmtTok(d.claude)}</td><td>${fmtTok(d.codex)}</td><td>${fmtTok(d.fresh)}</td></tr>`).join('')}</tbody></table></details>
    </section>
    <section class="section"><div class="sec-h"><h2>By project, this month</h2><span class="hint">Where the tokens went</span></div>
      <div class="tk-bars">${projects.map(p => `<${p.key ? `button data-go-project="${esc(p.key)}"` : 'div'} class="tk-brow"><span class="tk-pname">${esc(p.name)}<small>${p.chats} chat${p.chats === 1 ? '' : 's'}</small></span><span class="tk-ptrack"><i style="width:${Math.max(1, (p.total / most) * 100)}%"></i></span><span class="tk-pval">${fmtTok(p.total)}<small>${Math.round(p.share * 100)}%</small></span></${p.key ? 'button' : 'div'}>`).join('')}</div>
    </section>
    <section class="section"><div class="sec-h"><h2>Biggest chats, this month</h2></div>
      <div class="rows">${t.chats.map(c => `<button class="row tk-chat" data-open="${esc(c.id)}"><span class="t"><b>${esc(c.title || 'A chat')}</b><small>${esc(c.project || '')} · ${c.provider === 'claude' ? 'Claude' : 'Codex'}</small></span><span class="tk-pval">${fmtTok(c.total)}</span></button>`).join('')}</div>
    </section>
    <p class="tk-note">Counted from every chat’s own records (here, the Claude app, terminals and Codex), updated every 15 minutes. Most of it is the model reading its own cache, which is quick and cheap; fresh tokens are the new input and the output.${t.at ? ` Last counted ${esc(new Date(t.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}.` : ''}</p>
  </div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-tokrefresh], [data-go-project]'); if (!b) return;
  e.preventDefault();
  if (b.dataset.tokrefresh !== undefined) { loadTokens(true).then(paintTokens); toast('Counting again in the background.'); return; }
  go('project', { project: b.dataset.goProject });
});
