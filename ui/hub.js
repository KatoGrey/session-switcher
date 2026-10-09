'use strict';
/* The top bar, the sidebar, the hub and each project’s page. */

/* ---------- top bar ---------- */
function renderBar() {
  const A = awaiting(), W = atWork();
  document.body.classList.toggle('working', W.length > 0);
  const p = $('pulse');
  p.classList.toggle('needs', A.length > 0);
  const parts = [];
  if (W.length) parts.push(`<span class="ember-dot" aria-hidden="true"></span><span><b>${W.length}</b> <span class="p-label">at work</span></span>`);
  if (A.length) parts.push(`${parts.length ? '<span class="sep" aria-hidden="true"></span>' : ''}<span class="gilt-dot" aria-hidden="true"></span><span class="p-need"><b>${A.length}</b> <span class="p-label">${A.length === 1 ? 'awaits you' : 'await you'}</span></span>`);
  if (!parts.length) parts.push('<span class="ash-dot" aria-hidden="true"></span><span class="p-label">All quiet</span>');
  p.innerHTML = parts.join('');
  p.setAttribute('aria-label', `${W.length} at work, ${A.length} awaiting you`);

  // Which account this is about: the open chat's, otherwise the one new chats open as.
  const chatAcct = window.ChatUI && ChatUI.isOpen() && ChatUI.accountId ? ChatUI.accountId() : null;
  const inChat = !!(window.ChatUI && ChatUI.isOpen());
  const a = (chatAcct && acctById(chatAcct)) || (inChat ? null : current());
  const chip = $('usechip');
  if (!a) { chip.hidden = !inChat; chip.innerHTML = inChat ? '<span class="ac-who"><small>This chat runs</small><b>Outside the app</b></span>' : ''; chip.style.removeProperty('--ring'); return; }
  const u = usageOf(a.id), d = u && u.data && u.data.available ? u.data : null;
  const cell = (label, w) => {
    if (!w) return '';
    const l = leftOf(w);
    return `<span class="ac-win ${hot(l) ? 'hot' : ''}"><small>${label}</small><b>${l}% left</b>${w.resetsAt ? `<i>resets ${esc(when(w.resetsAt))}</i>` : ''}</span>`;
  };
  chip.hidden = false;
  chip.style.setProperty('--ring', ringById(a.id));
  chip.innerHTML = `<span class="ac-ring">${miniDial(a.id, 30)}</span>
    <span class="ac-who"><small>${inChat ? 'This chat runs as' : 'New chats open as'}</small><b>${esc(a.name)}</b></span>
    ${d ? `<span class="ac-sep" aria-hidden="true"></span>${cell('5-hour window', d.fiveHour)}${cell('This week', d.week)}`
      : a.signedIn ? `<span class="ac-sep" aria-hidden="true"></span><span class="ac-win"><small>Usage</small><b>${u && u.error ? 'Unavailable' : 'Checking…'}</b></span>` : '<span class="ac-sep" aria-hidden="true"></span><span class="ac-win"><small>Account</small><b>Not signed in</b></span>'}`;
  chip.insertAdjacentHTML('beforeend', '<span class="ac-caret" aria-hidden="true">▾</span>');
  chip.title = `${inChat ? 'This chat runs as' : 'New chats open as'} ${a.name}${a.email ? ` (${a.email})` : ''}. ${usageLine(a.id) || ''} Click to see all your accounts.`;
}
function updateTitle() {
  const n = awaiting().length;
  document.title = n ? `(${n}) Session Switcher` : 'Session Switcher';
}

/* ---------- nav ---------- */
function renderNav() {
  const a = current();
  const A = awaiting().length, W = atWork().length;
  const total = S.projects.reduce((n, p) => n + p.sessions.length, 0);
  // Folders, split by which assistant the chats belong to. Pinned folders come first in each.
  // In the order they first appeared this session (most recent first, then), not reshuffled as chats work.
  const group = prov => keepOrder(`nav-${prov}`, S.projects.map(p => ({ p, list: p.sessions.filter(x => (prov === 'codex') === isCodex(x)) })).filter(x => x.list.length), x => [x.p.cwd.toLowerCase()]);
  const item = (x, prov) => {
    const live = x.list.some(c => isRunning(c.id) || liveOf(c.id));
    const firstProv = S.projects.find(q => q.cwd === x.p.cwd)?.sessions.some(c => !isCodex(c)) ? 'claude' : 'codex';
    const cur = S.view === 'folder' && S.folder === x.p.cwd && (S.prov ? S.prov === prov : !S.pins.has(x.p.cwd) && prov === firstProv);
    return `<button class="nav-i ${prov}" data-view="folder" data-cwd="${esc(x.p.cwd)}" data-prov="${prov}" aria-current="${cur}">
      <span class="glyph" aria-hidden="true">${glyphFor(x.p.name)}</span><span class="ni-t">${esc(x.p.name)}</span>
      ${live ? '<span class="live-dot" title="A chat here is open right now"></span>' : ''}<span class="count">${x.list.length}</span></button>`;
  };
  const claude = group('claude'), codexF = group('codex');
  // Pinned: projects and favorite chats, at the top.
  const pinnedP = [...S.pins].map(cwd => S.projects.find(p => p.cwd === cwd)).filter(Boolean);
  const pinnedC = [...S.favs].map(id => sessionById(id)).filter(([s2]) => s2);
  const chatDot = id => { const x = S.activity.find(y => y.sessionId && y.sessionId.toLowerCase() === id.toLowerCase()); if (!x) return ''; const st = statusOf(x); return NEEDS.has(st) || st === 'reply' ? '<span class="gilt-dot nav-dot" title="Waiting for you"></span>' : st === 'working' ? '<span class="ember-dot nav-dot" title="At work"></span>' : ''; };
  const fold = (id, label, count, cls = '') => `<button class="nav-h prov ${cls} fold" data-fold="${id}" aria-expanded="${!S.navFold.has(id)}"><span class="pmark" aria-hidden="true"></span>${label}<span class="count">${count}</span><span class="fold-c" aria-hidden="true">▾</span></button>`;
  const pinnedHtml = pinnedP.length || pinnedC.length ? `${fold('pinned', 'Pinned', pinnedP.length + pinnedC.length, 'pinned')}
    ${S.navFold.has('pinned') ? '' : pinnedP.map(p => `<button class="nav-i pin" data-view="folder" data-cwd="${esc(p.cwd)}" aria-current="${S.view === 'folder' && S.folder === p.cwd && !S.prov}"><span class="glyph" aria-hidden="true">★</span><span class="ni-t">${esc(p.name)}</span>${p.sessions.some(c => isRunning(c.id) || liveOf(c.id)) ? '<span class="live-dot"></span>' : ''}<span class="count">${p.sessions.length}</span></button>`).join('')
      + pinnedC.map(([c, p]) => `<button class="nav-i nav-chat ${isCodex(c) ? 'codex' : ''}" data-navchat="${esc(c.id)}" title="${esc(c.title)} · ${esc(p.name)}" aria-current="${!!(window.ChatUI && ChatUI.isOpen() && ChatUI.sessionId && ChatUI.sessionId() === c.id)}"><span class="glyph" aria-hidden="true">❝</span><span class="ni-t"><span class="nc-t">${esc(c.title)}</span><small>${esc(p.name)}${isCodex(c) ? ' · Codex' : ''}</small></span>${chatDot(c.id)}</button>`).join('')}` : '';
  const nClaude = claude.reduce((n, x) => n + x.list.length, 0), nCodex = codexF.reduce((n, x) => n + x.list.length, 0);
  const showCodex = S.codex && S.codex.enabled;
  const fresh = S.projects.filter(p => !p.sessions.length);
  const blocked = a && (a.pinnedOrg || a.expectEmail) && !a.lock.ok;
  const html = `
    <button class="seal ${blocked ? 'blocked' : ''}" id="seal" aria-haspopup="menu" aria-expanded="false" title="Choose which account new chats open as">
      <span class="seal-mark" style="--ring:${a ? ringOf(a) : 'var(--ash)'}">${a ? miniDial(a.id, 44) : ''}<b>${esc(a ? initial(a.name) : '?')}</b></span>
      <span class="seal-t"><span class="seal-k">${blocked ? 'Blocked' : 'Working as'}</span><span class="seal-n">${esc(a ? a.name : 'No account')}</span><span class="seal-e">${esc(a && a.signedIn ? (a.email || 'Signed in') : 'Not signed in')}</span></span>
      <span class="seal-caret">${ICON.caret}</span>
    </button>
    <div class="nav-h">Begin</div>
    <button class="nav-i" data-view="hub" aria-current="${S.view === 'hub'}"><span class="glyph" aria-hidden="true">✦</span><span class="ni-t">The hub</span>${A ? `<span class="tag gilt">${A}</span>` : W ? `<span class="tag">${W}</span>` : ''}</button>
    <button class="nav-i" data-view="recent" aria-current="${S.view === 'recent'}"><span class="glyph" aria-hidden="true">✧</span><span class="ni-t">Recent chats</span><span class="count">${total}</span></button>
    <button class="nav-i" data-view="palette" aria-current="${S.view === 'search'}"><span class="glyph" aria-hidden="true">❝</span><span class="ni-t">Search every chat</span><span class="count">Ctrl K</span></button>
    <button class="nav-i nav-new" data-view="newproject"><span class="glyph" aria-hidden="true">+</span><span class="ni-t">New project</span></button>
    ${fresh.length ? `<div class="nav-h prov fresh"><span class="pmark" aria-hidden="true"></span>No chats yet<span class="count">${fresh.length}</span></div>${fresh.map(p => `<button class="nav-i" data-view="folder" data-cwd="${esc(p.cwd)}" aria-current="${S.view === 'folder' && S.folder === p.cwd}"><span class="glyph" aria-hidden="true">${glyphFor(p.name)}</span><span class="ni-t">${esc(p.name)}</span><span class="tag ghost">New</span></button>`).join('')}` : ''}
    ${pinnedHtml}
    ${fold('claude', 'Claude Code', nClaude, 'claude')}
    ${S.navFold.has('claude') ? '' : claude.length ? claude.map(x => item(x, 'claude')).join('') : '<p class="nav-empty">No Claude Code chats yet.</p>'}
    ${showCodex ? `${fold('codex', 'Codex', nCodex, 'codex')}
    ${S.navFold.has('codex') ? '' : codexF.length ? codexF.map(x => item(x, 'codex')).join('') : `<p class="nav-empty">${codexReady() ? 'No Codex chats yet. Start one with “New Codex chat” on the Codex card.' : 'Sign in on the Codex card to use Codex here.'}</p>`}` : ''}
    <p class="nav-foot">${S.appVersion ? `Session Switcher ${esc(S.appVersion)}. ` : ''}Your chats never leave this PC.</p>`;
  // Only when something would look different (it's asked for several times a second while chats work).
  if ($('nav')._h === html) return;
  $('nav')._h = html;
  const focused = document.activeElement && $('nav').contains(document.activeElement) ? document.activeElement : null;
  const keep = focused && (focused.dataset.cwd ? `[data-cwd="${CSS.escape(focused.dataset.cwd)}"][data-view="${focused.dataset.view || ''}"]` : focused.dataset.view ? `[data-view="${focused.dataset.view}"]` : focused.dataset.navchat ? `[data-navchat="${CSS.escape(focused.dataset.navchat)}"]` : focused.dataset.fold ? `[data-fold="${focused.dataset.fold}"]` : focused.id ? `#${focused.id}` : null);
  $('nav').innerHTML = html;
  if (keep) $('nav').querySelector(keep)?.focus({ preventScroll: true });
}

/* ---------- the hub ---------- */
function heroHtml() {
  const a = current();
  const A = awaiting(), W = atWork().length;
  const N = A.filter(x => NEEDS.has(statusOf(x))).length, R = A.length - N;
  const Q = quietOpen().filter(x => x.source === 'app' && x.phase !== 'ended').length;
  let h, em;
  if (A.length) {
    h = `${nword(A.length)} ${A.length === 1 ? 'chat awaits' : 'chats await'} you.`;
    const parts = [];
    if (N) parts.push(N === 1 ? 'one needs your OK' : `${nword(N, false)} need your OK`);
    if (R) parts.push(R === 1 ? 'one has replied' : `${nword(R, false)} have replied`);
    if (W) parts.push(W === 1 ? 'one is still at work' : `${nword(W, false)} are still at work`);
    em = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.` : `${parts[0]}.`;
    em = em[0].toUpperCase() + em.slice(1);
  } else if (W) { h = `${nword(W)} ${W === 1 ? 'chat' : 'chats'} at work.`; em = 'Nothing needs you yet.'; }
  else { h = 'All quiet.'; em = Q ? (Q === 1 ? 'One chat is open and ready.' : `${nword(Q)} chats are open and ready.`) : 'Pick up any chat below.'; }

  let say = '';
  if (a) {
    say = a.signedIn ? `New chats open as <b>${esc(a.name)}</b>${a.plan ? ` (${esc(a.plan)})` : ''}. ` : `<b>${esc(a.name)}</b> isn’t signed in yet. `;
    const u = usageOf(a.id), d = u && u.data && u.data.available ? u.data : null;
    if (d) {
      const fl = leftOf(d.fiveHour), wl = leftOf(d.week);
      if (fl === 0) say += `It has reached its five-hour limit, which resets <b>${esc(when(d.fiveHour.resetsAt))}</b>.`;
      else if (wl === 0) say += `It has reached its weekly limit, which resets <b>${esc(when(d.week.resetsAt))}</b>.`;
      else if (fl !== null) {
        say += `It has <b>${fl}%</b> of its five-hour window left${d.fiveHour.resetsAt ? ` (resets ${esc(when(d.fiveHour.resetsAt))})` : ''}${wl !== null ? ` and <b>${wl}%</b> of the week` : ''}.`;
        const pf = paceOf(d.fiveHour, SPAN.fiveHour), pw = paceOf(d.week, SPAN.week);
        const run = [pf && pf.runsOut ? ['five-hour window', pf.runsOut] : null, pw && pw.runsOut ? ['week', pw.runsOut] : null].filter(Boolean).sort((x, y) => x[1] - y[1])[0];
        if (run) say += ` At this pace the ${run[0]} runs out around <b>${esc(when(new Date(run[1]).toISOString()))}</b>.`;
      }
    } else if (a.signedIn && u && u.error) say += 'Its usage isn’t available right now.';
    else if (a.signedIn) say += 'Checking its usage…';
  }
  const first = A[0];
  const latest = allSessions().sort((x, y) => y[0].updated - x[0].updated)[0];
  const better = headroomPick();
  const acts = [];
  if (first) acts.push(`<button class="btn gilt" data-hero="first">${NEEDS.has(statusOf(first)) ? 'Answer the first one' : 'Read the latest reply'}</button>`);
  if (better) acts.push(`<button class="btn" data-hero="switch" data-acct="${esc(better.a.id)}">Work as ${esc(better.a.name)}</button>`);
  if (!first && latest && canLaunch(a)) acts.push(`<button class="btn" data-hero="latest" data-sid="${esc(latest[0].id)}" title="${esc(latest[0].title)}">Continue “${esc(latest[0].title.length > 34 ? `${latest[0].title.slice(0, 33)}…` : latest[0].title)}”</button>`);
  const today = new Date();
  return `<section class="hero" aria-label="Right now">
    <svg class="hero-sigil" aria-hidden="true"><use href="#sigil"/></svg>
    <div class="hero-in">
      <div>
        <p class="eyebrow">${esc(today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} · <span data-clock>${esc(clock(today))}</span></p>
        <h1>${esc(h)}<em>${esc(em)}</em></h1>
        ${say ? `<p>${say}</p>` : ''}
        ${acts.length ? `<div class="hero-act">${acts.join('')}</div>` : ''}
      </div>
      ${a ? `<div class="stamp">Working as<b>${esc(a.name)}</b>${a.plan ? esc(a.plan) : ''}</div>` : ''}
    </div>
  </section>`;
}

function guardHtml() {
  const a = current(); if (!a) return '';
  const locked = !!(a.pinnedOrg || a.expectEmail);
  let out = '';
  const signBtn = a.expectEmail ? `<button class="btn prime" data-act="signin-direct" data-acct="${esc(a.id)}">Sign in as ${esc(a.expectEmail)}</button>` : `<button class="btn prime" data-act="signin" data-acct="${esc(a.id)}">Sign in</button>`;
  if (locked && !a.lock.ok) out += `<div class="guard" role="alert"><p><b>${esc(a.name)} is blocked.</b> ${esc(a.lockMessage)} Chats won’t open with it until then.</p>${signBtn}</div>`;
  else if (!a.signedIn) out += `<div class="guard"><p><b>${esc(a.name)} isn’t signed in.</b> If the sign-in page asks which organization to use, choose the one whose plan this account should use, then lock the account to it.</p>${signBtn}</div>`;
  return out;
}

function awaitCard(x) {
  const st = statusOf(x), k = keyOf(x);
  const p = (x.pending || [])[0];
  const label = { approve: 'Needs your OK', question: 'Has a question', 'terminal-wait': 'Waiting in its terminal', reply: asked(x) ? 'Your turn · asked you something' : x.ok === false ? 'Your turn · stopped early' : 'Your turn' }[st];
  const since = st === 'reply' ? `<span class="o-time" data-ago="${x.finishedAt}"></span>` : `<span class="o-time">waiting <span data-since="${x.lastEventAt || Date.now()}"></span></span>`;
  let body = '';
  if (st === 'approve') body = `<p class="o-ask">${esc(wantsTo(p))}${p && (p.detail || p.summary) ? `:</p><p class="o-cmd"><code>${esc(p.detail || p.summary)}</code></p>` : '.</p>'}`;
  else if (st === 'question') body = `<p class="o-ask">Claude asked a multiple-choice question. Open the chat to answer it.</p>`;
  else if (st === 'terminal-wait') body = `<p class="o-ask">It looks like it’s waiting for you in its terminal${x.tool ? ` (${esc(x.tool)}${x.detail ? `: <code>${esc(x.detail)}</code>` : ''})` : ''}. Switch to that window to answer.</p>`;
  else {
    const said = plainMd(lastLine(x.lastText));
    body = said ? `<blockquote class="o-quote">${esc(said.length > 320 ? `${said.slice(0, 319)}…` : said)}</blockquote>` : '<p class="o-ask">Claude finished its turn.</p>';
  }
  let acts = '';
  if (st === 'approve' && x.source === 'app') {
    acts = `<button class="btn gilt sm" data-a="allow">Allow</button>${p && p.canAlways ? '<button class="btn sm" data-a="always" title="Don’t ask again for this kind of action in this project">Always allow</button>' : ''}<button class="btn sm" data-a="deny">Deny</button><span class="spacer"></span><button class="btn quiet sm" data-a="open">Open chat</button>`;
  } else if (st === 'question') acts = '<button class="btn gilt sm" data-a="open">Answer it</button>';
  else if (st === 'terminal-wait') acts = '<button class="btn sm" data-a="open">Watch it here</button>';
  else if (x.source === 'app') {
    acts = `<form class="qr" data-a="reply"><textarea rows="1" placeholder="Reply to Claude…" aria-label="Reply to ${esc(x.title || 'this chat')}" data-qr="1"></textarea><button class="btn prime sm" type="submit">Send</button></form>
      <div class="qr-row"><button class="btn quiet sm" data-a="open">Open chat</button><button class="btn quiet sm" data-a="seen" title="Move it out of “Awaiting you”">${ICON.check} Mark as read</button></div>`;
  } else {
    acts = `<button class="btn sm" data-a="open">Read it here</button>${x.source === 'elsewhere' ? '<button class="btn quiet sm" data-a="resume">Continue it here</button>' : ''}<span class="spacer"></span><button class="btn quiet sm" data-a="seen">${ICON.check} Mark as read</button>`;
  }
  return `<article class="omen summons ${NEEDS.has(st) ? 'needs' : 'reply'}"><div class="omen-in">
    <header class="o-top"><span class="${NEEDS.has(st) ? 'gilt-dot' : 'reply-dot'}" aria-hidden="true"></span>${esc(label)}${since}</header>
    <h3 class="o-title"><button data-a="open">${esc(x.title || 'New chat')}</button></h3>
    <p class="o-where">${whereOf(x)}</p>
    ${body}
    <footer class="o-foot ${x.source === 'app' && st === 'reply' ? 'stack' : ''}">${acts}</footer>
  </div></article>`;
}

function workCard(x) {
  const st = statusOf(x);
  const label = x.phase === 'starting' ? 'Starting' : x.phase === 'thinking' ? 'Thinking' : x.phase === 'writing' ? 'Writing' : x.source === 'terminal' ? 'Working in a terminal' : 'Working';
  const since = x.turnStartedAt || x.lastEventAt;
  const step = x.phase === 'tool' && (x.tool || x.detail) ? `<div class="o-step"><span class="v">${esc(VERB_NOW[x.tool] || 'Using')}</span><code>${esc(x.detail || x.tool || '')}</code></div>` : '';
  const said = plainMd(lastLine(x.lastText));
  const line = said ? `<p class="o-line">${esc(said)}</p>` : x.lastPrompt ? `<p class="o-line dim">You asked: ${esc(x.lastPrompt)}</p>` : '';
  return `<article class="omen ${st === 'working' ? 'working' : st}"><div class="omen-in">
    <header class="o-top"><span class="${x.source === 'app' ? 'ember-dot' : 'violet-dot'}" aria-hidden="true"></span>${esc(label)}<span class="o-time" data-since="${since || ''}"></span></header>
    <h3 class="o-title"><button data-a="open">${esc(x.title || 'New chat')}</button></h3>
    <p class="o-where">${whereOf(x)}</p>
    ${step}${line}
    <footer class="o-foot">${sparkSvg(x.spark)}<button class="btn quiet sm" data-a="open">${x.source === 'app' ? 'Open' : 'Watch'}</button></footer>
  </div></article>`;
}

function quietChip(x) {
  const st = statusOf(x);
  return `<button class="qchip" data-a="open" title="${esc(x.title || '')}"><span class="${st === 'ended' ? 'ash-dot' : x.source === 'app' ? 'ready-dot' : 'violet-dot'}" aria-hidden="true"></span><span class="qc-t">${esc(x.title || 'New chat')}</span><span class="qc-s">${st === 'ended' ? 'stopped' : x.source === 'terminal' ? 'terminal' : x.source === 'elsewhere' ? 'other app' : 'ready'}</span></button>`;
}

function headroomPick() {
  const a = current(); if (!a) return null;
  const room = acct => { const b = binding(usageOf(acct.id)); return b ? b.left : null; };
  const mine = room(a);
  let best = null;
  for (const o of S.accounts) {
    if (o.id === a.id || !canLaunch(o)) continue;
    const r = room(o); if (r === null) continue;
    if (!best || r > best.r) best = { a: o, r };
  }
  if (!best || mine === null) return null;
  return mine < 40 && best.r - mine >= 25 ? best : null;
}

// "Someone's Organization" is how a personal plan is named; call it that.
const orgLabel = a => (a.orgName ? (/['’]s Organi[sz]ation$/i.test(a.orgName) ? 'Personal' : a.orgName) : '');
function dialCard(a) {
  const u = usageOf(a.id);
  const cur = a.id === S.acct;
  const locked = !!(a.pinnedOrg || a.expectEmail);
  const blocked = locked && !a.lock.ok;
  return dialShell(a, u, cur, blocked, locked, usageDetail(u, a.signedIn, 'Sign in to see this account’s usage and reset times.'));
}
const fmtCredits = v => { const n = Number(v); return v === null || v === undefined || v === '' ? 'on' : isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v); };
function usageDetail(u, signedIn, signedOutText) {
  const d = u && u.data && u.data.available ? u.data : null;
  const win = (name, w) => {
    if (!w) return '';
    const l = leftOf(w);
    return `<li><span class="w-n">${name}</span><span class="w-v ${hot(l) ? 'hot' : ''}">${l}% left</span>
      <span class="w-bar"><i class="${hot(l) ? 'hot' : ''}" style="width:${Math.min(100, Math.max(0, w.used))}%"></i></span>
      <span class="w-r">${Math.round(w.used)}% used${w.resetsAt ? ` · resets <b>${esc(when(w.resetsAt))}</b>, <span data-until="${Date.parse(w.resetsAt)}">in ${esc(dur(Date.parse(w.resetsAt) - Date.now()))}</span>` : ''}</span></li>`;
  };
  let detail = '';
  if (d) {
    detail = `<ul class="win">${win('Five-hour window', d.fiveHour, SPAN.fiveHour)}${win('This week', d.week, SPAN.week)}</ul>`;
    const chips = d.models.filter(m => m.used !== null).map(m => { const l = leftOf(m); return `<span class="model ${hot(l) ? 'hot' : ''}" title="${esc(m.name)} weekly limit${m.resetsAt ? `, resets ${when(m.resetsAt)}` : ''}">${esc(m.name)} <b>${l}% left</b></span>`; });
    if (d.extra) chips.push(`<span class="model" title="Extra usage beyond your plan">${d.extra.credits !== undefined && d.extra.used === null ? `Credits <b>${esc(d.extra.unlimited ? 'unlimited' : fmtCredits(d.extra.credits))}</b>` : `Extra usage <b>${d.extra.used !== null ? `${Math.round(d.extra.used)}% of monthly cap` : 'on'}</b>`}</span>`);
    if (chips.length) detail += `<div class="models">${chips.join('')}</div>`;
    const pf = paceOf(d.fiveHour, SPAN.fiveHour), pw = paceOf(d.week, SPAN.week);
    const runs = [pf && pf.runsOut ? ['five-hour window', pf] : null, pw && pw.runsOut ? ['week', pw] : null].filter(Boolean).sort((x, y) => x[1].runsOut - y[1].runsOut)[0];
    if (runs) detail += `<p class="pace"><span class="glyph" aria-hidden="true">✦</span><span>At this pace the ${runs[0]} runs out around <b>${esc(when(new Date(runs[1].runsOut).toISOString()))}</b>, ${esc(dur(runs[1].early))} before it resets.</span></p>`;
    else if (pf && pf.projected !== undefined) detail += `<p class="pace calm"><span class="glyph" aria-hidden="true">✧</span><span>On pace: about ${pf.projected}% of this five-hour window used by the time it resets.</span></p>`;
  } else if (!signedIn) detail = `<p class="dc-msg">${esc(signedOutText)}</p>`;
  else if (u && u.data && !u.data.available) detail = `<p class="dc-msg">This sign-in doesn’t have plan limits to show (for example, an API key).</p>`;
  else if (u && u.error) detail = `<p class="dc-msg">${esc(u.error)}</p>`;
  else detail = `<p class="dc-msg">Checking usage…</p>`;
  return detail;
}
function dialShell(a, u, cur, blocked, locked, detail) {
  const acts = [];
  if (!cur) acts.push(`<button class="btn ${canLaunch(a) ? 'prime' : ''} sm" data-act="use" data-acct="${esc(a.id)}">Work as ${esc(a.name)}</button>`);
  acts.push(`<button class="btn sm ${a.signedIn ? '' : 'prime'}" data-act="${a.expectEmail && !a.lock.ok ? 'signin-direct' : 'signin'}" data-acct="${esc(a.id)}">${a.signedIn ? 'Switch sign-in' : 'Sign in'}</button>`);
  if (a.signedIn && a.lock.ok && !a.pinnedOrg) acts.push(`<button class="btn sm" data-act="lock" data-acct="${esc(a.id)}" title="Only open chats while it’s signed in to ${esc(orgLabel(a) || 'this plan')}">Lock to this plan</button>`);
  acts.push(`<button class="btn quiet sm" data-act="web" data-acct="${esc(a.id)}" title="Regular Claude chats for this account, in their own window">claude.ai</button>`);
  acts.push(`<span class="spacer"></span><button class="icon" data-act="acct-more" data-acct="${esc(a.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(a.name)}">${ICON.more}</button>`);

  const plan = a.signedIn && a.plan ? `<span class="tag ${a.kind === 'team' ? 'ghost' : ''}">${esc(a.plan)}</span>` : '';
  const org = a.signedIn && orgLabel(a) ? `<span class="eyebrow">${esc(orgLabel(a))}</span>` : '';
  const lockTitle = locked ? `Locked to ${[a.expectEmail, a.pinnedOrg && a.pinnedOrg.name].filter(Boolean).join(', ')}` : '';
  const checked = [u && u.at ? `Usage checked ${agoL(u.at)}` : '', a.verified ? `sign-in confirmed ${agoL(a.verifiedAt)}` : a.verifyError ? 'couldn’t confirm the sign-in' : ''].filter(Boolean).join(' · ');
  return `<article class="dial-card ${cur ? 'current' : ''} ${blocked ? 'blocked' : ''}" data-acct-card="${esc(a.id)}" style="--ring:${ringOf(a)}">
    <div class="dial-wrap">${dialSvg(u)}<div class="legend"><span><i class="l5"></i>5 hours</span><span><i class="lw"></i>week</span><span><i class="ln"></i>time passed</span></div></div>
    <div class="dc-body">
      <div class="dc-k">${plan}${org}</div>
      <h3 class="dc-name">${esc(a.name)}${locked ? `<span class="lock ${blocked ? 'bad' : ''}" title="${esc(lockTitle)}">${ICON.lock}<span class="sr">${esc(lockTitle)}</span></span>` : ''}</h3>
      <p class="dc-who">${a.signedIn ? esc(a.email || 'Signed in') : 'Not signed in'}${blocked ? ` · <span style="color:var(--ember)">${esc(a.lockMessage || 'blocked')}</span>` : ''}${!a.shared ? ' · some data isn’t shared yet (see Setup)' : ''}</p>
      ${detail}
      ${checked ? `<p class="dc-checked">${esc(checked)}</p>` : ''}
      <div class="dc-act">${acts.join('')}</div>
    </div>
  </article>`;
}

// Codex, shown beside the Claude accounts.
function codexCard(c = S.codex) {
  const u = usageOf(c.id);
  const ollama = c.kind === 'ollama', many = codexAccts().length > 1, on = many && S.codex && S.codex.id === c.id;
  const da = `data-acct="${esc(c.id)}"`;
  let detail, acts = [];
  if (c.installed === false) {
    detail = '<p class="dc-msg">Codex is OpenAI’s coding agent. Install it to work on these folders with your ChatGPT plan too, with pictures shown as Codex makes them.</p>';
    acts.push('<button class="btn prime sm" data-act="codex-install">Install Codex</button>');
  } else if (ollama && !c.signedIn) {
    detail = `<p class="dc-msg">${esc(c.error || 'Codex runs through the Ollama app on this computer, with cloud models from your ollama.com account.')}</p>`;
    acts.push(`<button class="btn prime sm" data-act="codex-check" ${da}>Check again</button>`);
    acts.push(`<button class="btn quiet sm" data-act="codex-signin" ${da}>ollama signin</button>`);
  } else if (!c.signedIn) {
    detail = c.signingIn ? '<p class="dc-msg">Finish signing in to ChatGPT (on OpenAI’s site) in your browser. This card updates by itself when you’re done.</p>'
      : `<p class="dc-msg">${c.error ? esc(c.error) : 'Codex uses your ChatGPT account (OpenAI), separate from your Claude accounts. Sign in to use its plan here.'}</p>`;
    acts.push(`<button class="btn prime sm" data-act="codex-signin" ${da}>${c.signingIn ? 'Open the sign-in page again' : 'Sign in with ChatGPT'}</button>`);
  } else if (ollama) {
    const models = (c.cloudModels || []).slice(0, 6);
    detail = `${c.error ? `<p class="dc-msg">${esc(c.error)}</p>` : ''}<p class="dc-msg">${models.length ? `Cloud models: ${models.map(m => `<code>${esc(m)}</code>`).join(' ')}` : 'No cloud models pulled yet. Pick one in the model picker, or run <code>ollama pull &lt;model&gt;:cloud</code>.'}</p><p class="dc-msg"><small>ollama.com shows its own usage limits; there’s no way to read them here.</small></p>`;
    acts.push(`<button class="btn prime sm" data-act="codex-new" ${da} aria-haspopup="menu" aria-expanded="false">New Ollama chat</button>`);
    acts.push(`<button class="btn quiet sm" data-act="web" ${da} title="Your ollama.com usage and settings">ollama.com</button>`);
  } else {
    detail = usageDetail(u, true, '');
    acts.push(`<button class="btn prime sm" data-act="codex-new" ${da} aria-haspopup="menu" aria-expanded="false">New Codex chat</button>`);
    acts.push(`<button class="btn quiet sm" data-act="usage" ${da} ${u && u.checking ? 'disabled' : ''}>${u && u.checking ? 'Checking…' : 'Check usage'}</button>`);
    acts.push(`<button class="btn quiet sm" data-act="web" ${da} title="Regular ChatGPT, in its own window">chatgpt.com</button>`);
  }
  acts.push(`<span class="spacer"></span><button class="icon" data-act="codex-more" ${da} aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(c.name)}">` + ICON.more + '</button>');
  const checked = [u && u.at ? `Usage checked ${agoL(u.at)}` : '', c.checkedAt ? `sign-in checked ${agoL(c.checkedAt)}` : ''].filter(Boolean).join(' · ');
  return `<article class="dial-card codex-card${on ? ' on' : ''}" style="--ring:${codexRing(c.id)}">
    <div class="dial-wrap">${dialSvg(c.signedIn && !ollama ? u : null)}<div class="legend"><span><i class="l5"></i>5 hours</span><span><i class="lw"></i>week</span><span><i class="ln"></i>time passed</span></div></div>
    <div class="dc-body">
      <div class="dc-k">${c.plan ? `<span class="tag codex">${esc(c.plan)}</span>` : ''}${on ? '<span class="tag gold">new Codex chats</span>' : ''}<span class="eyebrow">${ollama ? 'Ollama · through Codex' : 'OpenAI'}</span></div>
      <h3 class="dc-name">${esc(c.name || 'Codex')}</h3>
      <p class="dc-who">${c.signedIn ? esc(c.email || 'Signed in') : c.installed === false ? 'Not installed' : 'Not signed in'}</p>
      ${detail}
      ${checked ? `<p class="dc-checked">${esc(checked)}</p>` : ''}
      <div class="dc-act">${acts.join('')}</div>
    </div>
  </article>`;
}
// Signing Codex in to ChatGPT, in a small window that shows exactly where the sign-in happens.
async function codexSignIn(method = 'browser') {
  if (!$('cxdlg')) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="cxdlg" class="cxdlg" aria-labelledby="cxTitle"><div id="cxBody"></div></dialog>');
    $('cxdlg').addEventListener('click', wrap(async e => {
      const b = e.target.closest('[data-cx]');
      if (!b) { if (e.target === $('cxdlg')) $('cxdlg').close(); return; }
      if (b.dataset.cx === 'close') return $('cxdlg').close();
      if (b.dataset.cx === 'copy') { try { await navigator.clipboard.writeText(b.dataset.text); b.textContent = 'Copied'; setTimeout(() => { b.textContent = b.dataset.label; }, 1500); } catch { prompt('Copy this:', b.dataset.text); } return; }
      if (b.dataset.cx === 'code') return codexSignIn('code');
      if (b.dataset.cx === 'browser') return codexSignIn('browser');
    }));
    $('cxdlg').addEventListener('close', () => { if (S.codex && S.codex.signingIn && !S.codex.signedIn) api('/api/codex/login-cancel', { account: S.codex.id }).catch(() => {}); });
  }
  const who = esc((S.codex && S.codex.name) || 'Codex');
  $('cxBody').innerHTML = `<h3 id="cxTitle">Sign in to ${who}</h3><p class="loading">Asking Codex for the ChatGPT sign-in page…</p>`;
  if (!$('cxdlg').open) $('cxdlg').showModal();
  let r;
  try { r = await api('/api/codex/login', { method, account: S.codex && S.codex.id }); }
  catch (err) { $('cxBody').innerHTML = `<h3 id="cxTitle">Sign in to ${who}</h3><p class="cx-err">${esc(err.message)}</p><div class="d-row"><button class="btn" data-cx="close">Close</button></div>`; return; }
  if (r.ollama) { $('cxBody').innerHTML = `<h3 id="cxTitle">Sign in to Ollama</h3><p>Finish <code>ollama signin</code> in the ${esc(r.how || 'terminal')} that just opened, then click <b>Check again</b> on the ${who} card.</p><div class="d-row"><button class="btn" data-cx="close">Close</button></div>`; return; }
  S.codexAuthUrl = r.authUrl || r.verificationUrl;
  const head = `<h3 id="cxTitle">Sign in to ${who}</h3><p>Codex uses your <b>ChatGPT</b> account, not Claude. The sign-in happens on OpenAI’s site${codexAccts().length > 1 ? `. Sign in with the ChatGPT account <b>${who}</b> should use; with an account switcher in your browser, switch to it first, or copy the link into a private window` : ''}:</p>`;
  if (r.type === 'chatgptDeviceCode') {
    $('cxBody').innerHTML = `${head}
      <p class="cx-host"><span class="glyph" aria-hidden="true">✦</span>${esc(r.host)}</p>
      <ol class="cx-steps"><li>Open the page below and sign in to ChatGPT.</li><li>Enter this code:</li></ol>
      <p class="cx-code">${esc(r.userCode)}</p>
      <div class="d-row cx-row"><a class="btn prime" href="${esc(r.verificationUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(r.host)}</a><button class="btn" data-cx="copy" data-text="${esc(r.userCode)}" data-label="Copy code">Copy code</button></div>
      <p class="cx-wait" id="cxWait"><span class="gen-spin" aria-hidden="true"></span>Waiting for you to finish. This closes by itself.</p>
      <p class="cx-alt"><button class="linkish" data-cx="browser">Sign in with a link instead</button></p>`;
  } else {
    $('cxBody').innerHTML = `${head}
      <p class="cx-host"><span class="glyph" aria-hidden="true">✦</span>${esc(r.host)}</p>
      <div class="d-row cx-row"><a class="btn prime" href="${esc(r.authUrl)}" target="_blank" rel="noopener noreferrer">Open the ChatGPT sign-in page</a><button class="btn" data-cx="copy" data-text="${esc(r.authUrl)}" data-label="Copy link">Copy link</button></div>
      <p class="cx-note">If your browser is already signed in to a different ChatGPT account, copy the link into a private window instead.</p>
      <p class="cx-wait" id="cxWait"><span class="gen-spin" aria-hidden="true"></span>Waiting for you to finish. This closes by itself.</p>
      <p class="cx-alt"><button class="linkish" data-cx="code">Use a code instead</button> (works from any browser or device)</p>`;
  }
  await loadState(); renderLive();
}
// Called when the sign-in state changes, to close the sign-in window once Codex is signed in.
function codexLoginProgress() {
  const d = $('cxdlg');
  if (!d || !d.open || !S.codex) return;
  if (S.codex.signedIn) {
    $('cxBody').innerHTML = `<h3 id="cxTitle">Codex is signed in</h3><p>Signed in${S.codex.email ? ` as <b>${esc(S.codex.email)}</b>` : ''}${S.codex.plan ? ` (${esc(S.codex.plan)})` : ''}. Your Codex chats and usage are on the hub now.</p><div class="d-row"><button class="btn prime" data-cx="close">Done</button></div>`;
    setTimeout(() => { if (d.open && S.codex.signedIn) d.close(); }, 4000);
  } else if (!S.codex.signingIn && S.codex.error && $('cxWait')) {
    $('cxWait').innerHTML = `<span class="cx-err">${esc(S.codex.error)}</span> <button class="linkish" data-cx="browser">Try again</button>`;
  }
}
async function codexInstall() {
  const r = await api('/api/codex/install', {});
  if (r.dryRun) return toast(`Would open a terminal:\n${r.script}`, 9000);
  return toast(`Installing Codex in a ${r.how}. When it finishes, click ⋯ → Check again on the Codex card.`, 10000);
}
// Pick the folder a new Codex chat works in.
function codexNewMenu(anchor) {
  const folders = S.projects.filter(p => p.exists).slice(0, 14);
  if (!folders.length) return toast('There are no folders yet. Open a folder in Claude Code or Codex once and it appears here.');
  showMenu(anchor, folders.map(p => ({ label: p.name, hint: p.cwd, run: () => ChatUI.open({ cwd: p.cwd, mode: 'new', provider: 'codex' }) })));
}
async function addCodexAccount(kind) {
  const name = (prompt(kind === 'ollama' ? 'Name for the Ollama account:' : 'Name for this Codex account (for example “Work” or “Personal”):', kind === 'ollama' ? 'Ollama' : '') || '').trim();
  if (!name) return;
  const r = await api('/api/codex/accounts', { name, kind });
  S.codex = r.codex; renderAll();
  if (kind === 'ollama') toast(S.codex.signedIn ? `Added ${name}. New Codex chats now run through Ollama.` : `Added ${name}. Start the Ollama app, then click Check again on its card.`, 6000);
  else codexSignIn();
}
function codexMenu(anchor) {
  const c = S.codex || {};
  const extra = !c.main && c.id !== 'codex';
  showMenu(anchor, [
    { label: 'Check again', hint: 'sign-in, usage and chats', run: async () => { const r = await api('/api/codex/check', {}); S.codex = r.codex; S.usage = r.usage || S.usage; renderAll(); toast('Checked Codex.', 2000); } },
    ...(S.codexAuthUrl && !c.signedIn ? [{ label: 'Copy the sign-in link', hint: 'for a private browser window', run: async () => { try { await navigator.clipboard.writeText(S.codexAuthUrl); toast('Copied.', 1500); } catch { prompt('Copy this link:', S.codexAuthUrl); } } }] : []),
    ...(c.signedIn && c.kind !== 'ollama' ? [{ label: 'Open chatgpt.com', hint: 'regular ChatGPT, in its own window', run: () => openWeb(c.id) }, { label: `Sign out of ${c.name || 'Codex'}`, run: async () => { if (!(await appConfirm(`Sign ${c.name || 'Codex'} out of its ChatGPT account?\n\nYour Codex chats stay on this computer.`, { ok: 'Sign out', danger: true }))) return; await api('/api/codex/logout', { account: c.id }); await reload(); toast(`${c.name || 'Codex'} is signed out.`); } }] : []),
    '-',
    { label: 'Add another Codex account', hint: 'a second ChatGPT sign-in; chats stay shared', run: () => addCodexAccount('chatgpt') },
    ...(codexAccts().some(x => x.kind === 'ollama') ? [] : [{ label: 'Add Ollama', hint: 'Codex with ollama.com cloud models', run: () => addCodexAccount('ollama') }]),
    ...(extra ? [
      { label: 'Rename…', run: async () => { const n = (prompt('New name:', c.name) || '').trim(); if (!n || n === c.name) return; const r = await api('/api/codex/accounts/rename', { id: c.id, name: n }); S.codex = r.codex; renderAll(); } },
      { label: 'Remove from the list', hint: 'its sign-in folder stays', run: async () => { if (!(await appConfirm(`Remove ${c.name} from Session Switcher?\n\nIts chats stay. Its sign-in stays in ~/.${c.id} if you add it again.`, { ok: 'Remove', danger: true }))) return; const r = await api('/api/codex/accounts/remove', { id: c.id }); S.codex = r.codex; renderAll(); } },
    ] : []),
    '-',
    { label: 'Turn Codex off', hint: 'hides it everywhere; turn it back on in Setup', run: async () => { await api('/api/codex/settings', { enabled: false }); await reload(); toast('Codex is off. Turn it back on in Setup.'); } },
  ]);
}

function rowHtml(s, folderName, hit) {
  const a = current(); const cx = isCodex(s);
  const ok = cx ? codexReady() : canLaunch(a);
  const why = cx ? (S.codex && S.codex.installed === false ? 'Install Codex first (Setup)' : 'Sign in to Codex first') : !a.signedIn ? `Sign in to ${a.name} first` : !a.lock.ok ? (a.lockMessage || 'Not on its locked account') : '';
  const sub = s.lastPrompt ? `You last asked: ${s.lastPrompt}` : (s.title !== s.firstPrompt ? `Started with: ${s.firstPrompt}` : '');
  const live = liveOf(s.id);
  const run = !live && isRunning(s.id);
  const flags = (isFav(s.id) ? '<span class="r-fav" title="Pinned to the sidebar">★</span>' : '') + (cx ? '<span class="tag codex">Codex</span>' : '') + (live ? `<span class="tag line">In the window${!cx && live.accountId !== a.id ? ` as ${esc(live.accountName)}` : ''}</span>`
    : run ? '<span class="tag violet">In a terminal</span>' : (s.active ? '<span class="tag ghost">Just updated</span>' : ''));
  const primary = live ? `<button class="btn sm" data-chat="${esc(s.id)}" title="Go back to this chat">Return</button>`
    : run ? `<button class="btn sm" data-watch="${esc(s.id)}" title="Read it live here while it runs in its terminal">Watch</button>`
    : inApp() ? `<button class="btn sm" data-chat="${esc(s.id)}" ${ok ? '' : `disabled title="${esc(why)}"`}>Open</button>`
    : `<button class="btn sm" data-open="${esc(s.id)}" ${ok ? '' : `disabled title="${esc(why)}"`}>Resume</button>`;
  const opened = s.lastOpened ? `<span class="r-as" style="--ring:${ringById(s.lastOpened.account)}" title="Last opened from here as ${esc(s.lastOpened.accountName)}, ${esc(agoL(s.lastOpened.at))}"><i></i>as ${esc(s.lastOpened.accountName)}</span>` : '';
  return `<li class="row ${S.drawerId === s.id ? 'current' : ''}" data-row="${esc(s.id)}">
    <div class="r-when"><span class="r-ago">${esc(ago(s.updated))}</span><span class="r-date">${esc(stamp(s.updated))}</span>${opened}</div>
    <div class="r-what">
      <button class="r-title" data-preview="${esc(s.id)}" title="Details and latest messages">${hit ? highlight(s.title, S.q) : esc(s.title)}</button>${flags ? `<span class="r-flags">${flags}</span>` : ''}
      ${hit && hit.snippet ? `<p class="r-snip">${highlight(hit.snippet, S.q)}</p>` : (sub ? `<p class="r-sub">${esc(sub)}</p>` : '')}
      ${folderName ? `<span class="r-chip">${esc(folderName)}</span>` : ''}
    </div>
    <div class="r-go"><button class="icon" data-more="${esc(s.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(s.title)}">${ICON.more}</button>${primary}</div>
  </li>`;
}

function secHead(eyebrow, title, extra = '') {
  return `<div class="sec-h"><p class="eyebrow">✦ ${esc(eyebrow)}</p><h2>${esc(title)}</h2>${extra ? `<div class="sec-x">${extra}</div>` : ''}</div>`;
}

// The chats that were open in the app window when it last closed: reopen them in one click.
function reopenHtml() {
  const list = S.reopen || [];
  if (!list.length) return '';
  const n = list.length;
  return `<section class="reopen" aria-label="Chats from last time"><span class="glyph" aria-hidden="true">↻</span><div class="ro-in">
    <p><b>Pick up where you left off.</b> When Session Switcher closed, ${n === 1 ? 'this chat was' : `these ${n} chats were`} open in its window:</p>
    <ul>${list.slice(0, 8).map(c => `<li>${esc(c.title || 'A chat')}<small>${esc([c.folder, c.provider === 'codex' ? 'Codex' : c.accountName].filter(Boolean).join(' · '))}</small></li>`).join('')}${n > 8 ? `<li><small>and ${n - 8} more</small></li>` : ''}</ul>
    <div class="ro-b"><button class="btn prime" data-act="reopen">Reopen ${n === 1 ? 'it' : 'them'}</button><button class="btn quiet" data-act="reopen-no">Not now</button></div></div></section>`;
}
async function reopenChats(yes) {
  const r = await api('/api/reopen', { action: yes ? 'reopen' : 'dismiss' });
  S.reopen = [];
  if ($('reopenSlot')) $('reopenSlot').innerHTML = '';
  if (!yes) return;
  await loadSessions().catch(() => {});
  const n = r.reopened.length;
  toast(`${n ? `Reopened ${n} chat${n === 1 ? '' : 's'}; ${n === 1 ? 'it’s' : 'they’re'} in Running now.` : ''}${r.failed.length ? ` ${r.failed.length} couldn’t open: ${r.failed.map(f => `${f.title || 'a chat'} (${f.error})`).join('; ')}` : ''}`.trim(), r.failed.length ? 10000 : 5000);
}

function renderHub() {
  const better = headroomPick();
  const recent = allSessions().slice(0, 1);
  $('page').innerHTML = `
    <div id="heroSlot">${heroHtml()}</div>
    <div id="reopenSlot">${reopenHtml()}</div>
    <div id="guardSlot">${guardHtml()}</div>
    <section class="sec" id="secAwait">
      ${secHead('Your move', 'Awaiting you')}
      <div class="summons-grid" id="awaitList"></div>
    </section>
    <section class="sec" id="secWork">
      ${secHead('Right now', 'At work')}
      <div class="board" id="board"></div>
      <div class="quietrow" id="quietList"></div>
    </section>
    <section class="sec" id="secWorlds">${secHead('By folder', 'Your projects', '<button class="btn sm" data-act="project-new">New project</button>')}<div class="atlas ${S.atlasEntered ? '' : 'enter'}" id="atlas"></div></section>
    <section class="sec">
      ${secHead('Pick up where you left off', 'Recent chats', `<button class="btn quiet sm" data-view="recent">All recent chats</button>`)}
      ${recent.length ? '<ul class="rows" id="recentList"></ul>' : `<p class="empty-line">No chats yet. Start one with <button class="linkish" data-act="project-new">New project</button>, or open a folder in Claude Code once and its chats appear here.</p>`}
    </section>
    <section class="sec" id="secAccounts">
      ${secHead('Your plans', 'Accounts and usage', `<button class="btn quiet sm" data-act="usage-all">Check all</button>`)}
      ${better ? `<div class="headroom"><span><b>${esc(better.a.name)}</b> has the most room right now: ${better.r}% left. ${esc(current().name)} has ${binding(usageOf(current().id)).left}%.</span><button class="btn sm" data-act="use" data-acct="${esc(better.a.id)}">Work as ${esc(better.a.name)}</button></div>` : ''}
      <div class="dials" id="dials"></div>
    </section>
    ${S.dryRun ? '<p class="note">Preview mode: terminal buttons show what would run instead of opening one.</p>' : ''}`;
  renderHubLists();
  renderLive(true);
  if (!dialsDrawn && !renderHub.timer) renderHub.timer = setTimeout(() => { dialsDrawn = true; }, 2600);
}
// Recent chats and the index, patched in place when transcripts change.
function renderHubLists() {
  const list = $('recentList');
  if (list) patch(list, allSessions().sort((x, y) => y[0].updated - x[0].updated).slice(0, 8), ([s]) => s.id, ([s, p]) => rowHtml(s, p.name));
  const atlas = $('atlas');
  if (atlas) {
    patch(atlas, atlasItems(), x => (x.add ? '+new' : x.p.cwd), x => (x.add ? newProjectTile(x.i) : worldCard(x.p, x.i)));
    // The projects rise in, once, the first time the atlas scrolls into view. (Any part of it:
    // on a phone the single column is many screens tall, so a share of it can never be visible.)
    if (!S.atlasEntered && !atlas._io) {
      const done = () => { S.atlasEntered = true; atlas.classList.remove('enter', 'go'); };
      if (!motionOk() || !('IntersectionObserver' in window)) done();
      else {
        atlas._io = new IntersectionObserver(es => {
          if (!es.some(x => x.isIntersecting)) return;
          atlas._io.disconnect(); atlas.classList.add('go'); setTimeout(done, 1900);
        }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
        atlas._io.observe(atlas);
      }
    }
    ensureWorlds();
  }
}

/* ---------- projects: each folder, with its art, documents and pictures ---------- */
const imageSrc = (p, cwd) => `/api/image?${new URLSearchParams({ token: TOKEN, path: p, ...(cwd ? { cwd } : {}) })}`;
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
let worldsLoading = null;
const worldFetch = {};
function loadWorld(cwd, fresh) {
  if (worldFetch[cwd] && !fresh) return worldFetch[cwd];
  const pr = api(`/api/project/info?${new URLSearchParams({ cwd, ...(fresh ? { fresh: '1' } : {}) })}`)
    .then(w => { S.worlds[cwd] = { ...w, at: Date.now() }; return S.worlds[cwd]; })
    .finally(() => { if (worldFetch[cwd] === pr) delete worldFetch[cwd]; });
  worldFetch[cwd] = pr;
  return pr;
}
const worldStale = cwd => !S.worlds[cwd] || Date.now() - S.worlds[cwd].at > 5 * 60 * 1000;
// Fetches project details a few at a time, then refreshes whatever shows them.
function ensureWorlds() {
  if (worldsLoading) return;
  const want = S.projects.filter(p => p.exists !== false && worldStale(p.cwd)).map(p => p.cwd);
  if (!want.length) return;
  worldsLoading = (async () => {
    for (let i = 0; i < want.length; i += 3) await Promise.all(want.slice(i, i + 3).map(c => loadWorld(c).catch(() => null)));
  })().finally(() => { worldsLoading = null; if (S.view === 'hub' && $('atlas')) patch($('atlas'), atlasItems(), x => (x.add ? '+new' : x.p.cwd), x => (x.add ? newProjectTile(x.i) : worldCard(x.p, x.i))); });
}
const atlasItems = () => [...S.projects.map((p, i) => ({ p, i })), { add: true, i: S.projects.length }];
function newProjectTile(i) {
  return `<button class="world world-new" data-act="project-new" style="--i:${Math.min(i, 12)}"><span class="wn-plus" aria-hidden="true"></span><b>New project</b><span>Make a folder and start a chat in it, as any of your accounts.</span></button>`;
}
// A project without cover art gets a soft gradient of its own, drawn from its name.
const TINTS = ['#a5463f', '#d9bf74', '#a58be8', '#cf8274', '#8f7f6a'];
function worldArt(p, w, cls = '', lazy = true) {
  const banner = w && w.banner;
  if (banner) return `<img class="${cls}" src="${esc(imageSrc(banner, p.cwd))}" alt="" ${lazy ? 'loading="lazy" ' : ''}decoding="async">`;
  const h = hash(p.name), a = TINTS[h % TINTS.length], b = TINTS[(h >>> 5) % TINTS.length === h % TINTS.length ? (h + 1) % TINTS.length : (h >>> 5) % TINTS.length];
  return `<span class="w-glyph ${cls}" style="--a:${a};--b:${b};--x:${18 + (h >>> 9) % 50}%;--y:${10 + (h >>> 13) % 50}%" aria-hidden="true"><b>${esc(initial(p.name))}</b></span>`;
}
function worldCard(p, i) {
  const w = S.worlds[p.cwd];
  const nClaude = p.sessions.filter(x => !isCodex(x)).length, nCodex = p.sessions.length - nClaude;
  const latest = p.sessions[0];
  const today = midnight();
  const chatsToday = p.sessions.filter(x => x.updated >= today).length;
  const live = p.sessions.some(x => isRunning(x.id) || liveOf(x.id));
  const bits = [chatsToday ? plural(chatsToday, 'chat') : '', w && w.today.docs ? plural(w.today.docs, 'doc') : '', w && w.today.images ? plural(w.today.images, 'image') : ''].filter(Boolean);
  return `<article class="world ${live ? 'is-live' : ''}" style="--i:${Math.min(i, 12)}">
    <button class="w-art" data-world="${esc(p.cwd)}" aria-label="Open ${esc(p.name)}">${worldArt(p, w)}<span class="w-shade" aria-hidden="true"></span>
      <span class="w-title"><span class="w-name">${esc(p.name)}</span>${live ? '<span class="live-dot" title="A chat here is open right now"></span>' : ''}</span></button>
    <div class="w-body">
      <p class="w-today ${bits.length ? 'on' : ''}">${bits.length ? `<span class="glyph" aria-hidden="true">✦</span>Today: ${esc(bits.join(', '))}` : p.sessions.length ? 'Quiet today' : 'New project'}</p>
      ${latest ? `<p class="w-last"><button class="linkish" data-preview="${esc(latest.id)}" title="${esc(latest.title)}">${esc(latest.title)}</button><span>${esc(agoL(latest.updated))}</span></p>` : `<p class="w-last quiet">No chats yet${p.added && p.updated ? `. Added ${esc(agoL(p.updated))}` : ''}.</p>`}
      <div class="w-act">
        ${latest && p.exists ? `<button class="btn sm" data-continue="${esc(latest.id)}">Continue</button>` : ''}
        <button class="btn quiet sm" data-act="world-new" data-cwd="${esc(p.cwd)}" aria-haspopup="menu" aria-expanded="false" ${p.exists ? '' : 'disabled'}>New chat</button>
        ${p.sessions.length ? `<span class="w-counts" title="${nClaude} Claude Code chats${nCodex ? `, ${nCodex} Codex chats` : ''}">${nClaude ? `<span class="pc claude">${nClaude}</span>` : ''}${nCodex ? `<span class="pc codex">${nCodex}</span>` : ''}</span>` : ''}
      </div>
    </div>
  </article>`;
}
// New chat in a project: Claude or Codex, plain or starting from a saved prompt.
function worldNewItems(cwd) {
  const p = S.projects.find(x => x.cwd === cwd); if (!p) return [];
  const a = current();
  return [
    { label: `New Claude chat`, hint: `as ${a.name}`, disabled: !canLaunch(a), why: a.lockMessage || 'Sign in first', run: () => ChatUI.open({ cwd, mode: 'new' }) },
    ...(S.codex && S.codex.enabled ? [{ label: 'New Codex chat', hint: 'ChatGPT', disabled: !codexReady(), why: 'Sign in to Codex first', run: () => ChatUI.open({ cwd, mode: 'new', provider: 'codex' }) }] : []),
    '-',
    ...S.prompts.slice(0, 10).map(pr => ({ label: `Start with: ${pr.title}`, hint: pr.provider === 'codex' ? 'runs in Codex' : '', disabled: pr.provider === 'codex' ? !codexReady() : !canLaunch(a), run: () => startWithPrompt(cwd, pr) })),
    { label: 'Edit prompts…', run: openPromptEditor },
  ];
}
function worldNewMenu(anchor, cwd) { const items = worldNewItems(cwd); if (items && items.length) showMenu(anchor, items); }
