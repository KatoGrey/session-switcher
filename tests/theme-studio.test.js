const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStudio, normalize } = require('../lib/theme-studio');
const { audit } = require('../theme');
const ID = 'custom-0123456789abcdef01234567';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-studio-'));
function png() { const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.write('IHDR', 12); b.writeUInt32BE(1536, 16); b.writeUInt32BE(1024, 20); return b; }
const webp = () => fs.readFileSync(path.join(__dirname, '..', 'art', 'isekai-dark.webp')).toString('base64');
function ready(store, name = 'Lantern Tide') {
  const j = store.create({ name, description: 'A lantern-lit seaside town', font: 'storybook' });
  fs.writeFileSync(path.join(j.cwd, 'theme.json'), JSON.stringify({ name, font: 'storybook', seeds: { accent: 185, surface: 210, ink: 180 } }));
  for (const m of ['dark', 'light']) fs.writeFileSync(path.join(j.cwd, m + '.png'), png());
  return j;
}
test('custom palettes stay readable on page and card surfaces, even at extreme hues', () => {
  for (const ink of [0, 60, 120, 180, 240, 300]) for (const surface of [0, 60, 120, 180, 240, 300]) {
    const t = normalize({ seeds: { accent: ink, sat: 1.5, ink, surface, inkSat: 1, surfSat: 1.5 } }, ID);
    for (const r of Object.values(audit(t))) { assert.ok(r.faint >= 4.5); assert.ok(r.body >= 7); assert.ok(r.buttons >= 4.5); }
  }
});
test('generated themes cannot inject code, external fonts, styles or arbitrary wording', () => {
  const t = normalize({ name: '<b>Hello</b>', font: 'url(https://example.org)', art: 'citadel', emblem: '<script>', paint: { dark: 'https://example.org' }, copy: { 'Welcome back': '<script>alert(1)</script>', 'Allow once': 'Click me' }, seeds: { accent: 999, sat: -2 } }, ID);
  assert.equal(t.art, 'painting'); assert.equal(t.emblem, undefined); assert.equal(t.font, 'clear'); assert.equal(t.sat, 0); assert.equal(t.accent, 360);
  assert.equal(t.copy['Allow once'], undefined); assert.ok(!t.copy['Welcome back'].includes('<')); assert.deepEqual(t.paint, { dark: 'dark', light: 'light' });
  assert.throws(() => normalize({ seeds: { ink: 'red' } }, ID)); assert.throws(() => normalize({}, '../../oops'));
});
test('art jobs persist separately, save compressed themes, and preserve originals when deleted', () => {
  const dir = temp(), store = createStudio(dir), j = ready(store);
  assert.ok(j.cwd.startsWith(path.join(dir, 'theme-studio', 'jobs')));
  assert.ok(j.prompt.includes('theme.json LAST')); assert.equal(store.project(j.cwd).name, 'Lantern Tide'); assert.equal(store.project(dir), null);
  assert.equal(store.list().jobs[0].ready, true);
  const r = store.result(j.id), t = store.save({ id: j.id, revision: r.revision, dark: webp(), light: webp() });
  assert.equal(t.name, 'Lantern Tide'); assert.equal(store.list().jobs.length, 0);
  assert.equal(createStudio(dir).list().themes[0].id, j.id);
  assert.equal(store.asset('themes', j.id, 'dark').type, 'image/webp');
  assert.throws(() => store.save({ id: j.id, revision: r.revision, dark: webp(), light: webp() }), /already saved/);
  store.remove(j.id); assert.equal(store.list().themes.length, 0); assert.equal(store.list().jobs.length, 0);
  assert.ok(fs.existsSync(path.join(j.cwd, 'dark.png')), 'source painting is kept');
});
test('incomplete, changed, oversized and malformed results never become saved themes', () => {
  const store = createStudio(temp()), j = ready(store), r = store.result(j.id);
  fs.appendFileSync(path.join(j.cwd, 'theme.json'), '\n');
  assert.throws(() => store.save({ id: j.id, revision: r.revision, dark: webp(), light: webp() }), /changed/);
  assert.throws(() => store.save({ id: j.id, revision: store.result(j.id).revision, dark: Buffer.from('<svg/>').toString('base64'), light: webp() }), /WebP/);
  const huge = png(); huge.writeUInt32BE(9000, 16); fs.writeFileSync(path.join(j.cwd, 'dark.png'), huge);
  assert.throws(() => store.result(j.id), /megapixels/);
  fs.unlinkSync(path.join(j.cwd, 'dark.png')); assert.equal(store.list().jobs[0].ready, false);
  assert.equal(store.list().themes.length, 0);
});
test('art routes have fixed names and cannot follow traversal paths or linked folders', () => {
  const dir = temp(), store = createStudio(dir), j = ready(store);
  for (const [kind, id, mode] of [['jobs', j.id, '../job'], ['jobs', '../../accounts', 'dark'], ['../', j.id, 'dark']]) assert.throws(() => store.asset(kind, id, mode));
  const other = temp(), linked = 'custom-aaaaaaaaaaaaaaaaaaaaaaaa';
  fs.symlinkSync(other, path.join(dir, 'theme-studio', 'jobs', linked), 'junction');
  assert.throws(() => store.job(linked), /links/); assert.throws(() => store.asset('jobs', linked, 'dark'), /links/);
});
test('shared app copies exclude private art workspaces, including helper scripts and notes', () => {
  const dir = temp(), store = createStudio(dir), j = ready(store);
  fs.writeFileSync(path.join(j.cwd, 'notes.md'), 'Private world idea');
  fs.writeFileSync(path.join(j.cwd, 'prepare.js'), 'Private art helper');
  const files = require('../lib/sharecopy').appFiles(dir);
  assert.ok(!files.some(f => f.name.startsWith('theme-studio/')));
});
