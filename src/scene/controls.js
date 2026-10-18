import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * OrbitControls set up for exploring terrain:
 *  - damped rotate/zoom, zoom toward the cursor, panning stays horizontal
 *  - the orbit pivot is kept over the ground (terrain or surroundings) and follows its height
 *  - the camera never dips below the surface or past the horizon
 *  - double-click flies the pivot to the clicked point
 */
export function createControls(camera, domElement, ground, config) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false; // pan over the ground plane, not the view plane
  controls.zoomToCursor = true;
  controls.zoomSpeed = 1.2;
  controls.rotateSpeed = 0.6;
  controls.panSpeed = 1.0;
  controls.keyPanSpeed = 25;
  controls.minDistance = config.minDistance;
  controls.maxDistance = config.maxDistance;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(config.maxPolarAngleDeg);
  controls.listenToKeyEvents(window);

  const limit = ground.half * 0.98;
  const delta = new THREE.Vector3();
  let flight = null;

  function constrain() {
    const { target } = controls;

    // Keep the pivot over the terrain; shift the camera with it so the view
    // angle and distance do not jump when hitting the edge.
    delta.set(
      THREE.MathUtils.clamp(target.x, -limit, limit) - target.x,
      0,
      THREE.MathUtils.clamp(target.z, -limit, limit) - target.z,
    );

    // Ease the pivot toward the ground so rotation always orbits the surface.
    const groundY = ground.heightAt(target.x + delta.x, target.z + delta.z);
    delta.y = (groundY - target.y) * 0.15;

    target.add(delta);
    camera.position.add(delta);

    const floor = ground.heightAt(camera.position.x, camera.position.z) + config.groundClearance;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  return {
    controls,

    update(dt) {
      if (flight) {
        flight.t = Math.min(1, flight.t + dt / flight.duration);
        const k = easeInOutCubic(flight.t);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
        camera.position.lerpVectors(flight.fromCamera, flight.toCamera, k);
        if (flight.t >= 1) flight = null;
      }
      controls.update(dt);
      constrain();
    },

    /** Animates the pivot to `point`, optionally changing the viewing distance. */
    flyTo(point, distance = null, duration = 1.2) {
      const offset = camera.position.clone().sub(controls.target);
      if (distance) offset.setLength(distance);
      flight = {
        t: 0,
        duration,
        fromTarget: controls.target.clone(),
        toTarget: point.clone(),
        fromCamera: camera.position.clone(),
        toCamera: point.clone().add(offset),
      };
    },

    /** Places the camera at spherical (distance, azimuth°, polar°) around `target`. */
    setView(target, { distance, azimuth, polar }) {
      flight = null;
      controls.target.copy(target);
      const phi = THREE.MathUtils.degToRad(polar);
      const az = THREE.MathUtils.degToRad(azimuth);
      // Azimuth is the compass bearing *from the target to the camera*.
      camera.position.set(
        target.x + distance * Math.sin(phi) * Math.sin(az),
        target.y + distance * Math.cos(phi),
        target.z - distance * Math.sin(phi) * Math.cos(az),
      );
      controls.update();
    },
  };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
