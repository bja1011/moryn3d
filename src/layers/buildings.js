import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { forEachPolygon, projectRing, hashString } from './geojson.js';

/**
 * Extrudes OSM building footprints into one merged mesh (a single draw call
 * for the whole town) and keeps a per-building triangle range table so a
 * raycast hit can be mapped back to its OSM feature.
 */
export function createBuildings(features, { terrain, projector, config }) {
  const geometries = [];
  const records = [];
  let triangleCursor = 0;

  const wallBase = new THREE.Color(config.wallColor);
  const wall = new THREE.Color();
  const roof = new THREE.Color();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const height = buildingHeight(props, config);
    const id = String(props['@id'] ?? feature.id ?? records.length);

    forEachPolygon(feature.geometry, (rings) => {
      const local = rings.map((r) => projectRing(r, projector)).filter((r) => r.length >= 3);
      if (!local.length) return;
      const [outer, ...holes] = local;
      // Only buildings fully on the terrain are drawn; partial ones would hang off the edge.
      if (!outer.every(([x, z]) => terrain.contains(x, z))) return;

      // Sample the ground under every footprint vertex: the walls start below the
      // lowest point (so no gap shows on slopes) and the roof is measured from the mean.
      let minGround = Infinity;
      let sumGround = 0;
      for (const [x, z] of outer) {
        const h = terrain.heightAt(x, z);
        minGround = Math.min(minGround, h);
        sumGround += h;
      }
      const base = minGround - config.sink;
      const top = sumGround / outer.length + height;

      // Shapes live in the XY plane as (east, north); ExtrudeGeometry fixes ring
      // winding itself, so CW/CCW input from OSM does not matter.
      const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));

      let geometry;
      try {
        geometry = new THREE.ExtrudeGeometry(shape, { depth: top - base, bevelEnabled: false });
      } catch {
        return; // degenerate footprint that earcut cannot triangulate
      }
      if (!geometry.attributes.position?.count) return;

      // (east, north, up) → scene (x, y=up, z=-north)
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, base, 0);
      geometry.deleteAttribute('uv');

      // Colour walls and roofs via vertex colours so everything shares one material.
      const shade = 0.9 + hashString(id) * 0.15;
      wall.copy(wallBase).multiplyScalar(shade);
      roofColor(props, config, roof);
      const normals = geometry.attributes.normal;
      const colors = new Float32Array(normals.count * 3);
      for (let i = 0; i < normals.count; i++) {
        const c = normals.getY(i) > 0.7 ? roof : wall;
        c.toArray(colors, i * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const triangles = geometry.attributes.position.count / 3;
      records.push({ triStart: triangleCursor, triCount: triangles, props, height, ground: minGround });
      triangleCursor += triangles;
      geometries.push(geometry);
    });
  }

  if (!geometries.length) return null;

  const geometry = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'buildings';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const colorAttr = geometry.attributes.color;
  const originalColors = colorAttr.array.slice();
  const highlight = new THREE.Color(config.highlightColor);
  let selected = null;

  return {
    mesh,
    count: records.length,

    /** Building record for a raycast faceIndex (binary search over triangle ranges). */
    recordForFace(faceIndex) {
      let lo = 0;
      let hi = records.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = records[mid];
        if (faceIndex < r.triStart) hi = mid - 1;
        else if (faceIndex >= r.triStart + r.triCount) lo = mid + 1;
        else return r;
      }
      return null;
    },

    /** Tints one building (or clears the tint when record is null). */
    select(record) {
      if (selected === record) return;
      const write = (r, fn) => {
        const start = r.triStart * 9;
        const end = start + r.triCount * 9;
        for (let i = start; i < end; i++) colorAttr.array[i] = fn(i);
        colorAttr.addUpdateRange(start, end - start);
      };
      if (selected) write(selected, (i) => originalColors[i]);
      if (record) {
        const rgb = [highlight.r, highlight.g, highlight.b];
        write(record, (i) => originalColors[i] * 0.35 + rgb[i % 3] * 0.65);
      }
      selected = record;
      colorAttr.needsUpdate = true;
    },
  };
}

/** Height from `height`, then `building:levels`, then a per-type default. */
function buildingHeight(props, config) {
  const explicit = parseFloat(String(props.height ?? '').replace(',', '.'));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const levels = parseFloat(props['building:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    const roofLevels = parseFloat(props['roof:levels']) || 0;
    return (levels + roofLevels * 0.5) * config.levelHeight + 1; // +1 m for the roof structure
  }
  return config.defaultHeights[props.building] ?? config.defaultHeights.default;
}

function roofColor(props, config, target) {
  const tagged = props['roof:colour'] ?? props['building:roof:colour'];
  // Color.setStyle() ignores unknown names, so validate the tag first.
  if (tagged && CSS.supports('color', tagged)) return target.setStyle(tagged);
  if (props.amenity === 'place_of_worship') return target.set(config.roofColors.church);
  return target.set(config.roofColors[props.building] ?? config.roofColors.default);
}
