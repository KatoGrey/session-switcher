'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/chat-drafts.js'), 'utf8');

function setup(initial = {}) {
  const data = new Map(Object.entries(initial)), requests = [], listeners = {};
  const storage = { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
  const badge = { dataset: { draftId: 'a' }, hidden: true }, opened = [];
  const ctx = { window: { addEventListener: (k, fn) => { listeners[k] = fn; } }, localStorage: storage,
    store: (k, v) => v === undefined ? storage.getItem(k) : storage.setItem(k, v),
    document: { hidden: false, querySelectorAll: () => [badge], addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {}, setTimeout() {}, setInterval() {}, esc: s => s.replace(/"/g, '&quot;'),
    api: () => new Promise(resolve => requests.push(resolve)),
    allSessions: () => [[{ id: 'a', title: 'First chat' }, { name: 'One' }], [{ id: 'b', title: 'Second chat' }, { name: 'Two' }], [{ id: 'A', title: 'Duplicate' }, { name: 'One' }]],
    openChatFromNav: id => opened.push(id),
  };
  vm.runInNewContext(source, ctx);
  return { drafts: ctx.window.ChatDrafts, storage, badge, requests, listeners, opened };
}

test('draft index finds local drafts and remote drafts without fetching their contents', async () => {
  const x = setup({ 'draft:a': 'Unsent', 'draft:a:at': '10', 'draft:new:claude:project': 'New', 'draft:c': '  ' });
  assert.equal(x.drafts.has('A'), true);
  const pending = x.drafts.refresh(true); x.requests.shift()({ drafts: [{ id: 'B', at: 20 }] }); await pending;
  const items = x.drafts.items();
  assert.deepEqual(Array.from(items, i => i.id), ['draft:b', 'draft:a']);
  items[0].run(); assert.deepEqual(x.opened, ['b']);
  assert.match(x.drafts.badge('a'), /Unsent message/);
  assert.equal(x.drafts.has('c'), false);
});

test('an index requested before a send cannot resurrect its badge', async () => {
  const x = setup({ 'draft:a': 'Unsent', 'draft:a:at': '10' });
  const pending = x.drafts.refresh(true);
  const rev = x.drafts.changed('a', '', 30); x.drafts.acknowledged('a', '', 30, rev);
  x.requests.shift()({ drafts: [{ id: 'a', at: 10 }] }); await pending;
  assert.equal(x.drafts.has('a'), false);
  assert.equal(x.badge.hidden, true);
  const fresh = x.drafts.refresh(true); x.requests.shift()({ drafts: [] }); await fresh;
  assert.equal(x.drafts.has('a'), false);
});

test('an index requested before typing cannot erase a new draft', async () => {
  const x = setup(), pending = x.drafts.refresh(true);
  const rev = x.drafts.changed('a', 'New words', 30); x.drafts.acknowledged('a', 'New words', 30, rev);
  x.requests.shift()({ drafts: [] }); await pending;
  assert.equal(x.drafts.has('a'), true);
  assert.equal(x.badge.hidden, false);
});

test('old acknowledgements in the same millisecond do not confirm newer edits', async () => {
  const x = setup(), first = x.drafts.changed('a', 'One', 30);
  x.drafts.changed('a', 'Two', 30);
  x.drafts.acknowledged('a', 'One', 30, first);
  assert.equal(x.storage.getItem('drafts-synced'), null);
});

test('a send on another device clears a draft just saved in this still-open window', async () => {
  const x = setup({ 'draft:a': 'Saved on PC', 'draft:a:at': '30' });
  const rev = x.drafts.changed('a', 'Saved on PC', 30); x.drafts.acknowledged('a', 'Saved on PC', 30, rev);
  const pending = x.drafts.refresh(true); x.requests.shift()({ drafts: [] }); await pending;
  assert.equal(x.drafts.has('a'), false);
  assert.equal(x.storage.getItem('draft:a'), null);
});

test('an index started during a save cannot clear it after the acknowledgement arrives', async () => {
  const x = setup(), rev = x.drafts.changed('a', 'Being saved', 30);
  const pending = x.drafts.refresh(true);
  x.drafts.acknowledged('a', 'Being saved', 30, rev);
  x.requests.shift()({ drafts: [] }); await pending;
  assert.equal(x.drafts.has('a'), true);
});

test('a draft sent on another device clears only a cache that was confirmed saved', async () => {
  const x = setup({ 'draft:a': 'Saved on PC', 'draft:a:at': '10', 'draft:b': 'Offline edit', 'draft:b:at': '30', 'drafts-synced': '{"a":10,"b":20}' });
  const pending = x.drafts.refresh(true); x.requests.shift()({ drafts: [] }); await pending;
  assert.equal(x.drafts.has('a'), false);
  assert.equal(x.storage.getItem('draft:a'), null);
  assert.equal(x.drafts.has('b'), true);
  assert.equal(x.storage.getItem('draft:b'), 'Offline edit');
});

test('a temporarily missing index keeps local drafts and other windows update their badges', async () => {
  const x = setup({ 'draft:a': 'Unsent', 'draft:a:at': '10' });
  const pending = x.drafts.refresh(true); x.requests.shift()({ error: 'Older server' }); await pending;
  assert.equal(x.drafts.has('a'), true);
  x.storage.removeItem('draft:a'); x.listeners.storage({ key: 'draft:a' });
  assert.equal(x.drafts.has('a'), false);
  x.requests.shift()({ drafts: [] });
});
