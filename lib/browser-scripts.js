'use strict';
// What the browser tools run inside a page (lib/browser.js sends them to a tab's own isolated world, which the
// page's scripts can't see or change and which keeps its state until the page changes). Each is a plain
// function, sent as source and called with JSON arguments. No page globals are touched.
//
// The helpers (H) give elements refs ("e12") that stay the same while the page lives, name elements the way
// a screen reader would (near enough), and tell what's visible.

/* eslint-disable no-undef */
function helpers() {
  if (window.__ssH && window.__ssH.v === 3) return window.__ssH;
  const byRef = new Map(), byEl = new WeakMap();
  let n = 0;
  const H = { v: 3 };
  H.ref = el => { let r = byEl.get(el); if (!r) { r = `e${++n}`; byEl.set(el, r); byRef.set(r, new WeakRef(el)); } return r; };
  H.el = r => {
    const w = byRef.get(String(r || '').replace(/^\[?ref=|\]$/g, ''));
    const el = w && w.deref();
    if (!el) throw new Error(`There’s no element ${r} on this page (refs last until the page changes): read the page again.`);
    if (!el.isConnected) throw new Error(`Element ${r} is no longer on the page: read it again.`);
    return el;
  };
  // Icon fonts write their icons as words (Voyage's "w_play", "w_wand"): they're not text anyone reads.
  const icons = s => String(s || '').replace(/\bw_[a-z][a-z0-9_]*/g, ' ');
  H.icons = icons;
  const clip = (s, n2) => { s = icons(s).replace(/\s+/g, ' ').trim(); return s.length > n2 ? `${s.slice(0, n2 - 1)}…` : s; };
  H.clip = clip;
  H.text = el => clip(el.textContent, 200);
  const TAGROLE = { A: 'link', BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox', IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', NAV: 'navigation', MAIN: 'main', DIALOG: 'dialog', LI: 'listitem', UL: 'list', OL: 'list', TABLE: 'table', FORM: 'form', LABEL: 'label', SUMMARY: 'button', OPTION: 'option', PROGRESS: 'progressbar', VIDEO: 'video', AUDIO: 'audio', CANVAS: 'canvas', IFRAME: 'frame' };
  H.role = el => {
    const r = el.getAttribute('role');
    if (r) return r.split(/\s+/)[0];
    if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return { checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button', image: 'button', hidden: '', file: 'button', color: 'button', search: 'searchbox' }[t] ?? 'textbox';
    }
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    return TAGROLE[el.tagName] || '';
  };
  const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'spinbutton', 'treeitem', 'listbox']);
  H.interactive = el => {
    const role = H.role(el);
    if (INTERACTIVE.has(role)) return true;
    if (el.tagName === 'INPUT' && el.type !== 'hidden') return true;
    if (el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex') && el.tagName !== 'DIV' && el.tagName !== 'SPAN')) return true;
    // A div or span made into a button by the page's own code: the pointer shows it.
    if ((el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'LI' || el.tagName === 'IMG' || el.tagName === 'SVG') && getComputedStyle(el).cursor === 'pointer') {
      const p = el.parentElement;
      return !(p && getComputedStyle(p).cursor === 'pointer');   // just the outermost one
    }
    return false;
  };
  H.name = el => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return clip(al, 120);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(x => x.textContent).join(' '); if (t.trim()) return clip(t, 120); }
    if (el.tagName === 'IMG') return clip(el.getAttribute('alt') || el.getAttribute('title') || '', 120);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && l.textContent.trim()) return clip(l.textContent, 120); }
      const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return clip(wrap.textContent, 120);
      if (el.placeholder) return clip(el.placeholder, 120);
      if (['button', 'submit', 'reset'].includes(el.type) && el.value) return clip(el.value, 120);
      return clip(el.getAttribute('title') || el.name || '', 120);
    }
    const t = clip(el.textContent, 120);
    return t || clip(el.getAttribute('title') || '', 120);
  };
  H.hidden = el => {
    for (let x = el; x && x !== document.documentElement; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return true;
      const s = getComputedStyle(x);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || s.contentVisibility === 'hidden') return true;
    }
    const r = el.getBoundingClientRect();
    return r.width < 1 && r.height < 1 && getComputedStyle(el).overflow !== 'visible';
  };
  H.inert = el => !!el.closest('[inert]');
  H.box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), top: r.top, left: r.left, bottom: r.bottom, right: r.right }; };
  H.inView = b => b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth;
  H.states = el => {
    const s = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled');
    if (H.inert(el)) s.push('inert');
    if (el.checked || el.getAttribute('aria-checked') === 'true') s.push('checked');
    if (el.getAttribute('aria-pressed') === 'true') s.push('pressed');
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-selected') === 'true') s.push('selected');
    const ex = el.getAttribute('aria-expanded'); if (ex) s.push(ex === 'true' ? 'expanded' : 'collapsed');
    if (el === document.activeElement) s.push('focused');
    if (el.required) s.push('required');
    return s;
  };
  // Text a person would read in an element, with line breaks between blocks (not innerText: its CSS
  // text-transform changes words) and nothing hidden.
  const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|TR|TABLE|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|DL|DT|DD|FORM|FIELDSET|BR|HR|DETAILS|SUMMARY)$/;
  // opts.after: skip what comes before this node; opts.prefix(el) and opts.suffix(el): words around an element.
  H.read = (root, max = 20000, opts = {}) => {
    const out = [];
    let len = 0;
    const after = opts.after || null;
    const walk = node => {
      if (len > max * 1.5) return undefined;
      if (after && node !== after && !node.contains(after) && (after.compareDocumentPosition(node) & 2)) return undefined;   // before it
      if (node.nodeType === 3) { const t = icons(node.nodeValue).replace(/\s+/g, ' '); if (t.trim()) { out.push(t); len += t.length; } return undefined; }
      if (node.nodeType !== 1) return undefined;
      const el = node;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|svg)$/.test(el.tagName)) return undefined;
      if (el.getAttribute('aria-hidden') === 'true') return undefined;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return undefined;
      if (el.tagName === 'IMG') { const a = el.getAttribute('alt'); if (a && a.trim()) out.push(` [image: ${clip(a, 80)}] `); return undefined; }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { if (el.value && el.type !== 'password' && el.type !== 'hidden') out.push(` [${H.name(el) || 'field'}: ${clip(el.value, 200)}] `); return undefined; }
      const block = BLOCK.test(el.tagName) || cs.display === 'block' || cs.display === 'flex' || cs.display === 'grid' || cs.display === 'list-item';
      if (block) out.push('\n');
      const pre = opts.prefix && opts.prefix(el); if (pre) out.push(pre);
      for (const c of el.childNodes) walk(c);
      const post = opts.suffix && opts.suffix(el); if (post) out.push(post);
      if (block) out.push('\n');
      return undefined;
    };
    walk(root);
    return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  };
  H.where = () => ({ w: innerWidth, h: innerHeight, sx: Math.round(scrollX), sy: Math.round(scrollY), ph: Math.round(document.documentElement.scrollHeight) });
  window.__ssH = H;
  return H;
}

// read_page: the page as lines, each interactive element with its ref.
function readPage({ filter = 'interactive', ref = null, max = 20000 }) {
  const H = helpers();
  const root = ref ? H.el(ref) : document.body;
  const all = filter === 'all';
  const lines = [];
  let len = 0, cut = false;
  const LANDMARK = new Set(['navigation', 'main', 'dialog', 'form', 'banner', 'contentinfo', 'region', 'complementary', 'alertdialog', 'menu', 'tablist', 'listbox', 'list', 'table', 'grid']);
  const add = (depth, s) => { if (cut) return; if (len + s.length > max) { cut = true; return; } lines.push('  '.repeat(Math.min(depth, 12)) + s); len += s.length + 1; };
  const walk = (el, depth) => {
    if (cut || el.nodeType !== 1) return;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/.test(el.tagName)) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const role = H.role(el);
    let shown = false;
    if (H.interactive(el)) {
      const b = H.box(el);
      if (b.w > 0 || b.h > 0) {
        const st = H.states(el);
        if (!H.inView(b)) st.push('off screen');
        let extra = '';
        if (role === 'link') { const h = el.getAttribute('href'); if (h && !h.startsWith('javascript:')) extra += ` href=${h.length > 80 ? `${h.slice(0, 79)}…` : h}`; }
        if ((role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'slider') && 'value' in el && el.value && el.type !== 'password') extra += ` value="${H.clip(el.value, 80)}"`;
        if (el.tagName === 'SELECT') extra += ` options: ${[...el.options].slice(0, 12).map(o => (o.selected ? `[${H.clip(o.text, 30)}]` : H.clip(o.text, 30))).join(' | ')}${el.options.length > 12 ? ' …' : ''}`;
        add(depth, `${role || el.tagName.toLowerCase()} "${H.name(el)}"${st.length ? ` (${st.join(', ')})` : ''}${extra} [${H.ref(el)}]`);
        shown = true;
        if (role !== 'listbox' && role !== 'list' && el.tagName !== 'SELECT') {
          // A button's insides are its name; a big clickable card may hold more buttons.
          if (el.querySelector('a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=tab]')) for (const c of el.children) walk(c, depth + 1);
          return;
        }
      }
    } else if (all && role === 'heading') { add(depth, `heading "${H.clip(el.textContent, 150)}" (level ${el.tagName[1] || el.getAttribute('aria-level') || '?'})`); return; }
    else if (LANDMARK.has(role) || (all && el.tagName === 'IMG' && el.alt)) { add(depth, role === 'img' || el.tagName === 'IMG' ? `img "${H.clip(el.alt, 100)}"` : `${role}${H.name(el) && role !== 'list' && role !== 'table' ? ` "${H.clip(el.getAttribute('aria-label') || '', 80)}"` : ''}`); shown = true; }
    if (all && !shown) {
      // Text that sits directly in this element (not in its children).
      const own = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
      if (own && own.length > 1) add(depth, `text: ${H.clip(own, 300)}`);
    }
    for (const c of el.children) walk(c, depth + (shown ? 1 : 0));
    if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c, depth + 1);
  };
  walk(root, 0);
  const w = H.where();
  return `${document.title ? `Page: ${document.title}\n` : ''}Address: ${location.href}\nSize ${w.w}×${w.h}, scrolled to ${w.sx},${w.sy} of a page ${w.ph} tall.\n${lines.join('\n') || '(nothing to show)'}${cut ? `\n… (cut at ${max} characters: read inside one part with ref, or raise max_chars)` : ''}`;
}

// find: elements whose name or text matches the words, best first.
function findEls({ query, limit = 15 }) {
  const H = helpers();
  const q = String(query || '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('Say what to find.');
  const found = [];
  const els = document.body.querySelectorAll('*');
  for (const el of els) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HTML|BODY|HEAD)$/.test(el.tagName)) continue;
    const inter = H.interactive(el);
    const name = (inter ? H.name(el) : '').toLowerCase();
    const own = inter ? '' : [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.nodeValue).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const label = [name, (el.getAttribute('aria-label') || '').toLowerCase(), (el.getAttribute('placeholder') || '').toLowerCase(), (el.getAttribute('title') || '').toLowerCase(), own].join(' ');
    if (!words.every(w => label.includes(w))) continue;
    if (H.hidden(el)) continue;
    const exact = name === q || own === q || (el.getAttribute('aria-label') || '').toLowerCase() === q;
    const score = (exact ? 100 : 0) + (inter ? 30 : 0) + (name.startsWith(q) || own.startsWith(q) ? 15 : 0) - Math.min(20, (name || own).length / 20);
    found.push({ el, score, inter });
  }
  found.sort((a, b) => b.score - a.score);
  // Text that sits in a clickable thing: point at the thing.
  const out = [], seen = new Set();
  for (const f of found) {
    let el = f.el;
    if (!f.inter) { const up = el.closest('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label'); if (up) el = up; }
    if (seen.has(el)) continue;
    seen.add(el);
    const b = H.box(el), st = H.states(el);
    if (!H.inView(b)) st.push('off screen');
    out.push(`${H.role(el) || el.tagName.toLowerCase()} "${H.name(el) || H.clip(el.textContent, 100)}"${st.length ? ` (${st.join(', ')})` : ''} at ${b.x},${b.y} [${H.ref(el)}]`);
    if (out.length >= limit) break;
  }
  return out.length ? out.join('\n') : `Nothing on the page matches “${query}”.`;
}

// Where to click an element: scrolled into view first if it isn't, and what's actually on top there.
function pointOf({ ref, text }) {
  const H = helpers();
  let el;
  if (ref) el = H.el(ref);
  else {
    const q = String(text || '').trim().toLowerCase();
    if (!q) throw new Error('Say what to click: a ref, some text, or x and y.');
    const cands = [...document.querySelectorAll('a[href],button,input[type=button],input[type=submit],[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],summary,label')].filter(e => !H.hidden(e));
    const nm = e => (H.name(e) || e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    el = cands.find(e => nm(e) === q) || cands.find(e => nm(e).startsWith(q)) || cands.find(e => nm(e).includes(q));
    if (!el) {
      // Any visible text: its nearest clickable ancestor, or the text itself.
      const all = [...document.body.querySelectorAll('*')].filter(e => [...e.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim().toLowerCase().includes(q)) && !H.hidden(e));
      el = all.length ? (all[0].closest('a[href],button,[role=button],[role=link],[role=tab],[role=option],label') || all[0]) : null;
    }
    if (!el) throw new Error(`Nothing clickable on the page says “${text}”. Try find or read_page.`);
  }
  let b = H.box(el);
  if (!H.inView(b) || b.x < 0 || b.y < 0 || b.x >= innerWidth || b.y >= innerHeight) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); b = H.box(el); }
  const top = document.elementFromPoint(b.x, b.y);
  const covered = top && top !== el && !el.contains(top) && !top.contains(el) ? `${H.role(top) || top.tagName.toLowerCase()} "${H.clip(H.name(top) || top.textContent, 60)}"` : null;
  return { x: b.x, y: b.y, label: `${H.role(el) || el.tagName.toLowerCase()} "${H.clip(H.name(el) || el.textContent, 80)}"`, ref: H.ref(el), covered, disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || H.inert(el)) };
}

// Puts the focus in a field (caret at the end), or selects all of it when it's to be replaced.
function focusField({ ref, clear }) {
  const H = helpers();
  const el = H.el(ref);
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  if (el.isContentEditable) {
    const r = document.createRange(); r.selectNodeContents(el); if (!clear) r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  } else if ('value' in el && typeof el.setSelectionRange === 'function') {
    try { if (clear) el.select(); else { const n = String(el.value || '').length; el.setSelectionRange(n, n); } } catch { /* a field that has no selection */ }
  }
  return { focused: document.activeElement === el, label: `${H.role(el) || el.tagName.toLowerCase()} "${H.name(el)}"` };
}
function selectAllInFocus() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  if (typeof el.select === 'function') { el.select(); return true; }
  return false;
}

// form_input: a field's value, set the way the page's own code will notice (React included).
function setValue({ ref, value }) {
  const H = helpers();
  const el = H.el(ref);
  const fire = () => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (el.tagName === 'SELECT') {
    const want = String(value).toLowerCase();
    const opts = [...el.options];
    const o = opts.find(x => x.value.toLowerCase() === want) || opts.find(x => x.text.trim().toLowerCase() === want) || opts.find(x => x.text.toLowerCase().includes(want));
    if (!o) throw new Error(`That list has no option “${value}”. It has: ${opts.slice(0, 20).map(x => x.text.trim()).join(', ')}.`);
    el.value = o.value; fire();
    return `Chose “${o.text.trim()}”.`;
  }
  if (el.type === 'checkbox' || el.type === 'radio') {
    const on = value === true || /^(true|yes|on|1|checked)$/i.test(String(value));
    if (el.checked !== on) el.click();
    return `${on ? 'Checked' : 'Unchecked'} ${H.name(el) || el.type}.`;
  }
  if (el.isContentEditable) { el.focus(); el.textContent = String(value); el.dispatchEvent(new InputEvent('input', { bubbles: true })); return 'Set.'; }
  if (!('value' in el)) throw new Error(`${ref} isn’t a field.`);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, String(value));
  fire();
  return `Set ${H.name(el) || 'the field'} to “${H.clip(String(value), 80)}”.`;
}

function pageText({ max = 15000, from = 'start' }) {
  const H = helpers();
  const t = H.read(document.body, max * 2);
  if (t.length <= max) return t;
  return from === 'end' ? `…${t.slice(t.length - max)}` : `${t.slice(0, max)}…`;
}

function waitCheck({ text, gone, selector }) {
  const body = document.body ? document.body.innerText || '' : '';
  if (text && !body.toLowerCase().includes(String(text).toLowerCase())) return false;
  if (gone && body.toLowerCase().includes(String(gone).toLowerCase())) return false;
  if (selector) { let m = null; try { m = document.querySelector(selector); } catch { throw new Error(`“${selector}” isn’t a CSS selector.`); } if (!m) return false; }
  return true;
}

function scrollInfo({ ref }) {
  const H = helpers();
  if (ref) { const el = H.el(ref); el.scrollIntoView({ block: 'center', behavior: 'instant' }); }
  return H.where();
}

// ---------- Voyage (voyage.io) ----------
// Read from the game's own markup (packages/client in Latitude's repo): data-slot="voyage-*", data-voyage-*,
// aria-labels, data-story-input-turn and the like. Text is read with textContent (CSS uppercases some of it).
function voyage() {
  const H = helpers();
  const V = {};
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const vis = el => el && !H.hidden(el);
  const txt = el => (el ? H.icons(el.textContent).replace(/\s+/g, ' ').trim() : '');
  V.input = () => q('[data-voyage-input-area] textarea');
  V.inputReady = () => { const t = V.input(); return !!(t && !t.disabled && !H.inert(t) && vis(t)); };
  V.submit = () => q('[data-voyage-input-area] button[aria-label="Submit"], [data-voyage-input-area] button[aria-label="Waiting for game state"]');
  V.cinematic = () => q('[data-cinematic-stage="visible"]');
  V.dialogue = () => {
    const cin = V.cinematic();
    if (cin) return { mode: 'cinematic', el: cin };
    const adv = qa('[aria-label="Advance dialogue"]').find(e => e.getAttribute('aria-hidden') !== 'true' && vis(e) && !e.closest('[data-cinematic-stage]'));
    return adv ? { mode: 'classic', el: adv.closest('[role=dialog]') || adv.parentElement || adv } : null;
  };
  V.dialogueLine = () => {
    const d = V.dialogue(); if (!d) return '';
    if (d.mode === 'cinematic') { const live = q('[aria-live="polite"]', d.el); return H.read(live || d.el, 3000); }
    return H.read(d.el, 3000).replace(/(Space to skip\/?finish|P to pause|paused · P to resume|Updating game state…)/gi, '').trim();
  };
  V.skip = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true })); };
  V.loading = () => !!(q('[data-slot="voyage-entry-loading-screen"]') || q('[data-testid="voyage-entry-loading"]'));
  V.setup = () => q('[data-testid="voyage-new-game-setup"]');
  V.story = () => q('.story-scroll-view [data-voyage-story-narrative]') || q('[data-voyage-story-narrative]');
  V.flame = () => qa('img').some(i => /6a5f4865-f51c-4534/.test(i.src) && vis(i));
  V.waitingState = () => { const s = V.submit(); return !!(s && s.getAttribute('aria-label') === 'Waiting for game state'); };
  V.errors = () => {
    const out = [];
    for (const el of qa('[role=alert], [role=status]')) { const t = txt(el); if (t && /error|failed|couldn|try again|went wrong/i.test(t) && vis(el)) out.push(H.clip(t, 200)); }
    if (/Encountered an Error/i.test(document.body.textContent)) out.push('The story shows “Encountered an Error”.');
    return [...new Set(out)].slice(0, 5);
  };
  V.buttons = root => qa('button, [role=button]', root).filter(b => vis(b) && !H.inert(b)).map(b => ({ b, t: txt(b) || b.getAttribute('aria-label') || '' })).filter(x => x.t);
  // The mature-content notice a world may show first ("I'M OVER 18 AND WISH TO CONTINUE" / "Go back").
  V.gate = () => V.buttons().find(x => /over\s*18|wish to continue/i.test(x.t)) || null;
  V.signIn = () => !V.story() && !V.setup() && V.buttons().some(x => /^(sign in|log in|sign up)$/i.test(x.t)) && /sign in|log in/i.test(txt(q('[role=dialog]') || document.body).slice(0, 4000)) && !!q('[role=dialog] input[type=email], [role=dialog] input[type=password], input[type=password]');
  // A world's page: its Start (signed in: data-testid content-detail-primary-action) or Play (signed out, a link).
  V.startOf = () => {
    const t = q('[data-testid="content-detail-primary-action"]');
    if (t && vis(t)) return t;
    if (!/^\/world\/[^/]+/.test(location.pathname)) return null;
    return qa('a, button, [role=button]').find(b => vis(b) && /^(start|play|continue|resume)$/i.test(txt(b))) || null;
  };
  V.signedOut = () => /create an account or sign in/i.test(document.body.textContent);
  V.screen = () => {
    if (V.gate()) return 'content notice';
    if (V.signIn()) return 'sign in';
    if (V.loading()) return 'loading';
    if (V.setup()) return 'setup';
    if (q('[role=group][aria-label="Action input"]') || V.story()) return 'game';
    if (V.startOf()) return 'world';
    if (/\/play(\b|\?|$)/.test(location.pathname + location.search) && V.buttons().some(x => /private server|public server/i.test(x.t))) return 'server choice';
    return 'other';
  };
  V.turns = () => qa('[data-story-input-turn]', V.story() || document).map(el => Number(el.getAttribute('data-story-input-turn'))).filter(n => Number.isFinite(n));
  V.lastTurn = () => { const t = V.turns(); const seps = qa('.voyage-gameplay-glass-turn-separator').map(e => Number((/Turn\s+(\d+)/i.exec(e.textContent) || [])[1])).filter(Number.isFinite); return Math.max(0, ...t, ...seps); };
  // The newest turns' text: from each turn's actions to the next turn's.
  V.storyText = (nTurns = 2, max = 12000) => {
    const root = V.story();
    if (!root) return '';
    const marks = qa('[data-story-input-turn]', root);
    const after = marks.length ? marks[Math.max(0, marks.length - nTurns)] : null;
    const t = H.read(root, max * 2, {
      after,
      prefix: el => {
        if (el.hasAttribute('data-story-input-turn')) return `\n=== Turn ${el.getAttribute('data-story-input-turn')} ===\n`;
        if (el.hasAttribute('data-player-name')) return '\n▶ ';
        if (el.classList.contains('voyage-gameplay-glass-turn-separator')) return '\n— ';
        return '';
      },
      suffix: el => { const st = el.getAttribute('data-input-status'); return el.hasAttribute('data-player-name') && st && st !== 'recorded' && st !== 'submitted' ? ` (${st})` : ''; },
    }).trim();
    return t.length > max ? `…${t.slice(t.length - max)}` : t;
  };
  V.status = () => {
    const s = { screen: V.screen(), address: location.href };
    s.errors = V.errors();
    if (s.screen === 'setup') {
      const setup = V.setup();
      s.step = txt(q('[data-slot="voyage-heading"]', setup));
      const lbl = qa('*', setup).map(e => e.childElementCount === 0 ? txt(e) : '').find(t => /^\d+\s*\/\s*\d+$/.test(t)); if (lbl) s.stepOf = lbl;
      s.openings = qa('div[data-slot="voyage-text-card"][role=button]', setup).filter(vis).map(c => ({ title: txt(q('[data-slot="voyage-text-card-text"]', c)), selected: c.getAttribute('data-selected') === 'true', ref: H.ref(c) }));
      s.characters = qa('[data-slot="voyage-character-portrait"][role=button]', setup).filter(vis).map(c => ({ name: txt(q('[data-slot="voyage-character-portrait-name"]', c)) || c.getAttribute('aria-label') || '', selected: c.getAttribute('aria-pressed') === 'true', ref: H.ref(c) }));
      const fwd = q('[data-navigation="forward"]', setup);
      s.forward = fwd ? { text: txt(fwd), disabled: !!(fwd.disabled || fwd.getAttribute('aria-disabled') === 'true'), ref: H.ref(fwd) } : null;
      s.buttons = V.buttons(setup).map(x => `${x.t}${x.b.disabled ? ' (disabled)' : ''} [${H.ref(x.b)}]`).slice(0, 25);
      s.waiting = /Loading world…|Starting\.\.\.|Queue position/i.test(setup.textContent) ? H.clip((/(Loading world…|Starting\.\.\.|Queue position[^.]*)/i.exec(setup.textContent) || [])[1], 80) : null;
    } else if (s.screen === 'game') {
      const d = V.dialogue();
      s.dialogue = d ? { mode: d.mode, line: H.clip(V.dialogueLine(), 400) } : null;
      const t = V.input();
      s.input = t ? { ready: V.inputReady(), placeholder: t.getAttribute('placeholder') || t.getAttribute('aria-label') || '', value: t.value || '' } : { ready: false, hidden: true };
      s.waitingForGameState = V.waitingState();
      s.generating = V.flame();
      s.turn = V.lastTurn();
      const obj = q('button[aria-label="Open active quest"]'); if (obj) s.objective = H.clip(txt(obj), 200);
      const loc = qa('button').find(b => /Day\s+\d+/.test(b.textContent)); if (loc) s.location = H.clip(txt(loc), 120);
      if (q('[aria-label="Story recap"]')) s.recap = 'A story recap is showing: “Take my first turn” closes it.';
      const choices = qa('.voyage-gameplay-glass-turn-sections button', V.story() || document).filter(vis).map(b => txt(b) || b.getAttribute('aria-label')).filter(Boolean);
      if (choices.length) s.choices = [...new Set(choices)].slice(0, 12);
      const special = V.buttons().map(x => x.t).filter(t => /^(Play Again|Recover|Revive|Finish Turn|Edit action|Show Previous Turns)$/i.test(t));
      if (special.length) s.special = [...new Set(special)];
      const nearby = qa('button[data-fs-element="Voyage nearby character"]').map(b => b.getAttribute('aria-label')).filter(Boolean);
      if (nearby.length) s.nearby = nearby.slice(0, 12);
    } else if (s.screen === 'world') {
      s.title = txt(q('h1')) || document.title;
      const start = V.startOf(); s.start = start ? { text: txt(start), ref: H.ref(start) } : null;
      if (V.signedOut()) s.signedOut = true;
    } else if (s.screen === 'server choice') {
      s.buttons = V.buttons().map(x => `${x.t} [${H.ref(x.b)}]`).slice(0, 20);
    } else if (s.screen === 'content notice') {
      const g = V.gate(); s.gate = { text: g.t, ref: H.ref(g.b) };
    } else if (s.screen === 'sign in') {
      s.note = 'Voyage wants you signed in.';
    } else if (s.screen === 'loading') {
      s.note = H.clip(txt(q('[data-slot="voyage-entry-loading-screen"]') || q('[data-testid="voyage-entry-loading"]')), 200);
    }
    return s;
  };
  // Everything a turn's wait needs in one look.
  V.phase = () => ({
    screen: V.screen(), dialogue: !!V.dialogue(), line: V.dialogue() ? V.dialogueLine() : '', ready: V.inputReady(), waiting: V.waitingState(),
    generating: V.flame(), turn: V.lastTurn(), errors: V.errors(), recap: !!q('[aria-label="Story recap"]'),
  });
  return V;
}

function voyageStatus() { return voyage().status(); }
function voyagePhase() { return voyage().phase(); }
function voyageSkip() { const V = voyage(); const d = V.dialogue(); const line = d ? V.dialogueLine() : ''; if (d) V.skip(); return { skipped: !!d, line }; }
function voyageStory({ turns = 2, max = 12000 }) {
  const V = voyage();
  const st = V.storyText(turns, max);
  const d = V.dialogue();
  return `${st || '(No story on this page yet.)'}${d ? `\n\n[Dialogue playing now: ${V.dialogueLine()}]` : ''}`;
}
// Where to put the action: the box's ref (the tools focus it and type for real), or why it can't be used yet.
function voyageInput() {
  const H = helpers(), V = voyage();
  const t = V.input();
  if (!t) return { ready: false, why: V.dialogue() ? 'dialogue is playing' : 'the action box isn’t on the screen' };
  if (!V.inputReady()) return { ready: false, why: V.dialogue() ? 'dialogue is playing' : V.waitingState() ? 'the game is updating its state' : 'the action box is disabled (a turn may still be going)' };
  const s = V.submit();
  return { ready: true, ref: H.ref(t), submit: s ? H.ref(s) : null, turn: V.lastTurn(), cards: document.querySelectorAll('[data-player-name]').length };
}
// Did the action go in? (The box empties and disables, or the newest actions card shows it.)
// (By a new actions card, or the game taking it: never by the words, which an empty Continue doesn't have and an
// action repeated from last turn shares with the card before.)
function voyageSent({ cards = 0 }) {
  const V = voyage(), t = V.input();
  const now = document.querySelectorAll('[data-player-name]').length;
  return !!(now > cards || (t && t.disabled) || !t || V.flame() || V.dialogue() || V.waitingState());
}
// Game setup: the next thing to press, given what's wanted. Returns what it did, or why it stopped.
function voyageSetupStep({ opening, character }) {
  const H = helpers(), V = voyage();
  const scr = V.screen();
  const press = (el, why) => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = H.box(el); return { act: 'click', x: b.x, y: b.y, why, ref: H.ref(el) }; };
  const btn = re => V.buttons().find(x => re.test(x.t) && !x.b.disabled && x.b.getAttribute('aria-disabled') !== 'true');
  if (scr === 'game') return { done: true };
  if (scr === 'loading') return { wait: 'the game is loading' };
  if (scr === 'content notice') { const g = V.gate(); return press(g.b, `“${H.clip(g.t, 60)}” on the world’s mature-content notice`); }
  if (scr === 'sign in') return { stuck: 'Voyage wants you signed in. The user signs in once in the browser beside the chat (it’s kept for every chat), then this can carry on.' };
  if (scr === 'world') {
    if (V.signedOut()) return { stuck: 'Voyage is signed out here (the world page says “Create an account or sign in to start your story here”). The user signs in once in the browser beside the chat (it’s kept for every chat); then this can carry on.' };
    const s = V.startOf(); return press(s, `“${H.clip(txt(s), 30)}” on the world page`);
  }
  if (scr === 'server choice') {
    const priv = btn(/^private server$/i); const play = btn(/^play$/i);
    const chosen = V.buttons().find(x => /^private server$/i.test(x.t) && (x.b.getAttribute('aria-pressed') === 'true' || x.b.getAttribute('data-selected') === 'true' || x.b.getAttribute('aria-checked') === 'true'));
    if (play && (chosen || !priv)) return press(play.b, 'Play');
    if (priv) return press(priv.b, 'Private Server');
    if (play) return press(play.b, 'Play');
    return { stuck: 'On the server choice, but neither “Private Server” nor “Play” can be pressed.' };
  }
  if (scr !== 'setup') return { stuck: `This isn’t a Voyage world page or game setup (${location.href}).` };
  const setup = V.setup();
  const heading = (document.querySelector('[data-slot="voyage-heading"]') ? document.querySelector('[data-slot="voyage-heading"]').textContent : '').trim();
  if (/Loading world…|Starting\.\.\.|Queue position/i.test(setup.textContent) && !btn(/^next:|^ready$|^start game$|^start adventure$/i)) return { wait: H.clip((/(Loading world…|Starting\.\.\.|Queue position[^.]*)/i.exec(setup.textContent) || [])[1], 80) };
  // The opening.
  const cards = [...setup.querySelectorAll('div[data-slot="voyage-text-card"][role=button]')].filter(c => !H.hidden(c));
  if (cards.length && opening) {
    const want = String(opening).toLowerCase();
    const card = cards.find(c => (c.querySelector('[data-slot="voyage-text-card-text"]') || c).textContent.toLowerCase().includes(want));
    if (!card) return { stuck: `No opening here matches “${opening}”. The openings: ${cards.map(c => H.clip((c.querySelector('[data-slot="voyage-text-card-text"]') || c).textContent, 60)).join(' · ')}.` };
    if (card.getAttribute('data-selected') !== 'true') return press(card, `the opening “${H.clip((card.querySelector('[data-slot="voyage-text-card-text"]') || card).textContent, 60)}”`);
  }
  // The character.
  const ports = [...setup.querySelectorAll('[data-slot="voyage-character-portrait"][role=button]')].filter(c => !H.hidden(c));
  if (ports.length && character && !/^(new|random)$/i.test(character)) {
    const want = String(character).toLowerCase();
    const p = ports.find(c => ((c.querySelector('[data-slot="voyage-character-portrait-name"]') || {}).textContent || c.getAttribute('aria-label') || '').toLowerCase().includes(want));
    if (!p) return { stuck: `No saved character here is called “${character}”. The characters: ${ports.map(c => H.clip((c.querySelector('[data-slot="voyage-character-portrait-name"]') || c).textContent, 30)).join(', ')}.` };
    if (p.getAttribute('aria-pressed') !== 'true') return press(p, `the character ${H.clip((p.querySelector('[data-slot="voyage-character-portrait-name"]') || p).textContent, 40)}`);
  }
  if (ports.length && character && /^(new|random)$/i.test(character)) {
    const custom = ports.find(c => /custom/i.test(c.textContent + (c.getAttribute('aria-label') || '')));
    if (custom && custom.getAttribute('aria-pressed') !== 'true') return press(custom, 'Custom (a new character)');
  }
  const rnd = character && /^(new|random)$/i.test(character) ? btn(/^randomize$/i) : null;
  if (rnd && !setup.__ssRandomized) { setup.__ssRandomized = true; return press(rnd.b, 'Randomize'); }
  const create = btn(/^create$/i);
  if (create) return press(create.b, 'Create');
  // Forward: Next…, Ready, Start Game / Start adventure.
  const fwd = setup.querySelector('[data-navigation="forward"]');
  if (fwd && !(fwd.disabled || fwd.getAttribute('aria-disabled') === 'true')) return press(fwd, H.clip(fwd.textContent, 60) || 'Next');
  const any = btn(/^(next:.*|next|ready|start game|start adventure|get started|done|choose character|review character)$/i);
  if (any) return press(any.b, any.t);
  return { stuck: `On “${heading || 'game setup'}” and nothing can be pressed to go on${fwd ? ` (“${H.clip(fwd.textContent, 40)}” is disabled: something on this step must be chosen first)` : ''}.` };
}

// The source to run: the helpers (and the Voyage ones, for those tools) declared, then the call.
const VOYAGE_FNS = new Set([voyageStatus, voyagePhase, voyageSkip, voyageStory, voyageInput, voyageSent, voyageSetupStep]);
// A thrown error comes back as { __err } (Electron would only say "Script failed to execute"); lib/browser.js
// turns it back into an error with the script's own words.
const call = (fn, args = {}) => `${helpers.toString()}\n${VOYAGE_FNS.has(fn) ? `${voyage.toString()}\n` : ''}(() => { try { return { __ok: (${fn.toString()})(${JSON.stringify(args)}) }; } catch (e) { return { __err: String((e && e.message) || e) }; } })()`;
const unwrap = r => {
  if (r && typeof r === 'object' && '__err' in r) throw Object.assign(new Error(r.__err), { status: 400 });
  return r && typeof r === 'object' && '__ok' in r ? r.__ok : r;
};

module.exports = { call, unwrap, helpers, readPage, findEls, pointOf, focusField, selectAllInFocus, setValue, pageText, waitCheck, scrollInfo, voyageStatus, voyagePhase, voyageSkip, voyageStory, voyageInput, voyageSent, voyageSetupStep };
