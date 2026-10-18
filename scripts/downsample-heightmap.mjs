#!/usr/bin/env node
/**
 * Shrinks the 16-bit heightmap PNG for the web.
 *
 *   node scripts/downsample-heightmap.mjs <input.png> <output.png> [--size 1025] [--step 1]
 *
 * --size  output edge length in pixels. Use 2^n + 1 so the grid lines up with
 *         the terrain mesh (513 = one pixel per vertex at segments: 512,
 *         1025 = 2× headroom for denser meshes).
 * --step  round values to multiples of this (1 = lossless 16-bit, 10 ≈ 1 cm
 *         for the 30–96 m range). Coarser values compress much better.
 *
 * Values are averaged, never rescaled, so the 0..65535 → minHeight..maxHeight
 * mapping in src/config.js stays valid. Corner pixels map to corner pixels,
 * so the georeference (centre and size) does not change either.
 *
 * PNG encoding uses per-row adaptive filtering (None/Sub/Up/Average/Paeth,
 * whichever row is smallest) plus zlib level 9, which beats plain encoders on
 * smooth elevation data by a wide margin.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decode } from 'fast-png';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !output) {
  console.error('usage: node scripts/downsample-heightmap.mjs <input.png> <output.png> [--size 1025] [--step 1]');
  process.exit(1);
}
const size = flag('size', 1025);
const step = flag('step', 1);

const png = decode(readFileSync(input));
if (png.depth !== 16 || png.palette) throw new Error('Expected a 16-bit grayscale PNG');
const { width: W, height: H, channels, data } = png;
console.log(`input  ${W}×${H}, ${(readFileSync(input).length / 1e6).toFixed(2)} MB`);

const out = boxResample(data, W, H, channels, size);
if (step > 1) for (let i = 0; i < out.length; i++) out[i] = Math.min(65535, Math.round(out[i] / step) * step);

const encoded = encodePng16(out, size, size);
writeFileSync(output, encoded);
console.log(`output ${size}×${size}, ${(encoded.length / 1e6).toFixed(2)} MB → ${output}`);

/**
 * Averages the source over each output pixel's footprint. Output pixel i sits
 * at source position i·(W−1)/(size−1), so the outer pixels stay on the edges.
 */
function boxResample(src, W, H, channels, n) {
  const dst = new Uint16Array(n * n);
  const sx = (W - 1) / (n - 1);
  const sy = (H - 1) / (n - 1);
  const rx = Math.max(0, Math.floor(sx / 2));
  const ry = Math.max(0, Math.floor(sy / 2));
  for (let iy = 0; iy < n; iy++) {
    const cy = Math.round(iy * sy);
    const y0 = Math.max(0, cy - ry);
    const y1 = Math.min(H - 1, cy + ry);
    for (let ix = 0; ix < n; ix++) {
      const cx = Math.round(ix * sx);
      const x0 = Math.max(0, cx - rx);
      const x1 = Math.min(W - 1, cx + rx);
      let sum = 0;
      for (let y = y0; y <= y1; y++) {
        let i = (y * W + x0) * channels;
        for (let x = x0; x <= x1; x++, i += channels) sum += src[i];
      }
      dst[iy * n + ix] = Math.round(sum / ((y1 - y0 + 1) * (x1 - x0 + 1)));
    }
  }
  return dst;
}

/** Minimal 16-bit grayscale PNG encoder with adaptive per-row filters. */
function encodePng16(values, width, height) {
  const bpp = 2; // bytes per pixel
  const stride = width * bpp;
  const raw = Buffer.alloc(stride * height);
  for (let i = 0; i < values.length; i++) raw.writeUInt16BE(values[i], i * 2); // PNG is big-endian

  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
        const v = (row[i] - predictor) & 0xff;
        candidate[i] = v;
        score += v < 128 ? v : 256 - v; // minimum sum of absolute differences heuristic
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        candidate.copy(best);
      }
    }
    const offset = y * (stride + 1);
    filtered[offset] = bestType;
    best.copy(filtered, offset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 16; // bit depth
  header[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody));
  return Buffer.concat([len, typeAndBody, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
