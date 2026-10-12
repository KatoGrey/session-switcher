'use strict';
/* Codex reviews Claude's work: the button on replies that changed files, the review card in the
   conversation, handing findings to Claude, and "fix and review again until it's clean". */

// While "until it's clean" runs: which round, and whether we're waiting for Claude to finish fixing.
const Review = { loop: null };
const REVIEW_ROUNDS = 3;
const PRIORITY = { P0: 'Critical: fix before anything else', P1: 'Important', P2: 'Worth fixing', P3: 'Minor' };

const reviewAvailable = () => !C.watch && C.provider === 'claude' && !!C.key && codexOK();

// base: recheck everything since this starting point (a git commit), as a loop's rechecks do.
// Returns the review's id, so a loop can wait for that review and no other.
// Claude can review too: the chat itself in a Codex chat, or its Claude partner.
const claudeReviewOK = () => !C.watch && !!C.key && (C.provider === 'codex' || duo());
// by: 'codex' (Codex reviews Claude's work), 'claude' (Claude reviews Codex's) or 'both' (one card, both views).
async function startReview(base, by = 'codex') {
  if (by !== 'claude' && !codexOK()) { toast('Sign in to Codex first: on the hub, under Accounts and usage.'); return null; }
  const ok = by === 'claude' ? claudeReviewOK() : by === 'both' ? claudeReviewOK() && codexOK() : reviewAvailable();
  if (!ok || C.state === 'ended') { toast('Start the chat again first.'); return null; }
  const r = await api('/api/chat/review', { key: C.key, files: [...L.files.keys()], by, ...(base ? { base } : {}) });
  return r && r.id;
}

// A finding, written for Claude: what's wrong and where, with Codex's explanation.
function findingText(f, n) {
  const where = f.file ? ` (${f.file}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `-${f.end}` : ''}` : ''})` : '';
  const body = f.body ? `\n${f.body.split('\n').map(l => `   ${l}`).join('\n')}` : '';
  return `${n ? `${n}. ` : ''}${f.priority ? `[${f.priority}] ` : ''}${f.title}${where}${body}`;
}
// Who reviewed, and who fixes: Codex reviews Claude's work and Claude Codex's; after a review by both,
// the chat's own assistant fixes.
const reviewerOf = ev => (ev.by === 'claude' ? 'Claude' : ev.by === 'both' ? 'Codex and Claude' : 'Codex');
const fixerOf = ev => (ev.by === 'claude' ? 'codex' : ev.by === 'both' ? C.provider : 'claude');
const fixTarget = ev => (fixerOf(ev) === C.provider ? 'main' : 'comp');
function fixText(ev, list) {
  const one = list.length === 1;
  return `${reviewerOf(ev)} reviewed ${ev.what || 'the changes'} and found ${one ? 'this' : 'these'}:\n\n${list.map((f, i) => findingText(f, one ? 0 : i + 1)).join('\n\n')}\n\nPlease fix ${one ? 'it' : 'them'}. If you think a finding is wrong, say why instead of changing the code.`;
}
// Puts text in the message box, for Claude (or 'comp': Codex), for you to check and send. (No fill-in
// blanks, unlike prompts: findings quote code.)
function putInBox(text, to = 'main') {
  setTarget(to, false);
  const ta = $c('cText');
  ta.value = ta.value.trim() ? `${ta.value.replace(/\s+$/, '')}\n\n${text}` : text;
  grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollTop = ta.scrollHeight;
  saveDraft();
  toast('It’s in the message box: check it, then press Enter.', 3500);
}

async function reviewAction(kind, card, i) {
  const ev = card && card._ev; if (!ev) return;
  const list = ev.findings || [];
  if (kind === 'rvfix') return putInBox(fixText(ev, [list[i]]), fixTarget(ev));
  if (kind === 'rvfixall') return putInBox(fixText(ev, list), fixTarget(ev));
  // "Until it's clean" runs on the PC (server.js reviewLoop), so it carries on when you switch chats,
  // reload or put the phone down; rechecks keep this review's starting point. Its steps arrive as
  // 'reviewloop' events.
  if (kind === 'rvloop') {
    if (C.state !== 'ready') { toast('Claude is busy. Try again once it’s done.'); return; }
    await api('/api/chat/review-loop', { key: C.key, review: { id: ev.id, what: ev.what, base: ev.base || null, findings: list }, files: [...L.files.keys()] });
  }
  if (kind === 'rvstop') { await api('/api/chat/review-loop', { key: C.key, stop: true }); toast('Stopping after this step. Nothing else will be sent.', 3000); }
  return undefined;
}

// A step of "until it's clean": which review it's about and which round, or how it ended.
function reviewLoopEvent(ev) {
  const card = $c('cFeed').querySelector(`.review[data-rid="${CSS.escape(ev.id || '')}"]`);
  if (ev.state === 'end') {
    Review.loop = null;
    if (card && card._ev) { card._ev.loopEnd = { done: ev.done, round: ev.round }; renderReview(card._ev); }
    return;
  }
  const was = Review.loop && Review.loop.id;
  Review.loop = { id: ev.id, round: ev.round, state: ev.state };
  if (card && card._ev) renderReview(card._ev);
  if (was && was !== ev.id) { const old = $c('cFeed').querySelector(`.review[data-rid="${CSS.escape(was)}"]`); if (old && old._ev) renderReview(old._ev); }
}

function renderReview(ev) {
  const feed = $c('cFeed');
  let card = feed.querySelector(`.review[data-rid="${CSS.escape(ev.id)}"]`);
  const fresh = !card;
  if (fresh) { card = document.createElement('div'); card.className = `review${liveRender ? ' fresh' : ''}`; card.dataset.rid = ev.id; }
  if (ev.state !== 'running' && card._ev && card._ev.loopEnd && !ev.loopEnd) ev.loopEnd = card._ev.loopEnd;
  card._ev = ev;
  const fs = ev.findings || [];
  const lp = Review.loop;
  const looping = lp && (lp.id === ev.id || ev.state === 'running');
  const head = `<p class="rv-h"><span class="rv-g" aria-hidden="true">◆</span><b>${ev.by === 'claude' ? 'Claude review' : ev.by === 'both' ? 'Dual review' : 'Codex review'}</b><span class="rv-what">of ${esc(ev.what || 'the changes')}</span>
    ${ev.state === 'running' ? '<span class="rv-st"><span class="gen-spin" aria-hidden="true"></span>Reviewing</span>'
      : ev.state === 'failed' ? '<span class="rv-st err">Didn’t finish</span>'
      : `<span class="rv-st ${fs.length ? 'found' : 'clean'}">${fs.length ? `${fs.length} finding${fs.length === 1 ? '' : 's'}` : 'All clear'}</span>`}</p>`;
  let body;
  if (ev.state === 'running') {
    body = `<p class="rv-prog">${esc(ev.progress || 'Starting…')}</p><p class="rv-note">${ev.by === 'claude' ? 'Claude reads the changes in its own chat and is asked not to change anything.' : ev.by === 'both' ? 'Codex (in a read-only sandbox) and Claude (asked not to change anything) each read the changes; their findings come together here.' : 'Codex reads the changes and checks what it finds, in a read-only sandbox: it can’t change anything.'} This usually takes a minute or two.</p>`;
  } else if (ev.state === 'failed') {
    body = `<p class="rv-err">${esc(ev.error || 'The review didn’t finish.')}</p><div class="rv-b"><button type="button" class="btn" data-c="review" data-base="${esc(ev.base || '')}">Try again</button></div>`;
  } else {
    body = `${ev.overall ? `<div class="md rv-over">${md(ev.overall)}</div>` : ''}${fs.length ? `<ol class="rv-list">${fs.map((f, i) => `<li class="rv-f ${esc(String(f.priority || '').toLowerCase())}">
        <div class="rv-ft">${f.priority ? `<span class="rv-p" title="${esc(PRIORITY[f.priority] || f.priority)}">${esc(f.priority)}</span>` : ''}<b>${esc(f.title)}</b>${f.by && ev.by === 'both' ? `<span class="rv-by ${f.by}">${f.by === 'both' ? 'Both found this' : PROV_NAME[f.by]}</span>` : ''}</div>
        ${f.file ? `<button type="button" class="linkish rv-loc" data-file="${esc(f.file)}" title="${esc(f.file)}">${esc(base(f.file))}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `–${f.end}` : ''}` : ''}</button>` : ''}
        ${f.body ? `<div class="md rv-fb">${md(f.body)}</div>` : ''}
        <div class="rv-fa"><button type="button" class="btn quiet sm" data-c="rvfix" data-i="${i}">Ask ${PROV_NAME[fixerOf(ev)]} to fix this</button></div></li>`).join('')}</ol>` : ''}`;
    const end = ev.loopEnd;
    const endNote = !end ? '' : end.done === 'clean' ? `<p class="rv-loopnote ok">Clean after ${end.round} round${end.round === 1 ? '' : 's'} of fixes.</p>`
      : end.done === 'rounds' ? `<p class="rv-loopnote">Stopped after ${end.round} rounds of fixes; these are still open.</p>` : '';
    body += endNote + (looping && fs.length
      ? `<div class="rv-b"><p class="rv-loopnote"><span class="gen-spin" aria-hidden="true"></span>Round ${lp.round} of ${REVIEW_ROUNDS}: Claude is fixing these, then Codex checks again.</p><button type="button" class="btn quiet" data-c="rvstop">Stop after this</button></div>`
      : `<div class="rv-b">${fs.length ? `<button type="button" class="btn gilt" data-c="rvfixall">Ask ${PROV_NAME[fixerOf(ev)]} to fix ${fs.length === 1 ? 'it' : `all ${fs.length}`}</button>
          ${(!ev.by || ev.by === 'codex') && C.provider === 'claude' ? `<button type="button" class="btn" data-c="rvloop" title="Sends the findings to Claude now; when it’s done, Codex reviews again. Up to ${REVIEW_ROUNDS} rounds.">Fix and recheck until clean</button>` : ''}` : ''}
          <button type="button" class="btn quiet" data-c="review" data-base="${esc(ev.base || '')}" data-by="${esc(ev.by || 'codex')}">Review again</button></div>`);
  }
  card.innerHTML = head + body;
  if (fresh) withStick(() => feed.appendChild(card));
}

// A reply that changed files gets its review button: "Review with Codex" on Claude's, "Review with
// Claude" on Codex's (each shows only where that review is possible).
function markEdits(p, blocks) {
  if (blocks.some(b => b && b.type === 'tool' && FILE_TOOLS.has(b.name))) p.closest('.turn')?.classList.add('edits');
}

/* ---------- plan first ---------- */
// One card follows a "plan first": drafting, then the other's check, then who builds it. It moves to
// the end of the conversation once the plan and its check are in, so the choice sits under them.
function renderPlanFirst(ev) {
  const feed = $c('cFeed');
  let card = C.planCard && C.planCard.isConnected ? C.planCard : null;
  if (ev.state === 'drafting' || !card) {
    card = document.createElement('div');
    card.className = `planfirst${liveRender ? ' fresh' : ''}`;
    Object.assign(card, { _who: ev.who || C.provider, _to: ev.to || partnerProv(), _ask: ev.ask || '' });
    withStick(() => feed.appendChild(card));
    C.planCard = card;
  }
  const who = PROV_NAME[card._who], to = PROV_NAME[card._to];
  const head = `<p class="pf-h"><span class="pf-g" aria-hidden="true">◆</span><b>Plan first</b>${card._ask ? `<span class="pf-ask">${esc(card._ask)}</span>` : ''}</p>`;
  let body;
  if (ev.state === 'drafting') body = `<p class="pf-s"><span class="gen-spin" aria-hidden="true"></span>${who} is drafting a plan; ${to} checks it next. Nothing changes yet.</p>`;
  else if (ev.state === 'checking') body = `<p class="pf-s"><span class="gen-spin" aria-hidden="true"></span>${to} is checking ${who}’s plan…</p>`;
  else if (ev.state === 'stopped') body = '<p class="pf-s">Plan first stopped before the plan was ready.</p>';
  else if (ev.state === 'built') body = `<p class="pf-s ok">${esc(ev.by)} ${ev.by.includes(' and ') ? 'are' : 'is'} building it.</p>`;
  else {
    body = `<p class="pf-s">The plan is ready${ev.checked === false ? '' : `, checked by ${to}`}. Who builds it?</p>
      <div class="pf-b"><button type="button" class="btn gilt" data-build="main">${who}</button><button type="button" class="btn" data-build="comp">${to}</button><button type="button" class="btn" data-build="both">Both (${who} first)</button></div>`;
    withStick(() => feed.appendChild(card));
  }
  card.innerHTML = head + body;
}
async function buildPlan(btn) {
  const card = btn.closest('.planfirst'); if (!card) return;
  const t = btn.dataset.build, who = PROV_NAME[card._who], to = PROV_NAME[card._to];
  const text = `Build it as planned above${t === 'comp' ? ` (${who}’s plan, with your own check)` : `, taking in ${to}’s check`}. Go ahead and make the changes.`;
  await api('/api/chat/send', { key: C.key, text, ...(t === 'main' ? {} : { to: t === 'both' ? 'both' : 'partner', account: S.acct }) });
  renderPlanFirst({ state: 'built', by: t === 'both' ? `${who} and ${to}` : t === 'comp' ? to : who });
}
