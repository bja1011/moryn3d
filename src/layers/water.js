import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { forEachPolygon, projectRing, clipRingToSquare } from './geojson.js';

/**
 * Flat water surfaces for OSM water polygons (Jezioro Morzycko, ponds).
 *
 * A LiDAR DEM records the lake as a flat surface at the water level, so each
 * polygon is placed at a low percentile of the ground heights along its
 * shoreline. The terrain then occludes the edges naturally, with no seams.
 */
export function createWater(features, { terrain, projector, config }) {
  const geometries = [];
  const polygons = []; // { rings, level } in scene metres, for gameplay collision

  for (const feature of features) {
    forEachPolygon(feature.geometry, (rings) => {
      const local = rings
        .map((r) => clipRingToSquare(projectRing(r, projector), terrain.half))
        .filter((r) => r.length >= 3);
      if (!local.length) return;
      const [outer, ...holes] = local;

      const shore = outer.map(([x, z]) => terrain.heightAt(x, z)).sort((a, b) => a - b);
      const level = shore[Math.floor((shore.length - 1) * config.levelPercentile)] + config.lift;

      const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
      const geometry = new THREE.ShapeGeometry(shape);
      if (!geometry.attributes.position.count) return;
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, level, 0);
      geometries.push(geometry);
      polygons.push({ rings: local, level });
    });
  }

  if (!geometries.length) return null;

  const geometry = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    roughness: 0.12,
    metalness: 0.05,
    envMapIntensity: 1.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.receiveShadow = true;
  return { mesh, count: geometries.length, polygons };
}
