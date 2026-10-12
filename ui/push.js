'use strict';
/* Notifications on the phone (the server's side: lib/push.js). On the phone, Setup → This phone
   turns them on:
    - in the Android app, the app shows them itself while the phone is on your Wi-Fi;
    - in a browser or an iPhone's Home Screen app, by Web Push (sw.js), which needs the secure (https)
      address Tailscale gives the PC (Setup → Phone access on the PC sets it up).
   Each phone keeps its own alert levels and quiet hours, and sends them along so the PC knows what
   that phone wants. */

const Push = { reg: null, sub: null, ts: null, tsBusy: false, prefsTimer: 0 };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushCapable = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushPrefs = () => ({ levels: alertLevels(), quiet: quietHours(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' });
// The Android app (5.3 and later) shows notifications itself.
const appNotify = () => !!(window.Android && window.Android.notifyState);
const appNotifyState = () => { try { return JSON.parse(window.Android.notifyState()); } catch { return { on: false }; } };
const b64uBytes = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };

// On the phone: the worker that shows notifications, and a tap on one opening its chat here.
async function pushBoot() {
  if (window.REMOTE && appNotify()) {
    if (appNotifyState().on) pushSyncPrefs();
    // Back from Android's settings (allowing notifications, say): show where things stand.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderPushBox(); });
    return;
  }
  if (!window.REMOTE || window.Android || !pushCapable()) return;
  try { Push.reg = await navigator.serviceWorker.register('/sw.js'); } catch { return; }
  navigator.serviceWorker.addEventListener('message', e => {
    const o = e.data && e.data.open; if (!o) return;
    if (o.key && ChatUI.openKey) ChatUI.openKey(o.key).catch(() => o.sessionId && ChatUI.open({ sessionId: o.sessionId }));
    else if (o.sessionId) ChatUI.open({ sessionId: o.sessionId });
  });
  Push.sub = await Push.reg.pushManager.getSubscription().catch(() => null);
  if (Push.sub) pushSyncPrefs();
}
// Alert levels and quiet hours changed on this phone: the PC hears about it.
function pushSyncPrefs() {
  const app = window.REMOTE && appNotify();
  if (!app && !Push.sub) return;
  clearTimeout(Push.prefsTimer);
  Push.prefsTimer = setTimeout(() => (app ? api('/api/notify/prefs', { prefs: pushPrefs() }) : api('/api/push/prefs', { endpoint: Push.sub.endpoint, prefs: pushPrefs() })).catch(() => {}), 600);
}
async function pushOn() {
  if (await Notification.requestPermission() !== 'granted') { toast('Notifications are blocked for this page. Allow them in the browser’s settings for this site, then try again.', 7000); return; }
  const { key } = await api('/api/push');
  const reg = Push.reg || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Signed up with an older key (this PC's push.json was reset): sign up afresh.
  if (sub && sub.options && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) { await sub.unsubscribe(); sub = null; }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
  await api('/api/push/subscribe', { subscription: sub.toJSON(), prefs: pushPrefs() });
  Push.sub = sub;
  toast('Notifications are on for this phone.', 3000);
}
async function pushOff() {
  const sub = Push.sub || (Push.reg && await Push.reg.pushManager.getSubscription());
  if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  Push.sub = null;
  toast('Notifications are off for this phone.', 3000);
}

// Setup → This phone.
function pushBoxHtml() {
  const head = '<p class="ph-h">Notifications</p>';
  if (appNotify()) {
    const st = appNotifyState();
    return `${head}<label class="toggle"><input type="checkbox" data-push="app" ${st.on ? 'checked' : ''}><span><b>Notifications on this phone</b><span>When a chat needs your OK, with Allow and Deny right on it, or replies. They come while this phone is on your home Wi-Fi; when you’re back, it shows what’s waiting. Each chat’s alert level and your quiet hours count.</span></span></label>
      ${st.on && !st.allowed ? '<p class="ph-note warn">Android is blocking this app’s notifications. <button class="btn sm" data-push="settings">Allow them</button></p>' : ''}
      ${st.on && st.allowed && !st.battery ? '<p class="ph-note">To get them straight away while the phone sleeps, let the app run in the background. <button class="btn quiet sm" data-push="battery">Allow</button></p>' : ''}
      ${st.on ? '<p><button class="btn quiet sm" data-push="test">Send a test</button> <button class="btn quiet sm" data-push="settings">Notification settings</button></p>' : ''}`;
  }
  if (window.Android) return `${head}<p class="ph-note">Update the app to get notifications: <button class="btn sm" data-push="get">Get the new app</button> Download it, open it and install it over this one; your pairing stays.</p>`;
  if (!window.isSecureContext) return `${head}<p class="ph-note">Phones only allow notifications on a secure address. On your PC, open Setup → <b>Phone access</b> → <b>Notifications on your phone</b> to set one up with Tailscale, then open that address here and pair once.</p>`;
  if (isIOS() && !isStandalone()) return `${head}<p class="ph-note">On an iPhone, add this page to your Home Screen first (Share → <b>Add to Home Screen</b>), open it from there and turn notifications on.</p>`;
  if (!pushCapable()) return `${head}<p class="ph-note">This browser can’t receive notifications.</p>`;
  if (Notification.permission === 'denied') return `${head}<p class="ph-note">Notifications are blocked for this page. Allow them in the browser’s settings for this site, then come back.</p>`;
  return `${head}<label class="toggle"><input type="checkbox" data-push="on" ${Push.sub ? 'checked' : ''}><span><b>Notifications on this phone</b><span>When a chat needs your OK${isIOS() ? ' (tap to answer it)' : ', with Allow and Deny right on it,'} or replies, even with Session Switcher closed. Each chat’s alert level and your quiet hours count.</span></span></label>
    ${Push.sub ? '<p><button class="btn quiet sm" data-push="test">Send a test</button></p>' : ''}`;
}
function renderPushBox() { const b = $('pushBox'); if (b) b.innerHTML = pushBoxHtml(); }

// The PC: Setup → Phone access → Notifications on your phone (Tailscale's https address).
async function loadTailscale(force = false) {
  if (window.REMOTE || !$('tsBox')) return;
  if (!Push.ts || force) { try { Push.ts = await api('/api/phone/tailscale'); } catch (err) { Push.ts = { error: err.message }; } }
  renderTailscale();
}
function renderTailscale(phones = Push.phones || 0) {
  const box = $('tsBox'); if (!box) return;
  const t = Push.ts, apps = Push.apps || 0;
  const intro = `<p class="ph-h">Notifications on your phone</p><p class="ph-note"><b>Android:</b> in the app, open Setup → <b>Notifications on this phone</b>. They come while the phone is on your Wi-Fi, with Allow and Deny on them. ${apps ? `<b>${apps}</b> ${apps === 1 ? 'phone is' : 'phones are'} listening now.` : ''}</p><details class="ts-more"${t && t.serving ? ' open' : ''}><summary>iPhone, or a browser (needs Tailscale)</summary><p class="ph-note">Phones only allow a browser’s notifications on a secure (https) address. Tailscale gives this PC one for free, reachable only by your own devices, and it works away from home too.</p>`;
  let body;
  if (!t) body = '<p class="loading">Checking for Tailscale…</p>';
  else if (t.error) body = `<p class="ph-note warn">${esc(t.error)}</p>`;
  else if (!t.installed) body = `<ol class="ts-steps"><li>Install Tailscale on this PC and on your phone: <a href="https://tailscale.com/download" target="_blank" rel="noopener">tailscale.com/download</a>. Sign in to the same account on both.</li><li>Then come back here.</li></ol><p><button class="btn sm" data-ts="check">Check again</button></p>`;
  else if (!t.running) body = '<p class="ph-note">Tailscale is installed but not connected. Open it and sign in, then check again.</p><p><button class="btn sm" data-ts="check">Check again</button></p>';
  else if (!t.serving) body = `${t.enable ? `<p class="ph-note">First, turn on HTTPS for your Tailscale network (once): <a href="${esc(t.enable)}" target="_blank" rel="noopener">Turn on HTTPS</a>. Then set it up again.</p>` : ''}<p class="ph-note">This makes <code>${esc(t.url || 'https://…ts.net')}</code> open Session Switcher, for your own devices only.</p><p><button class="btn prime sm" data-ts="serve" ${Push.tsBusy ? 'disabled' : ''}>${Push.tsBusy ? 'Setting it up…' : 'Set up the secure address'}</button> <button class="btn quiet sm" data-ts="check">Check again</button></p>`;
  else body = `<p class="ph-note">Secure address: <code class="ph-addr">${esc(t.url)}</code></p><ol class="ts-steps"><li>On your phone, open that address. <b>iPhone:</b> in Safari, Share → <b>Add to Home Screen</b>, and open it from there. <b>Android:</b> in Chrome, ⋮ → <b>Add to Home screen</b>.</li><li>Pair it with a code from step 3 (a new address pairs once).</li><li>On the phone: Setup → <b>Notifications on this phone</b>.</li></ol><p class="ph-note">${phones ? `<b>${phones}</b> ${phones === 1 ? 'phone gets' : 'phones get'} notifications.` : 'No phone gets notifications yet.'}</p>`;
  box.innerHTML = `${intro}${body}</details>`;
}

document.addEventListener('change', wrap(async e => {
  const a = e.target.closest('[data-push="app"]');
  if (a) {
    window.Android.setNotify(a.checked);
    if (a.checked) pushSyncPrefs();
    toast(a.checked ? 'Notifications are on for this phone.' : 'Notifications are off for this phone.', 3000);
    setTimeout(renderPushBox, 800);
    return;
  }
  const t = e.target.closest('[data-push="on"]'); if (!t) return;
  t.disabled = true;
  try { if (t.checked) await pushOn(); else await pushOff(); } finally { renderPushBox(); }
}));
document.addEventListener('click', wrap(async e => {
  const b = e.target.closest('[data-push="test"], [data-push="settings"], [data-push="battery"], [data-push="get"], [data-ts]'); if (!b) return;
  if (b.dataset.push === 'settings') return window.Android.notifySettings();
  if (b.dataset.push === 'battery') return window.Android.askBattery();
  if (b.dataset.push === 'get') return window.Android.openExternal(`${location.origin}/get`);
  if (b.dataset.push === 'test') { const r = await api(appNotify() ? '/api/notify/test' : '/api/push/test', {}); toast(r.ok ? 'Sent. It should show in a moment.' : `Couldn’t send it. ${r.why || ''}`, 5000); return; }
  if (b.dataset.ts === 'check') { Push.ts = null; renderTailscale(); return loadTailscale(true); }
  if (b.dataset.ts === 'serve') {
    Push.tsBusy = true; renderTailscale();
    try { Push.ts = await api('/api/phone/tailscale-serve', {}); if (Push.ts.serving) toast('Your secure address is ready.', 3000); } finally { Push.tsBusy = false; renderTailscale(); }
  }
  return undefined;
}));

pushBoot();
