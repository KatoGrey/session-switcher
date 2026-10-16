'use strict';
/* The message box: attachments, Esc to stop, and saved prompts (the Prompts button, and / in an empty box). */

/* ---------- composer ---------- */
const sizeText = n => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const kindOf = f => (/^video\//.test(f.type) || VIDEO_RE.test(f.name) ? 'video' : /^audio\//.test(f.type) || AUDIO_RE.test(f.name) ? 'audio' : /pdf$/.test(f.type) || /\.pdf$/i.test(f.name) ? 'PDF' : 'file');
function renderAttachments() {
  const imgs = C.attachments.map((a, i) => `<span class="att"><img src="${a.url ? esc(a.url) : `data:${esc(a.mediaType)};base64,${a.data}`}" alt="" title="Click to see it full size"><button type="button" data-rm="${i}" aria-label="Remove image">✕</button></span>`);
  if (C.converting) imgs.push(`<span class="att pending" title="Preparing ${C.converting === 1 ? 'a picture' : `${C.converting} pictures`}"><span class="gen-spin" aria-hidden="true"></span></span>`);
  const files = (C.files || []).map((f, i) => `<span class="att file ${f.error ? 'err' : f.rel ? 'done' : 'up'}" data-fid="${i}" title="${esc(f.error || f.rel || 'Uploading…')}">
      <span class="af-ico" aria-hidden="true">${esc(fileGlyph(f.name))}</span><span class="af-t"><b>${esc(f.name)}</b><small>${esc(f.error ? 'Couldn’t attach' : f.rel ? `${f.kind}, ${sizeText(f.size)}` : `Uploading ${Math.round((f.progress || 0) * 100)}%`)}</small></span>
      ${!f.rel && !f.error ? `<i class="af-bar" style="width:${Math.round((f.progress || 0) * 100)}%"></i>` : ''}<button type="button" data-rmf="${i}" aria-label="Remove file">✕</button></span>`);
  $c('cAtt').innerHTML = imgs.join('') + files.join('');
  $c('cAtt').hidden = !imgs.length && !files.length;
}
// Pictures go to the chat itself; anything else (videos, PDFs, sound, documents) is saved in the
// project's attachments folder and the message says where, so Claude or Codex can open it.
const readData = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); }; r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
// Phone photos are often over 5 MB: shrink them to a sharp JPEG (longest side 2048 px) so they
// still go to the chat as a picture it can see. Anything that can't be decoded is uploaded as a file.
async function shrinkPhoto(f) {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    for (const q of [0.88, 0.8, 0.7]) {
      const out = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
      if (out && out.size <= 5 * 1024 * 1024) return out;
    }
  } catch { /* not decodable here (e.g. HEIC) */ }
  return null;
}
async function addImage(f) {
  const gen = C.gen;
  C.converting = (C.converting || 0) + 1; renderAttachments();
  try {
    let blob = f;
    if (f.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) blob = await shrinkPhoto(f);
    if (!blob) return false;
    const data = await readData(blob);
    if (gen !== C.gen) return true;   // you switched chats meanwhile
    C.attachments.push({ mediaType: blob.type || f.type, data, url: URL.createObjectURL(blob) });
    return true;
  } finally {
    if (gen === C.gen) { C.converting = Math.max(0, (C.converting || 1) - 1); renderAttachments(); }
  }
}
function addFiles(files) {
  for (const f of files) {
    if (/^image\//.test(f.type) && !/svg/.test(f.type) && C.attachments.length + (C.converting || 0) < 10) {
      addImage(f).then(ok => { if (!ok) uploadFile(f); }).catch(() => uploadFile(f));
      continue;
    }
    uploadFile(f);
  }
}
// An upload's progress updates its own card, not the whole row (pictures stay put).
function fileProgress(item) {
  const i = (C.files || []).indexOf(item);
  const el = i >= 0 && $c('cAtt').querySelector(`[data-fid="${i}"]`);
  if (!el) return renderAttachments();
  const pct = Math.round((item.progress || 0) * 100);
  const bar = el.querySelector('.af-bar'); if (bar) bar.style.width = `${pct}%`;
  const sm = el.querySelector('small'); if (sm) sm.textContent = `Uploading ${pct}%`;
  return undefined;
}
const dropAttachments = () => { for (const a of C.attachments || []) if (a.url) URL.revokeObjectURL(a.url); for (const f of C.files || []) if (f.xhr && !f.rel && !f.error) f.xhr.abort(); };
// Uploads a file into the project’s attachments folder, with progress.
function uploadFile(f) {
  if (!C.key) { toast('Start the chat first, then attach files.'); return; }
  if (f.size > 2 * 1024 * 1024 * 1024) { toast(`${f.name} is over 2 GB.`); return; }
  const item = { name: f.name || 'file', size: f.size, type: f.type, kind: kindOf(f), progress: 0, rel: null, error: null };
  (C.files || (C.files = [])).push(item);
  const x = new XMLHttpRequest();
  item.xhr = x;
  x.open('POST', `/api/chat/upload?${new URLSearchParams({ key: C.key, name: item.name })}`);
  x.setRequestHeader('X-Switcher-Token', TOKEN);
  x.upload.onprogress = e => { if (e.lengthComputable) { item.progress = e.loaded / e.total; fileProgress(item); } };
  x.onload = () => {
    let j = {}; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
    if (x.status === 200) { item.rel = j.rel; item.path = j.path; item.size = j.size; } else item.error = j.error || `Upload failed (${x.status}).`;
    if (item.error) toast(`${item.name}: ${item.error}`, 7000);
    renderAttachments();
  };
  x.onerror = () => { item.error = 'The upload was interrupted.'; renderAttachments(); };
  x.send(f);
  renderAttachments();
}
// Attach: on a phone, choose photos, the camera, or files; on a PC, straight to the file window.
function attachMenu(anchor) {
  if (!matchMedia('(pointer: coarse)').matches) return $c('cFile').click();
  return showMenu(anchor, [
    { label: 'Photos & videos', hint: 'from your gallery', run: () => $c('cMedia').click() },
    { label: 'Take a photo', run: () => $c('cCam').click() },
    { label: 'Record a video', run: () => $c('cVid').click() },
    { label: 'Files', hint: 'PDFs, documents, anything', run: () => $c('cFile').click() },
  ]);
}
function grow() {
  const t = $c('cText');
  // While the chat window is hidden there's nothing to measure: go back to the natural height.
  if (!t.offsetParent) { t.style.height = ''; return; }
  t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, window.innerHeight * 0.4)}px`;
}

/* ---------- prompts: the Prompts button, and / in an empty box ---------- */
// Puts text in the message box and selects the first {blank} left to fill in, if any.
function placeText(text, replace) {
  const ta = $c('cText');
  ta.value = replace || !ta.value.trim() ? text : `${ta.value.replace(/\s+$/, '')}\n\n${text}`;
  grow(); ta.focus();
  const m = ta.value.match(/\{[^{}\n]{1,40}\}/);
  if (m) ta.setSelectionRange(m.index, m.index + m[0].length);
  else { ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollTop = ta.scrollHeight; }
}
const insertPrompt = (pr, replace) => placeText(fillPrompt(pr.text, C.folder), replace);
function promptsMenu(anchor) {
  if (!S.prompts.length) return openPromptEditor();
  return showMenu(anchor, [
    ...S.prompts.map(pr => ({ label: pr.title, hint: pr.provider === 'codex' && C.provider !== 'codex' ? 'written for Codex' : '', run: () => insertPrompt(pr) })),
    '-',
    { label: 'Edit prompts…', run: openPromptEditor },
  ]);
}
const Slash = { open: false, items: [], sel: 0, moved: false, dismissed: null, kind: 'prompt', at: null };
const slashQuery = () => { const v = $c('cText').value; return /^\/[^\n]{0,40}$/.test(v) ? v.slice(1).trim().toLowerCase() : null; };
function closeSlash() { Slash.open = false; Slash.moved = false; Slash.kind = 'prompt'; Slash.at = null; $c('cSlash').hidden = true; }
function renderSlash() {
  // "@" and a few letters: the project's files (unless it's @codex, @claude or @both).
  const men = mentionAt();
  if (men && $c('cText').value !== Slash.dismissed) return renderMention(men);
  if (Slash.kind === 'file') { Slash.kind = 'prompt'; Slash.at = null; Slash.sel = 0; }
  const q = slashQuery();
  if (q === null || C.watch || !S.prompts.length || $c('cText').value === Slash.dismissed) return closeSlash();
  const words = t => t.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  Slash.items = S.prompts.filter(pr => !q || pr.id.startsWith(q) || words(pr.title).some(w => w.startsWith(q)) || pr.title.toLowerCase().startsWith(q));
  if (!Slash.items.length) return closeSlash();
  Slash.sel = Math.min(Slash.sel, Slash.items.length - 1);
  Slash.open = true;
  const box = $c('cSlash'); box.hidden = false;
  box.innerHTML = `<p class="cs-h">Prompts${C.folder ? ` for ${esc(C.folder)}` : ''}</p><ul>${Slash.items.map((pr, i) => `<li role="option" data-si="${i}" aria-selected="${i === Slash.sel}"><b>${esc(pr.title)}</b>${pr.provider === 'codex' && C.provider !== 'codex' ? '<span class="tag codex">Codex</span>' : ''}<span class="cs-x">${esc(fillPrompt(pr.text, C.folder))}</span></li>`).join('')}</ul>
      <p class="cs-f">${Slash.moved ? '<kbd class="kbd">Enter</kbd> or <kbd class="kbd">Tab</kbd> inserts it' : '<kbd class="kbd">Tab</kbd> inserts · <kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> choose · <kbd class="kbd">Enter</kbd> sends what you typed'}</p>`;
  box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function pickSlash(i) {
  if (Slash.kind === 'file') { const f = Slash.items[i], at = Slash.at; closeSlash(); if (f && at) { if (typeof f === 'string') insertMention(f, at); else insertChatRef(f, at); } return; }
  const pr = Slash.items[i]; closeSlash(); if (pr) insertPrompt(pr, true);
}

/* ---------- @ mentions: a project's files ---------- */
const Mention = { cwd: null, files: null, loading: null };
// The "@word" being typed at the cursor, if any.
function mentionAt() {
  const ta = $c('cText');
  if (C.watch || ta.selectionStart !== ta.selectionEnd) return null;
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/(^|[\s(“"'[])@([^\s@"]{0,80})$/);
  if (!m || /^(codex|claude|gemini|both|all)$/i.test(m[2])) return null;
  return { q: m[2], start: before.length - m[2].length - 1, end: before.length };
}
function mentionFiles() {
  const cwd = C.info && C.info.cwd;
  if (!cwd) return Promise.resolve([]);
  if (Mention.cwd !== cwd) { Mention.cwd = cwd; Mention.files = null; Mention.loading = null; }
  if (Mention.files) return Promise.resolve(Mention.files);
  if (!Mention.loading) {
    const q = C.key ? `key=${encodeURIComponent(C.key)}` : C.sessionId ? `session=${encodeURIComponent(C.sessionId)}` : `cwd=${encodeURIComponent(cwd)}`;
    Mention.loading = api(`/api/files/list?${q}`).then(r => (Mention.files = r.files || [])).catch(() => (Mention.files = []));
  }
  return Mention.loading;
}
// Every typed letter in order; a file's name beats its folders, the start of a name beats the middle,
// and then the shorter name (the closer match) comes first.
function rankFiles(files, q) {
  const ql = q.toLowerCase().replace(/\\/g, '/');
  const scored = [];
  for (const f of files) {
    const fl = f.toLowerCase(), name = fl.slice(fl.lastIndexOf('/') + 1);
    let score;
    if (!ql) score = fl.split('/').length;
    else if (name.startsWith(ql)) score = 0;
    else if (name.includes(ql)) score = 1;
    else if (fl.includes(ql)) score = 2;
    else { let i = 0; for (const ch of fl) if (ch === ql[i]) i++; if (i < ql.length) continue; score = 3; }
    scored.push([score, name.length, f.length, f]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, 8).map(x => x[3]);
}
async function renderMention(men) {
  const files = await mentionFiles();
  const now = mentionAt();
  if (!now || now.q !== men.q || now.start !== men.start) return undefined;   // typed on meanwhile
  const items = [...rankFiles(files, men.q).slice(0, men.q ? 6 : 5), ...rankChats(men.q)];
  if (!items.length) return closeSlash();
  if (Slash.kind !== 'file' || Slash.at?.start !== men.start) Slash.sel = 0;
  Object.assign(Slash, { kind: 'file', items, at: men, open: true, sel: Math.min(Slash.sel, items.length - 1) });
  const box = $c('cSlash'); box.hidden = false;
  const firstChat = items.findIndex(x => typeof x !== 'string');
  box.innerHTML = `<p class="cs-h">${firstChat === 0 ? 'Your other chats' : `Files in ${esc(C.folder || 'this project')}`}</p><ul>${items.map((f, i) => typeof f !== 'string' ? `${i === firstChat && i ? '<li class="cs-sep" role="presentation">Your other chats</li>' : ''}<li role="option" data-si="${i}" aria-selected="${i === Slash.sel}" class="cs-chat"><b>${esc(f.title)}</b><span class="cs-x">${esc(f.folder || '')}${f.provider === 'codex' ? ' · Codex' : ''} · brings its latest messages in</span></li>` : `<li role="option" data-si="${i}" aria-selected="${i === Slash.sel}"><b>${esc(f.split('/').pop())}</b><span class="cs-x">${esc(f)}</span></li>`).join('')}</ul>
    <p class="cs-f"><kbd class="kbd">Tab</kbd> or <kbd class="kbd">Enter</kbd> puts it in · <kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> choose · <kbd class="kbd">Esc</kbd> closes</p>`;
  return undefined;
}
// Your other chats matching what's typed after "@" (by title or project), newest first.
function rankChats(q) {
  const ql = q.toLowerCase();
  const mine = String(C.sessionId || '').toLowerCase();
  return allSessions().filter(([x]) => x.id.toLowerCase() !== mine && (x.title || '').trim())
    .filter(([x, p]) => !ql || (x.title || '').toLowerCase().includes(ql) || (p.name || '').toLowerCase().startsWith(ql))
    .sort((a, b) => (b[0].updated || 0) - (a[0].updated || 0)).slice(0, ql ? 4 : 3)
    .map(([x, p]) => ({ chat: true, id: x.id, provider: x.provider || 'claude', title: x.title, folder: p.name }));
}
// "@chat[Title] ": that chat's latest messages go along with this message (the PC adds them).
function insertChatRef(c, at) {
  const ta = $c('cText');
  const label = c.title.replace(/[[\]\n]/g, ' ').trim().slice(0, 80);
  if (!C.chatRefs) C.chatRefs = new Map();
  C.chatRefs.set(label, { id: c.id, provider: c.provider });
  const text = `@chat[${label}] `;
  ta.value = ta.value.slice(0, at.start) + text + ta.value.slice(at.end);
  const pos = at.start + text.length;
  ta.focus(); ta.setSelectionRange(pos, pos);
  grow(); saveDraft();
}
// The chats a message brings in: each "@chat[…]" still in it that was picked from the list.
function chatRefsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/@chat\[([^\]\n]+)\]/g)) { const r = C.chatRefs && C.chatRefs.get(m[1]); if (r && !out.some(x => x.id === r.id)) out.push(r); }
  return out;
}
// Replaces "@wor" with "@path/to/file " (in quotes if the path has spaces).
function insertMention(f, at) {
  const ta = $c('cText');
  const text = /\s/.test(f) ? `@"${f}" ` : `@${f} `;
  ta.value = ta.value.slice(0, at.start) + text + ta.value.slice(at.end);
  const pos = at.start + text.length;
  ta.focus(); ta.setSelectionRange(pos, pos);
  grow(); saveDraft();
}
// A new chat opens on its project: the banner, and your prompts one click away.
function welcome(cwd) {
  const p = cwd && S.projects.find(x => x.cwd === cwd);
  const w = cwd && S.worlds[cwd];
  const art = w && w.banner ? `<img src="${esc(imageSrc(w.banner, cwd))}" alt="" onerror="this.closest('.c-welcome')?.classList.remove('has-art'); this.parentElement.remove()">` : '';   // a banner that won't load leaves the plain welcome
  const chips = S.prompts.filter(pr => C.provider === 'codex' || pr.provider !== 'codex').slice(0, 8)
    .map(pr => `<button type="button" class="chip" data-c="chip" data-pid="${esc(pr.id)}">${esc(pr.title)}</button>`).join('');
  $c('cFeed').insertAdjacentHTML('beforeend', `<div class="c-welcome ${art ? 'has-art' : ''}">${art ? `<div class="cw-art">${art}</div>` : ''}
      <div class="cw-in"><p class="cw-k">A new ${C.provider === 'codex' ? 'Codex' : 'Claude'} chat in</p><h2>${esc(p ? p.name : C.folder || 'this folder')}</h2>
      ${chips ? `<p class="cw-h">Start from a prompt, or just write. Type <kbd class="kbd">/</kbd> to search them.</p><div class="chips">${chips}</div>` : ''}</div></div>`);
}
// What you were typing stays with each chat, even if you switch away or close the window.
const draftKey = () => (C.sessionId ? `draft:${C.sessionId}` : C.info && C.info.cwd ? `draft:new:${C.provider}:${C.info.cwd}` : null);
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const k = draftKey(); if (!k) return;
    const v = $c('cText').value, at = Date.now();
    try { if (v.trim()) { localStorage.setItem(k, v); localStorage.setItem(`${k}:at`, String(at)); } else { localStorage.removeItem(k); localStorage.removeItem(`${k}:at`); } } catch { /* full or private */ }
    // The PC keeps it too, for your other devices.
    if (C.sessionId) api('/api/draft', { id: C.sessionId, text: v, at }).catch(() => {});
  }, 400);
}
function restoreDraft() {
  const k = draftKey(); if (!k || $c('cText').value) return;
  let mine = 0;
  try { const v = localStorage.getItem(k); if (v) { $c('cText').value = v; grow(); } mine = Number(localStorage.getItem(`${k}:at`)) || 0; } catch { /* none */ }
  // Written later on your other device (the phone, the PC): that one, if you haven't started typing here.
  const id = C.sessionId, gen = C.gen, had = $c('cText').value;
  if (id) api(`/api/draft?id=${encodeURIComponent(id)}`).then(d => {
    if (gen !== C.gen || !d || !d.text || d.at <= mine || d.text === $c('cText').value || $c('cText').value !== had) return;
    $c('cText').value = d.text; grow();
    try { localStorage.setItem(k, d.text); localStorage.setItem(`${k}:at`, String(d.at)); } catch { /* fine */ }
    toast('Picked up what you were writing on your other device.', 3500);
  }).catch(() => {});
}
function clearDraft() { clearTimeout(draftTimer); const k = draftKey(); if (C.sessionId) api('/api/draft', { id: C.sessionId, text: '', at: Date.now() }).catch(() => {}); try { if (k) { localStorage.removeItem(k); localStorage.removeItem(`${k}:at`); } if (C.info && C.info.cwd) localStorage.removeItem(`draft:new:${C.provider}:${C.info.cwd}`); } catch { /* fine */ } }

async function sendMessage() {
  // An OpenClaw session: the message becomes a follow-up turn in that session (through
  // the agent's own CLI; it carries on in OpenClaw). One at a time.
  if (C.provider === 'openclaw' && C.watch && C.watch.sessionId) {
    const text = $c('cText').value.trim();
    if (!text) return;
    $c('cText').value = ''; clearDraft();
    const sid = C.watch.sessionId, gen = C.gen, id = C.watch.sessionId;
    renderItem($c('cFeed'), { kind: 'user', text, at: new Date().toISOString(), images: [] }, true);
    toBottom();
    $c('cSend').disabled = true; setStatus('main', `Sending to ${PROV_NAME[C.provider]}…`);
    setState('busy'); $c('cStop').hidden = true;
    try {
      const r = await api('/api/openclaw/send', { id: sid, text });
      if (gen === C.gen && r.reply) { setStatus('main', ''); }
    } catch (err) {
      if (gen === C.gen) { toast(`OpenClaw couldn’t send that: ${err.message}`, 6000); }
    } finally {
      if (gen === C.gen) {
        setState('watching'); $c('cSend').disabled = false; setStatus('main', '');
        // Give the CLI turn a beat to reach the transcript, then reconcile the feed.
        setTimeout(() => { if (gen === C.gen && C.watch) refreshWatch(); }, 1800);
        $c('cText').focus();
      }
    }
    return;
  }
  const typed = $c('cText').value;
  let text = typed;
  if (!text.trim() && !C.attachments.length && !(C.files || []).length) return;
  if (C.converting) { toast('Still preparing your pictures; send again in a moment.'); return; }
  const key0 = C.key, sentImgs = C.attachments.slice(), sentFiles = (C.files || []).filter(f => f.rel);
  // Clears only what was sent, and only in the same chat: anything typed meanwhile stays.
  const clear = () => {
    if (C.key !== key0) return;
    if ($c('cText').value === typed) { $c('cText').value = ''; clearDraft(); }
    for (const a of sentImgs) if (a.url) URL.revokeObjectURL(a.url);
    C.attachments = C.attachments.filter(a => !sentImgs.includes(a));
    C.files = (C.files || []).filter(f => !sentFiles.includes(f));
    renderAttachments(); grow();
  };
  const files = C.files || [];
  if (files.some(f => !f.rel && !f.error)) { toast('Still uploading. It sends once your files are attached; try again in a moment.'); return; }
  const ready = files.filter(f => f.rel);
  if (!text.trim() && !C.attachments.length && !ready.length) return;
  if (ready.length) text = `${text.replace(/\s+$/, '')}${text.trim() ? '\n\n' : ''}${ready.map(f => `Attached file: \`${f.rel}\` (${f.kind}, ${sizeText(f.size)})`).join('\n')}`;
  // /model and /effort switch without sending.
  const sw = text.trim().match(/^\/(model|effort)\s+(.{1,60})$/i);
  if (sw && !C.attachments.length) { clear(); await quickSwitch(sw[1].toLowerCase(), sw[2].trim()); return; }
  // "@codex …", "@gemini …", "@claude …" sends just this message to that one; "@both" or "@all" to all of them.
  let target = duo() && (C.target === 'comp' || C.target === 'both' || C.target === 'plan') ? C.target : 'main';
  // "/btw …": a side question, beside the chat (ui/chat-aside.js).
  const btw = text.match(/^\s*\/btw\s+/i);
  if (btw && !C.attachments.length) { const q = text.slice(btw[0].length); clear(); await openAside(q); return; }
  // "/plan …": plan first (one drafts, the other checks, you pick who builds).
  const pl = duo() && text.match(/^\s*\/plan\s+/i);
  if (pl) { target = 'plan'; text = text.slice(pl[0].length); }
  const at = duo() && text.match(/^\s*@(codex|claude|gemini|both|all)\b[:,]?\s*/i);
  if (at) {
    const w = at[1].toLowerCase(), all = w === 'both' || w === 'all';
    // @ another of the assistants: it's the one you write to (it joins, if it isn't in yet).
    if (!all && w !== C.provider && kindReady(w)) focusMate(w);
    target = all ? 'both' : w === C.provider ? 'main' : 'comp'; text = text.slice(at[0].length);
  }
  // Together: the ones you picked, in order ("@all" is everyone, this once); plan first takes two.
  const group = target === 'both' ? (at ? togetherAll() : groupKinds()) : target === 'plan' ? groupKinds().slice(0, 2) : null;
  if ((group ? group.includes(C.provider) : target !== 'comp') && C.state === 'ended') { toast('This chat has stopped. Click “Start again” first.'); return; }
  // Writing to one while the other is mid-reply: both would work at once, maybe on the same files.
  let after = false;
  if (duo() && target !== 'both' && target !== 'plan') {
    // Every other one in the chat that's mid-reply (with three, not only the one in view).
    const me = target === 'main' ? C.provider : partnerProv();
    const states = new Map([[C.provider, C.state]]);
    for (const [k, c] of Object.entries(C.comps || {})) if (c && !c.ended) states.set(k, c.state);
    if (C.comp && !C.comp.ended && !states.has(partnerProv())) states.set(partnerProv(), C.comp.state);
    const busy = [...states].filter(([k, st]) => k !== me && (st === 'busy' || st === 'waiting')).map(([k]) => k);
    if (busy.length) {
      const other = busy.map(k => PROV_NAME[k]).join(' and '), is = busy.length > 1 ? 'are' : 'is', to = PROV_NAME[me];
      const pick = await appChoice(`${other} ${is} still working.\n\nSend it to ${to} when ${busy.length > 1 ? 'they’re' : `${other} is`} done, so they don't edit the same files at once, or send it now and let ${busy.length > 1 ? 'them all' : 'both'} work?`,
        [{ v: 'after', label: `When ${other} ${is} done`, kind: 'prime' }, { v: 'now', label: 'Send now' }, { v: '', label: 'Cancel', kind: 'quiet' }]);
      if (!pick) return;
      after = pick === 'after';
    }
  }
  const images = C.attachments.slice();
  $c('cSend').disabled = true;
  try {
    // The app catches each one up on what it missed (lib/pairs.js); with Both they take turns.
    const refs = chatRefsIn(text);
    // "@chat[…]" that isn't linked (a draft from before a reload, say): it would go without that chat.
    const lost = [...String(text).matchAll(/@chat\[([^\]\n]+)\]/g)].map(m => m[1]).filter(l => !(C.chatRefs && C.chatRefs.get(l)));
    if (lost.length) { toast(`“${lost[0]}” isn’t linked any more. Type @ and pick it again, so its messages come along.`, 6000); return; }
    speedMark('reply');
    let r;
    // In turn, or (picked in Together) all at the same time.
    const how = target === 'both' && !at && groupHow() === 'parallel' ? 'parallel' : 'turns';
    const to = target === 'main' ? {} : target === 'both' ? { to: 'group', kinds: group, how, account: S.acct }
      : target === 'plan' ? { to: 'plan', by: group[0], kind: group[1], account: S.acct } : { to: 'partner', account: S.acct, kind: partnerProv() };
    C.sentGroup = group; C.sentHow = target === 'both' ? how : null;
    try { r = await api('/api/chat/send', { key: C.key, text, images, ...(refs.length ? { refs } : {}), ...to, ...(after ? { after: true } : {}) }); } catch (err) {
      // No connection (the phone left the Wi-Fi): a plain message waits here and goes when it's back.
      if (!err.offline || images.length || target !== 'main' || !C.key) throw err;
      outboxAdd({ key: C.key, sessionId: C.sessionId, title: C.info && C.info.title, text });
      clear();
      return;
    }
    clear();
    // Follow the partner's replies here (it may only just have started).
    if (group) for (const k of group) { if (k !== C.provider) ensureCompanion(k).catch(() => {}); }
    else if (target !== 'main' && !(C.comp && !C.comp.ended && (!r || !r.key || C.comp.key === r.key))) ensureCompanion().catch(() => {});
  } finally { $c('cSend').disabled = false; $c('cText').focus(); }
}
// Written while offline: kept on this device and sent, in order, as soon as the PC can be reached.
const outboxAll = () => { try { return JSON.parse(store('outbox') || '[]') || []; } catch { return []; } };
function outboxAdd(m) {
  store('outbox', JSON.stringify([...outboxAll(), { ...m, at: Date.now() }].slice(-30)));
  toast('No connection to your PC. Your message waits on this device and sends when you’re back.', 6000);
  renderOutbox(); outboxSoon();
  $c('cFeed').querySelector('.outbox-msg:last-child')?.scrollIntoView({ block: 'center' });
}
function renderOutbox() {
  const feed = $c('cFeed'); if (!feed) return;
  for (const el of feed.querySelectorAll('.outbox-msg')) el.remove();
  for (const m of outboxAll().filter(x => x.key === C.key || (x.sessionId && x.sessionId === C.sessionId))) {
    feed.insertAdjacentHTML('beforeend', `<div class="outbox-msg"><div class="ob-text">${esc(m.text)}</div><span class="ob-note">Waiting for a connection · sends by itself</span></div>`);
  }
}
let outboxTimer = null, outboxBusy = false;
function outboxSoon(ms = 15000) { clearTimeout(outboxTimer); if (outboxAll().length) outboxTimer = setTimeout(outboxFlush, ms); }
async function outboxFlush() {
  if (outboxBusy) return;
  outboxBusy = true;
  try {
    for (const m of outboxAll()) {
      try { await api('/api/chat/send', { key: m.key, text: m.text }); } catch (err) {
        if (err.offline) break;   // still away: try again later
        // The chat closed meanwhile: the words go back into its message box, not lost.
        if (m.sessionId) store(`draft:${m.sessionId}`, m.text);
        toast(`Your waiting message to “${m.title || 'a chat'}” couldn’t go (${err.message}). It’s back in that chat’s message box.`, 8000);
      }
      store('outbox', JSON.stringify(outboxAll().filter(x => !(x.at === m.at && x.text === m.text))));
      if (!outboxAll().length) toast('Your waiting messages were sent.', 3000);
    }
  } finally { outboxBusy = false; if (window.ChatUI && ChatUI.isOpen()) renderOutbox(); outboxSoon(); }
}
window.addEventListener('online', () => outboxSoon(500));
document.addEventListener('visibilitychange', () => { if (!document.hidden) outboxSoon(1000); });
outboxSoon(3000);
function modeOptions(list) {
  const sel = $c('cMode');
  sel.innerHTML = list.map(m => `<option value="${esc(m.value)}">${esc(m.label)}</option>`).join('');
  const what = `What ${PROV_NAME[C.provider] || 'it'} may do without asking`;   // Claude, or Codex in a Codex chat
  sel.title = what; const l = $c('cModeL'); if (l) l.textContent = what;
}
function setMode(m) {
  const sel = $c('cMode');
  if (!sel.querySelector(`option[value="${CSS.escape(m)}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(m)}">${esc(MODE_LABELS[m] || m)}</option>`);
  sel.value = m;
  if (C.info) C.info.permissionMode = m;
  renderLedgerSoon();
}
