'use strict';
/* The phone's notifications (lib/push.js sends them). A chat that needs your OK shows Allow and Deny
   on the notification (Android; an iPhone shows the notification, and a tap opens the chat). A tap
   anywhere else opens Session Switcher on that chat. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Session Switcher', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Session Switcher', {
    body: m.body || '', tag: m.tag || undefined, renotify: m.kind === 'needs', requireInteraction: m.kind === 'needs',
    icon: '/apple-touch-icon.png', badge: '/apple-touch-icon.png', timestamp: m.at || Date.now(), data: m,
    actions: m.act ? [{ action: 'allow', title: 'Allow' }, { action: 'deny', title: 'Deny' }] : m.choices && m.choices.length <= 2 ? m.choices.map((c, i) => ({ action: `choice${i}`, title: c.label })) : [],
  }));
});

self.addEventListener('notificationclick', e => {
  const n = e.notification, m = n.data || {};
  n.close();
  if ((e.action === 'allow' || e.action === 'deny') && m.act) { e.waitUntil(answer(m, e.action)); return; }
  const c = /^choice(\d)$/.exec(e.action || '');
  if (c && m.choices && m.choices[+c[1]]) { e.waitUntil(answer({ ...m, act: m.choices[+c[1]].token }, 'allow')); return; }
  e.waitUntil(openChat(m));
});

// Allow or Deny, from the notification. If it was answered already (on the PC, say), it says so.
async function answer(m, decision) {
  let why = '';
  try {
    const r = await fetch('/api/push/act', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: m.act, decision }) });
    if (r.ok) return;
    why = ((await r.json().catch(() => ({}))).error) || `It didn’t go through (${r.status}).`;
  } catch { why = 'Couldn’t reach your PC.'; }
  await self.registration.showNotification(`${m.chatTitle || 'A chat'}: not answered`, { body: `${why} Tap to open it.`, tag: m.tag, icon: '/apple-touch-icon.png', data: { ...m, act: null } });
}

async function openChat(m) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const w = wins[0];
  if (w) { await w.focus(); w.postMessage({ open: { key: m.key || null, sessionId: m.sessionId || null } }); return; }
  const q = m.key ? `?key=${encodeURIComponent(m.key)}` : m.sessionId ? `?chat=${encodeURIComponent(m.sessionId)}` : '';
  await self.clients.openWindow(`/${q}`);
}
