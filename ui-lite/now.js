'use strict';
/* Now: one line saying how many need you, are running and are waiting; the Commander; then
   Needs you (Allow / Deny and quick replies on the row), Running, Waiting on others, Coming up
   (routines) and This week (the use-next order and each plan). */

const CMD_CHIPS = ['Nudge anything stuck for 2+ days', 'Sort new chats by kind and status', 'What changed since yesterday?', 'Plan my hackathon weekend'];

// A live entry as a chat row: the chat it belongs to, when the list has it.
const titleOf = x => { const c = x.sessionId && chatBy.get(x.sessionId); return (c && c.title) || x.title || 'New chat'; };
const whereOf = x => { const c = x.sessionId && chatBy.get(x.sessionId); const p = c && projOf(c); return p ? `${p.name}${p.bucket ? ` · ${bucketName(p.bucket)}` : ''}` : x.folder || ''; };
const idOf = x => x.sessionId || x.key;

// The end of a reply, for a card: Markdown links as their words, starting at a sentence (or at
// least a word) when it had to be cut.
function replyTail(t, n = 300) {
  t = String(t || '').replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1').replace(/^[^\[]*?\]\(\S+?\)/, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n && !/^[a-z]/.test(t)) return t;
  t = t.slice(-n);
  const i = t.search(/[.!?:]\s+[A-Z(]/);
  return `…${i >= 0 && i < n * 0.6 ? t.slice(i + 1).trim() : t.slice(t.indexOf(' ') + 1)}`;
}
// Needs-you cards: which show their whole reply (and the replies read so far), and which have the reply box open.
const NW = { more: new Set(), full: {}, replying: new Set() };
function toggleMore(id) {
  if (NW.more.has(id)) NW.more.delete(id);
  else {
    NW.more.add(id);
    const x = S.live.find(l => idOf(l) === id);
    if (x && x.sessionId && NW.full[id] === undefined) api(`/api/chat/last-reply?id=${encodeURIComponent(x.sessionId)}`).then(j => { NW.full[id] = j.text || ''; renderLive(); }).catch(() => { NW.full[id] = ''; renderLive(); });
  }
  renderLive();
}
function openQuickReply(key) {
  NW.replying.add(key); renderLive();
  const t = document.querySelector(`textarea[data-qr="${CSS.escape(key)}"]`); if (t) t.focus();
}
function needsRow(x) {
  const id = idOf(x);
  const head = `<div class="row" role="button" tabindex="-1" data-open="${esc(x.sessionId || '')}" data-cur="n:${esc(id)}"><span class="dot needs-dot" title="Needs you"></span>
    <span class="t"><b>${esc(titleOf(x))}</b><small>${esc(whereOf(x))}${x.source !== 'app' ? ' · in another app' : ''}</small></span><span class="side-tags"></span><span class="when">${x.finishedAt ? ago(x.finishedAt) : ''}</span>
    <button class="iconbtn rmenu" data-dismiss="${esc(id)}" aria-label="Not now" title="Not now">×</button></div>`;
  let ask;
  const p = (x.pending || [])[0];
  if (p && p.question) ask = `<span class="q">Asks you a question${x.pending.length > 1 ? ` (and ${x.pending.length - 1} more)` : ''}.</span><button class="btn prime" data-open="${esc(x.sessionId || '')}">Open to answer</button>`;
  else if (p && x.key) ask = `<code>${esc(p.detail || p.summary || p.toolName)}</code><button class="btn prime" data-perm="allow" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Allow <kbd>a</kbd></button>${p.canAlways ? `<button class="btn" data-perm="always" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Always allow</button>` : ''}<button class="btn" data-perm="deny" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Deny <kbd>d</kbd></button>`;
  else if (p) ask = `<span class="q">Wants to use ${esc(p.toolName)}. It’s running in another app, so answer it there.</span>`;
  else {
    // A reply: two small lines, + for all of it; the reply box stays folded until you tap Reply.
    const more = NW.more.has(id), full = NW.full[id];
    const text = more ? `<div class="q-full msg-ai">${full === undefined ? '<p class="empty-note">Reading…</p>' : mdHtml(full || x.lastText || 'Replied.')}</div>` : `<span class="q q-short" data-open="${esc(x.sessionId || '')}" title="Open the chat">${esc(replyTail(x.lastText, 180) || 'Replied.')}</span>`;
    const toggle = x.sessionId ? `<button type="button" class="iconbtn q-more" data-qmore="${esc(id)}" aria-expanded="${more}" aria-label="${more ? 'Show less' : 'Show all of it'}" title="${more ? 'Less' : 'All of it'}">${more ? '−' : '+'}</button>` : '';
    const reply = !(x.key && x.source === 'app') ? `<button class="btn" data-open="${esc(x.sessionId || '')}">Open</button>`
      : NW.replying.has(x.key) ? `<textarea ${MSG_ATTRS} rows="1" data-qr="${esc(x.key)}" data-id="${esc(id)}" placeholder="Reply without opening…" aria-label="Quick reply"></textarea><button class="btn prime" data-send="${esc(x.key)}">Send</button>`
        : `<button class="btn" data-qreply="${esc(x.key)}">Reply <kbd>r</kbd></button>`;
    ask = `<div class="q-line">${text}${toggle}</div><div class="q-acts">${reply}</div>`;
  }
  return `<div class="rowwrap">${head}<div class="ask">${ask}</div></div>`;
}

function runRow(x) {
  // mcp__Claude_Browser__browser_batch reads better as "Claude Browser: browser batch".
  const tool = String(x.tool || 'Working').replace(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/, (m, a, b) => `${a.replace(/_/g, ' ')}: ${b.replace(/_/g, ' ')}`);
  const step = x.phase === 'tool' ? `${tool}${x.detail ? ` · ${x.detail}` : ''}` : x.phase === 'writing' ? 'Writing' : x.phase === 'starting' ? 'Starting' : 'Thinking';
  return `<div class="row" role="button" tabindex="-1" data-open="${esc(x.sessionId || '')}" data-cur="r:${esc(idOf(x))}"><span class="live-dot"></span><span class="t"><b>${esc(titleOf(x))}</b><small>${esc(step)} · ${esc(whereOf(x))}${x.accountName ? ` · <span class="acct">${esc(x.accountName)}</span>` : ''}</small></span><span class="side-tags"></span><span class="when">${x.turnStartedAt ? since(x.turnStartedAt) : ''}</span><span></span></div>`;
}

function waitRow(c) {
  const p = projOf(c);
  const due = c.remindAt && ms(c.remindAt) < S.now;
  return `<div class="row" role="button" tabindex="-1" data-chat="${esc(c.id)}" data-cur="${esc(c.id)}"><span>${due ? '<span class="dot needs-dot" title="Time to check on it"></span>' : ''}</span>
    <span class="t"><b>${esc(c.title)}</b><small>${esc(c.note || `${p.name}${p.bucket ? ` · ${bucketName(p.bucket)}` : ''}`)}${due ? ' · two days, time to check' : ''}</small></span>
    <span class="side-tags">${c.waitingOn ? `<span class="tag wait-tag">${esc(c.waitingOn)}</span>` : ''}</span><span class="when">${ago(c.updated)}</span>
    <button class="iconbtn rmenu" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="Move or change">${IC.dots}</button></div>`;
}

function routineRunsOn(r) {
  // Routines that follow the order take the use-next plan of their family when they run.
  const fam = r.provider === 'codex' ? 'chatgpt' : 'claude';
  const pinned = planById(r.account);
  if (pinned && pinned.family === 'ollama') return 'Ollama';
  if (S.lite.routinesFollow && (!pinned || pinned.family === fam)) { const n = useNext(fam); if (n) return `${n.label} ${famName(fam)} (use next)`; }
  return pinned ? `${pinned.label} ${famName(pinned.family)}` : famName(fam);
}
function comingUp() {
  return S.routines.filter(r => r.enabled).sort((a, b) => (a.nextAt || Infinity) - (b.nextAt || Infinity)).slice(0, 6);
}

const needList = () => S.live.filter(needsLive).sort((a, b) => Number(asking(b)) - Number(asking(a)) || (b.finishedAt || 0) - (a.finishedAt || 0));
const runList = () => S.live.filter(x => x.working && !asking(x) && !isRoutineRun(x)).sort((a, b) => (a.turnStartedAt || 0) - (b.turnStartedAt || 0));
// The part of Now that moves with every live event; redrawn on its own.
function nowLiveHtml() {
  const need = needList(), run = runList();
  return `<section class="section"><div class="sec-h"><h2>${L('Needs you')}</h2><span class="n">${need.length}</span>${need.length ? '<button class="hint tr-start" data-triage="1">Triage, one at a time <kbd>t</kbd></button>' : ''}</div>
      <div class="rows">${need.map(needsRow).join('') || '<p class="empty-note all-clear">All clear. Nothing needs you.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>${L('Running')}</h2><span class="n">${run.length}</span></div>
      <div class="rows">${run.map(runRow).join('') || '<p class="empty-note">Nothing is running.</p>'}</div></section>`;
}
const leadHtml = () => { const w = allChats().filter(c => c.waiting).length; return `${word(needList().length, 'needs you', 'need you')}, ${word(runList().length, 'running', 'running')}, ${word(w, 'waiting on someone', 'waiting on others')}.`; };
function plansBoxHtml() {
  // Drain-to is a setting now (Look menu); the bars keep its mark. Checking is a refresh icon.
  return `<div class="sec-h"><h2>This week</h2><button class="iconbtn refresh ${S.plansRefreshing ? 'spinning' : ''}" data-refreshplans="1" aria-label="${S.plansRefreshing ? 'Checking the plans…' : 'Check the plans now'}" title="${S.plansRefreshing ? 'Checking…' : 'Check now'}">${IC.refresh}</button></div>
      ${S.plans ? plansTable() : '<p class="empty-note">Reading your plans…</p>'}`;
}
function now() {
  const waiting = allChats().filter(c => c.waiting).sort((a, b) => b.updated - a.updated);
  const foc = focusList();
  const ups = comingUp();
  return `<div class="wrap">
    <div class="page-h"><div class="proj-h" style="align-items:flex-start"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><div><h1>${L('Now')}</h1><p class="lead" id="nowLead">${leadHtml()}</p></div></div></div>
    ${commanderHtml()}
    <div id="nowLive" class="section-stack">${nowLiveHtml()}</div>
    ${eventsSection()}
    ${foc.length ? `<section class="section" data-drop-focus="1"><div class="sec-h"><h2><span class="focus-star">★</span>Focus</h2><span class="n">${foc.length}</span><span class="hint">Your top few; <kbd>f</kbd> on any chat</span></div><div class="rows">${foc.map(c => rowHtml(c, { showProject: true, showStage: true })).join('')}</div></section>` : ''}
    <section class="section"><div class="sec-h"><h2>Waiting on others</h2><span class="n">${waiting.length}</span><span class="hint">Reminds you after two days</span></div>
      <div class="rows">${waiting.map(waitRow).join('') || '<p class="empty-note">Nothing is waiting on anyone. Press <kbd>w</kbd> on a chat to say who it’s waiting on.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>Coming up</h2><label class="hint follow"><input type="checkbox" data-follow="1" ${S.lite.routinesFollow ? 'checked' : ''}> Follow the use-next order</label><button class="hint" data-go="routines" style="margin-left:12px">Routines ›</button></div>
      <div class="rows">${ups.map(r => `<div class="row"><span class="dot" style="background:var(--st-final)"></span><span class="t"><b>${esc(r.name)}</b><small>${esc(r.when)} · runs on ${esc(routineRunsOn(r))}${r.last ? ` · last: ${esc(r.last.line)}` : ''}</small></span><span class="side-tags">${r.running ? '<span class="live-dot"></span>' : ''}</span><span class="when">${r.nextAt ? esc(inWords(r.nextAt)) : r.when ? 'watching' : ''}</span><span></span></div>`).join('') || '<p class="empty-note">No routines yet.</p>'}</div></section>
    <section class="section" id="planBox">${plansBoxHtml()}</section>
  </div>`;
}

/* ---------- the Commander ---------- */
// One box at the top of Now. Built on the Commander chat from the orchestration work: it can list
// chats, read them, nudge them and start sub-chats; every action shows in the chat it touched.
function commanderAnswer() {
  const evs = S.cmd.events;
  let last = -1;
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].kind === 'user') { last = i; break; }
  if (last < 0) return null;
  const after = evs.slice(last + 1);
  const question = String(evs[last].text || '').replace(/^From Lite:\s*/, '');
  let text = '', steps = 0, live = '', done = false, err = '';
  for (const e of after) {
    if (e.kind === 'assistant') { for (const b of e.blocks || []) { if (b.type === 'text') text += (text ? '\n\n' : '') + b.text; if (b.type === 'tool') steps++; } live = ''; }
    else if (e.kind === 'delta' && !e.thinking) live += e.text || '';
    else if (e.kind === 'result') { done = true; if (!e.ok && (e.errors || []).length) err = e.errors.join(' '); }
    else if (e.kind === 'permission') steps++;
  }
  const waiting = after.some(e => e.kind === 'permission') && !after.some(e => e.kind === 'permission_done');
  return { question, text: text + (live ? (text ? '\n\n' : '') + live : ''), steps, done, err, waiting };
}
function commanderHtml() {
  const a = commanderAnswer();
  const st = S.cmd.state;
  return `<form class="cmd" id="cmdForm" autocomplete="off">
    <span class="cmd-ic">${IC.spark}</span><input ${MSG_ATTRS} id="cmdInput" placeholder="Ask the commander: nudge, sort, summarize, plan…" aria-label="Ask the commander" ${st === 'starting' ? 'disabled' : ''}>
    <button class="btn prime" type="submit" ${st === 'starting' || st === 'working' ? 'disabled' : ''}>${st === 'starting' ? 'Starting…' : st === 'working' ? 'Working…' : 'Ask'}</button>
    <div class="cmd-chips">${CMD_CHIPS.map(t => `<button type="button" class="chip" data-cmd="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    ${S.cmd.error ? `<div class="cmd-answer"><p class="warn" style="color:var(--st-bug)">${esc(S.cmd.error)}</p></div>` : ''}
    ${a ? `<div class="cmd-answer"><div class="cmd-meta"><b>Commander</b><small>${esc(a.question.slice(0, 90))}${a.steps ? ` · ${a.steps} step${a.steps === 1 ? '' : 's'}` : ''}${a.done ? '' : ' · working…'}</small>${S.cmd.sessionId ? `<button type="button" class="linkish" data-open="${esc(S.cmd.sessionId)}">Open its chat</button>` : ''}</div>
      ${a.waiting ? '<p>It’s asking to do something. Open its chat to allow it.</p>' : ''}${a.err ? `<p style="color:var(--st-bug)">${esc(a.err)}</p>` : ''}<div class="cmd-text">${a.text ? mdHtml(a.text) : (a.done ? 'Done.' : '…')}</div></div>` : ''}
  </form>`;
}
function cmdListen(key) {
  if (S.cmd.es && S.cmd.key === key) return;
  if (S.cmd.es) S.cmd.es.close();
  S.cmd.key = key; S.cmd.events = [];
  const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}`);
  S.cmd.es = es;
  S.cmd.chatState = 'starting';
  es.addEventListener('hello', e => { try { const info = JSON.parse(e.data); S.cmd.sessionId = info.sessionId || S.cmd.sessionId; S.cmd.chatState = info.state; } catch { /* fine */ } });
  es.addEventListener('chat', e => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.kind === 'init' && ev.sessionId) S.cmd.sessionId = ev.sessionId;
    if (ev.kind === 'state') S.cmd.chatState = ev.state;
    S.cmd.events.push(ev);
    if (S.cmd.events.length > 400) S.cmd.events.splice(0, S.cmd.events.length - 400);
    if (ev.kind === 'result') S.cmd.state = 'idle';
    if (ev.kind === 'ended') { S.cmd.state = 'idle'; es.close(); S.cmd.es = null; S.cmd.key = null; }
    renderCommander();
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { S.cmd.es = null; S.cmd.key = null; } };
}
function renderCommander() {
  if (S.view !== 'now') return;
  const f = $('cmdForm'); if (!f) return;
  const typed = $('cmdInput') ? $('cmdInput').value : '';
  const focused = document.activeElement && document.activeElement.id === 'cmdInput';
  f.outerHTML = commanderHtml();
  if ($('cmdInput')) { $('cmdInput').value = typed; if (focused) $('cmdInput').focus(); }
  const t = document.querySelector('.cmd-text'); if (t) t.scrollTop = t.scrollHeight;
}
const waitFor = async (test, msTotal) => { const t0 = Date.now(); while (Date.now() - t0 < msTotal) { if (await test()) return true; await new Promise(r => setTimeout(r, 600)); } return false; };
async function askCommander(text) {
  text = String(text || '').trim(); if (!text) return;
  S.cmd.error = null; S.cmd.state = 'starting'; renderCommander();
  try {
    const info = await api('/api/commander/open', {});
    S.cmd.sessionId = info.sessionId || S.cmd.sessionId;
    cmdListen(info.key);
    // A Commander that was just started needs a moment before it can take a message.
    if (!await waitFor(async () => S.cmd.chatState && S.cmd.chatState !== 'starting', 45000)) throw new Error('The Commander took too long to start. Try again in a moment.');
    if (S.cmd.chatState === 'ended') throw new Error('The Commander stopped as it started. Open it in the full app to see why.');
    S.cmd.state = 'working'; renderCommander();
    await api('/api/chat/send', { key: info.key, text });
  } catch (err) {
    S.cmd.state = 'idle';
    S.cmd.error = /isn’t signed in|sign in/i.test(err.message) ? `${err.message} The Commander runs as one of your Claude accounts; pick it in the full app’s Commander settings.` : err.message;
    renderCommander();
  }
}

/* ---------- Triage: Needs you, one at a time, until it's empty ----------
   The queue is fixed when you start (new arrivals join the end); handling one opens the next. */
const TR = { ids: [], i: 0, handled: 0, full: {}, replying: false };
const trKey = x => x.sessionId || x.key;
function startTriage() {
  TR.ids = needList().map(trKey); TR.i = 0; TR.handled = 0; TR.replying = false;
  go('triage');
}
function trItems() {
  // Keep the order you started with, drop what's handled, append newcomers.
  const live = new Map(S.live.filter(needsLive).map(x => [trKey(x), x]));
  for (const k of live.keys()) if (!TR.ids.includes(k)) TR.ids.push(k);
  TR.ids = TR.ids.filter(k => live.has(k));
  if (TR.i >= TR.ids.length) TR.i = Math.max(0, TR.ids.length - 1);
  return TR.ids.map(k => live.get(k));
}
function triageView() {
  const items = trItems();
  const x = items[TR.i];
  if (!x) {
    return `<div class="triage"><div class="tr-card done-card"><p class="tr-big">All clear.</p><p class="lead">${TR.handled ? `${TR.handled} handled.` : 'Nothing needs you.'} New requests knock when they arrive.</p><div class="tr-acts"><button class="btn prime" data-go="now">Back to ${L('Now')} <kbd>esc</kbd></button></div></div></div>`;
  }
  const p = (x.pending || [])[0];
  const c = x.sessionId && chatBy.get(x.sessionId);
  const proj = c ? projOf(c) : null;
  const full = TR.full[trKey(x)];
  if (!p && x.sessionId && full === undefined) { TR.full[trKey(x)] = null; api(`/api/chat/last-reply?id=${encodeURIComponent(x.sessionId)}`).then(j => { TR.full[trKey(x)] = j.text || ''; if (S.view === 'triage') render(); }).catch(() => {}); }
  const body = p
    ? (p.question ? `<p class="tr-what">Asks you a question.</p><p class="hint-line">Questions have choices; open the chat to answer.</p>` : `<p class="tr-what">Wants to ${esc(wantsTo(p.toolName))}</p>${p.detail || p.summary ? `<pre class="tr-code">${esc(p.detail || p.summary)}</pre>` : ''}`)
    : `<div class="tr-reply msg-ai">${mdHtml(full || x.lastText || 'Finished its turn.')}</div>`;
  const acts = p && !p.question && x.key
    ? `<button class="btn prime" data-tr="allow">Allow <kbd>a</kbd></button>${p.canAlways ? '<button class="btn" data-tr="always">Always allow</button>' : ''}<button class="btn" data-tr="deny">Deny <kbd>d</kbd></button>`
    : x.key && x.source === 'app' && !p ? '<button class="btn prime" data-tr="reply">Reply <kbd>r</kbd></button><button class="btn" data-tr="done">Done <kbd>e</kbd></button>' : '<button class="btn" data-tr="done">Done <kbd>e</kbd></button>';
  return `<div class="triage">
    <div class="tr-top"><span>${TR.i + 1} of ${items.length}</span><span class="tr-bar"><i style="width:${Math.round(100 * (TR.handled) / (TR.handled + items.length))}%"></i></span><button class="linkish" data-go="now">Exit <kbd>esc</kbd></button></div>
    <div class="tr-card">
      <div class="crumb">${proj ? `${esc(bucketName(proj.bucket))} › ${esc(proj.name)}` : esc(x.folder || '')}${x.accountName ? ` · ${esc(x.accountName)}` : ''}${x.finishedAt ? ` · ${ago(x.finishedAt)}` : ''}</div>
      <h2 class="tr-title">${esc(titleOf(x))}</h2>
      ${body}
      ${TR.replying ? `<form class="box tr-box" id="trForm"><textarea ${MSG_ATTRS} id="trBox" rows="2" placeholder="Reply, then ↵ (it goes to the next one)"></textarea></form>` : ''}
      <div class="tr-acts">${acts}<button class="btn" data-tr="open">Open <kbd>o</kbd></button><span class="tr-skip"><kbd>j</kbd> <kbd>k</kbd> skip</span></div>
    </div></div>`;
}
async function triageAct(kind) {
  const items = trItems(); const x = items[TR.i]; if (!x) return;
  const p = (x.pending || [])[0];
  if (kind === 'open') { if (x.sessionId) openChat(x.sessionId); return; }
  if (kind === 'reply') { TR.replying = true; render(); $('trBox')?.focus(); return; }
  if (['allow', 'always', 'deny'].includes(kind) && p && x.key) {
    await api('/api/chat/permission', { key: x.key, requestId: p.requestId, decision: kind });
    sfx(kind === 'deny' ? 'shove' : 'chip');
  } else if (kind === 'done') { markSeen(trKey(x)); sfx('slide'); }
  TR.handled++; TR.replying = false;
  TR.ids = TR.ids.filter(k => k !== trKey(x));
  if (!['allow', 'always', 'deny'].includes(kind)) markSeen(trKey(x));
  await loadLive().catch(() => {});
  render();
}
async function triageReply() {
  const items = trItems(); const x = items[TR.i]; const box = $('trBox');
  const text = box && box.value.trim(); if (!x || !text) return;
  box.disabled = true;
  try { await api('/api/chat/send', { key: x.key, text }); sfx('slide'); markSeen(trKey(x)); TR.handled++; TR.replying = false; TR.ids = TR.ids.filter(k => k !== trKey(x)); await loadLive().catch(() => {}); render(); }
  catch (err) { toast(err.message); box.disabled = false; }
}
