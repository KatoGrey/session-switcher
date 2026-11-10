'use strict';
// Your home PC in this window (a laptop of yours, paired in Setup → Your home PC). The pairing and the
// relay the window goes through are the app's server's (lib/homepc.js); this picks which one the window
// shows: the PC when it answers, this laptop's own copy when it doesn't, and back when you say.
const fs = require('fs');
const path = require('path');
const http = require('http');

function createHome({ dataDir, relayPort, localUrl, window: win, log = () => {}, notify = () => {}, post = async () => 0, onState = () => {} }) {
  const relayUrl = `http://127.0.0.1:${relayPort}/`;
  let on = 'laptop', reason = null, fails = 0, timer = null, toldBack = false, pcUp = null;
  const settings = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'home-pc.json'), 'utf8')) || {}; } catch { return {}; } };
  const paired = () => !!settings().key;
  const wants = () => paired() && settings().use === 'pc';

  // The PC, through the relay: there, and still knows this laptop.
  function hello(timeout = 4000) {
    return new Promise(resolve => {
      const req = http.get(`${relayUrl}hello`, { timeout }, res => {
        let s = ''; res.setEncoding('utf8');
        res.on('data', d => { s += d; });
        res.on('end', () => { try { const j = JSON.parse(s); resolve(j.app === 'session-switcher' && !!j.paired); } catch { resolve(false); } });
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
  }
  // The app's server is told where the window is (for the line at the top of the page): only on a laptop
  // that's paired, so a computer that never uses this hears nothing of it.
  function tell() {
    const isPaired = paired();
    if (isPaired) post('/api/homepc/showing', { on, reason }).catch(() => {});
    onState({ on, reason, paired: isPaired, pcUp });
  }
  function load(where, why) {
    on = where; reason = why;
    const w = win();
    if (w && !w.isDestroyed()) w.loadURL(where === 'pc' ? relayUrl : localUrl);
    log(`Home PC: the window shows ${where === 'pc' ? 'your home PC' : 'this laptop'}${why ? ` (${why})` : ''}.`);
    tell();
  }
  // Where the window starts: your PC if you use it and it answers in a few seconds, else here.
  async function startUrl() {
    if (!wants()) { on = 'laptop'; reason = null; tell(); return localUrl; }
    pcUp = await hello(3500);
    if (pcUp) { on = 'pc'; reason = null; tell(); return relayUrl; }
    on = 'laptop'; reason = 'pc-down'; tell();
    notify('Your home PC isn’t answering', 'You’re on this laptop’s own copy. It switches back when you say, once the PC is on again.');
    return localUrl;
  }
  const currentUrl = () => (on === 'pc' ? relayUrl : localUrl);

  // A computer that isn't paired with a PC is looked at again once a minute, not every ten seconds.
  let idleUntil = 0;
  async function tick() {
    if (on !== 'pc' && Date.now() < idleUntil) return;
    if (!paired()) { idleUntil = Date.now() + 60000; if (on === 'pc') load('laptop', null); return; }
    idleUntil = 0;
    const up = await hello();
    const was = pcUp; pcUp = up;
    if (on === 'pc') {
      if (up) { fails = 0; return; }
      if (++fails < 2) return;
      fails = 0; toldBack = false;
      load('laptop', 'pc-down');
      notify('Your home PC stopped answering', 'You’re on this laptop’s own copy now. Your chats on the PC are safe there; switch back once it’s on again.');
      return;
    }
    if (up !== was) tell();
    if (up && reason === 'pc-down' && !toldBack) {
      toldBack = true;
      notify('Your home PC is back', 'Open Session Switcher to send what you did here to it, and switch back.');
    }
  }
  function begin() { clearInterval(timer); timer = setInterval(() => { tick().catch(() => {}); }, 10000); timer.unref(); }
  function stop() { clearInterval(timer); }
  // From the tray or the page. Your choice is kept for next time.
  function switchTo(where) {
    if (where === 'pc' && !paired()) return state();
    post('/api/homepc/use', { use: where === 'pc' ? 'pc' : 'laptop' }).catch(() => {});
    if (where !== on) load(where === 'pc' ? 'pc' : 'laptop', where === 'pc' ? null : 'chosen');
    return state();
  }
  // The window landed on the relay's "isn't answering" page: no need to wait for the next check.
  function pageLoaded(url, code) {
    if (on === 'pc' && url.startsWith(relayUrl) && code === 502) { toldBack = false; load('laptop', 'pc-down'); notify('Your home PC isn’t answering', 'You’re on this laptop’s own copy now.'); }
  }
  const state = () => ({ on, reason, paired: paired(), pcUp });
  const ours = url => url.startsWith(relayUrl);
  return { startUrl, currentUrl, begin, stop, switchTo, pageLoaded, state, ours, relayUrl, paired };
}

module.exports = { createHome };
