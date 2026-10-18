import * as THREE from 'three';

/**
 * Third-person orbit camera that follows the player.
 *
 * Mouse (pointer lock) sets yaw/pitch, the wheel sets distance. The boom is
 * shortened when a building or the terrain would sit between the camera and
 * the character, and eases back out once the view is clear.
 */
export function createFollowCamera(camera, { terrain, colliders, config }) {
  let yaw = 0;
  let pitch = config.pitch;
  let distance = config.distance;
  let boom = distance;
  const pivot = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const head = new THREE.Vector3();
  let initialised = false;

  /** Longest clear boom length along `dir`, probing every 0.4 m. */
  function clearDistance(maxDist) {
    for (let d = 0.6; d <= maxDist; d += 0.4) {
      probe.copy(pivot).addScaledVector(dir, d);
      const blocked =
        probe.y < terrain.heightAt(probe.x, probe.z) + 0.4 || colliders.occupied(probe.x, probe.y, probe.z);
      if (blocked) return Math.max(config.minDistance * 0.5, d - 0.5);
    }
    return maxDist;
  }

  return {
    get yaw() {
      return yaw;
    },

    /** @param headingRad compass heading in radians (0 = north, π/2 = east) */
    setHeading(headingRad) {
      yaw = -headingRad;
    },

    update(dt, input, target) {
      const look = input.consumeLook();
      yaw -= look.x * config.sensitivity;
      pitch = THREE.MathUtils.clamp(pitch + look.y * config.sensitivity, config.minPitch, config.maxPitch);
      const zoom = input.consumeZoom();
      if (zoom) {
        distance = THREE.MathUtils.clamp(distance * (1 + zoom * 0.12), config.minDistance, config.maxDistance);
      }

      // Lag the pivot slightly behind the head for a smoother follow.
      head.copy(target).setY(target.y + config.pivotHeight);
      if (!initialised) {
        pivot.copy(head);
        initialised = true;
      } else {
        pivot.x = THREE.MathUtils.damp(pivot.x, head.x, 18, dt);
        pivot.y = THREE.MathUtils.damp(pivot.y, head.y, 10, dt);
        pivot.z = THREE.MathUtils.damp(pivot.z, head.z, 18, dt);
      }

      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const allowed = clearDistance(distance);
      // Snap in immediately (never show the inside of a wall), ease back out.
      boom = allowed < boom ? allowed : THREE.MathUtils.damp(boom, allowed, 4, dt);

      camera.position.copy(pivot).addScaledVector(dir, boom);
      camera.lookAt(pivot);
    },
  };
}
