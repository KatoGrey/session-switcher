'use strict';
/* Find in this chat, live events, permission requests and questions, and the crew (the chat's assistant, its partner, and each one’s model). */

/* ---------- find in this chat (Ctrl+F) ---------- */
const Find = { hits: [], i: -1 };
const canMark = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
function openFind(q) {
  const bar = $c('cFind'); bar.hidden = false;
  const inp = $c('cFindQ');
  if (q) inp.value = q;
  inp.focus(); inp.select();
  runFind();
}
function closeFind() {
  $c('cFind').hidden = true; Find.hits = []; Find.i = -1;
  if (canMark) { CSS.highlights.delete('find'); CSS.highlights.delete('find-cur'); }
}
function runFind() {
  const q = $c('cFindQ').value.trim().toLowerCase();
  Find.hits = []; Find.i = -1;
  if (q.length >= 2) {
    const walk = document.createTreeWalker($c('cFeed'), NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest('.turn-act, .turn-foot, .code-h, button.c-earlier, .c-welcome') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n;
    while ((n = walk.nextNode()) && Find.hits.length < 2000) {
      const t = n.nodeValue.toLowerCase();
      for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + q.length); Find.hits.push(r); }
    }
  }
  if (canMark) { CSS.highlights.delete('find-cur'); if (Find.hits.length) CSS.highlights.set('find', new Highlight(...Find.hits)); else CSS.highlights.delete('find'); }
  stepFind(1, true);
}
function stepFind(d, fromStart) {
  const n = Find.hits.length;
  $c('cFindN').textContent = !$c('cFindQ').value.trim() ? '' : n ? `${(fromStart ? n - 1 : (Find.i + d + n) % n) + 1} of ${n}` : 'No matches';
  if (!n) return;
  Find.i = fromStart ? n - 1 : (Find.i + d + n) % n;   // starts at the newest match
  const r = Find.hits[Find.i];
  for (let el = r.startContainer.parentElement; el; el = el.parentElement) if (el.tagName === 'DETAILS' && !el.open) el.open = true;
  if (canMark) CSS.highlights.set('find-cur', new Highlight(r));
  const box = r.getBoundingClientRect(), s = scroller(), sb = s.getBoundingClientRect();
  if (box.top < sb.top + 60 || box.bottom > sb.bottom - 60) s.scrollTop += box.top - sb.top - s.clientHeight / 2;
  $c('cFindN').textContent = `${Find.i + 1} of ${n}`;
}

/* ---------- live events ---------- */
// A streaming reply: paragraphs that are finished render once; only the one being written
// re-renders as it grows, so long replies stay smooth.
function stableCut(text) {
  let fence = false, cut = 0, at = 0;
  for (const line of text.split('\n')) {
    at += line.length + 1;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && !line.trim() && at <= text.length) cut = at;
  }
  return cut;
}
function flushLive() {
  C.liveTimer = null;
  for (const [mid, text] of Object.entries(C.liveText)) {
    const p = $c('cFeed').querySelector(`.part[data-mid="${CSS.escape(mid)}"] .live`);
    if (!p) continue;
    let done = p.firstElementChild && p.firstElementChild.classList.contains('live-done') ? p.firstElementChild : null;
    if (!done) { p.innerHTML = '<div class="live-done"></div><div class="live-tail"></div>'; done = p.firstElementChild; done._len = 0; }
    const cut = stableCut(text);
    withStick(() => {
      if (cut !== done._len) { done.innerHTML = md(text.slice(0, cut)); done._len = cut; }
      p.lastElementChild.innerHTML = md(text.slice(cut));
    });
  }
}
function setState(s) {
  C.state = s;
  const pill = $c('cState');
  pill.textContent = STATE_LABELS[s] || s;
  pill.className = `c-state ${s}`;
  syncSend();
}
// Stop, the typing dots and Send/Queue follow whichever one your next message goes to.
function syncSend() {
  const ts = targetsNow();
  const busy = ts.some(x => x.state === 'busy' || x.state === 'waiting');
  const name = ts.map(x => x.name).join(' and ');
  $c('cStop').hidden = !busy;
  $c('cStop').title = `Stop ${ts.filter(x => x.state === 'busy' || x.state === 'waiting').map(x => x.name).join(' and ') || name} (Esc twice)`;
  $c('cTyping').hidden = !ts.some(x => x.state === 'busy');
  $c('cTyping').classList.toggle('codex', (C.target === 'comp' && duo()) || C.provider === 'codex');
  $c('cSend').textContent = busy ? 'Queue' : 'Send';
  $c('cSend').title = busy ? `${name} ${ts.length > 1 ? 'are' : 'is'} working; this will be sent when ready` : `Send to ${name}`;
  $c('chat').classList.toggle('to-codex', C.target === 'comp' && duo() && partnerProv() === 'codex');
  $c('chat').classList.toggle('to-claude', C.target === 'comp' && duo() && partnerProv() === 'claude');
  $c('chat').classList.toggle('to-both', C.target === 'both' && duo());
}
function setStatus(src, t) {
  if (src === 'comp') { if (C.comp) { C.comp.status = t; renderCrewSoon(); } return; }
  $c('cStatus').textContent = t;
}
function handle(ev, src = 'main') {
  const box = src === 'comp' ? C.comp : C;
  if (!box) return;
  if (ev.seq) { if (ev.seq <= box.lastSeq) return; box.lastSeq = ev.seq; }
  liveRender = true; curProv = provFor(src);
  try { handleEvent(ev, src); } finally { liveRender = false; curProv = null; }
}
function handleEvent(ev, src) {
  const feed = $c('cFeed');
  const comp = src === 'comp';
  switch (ev.kind) {
    case 'state':
      if (comp) { C.comp.state = ev.state; if (ev.state !== 'busy') C.comp.status = ''; renderCrew(); syncSend(); break; }
      setState(ev.state); if (ev.state !== 'busy') { $c('cStatus').textContent = ''; } renderCrew(); break;
    case 'model': {
      C.mi[src] = ev;
      if (!comp) { C.model = modelLabel(ev); $c('cModel').textContent = C.model; }
      renderCrew(); renderLedgerSoon();
      if (Pick.src === src && !$c('cPick').hidden) renderPick();
      break;
    }
    case 'init':
      if (comp) { C.comp.sessionId = ev.sessionId; break; }
      setTimeout(syncFav, 0);
      C.sessionId = ev.sessionId || C.sessionId;
      if (ev.permissionMode) setMode(ev.permissionMode);
      C.model = modelName(ev.model);
      $c('cModel').textContent = C.model;
      renderLedgerSoon();
      break;
    case 'status': if (ev.permissionMode && !comp) setMode(ev.permissionMode); if (ev.status === 'compacting') setStatus(src, 'Summarizing the conversation…'); if (ev.text) setStatus(src, ev.text); break;
    case 'plan': L.todos = ev.steps || []; renderLedgerSoon(); break;
    case 'context': setCtx(src, ev); break;
    case 'review': if (!comp) { reviewLoopStep(ev); renderReview(ev); } break;
    case 'limit': if (!comp) renderLimit(ev); break;
    case 'changes': renderChanges(ev, src); break;
    case 'undone': renderUndone(ev, src); break;
    case 'user': feed.querySelector('.c-welcome')?.remove(); withStick(() => renderItem(feed, ev, true)); toBottom(); break;
    // "Both": your message went to this one first; the other picks it up when it's done.
    case 'handoff': C.handoff = ev.state === 'waiting' ? ev.to : null; if (ev.state === 'waiting') markBoth(ev.to); renderCrew(); break;
    case 'stream_start': withStick(() => part(feed, ev.mid)); break;
    case 'delta':
      if (ev.thinking) { setStatus(src, 'Thinking…'); break; }
      setStatus(src, comp ? 'Writing…' : '');
      part(feed, ev.mid);
      C.liveText[ev.mid] = (C.liveText[ev.mid] || '') + ev.text;
      if (!C.liveTimer) C.liveTimer = setTimeout(flushLive, C.liveText[ev.mid].length > 8000 ? 250 : 90);
      break;
    case 'assistant': {
      delete C.liveText[ev.mid];
      withStick(() => {
        renderItem(feed, ev, true);
        const lv = feed.querySelector(`.part[data-mid="${CSS.escape(ev.mid)}"] .live`);
        if (lv) lv.innerHTML = '';
      });
      break;
    }
    case 'tool_start': setStatus(src, `Using ${ev.name}…`); break;
    case 'tool_progress': {
      const tool = lastTool(feed, ev.toolUseId);
      if (tool) tool.querySelector('.t-time').textContent = `${ev.seconds}s`;
      setStatus(src, `${ev.name || 'Tool'} running, ${ev.seconds}s`);
      break;
    }
    case 'tool_result': withStick(() => setToolResult(feed, ev.toolUseId, ev.result)); break;
    case 'notice': withStick(() => renderItem(feed, ev, true)); break;
    case 'permission': addPermission(ev, src); break;
    case 'permission_cancel': case 'permission_done': removePermission(ev.requestId, src); break;
    case 'result':
      setStatus(src, '');
      foldSteps(src);
      if (!comp) reviewAfterTurn(ev);
      if (!ev.ok && Date.now() - C.interruptedAt > 8000 && (ev.errors.length || ev.text)) {
        withStick(() => renderItem(feed, { kind: 'notice', level: 'warning', text: ev.text || ev.errors.join('\n') || `${PROV_NAME[provFor(src)]} stopped with an error.` }));
      }
      break;
    case 'ended': {
      if (comp) {
        // The helper stopping doesn't end the Claude chat; your next message to Codex starts it again.
        C.comp.ended = true; C.comp.state = 'ended'; if (C.comp.es) C.comp.es.close();
        for (const card of $c('cPending').querySelectorAll('.perm')) if (card._src === 'comp') card.remove();
        if (!ev.stopped) withStick(() => renderItem(feed, { kind: 'notice', level: 'info', text: `${PROV_NAME[partnerProv()]} stopped. Your next message to ${PROV_NAME[partnerProv()]} starts it again.` }));
        renderCrew(); syncSend();
        break;
      }
      setState('ended');
      // The Codex helper may still be running and waiting on you; keep its cards.
      for (const card of $c('cPending').querySelectorAll('.perm')) if (card._src !== 'comp') card.remove();
      const tool = C.provider === 'codex' ? 'Codex' : 'Claude Code';
      const why = ev.stopped ? 'This chat was stopped.' : ev.code ? `${tool} stopped unexpectedly.` : `${tool} finished and closed this chat.`;
      withStick(() => feed.insertAdjacentHTML('beforeend', `<div class="ended"><p><b>${why}</b> Your conversation is saved; start it again to keep going.</p>${ev.detail ? `<pre class="t-out err">${esc(ev.detail)}</pre>` : ''}<button type="button" class="btn prime" data-c="restart">Start again</button></div>`));
      toBottom();
      break;
    }
    default: break;
  }
}

/* ---------- permissions & questions ---------- */
function verbFor(p) {
  switch (p.toolName) {
    case 'Bash': case 'PowerShell': return 'run a command';
    case 'Edit': case 'MultiEdit': return 'edit a file';
    case 'Write': return 'create or overwrite a file';
    case 'WebFetch': return 'open a web page';
    case 'WebSearch': return 'search the web';
    default: return `use ${p.toolName}`;
  }
}
function addPermission(p, src = 'main') {
  const box = $c('cPending');
  if (box.querySelector(`[data-req="${CSS.escape(`${src}:${p.requestId}`)}"]`)) return;
  const card = document.createElement('div');
  const name = PROV_NAME[provFor(src)];
  card.className = `perm ${provFor(src) === 'codex' ? 'codex' : ''}`;
  card.dataset.req = `${src}:${p.requestId}`;
  card._src = src;
  if (p.questions && p.questions.length) {
    card.classList.add('ask');
    card.innerHTML = `<p class="perm-h">${name} has <b>${p.questions.length === 1 ? 'a question' : `${p.questions.length} questions`}</b></p>
        ${p.questions.map((q, qi) => `<fieldset class="q" data-qi="${qi}"><legend>${q.header ? `<span class="q-h">${esc(q.header)}</span>` : ''}${esc(q.question)}</legend>
          ${q.options.map((o, oi) => `<label class="opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="${oi}"><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}
          <label class="opt other"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="other"><span><b>Other</b><input type="text" class="other-t" placeholder="Type your own answer" aria-label="Your own answer"></span></label></fieldset>`).join('')}
        <div class="perm-b"><button type="button" class="btn gilt" data-p="answer">Send answers</button><button type="button" class="btn" data-p="deny">Skip</button></div>`;
  } else {
    const v = p.view || {};
    card.innerHTML = `<p class="perm-h">${name} wants to <b>${esc(verbFor(p))}</b>${v.summary && p.toolName !== 'Bash' ? `: <span class="perm-sum">${esc(v.summary)}</span>` : ''}</p>
        ${p.title && p.title !== p.toolName ? `<p class="perm-r">${esc(p.title)}</p>` : ''}
        ${p.description ? `<p class="perm-r">${esc(p.description)}</p>` : ''}
        ${p.reason ? `<p class="perm-r">Why it’s asking: ${esc(p.reason)}</p>` : ''}
        ${p.blockedPath ? `<p class="perm-r">Outside your project: ${esc(p.blockedPath)}</p>` : ''}
        <div class="perm-d">${toolDetail(v)}</div>
        <div class="perm-why" hidden><input type="text" class="why-t" placeholder="Optional: tell ${name} what to do instead" aria-label="What to do instead"></div>
        <div class="perm-b">
          <button type="button" class="btn ${p.defaultToNo ? '' : 'gilt'}" data-p="allow">Allow</button>
          ${p.canAlways ? '<button type="button" class="btn" data-p="always" title="Don’t ask again for this kind of action in this project">Always allow</button>' : ''}
          <button type="button" class="btn ${p.defaultToNo ? 'gilt' : ''}" data-p="deny">Deny</button>
        </div>`;
  }
  card._p = p;
  box.appendChild(card);
  const tool = lastTool($c('cFeed'), p.toolUseId);
  if (tool) tool.querySelector('.t-time').textContent = 'waiting for you';
  if (nearBottom()) toBottom(); else noteUnseen();
  // Only take focus if you're not typing: a keystroke meant for the message box must never approve a step.
  const a = document.activeElement;
  if (!(a && a.closest && a.closest('input, textarea, select, [contenteditable="true"]'))) (card.querySelector('.btn.gilt') || card.querySelector('button')).focus({ preventScroll: true });
}
function removePermission(id, src = 'main') {
  const c = $c('cPending').querySelector(`[data-req="${CSS.escape(`${src}:${id}`)}"]`);
  if (c) c.remove();
}
function clearPermissions() { $c('cPending').innerHTML = ''; }

async function answer(card, decision) {
  const p = card._p;
  const body = { key: keyFor(card._src), requestId: p.requestId, decision };
  if (decision === 'deny' && !p.questions) {
    // First click asks what Claude should do instead; the second click (or Enter) sends the denial.
    if (!card._denyArmed) {
      card._denyArmed = true;
      card.querySelector('.perm-why').hidden = false;
      card.querySelector('[data-p="deny"]').textContent = 'Confirm deny';
      card.querySelector('.why-t').focus();
      return;
    }
    body.message = card.querySelector('.why-t').value.trim();
  }
  if (decision === 'answer') {
    const answers = {};
    for (const fs of card.querySelectorAll('fieldset.q')) {
      const q = p.questions[+fs.dataset.qi];
      const picked = [...fs.querySelectorAll('input:checked')].map(inp => (inp.value === 'other' ? (fs.querySelector('.other-t').value.trim() || 'Other') : q.options[+inp.value].label));
      if (!picked.length) { toast(`Pick an answer for “${q.question}”.`); return; }
      answers[q.question] = picked.join(', ');
    }
    body.decision = 'allow'; body.answers = answers;
  }
  if (decision === 'deny' && p.questions) body.message = 'The user skipped the question.';
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await api('/api/chat/permission', body); }
  catch (err) { card.querySelectorAll('button').forEach(b => { b.disabled = false; }); throw err; }
}

/* ---------- context: how full each one's context window is ---------- */
// 0 to 1: how close the chat is to summarizing itself (Claude Code does it at autoAt; Codex when it's full).
const ctxFill = c => (c && c.max ? Math.min(1, c.used / (c.autoAt || c.max)) : null);
const ctxClass = f => (f >= 0.85 ? 'full' : f >= 0.6 ? 'warm' : '');
const kTok = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
function ctxLine(src) {
  const c = C.ctx[src]; if (!c) return '';
  return `${Math.round(ctxFill(c) * 100)}% full · ${kTok(c.used)} of ${kTok(c.autoAt || c.max)} tokens`;
}
function setCtx(src, c) {
  C.ctx[src] = c;
  renderCrewSoon(); renderLedgerSoon();
  if (Pick.src === src && !$c('cPick').hidden) renderPick();
  if (ctxFill(c) >= 0.85) ctxWarn(src);
  else $c('cFeed').querySelectorAll(`.ctx-warn[data-src="${src}"]`).forEach(x => x.remove());
}
// Once per chat, as it gets close: summarizing at a good moment beats it happening mid-task.
function ctxWarn(src) {
  if (C.ctxWarned[src] || C.watch) return;
  C.ctxWarned[src] = true;
  const name = PROV_NAME[provFor(src)];
  withStick(() => $c('cFeed').insertAdjacentHTML('beforeend', `<div class="ctx-warn ${provFor(src)}" data-src="${src}" role="status">
    <p><b>${src === 'comp' ? 'Codex’s side of this chat' : 'This chat'} is getting full</b> (${esc(ctxLine(src))}). ${name} will summarize the conversation by itself soon, maybe in the middle of a task. Summarizing now, between tasks, keeps what matters.</p>
    <button type="button" class="btn" data-c="compact" data-src="${src}">Summarize now</button></div>`));
  if (nearBottom()) toBottom(); else noteUnseen();
}
async function compactNow(src) {
  const key = keyFor(src); if (!key) return;
  const st = src === 'comp' ? C.comp && C.comp.state : C.state;
  if (st !== 'ready') { toast(`${PROV_NAME[provFor(src)]} is busy. Summarize once it’s done.`); return; }
  closePick();
  await api('/api/chat/compact', { key });
  $c('cFeed').querySelectorAll(`.ctx-warn[data-src="${src}"]`).forEach(x => x.remove());
  C.ctxWarned[src] = false;
}

/* ---------- the crew: who your next message goes to, what each is doing, and each one's model ---------- */
let crewTimer = null;
function renderCrewSoon() { if (!crewTimer) crewTimer = setTimeout(() => { crewTimer = null; renderCrew(); }, 120); }
function crewPill(src) {
  const prov = provFor(src);
  const mi = C.mi[src];
  const st = src === 'comp' ? (C.comp && !C.comp.ended ? C.comp.state : 'off') : C.state;
  const busy = st === 'busy' || st === 'starting' || st === 'waiting';
  const status = src === 'comp' ? C.comp && C.comp.status : '';
  const label = mi ? `${modelLabel(mi)}${mi.effort ? ` · ${mi.effort}` : ''}` : src === 'comp' && st === 'off' ? 'ready when you are' : '…';
  const on = duo() ? C.target === src || C.target === 'both' : true;
  const sub = st === 'waiting' ? 'needs your OK' : src === 'comp' && C.handoff ? 'up next…' : busy && status ? status : label;
  const tip = (on ? `${PROV_NAME[prov]}: choose its model and effort` : `Send your next message to ${PROV_NAME[prov]}${duo() ? ' (Ctrl+.)' : ''}`)
    + (C.ctx[src] ? `\nContext: ${ctxLine(src)}` : '');
  const f = ctxFill(C.ctx[src]);
  const ring = f === null ? '' : `<span class="crew-ctx ${ctxClass(f)}" style="--p:${Math.round(f * 100)}" aria-hidden="true"></span>`;
  return `<button type="button" class="crew ${prov}${on ? ' on' : ''}${busy ? ' busy' : ''}${st === 'waiting' ? ' waiting' : ''}" data-crew="${src}" aria-pressed="${on}" title="${esc(tip)}">
      <span class="crew-dot" aria-hidden="true"></span><span class="crew-n">${PROV_NAME[prov]}</span><span class="crew-m">${esc(sub)}</span>${ring}${on ? '<span class="crew-caret" aria-hidden="true">▾</span>' : ''}</button>`;
}
function renderCrew() {
  const box = $c('cCrew'); if (!box) return;
  if (C.watch || !C.key) { box.innerHTML = ''; return; }
  const two = duo();
  const both = C.target === 'both';
  const lead = PROV_NAME[C.provider], mate = PROV_NAME[partnerProv()];
  box.innerHTML = crewPill('main') + (two ? crewPill('comp') + `<button type="button" class="crew both${both ? ' on' : ''}" data-crew="both" aria-pressed="${both}" title="${both ? `Back to writing to ${lead} only` : `Both: ${lead} answers, then ${mate} picks it up and builds on that`}"><span class="crew-n">Both</span></button>` : '');
  box.classList.toggle('duo', two);
  $c('cHint').innerHTML = `Enter sends · Shift+Enter new line · / prompts · <b>/model</b>${two ? ` · <b>@${partnerProv()}</b> or <b>@both</b> · <b>Ctrl+.</b> switches` : ''} · Esc twice stops`;
  if (!two && C.target !== 'main') setTarget('main');
}
function setTarget(t, focus = true) {
  C.target = duo() && (t === 'comp' || t === 'both') ? t : 'main';
  const lead = PROV_NAME[C.provider], mate = PROV_NAME[partnerProv()];
  const name = C.target === 'both' ? `${lead} and ${mate}` : PROV_NAME[provFor(C.target)];
  $c('cText').placeholder = C.target === 'comp' ? (mate === 'Codex' ? 'Ask Codex… an image, a quick test, a second opinion' : 'Ask Claude… a plan, a review, a second opinion')
    : C.target === 'both' ? `Write to ${lead} and ${mate}: ${lead} answers, then ${mate} builds on it…` : `Write to ${name}…`;
  $c('cText').setAttribute('aria-label', `Message ${name}`);
  renderCrew(); syncSend(); closePick();
  if (focus) $c('cText').focus();
}

// The model picker: quick picks (a model and an effort in one tap), every model the chat's tool
// offers, and its effort levels. On a phone it's a sheet from the bottom of the screen.
const Pick = { src: null };
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const PRESETS = {
  claude: [
    { id: 'quick', name: 'Quick', glyph: '➤', note: 'Fast answers, small jobs', want: ['haiku'], effort: 'low' },
    { id: 'balanced', name: 'Balanced', glyph: '◐', note: 'Everyday work', want: ['sonnet'], effort: 'medium' },
    { id: 'deep', name: 'Deep', glyph: '◆', note: 'Hard problems, big changes', want: ['opus', 'default'], effort: 'high' },
    { id: 'max', name: 'Max', glyph: '✦', note: 'The toughest tasks', want: ['fable', 'opus'], effort: 'max' },
  ],
  codex: [
    { id: 'quick', name: 'Quick', glyph: '➤', note: 'Fast answers, quick tests', want: [/luna/], effort: 'low' },
    { id: 'balanced', name: 'Balanced', glyph: '◐', note: 'Everyday work', want: [/sol/], effort: 'medium' },
    { id: 'deep', name: 'Deep', glyph: '◆', note: 'Images, hard problems', want: ['@default'], effort: 'high' },
    { id: 'max', name: 'Max', glyph: '✦', note: 'Everything it has', want: ['@default'], effort: 'max' },
  ],
};
// The presets this chat's tool can actually do, each resolved to a model it offers and the
// nearest effort that model supports.
function presetsFor(src) {
  const mi = C.mi[src]; if (!mi || !mi.models) return [];
  const out = [];
  for (const p of PRESETS[provFor(src)] || []) {
    let m = null;
    for (const w of p.want) {
      m = w === '@default' ? mi.models.find(x => x.isDefault) || mi.models[0]
        : w instanceof RegExp ? mi.models.find(x => w.test(x.value)) : mi.models.find(x => x.value === w);
      if (m) break;
    }
    if (!m) continue;
    const efforts = m.efforts && m.efforts.length ? m.efforts : mi.efforts || [];
    let effort = efforts.includes(p.effort) ? p.effort : null;
    if (!effort && efforts.length) {
      const want = EFFORT_ORDER.indexOf(p.effort);
      effort = efforts.slice().sort((a, b) => Math.abs(EFFORT_ORDER.indexOf(a) - want) - Math.abs(EFFORT_ORDER.indexOf(b) - want))[0];
    }
    out.push({ ...p, model: m.value, label: m.label, effort });
  }
  return out;
}
const isPhone = () => matchMedia('(max-width: 760px)').matches;
function closePick() {
  const b = $c('cPick');
  if (b && !b.hidden) {
    const back = b.contains(document.activeElement) ? Pick.from || $c(`[data-crew="${Pick.src}"]`) : null;
    b.hidden = true; Pick.src = null; document.body.classList.remove('sheet-open');
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }
  Pick.from = null;
  const bk = $c('pickBack'); if (bk) bk.hidden = true;
}
async function openPick(src) {
  if (!Pick.from) Pick.from = document.activeElement;
  Pick.src = src;
  if (src === 'comp' && (!C.comp || C.comp.ended)) { renderPick(); try { await ensureCompanion(); } catch (err) { closePick(); throw err; } }
  renderPick();
  // The keyboard goes into the picker: to the choice in use.
  const box = $c('cPick');
  (box.querySelector('.mp-preset[aria-checked="true"], .mp-list [aria-checked="true"]') || box.querySelector('button'))?.focus({ preventScroll: true });
}
function renderPick() {
  const box = $c('cPick'); const src = Pick.src; if (!src) return;
  const mi = C.mi[src]; const name = PROV_NAME[provFor(src)];
  // With the Codex helper available, one picker sets either: tabs at the top.
  const tabs = duo() ? `<div class="mp-tabs" role="tablist">${['main', 'comp'].map(t => `<button type="button" role="tab" class="${provFor(t)}" aria-selected="${t === src}" data-picksrc="${t}">${PROV_NAME[provFor(t)]}<small>${esc(C.mi[t] ? `${modelLabel(C.mi[t])}${C.mi[t].effort ? ` · ${C.mi[t].effort}` : ''}` : t === 'comp' ? 'not started' : '…')}</small></button>`).join('')}</div>` : '';
  const top = `<div class="mp-top"><span class="mp-grab" aria-hidden="true"></span>${tabs || `<p class="mp-title">${name}’s model</p>`}<button type="button" class="mp-done" data-pickdone>Done</button></div>`;
  const cx = C.ctx[src], cf = ctxFill(cx);
  const busyNow = (src === 'comp' ? C.comp && C.comp.state : C.state) !== 'ready';
  const ctxRow = cx ? `<div class="mp-ctx"><p class="mp-h"><span class="mp-t">Context</span><span>${esc(ctxLine(src))}</span></p>
      <div class="mp-ctxbar ${ctxClass(cf)}" role="meter" aria-label="How full the context is" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(cf * 100)}"><i style="width:${Math.round(cf * 100)}%"></i></div>
      <div class="mp-ctxrow">${cx.parts && cx.parts.length ? `<p class="mp-ctxparts">${cx.parts.map(p => `${esc(p.name)} ${kTok(p.tokens)}`).join(' · ')}</p>` : '<p class="mp-ctxparts">Summarizing keeps the gist and frees room.</p>'}
      <button type="button" class="btn sm" data-c="compact" data-src="${src}" ${busyNow ? 'disabled title="Wait for the reply to finish"' : ''}>Summarize now</button></div></div>` : '';
  if (!mi || !mi.models || !mi.models.length) box.innerHTML = `${top}${ctxRow}<p class="mp-load"><span class="gen-spin" aria-hidden="true"></span>Asking ${name} which models it has…</p>`;
  else {
    const cur = mi.models.find(m => m.value === mi.model);
    const efforts = (cur && cur.efforts && cur.efforts.length ? cur.efforts : mi.efforts) || [];
    // Claude Code lists its current lineup by alias ("sonnet"); dated and older models fold away.
    const older = m => provFor(src) === 'claude' && /^claude-/.test(m.value);
    const row = m => `<button type="button" role="radio" aria-checked="${m.value === mi.model}" data-model="${esc(m.value)}"><b>${esc(m.label)}</b>${m.description ? `<small>${esc(m.description)}</small>` : ''}</button>`;
    const late = mi.models.filter(older);
    const presets = presetsFor(src);
    const onPreset = presets.find(p => p.model === mi.model && p.effort === mi.effort);
    const picks = presets.length ? `<p class="mp-h"><span class="mp-t">Quick picks</span><span>a model and effort in one tap</span></p>
        <div class="mp-presets" role="radiogroup" aria-label="Quick picks">${presets.map(p => `<button type="button" role="radio" class="mp-preset" aria-checked="${p === onPreset}" data-preset="${p.id}">
          <span class="mpp-g" aria-hidden="true">${p.glyph}</span><b>${esc(p.name)}</b><small>${esc(p.label)}${p.effort ? ` · ${esc(p.effort)}` : ''}</small><em>${esc(p.note)}</em></button>`).join('')}</div>` : '';
    // On a phone the full list folds away under the quick picks, unless the model in use is only there.
    const listOpen = !isPhone() || !onPreset;
    box.innerHTML = `${top}${ctxRow}${picks}
        <details class="mp-all" ${listOpen ? 'open' : ''}><summary class="mp-h"><span class="mp-t"><b>${name}</b> · every model</span><span>takes effect from your next message</span></summary>
        <div class="mp-list" role="radiogroup" aria-label="${name} model">${mi.models.filter(m => !older(m)).map(row).join('')}
        ${late.length ? `<details class="mp-more" ${late.some(m => m.value === mi.model) ? 'open' : ''}><summary>Earlier models (${late.length})</summary>${late.map(row).join('')}</details>` : ''}</div></details>
        ${efforts.length ? `<p class="mp-h"><span class="mp-t">Effort</span><span>how hard it thinks</span></p><div class="mp-eff" role="radiogroup" aria-label="Effort">${efforts.map(e => `<button type="button" role="radio" aria-checked="${e === mi.effort}" data-effort="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : ''}
        ${mi.replyModel && mi.resolvedModel && mi.replyModel !== mi.resolvedModel && provFor(src) === 'claude' ? `<p class="mp-note">The last reply came from <b>${esc(modelName(mi.replyModel))}</b>.${$c('cMode').value === 'plan' ? ' In Plan only mode, Claude Code plans with a stronger model than Haiku.' : ''}</p>` : ''}
        <p class="mp-f">Remembered for this chat, and for new ${name} chats in ${esc(C.folder || 'this project')}. Shortcut: <kbd class="kbd">/model ${provFor(src) === 'codex' ? 'luna' : 'sonnet'}</kbd></p>`;
  }
  box.classList.toggle('codex', provFor(src) === 'codex');
  const wasHidden = box.hidden;
  box.hidden = false;
  document.body.classList.toggle('sheet-open', isPhone());
  $c('pickBack').hidden = !isPhone();   // on a phone, a tap on the dimmed area closes it (and goes no further)
  if (wasHidden) box.scrollTop = 0;
}
async function pickModel(src, change) {
  const key = keyFor(src); if (!key) return;
  const r = await api('/api/chat/model', { key, ...change });
  C.mi[src] = { ...(C.mi[src] || {}), ...r };
  renderCrew(); renderPick(); renderLedgerSoon();
  if (src === 'main') { C.model = modelLabel(C.mi.main); $c('cModel').textContent = C.model; }
  toast(`${PROV_NAME[provFor(src)]}: ${modelLabel(C.mi[src])}${C.mi[src].effort ? `, ${C.mi[src].effort} effort` : ''}.`, 2200);
}
// "/model sonnet" or "/effort high" in the message box: switches without sending anything.
async function quickSwitch(kind, value) {
  const src = C.target === 'comp' && duo() ? 'comp' : 'main';
  if (src === 'comp') await ensureCompanion();
  const mi = C.mi[src];
  const v = value.toLowerCase();
  if (kind === 'effort') return pickModel(src, { effort: v });
  const list = (mi && mi.models) || [];
  const hit = list.find(m => m.value.toLowerCase() === v) || list.find(m => m.label.toLowerCase() === v)
    || list.find(m => m.label.toLowerCase().replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))) || list.find(m => m.value.toLowerCase().includes(v));
  if (!hit && list.length) { toast(`${PROV_NAME[provFor(src)]} has no model called “${value}”. Click its name under the message box to see them all.`, 6000); return undefined; }
  return pickModel(src, { model: hit ? hit.value : value });
}

// Starts (or reconnects to) the Codex helper for this Claude chat.
function ensureCompanion() {
  if (C.comp && !C.comp.ended) return Promise.resolve(C.comp);
  if (C.compPending) return C.compPending;
  const gen = C.gen;
  C.compPending = api('/api/chat/companion', { key: C.key, account: S.acct })
    .then(info => { if (gen !== C.gen) throw new Error('You switched chats.'); attachComp(info); return C.comp; })
    .finally(() => { C.compPending = null; });
  return C.compPending;
}
function attachComp(info) {
  if (C.comp && C.comp.es) C.comp.es.close();
  C.comp = { key: info.key, state: info.state, startedAt: info.startedAt, sessionId: info.sessionId, lastSeq: 0, status: '', es: null, ended: info.state === 'ended' };
  if (info.models && info.models.length) C.mi.comp = info;
  if (info.context) C.ctx.comp = info.context;
  const key = info.key;
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}&after=0`);
  es.addEventListener('chat', e => { if (!C.comp || C.comp.key !== key) return; try { handle(JSON.parse(e.data), 'comp'); } catch (err) { console.error(err); } });
  es.onerror = () => { if (C.comp && C.comp.key === key && C.comp.ended) es.close(); };
  C.comp.es = es;
  renderCrew(); renderLedgerSoon();
}

// Quotes a reply to the other one: Claude's plan to Codex for an image, Codex's answer back to Claude.
function relay(turn) {
  const from = turn.dataset.prov || C.provider;
  const text = turnMarkdown(turn).slice(0, 6000);
  if (!text) { toast('There’s no text in that reply to pass on.'); return; }
  setTarget(from === C.provider ? 'comp' : 'main', false);
  placeText(`${PROV_NAME[from]} said:\n\n${text.split('\n').map(l => `> ${l}`).join('\n')}\n\n`, false);
}
async function giveImage(p) {
  const blob = await (await fetch(imageUrl(p))).blob();
  if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) { toast('That picture’s format can’t be attached.'); return; }
  if (blob.size > 5 * 1024 * 1024) { toast('That picture is over 5 MB, so it can’t be attached. Point Claude to its path instead.', 7000); return; }
  const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
  C.attachments.push({ mediaType: blob.type, data: data.slice(data.indexOf(',') + 1) });
  renderAttachments();
  setTarget(C.provider === 'claude' ? 'main' : 'comp', false);
  placeText(`Here’s the picture Codex made (saved at \`${p}\`). `, false);
}

// The first Esc while a reply is coming only asks; a second one within a moment stops it.
let escTimer = null;
function armEsc(name) {
  C.escArmed = Date.now();
  disarmEsc(true);
  // It takes the place of the keyboard tips under the message box, clear of toasts and the reply.
  $c('cHint').insertAdjacentHTML('afterend', `<p class="c-escarm" id="cEscArm" role="status"><kbd>Esc</kbd> again stops ${esc(name)}</p>`);
  escTimer = setTimeout(disarmEsc, 1600);
}
function disarmEsc(keepArm) { clearTimeout(escTimer); $c('cEscArm')?.remove(); if (!keepArm) C.escArmed = 0; }
