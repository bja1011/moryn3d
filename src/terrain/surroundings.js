import * as THREE from 'three';

/**
 * Ground beyond the edge of the heightmap.
 *
 * A ring of terrain starts exactly on the terrain's edge vertices (same
 * heights, colours and normals, so there is no seam) and blends over `blend`
 * metres into a flat plain at the mean edge elevation, out to `extent` metres
 * past the edge, where the fog swallows it. It carries no real relief; its job
 * is to give objects outside the DEM (e.g. distant wind turbines) something to
 * stand on.
 *
 * The returned object has the same `half` / `heightAt()` interface as Terrain,
 * so camera controls can use it as "the ground" everywhere.
 */
export function createSurroundings(terrain, { extent, blend, fieldColor, panMargin }) {
  const { half, cell, segments, gridSize: n, heights } = terrain;
  const terrainColors = terrain.surface.geometry.attributes.color;
  const terrainNormals = terrain.surface.geometry.attributes.normal;

  // Perimeter samples, clockwise from the north-west corner. Each has a base
  // grid vertex and an outward direction θ (scene x east, z south); corners
  // get a fan of directions so the ring rounds them.
  const ARC = 12;
  const samples = [];
  const push = (ix, iz, theta) => samples.push({ ix, iz, theta });
  const arc = (ix, iz, theta0) => {
    for (let j = 0; j < ARC; j++) push(ix, iz, theta0 + (Math.PI / 2) * (j / ARC));
  };
  const S = segments;
  for (let k = 0; k < S; k++) push(k, 0, -Math.PI / 2); // north edge, outward = -z
  arc(S, 0, -Math.PI / 2);
  for (let k = 0; k < S; k++) push(S, k, 0); // east edge, outward = +x
  arc(S, S, 0);
  for (let k = 0; k < S; k++) push(S - k, S, Math.PI / 2); // south edge, outward = +z
  arc(0, S, Math.PI / 2);
  for (let k = 0; k < S; k++) push(0, S - k, Math.PI); // west edge, outward = -x
  arc(0, 0, Math.PI);

  // The plain sits at the mean edge elevation.
  let sum = 0;
  for (const s of samples) sum += heights[s.iz * n + s.ix];
  const level = sum / samples.length;

  // Ring distances: dense near the edge where the blend happens, sparse further out.
  const distances = [0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400, 2000, 3000, 4500, 7000, 10000, 18000, extent];
  const field = new THREE.Color(fieldColor);
  const m = samples.length;
  const count = m * distances.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  // Edge profile (height + colour per sample). Pushing it straight outward
  // would smear every edge detail into long radial streaks, so each ring uses
  // a moving average along the perimeter whose window grows with distance.
  const edge = [0, 1, 2, 3].map(() => new Float64Array(m));
  const c = new THREE.Color();
  samples.forEach(({ ix, iz }, i) => {
    const idx = iz * n + ix;
    c.fromBufferAttribute(terrainColors, idx);
    edge[0][i] = heights[idx];
    edge[1][i] = c.r;
    edge[2][i] = c.g;
    edge[3][i] = c.b;
  });
  // Prefix sums over the perimeter repeated three times, for wrap-around windows.
  const prefix = edge.map((arr) => {
    const p = new Float64Array(3 * m + 1);
    for (let j = 0; j < 3 * m; j++) p[j + 1] = p[j] + arr[j % m];
    return p;
  });
  const average = (channel, i, w) => (prefix[channel][m + i + w + 1] - prefix[channel][m + i - w]) / (2 * w + 1);

  distances.forEach((d, k) => {
    const t = smooth(d / blend);
    const w = Math.min(Math.floor(m / 2) - 1, Math.round(d / cell));
    samples.forEach(({ ix, iz, theta }, i) => {
      const v = (k * m + i) * 3;
      positions[v] = ix * cell - half + Math.cos(theta) * d;
      positions[v + 1] = THREE.MathUtils.lerp(average(0, i, w), level, t);
      positions[v + 2] = iz * cell - half + Math.sin(theta) * d;
      colors[v] = THREE.MathUtils.lerp(average(1, i, w), field.r, t);
      colors[v + 1] = THREE.MathUtils.lerp(average(2, i, w), field.g, t);
      colors[v + 2] = THREE.MathUtils.lerp(average(3, i, w), field.b, t);
    });
  });

  // Quads between neighbouring samples on neighbouring rings (counter-clockwise from above).
  const indices = [];
  for (let k = 0; k < distances.length - 1; k++) {
    for (let i = 0; i < m; i++) {
      const a = k * m + i;
      const b = k * m + ((i + 1) % m);
      const cc = (k + 1) * m + ((i + 1) % m);
      const d = (k + 1) * m + i;
      indices.push(a, b, d, b, cc, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Ring 0 takes the terrain's own normals so lighting is continuous across the seam.
  const normals = geometry.attributes.normal;
  samples.forEach(({ ix, iz }, i) => {
    const idx = iz * n + ix;
    normals.setXYZ(i, terrainNormals.getX(idx), terrainNormals.getY(idx), terrainNormals.getZ(idx));
  });
  geometry.computeBoundingSphere();

  // Same material as the terrain: vertex colours plus contour lines.
  const mesh = new THREE.Mesh(geometry, terrain.surface.material);
  mesh.name = 'surroundings';
  mesh.receiveShadow = true;

  return {
    mesh,
    level,
    /** Pan limit for the camera: the terrain plus a margin around it. */
    half: half + panMargin,

    /** Ground height anywhere: the terrain inside, the blended plain outside (same formula as the mesh). */
    heightAt(x, z) {
      if (terrain.contains(x, z)) return terrain.heightAt(x, z);
      const cx = THREE.MathUtils.clamp(x, -half, half);
      const cz = THREE.MathUtils.clamp(z, -half, half);
      const d = Math.hypot(x - cx, z - cz);
      const i = perimeterIndex(x, z, cx, cz);
      const w = Math.min(Math.floor(m / 2) - 1, Math.round(d / cell));
      return THREE.MathUtils.lerp(average(0, i, w), level, smooth(d / blend));
    },
  };

  /** Index of the perimeter sample that a point outside the terrain extends from. */
  function perimeterIndex(x, z, cx, cz) {
    const side = S + ARC; // samples per edge plus its following corner arc
    const onX = Math.abs(x) <= half;
    const onZ = Math.abs(z) <= half;
    if (onX && z < -half) return Math.round((x + half) / cell); // north
    if (onZ && x > half) return side + Math.round((z + half) / cell); // east
    if (onX && z > half) return 2 * side + Math.round((half - x) / cell); // south
    if (onZ && x < -half) return 3 * side + Math.round((half - z) / cell); // west
    // Corner: pick the fan sample by direction.
    let theta = Math.atan2(z - cz, x - cx);
    const corner = x > 0 ? (z < 0 ? 0 : 1) : z > 0 ? 2 : 3; // NE, SE, SW, NW
    const start = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][corner];
    if (corner === 3 && theta < 0) theta += Math.PI * 2;
    const j = THREE.MathUtils.clamp(Math.round(((theta - start) / (Math.PI / 2)) * ARC), 0, ARC);
    return (corner * side + S + j) % m;
  }
}

function smooth(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
