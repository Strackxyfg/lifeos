import * as THREE from "three";

/**
 * Window glass, as glass behaves: it reflects the sky by the Fresnel law —
 * little when seen straight on, almost everything at a grazing angle — and
 * lets through the rest, so a lit room shows through it at night and the
 * sky's reflection hides it by day.
 *
 * three's "transparent" multiplies the reflection by the opacity too, which
 * makes glass either a mirror or a hole. Here the shader writes
 * premultiplied colour: the reflected light at full strength, and an alpha
 * that is the fraction of what lies behind the pane that does *not* get
 * through (Fresnel reflectance plus a little absorption). The blend
 * (ONE, ONE_MINUS_SRC_ALPHA) then does the physics.
 *
 * The path tracer ignores shader tweaks: `userData.traced` tells it what the
 * pane is (a thin transmissive dielectric).
 */
export function windowGlass({
  tint = "#0c1418",
  absorb = 0.06,
  roughness = 0.03,
  ior = 1.5,
  coating = 1,
}: {
  /** The faint colour of the glass itself. */
  tint?: string;
  /** Fraction of light the pane absorbs (tinted office glass absorbs more). */
  absorb?: number;
  roughness?: number;
  /**
   * Plain glass is 1.5 (4 % reflected head-on). A coated curtain wall
   * reflects four to five times that: modelled as a higher index (2.3 → 16 %).
   */
  ior?: number;
  /** A reflective coating multiplies the head-on reflectance (1 = bare glass). */
  coating?: number;
} = {}): THREE.MeshPhysicalMaterial {
  const f0 = Math.min(1, ((ior - 1) / (ior + 1)) ** 2) * coating;
  const m = new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0,
    roughness,
    ior,
    specularIntensity: coating,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAbsorb = { value: absorb };
    shader.uniforms.uF0 = { value: f0 };
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uAbsorb;\nuniform float uF0;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        float glassNoV = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
        float glassF = uF0 + (1.0 - uF0) * pow(1.0 - glassNoV, 5.0);
        // Premultiplied: what the pane reflects (already Fresnel-weighted),
        // and how much of the world behind it it holds back.
        gl_FragColor = vec4(totalSpecular + totalDiffuse + totalEmissiveRadiance, clamp(glassF + uAbsorb, 0.0, 1.0));
        `
      );
  };
  // Distinct programs for distinct absorption: the uniform is baked per material.
  m.customProgramCacheKey = () => "window-glass";
  m.userData.traced = { transmission: 1, thickness: 0.01, roughness, ior, color: "#ffffff" };
  m.userData.absorb = absorb;
  return m;
}
