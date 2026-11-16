'use strict';
/* Slack post: a few plain sentences about a pull request, with its link, to ask your team for a review or let them
   know about it. Claude drafts it from the PR and the chat that did the work (lib/slackpost.js); you change what you
   like and copy it into Slack, or copy it and open your team's channel in Slack in one go. Opened from Your work,
   Pull requests, a chat's side panel and /slack. */

const SlackPost = { pr: null, sessionId: null, mine: null, gen: 0, dirty: false };

/* ---------- your team's channel (kept on this device) ---------- */
// What a channel's link can be: Slack's web address (app.slack.com/client/T…/C…), which opens the Slack app right at
// the channel; a link copied in Slack (…slack.com/archives/C…), which goes by way of the browser (Slack offers to open
// itself there); or a slack://channel link.
function slackTarget(link) {
  const s = String(link || '').trim();
  let m = /^https:\/\/app\.slack\.com\/client\/(T[A-Z0-9]+)\/([CGD][A-Z0-9]+)/i.exec(s);
  if (m) return { open: `slack://channel?team=${m[1].toUpperCase()}&id=${m[2].toUpperCase()}`, link: s, label: `the channel ${m[2].toUpperCase()}`, direct: true };
  m = /^slack:\/\/channel\?team=(T[A-Z0-9]+)&id=([CGD][A-Z0-9]+)$/i.exec(s);
  if (m) return { open: s, link: s, label: `the channel ${m[2].toUpperCase()}`, direct: true };
  m = /^https:\/\/([a-z0-9-]+)\.slack\.com\/archives\/([CGD][A-Z0-9]+)/i.exec(s);
  if (m) return { open: `https://${m[1].toLowerCase()}.slack.com/archives/${m[2].toUpperCase()}`, link: s, label: `${m[1].toLowerCase()} · ${m[2].toUpperCase()}`, direct: false };
  return null;
}
const slackChannel = () => slackTarget(store('slack-channel'));
async function askSlackChannel() {
  const now = store('slack-channel') || '';
  const link = await ask('Your team’s Slack channel', 'Paste the channel’s link. In Slack: right-click the channel → Copy → Copy link. (Its address in Slack in a browser, app.slack.com/client/…, opens the Slack app straight at it.)', now, 'Use this channel', { maxLength: 300, placeholder: 'https://your-team.slack.com/archives/C0123ABCD' });
  if (link === null) return null;
  const t = slackTarget(link);
  if (!t) { toast('That isn’t a Slack channel’s link. In Slack: right-click the channel → Copy → Copy link, and paste that.', 7000); return null; }
  store('slack-channel', t.link);
  slackWhere();
  return t;
}
function slackWhere() {
  const t = slackChannel();
  $('spOpen').textContent = t ? 'Copy and open Slack' : 'Copy and open Slack…';
  $('spWhere').innerHTML = t ? `Copy and open Slack goes to <b>${esc(t.label)}</b>${t.direct ? '' : ' (by way of your browser)'}. <button type="button" class="linkish" data-sp="channel">Change</button>` : '';
}

/* ---------- when you copied one for a PR (kept on this device) ---------- */
const slackKey = p => `${String(p.repo).toLowerCase()}#${p.number}`;
function slackPosted() { try { const j = JSON.parse(store('slack-posted') || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function noteSlackPosted(p, kind) {
  const all = slackPosted();
  all[slackKey(p)] = { at: Date.now(), kind };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 100);
  store('slack-posted', JSON.stringify(Object.fromEntries(keep)));
}

function slackPostDialog() {
  let d = $('spDlg');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="spDlg" class="wide sp-dlg" aria-labelledby="spTitle"><form method="dialog" id="spForm">
    <div class="setup-head"><h3 id="spTitle">Slack post</h3><button type="button" class="icon" data-sp="close" aria-label="Close">✕</button></div>
    <div class="tk-body">
      <p class="rd-intro" id="spIntro"></p>
      <div class="sp-kind" role="radiogroup" aria-label="What it’s for">
        <label><input type="radio" name="spKind" value="review"><span>Ask for a review</span></label>
        <label><input type="radio" name="spKind" value="fyi"><span>Let people know</span></label>
      </div>
      <label class="tk-prompt">Anything it should say<input id="spNote" maxlength="600" autocomplete="off" data-own-enter placeholder="Who should look, what to look at first, by when…"></label>
      <label class="tk-prompt">The post<textarea id="spText" rows="6" spellcheck="true"></textarea></label>
      <p class="sp-status" id="spStatus" role="status" aria-live="polite"></p>
      <div class="d-row"><button type="button" class="btn" data-sp="again" id="spAgain">Write it again</button><span class="spacer"></span><button type="button" class="btn" data-sp="close">Close</button><button type="button" class="btn" data-sp="open" id="spOpen">Copy and open Slack</button><button type="submit" class="btn prime" id="spCopy">Copy</button></div>
      <p class="sp-where" id="spWhere"></p>
    </div></form></dialog>`);
  d = $('spDlg');
  d.addEventListener('click', wrap(async e => {
    if (e.target === d || e.target.closest('[data-sp="close"]')) return d.close();
    if (e.target.closest('[data-sp="again"]')) return slackPostWrite();
    if (e.target.closest('[data-sp="channel"]')) return askSlackChannel();
    if (e.target.closest('[data-sp="open"]')) return slackCopy(true);
    return undefined;
  }));
  // Another kind: a new draft, unless you've changed this one (then Write it again makes a new one).
  d.addEventListener('change', e => {
    if (e.target.name !== 'spKind') return;
    if (SlackPost.dirty) { $('spStatus').textContent = 'Write it again for a new one of this kind; yours stays until then.'; return; }
    slackPostWrite();
  });
  d.addEventListener('input', e => { if (e.target.id === 'spText') SlackPost.dirty = true; });
  // Enter in the note writes it again with the note (rather than copying).
  $('spNote').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); slackPostWrite(); } });
  $('spForm').addEventListener('submit', wrap(async e => { e.preventDefault(); return slackCopy(false); }));
  return d;
}
// Copy (and, open: then your team's channel in Slack, asked for the first time).
async function slackCopy(open) {
  const text = $('spText').value.trim(), p = SlackPost.pr;
  if (!text || !p) return;
  const where = open ? slackChannel() || await askSlackChannel() : null;
  if (open && !where) return;
  // Copying and opening at once (a browser lets a click open something only straight away).
  const copying = copyText(text, open ? 'Copied. Slack is opening at your channel: paste it there.' : 'Copied. Paste it into Slack.');
  if (where) openSlackLink(where.open);
  if (!(await copying)) return;
  noteSlackPosted(p, slackKind());
  $('spDlg').close();
}
// A slack: link goes straight to the Slack app (no page opens for it); a web link opens beside this one.
function openSlackLink(url) {
  if (/^slack:/i.test(url)) location.href = url;
  else window.open(url, '_blank', 'noopener');
}
const slackKind = () => ($('spDlg').querySelector('input[name="spKind"]:checked') || {}).value || 'review';
// p: the pull request ({ repo, number, title, url, state, isDraft, reviewDecision }); sessionId: the chat that did
// the work, when there is one; mine: whether it's your PR (left out, the app asks GitHub).
function openSlackPost(p, { sessionId = null, mine = null, note = '' } = {}) {
  if (!p || !p.repo || !p.number) { toast('Pick a pull request first.'); return; }
  const d = slackPostDialog();
  Object.assign(SlackPost, { pr: p, sessionId: sessionId || null, mine: typeof mine === 'boolean' ? mine : null, dirty: false });
  const done = /merged|closed/i.test(p.state || '') || p.reviewDecision === 'APPROVED';
  d.querySelector(`input[name="spKind"][value="${done ? 'fyi' : 'review'}"]`).checked = true;
  $('spNote').value = note || '';
  $('spText').value = '';
  const before = slackPosted()[slackKey(p)];
  $('spIntro').innerHTML = `About <b>#${p.number}</b> ${esc(p.title || '')}, from its details${sessionId ? ' and the chat that did the work' : ''}. Change anything you like, then copy it into Slack.${before ? ` <span class="sp-before">You copied ${before.kind === 'fyi' ? 'one letting people know' : 'a review request'} for it ${esc(agoL(before.at))}.</span>` : ''}`;
  slackWhere();
  if (!d.open) d.showModal();
  slackPostWrite();
}
async function slackPostWrite() {
  const p = SlackPost.pr; if (!p) return;
  const gen = ++SlackPost.gen, kind = slackKind();
  const busy = on => { for (const id of ['spAgain', 'spCopy', 'spOpen']) $(id).disabled = on; $('spText').readOnly = on; $('spDlg').classList.toggle('sp-busy', on); };
  busy(true);
  $('spStatus').textContent = 'Claude is writing it…';
  try {
    const r = await api('/api/prs/slack-post', { repo: p.repo, n: p.number, kind, sessionId: SlackPost.sessionId, note: $('spNote').value, mine: SlackPost.mine });
    if (gen !== SlackPost.gen) return;
    $('spText').value = r.text || '';
    SlackPost.dirty = false;
    $('spStatus').textContent = r.withChat ? 'Written from the PR and its chat.' : 'Written from the PR’s details.';
    // Into the post, unless you're typing somewhere else in the dialog (the note) meanwhile.
    const at = document.activeElement, d = $('spDlg');
    if (d.open && (!d.contains(at) || at === d || at.disabled || at.id === 'spText')) { $('spText').focus({ preventScroll: true }); $('spText').setSelectionRange(0, 0); }
  } catch (err) {
    if (gen !== SlackPost.gen) return;
    $('spStatus').textContent = err.message || 'It couldn’t be written. Try again.';
  } finally {
    if (gen === SlackPost.gen) busy(false);
  }
}
// From a chat (/slack, its side panel): the pull request it's working on, which "This work" knows.
function slackFromChat(note = '') {
  const p = C.related && C.related.pr;
  if (!p) { toast('This chat has no pull request yet. Make one with /pr, or open the PR in Your work.', 5000); return; }
  openSlackPost({ ...p, isDraft: p.draft, reviewDecision: p.review, url: p.url || `https://github.com/${p.repo}/pull/${p.number}` }, { sessionId: C.sessionId, note });
}
