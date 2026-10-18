#!/usr/bin/env node
/**
 * Downloads buildings, roads and water for the terrain extent from the
 * Overpass API and writes three GeoJSON files to public/data/.
 *
 *   npm run fetch-osm
 *   OVERPASS_URL=https://overpass.kumi.systems/api/interpreter npm run fetch-osm
 *
 * The bounding box comes from src/config.js, so data always matches the
 * heightmap extent. Multipolygon relations are assembled into rings here,
 * so the script has no conversion dependency.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { CONFIG } from '../src/config.js';
import { createProjector } from '../src/geo/projection.js';

const OUT_DIR = new URL('../public/data/', import.meta.url);
const endpoint = process.env.OVERPASS_URL ?? CONFIG.osm.overpassUrl;

const ROAD_TYPES = new Set(Object.keys(CONFIG.roads.styles).filter((k) => k !== 'default'));
ROAD_TYPES.add('motorway_link').add('trunk_link').add('primary_link').add('secondary_link').add('tertiary_link').add('road');

const projector = createProjector(CONFIG);
const [s, w, n, e] = projector.geoBounds(CONFIG.terrain.size).map((v) => v.toFixed(6));
const bbox = `${s},${w},${n},${e}`;

const query = `
[out:json][timeout:180];
(
  way["building"](${bbox});
  relation["building"]["type"="multipolygon"](${bbox});
  way["highway"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"]["type"="multipolygon"](${bbox});
  way["waterway"="riverbank"](${bbox});
);
out geom;`;

console.log(`Querying Overpass for bbox ${bbox} ...`);
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'moryn-digital-twin/1.0 (three.js terrain demo)',
  },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) {
  console.error(`Overpass error ${response.status}: ${(await response.text()).slice(0, 500)}`);
  process.exit(1);
}
const { elements } = await response.json();
console.log(`Received ${elements.length} OSM elements`);

const buildings = [];
const roads = [];
const water = [];

for (const el of elements) {
  const tags = el.tags ?? {};
  const props = { ...tags, '@id': `${el.type}/${el.id}` };

  if (el.type === 'way') {
    const coords = (el.geometry ?? []).map(({ lon, lat }) => [lon, lat]);
    if (coords.length < 2) continue;
    const closed = coords.length >= 4 && sameCoord(coords[0], coords[coords.length - 1]);

    if (tags.building && closed) {
      buildings.push(feature({ type: 'Polygon', coordinates: [coords] }, props));
    } else if (tags.highway && ROAD_TYPES.has(tags.highway) && tags.area !== 'yes') {
      roads.push(feature({ type: 'LineString', coordinates: coords }, props));
    } else if ((tags.natural === 'water' || tags.waterway === 'riverbank') && closed) {
      water.push(feature({ type: 'Polygon', coordinates: [coords] }, props));
    }
  } else if (el.type === 'relation') {
    const geometry = assembleMultipolygon(el.members ?? []);
    if (!geometry) continue;
    if (tags.building) buildings.push(feature(geometry, props));
    else if (tags.natural === 'water') water.push(feature(geometry, props));
  }
}

await mkdir(OUT_DIR, { recursive: true });
for (const [name, features] of [['buildings', buildings], ['roads', roads], ['water', water]]) {
  const url = new URL(`${name}.geojson`, OUT_DIR);
  await writeFile(url, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`  ${name}.geojson: ${features.length} features`);
}
console.log('Done. Data © OpenStreetMap contributors, ODbL.');

// ---------------------------------------------------------------------------

function feature(geometry, properties) {
  return { type: 'Feature', properties, geometry };
}

function sameCoord(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/** Builds a (Multi)Polygon from relation members with `out geom` geometry. */
function assembleMultipolygon(members) {
  const lines = (role) =>
    members
      .filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.length >= 2)
      .map((m) => m.geometry.map(({ lon, lat }) => [lon, lat]));

  const outers = joinRings(lines('outer'));
  const inners = joinRings(lines('inner'));
  if (!outers.length) return null;

  const polygons = outers.map((outer) => [outer]);
  for (const inner of inners) {
    const owner = polygons.find(([outer]) => pointInRing(inner[0], outer));
    if (owner) owner.push(inner);
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

/** Joins way fragments end-to-end into closed rings; unclosable chains are dropped. */
function joinRings(segments) {
  const pool = segments.map((s) => s.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let extended = true;
    while (!sameCoord(ring[0], ring[ring.length - 1]) && extended) {
      extended = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i];
        if (sameCoord(seg[0], end)) ring = ring.concat(seg.slice(1));
        else if (sameCoord(seg[seg.length - 1], end)) ring = ring.concat(seg.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && sameCoord(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
