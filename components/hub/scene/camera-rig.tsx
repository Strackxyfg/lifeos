"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import * as THREE from "three";
import { districtById, doorwayView, type DistrictId, type View } from "@/lib/hub/districts";
import { focusBox, focusView, lensFor, overview, type Band, type ScreenRect } from "@/lib/hub/framing";
import { pacer } from "../pacer-store";

export type CameraGoal = { kind: "overview" } | { kind: "focus"; id: DistrictId } | { kind: "enter"; id: DistrictId };

interface Tween {
  from: View;
  to: View;
  start: number;
  delay: number;
  duration: number;
  arc: number;
  kind: CameraGoal["kind"];
  easing: (t: number) => number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeIn = (t: number) => t * t * t;

/** What the page measured of its own panels, for the camera to frame around them. */
export interface Layout {
  /** The band the whole island goes in. */
  band?: Band | null;
  /** The part of the screen a building's panel leaves free. */
  free?: ScreenRect | null;
}

function viewFor(goal: CameraGoal, aspect: number, layout: Layout): View {
  const lens = lensFor(aspect);
  if (goal.kind === "overview") return overview(aspect, lens, layout.band ?? undefined);
  const d = districtById(goal.id);
  return goal.kind === "focus" ? focusView(d, aspect, lens, focusBox(aspect, layout.free)) : doorwayView(d);
}

/** A measurement, rounded so a pixel's change does not move the camera. */
const keyOf = (values: number[] | null) => (values ? values.map((v) => Math.round(v * 25)).join(",") : "");

const distanceOf = (v: View) =>
  Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);

/** Lets a transition go anywhere: limits are for the person's hand, not for the flight. */
function relax(c: CameraControlsImpl) {
  c.minDistance = 0.1;
  c.maxDistance = Infinity;
  c.minPolarAngle = 0;
  c.maxPolarAngle = Math.PI;
  c.minAzimuthAngle = -Infinity;
  c.maxAzimuthAngle = Infinity;
}

/**
 * What the person may do by hand once the camera has arrived: turn a little
 * around what they are looking at, come a little closer or step back — never
 * dive under the sea or lose the island.
 */
function constrain(c: CameraControlsImpl, kind: CameraGoal["kind"], view: View) {
  const d = distanceOf(view);
  const az = c.azimuthAngle;
  const polar = c.polarAngle;
  c.enabled = kind !== "enter";
  if (kind === "overview") {
    c.minDistance = d * 0.6;
    c.maxDistance = d * 1.18;
    c.minPolarAngle = Math.max(0.2, polar - 0.32);
    c.maxPolarAngle = Math.min(1.25, polar + 0.16);
    c.minAzimuthAngle = az - 0.75;
    c.maxAzimuthAngle = az + 0.75;
  } else {
    c.minDistance = d * 0.7;
    c.maxDistance = d * 1.35;
    c.minPolarAngle = Math.max(0.2, polar - 0.25);
    c.maxPolarAngle = Math.min(1.3, polar + 0.18);
    c.minAzimuthAngle = az - 0.6;
    c.maxAzimuthAngle = az + 0.6;
  }
}

/**
 * The camera: flights between the whole island and each building, in an arc
 * (never a straight dive through a roof); a slow breathing drift when nobody
 * touches anything; a push to the door on "enter". With reduced motion every
 * move is a cut and nothing drifts.
 */
export function CameraRig({
  goal,
  returnFrom,
  reducedMotion,
  onArrive,
  still = false,
  layout = {},
}: {
  goal: CameraGoal;
  /** Coming back from a building: start in front of it, then pull out. */
  returnFrom: DistrictId | null;
  reducedMotion: boolean;
  onArrive: (goal: CameraGoal) => void;
  /** Hold the camera exactly where it is (a photo is being taken). */
  still?: boolean;
  /** What the page's panels cover, when measured. */
  layout?: Layout;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const { size, camera } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // The lens follows the screen's shape (`lensFor`): wider and steeper on a
  // phone held upright. Set before the first frame and on every resize.
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const fov = lensFor(aspect).fov;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }, [camera, aspect]);
  const tween = useRef<Tween | null>(null);
  const idleSince = useRef(performance.now());
  const drift = useRef({ on: false, base: 0, t: 0 });
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const placed = useRef(false);
  const firstFlight = useRef(true);
  /** The person has moved the view by hand since the camera last set off. */
  const handled = useRef(false);

  // First placement, before the first frame: no flash of a default camera.
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c || placed.current) return;
    placed.current = true;
    const start = returnFrom ? focusView(districtById(returnFrom), aspect) : viewFor(goal, aspect, layoutRef.current);
    relax(c);
    c.setLookAt(...start.position, ...start.target, false);
    c.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    c.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_ROTATE;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY;
    c.touches.three = CameraControlsImpl.ACTION.NONE;
    c.dollyToCursor = false;
    c.smoothTime = 0.35;
    c.draggingSmoothTime = 0.14;
    c.azimuthRotateSpeed = 0.55;
    c.polarRotateSpeed = 0.45;
    c.dollySpeed = 0.5;
    constrain(c, returnFrom ? "focus" : goal.kind, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A hand on the controls stops any flight and any drift.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      pacer.markActive(800);
      idleSince.current = performance.now();
      drift.current.on = false;
      handled.current = true;
      if (tween.current && tween.current.kind !== "enter") {
        const view = tween.current.to;
        tween.current = null;
        constrain(c, goalRef.current.kind, view);
      }
    };
    const onEnd = () => {
      // The view glides on after the hand lets go (smoothTime).
      pacer.markActive(1500);
      idleSince.current = performance.now();
    };
    const onControl = () => pacer.markActive(800);
    c.addEventListener("controlstart", onStart);
    c.addEventListener("control", onControl);
    c.addEventListener("controlend", onEnd);
    return () => {
      c.removeEventListener("controlstart", onStart);
      c.removeEventListener("control", onControl);
      c.removeEventListener("controlend", onEnd);
    };
  }, []);

  // A new goal, or a new screen shape: fly there.
  //
  // A building's panel opens with the flight and is measured a moment later:
  // the flight then simply ends elsewhere (still near its start, the change
  // does not show). Measured again once there — the panel resized, the
  // island's band narrowed — the camera glides to the new framing, unless
  // the person has taken the view in hand since.
  const goalKey = goal.kind === "overview" ? "overview" : `${goal.kind}:${goal.id}`;
  const { band, free } = layout;
  const frameKey =
    goal.kind === "focus"
      ? keyOf(free ? [free.minX, free.maxX, free.minY, free.maxY] : null)
      : goal.kind === "overview"
        ? keyOf(band ? [band.top, band.bottom] : null)
        : "";
  const flown = useRef({ goalKey: "", aspect: 0 });
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const sameFlight = flown.current.goalKey === goalKey && flown.current.aspect === aspect;
    flown.current = { goalKey, aspect };
    if (!sameFlight) handled.current = false;
    const to = viewFor(goal, aspect, layoutRef.current);
    if (sameFlight) {
      if (goal.kind === "enter" || handled.current) return;
      if (tween.current) {
        tween.current.to = to;
        return;
      }
    }
    const pos = c.getPosition(new THREE.Vector3());
    const tgt = c.getTarget(new THREE.Vector3());
    const from: View = { position: [pos.x, pos.y, pos.z], target: [tgt.x, tgt.y, tgt.z] };
    const travel = Math.hypot(to.position[0] - pos.x, to.position[1] - pos.y, to.position[2] - pos.z);
    drift.current.on = false;
    relax(c);
    if (sameFlight) {
      // Only the framing changed, after arriving: a short glide, no arc.
      tween.current = {
        from,
        to,
        start: performance.now(),
        delay: 0,
        duration: reducedMotion ? 1 : 520,
        arc: 0,
        kind: goal.kind,
        easing: easeInOut,
      };
      pacer.markActive(600);
      return;
    }
    if (reducedMotion && goal.kind !== "enter") {
      c.setLookAt(...to.position, ...to.target, false);
      tween.current = null;
      constrain(c, goal.kind, to);
      arrive.current(goal);
      return;
    }
    const entering = goal.kind === "enter";
    const comingBack = firstFlight.current && !!returnFrom && goal.kind === "overview";
    firstFlight.current = false;
    pacer.markActive(600);
    tween.current = {
      from,
      to,
      start: performance.now(),
      // Coming back from a building: a beat in front of it first, then out.
      delay: comingBack && travel > 1 ? 380 : 0,
      duration: reducedMotion ? 250 : entering ? 850 : Math.min(1900, 950 + travel * 22),
      arc: entering ? 0 : Math.min(4.5, travel * 0.12),
      kind: goal.kind,
      easing: entering ? easeIn : easeInOut,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalKey, aspect, frameKey]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const now = performance.now();
    const tw = tween.current;
    if (tw) {
      // A flight is drawn at full rate, to its last frame.
      pacer.markActive(400);
      const p = Math.min(1, Math.max(0, (now - tw.start - tw.delay) / tw.duration));
      if (now - tw.start < tw.delay) return;
      const e = tw.easing(p);
      const lerp = (a: number, b: number) => a + (b - a) * e;
      const lift = Math.sin(Math.PI * e) * tw.arc;
      c.setLookAt(
        lerp(tw.from.position[0], tw.to.position[0]),
        lerp(tw.from.position[1], tw.to.position[1]) + lift,
        lerp(tw.from.position[2], tw.to.position[2]),
        lerp(tw.from.target[0], tw.to.target[0]),
        lerp(tw.from.target[1], tw.to.target[1]),
        lerp(tw.from.target[2], tw.to.target[2]),
        false
      );
      if (p >= 1) {
        tween.current = null;
        constrain(c, tw.kind, tw.to);
        idleSince.current = now;
        arrive.current(goalRef.current);
      }
      return;
    }

    // The breathing drift: only on the whole island, only when left alone —
    // and never while a photo is being taken.
    if (still) {
      drift.current.on = false;
      idleSince.current = now;
      return;
    }
    if (reducedMotion || goalRef.current.kind !== "overview") return;
    const d = drift.current;
    if (!d.on && now - idleSince.current > 6000) {
      d.on = true;
      d.base = c.azimuthAngle;
      d.t = 0;
    }
    if (d.on) {
      d.t += dt;
      c.rotateAzimuthTo(d.base + Math.sin(d.t * 0.09) * 0.09, false);
    }
  });

  return <CameraControls ref={controls} makeDefault />;
}
