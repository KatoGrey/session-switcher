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
  if (f.kind === 'untouched') return p.resetsAt ? `Untouched lately. All ${p.left}% resets ${wd(p.resetsAt)} unless you use it.` : `Untouched. Its week starts when you first use it.`;
  if (f.kind === 'dry') { const gap = (ms(p.resetsAt) - f.dryAt) / DAY; return `${basis} it’s gone ${r}% a day: at that pace it runs dry ${dayName(f.dryAt)}, about ${gap < 1 ? `${Math.round(gap * 24)} hours` : `${Math.round(gap * 10) / 10} days`} before it resets.`; }
  if (f.kind === 'onTarget') return `${basis} it’s gone ${r}% a day: it lands near empty right as it resets ${wd(p.resetsAt)}. Good use.`;
  return `${basis} it’s gone ${r}% a day: about ${f.atReset}% would be left at reset, so ${f.moreToUse}% more to use by ${wd(p.resetsAt)}.`;
}
const creditsOf = p => (p.credits && p.credits.list ? p.credits.list : []);
const manualOf = p => p.manualResets || [];

function planHtml(p) {
  if (p.unlimited) return `<div class="plan"><div class="top"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></div><small>${p.broken ? `<span class="warn">${esc(p.broken)}</span>` : 'Cloud models outside the weekly limits. ollama.com shows its own usage.'}</small></div>`;
  if (p.broken) return `<div class="plan broken"><div class="top"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></div><small class="warn">${esc(p.broken)}</small><a class="btn" href="/" style="align-self:flex-start">Open Setup in the full app</a></div>`;
  if (typeof p.left !== 'number') return `<div class="plan"><div class="top"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small></div><small class="checking">${p.checking ? 'Checking…' : p.error ? `<span class="err">${esc(p.error)}</span>` : 'No usage read yet.'}</small></div>`;
  const r = p.rank, next = r === 1;
  const fam = famName(p.family);
  const extra = [p.fiveLeft !== null && p.fiveLeft !== undefined ? `5-hour ${p.fiveLeft}%` : '', p.fableLeft !== null && p.fableLeft !== undefined ? `Fable ${p.fableLeft}%` : ''].filter(Boolean).join(' · ');
  const cr = creditsOf(p), mr = manualOf(p);
  const resets = cr.length ? `${cr.length} manual reset${cr.length === 1 ? '' : 's'} · first expires ${esc(dayName(cr[0].expiresAt))}`
    : p.credits && p.credits.count ? `${p.credits.count} manual resets`
    : mr.length ? `${mr.length} manual reset${mr.length === 1 ? '' : 's'} added by you`
    : p.family === 'claude' ? 'Resets: Claude Code doesn’t report them. <button class="linkish" data-addreset="' + esc(p.id) + '">Add yours</button>' : '';
  return `<div class="plan ${next ? 'lean' : ''} ${p.left <= floor() ? 'low' : ''}">
    <div class="top"><b>${esc(p.label)}</b><small>${esc(p.kind)}</small>${r ? `<span class="rank" title="Use-next order for ${esc(fam)}">${next ? 'Use next' : `#${r}`}</span>` : '<span class="rank done">At floor</span>'}</div>
    <div class="wk"><span class="bar"><i style="width:${p.left}%"></i><s style="left:${floor()}%"></s></span><span class="pct">${p.left}%</span></div>
    <small>left this week · ${p.resetsAt ? `resets ${esc(dayName(p.resetsAt))}, ${inWords(p.resetsAt)}` : 'week starts when first used'}${extra ? ` · ${extra}` : ''}</small>
    <small class="fc">${esc(forecastWords(p))}</small>
    ${resets ? `<small class="cred">${resets}</small>` : ''}
  </div>`;
}

function orderHtml() {
  return `<div class="order">${FAMS.map(([f, name]) => { const o = orderOf(f); return `<div><span class="fam">${name}</span>${o.map((p, i) => `<span class="step-chip ${i === 0 ? 'on' : ''}"><b>${i + 1}</b> ${esc(p.label)} <small>${p.left}%${p.resetsAt ? ` · resets ${esc(wd(p.resetsAt))}` : ''}</small></span>`).join('<span class="arrow">›</span>') || '<small>Every plan is at the floor</small>'}</div>`; }).join('')}
    <span class="crumb">Drain to <span class="seg" role="group" aria-label="Floor">${[10, 15, 20].map(d => `<button data-floor="${d}" aria-pressed="${floor() === d}">${d}%</button>`).join('')}</span> then move on</span></div>`;
}

function creditsHtml() {
  const withCodex = plans().filter(p => creditsOf(p).length);
  const claude = plans().filter(p => p.family === 'claude' && !p.broken);
  const all = withCodex.flatMap(p => creditsOf(p).map(c => ({ p, c }))).sort((a, b) => ms(a.c.expiresAt) - ms(b.c.expiresAt));
  const manual = plans().flatMap(p => manualOf(p).map(m => ({ p, m })));
  if (!all.length && !claude.length) return '';
  const first = all.length ? ms(all[0].c.expiresAt) : null;
  const soon = first ? all.filter(x => ms(x.c.expiresAt) - first < DAY) : [];
  const h = hackDates();
  const plan = first ? `<p><b>${soon.length} expire${soon.length === 1 ? 's' : ''} ${esc(dayName(first))}</b>${soon.length > 1 ? `, one on each of ${esc(soon.map(x => x.p.label).join(', '))}` : ''}.${h && first > ms(h.end) && first - ms(h.end) < 10 * DAY ? ` That’s ${Math.round((first - ms(h.end)) / DAY)} days after the hackathon: when a ChatGPT plan hits ${floor()}% during it with days to go before its weekly reset, reset it with the credit that expires first.` : ''} “Use one” always spends the plan’s credit that expires first, and says when that would waste it.</p>` : '';
  return `<div class="credits">
    <div class="top"><b>Manual resets</b><small>${all.length} on ChatGPT${manual.length ? ` · ${manual.length} on Claude` : ' · Claude: add by hand'}</small></div>
    ${plan}
    <div class="credit-list">${withCodex.map(p => `<span><b>${esc(p.label)}</b> ${creditsOf(p).map((c, i) => `<span class="chip-s ${i === 0 ? 'first' : ''}" title="Expires ${esc(new Date(ms(c.expiresAt)).toLocaleString('en-US'))}">${esc(md(c.expiresAt))}</span>`).join('')}<button class="btn sm use" data-usereset="${esc(p.id)}">Use one…</button></span>`).join('')}
      ${claude.map(p => `<span><b>${esc(p.label)} Claude</b> ${manualOf(p).map(m => `<span class="chip-s" title="${esc(m.note || 'Added by you')}">${m.expiresAt ? esc(md(m.expiresAt)) : 'no expiry'} <button class="linkish" data-delreset="${esc(m.id)}" aria-label="Remove">×</button></span>`).join('') || '<small style="color:var(--muted)">None recorded</small>'}<button class="btn sm use" data-addreset="${esc(p.id)}">Add a reset…</button></span>`).join('')}</div>
  </div>`;
}

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
