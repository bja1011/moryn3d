/**
 * Web Worker: downloads and decodes the 16-bit heightmap PNG, then resamples
 * it onto the terrain vertex grid.
 *
 * Browsers decode PNGs to 8 bits per channel when drawn to a canvas, which
 * would quantise 66 m of relief into 26 cm steps. fast-png keeps the full
 * 16 bits (~1 mm precision). Decoding runs here so a larger source (e.g. the
 * full 4033² original) never blocks the main thread.
 */
import { decode } from 'fast-png';

self.onmessage = async ({ data }) => {
  const { url, segments, minHeight, maxHeight } = data;
  try {
    const buffer = await fetchWithProgress(url, (value) =>
      self.postMessage({ type: 'progress', stage: 'download', value }),
    );
    self.postMessage({ type: 'progress', stage: 'decode', value: 0 });

    const png = decode(new Uint8Array(buffer));
    if (png.palette) throw new Error('Indexed-colour PNGs are not supported as heightmaps');

    self.postMessage({ type: 'progress', stage: 'resample', value: 0 });
    const heights = resample(png, segments, minHeight, maxHeight);

    self.postMessage(
      { type: 'done', heights, size: segments + 1, sourceSize: [png.width, png.height] },
      [heights.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message ?? String(err) });
  }
};

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Heightmap request failed: ${response.status} ${url}`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) return response.arrayBuffer();

  // Chunks are collected rather than written into a `total`-sized buffer:
  // with Content-Encoding the decoded body can be larger than content-length.
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(received / total, 1));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

/**
 * Box-filters the source image down to an (segments+1)² grid of elevations in
 * metres. Grid corners land exactly on image corners, so vertex (0,0) is the
 * north-west pixel and vertex (segments, segments) the south-east one.
 */
function resample(png, segments, minHeight, maxHeight) {
  const { width: W, height: H, data, channels } = png;
  const maxValue = 2 ** png.depth - 1;
  const scale = (maxHeight - minHeight) / maxValue;
  const n = segments + 1;
  const out = new Float32Array(n * n);

  // Averaging over the footprint of one grid cell avoids aliasing when
  // reducing ~8 source pixels to one vertex.
  const rx = Math.max(0, Math.floor((W - 1) / segments / 2));
  const ry = Math.max(0, Math.floor((H - 1) / segments / 2));

  for (let iy = 0; iy < n; iy++) {
    const cy = Math.round((iy * (H - 1)) / segments);
    const y0 = Math.max(0, cy - ry);
    const y1 = Math.min(H - 1, cy + ry);
    for (let ix = 0; ix < n; ix++) {
      const cx = Math.round((ix * (W - 1)) / segments);
      const x0 = Math.max(0, cx - rx);
      const x1 = Math.min(W - 1, cx + rx);
      let sum = 0;
      for (let y = y0; y <= y1; y++) {
        let i = (y * W + x0) * channels;
        for (let x = x0; x <= x1; x++, i += channels) sum += data[i];
      }
      const mean = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
      out[iy * n + ix] = minHeight + mean * scale;
    }
  }
  return out;
}
