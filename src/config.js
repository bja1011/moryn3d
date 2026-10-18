/**
 * Central configuration for the Moryń digital twin.
 *
 * This module is plain data with no browser APIs, so it is shared by the
 * Vite app and by the Node data scripts in /scripts.
 */
export const CONFIG = {
  /**
   * Projected CRS of the heightmap. The DEM is on the Polish national grid
   * PUWG-1992 (EPSG:2180), the native grid of GUGiK elevation products. The
   * CRS and centre were found by fitting the DEM's flat lake surface against
   * the OSM outline of Jezioro Morzycko (IoU 0.92; UTM 33N scored 0.85).
   */
  crs: {
    code: 'EPSG:2180',
    proj4:
      '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
      '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  },

  terrain: {
    url: 'data/heightmap.png',
    /** Centre of the heightmap in CRS metres (easting, northing). */
    centerX: 189892,
    centerY: 565427,
    /** Edge length of the square heightmap in metres. */
    size: 5640,
    /** Elevations that the 16-bit range 0..65535 maps onto (m a.s.l.). */
    minHeight: 30,
    maxHeight: 96,
    /**
     * Grid resolution of the terrain mesh: 1024 → 1025² vertices, ~5.5 m cells.
     * Matches the 1025² heightmap (`npm run heightmap`), one pixel per vertex.
     */
    segments: 1024,
    /** 1.0 = true scale. Raise to make the gentle relief more readable. */
    verticalExaggeration: 1.0,
    /** Depth of the "diorama" side walls below minHeight (m). */
    skirtDepth: 25,
    contours: { enabled: true, interval: 5, strength: 0.35 },
  },

  data: {
    buildings: 'data/buildings.geojson',
    roads: 'data/roads.geojson',
    water: 'data/water.geojson',
  },

  buildings: {
    levelHeight: 3.0,
    /** Walls go this far below the lowest ground point so slopes never show gaps. */
    sink: 1.5,
    /** Fallback heights (m) by OSM `building=*` value when no height/levels tag exists. */
    defaultHeights: {
      default: 6,
      house: 7,
      detached: 7,
      semidetached_house: 7,
      residential: 9,
      apartments: 12,
      terrace: 8,
      garage: 3,
      garages: 3,
      shed: 2.5,
      roof: 3,
      hut: 3,
      barn: 8,
      farm_auxiliary: 6,
      cowshed: 6,
      stable: 5,
      greenhouse: 3,
      industrial: 9,
      warehouse: 8,
      commercial: 8,
      retail: 6,
      school: 10,
      church: 16,
      chapel: 8,
    },
    wallColor: '#e8e2d6',
    roofColors: {
      default: '#a35a44',
      garage: '#6f6f6f',
      garages: '#6f6f6f',
      shed: '#7a6a58',
      industrial: '#8a8f94',
      warehouse: '#8a8f94',
      greenhouse: '#cfe3e0',
      church: '#8c3b2a',
      apartments: '#7b7f86',
    },
    highlightColor: '#ffb347',
  },

  roads: {
    /** Metres above the terrain surface (plus polygonOffset) to avoid z-fighting. */
    lift: 0.35,
    /** Densification step as a fraction of a terrain cell, so ribbons follow the surface. */
    sampleStep: 0.5,
    /** Width (m), colour and draw rank (higher ranks sit on top at junctions). */
    styles: {
      motorway: { width: 12, color: '#e39b3a', rank: 9 },
      trunk: { width: 10, color: '#e9ad4c', rank: 8 },
      primary: { width: 8, color: '#f0c45a', rank: 7 },
      secondary: { width: 7, color: '#f4d98a', rank: 6 },
      tertiary: { width: 6, color: '#fbf7ec', rank: 5 },
      residential: { width: 5, color: '#ebe7de', rank: 4 },
      living_street: { width: 4.5, color: '#ebe7de', rank: 4 },
      unclassified: { width: 4.5, color: '#e2ded3', rank: 3 },
      service: { width: 3, color: '#d6d2c8', rank: 2 },
      track: { width: 2.5, color: '#a88c5e', rank: 1 },
      pedestrian: { width: 3, color: '#d9cdb8', rank: 1 },
      footway: { width: 1.5, color: '#c7a67a', rank: 0 },
      path: { width: 1.5, color: '#c7a67a', rank: 0 },
      cycleway: { width: 1.8, color: '#9fb4c9', rank: 0 },
      bridleway: { width: 1.5, color: '#b59a70', rank: 0 },
      steps: { width: 1.5, color: '#c7a67a', rank: 0 },
      default: { width: 4, color: '#dcd8ce', rank: 2 },
    },
  },

  windTurbines: {
    model: 'data/wiatrak/scene.gltf',
    /**
     * Turbines digitised from the planning map wiatraki.jpg: Point features
     * with `height` = tip height with one blade pointing straight up and
     * `status`: planned (red circles 280 m, purple circles 210 m) or existing
     * (black circles near Wierzchlas/Kamionka, 100 m hub + 50 m blades = 150 m).
     */
    data: 'data/turbines.geojson',
    defaultHeight: 280,
    /** Compass bearing the rotors face: into the prevailing westerly wind. */
    facing: 260,
    rpm: 8,
  },

  /** Flat ground beyond the heightmap, so turbines outside the DEM have something to stand on. */
  surroundings: {
    enabled: true,
    /** How far the plain extends past the terrain edge (m); the fog hides its end. */
    extent: 40000,
    /** Distance over which the terrain edge blends into the flat plain (m). */
    blend: 1500,
    fieldColor: '#8b9b55',
    /** How far past the terrain edge the camera may pan (m): reaches the outermost turbines. */
    panMargin: 7500,
  },

  water: {
    color: '#3d6f8e',
    /** Surface sits at this percentile of shoreline ground heights, plus `lift`. */
    levelPercentile: 0.1,
    lift: 0.25,
    /**
     * Lake bed carved under the water so the surface never z-fights with the
     * DEM's flat lake: depth = minDepth + slope × distance from shore, capped.
     */
    bed: { minDepth: 1.5, slope: 0.1, maxDepth: 8 },
  },

  environment: {
    /** Compass azimuth (deg from north, clockwise) and elevation of the sun. */
    sunAzimuth: 215,
    sunElevation: 38,
    fogColor: '#c9d7e2',
    fogDensity: 0.00008,
    shadowMapSize: 4096,
  },

  /** Starting camera: looking at the Moryń market square from the south-west. */
  initialView: {
    lon: 14.3935,
    lat: 52.8597,
    distance: 1500,
    azimuth: 200,
    polar: 58,
  },

  controls: {
    minDistance: 15,
    maxDistance: 9000,
    /** Stop just short of the horizon so the camera never looks under the terrain. */
    maxPolarAngleDeg: 84,
    /** Minimum height of the camera above the ground (m). */
    groundClearance: 6,
  },

  osm: {
    overpassUrl: 'https://overpass-api.de/api/interpreter',
  },
};
