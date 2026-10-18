import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { forEachPolygon, projectRing, hashString } from './geojson.js';
import { minAreaRect, ringArea, buildPitchedRoof } from './roofs.js';
import { applyWindowShader } from '../shaders/buildingWindows.js';

const PITCHED_SHAPES = {
  gabled: 'gabled',
  hipped: 'hipped',
  pyramidal: 'pyramidal',
  'half-hipped': 'hipped',
  gambrel: 'gabled',
  mansard: 'hipped',
  saltbox: 'gabled',
};

/**
 * Builds OSM buildings as one merged mesh (a single draw call for the whole
 * town): footprints are extruded up to the eaves, near-rectangular ones get a
 * gabled/hipped roof, and wall vertices carry the data the window shader needs.
 * A per-building triangle range table maps raycast hits back to OSM features.
 */
export function createBuildings(features, { terrain, projector, config }) {
  const geometries = [];
  const records = [];
  let triangleCursor = 0;

  const wall = new THREE.Color();
  const roof = new THREE.Color();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const id = String(props['@id'] ?? feature.id ?? records.length);

    forEachPolygon(feature.geometry, (rings) => {
      const local = rings.map((r) => projectRing(r, projector)).filter((r) => r.length >= 3);
      if (!local.length) return;
      const [outer, ...holes] = local;
      // Only buildings fully on the terrain are drawn; partial ones would hang off the edge.
      if (!outer.every(([x, z]) => terrain.contains(x, z))) return;

      // Sample the ground under every footprint vertex: the walls start below the
      // lowest point (so no gap shows on slopes) and heights are measured from the mean.
      let minGround = Infinity;
      let sumGround = 0;
      for (const [x, z] of outer) {
        const h = terrain.heightAt(x, z);
        minGround = Math.min(minGround, h);
        sumGround += h;
      }
      const groundY = sumGround / outer.length;
      const base = minGround - config.sink;

      const rect = holes.length ? null : minAreaRect(outer);
      const form = buildingForm(props, config, outer, rect);
      const eaveY = groundY + form.eave;
      const top = eaveY + form.roofH;

      // Shapes live in the XY plane as (east, north); ExtrudeGeometry fixes ring
      // winding itself, so CW/CCW input from OSM does not matter.
      const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));

      let geometry;
      try {
        geometry = new THREE.ExtrudeGeometry(shape, { depth: eaveY - base, bevelEnabled: false });
      } catch {
        return; // degenerate footprint that earcut cannot triangulate
      }
      if (!geometry.attributes.position?.count) return;

      // (east, north, up) → scene (x, y=up, z=-north)
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, base, 0);
      geometry.deleteAttribute('uv');

      wallColor(props, config, id, wall);
      roofColor(props, config, id, form.shape !== 'flat', roof);

      // Vertex colours let everything share one material: walls vs. flat roof cap.
      const normals = geometry.attributes.normal;
      const colors = new Float32Array(normals.count * 3);
      for (let i = 0; i < normals.count; i++) (normals.getY(i) > 0.7 ? roof : wall).toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const windows = form.eave >= 2.5 && !config.windows.exclude.includes(props.building);
      geometry.setAttribute('aWall', wallAttributes(geometry, groundY, eaveY, windows));

      if (form.shape !== 'flat') {
        const roofGeometry = buildPitchedRoof(rect, {
          shape: form.shape,
          across: form.across,
          eaveY,
          roofH: form.roofH,
          overhang: config.roofs.overhang,
          thickness: config.roofs.thickness,
          roofColor: roof,
          wallColor: wall,
        });
        const merged = mergeGeometries([geometry, roofGeometry], false);
        geometry.dispose();
        roofGeometry.dispose();
        geometry = merged;
      }

      const triangles = geometry.attributes.position.count / 3;
      records.push({
        triStart: triangleCursor,
        triCount: triangles,
        props,
        height: form.eave + form.roofH,
        roofShape: form.shape,
        ground: minGround,
        top,
        footprint: local, // [outer, ...holes] in scene metres, reused for gameplay collision
      });
      triangleCursor += triangles;
      geometries.push(geometry);
    });
  }

  if (!geometries.length) return null;

  const geometry = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  applyWindowShader(material, { levelHeight: config.levelHeight, spacing: config.windows.spacing });
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
    records,

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

/**
 * Roof shape and heights for one footprint.
 * Wall height comes from `height` (minus the roof), then `building:levels`,
 * then a per-type default; pitched roofs need a near-rectangular footprint.
 * @returns {{shape: string, across: boolean, eave: number, roofH: number}}
 */
function buildingForm(props, config, outer, rect) {
  const { roofs, levelHeight } = config;
  const levels = num(props['building:levels']);
  const tagged = props['roof:shape'];

  let shape = 'flat';
  const fitsPitched =
    rect &&
    rect.halfShort > 1 &&
    rect.halfShort * 2 <= roofs.maxSpan &&
    ringArea(outer) / rect.area >= roofs.minRectangularity;
  if (fitsPitched) {
    if (PITCHED_SHAPES[tagged]) shape = PITCHED_SHAPES[tagged];
    // Untagged: houses and farm buildings get gables; tall blocks stay flat.
    else if (!tagged && roofs.pitchedTypes.includes(props.building) && !(levels >= 4)) shape = 'gabled';
  }

  const across = props['roof:orientation'] === 'across';
  let roofH = 0;
  if (shape !== 'flat') {
    const halfSpan = across ? rect.halfLong : rect.halfShort;
    const angle = THREE.MathUtils.degToRad(num(props['roof:angle']) ?? roofs.pitch);
    roofH = num(props['roof:height']) ?? Math.min(halfSpan * Math.tan(angle), roofs.maxHeight);
  }

  const height = num(props.height);
  let eave;
  if (height) eave = Math.max(height - roofH, 2);
  else if (levels) eave = levels * levelHeight + 0.5;
  else eave = config.defaultHeights[props.building] ?? config.defaultHeights.default;

  return { shape, across, eave, roofH };
}

/**
 * Per-vertex window data for the shader: (u along wall, wall length, ground, eave).
 * ExtrudeGeometry is non-indexed with flat normals, and both triangles of a
 * wall quad span the full edge, so each triangle's extent along its own
 * tangent is the length of its wall.
 */
function wallAttributes(geometry, groundY, eaveY, windows) {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const out = new Float32Array(pos.count * 4);
  if (!windows) return new THREE.BufferAttribute(out, 4);

  const s = [0, 0, 0];
  for (let t = 0; t < pos.count; t += 3) {
    if (Math.abs(nrm.getY(t)) > 0.3) continue; // roof/floor caps
    let tx = -nrm.getZ(t);
    let tz = nrm.getX(t);
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    for (let k = 0; k < 3; k++) s[k] = pos.getX(t + k) * tx + pos.getZ(t + k) * tz;
    const sMin = Math.min(s[0], s[1], s[2]);
    const wallLength = Math.max(s[0], s[1], s[2]) - sMin;
    for (let k = 0; k < 3; k++) out.set([s[k] - sMin, wallLength, groundY, eaveY], (t + k) * 4);
  }
  return new THREE.BufferAttribute(out, 4);
}

function wallColor(props, config, id, target) {
  const tagged = props['building:colour'];
  // Color.setStyle() ignores unknown names, so validate the tag first.
  if (tagged && CSS.supports('color', tagged)) return target.setStyle(tagged);
  const palette = config.wallPalette;
  return target.set(palette[Math.floor(hashString(id) * palette.length)]);
}

function roofColor(props, config, id, pitched, target) {
  const tagged = props['roof:colour'] ?? props['building:roof:colour'];
  if (tagged && CSS.supports('color', tagged)) return target.setStyle(tagged);
  if (props.amenity === 'place_of_worship' || props.building === 'church') return target.set(config.roofColors.church);
  if (pitched) {
    const palette = config.pitchedRoofPalette;
    return target.set(palette[Math.floor(hashString(`${id}/roof`) * palette.length)]);
  }
  return target.set(config.roofColors[props.building] ?? config.roofColors.default);
}

/** Parses an OSM numeric tag ("12", "12.5 m", "12,5"); null if absent or not positive. */
function num(value) {
  if (value == null) return null;
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
