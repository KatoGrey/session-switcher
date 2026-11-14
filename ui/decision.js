'use strict';
/* One decision control: a permission request (or a simple question) drawn from one shape on the hub's cards,
   in the chat and on a phone. Who asks, what it wants, why, what "Always allow" covers from now on, and which
   answer is the safe one; the same words everywhere ("Allow once", "Always allow", "Deny"), the same default,
   and the same Deny: an optional "what to do instead", then Deny (Enter sends it, empty is fine). Every button
   carries the id of the request it was drawn for, and only that id is ever answered. A card says so when the
   request was answered somewhere else meanwhile, and a call that fails leaves its buttons working. */
const Decision = (() => {
  const WHO = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', openclaw: 'OpenClaw' };
  const VERB = { Bash: 'run a command', PowerShell: 'run a command', Edit: 'edit a file', MultiEdit: 'edit a file', NotebookEdit: 'edit a notebook', Write: 'create or overwrite a file', WebFetch: 'open a web page', WebSearch: 'search the web' };
  const verb = tool => VERB[tool] || (window.CMDR_TOOLS && window.CMDR_TOOLS[tool]) || `use ${tool || 'a tool'}`;
  const SKIPPED = 'The user skipped the question.';
  const STALE = 'Already answered: that request isn’t waiting any more, so nothing was changed.';
  // When Claude Code doesn't say what Always would cover (an older copy of the app, say).
  const SOME_SCOPE = 'this kind of action in this project, without asking again';

  // What you've started on a card (the note open, what you typed, the answer you picked), kept by request: the
  // hub draws a card again whenever anything in its chat changes, and it comes back the way you left it.
  const ui = new Map();
  const uiKey = (key, rid) => `${key || ''}|${rid}`;
  const uiOf = (key, rid) => ui.get(uiKey(key, rid)) || {};
  function remember(key, rid, patch) {
    const k = uiKey(key, rid);
    ui.set(k, { ...(ui.get(k) || {}), ...patch });
    if (ui.size > 60) ui.delete(ui.keys().next().value);
  }
  const forget = (key, rid) => ui.delete(uiKey(key, rid));

  // A chat's permission event, or a waiting request from the hub's list, as one shape. key: the running chat
  // it belongs to (its answer goes there).
  function shape(p, { provider = 'claude', key = '' } = {}) {
    const v = p.view || {}, qs = Array.isArray(p.questions) && p.questions.length ? p.questions : null;
    const detailKind = v.detailKind || (p.detail ? 'command' : '');
    return {
      requestId: String(p.requestId ?? ''), key: key || '', provider, who: WHO[provider] || 'It', toolName: p.toolName || '', view: v,
      summary: String(v.summary ?? p.summary ?? ''), detail: detailKind === 'command' ? String((v.detailKind ? v.detail : p.detail) || '') : '', detailKind,
      title: p.title || '', description: p.description || '', reason: p.reason || '', blockedPath: p.blockedPath || '',
      canAlways: !!p.canAlways, alwaysScope: p.alwaysScope || '', defaultToNo: !!p.defaultToNo, questions: qs, question: !!qs || !!p.question,
    };
  }
  // One question, a few answers, one to pick: that can be answered right on a hub card. Anything bigger opens the chat.
  const simple = d => !!d.questions && d.questions.length === 1 && !d.questions[0].multiSelect && d.questions[0].options.length > 0 && d.questions[0].options.length <= 4;
  // The facts under what it wants, each said once.
  function facts(d, shown) {
    const seen = new Set([d.toolName, shown].filter(Boolean).map(s => String(s).trim()));
    const out = [];
    for (const t of [d.title, d.description].map(s => String(s || '').trim())) if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (d.reason) out.push(`Why it’s asking: ${d.reason}`);
    if (d.blockedPath) out.push(`Outside your project: ${d.blockedPath}`);
    return out;
  }
  function fieldset(d, q, qi, hub, st) {
    const multi = !!q.multiSelect, type = multi ? 'checkbox' : 'radio', at = `data-req="${esc(d.requestId)}"`;
    const name = esc(`dec-${hub ? 'h' : 'c'}-${d.key}-${d.requestId}-${qi}`), picked = (st.picks || {})[qi];
    const on = v => ((multi ? Array.isArray(picked) && picked.includes(v) : picked === v) ? ' checked' : '');
    return `<fieldset class="q" data-qi="${qi}" data-q="${esc(q.question)}"><legend>${q.header ? `<span class="q-h">${esc(q.header)}</span>` : ''}${esc(q.question)}</legend>
      ${q.options.map((o, oi) => `<label class="opt"><input type="${type}" name="${name}" value="${oi}" data-label="${esc(o.label)}" ${at}${on(String(oi))}><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}
      <label class="opt other"><input type="${type}" name="${name}" value="other" ${at}${on('other')}><span><b>Other</b><input type="text" class="other-t" placeholder="Type your own answer" aria-label="Your own answer" value="${esc((st.other || {})[qi] || '')}" ${at}></span></label></fieldset>`;
  }

  // The decision's pieces, for a hub card (density 'hub': small buttons that sit in the card's footer) or the
  // chat (density 'chat': the full card). more: how many others wait behind it (the hub shows only the first).
  // answerable: false where it can't be answered from here (it only shows what's asked).
  // Returns attrs (for the element that holds it all), body, acts (its buttons), note (Deny's field), foot (the
  // chat's button row with the note), and complex (a question too big for a card).
  function parts(d, { density = 'hub', more = 0, crest = '', where = '', answerable = true } = {}) {
    const hub = density === 'hub', sm = hub ? ' sm' : '', at = `data-req="${esc(d.requestId)}"`;
    const st = uiOf(d.key, d.requestId), open = !!st.note && !d.question && answerable;
    const attrs = `data-dec="${esc(d.requestId)}"${d.key ? ` data-dec-key="${esc(d.key)}"` : ''}`;
    const moreH = hub && more > 0 ? `<button type="button" class="dec-more" data-a="open" title="Open the chat to see ${more === 1 ? 'it' : 'them'}">+${more} more waiting</button>` : '';
    let body, acts = '', note = '', complex = false;
    if (d.question) {
      const n = d.questions ? d.questions.length : 1;
      complex = hub && !simple(d);
      if (complex) body = `<p class="o-ask">${esc(d.who)} asked ${n === 1 ? 'a question with choices' : `${n} questions`}. Open the chat to answer ${n === 1 ? 'it' : 'them'}.</p>`;
      else {
        const qs = d.questions.map((q, qi) => fieldset(d, q, qi, hub, st)).join('');
        body = hub ? `<p class="o-ask">${esc(d.who)} asks:</p>${qs}` : `<p class="perm-h">${esc(d.who)} has <b>${n === 1 ? 'a question' : `${n} questions`}</b></p>${qs}`;
        if (answerable) acts = `<button type="button" class="btn gilt${sm}" data-p="answer" ${at}>${n === 1 ? 'Send answer' : 'Send answers'}</button><button type="button" class="btn${sm}" data-p="skip" ${at}>Skip</button>`;
      }
    } else {
      const what = d.detailKind === 'command' ? d.detail : d.summary;
      const info = facts(d, what).map(t => `<p class="${hub ? 'dec-r' : 'perm-r'}">${esc(t)}</p>`).join('');
      const scope = d.canAlways ? `<p class="dec-scope"><b>Always allow:</b> ${esc(d.alwaysScope || SOME_SCOPE)}</p>` : '';
      body = hub
        ? `<p class="o-ask">${esc(d.who)} wants to ${esc(verb(d.toolName))}${what ? ':' : '.'}</p>${what ? `<p class="o-cmd"><code>${esc(what)}</code></p>` : ''}${info}${scope}`
        : `<p class="perm-k">${crest}<span>Needs your OK${where ? ` · ${esc(where)}` : ''}</span></p>
          <p class="perm-h">${esc(d.who)} wants to <b>${esc(verb(d.toolName))}</b>${d.summary && d.detailKind !== 'command' ? `: <span class="perm-sum">${esc(d.summary)}</span>` : ''}</p>
          <div class="perm-d">${typeof toolDetail === 'function' ? toolDetail(d.view) : ''}${d.detail ? `<button type="button" class="ta perm-copy" data-copy="${esc(d.detail)}" title="Copy the command">Copy</button>` : ''}</div>
          ${info}${scope}`;
      if (answerable) {
        // The safe answer is the one that stands out: Allow, unless Claude Code says No should be the default.
        const yes = d.defaultToNo ? '' : ' gilt', no = d.defaultToNo ? ' gilt' : '', hide = open ? ' hidden' : '';
        acts = `<button type="button" class="btn${sm}${yes}" data-p="allow" ${at}${hide}>${d.canAlways ? 'Allow once' : 'Allow'}</button>`
          + (d.canAlways ? `<button type="button" class="btn${sm}" data-p="always" ${at} title="${esc(`From now on: ${d.alwaysScope || SOME_SCOPE}`)}"${hide}>Always allow</button>` : '')
          + `<button type="button" class="btn${sm}${no}" data-p="deny" ${at} aria-expanded="${open}"${hide}>Deny</button>`;
        note = `<div class="dec-note${hub ? '' : ' perm-why'}"${open ? '' : ' hidden'}><input type="text" class="dec-why why-t" data-p="note" ${at} value="${esc(st.text || '')}" placeholder="Tell ${esc(d.who)} what to do instead (optional)" aria-label="What ${esc(d.who)} should do instead (optional)" enterkeyhint="send" autocomplete="off"><button type="button" class="btn${sm} gilt" data-p="deny-send" ${at}>Deny</button><button type="button" class="btn quiet${sm}" data-p="back" ${at}>Back</button></div>`;
      }
    }
    return { attrs, body: body + moreH, acts, note, complex, foot: hub ? '' : `<div class="perm-b dec-b"${open ? ' hidden' : ''}>${acts}</div>${note}` };
  }

  // Deny's note: open (the choices step aside, the field takes the keyboard) or put away (back to the choices).
  function setNote(root, open, focus = true) {
    const note = root.querySelector('.dec-note'); if (!note) return;
    note.hidden = !open;
    for (const b of root.querySelectorAll('[data-p="allow"], [data-p="always"], [data-p="deny"]')) b.hidden = open;
    const row = root.querySelector('.dec-b'); if (row) row.hidden = open;
    const deny = root.querySelector('[data-p="deny"]'); if (deny) deny.setAttribute('aria-expanded', String(open));
    remember(root.dataset.decKey, root.dataset.dec, { note: open });
    if (focus) (open ? note.querySelector('.dec-why') : deny)?.focus({ preventScroll: true });
  }
  function busy(root, on) {
    root._decBusy = on;
    for (const el of root.querySelectorAll('[data-p], fieldset.q input')) el.disabled = on;
  }
  function answersOf(root) {
    const answers = {};
    for (const fs of root.querySelectorAll('fieldset.q')) {
      const picked = [...fs.querySelectorAll('input:checked')].map(i => (i.value === 'other' ? (fs.querySelector('.other-t').value.trim() || 'Other') : i.dataset.label));
      if (!picked.length) return { missing: fs.dataset.q };
      answers[fs.dataset.q] = picked.join(', ');
    }
    return { answers };
  }
  function pick(root, fs) {
    const st = uiOf(root.dataset.decKey, root.dataset.dec), vals = [...fs.querySelectorAll('input:checked')].map(i => i.value);
    remember(root.dataset.decKey, root.dataset.dec, { picks: { ...(st.picks || {}), [fs.dataset.qi]: fs.querySelector('input[type="checkbox"]') ? vals : vals[0] } });
  }

  // A press on a decision (or Enter in its note, as 'deny-send'). Answers exactly the request the button was
  // drawn for. hooks: key() (where the answer goes, if the surface works it out itself), done(decision, how),
  // stale() (it was answered somewhere else: catch up).
  async function press(el, hooks = {}, as = null) {
    const root = el.closest('[data-dec]'); if (!root || root._decBusy) return;
    const how = as || el.dataset.p, rid = el.dataset.req || root.dataset.dec;
    const key = (hooks.key && hooks.key()) || root.dataset.decKey;
    let body;
    switch (how) {
      case 'deny': setNote(root, true); return;
      case 'back': setNote(root, false); return;
      case 'allow': case 'always': body = { decision: how }; break;
      case 'deny-send': body = { decision: 'deny', message: ((root.querySelector('.dec-why') || {}).value || '').trim() }; break;
      case 'skip': body = { decision: 'deny', message: SKIPPED }; break;
      case 'answer': {
        const a = answersOf(root);
        if (a.missing !== undefined) { toast(`Pick an answer for “${a.missing}”.`); return; }
        body = { decision: 'allow', answers: a.answers };
        break;
      }
      default: return;   // the note field itself, clicked into
    }
    busy(root, true);
    try {
      await api('/api/chat/permission', { key, requestId: rid, ...body });
    } catch (err) {
      busy(root, false);
      if (err.message === 'Reloading…') return;
      if (err.reason === 'answered') {
        done(root, key, rid);
        toast(STALE, 6000);
        if (hooks.stale) hooks.stale();
        return;
      }
      // Nothing changed on the PC: the buttons work again, and it says why.
      toast(`Couldn’t answer it: ${err.message}`, 9000, null, { tone: 'error' });
      if (el.isConnected && !el.hidden && !root.contains(document.activeElement)) el.focus({ preventScroll: true });
      return;
    }
    done(root, key, rid);
    if (hooks.done) hooks.done(body.decision, how);
  }
  // A request that's settled (answered here or elsewhere): nothing typed or picked for it is kept, so the card can
  // move on to the next one.
  function done(root, key, rid) {
    forget(key, rid);
    for (const f of root.querySelectorAll('.dec-why, .other-t')) f.value = '';
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }
  // Keys in a decision's note: Enter sends the denial (empty is fine), Esc puts the note away. True if handled.
  function key(e, hooks) {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches('[data-dec] .dec-why')) return false;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); press(t, hooks, 'deny-send'); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNote(t.closest('[data-dec]'), false); return true; }
    return false;
  }
  // A new request takes the keyboard only when nothing else has it: never while you're typing (the message box,
  // a quick reply, any field), on a button you've moved to, in a menu, or in the other chat of a split view.
  function mayTakeFocus() {
    const free = a => !a || a === document.body || a === document.documentElement;
    if (!free(document.activeElement)) return false;
    try {
      if (window.top !== window) {
        const a = window.top.document.activeElement;
        if (a && a.tagName === 'IFRAME' ? a.contentWindow !== window : !free(a)) return false;
      }
    } catch { /* a frame of another page: leave the keyboard where it is */ }
    return true;
  }

  // What you type and pick on a card is kept, so it survives the card being drawn again.
  document.addEventListener('input', e => {
    const t = e.target, root = t instanceof Element && t.closest('[data-dec]');
    if (!root) return;
    if (t.matches('.dec-why')) remember(root.dataset.decKey, root.dataset.dec, { text: t.value });
    else if (t.matches('.other-t')) {
      const fs = t.closest('fieldset.q'), st = uiOf(root.dataset.decKey, root.dataset.dec);
      remember(root.dataset.decKey, root.dataset.dec, { other: { ...(st.other || {}), [fs.dataset.qi]: t.value } });
      // Typing your own answer picks "Other".
      const r = fs.querySelector('input[value="other"]');
      if (r && !r.checked && t.value.trim()) { r.checked = true; pick(root, fs); }
    }
  });
  document.addEventListener('change', e => {
    const t = e.target, fs = t instanceof Element && t.matches('fieldset.q input') ? t.closest('fieldset.q') : null, root = fs && fs.closest('[data-dec]');
    if (root) pick(root, fs);
  });

  return { shape, parts, press, key, verb, simple, mayTakeFocus, setNote, who: provider => WHO[provider || 'claude'] || 'It' };
})();
