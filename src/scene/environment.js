import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * Atmosphere: physical sky, sky-derived environment lighting, a hemisphere
 * fill, exponential fog and a shadow-casting sun.
 *
 * Covering 5.64 km with one shadow map would give ~1.4 m texels, which is too
 * coarse for houses. Instead the shadow frustum follows the orbit target and
 * scales with zoom: sharp shadows close up, whole-valley shadows far out.
 */
export function createEnvironment(renderer, scene, config) {
  const sunDir = sunDirection(config.sunAzimuth, config.sunElevation);
  const fogColor = new THREE.Color(config.fogColor);

  // Visible sky dome. It must stay inside the camera far plane.
  const sky = makeSky(sunDir);
  sky.scale.setScalar(20000);
  scene.add(sky);

  // Image-based lighting from a small copy of the same sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSky(sunDir);
  envSky.scale.setScalar(500);
  envSky.material.uniforms.cloudCoverage.value = 0; // a static env map should not bake in clouds
  envScene.add(envSky);
  const envMap = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.3;

  scene.fog = new THREE.FogExp2(fogColor, config.fogDensity);
  scene.background = fogColor;

  const hemi = new THREE.HemisphereLight('#d6e6f5', '#6b5a43', 0.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(config.shadowMapSize);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 12000;
  sun.shadow.bias = -0.0003;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // Light-space basis, used to snap the shadow frustum to whole texels so
  // shadows do not shimmer while panning.
  const forward = sunDir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const snapped = new THREE.Vector3();
  let currentHalf = 0;

  return {
    sun,
    sky,

    /** Re-centres the shadow frustum on the orbit target. Call once per frame. */
    update(target, cameraDistance, elapsed) {
      const half = THREE.MathUtils.clamp(cameraDistance * 0.9, 120, 3200);
      const shadowCam = sun.shadow.camera;
      if (Math.abs(half - currentHalf) > currentHalf * 0.05) {
        currentHalf = half;
        shadowCam.left = shadowCam.bottom = -half;
        shadowCam.right = shadowCam.top = half;
        shadowCam.updateProjectionMatrix();
        sun.shadow.normalBias = ((2 * half) / config.shadowMapSize) * 1.5;
      }

      const texel = (2 * currentHalf) / config.shadowMapSize;
      const r = target.dot(right);
      const u = target.dot(up);
      snapped
        .copy(target)
        .addScaledVector(right, Math.round(r / texel) * texel - r)
        .addScaledVector(up, Math.round(u / texel) * texel - u);

      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, 6000);

      sky.material.uniforms.time.value = elapsed;
    },
  };
}

function makeSky(sunDir) {
  const sky = new Sky();
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.35;
  u.sunPosition.value.copy(sunDir);
  return sky;
}

/** Unit vector toward the sun in the scene frame (x east, y up, z south). */
function sunDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}
