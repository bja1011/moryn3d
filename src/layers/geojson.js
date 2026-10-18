/**
 * GeoJSON loading and geometry helpers shared by the vector layers.
 */

/**
 * Fetches a FeatureCollection. A missing file yields an empty collection with
 * a console warning, so the terrain still renders before OSM data is fetched.
 */
export async function loadGeoJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    if (json?.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');
    return json.features;
  } catch (err) {
    console.warn(`[geojson] ${url} unavailable (${err.message}); run "npm run fetch-osm".`);
    return [];
  }
}

/** Calls fn(rings) for every polygon in a Polygon or MultiPolygon geometry. */
export function forEachPolygon(geometry, fn) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') fn(geometry.coordinates);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(fn);
}

/** Calls fn(coords) for every line in a LineString or MultiLineString geometry. */
export function forEachLine(geometry, fn) {
  if (!geometry) return;
  if (geometry.type === 'LineString') fn(geometry.coordinates);
  else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach(fn);
}

/** Projects a lon/lat ring to scene [x, z] and drops the closing duplicate vertex. */
export function projectRing(ring, projector) {
  const out = ring.map(([lon, lat]) => projector.toLocal(lon, lat));
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/**
 * Sutherland–Hodgman clip of a ring against the square [-half, half]².
 * Used for water bodies that extend past the edge of the terrain.
 */
export function clipRingToSquare(ring, half) {
  const edges = [
    (p) => p[0] >= -half,
    (p) => p[0] <= half,
    (p) => p[1] >= -half,
    (p) => p[1] <= half,
  ];
  const intersect = [
    (a, b) => lerpAt(a, b, 0, -half),
    (a, b) => lerpAt(a, b, 0, half),
    (a, b) => lerpAt(a, b, 1, -half),
    (a, b) => lerpAt(a, b, 1, half),
  ];

  let output = ring;
  for (let e = 0; e < 4 && output.length; e++) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edges[e](cur);
      if (curIn !== edges[e](prev)) output.push(intersect[e](prev, cur));
      if (curIn) output.push(cur);
    }
  }
  return output;
}

function lerpAt(a, b, axis, value) {
  const t = (value - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Deterministic pseudo-random value in [0, 1) from a string id. */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
