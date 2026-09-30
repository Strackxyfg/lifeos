import * as THREE from "three";

/*
 * Measured with frozen time, the same frame in both formats, no grain
 * (1600×900, dusk, night and noon): R11G11B10 against RGBA16F differs by a
 * mean of 0.15 / 0.25 / 0.6 codes of 255 (R/G/B, darker: this GPU rounds
 * towards zero), under 0.25 % of the range and far below what an eye can
 * tell; undithered, a wide gradient's contours move by ±1 code in coherent
 * bands, which the dither below breaks into noise.
 */

/**
 * The scene buffer's format: R11F_G11F_B10F — HDR in 32 bits a pixel, what
 * most game engines render their scene into — where the GPU multisamples
 * it at the count asked; otherwise RGBA16F, twice the bytes. Measured on
 * an Intel iGPU (ANGLE on Direct3D 11, 1600×900, 4× MSAA): resolving the
 * samples took 3.7 ms in RGBA16F and 0.8 ms in R11G11B10, and the bloom
 * and the grade, which read the buffer, got faster too — 19.2 → 13.7 ms a
 * frame in all. It has no alpha channel, which nothing here reads, and six
 * bits of mantissa (five in blue): wide smooth gradients add
 * `BUFFER_DITHER_GLSL` before writing, so its steps never show as bands.
 */
export function sceneFormat(gl: THREE.WebGLRenderer, samples: number): { format: THREE.PixelFormat; type: THREE.TextureDataType } {
  const ctx = gl.getContext();
  if (typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext && gl.extensions.has("EXT_color_buffer_float")) {
    if (samples === 0) return { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type };
    const counts = ctx.getInternalformatParameter(ctx.RENDERBUFFER, ctx.R11F_G11F_B10F, ctx.SAMPLES) as Int32Array | null;
    if (counts && Array.from(counts).some((n) => n >= samples)) return { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type };
  }
  return { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
}

/**
 * Noise of one step of the scene buffer's precision, for the shaders that
 * paint wide smooth gradients (the sky, the sea), added before they write:
 * undithered, an 11-bit float's steps would show as contour lines in a dusk
 * sky; dithered, they become a grain finer than the grade's own.
 */
export const BUFFER_DITHER_GLSL = /* glsl */ `
  vec3 bufferDither(vec3 c) {
    vec3 q = fract(vec3(gl_FragCoord.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    float n = fract((q.x + q.y) * q.z) - 0.5;
    return c * (1.0 + n * vec3(1.0 / 64.0, 1.0 / 64.0, 1.0 / 32.0));
  }
`;
