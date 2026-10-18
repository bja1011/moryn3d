import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads the turbine glTF. A missing or broken file resolves to null with a
 * warning, so the rest of the scene still renders.
 */
export async function loadWindTurbineModel(url) {
  try {
    return await new GLTFLoader().loadAsync(url);
  } catch (err) {
    console.warn(`[wind turbines] ${url} could not be loaded (${err.message})`);
    return null;
  }
}

/**
 * Places one wind turbine per GeoJSON Point feature. Each is scaled so the tip
 * of a blade pointing straight up is `properties.height` metres above the ground.
 *
 * The model (Sketchfab "Wind Turbine" by DoobiDooba, CC-BY-4.0) has the tower
 * and rotor as separate meshes; the rotor turns about its local Z axis and
 * faces the model's +Z side. Clones share geometry and materials.
 *
 * @param ground object with heightAt(x, z), covering the terrain and beyond
 */
export function createWindTurbines(gltf, features, { ground, projector, config }) {
  const template = gltf.scene;
  template.updateMatrixWorld(true);
  const { rotor, tower } = findParts(template);
  if (!rotor || !tower) throw new Error('Wind turbine model: rotor or tower mesh not found');

  // Measure the rest pose once, in model units: tower base, hub and blade radius.
  const box = new THREE.Box3().setFromObject(template);
  const towerBox = new THREE.Box3().setFromObject(tower);
  const towerCenter = towerBox.getCenter(new THREE.Vector3());
  const hub = rotor.getWorldPosition(new THREE.Vector3());
  const v = new THREE.Vector3();
  const positions = rotor.geometry.attributes.position;
  let radius = 0;
  for (let i = 0; i < positions.count; i++) {
    radius = Math.max(radius, v.fromBufferAttribute(positions, i).applyMatrix4(rotor.matrixWorld).distanceTo(hub));
  }
  const tipHeight = hub.y + radius - box.min.y;
  const baseRadius = Math.max(towerBox.max.x - towerBox.min.x, towerBox.max.z - towerBox.min.z) / 2;

  // Centre the tower base on the template's origin.
  template.position.set(-towerCenter.x, -box.min.y, -towerCenter.z);
  template.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const group = new THREE.Group();
  group.name = 'wind-turbines';
  const rotors = [];
  // All turbines face the same wind; the model's front is +Z (scene south).
  const yaw = Math.PI - THREE.MathUtils.degToRad(config.facing);

  for (const feature of features) {
    if (feature.geometry?.type !== 'Point') continue;
    const [lon, lat] = feature.geometry.coordinates;
    const height = Number(feature.properties?.height) || config.defaultHeight;
    const scale = height / tipHeight;

    const root = new THREE.Group();
    root.name = `wind-turbine-${feature.properties?.id ?? rotors.length}`;
    const model = template.clone(true);
    root.add(model);
    root.scale.setScalar(scale);
    root.rotation.y = yaw;

    // Stand on the lowest ground under the tower base, so no gap shows on a slope.
    const [x, z] = projector.toLocal(lon, lat);
    const r = baseRadius * scale;
    let base = ground.heightAt(x, z);
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      base = Math.min(base, ground.heightAt(x + Math.cos(angle) * r, z + Math.sin(angle) * r));
    }
    root.position.set(x, base - 0.5, z);

    // Random phase and ±10% speed so the wind farm doesn't turn in lockstep.
    const rotorClone = findParts(model).rotor;
    rotorClone.rotation.z = Math.random() * Math.PI * 2;
    const speed = (config.rpm / 60) * Math.PI * 2 * (0.9 + Math.random() * 0.2);
    rotors.push({ rotor: rotorClone, speed });
    group.add(root);
  }

  return {
    object: group,
    count: rotors.length,

    update(dt) {
      // Negative Z turns each rotor clockwise as seen from the front, like real turbines.
      for (const { rotor: r, speed } of rotors) r.rotation.z -= speed * dt;
    },
  };
}

function findParts(root) {
  let rotor = null;
  let tower = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/blade/i.test(o.parent?.name ?? '')) rotor = o;
    else tower ??= o;
  });
  return { rotor, tower };
}
