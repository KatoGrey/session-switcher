'use strict';
// Waiting on others: chats you've marked Waiting are checked every ten minutes. For now that means
// the pull requests a chat links to (GitHub, through `gh`; no model is asked anything). When one
// moves in a way that matters (merged, closed, approved, changes asked for, out of draft, or a
// person reviewed it), the chat gets a line saying so and your phone gets an alert: "is this ready?"
// The first look only learns where things stand. Each chat's PRs and their state are kept in
// lite-waits.json; a chat's entry goes when it stops waiting.

const path = require('path');
const { execFile } = require('child_process');
const files = require('./store');

const EVERY_MS = 10 * 60e3;
const MAX_PRS = 3;
// Review bots: their comments aren't news.
const BOTS = new Set(['chatgpt-codex-connector', 'latitude-pr-reviewer', 'copilot-pull-request-reviewer', 'coderabbitai', 'github-actions']);
const isBot = login => !login || BOTS.has(login.toLowerCase()) || /\[bot\]$|-bot$/i.test(login);
const validState = state => ['OPEN', 'CLOSED', 'MERGED'].includes(state);

// The PRs a chat names, newest mention first.
function prLinks(text) {
  const all = [...String(text || '').matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\b/gi)].map(m => `https://github.com/${m[1].toLowerCase()}/pull/${m[2]}`);
  return [...new Set(all.reverse())].slice(0, MAX_PRS);
}
// What we keep of a PR from `gh pr view --json state,isDraft,reviewDecision,author,latestReviews`.
function snapOf(j) {
  const author = j.author?.login?.toLowerCase();
  const reviews = {};
  for (const r of j.latestReviews || []) { const who = r.author?.login; if (!isBot(who) && who.toLowerCase() !== author) reviews[who] = r.state; }
  return { state: j.state, draft: !!j.isDraft, decision: j.reviewDecision || '', reviews };
}
// Where it stands, in a few words.
function standing(s) {
  if (!validState(s.state)) return 'Status unavailable';
  if (s.state === 'MERGED') return 'Merged';
  if (s.state === 'CLOSED') return 'Closed';
  if (s.draft) return 'Still a draft';
  return { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' }[s.decision] || 'Open';
}
// What changed that you'd want to hear about, or null. Pure, for tests.
function prChange(prev, cur, n) {
  if (!validState(prev?.state) || !validState(cur?.state)) return null;
  const pr = `PR #${n}`;
  if (cur.state !== prev.state) return cur.state === 'MERGED' ? `${pr} was merged` : cur.state === 'CLOSED' ? `${pr} was closed` : `${pr} was reopened`;
  if (prev.draft && !cur.draft) return `${pr} is out of draft`;
  if (cur.decision !== prev.decision && cur.decision === 'APPROVED') return `${pr} was approved${(w => (w ? ` by ${w}` : ''))(Object.keys(cur.reviews).find(k => cur.reviews[k] === 'APPROVED'))}`;
  if (cur.decision !== prev.decision && cur.decision === 'CHANGES_REQUESTED') return `Changes requested on ${pr}`;
  for (const [who, st] of Object.entries(cur.reviews)) {
    if (prev.reviews[who] === st) continue;
    return st === 'APPROVED' ? `${who} approved ${pr}` : st === 'CHANGES_REQUESTED' ? `${who} asked for changes on ${pr}` : `${who} reviewed ${pr}`;
  }
  return null;
}

const gh = url => new Promise(resolve => {
  execFile('gh', ['pr', 'view', url, '--json', 'state,isDraft,reviewDecision,author,latestReviews'], { timeout: 25e3, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => {
    if (err) return resolve(null);
    try { resolve(JSON.parse(out)); } catch { resolve(null); }
  });
});

function createWaits({ dataDir, log = () => {}, chats, recentReplies, notify = async () => 0, broadcast = () => {}, view = gh }) {
  const file = path.join(dataDir, 'lite-waits.json');
  let w = files.loadOwnJson(file, null, log);
  w = w && typeof w === 'object' && !Array.isArray(w) ? w : {};
  const save = () => { try { files.writeJsonAtomic(file, w); } catch (err) { log(`Lite: couldn’t save lite-waits.json (${err.message})`); } };
  let busy = false;

  async function check() {
    if (busy) return; busy = true;
    try {
      const list = chats().filter(c => c.waiting && !c.archived);
      const ids = new Set(list.map(c => c.id));
      let changed = false;
      for (const k of Object.keys(w)) if (!ids.has(k)) { delete w[k]; changed = true; }
      for (const c of list) {
        let text = c.note || '', readReplies = true;
        try { text += `\n${await recentReplies(c.id, c.provider) || ''}`; } catch { readReplies = false; }
        const e = w[c.id] || (w[c.id] = { prs: {}, news: null });
        for (const [url, state] of Object.entries(e.prs)) {
          const [canonical] = prLinks(url);
          if (!canonical || canonical === url) continue;
          if (!e.prs[canonical] || (state.checkedAt || 0) > (e.prs[canonical].checkedAt || 0)) e.prs[canonical] = state;
          delete e.prs[url]; changed = true;
        }
        const named = prLinks(text);
        const urls = readReplies ? named : [...new Set([...named, ...Object.keys(e.prs)])].slice(0, MAX_PRS);
        for (const url of urls) {
          const j = await view(url);
          if (!validState(j?.state)) {
            if (!e.prs[url]?.unavailable) { e.prs[url] = { ...e.prs[url], unavailable: true }; changed = true; }
            continue;
          }
          const cur = snapOf(j), n = url.split('/').pop();
          const line = prChange(e.prs[url], cur, n);
          e.prs[url] = { ...cur, checkedAt: Date.now() }; changed = true;
          if (line) {
            e.news = { at: Date.now(), line, url };
            log(`Lite: ${c.title}: ${line}`);
            notify('waiting', { title: `${line}`, body: `${c.title}${c.waitingOn ? ` (waiting on ${c.waitingOn})` : ''}. Ready to pick back up?`, tag: `wait-${c.id}`, sessionId: c.id, url: `/lite?chat=${encodeURIComponent(c.id)}` }).catch(() => {});
          }
        }
        if (readReplies) for (const u of Object.keys(e.prs)) if (!urls.includes(u)) { delete e.prs[u]; changed = true; }
      }
      if (changed) { save(); broadcast('lite', {}); }
    } catch (err) { log(`Lite: checking waiting chats: ${err.message}`); }
    finally { busy = false; }
  }
  // Onto each waiting chat: where its PRs stand, and the news since you last looked.
  function decorate(list) {
    for (const c of list) {
      const e = c.waiting && w[c.id]; if (!e) continue;
      const prs = Object.entries(e.prs).map(([url, s]) => ({ url, n: Number(url.split('/').pop()), standing: standing(s), stale: !!s.unavailable || !!(s.checkedAt && Date.now() - s.checkedAt > 2 * EVERY_MS), checkedAt: s.checkedAt || null }));
      if (prs.length) c.waitPrs = prs;
      if (e.news) c.waitNews = e.news;
    }
  }
  function seen(id) { const e = w[id]; if (e && e.news) { e.news = null; save(); } return { ok: true }; }
  function start() { setTimeout(() => check().catch(() => {}), 30e3).unref(); setInterval(() => check().catch(() => {}), EVERY_MS).unref(); }
  return { check, decorate, seen, start };
}

module.exports = { createWaits, prLinks, snapOf, standing, prChange };
