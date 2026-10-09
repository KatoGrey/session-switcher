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
  };
  const MODE_LABELS = { default: 'Ask before acting', acceptEdits: 'Accept edits', plan: 'Plan only', auto: 'Auto', bypassPermissions: 'Skip all checks', dontAsk: 'Never ask' };
  const STATE_LABELS = { starting: 'Starting', ready: 'Ready', busy: 'Working', waiting: 'Needs your OK', ended: 'Stopped', watching: 'Watching live', readonly: 'Read-only' };
  const ARTIFACT_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
  const FILE_EXT = 'md|markdown|mdx|txt|json|jsonl|csv|tsv|log|html?|css|js|mjs|cjs|ts|tsx|jsx|py|ya?ml|toml|xml|sh|ps1|bat|cmd|lua|luau|cs|java|go|rs|sql|ini|png|jpe?g|gif|webp|svg';
  const PATHY = new RegExp(`^(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|~[\\\\/]|/)?[^\\s<>"|?*]*?(?:\\.(?:${FILE_EXT})|[\\\\/])$`, 'i');
  const BARE = /(^|[\s(“"'[])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)?[\w.-]+(?:[\\/][\w.-]+)*\.(?:md|markdown|txt|json|jsonl|csv|log|html|ya?ml|toml|png|jpe?g|webp|svg))(?=$|[\s),.;:!?”"'\]])/gi;

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
  function codeBlock(code, lang) {
    return `<div class="code"><div class="code-h"><span>${esc(lang || 'code')}</span><button type="button" class="code-copy">Copy</button></div><pre><code>${esc(code)}</code></pre></div>`;
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
        ${C.model ? `<dt>Model</dt><dd>${esc(C.model)}</dd>` : ''}
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
    if (/^(gpt|o\d)/i.test(m)) return String(m).replace(/^gpt/i, 'GPT').replace(/-(\d)/, '-$1');
    const parts = String(m).replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
    const words = parts.filter(x => !/^\d+$/.test(x)).map(w => w[0].toUpperCase() + w.slice(1));
    return `${words.join(' ')} ${parts.filter(x => /^\d+$/.test(x)).join('.')}`.trim();
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
  function lastTurn(root, make) {
    const last = root.lastElementChild;
    if (last && last.classList.contains('turn')) return last;
    if (!make) return null;
    const t = document.createElement('div');
    t.className = liveRender ? 'turn fresh' : 'turn';
    t.innerHTML = `<div class="who">${C.provider === 'codex' ? 'Codex' : 'Claude'}</div>`;
    root.appendChild(t);
    return t;
  }
  function part(root, mid) {
    const had = !!lastTurn(root, false);
    const turn = lastTurn(root, true);
    let p = mid ? turn.querySelector(`.part[data-mid="${CSS.escape(mid)}"]`) : null;
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
    const acts = b.path ? `<div class="gen-act"><button type="button" class="btn quiet sm" data-file="${esc(b.path)}">Open</button><button type="button" class="btn quiet sm" data-reveal="${esc(b.path)}">Show in folder</button><button type="button" class="btn quiet sm" data-copy="${esc(b.path)}">Copy path</button></div>` : '';
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
    fin.insertAdjacentHTML('beforeend', `<div class="md">${md(b.text)}</div>${cards ? `<div class="arts">${cards}</div>` : ''}`);
  }
  function renderItem(root, it, live) {
    if (it.kind === 'user') {
      const d = document.createElement('div');
      d.className = liveRender ? 'umsg fresh' : 'umsg';
      d.innerHTML = `<div class="ububble">${it.text ? `<div class="utext">${plain(it.text)}</div>` : ''}${images(it.images)}</div>${it.at ? `<span class="utime">${esc(stamp(Date.parse(it.at)))}</span>` : ''}`;
      root.appendChild(d);
    } else if (it.kind === 'assistant') {
      const p = part(root, it.mid);
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
  function withStick(fn) { const stick = nearBottom(); fn(); if (stick) toBottom(); }

  /* ---------- live events ---------- */
  function flushLive() {
    C.liveTimer = null;
    for (const [mid, text] of Object.entries(C.liveText)) {
      const p = $c('cFeed').querySelector(`.part[data-mid="${CSS.escape(mid)}"] .live`);
      if (p) withStick(() => { p.innerHTML = md(text); });
    }
  }
  function setState(s) {
    C.state = s;
    const pill = $c('cState');
    pill.textContent = STATE_LABELS[s] || s;
    pill.className = `c-state ${s}`;
    $c('cStop').hidden = !(s === 'busy' || s === 'waiting');
    $c('cTyping').hidden = s !== 'busy';
    $c('cSend').textContent = s === 'busy' || s === 'waiting' ? 'Queue' : 'Send';
    $c('cSend').title = s === 'busy' || s === 'waiting' ? 'Claude is working; this will be sent when it’s ready' : '';
  }
  function handle(ev) {
    if (ev.seq) { if (ev.seq <= C.lastSeq) return; C.lastSeq = ev.seq; }
    liveRender = true;
    try { handleEvent(ev); } finally { liveRender = false; }
  }
  function handleEvent(ev) {
    const feed = $c('cFeed');
    switch (ev.kind) {
      case 'state': setState(ev.state); if (ev.state !== 'busy') { $c('cStatus').textContent = ''; } break;
      case 'init':
        C.sessionId = ev.sessionId || C.sessionId;
        if (ev.permissionMode) setMode(ev.permissionMode);
        C.model = modelName(ev.model);
        $c('cModel').textContent = C.model;
        renderLedgerSoon();
        break;
      case 'status': if (ev.permissionMode) setMode(ev.permissionMode); if (ev.status === 'compacting') $c('cStatus').textContent = 'Summarizing the conversation…'; if (ev.text) $c('cStatus').textContent = ev.text; break;
      case 'plan': L.todos = ev.steps || []; renderLedgerSoon(); break;
      case 'user': feed.querySelector('.c-welcome')?.remove(); withStick(() => renderItem(feed, ev, true)); toBottom(); break;
      case 'stream_start': withStick(() => part(feed, ev.mid)); break;
      case 'delta':
        if (ev.thinking) { $c('cStatus').textContent = 'Thinking…'; break; }
        $c('cStatus').textContent = '';
        part(feed, ev.mid);
        C.liveText[ev.mid] = (C.liveText[ev.mid] || '') + ev.text;
        if (!C.liveTimer) C.liveTimer = setTimeout(flushLive, 90);
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
      case 'tool_start': $c('cStatus').textContent = `Using ${ev.name}…`; break;
      case 'tool_progress': {
        const tool = lastTool(feed, ev.toolUseId);
        if (tool) tool.querySelector('.t-time').textContent = `${ev.seconds}s`;
        $c('cStatus').textContent = `${ev.name || 'Tool'} running, ${ev.seconds}s`;
        break;
      }
      case 'tool_result': withStick(() => setToolResult(feed, ev.toolUseId, ev.result)); break;
      case 'notice': withStick(() => renderItem(feed, ev, true)); break;
      case 'permission': addPermission(ev); break;
      case 'permission_cancel': case 'permission_done': removePermission(ev.requestId); break;
      case 'result':
        $c('cStatus').textContent = '';
        if (!ev.ok && Date.now() - C.interruptedAt > 8000 && (ev.errors.length || ev.text)) {
          withStick(() => renderItem(feed, { kind: 'notice', level: 'warning', text: ev.text || ev.errors.join('\n') || 'Claude stopped with an error.' }));
        }
        break;
      case 'ended': {
        setState('ended');
        clearPermissions();
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
  function addPermission(p) {
    const box = $c('cPending');
    if (box.querySelector(`[data-req="${CSS.escape(p.requestId)}"]`)) return;
    const card = document.createElement('div');
    card.className = 'perm';
    card.dataset.req = p.requestId;
    if (p.questions && p.questions.length) {
      card.classList.add('ask');
      card.innerHTML = `<p class="perm-h">Claude has <b>${p.questions.length === 1 ? 'a question' : `${p.questions.length} questions`}</b></p>
        ${p.questions.map((q, qi) => `<fieldset class="q" data-qi="${qi}"><legend>${q.header ? `<span class="q-h">${esc(q.header)}</span>` : ''}${esc(q.question)}</legend>
          ${q.options.map((o, oi) => `<label class="opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="${oi}"><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}
          <label class="opt other"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${esc(p.requestId)}-${qi}" value="other"><span><b>Other</b><input type="text" class="other-t" placeholder="Type your own answer" aria-label="Your own answer"></span></label></fieldset>`).join('')}
        <div class="perm-b"><button type="button" class="btn gilt" data-p="answer">Send answers</button><button type="button" class="btn" data-p="deny">Skip</button></div>`;
    } else {
      const v = p.view || {};
      card.innerHTML = `<p class="perm-h">Claude wants to <b>${esc(verbFor(p))}</b>${v.summary && p.toolName !== 'Bash' ? `: <span class="perm-sum">${esc(v.summary)}</span>` : ''}</p>
        ${p.title && p.title !== p.toolName ? `<p class="perm-r">${esc(p.title)}</p>` : ''}
        ${p.description ? `<p class="perm-r">${esc(p.description)}</p>` : ''}
        ${p.reason ? `<p class="perm-r">Why it’s asking: ${esc(p.reason)}</p>` : ''}
        ${p.blockedPath ? `<p class="perm-r">Outside your project: ${esc(p.blockedPath)}</p>` : ''}
        <div class="perm-d">${toolDetail(v)}</div>
        <div class="perm-why" hidden><input type="text" class="why-t" placeholder="Optional: tell Claude what to do instead" aria-label="What to do instead"></div>
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
    toBottom();
    (card.querySelector('.btn.gilt') || card.querySelector('button')).focus({ preventScroll: true });
  }
  function removePermission(id) {
    const c = $c('cPending').querySelector(`[data-req="${CSS.escape(id)}"]`);
    if (c) c.remove();
  }
  function clearPermissions() { $c('cPending').innerHTML = ''; }

  async function answer(card, decision) {
    const p = card._p;
    const body = { key: C.key, requestId: p.requestId, decision };
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

  /* ---------- composer ---------- */
  function renderAttachments() {
    $c('cAtt').innerHTML = C.attachments.map((a, i) => `<span class="att"><img src="data:${esc(a.mediaType)};base64,${a.data}" alt=""><button type="button" data-rm="${i}" aria-label="Remove image">✕</button></span>`).join('');
    $c('cAtt').hidden = !C.attachments.length;
  }
  function addFiles(files) {
    for (const f of files) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast('Only PNG, JPEG, GIF and WebP images can be attached.'); continue; }
      if (f.size > 5 * 1024 * 1024) { toast(`${f.name || 'That image'} is over 5 MB.`); continue; }
      if (C.attachments.length >= 10) { toast('You can attach up to 10 images per message.'); break; }
      const r = new FileReader();
      r.onload = () => { const s = String(r.result); C.attachments.push({ mediaType: f.type, data: s.slice(s.indexOf(',') + 1) }); renderAttachments(); };
      r.readAsDataURL(f);
    }
  }
  function grow() { const t = $c('cText'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, window.innerHeight * 0.4)}px`; }

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
  async function sendMessage() {
    const text = $c('cText').value;
    if (!text.trim() && !C.attachments.length) return;
    if (C.state === 'ended') { toast('This chat has stopped. Click “Start again” first.'); return; }
    const images = C.attachments.slice();
    $c('cSend').disabled = true;
    try {
      await api('/api/chat/send', { key: C.key, text, images });
      $c('cText').value = ''; C.attachments = []; renderAttachments(); grow();
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
    if (C.key && x.key) return x.key === C.key;
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
    const list = S.activity;
    $c('cRailCount').textContent = list.length ? String(list.length) : '';
    patch($c('cRailList'), list, keyOf, railItem, '<li class="ri-empty">Only this chat is open.</li>');
  }
  function switchRail(step) {
    const list = S.activity; if (!list.length) return;
    const i = list.findIndex(isViewing);
    const next = list[(i + step + list.length) % list.length];
    if (next && !isViewing(next)) openActivity(next);
  }

  /* ---------- open / close ---------- */
  function findSession(id) { const want = String(id || '').toLowerCase(); for (const p of S.projects) { const s = p.sessions.find(x => x.id.toLowerCase() === want); if (s) return [s, p]; } return [null, null]; }

  async function loadHistory(before) {
    if (!C.sessionId) return null;
    const params = new URLSearchParams({ id: C.sessionId });
    if (C.info && C.info.startedAt && !C.info.fork && !C.watch) params.set('until', C.info.startedAt);
    if (before !== undefined) { if (C.historyCursor) params.set('cursor', C.historyCursor); else params.set('before', String(before)); }
    const h = await api(`/api/chat/history?${params}`);
    C.historyStart = h.start;
    C.historyCursor = h.cursor || null;
    const tmp = document.createElement('div');
    for (const it of h.items) renderItem(tmp, it, false);
    const feed = $c('cFeed');
    if (before === undefined) { feed.prepend(...tmp.childNodes); feed.prepend($c('cEarlier')); }
    else {
      const s = scroller(), oldH = s.scrollHeight;
      $c('cEarlier').after(...tmp.childNodes);
      s.scrollTop += s.scrollHeight - oldH;
    }
    $c('cEarlier').hidden = h.start <= 0;
    $c('cEarlier').textContent = C.historyCursor ? 'Show earlier messages' : `Show earlier messages (${h.start} more)`;
    return h;
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
    Object.assign(C, { key: null, info: null, sessionId: null, lastSeq: 0, state: null, liveText: {}, liveTimer: null, historyStart: 0, historyCursor: null, watch: null, watchSig: '', model: '', provider: 'claude' });
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
    C.key = info.key; C.info = info; C.sessionId = info.sessionId || sessionId;
    C.provider = info.provider || 'claude';
    if (info.modes) modeOptions(info.modes);
    $c('cText').placeholder = C.provider === 'codex' ? 'Write to Codex…' : 'Write to Claude…';
    $c('chat').classList.toggle('codex', C.provider === 'codex');
    const [s, p] = findSession(C.sessionId);
    C.title = info.title && info.title !== 'New chat' ? info.title : mode === 'new' ? 'New chat' : mode === 'fork' ? `${s ? s.title : 'Chat'} (copy)` : (s ? s.title : info.title || 'Chat');
    C.folder = info.folder || (p ? p.name : (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : ''));
    $c('cTitle').textContent = C.title;
    $c('cFolder').textContent = C.folder;
    headerAccount(info.accountId, info.accountName);
    setState(info.state || 'starting');
    show();
    if (mode !== 'new' && C.sessionId) { try { await loadHistory(); } catch (err) { toast(`Couldn’t load earlier messages: ${err.message}`); } }
    if (mode === 'new') welcome(info.cwd || cwd);
    toBottom();
    connect();
    markSeen(findActivity(info.key) || { key: info.key, sessionId: C.sessionId, finishedAt: Date.now() });
    renderRail(); renderLedgerSoon();
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
    try { const h = await loadHistory(); C.watchSig = sigOf(h); } catch (err) { toast(`Couldn’t read this chat: ${err.message}`); }
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
    watchBusy = true;
    try {
      const h = await api(`/api/chat/history?${new URLSearchParams({ id: C.watch.sessionId })}`);
      if (!C.watch || sigOf(h) === C.watchSig) return;
      C.watchSig = sigOf(h);
      const stick = nearBottom();
      const keepTop = scroller().scrollTop;
      ledgerReset();
      $c('cFeed').innerHTML = '<button type="button" class="c-earlier" id="cEarlier" hidden></button>';
      for (const it of h.items) renderItem($c('cFeed'), it, false);
      C.historyStart = h.start;
      $c('cEarlier').hidden = h.start <= 0;
      $c('cEarlier').textContent = `Show earlier messages (${h.start} more)`;
      if (stick) toBottom(); else scroller().scrollTop = keepTop;
    } catch { /* try again next time */ } finally { watchBusy = false; }
  }

  function close(silent) {
    if (C.es) { C.es.close(); C.es = null; }
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
      const rm = t.closest('[data-rm]'); if (rm) { C.attachments.splice(+rm.dataset.rm, 1); renderAttachments(); return; }
      if (t.closest('#cEarlier')) return loadHistory(C.historyStart);
      const pb = t.closest('[data-p]'); if (pb) return answer(pb.closest('.perm'), pb.dataset.p);
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
        case 'attach': return $c('cFile').click();
        case 'prompts': return c.getAttribute('aria-expanded') === 'true' ? closeMenu() : promptsMenu(c);
        case 'chip': { const pr = S.prompts.find(x => x.id === c.dataset.pid); if (pr) insertPrompt(pr, true); return undefined; }
        case 'stop': C.interruptedAt = Date.now(); return api('/api/chat/interrupt', { key: C.key });
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
    $c('cMode').addEventListener('change', wrap(async e => { await api('/api/chat/mode', { key: C.key, mode: e.target.value }); toast(`Mode: ${MODE_LABELS[e.target.value]}.`, 2000); renderLedgerSoon(); }));
    $c('cCompose').addEventListener('submit', e => { e.preventDefault(); wrap(sendMessage)(); });
    $c('cText').addEventListener('input', () => { grow(); Slash.moved = false; renderSlash(); });
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
      if (e.key === 'Escape' && (C.state === 'busy' || C.state === 'waiting')) { e.preventDefault(); C.interruptedAt = Date.now(); wrap(() => api('/api/chat/interrupt', { key: C.key }))(); }
    });
    $c('cText').addEventListener('paste', e => {
      const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    $c('cFile').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
    chat.addEventListener('dragover', e => { if (!C.watch && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); chat.classList.add('drop'); } });
    chat.addEventListener('dragleave', e => { if (e.target === chat || !chat.contains(e.relatedTarget)) chat.classList.remove('drop'); });
    chat.addEventListener('drop', e => { e.preventDefault(); chat.classList.remove('drop'); if (!C.watch) addFiles([...e.dataTransfer.files]); });
    $c('cLight').addEventListener('click', () => { $c('cLight').hidden = true; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$c('cLight').hidden) { $c('cLight').hidden = true; e.stopPropagation(); return; }
      if ($c('chat').hidden) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); switchRail(e.key === 'ArrowDown' ? 1 : -1); }
    }, true);
  });

  window.ChatUI = {
    open, openKey, watch, close, md, renderRail, refreshUsage, isViewing,
    accountId: () => (!$c('chat').hidden && C.info ? C.info.accountId || null : null),
    showLedger: () => { const chat = $c('chat'); if (matchMedia('(max-width: 1320px)').matches) chat.classList.add('show-ledger'); else { chat.classList.remove('no-ledger'); try { localStorage.setItem('ledger', 'on'); } catch { /* fine */ } } renderLedgerSoon(); },
    sessionsChanged: () => { if (C.watch) refreshWatch(); },
    isOpen: () => !$c('chat').hidden, key: () => C.key,
  };
})();
