'use strict';
/* Session Switcher: the Routines page and its editor. Routines are chats that start on their own, on a
   schedule or when a watched source has something new (lib/routines.js). Uses the hub's helpers from
   app.js: S, $, api, esc, toast, wrap, patch, showMenu, closeMenu, appConfirm, renderNav, ChatUI. */

const Routines = (() => {
  const R = { list: [], templates: [], secrets: {}, loaded: false, hist: new Set(), editing: null };
  const MODE_LABELS = { default: 'Ask before acting', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto' };
  const CODEX_MODES = [['agent', 'Agent'], ['ask', 'Ask before acting'], ['read-only', 'Read only'], ['full', 'Full access']];
  const STATUS = { starting: 'Starting', working: 'Working', done: 'Done', 'needs-you': 'Needs you', skipped: 'Waited', failed: 'Didn’t finish', stopped: 'Stopped' };
  const isCodexId = id => !!codexAcct(id);
  const folderOf = cwd => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || cwd;

  async function load() {
    const j = await api('/api/routines');
    Object.assign(R, { list: j.routines || [], templates: j.templates || [], secrets: j.secrets || {}, loaded: true });
  }
  let changeTimer = null;
  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(wrap(async () => { await load(); renderNav(); if (S.view === 'routines' && !document.querySelector('dialog[open]')) render(); }), 250);
  }
  // For the sidebar: how many are on, and whether a run needs you.
  function navInfo() {
    const on = R.list.filter(r => r.enabled).length;
    const needs = R.list.some(r => r.history[0] && r.history[0].status === 'needs-you');
    return { on, needs, any: R.list.length };
  }

  /* ---------- the page ---------- */
  function render() {
    if (!R.loaded) { $('page').innerHTML = '<p class="loading">Reading your routines…</p>'; load().then(render).catch(err => toast(err.message)); return; }
    const page = $('page');
    if (page.dataset.page !== 'routines' || !$('rtList')) {
      page.dataset.page = 'routines'; delete page.dataset.worldPage;
      page.innerHTML = `<header class="f-head"><div><p class="eyebrow">⟳ ${esc(voice('On their own'))}</p><h1>${esc(voice('Routines'))}</h1>
        <p class="f-meta">Chats that start by themselves: on a schedule, or when something new turns up in Slack or a command’s output. They run right here, so they show up under At work and Awaiting you like any chat.</p></div>
        <div class="f-act"><button class="btn" data-rt="template" aria-haspopup="menu" aria-expanded="false">From a template</button><button class="btn prime" data-rt="new">New routine</button></div></header>
        <div class="rt-list" id="rtList"></div>
        <p class="note rt-foot">Routines only read Slack and your commands; they never post. Each run is told to write any reply as a draft, for you to send. A run that was due while the Mac slept or the app was closed happens once when it’s back. A run waits if its account’s five-hour window is nearly used up.</p>`;
    }
    const empty = `<div class="rt-empty"><p class="empty-line">No routines yet. Start from one of these, or make your own with New routine.</p>
      <div class="rt-tpls">${R.templates.map(t => `<button class="rt-tpl" data-rt="use-template" data-tpl="${esc(t.id)}"><span class="rt-kind">${t.trigger.type === 'watch' ? (t.trigger.source.type === 'slack' ? 'Watches Slack' : 'Watches a command') : 'On a schedule'}</span><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}</div></div>`;
    patch($('rtList'), R.list, r => r.id, card, empty);
    tick();
  }

  function nextLine(r) {
    if (!r.enabled) return 'Paused. Resume it to start running again.';
    if (r.trigger.type === 'schedule') {
      const at = r.state.retryAt && (!r.state.nextAt || r.state.retryAt < r.state.nextAt) ? r.state.retryAt : r.state.nextAt;
      return at ? `Next run ${esc(when(new Date(at).toISOString()))} <span class="rt-in" data-until="${at}"></span>` : 'No next run is coming up.';
    }
    if (r.watchError) return `<span class="rt-bad">${esc(r.watchError)}</span>`;
    const q = r.queue ? ` ${plural(r.queue, 'new item')} waiting to run.` : '';
    return r.lastCheck ? `Last looked <span data-ago="${r.lastCheck}">${esc(agoL(r.lastCheck))}</span>.${q}` : 'Takes its first look in a moment (that one only notes what’s already there).';
  }
  function chatBtn(h) {
    if (!h.sessionId && !h.key) return '';
    return `<button class="btn sm quiet" data-rt="open-chat" data-run="${esc(h.id)}">Open chat</button>`;
  }
  function histItem(h) {
    return `<li class="rt-h st-${esc(h.status)}"><span class="rt-dot" aria-hidden="true"></span><span class="rt-hw" title="${esc(stamp(h.at))}">${esc(stamp(h.at))}</span>
      <span class="rt-hl"><b>${esc(STATUS[h.status] || h.status)}${h.count > 1 ? ` ×${h.count}` : ''}</b> ${esc(h.line || '')}${h.item && h.item.link ? ` <a href="${esc(h.item.link)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</span>${chatBtn(h)}</li>`;
  }
  function card(r) {
    const last = r.history[0];
    const acctName = (acctById(r.account) || {}).name || r.account;
    const mode = r.provider === 'codex' ? (CODEX_MODES.find(m => m[0] === r.permissionMode) || [0, r.permissionMode])[1] : MODE_LABELS[r.permissionMode] || r.permissionMode;
    const tag = !r.enabled ? '<span class="tag ghost">Paused</span>' : r.running ? '<span class="tag">Running</span>' : r.trigger.type === 'watch' ? (r.watchError ? '<span class="tag line">Can’t look</span>' : '<span class="tag gold">Watching</span>') : '<span class="tag gold">Scheduled</span>';
    const open = R.hist.has(r.id);
    const kind = r.trigger.type === 'watch' ? (r.trigger.source.type === 'slack' ? 'slack' : 'command') : 'clock';
    return `<article class="rt-card ${r.enabled ? '' : 'off'} ${r.provider === 'codex' ? 'codex' : ''}" data-id="${esc(r.id)}">
      <div class="rt-top"><span class="rt-ic rt-ic-${kind}" aria-hidden="true"></span><div class="rt-tt"><h3>${esc(r.name)}</h3><p class="rt-when">${esc(r.triggerText)}</p></div>${tag}</div>
      <p class="rt-meta"><span title="${esc(r.cwd)}">${esc(folderOf(r.cwd))}</span><span><span class="ring" style="--ring:${ringById(r.account)}"></span>as ${esc(acctName)}</span><span>${esc(mode)}</span><span>${r.chat.mode === 'continue' ? 'Keeps one chat going' : 'A new chat each run'}</span><span>Waits above ${r.limit}% used</span></p>
      <p class="rt-next">${nextLine(r)}</p>
      ${last ? `<div class="rt-last st-${esc(last.status)}"><span class="rt-dot" aria-hidden="true"></span><p><b>${esc(STATUS[last.status] || last.status)}</b> <span class="rt-ago" data-ago="${last.at}">${esc(agoL(last.at))}</span>. ${esc(last.line || '')}</p>${chatBtn(last)}</div>` : `<p class="rt-none">${r.trigger.type === 'watch' ? 'Nothing new has turned up yet.' : 'Hasn’t run yet.'}</p>`}
      <div class="rt-acts"><button class="btn sm ${r.enabled ? 'prime' : ''}" data-rt="run">${r.trigger.type === 'watch' ? 'Look now' : 'Run now'}</button>
        <button class="btn sm" data-rt="pause">${r.enabled ? 'Pause' : 'Resume'}</button><button class="btn sm quiet" data-rt="edit">Edit</button>
        ${r.history.length ? `<button class="btn sm quiet" data-rt="hist" aria-expanded="${open}">History <span class="count">${r.history.length}</span></button>` : ''}
        <span class="spacer"></span><button class="icon" data-rt="more" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(r.name)}">${ICON.more}</button></div>
      ${open && r.history.length ? `<ol class="rt-hist">${r.history.map(histItem).join('')}</ol>` : ''}
    </article>`;
  }

  async function openRun(r, h) {
    if (h.key) { try { return await ChatUI.openKey(h.key); } catch { /* it stopped; open it by id */ } }
    if (!h.sessionId) return toast('That chat didn’t start, so there’s nothing to open.');
    return ChatUI.open({ sessionId: h.sessionId, provider: h.provider || r.provider, accountId: isCodexId(r.account) ? null : r.account });
  }

  async function onClick(e) {
    const b = e.target.closest('[data-rt]'); if (!b) return undefined;
    const card = b.closest('.rt-card');
    const r = card ? R.list.find(x => x.id === card.dataset.id) : null;
    const act = b.dataset.rt;
    if (act === 'new') return edit(null);
    if (act === 'template') return b.getAttribute('aria-expanded') === 'true' ? closeMenu() : showMenu(b, R.templates.map(t => ({ label: t.name, hint: t.blurb, run: () => edit(null, t) })));
    if (act === 'use-template') return edit(null, R.templates.find(t => t.id === b.dataset.tpl));
    if (!r) return undefined;
    if (act === 'run') {
      b.disabled = true;
      try {
        const j = await api('/api/routines/run', { id: r.id });
        toast(j.started ? `${r.name} is running. It shows on the hub while it works.` : j.message, 5000);
      } finally { b.disabled = false; }
      return changed();
    }
    if (act === 'pause') { await api('/api/routines/pause', { id: r.id, paused: r.enabled }); toast(r.enabled ? `Paused ${r.name}.` : `${r.name} is back on. It waits for its next time rather than catching up.`, 4000); return changed(); }
    if (act === 'edit') return edit(r);
    if (act === 'hist') { if (R.hist.has(r.id)) R.hist.delete(r.id); else R.hist.add(r.id); return render(); }
    if (act === 'open-chat') { const h = r.history.find(x => x.id === b.dataset.run); return h ? openRun(r, h) : undefined; }
    if (act === 'more') {
      if (b.getAttribute('aria-expanded') === 'true') return closeMenu();
      return showMenu(b, [
        { label: 'Make a copy', run: () => edit({ ...r, id: null, name: `${r.name} (copy)` }) },
        ...(r.history.length ? [{ label: 'Clear the history', run: async () => { await api('/api/routines/clear', { id: r.id }); changed(); } }] : []),
        '-',
        { label: 'Delete', danger: true, run: async () => { if (!(await appConfirm(`Delete “${r.name}”?\n\nChats it already started stay where they are.`, { ok: 'Delete', danger: true }))) return; await api('/api/routines/remove', { id: r.id }); toast(`Deleted ${r.name}.`, 3000); changed(); } },
      ]);
    }
    return undefined;
  }

  /* ---------- the editor ---------- */
  function dialog() {
    if ($('rtDlg')) return $('rtDlg');
    document.body.insertAdjacentHTML('beforeend', `<dialog id="rtDlg" class="np-dlg rt-dlg" aria-labelledby="rtTitle">
      <form id="rtForm" novalidate>
        <div class="np-head"><h3 id="rtTitle">New routine</h3><button type="button" class="icon" data-rte="close" aria-label="Close">✕</button></div>
        <label class="np-f" for="rtName"><span>Name</span></label>
        <input id="rtName" maxlength="80" autocomplete="off" placeholder="Like “Morning check”">
        <p class="np-f">Starts</p>
        <div class="seg rt-seg" role="group" aria-label="Starts"><button type="button" data-rte-kind="schedule">On a schedule</button><button type="button" data-rte-kind="watch">When something new turns up</button></div>
        <div class="rt-sec" id="rtSched">
          <div class="rt-row"><select id="rtSk" aria-label="How often"><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="hours">Every few hours</option><option value="minutes">Every few minutes</option><option value="cron">Cron line</option></select>
            <label class="rt-inl" id="rtAtL">at <input id="rtTime" type="time" value="09:00"></label>
            <label class="rt-inl" id="rtEvL">every <input id="rtEvery" type="number" min="1" max="1440" value="2"> <span id="rtEvU">hours</span></label>
            <input id="rtCron" placeholder="0 9 * * 1-5" spellcheck="false" autocomplete="off" aria-label="Cron line"></div>
          <p class="np-path" id="rtSchedHint"></p>
        </div>
        <div class="rt-sec" id="rtWatch" hidden>
          <div class="rt-row"><select id="rtSrc" aria-label="What to watch"><option value="slack">A Slack channel</option><option value="command">A command’s output</option></select>
            <label class="rt-inl">look every <input id="rtWEvery" type="number" min="1" max="1440" value="2"> min</label></div>
          <div id="rtSlack">
            <label class="np-f" for="rtChan"><span>Channel ID</span></label>
            <input id="rtChan" placeholder="C0123ABCD" spellcheck="false" autocomplete="off">
            <p class="np-path">In Slack, click the channel’s name; the ID is at the bottom of About. New top-level posts start a run; replies in threads don’t.</p>
            <div class="rt-token" id="rtToken"></div>
          </div>
          <div id="rtCmd" hidden>
            <label class="np-f" for="rtCommand"><span>Command</span></label>
            <textarea id="rtCommand" class="pd-x rt-code" rows="2" spellcheck="false" placeholder="node scripts/new-bugs.js"></textarea>
            <p class="np-path">Runs in the routine’s folder. Each new line it prints starts a run. A line can be JSON like <code>{"id": "…", "text": "…", "link": "…"}</code>; otherwise the line is the text and its first web address is the link.</p>
          </div>
          <label class="np-f" for="rtFilter"><span>Only items that mention <small>(optional; /a|b/ for a pattern)</small></span></label>
          <input id="rtFilter" maxlength="200" autocomplete="off" placeholder="bug">
        </div>
        <label class="np-f" for="rtCwd"><span>Folder it works in</span></label>
        <div class="np-loc"><input id="rtCwd" list="rtPlaces" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-rte="browse">Browse…</button></div>
        <datalist id="rtPlaces"></datalist>
        <div class="rt-two">
          <div><label class="np-f" for="rtAcct"><span>Runs as</span></label><select id="rtAcct"></select></div>
          <div><label class="np-f" for="rtMode"><span>Permissions</span></label><select id="rtMode"></select></div>
        </div>
        <label class="np-f" for="rtPrompt"><span>What to do</span></label>
        <div class="rt-row rt-pick"><select id="rtSaved" aria-label="Saved prompt"></select></div>
        <textarea id="rtPrompt" class="pd-x" rows="6" placeholder="What to ask. {project} and {date} fill in automatically."></textarea>
        <div class="rt-two">
          <div><label class="np-f" for="rtChat"><span>Each run</span></label><select id="rtChat"></select></div>
          <div id="rtLimitBox"><label class="np-f" for="rtLimit"><span>Wait when the five-hour window is over</span></label><label class="rt-inl"><input id="rtLimit" type="number" min="50" max="100" value="90"> % used</label></div>
        </div>
        <div class="np-err" id="rtErr" role="alert" hidden></div>
        <div class="d-row"><button type="button" class="btn" data-rte="close">Cancel</button><button type="submit" class="btn prime" id="rtGo">Save routine</button></div>
      </form></dialog>`);
    const d = $('rtDlg');
    d.addEventListener('click', wrap(async e => {
      if (e.target === d) return d.close();
      const k = e.target.closest('[data-rte-kind]'); if (k) return setKind(k.dataset.rteKind);
      const b = e.target.closest('[data-rte]'); if (!b) return undefined;
      if (b.dataset.rte === 'close') return d.close();
      if (b.dataset.rte === 'browse') {
        const r = await api('/api/project/pick', { start: $('rtCwd').value || '', title: 'Choose the folder the routine works in' });
        if (r.unsupported) toast('Type the folder’s full path instead.', 4000); else if (r.path) { $('rtCwd').value = r.path; fillChats(); }
        return undefined;
      }
      if (b.dataset.rte === 'token') return saveToken();
      if (b.dataset.rte === 'token-remove') { if (!(await appConfirm('Remove the Slack token from the Keychain?\n\nSlack watchers stop until you add one again.', { ok: 'Remove', danger: true }))) return undefined; R.secrets = (await api('/api/routines/secret', { name: 'slack', value: '' })).secrets; return fillToken(); }
      return undefined;
    }));
    $('rtSk').addEventListener('change', fillSched);
    for (const id of ['rtTime', 'rtEvery', 'rtCron']) $(id).addEventListener('input', fillSched);
    $('rtSrc').addEventListener('change', fillSrc);
    $('rtAcct').addEventListener('change', () => { fillModes(); fillChats(); });
    $('rtCwd').addEventListener('change', fillChats);
    $('rtSaved').addEventListener('change', () => {
      const p = S.prompts.find(x => x.id === $('rtSaved').value);
      if (p && (!$('rtPrompt').value.trim() || $('rtPrompt').value === $('rtPrompt').dataset.from)) { $('rtPrompt').value = p.text; $('rtPrompt').dataset.from = p.text; }
      $('rtSaved').value = '';
    });
    $('rtForm').addEventListener('submit', e => { e.preventDefault(); wrap(submit)(); });
    return d;
  }
  const kind = () => ($('rtDlg').querySelector('[data-rte-kind].on') || {}).dataset?.rteKind || 'schedule';
  function setKind(k) {
    for (const b of $('rtDlg').querySelectorAll('[data-rte-kind]')) { const on = b.dataset.rteKind === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    $('rtSched').hidden = k !== 'schedule'; $('rtWatch').hidden = k !== 'watch';
    if (k === 'watch') fillSrc(); else fillSched();
  }
  function fillSched() {
    const sk = $('rtSk').value;
    $('rtAtL').hidden = !['daily', 'weekdays'].includes(sk);
    $('rtEvL').hidden = !['hours', 'minutes'].includes(sk);
    $('rtCron').hidden = sk !== 'cron';
    $('rtEvU').textContent = sk === 'minutes' ? 'minutes' : 'hours';
    const t = $('rtTime').value || '09:00', n = Math.max(1, Number($('rtEvery').value) || 1);
    const at = (() => { const [h, m] = t.split(':').map(Number); return clock(new Date(2000, 0, 1, h, m).getTime()); })();
    $('rtSchedHint').textContent = sk === 'daily' ? `Every day at ${at}.` : sk === 'weekdays' ? `Monday to Friday at ${at}.` : sk === 'hours' ? `Every ${n === 1 ? 'hour' : `${n} hours`}, counted from the last run.` : sk === 'minutes' ? `Every ${n === 1 ? 'minute' : `${n} minutes`}, counted from the last run.` : 'Five parts: minute, hour, day of month, month, day of week. “0 9 * * 1-5” is 9:00 AM on weekdays.';
  }
  function fillSrc() {
    const slack = $('rtSrc').value === 'slack';
    $('rtSlack').hidden = !slack; $('rtCmd').hidden = slack;
    fillToken();
  }
  function fillToken() {
    const box = $('rtToken'); if (!box) return;
    if (R.secrets.slack) { box.innerHTML = '<p class="np-path"><b class="rt-ok">✓</b> A Slack token is saved in this Mac’s Keychain. <button type="button" class="linkish" data-rte="token-remove">Remove it</button></p>'; return; }
    box.innerHTML = window.REMOTE ? '<p class="np-path rt-bad">Add the Slack token on the Mac itself (it’s kept in its Keychain).</p>'
      : `<label class="np-f" for="rtTok"><span>Slack token</span></label><div class="np-loc"><input id="rtTok" type="password" autocomplete="off" spellcheck="false" placeholder="xoxb-…"><button type="button" class="btn" data-rte="token">Save in Keychain</button></div>
        <p class="np-path">A Slack app’s bot token with <code>channels:history</code> (and <code>groups:history</code> for a private channel). It goes straight into the macOS Keychain, never into a file. Invite the app to the channel.</p>`;
  }
  async function saveToken() {
    const v = $('rtTok').value.trim(); if (!v) return $('rtTok').focus();
    R.secrets = (await api('/api/routines/secret', { name: 'slack', value: v })).secrets;
    toast('Saved the Slack token in the Keychain.', 3000);
    fillToken();
  }
  function fillAccounts(sel) {
    const claude = S.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.signedIn ? '' : ' (not signed in)'}</option>`).join('');
    const cx = S.codex && S.codex.enabled ? codexAccts().map(c => `<option value="${esc(c.id)}">${esc(c.name || 'Codex')}${c.kind === 'ollama' ? ' (Ollama)' : ''}${c.signedIn ? '' : ' (not signed in)'}</option>`).join('') : '';
    $('rtAcct').innerHTML = `<optgroup label="Claude">${claude}</optgroup>${cx ? `<optgroup label="Codex">${cx}</optgroup>` : ''}`;
    $('rtAcct').value = sel && [...$('rtAcct').options].some(o => o.value === sel) ? sel : current().id;
  }
  function fillModes(sel) {
    const opts = isCodexId($('rtAcct').value) ? CODEX_MODES : Object.entries(MODE_LABELS);
    const keep = sel || $('rtMode').value;
    $('rtMode').innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    $('rtMode').value = opts.some(o => o[0] === keep) ? keep : opts[0][0];
  }
  // A new chat each run, one chat kept going, or one of the folder's chats to continue.
  function fillChats(sel) {
    const cwd = $('rtCwd').value.trim();
    const codexAcc = isCodexId($('rtAcct').value);
    const p = S.projects.find(x => x.cwd === cwd);
    const chats = p ? p.sessions.filter(x => isCodex(x) === codexAcc).slice(0, 30) : [];
    const keep = sel !== undefined ? sel : $('rtChat').value;
    $('rtChat').innerHTML = `<option value="new">Starts a new chat</option><option value="continue">Continues one chat (made on the first run)</option>${chats.length ? `<optgroup label="Or continue a chat in this folder">${chats.map(c => `<option value="s:${esc(c.id)}">${esc(c.title.slice(0, 70))}</option>`).join('')}</optgroup>` : ''}`;
    $('rtChat').value = [...$('rtChat').options].some(o => o.value === keep) ? keep : (keep && keep.startsWith('s:') ? 'continue' : 'new');
  }

  function edit(r, tpl = null) {
    closeMenu();
    const d = dialog();
    const src = r || tpl || {};
    R.editing = r && r.id ? r.id : null;
    $('rtTitle').textContent = R.editing ? `Edit ${r.name}` : tpl ? tpl.name : 'New routine';
    $('rtName').value = src.name || '';
    const t = src.trigger || { type: 'schedule', schedule: { kind: 'daily', time: '09:00' } };
    const s = t.schedule || { kind: 'daily', time: '09:00' };
    $('rtSk').value = s.kind === 'every' ? s.unit : s.kind;
    $('rtTime').value = s.time || '09:00'; $('rtEvery').value = s.every || 2; $('rtCron').value = s.cron || '';
    const w = t.source || { type: 'slack', every: 2 };
    $('rtSrc').value = w.type || 'slack'; $('rtWEvery').value = w.every || 2;
    $('rtChan').value = w.channel || ''; $('rtCommand').value = w.command || ''; $('rtFilter').value = w.filter || '';
    $('rtCwd').value = src.cwd || (S.view === 'folder' && S.folder) || (S.projects[0] && S.projects[0].cwd) || '';
    $('rtPlaces').innerHTML = S.projects.filter(p => p.exists).map(p => `<option value="${esc(p.cwd)}">`).join('');
    fillAccounts(src.account);
    fillModes(src.permissionMode);
    fillChats(src.chat ? (src.chat.mode === 'continue' ? (src.chat.sessionId ? `s:${src.chat.sessionId}` : 'continue') : 'new') : 'new');
    $('rtSaved').innerHTML = `<option value="">Use a saved prompt…</option>${S.prompts.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}`;
    $('rtPrompt').value = src.prompt || ''; delete $('rtPrompt').dataset.from;
    $('rtLimit').value = src.limit || 90;
    $('rtErr').hidden = true;
    setKind(t.type === 'watch' ? 'watch' : 'schedule');
    d.showModal();
    (tpl && t.type === 'watch' && w.type === 'slack' ? $('rtChan') : tpl && t.type === 'watch' ? $('rtCommand') : $('rtName')).focus();
  }

  async function submit() {
    const k = kind(), sk = $('rtSk').value;
    const chatSel = $('rtChat').value;
    const body = {
      id: R.editing || undefined,
      name: $('rtName').value, cwd: $('rtCwd').value.trim(), account: $('rtAcct').value, permissionMode: $('rtMode').value,
      prompt: $('rtPrompt').value, limit: Number($('rtLimit').value) || 90,
      chat: chatSel.startsWith('s:') ? { mode: 'continue', sessionId: chatSel.slice(2) } : { mode: chatSel === 'continue' ? 'continue' : 'new' },
      trigger: k === 'watch'
        ? { type: 'watch', source: { type: $('rtSrc').value, channel: $('rtChan').value, command: $('rtCommand').value, filter: $('rtFilter').value, every: Number($('rtWEvery').value) } }
        : { type: 'schedule', schedule: ['hours', 'minutes'].includes(sk) ? { kind: 'every', every: Number($('rtEvery').value), unit: sk } : sk === 'cron' ? { kind: 'cron', cron: $('rtCron').value } : { kind: sk, time: $('rtTime').value } },
    };
    $('rtGo').disabled = true;
    try {
      const j = await api('/api/routines', body);
      $('rtDlg').close();
      toast(R.editing ? `Saved ${j.routine.name}.` : `${j.routine.name} is on. ${j.routine.trigger.type === 'watch' ? 'Its first look only notes what’s already there.' : `Next run ${when(new Date(j.routine.state.nextAt).toISOString())}.`}`, 5000);
      changed();
    } catch (err) {
      $('rtErr').innerHTML = `<span>${esc(err.message)}</span>`; $('rtErr').hidden = false;
    } finally { $('rtGo').disabled = false; }
  }

  $('page').addEventListener('click', e => { if (S.view === 'routines' && e.target.closest('[data-rt]')) { e.stopPropagation(); wrap(onClick)(e); } }, true);
  load().then(() => renderNav()).catch(() => {});
  return { load, changed, render, navInfo, edit };
})();
window.Routines = Routines;
