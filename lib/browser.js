'use strict';
// The chats' side of the app's built-in browser. The tabs live in the desktop app (desktop/shell/browser.js),
// which this server reaches over its IPC channel; this file gives chats their tools for them:
//  - Claude chats get lib/browser-mcp.js as an MCP server (--mcp-config, allowed without asking), Codex chats the
//    same through their thread's config. Each chat has a key of its own, so its tools reach only its own tabs
//    (a tab's owner is the chat's session id, which stays the same when it's resumed or moves to another account).
//  - The tools (lib/browser-tools.js) are carried out here, from a few things the desktop app can do to a tab:
//    the DevTools protocol (real mouse and keys, screenshots, scripts) and scripts in a world of their own
//    (lib/browser-scripts.js). The Voyage ones play voyage.io as text.
// Elsewhere (the app run from its folder, or on a Mac without the desktop app) there's no browser, and chats
// aren't given the tools.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const S = require('./browser-scripts');
const { TOOLS, NAMES, SERVER } = require('./browser-tools');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = /^[a-f0-9]{40}$/;
const PROMPT_TOOL = new RegExp(`^mcp__${SERVER}__`);
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Which browser chats are given (Setup → Preferences → The browser chats use): 'app' (this one), 'chrome' (Claude in
// Chrome, the extension), 'both' (the default in the desktop app: Chrome stays there for anyone who uses it), or
// 'off'. An older setting, chromeInChats: false, meant "not Chrome".
function browserPref(prefs = {}, shellHere = true) {
  if (['app', 'chrome', 'both', 'off'].includes(prefs.browser)) return !shellHere && prefs.browser === 'app' ? 'chrome' : !shellHere && prefs.browser === 'both' ? 'chrome' : prefs.browser;
  if (!shellHere) return prefs.chromeInChats === false ? 'off' : 'chrome';
  return prefs.chromeInChats === false ? 'app' : 'both';
}

function createBrowser({ log = () => {}, dataDir, port, execPath = process.execPath, runAsNode = {}, appDir = path.join(__dirname, '..'), getPrefs = () => ({}), chatByKey = () => null, shell = null } = {}) {
  const pending = new Map();
  let seq = 0;
  const here = () => shell === 'electron' && typeof process.send === 'function';
  const pref = () => browserPref(getPrefs() || {}, here());
  const wanted = () => here() && (pref() === 'app' || pref() === 'both');

  // ---------- the desktop app ----------
  function request(op, args = {}, ms = 65000) {
    if (!here()) return Promise.reject(fail('The built-in browser is part of the Session Switcher desktop app, and this copy isn’t running in it.', 503));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(fail(`The browser didn’t answer (${op}).`, 504)); }, ms);
      pending.set(id, { resolve, reject, timer });
      try { process.send({ type: 'browser', id, op, args }); } catch (err) { clearTimeout(timer); pending.delete(id); reject(fail(`The browser can’t be reached: ${err.message}`, 503)); }
    });
  }
  // The desktop app's answer (server.js passes on its messages).
  function onMessage(m) {
    if (!m || m.type !== 'browser:result') return false;
    const p = pending.get(m.id);
    if (!p) return true;
    pending.delete(m.id); clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result); else p.reject(fail(m.error || 'The browser couldn’t do that.', 400));
    return true;
  }

  // ---------- keys: which chat a tool call comes from ----------
  const KEYS_FILE = path.join(dataDir, 'browser-keys.json');
  const keys = new Map();
  try {
    const saved = (store.readJson(KEYS_FILE, {}) || {}).keys || {};
    const old = Date.now() - 45 * 864e5;
    for (const [k, v] of Object.entries(saved)) if (KEY.test(k) && v && v.at > old) keys.set(k, v);
  } catch { /* none yet */ }
  let saveTimer = null;
  const saveKeys = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { store.writeJsonAtomic(KEYS_FILE, { keys: Object.fromEntries(keys) }); } catch (err) { log(`Browser: couldn’t save its keys (${err.message})`); } }, 500); };
  function ownerOf(key) {
    const k = KEY.test(String(key || '')) && keys.get(key);
    if (!k) throw fail('This chat’s browser key isn’t known (it may be from an old copy of the app). Reopen the chat.', 403);
    const c = k.chatKey ? chatByKey(k.chatKey) : null;
    // A partner working in another chat (Claude and Codex together) shares that chat's tabs: they're one chat to you.
    const lead = c && c.parentKey ? chatByKey(c.parentKey) : null;
    if (lead && lead.sessionId) return String(lead.sessionId).toLowerCase();
    if (c && c.sessionId && c.sessionId !== k.sessionId) { k.sessionId = c.sessionId; saveKeys(); }
    const owner = k.sessionId ? String(k.sessionId).toLowerCase() : k.chatKey ? `key:${k.chatKey}` : null;
    if (!owner) throw fail('This chat hasn’t started yet.', 409);
    if (Date.now() - (k.at || 0) > 864e5) { k.at = Date.now(); saveKeys(); }
    return owner;
  }

  // ---------- giving chats the tools ----------
  const MCP_SCRIPT = path.join(appDir, 'lib', 'browser-mcp.js');
  const cfgDir = path.join(os.tmpdir(), 'claude-switcher', 'browser');
  const SAFE_ARG = /^[\w.:=/-]+$/;
  (function tidy() {   // config files of chats long gone
    try { const old = Date.now() - 45 * 864e5; for (const f of fs.readdirSync(cfgDir)) { const p = path.join(cfgDir, f); if (fs.statSync(p).mtimeMs < old) fs.rmSync(p, { force: true }); } } catch { /* none */ }
  })();
  const serverEnv = key => ({ ...runAsNode, SWITCHER_URL: `http://127.0.0.1:${port}`, SWITCHER_BROWSER_KEY: key });
  // Called for each chat as it's made (and as it's carried over a restart: restored), before it starts.
  function prepare(chat, restored = false) {
    try {
      if (!wanted() || !chat || chat.aide) return;
      const provider = chat.provider || (chat.account && chat.account.provider) || 'claude';
      if (provider !== 'claude' && provider !== 'codex') return;
      const extra = Array.isArray(chat.extraArgs) ? chat.extraArgs : [];
      if (provider === 'claude' && (extra.includes('--strict-mcp-config') || extra.includes('--mcp-config'))) return;   // the Commander, the companion: tools of their own
      if (!KEY.test(String(chat.browserKey || ''))) chat.browserKey = crypto.randomBytes(20).toString('hex');
      const k = keys.get(chat.browserKey) || {};
      keys.set(chat.browserKey, { sessionId: chat.sessionId || k.sessionId || null, chatKey: chat.key, at: Date.now() });
      saveKeys();
      if (restored) return;   // carried over a restart: its process already has them
      if (provider === 'claude') {
        fs.mkdirSync(cfgDir, { recursive: true });
        const file = path.join(cfgDir, `${chat.browserKey.slice(0, 16)}.json`);
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER]: { type: 'stdio', command: execPath, args: [MCP_SCRIPT], env: serverEnv(chat.browserKey) } } }), { mode: 0o600 });
        const arg = file.replace(/\\/g, '/');
        if (!SAFE_ARG.test(arg)) { log(`Browser: not given to a chat (its settings file’s path has spaces: ${arg})`); return; }
        chat.extraArgs = [...extra, '--mcp-config', arg, '--allowedTools', `mcp__${SERVER}`];
      } else {
        chat.threadConfig = { ...(chat.threadConfig || {}), [`mcp_servers.${SERVER}`]: { command: execPath, args: [MCP_SCRIPT], env: serverEnv(chat.browserKey), startup_timeout_sec: 30, tool_timeout_sec: 900 } };
      }
    } catch (err) { log(`Browser: couldn’t give a chat its tools (${err.message})`); }
  }
  // A tool call the assistant would ask about: these are the chat's own browser, so they go ahead.
  const isOurs = toolName => PROMPT_TOOL.test(String(toolName || ''));
  const isOurServer = name => String(name || '') === SERVER;

  // ---------- the tools ----------
  const iso = (t, fn, args = {}, ms = 20000) => request('isolated', { id: t.id, code: S.call(fn, args), timeout: ms }, ms + 5000).then(S.unwrap);
  const cdp = (t, method, params = {}, ms = 30000) => request('cdp', { id: t.id, method, params, timeout: ms }, ms + 5000);
  const activity = (t, kind, x, y, label) => request('activity', { id: t.id, kind, x, y, label }).catch(() => {});
  const describe = t => `${t.id}${t.current ? ' (current)' : ''} · ${clip(t.title || 'Untitled', 80)} · ${t.url || 'about:blank'} · ${t.size.w}×${t.size.h} ${t.size.preset}${t.loading ? ' · loading' : ''}${t.crashed ? ' · the page stopped: reload it' : ''}`;
  async function tabOf(owner, want, make = false) {
    if (want) {
      const mine = await request('list', { owner });
      const t = mine.find(x => x.id === String(want));
      if (!t) throw fail(mine.length ? `This chat has no tab ${want}. Its tabs: ${mine.map(x => x.id).join(', ')}.` : `This chat has no tab ${want} (it has none open).`);
      if (!t.current) await request('current', { owner, id: t.id });
      return t;
    }
    let t = await request('current', { owner });
    if (!t && make) t = await request('create', { owner });
    if (!t) throw fail('This chat has no tab open yet: use navigate (or open_tab) first.');
    return t;
  }
  async function notesSince(t, at) {
    const n = await request('logs', { id: t.id, kind: 'notes', since: at }).catch(() => []);
    return n.map(x => x.text);
  }
  // After an action: a new address, and anything the page said (a message box, a download, a failed load).
  async function aftermath(t, at, wait = 350) {
    await sleep(wait);
    const now = (await request('list', { owner: t.owner }).catch(() => [])).find(x => x.id === t.id);
    const out = [];
    if (now && now.url !== t.url) out.push(`The page is now ${clip(now.title || '', 80)} (${now.url}).`);
    out.push(...await notesSince(t, at));
    const tabsNow = await request('list', { owner: t.owner }).catch(() => []);
    const newTabs = tabsNow.filter(x => x.created >= at && x.id !== t.id);
    for (const n of newTabs) out.push(`It opened a new tab, ${n.id} (${n.url || 'loading'}), now current.`);
    return out;
  }
  const MOD = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };
  const modBits = list => (Array.isArray(list) ? list : []).reduce((m, k) => m | (MOD[String(k).toLowerCase()] || 0), 0);
  async function clickAt(t, x, y, { button = 'left', double = false, modifiers = 0 } = {}) {
    x = Math.round(Number(x)); y = Math.round(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw fail('Give x and y, a ref, or text to click.');
    if (x < 0 || y < 0 || x >= t.size.w || y >= t.size.h) throw fail(`${x},${y} is outside the page (${t.size.w}×${t.size.h}). Scroll first, or click a ref.`);
    const base = { x, y, button, modifiers };
    await cdp(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      await cdp(t, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', clickCount: n });
      await cdp(t, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: n });
    }
  }
  const KEYS = {
    enter: ['Enter', 'Enter', 13, '\r'], return: ['Enter', 'Enter', 13, '\r'], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
    backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], del: ['Delete', 'Delete', 46], space: [' ', 'Space', 32, ' '], ' ': [' ', 'Space', 32, ' '],
    arrowup: ['ArrowUp', 'ArrowUp', 38], up: ['ArrowUp', 'ArrowUp', 38], arrowdown: ['ArrowDown', 'ArrowDown', 40], down: ['ArrowDown', 'ArrowDown', 40],
    arrowleft: ['ArrowLeft', 'ArrowLeft', 37], left: ['ArrowLeft', 'ArrowLeft', 37], arrowright: ['ArrowRight', 'ArrowRight', 39], right: ['ArrowRight', 'ArrowRight', 39],
    home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34], insert: ['Insert', 'Insert', 45],
  };
  for (let i = 1; i <= 12; i++) KEYS[`f${i}`] = [`F${i}`, `F${i}`, 111 + i];
  function parseKey(spec) {
    const parts = String(spec).split('+');
    let name = parts.pop();
    if (name === '' && parts.length) { parts.pop(); name = '+'; }   // "ctrl++"
    const odd = parts.find(p => !MOD[p.toLowerCase()]);
    if (odd !== undefined) throw fail(`“${odd}” in “${spec}” isn’t a key this knows to hold: use ctrl, shift, alt or meta.`);
    const mods = modBits(parts);
    const k = KEYS[name.toLowerCase()];
    if (k) return { key: k[0], code: k[1], vk: k[2], text: k[3] && !(mods & 7) ? k[3] : undefined, mods };
    if ([...name].length !== 1) throw fail(`“${spec}” isn’t a key this knows. Use names like Enter, Tab, Escape, ArrowDown, space, PageDown, F5 or a single character, with ctrl+, shift+, alt+.`);
    const ch = name, up = ch.toUpperCase();
    const letter = /^[a-z]$/i.test(ch), digit = /^\d$/.test(ch);
    const shown = mods & 8 && letter ? up : ch;
    return { key: shown, code: letter ? `Key${up}` : digit ? `Digit${ch}` : '', vk: letter || digit ? up.charCodeAt(0) : 0, text: !(mods & 7) ? shown : undefined, mods };
  }
  async function press(t, spec, repeat = 1) {
    const seq2 = String(spec).trim().split(/\s+/).filter(Boolean).map(parseKey);
    for (let r = 0; r < repeat; r++) {
      for (const k of seq2) {
        const common = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.mods };
        await cdp(t, 'Input.dispatchKeyEvent', { ...common, type: k.text ? 'keyDown' : 'rawKeyDown', ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
        await cdp(t, 'Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
      }
    }
  }
  async function picture(t, { scale = 1, region = null } = {}) {
    let clip2 = null, width;
    if (Array.isArray(region) && region.length === 4) {
      const [x0, y0, x1, y1] = region.map(Number);
      clip2 = { x: Math.max(0, Math.min(x0, x1)), y: Math.max(0, Math.min(y0, y1)), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
      if (!(clip2.width >= 4 && clip2.height >= 4)) throw fail('region is [x0, y0, x1, y1], at least a few pixels across.');
      width = Math.round(Math.min(1280, clip2.width * Math.min(3, Math.max(1, 640 / clip2.width))));
    } else width = Math.round(t.size.w * Math.min(1, Math.max(0.25, Number(scale) || 1)));
    const shot = await request('capture', { id: t.id, clip: clip2, width, quality: 72 });
    const f = clip2 ? shot.width / clip2.width : shot.width / t.size.w;
    const how = clip2
      ? `This is the part ${clip2.x},${clip2.y} to ${clip2.x + clip2.width},${clip2.y + clip2.height} of the page${Math.abs(f - 1) > 0.01 ? `, shown ${f.toFixed(2)}× (a point seen at x,y is at ${clip2.x} + x/${f.toFixed(2)}, ${clip2.y} + y/${f.toFixed(2)} on the page)` : ''}.`
      : Math.abs(f - 1) > 0.01 ? `The picture is ${shot.width}×${shot.height}; the page is ${t.size.w}×${t.size.h}, so to click what you see at x,y use x/${f.toFixed(2)}, y/${f.toFixed(2)}.` : `The picture is the page, ${t.size.w}×${t.size.h}: click at what you see.`;
    return { text: `Tab ${t.id} · ${clip(t.title || '', 80)} · ${t.url}\n${how}`, image: shot.data };
  }
  const result = (text, image = null) => ({ text, image });
  // A pattern the chat gives (console, network): a regular expression, kept short.
  function pattern(p) { const s = String(p).slice(0, 200); try { return new RegExp(s, 'i'); } catch { throw fail(`“${s}” isn’t a regular expression.`); } }

  // Voyage: waits out a turn, skipping its dialogue, and says when the game's ready (or why it stopped).
  async function voyageWait(t, seconds, lines) {
    const until = Date.now() + seconds * 1000;
    let last = '', quiet = 0, recaps = 0;
    for (;;) {
      if (Date.now() > until) return { done: false, phase: await iso(t, S.voyagePhase).catch(() => ({})), why: `it was still going after ${seconds} s` };
      const ph = await iso(t, S.voyagePhase);
      if (ph.recap && recaps++ < 3) { const p = await iso(t, S.pointOf, { text: 'Take my first turn' }).catch(() => null); if (p) await clickAt(t, p.x, p.y); await sleep(600); continue; }
      if (ph.recap) return { done: false, phase: ph, why: 'the story recap wouldn’t close (its “Take my first turn” button didn’t work)' };
      if (ph.dialogue) {
        quiet = 0;
        if (ph.line && ph.line !== last) { lines.push(ph.line); last = ph.line; }
        await iso(t, S.voyageSkip);
        await activity(t, 'key', null, null, 'Skipping dialogue (Space)');
        await sleep(450);
      } else if (ph.screen === 'game' && ph.ready && !ph.waiting && !ph.generating) {
        if (++quiet >= 2) return { done: true, phase: ph };   // ready twice in a row: settled
        await sleep(400);
      } else if (ph.screen !== 'game' && ph.screen !== 'loading') return { done: false, phase: ph, why: `the page left the game (${ph.screen})` };
      else { quiet = 0; await sleep(800); }
      if (ph.errors && ph.errors.length) return { done: false, phase: ph, why: ph.errors.join(' · ') };
      if (Date.now() > until) return { done: false, phase: ph, why: `it was still going after ${seconds} s` };
    }
  }
  function statusText(s) {
    const L = [`Screen: ${s.screen}${s.turn ? ` (turn ${s.turn})` : ''}`, `Address: ${s.address}`];
    if (s.screen === 'setup') {
      L.push(`Step: ${s.step || '?'}${s.stepOf ? ` (${s.stepOf})` : ''}${s.waiting ? ` · ${s.waiting}` : ''}`);
      if (s.openings && s.openings.length) L.push(`Openings: ${s.openings.map(o => `${o.selected ? '✓ ' : ''}${o.title} [${o.ref}]`).join(' · ')}`);
      if (s.characters && s.characters.length) L.push(`Characters: ${s.characters.map(c => `${c.selected ? '✓ ' : ''}${c.name} [${c.ref}]`).join(' · ')}`);
      if (s.forward) L.push(`Forward: “${s.forward.text}”${s.forward.disabled ? ' (disabled: choose something on this step first)' : ''} [${s.forward.ref}]`);
      if (s.buttons && s.buttons.length) L.push(`Buttons: ${s.buttons.join(' · ')}`);
    } else if (s.screen === 'game') {
      L.push(s.dialogue ? `Dialogue playing (${s.dialogue.mode}): “${s.dialogue.line}” (voyage_continue skips it)` : 'No dialogue playing.');
      L.push(s.input.hidden ? 'Action box: not shown.' : `Action box: ${s.input.ready ? 'ready' : 'not ready'}${s.input.placeholder ? ` (“${s.input.placeholder}”)` : ''}${s.input.value ? `, holding “${s.input.value}”` : ''}`);
      if (s.waitingForGameState) L.push('The game is updating its state.');
      if (s.generating) L.push('The story is being written.');
      if (s.objective) L.push(s.objective);
      if (s.location) L.push(`Where: ${s.location}`);
      if (s.recap) L.push(s.recap);
      if (s.choices) L.push(`Choices from the last turn: ${s.choices.join(' · ')}`);
      if (s.special) L.push(`Also on screen: ${s.special.join(' · ')}`);
      if (s.nearby) L.push(`Nearby: ${s.nearby.join(', ')}`);
    } else if (s.screen === 'world') { L.push(`World page: ${s.title}`); if (s.signedOut) L.push('Signed out: Voyage asks to “Create an account or sign in” before playing. Ask the user to sign in in the browser beside the chat (sign-ins there are kept), then carry on.'); else if (s.start) L.push(`“${s.start.text}” starts a game [${s.start.ref}] (voyage_start does the rest)`); }
    else if (s.screen === 'server choice' && s.buttons) L.push(`Buttons: ${s.buttons.join(' · ')}`);
    else if (s.screen === 'content notice') L.push(`The world’s mature-content notice is up: “${s.gate.text}” [${s.gate.ref}] goes on to the world (voyage_start presses it).`);
    else if (s.screen === 'sign in') L.push('Voyage wants you signed in. Ask the user to sign in in the browser beside the chat (sign-ins there are kept), then carry on.');
    else if (s.screen === 'loading') L.push(`Loading${s.note ? `: ${s.note}` : ''}`);
    else L.push('This doesn’t look like a Voyage world page or game. Open a world (voyage.io/world/…) or a game.');
    if (s.errors && s.errors.length) L.push(`Errors: ${s.errors.join(' · ')}`);
    return L.join('\n');
  }

  async function run(owner, name, a = {}, depth = 0) {
    if (!NAMES.has(name)) throw fail(`There’s no browser tool called ${name}.`);
    const at = Date.now();
    switch (name) {
      case 'tabs': {
        const mine = await request('list', { owner });
        return result(mine.length ? `This chat’s tabs:\n${mine.map(describe).join('\n')}` : 'This chat has no tabs open. navigate or open_tab opens one.');
      }
      case 'open_tab': {
        const t = await request('create', { owner, size: a.size });
        if (a.url) { const r = await request('navigate', { id: t.id, where: a.url }); return result(`Opened tab ${t.id} at ${clip(r.title, 80)} (${r.url})${r.ok ? '' : `: ${r.error}`}. It’s the current tab.`); }
        return result(`Opened tab ${t.id} (blank). It’s the current tab.`);
      }
      case 'close_tab': { const t = await tabOf(owner, a.tab); await request('close', { id: t.id }); const left = await request('list', { owner }); return result(`Closed ${t.id}.${left.length ? ` Current tab: ${(left.find(x => x.current) || left[0]).id}.` : ' No tabs left.'}`); }
      case 'navigate': {
        const t = await tabOf(owner, a.tab, true);
        const where = String(a.url || '').trim();
        await activity(t, 'navigate', null, null, `Opening ${clip(where, 120)}`);
        const r = await request('navigate', { id: t.id, where });
        const notes = await notesSince(t, at);
        return result(`${r.ok ? `${where === 'back' || where === 'forward' || where === 'reload' ? `Went ${where === 'reload' ? 'and reloaded' : where}` : 'Opened'}: ${clip(r.title || 'Untitled', 100)} (${r.url})` : `Couldn’t open it: ${r.error}`}${r.slow ? ' (it was still loading after 30 s; it may finish by itself)' : ''}.${notes.length ? `\n${notes.join('\n')}` : ''}`);
      }
      case 'screenshot': { const t = await tabOf(owner, a.tab); const p = await picture(t, { scale: a.scale, region: a.region }); return result(p.text, p.image); }
      case 'click': {
        const t = await tabOf(owner, a.tab);
        let x = a.x, y = a.y, label = `${a.x},${a.y}`, warn = '';
        if (a.ref || a.text) {
          const p = await iso(t, S.pointOf, { ref: a.ref, text: a.text });
          ({ x, y } = p); label = `${p.label} [${p.ref}]`;
          if (p.disabled) warn = ' It looks disabled, so the click may have done nothing.';
          if (p.covered) warn += ` Something else is on top of it there (${p.covered}), which got the click instead.`;
        }
        await activity(t, 'click', Math.round(x), Math.round(y), `Click ${label}`);
        await clickAt(t, x, y, { button: a.button || 'left', double: !!a.double, modifiers: modBits(a.modifiers) });
        const after = await aftermath(t, at);
        return result(`Clicked ${label} at ${Math.round(x)},${Math.round(y)}.${warn}${after.length ? `\n${after.join('\n')}` : ''}`);
      }
      case 'type': {
        const t = await tabOf(owner, a.tab);
        let label = 'where the focus is';
        if (a.ref) { const f = await iso(t, S.focusField, { ref: a.ref, clear: !!a.clear }); label = f.label; }
        else if (a.clear) await iso(t, S.selectAllInFocus);
        await activity(t, 'type', null, null, `Typing “${clip(a.text, 80)}”`);
        if (a.clear && !a.text) await press(t, 'Backspace');
        if (a.text) await cdp(t, 'Input.insertText', { text: String(a.text) });
        if (a.submit) await press(t, 'Enter');
        const after = await aftermath(t, at, a.submit ? 500 : 150);
        return result(`Typed ${String(a.text).length} characters into ${label}${a.submit ? ' and pressed Enter' : ''}.${after.length ? `\n${after.join('\n')}` : ''}`);
      }
      case 'key': {
        const t = await tabOf(owner, a.tab);
        const n = Math.min(50, Math.max(1, Number(a.repeat) || 1));
        await activity(t, 'key', null, null, `Pressing ${clip(a.keys, 60)}${n > 1 ? ` ×${n}` : ''}`);
        await press(t, a.keys, n);
        const after = await aftermath(t, at, 250);
        return result(`Pressed ${a.keys}${n > 1 ? ` ${n} times` : ''}.${after.length ? `\n${after.join('\n')}` : ''}`);
      }
      case 'scroll': {
        const t = await tabOf(owner, a.tab);
        if (a.ref) { const w = await iso(t, S.scrollInfo, { ref: a.ref }); return result(`Brought ${a.ref} into view. Scrolled to ${w.sx},${w.sy} of a page ${w.ph} tall.`); }
        const n = Math.min(50, Math.max(1, Number(a.amount) || 5)) * 100, dir = a.direction || 'down';
        const x = Number.isFinite(Number(a.x)) ? Number(a.x) : Math.round(t.size.w / 2), y = Number.isFinite(Number(a.y)) ? Number(a.y) : Math.round(t.size.h / 2);
        await activity(t, 'scroll', x, y, `Scrolling ${dir}`);
        await cdp(t, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dir === 'left' ? -n : dir === 'right' ? n : 0, deltaY: dir === 'up' ? -n : dir === 'down' ? n : 0 });
        await sleep(350);
        const w = await iso(t, S.scrollInfo, {});
        return result(`Scrolled ${dir}. Now at ${w.sx},${w.sy} of a page ${w.ph} tall (the window is ${w.w}×${w.h}).`);
      }
      case 'read_page': { const t = await tabOf(owner, a.tab); return result(await iso(t, S.readPage, { filter: a.filter || 'interactive', ref: a.ref || null, max: Math.min(60000, Number(a.max_chars) || 20000) })); }
      case 'find': { const t = await tabOf(owner, a.tab); return result(await iso(t, S.findEls, { query: a.query })); }
      case 'page_text': { const t = await tabOf(owner, a.tab); return result(`${clip(t.title, 100)} (${t.url})\n\n${await iso(t, S.pageText, { max: Math.min(80000, Number(a.max_chars) || 15000), from: a.from === 'end' ? 'end' : 'start' })}`); }
      case 'form_input': { const t = await tabOf(owner, a.tab); await activity(t, 'type', null, null, `Setting ${a.ref}`); return result(await iso(t, S.setValue, { ref: a.ref, value: a.value })); }
      case 'wait_for': {
        const t = await tabOf(owner, a.tab);
        const secs = Math.min(120, Math.max(0.1, Number(a.seconds) || (a.text || a.gone || a.selector ? 15 : 2)));
        if (!a.text && !a.gone && !a.selector) { await sleep(secs * 1000); return result(`Waited ${secs} s.`); }
        const until = Date.now() + secs * 1000;
        for (;;) {
          if (await iso(t, S.waitCheck, { text: a.text, gone: a.gone, selector: a.selector }).catch(() => false)) return result(`Done after ${((Date.now() - at) / 1000).toFixed(1)} s.`);
          if (Date.now() > until) return result(`Still not there after ${secs} s.`);
          await sleep(300);
        }
      }
      case 'javascript': {
        const t = await tabOf(owner, a.tab);
        await activity(t, 'script', null, null, 'Running a script');
        const r = await cdp(t, 'Runtime.evaluate', { expression: String(a.code || ''), awaitPromise: true, returnByValue: true, replMode: true, userGesture: true, timeout: 30000 }, 35000);
        if (r.exceptionDetails) return result(`It threw: ${clip((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text, 3000)}`);
        const v = r.result || {};
        let out;
        if ('value' in v) { try { out = typeof v.value === 'string' ? v.value : JSON.stringify(v.value, null, 2); } catch { out = String(v.value); } }
        else out = v.description || v.type || 'undefined';
        return result(clip(out === undefined ? 'undefined' : out, 20000));
      }
      case 'console': {
        const t = await tabOf(owner, a.tab);
        let logs = await request('logs', { id: t.id, kind: 'console', clear: !!a.clear });
        if (a.errors_only) logs = logs.filter(l => l.level === 'error');
        if (a.pattern) { const re = pattern(a.pattern); logs = logs.filter(l => re.test(l.text.slice(0, 2000))); }
        logs = logs.slice(-(Math.min(300, Number(a.limit) || 60)));
        return result(logs.length ? logs.map(l => `[${l.level}] ${clip(l.text, 1500)}${l.source ? `  (${clip(l.source, 160)})` : ''}`).join('\n') : 'No console messages (that match).');
      }
      case 'network': {
        const t = await tabOf(owner, a.tab);
        const all = await request('logs', { id: t.id, kind: 'network' });
        const indexed = all.map((e, i) => ({ ...e, i: e.n || i }));
        if (a.body_of !== undefined && a.body_of !== null && a.body_of !== '') {
          const e = typeof a.body_of === 'number' || /^\d+$/.test(String(a.body_of)) ? indexed.find(x => x.i === Number(a.body_of)) : [...indexed].reverse().find(x => x.url.includes(String(a.body_of)));
          if (!e) throw fail('No request like that in the list.');
          const b = await request('body', { id: t.id, rid: e.rid }).catch(err => ({ error: err.message }));
          if (b.error) return result(`#${e.i} ${e.method} ${e.url} → ${e.status || e.failed}\nIts body isn’t available (${b.error}).`);
          const body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
          return result(`#${e.i} ${e.method} ${e.url} → ${e.status || e.failed}\n\n${clip(body, 12000)}`);
        }
        let list = indexed;
        if (a.failed_only) list = list.filter(e => e.failed || (e.status && e.status >= 400));
        if (a.pattern) { const re = pattern(a.pattern); list = list.filter(e => re.test(e.url.slice(0, 2000)) || re.test(e.method)); }
        list = list.slice(-(Math.min(300, Number(a.limit) || 60)));
        return result(list.length ? list.map(e => `#${e.i} ${e.method} ${clip(e.url, 220)} → ${e.failed ? `failed (${e.failed})` : e.status || 'pending'}${e.ms !== null ? ` ${e.ms} ms` : ''} ${e.type ? `(${e.type.toLowerCase()})` : ''}`).join('\n') : 'No requests (that match).');
      }
      case 'viewport': {
        const t = await tabOf(owner, a.tab);
        const r = await request('resize', { id: t.id, preset: a.preset, w: a.width, h: a.height });
        await sleep(500);
        return result(`The page is now ${r.size.w}×${r.size.h} (${r.size.preset}${r.size.mobile ? ', a touch screen' : ''}).`);
      }
      case 'dialogs': { const t = await tabOf(owner, a.tab); await request('dialogs', { id: t.id, mode: a.answer, text: a.prompt_text }); return result(`From now on this tab answers confirm and prompt boxes with ${a.answer === 'accept' ? 'OK' : 'Cancel'}.`); }
      case 'batch': {
        if (depth) throw fail('A batch can’t hold another batch.');
        const acts = Array.isArray(a.actions) ? a.actions.slice(0, 30) : [];
        const lines = [];
        let i = 0;
        for (const act of acts) {
          i++;
          const { tool, ...args } = act || {};
          if (tool === 'batch' || !NAMES.has(tool)) { lines.push(`${i}. ${tool}: there’s no such tool here. Stopped.`); break; }
          try {
            const r = await run(owner, tool, { tab: a.tab, ...args }, depth + 1);
            lines.push(`${i}. ${tool}: ${r.text}`);
          } catch (err) { lines.push(`${i}. ${tool} failed: ${err.message} Stopped.`); break; }
        }
        let image = null;
        if (a.screenshot) { try { const t = await tabOf(owner, a.tab); const p = await picture(t); lines.push(p.text); image = p.image; } catch (err) { lines.push(`(No picture: ${err.message})`); } }
        return result(lines.join('\n'), image);
      }
      // ---------- Voyage ----------
      case 'voyage_status': { const t = await tabOf(owner, a.tab); return result(statusText(await iso(t, S.voyageStatus))); }
      case 'voyage_story': { const t = await tabOf(owner, a.tab); return result(await iso(t, S.voyageStory, { turns: Math.min(10, Math.max(1, Number(a.turns) || 2)), max: Math.min(60000, Number(a.max_chars) || 12000) })); }
      case 'voyage_continue': {
        const t = await tabOf(owner, a.tab);
        const lines = [];
        const w = await voyageWait(t, Math.min(600, Math.max(5, Number(a.timeout) || 120)), lines);
        const said = lines.length ? `Dialogue as it played:\n${lines.join('\n')}\n\n` : '';
        return result(`${said}${w.done ? `Ready for the next action (turn ${w.phase.turn}).` : `Stopped: ${w.why}.`}`);
      }
      case 'voyage_act': {
        const t = await tabOf(owner, a.tab);
        const action = String(a.action || '').slice(0, 840);
        const lines = [], notes = [];
        // Dialogue still playing from before: skip it first.
        let ph = await iso(t, S.voyagePhase);
        if (ph.screen !== 'game') throw fail(`This isn’t a Voyage game (the screen is ${ph.screen}). voyage_status says more; voyage_start starts one.`);
        if (ph.dialogue || !ph.ready) {
          const w = await voyageWait(t, 120, lines);
          if (!w.done) throw fail(`The action box isn’t ready: ${w.why}.`);
          if (lines.length) notes.push(`(Skipped the dialogue that was still playing first.)`);
        }
        const inp = await iso(t, S.voyageInput);
        if (!inp.ready) throw fail(`The action box isn’t ready: ${inp.why}.`);
        const before = inp.turn;
        await iso(t, S.focusField, { ref: inp.ref, clear: true });
        await activity(t, 'type', null, null, action ? `Action: “${clip(action, 100)}”` : 'Continue (no action)');
        await press(t, 'Backspace');
        if (action) await cdp(t, 'Input.insertText', { text: action });
        await sleep(200);
        await press(t, 'Enter');
        await sleep(700);
        if (!await iso(t, S.voyageSent, { action, cards: inp.cards })) {
          // Enter didn't take it (a phone layout, say): the Submit button.
          if (inp.submit) { const p = await iso(t, S.pointOf, { ref: inp.submit }); await clickAt(t, p.x, p.y); await sleep(700); }
          if (!await iso(t, S.voyageSent, { action, cards: inp.cards })) throw fail('The action didn’t go in: the game didn’t take it. voyage_status shows what’s on screen.');
        }
        if (a.wait === false) return result(`Sent${action ? ` “${clip(action, 100)}”` : ' Continue'}. It’s playing now; voyage_continue waits for it.`);
        lines.length = 0;
        const w = await voyageWait(t, Math.min(600, Math.max(10, Number(a.timeout) || 240)), lines);
        const story = await iso(t, S.voyageStory, { turns: 1, max: 16000 }).catch(() => '');
        const head = w.done ? `Turn ${w.phase.turn || '?'} done${before && w.phase.turn === before ? ' (the turn number didn’t change: check the story)' : ''}. Ready for the next action.` : `Stopped waiting: ${w.why}. voyage_status shows where it is.`;
        const told = story && !/^\(No story/.test(story) ? story : lines.join('\n');
        return result(`${notes.length ? `${notes.join('\n')}\n` : ''}${head}\n\n${told}`);
      }
      case 'voyage_start': {
        const t = await tabOf(owner, a.tab, !!a.url);
        if (a.url) { await activity(t, 'navigate', null, null, `Opening ${clip(a.url, 100)}`); const r = await request('navigate', { id: t.id, where: a.url }); if (!r.ok) throw fail(`Couldn’t open ${a.url}: ${r.error}`); await sleep(1500); }
        const steps = [];
        const until = Date.now() + 300e3;
        let lastWhy = '', same = 0, waited = 0;
        for (;;) {
          if (Date.now() > until) return result(`${steps.join('\n')}\nStopped: setting up took over 5 minutes.\n\n${statusText(await iso(t, S.voyageStatus))}`);
          const st = await iso(t, S.voyageSetupStep, { opening: a.opening || null, character: a.character || null }).catch(err => ({ stuck: err.message }));
          if (st.done) break;
          if (st.stuck) return result(`${steps.length ? `${steps.join('\n')}\n` : ''}Stuck: ${st.stuck}\n\n${statusText(await iso(t, S.voyageStatus))}`);
          if (st.wait) { if (waited++ % 10 === 0) steps.push(`Waiting: ${st.wait}`); await sleep(1500); continue; }
          if (st.why === lastWhy) { if (++same >= 3) return result(`${steps.join('\n')}\nStuck: pressing ${st.why} didn’t move things on.\n\n${statusText(await iso(t, S.voyageStatus))}`); } else { same = 0; lastWhy = st.why; }
          steps.push(`Pressed ${st.why}.`);
          await activity(t, 'click', st.x, st.y, `Pressing ${clip(st.why, 80)}`);
          await clickAt(t, st.x, st.y);
          await sleep(1300);
        }
        steps.push('The game is open.');
        const lines = [];
        const w = await voyageWait(t, 240, lines);
        const story = await iso(t, S.voyageStory, { turns: 1, max: 16000 }).catch(() => '');
        return result(`${steps.join('\n')}\n${w.done ? 'The opening has played; ready for the first action.' : `Still going: ${w.why}.`}\n\n${story && !/^\(No story/.test(story) ? story : lines.join('\n')}`);
      }
      default: throw fail(`There’s no browser tool called ${name}.`);
    }
  }

  // Plan mode (Claude) and read-only (Codex): only what reads (a page opened to read, a look, the story) goes ahead.
  const READS = new Set(['tabs', 'open_tab', 'close_tab', 'navigate', 'screenshot', 'scroll', 'read_page', 'find', 'page_text', 'wait_for', 'console', 'network', 'viewport', 'voyage_status', 'voyage_story']);
  function readOnly(key) {
    const k = keys.get(key), c = k && k.chatKey ? chatByKey(k.chatKey) : null;
    return !!(c && (c.permissionMode === 'plan' || c.permissionMode === 'read-only'));
  }
  const acts = (name, args) => (name === 'batch' ? (Array.isArray(args && args.actions) ? args.actions : []).some(x => !READS.has(x && x.tool)) : !READS.has(name));

  // The MCP server's call (lib/browser-mcp.js → POST /api/browser/tool): MCP's content blocks.
  async function callTool(key, name, args) {
    const owner = ownerOf(key);
    if (acts(String(name || ''), args) && readOnly(key)) return { content: [{ type: 'text', text: 'This chat is in Plan mode (or read-only), so the browser only reads now: open pages, look, read and scroll, but no clicking, typing, scripts or turns. Leave Plan mode to act.' }], isError: true };
    try {
      const r = await run(owner, String(name || ''), args && typeof args === 'object' ? args : {});
      const content = [{ type: 'text', text: r.text || 'Done.' }];
      if (r.image) content.push({ type: 'image', data: r.image, mimeType: 'image/jpeg' });
      return { content };
    } catch (err) {
      if (err.status === 503 || err.status === 504) log(`Browser tool ${name}: ${err.message}`);
      return { content: [{ type: 'text', text: err.message || String(err) }], isError: true };
    }
  }

  return { prepare, onMessage, callTool, request, isOurs, isOurServer, available: here, wanted, pref, run, ownerOf, TOOLS };
}

module.exports = { createBrowser, browserPref, TOOLS, SERVER };
