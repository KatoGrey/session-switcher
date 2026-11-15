'use strict';
/* Slack post: a few plain sentences about a pull request, with its link, to ask your team for a review or let them
   know about it. Claude drafts it from the PR and the chat that did the work (lib/slackpost.js); you change what you
   like and copy it into Slack. Opened from Your work, Pull requests, a chat's side panel and /slack. */

const SlackPost = { pr: null, sessionId: null, mine: null, gen: 0, dirty: false };

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
      <div class="d-row"><button type="button" class="btn" data-sp="again" id="spAgain">Write it again</button><span class="spacer"></span><button type="button" class="btn" data-sp="close">Close</button><button type="submit" class="btn prime" id="spCopy">Copy</button></div>
    </div></form></dialog>`);
  d = $('spDlg');
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-sp="close"]')) return d.close();
    if (e.target.closest('[data-sp="again"]')) return slackPostWrite();
    return undefined;
  });
  // Another kind: a new draft, unless you've changed this one (then Write it again makes a new one).
  d.addEventListener('change', e => {
    if (e.target.name !== 'spKind') return;
    if (SlackPost.dirty) { $('spStatus').textContent = 'Write it again for a new one of this kind; yours stays until then.'; return; }
    slackPostWrite();
  });
  d.addEventListener('input', e => { if (e.target.id === 'spText') SlackPost.dirty = true; });
  // Enter in the note writes it again with the note (rather than copying).
  $('spNote').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); slackPostWrite(); } });
  $('spForm').addEventListener('submit', wrap(async e => {
    e.preventDefault();
    const text = $('spText').value.trim();
    if (!text) return;
    if (await copyText(text, 'Copied. Paste it into Slack.')) d.close();
  }));
  return d;
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
  $('spIntro').innerHTML = `About <b>#${p.number}</b> ${esc(p.title || '')}, from its details${sessionId ? ' and the chat that did the work' : ''}. Change anything you like, then copy it into Slack.`;
  if (!d.open) d.showModal();
  slackPostWrite();
}
async function slackPostWrite() {
  const p = SlackPost.pr; if (!p) return;
  const gen = ++SlackPost.gen, kind = slackKind();
  const busy = on => { for (const id of ['spAgain', 'spCopy']) $(id).disabled = on; $('spText').readOnly = on; $('spDlg').classList.toggle('sp-busy', on); };
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
