'use strict';
/* Now: one line saying how many need you, are running and are waiting; the Commander; then
   Needs you (Allow / Deny and quick replies on the row), Running, Waiting on others, Coming up
   (routines) and This week (the use-next order and each plan). */

const CMD_CHIPS = ['Nudge anything stuck for 2+ days', 'Sort new chats into stages', 'What changed since yesterday?', 'Plan my hackathon weekend'];

// A live entry as a chat row: the chat it belongs to, when the list has it.
const titleOf = x => { const c = x.sessionId && chatBy.get(x.sessionId); return (c && c.title) || x.title || 'New chat'; };
const whereOf = x => { const c = x.sessionId && chatBy.get(x.sessionId); const p = c && projOf(c); return p ? `${p.name}${p.bucket ? ` · ${bucketName(p.bucket)}` : ''}` : x.folder || ''; };
const idOf = x => x.sessionId || x.key;

function needsRow(x) {
  const id = idOf(x);
  const head = `<div class="row" role="button" tabindex="0" data-open="${esc(x.sessionId || '')}"><span class="dot needs-dot" title="Needs you"></span>
    <span class="t"><b>${esc(titleOf(x))}</b><small>${esc(whereOf(x))}${x.source !== 'app' ? ' · in another app' : ''}</small></span><span class="side-tags"></span><span class="when">${x.finishedAt ? ago(x.finishedAt) : ''}</span>
    <button class="iconbtn rmenu" data-dismiss="${esc(id)}" aria-label="Not now" title="Not now">×</button></div>`;
  let ask;
  const p = (x.pending || [])[0];
  if (p && p.question) ask = `<span class="q">Asks you a question${x.pending.length > 1 ? ` (and ${x.pending.length - 1} more)` : ''}.</span><button class="btn prime" data-open="${esc(x.sessionId || '')}">Open to answer</button>`;
  else if (p && x.key) ask = `<code>${esc(p.detail || p.summary || p.toolName)}</code><button class="btn prime" data-perm="allow" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Allow</button>${p.canAlways ? `<button class="btn" data-perm="always" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Always allow</button>` : ''}<button class="btn" data-perm="deny" data-key="${esc(x.key)}" data-req="${esc(p.requestId)}">Deny</button>`;
  else if (p) ask = `<span class="q">Wants to use ${esc(p.toolName)}. It’s running in another app, so answer it there.</span>`;
  else if (x.key && x.source === 'app') ask = `<span class="q">${esc(x.lastText || 'Replied.')}</span><input data-qr="${esc(x.key)}" data-id="${esc(id)}" placeholder="Reply without opening…" aria-label="Quick reply"><button class="btn" data-send="${esc(x.key)}">Send</button>`;
  else ask = `<span class="q">${esc(x.lastText || 'Replied.')}</span><button class="btn" data-open="${esc(x.sessionId || '')}">Open</button>`;
  return `<div class="rowwrap">${head}<div class="ask">${ask}</div></div>`;
}

function runRow(x) {
  // mcp__Claude_Browser__browser_batch reads better as "Claude Browser: browser batch".
  const tool = String(x.tool || 'Working').replace(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/, (m, a, b) => `${a.replace(/_/g, ' ')}: ${b.replace(/_/g, ' ')}`);
  const step = x.phase === 'tool' ? `${tool}${x.detail ? ` · ${x.detail}` : ''}` : x.phase === 'writing' ? 'Writing' : x.phase === 'starting' ? 'Starting' : 'Thinking';
  return `<div class="row" role="button" tabindex="0" data-open="${esc(x.sessionId || '')}"><span class="live-dot"></span><span class="t"><b>${esc(titleOf(x))}</b><small>${esc(step)} · ${esc(whereOf(x))}${x.accountName ? ` · <span class="acct">${esc(x.accountName)}</span>` : ''}</small></span><span class="side-tags"></span><span class="when">${x.turnStartedAt ? since(x.turnStartedAt) : ''}</span><span></span></div>`;
}

function waitRow(c) {
  const p = projOf(c);
  const due = c.remindAt && ms(c.remindAt) < S.now;
  return `<div class="row" role="button" tabindex="0" data-chat="${esc(c.id)}"><span>${due ? '<span class="dot needs-dot" title="Time to check on it"></span>' : ''}</span>
    <span class="t"><b>${esc(c.title)}</b><small>${esc(c.note || `${p.name}${p.bucket ? ` · ${bucketName(p.bucket)}` : ''}`)}${due ? ' · two days, time to check' : ''}</small></span>
    <span class="side-tags">${c.waitingOn ? `<span class="tag wait-tag">${esc(c.waitingOn)}</span>` : ''}</span><span class="when">${ago(c.updated)}</span>
    <button class="iconbtn rmenu" data-rowmenu="${esc(c.id)}" aria-haspopup="menu" aria-label="Move or change">${IC.dots}</button></div>`;
}

function routineRunsOn(r) {
  // Routines that follow the order take the use-next plan of their family when they run.
  const fam = r.provider === 'codex' ? 'chatgpt' : 'claude';
  const pinned = planById(r.account);
  if (pinned && pinned.family === 'ollama') return 'Ollama';
  return pinned ? `${pinned.label} ${famName(pinned.family)}` : famName(fam);
}
function comingUp() {
  return S.routines.filter(r => r.enabled).sort((a, b) => (a.nextAt || Infinity) - (b.nextAt || Infinity)).slice(0, 6);
}

function now() {
  const lives = S.live;
  const need = lives.filter(needsLive).sort((a, b) => Number(asking(b)) - Number(asking(a)) || (b.finishedAt || 0) - (a.finishedAt || 0));
  const run = lives.filter(x => x.working && !asking(x)).sort((a, b) => (a.turnStartedAt || 0) - (b.turnStartedAt || 0));
  const waiting = allChats().filter(c => stageOf(c) === 'waiting').sort((a, b) => b.updated - a.updated);
  const ups = comingUp();
  const nPlans = plans().filter(p => !p.unlimited).length;
  return `<div class="wrap">
    <div class="page-h"><div class="proj-h" style="align-items:flex-start"><button class="iconbtn back" data-go="side" aria-label="Back">‹</button><div><h1>${L('Now')}</h1><p class="lead">${word(need.length, 'needs you', 'need you')}, ${word(run.length, 'running', 'running')}, ${word(waiting.length, 'waiting on someone', 'waiting on others')}.</p></div></div></div>
    ${commanderHtml()}
    <section class="section"><div class="sec-h"><h2>${L('Needs you')}</h2><span class="n">${need.length}</span></div>
      <div class="rows">${need.map(needsRow).join('') || '<p class="empty-note">Nothing needs you.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>${L('Running')}</h2><span class="n">${run.length}</span></div>
      <div class="rows">${run.map(runRow).join('') || '<p class="empty-note">Nothing is running.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>Waiting on others</h2><span class="n">${waiting.length}</span><span class="hint">Reminds you after two days</span></div>
      <div class="rows">${waiting.map(waitRow).join('') || '<p class="empty-note">Nothing is waiting on anyone. Set a chat’s stage to Waiting and say who.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>Coming up</h2><a class="hint" href="/">Routines in the full app ›</a></div>
      <div class="rows">${ups.map(r => `<div class="row" role="button" tabindex="0"><span class="dot" style="background:var(--st-final)"></span><span class="t"><b>${esc(r.name)}</b><small>${esc(r.when)} · runs on ${esc(routineRunsOn(r))}${r.last ? ` · last: ${esc(r.last.line)}` : ''}</small></span><span class="side-tags">${r.running ? '<span class="live-dot"></span>' : ''}</span><span class="when">${r.nextAt ? esc(inWords(r.nextAt)) : r.when ? 'watching' : ''}</span><span></span></div>`).join('') || '<p class="empty-note">No routines yet.</p>'}</div></section>
    <section class="section"><div class="sec-h"><h2>This week</h2><span class="n">${nPlans} plans${plans().some(p => p.unlimited) ? ' + Ollama' : ''} · soonest reset first</span><button class="hint" data-refreshplans="1">${S.plansRefreshing ? 'Checking…' : 'Check now'}</button></div>
      ${S.plans ? orderHtml() + `<div class="plans">${[...plans()].sort((a, b) => (a.broken || a.unlimited ? 1 : 0) - (b.broken || b.unlimited ? 1 : 0) || (a.family === b.family ? 0 : a.family === 'chatgpt' ? -1 : 1) || (ms(a.resetsAt) || Infinity) - (ms(b.resetsAt) || Infinity)).map(planHtml).join('')}</div>` + creditsHtml() : '<p class="empty-note">Reading your plans…</p>'}
      <p class="hint-line">Read from Claude Code and Codex${S.plans ? ` at ${esc(clock(S.plans.at))}` : ''}. Usage is sampled every hour; forecasts use the last day once there’s a day of samples, and this week’s average until then.</p></section>
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
    <span class="cmd-ic">${IC.spark}</span><input id="cmdInput" placeholder="Ask the commander: nudge, sort, summarize, plan…" aria-label="Ask the commander" ${st === 'starting' ? 'disabled' : ''}>
    <button class="btn prime" type="submit" ${st === 'starting' || st === 'working' ? 'disabled' : ''}>${st === 'starting' ? 'Starting…' : st === 'working' ? 'Working…' : 'Ask'}</button>
    <div class="cmd-chips">${CMD_CHIPS.map(t => `<button type="button" class="chip" data-cmd="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    ${S.cmd.error ? `<div class="cmd-answer"><p class="warn" style="color:var(--st-bug)">${esc(S.cmd.error)}</p></div>` : ''}
    ${a ? `<div class="cmd-answer"><div class="cmd-meta"><b>Commander</b><small>${esc(a.question.slice(0, 90))}${a.steps ? ` · ${a.steps} step${a.steps === 1 ? '' : 's'}` : ''}${a.done ? '' : ' · working…'}</small>${S.cmd.sessionId ? `<button type="button" class="linkish" data-open="${esc(S.cmd.sessionId)}">Open its chat</button>` : ''}</div>
      ${a.waiting ? '<p>It’s asking to do something. Open its chat to allow it.</p>' : ''}${a.err ? `<p style="color:var(--st-bug)">${esc(a.err)}</p>` : ''}<div class="cmd-text">${esc(a.text || (a.done ? 'Done.' : '…'))}</div></div>` : ''}
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
