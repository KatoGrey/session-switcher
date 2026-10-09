'use strict';
/* The chat window: its state, Markdown and code, the ledger (what a chat produced), drawing the conversation, scrolling and export. */

const $c = id => (id[0] === '[' ? document.querySelector(id) : document.getElementById(id));
const C = {
  key: null, info: null, sessionId: null, es: null, lastSeq: 0, state: null, watch: null, watchSig: '',
  attachments: [], historyStart: 0, historyCursor: null, liveText: {}, liveTimer: null, interruptedAt: 0, title: '', folder: '', model: '', provider: 'claude',
  // The Codex helper working inside a Claude chat, which one your next message goes to, and each one's model.
  comp: null, compThread: null, target: 'main', mi: { main: null, comp: null },
  // How full each one's context window is (see setCtx), and whether we've offered to summarize.
  ctx: { main: null, comp: null }, ctxWarned: {},
  // Files put back with Undo, for each one's next catch-up.
  undoNotes: { main: [], comp: [] },
};
const PROV_NAME = { claude: 'Claude', codex: 'Codex', openclaw: 'OpenClaw' };
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
    if (!L.cmds.some(c => c.id && c.id === b.id)) L.cmds.push({ id: b.id, text: typeof b.detail === 'string' && b.detail.trim() ? b.detail : b.summary, desc: b.summary, st: b.result ? (b.result.isError ? 'err' : 'ok') : 'run' });
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
        ${C.watch ? `<dt>Running</dt><dd>${C.watch.source === 'terminal' ? 'In a terminal' : C.watch.source === 'openclaw' ? 'In OpenClaw' : 'In another app'}</dd>` : ''}
        ${C.model ? `<dt>Model</dt><dd>${esc(C.model)}${C.mi.main && C.mi.main.effort ? ` · ${esc(C.mi.main.effort)} effort` : ''}</dd>` : ''}
        ${C.ctx.main ? `<dt>Context</dt><dd>${esc(ctxLine('main'))}</dd>` : ''}
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
// When a reply is done, its steps fold to their one line (click it to see them).
function foldSteps(src) {
  const prov = provFor(src);
  const turn = [...$c('cFeed').querySelectorAll('.turn')].filter(t => (t.dataset.prov || C.provider) === prov).pop();
  if (!turn) return;
  for (const g of turn.querySelectorAll('.tools')) if (g.querySelectorAll('.tool').length >= 3 && !g._opened) { g.classList.add('folded'); updateGroup(g); }
}
// A reply's steps in one line: "Edited songs.lua, party.json · ran 2 commands · read 4 files".
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
function stepsSummary(g) {
  const steps = [...g.querySelectorAll('.tool')].map(d => ({ name: d.dataset.name, v: d._view || {}, st: d.querySelector('.t-st').className }));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const edited = [...new Set(steps.filter(x => FILE_TOOLS.has(x.name)).map(x => base((x.v.meta && x.v.meta.path) || x.v.summary || '')).filter(Boolean))];
  const cmds = steps.filter(x => x.name === 'Bash' || x.name === 'PowerShell').length;
  const reads = steps.filter(x => READ_TOOLS.has(x.name)).length;
  const web = steps.filter(x => /^Web/.test(x.name)).length;
  const counted = steps.filter(x => FILE_TOOLS.has(x.name) || x.name === 'Bash' || x.name === 'PowerShell' || READ_TOOLS.has(x.name) || /^Web/.test(x.name)).length;
  const parts = [];
  if (edited.length) parts.push(`edited ${edited.slice(0, 3).join(', ')}${edited.length > 3 ? ` and ${edited.length - 3} more` : ''}`);
  if (cmds) parts.push(`ran ${plural(cmds, 'command')}`);
  if (reads) parts.push(`looked at ${plural(reads, 'file')}`);
  if (web) parts.push(`used the web ${web === 1 ? 'once' : `${web} times`}`);
  if (steps.length > counted) parts.push(plural(steps.length - counted, 'other step'));
  const text = parts.join(' · ');
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    running: steps.some(x => /\brun\b/.test(x.st)),
    failed: steps.filter(x => /\berr\b/.test(x.st)).length,
    n: steps.length,
  };
}
function updateGroup(g) {
  if (!g) return;
  const n = g.querySelectorAll('.tool').length;
  let sum = g.querySelector('.tg-sum');
  if (n >= 2) {
    if (!sum) { g.insertAdjacentHTML('afterbegin', '<button type="button" class="tg-sum" aria-expanded="true"></button>'); sum = g.firstElementChild; }
    const s = stepsSummary(g);
    const mark = s.running ? '<span class="gen-spin" aria-hidden="true"></span>' : s.failed ? `<span class="tg-x" aria-hidden="true">✕</span>` : '<span class="tg-ok" aria-hidden="true">✓</span>';
    sum.innerHTML = `${mark}<span class="tg-t">${esc(s.text)}${s.failed ? ` · ${s.failed} failed` : ''}</span><span class="tg-n">${n} steps</span>`;
    sum.setAttribute('aria-expanded', String(!g.classList.contains('folded')));
  } else if (sum) sum.remove();
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
      ${prov === 'claude' && C.provider === 'claude' && codexOK() ? '<button type="button" class="ta rv" data-c="review" title="Codex reviews the changes so far, in a read-only sandbox">Review with Codex</button>' : ''}
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
    // From history, a finished reply's steps start folded to their one line.
    if (!liveRender && g.querySelectorAll('.tool').length >= 3) g.classList.add('folded');
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
    const sh = splitShared(it.text);
    const at = it.at ? Date.parse(it.at) : Date.now();
    if (C.provider === 'claude' && joinBoth(root, toCodex, sh.own, at)) return;
    const files = [];
    const text = sh.own.split('\n').filter(l => { const m = l.trim().match(ATTACH_LINE); if (m) files.push([m[1], m[2] || '']); return !m; }).join('\n').trim();
    RAW.set(d, sh.own);
    d._at = at;
    d.innerHTML = `${toCodex ? '<span class="to-tag">to Codex</span>' : ''}${sh.context ? `<details class="shared"><summary>${toCodex ? 'Codex' : PROV_NAME[C.provider]} was caught up on ${sh.items ? `${sh.items} message${sh.items === 1 ? '' : 's'}` : 'the conversation'}</summary><div class="sh-body">${plain(sh.context)}</div></details>` : ''}<div class="ububble">${text ? `<div class="utext">${plain(text)}</div>` : ''}${images(it.images)}${attachedFiles(files)}</div>${it.at ? `<span class="utime">${esc(stamp(Date.parse(it.at)))}</span>` : ''}`;
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
    markEdits(p, it.blocks);
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
// The whole conversation as one web page (formatted, code in color, light or dark as the reader likes),
// to keep or to send to someone who doesn't have Session Switcher.
const EXPORT_CSS = `:root{color-scheme:light dark;--bg:#fbf8f3;--ink:#2a2420;--soft:#6b625b;--line:#e4ddd3;--you:#f2ece3;--claude:#a5463f;--codex:#46679f;--code:#f4efe8;--k:#a5463f;--s:#8a6d1c;--n:#3c5a96;--c:#8b8178}
@media (prefers-color-scheme:dark){:root{--bg:#121014;--ink:#ede6d9;--soft:#9a928a;--line:#2c2632;--you:#1d1920;--claude:#d68a7c;--codex:#7fa3dc;--code:#0b0a0d;--k:#cf8274;--s:#d9bf74;--n:#7fa3dc;--c:#7d766e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 Georgia,'Times New Roman',serif}
main{max-width:820px;margin:0 auto;padding:40px 22px 60px}header{margin-bottom:28px;border-bottom:1px solid var(--line);padding-bottom:18px}
.eyebrow{margin:0;font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--claude)}
h1{margin:8px 0 6px;font-size:30px;line-height:1.2}.meta{margin:0;color:var(--soft);font-size:14px}
.m{margin:0 0 22px}.who{margin:0 0 6px;font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;text-transform:uppercase}
.m.claude .who{color:var(--claude)}.m.codex .who{color:var(--codex)}.m.you .who{color:var(--soft)}
.m.you .body{background:var(--you);border:1px solid var(--line);border-radius:10px;padding:12px 16px;white-space:pre-wrap}
.m.codex{border-left:2px solid var(--codex);padding-left:16px}.steps{margin:0 0 8px;color:var(--soft);font-size:14px;font-style:italic}
pre{overflow:auto;background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font:13.5px/1.5 ui-monospace,Consolas,monospace}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}p code,li code{background:var(--code);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.code-h{font:11px ui-monospace,Consolas,monospace;color:var(--soft);margin-bottom:-6px}
table{border-collapse:collapse;margin:10px 0}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
blockquote{margin:10px 0;padding-left:14px;border-left:3px solid var(--line);color:var(--soft)}img{max-width:100%}
.tk-k{color:var(--k)}.tk-s{color:var(--s)}.tk-n{color:var(--n)}.tk-c{color:var(--c);font-style:italic}
footer{margin-top:40px;color:var(--soft);font-size:13px;border-top:1px solid var(--line);padding-top:14px}`;
// Rendered for a page of its own: no buttons; file links and the like become plain code.
function pageHtml(markdown) {
  const div = document.createElement('div');
  div.innerHTML = md(markdown);
  div.querySelectorAll('button').forEach(b => { if (b.classList.contains('code-copy')) b.remove(); else { const c = document.createElement('code'); c.textContent = b.textContent; b.replaceWith(c); } });
  return div.innerHTML;
}
function chatPage() {
  const parts = [];
  for (const el of $c('cFeed').children) {
    if (el.classList.contains('umsg')) {
      const to = el.classList.contains('to-both') ? ' → Claude & Codex' : el.classList.contains('to-codex') ? ' → Codex' : '';
      const text = RAW.get(el) || el.innerText.trim();
      parts.push(`<section class="m you"><p class="who">You${esc(to)}</p><div class="body">${esc(text)}${el.querySelector('img') ? '\n(with a picture)' : ''}</div></section>`);
    } else if (el.classList.contains('turn')) {
      const prov = el.dataset.prov || C.provider;
      const text = turnMarkdown(el);
      const steps = [...el.querySelectorAll('.tools')].map(g => (g.querySelectorAll('.tool').length ? stepsSummary(g).text : '')).filter(Boolean);
      if (!text && !steps.length) continue;
      parts.push(`<section class="m ${prov === 'codex' ? 'codex' : 'claude'}"><p class="who">${esc(PROV_NAME[prov] || 'Claude')}</p>${steps.length ? `<p class="steps">${esc(steps.join('; '))}</p>` : ''}${text ? pageHtml(text) : ''}</section>`);
    } else if (el.classList.contains('cnotice')) parts.push(`<blockquote>${esc(el.innerText.trim())}</blockquote>`);
  }
  const title = C.title || 'Chat';
  const meta = [C.model, new Date().toLocaleString()].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head>
<body><main><header>${C.folder ? `<p class="eyebrow">${esc(C.folder)}</p>` : ''}<h1>${esc(title)}</h1><p class="meta">${esc(meta)}</p></header>
${parts.join('\n')}
<footer>Saved from Session Switcher.</footer></main></body></html>`;
}
function savePage() {
  const name = `${String(C.title || 'chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'chat'}.html`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([chatPage()], { type: 'text/html' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Saved ${name} to your Downloads. It opens in any browser.`, 4000);
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
