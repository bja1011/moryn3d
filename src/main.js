import * as THREE from 'three';
import './style.css';
import { CONFIG } from './config.js';
import { createProjector } from './geo/projection.js';
import { loadHeightGrid, Terrain } from './terrain/terrain.js';
import { loadGeoJSON } from './layers/geojson.js';
import { createBuildings } from './layers/buildings.js';
import { createRoads } from './layers/roads.js';
import { createWater } from './layers/water.js';
import { createEnvironment } from './scene/environment.js';
import { createControls } from './scene/controls.js';
import { createUI } from './ui.js';

const asset = (path) => import.meta.env.BASE_URL + path;

async function main() {
  const ui = createUI();
  const container = document.getElementById('app');

  // --- Renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // near = 2 m keeps depth precision high enough for road ribbons at 9 km range.
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 40000);

  const environment = createEnvironment(renderer, scene, CONFIG.environment);
  const projector = createProjector(CONFIG);

  // --- Data -----------------------------------------------------------------
  // Vector data downloads while the heightmap decodes in its worker.
  const vectorData = Promise.all([
    loadGeoJSON(asset(CONFIG.data.buildings)),
    loadGeoJSON(asset(CONFIG.data.roads)),
    loadGeoJSON(asset(CONFIG.data.water)),
  ]);
  const grid = await loadHeightGrid(CONFIG.terrain, asset(CONFIG.terrain.url), ui.progress);

  ui.status('Building terrain');
  const terrain = new Terrain(grid, CONFIG.terrain);
  scene.add(terrain.object);

  ui.status('Extruding buildings and draping roads');
  const [buildingFeatures, roadFeatures, waterFeatures] = await vectorData;
  const context = { terrain, projector };
  const water = createWater(waterFeatures, { ...context, config: CONFIG.water });
  const roads = createRoads(roadFeatures, { ...context, config: CONFIG.roads });
  const buildings = createBuildings(buildingFeatures, { ...context, config: CONFIG.buildings });
  for (const layer of [water, roads, buildings]) if (layer) scene.add(layer.mesh);

  ui.bindLayer('layer-buildings', buildings?.mesh);
  ui.bindLayer('layer-roads', roads?.mesh);
  ui.bindLayer('layer-water', water?.mesh);
  ui.setStats(
    `${buildings?.count ?? 0} buildings · ${roads?.count ?? 0} road segments · ` +
      `${grid.size}² terrain vertices`,
  );

  // --- Controls -------------------------------------------------------------
  const nav = createControls(camera, renderer.domElement, terrain, CONFIG.controls);
  const showView = (view) => {
    const [x, z] = projector.toLocal(view.lon, view.lat);
    nav.setView(new THREE.Vector3(x, terrain.heightAt(x, z), z), view);
  };
  showView(readViewHash() ?? CONFIG.initialView);
  ui.onReset(() => showView(CONFIG.initialView));

  // Keep the current view in the URL (#view=lat,lon,distance,azimuth,polar) so it can be shared.
  let hashTimer = 0;
  nav.controls.addEventListener('change', () => {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const { target } = nav.controls;
      const offset = camera.position.clone().sub(target);
      const [lon, lat] = projector.toGeo(target.x, target.z);
      const distance = offset.length();
      const polar = THREE.MathUtils.radToDeg(Math.acos(offset.y / distance));
      const azimuth = (THREE.MathUtils.radToDeg(Math.atan2(offset.x, -offset.z)) + 360) % 360;
      const parts = [lat.toFixed(6), lon.toFixed(6), distance.toFixed(0), azimuth.toFixed(1), polar.toFixed(1)];
      history.replaceState(null, '', `#view=${parts.join(',')}`);
    }, 400);
  });

  // --- Picking --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pendingHover = false;
  let downAt = null;

  const setRay = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  };

  // Cursor coordinate readout, throttled to one ray march per frame.
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (pendingHover) return;
    pendingHover = true;
    requestAnimationFrame(() => {
      pendingHover = false;
      setRay(event);
      const hit = terrain.raycast(raycaster.ray);
      if (!hit) return ui.setReadout(null);
      const [lon, lat] = projector.toGeo(hit.x, hit.z);
      ui.setReadout({ lon, lat, elevation: hit.y / CONFIG.terrain.verticalExaggeration });
    });
  });

  // A click (pointer barely moved) selects a building; drags are left to OrbitControls.
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 4) return;
    if (!buildings?.mesh.visible) return;
    setRay(event);
    const hit = raycaster.intersectObject(buildings.mesh, false)[0];
    const ground = terrain.raycast(raycaster.ray);
    const occluded = ground && hit && raycaster.ray.origin.distanceTo(ground) < hit.distance - 1;
    const record = hit && !occluded ? buildings.recordForFace(hit.faceIndex) : null;
    buildings.select(record);
    if (record) ui.showBuilding(record, () => buildings.select(null));
    else ui.hideBuilding();
  });

  renderer.domElement.addEventListener('dblclick', (event) => {
    setRay(event);
    const hit = terrain.raycast(raycaster.ray);
    if (hit) nav.flyTo(hit, Math.min(camera.position.distanceTo(nav.controls.target), 600));
  });

  // --- Resize & render loop -------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.1);
    nav.update(dt);
    environment.update(nav.controls.target, camera.position.distanceTo(nav.controls.target), timer.getElapsed());
    renderer.render(scene, camera);
  });

  ui.ready();
}

/** Parses #view=lat,lon,distance,azimuth,polar; returns null if absent or malformed. */
function readViewHash() {
  const match = location.hash.match(/view=([-\d.,]+)/);
  if (!match) return null;
  const [lat, lon, distance, azimuth, polar] = match[1].split(',').map(Number);
  if (![lat, lon, distance, azimuth, polar].every(Number.isFinite)) return null;
  return { lat, lon, distance, azimuth, polar };
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loader-text').textContent = `Failed to load: ${err.message}`;
  document.getElementById('loader').classList.add('error');
});
