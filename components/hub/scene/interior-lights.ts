import * as THREE from "three";
import { addShaderHook } from "./lift";

/**
 * The buildings' own lamps, as light only the rooms receive.
 *
 * They used to be real point lights. In a forward renderer, every point
 * light is evaluated by every lit pixel on screen — the sea's edge, the
 * paving, every wall's outside — for a light that, behind walls, cannot
 * reach them: eighteen lamps made the whole island pay eighteen times, and
 * with no shadows the light even leaked through the walls onto the facades.
 *
 * Here the same lamps, with the same falloff (three's own
 * `getDistanceAttenuation`, the same range and decay) and the same shading
 * (three's own `RE_Direct`), are added only by the materials of what is
 * indoors: interior walls and ceilings, floors, furniture. The rooms look
 * exactly as lit; the rest of the island pays nothing, and a lamp no longer
 * glows through a wall.
 */

/** Every interior lamp on the island fits (they are counted in `interiors.ts`). */
export const MAX_LOCAL_LIGHTS = 16;
/** As the point lights had: their reach, and physical (inverse-square) decay. */
export const LOCAL_LIGHT_RANGE = 4.2;

const uniforms = {
  uLocalCount: { value: 0 },
  uLocalPos: { value: Array.from({ length: MAX_LOCAL_LIGHTS }, () => new THREE.Vector3()) },
  uLocalColor: { value: Array.from({ length: MAX_LOCAL_LIGHTS }, () => new THREE.Vector3()) },
  uLocalRange: { value: LOCAL_LIGHT_RANGE },
};

interface Entry {
  /** World positions. */
  positions: THREE.Vector3[];
  /** Linear RGB, already multiplied by the intensity (what a point light's uniform holds). */
  radiance: THREE.Vector3;
}

const entries = new Map<string, Entry>();

function rebuild() {
  let n = 0;
  for (const e of entries.values()) {
    for (const p of e.positions) {
      if (n >= MAX_LOCAL_LIGHTS) break;
      uniforms.uLocalPos.value[n].copy(p);
      uniforms.uLocalColor.value[n].copy(e.radiance);
      n++;
    }
  }
  uniforms.uLocalCount.value = n;
}

/** A building's lamps: where they are (world) and how bright, in its colour. */
export function setLocalLights(id: string, positions: THREE.Vector3[], color: THREE.Color, intensity: number): void {
  const radiance = new THREE.Vector3(color.r, color.g, color.b).multiplyScalar(intensity);
  entries.set(id, { positions: positions.map((p) => p.clone()), radiance });
  rebuild();
}

export function clearLocalLights(id: string): void {
  entries.delete(id);
  rebuild();
}

/** The lamps as they stand, for the path tracer (which lights with real point lights). */
export function localLightList(): { position: THREE.Vector3; color: THREE.Color; intensity: number }[] {
  const out: { position: THREE.Vector3; color: THREE.Color; intensity: number }[] = [];
  for (const e of entries.values()) {
    const intensity = Math.max(e.radiance.x, e.radiance.y, e.radiance.z);
    if (intensity <= 0) continue;
    const color = new THREE.Color(e.radiance.x / intensity, e.radiance.y / intensity, e.radiance.z / intensity);
    for (const p of e.positions) out.push({ position: p.clone(), color, intensity });
  }
  return out;
}

const DECLARE = /* glsl */ `
#define LOCAL_MAX ${MAX_LOCAL_LIGHTS}
uniform int uLocalCount;
uniform vec3 uLocalPos[LOCAL_MAX];
uniform vec3 uLocalColor[LOCAL_MAX];
uniform float uLocalRange;
`;

// Inside three's lighting, after its own lights: the same incident-light
// structure and the same BRDF (RE_Direct), so a lamp here shades exactly as
// a point light did.
const LOOP = /* glsl */ `
for ( int i = 0; i < LOCAL_MAX; i ++ ) {
  if ( i >= uLocalCount ) break;
  vec3 lVector = ( viewMatrix * vec4( uLocalPos[ i ], 1.0 ) ).xyz - geometryPosition;
  float lightDistance = length( lVector );
  if ( lightDistance >= uLocalRange ) continue;
  directLight.direction = lVector / max( lightDistance, 1e-4 );
  directLight.color = uLocalColor[ i ] * getDistanceAttenuation( lightDistance, uLocalRange, 2.0 );
  directLight.visible = true;
  RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
`;

/** Makes an indoor material receive the lamps. Its shader program is shared by every such material. */
export function withLocalLights<T extends THREE.MeshStandardMaterial>(m: T): T {
  return addShaderHook(m, "local-lights", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DECLARE}`)
      .replace("#include <lights_fragment_begin>", `#include <lights_fragment_begin>\n${LOOP}`);
  });
}
