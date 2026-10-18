import * as THREE from 'three';

/**
 * Procedural low-poly hiker (~1.8 m) with a code-driven walk/run/jump cycle.
 * No external model is needed. To use a rigged glTF character instead, keep
 * the same interface: `object` plus `animate(dt, speed, grounded)`.
 *
 * Origin is at the feet; the character faces -z in local space.
 */
export function createCharacter({ jacket = '#c8452f', trousers = '#2f3b4c', skin = '#e6b897' } = {}) {
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const jacketMat = mat(jacket);
  const trousersMat = mat(trousers);
  const skinMat = mat(skin);
  const bootMat = mat('#3a2a1e');
  const packMat = mat('#5d6b3a');

  const root = new THREE.Group();
  root.name = 'player';
  const body = new THREE.Group(); // bobs and leans as a whole
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 10), jacketMat);
  torso.position.y = 1.2;
  torso.scale.set(1, 1, 0.75);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skinMat);
  head.position.y = 1.66;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), jacketMat);
  cap.position.y = 1.68;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.1), jacketMat);
  visor.position.set(0, 1.69, -0.15);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.16), packMat);
  pack.position.set(0, 1.25, 0.2);

  body.add(torso, head, cap, visor, pack);

  // Limbs hang from a pivot at the shoulder/hip so they swing naturally.
  const limb = (radius, length, material, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
    mesh.position.y = -(length / 2 + radius);
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  };
  const armL = limb(0.065, 0.5, jacketMat, -0.29, 1.43);
  const armR = limb(0.065, 0.5, jacketMat, 0.29, 1.43);
  const legL = limb(0.09, 0.66, trousersMat, -0.11, 0.9);
  const legR = limb(0.09, 0.66, trousersMat, 0.11, 0.9);

  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.26), bootMat);
    boot.position.set(0, -0.86, -0.04);
    leg.add(boot);
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  let phase = 0;
  let airBlend = 0;

  return {
    object: root,

    /** @param speed horizontal speed in m/s; @param grounded on the ground this frame */
    animate(dt, speed, grounded) {
      const stride = Math.min(speed / 4.5, 1.8); // 0 idle … 1 walk … 1.8 sprint
      phase += dt * (4 + speed * 1.1);
      airBlend = THREE.MathUtils.damp(airBlend, grounded ? 0 : 1, 12, dt);

      const swing = Math.sin(phase) * 0.55 * Math.min(stride, 1.3) * (1 - airBlend);
      legL.rotation.x = swing - airBlend * 0.5;
      legR.rotation.x = -swing + airBlend * 0.3;
      armL.rotation.x = -swing * 0.9 - airBlend * 2.2;
      armR.rotation.x = swing * 0.9 - airBlend * 2.2;
      armL.rotation.z = -0.08 - airBlend * 0.3;
      armR.rotation.z = 0.08 + airBlend * 0.3;

      // Idle breathing, step bob and forward lean when running.
      const idle = stride < 0.05 ? Math.sin(performance.now() * 0.002) * 0.01 : 0;
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * Math.min(stride, 1.2) * (1 - airBlend) + idle;
      body.rotation.x = THREE.MathUtils.damp(body.rotation.x, -0.12 * Math.max(0, stride - 1), 8, dt);
    },
  };
}
