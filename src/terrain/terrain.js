import * as THREE from 'three';
import { applyContourShader } from '../shaders/terrainContours.js';

/**
 * Loads the heightmap in a worker and resolves to the resampled elevation grid.
 * @returns {Promise<{heights: Float32Array, size: number}>}
 */
export function loadHeightGrid(terrainConfig, url, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./heightmap.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress(data.stage, data.value);
      worker.terminate();
      if (data.type === 'done') resolve(data);
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Heightmap worker failed'));
    };
    worker.postMessage({
      // Absolute URL: inside the worker, relative paths resolve against the worker script.
      url: new URL(url, document.baseURI).href,
      segments: terrainConfig.segments,
      minHeight: terrainConfig.minHeight,
      maxHeight: terrainConfig.maxHeight,
    });
  });
}

const COLOR_LOW = new THREE.Color('#5d7d43'); // wet meadows, valley floors
const COLOR_MID = new THREE.Color('#8b9b55'); // farmland
const COLOR_HIGH = new THREE.Color('#b2a56c'); // dry hilltops
const COLOR_SLOPE = new THREE.Color('#7d6a4c'); // exposed soil on steep banks

/**
 * Terrain mesh built by CPU-side displacement of a PlaneGeometry.
 *
 * CPU displacement (instead of a GPU displacement map) means the vertex
 * heights are known in JavaScript, so heightAt() returns *exactly* the
 * rendered surface: buildings, roads and water sit on the triangles the GPU
 * draws, not on a separately sampled copy of the DEM.
 */
export class Terrain {
  constructor({ heights, size: gridSize }, config) {
    this.config = config;
    this.segments = gridSize - 1;
    this.gridSize = gridSize;
    this.size = config.size;
    this.half = config.size / 2;
    this.cell = config.size / this.segments;

    const k = config.verticalExaggeration;
    this.heights = k === 1 ? heights : heights.map((h) => h * k);
    this.minY = config.minHeight * k;
    this.maxY = config.maxHeight * k;

    this.object = new THREE.Group();
    this.object.name = 'terrain';
    this.surface = this.#buildSurface();
    this.object.add(this.surface, this.#buildSkirt());
  }

  #buildSurface() {
    const { size, segments, heights } = this;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    // PlaneGeometry lies in XY with row 0 at +y. Rotating -90° about X maps it
    // to XZ with row 0 at -z (north), matching image row 0 = north.
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) position.setY(i, heights[i]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.setAttribute('color', this.#vertexColors(geometry));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    const { contours, verticalExaggeration } = this.config;
    if (contours?.enabled) {
      applyContourShader(material, { ...contours, exaggeration: verticalExaggeration });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain-surface';
    mesh.receiveShadow = true;
    mesh.castShadow = true; // hills shade the valley at low sun angles
    return mesh;
  }

  /** Colours from elevation and slope, with a little per-vertex noise for texture. */
  #vertexColors(geometry) {
    const { heights, minY, maxY, gridSize } = this;
    const normals = geometry.attributes.normal;
    const colors = new Float32Array(heights.length * 3);
    const c = new THREE.Color();

    for (let i = 0; i < heights.length; i++) {
      const t = THREE.MathUtils.clamp((heights[i] - minY) / (maxY - minY), 0, 1);
      if (t < 0.45) c.lerpColors(COLOR_LOW, COLOR_MID, t / 0.45);
      else c.lerpColors(COLOR_MID, COLOR_HIGH, (t - 0.45) / 0.55);

      const slope = 1 - normals.getY(i);
      c.lerp(COLOR_SLOPE, THREE.MathUtils.smoothstep(slope, 0.03, 0.2) * 0.7);

      const noise = hash2(i % gridSize, Math.floor(i / gridSize)) * 0.08 - 0.04;
      colors[i * 3] = c.r * (1 + noise);
      colors[i * 3 + 1] = c.g * (1 + noise);
      colors[i * 3 + 2] = c.b * (1 + noise);
    }
    return new THREE.BufferAttribute(colors, 3);
  }

  /** Vertical walls around the edge, giving the model a solid "diorama" look. */
  #buildSkirt() {
    const { segments, gridSize, heights, half, cell } = this;
    const baseY = this.minY - this.config.skirtDepth;

    // Perimeter grid indices, clockwise from the north-west corner.
    const ring = [];
    for (let i = 0; i < segments; i++) ring.push([i, 0]);
    for (let i = 0; i < segments; i++) ring.push([segments, i]);
    for (let i = segments; i > 0; i--) ring.push([i, segments]);
    for (let i = segments; i > 0; i--) ring.push([0, i]);
    ring.push([0, 0]);

    const positions = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[i + 1];
      const pa = [ax * cell - half, heights[az * gridSize + ax], az * cell - half];
      const pb = [bx * cell - half, heights[bz * gridSize + bx], bz * cell - half];
      positions.push(
        pa[0], pa[1], pa[2], pa[0], baseY, pa[2], pb[0], pb[1], pb[2],
        pb[0], pb[1], pb[2], pa[0], baseY, pa[2], pb[0], baseY, pb[2],
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: '#5b4733',
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain-skirt';
    return mesh;
  }

  contains(x, z) {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }

  /**
   * Height of the rendered surface at (x, z), interpolated across the same
   * triangle split that PlaneGeometry uses (diagonal from (ix, iy+1) to (ix+1, iy)).
   * Coordinates outside the terrain are clamped to the edge.
   */
  heightAt(x, z) {
    const { segments, gridSize: n, heights: H } = this;
    const gx = THREE.MathUtils.clamp((x + this.half) / this.cell, 0, segments - 1e-6);
    const gz = THREE.MathUtils.clamp((z + this.half) / this.cell, 0, segments - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const v = gz - iz;

    const a = H[iz * n + ix]; // (0,0)
    const b = H[(iz + 1) * n + ix]; // (0,1)
    const c = H[(iz + 1) * n + ix + 1]; // (1,1)
    const d = H[iz * n + ix + 1]; // (1,0)

    return u + v <= 1
      ? a + (d - a) * u + (b - a) * v
      : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  /**
   * Ray/heightfield intersection by marching along the ray at half-cell steps
   * and refining by bisection. Much cheaper than a triangle raycast against
   * ~525k faces, so it can run on every pointer move.
   * @returns {THREE.Vector3|null}
   */
  raycast(ray) {
    // Restrict marching to the span where the ray is inside the terrain's box.
    const box = (this._bounds ??= new THREE.Box3(
      new THREE.Vector3(-this.half, this.minY - 1, -this.half),
      new THREE.Vector3(this.half, this.maxY + 1, this.half),
    ));
    const p = new THREE.Vector3();
    if (!ray.intersectBox(box, p)) return null;
    const tStart = ray.origin.distanceTo(p);
    const tEnd = tStart + this.size * 1.5;

    const step = this.cell * 0.5;
    let prev = tStart;
    for (let t = tStart; t <= tEnd; t += step) {
      ray.at(t, p);
      if (!this.contains(p.x, p.z)) {
        if (t > tStart) return null; // left the box through a side
        prev = t;
        continue;
      }
      if (p.y <= this.heightAt(p.x, p.z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          ray.at(mid, p);
          if (p.y <= this.heightAt(p.x, p.z)) hi = mid;
          else lo = mid;
        }
        return ray.at(hi, p);
      }
      if (p.y < this.minY - 1) return null; // passed under the terrain
      prev = t;
    }
    return null;
  }
}

/** Deterministic hash in [0, 1) for a pair of integers. */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
