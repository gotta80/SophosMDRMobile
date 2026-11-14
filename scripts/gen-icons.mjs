// Generates the PNG icons (white shield on blue background) with no dependencies: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../web/public/icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

// Shield shape in normalized coordinates [-1,1]: returns the half-width at height y
const shieldHalfWidth = (y) => {
  if (y < -0.62 || y > 0.68) return -1;
  if (y < 0.05) return 0.5; // straight top part
  return 0.5 * Math.sqrt(1 - ((y - 0.05) / 0.63) ** 2) ** 0.9; // rounded tip
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const nx = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const ny = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          if (Math.abs(nx) <= shieldHalfWidth(ny)) cover++;
        }
      const a = cover / (SS * SS);
      const bg = [10, 132, 255];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - a) + 255 * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(resolve(out, name), png(size));
  console.log('creata', name);
}
