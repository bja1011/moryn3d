import * as THREE from 'three';
import { forEachLine } from './geojson.js';

/**
 * Builds road ribbons draped over the terrain.
 *
 * Each LineString is densified to half a terrain cell so the strip follows
 * every bend of the surface, offset sideways by half the road width (with
 * mitred joints), and each side is sampled separately so roads tilt with
 * cross-slopes. Z-fighting is avoided three ways: a small lift above the
 * surface, a per-class height step so major roads win at junctions, and
 * polygonOffset on the material.
 *
 * All roads go into a single indexed BufferGeometry: one draw call.
 */
export function createRoads(features, { terrain, projector, config }) {
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const step = terrain.cell * config.sampleStep;
  let count = 0;

  for (const feature of features) {
    const props = feature.properties ?? {};
    if (props.tunnel && props.tunnel !== 'no') continue;
    if (props.area === 'yes') continue;

    const style = config.styles[props.highway] ?? config.styles.default;
    color.set(style.color);
    const lift = config.lift + style.rank * 0.04;

    forEachLine(feature.geometry, (coords) => {
      const projected = coords.map(([lon, lat]) => projector.toLocal(lon, lat));
      for (const run of splitInside(densify(projected, step), terrain)) {
        if (run.length < 2) continue;
        appendRibbon(run, style.width / 2, lift);
        count++;
      }
    });
  }

  function appendRibbon(pts, halfWidth, lift) {
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [nx, nz, miter] = jointNormal(pts, i);
      const off = halfWidth * miter;
      const lx = pts[i][0] + nx * off;
      const lz = pts[i][1] + nz * off;
      const rx = pts[i][0] - nx * off;
      const rz = pts[i][1] - nz * off;
      positions.push(lx, terrain.heightAt(lx, lz) + lift, lz, rx, terrain.heightAt(rx, rz) + lift, rz);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (i > 0) {
        const l0 = base + (i - 1) * 2;
        const r0 = l0 + 1;
        const l1 = l0 + 2;
        const r1 = l0 + 3;
        indices.push(l0, r0, l1, r0, r1, l1); // counter-clockwise seen from above
      }
    }
  }

  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'roads';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return { mesh, count };
}

/** Inserts points so no segment is longer than `step`. */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    const n = Math.ceil(len / step);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Splits a polyline into the runs that lie on the terrain. */
function splitInside(pts, terrain) {
  const runs = [];
  let current = [];
  for (const p of pts) {
    if (terrain.contains(p[0], p[1])) current.push(p);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/**
 * Unit normal (pointing left of travel) at vertex i, plus the miter length
 * factor that keeps the ribbon width constant around bends (capped at 3×).
 */
function jointNormal(pts, i) {
  const prev = pts[Math.max(i - 1, 0)];
  const next = pts[Math.min(i + 1, pts.length - 1)];
  const cur = pts[i];

  const d1 = normalize(cur[0] - prev[0], cur[1] - prev[1]);
  const d2 = normalize(next[0] - cur[0], next[1] - cur[1]);
  const first = i === 0 ? d2 : d1;
  const second = i === pts.length - 1 ? d1 : d2;

  const [tx, tz] = normalize(first[0] + second[0], first[1] + second[1]);
  const nx = tz; // left of (tx, tz) in the scene frame (x east, z south)
  const nz = -tx;
  const segNx = first[1];
  const segNz = -first[0];
  const cos = nx * segNx + nz * segNz;
  return [nx, nz, 1 / Math.max(cos, 1 / 3)];
}

function normalize(x, z) {
  const len = Math.hypot(x, z) || 1;
  return [x / len, z / len];
}
