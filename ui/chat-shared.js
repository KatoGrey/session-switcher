'use strict';
/* One conversation, two assistants: Claude and Codex in one chat, either way round. The app on the PC
   catches each one up on what the other said and did before each message (lib/pairs.js); a message
   carries that in a <shared-context> block, shown here as a small fold-out, not as text you wrote.
   "Both" has them take turns: the chat's own assistant answers, then the other picks it up. */

// "<shared-context items="2">…</shared-context>" at the start of a message, and what follows it.
const SHARED_TAG = /^\s*<shared-context(?:\s+items="(\d+)")?[^>]*>\n?([\s\S]*?)(?:\n?<\/shared-context>\s*|$)/;
function splitShared(text) {
  const s = String(text || '');
  const m = /^\s*<shared-context/.test(s) && s.match(SHARED_TAG);
  return m ? { items: Number(m[1]) || 0, context: m[2].trim(), own: s.slice(m[0].length) } : { items: 0, context: '', own: s };
}
// "Both": the line where the second one picks your message up, after the first one's answer.
function handoverHtml(prov, sh) {
  const caught = sh.items ? `<details class="shared"><summary>caught up on ${sh.items} message${sh.items === 1 ? '' : 's'}</summary><div class="sh-body">${plain(sh.context)}</div></details>` : '';
  return `<div class="handover${liveRender ? ' fresh' : ''}" data-prov="${prov}" role="note"><span class="ho-arrow" aria-hidden="true">↳</span><span class="ho-t"><b>${PROV_NAME[prov]}</b> takes it from here</span>${caught}</div>`;
}
// "Both": your latest message says it went to the first, then the other.
function markBoth(to) {
  const u = [...$c('cFeed').querySelectorAll('.umsg:not(.to-partner)')].pop();
  if (!u) return;
  u.classList.add('to-both');
  const label = `to ${PROV_NAME[C.provider]}, then ${PROV_NAME[to]}`, tag = u.querySelector('.to-tag');
  if (tag) tag.textContent = label; else u.insertAdjacentHTML('afterbegin', `<span class="to-tag">${label}</span>`);
}

// The ones your next message goes to (Codex counts even before its helper has started).
function targetsNow() {
  const main = { key: C.key, state: C.state, name: PROV_NAME[C.provider] };
  const comp = { key: C.comp && !C.comp.ended ? C.comp.key : null, state: C.comp && !C.comp.ended ? C.comp.state : 'ready', name: PROV_NAME[partnerProv()] };
  if (!duo() || C.target === 'main') return [main];
  return C.target === 'comp' ? [comp] : [main, comp];
}

// A message sent to both at once (before they took turns) arrives twice, once from each; the second
// joins the first, which then reads "to Claude & Codex". True if it joined (so it isn't drawn again).
function joinBoth(root, toPartner, own, at) {
  for (let prev = root.lastElementChild, n = 0; prev && n < 6; prev = prev.previousElementSibling, n++) {
    if (!prev.classList.contains('umsg') || prev.classList.contains('to-both')) continue;
    if (prev.classList.contains('to-partner') === toPartner) continue;
    if ((RAW.get(prev) || '').trim() !== own.trim() || Math.abs((prev._at || 0) - at) > 120000) continue;
    prev.classList.remove('to-partner', 'to-codex', 'to-claude'); prev.classList.add('to-both');
    const label = `to ${PROV_NAME[C.provider]} & ${PROV_NAME[partnerProv()]}`, tag = prev.querySelector('.to-tag');
    if (tag) tag.textContent = label;
    else prev.insertAdjacentHTML('afterbegin', `<span class="to-tag">${label}</span>`);
    return true;
  }
  return false;
}
