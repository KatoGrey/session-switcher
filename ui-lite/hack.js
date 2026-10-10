'use strict';
/* Hackathon: the fuel for the weekend (plans fresh before it starts, plans that refill during it,
   manual resets on hand, the order), then a board: an Ideas column plus one column per status for
   every chat in the Hackathon bucket. Cards drag between columns, which just sets their status. */

const HACK_BUCKET = 'hackathon';
const hackDates = () => (S.lite && S.lite.hackathon ? S.lite.hackathon : null);
const hackLabel = () => {
  const h = hackDates(); if (!h) return '';
  const d = days(h.start);
  return d > 0 ? `in ${Math.ceil(d)}d` : days(h.end) > 0 ? 'live' : 'over';
};
const hackChats = () => allChats().filter(c => projOf(c).bucket === HACK_BUCKET);
const hackProjects = () => S.projects.filter(p => p.bucket === HACK_BUCKET && !p.archived);
const dateIn = t => { const d = new Date(ms(t)); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function fuelHtml(h) {
  const start = ms(h.start), end = ms(h.end);
  const m = metered();
  const fresh = m.filter(p => p.resetsAt && ms(p.resetsAt) <= start);
  const during = m.filter(p => p.resetsAt && ms(p.resetsAt) > start && ms(p.resetsAt) < end);
  const carry = m.filter(p => !fresh.includes(p) && !during.includes(p));
  const credits = plans().flatMap(p => creditsOf(p).filter(c => !c.expiresAt || ms(c.expiresAt) > start).map(c => ({ p, c })));
  const manual = plans().flatMap(p => manualOf(p).filter(r => !r.expiresAt || ms(r.expiresAt) > start));
  const expAfter = credits.filter(x => x.c.expiresAt && ms(x.c.expiresAt) > end).sort((a, b) => ms(a.c.expiresAt) - ms(b.c.expiresAt));
  const firstExp = expAfter.length ? expAfter[0].c.expiresAt : null;
  return `<div class="fuel">
    <div class="plan"><small>Fresh at the start</small><span class="big-number">${fresh.length} plan${fresh.length === 1 ? '' : 's'}</span><small>${esc(fresh.map(pLabel).join(', ') || 'None reset before it starts')}${fresh.length ? ' reset before it starts' : ''}</small></div>
    <div class="plan"><small>Refill during it</small><span class="big-number">${during.length}</span><small>${esc(during.map(p => `${pLabel(p)} on ${wd(p.resetsAt)}`).join(', ') || 'none')}</small></div>
    <div class="plan"><small>Manual resets on hand</small><span class="big-number">${credits.length + manual.length}</span><small>${credits.length ? `${credits.length} on ChatGPT${firstExp ? `; the first expire ${esc(md(firstExp))}, so spend them here, one per plan when it hits ${floor()}%` : ''}` : 'None on ChatGPT'}${manual.length ? ` · ${manual.length} on Claude` : ''}</small></div>
    <div class="plan"><small>Order while it runs</small><span class="big-number" style="font-size:18px">Soonest reset first</span><small>${carry.length ? `${esc(carry.map(p => `${pLabel(p)} (${p.left}%)`).join(', '))} carry in what’s left. ` : ''}New chats and routines follow it; Ollama for bulk or overnight work.</small></div>
  </div>`;
}

function hackView() {
  const h = hackDates();
  const chats = hackChats(), projs = hackProjects();
  const cols = STATUSES.filter(s => s.id !== 'done');
  const ideas = (S.lite && S.lite.ideas) || [];
  const hasBucket = buckets().some(b => b.id === HACK_BUCKET);
  const until = h ? days(h.start) : null;
  const fmt = t => new Date(ms(t)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `<div class="wrap" style="max-width:1180px">
    <div class="page-h"><div class="proj-h" style="align-items:flex-start"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><div><div class="crumb">${h ? `<span class="countdown">${until > 0 ? `Starts in ${Math.ceil(until)} day${Math.ceil(until) === 1 ? '' : 's'}` : days(h.end) > 0 ? 'Live now' : 'Finished'}</span><span>· ${esc(fmt(h.start))} – ${esc(fmt(h.end))}</span><button class="linkish" data-hackdates="1">Change</button>` : '<button class="linkish" data-hackdates="1">Set the dates</button>'}</div><h1>Hackathon</h1></div></div>
      <div style="display:flex;gap:6px"><button class="btn" data-go="home">Add projects…</button><button class="btn prime" data-newchat="${esc((hackProjects()[0] || {}).key || '')}">${L('New chat')}</button></div></div>
    ${!hasBucket ? '<p class="lead">There’s no Hackathon bucket yet. Add one called “Hackathon” (id <code>hackathon</code>) and drag projects into it.</p>' : ''}
    <section class="section"><div class="sec-h"><h2>Fuel for the weekend</h2>${S.plans ? '' : '<span class="n">Reading plans…</span>'}</div>
      ${h && S.plans ? fuelHtml(h) : h ? '' : '<p class="empty-note">Set the dates to see which plans are fresh for it.</p>'}
      ${S.plans ? orderHtml() : ''}</section>
    <section class="section"><div class="sec-h"><h2>Board</h2><span class="n">${chats.length} chat${chats.length === 1 ? '' : 's'} · ${projs.length} project${projs.length === 1 ? '' : 's'}</span><span class="hint">Drag cards between columns; they’re the same statuses as everywhere else</span></div>
      <div class="board">
        <div class="col" data-idea-drop="1"><div class="col-h"><span class="label-dot" style="background:var(--muted)"></span>Ideas<span class="n">${ideas.length || ''}</span></div>${ideas.map(i => `<div class="tile idea" draggable="true" data-idea="${esc(i.id)}" data-cur="i:${esc(i.id)}" title="Drag onto a column to start it as a chat">${esc(i.text)}<button class="tile-x" data-delidea="${esc(i.id)}" aria-label="Remove this idea" title="Remove">×</button></div>`).join('')}<form class="add" data-addidea="1"><input name="idea" placeholder="+ Add an idea" aria-label="Add an idea"></form></div>
        ${cols.map(st => { const list = chats.filter(c => statusOf(c) === st.id).sort((a, b) => Number(!!b.focus) - Number(!!a.focus) || b.updated - a.updated); return `<div class="col" data-drop-stage="${st.id}"><div class="col-h"><span class="label-dot" style="background:${st.c}"></span>${st.name}<span class="n">${list.length || ''}</span></div>${list.map(c => `<div class="tile" draggable="true" data-chat="${esc(c.id)}" data-cur="${esc(c.id)}" role="button" tabindex="-1">${needs(c) ? '<span class="dot needs-dot" style="display:inline-block;margin-right:6px"></span>' : ''}${focusStar(c)}${esc(c.title)}<small>${kindTag(c)}${waitTag(c)}${esc(projOf(c).name)} · ${ago(c.updated)}</small></div>`).join('')}</div>`; }).join('')}
      </div></section>
    <p class="hint-line">Move a project into the Hackathon bucket (Projects page) and its chats land on this board.</p>
  </div>`;
}

async function editHackDates() {
  const h = hackDates() || {};
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><form class="modal" id="hdForm"><h3>Hackathon dates</h3><p>The countdown, the fuel panel and the phone pulse use these.</p>
    <div class="manual-add"><input type="datetime-local" name="start" value="${h.start ? dateIn(h.start) : ''}" aria-label="Starts" required><input type="datetime-local" name="end" value="${h.end ? dateIn(h.end) : ''}" aria-label="Ends" required><span></span></div>
    <div class="acts"><button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Save</button></div></form></div>`;
  const form = root.querySelector('#hdForm');
  root.querySelector('[data-m="no"]').onclick = () => { root.innerHTML = ''; };
  form.onsubmit = wrap(async e => {
    e.preventDefault();
    const j = await api('/api/lite/hackathon', { start: new Date(form.start.value).toISOString(), end: new Date(form.end.value).toISOString() });
    S.lite.hackathon = j.hackathon; root.innerHTML = ''; render();
  });
  form.start.focus();
}
async function saveIdeas(ideas) {
  const j = await api('/api/lite/hackathon', { ideas });
  S.lite.ideas = j.ideas; render();
}
// An idea dragged onto a status column starts as a chat: New chat, with the idea typed in, in a Hackathon project.
async function startIdea(id) {
  const before = (S.lite.ideas || []).slice();
  const idea = before.find(i => i.id === id); if (!idea) return;
  await saveIdeas(before.filter(i => i.id !== id));
  sfx('slide');
  go('newchat', { ncProject: (hackProjects().find(p => p.cwd && p.exists) || {}).key || null, prefill: idea.text });
  toast('Started from the idea; it left the Ideas column.', async () => { await saveIdeas(before); });
}
async function moveIdea(id, beforeId) {
  const list = (S.lite.ideas || []).slice();
  const i = list.findIndex(x => x.id === id); if (i < 0) return;
  const [it] = list.splice(i, 1);
  const j = beforeId ? list.findIndex(x => x.id === beforeId) : -1;
  list.splice(j < 0 ? list.length : j, 0, it);
  await saveIdeas(list); sfx('slide');
}
