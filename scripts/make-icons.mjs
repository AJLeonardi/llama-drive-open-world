// Generates the app icons (public/icon-*.png) with no image tools: a tiny
// rasterizer + PNG encoder. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Shape test in unit coordinates (0..1), returns [r,g,b].
function shade(x, y) {
  // Burst star behind the car
  const dx = x - 0.5, dy = y - 0.46;
  const ang = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
  const star = 0.3 + 0.08 * Math.cos(ang * 9);
  let col = [27 + 40 * y, 36 + 30 * y, 51 + 60 * y]; // dark blue gradient
  if (r < star) col = [255, 170 - r * 200, 40];
  if (r < star * 0.6) col = [255, 220, 80];
  // Car body (white Bronco-ish box) and black top
  const inBody = x > 0.17 && x < 0.83 && y > 0.5 && y < 0.66;
  const inCab = x > 0.3 && x < 0.72 && y > 0.37 && y < 0.51;
  if (inCab) col = x > 0.36 && x < 0.66 && y > 0.4 ? [60, 90, 120] : [25, 25, 28];
  if (inBody) col = [245, 245, 245];
  for (const wx of [0.31, 0.69]) {
    const wr = Math.hypot(x - wx, y - 0.67);
    if (wr < 0.095) col = wr < 0.045 ? [150, 150, 155] : [20, 20, 22];
  }
  return col;
}

function makePng(size) {
  const ss = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          for (let i = 0; i < 3; i++) acc[i] += c[i];
        }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.max(0, Math.min(255, Math.round(acc[i] / (ss * ss))));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), makePng(s));
console.log('icons written');
