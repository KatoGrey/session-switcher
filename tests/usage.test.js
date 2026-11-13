'use strict';
// Plan usage (lib/usage.js): what Claude Code's get_usage answer becomes, including a weekly limit of one model's own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../lib/usage');

test('a weekly limit for one model (Fable) comes through with its reset, from Claude Code’s limits list', () => {
  const d = normalize({
    rate_limits_available: true,
    subscription_type: 'max',
    rate_limits: {
      five_hour: null,
      seven_day: { utilization: 77, resets_at: '2026-11-17T05:00:00+00:00' },
      seven_day_opus: null,
      limits: [
        { kind: 'weekly_all', group: 'weekly', percent: 77, resets_at: '2026-11-17T05:00:00+00:00', scope: null },
        { kind: 'weekly_scoped', group: 'weekly', percent: 100, resets_at: '2026-11-17T05:00:00+00:00', scope: { model: { display_name: 'Fable', id: null }, surface: null } },
        { kind: 'weekly_scoped', group: 'weekly', percent: 10, resets_at: null, scope: { model: null, surface: 'cowork' } },
      ],
    },
  });
  assert.deepEqual(d.week, { used: 77, resetsAt: '2026-11-17T05:00:00+00:00' });
  assert.equal(d.fiveHour.unused, true);
  assert.deepEqual(d.models, [{ name: 'Fable', used: 100, resetsAt: '2026-11-17T05:00:00+00:00' }], 'only model limits, not a surface’s');
});

test('older answers still work, and a model named twice is listed once', () => {
  const d = normalize({
    rate_limits_available: true,
    rate_limits: {
      seven_day: { utilization: 5, resets_at: null },
      seven_day_opus: { utilization: 40, resets_at: 'x' },
      model_scoped: [{ display_name: 'Fable', utilization: 20, resets_at: 'y' }],
      limits: [{ kind: 'weekly_scoped', percent: 99, scope: { model: { display_name: 'Fable' } } }],
    },
  });
  assert.deepEqual(d.models.map(m => [m.name, m.used]), [['Opus', 40], ['Fable', 20]]);
  assert.deepEqual(normalize({ rate_limits_available: true }).models, [], 'nothing used at all');
});
