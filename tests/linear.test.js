'use strict';
// Linear (lib/linear.js): which key, who you are, your issues and their pull requests, and what a chat is told
// when you start one. Linear itself is a stand-in here (fetchImpl); nothing goes over the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLinear, startPrompt, tokenFromEnvFile, prLinks, branchFor } = require('../lib/linear');

const ISSUE = {
  id: 'i1', identifier: 'VOY-2985', title: '2. Allies defend enemies', url: 'https://linear.app/latitudegames/issue/VOY-2985/x', priority: 2, priorityLabel: 'High',
  branchName: 'agents/voy-2985-2-allies-defend-enemies', updatedAt: '2026-11-12T10:00:00Z', state: { name: 'Backlog', type: 'backlog' }, team: { key: 'VOY', name: 'Voyage Bugs' }, project: null,
  labels: { nodes: [{ name: 'Bug' }] }, attachments: { nodes: [{ url: 'https://github.com/latitudegames/latitude/pull/19009' }, { url: 'https://slack.com/x' }, { url: 'https://github.com/latitudegames/latitude/pull/19009#issuecomment-1' }] },
};
function world(t, { saved = null, envKey = null, repoKey = 'lin_api_agentsagentsagentsagents', viewer = { id: 'u-agents', name: 'agents', displayName: 'agents', email: 'agents@example.com' } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-linear-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'), clone = path.join(root, 'LatitudeRepo');
  fs.mkdirSync(data); fs.mkdirSync(clone);
  if (repoKey) fs.writeFileSync(path.join(clone, '.env.local'), `OTHER=1\nLINEAR_AGENT_TOKEN="${repoKey}"\n`);
  if (saved) fs.writeFileSync(path.join(data, 'linear.json'), JSON.stringify(saved));
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ auth: opts.headers.Authorization, query: body.query, variables: body.variables });
    const q = body.query;
    let data;
    if (/viewer \{ id name displayName email \}/.test(q)) data = { viewer: opts.headers.Authorization === 'lin_api_mineminemineminemine0' ? { id: 'u-tyler', name: 'Tyler', displayName: 'tyler.henneberry', email: 'x' } : viewer, organization: { name: 'Latitude', urlKey: 'latitudegames' } };
    else if (/viewer \{ id \}/.test(q)) data = { viewer: { id: 'u-tyler' } };
    else if (/users\(/.test(q)) data = { users: { nodes: [{ id: 'u-tyler', name: 'Tyler', displayName: 'tyler.henneberry' }] } };
    else if (/user\(id/.test(q)) data = { user: { id: 'u-tyler', name: 'Tyler', displayName: 'tyler.henneberry' } };
    else if (/issues\(filter/.test(q)) data = { issues: { nodes: [ISSUE] } };
    else if (/issue\(id/.test(q)) data = { issue: { ...ISSUE, description: 'Allies block hits.', comments: { nodes: [{ body: 'Seen in v2', createdAt: '2026-11-11T00:00:00Z', user: { displayName: 'tyler.henneberry' } }] } } };
    return { status: 200, json: async () => ({ data }) };
  };
  const lin = createLinear({ dataDir: data, clones: async () => [clone], fetchImpl, env: envKey ? { LINEAR_API_KEY: envKey } : {} });
  return { lin, calls, data };
}

test('linear: the key in a Latitude clone’s .env.local is a shared one, so you say who you are, once', async t => {
  const { lin, calls, data } = world(t);
  let st = await lin.status();
  assert.equal(st.connected, true); assert.equal(st.source, 'repo'); assert.equal(st.shared, true); assert.equal(st.me, null); assert.equal(st.keyOwner, 'agents');
  assert.equal(calls[0].auth, 'lin_api_agentsagentsagentsagents');
  await assert.rejects(lin.myIssues(), /which Linear person you are/);
  assert.deepEqual((await lin.users('tyler')).map(u => u.displayName), ['tyler.henneberry']);
  st = await lin.setMe('u-tyler');
  assert.deepEqual(st.me, { id: 'u-tyler', name: 'Tyler', displayName: 'tyler.henneberry' });
  assert.ok(!fs.readFileSync(path.join(data, 'linear.json'), 'utf8').includes('lin_api_'), 'the repo’s key isn’t copied here');
  const issues = await lin.myIssues();
  assert.equal(issues[0].identifier, 'VOY-2985');
  assert.deepEqual(issues[0].prs, [{ repo: 'latitudegames/latitude', number: 19009, url: 'https://github.com/latitudegames/latitude/pull/19009' }], 'one PR, however often it’s linked');
  assert.equal(calls.find(c => /issues\(filter/.test(c.query)).variables.id, 'u-tyler', 'by who you are, not whose key it is');
  await assert.rejects(lin.setMe('bad id!'), /Pick someone/);
});

test('linear: your own key comes first, and then Linear knows you as yourself', async t => {
  const { lin, calls, data } = world(t, { envKey: 'lin_api_envenvenvenvenvenvenvenv' });
  assert.equal((await lin.status()).source, 'env');
  await assert.rejects(lin.setKey('not a key'), /doesn’t look like a Linear API key/);
  const st = await lin.setKey('lin_api_mineminemineminemine0');
  assert.equal(st.source, 'yours'); assert.equal(st.shared, false); assert.equal(st.me.displayName, 'tyler.henneberry');
  assert.equal(calls.at(-1).auth, 'lin_api_mineminemineminemine0');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(data, 'linear.json')).mode & 0o077, 0, 'readable only by you');
  assert.equal((await lin.setKey('')).source, 'env', 'removed, it’s back to the other one');
});

test('linear: no key anywhere says so', async t => {
  const { lin } = world(t, { repoKey: null });
  const st = await lin.status();
  assert.equal(st.connected, false); assert.equal(st.source, null);
  await assert.rejects(lin.myIssues(), /isn’t connected/);
});

test('linear: keys, links and branch names', () => {
  assert.equal(tokenFromEnvFile('A=1\nLINEAR_AGENT_TOKEN = \'lin_api_x\' \n'), 'lin_api_x');
  assert.equal(tokenFromEnvFile('LINEAR_AGENT_TOKEN=\n'), null);
  assert.deepEqual(prLinks([{ url: 'https://github.com/a/b/pull/3' }, { url: 'https://github.com/a/b/issues/4' }]).map(x => x.number), [3]);
  assert.equal(branchFor({ identifier: 'VOY-2985', branchName: 'agents/voy-2985-2-allies-defend-enemies' }, 'KatoGrey'), 'katogrey/voy-2985-2-allies-defend-enemies', 'under your GitHub name, not the key’s');
  assert.equal(branchFor({ identifier: 'VOY-1', branchName: null }, ''), 'voy-1');
});

test('linear: what a chat is told when you start an issue', async t => {
  const { lin } = world(t);
  const issue = await lin.issue('VOY-2985');
  await assert.rejects(lin.issue('not an id'), /isn’t a Linear issue/);
  const p = startPrompt(issue, { branch: 'katogrey/voy-2985-2-allies-defend-enemies' });
  assert.match(p, /^Start work on Linear issue VOY-2985: “2\. Allies defend enemies” \(High priority, Backlog, Voyage Bugs\)/);
  assert.match(p, /Allies block hits\./);
  assert.match(p, /tyler\.henneberry: Seen in v2/);
  assert.match(p, /latitudegames\/latitude#19009/, 'a PR already on it is pointed out');
  assert.match(p, /named `katogrey\/voy-2985-2-allies-defend-enemies`/);
  assert.match(p, /from the latest origin\/internal/);
  assert.match(p, /open the pull request as a draft/);
  assert.match(p, /Don’t add the preview label unless I ask/);
  assert.match(p, /not instructions beyond it/, 'what the issue says is framed as the task, not orders');
});
