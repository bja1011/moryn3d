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
    /** Grid resolution of the terrain mesh: 512 → 513² vertices, ~11 m cells. */
    segments: 512,
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
    /**
     * Fallback wall (eave) heights in metres by OSM `building=*` value, used when
     * there is no height/levels tag. A pitched roof is added on top of this.
     */
    defaultHeights: {
      default: 5,
      yes: 5,
      house: 5,
      detached: 5,
      semidetached_house: 5.5,
      residential: 6.5,
      apartments: 12,
      terrace: 6,
      garage: 2.6,
      garages: 2.6,
      shed: 2.4,
      roof: 3,
      hut: 2.6,
      barn: 5,
      farm_auxiliary: 4,
      cowshed: 4,
      stable: 3.5,
      greenhouse: 3,
      industrial: 8,
      warehouse: 7,
      commercial: 7,
      retail: 5,
      school: 9,
      church: 12,
      chapel: 5,
    },

    roofs: {
      /** Untagged buildings of these types get a gabled roof (when the footprint allows it). */
      pitchedTypes: [
        'yes', 'house', 'detached', 'semidetached_house', 'residential', 'terrace', 'farm',
        'barn', 'farm_auxiliary', 'cowshed', 'stable', 'church', 'chapel', 'hut', 'shed',
      ],
      /** Default pitch in degrees when `roof:angle` / `roof:height` are missing. */
      pitch: 38,
      /** Pitched roofs need a roughly rectangular footprint: area / bounding-rectangle area. */
      minRectangularity: 0.75,
      /** Wider buildings than this (short side, m) keep a flat roof. */
      maxSpan: 24,
      maxHeight: 9,
      overhang: 0.4,
      thickness: 0.18,
    },

    windows: {
      /** Buildings of these types get no windows. */
      exclude: ['garage', 'garages', 'shed', 'roof', 'hut', 'greenhouse', 'carport', 'barn', 'cowshed'],
      spacing: 3.2,
    },

    /** Plaster colours; one is picked per building unless `building:colour` is tagged. */
    wallPalette: ['#ece5d8', '#efe4c9', '#e2d3b9', '#dcd6cc', '#f2ede2', '#e6cfae', '#d8c3a5'],
    /** Ceramic tile and sheet roofing colours for pitched roofs. */
    pitchedRoofPalette: ['#a4513a', '#8e3f2e', '#b3613f', '#9a4a36', '#5a5451', '#6b3a2d'],
    /** Flat roof colours by building type. */
    roofColors: {
      default: '#7e7c78',
      greenhouse: '#cfe3e0',
      church: '#8c3b2a',
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

  water: {
    color: '#3d6f8e',
    /** Surface sits at this percentile of shoreline ground heights, plus `lift`. */
    levelPercentile: 0.1,
    lift: 0.25,
  },

  environment: {
    /** Compass azimuth (deg from north, clockwise) and elevation of the sun. */
    sunAzimuth: 215,
    sunElevation: 38,
    fogColor: '#c9d7e2',
    fogDensity: 0.00008,
    shadowMapSize: 4096,
  },

  /** Map-mode overview: Moryń town centre seen from the south-west. */
  initialView: {
    lon: 14.3979,
    lat: 52.8581,
    distance: 1500,
    azimuth: 200,
    polar: 58,
  },

  game: {
    /**
     * Spawn point: Plac Wolności, the old market square. (The OSM `place=town`
     * node sits in a meadow south of the houses, so it makes a poor start.)
     */
    spawn: { lon: 14.3978889, lat: 52.8581098 },
    /** Initial facing, compass degrees: toward Kościół pw. Świętego Ducha. */
    spawnHeading: 70,

    player: {
      radius: 0.35,
      walkSpeed: 4.5,
      runSpeed: 9,
      groundAccel: 12,
      airAccel: 2.5,
      jumpSpeed: 6.5,
      gravity: 20,
      /** Max drop (m) per frame that still counts as walking downhill, not falling. */
      stepDown: 0.6,
      turnRate: 12,
      character: { jacket: '#c8452f', trousers: '#2f3b4c', skin: '#e6b897' },
    },

    camera: {
      distance: 7,
      minDistance: 2.5,
      maxDistance: 30,
      pitch: 0.32,
      minPitch: -0.3,
      maxPitch: 1.35,
      pivotHeight: 1.6,
      sensitivity: 0.0025,
      fov: 60,
      near: 0.2,
    },
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
