// Generates PWA icons (192, 512, maskable 512) as PNG without any dependency.
// Design: dark background, two overlapping discs (red + cyan) forming a white lens.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
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
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function design(size, padding) {
  const c = size / 2;
  const r = size * (0.5 - padding) * 0.62;
  const off = r * 0.45;
  const bg = [17, 19, 24, 255];
  return (x, y) => {
    const dl = Math.hypot(x - (c - off), y - c);
    const dr = Math.hypot(x - (c + off), y - c);
    const inL = dl <= r;
    const inR = dr <= r;
    if (inL && inR) return [245, 245, 245, 255];
    if (inL) return [235, 64, 64, 255];
    if (inR) return [40, 200, 210, 255];
    const outer = Math.hypot(x - c, y - c);
    if (padding === 0 && outer > size * 0.48) return [0, 0, 0, 0];
    return bg;
  };
}

writeFileSync(join(out, 'icon-192.png'), png(192, design(192, 0)));
writeFileSync(join(out, 'icon-512.png'), png(512, design(512, 0)));
writeFileSync(join(out, 'maskable-512.png'), png(512, design(512, 0.1)));
console.log('icons written to', out);
