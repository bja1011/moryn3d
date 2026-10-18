import * as THREE from 'three';
import { forEachPolygon, projectRing } from './geojson.js';

/**
 * Fills solar farm polygons with rows of tilted PV tables on posts.
 *
 * Rows run east-west and face true south (the projected grid is rotated
 * against true north, so the layout is rotated to match). Each table must fit
 * entirely inside the polygon, `margin` metres from the boundary, and follows
 * the slope along its row like real racking. Tables and posts are two
 * InstancedMeshes, so hundreds or thousands of them cost two draw calls.
 *
 * @param ground object with heightAt(x, z)
 */
export function createSolarFarm(features, { ground, projector, config }) {
  const { tableLength: L, tableDepth: D, gap, rowPitch, margin, clearance } = config;
  const tilt = THREE.MathUtils.degToRad(config.tilt);
  const panels = [];
  const posts = [];
  let area = 0;

  for (const feature of features) {
    forEachPolygon(feature.geometry, (rings) => {
      const local = rings.map((r) => projectRing(r, projector)).filter((r) => r.length >= 3);
      if (!local.length) return;
      area += ringArea(local[0]) - local.slice(1).reduce((s, h) => s + ringArea(h), 0);

      // Table frame: local x along the row (true east), local z toward true south.
      const [cx, cz] = centroid(local[0]);
      const [lon, lat] = projector.toGeo(cx, cz);
      const [sx, sz] = projector.toLocal(lon, lat - 0.001);
      const yaw = Math.atan2(sx - cx, sz - cz); // rotates scene +z onto true south
      const ex = [Math.cos(yaw), -Math.sin(yaw)]; // local +x in scene XZ
      const ez = [Math.sin(yaw), Math.cos(yaw)]; // local +z in scene XZ
      const toScene = (a, b) => [a * ex[0] + b * ez[0], a * ex[1] + b * ez[1]];

      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [x, z] of local[0]) {
        const a = x * ex[0] + z * ex[1];
        const b = x * ez[0] + z * ez[1];
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
        minB = Math.min(minB, b);
        maxB = Math.max(maxB, b);
      }

      const hw = L / 2 + margin;
      const hd = D / 2 + margin;
      for (let b = minB + hd; b <= maxB - hd; b += rowPitch) {
        for (let a = minA + hw; a <= maxA - hw; a += L + gap) {
          const corners = [
            toScene(a - hw, b - hd),
            toScene(a + hw, b - hd),
            toScene(a + hw, b + hd),
            toScene(a - hw, b + hd),
          ];
          if (!corners.every(([x, z]) => insideRings(x, z, local))) continue;
          // Corners inside, but the boundary may still cut across a long table.
          if (!edgesClear(corners, local)) continue;

          const [x, z] = toScene(a, b);
          // Follow the slope along the row, so rows read as continuous lines
          // instead of steps; stay clear of the higher side across it.
          const h = corners.map(([px, pz]) => ground.heightAt(px, pz));
          const west = Math.max(h[0], h[3]);
          const east = Math.max(h[1], h[2]);
          const roll = Math.atan2(east - west, L);
          const centerY = (west + east) / 2 + clearance + (D / 2) * Math.sin(tilt);
          panels.push({ x, z, y: centerY, yaw, roll });

          // Four posts from the panel underside down into the ground.
          for (const pa of [-0.38 * L, 0.38 * L]) {
            for (const pz of [-(D / 2 - 0.4), D / 2 - 0.4]) {
              const [ox, oz] = toScene(a + pa, b + pz * Math.cos(tilt));
              const top = centerY - pz * Math.sin(tilt) + pa * Math.tan(roll) - 0.05;
              const bottom = ground.heightAt(ox, oz) - 0.3;
              posts.push({ x: ox, z: oz, y: (top + bottom) / 2, h: top - bottom, yaw });
            }
          }
        }
      }
    });
  }

  if (!panels.length) return null;

  const group = new THREE.Group();
  group.name = 'solar-farm';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(tilt, 0, 0, 'YXZ'); // roll along the row, tilt about the row axis, then yaw
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  const panelMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(L, 0.06, D),
    new THREE.MeshStandardMaterial({ color: config.panelColor, metalness: 0.5, roughness: 0.22, envMapIntensity: 1.4 }),
    panels.length,
  );
  panels.forEach((p, i) => {
    euler.y = p.yaw;
    euler.z = p.roll;
    panelMesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromEuler(euler), one));
  });
  panelMesh.castShadow = true;
  panelMesh.receiveShadow = true;
  panelMesh.computeBoundingSphere();

  const postMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 1, 0.12),
    new THREE.MeshStandardMaterial({ color: config.postColor, metalness: 0.6, roughness: 0.5 }),
    posts.length,
  );
  const s = new THREE.Vector3();
  posts.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    postMesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q, s.set(1, p.h, 1)));
  });
  postMesh.castShadow = true;
  postMesh.computeBoundingSphere();

  group.add(panelMesh, postMesh);

  const moduleArea = panels.length * L * D;
  return {
    object: group,
    tables: panels.length,
    areaHa: area / 1e4,
    /** Rough peak power: module area × ~210 W/m² for current modules. */
    peakMW: (moduleArea * 0.21) / 1000,
  };
}

/** Even-odd test across all rings, so holes count as outside. */
function insideRings(x, z, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** True if no polygon edge crosses the table outline. */
function edgesClear(corners, rings) {
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (const ring of rings) {
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        if (segmentsCross(a, b, ring[j], ring[k])) return false;
      }
    }
  }
  return true;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}
