"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { along, crowd, ROUTES, type Person } from "@/lib/hub/crowd";
import { BODY, gaitPose, sitPose, standPose, strideLength, type Pose } from "@/lib/hub/gait";
import { glowTexture } from "./materials";
import { useHubLight } from "./light";

/**
 * The island's people, articulated: thighs and shins, upper arms and
 * forearms, torso, pelvis, head and hair — walking with a real gait (the
 * stance foot planted, the knee bending through the swing, the arms
 * swinging against the legs), jogging, standing in small groups and
 * talking with their hands, sitting on the benches and at the café.
 *
 * Eight instanced meshes, one per kind of part; every part's matrix is
 * composed from the pose each frame (a few hundred matrices — nothing).
 * They leave as night falls, the latest stay out longest.
 */

type Part = "head" | "hair" | "torso" | "pelvis" | "thigh" | "shin" | "upperArm" | "forearm";
const PAIRED: Part[] = ["thigh", "shin", "upperArm", "forearm"];

function limb(radius: number, length: number): THREE.BufferGeometry {
  // Hanging from its joint at the origin.
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 3, 8);
  g.translate(0, -length / 2, 0);
  return g;
}

function geometries(): Record<Part, THREE.BufferGeometry> {
  const torso = new THREE.CapsuleGeometry(0.034, BODY.torso - 0.05, 4, 10);
  torso.scale(1.12, 1, 0.68);
  torso.translate(0, BODY.torso / 2 + 0.004, 0);
  const pelvis = new THREE.CapsuleGeometry(0.03, 0.02, 3, 8);
  pelvis.rotateZ(Math.PI / 2);
  pelvis.scale(1, 1, 0.75);
  const hair = new THREE.SphereGeometry(BODY.headRadius * 1.08, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.translate(0, 0.004, -0.004);
  return {
    head: new THREE.SphereGeometry(BODY.headRadius, 12, 10),
    hair,
    torso,
    pelvis,
    thigh: limb(0.019, BODY.thigh),
    shin: limb(0.015, BODY.shin),
    upperArm: limb(0.0125, BODY.upperArm),
    forearm: limb(0.011, BODY.forearm),
  };
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function trs(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  return out.compose(_v, _q, _one);
}

interface Matrices {
  set(part: Part, index: number, m: THREE.Matrix4): void;
}

const _root = new THREE.Matrix4();
const _pelvis = new THREE.Matrix4();
const _torso = new THREE.Matrix4();
const _a = new THREE.Matrix4();
const _b = new THREE.Matrix4();

/** Writes one figure's parts from its place, heading and pose. */
function poseFigure(out: Matrices, i: number, x: number, z: number, heading: number, p: Pose) {
  trs(_root, x, 0, z, 0, heading, 0);
  _pelvis.copy(_root).multiply(trs(_t, 0, p.hipHeight, 0, 0, 0, p.sway));
  out.set("pelvis", i, _pelvis);
  _torso.copy(_pelvis).multiply(trs(_t, 0, 0.012, 0, p.lean, 0, 0));
  out.set("torso", i, _torso);
  _a.copy(_torso).multiply(trs(_t, 0, BODY.torso + 0.016 + BODY.headRadius, 0.004, -p.lean * 0.5, p.look, 0));
  out.set("head", i, _a);
  out.set("hair", i, _a);
  for (let s = 0; s < 2; s++) {
    // Left is +X for a figure facing +Z.
    const side = s === 0 ? 1 : -1;
    _a.copy(_pelvis).multiply(trs(_t, side * BODY.hipWidth, 0, 0, -p.hip[s], 0, 0));
    out.set("thigh", i * 2 + s, _a);
    _b.copy(_a).multiply(trs(_t, 0, -BODY.thigh, 0, p.knee[s], 0, 0));
    out.set("shin", i * 2 + s, _b);
    _a.copy(_torso).multiply(trs(_t, side * BODY.shoulderWidth, BODY.torso - 0.014, 0, -p.shoulder[s], 0, side * 0.07));
    out.set("upperArm", i * 2 + s, _a);
    _b.copy(_a).multiply(trs(_t, 0, -BODY.upperArm, 0, -p.elbow[s], 0, 0));
    out.set("forearm", i * 2 + s, _b);
  }
}

export function People({ count, reducedMotion }: { count: number; reducedMotion: boolean }) {
  const light = useHubLight();
  const people = useMemo<Person[]>(() => crowd(count), [count]);
  const geo = useMemo(geometries, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.82, envMapIntensity: 0.9 }), []);
  const shadowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: new THREE.Color("#000000"),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    []
  );
  const shadowGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.2, 0.2);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(geo)) g.dispose();
      material.dispose();
      shadowMaterial.dispose();
      shadowGeometry.dispose();
    },
    [geo, material, shadowMaterial, shadowGeometry]
  );

  const meshes = useRef<Partial<Record<Part, THREE.InstancedMesh | null>>>({});
  const blobs = useRef<THREE.InstancedMesh>(null);
  const colored = useRef(false);
  const clock = useRef(0);

  const out: Matrices = useMemo(
    () => ({
      set(part, index, m) {
        meshes.current[part]?.setMatrixAt(index, m);
      },
    }),
    []
  );

  useFrame((_, dt) => {
    const all = meshes.current;
    if (!all.head || !blobs.current) return;
    if (!colored.current) {
      const c = new THREE.Color();
      people.forEach((p, i) => {
        all.head?.setColorAt(i, c.set(p.skin));
        all.hair?.setColorAt(i, c.set(p.hair));
        all.torso?.setColorAt(i, c.set(p.shirt));
        all.pelvis?.setColorAt(i, c.set(p.trousers));
        for (let s = 0; s < 2; s++) {
          all.thigh?.setColorAt(i * 2 + s, c.set(p.trousers));
          all.shin?.setColorAt(i * 2 + s, c.set(p.trousers));
          all.upperArm?.setColorAt(i * 2 + s, c.set(p.shirt));
          all.forearm?.setColorAt(i * 2 + s, c.set(p.shortSleeves ? p.skin : p.shirt));
        }
      });
      for (const mesh of Object.values(all)) if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
      colored.current = true;
    }

    clock.current += reducedMotion ? 0 : Math.min(dt, 0.1);
    const t = clock.current;
    const out_ = 1 - light.current.sky.lamps * 0.7;
    people.forEach((person, i) => {
      if (person.rank > out_) {
        for (const part of ["head", "hair", "torso", "pelvis"] as Part[]) out.set(part, i, HIDDEN);
        for (const part of PAIRED) for (let s = 0; s < 2; s++) out.set(part, i * 2 + s, HIDDEN);
        blobs.current!.setMatrixAt(i, HIDDEN);
        return;
      }
      const r = person.role;
      let x: number;
      let z: number;
      let heading: number;
      let pose: Pose;
      if (r.kind === "walk") {
        const s = r.offset + t * r.speed;
        const p = along(ROUTES[r.route], s, r.lane);
        x = p.x;
        z = p.z;
        // Walking the route backwards means facing the other way.
        heading = p.heading + (r.speed < 0 ? Math.PI : 0);
        pose = gaitPose(Math.abs(s) / strideLength(r.run) + person.seed * 0.137, r.run);
      } else if (r.kind === "sit") {
        [x, z] = r.at;
        heading = r.heading;
        pose = sitPose(t, person.seed, r.seat);
      } else {
        [x, z] = r.at;
        heading = r.heading;
        pose = standPose(t, person.seed);
      }
      poseFigure(out, i, x, z, heading, pose);
      blobs.current!.setMatrixAt(i, trs(_m, x, 0.012, z, 0, heading, 0));
    });
    for (const mesh of Object.values(all)) if (mesh) mesh.instanceMatrix.needsUpdate = true;
    blobs.current.instanceMatrix.needsUpdate = true;
  });

  const n = people.length;
  const mesh = (part: Part, instances: number) => (
    <instancedMesh
      key={part}
      ref={(m) => void (meshes.current[part] = m)}
      args={[geo[part], material, instances]}
      frustumCulled={false}
    />
  );
  return (
    <>
      {mesh("head", n)}
      {mesh("hair", n)}
      {mesh("torso", n)}
      {mesh("pelvis", n)}
      {mesh("thigh", n * 2)}
      {mesh("shin", n * 2)}
      {mesh("upperArm", n * 2)}
      {mesh("forearm", n * 2)}
      {/* A soft contact shadow under each: the sun's shadow map is static, people are not. */}
      <instancedMesh ref={blobs} args={[shadowGeometry, shadowMaterial, n]} frustumCulled={false} renderOrder={2} />
    </>
  );
}
