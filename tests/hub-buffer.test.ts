import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { BUFFER_DITHER_GLSL, sceneFormat } from "@/components/hub/scene/buffer";

// A WebGL2 context as far as sceneFormat looks: the class, the enums, the sample counts.
class FakeWebGL2 {
  RENDERBUFFER = 0x8d41;
  R11F_G11F_B10F = 0x8c3a;
  SAMPLES = 0x80a9;
  constructor(private counts: number[] | null) {}
  getInternalformatParameter(target: number, format: number, pname: number) {
    expect([target, format, pname]).toEqual([this.RENDERBUFFER, this.R11F_G11F_B10F, this.SAMPLES]);
    return this.counts ? Int32Array.from(this.counts) : null;
  }
}

const renderer = (ctx: unknown, floatBuffers: boolean) =>
  ({ getContext: () => ctx, extensions: { has: (n: string) => n === "EXT_color_buffer_float" && floatBuffers } }) as unknown as THREE.WebGLRenderer;

const R11 = { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type };
const HALF = { format: THREE.RGBAFormat, type: THREE.HalfFloatType };

describe("the scene buffer's format", () => {
  const g = globalThis as unknown as { WebGL2RenderingContext?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.WebGL2RenderingContext;
    g.WebGL2RenderingContext = FakeWebGL2;
  });
  afterEach(() => {
    g.WebGL2RenderingContext = saved;
  });

  it("is 11-bit floats where the GPU multisamples them at the count asked", () => {
    expect(sceneFormat(renderer(new FakeWebGL2([8, 4, 2]), true), 4)).toEqual(R11);
    expect(sceneFormat(renderer(new FakeWebGL2([4]), true), 4)).toEqual(R11);
    expect(sceneFormat(renderer(new FakeWebGL2(null), true), 0)).toEqual(R11);
  });

  it("falls back to half floats rather than a buffer that cannot be drawn into", () => {
    // Fewer samples than asked: a renderbuffer of this format would be refused.
    expect(sceneFormat(renderer(new FakeWebGL2([2]), true), 4)).toEqual(HALF);
    expect(sceneFormat(renderer(new FakeWebGL2([]), true), 4)).toEqual(HALF);
    // No float colour buffers at all.
    expect(sceneFormat(renderer(new FakeWebGL2([8, 4]), false), 4)).toEqual(HALF);
    // WebGL 1.
    expect(sceneFormat(renderer({}, true), 4)).toEqual(HALF);
  });

  it("dithers by one step of the format's precision: 6 bits of mantissa, 5 in blue", () => {
    expect(BUFFER_DITHER_GLSL).toContain("vec3(1.0 / 64.0, 1.0 / 64.0, 1.0 / 32.0)");
    // Zero-mean: the noise is centred, it does not brighten.
    expect(BUFFER_DITHER_GLSL).toMatch(/fract\(\(q\.x \+ q\.y\) \* q\.z\) - 0\.5/);
  });
});
