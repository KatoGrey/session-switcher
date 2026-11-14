'use strict';
// The five main themes (theme.js PALETTE): text reads well on every surface it sits on, the three model colours
// stay apart (also for the commonest colour blindness), and each theme's accent never looks like a model.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PALETTE, color, ratio } = require('../theme');

const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
// sRGB -> OKLab (Björn Ottosson), for distances.
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function oklab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dist = (a, b) => { const x = oklab(a), y = oklab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
// Colour-blindness simulation (Machado et al. 2009, full severity), in linear RGB.
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const unlin = v => { v = Math.min(1, Math.max(0, v)); return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };
const simulate = (rgb, m) => { const c = rgb.map(lin); return m.map(row => unlin(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])); };

const at = (t, h) => color(h, t, t.light);
const PAGE = '0a090c', CARDS = ['141117', '1a161d'], TEXT = 'ede6d9', TEXT2 = 'cfc6b6', MUTED = '9a928a', META = '716a63';

test('there are eight main themes: two light (Light, Paper), three dark (Dark, Midnight, Sage) and three signature darks', () => {
  assert.deepEqual(PALETTE.map(t => [t.id, t.light, !!t.sig]), [['studio-light', true, false], ['studio-dark', false, false], ['paper', true, false], ['midnight', false, false], ['sage', false, false], ['gold', false, true], ['garnet', false, true], ['crema', false, true]]);
});

test('backgrounds and text are exactly the palette, and every text step reads on its surfaces', () => {
  for (const t of PALETTE) {
    assert.deepEqual(at(t, PAGE), hex(t.pal.surf['0a090c']), `${t.id}: the page is the palette's`);
    assert.deepEqual(at(t, TEXT), hex(t.pal.ink['ede6d9']), `${t.id}: the text is the palette's`);
    for (const bg of [PAGE, ...CARDS]) {
      const s = at(t, bg);
      assert.ok(ratio(at(t, TEXT), s) >= 7, `${t.id}: body text on ${bg} ${ratio(at(t, TEXT), s).toFixed(2)}`);
      assert.ok(ratio(at(t, TEXT2), s) >= 7, `${t.id}: strong secondary on ${bg} ${ratio(at(t, TEXT2), s).toFixed(2)}`);
      assert.ok(ratio(at(t, MUTED), s) >= 4.5, `${t.id}: secondary on ${bg} ${ratio(at(t, MUTED), s).toFixed(2)}`);
      assert.ok(ratio(at(t, META), s) >= 4.5, `${t.id}: meta on ${bg} ${ratio(at(t, META), s).toFixed(2)}`);
    }
  }
});

test('model names read on the page and on cards in every main theme', () => {
  for (const t of PALETTE) for (const who of ['claudeInk', 'codexInk', 'geminiInk']) for (const bg of [PAGE, ...CARDS]) {
    const r = ratio(hex(t.pal.vars[who]), at(t, bg));
    assert.ok(r >= 4.5, `${t.id}: ${who} on ${bg} ${r.toFixed(2)}`);
  }
});

test('Claude, Codex and Gemini stay apart, in normal vision and with protanopia or deuteranopia', () => {
  for (const t of PALETTE) {
    const c = ['claude', 'codex', 'gemini'].map(k => hex(t.pal.vars[k]));
    for (const [name, sim] of [['normal', x => x], ['protan', x => simulate(x, MACHADO.protan)], ['deutan', x => simulate(x, MACHADO.deutan)]]) {
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const d = dist(sim(c[i]), sim(c[j]));
        assert.ok(d >= 0.08, `${t.id} (${name}): models ${i} and ${j} only ${d.toFixed(3)} apart`);
      }
    }
  }
});

test('each theme’s accent (focus, work in progress) is not any model’s colour', () => {
  for (const t of PALETTE) for (const k of ['claude', 'codex', 'gemini']) {
    const d = dist(hex(t.pal.vars.focus), hex(t.pal.vars[k]));
    assert.ok(d >= 0.1, `${t.id}: focus vs ${k} only ${d.toFixed(3)} apart`);
  }
});

test('Claude takes the place of the old crimson; Codex turns graphite', () => {
  for (const t of PALETTE) {
    const [r, g, b] = at(t, 'a5463f');
    assert.ok(r > g && r > b && r - b > 40, `${t.id}: the accent family is warm clay (${r},${g},${b})`);
    const cx = at(t, '6f97d8'), spread = Math.max(...cx) - Math.min(...cx);
    assert.ok(spread < 40, `${t.id}: Codex's old blue is now near-neutral (${cx})`);
  }
});

test('errors have their own colour in every main theme: readable, and not Claude’s', () => {
  for (const t of PALETTE) {
    const v = t.pal.vars;
    assert.ok(v.error && v.errorInk && v.errorSoft, `${t.id}: error colours set`);
    for (const bg of [PAGE, ...CARDS]) { const r = ratio(hex(v.errorInk), at(t, bg)); assert.ok(r >= 4.5, `${t.id}: error text on ${bg} ${r.toFixed(2)}`); }
    const d = dist(hex(v.error), hex(v.claude));
    assert.ok(d >= 0.1, `${t.id}: error vs Claude only ${d.toFixed(3)} apart`);
  }
});

test('“Needs your OK” never looks like the theme’s accent (Gold and Garnet split their gold)', () => {
  for (const t of PALETTE) {
    const needs = t.pal.vars.needs ? hex(t.pal.vars.needs) : at(t, 'd9bf74');
    const d = dist(needs, hex(t.pal.vars.focus));
    assert.ok(d >= 0.1, `${t.id}: needs-you vs accent only ${d.toFixed(3)} apart`);
    if (t.pal.vars.needs) assert.ok(dist(needs, at(t, 'd9bf74')) < 0.03, `${t.id}: its needs colour is what the seeds give`);
  }
});
