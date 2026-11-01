'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { ownText } = require('../lib/shared');

test('shared context: tag-like user text cannot trap the server in the prefix-removal loop', () => {
  // Run the malformed inputs outside this process: the regression blocks the event loop, so an
  // ordinary test timeout would not get a chance to fire.
  const values = ['<other-chatbot>please keep this', '<other-chat', '<other-chat id="unfinished', '  <other-chatty>hello'];
  const script = `const { ownText } = require(${JSON.stringify(require.resolve('../lib/shared'))}); process.stdout.write(JSON.stringify(${JSON.stringify(values)}.map(ownText)));`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.equal(result.error, undefined, 'extracting ordinary text must finish without blocking the app');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), values);
});

test('shared context: valid references are removed, including a cut-off preview, while the request stays', () => {
  assert.equal(ownText('<shared-context items="1">Earlier reply</shared-context>\n\n<other-chat id="one">First</other-chat>\n<other-chat id="two">Second</other-chat>\nPlease use these.'), 'Please use these.');
  assert.equal(ownText('<other-chat id="one">Only a preview'), '');
  assert.equal(ownText('<other-chat id="one">Earlier reply</other-chat>\n<other-chatbot>This is my request.'), '<other-chatbot>This is my request.');
  assert.equal(ownText('Explain <other-chat> tags in this sentence.'), 'Explain <other-chat> tags in this sentence.');
});
