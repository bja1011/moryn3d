/**
 * Shader patch for MeshStandardMaterial that paints windows onto building walls.
 *
 * Each wall vertex carries `aWall = (u, wallLength, groundY, eaveY)`:
 *   u          distance along the wall from its start (m)
 *   wallLength 0 disables windows (roofs, gables, sheds, short wall segments)
 *   groundY    height that the storey grid is measured from
 *   eaveY      no window may extend above this
 *
 * Windows are centred in equal cells along each wall, one row per storey.
 * Once the pattern shrinks below a pixel it fades to its average colour, so
 * distant facades don't shimmer.
 */
export function applyWindowShader(material, { levelHeight, spacing }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLevelHeight = { value: levelHeight };
    shader.uniforms.uWindowSpacing = { value: spacing };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec4 aWall;
        varying vec4 vWall;
        varying float vWorldY;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vWall = aWall;
        vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uLevelHeight;
        uniform float uWindowSpacing;
        varying vec4 vWall;
        varying float vWorldY;

        // Anti-aliased 1D box: 1 inside [a, b], 0 outside.
        float band(float x, float a, float b, float w) {
          return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float windowMask = 0.0;
        if (vWall.y > 1.6) {
          float cells = max(1.0, floor(vWall.y / uWindowSpacing));
          float x = vWall.x / (vWall.y / cells);
          float h = vWorldY - vWall.z;
          float y = h / uLevelHeight;
          vec2 fw = fwidth(vec2(x, y));
          vec2 f = fract(vec2(x, y));

          float glass = band(f.x, 0.30, 0.70, fw.x) * band(f.y, 0.30, 0.78, fw.y);
          float frame = band(f.x, 0.26, 0.74, fw.x) * band(f.y, 0.26, 0.82, fw.y) - glass;

          // Only whole windows that fit between the ground and the eaves.
          float windowTop = (floor(y) + 0.82) * uLevelHeight;
          float fits = step(0.0, y) * step(windowTop, vWall.w - vWall.z - 0.2);

          float lod = smoothstep(0.12, 0.4, max(fw.x, fw.y));
          windowMask = mix(glass, 0.19, lod) * fits;
          float frameMask = mix(frame, 0.0, lod) * fits;

          // Small per-window variation so facades don't look stamped.
          float id = fract(sin(dot(floor(vec2(x, y)), vec2(12.9898, 78.233)) + vWall.y * 3.1) * 43758.5453);
          vec3 glassColor = mix(vec3(0.06, 0.08, 0.10), vec3(0.17, 0.20, 0.24), id);

          diffuseColor.rgb *= 1.0 - frameMask * 0.35;
          diffuseColor.rgb = mix(diffuseColor.rgb, glassColor, windowMask);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, windowMask); // glass reflects the sky`,
      );
  };
  material.customProgramCacheKey = () => 'building-windows';
}
