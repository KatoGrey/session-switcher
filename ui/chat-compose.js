'use strict';
/* The message box: attachments, Esc to stop, and saved prompts (the Prompts button, and / in an empty box). */

/* ---------- composer ---------- */
const sizeText = n => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const kindOf = f => (/^video\//.test(f.type) || VIDEO_RE.test(f.name) ? 'video' : /^audio\//.test(f.type) || AUDIO_RE.test(f.name) ? 'audio' : /pdf$/.test(f.type) || /\.pdf$/i.test(f.name) ? 'PDF' : 'file');
function renderAttachments() {
  const imgs = C.attachments.map((a, i) => `<span class="att"><img src="${a.url ? esc(a.url) : `data:${esc(a.mediaType)};base64,${a.data}`}" alt=""><button type="button" data-rm="${i}" aria-label="Remove image">✕</button></span>`);
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
const Slash = { open: false, items: [], sel: 0, moved: false, dismissed: null };
const slashQuery = () => { const v = $c('cText').value; return /^\/[^\n]{0,40}$/.test(v) ? v.slice(1).trim().toLowerCase() : null; };
function closeSlash() { Slash.open = false; Slash.moved = false; $c('cSlash').hidden = true; }
function renderSlash() {
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
function pickSlash(i) { const pr = Slash.items[i]; closeSlash(); if (pr) insertPrompt(pr, true); }
// A new chat opens on its project: the banner, and your prompts one click away.
function welcome(cwd) {
  const p = cwd && S.projects.find(x => x.cwd === cwd);
  const w = cwd && S.worlds[cwd];
  const art = w && w.banner ? `<img src="${esc(imageSrc(w.banner, cwd))}" alt="">` : '';
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
  draftTimer = setTimeout(() => { const k = draftKey(); if (!k) return; try { const v = $c('cText').value; if (v.trim()) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* full or private */ } }, 400);
}
function restoreDraft() {
  const k = draftKey(); if (!k || $c('cText').value) return;
  try { const v = localStorage.getItem(k); if (v) { $c('cText').value = v; grow(); } } catch { /* none */ }
}
function clearDraft() { clearTimeout(draftTimer); const k = draftKey(); try { if (k) localStorage.removeItem(k); if (C.info && C.info.cwd) localStorage.removeItem(`draft:new:${C.provider}:${C.info.cwd}`); } catch { /* fine */ } }

async function sendMessage() {
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
  // "@codex …" or "@claude …" sends just this message to that one.
  let target = C.target === 'comp' && duo() ? 'comp' : 'main';
  const at = duo() && text.match(/^\s*@(codex|claude)\b[:,]?\s*/i);
  if (at) { target = at[1].toLowerCase() === 'codex' ? 'comp' : 'main'; text = text.slice(at[0].length); }
  if (target === 'main' && C.state === 'ended') { toast('This chat has stopped. Click “Start again” first.'); return; }
  const images = C.attachments.slice();
  $c('cSend').disabled = true;
  try {
    const key = target === 'comp' ? (await ensureCompanion()).key : C.key;
    await api('/api/chat/send', { key, text, images });
    clear();
  } finally { $c('cSend').disabled = false; $c('cText').focus(); }
}
function modeOptions(list) {
  const sel = $c('cMode');
  sel.innerHTML = list.map(m => `<option value="${esc(m.value)}">${esc(m.label)}</option>`).join('');
}
function setMode(m) {
  const sel = $c('cMode');
  if (!sel.querySelector(`option[value="${CSS.escape(m)}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(m)}">${esc(MODE_LABELS[m] || m)}</option>`);
  sel.value = m;
  if (C.info) C.info.permissionMode = m;
  renderLedgerSoon();
}
