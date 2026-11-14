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
        'Your plans': 'Capacity', 'Together': 'Fleet', 'Your groups': 'Battle groups', 'Accounts and usage': 'Fleet reserves', 'Begin': 'Command', 'The hub': 'Bridge', 'Search every chat': 'Search fleet records',
        'All quiet.': 'All systems nominal.', 'Pick up any chat below.': 'The fleet awaits your command.', 'Nothing needs you yet.': 'No unit requires you.',
        '{n} chat awaits you.': '{n} unit awaits your orders.', '{n} chats await you.': '{n} units await your orders.',
        '{n} chat at work.': '{n} unit engaged.', '{n} chats at work.': '{n} units engaged.', 'Working as': 'Commanding as', 'Welcome back': 'Welcome back, commander',
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
        'Your plans': 'Fuel and munitions', 'Together': 'Formations', 'Your groups': 'Flight groups', 'Accounts and usage': 'Fleet reserves', 'Begin': 'Base', 'The hub': 'Briefing room', 'Search every chat': 'Search comms',
        'All quiet.': 'All wings report in.', 'Pick up any chat below.': 'Pick a heading below, leader.', 'Nothing needs you yet.': 'Nobody’s calling for you yet.',
        '{n} chat awaits you.': '{n} squadron is waiting on you.', '{n} chats await you.': '{n} squadrons are waiting on you.',
        '{n} chat at work.': '{n} squadron in flight.', '{n} chats at work.': '{n} squadrons in flight.', 'Working as': 'Flying as', 'Welcome back': 'Welcome back, leader',
        'Claude & Codex, every chat and account in one place': 'Squadron command · every wing, every reserve', 'Search every chat…': 'Search comms…',
        'Drifting petals': 'Starfield', 'A few slow petals behind the hub.': 'A few still stars behind the hub.', 'Show the drifting petals': 'Show the starfield', 'Hide the drifting petals': 'Hide the starfield', 'Live': 'Comms',
      },
    },
  ];
  for (const t of SAGA) {
    t.sfx = { needs: `/sounds/${t.id}-needs.mp3`, reply: `/sounds/${t.id}-reply.mp3`, engage: `/sounds/${t.id}-engage.mp3` };
    Object.assign(t.copy, { '✦': '', 'Turned off automatically if Windows is set to reduce motion.': 'It never moves, so it stays on when your device is set to reduce motion.' });
  }

  /* ---------- the glam themes ----------
     Malibu: hot pink and pool blue at a beach house in the sun. A bubbly script for the big words, a
     soft rounded face for reading, sparkles behind the hub, a sunset in the hero (hearts in the sky
     for chats waiting on you, twinkles for ones at work, pool floats for ones lounging), little
     hearts for status dots (a working chat's heart beats) and sweet chimes made on the spot (tones:
     [frequency, start, volume] per note). Made for light mode; in dark mode it's neon on plum. */
  const PACIFICO = '"Pacifico", "Brush Script MT", cursive';
  const NUNITO = '"Nunito", system-ui, -apple-system, "Segoe UI", sans-serif';
  const GLAM = [
    {
      id: 'malibu', name: 'Malibu', note: 'Hot pink and pool blue at a beach house in the sun: a sunset, sparkles and little hearts. Made for light mode.', family: 'glam', sky: 'sparkles', art: 'sunset',
      accent: 330, sat: 1.7, gold: 44, goldSat: 1.1, surface: 333, surfSat: 1.6, ink: 330, inkSat: 0.75, codex: 186,
      fonts: { display: PACIFICO, caps: NUNITO, body: NUNITO, label: NUNITO },
      emblem: '<circle cx="20" cy="20" r="18.6" style="fill:rgb(var(--mb-hot))"/><circle cx="20" cy="20" r="15.8" fill="none" style="stroke:rgb(var(--c-ffffff))" stroke-opacity=".55" stroke-width="1" stroke-dasharray="1.6 2.2"/><path d="M20 29.6C13.2 25.1 10.2 21.4 10.2 17.6c0-3 2.3-5.3 5.1-5.3 2 0 3.7 1.1 4.7 2.8 1-1.7 2.7-2.8 4.7-2.8 2.8 0 5.1 2.3 5.1 5.3 0 3.8-3 7.5-9.8 12z" style="fill:rgb(var(--c-ffffff))"/><path d="M14.4 16.4c.3-1.4 1.4-2.3 2.8-2.4" fill="none" style="stroke:rgb(var(--mb-hot))" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/><path d="M30.2 6.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" style="fill:rgb(var(--mb-sun))"/>',
      tones: {
        needs: [[1318.5, 0, 0.032], [1661.2, 0.07, 0.03], [1975.5, 0.14, 0.028], [2637, 0.21, 0.024]],
        reply: [[1174.7, 0, 0.03], [1568, 0.1, 0.028], [2093, 0.2, 0.02]],
      },
      copy: {
        'Crew plan': 'The game plan', 'Your move': 'Your turn to shine', 'Awaiting you': 'Ready for you', 'Right now': 'Busy, busy', 'At work': 'Making it happen',
        'Head to head': 'Who wore it better', 'Races': 'Showdowns', 'Coming up': 'On the calendar', 'Queued': 'Up next',
        'By folder': 'Room by room', 'Your projects': 'The beach house', 'Pick up where you left off': 'Catch up', 'Recent chats': 'Fresh gossip',
        'Your plans': 'Closet space', 'Accounts and usage': 'Your looks', 'Begin': 'Hello, gorgeous', 'The hub': 'Home', 'Search every chat': 'Find anything',
        'All quiet.': 'All caught up, gorgeous.', 'Pick up any chat below.': 'Pick a chat below and make it fabulous.', 'Nothing needs you yet.': 'Nothing needs you yet. Smoothie break?',
        '{n} chat awaits you.': '{n} chat is ready for you, darling.', '{n} chats await you.': '{n} chats are ready for you, darling.',
        '{n} chat at work.': '{n} chat is on it.', '{n} chats at work.': '{n} chats are on it.', 'Working as': 'Today’s look', '@where': 'Malibu', 'Welcome back': 'Welcome back, gorgeous',
        'Claude & Codex, every chat and account in one place': 'Claude & Codex, all dolled up', 'Search every chat…': 'Find anything…',
        'Drifting petals': 'Sparkles', 'A few slow petals behind the hub.': 'A sprinkle of sparkles behind the hub.', 'Show the drifting petals': 'Show the sparkles', 'Hide the drifting petals': 'Hide the sparkles',
        '✦': '♥', 'Turned off automatically if Windows is set to reduce motion.': 'They hold still when your device is set to reduce motion.',
      },
    },
  ];

  /* ---------- the anime themes ----------
     Made for dark mode (each has a light one too), drawn like an anime's world: glowing magic, gradient
     skies, rim light and drifting particles. Each brings its own lettering, a living background, a scene
     in the hub that reads your chats, its own shape for status dots, chimes and words:
       Isekai        another world: twilight, two moons, floating islands, and a status window where
                     your plan is your HP (the 5-hour window) and MP (the week)
       High Fantasy  emerald and gold: a citadel under a great moon lights a window for each chat at
                     work and a beacon for each one waiting on you; a dragon crosses the moon
       Dungeon       torchlit stone: a torch for each chat at work, eyes in the dark for each one
                     waiting on you, embers rising */
  const TEKTUR = '"Tektur", "Segoe UI", system-ui, sans-serif';
  const ROUNDED = '"M PLUS Rounded 1c", "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif';
  const RITE = { '✦': '', 'Turned off automatically if Windows is set to reduce motion.': 'They hold still when your device is set to reduce motion.' };
  const ANIME = [
    {
      id: 'isekai', name: 'Isekai', note: 'Summoned to another world: twilight, two moons, floating islands, and a status window where your plan is your HP and MP.', family: 'anime', sky: 'motes', art: 'status', paint: { dark: 'isekai-dark', light: 'isekai-light' },
      accent: 196, sat: 1.5, gold: 46, goldSat: 1.1, surface: 238, surfSat: 1.9, ink: 222, inkSat: 0.35, codex: 278,
      fonts: { display: TEKTUR, caps: ROUNDED, body: ROUNDED, label: ROUNDED },
      emblem: '<circle cx="20" cy="20" r="18.6" style="fill:rgb(var(--c-0a090c))"/><circle cx="20" cy="20" r="17" fill="none" style="stroke:rgb(var(--an-glow))" stroke-width="1.4"/><circle cx="20" cy="20" r="13.6" fill="none" style="stroke:rgb(var(--an-glow))" stroke-opacity=".55" stroke-width=".8" stroke-dasharray="1.2 2"/><path d="M20 7.5L30.8 26.2H9.2Z" fill="none" style="stroke:rgb(var(--an-glow))" stroke-width="1.2"/><path d="M20 32.5L9.2 13.8H30.8Z" fill="none" style="stroke:rgb(var(--an-glow))" stroke-width="1.2"/><circle cx="20" cy="20" r="3" style="fill:rgb(var(--an-gold))"/>',
      tones: { needs: [[1046.5, 0, 0.03], [1318.5, 0.06, 0.03], [1568, 0.12, 0.03], [2093, 0.18, 0.026]], reply: [[1568, 0, 0.028], [2093, 0.09, 0.022]], engage: [[523.3, 0, 0.026], [784, 0.06, 0.026], [1046.5, 0.12, 0.026], [1568, 0.18, 0.024], [2093, 0.24, 0.02]] },
      copy: { ...RITE, '✦': '◆',
        'Crew plan': 'Quest board', 'Your move': 'System notice', 'Awaiting you': 'Awaiting your command', 'Right now': 'Active skills', 'At work': 'Casting',
        'Head to head': 'Duel', 'Races': 'Duels', 'Coming up': 'Scheduled', 'Queued': 'Quest board',
        'By folder': 'Known worlds', 'Your projects': 'Worlds', 'Pick up where you left off': 'Save points', 'Recent chats': 'Adventure log',
        'Your plans': 'Stamina and mana', 'Accounts and usage': 'Party status', 'Begin': 'Menu', 'The hub': 'Guild hall', 'Search every chat': 'Appraise everything',
        'All quiet.': '[System] No new notifications.', 'Pick up any chat below.': 'Choose your next quest below.', 'Nothing needs you yet.': 'No decision is needed from you yet.',
        '{n} chat awaits you.': '[System] {n} chat awaits your command.', '{n} chats await you.': '[System] {n} chats await your command.',
        '{n} chat at work.': '[System] {n} skill is casting.', '{n} chats at work.': '[System] {n} skills are casting.', 'Working as': 'Adventurer', '@where': 'Another world', 'Welcome back': '[System] Welcome back, adventurer',
        'Claude & Codex, every chat and account in one place': 'Claude & Codex · your party in another world', 'Search every chat…': 'Appraise everything…',
        'Drifting petals': 'Mana motes', 'A few slow petals behind the hub.': 'Motes of mana drifting up behind the hub.', 'Show the drifting petals': 'Show the mana motes', 'Hide the drifting petals': 'Hide the mana motes',
      },
    },
    {
      id: 'highfantasy', name: 'High Fantasy', note: 'Emerald and gold under a great moon: a citadel lights a window for each chat at work and a beacon for each one that needs you.', family: 'anime', sky: 'fireflies', art: 'citadel', paint: { dark: 'highfantasy-dark', light: 'highfantasy-light' },
      accent: 150, sat: 1.15, gold: 44, goldSat: 1.25, surface: 165, surfSat: 1.3, ink: 45, inkSat: 0.55, codex: 214,
      fonts: { display: '"Cinzel Decorative", "Cinzel", Georgia, serif', caps: '"EB Garamond", "Iowan Old Style", Georgia, serif', body: '"EB Garamond", "Iowan Old Style", Georgia, serif', label: '"Cinzel", Georgia, serif' },
      emblem: '<circle cx="20" cy="20" r="18.6" style="fill:rgb(var(--an-deep))"/><circle cx="20" cy="20" r="16.6" fill="none" style="stroke:rgb(var(--an-gold))" stroke-width="1"/><circle cx="20" cy="20" r="14.2" fill="none" style="stroke:rgb(var(--an-gold))" stroke-opacity=".4" stroke-width=".6"/><path d="M20.0 5.5L21.2 17.1L25.8 14.2L22.9 18.8L34.5 20.0L22.9 21.2L25.8 25.8L21.2 22.9L20.0 34.5L18.8 22.9L14.2 25.8L17.1 21.2L5.5 20.0L17.1 18.8L14.2 14.2L18.8 17.1Z" style="fill:rgb(var(--an-gold))"/><circle cx="20" cy="20" r="1.8" style="fill:rgb(var(--an-deep))"/>',
      tones: { needs: [[880, 0, 0.03], [1046.5, 0.12, 0.028], [1318.5, 0.24, 0.026], [1760, 0.36, 0.022]], reply: [[1318.5, 0, 0.026], [1760, 0.14, 0.02]], engage: [[440, 0, 0.03], [523.3, 0.08, 0.028], [659.3, 0.16, 0.027], [880, 0.24, 0.025], [1046.5, 0.32, 0.023], [1318.5, 0.4, 0.02]] },
      copy: { ...RITE, '✦': '✧',
        'Crew plan': 'The chronicle', 'Your move': 'Your counsel is sought', 'Awaiting you': 'At your word', 'Right now': 'Afield', 'At work': 'Quests underway',
        'Head to head': 'Trial by combat', 'Races': 'Trials', 'Coming up': 'Foretold', 'Queued': 'Awaiting the dawn',
        'By folder': 'The realms', 'Your projects': 'Your realms', 'Pick up where you left off': 'Continue the tale', 'Recent chats': 'Chronicles',
        'Your plans': 'The treasury', 'Accounts and usage': 'Your heralds', 'Begin': 'The citadel', 'The hub': 'The great hall', 'Search every chat': 'Search the archives',
        'All quiet.': 'Peace in the realm.', 'Pick up any chat below.': 'Choose a chronicle to continue.', 'Nothing needs you yet.': 'None yet seek your counsel.',
        '{n} chat awaits you.': '{n} herald awaits your word.', '{n} chats await you.': '{n} heralds await your word.',
        '{n} chat at work.': '{n} quest is underway.', '{n} chats at work.': '{n} quests are underway.', 'Working as': 'Sworn to', '@where': 'The high realm', 'Welcome back': 'Welcome back to the realm',
        'Claude & Codex, every chat and account in one place': 'Claude & Codex · scribes of the realm', 'Search every chat…': 'Search the archives…',
        'Drifting petals': 'Fireflies', 'A few slow petals behind the hub.': 'Fireflies drifting in the dark behind the hub.', 'Show the drifting petals': 'Show the fireflies', 'Hide the drifting petals': 'Hide the fireflies',
      },
    },
    {
      id: 'dungeon', name: 'Dungeon', note: 'Torchlit stone, deep below: a torch for each chat at work, eyes in the dark for each one waiting on you, embers rising.', family: 'anime', sky: 'embers', art: 'delve', paint: { dark: 'dungeon-dark' },
      accent: 22, sat: 1.45, gold: 38, goldSat: 1.15, surface: 28, surfSat: 0.55, ink: 36, inkSat: 0.45, codex: 196,
      fonts: { display: '"Pirata One", "Alegreya SC", Georgia, serif', caps: '"Alegreya", Georgia, serif', body: '"Alegreya", Georgia, serif', label: '"Alegreya SC", Georgia, serif' },
      emblem: '<circle cx="20" cy="20" r="18.6" style="fill:rgb(var(--an-iron))"/><circle cx="20" cy="20" r="15.6" fill="none" style="stroke:rgb(var(--an-rust))" stroke-width="1.6"/><circle cx="20" cy="6.6" r="1.3" style="fill:rgb(var(--an-rust))"/><circle cx="33.4" cy="20" r="1.3" style="fill:rgb(var(--an-rust))"/><circle cx="20" cy="33.4" r="1.3" style="fill:rgb(var(--an-rust))"/><circle cx="6.6" cy="20" r="1.3" style="fill:rgb(var(--an-rust))"/><circle cx="20" cy="17.2" r="4.4" style="fill:rgb(var(--c-050406));stroke:rgb(var(--an-ember))" stroke-width=".9"/><path d="M17.4 19.6h5.2l1.8 9.2h-8.8z" style="fill:rgb(var(--c-050406));stroke:rgb(var(--an-ember))" stroke-width=".9" stroke-linejoin="round"/><circle cx="20" cy="17.2" r="3.6" style="fill:rgb(var(--c-050406))"/>',
      tones: { needs: [[392, 0, 0.05], [523.3, 0.22, 0.045]], reply: [[659.3, 0, 0.035]], engage: [[196, 0, 0.06], [293.7, 0.32, 0.045]] },
      copy: { ...RITE, '✦': '◈',
        'Crew plan': 'The map', 'Your move': 'Something stirs', 'Awaiting you': 'Answer the dark', 'Right now': 'Deeper down', 'At work': 'Delving',
        'Head to head': 'Rival parties', 'Races': 'Rivals', 'Coming up': 'Next descent', 'Queued': 'Waiting at the gate',
        'By folder': 'Every dungeon', 'Your projects': 'Dungeons', 'Pick up where you left off': 'Back into the dark', 'Recent chats': 'Delves',
        'Your plans': 'Torches and rations', 'Accounts and usage': 'Provisions', 'Begin': 'The keep', 'The hub': 'Camp', 'Search every chat': 'Search the depths',
        'All quiet.': 'The halls are silent.', 'Pick up any chat below.': 'Pick a delve below and go deeper.', 'Nothing needs you yet.': 'Nothing has found you yet.',
        '{n} chat awaits you.': '{n} chat awaits you in the dark.', '{n} chats await you.': '{n} chats await you in the dark.',
        '{n} chat at work.': '{n} torch burns below.', '{n} chats at work.': '{n} torches burn below.', 'Working as': 'Delving as', '@where': 'Floor B3', 'Welcome back': 'Back from the surface',
        'Claude & Codex, every chat and account in one place': 'Claude & Codex · a party of two, deep below', 'Search every chat…': 'Search the depths…',
        'Drifting petals': 'Embers', 'A few slow petals behind the hub.': 'Embers rising slowly behind the hub.', 'Show the drifting petals': 'Show the embers', 'Hide the drifting petals': 'Hide the embers',
      },
    },
  ];

  /* ---------- the main themes ----------
     Light, Dark, Paper, Midnight and Sage, plus three signature darks (Gold, Garnet, Crema): each is a palette, not a set of hues. Their backgrounds and text are
     exactly these values (pal.surf / pal.ink, keyed by the original colors they stand in for); the rest is derived
     from seeds as for the other themes, with Claude's clay in place of the original crimson (accent), Codex as
     graphite (codexSat), done as olive (green) and the theme's own accent (violet) for focus and work in progress.
     Model colors (Claude clay, Codex graphite, Gemini blue) and status colors (needs-you gold, done olive, error
     crimson) keep the same meaning in all five. Each is light or dark by nature; "auto" (the default) follows the
     device with one light and one dark pick (lightTheme / darkTheme). The values come from the research on
     community-favourite palettes (Flexoki for Paper), checked for contrast in tests/palettes.test.js. */
  const PALETTE = [
    { id: 'studio-light', name: 'Light', note: 'Off-white and warm greys, ink buttons. The everyday light mode.', main: true, light: true,
      accent: 15, sat: 1.25, gold: 45, goldSat: 1.05, surface: 60, surfSat: 0.2, ink: 60, codex: 220, codexSat: 0.08, green: 78, greenSat: 0.75, violet: 325,
      pal: { surf: { '050406': 'e4e3df', '0a090c': 'f5f5f3', '0d0b0f': 'eeeeeb', '141117': 'ffffff', '1a161d': 'ffffff', '221d26': 'f2f2f0', '2c2632': 'e5e4e0', '3d3443': 'd2d1cc' },
        ink: { '716a63': '6a6964', '9a928a': '4f4e48', 'cfc6b6': '36352f', 'ede6d9': '1c1c1a' },
        vars: { focus: '#9D3A73', working: '#9D3A73', workingSoft: 'rgb(157 58 115 / .12)', claude: '#B9562F', claudeInk: '#A84C27', claudeSoft: '#F7E6DE', codex: '#55555C', codexInk: '#3A3A40', codexSoft: '#ECECEE', gemini: '#1A73E8', geminiInk: '#1660C9', geminiSoft: '#E3EDFD', error: '#B0174E', errorInk: '#A0144A', errorSoft: '#FBE3EA' } } },
    { id: 'studio-dark', name: 'Dark', note: 'Cool graphite, never pure black, off-white text. The everyday dark mode.', main: true, light: false,
      accent: 15, sat: 1.3, gold: 45, goldSat: 1.05, surface: 225, surfSat: 0.25, ink: 220, codex: 220, codexSat: 0.08, green: 78, greenSat: 0.75, violet: 328,
      pal: { surf: { '050406': '08090b', '0a090c': '0e0f12', '0d0b0f': '121418', '141117': '181a1f', '1a161d': '1f2228', '221d26': '272a31', '2c2632': '272a30', '3d3443': '353941' },
        ink: { '716a63': '868c95', '9a928a': 'a9aeb6', 'cfc6b6': 'c8ccd2', 'ede6d9': 'e6e8eb' },
        vars: { focus: '#D774A8', working: '#D774A8', workingSoft: 'rgb(215 116 168 / .15)', claude: '#E2896A', claudeInk: '#E8977A', claudeSoft: 'rgb(226 137 106 / .15)', codex: '#C9CCD2', codexInk: '#D4D6DB', codexSoft: 'rgb(212 214 219 / .11)', gemini: '#7CACF8', geminiInk: '#8FB8F9', geminiSoft: 'rgb(124 172 248 / .15)', error: '#EF5D8B', errorInk: '#F47BA0', errorSoft: 'rgb(239 93 139 / .15)' } } },
    { id: 'paper', name: 'Paper', note: 'Ink on warm paper: soft, bookish and easy for long reading.', main: true, light: true,
      accent: 18, sat: 1.35, gold: 47, goldSat: 1.1, surface: 50, surfSat: 0.6, ink: 40, codex: 40, codexSat: 0.06, green: 72, greenSat: 0.85, violet: 322,
      pal: { surf: { '050406': 'e2e0d5', '0a090c': 'f2f0e5', '0d0b0f': 'eae8dd', '141117': 'fffcf0', '1a161d': 'fffdf5', '221d26': 'efede2', '2c2632': 'dad8ce', '3d3443': 'cecdc3' },
        ink: { '716a63': '66655f', '9a928a': '4a4946', 'cfc6b6': '33322f', 'ede6d9': '1c1b1a' },
        vars: { focus: '#A02F6F', working: '#A02F6F', workingSoft: 'rgb(160 47 111 / .12)', claude: '#BC5215', claudeInk: '#A44812', claudeSoft: '#F6E2D3', codex: '#4F4E4B', codexInk: '#3A3936', codexSoft: '#E6E4D9', gemini: '#205EA6', geminiInk: '#1D5596', geminiSoft: '#E1E9F4', error: '#B0244F', errorInk: '#9C1F47', errorSoft: '#F6DFE3' } } },
    { id: 'midnight', name: 'Midnight', note: 'Deep navy, calm and focused, with an orchid accent.', main: true, light: false,
      accent: 17, sat: 1.3, gold: 46, goldSat: 1.05, surface: 226, surfSat: 0.9, ink: 222, codex: 222, codexSat: 0.12, green: 78, greenSat: 0.75, violet: 322,
      pal: { surf: { '050406': '070b16', '0a090c': '0b1020', '0d0b0f': '0f1527', '141117': '151d31', '1a161d': '1b243b', '221d26': '222c46', '2c2632': '232d45', '3d3443': '2f3b58' },
        ink: { '716a63': '8b95ad', '9a928a': 'aab3c7', 'cfc6b6': 'c9d0de', 'ede6d9': 'e4e8f1' },
        vars: { focus: '#EC9BD0', working: '#EC9BD0', workingSoft: 'rgb(236 155 208 / .15)', claude: '#E8946F', claudeInk: '#EEA383', claudeSoft: 'rgb(232 148 111 / .15)', codex: '#C7CEDB', codexInk: '#D3D9E4', codexSoft: 'rgb(211 217 228 / .11)', gemini: '#8AB4F8', geminiInk: '#9DC0FA', geminiSoft: 'rgb(138 180 248 / .16)', error: '#F0629A', errorInk: '#F57EAC', errorSoft: 'rgb(240 98 154 / .15)' } } },
    { id: 'sage', name: 'Sage', note: 'Muted moss and stone, low glare between light and dark, ivory buttons.', main: true, light: false,
      accent: 19, sat: 1.2, gold: 46, goldSat: 1, surface: 150, surfSat: 0.35, ink: 50, codex: 100, codexSat: 0.05, green: 74, greenSat: 0.8, violet: 318,
      pal: { surf: { '050406': '1c221f', '0a090c': '232a27', '0d0b0f': '262e2b', '141117': '2d3532', '1a161d': '343d39', '221d26': '3b4541', '2c2632': '3d4843', '3d3443': '4b5751' },
        ink: { '716a63': 'a4aca4', '9a928a': 'b7bcb0', 'cfc6b6': 'cfcdc0', 'ede6d9': 'e3dfd1' },
        vars: { focus: '#E0A0CC', working: '#E0A0CC', workingSoft: 'rgb(224 160 204 / .15)', claude: '#E59C74', claudeInk: '#EBAA86', claudeSoft: 'rgb(229 156 116 / .16)', codex: '#D6D8D2', codexInk: '#E0E2DC', codexSoft: 'rgb(224 226 220 / .11)', gemini: '#93B8F2', geminiInk: '#A5C4F5', geminiSoft: 'rgb(147 184 242 / .16)', error: '#F0729E', errorInk: '#F590B5', errorSoft: 'rgb(240 114 158 / .16)' } } },
    /* Signature darks: three more dark themes with a character of their own. Gold and Garnet split their gold in
       two: a pale champagne frame (focus, working) and one hot amber/marigold alarm for "Needs your OK" (seeds gold
       and goldSat), so the meaning never blurs; errors are a rose-crimson clear of Claude's clay. Garnet keeps red to
       a lacquer undertone and trim (--lacquer), never a signal. Crema is ivory on dark roast with a heather-plum
       accent, its surfaces nearly neutral so clay and gold don't sink into brown. */
    { id: 'gold', name: 'Gold', note: 'Black lacquer, ivory type and champagne gold; what needs you glows amber.', main: true, sig: true, light: false,
      accent: 15, sat: 1.3, gold: 33, goldSat: 1.72, surface: 40, surfSat: 0.2, ink: 40, codex: 220, codexSat: 0.08, green: 92, greenSat: 0.95, violet: 45, violetSat: 0.45,
      pal: { surf: { '050406': '070706', '0a090c': '0b0b0a', '0d0b0f': '0f0f0e', '141117': '161614', '1a161d': '1c1b19', '221d26': '252421', '2c2632': '2b2925', '3d3443': '3d392f' },
        ink: { '716a63': '8e877a', '9a928a': 'aca598', 'cfc6b6': 'd5cec1', 'ede6d9': 'efeae0' },
        vars: { focus: '#E7D6A6', working: '#E7D6A6', workingSoft: 'rgb(231 214 166 / .14)', claude: '#E07F62', claudeInk: '#E88E72', claudeSoft: 'rgb(224 127 98 / .15)', codex: '#B2B7C0', codexInk: '#C2C6CE', codexSoft: 'rgb(194 198 206 / .11)', gemini: '#7AA7F7', geminiInk: '#9CC0FA', geminiSoft: 'rgb(122 167 247 / .16)', needs: '#FDAE50', needsSoft: 'rgb(253 174 80 / .16)', error: '#EC5F93', errorInk: '#F07FA6', errorSoft: 'rgb(236 95 147 / .15)' } } },
    { id: 'garnet', name: 'Garnet', note: 'Oxblood lacquer and champagne gilt on warm black. Rich and quiet for long days.', main: true, sig: true, light: false,
      accent: 13, sat: 1.3, gold: 32, goldSat: 1.75, surface: 350, surfSat: 1.1, ink: 38, codex: 225, codexSat: 0.1, green: 95, greenSat: 0.75, violet: 54, violetSat: 0.75,
      pal: { surf: { '050406': '0c0607', '0a090c': '160d11', '0d0b0f': '1b1115', '141117': '21151a', '1a161d': '291a20', '221d26': '332128', '2c2632': '42262f', '3d3443': '583340' },
        ink: { '716a63': '9a8a7c', '9a928a': 'b5a596', 'cfc6b6': 'dacdb9', 'ede6d9': 'f2e8d7' },
        vars: { focus: '#EFDFAB', working: '#EFDFAB', workingSoft: 'rgb(239 223 171 / .14)', claude: '#EB8972', claudeInk: '#F69F87', claudeSoft: 'rgb(235 137 114 / .15)', codex: '#BDC3CD', codexInk: '#CDD3DB', codexSoft: 'rgb(205 211 219 / .11)', gemini: '#8AB4F8', geminiInk: '#9DC0FA', geminiSoft: 'rgb(138 180 248 / .16)', needs: '#FFAB4E', needsSoft: 'rgb(255 171 78 / .16)', error: '#EB5C88', errorInk: '#F879A3', errorSoft: 'rgb(235 92 136 / .14)', lacquer: '#8A2537', lacquerSoft: 'rgb(138 37 55 / .24)' } } },
    { id: 'crema', name: 'Crema', note: 'Ivory type and buttons on dark roast, a heather-plum accent. Warm, never brown.', main: true, sig: true, light: false,
      accent: 17, sat: 1.25, gold: 46, goldSat: 1.1, surface: 25, surfSat: 0.3, ink: 42, codex: 215, codexSat: 0.08, green: 76, greenSat: 0.8, violet: 288,
      pal: { surf: { '050406': '12100e', '0a090c': '1b1816', '0d0b0f': '1f1c19', '141117': '25211e', '1a161d': '2b2724', '221d26': '332f2b', '2c2632': '3a3531', '3d3443': '4b453f' },
        ink: { '716a63': '9a9183', '9a928a': 'b1a897', 'cfc6b6': 'd3cab6', 'ede6d9': 'e9e0cb' },
        vars: { focus: '#BE86CC', working: '#BE86CC', workingSoft: 'rgb(190 134 204 / .15)', claude: '#E2906A', claudeInk: '#E99E7B', claudeSoft: 'rgb(226 144 106 / .15)', codex: '#C3C8CF', codexInk: '#D1D5DB', codexSoft: 'rgb(209 213 219 / .11)', gemini: '#8DB3F2', geminiInk: '#A0C0F5', geminiSoft: 'rgb(141 179 242 / .16)', error: '#E8606A', errorInk: '#EF7F86', errorSoft: 'rgb(232 96 106 / .15)' } } },
  ];
  // The model and status colors each main theme sets on the page (as CSS variables).
  const PAL_VARS = { focus: '--focus', working: '--working', workingSoft: '--working-soft', claude: '--claude', claudeInk: '--claude-ink', claudeSoft: '--claude-soft', codex: '--codex', codexInk: '--codex-ink', codexSoft: '--codex-soft', gemini: '--gemini', geminiInk: '--gemini-ink', geminiSoft: '--gemini-soft', needs: '--needs', needsSoft: '--needs-soft', error: '--error', errorInk: '--error-ink', errorSoft: '--error-soft', lacquer: '--lacquer', lacquerSoft: '--lacquer-soft' };

  // accent: hue for the main color · sat: its strength · gold: hue for highlights · surface: hue
  // and strength of backgrounds · ink: hue of text · codex: hue that marks Codex.
  const THEMES = [
    ...PALETTE,
    { id: 'crimson', name: 'Crimson', note: 'The original: wine red and gold on ink.', accent: 4, sat: 1, gold: 45, surface: 270, surfSat: 1, ink: 38, codex: 217 },
    { id: 'sapphire', name: 'Sapphire', note: 'Deep blue with a warm gold.', accent: 218, sat: 1.15, gold: 42, surface: 226, surfSat: 1.3, ink: 215, codex: 172 },
    { id: 'emerald', name: 'Emerald', note: 'Forest green and brass.', accent: 152, sat: 0.95, gold: 48, surface: 165, surfSat: 1, ink: 90, codex: 217 },
    { id: 'amethyst', name: 'Amethyst', note: 'Violet dusk.', accent: 272, sat: 1.05, gold: 40, surface: 268, surfSat: 1.5, ink: 280, codex: 205 },
    { id: 'amber', name: 'Amber', note: 'Candlelight orange.', accent: 26, sat: 1.35, gold: 50, surface: 28, surfSat: 0.9, ink: 35, codex: 210 },
    { id: 'ocean', name: 'Ocean', note: 'Teal and sea glass.', accent: 186, sat: 1.05, gold: 44, surface: 200, surfSat: 1.3, ink: 190, codex: 230 },
    { id: 'rose', name: 'Rose', note: 'Soft pink and blush.', accent: 336, sat: 1.1, gold: 38, surface: 320, surfSat: 1.1, ink: 20, codex: 212 },
    { id: 'graphite', name: 'Graphite', note: 'Quiet greys, no color cast.', accent: 212, sat: 0.32, gold: 45, surface: 220, surfSat: 0.35, ink: 220, codex: 212 },
    ...SAGA,
    ...GLAM,
    ...ANIME,
  ];
  // fontSet: a ready-made set from FONT_SETS ('' keeps the theme's own); fBody, fHead and fCode: single
  // picks from FAMILIES that win over the set ('' keeps it, 'system' is the device's own font).
  const DEFAULTS = { theme: 'auto', mode: 'system', lightTheme: 'studio-light', darkTheme: 'studio-dark', text: 100, ui: 100, fontSet: '', fBody: '', fHead: '', fCode: '', liga: false, bold: false, contrast: false };

  /* ---------- the font pack ----------
     42 families to choose from in Setup, plus five that only themes use. All are under the SIL Open
     Font License (fonts/OFL.txt, shown in Setup → Fonts and licences). Families with a Reserved Font
     Name (IBM Plex Sans, Source Sans 3, Merriweather, Lora, Cascadia Code, Cinzel Decorative, Pirata
     One, Lexend, Andika, OpenDyslexic) ship as their authors' full files, only WOFF2-compressed; the others are Google
     Fonts' latin files, plus more scripts where a face lists one. Each family is declared here once
     and downloads only when something on the page uses it.
     A face is [file in fonts/, weights, italic, script (a RANGE)]. x is the measured x-height as a
     share of the font size: a reading or code font picked in Setup is scaled so its lowercase
     matches IBM Plex Sans (JetBrains Mono for code), within 90–115%. Themes use the plain names, so
     they keep their exact sizes. */
  const RANGE = {
    latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    ext: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
    greek: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
    vietnamese: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    devanagari: 'U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A',
  };
  const FALLBACK = { sans: 'system-ui, -apple-system, "Segoe UI", sans-serif', serif: '"Iowan Old Style", Georgia, serif', mono: '"Cascadia Mono", Consolas, ui-monospace, monospace', hand: 'cursive' };
  const roman = (file, w) => [[file, w], [`${file}-italic`, w, true]];
  const FAMILIES = [
    { id: 'ibm-plex-sans', name: 'IBM Plex Sans', cat: 'sans', fb: 'sans', x: .52, role: 'Clear everyday reading', faces: roman('ibm-plex-sans', '100 700') },
    { id: 'dm-sans', name: 'DM Sans', cat: 'sans', fb: 'sans', x: .51, role: 'Compact, good at small sizes', faces: roman('dm-sans', '100 1000') },
    { id: 'noto-sans', name: 'Noto Sans', cat: 'sans', fb: 'sans', x: .54, role: 'Many languages', faces: [['noto-sans', '100 900', false, 'latin'], ['noto-sans-italic', '100 900', true, 'latin'],
      ...['ext', 'cyrillic', 'greek', 'vietnamese'].flatMap(s => [[`noto-sans-${s === 'ext' ? 'latin-ext' : s}`, '100 900', false, s], [`noto-sans-italic-${s === 'ext' ? 'latin-ext' : s}`, '100 900', true, s]])] },
    { id: 'source-sans-3', name: 'Source Sans 3', cat: 'sans', fb: 'sans', x: .49, role: 'Partner to Source Serif 4', faces: roman('source-sans-3', '200 900') },
    { id: 'plus-jakarta-sans', name: 'Plus Jakarta Sans', cat: 'sans', fb: 'sans', x: .54, role: 'Friendly and modern', faces: roman('plus-jakarta-sans', '200 800') },
    { id: 'onest', name: 'Onest', cat: 'sans', fb: 'sans', x: .53, role: 'Crisp, for interfaces (no italics)', faces: [['onest', '100 900']] },
    { id: 'google-sans-flex', name: 'Google Sans Flex', cat: 'sans', fb: 'sans', x: .51, role: 'Rounded geometric', faces: [['google-sans-flex', '400 700']] },
    { id: 'inter', name: 'Inter', cat: 'sans', fb: 'sans', x: .55, role: 'The familiar neutral', faces: roman('inter', '400 700') },
    { id: 'nunito', name: 'Nunito', cat: 'sans', fb: 'sans', x: .5, role: 'Rounded and soft', faces: roman('nunito', '400 900') },
    { id: 'literata', name: 'Literata', cat: 'serif', fb: 'serif', x: .51, role: 'Made for long reading on screens', faces: roman('literata', '400 900') },
    { id: 'source-serif-4', name: 'Source Serif 4', cat: 'serif', fb: 'serif', x: .5, role: 'Editorial, pairs with Source Sans 3', faces: roman('source-serif-4', '200 900') },
    { id: 'merriweather', name: 'Merriweather', cat: 'serif', fb: 'serif', x: .56, role: 'Sturdy, good in dark mode', faces: [['merriweather-400', '400'], ['merriweather-400-italic', '400', true], ['merriweather-700', '700'], ['merriweather-700-italic', '700', true]] },
    { id: 'lora', name: 'Lora', cat: 'serif', fb: 'serif', x: .5, role: 'Warm and calligraphic', faces: roman('lora', '400 700') },
    { id: 'eb-garamond', name: 'EB Garamond', cat: 'serif', fb: 'serif', x: .41, role: 'Literary, old-style', faces: roman('eb-garamond', '400 800') },
    { id: 'spectral', name: 'Spectral', cat: 'serif', fb: 'serif', x: .45, role: 'The app’s own bookish serif', faces: [['spectral-400', '400'], ['spectral-400-italic', '400', true], ['spectral-500', '500'], ['spectral-600', '600 700']] },
    { id: 'alegreya', name: 'Alegreya', cat: 'serif', fb: 'serif', x: .46, role: 'Lively, literary', faces: roman('alegreya', '400 900') },
    { id: 'jetbrains-mono', name: 'JetBrains Mono', cat: 'code', fb: 'mono', x: .55, role: 'Code, diffs and terminal output', faces: [['jetbrains-mono', '100 800']] },
    { id: 'cascadia-code', name: 'Cascadia Code', cat: 'code', fb: 'mono', x: .52, role: 'Windows Terminal’s font', faces: roman('cascadia-code', '200 700') },
    { id: 'fira-code', name: 'Fira Code', cat: 'code', fb: 'mono', x: .53, role: 'The ligature favourite', faces: [['fira-code', '300 700']] },
    { id: 'google-sans-code', name: 'Google Sans Code', cat: 'code', fb: 'mono', x: .53, role: 'Fresh and neutral', faces: roman('google-sans-code', '300 800') },
    { id: 'victor-mono', name: 'Victor Mono', cat: 'code', fb: 'mono', x: .62, role: 'Narrow, with a cursive italic', faces: roman('victor-mono', '100 700') },
    { id: 'geist-mono', name: 'Geist Mono', cat: 'code', fb: 'mono', x: .53, role: 'Clean and modern', faces: [['geist-mono', '100 900']] },
    { id: 'atkinson-mono', name: 'Atkinson Hyperlegible Mono', cat: 'code', fb: 'mono', x: .5, role: 'Code that’s easy to tell apart', faces: roman('atkinson-mono', '200 800') },
    { id: 'archivo', name: 'Archivo', cat: 'display', fb: 'sans', role: 'Strong grotesque headings', faces: roman('archivo', '100 900') },
    { id: 'big-shoulders', name: 'Big Shoulders', cat: 'display', fb: 'sans', role: 'Bold, condensed posters', faces: [['big-shoulders', '100 900']] },
    { id: 'unbounded', name: 'Unbounded', cat: 'display', fb: 'sans', role: 'Wide and loud', faces: [['unbounded', '200 900']] },
    { id: 'playfair', name: 'Playfair', cat: 'display', fb: 'serif', role: 'Elegant high contrast', faces: roman('playfair-2', '300 900') },
    { id: 'young-serif', name: 'Young Serif', cat: 'display', fb: 'serif', role: 'Warm editorial titles', faces: [['young-serif', '400 900']] },
    { id: 'cinzel', name: 'Cinzel', cat: 'display', fb: 'serif', role: 'Carved Roman capitals', faces: [['cinzel', '400 900']] },
    { id: 'pirata-one', name: 'Pirata One', cat: 'display', fb: 'serif', role: 'Gothic and piratical', faces: [['pirata-one', '400']] },
    { id: 'michroma', name: 'Michroma', cat: 'display', fb: 'sans', role: 'Wide sci-fi', faces: [['michroma', '400 800']] },
    { id: 'tektur', name: 'Tektur', cat: 'display', fb: 'sans', role: 'Angular sci-fi', faces: [['tektur', '400 900', false, 'latin'], ['tektur-latin-ext', '400 900', false, 'ext'], ['tektur-cyrillic', '400 900', false, 'cyrillic'], ['tektur-greek', '400 900', false, 'greek']] },
    { id: 'silkscreen', name: 'Silkscreen', cat: 'display', fb: 'sans', role: 'Retro pixels', faces: [['silkscreen-400', '400 600'], ['silkscreen-700', '700 900']] },
    { id: 'caveat', name: 'Caveat', cat: 'hand', fb: 'hand', role: 'Quick handwritten notes', faces: [['caveat', '400 700']] },
    { id: 'patrick-hand', name: 'Patrick Hand', cat: 'hand', fb: 'hand', role: 'Neat handwriting', faces: [['patrick-hand', '400 900']] },
    { id: 'kalam', name: 'Kalam', cat: 'hand', fb: 'hand', role: 'Handwriting, Devanagari too', faces: [['kalam-400', '400 600', false, 'latin'], ['kalam-700', '700 900', false, 'latin'], ['kalam-400-devanagari', '400 600', false, 'devanagari'], ['kalam-700-devanagari', '700 900', false, 'devanagari']] },
    { id: 'pacifico', name: 'Pacifico', cat: 'hand', fb: 'hand', role: 'Retro script', faces: [['pacifico', '400']] },
    { id: 'atkinson-next', name: 'Atkinson Hyperlegible Next', cat: 'easy', fb: 'sans', x: .5, role: 'Letters made hard to confuse', faces: roman('atkinson-next', '200 800') },
    { id: 'lexend', name: 'Lexend', cat: 'easy', fb: 'sans', x: .53, role: 'Wide and open (no italics)', faces: [['lexend', '100 900']] },
    { id: 'opendyslexic', name: 'OpenDyslexic', cat: 'easy', fb: 'sans', x: .56, role: 'Weighted letters some people prefer', faces: [['opendyslexic-400', '400'], ['opendyslexic-400-italic', '400', true], ['opendyslexic-700', '700'], ['opendyslexic-700-italic', '700', true]] },
    { id: 'andika', name: 'Andika', cat: 'easy', fb: 'sans', x: .5, role: 'Clear shapes for new readers', faces: [['andika-400', '400'], ['andika-400-italic', '400', true], ['andika-700', '700'], ['andika-700-italic', '700', true]] },
    { id: 'mplus-rounded', name: 'M PLUS Rounded 1c', cat: 'easy', fb: 'sans', x: .52, role: 'Rounded, with Japanese', faces: [['mplus-rounded-400', '400 500'], ['mplus-rounded-700', '600 700'], ['mplus-rounded-800', '800 900']] },
    // Only themes use these: Rebel's Barlow (Ryan's theme, as he made it), and High Fantasy's and Dungeon's capitals.
    { id: 'barlow', name: 'Barlow', cat: 'theme', fb: 'sans', faces: [['barlow-400', '400'], ['barlow-400-italic', '400', true], ['barlow-500', '500'], ['barlow-600', '600 800']] },
    { id: 'barlow-condensed', name: 'Barlow Condensed', cat: 'theme', fb: 'sans', faces: [['barlow-condensed-600', '500 600'], ['barlow-condensed-700', '700 900']] },
    { id: 'barlow-semi-condensed', name: 'Barlow Semi Condensed', cat: 'theme', fb: 'sans', faces: [['barlow-semi-condensed-500', '400 500'], ['barlow-semi-condensed-600', '600 800']] },
    { id: 'cinzel-decorative', name: 'Cinzel Decorative', cat: 'theme', fb: 'serif', faces: [['cinzel-decorative-400', '400 600'], ['cinzel-decorative-700', '700 900']] },
    { id: 'alegreya-sc', name: 'Alegreya SC', cat: 'theme', fb: 'serif', faces: [['alegreya-sc-400', '400 500'], ['alegreya-sc-700', '600 900']] },
  ];
  // Ready-made sets: headings (and names, unless caps says otherwise), reading and code. Theme Studio
  // offers the same sets; 'storybook', 'clear' and 'rounded' keep the keys its saved worlds use.
  const FONT_SETS = [
    { id: 'clear', name: 'Clear', head: 'ibm-plex-sans', body: 'ibm-plex-sans', code: 'jetbrains-mono' },
    { id: 'reading', name: 'Reading', head: 'literata', body: 'literata', code: 'jetbrains-mono' },
    { id: 'easy', name: 'Easy reading', head: 'atkinson-next', body: 'atkinson-next', code: 'atkinson-mono' },
    { id: 'editorial', name: 'Editorial', head: 'young-serif', body: 'source-serif-4', code: 'google-sans-code' },
    { id: 'storybook', name: 'Fantasy', head: 'cinzel', body: 'eb-garamond', code: 'victor-mono' },
    { id: 'scifi', name: 'Sci-fi', head: 'tektur', body: 'onest', code: 'geist-mono' },
    { id: 'glam', name: 'Glam', head: 'playfair', body: 'plus-jakarta-sans', code: 'cascadia-code' },
    { id: 'poster', name: 'Poster', head: 'big-shoulders', body: 'source-sans-3', code: 'fira-code' },
    { id: 'pixel', name: 'Retro pixel', head: 'silkscreen', caps: 'dm-sans', body: 'dm-sans', code: 'jetbrains-mono' },
    { id: 'loud', name: 'Loud and wide', head: 'unbounded', caps: 'noto-sans', body: 'noto-sans', code: 'google-sans-code' },
    { id: 'rounded', name: 'Soft and rounded', head: 'mplus-rounded', body: 'nunito', code: 'jetbrains-mono' },
  ];
  const SYSTEM = { body: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', head: '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', code: FALLBACK.mono };
  const familyOf = id => FAMILIES.find(f => f.id === id);
  // How much a picked reading or code font is scaled (size-adjust, in %).
  const fitOf = f => (f && f.x ? Math.round(Math.min(115, Math.max(90, (f.cat === 'code' ? .55 : .52) / f.x * 100)) * 2) / 2 : 100);
  // The CSS font stack for a family in a slot: reading and code use the scaled copy, headings the plain one.
  function stack(id, slot) {
    if (id === 'system') return SYSTEM[slot];
    const f = familyOf(id); if (!f) return null;
    const fit = slot === 'head' ? 100 : fitOf(f);
    return `"${fit === 100 ? f.name : `Fit ${f.name}`}", ${FALLBACK[f.fb]}`;
  }
  // A set's fonts, as the theme fonts shape: { display, caps, body, mono }.
  function setFonts(id) {
    const s = FONT_SETS.find(x => x.id === id); if (!s) return null;
    return { display: stack(s.head, 'head'), caps: stack(s.caps || s.head, 'head'), body: stack(s.body, 'body'), mono: stack(s.code, 'code') };
  }

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
        if (!light && l < 0.5) ll = Math.max(ll, 0.5); // and in dark ones, light enough
        if (contrast) ll = light ? ll * 0.6 : ll + (1 - ll) * 0.4;
        return toRgb(t.ink, s * (t.inkSat ?? (t.id === 'graphite' ? 0.2 : 1)), ll);
      }
      case 'accent': {
        const ll = light ? (l > 0.42 ? 0.42 - (l - 0.42) * 0.4 : l * 0.95) : (contrast && l > 0.5 ? l + 0.06 : l);
        return toRgb(h - 4 + t.accent, s * t.sat, ll);
      }
      case 'gold': return toRgb(h - 45 + t.gold, s * (t.goldSat ?? (t.id === 'graphite' ? 0.7 : 1)), light ? (l > 0.4 ? 0.4 - (l - 0.4) * 0.3 : l) : l);
      case 'codex': return toRgb(h - 217 + t.codex, s * (t.codexSat ?? 1), light ? (l > 0.42 ? 0.42 - (l - 0.42) * 0.4 : l) : l);
      case 'green': if (t.green != null) return toRgb(t.green, s * (t.greenSat ?? 1), light ? (l > 0.42 ? 0.4 - (l - 0.42) * 0.4 : l) : l); break;
      case 'violet': if (t.violet != null) return toRgb(t.violet, s * (t.violetSat ?? 0.85), light ? (l > 0.42 ? 0.4 - (l - 0.42) * 0.4 : l) : l); break;
      default: break;
    }
    return toRgb(h, s, light ? (l > 0.42 ? 0.4 - (l - 0.42) * 0.4 : l) : l);
  }

  // A main theme's color for one of the original colors: backgrounds and text interpolate between the palette's
  // own values by the original's lightness (so every in-between step keeps its place); the rest is derived.
  const hexRgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const ANCHORS = new Map();   // theme id + role -> [[original lightness, rgb], ...] sorted
  function anchors(t, role, contrast) {
    const k = `${t.id}:${role}:${contrast ? 1 : 0}`;
    if (ANCHORS.has(k)) return ANCHORS.get(k);
    const src = role === 'surface' ? t.pal.surf : t.pal.ink;
    let list = Object.entries(src).map(([orig, val]) => [toHsl(orig)[2], hexRgb(val)]).sort((a, b) => a[0] - b[0]);
    // Higher contrast: the quieter text steps move toward the main text.
    if (contrast && role === 'ink') { const top = list[list.length - 1][1]; list = list.map(([l, c], i) => [l, i === list.length - 1 ? c : c.map((v, j) => Math.round(v + (top[j] - v) * 0.4))]); }
    ANCHORS.set(k, list);
    return list;
  }
  function palAt(list, l) {
    if (l <= list[0][0]) return list[0][1].slice();
    for (let i = 1; i < list.length; i++) {
      if (l <= list[i][0]) { const [l0, a] = list[i - 1], [l1, b] = list[i], f = (l - l0) / (l1 - l0 || 1); return a.map((v, j) => Math.round(v + (b[j] - v) * f)); }
    }
    return list[list.length - 1][1].slice();
  }
  function palColor(hex, t, contrast) {
    if (hex === '1a1405') return t.light ? [28, 22, 0] : [26, 20, 5];   // the ink on gold buttons stays dark
    const r = ROLES[hex];
    if (r === 'surface' || r === 'ink') return palAt(anchors(t, r, contrast), toHsl(hex)[2]);
    return derive(hex, t, t.light, contrast);
  }

  // Custom themes keep the same surface steps. Only their ink is nudged when a hue would make
  // small labels difficult to read. The server and the browser use this exact same calculation.
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const READ_SURFACES = ['0a090c', '110e12', '17131a', '1a161d'];
  const ACTION_BACKGROUNDS = ['8d3e37', '6c2e29', '9a463e', '78342e'];
  function color(hex, t, light, contrast = false) {
    if (t.pal) return palColor(hex, t, contrast);
    const rgb = derive(hex, t, light, contrast);
    if (t.family === 'custom' && ACTION_BACKGROUNDS.includes(hex)) {
      for (let step = 0; step <= 100; step++) {
        const corrected = rgb.map(v => Math.round(v * (1 - step / 100)));
        if (ratio(corrected, [246, 236, 226]) >= 4.5) return corrected;
      }
    }
    if (t.family !== 'custom' || ROLES[hex] !== 'ink') return rgb;
    const target = ['ede6d9', 'e6dccb', 'e9e1d4', 'eadfce', 'cfc6b6'].includes(hex) ? 7 : 4.5;
    const backgrounds = READ_SURFACES.map(c => derive(c, t, light, contrast));
    for (let step = 0; step <= 100; step++) {
      const corrected = rgb.map(v => Math.round(v + ((light ? 0 : 255) - v) * step / 100));
      if (backgrounds.every(bg => ratio(corrected, bg) >= target)) return corrected;
    }
    return light ? [0, 0, 0] : [255, 255, 255];
  }
  function audit(t) {
    return Object.fromEntries([false, true].map(light => [light ? 'light' : 'dark', {
      faint: Math.min(...READ_SURFACES.map(bg => ratio(color('716a63', t, light), derive(bg, t, light, false)))),
      body: Math.min(...READ_SURFACES.map(bg => ratio(color('ede6d9', t, light), derive(bg, t, light, false)))),
      buttons: Math.min(...ACTION_BACKGROUNDS.map(bg => ratio(color(bg, t, light), [246, 236, 226]))),
    }]));
  }
  if (typeof window === 'undefined') { module.exports = { audit, color, ratio, FAMILIES, FONT_SETS, setFonts, PALETTE }; return; }

  // Every family's @font-face, plus a scaled copy ("Fit <name>") for the reading and code fonts.
  (function fontFaces() {
    const face = (fam, [file, w, italic, script], fit) => `@font-face{font-family:"${fam}";src:url(/fonts/${file}.woff2) format("woff2");font-weight:${w};${italic ? 'font-style:italic;' : ''}${script ? `unicode-range:${RANGE[script]};` : ''}${fit ? `size-adjust:${fit}%;` : ''}font-display:swap}`;
    const css = [];
    for (const f of FAMILIES) {
      for (const fc of f.faces) css.push(face(f.name, fc));
      const fit = fitOf(f);
      if (fit !== 100) for (const fc of f.faces) css.push(face(`Fit ${f.name}`, fc, fit));
    }
    const el = document.createElement('style'); el.id = 'fontPack'; el.textContent = css.join('\n');
    document.head.appendChild(el);
  })();

  /* ---------- settings ---------- */
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  // Earlier names of the saga themes, so a saved choice still finds its theme.
  const RENAMED = { vanguard: 'rebel', dominion: 'imperial', mirage: 'rebel' };
  function load() {
    let o; try { o = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('look') || '{}') || {}) }; } catch { o = { ...DEFAULTS }; }
    if (RENAMED[o.theme]) o.theme = RENAMED[o.theme];
    // The old reading-font choice: Modern was the device's sans for replies, Clean for headings too.
    if (o.font === 'modern' || o.font === 'clean') { o.fBody = o.fBody || 'system'; if (o.font === 'clean') o.fHead = o.fHead || 'system'; }
    delete o.font;
    // Once: the old default (Crimson) moves to the new one, following the device with Light and Dark.
    if (!o.v) { if (o.theme === 'crimson') { o.theme = 'auto'; o.mode = 'system'; } o.v = 2; }
    if (!o.lightTheme) o.lightTheme = DEFAULTS.lightTheme;
    if (!o.darkTheme) o.darkTheme = DEFAULTS.darkTheme;
    return o;
  }
  let cur = load();
  const isLight = (o = cur) => o.mode === 'light' || (o.mode === 'system' && !!(mq && mq.matches));
  const byId = id => THEMES.find(t => t.id === id);
  // "auto": the main theme picked for light or for dark (lightTheme / darkTheme), as the mode (or the device) says.
  // An unknown theme (a deleted custom one, say) falls back to Crimson, as before.
  const themeOf = (id, o = cur) => {
    if (id === 'auto') { const l = isLight(o); return byId(l ? o.lightTheme : o.darkTheme) || byId(l ? 'studio-light' : 'studio-dark'); }
    return byId(id) || byId('crimson');
  };

  function apply(o = cur) {
    const root = document.documentElement, st = root.style;
    const t = themeOf(o.theme, o), light = t.pal ? t.light : isLight(o);
    const original = t.id === 'crimson' && !light && !o.contrast;
    for (const c of COLORS) {
      if (original) st.removeProperty(`--c-${c}`);
      else st.setProperty(`--c-${c}`, color(c, t, light, o.contrast).join(' '));
    }
    for (const [k, v] of Object.entries(PAL_VARS)) { const val = t.pal && t.pal.vars[k]; if (val) st.setProperty(v, val); else st.removeProperty(v); }
    root.classList.toggle('look-main', !!t.pal);
    root.dataset.mode = light ? 'light' : 'dark';
    root.dataset.theme = t.id;
    st.colorScheme = light ? 'light' : 'dark';
    // Fonts: the theme's own lettering, then a font set from Setup, then single picks, each winning over
    // the last. Ryan's space saga themes (Imperial, Rebel) always keep their own, as he made them.
    const f = { ...(t.fonts || {}) };
    if (t.family !== 'saga') {
      Object.assign(f, setFonts(o.fontSet) || {});
      if (o.fBody) f.body = stack(o.fBody, 'body') || f.body;
      if (o.fHead) f.display = f.caps = stack(o.fHead, 'head') || f.display;
      if (o.fCode) f.mono = stack(o.fCode, 'code') || f.mono;
    }
    // The standard themes' "Studio" look (ui/studio.css): one interface face for replies, headings and labels too,
    // unless a font set or a pick in Setup says otherwise. Code stays in its monospace.
    if (!t.family) { f.body = f.body || INTER; f.display = f.display || INTER; f.caps = f.caps || INTER; f.label = f.label || INTER; }
    for (const [k, v] of [['--f-body', f.body], ['--f-display', f.display], ['--f-caps', f.caps], ['--f-label', f.label], ['--f-mono', f.mono]]) { if (v) st.setProperty(k, v); else st.removeProperty(k); }
    // Interface text stays easy to scan; explicit font choices still win.
    st.setProperty('--f-ui', f.body || INTER);
    st.setProperty('--f-ui-head', f.display || INTER);
    root.classList.toggle('look-liga', !!o.liga);
    if (t.family) root.dataset.family = t.family; else delete root.dataset.family;
    // The hub's compact layout (ui/hub.css). Ryan's space saga themes keep their own, as he made them.
    root.classList.toggle('hub2', t.family !== 'saga');
    if (t.sky) root.dataset.sky = t.sky; else delete root.dataset.sky;
    if (t.art) root.dataset.art = t.art; else delete root.dataset.art;
    emblem(t);
    st.setProperty('--look-text', String(clamp(Number(o.text) || 100, 80, 150) / 100));
    st.setProperty('--look-ui', String(clamp(Number(o.ui) || 100, 75, 140) / 100));
    root.classList.toggle('look-bold', !!o.bold);
    // Breakpoints see the window, not the scaled page, so a larger interface gets a compact top bar.
    root.classList.toggle('look-ui-big', (Number(o.ui) || 100) > 100);
    root.classList.toggle('look-contrast', !!o.contrast);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = `rgb(${derive('0a090c', t, light, false).join(',')})`;
    document.dispatchEvent(new CustomEvent('lookchange', { detail: o }));
  }
  // The seal (logo) takes the theme's emblem; the original is kept to put back.
  let sigil0 = null;
  function emblem(t = themeOf(cur.theme, cur)) {
    const sym = document.getElementById('sigil'); if (!sym) return;
    if (sigil0 === null) sigil0 = sym.innerHTML;
    const want = t.emblem || sigil0;
    if (sym.innerHTML !== want) sym.innerHTML = want;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => emblem());
  // The theme's words for a piece of the app's text, or the text itself. {n} and the like fill in from vars.
  function say(text, vars) {
    const c = themeOf(cur.theme, cur).copy, s = (c && c[text]) ?? text;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }
  function set(changes) {
    // Choosing one of the five main themes: it becomes the pick for its half (light or dark), and shows now unless
    // the app follows the device (then it shows when the device is in that mode).
    const p = changes.theme && byId(changes.theme);
    if (p && p.pal) {
      changes = { ...changes, theme: 'auto', [p.light ? 'lightTheme' : 'darkTheme']: p.id };
      if (changes.mode === undefined && cur.mode !== 'system') changes.mode = p.light ? 'light' : 'dark';
    }
    cur = { ...cur, ...changes };
    try { localStorage.setItem('look', JSON.stringify(cur)); } catch { /* private window */ }
    apply();
  }
  function reset() { cur = { ...DEFAULTS }; try { localStorage.removeItem('look'); } catch { /* fine */ } apply(); }
  // A few colors of a theme, for its swatch in Setup.
  function swatch(id, light) {
    const t = themeOf(id), c = hex => `rgb(${color(hex, t, light, false).join(',')})`;
    const v = t.pal && t.pal.vars;
    return { bg: c('0a090c'), card: c('1a161d'), line: c('2c2632'), ink: c('ede6d9'), ash: c('9a928a'), accent: c('a5463f'), ember: c('cf8274'), gold: c('d9bf74'), codex: v ? v.codex : c('6f97d8'), claude: v ? v.claude : c('cf8274'), gemini: v ? v.gemini : (light ? 'rgb(132 72 170)' : 'rgb(195 138 224)'), focus: v ? v.focus : c('d9bf74') };
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (cur.mode === 'system') apply(); });

  function custom(themes) {
    for (let i = THEMES.length - 1; i >= 0; i--) if (THEMES[i].family === 'custom') THEMES.splice(i, 1);
    THEMES.push(...themes);
    if (cur.theme.startsWith('custom-') && !THEMES.some(t => t.id === cur.theme)) set({ theme: DEFAULTS.theme });
    else apply();
  }
  window.Look = { THEMES, DEFAULTS, FAMILIES, FONT_SETS, stack, setFonts, get: () => ({ ...cur }), set, reset, apply, swatch, isLight, say, custom, audit, color, theme: () => themeOf(cur.theme, cur), MAIN: PALETTE };
  apply();
})();
