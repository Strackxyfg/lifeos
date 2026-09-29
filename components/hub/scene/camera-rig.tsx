"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import * as THREE from "three";
import { districtById, doorwayView, type DistrictId, type View } from "@/lib/hub/districts";
import { focusView, overview } from "@/lib/hub/framing";

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

function viewFor(goal: CameraGoal, aspect: number): View {
  if (goal.kind === "overview") return overview(aspect);
  const d = districtById(goal.id);
  return goal.kind === "focus" ? focusView(d, aspect) : doorwayView(d);
}

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
}: {
  goal: CameraGoal;
  /** Coming back from a building: start in front of it, then pull out. */
  returnFrom: DistrictId | null;
  reducedMotion: boolean;
  onArrive: (goal: CameraGoal) => void;
  /** Hold the camera exactly where it is (a photo is being taken). */
  still?: boolean;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const { size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const tween = useRef<Tween | null>(null);
  const idleSince = useRef(performance.now());
  const drift = useRef({ on: false, base: 0, t: 0 });
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const placed = useRef(false);
  const firstFlight = useRef(true);

  // First placement, before the first frame: no flash of a default camera.
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c || placed.current) return;
    placed.current = true;
    const start = returnFrom ? focusView(districtById(returnFrom), aspect) : viewFor(goal, aspect);
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
      idleSince.current = performance.now();
      drift.current.on = false;
      if (tween.current && tween.current.kind !== "enter") {
        const view = tween.current.to;
        tween.current = null;
        constrain(c, goalRef.current.kind, view);
      }
    };
    const onEnd = () => {
      idleSince.current = performance.now();
    };
    c.addEventListener("controlstart", onStart);
    c.addEventListener("controlend", onEnd);
    return () => {
      c.removeEventListener("controlstart", onStart);
      c.removeEventListener("controlend", onEnd);
    };
  }, []);

  // A new goal, or a new screen shape: fly there.
  const goalKey = goal.kind === "overview" ? "overview" : `${goal.kind}:${goal.id}`;
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const to = viewFor(goal, aspect);
    const pos = c.getPosition(new THREE.Vector3());
    const tgt = c.getTarget(new THREE.Vector3());
    const from: View = { position: [pos.x, pos.y, pos.z], target: [tgt.x, tgt.y, tgt.z] };
    const travel = Math.hypot(to.position[0] - pos.x, to.position[1] - pos.y, to.position[2] - pos.z);
    drift.current.on = false;
    relax(c);
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
  }, [goalKey, aspect]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const now = performance.now();
    const tw = tween.current;
    if (tw) {
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
