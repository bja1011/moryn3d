/**
 * Shader patch for MeshStandardMaterial that draws contour lines at a fixed
 * elevation interval. Lines are anti-aliased with fwidth() and fade out once
 * they get denser than a pixel, which prevents moiré at oblique angles.
 */
export function applyContourShader(material, { interval, strength, exaggeration }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uContourInterval = { value: interval };
    shader.uniforms.uContourStrength = { value: strength };
    shader.uniforms.uExaggeration = { value: exaggeration };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uExaggeration;
        varying float vElevation;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vElevation = position.y / uExaggeration;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uContourInterval;
        uniform float uContourStrength;
        varying float vElevation;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float e = vElevation / uContourInterval;
          float w = fwidth(e);
          float d = abs(fract(e - 0.5) - 0.5) / max(w, 1e-5);
          float line = (1.0 - min(d, 1.0)) * (1.0 - smoothstep(0.25, 0.6, w));
          diffuseColor.rgb *= 1.0 - line * uContourStrength;
        }`,
      );
  };
  // Lets three.js cache the patched program separately from unpatched ones.
  material.customProgramCacheKey = () => 'terrain-contours';
}
