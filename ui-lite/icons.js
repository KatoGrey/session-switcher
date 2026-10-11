'use strict';
/* Switcher's icon, one per look: two arrows passing each other (switching), drawn for Plain,
   Imperial and Rebel. The tab icon follows the look, or the one you pick (Look → Icon, kept on
   this device). The Home Screen icon takes whichever is showing when you add Lite to it. */

const ICONS = {
  plain: { name: 'Plain', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6f4e"/><g fill="none" stroke="#f4efe2" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 24h28M37 16.5 44.5 24 37 31.5"/><path d="M48 40H20M27 32.5 19.5 40 27 47.5"/></g></svg>` },
  imperial: { name: 'Imperial', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0e0f11"/><path d="M32 6.5 54 19.25v25.5L32 57.5 10 44.75v-25.5Z" fill="none" stroke="#d6343a" stroke-width="2.5" stroke-linejoin="miter"/><g fill="none" stroke="#d6343a" stroke-width="4.5" stroke-linecap="butt" stroke-linejoin="miter"><path d="M20 25h21M36 20 41.5 25 36 30"/><path d="M44 39H23M28 34 22.5 39 28 44"/></g></svg>` },
  rebel: { name: 'Rebel', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx="30%" cy="25%" r="85%"><stop offset="0" stop-color="#4a3122"/><stop offset="1" stop-color="#1f150e"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M15 9.5 16.6 14.4 21.5 16 16.6 17.6 15 22.5 13.4 17.6 8.5 16 13.4 14.4Z" fill="#ffcf8a"/><g fill="none" stroke="#f07a2e" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 27h25M38.5 20 45.5 27 38.5 34"/><path d="M48 41H23M29.5 34 22.5 41 29.5 48"/></g></svg>` },
};
const iconChoice = () => local.get('icon', 'look');
const iconFor = skin => (ICONS[iconChoice()] ? iconChoice() : ICONS[skin] ? skin : 'plain');
const iconUrl = key => `data:image/svg+xml,${encodeURIComponent(ICONS[key].svg)}`;
let shownIcon = null;
// The tab icon (and the Home Screen icon, drawn as a PNG for iOS) for the current look or choice.
function applyIcon(skin) {
  const key = iconFor(skin); if (key === shownIcon) return;
  shownIcon = key;
  const fav = $('favicon'); if (fav) { fav.href = iconUrl(key); if (typeof favBase !== 'undefined') favBase = null; }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 180;
      c.getContext('2d').drawImage(img, 0, 0, 180, 180);
      let a = document.querySelector('link[rel="apple-touch-icon"]');
      if (!a) { a = document.createElement('link'); a.rel = 'apple-touch-icon'; document.head.appendChild(a); }
      a.href = c.toDataURL('image/png');
    } catch { /* keep the old one */ }
  };
  img.src = iconUrl(key);
  if (typeof updateBadge === 'function') updateBadge();
}
