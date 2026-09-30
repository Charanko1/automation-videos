"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import type { RefObject, MutableRefObject } from "react";
import * as THREE from "three";
import { OFFICE_CONFIG, BreakSpotId, WORKER_DESK_IDS, WorkerDeskId } from "../lib/officeConfig";

type Person = {
  id: string;
  name: string;
  role: string;
  provider: string;
  dept: string;
  color: string;
  state: string;
};

type AgentMode =
  | "WORKING"
  | "ANTICIPATE"
  | "STAND_UP"
  | "WALK"
  | "ARRIVE"
  | "ACTIVITY"
  | "WALK_BACK"
  | "SIT_DOWN";

type MicroAction = "NONE" | "STRETCH" | "SCRATCH" | "DRINK" | "LEAN" | "SHIFT" | "LOOK";

type BreakPlan = {
  wave: number;
  spot: BreakSpotId;
  duration: number;
};

const DESK_POSITIONS = OFFICE_CONFIG.desks.positions;
const WAYPOINTS: Record<string, THREE.Vector3> = {
  leftFront: new THREE.Vector3(OFFICE_CONFIG.corridors.leftX, 0, OFFICE_CONFIG.corridors.frontZ),
  leftBack: new THREE.Vector3(OFFICE_CONFIG.corridors.leftX, 0, OFFICE_CONFIG.corridors.backZ),
  leftRear: new THREE.Vector3(OFFICE_CONFIG.corridors.leftX, 0, OFFICE_CONFIG.corridors.rearZ),
  rightFront: new THREE.Vector3(OFFICE_CONFIG.corridors.rightX, 0, OFFICE_CONFIG.corridors.frontZ),
  rightBack: new THREE.Vector3(OFFICE_CONFIG.corridors.rightX, 0, OFFICE_CONFIG.corridors.backZ),
  rightRear: new THREE.Vector3(OFFICE_CONFIG.corridors.rightX, 0, OFFICE_CONFIG.corridors.rearZ),
};

const BREAK_PAIRS: Array<[number, number]> = [[0, 5], [1, 4], [2, 3]];
const BREAK_SPOT_ORDER: BreakSpotId[] = ["sofaLeft", "sofaRight", "snacks", "window"];

const walkingRegistry = new Map<string, THREE.Vector3>();

function seededRandom(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothDamp(current: number, target: number, damping: number, delta: number) {
  return THREE.MathUtils.damp(current, target, damping, delta);
}

function smoothStepByDistance(value: number, start: number, end: number) {
  if (end <= start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

function buildCurvedRoute(start: THREE.Vector3, spot: BreakSpotId, returnTrip = false) {
  const breakData = OFFICE_CONFIG.breakSpots[spot];
  const sideX = breakData.activity === "SNACK" || breakData.activity === "SOFA"
    ? OFFICE_CONFIG.corridors.rightX
    : OFFICE_CONFIG.corridors.leftX;

  const corridor = returnTrip
    ? [
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.rearZ),
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.backZ),
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.frontZ),
        start.clone(),
      ]
    : [
        start.clone(),
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.frontZ),
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.backZ),
        new THREE.Vector3(sideX, 0, OFFICE_CONFIG.corridors.rearZ),
        new THREE.Vector3(...breakData.pos),
      ];

  const curve = new THREE.CatmullRomCurve3(corridor, false, "centripetal", 0.28);
  const points = curve.getPoints(OFFICE_CONFIG.movement.pathPointCount);
  return {
    curve,
    points,
    length: curve.getLength(),
  };
}

function chooseBreakPlan(workerIndex: number, wave: number, random: () => number): BreakPlan {
  const pair = BREAK_PAIRS[wave % BREAK_PAIRS.length];
  const pairSlot = pair[0] === workerIndex ? 0 : pair[1] === workerIndex ? 1 : -1;
  const spot = BREAK_SPOT_ORDER[(wave * 2 + Math.max(0, pairSlot)) % BREAK_SPOT_ORDER.length];
  const duration = THREE.MathUtils.lerp(
    OFFICE_CONFIG.movement.breakDurationMin,
    OFFICE_CONFIG.movement.breakDurationMax,
    random(),
  );
  return { wave, spot, duration };
}

function isAllowedBreak(elapsed: number, workerIndex: number, personState: string) {
  if (personState !== "Idle") return null;
  if (elapsed < OFFICE_CONFIG.movement.firstBreakDelay) return null;

  const wave = Math.floor((elapsed - OFFICE_CONFIG.movement.firstBreakDelay) / OFFICE_CONFIG.movement.breakWaveInterval);
  const pair = BREAK_PAIRS[wave % BREAK_PAIRS.length];
  if (workerIndex !== pair[0] && workerIndex !== pair[1]) return null;

  const waveTime = (elapsed - OFFICE_CONFIG.movement.firstBreakDelay) % OFFICE_CONFIG.movement.breakWaveInterval;
  if (waveTime < 0 || waveTime > 17.5) return null;

  return wave;
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
      dpr={[1, 1.75]}
      camera={{ position: [12.5, 10.1, 13.9], fov: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#aeb8c4"]} />
      <fog attach="fog" args={["#aeb8c4", 23, 43]} />
      <ambientLight intensity={1.72} />
      <directionalLight
        castShadow
        position={[5.5, 13, 8]}
        intensity={2.55}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <pointLight position={[-6, 5.8, 1]} intensity={19} distance={16} color="#8bc4ff" />
      <pointLight position={[6, 5.5, -3]} intensity={20} distance={15} color="#ffd28f" />

      <OfficeShell />
      <Windows />
      <CeilingLights resting={resting} />
      <WorkFurniture />
      <BreakZone />
      <StatusBoard resting={resting} />

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
        target={[0, 1.85, 0]}
        minDistance={9.5}
        maxDistance={22}
        minPolarAngle={0.84}
        maxPolarAngle={1.52}
        enablePan
        enableDamping
        dampingFactor={0.075}
      />
    </Canvas>
  );
}

function OfficeShell() {
  return (
    <group>
      <mesh position={[0, -0.35, 0]} receiveShadow>
        <boxGeometry args={[18, 0.5, 14]} />
        <meshStandardMaterial color="#8b6646" roughness={0.96} />
      </mesh>
      <mesh position={[0, -0.07, 0]} receiveShadow>
        <boxGeometry args={[17.7, 0.12, 13.7]} />
        <meshStandardMaterial color="#b99068" roughness={1} />
      </mesh>
      <mesh position={[0, 3.75, -6.86]} receiveShadow>
        <boxGeometry args={[18, 7.5, 0.3]} />
        <meshStandardMaterial color="#d9cebb" roughness={1} />
      </mesh>
      <mesh position={[-8.86, 3.75, 0]} receiveShadow>
        <boxGeometry args={[0.3, 7.5, 14]} />
        <meshStandardMaterial color="#cfc2ac" roughness={1} />
      </mesh>
      <mesh position={[8.86, 3.75, 0]} receiveShadow>
        <boxGeometry args={[0.3, 7.5, 14]} />
        <meshStandardMaterial color="#cfc2ac" roughness={1} />
      </mesh>
      {Array.from({ length: 28 }).map((_, i) => (
        <mesh key={i} position={[-8.4 + i * 0.62, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.018, 13.25]} />
          <meshBasicMaterial color="#9e7855" transparent opacity={0.32} />
        </mesh>
      ))}
      {Array.from({ length: 23 }).map((_, i) => (
        <mesh key={i} position={[0, -0.008, -6.1 + i * 0.56]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[17.1, 0.018]} />
          <meshBasicMaterial color="#9e7855" transparent opacity={0.32} />
        </mesh>
      ))}
      <mesh position={[0, -0.02, 0.15]} receiveShadow>
        <boxGeometry args={[6.2, 0.04, 6.8]} />
        <meshStandardMaterial color="#c69b73" roughness={1} />
      </mesh>
    </group>
  );
}

function Windows() {
  return (
    <group>
      {[-6, -2, 2, 6].map((x) => (
        <group key={x} position={[x, 4.95, -6.55]}>
          <mesh castShadow><boxGeometry args={[3.42, 2.25, 0.09]} /><meshStandardMaterial color="#6a90a6" /></mesh>
          <mesh position={[0, 0, 0.055]}><boxGeometry args={[3.16, 1.98, 0.018]} /><meshBasicMaterial color="#d7edf6" /></mesh>
          <mesh position={[0, 0, 0.085]}><boxGeometry args={[0.06, 2.10, 0.018]} /><meshStandardMaterial color="#7a6b57" /></mesh>
          <mesh position={[0, 0, 0.085]}><boxGeometry args={[3.28, 0.06, 0.018]} /><meshStandardMaterial color="#7a6b57" /></mesh>
        </group>
      ))}
    </group>
  );
}

function CeilingLights({ resting }: { resting: boolean }) {
  const cols = ["#b8d7ff", "#fff0ca", "#d6c7ff", "#b9f3d9"];
  return (
    <group>
      {[-5.2, -1.7, 1.7, 5.2].map((x, i) => (
        <group key={x} position={[x, 6, -1.7]}>
          <mesh castShadow><boxGeometry args={[1.55, 0.08, 0.72]} /><meshStandardMaterial color="#f2ecdf" emissive={cols[i]} emissiveIntensity={resting ? 0.06 : 0.38} /></mesh>
          <pointLight intensity={resting ? 2.6 : 9} distance={6} color={cols[i]} />
        </group>
      ))}
    </group>
  );
}

function WorkFurniture() {
  return (
    <group>
      {WORKER_DESK_IDS.map((id) => <Desk key={id} position={DESK_POSITIONS[id]} />)}
      <Shelf position={[-7.1, -0.02, -5.55]} />
      <Printer position={[-7.0, -0.02, -3.15]} />
      <ServerRack position={[6.8, 0, -0.7]} />
    </group>
  );
}

function Desk({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[OFFICE_CONFIG.desks.width, 0.22, OFFICE_CONFIG.desks.depth]} radius={0.08} smoothness={2} position={[0, 1.45, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#684735" roughness={0.74} />
      </RoundedBox>
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
        <mesh key={`${x}${z}`} position={[x * 0.9, 0.66, z * 0.37]} castShadow>
          <boxGeometry args={[0.13, 1.55, 0.13]} /><meshStandardMaterial color="#432d22" />
        </mesh>
      )))}
      <Monitor position={[0, 0, 0]} />
      <Keyboard />
      <Mug />
      <PaperStack />
      <Lamp />
    </group>
  );
}

function Monitor() {
  const screenMat = useRef<THREE.MeshStandardMaterial>(null);
  const cursor = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (screenMat.current) screenMat.current.emissiveIntensity = 0.36 + Math.sin(state.clock.elapsedTime * OFFICE_CONFIG.visual.screenPulseSpeed) * 0.06;
    if (cursor.current) cursor.current.position.x = -0.36 + ((state.clock.elapsedTime * OFFICE_CONFIG.visual.screenCursorSpeed) % 0.68);
  });
  return (
    <group position={[0, 2.04, -0.22]}>
      <RoundedBox args={[1.12, 0.68, 0.10]} radius={0.04} smoothness={2} castShadow><meshStandardMaterial color="#0d1218" /></RoundedBox>
      <mesh position={[0, -0.02, 0.06]}><boxGeometry args={[0.89, 0.47, 0.02]} /><meshStandardMaterial ref={screenMat} color="#18323e" emissive="#4bc6ef" /></mesh>
      {[[-.30,.12],[0,.12],[.25,.12],[-.22,-.05],[.04,-.05],[.28,-.05]].map(([x,y],i)=><mesh key={i} position={[x,y,.075]}><boxGeometry args={[i<3?.17:.14,.035,.008]}/><meshBasicMaterial color={i===2?"#f5d36f":"#5ab9e5"}/></mesh>)}
      <mesh ref={cursor} position={[-.36, -0.14, 0.08]}><boxGeometry args={[.022,.06,.009]}/><meshBasicMaterial color="#f8f4dd"/></mesh>
      <mesh position={[0,-.57,0]}><boxGeometry args={[.11,.55,.11]}/><meshStandardMaterial color="#45515b"/></mesh>
      <mesh position={[0,-.84,0]}><boxGeometry args={[.68,.07,.31]}/><meshStandardMaterial color="#303841"/></mesh>
    </group>
  );
}
function Keyboard(){return <mesh position={[0,1.62,.18]} rotation={[-.02,0,0]}><boxGeometry args={[.86,.04,.28]}/><meshStandardMaterial color="#222830"/></mesh>}
function Mug(){return <mesh position={[-.78,1.66,.20]} castShadow><cylinderGeometry args={[.11,.12,.18,12]}/><meshStandardMaterial color="#ece4d7"/></mesh>}
function PaperStack(){return <group>{[0,.028,.056].map(y=><mesh key={y} position={[.67,1.61+y,.23]}><boxGeometry args={[.43,.024,.33]}/><meshStandardMaterial color="#f2eee7"/></mesh>)}</group>}
function Lamp(){return <group position={[.9,1.59,-.2]}><mesh position={[0,.25,0]}><cylinderGeometry args={[.035,.035,.5,8]}/><meshStandardMaterial color="#3b444d"/></mesh><mesh position={[0,.52,0]}><coneGeometry args={[.19,.20,12]}/><meshStandardMaterial color="#e7b85f" emissive="#704f1b" emissiveIntensity={.18}/></mesh></group>}

function BreakZone() {
  return (
    <group>
      <mesh position={[...OFFICE_CONFIG.breakZone.center]} rotation={[-Math.PI/2,0,0]} receiveShadow>
        <planeGeometry args={OFFICE_CONFIG.breakZone.size} />
        <meshStandardMaterial color="#756488" roughness={0.96} />
      </mesh>
      <mesh position={[4.65,0.01,-5.05]} rotation={[-Math.PI/2,0,0]}>
        <planeGeometry args={[6.55,2.55]} />
        <meshStandardMaterial color="#8f7a59" roughness={1} />
      </mesh>
      <Sofa />
      <VendingMachine position={[7.0,0,-3.85]} />
      <Plant position={[2.0,0,-5.35]} />
      <Plant position={[7.9,0,-5.15]} />
      <BreakCoffeeTable position={[5.2,0,-4.15]} />
    </group>
  );
}

function Sofa() {
  return <group position={[4.45,0,-5.18]}>
    <RoundedBox args={[3.4,.62,1.0]} radius={.18} smoothness={3} position={[0,.5,0]} castShadow><meshStandardMaterial color="#6d5974" roughness={.88}/></RoundedBox>
    <RoundedBox args={[.34,1.55,1.02]} radius={.12} smoothness={3} position={[-1.53,1.0,0]} castShadow><meshStandardMaterial color="#6d5974"/></RoundedBox>
    <RoundedBox args={[.34,1.55,1.02]} radius={.12} smoothness={3} position={[1.53,1.0,0]} castShadow><meshStandardMaterial color="#6d5974"/></RoundedBox>
    <RoundedBox args={[2.5,.76,.18]} radius={.08} smoothness={3} position={[0,1.02,-.40]} castShadow><meshStandardMaterial color="#725e79"/></RoundedBox>
  </group>;
}
function VendingMachine({position}:{position:[number,number,number]}){const screen=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(screen.current)screen.current.emissiveIntensity=.25+Math.sin(s.clock.elapsedTime*3)*.08});return <group position={position}><RoundedBox args={[.92,2.45,.72]} radius={.08} smoothness={2} castShadow><meshStandardMaterial color="#303942"/></RoundedBox><mesh position={[0,.28,.37]}><boxGeometry args={[.70,.96,.03]}/><meshStandardMaterial ref={screen} color="#15272f" emissive="#2b667a"/></mesh>{[-.22,0,.22].map((x,i)=><mesh key={i} position={[x,-.63,.39]}><boxGeometry args={[.13,.18,.04]}/><meshStandardMaterial color={["#ee8387","#efc86a","#6ac98e"][i]}/></mesh>)}<Html center position={[0,1.5,.16]} distanceFactor={15}><div className="prop-label">SNACKS</div></Html></group>}
function Plant({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><cylinderGeometry args={[.34,.42,.48,10]}/><meshStandardMaterial color="#a66f47"/></mesh>{[-.18,0,.18].map((x,i)=><mesh key={i} position={[x,.72,.02]} rotation={[0,0,(i-1)*.25]} castShadow><sphereGeometry args={[.23,.23,.52,12]}/><meshStandardMaterial color={["#62b578","#4ba66b","#78c887"][i]}/></mesh>)}</group>}
function BreakCoffeeTable({position}:{position:[number,number,number]}){return <group position={position}><mesh position={[0,.36,0]} castShadow><cylinderGeometry args={[.75,.72,.10,12]}/><meshStandardMaterial color="#6a4e3a"/></mesh><mesh position={[0,.12,0]}><cylinderGeometry args={[.10,.15,.45,10]}/><meshStandardMaterial color="#4c3425"/></mesh><mesh position={[-.2,.44,.02]}><cylinderGeometry args={[.09,.1,.15,10]}/><meshStandardMaterial color="#efe6dc"/></mesh></group>}
function Shelf({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1.3,3,.52]}/><meshStandardMaterial color="#513c2c"/></mesh>{[.8,.05,-.7].map(y=><mesh key={y} position={[0,y,.29]}><boxGeometry args={[1.18,.10,.08]}/><meshStandardMaterial color="#75533a"/></mesh>)}{[-.34,.02,.36].map((x,i)=><mesh key={i} position={[x,.4,.34]}><boxGeometry args={[.18,.36,.10]}/><meshStandardMaterial color={["#eab45b","#70b8df","#d67faa"][i]}/></mesh>)}</group>}
function Printer({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1,.8,.78]}/><meshStandardMaterial color="#4b555e"/></mesh><mesh position={[0,.44,.04]}><boxGeometry args={[.72,.05,.45]}/><meshStandardMaterial color="#ebeff2"/></mesh><mesh position={[0,-.05,.41]}><boxGeometry args={[.52,.35,.05]}/><meshStandardMaterial color="#22282e"/></mesh></group>}
function ServerRack({position,running}:{position:[number,number,number];running:boolean}){const m=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(m.current)m.current.emissiveIntensity=running?.55+Math.sin(s.clock.elapsedTime*6)*.18:.08});return <group position={position}><mesh castShadow><boxGeometry args={[1.1,2.1,.72]}/><meshStandardMaterial color="#232b33"/></mesh>{[-.5,0,.5].map(y=><mesh key={y} position={[0,y,.38]}><boxGeometry args={[.72,.25,.02]}/><meshStandardMaterial ref={y===0?m:undefined} color="#1d3039" emissive="#59d6ff"/></mesh>)}</group>}

function WorkerCharacter({person,workerIndex,selected,running,globalResting}:{person:Person;workerIndex:number;selected:boolean;running:boolean;globalResting:boolean}){
  const actor=useRef<THREE.Group>(null);
  const body=useRef<THREE.Group>(null);
  const head=useRef<THREE.Group>(null);
  const armL=useRef<THREE.Group>(null);
  const armR=useRef<THREE.Group>(null);
  const legL=useRef<THREE.Group>(null);
  const legR=useRef<THREE.Group>(null);
  const chair=useRef<THREE.Group>(null);
  const label=useRef<HTMLDivElement>(null);
  const ring=useRef<THREE.Mesh>(null);

  const random = useMemo(()=>seededRandom((workerIndex+11)*8191),[workerIndex]);
  const stateRef=useRef<AgentMode>("WORKING");
  const microRef=useRef<{type:MicroAction;started:number;duration:number;next:number}>({type:"NONE",started:0,duration:0,next:2+random()*4});
  const planRef=useRef<BreakPlan|null>(null);
  const phaseRef=useRef(0);
  const routeRef=useRef<{curve:THREE.CatmullRomCurve3;length:number}|null>(null);
  const distanceRef=useRef(0);
  const targetQuaternion=useRef(new THREE.Quaternion());
  const targetEuler=useRef(new THREE.Euler());
  const speedMul=useMemo(()=>1- OFFICE_CONFIG.movement.speedVariance + random()*OFFICE_CONFIG.movement.speedVariance*2,[random]);
  const homeSeat=useMemo(()=>{
    const d=DESK_POSITIONS[person.id];
    return new THREE.Vector3(d[0],0,d[2]+OFFICE_CONFIG.desks.chairOffsetZ);
  },[person.id]);
  const standPos=useMemo(()=>homeSeat.clone().add(new THREE.Vector3(0,0,OFFICE_CONFIG.desks.chairPullOut)),[homeSeat]);

  const workerColor=person.color;
  const homeFacing=Math.PI;

  useFrame((state,delta)=>{
    if(!actor.current||!body.current||!head.current||!chair.current)return;
    const elapsed=state.clock.elapsedTime;
    const externalIdle=person.state==="Idle";

    if(globalResting){
      if(stateRef.current!=="WORKING" && stateRef.current!=="SIT_DOWN") {
        stateRef.current="WALK_BACK";
        if(!routeRef.current) routeRef.current=buildCurvedRoute(actor.current.position, planRef.current?.spot ?? "window", true);
        distanceRef.current=0;
        phaseRef.current=0;
      }
      if(stateRef.current==="WORKING") microRef.current.type="NONE";
    } else if(stateRef.current==="WORKING" && running && externalIdle){
      const allowedWave=isAllowedBreak(elapsed,workerIndex,person.state);
      if(allowedWave!==null){
        planRef.current=chooseBreakPlan(workerIndex,allowedWave,random);
        stateRef.current="ANTICIPATE";
        phaseRef.current=0;
      }
    }

    const mode=stateRef.current;

    if(mode==="WORKING"){
      const baseBob=Math.sin(elapsed*2*Math.PI*OFFICE_CONFIG.idle.breathingHz + workerIndex*.83)*OFFICE_CONFIG.idle.breathingAmplitude;
      body.position.y=smoothDamp(body.position.y,baseBob,8,delta);
      body.rotation.x=smoothDamp(body.rotation.x,.035,7,delta);

      if(externalIdle && running && elapsed>=microRef.current.next){
        const roll=random();
        const types:MicroAction[]=["STRETCH","SCRATCH","DRINK","LEAN","SHIFT","LOOK"];
        const weights=[
          OFFICE_CONFIG.idle.probabilities.stretch,
          OFFICE_CONFIG.idle.probabilities.scratch,
          OFFICE_CONFIG.idle.probabilities.drink,
          OFFICE_CONFIG.idle.probabilities.lean,
          OFFICE_CONFIG.idle.probabilities.shift,
          OFFICE_CONFIG.idle.probabilities.look,
        ];
        let sum=0; let picked:MicroAction=types[0];
        for(let i=0;i<types.length;i++){sum+=weights[i];if(roll<=sum){picked=types[i];break;}}
        microRef.current={type:picked,started:elapsed,duration:THREE.MathUtils.lerp(.7,2.0,random()),next:elapsed+THREE.MathUtils.lerp(OFFICE_CONFIG.idle.microMinSeconds,OFFICE_CONFIG.idle.microMaxSeconds,random())};
      }

      const action=microRef.current;
      const active=action.type!=="NONE" && elapsed-action.started<action.duration;
      const p=active?clamp01((elapsed-action.started)/action.duration):0;
      const e=OFFICE_CONFIG.easing.easeInOut(p);
      let headY=0, headX=0, bodyX=.035, bodyY=baseBob;
      let armLY=.18, armRY=-.18;
      let armLX=0, armRX=0;
      if(active){
        if(action.type==="LOOK"){headY=Math.sin(e*Math.PI)*OFFICE_CONFIG.idle.headTurnAmplitude;}
        if(action.type==="SCRATCH"){armLY=.75+Math.sin(e*Math.PI)*.12;armLX=-.65;}
        if(action.type==="DRINK"){armRY=-.9;armRX=.35;}
        if(action.type==="LEAN"){bodyX=.035+Math.sin(e*Math.PI)*-.11;}
        if(action.type==="SHIFT"){body.position.x=smoothDamp(body.position.x,Math.sin(e*Math.PI)*.10,10,delta);}
        if(action.type==="STRETCH"){armLX=-.62-Math.sin(e*Math.PI)*.22;armRX=.62+Math.sin(e*Math.PI)*.22;bodyX=.02-Math.sin(e*Math.PI)*.05;}
      }
      head.rotation.y=smoothDamp(head.rotation.y,headY,7,delta);
      head.rotation.x=smoothDamp(head.rotation.x,headX,7,delta);
      body.rotation.x=smoothDamp(body.rotation.x,bodyX,7,delta);
      if(action.type!=="SHIFT") body.position.x=smoothDamp(body.position.x,0,9,delta);

      const typePulse=active?Math.sin(e*Math.PI):0;
      armL.rotation.z=smoothDamp(armL.rotation.z,armLY+Math.sin(elapsed*OFFICE_CONFIG.idle.typingSpeed+workerIndex)*OFFICE_CONFIG.idle.typingAmplitude*(1-typePulse),10,delta);
      armR.rotation.z=smoothDamp(armR.rotation.z,armRY+Math.sin(elapsed*OFFICE_CONFIG.idle.typingSpeed*1.13+workerIndex*1.7+1)*OFFICE_CONFIG.idle.typingAmplitude*(1-typePulse),10,delta);

      actor.position.x=smoothDamp(actor.position.x,homeSeat.x,10,delta);
      actor.position.z=smoothDamp(actor.position.z,homeSeat.z,10,delta);
      actor.rotation.y=smoothDamp(actor.rotation.y,homeFacing,10,delta);

      chair.position.x=smoothDamp(chair.position.x,homeSeat.x,9,delta);
      chair.position.z=smoothDamp(chair.position.z,homeSeat.z,9,delta);
      chair.rotation.y=smoothDamp(chair.rotation.y,0,8,delta);
    }

    if(mode==="ANTICIPATE"){
      phaseRef.current+=delta;
      const t=clamp01(phaseRef.current/OFFICE_CONFIG.movement.anticipateDuration);
      const e=OFFICE_CONFIG.easing.easeInOut(t);
      body.rotation.x=smoothDamp(body.rotation.x,.11*Math.sin(e*Math.PI),8,delta);
      head.rotation.y=smoothDamp(head.rotation.y,.22*Math.sin(e*Math.PI),7,delta);
      chair.position.x=smoothDamp(chair.position.x,homeSeat.x+OFFICE_CONFIG.desks.chairPullOut*.38*e,10,delta);
      chair.position.z=smoothDamp(chair.position.z,homeSeat.z+OFFICE_CONFIG.desks.chairPullOut*.18*e,10,delta);
      chair.rotation.y=smoothDamp(chair.rotation.y,OFFICE_CONFIG.desks.chairTurn*e,8,delta);
      if(t>=1){stateRef.current="STAND_UP";phaseRef.current=0;}
    }

    if(mode==="STAND_UP"){
      phaseRef.current+=delta;
      const t=clamp01(phaseRef.current/OFFICE_CONFIG.movement.standUpDuration);
      const e=OFFICE_CONFIG.easing.easeInOut(t);
      actor.position.lerpVectors(homeSeat,standPos,e);
      body.position.y=smoothDamp(body.position.y,.18*e,10,delta);
      body.rotation.x=smoothDamp(body.rotation.x,.04-.10*e,8,delta);
      legL.rotation.x=smoothDamp(legL.rotation.x,.18*(1-e),7,delta);
      legR.rotation.x=smoothDamp(legR.rotation.x,.18*(1-e),7,delta);
      armL.rotation.z=smoothDamp(armL.rotation.z,.05,8,delta);
      armR.rotation.z=smoothDamp(armR.rotation.z,-.05,8,delta);
      chair.position.x=smoothDamp(chair.position.x,homeSeat.x,12,delta);
      chair.position.z=smoothDamp(chair.position.z,homeSeat.z+OFFICE_CONFIG.desks.chairPullOut,12,delta);
      chair.rotation.y=smoothDamp(chair.rotation.y,OFFICE_CONFIG.desks.chairTurn,10,delta);
      if(t>=1){
        if(planRef.current){
          routeRef.current=buildCurvedRoute(standPos,planRef.current.spot,false);
          distanceRef.current=0;
        }
        stateRef.current="WALK";
        phaseRef.current=0;
      }
    }

    if(mode==="WALK" || mode==="WALK_BACK"){
      const route=routeRef.current;
      if(!route){stateRef.current=mode==="WALK"?"ARRIVE":"SIT_DOWN";phaseRef.current=0;}
      else{
        const total=route.length;
        const u=clamp01(distanceRef.current/Math.max(total,.001));
        const accel=OFFICE_CONFIG.movement.accelerationFraction;
        const decel=OFFICE_CONFIG.movement.decelerationFraction;
        const accelFactor=OFFICE_CONFIG.easing.smoother(clamp01(u/accel));
        const decelFactor=OFFICE_CONFIG.easing.smoother(clamp01((1-u)/decel));
        const speedFactor=Math.max(.18,Math.min(1,accelFactor*decelFactor));
        distanceRef.current=Math.min(total,distanceRef.current+OFFICE_CONFIG.movement.walkSpeed*speedMul*speedFactor*delta);

        const nu=clamp01(distanceRef.current/Math.max(total,.001));
        const target=route.curve.getPointAt(nu);
        const tangent=route.curve.getTangentAt(nu).normalize();
        actor.position.lerp(target,Math.min(1,OFFICE_CONFIG.movement.moveDamping*delta));
        const yaw=Math.atan2(tangent.x,tangent.z);
        actor.rotation.y=smoothDamp(actor.rotation.y,yaw,OFFICE_CONFIG.movement.turnDamping,delta);

        const remaining=1-nu;
        const stepPhase=Math.sin(elapsed*OFFICE_CONFIG.walking.strideSpeed+workerIndex*1.7);
        const bob=Math.abs(stepPhase)*OFFICE_CONFIG.walking.bobAmplitude;
        body.position.y=smoothDamp(body.position.y,bob,11,delta);
        body.rotation.x=smoothDamp(body.rotation.x,OFFICE_CONFIG.walking.lean*(tangent.x),8,delta);
        legL.rotation.x=smoothDamp(legL.rotation.x,stepPhase*OFFICE_CONFIG.walking.footSwing,14,delta);
        legR.rotation.x=smoothDamp(legR.rotation.x,-stepPhase*OFFICE_CONFIG.walking.footSwing,14,delta);
        armL.rotation.x=smoothDamp(armL.rotation.x,-stepPhase*OFFICE_CONFIG.walking.armSwing,14,delta);
        armR.rotation.x=smoothDamp(armR.rotation.x,stepPhase*OFFICE_CONFIG.walking.armSwing,14,delta);

        const separation=new THREE.Vector3();
        walkingRegistry.set(person.id,actor.position.clone());
        walkingRegistry.forEach((otherPos,otherId)=>{
          if(otherId===person.id)return;
          const away=new THREE.Vector3().subVectors(actor.position,otherPos); away.y=0;
          const d=away.length();
          if(d>0 && d<OFFICE_CONFIG.walking.separationRadius){separation.add(away.normalize().multiplyScalar((OFFICE_CONFIG.walking.separationRadius-d)/OFFICE_CONFIG.walking.separationRadius));}
        });
        if(separation.lengthSq()>0) actor.position.addScaledVector(separation,OFFICE_CONFIG.walking.separationStrength*delta*4);

        if(remaining<=0.001){
          walkingRegistry.delete(person.id);
          if(mode==="WALK"){stateRef.current="ARRIVE";phaseRef.current=0;}
          else {stateRef.current="SIT_DOWN";phaseRef.current=0;}
        }
      }
    } else {
      walkingRegistry.delete(person.id);
    }

    if(stateRef.current==="ARRIVE"){
      phaseRef.current+=delta;
      const t=clamp01(phaseRef.current/OFFICE_CONFIG.movement.arriveDuration);
      const e=OFFICE_CONFIG.easing.easeInOut(t);
      const spot=planRef.current?OFFICE_CONFIG.breakSpots[planRef.current.spot]:OFFICE_CONFIG.breakSpots.window;
      actor.rotation.y=smoothDamp(actor.rotation.y,spot.facing,10,delta);
      actor.position.y=smoothDamp(actor.position.y,0.035*Math.sin(e*Math.PI),10,delta);
      if(t>=1){stateRef.current="ACTIVITY";phaseRef.current=0;}
    }

    if(stateRef.current==="ACTIVITY"){
      phaseRef.current+=delta;
      const spot=planRef.current?OFFICE_CONFIG.breakSpots[planRef.current.spot]:OFFICE_CONFIG.breakSpots.window;
      const activity=spot.activity;
      actor.rotation.y=smoothDamp(actor.rotation.y,spot.facing,8,delta);
      body.rotation.x=smoothDamp(body.rotation.x,activity==="SOFA"?-.08:0,7,delta);
      body.position.y=smoothDamp(body.position.y,activity==="SOFA"?-.15:0,8,delta);

      if(activity==="SOFA"){
        armL.rotation.z=smoothDamp(armL.rotation.z,.28+Math.sin(elapsed*1.1+workerIndex)*.05,5,delta);
        armR.rotation.z=smoothDamp(armR.rotation.z,-.28+Math.sin(elapsed*.9+workerIndex)*.04,5,delta);
        head.rotation.y=smoothDamp(head.rotation.y,Math.sin(elapsed*.7+workerIndex)*.22,4,delta);
      } else if(activity==="SNACK"){
        armL.rotation.z=smoothDamp(armL.rotation.z,phaseRef.current<1.1?.65:.15,6,delta);
        armR.rotation.z=smoothDamp(armR.rotation.z,phaseRef.current>1.1?-.65:-.12,6,delta);
        head.rotation.x=smoothDamp(head.rotation.x,phaseRef.current>1.1?.10:0,5,delta);
      } else {
        head.rotation.y=smoothDamp(head.rotation.y,Math.sin(elapsed*.45+workerIndex)*.28,4,delta);
        armL.rotation.z=smoothDamp(armL.rotation.z,.14,4,delta);
        armR.rotation.z=smoothDamp(armR.rotation.z,-.14,4,delta);
      }

      const duration=planRef.current?.duration ?? OFFICE_CONFIG.movement.breakDurationMin;
      if(phaseRef.current>=duration){
        const targetSpot=planRef.current?.spot ?? "window";
        const returnRoute=buildCurvedRoute(actor.position,targetSpot,true);
        routeRef.current=returnRoute;
        distanceRef.current=0;
        stateRef.current="WALK_BACK";
        phaseRef.current=0;
      }
    }

    if(stateRef.current==="SIT_DOWN"){
      phaseRef.current+=delta;
      const t=clamp01(phaseRef.current/OFFICE_CONFIG.movement.sitDownDuration);
      const e=OFFICE_CONFIG.easing.easeInOut(t);
      actor.position.lerpVectors(standPos,homeSeat,e);
      body.position.y=smoothDamp(body.position.y,.0,9,delta);
      body.rotation.x=smoothDamp(body.rotation.x,.035,8,delta);
      legL.rotation.x=smoothDamp(legL.rotation.x,.18,8,delta);
      legR.rotation.x=smoothDamp(legR.rotation.x,.18,8,delta);
      chair.position.x=smoothDamp(chair.position.x,homeSeat.x,10,delta);
      chair.position.z=smoothDamp(chair.position.z,homeSeat.z,10,delta);
      chair.rotation.y=smoothDamp(chair.rotation.y,0,9,delta);
      actor.rotation.y=smoothDamp(actor.rotation.y,homeFacing,9,delta);
      if(t>=1){stateRef.current="WORKING";phaseRef.current=0;planRef.current=null;microRef.current.next=elapsed+THREE.MathUtils.lerp(4,10,random());}
    }

    const displayState = stateRef.current==="WORKING" ? "working"
      : stateRef.current==="ANTICIPATE"||stateRef.current==="STAND_UP"||stateRef.current==="WALK"||stateRef.current==="WALK_BACK" ? "walking"
      : stateRef.current==="ARRIVE"||stateRef.current==="ACTIVITY" ? "break" : "working";

    if(label.current){
      const stateText=label.current.querySelector(".state-text");
      const dot=label.current.querySelector(".state-dot") as HTMLElement|null;
      if(stateText)stateText.textContent=displayState;
      if(dot)dot.style.background=displayState==="working"?workerColor:displayState==="walking"?"#7aa4ff":"#ffbe67";
    }
    if(ring.current)ring.current.visible=selected;
  });

  return <group>
    <OfficeChair chairRef={chair} position={[homeSeat.x,0,homeSeat.z]} />
    <group ref={actor} position={homeSeat} rotation={[0,homeFacing,0]}>
      <group ref={body}>
        <RoundedBox args={[.84,.72,.58]} radius={.10} smoothness={3} position={[0,1.02,0]} castShadow>
          <meshStandardMaterial color={workerColor} roughness={.72}/>
        </RoundedBox>
        <group ref={head} position={[0,0,0]}>
          <RoundedBox args={[.64,.70,.61]} radius={.17} smoothness={4} position={[0,1.73,0]} castShadow>
            <meshStandardMaterial color={person.id==="gpt"?"#dceaf0":"#efc1a3"} roughness={.82}/>
          </RoundedBox>
          <Hair id={person.id}/>
          <Face robot={person.id==="gpt"}/>
        </group>
        <NeckAndCollar id={person.id}/>
        <Accessories id={person.id}/>
        <group ref={armL} position={[-.48,1.02,0]}><mesh position={[0,-.20,.20]} castShadow rotation={[0,0,.18]}><RoundedBox args={[.19,.58,.18]} radius={.07} smoothness={2}><meshStandardMaterial color={workerColor}/></RoundedBox></mesh><Hand/></group>
        <group ref={armR} position={[.48,1.02,0]}><mesh position={[0,-.20,.20]} castShadow rotation={[0,0,-.18]}><RoundedBox args={[.19,.58,.18]} radius={.07} smoothness={2}><meshStandardMaterial color={workerColor}/></RoundedBox></mesh><Hand/></group>
        <group ref={legL} position={[-.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><RoundedBox args={[.20,.68,.24]} radius={.06} smoothness={2}><meshStandardMaterial color="#303b47"/></RoundedBox></mesh></group>
        <group ref={legR} position={[.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><RoundedBox args={[.20,.68,.24]} radius={.06} smoothness={2}><meshStandardMaterial color="#303b47"/></RoundedBox></mesh></group>
        <Shoes/>
      </group>
      <mesh ref={ring} position={[0,OFFICE_CONFIG.visual.selectedRingY,0]} rotation={[-Math.PI/2,0,0]}>
        <ringGeometry args={[.93,1.07,48]}/><meshBasicMaterial color={workerColor} transparent opacity={.5}/>
      </mesh>
      <Html center position={[0,OFFICE_CONFIG.visual.labelHeight,0]} distanceFactor={12}>
        <div ref={label} className={`tag ${selected?"sel":""}`}><b>{person.name}</b><small>{person.role}</small><em><i className="state-dot" style={{background:workerColor}}/><span className="state-text">working</span></em></div>
      </Html>
    </group>
  </group>;
}

function OfficeChair({chairRef,position}:{chairRef:RefObject<THREE.Group>;position:[number,number,number]}){
  return <group ref={chairRef} position={position}>
    <RoundedBox args={[.95,.14,.76]} radius={.06} smoothness={2} position={[0,.64,0]} castShadow><meshStandardMaterial color="#3e4b59"/></RoundedBox>
    <RoundedBox args={[.95,1.10,.15]} radius={.06} smoothness={2} position={[0,1.18,-.30]} castShadow><meshStandardMaterial color="#455361"/></RoundedBox>
    <mesh position={[0,.26,0]}><cylinderGeometry args={[.06,.06,.55,8]}/><meshStandardMaterial color="#252b31"/></mesh>
    <mesh position={[-.28,.15,0]}><boxGeometry args={[.12,.18,.12]}/><meshStandardMaterial color="#252b31"/></mesh>
    <mesh position={[.28,.15,0]}><boxGeometry args={[.12,.18,.12]}/><meshStandardMaterial color="#252b31"/></mesh>
  </group>
}

function Hair({id}:{id:string}){const color=id==="wri"?"#7c4a27":id==="dira"?"#4a3b63":id==="gemi"?"#f4c7e8":"#28313b";return <group position={[0,2.06,0]}><RoundedBox args={[.67,.20,.63]} radius={.08} smoothness={2} castShadow><meshStandardMaterial color={color}/></RoundedBox>{(id==="rhea"||id==="vox")&&<mesh position={[0,.03,.27]} castShadow><boxGeometry args={[.48,.14,.10]}/><meshStandardMaterial color={color}/></mesh>}</group>}
function Face({robot}:{robot:boolean}){return robot?<mesh position={[0,1.72,.315]}><boxGeometry args={[.28,.08,.025]}/><meshBasicMaterial color="#55e0ff"/></mesh>:<><mesh position={[-.13,1.75,.30]}><sphereGeometry args={[.04,10,10]}/><meshBasicMaterial color="#111"/></mesh><mesh position={[.13,1.75,.30]}><sphereGeometry args={[.04,10,10]}/><meshBasicMaterial color="#111"/></mesh><mesh position={[0,1.63,.30]}><boxGeometry args={[.10,.025,.02]}/><meshBasicMaterial color="#7a4b46"/></mesh></>}
function NeckAndCollar({id}:{id:string}){const collar=id==="gpt"?"#b9d4df":id==="wri"?"#f3d091":id==="dira"?"#d7c1f3":"#e8edf2";return <mesh position={[0,1.34,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.22,.045,8,16,.9*Math.PI]}/><meshStandardMaterial color={collar}/></mesh>}
function Accessories({id}:{id:string}){if(id==="rhea"||id==="dira"||id==="vox")return <Headset tone={id==="dira"?"#c58aff":id==="vox"?"#ff8b94":"#74a7ff"}/>;if(id==="wri")return <group position={[0,.03,.22]}><mesh><boxGeometry args={[.30,.05,.18]}/><meshStandardMaterial color="#7c4a27"/></mesh></group>;if(id==="gemi")return <Tablet accessoryColor="#66dcae"/>;return <RobotBadge/>}
function Headset({tone}:{tone:string}){return <group position={[0,1.98,0]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[.36,.035,8,24,Math.PI]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[-.32,-.02,.02]}><cylinderGeometry args={[.09,.09,.11,12]}/><meshStandardMaterial color={tone}/></mesh><mesh position={[.32,-.02,.02]}><cylinderGeometry args={[.09,.09,.11,12]}/><meshStandardMaterial color={tone}/></mesh></group>}
function Tablet({accessoryColor}:{accessoryColor:string}){return <group position={[0,.98,.40]} rotation={[.10,0,0]}><RoundedBox args={[.45,.06,.34]} radius={.04} smoothness={2}><meshStandardMaterial color="#26313b"/></RoundedBox><mesh position={[0,.035,0]}><boxGeometry args={[.34,.012,.24]}/><meshStandardMaterial color={accessoryColor} emissive={accessoryColor} emissiveIntensity={.25}/></mesh></group>}
function RobotBadge(){return <mesh position={[0,1.03,.32]}><boxGeometry args={[.24,.16,.04]}/><meshStandardMaterial color="#65dfff" emissive="#65dfff" emissiveIntensity={.45}/></mesh>}
function Hand(){return <mesh position={[0,-.53,.20]} castShadow><sphereGeometry args={[.10,10,10]}/><meshStandardMaterial color="#efc1a3"/></mesh>}
function Shoes(){return <group><mesh position={[-.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh><mesh position={[.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh></group>}

function StatusBoard({resting}:{resting:boolean}){return <group position={[-.35,2.55,-6.44]}><mesh castShadow><boxGeometry args={[4.1,2.2,.12]}/><meshStandardMaterial color="#232a32"/></mesh><Html center position={[0,0,.09]} distanceFactor={12}><div className="worldBoard"><div className="wbHead">TODAY'S PIPELINE</div><div className="wbRow"><span>Research</span><b>✓</b></div><div className="wbRow"><span>Script</span><b>✓</b></div><div className="wbRow"><span>Scenes</span><b>12/30</b></div><div className="wbState" style={{color:resting?"#ffbf67":"#61e2a0"}}>{resting?"REST MODE":"PRODUCTION ACTIVE"}</div></div></Html></group>}
function NeonSign({resting}:{resting:boolean}){return <group/>}
