'use strict';
/* Who does it, and on what: the one picker for starting work. New chat, Your work, a pull request's actions, Queue a
   task, Race and Split, Routines and "Do this later" all offer the same choices, in the same order and words:
   - who: Claude as each of your accounts (or whichever has the most room, when that's known for two or more; for
     queued work, always, decided as it starts), Codex as each of its accounts, Gemini;
   - on what: as last time, a preset (Quick, Balanced, Deep, Max: the same ones as a chat's own model picker), or any
     model the assistant has, with its effort.
   A chat's own model picker (the model chip in the message box, Ctrl+K → Switch model…, /model, /effort) stays as it
   is: this is for work that hasn't started yet. */

const Who = (() => {
  /* ---------- the assistants' models (asked of each CLI by the server, which keeps them a while) ---------- */
  let models = null, loading = null;
  function loadModels(fresh = false) {
    if (models && !fresh) return Promise.resolve(models);
    if (!loading) {
      loading = api(`/api/work/models${fresh ? '?fresh=1' : ''}`)
        .then(m => { models = m && typeof m === 'object' ? m : {}; return models; })
        .catch(() => { models = models || {}; return models; })
        .finally(() => { loading = null; });
    }
    return loading;
  }
  const listOf = prov => (models && models[prov]) || null;
  const nameOf = prov => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }[prov] || prov);

  /* ---------- who ---------- */
  // The account with the most left, among those that can start, when that's known for two or more.
  function roomiest(prov = 'claude') {
    const pool = prov === 'codex' ? codexAccts().filter(x => x.signedIn).map(x => ({ id: x.id, name: x.name || 'Codex' })) : (S.accounts || []).filter(canLaunch).map(a => ({ id: a.id, name: a.name }));
    const known = pool.map(a => ({ a, b: binding(usageOf(a.id)) })).filter(x => x.b && typeof x.b.left === 'number');
    if (known.length < 2) return null;
    const best = known.sort((x, y) => y.b.left - x.b.left)[0];
    return { id: best.a.id, name: best.a.name, left: best.b.left };
  }
  // "Whichever has the most room", saying who that is now when it's known. Work that starts later (later) has it
  // decided as it starts, and says so.
  const roomOpt = (prov, room, later, ok = true, why = '') => {
    const short = `Whichever has the most room${later ? ' when it starts' : ''}${room ? ` (now ${room.name}, ${room.left}% left)` : ''}`;
    return { value: `${prov}:room`, provider: prov, account: 'room', label: `${nameOf(prov)} · ${short[0].toLowerCase()}${short.slice(1)}`, short, ok, why };
  };
  // Every one who could start work here, signed in or not (those that can't say why). Each:
  // { value, provider, account, label, short, ok, why }. value is 'claude:<account>', 'claude:room', 'codex:<account>',
  // 'codex:room' or 'gemini'; short is the label without the assistant's name. auto: offer "most room". providers:
  // which assistants this place can use. later: the work waits to start (a queued task), so "most room" is on offer
  // even before usage is known (with nobody signed in yet, Claude's waits for a sign-in).
  function options({ auto = true, providers = ['claude', 'codex', 'gemini'], later = false } = {}) {
    const out = [];
    if (providers.includes('claude')) {
      const room = auto ? roomiest() : null;
      if (room || (auto && later)) out.push(roomOpt('claude', room, later));
      for (const a of S.accounts || []) {
        const ok = canLaunch(a), use = usageLine(a.id, { short: true }), short = `${a.name}${use ? ` · ${use}` : ''}`;
        out.push({ value: `claude:${a.id}`, provider: 'claude', account: a.id, label: `Claude · ${short}`, short, ok, why: ok ? '' : a.lockMessage || 'Not signed in' });
      }
    }
    if (providers.includes('codex') && S.codex && S.codex.enabled) {
      const all = codexAccts(), room = auto && all.length > 1 ? roomiest('codex') : null;
      const any = S.codex.installed !== false && all.some(x => x.signedIn);
      if (room || (auto && later && all.length > 1)) out.push(roomOpt('codex', room, later, any, any ? '' : 'Sign in to Codex first'));
      for (const x of all) {
        const ok = S.codex.installed !== false && !!x.signedIn, use = usageLine(x.id, { short: true }), short = `${x.name || 'Codex'}${use ? ` · ${use}` : ''}`;
        out.push({ value: `codex:${x.id}`, provider: 'codex', account: x.id, label: all.length > 1 ? `Codex · ${short}` : 'Codex', short, ok, why: ok ? '' : S.codex.installed === false ? 'Install Codex first (Setup → Assistants)' : 'Sign in to Codex first' });
      }
    }
    if (providers.includes('gemini') && S.gemini && S.gemini.enabled) {
      const ok = geminiReady();
      out.push({ value: 'gemini', provider: 'gemini', account: 'gemini', label: 'Gemini', short: 'Gemini', ok, why: ok ? '' : S.gemini.installed === false ? 'Install the Antigravity CLI first (Setup → Assistants)' : 'Sign in to Gemini first (Setup → Assistants)' });
    }
    return out;
  }
  const parse = value => {
    const v = String(value || '');
    if (v === 'gemini') return { provider: 'gemini', account: 'gemini' };
    const i = v.indexOf(':');
    return i < 0 ? { provider: v || 'claude', account: null } : { provider: v.slice(0, i), account: v.slice(i + 1) };
  };
  // The account to start as, worked out now ("most room" means most room at this moment).
  function accountFor(value) {
    const w = parse(value);
    if (w.account === 'room') { const r = roomiest(w.provider); return r ? r.id : w.provider === 'codex' ? (S.codex && S.codex.id) || null : (current() && current().id) || null; }
    return w.account;
  }
  // Who to start with when only the assistant is known (a saved prompt's, the reply's): whichever of its accounts has
  // the most room, if that's on offer, else the one in use, else the first that can start; null if none of them can.
  // opts: as for options().
  function pickFor(prov, opts = {}) {
    const mine = options(opts).filter(o => o.provider === prov && o.ok);
    const inUse = prov === 'codex' ? S.codex && S.codex.id : prov === 'claude' ? S.acct : prov;
    return (mine.find(o => o.account === 'room') || mine.find(o => o.account === inUse) || mine[0] || {}).value || null;
  }

  /* ---------- on what ---------- */
  // A preset as one of this assistant's models (the same choice a chat's own picker makes), or null when the list
  // isn't known yet.
  function preset(prov, id) {
    const L = listOf(prov), p = (typeof PRESETS === 'object' && PRESETS[prov] || []).find(x => x.id === id);
    if (!L || !p || !L.models || !L.models.length) return null;
    let m = null;
    for (const w of p.want) {
      m = w === '@default' ? L.models.find(x => x.label === L.defaultModel) || L.models[0]
        : w instanceof RegExp ? L.models.find(x => w.test(x.value)) : L.models.find(x => x.value === w);
      if (m) break;
    }
    if (!m) return null;
    const efforts = m.efforts && m.efforts.length ? m.efforts : L.efforts || [];
    let effort = efforts.includes(p.effort) ? p.effort : null;
    if (!effort && efforts.length && typeof EFFORT_ORDER !== 'undefined') {
      const want = EFFORT_ORDER.indexOf(p.effort);
      effort = efforts.slice().sort((a, b) => Math.abs(EFFORT_ORDER.indexOf(a) - want) - Math.abs(EFFORT_ORDER.indexOf(b) - want))[0];
    }
    return { model: m.value, label: m.label, effort };
  }
  // The choices for an assistant's model: as last time, the presets, then every model it has.
  // Each { value, label, title }; value is '', 'preset:<id>' or a model's own value.
  function modelChoices(prov) {
    const out = [{ value: '', label: 'As last time', title: 'The model and effort this assistant used last here' }];
    for (const p of (typeof PRESETS === 'object' && PRESETS[prov]) || []) {
      const r = preset(prov, p.id);
      out.push({ value: `preset:${p.id}`, label: `${p.name}: ${p.note.toLowerCase()}`, title: r ? `${r.label}${r.effort ? `, ${r.effort} effort` : ''}` : p.note });
    }
    const L = listOf(prov);
    for (const m of (L && L.models) || []) out.push({ value: m.value, label: m.label, title: m.note || m.label });
    return out;
  }
  // The efforts a model offers ('' first: its usual one).
  function effortChoices(prov, model) {
    const L = listOf(prov); if (!L || !model || /^preset:/.test(model)) return [];
    const m = (L.models || []).find(x => x.value === model);
    return (m && m.efforts && m.efforts.length ? m.efforts : L.efforts) || [];
  }
  // What a model choice means at start: { model, effort } (nothing for "as last time"; a preset the list can't place
  // yet comes back as { preset } for the chat to put on once it knows its models).
  function runOf(prov, model, effort) {
    if (!model) return {};
    if (/^preset:/.test(model)) { const id = model.slice(7), r = preset(prov, id); return r ? { model: r.model, ...(r.effort ? { effort: r.effort } : {}) } : { preset: id }; }
    return { model, ...(effort ? { effort } : {}) };
  }

  /* ---------- in a form: who, model and effort, each a <select> ---------- */
  // root: an element to fill. value: { who, model, effort } to start from. Calls onChange after any change. later: the
  // work waits to start (a queued task): "most room" is always offered, and decided as it starts (see read).
  function mount(root, { value = {}, auto = true, providers, model: withModel = true, labels = {}, onChange = null, later = false } = {}) {
    if (!root) return;
    const st = { who: value.who || null, model: value.model || '', effort: value.effort || '', later };
    root._who = st;
    const draw = () => {
      const opts = options({ auto, providers, later });
      if (!opts.some(o => o.value === st.who && o.ok)) { const first = opts.find(o => o.ok); st.who = first ? first.value : (opts[0] || {}).value || null; }
      const prov = parse(st.who).provider, choices = withModel ? modelChoices(prov) : [];
      if (!choices.some(c => c.value === st.model)) st.model = '';
      const efforts = withModel ? effortChoices(prov, st.model) : [];
      if (!efforts.includes(st.effort)) st.effort = '';
      const id = k => `${root.id || 'who'}-${k}`;
      root.innerHTML = `<label class="who-f">${esc(labels.who || 'Who')}<select id="${id('who')}" data-who="who">${opts.map(o => `<option value="${esc(o.value)}"${o.value === st.who ? ' selected' : ''}${o.ok ? '' : ` disabled title="${esc(o.why)}"`}>${esc(o.label)}${o.ok ? '' : ` (${esc(o.why.toLowerCase())})`}</option>`).join('')}</select></label>`
        + (withModel ? `<label class="who-f">${esc(labels.model || 'Model')}<select id="${id('model')}" data-who="model">${choices.map(c => `<option value="${esc(c.value)}"${c.value === st.model ? ' selected' : ''} title="${esc(c.title || '')}">${esc(c.label)}</option>`).join('')}</select></label>` : '')
        + (withModel && efforts.length ? `<label class="who-f">${esc(labels.effort || 'Effort')}<select id="${id('effort')}" data-who="effort"><option value="">Its usual</option>${efforts.map(e => `<option value="${esc(e)}"${e === st.effort ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>` : '');
    };
    root.onchange = e => {
      const k = e.target.dataset && e.target.dataset.who; if (!k) return;
      st[k] = e.target.value;
      if (k === 'who') { st.model = ''; st.effort = ''; }
      if (k === 'model') st.effort = '';
      draw();
      root.querySelector(`[data-who="${k}"]`)?.focus();
      if (onChange) onChange(read(root));
    };
    draw();
    // The models come from the server: redrawn once they're known (what's chosen stays).
    if (withModel && !models) loadModels().then(() => { if (root.isConnected && root._who === st) draw(); });
  }
  // What a mounted picker says: { who, provider, account (resolved at this moment), model, effort, preset }. For work
  // that starts later, "most room" stays account 'auto': the server picks the account as it starts.
  function read(root) {
    const st = root && root._who; if (!st || !st.who) return null;
    const w = parse(st.who);
    return { who: st.who, provider: w.provider, account: st.later && w.account === 'room' ? 'auto' : accountFor(st.who), ...runOf(w.provider, st.model, st.effort) };
  }

  /* ---------- in a menu (showMenu items) ---------- */
  // Who can do it, as menu items. run(provider, account, { fresh }) starts it. modelOf(provider): the words for what
  // it'll run on (shown under each). extra: items for this place to add first (carry on in its chat, say).
  function menuItems(run, { auto = true, providers, modelOf = null, extra = [], hint = 'a new chat' } = {}) {
    const glyph = { claude: '✦', codex: '◆', gemini: '✧' };
    const items = [...extra, ...options({ auto, providers }).filter(o => o.ok).map(o => ({
      glyph: glyph[o.provider] || '•', label: o.label,
      hint: `${hint}${modelOf ? ` · ${modelOf(o.provider)}` : ''}`,
      run: () => run(o.provider, accountFor(o.value), { fresh: true }),
    }))];
    return Object.assign(items, { ifEmpty: typeof NO_WHO !== 'undefined' ? NO_WHO : null });
  }

  return { loadModels, listOf, nameOf, options, parse, accountFor, pickFor, preset, modelChoices, effortChoices, runOf, mount, read, menuItems, roomiest };
})();
window.Who = Who;
