'use strict';
// Updates from GitHub Releases (KatoGrey/session-switcher).
// Windows: downloaded in the background, then "Restart to update" (or on the next quit).
// Mac: Apple's update mechanism refuses an unsigned app, so it updates itself (shell/macupdate.js):
// the same download, check and "Restart to update". Where it can't (run from the disk image, or no
// write access to Applications) it offers the download instead.
// Either way the open chats are kept and come back in the new version, as after a restart.
// Channels: 'stable' (everyone) or 'beta' (test versions too, published as pre-releases).
const https = require('https');
const { app, dialog, shell, Notification } = require('electron');
const mac = require('./macupdate');

const REPO = 'KatoGrey/session-switcher';
const EVERY = 4 * 3600e3;
const IS_MAC = process.platform === 'darwin';

// What went wrong, in a line (an update feed's errors are long).
const friendly = err => { const m = String(err && err.message || err); return /app-update.yml/.test(m) ? 'This copy wasn’t installed by the installer, so it doesn’t update itself.' : /(latest|beta)(-mac)?\.yml|404/.test(m) ? 'No update published yet.' : /ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(m) ? 'No connection to GitHub.' : m.split('\n')[0].slice(0, 160); };
// Versions, test versions included: 6.3.0 > 6.3.0-beta.2 > 6.3.0-beta.1 > 6.2.0.
function compare(a, b) {
  const p = v => { const m = String(v || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/); return m ? { n: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split('.') : [] } : { n: [0, 0, 0], pre: [] }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const s = x.pre[i], t = y.pre[i];
    if (s === undefined) return -1; if (t === undefined) return 1;
    const ns = /^\d+$/.test(s), nt = /^\d+$/.test(t);
    if (ns && nt && Number(s) !== Number(t)) return Number(s) - Number(t);
    if (ns !== nt) return ns ? -1 : 1;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}
const newer = (a, b) => compare(a, b) > 0;

function github(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: 'api.github.com', path: `/repos/${REPO}${pathname}`, headers: { 'User-Agent': 'SessionSwitcher', Accept: 'application/vnd.github+json' }, timeout: 15000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`GitHub answered ${res.statusCode}`)); try { return resolve(JSON.parse(body)); } catch (err) { return reject(err); } });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub didn’t answer')));
    req.on('error', reject);
  });
}
// The newest release for this channel (test versions only on 'beta').
async function newestRelease(channel) {
  if (channel !== 'beta') return github('/releases/latest');
  const list = (await github('/releases?per_page=15')).filter(r => !r.draft);
  return list.sort((a, b) => compare(b.tag_name, a.tag_name))[0] || null;
}

// pageShows(): the app's page is open and says it in its own words (then no dialog pops up).
// channel(): 'stable' or 'beta', from the app's settings.
function createUpdates({ window, beforeInstall, onState = () => {}, pageShows = () => false, channel = () => 'stable', log = () => {} }) {
  // status: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'available' (a download to open) | 'error'
  const state = { checking: false, ready: null, offered: null, status: 'idle', version: app.getVersion(), next: null, percent: 0, checkedAt: null, error: null, auto: app.isPackaged && (!IS_MAC || mac.canSwap(mac.bundleOf(process.execPath))), channel: channel() };
  const emit = patch => { Object.assign(state, patch); onState({ ...state }); };
  let updater = null, macReady = null;
  if (process.platform === 'win32' && app.isPackaged) {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = { info: m => log(`Update: ${m}`), warn: m => log(`Update: ${m}`), error: m => log(`Update error: ${m}`), debug: () => {} };
    // For trying an update out: a folder of builds served locally.
    if (process.env.SWITCHER_UPDATE_URL) updater.setFeedURL({ provider: 'generic', url: process.env.SWITCHER_UPDATE_URL });
    updater.on('update-available', info => emit({ status: 'downloading', next: info.version, percent: 0 }));
    updater.on('download-progress', p => emit({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    updater.on('update-not-available', () => emit({ status: 'current', checkedAt: Date.now(), error: null }));
    updater.on('update-downloaded', info => ready(info.version));
    updater.on('error', err => { log(`Update check failed: ${err.message}`); emit({ status: 'error', error: friendly(err), checkedAt: Date.now() }); });
  }
  function setChannel() {
    const ch = channel();
    state.channel = ch;
    if (updater) { updater.channel = ch === 'beta' ? 'beta' : 'latest'; updater.allowPrerelease = ch === 'beta'; updater.allowDowngrade = false; }
  }
  setChannel();

  function ready(version) {
    state.ready = version;
    emit({ status: 'ready', next: version, checkedAt: Date.now(), error: null, percent: 100 });
    log(`Update ${version} downloaded.`);
    if (process.env.SWITCHER_UPDATE_AUTO === '1') return install();   // trying updates out, unattended
    return pageShows() ? undefined : offerRestart(version);
  }
  async function offerRestart(version) {
    const w = window();
    const r = await dialog.showMessageBox(w && w.isVisible() ? w : undefined, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready', message: `Session Switcher ${version} is ready.`,
      detail: `Restart to use it. Open chats come back where they were.${IS_MAC ? '' : ' (Later: it updates the next time you quit.)'}`,
    });
    if (r.response === 0) install();
  }
  async function install() {
    if (updater) {
      if (!state.ready) return;
      await beforeInstall();
      updater.quitAndInstall(true, true);
      return;
    }
    if (macReady) {
      await beforeInstall();
      mac.swapOnQuit(macReady, mac.bundleOf(process.execPath), process.pid);
      app.exit(0);
      return;
    }
    if (state.url) shell.openExternal(state.url);   // where it can't update itself: the download
  }

  // Mac (and Windows run from source): the newest release; on a Mac, downloaded and readied.
  async function checkRelease(manual, silent) {
    const r = await newestRelease(state.channel);
    const v = String((r && r.tag_name) || '').replace(/^v/, '');
    if (!r || !newer(v, app.getVersion())) {
      emit({ checkedAt: Date.now(), error: null, status: macReady ? 'ready' : 'current', next: macReady ? state.next : null });
      if (manual) dialog.showMessageBox({ type: 'info', message: 'Session Switcher is up to date.', detail: `You have ${app.getVersion()}, the newest.` });
      return;
    }
    if (macReady && state.next === v) { emit({ status: 'ready' }); return; }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const want = IS_MAC ? new RegExp(`mac-${arch}\\.dmg$`) : /win-x64\.exe$/;
    const asset = (r.assets || []).find(a => want.test(a.name));
    state.url = asset ? asset.browser_download_url : r.html_url;
    if (IS_MAC && app.isPackaged && mac.canSwap(mac.bundleOf(process.execPath))) {
      emit({ status: 'downloading', next: v, percent: 0, checkedAt: Date.now(), error: null });
      macReady = await mac.prepare({ version: v, release: r, onProgress: pc => { if (pc !== state.percent) emit({ percent: pc }); }, log });
      ready(v);
      return;
    }
    emit({ checkedAt: Date.now(), error: null, status: 'available', next: v });
    if (silent || (!manual && (pageShows() || state.offered === v))) return;
    state.offered = v;
    const res = await dialog.showMessageBox({
      type: 'info', buttons: ['Download it', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update available', message: `Session Switcher ${v} is out.`,
      detail: IS_MAC ? 'Download it, open it, and drag Session Switcher into Applications (replace the old one). Your accounts and settings stay.' : 'Download and run the installer. Your accounts and settings stay.',
    });
    if (res.response === 0) shell.openExternal(state.url);
  }

  async function check(manual = false, { silent = false } = {}) {
    if (state.checking) return;
    state.checking = true;
    setChannel();
    if (state.status !== 'ready') emit({ status: 'checking' });
    try {
      if (updater) {
        if (state.ready) { if (manual && !silent) offerRestart(state.ready); return; }
        let r;
        try { r = await updater.checkForUpdates(); } catch (err) {
          // On test versions, the newest release may be a stable one, which has no beta.yml: look at it as stable.
          if (state.channel !== 'beta' || !/beta\.yml/.test(String(err && err.message))) throw err;
          updater.channel = 'latest';
          try { r = await updater.checkForUpdates(); } finally { updater.channel = 'beta'; }
        }
        const v = r && r.updateInfo && r.updateInfo.version;
        if (manual && !silent) {
          if (v && newer(v, app.getVersion())) new Notification({ title: 'Session Switcher', body: `Downloading ${v}; it’ll ask when it’s ready.` }).show();
          else dialog.showMessageBox({ type: 'info', message: 'Session Switcher is up to date.', detail: `You have ${app.getVersion()}, the newest.` });
        }
      } else if (app.isPackaged) await checkRelease(manual && !silent, silent);
      else if (manual) dialog.showMessageBox({ type: 'info', message: 'Updates come with the installed app.', detail: 'This copy runs from its folder (npm start).' });
    } catch (err) {
      log(`Update check failed: ${err.message}`);
      emit({ status: 'error', error: friendly(err), checkedAt: Date.now() });
      if (manual && !silent) dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates.', detail: err.message });
    } finally { state.checking = false; }
  }

  function begin() {
    setTimeout(() => check(false), Number(process.env.SWITCHER_UPDATE_DELAY) || 20000);
    setInterval(() => check(false), EVERY).unref();
  }
  return { check, begin, install, state, setChannel };
}

module.exports = { createUpdates, newer, compare };
