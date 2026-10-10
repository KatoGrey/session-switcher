'use strict';
/* The top bar, the sidebar, the hub and each project’s page. */

/* ---------- top bar ---------- */
function renderBar() {
  $('updPill').hidden = !S.update || !!window.REMOTE;
  renderRestartBar();
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
  const group = prov => keepOrder(`nav-${prov}`, S.projects.map(p => ({ p, list: p.sessions.filter(x => provOf(x) === prov) })).filter(x => x.list.length), x => [x.p.cwd.toLowerCase()]);
  const item = (x, prov) => {
    const live = x.list.some(c => isRunning(c.id) || liveOf(c.id));
    const here = S.projects.find(q => q.cwd === x.p.cwd)?.sessions || [];
    const firstProv = ['claude', 'codex', 'openclaw'].find(v => here.some(c => provOf(c) === v)) || 'claude';
    const cur = S.view === 'folder' && S.folder === x.p.cwd && (S.prov ? S.prov === prov : !S.pins.has(x.p.cwd) && prov === firstProv);
    return `<button class="nav-i ${prov}" data-view="folder" data-cwd="${esc(x.p.cwd)}" data-prov="${prov}" aria-current="${cur}">
      ${crestHtml(x.p, 20, 'ni-crest')}<span class="ni-t">${esc(x.p.name)}</span>
      ${live ? '<span class="live-dot" title="A chat here is open right now"></span>' : ''}<span class="count">${x.list.length}</span></button>`;
  };
  const claude = group('claude'), codexF = group('codex'), ocF = group('openclaw');
  // Pinned: projects and favorite chats, at the top.
  const pinnedP = [...S.pins].map(cwd => S.projects.find(p => p.cwd === cwd)).filter(Boolean);
  const pinnedC = [...S.favs].map(id => sessionById(id)).filter(([s2]) => s2);
  const chatDot = id => { const x = S.activity.find(y => y.sessionId && y.sessionId.toLowerCase() === id.toLowerCase()); if (!x) return ''; const st = statusOf(x); return NEEDS.has(st) || st === 'reply' ? '<span class="gilt-dot nav-dot" title="Waiting for you"></span>' : st === 'working' ? '<span class="ember-dot nav-dot" title="At work"></span>' : ''; };
  const fold = (id, label, count, cls = '') => `<button class="nav-h prov ${cls} fold" data-fold="${id}" aria-expanded="${!S.navFold.has(id)}"><span class="pmark" aria-hidden="true"></span>${label}<span class="count">${count}</span><span class="fold-c" aria-hidden="true">▾</span></button>`;
  const pinnedHtml = pinnedP.length || pinnedC.length ? `${fold('pinned', 'Pinned', pinnedP.length + pinnedC.length, 'pinned')}
    ${S.navFold.has('pinned') ? '' : pinnedP.map(p => `<button class="nav-i pin" data-view="folder" data-cwd="${esc(p.cwd)}" aria-current="${S.view === 'folder' && S.folder === p.cwd && !S.prov}"><span class="glyph" aria-hidden="true">★</span><span class="ni-t">${esc(p.name)}</span>${p.sessions.some(c => isRunning(c.id) || liveOf(c.id)) ? '<span class="live-dot"></span>' : ''}<span class="count">${p.sessions.length}</span></button>`).join('')
      + pinnedC.map(([c, p]) => `<button class="nav-i nav-chat ${provOf(c) === 'claude' ? '' : provOf(c)}" data-navchat="${esc(c.id)}" title="${esc(c.title)} · ${esc(p.name)}" aria-current="${!!(window.ChatUI && ChatUI.isOpen() && ChatUI.sessionId && ChatUI.sessionId() === c.id)}"><span class="glyph" aria-hidden="true">❝</span><span class="ni-t"><span class="nc-t">${esc(c.title)}</span><small>${esc(p.name)}${isCodex(c) ? ' · Codex' : isOpenClaw(c) ? ' · OpenClaw' : ''}</small></span>${chatDot(c.id)}</button>`).join('')}` : '';
  const nClaude = claude.reduce((n, x) => n + x.list.length, 0), nCodex = codexF.reduce((n, x) => n + x.list.length, 0), nOc = ocF.reduce((n, x) => n + x.list.length, 0);
  const showCodex = S.codex && S.codex.enabled;
  const fresh = S.projects.filter(p => !p.sessions.length);
  const blocked = a && (a.pinnedOrg || a.expectEmail) && !a.lock.ok;
  const html = `
    <button class="seal ${blocked ? 'blocked' : ''}" id="seal" aria-haspopup="menu" aria-expanded="false" title="Choose which account new chats open as">
      <span class="seal-mark" style="--ring:${a ? ringOf(a) : 'var(--ash)'}">${a ? miniDial(a.id, 44) : ''}<b>${esc(a ? initial(a.name) : '?')}</b></span>
      <span class="seal-t"><span class="seal-k">${blocked ? 'Blocked' : 'Working as'}</span><span class="seal-n">${esc(a ? a.name : 'No account')}</span><span class="seal-e">${esc(a && a.signedIn ? (a.email || 'Signed in') : 'Not signed in')}</span></span>
      <span class="seal-caret">${ICON.caret}</span>
    </button>
    <div class="nav-h">${esc(voice('Begin'))}</div>
    <button class="nav-i" data-view="hub" aria-current="${S.view === 'hub'}"><span class="glyph" aria-hidden="true">✦</span><span class="ni-t">${esc(voice('The hub'))}</span>${A ? `<span class="tag gilt">${A}</span>` : W ? `<span class="tag">${W}</span>` : ''}</button>
    <button class="nav-i" data-view="recent" aria-current="${S.view === 'recent'}"><span class="glyph" aria-hidden="true">✧</span><span class="ni-t">${esc(voice('Recent chats'))}</span><span class="count">${total}</span></button>
    <button class="nav-i" data-view="palette" aria-current="${S.view === 'search'}"><span class="glyph" aria-hidden="true">❝</span><span class="ni-t">${esc(voice('Search every chat'))}</span><span class="count">Ctrl K</span></button>
    <button class="nav-i nav-new" data-view="newproject"><span class="glyph" aria-hidden="true">+</span><span class="ni-t">New project</span></button>
    ${fresh.length ? `<div class="nav-h prov fresh"><span class="pmark" aria-hidden="true"></span>No chats yet<span class="count">${fresh.length}</span></div>${fresh.map(p => `<button class="nav-i" data-view="folder" data-cwd="${esc(p.cwd)}" aria-current="${S.view === 'folder' && S.folder === p.cwd}">${crestHtml(p, 20, 'ni-crest')}<span class="ni-t">${esc(p.name)}</span><span class="tag ghost">New</span></button>`).join('')}` : ''}
    ${pinnedHtml}
    ${fold('claude', 'Claude Code', nClaude, 'claude')}
    ${S.navFold.has('claude') ? '' : claude.length ? claude.map(x => item(x, 'claude')).join('') : '<p class="nav-empty">No Claude Code chats yet.</p>'}
    ${showCodex ? `${fold('codex', 'Codex', nCodex, 'codex')}
    ${S.navFold.has('codex') ? '' : codexF.length ? codexF.map(x => item(x, 'codex')).join('') : `<p class="nav-empty">${codexReady() ? 'No Codex chats yet. Start one with “New Codex chat” on the Codex card.' : 'Sign in on the Codex card to use Codex here.'}</p>`}` : ''}
    ${ocF.length ? `${fold('openclaw', 'OpenClaw', nOc, 'openclaw')}
    ${S.navFold.has('openclaw') ? '' : ocF.map(x => item(x, 'openclaw')).join('')}` : ''}
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
  const N = A.filter(x => NEEDS.has(ownStatus(x))).length, R = A.length - N;
  const Q = quietOpen().filter(x => x.source === 'app' && x.phase !== 'ended').length;
  let h, em;
  if (A.length) {
    h = voice(A.length === 1 ? '{n} chat awaits you.' : '{n} chats await you.', { n: nword(A.length) });
    const parts = [];
    if (N) parts.push(N === 1 ? 'one needs your OK' : `${nword(N, false)} need your OK`);
    if (R) parts.push(R === 1 ? 'one has replied' : `${nword(R, false)} have replied`);
    if (W) parts.push(W === 1 ? 'one is still at work' : `${nword(W, false)} are still at work`);
    em = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.` : `${parts[0]}.`;
    em = em[0].toUpperCase() + em.slice(1);
  } else if (W) { h = voice(W === 1 ? '{n} chat at work.' : '{n} chats at work.', { n: nword(W) }); em = voice('Nothing needs you yet.'); }
  else { h = voice('All quiet.'); em = Q ? (Q === 1 ? 'One chat is open and ready.' : `${nword(Q)} chats are open and ready.`) : voice('Pick up any chat below.'); }

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
  const latest = allSessions().filter(([x]) => !isOpenClaw(x)).sort((x, y) => y[0].updated - x[0].updated)[0];
  const better = headroomPick();
  const acts = [];
  if (first) acts.push(`<button class="btn gilt" data-hero="first">${NEEDS.has(ownStatus(first)) ? 'Answer the first one' : 'Read the latest reply'}</button>`);
  if (better) acts.push(`<button class="btn" data-hero="switch" data-acct="${esc(better.a.id)}">Work as ${esc(better.a.name)}</button>`);
  if (!first && latest && canLaunch(a)) acts.push(`<button class="btn" data-hero="latest" data-sid="${esc(latest[0].id)}" title="${esc(latest[0].title)}">Continue “${esc(latest[0].title.length > 34 ? `${latest[0].title.slice(0, 33)}…` : latest[0].title)}”</button>`);
  const today = new Date();
  return `<section class="hero" aria-label="Right now">
    <svg class="hero-sigil" aria-hidden="true"><use href="#sigil"/></svg>${heroArt({ N, R, W, Q })}
    <div class="hero-in">
      <div>
        <p class="eyebrow">${voice('@where') !== '@where' ? `${esc(voice('@where'))} · ` : ''}${esc(today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} · <span data-clock>${esc(clock(today))}</span></p>
        <h1>${esc(h)}<em>${esc(em)}</em></h1>
        ${say ? `<p>${say}</p>` : ''}
        ${acts.length ? `<div class="hero-act">${acts.join('')}</div>` : ''}
      </div>
      ${a ? `<div class="stamp">${esc(voice('Working as'))}<b>${esc(a.name)}</b>${a.plan ? esc(a.plan) : ''}</div>` : ''}
    </div>
  </section>`;
}

// A saga theme's display in the hero, drawn from the same counts as the headline.
function heroArt({ N, R, W, Q }) {
  const art = Look.theme().art;
  if (art === 'painting' && window.ThemeStudio) return ThemeStudio.scene({ N, R, W, Q });
  const pad = n => String(n).padStart(2, '0');
  if (art === 'console') {
    // A bridge console: a wall of light panels, three readouts and a row of signal lamps (red: needs
    // your OK, white: replied, green: at work).
    const lamps = Array.from({ length: 18 }, (_, i) => `<i class="${i < N ? 'red' : i < N + R ? 'white' : i < N + R + W ? 'green' : ''}"></i>`).join('');
    return `<div class="hero-art console" aria-hidden="true"><div class="ha-wall"></div>
      <div class="ha-read"><span class="${N ? 'hot' : ''}"><b>${pad(N)}</b>Orders</span><span><b>${pad(R)}</b>Reports</span><span><b>${pad(W)}</b>Engaged</span></div>
      <div class="ha-lamps">${lamps}</div></div>`;
  }
  if (art === 'trench') {
    // A targeting computer: the run down the trench, with the board's counts as its readout.
    return `<div class="hero-art trench" aria-hidden="true"><div class="ha-view"><div class="ha-floor"></div><div class="ha-wall l"></div><div class="ha-wall r"></div><i class="ha-reticle"></i></div>
      <div class="ha-read"><span class="${N + R ? 'hot' : ''}">Waiting<b>${pad(N + R)}</b></span><span>In flight<b>${pad(W)}</b></span><span>Standing by<b>${pad(Q)}</b></span></div></div>`;
  }
  if (art === 'sunset') {
    // Malibu: a striped sun setting into the sea between two palms. Hearts in the sky are chats
    // waiting on you (gold: it needs your OK), twinkles are chats at work, pool floats are ones lounging.
    const HEARTS = [[132, 58, 15], [176, 30, 12], [238, 44, 14], [284, 74, 11], [98, 92, 12], [212, 18, 10], [158, 88, 10]];
    const TWINKLES = [[86, 40], [254, 100], [190, 66], [302, 30], [112, 22], [226, 122]];
    const FLOATS = [[148, 204], [252, 216], [104, 224]];
    const heart = (x, y, s, cls, i) => `<g transform="translate(${x} ${y}) scale(${(s / 24).toFixed(3)})"><path class="mb-float ${cls}" style="--d:${(i * 0.45).toFixed(2)}s" d="M12 21.5C5 16.6 1 12.7 1 7.6 1 4 3.8 1.2 7.2 1.2c2 0 3.8 1 4.8 2.6 1-1.6 2.8-2.6 4.8-2.6C20.2 1.2 23 4 23 7.6c0 5.1-4 9-11 13.9z"/></g>`;
    const twinkle = ([x, y], i) => `<path class="mb-twinkle" style="--d:${(i * 0.6).toFixed(2)}s;transform-origin:${x}px ${y}px" d="M${x} ${y - 7}l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2-5.2-1.8 5.2-1.8z"/>`;
    const float = ([x, y], i) => `<g class="mb-bob" style="--d:${(i * 0.8).toFixed(2)}s"><ellipse cx="${x}" cy="${y}" rx="14" ry="4.6" class="mb-ring"/><ellipse cx="${x}" cy="${y}" rx="14" ry="4.6" class="mb-ring-s"/></g>`;
    const hearts = Array.from({ length: Math.min(N + R, HEARTS.length) }, (_, i) => heart(...HEARTS[i], i < N ? 'gold' : 'pink', i)).join('');
    return `<div class="hero-art sunset" aria-hidden="true"><svg class="mb-scene" viewBox="0 0 400 240" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="mbSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="mb-sky1"/><stop offset=".62" class="mb-sky2"/><stop offset="1" class="mb-sky3"/></linearGradient>
        <linearGradient id="mbSun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="mb-sun1"/><stop offset="1" class="mb-sun2"/></linearGradient>
        <linearGradient id="mbSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="mb-sea1"/><stop offset="1" class="mb-sea2"/></linearGradient>
        <mask id="mbStripes"><rect width="400" height="240" fill="#fff"/><rect x="0" y="122" width="400" height="2.5" fill="#000"/><rect x="0" y="134" width="400" height="3.5" fill="#000"/><rect x="0" y="146" width="400" height="4.5" fill="#000"/><rect x="0" y="158" width="400" height="5.5" fill="#000"/></mask>
        <clipPath id="mbAbove"><rect width="400" height="168"/></clipPath>
        <g id="mbPalm"><path d="M346 240C344 190 336 130 326 76l6-1c11 53 20 113 26 165z"/><path d="M329 74c-29-14-54-8-71 12 24-12 46-14 71-8zM329 74c27-16 53-10 69 12-24-12-46-14-69-8zM329 74c-15-26-33-34-53-32 22 8 38 18 51 34zM329 74c13-28 31-36 51-34-20 10-36 20-49 36zM329 76c-17 6-29 22-33 40 10-16 20-28 35-37zM329 76c19 8 31 24 33 44-10-18-20-30-34-40z"/><circle cx="326" cy="81" r="3.6"/><circle cx="333.5" cy="82" r="3.6"/></g>
      </defs>
      <rect width="400" height="240" fill="url(#mbSky)"/>
      <g class="mb-sparkles">${TWINKLES.slice(0, Math.min(W, TWINKLES.length)).map(twinkle).join('')}</g>
      <circle cx="200" cy="150" r="62" fill="url(#mbSun)" mask="url(#mbStripes)" clip-path="url(#mbAbove)"/>
      <rect y="168" width="400" height="72" fill="url(#mbSea)"/>
      <g class="mb-glint"><rect x="152" y="174" width="96" height="3" rx="1.5"/><rect x="166" y="184" width="68" height="3" rx="1.5"/><rect x="178" y="194" width="44" height="3" rx="1.5"/><rect x="190" y="204" width="20" height="3" rx="1.5"/></g>
      <path class="mb-wave" d="M-40 180q10-4 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0M-40 214q10-4 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0"/>
      ${FLOATS.slice(0, Math.min(Q, FLOATS.length)).map(float).join('')}
      <g class="mb-palms"><use href="#mbPalm" transform="translate(-30 0)"/><use href="#mbPalm" transform="translate(50 62) scale(-.72 .74) translate(-400 0)"/></g>
      <g class="mb-hearts">${hearts}</g>
    </svg>
      <div class="ha-read"><span class="${N + R ? 'hot' : ''}"><b>${pad(N + R)}</b>For you</span><span><b>${pad(W)}</b>On it</span><span><b>${pad(Q)}</b>Chilling</span></div></div>`;
  }
  if (art === 'status') return isekaiArt({ N, R, W, Q });
  if (art === 'citadel') return citadelArt({ N, R, W, Q });
  if (art === 'delve') return delveArt({ N, R, W, Q });
  return '';
}

/* ---------- the anime themes' scenes ----------
   Each is an SVG (400 × 240, cropped to fit) that reads the same counts as the headline: N need your
   OK, R have replied, W are at work, Q are open and idle. A theme can bring paintings (art/<name>.webp,
   one per mode; made by Codex; their prompts are in art/painting-prompts.json): a painting takes the
   place of the drawn scenery inside the same SVG, so it scales and crops exactly as the live parts on
   top of it do. A painting is 3:2, so it spans y -13.3 to 253.3 in the same units, and the whole of it
   is in view. Where the live parts sit on each painting is in PAINT_SPOTS. Until a painting has
   loaded, or without one, the scenery is drawn. Anything that moves only moves when motion is on. */
const sparks = (seed, n, box) => { const r = seeded(seed); return Array.from({ length: n }, () => [Math.round(box[0] + r() * (box[2] - box[0])), Math.round(box[1] + r() * (box[3] - box[1])), +(0.5 + r() * 1.1).toFixed(2), +(r() * 4).toFixed(2)]); };
// Stars in three groups that twinkle in turn (three animations, not one per star).
const starsSvg = (seed, n, box, cls = 'an-star') => {
  const g = [[], [], []];
  sparks(seed, n, box).forEach(([x, y, s], i) => g[i % 3].push(`<circle class="${cls}" cx="${x}" cy="${y}" r="${s}"/>`));
  return g.map((list, i) => `<g class="an-stars-g" style="--d:${(i * 1.2).toFixed(1)}s">${list.join('')}</g>`).join('');
};
const pad2 = n => String(n).padStart(2, '0');

// Where the live parts sit on each painting, in the scene's units (measured by Codex on the paintings).
const PAINT_ISEKAI = { circle: [249.7, 119.2, 52.1, 0.16], crystals: [[209.6, 96.3], [227.3, 89.5], [245.8, 95.5], [197.7, 103.3], [263.8, 103.6], [236.5, 77]] };
const PAINT_CITADEL = {
    // windows as boxes [x, y, width, height]: the keep's middle one first, then the towers'
    windows: [[258.3, 79.4, 1.6, 13], [217.4, 94.7, 3.6, 7.3], [318.2, 97.1, 3.6, 7], [254.9, 81.7, 1.6, 11.2], [261.7, 81.7, 1.6, 11.2], [217.4, 107.5, 3.6, 7.6], [318.2, 109.6, 3.6, 7.3], [217.4, 120.5, 3.6, 7.6], [318.2, 122.1, 3.6, 7.3]],
    // beacons [x, rim y, size]: the terrace braziers first, then the outposts down the valley
    beacons: [[238.3, 131.5, 1.39], [274.2, 131.5, 1.39], [193.5, 130.4, 1.11], [282.6, 156.2, 1.56], [320.3, 159.3, 1.25], [157, 153.6, 1.42]],
    dragon: [154.2, 47.2, 0.4],
  };
const PAINT_SPOTS = {
  'isekai-dark': PAINT_ISEKAI, 'isekai-light': PAINT_ISEKAI,
  'highfantasy-dark': PAINT_CITADEL, 'highfantasy-light': PAINT_CITADEL,
  'dungeon-dark': {
    torches: [[157.6, 97.5, 1.05], [326.3, 97.5, 1.05], [209.4, 122.8, 0.48], [270.6, 122.8, 0.48]],
    eyes: [[234.4, 111.7], [249, 119.7], [239.3, 131.7], [251.8, 143.4], [229.4, 149.7], [245.3, 155.4]],
    chests: [[144.5, 197.6, 0.85], [165.1, 200.7, 0.68]],
  },
};
const Paint = { ready: new Set(), asked: new Set(), fresh: null };
// The theme's painting for this mode, once it has loaded (it's fetched the first time it's wanted, and
// the hero redraws with it then).
function paintFor() {
  const p = Look.theme().paint; if (!p) return null;
  const name = (Look.isLight() && p.light) || p.dark; if (!name) return null;
  const url = `/art/${name}.webp`;
  if (Paint.ready.has(url)) return { name, url, spots: PAINT_SPOTS[name] || {} };
  if (!Paint.asked.has(url)) {
    Paint.asked.add(url);
    const im = new Image();
    im.onload = () => { Paint.ready.add(url); Paint.fresh = url; if (S.view === 'hub') renderLive(true); };
    im.src = url;
  }
  return null;
}
// The painting itself; it fades in the first time it appears.
function paintSvg(P) {
  const fresh = Paint.fresh === P.url; if (fresh) Paint.fresh = null;
  return `<image class="an-paint${fresh ? ' fresh' : ''}" href="${P.url}" y="-13.333" width="400" height="266.667"/>`;
}
// The scene's SVG: a painting is shown whole (it's a little taller than the drawn scenery).
const sceneSvg = (P, anchor = 'xMidYMid') => `<svg class="an-scene" viewBox="${P ? '0 -13.333 400 266.667' : '0 0 400 240'}" preserveAspectRatio="${P ? 'xMidYMid' : anchor} slice">`;
// A scene's three counts, each with a plain word for what it counts.
function sceneRead([need, work, idle], { N, R, W, Q }) {
  return `<div class="ha-read">${[[N + R, need, 'need you', 'hot'], [W, work, 'working', 'on'], [Q, idle, 'idle', '']].map(([n, l, s, c]) => `<span class="${n ? c : ''}"><b>${pad2(n)}</b><i>${l}<small>${s}</small></i></span>`).join('')}</div>`;
}

// Isekai: another world at twilight, two moons and floating islands over a sea of clouds. The magic
// circle on the island turns while chats are at work (mana rises from it); a crystal floats up for each
// chat waiting on you (gold: it needs your OK). The status window reads the account you work as: HP is
// what's left of its five-hour window, MP what's left of its week, its level every chat you've had.
function isekaiArt({ N, R, W, Q }) {
  const a = current(), u = a && usageOf(a.id), d = u && u.data && u.data.available ? u.data : null;
  const hp = d ? leftOf(d.fiveHour) : null, mp = d ? leftOf(d.week) : null;
  const plan = (a && a.plan) || '';
  const role = !a ? 'Wanderer' : /max/i.test(plan) ? 'Archmage' : /pro/i.test(plan) ? 'Mage' : /team|enterprise/i.test(plan) ? 'Guild mage' : 'Adventurer';
  const P = paintFor(), sp = P ? P.spots : {};
  const CRYSTALS = sp.crystals || [[96, 98], [146, 92], [72, 112], [170, 108], [120, 84], [52, 96]];
  const [cx, cy, cr, flat = 0.3] = sp.circle || [120, 136, 60], k = cr / 60;
  const crystal = ([x, y], i) => `<g class="ie-bob" style="--d:${(i * 0.7).toFixed(1)}s"><path class="ie-crystal${i < N ? ' gold' : ''}" d="M${x} ${y - 9}l5 9-5 9-5-9z"/><path class="ie-facet" d="M${x} ${y - 9}l2 9-2 9z"/></g>`;
  const motes = Array.from({ length: Math.min(W * 3, 12) }, (_, i) => `<circle class="ie-mote" cx="${(cx - 42 * k + ((i * 29) % 90) * k).toFixed(1)}" cy="${cy + 2 - (i % 3) * 3}" r="${(1.1 + (i % 3) * 0.45).toFixed(2)}" style="--d:${(i * 0.53).toFixed(2)}s"/>`).join('');
  const bar = (key, v) => `<div class="ie-bar ${key}${v !== null && v <= 20 ? ' low' : ''}"><span>${key.toUpperCase()}</span><i><b style="width:${v ?? 0}%"></b></i><em>${v === null ? '–' : `${v}%`}</em></div>`;
  const drawn = `<rect width="400" height="240" fill="url(#ieSky)"/>
    <g class="ie-stars">${starsSvg('ie-sky', 30, [8, 4, 396, 120])}</g>
    <circle cx="104" cy="54" r="64" fill="url(#ieHalo)"/>
    <circle cx="104" cy="54" r="25" fill="url(#ieMoon)"/>
    <g class="ie-crater"><circle cx="96" cy="47" r="4.2"/><circle cx="113" cy="62" r="3"/><circle cx="110" cy="44" r="1.8"/><circle cx="94" cy="62" r="2.2"/></g>
    <circle cx="172" cy="26" r="8.5" class="ie-moon-s"/>
    <path class="ie-cloud far" d="M0 176q16-10 34-4 12-12 30-6 16-12 34-2 14-10 30-2 16-12 36-4 14-8 30 0 16-12 34-4 16-10 32 0 18-10 36-2 16-10 34-2 20-8 40 0V240H0z"/>
    <g class="ie-isle"><path fill="url(#ieRock)" d="M232 54c8-4 34-4 42 0-3 5-8 7-11 14-3 6-6 12-9 22-3-9-6-15-10-20-5-6-10-10-12-16z"/><path class="ie-grass" d="M230 54c8-6 38-6 46 0-8 3-38 3-46 0z"/><path class="ie-tree" d="M262 52v-7m-4 0a4 4 0 1 1 8 0 4 4 0 1 1-8 0z"/></g>
    <g class="ie-isle"><path fill="url(#ieRock)" d="M62 148c18-7 100-7 118 0-6 7-12 10-18 20-8 14-18 30-34 58-8-20-18-34-30-46-12-12-28-20-36-32z"/><path class="ie-strata" d="M74 160c30 4 70 4 96-2M92 176c20 3 44 3 62-1"/><path class="ie-grass" d="M58 148c20-9 104-9 124 0-20 5-104 5-124 0z"/>
      <path class="ie-tower" d="M150 146v-26h9v26zM148 120l6.5-11 6.5 11z"/><rect class="ie-lamp" x="153" y="126" width="3" height="4" rx="1"/><path class="ie-tree" d="M80 146v-8"/><circle class="ie-tree-c" cx="80" cy="134" r="6"/><circle class="ie-tree-c" cx="88" cy="138" r="4.5"/></g>
    <path class="ie-fall" stroke="url(#ieFall)" d="M175 150c3 18 3 50 1 90"/><path class="ie-fall-s" d="M175 150c3 18 3 50 1 90"/>`;
  return `<div class="hero-art status${P ? ' painted' : ''}" aria-hidden="true">${sceneSvg(P)}
    <defs>
      <linearGradient id="ieSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ie-sky1"/><stop offset=".58" class="ie-sky2"/><stop offset="1" class="ie-sky3"/></linearGradient>
      <radialGradient id="ieMoon" cx=".38" cy=".34" r=".75"><stop offset="0" class="ie-moon1"/><stop offset="1" class="ie-moon2"/></radialGradient>
      <radialGradient id="ieHalo"><stop offset="0" class="ie-halo"/><stop offset="1" class="ie-halo0"/></radialGradient>
      <linearGradient id="ieFall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ie-fall1"/><stop offset="1" class="ie-fall0"/></linearGradient>
      <linearGradient id="ieRock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ie-rock1"/><stop offset="1" class="ie-rock2"/></linearGradient>
    </defs>
    ${P ? paintSvg(P) : drawn}
    <g transform="translate(${cx} ${cy}) scale(${k.toFixed(3)} ${(flat * k).toFixed(3)})"><g class="ie-circle${W ? ' on' : ''}">
      <circle r="60" vector-effect="non-scaling-stroke"/><circle r="52" class="thin" vector-effect="non-scaling-stroke"/><g class="ie-runes"><circle r="56" class="runes"/></g>
      <path vector-effect="non-scaling-stroke" d="M0-46L39.8 23H-39.8ZM0 46L39.8-23H-39.8Z"/></g></g>
    <g class="ie-motes">${motes}</g>
    <g class="ie-crystals">${CRYSTALS.slice(0, Math.min(N + R, CRYSTALS.length)).map(crystal).join('')}</g>
    ${P ? '' : '<path class="ie-cloud" d="M-10 214q18-14 38-4 14-14 34-4 18-12 38 0 16-10 32 0 20-14 40-2 16-10 34 0 18-12 36-2 18-10 36 2 18-12 36-2 20-10 40 2V240H-10z"/>'}
  </svg>
  <div class="ie-win"><div class="ie-h"><b>Status</b><span>${esc(a ? a.name : '')}</span></div>
    <div class="ie-lv"><span>Lv.</span><b>${levelOf(allSessions().length)}</b><em>${role}</em></div>
    ${bar('hp', hp)}${bar('mp', mp)}
    <div class="ie-sk">${[['Summons', N + R, 'need you', 'hot'], ['Casting', W, 'working', 'on'], ['Resting', Q, 'idle', '']].map(([l, n, s, c]) => `<span class="${n ? c : ''}"><em>${l}</em><b>${pad2(n)}</b><small>${s}</small></span>`).join('')}</div></div></div>`;
}
const levelOf = chats => Math.min(999, Math.max(1, chats));

// High Fantasy: a citadel on a cliff under a great moon, a dragon crossing it, beacons on the peaks. A
// window lights for each chat at work; a beacon burns for each chat waiting on you (gold: it needs your
// OK), the castle's own braziers first.
function citadelArt({ N, R, W, Q }) {
  const P = paintFor(), sp = P ? P.spots : {};
  const WINDOWS = sp.windows || [[258, 120], [252, 104], [264, 104], [228, 124], [292, 128], [252, 136], [264, 136], [228, 142], [292, 146]];
  const BEACONS = sp.beacons || [[240, 141], [278, 141], [198, 116], [330, 114], [86, 104], [142, 113]];
  const [dx, dy, ds] = sp.dragon || [112, 38, 0.62];
  // On a painting its windows are painted dark, so only the lit ones are drawn.
  // A window is [x, y] (drawn) or a box [x, y, width, height] (on a painting): an arch either way.
  const arch = (x, y, w, h) => `M${x} ${y + h}V${(y + w / 2).toFixed(2)}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}z`;
  const win = ([x, y, w, h], i) => (P && i >= W ? '' : `<path class="hf-win${i < W ? ' lit' : ''}" style="--d:${(i * 0.9).toFixed(1)}s" d="${w ? arch(x, y, w, h) : arch(x - 1.8, y, 3.6, 7)}"/>`);
  // A beacon is [x, y] or [x, rim y, size]; its flame stands on the bowl's rim.
  const beacon = ([x, y, k = 1], i) => `<g class="hf-beacon${i < N ? ' gold' : ''}" style="--d:${(i * 0.37).toFixed(2)}s" transform="translate(${x} ${y + (P ? 0 : -2)}) scale(${k})"><circle cy="-3" r="13" class="hf-bglow"/><path class="hf-flame" d="M0-8c3 3 3.6 5.6 1.6 8.2-.5-1.6-1.2-2.2-1.6-2.4-.4.2-1.1.8-1.6 2.4-2-2.6-1.4-5.2 1.6-8.2z"/>${P ? '' : '<path class="hf-brazier" d="M-3 0h6l-1.6 3h-2.8z"/>'}</g>`;
  const flies = sparks('hf-flies', 9, [36, 176, 200, 232]).map(([x, y, s, d]) => `<circle class="hf-fly" cx="${x}" cy="${y}" r="${(s * 0.9).toFixed(2)}" style="--d:${d}s"/>`).join('');
  const sky = `<rect width="400" height="240" fill="url(#hfSky)"/>
    <g class="hf-stars">${starsSvg('hf-sky', 34, [6, 4, 396, 110])}</g>
    <circle cx="150" cy="66" r="96" fill="url(#hfHalo)"/>
    <circle cx="150" cy="66" r="36" fill="url(#hfMoon)"/>
    <g class="hf-maria"><circle cx="140" cy="56" r="7"/><circle cx="160" cy="76" r="5"/><circle cx="156" cy="52" r="3"/><circle cx="136" cy="78" r="3.4"/></g>`;
  const land = `<path class="hf-mt farthest" d="M0 136L22 122 48 128 70 112 104 124 124 104 156 120 184 106 216 124 246 98 276 118 312 102 344 120 372 108 400 116V240H0z"/>
    <path class="hf-mt far" d="M0 150L30 130 52 140 86 106 112 130 142 115 170 136 198 118 232 140 262 112 298 134 330 116 362 138 400 124V240H0z"/>
    <path class="hf-snow" d="${[[86, 106], [142, 115], [198, 118], [262, 112], [330, 116]].map(([x, y]) => `M${x - 9} ${y + 8.6}L${x} ${y}L${x + 8.6} ${y + 7.6}L${x + 4.6} ${y + 6}L${x + 1.4} ${y + 9}L${x - 2.6} ${y + 6.2}Z`).join('')}"/>
    <path class="hf-mt mid" d="M0 182C34 164 66 172 98 160 128 150 158 172 188 164 200 162 206 168 212 172V240H0zM320 182C340 168 370 170 400 160V240H320z"/>
    <path class="hf-cliff" d="M196 240L204 198 212 180 220 168H304L312 178 318 198 326 240z"/>
    <path class="hf-crack" d="M232 178l-6 22 4 18M290 180l6 18-3 20M262 190l-2 30"/>
    <g class="hf-castle">
      <path d="M218 168v-22h4v-4h4v4h4v-4h4v4h4v-4h4v4h4v4h40v-4h4v4h4v-4h4v4h4v-4h4v4h2v22z"/>
      <path d="M220 168v-56h16v56zM216 112l12-20 12 20zM284 168v-52h16v52zM280 116l12-20 12 20zM246 168v-72h24v72zM242 96l16-30 16 30z"/>
      <path class="hf-roof" d="M216 112l12-20 12 20zM280 116l12-20 12 20zM242 96l16-30 16 30z"/>
      <path class="hf-gate" d="M253 168v-9a5 5 0 0 1 10 0v9z"/>
      <path class="hf-pole" d="M258 66V52"/><path class="hf-banner" d="M258 52.5l13 3.2-13 3.4z"/>
    </g>`;
  const dragon = `<g class="hf-dragon"><g transform="translate(${dx} ${dy}) scale(${ds})">
      <path class="far" d="M36 18L39 4 18 6Q22 10 24 12 27 11 29 14 32 13 34 17Z"/>
      <path d="M0 27C10 27 18 22 28 21 32 20 36 18 40 18L46 3 22 0Q26 6 28 9 31 7 33 11 36 9 38 14L44 17C50 16 54 12 60 10L62 5 64 10 72 11 76 14 68 16C62 17 58 20 54 22L52 26 49 23C44 25 38 25 32 24L30 28 28 24C20 26 10 29 0 27Z"/></g></g>`;
  return `<div class="hero-art citadel${P ? ' painted' : ''}" aria-hidden="true">${sceneSvg(P, 'xMidYMax')}
    <defs>
      <linearGradient id="hfSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hf-sky1"/><stop offset=".6" class="hf-sky2"/><stop offset="1" class="hf-sky3"/></linearGradient>
      <radialGradient id="hfHalo"><stop offset="0" class="hf-halo"/><stop offset=".5" class="hf-halo5"/><stop offset="1" class="hf-halo0"/></radialGradient>
      <radialGradient id="hfMoon" cx=".42" cy=".38" r=".7"><stop offset="0" class="hf-moon1"/><stop offset="1" class="hf-moon2"/></radialGradient>
      <linearGradient id="hfMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hf-mist0"/><stop offset="1" class="hf-mist1"/></linearGradient>
      <radialGradient id="hfGlow"><stop offset="0" class="hf-glow1"/><stop offset="1" class="hf-glow0"/></radialGradient>
      <radialGradient id="hfGlowG"><stop offset="0" class="hf-glowg1"/><stop offset="1" class="hf-glowg0"/></radialGradient>
      <linearGradient id="hfFlame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hf-fl1"/><stop offset=".55" class="hf-fl2"/><stop offset="1" class="hf-fl3"/></linearGradient>
      <linearGradient id="hfFlameG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hf-flg1"/><stop offset=".55" class="hf-flg2"/><stop offset="1" class="hf-flg3"/></linearGradient>
    </defs>
    ${P ? paintSvg(P) + dragon : sky + dragon + land}
    <g class="hf-wins">${WINDOWS.map(win).join('')}</g>
    <g class="hf-beacons">${BEACONS.slice(0, Math.min(N + R, BEACONS.length)).map(beacon).join('')}</g>
    ${P ? '' : '<path class="hf-fall" d="M316 192c2 14 2 30 3 48"/><path class="hf-fall s" d="M316 192c2 14 2 30 3 48"/><rect y="186" width="400" height="54" fill="url(#hfMist)"/>'}
    <g class="hf-flies">${flies}</g>
  </svg>
  ${sceneRead(['Heralds', 'Quests', 'At rest'], { N, R, W, Q })}</div>`;
}

// Dungeon: a torchlit archway into the dark. A torch burns for each chat at work, eyes open in the
// dark for each chat waiting on you (gold: it needs your OK), and a chest sits ready for each one
// open and idle.
function delveArt({ N, R, W, Q }) {
  const P = paintFor(), sp = P ? P.spots : {};
  const TORCHES = sp.torches || [[116, 122, 1], [284, 122, 1], [176, 156, 0.6], [224, 156, 0.6]];
  const EYES = sp.eyes || [[188, 186], [212, 170], [200, 200], [222, 192], [180, 166], [206, 150]];
  const CHESTS = sp.chests || [[100, 218, 1], [124, 224, 0.8]];
  // On a painting the torches are painted (unlit), so only the fire is drawn, where each one's tip is.
  const torch = ([x, y, s], i) => {
    const lit = i < W;
    if (P && !lit) return '';
    return `<g class="dg-torch${lit ? ' lit' : ''}" transform="translate(${x} ${y}) scale(${s})" style="--d:${(i * 0.31).toFixed(2)}s">
      ${lit ? '<circle class="dg-pool" r="58" cy="-22"/>' : ''}${P ? '' : '<path class="dg-sconce" d="M-6 6h12l-3 6h-6zM-1.5 6v-4"/><path class="dg-stick" d="M-2.4-14h4.8l-1 20h-2.8z"/>'}
      ${lit ? `<path class="dg-flame" d="M0-36C7-27 8-20 3.5-15 2-13.5-2-13.5-3.5-15-8-20-7-27 0-36z"/><path class="dg-core" d="M0-27c3 4 3.4 7 1.4 9.4-.8.8-2 .8-2.8 0-2-2.4-1.6-5.4 1.4-9.4z"/>${[0, 1, 2].map(j => `<circle class="dg-ember" cx="${j * 3 - 3}" cy="-34" r="${(0.9 + j * 0.25).toFixed(2)}" style="--d:${(i * 0.4 + j * 0.6).toFixed(2)}s"/>`).join('')}` : ''}</g>`;
  };
  const eyes = ([x, y], i) => `<g class="dg-eyes${i < N ? ' gold' : ''}" style="--d:${(i * 1.3).toFixed(1)}s"><ellipse cx="${x - 3.6}" cy="${y}" rx="2.2" ry="1.3"/><ellipse cx="${x + 3.6}" cy="${y}" rx="2.2" ry="1.3"/></g>`;
  const chest = ([x, y, k]) => `<g class="dg-chest" transform="translate(${x} ${y}) scale(${k})"><path class="dg-wood" d="M-14 0h28v-12h-28zM-14-12c0-8 28-8 28 0z"/><path class="dg-band" d="M-14-12h28M-8-17v17M8-17v17"/><rect class="dg-lock" x="-2.2" y="-14" width="4.4" height="5" rx="1"/><path class="dg-glint" d="M10-19l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/></g>`;
  const back = `<rect width="400" height="240" fill="url(#dgBrick)"/>
    <path class="dg-chain" d="M40 0v58M360 0v46"/>
    <path fill="url(#dgDeep)" d="M146 240V122a54 54 0 0 1 108 0v118z"/>
    <path class="dg-inner" d="M164 240v-108a36 36 0 0 1 72 0v108M178 240v-96a22 22 0 0 1 44 0v96"/>
    <path class="dg-floorline" d="M146 240l38-58M254 240l-38-58M150 222h100M160 206h80"/>`;
  const front = `<path class="dg-arch" d="M140 122a60 60 0 0 1 120 0"/><path class="dg-jamb" d="M140 122v118M260 122v118"/>
    <path class="dg-key" d="M193 56h14l-2 14h-10z"/>
    <rect y="226" width="400" height="14" class="dg-floor"/>`;
  return `<div class="hero-art delve${P ? ' painted' : ''}" aria-hidden="true">${sceneSvg(P, 'xMidYMax')}
    <defs>
      <pattern id="dgBrick" width="36" height="18" patternUnits="userSpaceOnUse"><rect width="36" height="18" class="dg-mortar"/><rect x="1" y="1" width="34" height="7.6" rx="1.2" class="dg-brick"/><rect x="-17" y="10" width="34" height="7.6" rx="1.2" class="dg-brick b"/><rect x="19" y="10" width="34" height="7.6" rx="1.2" class="dg-brick c"/></pattern>
      <radialGradient id="dgDeep" cx=".5" cy=".62" r=".6"><stop offset="0" class="dg-deep0"/><stop offset="1" class="dg-deep1"/></radialGradient>
      <radialGradient id="dgPool"><stop offset="0" class="dg-pool1"/><stop offset="1" class="dg-pool0"/></radialGradient>
      <radialGradient id="dgVig" cx=".5" cy=".55" r=".75"><stop offset=".45" class="dg-vig0"/><stop offset="1" class="dg-vig1"/></radialGradient>
      <linearGradient id="dgFlame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="dg-f1"/><stop offset="1" class="dg-f2"/></linearGradient>
    </defs>
    ${P ? paintSvg(P) : back}
    <g class="dg-eyes-all">${EYES.slice(0, Math.min(N + R, EYES.length)).map(eyes).join('')}</g>
    ${P ? '' : front}
    ${TORCHES.map(torch).join('')}
    ${CHESTS.slice(0, Math.min(Q, CHESTS.length)).map(chest).join('')}
    ${P ? '' : '<rect width="400" height="240" fill="url(#dgVig)"/>'}
  </svg>
  ${sceneRead(['Stirring', 'Torches', 'Camped'], { N, R, W, Q })}</div>`;
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
  const st = ownStatus(x), k = keyOf(x);
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
    <p class="o-where">${crestHtml(projectOf(x), 18, 'o-crest')}${whereOf(x)}</p>
    ${body}
    <footer class="o-foot ${x.source === 'app' && st === 'reply' ? 'stack' : ''}">${acts}</footer>
  </div></article>`;
}

function workCard(x) {
  const st = statusOf(x);
  // At work because its partner is: the card tells what the partner is doing.
  const w = x.partner && ownStatus(x) !== 'working' && ownStatus(x.partner) === 'working' ? x.partner : x;
  const who = w !== x ? `${PROV_NAME[w.provider || 'claude']}: ` : '';
  const label = who + (w.phase === 'starting' ? 'Starting' : w.phase === 'thinking' ? 'Thinking' : w.phase === 'writing' ? 'Writing' : w.source === 'terminal' ? 'Working in a terminal' : 'Working');
  const since = w.turnStartedAt || w.lastEventAt;
  const step = w.phase === 'tool' && (w.tool || w.detail) ? `<div class="o-step"><span class="v">${esc(VERB_NOW[w.tool] || 'Using')}</span><code>${esc(w.detail || w.tool || '')}</code></div>` : '';
  const said = plainMd(lastLine(w.lastText));
  const line = said ? `<p class="o-line">${esc(said)}</p>` : w.lastPrompt ? `<p class="o-line dim">You asked: ${esc(w.lastPrompt)}</p>` : '';
  return `<article class="omen ${st === 'working' ? 'working' : st}"><div class="omen-in">
    <header class="o-top"><span class="${x.source === 'app' ? 'ember-dot' : 'violet-dot'}" aria-hidden="true"></span>${esc(label)}<span class="o-time" data-since="${since || ''}"></span></header>
    <h3 class="o-title"><button data-a="open">${esc(x.title || 'New chat')}</button></h3>
    <p class="o-where">${crestHtml(projectOf(x), 18, 'o-crest')}${whereOf(x)}</p>
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
      if (b.dataset.cx === 'copy') { copyText(b.dataset.text, null).then(ok => { if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = b.dataset.label; }, 1500); } }); return; }
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
  const name = ((await ask(kind === 'ollama' ? 'Add an Ollama account' : 'Add a Codex account', kind === 'ollama' ? 'A name for it, as it shows on its card.' : 'A name for it, as it shows on its card, for example “Work” or “Personal”.', kind === 'ollama' ? 'Ollama' : '', 'Add account')) || '').trim();
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
    ...(S.codexAuthUrl && !c.signedIn ? [{ label: 'Copy the sign-in link', hint: 'for a private browser window', run: () => copyText(S.codexAuthUrl, 'Copied the link.') }] : []),
    ...(c.signedIn && c.kind !== 'ollama' ? [{ label: 'Open chatgpt.com', hint: 'regular ChatGPT, in its own window', run: () => openWeb(c.id) }, { label: `Sign out of ${c.name || 'Codex'}`, run: async () => { if (!(await appConfirm(`Sign ${c.name || 'Codex'} out of its ChatGPT account?\n\nYour Codex chats stay on this computer.`, { ok: 'Sign out', danger: true }))) return; await api('/api/codex/logout', { account: c.id }); await reload(); toast(`${c.name || 'Codex'} is signed out.`); } }] : []),
    '-',
    { label: 'Add another Codex account', hint: 'a second ChatGPT sign-in; chats stay shared', run: () => addCodexAccount('chatgpt') },
    ...(codexAccts().some(x => x.kind === 'ollama') ? [] : [{ label: 'Add Ollama', hint: 'Codex with ollama.com cloud models', run: () => addCodexAccount('ollama') }]),
    ...(extra ? [
      { label: 'Rename…', run: async () => { const n = ((await ask('Rename this account', 'Only changes the name shown here.', c.name, 'Rename')) || '').trim(); if (!n || n === c.name) return; const r = await api('/api/codex/accounts/rename', { id: c.id, name: n }); S.codex = r.codex; renderAll(); } },
      { label: 'Remove from the list', hint: 'its sign-in folder stays', run: async () => { if (!(await appConfirm(`Remove ${c.name} from Session Switcher?\n\nIts chats stay. Its sign-in stays in ~/.${c.id} if you add it again.`, { ok: 'Remove', danger: true }))) return; const r = await api('/api/codex/accounts/remove', { id: c.id }); S.codex = r.codex; renderAll(); } },
    ] : []),
    '-',
    { label: 'Turn Codex off', hint: 'hides it everywhere; turn it back on in Setup', run: async () => { await api('/api/codex/settings', { enabled: false }); await reload(); toast('Codex is off. Turn it back on in Setup.'); } },
  ]);
}

function rowHtml(s, folderName, hit) {
  const a = current(); const cx = isCodex(s), oc = isOpenClaw(s);
  const ok = oc || (cx ? codexReady() : canLaunch(a));
  const why = cx ? (S.codex && S.codex.installed === false ? 'Install Codex first (Setup)' : 'Sign in to Codex first') : !a.signedIn ? `Sign in to ${a.name} first` : !a.lock.ok ? (a.lockMessage || 'Not on its locked account') : '';
  const sub = oc ? s.preview || '' : s.lastPrompt ? `You last asked: ${s.lastPrompt}` : (s.title !== s.firstPrompt ? `Started with: ${s.firstPrompt}` : '');
  const live = liveOf(s.id);
  const run = !live && isRunning(s.id);
  const ocLive = oc && s.status === 'running' && !live;
  const flags = (isFav(s.id) ? '<span class="r-fav" title="Pinned to the sidebar">★</span>' : '') + (cx ? '<span class="tag codex">Codex</span>' : '')
    + (s.partner ? `<span class="tag line pair" title="${PROV_NAME[s.partner.provider]} works in this chat too">with ${PROV_NAME[s.partner.provider]}</span>` : '')
    + (oc ? `<span class="tag openclaw" title="An OpenClaw agent’s session, readable and writable here">OpenClaw · ${esc(s.agentName || 'Agent')}</span>` : '')
    + (live ? `<span class="tag line">In the window${!cx && live.accountId !== a.id ? ` as ${esc(live.accountName)}` : ''}</span>`
    : ocLive ? '<span class="tag line" title="This session is active in OpenClaw right now">Live now</span>'
    : run ? '<span class="tag violet">In a terminal</span>' : (s.active ? '<span class="tag ghost">Just updated</span>' : ''));
  const primary = oc ? `<button class="btn sm" data-chat="${esc(s.id)}" title="Read this session here; it carries on in OpenClaw">Read</button>`
    : live ? `<button class="btn sm" data-chat="${esc(s.id)}" title="Go back to this chat">Return</button>`
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
  return `<div class="sec-h"><p class="eyebrow">${esc(voice('✦'))} ${esc(voice(eyebrow))}</p><h2>${esc(voice(title))}</h2>${extra ? `<div class="sec-x">${extra}</div>` : ''}</div>`;
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
  toast(`${n ? `Reopened ${n} chat${n === 1 ? '' : 's'}; ${n === 1 ? 'it’s' : 'they’re'} in Active now.` : ''}${r.failed.length ? ` ${r.failed.length} couldn’t open: ${r.failed.map(f => `${f.title || 'a chat'} (${f.error})`).join('; ')}` : ''}`.trim(), r.failed.length ? 10000 : 5000);
}

// The hub scene holds still while it's scrolled out of view.
let heroSeen = null;
function watchHero() {
  const el = $('heroSlot'); if (!el || !window.IntersectionObserver) return;
  if (heroSeen) heroSeen.disconnect();
  heroSeen = new IntersectionObserver(([e]) => el.classList.toggle('hero-off', !e.isIntersecting));
  heroSeen.observe(el);
}
function renderHub() {
  const better = headroomPick();
  const recent = allSessions().slice(0, 1);
  $('page').innerHTML = `
    <div id="welcomeSlot"></div>
    <div id="heroSlot">${heroHtml()}</div>
    <div id="reopenSlot">${reopenHtml()}</div>
    <div id="guardSlot">${guardHtml()}</div>
    <section class="sec" id="secAwait">
      ${secHead('Your move', 'Awaiting you')}
      <div class="summons-grid" id="awaitList"></div>
    </section>
    <section class="sec" id="secWork">
      ${secHead('Right now', 'At work', '<button class="btn sm" data-act="task-new">Queue a task</button>')}
      <div class="board" id="board"></div>
      <div class="quietrow" id="quietList"></div>
    </section>
    <div id="todaySlot"></div>
    <section class="sec" id="secRaces" hidden>
      ${secHead('Head to head', 'Races')}
      <ul class="races" id="raceList"></ul>
    </section>
    <section class="sec" id="secQueue" hidden>
      ${secHead('Coming up', 'Queued')}
      <ul class="queue" id="queueList"></ul>
    </section>
    <section class="sec" id="secWorlds">${secHead('By folder', 'Your projects', '<button class="btn sm" data-act="project-new">New project</button>')}<div class="atlas ${S.atlasEntered ? '' : 'enter'}" id="atlas"></div></section>
    <section class="sec">
      ${secHead('Pick up where you left off', 'Recent chats', `<button class="btn quiet sm" data-view="recent">All recent chats</button>`)}
      ${recent.length ? '<ul class="rows" id="recentList"></ul>' : emptyArt('chats', 'No chats yet. Start one with <button class="linkish" data-act="project-new">New project</button>, or open a folder in Claude Code once and its chats appear here.')}
    </section>
    <section class="sec" id="secAccounts">
      ${secHead('Your plans', 'Accounts and usage', `<button class="btn quiet sm" data-act="usage-all">Check all</button>`)}
      ${better ? `<div class="headroom"><span><b>${esc(better.a.name)}</b> has the most room right now: ${better.r}% left. ${esc(current().name)} has ${binding(usageOf(current().id)).left}%.</span><button class="btn sm" data-act="use" data-acct="${esc(better.a.id)}">Work as ${esc(better.a.name)}</button></div>` : ''}
      <div class="dials" id="dials"></div>
    </section>
    ${S.dryRun ? '<p class="note">Preview mode: terminal buttons show what would run instead of opening one.</p>' : ''}`;
  renderHubLists();
  renderLive(true);
  watchHero();
  if (!dialsDrawn && !renderHub.timer) renderHub.timer = setTimeout(() => { dialsDrawn = true; }, 2600);
  renderQueue(); renderRaces();
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
// A project's crest, the same wherever the project appears: a picture of its own named crest, emblem,
// icon or logo (Codex can make one), else its banner, else an emblem drawn from its name (its colors
// and glyph). size is in pixels.
const CREST_TINTS = ['a5463f', 'd9bf74', 'a58be8', 'cf8274', '6f97d8', '7fb79a'];
const CREST_RE = /(^|[\\/])(crest|emblem|icon|logo)\.(png|webp|jpe?g)$/i;
function crestHtml(p, size = 22, cls = '') {
  if (!p || !p.name) return '';
  const w = p.cwd ? S.worlds[p.cwd] : null;
  const own = w && w.images ? w.images.find(im => CREST_RE.test(im.rel || im.name || '')) : null;
  const pic = (w && w.crest) || (own ? own.path : w && w.banner);
  // Its two colors follow the theme (each is one of the theme's own color variables).
  const h = hash(p.name), n = CREST_TINTS.length, i = h % n, j = (h >>> 5) % n === i ? (i + 1) % n : (h >>> 5) % n;
  const style = `--s:${size}px;--a:rgb(var(--c-${CREST_TINTS[i]}));--b:rgb(var(--c-${CREST_TINTS[j]}))`;
  // A picture that won't load (moved, deleted) leaves the drawn emblem underneath.
  const meta = pic && w && w.images && w.images.find(im => im.path === pic);
  const src = pic ? imageSrc(pic, p.cwd) + (meta ? `&v=${meta.mtime}-${meta.size}` : '') : '';
  const img = pic ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove('pic');this.remove()">` : '';
  return `<span class="crest${pic ? ' pic' : ''} ${cls}" style="${style}" aria-hidden="true"><b>${glyphFor(p.name)}</b>${img}</span>`;
}
// The project a chat belongs to (or a stand-in with its folder's name, for the crest).
const projectOf = x => (x && x.cwd && S.projects.find(p => p.cwd.toLowerCase() === String(x.cwd).toLowerCase())) || (x && x.folder ? { name: x.folder, cwd: x.cwd || null } : null);
function worldCard(p, i) {
  const w = S.worlds[p.cwd];
  const nClaude = p.sessions.filter(x => provOf(x) === 'claude').length, nCodex = p.sessions.filter(isCodex).length, nOc = p.sessions.filter(isOpenClaw).length;
  const latest = p.sessions[0], resumable = p.sessions.find(x => !isOpenClaw(x));
  const today = midnight();
  const chatsToday = p.sessions.filter(x => x.updated >= today).length;
  const live = p.sessions.some(x => isRunning(x.id) || liveOf(x.id));
  const bits = [chatsToday ? plural(chatsToday, 'chat') : '', w && w.today.docs ? plural(w.today.docs, 'doc') : '', w && w.today.images ? plural(w.today.images, 'image') : ''].filter(Boolean);
  return `<article class="world ${live ? 'is-live' : ''}" style="--i:${Math.min(i, 12)}">
    <button class="w-art" data-world="${esc(p.cwd)}" aria-label="Open ${esc(p.name)}">${worldArt(p, w)}<span class="w-shade" aria-hidden="true"></span>
      <span class="w-title">${crestHtml(p, 30)}<span class="w-name">${esc(p.name)}</span>${live ? '<span class="live-dot" title="A chat here is open right now"></span>' : ''}</span></button>
    <div class="w-body">
      <p class="w-today ${bits.length ? 'on' : ''}">${bits.length ? `<span class="glyph" aria-hidden="true">✦</span>Today: ${esc(bits.join(', '))}` : p.sessions.length ? 'Quiet today' : 'New project'}</p>
      ${latest ? `<p class="w-last"><button class="linkish" data-preview="${esc(latest.id)}" title="${esc(latest.title)}">${esc(latest.title)}</button><span>${esc(agoL(latest.updated))}</span></p>` : `<p class="w-last quiet">No chats yet${p.added && p.updated ? `. Added ${esc(agoL(p.updated))}` : ''}.</p>`}
      <div class="w-act">
        ${resumable && p.exists ? `<button class="btn sm" data-continue="${esc(resumable.id)}" title="${esc(resumable.title)}">Continue</button>` : ''}
        <button class="btn quiet sm" data-act="world-new" data-cwd="${esc(p.cwd)}" aria-haspopup="menu" aria-expanded="false" ${p.exists ? '' : 'disabled'}>New chat</button>
        ${p.sessions.length ? `<span class="w-counts" title="${nClaude} Claude Code chats${nCodex ? `, ${nCodex} Codex chats` : ''}${nOc ? `, ${nOc} OpenClaw sessions` : ''}">${nClaude ? `<span class="pc claude">${nClaude}</span>` : ''}${nCodex ? `<span class="pc codex">${nCodex}</span>` : ''}${nOc ? `<span class="pc openclaw">${nOc}</span>` : ''}</span>` : ''}
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
