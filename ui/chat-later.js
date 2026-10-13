'use strict';
/* Do this later: the next steps a reply mentions ("we should also add a test…") become tasks, each
   its own chat later, in this project, so this chat stays on track and nothing is forgotten. The
   reply's own list of next steps is offered to tick (or what you selected in it), and each task takes
   this chat's latest messages along as background. The reply then says what's queued from it. */

// The steps a reply suggests: its list items (the last list, where next steps usually are), else
// sentences that sound like one ("should", "next", "also", "TODO"…).
function laterSteps(md) {
  // Code blocks aren't steps.
  const lines = String(md || '').replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?(?:^\s*\1[^\n]*$|(?![\s\S]))/gm, '').split('\n');
  const lists = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s+)?(.+)$/);
    if (m) { if (!cur) lists.push(cur = []); cur.push(m[1].replace(/\*\*/g, '').trim()); } else if (l.trim()) cur = null;
  }
  const list = lists.length ? lists[lists.length - 1] : [];
  if (list.length) return list.filter(x => x.length > 3).slice(0, 8);
  const text = lines.filter(l => !/^\s*(```|#|>|\|)/.test(l)).join(' ').replace(/\*\*/g, '');
  // Sentence by sentence (a file name's dot isn't an end). A question to you ("Should I make the
  // change?") isn't a step, nor is a lead-in ending in a colon.
  const KEY = /\b(should|could|next|also|later|todo|follow[- ]up|consider|worth|still)\b/i;
  return text.replace(/`/g, '').replace(/(\w)\.(\w)/g, '$1․$2').split(/(?<=[.!?:])\s+/)
    .map(x => x.replace(/․/g, '.').trim())
    .filter(x => KEY.test(x) && /[.!]$/.test(x) && x.length > 12 && x.length < 400 && !/^(should|shall|do|would|can|want) (i|we|you)\b/i.test(x)).slice(-5);
}
// "Tonight" and "Tomorrow morning", as times.
function laterAt(which) {
  const d = new Date();
  if (which === 'tonight') { d.setHours(22, 0, 0, 0); if (d < Date.now() + 15 * 60000) d.setDate(d.getDate() + 1); }
  if (which === 'morning') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return d.toISOString();
}

function laterDialog() {
  let d = $('laterDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="laterDlg" class="wide later-dlg" aria-labelledby="ltTitle"><form method="dialog" id="ltForm">
    <div class="setup-head"><h3 id="ltTitle">Do this later</h3><button type="button" class="icon" data-lt="close" aria-label="Close">✕</button></div>
    <div class="tk-body">
      <p class="rd-intro" id="ltIntro"></p>
      <div class="lt-steps" id="ltSteps"></div>
      <label class="tk-prompt">Something else<textarea id="ltOwn" rows="2" placeholder="Anything else to do later, in your words."></textarea></label>
      <div class="lt-row"><label>Who<select id="ltWho"></select></label>
        <div class="lt-when" role="radiogroup" aria-label="When"><span class="lt-k">When</span>${[['now', 'When there’s room'], ['tonight', 'Tonight'], ['morning', 'Tomorrow morning'], ['at', 'Pick a time']].map(([v, l], i) => `<label class="lt-chip"><input type="radio" name="ltWhen" value="${v}"${i ? '' : ' checked'}> ${l}</label>`).join('')}<input type="datetime-local" id="ltAt" hidden aria-label="Time"></div></div>
      <div class="d-row"><span class="spacer"></span><button type="button" class="btn" data-lt="close">Cancel</button><button type="submit" class="btn prime" id="ltGo">Queue it</button></div>
    </div></form></dialog>`);
  d = $('laterDlg');
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-lt="close"]')) d.close(); });
  d.addEventListener('change', e => {
    if (e.target.name === 'ltWhen') $('ltAt').hidden = e.target.value !== 'at';
    laterCount();
  });
  d.addEventListener('input', laterCount);
  return d;
}
// The button says how many it queues.
function laterCount() {
  const n = $('laterDlg').querySelectorAll('#ltSteps input[type="checkbox"]:checked').length + ($('ltOwn').value.trim() ? 1 : 0);
  $('ltGo').textContent = n > 1 ? `Queue ${n} tasks` : 'Queue it';
  $('ltGo').disabled = !n;
}
async function openLaterDialog(turn) {
  const cwd = C.info && C.info.cwd;
  const proj = cwd && S.projects.find(p => p.exists && normPath(p.cwd).replace(/\/+$/, '') === normPath(cwd).replace(/\/+$/, ''));
  if (!proj) { toast('This chat’s folder isn’t one of your projects, so it can’t queue work for it.', 5000); return; }
  const d = laterDialog();
  const sel = getSelection();
  const picked = sel && !sel.isCollapsed && turn.contains(sel.anchorNode) ? sel.toString().trim() : '';
  const steps = picked ? [picked] : laterSteps(turnMarkdown(turn));
  const project = proj.name || base(proj.cwd);
  $('ltIntro').innerHTML = `Each one starts later as <b>its own chat</b> in ${esc(project)}, knowing this chat’s latest messages, so this chat stays on track. They wait under <b>Queued</b> on the hub, and this reply shows what’s queued from it.`;
  $('ltSteps').innerHTML = steps.length
    ? `<p class="lt-h">${picked ? 'What you selected' : 'Next steps from this reply'}</p>${steps.map((x, i) => `<label class="lt-step"><input type="checkbox" ${picked || i === 0 ? 'checked' : ''}><textarea rows="1" aria-label="Step ${i + 1}">${esc(x)}</textarea></label>`).join('')}`
    : '<p class="lt-none">This reply doesn’t list next steps. Write what to do below (or select part of the reply first).</p>';
  $('ltOwn').value = '';
  $('ltWho').innerHTML = `<option value="claude">Claude</option>${S.codex && S.codex.enabled ? `<option value="codex"${codexReady() ? '' : ' disabled'}>Codex</option>` : ''}`;
  $('ltWho').value = turn.dataset.prov === 'codex' && codexReady() ? 'codex' : 'claude';
  d.querySelector('[name="ltWhen"][value="now"]').checked = true; $('ltAt').hidden = true;
  const soon = new Date(Date.now() + 3600e3); soon.setMinutes(0, 0, 0);
  $('ltAt').value = new Date(soon - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  for (const ta of d.querySelectorAll('.lt-step textarea')) { ta.style.height = 'auto'; }
  laterCount();
  d.showModal();
  for (const ta of d.querySelectorAll('.lt-step textarea')) ta.style.height = `${ta.scrollHeight}px`;
  const mid = [...turn.querySelectorAll('.part[data-mid]')].map(p => p.dataset.mid).pop() || null;
  const done = await new Promise(res => {
    const form = $('ltForm');
    const go = e => { e.preventDefault(); res(true); };
    form.addEventListener('submit', go, { once: true });
    d.addEventListener('close', () => { form.removeEventListener('submit', go); res(false); }, { once: true });
  });
  if (!done) return;
  const items = [...d.querySelectorAll('.lt-step')].filter(l => l.querySelector('input').checked).map(l => l.querySelector('textarea').value.trim()).filter(Boolean);
  if ($('ltOwn').value.trim()) items.push($('ltOwn').value.trim());
  const when = d.querySelector('[name="ltWhen"]:checked').value;
  const at = when === 'at' ? ($('ltAt').value ? new Date($('ltAt').value).toISOString() : null) : when === 'now' ? null : laterAt(when);
  const from = { id: C.sessionId, title: $c('cTitle').textContent || '', mid };
  d.close();
  let r = null;
  for (const text of items) r = await api('/api/tasks', { action: 'add', task: { cwd: proj.cwd, provider: $('ltWho').value, accountId: 'auto', prompt: text, when: at ? 'at' : 'now', at, from } });
  if (r) { S.tasks = r.tasks; renderQueue(); }
  laterMarks();
  const startText = at ? whenText(at) : 'as soon as an account has room';
  toast(`${items.length === 1 ? 'Queued' : `Queued ${items.length} tasks`}: starting ${startText}. They’re under Queued on the hub.`, 5000);
}
// Under each reply: what's queued from it (and what's started), from the queue itself.
function laterMarks() {
  const feed = $c('cFeed'); if (!feed || !C.sessionId) return;
  for (const m of feed.querySelectorAll('.later-mark')) m.remove();
  const mine = (S.tasks || []).filter(t => t.from && t.from.id && t.from.id.toLowerCase() === C.sessionId.toLowerCase() && t.from.mid);
  const byMid = new Map();
  for (const t of mine) (byMid.get(t.from.mid) || byMid.set(t.from.mid, []).get(t.from.mid)).push(t);
  for (const [mid, list] of byMid) {
    const part = feed.querySelector(`.part[data-mid="${CSS.escape(mid)}"]`), turn = part && part.closest('.turn');
    if (!turn) continue;
    const q = list.filter(t => t.state === 'queued').length, started = list.filter(t => t.state === 'started').length;
    turn.insertAdjacentHTML('beforeend', `<p class="later-mark"><span class="glyph" aria-hidden="true">⏳</span>${[q ? `${q} queued for later` : '', started ? `${started} started` : '', list.length - q - started ? `${list.length - q - started} couldn’t start` : ''].filter(Boolean).join(' · ') || 'Queued for later'}: ${list.slice(0, 3).map(t => `<i>${esc(t.prompt.split('\n')[0].slice(0, 60).trim())}</i>`).join(', ')}${list.length > 3 ? '…' : ''} <button type="button" class="linkish" data-c="laterhub">See the queue</button></p>`);
  }
}
