import * as THREE from "three";
import { GLYPHS } from "@/lib/hub/glyphs";
import { seeded } from "@/lib/hub/island";
import type { DistrictId } from "@/lib/hub/districts";
import { windowGlass } from "./glass";
import { withLocalLights } from "./interior-lights";
import { addShaderHook, withLift } from "./lift";

/**
 * The island's materials and generated textures, made once and shared.
 *
 * One material per surface kind, not per mesh: fewer shader programs, and the
 * night can switch the whole city on by changing a handful of numbers
 * (`setLamps`) instead of walking the scene. Every texture is drawn on a
 * canvas here — nothing is downloaded.
 */

export interface HubMaterials {
  white: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  path: THREE.MeshStandardMaterial;
  coast: THREE.MeshStandardMaterial;
  grey: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  storefront: THREE.MeshStandardMaterial;
  /** The second brain's dome: clear glass, so the crystal brain shows through it. */
  dome: THREE.MeshPhysicalMaterial;
  navy: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  cypress: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  cream: THREE.MeshStandardMaterial;
  crane: THREE.MeshStandardMaterial;
  pool: THREE.MeshStandardMaterial;
  lampHead: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  lantern: THREE.MeshStandardMaterial;
  dial: THREE.MeshStandardMaterial;
  hand: THREE.MeshStandardMaterial;
  /** Inside walls and ceilings: they see the sky only through the windows. */
  interior: THREE.MeshStandardMaterial;
  /** The same, for surfaces seen from their back (the hangar's vault). */
  interiorBack: THREE.MeshStandardMaterial;
  floorWood: THREE.MeshStandardMaterial;
  floorStone: THREE.MeshStandardMaterial;
  /** Office floors lit by their ceiling panels at night (the panels' light, without a light per floor). */
  officeFloor: THREE.MeshStandardMaterial;
  /** The lighthouse's Fresnel lens: cut glass, blazing at night. */
  lens: THREE.MeshStandardMaterial;
  /** A shop window: clear, reflecting by the Fresnel law. */
  shopGlass: THREE.MeshPhysicalMaterial;
  /** Office curtain wall: coated, reflects more, a slight tint. */
  officeGlass: THREE.MeshPhysicalMaterial;
}

let shared: HubMaterials | null = null;

// Every surface of the island can be part of a merged, lifting building (`lift.ts`).
const std = (params: THREE.MeshStandardMaterialParameters) => withLift(new THREE.MeshStandardMaterial(params));

/**
 * Sharpness of generated textures seen close or at a grazing angle: sized
 * so a wall or the plaza stays crisp when the camera flies up to a
 * building, filtered anisotropically (three clamps this to what the GPU
 * offers — 16 on desktops) so the paving does not smear towards the horizon.
 */
const ANISOTROPY = 16;

/** How much of the sky's ambient light reaches indoor surfaces. */
export const INDOOR_SKY = 0.1;

/** Warm window light, the colour of a lit room seen from outside. */
export const WINDOW_LIGHT = new THREE.Color("#ffc98a");

/**
 * How much of the night's glow a building's own lights keep by day. They are
 * on all day, as in any office or shop — only the sun outshines them.
 *
 * Measured against the grade (the camera opens up at night): a lamp's
 * perceived brightness goes as its level × 2^(0.18 × exposure), from −0.4
 * stops at noon to 3.3 at night. At 0.12, the old day level, rooms kept 7 %
 * of their night brightness — dark behind the glass. At 0.4 they keep about
 * a quarter: lit, visibly weaker than at night.
 */
export const DAY_BACKLIGHT = 0.4;

/** A building's own lights, from `SkyState.lamps` (0 by day, 1 at night): never off. */
export function backlight(lamps: number): number {
  return DAY_BACKLIGHT + (1 - DAY_BACKLIGHT) * Math.min(1, Math.max(0, lamps));
}

export function hubMaterials(): HubMaterials {
  if (shared) return shared;
  const windows = windowTexture();
  const shopWindows = windowTexture(2, 1, 0.85);
  shared = {
    // Albedos of real materials, not of paint on a screen: lime plaster
    // reflects about 70 % of light, pale stone paving under half.
    white: std({ color: "#dcd9d2", roughness: 0.62 }),
    trim: std({ color: "#e9e7e2", roughness: 0.48 }),
    paving: std({ color: "#c2bcb0", roughness: 0.92, map: pavingTexture() }),
    path: std({ color: "#cfc9bd", roughness: 0.9 }),
    coast: std({ color: "#a8a297", roughness: 0.95 }),
    grey: std({ color: "#b8bcc3", roughness: 0.6 }),
    metal: std({ color: "#2b313b", roughness: 0.38, metalness: 0.6 }),
    glass: std({
      color: "#22344a",
      roughness: 0.08,
      metalness: 0.85,
      envMapIntensity: 1.35,
      emissive: WINDOW_LIGHT,
      emissiveMap: windows,
      emissiveIntensity: 0,
    }),
    storefront: std({
      color: "#2a3a4c",
      roughness: 0.1,
      metalness: 0.7,
      envMapIntensity: 1.2,
      emissive: WINDOW_LIGHT,
      emissiveMap: shopWindows,
      emissiveIntensity: 0.12,
    }),
    // Glass as glass behaves (`glass.ts`): it reflects the sky at a grazing
    // angle and lets the crystal brain show through straight on. It used to
    // be a pale blue shell at a third of opacity — reflections included —
    // which hid the brain behind the sky's reflection.
    dome: windowGlass({ tint: "#0c1522", absorb: 0.03, roughness: 0.02 }),
    navy: std({ color: "#17243f", roughness: 0.45 }),
    grass: std({ color: "#5f8a3c", roughness: 1 }),
    leaf: swaying(std({ color: "#46743a", roughness: 0.85 })),
    cypress: swaying(std({ color: "#325c2f", roughness: 0.9 })),
    trunk: std({ color: "#6c513c", roughness: 0.9 }),
    wood: std({ color: "#a07a55", roughness: 0.78 }),
    rock: std({ color: "#8f8b85", roughness: 1, flatShading: true }),
    cream: std({ color: "#f6f1e7", roughness: 0.7, side: THREE.DoubleSide }),
    crane: std({ color: "#f0b429", roughness: 0.5 }),
    pool: std({ color: "#7fd3e6", roughness: 0.06, metalness: 0.1, emissive: new THREE.Color("#5fd0ff"), emissiveIntensity: 0 }),
    lampHead: std({ color: "#fff4df", roughness: 0.3, emissive: WINDOW_LIGHT, emissiveIntensity: 0 }),
    beacon: std({ color: "#ff453a", roughness: 0.4, emissive: new THREE.Color("#ff2d20"), emissiveIntensity: 0.6 }),
    lantern: std({
      color: "#fff3c4",
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.8,
      emissive: new THREE.Color("#ffe39a"),
      emissiveIntensity: 0,
    }),
    dial: std({ color: "#ffffff", roughness: 0.4, map: dialTexture(), emissive: new THREE.Color("#fff6e0"), emissiveMap: null, emissiveIntensity: 0 }),
    hand: std({ color: "#1c2233", roughness: 0.5 }),
    // Indoors, the sky's light arrives only through the windows: a few per
    // cent of what falls outside. The rooms are lit by their own lamps.
    // Only indoor surfaces receive the buildings' lamps (`interior-lights.ts`).
    interior: withLocalLights(std({ color: "#e6e1d7", roughness: 0.85, envMapIntensity: INDOOR_SKY })),
    interiorBack: withLocalLights(std({ color: "#e6e1d7", roughness: 0.85, envMapIntensity: INDOOR_SKY, side: THREE.BackSide })),
    floorWood: withLocalLights(std({ color: "#8a6446", roughness: 0.5, envMapIntensity: INDOOR_SKY * 1.4, map: plankTexture() })),
    floorStone: withLocalLights(std({ color: "#b8b2a7", roughness: 0.35, envMapIntensity: INDOOR_SKY * 1.4 })),
    officeFloor: withLocalLights(
      std({ color: "#9a958c", roughness: 0.6, envMapIntensity: INDOOR_SKY * 1.4, emissive: new THREE.Color("#cdeedd"), emissiveIntensity: 0 })
    ),
    lens: std({ color: "#fdf6e0", roughness: 0.08, metalness: 0.4, envMapIntensity: 1.6, emissive: new THREE.Color("#ffe6a3"), emissiveIntensity: 0 }),
    shopGlass: windowGlass({ tint: "#0b1215", absorb: 0.05, roughness: 0.02 }),
    // Solar-control glass lets through about half the light each way.
    officeGlass: windowGlass({ tint: "#0d1a20", absorb: 0.45, roughness: 0.03, ior: 2.3, coating: 1.9 }),
  };
  return shared;
}

/** Seconds of wind, advanced by the trees' frame loop and read by the foliage's shader. */
export const wind = { value: 0 };

/**
 * Foliage that moves: crowns bend with the wind, more at the top than at
 * the trunk, each tree on its own rhythm (from where it stands), with a
 * slower gust over a quicker flutter.
 */
function swaying(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return addShaderHook(m, "swaying", (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind;").replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 treeAt = vec3(instanceMatrix[3]);
      #else
        vec3 treeAt = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float bend = smoothstep(-0.8, 1.0, position.y);
      float gust = sin(uWind * 0.9 + treeAt.x * 0.37 + treeAt.z * 0.21) * 0.6 + sin(uWind * 2.3 + treeAt.z * 0.9) * 0.25;
      float flutter = sin(uWind * 7.0 + position.x * 9.0 + position.z * 7.0) * 0.12;
      transformed.x += (gust + flutter) * 0.045 * bend;
      transformed.z += (cos(uWind * 1.1 + treeAt.x) * 0.5 + flutter) * 0.03 * bend;`
    );
  });
}

/** Signs are one material each (their own texture); they register here to be lit. */
export const signMaterials = new Set<THREE.MeshStandardMaterial>();
let currentLamps = 0;
let currentScale = 1;

export function signGlow(lamps: number, scale = currentScale): number {
  return (0.22 + lamps * 1.1) * scale;
}

/** The lamps level last applied — for a sign created after nightfall. */
export function lampsNow(): number {
  return currentLamps;
}

/**
 * How bright the town's own lights are in scene units, for the exposure of
 * the moment. Real lamps keep their radiance while the camera opens up at
 * night; carried all the way, they would blind at night or vanish at noon.
 * Most, not all, of the exposure is compensated: a lamp still reads brighter
 * at night than at dusk — as it does to the eye.
 */
export function lightScale(exposure: number): number {
  return Math.pow(2, -0.82 * exposure);
}

/** The scale last applied, for lights drawn outside `setLamps` (lamp halos, pools). */
export function lightScaleNow(): number {
  return currentScale;
}

/**
 * Turns the city's lights up for the night: windows, lamps, the pool, the
 * clock faces, the signs and the lighthouse. `lamps` is `SkyState.lamps`, 0 by
 * day and 1 at night; `exposure` the metered exposure (stops).
 */
export function setLamps(lamps: number, exposure = 0): void {
  currentLamps = lamps;
  const k = lightScale(exposure);
  currentScale = k;
  for (const s of signMaterials) s.emissiveIntensity = signGlow(lamps, k);
  const m = hubMaterials();
  // Lit rooms seen through the facades: by day too, weaker than at night.
  m.glass.emissiveIntensity = backlight(lamps) * 1.15 * k;
  m.storefront.emissiveIntensity = backlight(lamps) * 1.72 * k;
  m.lampHead.emissiveIntensity = (0.1 + lamps * 3) * k;
  m.pool.emissiveIntensity = lamps * 0.55 * k;
  m.dial.emissiveIntensity = lamps * 0.6 * k;
  m.lantern.emissiveIntensity = lamps * 3.2 * k;
  m.beacon.emissiveIntensity = 0.6 * k;
  m.officeFloor.emissiveIntensity = backlight(lamps) * 0.34 * k;
  m.lens.emissiveIntensity = lamps * 4.5 * k;
}

/* ── Generated textures ──────────────────────────────────────────── */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx];
}

/**
 * A facade's lit windows, for night: a grid where most rooms are lit with a
 * slightly different warmth and some are dark, as in any real building at
 * nine in the evening. Black is "off".
 */
function windowTexture(cols = 6, rows = 4, lit = 0.7): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const rnd = seeded(cols * 31 + rows);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  const cw = S / cols;
  const ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rnd() > lit) continue;
      const warm = 0.65 + rnd() * 0.35;
      ctx.fillStyle = `rgb(${Math.round(255 * warm)}, ${Math.round(220 * warm)}, ${Math.round(170 * warm)})`;
      ctx.fillRect(x * cw + cw * 0.12, y * ch + ch * 0.14, cw * 0.76, ch * 0.72);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISOTROPY;
  return t;
}

/** The plaza's paving: fine joints, as concentric rings would be too busy from above. */
function pavingTexture(): THREE.CanvasTexture {
  // The same slabs as ever, drawn at four times the resolution (joints 4 px, not 1).
  const K = 4;
  const S = 256 * K;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, S, S);
  const rnd = seeded(99);
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 64) {
      const shade = 244 + Math.floor(rnd() * 10);
      ctx.fillStyle = `rgb(${shade},${shade},${shade - 2})`;
      const off = (y / 32) % 2 ? 32 : 0;
      ctx.fillRect((x + off + 1) * K, (y + 1) * K, 62 * K, 30 * K);
      ctx.fillRect((x + off - 64 + 1) * K, (y + 1) * K, 62 * K, 30 * K);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.anisotropy = ANISOTROPY;
  return t;
}

/** Floor planks: long boards, each a slightly different tone, staggered joints. */
function plankTexture(): THREE.CanvasTexture {
  const K = 2;
  const [c, ctx] = canvas(256 * K, 256 * K);
  ctx.scale(K, K);
  const rnd = seeded(404);
  const rows = 8;
  const h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 128;
    while (x < 256) {
      const len = 90 + rnd() * 110;
      const tone = 205 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(x + 1, r * h + 1, len - 2, h - 2);
      x += len;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 2.5);
  t.anisotropy = ANISOTROPY;
  return t;
}

/** A clock dial: white, twelve marks, the quarters stronger. Hands are meshes. */
function dialTexture(): THREE.CanvasTexture {
  const K = 2;
  const [c, ctx] = canvas(256 * K, 256 * K);
  ctx.scale(K, K);
  ctx.fillStyle = "#fbfaf6";
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1c2233";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const quarter = i % 3 === 0;
    const r1 = quarter ? 86 : 96;
    ctx.lineWidth = quarter ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1);
    ctx.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISOTROPY;
  return t;
}

/** A soft round glow, for lamp halos, light pools on the ground and stars of light. */
let glow: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.55)");
  g.addColorStop(0.55, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

/**
 * A building's sign: its pictogram and its name in capitals, white on navy,
 * in the app's own typeface. Emissive, so it lights up at night like a real
 * backlit sign. Returns the texture and its aspect ratio (width / height).
 */
export function signTexture(id: DistrictId, text: string, fontFamily: string): { texture: THREE.CanvasTexture; aspect: number } {
  // Laid out at 128 px and drawn at twice that: letters stay sharp when the camera comes close.
  const K = 2;
  const h = 128;
  const pad = 40;
  const icon = 64;
  const gap = 26;
  const font = `600 50px ${fontFamily}`;
  const [, measure] = canvas(8, 8);
  measure.font = font;
  const label = text.toUpperCase();
  // Letter-spaced by hand: canvas letterSpacing is not everywhere yet.
  const spacing = 5;
  const textWidth = [...label].reduce((w, ch) => w + measure.measureText(ch).width + spacing, -spacing);
  const w = Math.ceil(pad + icon + gap + textWidth + pad);
  const [c, ctx] = canvas(w * K, h * K);
  ctx.scale(K, K);

  ctx.fillStyle = "#17243f";
  roundRect(ctx, 0, 0, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 3;
  roundRect(ctx, 4, 4, w - 8, h - 8, 15);
  ctx.stroke();

  // Pictogram: the 24-unit Lucide paths, scaled and stroked.
  ctx.save();
  ctx.translate(pad, (h - icon) / 2);
  ctx.scale(icon / 24, icon / 24);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of GLYPHS[id]) ctx.stroke(new Path2D(d));
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = font;
  ctx.textBaseline = "middle";
  let x = pad + icon + gap;
  for (const ch of label) {
    ctx.fillText(ch, x, h / 2 + 3);
    x += measure.measureText(ch).width + spacing;
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = ANISOTROPY;
  return { texture, aspect: w / h };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
