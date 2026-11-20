// Marketplace 用アイコン (media/icon.png, 256x256) を生成する: node scripts/make-icon.js
// 依存なし。4x4 スーパーサンプリングでアンチエイリアス
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256;
const SS = 4;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  bg: hex('#161b26'),
  track: hex('#2c3445'),
  green: hex('#3fb950'),
  yellow: hex('#d29922'),
  red: hex('#f85149'),
  needle: hex('#e6edf3'),
};
const CX = 128;
const CY = 140;
const FILL = 0.72;

function roundedRect(x, y, r) {
  const dx = Math.max(r - x, 0, x - (W - r));
  const dy = Math.max(r - y, 0, y - (W - r));
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// ゲージは左下 (135°) から時計回りに 270° 回って右下 (45°) まで
const START = 135;
const SWEEP = 270;
const needleAngle = ((START + SWEEP * FILL) * Math.PI) / 180;
const NX = CX + Math.cos(needleAngle) * 64;
const NY = CY + Math.sin(needleAngle) * 64;

function sample(x, y) {
  if (!roundedRect(x, y, 52)) return null;
  let col = C.bg;
  const dx = x - CX, dy = y - CY;
  const r = Math.hypot(dx, dy);
  // レーダーの内側の円
  if (Math.abs(r - 44) < 1.6) col = C.track;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const t = (((deg - START) % 360) + 360) % 360 / SWEEP;
  if (r >= 72 && r <= 96 && t <= 1) {
    if (t <= FILL) col = t < 0.55 ? C.green : t < 0.8 ? C.yellow : C.red;
    else col = C.track;
  }
  if (distToSegment(x, y, CX, CY, NX, NY) <= 5) col = C.needle;
  if (r <= 13) col = C.needle;
  return col;
}

const raw = Buffer.alloc((W * 4 + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    let rs = 0, gs = 0, bs = 0, as = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) {
          rs += c[0]; gs += c[1]; bs += c[2]; as += 255;
        }
      }
    }
    const n = SS * SS;
    const cover = as / 255;
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = cover ? Math.round(rs / cover) : 0;
    raw[o + 1] = cover ? Math.round(gs / cover) : 0;
    raw[o + 2] = cover ? Math.round(bs / cover) : 0;
    raw[o + 3] = Math.round(as / n);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
