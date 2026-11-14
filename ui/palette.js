'use strict';
/* The command palette (Ctrl+K) and the file viewer. */

/* ---------- command palette ---------- */
// stack: the pages you've gone into (an item with page: () => items opens a list of its own).
const Pal = { items: [], sel: 0, stack: [] };
// Matching, in the spirit of cmdk: the whole title, then its start, a word's start, its initials ("nc"
// is New chat, "phacc" Phone access), anywhere in it, every word of a longer search, the item's other
// words (its alias), and last its letters in order. Each match says which letters of the title to mark.
const PalMatch = (() => {
  const WORDY = /[\p{L}\p{N}]/u, PLAIN = /^[\p{L}\p{N}]+$/u;
  // The title, lower-cased; at(i): could a word start there ("GitHub" has two: Git, Hub; a search that
  // begins with a sign, "#18982", starts wherever a word could). Its words are worked out only if needed.
  function prep(t) {
    const tl = t.toLowerCase(), same = tl.length === t.length;
    const at = i => i === 0 || !WORDY.test(tl[i - 1]) || (same && t[i] !== tl[i] && t[i - 1] === tl[i - 1] && t[i - 1].toUpperCase() !== t[i - 1] && WORDY.test(tl[i]));
    let list = null;
    const words = () => {
      if (list) return list;
      list = [];
      let ws = -1;
      for (let i = 0; i <= tl.length; i++) {
        const w = i < tl.length && WORDY.test(tl[i]);
        if (w && ws >= 0 && at(i)) { list.push([ws, i]); ws = i; } else if (w && ws < 0) ws = i; else if (!w && ws >= 0) { list.push([ws, i]); ws = -1; }
      }
      return list;
    };
    return { t, tl, at, words };
  }
  const inOrder = (tl, q, from = 0) => { let p = from; for (const c of q) { p = tl.indexOf(c, p); if (p < 0) return false; p++; } return true; };
  // Each piece of the search is the start of a word, in order, skipping as few words as it can.
  function initials(P, q) {
    const { tl } = P, words = P.words(), W = words.length, memo = new Map();
    if (W < 2) return null;
    const go = (qi, wi) => {
      if (qi === q.length) return { hl: [], skips: 0 };
      const k = qi * 4096 + wi;
      if (memo.has(k)) return memo.get(k);
      let best = null;
      for (let w = wi; w < W && (!best || w - wi < best.skips); w++) {
        const [ws, we] = words[w];
        let n = 0;
        while (qi + n < q.length && ws + n < we && q[qi + n] === tl[ws + n]) n++;
        for (let len = n; len >= 1; len--) {
          const r = go(qi + len, w + 1);
          if (r) { const c = { hl: [[ws, ws + len], ...r.hl], skips: r.skips + (w - wi) }; if (!best || c.skips < best.skips) best = c; break; }
        }
      }
      memo.set(k, best);
      return best;
    };
    const r = go(0, 0);
    return r && r.hl.length > 1 ? r : null;
  }
  // The letters in order, preferring the starts of words and letters side by side; strewn too far apart doesn't count.
  function letters(P, q) {
    const { tl, at } = P, hl = [];
    let pos = 0, prev = -2, s = 300;
    for (let qi = 0; qi < q.length; qi++) {
      let j = tl.indexOf(q[qi], pos);
      if (j < 0) return null;
      if (j !== prev + 1 && !at(j)) for (let b = tl.indexOf(q[qi], j + 1); b >= 0; b = tl.indexOf(q[qi], b + 1)) if (at(b)) { if (inOrder(tl, q.slice(qi + 1), b + 1)) j = b; break; }
      if (prev < 0) s -= Math.min(30, j);
      else if (j === prev + 1) s += 6;
      else s -= (j - prev - 1) * 2;
      if (at(j)) s += 8;
      if (j === prev + 1 && hl.length) hl[hl.length - 1][1] = j + 1; else hl.push([j, j + 1]);
      prev = j; pos = j + 1;
    }
    return s >= 200 ? { s: Math.min(390, s), hl } : null;
  }
  // q: lower-cased, trimmed, single spaces. → { s, hl } (hl: [start, end) pieces of x.t), or null.
  function item(x, q) {
    const P = prep(String(x.t || '')), { tl, at } = P;
    const text = String(x.text || x.t || '').toLowerCase();
    if (tl === q) return { s: 1200, hl: [[0, q.length]] };
    if (tl.startsWith(q)) return { s: 900 - Math.min(40, tl.length - q.length) / 4, hl: [[0, q.length]] };
    let mid = -1;
    for (let i = tl.indexOf(q); i >= 0; i = tl.indexOf(q, i + 1)) { if (at(i)) return { s: 800 - Math.min(40, i) / 2, hl: [[i, i + q.length]] }; if (mid < 0) mid = i; }
    const flat = q.replace(/ /g, ''), seq = flat.length > 1 && inOrder(tl, flat);
    const ac = seq && PLAIN.test(flat) ? initials(P, flat) : null;
    if (ac) return { s: 700 - ac.skips * 6 - ac.hl.length, hl: ac.hl };
    if (mid >= 0) return { s: 600 - Math.min(40, mid) / 2, hl: [[mid, mid + q.length]] };
    const terms = q.split(' ');
    if (terms.length > 1) {
      let s = 0, all = true;
      const hl = [];
      for (const term of terms) {
        let j = -1, start = false;
        for (let i = tl.indexOf(term); i >= 0; i = tl.indexOf(term, i + 1)) { if (at(i)) { j = i; start = true; break; } if (j < 0) j = i; }
        if (j >= 0) { hl.push([j, j + term.length]); s += start ? 6 : 2; continue; }
        all = false;
        const k = text.indexOf(term);
        if (k < 0) { s = -1; break; }
        if (k === 0 || !WORDY.test(text[k - 1])) s += 3;
      }
      if (s >= 0) return { s: (all ? 500 : 400) + Math.min(40, s), hl };
    } else {
      // Its other words: "btw" for Ask a side question, "mcp" for Rules and tools. Inside one of them
      // ("nc" in preferences) counts for little.
      let best = -1;
      for (let k = text.indexOf(q); k >= 0; k = text.indexOf(q, k + 1)) {
        const start = k === 0 || !WORDY.test(text[k - 1]), whole = start && !WORDY.test(text[k + q.length] || ' ');
        best = Math.max(best, whole ? 445 : start ? 430 : 210);
        if (best === 445) break;
      }
      if (best >= 0) return { s: best, hl: [] };
    }
    return seq ? letters(P, flat) : null;
  }
  // The title with its matched letters marked; escaped. A title that changes length when lower-cased isn't marked.
  function mark(t, hl) {
    t = String(t || '');
    if (!hl || !hl.length || t.toLowerCase().length !== t.length) return esc(t);
    const on = new Uint8Array(t.length);
    for (const [a, b] of hl) on.fill(1, Math.max(0, a), Math.min(t.length, b));
    let out = '';
    for (let i = 0; i < t.length;) {
      let j = i;
      while (j < t.length && on[j] === on[i]) j++;
      out += on[i] ? `<mark class="pal-hit">${esc(t.slice(i, j))}</mark>` : esc(t.slice(i, j));
      i = j;
    }
    return out;
  }
  return { item, mark };
})();
// What you pick often, and lately, comes first among matches: a decaying count per item, kept for the
// 80 used most. Keyed by an item's id, else its title.
const PalFrec = (() => {
  const KEY = 'palette-frecency', CAP = 80, HALF = 14 * 864e5;
  let all = null;
  const bare = o => Object.assign(Object.create(null), o);   // a title like "constructor" is just a key
  const load = () => { if (!all) { try { all = bare(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { all = bare({}); } } return all; };
  const weight = (e, now) => (e && e.n > 0 ? e.n * Math.pow(0.5, Math.max(0, now - e.t) / HALF) : 0);
  function boost(id) {
    const w = weight(load()[id], Date.now());
    return w > 0 ? Math.min(120, Math.round(Math.log2(1 + w) * 40)) : 0;
  }
  function note(id) {
    if (!id) return;
    const m = load(), now = Date.now();
    m[id] = { n: weight(m[id], now) + 1, t: now };
    const keep = Object.entries(m).map(([k, e]) => [k, weight(e, now)]).filter(([, w]) => w >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, CAP);
    all = bare(Object.fromEntries(keep.map(([k]) => [k, m[k]])));
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full or blocked: it just doesn't remember */ }
  }
  return { boost, note };
})();
const palId = x => x.id || x.t;
// Ranked best first; ties keep the order they came in. Each comes back with its marks (hl).
function palRank(list, q) {
  const ql = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!ql) return list.slice();
  const out = [];
  list.forEach((x, i) => { const m = PalMatch.item(x, ql); if (m) out.push({ x: { ...x, hl: m.hl }, s: m.s + (x.frec === false ? 0 : PalFrec.boost(palId(x))), i }); });
  return out.sort((a, b) => b.s - a.s || a.i - b.i).map(r => Object.assign(r.x, { score: r.s }));
}
// The project an action is about: the open chat's, else the project page you're on.
const paletteHere = () => (window.ChatUI && ChatUI.isOpen() && C.info && C.info.cwd) || (S.view === 'folder' ? S.folder : null);
// Setup, at one of its sections.
async function openSetupAt(id) { await openSetup(); setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 300); }
// Plain words for an action: "codex chat in starfall to make the icons", "queue the patch notes in
// starfall tonight", "race fixing the save bug in starfall". Each opens ready to go; nothing is sent.
function projectNamed(words) {
  const w = String(words || '').trim().toLowerCase().replace(/^the\s+/, '');
  if (!w) return null;
  const ps = S.projects.filter(p => p.exists);
  return ps.find(p => p.name.toLowerCase() === w) || ps.find(p => p.name.toLowerCase().startsWith(w)) || ps.find(p => p.name.toLowerCase().includes(w)) || null;
}
function sayItems(q) {
  const t = String(q || '').trim(), out = [];
  let m;
  if ((m = t.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,8})(?:[/?#].*)?$/i))) {
    out.push({ glyph: '⇄', t: `Open pull request #${m[2]}`, s: m[1] + ' · checks, feedback, and actions', run: () => openWorkPr(t) });
    out.push({ glyph: '↗', t: `Cross-model review #${m[2]}`, s: 'Claude reviews; Codex weighs the findings', run: () => openCrossReview({ url: t }) });
  }
  if (/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/i.test(t)) out.push({ glyph: '◌', t: `Open Linear issue ${t.toUpperCase()}`, s: 'Read the issue, plan it, or start work', run: async () => { await go('work'); await Work.openIssue(t.toUpperCase()); } });
  if ((m = t.match(/^(?:start\s+|new\s+|open\s+)?(?:an?\s+)?(claude|codex|gemini)?\s*chat\s+(?:in|for|on)\s+(.+?)(?:\s*(?::|\bto\b|\babout\b|\bthat\b|\bwhich\b)\s+(.+))?$/i))) {
    const p = projectNamed(m[2]), prov = (m[1] || 'claude').toLowerCase();
    const ready = prov === 'claude' ? canLaunch(current()) : prov === 'gemini' ? geminiReady() : codexReady();
    if (p && ready) out.push({ glyph: prov === 'codex' ? '◆' : prov === 'gemini' ? '✷' : '✦', t: `Start a ${PROV_NAME[prov]} chat in ${p.name}${m[3] ? `: ${m[3]}` : ''}`, s: m[3] ? 'it waits in the message box for you to send' : '', run: () => ChatUI.open({ cwd: p.cwd, mode: 'new', provider: prov === 'claude' ? undefined : prov, initialText: m[3] || '' }) });
  }
  if ((m = t.match(/^(?:queue|later|do later)\s+(.+?)\s+(?:in|for)\s+(.+?)(?:\s+(tonight|tomorrow(?:\s+morning)?|now|when there'?s room))?$/i))) {
    const p = projectNamed(m[2]);
    if (p) out.push({ glyph: '⏳', t: `Queue in ${p.name}: ${m[1]}${m[3] ? ` (${m[3]})` : ''}`, s: 'opens the task, ready to queue', run: () => { openTaskDialog(p.cwd, m[1]); const w = (m[3] || '').toLowerCase(); if (/tonight|tomorrow/.test(w)) { $('tkWhen').value = 'at'; $('tkAtWrap').hidden = $('tkRepWrap').hidden = false; const d = new Date(laterAt(/tonight/.test(w) ? 'tonight' : 'morning')); $('tkAt').value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } } });
  }
  if ((m = t.match(/^(race|split)\s+(.+?)\s+(?:in|for)\s+(.+)$/i))) {
    const p = projectNamed(m[3]), split = m[1].toLowerCase() === 'split';
    if (p && racePairs().length) out.push({ glyph: split ? '⑂' : '⚑', t: `${split ? 'Split' : 'Race'} in ${p.name}: ${m[2]}`, s: split ? 'each takes a part' : 'two of them, the same task', run: () => { openRaceDialog(p.cwd, split ? 'split' : 'race'); $('rcText').value = m[2]; } });
  }
  // Phrases are one-offs: they don't count toward what you use most.
  return out.map(x => ({ ...x, frec: false }));
}
function palItems(q) {
  const out = [];
  const add = (g, list) => { if (list.length) out.push({ g }, ...list); };
  const workActs = typeof Work !== 'undefined' ? Work.commands() : [];
  const run = S.activity.filter(x => !x.parentKey).map(x => ({ glyph: NEEDS.has(statusOf(x)) || statusOf(x) === 'reply' ? '✦' : '◉', t: x.title || 'New chat', s: `${{ approve: 'needs your OK', question: 'has a question', 'terminal-wait': 'waiting in its terminal', reply: 'your turn', working: 'at work', quiet: 'open', ended: 'stopped' }[statusOf(x)]}${x.folder ? ` · ${x.folder}` : ''}`, run: () => openActivity(x), text: `${x.title} ${x.folder}` }));
  const acts = [
    { glyph: '+', t: 'New chat', s: 'in any project, with any of them', run: () => openNewChat(), alias: 'start chat new claude codex gemini' },
    { glyph: '◈', t: 'Phone access', s: 'pair a phone, notifications', run: () => openSetupAt('st-phone'), alias: 'phone android iphone pair mobile notifications tailscale' },
    { glyph: '◈', t: 'Alerts and quiet hours', s: 'chimes, notifications, when to keep quiet', run: () => openSetupAt('st-alerts'), alias: 'alerts quiet hours notifications chime sound mute' },
    { glyph: '◐', t: 'Text and interface size', run: () => openSetup('look'), alias: 'text size zoom bigger smaller interface scale' },
    { glyph: '❖', t: 'Theme Studio', s: 'a world of your own, painted with Codex', run: () => { const x = document.createElement('button'); x.setAttribute('data-studio-open', ''); x.hidden = true; document.body.appendChild(x); x.click(); x.remove(); }, alias: 'theme studio world paint custom' },
    { glyph: '❡', t: 'Edit prompts', run: () => openPromptEditor(), alias: 'prompts saved slash templates' },
    { glyph: '✦', t: 'Go to the hub', run: () => go('hub') },
    { glyph: '✧', t: 'Recent chats', run: () => go('recent') },
    ...(Shell.canCollapse() ? [{ glyph: '◫', t: document.body.classList.contains('nav-collapsed') ? 'Show sidebar' : 'Hide sidebar', s: 'more room for your current work', run: () => Shell.toggle(), alias: 'focus sidebar collapse expand navigation' }] : []),
    { glyph: '⟳', t: 'Routines', s: 'chats that start on a schedule or when something new turns up', run: () => go('routines'), alias: 'schedule watch automation cron' },
    { glyph: '⚙', t: 'Setup and health', run: openSetup, alias: 'settings options preferences config health' },
    { glyph: '✧', t: 'Take the tour', s: 'a minute on what’s where', run: () => startTour(), alias: 'tour help guide intro getting started' },
    { glyph: '⚑', t: 'Race', s: 'two of Claude, Codex and Gemini, the same task in two copies of a project; keep the better one', run: () => openRaceDialog(paletteHere()), alias: 'race compete compare both versus head to head claude codex gemini' },
    ...(aideOn() ? [{ glyph: '◈', t: 'Open Companion', s: 'your quick questions, by game', run: () => go('aide') }, { glyph: '◈', t: 'Ask Companion something new', s: 'a new question', run: () => aideNew() }] : [{ glyph: '◈', t: 'Turn on Companion', s: 'a quick helper over games and anything else', run: () => openSetup() }]),
    ...(window.ChatUI && ChatUI.isOpen() && C.info && C.info.cwd ? [{ glyph: '▶', t: 'Run the project', s: 'its dev server or start script, with its output, beside the chat', run: () => openRun(), alias: 'run start dev server preview serve launch' }] : []),
    { glyph: '⑂', t: 'Split the work', s: 'two of them each take a part, in their own copies; keep both', run: () => openRaceDialog(paletteHere(), 'split'), alias: 'split divide parallel share both halves worktree' },
    { glyph: '⏳', t: 'Queue a task', s: 'starts as a new chat when an account has room, or at a time', run: () => openTaskDialog(paletteHere()), alias: 'queue later schedule task when limit resets' },
    { glyph: '§', t: 'Rules and tools', s: 'CLAUDE.md, AGENTS.md and MCP servers, one set for all of them', run: () => openRules(paletteHere()), alias: 'claude.md agents.md mcp servers tools rules instructions memory' },
    { glyph: '⋔', t: 'Subagents', s: 'The model and effort of the helpers Claude starts, and your own named ones', run: () => openSubagents(), alias: 'subagent agents agent model effort reasoning haiku sonnet opus fable scout reviewer delegate helpers task' },
    { glyph: '⚿', t: 'Connections', s: 'GitHub, and tools like Latitude’s, for every Claude and Codex account', run: () => openConnections(paletteHere()), alias: 'mcp sign in login oauth authenticate connect latitude tools accounts github gh' },
    { glyph: '⇄', t: 'Your work', s: 'your Linear issues and pull requests, from to do to merged, with what’s next for each', run: () => go('work'), alias: 'work board dashboard linear issues assigned tickets pr prs pull requests kanban todo' },
    { glyph: '⇄', t: 'Pull requests', s: 'yours, to review and assigned to you; review or fix one with Claude or Codex', run: () => openPrs(), alias: 'pr prs pull request github review fix comments checks ci assigned' },
    { glyph: '⇄', t: 'Cross-model PR review', s: 'Claude reviews, Codex weighs the findings and makes useful fixes', run: () => openCrossReview(), alias: 'cross-model-pr-review cross review claude fable opus codex skill' },
    { glyph: '↗', t: 'Open a pull request by URL', s: 'inspect any PR in your workspace', run: () => openWorkPr(), alias: 'github pr link url paste' },
    ...workActs,
    ...(window.ChatUI && ChatUI.isOpen() && !C.watch && C.state !== 'ended' && (C.provider === 'claude' || C.provider === 'codex') ? [{ glyph: '⇄', t: 'Make a pull request from this chat', s: 'its work on a branch, pushed, the PR opened the way the repo asks', run: () => makePrFromChat('main'), alias: 'pr pull request push branch open create' }] : []),
    { glyph: '◐', t: 'Appearance', s: 'themes, fonts, light or dark, text and interface size', run: () => openSetup('look'), alias: 'font fonts typeface' },
    { glyph: '?', t: 'Keyboard shortcuts', run: () => openShortcuts(), alias: 'keys hotkeys help' },
    ...(miniOK() && !window.REMOTE ? [{ glyph: '◰', t: 'Open the mini window', s: 'what needs you, floating over other apps', run: () => openMini(), alias: 'mini picture in picture float pip always on top small status' }] : []),
    { glyph: '◐', t: Look.isLight() ? 'Switch to dark mode' : 'Switch to light mode', run: () => Look.set({ mode: Look.isLight() ? 'dark' : 'light' }) },
    { glyph: '◉', t: 'Change theme…', s: `now ${Look.theme().name}`, alias: 'theme themes colors colours look skin', page: themePage, pageTitle: 'Themes', placeholder: 'Find a theme…' },
    ...Look.THEMES.filter(t => t.id !== Look.theme().id).map(t => ({ id: `theme:${t.id}`, glyph: '◉', t: `Theme: ${t.name}`, s: t.note, run: () => Look.set({ theme: t.id }) })),
    ...Look.FONT_SETS.filter(f => f.id !== Look.get().fontSet).map(f => ({ glyph: '¶', t: `Fonts: ${f.name}`, s: [...new Set([f.head, f.body, f.code])].map(id => Look.FAMILIES.find(x => x.id === id).name).join(' · '), run: () => Look.set({ fontSet: f.id, fBody: '', fHead: '', fCode: '' }), alias: 'font set typeface lettering' })),
    { glyph: '§', t: 'Fonts and licences', s: 'every bundled font and its licence', run: () => fontCredits(), alias: 'font license licence credits attribution ofl' },
    { glyph: '◈', t: 'Check usage for every account', run: () => refreshUsage() },
    ...(S.accounts.length > 1 ? [{ glyph: '◆', t: 'Switch account…', s: `new chats open as ${current().name}`, alias: 'account accounts work as use claude plan usage left', page: accountPage, pageTitle: 'Accounts', placeholder: 'Find an account…' }] : []),
    ...S.accounts.filter(a => a.id !== S.acct).map(a => ({ id: `acct:${a.id}`, glyph: '◆', t: `Work as ${a.name}`, s: usageLine(a.id, { short: true }), run: () => useAccount(a.id) })),
    ...S.accounts.map(a => ({ glyph: '❖', t: `Open claude.ai as ${a.name}`, s: 'regular Claude chats', run: () => openWeb(a.id) })),
    ...(S.codex && S.codex.enabled ? (S.codex.signedIn ? [{ glyph: '❖', t: 'Open chatgpt.com', s: 'regular ChatGPT', run: () => openWeb(S.codex.id) }, { glyph: '◈', t: 'Check Codex usage', run: () => refreshUsage(S.codex.id) }] : [{ glyph: '✥', t: 'Sign in to Codex with ChatGPT', run: codexSignIn }]) : []),
    { glyph: '✥', t: 'New project', s: 'make a folder and start a chat', run: () => openNewProject() },
    { glyph: '✥', t: 'Add an account', run: addAccount, alias: 'sign in login' },
    { glyph: '❝', t: 'Message several chats…', s: 'the same message to each', run: () => openManyDialog(), alias: 'all everyone broadcast send crew sync' },
    ...(window.ChatUI && ChatUI.isOpen() && typeof C !== 'undefined' && C.key && C.sessionId && !C.watch && !isCommander(C.sessionId) ? [{ glyph: '⟳', t: 'Keep this chat working until…', s: 'told to carry on when it goes quiet', run: () => openKeepDialog(), alias: 'overnight long job continue autopilot nudge until' }] : []),
    { glyph: '■', t: 'Stop what every chat is doing', run: stopEverything, alias: 'stop all interrupt pause everything' },
    { glyph: '⟳', t: 'Keep every open chat working until…', s: 'each told to carry on when it goes quiet', run: () => openKeepDialog({ keys: manyChats().map(x => x.key) }), alias: 'overnight all everyone long job autopilot nudge' },
    ...(window.REMOTE ? [] : [{ glyph: '↻', t: 'Restart Session Switcher', s: S.update ? 'a new version is ready' : 'your chats come back where they were', run: restartApp, alias: 'reboot relaunch reload update' }, { glyph: '⏻', t: 'Quit Session Switcher', run: quitApp, alias: 'exit close stop app' }]),
  ].map(x => ({ ...x, text: `${x.t} ${x.alias || ''}` }));
  const claudeNew = canLaunch(current()) ? S.projects.filter(p => p.exists).map(p => ({ glyph: '✦', t: `New Claude chat in ${p.name}`, s: `as ${current().name}`, run: () => ChatUI.open({ cwd: p.cwd, mode: 'new' }), text: `new chat claude ${p.name}` })) : [];
  const pinItems = S.projects.map(p => ({ glyph: '★', t: `${S.pins.has(p.cwd) ? 'Unpin' : 'Pin'} ${p.name}`, s: 'in the sidebar', run: () => togglePin(p.cwd), text: `pin unpin favorite ${p.name}` }));
  const folders = S.projects.map(p => ({ id: `project:${p.cwd}`, glyph: glyphFor(p.name), t: p.name, s: `${plural(p.sessions.length, 'chat')}${S.projects.filter(x => x.name === p.name).length > 1 && parentName(p.cwd) ? ` · in ${parentName(p.cwd)}` : ''}`, run: () => go('folder', p.cwd), text: `${p.name} ${p.cwd}` }));
  const boards = S.projects.filter(p => p.exists).map(p => ({ glyph: '▦', t: `Review pictures in ${p.name}`, s: 'keep or redo, folder by folder', run: () => openBoard(p.cwd), text: `review pictures images gallery board keep redo ${p.name}` }));
  const chats = allSessions().sort((x, y) => y[0].updated - x[0].updated).map(([s, p]) => ({ id: `chat:${s.id}`, glyph: '❝', t: s.title, s: `${p.name} · ${agoL(s.updated)}`, run: () => (liveOf(s.id) ? ChatUI.open({ sessionId: s.id }) : isRunning(s.id) ? ChatUI.watch({ sessionId: s.id, source: 'terminal' }) : inApp() ? ChatUI.open({ sessionId: s.id }) : openDrawer(s.id)), text: `${s.title} ${p.name} ${s.firstPrompt || ''}` }));
  const cxNew = codexReady() ? S.projects.filter(p => p.exists).map(p => ({ glyph: '✥', t: `New Codex chat in ${p.name}`, s: 'Codex', run: () => ChatUI.open({ cwd: p.cwd, mode: 'new', provider: 'codex' }), text: `codex new ${p.name}` })) : [];
  // Prompts, in the project you're looking at first, then in every project.
  const here = S.view === 'folder' ? S.projects.find(p => p.cwd === S.folder) : null;
  const worldsFor = here ? [here, ...S.projects.filter(p => p !== here)] : S.projects;
  const prompts = worldsFor.filter(p => p.exists).flatMap(p => S.prompts.map(pr => ({ glyph: '❡', t: `${pr.title} in ${p.name}`, s: PROV_NAME[pr.provider] && pr.provider !== 'claude' ? PROV_NAME[pr.provider] : 'prompt', run: () => startWithPrompt(p.cwd, pr), text: `${pr.title} ${p.name} prompt start` })));
  const docs = Object.values(S.worlds).flatMap(w => { const p = S.projects.find(x => x.cwd === w.cwd); return p ? w.docs.slice(0, 60).map(d => ({ id: `doc:${d.path}`, glyph: '❧', t: d.name, s: `${p.name} · ${agoL(d.mtime)}`, run: () => Viewer.open({ path: d.path, cwd: p.cwd }), text: `${d.rel} ${p.name}` })) : []; });
  const models = window.ChatUI && ChatUI.modelItems ? ChatUI.modelItems() : [];
  // The chat's models and efforts, also as a list of their own.
  const modelPicks = models.filter(x => /^(model switch|effort) /.test(x.text || ''));
  const modelPage = modelPicks.length ? [{ glyph: '✦', t: 'Switch model…', s: 'the model and effort for this chat', text: 'switch model models effort change this chat', page: () => modelPicks, pageTitle: 'Model', placeholder: 'Find a model or effort…' }] : [];
  // The chat you're in: find, export, pin.
  const inChat = window.ChatUI && ChatUI.isOpen();
  const sid = inChat && ChatUI.sessionId ? ChatUI.sessionId() : null;
  // Everything the chat's ⋯ menu has (find, export, pin, side question, mark done, stop…), searchable.
  const chatActs = inChat ? chatHeadItems().filter(it => it !== '-' && !it.disabled && it.label).map(it => ({
    glyph: it.glyph || '·', t: it.label, s: it.hint || it.keys || '', run: it.run,
    text: `${it.label} ${it.hint || ''} ${/done/i.test(it.label) ? 'done archive finish tidy' : /side question/i.test(it.label) ? 'btw aside quick question' : /Summarize/.test(it.label) ? 'compact summarize context' : /Stop/.test(it.label) ? 'stop end quit chat' : /Find/.test(it.label) ? 'find search' : ''}`,
  })) : [];
  if (!q) {
    const destinations = new Set(['New chat', 'Go to the hub', 'Your work', 'Recent chats', 'Connections', 'Routines', 'Setup and health']);
    if (inChat) add('This chat', [
      { glyph: '←', t: `Back to ${Shell.location()}`, s: 'leave the conversation running', run: () => document.querySelector('#chat [data-c="back"]').click() },
      { glyph: '▤', t: 'Files and output', s: 'artifacts, files, commands and tasks', run: () => document.querySelector('#chat [data-c="ledger"]').click() },
      ...chatActs.filter(x => /Find in|Make a pull request/.test(x.t)),
      ...modelPage,
    ]);
    else if (S.view === 'work') add('Selected work', acts.filter(x => workActs.some(w => w.t === x.t)));
    add('Go to', acts.filter(x => destinations.has(x.t)));
    add('Active now', run);
    if (here) add(`Start ${here.name} with a prompt`, prompts.slice(0, S.prompts.length));
    add('Recent chats', chats.slice(0, 6));
    add('Projects', folders.slice(0, 6));
    add('More chat commands', chatActs.filter(x => !/Find in|Make a pull request/.test(x.t)));
    add('Actions', acts.filter(x => !destinations.has(x.t) && (inChat || S.view !== 'work' || !workActs.some(w => w.t === x.t))));
    return out;
  }
  // Each group ranked; the groups ordered by their best match (ties keep this order). Phrases first,
  // the full-text search last.
  const rank = list => palRank(list, q);
  add('Do it', sayItems(q));
  const groups = [
    ['This chat', rank([...chatActs, ...modelPage]).slice(0, 3)],
    ['Actions', rank(acts).slice(0, 5)],
    ['Active now', rank(run).slice(0, 5)],
    ['Chats', rank(chats).slice(0, 8)],
    ['Projects', rank(folders).slice(0, 5)],
    ['Review pictures', rank(boards).slice(0, 3)],
    // Projects' documents load in the background; while they do, the group says so.
    ['Documents', [...rank(docs).slice(0, 5), ...(palDocsLoading() ? [{ note: 'Still finding documents…', loading: true }] : [])]],
    ['Start with a prompt', rank(prompts).slice(0, 4)],
    ['Switch model in this chat', rank(models).slice(0, 6)],
    ['Start a chat', rank([...claudeNew, ...cxNew]).slice(0, 4)],
    ['Pin', rank(pinItems).slice(0, 3)],
  ].map(([g, list], i) => ({ g, list, i, best: Math.max(-1, ...list.map(x => x.score || 0)) }));
  groups.sort((a, b) => b.best - a.best || a.i - b.i).forEach(x => add(x.g, x.list));
  out.push({ g: 'Inside every message', tail: true }, { glyph: '❝', t: `Search every message for “${q}”`, s: 'full text', run: () => runSearch(q), frec: false, fallback: true });
  return out;
}
// Pages: the full list of something you'd otherwise pick from many flat items.
function themePage() {
  // The theme showing now (the light or dark pick when following the device); the five main ones first.
  const on = Look.theme().id;
  return [...Look.THEMES.filter(t => t.main), ...Look.THEMES.filter(t => !t.main)].map(t => ({ id: `theme:${t.id}`, glyph: t.id === on ? '●' : '○', t: t.main ? `${t.name} (${t.light ? 'light' : 'dark'})` : t.name, s: t.id === on ? 'in use' : t.note, text: `${t.name} ${t.note || ''} ${t.family || ''}`, run: () => Look.set({ theme: t.id }) }));
}
function accountPage() {
  return S.accounts.map(a => ({ id: `acct:${a.id}`, glyph: a.id === S.acct ? '●' : '◆', t: a.name, s: [a.id === S.acct ? 'new chats open as this' : '', a.signedIn ? usageLine(a.id, { short: true }) : 'not signed in'].filter(Boolean).join(' · '), text: `${a.name} ${a.email || ''} ${a.plan || ''}`, run: () => useAccount(a.id) }));
}
const palDocsLoading = () => typeof worldsLoading !== 'undefined' && !!worldsLoading;
// What can be picked: not the group titles, nor notes like "Loading…".
const palPickable = x => !x.g && !x.note;
const palPicks = () => Pal.items.filter(palPickable);
const palPage = () => Pal.stack[Pal.stack.length - 1] || null;
// Inside a page: its items, ranked by what you type.
function pageItems(page, q) {
  if (page.loading) return [{ note: 'Loading…', loading: true }];
  if (page.error) return [{ note: page.error }];
  return q ? palRank(page.items.filter(palPickable), q) : page.items;
}
// What changes with the page: the breadcrumb chip by the box, what the box says, the Back hint.
function palChrome(page) {
  let chip = $('palCrumb');
  if (!chip) {
    $('palQ').insertAdjacentHTML('beforebegin', '<button type="button" class="pal-crumb" id="palCrumb" tabindex="-1" hidden></button>');
    const escHint = [...$('palette').querySelectorAll('.pal-foot span')].find(x => /^Esc/.test(x.textContent));
    if (escHint) escHint.id = 'palEscKey';
    $('palList').insertAdjacentHTML('afterend', '<p class="sr" id="palSay" role="status" aria-live="polite"></p>');
    chip = $('palCrumb');
    chip.addEventListener('mousedown', e => e.preventDefault());   // the box keeps the keyboard
    chip.addEventListener('click', () => palBack());
  }
  chip.hidden = !page;
  if ($('palEscKey')) $('palEscKey').textContent = page ? 'Esc or ⌫ back' : 'Esc close';
  const box = $('palQ');
  if (page) {
    const trail = Pal.stack.map(p => p.title);
    chip.innerHTML = trail.map(t => `<span>${esc(t)}</span>`).join('<span class="pc-sep" aria-hidden="true">›</span>');
    chip.title = 'Back (Backspace)';
    chip.setAttribute('aria-label', `Back from ${trail.join(', ')}`);
    box.placeholder = page.placeholder || 'Filter…';
    box.setAttribute('aria-label', `${page.title}: type to filter, Backspace to go back`);
  } else {
    box.placeholder = 'Search or run a command…';
    box.setAttribute('aria-label', 'Search or run a command');
  }
}
let palSayTimer = 0;
function renderPal() {
  const q = $('palQ').value.trim(), page = palPage();
  Pal.items = page ? pageItems(page, q) : palItems(q);
  palChrome(page);
  const picks = palPicks();
  Pal.sel = Math.min(Pal.sel, Math.max(0, picks.length - 1));
  // Nothing found: said plainly, with what to try (the search inside every message still waits below it).
  const found = picks.filter(x => !x.fallback).length, loading = Pal.items.some(x => x.loading);
  const empty = q && !found && !(page && page.loading)
    ? `<li class="pal-empty" role="presentation"><b>Nothing matches “${esc(q)}”${loading ? ' yet' : ''}</b><span>${page ? 'Try fewer letters, or Backspace on an empty box to go back.' : 'Try fewer letters or another word, or press Enter to search inside every message.'}</span></li>`
    : '';
  let n = -1, html = '', shown = false;
  for (const x of Pal.items) {
    if (x.tail && empty) { html += empty; shown = true; }
    if (x.g) { html += `<li class="pal-g" role="presentation">${esc(x.g)}</li>`; continue; }
    if (x.note) { html += `<li class="pal-note${x.loading ? ' loading' : ''}" role="presentation">${esc(x.note)}</li>`; continue; }
    n++;
    html += `<li class="pal-i${x.page ? ' has-page' : ''}" role="option" id="pal-${n}" data-n="${n}" aria-selected="${n === Pal.sel}"><span class="glyph" aria-hidden="true">${esc(x.glyph || '·')}</span><span class="pi-t">${PalMatch.mark(x.t, x.hl)}</span>${x.s ? `<span class="pi-s">${esc(x.s)}</span>` : ''}${x.page ? '<span class="pi-more" aria-hidden="true">›</span><span class="sr">, opens a list</span>' : ''}</li>`;
  }
  if (empty && !shown) html += empty;
  $('palList').innerHTML = html || '<li class="pal-empty" role="presentation">Nothing here yet.</li>';
  if (picks.length) $('palQ').setAttribute('aria-activedescendant', `pal-${Pal.sel}`); else $('palQ').removeAttribute('aria-activedescendant');
  $('palList').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  // For a screen reader: how many there are, once typing pauses.
  clearTimeout(palSayTimer);
  const say = page ? (page.loading ? `${page.title}: loading` : `${page.title}: ${plural(found, 'choice')}`) : q ? (found ? plural(found, 'result') : `Nothing matches ${q}`) : '';
  palSayTimer = setTimeout(() => { if ($('palSay')) $('palSay').textContent = say; }, 450);
  // Something still loading: shown again when it's in.
  if (loading && !page && palDocsLoading() && Pal.waiting !== worldsLoading) {
    const w = (Pal.waiting = worldsLoading);
    w.finally(() => { if (Pal.waiting === w) Pal.waiting = null; if (!$('palette').hidden && !palPage()) renderPal(); });
  }
}
// Moving the selection only: no new search, so nothing shifts under you.
function selectPal(n) {
  const count = palPicks().length;
  if (!count) return;
  Pal.sel = Math.max(0, Math.min(count - 1, n));
  const list = $('palList');
  for (const el of list.querySelectorAll('.pal-i[aria-selected="true"]')) el.setAttribute('aria-selected', 'false');
  const el = document.getElementById(`pal-${Pal.sel}`);
  if (!el) return;
  el.setAttribute('aria-selected', 'true');
  $('palQ').setAttribute('aria-activedescendant', el.id);
  el.scrollIntoView({ block: 'nearest' });
}
function openPage(x) {
  const page = { title: x.pageTitle || String(x.t).replace(/…$/, ''), placeholder: x.placeholder, items: [], loading: false };
  Pal.stack.push(page);
  let got;
  try { got = x.page(); } catch (err) { page.error = err.message || String(err); }
  if (got && typeof got.then === 'function') {
    page.loading = true;
    got.then(list => { page.items = list || []; }, err => { page.error = (err && err.message) || 'Couldn’t load this list.'; })
      .finally(() => { page.loading = false; if (palPage() === page && !$('palette').hidden) { Pal.sel = 0; renderPal(); } });
  } else if (got) page.items = got;
  $('palQ').value = ''; Pal.sel = 0; renderPal();
}
function palBack() {
  if (!Pal.stack.length) return false;
  Pal.stack.pop();
  $('palQ').value = ''; Pal.sel = 0; renderPal();
  return true;
}
let palReturn = null;
function openPalette(prefill = '') {
  closeMenu();
  if ($('palette').hidden) palReturn = document.activeElement;
  Pal.stack = [];
  $('palette').hidden = false; $('palQ').value = prefill; Pal.sel = 0; renderPal(); $('palQ').focus();
}
function closePalette() {
  if ($('palette').hidden) return;
  $('palette').hidden = true;
  Pal.stack = [];
  if (palReturn && document.contains(palReturn) && palReturn.focus && !palReturn.closest('[inert]')) palReturn.focus({ preventScroll: true });
  else (window.ChatUI?.isOpen() ? $('cText') : $('seek')).focus({ preventScroll: true });
  palReturn = null;
}
function pickPal(n) {
  const x = palPicks()[n];
  if (!x) return;
  if (x.frec !== false) PalFrec.note(palId(x));
  if (x.page) { openPage(x); return; }
  closePalette(); wrap(x.run)();
}
$('palQ').addEventListener('input', () => { Pal.sel = 0; renderPal(); });
$('palQ').addEventListener('keydown', e => {
  // The input owns selection through aria-activedescendant; listbox options are not tab stops.
  if (e.key === 'Tab') { e.preventDefault(); return; }
  const count = palPicks().length, plain = !e.altKey && !e.metaKey && !e.shiftKey;
  const ctrl = e.ctrlKey && plain ? e.key.toLowerCase() : '';
  if (e.key === 'ArrowDown' || ctrl === 'n') { e.preventDefault(); selectPal((Pal.sel + 1) % Math.max(1, count)); }
  else if (e.key === 'ArrowUp' || ctrl === 'p') { e.preventDefault(); selectPal((Pal.sel - 1 + count) % Math.max(1, count)); }
  else if ((e.key === 'Home' || e.key === 'End') && !e.ctrlKey && plain) { e.preventDefault(); selectPal(e.key === 'Home' ? 0 : count - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); pickPal(Pal.sel); }
  else if (e.key === 'Backspace' && !e.target.value && Pal.stack.length) { e.preventDefault(); palBack(); }
  // Escape: out of a page first, as in cmdk; at the top it closes and gives the keyboard back.
  else if (e.key === 'Escape') { e.preventDefault(); if (!palBack()) closePalette(); }
});
document.addEventListener('focusin', e => {
  if (!$('palette').hidden && !$('palette').contains(e.target)) $('palQ').focus({ preventScroll: true });
});
$('palList').addEventListener('mousemove', e => { const i = e.target.closest('.pal-i'); if (i && +i.dataset.n !== Pal.sel) selectPal(+i.dataset.n); });
$('palList').addEventListener('click', e => { const i = e.target.closest('.pal-i'); if (i) pickPal(+i.dataset.n); });
$('palette').addEventListener('mousedown', e => { if (e.target === $('palette')) closePalette(); });

let searchSeq = 0;
async function runSearch(q) {
  S.q = q; S.hits = null; go('search');
  const seq = ++searchSeq;
  const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (seq !== searchSeq || S.view !== 'search') return;
  S.hits = r; renderSearch();
  if (!r.progress.ready) setTimeout(() => { if (S.view === 'search' && S.q === q) wrap(runSearch)(q); }, 1500);
}

/* ---------- the file viewer: open what a chat links to ---------- */
// Files that are only ever words: opening one can't run anything, whatever this computer does with it.
const EDITABLE = /\.(md|markdown|mdx|txt|json|csv|tsv|log|ya?ml|toml|xml|ini|cfg|css|scss)$/i;
const canEditor = f => !window.REMOTE && EDITABLE.test(f.name);
const Viewer = (() => {
  const V = { ctx: {}, stack: [], cur: null, raw: false, list: null, idx: -1 };
  const dlg = () => $('viewer');
  function ensure() {
    if ($('viewer')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="viewer" class="wide viewer" aria-labelledby="vTitle"><div class="v-wrap"><div class="v-head" id="vHead"></div><div class="v-body" id="vBody"></div><div class="v-find" id="vFind" hidden role="search"><label class="sr" for="vFindQ">Find in this file</label><input id="vFindQ" type="text" placeholder="Find in this file" autocomplete="off" spellcheck="false"><span class="count" id="vFindN" aria-live="polite"></span><button type="button" class="icon" data-vf="prev" aria-label="Previous match" title="Previous (Shift+Enter)">↑</button><button type="button" class="icon" data-vf="next" aria-label="Next match" title="Next (Enter)">↓</button><button type="button" class="icon" data-vf="close" aria-label="Close find" title="Close (Esc)">✕</button></div><div class="v-notes" id="vNotes" hidden></div><div class="v-pop" id="vPop" hidden></div></div></dialog>`);
    dlg().addEventListener('click', wrap(onClick));
    dlg().addEventListener('close', () => { V.stack = []; V.list = null; DocNotes.shown(null); DocFind.shown(null); });
    dlg().addEventListener('cancel', e => { DocNotes.onCancel(e); DocFind.onCancel(e); });
    // In a project's gallery, ← and → step through its pictures.
    dlg().addEventListener('keydown', e => {
      if (!V.list || !V.cur || !(inGallery() || inDocs()) || e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); wrap(step)(e.key === 'ArrowRight' ? 1 : -1); }
    });
  }
  const sizeOf = n => (n === null || n === undefined ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  function joinPath(dir, rel) {
    if (/^([A-Za-z]:[\\/]|\/|~)/.test(rel)) return rel;
    const sep = dir.includes('\\') ? '\\' : '/';
    const parts = dir.split(/[\\/]+/);
    for (const seg of rel.split(/[\\/]+/)) { if (!seg || seg === '.') continue; if (seg === '..') { if (parts.length > 1) parts.pop(); } else parts.push(seg); }
    return parts.join(sep) || sep;
  }
  function crumbs(p) {
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(/[\\/]+/).filter((x, i) => x || i === 0);
    let acc = '';
    return parts.map((seg, i) => {
      acc = i === 0 ? (seg || sep) : `${acc}${acc.endsWith(sep) ? '' : sep}${seg}`;
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) acc = `${seg}${sep}`;
      const last = i === parts.length - 1;
      const label = seg || sep;
      const el = last ? `<span class="v-crumb cur">${esc(label)}</span>` : `<button class="v-crumb" data-v="go" data-path="${esc(acc)}">${esc(label)}</button>`;
      return i === 0 || (i === 1 && !parts[0]) ? el : `<span class="v-sep">${esc(sep)}</span>${el}`;
    }).join('');
  }
  function render() {
    const f = V.cur;
    const kind = f.kind === 'dir' ? 'Folder' : f.kind === 'image' ? 'Image' : f.kind === 'text' ? (f.lang || 'text') : f.kind === 'video' ? 'Video' : f.kind === 'audio' ? 'Sound' : f.kind === 'pdf' ? 'PDF' : 'File';
    const meta = [kind, f.kind === 'dir' ? plural(f.entries.length, 'item') : sizeOf(f.size), f.mtime ? `changed ${agoL(f.mtime)}` : ''].filter(Boolean).join(' · ');
    $('vHead').innerHTML = `
      <div class="v-t">
        <p class="eyebrow">${esc(meta)}</p>
        <h3 id="vTitle">${V.stack.length ? '<button class="icon v-back" data-v="back" aria-label="Back">←</button>' : ''}${esc(f.name)}</h3>
        <p class="v-path">${crumbs(f.path)}</p>
      </div>
      <div class="v-act">
        ${f.kind === 'text' && f.markdown ? `<div class="seg" role="group" aria-label="View"><button class="${V.raw ? '' : 'on'}" data-v="rendered" aria-pressed="${!V.raw}">Formatted</button><button class="${V.raw ? 'on' : ''}" data-v="raw" aria-pressed="${V.raw}">Markdown</button></div>` : ''}
        ${f.kind === 'text' ? `<button class="btn prime sm" data-v="copy">Copy ${f.markdown ? 'markdown' : 'text'}</button>${sagaLook() ? '' : '<button class="btn quiet sm" data-doc-note title="Select a passage first to note just that (N)">Add a note</button><button class="icon" data-doc-find aria-label="Find in this file" title="Find in this file (Ctrl+F)">⌕</button>'}` : ''}
        ${f.kind === 'text' && !sagaLook() && canEditor(f) ? '<button class="btn quiet sm" data-v="editor" title="Open it in the program this computer uses for these files">Open in your editor</button>' : ''}
        ${f.kind === 'image' ? '<button class="btn prime sm" data-v="copyimg" title="Copy the picture, to paste anywhere">Copy picture</button><button class="btn quiet sm" data-v="big" title="Full screen, to zoom in">View larger</button>' : ''}
        ${inGallery() ? `<span class="v-step"><button class="icon" data-v="prev" aria-label="Previous picture" ${V.idx > 0 ? '' : 'disabled'}>‹</button><span class="count">${V.idx + 1} of ${V.list.length}</span><button class="icon" data-v="next" aria-label="Next picture" ${V.idx < V.list.length - 1 ? '' : 'disabled'}>›</button></span>
          ${isBanner() ? '<span class="tag gilt">Banner</span>' : '<button class="btn sm" data-v="banner">Use as banner</button>'}` : ''}
        ${inDocs() ? `<span class="v-step"><button class="icon" data-v="prev" aria-label="Previous document" title="Previous (←)" ${V.idx > 0 ? '' : 'disabled'}>‹</button><span class="count">${V.idx + 1} of ${V.list.length}</span><button class="icon" data-v="next" aria-label="Next document" title="Next (→)" ${V.idx < V.list.length - 1 ? '' : 'disabled'}>›</button></span>` : ''}
        ${/\.html?$/i.test(f.name) && f.kind !== 'dir' && !window.REMOTE ? `<button class="btn prime sm" data-v="browser" title="Open this page in your web browser">Open in browser</button>${window.ChatUI && ChatUI.isOpen() && window.Split && Split.can() ? '<button class="btn sm" data-v="beside" title="See it beside the chat, here in this window">See it beside the chat</button>' : ''}` : ''}
        <button class="btn sm" data-v="work" aria-haspopup="menu" title="Start a chat in ${esc(f.kind === 'dir' ? f.path : f.dir)}">Work here ▾</button>
        <button class="btn sm" data-v="copypath">Copy path</button>
        <button class="btn quiet sm" data-v="reveal">${f.kind === 'dir' ? `Open in ${S.platform === 'darwin' ? 'Finder' : 'Explorer'}` : 'Show in folder'}</button>
        <button class="icon" data-v="close" aria-label="Close">✕</button>
      </div>`;
    let body = '';
    if (f.kind === 'dir') {
      body = f.entries.length ? `<ul class="v-dir">${f.entries.map(e => `<li><button data-v="open" data-name="${esc(e.name)}"><span class="glyph" aria-hidden="true">${e.dir ? '❖' : '✧'}</span><span class="vd-n">${esc(e.name)}${e.dir ? '/' : ''}</span><span class="vd-s">${e.dir ? '' : esc(sizeOf(e.size))}</span><span class="vd-m">${e.mtime ? esc(agoL(e.mtime)) : ''}</span></button></li>`).join('')}</ul>${f.more ? '<p class="v-note">Showing the first 1,000 items.</p>' : ''}` : '<p class="v-note">This folder is empty.</p>';
    } else if (f.kind === 'image') body = `<div class="v-img"><img src="${esc(f.src)}" alt="${esc(f.name)}" data-v="big" title="Click to view it full screen and zoom in"></div>`;
    else if (f.kind === 'video') body = `<div class="v-media"><video controls autoplay preload="metadata" src="${esc(mediaSrc(f.path))}"></video></div>`;
    else if (f.kind === 'audio') body = `<div class="v-media audio"><audio controls preload="metadata" src="${esc(mediaSrc(f.path))}"></audio></div>`;
    else if (f.kind === 'pdf') body = `<iframe class="v-pdf" title="${esc(f.name)}" src="${esc(mediaSrc(f.path))}"></iframe>`;
    else if (f.kind === 'text') {
      // A note's top part (--- name: …, description: … ---) is for the program: folded away when it's formatted.
      const top = f.markdown && !V.raw ? /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(f.text) : null;
      const words = top ? f.text.slice(top[0].length) : f.text;
      body = (f.markdown && !V.raw ? `<article class="md v-md">${top ? `<details class="v-front"><summary>About this file</summary><pre>${esc(top[1])}</pre></details>` : ''}${ChatUI.mdIn(words, { path: rel => joinPath(f.dir, rel), src: abs => fileUrl('image', abs, V.ctx) })}</article>` : `<pre class="v-raw">${esc(f.text)}</pre>`) + (f.truncated ? '<p class="v-note">Only the first 2 MB are shown.</p>' : '');
    } else body = `<p class="v-note">${esc(f.note || 'This file can’t be shown here.')}</p>`;
    $('vBody').innerHTML = body;
    $('vBody').scrollTop = 0;
    // A long document's headings, a click away. (Imperial and Rebel: under Work here.)
    if (headings().length >= 4 && !sagaLook()) $('vHead').querySelector('.v-act').insertAdjacentHTML('afterbegin', '<button class="btn quiet sm" data-v="contents" aria-haspopup="menu" title="Jump to a heading in this document">Contents</button>');
    DocNotes.shown(f, V.ctx);
    DocFind.shown(f);
  }
  const headings = () => [...$('vBody').querySelectorAll('.v-md h2, .v-md h3, .v-md h4')];   // (# is an h2 here)
  const slugOf = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  function contentsItems() {
    const hs = headings(), top = Math.min(...hs.map(h => Number(h.tagName[1])));
    return hs.map(h => ({ label: `${'\u00a0\u00a0\u00a0'.repeat(Number(h.tagName[1]) - top)}${h.textContent.trim().slice(0, 80)}`, run: () => h.scrollIntoView({ block: 'start' }) }));
  }
  function fileUrl(route, p, ctx) {
    const q = new URLSearchParams({ token: TOKEN, path: p });
    for (const k of ['key', 'session', 'cwd']) if (ctx[k]) q.set(k, ctx[k]);
    return `/api/${route}?${q}`;
  }
  const mediaSrc = p => fileUrl('media', p, V.ctx);
  async function load(pathArg, { push = true } = {}) {
    const params = new URLSearchParams({ path: pathArg });
    for (const k of ['key', 'session', 'cwd']) if (V.ctx[k]) params.set(k, V.ctx[k]);
    for (const n of V.near || []) params.append('near', n);
    const f = await api(`/api/file?${params}`);
    // Named without saying where, and there's more than one: yours to say which.
    if (f.kind === 'choices') {
      $('vHead').innerHTML = `<div class="v-t"><p class="eyebrow">Which one?</p><h3 id="vTitle">${esc(String(f.path).split(/[\\/]/).filter(Boolean).pop() || f.path)}</h3></div><div class="v-act"><button class="icon" data-v="close" aria-label="Close">✕</button></div>`;
      $('vBody').innerHTML = `<p class="v-note">The chat didn’t say where this is, and there’s more than one on this computer.</p><ul class="v-choices">${f.matches.map(m => `<li><button type="button" class="btn quiet sm" data-v="go" data-path="${esc(m)}">${esc(m)}</button></li>`).join('')}</ul>`;
      return;
    }
    if (push && V.cur) V.stack.push(V.cur.path);
    V.cur = f; V.raw = false; render();
  }
  const inGallery = () => !!(V.list && V.cur && V.cur.kind === 'image' && V.idx >= 0 && !V.stack.length);
  const inDocs = () => !!(V.list && V.cur && V.cur.kind === 'text' && V.list.length > 1 && V.idx >= 0 && !V.stack.length);
  const isBanner = () => { const w = V.ctx.cwd && S.worlds[V.ctx.cwd]; return !!(w && w.banner === V.list[V.idx]); };
  // provider: claude, codex or gemini for a new chat there; null for the project's page.
  const workIn = wrap(async (dir, provider) => {
    const r = await api('/api/project/create', { existing: dir });
    if (dlg().open) dlg().close();
    await loadSessions(); renderNav();
    if (!provider) return go('folder', r.cwd);
    return ChatUI.open({ cwd: r.cwd, mode: 'new', ...(provider === 'claude' ? {} : { provider }) });
  });
  async function step(d) {
    const j = V.idx + d; if (!V.list || j < 0 || j >= V.list.length) return;
    V.idx = j; await load(V.list[j], { push: false });
  }
  async function open({ path: p, key = null, session = null, cwd = null, list = null, near = [] }) {
    ensure();
    V.ctx = { key, session, cwd }; V.stack = []; V.cur = null; V.near = near;
    V.list = list && list.length ? list : null; V.idx = V.list ? V.list.indexOf(p) : -1;
    $('vHead').innerHTML = ''; $('vBody').innerHTML = '<p class="loading">Opening…</p>';
    if (!dlg().open) dlg().showModal();
    try { await load(p, { push: false }); }
    catch (err) { $('vHead').innerHTML = `<div class="v-t"><p class="eyebrow">Couldn’t open</p><h3 id="vTitle">${esc(String(p).split(/[\\/]/).filter(Boolean).pop() || p)}</h3></div><div class="v-act"><button class="icon" data-v="close" aria-label="Close">✕</button></div>`; $('vBody').innerHTML = `<p class="v-note">${esc(err.message)}</p>`; }
  }
  async function onClick(e) {
    const fl = e.target.closest('.flink[data-path]'); if (fl) { e.preventDefault(); return load(joinPath(V.cur.dir, fl.dataset.path)); }
    const pic = e.target.closest('.v-md .md-pic[data-path]'); if (pic) { e.preventDefault(); return load(pic.dataset.path); }
    const a = e.target.closest('.v-md a[href]');
    if (a && /^#/.test(a.getAttribute('href') || '')) {
      e.preventDefault();
      const want = decodeURIComponent(a.getAttribute('href').slice(1)).toLowerCase(), h = headings().find(x => slugOf(x.textContent) === want);
      if (h) h.scrollIntoView({ block: 'start' });
      return undefined;
    }
    const b = e.target.closest('[data-v]'); if (!b) { if (e.target === dlg()) dlg().close(); return undefined; }
    const f = V.cur;
    switch (b.dataset.v) {
      case 'close': return dlg().close();
      case 'back': { const p = V.stack.pop(); if (p) await load(p, { push: false }); return undefined; }
      case 'go': return load(b.dataset.path);
      case 'open': return load(joinPath(f.path, b.dataset.name));
      case 'prev': return step(-1);
      case 'next': return step(1);
      case 'banner': {
        const w = await api('/api/project/banner', { cwd: V.ctx.cwd, path: V.list[V.idx] });
        S.worlds[V.ctx.cwd] = { ...w, at: Date.now() };
        toast('Banner updated.', 2000); render();
        if (S.view === 'folder' && S.folder === V.ctx.cwd) renderFolder();
        return undefined;
      }
      case 'contents': return showMenu(b, contentsItems());
      case 'rendered': V.raw = false; return render();
      case 'raw': V.raw = true; return render();
      case 'copy': return copyText(f.text, null).then(ok => { if (ok) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = `Copy ${f.markdown ? 'markdown' : 'text'}`; }, 1600); } });
      case 'copypath': return copyText(f.path, 'Copied the path.');
      case 'copyimg': return copyImage(f.src);
      case 'editor': { const r = await api('/api/file/editor', { path: f.path, ...V.ctx }); if (r.dryRun) toast(`Would run: ${r.script}`); return undefined; }
      case 'beside': { const r = await api('/api/file/preview', { path: f.path, ...V.ctx }); dlg().close(); return openSiteBeside(r.url); }
      case 'browser': { const r = await api('/api/file/browser', { path: f.path, ...V.ctx }); if (r.dryRun) toast(`Would run: ${r.script}`); return undefined; }
      // Work in this folder (or this file's): it joins your projects, and a chat starts there.
      case 'work': {
        const dir = f.kind === 'dir' ? f.path : f.dir, a = current();
        return showMenu(b, [
          { label: 'New Claude chat here', hint: a ? `as ${a.name}` : '', disabled: !a || !canLaunch(a), why: (a && a.lockMessage) || 'Sign in first', run: () => workIn(dir, 'claude') },
          ...(S.codex && S.codex.enabled ? [{ label: 'New Codex chat here', disabled: !codexReady(), why: 'Sign in to Codex first', run: () => workIn(dir, 'codex') }] : []),
          ...(S.gemini && S.gemini.enabled ? [{ label: 'New Gemini chat here', disabled: !geminiReady(), why: 'Finish setting up Gemini first', run: () => workIn(dir, 'gemini') }] : []),
          '-',
          { label: 'Open it as a project', hint: dir.split(/[\\/]/).filter(Boolean).pop() || dir, run: () => workIn(dir, null) },
          // Imperial and Rebel keep their row of buttons as it was: these are here instead.
          ...(sagaLook() && f.kind === 'text' ? ['-', ...(headings().length >= 4 ? [{ label: 'Contents', hint: 'jump to a heading', run: () => showMenu(b, contentsItems()) }] : []), { label: 'Add a note', hint: 'N', run: () => DocNotes.note() }, { label: 'Find in this file', hint: 'Ctrl+F', run: () => DocFind.open() },
            ...(canEditor(f) ? [{ label: 'Open in your editor', run: async () => { const r = await api('/api/file/editor', { path: f.path, ...V.ctx }); if (r.dryRun) toast(`Would run: ${r.script}`); } }] : [])] : []),
        ]);
      }
      // Full screen, in the picture viewer (over everything, so this closes first).
      case 'big': { const pics = inGallery() ? V.list : [f.path], at = inGallery() ? V.idx : 0, ctx = { ...V.ctx }; dlg().close(); return openGallery(f.src, null, pics.map((p, i) => ({ src: i === at ? f.src : fileUrl('image', p, ctx), path: p, cap: String(p).split(/[\\/]/).pop(), noAttach: true }))); }
      case 'reveal': { const r = await api('/api/reveal', { path: f.path, ...V.ctx }); if (r.dryRun) toast(`Would run: ${r.script}`); return undefined; }
      default: return undefined;
    }
  }
  return { open, joinPath, close: () => { if ($('viewer') && dlg().open) dlg().close(); } };
})();
