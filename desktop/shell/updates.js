'use strict';
// Updates from GitHub Releases (KatoGrey/session-switcher).
// Windows: downloaded in the background, then "Restart to update" (or on the next quit). The open
// chats are kept and come back in the new version, as after a restart.
// Mac: an app that isn't signed can't replace itself, so it offers the new version's download.
const https = require('https');
const { app, dialog, shell, Notification } = require('electron');

const REPO = 'KatoGrey/session-switcher';
const EVERY = 4 * 3600e3;

// What went wrong, in a line (an update feed's errors are long).
const friendly = err => { const m = String(err && err.message || err); return /app-update.yml/.test(m) ? 'This copy wasn’t installed by the installer, so it doesn’t update itself.' : /latest(-mac)?\.yml|404/.test(m) ? 'No update published yet.' : /ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(m) ? 'No connection to GitHub.' : m.split('\n')[0].slice(0, 160); };
const parse = v => { const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : [0, 0, 0]; };
const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

function latestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: 'api.github.com', path: `/repos/${REPO}/releases/latest`, headers: { 'User-Agent': 'SessionSwitcher', Accept: 'application/vnd.github+json' }, timeout: 15000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`GitHub answered ${res.statusCode}`)); try { return resolve(JSON.parse(body)); } catch (err) { return reject(err); } });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub didn’t answer')));
    req.on('error', reject);
  });
}

// pageShows(): the app's page is open and says it in its own words (then no dialog pops up).
function createUpdates({ window, beforeInstall, onState = () => {}, pageShows = () => false, log = () => {} }) {
  // status: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'available' (Mac: a download) | 'error'
  const state = { checking: false, ready: null, offered: null, status: 'idle', version: app.getVersion(), next: null, percent: 0, checkedAt: null, error: null, auto: process.platform === 'win32' && app.isPackaged };
  const emit = patch => { Object.assign(state, patch); onState({ ...state }); };
  let updater = null;
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
    updater.on('update-downloaded', info => {
      state.ready = info.version;
      emit({ status: 'ready', next: info.version, checkedAt: Date.now(), error: null });
      log(`Update ${info.version} downloaded.`);
      if (process.env.SWITCHER_UPDATE_AUTO === '1') return install();   // trying updates out, unattended
      return pageShows() ? undefined : offerRestart(info.version);
    });
    updater.on('error', err => { log(`Update check failed: ${err.message}`); emit({ status: 'error', error: friendly(err), checkedAt: Date.now() }); });
  }

  async function offerRestart(version) {
    const w = window();
    const r = await dialog.showMessageBox(w && w.isVisible() ? w : undefined, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready', message: `Session Switcher ${version} is ready.`,
      detail: 'Restart to use it. Open chats come back where they were. (Later: it updates the next time you quit.)',
    });
    if (r.response === 0) install();
  }
  async function install() {
    if (!updater) { if (state.url) shell.openExternal(state.url); return; }   // a Mac: the download
    if (!state.ready) return;
    await beforeInstall();
    updater.quitAndInstall(true, true);
  }

  // Mac (and Windows run from source): look for a newer release, and offer its download.
  async function checkRelease(manual, silent) {
    const r = await latestRelease();
    const v = String(r.tag_name || '').replace(/^v/, '');
    emit({ checkedAt: Date.now(), error: null, status: newer(v, app.getVersion()) ? 'available' : 'current', next: newer(v, app.getVersion()) ? v : null });
    if (!newer(v, app.getVersion())) {
      if (manual) dialog.showMessageBox({ type: 'info', message: 'Session Switcher is up to date.', detail: `You have ${app.getVersion()}, the newest.` });
      return;
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const want = process.platform === 'darwin' ? new RegExp(`mac-${arch}\\.dmg$`) : /win-x64\.exe$/;
    const asset = (r.assets || []).find(a => want.test(a.name));
    state.url = asset ? asset.browser_download_url : r.html_url;
    if (silent || (!manual && (pageShows() || state.offered === v))) return;
    state.offered = v;
    const res = await dialog.showMessageBox({
      type: 'info', buttons: ['Download it', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update available', message: `Session Switcher ${v} is out.`,
      detail: process.platform === 'darwin' ? 'Download it, open it, and drag Session Switcher into Applications (replace the old one). Your accounts and settings stay.' : 'Download and run the installer. Your accounts and settings stay.',
    });
    if (res.response === 0) shell.openExternal(asset ? asset.browser_download_url : r.html_url);
  }

  async function check(manual = false, { silent = false } = {}) {
    if (state.checking) return;
    state.checking = true;
    if (state.status !== 'ready') emit({ status: 'checking' });
    try {
      if (updater) {
        if (state.ready) { if (manual && !silent) offerRestart(state.ready); return; }
        const r = await updater.checkForUpdates();
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
  return { check, begin, install, state };
}

module.exports = { createUpdates, newer };
