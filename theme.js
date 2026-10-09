'use strict';
/* Session Switcher appearance: themes (light and dark), text size, interface size, reading font,
   bold text and contrast. Loaded in <head> so the saved look applies before the page draws.

   styles.css names every color it uses as a variable (--c-<original hex>: "r g b"). A theme is a
   handful of seeds; each color is re-derived from its role (surface, text, accent, gold, Codex…),
   keeping its original lightness steps, so every theme has the same depth as the default one.
   Choices are kept on this device (localStorage), so a phone and a PC can each have their own. */
(function () {
  const COLORS = ['3d1a18', "000000", "050406", "0a090c", "0b090d", "0b0a0d", "0c0a0e", "0d0b0f", "0e0c10", "0f0d11", "100e12", "110e12", "110f13", "120f14", "121014", "121015", "141117", "151116", "17131a", "18141b", "19151c", "1a1405", "1a161d", "1b1519", "1b171e", "1c181f", "1d1920", "221d26", "241e29", "241f28", "2a242e", "2b1615", "2c2632", "3c5a96", "3d3443", "4664a0", "46679f", "5072ab", "5e2622", "5f2a26", "5f86c6", "6a91d2", "6c2e29", "6d302b", "6e2a25", "6f97d8", "716a63", "781412", "78342e", "7a332d", "7a3530", "7d1513", "7fa3dc", "7fb79a", "8c3a34", "8d3e37", "94423b", "9a4038", "9a463e", "9a928a", "a5463f", "a5564d", "a58be8", "a8544b", "a98f45", "a9c3ef", "b0544b", "b8655b", "c9aa4c", "c9daf6", "c9e8d6", "cf8274", "cfc6b6", "d08072", "d4b557", "d68a7c", "d68c7d", "d8b7aa", "d8e4f8", "d9bf74", "dcc790", "e2a596", "e6d3a0", "e6dccb", "e7b2a8", "e9d283", "e9e1d4", "eadfce", "ede6d9", "efdcd3", "f0dc95", "f1dc92", "f1dfd6", "f3e2d8", "f6ece2", "f6efe3", "ffffff"];
  const ON_ACCENT = new Set(['f6ece2', 'f6efe3', 'ffffff', 'f1dfd6', 'f3e2d8', 'efdcd3']);

  /* ---------- the space saga themes ----------
     Imperial (a capital ship's bridge: clean, exact, black and white with red signals) and Rebel (a
     worn hangar: warm metal, flight-suit orange, yellow deck lines). Built to work in all day: real
     type for reading, a label face for small caps, nothing that moves unless it means something.
     Besides colors, a saga theme brings its own fonts, a hero display that reads the hub's live
     counts, a still background in place of the petals, an emblem for the seal, sound cues (sounds/,
     Kenney CC0) and its own words. Its `copy` map is keyed by the app's own English text; anything it
     leaves out reads as usual. {n} is a number in words. */
  const INTER = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  const BARLOW = '"Barlow", system-ui, -apple-system, sans-serif';
  const SAGA = [
    {
      id: 'imperial', name: 'Imperial', note: 'A capital ship’s bridge: black glass, white light panels and red signal lamps. Clean and exact.', family: 'saga', sky: 'stars', art: 'console',
      accent: 357, sat: 1.45, gold: 210, goldSat: 0.1, surface: 225, surfSat: 0.12, ink: 220, inkSat: 0.12, codex: 192,
      fonts: { display: '"Michroma", ' + INTER, caps: INTER, body: INTER, label: INTER },
      emblem: '<path d="M20 1.6L36 10.8V29.2L20 38.4L4 29.2V10.8Z" style="fill:rgb(var(--c-0a090c));stroke:rgb(var(--c-ede6d9))" stroke-width="1.4"/><path d="M20 6.2L32 13.1V26.9L20 33.8L8 26.9V13.1Z" fill="none" style="stroke:rgb(var(--c-ede6d9))" stroke-opacity=".35" stroke-width=".8"/><path d="M20 31L31 12.5L20 16.4L9 12.5Z" style="fill:rgb(var(--c-ede6d9))"/><path d="M20 16.4V31" style="stroke:rgb(var(--c-a5463f))" stroke-width="1.6"/>',
      copy: {
        'Your move': 'Requires your command', 'Awaiting you': 'Awaiting orders', 'Right now': 'Deployed', 'At work': 'Units engaged',
        'By folder': 'Sectors', 'Your projects': 'Systems under command', 'Pick up where you left off': 'Fleet log', 'Recent chats': 'Recent operations',
        'Your plans': 'Capacity', 'Accounts and usage': 'Fleet reserves', 'Begin': 'Command', 'The hub': 'Bridge', 'Search every chat': 'Search fleet records',
        'All quiet.': 'All systems nominal.', 'Pick up any chat below.': 'The fleet awaits your command.', 'Nothing needs you yet.': 'No unit requires you.',
        '{n} chat awaits you.': '{n} unit awaits your orders.', '{n} chats await you.': '{n} units await your orders.',
        '{n} chat at work.': '{n} unit engaged.', '{n} chats at work.': '{n} units engaged.', 'Working as': 'Commanding as',
        'Claude & Codex, every chat and account in one place': 'Fleet command · every unit, every reserve', 'Search every chat…': 'Search fleet records…',
        'Drifting petals': 'Viewport stars', 'A few slow petals behind the hub.': 'A few still stars behind the hub, as through the bridge viewport.', 'Show the drifting petals': 'Show the viewport stars', 'Hide the drifting petals': 'Hide the viewport stars', 'Live': 'Uplink',
      },
    },
    {
      id: 'rebel', name: 'Rebel', note: 'A hard-worn hangar: scuffed metal, flight-suit orange, yellow deck lines and a targeting computer.', family: 'saga', sky: 'stars', art: 'trench',
      accent: 21, sat: 1.45, gold: 47, goldSat: 0.95, surface: 32, surfSat: 0.42, ink: 38, inkSat: 0.5, codex: 210,
      fonts: { display: '"Barlow Condensed", ' + BARLOW, caps: '"Barlow Condensed", ' + BARLOW, body: BARLOW, label: '"Barlow Semi Condensed", ' + BARLOW },
      emblem: '<circle cx="20" cy="20" r="18.6" style="fill:rgb(var(--c-a5463f))"/><circle cx="20" cy="20" r="15.4" fill="none" style="stroke:rgb(var(--c-f6efe3))" stroke-width="1.2"/><path d="M8.5 8.5L16.6 16.6M31.5 8.5L23.4 16.6M8.5 31.5L16.6 23.4M31.5 31.5L23.4 23.4" style="stroke:rgb(var(--c-f6efe3))" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="20" r="4.6" style="fill:rgb(var(--c-f6efe3))"/><circle cx="20" cy="20" r="1.8" style="fill:rgb(var(--c-a5463f))"/>',
      copy: {
        'Your move': 'Incoming', 'Awaiting you': 'Waiting on you', 'Right now': 'In flight', 'At work': 'Squadrons engaged',
        'By folder': 'Hangar bays', 'Your projects': 'The hangar', 'Pick up where you left off': 'Flight log', 'Recent chats': 'Recent sorties',
        'Your plans': 'Fuel and munitions', 'Accounts and usage': 'Fleet reserves', 'Begin': 'Base', 'The hub': 'Briefing room', 'Search every chat': 'Search comms',
        'All quiet.': 'All wings report in.', 'Pick up any chat below.': 'Pick a heading below, leader.', 'Nothing needs you yet.': 'Nobody’s calling for you yet.',
        '{n} chat awaits you.': '{n} squadron is waiting on you.', '{n} chats await you.': '{n} squadrons are waiting on you.',
        '{n} chat at work.': '{n} squadron in flight.', '{n} chats at work.': '{n} squadrons in flight.', 'Working as': 'Flying as',
        'Claude & Codex, every chat and account in one place': 'Squadron command · every wing, every reserve', 'Search every chat…': 'Search comms…',
        'Drifting petals': 'Starfield', 'A few slow petals behind the hub.': 'A few still stars behind the hub.', 'Show the drifting petals': 'Show the starfield', 'Hide the drifting petals': 'Hide the starfield', 'Live': 'Comms',
      },
    },
  ];
  for (const t of SAGA) {
    t.sfx = { needs: `/sounds/${t.id}-needs.mp3`, reply: `/sounds/${t.id}-reply.mp3`, engage: `/sounds/${t.id}-engage.mp3` };
    Object.assign(t.copy, { '✦': '', 'Turned off automatically if Windows is set to reduce motion.': 'It never moves, so it stays on when your device is set to reduce motion.' });
  }

  // accent: hue for the main color · sat: its strength · gold: hue for highlights · surface: hue
  // and strength of backgrounds · ink: hue of text · codex: hue that marks Codex.
  const THEMES = [
    { id: 'crimson', name: 'Crimson', note: 'The original: wine red and gold on ink.', accent: 4, sat: 1, gold: 45, surface: 270, surfSat: 1, ink: 38, codex: 217 },
    { id: 'sapphire', name: 'Sapphire', note: 'Deep blue with a warm gold.', accent: 218, sat: 1.15, gold: 42, surface: 226, surfSat: 1.3, ink: 215, codex: 172 },
    { id: 'emerald', name: 'Emerald', note: 'Forest green and brass.', accent: 152, sat: 0.95, gold: 48, surface: 165, surfSat: 1, ink: 90, codex: 217 },
    { id: 'amethyst', name: 'Amethyst', note: 'Violet dusk.', accent: 272, sat: 1.05, gold: 40, surface: 268, surfSat: 1.5, ink: 280, codex: 205 },
    { id: 'amber', name: 'Amber', note: 'Candlelight orange.', accent: 26, sat: 1.35, gold: 50, surface: 28, surfSat: 0.9, ink: 35, codex: 210 },
    { id: 'ocean', name: 'Ocean', note: 'Teal and sea glass.', accent: 186, sat: 1.05, gold: 44, surface: 200, surfSat: 1.3, ink: 190, codex: 230 },
    { id: 'rose', name: 'Rose', note: 'Soft pink and blush.', accent: 336, sat: 1.1, gold: 38, surface: 320, surfSat: 1.1, ink: 20, codex: 212 },
    { id: 'graphite', name: 'Graphite', note: 'Quiet greys, no color cast.', accent: 212, sat: 0.32, gold: 45, surface: 220, surfSat: 0.35, ink: 220, codex: 212 },
    ...SAGA,
  ];
  const DEFAULTS = { theme: 'crimson', mode: 'dark', text: 100, ui: 100, font: 'classic', bold: false, contrast: false };
  const FONTS = {
    classic: null,
    modern: { body: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
    clean: { body: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', display: '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', caps: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
  };

  /* ---------- color math ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  function toHsl(hex) {
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function toRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l);
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map(x => Math.round(x * 255));
  }
  // Which part of the design a color belongs to.
  function role(hex) {
    if (hex === '000000') return 'shadow';
    if (ON_ACCENT.has(hex)) return 'onAccent';
    if (hex === '3d1a18') return 'accent'; // the logo's disc keeps the accent's depth in light themes
    const [h, s, l] = toHsl(hex);
    if (l < 0.2 || (l < 0.3 && s < 0.2)) return 'surface';
    if (s < 0.45 && h >= 25 && h <= 60) return 'ink';
    if (h <= 25 || h >= 340) return 'accent';
    if (h <= 65) return 'gold';
    if (h >= 90 && h < 185) return 'green';
    if (h >= 185 && h < 245) return 'codex';
    return 'violet';
  }
  const ROLES = Object.fromEntries(COLORS.map(c => [c, role(c)]));

  // One color under a theme. Dark keeps the original lightness steps; light turns them over.
  function derive(hex, t, light, contrast) {
    const [h, s, l] = toHsl(hex);
    switch (ROLES[hex]) {
      case 'shadow': return light ? [64, 52, 46] : [0, 0, 0];
      case 'onAccent': return toRgb(h, s, l);
      case 'surface': {
        const ss = clamp(s * t.surfSat, 0, 0.45);
        if (!light) return toRgb(t.surface, ss, l);
        // Backgrounds turn to paper; borders and dividers (the lighter dark tones) turn darker.
        const ll = l <= 0.12 ? 0.935 + l * 0.45 : 0.989 - (l - 0.12) * 2.3;
        return toRgb(t.surface, clamp(ss * 1.6, 0, 0.35), ll);
      }
      case 'ink': {
        let ll = light ? 0.97 - l * 0.97 : l;
        // Light themes: the faint greys (dates, hints, labels) stay dark enough to read (~4.5:1).
        if (light && l < 0.65) ll = Math.min(ll, 0.41);
        if (!light && l < 0.5) ll = Math.max(ll, 0.46); // and in dark ones, light enough
        if (contrast) ll = light ? ll * 0.6 : ll + (1 - ll) * 0.4;
        return toRgb(t.ink, s * (t.inkSat ?? (t.id === 'graphite' ? 0.2 : 1)), ll);
      }
      case 'accent': {
        const ll = light ? (l > 0.42 ? 0.42 - (l - 0.42) * 0.4 : l * 0.95) : (contrast && l > 0.5 ? l + 0.06 : l);
        return toRgb(h - 4 + t.accent, s * t.sat, ll);
      }
      case 'gold': return toRgb(h - 45 + t.gold, s * (t.goldSat ?? (t.id === 'graphite' ? 0.7 : 1)), light ? (l > 0.4 ? 0.4 - (l - 0.4) * 0.3 : l) : l);
      case 'codex': return toRgb(h - 217 + t.codex, s, light ? (l > 0.42 ? 0.42 - (l - 0.42) * 0.4 : l) : l);
      default: return toRgb(h, s, light ? (l > 0.42 ? 0.4 - (l - 0.42) * 0.4 : l) : l);
    }
  }

  /* ---------- settings ---------- */
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  // Earlier names of the saga themes, so a saved choice still finds its theme.
  const RENAMED = { vanguard: 'rebel', dominion: 'imperial', mirage: 'rebel' };
  function load() {
    let o; try { o = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('look') || '{}') || {}) }; } catch { o = { ...DEFAULTS }; }
    if (RENAMED[o.theme]) o.theme = RENAMED[o.theme];
    return o;
  }
  let cur = load();
  const isLight = (o = cur) => o.mode === 'light' || (o.mode === 'system' && !!(mq && mq.matches));
  const themeOf = id => THEMES.find(t => t.id === id) || THEMES[0];

  function apply(o = cur) {
    const root = document.documentElement, st = root.style;
    const t = themeOf(o.theme), light = isLight(o);
    const original = t.id === 'crimson' && !light && !o.contrast;
    for (const c of COLORS) {
      if (original) st.removeProperty(`--c-${c}`);
      else st.setProperty(`--c-${c}`, derive(c, t, light, o.contrast).join(' '));
    }
    root.dataset.mode = light ? 'light' : 'dark';
    root.dataset.theme = t.id;
    st.colorScheme = light ? 'light' : 'dark';
    // A theme's own fonts come first; Modern and Clean still swap the reading font (Clean the headings too).
    const f = FONTS[o.font] || null, tf = t.fonts || {};
    for (const [k, v] of [['--f-body', (f && f.body) || tf.body], ['--f-display', (f && f.display) || tf.display], ['--f-caps', (f && f.caps) || tf.caps], ['--f-label', tf.label]]) { if (v) st.setProperty(k, v); else st.removeProperty(k); }
    if (t.family) root.dataset.family = t.family; else delete root.dataset.family;
    if (t.sky) root.dataset.sky = t.sky; else delete root.dataset.sky;
    if (t.art) root.dataset.art = t.art; else delete root.dataset.art;
    emblem(t);
    st.setProperty('--look-text', String(clamp(Number(o.text) || 100, 80, 150) / 100));
    st.setProperty('--look-ui', String(clamp(Number(o.ui) || 100, 75, 140) / 100));
    root.classList.toggle('look-bold', !!o.bold);
    // Breakpoints see the window, not the scaled page, so a larger interface gets a compact top bar.
    root.classList.toggle('look-ui-big', (Number(o.ui) || 100) > 100);
    root.classList.toggle('look-contrast', !!o.contrast);
    root.classList.toggle('look-font-' + (o.font || 'classic'), true);
    for (const k of Object.keys(FONTS)) if (k !== o.font) root.classList.remove(`look-font-${k}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = `rgb(${derive('0a090c', t, light, false).join(',')})`;
    document.dispatchEvent(new CustomEvent('lookchange', { detail: o }));
  }
  // The seal (logo) takes the theme's emblem; the original is kept to put back.
  let sigil0 = null;
  function emblem(t = themeOf(cur.theme)) {
    const sym = document.getElementById('sigil'); if (!sym) return;
    if (sigil0 === null) sigil0 = sym.innerHTML;
    const want = t.emblem || sigil0;
    if (sym.innerHTML !== want) sym.innerHTML = want;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => emblem());
  // The theme's words for a piece of the app's text, or the text itself. {n} and the like fill in from vars.
  function say(text, vars) {
    const c = themeOf(cur.theme).copy, s = (c && c[text]) ?? text;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }
  function set(changes) {
    cur = { ...cur, ...changes };
    try { localStorage.setItem('look', JSON.stringify(cur)); } catch { /* private window */ }
    apply();
  }
  function reset() { cur = { ...DEFAULTS }; try { localStorage.removeItem('look'); } catch { /* fine */ } apply(); }
  // A few colors of a theme, for its swatch in Setup.
  function swatch(id, light) {
    const t = themeOf(id), c = hex => `rgb(${derive(hex, t, light, false).join(',')})`;
    return { bg: c('0a090c'), card: c('1a161d'), line: c('2c2632'), ink: c('ede6d9'), ash: c('9a928a'), accent: c('a5463f'), ember: c('cf8274'), gold: c('d9bf74'), codex: c('6f97d8') };
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (cur.mode === 'system') apply(); });

  window.Look = { THEMES, DEFAULTS, get: () => ({ ...cur }), set, reset, apply, swatch, isLight, say, theme: () => themeOf(cur.theme) };
  apply();
})();
