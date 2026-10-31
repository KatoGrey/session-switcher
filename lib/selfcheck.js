'use strict';
// What failed in a run of tests/run.js, for the nightly self-check: by suite ("— suite" heads the lines under it), each
// failure once. Node lists a failing test twice, under a heading of its own, and adds how long it took: without that a
// test failing every night was a new problem every night.
function readFailures(out) {
  const failures = new Set();
  let suite = '';
  for (const line of String(out || '').split(/\r?\n/)) {
    const h = line.match(/^— (.+)/);
    if (h) { suite = h[1]; continue; }
    const f = line.match(/^\s*✖\s+(.+)/);
    if (f && !/^failing tests:?\s*$/.test(f[1])) failures.add(`${suite ? `${suite}: ` : ''}${f[1].replace(/\s+\(\d+(?:\.\d+)?ms\)\s*$/, '')}`.slice(0, 400));
    if (/^not ok \d+ - /.test(line.trim())) failures.add(line.trim().replace(/^not ok \d+ - /, 'logic: ').slice(0, 400));
  }
  return [...failures];
}

module.exports = { readFailures };
