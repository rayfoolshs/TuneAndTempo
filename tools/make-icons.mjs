/* Generates the three PWA icons as PNGs with no dependencies.
   Run: node tools/make-icons.mjs */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;
  const cx = 0.5 * S;
  const hubY = 0.625 * S;
  const ringR = 0.30 * S;
  const ringW = 0.042 * S;
  const needleHalf = 0.022 * S;
  const hubR = 0.052 * S;

  const bgTop = hexToRgb('#11161d');
  const bgBottom = hexToRgb('#0a0c10');
  const accent = hexToRgb('#34d399');
  const ink = hexToRgb('#eef1f5');

  // needle end: tilted right, up from the hub
  const nx1 = cx;
  const ny1 = hubY - 0.02 * S;
  const nx2 = cx + 0.135 * S;
  const ny2 = 0.30 * S;

  const segDist = (x, y) => {
    const dx = nx2 - nx1;
    const dy = ny2 - ny1;
    const len2 = dx * dx + dy * dy;
    let t = ((x - nx1) * dx + (y - ny1) * dy) / len2;
    t = clamp(t, 0, 1);
    const px1 = nx1 + dx * t;
    const py1 = ny1 + dy * t;
    return Math.hypot(x - px1, y - py1);
  };

  for (let y = 0; y < S; y++) {
    const g = y / (S - 1);
    const bg = [
      Math.round(bgTop[0] + (bgBottom[0] - bgTop[0]) * g),
      Math.round(bgTop[1] + (bgBottom[1] - bgTop[1]) * g),
      Math.round(bgTop[2] + (bgBottom[2] - bgTop[2]) * g)
    ];

    for (let x = 0; x < S; x++) {
      let r = bg[0], gg = bg[1], b = bg[2];

      const dx = x - cx;
      const dy = y - hubY;
      const dist = Math.hypot(dx, dy);

      // upper arc only, so it reads as a tuner gauge
      if (y <= hubY + 0.5) {
        const ringA = smooth(ringW * 0.5 + 0.8, ringW * 0.5 - 0.8, Math.abs(dist - ringR));
        if (ringA > 0) {
          const glow = smooth(ringR + ringW, ringR, dist) * 0.10;
          r = r + (accent[0] - r) * ringA;
          gg = gg + (accent[1] - gg) * ringA;
          b = b + (accent[2] - b) * ringA;
          if (glow > 0) {
            r = r + (accent[0] - r) * glow;
            gg = gg + (accent[1] - gg) * glow;
            b = b + (accent[2] - b) * glow;
          }
        }
      }

      const hubA = smooth(hubR + 0.8, hubR - 0.8, dist);
      if (hubA > 0) {
        r = r + (ink[0] - r) * hubA;
        gg = gg + (ink[1] - gg) * hubA;
        b = b + (ink[2] - b) * hubA;
      }

      const needA = smooth(needleHalf + 0.8, needleHalf - 0.8, segDist(x, y));
      if (needA > 0) {
        r = r + (ink[0] - r) * needA;
        gg = gg + (ink[1] - gg) * needA;
        b = b + (ink[2] - b) * needA;
      }

      // subtle vignette
      const v = 1 - smooth(0.4, 0.95, Math.hypot(dx / S, (y - S / 2) / S)) * 0.35;
      r *= v; gg *= v; b *= v;

      const i = (y * S + x) * 4;
      px[i] = clamp(Math.round(r), 0, 255);
      px[i + 1] = clamp(Math.round(gg), 0, 255);
      px[i + 2] = clamp(Math.round(b), 0, 255);
      px[i + 3] = 255;
    }
  }

  return encodePNG(S, px);
}

for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, draw(size));
  console.log('wrote', file);
}
