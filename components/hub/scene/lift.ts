import * as THREE from "three";

/**
 * Shader hooks on shared materials, composed — and the buildings' lift.
 *
 * Several features patch three's shaders (`onBeforeCompile`): wind in the
 * foliage, lamps indoors, the hover lift below. A material can carry more
 * than one; `addShaderHook` chains them and keeps the program cache key
 * honest (one key per combination, so materials with the same hooks share
 * a program).
 *
 * The lift: a hovered building rises a few centimetres. Its still parts are
 * merged with every other building's (`batch.ts` — one draw call per
 * material for the whole island), so they cannot be moved as an object;
 * each merged vertex carries its building's number (`liftId`, 0 for
 * anything that never lifts) and rises by that building's entry in `LIFT`.
 */

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

// Kept beside the material, not in its userData (which three copies as JSON, dropping functions).
const hooksOf = new WeakMap<THREE.Material, { key: string; fn: Hook }[]>();

export function addShaderHook<T extends THREE.Material>(m: T, key: string, fn: Hook): T {
  let hooks = hooksOf.get(m);
  if (!hooks) {
    hooks = [];
    hooksOf.set(m, hooks);
  }
  if (hooks.some((h) => h.key === key)) return m;
  hooks.push({ key, fn });
  const list = hooks;
  m.onBeforeCompile = (shader) => {
    for (const h of list) h.fn(shader);
  };
  m.customProgramCacheKey = () => list.map((h) => h.key).join("+");
  return m;
}

/**
 * Slots of `LIFT`. 0 and 1 never lift: a vertex drawn without the attribute
 * reads WebGL's generic value for it, which is 0 — or 1 if another shader
 * left its default there. Buildings take slots from `FIRST_LIFT_SLOT`.
 */
export const LIFT_SLOTS = 16;
export const FIRST_LIFT_SLOT = 2;

/** Each building's current lift, in world units: written by `Building` every frame, read by the shaders. */
export const LIFT = { value: new Float32Array(LIFT_SLOTS) };

/** The attribute a merged vertex carries: which building it belongs to. */
export const LIFT_ATTRIBUTE = "liftId";

export function withLift<T extends THREE.Material>(m: T): T {
  return addShaderHook(m, "lift", (shader) => {
    shader.uniforms.uLift = LIFT;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float ${LIFT_ATTRIBUTE};\nuniform float uLift[${LIFT_SLOTS}];`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed.y += uLift[int(${LIFT_ATTRIBUTE} + 0.5)];`);
  });
}
