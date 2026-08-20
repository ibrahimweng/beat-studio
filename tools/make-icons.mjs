/**
 * Draw the Beat Studio icon into the PNG files the site needs.
 *
 * The mark is four bars on a dark tile, the same shape as the logo in the
 * left rail. `public/favicon.svg` is the master, and this file holds the same
 * geometry so the raster versions cannot drift away from it. Run it after
 * changing either one:
 *
 *   node tools/make-icons.mjs
 *
 * It writes favicon.ico, favicon-96.png and apple-touch-icon.png into
 * `public/`. Everything is drawn here rather than by a library, because the
 * whole picture is five rounded rectangles.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** The design grid. Every measurement below is in these units. */
const GRID = 32;

const TILE = '#0b0b0c';
const EDGE = '#2c2f36';
const ACCENT = '#0c8ce9';
const GREY = '#9a9ca1';

/** The four bars: x, y, width, height, corner radius, colour. */
const BARS = [
  [4, 17, 4, 10, 1.4, ACCENT],
  [10.667, 5, 4, 22, 1.4, ACCENT],
  [17.333, 12, 4, 15, 1.4, ACCENT],
  [24, 20, 4, 7, 1.4, GREY],
];

/** Samples per pixel per axis. Four is enough to hide the stair steps. */
const SUB = 4;

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Is a point inside a rounded rectangle? */
function inside(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  // The cross through the middle is a plain rectangle test; only the four
  // corner squares need the circle.
  const cx = Math.min(Math.max(px, x + radius), x + w - radius);
  const cy = Math.min(Math.max(py, y + radius), y + h - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Paint a rounded rectangle over an RGBA buffer, with the edges softened by
 * supersampling. `shape` is in grid units and `scale` turns those into pixels.
 */
function fill(buf, size, scale, shape, hex) {
  const [x, y, w, h, r] = shape;
  const [cr, cg, cb] = rgb(hex);
  const step = 1 / (SUB * scale);
  const start = step / 2;

  const x0 = Math.max(0, Math.floor(x * scale));
  const y0 = Math.max(0, Math.floor(y * scale));
  const x1 = Math.min(size, Math.ceil((x + w) * scale));
  const y1 = Math.min(size, Math.ceil((y + h) * scale));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const gx = px / scale + start + sx * step;
          const gy = py / scale + start + sy * step;
          if (inside(gx, gy, x, y, w, h, r)) hits++;
        }
      }
      if (!hits) continue;

      const a = hits / (SUB * SUB);
      const i = (py * size + px) * 4;
      const back = buf[i + 3] / 255;
      const out = a + back * (1 - a);
      // Source-over, keeping the colours straight rather than premultiplied.
      for (let c = 0; c < 3; c++) {
        const src = [cr, cg, cb][c];
        buf[i + c] = Math.round((src * a + buf[i + c] * back * (1 - a)) / out);
      }
      buf[i + 3] = Math.round(out * 255);
    }
  }
}

/**
 * Draw the icon at `size` pixels.
 *
 * `rounded` is false for the home screen icon, where the platform applies its
 * own corners and a rounded tile would be clipped twice.
 */
function draw(size, { rounded = true, inset = 0 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / GRID;

  if (rounded) {
    fill(buf, size, scale, [0, 0, GRID, GRID, 7], TILE);
    // The edge is the gap between two rounded rectangles, one inside the other.
    fill(buf, size, scale, [0, 0, GRID, GRID, 7], EDGE);
    fill(buf, size, scale, [1, 1, GRID - 2, GRID - 2, 6], TILE);
  } else {
    fill(buf, size, scale, [0, 0, GRID, GRID, 0], TILE);
  }

  // `inset` shrinks the mark towards the middle, which the home screen icon
  // wants so the bars are not cut off by the platform's rounding.
  const k = 1 - inset * 2;
  const shift = (GRID * inset) / 1;
  for (const [x, y, w, h, r, hex] of BARS) {
    fill(buf, size, scale, [x * k + shift, y * k + shift, w * k, h * k, r * k], hex);
  }

  return buf;
}

// ---------- PNG ----------

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png(buf, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // Each row is prefixed with a filter byte; 0 means the bytes are stored raw.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    buf.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO ----------

/** An icon file holding PNGs, which every browser still asking for one reads. */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // an icon rather than a cursor
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header[entry] = size >= 256 ? 0 : size; // 0 stands for 256
    header[entry + 1] = size >= 256 ? 0 : size;
    header[entry + 2] = 0; // colours in the palette
    header[entry + 3] = 0; // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

// ---------- write ----------

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const icoSizes = [16, 32, 48];
writeFileSync(
  join(out, 'favicon.ico'),
  ico(icoSizes.map((size) => ({ size, data: png(draw(size), size) }))),
);

// A large PNG for anything that prefers one, such as a browser tab on a
// high density screen or a bookmark tile.
writeFileSync(join(out, 'favicon-96.png'), png(draw(96), 96));

// The home screen icon, drawn square and with the mark pulled in.
writeFileSync(
  join(out, 'apple-touch-icon.png'),
  png(draw(180, { rounded: false, inset: 0.09 }), 180),
);

console.log('Wrote favicon.ico, favicon-96.png and apple-touch-icon.png into public/');
