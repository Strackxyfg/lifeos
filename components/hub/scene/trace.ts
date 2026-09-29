import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { PLAZA_LAMPS, shoreField, WATERFRONT_LAMPS } from "@/lib/hub/island";
import { BEND, BEND_START, WATER_LEVEL } from "./water";
import { skyFragment } from "./sky";

/**
 * The island as the path tracer sees it: a still copy of the live scene,
 * translated into what a physically based ray tracer understands.
 *
 * - Instanced meshes (trees, lamps, people, gulls) are baked into plain
 *   geometry — the tracer ignores instance matrices.
 * - Shader materials (the sky dome, the sea, the lighthouse's beams) have no
 *   meaning to it: the sky becomes an HDR background baked from the dome's
 *   own shader (clouds, sun, moon, stars) and the environment the sky map
 *   (`SkyProvider`); the sea becomes real water — a dielectric of index
 *   1.33 over the same deep-blue-to-turquoise body, curved like the live one.
 * - Window glass becomes what it is: a thin transmissive pane.
 * - Glowing fixtures become emitters; the street lamps, which the live view
 *   fakes with pools of light, become real lights.
 * - Decals that only exist for the rasteriser (light pools, contact
 *   shadows, the selection ring) are left out: the tracer computes the real
 *   thing.
 */

export interface TraceOptions {
  /** The sky map (equirectangular HDR render target texture). */
  skyMap: THREE.Texture;
  /** How lit the town is, 0–1. */
  lamps: number;
  /** Scale for the town's own lights, as the live view uses (`lightScale`). */
  lightScale: number;
}

export interface TraceScene {
  scene: THREE.Scene;
  dispose(): void;
}

/** Reads a float/half render target into a CPU-side half-float equirect texture. */
function readEquirect(gl: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): THREE.DataTexture {
  const { width, height } = rt;
  const data = new Uint16Array(width * height * 4);
  gl.readRenderTargetPixels(rt, 0, 0, width, height, data);
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** The live sky dome's shader, run for every direction into an equirectangular map. */
function bakeSky(gl: THREE.WebGLRenderer, dome: THREE.ShaderMaterial): THREE.DataTexture {
  const width = 2048;
  const rt = new THREE.WebGLRenderTarget(width, width / 2, { type: THREE.HalfFloatType, depthBuffer: false });
  const fragment = skyFragment
    .replace("varying vec3 vDir;", "varying vec2 vUv;")
    .replace(
      "vec3 d = normalize(vDir);",
      "float phi = (vUv.x - 0.5) * 6.283185307; float theta = (vUv.y - 0.5) * 3.141592654; vec3 d = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));"
    );
  const material = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: fragment,
    uniforms: THREE.UniformsUtils.clone(dome.uniforms),
    depthTest: false,
    depthWrite: false,
  });
  // The sky map is a render target's texture: clone copied the reference, keep it.
  material.uniforms.uSky.value = dome.uniforms.uSky.value;
  // The traced sea is curved like the live one; the background below the
  // horizontal holds the horizon's sky, so the two meet.
  material.uniforms.uDip.value = 0;
  const quad = new FullScreenQuad(material);
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  quad.render(gl);
  gl.setRenderTarget(previous);
  const out = readEquirect(gl, rt);
  quad.dispose();
  material.dispose();
  rt.dispose();
  return out;
}

/** The sea for the tracer: curved like the live one, its colour from the same shore field. */
function traceSea(disposables: { dispose(): void }[]): THREE.Mesh {
  const size = 300;
  const g = new THREE.PlaneGeometry(size, size, 220, 220);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const b = Math.max(0, Math.hypot(pos.getX(i), pos.getZ(i)) - BEND_START);
    pos.setY(i, -b * b * BEND);
  }
  g.computeVertexNormals();
  g.translate(0, WATER_LEVEL, 0);

  // Albedo: the water body, deep blue offshore, turquoise over the sand.
  const n = 1024;
  const extent = 36;
  const fieldSize = 288;
  const field = shoreField(fieldSize, extent, 5);
  const deep = [0.0055, 0.034, 0.078];
  const shallow = [0.05, 0.27, 0.3];
  const data = new Float32Array(n * n * 4);
  for (let row = 0; row < n; row++) {
    const z = -size / 2 + ((row + 0.5) / n) * size;
    for (let col = 0; col < n; col++) {
      const x = -size / 2 + ((col + 0.5) / n) * size;
      let s = 0;
      if (Math.abs(x) < extent && Math.abs(z) < extent) {
        const fc = Math.min(fieldSize - 1, Math.floor(((x + extent) / (2 * extent)) * fieldSize));
        const fr = Math.min(fieldSize - 1, Math.floor(((z + extent) / (2 * extent)) * fieldSize));
        s = field[fr * fieldSize + fc] / 255;
      }
      const t = Math.min(1, Math.max(0, (s - 0.05) / 0.9));
      const k = t * t * (3 - 2 * t);
      const i = (row * n + col) * 4;
      data[i] = deep[0] + (shallow[0] - deep[0]) * k;
      data[i + 1] = deep[1] + (shallow[1] - deep[1]) * k;
      data[i + 2] = deep[2] + (shallow[2] - deep[2]) * k;
      data[i + 3] = 1;
    }
  }
  // The plane's UV v runs along −z once rotated: rows are written from −z, so flip.
  const map = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  map.colorSpace = THREE.LinearSRGBColorSpace;
  map.flipY = true;
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  // Ripples: a tileable normal map from octaves of periodic value noise —
  // irregular, so the eye finds no repeating weave across the sea.
  const r = 512;
  const nm = new Uint8Array(r * r * 4);
  const lattice = (n: number, seed: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return (u: number, v: number) => {
      const x = (((u % 1) + 1) % 1) * n;
      const y = (((v % 1) + 1) % 1) * n;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => g[((j % n) * n + (i % n)) % g.length];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const octaves = [lattice(8, 11), lattice(16, 23), lattice(32, 37), lattice(64, 53)];
  const weights = [0.5, 0.28, 0.14, 0.08];
  const h = (u: number, v: number) => octaves.reduce((s, f, i) => s + f(u, v) * weights[i], 0);
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      const u = x / r;
      const v = y / r;
      const e = 1 / r;
      const dx = (h(u + e, v) - h(u - e, v)) / (2 * e);
      const dy = (h(u, v + e) - h(u, v - e)) / (2 * e);
      const nx = -dx * 0.006;
      const ny = -dy * 0.006;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * r + x) * 4;
      nm[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nm[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nm[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      nm[i + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(nm, r, r, THREE.RGBAFormat);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(size / 14, size / 14);
  normalMap.needsUpdate = true;

  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    map,
    normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.05,
    metalness: 0,
    ior: 1.333,
  });
  disposables.push(g, map, normalMap, material);
  return new THREE.Mesh(g, material);
}

function isHidden(m: THREE.Matrix4): boolean {
  return Math.abs(m.determinant()) < 1e-12;
}

/** An instanced mesh as plain geometry, its per-instance colours as vertex colours. */
function bakeInstances(mesh: THREE.InstancedMesh): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const base = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(base.attributes)) if (!["position", "normal", "uv"].includes(name)) base.deleteAttribute(name);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    if (isHidden(m)) continue;
    const g = base.clone();
    g.applyMatrix4(m);
    if (mesh.instanceColor) {
      mesh.getColorAt(i, c);
      const n = g.getAttribute("position").count;
      const arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        arr[k * 3] = c.r;
        arr[k * 3 + 1] = c.g;
        arr[k * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    }
    parts.push(g);
  }
  base.dispose();
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

type Traced = { transmission: number; thickness: number; roughness: number; ior: number; color: string };

/** What each live material becomes for the tracer; null to leave the mesh out. */
function traceMaterial(
  mat: THREE.Material,
  mesh: THREE.Object3D,
  cache: Map<THREE.Material, THREE.Material | null>,
  opts: TraceOptions,
  disposables: { dispose(): void }[]
): THREE.Material | null {
  if (cache.has(mat)) return cache.get(mat)!;
  let out: THREE.Material | null = mat;
  const traced = mat.userData?.traced as Traced | undefined;
  if (traced) {
    // Glass: a thin pane that transmits, reflects by its index, tints what passes.
    const g = mat as THREE.MeshPhysicalMaterial;
    const absorb = (g as THREE.MeshPhysicalMaterial & { userData: { absorb?: number } }).userData.absorb ?? 0.05;
    out = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(Math.sqrt(1 - absorb)),
      transmission: 1,
      thickness: 0,
      roughness: traced.roughness,
      ior: traced.ior,
      specularIntensity: g.specularIntensity,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    disposables.push(out);
  } else if (mat instanceof THREE.ShaderMaterial || mat instanceof THREE.PointsMaterial || mat instanceof THREE.LineBasicMaterial) {
    out = null;
  } else if (mat instanceof THREE.MeshBasicMaterial) {
    // Glowing fixtures (screens, bulbs, LEDs) become emitters in their
    // building's light; every other basic material is a raster-only trick.
    const hue = mesh.userData.traceEmissive as string | undefined;
    if (hue) {
      out = new THREE.MeshStandardMaterial({
        color: "#000000",
        emissive: new THREE.Color(hue).lerp(new THREE.Color("#ffffff"), 0.35),
        emissiveIntensity: 2.2 * opts.lightScale * (0.55 + 0.45 * opts.lamps),
        roughness: 0.4,
      });
      disposables.push(out);
    } else out = null;
  } else if (
    mat.transparent &&
    (mat as THREE.MeshStandardMaterial).opacity < 1 &&
    !((mat as THREE.MeshStandardMaterial).emissiveIntensity > 0)
  ) {
    // A see-through dome: the tracer takes it as thin glass too.
    const s = mat as THREE.MeshStandardMaterial;
    out = new THREE.MeshPhysicalMaterial({ color: s.color, transmission: 1, thickness: 0, roughness: s.roughness, ior: 1.5, side: THREE.DoubleSide });
    disposables.push(out);
  }
  cache.set(mat, out);
  return out;
}

/** Builds the tracer's scene from the live one. */
export function buildTraceScene(gl: THREE.WebGLRenderer, live: THREE.Scene, opts: TraceOptions): TraceScene {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const cache = new Map<THREE.Material, THREE.Material | null>();
  const colored = new Map<THREE.Material, THREE.Material>();
  live.updateMatrixWorld(true);

  let dome: THREE.ShaderMaterial | null = null;

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], world: THREE.Matrix4) => {
    const p = new THREE.Mesh(geometry, material);
    p.matrixAutoUpdate = false;
    p.matrix.copy(world);
    scene.add(p);
  };

  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if (o instanceof THREE.DirectionalLight) {
      const l = new THREE.DirectionalLight(o.color, o.intensity);
      l.position.setFromMatrixPosition(o.matrixWorld);
      l.target.position.setFromMatrixPosition(o.target.matrixWorld);
      scene.add(l, l.target);
    } else if (o instanceof THREE.PointLight) {
      const l = new THREE.PointLight(o.color, o.intensity, o.distance, o.decay);
      l.position.setFromMatrixPosition(o.matrixWorld);
      scene.add(l);
    } else if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m instanceof THREE.ShaderMaterial && (m as THREE.ShaderMaterial).uniforms?.uMoonDisc)) {
        dome = mats[0] as THREE.ShaderMaterial;
        return;
      }
      const traced = mats.map((m) => traceMaterial(m, o, cache, opts, disposables));
      if (traced.some((m) => m === null)) return;
      if (o instanceof THREE.InstancedMesh) {
        const g = bakeInstances(o);
        if (!g) return;
        disposables.push(g);
        let mat = traced[0]!;
        if (o.instanceColor) {
          // Per-instance colours now live in the vertices.
          let c = colored.get(mat);
          if (!c) {
            c = mat.clone();
            (c as THREE.MeshStandardMaterial).vertexColors = true;
            (c as THREE.MeshStandardMaterial).color?.set("#ffffff");
            colored.set(mat, c);
            disposables.push(c);
          }
          mat = c;
        }
        add(g, mat, o.matrixWorld);
      } else {
        add(o.geometry, Array.isArray(o.material) ? (traced as THREE.Material[]) : traced[0]!, o.matrixWorld);
      }
    }
    for (const child of o.children) walk(child);
  };
  walk(live);

  scene.add(traceSea(disposables));

  // The street lamps, as real lights once the town is lit.
  if (opts.lamps > 0.05) {
    for (const [x, z] of [...PLAZA_LAMPS, ...WATERFRONT_LAMPS]) {
      const l = new THREE.PointLight("#ffc98a", 0.55 * opts.lamps, 4.5, 2);
      l.position.set(x, 1.18, z);
      scene.add(l);
    }
  }

  const env = readEquirect(gl, (opts.skyMap as THREE.Texture & { renderTarget?: THREE.WebGLRenderTarget }).renderTarget!);
  disposables.push(env);
  scene.environment = env;
  scene.environmentIntensity = 1;
  if (dome) {
    const background = bakeSky(gl, dome);
    disposables.push(background);
    scene.background = background;
  } else {
    scene.background = env;
  }

  return {
    scene,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
