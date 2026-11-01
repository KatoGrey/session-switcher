// The hub, compact (ui/hub.css): the sidebar's lists, the short header, the jump bar, folding sections,
// accounts with their details on demand, every project a click away, New chat from anywhere. And what
// makes it usable without a mouse or with weak eyes: names on everything, a sane heading order, readable
// sizes and contrast, keyboard paths.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sleep } = require('./browser');
const demo = require('./demo');

// What a person could see: the text in the bar, the sidebar and the page, each with its size and how
// well it stands out from what's behind it. A background that's a gradient or a picture can't be read
// off the style; those are left out (the theme check covers the theme's own colors).
const TEXT_AUDIT = `
  const parse = s => { const m = String(s).match(/[\\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const out = [];
  for (const root of document.querySelectorAll('.bar, #nav, #page')) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement, cs = getComputedStyle(el), box = el.getBoundingClientRect();
      if (!box.width || !box.height || cs.visibility === 'hidden' || el.closest('[hidden], .sr, svg, .hero, .w-art, .crest, .btn.prime, .btn.gilt, .tag.gilt, .studio-counts, .td-track, .glyph, code')) continue;
      if (getComputedStyle(el).opacity === '0') continue;
      // Everything behind the text, nearest first, down to something solid.
      const layers = []; let solid = null, odd = false;
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.backgroundImage !== 'none' && p !== document.body && p !== document.documentElement) { odd = true; break; }
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { if (c.a >= 1) { solid = c; break; } layers.push(c); }
      }
      if (odd) { out.push({ text: n.nodeValue.trim().slice(0, 40), size: Math.round(parseFloat(cs.fontSize) * 10) / 10, ratio: 99, needed: 0, disabled: !!el.closest(':disabled'), cls: String(el.className || el.tagName).slice(0, 40) }); continue; }
      if (!solid) solid = parse(getComputedStyle(document.body).backgroundColor) && parse(getComputedStyle(document.body).backgroundColor).a ? parse(getComputedStyle(document.body).backgroundColor) : parse(getComputedStyle(document.documentElement).getPropertyValue('--abyss'));
      let bg = solid; for (const c of layers.reverse()) bg = over(c, bg);
      const ink = over(parse(cs.color), bg);
      const [hi, lo] = [lum(ink), lum(bg)].sort((a, b) => b - a), ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const needed = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      out.push({ text: n.nodeValue.trim().slice(0, 40), size: Math.round(size * 10) / 10, ratio: Math.round(ratio * 100) / 100, needed, disabled: !!el.closest(':disabled'), cls: String(el.className || el.tagName).slice(0, 40) });
    }
  }
  return out;
`;

module.exports = [
  {
    name: 'find looks further back',
    // A long chat shows its latest part. What you're looking for may be older than that.
    async run(t) {
      const b = await t.open();
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1300);
      const setup = `
        const feed = document.getElementById('cFeed');
        window._pages = [
          [{ kind: 'user', text: 'The second older page', at: '2026-01-02T00:00:00Z' }],
          [{ kind: 'user', text: 'The oldest page mentions a marmalade lantern here', at: '2026-01-01T00:00:00Z' }],
        ];
        window._realPage = historyPage;
        C.compHist = {};
        historyPage = async () => { const items = window._pages.shift() || []; return { items, start: window._pages.length ? 1 : 0, cursor: window._pages.length ? 'more' : null }; };
        C.historyStart = 2; C.historyCursor = 'more';
        document.getElementById('cEarlier').hidden = false;
        return 1`;
      await b.eval(setup);
      await b.eval(`openFind('marmalade'); return 1`); await sleep(150);
      t.check('not in what’s showing: it says Enter looks further back', /Enter looks further back/.test(await b.eval(`return document.getElementById('cFindN').textContent`)));
      await b.key('Enter', 'Enter', 13); await sleep(500);
      const found = await b.eval(`return { n: Find.hits.length, label: document.getElementById('cFindN').textContent, top: [...document.querySelectorAll('#cFeed .umsg')].some(x => /marmalade/.test(x.textContent)), pagesLeft: window._pages.length }`);
      t.check('Enter brings earlier messages in until it’s found', found.n === 1 && found.top && found.pagesLeft === 0 && /1 of 1/.test(found.label), found);
      // From a search, it just goes and looks.
      await b.eval(`closeFind(); ${setup.replace(/marmalade lantern/g, 'quince bucket').replace('const feed = document.getElementById(\'cFeed\');', '')}`);
      await b.eval(`await ChatUI.find('quince bucket'); return 1`); await sleep(300);
      const auto = await b.eval(`return { n: Find.hits.length, label: document.getElementById('cFindN').textContent }`);
      t.check('from a search, it goes and looks by itself', auto.n === 1 && /1 of 1/.test(auto.label), auto);
      // The chat's messages can still be arriving when it opens, and new ones come while it's open.
      const moving = await b.eval(`
        closeFind();
        document.getElementById('cEarlier').hidden = true;
        const feed = document.getElementById('cFeed');
        openFind('wandering minstrel');
        const add = text => { const d = document.createElement('div'); d.className = 'umsg'; d.textContent = text; feed.appendChild(d); return d; };
        const before = document.getElementById('cFindN').textContent;
        add('A wandering minstrel arrives');
        await new Promise(r => setTimeout(r, 400));
        const first = { label: document.getElementById('cFindN').textContent, n: Find.hits.length };
        add('Another wandering minstrel, while you look');
        await new Promise(r => setTimeout(r, 400));
        const second = { label: document.getElementById('cFindN').textContent, n: Find.hits.length, i: Find.i };
        closeFind();
        const quiet = Find.watch;
        return { before, first, second, quiet }`);
      t.check('Find that opened too soon catches up', /No matches/.test(moving.before) && moving.first.n === 1 && /1 of 1/.test(moving.first.label), moving);
      t.check('a new match while you look is counted, and your place stays', moving.second.n === 2 && /1 of 2/.test(moving.second.label) && moving.second.i === 0, moving);
      t.check('closed, it stops watching', moving.quiet === null, moving);
      // From a search, into a chat whose messages haven't come yet: it doesn't say No matches too soon.
      const soon = await b.eval(`
        document.getElementById('cEarlier').hidden = true;
        await ChatUI.find('not here yet');
        const label = document.getElementById('cFindN').textContent;
        closeFind();
        return label`);
      t.check('from a search, it says it’s looking, not No matches, while messages may still be coming', soon === 'Looking…', soon);
      // Nothing anywhere: it says so, and doesn't hang on to the offer.
      await b.eval(`closeFind(); window._pages = [[{ kind: 'user', text: 'nothing of note', at: '2025-01-01T00:00:00Z' }]]; C.historyCursor = 'more'; C.historyStart = 1; document.getElementById('cEarlier').hidden = false; await ChatUI.find('zzz-not-here'); return 1`); await sleep(300);
      t.check('nothing anywhere: No matches', /No matches/.test(await b.eval(`return document.getElementById('cFindN').textContent`)));
      await b.eval(`historyPage = window._realPage; closeFind(); return 1`);
    },
  },
  {
    name: 'gemini chats are gemini’s',
    async run(t) {
      const calls = [];
      const b = await t.open({ gemini: true, seen: (p, u, body) => calls.push([p, body]) });
      await sleep(600);
      const r = await b.eval(`
        const s = { ...S.projects[0].sessions[0], id: 'gem-1234567', provider: 'gemini', title: 'A Gemini chat' };
        S.projects[0].sessions.unshift(s);
        const items = chatItems(s.id).filter(x => x !== '-').map(x => x.label);
        return items`);
      t.check('a Gemini chat’s menu doesn’t offer Claude’s account, or a copy', r.includes('Open in the chat window') && r.includes('Resume in a terminal') && !r.some(x => / as |a copy|desktop app|transcript/i.test(x)), r);
      // Beside the open chat, whoever's it is, and Mark done once.
      const menus = await b.eval(`
        const base = S.projects[0].sessions[0], rows = { gemini: base };
        for (const provider of ['codex', 'openclaw']) { rows[provider] = { ...base, id: provider + '-1234567', provider }; S.projects[0].sessions.unshift(rows[provider]); }
        rows.claude = S.projects.flatMap(p => p.sessions).find(x => !x.provider || x.provider === 'claude');
        const was = { can: Split.can, open: ChatUI.isOpen, viewing: ChatUI.isViewing, beside: openBeside, show: showMenu };
        Split.can = () => true; ChatUI.isOpen = () => true; ChatUI.isViewing = () => false;
        let shown = null; const asked = [];
        showMenu = (a, items) => { shown = items; };
        openBeside = x => asked.push(x.sessionId);
        const done = {};
        for (const [who, s] of Object.entries(rows)) {
          chatMenu(document.body, s.id);
          done[who] = shown.filter(x => /^(Mark done|Not done)$/.test(x.label)).length;
          const beside = shown.find(x => x.label === 'Open beside this chat');
          if (beside) beside.run();
        }
        Split.can = was.can; ChatUI.isOpen = was.open; ChatUI.isViewing = was.viewing; openBeside = was.beside; showMenu = was.show;
        S.projects[0].sessions = S.projects[0].sessions.filter(x => x !== rows.codex && x !== rows.openclaw);
        return { done, asked, gemini: rows.gemini.id, codex: rows.codex.id, claude: rows.claude.id }`);
      t.check('every kind of chat’s menu says Mark done once', Object.values(menus.done).length === 4 && Object.values(menus.done).every(n => n === 1), menus.done);
      t.check('Open beside this chat works for Gemini, Codex and Claude', [menus.gemini, menus.codex, menus.claude].every(id => menus.asked.includes(id)), menus);
      await b.eval(`resume('gem-1234567', 'resume', true); return 1`); await sleep(300);
      t.check('resuming it in a terminal asks for Gemini', calls.some(([p, x]) => p === '/api/open' && x.provider === 'gemini' && x.sessionId === 'gem-1234567'), calls.filter(([p]) => p === '/api/open'));
      // Its row goes by Gemini's sign-in, not by Claude's.
      const row = await b.eval(`
        const s = S.projects[0].sessions[0], was = S.gemini.signedIn;
        S.gemini.signedIn = false; const off = rowHtml(s, null);
        S.gemini.signedIn = true; const on = rowHtml(s, null);
        const a = current(), wasIn = a.signedIn; a.signedIn = false; const claudeOut = rowHtml(s, null); a.signedIn = wasIn;
        S.gemini.signedIn = was;
        const open = h => { const d = document.createElement('div'); d.innerHTML = h; return d.querySelector('[data-chat], [data-open]').disabled; };
        return { off: open(off), on: open(on), claudeOut: open(claudeOut) }`);
      t.check('its row goes by Gemini’s sign-in, not Claude’s', row.off === true && row.on === false && row.claudeOut === false, row);
      // Its details say whose they are.
      const det = await b.eval(`
        const s = S.projects[0].sessions[0];
        const real = api;
        api = async (u, ...rest) => (String(u).startsWith('/api/session?') ? { session: { ...s, folder: 'X', folderExists: true, updated: Date.now(), sizeKB: 4 }, stats: { prompts: 1, replies: 1, tools: 0, first: null, models: [], version: 'Antigravity CLI 1.3.5' }, messages: [{ role: 'gemini', text: 'Hi' }], running: false } : real(u, ...rest));
        await openDrawer(s.id);
        await new Promise(r => setTimeout(r, 200));
        api = real;
        const d = document.getElementById('drawer'), text = d.innerText;
        const out = { open: d.querySelector('[data-chat]').textContent.trim(), said: /from Gemini/.test(text), claude: /from Claude/.test(text), who: d.querySelector('.msg .who').textContent };
        closeDrawer();
        return out`);
      t.check('its details say Gemini, not Claude or an account of Claude’s', det.open === 'Open in Gemini' && det.said && !det.claude && /Gemini/.test(det.who), det);
      // A new project can start with it.
      const np = await b.eval(`
        await openNewProject();
        await new Promise(r => setTimeout(r, 200));
        const opts = [...document.querySelectorAll('#npAs input')].map(x => x.value);
        document.getElementById('npDlg').close();
        return opts`);
      t.check('a new project can start with Gemini', np.includes('gemini'), np);
      // A prompt can run in Gemini.
      const pr = await b.eval(`
        const out = {};
        const opened = []; const real = ChatUI.open; ChatUI.open = async o => { opened.push(o); };
        startWithPrompt(S.projects[0].cwd, { title: 'x', text: 'Write the lore', provider: 'gemini' });
        ChatUI.open = real;
        out.provider = opened[0].provider;
        out.runs = promptRuns({ provider: 'gemini' }).hint;
        openPromptEditor();
        await new Promise(r => setTimeout(r, 300));
        out.options = [...document.querySelector('.pd-p').options].map(o => o.value);
        document.getElementById('promptDlg').close();
        return out`);
      t.check('a prompt can run in Gemini', pr.provider === 'gemini' && /Gemini/.test(pr.runs) && pr.options.includes('gemini'), pr);
      await b.eval(`S.projects[0].sessions.shift(); return 1`);
    },
  },
  {
    name: 'one folder written two ways',
    async run(t) {
      const b = await t.open();
      await sleep(500);
      const r = await b.eval(`
        const p = S.projects[0], other = p.cwd.replace(/\\\\/g, '/');
        S.pins.delete(p.cwd); S.pins.add(other);
        S.view = 'folder'; S.folder = other;
        await loadSessions();
        return { pinned: S.pins.has(p.cwd), oldGone: !S.pins.has(other), folder: S.folder === p.cwd, view: S.view, other, cwd: p.cwd }`);
      t.check('a pin from when it was written the other way finds its project', r.pinned && r.oldGone, r);
      t.check('and so does the page you were on', r.folder && r.view === 'folder', r);
      await b.eval(`S.view = 'hub'; S.folder = null; return 1`);
      // Two different folders with one name say which is which.
      const names = await b.eval(`
        const a = S.projects[0], twin = { ...a, cwd: 'D:\\\\Elsewhere\\\\' + a.name, sessions: [], updated: Date.now() };
        S.projects.push(twin);
        await openNewChat({});
        await new Promise(r => setTimeout(r, 200));
        const rows = [...document.querySelectorAll('#ncList .nc-p')].filter(x => [a.cwd, twin.cwd].includes(x.dataset.ncP)).map(x => (x.querySelector('.nc-in') || {}).textContent);
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
        S.projects.pop();
        return rows`);
      t.check('New chat says which folder each of two same-named projects is in', names.length === 2 && names.every(Boolean) && names[0] !== names[1], names);
    },
  },
  {
    name: 'queue and race dialogs fit',
    async run(t) {
      const b = await t.open();
      await sleep(500);
      const long = 'A project with a very long name indeed, far longer than its box could ever hold';
      await b.eval(`S.projects[0].name = ${JSON.stringify(long)}; openRaceDialog(S.projects[0].cwd, 'race'); return 1`); await sleep(400);
      const race = await b.eval(`
        const box = id => document.getElementById(id).getBoundingClientRect();
        const picks = [...document.querySelectorAll('.rc-mode label')].map(x => { const r = x.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; });
        return { project: box('rcProject').right, who: box('rcWho').left, picks }`);
      t.check('Race: a long project name stays in its box', race.project <= race.who, race);
      t.check('Race or Split read on one line', race.picks.every(p => p.h < 44), race);
      await b.eval(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); openTaskDialog(S.projects[0].cwd, ''); return 1`); await sleep(400);
      const task = await b.eval(`const box = id => document.getElementById(id).getBoundingClientRect(); return { project: box('tkProject').right, who: box('tkWho').left }`);
      t.check('Queue a task: the same', task.project <= task.who, task);
      await b.eval(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); return 1`);
    },
  },
  {
    name: 'rules and tools for all three',
    async run(t) {
      const calls = [];
      const b = await t.open({ gemini: true, seen: (p, u, body) => calls.push([p, body]) });
      await sleep(500);
      await b.eval(`await openRules(S.projects[0].cwd); return 1`); await sleep(500);
      const inProject = await b.eval(`return { intro: document.querySelector('.rd-intro').textContent, save: document.querySelector('[data-rd="save"]').textContent, paths: document.querySelector('.rd-paths').innerHTML }`);
      t.check('in a project: Codex and Gemini read AGENTS.md', /Codex and Gemini read AGENTS\.md/.test(inProject.intro) && /all three work the same way/.test(inProject.intro), inProject);
      t.check('and a save goes to the two files', inProject.save === 'Save to both' && !/GEMINI/.test(inProject.paths), inProject);
      await b.eval(`document.getElementById('rdText').value = 'Be brief.'; document.querySelector('[data-rd="save"]').click(); return 1`); await sleep(400);
      t.check('it doesn’t ask to write GEMINI.md in a project', calls.some(([p, x]) => p === '/api/rules' && x.text === 'Be brief.' && x.to.join() === 'claude,codex'), calls.filter(([p]) => p === '/api/rules'));
      // The tools, side by side.
      await b.eval(`document.querySelector('[data-rdtab="tools"]').click(); return 1`); await sleep(300);
      const heads = await b.eval(`return [...document.querySelectorAll('.rd-tools th')].map(x => x.textContent)`);
      t.check('Gemini has a column', heads.join() === 'Tool,Claude,Codex,Gemini,', heads);
      const adds = await b.eval(`return [...document.querySelectorAll('.rd-tools tbody tr')][0].lastElementChild.textContent.trim()`);
      t.check('a tool can go to each that lacks it', /Add to/.test(adds) && /Add to Gemini/.test(adds), adds);
      const name = await b.eval(`const g = document.querySelector('[data-rd="copy"][data-to="gemini"]'); g.click(); return g.dataset.name`); await sleep(300);
      await b.eval(`const ok = [...document.querySelectorAll('#confirmDlg button')].find(x => /Add to Gemini/.test(x.textContent)); ok.click(); return 1`); await sleep(400);
      t.check('Add to Gemini asks it to add that tool', calls.some(([p, x]) => p === '/api/tools/copy' && x.name === name && x.to === 'gemini'), calls.filter(([p]) => p === '/api/tools/copy'));
      await b.eval(`document.querySelector('[data-rd="close"]').click(); return 1`); await sleep(200);
      // Every project: its own file.
      await b.eval(`await openRules(null); return 1`); await sleep(500);
      const every = await b.eval(`return { intro: document.querySelector('.rd-intro').textContent, save: document.querySelector('[data-rd="save"]').textContent }`);
      t.check('for every project: a file of its own, and Save to all three', /Gemini GEMINI\.md/.test(every.intro) && every.save === 'Save to all three', every);
      await b.eval(`document.getElementById('rdText').value = 'Everywhere.'; document.querySelector('[data-rd="save"]').click(); return 1`); await sleep(400);
      t.check('it saves to all three', calls.some(([p, x]) => p === '/api/rules' && x.text === 'Everywhere.' && x.to.join() === 'claude,codex,gemini'), calls.filter(([p]) => p === '/api/rules'));
      t.check('and then they say the same thing', /CLAUDE\.md, AGENTS\.md and GEMINI\.md say the same thing/.test(await b.eval(`return document.getElementById('rdState').textContent`)), await b.eval(`return document.getElementById('rdState').textContent`));
      await b.eval(`document.querySelector('[data-rd="close"]').click(); return 1`);
    },
  },
  {
    name: 'older messages join the live ones',
    // Codex's long turns: the live replay can begin in the middle of one, and the page of history has all of it.
    async run(t) {
      const b = await t.open();
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1300);
      const r = await b.eval(`
        const feed = document.getElementById('cFeed');
        const add = (mid, text) => { const p = part(feed, mid); p.querySelector('.final').innerHTML = '<p>' + text + '</p>'; return p; };
        const live = add('long:7', 'The end of a long turn'), split = add('msg:1', 'The later half');
        C.sessionId = C.sessionId || 'x';
        const real = historyPage;
        historyPage = async () => ({ start: 0, items: [
          { kind: 'assistant', mid: 'long:6', blocks: [{ type: 'text', text: 'Earlier in the turn' }] },
          { kind: 'assistant', mid: 'long:7', blocks: [{ type: 'text', text: 'The end of a long turn' }] },
          { kind: 'assistant', mid: 'msg:1', blocks: [{ type: 'text', text: 'The earlier half' }] },
        ] });
        try { await loadHistory(); } finally { historyPage = real; }
        const count = mid => feed.querySelectorAll('.part[data-mid="' + mid + '"]').length;
        return { six: count('long:6'), seven: count('long:7'), msg: count('msg:1'), stillLive: PARTS.get('long:7') === live, inFeed: feed.contains(live) }`);
      t.check('what’s already showing isn’t shown twice', r.seven === 1 && r.inFeed, r);
      t.check('and what isn’t comes in', r.six === 1, r);
      t.check('the same message with other words stays', r.msg === 2, r);
      t.check('a reply still being written carries on in its own place', r.stillLive, r);
      // Blocks with ids of their own, in both orders.
      const r2 = await b.eval(`
        const feed = document.getElementById('cFeed');
        const texts = mid => [...feed.querySelectorAll('.part[data-mid="' + mid + '"] .final > .md')].map(x => x.textContent.trim());
        const real = historyPage;
        const page = items => { historyPage = async () => ({ start: 0, items }); };
        // The page first, then the replay: the replay's own blocks join its earlier ones.
        page([{ kind: 'assistant', mid: 'cx:1', blocks: [{ type: 'text', id: 't1', text: 'One' }, { type: 'tool', id: 'u1', name: 'Edit', summary: 'a.txt', result: { text: 'done' } }] }]);
        try { await loadHistory(); } finally { historyPage = real; }
        liveRender = true;
        try {
          handle({ kind: 'delta', mid: 'cx:1', itemId: 't1', text: 'One again' });
          renderItem(feed, { kind: 'assistant', mid: 'cx:1', blocks: [{ type: 'text', id: 't1', text: 'One' }, { type: 'tool', id: 'u1', name: 'Edit', summary: 'a.txt' }, { type: 'text', id: 't2', text: 'Two' }] }, true);
        } finally { liveRender = false; }
        const first = { parts: feed.querySelectorAll('.part[data-mid="cx:1"]').length, texts: texts('cx:1'), tools: feed.querySelectorAll('.tool[data-tool-id="u1"]').length, kept: !!feed.querySelector('.tool[data-tool-id="u1"] .t-st.ok'), delta: C.liveText['cx:1'] || null };
        // The replay first, then the page: the earlier blocks come in, and what's showing isn't repeated.
        liveRender = true;
        try { renderItem(feed, { kind: 'assistant', mid: 'cx:2', blocks: [{ type: 'text', id: 't4', text: 'Four' }] }, true); } finally { liveRender = false; }
        const livePart = feed.querySelector('.part[data-mid="cx:2"]');
        page([{ kind: 'assistant', mid: 'cx:2', blocks: [{ type: 'text', id: 't3', text: 'Three' }, { type: 'text', id: 't4', text: 'Four' }] }]);
        try { await loadHistory(); } finally { historyPage = real; }
        const all = [...feed.querySelectorAll('.part[data-mid="cx:2"] .final > .md')].map(x => x.textContent.trim());
        const second = { all, stillLive: PARTS.get('cx:2') === livePart, inOrder: !!(feed.querySelector('[data-bid="t3"]').compareDocumentPosition(feed.querySelector('[data-bid="t4"]')) & Node.DOCUMENT_POSITION_FOLLOWING) };
        // Nothing but what's showing: the page adds nothing.
        const partsBefore = feed.querySelectorAll('.part[data-mid="cx:2"]').length;
        page([{ kind: 'assistant', mid: 'cx:2', blocks: [{ type: 'text', id: 't4', text: 'Four' }] }]);
        try { await loadHistory(); } finally { historyPage = real; }
        // The same id, new words: it's the same block, up to date.
        liveRender = true;
        try { renderItem(feed, { kind: 'assistant', mid: 'cx:2', blocks: [{ type: 'text', id: 't4', text: 'Four, revised' }] }, true); } finally { liveRender = false; }
        return { first, second, sameParts: feed.querySelectorAll('.part[data-mid="cx:2"]').length === partsBefore, updated: feed.querySelector('[data-bid="t4"]').textContent.trim() }`);
      t.check('the page first: one part, each block once, its earlier blocks kept', r2.first.parts === 1 && r2.first.texts.join() === 'One,Two' && r2.first.tools === 1, r2.first);
      t.check('a step keeps what it already showed', r2.first.kept, r2.first);
      t.check('and what the page already had isn’t typed out again', !r2.first.delta, r2.first);
      t.check('the replay first: the earlier block comes in before it, once', r2.second.all.join() === 'Three,Four' && r2.second.inOrder, r2.second);
      t.check('and a reply still coming carries on in its own place', r2.second.stillLive, r2.second);
      t.check('a page with nothing new adds nothing', r2.sameParts, r2);
      t.check('the same block with new words is brought up to date', r2.updated === 'Four, revised', r2.updated);
      // The message that started a long turn: in the page and in the replay. By ids alone.
      const msg = await b.eval(`
        const feed = document.getElementById('cFeed');
        const real = historyPage;
        const count = text => [...feed.querySelectorAll('.umsg')].filter(x => x.textContent.includes(text)).length;
        const page = items => { historyPage = async () => ({ start: 0, items }); };
        const load = async items => { page(items); try { await loadHistory(); } finally { historyPage = real; } };
        const live = ev => { liveRender = true; try { renderItem(feed, ev, true); } finally { liveRender = false; } };
        // The page first, then the replay.
        await load([{ kind: 'user', turnId: 'T1', itemId: 'u1', userBatch: 'T1:start', text: 'Paint the tavern', at: new Date().toISOString() }]);
        live({ kind: 'user', turnId: 'T1', userBatch: 'T1:start', text: 'Paint the tavern', seq: 901 });
        const pageFirst = count('Paint the tavern');
        // The replay first, then the page.
        live({ kind: 'user', turnId: 'T2', userBatch: 'T2:start', text: 'Paint the forge', seq: 902 });
        await load([{ kind: 'user', turnId: 'T2', itemId: 'u2', userBatch: 'T2:start', text: 'Paint the forge' }]);
        const replayFirst = count('Paint the forge');
        // On screen before it had its turn, then told, then the page.
        live({ kind: 'user', text: 'Paint the mill', seq: 903 });
        handle({ kind: 'user_turn', userSeq: 903, turnId: 'T3', userBatch: 'T3:start', seq: 100000 });
        await load([{ kind: 'user', turnId: 'T3', itemId: 'u3', userBatch: 'T3:start', text: 'Paint the mill' }]);
        const told = count('Paint the mill');
        // The page, while it's still waiting to be told.
        live({ kind: 'user', text: 'Paint the well', seq: 910 });
        await load([{ kind: 'user', turnId: 'T10', itemId: 'u11', userBatch: 'T10:start', text: 'Paint the well' }]);
        handle({ kind: 'user_turn', userSeq: 910, turnId: 'T10', userBatch: 'T10:start', seq: 100001 });
        const ackLate = count('Paint the well');
        // The same page twice.
        const again = [{ kind: 'user', turnId: 'T4', itemId: 'u4', userBatch: 'T4:start', text: 'Paint the barn' }, { kind: 'user', turnId: 'T4', itemId: 'u5', text: 'Red, please' }, { kind: 'user', turnId: 'T5', itemId: 'u6', userBatch: 'T5:start', text: 'Red, please' }];
        await load(again); await load(again);
        // Queued together: two bubbles live, one message in history. Either order, nothing lost.
        live({ kind: 'user', turnId: 'T6', userBatch: 'T6:start', text: 'One thing', seq: 904 });
        live({ kind: 'user', turnId: 'T6', userBatch: 'T6:start', text: 'Another thing', seq: 905 });
        await load([{ kind: 'user', turnId: 'T6', itemId: 'u7', userBatch: 'T6:start', text: 'One thing\\n\\nAnother thing' }]);
        const joined = [...feed.querySelectorAll('.umsg[data-batch$=":T6:start"]')].map(x => x.querySelector('.utext').textContent);
        await load([{ kind: 'user', turnId: 'T7', itemId: 'u8', userBatch: 'T7:start', text: 'Third thing\\n\\nFourth thing' }]);
        live({ kind: 'user', turnId: 'T7', userBatch: 'T7:start', text: 'Third thing', seq: 906 });
        live({ kind: 'user', turnId: 'T7', userBatch: 'T7:start', text: 'Fourth thing', seq: 907 });
        const joined2 = feed.querySelectorAll('.umsg[data-batch$=":T7:start"]').length;
        // What's said again as a steer is its own message, whatever it looks like: nothing real is hidden.
        await load([{ kind: 'user', turnId: 'T8', itemId: 'u9', userBatch: 'T8:start', text: 'Please try again carefully' }, { kind: 'user', turnId: 'T8', itemId: 'u10', text: 'try again' }]);
        live({ kind: 'user', turnId: 'T8', text: 'try again', seq: 908 });
        const steers = count('try again');
        // Two live sends with the same words: both yours.
        live({ kind: 'user', turnId: 'T9', text: 'Again and again', seq: 909 });
        live({ kind: 'user', turnId: 'T9', text: 'Again and again', seq: 911 });
        const twice = count('Again and again');
        // History clipped a long first message, and with it what was queued after: what's live stays, in any order.
        live({ kind: 'user', turnId: 'T12', userBatch: 'T12:start', text: 'Short second send', seq: 912 });
        await load([{ kind: 'user', turnId: 'T12', itemId: 'u13', userBatch: 'T12:start', text: 'A long first message, clipped', truncated: true }]);
        const clipLiveFirst = count('Short second send');
        await load([{ kind: 'user', turnId: 'T13', itemId: 'u14', userBatch: 'T13:start', text: 'Another long one, clipped', truncated: true }]);
        live({ kind: 'user', turnId: 'T13', userBatch: 'T13:start', text: 'Short third send', seq: 913 });
        live({ kind: 'user', text: 'Short fourth send', seq: 914 });
        handle({ kind: 'user_turn', userSeq: 914, turnId: 'T13', userBatch: 'T13:start', seq: 100002 });
        const clipPageFirst = count('Short third send') + count('Short fourth send');
        return { pageFirst, replayFirst, told, ackLate, steer: count('Paint the barn'), same: count('Red, please'), joined, joined2, steers, twice, clipLiveFirst, clipPageFirst }`);
      t.check('the message that began a long turn shows once, the page first', msg.pageFirst === 1, msg);
      t.check('or the replay first', msg.replayFirst === 1, msg);
      t.check('or when it only got its turn after it was on screen', msg.told === 1, msg);
      t.check('told its turn after history showed it: once', msg.ackLate === 1, msg);
      t.check('the same page twice adds nothing, and the same words in two messages stay two', msg.steer === 1 && msg.same === 2, msg);
      t.check('messages queued together show as history has them, nothing lost, in either order', msg.joined.length === 1 && /One thing\s*Another thing/.test(msg.joined[0]) && msg.joined2 === 1, msg);
      t.check('a steer that repeats itself is its own message: nothing real is hidden', msg.steers === 3, msg);
      t.check('two live sends with the same words are both shown', msg.twice === 2, msg);
      t.check('what’s queued after a message history clipped isn’t lost', msg.clipLiveFirst === 1 && msg.clipPageFirst === 2, msg);
      // A partner that's been open a long time: what's before its live part still comes from its history.
      const merged = await b.eval(`
        const was = C.comps.gemini;
        C.comps.gemini = { startedAt: '2026-10-31T10:00:00.000Z', bufferFrom: '2026-10-31T10:00:09.000Z' };
        const items = [{ kind: 'user', text: 'early', at: '2026-10-31T10:00:05.000Z' }, { kind: 'assistant', mid: 'g:1', blocks: [], at: '2026-10-31T10:00:06.000Z' }, { kind: 'user', text: 'live', at: '2026-10-31T10:00:10.000Z' }];
        const out = mergeHelper([], items, 'gemini').map(r => r.it.text || r.it.mid);
        C.comps.codex = C.comps.codex || null;
        const wasCx = C.comps.codex;
        C.comps.codex = { startedAt: '2026-10-31T10:00:00.000Z', bufferFrom: '2026-10-31T10:00:09.500Z' };
        // (Codex keeps a turn's time to the second: moved along for where it goes, not for whether it's in.)
        const cx = mergeHelper([], [{ kind: 'user', text: 'straddles', at: '2026-10-31T10:00:09.000Z' }], 'codex').map(r => r.it.text);
        C.comps.gemini = was; C.comps.codex = wasCx;
        return { out, cx }`);
      t.check('a partner’s messages from before its live part stay in', merged.out.join() === 'early,g:1', merged);
      t.check('a Codex turn that straddles where it begins isn’t lost', merged.cx.join() === 'straddles', merged);
      // A picture: the page has it finished, the replay still has it being drawn.
      const pic = await b.eval(`
        const feed = document.getElementById('cFeed');
        const done = { type: 'image', id: 'g1', status: 'done', path: 'C:/x/a.png', prompt: 'A cat' };
        renderItem(feed, { kind: 'assistant', mid: 'cx:3', blocks: [done] }, false);
        liveRender = true;
        try { renderItem(feed, { kind: 'assistant', mid: 'cx:3', blocks: [{ type: 'image', id: 'g1', status: 'generating', prompt: 'A cat' }] }, true); } finally { liveRender = false; }
        const held = !!feed.querySelector('.gen[data-gid="g1"] img');
        liveRender = true;
        try { renderItem(feed, { kind: 'assistant', mid: 'cx:3', blocks: [{ ...done, path: 'C:/x/b.png' }] }, true); } finally { liveRender = false; }
        return { held, n: feed.querySelectorAll('.gen[data-gid="g1"]').length, now: feed.querySelector('.gen[data-gid="g1"] img').src }`);
      t.check('a finished picture isn’t taken back to being drawn', pic.held && pic.n === 1, pic);
      t.check('and a later final version still takes its place', /b\.png/.test(decodeURIComponent(pic.now)), pic);
    },
  },
  {
    name: 'readable everywhere',
    // The hub has its own audit below. This is the rest: a chat, its crew, dialogs, menus, the viewer.
    async run(t) {
      const b = await t.open({ gemini: true });
      await sleep(600);
      const audit = TEXT_AUDIT.replace(`'.bar, #nav, #page'`, `'.chat, dialog[open], #menu, #acctPop, #cTogether, .palette'`);
      const bard = demo.ID['s-bard'];
      const tidy = `for (const d of document.querySelectorAll('dialog[open]')) d.close(); try { closeMenu(); closeAcctPop(); closePalette(); } catch {}`;
      const places = {
        'a chat': `await ChatUI.open({ sessionId: ${JSON.stringify(bard)} })`,
        'its menu': `await ChatUI.open({ sessionId: ${JSON.stringify(bard)} }); await new Promise(r => setTimeout(r, 900)); document.querySelector('[data-c="more"]').click()`,
        'who works together': `await ChatUI.open({ sessionId: ${JSON.stringify(bard)} }); await new Promise(r => setTimeout(r, 900)); openTogether()`,
        'keep it working': `await ChatUI.open({ sessionId: ${JSON.stringify(bard)} }); await new Promise(r => setTimeout(r, 900)); openKeepDialog({ key: 'k-bard', title: 'A chat' })`,
        'new chat': `if (window.ChatUI && ChatUI.isOpen()) ChatUI.close(); await openNewChat({})`,
        'setup': `await openSetup('health')`,
        'accounts': `openAcctPop()`,
        'jump anywhere': `await openPalette()`,
      };
      for (const [theme, mode] of [['crimson', 'dark'], ['sapphire', 'light']]) {
        await b.eval(`Look.set({ theme: '${theme}', mode: '${mode}' }); return 1`); await sleep(400);
        for (const [name, code] of Object.entries(places)) {
          await b.eval(`${tidy}; ${code}; return 1`); await sleep(name === 'a chat' ? 900 : 500);
          const rows = await b.eval(audit);
          const tiny = rows.filter(r => r.size < 11 && !/caret/.test(r.cls));
          const faint = rows.filter(r => !r.disabled && r.ratio < r.needed);
          t.check(`${theme} ${mode}, ${name}: no text under 11 pixels`, !tiny.length, tiny.slice(0, 5));
          t.check(`${theme} ${mode}, ${name}: text stands out`, rows.length > 3 && !faint.length, { n: rows.length, faint: faint.slice(0, 6), tiny });
        }
      }
      await b.eval(`${tidy}; Look.reset(); return 1`);
      // Where the keyboard is, in a dialog.
      await b.eval(`await openSetup('health'); return 1`); await sleep(500);
      await b.eval(`document.querySelector('#setupBody .toggle input[type=checkbox]').focus(); return 1`);
      await b.key('Tab', 'Tab', 9); await sleep(120);
      const ring = await b.eval(`const el = document.activeElement, s = getComputedStyle(el); return { on: el.type, style: s.outlineStyle, width: parseFloat(s.outlineWidth) }`);
      t.check('a checkbox in a dialog shows when it has the keyboard', ring.on === 'checkbox' && ring.style !== 'none' && ring.width >= 2, ring);
      await b.eval(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); return 1`);
    },
  },
  {
    name: 'hub layout',
    async run(t) {
      const calls = [];
      const b = await t.open({ gemini: true, seen: (p, u, body) => calls.push([p, body]) });
      await sleep(800);
      // The sidebar.
      const nav = await b.eval(`return {
        seal: !!document.getElementById('seal'),
        heads: [...document.querySelectorAll('#nav .nav-h')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()),
        open: [...document.querySelectorAll('[data-navopen]')].map(x => ({ t: x.querySelector('.nc-t').textContent, s: x.querySelector('small').textContent, dot: !!x.querySelector('.nav-dot') })),
        cwds: [...document.querySelectorAll('.nav-proj')].map(x => x.dataset.cwd),
        seg: [...document.querySelectorAll('[data-navprov]')].map(x => x.textContent),
      }`);
      t.check('the account isn’t said twice: no seal in the sidebar', !nav.seal, nav);
      t.check('what’s open is listed, and says in words what each is doing', nav.open.length >= 2 && nav.open.some(x => /Needs your OK/.test(x.s)) && nav.open.some(x => /^Working/.test(x.s)) && nav.open.every(x => x.dot), nav.open);
      t.check('every project once, not once per assistant', new Set(nav.cwds).size === nav.cwds.length && nav.cwds.length >= 3, nav.cwds);
      t.check('and buttons narrow it to one assistant’s', ['All', 'Claude', 'Codex', 'Gemini'].every(x => nav.seg.includes(x)), nav.seg);
      const activeId = await b.eval(`return document.querySelector('[data-navopen]').dataset.navopen`);
      const listed = await b.eval(`const ids = [...document.querySelectorAll('[data-navchat]')].map(x => x.dataset.navchat.toLowerCase()); const open = S.activity.map(x => String(x.sessionId || '').toLowerCase()); return { dup: ids.filter(i => open.includes(i)), twice: ids.filter((i, n) => ids.indexOf(i) !== n) }`);
      t.check('a chat is listed once: open chats aren’t repeated under Recent', !listed.dup.length && !listed.twice.length, listed);
      await b.clickOn(`[data-navopen="${activeId}"]`); await sleep(1500);
      t.check('clicking an open chat opens it', await b.eval(`return ChatUI.isOpen()`));
      await b.eval(`ChatUI.close(); go('hub'); return 1`); await sleep(700);

      // Pinned: a chat that isn't open has one short row.
      await b.eval(`const id = S.projects.flatMap(p => p.sessions).find(s => !S.activity.some(x => x.sessionId === s.id)).id; toggleFav(id); window._pin = id; return 1`); await sleep(300);
      const pin = await b.eval(`const r = document.querySelector('.nav-h.pinned ~ .nav-chat.one[data-navchat="' + _pin + '"]'); return r && { name: r.textContent.replace(/\\s+/g, ' ').trim(), small: !!r.querySelector('small') }`);
      t.check('a pinned chat that isn’t open has one short row', pin && !pin.small, pin);
      await b.eval(`toggleFav(_pin); return 1`); await sleep(200);

      // A narrow list with a filter when there are many projects.
      const many = await b.eval(`const base = S.projects[0], extra = Array.from({ length: 30 }, (_, i) => ({ ...base, name: 'Old project ' + i, cwd: 'C:\\\\Old\\\\p' + i, exists: i % 7 !== 0, updated: Date.now() - (40 + i) * 864e5, sessions: [{ ...base.sessions[0], id: 'old-' + i, updated: Date.now() - (40 + i) * 864e5 }], done: [] }));
        S.projects = [...S.projects, ...extra]; sortDone(); renderAll(); await new Promise(r => setTimeout(r, 300));
        const short = document.querySelectorAll('.nav-proj').length, more = [...document.querySelectorAll('.nav-more[data-fold="projects-all"]')].map(x => x.textContent.trim())[0];
        const tiles = document.querySelectorAll('#atlas > [data-k]').length;
        return { short, more, tiles }`);
      t.check('only the projects in use lately until you ask for all of them', many.short <= 8 && /^\+?\s*All \d+ projects$/.test(many.more || ''), many);
      t.check('and six tiles on the hub, however many projects', many.tiles === 6, many);
      await b.clickOn('.nav-more[data-fold="projects-all"]'); await sleep(250);
      const wide = await b.eval(`return { n: document.querySelectorAll('.nav-proj').length, box: !!document.getElementById('navQ'), goneHead: !!document.querySelector('.nav-sub-h'), lastGone: /no longer exists/.test([...document.querySelectorAll('.nav-proj')].at(-1).title) }`);
      t.check('all of them: a box to filter them, and folders that are gone last', wide.n > 30 && wide.box && wide.goneHead && wide.lastGone, wide);
      await b.eval(`document.getElementById('navQ').focus(); return 1`);
      await b.send('Input.insertText', { text: 'project 2' }); await sleep(250);
      const typed = await b.eval(`return { val: document.getElementById('navQ').value, focus: document.activeElement.id, names: [...document.querySelectorAll('.nav-proj .ni-t')].map(x => x.textContent) }`);
      t.check('filtering keeps your place in the box', typed.val === 'project 2' && typed.focus === 'navQ' && typed.names.length && typed.names.every(x => /project 2/.test(x)), typed);
      await b.esc(); await sleep(200);
      t.check('Esc clears it', await b.eval(`return document.getElementById('navQ').value === '' && document.activeElement.id === 'navQ'`));
      await b.eval(`document.querySelector('.nav-more[data-fold="projects-all"]').click(); return 1`); await sleep(150);

      // Every project on the hub, under the tiles.
      await b.clickOn('[data-proj-all]'); await sleep(300);
      const pa = await b.eval(`return { rows: document.querySelectorAll('#projList .pa-row').length, focus: document.activeElement.id, last: [...document.querySelectorAll('#projList .pa-row')].at(-1).classList.contains('gone') }`);
      t.check('every project is listed under the tiles, the box ready, gone folders last', pa.rows > 30 && pa.focus === 'projQ' && pa.last, pa);
      await b.send('Input.insertText', { text: 'old project 11' }); await sleep(250);
      t.check('and it filters', (await b.eval(`return [...document.querySelectorAll('#projList .pa-n')].map(x => x.textContent).join()`)) === 'Old project 11');
      await b.eval(`const r = document.querySelector('#projList .pa-row'); const e = new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }); r.querySelector('.pa-open').dispatchEvent(e); return 1`); await sleep(250);
      t.check('right-click on a row has the project’s menu', /Open Old project 11/.test(await b.eval(`return document.getElementById('menu').textContent`)));
      await b.esc(); await sleep(150);
      await b.eval(`document.querySelector('[data-proj-all]').click(); location.reload(); return 1`).catch(() => {}); await sleep(3500);

      // The short header, the jump bar.
      const hero = await b.eval(`const h = document.querySelector('.hero').getBoundingClientRect(); return { h: h.height, stamp: getComputedStyle(document.querySelector('.hero .stamp') || document.body).display, say: document.querySelector('.hero-say') ? getComputedStyle(document.querySelector('.hero-say')).display : 'none' }`);
      t.check('a short header', hero.h < 130, hero);
      t.check('it doesn’t repeat the account or its usage when all is well', hero.say === 'none', hero);
      const warn = await b.eval(`const a = current(), u = S.usage[a.id]; const was = JSON.stringify(u); u.data.fiveHour.used = 100; renderLive(true); await new Promise(r => setTimeout(r, 200)); const el = document.querySelector('.hero-say'); const r = { cls: el.className, shown: getComputedStyle(el).display !== 'none', text: el.textContent }; S.usage[a.id] = JSON.parse(was); renderLive(true); return r`);
      t.check('it does when something’s wrong: out of usage', warn.shown && /reached its five-hour limit/.test(warn.text), warn);
      const jump = await b.eval(`return [...document.querySelectorAll('#hubJump .hj')].map(x => x.dataset.jump)`);
      t.check('a bar of the page’s sections', ['secAwait', 'secWork', 'secRecent', 'secAccounts', 'secWorlds'].every(x => jump.includes(x)), jump);
      await b.clickOn('[data-jump="secAccounts"]'); await sleep(900);
      const at = await b.eval(`const r = document.getElementById('secAccounts').getBoundingClientRect(), bar = document.getElementById('hubJump').getBoundingClientRect(); return { top: r.top, under: bar.bottom, stuck: bar.top }`);
      t.check('it stays in view and takes you to a section, not under itself', at.top >= at.under - 2 && at.top < 420, at);
      // Folding.
      await b.eval(`window.scrollTo(0, 0); return 1`); await sleep(150);
      await b.clickOn('[data-secfold="recent"]'); await sleep(200);
      t.check('a section folds on its title', await b.eval(`const s = document.getElementById('secRecent'); return s.classList.contains('folded') && !document.getElementById('recentList').offsetParent && document.querySelector('[data-secfold="recent"]').getAttribute('aria-expanded') === 'false'`));
      await b.eval(`location.reload(); return 1`).catch(() => {}); await sleep(3500);
      t.check('and stays folded', await b.eval(`return document.getElementById('secRecent').classList.contains('folded')`));
      await b.clickOn('[data-jump="secRecent"]'); await sleep(700);
      t.check('the bar opens a folded section', await b.eval(`return !document.getElementById('secRecent').classList.contains('folded') && !!document.getElementById('recentList').offsetParent`));

      // Accounts.
      const ac = await b.eval(`return { cards: document.querySelectorAll('#dials .acct').length, gem: [...document.querySelectorAll('#dials .acct h3')].some(x => /Gemini/.test(x.textContent)), dials: document.querySelectorAll('#dials .dial').length, wins: [...document.querySelectorAll('#dials .acct')][0].querySelectorAll('.aw').length, use: !!document.querySelector('#dials [data-act="use"]'), resets: /resets/.test(document.querySelector('#dials .acct').textContent) }`);
      t.check('each account: its windows and reset times, at a glance', ac.cards >= 3 && ac.wins === 2 && ac.resets, ac);
      t.check('Gemini too', ac.gem, ac);
      t.check('and no dials until you ask', ac.dials === 0, ac);
      await b.clickOn('#dials [data-acct-open]'); await sleep(400);
      const open = await b.eval(`const c = document.querySelector('#dials .acct'); return { dial: !!c.querySelector('.dial'), sign: !!c.querySelector('[data-act="signin"]'), focus: !!document.activeElement.closest('[data-acct-open]'), exp: c.querySelector('[data-acct-open]').getAttribute('aria-expanded') }`);
      t.check('the details have the dial and the sign-in, and focus stays put', open.dial && open.sign && open.focus && open.exp === 'true', open);
      await b.eval(`document.querySelector('#dials [data-acct-open]').click(); return 1`); await sleep(200);
      await b.clickOn('#dials [data-act="use"]'); await sleep(500);
      t.check('Use this switches which account new chats open as', await b.eval(`return !!document.querySelector('#dials .acct.current') && S.acct === (document.querySelector('#dials .acct.current').dataset.acctCard)`));

      // New chat.
      await b.eval(`window.scrollTo(0, 0); document.activeElement.blur(); return 1`);
      await b.clickOn('#newChat'); await sleep(300);
      const nc = await b.eval(`const d = document.getElementById('ncDlg'); return { open: d.open, focus: document.activeElement.id, rows: d.querySelectorAll('.nc-p').length, sel: !!d.querySelector('.nc-p[aria-selected="true"]'), who: [...d.querySelectorAll('[data-nc-who]')].map(x => x.textContent), as: !document.getElementById('ncAsWrap').hidden }`);
      t.check('New chat opens with the box ready, projects listed, one picked', nc.open && nc.focus === 'ncQ' && nc.rows >= 3 && nc.sel, nc);
      t.check('and who with, and as which account', nc.who.join() === 'Claude,Codex,Gemini' && nc.as, nc);
      await b.send('Input.insertText', { text: 'tide' }); await sleep(150);
      await b.eval(`window._open = []; window._realOpen = ChatUI.open; ChatUI.open = o => { _open.push(o); return Promise.resolve(); }; return 1`);
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
      const started = await b.eval(`return { open: document.getElementById('ncDlg').open, calls: _open }`);
      t.check('Enter starts it in the project you filtered to', !started.open && started.calls.length === 1 && /Tidecaller/.test(started.calls[0].cwd) && started.calls[0].mode === 'new' && !started.calls[0].provider, started);
      await b.key('n', 'KeyN', 78); await sleep(250);
      t.check('N opens it from anywhere', await b.eval(`return document.getElementById('ncDlg').open`));
      await b.eval(`_open.length = 0; document.querySelector('[data-nc-who="codex"]').click(); document.getElementById('ncText').value = 'Make the icons'; return 1`);
      await b.clickOn('#ncGo'); await sleep(250);
      const cx = await b.eval(`return _open[0]`);
      t.check('it can start with Codex, and a first message waiting in the box', cx && cx.provider === 'codex' && cx.initialText === 'Make the icons', cx);
      await b.eval(`ChatUI.open = _realOpen; document.querySelector('form.qr textarea').focus(); return 1`);
      t.check('N in a text box is just a letter', await (async () => { await b.key('n', 'KeyN', 78); await sleep(150); return !(await b.eval(`return document.getElementById('ncDlg').open`)); })());
      await b.eval(`document.activeElement.blur(); return 1`);
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 1 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 1 }); await sleep(1400);
      t.check('Alt+1 opens the first open chat', await b.eval(`return ChatUI.isOpen()`));
      await b.eval(`ChatUI.close(); return 1`); await sleep(300);

      // Imperial stays as Ryan made it.
      const saga = await b.eval(`Look.set({ theme: 'imperial' }); await new Promise(r => setTimeout(r, 500)); return { seal: !!document.getElementById('seal'), jump: !!document.getElementById('hubJump'), dials: !!document.querySelector('#dials.dials .dial-card'), hub2: document.documentElement.classList.contains('hub2'), newChat: getComputedStyle(document.getElementById('newChat')).display, begin: [...document.querySelectorAll('#nav .nav-h')].map(x => x.textContent.trim())[0], tile: !!document.querySelector('.world-new'), order: [...document.querySelectorAll('#page > section, #page > div')].map(x => x.id).filter(Boolean).slice(0, 4) }`);
      t.check('Imperial keeps its seal, sidebar, dials and page', saga.seal && !saga.jump && saga.dials && !saga.hub2 && saga.newChat === 'none' && saga.begin === 'Command' && saga.tile && saga.order[0] === 'welcomeSlot', saga);
      await b.eval(`Look.reset(); return 1`); await sleep(300);
    },
  },
  {
    name: 'split view',
    // A second chat beside the first: the whole chat, in a frame. And one live connection for each window.
    async run(t) {
      const b = await t.open();
      await sleep(600);
      const id = demo.ID['s-bard'], other = demo.ID['s-brawl'], third = demo.ID['s-notes'];
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`); await sleep(2200);
      t.check('nothing beside it to begin with', await b.eval(`return !document.getElementById('chat').classList.contains('split') && document.getElementById('cSplit').hidden`));
      await b.clickOn('[data-c="split"]'); await sleep(300);
      const offered = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('the ◫ button offers the other chats', offered.some(x => /Tavern brawl/.test(x)) && !offered.some(x => /^.?Balance pass/.test(x)), offered);
      await b.esc(); await sleep(150);
      await b.eval(`openBeside({ sessionId: ${JSON.stringify(other)} }); return 1`); await sleep(3500);
      const on = await b.eval(`const f = document.querySelector('#cSplit iframe'), main = document.querySelector('#chat .c-main').getBoundingClientRect(), side = f.getBoundingClientRect(); const d = f.contentDocument; return { split: document.getElementById('chat').classList.contains('split'), url: f.getAttribute('src'), sideW: side.width, mainW: main.width, solo: d.body.classList.contains('solo') && d.body.classList.contains('pane'), bar: getComputedStyle(d.querySelector('.bar')).display, title: d.getElementById('cTitle')?.textContent, box: !!d.getElementById('cText')?.offsetParent, close: d.querySelector('[data-c="paneclose"]') && !d.querySelector('[data-c="paneclose"]').hidden, beside: !!document.querySelector('#cRailList .ri.beside, #cPinList .ri.beside') }`);
      t.check('it opens beside, with room for both', on.split && on.sideW > 400 && on.mainW > 400 && /pane=1/.test(on.url), on);
      t.check('the whole chat: its own message box, none of the app around it', on.solo && on.bar === 'none' && on.box && on.close, on);
      await t.shot(b, 'two');
      // The divider.
      const before = await b.eval(`return document.querySelector('#cSplit iframe').getBoundingClientRect().width`);
      await b.eval(`document.getElementById('cSplitBar').focus(); return 1`);
      await b.key('ArrowLeft', 'ArrowLeft', 37); await b.key('ArrowLeft', 'ArrowLeft', 37); await sleep(200);
      t.check('the divider moves with the keys', (await b.eval(`return document.querySelector('#cSplit iframe').getBoundingClientRect().width`)) > before + 20);
      // Only room for one more on this screen: the next takes its place.
      await b.eval(`openBeside({ sessionId: ${JSON.stringify(third)} }); return 1`); await sleep(800);
      t.check('one beside it on this screen: the next takes its place', (await b.eval(`return document.querySelectorAll('#cSplit iframe').length`)) === 1);
      // It stays while you go to the hub and back.
      await b.eval(`ChatUI.close(); return 1`); await sleep(500);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`); await sleep(1500);
      t.check('it’s still there after a look at the hub', await b.eval(`return document.querySelectorAll('#cSplit iframe').length === 1 && document.getElementById('chat').classList.contains('split')`));
      // Closing from inside the frame.
      await b.eval(`const f = document.querySelector('#cSplit iframe'); f.contentDocument.querySelector('[data-c="paneclose"]').click(); await new Promise(r => setTimeout(r, 300)); return 1`);
      t.check('✕ in the frame closes that side, and this chat has the room again', await b.eval(`return !document.querySelector('#cSplit iframe') && !document.getElementById('chat').classList.contains('split')`));
      // A popped-out chat or a side of a split doesn't ring the bell as well.
      await b.eval(`openBeside({ sessionId: ${JSON.stringify(other)} }); return 1`); await sleep(2500);
      const bell = await b.eval(`const w = document.querySelector('#cSplit iframe').contentWindow; let rang = 0; w.chime = () => { rang++; }; const sc = w.document.createElement('script'); sc.textContent = 'Local.sound = true'; w.document.head.appendChild(sc); w.notify('needs', { sessionId: 'x', title: 't' }); return { rang }`);
      t.check('only the main window rings the bell', bell.rang === 0, bell);
      // Too narrow for two.
      await b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
      t.check('in a narrow window, the frame steps aside', await b.eval(`return !document.getElementById('chat').classList.contains('split') && document.getElementById('cSplit').hidden`));
      await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(400);
      t.check('and comes back with the room', await b.eval(`return document.getElementById('chat').classList.contains('split')`));
    },
  },
  {
    name: 'a link a chat only names',
    // "x-deploy.zip, in Documents\My Site": a link that opens the right place, not one that goes nowhere.
    async run(t) {
      const urls = [];
      const b = await t.open({ gemini: true, seen: (p, u) => { if (p === '/api/file') urls.push(u); } });
      await sleep(600);
      const judged = await b.eval(`const bs = String.fromCharCode(92); return {
        folder: looksLikePath('Documents' + bs + 'Rebirth World Tempting'), slash: looksLikePath('OneDrive/My Site/'), name: looksLikePath('site-deploy.zip'), drive: looksLikePath('C:' + bs),
        part: looksLikePath('-deploy.zip'), ext: looksLikePath('.zip'), scheme: looksLikePath('file:///'), words: looksLikePath('documents are nice'), cmd: looksLikePath('Documents/run --fast') }`);
      t.check('a shortened folder of yours is a link, and so are a name and a drive', judged.folder && judged.slash && judged.name && judged.drive, judged);
      t.check('part of a name, or file:/// by itself, isn’t', !judged.part && !judged.ext && !judged.scheme && !judged.words && !judged.cmd, judged);
      await b.eval(`await ChatUI.open({ sessionId: S.projects.flatMap(p => p.sessions).find(c => /bard/.test(c.title)).id }); return 1`);
      await sleep(900);
      await b.eval(`const d = document.createElement('div'); d.id = 'nearTest'; d.innerHTML = inline('Upload \`site-deploy.zip\`, in \`Documents/Rebirth World Tempting\`.'); document.getElementById('cFeed').append(d); return 1`);
      await b.eval(`document.querySelector('#nearTest .flink').click(); return 1`); await sleep(400);
      const asked = new URL(urls.at(-1), 'http://x/').searchParams;
      t.check('clicking the name says which folder the reply pointed to', asked.get('path') === 'site-deploy.zip' && asked.getAll('near')[0] === 'Documents/Rebirth World Tempting', [...asked]);
      // More than one: yours to choose.
      const chosen = await b.eval(`
        const real = api;
        api = async (u, ...rest) => { const q = new URL(String(u), location.href).searchParams; return String(u).startsWith('/api/file?') ? (q.get('path') === 'both.md' ? { kind: 'choices', path: 'both.md', matches: ['C:/a/both.md', 'C:/b/both.md'] } : { kind: 'text', path: q.get('path'), name: 'both.md', dir: 'C:/b', text: 'Chosen', lang: 'markdown', markdown: true }) : real(u, ...rest); };
        await Viewer.open({ path: 'both.md' });
        const offered = [...document.querySelectorAll('#vBody [data-v="go"]')].map(x => x.dataset.path), title = document.getElementById('vTitle').textContent;
        document.querySelector('#vBody [data-v="go"][data-path="C:/b/both.md"]').click();
        await new Promise(r => setTimeout(r, 300));
        api = real;
        return { offered, title, shown: document.getElementById('vBody').innerText };`);
      t.check('two of that name: it offers both, by where they are', chosen.offered.join() === 'C:/a/both.md,C:/b/both.md' && chosen.title === 'both.md', chosen);
      t.check('and opens the one you pick', /Chosen/.test(chosen.shown), chosen);
    },
  },
  {
    name: 'lite: a held message comes back',
    async run(t) {
      const b = await t.open({ demo: false, path: 'lite' });
      await sleep(800);
      const back = await b.eval(`
        if (!document.getElementById('msgBox')) { const el = document.createElement('div'); el.innerHTML = composerHtml(); document.body.append(el); }
        onEvent({ kind: 'unsent', seq: 901, text: 'The held words', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], request: { to: 'me' } });
        return { text: document.getElementById('msgBox').value, pictures: COMP.images.length, shown: document.querySelectorAll('#attStrip img').length }`);
      t.check('its words and pictures are back in the box', back.text === 'The held words' && back.pictures === 1 && back.shown === 1, back);
      const newer = await b.eval(`
        const box = document.getElementById('msgBox'); box.value = 'Something newer';
        onEvent({ kind: 'unsent', seq: 902, text: 'Older words', images: [], request: { to: 'me' } });
        await new Promise(r => setTimeout(r, 100));
        return { text: box.value, pictures: COMP.images.length, said: /Held message saved/.test(document.body.innerText) }`);
      t.check('what you’ve written since isn’t overwritten; it offers the held one', newer.text === 'Something newer' && newer.pictures === 1 && newer.said, newer);
    },
  },
  {
    name: 'a partner’s model picker',
    // Every assistant in a chat has its own page in the picker, with its own models.
    async run(t) {
      const calls = [];
      const b = await t.open({ gemini: true, seen: (p, u, body) => calls.push([p, body]) });
      await sleep(600);
      await b.eval(`await ChatUI.open({ sessionId: S.projects.flatMap(p => p.sessions).find(c => /bard/.test(c.title)).id }); return 1`);
      await sleep(900);
      const now = () => b.eval(`const p = document.getElementById('cPick'), tab = p.querySelector('[role="tab"][aria-selected="true"]');
        return { open: !p.hidden, tabs: [...p.querySelectorAll('[role="tab"]')].map(x => x.firstChild.textContent), on: tab && tab.firstChild.textContent, models: [...p.querySelectorAll('[data-model]')].length, asking: !!p.querySelector('.mp-load'), toast: document.getElementById('toast').innerText, mate: C.mate, target: C.target }`);
      await b.clickOn('[data-crew="main"]'); await sleep(400);
      let s = await now();
      t.check('the chat’s own picker has a tab for each of them, by name', s.open && s.on === 'Claude' && s.tabs.join() === 'Claude,Codex,Gemini', s);
      await b.esc(); await sleep(200);
      await b.clickOn('[data-crew="comp"][data-kind="codex"]'); await sleep(300);
      s = await now();
      t.check('one press on Codex’s name writes to it', !s.open && s.target === 'comp' && s.mate === 'codex', s);
      await b.clickOn('[data-crew="comp"][data-kind="codex"]'); await sleep(600);
      s = await now();
      t.check('a second opens its models', s.open && s.on === 'Codex' && s.models > 0 && !s.asking && !/not defined/.test(s.toast), s);
      await b.clickOn('#cPick [role="tab"][data-kind="gemini"]'); await sleep(600);
      s = await now();
      t.check('its tab goes to Gemini’s models', s.open && s.on === 'Gemini' && s.mate === 'gemini' && s.models > 0 && !s.asking && !/not defined/.test(s.toast), s);
      t.check('and what you’re writing goes with it', await b.eval(`return C.target === 'comp' && /Gemini/.test(document.getElementById('cText').getAttribute('aria-label'))`));
      const started = calls.filter(([p]) => p === '/api/chat/companion').map(([, x]) => x.kind);
      t.check('Gemini was brought in to ask', started.includes('gemini'), started);
      calls.length = 0;
      await b.clickOn('#cPick [data-model]'); await sleep(400);
      const asked = calls.filter(([p]) => p === '/api/chat/model').at(-1);
      t.check('choosing a model tells that assistant', !!asked && asked[1].key === (await b.eval(`return C.comps.gemini.key`)), asked);
      // News from another of the crew doesn't turn the page you're on.
      await b.eval(`withComp('codex', () => setCtx('comp', { used: 10, max: 100 })); return 1`); await sleep(200);
      s = await now();
      t.check('news from another of them leaves the page alone', s.open && s.on === 'Gemini', s);
    },
  },
  {
    name: 'unsent message',
    // A message held for a reply that was stopped comes back whole, and doesn't overwrite what you've written since.
    async run(t) {
      const b = await t.open({ crew: true });
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2500);
      const r = await b.eval(`const box = document.getElementById('cText'), wait = () => new Promise(r => setTimeout(r, 200)), now = () => ({ text: box.value, pics: C.attachments.length, target: C.target, kinds: C.group && C.group.kinds, card: !!document.getElementById('cUnsentCard'), toast: document.getElementById('toast').textContent });
        box.value = 'something newer';
        const brief = { kind: 'unsent', seq: 900, text: 'The long brief.', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], request: { to: 'group', kinds: ['claude', 'codex'], how: 'turns' }, reason: 'Claude stopped before it got to it.' };
        handleEvent(brief, 'main'); await wait();
        const out = { held: now(), cardText: document.getElementById('cUnsentCard').textContent };
        document.querySelector('[data-unsent-put]').click(); await wait();
        out.put = now();
        document.querySelector('#toast .toast-act').click(); await wait();
        out.back = now();
        box.value = ''; C.attachments = []; renderAttachments(); setTarget('main', false);
        handleEvent(brief, 'main'); await wait();
        out.again = now();
        handleEvent({ ...brief, seq: 901 }, 'main'); await wait();
        out.empty = now();
        box.value = ''; C.attachments = []; renderAttachments(); setTarget('main', false);
        return out`);
      t.check('what you’ve written since stays, and so does who it’s for', r.held.text === 'something newer' && r.held.pics === 0 && r.held.target === 'main' && r.held.card, r.held);
      t.check('the held message is offered above the box', /The long brief/.test(r.cardText), r.cardText);
      t.check('and it says so', /saved/.test(r.held.toast), r.held.toast);
      t.check('putting it in the box brings its pictures and who it was for', r.put.text === 'The long brief.' && r.put.pics === 1 && r.put.target === 'both' && r.put.kinds.join() === 'claude,codex' && !r.put.card, r.put);
      t.check('and you can go back to what you were writing', r.back.text === 'something newer' && r.back.pics === 0 && r.back.target === 'main', r.back);
      t.check('only once, however often the chat replays', r.again.text === '', r.again);
      t.check('with an empty box it’s simply back in the box', r.empty.text === 'The long brief.' && r.empty.pics === 1 && r.empty.target === 'both' && /back in the box/.test(r.empty.toast), r.empty);
    },
  },
  {
    name: 'picture board',
    // A project's pictures, folder by folder: keep or redo them, and hand the redo list to a chat.
    async run(t) {
      const { createBoard } = require('../lib/board');
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-board-ui-')), root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-board-world-'));
      // Real pictures, however small: one tiny PNG, padded for the ones that need to be big.
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
      const put = (rel, pad = 0) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, pad ? Buffer.concat([PNG, Buffer.alloc(pad, 7)]) : PNG); return f; };
      for (const n of ['aria', 'bob', 'cora', 'dane']) put(`art/v1/${n}.png`, n === 'aria' ? 200 * 1024 : 0);
      put('art/v2/aria.png', 64); put('cover.png', 32);
      for (let i = 0; i < 300; i++) put(`crowd/p${i}.png`);
      const board = createBoard({ dataDir });
      const p = demo.projects.find(x => x.name === 'Starfall Tavern'), cwd = p.cwd;
      const calls = [];
      const b = await t.open({ demo: false });
      await b.intercept('*/api/*', async (url, method, data) => {
        const u = new URL(url);
        if (u.pathname === '/api/board') return { body: await board.list(root, u.searchParams.get('dir'), { fresh: !!u.searchParams.get('fresh'), q: u.searchParams.get('q') || '' }) };
        if (u.pathname === '/api/board/mark') { const q = JSON.parse(data); calls.push(q); return { body: board.mark(root, q.rels, q.mark, q.note) }; }
        if (u.pathname === '/api/board/export') { const q = JSON.parse(data); return { body: await board.exportTo(root, q.rels) }; }
        if (u.pathname === '/api/image' && u.searchParams.get('v')) { calls.push({ image: u.searchParams.get('path') }); return { type: 'image/png', body: fs.readFileSync(u.searchParams.get('path')) }; }
        if (u.pathname === '/api/image' && /made-/.test(u.searchParams.get('path'))) return { type: 'image/png', body: PNG };
        if (u.pathname === '/api/project/banner') { const banner = JSON.parse(data).path; calls.push({ banner }); return { body: { cwd, banner, bannerPicked: true, docs: [], images: [], today: { docs: 0, images: 0 } } }; }
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(600);
      await b.eval(`document.querySelector('[data-wtab="gallery"]').click(); return 1`); await sleep(900);
      const tiles = () => b.eval(`return [...document.querySelectorAll('#bdGrid .bd-t')].map(x => x.dataset.rel)`);
      const openDir = async d => { await b.eval(`document.querySelector('[data-bd-dir=' + JSON.stringify(${JSON.stringify(d)}) + ']').click(); return 1`); await sleep(500); };
      const first = await b.eval(`return { root: !!document.getElementById('bdRoot'), rows: [...document.querySelectorAll('#bdDirs .bd-dir')].map(x => x.dataset.bdDir), title: document.getElementById('bdTitle').textContent, n: document.querySelectorAll('#bdGrid .bd-t').length }`);
      t.check('the Gallery tab is the board, on the newest pictures', first.root && first.title.startsWith('Newest') && first.n > 0, first);
      t.check('its folders are listed with what you’ve marked', ['art/v1', 'art/v2', 'crowd', '.'].every(d => first.rows.includes(d)) && first.rows.slice(0, 3).join() === ':new,:redo,:keep', first.rows);
      await t.shot(b, 'newest');

      await openDir('art/v1');
      t.check('a folder shows its pictures, by name', (await tiles()).join() === 'art/v1/aria.png,art/v1/bob.png,art/v1/cora.png,art/v1/dane.png', await tiles());
      await sleep(900);
      const small = await b.eval(`const im = document.querySelector('#bdGrid .bd-t img'); return { src: im.src, shown: !im.hidden, w: im.naturalWidth }`);
      t.check('pictures show as small copies made on the page', /^blob:/.test(small.src) && small.shown && small.w > 0, small);
      // On the grid: the buttons, and the keys.
      await b.eval(`document.querySelector('.bd-t[data-rel="art/v1/bob.png"] [data-bd-mark="keep"]').click(); return 1`); await sleep(200);
      const kept = await b.eval(`const t = document.querySelector('.bd-t[data-rel="art/v1/bob.png"]'); return { keep: t.classList.contains('keep'), flag: t.querySelector('.bd-flag').textContent, pressed: t.querySelector('[data-bd-mark="keep"]').getAttribute('aria-pressed'), todo: document.querySelector('[data-bd-filter="todo"] .count').textContent, row: !!document.querySelector('[data-bd-dir="art/v1"] .bd-prog') }`);
      t.check('✓ marks it keep, at once', kept.keep && kept.flag === 'Keep' && kept.pressed === 'true' && kept.todo === '3' && kept.row, kept);
      t.check('and the PC has it', calls.some(c => c.mark === 'keep' && c.rels[0] === 'art/v1/bob.png'), calls);
      await b.eval(`document.querySelector('.bd-t[data-rel="art/v1/aria.png"] .bd-pic').focus(); return 1`);
      await b.key('r', 'KeyR', 82); await sleep(200);
      t.check('R on the picture you’re on marks it redo', await b.eval(`return document.querySelector('.bd-t[data-rel="art/v1/aria.png"]').classList.contains('redo')`));
      t.check('the N for New chat doesn’t fire from a tile, and focus stays', await b.eval(`return document.activeElement.closest('.bd-t').dataset.rel === 'art/v1/aria.png'`));
      await b.key('ArrowRight', 'ArrowRight', 39); await sleep(100);
      t.check('arrow keys move through the pictures', await b.eval(`return document.activeElement.closest('.bd-t').dataset.rel === 'art/v1/bob.png'`));
      await b.eval(`document.querySelector('[data-bd-filter="todo"]').click(); return 1`); await sleep(200);
      t.check('To review shows only what’s not marked', (await tiles()).join() === 'art/v1/cora.png,art/v1/dane.png', await tiles());
      await b.eval(`document.querySelector('[data-bd-filter="all"]').click(); return 1`); await sleep(200);

      // One by one, in the viewer.
      await b.eval(`document.querySelector('[data-bd-review]').click(); return 1`); await sleep(600);
      const rev = () => b.eval(`return { open: !document.getElementById('cLight').hidden, bar: !document.getElementById('lbRev').hidden, cap: document.querySelector('.lb-cap').textContent, n: document.querySelector('.lb-n').textContent, state: document.getElementById('lbRevState').textContent, note: document.getElementById('lbRevNote').value, left: document.getElementById('lbRevLeft').textContent, active: document.activeElement.id, two: document.querySelector('.lb-stage').classList.contains('two'), compare: !document.getElementById('lbRevCompare').hidden }`);
      let r = await rev();
      t.check('Review starts at the first one not marked', r.open && r.bar && r.cap === 'art/v1/cora.png' && r.state === 'To review' && r.left === '2 to review', r);
      await t.shot(b, 'review');
      await b.key('k', 'KeyK', 75); await sleep(400);
      r = await rev();
      t.check('K keeps it and goes on to the next', r.cap === 'art/v1/dane.png' && r.left === '1 to review', r);
      await b.key('r', 'KeyR', 82); await sleep(200);
      r = await rev();
      t.check('R marks it redo and asks what should change', r.state === 'Redo' && r.active === 'lbRevNote', r);
      await b.eval(`const n = document.getElementById('lbRevNote'); n.value = 'too dark'; return 1`);
      await b.key('Enter', 'Enter', 13); await sleep(400);
      t.check('Enter saves the note', calls.some(c => c.mark === 'redo' && c.rels[0] === 'art/v1/dane.png' && c.note === 'too dark'), calls.slice(-3));
      r = await rev();
      t.check('and at the last one it says so, and stays', r.cap === 'art/v1/dane.png' && /last one/.test(r.left), r);
      // Back to the first: the same name in another folder.
      await b.eval(`Gallery.i = 0; galleryShow(); return 1`); await sleep(300);
      r = await rev();
      t.check('the same name in another folder can be compared', r.cap === 'art/v1/aria.png' && r.compare && r.state === 'Redo', r);
      await b.key('c', 'KeyC', 67); await sleep(300);
      r = await rev();
      const two = await b.eval(`const o = document.querySelector('.lb-stage .lb-other'); return { src: o && o.src, n: document.querySelectorAll('.lb-stage img').length }`);
      t.check('C puts them side by side', r.two && two.n === 2 && /art.*v2.*aria\.png/.test(decodeURIComponent(two.src)) && r.cap === 'aria.png: v1  ⟷  v2', { r, two });
      await t.shot(b, 'compare');
      await b.key('c', 'KeyC', 67); await sleep(200);
      r = await rev();
      t.check('and C again goes back', !r.two && r.cap === 'art/v1/aria.png' && await b.eval(`return document.querySelectorAll('.lb-stage img').length === 1`), r);
      await b.key('u', 'KeyU', 85); await sleep(200);
      r = await rev();
      t.check('U takes the mark back', r.state === 'To review', r);
      await b.key('r', 'KeyR', 82); await sleep(150);
      await b.eval(`document.getElementById('cLight').focus(); return 1`);
      await b.esc(); await sleep(300);
      const closed = await b.eval(`return { open: !document.getElementById('cLight').hidden, active: document.activeElement.closest && document.activeElement.closest('.bd-t') && document.activeElement.closest('.bd-t').dataset.rel, note: document.querySelector('.bd-t[data-rel="art/v1/dane.png"] .bd-note').textContent }`);
      t.check('Esc closes it, back at the picture you were on', !closed.open && closed.active === 'art/v1/aria.png', closed);
      t.check('the note shows on the tile', closed.note === 'too dark', closed);

      // The list, to a chat.
      await b.eval(`document.querySelector('[data-bd-send]').click(); return 1`); await sleep(250);
      const menu = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('the redo list goes to a chat here, or a new one', menu.some(x => /Balance pass/.test(x)) && menu.some(x => /A new Claude chat/.test(x)) && menu.some(x => /Copy it/.test(x)) && !menu.some(x => /Orbital|nutrient/i.test(x)), menu);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /Balance pass/.test(x.textContent)).click(); return 1`); await sleep(2500);
      const box = await b.eval(`return { open: ChatUI.isOpen(), text: document.getElementById('cText').value }`);
      t.check('it lands in that chat’s message box, unsent, with the notes', box.open && /^Please redo these 2 pictures/.test(box.text) && box.text.includes('- art/v1/dane.png: too dark') && box.text.includes('- art/v1/aria.png'), box);
      await b.eval(`document.getElementById('cText').value = ''; ChatUI.close(); return 1`); await sleep(700);

      // Made again: back to review, with what you'd asked for.
      put('art/v1/dane.png', 500); await sleep(50);
      await b.eval(`boardLoad({ quiet: true }); return 1`); await sleep(500);
      const again = await b.eval(`const t = document.querySelector('.bd-t[data-rel="art/v1/dane.png"]'); return { cls: t.className, flag: t.querySelector('.bd-flag').textContent, note: t.querySelector('.bd-note').textContent, todo: document.querySelector('[data-bd-filter="todo"] .count').textContent, img: t.querySelector('img').hidden }`);
      t.check('a picture made again says so and is to review again', /again/.test(again.cls) && again.flag === 'Made again' && again.note === 'too dark' && again.todo === '1', again);
      await openDir(':redo');
      const redoRows = await tiles();
      t.check('To redo lists it all, across folders', redoRows.includes('art/v1/aria.png') && redoRows.includes('art/v1/dane.png'), redoRows);
      await openDir('art/v1');

      // Everything left, at once, with a way back.
      await b.eval(`document.querySelector('.bd-t[data-rel="art/v1/dane.png"] [data-bd-mark="keep"]').click(); return 1`); await sleep(200);
      await b.eval(`document.querySelector('.bd-t[data-rel="art/v1/bob.png"] [data-bd-mark="keep"]').click(); return 1`); await sleep(200);   // takes bob's keep back
      await b.eval(`document.querySelector('[data-bd-more]').click(); return 1`); await sleep(200);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /still to review/.test(x.textContent)).click(); return 1`); await sleep(300);
      t.check('the rest can be kept in one go', await b.eval(`return document.querySelector('.bd-t[data-rel="art/v1/bob.png"]').classList.contains('keep')`) && /kept/.test(await b.eval(`return document.getElementById('toast').textContent`)));
      await b.eval(`document.querySelector('#toast .toast-act').click(); return 1`); await sleep(400);
      t.check('and Undo puts it back', !(await b.eval(`return document.querySelector('.bd-t[data-rel="art/v1/bob.png"]').classList.contains('keep')`)));

      // A big folder draws in steps; a banner can be any picture.
      await openDir('crowd');
      const drawn = await b.eval(`return document.querySelectorAll('#bdGrid .bd-t').length`);
      t.check('a big folder draws a part at a time', drawn === 240, drawn);
      await b.eval(`document.getElementById('bdMore').scrollIntoView(); return 1`); await sleep(600);
      t.check('and the rest as you get there', (await b.eval(`return document.querySelectorAll('#bdGrid .bd-t').length`)) === 300);
      await b.eval(`document.querySelector('.bd-t [data-banner]').click(); return 1`); await sleep(300);
      t.check('any picture can be the banner', calls.some(c => c.banner && /crowd/.test(c.banner)), calls.filter(c => c.banner));

      // Copies of what's kept, in a folder of their own.
      await openDir('art/v1');
      await b.eval(`document.querySelector('.bd-t[data-rel="art/v1/cora.png"]').classList.contains('keep') || document.querySelector('.bd-t[data-rel="art/v1/cora.png"] [data-bd-mark="keep"]').click(); return 1`); await sleep(200);
      await b.eval(`document.querySelector('[data-bd-more]').click(); return 1`); await sleep(200);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /copies of what/.test(x.textContent)).click(); return 1`); await sleep(500);
      const exported = await b.eval(`return document.getElementById('toast').textContent`);
      t.check('copies of what’s kept go in a folder of their own', /copied to Kept pictures/.test(exported) && fs.existsSync(path.join(root, 'Kept pictures')), exported);

      // From anywhere, and the size of the tiles.
      await b.eval(`go('hub'); return 1`); await sleep(500);
      const items = await b.eval(`return projectItems(${JSON.stringify(cwd)}).filter(x => x !== '-').map(x => x.label)`);
      t.check('the project menu has it', items.includes('Review pictures'), items);
      await b.eval(`openBoard(${JSON.stringify(cwd)}); return 1`); await sleep(800);
      t.check('openBoard goes straight to it', await b.eval(`return S.view === 'folder' && S.worldTab === 'gallery' && !!document.getElementById('bdRoot')`));
      await b.eval(`S.worldTab = 'chats'; renderWorldBody(); openBoard(${JSON.stringify(cwd)}, 'art/v2'); return 1`); await sleep(700);
      t.check('and from another tab it can open on one folder', (await tiles()).join() === 'art/v2/aria.png', await tiles());
      const low = await b.eval(`${TEXT_AUDIT.replace(/\breturn out\b/, '')}; return out.filter(x => x.ratio < x.needed && !x.disabled).slice(0, 8)`);
      t.check('its words are readable', !low.length, low);
      const scale = await b.eval(`const s = document.getElementById('bdSize'); s.value = 300; s.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 100)); return document.querySelector('.bd-t').getBoundingClientRect().width`);
      t.check('Size makes the pictures bigger', scale >= 300, scale);
      const errs = b.logs.filter(l => /^EXC /.test(l));
      t.check('no errors on the page', !errs.length, errs.slice(0, 3));
      board.flush();
      t.check('marks are saved on the PC', /art\/v1\/aria\.png/.test(fs.readFileSync(path.join(dataDir, 'board.json'), 'utf8')));

      // What's showing, as one picture.
      await openDir('art/v1');
      const sheet = await b.eval(`const r = await boardSheet(boardView()); return { type: r.blob.type, size: r.blob.size, drawn: r.drawn, cut: r.cut, w: r.width, h: r.height }`);
      t.check('what’s showing can become one picture', sheet.type === 'image/png' && sheet.size > 100 && sheet.drawn === 4 && sheet.cut === 0 && sheet.w > 300 && sheet.h > 100, sheet);
      const bigSheet = await b.eval(`const list = Array.from({ length: 70 }, () => boardView()[1]); const r = await boardSheet(list); return { cut: r.cut, drawn: r.drawn }`);
      t.check('up to sixty of them', bigSheet.cut === 10 && bigSheet.drawn === 60, bigSheet);
      const copied = await b.eval(`const real = navigator.clipboard.write; let got = null; navigator.clipboard.write = async items => { got = items[0].types; }; await boardCopySheet(boardView()); navigator.clipboard.write = real; return { got, toast: document.getElementById('toast').textContent }`);
      t.check('and it’s copied, ready to paste', copied.got && copied.got[0] === 'image/png' && /copied as one/.test(copied.toast), copied);

      // The folders by keyboard.
      await b.eval(`document.getElementById('bdFind').focus(); return 1`);
      await b.key('ArrowDown', 'ArrowDown', 40); await sleep(50);
      t.check('↓ from the box goes into the folders', await b.eval(`return document.activeElement.dataset.bdDir === ':new'`));
      await b.key('ArrowDown', 'ArrowDown', 40); await sleep(50);
      t.check('and on through them', await b.eval(`return document.activeElement.dataset.bdDir === ':redo'`));
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(30); await b.key('ArrowUp', 'ArrowUp', 38); await sleep(50);
      t.check('↑ back to the box', await b.eval(`return document.activeElement.id === 'bdFind'`));

      // A picture by its name, in any folder.
      await openDir('crowd');
      await b.eval(`const box = document.getElementById('bdPicQ'); box.value = 'ARIA'; box.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(600);
      const named = await b.eval(`return { dir: Board.dir, tiles: [...document.querySelectorAll('#bdGrid .bd-t')].map(x => x.dataset.rel), title: document.getElementById('bdTitle').textContent }`);
      t.check('a picture can be found by its name, in any folder', named.dir === ':find' && named.tiles.join() === 'art/v1/aria.png,art/v2/aria.png' && /Named like “ARIA”/.test(named.title), named);
      await b.eval(`const box = document.getElementById('bdPicQ'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(600);
      t.check('and clearing it goes back to where you were', await b.eval(`return Board.dir === 'crowd' && document.querySelectorAll('#bdGrid .bd-t').length > 100`));

      // On the hub: what you asked to redo is back.
      await b.eval(`go('hub'); return 1`); await sleep(500);
      await b.eval(`Back.list = [{ root: ${JSON.stringify(cwd)}, again: 3, still: 1 }]; Back.at = Date.now(); renderPicturesBack(); return 1`); await sleep(100);
      const back = await b.eval(`const c = document.querySelector('#backSlot .pics-back'); return c && c.textContent.replace(/\\s+/g, ' ').trim()`);
      t.check('the hub says when pictures you asked to redo are back', /Starfall Tavern: 3 pictures you asked to redo are back/.test(back || ''), back);
      await b.eval(`document.querySelector('[data-back-open]').click(); return 1`); await sleep(700);
      t.check('and goes straight to them', await b.eval(`return S.view === 'folder' && Board.dir === ':redo' && S.worldTab === 'gallery'`));
      await b.eval(`go('hub'); return 1`); await sleep(500);
      await b.eval(`Back.at = Date.now(); renderPicturesBack(); document.querySelector('[data-back-hide]').click(); return 1`); await sleep(100);
      t.check('Hide sets it aside', await b.eval(`return !document.querySelector('#backSlot .pics-back')`));
      await b.eval(`Back.list = [{ root: ${JSON.stringify(cwd)}, again: 4, still: 0 }]; Back.at = Date.now(); renderPicturesBack(); return 1`); await sleep(100);
      t.check('until more come back', await b.eval(`return !!document.querySelector('#backSlot .pics-back')`));
      await b.eval(`Back.list = []; Back.at = Date.now(); renderPicturesBack(); await go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(500);

      // From a reply's pictures to the board, on their folder.
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2000);
      const link = await b.eval(`const turn = document.querySelector('#cFeed .turn:last-of-type') || [...document.querySelectorAll('#cFeed .turn')].pop(); addPic(turn, { path: 'art/v1/made-one.png' }, 'made'); await new Promise(r => setTimeout(r, 80)); const one = !!turn.querySelector('[data-pic-board]'); addPic(turn, { path: 'art/v1/made-two.png' }, 'made'); await new Promise(r => setTimeout(r, 80)); const two = turn.querySelector('[data-pic-board]'); if (two) two.click(); return { one, two: !!two }`);
      await sleep(900);
      t.check('two pictures made in a reply offer the board', !link.one && link.two, link);
      t.check('and it opens on their folder', await b.eval(`return !ChatUI.isOpen() && S.view === 'folder' && S.worldTab === 'gallery' && Board.dir === 'art/v1'`), await b.eval(`return { open: ChatUI.isOpen(), view: S.view, tab: S.worldTab, dir: Board.dir }`));

      // Imperial and Rebel keep their gallery as it was; the board is one click from it.
      await b.eval(`S.boardOn = false; Look.set({ theme: 'imperial' }); renderFolder(); return 1`); await sleep(700);
      const saga = await b.eval(`return { family: document.documentElement.dataset.family, gallery: !!document.querySelector('#wpBody .gallery'), board: !!document.getElementById('bdRoot'), btn: !!document.querySelector('[data-bd-on]') }`);
      t.check('Imperial keeps its gallery, with a way to the board', saga.family === 'saga' && !saga.board && (saga.gallery ? saga.btn : true), saga);
    },
  },
  {
    name: 'same file',
    // Two chats changing the same file: said on the hub and in the chat, with what to do about it.
    async run(t) {
      const b = await t.open();
      await sleep(800);
      const set = (at = Date.now() - 120e3) => b.eval(`const at = ${at};
        for (const x of S.activity) delete x.overlaps;
        const a = S.activity.find(x => x.key === 'k-bard'), c = S.activity.find(x => x.key === 'k-brawl');
        a.overlaps = [{ file: 'C:\\\\Projects\\\\Starfall Tavern\\\\lore\\\\opening.md', rel: 'lore/opening.md', at, mine: at - 1000, others: [{ key: 'k-brawl', provider: 'claude', sessionId: c.sessionId, at }] }];
        c.overlaps = [{ file: 'C:\\\\Projects\\\\Starfall Tavern\\\\lore\\\\opening.md', rel: 'lore/opening.md', at, mine: at, others: [{ key: 'k-bard', provider: 'claude', sessionId: a.sessionId, at: at - 1000 }] }];
        renderLive(true); return 1`);
      t.check('nothing said when nothing’s wrong', await b.eval(`return !document.querySelector('#clashSlot .clash') && document.getElementById('clashSlot').offsetHeight === 0`));
      await set(); await sleep(300);
      const card = await b.eval(`const c = document.querySelector('#clashSlot .clash'); return c && { text: c.textContent.replace(/\\s+/g, ' '), role: c.getAttribute('role'), toast: document.getElementById('toast').textContent }`);
      t.check('the hub says which file and which chats', card && /same file at once/.test(card.text) && /lore\/opening\.md/.test(card.text) && /Balance pass/.test(card.text) && /Tavern brawl/.test(card.text), card);
      t.check('and it’s announced', card && card.role === 'status');
      t.check('and said once as it happens', card && /both changing lore\/opening\.md/.test(card.toast), card && card.toast);
      await t.shot(b, 'hub');
      await b.eval(`document.querySelector('[data-clash-hide]').click(); return 1`); await sleep(200);
      t.check('Hide hides it', await b.eval(`return !document.querySelector('#clashSlot .clash')`));
      await b.eval(`renderLive(true); return 1`); await sleep(100);
      t.check('and it stays hidden', await b.eval(`return !document.querySelector('#clashSlot .clash')`));
      await set(Date.now() - 1000); await sleep(200);
      t.check('until it happens again', await b.eval(`return !!document.querySelector('#clashSlot .clash')`));
      // In the chat.
      t.check('no mark on a chat it doesn’t concern', await (async () => { await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-notes'])} }); return 1`); await sleep(1800); return b.eval(`renderClash(); return ChatUI.key() !== 'k-bard' ? document.getElementById('cClash').hidden : true`); })());
      await b.eval(`ChatUI.close(); ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2400);
      await b.eval(`renderClash(); return 1`);
      t.check('the chat’s header has a mark', await b.eval(`const c = document.getElementById('cClash'); return !c.hidden && c.getBoundingClientRect().width > 0 && /changing a file/.test(c.getAttribute('aria-label'))`));
      await b.clickOn('#cClash'); await sleep(250);
      const menu = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('it lists the file, the other chat, and what to do', menu.some(x => /lore\/opening\.md/.test(x) && /Tavern brawl/.test(x)) && menu.some(x => /Open Tavern brawl.* beside/.test(x)) && menu.some(x => /read them again/.test(x)), menu);
      await t.shot(b, 'chat');
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /read them again/.test(x.textContent)).click(); return 1`); await sleep(200);
      const box = await b.eval(`return document.getElementById('cText').value`);
      t.check('it can ask this chat to read it again, unsent', /lore\/opening\.md/.test(box) && /Read it again/.test(box), box);
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
      await b.clickOn('#cClash'); await sleep(200);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /beside/.test(x.textContent)).click(); return 1`); await sleep(1500);
      t.check('or put the other one beside it', await b.eval(`return document.querySelectorAll('#cSplit iframe').length === 1`));
      await b.eval(`closeSplit(); return 1`);
      // A chat and its own partner: one chat, so nothing to put beside it.
      const crew = await b.eval(`const a = S.activity.find(x => x.key === 'k-bard'), p = S.activity.find(x => x.key === 'k-bard-cx');
        if (!p) return null;
        window._opened = []; const real = ChatUI.openKey; ChatUI.openKey = k => { _opened.push(k); return Promise.resolve(); };
        const r = { id: 'x', file: 'x', rel: 'x', at: Date.now(), chats: new Map([[a.key, { key: a.key, sessionId: a.sessionId }], [p.key, { key: p.key, sessionId: p.sessionId }]]) };
        await clashSideBySide(r); ChatUI.openKey = real;
        return { opened: _opened, panes: document.querySelectorAll('#cSplit iframe').length }`);
      // One that ended while its card was up: it opens again from its conversation.
      const gone = await b.eval(`const real = ChatUI.openKey, realOpen = ChatUI.open, tried = []; ChatUI.openKey = k => { tried.push(['key', k]); return Promise.reject(Object.assign(new Error('gone'), { status: 404 })); }; ChatUI.open = o => { tried.push(['open', o.sessionId]); return Promise.resolve(); };
        await openStillThere({ key: 'k-x', sessionId: 's-x' }); ChatUI.openKey = real; ChatUI.open = realOpen; return tried`);
      t.check('a chat that’s ended since opens again from its conversation', JSON.stringify(gone) === JSON.stringify([['key', 'k-x'], ['open', 's-x']]), gone);
      t.check('a chat and its partner aren’t put beside each other', !crew || (crew.opened.join() === 'k-bard' && crew.panes === 0), crew);
    },
  },
  {
    name: 'project overview',
    // The top of a project's page: what's open here, and where its files stand in git.
    async run(t) {
      const p = demo.projects.find(x => x.name === 'Starfall Tavern'), cwd = p.cwd;
      const now = {
        git: { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 0, changed: 3, files: [
          { file: `${cwd}\\\\lore\\\\opening.md`, rel: 'lore/opening.md', status: 'changed' },
          { file: `${cwd}\\\\new.md`, rel: 'new.md', status: 'new' },
          { file: `${cwd}\\\\old.md`, rel: 'old.md', status: 'deleted' },
        ], commits: [{ hash: 'abc1234', at: Date.now() - 2 * 3600e3, subject: 'Harvest Festival key art' }, { hash: 'def5678', at: Date.now() - 864e5, subject: 'Rally song numbers' }] },
      };
      const b = await t.open({ demo: false });
      let asked = 0;
      const forgets = [];
      await b.intercept('*/api/*', async (url, method, data) => {
        const u = new URL(url);
        if (u.pathname === '/api/project/now') { asked++; return { body: u.searchParams.get('cwd') === cwd ? now : { git: null } }; }
        if (u.pathname === '/api/project/memory') return { body: { dir: 'C:\\\\mem', notes: [
          { file: 'tone.md', path: 'C:\\\\mem\\\\tone.md', title: 'Keep the tavern warm', description: 'The tone of the world', type: 'project', mtime: Date.now() - 864e5, size: 200 },
          { file: 'short.md', path: 'C:\\\\mem\\\\short.md', title: 'Short replies', description: 'You like them short', type: 'feedback', mtime: Date.now() - 3600e3, size: 100 },
        ] } };
        if (u.pathname === '/api/project/memory/forget') { const q = JSON.parse(data); forgets.push(q); return { body: q.kept ? { ok: true } : { kept: '1-short.md', line: '- [Short replies](short.md)' } }; }
        if (u.pathname === '/api/project/find') return { body: { hits: [{ rel: 'lore/opening.md', path: `${cwd}\\\\lore\\\\opening.md`, count: 2, lines: [{ n: 3, text: 'A bard tunes a lute' }], words: true, mtime: Date.now() }], files: 12, cut: u.searchParams.get('q') === 'big' } };
        if (u.pathname === '/api/file') return { body: { kind: 'text', markdown: true, lang: 'markdown', name: 'opening.md', path: `${cwd}\\\\lore\\\\opening.md`, dir: `${cwd}\\\\lore`, size: 40, mtime: Date.now(), text: '# Opening\n\nA bard tunes a lute.' } };
        if (u.pathname === '/api/project/changes') return { body: { changes: [
          { at: Date.now() - 600e3, id: demo.ID['s-bard'], by: 'claude', chat: demo.ID['s-bard'], turn: 2, files: [{ path: 'lore/opening.md', status: 'changed', add: 3, del: 1 }], more: 0, add: 3, del: 1, scope: null, undone: false },
          { at: Date.now() - 2 * 864e5, id: 't-x', by: 'codex', chat: demo.ID['s-bard'], turn: 0, files: [{ path: 'new.md', status: 'added', add: 9, del: 0 }], more: 0, add: 9, del: 0, scope: 'text', undone: true },
        ] } };
        if (u.pathname === '/api/project/change-diff') return { body: { diff: `@@ -1 +1 @@\n+turn ${u.searchParams.get('turn')} of ${u.searchParams.get('id')}: ${u.searchParams.get('path')}` } };
        if (u.pathname === '/api/project/diff') return { body: { diff: `diff --git a b\n@@ -1 +1 @@\n-old line of ${u.searchParams.get('path')}\n+new line` } };
        if (u.pathname === '/api/chat/so-far') return { body: { files: [{ path: 'lore/opening.md', status: 'changed', add: 3, del: 1 }, { path: 'new.md', status: 'added', add: 9, del: 0 }] } };
        if (u.pathname === '/api/chat/so-far-diff') return { body: { diff: `@@ -1 +1 @@\n+so far in ${u.searchParams.get('path')}` } };
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(900);
      const top = await b.eval(`const el = document.getElementById('wpNow'); return { chats: [...el.querySelectorAll('.wn-chat')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), git: el.querySelector('.wn-git').textContent.replace(/\\s+/g, ' ').trim(), sum: el.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim() }`);
      t.check('what’s open in this project, and what each is doing', top.chats.length >= 2 && top.chats.some(x => /Balance pass/.test(x)) && top.chats.some(x => /Tavern brawl/.test(x)) && !top.chats.some(x => /nutrient/i.test(x)), top.chats);
      t.check('the branch, what’s to push and the last commit', /main/.test(top.git) && /2 to push/.test(top.git) && /Harvest Festival/.test(top.git), top.git);
      t.check('what isn’t committed, a click away', /3 files not committed/.test(top.sum), top.sum);
      await b.eval(`document.querySelector('[data-now-fold] summary').click(); return 1`); await sleep(200);
      const open = await b.eval(`return { open: document.querySelector('[data-now-fold]').open, files: [...document.querySelectorAll('.wn-f')].map(x => x.textContent), buttons: document.querySelectorAll('button.wn-f').length, commits: document.querySelectorAll('.wn-commits li').length }`);
      t.check('every file listed; a deleted one can’t be opened', open.open && open.files.length === 3 && open.buttons === 2 && open.commits === 2, open);
      await t.shot(b, 'open');
      await b.eval(`renderProjectNow(); renderFolder(); return 1`); await sleep(100);
      t.check('it stays open when the page redraws', await b.eval(`return document.querySelector('[data-now-fold]').open`));
      await b.eval(`document.querySelector('[data-now-diff]').click(); return 1`); await sleep(500);
      const diff = await b.eval(`const d = document.getElementById('chgDlg'); return { open: d.open, title: document.getElementById('chgTitle').textContent, files: d.querySelectorAll('.chg-file').length, first: d.querySelector('.chg-diff').textContent }`);
      t.check('what isn’t committed can be read, file by file', diff.open && /Not committed \(3 files\)/.test(diff.title) && diff.files === 3 && /old line of lore\/opening\.md/.test(diff.first), diff);
      await b.eval(`document.getElementById('chgDlg').close(); return 1`);
      await b.eval(`document.querySelector('.wn-chat[data-now-open]').click(); return 1`); await sleep(2000);
      t.check('a chat opens from there', await b.eval(`return ChatUI.isOpen()`));
      // A chat's project name goes to its project.
      const toProject = await b.eval(`const name = document.getElementById('cFolder'); const label = name.textContent; name.click(); await new Promise(r => setTimeout(r, 500)); const out = { label, tag: name.tagName, open: ChatUI.isOpen(), view: S.view, folder: S.folder }; return out`);
      t.check('a chat’s project name goes to its project', toProject.tag === 'BUTTON' && /Starfall/i.test(toProject.label) && !toProject.open && toProject.view === 'folder' && toProject.folder === cwd, toProject);
      await b.eval(`document.querySelector('.wn-chat[data-now-open]').click(); return 1`); await sleep(1500);

      // And from a chat: everything it's changed, in one place.
      await b.eval(`viewAllChanges(); return 1`); await sleep(500);
      const all = await b.eval(`const d = document.getElementById('chgDlg'); return { open: d.open, title: document.getElementById('chgTitle').textContent, text: d.querySelector('.chg-body').textContent }`);
      t.check('a chat can show everything it’s changed', all.open && /Everything this chat has changed \(2 files\)/.test(all.title) && /\+3 −1|\+12 −1/.test(all.text) && /so far in lore\/opening\.md/.test(all.text), all);
      await b.eval(`document.getElementById('chgDlg').close(); return 1`);
      await b.eval(`ChatUI.close(); return 1`); await sleep(400);
      // A long list of chats gets a box to narrow it.
      t.check('a short list of chats has no filter', await b.eval(`return !document.getElementById('chatFilter')`));
      const filtered = await b.eval(`const p = S.projects.find(x => x.cwd === ${JSON.stringify(cwd)}), keep = p.sessions;
        p.sessions = [...keep, ...Array.from({ length: 6 }, (_, i) => ({ ...keep[0], id: 'extra-' + i, title: 'Extra chat ' + i }))];
        S.worldTab = 'docs'; renderWorldBody(); S.worldTab = 'chats'; renderWorldBody();
        const box = document.getElementById('chatFilter'), rows = () => document.querySelectorAll('#wbList > ul.rows > *').length;
        const out = { box: !!box, all: rows() };
        box.value = 'EXTRA CHAT 3'; box.dispatchEvent(new Event('input', { bubbles: true }));
        out.one = rows(); out.kept = document.activeElement === document.getElementById('chatFilter') || document.getElementById('chatFilter') === box;
        box.value = 'nothing like this'; box.dispatchEvent(new Event('input', { bubbles: true }));
        out.none = document.getElementById('wbList').textContent;
        box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
        out.back = rows();
        p.sessions = keep; renderWorldBody();
        return out`);
      t.check('a long one does, and it narrows as you type', filtered.box && filtered.all === 11 && filtered.one === 1 && filtered.kept && /No chat here/.test(filtered.none) && filtered.back === 11, filtered);

      // The Changes tab: what the chats here changed, whichever's still open.
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); document.querySelector('[data-wtab="changes"]').click(); return 1`); await sleep(500);
      const tab = await b.eval(`return { rows: [...document.querySelectorAll('.pc-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), heads: [...document.querySelectorAll('#wpBody .dg-h')].map(x => x.textContent), count: document.querySelector('[data-wtab="changes"] .count').textContent }`);
      t.check('Changes lists what each reply changed, by day', tab.rows.length === 2 && /Balance pass/.test(tab.rows[0]) && /opening\.md/.test(tab.rows[0]) && tab.heads[0] === 'Today' && tab.heads.length === 2, tab);
      t.check('with who, and what was undone', /Codex/.test(tab.rows[1]) && /undone/.test(tab.rows[1]), tab.rows[1]);
      const narrowed = await b.eval(`window.__pcBoxAlways = true; renderProjectChanges(); const box = document.getElementById('pcFilter'), rows = () => document.querySelectorAll('.pc-row').length, type = v => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); };
        const out = { all: rows(), who: [...document.querySelectorAll('[data-pc-by]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()) };
        type('NEW.MD'); out.one = rows(); out.text = document.querySelector('.pc-row').textContent; out.same = document.getElementById('pcFilter') === box;
        type('balance pass'); out.byChat = rows();
        type('nothing like this'); out.none = document.getElementById('pcList').textContent;
        type(''); document.querySelector('[data-pc-by="codex"]').click(); out.codex = rows();
        document.querySelector('[data-pc-by="all"]').click(); out.back = rows();
        window.__pcBoxAlways = false; renderProjectChanges(); out.few = document.getElementById('pcBox').hidden;
        return out`);
      t.check('they can be narrowed to a file or a chat, and the box stays as you type', narrowed.all === 2 && narrowed.one === 1 && /new\.md/.test(narrowed.text) && narrowed.same && narrowed.byChat === 2 && /No change here matches/.test(narrowed.none), narrowed);
      t.check('or to one of the crew', narrowed.who.length === 3 && narrowed.codex === 1 && narrowed.back === 2, narrowed);
      t.check('a short list has no box', narrowed.few === true, narrowed);
      await t.shot(b, 'changes');
      await b.eval(`document.querySelector('[data-pc-view="0"]').click(); return 1`); await sleep(500);
      const seen = await b.eval(`return { open: document.getElementById('chgDlg').open, text: document.querySelector('.chg-diff').textContent }`);
      t.check('and shows it, with the chat open or not', seen.open && /turn 2 of/.test(seen.text) && /lore\/opening\.md/.test(seen.text), seen);
      await b.eval(`document.getElementById('chgDlg').close(); S.worldTab = 'chats'; renderWorldBody(); return 1`);

      // Words in the project's files, past their names.
      await b.eval(`S.worldTab = 'docs'; S.docFilter = ''; renderWorldBody(); return 1`); await sleep(300);
      const deep0 = await b.eval(`const box = document.getElementById('docFilter'); if (!box) return { none: true, html: document.getElementById('wpBody').textContent.slice(0, 80) }; box.value = 'bard'; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 100)); const d = document.getElementById('docDeep'); return { hidden: d.hidden, text: d.textContent }`);
      t.check('a filter offers to look inside the files', !deep0.hidden && /Look inside every file for “bard”/.test(deep0.text), deep0);
      await b.eval(`document.getElementById('docDeep').click(); return 1`); await sleep(300);
      const deep1 = await b.eval(`return { note: document.querySelector('.fh-note').textContent, files: [...document.querySelectorAll('.fh-file')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), lists: document.getElementById('docLists').hidden }`);
      t.check('it lists the files, with their lines', deep1.lists && /1 file with “bard”/.test(deep1.note) && /of 12 files/.test(deep1.note) && /lore\/opening\.md/.test(deep1.files[0]) && /A bard tunes a lute/.test(deep1.files[0]), deep1);
      await t.shot(b, 'find');
      await b.eval(`document.querySelector('.fh-file').click(); return 1`); await sleep(700);
      const deep2 = await b.eval(`return { open: document.getElementById('viewer').open, found: document.getElementById('vFindN').textContent, q: document.getElementById('vFindQ').value }`);
      t.check('and a file opens with the words found', deep2.open && deep2.q === 'bard' && deep2.found === '1 of 1', deep2);
      await b.eval(`document.querySelector('#viewer [data-v="close"]').click(); return 1`);
      const deep3 = await b.eval(`const box = document.getElementById('docFilter'); box.value = 'bar'; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 60)); const out = { lists: document.getElementById('docLists').hidden, hits: document.getElementById('docHits').hidden }; box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); S.docFilter = ''; S.worldTab = 'chats'; renderWorldBody(); return out`);
      t.check('typing goes back to the list', !deep3.lists && deep3.hits, deep3);

      // The Memory tab: what Claude keeps for itself here.
      const noted = await b.eval(`const p = S.projects.find(x => x.cwd === ${JSON.stringify(cwd)}); const before = !!document.querySelector('[data-wtab="memory"]'); p.notes = 2; renderFolder(); return { before, after: !!document.querySelector('[data-wtab="memory"]') }`);
      t.check('a project with notes has a Memory tab', !noted.before && noted.after, noted);
      await b.eval(`document.querySelector('[data-wtab="memory"]').click(); return 1`); await sleep(400);
      const mem = await b.eval(`return { rows: [...document.querySelectorAll('.mem-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), heads: [...document.querySelectorAll('#wpBody .dg-h')].map(x => x.textContent) }`);
      t.check('it lists them by what they’re about, in plain words', mem.rows.length === 2 && /Keep the tavern warm/.test(mem.rows[0]) && /The tone of the world/.test(mem.rows[0]) && /^About the project/.test(mem.heads[0]) && /^How you like/.test(mem.heads[1]), mem);
      await t.shot(b, 'memory');
      await b.eval(`const f = document.getElementById('memFilter'); f.value = 'SHORT'; f.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(100);
      t.check('the filter narrows them', (await b.eval(`return document.querySelectorAll('.mem-row').length`)) === 1);
      await b.eval(`document.querySelector('[data-mem-forget="short.md"]').click(); return 1`); await sleep(200);
      t.check('Forget asks first', await b.eval(`return [...document.querySelectorAll('dialog[open]')].some(d => /Forget “Short replies”/.test(d.textContent))`) && !forgets.length);
      await b.eval(`[...document.querySelectorAll('dialog[open] button')].find(x => /Forget it/.test(x.textContent)).click(); return 1`); await sleep(300);
      t.check('then it’s set aside', forgets.length === 1 && forgets[0].file === 'short.md' && !forgets[0].kept && (await b.eval(`return document.querySelectorAll('.mem-row').length === 0 && /forgotten/.test(document.getElementById('toast').textContent)`)), forgets);
      await b.eval(`document.querySelector('#toast .toast-act').click(); return 1`); await sleep(300);
      t.check('and can come back', forgets.length === 2 && forgets[1].kept === '1-short.md' && /short\.md/.test(forgets[1].line), forgets);
      await b.eval(`const f = document.getElementById('memFilter'); if (f) { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); } S.memFilter = ''; const p = S.projects.find(x => x.cwd === ${JSON.stringify(cwd)}); p.notes = 0; S.worldTab = 'chats'; renderFolder(); return 1`); await sleep(100);

      // Nothing in git, nothing open: nothing shown.
      const empty = demo.projects.find(x => x.name === 'Atlas Docs').cwd;
      await b.eval(`await go('folder', ${JSON.stringify(empty)}); return 1`); await sleep(800);
      t.check('nothing to say, nothing shown', await b.eval(`const el = document.getElementById('wpNow'); return el.children.length === 0 && el.offsetHeight === 0`));
      // On a phone every tab is still in reach.
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(500);
      await b.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(400);
      const tabs = await b.eval(`const p = S.projects.find(x => x.cwd === ${JSON.stringify(cwd)}); p.notes = 3; renderFolder(); const w = document.documentElement.clientWidth, out = [...document.querySelectorAll('.wtabs .wt')].map(x => Math.round(x.getBoundingClientRect().right)); p.notes = 0; renderFolder(); return { w, out }`);
      t.check('every tab fits on a phone', tabs.out.length === 5 && tabs.out.every(r => r <= tabs.w), tabs);
      await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);

      // Imperial's project page stays as it was.
      await b.eval(`Look.set({ theme: 'imperial' }); go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(800);
      t.check('Imperial’s project page stays as it was', await b.eval(`const el = document.getElementById('wpNow'); return (!el || el.children.length === 0) && !document.querySelector('[data-wtab="changes"]')`));
      await b.eval(`document.querySelector('[data-act="world-more"]').click(); return 1`); await sleep(200);
      const sagaMenu = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('with what’s new under its ⋯', sagaMenu.some(x => /What changed here/.test(x)) && sagaMenu.some(x => /Review pictures/.test(x)), sagaMenu);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /What changed here/.test(x.textContent)).click(); return 1`); await sleep(400);
      t.check('and it shows, without a new tab', await b.eval(`return !!document.querySelector('.pc-row')`));
      await b.eval(`S.worldTab = 'chats'; Look.reset(); return 1`);
    },
  },
  {
    name: 'document notes',
    // Select a passage in the file viewer, say what should change, and hand the notes to a chat.
    async run(t) {
      const p = demo.projects.find(x => x.name === 'Starfall Tavern'), cwd = p.cwd, path_ = `${cwd}\\lore\\opening.md`;
      const text = '# The opening\n\nThe tavern smells of smoke and cloves. A bard tunes a lute by the hearth, and nobody looks up.\n\nOutside, the harvest moon is rising over the river.\n';
      const b = await t.open({ demo: false });
      await b.intercept('*/api/*', async url => {
        const u = new URL(url);
        if (u.pathname === '/api/file') return { body: { kind: 'text', markdown: true, lang: 'markdown', name: 'opening.md', path: path_, dir: `${cwd}\\lore`, size: text.length, mtime: Date.now() - 60e3, text } };
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      const open = () => b.eval(`Viewer.open({ path: ${JSON.stringify(path_)}, cwd: ${JSON.stringify(cwd)} }); return 1`);
      await open(); await sleep(500);
      const select = `const walker = document.createTreeWalker(document.getElementById('vBody'), NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.nodeValue.indexOf('A bard tunes'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'A bard tunes a lute'.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } }`;
      t.check('nothing offered till something’s selected', await b.eval(`return document.getElementById('vPop').hidden && document.getElementById('vNotes').hidden`));
      await b.eval(`${select} return 1`); await sleep(350);
      const offer = await b.eval(`const p = document.getElementById('vPop'), r = p.getBoundingClientRect(), v = document.getElementById('viewer').getBoundingClientRect(); return { hidden: p.hidden, text: p.textContent, inside: r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom }`);
      t.check('selecting a passage offers a note, by it and inside the window', !offer.hidden && /Add a note/.test(offer.text) && offer.inside, offer);
      await t.shot(b, 'offer');
      await b.eval(`document.querySelector('#vPop [data-dn="write"]').click(); return 1`); await sleep(200);
      const writing = await b.eval(`return { quote: document.querySelector('#vPop .vn-quote').textContent, active: document.activeElement.id }`);
      t.check('it shows what the note is about, and you can type at once', writing.quote === 'A bard tunes a lute' && writing.active === 'vNoteText', writing);
      await b.eval(`document.getElementById('vNoteText').value = 'Make it a fiddle.'; return 1`);
      await b.key('Enter', 'Enter', 13); await sleep(200);
      const one = await b.eval(`return { pop: document.getElementById('vPop').hidden, tray: !document.getElementById('vNotes').hidden, head: document.querySelector('.vn-head b').textContent, q: document.querySelector('.vn-q').textContent, t: document.querySelector('.vn-t').textContent, marked: !!(window.CSS && CSS.highlights && CSS.highlights.has('doc-note')) }`);
      t.check('Enter adds it to the tray', one.pop && one.tray && /1 note/.test(one.head) && one.q === 'A bard tunes a lute' && one.t === 'Make it a fiddle.', one);
      t.check('and the passage is marked', one.marked, one);
      // N with nothing selected: a note on the whole file. Esc there leaves the viewer open.
      await b.eval(`document.getElementById('vBody').focus(); return 1`);
      await b.eval(`document.querySelector('[data-doc-note]').click(); return 1`); await sleep(200);
      t.check('a note on the whole file works too', await b.eval(`return /whole file/.test(document.getElementById('vPop').textContent)`));
      await b.esc(); await sleep(200);
      t.check('Esc leaves the note, not the viewer', await b.eval(`return document.getElementById('viewer').open && document.getElementById('vPop').hidden`));
      await b.eval(`document.querySelector('[data-doc-note]').click(); document.getElementById('vNoteText').value = 'Shorter overall.'; document.querySelector('[data-dn="add"]').click(); return 1`); await sleep(200);
      await t.shot(b, 'tray');
      // A file's top part (for the program) is folded away when it's formatted.
      const fronted = await b.eval(`window.__f = window.fetch; const f = { kind: 'text', markdown: true, lang: 'markdown', name: 'note.md', path: 'C:\\\\x\\\\note.md', dir: 'C:\\\\x', size: 40, mtime: Date.now(), text: '---\\nname: x\\ndescription: y\\n---\\n\\nThe words.' }; window.fetch = (u, o) => String(u).startsWith('/api/file?') ? Promise.resolve(new Response(JSON.stringify(f), { status: 200 })) : window.__f(u, o);
        Viewer.open({ path: f.path }); await new Promise(r => setTimeout(r, 300));
        const out = { fold: !!document.querySelector('.v-front'), open: document.querySelector('.v-front') && document.querySelector('.v-front').open, words: document.querySelector('.v-md').textContent };
        document.querySelector('[data-v="raw"]').click(); out.raw = document.querySelector('.v-raw').textContent;
        document.querySelector('#viewer [data-v="close"]').click(); window.fetch = window.__f; return out`);
      t.check('a file’s top part is folded away, and all there in Markdown', fronted.fold && !fronted.open && /The words\./.test(fronted.words) && /^---/.test(fronted.raw), fronted);
      await open(); await sleep(500);

      // Find in the file.
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 }); await sleep(200);
      t.check('Ctrl+F finds in the file', await b.eval(`return !document.getElementById('vFind').hidden && document.activeElement.id === 'vFindQ'`));
      await b.eval(`const q = document.getElementById('vFindQ'); q.value = 'THE'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(150);
      const found = await b.eval(`return { n: document.getElementById('vFindN').textContent, on: !window.Highlight || (CSS.highlights.has('doc-find') && CSS.highlights.has('doc-find-now')) }`);
      t.check('with how many, whatever their case', found.n === '1 of 5' && found.on, found);
      await b.key('Enter', 'Enter', 13); await sleep(100);
      t.check('Enter goes to the next', (await b.eval(`return document.getElementById('vFindN').textContent`)) === '2 of 5');
      await b.eval(`const q = document.getElementById('vFindQ'); q.value = 'zebra'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(100);
      t.check('and says when there’s none', (await b.eval(`return document.getElementById('vFindN').textContent`)) === 'None');
      await b.esc(); await sleep(150);
      t.check('Esc closes the find, not the viewer', await b.eval(`return document.getElementById('viewer').open && document.getElementById('vFind').hidden && !CSS.highlights.has('doc-find')`));
      t.check('a file of words can open in your own editor', await b.eval(`return !!document.querySelector('#viewer [data-v="editor"]')`));

      // They stay with the file.
      await b.eval(`document.querySelector('#viewer [data-v="close"]').click(); return 1`); await sleep(200);
      await open(); await sleep(500);
      t.check('they’re still there when the file’s opened again', (await b.eval(`return document.querySelectorAll('.vn-list li').length`)) === 2);
      await b.eval(`document.querySelector('.vn-list li:last-child [data-dn="del"]').click(); return 1`); await sleep(100);
      await b.eval(`document.querySelector('[data-doc-note]').click(); document.getElementById('vNoteText').value = 'Shorter overall.'; document.querySelector('[data-dn="add"]').click(); return 1`); await sleep(150);
      // To a chat.
      await b.eval(`document.querySelector('[data-dn="send"]').click(); return 1`); await sleep(250);
      const menu = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('they can go to a chat in this project, or a new one', menu.some(x => /Balance pass/.test(x)) && menu.some(x => /A new Claude chat/.test(x)) && !menu.some(x => /nutrient/i.test(x)), menu);
      await b.eval(`[...document.querySelectorAll('#menu [role="menuitem"]')].find(x => /Balance pass/.test(x.textContent)).click(); return 1`); await sleep(2500);
      const sent = await b.eval(`return { open: ChatUI.isOpen(), viewer: document.getElementById('viewer').open, text: document.getElementById('cText').value, toast: document.getElementById('toast').textContent }`);
      t.check('they land in that chat’s box, unsent, each with its passage', sent.open && !sent.viewer && /notes on lore\/opening\.md/.test(sent.text) && /> A bard tunes a lute\nMake it a fiddle\./.test(sent.text) && /Shorter overall\./.test(sent.text), sent);
      await b.eval(`document.getElementById('cText').value = ''; document.querySelector('#toast .toast-act').click(); ChatUI.close(); return 1`); await sleep(500);
      await open(); await sleep(500);
      t.check('“Keep the notes” keeps them', (await b.eval(`return document.querySelectorAll('.vn-list li').length`)) === 2);
      await b.eval(`document.querySelector('[data-dn="clear"]').click(); return 1`); await sleep(150);
      t.check('Clear clears them', await b.eval(`return document.getElementById('vNotes').hidden && !CSS.highlights.has('doc-note')`));
      await b.eval(`document.querySelector('#toast .toast-act').click(); return 1`); await sleep(150);
      t.check('and Undo brings them back', (await b.eval(`return document.querySelectorAll('.vn-list li').length`)) === 2);
      await b.eval(`document.querySelector('[data-dn="clear"]').click(); return 1`);
      const head = await b.eval(`const x = document.querySelector('#viewer [data-v="close"]').getBoundingClientRect(), v = document.getElementById('viewer').getBoundingClientRect(); return { top: x.top - v.top, right: v.right - x.right }`);
      t.check('the ✕ sits in the corner', head.top < 30 && head.right < 30, head);
      await b.eval(`document.querySelector('#viewer [data-v="close"]').click(); return 1`);
      // Imperial's row of buttons stays as it was: the new ones are in Work here.
      await b.eval(`Look.set({ theme: 'imperial' }); return 1`); await sleep(400);
      await open(); await sleep(500);
      const saga = await b.eval(`return { note: !!document.querySelector('[data-doc-note]'), find: !!document.querySelector('[data-doc-find]'), editor: !!document.querySelector('#viewer [data-v="editor"]') }`);
      t.check('Imperial’s viewer keeps its buttons', !saga.note && !saga.find && !saga.editor, saga);
      await b.eval(`document.querySelector('#viewer [data-v="work"]').click(); return 1`); await sleep(200);
      const work = await b.eval(`return [...document.querySelectorAll('#menu [role="menuitem"]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim())`);
      t.check('with the new ones under Work here', work.some(x => /Add a note/.test(x)) && work.some(x => /Find in this file/.test(x)), work);
      await b.esc(); await sleep(100);
      await b.eval(`document.querySelector('#viewer [data-v="close"]').click(); Look.reset(); return 1`);
    },
  },
  {
    name: 'site beside',
    // The site you're building, beside the chat, from its local address.
    async run(t) {
      const http = require('node:http');
      let hits = 0;
      const server = http.createServer((req, res) => {
        if (req.url === '/') hits++;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        // It tries to take the whole window: a frame of this app mustn't be able to.
        res.end(`<!doctype html><title>My site</title><h1>Hello</h1><script>try { top.location = 'http://127.0.0.1:' + location.port + '/escaped'; } catch (e) {}</script>`);
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${server.address().port}/`;
      try {
        const b = await t.open();
        await sleep(600);
        await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2200);
        const at0 = await b.eval(`return location.href`);
        await b.eval(`openSiteBeside('https://example.com/'); return 1`); await sleep(150);
        t.check('an address that isn’t on this computer doesn’t open here', await b.eval(`return !document.querySelector('.c-site') && /on this computer/.test(document.getElementById('toast').textContent)`));
        await b.eval(`openSiteBeside(${JSON.stringify(url)}); return 1`); await sleep(1200);
        const on = await b.eval(`const f = document.querySelector('.c-site iframe'), r = f.getBoundingClientRect(); return { split: document.getElementById('chat').classList.contains('split'), w: r.width, h: r.height, url: document.getElementById('csUrl').value, sandbox: f.getAttribute('sandbox'), top: location.href }`);
        t.check('it opens beside the chat', on.split && on.w > 400 && on.h > 300 && on.url === url, on);
        t.check('the page loaded in it', hits >= 1, hits);
        t.check('and it can’t take over the app', on.top === at0 && !/allow-top-navigation/.test(on.sandbox), on);
        await t.shot(b, 'beside');
        await b.eval(`document.querySelector('[data-site="phone"]').click(); return 1`); await sleep(150);
        t.check('it can show at a phone’s width', (await b.eval(`return document.querySelector('.c-site iframe').getBoundingClientRect().width`)) === 390);
        await b.eval(`document.querySelector('[data-site="full"]').click(); return 1`);
        let was = hits;
        await b.eval(`document.querySelector('[data-site="reload"]').click(); return 1`); await sleep(700);
        t.check('Reload reloads it', hits > was, { was, hits });
        was = hits;
        await b.eval(`siteChanged(); return 1`); await sleep(1500);
        t.check('and it reloads when a reply changes something', hits > was, { was, hits });
        await b.eval(`const i = document.getElementById('csUrl'); i.value = 'https://example.com/'; i.form.requestSubmit(); return 1`); await sleep(150);
        t.check('the address box won’t leave this computer', await b.eval(`return document.querySelector('.c-site iframe').src.startsWith('http://127.0.0.1')`));
        // From Run the project's panel: the panel gets out of the site's way.
        const cleared = await b.eval(`const chat = document.getElementById('chat'); chat.classList.add('show-ledger'); openSiteBeside(${JSON.stringify(url)}); await new Promise(r => setTimeout(r, 200)); return !chat.classList.contains('show-ledger')`);
        t.check('the side panel doesn’t sit on top of the site', cleared);
        // A web page in the viewer can go beside the chat, with nothing to start.
        const fake = { kind: 'text', markdown: false, lang: 'html', name: 'index.html', path: 'C:\\\\Sites\\\\mine\\\\index.html', dir: 'C:\\\\Sites\\\\mine', size: 10, mtime: Date.now(), text: '<h1>x</h1>' };
        const beside = await b.eval(`const f = ${JSON.stringify(fake)}, real = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/file?') ? Promise.resolve(new Response(JSON.stringify(f), { status: 200 })) : String(u).startsWith('/api/file/preview') ? Promise.resolve(new Response(JSON.stringify({ url: ${JSON.stringify(url)} + 'other.html?k=abc' }), { status: 200 })) : real(u, o));
          await Viewer.open({ path: f.path }); await new Promise(r => setTimeout(r, 200));
          const btn = document.querySelector('#viewer [data-v="beside"]'); const has = !!btn; if (btn) btn.click(); await new Promise(r => setTimeout(r, 400)); window.fetch = real;
          return { has, open: document.getElementById('viewer').open, shown: document.getElementById('csUrl').value, frame: document.querySelector('.c-site iframe').src }`);
        t.check('a web page in the viewer can go beside the chat', beside.has && !beside.open && /other\.html$/.test(beside.shown) && /k=abc/.test(beside.frame), beside);
        // A page in the project, with nothing running: the key doesn't show in its address.
        const shown = await b.eval(`return siteShown('http://127.0.0.1:1234/index.html?k=abc123') + ' ' + siteShown('http://127.0.0.1:1234/a.html?x=1&k=abc123') + ' ' + siteShown('http://127.0.0.1:1234/a.html?k=abc123&x=1')`);
        t.check('a page’s key stays out of the address shown', shown === 'http://127.0.0.1:1234/index.html http://127.0.0.1:1234/a.html?x=1 http://127.0.0.1:1234/a.html?x=1', shown);
        await b.eval(`document.querySelector('[data-site="close"]').click(); return 1`); await sleep(150);
        t.check('✕ closes it', await b.eval(`return !document.querySelector('.c-site') && !document.getElementById('chat').classList.contains('split')`));
        const errs = b.logs.filter(l => /^EXC /.test(l));
        t.check('no errors on the page', !errs.length, errs.slice(0, 3));
      } finally { server.close(); }
    },
  },
  {
    name: 'shared changes',
    // Changes made while another reply was working in the folder: shown, but this reply can't undo them.
    async run(t) {
      const b = await t.open();
      await sleep(600);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2400);
      const bar = files => b.eval(`const ev = { kind: 'changes', turn: 77, files: ${JSON.stringify(files)}, since: new Date().toISOString(), at: new Date().toISOString() };
        const html = changesBar(ev, 'main'); const d = document.createElement('div'); d.innerHTML = html;
        return { text: d.textContent.replace(/\\s+/g, ' ').trim(), undo: !!d.querySelector('[data-c="chgundo"]'), view: !!d.querySelector('[data-c="chgview"]') }`);
      const a = await bar([{ path: 'a.txt', status: 'changed', add: 1, del: 0 }]);
      t.check('its own changes can be undone', a.undo && a.view && !/another reply/.test(a.text), a);
      const c = await bar([{ path: 'a.txt', status: 'changed', add: 1, del: 0, shared: true }, { path: 'b.txt', status: 'changed', add: 1, del: 0, shared: true }]);
      t.check('all shared: the changes show, Undo isn’t offered, and it says why', !c.undo && c.view && /another reply was working/.test(c.text) && /Undo isn’t offered/.test(c.text), c);
      const m = await bar([{ path: 'a.txt', status: 'changed', add: 1, del: 0 }, { path: 'b.txt', status: 'changed', add: 1, del: 0, shared: true }]);
      t.check('some shared: Undo stays, and leaves those alone', m.undo && /Undo leaves those alone/.test(m.text), m);
    },
  },
  {
    name: 'earlier messages',
    // Up in an empty box: what you sent, as in a terminal.
    async run(t) {
      const b = await t.open();
      await sleep(600);
      await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(2400);
      const sent = await b.eval(`return [...document.querySelectorAll('#cFeed .umsg')].map(el => RAW.get(el) || '').filter(Boolean).reverse()`);
      t.check('the chat has some to go through', sent.length >= 2, sent);
      await b.eval(`const box = document.getElementById('cText'); box.value = ''; box.focus(); return 1`);
      const box = () => b.eval(`return document.getElementById('cText').value`);
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(60);
      t.check('↑ brings back the last one', (await box()) === sent[0], await box());
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(60);
      t.check('↑ again the one before', (await box()) === sent[1], await box());
      await b.key('ArrowDown', 'ArrowDown', 40); await sleep(60);
      t.check('↓ comes forward', (await box()) === sent[0], await box());
      await b.key('ArrowDown', 'ArrowDown', 40); await sleep(60);
      t.check('and back to an empty box', (await box()) === '', await box());
      // Typing makes it yours: the arrows move the cursor again.
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(60);
      await b.eval(`const el = document.getElementById('cText'); el.value += ' and more'; el.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      const typed = await box();
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(60);
      t.check('once you’ve typed in it, it’s yours', (await box()) === typed, await box());
      await b.eval(`const el = document.getElementById('cText'); el.value = 'something of mine'; el.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      await b.key('ArrowUp', 'ArrowUp', 38); await sleep(60);
      t.check('and it leaves anything you’ve written alone', (await box()) === 'something of mine');
      await b.eval(`document.getElementById('cText').value = ''; return 1`);
    },
  },
  {
    name: 'several chats',
    // The same message to several chats, and a stop for everything that's working.
    async run(t) {
      const calls = [];
      const b = await t.open({ demo: false });
      await b.intercept('*/api/*', async (url, method, data) => {
        const u = new URL(url);
        if (u.pathname === '/api/chat/send' && method === 'POST') { const q = JSON.parse(data); calls.push(['send', q.key, q.text]); if (q.key === 'k-brawl' && q.text === 'half') return { status: 500, body: { error: 'That one couldn’t take it.' } }; return { body: { ok: true } }; }
        if (u.pathname === '/api/chat/interrupt' && method === 'POST') { calls.push(['stop', JSON.parse(data).key]); return { body: { ok: true } }; }
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`openManyDialog(); return 1`); await sleep(200);
      const d = await b.eval(`const d = document.getElementById('manyDlg'); return { open: d.open, focus: document.activeElement.id, rows: [...d.querySelectorAll('.many-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), ticked: d.querySelectorAll('input:checked').length, go: document.getElementById('manyGo').disabled }`);
      t.check('it lists the chats open here, all ticked, ready to type', d.open && d.focus === 'manyText' && d.rows.length === 3 && d.ticked === 3 && d.go, d);
      t.check('not one in a terminal, and not a partner', !d.rows.some(x => /Route-finding/.test(x)) && !d.rows.some(x => /^Codex ·/.test(x)), d.rows);
      await t.shot(b, 'dialog');
      await b.eval(`const box = document.getElementById('manyText'); box.value = 'Commit what you have.'; box.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-many-key="k-nutrient"]').click(); return 1`); await sleep(100);
      t.check('the button says how many', /Send to 2 chats/.test(await b.eval(`return document.getElementById('manyGo').textContent`)));
      await b.eval(`document.getElementById('manyGo').click(); return 1`); await sleep(400);
      const sent = calls.filter(c => c[0] === 'send');
      t.check('it goes to the ones ticked', sent.length === 2 && sent.every(c => c[2] === 'Commit what you have.') && !sent.some(c => c[1] === 'k-nutrient'), calls);
      t.check('and it says so', await b.eval(`return !document.getElementById('manyDlg').open && /Sent to 2 chats/.test(document.getElementById('toast').textContent)`));
      // One refuses: the rest still go, and it says which didn't.
      calls.length = 0;
      await b.eval(`openManyDialog({ keys: ['k-bard', 'k-brawl'], title: 'Message the tavern' }); const box = document.getElementById('manyText'); box.value = 'half'; box.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(100);
      t.check('it can start with just some, named for what they are', await b.eval(`return document.querySelectorAll('#manyList input:checked').length === 2 && document.getElementById('manyTitle').textContent === 'Message the tavern'`));
      await b.eval(`document.getElementById('manyGo').click(); return 1`); await sleep(400);
      t.check('one refusing doesn’t stop the others, and it says so', calls.length === 2 && /Sent to 1 of 2.*couldn’t take it/.test(await b.eval(`return document.getElementById('toast').textContent`)), calls);
      // Stop.
      calls.length = 0;
      await b.eval(`stopEverything(); return 1`); await sleep(300);
      const ask = await b.eval(`const d = [...document.querySelectorAll('dialog[open]')].pop(); return d ? d.textContent : ''`);
      t.check('Stop asks first, naming what’s working', /Balance pass/.test(ask) && !/Tavern brawl/.test(ask), ask);
      await b.eval(`[...document.querySelectorAll('dialog[open] button')].find(x => /Stop them/.test(x.textContent)).click(); return 1`); await sleep(400);
      t.check('and stops only that', calls.length >= 1 && calls.every(c => c[0] === 'stop') && calls.some(c => c[1] === 'k-bard') && !calls.some(c => c[1] === 'k-brawl'), calls);
      const pal = await b.eval(`return palItems('message several').map(x => x.t || x.g).filter(Boolean).join('|')`);
      t.check('Ctrl+K has them', /Message several chats/.test(pal), pal);
    },
  },
  {
    name: 'project page',
    // Less above a project's chats: nothing gone, some of it a click further.
    async run(t) {
      const b = await t.open({});
      const cwd = demo.projects.find(p => p.name === 'Starfall Tavern').cwd;
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); S.worldTab = 'chats'; renderFolder(); return 1`); await sleep(700);
      const head = await b.eval(`const q = s => document.querySelector(s); const tops = el => Math.round(el.getBoundingClientRect().top);
        return { sameRow: Math.abs(tops(q('.wtabs')) - tops(q('.wp-act'))) < 16, firstRow: tops(q('#wbList .rows > li')),
          names: ['newchat', 'newcodex'].map(a => q('[data-act="' + a + '"]').getAttribute('aria-label')), shown: q('[data-act="newchat"]').textContent.trim(), crest: !!q('.wp-tools [data-project-crest]'), browse: !!q('.wp-tools [data-act="browse"]'), reveal: !!q('.wp-tools [data-act="reveal"]') }`);
      t.check('the tabs and the new-chat buttons share a row', head.sameRow, head);
      t.check('the chats start high on the page', head.firstRow < 430, head.firstRow);
      t.check('a button says what it does to a screen reader', head.names[0] === 'New Claude chat' && head.names[1] === 'New Codex chat' && head.shown === 'Claude', head);
      t.check('browse and open stay out; the crest moves to the menu', head.browse && head.reveal && !head.crest, head);
      await b.eval(`document.querySelector('[data-act="world-more"]').click(); return 1`); await sleep(200);
      const items = await b.eval(`return [...document.querySelectorAll('#menu button')].map(x => x.textContent)`);
      t.check('the crest and the pin are in its menu', items.some(x => /Project crest/.test(x)) && items.some(x => /Pin to the sidebar/.test(x)), items);
      await b.eval(`[...document.querySelectorAll('#menu button')].find(x => /Pin to the sidebar/.test(x.textContent)).click(); return 1`); await sleep(200);
      t.check('and pinning from there pins it', await b.eval(`return S.pins.has(${JSON.stringify(cwd)})`));
      await b.eval(`S.pins.delete(${JSON.stringify(cwd)}); savePins(); return 1`);
      await t.shot(b, 'head');
      // Imperial keeps what it had.
      await b.eval(`Look.set({ theme: 'imperial' }); await go('hub'); await go('folder', ${JSON.stringify(cwd)}); return 1`); await sleep(500);
      const saga = await b.eval(`const q = s => document.querySelector(s); return { text: q('[data-act="newchat"]').textContent.trim(), crest: !!q('.wp-tools [data-project-crest]'), pin: !!q('.wp-tools [data-act="pin"]') }`);
      t.check('Imperial keeps its buttons as they were', saga.text === 'New Claude chat' && saga.crest && saga.pin, saga);
      await b.eval(`Look.set({ theme: 'crimson' }); return 1`);
    },
  },
  {
    name: 'document contents',
    // A long document's headings, a click away, and a link to a heading goes there.
    async run(t) {
      const long = ['# The world', 'Intro.', '![The map](../art/map.png)', '[Go to the map](#the-map-of-ash)', ...Array.from({ length: 60 }, (_, i) => `Filler line ${i}.\n`), '## Places', ...Array.from({ length: 60 }, (_, i) => `More ${i}.\n`), '### The map of Ash!', ...Array.from({ length: 60 }, (_, i) => `Again ${i}.\n`), '## People', 'The end.'].join('\n');
      const b = await t.open({ demo: false });
      await b.intercept('*/api/*', async url => {
        const u = new URL(url);
        if (u.pathname === '/api/file') return { body: { kind: 'text', markdown: true, lang: 'markdown', name: u.searchParams.get('path').split('\\').pop(), path: u.searchParams.get('path'), dir: 'C:\\p', size: 100, mtime: Date.now(), text: /short/.test(u.searchParams.get('path')) ? '# One\n\nTwo.\n' : long } };
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`await Viewer.open({ path: 'C:\\\\p\\\\long.md' }); return 1`); await sleep(300);
      t.check('a long document offers its contents', await b.eval(`return !!document.querySelector('#vHead [data-v="contents"]')`));
      const pic = await b.eval(`const p = document.querySelector('#vBody .md-pic'); return { path: p.dataset.path, src: new URL(p.querySelector('img').src).searchParams.get('path') }`);
      t.check('a picture in a document is found from the document', pic.path === 'C:\\art\\map.png' && pic.src === 'C:\\art\\map.png', pic);
      await b.eval(`document.querySelector('#vBody .md-pic').click(); await new Promise(r => setTimeout(r, 300)); return 1`);
      t.check('and clicking it opens it there', await b.eval(`const title = document.getElementById('vTitle').textContent; return /map\\.png/.test(title) && !!document.querySelector('.v-back')`));
      await b.eval(`document.querySelector('.v-back').click(); await new Promise(r => setTimeout(r, 300)); return 1`);
      await b.eval(`document.querySelector('[data-v="contents"]').click(); return 1`); await sleep(200);
      const items = await b.eval(`return [...document.querySelectorAll('#menu .m-l')].map(x => x.textContent)`);
      t.check('it lists the headings, the lesser ones set in', items.length === 4 && items[0] === 'The world' && /^\s+Places/.test(items[1]) && /^\s{4,}The map of Ash!/.test(items[2]), items);
      await t.shot(b, 'contents');
      const went = await b.eval(`const body = document.getElementById('vBody'); [...document.querySelectorAll('#menu button')].find(x => /People/.test(x.textContent)).click(); await new Promise(r => setTimeout(r, 300)); const r = [...body.querySelectorAll('h3')].find(x => /People/.test(x.textContent)).getBoundingClientRect(), box = body.getBoundingClientRect(); return { scrolled: body.scrollTop, near: r.top - box.top }`);
      t.check('and goes to the one you pick', went.scrolled > 100 && went.near < 700, went);
      const linked = await b.eval(`const body = document.getElementById('vBody'); body.scrollTop = 0; body.querySelector('a[href="#the-map-of-ash"]').click(); await new Promise(r => setTimeout(r, 300)); return body.scrollTop`);
      t.check('a link to a heading goes there', linked > 100, linked);
      t.check('in a chat, it’s just words', await b.eval(`const a = document.createElement('div'); a.className = 'md'; a.innerHTML = ChatUI.md('[Go](#there)'); document.body.append(a); const cs = getComputedStyle(a.querySelector('a')); const out = cs.pointerEvents === 'none'; a.remove(); return out`));
      await b.eval(`await Viewer.open({ path: 'C:\\\\p\\\\short.md' }); return 1`); await sleep(300);
      t.check('a short one doesn’t need them', await b.eval(`return !document.querySelector('#vHead [data-v="contents"]')`));
      // From a project's Documents, the next one is a click away.
      await b.eval(`Viewer.close(); await go('folder', S.projects.find(x => /Starfall/.test(x.name)).cwd); S.worldTab = 'docs'; renderWorldBody(); await new Promise(r => setTimeout(r, 300)); document.querySelector('#wpBody [data-doc]').click(); return 1`); await sleep(400);
      const step1 = await b.eval(`return { n: document.querySelector('#vHead .v-step .count')?.textContent, title: document.getElementById('vTitle').textContent, prevOff: document.querySelector('[data-v="prev"]')?.disabled }`);
      t.check('stepping through a project’s documents', /^1 of \d/.test(step1.n || '') && step1.prevOff === true, step1);
      await b.eval(`document.querySelector('[data-v="next"]').click(); return 1`); await sleep(300);
      const step2 = await b.eval(`return { n: document.querySelector('#vHead .v-step .count')?.textContent, title: document.getElementById('vTitle').textContent }`);
      t.check('next goes to the next one', /^2 of /.test(step2.n || '') && step2.title !== step1.title, { step1, step2 });
      await b.eval(`const d = document.getElementById('viewer'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return 1`); await sleep(300);
      t.check('← goes back', await b.eval(`return /^1 of /.test(document.querySelector('#vHead .v-step .count')?.textContent || '')`));
      await b.eval(`Viewer.close(); Look.set({ theme: 'imperial' }); await Viewer.open({ path: 'C:\\\\p\\\\long.md' }); return 1`); await sleep(300);
      const saga = await b.eval(`const on = !!document.querySelector('#vHead [data-v="contents"]'); document.querySelector('[data-v="work"]').click(); await new Promise(r => setTimeout(r, 200)); const inMenu = /Contents/.test(document.getElementById('menu').textContent); closeMenu(); return { on, inMenu }`);
      t.check('Imperial has it under Work here, its buttons as they were', !saga.on && saga.inMenu, saga);
      await b.eval(`Viewer.close(); Look.set({ theme: 'crimson' }); return 1`);
    },
  },
  {
    name: 'keep working',
    // Told to carry on until a time you choose: the menu, the dialog, the line over the chat.
    async run(t) {
      const calls = [];
      let keep = null, refuse = null;
      const b = await t.open({ demo: false });
      await b.intercept('*/api/*', async (url, method, data) => {
        const u = new URL(url);
        if (u.pathname === '/api/chat/keep') {
          const q = JSON.parse(data); calls.push(q);
          if (refuse) return { status: 400, body: { error: refuse } };
          keep = q.action === 'off' ? null : { until: q.until, quietMinutes: q.quiet, note: q.note, nudges: 0, state: 'working', nextAt: null };
          return { body: { keep } };
        }
        if (u.pathname === '/api/activity') {
          if (!keep) return null;
          const r = await demo.activityBody();
          r.list = r.list.map(x => (x.key === 'k-bard' ? { ...x, keep } : x));
          return { body: r };
        }
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      t.check('nothing over the chat until it’s on', await b.eval(`return document.getElementById('cKeep').hidden`));
      const inMenu = async () => { await b.eval(`document.querySelector('[data-c="more"]').click(); return 1`); await sleep(150); const l = await b.eval(`const it = [...document.querySelectorAll('#menu button')].find(x => /Keep (it working|working:)/.test(x.textContent)); return it ? it.textContent : null`); return l; };
      t.check('it’s in the chat’s menu', /Keep it working until/.test(await inMenu()));
      await b.eval(`[...document.querySelectorAll('#menu button')].find(x => /Keep it working/.test(x.textContent)).click(); return 1`); await sleep(250);
      const d = await b.eval(`const d = document.getElementById('keepDlg'); const v = Date.parse(document.getElementById('keepUntil').value); return { open: d.open, hours: (v - Date.now()) / 36e5, go: !document.getElementById('keepGo').disabled, label: document.getElementById('keepGo').textContent, quiet: d.querySelector('[data-keep-quiet][aria-pressed="true"]').textContent, off: document.getElementById('keepOff').hidden, who: document.getElementById('keepWho').textContent }`);
      t.check('it starts at eight hours, checking in after five quiet minutes', d.open && Math.abs(d.hours - 8) < 0.1 && d.go && d.quiet === '5 min' && d.off, d);
      t.check('it names the chat, and says what it does', /Balance pass/.test(d.who) && /carry on/.test(d.who), d.who);
      t.check('and how much usage there is', await b.eval(`const r = document.getElementById('keepRoom'); return !r.hidden && /Usage left: Studio, /.test(r.textContent)`), await b.eval(`return document.getElementById('keepRoom').textContent`));
      await t.shot(b, 'dialog');
      await b.eval(`document.querySelector('[data-keep-in="1"]').click(); document.querySelector('[data-keep-quiet="15"]').click(); return 1`);
      const picked = await b.eval(`return { hours: (Date.parse(document.getElementById('keepUntil').value) - Date.now()) / 36e5, quiet: document.querySelector('[data-keep-quiet][aria-pressed="true"]').textContent }`);
      t.check('a button sets the time, and another how long a quiet', Math.abs(picked.hours - 1) < 0.05 && picked.quiet === '15 min', picked);
      await b.eval(`document.querySelector('[data-keep-at="tomorrow"]').click(); return 1`);
      t.check('8:00 tomorrow is 8:00 tomorrow', await b.eval(`const d = new Date(document.getElementById('keepUntil').value), n = new Date(); n.setDate(n.getDate() + 1); return d.getHours() === 8 && d.getMinutes() === 0 && d.getDate() === n.getDate()`));
      await b.eval(`const u = document.getElementById('keepUntil'); u.value = '2001-01-01T08:00'; u.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
      t.check('a time that’s gone can’t be chosen', await b.eval(`return document.getElementById('keepGo').disabled`));
      await b.eval(`document.querySelector('[data-keep-in="3"]').click(); document.getElementById('keepNote').value = 'The map next.'; return 1`);
      // Refused: it says why, and stays open.
      refuse = 'That’s further off than it can keep going.';
      await b.eval(`document.getElementById('keepGo').click(); return 1`); await sleep(300);
      t.check('refused, it says why and stays open', await b.eval(`const e = document.getElementById('keepErr'); return !e.hidden && /further off/.test(e.textContent) && document.getElementById('keepDlg').open && !document.getElementById('keepGo').disabled`));
      refuse = null; calls.length = 0;
      await b.eval(`document.getElementById('keepGo').click(); return 1`); await sleep(600);
      t.check('it asks the PC to, with what you chose', calls.length === 1 && calls[0].key === 'k-bard' && calls[0].quiet === 15 && calls[0].note === 'The map next.' && Math.abs((calls[0].until - Date.now()) / 36e5 - 3) < 0.05, calls);
      const bar = await b.eval(`const c = document.getElementById('cKeep'); return { hidden: c.hidden, text: c.textContent, open: document.getElementById('keepDlg').open }`);
      t.check('the line over the chat says until when', !bar.hidden && !bar.open && /Keeps working until/.test(bar.text), bar);
      await t.shot(b, 'bar');
      // What it's up to, in words.
      const words = async o => { await b.eval(`const x = S.activity.find(y => y.key === 'k-bard'); x.keep = { ...x.keep, ...${JSON.stringify(o)} }; renderKeep(); return 1`); return b.eval(`return document.getElementById('cKeep').textContent`); };
      t.check('it says when it’s waiting for usage', /waiting for usage, back/.test(await words({ state: 'out', backAt: Date.now() + 36e5, nudges: 2 })));
      t.check('it counts the check-ins', /2 check-ins so far/.test(await b.eval(`return document.getElementById('cKeep').textContent`)));
      t.check('it says when it’s waiting on you', /waiting on you/.test(await words({ state: 'asking', backAt: null })));
      t.check('it says when the next one is', /next check-in in 4 min/.test(await words({ state: 'waiting', nextAt: Date.now() + 3.5 * 60e3 })));
      t.check('and when it can’t open yet', /can’t open yet: It’s in a terminal/.test(await words({ state: 'closed', nextAt: null, error: 'It’s in a terminal.' })));
      await words({ state: 'working', error: null, nextAt: null, nudges: 1 });
      t.check('the menu now says it’s on', /Keep working: change or turn off/.test(await inMenu()));
      const between = await b.eval(`closeMenu(); const x = S.activity.find(y => y.key === 'k-bard'); const fin = { ...x, phase: 'idle', finishedAt: Date.now(), source: 'app' }; return { kept: ownStatus(fin), word: chatState({ ...fin, partner: null }).word, plain: ownStatus({ ...fin, keep: null }) }`);
      t.check('between check-ins it isn’t your turn; it keeps working', between.kept === 'working' && between.word === 'Keeps working' && between.plain === 'reply', between);
      t.check('its card on the hub says until when', /Keeps working until/.test(await b.eval(`const x = S.activity.find(y => y.key === 'k-bard'); return workCard({ ...x, phase: 'idle', finishedAt: Date.now(), partner: null })`)));
      await b.eval(`document.querySelector('[data-keep-open]').click(); return 1`); await sleep(250);
      const again = await b.eval(`return { open: document.getElementById('keepDlg').open, note: document.getElementById('keepNote').value, label: document.getElementById('keepGo').textContent, off: !document.getElementById('keepOff').hidden, quiet: document.querySelector('[data-keep-quiet][aria-pressed="true"]').textContent }`);
      t.check('Change shows what you chose', again.open && again.note === 'The map next.' && again.label === 'Change' && again.off && again.quiet === '15 min', again);
      await b.eval(`document.querySelector('#keepDlg [data-keep="close"]').click(); return 1`);
      calls.length = 0;
      t.check('its row in the lists says so', await b.eval(`return /Until/.test(keepTag(C.sessionId))`));
      await b.eval(`document.querySelector('[data-keep-off]').click(); return 1`); await sleep(500);
      t.check('Turn off turns it off', calls.length === 1 && calls[0].action === 'off', calls);
      t.check('and the line goes', await b.eval(`return document.getElementById('cKeep').hidden`));
      // A check-in in the chat is a small line, not your words; a crew's all get the same one.
      const inFeed = await b.eval(`const text = 'From Session Switcher: keep working until 8:07 AM (14 min left; it’s 7:53 AM). Carry on.'; const box = document.createElement('div'); renderItem(box, { kind: 'user', text, at: new Date().toISOString() }, true); renderItem(box, { kind: 'user', text, at: new Date().toISOString() }, true); return { n: box.children.length, cls: box.firstElementChild.className, said: box.textContent, title: box.firstElementChild.title }`);
      t.check('a check-in is a small line in the chat, shown once for a crew', inFeed.n === 1 && /checkin/.test(inFeed.cls) && !/umsg/.test(inFeed.cls) && inFeed.said.includes('Told to carry on, until 8:07 AM') && /14 min left/.test(inFeed.title), inFeed);
      // The morning after: how it ended, on the welcome-back card.
      const card = await b.eval(`Welcome.card = { since: Date.now() - 8 * 36e5, at: Date.now(), morning: true, away: { files: 3, reviews: [], kept: [{ id: ${JSON.stringify(demo.ID['s-bard'])}, at: Date.now() - 36e5, why: 'done', nudges: 14 }, { id: 'not-a-chat-any-more', at: Date.now(), why: 'time', nudges: 2 }] } }; const h = welcomeHtml(); Welcome.card = null; return h`);
      t.check('in the morning, the card says how it ended', /Kept at it while you were away/.test(card) && /Balance pass/.test(card) && /says it’s finished/.test(card) && /14 check-ins/.test(card), card.slice(0, 900));
      t.check('and leaves out a chat that’s gone', !/not-a-chat-any-more/.test(card) && !/its time came/.test(card));
      t.check('what they did is a click away', /What changed in Starfall Tavern/.test(card), card.slice(0, 700));
      const rowMenu = await b.eval(`ChatUI.close(); await go('hub'); await new Promise(r => setTimeout(r, 300)); const id = ${JSON.stringify(demo.ID['s-bard'])}; chatMenu({ x: 300, y: 200 }, id); const has = [...document.querySelectorAll('#menu button')].find(x => /Keep it working until/.test(x.textContent)); const out = { has: !!has }; if (has) { has.click(); await new Promise(r => setTimeout(r, 200)); out.open = document.getElementById('keepDlg').open; out.who = document.getElementById('keepWho').textContent; document.getElementById('keepDlg').close(); } closeMenu(); await ChatUI.open({ sessionId: id }); await new Promise(r => setTimeout(r, 800)); return out`);
      t.check('and from an open chat’s row in the lists', rowMenu.has && rowMenu.open && /Balance pass/.test(rowMenu.who), rowMenu);
      // Several at once: one refusing doesn't stop the rest.
      calls.length = 0;
      const many = await b.eval(`const keys = manyChats().map(x => x.key); openKeepDialog({ keys }); const out = { title: document.getElementById('keepTitle').textContent, who: document.getElementById('keepWho').textContent, go: document.getElementById('keepGo').textContent, how: document.getElementById('keepHowBox').hidden, keys: keys.length }; document.getElementById('keepGo').click(); await new Promise(r => setTimeout(r, 400)); out.open = document.getElementById('keepDlg').open; out.toast = document.getElementById('toast').textContent; return out`);
      t.check('several chats at once', /Keep them working/.test(many.title) && many.go === 'Keep them working' && many.how && calls.length === many.keys && many.keys > 1 && !many.open && new RegExp(many.keys + ' chats keep working').test(many.toast), { many, calls });
      keep = null;
      await b.eval(`await loadActivity(); renderKeep(); return 1`);
      t.check('in Ctrl+K while a chat is open', await b.eval(`openPalette(); await new Promise(r => setTimeout(r, 200)); const box = document.getElementById('palQ'); box.value = 'overnight'; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 200)); const found = /Keep this chat working/.test(document.getElementById('palette').textContent); closePalette(); return found`));
    },
  },
  {
    name: 'chat menu',
    // Short enough to see all of it, with nothing gone.
    async run(t) {
      const b = await t.open({ gemini: true });
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`); await sleep(1500);
      const flat = await b.eval(`return chatHeadItems().filter(x => x !== '-').map(x => x.label)`);
      await b.eval(`document.querySelector('[data-c="more"]').click(); return 1`); await sleep(200);
      const top = await b.eval(`const m = document.getElementById('menu'), r = m.getBoundingClientRect(); return { labels: [...m.querySelectorAll('.m-l')].map(x => x.firstChild.textContent), fits: m.scrollHeight <= m.clientHeight + 1 && r.bottom <= innerHeight, h: Math.round(r.height), stopSeen: [...m.querySelectorAll('button')].some(x => /Stop this chat/.test(x.textContent) && x.getBoundingClientRect().bottom <= innerHeight) }`);
      t.check('all of it fits on the screen, with Stop in sight', top.fits && top.stopSeen, top);
      t.check('and what’s used most is at the top level', ['Find in this chat', 'Rename chat', 'Keep it working until…', 'Continue in a fresh chat…', 'Stop this chat'].every(l => top.labels.includes(l)), top.labels);
      await t.shot(b, 'top');
      // One click in, and back, and nothing's gone.
      const seen = new Set(top.labels);
      const subs = await b.eval(`return [...document.querySelectorAll('#menu button')].filter(x => x.querySelector('.m-more')).map(x => x.querySelector('.m-l').firstChild.textContent)`);
      for (const name of subs) {
        await b.eval(`[...document.querySelectorAll('#menu button')].find(x => x.querySelector('.m-more') && x.querySelector('.m-l').firstChild.textContent === ${JSON.stringify(name)}).click(); return 1`); await sleep(120);
        const inner = await b.eval(`return { labels: [...document.querySelectorAll('#menu .m-l')].map(x => x.firstChild.textContent), focus: document.activeElement.textContent }`);
        inner.labels.forEach(l => seen.add(l));
        t.check(`${name}: opens, with a way back, and the keyboard goes with it`, inner.labels[0] === 'Back' && /Back/.test(inner.focus), inner);
        await b.eval(`[...document.querySelectorAll('#menu button')].find(x => /Back/.test(x.textContent)).click(); return 1`); await sleep(120);
        t.check(`${name}: Back goes back`, await b.eval(`return [...document.querySelectorAll('#menu .m-l')].some(x => /^Stop this chat/.test(x.textContent))`));
      }
      const missing = flat.filter(l => !seen.has(l));
      t.check('everything that was in the long menu is still there', !missing.length, missing);
      await b.esc(); await sleep(100);
      t.check('Ctrl+K still finds them', await b.eval(`openPalette('copy chat id'); await new Promise(r => setTimeout(r, 250)); const found = /Copy chat ID/.test(document.getElementById('palette').textContent); closePalette(); return found`));
      // Right-click too.
      const rc = await b.eval(`const it = ChatUI.contextItems(document.querySelector('#cScroll'), { x: 400, y: 300 }); return it.filter(x => x !== '-').length`);
      t.check('right-clicking the chat gives the same short menu', rc === top.labels.length, { rc, top: top.labels.length });
      // Imperial keeps its long one.
      await b.eval(`Look.set({ theme: 'imperial' }); document.querySelector('[data-c="more"]').click(); return 1`); await sleep(200);
      t.check('Imperial keeps its menu as it was', await b.eval(`const m = document.getElementById('menu'); return !m.querySelector('.m-more') && /Copy chat ID/.test(m.textContent) && /Alerts: Nothing/.test(m.textContent)`));
      await b.esc();
      await b.eval(`Look.set({ theme: 'crimson' }); return 1`);
    },
  },
  {
    name: 'carry on as',
    // Before it runs out: the same conversation, on your other account.
    async run(t) {
      const seen = [];
      const b = await t.open({ demo: false });
      await demo.install(b, { seen: (p, url, body) => { if (['/api/chat/stop', '/api/chat/open'].includes(p)) seen.push([p, body]); } });
      await b.eval('location.reload(); return 1'); await sleep(3000);
      const id = demo.ID['s-bard'];
      await b.eval(`await ChatUI.open({ sessionId: ${JSON.stringify(id)} }); return 1`); await sleep(1500);
      const items = async () => { await b.eval(`document.querySelector('[data-c="more"]').click(); return 1`); await sleep(150); const r = await b.eval(`return [...document.querySelectorAll('#menu button')].filter(x => /Carry on as/.test(x.textContent)).map(x => ({ t: x.textContent.replace(/\\s+/g, ' ').trim(), off: x.disabled || x.getAttribute('aria-disabled') === 'true' }))`); await b.eval(`closeMenu(); return 1`); return r; };
      const me = await b.eval(`return C.info.accountId`);
      const list = await items();
      t.check('the chat’s menu offers its other accounts, not its own', list.length >= 1 && !list.some(x => x.t.includes(me === 'studio' ? 'Studio' : 'Personal')), { me, list });
      t.check('with how much each has left', list.every(x => /the same conversation/.test(x.t)), list);
      await b.eval(`C.state = 'busy'; return 1`);
      t.check('not while it’s replying', (await items()).every(x => x.off));
      await b.eval(`C.state = 'ready'; C.provider = 'codex'; return 1`);
      t.check('Claude’s accounts only', (await items()).length === 0);
      await b.eval(`C.provider = 'claude'; return 1`);
      await b.eval(`document.querySelector('[data-c="more"]').click(); return 1`); await sleep(150);
      seen.length = 0;
      await b.eval(`[...document.querySelectorAll('#menu button')].find(x => /Carry on as/.test(x.textContent)).click(); return 1`); await sleep(1500);
      const stop = seen.find(x => x[0] === '/api/chat/stop'), open = seen.find(x => x[0] === '/api/chat/open');
      t.check('it stops here and resumes as that one, the same conversation', stop && stop[1].switching === true && open && open[1].sessionId === id && open[1].mode === 'resume' && open[1].account && open[1].account !== me, seen);
      t.check('nothing lands in the message box: nothing was lost', await b.eval(`return !document.getElementById('cText').value.trim()`));
    },
  },
  {
    name: 'new chat memory',
    // Who you last started with in a project, and the account with the most left.
    async run(t) {
      const b = await t.open({ gemini: true });
      await sleep(800);
      await b.eval(`window._open = []; window._realOpen = ChatUI.open; ChatUI.open = o => { _open.push(o); return Promise.resolve(); }; return 1`);
      const tavern = demo.projects.find(x => x.name === 'Starfall Tavern').cwd, tide = demo.projects.find(x => x.name === 'Tidecaller').cwd;
      const state = () => b.eval(`const s = document.getElementById('ncAs'); return { prov: NC.prov, value: s.value, options: [...s.options].map(o => o.textContent), pressed: document.querySelector('[data-nc-who][aria-pressed="true"]').textContent }`);
      await b.eval(`openNewChat({ cwd: ${JSON.stringify(tavern)} }); return 1`); await sleep(200);
      let s = await state();
      t.check('the account with the most left is offered', /^Most room: .* \(\d+% left\)$/.test(s.options[0]), s.options);
      t.check('without being picked for you', s.value !== ':room', s.value);
      await b.eval(`const a = document.getElementById('ncAs'); a.value = ':room'; a.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('ncGo').click(); return 1`); await sleep(250);
      const best = await b.eval(`const list = S.accounts.filter(canLaunch).map(a => [a.id, binding(usageOf(a.id))]).filter(x => x[1]).sort((x, y) => y[1].left - x[1].left); return { best: list[0][0], current: S.acct, call: _open[0] }`);
      t.check('and it’s worked out when the chat starts', best.call.cwd === tavern && (best.best === best.current ? !best.call.accountId : best.call.accountId === best.best), best);
      await b.eval(`_open.length = 0; openNewChat({ cwd: ${JSON.stringify(tide)} }); return 1`); await sleep(200);
      await b.eval(`document.querySelector('[data-nc-who="codex"]').click(); document.getElementById('ncGo').click(); return 1`); await sleep(250);
      t.check('another project, with Codex', await b.eval(`return _open[0].provider === 'codex' && _open[0].cwd === ${JSON.stringify(tide)}`));
      await b.eval(`openNewChat({ cwd: ${JSON.stringify(tavern)} }); return 1`); await sleep(200);
      s = await state();
      t.check('back in the first project, it remembers who and which', s.pressed === 'Claude' && s.value === ':room', s);
      await b.eval(`document.querySelector('[data-nc-p=' + JSON.stringify(${JSON.stringify(tide)}) + ']').click(); return 1`); await sleep(200);
      s = await state();
      t.check('picking the other project remembers that one’s', s.pressed === 'Codex', s);
      // The others in from the start.
      await b.eval(`ChatUI.open = _realOpen; window._isOpen = ChatUI.isOpen; ChatUI.isOpen = () => true; ChatUI.open = o => { _open.push(o); C.key = 'k-new' + _open.length; return Promise.resolve(); }; _open.length = 0; openNewChat({ cwd: ${JSON.stringify(tavern)} }); return 1`); await sleep(200);
      const crew0 = await b.eval(`return { boxes: [...document.querySelectorAll('#ncCrew input')].map(x => x.dataset.ncWith), how: !!document.querySelector('[data-nc-how]') }`);
      t.check('the others can come in from the start', crew0.boxes.join() === 'codex,gemini' && !crew0.how, crew0);
      await b.eval(`document.querySelector('[data-nc-with="codex"]').click(); document.querySelector('[data-nc-with="gemini"]').click(); return 1`); await sleep(100);
      await b.eval(`document.querySelector('[data-nc-how="parallel"]').click(); return 1`); await sleep(100);
      t.check('at the same time, it reminds you to say who does what', /Say who does what: “Claude: .* Codex: /.test(await b.eval(`return document.getElementById('ncText').placeholder`)));
      await t.shot(b, 'crew');
      await b.eval(`document.getElementById('ncText').value = 'All of you: the plan.'; document.getElementById('ncGo').click(); return 1`); await sleep(300);
      const crew1 = await b.eval(`return { call: _open[0], group: C.group, target: C.target, open: document.getElementById('ncDlg').open }`);
      t.check('it starts with the first, and the message goes to them all', crew1.call.initialText === 'All of you: the plan.' && !crew1.call.provider && crew1.group.kinds.join() === 'claude,codex,gemini' && crew1.group.how === 'parallel' && crew1.target === 'both', crew1);
      await b.eval(`_open.length = 0; C.group = null; setTarget('main', false); openNewChat({ cwd: ${JSON.stringify(tavern)} }); return 1`); await sleep(200);
      t.check('and it remembers that for this project', await b.eval(`return document.querySelector('[data-nc-with="gemini"]').checked && document.querySelector('[data-nc-how="parallel"]').classList.contains('on')`));
      // Esc at "add it to the open chat?": no chat opened, so the one that's open stays as it was.
      const kept = await b.eval(`ChatUI.open = o => Promise.resolve(); C.group = null; C.key = 'k-same'; document.getElementById('ncGo').click(); await new Promise(r => setTimeout(r, 200)); return { group: C.group, target: C.target }`);
      t.check('if the chat didn’t open, nothing changes in the one that’s open', !kept.group && kept.target === 'main', kept);
      await b.eval(`ChatUI.open = o => { _open.push(o); return Promise.resolve(); }; _open.length = 0; openNewChat({ cwd: ${JSON.stringify(tavern)} }); return 1`); await sleep(150);
      await b.eval(`document.querySelector('[data-nc-who="codex"]').click(); return 1`); await sleep(100);
      t.check('whoever you start with isn’t also a partner', await b.eval(`return !document.querySelector('[data-nc-with="codex"]') && !!document.querySelector('[data-nc-with="claude"]')`));
      await b.eval(`document.querySelector('[data-nc="close"]').click(); ChatUI.open = _realOpen; ChatUI.isOpen = _isOpen; return 1`);

      // Nothing known about usage: no such choice.
      await b.eval(`const was = S.usage; S.usage = {}; openNewChat({ cwd: ${JSON.stringify(tavern)} }); window._s = [...document.getElementById('ncAs').options].map(o => o.textContent); S.usage = was; document.querySelector('[data-nc="close"]').click(); return 1`); await sleep(100);
      t.check('when usage isn’t known, it isn’t offered', await b.eval(`return !_s.some(x => /Most room/.test(x))`));
    },
  },
  {
    name: 'one connection',
    // Against the real app, not the demo: a window opens one stream, however many chats it follows.
    async run(t) {
      const b = await t.open({ demo: false });
      await sleep(1500);
      const r = await b.eval(`return { mux: Live.mux, direct: Live.direct, id: Live.id, token: !!TOKEN }`);
      t.check('the window says it’s using one connection', r.mux && !r.direct, r);
      const bad = await b.eval(`try { await api('/api/chat/watch', { stream: 'nobody', sub: 's1', key: 'not-a-chat' }); return 'no error'; } catch (e) { return e.status; }`);
      t.check('asking for a chat that isn’t there says so', bad === 404 || bad === 409, bad);
    },
  },
  {
    name: 'hub accessibility',
    async run(t) {
      const b = await t.open();
      await sleep(600);
      // Names, headings, ids.
      const shape = await b.eval(`
        const named = el => (el.getAttribute('aria-label') || el.textContent || el.title || (el.querySelector('img[alt]') || {}).alt || '').trim();
        const vis = el => !!el.offsetParent || getComputedStyle(el).position === 'fixed';
        const bad = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"]')].filter(el => vis(el) && !(el.closest('dialog:not([open])')) && !named(el) && !(el.labels && el.labels.length) && el.type !== 'hidden' && el.type !== 'file').map(el => el.outerHTML.slice(0, 120));
        const ids = [...document.querySelectorAll('[id]')].map(x => x.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
        const hs = [...document.querySelectorAll('#page h1, #page h2, #page h3')].filter(vis).map(x => Number(x.tagName[1]));
        let skip = null; hs.forEach((h, i) => { if (i && h > hs[i - 1] + 1 && skip === null) skip = [hs[i - 1], h]; });
        const imgs = [...document.querySelectorAll('#page img, #nav img')].filter(x => !x.hasAttribute('alt')).length;
        const small = [...document.querySelectorAll('#nav button, #page button, .bar button')].filter(el => { const r = el.getBoundingClientRect(); return vis(el) && r.width && r.height && !el.matches('.linkish, .td-b, .o-title button, .r-title') && (r.width < 24 || r.height < 24); }).map(el => (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40));
        return { bad, dup, h1: hs.filter(x => x === 1).length, skip, imgs, small, main: !!document.querySelector('main'), nav: document.querySelector('nav#nav')?.getAttribute('aria-label'), jump: document.getElementById('hubJump')?.getAttribute('aria-label') }`);
      t.check('everything you can press has a name', !shape.bad.length, shape.bad.slice(0, 5));
      t.check('no two things share an id', !shape.dup.length, shape.dup);
      t.check('one main heading, and heading levels don’t skip', shape.h1 === 1 && !shape.skip, shape);
      t.check('pictures say they’re decoration or what they show', !shape.imgs, shape.imgs);
      t.check('nothing to press is smaller than 24 pixels', !shape.small.length, shape.small.slice(0, 8));
      t.check('landmarks are named', shape.main && !!shape.nav && !!shape.jump, shape);
      // Readable: sizes and contrast, in the themes people use, dark and light.
      for (const [theme, mode] of [['crimson', 'dark'], ['crimson', 'light'], ['graphite', 'dark'], ['sapphire', 'light']]) {
        const rows = await b.eval(`Look.set({ theme: '${theme}', mode: '${mode}' }); await new Promise(r => setTimeout(r, 450)); ${TEXT_AUDIT}`);
        const tiny = rows.filter(r => r.size < 11 && !/caret/.test(r.cls));
        const faint = rows.filter(r => !r.disabled && r.ratio < r.needed);
        t.check(`${theme} ${mode}: no text under 11 pixels`, !tiny.length, tiny.slice(0, 5));
        t.check(`${theme} ${mode}: text stands out (4.5:1, large 3:1)`, rows.length > 60 && !faint.length, faint.slice(0, 6));
      }
      await b.eval(`Look.reset(); return 1`); await sleep(300);
      // The keyboard.
      await b.eval(`document.activeElement.blur(); window.scrollTo(0, 0); return 1`);
      await b.key('Tab', 'Tab', 9); await sleep(120);
      const skip = await b.eval(`const a = document.activeElement, r = a.getBoundingClientRect(); return { id: a.id, top: r.top }`);
      t.check('the first Tab is Skip to the page, and it shows', skip.id === 'skipLink' && skip.top >= 0, skip);
      await b.key('Enter', 'Enter', 13); await sleep(150);
      t.check('Enter on it goes to the page', await b.eval(`return document.activeElement.id === 'page'`));
      await b.eval(`document.querySelector('#nav [data-view="hub"]').focus(); return 1`);
      await b.down(); await sleep(60);
      const next = await b.eval(`return document.activeElement.closest('#nav') && (document.activeElement.textContent || '').trim()`);
      t.check('↓ moves down the sidebar', /Commander/.test(next || ''), next);
      await b.key('End', 'End', 35); await sleep(60);
      const end = await b.eval(`const all = [...document.querySelectorAll('#nav button, #nav input')].filter(x => x.offsetParent); return document.activeElement === all.at(-1)`);
      t.check('End goes to its end', end);
      await b.key('Home', 'Home', 36); await sleep(60);
      t.check('Home to its start', await b.eval(`return document.activeElement === [...document.querySelectorAll('#nav button')].filter(x => x.offsetParent)[0]`));
      const ring = await b.eval(`const f = document.querySelector('[data-secfold]'); f.focus(); return getComputedStyle(f, ':focus-visible').outlineStyle || getComputedStyle(f).outlineStyle`);
      t.check('a section’s title can be reached and shows it has focus', ring !== 'none', ring);
      const press = async () => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(150); };
      await press();
      t.check('Enter folds it', await b.eval(`return document.querySelector('[data-secfold]').getAttribute('aria-expanded') === 'false'`));
      await press();
      // Going somewhere is said to a screen reader.
      await b.eval(`go('recent'); return 1`); await sleep(500);
      t.check('a new page is announced', /Recent chats/.test(await b.eval(`return document.getElementById('hubLive').textContent`)));
      await b.eval(`go('hub'); return 1`); await sleep(500);
      // Less motion, asked for: the hub is still all there.
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await b.eval(`location.reload(); return 1`).catch(() => {}); await sleep(3500);
      t.check('with less motion asked for, every project shows', await b.eval(`return [...document.querySelectorAll('#atlas .world')].length > 0 && [...document.querySelectorAll('#atlas .world')].every(x => getComputedStyle(x).opacity === '1')`));
    },
  },
];
