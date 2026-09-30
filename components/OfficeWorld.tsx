"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { OFFICE_CONFIG, BreakSpotId, WORKER_DESK_IDS, getSeatTransform } from "../lib/officeConfig";

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
  | "SIT_DOWN"
  | "LIMIT_REST";

type BreakActivity = "SOFA" | "SNACK" | "WINDOW";

type BreakSpot = {
  pos: [number, number, number];
  facing: number;
  activity: BreakActivity;
};

const DESKS: Record<string, [number, number, number]> = OFFICE_CONFIG.desks.positions;

const BREAK_SPOTS: Record<BreakSpotId, BreakSpot> = {
  sofaLeft: { pos: OFFICE_CONFIG.lounge.sofa.left, facing: Math.PI, activity: "SOFA" },
  sofaRight: { pos: OFFICE_CONFIG.lounge.sofa.right, facing: Math.PI, activity: "SOFA" },
  snacks: { pos: OFFICE_CONFIG.lounge.snacks, facing: -Math.PI / 2, activity: "SNACK" },
  window: { pos: OFFICE_CONFIG.lounge.window, facing: Math.PI, activity: "WINDOW" },
};

const ROUTE_SIDE_X = OFFICE_CONFIG.lounge.sideCorridorX;
const ROUTE_REAR_Z = OFFICE_CONFIG.lounge.rearWalkZ;
const WALK_PAIRS: Array<[number, number]> = [[0, 5], [1, 4], [2, 3]];
const SPOT_ORDER: BreakSpotId[] = ["sofaLeft", "sofaRight", "snacks", "window"];

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

function clamp01(v: number) {
  return THREE.MathUtils.clamp(v, 0, 1);
}

function ease(v: number) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function damp(current: number, target: number, smoothing: number, delta: number) {
  return THREE.MathUtils.damp(current, target, smoothing, delta);
}

function deskPosition(id: string) {
  return DESKS[id];
}

function homeSeat(id: string) {
  return new THREE.Vector3(...getSeatTransform(deskPosition(id)).seatPosition);
}
function seatTransform(id: string) { return getSeatTransform(deskPosition(id)); }

function buildRoute(from: THREE.Vector3, spot: BreakSpotId, back = false) {
  const target = new THREE.Vector3(...BREAK_SPOTS[spot].pos);
  const side = new THREE.Vector3(ROUTE_SIDE_X, 0, ROUTE_REAR_Z);

  const anchors = back
    ? [
        target,
        new THREE.Vector3(ROUTE_SIDE_X, 0, ROUTE_REAR_Z),
        new THREE.Vector3(ROUTE_SIDE_X, 0, OFFICE_CONFIG.workZone.corridorFrontZ),
        from.clone(),
      ]
    : [
        from.clone(),
        new THREE.Vector3(ROUTE_SIDE_X, 0, 1.25),
        side,
        target,
      ];

  const curve = new THREE.CatmullRomCurve3(anchors, false, "centripetal", 0.35);
  return { curve, length: curve.getLength() };
}

function chooseSpot(workerIndex: number, wave: number) {
  return SPOT_ORDER[(workerIndex + wave) % SPOT_ORDER.length];
}

function isBreakTime(elapsed: number, index: number, externalState: string) {
  if (externalState !== "Idle") return null;
  if (elapsed < OFFICE_CONFIG.movement.firstBreakDelay) return null;

  const wave = Math.floor((elapsed - OFFICE_CONFIG.movement.firstBreakDelay) / OFFICE_CONFIG.movement.breakWaveInterval);
  const pair = WALK_PAIRS[wave % WALK_PAIRS.length];
  if (index !== pair[0] && index !== pair[1]) return null;

  const local = (elapsed - OFFICE_CONFIG.movement.firstBreakDelay) % OFFICE_CONFIG.movement.breakWaveInterval;
  const start = index === pair[0] ? 0 : OFFICE_CONFIG.movement.breakStartSpacing * 0.45;
  return local >= start && local <= start + 18 ? wave : null;
}

export default function OfficeWorld({
  people,
  running,
  resting,
  selected,
}: {
  people: Person[];
  running: boolean;
  resting: boolean;
  selected: string;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", display: "block" }}
      onCreated={({ gl }) => {
        gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        gl.setClearColor("#aeb8c4", 1);
      }}
    >
      <PerspectiveCamera makeDefault position={[17.5, 13.5, 19.5]} fov={43} near={0.1} far={120} />
      <ambientLight intensity={2.15} />
      <directionalLight
        position={[7, 14, 8]}
        intensity={2.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <pointLight position={[-6, 5, 4]} intensity={18} distance={17} color="#8fc7ff" />
      <pointLight position={[6, 5, -4]} intensity={16} distance={15} color="#ffd18a" />

      <OfficeGeometry resting={resting} />

      {people.map((person, index) => (
        <WorkerCharacter
          key={person.id}
          person={person}
          workerIndex={index}
          selected={selected === person.id}
          running={running}
          globalResting={resting}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 1.0, -0.8]}
        minDistance={13}
        maxDistance={30}
        minPolarAngle={0.78}
        maxPolarAngle={1.48}
        enableDamping
        dampingFactor={0.08}
        enablePan
      />
    </Canvas>
  );
}

function OfficeGeometry({ resting }: { resting: boolean }) {
  return (
    <group>
      <mesh position={[0, -0.34, 0]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width, 0.52, OFFICE_CONFIG.room.depth]} />
        <meshStandardMaterial color="#8e6748" roughness={0.92} />
      </mesh>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width - 0.3, 0.10, OFFICE_CONFIG.room.depth - 0.3]} />
        <meshStandardMaterial color="#c19a70" roughness={0.98} />
      </mesh>

      <mesh position={[0, 3.8, OFFICE_CONFIG.room.backWallZ]} receiveShadow>
        <boxGeometry args={[OFFICE_CONFIG.room.width, OFFICE_CONFIG.room.wallHeight, 0.30]} />
        <meshStandardMaterial color="#d9cebb" roughness={1} />
      </mesh>
      <mesh position={[-14.86, 3.8, 0]} receiveShadow>
        <boxGeometry args={[0.30, OFFICE_CONFIG.room.wallHeight, OFFICE_CONFIG.room.depth]} />
        <meshStandardMaterial color="#cfc3ad" roughness={1} />
      </mesh>
      <mesh position={[14.86, 3.8, 0]} receiveShadow>
        <boxGeometry args={[0.30, 7.55, 14]} />
        <meshStandardMaterial color="#cfc3ad" roughness={1} />
      </mesh>

      <FloorGrid />
      <WindowRow />
      <CeilingLights resting={resting} />
      <Workstations />
      <BreakZone />
      <WallBoard resting={resting} />
    </group>
  );
}

function FloorGrid() {
  return (
    <group>
      {Array.from({ length: 28 }).map((_, i) => (
        <mesh key={"x" + i} position={[-14.2 + i * 0.62, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.018, 22.0]} />
          <meshBasicMaterial color="#9e7857" transparent opacity={0.30} />
        </mesh>
      ))}
      {Array.from({ length: 23 }).map((_, i) => (
        <mesh key={"z" + i} position={[0, -0.004, -10.1 + i * 0.56]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[29.0, 0.018]} />
          <meshBasicMaterial color="#9e7857" transparent opacity={0.30} />
        </mesh>
      ))}
      <mesh position={[0, 0.005, -5.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={OFFICE_CONFIG.lounge.size} />
        <meshStandardMaterial color="#756486" roughness={1} />
      </mesh>
    </group>
  );
}

function WindowRow() {
  return (
    <group>
      {[-11, -5.5, 0, 5.5, 11].map((x) => (
        <group key={x} position={[x, 4.9, -10.92]}>
          <mesh castShadow>
            <boxGeometry args={[4.55, 2.25, 0.09]} />
            <meshStandardMaterial color="#6e93aa" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <boxGeometry args={[4.25, 1.98, 0.018]} />
            <meshBasicMaterial color="#d4ebf6" />
          </mesh>
          <mesh position={[0, 0, 0.085]}>
            <boxGeometry args={[0.06, 2.1, 0.018]} />
            <meshStandardMaterial color="#7c6c57" />
          </mesh>
          <mesh position={[0, 0, 0.085]}>
            <boxGeometry args={[4.4, 0.06, 0.018]} />
            <meshStandardMaterial color="#7c6c57" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CeilingLights({ resting }: { resting: boolean }) {
  const colors = ["#b6d7ff", "#fff0ca", "#d6c8ff", "#b8f3d8"];
  return (
    <group>
      {[-5.2, -1.7, 1.7, 5.2].map((x, i) => (
        <group key={x} position={[x, 6.1, -1.4]}>
          <mesh castShadow>
            <boxGeometry args={[1.55, 0.08, 0.72]} />
            <meshStandardMaterial color="#f4eddf" emissive={colors[i]} emissiveIntensity={resting ? 0.05 : 0.34} />
          </mesh>
          <pointLight position={[0, -0.18, 0]} intensity={resting ? 2.2 : 8} distance={6} color={colors[i]} />
        </group>
      ))}
    </group>
  );
}

function Workstations() {
  return (
    <group>
      {WORKER_DESK_IDS.map((id) => (
        <Desk key={id} position={DESKS[id]} />
      ))}
      <Shelf position={[-12.5, 0, -8.6]} />
      <Printer position={[-12.3, 0, -5.5]} />
      <ServerRack position={[12.4, 0, 4.5]} />
    </group>
  );
}

function Desk({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.55, 0.22, 1.18]} />
        <meshStandardMaterial color="#6a4935" roughness={0.74} />
      </mesh>
      {[[-0.9, 0.66, -0.37], [0.9, 0.66, -0.37], [-0.9, 0.66, 0.37], [0.9, 0.66, 0.37]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.13, 1.55, 0.13]} />
          <meshStandardMaterial color="#422d22" />
        </mesh>
      ))}
      <Monitor />
      <Keyboard />
      <Mug />
      <PaperStack />
      <DeskLamp />
    </group>
  );
}

function Monitor() {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const cursor = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (screen.current) screen.current.emissiveIntensity = 0.44 + Math.sin(state.clock.elapsedTime * 2.5) * 0.07;
    if (cursor.current) cursor.current.position.x = -0.36 + ((state.clock.elapsedTime * 0.72) % 0.68);
  });

  return (
    <group position={[0, 2.03, -0.22]}>
      <mesh castShadow><boxGeometry args={[1.10, 0.66, 0.10]} /><meshStandardMaterial color="#0d1218" /></mesh>
      <mesh position={[0, -0.02, 0.058]}>
        <boxGeometry args={[0.88, 0.46, 0.02]} />
        <meshStandardMaterial ref={screen} color="#17333e" emissive="#4fc6ee" />
      </mesh>
      {[[-0.31,0.12],[0,0.12],[0.25,0.12],[-0.22,-0.05],[0.04,-0.05],[0.28,-0.05]].map(([x,y],i)=>
        <mesh key={i} position={[x,y,0.08]}><boxGeometry args={[i<3?.16:.13,.035,.008]}/><meshBasicMaterial color={i===2?"#f4d26e":"#59bae2"}/></mesh>
      )}
      <mesh ref={cursor} position={[-0.36,-0.14,0.09]}><boxGeometry args={[0.02,0.06,0.009]}/><meshBasicMaterial color="#f8f5de"/></mesh>
      <mesh position={[0,-0.58,0]}><boxGeometry args={[0.11,0.55,0.11]}/><meshStandardMaterial color="#45515d"/></mesh>
      <mesh position={[0,-0.84,0]}><boxGeometry args={[0.68,0.07,0.30]}/><meshStandardMaterial color="#303941"/></mesh>
    </group>
  );
}
function Keyboard(){return <mesh position={[0,1.61,0.18]}><boxGeometry args={[0.86,0.04,0.28]}/><meshStandardMaterial color="#222830"/></mesh>}
function Mug(){return <mesh position={[-0.78,1.66,0.20]} castShadow><cylinderGeometry args={[0.11,0.12,0.18,12]}/><meshStandardMaterial color="#ece4d8"/></mesh>}
function PaperStack(){return <group>{[0,0.028,0.056].map(y=><mesh key={y} position={[0.66,1.61+y,0.23]}><boxGeometry args={[0.43,0.024,0.33]}/><meshStandardMaterial color="#f2eee7"/></mesh>)}</group>}
function DeskLamp(){return <group position={[0.9,1.6,-0.2]}><mesh position={[0,0.25,0]}><cylinderGeometry args={[0.035,0.035,0.5,8]}/><meshStandardMaterial color="#3c454e"/></mesh><mesh position={[0,0.53,0]}><coneGeometry args={[0.19,0.2,12]}/><meshStandardMaterial color="#e7b85f" emissive="#6f501b" emissiveIntensity={0.18}/></mesh></group>}

function BreakZone(){
  return <group>
    <Sofa/>
    <VendingMachine position={[...OFFICE_CONFIG.lounge.snacks]}/>
    <Beanbag position={[...OFFICE_CONFIG.lounge.beanbagA]}/>
    <Beanbag position={[...OFFICE_CONFIG.lounge.beanbagB]}/>
    <CoffeeTable position={[6.8,0,-7.0]}/>
    <FishTank position={[11.0,0,-8.8]}/>
  </group>;
}
function Sofa(){
  return <group position={[5.45,0,-8.55]}>
    <mesh position={[0,0.5,0]} castShadow><boxGeometry args={[3.35,0.62,1.0]}/><meshStandardMaterial color="#6d5975" roughness={0.9}/></mesh>
    <mesh position={[-1.53,1.0,0]} castShadow><boxGeometry args={[0.34,1.55,1.0]}/><meshStandardMaterial color="#6d5975"/></mesh>
    <mesh position={[1.53,1.0,0]} castShadow><boxGeometry args={[0.34,1.55,1.0]}/><meshStandardMaterial color="#6d5975"/></mesh>
    <mesh position={[0,1.0,-0.40]}><boxGeometry args={[2.45,0.72,0.16]}/><meshStandardMaterial color="#75617b"/></mesh>
  </group>;
}
function VendingMachine({position}:{position:[number,number,number]}){
  const mat=useRef<THREE.MeshStandardMaterial>(null);
  useFrame(s=>{if(mat.current)mat.current.emissiveIntensity=.23+Math.sin(s.clock.elapsedTime*3)*.06});
  return <group position={position}>
    <mesh castShadow><boxGeometry args={[0.92,2.4,0.72]}/><meshStandardMaterial color="#303942"/></mesh>
    <mesh position={[0,0.28,0.37]}><boxGeometry args={[0.68,0.96,0.03]}/><meshStandardMaterial ref={mat} color="#162b34" emissive="#2b687d"/></mesh>
    {[-.22,0,.22].map((x,i)=><mesh key={i} position={[x,-.63,.39]}><boxGeometry args={[.13,.18,.04]}/><meshStandardMaterial color={["#ed8288","#efc868","#68c98e"][i]}/></mesh>)}
    <Html center position={[0,1.48,.16]} distanceFactor={14}><div className="prop-label">SNACKS</div></Html>
  </group>;
}
function Beanbag({position}:{position:[number,number,number]}){return <group position={position}><mesh scale={[1,0.7,1]} castShadow><sphereGeometry args={[0.72,16,10]}/><meshStandardMaterial color="#6c7699" roughness={.92}/></mesh></group>}
function Plant({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><cylinderGeometry args={[.34,.42,.48,10]}/><meshStandardMaterial color="#a66f47"/></mesh>{[-.18,0,.18].map((x,i)=><mesh key={i} position={[x,.72,.02]} rotation={[0,0,(i-1)*.25]} castShadow><sphereGeometry args={[.23,.23,.52,12]}/><meshStandardMaterial color={["#64b779","#4ba66d","#79c889"][i]}/></mesh>)}</group>}
function CoffeeTable({position}:{position:[number,number,number]}){return <group position={position}><mesh position={[0,.34,0]} castShadow><cylinderGeometry args={[.72,.70,.10,12]}/><meshStandardMaterial color="#684b37"/></mesh><mesh position={[0,.12,0]}><cylinderGeometry args={[.10,.14,.43,10]}/><meshStandardMaterial color="#4c3325"/></mesh><mesh position={[-.2,.44,.0]}><cylinderGeometry args={[.09,.10,.15,10]}/><meshStandardMaterial color="#eee6db"/></mesh></group>}
function FishTank({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1.5,1.45,.8]}/><meshPhysicalMaterial color="#6fc4dc" transparent opacity={.24} transmission={.45}/></mesh><mesh position={[0,-.54,0]}><boxGeometry args={[1.30,.34,.66]}/><meshStandardMaterial color="#917a62"/></mesh><mesh position={[.2,0,.02]}><sphereGeometry args={[.10,10,10]}/><meshStandardMaterial color="#f3b54c"/></mesh></group>}
function Shelf({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1.3,3,.52]}/><meshStandardMaterial color="#513c2d"/></mesh>{[.8,.05,-.7].map(y=><mesh key={y} position={[0,y,.29]}><boxGeometry args={[1.18,.10,.08]}/><meshStandardMaterial color="#75533a"/></mesh>)}{[-.34,.02,.36].map((x,i)=><mesh key={i} position={[x,.4,.34]}><boxGeometry args={[.18,.36,.10]}/><meshStandardMaterial color={["#eab45b","#70b8df","#d67faa"][i]}/></mesh>)}</group>}
function Printer({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1,.80,.78]}/><meshStandardMaterial color="#4b555e"/></mesh><mesh position={[0,.44,.04]}><boxGeometry args={[.72,.05,.45]}/><meshStandardMaterial color="#ebeff2"/></mesh></group>}
function ServerRack({position}:{position:[number,number,number]}){const mat=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(mat.current)mat.current.emissiveIntensity=.08+Math.sin(s.clock.elapsedTime*5)*.05});return <group position={position}><mesh castShadow><boxGeometry args={[1.1,2.1,.72]}/><meshStandardMaterial color="#232b33"/></mesh>{[-.5,0,.5].map(y=><mesh key={y} position={[0,y,.38]}><boxGeometry args={[.72,.25,.02]}/><meshStandardMaterial ref={y===0?mat:undefined} color="#20323a" emissive="#59d6ff"/></mesh>)}</group>}

function WorkerCharacter({
  person, workerIndex, selected, running, globalResting,
}: {
  person: Person; workerIndex: number; selected: boolean; running: boolean; globalResting: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const chair = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const ring = useRef<THREE.Mesh>(null);

  const random = useMemo(() => seededRandom((workerIndex + 17) * 9283), [workerIndex]);
  const speed = useMemo(() => 1 - OFFICE_CONFIG.movement.speedVariance + random() * OFFICE_CONFIG.movement.speedVariance * 2, [random]);
  const mode = useRef<Mode>("WORKING");
  const modeTime = useRef(0);
  const plan = useRef<{ spot: BreakSpotId; duration: number } | null>(null);
  const route = useRef<{ curve: THREE.CatmullRomCurve3; length: number } | null>(null);
  const distance = useRef(0);
  const micro = useRef<MicroState>({ type: "NONE", started: 0, duration: 0, next: 2 + random() * 5 });

  const seat = useMemo(() => seatTransform(person.id), [person.id]);
  const home = useMemo(() => new THREE.Vector3(...seat.seatPosition), [seat]);
  const chairHome = useMemo(() => new THREE.Vector3(...seat.chairPosition), [seat]);
  const pulledChair = useMemo(() => new THREE.Vector3(...seat.pulledChairPosition), [seat]);
  const approach = useMemo(() => new THREE.Vector3(...seat.approachPosition), [seat]);
  const stand = useMemo(() => approach.clone(), [approach]);

  useFrame((state, delta) => {
    if (!root.current || !body.current || !head.current || !chair.current) return;
    const elapsed = state.clock.elapsedTime;
    const activeIdle = person.state === "Idle";
    const limited = person.state === "Limit";

    modeTime.current += delta;

    if (limited && mode.current === "WORKING") {
      plan.current = { spot: chooseSpot(workerIndex, Math.floor(elapsed)), duration: 999999 };
      route.current = buildRoute(root.current.position.clone(), plan.current.spot);
      distance.current = 0; mode.current = "ANTICIPATE"; modeTime.current = 0;
    } else if (!limited && mode.current === "LIMIT_REST") {
      const spot = plan.current?.spot ?? "window";
      route.current = buildReturnRoute(person.id, spot, root.current.position);
      distance.current = 0; mode.current = "WALK_BACK"; modeTime.current = 0;
    } else if (globalResting) {
      if (mode.current !== "WORKING" && mode.current !== "WALK_BACK" && mode.current !== "SIT_DOWN") {
        mode.current = "WALK_BACK";
        route.current = buildReturnRoute(person.id, plan.current?.spot ?? "window", root.current.position);
        distance.current = 0;
        modeTime.current = 0;
      }
    } else if (running && activeIdle && mode.current === "WORKING" && modeTime.current > 0.5) {
      const wave = isBreakTime(elapsed, workerIndex, person.state);
      if (wave !== null) {
        const spot = chooseSpot(workerIndex, wave);
        plan.current = {
          spot,
          duration: THREE.MathUtils.lerp(OFFICE_CONFIG.movement.breakDurationMin, OFFICE_CONFIG.movement.breakDurationMax, random()),
        };
        route.current = buildRoute(root.current.position.clone(), spot);
        distance.current = 0;
        mode.current = "ANTICIPATE";
        modeTime.current = 0;
      }
    }

    const m = mode.current;

    if (m === "WORKING") {
      animateWorking({ body:body.current, head:head.current, armL:armL.current, armR:armR.current, chair:chair.current }, elapsed, delta, workerIndex, micro.current, activeIdle, random);
      root.current.position.x = damp(root.current.position.x, home.x, 10, delta);
      root.current.position.z = damp(root.current.position.z, home.z, 10, delta);
      root.current.rotation.y = damp(root.current.rotation.y, Math.PI, 9, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, Math.PI, 9, delta);
    }

    if (m === "ANTICIPATE") {
      const t = ease(modeTime.current / OFFICE_CONFIG.movement.anticipateDuration);
      body.current.rotation.x = damp(body.current.rotation.x, 0.12 * Math.sin(t * Math.PI), 10, delta);
      head.current.rotation.y = damp(head.current.rotation.y, 0.2 * Math.sin(t * Math.PI), 8, delta);
      chair.current.position.z = damp(chair.current.position.z, 0.18 * t, 11, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, OFFICE_CONFIG.desks.chairTurn * t, 10, delta);
      if (t >= 1) { mode.current = "STAND_UP"; modeTime.current = 0; }
    }

    if (m === "STAND_UP") {
      const t = ease(modeTime.current / OFFICE_CONFIG.movement.standUpDuration);
      root.current.position.lerpVectors(home, stand, t);
      body.current.position.y = damp(body.current.position.y, 0.22 * t, 10, delta);
      body.current.rotation.x = damp(body.current.rotation.x, 0.04 - 0.10 * t, 9, delta);
      chair.current.position.x = damp(chair.current.position.x, pulledChair.x, 11, delta);
      chair.current.position.z = damp(chair.current.position.z, pulledChair.z, 11, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, Math.PI + OFFICE_CONFIG.desks.chairTurn, 10, delta);
      if (t >= 1) { mode.current = "WALK"; modeTime.current = 0; }
    }

    if (m === "WALK" || m === "WALK_BACK") {
      const r = route.current;
      if (!r) {
        mode.current = m === "WALK" ? "ARRIVE" : "SIT_DOWN";
        modeTime.current = 0;
      } else {
        const u = clamp01(distance.current / Math.max(r.length, 0.001));
        const accel = clamp01(u / OFFICE_CONFIG.movement.accelerationFraction);
        const decel = clamp01((1-u) / OFFICE_CONFIG.movement.decelerationFraction);
        const speedFactor = Math.max(0.20, OFFICE_CONFIG.easing.smoother(accel) * OFFICE_CONFIG.easing.smoother(decel));
        distance.current = Math.min(r.length, distance.current + OFFICE_CONFIG.movement.walkSpeed * speed * speedFactor * delta);

        const nu = clamp01(distance.current / Math.max(r.length, 0.001));
        const target = r.curve.getPointAt(nu);
        const tangent = r.curve.getTangentAt(nu).normalize();
        root.current.position.lerp(target, Math.min(1, 9 * delta));
        root.current.rotation.y = damp(root.current.rotation.y, Math.atan2(tangent.x, tangent.z), 10, delta);

        const step = Math.sin(elapsed * OFFICE_CONFIG.walking.strideSpeed + workerIndex * 1.7);
        legL.current.rotation.x = damp(legL.current.rotation.x, step * OFFICE_CONFIG.walking.footSwing, 15, delta);
        legR.current.rotation.x = damp(legR.current.rotation.x, -step * OFFICE_CONFIG.walking.footSwing, 15, delta);
        armL.current.rotation.x = damp(armL.current.rotation.x, -step * OFFICE_CONFIG.walking.armSwing, 15, delta);
        armR.current.rotation.x = damp(armR.current.rotation.x, step * OFFICE_CONFIG.walking.armSwing, 15, delta);
        body.current.position.y = damp(body.current.position.y, Math.abs(step) * OFFICE_CONFIG.walking.bobAmplitude, 12, delta);
        body.current.rotation.x = damp(body.current.rotation.x, OFFICE_CONFIG.walking.lean * tangent.x, 8, delta);

        if (nu >= 0.999) {
          if (m === "WALK") { mode.current = "ARRIVE"; modeTime.current = 0; }
          else { mode.current = "SIT_DOWN"; modeTime.current = 0; }
          route.current = null;
        }
      }
    }

    if (m === "ARRIVE") {
      const t = ease(modeTime.current / OFFICE_CONFIG.movement.arriveDuration);
      const spot = BREAK_SPOTS[plan.current?.spot ?? "window"];
      root.current.rotation.y = damp(root.current.rotation.y, spot.facing, 9, delta);
      body.current.position.y = damp(body.current.position.y, 0.035 * Math.sin(t * Math.PI), 9, delta);
      if (t >= 1) { mode.current = limited ? "LIMIT_REST" : "ACTIVITY"; modeTime.current = 0; }
    }

    if (m === "LIMIT_REST") {
      // A limit worker stays in the lounge until the external Limit flag clears.
      body.current.position.y = damp(body.current.position.y, 0, 6, delta);
      head.current.rotation.y = damp(head.current.rotation.y, Math.sin(elapsed * .45 + workerIndex) * .18, 4, delta);
      armL.current.rotation.z = damp(armL.current.rotation.z, .12, 4, delta);
      armR.current.rotation.z = damp(armR.current.rotation.z, -.12, 4, delta);
    }

    if (m === "ACTIVITY") {
      const spot = BREAK_SPOTS[plan.current?.spot ?? "window"];
      const t = modeTime.current;
      root.current.rotation.y = damp(root.current.rotation.y, spot.facing, 8, delta);
      if (spot.activity === "SOFA") {
        body.current.position.y = damp(body.current.position.y, -0.15, 8, delta);
        body.current.rotation.x = damp(body.current.rotation.x, -0.08, 7, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, 0.25 + Math.sin(t)*0.04, 6, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, -0.25 + Math.sin(t*.9)*0.04, 6, delta);
        head.current.rotation.y = damp(head.current.rotation.y, Math.sin(t*.65 + workerIndex)*0.20, 4, delta);
      } else if (spot.activity === "SNACK") {
        body.current.position.y = damp(body.current.position.y, 0, 8, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, t < 1.0 ? 0.62 : 0.16, 7, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, t > 1.0 && t < 2.4 ? -0.65 : -0.12, 7, delta);
        head.current.rotation.x = damp(head.current.rotation.x, t > 1.2 ? 0.10 : 0, 6, delta);
      } else {
        body.current.position.y = damp(body.current.position.y, 0, 7, delta);
        head.current.rotation.y = damp(head.current.rotation.y, Math.sin(t*.45+workerIndex)*0.25, 4, delta);
        armL.current.rotation.z = damp(armL.current.rotation.z, 0.16, 5, delta);
        armR.current.rotation.z = damp(armR.current.rotation.z, -0.16, 5, delta);
      }

      if (modeTime.current >= (plan.current?.duration ?? 7)) {
        const spotId = plan.current?.spot ?? "window";
        route.current = buildRoute(new THREE.Vector3(...BREAK_SPOTS[spotId].pos), spotId, true);
        distance.current = 0;
        mode.current = "WALK_BACK";
        modeTime.current = 0;
      }
    }

    if (m === "SIT_DOWN") {
      const t = ease(modeTime.current / OFFICE_CONFIG.movement.sitDownDuration);
      root.current.position.lerpVectors(stand, home, t);
      body.current.position.y = damp(body.current.position.y, 0, 10, delta);
      body.current.rotation.x = damp(body.current.rotation.x, 0.035, 8, delta);
      chair.current.position.x = damp(chair.current.position.x, chairHome.x, 10, delta);
      chair.current.position.z = damp(chair.current.position.z, chairHome.z, 10, delta);
      chair.current.rotation.y = damp(chair.current.rotation.y, 0, 9, delta);
      root.current.rotation.y = damp(root.current.rotation.y, Math.PI, 9, delta);
      if (t >= 1) {
        mode.current = "WORKING";
        modeTime.current = 0;
        plan.current = null;
        micro.current.next = elapsed + THREE.MathUtils.lerp(4, 10, random());
      }
    }

    if (label.current) {
      const visible = limited && m === "LIMIT_REST" ? "limit" : m === "WORKING" ? "working" : (m === "ACTIVITY" || m === "ARRIVE") ? "break" : "walking";
      const text = label.current.querySelector(".state-text");
      const dot = label.current.querySelector(".state-dot") as HTMLElement | null;
      if (text) text.textContent = visible;
      if (dot) dot.style.background = visible === "working" ? person.color : visible === "walking" ? "#7aa4ff" : visible === "limit" ? "#ff6378" : "#ffbe67";
    }
    if (ring.current) ring.current.visible = selected;
  });

  return (
    <group>
      <OfficeChair refObj={chair} position={chairHome} rotationY={Math.PI} />
      <group ref={root} position={home} rotation={[0, seat.rotationY, 0]}>
        <group ref={body}>
          <mesh position={[0,1.02,0]} castShadow><boxGeometry args={[0.84,0.72,0.58]}/><meshStandardMaterial color={person.color}/></mesh>
          <group ref={head}>
            <mesh position={[0,1.73,0]} castShadow><sphereGeometry args={[0.37,16,12]}/><meshStandardMaterial color={person.id==="gpt"?"#d9e7ed":"#efc1a3"}/></mesh>
            <Hair id={person.id}/>
            <Face robot={person.id==="gpt"}/>
          </group>
          <mesh position={[0,1.34,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[0.22,0.045,8,16,.9*Math.PI]}/><meshStandardMaterial color={person.id==="dira"?"#d5bff2":"#e7edf1"}/></mesh>
          <Accessories id={person.id}/>
          <group ref={armL} position={[-0.48,1.02,0]}><mesh position={[0,-0.20,.20]} castShadow><boxGeometry args={[0.19,0.58,0.18]}/><meshStandardMaterial color={person.color}/></mesh><Hand robot={person.id==="gpt"}/></group>
          <group ref={armR} position={[0.48,1.02,0]}><mesh position={[0,-0.20,.20]} castShadow><boxGeometry args={[0.19,0.58,0.18]}/><meshStandardMaterial color={person.color}/></mesh><Hand robot={person.id==="gpt"}/></group>
          <group ref={legL} position={[-0.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><boxGeometry args={[.20,.68,.24]}/><meshStandardMaterial color="#303b47"/></mesh></group>
          <group ref={legR} position={[0.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><boxGeometry args={[.20,.68,.24]}/><meshStandardMaterial color="#303b47"/></mesh></group>
          <Shoes/>
        </group>
        <mesh ref={ring} position={[0,0.025,0]} rotation={[-Math.PI/2,0,0]} visible={selected}><ringGeometry args={[.92,1.07,40]}/><meshBasicMaterial color={person.color} transparent opacity={.5}/></mesh>
        <Html center position={[0,2.92,0]} distanceFactor={11}>
          <div ref={label} className={`tag ${selected ? "sel" : ""}`}><b>{person.name}</b><small>{person.role}</small><em><i className="state-dot" style={{background:person.color}}/><span className="state-text">working</span></em></div>
        </Html>
      </group>
    </group>
  );
}

type MicroState = { type: "NONE"|"STRETCH"|"SCRATCH"|"DRINK"|"LEAN"|"SHIFT"|"LOOK"; started:number; duration:number; next:number };

function animateWorking(parts:{body:THREE.Group;head:THREE.Group;armL:THREE.Group;armR:THREE.Group;chair:THREE.Group},elapsed:number,delta:number,index:number,micro:MicroState,allowed:boolean,random:()=>number){
  const breathe=Math.sin((elapsed+index*.83)*2*Math.PI*OFFICE_CONFIG.idle.breathingHz)*OFFICE_CONFIG.idle.breathingAmplitude;
  parts.body.position.y=damp(parts.body.position.y,breathe,8,delta);
  if(allowed && micro.type==="NONE" && elapsed>=micro.next){
    const roll=random(); const thresholds=[[0.18,"STRETCH"],[0.31,"SCRATCH"],[0.47,"DRINK"],[0.69,"LEAN"],[0.87,"SHIFT"],[1,"LOOK"]] as const;
    let picked:MicroState["type"]="LOOK";
    for(const [threshold,type] of thresholds){if(roll<=threshold){picked=type;break;}}
    micro.type=picked; micro.started=elapsed; micro.duration=THREE.MathUtils.lerp(.7,1.9,random()); micro.next=elapsed+THREE.MathUtils.lerp(OFFICE_CONFIG.idle.microMinSeconds,OFFICE_CONFIG.idle.microMaxSeconds,random());
  }
  const active=micro.type!=="NONE"&&elapsed-micro.started<micro.duration;
  const p=active?ease((elapsed-micro.started)/micro.duration):0;
  const wave=Math.sin(p*Math.PI);
  let targetHead=0, targetBody=.035, l=.18, r=-.18;
  if(active){
    if(micro.type==="LOOK") targetHead=OFFICE_CONFIG.idle.headTurnAmplitude*wave;
    if(micro.type==="SCRATCH"){l=.75+0.08*wave;parts.armL.rotation.x=damp(parts.armL.rotation.x,-.55*wave,9,delta);}
    if(micro.type==="DRINK"){r=-.9;parts.armR.rotation.x=damp(parts.armR.rotation.x,.32*wave,9,delta);}
    if(micro.type==="LEAN") targetBody=.035-.11*wave;
    if(micro.type==="STRETCH"){l=-.5-.22*wave;r=.5+.22*wave;}
  }
  if(active===false&&micro.type!=="NONE") micro.type="NONE";
  parts.head.rotation.y=damp(parts.head.rotation.y,targetHead,7,delta);
  parts.body.rotation.x=damp(parts.body.rotation.x,targetBody,7,delta);
  parts.armL.rotation.z=damp(parts.armL.rotation.z,l+Math.sin(elapsed*OFFICE_CONFIG.idle.typingSpeed+index)*OFFICE_CONFIG.idle.typingAmplitude*(active?0.25:1),11,delta);
  parts.armR.rotation.z=damp(parts.armR.rotation.z,r+Math.sin(elapsed*OFFICE_CONFIG.idle.typingSpeed*1.13+index*1.7)*OFFICE_CONFIG.idle.typingAmplitude*(active?0.25:1),11,delta);
  parts.body.position.x=damp(parts.body.position.x,micro.type==="SHIFT"?0.10*wave:0,9,delta);
}

function buildReturnRoute(id:string,spot:BreakSpotId,from:THREE.Vector3){
  const home=homeSeat(id);
  const c=new THREE.CatmullRomCurve3([from,new THREE.Vector3(ROUTE_SIDE_X,0,ROUTE_REAR_Z),new THREE.Vector3(ROUTE_SIDE_X,0,1.25),home],false,"centripetal",0.35);
  return {curve:c,length:c.getLength()};
}

function OfficeChair({refObj,position,rotationY}:{refObj:RefObject<THREE.Group>;position:THREE.Vector3;rotationY:number}){
  return <group ref={refObj} position={position} rotation={[0,rotationY,0]}>
    <mesh position={[0,.64,0]} castShadow><boxGeometry args={[.95,.14,.76]}/><meshStandardMaterial color="#3e4b59"/></mesh>
    <mesh position={[0,1.18,-.30]} castShadow><boxGeometry args={[.95,1.10,.15]}/><meshStandardMaterial color="#455361"/></mesh>
    <mesh position={[0,.26,0]}><cylinderGeometry args={[.06,.06,.55,8]}/><meshStandardMaterial color="#252b31"/></mesh>
  </group>;
}
function Hair({id}:{id:string}){const color=id==="wri"?"#7c4a27":id==="dira"?"#4b3b62":id==="gemi"?"#f4c7e8":"#28313b";return <mesh position={[0,2.06,0]} castShadow><boxGeometry args={[.68,.18,.63]}/><meshStandardMaterial color={color}/></mesh>}
function Face({robot}:{robot:boolean}){return robot?<mesh position={[0,1.73,.33]}><boxGeometry args={[.28,.08,.03]}/><meshBasicMaterial color="#55e0ff"/></mesh>:<><mesh position={[-.13,1.77,.31]}><sphereGeometry args={[.035,10,10]}/><meshBasicMaterial color="#111"/></mesh><mesh position={[.13,1.77,.31]}><sphereGeometry args={[.035,10,10]}/><meshBasicMaterial color="#111"/></mesh><mesh position={[0,1.66,.31]}><boxGeometry args={[.10,.025,.02]}/><meshBasicMaterial color="#7a4b46"/></mesh></>}
function Accessories({id}:{id:string}){if(id==="rhea"||id==="dira"||id==="vox")return <Headset tone={id==="dira"?"#c58aff":id==="vox"?"#ff8b94":"#74a7ff"}/>;if(id==="gemi")return <Tablet color="#66dcae"/>;if(id==="wri")return <mesh position={[0,1.15,.36]}><boxGeometry args={[.25,.05,.18]}/><meshStandardMaterial color="#7c4a27"/></mesh>;return <mesh position={[0,1.06,.34]}><boxGeometry args={[.24,.14,.04]}/><meshStandardMaterial color="#65dfff" emissive="#65dfff" emissiveIntensity={.4}/></mesh>}
function Headset({tone}:{tone:string}){return <group position={[0,1.98,0]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[.37,.032,8,24,Math.PI]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[-.31,-.02,.03]}><cylinderGeometry args={[.08,.08,.12,12]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[.31,-.02,.03]}><cylinderGeometry args={[.08,.08,.12,12]}/><meshStandardMaterial color={tone}/></mesh></group>}
function Tablet({color}:{color:string}){return <group position={[0,.98,.38]} rotation={[.10,0,0]}><mesh><boxGeometry args={[.45,.06,.34]}/><meshStandardMaterial color="#26313b"/></mesh><mesh position={[0,.035,.01]}><boxGeometry args={[.34,.012,.24]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.2}/></mesh></group>}
function Hand({robot}:{robot:boolean}){return <mesh position={[0,-.52,.20]} castShadow><sphereGeometry args={[.095,10,10]}/><meshStandardMaterial color={robot?"#d9e7ed":"#efc1a3"}/></mesh>}
function Shoes(){return <group><mesh position={[-.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh><mesh position={[.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh></group>}
function WallBoard({resting}:{resting:boolean}){return <group position={[-.45,2.6,-6.46]}><mesh castShadow><boxGeometry args={[4.1,2.2,.12]}/><meshStandardMaterial color="#232a32"/></mesh><Html center position={[0,0,.09]} distanceFactor={12}><div className="worldBoard"><div className="wbHead">TODAY'S PIPELINE</div><div className="wbRow"><span>Research</span><b>✓</b></div><div className="wbRow"><span>Script</span><b>✓</b></div><div className="wbRow"><span>Scenes</span><b>12/30</b></div><div className="wbState" style={{color:resting?"#ffbf67":"#61e2a0"}}>{resting?"REST MODE":"PRODUCTION ACTIVE"}</div></div></Html></group>}
