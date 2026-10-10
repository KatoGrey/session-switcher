'use strict';
/* The conversation map: a slim strip beside a long chat, with a mark for each of your messages, each
   hand-over between Claude and Codex, each picture made, warnings, and the replies themselves (faint, in
   each one's color), plus the part you're looking at. Click a mark to go to it, or anywhere on the strip
   to jump to that point. It shows only when the chat is long enough to need it, and not on a phone. */

const ChatMap = { timer: 0, marks: [] };
const firstLine = el => (el.innerText || '').trim().split('\n').find(Boolean) || '';
function mapMarks() {
  const out = [];
  for (const el of $c('cFeed').children) {
    if (el.classList.contains('umsg')) out.push({ el, kind: `you${el.classList.contains('to-partner') ? ' to-partner' : ''}`, tip: `You: ${firstLine(el).slice(0, 90)}` });
    else if (el.classList.contains('handover')) out.push({ el, kind: `hand ${el.dataset.prov || ''}`, tip: firstLine(el) });
    else if (el.classList.contains('turn')) {
      out.push({ el, kind: `turn ${el.dataset.prov || C.provider}`, tip: '' });
      for (const g of el.querySelectorAll('.gen')) out.push({ el: g, kind: 'pic', tip: 'A picture' });
    } else if (el.classList.contains('cnotice') && /\b(warning|error)\b/.test(el.className)) out.push({ el, kind: 'warn', tip: firstLine(el).slice(0, 90) });
  }
  return out;
}
function drawMap() {
  const map = $c('cMap'), sc = $c('cScroll'); if (!map || !sc) return;
  const H = sc.scrollHeight, h = sc.clientHeight;
  const show = !$c('chat').hidden && H > h * 1.6 && sc.clientWidth > 620;
  map.hidden = !show;
  if (!show) { ChatMap.marks = []; return; }
  const len = h - 24, top = sc.offsetTop + 12, base = sc.getBoundingClientRect().top - sc.scrollTop;
  map.style.top = `${top}px`; map.style.height = `${len}px`;
  const marks = mapMarks();
  ChatMap.marks = marks;
  map.innerHTML = `<span class="cm-view"></span>${marks.map((m, i) => `<i class="cm ${m.kind}" data-i="${i}" style="top:${(((m.el.getBoundingClientRect().top - base) / H) * len).toFixed(1)}px"${m.tip ? ` title="${esc(m.tip)}"` : ''}></i>`).join('')}`;
  viewMap();
}
function viewMap() {
  const map = $c('cMap'), sc = $c('cScroll'), v = map && !map.hidden && map.querySelector('.cm-view'); if (!v) return;
  const len = sc.clientHeight - 24, H = sc.scrollHeight, max = Math.max(0, H - sc.clientHeight);
  const thumb = Math.min(len, Math.max(16, (sc.clientHeight / H) * len));
  const fraction = max ? Math.max(0, Math.min(1, sc.scrollTop / max)) : 0;
  v.style.transform = `translateY(${(fraction * (len - thumb)).toFixed(1)}px)`;
  v.style.height = `${thumb.toFixed(1)}px`;
  map.setAttribute('aria-valuemax', String(max));
  map.setAttribute('aria-valuenow', String(Math.round(sc.scrollTop)));
  map.setAttribute('aria-valuetext', `${Math.round(fraction * 100)}% through the conversation`);
}
// Redrawn a moment after the chat changes (not on every streamed word).
// While a reply streams in, less often still: it only nudges the marks.
function mapSoon() { if (ChatMap.timer) return; ChatMap.timer = setTimeout(() => { ChatMap.timer = 0; requestAnimationFrame(drawMap); }, C.state === 'busy' ? 1200 : 450); }
(function startMap() {
  const sc = $c('cScroll');
  sc.parentElement.insertAdjacentHTML('beforeend', '<div class="c-map" id="cMap" role="scrollbar" aria-label="Conversation map" aria-controls="cScroll" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" tabindex="0" hidden></div>');
  new MutationObserver(mapSoon).observe($c('cFeed'), { childList: true, subtree: true });
  const resized = new ResizeObserver(mapSoon);
  resized.observe(sc);
  // Images and fonts can change message heights without a DOM mutation or resizing the scroller.
  resized.observe($c('cFeed'));
  sc.addEventListener('scroll', () => requestAnimationFrame(viewMap), { passive: true });
  $c('cMap').addEventListener('keydown', e => {
    const steps = { ArrowUp: -48, ArrowDown: 48, PageUp: -sc.clientHeight * .8, PageDown: sc.clientHeight * .8 };
    if (e.key !== 'Home' && e.key !== 'End' && !(e.key in steps)) return;
    e.preventDefault(); e.stopPropagation();
    sc.scrollTo({ top: e.key === 'Home' ? 0 : e.key === 'End' ? sc.scrollHeight : sc.scrollTop + steps[e.key], behavior: motionOk() ? 'smooth' : 'auto' });
  });
  $c('cMap').addEventListener('click', e => {
    const m = e.target.dataset && e.target.dataset.i !== undefined ? ChatMap.marks[+e.target.dataset.i] : null;
    const smooth = motionOk() ? 'smooth' : 'auto';
    if (m && m.el.isConnected) {
      m.el.scrollIntoView({ block: m.kind === 'pic' ? 'center' : 'start', behavior: smooth });
      m.el.classList.remove('cm-flash'); void m.el.offsetWidth; m.el.classList.add('cm-flash');
      setTimeout(() => m.el.classList.remove('cm-flash'), 1200);
      return;
    }
    const r = $c('cMap').getBoundingClientRect();
    sc.scrollTo({ top: ((e.clientY - r.top) / r.height) * sc.scrollHeight - sc.clientHeight / 2, behavior: smooth });
  });
})();
