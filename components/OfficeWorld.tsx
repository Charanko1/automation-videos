"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, Html, OrbitControls, PerspectiveCamera, RoundedBox } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import { OFFICE_CONFIG, BreakSpotId, getSeatTransform, WORKER_DESK_IDS } from "../lib/officeConfig";

type Person = { id: string; name: string; role: string; provider: string; dept: string; color: string; state: string };
type WorkerCommand = { workerId: string; type: "BREAK" | "RETURN"; nonce: number };
type Mode = "WORKING" | "ANTICIPATE" | "STAND_UP" | "WALK" | "ARRIVE" | "ACTIVITY" | "WALK_BACK" | "SIT_DOWN";
type MicroAction = "NONE" | "STRETCH" | "SCRATCH" | "DRINK" | "LEAN" | "SHIFT" | "LOOK";
type BreakActivity = "SIT" | "SNACK" | "STAND";

const C = OFFICE_CONFIG;
const DESKS = C.desks.positions;
const F = C.navigation.loungeFrontZ;

const BREAK_SPOTS: Record<BreakSpotId, {
  pos: [number, number, number]; via: Array<[number, number]>; facing: number; activity: BreakActivity; lift: number;
}> = {
  sofaLeft: { pos: C.lounge.sofa.left, via: [[C.lounge.sofa.left[0], F]], facing: Math.PI, activity: "SIT", lift: C.rig.sofaLift },
  sofaRight: { pos: C.lounge.sofa.right, via: [], facing: Math.PI, activity: "SIT", lift: C.rig.sofaLift },
  beanbag: { pos: C.lounge.beanbagSpot, via: [[C.lounge.beanbagSpot[0], F]], facing: Math.PI, activity: "SIT", lift: C.rig.beanbagLift },
  snacks: { pos: C.lounge.snackSpot, via: [[C.lounge.snackSpot[0], F]], facing: 0, activity: "SNACK", lift: 0 },
  window: { pos: C.lounge.window, via: [[C.lounge.window[0], F]], facing: 0, activity: "STAND", lift: 0 },
  windowLeft: { pos: C.lounge.windowLeft, via: [[C.lounge.windowLeft[0], F]], facing: 0, activity: "STAND", lift: 0 },
};
const BREAK_ORDER: BreakSpotId[] = ["sofaLeft", "snacks", "window", "sofaRight", "beanbag", "windowLeft"];
const BREAK_PAIRS: Array<[number, number]> = [[0, 5], [1, 4], [2, 3]];
const breakReservations = new Map<BreakSpotId, string>();

/* ---------- helpers ---------- */
function seededRandom(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const damp = (c: number, t: number, s: number, d: number) => THREE.MathUtils.damp(c, t, s, d);
const easeInOut = (t: number) => C.easing.easeInOut(t);
const lerp = THREE.MathUtils.lerp;
function dampAngle(cur: number, target: number, s: number, dt: number) {
  const diff = ((target - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + diff * (1 - Math.exp(-s * dt));
}
const isIdleState = (s: string) => s.toLowerCase() === "idle";
const isLimitState = (s: string) => s.toLowerCase() === "limit";
const chooseBreakSpot = (i: number, wave: number) => BREAK_ORDER[(i + wave) % BREAK_ORDER.length];

function reserveBreakSpot(workerId: string, preferred: BreakSpotId, limit: boolean) {
  if (!limit && breakReservations.size >= C.movement.maxSimultaneousBreaks) return null;
  if (!breakReservations.has(preferred)) { breakReservations.set(preferred, workerId); return preferred; }
  for (const spot of BREAK_ORDER) {
    if (!breakReservations.has(spot)) { breakReservations.set(spot, workerId); return spot; }
  }
  return null;
}
function releaseBreakSpot(workerId: string) {
  for (const [spot, id] of breakReservations) if (id === workerId) breakReservations.delete(spot);
}

function getBreakPlan(index: number, elapsed: number, ext: string, random: () => number) {
  if (isLimitState(ext)) return { preferred: chooseBreakSpot(index, 0), duration: Infinity };
  if (!isIdleState(ext) || elapsed < C.movement.firstBreakDelay) return null;
  const wave = Math.floor((elapsed - C.movement.firstBreakDelay) / C.movement.breakWaveInterval);
  const pair = BREAK_PAIRS[wave % BREAK_PAIRS.length];
  if (!pair.includes(index)) return null;
  const local = (elapsed - C.movement.firstBreakDelay) % C.movement.breakWaveInterval;
  const start = (pair[0] === index ? 0 : 1) * C.movement.breakStartSpacing;
  if (local < start || local > start + 15) return null;
  return {
    preferred: chooseBreakSpot(index, wave),
    duration: lerp(C.movement.breakDurationMin, C.movement.breakDurationMax, random()),
  };
}

// desk -> step out sideways -> aisle -> lounge lane -> lounge front -> spot. Reversed for the way back.
function buildRoute(start: THREE.Vector3, id: string, spotId: BreakSpotId, back: boolean) {
  const seat = getSeatTransform(DESKS[id]);
  const sp = BREAK_SPOTS[spotId];
  const ap = new THREE.Vector3(...seat.approachPosition);
  const pts = [
    ap,
    new THREE.Vector3(ap.x, 0, seat.aisleZ),
    new THREE.Vector3(C.navigation.laneX, 0, seat.aisleZ),
    new THREE.Vector3(C.navigation.laneX, 0, F),
    ...sp.via.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    new THREE.Vector3(...sp.pos),
  ];
  if (back) pts.reverse();
  const anchors = [start.clone()];
  for (const p of pts) if (anchors[anchors.length - 1].distanceTo(p) > 0.2) anchors.push(p);
  if (anchors.length < 2) anchors.push(start.clone().add(new THREE.Vector3(0.01, 0, 0)));
  const curve = new THREE.CatmullRomCurve3(anchors, false, "centripetal");
  return { curve, length: curve.getLength() };
}

function colliderList() {
  const result = C.navigation.staticObstacles.map((c) => ({
    id: c.id, minX: c.min[0], maxX: c.max[0], minZ: c.min[1], maxZ: c.max[1],
  }));
  for (const id of Object.keys(DESKS)) {
    const [x, , z] = DESKS[id];
    const head = id === "dira";
    const w = head ? C.workZone.desk.headWidth : C.workZone.desk.width;
    const d = head ? C.workZone.desk.headDepth : C.workZone.desk.depth;
    result.push({ id: `desk-${id}`, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    const seat = getSeatTransform(DESKS[id]);
    const pad = C.navigation.obstaclePadding;
    result.push({
      id: `chair-${id}`,
      minX: seat.chairPosition[0] - C.desks.chairWidth / 2 - pad, maxX: seat.chairPosition[0] + C.desks.chairWidth / 2 + pad,
      minZ: seat.chairPosition[2] - C.desks.chairSeatDepth / 2 - pad, maxZ: seat.chairPosition[2] + C.desks.chairSeatDepth / 2 + pad,
    });
  }
  return result;
}

/* ---------- pose system: every mode writes targets, one place damps the rig toward them ---------- */
type Pose = {
  bodyY: number; bodyX: number; bodyPX: number; headY: number; headX: number;
  ul: number; ur: number; el: number; er: number; ulz: number; urz: number;
  hl: number; hr: number; kl: number; kr: number;
};
const STAND: Pose = {
  bodyY: 0, bodyX: 0, bodyPX: 0, headY: 0, headX: 0,
  ul: 0.05, ur: 0.05, el: 0.15, er: 0.15, ulz: -0.06, urz: 0.06, hl: 0, hr: 0, kl: 0, kr: 0,
};
// s: 0 = standing, 1 = seated. Thighs forward ~90deg, knees bent back ~90deg, hands on keyboard.
function applySit(p: Pose, s: number, lift: number) {
  p.bodyY = lift * s;
  p.bodyX = -0.04 * s;
  p.hl = p.hr = 1.55 * s;
  p.kl = p.kr = -1.55 * s;
  p.ul = p.ur = lerp(0.05, 1.15, s);
  p.el = p.er = lerp(0.15, 0.35, s);
}

function workingPose(
  p: Pose, elapsed: number, idx: number,
  micro: { type: MicroAction; started: number; duration: number; next: number },
  allowed: boolean, random: () => number,
) {
  const I = C.idle;
  applySit(p, 1, C.rig.seatLift);
  p.bodyY += Math.sin((elapsed + idx * 0.83) * 2 * Math.PI * I.breathingHz) * I.breathingAmplitude;

  if (allowed && micro.type === "NONE" && elapsed >= micro.next) {
    const roll = random();
    const checks: Array<[number, MicroAction]> = [
      [I.probabilities.stretch, "STRETCH"], [I.probabilities.scratch, "SCRATCH"], [I.probabilities.drink, "DRINK"],
      [I.probabilities.lean, "LEAN"], [I.probabilities.shift, "SHIFT"], [1, "LOOK"],
    ];
    let cum = 0;
    let picked: MicroAction = "LOOK";
    for (const [w, t] of checks) { cum += w; if (roll <= cum) { picked = t; break; } }
    micro.type = picked;
    micro.started = elapsed;
    micro.duration = lerp(0.9, 2.2, random());
    micro.next = elapsed + lerp(I.microMinSeconds, I.microMaxSeconds, random());
  }
  const active = micro.type !== "NONE" && elapsed - micro.started < micro.duration;
  if (!active && micro.type !== "NONE") micro.type = "NONE";
  const wave = active ? Math.sin(easeInOut((elapsed - micro.started) / micro.duration) * Math.PI) : 0;

  p.headX = Math.sin(elapsed * 0.65 + idx) * I.headNodAmplitude * 0.3;
  p.headY = Math.sin(elapsed * 0.3 + idx * 2) * 0.05;
  const amp = active && micro.type !== "LOOK" ? 0.02 : I.typingAmplitude;
  const tL = Math.sin(elapsed * I.typingSpeed + idx);
  const tR = Math.sin(elapsed * I.typingSpeed * 1.13 + idx * 1.7);
  p.ul += tL * amp * 0.5; p.el += tL * amp;
  p.ur += tR * amp * 0.5; p.er += tR * amp;

  if (!active) return;
  switch (micro.type) {
    case "LOOK": p.headY = I.headTurnAmplitude * wave; break;
    case "SCRATCH": p.ul = 1.15 + 1.3 * wave; p.el = 0.35 + 1.0 * wave; break;
    case "DRINK": p.ul = 1.15 + 0.5 * wave; p.el = 0.35 + 0.9 * wave; p.ulz = -0.06 - 0.2 * wave; p.headX += 0.1 * wave; break;
    case "LEAN": p.bodyX = -0.04 + 0.16 * wave; break;
    case "STRETCH": p.ul = p.ur = 0.3; p.el = p.er = 0.1; p.ulz = -2.7 * wave; p.urz = 2.7 * wave; p.bodyX = 0.14 * wave; p.headX -= 0.15 * wave; break;
    case "SHIFT": p.bodyPX = 0.1 * wave; break;
  }
}

/* ---------- root ---------- */
export default function OfficeWorld({
  people, running, resting, selected, onSelect, workerCommand,
}: {
  people: Person[]; running: boolean; resting: boolean; selected: string | null; onSelect: (id: string | null) => void;
  workerCommand: WorkerCommand | null;
}) {
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "d") setDebug((v) => !v); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quality = C.quality[C.quality.preset];
  const hitboxes = useRef(new Map<string, THREE.Object3D>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const registerHitbox = useCallback((id: string, o: THREE.Object3D | null) => {
    if (o) hitboxes.current.set(id, o); else hitboxes.current.delete(id);
  }, []);

  return (
    <Canvas
      shadows
      dpr={[1, quality.dpr]}
      frameloop="always"
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", display: "block" }}
      onCreated={({ gl, scene }) => {
        gl.setPixelRatio(Math.min(window.devicePixelRatio, quality.dpr));
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.shadowMap.enabled = true;
        scene.background = new THREE.Color("#c3ccd6");
        scene.fog = new THREE.Fog("#c3ccd6", 45, 90);
      }}
    >
      <PerspectiveCamera makeDefault position={[19.5, 15.8, 21.5]} fov={32} near={0.1} far={140} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#e3eefa", "#9a7c5e", 1.1]} />
      <directionalLight
        castShadow
        position={[9, 16, 12]}
        intensity={2.6}
        color="#fff0d8"
        shadow-mapSize-width={quality.shadowMap}
        shadow-mapSize-height={quality.shadowMap}
        shadow-camera-left={-19}
        shadow-camera-right={19}
        shadow-camera-top={19}
        shadow-camera-bottom={-19}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />

      <InteractionController hitboxes={hitboxes} onSelect={onSelect} onHover={setHoveredId} />
      <OfficeEnvironment resting={resting} />
      <ContactShadows position={[0, C.visual.floorOffset, 0]} opacity={0.3} scale={26} blur={2.2} far={8} resolution={quality.contactResolution} frames={quality.contactFrames} />

      {people.map((person, index) => (
        <WorkerCharacter
          key={person.id}
          person={person}
          workerIndex={index}
          selected={selected === person.id}
          hovered={hoveredId === person.id}
          registerHitbox={registerHitbox}
          running={running}
          globalResting={resting}
          debug={debug}
          workerCommand={workerCommand}
        />
      ))}

      {debug && <ColliderDebug />}
      <Html fullscreen style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", right: 12, top: 12, padding: "6px 9px", borderRadius: 8, fontSize: 8, background: "#10141bd9", color: "#fff", opacity: 0.78 }}>
          {debug ? "COLLIDERS ON · press D to hide" : "press D · debug colliders"}
        </div>
      </Html>

      <OrbitControls target={[0, 0.9, 0.5]} minDistance={12} maxDistance={32} minPolarAngle={0.7} maxPolarAngle={1.4} enableDamping dampingFactor={0.08} enablePan />
    </Canvas>
  );
}

function InteractionController({ hitboxes, onSelect, onHover }: {
  hitboxes: MutableRefObject<Map<string, THREE.Object3D>>; onSelect: (id: string | null) => void; onHover: (id: string | null) => void;
}) {
  const { gl, camera } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverRaf = 0;
    let pendingMove: PointerEvent | null = null;
    let down: { x: number; y: number } | null = null;

    const raycastWorker = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targets = Array.from(hitboxes.current.values());
      if (!targets.length) return null;
      const hits = raycaster.intersectObjects(targets, false);
      return (hits[0]?.object.userData.workerId as string | undefined) ?? null;
    };
    const applyHover = () => {
      hoverRaf = 0;
      if (!pendingMove) return;
      const id = raycastWorker(pendingMove);
      onHover(id);
      canvas.style.cursor = id ? "pointer" : "grab";
      pendingMove = null;
    };
    const onMove = (e: PointerEvent) => { pendingMove = e; if (!hoverRaf) hoverRaf = requestAnimationFrame(applyHover); };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; canvas.style.cursor = "grabbing"; };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      const id = raycastWorker(e);
      if (moved <= 5) onSelect(id);
      canvas.style.cursor = id ? "pointer" : "grab";
    };
    const onLeave = () => { pendingMove = null; onHover(null); canvas.style.cursor = "grab"; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSelect(null); };

    canvas.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerdown", onDown, { passive: true });
    canvas.addEventListener("pointerup", onUp, { passive: true });
    canvas.addEventListener("pointercancel", onLeave, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onLeave);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
  }, [camera, gl, hitboxes, onHover, onSelect]);
  return null;
}

/* ---------- environment (brighter, decluttered) ---------- */
function OfficeEnvironment({ resting }: { resting: boolean }) {
  return (
    <group>
      <mesh position={[0, -0.34, 0]} receiveShadow>
        <boxGeometry args={[C.room.width, 0.52, C.room.depth]} />
        <meshStandardMaterial color="#6b5040" roughness={0.88} />
      </mesh>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[C.room.width - 0.28, 0.1, C.room.depth - 0.28]} />
        <meshStandardMaterial color="#c9a57f" roughness={0.9} />
      </mesh>
      <FloorPlanks />
      <Walls />
      <Windows />
      <CeilingLights resting={resting} />
      <FloorRugs />
      <WorkFurniture />
      <Lounge />
      <WallBoard />
      <Door />
      <OfficeBranding />
      <BookcaseRow />
    </group>
  );
}

function FloorPlanks() {
  return (
    <group>
      {Array.from({ length: 21 }).map((_, row) => (
        <mesh key={row} position={[0, -0.003, -11 + row * 1.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[29.4, 0.02]} />
          <meshBasicMaterial color={row % 2 ? "#b08b66" : "#a07c58"} transparent opacity={0.4} />
        </mesh>
      ))}
      {Array.from({ length: 29 }).map((_, i) => (
        <mesh key={"v" + i} position={[-14 + i * 1.0, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.015, 22.4]} />
          <meshBasicMaterial color="#a88460" transparent opacity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Walls() {
  const R = C.room;
  return (
    <group>
      <mesh position={[0, R.wallHeight / 2, R.backWallZ]} receiveShadow>
        <boxGeometry args={[R.width, R.wallHeight, 0.28]} />
        <meshStandardMaterial color="#e6e1d7" roughness={0.95} />
      </mesh>
      <mesh position={[R.leftWallX, R.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.28, R.wallHeight, R.depth]} />
        <meshStandardMaterial color="#ddd7cb" roughness={0.95} />
      </mesh>
      <mesh position={[R.rightWallX, R.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.28, R.wallHeight, R.depth]} />
        <meshStandardMaterial color="#e9e4d9" roughness={0.95} />
      </mesh>
      {/* baseboards */}
      <mesh position={[0, 0.2, R.backWallZ + 0.17]}><boxGeometry args={[R.width, 0.4, 0.08]} /><meshStandardMaterial color="#8d7966" roughness={0.7} /></mesh>
      <mesh position={[R.leftWallX + 0.17, 0.2, 0]}><boxGeometry args={[0.08, 0.4, R.depth]} /><meshStandardMaterial color="#8d7966" roughness={0.7} /></mesh>
      <mesh position={[R.rightWallX - 0.17, 0.2, 0]}><boxGeometry args={[0.08, 0.4, R.depth]} /><meshStandardMaterial color="#8d7966" roughness={0.7} /></mesh>
    </group>
  );
}

function Windows() {
  return (
    <group>
      {[-11.6, -7.6, 3.6, 7.6].map((x) => (
        <group key={x} position={[x, 4.6, -11.3]}>
          <RoundedBox args={[3.4, 2.4, 0.1]} radius={0.04} smoothness={2} castShadow>
            <meshStandardMaterial color="#8a7a66" roughness={0.6} />
          </RoundedBox>
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[3.14, 2.14, 0.02]} />
            <meshStandardMaterial color="#b5d5ea" emissive="#8fc0e6" emissiveIntensity={0.55} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.085]}><boxGeometry args={[0.06, 2.14, 0.02]} /><meshStandardMaterial color="#8a7a66" /></mesh>
          <mesh position={[0, 0, 0.085]}><boxGeometry args={[3.14, 0.06, 0.02]} /><meshStandardMaterial color="#8a7a66" /></mesh>
        </group>
      ))}
    </group>
  );
}

function CeilingLights({ resting }: { resting: boolean }) {
  return (
    <group>
      {[-6, 0, 6].map((x) =>
        [-2, 4].map((z) => (
          <group key={`${x}-${z}`} position={[x, 6.9, z]}>
            <mesh><boxGeometry args={[1.8, 0.06, 0.7]} /><meshStandardMaterial color="#f4eee2" emissive="#fff3d6" emissiveIntensity={resting ? 0.25 : 0.7} /></mesh>
          </group>
        )),
      )}
    </group>
  );
}

function OfficeBranding() {
  return (
    <group position={[12, 4.6, -11.28]}>
      <RoundedBox args={[5.2, 2.25, 0.1]} radius={0.06} smoothness={3} castShadow><meshStandardMaterial color="#1c2430" roughness={0.4} /></RoundedBox>
      <Html center position={[0, 0, 0.08]} distanceFactor={12} style={{ pointerEvents: "none" }}>
        <div className="officeBrand"><div className="officeBrandIcon">◈</div><div className="officeBrandTitle">AI AGENT OFFICE</div><div className="officeBrandSub">YOUTUBE FACTORY · AUTONOMOUS STUDIO</div></div>
      </Html>
    </group>
  );
}

function BookcaseRow() {
  return (
    <group>
      {[-10.5, -8.2, -5.9, 8.0].map((x, i) => (
        <group key={x} position={[x, 1.6, -10.88]}>
          <mesh castShadow><boxGeometry args={[1.9, 3.2, 0.56]} /><meshStandardMaterial color="#6a4f3c" roughness={0.85} /></mesh>
          {[0.85, 0.02, -0.82].map((y, j) => (
            <mesh key={j} position={[0, y, 0.31]}><boxGeometry args={[1.72, 0.08, 0.08]} /><meshStandardMaterial color="#8d6a4f" roughness={0.9} /></mesh>
          ))}
          {[-0.62, -0.2, 0.2, 0.62].map((x2, j) => (
            <mesh key={j} position={[x2, 0.45 + (j % 2) * 0.05, 0.37]} rotation={[0, (j % 2) * 0.08, 0]}>
              <boxGeometry args={[0.2, 0.62, 0.13]} /><meshStandardMaterial color={["#c2655e", "#dcae55", "#558aa8", "#7ba27c"][j]} />
            </mesh>
          ))}
          {i % 2 === 0 && <Plant position={[0, 1.62, 0.3]} scale={0.6} />}
        </group>
      ))}
    </group>
  );
}

function FloorRugs() {
  const [lx, , lz] = C.lounge.center;
  const [lw, ld] = C.lounge.size;
  return (
    <group>
      {/* team rug */}
      <mesh position={[0, 0.008, 0.9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[11.8, 8.6]} /><meshStandardMaterial color="#6f6281" roughness={0.98} /></mesh>
      <mesh position={[0, 0.012, 0.9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[11.2, 8.0]} /><meshStandardMaterial color="#8a7d9c" roughness={0.99} /></mesh>
      {/* head rug */}
      <mesh position={[0, 0.009, 7.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[4.6, 3.0]} /><meshStandardMaterial color="#75668a" roughness={0.98} /></mesh>
      <mesh position={[0, 0.013, 7.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[4.2, 2.6]} /><meshStandardMaterial color="#94869f" roughness={0.99} /></mesh>
      {/* lounge rug */}
      <mesh position={[lx, 0.015, lz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[lw, ld]} /><meshStandardMaterial color="#6a5a7c" roughness={0.98} /></mesh>
      <mesh position={[lx, 0.018, lz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[lw - 0.5, ld - 0.5]} /><meshStandardMaterial color="#85769a" roughness={0.99} /></mesh>
    </group>
  );
}

function WorkFurniture() {
  return (
    <group>
      {WORKER_DESK_IDS.map((id) => <Desk key={id} id={id} position={DESKS[id]} />)}
      <Desk id="dira" position={DESKS.dira} />
      <Shelf position={C.decor.shelf} />
      <Printer position={C.decor.printer} />
      <ServerRack position={C.decor.server} />
    </group>
  );
}

function Desk({ id, position }: { id: string; position: [number, number, number] }) {
  const head = id === "dira";
  const w = head ? C.workZone.desk.headWidth : C.workZone.desk.width;
  const d = head ? C.workZone.desk.headDepth : C.workZone.desk.depth;
  const top = C.workZone.desk.topY;
  const th = C.workZone.desk.thickness;
  return (
    <group position={position} rotation={[0, C.desks.rotationY, 0]}>
      <RoundedBox args={[w, th, d]} radius={0.04} smoothness={2} position={[0, top - th / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={head ? "#6a5482" : "#7a5a42"} roughness={0.6} />
        <Edges color={head ? "#d9c8ff" : "#d8bb98"} threshold={30} lineWidth={1} />
      </RoundedBox>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.15), (top - th) / 2, sz * (d / 2 - 0.13)]} castShadow>
          <boxGeometry args={[0.12, top - th, 0.12]} />
          <meshStandardMaterial color="#3a2a22" roughness={0.85} />
        </mesh>
      )))}
      {/* everything below sits ON the desk surface (y = 0 here is the surface) */}
      <group position={[0, top, 0]}>
        <Monitor head={head} />
        <mesh position={[0, 0.02, 0.4]}><boxGeometry args={[0.84, 0.04, 0.28]} /><meshStandardMaterial color="#2a3038" roughness={0.5} /></mesh>
        <mesh position={[-0.85, 0.09, 0.3]} castShadow><cylinderGeometry args={[0.11, 0.12, 0.18, 12]} /><meshStandardMaterial color="#efe8dc" roughness={0.8} /></mesh>
        {[0, 0.028, 0.056].map((y) => (
          <mesh key={y} position={[0.7, 0.014 + y, 0.3]}><boxGeometry args={[0.43, 0.024, 0.33]} /><meshStandardMaterial color="#f3efe9" roughness={0.95} /></mesh>
        ))}
        <group position={[head ? 1.1 : 0.95, 0, -0.2]}>
          <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.035, 0.035, 0.5, 8]} /><meshStandardMaterial color="#3b444d" roughness={0.7} /></mesh>
          <mesh position={[0, 0.53, 0]}><coneGeometry args={[head ? 0.23 : 0.19, 0.22, 12]} /><meshStandardMaterial color="#e6b75b" emissive="#c98a2a" emissiveIntensity={0.3} /></mesh>
        </group>
      </group>
    </group>
  );
}

function Monitor({ head }: { head: boolean }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const cursor = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (screen.current) screen.current.emissiveIntensity = 0.55 + Math.sin(state.clock.elapsedTime * C.visual.monitorPulseSpeed) * 0.06;
    if (cursor.current) cursor.current.position.x = -0.36 + ((state.clock.elapsedTime * C.visual.cursorSpeed) % 0.66);
  });
  return (
    <group position={[0, 0.66, -0.24]}>
      <RoundedBox args={[head ? 1.26 : 1.1, 0.7, 0.1]} radius={0.04} smoothness={2} castShadow><meshStandardMaterial color="#0c1117" roughness={0.35} /></RoundedBox>
      <mesh position={[0, -0.02, 0.058]}>
        <boxGeometry args={[head ? 1.0 : 0.88, 0.48, 0.02]} />
        <meshStandardMaterial ref={screen} color="#17333e" emissive="#49c4ed" roughness={0.24} />
      </mesh>
      {[-0.31, 0, 0.25].map((x, i) => (
        <mesh key={i} position={[x, 0.12, 0.08]}><boxGeometry args={[i === 0 ? 0.16 : 0.13, 0.035, 0.008]} /><meshBasicMaterial color={i === 2 ? "#f4d26e" : "#58b9e2"} /></mesh>
      ))}
      <mesh ref={cursor} position={[-0.36, -0.14, 0.09]}><boxGeometry args={[0.02, 0.06, 0.009]} /><meshBasicMaterial color="#f7f4dc" /></mesh>
      <mesh position={[0, -0.46, 0]}><boxGeometry args={[0.11, 0.24, 0.11]} /><meshStandardMaterial color="#47535e" /></mesh>
      <mesh position={[0, -0.625, 0]}><boxGeometry args={[0.68, 0.05, 0.3]} /><meshStandardMaterial color="#303941" /></mesh>
    </group>
  );
}

function Lounge() {
  return (
    <group>
      <Sofa />
      <VendingMachine position={C.lounge.snacks} />
      <Beanbag position={C.lounge.beanbagA} />
      <Beanbag position={C.lounge.beanbagB} />
      <CoffeeTable position={C.lounge.coffeeTable} />
      {C.decor.plants.map((p, i) => <Plant key={i} position={p} />)}
    </group>
  );
}

function Sofa() {
  return (
    <group position={[5.55, 0, -8.53]}>
      <RoundedBox args={[4.2, 0.68, 1.02]} radius={0.18} smoothness={3} position={[0, 0.5, 0]} castShadow>
        <meshStandardMaterial color="#7d6a8a" roughness={0.9} /><Edges color="#b7a3c2" threshold={28} lineWidth={0.8} />
      </RoundedBox>
      <RoundedBox args={[0.36, 1.55, 1.02]} radius={0.12} smoothness={3} position={[-1.92, 1.02, 0]} castShadow><meshStandardMaterial color="#7d6a8a" /></RoundedBox>
      <RoundedBox args={[0.36, 1.55, 1.02]} radius={0.12} smoothness={3} position={[1.92, 1.02, 0]} castShadow><meshStandardMaterial color="#7d6a8a" /></RoundedBox>
      <RoundedBox args={[3.15, 0.68, 0.18]} radius={0.08} smoothness={2} position={[0, 1.04, -0.4]}><meshStandardMaterial color="#87728f" /></RoundedBox>
    </group>
  );
}

function VendingMachine({ position }: { position: [number, number, number] }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => { if (mat.current) mat.current.emissiveIntensity = 0.3 + Math.sin(s.clock.elapsedTime * 3) * 0.07; });
  return (
    <group position={[position[0], position[1] + 1.25, position[2]]}>
      <RoundedBox args={[1.02, 2.5, 0.78]} radius={0.08} smoothness={2} castShadow><meshStandardMaterial color="#35414c" roughness={0.4} /></RoundedBox>
      <mesh position={[0, 0.28, 0.4]}><boxGeometry args={[0.76, 1.0, 0.03]} /><meshStandardMaterial ref={mat} color="#152a33" emissive="#2d6d82" roughness={0.22} /></mesh>
      {[-0.24, 0, 0.24].map((x, i) => <mesh key={i} position={[x, -0.65, 0.41]}><boxGeometry args={[0.14, 0.18, 0.04]} /><meshStandardMaterial color={["#ed7f84", "#efc867", "#6bc991"][i]} /></mesh>)}
      <Html center position={[0, 1.55, 0.16]} distanceFactor={14} style={{ pointerEvents: "none" }}><div className="prop-label">SNACKS</div></Html>
    </group>
  );
}

function Beanbag({ position }: { position: [number, number, number] }) {
  return <mesh position={position} scale={[1, 0.72, 1]} castShadow><sphereGeometry args={[0.74, 16, 10]} /><meshStandardMaterial color="#7f8bb3" roughness={0.95} /></mesh>;
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.34, 0]} castShadow><cylinderGeometry args={[0.5, 0.48, 0.1, 14]} /><meshStandardMaterial color="#8a6a52" roughness={0.8} /></mesh>
      <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.08, 0.12, 0.3, 10]} /><meshStandardMaterial color="#5c4233" /></mesh>
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.24, 0]} castShadow><cylinderGeometry args={[0.34, 0.26, 0.48, 10]} /><meshStandardMaterial color="#b97c52" roughness={0.95} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.26) * 0.16, 0.75, Math.sin(i * 1.26) * 0.16]} rotation={[Math.sin(i * 1.26) * 0.4, 0, -Math.cos(i * 1.26) * 0.4]} castShadow>
          <coneGeometry args={[0.16, 0.7, 6]} /><meshStandardMaterial color={["#63b579", "#4aa66b", "#7ac78a", "#58ae72", "#6cbd82"][i]} />
        </mesh>
      ))}
    </group>
  );
}

function Shelf({ position }: { position: [number, number, number] }) {
  return (
    <group position={[position[0], position[1] + 1.55, position[2]]}>
      <mesh castShadow><boxGeometry args={[1.4, 3.1, 0.56]} /><meshStandardMaterial color="#6a5039" roughness={0.85} /></mesh>
      {[0.82, 0.05, -0.72].map((y) => <mesh key={y} position={[0, y, 0.31]}><boxGeometry args={[1.28, 0.1, 0.08]} /><meshStandardMaterial color="#8d6a4a" /></mesh>)}
      {[-0.36, 0.02, 0.36].map((x, i) => <mesh key={i} position={[x, 0.42, 0.35]}><boxGeometry args={[0.18, 0.36, 0.1]} /><meshStandardMaterial color={["#eab45b", "#70b8df", "#d67faa"][i]} /></mesh>)}
    </group>
  );
}

function Printer({ position }: { position: [number, number, number] }) {
  return (
    <group position={[position[0], position[1] + 0.41, position[2]]}>
      <RoundedBox args={[1.05, 0.82, 0.8]} radius={0.08} smoothness={2} castShadow><meshStandardMaterial color="#5a656f" roughness={0.55} /></RoundedBox>
      <mesh position={[0, 0.43, 0.04]}><boxGeometry args={[0.74, 0.05, 0.45]} /><meshStandardMaterial color="#ebeff2" /></mesh>
    </group>
  );
}

function ServerRack({ position }: { position: [number, number, number] }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => { if (mat.current) mat.current.emissiveIntensity = 0.15 + Math.sin(s.clock.elapsedTime * 5) * 0.08; });
  return (
    <group position={[position[0], position[1] + 1.08, position[2]]}>
      <RoundedBox args={[1.15, 2.15, 0.76]} radius={0.06} smoothness={2} castShadow><meshStandardMaterial color="#2e3842" roughness={0.55} /></RoundedBox>
      {[-0.5, 0, 0.5].map((y) => <mesh key={y} position={[0, y, 0.4]}><boxGeometry args={[0.75, 0.25, 0.02]} /><meshStandardMaterial ref={y === 0 ? mat : undefined} color="#1e3038" emissive="#58d7ff" /></mesh>)}
    </group>
  );
}

function WallBoard() {
  return (
    <group position={C.decor.board}>
      <RoundedBox args={[5.1, 2.25, 0.12]} radius={0.05} smoothness={2} castShadow><meshStandardMaterial color="#232a32" roughness={0.48} /></RoundedBox>
      <Html center position={[0, 0, 0.08]} distanceFactor={12} style={{ pointerEvents: "none" }}>
        <div className="worldBoard">
          <div className="wbHead">TODAY'S PIPELINE</div>
          <div className="wbRow"><span>Research</span><b>✓</b></div>
          <div className="wbRow"><span>Script</span><b>✓</b></div>
          <div className="wbRow"><span>Scenes</span><b>12/30</b></div>
          <div className="wbState">PRODUCTION ACTIVE</div>
        </div>
      </Html>
    </group>
  );
}

function Door() {
  const [x, , z] = C.navigation.doorPosition;
  return (
    <group position={[x, 1.5, z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh castShadow><boxGeometry args={[2.1, 3.0, 0.16]} /><meshStandardMaterial color="#7d5f49" roughness={0.78} /></mesh>
      <mesh position={[0, 0, 0.11]}><boxGeometry args={[1.72, 2.55, 0.02]} /><meshStandardMaterial color="#b98a62" /></mesh>
      <mesh position={[0.6, -0.18, 0.17]}><sphereGeometry args={[0.06, 10, 10]} /><meshStandardMaterial color="#e8c16c" /></mesh>
    </group>
  );
}

function ColliderDebug() {
  const colliders = useMemo(() => colliderList(), []);
  return (
    <group>
      {colliders.map((c) => (
        <mesh key={c.id} position={[(c.minX + c.maxX) / 2, 0.035, (c.minZ + c.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[c.maxX - c.minX, c.maxZ - c.minZ]} />
          <meshBasicMaterial color="#ff405d" transparent opacity={0.18} depthWrite={false} wireframe />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- character ---------- */
function WorkerCharacter({ person, workerIndex, selected, running, globalResting, debug, hovered, registerHitbox, workerCommand }: {
  person: Person; workerIndex: number; selected: boolean; running: boolean; globalResting: boolean;
  debug: boolean; hovered: boolean; registerHitbox: (id: string, o: THREE.Object3D | null) => void;
  workerCommand: WorkerCommand | null;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const chair = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const ring = useRef<THREE.Mesh>(null);
  const hitbox = useRef<THREE.Mesh>(null);

  useEffect(() => {
    registerHitbox(person.id, hitbox.current);
    return () => registerHitbox(person.id, null);
  }, [person.id, registerHitbox]);

  const random = useMemo(() => seededRandom((workerIndex + 13) * 9176), [workerIndex]);
  const speed = useMemo(() => 1 - C.movement.speedVariance + random() * C.movement.speedVariance * 2, [random]);
  const mode = useRef<Mode>("WORKING");
  const modeTime = useRef(0);
  const lastCommandNonce = useRef(0);
  const micro = useRef<{ type: MicroAction; started: number; duration: number; next: number }>({ type: "NONE", started: 0, duration: 0, next: 3 + random() * 5 });
  const plan = useRef<{ spot: BreakSpotId; duration: number; limit: boolean } | null>(null);
  const route = useRef<{ curve: THREE.CatmullRomCurve3; length: number } | null>(null);
  const distance = useRef(0);
  const pose = useRef<Pose>({ ...STAND });
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const seat = useMemo(() => getSeatTransform(DESKS[person.id]), [person.id]);
  const home = useMemo(() => new THREE.Vector3(...seat.seatPosition), [seat]);
  const chairHome = useMemo(() => new THREE.Vector3(...seat.chairPosition), [seat]);
  const pulledSeat = useMemo(() => new THREE.Vector3(...seat.pulledSeatPosition), [seat]);
  const pulledChair = useMemo(() => new THREE.Vector3(...seat.pulledChairPosition), [seat]);
  const approach = useMemo(() => new THREE.Vector3(...seat.approachPosition), [seat]);

  useFrame((state, rawDelta) => {
    const r = root.current, b = body.current, h = head.current, c = chair.current;
    if (!r || !b || !h || !c || !armL.current || !armR.current || !elbowL.current || !elbowR.current ||
        !legL.current || !legR.current || !kneeL.current || !kneeR.current) return;
    const delta = Math.min(rawDelta, 0.05);
    const elapsed = state.clock.elapsedTime;
    const ext = person.state;
    modeTime.current += delta;

    const shouldLimit = isLimitState(ext);
    const away = mode.current === "WALK" || mode.current === "ARRIVE" || mode.current === "ACTIVITY";

    const goHome = () => {
      const spot = plan.current?.spot ?? "window";
      releaseBreakSpot(person.id);
      route.current = buildRoute(r.position.clone(), person.id, spot, true);
      distance.current = 0;
      mode.current = "WALK_BACK";
      modeTime.current = 0;
      plan.current = null;
    };

    if (workerCommand?.workerId === person.id && workerCommand.nonce !== lastCommandNonce.current) {
      lastCommandNonce.current = workerCommand.nonce;
      if (workerCommand.type === "RETURN") {
        if (away || mode.current === "ANTICIPATE" || mode.current === "STAND_UP") goHome();
      } else if (workerCommand.type === "BREAK" && !shouldLimit && mode.current === "WORKING") {
        const preferred = chooseBreakSpot(workerIndex, Math.floor(elapsed / Math.max(1, C.movement.breakWaveInterval)));
        const spot = reserveBreakSpot(person.id, preferred, false);
        if (spot) {
          plan.current = { spot, duration: lerp(C.movement.breakDurationMin, C.movement.breakDurationMax, 0.5), limit: false };
          mode.current = "ANTICIPATE";
          modeTime.current = 0;
        }
      }
    }

    if ((globalResting || !running) && (away || mode.current === "ANTICIPATE" || mode.current === "STAND_UP") && !shouldLimit) goHome();
    if (!shouldLimit && plan.current?.limit && away) goHome();

    const breakPlan = globalResting || !running ? null : getBreakPlan(workerIndex, elapsed, ext, random);

    if (shouldLimit && mode.current === "WORKING" && !plan.current) {
      const spot = reserveBreakSpot(person.id, breakPlan?.preferred ?? chooseBreakSpot(workerIndex, 0), true);
      if (spot) { plan.current = { spot, duration: Infinity, limit: true }; mode.current = "ANTICIPATE"; modeTime.current = 0; }
    }
    if (running && breakPlan && !shouldLimit && mode.current === "WORKING" && !plan.current) {
      const spot = reserveBreakSpot(person.id, breakPlan.preferred, false);
      if (spot) { plan.current = { spot, duration: breakPlan.duration, limit: false }; mode.current = "ANTICIPATE"; modeTime.current = 0; }
    }

    const m = mode.current;
    const p = pose.current;
    Object.assign(p, STAND);
    const M = C.movement;

    if (m === "WORKING") {
      workingPose(p, elapsed, workerIndex, micro.current, isIdleState(ext), random);
      r.position.x = damp(r.position.x, home.x, M.positionDamping, delta);
      r.position.z = damp(r.position.z, home.z, M.positionDamping, delta);
      r.rotation.y = dampAngle(r.rotation.y, seat.rotationY, M.turnDamping, delta);
      c.position.x = damp(c.position.x, chairHome.x, 10, delta);
      c.position.z = damp(c.position.z, chairHome.z, 10, delta);
      c.rotation.y = dampAngle(c.rotation.y, seat.rotationY, 9, delta);
    }

    if (m === "ANTICIPATE") {
      const u = clamp01(modeTime.current / M.anticipateDuration);
      applySit(p, 1, C.rig.seatLift);
      p.headY = 0.3 * Math.sin(u * Math.PI);
      p.bodyX = -0.04 - 0.1 * Math.sin(u * Math.PI);
      if (u >= 1) { mode.current = "STAND_UP"; modeTime.current = 0; }
    }

    // Chair rolls back with the character on it, then the character stands and steps sideways out of the row.
    if (m === "STAND_UP") {
      const pr = clamp01(modeTime.current / M.standUpDuration);
      const k = easeInOut(clamp01(pr / 0.5));
      const sit = 1 - easeInOut(clamp01((pr - 0.4) / 0.3));
      const s = easeInOut(clamp01((pr - 0.62) / 0.38));
      tmp.lerpVectors(home, pulledSeat, k);
      r.position.lerpVectors(tmp, approach, s);
      c.position.lerpVectors(chairHome, pulledChair, k);
      c.rotation.y = seat.rotationY + C.desks.chairTurn * k;
      r.rotation.y = dampAngle(r.rotation.y, seat.rotationY, 8, delta);
      applySit(p, sit, C.rig.seatLift);
      p.bodyX += -0.08 * Math.sin(clamp01((pr - 0.3) / 0.4) * Math.PI);
      if (pr >= 1 && plan.current) {
        route.current = buildRoute(approach.clone(), person.id, plan.current.spot, false);
        distance.current = 0;
        mode.current = "WALK";
        modeTime.current = 0;
      }
    }

    if (m === "WALK" || m === "WALK_BACK") {
      const rt = route.current;
      if (!rt) {
        mode.current = m === "WALK" ? "ARRIVE" : "SIT_DOWN";
        modeTime.current = 0;
      } else {
        const u = clamp01(distance.current / Math.max(rt.length, 0.001));
        const accel = C.easing.smoother(clamp01(u / C.walking.accelerationFraction));
        const decel = C.easing.smoother(clamp01((1 - u) / C.walking.decelerationFraction));
        const sf = Math.max(0.2, Math.min(1, accel * decel));
        distance.current = Math.min(rt.length, distance.current + M.walkSpeed * speed * sf * delta);
        const nu = clamp01(distance.current / Math.max(rt.length, 0.001));
        const target = rt.curve.getPointAt(nu);
        const tan = rt.curve.getTangentAt(nu).normalize();
        r.position.lerp(target, Math.min(1, 11 * delta));
        // forward is -Z, so heading = atan2(-tx, -tz) (the old atan2(tx, tz) made everyone walk backwards)
        r.rotation.y = dampAngle(r.rotation.y, Math.atan2(-tan.x, -tan.z), 10, delta);

        const step = Math.sin(elapsed * C.walking.strideSpeed * (0.6 + 0.4 * sf) + workerIndex * 1.7);
        p.hl = step * C.walking.footSwing;
        p.hr = -step * C.walking.footSwing;
        p.kl = -Math.max(0, -step) * 0.9;
        p.kr = -Math.max(0, step) * 0.9;
        p.ul = -step * C.walking.armSwing + 0.05;
        p.ur = step * C.walking.armSwing + 0.05;
        p.el = p.er = 0.3;
        p.bodyY = Math.abs(step) * C.walking.bobAmplitude;
        p.bodyX = -C.walking.lean * sf;

        if (nu >= 0.999) {
          route.current = null;
          mode.current = m === "WALK" ? "ARRIVE" : "SIT_DOWN";
          modeTime.current = 0;
        }
      }
    }

    if (m === "ARRIVE") {
      const u = clamp01(modeTime.current / M.arriveDuration);
      r.rotation.y = dampAngle(r.rotation.y, BREAK_SPOTS[plan.current?.spot ?? "window"].facing, 9, delta);
      if (u >= 1) { mode.current = "ACTIVITY"; modeTime.current = 0; }
    }

    if (m === "ACTIVITY") {
      const spot = BREAK_SPOTS[plan.current?.spot ?? "window"];
      const t = modeTime.current;
      r.rotation.y = dampAngle(r.rotation.y, spot.facing, 8, delta);
      if (spot.activity === "SIT") {
        applySit(p, 1, spot.lift);
        p.bodyX = 0.12; // lean back into the cushion
        p.ul = p.ur = 0.4; p.el = p.er = 0.9;
        p.headY = Math.sin(t * 0.7 + workerIndex) * 0.18;
        if (plan.current?.limit) { p.headX = 0.3; p.headY = 0; } // dozing
      } else if (spot.activity === "SNACK") {
        if (t < 1.0) { p.ur = 1.3; p.er = 0.2; }
        else if (t < 2.4) { p.bodyX = -0.12; p.ur = 0.9; p.er = 0.6; p.headX = 0.15; }
        else { p.ul = 1.9 + Math.sin(t * 3) * 0.05; p.el = 1.3; p.headX = -0.1; }
      } else {
        p.headY = Math.sin(t * 0.45 + workerIndex) * 0.3;
        p.ulz = -0.1; p.urz = 0.1;
        if (plan.current?.limit) { p.headX = 0.25; p.ul = p.ur = 0.9; p.el = p.er = 1.5; } // arms folded
      }
      if (plan.current?.limit !== true && t >= (plan.current?.duration ?? 7)) goHome();
    }

    if (m === "SIT_DOWN") {
      const pr = clamp01(modeTime.current / M.sitDownDuration);
      const s = 1 - easeInOut(clamp01(pr / 0.3));
      const sit = easeInOut(clamp01((pr - 0.3) / 0.3));
      const k = 1 - easeInOut(clamp01((pr - 0.55) / 0.45));
      tmp.lerpVectors(home, pulledSeat, k);
      r.position.lerpVectors(tmp, approach, s);
      c.position.lerpVectors(chairHome, pulledChair, k);
      c.rotation.y = seat.rotationY + C.desks.chairTurn * k;
      r.rotation.y = dampAngle(r.rotation.y, seat.rotationY, 9, delta);
      applySit(p, sit, C.rig.seatLift);
      if (pr >= 1) {
        mode.current = "WORKING";
        modeTime.current = 0;
        micro.current.next = elapsed + lerp(4, 10, random());
      }
    }

    // One place applies the pose to the rig.
    const rate = m === "WALK" || m === "WALK_BACK" ? 14 : m === "STAND_UP" || m === "SIT_DOWN" ? 16 : 9;
    b.position.y = damp(b.position.y, p.bodyY, rate, delta);
    b.position.x = damp(b.position.x, p.bodyPX, rate, delta);
    b.rotation.x = damp(b.rotation.x, p.bodyX, rate, delta);
    h.rotation.y = damp(h.rotation.y, p.headY, 7, delta);
    h.rotation.x = damp(h.rotation.x, p.headX, 7, delta);
    armL.current.rotation.x = damp(armL.current.rotation.x, p.ul, rate, delta);
    armR.current.rotation.x = damp(armR.current.rotation.x, p.ur, rate, delta);
    armL.current.rotation.z = damp(armL.current.rotation.z, p.ulz, rate, delta);
    armR.current.rotation.z = damp(armR.current.rotation.z, p.urz, rate, delta);
    elbowL.current.rotation.x = damp(elbowL.current.rotation.x, p.el, rate, delta);
    elbowR.current.rotation.x = damp(elbowR.current.rotation.x, p.er, rate, delta);
    legL.current.rotation.x = damp(legL.current.rotation.x, p.hl, rate, delta);
    legR.current.rotation.x = damp(legR.current.rotation.x, p.hr, rate, delta);
    kneeL.current.rotation.x = damp(kneeL.current.rotation.x, p.kl, rate, delta);
    kneeR.current.rotation.x = damp(kneeR.current.rotation.x, p.kr, rate, delta);

    const statusText = isLimitState(ext)
      ? (m === "ACTIVITY" ? "limit" : "walking")
      : globalResting ? "resting"
      : !running ? "idle"
      : m === "WORKING" ? "working"
      : m === "ACTIVITY" || m === "ARRIVE" ? "break"
      : "walking";
    if (label.current) {
      const text = label.current.querySelector(".state-text");
      const dot = label.current.querySelector(".state-dot") as HTMLElement | null;
      if (text) text.textContent = statusText;
      if (dot) dot.style.background = statusText === "working" ? person.color : statusText === "walking" ? "#78a5ff" : statusText === "limit" ? "#ff5d76" : "#ffbd61";
    }
    if (ring.current) ring.current.visible = selected;
  });

  const robot = person.id === "gpt";
  const skin = robot ? "#d9e7ed" : "#efc2a5";
  const legColor = "#303b47";
  const edge = hovered || selected ? "#ffffff" : undefined;

  return (
    <group>
      <OfficeChair refObj={chair} position={chairHome} rotationY={seat.rotationY} />
      <group ref={root} position={home} rotation={[0, seat.rotationY, 0]}>
        <mesh ref={hitbox} userData={{ workerId: person.id }} position={[0, 1.2, 0]} renderOrder={999}>
          <boxGeometry args={[1.3, 2.5, 1.0]} />
          <meshBasicMaterial transparent opacity={debug ? 0.15 : 0} depthWrite={false} wireframe />
        </mesh>

        <group ref={body}>
          {/* upper body, lifted over the long legs */}
          <group position={[0, C.rig.upperLift, 0]}>
            <RoundedBox args={[0.86, 0.74, 0.6]} radius={0.11} smoothness={3} position={[0, 1.04, 0]} castShadow>
              <meshStandardMaterial color={person.color} roughness={0.68} />
              <Edges color={edge ?? person.color} threshold={25} lineWidth={selected ? 1.8 : hovered ? 1.35 : 0.9} />
            </RoundedBox>
            <mesh position={[0, 1.36, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.22, 0.045, 8, 16, 0.9 * Math.PI]} /><meshStandardMaterial color={person.id === "dira" ? "#d5bff2" : "#e7edf1"} /></mesh>
            <Accessories id={person.id} />

            {/* head pivots at the neck */}
            <group ref={head} position={[0, 1.42, 0]}>
              <group position={[0, -1.42, 0]}>
                <RoundedBox args={[0.66, 0.7, 0.64]} radius={0.17} smoothness={4} position={[0, 1.76, 0]} castShadow>
                  <meshStandardMaterial color={skin} roughness={0.78} />
                  <Edges color={edge ?? "#eff5ff"} threshold={32} lineWidth={selected ? 1.8 : hovered ? 1.35 : 0.8} />
                </RoundedBox>
                <Hair id={person.id} />
                <Face robot={robot} />
                {(person.id === "rhea" || person.id === "dira" || person.id === "vox") && (
                  <Headset tone={person.id === "dira" ? "#c58aff" : person.id === "vox" ? "#ff8b94" : "#74a7ff"} />
                )}
              </group>
            </group>

            {[{ r: armL, e: elbowL, x: -0.49 }, { r: armR, e: elbowR, x: 0.49 }].map((a) => (
              <group key={a.x} ref={a.r} position={[a.x, 1.06, 0]}>
                <RoundedBox args={[0.19, 0.27, 0.19]} radius={0.07} smoothness={2} position={[0, -0.125, 0]} castShadow><meshStandardMaterial color={person.color} /></RoundedBox>
                <group ref={a.e} position={[0, -0.27, 0]}>
                  <RoundedBox args={[0.17, 0.27, 0.17]} radius={0.06} smoothness={2} position={[0, -0.125, 0]} castShadow><meshStandardMaterial color={person.color} /></RoundedBox>
                  <mesh position={[0, -0.3, 0]} castShadow><sphereGeometry args={[0.095, 10, 10]} /><meshStandardMaterial color={robot ? "#d9e7ed" : "#efc1a3"} /></mesh>
                </group>
              </group>
            ))}
          </group>

          {/* legs: thigh (0.38) + knee + shin (0.52) + shoe */}
          {[{ r: legL, k: kneeL, x: -0.21 }, { r: legR, k: kneeR, x: 0.21 }].map((l) => (
            <group key={l.x} ref={l.r} position={[l.x, 0.9, 0]}>
              <RoundedBox args={[0.21, 0.38, 0.21]} radius={0.06} smoothness={2} position={[0, -0.17, 0]} castShadow><meshStandardMaterial color={legColor} /></RoundedBox>
              <group ref={l.k} position={[0, -0.38, 0]}>
                <RoundedBox args={[0.19, 0.52, 0.19]} radius={0.06} smoothness={2} position={[0, -0.26, 0]} castShadow><meshStandardMaterial color={legColor} /></RoundedBox>
                <mesh position={[0, -0.45, -0.07]} castShadow><boxGeometry args={[0.22, 0.14, 0.36]} /><meshStandardMaterial color="#1e252b" /></mesh>
              </group>
            </group>
          ))}
        </group>

        <mesh ref={ring} position={[0, C.visual.selectedRingY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.92, 1.06, 40]} />
          <meshBasicMaterial color={person.color} transparent opacity={0.72} depthWrite={false} />
        </mesh>

        <Html center position={[0, C.visual.labelBaseHeight, 0]} distanceFactor={11} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div ref={label} className={`tag ${selected ? "sel" : ""} ${hovered ? "hovered" : ""}`} style={{ pointerEvents: "none" }}>
            <b>{person.name}</b>
            <small style={{ display: hovered || selected ? "block" : "none" }}>{person.role}</small>
            <em><i className="state-dot" style={{ background: person.color }} /><span className="state-text">working</span></em>
          </div>
        </Html>
      </group>
    </group>
  );
}

function OfficeChair({ refObj, position, rotationY }: { refObj: RefObject<THREE.Group>; position: THREE.Vector3; rotationY: number }) {
  const W = C.desks.chairWidth, D = C.desks.chairSeatDepth, top = C.desks.chairSeatTop, H = C.desks.chairBackHeight;
  return (
    <group ref={refObj} position={position} rotation={[0, rotationY, 0]}>
      <RoundedBox args={[W, 0.14, D]} radius={0.06} smoothness={2} position={[0, top - 0.07, 0]} castShadow><meshStandardMaterial color="#54657a" roughness={0.75} /></RoundedBox>
      {/* backrest is on +Z = behind the character */}
      <RoundedBox args={[W - 0.06, H, 0.14]} radius={0.06} smoothness={2} position={[0, top + 0.1 + H / 2, D / 2 - 0.08]} castShadow><meshStandardMaterial color="#5d6f85" roughness={0.78} /></RoundedBox>
      <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.06, 0.06, 0.4, 8]} /><meshStandardMaterial color="#252b31" /></mesh>
      <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.8, 0.05, 0.1]} /><meshStandardMaterial color="#252b31" /></mesh>
      <mesh position={[0, 0.03, 0]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[0.8, 0.05, 0.1]} /><meshStandardMaterial color="#252b31" /></mesh>
    </group>
  );
}

function Hair({ id }: { id: string }) {
  const color = id === "wri" ? "#8c5830" : id === "dira" ? "#5a4a78" : id === "gemi" ? "#f1c6e6" : "#28313b";
  return <RoundedBox args={[0.68, 0.19, 0.63]} radius={0.09} smoothness={2} position={[0, 2.06, 0]} castShadow><meshStandardMaterial color={color} roughness={0.82} /></RoundedBox>;
}

function Face({ robot }: { robot: boolean }) {
  return robot ? (
    <mesh position={[0, 1.74, -0.335]}><boxGeometry args={[0.3, 0.085, 0.03]} /><meshBasicMaterial color="#55e0ff" /></mesh>
  ) : (
    <>
      <mesh position={[-0.13, 1.77, -0.315]}><sphereGeometry args={[0.036, 10, 10]} /><meshBasicMaterial color="#111" /></mesh>
      <mesh position={[0.13, 1.77, -0.315]}><sphereGeometry args={[0.036, 10, 10]} /><meshBasicMaterial color="#111" /></mesh>
      <mesh position={[0, 1.66, -0.315]}><boxGeometry args={[0.11, 0.024, 0.02]} /><meshBasicMaterial color="#7a4b46" /></mesh>
    </>
  );
}

// Decorative extras that live on the torso. (Gemi's floating tablet was removed: it hovered over the desk edge.)
function Accessories({ id }: { id: string }) {
  if (id === "gpt") return <mesh position={[0, 1.06, -0.31]}><boxGeometry args={[0.24, 0.14, 0.04]} /><meshStandardMaterial color="#65dfff" emissive="#65dfff" emissiveIntensity={0.5} /></mesh>;
  return null;
}

function Headset({ tone }: { tone: string }) {
  return (
    <group position={[0, 1.98, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.37, 0.032, 8, 24, Math.PI]} /><meshStandardMaterial color={tone} /></mesh>
      <mesh position={[-0.31, -0.02, -0.02]}><cylinderGeometry args={[0.08, 0.08, 0.12, 12]} /><meshStandardMaterial color={tone} /></mesh>
      <mesh position={[0.31, -0.02, -0.02]}><cylinderGeometry args={[0.08, 0.08, 0.12, 12]} /><meshStandardMaterial color={tone} /></mesh>
    </group>
  );
}
