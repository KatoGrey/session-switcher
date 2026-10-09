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
async function startReview(base) {
  if (!codexOK()) { toast('Sign in to Codex first: on the hub, under Accounts and usage.'); return null; }
  if (!reviewAvailable() || C.state === 'ended') { toast('Start the chat again first.'); return null; }
  const r = await api('/api/chat/review', { key: C.key, files: [...L.files.keys()], ...(base ? { base } : {}) });
  return r && r.id;
}

// A finding, written for Claude: what's wrong and where, with Codex's explanation.
function findingText(f, n) {
  const where = f.file ? ` (${f.file}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `-${f.end}` : ''}` : ''})` : '';
  const body = f.body ? `\n${f.body.split('\n').map(l => `   ${l}`).join('\n')}` : '';
  return `${n ? `${n}. ` : ''}${f.priority ? `[${f.priority}] ` : ''}${f.title}${where}${body}`;
}
function fixText(ev, list) {
  const one = list.length === 1;
  return `Codex reviewed ${ev.what || 'the changes'} and found ${one ? 'this' : 'these'}:\n\n${list.map((f, i) => findingText(f, one ? 0 : i + 1)).join('\n\n')}\n\nPlease fix ${one ? 'it' : 'them'}. If you think a finding is wrong, say why instead of changing the code.`;
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
  if (kind === 'rvfix') return putInBox(fixText(ev, [list[i]]));
  if (kind === 'rvfixall') return putInBox(fixText(ev, list));
  if (kind === 'rvloop') {
    if (C.state !== 'ready') { toast('Claude is busy. Try again once it’s done.'); return; }
    // Rechecks keep this review's starting point, so what wasn't fixed is checked again too.
    const lp = Review.loop = { round: 1, waiting: true, id: ev.id, base: ev.base || null, gen: C.gen, key: C.key };
    try { await api('/api/chat/send', { key: lp.key, text: fixText(ev, list) }); }
    catch (err) { if (Review.loop === lp) Review.loop = null; if (C.gen === lp.gen) renderReview(ev); throw err; }
    if (C.gen === lp.gen) renderReview(ev);
  }
  if (kind === 'rvstop') { Review.loop = null; renderReview(ev); toast('Stopped. Nothing else will be sent.', 2500); }
  return undefined;
}

// Claude finished a reply: if it was fixing findings, have Codex look again.
function reviewAfterTurn(ev) {
  const lp = Review.loop;
  if (!lp || !lp.waiting || lp.gen !== C.gen) return;
  lp.waiting = false;
  if (!ev.ok || C.state === 'ended' || Date.now() - C.interruptedAt < 8000) { Review.loop = null; return; }
  lp.expect = null;
  startReview(lp.base)
    .then(id => { if (Review.loop !== lp) return; if (id) lp.expect = id; else Review.loop = null; })
    .catch(err => { if (Review.loop === lp) Review.loop = null; toast(err.message); });
}
// A review finished during "until it's clean": stop when it's clean or out of rounds, else fix again.
// Only the review this loop asked for counts. (Round n means n sets of fixes sent; Codex checks
// after each, so at most REVIEW_ROUNDS + 1 reviews.)
function reviewLoopStep(ev) {
  const lp = Review.loop;
  if (!lp || lp.waiting || ev.state === 'running' || !lp.expect || ev.id !== lp.expect || lp.gen !== C.gen) return;
  lp.id = ev.id;
  const n = (ev.findings || []).length;
  if (ev.state === 'failed' || !n) { ev.loopEnd = { done: ev.state === 'failed' ? 'failed' : 'clean', round: lp.round }; Review.loop = null; return; }
  if (lp.round >= REVIEW_ROUNDS) { ev.loopEnd = { done: 'rounds', round: lp.round }; Review.loop = null; return; }
  lp.round++; lp.waiting = true; lp.expect = null;
  api('/api/chat/send', { key: lp.key, text: fixText(ev, ev.findings) })
    .catch(err => { if (Review.loop === lp) Review.loop = null; toast(err.message); if (C.gen === lp.gen) renderReview(ev); });
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
  const head = `<p class="rv-h"><span class="rv-g" aria-hidden="true">◆</span><b>Codex review</b><span class="rv-what">of ${esc(ev.what || 'the changes')}</span>
    ${ev.state === 'running' ? '<span class="rv-st"><span class="gen-spin" aria-hidden="true"></span>Reviewing</span>'
      : ev.state === 'failed' ? '<span class="rv-st err">Didn’t finish</span>'
      : `<span class="rv-st ${fs.length ? 'found' : 'clean'}">${fs.length ? `${fs.length} finding${fs.length === 1 ? '' : 's'}` : 'All clear'}</span>`}</p>`;
  let body;
  if (ev.state === 'running') {
    body = `<p class="rv-prog">${esc(ev.progress || 'Starting…')}</p><p class="rv-note">Codex reads the changes and checks what it finds, in a read-only sandbox: it can’t change anything. This usually takes a minute or two.</p>`;
  } else if (ev.state === 'failed') {
    body = `<p class="rv-err">${esc(ev.error || 'The review didn’t finish.')}</p><div class="rv-b"><button type="button" class="btn" data-c="review" data-base="${esc(ev.base || '')}">Try again</button></div>`;
  } else {
    body = `${ev.overall ? `<div class="md rv-over">${md(ev.overall)}</div>` : ''}${fs.length ? `<ol class="rv-list">${fs.map((f, i) => `<li class="rv-f ${esc(String(f.priority || '').toLowerCase())}">
        <div class="rv-ft">${f.priority ? `<span class="rv-p" title="${esc(PRIORITY[f.priority] || f.priority)}">${esc(f.priority)}</span>` : ''}<b>${esc(f.title)}</b></div>
        ${f.file ? `<button type="button" class="linkish rv-loc" data-file="${esc(f.file)}" title="${esc(f.file)}">${esc(base(f.file))}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `–${f.end}` : ''}` : ''}</button>` : ''}
        ${f.body ? `<div class="md rv-fb">${md(f.body)}</div>` : ''}
        <div class="rv-fa"><button type="button" class="btn quiet sm" data-c="rvfix" data-i="${i}">Ask Claude to fix this</button></div></li>`).join('')}</ol>` : ''}`;
    const end = ev.loopEnd;
    const endNote = !end ? '' : end.done === 'clean' ? `<p class="rv-loopnote ok">Clean after ${end.round} round${end.round === 1 ? '' : 's'} of fixes.</p>`
      : end.done === 'rounds' ? `<p class="rv-loopnote">Stopped after ${end.round} rounds of fixes; these are still open.</p>` : '';
    body += endNote + (looping && fs.length
      ? `<div class="rv-b"><p class="rv-loopnote"><span class="gen-spin" aria-hidden="true"></span>Round ${lp.round} of ${REVIEW_ROUNDS}: Claude is fixing these, then Codex checks again.</p><button type="button" class="btn quiet" data-c="rvstop">Stop after this</button></div>`
      : `<div class="rv-b">${fs.length ? `<button type="button" class="btn gilt" data-c="rvfixall">Ask Claude to fix ${fs.length === 1 ? 'it' : `all ${fs.length}`}</button>
          <button type="button" class="btn" data-c="rvloop" title="Sends the findings to Claude now; when it’s done, Codex reviews again. Up to ${REVIEW_ROUNDS} rounds.">Fix and recheck until clean</button>` : ''}
          <button type="button" class="btn quiet" data-c="review" data-base="${esc(ev.base || '')}">Review again</button></div>`);
  }
  card.innerHTML = head + body;
  if (fresh) withStick(() => feed.appendChild(card));
}

// A Claude reply that changed files gets a "Review with Codex" button.
function markEdits(p, blocks) {
  if (provNow() !== 'claude' || C.provider !== 'claude') return;
  if (blocks.some(b => b && b.type === 'tool' && FILE_TOOLS.has(b.name))) p.closest('.turn')?.classList.add('edits');
}
