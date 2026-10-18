import * as THREE from 'three';

/**
 * Pitched-roof geometry for (near-)rectangular building footprints.
 *
 * The roof is built on the footprint's minimum-area bounding rectangle: the
 * ridge runs along the long side (or across it, for `roof:orientation=across`),
 * the eaves overhang the walls, and the slopes have a thin underside so the
 * overhang doesn't look paper-thin from street level.
 */

/**
 * Minimum-area bounding rectangle of a ring of [x, z] points. One side of the
 * optimal rectangle is collinear with a footprint edge, so testing every edge
 * direction is enough (footprints have few vertices).
 * @returns {{cx, cz, ux, uz, vx, vz, halfLong, halfShort, area}} u = long axis
 */
export function minAreaRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) continue;
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    const vx = -uz;
    const vz = ux;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ux + z * uz;
      const b = x * vx + z * vz;
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
    const area = (maxA - minA) * (maxB - minB);
    if (!best || area < best.area) {
      const a0 = (minA + maxA) / 2;
      const b0 = (minB + maxB) / 2;
      best = {
        cx: ux * a0 + vx * b0,
        cz: uz * a0 + vz * b0,
        ux, uz, vx, vz,
        halfA: (maxA - minA) / 2,
        halfB: (maxB - minB) / 2,
        area,
      };
    }
  }
  if (!best) return null;

  const long = best.halfA >= best.halfB;
  return {
    cx: best.cx,
    cz: best.cz,
    ux: long ? best.ux : best.vx,
    uz: long ? best.uz : best.vz,
    vx: long ? best.vx : -best.ux,
    vz: long ? best.vz : -best.uz,
    halfLong: Math.max(best.halfA, best.halfB),
    halfShort: Math.min(best.halfA, best.halfB),
    area: best.area,
  };
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/**
 * Builds a gabled, hipped or pyramidal roof.
 * @param rect      result of minAreaRect()
 * @param shape     'gabled' | 'hipped' | 'pyramidal'
 * @param across    put the ridge across the short axis
 * @param eaveY     wall top
 * @param roofH     ridge height above eaveY
 * @returns BufferGeometry with position/normal/color/aWall, ready to merge with walls
 */
export function buildPitchedRoof(rect, { shape, across, eaveY, roofH, overhang, thickness, roofColor, wallColor }) {
  // Local frame: a along the ridge, b across it.
  const ux = across ? rect.vx : rect.ux;
  const uz = across ? rect.vz : rect.uz;
  const vx = across ? -rect.ux : rect.vx;
  const vz = across ? -rect.uz : rect.vz;
  const halfA = across ? rect.halfShort : rect.halfLong;
  const halfB = across ? rect.halfLong : rect.halfShort;

  const P = (a, b, y) => new THREE.Vector3(rect.cx + ux * a + vx * b, y, rect.cz + uz * a + vz * b);
  const center = new THREE.Vector3(rect.cx, eaveY, rect.cz);

  const slope = roofH / halfB;
  const ridgeY = eaveY + roofH;
  const lowY = eaveY - overhang * slope; // the slope continues past the wall line
  const A = halfA + overhang;
  const B = halfB + overhang;
  const ridge = shape === 'gabled' ? A : shape === 'hipped' ? Math.max(halfA - halfB, 0) : 0;

  const positions = [];
  const colors = [];
  const dark = roofColor.clone().multiplyScalar(0.55);

  const tri = (p0, p1, p2, color) => {
    // Orient every face away from the roof's centre (up/outward).
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    const out = new THREE.Vector3().addVectors(p0, p1).add(p2).divideScalar(3).sub(center);
    if (n.dot(out) < 0) [p1, p2] = [p2, p1];
    for (const p of [p0, p1, p2]) {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  const quad = (p0, p1, p2, p3, color) => {
    tri(p0, p1, p2, color);
    tri(p0, p2, p3, color);
  };
  // Underside: the same face lowered by the roof thickness, facing down.
  const under = (pts) => {
    const low = pts.map((p) => p.clone().setY(p.y - thickness));
    for (let i = 1; i < low.length - 1; i++) {
      const [p0, p1, p2] = [low[0], low[i], low[i + 1]];
      const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      const ordered = n.y > 0 ? [p0, p2, p1] : [p0, p1, p2];
      for (const p of ordered) {
        positions.push(p.x, p.y, p.z);
        colors.push(dark.r, dark.g, dark.b);
      }
    }
  };

  for (const side of [1, -1]) {
    // Main slopes (trapezoids; rectangles for gabled roofs).
    const slopeFace = [P(-A, side * B, lowY), P(A, side * B, lowY), P(ridge, 0, ridgeY), P(-ridge, 0, ridgeY)];
    quad(...slopeFace, roofColor);
    under(slopeFace);

    if (shape === 'gabled') {
      // Gable end wall, flush with the facade below.
      tri(P(side * halfA, -halfB, eaveY), P(side * halfA, halfB, eaveY), P(side * halfA, 0, ridgeY), wallColor);
    } else {
      // Hip end.
      const hip = [P(side * A, -B, lowY), P(side * A, B, lowY), P(side * ridge, 0, ridgeY)];
      tri(...hip, roofColor);
      under(hip);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 4), 4));
  geometry.computeVertexNormals(); // non-indexed → flat per face
  return geometry;
}
