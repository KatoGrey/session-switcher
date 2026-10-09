'use strict';
/* Session Switcher chat window: the conversation, the rail of running chats, and the ledger.
   Uses helpers from app.js: TOKEN, api, esc, toast, S, current, ringById, stamp, wrap, showMenu, closeMenu,
   loadSessions, renderSide, renderMain, Viewer, usageLine, usageOf, binding, hot, miniDial, markSeen,
   updateTitle, statusOf, NEEDS, VERB_NOW, keyOf, findActivity, openActivity, patch. */
(function () {
  const $c = id => document.getElementById(id);
  const C = {
    key: null, info: null, sessionId: null, es: null, lastSeq: 0, state: null, watch: null, watchSig: '',
    attachments: [], historyStart: 0, historyCursor: null, liveText: {}, liveTimer: null, interruptedAt: 0, title: '', folder: '', model: '', provider: 'claude',
    // The Codex helper working inside a Claude chat, which one your next message goes to, and each one's model.
    comp: null, compThread: null, target: 'main', mi: { main: null, comp: null },
  };
  const PROV_NAME = { claude: 'Claude', codex: 'Codex' };
  const codexOK = () => !!(S.codex && S.codex.enabled && S.codex.signedIn);
  const duo = () => !C.watch && C.provider === 'claude' && (codexOK() || !!C.comp);
  const provFor = src => (src === 'comp' ? 'codex' : C.provider);
  const keyFor = src => (src === 'comp' ? C.comp && C.comp.key : C.key);
  const MODE_LABELS = { default: 'Ask before acting', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto', bypassPermissions: 'Skip all checks', dontAsk: 'Never ask' };
  const STATE_LABELS = { starting: 'Starting', ready: 'Ready', busy: 'Working', waiting: 'Needs your OK', ended: 'Stopped', watching: 'Watching live', readonly: 'Read-only' };
  const ARTIFACT_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
  const FILE_EXT = 'md|markdown|mdx|txt|json|jsonl|csv|tsv|log|html?|css|js|mjs|cjs|ts|tsx|jsx|py|ya?ml|toml|xml|sh|ps1|bat|cmd|lua|luau|cs|java|go|rs|sql|ini|png|jpe?g|gif|webp|svg|mp4|m4v|webm|mov|mkv|mp3|wav|ogg|m4a|flac|pdf';
  const PATHY = new RegExp(`^(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|~[\\\\/]|/)?[^\\s<>"|?*]*?(?:\\.(?:${FILE_EXT})|[\\\\/])$`, 'i');
  const BARE = /(^|[\s(“"'[])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)?[\w.-]+(?:[\\/][\w.-]+)*\.(?:md|markdown|txt|json|jsonl|csv|log|html|ya?ml|toml|png|jpe?g|webp|svg|mp4|webm|mov|mp3|wav|pdf))(?=$|[\s),.;:!?”"'\]])/gi;

  /* ---------- markdown (safe: everything is escaped first) ---------- */
  function link(url, inner) { return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`; }
  function fileLink(p, inner) { return `<a class="flink" href="#" data-path="${esc(p)}" title="Open ${esc(p)}">${inner}</a>`; }
  const looksLikePath = c => c.length < 400 && !/\s/.test(c.replace(/^[A-Za-z]:\\[^\\]*/, '')) && PATHY.test(c) && !/^https?:/i.test(c) && /[\w]/.test(c);
  function emphasis(t) {
    return t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  }
  function inline(s) {
    const slots = [];
    const keep = h => `\u0000${slots.push(h) - 1}\u0000`;
    let t = String(s);
    t = t.replace(/`([^`\n]+)`/g, (_, c) => keep(looksLikePath(c.trim()) ? `<code class="flink" data-path="${esc(c.trim())}" role="link" tabindex="0" title="Open ${esc(c.trim())}">${esc(c)}</code>` : `<code>${esc(c)}</code>`));
    t = t.replace(/\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g, (_, txt, a, b) => {
      const url = a || b;
      if (/^https?:\/\//i.test(url)) return keep(link(url, emphasis(esc(txt))));
      if (/^(mailto:|#|javascript:|data:)/i.test(url)) return keep(emphasis(esc(txt)));
      return keep(fileLink(url, emphasis(esc(txt))));
    });
    t = t.replace(/https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g, url => keep(link(url, esc(url))));
    t = t.replace(BARE, (_, pre, p) => `${pre}${keep(fileLink(p, esc(p)))}`);
    t = emphasis(esc(t));
    return t.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n]);
  }
  function plain(s) {
    const slots = [];
    const keep = h => `\u0000${slots.push(h) - 1}\u0000`;
    const t = String(s).replace(/https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g, url => keep(link(url, esc(url))));
    return esc(t).replace(/\n/g, '<br>').replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n]);
  }
  // A light highlighter for code blocks: comments, strings, numbers, keywords and calls. Plenty for
  // reading; it never changes the text, and very long blocks are left plain.
  const KW = {
    js: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false yield delete void static get set super interface type enum implements public private protected readonly as',
    py: 'def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda yield pass break continue global nonlocal async await self del assert',
    sh: 'if then else elif fi for do done while until case esac function in return export local readonly echo cd exit set unset source alias sudo param foreach begin process end try catch',
    c: 'int long short char float double void bool boolean string var const static public private protected class struct enum interface new return if else for while do switch case break continue try catch finally throw using namespace import package func fn let mut impl trait pub match use mod true false null nil self this async await yield defer go select chan map type local function then end and or not',
    css: 'important media supports keyframes from to root',
  };
  const LANG = { js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js', json: 'js', jsonc: 'js', py: 'py', python: 'py', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', ps1: 'sh', powershell: 'sh', pwsh: 'sh', bat: 'sh', cmd: 'sh', yaml: 'py', yml: 'py', toml: 'py', ini: 'py', c: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', java: 'c', go: 'c', rs: 'c', rust: 'c', kotlin: 'c', swift: 'c', lua: 'c', luau: 'c', php: 'c', rb: 'py', ruby: 'py', css: 'css', scss: 'css', less: 'css', html: 'html', xml: 'html', svg: 'html', vue: 'html' };
  const kwSets = {};
  function hl(code, lang) {
    const L = LANG[String(lang || '').toLowerCase()];
    if (!L || code.length > 30000) return esc(code);
    if (L === 'html') return esc(code).replace(/(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([\w:-]+)|([\w:-]+)(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g,
      (m, com, open, tag, attr, eq, val) => (com ? `<span class="tk-c">${com}</span>` : tag ? `${open}<span class="tk-k">${tag}</span>` : `<span class="tk-f">${attr}</span>${eq}<span class="tk-s">${val}</span>`));
    const kws = kwSets[L] || (kwSets[L] = new Set(KW[L].split(' ')));
    const hash = L === 'py' || L === 'sh';
    const dash = /^(lua|luau|sql)$/i.test(lang);   // where -- starts a comment
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|--\[\[[\s\S]*?\]\]|--[^\n]*)|(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-fA-F]+\b)|([A-Za-z_$][\w$]*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      let cls = null;
      if (m[1]) cls = m[1].startsWith('--') && !dash ? null : 'tk-c';
      else if (m[2]) cls = hash ? 'tk-c' : null;
      else if (m[3]) cls = 'tk-s';
      else if (m[4]) cls = 'tk-n';
      else if (m[5]) cls = kws.has(m[5]) ? 'tk-k' : code[re.lastIndex] === '(' ? 'tk-f' : null;
      if (!cls) { if (m[2] || m[1]) re.lastIndex = m.index + (m[1] ? 2 : 1); continue; }
      out += esc(code.slice(last, m.index)) + `<span class="${cls}">${esc(m[0])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  function codeBlock(code, lang) {
    return `<div class="code"><div class="code-h"><span>${esc(lang || 'code')}</span><button type="button" class="code-copy">Copy</button></div><pre><code>${hl(code, lang)}</code></pre></div>`;
  }
  const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  function list(lines, i) {
    const items = [];
    while (i < lines.length) {
      const l = lines[i];
      const m = l.match(LIST_RE);
      if (m) { items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, text: [m[3]] }); i++; continue; }
      if (!l.trim()) { const nx = lines[i + 1]; if (nx && (LIST_RE.test(nx) || /^\s{2,}\S/.test(nx))) { i++; continue; } break; }
      if (/^\s{2,}\S/.test(l) && items.length) { items[items.length - 1].text.push(l.trim()); i++; continue; }
      break;
    }
    let html = '';
    const stack = [];
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
      const top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) { const tag = it.ordered ? 'ol' : 'ul'; html += `<${tag}${it.ordered && it.start > 1 ? ` start="${it.start}"` : ''}>`; stack.push({ indent: it.indent, tag }); }
      else html += '</li>';
      let body = it.text.map(inline).join('<br>');
      body = body.replace(/^\[( |x|X)\]\s+/, (_, x) => `<span class="task ${x.trim() ? 'done' : ''}" aria-hidden="true"></span>`);
      html += `<li>${body}`;
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return { html, next: i };
  }
  function table(lines, i) {
    const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
    const head = cells(lines[i]);
    const align = cells(lines[i + 1]).map(x => (/^:-+:$/.test(x) ? 'center' : /-+:$/.test(x) ? 'right' : ''));
    i += 2;
    const rows = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
    const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
    return { html: `<div class="tbl"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`, next: i };
  }
  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '', i = 0;
    const blockStart = l => /^\s*(```|~~~)/.test(l) || /^\s{0,3}#{1,6}\s/.test(l) || /^\s{0,3}>/.test(l) || LIST_RE.test(l) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/))) {
        const fence = m[1][0].repeat(3), buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        html += codeBlock(buf.join('\n'), m[2]);
        continue;
      }
      if (!line.trim()) { i++; continue; }
      if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { const n = Math.min(6, m[1].length + 1); html += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        html += `<blockquote>${md(buf.join('\n'))}</blockquote>`;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const t = table(lines, i); html += t.html; i = t.next; continue;
      }
      if (LIST_RE.test(line)) { const l = list(lines, i); html += l.html; i = l.next; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      html += `<p>${buf.map(inline).join('<br>')}</p>`;
    }
    return html;
  }

  /* ---------- the ledger: what this chat produced ---------- */
  const L = {};
  let ledgerTimer = null;
  function ledgerReset() { Object.assign(L, { arts: new Map(), links: new Map(), files: new Map(), images: new Map(), cmds: [], todos: null, tasks: new Map(), pendingTasks: new Map() }); renderLedgerSoon(); }
  ledgerReset();
  const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  function ledgerTool(b) {
    const m = b.meta || {};
    if (FILE_TOOLS.has(b.name) && (m.path || b.summary)) {
      const p = m.path || b.summary; const f = L.files.get(p) || { n: 0 };
      f.n++; f.verb = b.name === 'Write' && f.verb !== 'edited' ? 'wrote' : 'edited';
      L.files.delete(p); L.files.set(p, f);
    } else if ((b.name === 'Bash' || b.name === 'PowerShell') && (b.detail || b.summary)) {
      if (!L.cmds.some(c => c.id && c.id === b.id)) L.cmds.push({ id: b.id, text: typeof b.detail === 'string' ? b.detail : b.summary, desc: b.summary, st: b.result ? (b.result.isError ? 'err' : 'ok') : 'run' });
    } else if (b.name === 'TodoWrite' && m.todos) L.todos = m.todos;
    else if (b.name === 'TaskCreate' && m.subject) L.pendingTasks.set(b.id, m.subject);
    else if (b.name === 'TaskUpdate' && m.taskId) {
      const t = L.tasks.get(m.taskId) || { subject: m.subject || `Task ${m.taskId}`, status: 'pending' };
      if (m.status) t.status = m.status; if (m.subject) t.subject = m.subject;
      if (t.status === 'deleted') L.tasks.delete(m.taskId); else L.tasks.set(m.taskId, t);
    }
    if (b.result) ledgerResult(b, b.result);
    renderLedgerSoon();
  }
  function ledgerResult(view, result) {
    if (!view || !result) return;
    if (view.name === 'TaskCreate') {
      const subj = L.pendingTasks.get(view.id) || (view.meta && view.meta.subject);
      const m = String(result.text || '').match(/#(\d+)/);
      if (m && subj && !L.tasks.has(m[1])) L.tasks.set(m[1], { subject: subj, status: 'pending' });
    }
    if (view.name === 'Artifact') { const title = learnArtifact(view, result); for (const u of String(result.text || '').match(ARTIFACT_RE) || []) L.arts.set(u, title || artTitles[u] || 'Artifact'); }
    const c = L.cmds.find(x => x.id && x.id === view.id); if (c) c.st = result.isError ? 'err' : 'ok';
    renderLedgerSoon();
  }
  function ledgerText(text) {
    const s = String(text || '');
    for (const u of s.match(ARTIFACT_RE) || []) if (!L.arts.has(u)) L.arts.set(u, artTitles[u] || 'Artifact');
    for (const m of s.matchAll(/\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g)) { const u = m[2] || m[3]; if (!/^(https?:|mailto:|#|javascript:|data:)/i.test(u)) { L.links.delete(u); L.links.set(u, m[1]); } }
    for (const m of s.matchAll(/`([^`\n]+)`/g)) { const c = m[1].trim(); if (looksLikePath(c) && !L.links.has(c)) L.links.set(c, c); }
    renderLedgerSoon();
  }
  function renderLedgerSoon() { if (!ledgerTimer) ledgerTimer = setTimeout(renderLedger, 180); }
  const base = p => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
  function renderLedger() {
    ledgerTimer = null;
    const box = $c('cLedger'); if (!box || $c('chat').hidden) return;
    const sec = (title, n, body) => `<p class="lg-h">${esc(title)}${n ? ` <span class="count">${n}</span>` : ''}</p>${body}`;
    const id = C.info && C.info.accountId;
    const a = id && acctById(id);
    const b = id ? binding(usageOf(id)) : null;
    let html = '';
    html += sec('This chat', 0, `${a ? `<div class="lg-use">${miniDial(id, 34)}<span class="lu-t"><b>${esc(a.name)}</b><small class="${b && hot(b.left) ? 'hot' : ''}">${esc(usageLine(id) || (a.plan || ''))}</small></span></div>` : ''}
      <dl class="lg-about">
        ${C.watch ? `<dt>Running</dt><dd>${C.watch.source === 'terminal' ? 'In a terminal' : 'In another app'}</dd>` : ''}
        ${C.model ? `<dt>Model</dt><dd>${esc(C.model)}${C.mi.main && C.mi.main.effort ? ` · ${esc(C.mi.main.effort)} effort` : ''}</dd>` : ''}
        ${C.comp && C.mi.comp ? `<dt>Codex helper</dt><dd>${esc(modelLabel(C.mi.comp))}${C.mi.comp.effort ? ` · ${esc(C.mi.comp.effort)}` : ''}</dd>` : ''}
        ${C.info && C.info.permissionMode ? `<dt>Mode</dt><dd>${esc(($c('cMode').selectedOptions[0] || {}).textContent || $c('cMode').value)}</dd>` : ''}
        ${C.info && C.info.cwd ? `<dt>Folder</dt><dd><button class="linkish" data-file="." title="${esc(C.info.cwd)}">${esc(C.info.cwd)}</button></dd>` : ''}
        ${C.sessionId ? `<dt>Chat ID</dt><dd><button class="linkish" data-copy="${esc(C.sessionId)}" title="Copy the chat ID">${esc(C.sessionId.slice(0, 8))}…</button></dd>` : ''}
      </dl>`);
    const arts = [...L.arts.entries()].reverse();
    if (arts.length) html += sec('Artifacts', arts.length, `<ul class="lg-list">${arts.map(([u, t]) => `<li class="lg-i"><span class="glyph" aria-hidden="true">✦</span><span class="lg-t"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">${esc(t)}</a></span></li>`).join('')}</ul>`);
    const imgs = [...L.images.entries()].reverse();
    if (imgs.length) html += sec('Images it made', imgs.length, `<ul class="lg-list">${imgs.map(([p, t]) => `<li class="lg-i"><span class="glyph" aria-hidden="true">❖</span><span class="lg-t"><button class="linkish" data-file="${esc(p)}" title="${esc(p)}">${esc(t.length > 60 ? `${t.slice(0, 59)}…` : t)}</button></span></li>`).join('')}</ul>`);
    const links = [...L.links.entries()].reverse().slice(0, 30);
    if (links.length) html += sec('Files it pointed to', links.length, `<ul class="lg-list">${links.map(([p, t]) => `<li class="lg-i"><span class="glyph" aria-hidden="true">${/[\\/]$/.test(p) ? '❖' : '✧'}</span><span class="lg-t"><button class="linkish" data-file="${esc(p)}" title="${esc(p)}">${esc(t === p ? base(p) : t)}</button></span></li>`).join('')}</ul>`);
    const files = [...L.files.entries()].reverse().slice(0, 40);
    if (files.length) html += sec('Files changed', files.length, `<ul class="lg-list">${files.map(([p, f]) => `<li class="lg-i"><span class="glyph" aria-hidden="true">${f.verb === 'wrote' ? '✥' : '◈'}</span><span class="lg-t"><button class="linkish" data-file="${esc(p)}" title="${esc(p)}">${esc(base(p))}</button></span><span class="lg-m">${f.verb}${f.n > 1 ? ` ×${f.n}` : ''}</span></li>`).join('')}</ul>`);
    const tasks = L.todos ? L.todos.map(t => ({ subject: t.content, status: t.status })) : [...L.tasks.values()];
    if (tasks.length) {
      const done = tasks.filter(t => t.status === 'completed').length;
      html += sec('Tasks', `${done}/${tasks.length}`, `<ul class="lg-list">${tasks.map(t => `<li class="lg-i ${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : ''}"><span class="glyph" aria-hidden="true">${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'}</span><span class="lg-t" title="${esc(t.subject)}">${esc(t.subject)}</span></li>`).join('')}</ul>`);
    }
    const cmds = L.cmds.slice(-14).reverse();
    if (cmds.length) html += sec('Commands', L.cmds.length, `<ul class="lg-list">${cmds.map(c => `<li class="lg-i" title="${esc(c.text)}"><span class="t-st ${c.st}" aria-hidden="true" style="margin-top:6px"></span><span class="lg-t"><code>${esc(c.text.split('\n')[0])}</code></span></li>`).join('')}</ul>`);
    if (!arts.length && !imgs.length && !links.length && !files.length && !tasks.length && !cmds.length) html += '<p class="lg-empty">Artifacts, files, commands and tasks from this chat collect here as it works.</p>';
    box.innerHTML = html;
  }

  /* ---------- building blocks ---------- */
  const artTitles = {};
  function modelName(m) {
    if (!m) return '';
    const big = /\[1m\]$/i.test(m); if (big) return `${modelName(String(m).replace(/\[1m\]$/i, ''))} · 1M`;
    if (/^(gpt|o\d)/i.test(m)) return String(m).replace(/^gpt/i, 'GPT').replace(/-(\d)/, '-$1');
    const parts = String(m).replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
    const words = parts.filter(x => !/^\d+$/.test(x)).map(w => w[0].toUpperCase() + w.slice(1));
    return `${words.join(' ')} ${parts.filter(x => /^\d+$/.test(x)).join('.')}`.trim();
  }
  // The model a chat is on, as its picker names it ("Sonnet 5.5"), else from the model's id.
  function modelLabel(mi) {
    if (!mi) return '';
    const m = (mi.models || []).find(x => x.value === mi.model);
    if (m && m.value !== 'default') return m.label;
    return modelName(mi.resolvedModel || mi.model) || (m ? m.label : '');
  }
  function learnArtifact(view, result) {
    const urls = String(result && result.text || '').match(ARTIFACT_RE) || [];
    let title = view && view.title;
    if (!title) { try { title = JSON.parse(result.text).title; } catch { /* not JSON */ } }
    for (const u of urls) if (title) artTitles[u] = title;
    return title;
  }
  function artifactCards(text, title, scope) {
    const urls = [...new Set(String(text || '').match(ARTIFACT_RE) || [])]
      .filter(u => !scope || !scope.querySelector(`.art[href="${CSS.escape(u)}"]`));
    return urls.map(u => `<a class="art" href="${esc(u)}" target="_blank" rel="noopener noreferrer">
      <span class="art-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 7.5h15" stroke="currentColor" stroke-width="1.5"/></svg></span>
      <span class="art-t"><b>${esc(title || artTitles[u] || 'Artifact')}</b><small>${esc(u.replace('https://', ''))}</small></span><span class="art-open">Open</span></a>`).join('');
  }
  // A picture on disk, shown through the app (the same folders the file viewer may open).
  function imageUrl(p) {
    const q = new URLSearchParams({ token: TOKEN, path: p });
    if (C.key) q.set('key', C.key);
    const sid = C.watch ? C.watch.sessionId : C.sessionId;
    if (sid) q.set('session', sid);
    return `/api/image?${q}`;
  }
  // Videos, sound and PDFs on disk, streamed through the app (same folders as the file viewer).
  function mediaUrl(p) { return imageUrl(p).replace('/api/image?', '/api/media?'); }
  const VIDEO_RE = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i, AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|flac|aac)$/i;
  // Files attached to a message (saved under attachments/), shown as players or file cards.
  const ATTACH_LINE = /^Attached file: `([^`\n]+)`(?: \(([^)\n]*)\))?$/;
  function attachedFiles(list) {
    if (!list.length) return '';
    return `<div class="afiles">${list.map(([p, info]) => (VIDEO_RE.test(p) ? `<figure class="af-media"><video controls preload="metadata" src="${esc(mediaUrl(p))}"></video><figcaption><button type="button" class="linkish" data-file="${esc(p)}">${esc(base(p))}</button>${info ? ` · ${esc(info)}` : ''}</figcaption></figure>`
      : AUDIO_RE.test(p) ? `<figure class="af-media audio"><audio controls preload="metadata" src="${esc(mediaUrl(p))}"></audio><figcaption><button type="button" class="linkish" data-file="${esc(p)}">${esc(base(p))}</button>${info ? ` · ${esc(info)}` : ''}</figcaption></figure>`
      : `<button type="button" class="af-file" data-file="${esc(p)}"><span class="af-ico" aria-hidden="true">${fileGlyph(p)}</span><span class="af-t"><b>${esc(base(p))}</b>${info ? `<small>${esc(info)}</small>` : ''}</span></button>`)).join('')}</div>`;
  }
  const fileGlyph = p => (/\.pdf$/i.test(p) ? 'PDF' : VIDEO_RE.test(p) ? '▶' : AUDIO_RE.test(p) ? '♪' : (String(p).split('.').pop() || 'file').slice(0, 4).toUpperCase());
  function images(list) {
    if (!list || !list.length) return '';
    return `<div class="imgs">${list.map(im => (im.path ? `<button type="button" class="thumb" data-full="${esc(imageUrl(im.path))}"><img src="${esc(imageUrl(im.path))}" alt="Image" loading="lazy"></button>`
      : im.src ? `<button type="button" class="thumb" data-full="${esc(im.src)}"><img src="${esc(im.src)}" alt="Attached image"></button>`
      : im.url ? `<a class="thumb-link" href="${esc(im.url)}" target="_blank" rel="noopener noreferrer">Image link</a>` : '<span class="thumb-missing">Image too large to preview</span>')).join('')}</div>`;
  }
  const TOOL_VERBS = { Bash: 'Ran', PowerShell: 'Ran', Read: 'Read', Write: 'Wrote', Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited', Glob: 'Found', Grep: 'Searched', WebFetch: 'Fetched', WebSearch: 'Searched', Agent: 'Delegated', Task: 'Delegated', TodoWrite: 'Tasks', TaskCreate: 'Task', TaskUpdate: 'Task', Artifact: 'Artifact', AskUserQuestion: 'Asked' };
  function toolDetail(view) {
    if (view.detailKind === 'diff' && view.detail) return `<div class="diff"><pre class="del">${esc(view.detail.old || '')}</pre><pre class="add">${esc(view.detail.new || '')}</pre></div>`;
    if (!view.detail) return '';
    return `<pre class="t-in ${view.detailKind === 'command' ? 'cmd' : ''}">${esc(view.detail)}</pre>`;
  }
  function toolResultHtml(r) {
    if (!r) return '';
    return `${r.text ? `<pre class="t-out ${r.isError ? 'err' : ''}">${esc(r.text)}</pre>` : ''}${images(r.images)}`;
  }
  function toolEl(b, live) {
    const d = document.createElement('details');
    d.className = 'tool';
    d.dataset.toolId = b.id || '';
    d.dataset.name = b.name;
    const st = b.result ? (b.result.isError ? 'err' : 'ok') : (live ? 'run' : '');
    const filePath = (b.meta && b.meta.path) || (b.name === 'Read' ? b.summary : null);
    d.innerHTML = `<summary><span class="t-st ${st}" aria-hidden="true"></span><span class="t-name">${esc(TOOL_VERBS[b.name] || b.name)}</span><span class="t-sum">${esc(b.summary || '')}</span><span class="t-time"></span></summary>
      <div class="t-body">${b.name && !TOOL_VERBS[b.name] ? `<p class="t-tool">Tool: ${esc(b.name)}</p>` : ''}${filePath ? `<button type="button" class="btn quiet sm t-open" data-file="${esc(filePath)}">Open ${esc(base(filePath))}</button>` : ''}${toolDetail(b)}<div class="t-res">${toolResultHtml(b.result)}</div></div>`;
    d._view = b;
    ledgerTool(b);
    return d;
  }
  const lastTool = (root, id) => { const all = root.querySelectorAll(`.tool[data-tool-id="${CSS.escape(id || '')}"]`); return all[all.length - 1] || null; };
  function setToolResult(root, id, result) {
    const d = lastTool(root, id);
    if (!d) return;
    const s = d.querySelector('.t-st'); s.className = `t-st ${result.isError ? 'err' : 'ok'}`;
    d.querySelector('.t-time').textContent = '';
    d.querySelector('.t-res').innerHTML = toolResultHtml(result);
    ledgerResult(d._view, result);
    if (d.dataset.name === 'Artifact') {
      const cards = artifactCards(result.text, learnArtifact(d._view, result), d.closest('.turn'));
      if (cards) d.closest('.tools').insertAdjacentHTML('afterend', `<div class="arts">${cards}</div>`);
    }
    updateGroup(d.closest('.tools'));
  }
  function updateGroup(g) {
    if (!g) return;
    const n = g.querySelectorAll('.tool').length;
    const btn = g.querySelector('.tg-more');
    if (n > 3) {
      btn.hidden = false;
      btn.textContent = g.classList.contains('open') ? 'Show fewer steps' : `Show ${n - 3} earlier step${n - 3 === 1 ? '' : 's'}`;
    } else btn.hidden = true;
  }

  /* ---------- feed rendering ---------- */
  // True while a live event is being drawn, so only new messages fade in (not history).
  let liveRender = false;
  // Which of the two is being drawn (Claude, or the Codex helper), so each reply sits under its own name.
  let curProv = null;
  const provNow = () => curProv || C.provider;
  function lastTurn(root, make) {
    const prov = provNow();
    const last = root.lastElementChild;
    if (last && last.classList.contains('turn') && (last.dataset.prov || C.provider) === prov) return last;
    if (!make) return null;
    const t = document.createElement('div');
    t.className = liveRender ? 'turn fresh' : 'turn';
    t.dataset.prov = prov;
    const relay = C.provider === 'claude' && (codexOK() || C.compThread || C.comp);
    t.innerHTML = `<div class="who"><span class="who-n">${PROV_NAME[prov]}</span><span class="who-m"></span><span class="turn-act">
      <button type="button" class="ta" data-c="copyturn" title="Copy this reply">Copy</button>
      ${relay ? `<button type="button" class="ta relay" data-c="relay" title="${prov === 'codex' ? 'Quote this to Claude' : 'Quote this to Codex, for an image, a test or a second opinion'}">${prov === 'codex' ? 'Send to Claude' : 'Ask Codex'}</button>` : ''}</span></div>`;
    root.appendChild(t);
    return t;
  }
  function part(root, mid, model) {
    let p = mid ? root.querySelector(`.part[data-mid="${CSS.escape(mid)}"]`) : null;
    if (p) return p;
    const had = !!lastTurn(root, false);
    const turn = lastTurn(root, true);
    if (model) { const wm = turn.querySelector('.who-m'); if (wm && !wm.textContent) wm.textContent = modelName(model); }
    if (!p) {
      p = document.createElement('div');
      p.className = liveRender && had ? 'part fresh' : 'part';
      if (mid) p.dataset.mid = mid;
      p.innerHTML = '<div class="final"></div><div class="md live"></div>';
      turn.appendChild(p);
    }
    return p;
  }
  // A picture Codex is making or made.
  function genImage(b, develop) {
    const src = b.src || (b.path ? imageUrl(b.path) : null);
    const frame = src ? `<button type="button" class="thumb gen-img" data-full="${esc(src)}"><img src="${esc(src)}" alt="${esc(b.prompt || 'Generated image')}"></button>`
      : b.status === 'failed' ? `<div class="gen-wait failed">${esc(b.failure || 'The image couldn’t be made.')}</div>`
      : '<div class="gen-wait"><span class="gen-spin" aria-hidden="true"></span>Drawing the image…</div>';
    const give = b.path && C.provider === 'claude' ? `<button type="button" class="btn sm codexbtn" data-giveimg="${esc(b.path)}" title="Attach this picture to your next message to Claude">Give to Claude</button>` : '';
    const acts = b.path ? `<div class="gen-act">${give}<button type="button" class="btn quiet sm" data-file="${esc(b.path)}">Open</button><button type="button" class="btn quiet sm" data-reveal="${esc(b.path)}">Show in folder</button><button type="button" class="btn quiet sm" data-copy="${esc(b.path)}">Copy path</button></div>` : '';
    return `<figure class="gen ${b.status || ''} ${develop && src ? 'develop' : ''}" data-gid="${esc(b.id || '')}"><div class="gen-frame">${frame}</div>${b.prompt ? `<figcaption>${esc(b.prompt)}</figcaption>` : ''}${acts}</figure>`;
  }
  function addBlock(p, b, live) {
    const fin = p.querySelector('.final');
    if (b.type === 'image') {
      const old = b.id ? $c('cFeed').querySelector(`.gen[data-gid="${CSS.escape(b.id)}"]`) : null;
      // A picture that finishes while you watch develops in place.
      const develop = liveRender && !!(old && !old.querySelector('img'));
      if (old) old.outerHTML = genImage(b, develop); else fin.insertAdjacentHTML('beforeend', genImage(b, liveRender));
      if (b.path) { L.images.set(b.path, b.prompt || base(b.path)); renderLedgerSoon(); }
      return;
    }
    if (b.type === 'tool') {
      let g = fin.lastElementChild;
      if (!g || !g.classList.contains('tools')) {
        g = document.createElement('div');
        g.className = 'tools';
        g.innerHTML = '<button type="button" class="tg-more" hidden></button>';
        fin.appendChild(g);
      }
      const te = toolEl(b, live); if (liveRender) te.classList.add('fresh');
      g.appendChild(te);
      if (b.result && b.name === 'Artifact') { const cards = artifactCards(b.result.text, learnArtifact(b, b.result), p.closest('.turn')); if (cards) g.insertAdjacentHTML('afterend', `<div class="arts">${cards}</div>`); }
      updateGroup(g);
      return;
    }
    if (b.type === 'thinking') {
      fin.insertAdjacentHTML('beforeend', `<details class="think"><summary>Thinking</summary><div class="think-t">${plain(b.text)}</div></details>`);
      return;
    }
    ledgerText(b.text);
    const cards = artifactCards(b.text, null, p.closest('.turn'));
    const div = document.createElement('div');
    div.className = 'md';
    div.innerHTML = md(b.text);
    RAW.set(div, b.text);
    fin.appendChild(div);
    if (cards) fin.insertAdjacentHTML('beforeend', `<div class="arts">${cards}</div>`);
  }
  // The markdown behind each reply and message, for copying, quoting and exporting.
  const RAW = new WeakMap();
  const turnMarkdown = turn => [...turn.querySelectorAll('.final > .md')].map(x => RAW.get(x) || x.innerText).filter(Boolean).join('\n\n').trim();
  const shortTime = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  function renderItem(root, it, live) {
    if (it.kind === 'user') {
      const d = document.createElement('div');
      const toCodex = provNow() === 'codex' && C.provider !== 'codex';
      d.className = `${liveRender ? 'umsg fresh' : 'umsg'}${toCodex ? ' to-codex' : ''}`;
      // "Attached file: `path` (info)" lines become players and file cards.
      const files = [];
      const text = String(it.text || '').split('\n').filter(l => { const m = l.trim().match(ATTACH_LINE); if (m) files.push([m[1], m[2] || '']); return !m; }).join('\n').trim();
      RAW.set(d, String(it.text || ''));
      d.innerHTML = `${toCodex ? '<span class="to-tag">to Codex</span>' : ''}<div class="ububble">${text ? `<div class="utext">${plain(text)}</div>` : ''}${images(it.images)}${attachedFiles(files)}</div>${it.at ? `<span class="utime">${esc(stamp(Date.parse(it.at)))}</span>` : ''}`;
      root.appendChild(d);
    } else if (it.kind === 'assistant') {
      const mi = C.mi[provNow() === 'codex' && C.provider !== 'codex' ? 'comp' : 'main'];
      const model = it.model || (live && mi ? mi.replyModel || mi.resolvedModel || mi.model : null);
      const p = part(root, it.mid, model);
      const wm = p.closest('.turn').querySelector('.who-m');
      if (wm && model && model !== '<synthetic>' && !wm.textContent) wm.textContent = modelName(model);
      const who = p.closest('.turn').querySelector('.who');
      if (it.at && who && !who.querySelector('.who-time')) who.querySelector('.who-m').insertAdjacentHTML('afterend', `<time class="who-time" datetime="${esc(it.at)}" title="${esc(stamp(Date.parse(it.at)))}">${esc(shortTime(Date.parse(it.at)))}</time>`);
      for (const b of it.blocks) addBlock(p, b, live);
      if (it.aborted) p.querySelector('.final').insertAdjacentHTML('beforeend', '<p class="aborted">Stopped before finishing.</p>');
    } else if (it.kind === 'notice') {
      root.insertAdjacentHTML('beforeend', `<div class="cnotice ${esc(it.level || 'info')}${liveRender ? ' fresh' : ''}" role="note"><span class="cn-dot" aria-hidden="true"></span><span>${plain(it.text)}</span></div>`);
    }
  }

  /* ---------- scrolling ---------- */
  const scroller = () => $c('cScroll');
  const nearBottom = () => { const s = scroller(); return s.scrollHeight - s.scrollTop - s.clientHeight < 140; };
  const toBottom = () => { const s = scroller(); s.scrollTop = s.scrollHeight; };
  function withStick(fn) { const stick = nearBottom(); fn(); if (stick) toBottom(); else noteUnseen(); }
  // "Jump to latest": shown while you're reading further up; counts what arrived meanwhile.
  let unseen = 0, jumpRaf = 0;
  function noteUnseen() { if (!liveRender) return; unseen++; syncJump(); }
  function syncJump() {
    const b = $c('cJump'); if (!b) return;
    const away = !nearBottom();
    if (!away) unseen = 0;
    b.hidden = !away || $c('chat').hidden;
    if (!away && C.watchPending) refreshWatch();
    b.innerHTML = `<span aria-hidden="true">↓</span>${unseen ? `${unseen} new` : 'Latest'}`;
    b.classList.toggle('has-new', unseen > 0);
  }
  function jumpLatest() { const s = scroller(); s.scrollTo({ top: s.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); unseen = 0; syncJump(); }

  /* ---------- export to Markdown ---------- */
  function chatMarkdown() {
    const out = [`# ${C.title || 'Chat'}`, '', `_${[C.folder, C.model, new Date().toLocaleString()].filter(Boolean).join(' · ')}_`, ''];
    for (const el of $c('cFeed').children) {
      if (el.classList.contains('umsg')) out.push(`**You${el.classList.contains('to-codex') ? ' → Codex' : ''}:**`, '', RAW.get(el) || el.innerText.trim(), '');
      else if (el.classList.contains('turn')) {
        const text = turnMarkdown(el);
        const steps = el.querySelectorAll('.tool').length;
        if (!text && !steps) continue;
        out.push(`**${PROV_NAME[el.dataset.prov] || 'Claude'}:**`, '');
        if (steps) out.push(`_(${steps} step${steps === 1 ? '' : 's'})_`, '');
        if (text) out.push(text, '');
      } else if (el.classList.contains('cnotice')) out.push(`> ${el.innerText.trim()}`, '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  function exportChat() {
    const text = chatMarkdown();
    const name = `${String(C.title || 'chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'chat'}.md`;
    if (window.Android) { navigator.clipboard.writeText(text).then(() => toast('Copied the chat as Markdown.'), () => toast('Couldn’t copy.')); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Saved ${name} to your Downloads.`, 3000);
  }

  /* ---------- find in this chat (Ctrl+F) ---------- */
  const Find = { hits: [], i: -1 };
  const canMark = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function openFind(q) {
    const bar = $c('cFind'); bar.hidden = false;
    const inp = $c('cFindQ');
    if (q) inp.value = q;
    inp.focus(); inp.select();
    runFind();
  }
  function closeFind() {
    $c('cFind').hidden = true; Find.hits = []; Find.i = -1;
    if (canMark) { CSS.highlights.delete('find'); CSS.highlights.delete('find-cur'); }
  }
  function runFind() {
    const q = $c('cFindQ').value.trim().toLowerCase();
    Find.hits = []; Find.i = -1;
    if (q.length >= 2) {
      const walk = document.createTreeWalker($c('cFeed'), NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest('.turn-act, .code-h, button.c-earlier, .c-welcome') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      let n;
      while ((n = walk.nextNode()) && Find.hits.length < 2000) {
        const t = n.nodeValue.toLowerCase();
        for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + q.length); Find.hits.push(r); }
      }
    }
    if (canMark) { CSS.highlights.delete('find-cur'); if (Find.hits.length) CSS.highlights.set('find', new Highlight(...Find.hits)); else CSS.highlights.delete('find'); }
    stepFind(1, true);
  }
  function stepFind(d, fromStart) {
    const n = Find.hits.length;
    $c('cFindN').textContent = !$c('cFindQ').value.trim() ? '' : n ? `${(fromStart ? n - 1 : (Find.i + d + n) % n) + 1} of ${n}` : 'No matches';
    if (!n) return;
    Find.i = fromStart ? n - 1 : (Find.i + d + n) % n;   // starts at the newest match
    const r = Find.hits[Find.i];
    for (let el = r.startContainer.parentElement; el; el = el.parentElement) if (el.tagName === 'DETAILS' && !el.open) el.open = true;
    if (canMark) CSS.highlights.set('find-cur', new Highlight(r));
    const box = r.getBoundingClientRect(), s = scroller(), sb = s.getBoundingClientRect();
    if (box.top < sb.top + 60 || box.bottom > sb.bottom - 60) s.scrollTop += box.top - sb.top - s.clientHeight / 2;
    $c('cFindN').textContent = `${Find.i + 1} of ${n}`;
  }

  /* ---------- live events ---------- */
  // A streaming reply: paragraphs that are finished render once; only the one being written
  // re-renders as it grows, so long replies stay smooth.
  function stableCut(text) {
    let fence = false, cut = 0, at = 0;
    for (const line of text.split('\n')) {
      at += line.length + 1;
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      else if (!fence && !line.trim() && at <= text.length) cut = at;
    }
    return cut;
  }
  function flushLive() {
    C.liveTimer = null;
    for (const [mid, text] of Object.entries(C.liveText)) {
      const p = $c('cFeed').querySelector(`.part[data-mid="${CSS.escape(mid)}"] .live`);
      if (!p) continue;
      let done = p.firstElementChild && p.firstElementChild.classList.contains('live-done') ? p.firstElementChild : null;
      if (!done) { p.innerHTML = '<div class="live-done"></div><div class="live-tail"></div>'; done = p.firstElementChild; done._len = 0; }
      const cut = stableCut(text);
      withStick(() => {
        if (cut !== done._len) { done.innerHTML = md(text.slice(0, cut)); done._len = cut; }
        p.lastElementChild.innerHTML = md(text.slice(cut));
      });
    }
  }
  function setState(s) {
    C.state = s;
    const pill = $c('cState');
    pill.textContent = STATE_LABELS[s] || s;
    pill.className = `c-state ${s}`;
    syncSend();
  }
  // Stop, the typing dots and Send/Queue follow whichever one your next message goes to.
  function syncSend() {
    const comp = C.target === 'comp' && duo();
    const s = comp ? (C.comp ? C.comp.state : 'ready') : C.state;
    const busy = s === 'busy' || s === 'waiting';
    const name = PROV_NAME[comp ? 'codex' : C.provider];
    $c('cStop').hidden = !busy;
    $c('cStop').title = `Stop ${name} (Esc)`;
    $c('cTyping').hidden = s !== 'busy';
    $c('cTyping').classList.toggle('codex', comp || C.provider === 'codex');
    $c('cSend').textContent = busy ? 'Queue' : 'Send';
    $c('cSend').title = busy ? `${name} is working; this will be sent when it’s ready` : `Send to ${name}`;
    $c('chat').classList.toggle('to-codex', comp);
  }
  function setStatus(src, t) {
    if (src === 'comp') { if (C.comp) { C.comp.status = t; renderCrewSoon(); } return; }
    $c('cStatus').textContent = t;
  }
  function handle(ev, src = 'main') {
    const box = src === 'comp' ? C.comp : C;
    if (!box) return;
    if (ev.seq) { if (ev.seq <= box.lastSeq) return; box.lastSeq = ev.seq; }
    liveRender = true; curProv = provFor(src);
    try { handleEvent(ev, src); } finally { liveRender = false; curProv = null; }
  }
  function handleEvent(ev, src) {
    const feed = $c('cFeed');
    const comp = src === 'comp';
    switch (ev.kind) {
      case 'state':
        if (comp) { C.comp.state = ev.state; if (ev.state !== 'busy') C.comp.status = ''; renderCrew(); syncSend(); break; }
        setState(ev.state); if (ev.state !== 'busy') { $c('cStatus').textContent = ''; } renderCrew(); break;
      case 'model': {
        C.mi[src] = ev;
        if (!comp) { C.model = modelLabel(ev); $c('cModel').textContent = C.model; }
        renderCrew(); renderLedgerSoon();
        if (Pick.src === src && !$c('cPick').hidden) renderPick();
        break;
      }
      case 'init':
        if (comp) { C.comp.sessionId = ev.sessionId; break; }
        setTimeout(syncFav, 0);
        C.sessionId = ev.sessionId || C.sessionId;
        if (ev.permissionMode) setMode(ev.permissionMode);
        C.model = modelName(ev.model);
        $c('cModel').textContent = C.model;
        renderLedgerSoon();
        break;
      case 'status': if (ev.permissionMode && !comp) setMode(ev.permissionMode); if (ev.status === 'compacting') setStatus(src, 'Summarizing the conversation…'); if (ev.text) setStatus(src, ev.text); break;
      case 'plan': L.todos = ev.steps || []; renderLedgerSoon(); break;
      case 'user': feed.querySelector('.c-welcome')?.remove(); withStick(() => renderItem(feed, ev, true)); toBottom(); break;
      case 'stream_start': withStick(() => part(feed, ev.mid)); break;
      case 'delta':
        if (ev.thinking) { setStatus(src, 'Thinking…'); break; }
        setStatus(src, comp ? 'Writing…' : '');
        part(feed, ev.mid);
        C.liveText[ev.mid] = (C.liveText[ev.mid] || '') + ev.text;
        if (!C.liveTimer) C.liveTimer = setTimeout(flushLive, C.liveText[ev.mid].length > 8000 ? 250 : 90);
        break;
      case 'assistant': {
        delete C.liveText[ev.mid];
        withStick(() => {
          renderItem(feed, ev, true);
          const lv = feed.querySelector(`.part[data-mid="${CSS.escape(ev.mid)}"] .live`);
          if (lv) lv.innerHTML = '';
        });
        break;
      }
      case 'tool_start': setStatus(src, `Using ${ev.name}…`); break;
      case 'tool_progress': {
        const tool = lastTool(feed, ev.toolUseId);
        if (tool) tool.querySelector('.t-time').textContent = `${ev.seconds}s`;
        setStatus(src, `${ev.name || 'Tool'} running, ${ev.seconds}s`);
        break;
      }
      case 'tool_result': withStick(() => setToolResult(feed, ev.toolUseId, ev.result)); break;
      case 'notice': withStick(() => renderItem(feed, ev, true)); break;
      case 'permission': addPermission(ev, src); break;
      case 'permission_cancel': case 'permission_done': removePermission(ev.requestId, src); break;
      case 'result':
        setStatus(src, '');
        if (!ev.ok && Date.now() - C.interruptedAt > 8000 && (ev.errors.length || ev.text)) {
          withStick(() => renderItem(feed, { kind: 'notice', level: 'warning', text: ev.text || ev.errors.join('\n') || `${PROV_NAME[provFor(src)]} stopped with an error.` }));
        }
        break;
      case 'ended': {
        if (comp) {
          // The helper stopping doesn't end the Claude chat; your next message to Codex starts it again.
          C.comp.ended = true; C.comp.state = 'ended'; if (C.comp.es) C.comp.es.close();
          for (const card of $c('cPending').querySelectorAll('.perm')) if (card._src === 'comp') card.remove();
          if (!ev.stopped) withStick(() => renderItem(feed, { kind: 'notice', level: 'info', text: 'The Codex helper stopped. Your next message to Codex starts it again.' }));
          renderCrew(); syncSend();
          break;
        }
        setState('ended');
        // The Codex helper may still be running and waiting on you; keep its cards.
        for (const card of $c('cPending').querySelectorAll('.perm')) if (card._src !== 'comp') card.remove();
        const why = ev.stopped ? 'This chat was stopped.' : ev.code ? 'Claude Code stopped unexpectedly.' : 'Claude Code finished and closed this chat.';
        withStick(() => feed.insertAdjacentHTML('beforeend', `<div class="ended"><p><b>${why}</b> Your conversation is saved; start it again to keep going.</p>${ev.detail ? `<pre class="t-out err">${esc(ev.detail)}</pre>` : ''}<button type="button" class="btn prime" data-c="restart">Start again</button></div>`));
        toBottom();
        break;
      }
      default: break;
    }
  }

  /* ---------- permissions & questions ---------- */
  function verbFor(p) {
    switch (p.toolName) {
      case 'Bash': case 'PowerShell': return 'run a command';
      case 'Edit': case 'MultiEdit': return 'edit a file';
      case 'Write': return 'create or overwrite a file';
      case 'WebFetch': return 'open a web page';
      case 'WebSearch': return 'search the web';
      default: return `use ${p.toolName}`;
    }
  }
  function addPermission(p, src = 'main') {
    const box = $c('cPending');
    if (box.querySelector(`[data-req="${CSS.escape(`${src}:${p.requestId}`)}"]`)) return;
    const card = document.createElement('div');
    const name = PROV_NAME[provFor(src)];
    card.className = `perm ${provFor(src) === 'codex' ? 'codex' : ''}`;
    card.dataset.req = `${src}:${p.requestId}`;
    card._src = src;
    if (p.questions && p.questions.length) {
      card.classList.add('ask');
      card.innerHTML = `<p class="perm-h">${name} has <b>${p.questions.length === 1 ? 'a question' : `${p.questions.length} questions`}</b></p>
        ${p.questions.map((q, qi) => `<fieldset class="q" data-qi="${qi}"><legend>${q.header ? `<span class="q-h">${esc(q.header)}</span>` : ''}${esc(q.question)}</legend>
          ${q.options.map((o, oi) => `<label class="opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="${oi}"><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}
          <label class="opt other"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="other"><span><b>Other</b><input type="text" class="other-t" placeholder="Type your own answer" aria-label="Your own answer"></span></label></fieldset>`).join('')}
        <div class="perm-b"><button type="button" class="btn gilt" data-p="answer">Send answers</button><button type="button" class="btn" data-p="deny">Skip</button></div>`;
    } else {
      const v = p.view || {};
      card.innerHTML = `<p class="perm-h">${name} wants to <b>${esc(verbFor(p))}</b>${v.summary && p.toolName !== 'Bash' ? `: <span class="perm-sum">${esc(v.summary)}</span>` : ''}</p>
        ${p.title && p.title !== p.toolName ? `<p class="perm-r">${esc(p.title)}</p>` : ''}
        ${p.description ? `<p class="perm-r">${esc(p.description)}</p>` : ''}
        ${p.reason ? `<p class="perm-r">Why it’s asking: ${esc(p.reason)}</p>` : ''}
        ${p.blockedPath ? `<p class="perm-r">Outside your project: ${esc(p.blockedPath)}</p>` : ''}
        <div class="perm-d">${toolDetail(v)}</div>
        <div class="perm-why" hidden><input type="text" class="why-t" placeholder="Optional: tell ${name} what to do instead" aria-label="What to do instead"></div>
        <div class="perm-b">
          <button type="button" class="btn ${p.defaultToNo ? '' : 'gilt'}" data-p="allow">Allow</button>
          ${p.canAlways ? '<button type="button" class="btn" data-p="always" title="Don’t ask again for this kind of action in this project">Always allow</button>' : ''}
          <button type="button" class="btn ${p.defaultToNo ? 'gilt' : ''}" data-p="deny">Deny</button>
        </div>`;
    }
    card._p = p;
    box.appendChild(card);
    const tool = lastTool($c('cFeed'), p.toolUseId);
    if (tool) tool.querySelector('.t-time').textContent = 'waiting for you';
    if (nearBottom()) toBottom(); else noteUnseen();
    // Only take focus if you're not typing: a keystroke meant for the message box must never approve a step.
    const a = document.activeElement;
    if (!(a && a.closest && a.closest('input, textarea, select, [contenteditable="true"]'))) (card.querySelector('.btn.gilt') || card.querySelector('button')).focus({ preventScroll: true });
  }
  function removePermission(id, src = 'main') {
    const c = $c('cPending').querySelector(`[data-req="${CSS.escape(`${src}:${id}`)}"]`);
    if (c) c.remove();
  }
  function clearPermissions() { $c('cPending').innerHTML = ''; }

  async function answer(card, decision) {
    const p = card._p;
    const body = { key: keyFor(card._src), requestId: p.requestId, decision };
    if (decision === 'deny' && !p.questions) {
      // First click asks what Claude should do instead; the second click (or Enter) sends the denial.
      if (!card._denyArmed) {
        card._denyArmed = true;
        card.querySelector('.perm-why').hidden = false;
        card.querySelector('[data-p="deny"]').textContent = 'Confirm deny';
        card.querySelector('.why-t').focus();
        return;
      }
      body.message = card.querySelector('.why-t').value.trim();
    }
    if (decision === 'answer') {
      const answers = {};
      for (const fs of card.querySelectorAll('fieldset.q')) {
        const q = p.questions[+fs.dataset.qi];
        const picked = [...fs.querySelectorAll('input:checked')].map(inp => (inp.value === 'other' ? (fs.querySelector('.other-t').value.trim() || 'Other') : q.options[+inp.value].label));
        if (!picked.length) { toast(`Pick an answer for “${q.question}”.`); return; }
        answers[q.question] = picked.join(', ');
      }
      body.decision = 'allow'; body.answers = answers;
    }
    if (decision === 'deny' && p.questions) body.message = 'The user skipped the question.';
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await api('/api/chat/permission', body); }
    catch (err) { card.querySelectorAll('button').forEach(b => { b.disabled = false; }); throw err; }
  }

  /* ---------- the crew: who your next message goes to, what each is doing, and each one's model ---------- */
  let crewTimer = null;
  function renderCrewSoon() { if (!crewTimer) crewTimer = setTimeout(() => { crewTimer = null; renderCrew(); }, 120); }
  function crewPill(src) {
    const prov = provFor(src);
    const mi = C.mi[src];
    const st = src === 'comp' ? (C.comp && !C.comp.ended ? C.comp.state : 'off') : C.state;
    const busy = st === 'busy' || st === 'starting' || st === 'waiting';
    const status = src === 'comp' ? C.comp && C.comp.status : '';
    const label = mi ? `${modelLabel(mi)}${mi.effort ? ` · ${mi.effort}` : ''}` : src === 'comp' && st === 'off' ? 'ready when you are' : '…';
    const on = duo() ? C.target === src : true;
    const sub = st === 'waiting' ? 'needs your OK' : busy && status ? status : label;
    const tip = on ? `${PROV_NAME[prov]}: choose its model and effort` : `Send your next message to ${PROV_NAME[prov]}${duo() ? ' (Ctrl+.)' : ''}`;
    return `<button type="button" class="crew ${prov}${on ? ' on' : ''}${busy ? ' busy' : ''}${st === 'waiting' ? ' waiting' : ''}" data-crew="${src}" aria-pressed="${on}" title="${esc(tip)}">
      <span class="crew-dot" aria-hidden="true"></span><span class="crew-n">${PROV_NAME[prov]}</span><span class="crew-m">${esc(sub)}</span>${on ? '<span class="crew-caret" aria-hidden="true">▾</span>' : ''}</button>`;
  }
  function renderCrew() {
    const box = $c('cCrew'); if (!box) return;
    if (C.watch || !C.key) { box.innerHTML = ''; return; }
    const two = duo();
    box.innerHTML = crewPill('main') + (two ? crewPill('comp') : '');
    box.classList.toggle('duo', two);
    $c('cHint').innerHTML = `Enter sends · Shift+Enter new line · / prompts · <b>/model</b> switches model${two ? ' · <b>@codex</b> or <b>Ctrl+.</b> talks to Codex' : ''} · Esc stops`;
    if (!two && C.target === 'comp') setTarget('main');
  }
  function setTarget(t, focus = true) {
    C.target = t === 'comp' && duo() ? 'comp' : 'main';
    const name = PROV_NAME[provFor(C.target)];
    $c('cText').placeholder = C.target === 'comp' ? 'Ask Codex… an image, a quick test, a second opinion' : `Write to ${name}…`;
    $c('cText').setAttribute('aria-label', `Message ${name}`);
    renderCrew(); syncSend(); closePick();
    if (focus) $c('cText').focus();
  }

  // The model picker: quick picks (a model and an effort in one tap), every model the chat's tool
  // offers, and its effort levels. On a phone it's a sheet from the bottom of the screen.
  const Pick = { src: null };
  const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const PRESETS = {
    claude: [
      { id: 'quick', name: 'Quick', glyph: '➤', note: 'Fast answers, small jobs', want: ['haiku'], effort: 'low' },
      { id: 'balanced', name: 'Balanced', glyph: '◐', note: 'Everyday work', want: ['sonnet'], effort: 'medium' },
      { id: 'deep', name: 'Deep', glyph: '◆', note: 'Hard problems, big changes', want: ['opus', 'default'], effort: 'high' },
      { id: 'max', name: 'Max', glyph: '✦', note: 'The toughest tasks', want: ['fable', 'opus'], effort: 'max' },
    ],
    codex: [
      { id: 'quick', name: 'Quick', glyph: '➤', note: 'Fast answers, quick tests', want: [/luna/], effort: 'low' },
      { id: 'balanced', name: 'Balanced', glyph: '◐', note: 'Everyday work', want: [/sol/], effort: 'medium' },
      { id: 'deep', name: 'Deep', glyph: '◆', note: 'Images, hard problems', want: ['@default'], effort: 'high' },
      { id: 'max', name: 'Max', glyph: '✦', note: 'Everything it has', want: ['@default'], effort: 'max' },
    ],
  };
  // The presets this chat's tool can actually do, each resolved to a model it offers and the
  // nearest effort that model supports.
  function presetsFor(src) {
    const mi = C.mi[src]; if (!mi || !mi.models) return [];
    const out = [];
    for (const p of PRESETS[provFor(src)] || []) {
      let m = null;
      for (const w of p.want) {
        m = w === '@default' ? mi.models.find(x => x.isDefault) || mi.models[0]
          : w instanceof RegExp ? mi.models.find(x => w.test(x.value)) : mi.models.find(x => x.value === w);
        if (m) break;
      }
      if (!m) continue;
      const efforts = m.efforts && m.efforts.length ? m.efforts : mi.efforts || [];
      let effort = efforts.includes(p.effort) ? p.effort : null;
      if (!effort && efforts.length) {
        const want = EFFORT_ORDER.indexOf(p.effort);
        effort = efforts.slice().sort((a, b) => Math.abs(EFFORT_ORDER.indexOf(a) - want) - Math.abs(EFFORT_ORDER.indexOf(b) - want))[0];
      }
      out.push({ ...p, model: m.value, label: m.label, effort });
    }
    return out;
  }
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  function closePick() { const b = $c('cPick'); if (b && !b.hidden) { b.hidden = true; Pick.src = null; document.body.classList.remove('sheet-open'); } const bk = $c('pickBack'); if (bk) bk.hidden = true; }
  async function openPick(src) {
    Pick.src = src;
    if (src === 'comp' && (!C.comp || C.comp.ended)) { renderPick(); try { await ensureCompanion(); } catch (err) { closePick(); throw err; } }
    renderPick();
  }
  function renderPick() {
    const box = $c('cPick'); const src = Pick.src; if (!src) return;
    const mi = C.mi[src]; const name = PROV_NAME[provFor(src)];
    // With the Codex helper available, one picker sets either: tabs at the top.
    const tabs = duo() ? `<div class="mp-tabs" role="tablist">${['main', 'comp'].map(t => `<button type="button" role="tab" class="${provFor(t)}" aria-selected="${t === src}" data-picksrc="${t}">${PROV_NAME[provFor(t)]}<small>${esc(C.mi[t] ? `${modelLabel(C.mi[t])}${C.mi[t].effort ? ` · ${C.mi[t].effort}` : ''}` : t === 'comp' ? 'not started' : '…')}</small></button>`).join('')}</div>` : '';
    const top = `<div class="mp-top"><span class="mp-grab" aria-hidden="true"></span>${tabs || `<p class="mp-title">${name}’s model</p>`}<button type="button" class="mp-done" data-pickdone>Done</button></div>`;
    if (!mi || !mi.models || !mi.models.length) box.innerHTML = `${top}<p class="mp-load"><span class="gen-spin" aria-hidden="true"></span>Asking ${name} which models it has…</p>`;
    else {
      const cur = mi.models.find(m => m.value === mi.model);
      const efforts = (cur && cur.efforts && cur.efforts.length ? cur.efforts : mi.efforts) || [];
      // Claude Code lists its current lineup by alias ("sonnet"); dated and older models fold away.
      const older = m => provFor(src) === 'claude' && /^claude-/.test(m.value);
      const row = m => `<button type="button" role="radio" aria-checked="${m.value === mi.model}" data-model="${esc(m.value)}"><b>${esc(m.label)}</b>${m.description ? `<small>${esc(m.description)}</small>` : ''}</button>`;
      const late = mi.models.filter(older);
      const presets = presetsFor(src);
      const onPreset = presets.find(p => p.model === mi.model && p.effort === mi.effort);
      const picks = presets.length ? `<p class="mp-h"><span class="mp-t">Quick picks</span><span>a model and effort in one tap</span></p>
        <div class="mp-presets" role="radiogroup" aria-label="Quick picks">${presets.map(p => `<button type="button" role="radio" class="mp-preset" aria-checked="${p === onPreset}" data-preset="${p.id}">
          <span class="mpp-g" aria-hidden="true">${p.glyph}</span><b>${esc(p.name)}</b><small>${esc(p.label)}${p.effort ? ` · ${esc(p.effort)}` : ''}</small><em>${esc(p.note)}</em></button>`).join('')}</div>` : '';
      // On a phone the full list folds away under the quick picks, unless the model in use is only there.
      const listOpen = !isPhone() || !onPreset;
      box.innerHTML = `${top}${picks}
        <details class="mp-all" ${listOpen ? 'open' : ''}><summary class="mp-h"><span class="mp-t"><b>${name}</b> · every model</span><span>takes effect from your next message</span></summary>
        <div class="mp-list" role="radiogroup" aria-label="${name} model">${mi.models.filter(m => !older(m)).map(row).join('')}
        ${late.length ? `<details class="mp-more" ${late.some(m => m.value === mi.model) ? 'open' : ''}><summary>Earlier models (${late.length})</summary>${late.map(row).join('')}</details>` : ''}</div></details>
        ${efforts.length ? `<p class="mp-h"><span class="mp-t">Effort</span><span>how hard it thinks</span></p><div class="mp-eff" role="radiogroup" aria-label="Effort">${efforts.map(e => `<button type="button" role="radio" aria-checked="${e === mi.effort}" data-effort="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : ''}
        ${mi.replyModel && mi.resolvedModel && mi.replyModel !== mi.resolvedModel && provFor(src) === 'claude' ? `<p class="mp-note">The last reply came from <b>${esc(modelName(mi.replyModel))}</b>.${$c('cMode').value === 'plan' ? ' In Plan only mode, Claude Code plans with a stronger model than Haiku.' : ''}</p>` : ''}
        <p class="mp-f">Remembered for this chat, and for new ${name} chats in ${esc(C.folder || 'this project')}. Shortcut: <kbd class="kbd">/model ${provFor(src) === 'codex' ? 'luna' : 'sonnet'}</kbd></p>`;
    }
    box.classList.toggle('codex', provFor(src) === 'codex');
    const wasHidden = box.hidden;
    box.hidden = false;
    document.body.classList.toggle('sheet-open', isPhone());
    $c('pickBack').hidden = !isPhone();   // on a phone, a tap on the dimmed area closes it (and goes no further)
    if (wasHidden) box.scrollTop = 0;
  }
  async function pickModel(src, change) {
    const key = keyFor(src); if (!key) return;
    const r = await api('/api/chat/model', { key, ...change });
    C.mi[src] = { ...(C.mi[src] || {}), ...r };
    renderCrew(); renderPick(); renderLedgerSoon();
    if (src === 'main') { C.model = modelLabel(C.mi.main); $c('cModel').textContent = C.model; }
    toast(`${PROV_NAME[provFor(src)]}: ${modelLabel(C.mi[src])}${C.mi[src].effort ? `, ${C.mi[src].effort} effort` : ''}.`, 2200);
  }
  // "/model sonnet" or "/effort high" in the message box: switches without sending anything.
  async function quickSwitch(kind, value) {
    const src = C.target === 'comp' && duo() ? 'comp' : 'main';
    if (src === 'comp') await ensureCompanion();
    const mi = C.mi[src];
    const v = value.toLowerCase();
    if (kind === 'effort') return pickModel(src, { effort: v });
    const list = (mi && mi.models) || [];
    const hit = list.find(m => m.value.toLowerCase() === v) || list.find(m => m.label.toLowerCase() === v)
      || list.find(m => m.label.toLowerCase().replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))) || list.find(m => m.value.toLowerCase().includes(v));
    if (!hit && list.length) { toast(`${PROV_NAME[provFor(src)]} has no model called “${value}”. Click its name under the message box to see them all.`, 6000); return undefined; }
    return pickModel(src, { model: hit ? hit.value : value });
  }

  // Starts (or reconnects to) the Codex helper for this Claude chat.
  function ensureCompanion() {
    if (C.comp && !C.comp.ended) return Promise.resolve(C.comp);
    if (C.compPending) return C.compPending;
    const gen = C.gen;
    C.compPending = api('/api/chat/companion', { key: C.key })
      .then(info => { if (gen !== C.gen) throw new Error('You switched chats.'); attachComp(info); return C.comp; })
      .finally(() => { C.compPending = null; });
    return C.compPending;
  }
  function attachComp(info) {
    if (C.comp && C.comp.es) C.comp.es.close();
    C.comp = { key: info.key, state: info.state, startedAt: info.startedAt, sessionId: info.sessionId, lastSeq: 0, status: '', es: null, ended: false };
    if (info.models && info.models.length) C.mi.comp = info;
    const key = info.key;
    const es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}&after=0`);
    es.addEventListener('chat', e => { if (!C.comp || C.comp.key !== key) return; try { handle(JSON.parse(e.data), 'comp'); } catch (err) { console.error(err); } });
    es.onerror = () => { if (C.comp && C.comp.key === key && C.comp.ended) es.close(); };
    C.comp.es = es;
    renderCrew(); renderLedgerSoon();
  }

  // Quotes a reply to the other one: Claude's plan to Codex for an image, Codex's answer back to Claude.
  function relay(turn) {
    const from = turn.dataset.prov || C.provider;
    const text = [...turn.querySelectorAll('.final > .md')].map(x => x.innerText.trim()).filter(Boolean).join('\n\n').slice(0, 6000);
    if (!text) { toast('There’s no text in that reply to pass on.'); return; }
    setTarget(from === 'codex' ? 'main' : 'comp', false);
    placeText(`${PROV_NAME[from]} said:\n\n${text.split('\n').map(l => `> ${l}`).join('\n')}\n\n`, false);
  }
  async function giveImage(p) {
    const blob = await (await fetch(imageUrl(p))).blob();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) { toast('That picture’s format can’t be attached.'); return; }
    if (blob.size > 5 * 1024 * 1024) { toast('That picture is over 5 MB, so it can’t be attached. Point Claude to its path instead.', 7000); return; }
    const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
    C.attachments.push({ mediaType: blob.type, data: data.slice(data.indexOf(',') + 1) });
    renderAttachments();
    setTarget('main', false);
    placeText(`Here’s the picture Codex made (saved at \`${p}\`). `, false);
  }

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

  /* ---------- header, rail ---------- */
  function headerAccount(id, fallbackName) {
    const a = id && acctById(id);
    const u = id ? usageOf(id) : null, d = u && u.data && u.data.available ? u.data : null;
    const pct = (label, w) => { if (!w) return ''; const l = leftOf(w); return `<span class="cu ${hot(l) ? 'hot' : ''}" title="${label}: ${l}% left${w.resetsAt ? `, resets ${esc(when(w.resetsAt))}` : ''}">${label} ${l}%</span>`; };
    $c('cAcct').hidden = !a && !fallbackName;
    $c('cAcct').innerHTML = `${id ? miniDial(id, 22) : ''}<span class="ca-n">${esc(a ? a.name : fallbackName || '')}</span>${d ? `${pct('5h', d.fiveHour)}${pct('wk', d.week)}` : ''}`;
    $c('cAcct').title = a ? `This chat runs as ${a.name}${a.email ? ` (${a.email})` : ''}` : '';
    const ring = a ? ringById(id) : 'var(--seam-2)';
    $c('chat').style.setProperty('--acct', ring);
    if (typeof renderBar === 'function') renderBar();
  }
  function refreshUsage() { if (!$c('chat').hidden) { headerAccount(C.info ? C.info.accountId : null, C.info ? C.info.accountName : ''); renderLedgerSoon(); } }
  function isViewing(x) {
    if (!x || $c('chat').hidden) return false;
    if (C.key && x.key) return x.key === C.key || !!(C.comp && x.key === C.comp.key);
    const sid = C.watch ? C.watch.sessionId : C.sessionId;
    return !!(sid && x.sessionId && x.sessionId.toLowerCase() === String(sid).toLowerCase());
  }
  function railItem(x) {
    const st = statusOf(x);
    const dot = NEEDS.has(st) ? 'gilt-dot' : st === 'working' ? (x.source === 'app' ? 'ember-dot' : 'violet-dot') : st === 'reply' ? 'reply-dot' : st === 'ended' ? 'ash-dot' : x.source === 'app' ? 'ready-dot' : 'violet-dot';
    const doing = x.phase === 'tool' && (x.detail || x.tool) ? `${VERB_NOW[x.tool] || 'Using'} ${x.detail || x.tool}` : x.phase === 'writing' ? 'Writing…' : x.phase === 'starting' ? 'Starting…' : 'Thinking…';
    const sub = { approve: 'Needs your OK', question: 'Has a question', 'terminal-wait': 'Waiting in its terminal', reply: 'Your turn', working: doing, quiet: x.source === 'terminal' ? 'In a terminal' : x.source === 'elsewhere' ? 'In another app' : 'Ready', ended: 'Stopped' }[st];
    return `<li><button type="button" class="ri ${NEEDS.has(st) ? 'needs' : st === 'reply' ? 'replied' : ''}" aria-current="${isViewing(x)}"><span class="${dot} ri-dot" aria-hidden="true"></span><span class="ri-t"><span class="ri-n">${esc(x.title || 'New chat')}</span><span class="ri-s">${esc(sub)}${x.folder ? ` · ${esc(x.folder)}` : ''}</span></span></button></li>`;
  }
  function renderRail() {
    if ($c('chat').hidden) return;
    const list = S.activity.filter(x => !x.parentKey);
    $c('cRailCount').textContent = list.length ? String(list.length) : '';
    patch($c('cRailList'), list, keyOf, railItem, '<li class="ri-empty">Only this chat is open.</li>');
  }
  function switchRail(step) {
    const list = S.activity.filter(x => !x.parentKey); if (!list.length) return;
    const i = list.findIndex(isViewing);
    const next = list[(i + step + list.length) % list.length];
    if (next && !isViewing(next)) openActivity(next);
  }

  /* ---------- open / close ---------- */
  function findSession(id) { const want = String(id || '').toLowerCase(); for (const p of S.projects) { const s = p.sessions.find(x => x.id.toLowerCase() === want); if (s) return [s, p]; } return [null, null]; }

  async function loadHistory(before) {
    if (!C.sessionId) return null;
    const gen = C.gen;
    const params = new URLSearchParams({ id: C.sessionId });
    // Up to where the open chat's live replay begins, so nothing shows twice or goes missing.
    const until = C.info && !C.watch ? C.info.bufferFrom || C.info.startedAt : null;
    if (until) params.set('until', until);
    if (before !== undefined && C.historyCursor) params.set('cursor', C.historyCursor);
    const h = await api(`/api/chat/history?${params}`);
    if (gen !== C.gen) return null;   // you've moved on to another chat
    C.historyStart = h.start;
    C.historyCursor = h.cursor || null;
    let rows = h.items.map(it => ({ it, prov: C.provider }));
    // A Claude chat's Codex helper: its earlier messages slot in among Claude's by time.
    if (before === undefined && C.compThread && C.provider === 'claude') {
      try { rows = mergeHelper(rows, (await api(`/api/chat/history?${new URLSearchParams({ id: C.compThread, provider: 'codex' })}`)).items); } catch { /* shown without them */ }
      if (gen !== C.gen) return null;
    }
    const tmp = document.createElement('div');
    for (const r of rows) { curProv = r.prov; try { renderItem(tmp, r.it, false); } finally { curProv = null; } }
    const feed = $c('cFeed');
    if (before === undefined) { feed.prepend(...tmp.childNodes); feed.prepend($c('cEarlier')); }
    else {
      const s = scroller(), oldH = s.scrollHeight;
      $c('cEarlier').after(...tmp.childNodes);
      s.scrollTop += s.scrollHeight - oldH;
    }
    $c('cEarlier').hidden = h.start <= 0;
    $c('cEarlier').textContent = 'Show earlier messages';
    return h;
  }
  // Waits (briefly) for the last pictures to size themselves, so "the bottom" is really the bottom.
  async function settle() {
    const imgs = [...$c('cFeed').querySelectorAll('img')].slice(-6).filter(i => !i.complete);
    if (imgs.length) await Promise.race([Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : null))), new Promise(r => setTimeout(r, 1500))]);
  }

  function mergeHelper(rows, items) {
    // The helper's turns, each starting at your message; ones from a helper still running come live.
    const cutoff = C.comp && C.comp.startedAt ? Date.parse(C.comp.startedAt) : Infinity;
    const groups = [];
    for (const it of items) {
      if (it.kind === 'user' || !groups.length) groups.push({ t: it.at ? Date.parse(it.at) : -Infinity, items: [] });
      groups[groups.length - 1].items.push(it);
    }
    const keep = groups.filter(g => !(g.t >= cutoff));
    const out = [];
    let gi = 0, last = -Infinity;
    for (const r of rows) {
      const t = r.it.at ? Date.parse(r.it.at) : last; last = t;
      while (gi < keep.length && keep[gi].t <= t) out.push(...keep[gi++].items.map(it => ({ it, prov: 'codex' })));
      out.push(r);
    }
    while (gi < keep.length) out.push(...keep[gi++].items.map(it => ({ it, prov: 'codex' })));
    return out;
  }

  function connect() {
    if (C.es) C.es.close();
    const key = C.key;
    C.es = new EventSource(`/api/chat/events?key=${encodeURIComponent(key)}&token=${TOKEN}&after=${C.lastSeq}`);
    C.es.addEventListener('hello', e => { try { const info = JSON.parse(e.data); C.info = { ...C.info, ...info }; C.sessionId = info.sessionId || C.sessionId; headerAccount(info.accountId, info.accountName); if (info.permissionMode) setMode(info.permissionMode); } catch { /* ignore */ } });
    C.es.addEventListener('chat', e => { if (C.key !== key) return; try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    C.es.onerror = () => { if (C.state === 'ended' && C.es) { C.es.close(); C.es = null; } };
  }

  function reset() {
    if (C.es) { C.es.close(); C.es = null; }
    clearTimeout(C.liveTimer);
    if (C.comp && C.comp.es) C.comp.es.close();
    // Each chat has its own message box: what you typed stays with the chat it was for (as a draft).
    clearTimeout(draftTimer);
    clearInterval(C.watchTimer);
    dropAttachments();
    $c('cText').value = ''; C.attachments = []; C.files = []; C.converting = 0; renderAttachments(); grow();
    closeFind(); unseen = 0;
    C.gen = (C.gen || 0) + 1;   // anything still loading for the previous chat is ignored
    Object.assign(C, { compPending: null, watchPending: false, key: null, info: null, sessionId: null, lastSeq: 0, state: null, liveText: {}, liveTimer: null, historyStart: 0, historyCursor: null, watch: null, watchSig: '', model: '', provider: 'claude', comp: null, compThread: null, target: 'main', mi: { main: null, comp: null } });
    closePick();
    $c('cFeed').innerHTML = '<button type="button" class="c-earlier" id="cEarlier" hidden></button>';
    clearPermissions();
    ledgerReset();
    $c('cStatus').textContent = ''; $c('cModel').textContent = '';
    const sel = $c('cMode'); sel.innerHTML = ['default', 'acceptEdits', 'plan', 'auto'].map(m => `<option value="${m}">${MODE_LABELS[m]}</option>`).join('');
    sel.hidden = false;
    $c('cCompose').hidden = false; $c('cWatch').hidden = true; $c('cWatch').innerHTML = '';
    closeSlash(); Slash.dismissed = null;
  }
  function show() {
    const chat = $c('chat');
    chat.hidden = false;
    chat.classList.remove('show-rail', 'show-ledger');
    let noLedger = false; try { noLedger = localStorage.getItem('ledger') === 'off'; } catch { /* default */ }
    chat.classList.toggle('no-ledger', noLedger);
    document.body.classList.add('chat-open');
    document.body.classList.remove('nav-open');
    if (!$c('drawer').hidden) $c('drawer').hidden = true;
    renderRail();
  }

  async function begin(info, { mode = 'resume', sessionId = null, cwd = null } = {}) {
    reset();
    const gen = C.gen;
    C.key = info.key; C.info = info; C.sessionId = info.sessionId || sessionId;
    C.provider = info.provider || 'claude';
    if (info.modes) modeOptions(info.modes);
    if (info.models && info.models.length) C.mi.main = info;
    C.compThread = info.companionThread || null;
    if (info.companionKey && C.provider === 'claude') { try { const ci = await api('/api/chat/attach', { key: info.companionKey }); if (gen !== C.gen) return; attachComp(ci); } catch { /* the helper has stopped */ } }
    if (gen !== C.gen) return;
    setTarget('main', false);
    $c('chat').classList.toggle('codex', C.provider === 'codex');
    const [s, p] = findSession(C.sessionId);
    C.title = info.title && info.title !== 'New chat' ? info.title : mode === 'new' ? 'New chat' : mode === 'fork' ? `${s ? s.title : 'Chat'} (copy)` : (s ? s.title : info.title || 'Chat');
    C.folder = info.folder || (p ? p.name : (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : ''));
    $c('cTitle').textContent = C.title;
    $c('cFolder').textContent = C.folder;
    headerAccount(info.accountId, info.accountName);
    setState(info.state || 'starting');
    show();
    if (mode !== 'new' && C.sessionId) {
      // A quiet placeholder while the conversation loads, instead of an empty window.
      $c('cFeed').insertAdjacentHTML('beforeend', '<div class="c-skel" aria-hidden="true"><i class="u"></i><i></i><i class="s"></i><i class="u"></i><i></i></div>');
      try { await loadHistory(); } catch (err) { toast(`Couldn’t load earlier messages: ${err.message}`); }
      if (gen !== C.gen) return;
      $c('cFeed').querySelector('.c-skel')?.remove();
    }
    if (mode === 'new') welcome(info.cwd || cwd);
    restoreDraft();
    toBottom();
    connect();
    settle().then(() => { if (gen === C.gen && !unseen) toBottom(); });
    markSeen(findActivity(info.key) || { key: info.key, sessionId: C.sessionId, finishedAt: Date.now() });
    renderRail(); renderLedgerSoon(); syncFav();
    $c('cText').focus();
  }

  async function open({ sessionId = null, cwd = null, mode = 'resume', force = false, accountId = null, provider = null, initialText = '' } = {}) {
    const a = (accountId && S.accounts.find(x => x.id === accountId)) || current();
    const [known] = sessionId ? findSession(sessionId) : [null];
    const prov = provider || (known && known.provider) || 'claude';
    let info;
    try {
      info = await api('/api/chat/open', { account: a.id, sessionId, cwd, mode, force, provider: prov });
    } catch (err) {
      if (err.reason === 'codex-signin' || err.reason === 'codex-missing') { toast(err.message, 9000); return undefined; }
      if (err.reason === 'running') {
        if (confirm(`${err.message}\n\nOK opens it here anyway. Cancel lets you watch it live instead, without touching it.`)) return open({ sessionId, cwd, mode, force: true, accountId: a.id, provider, initialText });
        return watch({ sessionId, source: 'terminal' });
      }
      throw err;
    }
    if (prov !== 'codex' && info.attached && info.accountId !== a.id) toast(`This chat was already open here as ${info.accountName}, so it continues as ${info.accountName}.`, 7000);
    else if (info.remembered && info.permissionMode) {
      const label = ((info.modes || []).find(m => m.value === info.permissionMode) || {}).label || MODE_LABELS[info.permissionMode] || info.permissionMode;
      toast(`Opened in “${label}”, as you left it${mode === 'new' ? ' in this project' : ''}.`, 3500);
    }
    await begin(info, { mode, sessionId, cwd });
    // Started from a prompt: it waits in the message box so you can adjust it before sending.
    if (initialText) placeText(initialText, true);
    return undefined;
  }

  async function openKey(key) {
    const info = await api('/api/chat/attach', { key });
    return begin(info, { mode: 'resume', sessionId: info.sessionId });
  }

  // Read-only, live view of a chat running somewhere else (a terminal, the desktop app).
  async function watch({ sessionId, source = 'terminal' }) {
    reset();
    C.watch = { sessionId, source }; C.sessionId = sessionId;
    const [s, p] = findSession(sessionId);
    C.provider = s && s.provider === 'codex' ? 'codex' : 'claude';
    C.title = s ? s.title : 'Chat'; C.folder = p ? p.name : '';
    C.info = { cwd: p ? p.cwd : null, accountId: s && s.lastOpened ? s.lastOpened.account : null, accountName: s && s.lastOpened ? s.lastOpened.accountName : '' };
    $c('cTitle').textContent = C.title; $c('cFolder').textContent = C.folder;
    headerAccount(C.info.accountId, C.info.accountId ? C.info.accountName : (source === 'terminal' ? 'In a terminal' : 'In another app'));
    setState(source === 'terminal' ? 'watching' : 'readonly');
    $c('cMode').hidden = true;
    $c('cCompose').hidden = true;
    $c('cWatch').hidden = false;
    $c('cWatch').innerHTML = source === 'terminal'
      ? '<p><b>Watching live.</b> This chat is running in a terminal, so you can read along here and reply in its terminal window. New messages appear by themselves.</p><button type="button" class="btn" data-c="fork">Open a copy here</button>'
      : '<p><b>Read-only.</b> This chat was last used in another app, like the desktop app. Continue it here if it’s closed there.</p><button type="button" class="btn prime" data-c="takeover">Continue it here</button><button type="button" class="btn quiet" data-c="fork">Open a copy</button>';
    show();
    const gen = C.gen;
    try { const h = await loadHistory(); if (gen !== C.gen) return; C.watchSig = sigOf(h); } catch (err) { toast(`Couldn’t read this chat: ${err.message}`); }
    if (gen !== C.gen) return;
    syncFav();
    toBottom();
    markSeen(findActivity(`s:${sessionId}`) || { sessionId, finishedAt: Date.now() });
    renderRail(); renderLedgerSoon();
    clearInterval(C.watchTimer);
    C.watchTimer = setInterval(() => { if (C.watch && !document.hidden) refreshWatch(); }, 4000);
  }
  const sigOf = h => (h ? `${h.start}:${h.items.length}:${JSON.stringify(h.items[h.items.length - 1] || '').length}` : '');
  let watchBusy = false;
  async function refreshWatch() {
    if (!C.watch || watchBusy) return;
    const id = C.watch.sessionId, gen = C.gen;
    watchBusy = true;
    try {
      const h = await api(`/api/chat/history?${new URLSearchParams({ id })}`);
      if (gen !== C.gen || !C.watch || C.watch.sessionId !== id || sigOf(h) === C.watchSig) return;
      // Reading further up? Don't move the page; count it, and catch up when you come back down.
      if (!nearBottom()) { C.watchPending = true; if (!unseen) { unseen = 1; syncJump(); } return; }
      C.watchSig = sigOf(h); C.watchPending = false;
      const open = new Set([...$c('cFeed').querySelectorAll('details[open][data-tool-id]')].map(d => d.dataset.toolId));
      ledgerReset();
      $c('cFeed').innerHTML = '<button type="button" class="c-earlier" id="cEarlier" hidden></button>';
      for (const it of h.items) renderItem($c('cFeed'), it, false);
      for (const d of $c('cFeed').querySelectorAll('details[data-tool-id]')) if (open.has(d.dataset.toolId)) d.open = true;
      C.historyStart = h.start; C.historyCursor = h.cursor || null;
      $c('cEarlier').hidden = h.start <= 0;
      $c('cEarlier').textContent = 'Show earlier messages';
      toBottom();
    } catch { /* try again next time */ } finally { watchBusy = false; }
  }

  function close(silent) {
    if (C.es) { C.es.close(); C.es = null; }
    if (C.comp && C.comp.es) { C.comp.es.close(); C.comp.es = null; }
    closePick();
    clearInterval(C.watchTimer);
    $c('chat').hidden = true;
    document.body.classList.remove('chat-open');
    C.key = null; C.watch = null;
    updateTitle(); renderBar();
    if (!silent) loadSessions().then(() => { renderSide(); renderMain(); }).catch(() => {});
  }

  /* ---------- events ---------- */
  function lightbox(src) { $c('cLight').querySelector('img').src = src; $c('cLight').hidden = false; $c('cLight').focus(); }
  function openFile(p) { return Viewer.open({ path: p, key: C.key, session: C.sessionId || (C.watch && C.watch.sessionId), cwd: C.info && C.info.cwd }); }

  document.addEventListener('DOMContentLoaded', () => {
    const chat = $c('chat');
    chat.addEventListener('click', wrap(async e => {
      const t = e.target;
      const fl = t.closest('.flink[data-path], [data-file]');
      if (fl) { e.preventDefault(); return openFile(fl.dataset.path || fl.dataset.file); }
      const rv = t.closest('[data-reveal]');
      if (rv) { const r = await api('/api/reveal', { path: rv.dataset.reveal, key: C.key, session: C.sessionId }); if (r.dryRun) toast(`Would run: ${r.script}`); return; }
      const cp = t.closest('[data-copy]');
      if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Copied.', 1500); } catch { prompt('Copy this:', cp.dataset.copy); } return; }
      const ri = t.closest('.ri');
      if (ri) { const li = ri.closest('li'); const x = li && findActivity(li.dataset.k); chat.classList.remove('show-rail'); if (x && !isViewing(x)) return openActivity(x); return; }
      const thumb = t.closest('.thumb'); if (thumb) return lightbox(thumb.dataset.full);
      const cc = t.closest('.code-copy');
      if (cc) { try { await navigator.clipboard.writeText(cc.closest('.code').querySelector('code').textContent); cc.textContent = 'Copied'; setTimeout(() => { cc.textContent = 'Copy'; }, 1500); } catch { toast('Couldn’t copy.'); } return; }
      const more = t.closest('.tg-more'); if (more) { const g = more.closest('.tools'); g.classList.toggle('open'); updateGroup(g); return; }
      const rm = t.closest('[data-rm]'); if (rm) { const [a] = C.attachments.splice(+rm.dataset.rm, 1); if (a && a.url) URL.revokeObjectURL(a.url); renderAttachments(); return; }
      const rmf = t.closest('[data-rmf]'); if (rmf) { const f = C.files.splice(+rmf.dataset.rmf, 1)[0]; if (f && f.xhr && !f.rel) f.xhr.abort(); renderAttachments(); return; }
      if (t.closest('#cEarlier')) return loadHistory(C.historyStart);
      const pb = t.closest('[data-p]'); if (pb) return answer(pb.closest('.perm'), pb.dataset.p);
      const crew = t.closest('[data-crew]');
      if (crew) { const src = crew.dataset.crew; if (duo() && C.target !== src) return setTarget(src); return !$c('cPick').hidden && Pick.src === src ? closePick() : openPick(src); }
      const pm = t.closest('#cPick [data-model]'); if (pm) return pickModel(Pick.src, { model: pm.dataset.model });
      const pp = t.closest('#cPick [data-preset]');
      if (pp) { const p = presetsFor(Pick.src).find(x => x.id === pp.dataset.preset); if (p) return pickModel(Pick.src, { model: p.model, ...(p.effort ? { effort: p.effort } : {}) }); return undefined; }
      const ps = t.closest('#cPick [data-picksrc]'); if (ps) return openPick(ps.dataset.picksrc);
      if (t.closest('#cPick [data-pickdone]')) return closePick();
      const pe = t.closest('#cPick [data-effort]'); if (pe) return pickModel(Pick.src, { effort: pe.dataset.effort });
      const gi = t.closest('[data-giveimg]'); if (gi) return giveImage(gi.dataset.giveimg);
      const c = t.closest('[data-c]'); if (!c) return;
      switch (c.dataset.c) {
        case 'back': return close();
        case 'rail': return chat.classList.toggle('show-rail');
        case 'ledger': {
          if (matchMedia('(max-width: 1320px)').matches) return chat.classList.toggle('show-ledger');
          const off = !chat.classList.contains('no-ledger');
          chat.classList.toggle('no-ledger', off);
          try { localStorage.setItem('ledger', off ? 'off' : 'on'); } catch { /* fine */ }
          return renderLedgerSoon();
        }
        case 'attach': return attachMenu(c);
        case 'prompts': return c.getAttribute('aria-expanded') === 'true' ? closeMenu() : promptsMenu(c);
        case 'chip': { const pr = S.prompts.find(x => x.id === c.dataset.pid); if (pr) insertPrompt(pr, true); return undefined; }
        case 'stop': C.interruptedAt = Date.now(); return api('/api/chat/interrupt', { key: C.target === 'comp' && C.comp ? C.comp.key : C.key });
        case 'relay': return relay(c.closest('.turn'));
        case 'fav': { const id = C.sessionId || (C.watch && C.watch.sessionId); if (id) window.toggleFav(id); return undefined; }
        case 'copyturn': {
          const turn = c.closest('.turn');
          const text = [...turn.querySelectorAll('.final > .md')].map(x => x.innerText.trim()).filter(Boolean).join('\n\n');
          try { await navigator.clipboard.writeText(text); toast('Copied.', 1500); } catch { toast('Couldn’t copy.'); }
          return undefined;
        }
        case 'restart': { const id = C.sessionId, accountId = C.info && C.info.accountId, provider = C.provider; return open({ sessionId: id, mode: 'resume', accountId: provider === 'codex' ? null : accountId, provider }); }
        case 'fork': { const id = C.watch && C.watch.sessionId; return open({ sessionId: id, mode: 'fork' }); }
        case 'takeover': { const id = C.watch && C.watch.sessionId; return open({ sessionId: id, mode: 'resume' }); }
        case 'more': return showMenu(c, C.watch ? [
          { label: 'Open a copy here', hint: 'keeps the original', run: () => open({ sessionId: C.watch.sessionId, mode: 'fork' }) },
          { label: 'Copy terminal command', run: async () => { const r = await api('/api/command', { account: S.acct, sessionId: C.watch.sessionId }); try { await navigator.clipboard.writeText(r.command); toast('Copied.'); } catch { prompt('Copy this command:', r.command); } } },
          { label: 'Browse this chat’s folder', run: () => openFile('.') },
        ] : [
          { label: 'Move to a terminal', hint: 'same account', disabled: !C.sessionId, why: 'Send a message first', run: async () => {
            if (!confirm('Stop this chat here and continue it in a terminal window?')) return;
            const key = C.key; close(); const r = await api('/api/chat/handoff', { key });
            toast(r.dryRun ? `Would open a ${r.how}:\n${r.script}` : `Continuing in a ${r.how}.`, 7000);
          } },
          { label: 'Copy terminal command', disabled: !C.sessionId, run: async () => { const r = await api('/api/command', { account: C.info.accountId, sessionId: C.sessionId }); try { await navigator.clipboard.writeText(r.command); toast('Copied.'); } catch { prompt('Copy this command:', r.command); } } },
          { label: 'Browse this chat’s folder', run: () => openFile('.') },
          '-',
          { label: 'Stop this chat', danger: true, disabled: C.state === 'ended', run: async () => { await api('/api/chat/stop', { key: C.key }); } },
        ]);
        default: return undefined;
      }
    }));
    chat.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('code.flink')) { e.preventDefault(); wrap(openFile)(e.target.dataset.path); }
    });
    $c('cMode').addEventListener('change', wrap(async e => { await api('/api/chat/mode', { key: C.key, mode: e.target.value }); toast(`Mode: ${(e.target.selectedOptions[0] || {}).textContent || e.target.value}. Remembered for this chat and new ones in ${C.folder || 'this project'}.`, 3000); renderLedgerSoon(); }));
    $c('cCompose').addEventListener('submit', e => { e.preventDefault(); wrap(sendMessage)(); });
    $c('cText').addEventListener('input', () => { grow(); Slash.moved = false; renderSlash(); saveDraft(); });
    $c('cText').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $c('cText')) closeSlash(); }, 120));
    $c('cSlash').addEventListener('mousedown', e => { const li = e.target.closest('[data-si]'); if (!li) return; e.preventDefault(); pickSlash(+li.dataset.si); });
    $c('cPending').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.classList.contains('why-t')) { e.preventDefault(); wrap(() => answer(e.target.closest('.perm'), 'deny'))(); }
    });
    $c('cText').addEventListener('keydown', e => {
      if (Slash.open && !e.isComposing) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); Slash.moved = true; Slash.sel = (Slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + Slash.items.length) % Slash.items.length; return renderSlash(); }
        if (e.key === 'Tab' || (e.key === 'Enter' && Slash.moved && !e.shiftKey)) { e.preventDefault(); return pickSlash(Slash.sel); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Slash.dismissed = $c('cText').value; return closeSlash(); }
        if (e.key === 'Enter') closeSlash();
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wrap(sendMessage)(); }
      if (e.key === '.' && e.ctrlKey && duo()) { e.preventDefault(); setTarget(C.target === 'comp' ? 'main' : 'comp'); return; }
      const tgt = C.target === 'comp' && C.comp ? C.comp : null;
      const tstate = tgt ? tgt.state : C.state;
      if (e.key === 'Escape' && !$c('cPick').hidden) { e.preventDefault(); closePick(); return; }
      if (e.key === 'Escape' && (tstate === 'busy' || tstate === 'waiting')) { e.preventDefault(); C.interruptedAt = Date.now(); wrap(() => api('/api/chat/interrupt', { key: tgt ? tgt.key : C.key }))(); }
    });
    $c('cText').addEventListener('paste', e => {
      const files = [...(e.clipboardData && e.clipboardData.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    for (const id of ['cFile', 'cMedia', 'cCam', 'cVid']) $c(id).addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
    chat.addEventListener('dragover', e => { if (!C.watch && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); chat.classList.add('drop'); } });
    chat.addEventListener('dragleave', e => { if (e.target === chat || !chat.contains(e.relatedTarget)) chat.classList.remove('drop'); });
    chat.addEventListener('drop', e => { e.preventDefault(); chat.classList.remove('drop'); if (!C.watch) addFiles([...e.dataTransfer.files]); });
    $c('cLight').addEventListener('click', () => { $c('cLight').hidden = true; });
    $c('cScroll').addEventListener('scroll', () => { if (!jumpRaf) jumpRaf = requestAnimationFrame(() => { jumpRaf = 0; syncJump(); }); }, { passive: true });
    $c('cJump').addEventListener('click', jumpLatest);
    $c('cFindQ').addEventListener('input', runFind);
    $c('cFindQ').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? 1 : -1); }   // Enter goes up, to older matches
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); $c('cText').focus(); }
    });
    $c('cFind').addEventListener('click', e => { const b = e.target.closest('[data-find]'); if (!b) return; if (b.dataset.find === 'close') closeFind(); else stepFind(b.dataset.find === 'up' ? -1 : 1); });
    document.addEventListener('keydown', e => {
      if ($c('chat').hidden || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(String(window.getSelection() || '').trim().slice(0, 80)); return; }
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
      if (!typing && e.key === 'End') { e.preventDefault(); jumpLatest(); }
    });
    document.addEventListener('mousedown', e => { if (!$c('cPick').hidden && !(e.target.closest && e.target.closest('#cPick, [data-crew]'))) closePick(); });
    $c('pickBack').addEventListener('pointerdown', e => e.preventDefault());
    $c('pickBack').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closePick(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$c('cLight').hidden) { $c('cLight').hidden = true; e.stopPropagation(); return; }
      if ($c('chat').hidden) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); switchRail(e.key === 'ArrowDown' ? 1 : -1); }
    }, true);
  });

  /* ---------- right-click inside the chat ---------- */
  async function copyOut(text, what = 'Copied.') { try { await navigator.clipboard.writeText(text); toast(what, 1500); } catch { prompt('Copy this:', text); } }
  const quote = text => text.trim().split('\n').map(l => `> ${l}`).join('\n');
  async function copyImage(src) {
    try {
      let blob = await (await fetch(src)).blob();
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Picture copied.', 1500);
    } catch { toast('This picture can’t be copied here. Use “Show in folder” instead.'); }
  }
  function modelItems(src) {
    const name = PROV_NAME[provFor(src)];
    return [
      { glyph: '◈', label: `Choose ${name}’s model…`, run: () => openPick(src) },
      ...presetsFor(src).map(p => ({ glyph: p.glyph, label: `${p.name}: ${p.label}${p.effort ? ` · ${p.effort}` : ''}`, hint: p.note, checked: C.mi[src] && C.mi[src].model === p.model && C.mi[src].effort === p.effort, run: () => pickModel(src, { model: p.model, ...(p.effort ? { effort: p.effort } : {}) }) })),
    ];
  }
  // ★ in the header pins this chat to the top of the sidebar.
  function syncFav() {
    const b = $c('cFav'); if (!b) return;
    const id = C.sessionId || (C.watch && C.watch.sessionId);
    const on = !!(id && window.isFav && window.isFav(id));
    b.hidden = !id; b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Unpin from the sidebar' : 'Pin to the sidebar';
    b.innerHTML = on ? '★' : '☆';
  }
  function chatHeadItems() {
    const id = C.sessionId;
    return [
      ...(id ? [{ glyph: window.isFav(id) ? '☆' : '★', label: window.isFav(id) ? 'Unpin from the sidebar' : 'Pin to the sidebar', run: () => window.toggleFav(id) }, '-'] : []),
      { glyph: '⌕', label: 'Find in this chat', keys: 'Ctrl F', run: () => openFind() },
      { glyph: '↓', label: 'Jump to the latest message', keys: 'End', run: jumpLatest },
      '-',
      { glyph: '❧', label: 'Export as Markdown', hint: window.Android ? 'copies it' : 'saves a .md file', run: exportChat },
      { label: 'Copy the whole chat as Markdown', run: () => copyOut(chatMarkdown(), 'Copied the chat as Markdown.') },
      ...(id && !C.watch ? [{ label: 'Rename chat', run: async () => { await renameChat(id); const [s] = findSession(id); if (s) { C.title = s.title; $c('cTitle').textContent = s.title; } } }] : []),
      ...(id ? [{ label: 'Copy chat ID', run: () => copyOut(id) }] : []),
      { label: 'Browse this chat’s folder', run: () => openFile('.') },
      ...(!C.watch && C.state !== 'ended' ? ['-', { label: 'Stop this chat', danger: true, run: () => api('/api/chat/stop', { key: C.key }) }] : []),
    ];
  }
  // Returns menu items for what was right-clicked, or undefined to let the app decide.
  function contextItems(t, at) {
    if (C.watch && !t.closest('#cFeed')) return undefined;
    const sel = window.getSelection();
    const picked = sel && !sel.isCollapsed ? String(sel).trim() : '';
    if (picked && sel.anchorNode && $c('cFeed').contains(sel.anchorNode) && t.closest('#cFeed')) {
      const short = picked.length > 40 ? `${picked.slice(0, 39)}…` : picked;
      return [
        { glyph: '⧉', label: 'Copy', keys: 'Ctrl C', run: () => copyOut(picked) },
        ...(!C.watch ? [{ glyph: '❝', label: 'Quote in my message', run: () => placeText(`${quote(picked)}\n\n`, false) }] : []),
        ...(duo() ? [{ glyph: '◆', label: C.target === 'comp' ? 'Ask Claude about this' : 'Ask Codex about this', run: () => { setTarget(C.target === 'comp' ? 'main' : 'comp', false); placeText(`${quote(picked)}\n\n`, false); } }] : []),
        { glyph: '⌕', label: `Find “${short}” in this chat`, run: () => openFind(picked) },
        { glyph: '✦', label: `Search every chat for “${short}”`, run: () => openPalette(picked) },
      ];
    }
    const gen = t.closest('.gen, .thumb, .af-media');
    if (gen) {
      const img = gen.querySelector('img'), vid = gen.querySelector('video');
      const p = gen.querySelector('[data-file]')?.dataset.file || gen.querySelector('[data-reveal]')?.dataset.reveal || null;
      const inProject = p && C.info && C.info.cwd && p.toLowerCase().startsWith(C.info.cwd.toLowerCase());
      return [
        ...(img ? [{ glyph: '⤢', label: 'View full size', run: () => lightbox((gen.querySelector('[data-full]') || gen).dataset.full || img.src) }, { glyph: '⧉', label: 'Copy picture', run: () => copyImage(img.src) }] : []),
        ...(vid ? [{ glyph: '▶', label: vid.paused ? 'Play' : 'Pause', run: () => (vid.paused ? vid.play() : vid.pause()) }] : []),
        ...(p && C.provider === 'claude' && img ? [{ glyph: '✦', label: 'Give to Claude', run: () => giveImage(p) }] : []),
        ...(p ? ['-', { label: 'Open in the viewer', run: () => openFile(p) }, { label: 'Show in folder', disabled: !!window.REMOTE, why: 'Only on the PC', run: () => api('/api/reveal', { path: p, key: C.key, session: C.sessionId }) }, { label: 'Copy path', run: () => copyOut(p) }] : []),
        ...(inProject && img ? [{ label: 'Use as the project’s banner', run: async () => { await api('/api/project/banner', { cwd: C.info.cwd, path: p }); toast('Banner set.', 1800); } }] : []),
      ];
    }
    const code = t.closest('.code');
    if (code) {
      const text = code.querySelector('code').textContent, lang = code.querySelector('.code-h span').textContent;
      return [
        { glyph: '⧉', label: 'Copy code', run: () => copyOut(text) },
        { label: 'Copy as Markdown', run: () => copyOut(`\`\`\`${lang === 'code' ? '' : lang}\n${text}\n\`\`\``) },
        ...(!C.watch ? [{ glyph: '❝', label: 'Put it in my message', run: () => placeText(`\`\`\`${lang === 'code' ? '' : lang}\n${text}\n\`\`\`\n\n`, false) }] : []),
      ];
    }
    const fl = t.closest('.flink[data-path], [data-file]');
    if (fl) {
      const p = fl.dataset.path || fl.dataset.file;
      return [
        { glyph: '❧', label: 'Open', run: () => openFile(p) },
        { label: 'Show in folder', disabled: !!window.REMOTE, why: 'Only on the PC', run: () => api('/api/reveal', { path: p, key: C.key, session: C.sessionId }) },
        { label: 'Copy path', run: () => copyOut(p) },
        ...(!C.watch ? [{ label: 'Mention it in my message', run: () => placeText(`\`${p}\` `, false) }] : []),
      ];
    }
    if (t.closest('a[href^="http"]')) return undefined;
    const tool = t.closest('.tool');
    if (tool) {
      const v = tool._view || {}, out = tool.querySelector('.t-out');
      const input = typeof v.detail === 'string' ? v.detail : v.detail && v.detail.new ? v.detail.new : '';
      const path = (v.meta && v.meta.path) || (v.name === 'Read' ? v.summary : null);
      return [
        { glyph: tool.open ? '▴' : '▾', label: tool.open ? 'Collapse' : 'Show details', run: () => { tool.open = !tool.open; } },
        ...(input ? [{ glyph: '⧉', label: v.detailKind === 'command' ? 'Copy command' : 'Copy input', run: () => copyOut(input) }] : []),
        ...(out && out.textContent ? [{ label: 'Copy output', run: () => copyOut(out.textContent) }] : []),
        ...(path ? [{ label: `Open ${base(path)}`, run: () => openFile(path) }] : []),
      ];
    }
    const um = t.closest('.umsg');
    if (um) {
      const text = RAW.get(um) || um.innerText;
      return [
        { glyph: '⧉', label: 'Copy message', run: () => copyOut(text) },
        ...(!C.watch ? [{ glyph: '↺', label: 'Edit and send again', hint: 'puts it back in the message box', run: () => { if (um.classList.contains('to-codex')) setTarget('comp', false); placeText(text, true); } },
          { glyph: '❝', label: 'Quote it', run: () => placeText(`${quote(text)}\n\n`, false) }] : []),
      ];
    }
    const turn = t.closest('.turn');
    if (turn) {
      const text = turnMarkdown(turn), prov = turn.dataset.prov || C.provider;
      return [
        ...(text ? [{ glyph: '⧉', label: 'Copy reply', run: () => copyOut(turn.querySelector('.final > .md') ? [...turn.querySelectorAll('.final > .md')].map(x => x.innerText.trim()).join('\n\n') : text) },
          { label: 'Copy as Markdown', run: () => copyOut(text) }] : []),
        ...(text && !C.watch ? [{ glyph: '❝', label: 'Quote in my message', run: () => placeText(`${quote(text)}\n\n`, false) }] : []),
        ...(text && duo() ? [{ glyph: prov === 'codex' ? '✦' : '◆', label: prov === 'codex' ? 'Send to Claude' : 'Ask Codex about this', run: () => relay(turn) }] : []),
        '-',
        ...chatHeadItems().filter(x => x !== '-' && /^(Find|Jump)/.test(x.label)),
      ];
    }
    const crew = t.closest('[data-crew]');
    if (crew) {
      const src = crew.dataset.crew, name = PROV_NAME[provFor(src)];
      return [
        ...(duo() && C.target !== src ? [{ glyph: '➤', label: `Write to ${name}`, keys: 'Ctrl .', run: () => setTarget(src) }] : []),
        ...modelItems(src),
        ...(src === 'comp' && C.comp && !C.comp.ended ? ['-', { label: 'Stop the Codex helper', hint: 'your next message to Codex starts it again', danger: true, run: () => api('/api/chat/stop', { key: C.comp.key }) }] : []),
      ];
    }
    if (t.closest('.c-head, #cFeed, .c-scroll')) return chatHeadItems();
    return undefined;
  }

  window.ChatUI = {
    open, openKey, watch, close, md, renderRail, refreshUsage, isViewing,
    accountId: () => (!$c('chat').hidden && C.info ? C.info.accountId || null : null),
    showLedger: () => { const chat = $c('chat'); if (matchMedia('(max-width: 1320px)').matches) chat.classList.add('show-ledger'); else { chat.classList.remove('no-ledger'); try { localStorage.setItem('ledger', 'on'); } catch { /* fine */ } } renderLedgerSoon(); },
    sessionsChanged: () => { if (C.watch) refreshWatch(); },
    refreshCrew: () => { if (!$c('chat').hidden) renderCrew(); },
    refreshFav: () => syncFav(),
    sessionId: () => C.sessionId || (C.watch && C.watch.sessionId) || null,
    contextItems,
    find: q => openFind(q), exportChat, jumpLatest,
    // Ctrl+K: "Sonnet 5.5", "GPT-6-Luna"… for the chat you're in.
    modelItems: () => {
      if ($c('chat').hidden || C.watch) return [];
      const out = [];
      for (const src of duo() ? ['main', 'comp'] : ['main']) {
        const mi = C.mi[src]; const name = PROV_NAME[provFor(src)];
        if (src === 'comp' && (!mi || !mi.models)) { out.push({ glyph: '◆', t: `Choose Codex’s model…`, s: 'Codex helper', run: () => openPick('comp'), text: 'codex model switch effort' }); continue; }
        for (const m of (mi && mi.models) || []) if (m.value !== mi.model) out.push({ glyph: src === 'comp' ? '◆' : '✦', t: `${name}: ${m.label}`, s: m.description, run: () => pickModel(src, { model: m.value }), text: `model switch ${name} ${m.label} ${m.value}` });
        for (const e of (mi && (((mi.models || []).find(x => x.value === mi.model) || {}).efforts || mi.efforts)) || []) if (e !== mi.effort) out.push({ glyph: '◈', t: `${name}: ${e} effort`, run: () => pickModel(src, { effort: e }), text: `effort ${name} ${e} think` });
      }
      return out;
    },
    // For the phone's Back button: closes the picker, then the chat. True if it did something.
    back: () => { if (!$c('cLight').hidden) { $c('cLight').hidden = true; return true; } if (!$c('cPick').hidden) { closePick(); return true; } if ($c('chat').classList.contains('show-rail') || $c('chat').classList.contains('show-ledger')) { $c('chat').classList.remove('show-rail', 'show-ledger'); return true; } if (!$c('chat').hidden) { close(); return true; } return false; },
    isOpen: () => !$c('chat').hidden, key: () => C.key,
  };
})();
