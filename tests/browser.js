// A small headless-browser driver over the Chrome DevTools protocol. No packages: it finds Edge or
// Chrome on this machine (or the one in $BROWSER) and talks to it with Node's built-in WebSocket.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const pf = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === 'win32'
    ? pf.flatMap(d => [path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found. Set BROWSER to the browser’s full path.');
  return found;
}

async function launch({ width = 1440, height = 900, mobile = false, scale = null } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('The tests need Node.js 22 or newer (for its built-in WebSocket).');
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-browser-'));
  const proc = spawn(findBrowser(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    // Keep the page "visible": extensions and sync pages in a fresh profile would push it into the
    // background, where timers, animation frames and resize observers slow down or stop.
    '--disable-extensions', '--disable-sync', '--disable-features=msEdgeSyncConsent,EdgeSync',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pg = list.find(x => x.type === 'page');
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!ws) await sleep(200);
  }
  if (!ws) { proc.kill(); throw new Error('The browser didn’t start.'); }
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });

  let id = 0;
  const wait = new Map(), logs = [], hooks = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method) for (const h of hooks) h(m);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`EXC ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!sessionStorage.getItem('tour-test')) localStorage.setItem('toured', '1'); } catch (e) {}" });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale || (mobile ? 2.6 : 1), mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const fetchHandlers = [];
  const b = {
    logs, send,
    on: fn => hooks.push(fn),
    // Answers matching requests itself. Every handler sees every request (pass null to let it through);
    // the first one to answer wins.
    intercept: async (pattern, handler) => {
      fetchHandlers.push({ pattern, handler });
      await send('Fetch.enable', { patterns: fetchHandlers.map(h => ({ urlPattern: h.pattern })) });
      if (fetchHandlers.length > 1) return;
      hooks.push(async m => {
        if (m.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = m.params;
        let r = null;
        for (const h of fetchHandlers) {
          try { r = await h.handler(request.url, request.method, request.postData); } catch (err) { r = { status: 500, body: { error: err.message } }; }
          if (r) break;
        }
        if (!r) return send('Fetch.continueRequest', { requestId });
        const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
        return send('Fetch.fulfillRequest', { requestId, responseCode: r.status || 200, responseHeaders: [{ name: 'Content-Type', value: r.type || 'application/json' }, { name: 'Cache-Control', value: 'no-store' }, ...(r.headers || [])], body: body.toString('base64') });
      });
    },
    nav: async (url, settle = 2500) => { await send('Page.navigate', { url }); await sleep(settle); },
    // Runs code in the page (inside an async function, so it can await) and returns its JSON result.
    eval: async expr => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result.result.value;
    },
    shot: async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    // Real input, as a person would give it.
    key: async (key, code = key, vk = 0, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
      await sleep(120);
    },
    click: async (x, y, button = 'left') => {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
      await sleep(250);
    },
    // Clicks the middle of the first element matching sel. If it's off-screen or something covers it
    // (a docked message box, say), it's scrolled into view first.
    clickOn: async sel => {
      const r = await b.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
        const mid = () => { const q = el.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; };
        const reachable = ([x, y]) => { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); };
        let p = mid();
        if (!reachable(p)) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); await new Promise(r => setTimeout(r, 150)); p = mid(); }
        return p`);
      if (!r) throw new Error(`Nothing to click: ${sel}`);
      await b.click(r[0], r[1]);
    },
    close: () => { try { ws.close(); } catch { /* gone */ } proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ } }, 1500); },
  };
  b.esc = () => b.key('Escape', 'Escape', 27);
  b.down = () => b.key('ArrowDown', 'ArrowDown', 40);
  return b;
}

module.exports = { launch, sleep, findBrowser };
