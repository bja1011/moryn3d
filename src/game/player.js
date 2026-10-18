import * as THREE from 'three';
import { createCharacter } from './character.js';

/**
 * Kinematic third-person character controller.
 *
 * Moves relative to the camera heading, follows the terrain surface via
 * Terrain.heightAt(), jumps under gravity, and slides along building walls
 * and shorelines using the 2D collider world.
 */
export function createPlayer({ terrain, colliders, config }) {
  const character = createCharacter(config.character);
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const prev = { x: 0, z: 0 };
  const next = { x: 0, z: 0 };
  const limit = terrain.half - 1;
  let heading = 0;
  let grounded = true;

  /** Places the player at (x, z), nudged outward to the nearest free spot. */
  function spawn(x, z, headingRad = 0) {
    const free = findFreeSpot(x, z);
    position.set(free.x, terrain.heightAt(free.x, free.z), free.z);
    velocity.set(0, 0, 0);
    heading = headingRad;
    grounded = true;
    syncObject();
  }

  function findFreeSpot(x, z) {
    const blocked = (px, pz) =>
      colliders.insideKind(px, pz, 'building') ||
      colliders.insideKind(px, pz, 'water') ||
      colliders.resolveCircle({ x: px, z: pz }, config.radius + 0.5, -Infinity);
    if (!blocked(x, z)) return { x, z };
    for (let r = 2; r <= 80; r += 2) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (!blocked(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  function syncObject() {
    character.object.position.copy(position);
    character.object.rotation.y = heading;
  }

  return {
    object: character.object,
    position,
    velocity,
    spawn,

    get grounded() {
      return grounded;
    },

    get speed() {
      return Math.hypot(velocity.x, velocity.z);
    },

    /** @param cameraYaw yaw of the follow camera (radians, 0 = looking north) */
    update(dt, input, cameraYaw) {
      // --- Intent → target horizontal velocity, in camera space ----------
      const { x: ix, y: iy } = input.axes();
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      let wx = ix * cos - iy * sin;
      let wz = -ix * sin - iy * cos;
      const len = Math.hypot(wx, wz);
      if (len > 1) {
        wx /= len;
        wz /= len;
      }
      const maxSpeed = input.running ? config.runSpeed : config.walkSpeed;
      const accel = grounded ? config.groundAccel : config.airAccel;
      velocity.x = THREE.MathUtils.damp(velocity.x, wx * maxSpeed, accel, dt);
      velocity.z = THREE.MathUtils.damp(velocity.z, wz * maxSpeed, accel, dt);

      if (grounded && input.consumeJump()) {
        velocity.y = config.jumpSpeed;
        grounded = false;
      }
      velocity.y -= config.gravity * dt;

      // --- Integrate and collide -----------------------------------------
      prev.x = position.x;
      prev.z = position.z;
      next.x = THREE.MathUtils.clamp(position.x + velocity.x * dt, -limit, limit);
      next.z = THREE.MathUtils.clamp(position.z + velocity.z * dt, -limit, limit);
      if (colliders.resolveCircle(next, config.radius, position.y)) {
        // Keep only the motion that survived the push-out, so the player
        // slides along walls instead of sticking to them.
        velocity.x = (next.x - prev.x) / dt;
        velocity.z = (next.z - prev.z) / dt;
      }
      position.x = next.x;
      position.z = next.z;
      position.y += velocity.y * dt;

      // --- Ground ---------------------------------------------------------
      const ground = terrain.heightAt(position.x, position.z);
      if (position.y <= ground) {
        position.y = ground;
        velocity.y = 0;
        grounded = true;
      } else if (grounded && velocity.y <= 0 && position.y - ground < config.stepDown) {
        // Walking downhill: stick to the surface instead of hopping off it.
        position.y = ground;
        velocity.y = 0;
      } else {
        grounded = false;
      }

      // --- Facing & animation ---------------------------------------------
      const speed = this.speed;
      if (speed > 0.3 && len > 0) {
        const target = Math.atan2(-velocity.x, -velocity.z);
        heading += wrapAngle(target - heading) * (1 - Math.exp(-config.turnRate * dt));
      }
      syncObject();
      character.animate(dt, speed, grounded);
    },
  };
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
