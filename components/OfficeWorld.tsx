"use client";

import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import * as THREE from "three";
import { OFFICE_CONFIG, BreakSpotId, WORKER_DESK_IDS } from "../lib/officeConfig";

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
  | "LEAVING_DESK"
  | "WALKING_TO_BREAK"
  | "BREAK_ACTIVITY"
  | "WALKING_BACK";

const DESK_POSITIONS: Record<string, [number, number, number]> = {
  rhea: [-5.6, 0, 2.05],
  wri: [0, 0, 2.05],
  dira: [5.6, 0, 2.05],
  gemi: [-5.6, 0, -2.65],
  gpt: [0, 0, -2.65],
  vox: [5.6, 0, -2.65],
};

// Simple waypoint graph. The central corridor stays open and the break area is in the rear.
const WAYPOINTS: Record<string, THREE.Vector3> = {
  c1: new THREE.Vector3(-5.6, 0, -0.35),
  c2: new THREE.Vector3(0, 0, -0.35),
  c3: new THREE.Vector3(5.6, 0, -0.35),
  rearL: new THREE.Vector3(-4.8, 0, 4.1),
  rearC: new THREE.Vector3(0, 0, 4.1),
  rearR: new THREE.Vector3(5.0, 0, 4.1),
};

const GRAPH: Record<string, string[]> = {
  c1: ["c2", "rearL"],
  c2: ["c1", "c3", "rearC"],
  c3: ["c2", "rearR"],
  rearL: ["c1", "rearC"],
  rearC: ["c2", "rearL", "rearR"],
  rearR: ["c3", "rearC"],
};

const BREAK_SPOT_NODES: Record<BreakSpotId, {node: string; pos: [number, number, number]; activity: "SOFA" | "SNACK" | "WINDOW"}> = {
  sofaLeft: { node: "rearL", pos: OFFICE_CONFIG.breakSpots.sofaLeft, activity: "SOFA" },
  sofaRight: { node: "rearC", pos: OFFICE_CONFIG.breakSpots.sofaRight, activity: "SOFA" },
  snacks: { node: "rearR", pos: OFFICE_CONFIG.breakSpots.snacks, activity: "SNACK" },
  window: { node: "rearL", pos: OFFICE_CONFIG.breakSpots.window, activity: "WINDOW" },
};

function makePath(startNode: string, endNode: string): string[] {
  if (startNode === endNode) return [startNode];
  const queue: string[] = [startNode];
  const cameFrom: Record<string, string | null> = { [startNode]: null };
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of GRAPH[current] ?? []) {
      if (cameFrom[next] !== undefined) continue;
      cameFrom[next] = current;
      if (next === endNode) {
        const result = [next];
        let p: string | null = current;
        while (p) {
          result.unshift(p);
          p = cameFrom[p] ?? null;
        }
        return result;
      }
      queue.push(next);
    }
  }
  return [endNode];
}

function deskNode(id: string) {
  if (id === "rhea" || id === "gemi") return "c1";
  if (id === "dira" || id === "vox") return "c3";
  return "c2";
}

function chooseBreakSpot(workerIndex: number, cycle: number): BreakSpotId {
  const order: BreakSpotId[] = ["sofaLeft", "snacks", "sofaRight", "window"];
  return order[(workerIndex + cycle) % order.length];
}

function getSchedule(elapsed: number, index: number) {
  if (elapsed < OFFICE_CONFIG.movement.breakStart) return null;
  const local = elapsed - OFFICE_CONFIG.movement.breakStart;
  const cycle = Math.floor(local / OFFICE_CONFIG.movement.cycleLength);
  const within = local % OFFICE_CONFIG.movement.cycleLength;
  const start = index * OFFICE_CONFIG.movement.breakStartSpacing;
  const activeWindow = OFFICE_CONFIG.movement.breakActivityDuration + 4.5;
  const rel = within - start;
  if (rel >= 0 && rel <= activeWindow) return { cycle, rel };
  return null;
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
      camera={{ position: [12.5, 10.4, 13.8], fov: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#aeb8c4"]} />
      <fog attach="fog" args={["#aeb8c4", 22, 42]} />
      <ambientLight intensity={1.7} />
      <directionalLight
        castShadow
        position={[6, 13, 8]}
        intensity={2.55}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <pointLight position={[-6, 6, 2]} intensity={22} distance={16} color="#8bc4ff" />
      <pointLight position={[5.5, 5.2, -1]} intensity={20} distance={15} color="#ffd18c" />

      <OfficeShell />
      <Windows />
      <CeilingLights resting={resting} />
      <WorkFurniture />
      <BreakZone />
      <StatusBoard resting={resting} />
      <NeonSign resting={resting} />

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
        target={[0, 1.9, 0]}
        minDistance={9.5}
        maxDistance={22}
        minPolarAngle={0.8}
        maxPolarAngle={1.52}
        enablePan
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

function OfficeShell() {
  return (
    <group>
      <mesh position={[0, -0.35, 0]} receiveShadow>
        <boxGeometry args={[18, 0.5, 14]} />
        <meshStandardMaterial color="#8b6646" roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.07, 0]} receiveShadow>
        <boxGeometry args={[17.7, 0.12, 13.7]} />
        <meshStandardMaterial color="#b98f68" roughness={1} />
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
      {Array.from({length: 28}).map((_,i)=><mesh key={`gx${i}`} position={[-8.4+i*.62,-.01,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.018,13.25]}/><meshBasicMaterial color="#9e7855" transparent opacity={.35}/></mesh>)}
      {Array.from({length: 23}).map((_,i)=><mesh key={`gz${i}`} position={[0,-.008,-6.1+i*.56]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[17.1,.018]}/><meshBasicMaterial color="#9e7855" transparent opacity={.35}/></mesh>)}
      <mesh position={[0,-.015,0.3]} receiveShadow>
        <boxGeometry args={[6.4,0.04,8.1]} />
        <meshStandardMaterial color="#c49a71" roughness={1} />
      </mesh>
    </group>
  );
}

function Windows() {
  return <group>{[-6,-2,2,6].map(x=><group key={x} position={[x,4.95,-6.55]}>
    <mesh castShadow><boxGeometry args={[3.45,2.25,.09]}/><meshStandardMaterial color="#6b91a8"/></mesh>
    <mesh position={[0,0,.055]}><boxGeometry args={[3.18,1.98,.018]}/><meshBasicMaterial color="#d6eef7"/></mesh>
    <mesh position={[0,0,.085]}><boxGeometry args={[.06,2.1,.018]}/><meshStandardMaterial color="#7a6b57"/></mesh>
    <mesh position={[0,0,.085]}><boxGeometry args={[3.28,.06,.018]}/><meshStandardMaterial color="#7a6b57"/></mesh>
  </group>)}</group>;
}

function CeilingLights({resting}:{resting:boolean}) {
  const cols = ["#b8d7ff","#fff0c9","#d4c6ff","#b8f2d8"];
  return <group>{[-5.2,-1.7,1.7,5.2].map((x,i)=><group key={x} position={[x,6.0,-2.0]}>
    <mesh castShadow><boxGeometry args={[1.55,.08,.72]}/><meshStandardMaterial color="#f2ecdf" emissive={cols[i]} emissiveIntensity={resting?.05:.36}/></mesh>
    <pointLight intensity={resting?2.5:9} distance={6} color={cols[i]}/>
  </group>)}</group>;
}

function WorkFurniture() {
  return <group>
    {WORKER_DESK_IDS.map(id=><Desk key={id} position={DESK_POSITIONS[id]}/>) }
    <Shelf position={[-7.15,-.02,-5.75]}/>
    <Printer position={[-7.0,-.02,-3.15]}/>
    <ServerRack position={[6.8,0,-5.65]}/>
  </group>;
}

function Desk({position}:{position:[number,number,number]}) {
  return <group position={position}>
    <RoundedBox args={[2.6,.22,1.2]} radius={.08} smoothness={2} position={[0,1.45,0]} castShadow>
      <meshStandardMaterial color="#684735" roughness={.75}/>
    </RoundedBox>
    {[-1,1].flatMap(a=>[-1,1].map(b=><mesh key={`${a}${b}`} position={[a*.9,.66,b*.37]} castShadow><boxGeometry args={[.13,1.55,.13]}/><meshStandardMaterial color="#432d22"/></mesh>))}
    <Monitor/>
    <Keyboard/>
    <Mug/>
    <PaperStack/>
    <Lamp/>
  </group>;
}

function Monitor(){const mat=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(mat.current)mat.current.emissiveIntensity=.48+Math.sin(s.clock.elapsedTime*2.3)*.08});return <group position={[0,2.04,-.22]}>
  <RoundedBox args={[1.12,.68,.10]} radius={.04} smoothness={2} castShadow><meshStandardMaterial color="#0d1218"/></RoundedBox>
  <mesh position={[0,-.02,.06]}><boxGeometry args={[.89,.47,.02]}/><meshStandardMaterial ref={mat} color="#1b3744" emissive="#4bc6ef"/></mesh>
  <mesh position={[0,-.57,0]}><boxGeometry args={[.11,.55,.11]}/><meshStandardMaterial color="#45515b"/></mesh>
  <mesh position={[0,-.84,0]}><boxGeometry args={[.68,.07,.31]}/><meshStandardMaterial color="#303841"/></mesh>
</group>}
function Keyboard(){return <mesh position={[0,1.61,.18]} rotation={[-.02,0,0]}><boxGeometry args={[.86,.04,.28]}/><meshStandardMaterial color="#222830"/></mesh>}
function Mug(){return <mesh position={[-.78,1.66,.2]} castShadow><cylinderGeometry args={[.11,.12,.18,12]}/><meshStandardMaterial color="#ece4d7"/></mesh>}
function PaperStack(){return <group>{[0,.028,.056].map(y=><mesh key={y} position={[.67,1.61+y,.23]}><boxGeometry args={[.43,.024,.33]}/><meshStandardMaterial color="#f2eee7"/></mesh>)}</group>}
function Lamp(){return <group position={[.9,1.59,-.2]}><mesh position={[0,.25,0]}><cylinderGeometry args={[.035,.035,.5,8]}/><meshStandardMaterial color="#3b444d"/></mesh><mesh position={[0,.52,0]}><coneGeometry args={[.19,.20,12]}/><meshStandardMaterial color="#e7b85f" emissive="#704f1b" emissiveIntensity={.18}/></mesh></group>}

function BreakZone(){return <group>
  <group position={[0,0,4.55]}>
    <RoundedBox args={[3.2,.65,1.05]} radius={.18} smoothness={3} position={[-1.55,.5,0]} castShadow><meshStandardMaterial color="#6f5b74" roughness={.9}/></RoundedBox>
    <RoundedBox args={[.36,1.55,1.05]} radius={.12} smoothness={3} position={[-3.0,1.0,0]} castShadow><meshStandardMaterial color="#6f5b74"/></RoundedBox>
    <RoundedBox args={[.36,1.55,1.05]} radius={.12} smoothness={3} position={[-.10,1.0,0]} castShadow><meshStandardMaterial color="#6f5b74"/></RoundedBox>
    <RoundedBox args={[1.8,.65,1.05]} radius={.18} smoothness={3} position={[1.45,.5,0]} castShadow><meshStandardMaterial color="#6f5b74" roughness={.9}/></RoundedBox>
    <mesh position={[.15,.47,0]} castShadow><boxGeometry args={[1.95,.08,.84]}/><meshStandardMaterial color="#4f4154"/></mesh>
    <mesh position={[.15,.55,0]}><boxGeometry args={[.9,.03,.48]}/><meshStandardMaterial color="#d9b160" emissive="#6c4d1a" emissiveIntensity={.18}/></mesh>
  </group>
  <VendingMachine position={[6.7,0,4.15]}/>
  <Plant position={[-6.15,-.02,4.5]}/>
  <FishTank position={[6.6,0,-.1]}/>
  <mesh position={[0,.12,5.65]}><boxGeometry args={[6.7,.06,2.05]}/><meshStandardMaterial color="#a58467" transparent opacity={.18}/></mesh>
</group>}

function VendingMachine({position}:{position:[number,number,number]}){return <group position={position}>
  <RoundedBox args={[.92,2.45,.72]} radius={.08} smoothness={2} castShadow><meshStandardMaterial color="#303942"/></RoundedBox>
  <mesh position={[0,.28,.37]}><boxGeometry args={[.70,.96,.03]}/><meshStandardMaterial color="#15272f" emissive="#2b667a" emissiveIntensity={.18}/></mesh>
  {[-.22,0,.22].map((x,i)=><mesh key={i} position={[x,-.63,.39]}><boxGeometry args={[.13,.18,.04]}/><meshStandardMaterial color={['#ee8387','#efc86a','#6ac98e'][i]}/></mesh>)}
  <Html center position={[0,1.46,.13]} distanceFactor={15}><div className="prop-label">SNACKS</div></Html>
</group>}
function Plant({position}:{position:[number,number,number]}){return <group position={position}>
  <mesh castShadow><cylinderGeometry args={[.34,.42,.48,10]}/><meshStandardMaterial color="#a66f47"/></mesh>
  {[-.18,0,.18].map((x,i)=><mesh key={i} position={[x,.72,.02]} rotation={[0,0,(i-1)*.25]} castShadow><sphereGeometry args={[.23,.23,.52,12]}/><meshStandardMaterial color={['#62b578','#4ba66b','#78c887'][i]}/></mesh>)}
</group>}
function FishTank({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1.55,1.45,.8]}/><meshPhysicalMaterial color="#6fc4de" transparent opacity={.23} transmission={.55} roughness={.10}/></mesh><mesh position={[0,-.54,0]}><boxGeometry args={[1.36,.36,.66]}/><meshStandardMaterial color="#8e7962"/></mesh><mesh position={[.22,0,.02]}><sphereGeometry args={[.10,10,10]}/><meshStandardMaterial color="#f3b54c"/></mesh><mesh position={[-.30,.04,.06]}><sphereGeometry args={[.08,10,10]}/><meshStandardMaterial color="#ed86a9"/></mesh></group>}
function Shelf({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1.3,3,.52]}/><meshStandardMaterial color="#513c2c"/></mesh>{[.8,.05,-.7].map(y=><mesh key={y} position={[0,y,.29]}><boxGeometry args={[1.18,.10,.08]}/><meshStandardMaterial color="#75533a"/></mesh>)}{[-.34,.02,.36].map((x,i)=><mesh key={i} position={[x,.4,.34]}><boxGeometry args={[.18,.36,.10]}/><meshStandardMaterial color={['#eab45b','#70b8df','#d67faa'][i]}/></mesh>)}</group>}
function Printer({position}:{position:[number,number,number]}){return <group position={position}><mesh castShadow><boxGeometry args={[1,.8,.78]}/><meshStandardMaterial color="#4b555e"/></mesh><mesh position={[0,.44,.04]}><boxGeometry args={[.72,.05,.45]}/><meshStandardMaterial color="#ebeff2"/></mesh><mesh position={[0,-.05,.41]}><boxGeometry args={[.52,.35,.05]}/><meshStandardMaterial color="#22282e"/></mesh></group>}
function ServerRack({position,running}:{position:[number,number,number];running:boolean}){const m=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(m.current)m.current.emissiveIntensity=running?.50+Math.sin(s.clock.elapsedTime*6)*.18:.08});return <group position={position}><mesh castShadow><boxGeometry args={[1.1,2.1,.72]}/><meshStandardMaterial color="#232b33"/></mesh>{[-.5,0,.5].map(y=><mesh key={y} position={[0,y,.38]}><boxGeometry args={[.72,.25,.02]}/><meshStandardMaterial ref={y===0?m:undefined} color="#1d3039" emissive="#59d6ff"/></mesh>)}</group>}

function WorkerCharacter({person,workerIndex,selected,running,globalResting}:{person:Person;workerIndex:number;selected:boolean;running:boolean;globalResting:boolean}){
  const root=useRef<THREE.Group>(null);
  const chair=useRef<THREE.Group>(null);
  const body=useRef<THREE.Group>(null);
  const armL=useRef<THREE.Group>(null);
  const armR=useRef<THREE.Group>(null);
  const legL=useRef<THREE.Group>(null);
  const legR=useRef<THREE.Group>(null);
  const label=useRef<HTMLDivElement>(null);
  const ring=useRef<THREE.Mesh>(null);
  const stateRef=useRef<AgentMode>("WORKING");
  const phaseRef=useRef(0);
  const pathRef=useRef<THREE.Vector3[]>([]);
  const pathIndexRef=useRef(0);
  const breakSpotRef=useRef<BreakSpotId>(chooseBreakSpot(workerIndex,0));
  const startPosition=useMemo(()=>{const d=DESK_POSITIONS[person.id]; return new THREE.Vector3(d[0],d[1],d[2]+OFFICE_CONFIG.desks.chairOffsetZ)},[person.id]);
  const standingPosition=useMemo(()=>startPosition.clone(),[startPosition]);
  const targetQ=useMemo(()=>new THREE.Quaternion(),[]);

  useFrame((clockState,delta)=>{
    const stateClockElapsed = clockState.clock.elapsedTime;
    if(!root.current||!body.current)return;
    const elapsed=stateClockElapsed;
    const schedule=running&&!globalResting?getSchedule(elapsed,workerIndex):null;
    const current=stateRef.current;

    if(current==="WORKING" && schedule && schedule.rel < OFFICE_CONFIG.movement.leaveDuration){
      stateRef.current="LEAVING_DESK";
      phaseRef.current=0;
      breakSpotRef.current=chooseBreakSpot(workerIndex,schedule.cycle);
      pathRef.current=buildPath(person.id,breakSpotRef.current);
      pathIndexRef.current=0;
    }

    if(globalResting){
      stateRef.current="WORKING";
      phaseRef.current=0;
      root.current.position.lerp(startPosition,.08);
      root.current.quaternion.slerp(targetQ.setFromEuler(new THREE.Euler(0,Math.PI,0)),.10);
      body.current.rotation.x=THREE.MathUtils.lerp(body.current.rotation.x,0,.12);
      if(label.current) label.current.querySelector(".state-text")!.textContent="resting";
    }

    const state=stateRef.current;
    if(state==="LEAVING_DESK"){
      phaseRef.current+=delta/OFFICE_CONFIG.movement.leaveDuration;
      const t=THREE.MathUtils.smoothstep(Math.min(1,phaseRef.current),0,1);
      root.current.position.lerpVectors(startPosition,standingPosition,t);
      body.current.position.y=THREE.MathUtils.lerp(body.current.position.y, .12*t,.18);
      body.current.rotation.x=THREE.MathUtils.lerp(body.current.rotation.x,.08*t,.18);
      chair.current.position.z=THREE.MathUtils.lerp(chair.current.position.z,.55*t,.18);
      if(phaseRef.current>=1){stateRef.current="WALKING_TO_BREAK";phaseRef.current=0;}
    } else if(state==="WALKING_TO_BREAK"||state==="WALKING_BACK"){
      moveAlongPath(root.current, pathRef.current, pathIndexRef, delta, targetQ);
      chair.current.position.z=THREE.MathUtils.lerp(chair.current.position.z,.55,.18);
      animateWalk(body.current,armL.current,armR.current,legL.current,legR.current,elapsed,workerIndex);
      if(pathIndexRef.current>=pathRef.current.length){
        if(state==="WALKING_TO_BREAK"){
          stateRef.current="BREAK_ACTIVITY";phaseRef.current=0;
        } else {
          stateRef.current="WORKING";phaseRef.current=0;
          chair.current.position.z=0;
          root.current.rotation.y=Math.PI;
        }
      }
    } else if(state==="BREAK_ACTIVITY"){
      phaseRef.current+=delta;
      const spot=BREAK_SPOT_NODES[breakSpotRef.current];
      root.current.position.x=THREE.MathUtils.lerp(root.current.position.x,spot.pos[0],.12);
      root.current.position.z=THREE.MathUtils.lerp(root.current.position.z,spot.pos[2],.12);
      root.current.rotation.y=THREE.MathUtils.lerp(root.current.rotation.y, spot.activity==="SNACK"?0:Math.PI,.08);
      animateBreak(body.current,armL.current,armR.current,legL.current,legR.current,elapsed,spot.activity);
      if(phaseRef.current>=OFFICE_CONFIG.movement.breakActivityDuration){
        stateRef.current="WALKING_BACK";phaseRef.current=0;
        pathRef.current=buildReturnPath(person.id, breakSpotRef.current);
        pathIndexRef.current=0;
      }
    } else {
      root.current.position.lerp(startPosition,.12);
      root.current.rotation.y=THREE.MathUtils.lerp(root.current.rotation.y,Math.PI,.10);
      chair.current.position.z=THREE.MathUtils.lerp(chair.current.position.z,0,.12);
      const breathe=Math.sin(elapsed*OFFICE_CONFIG.visual.breatheSpeed+workerIndex)*.018;
      body.current.position.y=THREE.MathUtils.lerp(body.current.position.y,breathe,.12);
      body.current.rotation.x=THREE.MathUtils.lerp(body.current.rotation.x,.045,.10);
      animateWork(armL.current,armR.current,body.current,elapsed,workerIndex);
      if(legL.current)legL.current.rotation.x=THREE.MathUtils.lerp(legL.current.rotation.x,.20,.12);
      if(legR.current)legR.current.rotation.x=THREE.MathUtils.lerp(legR.current.rotation.x,.20,.12);
    }

    if(label.current){
      const display = stateRef.current==="WORKING"?"working":stateRef.current.includes("WALKING")||stateRef.current==="LEAVING_DESK"?"walking":"break";
      const stateText=label.current.querySelector(".state-text"); if(stateText) stateText.textContent=display;
      const dot=label.current.querySelector(".state-dot") as HTMLElement | null; if(dot) dot.style.background=display==="working"?person.color:display==="walking"?"#7aa4ff":"#ffbe67";
    }
    if(ring.current) ring.current.visible=selected;
  });

  return <group ref={root} position={startPosition} rotation={[0,Math.PI,0]}>
    <OfficeChair chairRef={chair}/>
    <group ref={body} position={[0,0,0]}>
      <RoundedBox args={[.84,.72,.58]} radius={.10} smoothness={3} position={[0,1.03,0]} castShadow><meshStandardMaterial color={person.color} roughness={.72}/></RoundedBox>
      <RoundedBox args={[.62,.68,.60]} radius={.16} smoothness={3} position={[0,1.72,0]} castShadow><meshStandardMaterial color={person.id==="gpt"?"#dceaf0":"#efc0a1"} roughness={.85}/></RoundedBox>
      <Hair id={person.id}/><Face robot={person.id==="gpt"}/><Accessories id={person.id}/><NeckAndCollar id={person.id}/>
      <group ref={armL} position={[-.48,1.05,0]}><mesh position={[0,-.20,.18]} rotation={[0,0,.18]} castShadow><boxGeometry args={[.18,.58,.18]}/><meshStandardMaterial color={person.color}/></mesh></group>
      <group ref={armR} position={[.48,1.05,0]}><mesh position={[0,-.20,.18]} rotation={[0,0,-.18]} castShadow><boxGeometry args={[.18,.58,.18]}/><meshStandardMaterial color={person.color}/></mesh></group>
      <group ref={legL} position={[-.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><boxGeometry args={[.20,.68,.24]}/><meshStandardMaterial color="#303b47"/></mesh></group>
      <group ref={legR} position={[.21,.62,-.02]}><mesh position={[0,-.25,.08]} castShadow><boxGeometry args={[.20,.68,.24]}/><meshStandardMaterial color="#303b47"/></mesh></group>
      <Shoes/>
    </group>
    <Html center position={[0,2.62,0]} distanceFactor={OFFICE_CONFIG.labels.visibleDistance}>
      <div ref={label} className={`tag ${selected?"sel":""}`}><b>{person.name}</b><small>{person.role}</small><em><i className="state-dot" style={{background:person.color}}/><span className="state-text">working</span></em></div>
    </Html>
    <mesh ref={ring} position={[0,.025,0]} rotation={[-Math.PI/2,0,0]} visible={selected}><ringGeometry args={[.93,1.08,48]}/><meshBasicMaterial color={person.color} transparent opacity={.55}/></mesh>
  </group>;
}

const OfficeChair = ({chairRef}:{chairRef: RefObject<THREE.Group>}) => <group ref={chairRef} position={[0,0,0]}>
  <RoundedBox args={[.95,.14,.76]} radius={.06} smoothness={2} position={[0,.64,0]} castShadow><meshStandardMaterial color="#3e4b59"/></RoundedBox>
  <RoundedBox args={[.95,1.10,.15]} radius={.06} smoothness={2} position={[0,1.18,-.30]} castShadow><meshStandardMaterial color="#455361"/></RoundedBox>
  <mesh position={[0,.26,0]}><cylinderGeometry args={[.06,.06,.55,8]}/><meshStandardMaterial color="#252b31"/></mesh>
  <mesh position={[-.28,.15,0]}><boxGeometry args={[.12,.18,.12]}/><meshStandardMaterial color="#252b31"/></mesh>
  <mesh position={[.28,.15,0]}><boxGeometry args={[.12,.18,.12]}/><meshStandardMaterial color="#252b31"/></mesh>
</group>;

function Hair({id}:{id:string}){
  const color=id==="wri"?"#7c4a27":id==="dira"?"#4a3b63":id==="gemi"?"#f4c7e8":"#28313b";
  return <group position={[0,2.06,0]}>
    <RoundedBox args={[.67,.20,.63]} radius={.08} smoothness={2} castShadow><meshStandardMaterial color={color} roughness={.9}/></RoundedBox>
    {(id==="rhea"||id==="vox")&&<mesh position={[0,.03,.27]} castShadow><boxGeometry args={[.48,.14,.10]}/><meshStandardMaterial color={color}/></mesh>}
  </group>
}
function Face({robot}:{robot:boolean}){return robot?<mesh position={[0,1.72,.315]}><boxGeometry args={[.28,.08,.025]}/><meshBasicMaterial color="#55e0ff"/></mesh>:<>
  <mesh position={[-.13,1.75,.30]}><sphereGeometry args={[.04,10,10]}/><meshBasicMaterial color="#111"/></mesh>
  <mesh position={[.13,1.75,.30]}><sphereGeometry args={[.04,10,10]}/><meshBasicMaterial color="#111"/></mesh>
  <mesh position={[0,1.63,.30]}><boxGeometry args={[.10,.025,.02]}/><meshBasicMaterial color="#7a4b46"/></mesh>
</>}
function Shoes(){return <group><mesh position={[-.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh><mesh position={[.22,.10,.18]} castShadow><boxGeometry args={[.24,.15,.38]}/><meshStandardMaterial color="#1e252b"/></mesh></group>}

function animateWork(a1:THREE.Group|null,a2:THREE.Group|null,body:THREE.Group,elapsed:number,index:number){
  const s=Math.sin(elapsed*OFFICE_CONFIG.visual.typingSpeed+index)*.09;
  if(a1)a1.rotation.z=.18+s;
  if(a2)a2.rotation.z=-.18-s;
  body.rotation.y=Math.sin(elapsed*1.5+index)*.012;
}
function animateWalk(body:THREE.Group|null,a1:THREE.Group|null,a2:THREE.Group|null,l1:THREE.Group|null,l2:THREE.Group|null,elapsed:number,index:number){
  const swing=Math.sin(elapsed*OFFICE_CONFIG.visual.walkBobSpeed+index)*OFFICE_CONFIG.visual.footSwing;
  if(l1)l1.rotation.x=swing;
  if(l2)l2.rotation.x=-swing;
  if(a1)a1.rotation.x=-swing*.55;
  if(a2)a2.rotation.x=swing*.55;
  if(body)body.position.y=Math.abs(Math.sin(elapsed*OFFICE_CONFIG.visual.walkBobSpeed+index))*.035;
}
function animateBreak(body:THREE.Group,a1:THREE.Group|null,a2:THREE.Group|null,l1:THREE.Group|null,l2:THREE.Group|null,elapsed:number,activity:"SOFA"|"SNACK"|"WINDOW"){
  const b=Math.sin(elapsed*1.7)*.018;
  const sitting=activity==="SOFA";
  body.position.y=THREE.MathUtils.lerp(body.position.y, sitting ? -.16+b : b, .15);
  body.rotation.y=activity==="SNACK"?0:Math.sin(elapsed*.8)*.025;
  if(a1)a1.rotation.z=activity==="SNACK"?Math.sin(elapsed*5)*.18:.24;
  if(a2)a2.rotation.z=activity==="SNACK"?Math.sin(elapsed*5+1)*.18:-.24;
  if(l1)l1.rotation.x=THREE.MathUtils.lerp(l1.rotation.x,sitting?.45:0,.14);
  if(l2)l2.rotation.x=THREE.MathUtils.lerp(l2.rotation.x,sitting?.45:0,.14);
}
function buildPath(id:string,spot:BreakSpotId) {
  const start=deskNode(id);
  const end=BREAK_SPOT_NODES[spot].node;
  const nodes=makePath(start,end);
  return nodes.map(n=>WAYPOINTS[n].clone()).concat([new THREE.Vector3(...BREAK_SPOT_NODES[spot].pos)]);
}
function buildReturnPath(id:string,spot:BreakSpotId) {
  const start=BREAK_SPOT_NODES[spot].node;
  const end=deskNode(id);
  const nodes=makePath(start,end);
  const home=DESK_POSITIONS[id];
  return nodes.map(n=>WAYPOINTS[n].clone()).concat([new THREE.Vector3(home[0],0,home[2]+OFFICE_CONFIG.desks.chairOffsetZ)]);
}
function moveAlongPath(root:THREE.Group,path:THREE.Vector3[],indexRef:MutableRefObject<number>,delta:number,targetQ:THREE.Quaternion){
  if(!path.length||indexRef.current>=path.length)return;
  const target=path[indexRef.current]; const pos=root.position; const dir=new THREE.Vector3().subVectors(target,pos); dir.y=0; const distance=dir.length();
  if(distance<.13){indexRef.current+=1;return;}
  const step=Math.min(distance,OFFICE_CONFIG.movement.walkSpeed*delta); dir.normalize(); pos.addScaledVector(dir,step);
  targetQ.setFromUnitVectors(new THREE.Vector3(0,0,1),dir); root.quaternion.slerp(targetQ,Math.min(1,OFFICE_CONFIG.movement.turnSpeed*delta));
}

function NeckAndCollar({id}:{id:string}) {
  const collar = id === "gpt" ? "#b9d4df" : id === "wri" ? "#f3d091" : id === "dira" ? "#d7c1f3" : "#e8edf2";
  return <mesh position={[0,1.34,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.22,.045,8,16,.9*Math.PI]}/><meshStandardMaterial color={collar}/></mesh>;
}

function Accessories({id}:{id:string}) {
  if (id === "rhea" || id === "dira" || id === "vox") return <Headset tone={id === "dira" ? "#c58aff" : id === "vox" ? "#ff8b94" : "#74a7ff"} />;
  if (id === "wri") return <group position={[0,0.03,0.22]}><mesh><boxGeometry args={[.30,.05,.18]}/><meshStandardMaterial color="#7c4a27"/></mesh></group>;
  if (id === "gemi") return <Tablet accessoryColor="#66dcae" />;
  return <RobotBadge />;
}

function Headset({tone}:{tone:string}) {
  return <group position={[0,1.98,0]} rotation={[0,0,Math.PI]}>
    <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[.36,.035,8,24,Math.PI]}/><meshStandardMaterial color={tone}/></mesh>
    <mesh position={[-.32,-.02,.02]}><cylinderGeometry args={[.09,.09,.11,12]}/><meshStandardMaterial color={tone}/></mesh>
    <mesh position={[.32,-.02,.02]}><cylinderGeometry args={[.09,.09,.11,12]}/><meshStandardMaterial color={tone}/></mesh>
  </group>;
}
function Tablet({accessoryColor}:{accessoryColor:string}) {
  return <group position={[0,.98,.40]} rotation={[.10,0,0]}><RoundedBox args={[.45,.06,.34]} radius={.04} smoothness={2}><meshStandardMaterial color="#26313b"/></RoundedBox><mesh position={[0,.035,0]}><boxGeometry args={[.34,.012,.24]}/><meshStandardMaterial color={accessoryColor} emissive={accessoryColor} emissiveIntensity={.25}/></mesh></group>;
}
function RobotBadge() {
  return <mesh position={[0,1.03,.32]}><boxGeometry args={[.24,.16,.04]}/><meshStandardMaterial color="#65dfff" emissive="#65dfff" emissiveIntensity={.45}/></mesh>;
}

function StatusBoard({resting}:{resting:boolean}){return <group position={[-.4,2.55,-6.45]}><mesh castShadow><boxGeometry args={[4.1,2.2,.12]}/><meshStandardMaterial color="#232a32"/></mesh><Html center position={[0,0,.09]} distanceFactor={12}><div className="worldBoard"><div className="wbHead">TODAY'S PIPELINE</div><div className="wbRow"><span>Research</span><b>✓</b></div><div className="wbRow"><span>Script</span><b>✓</b></div><div className="wbRow"><span>Scenes</span><b>12/30</b></div><div className="wbState" style={{color:resting?"#ffbf67":"#61e2a0"}}>{resting?"REST MODE":"PRODUCTION ACTIVE"}</div></div></Html></group>}
function NeonSign({resting}:{resting:boolean}){const m=useRef<THREE.MeshStandardMaterial>(null);useFrame(s=>{if(m.current)m.current.emissiveIntensity=resting?.25:.72+Math.sin(s.clock.elapsedTime*3.2)*.15});return <mesh position={[3.8,3.85,-6.45]}><boxGeometry args={[2.3,1.05,.06]}/><meshStandardMaterial ref={m} color="#24404f" emissive={resting?"#ffb858":"#4bdcff"} emissiveIntensity={.8}/></mesh>}
