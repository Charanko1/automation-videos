"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Edges,
  Html,
  OrbitControls,
  PerspectiveCamera,
  RoundedBox,
} from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import {
  OFFICE_CONFIG,
  BreakSpotId,
  getSeatTransform,
  WORKER_DESK_IDS,
} from "../lib/officeConfig";

type Person = {
  id: string;
  name: string;
  role: string;
  provider: string;
  dept: string;
  color: string;
  state: string;
};

type Mode =
  | "WORKING"
  | "ANTICIPATE"
  | "STAND_UP"
  | "WALK"
  | "ARRIVE"
  | "ACTIVITY"
  | "WALK_BACK"
  | "SIT_DOWN";

type MicroAction = "NONE" | "STRETCH" | "SCRATCH" | "DRINK" | "LEAN" | "SHIFT" | "LOOK";
type BreakActivity = "SOFA" | "SNACK" | "WINDOW";

const DESKS = OFFICE_CONFIG.desks.positions;

const BREAK_SPOTS: Record<BreakSpotId, {
  pos: [number, number, number];
  facing: number;
  activity: BreakActivity;
}> = {
  sofaLeft: { pos: OFFICE_CONFIG.lounge.sofa.left, facing: Math.PI, activity: "SOFA" },
  sofaRight: { pos: OFFICE_CONFIG.lounge.sofa.right, facing: Math.PI, activity: "SOFA" },
  snacks: { pos: OFFICE_CONFIG.lounge.snacks, facing: -Math.PI / 2, activity: "SNACK" },
  window: { pos: OFFICE_CONFIG.lounge.window, facing: Math.PI, activity: "WINDOW" },
};

const BREAK_ORDER: BreakSpotId[] = ["sofaLeft", "sofaRight", "snacks", "window"];
const BREAK_PAIRS: Array<[number, number]> = [[0, 5], [1, 4], [2, 3]];

// One shared reservation map makes the lounge behave like a small physical space.
// It enforces the global max-break capacity and prevents two agents from selecting
// the same sofa/snack/window slot.
const breakReservations = new Map<BreakSpotId, string>();

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

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function damp(current: number, target: number, smoothing: number, delta: number) {
  return THREE.MathUtils.damp(current, target, smoothing, delta);
}

function easeInOut(t: number) {
  return OFFICE_CONFIG.easing.easeInOut(t);
}

function isIdleState(state: string) {
  return state.toLowerCase() === "idle";
}

function isLimitState(state: string) {
  return state.toLowerCase() === "limit";
}

function chooseBreakSpot(workerIndex: number, wave: number) {
  return BREAK_ORDER[(workerIndex + wave) % BREAK_ORDER.length];
}

function reserveBreakSpot(workerId: string, preferred: BreakSpotId) {
  const current = breakReservations.get(preferred);
  if (!current && breakReservations.size < OFFICE_CONFIG.movement.maxSimultaneousBreaks) {
    breakReservations.set(preferred, workerId);
    return preferred;
  }
  for (const spot of BREAK_ORDER) {
    if (!breakReservations.has(spot) && breakReservations.size < OFFICE_CONFIG.movement.maxSimultaneousBreaks) {
      breakReservations.set(spot, workerId);
      return spot;
    }
  }
  return null;
}

function releaseBreakSpot(workerId: string) {
  for (const [spot, id] of breakReservations) {
    if (id === workerId) breakReservations.delete(spot);
  }
}

function getBreakPlan(workerIndex: number, elapsed: number, externalState: string, random: () => number) {
  if (isLimitState(externalState)) {
    const preferred = chooseBreakSpot(workerIndex, Math.floor(elapsed / 17));
    return { preferred, duration: Number.POSITIVE_INFINITY };
  }
  if (!isIdleState(externalState) || elapsed < OFFICE_CONFIG.movement.firstBreakDelay) return null;
  const wave = Math.floor((elapsed - OFFICE_CONFIG.movement.firstBreakDelay) / OFFICE_CONFIG.movement.breakWaveInterval);
  const pair = BREAK_PAIRS[wave % BREAK_PAIRS.length];
  if (!pair.includes(workerIndex)) return null;

  const local = (elapsed - OFFICE_CONFIG.movement.firstBreakDelay) % OFFICE_CONFIG.movement.breakWaveInterval;
  const start = indexWithinPair(workerIndex, pair) * OFFICE_CONFIG.movement.breakStartSpacing;
  if (local < start || local > start + 15) return null;

  return {
    preferred: chooseBreakSpot(workerIndex, wave),
    duration: THREE.MathUtils.lerp(
      OFFICE_CONFIG.movement.breakDurationMin,
      OFFICE_CONFIG.movement.breakDurationMax,
      random(),
    ),
  };
}

function indexWithinPair(index: number, pair: [number, number]) {
  return pair[0] === index ? 0 : 1;
}

function buildWalkCurve(start: THREE.Vector3, spot: BreakSpotId) {
  const target = new THREE.Vector3(...BREAK_SPOTS[spot].pos);
  const side = OFFICE_CONFIG.navigation.loungeCorridorX;
  const corridorZ = OFFICE_CONFIG.navigation.mainCorridorZ;
  const rearZ = OFFICE_CONFIG.navigation.loungeRearZ;
  const anchors = [
    start.clone(),
    new THREE.Vector3(start.x, 0, corridorZ),
    new THREE.Vector3(side, 0, corridorZ),
    new THREE.Vector3(side, 0, rearZ),
    target,
  ];
  const curve = new THREE.CatmullRomCurve3(anchors, false, "centripetal", 0.38);
  return { curve, length: curve.getLength() };
}

function buildReturnCurve(start: THREE.Vector3, workerId: string) {
  const home = new THREE.Vector3(...getSeatTransform(DESKS[workerId]).approachPosition);
  const side = OFFICE_CONFIG.navigation.loungeCorridorX;
  const corridorZ = OFFICE_CONFIG.navigation.mainCorridorZ;
  const rearZ = OFFICE_CONFIG.navigation.loungeRearZ;
  const anchors = [
    start.clone(),
    new THREE.Vector3(side, 0, rearZ),
    new THREE.Vector3(side, 0, corridorZ),
    new THREE.Vector3(home.x, 0, corridorZ),
    home.clone(),
  ];
  const curve = new THREE.CatmullRomCurve3(anchors, false, "centripetal", 0.38);
  return { curve, length: curve.getLength() };
}

function calculateLabelLanes() {
  const lanes: number[] = [];
  for (let i = 0; i < WORKER_DESK_IDS.length + 1; i++) lanes.push(0);

  const ids = [...WORKER_DESK_IDS, "dira"];
  for (let i = 0; i < ids.length; i++) {
    const a = DESKS[ids[i]];
    let lane = 0;
    for (let j = 0; j < i; j++) {
      const b = DESKS[ids[j]];
      const close = Math.hypot(a[0] - b[0], a[2] - b[2]) < 3.4;
      if (close) lane = Math.max(lane, lanes[j] + 1);
    }
    lanes[i] = lane;
  }
  return Object.fromEntries(ids.map((id, i) => [id, lanes[i]])) as Record<string, number>;
}

function colliderList() {
  const result = OFFICE_CONFIG.navigation.staticObstacles.map((c) => ({
    id: c.id,
    minX: c.min[0],
    maxX: c.max[0],
    minZ: c.min[1],
    maxZ: c.max[1],
  }));

  for (const id of Object.keys(DESKS)) {
    const [x, , z] = DESKS[id];
    const isHead = id === "dira";
    const w = isHead ? OFFICE_CONFIG.workZone.desk.headWidth : OFFICE_CONFIG.workZone.desk.width;
    const d = isHead ? OFFICE_CONFIG.workZone.desk.headDepth : OFFICE_CONFIG.workZone.desk.depth;
    result.push({ id: `desk-${id}`, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    const seat = getSeatTransform(DESKS[id]);
    result.push({
      id: `chair-${id}`,
      minX: seat.chairPosition[0] - OFFICE_CONFIG.desks.chairWidth / 2 - OFFICE_CONFIG.navigation.obstaclePadding,
      maxX: seat.chairPosition[0] + OFFICE_CONFIG.desks.chairWidth / 2 + OFFICE_CONFIG.navigation.obstaclePadding,
      minZ: seat.chairPosition[2] - OFFICE_CONFIG.desks.chairSeatDepth / 2 - OFFICE_CONFIG.navigation.obstaclePadding,
      maxZ: seat.chairPosition[2] + OFFICE_CONFIG.desks.chairSeatDepth / 2 + OFFICE_CONFIG.navigation.obstaclePadding,
    });
  }
  return result;
}

export default function OfficeWorld({
  people,
  running,
  resting,
  selected,
  onSelect,
}: {
  people: Person[];
  running: boolean;
  resting: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d") setDebug((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quality = OFFICE_CONFIG.quality[OFFICE_CONFIG.quality.preset];
  const labelLanes = useMemo(() => calculateLabelLanes(), []);
  const hitboxes = useRef(new Map<string, THREE.Object3D>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const registerHitbox = useCallback((id: string, object: THREE.Object3D | null) => {
    if (object) hitboxes.current.set(id, object);
    else hitboxes.current.delete(id);
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
        gl.toneMappingExposure = 1.05;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.shadowMap.enabled = true;
        scene.fog = new THREE.Fog("#aeb5bd", 30, 60);
      }}
    >
      <PerspectiveCamera makeDefault position={[19.5, 15.8, 21.5]} fov={32} near={0.1} far={140} />
      <ambientLight intensity={0.16} />
      <hemisphereLight args={["#91a8c5", "#5d3d2b", 1.25]} />
      <directionalLight
        castShadow
        position={[6.5, 15, 11]}
        intensity={4.8}
        color="#ffd5a0"
        shadow-mapSize-width={quality.shadowMap}
        shadow-mapSize-height={quality.shadowMap}
        shadow-bias={-0.00045}
        shadow-normalBias={0.035}
      />
      <pointLight position={[-8, 6.5, 1]} intensity={8} distance={25} color="#7897c8" />
      <pointLight position={[8, 5.5, -6]} intensity={14} distance={22} color="#ffb56b" />

      <InteractionController hitboxes={hitboxes} onSelect={onSelect} onHover={setHoveredId} />
      <OfficeEnvironment resting={resting} />
      <ContactShadows
        position={[0, OFFICE_CONFIG.visual.floorOffset, 0]}
        opacity={0.30}
        scale={24}
        blur={2.2}
        far={8}
        resolution={quality.contactResolution}
        frames={quality.contactFrames}
      />

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
          labelLane={labelLanes[person.id] ?? 0}
          debug={debug}
        />
      ))}

      {debug && <ColliderDebug />}
      <Html fullscreen style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", right: 12, top: 12, padding: "6px 9px", borderRadius: 8, fontSize: 8, background: "#10141bd9", color: "#fff", opacity: 0.78 }}>
          {debug ? "COLLIDERS ON · press D to hide" : "press D · debug colliders"}
        </div>
      </Html>

      <OrbitControls
        target={[0, 0.9, -0.5]}
        minDistance={12}
        maxDistance={29}
        minPolarAngle={0.70}
        maxPolarAngle={1.40}
        enableDamping
        dampingFactor={0.08}
        enablePan
      />
    </Canvas>
  );
}

function InteractionController({
  hitboxes,
  onSelect,
  onHover,
}: {
  hitboxes: MutableRefObject<Map<string, THREE.Object3D>>;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverRaf = 0;
    let pendingMove: PointerEvent | null = null;
    let down: { x: number; y: number } | null = null;

    const pointerToRay = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const raycastWorker = (event: PointerEvent) => {
      pointerToRay(event);
      const targets = Array.from(hitboxes.current.values());
      if (!targets.length) return null;
      const hits = raycaster.intersectObjects(targets, false);
      return hits[0]?.object.userData.workerId as string | undefined ?? null;
    };

    const applyHover = () => {
      hoverRaf = 0;
      if (!pendingMove) return;
      const id = raycastWorker(pendingMove);
      onHover(id);
      canvas.style.cursor = id ? "pointer" : "grab";
      pendingMove = null;
    };

    const onMove = (event: PointerEvent) => {
      pendingMove = event;
      if (!hoverRaf) hoverRaf = requestAnimationFrame(applyHover);
    };

    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
      canvas.style.cursor = "grabbing";
    };

    const onUp = (event: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved <= 5) onSelect(raycastWorker(event));
      const id = raycastWorker(event);
      canvas.style.cursor = id ? "pointer" : "grab";
    };

    const onLeave = () => {
      pendingMove = null;
      onHover(null);
      canvas.style.cursor = "grab";
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect(null);
    };

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

function OfficeEnvironment({ resting }: { resting: boolean }) {
  const floorMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (floorMat.current) {
      floorMat.current.roughness = 0.94 + Math.sin(state.clock.elapsedTime * 0.35) * 0.012;
    }
  });

  return (
    <group>
      <mesh position={[0, -0.34, 0]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width, 0.52, OFFICE_CONFIG.room.depth]} />
        <meshStandardMaterial color="#4a3328" roughness={0.88} />
      </mesh>
      <mesh ref={floorMat} position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width - 0.28, 0.10, OFFICE_CONFIG.room.depth - 0.28]} />
        <meshStandardMaterial color="#9a7253" roughness={0.91} />
      </mesh>

      <FloorPlanks />
      <Walls />
      <Windows />
      <CeilingLights resting={resting} />
      <WorkFurniture />
      <Lounge />
      <WallBoard />
      <Door />
      <ArchitectureDetails />
      <OfficeBranding />
      <WallArt />
      <BookcaseRow />
      <FloorRugs />
      <WarmTableLamps />
    </group>
  );
}

function FloorPlanks() {
  const rows = 18;
  return (
    <group>
      {Array.from({ length: rows }).map((_, row) => (
        <mesh key={row} position={[0, -0.003, -9.55 + row * 1.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[27.35, 0.018]} />
          <meshBasicMaterial color={row % 2 ? "#a88360" : "#966f4d"} transparent opacity={0.34} />
        </mesh>
      ))}
      {Array.from({ length: 27 }).map((_, i) => (
        <mesh key={"v" + i} position={[-13.1 + i * 1.01, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.014, 20.2]} />
          <meshBasicMaterial color="#9b7553" transparent opacity={0.25} />
        </mesh>
      ))}
      <mesh position={[...OFFICE_CONFIG.lounge.center]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={OFFICE_CONFIG.lounge.size} />
        <meshStandardMaterial color="#716184" roughness={0.96} />
      </mesh>
    </group>
  );
}

function Walls() {
  return (
    <group>
      <mesh position={[0, OFFICE_CONFIG.room.wallHeight / 2, OFFICE_CONFIG.room.backWallZ]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width, OFFICE_CONFIG.room.wallHeight, 0.28]} />
        <meshStandardMaterial color="#2a2c33" roughness={0.94} />
      </mesh>
      <mesh position={[OFFICE_CONFIG.room.leftWallX, OFFICE_CONFIG.room.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.28, OFFICE_CONFIG.room.wallHeight, OFFICE_CONFIG.room.depth]} />
        <meshStandardMaterial color="#20232a" roughness={0.94} />
      </mesh>
      <mesh position={[OFFICE_CONFIG.room.rightWallX, OFFICE_CONFIG.room.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.28, OFFICE_CONFIG.room.wallHeight, OFFICE_CONFIG.room.depth]} />
        <meshStandardMaterial color="#d2c8b7" roughness={0.99} />
      </mesh>
      <mesh position={[0, 0.22, OFFICE_CONFIG.room.backWallZ + 0.18]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width, 0.22, 0.12]} />
        <meshStandardMaterial color="#17191f" roughness={0.78} />
      </mesh>
    </group>
  );
}

function Windows() {
  return (
    <group>
      {[-10.2, -4.4, 1.4, 7.2].map((x) => (
        <group key={x} position={[x, 5.05, -10.30]}>
          <RoundedBox args={[4.7, 2.35, 0.10]} radius={0.07} smoothness={2} castShadow>
            <meshStandardMaterial color="#26323e" roughness={0.42} metalness={0.12} />
          </RoundedBox>
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[4.42, 2.08, 0.018]} />
            <meshStandardMaterial color="#182634" roughness={0.20} emissive="#355f86" emissiveIntensity={0.18} />
          </mesh>
          <mesh position={[0, 0, 0.085]}>
            <boxGeometry args={[0.065, 2.18, 0.018]} />
            <meshStandardMaterial color="#806d56" />
          </mesh>
          <mesh position={[0, 0, 0.085]}>
            <boxGeometry args={[4.46, 0.065, 0.018]} />
            <meshStandardMaterial color="#806d56" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CeilingLights({ resting }: { resting: boolean }) {
  const colors = ["#bedcff", "#fff0c8", "#d7c8ff", "#baf2d8"];
  return (
    <group>
      {[-8.8, -3.0, 2.8, 8.6].map((x, i) => (
        <group key={x} position={[x, 6.15, -0.6]}>
          <mesh castShadow>
            <RoundedBox args={[1.7, 0.08, 0.76]} radius={0.03} smoothness={2}>
              <meshStandardMaterial
                color="#f4eee2"
                emissive={colors[i]}
                emissiveIntensity={resting ? 0.07 : 0.32}
              />
            </RoundedBox>
          </mesh>
          <pointLight intensity={resting ? 2.0 : 6.0} distance={7} color={colors[i]} />
        </group>
      ))}
    </group>
  );
}

function ArchitectureDetails() {
  return <group>
    {[-11,-5.5,0,5.5,11].map(x=><mesh key={"beam"+x} position={[x,7.38,0]} castShadow><boxGeometry args={[0.18,0.24,22.4]}/><meshStandardMaterial color="#171a20" roughness={0.72}/></mesh>)}
    {[-11,-5.5,0,5.5,11].map(z=><mesh key={"cross"+z} position={[0,7.38,z]} castShadow><boxGeometry args={[29.6,0.24,0.18]}/><meshStandardMaterial color="#171a20" roughness={0.72}/></mesh>)}
    <mesh position={[0,0.30,OFFICE_CONFIG.room.backWallZ+0.18]} castShadow><boxGeometry args={[29.5,0.36,0.18]}/><meshStandardMaterial color="#25212a" roughness={0.7}/></mesh>
    <mesh position={[OFFICE_CONFIG.room.leftWallX+0.18,0.30,0]} castShadow><boxGeometry args={[0.18,0.36,22.5]}/><meshStandardMaterial color="#25212a" roughness={0.7}/></mesh>
    <mesh position={[OFFICE_CONFIG.room.rightWallX-0.18,0.30,0]} castShadow><boxGeometry args={[0.18,0.36,22.5]}/><meshStandardMaterial color="#25212a" roughness={0.7}/></mesh>
    <mesh position={[-0.6,2.1,-7.0]}><boxGeometry args={[0.06,4.2,8.8]}/><meshStandardMaterial color="#7b8a98" transparent opacity={0.10} roughness={0.12} metalness={0.25}/></mesh>
  </group>;
}

function OfficeBranding() {
  return <group position={[10.6,4.45,-11.28]}>
    <RoundedBox args={[5.2,2.25,0.10]} radius={0.08} smoothness={3} castShadow><meshStandardMaterial color="#121820" roughness={0.36} metalness={0.12}/></RoundedBox>
    <Html center position={[0,0,0.08]} distanceFactor={12}><div className="officeBrand"><div className="officeBrandIcon">◈</div><div className="officeBrandTitle">AI AGENT OFFICE</div><div className="officeBrandSub">YOUTUBE FACTORY · AUTONOMOUS STUDIO</div></div></Html>
    <pointLight position={[0,0,0.4]} intensity={3.5} distance={7} color="#6e83ff"/>
  </group>;
}

function WallArt() {
  const frames=[{x:-10.0,y:4.15,w:2.15,h:2.65,c:"#315a78",title:"BUILD\nREPEAT"},{x:-7.55,y:4.15,w:2.15,h:2.65,c:"#6a4d78",title:"CREATE\nSHIP"},{x:7.35,y:4.0,w:2.15,h:2.55,c:"#5d4233",title:"PLAN\nEXECUTE"},{x:9.75,y:4.0,w:2.15,h:2.55,c:"#425e51",title:"IDEA\nEDIT"}];
  return <group>{frames.map((f,i)=><group key={i} position={[f.x,f.y,-11.30]}><mesh castShadow><boxGeometry args={[f.w,f.h,0.08]}/><meshStandardMaterial color="#171a20" roughness={0.42}/></mesh><mesh position={[0,0,0.06]}><boxGeometry args={[f.w-0.18,f.h-0.18,0.018]}/><meshStandardMaterial color={f.c} emissive={f.c} emissiveIntensity={0.10}/></mesh><Html center position={[0,0,0.08]} distanceFactor={15}><div className="wallArtText">{f.title.split("\n").map((x,j)=><div key={j}>{x}</div>)}</div></Html></group>)}</group>;
}

function BookcaseRow() {
  const xs=[-10.5,-8.2,-5.9,8.0];
  return <group>{xs.map((x,i)=><group key={x} position={[x,1.7,-10.88]}><mesh castShadow><boxGeometry args={[1.9,3.25,0.56]}/><meshStandardMaterial color="#2d211b" roughness={0.88}/></mesh>{[0.88,0.02,-0.84].map((y,j)=><mesh key={j} position={[0,y,0.31]}><boxGeometry args={[1.72,0.08,0.08]}/><meshStandardMaterial color="#624532" roughness={0.9}/></mesh>)}{[-0.62,-0.20,0.20,0.62].map((x2,j)=><mesh key={j} position={[x2,0.42+(j%2)*0.05,0.37]} rotation={[0,(j%2)*0.08,0]}><boxGeometry args={[0.20,0.62,0.13]}/><meshStandardMaterial color={["#b45b55","#d2a34f","#4c7894","#6e9270"][j]}/></mesh>)}{i%2===0&&<Plant position={[0,1.72,0.36]} scale={0.65}/>}</group>)}</group>;
}

function FloorRugs() {
  return <group>
    <mesh position={[0,0.008,1.0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[12.8,7.1]}/><meshStandardMaterial color="#3d3946" roughness={0.98}/></mesh>
    <mesh position={[0,0.012,1.0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[12.2,6.5]}/><meshStandardMaterial color="#514753" roughness={0.99}/></mesh>
    <mesh position={[6.1,0.015,-8.05]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[10.2,5.4]}/><meshStandardMaterial color="#302a38" roughness={0.99}/></mesh>
    <mesh position={[6.1,0.018,-8.05]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[9.7,4.9]}/><meshStandardMaterial color="#514154" roughness={1}/></mesh>
  </group>;
}

function WarmTableLamps() {
  const spots=[[-4.1,1.65,1.35],[0,1.65,1.35],[4.1,1.65,1.35],[-2,1.65,-1.05],[2,1.65,-1.05],[0,1.75,6.0]];
  return <group>{spots.map((p,i)=><group key={i} position={p as [number,number,number]}><mesh position={[0,0.12,0]} castShadow><cylinderGeometry args={[0.06,0.09,0.24,10]}/><meshStandardMaterial color="#3b2d26"/></mesh><mesh position={[0,0.30,0]}><sphereGeometry args={[0.14,12,8]}/><meshStandardMaterial color="#ffe6aa" emissive="#ffb85c" emissiveIntensity={0.55}/></mesh><pointLight position={[0,0.35,0]} intensity={1.3} distance={3.2} color="#ffb86a"/></group>)}</group>;
}

function WorkFurniture() {
  return (
    <group>
      {WORKER_DESK_IDS.map((id) => <Desk key={id} id={id} position={DESKS[id]} />)}
      <Desk id="dira" position={DESKS.dira} />
      <Shelf position={OFFICE_CONFIG.decor.shelf} />
      <Printer position={OFFICE_CONFIG.decor.printer} />
      <ServerRack position={OFFICE_CONFIG.decor.server} />
    </group>
  );
}

function Desk({ id, position }: { id: string; position: [number, number, number] }) {
  const head = id === "dira";
  const w = head ? OFFICE_CONFIG.workZone.desk.headWidth : OFFICE_CONFIG.workZone.desk.width;
  const d = head ? OFFICE_CONFIG.workZone.desk.headDepth : OFFICE_CONFIG.workZone.desk.depth;
  return (
    <group position={position} rotation={[0, OFFICE_CONFIG.desks.rotationY, 0]}>
      <mesh position={[0, OFFICE_CONFIG.workZone.desk.topY, 0]} castShadow receiveShadow>
        <RoundedBox args={[w, 0.22, d]} radius={0.08} smoothness={2}>
          <meshStandardMaterial color={head ? "#4c3a58" : "#3b2921"} roughness={0.66} metalness={0.03} />
          <Edges color={head ? "#cab3ff" : "#b69373"} threshold={30} lineWidth={1} />
        </RoundedBox>
      </mesh>
      {[[-0.86, 0.66, -0.37], [0.86, 0.66, -0.37], [-0.86, 0.66, 0.37], [0.86, 0.66, 0.37]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.13, 1.54, 0.13]} />
          <meshStandardMaterial color="#211714" roughness={0.86} />
        </mesh>
      ))}
      <Monitor head={head} />
      <Keyboard />
      <Mug />
      <PaperStack />
      <DeskLamp head={head} />
    </group>
  );
}

function Monitor({ head }: { head: boolean }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const cursor = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (screen.current) screen.current.emissiveIntensity = 0.43 + Math.sin(state.clock.elapsedTime * OFFICE_CONFIG.visual.monitorPulseSpeed) * 0.06;
    if (cursor.current) cursor.current.position.x = -0.36 + ((state.clock.elapsedTime * OFFICE_CONFIG.visual.cursorSpeed) % 0.66);
  });
  return (
    <group position={[0, 2.03, -0.24]}>
      <RoundedBox args={[head ? 1.26 : 1.10, 0.70, 0.10]} radius={0.04} smoothness={2} castShadow>
        <meshStandardMaterial color="#0c1117" roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, -0.02, 0.058]}>
        <boxGeometry args={[head ? 1.00 : 0.88, 0.48, 0.02]} />
        <meshStandardMaterial ref={screen} color="#17333e" emissive="#49c4ed" roughness={0.24} />
      </mesh>
      {[-0.31, 0, 0.25].map((x, i) => (
        <mesh key={i} position={[x, 0.12, 0.08]}>
          <boxGeometry args={[i === 0 ? 0.16 : 0.13, 0.035, 0.008]} />
          <meshBasicMaterial color={i === 2 ? "#f4d26e" : "#58b9e2"} />
        </mesh>
      ))}
      <mesh ref={cursor} position={[-0.36, -0.14, 0.09]}>
        <boxGeometry args={[0.02, 0.06, 0.009]} />
        <meshBasicMaterial color="#f7f4dc" />
      </mesh>
      <mesh position={[0, -0.58, 0]}>
        <boxGeometry args={[0.11, 0.55, 0.11]} />
        <meshStandardMaterial color="#47535e" />
      </mesh>
      <mesh position={[0, -0.85, 0]}>
        <boxGeometry args={[0.68, 0.07, 0.30]} />
        <meshStandardMaterial color="#303941" />
      </mesh>
    </group>
  );
}

function Keyboard() {
  return <mesh position={[0, 1.60, 0.18]}><boxGeometry args={[0.84, 0.04, 0.28]} /><meshStandardMaterial color="#222830" roughness={0.52} /></mesh>;
}

function Mug() {
  return <mesh position={[-0.78, 1.66, 0.20]} castShadow><cylinderGeometry args={[0.11, 0.12, 0.18, 12]} /><meshStandardMaterial color="#ede5d9" roughness={0.82}/></mesh>;
}

function PaperStack() {
  return <group>{[0, 0.028, 0.056].map((y) => <mesh key={y} position={[0.66, 1.61 + y, 0.23]}><boxGeometry args={[0.43, 0.024, 0.33]} /><meshStandardMaterial color="#f3efe9" roughness={0.96}/></mesh>)}</group>;
}

function DeskLamp({ head }: { head: boolean }) {
  return <group position={[0.90, 1.59, -0.20]}>
    <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.035, 0.035, 0.50, 8]} /><meshStandardMaterial color="#3b444d" roughness={0.7}/></mesh>
    <mesh position={[0, 0.53, 0]}><coneGeometry args={[head ? 0.23 : 0.19, 0.22, 12]} /><meshStandardMaterial color="#e6b75b" emissive="#6d4b18" emissiveIntensity={0.18}/></mesh>
  </group>;
}

function Lounge() {
  return (
    <group>
      <Sofa />
      <VendingMachine position={OFFICE_CONFIG.lounge.snacks} />
      <Beanbag position={OFFICE_CONFIG.lounge.beanbagA} />
      <Beanbag position={OFFICE_CONFIG.lounge.beanbagB} />
      <CoffeeTable position={OFFICE_CONFIG.lounge.coffeeTable} />
      {OFFICE_CONFIG.decor.plants.map((p, i) => <Plant key={i} position={p} />)}
    </group>
  );
}

function Sofa() {
  return <group position={[5.55, 0, -8.53]}>
    <RoundedBox args={[4.20, 0.68, 1.02]} radius={0.18} smoothness={3} position={[0, 0.50, 0]} castShadow>
      <meshStandardMaterial color="#6d5977" roughness={0.91} />
      <Edges color="#a28cab" threshold={28} lineWidth={0.8} />
    </RoundedBox>
    <RoundedBox args={[0.36, 1.55, 1.02]} radius={0.12} smoothness={3} position={[-1.92, 1.02, 0]} castShadow><meshStandardMaterial color="#6d5977" /></RoundedBox>
    <RoundedBox args={[0.36, 1.55, 1.02]} radius={0.12} smoothness={3} position={[1.92, 1.02, 0]} castShadow><meshStandardMaterial color="#6d5977" /></RoundedBox>
    <RoundedBox args={[3.15, 0.68, 0.18]} radius={0.08} smoothness={2} position={[0, 1.04, -0.40]}><meshStandardMaterial color="#765f7e" /></RoundedBox>
  </group>;
}

function VendingMachine({ position }: { position: [number, number, number] }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => { if (mat.current) mat.current.emissiveIntensity = 0.25 + Math.sin(state.clock.elapsedTime * 3) * 0.07; });
  return <group position={position}>
    <RoundedBox args={[1.02, 2.50, 0.78]} radius={0.08} smoothness={2} castShadow><meshStandardMaterial color="#2e3740" roughness={0.40}/></RoundedBox>
    <mesh position={[0, 0.28, 0.40]}><boxGeometry args={[0.76, 1.00, 0.03]} /><meshStandardMaterial ref={mat} color="#152a33" emissive="#2d6d82" roughness={0.22}/></mesh>
    {[-0.24, 0, 0.24].map((x, i) => <mesh key={i} position={[x, -0.65, 0.41]}><boxGeometry args={[0.14, 0.18, 0.04]}/><meshStandardMaterial color={["#ed7f84","#efc867","#6bc991"][i]}/></mesh>)}
    <Html center position={[0, 1.55, 0.16]} distanceFactor={14}><div className="prop-label">SNACKS</div></Html>
  </group>;
}

function Beanbag({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh scale={[1.0, 0.72, 1.0]} castShadow><sphereGeometry args={[0.74, 16, 10]}/><meshStandardMaterial color="#68749b" roughness={0.95}/></mesh></group>;
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh position={[0, 0.34, 0]} castShadow><cylinderGeometry args={[0.72,0.70,0.10,12]} /><meshStandardMaterial color="#684b37" roughness={0.82}/></mesh><mesh position={[0,0.12,0]}><cylinderGeometry args={[0.10,0.14,0.43,10]} /><meshStandardMaterial color="#4c3325"/></mesh></group>;
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return <group position={position} scale={scale}><mesh castShadow><cylinderGeometry args={[0.34,0.42,0.48,10]} /><meshStandardMaterial color="#a66f47" roughness={0.96}/></mesh>{[-0.18,0,0.18].map((x,i)=><mesh key={i} position={[x,0.72,0.02]} rotation={[0,0,(i-1)*0.25]} castShadow><sphereGeometry args={[0.23,0.23,0.52,12]} /><meshStandardMaterial color={["#63b579","#4aa66b","#7ac78a"][i]}/></mesh>)}</group>;
}

function Shelf({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh castShadow><boxGeometry args={[1.40,3.10,0.56]}/><meshStandardMaterial color="#513c2d" roughness={0.86}/></mesh>{[0.82,0.05,-0.72].map(y=><mesh key={y} position={[0,y,0.31]}><boxGeometry args={[1.28,0.10,0.08]}/><meshStandardMaterial color="#75533a"/></mesh>)}{[-0.36,0.02,0.36].map((x,i)=><mesh key={i} position={[x,0.42,0.35]}><boxGeometry args={[0.18,0.36,0.10]}/><meshStandardMaterial color={["#eab45b","#70b8df","#d67faa"][i]}/></mesh>)}</group>;
}

function Printer({ position }: { position: [number, number, number] }) {
  return <group position={position}><RoundedBox args={[1.05,0.82,0.80]} radius={0.08} smoothness={2} castShadow><meshStandardMaterial color="#4b555e" roughness={0.55}/></RoundedBox><mesh position={[0,0.43,0.04]}><boxGeometry args={[0.74,0.05,0.45]}/><meshStandardMaterial color="#ebeff2"/></mesh></group>;
}

function ServerRack({ position }: { position: [number, number, number] }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state)=>{if(mat.current)mat.current.emissiveIntensity=.10+Math.sin(state.clock.elapsedTime*5)*.06});
  return <group position={position}><RoundedBox args={[1.15,2.15,0.76]} radius={0.06} smoothness={2} castShadow><meshStandardMaterial color="#232b33" roughness={0.55}/></RoundedBox>{[-0.50,0,0.50].map(y=><mesh key={y} position={[0,y,0.40]}><boxGeometry args={[0.75,0.25,0.02]}/><meshStandardMaterial ref={y===0?mat:undefined} color="#1e3038" emissive="#58d7ff"/></mesh>)}</group>;
}

function WallBoard() {
  return <group position={OFFICE_CONFIG.decor.board}>
    <RoundedBox args={[5.1,2.25,0.12]} radius={0.05} smoothness={2} castShadow><meshStandardMaterial color="#232a32" roughness={0.48}/></RoundedBox>
    <Html center position={[0,0,0.08]} distanceFactor={12}>
      <div className="worldBoard">
        <div className="wbHead">TODAY'S PIPELINE</div>
        <div className="wbRow"><span>Research</span><b>✓</b></div>
        <div className="wbRow"><span>Script</span><b>✓</b></div>
        <div className="wbRow"><span>Scenes</span><b>12/30</b></div>
        <div className="wbState">PRODUCTION ACTIVE</div>
      </div>
    </Html>
  </group>;
}

function Door() {
  const [x, y, z] = OFFICE_CONFIG.navigation.doorPosition;
  return <group position={[x, 1.5, z]} rotation={[0, -Math.PI / 2, 0]}><mesh castShadow><boxGeometry args={[2.1,3.0,0.16]}/><meshStandardMaterial color="#6b4f3b" roughness={0.78}/></mesh><mesh position={[0,0,0.11]}><boxGeometry args={[1.72,2.55,0.02]}/><meshStandardMaterial color="#a87953"/></mesh><mesh position={[0.60,-0.18,0.17]}><sphereGeometry args={[0.06,10,10]}/><meshStandardMaterial color="#e8c16c"/></mesh></group>;
}

function ColliderDebug() {
  const colliders = useMemo(() => colliderList(), []);
  return <group>
    {colliders.map((c) => {
      const w = c.maxX-c.minX;
      const d = c.maxZ-c.minZ;
      return <mesh key={c.id} position={[(c.minX+c.maxX)/2,0.035,(c.minZ+c.maxZ)/2]} rotation={[-Math.PI/2,0,0]}>
        <planeGeometry args={[w,d]}/>
        <meshBasicMaterial color="#ff405d" transparent opacity={0.18} depthWrite={false} wireframe/>
      </mesh>;
    })}
  </group>;
}

function WorkerCharacter({
  person,
  workerIndex,
  selected,
  running,
  globalResting,
  labelLane,
  debug,
  hovered,
  registerHitbox,
}: {
  person: Person;
  workerIndex: number;
  selected: boolean;
  running: boolean;
  globalResting: boolean;
  labelLane: number;
  debug: boolean;
  hovered: boolean;
  registerHitbox: (id: string, object: THREE.Object3D | null) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const chair = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const ring = useRef<THREE.Mesh>(null);
  const hitbox = useRef<THREE.Mesh>(null);

  useEffect(() => {
    registerHitbox(person.id, hitbox.current);
    return () => registerHitbox(person.id, null);
  }, [person.id, registerHitbox]);

  const random = useMemo(() => seededRandom((workerIndex + 13) * 9176), [workerIndex]);
  const speed = useMemo(
    () => 1 - OFFICE_CONFIG.movement.speedVariance + random() * OFFICE_CONFIG.movement.speedVariance * 2,
    [random],
  );
  const mode = useRef<Mode>("WORKING");
  const modeTime = useRef(0);
  const micro = useRef<{type: MicroAction; started: number; duration: number; next: number}>({
    type: "NONE",
    started: 0,
    duration: 0,
    next: 3 + random() * 5,
  });
  const plan = useRef<{spot: BreakSpotId; duration: number; limit: boolean} | null>(null);
  const route = useRef<{curve: THREE.CatmullRomCurve3; length: number} | null>(null);
  const distance = useRef(0);

  const seat = useMemo(() => getSeatTransform(DESKS[person.id]), [person.id]);
  const home = useMemo(() => new THREE.Vector3(...seat.seatPosition), [seat]);
  const chairHome = useMemo(() => new THREE.Vector3(...seat.chairPosition), [seat]);
  const pulledChair = useMemo(() => new THREE.Vector3(...seat.pulledChairPosition), [seat]);
  const approach = useMemo(() => new THREE.Vector3(...seat.approachPosition), [seat]);


  useFrame((state, delta) => {
    if (!root.current || !body.current || !head.current || !chair.current) return;
    const elapsed = state.clock.elapsedTime;
    const external = person.state;

    modeTime.current += delta;

    const shouldLimit = isLimitState(external);
    const breakPlan = getBreakPlan(workerIndex, elapsed, external, random);

    if (shouldLimit && mode.current === "WORKING" && !plan.current) {
      const reserved = reserveBreakSpot(person.id, breakPlan?.preferred ?? "window");
      if (reserved) {
        plan.current = { spot: reserved, duration: Number.POSITIVE_INFINITY, limit: true };
        route.current = buildWalkCurve(root.current.position.clone(), reserved);
        distance.current = 0;
        mode.current = "ANTICIPATE";
        modeTime.current = 0;
      }
    }

    if (!shouldLimit && plan.current?.limit) {
      const spot = plan.current.spot;
      releaseBreakSpot(person.id);
      route.current = buildReturnCurve(root.current.position.clone(), person.id);
      distance.current = 0;
      mode.current = "WALK_BACK";
      modeTime.current = 0;
      plan.current = null;
    }

    if (
      running &&
      breakPlan &&
      person.id !== selected &&
      !shouldLimit &&
      mode.current === "WORKING" &&
      !plan.current
    ) {
      const reserved = reserveBreakSpot(person.id, breakPlan.preferred);
      if (reserved) {
        plan.current = { spot: reserved, duration: breakPlan.duration, limit: false };
        route.current = buildWalkCurve(root.current.position.clone(), reserved);
        distance.current = 0;
        mode.current = "ANTICIPATE";
        modeTime.current = 0;
      }
    }

    const m = mode.current;

    if (m === "WORKING") {
      animateWorking(
        body.current,
        head.current,
        armL.current,
        armR.current,
        legL.current,
        legR.current,
        elapsed,
        delta,
        workerIndex,
        micro.current,
        isIdleState(external),
        random,
      );
      root.current.position.x = damp(root.current.position.x, home.x, OFFICE_CONFIG.movement.positionDamping, delta);
      root.current.position.z = damp(root.current.position.z, home.z, OFFICE_CONFIG.movement.positionDamping, delta);
      root.current.rotation.y = damp(root.current.rotation.y, seat.rotationY, OFFICE_CONFIG.movement.turnDamping, delta);
      chair.current.position.x = damp(chair.current.position.x, chairHome.x, 10, delta);
      chair.current.position.z = damp(chair.current.position.z, chairHome.z, 10, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, seat.rotationY, 9, delta);
    }

    if (m === "ANTICIPATE") {
      const t = easeInOut(modeTime.current / OFFICE_CONFIG.movement.anticipateDuration);
      body.current.rotation.x = damp(body.current.rotation.x, 0.10 * Math.sin(t * Math.PI), 9, delta);
      head.current.rotation.y = damp(head.current.rotation.y, 0.18 * Math.sin(t * Math.PI), 8, delta);
      chair.current.position.x = damp(chair.current.position.x, chairHome.x, 9, delta);
      chair.current.position.z = damp(chair.current.position.z, pulledChair.z - 0.16, 10, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, seat.rotationY + OFFICE_CONFIG.desks.chairTurn, 8, delta);
      if (t >= 1) {
        mode.current = "STAND_UP";
        modeTime.current = 0;
      }
    }

    if (m === "STAND_UP") {
      const t = easeInOut(modeTime.current / OFFICE_CONFIG.movement.standUpDuration);
      const overshoot = Math.sin(Math.min(1, t) * Math.PI) * 0.07;
      root.current.position.lerpVectors(home, approach, easeInOut(t));
      body.current.position.y = damp(body.current.position.y, 0.16 * t + overshoot, 10, delta);
      body.current.rotation.x = damp(body.current.rotation.x, -0.06 * t, 8, delta);
      legL.current.rotation.x = damp(legL.current.rotation.x, 0.06 * (1-t), 9, delta);
      legR.current.rotation.x = damp(legR.current.rotation.x, 0.06 * (1-t), 9, delta);
      armL.current.rotation.z = damp(armL.current.rotation.z, 0.05, 8, delta);
      armR.current.rotation.z = damp(armR.current.rotation.z, -0.05, 8, delta);
      if (t >= 1) {
        mode.current = "WALK";
        modeTime.current = 0;
      }
    }

    if (m === "WALK" || m === "WALK_BACK") {
      const r = route.current;
      if (!r) {
        mode.current = m === "WALK" ? "ARRIVE" : "SIT_DOWN";
        modeTime.current = 0;
      } else {
        const u = clamp01(distance.current / Math.max(r.length, 0.001));
        const a = OFFICE_CONFIG.movement.accelerationFraction;
        const d = OFFICE_CONFIG.movement.decelerationFraction;
        const accel = OFFICE_CONFIG.easing.smoother(clamp01(u / a));
        const decel = OFFICE_CONFIG.easing.smoother(clamp01((1-u) / d));
        const speedFactor = Math.max(0.20, Math.min(1, accel * decel));
        distance.current = Math.min(
          r.length,
          distance.current + OFFICE_CONFIG.movement.walkSpeed * speed * speedFactor * delta,
        );

        const nu = clamp01(distance.current / Math.max(r.length, 0.001));
        const target = r.curve.getPointAt(nu);
        const tangent = r.curve.getTangentAt(nu).normalize();
        root.current.position.lerp(target, Math.min(1, 11 * delta));
        root.current.rotation.y = damp(root.current.rotation.y, Math.atan2(tangent.x, tangent.z), 10, delta);

        const step = Math.sin(elapsed * OFFICE_CONFIG.walking.strideSpeed + workerIndex * 1.7);
        legL.current.rotation.x = damp(legL.current.rotation.x, step * OFFICE_CONFIG.walking.footSwing, 15, delta);
        legR.current.rotation.x = damp(legR.current.rotation.x, -step * OFFICE_CONFIG.walking.footSwing, 15, delta);
        armL.current.rotation.x = damp(armL.current.rotation.x, -step * OFFICE_CONFIG.walking.armSwing, 15, delta);
        armR.current.rotation.x = damp(armR.current.rotation.x, step * OFFICE_CONFIG.walking.armSwing, 15, delta);
        body.current.position.y = damp(body.current.position.y, Math.abs(step) * OFFICE_CONFIG.walking.bobAmplitude, 12, delta);
        body.current.rotation.x = damp(body.current.rotation.x, OFFICE_CONFIG.walking.lean * tangent.x, 8, delta);

        if (nu >= 0.999) {
          route.current = null;
          mode.current = m === "WALK" ? "ARRIVE" : "SIT_DOWN";
          modeTime.current = 0;
        }
      }
    }

    if (m === "ARRIVE") {
      const t = easeInOut(modeTime.current / OFFICE_CONFIG.movement.arriveDuration);
      const spot = BREAK_SPOTS[plan.current?.spot ?? "window"];
      root.current.rotation.y = damp(root.current.rotation.y, spot.facing, 9, delta);
      body.current.position.y = damp(body.current.position.y, 0.03 * Math.sin(t * Math.PI), 8, delta);
      if (t >= 1) {
        mode.current = "ACTIVITY";
        modeTime.current = 0;
      }
    }

    if (m === "ACTIVITY") {
      const spot = BREAK_SPOTS[plan.current?.spot ?? "window"];
      const t = modeTime.current;
      root.current.rotation.y = damp(root.current.rotation.y, spot.facing, 8, delta);
      if (spot.activity === "SOFA") {
        body.current.position.y = damp(body.current.position.y, -0.14, 8, delta);
        body.current.rotation.x = damp(body.current.rotation.x, -0.08, 7, delta);
        head.current.rotation.y = damp(head.current.rotation.y, Math.sin(t * 0.7 + workerIndex) * 0.18, 5, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, 0.24 + Math.sin(t) * 0.04, 6, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, -0.24 + Math.sin(t * 0.9) * 0.04, 6, delta);
      } else if (spot.activity === "SNACK") {
        body.current.position.y = damp(body.current.position.y, 0, 8, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, t < 1.0 ? 0.62 : 0.18, 7, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, t > 1.0 && t < 2.4 ? -0.62 : -0.12, 7, delta);
        head.current.rotation.x = damp(head.current.rotation.x, t > 1.2 ? 0.10 : 0, 6, delta);
      } else {
        body.current.position.y = damp(body.current.position.y, 0, 7, delta);
        head.current.rotation.y = damp(head.current.rotation.y, Math.sin(t * 0.45 + workerIndex) * 0.25, 4, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, 0.14, 4, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, -0.14, 4, delta);
      }

      if (plan.current?.limit !== true && modeTime.current >= (plan.current?.duration ?? 7)) {
        releaseBreakSpot(person.id);
        route.current = buildReturnCurve(root.current.position.clone(), person.id);
        distance.current = 0;
        mode.current = "WALK_BACK";
        modeTime.current = 0;
      }
    }

    if (m === "SIT_DOWN") {
      const t = easeInOut(modeTime.current / OFFICE_CONFIG.movement.sitDownDuration);
      const tt = easeInOut(t);
      root.current.position.lerpVectors(approach, home, tt);
      body.current.position.y = damp(body.current.position.y, -0.12 + Math.sin(tt * Math.PI) * 0.035, 10, delta);
      body.current.rotation.x = damp(body.current.rotation.x, 0.06, 8, delta);
      legL.current.rotation.x = damp(legL.current.rotation.x, 0.55 * (1-tt), 9, delta);
      legR.current.rotation.x = damp(legR.current.rotation.x, 0.55 * (1-tt), 9, delta);
      armL.current.rotation.z = damp(armL.current.rotation.z, 0.16, 7, delta);
      armR.current.rotation.z = damp(armR.current.rotation.z, -0.16, 7, delta);
      chair.current.position.x = damp(chair.current.position.x, chairHome.x, 9, delta);
      chair.current.position.z = damp(chair.current.position.z, chairHome.z, 9, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, seat.rotationY, 8, delta);
      root.current.rotation.y = damp(root.current.rotation.y, seat.rotationY, 9, delta);
      if (t >= 1) {
        mode.current = "WORKING";
        modeTime.current = 0;
        micro.current.next = elapsed + THREE.MathUtils.lerp(4, 10, random());
        plan.current = plan.current?.limit ? plan.current : null;
      }
    }

    if (m === "WALK_BACK" && plan.current?.limit) {
      // Limit reset path lands at the approach point, then uses SIT_DOWN.
      // The transition above handles the actual seat pull-in.
    }

    const statusText = isLimitState(external)
      ? (m === "ACTIVITY" ? "limit" : "walking")
      : m === "WORKING"
        ? "working"
        : (m === "ACTIVITY" || m === "ARRIVE")
          ? "break"
          : "walking";

    if (label.current) {
      const text = label.current.querySelector(".state-text");
      const dot = label.current.querySelector(".state-dot") as HTMLElement | null;
      if (text) text.textContent = statusText;
      if (dot) {
        dot.style.background =
          statusText === "working" ? person.color :
          statusText === "walking" ? "#78a5ff" :
          statusText === "limit" ? "#ff5d76" : "#ffbd61";
      }
    }

    if (ring.current) ring.current.visible = selected;
  });

  return (
    <group>
      <OfficeChair refObj={chair} position={chairHome} rotationY={seat.rotationY} />
      <group ref={root} position={home} rotation={[0, seat.rotationY, 0]}>
        <mesh
          ref={hitbox}
          userData={{ workerId: person.id }}
          position={[0, 1.10, 0]}
          visible
          renderOrder={999}
        >
          <boxGeometry args={[1.12, 2.38, 0.88]} />
          <meshBasicMaterial transparent opacity={debug ? 0.15 : 0} depthWrite={false} wireframe />
        </mesh>
        <group ref={body}>
          <RoundedBox args={[0.86, 0.74, 0.60]} radius={0.11} smoothness={3} position={[0, 1.04, 0]} castShadow>
            <meshStandardMaterial color={person.color} roughness={0.68} />
            <Edges color={hovered || selected ? "#ffffff" : person.color} threshold={25} lineWidth={selected ? 1.8 : hovered ? 1.35 : 0.9} />
          </RoundedBox>
          <group ref={head} position={[0,0,0]}>
            <RoundedBox args={[0.66,0.70,0.64]} radius={0.17} smoothness={4} position={[0,1.76,0]} castShadow>
              <meshStandardMaterial color={person.id === "gpt" ? "#d9e7ed" : "#efc2a5"} roughness={0.78}/>
              <Edges color={hovered || selected ? "#ffffff" : "#eff5ff"} threshold={32} lineWidth={selected ? 1.8 : hovered ? 1.35 : 0.8}/>
            </RoundedBox>
            <Hair id={person.id}/>
            <Face robot={person.id === "gpt"}/>
          </group>
          <mesh position={[0,1.36,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[0.22,0.045,8,16,.9*Math.PI]}/><meshStandardMaterial color={person.id === "dira" ? "#d5bff2" : "#e7edf1"}/></mesh>
          <Accessories id={person.id}/>

          <group ref={armL} position={[-0.49,1.06,0]}>
            <mesh position={[0,-0.18,-0.10]} castShadow><RoundedBox args={[0.19,0.56,0.19]} radius={0.07} smoothness={2}><meshStandardMaterial color={person.color}/></RoundedBox></mesh>
            <Hand robot={person.id === "gpt"}/>
          </group>
          <group ref={armR} position={[0.49,1.06,0]}>
            <mesh position={[0,-0.18,-0.10]} castShadow><RoundedBox args={[0.19,0.56,0.19]} radius={0.07} smoothness={2}><meshStandardMaterial color={person.color}/></RoundedBox></mesh>
            <Hand robot={person.id === "gpt"}/>
          </group>

          <group ref={legL} position={[-0.21,0.62,0]}>
            <mesh position={[0,-0.27,-0.02]} castShadow><RoundedBox args={[0.21,0.70,0.25]} radius={0.06} smoothness={2}><meshStandardMaterial color="#303b47"/></RoundedBox></mesh>
          </group>
          <group ref={legR} position={[0.21,0.62,0]}>
            <mesh position={[0,-0.27,-0.02]} castShadow><RoundedBox args={[0.21,0.70,0.25]} radius={0.06} smoothness={2}><meshStandardMaterial color="#303b47"/></RoundedBox></mesh>
          </group>
          <Shoes />
        </group>

        <mesh ref={ring} position={[0, OFFICE_CONFIG.visual.selectedRingY, 0]} rotation={[-Math.PI/2,0,0]}>
          <ringGeometry args={[0.92,1.06,40]}/>
          <meshBasicMaterial color={person.color} transparent opacity={selected ? 0.72 : 0.25} depthWrite={false}/>
        </mesh>

        <Html center position={[0, OFFICE_CONFIG.visual.labelBaseHeight + labelLane * OFFICE_CONFIG.visual.labelLaneStep + (person.id === "dira" ? 0.34 : 0), 0]} distanceFactor={11}>
          <div ref={label} className={`tag ${selected ? "sel" : ""} ${hovered ? "hovered" : ""}`}>
            <b>{person.name}</b>
            <small>{person.role}</small>
            <em><i className="state-dot" style={{background:person.color}}/><span className="state-text">working</span></em>
          </div>
        </Html>
      </group>
    </group>
  );
}

function animateWorking(
  body: THREE.Group,
  head: THREE.Group,
  armL: THREE.Group,
  armR: THREE.Group,
  legL: THREE.Group,
  legR: THREE.Group,
  elapsed: number,
  delta: number,
  index: number,
  micro: { type: MicroAction; started: number; duration: number; next: number },
  allowed: boolean,
  random: () => number,
) {
  const breathe =
    Math.sin((elapsed + index * 0.83) * 2 * Math.PI * OFFICE_CONFIG.idle.breathingHz) *
    OFFICE_CONFIG.idle.breathingAmplitude;

  body.position.y = damp(body.position.y, breathe, 8, delta);

  if (allowed && micro.type === "NONE" && elapsed >= micro.next) {
    const roll = random();
    const checks: Array<[number, MicroAction]> = [
      [OFFICE_CONFIG.idle.probabilities.stretch, "STRETCH"],
      [OFFICE_CONFIG.idle.probabilities.scratch, "SCRATCH"],
      [OFFICE_CONFIG.idle.probabilities.drink, "DRINK"],
      [OFFICE_CONFIG.idle.probabilities.lean, "LEAN"],
      [OFFICE_CONFIG.idle.probabilities.shift, "SHIFT"],
      [1, "LOOK"],
    ];

    let cumulative = 0;
    let picked: MicroAction = "LOOK";
    for (const [weight, type] of checks) {
      cumulative += weight;
      if (roll <= cumulative) {
        picked = type;
        break;
      }
    }

    micro.type = picked;
    micro.started = elapsed;
    micro.duration = THREE.MathUtils.lerp(0.7, 1.9, random());
    micro.next =
      elapsed +
      THREE.MathUtils.lerp(
        OFFICE_CONFIG.idle.microMinSeconds,
        OFFICE_CONFIG.idle.microMaxSeconds,
        random(),
      );
  }

  const active =
    micro.type !== "NONE" && elapsed - micro.started < micro.duration;

  const progress = active
    ? easeInOut((elapsed - micro.started) / micro.duration)
    : 0;
  const wave = Math.sin(progress * Math.PI);

  let targetHead = 0;
  let targetBody = 0.035;
  let leftArm = 0.18;
  let rightArm = -0.18;

  if (active) {
    if (micro.type === "LOOK") {
      targetHead = OFFICE_CONFIG.idle.headTurnAmplitude * wave;
    } else if (micro.type === "SCRATCH") {
      leftArm = 0.66 + 0.10 * wave;
    } else if (micro.type === "DRINK") {
      rightArm = -0.78;
    } else if (micro.type === "LEAN") {
      targetBody = 0.035 - 0.10 * wave;
    } else if (micro.type === "STRETCH") {
      leftArm = -0.42 - 0.22 * wave;
      rightArm = 0.42 + 0.22 * wave;
      targetBody = 0.02 - 0.04 * wave;
    }
  } else if (micro.type !== "NONE") {
    micro.type = "NONE";
  }

  head.rotation.y = damp(head.rotation.y, targetHead, 7, delta);
  head.rotation.x = damp(
    head.rotation.x,
    Math.sin(elapsed * 0.65 + index) * OFFICE_CONFIG.idle.headNodAmplitude * 0.18,
    6,
    delta,
  );

  body.rotation.x = damp(body.rotation.x, targetBody, 7, delta);

  const typing =
    active && micro.type !== "LOOK"
      ? 0.18
      : OFFICE_CONFIG.idle.typingAmplitude;

  armL.rotation.z = damp(
    armL.rotation.z,
    leftArm +
      Math.sin(elapsed * OFFICE_CONFIG.idle.typingSpeed + index) * typing,
    11,
    delta,
  );
  armR.rotation.z = damp(
    armR.rotation.z,
    rightArm +
      Math.sin(elapsed * OFFICE_CONFIG.idle.typingSpeed * 1.13 + index * 1.7) * typing,
    11,
    delta,
  );

  body.position.x = damp(
    body.position.x,
    micro.type === "SHIFT" ? 0.10 * wave : 0,
    9,
    delta,
  );

  legL.rotation.x = damp(legL.rotation.x, 0, 8, delta);
  legR.rotation.x = damp(legR.rotation.x, 0, 8, delta);
}

function OfficeChair({ refObj, position, rotationY }: {
  refObj: RefObject<THREE.Group>;
  position: THREE.Vector3;
  rotationY: number;
}) {
  return <group ref={refObj} position={position} rotation={[0,rotationY,0]}>
    <RoundedBox args={[OFFICE_CONFIG.desks.chairWidth,0.14,OFFICE_CONFIG.desks.chairSeatDepth]} radius={0.06} smoothness={2} position={[0,0.64,0]} castShadow>
      <meshStandardMaterial color="#3e4b59" roughness={0.75}/>
    </RoundedBox>
    <RoundedBox args={[OFFICE_CONFIG.desks.chairWidth,OFFICE_CONFIG.desks.chairBackHeight,0.16]} radius={0.06} smoothness={2} position={[0,1.17,0.31]} castShadow>
      <meshStandardMaterial color="#455361" roughness={0.78}/>
    </RoundedBox>
    <mesh position={[0,0.26,0]}><cylinderGeometry args={[0.06,0.06,0.55,8]}/><meshStandardMaterial color="#252b31"/></mesh>
  </group>;
}

function Hair({ id }: { id: string }) {
  const color = id === "wri" ? "#7c4a27" : id === "dira" ? "#4a3a62" : id === "gemi" ? "#f1c6e6" : "#28313b";
  return <mesh position={[0,2.06,0]} castShadow><RoundedBox args={[0.68,0.19,0.63]} radius={0.09} smoothness={2}><meshStandardMaterial color={color} roughness={0.82}/></RoundedBox></mesh>;
}

function Face({ robot }: { robot: boolean }) {
  return robot
    ? <mesh position={[0,1.74,-0.335]}><boxGeometry args={[0.30,0.085,0.03]}/><meshBasicMaterial color="#55e0ff"/></mesh>
    : <>
      <mesh position={[-0.13,1.77,-0.315]}><sphereGeometry args={[0.036,10,10]}/><meshBasicMaterial color="#111"/></mesh>
      <mesh position={[0.13,1.77,-0.315]}><sphereGeometry args={[0.036,10,10]}/><meshBasicMaterial color="#111"/></mesh>
      <mesh position={[0,1.66,-0.315]}><boxGeometry args={[0.11,0.024,0.02]}/><meshBasicMaterial color="#7a4b46"/></mesh>
    </>;
}

function Accessories({ id }: { id: string }) {
  if (id === "rhea" || id === "dira" || id === "vox") return <Headset tone={id === "dira" ? "#c58aff" : id === "vox" ? "#ff8b94" : "#74a7ff"} />;
  if (id === "gemi") return <Tablet color="#66dcae"/>;
  if (id === "wri") return <mesh position={[0,1.12,0.28]}><boxGeometry args={[0.25,0.05,0.18]}/><meshStandardMaterial color="#7c4a27"/></mesh>;
  return <mesh position={[0,1.06,0.30]}><boxGeometry args={[0.24,0.14,0.04]}/><meshStandardMaterial color="#65dfff" emissive="#65dfff" emissiveIntensity={0.42}/></mesh>;
}

function Headset({ tone }: { tone: string }) {
  return <group position={[0,1.98,0]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[0.37,0.032,8,24,Math.PI]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[-0.31,-0.02,-0.02]}><cylinderGeometry args={[0.08,0.08,0.12,12]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[0.31,-0.02,-0.02]}><cylinderGeometry args={[0.08,0.08,0.12,12]}/><meshStandardMaterial color={tone}/></mesh></group>;
}

function Tablet({ color }: { color: string }) {
  return <group position={[0,1.01,-0.40]} rotation={[0.12,0,0]}><RoundedBox args={[0.45,0.06,0.34]} radius={0.04} smoothness={2}><meshStandardMaterial color="#26313b"/></RoundedBox><mesh position={[0,0.036,-0.01]}><boxGeometry args={[0.34,0.012,0.24]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.24}/></mesh></group>;
}

function Hand({ robot }: { robot: boolean }) {
  return <mesh position={[0,-0.52,-0.34]} castShadow><sphereGeometry args={[0.095,10,10]} /><meshStandardMaterial color={robot ? "#d9e7ed" : "#efc1a3"}/></mesh>;
}

function Shoes() {
  return <group><mesh position={[-0.22,0.10,-0.10]} castShadow><boxGeometry args={[0.24,0.15,0.40]}/><meshStandardMaterial color="#1e252b"/></mesh><mesh position={[0.22,0.10,-0.10]} castShadow><boxGeometry args={[0.24,0.15,0.40]}/><meshStandardMaterial color="#1e252b"/></mesh></group>;
}

