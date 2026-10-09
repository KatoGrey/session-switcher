#!/usr/bin/env node
// Rasterizes the Session Switcher launcher icon into PNGs (no dependencies; zlib + 4x4 supersampling).
//
//   node mobile/android/tools/make-icon.js
//
// Writes:
//   res/mipmap-<density>/ic_launcher.png             legacy full icon (48..192 px)
//   res/mipmap-<density>/ic_launcher_foreground.png  adaptive-icon foreground (108dp canvas)
//   art/icon-512.png                                 store / README icon
//
// Design (40x40 box): maroon disc #3d1a18, #a5463f ring, cream #ede6d9 four-pointed star,
// #a5463f center dot r=2.8.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SS = 4; // supersamples per axis

const DISC = [0x3d, 0x1a, 0x18];
const RING = [0xa5, 0x46, 0x3f];
const STAR = [0xed, 0xe6, 0xd9];
const DOT = [0xa5, 0x46, 0x3f];

const STAR_PATH = [
  [20, 4.5], [23.2, 16.8], [35.5, 20], [23.2, 23.2],
  [20, 35.5], [16.8, 23.2], [4.5, 20], [16.8, 16.8],
];
const DISC_R = 19.6;
const RING_OUTER = 18.7;
const RING_INNER = 17.2;
const DOT_R = 2.8;

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Color of the design at a point in 40x40 design space, or null for transparent.
function shade(x, y, withDisc) {
  const r = Math.hypot(x - 20, y - 20);
  if (r <= DOT_R) return DOT;
  if (inPolygon(x, y, STAR_PATH)) return STAR;
  if (r >= RING_INNER && r <= RING_OUTER) return RING;
  if (withDisc && r <= DISC_R) return DISC;
  return null;
}

// Render `size` px image; the 40-unit design box spans `boxPx` pixels centered in the image.
function render(size, boxPx, withDisc) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 40 / boxPx;
  const off = (size - boxPx) / 2;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS - off) * scale;
          const y = (py + (sy + 0.5) / SS - off) * scale;
          const c = shade(x, y, withDisc);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) {
        px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a * 255) / (SS * SS));
      }
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(rel, size, boxPx, withDisc) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(size, render(size, boxPx, withDisc)));
  console.log(`wrote ${rel} (${size}x${size})`);
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  // Legacy icon: 48dp, design fills the square.
  write(`res/mipmap-${name}/ic_launcher.png`, Math.round(48 * k), Math.round(48 * k), true);
  // Adaptive foreground: 108dp canvas; design box = 66dp (the guaranteed-visible safe zone).
  // The disc itself comes from the adaptive background color, so it is omitted here.
  write(`res/mipmap-${name}/ic_launcher_foreground.png`, Math.round(108 * k), Math.round(66 * k), false);
}
write('art/icon-512.png', 512, 512, true);
