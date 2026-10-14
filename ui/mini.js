'use strict';
/* The mini window: a small card that floats over every other app (Chrome and Edge's picture-in-picture
   for pages), in the theme's own colors and lettering: what needs you (approvals answered right there),
   what's at work, and how much room the account has. Click a chat to bring Session Switcher forward
   on it. Ctrl+K: "Open the mini window". */

const Mini = { win: null, timer: 0, h: '' };
// In the installed app it's a small window of the app's own that stays on top; in Chrome or Edge, the
// browser's picture-in-picture for pages.
const miniOK = () => !!window.desktop || 'documentPictureInPicture' in window;

async function openMini() {
  if (!miniOK()) { toast('This browser can’t float a window over other apps. Chrome and Edge can.', 5000); return; }
  if (Mini.win) { Mini.win.focus(); return; }
  const w = window.desktop ? window.open('', 'ss-mini', 'popup,width=340,height=320') : await documentPictureInPicture.requestWindow({ width: 340, height: 300 });
  if (!w) { toast('The mini window couldn’t open.', 4000); return; }
  Mini.win = w; Mini.h = '';
  const d = w.document;
  // The page's own look: its stylesheet, its fonts and the theme's colors.
  d.head.insertAdjacentHTML('beforeend', `<meta charset="utf-8"><title>Session Switcher</title><link rel="stylesheet" href="/styles.css">`);
  const fonts = document.getElementById('fontPack');
  if (fonts) { const st = d.createElement('style'); st.textContent = fonts.textContent; d.head.appendChild(st); }
  syncMiniLook();
  d.body.className = 'mini';
  d.body.innerHTML = '<main class="mini-in" aria-live="polite"></main>';
  d.addEventListener('click', e => miniClick(e).catch(err => toast(err.message)));
  const gone = () => { Mini.win = null; clearInterval(Mini.timer); };
  w.addEventListener('pagehide', gone);
  w.addEventListener('beforeunload', gone);
  Mini.timer = setInterval(() => { if (w.closed) gone(); else renderMini(); }, 1500);
  renderMini();
}
// The theme as it is in the main window (colors are variables on the root, the rest data attributes).
function syncMiniLook() {
  if (!Mini.win) return;
  const from = document.documentElement, to = Mini.win.document.documentElement;
  to.style.cssText = from.style.cssText;
  for (const a of ['theme', 'mode', 'family', 'sky', 'art']) { if (from.dataset[a]) to.dataset[a] = from.dataset[a]; else delete to.dataset[a]; }
  to.className = from.className;
}
document.addEventListener('lookchange', () => { syncMiniLook(); Mini.h = ''; renderMini(); });

function renderMini() {
  const w = Mini.win; if (!w) return;
  const box = w.document.querySelector('.mini-in'); if (!box) return;
  const needs = S.activity.filter(x => NEEDS.has(ownStatus(x)));
  const working = atWork(), a = current();
  const row = x => {
    const p = (x.pending || [])[0], approve = ownStatus(x) === 'approve' && p && p.requestId;
    return `<li class="mn-i ${NEEDS.has(ownStatus(x)) ? 'needs' : 'work'}"><button type="button" class="mn-t" data-mini="${esc(keyOf(x))}" title="Open it in Session Switcher">${esc(x.title || 'A chat')}<small>${esc(approve ? wantsTo(p) : x.folder || '')}</small></button>${approve ? `<span class="mn-b"><button type="button" class="btn sm gilt" data-mini-a="allow" data-k="${esc(keyOf(x))}">Allow</button><button type="button" class="btn sm" data-mini-a="deny" data-k="${esc(keyOf(x))}">Deny</button></span>` : ''}</li>`;
  };
  const h = `<header class="mn-h"><svg class="mn-seal" aria-hidden="true"><use href="#sigil"/></svg><b>${esc(voice('Right now'))}</b><span class="mn-n"><i class="needs">${needs.length}</i> · <i>${working.length}</i></span></header>
    ${needs.length ? `<p class="mn-k">${esc(voice('Awaiting you'))}</p><ul>${needs.slice(0, 4).map(row).join('')}</ul>` : `<p class="mn-quiet">${esc(voice('Nothing needs you yet.'))}</p>`}
    ${working.length ? `<p class="mn-k">${esc(voice('At work'))}</p><ul>${working.slice(0, 3).map(row).join('')}</ul>` : ''}
    ${a ? `<p class="mn-u">${esc(a.name)} · ${esc(usageLine(a.id, { short: true }) || '')}</p>` : ''}`;
  if (h === Mini.h) return;
  Mini.h = h;
  box.innerHTML = h;
  // The seal's symbol lives in the main page; the mini window gets its own copy.
  const sig = document.getElementById('sigil');
  if (sig && !w.document.getElementById('sigil')) w.document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${sig.outerHTML}</defs></svg>`);
}
async function miniClick(e) {
  const t = e.target;
  const ab = t.closest('[data-mini-a]');
  if (ab) {
    const x = findActivity(ab.dataset.k), p = x && (x.pending || [])[0]; if (!p) return;
    ab.disabled = true;
    await api('/api/chat/permission', { key: x.key, requestId: p.requestId, decision: ab.dataset.miniA, message: '' });
    return;
  }
  const o = t.closest('[data-mini]');
  if (o) { const x = findActivity(o.dataset.mini); if (window.desktop) window.desktop.show(); else window.focus(); if (x) openActivity(x); }
}
