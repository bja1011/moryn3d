/**
 * 2D collision world built from building footprints and water polygons.
 *
 * Buildings are prisms (footprint + top height), so most queries reduce to
 * 2D circle-vs-polygon tests in the XZ plane. Polygons go into a uniform grid
 * so each query only touches the few that are nearby.
 */
const CELL = 32;

export class ColliderWorld {
  constructor() {
    this.cells = new Map();
    this.count = 0;
  }

  /**
   * @param rings [outer, ...holes], each ring an array of [x, z]
   * @param top   height of the obstacle's top (Infinity for water)
   */
  add(rings, top, kind) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of rings[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const poly = { rings, top, kind, minX, minZ, maxX, maxZ, stamp: 0 };
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(poly);
      }
    }
    this.count++;
  }

  /** Calls fn(poly) once for each polygon whose bounding box touches the circle. */
  forEachNear(x, z, radius, fn) {
    const stamp = (this._stamp = (this._stamp ?? 0) + 1);
    for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
      for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
        const list = this.cells.get(`${cx},${cz}`);
        if (!list) continue;
        for (const poly of list) {
          if (poly.stamp === stamp) continue; // already visited via another cell
          poly.stamp = stamp;
          if (x + radius < poly.minX || x - radius > poly.maxX) continue;
          if (z + radius < poly.minZ || z - radius > poly.maxZ) continue;
          fn(poly);
        }
      }
    }
  }

  /**
   * Pushes a circle at `pos` ({x, z}, mutated) out of every obstacle whose
   * top is above `feetY`. Returns true if anything was hit.
   */
  resolveCircle(pos, radius, feetY) {
    let hit = false;
    // Two passes settle the circle in corners where two walls meet.
    for (let pass = 0; pass < 2; pass++) {
      this.forEachNear(pos.x, pos.z, radius, (poly) => {
        if (feetY >= poly.top) return; // standing above it
        const inside = pointInRings(pos.x, pos.z, poly.rings);
        const c = closestOnRings(pos.x, pos.z, poly.rings);
        if (!inside && c.dist >= radius) return;

        let nx = pos.x - c.x;
        let nz = pos.z - c.z;
        const len = Math.hypot(nx, nz);
        if (len < 1e-6) {
          nx = c.nx; // exactly on the edge: use the edge normal
          nz = c.nz;
        } else {
          nx /= len;
          nz /= len;
        }
        if (inside) {
          nx = -nx; // centre is inside: the way out is through the closest edge
          nz = -nz;
        }
        pos.x = c.x + nx * radius;
        pos.z = c.z + nz * radius;
        hit = true;
      });
    }
    return hit;
  }

  /** True if the point (x, y, z) is inside an obstacle. Used for camera occlusion. */
  occupied(x, y, z) {
    let found = false;
    this.forEachNear(x, z, 0, (poly) => {
      if (!found && y < poly.top && poly.kind === 'building' && pointInRings(x, z, poly.rings)) found = true;
    });
    return found;
  }

  /** True if the point is inside a polygon of the given kind (ignores height). */
  insideKind(x, z, kind) {
    let found = false;
    this.forEachNear(x, z, 0, (poly) => {
      if (!found && poly.kind === kind && pointInRings(x, z, poly.rings)) found = true;
    });
    return found;
  }
}

/** Even-odd test across all rings, so holes (courtyards, islands) count as outside. */
function pointInRings(x, z, rings) {
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

function closestOnRings(x, z, rings) {
  const best = { x: 0, z: 0, dist: Infinity, nx: 0, nz: 0 };
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j];
      const [bx, bz] = ring[i];
      const ex = bx - ax;
      const ez = bz - az;
      const len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) {
        const el = Math.sqrt(len2);
        Object.assign(best, { x: px, z: pz, dist: d, nx: ez / el, nz: -ex / el });
      }
    }
  }
  return best;
}
