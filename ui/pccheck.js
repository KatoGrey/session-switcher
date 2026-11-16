'use strict';
/* PC check-up (lib/pccheck.js): what's running and taking space on this PC, with Claude's word on each line, and a
   tick for each you want closed or cleared. Nothing happens until you confirm, and then only to what you ticked.
   From Setup (Health), Ctrl+K and the PC check-up card. */

const PcCheck = { scan: null, notes: {}, busy: false, picked: new Set(), still: [] };

const gb = bytes => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);
const memWords = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function pcDialog() {
  let d = $('pcDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="pcDlg" class="wide pck-dlg" aria-labelledby="pcTitle"><form method="dialog" id="pcForm">
    <div class="setup-head"><h3 id="pcTitle">PC check-up</h3><button type="button" class="icon" data-pc="close" aria-label="Close">✕</button></div>
    <div class="pck-body" id="pcBody"></div>
    <div class="pck-foot"><p class="pck-status" id="pcStatus" role="status" aria-live="polite"></p><span class="spacer"></span>
      <button type="button" class="btn" data-pc="scan" id="pcScan">Check again</button><button type="submit" class="btn prime" id="pcGo" disabled>Close and clear…</button></div>
  </form></dialog>`);
  d = $('pcDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d || e.target.closest('[data-pc="close"]')) return d.close();
    if (e.target.closest('[data-pc="scan"]')) return pcScan();
    if (e.target.closest('[data-pc="force"]')) return pcForce();
    return undefined;
  }));
  d.addEventListener('change', e => {
    const c = e.target.closest('input[data-pick]'); if (!c) return;
    if (c.checked) PcCheck.picked.add(c.dataset.pick); else PcCheck.picked.delete(c.dataset.pick);
    pcFoot();
  });
  $('pcForm').addEventListener('submit', wrap(async e => { e.preventDefault(); return pcGo(); }));
  return d;
}
function openPcCheck() {
  const d = pcDialog();
  if (!d.open) d.showModal();
  if (!PcCheck.scan || Date.now() - PcCheck.scan.at > 10 * 60000) return pcScan();
  pcRender();
  return undefined;
}
async function pcScan() {
  if (PcCheck.busy) return;
  PcCheck.busy = true; PcCheck.picked.clear(); PcCheck.notes = {}; PcCheck.still = [];
  $('pcScan').disabled = true; $('pcGo').disabled = true;
  $('pcStatus').textContent = 'Looking at what’s running and what’s taking space…';
  if (!PcCheck.scan) $('pcBody').innerHTML = '<p class="loading">Looking at what’s running and what’s taking space (about 15 seconds)…</p>';
  try {
    PcCheck.scan = await api('/api/pc/scan', {});
    pcRender();
    if (!PcCheck.scan.supported) { $('pcStatus').textContent = ''; return; }
    $('pcStatus').textContent = 'Claude is saying what each one is…';
    const r = await api('/api/pc/explain', {}).catch(() => ({ notes: {} }));
    PcCheck.notes = r.notes || {};
    pcRender();
    $('pcStatus').textContent = r.signedIn === false ? 'Checked. (Sign in to a Claude account for a word on what each one is.)' : `Checked ${new Date(PcCheck.scan.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  } catch (err) {
    $('pcStatus').textContent = err.message || 'It couldn’t look. Try again.';
    if (!PcCheck.scan) $('pcBody').innerHTML = '';
  } finally {
    PcCheck.busy = false; $('pcScan').disabled = false; pcFoot();
  }
}
const ADVICE = { close: ['Safe to close', 'ok'], careful: ['Save your work first', 'warn'], leave: ['Leave it', 'muted'] };
function pcRow(it) {
  const n = PcCheck.notes[it.id] || {}, prog = it.kind === 'process';
  const lock = prog && it.protected;
  const advice = lock ? null : ADVICE[n.advice];
  const adviceText = advice && !prog && n.advice === 'close' ? 'Safe to clear' : advice && !prog && n.advice === 'careful' ? 'Check first' : advice && advice[0];
  const facts = prog
    ? [memWords(it.memMB), it.cpu >= 0.5 ? `${it.cpu}% CPU` : 'idle', it.count > 1 ? `${it.count} processes` : '', it.since ? `running ${dur(Date.now() - it.since).replace(/ \d+m$/, '')}` : '', it.script ? `runs ${it.script}` : ''].filter(Boolean)
    : [`${it.partial ? 'over ' : ''}${gb(it.bytes)}`, it.count > 1 ? `${it.count.toLocaleString()} items` : '', it.newest ? `last changed ${agoL(it.newest)}` : '', it.how === 'recycle' ? 'goes to the Recycle Bin' : it.how === 'empty' ? 'emptied for good' : 'deleted for good'].filter(Boolean);
  const name = prog ? (it.label || it.name) : it.label;
  return `<li class="pck-row ${lock ? 'locked' : ''}">
    <label><input type="checkbox" data-pick="${esc(it.id)}" ${lock ? 'disabled' : ''} ${PcCheck.picked.has(it.id) ? 'checked' : ''} aria-describedby="pcw-${esc(it.id)}">
      <span class="pck-t"><span class="pck-n"><b>${esc(name)}</b>${prog && it.label && it.label !== it.name ? `<small>${esc(it.name)}</small>` : ''}${it.hung ? '<span class="pck-flag bad">Not responding</span>' : ''}${lock ? `<span class="pck-flag">${esc(it.protected)}</span>` : adviceText ? `<span class="pck-flag ${advice[1]}">${esc(adviceText)}</span>` : ''}</span>
        <span class="pck-w" id="pcw-${esc(it.id)}">${n.what ? `${esc(n.what)}${n.why ? `. ${esc(n.why)}` : ''}` : prog ? esc(it.title || it.path || '') : esc(it.note || '')}</span>
        <span class="pck-f">${facts.map(esc).join(' · ')}</span></span></label></li>`;
}
function pcRender() {
  const s = PcCheck.scan; if (!s) return;
  if (!s.supported) { $('pcBody').innerHTML = '<p class="rd-intro">PC check-up is for Windows for now.</p>'; return; }
  const hung = s.processes.filter(p => p.hung), rest = s.processes.filter(p => !p.hung).sort((a, b) => b.memMB - a.memMB);
  const drives = (s.drives || []).filter(d => d.sizeGB > 0).map(d => `${d.id} ${d.freeGB} GB free of ${d.sizeGB >= 1024 ? `${(d.sizeGB / 1024).toFixed(1)} TB` : `${d.sizeGB} GB`}`).join(' · ');
  $('pcBody').innerHTML = `<p class="rd-intro">Tick what you want closed or cleared, then <b>Close and clear</b>. Nothing happens until you confirm. Programs are asked to close as their own close button would; Windows’ own and Session Switcher’s can’t be ticked.</p>
    ${drives ? `<p class="pck-drives">${esc(drives)}${s.memGB ? ` · ${s.memGB} GB of memory` : ''}</p>` : ''}
    ${hung.length ? `<h4 class="pck-h">Not responding</h4><ul class="pck-list">${hung.map(pcRow).join('')}</ul>` : ''}
    <h4 class="pck-h">Programs using the most</h4><ul class="pck-list">${rest.map(pcRow).join('') || '<li class="pck-none">Nothing using much right now.</li>'}</ul>
    <h4 class="pck-h">Space you can free</h4><ul class="pck-list">${s.space.length ? s.space.map(pcRow).join('') : '<li class="pck-none">Nothing much to free: no big caches, old temporary files or leftovers.</li>'}</ul>
    ${PcCheck.still.length ? `<p class="pck-still">${esc(PcCheck.still.map(x => x.name).join(', '))} ${PcCheck.still.length === 1 ? 'was' : 'were'} asked to close and ${PcCheck.still.length === 1 ? 'is' : 'are'} still open (a Save prompt, maybe). <button type="button" class="btn sm danger" data-pc="force">Force close</button></p>` : ''}`;
  pcFoot();
}
function pcPicked() {
  const s = PcCheck.scan || { processes: [], space: [] };
  const progs = s.processes.filter(p => PcCheck.picked.has(p.id) && !p.protected);
  const space = s.space.filter(x => PcCheck.picked.has(x.id));
  return { progs, space, bytes: space.reduce((n, x) => n + x.bytes, 0) };
}
function pcFoot() {
  const { progs, space, bytes } = pcPicked();
  const go = $('pcGo');
  go.disabled = PcCheck.busy || (!progs.length && !space.length);
  go.textContent = !progs.length && !space.length ? 'Close and clear…' : [progs.length ? `Close ${progs.length}` : '', space.length ? `clear ${gb(bytes)}` : ''].filter(Boolean).join(' and ').replace(/^c/, 'C') + '…';
}
async function pcGo() {
  const { progs, space, bytes } = pcPicked();
  if (!progs.length && !space.length) return;
  const lines = [
    progs.length ? `Close ${progs.map(p => p.label || p.name).join(', ')}?` : '',
    space.length ? `${progs.length ? 'And clear' : 'Clear'} ${space.map(x => x.label).join(', ')} (${gb(bytes)})?` : '',
  ].filter(Boolean).join(' ');
  const how = [progs.length ? 'Each program is asked to close as its close button would; one with unsaved work may ask you first.' : '', space.some(x => x.how === 'delete' || x.how === 'empty') ? 'Caches, temporary files and the Recycle Bin are deleted for good (caches come back as they’re needed).' : '', space.some(x => x.how === 'recycle') ? 'Downloads go to the Recycle Bin.' : ''].filter(Boolean).join(' ');
  if (!(await appConfirm(`${lines}\n\n${how}`, { ok: progs.length && space.length ? 'Close and clear' : progs.length ? 'Close them' : 'Clear it', danger: true }))) return;
  await pcDo({ close: progs.map(p => p.id), free: space.map(x => x.id), at: PcCheck.scan.at });
}
async function pcDo(body) {
  PcCheck.busy = true; $('pcGo').disabled = true; $('pcScan').disabled = true;
  $('pcStatus').textContent = body.force ? 'Ending them…' : 'Closing and clearing…';
  try {
    const r = await api('/api/pc/act', body);
    const done = r.results.filter(x => x.ok), notDone = r.results.filter(x => !x.ok);
    PcCheck.still = r.results.filter(x => x.still).map(x => ({ id: x.id, name: x.name }));
    toast([done.length ? `Done: ${done.map(x => `${x.name} ${x.said}`).join('; ')}.` : '', r.freed ? `${gb(r.freed)} freed.` : '', notDone.length ? `Not done: ${notDone.map(x => `${x.name} (${x.said})`).join('; ')}.` : ''].filter(Boolean).join(' '), 9000);
    const still = PcCheck.still;
    PcCheck.busy = false;
    await pcScan();
    PcCheck.still = still.filter(x => PcCheck.scan && PcCheck.scan.processes.some(p => p.id === x.id));
    pcRender();
  } catch (err) {
    $('pcStatus').textContent = err.message;
  } finally {
    PcCheck.busy = false; $('pcScan').disabled = false; pcFoot();
  }
}
async function pcForce() {
  const names = PcCheck.still.map(x => x.name).join(', ');
  if (!(await appConfirm(`Force ${names} to close?\n\nIt ends at once: anything unsaved in it is lost.`, { ok: 'Force close', danger: true }))) return;
  await pcDo({ close: PcCheck.still.map(x => x.id), force: true, at: PcCheck.scan.at });
}
