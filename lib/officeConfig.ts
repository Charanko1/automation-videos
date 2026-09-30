// AI Office world configuration.
// Coordinates: +Y up. Characters/desks face -Z (monitor side). Chair backrest is on +Z.
// Desk rows: back row z=-1.9 (gpt, vox), front row z=1.9 (rhea, wri, gemi), head desk z=6.6 (dira).

export const OFFICE_CONFIG = {
  quality: {
    preset: "high" as "low" | "high",
    high: { dpr: 1.35, shadowMap: 2048, contactResolution: 128, contactFrames: Infinity },
    low: { dpr: 1, shadowMap: 1024, contactResolution: 64, contactFrames: 30 },
  },

  room: {
    width: 30,
    depth: 23,
    wallHeight: 7.2,
    backWallZ: -11.5,
    frontWallZ: 11.5,
    leftWallX: -15,
    rightWallX: 15,
    floorY: 0,
  },

  workZone: {
    desk: {
      width: 2.55,
      depth: 1.18,
      headWidth: 2.9,
      headDepth: 1.3,
      topY: 0.9, // desk SURFACE height (hands rest at ~0.93 when seated)
      thickness: 0.12,
    },
  },

  desks: {
    positions: {
      rhea: [-3.0, 0, 1.9],
      wri: [0, 0, 1.9],
      gemi: [3.0, 0, 1.9],
      gpt: [-1.5, 0, -1.9],
      vox: [1.5, 0, -1.9],
      dira: [0, 0, 6.6],
    } as Record<string, [number, number, number]>,
    rotationY: 0,
    rotations: { rhea: 0, wri: 0, gemi: 0, gpt: 0, vox: 0, dira: 0 } as Record<string, number>,

    // Character centre sits this far behind the desk centre (+Z). Torso front stays just behind the desk edge.
    seatOffsetZ: 0.95,
    chairBehind: 0.08, // chair centre is this far behind the character centre
    chairPullOut: 0.92, // chair (and character riding it) rolls back this far before standing
    chairTurn: 0.14,
    chairWidth: 0.96,
    chairSeatDepth: 0.78,
    chairSeatTop: 0.52,
    chairBackHeight: 0.85,

    // After standing, the character steps sideways (+X) through the gap between chairs.
    exitOffset: { rhea: 1.15, wri: 1.15, gemi: 1.15, gpt: 1.15, vox: 1.15, dira: 2.05 } as Record<string, number>,
    // World Z of the walking aisle each desk uses to reach the lounge lane.
    aisleZ: { rhea: 4.9, wri: 4.9, gemi: 4.9, gpt: 0.4, vox: 0.4, dira: 4.9 } as Record<string, number>,
  },

  // Character rig numbers (legs are 0.38 thigh + 0.52 shin = 0.90).
  rig: {
    upperLift: 0.28, // torso/head/arms are lifted by this over the legs
    seatLift: -0.28, // body Y when sitting on an office chair (seat top 0.52)
    sofaLift: -0.16, // sofa seat top 0.84
    beanbagLift: -0.27,
  },

  navigation: {
    laneX: 6.6, // north-south lane from the desk area to the lounge
    loungeFrontZ: -5.6, // walking line in front of the lounge furniture
    doorPosition: [12.7, 0, 10.55] as [number, number, number],
    obstaclePadding: 0.22,
    characterRadius: 0.46,
    staticObstacles: [
      { id: "shelf", min: [-12.95, -8.85] as [number, number], max: [-11.55, -7.45] as [number, number] },
      { id: "printer", min: [-12.8, -5.4] as [number, number], max: [-11.7, -4.6] as [number, number] },
      { id: "sofa", min: [3.45, -9.05] as [number, number], max: [7.65, -8.02] as [number, number] },
      { id: "snacks", min: [9.04, -7.64] as [number, number], max: [10.06, -6.86] as [number, number] },
      { id: "coffeeTable", min: [5.05, -7.85] as [number, number], max: [6.05, -6.85] as [number, number] },
      { id: "beanbagA", min: [1.6, -9.1] as [number, number], max: [3.1, -7.6] as [number, number] },
      { id: "beanbagB", min: [2.4, -10.4] as [number, number], max: [3.9, -8.9] as [number, number] },
    ],
  },

  lounge: {
    center: [6.2, 0, -7.9] as [number, number, number],
    size: [10.4, 5.8] as [number, number],
    sofa: {
      left: [4.55, 0, -8.45] as [number, number, number],
      right: [6.6, 0, -8.45] as [number, number, number],
    },
    beanbagSpot: [2.35, 0, -8.35] as [number, number, number],
    snacks: [9.55, 0, -7.25] as [number, number, number], // machine itself (screen faces +Z)
    snackSpot: [9.55, 0, -6.3] as [number, number, number], // where the character stands
    window: [8.5, 0, -10.0] as [number, number, number],
    windowLeft: [0.5, 0, -10.0] as [number, number, number],
    beanbagA: [2.35, 0, -8.35] as [number, number, number],
    beanbagB: [3.15, 0, -9.65] as [number, number, number],
    coffeeTable: [5.55, 0, -7.35] as [number, number, number],
  },

  decor: {
    board: [-2.0, 4.6, -11.27] as [number, number, number],
    shelf: [-12.25, 0, -8.15] as [number, number, number],
    printer: [-12.25, 0, -5.0] as [number, number, number],
    server: [12.1, 0, 2.6] as [number, number, number],
    plants: [
      [-11.8, 0, 7.2] as [number, number, number],
      [11.6, 0, 6.0] as [number, number, number],
      [12.4, 0, -10.0] as [number, number, number],
    ],
  },

  idle: {
    breathingHz: 0.24,
    breathingAmplitude: 0.014,
    headTurnAmplitude: 0.35,
    headNodAmplitude: 0.12,
    typingSpeed: 7.0,
    typingAmplitude: 0.07,
    microMinSeconds: 4,
    microMaxSeconds: 12,
    probabilities: { stretch: 0.18, scratch: 0.12, drink: 0.16, lean: 0.19, shift: 0.18, look: 0.17 },
  },

  movement: {
    walkSpeed: 1.85,
    speedVariance: 0.12,
    turnDamping: 8.5,
    positionDamping: 10.5,

    anticipateDuration: 0.45,
    standUpDuration: 1.6,
    sitDownDuration: 1.6,
    arriveDuration: 0.55,

    breakDurationMin: 5,
    breakDurationMax: 12,
    firstBreakDelay: 13,
    breakWaveInterval: 30,
    breakStartSpacing: 7,
    maxSimultaneousBreaks: 2,
  },

  walking: {
    strideSpeed: 9.0,
    footSwing: 0.55,
    armSwing: 0.45,
    bobAmplitude: 0.03,
    lean: 0.07,
    accelerationFraction: 0.16,
    decelerationFraction: 0.2,
  },

  visual: {
    monitorPulseSpeed: 2.6,
    cursorSpeed: 0.65,
    labelBaseHeight: 2.75,
    labelLaneStep: 0.34,
    selectedRingY: 0.022,
    floorOffset: 0.018,
  },

  easing: {
    easeInOut: (t: number) => {
      const x = Math.min(1, Math.max(0, t));
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    },
    smoother: (t: number) => {
      const x = Math.min(1, Math.max(0, t));
      return x * x * x * (x * (x * 6 - 15) + 10);
    },
  },
} as const;

// "dira" is the head desk and is rendered separately from the team desks.
export const WORKER_DESK_IDS = ["rhea", "wri", "gemi", "gpt", "vox"] as const;
export type BreakSpotId = "sofaLeft" | "sofaRight" | "beanbag" | "snacks" | "window" | "windowLeft";

export type SeatTransform = {
  seatPosition: [number, number, number];
  chairPosition: [number, number, number];
  pulledSeatPosition: [number, number, number];
  pulledChairPosition: [number, number, number];
  approachPosition: [number, number, number];
  aisleZ: number;
  rotationY: number;
};

export function getSeatTransform(desk: [number, number, number]): SeatTransform {
  const [x, y, z] = desk;
  const d = OFFICE_CONFIG.desks;
  const key = Object.entries(d.positions).find(([, v]) => v[0] === x && v[2] === z)?.[0] ?? "";
  const rotationY = d.rotations[key] ?? d.rotationY;
  const bx = Math.sin(rotationY), bz = Math.cos(rotationY); // "behind" direction
  const rx = Math.cos(rotationY), rz = -Math.sin(rotationY); // "right" direction
  const at = (back: number, right: number): [number, number, number] => [
    x + bx * back + rx * right,
    y,
    z + bz * back + rz * right,
  ];
  const seat = d.seatOffsetZ;
  const pull = d.chairPullOut;
  return {
    seatPosition: at(seat, 0),
    chairPosition: at(seat + d.chairBehind, 0),
    pulledSeatPosition: at(seat + pull, 0),
    pulledChairPosition: at(seat + d.chairBehind + pull, 0),
    approachPosition: at(seat + pull, d.exitOffset[key] ?? 1.15),
    aisleZ: d.aisleZ[key] ?? 4.9,
    rotationY,
  };
}