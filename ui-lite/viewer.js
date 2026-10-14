'use strict';
/* The side viewer: a file a chat read or wrote, Markdown it put together, a picture, or a link (a
   preview, a dev server on this Mac) opens beside the chat instead of somewhere else. On a phone it
   slides over the chat. Files come through the full app's file route, so only files in the chat's
   folder or your user folder open, and sign-in files never do. Sites that won't be shown inside
   another page (GitHub, Linear, Slack…) open in a new tab instead. Esc or × closes it. */

const VW = { open: false, chat: null, kind: null, target: null, data: null, error: null, loading: false, back: [] };
const NO_FRAME = /(^|\.)(github\.com|linear\.app|slack\.com|discord\.com|discord\.gg|notion\.so|google\.com|figma\.com|x\.com|twitter\.com|reddit\.com|youtube\.com|apple\.com|claude\.ai|chatgpt\.com|openai\.com|1password\.com)$/i;
const canFrame = url => { try { const u = new URL(url, location.href); return /^https?:$/.test(u.protocol) && !NO_FRAME.test(u.hostname); } catch { return false; } };

function fileQuery(p) {
  const q = new URLSearchParams({ path: p });
  if (CV.key) q.set('key', CV.key);
  if (CV.id) q.set('session', CV.id);
  return q;
}
// Paths a chat touched, newest first: what its Read / Edit / Write steps named.
function chatFiles() {
  const seen = new Map();
  for (const it of CV.items || []) {
    if (it.kind !== 'assistant') continue;
    for (const b of it.blocks || []) {
      if (b.type !== 'tool') continue;
      const p = toolPath(b); if (!p) continue;
      const how = /Edit|Write/.test(b.name) ? 'changed' : 'read';
      const was = seen.get(p);
      seen.delete(p); seen.set(p, was === 'changed' ? 'changed' : how);
    }
  }
  return [...seen].reverse().map(([p, how]) => ({ path: p, how }));
}
const toolPath = b => (/^(Read|Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name) ? (b.meta && b.meta.path) || b.viewPath || (b.summary && !/,\s/.test(b.summary) ? b.summary : null) : null);
const baseName = p => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
// Inline code that's clearly a file path: has a folder or a known extension, no spaces.
const looksLikePath = s => /^(~|\.{0,2}\/|[A-Za-z]:\\)?[\w@.+-]+([\\/][\w@.+ -]+)*\.(md|mdx|markdown|txt|json|jsonl|js|mjs|cjs|ts|tsx|jsx|py|html|css|csv|ya?ml|toml|sh|sql|go|rs|swift|kt|java|rb|lua|log|png|jpe?g|gif|webp|svg|pdf|mp4|mov|mp3|wav)$/i.test(s) && !/\s/.test(s);

async function viewFile(p, { from } = {}) {
  if (VW.open && VW.target && from !== 'back') VW.back.push({ kind: VW.kind, target: VW.target });
  Object.assign(VW, { open: true, chat: CV.id, kind: 'file', target: p, data: null, error: null, loading: true });
  paintViewer();
  try { VW.data = await api(`/api/lite/file?${fileQuery(p)}`); } catch (err) {
    // A Switcher that hasn't restarted onto this version only has the full app's file route.
    if (err.status === 404) { try { VW.data = await api(`/api/file?${fileQuery(p)}`); } catch (e2) { VW.error = e2.message; } } else VW.error = err.message;
  }
  VW.loading = false;
  if (VW.target === p) paintViewer();
}
function viewUrl(url, { from } = {}) {
  if (!canFrame(url)) { window.open(url, '_blank', 'noopener'); return; }
  if (VW.open && VW.target && from !== 'back') VW.back.push({ kind: VW.kind, target: VW.target });
  Object.assign(VW, { open: true, chat: CV.id, kind: 'url', target: url, data: null, error: null, loading: false });
  paintViewer();
}
function viewFilesList() {
  if (VW.open && VW.target && VW.kind !== 'list') VW.back.push({ kind: VW.kind, target: VW.target });
  Object.assign(VW, { open: true, chat: CV.id, kind: 'list', target: 'files', data: chatFiles(), error: null, loading: false });
  paintViewer();
}
function viewerBack() {
  const prev = VW.back.pop(); if (!prev) return closeViewer();
  if (prev.kind === 'file') return viewFile(prev.target, { from: 'back' });
  if (prev.kind === 'url') return viewUrl(prev.target, { from: 'back' });
  return viewFilesList();
}
function closeViewer() {
  Object.assign(VW, { open: false, kind: null, target: null, data: null, error: null, back: [] });
  paintViewer();
}

function viewerBody() {
  if (VW.kind === 'side') return sideBody();
  // Sandboxed: the page runs and signs in, but can't take over Lite's own tab.
  if (VW.kind === 'url') return `<iframe class="vw-frame" src="${esc(VW.target)}" title="${esc(VW.target)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"></iframe>`;
  if (VW.kind === 'list') {
    const list = VW.data || [];
    return `<div class="vw-pad">${list.length ? `<div class="vw-files">${list.map(f => `<button class="vw-file" data-viewfile="${esc(f.path)}"><b>${esc(baseName(f.path))}</b><small>${esc(f.how)} · ${esc(f.path)}</small></button>`).join('')}</div>` : '<p class="empty-note">This chat hasn’t read or changed any files yet.</p>'}</div>`;
  }
  if (VW.loading) return '<p class="empty-note vw-pad">Opening…</p>';
  if (VW.error) return `<p class="empty-note vw-pad">${esc(VW.error)}</p>`;
  const d = VW.data || {};
  if (d.kind === 'image') return `<div class="vw-pad vw-center"><img src="${esc(d.src)}" alt="${esc(baseName(VW.target))}" data-zoom="1"></div>`;
  if (d.kind === 'video' || d.kind === 'audio' || d.kind === 'pdf') {
    const q = fileQuery(d.path || VW.target); q.set('token', TOKEN);
    const src = `/api/media?${q}`;
    return d.kind === 'video' ? `<div class="vw-pad vw-center"><video src="${esc(src)}" controls playsinline></video></div>`
      : d.kind === 'audio' ? `<div class="vw-pad"><audio src="${esc(src)}" controls></audio></div>`
      : `<iframe class="vw-frame" src="${esc(src)}" title="${esc(baseName(VW.target))}"></iframe>`;
  }
  if (d.kind === 'dir') return `<div class="vw-pad"><div class="vw-files">${(d.entries || []).map(e => `<button class="vw-file" data-viewfile="${esc(`${(d.path || VW.target).replace(/[\\/]$/, '')}/${e.name}`)}"><b>${esc(e.name)}${e.dir ? '/' : ''}</b></button>`).join('')}</div></div>`;
  if (d.kind === 'binary') return `<p class="empty-note vw-pad">${esc(d.note || 'This file can’t be shown here.')}</p>`;
  if (d.kind === 'text') {
    const body = d.markdown ? `<div class="msg-ai vw-md">${mdHtml(d.text || '')}</div>` : `<pre class="vw-code"><code>${esc(d.text || '')}</code></pre>`;
    return `<div class="vw-pad">${body}${d.truncated ? '<p class="hint-line">Only the start of this file is shown.</p>' : ''}</div>`;
  }
  return '<p class="empty-note vw-pad">Nothing to show.</p>';
}
function viewerHead() {
  const label = VW.kind === 'side' ? 'Side chat' : VW.kind === 'list' ? 'Files in this chat' : VW.kind === 'url' ? VW.target.replace(/^https?:\/\//, '') : baseName(VW.target);
  const sub = VW.kind === 'file' ? (VW.data && VW.data.path) || VW.target : '';
  const acts = [
    VW.back.length ? '<button class="iconbtn" data-vw="back" aria-label="Back" title="Back">‹</button>' : '',
    `<div class="vw-title"><b title="${esc(VW.target || '')}">${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`,
    VW.kind === 'url' ? '<button class="iconbtn" data-vw="reload" aria-label="Reload" title="Reload">↻</button>' : '',
    VW.kind === 'url' ? `<a class="iconbtn" href="${esc(VW.target)}" target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab">↗</a>` : '',
    VW.kind === 'file' && VW.data && VW.data.kind === 'text' ? '<button class="iconbtn" data-vw="copy" aria-label="Copy" title="Copy the text">⧉</button>' : '',
    VW.kind === 'side' && SD.sessionId ? '<button class="iconbtn sd-act" data-sidenew="1" title="Start another side chat">New</button><button class="iconbtn sd-act" data-sideopen="1" title="Open the side chat in full">Open</button>' : '',
    VW.kind !== 'list' && VW.kind !== 'side' ? '<button class="iconbtn" data-vw="files" aria-label="Files in this chat" title="Files in this chat">☰</button>' : '',
    '<button class="iconbtn" data-vw="close" aria-label="Close" title="Close (Esc)">×</button>',
  ];
  return `<div class="vw-h">${acts.join('')}</div>`;
}
function paintViewer() {
  const el = $('viewer'); if (!el) return;
  const show = VW.open && S.view === 'chat';
  document.body.classList.toggle('has-viewer', show);
  el.hidden = !show;
  if (!show) { if (el.innerHTML) { el.innerHTML = ''; el._h = ''; } return; }
  const h = `${viewerHead()}<div class="vw-body">${viewerBody()}</div>`;
  // The side chat keeps its box (and what you're typing); only its messages and header redraw.
  if (VW.kind === 'side' && el.querySelector('#sideForm')) { el._h = h; return paintSide(); }
  if (el._h === h) return;
  // A page in the frame keeps running while the header changes; only swap it when the link does.
  const frame = el.querySelector('iframe.vw-frame');
  if (frame && VW.kind === 'url' && frame.getAttribute('src') === VW.target) {
    el.querySelector('.vw-h').outerHTML = viewerHead();
  } else {
    el.innerHTML = h;
  }
  el._h = h;
}

// Clicks inside messages and the viewer: http links into the viewer (Cmd/Ctrl-click or middle
// click still opens a tab), file paths in steps and in `code`, and the viewer's own buttons.
document.addEventListener('click', e => {
  const t = e.target;
  const b = t.closest('[data-vw], [data-viewfile], [data-viewfiles], .msg-ai a[href], .msg-you a[href], .msg-ai code.vpath');
  if (!b || t.closest('#palRoot')) return;
  if (b.matches('.msg-ai a[href], .msg-you a[href]')) {
    // On a phone a link just opens (the panel would cover the chat, and sites won't sign in inside it).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || S.view !== 'chat' || matchMedia('(max-width: 760px)').matches) return;
    const href = b.getAttribute('href');
    if (!/^https?:/i.test(href) || !canFrame(href)) return;
    e.preventDefault(); viewUrl(href); return;
  }
  e.preventDefault(); e.stopPropagation();
  if (b.matches('code.vpath')) return void viewFile(b.textContent.trim());
  if (b.dataset.viewfile) return void viewFile(b.dataset.viewfile);
  if (b.dataset.viewfiles !== undefined) return void viewFilesList();
  const act = b.dataset.vw;
  if (act === 'close') closeViewer();
  else if (act === 'back') viewerBack();
  else if (act === 'files') viewFilesList();
  else if (act === 'reload') { const f = $('viewer')?.querySelector('iframe.vw-frame'); if (f) f.src = VW.target; }
  else if (act === 'copy' && VW.data && VW.data.text) navigator.clipboard.writeText(VW.data.text).then(() => toast('Copied.'), () => toast('Couldn’t copy.'));
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && VW.open && S.view === 'chat' && !document.querySelector('#popRoot :is(.pop, .menu), #modalRoot :not(:empty)')) {
    const typing = e.target.closest && e.target.closest('textarea, input');
    if (typing && e.target.value) return;
    e.preventDefault(); e.stopPropagation(); closeViewer();
  }
}, true);
// If Lite's own page isn't allowed to frame a site (a Switcher that hasn't restarted onto this
// version), open it in a tab instead of leaving a blank frame. A site that refuses framing itself
// can't be detected from here; it shows blank, and ↗ opens it in a tab.
document.addEventListener('securitypolicyviolation', e => {
  if (!VW.open || VW.kind !== 'url' || !/^(frame-src|child-src|default-src)/.test(e.violatedDirective || '')) return;
  const url = VW.target; viewerBack();
  window.open(url, '_blank', 'noopener');
  toast('That page can’t be shown here, so it opened in a new tab.');
});
