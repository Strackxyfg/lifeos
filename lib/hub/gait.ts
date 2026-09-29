/**
 * How the island's people move: joint angles for walking, running,
 * standing about and sitting — the poses the scene gives its figures, frame
 * by frame.
 *
 * A figure is a skeleton of simple segments: thighs and shins, upper arms
 * and forearms, a torso, a head. Angles are in radians, measured from
 * hanging straight down; a positive hip or shoulder angle swings the limb
 * forward, a positive knee bends the shin back, a positive elbow the
 * forearm forward.
 *
 * The walk is a textbook gait, simplified: legs in antiphase, each arm with
 * the opposite leg, the knee bent through the swing and nearly straight
 * under the body; the body rides as high as its stance leg allows, so the
 * supporting foot is always on the ground — never floating, never sunk.
 * Pure: the tests check exactly that.
 */

/** Segment lengths, in island units (a person is 0.46 tall). */
export const BODY = {
  thigh: 0.112,
  shin: 0.104,
  upperArm: 0.082,
  forearm: 0.078,
  /** Hip joints either side of the pelvis's centre. */
  hipWidth: 0.026,
  shoulderWidth: 0.052,
  /** From the hip joints to the shoulders. */
  torso: 0.15,
  headRadius: 0.036,
} as const;

export interface Pose {
  /** Left, right. */
  hip: [number, number];
  knee: [number, number];
  shoulder: [number, number];
  elbow: [number, number];
  /** Height of the hip joints above the ground. */
  hipHeight: number;
  /** Forward tilt of the torso. */
  lean: number;
  /** Side-to-side roll of the pelvis and torso. */
  sway: number;
  /** Turn of the head, left–right. */
  look: number;
}

const TAU = Math.PI * 2;

/** Height of a foot below its hip joint, for a thigh and knee angle. */
export function footDrop(hip: number, knee: number): number {
  return BODY.thigh * Math.cos(hip) + BODY.shin * Math.cos(hip - knee);
}

/** How far forward of its hip a foot is. */
export function footReach(hip: number, knee: number): number {
  return BODY.thigh * Math.sin(hip) + BODY.shin * Math.sin(hip - knee);
}

/**
 * Walking (`run` 0) or running (`run` 1), and anything between.
 * `phase` counts strides (one stride = two steps); its fraction is where in
 * the cycle the figure is.
 */
export function gaitPose(phase: number, run = 0): Pose {
  const r = Math.min(1, Math.max(0, run));
  const hipAmp = 0.42 + 0.22 * r;
  const kneeAmp = 0.62 + 0.75 * r;
  const armAmp = 0.34 + 0.25 * r;
  const leg = (p: number): [number, number] => {
    const a = TAU * p;
    const hip = hipAmp * Math.sin(a);
    // The knee bends as the leg swings through (thigh moving forward),
    // straightens as the foot reaches out, stays nearly straight under load.
    const swing = Math.max(0, Math.cos(a - 0.35));
    const knee = 0.06 + kneeAmp * swing * swing;
    return [hip, knee];
  };
  const [lh, lk] = leg(phase);
  const [rh, rk] = leg(phase + 0.5);
  // The body rides on the leg that reaches lower: its foot is on the ground.
  const hipHeight = Math.max(footDrop(lh, lk), footDrop(rh, rk));
  const armL = -armAmp * Math.sin(TAU * phase);
  const elbowBase = 0.25 + 1.15 * r;
  return {
    hip: [lh, rh],
    knee: [lk, rk],
    shoulder: [armL, -armL],
    elbow: [elbowBase + 0.2 * Math.max(0, armL), elbowBase + 0.2 * Math.max(0, -armL)],
    hipHeight,
    lean: 0.04 + 0.16 * r,
    sway: 0.035 * Math.sin(TAU * phase),
    look: 0,
  };
}

/** A gesture's weight at time `t`: now and then someone talking lifts a hand. */
function gesture(t: number, seed: number): number {
  const period = 5 + (seed % 7);
  const u = ((t + seed * 3.1) % period) / period;
  // A 1.2-second bell, once a period.
  const w = Math.max(0, 1 - Math.abs(u * period - 1) / 0.6);
  return w * w * (3 - 2 * w);
}

/** Standing, talking: weight shifting, a turn of the head, a hand lifted now and then. */
export function standPose(t: number, seed: number): Pose {
  const shift = Math.sin(t * 0.7 + seed) * 0.05;
  const g = gesture(t, seed);
  const straight = footDrop(0, 0.02);
  return {
    hip: [shift, -shift * 0.6],
    knee: [0.02 + Math.max(0, -shift) * 0.4, 0.02 + Math.max(0, shift) * 0.4],
    shoulder: [0.06 + g * 0.75, -0.04],
    elbow: [0.18 + g * 1.1, 0.15],
    hipHeight: Math.max(footDrop(shift, 0.02 + Math.max(0, -shift) * 0.4), footDrop(-shift * 0.6, 0.02 + Math.max(0, shift) * 0.4), straight - 0.002),
    lean: 0.01,
    sway: shift * 0.5,
    look: Math.sin(t * 0.45 + seed * 2) * 0.35,
  };
}

/** Sitting on a seat of height `seat`: thighs level, shins down, hands in the lap. */
export function sitPose(t: number, seed: number, seat: number): Pose {
  const g = gesture(t, seed + 11) * 0.8;
  return {
    hip: [1.45, 1.38],
    knee: [1.4, 1.2],
    shoulder: [0.35 + g * 0.5, 0.35],
    elbow: [1.05 + g * 0.5, 1.05],
    hipHeight: seat + 0.012,
    lean: -0.04 + Math.sin(t * 0.3 + seed) * 0.02,
    sway: 0,
    look: Math.sin(t * 0.35 + seed * 3) * 0.45,
  };
}

/** Distance covered by one stride (two steps), walking or running. */
export function strideLength(run = 0): number {
  return 0.36 + 0.24 * Math.min(1, Math.max(0, run));
}
