'use strict';
// The layout audit: goes round every page and dialog, in both layouts, at a desktop's, a small laptop's and a phone's
// size, and notes the kind of fault a person sees as "glitchy" rather than "broken":
//   loose      something placed (position: absolute) inside a scrolling box that isn't kept to it, so it shows
//              outside it or gives an outer box a scroll bar of its own (Setup's second scroll bar, 6.13.0)
//   nested     a dialog or panel that scrolls itself while a box inside it scrolls too (two scroll bars)
//   sideways   the page, or a dialog, wider than the screen
//   offscreen  a button or field partly off the side of the screen
//   cut        a button's or label's words cut off without an ellipsis
//   covered    a button whose middle something else sits on
//   sticky     a header that stays at the top of a scrolled box, cut off by its edge
//   unnamed    a control a screen reader has nothing to call, or a picture without alt words
// Run by name (node tests/run.js "layout audit"); it writes what it found to AUDIT (a file) or prints it.
const fs = require('fs');
const { sleep } = require('./browser');
const demo = require('./demo');
const { responder } = require('./work.ui');

// Runs in the page. Looks inside the top open dialog if there is one, else the whole page.
function audit() {
  const out = [];
  const dlgs = [...document.querySelectorAll('dialog[open]')];
  const scope = dlgs.length ? dlgs[dlgs.length - 1] : document.body;
  // (Shown: not in a closed <details>, whose insides still answer where they'd be, nor hidden, inert or set aside.)
  const vis = el => el.getClientRects().length > 0 && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: false }) : getComputedStyle(el).visibility !== 'hidden') && !el.closest('[inert],[aria-hidden="true"]');
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const path = el => { const a = []; for (let p = el; p && p !== document.body && a.length < 4; p = p.parentElement) a.unshift(name(p)); return a.join(' > '); };
  const clips = s => /auto|scroll|hidden|clip/.test(s.overflowY) || /auto|scroll|hidden|clip/.test(s.overflowX);
  const scrollerOf = el => { for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (clips(getComputedStyle(p))) return p; return null; };
  const scrollsY = el => { const s = getComputedStyle(el); return /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1; };
  const all = [...scope.querySelectorAll('*')].filter(vis);
  const W = innerWidth, H = innerHeight;
  for (const el of all) {
    const cs = getComputedStyle(el);
    // loose
    if (cs.position === 'absolute') {
      const s = scrollerOf(el), op = el.offsetParent;
      if (s && !(op && (op === s || s.contains(op)))) {
        const r = el.getBoundingClientRect(), q = s.getBoundingClientRect();
        const outside = r.bottom > q.bottom + 1 || r.top < q.top - 1 || r.right > q.right + 1 || r.left < q.left - 1;
        if (outside || scrollsY(s) || s.scrollWidth > s.clientWidth + 1) out.push({ kind: 'loose', el: path(el), note: `escapes ${name(s)}${outside ? ', and shows outside it' : ''}` });
      }
    }
    // nested: a dialog or fixed panel that scrolls itself and has a big scrolling box inside
    if ((el.tagName === 'DIALOG' || cs.position === 'fixed') && scrollsY(el)) {
      const inner = [...el.querySelectorAll('*')].find(d => vis(d) && scrollsY(d) && d.clientHeight > el.clientHeight * 0.4);
      if (inner) out.push({ kind: 'nested', el: path(el), note: `scrolls ${el.scrollHeight - el.clientHeight}px itself, around ${name(inner)}` });
    }
    // offscreen / cut / covered: things you press or read on a control
    if (el.matches('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) {
        const s = scrollerOf(el);
        const sideScroll = s && /auto|scroll/.test(getComputedStyle(s).overflowX);
        if (!sideScroll && (r.left < -1 || r.right > W + 1) && !el.closest('.nav,[popover]')) out.push({ kind: 'offscreen', el: path(el), note: `${Math.round(r.left)}..${Math.round(r.right)} of ${W}` });
        // (What can be seen of it: inside every box that clips it, not only the nearest.)
        const q = { top: 0, bottom: H, left: 0, right: W };
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (clips(getComputedStyle(p))) { const c = p.getBoundingClientRect(); q.top = Math.max(q.top, c.top); q.bottom = Math.min(q.bottom, c.bottom); q.left = Math.max(q.left, c.left); q.right = Math.min(q.right, c.right); }
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inView = cx > q.left + 2 && cx < q.right - 2 && cy > q.top + 2 && cy < q.bottom - 2;
        if (inView && cs.pointerEvents !== 'none' && !el.disabled) {
          const at = document.elementFromPoint(cx, cy);
          // (Not what's behind an overlay: a chat, Ctrl+K or a dialog over the page covers it on purpose.)
          const layer = x => { for (let p = x; p; p = p.parentElement) { if (p.tagName === 'DIALOG' || p.matches('[popover]') || getComputedStyle(p).position === 'fixed') return p; } return null; };
          // (Nor what's scrolled under a header that stays put.)
          const sticky = x => { for (let p = x; p && p !== scope; p = p.parentElement) if (getComputedStyle(p).position === 'sticky') return p; return null; };
          const behind = at && ((layer(at) && !layer(at).contains(el)) || (sticky(at) && !sticky(at).contains(el)));
          if (at && !behind && at !== el && !el.contains(at) && !at.contains(el) && !(el.labels && [...el.labels].some(l => l.contains(at)))) {
            const lab = el.closest('label');
            if (!(lab && lab.contains(at))) out.push({ kind: 'covered', el: path(el), note: `under ${path(at)}` });
          }
        }
      }
    }
    // unnamed: a control a screen reader can't name, or a picture without alt words
    if (el.matches('button, a[href], select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"]')) {
      const named = (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('aria-labelledby') || '').split(/\s+/).some(i => i && document.getElementById(i) && document.getElementById(i).textContent.trim())
        || (el.labels && [...el.labels].some(l => l.textContent.trim())) || (el.title || '').trim() || (el.matches('button, a, [role="button"], [role="tab"]') && (el.textContent.trim() || [...el.querySelectorAll('img[alt]')].some(i => i.alt.trim())))
        || (el.matches('input[type="submit"], input[type="button"]') && el.value.trim());
      if (!named) out.push({ kind: 'unnamed', el: path(el), note: el.matches('input, select, textarea') ? `a ${el.tagName.toLowerCase()}${el.type ? ` (${el.type})` : ''} with no label` : 'nothing to read out' });
    }
    if (el.tagName === 'IMG' && !el.hasAttribute('alt')) out.push({ kind: 'unnamed', el: path(el), note: 'a picture without alt' });
    // sticky: a header that stays at the top of a scrolled box, but cut off by its edge
    if (cs.position === 'sticky') {
      const s = scrollerOf(el);
      if (s && s.scrollTop > 0) { const r = el.getBoundingClientRect(), q = s.getBoundingClientRect(); if (r.top < q.top - 1 && r.bottom > q.top) out.push({ kind: 'sticky', el: path(el), note: `${Math.round(q.top - r.top)}px of it above the top of ${name(s)}` }); }
    }
    if (el.matches('button, [role="tab"], label, .btn, h1, h2, h3, th, .chip, .pill') && !el.matches('.sr') && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0 && el.textContent.trim()) {
      out.push({ kind: 'cut', el: path(el), note: `${el.scrollWidth} wide in ${el.clientWidth}: “${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)}”` });
    }
  }
  // sideways
  if (scope === document.body) { if (document.documentElement.scrollWidth > W + 1) out.push({ kind: 'sideways', el: 'page', note: `${document.documentElement.scrollWidth} wide in ${W}` }); }
  else if (scope.scrollWidth > scope.clientWidth + 1) out.push({ kind: 'sideways', el: path(scope), note: `${scope.scrollWidth} wide in ${scope.clientWidth}` });
  else { const r = scope.getBoundingClientRect(); if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) out.push({ kind: 'sideways', el: path(scope), note: `the dialog itself is ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)} on a ${W}x${H} screen` }); }
  return out;
}

module.exports = [{
  name: 'layout audit',
  onlyByName: true,
  async run(t) {
    const found = new Map();   // kind + element + note → where it was seen
    const sizes = [['desktop', { width: 1440, height: 900 }], ['laptop', { width: 1100, height: 700 }], ['phone', { width: 390, height: 844, mobile: true }]];
    const id = JSON.stringify(demo.ID['s-bard']);
    const places = [
      ['hub', `await go('hub')`],
      ['recent', `await go('recent')`],
      ['routines', `await go('routines')`],
      ['your work', `await go('work')`],
      ['a project', `await go('folder', S.projects[0].cwd)`],
      ['a chat', `await ChatUI.open({ sessionId: ${id} })`, `ChatUI.close()`],
      ['a chat, side panel', `await ChatUI.open({ sessionId: ${id} }); if (document.getElementById('chat').classList.contains('no-ledger')) document.querySelector('[data-c="ledger"]')?.click()`, `ChatUI.close()`],
      ['Setup', `await openSetup()`, `document.getElementById('setup').close()`],
      ['Setup, scrolled to the end', `await openSetup(); await new Promise(r => setTimeout(r, 900)); const sb = document.getElementById('setupBody'); sb.scrollTop = sb.scrollHeight`, `document.getElementById('setup').close()`],
      ['Setup, Appearance', `await openSetup(); await new Promise(r => setTimeout(r, 600)); document.querySelector('[data-stab="look"]').click()`, `document.getElementById('setup').close()`],
      ['New chat', `openNewChat()`, `document.querySelector('dialog[open]')?.close()`],
      ['New project', `await openNewProject()`, `document.querySelector('dialog[open]')?.close()`],
      ['Connections', `await openConnections()`, `document.querySelector('dialog[open]')?.close()`],
      ['Rules and tools', `await openRules()`, `document.querySelector('dialog[open]')?.close()`],
      ['Subagents', `await openSubagents()`, `document.querySelector('dialog[open]')?.close()`],
      ['Queue a task', `openTaskDialog()`, `document.querySelector('dialog[open]')?.close()`],
      ['Race', `openRaceDialog()`, `document.querySelector('dialog[open]')?.close()`],
      ['Prompts', `openPromptEditor()`, `document.querySelector('dialog[open]')?.close()`],
      ['Keyboard shortcuts', `openShortcuts()`, `document.querySelector('dialog[open]')?.close()`],
      ['Ctrl+K', `openPalette()`, `closePalette()`],
    ];
    // AUDIT_LOOKS: looks to go round in, as Look.set takes them (a JSON list); the main look by default. The new layout
    // is only for the main themes, so another theme family goes round in its own layout.
    const looks = process.env.AUDIT_LOOKS ? JSON.parse(process.env.AUDIT_LOOKS) : [{}];
    for (const look of looks) for (const next of [false, true]) {
      if (next && look.theme && !/^studio|^(paper|midnight|sage|gold|garnet|crema)$/.test(look.theme)) continue;
      for (const [size, opts] of sizes) {
        const b = await t.open({ ...opts, state: 'busy', respond: responder() });
        await sleep(800);
        await b.eval(`Look.set(${JSON.stringify(look)}); Shell.setNext(${next}); return 1`); await sleep(400);
        for (const [where, open, close] of places) {
          const label = `${Object.values(look).join(' ') || 'main look'}, ${next ? 'new layout' : 'as before'}, ${size}: ${where}`;
          try {
            await b.eval(`${open}; return 1`); await sleep(1300);
            const note = (list, how) => { for (const f of list) {
              const k = `${f.kind} | ${f.el} | ${f.note.replace(/\d+(\.\d+)?px|\d+\.\.\d+|\d+ wide in \d+|\d+x\d+/g, '#')}`;
              if (!found.has(k)) found.set(k, { ...f, where: [] });
              found.get(k).where.push(label + how);
            } };
            note(await b.eval(`return (${audit.toString()})()`), '');
            // And with every box that scrolls scrolled halfway (headers that stay put, things that slide out of place).
            await b.eval(`const dl = [...document.querySelectorAll('dialog[open]')], scope = dl.length ? dl[dl.length - 1] : document.body;
              for (const el of [scope, ...scope.querySelectorAll('*')]) { const s = getComputedStyle(el); if (/auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 40) el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; }
              if (scope === document.body) scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2); return 1`); await sleep(500);
            note(await b.eval(`return (${audit.toString()})()`), ' (scrolled)');
            if (close) { await b.eval(`${close}; return 1`); await sleep(400); }
          } catch (err) { t.check(`${label}: opened`, false, err.message.slice(0, 200)); try { await b.eval(`document.querySelectorAll('dialog[open]').forEach(d => d.close()); return 1`); } catch { /* gone */ } }
        }
        await b.eval(`Shell.setNext(false); return 1`);
        b.close();
      }
    }
    const list = [...found.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.where.length - a.where.length);
    const text = list.map(f => `${f.kind.padEnd(9)} ${f.el}\n          ${f.note}\n          seen ${f.where.length}x: ${f.where.slice(0, 4).join('; ')}${f.where.length > 4 ? '; …' : ''}`).join('\n');
    if (process.env.AUDIT) fs.writeFileSync(process.env.AUDIT, `${list.length} findings\n\n${text}\n`);
    else console.log(text);
    const by = {}; for (const f of list) by[f.kind] = (by[f.kind] || 0) + 1;
    t.check(`found ${list.length} things to look at`, true, by);
    console.log('  ', JSON.stringify(by));
  },
}];
