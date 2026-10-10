// Switcher Lite's housekeeping on real (throwaway) git repos, and web push encryption.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const lite = require('../lib/lite');
const { createLiteOps, worktreeOf, freeTargets } = require('../lib/lite-ops');
const webpush = require('../lib/webpush');

const sh = (cwd, ...args) => cp.execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const write = (p, s = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A repo with a worktree holding: ignored node_modules (and a nested one), ignored .next, a committed
// build/ folder, source, and a link to a folder outside.
function makeRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-wt-')));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, '.gitignore'), 'node_modules/\n.next/\n');
  write(path.join(repo, 'src/app.js'), 'code');
  write(path.join(repo, 'build/keep.txt'), 'committed build output');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', 'init');
  const wt = path.join(base, 'wt-feature');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
  write(path.join(wt, 'node_modules/pkg/index.js'), 'dep');
  write(path.join(wt, 'apps/web/node_modules/x.js'), 'dep');
  write(path.join(wt, '.next/cache.bin'), 'cache');
  const outside = path.join(base, 'outside');
  write(path.join(outside, 'precious.txt'), 'never delete');
  fs.symlinkSync(outside, path.join(wt, 'dist'));
  return { base, repo, wt, outside };
}

test('Free space removes ignored dependencies and build output only', async () => {
  const { repo, wt, outside } = makeRepo();
  assert.equal(await worktreeOf(repo), null, 'the main checkout is never treated as a worktree');
  const w = await worktreeOf(wt);
  assert.ok(w && w.branch === 'feature');
  const { targets } = await freeTargets(wt);
  assert.deepEqual(targets.sort(), ['.next', 'apps/web/node_modules', 'node_modules'].sort(), 'not the committed build/, not the dist link');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const ops = createLiteOps({ dataDir: dir, store: lite.createLite({ dataDir: dir }) });
  const [r] = await ops.freeSpace([wt]);
  assert.deepEqual(r.removed.sort(), targets.sort());
  assert.ok(!fs.existsSync(path.join(wt, 'node_modules')) && !fs.existsSync(path.join(wt, '.next')));
  assert.ok(fs.existsSync(path.join(wt, 'src/app.js')), 'code stays');
  assert.ok(fs.existsSync(path.join(wt, 'build/keep.txt')), 'a committed build folder stays');
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')), 'nothing through a link');
  const [again] = await ops.freeSpace([path.join(repo)]);
  assert.match(again.skipped, /Not a git worktree/, 'the main checkout is refused');
});

test('Remove worktree: archived chats only, never with uncommitted changes; the branch stays; rebuild brings it back', async () => {
  const { repo, wt } = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lite-data-'));
  const st = lite.createLite({ dataDir: dir });
  const ops = createLiteOps({ dataDir: dir, store: st });
  await assert.rejects(ops.removeWorktree('c1', wt), /Archive the chat first/);
  st.archive({ chats: ['c1'], records: { c1: { title: 'A chat', worktree: wt } } });
  write(path.join(wt, 'src/new.js'), 'uncommitted');
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/);
  assert.ok(fs.existsSync(wt));
  fs.rmSync(path.join(wt, 'src/new.js'));
  await assert.rejects(ops.removeWorktree('c1', wt), /uncommitted/, 'an untracked link counts too');
  fs.unlinkSync(path.join(wt, 'dist'));
  const r = await ops.removeWorktree('c1', wt);
  assert.equal(r.branch, 'feature');
  assert.ok(!fs.existsSync(wt));
  assert.match(sh(repo, 'branch', '--list', 'feature'), /feature/, 'the branch stays');
  assert.equal(st.get().archived.chats.c1.worktreeRemoved, true);
  const b = await ops.rebuildWorktree('c1');
  assert.ok(b.ok && fs.existsSync(path.join(wt, 'src/app.js')), 'rebuilt from the branch');
});

test('web push: the payload decrypts on the phone’s side (RFC 8291), and VAPID is signed', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: webpush.b64u(ua.getPublicKey()), auth: webpush.b64u(auth) } };
  const body = webpush.encrypt(JSON.stringify({ title: 'Needs you', body: 'npm test' }), sub);
  assert.deepEqual(JSON.parse(webpush.decrypt(body, ua.getPrivateKey(), auth)), { title: 'Needs you', body: 'npm test' });
  const keys = webpush.makeVapidKeys();
  const h = webpush.vapidHeader(sub.endpoint, keys);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.equal(JSON.parse(webpush.unb64u(m[2]).toString()).aud, 'https://push.example');
  const raw = webpush.unb64u(keys.publicKey);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: webpush.b64u(raw.subarray(1, 33)), y: webpush.b64u(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, webpush.unb64u(m[3])), 'signature verifies with the public key the page gets');
});

test('web push: what reaches the push service', async () => {
  let got = null;
  const srv = http.createServer((req, res) => { let b = []; req.on('data', d => b.push(d)); req.on('end', () => { got = { headers: req.headers, body: Buffer.concat(b) }; res.writeHead(201); res.end(); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: `http://127.0.0.1:${srv.address().port}/push/1`, keys: { p256dh: webpush.b64u(ua.getPublicKey()), auth: webpush.b64u(auth) } };
  const r = await webpush.send(sub, { title: 'hi' }, webpush.makeVapidKeys(), { urgency: 'high', topic: 'needs-1' });
  srv.close();
  assert.equal(r.status, 201);
  assert.equal(got.headers['content-encoding'], 'aes128gcm');
  assert.equal(got.headers.urgency, 'high');
  assert.match(got.headers.authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(webpush.decrypt(got.body, ua.getPrivateKey(), auth)), { title: 'hi' });
});
