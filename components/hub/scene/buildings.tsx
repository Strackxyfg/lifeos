"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { DISTRICTS, facing, type District, type DistrictId } from "@/lib/hub/districts";
import { seeded } from "@/lib/hub/island";
import { hubMaterials, lampsNow, signGlow, signMaterials, signTexture } from "./materials";
import { useHubLight } from "./light";

type V3 = [number, number, number];

/** The accent of the app (hsl 222 90% 64%), for selection. */
export const ACCENT = new THREE.Color("#5b8cff");

/* ── Small builders ──────────────────────────────────────────────── */

function Bx({ s, p, m, r, shadow = true }: { s: V3; p: V3; m: THREE.Material; r?: V3; shadow?: boolean }) {
  return (
    <mesh position={p} rotation={r} material={m} castShadow={shadow} receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

function Rb({ s, p, m, radius = 0.07 }: { s: V3; p: V3; m: THREE.Material; radius?: number }) {
  return <RoundedBox args={s} radius={radius} smoothness={3} position={p} material={m} castShadow receiveShadow />;
}

function Cy({
  rt,
  rb,
  h,
  p,
  m,
  seg = 32,
  open = false,
  shadow = true,
}: {
  rt: number;
  rb: number;
  h: number;
  p: V3;
  m: THREE.Material;
  seg?: number;
  open?: boolean;
  shadow?: boolean;
}) {
  return (
    <mesh position={p} material={m} castShadow={shadow} receiveShadow>
      <cylinderGeometry args={[rt, rb, h, seg, 1, open]} />
    </mesh>
  );
}

/** The page's typeface, once loaded — signs are drawn in it. */
function useSignFont(): string {
  const [font, setFont] = useState("system-ui, sans-serif");
  useEffect(() => {
    let alive = true;
    const pick = () => {
      if (alive) setFont(getComputedStyle(document.body).fontFamily || "system-ui, sans-serif");
    };
    pick();
    document.fonts?.ready.then(pick).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return font;
}

/** A backlit sign: pictogram and name, white on navy. */
function Sign({ id, text, height, maxWidth, p, r }: { id: DistrictId; text: string; height: number; maxWidth: number; p: V3; r?: V3 }) {
  const font = useSignFont();
  const { texture, aspect } = useMemo(() => signTexture(id, text, font), [id, text, font]);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: texture,
      emissiveIntensity: signGlow(lampsNow()),
      roughness: 0.45,
      metalness: 0.05,
    });
    signMaterials.add(mat);
    return mat;
  }, [texture]);
  useEffect(
    () => () => {
      signMaterials.delete(material);
      material.dispose();
      texture.dispose();
    },
    [material, texture]
  );
  let w = height * aspect;
  let h = height;
  if (w > maxWidth) {
    h *= maxWidth / w;
    w = maxWidth;
  }
  return (
    <mesh position={p} rotation={r} material={material}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}

/** A freestanding sign on a white plinth, in front of a building. */
function Monument({ id, text, p, width }: { id: DistrictId; text: string; p: V3; width: number }) {
  const m = hubMaterials();
  return (
    <group position={p}>
      <Bx s={[width + 0.14, 0.12, 0.3]} p={[0, 0.06, 0]} m={m.trim} />
      <Bx s={[width + 0.06, 0.46, 0.12]} p={[0, 0.35, 0]} m={m.navy} />
      <Sign id={id} text={text} height={0.34} maxWidth={width} p={[0, 0.36, 0.062]} />
    </group>
  );
}

/* ── The wrapper every building shares ───────────────────────────── */

interface BuildingProps {
  district: District;
  hovered: boolean;
  focused: boolean;
  interactive: boolean;
  onHover: (id: DistrictId | null) => void;
  onSelect: (id: DistrictId) => void;
  children: ReactNode;
}

function Building({ district, hovered, focused, interactive, onHover, onSelect, children }: BuildingProps) {
  const lift = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  useFrame(({ clock }, dt) => {
    const g = lift.current;
    if (g) g.position.y = THREE.MathUtils.damp(g.position.y, hovered && !focused ? 0.07 : 0, 10, dt);
    const target = focused ? 0.75 + 0.2 * Math.sin(clock.elapsedTime * 2.4) : hovered ? 0.5 : 0;
    ringMaterial.opacity = THREE.MathUtils.damp(ringMaterial.opacity, target, 8, dt);
    if (ring.current) ring.current.visible = ringMaterial.opacity > 0.01;
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    onHover(district.id);
  };
  const out = () => onHover(null);
  const click = (e: ThreeEvent<MouseEvent>) => {
    // A drag that ends on a building is a look around, not a choice.
    if (!interactive || e.delta > 6) return;
    e.stopPropagation();
    onSelect(district.id);
  };

  const r = district.radius;
  return (
    <group position={[district.at[0], 0, district.at[1]]} rotation-y={facing(district)}>
      <group ref={lift} onPointerOver={over} onPointerOut={out} onClick={click}>
        {children}
      </group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.04} material={ringMaterial} visible={false}>
        <ringGeometry args={[r + 0.28, r + 0.46, 72]} />
      </mesh>
    </group>
  );
}

/* ── The buildings ───────────────────────────────────────────────── */

/** The second brain: a rotunda under a glass dome, a living core of light inside. */
function BrainRotunda({ sign }: { sign: string }) {
  const m = hubMaterials();
  const mullions = 28;
  return (
    <group>
      <Cy rt={3.45} rb={3.55} h={0.24} p={[0, 0.12, 0]} m={m.trim} seg={72} />
      <Bx s={[2.4, 0.16, 0.4]} p={[0, 0.08, 3.72]} m={m.trim} />
      <Bx s={[2.0, 0.08, 0.34]} p={[0, 0.04, 4.05]} m={m.trim} />
      <Cy rt={3.05} rb={3.05} h={2.1} p={[0, 1.29, 0]} m={m.glass} seg={72} open />
      {Array.from({ length: mullions }, (_, i) => {
        const a = (i / mullions) * Math.PI * 2 + Math.PI / mullions;
        return <Bx key={i} s={[0.09, 2.1, 0.09]} p={[Math.sin(a) * 3.07, 1.29, Math.cos(a) * 3.07]} r={[0, a, 0]} m={m.trim} />;
      })}
      <Cy rt={3.3} rb={3.3} h={0.28} p={[0, 2.48, 0]} m={m.trim} seg={72} />
      <Cy rt={2.7} rb={2.7} h={1.2} p={[0, 3.22, 0]} m={m.white} seg={72} />
      <Cy rt={2.72} rb={2.72} h={0.42} p={[0, 3.22, 0]} m={m.glass} seg={72} open />
      <Cy rt={2.86} rb={2.86} h={0.16} p={[0, 3.9, 0]} m={m.trim} seg={72} />
      <mesh position-y={3.98} material={m.dome} renderOrder={4}>
        <sphereGeometry args={[2.45, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position-y={3.98} rotation-y={(i / 8) * Math.PI} material={m.trim} castShadow>
          <torusGeometry args={[2.46, 0.03, 6, 48, Math.PI]} />
        </mesh>
      ))}
      <Cy rt={0.3} rb={0.36} h={0.3} p={[0, 6.52, 0]} m={m.trim} seg={24} />
      <NeuralCore />
      {/* Portico. */}
      <Bx s={[2.9, 0.14, 1.3]} p={[0, 2.05, 3.4]} m={m.trim} />
      {[-1.28, 1.28].map((x) => (
        <Cy key={x} rt={0.07} rb={0.07} h={1.98} p={[x, 0.99, 3.92]} m={m.trim} seg={12} />
      ))}
      <Bx s={[1.7, 1.8, 0.06]} p={[0, 1.14, 3.05]} m={m.storefront} shadow={false} />
      <Sign id="brain" text={sign} height={0.38} maxWidth={2.7} p={[0, 2.05, 4.06]} />
    </group>
  );
}

const coreVertex = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uSize;
  varying float vPulse;
  void main() {
    vPulse = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase * 6.2831853);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.6 + 0.6 * vPulse) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const coreFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vPulse;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = pow(1.0 - d * 2.0, 1.6) * uOpacity * vPulse;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), vPulse * 0.35), a);
    #include <colorspace_fragment>
  }
`;

/** Points in the shape of a brain, breathing — the product's own image, under the dome. */
function NeuralCore() {
  const light = useHubLight();
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const n = 900;
    const rnd = seeded(77);
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 0.72 + 0.28 * Math.sqrt(rnd());
      // Two hemispheres, a little apart; flatter underneath, as a brain is.
      pos[i * 3] = side * 0.3 + s * Math.cos(t) * 0.58 * r;
      pos[i * 3 + 1] = u * 0.62 * r * (u < 0 ? 0.75 : 1);
      pos[i * 3 + 2] = s * Math.sin(t) * 0.86 * r;
      phase[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: 26 },
          uColor: { value: new THREE.Color("#6f9bff") },
          uOpacity: { value: 0.7 },
        },
      }),
    []
  );
  useFrame(({ clock }, dt) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uOpacity.value = 0.55 + light.current.sky.lamps * 0.45;
    if (group.current) group.current.rotation.y += dt * 0.12;
  });
  return (
    <group ref={group} position={[0, 4.95, 0]} scale={1.45}>
      <points geometry={geometry} material={material} renderOrder={5} />
    </group>
  );
}

/** Today: a slim clock tower on the plaza, telling the time the sky shows. */
function ClockTower({ sign }: { sign: string }) {
  const m = hubMaterials();
  const light = useHubLight();
  const hours = useRef<(THREE.Group | null)[]>([]);
  const minutes = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const t = light.current.time;
    const min = t.getMinutes() + t.getSeconds() / 60;
    const hr = (t.getHours() % 12) + min / 60;
    for (const h of hours.current) if (h) h.rotation.z = -(hr / 12) * Math.PI * 2;
    for (const mm of minutes.current) if (mm) mm.rotation.z = -(min / 60) * Math.PI * 2;
  });
  return (
    <group>
      <Bx s={[1.6, 0.3, 1.6]} p={[0, 0.15, 0]} m={m.trim} />
      <Rb s={[1.1, 5.4, 1.1]} p={[0, 3.0, 0]} m={m.white} radius={0.05} />
      {[0, 1, 2, 3].map((k) => (
        <group key={k} rotation-y={(k * Math.PI) / 2}>
          <Bx s={[0.26, 4.4, 0.02]} p={[0, 2.95, 0.556]} m={m.glass} shadow={false} />
          <mesh position={[0, 6.35, 0.685]} material={m.dial}>
            <circleGeometry args={[0.5, 48]} />
          </mesh>
          {/* Each hand turns about the dial's centre, from one end. */}
          <group position={[0, 6.35, 0.69]}>
            <group ref={(el) => void (hours.current[k] = el)}>
              <mesh position-y={0.12} material={m.hand}>
                <boxGeometry args={[0.06, 0.28, 0.015]} />
              </mesh>
            </group>
            <group ref={(el) => void (minutes.current[k] = el)} position-z={0.012}>
              <mesh position-y={0.18} material={m.hand}>
                <boxGeometry args={[0.035, 0.42, 0.015]} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
      <Rb s={[1.36, 1.3, 1.36]} p={[0, 6.35, 0]} m={m.white} radius={0.05} />
      <Bx s={[1.48, 0.08, 1.48]} p={[0, 5.72, 0]} m={m.trim} />
      <Bx s={[1.5, 0.1, 1.5]} p={[0, 7.05, 0]} m={m.trim} />
      <mesh position={[0, 7.55, 0]} material={m.metal} castShadow>
        <coneGeometry args={[0.13, 0.9, 12]} />
      </mesh>
      <Monument id="today" text={sign} p={[0, 0, 1.25]} width={1.9} />
    </group>
  );
}

/** The assistant: a café with its terrace, where one comes to talk. */
function Cafe({ sign }: { sign: string }) {
  const m = hubMaterials();
  const tables = [-1.25, 0, 1.25];
  return (
    <group>
      <Rb s={[3.6, 1.7, 2.4]} p={[0, 0.85, -0.45]} m={m.white} />
      <Bx s={[3.2, 1.3, 0.05]} p={[0, 0.78, 0.78]} m={m.storefront} shadow={false} />
      {[-1.07, 1.07].map((x) => (
        <Bx key={x} s={[0.06, 1.3, 0.07]} p={[x, 0.78, 0.8]} m={m.trim} />
      ))}
      <Bx s={[4.2, 0.14, 3.3]} p={[0, 1.78, -0.25]} m={m.trim} />
      <Bx s={[4.2, 0.36, 0.08]} p={[0, 1.58, 1.36]} m={m.navy} />
      <Sign id="assistant" text={sign} height={0.3} maxWidth={3.3} p={[0, 1.58, 1.405]} />
      <Bx s={[3.9, 0.06, 1.4]} p={[0, 0.03, 1.62]} m={m.wood} />
      {tables.map((x) => (
        <group key={x} position={[x, 0, 1.7]}>
          <Cy rt={0.25} rb={0.25} h={0.04} p={[0, 0.42, 0]} m={m.trim} seg={20} />
          <Cy rt={0.025} rb={0.025} h={1.25} p={[0, 0.66, 0]} m={m.metal} seg={6} />
          <mesh position-y={1.28} material={m.cream} castShadow>
            <coneGeometry args={[0.62, 0.24, 20, 1, true]} />
          </mesh>
          {[-0.36, 0.36].map((dx) => (
            <Bx key={dx} s={[0.2, 0.26, 0.2]} p={[dx, 0.13, 0.05]} m={m.white} />
          ))}
        </group>
      ))}
      {[-1.95, 1.95].map((x) => (
        <group key={x} position={[x, 0, 1.95]}>
          <Bx s={[0.34, 0.3, 0.8]} p={[0, 0.15, 0]} m={m.white} />
          <mesh position-y={0.46} material={m.leaf} castShadow scale={[0.22, 0.2, 0.42]}>
            <sphereGeometry args={[1, 12, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The agent: a workshop hangar, and the mast it talks to the world through. */
function Atelier({ sign }: { sign: string }) {
  const m = hubMaterials();
  const beacon = useRef<THREE.Mesh>(null);
  const shell = useMemo(() => {
    const g = new THREE.CylinderGeometry(1.45, 1.45, 3.0, 40, 1, true, Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const end = useMemo(() => new THREE.CircleGeometry(1.45, 40, 0, Math.PI), []);
  useFrame(({ clock }) => {
    // Aviation beacons blink, day and night.
    if (beacon.current) beacon.current.visible = Math.floor(clock.elapsedTime * 1.2) % 2 === 0;
  });
  return (
    <group>
      <Bx s={[3.2, 0.12, 3.3]} p={[0, 0.06, 0]} m={m.trim} />
      <mesh geometry={shell} position-y={0.12} material={m.white} castShadow receiveShadow />
      <mesh geometry={end} position={[0, 0.12, 1.5]} material={m.storefront} />
      <mesh geometry={end} position={[0, 0.12, -1.5]} rotation-y={Math.PI} material={m.white} castShadow />
      {[-0.55, 0, 0.55].map((x) => (
        <Bx key={x} s={[0.05, x === 0 ? 1.44 : 1.3, 0.05]} p={[x, 0.12 + (x === 0 ? 0.72 : 0.65), 1.52]} m={m.trim} shadow={false} />
      ))}
      <Bx s={[2.8, 0.05, 0.05]} p={[0, 1.0, 1.52]} m={m.trim} shadow={false} />
      <Bx s={[1.3, 0.34, 0.06]} p={[0, 1.33, 1.56]} m={m.navy} shadow={false} />
      <Sign id="agent" text={sign} height={0.28} maxWidth={1.24} p={[0, 1.33, 1.595]} />
      {/* The mast. */}
      <group position={[1.15, 0, -1.25]}>
        <Cy rt={0.035} rb={0.08} h={3.7} p={[0, 1.85, 0]} m={m.metal} seg={8} />
        <Bx s={[0.5, 0.04, 0.04]} p={[0, 2.7, 0]} m={m.metal} />
        <Bx s={[0.36, 0.04, 0.04]} p={[0, 3.2, 0]} m={m.metal} />
        <mesh position={[-0.28, 2.4, 0.05]} rotation={[0.3, 0.6, -0.9]} material={m.trim} castShadow>
          <sphereGeometry args={[0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3]} />
        </mesh>
        <mesh ref={beacon} position-y={3.74} material={m.beacon}>
          <sphereGeometry args={[0.07, 10, 8]} />
        </mesh>
      </group>
    </group>
  );
}

/** Projects: a studio with its top floor going up, and the crane building it. */
function Studio({ sign, reducedMotion }: { sign: string; reducedMotion: boolean }) {
  const m = hubMaterials();
  const slew = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (slew.current && !reducedMotion) slew.current.rotation.y = -0.9 + Math.sin(clock.elapsedTime * 0.12) * 0.55;
  });
  const posts: V3[] = [
    [-1.62, 3.15, -1.22], [0, 3.15, -1.22], [1.62, 3.15, -1.22],
    [-1.62, 3.15, 1.22], [0, 3.15, 1.22], [1.62, 3.15, 1.22],
  ];
  return (
    <group>
      <Rb s={[3.4, 2.5, 2.6]} p={[0, 1.25, 0]} m={m.white} />
      <Bx s={[3.44, 0.62, 2.64]} p={[0, 0.85, 0]} m={m.glass} />
      <Bx s={[3.44, 0.62, 2.64]} p={[0, 1.95, 0]} m={m.glass} />
      <Bx s={[3.5, 0.1, 2.7]} p={[0, 2.55, 0]} m={m.trim} />
      <Bx s={[1.8, 0.36, 0.06]} p={[0, 1.4, 1.31]} m={m.navy} shadow={false} />
      <Sign id="projects" text={sign} height={0.3} maxWidth={1.74} p={[0, 1.4, 1.345]} />
      <Bx s={[1.1, 0.5, 0.05]} p={[0, 0.35, 1.33]} m={m.storefront} shadow={false} />
      {posts.map((p, i) => (
        <Bx key={i} s={[0.07, 1.1, 0.07]} p={p} m={m.grey} />
      ))}
      <Bx s={[3.3, 0.07, 0.07]} p={[0, 3.7, -1.22]} m={m.grey} />
      <Bx s={[3.3, 0.07, 0.07]} p={[0, 3.7, 1.22]} m={m.grey} />
      <Bx s={[1.66, 0.08, 2.5]} p={[-0.82, 3.72, 0]} m={m.white} />
      <Bx s={[0.5, 0.26, 0.4]} p={[0.8, 2.73, 0.3]} m={m.wood} />
      <Bx s={[0.4, 0.2, 0.34]} p={[0.8, 2.96, 0.3]} m={m.wood} />
      {/* The tower crane. */}
      <group position={[2.15, 0, -1.05]}>
        <Bx s={[0.22, 5.5, 0.22]} p={[0, 2.75, 0]} m={m.crane} />
        <group ref={slew} position-y={5.5}>
          <Bx s={[0.34, 0.3, 0.34]} p={[0, 0.15, 0]} m={m.navy} shadow={false} />
          <Bx s={[0.08, 0.8, 0.08]} p={[0, 0.7, 0]} m={m.crane} shadow={false} />
          <Bx s={[4.4, 0.16, 0.18]} p={[-2.0, 0.38, 0]} m={m.crane} shadow={false} />
          <Bx s={[1.4, 0.14, 0.18]} p={[0.85, 0.38, 0]} m={m.crane} shadow={false} />
          <Bx s={[0.4, 0.36, 0.3]} p={[1.4, 0.16, 0]} m={m.grey} shadow={false} />
          <Cy rt={0.008} rb={0.008} h={2.2} p={[-3.0, -0.8, 0]} m={m.metal} seg={4} shadow={false} />
          <Bx s={[0.14, 0.12, 0.14]} p={[-3.0, -1.9, 0]} m={m.navy} shadow={false} />
          <mesh position={[-4.15, 0.42, 0]} material={m.beacon}>
            <sphereGeometry args={[0.05, 8, 6]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** Finance: a slim tower of glass and white bands. */
function Bank({ sign }: { sign: string }) {
  const m = hubMaterials();
  return (
    <group>
      <Rb s={[3.2, 1.2, 3.0]} p={[0, 0.6, 0]} m={m.white} />
      <Bx s={[2.6, 0.9, 0.04]} p={[0, 0.55, 1.51]} m={m.storefront} shadow={false} />
      <Bx s={[2.3, 6.4, 2.3]} p={[0, 4.4, 0]} m={m.glass} />
      {Array.from({ length: 8 }, (_, i) => (
        <Bx key={i} s={[2.36, 0.07, 2.36]} p={[0, 1.6 + i * 0.8, 0]} m={m.trim} />
      ))}
      {[
        [-1.15, -1.15],
        [1.15, -1.15],
        [-1.15, 1.15],
        [1.15, 1.15],
      ].map(([x, z]) => (
        <Bx key={`${x}${z}`} s={[0.12, 6.4, 0.12]} p={[x, 4.4, z]} m={m.white} />
      ))}
      <Rb s={[2.5, 0.5, 2.5]} p={[0, 7.85, 0]} m={m.white} radius={0.05} />
      <Bx s={[1.0, 0.4, 1.0]} p={[0, 8.3, -0.3]} m={m.grey} />
      <Sign id="finance" text={sign} height={0.34} maxWidth={2.2} p={[0, 7.85, 1.262]} />
    </group>
  );
}

/** Relations: two pavilions joined by a glass bridge. */
function Pavilions({ sign }: { sign: string }) {
  const m = hubMaterials();
  return (
    <group>
      <Rb s={[1.6, 2.6, 2.2]} p={[-1.3, 1.3, 0]} m={m.white} />
      <Bx s={[1.2, 2.0, 0.04]} p={[-1.3, 1.1, 1.11]} m={m.storefront} shadow={false} />
      <Bx s={[1.8, 0.1, 2.4]} p={[-1.3, 2.65, 0]} m={m.trim} />
      <Rb s={[1.6, 2.9, 2.2]} p={[1.3, 1.45, 0]} m={m.white} />
      <Bx s={[1.2, 2.3, 0.04]} p={[1.3, 1.25, 1.11]} m={m.glass} shadow={false} />
      <Bx s={[1.8, 0.1, 2.4]} p={[1.3, 2.95, 0]} m={m.trim} />
      <Bx s={[1.1, 0.66, 1.0]} p={[0, 1.95, 0.3]} m={m.glass} />
      <Bx s={[1.12, 0.06, 1.02]} p={[0, 2.3, 0.3]} m={m.trim} />
      <Bx s={[1.12, 0.06, 1.02]} p={[0, 1.6, 0.3]} m={m.trim} />
      <Bx s={[1.0, 1.4, 0.05]} p={[0, 0.7, 0.3]} m={m.storefront} shadow={false} />
      <Monument id="relations" text={sign} p={[0, 0, 1.75]} width={1.9} />
    </group>
  );
}

/** The team: a club house with a glass atrium and a roof terrace. */
function Club({ sign }: { sign: string }) {
  const m = hubMaterials();
  return (
    <group>
      <Rb s={[5.0, 2.0, 3.2]} p={[0, 1.0, 0]} m={m.white} />
      <Bx s={[4.4, 1.38, 0.04]} p={[0, 0.81, 1.61]} m={m.storefront} shadow={false} />
      {[-1.65, -0.55, 0.55, 1.65].map((x) => (
        <Bx key={x} s={[0.05, 1.38, 0.06]} p={[x, 0.81, 1.63]} m={m.trim} shadow={false} />
      ))}
      <Bx s={[2.1, 0.36, 0.05]} p={[0, 1.74, 1.62]} m={m.navy} shadow={false} />
      <Sign id="team" text={sign} height={0.3} maxWidth={2.0} p={[0, 1.74, 1.652]} />
      <Rb s={[4.4, 1.4, 2.4]} p={[0, 2.7, -0.4]} m={m.white} />
      <Bx s={[4.44, 0.5, 2.44]} p={[0, 2.72, -0.4]} m={m.glass} />
      <Bx s={[4.5, 0.08, 2.5]} p={[0, 3.42, -0.4]} m={m.trim} />
      {/* The terrace on the lower roof, in front of the upper floor. */}
      <Bx s={[4.9, 0.28, 0.04]} p={[0, 2.14, 1.58]} m={m.trim} />
      {[-1.5, 0.2, 1.6].map((x, i) => (
        <group key={x} position={[x, 2.0, 1.1]}>
          <Cy rt={0.02} rb={0.02} h={0.9} p={[0, 0.45, 0]} m={m.metal} seg={6} />
          <mesh position-y={0.92} material={m.cream} castShadow>
            <coneGeometry args={[0.45, 0.18, 16, 1, true]} />
          </mesh>
          {i === 1 && <Bx s={[0.5, 0.3, 0.3]} p={[0.55, 0.15, -0.1]} m={m.grass} />}
        </group>
      ))}
      {[-1.8, -0.9, 0, 0.9, 1.8].map((x) => (
        <Bx key={x} s={[0.06, 0.06, 2.3]} p={[x, 3.85, -0.4]} m={m.wood} />
      ))}
      {[-1.9, 1.9].map((x) => (
        <Cy key={x} rt={0.03} rb={0.03} h={0.42} p={[x, 3.64, 0.6]} m={m.metal} seg={6} />
      ))}
    </group>
  );
}

/** Settings: the lighthouse, on its rock — its beam sweeps the sea at night. */
function Lighthouse({ reducedMotion }: { reducedMotion: boolean }) {
  const m = hubMaterials();
  const light = useHubLight();
  const beam = useRef<THREE.Group>(null);
  // A beam fades along its length, from the lantern out to sea — a plain
  // transparent cone reads as a solid megaphone instead.
  const beamMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#fff0c2") }, uLength: { value: 15 } },
        vertexShader: /* glsl */ `
          varying float vAlong;
          varying vec3 vNormalV;
          varying vec3 vViewDir;
          void main() {
            vAlong = position.x;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormalV = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform vec3 uColor;
          uniform float uLength;
          varying float vAlong;
          varying vec3 vNormalV;
          varying vec3 vViewDir;
          void main() {
            float t = clamp(vAlong / uLength, 0.0, 1.0);
            float fade = pow(1.0 - t, 1.8) * smoothstep(0.0, 0.04, t);
            // Softer at the silhouette of the cone, like light in air.
            float rim = abs(dot(normalize(vNormalV), normalize(vViewDir)));
            gl_FragColor = vec4(uColor, fade * uOpacity * (0.35 + 0.65 * rim));
            #include <colorspace_fragment>
          }
        `,
      }),
    []
  );
  const cone = useMemo(() => {
    const g = new THREE.ConeGeometry(0.85, 15, 24, 1, true);
    g.translate(0, -7.5, 0);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  useFrame((_, dt) => {
    const lamps = light.current.sky.lamps;
    beamMaterial.uniforms.uOpacity.value = lamps * 0.5;
    if (beam.current) {
      beam.current.visible = lamps > 0.02;
      if (!reducedMotion) beam.current.rotation.y += dt * 0.55;
    }
  });
  return (
    <group>
      <Cy rt={0.95} rb={1.05} h={0.3} p={[0, 0.15, 0]} m={m.trim} seg={32} />
      <Cy rt={0.48} rb={0.76} h={4.4} p={[0, 2.5, 0]} m={m.white} seg={40} />
      <Cy rt={0.675} rb={0.69} h={0.36} p={[0, 1.6, 0]} m={m.navy} seg={40} />
      <Cy rt={0.565} rb={0.58} h={0.36} p={[0, 3.4, 0]} m={m.navy} seg={40} />
      <Cy rt={0.8} rb={0.8} h={0.08} p={[0, 4.74, 0]} m={m.metal} seg={32} />
      <mesh position-y={5.0} rotation-x={Math.PI / 2} material={m.metal}>
        <torusGeometry args={[0.78, 0.018, 6, 40]} />
      </mesh>
      <Cy rt={0.42} rb={0.42} h={0.62} p={[0, 5.09, 0]} m={m.lantern} seg={24} shadow={false} />
      <mesh position-y={5.62} material={m.navy} castShadow>
        <coneGeometry args={[0.52, 0.45, 24]} />
      </mesh>
      <mesh position-y={5.88} material={m.metal}>
        <sphereGeometry args={[0.07, 10, 8]} />
      </mesh>
      <Bx s={[0.3, 0.56, 0.06]} p={[0, 0.58, 0.72]} m={m.navy} shadow={false} />
      <group ref={beam} position-y={5.09}>
        <mesh geometry={cone} material={beamMaterial} />
        <mesh geometry={cone} material={beamMaterial} rotation-y={Math.PI} />
      </group>
      <group position={[-0.95, 0, -0.75]} rotation-y={0.5}>
        <Bx s={[0.95, 0.62, 0.72]} p={[0, 0.31, 0]} m={m.white} />
        <Bx s={[1.05, 0.08, 0.84]} p={[0, 0.66, 0]} m={m.navy} />
      </group>
    </group>
  );
}

/* ── All of them ─────────────────────────────────────────────────── */

export function Buildings({
  hovered,
  focused,
  interactive,
  onHover,
  onSelect,
  signs,
  reducedMotion,
}: {
  hovered: DistrictId | null;
  focused: DistrictId | null;
  interactive: boolean;
  onHover: (id: DistrictId | null) => void;
  onSelect: (id: DistrictId) => void;
  signs: Record<DistrictId, string>;
  reducedMotion: boolean;
}) {
  const model = (d: District): ReactNode => {
    switch (d.id) {
      case "brain":
        return <BrainRotunda sign={signs.brain} />;
      case "today":
        return <ClockTower sign={signs.today} />;
      case "assistant":
        return <Cafe sign={signs.assistant} />;
      case "agent":
        return <Atelier sign={signs.agent} />;
      case "projects":
        return <Studio sign={signs.projects} reducedMotion={reducedMotion} />;
      case "finance":
        return <Bank sign={signs.finance} />;
      case "relations":
        return <Pavilions sign={signs.relations} />;
      case "team":
        return <Club sign={signs.team} />;
      case "settings":
        return <Lighthouse reducedMotion={reducedMotion} />;
    }
  };
  return (
    <>
      {DISTRICTS.map((d) => (
        <Building
          key={d.id}
          district={d}
          hovered={hovered === d.id}
          focused={focused === d.id}
          interactive={interactive}
          onHover={onHover}
          onSelect={onSelect}
        >
          {model(d)}
        </Building>
      ))}
    </>
  );
}
