// AI Office world configuration.
// Coordinate convention:
//   +Y = up
//   -Z = worker/desk FRONT (monitor side)
//   +Z = worker/desk BACK (chair backrest side)
// All desks and chairs use rotationY = 0. Workers also face -Z.

export const OFFICE_CONFIG = {
  quality: {
    preset: "high" as "low" | "high",
    high: {
      dpr: 1.35,
      shadowMap: 1024,
      contactResolution: 128,
      contactFrames: Infinity,
    },
    low: {
      dpr: 1,
      shadowMap: 512,
      contactResolution: 64,
      contactFrames: 30,
    },
  },

  room: {
    width: 30,
    depth: 23,
    wallHeight: 7.8,
    backWallZ: -11.5,
    frontWallZ: 11.5,
    leftWallX: -15,
    rightWallX: 15,
    floorY: 0,
  },

  workZone: {
    team: {
      topZ: 2.0,
      bottomZ: -0.7,
      xTop: [-3.0, 0, 3.0] as [number, number, number],
      xBottom: [-1.5, 1.5] as [number, number],
    },
    head: {
      x: 0,
      z: 6.6,
    },
    desk: {
      width: 2.55,
      depth: 1.18,
      headWidth: 2.90,
      headDepth: 1.30,
      topY: 1.45,
    },
  },

  desks: {
    positions: {
      rhea: [-3.0, 0, 1.9],
      wri: [0, 0, 1.9],
      dira: [0, 0, 6.6],
      gemi: [3.0, 0, 1.9],
      gpt: [-1.5, 0, -0.75],
      vox: [1.5, 0, -0.75],
    } as Record<string, [number, number, number]>,

    rotationY: 0,
    rotations: { rhea: 0, wri: 0, dira: 0, gemi: 0, gpt: 0, vox: 0 } as Record<string, number>,
    chairOffsetZ: 1.02,
    chairPullOut: 0.58,
    chairTurn: 0.12,
    chairWidth: 0.96,
    chairSeatDepth: 0.78,
    chairSeatHeight: 0.64,
    chairBackHeight: 1.10,
    approachExtraZ: 0.78,
    sittingDepth: 0.04,
  },

  navigation: {
    mainCorridorZ: 8.75,
    loungeCorridorX: 11.8,
    loungeRearZ: -6.15,
    doorPosition: [12.7, 0, 10.55] as [number, number, number],

    obstaclePadding: 0.22,
    characterRadius: 0.46,

    // Collider extents used by the debug view and route design.
    staticObstacles: [
      { id: "shelf", min: [-12.9, -9.2] as [number, number], max: [-11.2, -7.1] as [number, number] },
      { id: "printer", min: [-12.8, -5.8] as [number, number], max: [-11.3, -4.2] as [number, number] },
      { id: "sofa", min: [3.5, -9.05] as [number, number], max: [8.9, -8.0] as [number, number] },
      { id: "snacks", min: [9.15, -7.9] as [number, number], max: [10.15, -6.4] as [number, number] },
      { id: "beanbagA", min: [1.7, -8.95] as [number, number], max: [2.8, -7.85] as [number, number] },
      { id: "beanbagB", min: [2.45, -10.0] as [number, number], max: [3.55, -8.9] as [number, number] },
    ],
  },

  lounge: {
    center: [6.2, 0, -7.9] as [number, number, number],
    size: [10.4, 5.8] as [number, number],
    sofa: {
      left: [4.55, 0, -8.55] as [number, number, number],
      right: [6.55, 0, -8.55] as [number, number, number],
    },
    snacks: [9.55, 0, -7.25] as [number, number, number],
    window: [7.65, 0, -10.05] as [number, number, number],
    beanbagA: [2.35, 0, -8.35] as [number, number, number],
    beanbagB: [3.15, 0, -9.65] as [number, number, number],
    coffeeTable: [5.55, 0, -7.35] as [number, number, number],
  },

  decor: {
    board: [-5.7, 5.05, -11.27] as [number, number, number],
    shelf: [-12.25, 0, -8.15] as [number, number, number],
    printer: [-12.25, 0, -5.00] as [number, number, number],
    server: [12.1, 0, 2.6] as [number, number, number],
    plants: [
      [-11.8, 0, 7.2] as [number, number, number],
      [9.8, 0, 6.0] as [number, number, number],
      [11.3, 0, -9.8] as [number, number, number],
    ],
  },

  idle: {
    breathingHz: 0.24,
    breathingAmplitude: 0.026,
    headTurnAmplitude: 0.22,
    headNodAmplitude: 0.06,
    typingSpeed: 6.0,
    typingAmplitude: 0.045,
    microMinSeconds: 4,
    microMaxSeconds: 12,
    probabilities: {
      stretch: 0.18,
      scratch: 0.12,
      drink: 0.16,
      lean: 0.19,
      shift: 0.18,
      look: 0.17,
    },
  },

  movement: {
    walkSpeed: 1.78,
    speedVariance: 0.12,
    turnDamping: 8.5,
    positionDamping: 10.5,

    anticipateDuration: 0.42,
    standUpDuration: 0.92,
    sitDownDuration: 0.92,
    arriveDuration: 0.55,

    breakDurationMin: 5,
    breakDurationMax: 12,
    firstBreakDelay: 13,
    breakWaveInterval: 30,
    breakStartSpacing: 7,

    maxSimultaneousBreaks: 2,
    separationRadius: 0.95,
    separationStrength: 0.40,
  },

  walking: {
    strideSpeed: 9.2,
    footSwing: 0.52,
    armSwing: 0.30,
    bobAmplitude: 0.038,
    lean: 0.065,
    accelerationFraction: 0.16,
    decelerationFraction: 0.20,
  },

  visual: {
    monitorPulseSpeed: 2.6,
    cursorSpeed: 0.65,
    labelBaseHeight: 3.05,
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
    easeOutBack: (t: number) => {
      const x = Math.min(1, Math.max(0, t));
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
  },
} as const;

export const WORKER_DESK_IDS = ["rhea", "wri", "dira", "gemi", "gpt", "vox"] as const;
export type WorkerDeskId = typeof WORKER_DESK_IDS[number];
export type BreakSpotId = "sofaLeft" | "sofaRight" | "snacks" | "window";

export const WORK_ZONE_IDS = ["rhea", "wri", "gemi", "gpt", "vox"] as const;

export type SeatTransform = {
  seatPosition: [number, number, number];
  chairPosition: [number, number, number];
  pulledChairPosition: [number, number, number];
  approachPosition: [number, number, number];
  rotationY: number;
};

export function getSeatTransform(desk: [number, number, number]): SeatTransform {
  const [x, y, z] = desk;
  const key = Object.entries(OFFICE_CONFIG.desks.positions).find(([, value]) => value[0] === x && value[2] === z)?.[0];
  const rotationY = key ? OFFICE_CONFIG.desks.rotations[key] : OFFICE_CONFIG.desks.rotationY;
  const dx = Math.sin(rotationY);
  const dz = Math.cos(rotationY);
  const chairDistance = OFFICE_CONFIG.desks.chairOffsetZ;
  const pulledDistance = chairDistance + OFFICE_CONFIG.desks.chairPullOut;
  const approachDistance = pulledDistance + OFFICE_CONFIG.desks.approachExtraZ;
  return {
    seatPosition: [x, y, z + 0.04],
    chairPosition: [x + dx * chairDistance, y, z + dz * chairDistance],
    pulledChairPosition: [x + dx * pulledDistance, y, z + dz * pulledDistance],
    approachPosition: [x + dx * approachDistance, y, z + dz * approachDistance],
    rotationY,
  };
}
