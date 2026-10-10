'use strict';
/* This week: every plan's weekly room, the use-next order, pace forecasts and manual resets.
   Strategy (Ryan's): don't spread usage evenly. Per family, drain the plan that resets soonest
   down to the floor (10, 15 or 20%), then move to the next. */

const FAMS = [['chatgpt', 'ChatGPT'], ['claude', 'Claude']];
const famName = f => (FAMS.find(x => x[0] === f) || [f, f])[1];
const plans = () => (S.plans ? S.plans.plans : []);
const planById = id => plans().find(p => p.id === id);
const orderOf = fam => (S.plans ? (S.plans.order[fam] || []).map(planById).filter(Boolean) : []);
const useNext = fam => orderOf(fam)[0] || null;
const metered = () => plans().filter(p => !p.unlimited && !p.broken && typeof p.left === 'number');
const pLabel = p => `${p.label} ${famName(p.family)}`;

function forecastWords(p) {
  const f = p.forecast;
  if (!f) return '';
  const r = Math.round(f.rate);
  const basis = f.source === 'day' ? 'Over the last day' : 'So far this week';
  if (f.kind === 'untouched') return p.left >= 100 ? `Untouched this week. All of it resets ${wd(p.resetsAt)} unless you use it.` : `Nothing used in the last day. ${p.left}% left resets ${wd(p.resetsAt)} unless you use it.`;
  if (f.kind === 'dry') { const gap = (ms(p.resetsAt) - f.dryAt) / DAY; return `${basis} it’s gone ${r}% a day: at that pace it runs dry ${dayName(f.dryAt)}, about ${gap < 1 ? `${Math.round(gap * 24)} hours` : `${Math.round(gap * 10) / 10} days`} before it resets.`; }
  if (f.kind === 'onTarget') return `${basis} it’s gone ${r}% a day: it lands near empty right as it resets ${wd(p.resetsAt)}. Good use.`;
  return `${basis} it’s gone ${r}% a day: about ${f.atReset}% would be left at reset, so ${f.moreToUse}% more to use by ${wd(p.resetsAt)}.`;
}
const creditsOf = p => (p.credits && p.credits.list ? p.credits.list : []);
const manualOf = p => p.manualResets || [];
// Two to four words; the whole sentence is in the tooltip.
function forecastShort(p) {
  const f = p.forecast; if (!f) return { t: '', k: '' };
  if (f.kind === 'untouched') return { t: p.left >= 100 ? 'Untouched' : f.source === 'day' ? 'Idle today' : 'Barely used', k: 'quiet' };
  if (f.kind === 'dry') { const gap = (ms(p.resetsAt) - f.dryAt) / DAY; return { t: `Runs dry ${wd(f.dryAt)}${gap >= 1 ? `, ${Math.round(gap)}d early` : ''}`, k: 'bad' }; }
  if (f.kind === 'onTarget') return { t: 'On target', k: 'good' };
  return { t: `${f.moreToUse}% to spare`, k: 'room' };
}
function resetsCell(p) {
  const cr = creditsOf(p), mr = manualOf(p);
  if (cr.length) return `<span class="chip-s first" title="${esc(cr.map(c => `Expires ${new Date(ms(c.expiresAt)).toLocaleString('en-US')}`).join('\n'))}">${cr.length} · ${esc(md(cr[0].expiresAt))}</span><button class="linkish" data-usereset="${esc(p.id)}">Use</button>`;
  if (mr.length) return `<span class="chip-s" title="${esc(mr.map(m => `${m.expiresAt ? `Expires ${md(m.expiresAt)}` : 'No expiry'}${m.note ? ` · ${m.note}` : ''}`).join('\n'))}">${mr.length}${mr[0].expiresAt ? ` · ${esc(md(mr[0].expiresAt))}` : ''}</span><button class="linkish" data-addreset="${esc(p.id)}" title="Add another">+</button>`;
  return p.family === 'claude' ? '<button class="linkish dim" data-addreset="' + esc(p.id) + '" title="Claude Code doesn’t report manual resets; note yours here">+ add</button>' : '';
}
function planRow(p) {
  if (p.unlimited) return `<div class="prow"><span class="prank"></span><span class="pname"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></span><span class="pnote">${p.broken ? `<span class="warn">${esc(p.broken)}</span>` : 'No usage limits reported'}</span></div>`;
  if (p.broken) return `<div class="prow broken"><span class="prank"></span><span class="pname"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></span><span class="pnote"><span class="warn">${esc(p.broken.replace(/ Sign in from Setup in the full app\./, ''))}</span>${p.family === 'claude' ? `<button class="btn sm prime" data-signin="${esc(p.id)}">Sign in</button>` : ''}</span></div>`;
  if (typeof p.left !== 'number') return `<div class="prow"><span class="prank"></span><span class="pname"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></span><span class="pnote">${p.checking ? 'Checking…' : esc(p.error || 'No usage read yet')}</span></div>`;
  const fc = forecastShort(p);
  return `<div class="prow ${p.rank === 1 ? 'next' : ''} ${p.left <= floor() ? 'low' : ''}">
    <span class="prank" title="${p.rank ? `Use-next order for ${esc(famName(p.family))}` : 'At or below your floor'}">${p.rank || '–'}</span>
    <span class="pname"><b>${esc(p.label)}</b><small>${esc(p.kind)}${p.fiveLeft !== null && p.fiveLeft !== undefined && p.family === 'claude' ? ` · 5h ${p.fiveLeft}%` : ''}</small></span>
    <span class="pbar"><i style="width:${p.left}%"></i><s style="left:${floor()}%"></s></span>
    <span class="ppct">${p.left}%</span>
    <span class="preset" title="${p.resetsAt ? esc(new Date(ms(p.resetsAt)).toLocaleString('en-US')) : ''}">${p.resetsAt ? `${esc(wd(p.resetsAt))} · ${esc(inWords(p.resetsAt).replace(/^in /, ''))}` : '—'}</span>
    <span class="pfc ${fc.k}" title="${esc(forecastWords(p))}">${esc(fc.t)}</span>
    <span class="pres">${resetsCell(p)}</span>
  </div>`;
}
const famOrder = p => (p.family === 'chatgpt' ? 0 : p.family === 'claude' ? 1 : 2);
function plansTable() {
  const list = [...plans()].sort((a, b) => famOrder(a) - famOrder(b) || (a.rank || 99) - (b.rank || 99) || (a.broken ? 1 : 0) - (b.broken ? 1 : 0));
  let html = '', last = null;
  for (const p of list) {
    const f = p.family === 'ollama' ? 'other' : p.family;
    if (f !== last) { html += `<div class="pfam">${f === 'chatgpt' ? 'ChatGPT' : f === 'claude' ? 'Claude' : 'Other'}</div>`; last = f; }
    html += planRow(p);
  }
  return `<div class="ptable">${html}</div>`;
}
// The use-next chain, one line per family (Hackathon fuel uses it too).
function orderHtml() {
  return `<div class="order">${FAMS.map(([f, name]) => { const o = orderOf(f); return `<div><span class="fam">${name}</span>${o.map((p, i) => `<span class="step-chip ${i === 0 ? 'on' : ''}"><b>${i + 1}</b> ${esc(p.label)} <small>${p.left}%${p.resetsAt ? ` · ${esc(wd(p.resetsAt))}` : ''}</small></span>`).join('<span class="arrow">›</span>') || '<small>Every plan is at the floor</small>'}</div>`; }).join('')}</div>`;
}
const floorSeg = () => `<span class="crumb">Drain to <span class="seg" role="group" aria-label="Floor">${[10, 15, 20].map(d => `<button data-floor="${d}" aria-pressed="${floor() === d}">${d}%</button>`).join('')}</span></span>`;
function creditsHtml() { return ''; }

// Spending a manual reset is real and can't be undone, so it says what it costs first.
async function useReset(planId) {
  const p = planById(planId); if (!p) return;
  const c = creditsOf(p)[0];
  const daysTo = p.resetsAt ? days(p.resetsAt) : null;
  const wasted = p.left > floor() + 5;
  const body = `${esc(p.label)} ChatGPT has <b>${p.left}%</b> left${p.resetsAt ? ` and resets on its own ${esc(dayName(p.resetsAt))} (${inWords(p.resetsAt)})` : ''}. This spends the credit that expires ${c ? esc(dayName(c.expiresAt)) : 'first'} and refills the plan now.<br><br>${wasted ? `<b>That would waste most of it:</b> the plan still has room above your ${floor()}% floor.` : daysTo !== null && daysTo < 1 ? '<b>It resets within a day anyway</b>, so waiting is probably better.' : 'Well timed: it’s at the floor with days to go.'}`;
  if (!await confirmBox({ title: `Use a manual reset on ${p.label}?`, body, yes: 'Use one' })) return;
  const j = await api('/api/lite/reset/use', { plan: planId, creditId: c ? c.id : null });
  S.plans = j.plans;
  toast(j.outcome === 'reset' ? `${p.label} ChatGPT is full again.` : j.outcome === 'nothingToReset' ? 'Nothing to reset: the plan wasn’t used. The credit wasn’t spent.' : j.outcome === 'noCredit' ? 'No credit was left to use.' : `Codex said: ${j.outcome}`);
  render();
}
function addReset(planId, anchor) {
  const p = planById(planId); if (!p) return;
  const root = $('modalRoot');
  const d = new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
  root.innerHTML = `<div class="modal-back"><form class="modal" id="mrForm"><h3>Add a Claude reset for ${esc(p.label)}</h3><p>Claude Code doesn’t report manual resets, so note yours here with when it expires. It sits beside the ChatGPT ones.</p>
    <div class="manual-add"><input type="date" name="exp" value="${d}" aria-label="Expires"><input name="note" placeholder="Note (optional)" aria-label="Note"><span></span></div>
    <div class="acts"><button class="btn" type="button" data-m="no">Cancel</button><button class="btn prime" type="submit">Add</button></div></form></div>`;
  const form = root.querySelector('#mrForm');
  root.querySelector('[data-m="no"]').onclick = () => { root.innerHTML = ''; };
  form.onsubmit = wrap(async e => {
    e.preventDefault();
    const exp = form.exp.value ? new Date(`${form.exp.value}T23:59:00`).toISOString() : null;
    await api('/api/lite/reset/add', { plan: planId, expiresAt: exp, note: form.note.value });
    root.innerHTML = ''; await loadPlans(false); render(); toast('Added.');
  });
  form.exp.focus();
}

// The sidebar chip: which plan to use next, at a glance.
function renderChip() {
  const p = useNext('chatgpt') || useNext('claude') || metered()[0];
  if (!p) { $('chipWho').textContent = 'This week'; $('chipNote').textContent = S.plans ? 'No plan has room above the floor' : 'Reading plans…'; $('chipBar').style.width = '0%'; return; }
  $('chipWho').textContent = 'Use next';
  $('chipNote').textContent = `${p.label} ${famName(p.family)} · ${p.left}%${p.resetsAt ? ` · ${wd(p.resetsAt)}` : ''}`;
  $('usageBtn').title = `Use next: ${p.label} ${famName(p.family)}, ${p.left}% left${p.resetsAt ? `, resets ${dayName(p.resetsAt)}` : ''}`;
  $('chipBar').style.width = p.left + '%';
}

/* ---------- signing a Claude account in, without a terminal ----------
   Lite runs the login in the background; you open its link in a browser signed in to the right
   claude.ai account (a private window is safest), then paste the code it shows. */
async function signInFlow(planId) {
  const p = planById(planId) || { label: 'this account' };
  const root = $('modalRoot');
  const draw = (r, busy) => {
    const head = `<h3>Sign in ${esc(p.label)} Claude${r && r.email ? ` · ${esc(r.email)}` : ''}</h3>`;
    if (!r) { root.innerHTML = `<div class="modal-back"><div class="modal signin">${head}<p>Starting the sign-in…</p></div></div>`; return; }
    if (r.state === 'done') { root.innerHTML = `<div class="modal-back"><div class="modal signin">${head}<p class="ok">Signed in${r.signedInAs ? ` as <b>${esc(r.signedInAs)}</b>` : ''}. Its usage shows on Now in a moment.</p><div class="acts"><button class="btn prime" data-m="close">Done</button></div></div></div>`; return; }
    if (r.state === 'failed' || r.state === 'wrong' || !r.url) { root.innerHTML = `<div class="modal-back"><div class="modal signin">${head}<p class="warn">${esc(r.error || 'The sign-in didn’t start.')}</p><div class="acts"><button class="btn" data-m="close">Close</button><button class="btn prime" data-m="again">Start again</button></div></div></div>`; return; }
    const manual = `<div class="si-link"><input id="siManual" readonly value="${esc(r.manualUrl || r.url)}" aria-label="Link for another device"><button type="button" class="btn" data-m="copym">Copy</button></div>
          <div class="si-link"><input id="siCode" placeholder="Paste the code it shows" autocomplete="off" spellcheck="false" aria-label="Code"><button class="btn prime" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Finish'}</button></div>`;
    root.innerHTML = `<div class="modal-back"><form class="modal signin" id="siForm">${head}
      ${r.auto ? `<p>Open this link <b>on this Mac</b>, in a browser signed in to <b>${esc(r.email || 'the right account')}</b> on claude.ai (if it’s signed in to another account, use a private window). Approve, and it finishes here by itself.</p>
        <div class="si-link"><input id="siUrl" readonly value="${esc(r.url)}" aria-label="Sign-in link"><button type="button" class="btn" data-m="copy">Copy link</button><a class="btn prime" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a></div>
        <p class="si-wait">${r.state === 'checking' ? 'Checking the account…' : '<span class="live-dot"></span> Waiting for you to approve in the browser…'}</p>
        <details class="si-alt"><summary>Signing in on another device, or it showed you a code?</summary>${manual}</details>`
      : `<p>Open this link in a browser signed in to <b>${esc(r.email || 'the right account')}</b> on claude.ai (a private window if it’s signed in to another account), approve, then paste the code it shows.</p>${manual}`}
      <div class="acts"><button type="button" class="btn" data-m="close">Cancel</button></div></form></div>`;
  };
  let run = null;
  const startRun = async () => { draw(null); run = await api('/api/lite/signin/start', { account: planId }).catch(err => ({ state: 'failed', error: err.message })); draw(run); wire(); };
  const wire = () => {
    const back = root.querySelector('.modal-back'); if (!back) return;
    back.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'close') { if (run && run.id && run.state !== 'done') api('/api/lite/signin/cancel', { id: run.id }).catch(() => {}); root.innerHTML = ''; loadPlans(true).then(renderPlansOnly).catch(() => {}); }
      if (b.dataset.m === 'again') startRun();
      if (b.dataset.m === 'copy' || b.dataset.m === 'copym') {
        const i = $(b.dataset.m === 'copy' ? 'siUrl' : 'siManual'); i.select();
        try { await navigator.clipboard.writeText(i.value); b.textContent = 'Copied'; } catch { document.execCommand('copy'); b.textContent = 'Copied'; }
        setTimeout(() => { b.textContent = b.dataset.m === 'copy' ? 'Copy link' : 'Copy'; }, 1600);
      }
    });
    const f = $('siForm');
    // Approved in the browser on this Mac: the login finishes by itself; notice it here.
    clearTimeout(signInFlow.poll);
    if (f && run && run.id && run.auto) {
      const poll = async () => {
        if (!$('siForm')) return;
        const st = await api(`/api/lite/signin?id=${run.id}`).catch(() => null);
        if (st && st.state !== run.state) { const typed = $('siCode') ? $('siCode').value : ''; run = st; draw(run); wire(); if ($('siCode')) $('siCode').value = typed; if (run.state === 'done') { sfx('chip'); loadPlans(true).then(renderPlansOnly).catch(() => {}); } }
        if (run.state === 'waiting' || run.state === 'checking') signInFlow.poll = setTimeout(poll, 1500);
      };
      signInFlow.poll = setTimeout(poll, 1500);
    }
    if (f) {
      $('siUrl')?.addEventListener('focus', e => e.target.select());
      f.onsubmit = async e => {
        e.preventDefault();
        const code = $('siCode').value.trim(); if (!code) return $('siCode').focus();
        draw(run, true);
        run = await api('/api/lite/signin/code', { id: run.id, code }).catch(err => ({ ...run, state: 'failed', error: err.message }));
        draw(run); wire();
        if (run.state === 'done') { sfx('chip'); loadPlans(true).then(renderPlansOnly).catch(() => {}); }
      };
    }
  };
  await startRun();
}
