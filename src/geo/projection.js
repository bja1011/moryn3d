import proj4 from 'proj4';

/**
 * Maps WGS84 coordinates onto the local scene frame and back.
 *
 * Scene frame (metres, Y-up):
 *   +x = east, +z = south, y = elevation a.s.l.
 *   The origin is the centre of the heightmap.
 *
 * Going through the heightmap's own projected CRS (instead of an equirectangular
 * approximation) keeps vector data aligned with the DEM to sub-metre accuracy.
 */
export function createProjector({ crs, terrain }) {
  proj4.defs(crs.code, crs.proj4);
  const converter = proj4('EPSG:4326', crs.code);
  const { centerX, centerY } = terrain;

  return {
    /** @returns {[number, number]} [x, z] in scene metres */
    toLocal(lon, lat) {
      const [e, n] = converter.forward([lon, lat]);
      return [e - centerX, centerY - n];
    },

    /** @returns {[number, number]} [lon, lat] */
    toGeo(x, z) {
      return converter.inverse([x + centerX, centerY - z]);
    },

    /** WGS84 bounding box of the terrain square, as [south, west, north, east]. */
    geoBounds(size) {
      const h = size / 2;
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => this.toGeo(x, z));
      const lons = corners.map((c) => c[0]);
      const lats = corners.map((c) => c[1]);
      return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
    },
  };
}
