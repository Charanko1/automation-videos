// Single source of truth for office geometry + animation tuning.
// Coordinate convention:
// - World UP = +Y
// - Worker/desk FRONT = -Z (toward the monitor)
// - Therefore a seated worker faces rotationY = PI.
// - All desks stay rotationY = 0.

export const OFFICE_CONFIG = {
  room: {
    width: 30,
    depth: 23,
    floorY: -0.06,
    wallHeight: 7.5,
    backWallZ: -11.25,
  },

  workZone: {
    centerZ: 0.45,
    rowZ: [3.25, -3.15] as [number, number],
    x: [-7.8, 0, 7.8] as [number, number, number],
    corridorFrontZ: 5.45,
    corridorBetweenZ: 0.05,
    deskWidth: 2.55,
    deskDepth: 1.18,
  },

  desks: {
    chairOffsetZ: 1.02,
    chairPullOut: 0.58,
    chairTurn: 0.10,
    approachExtraZ: 0.72,
    positions: {
      rhea: [-7.8, 0, 3.25],
      wri: [0, 0, 3.25],
      dira: [7.8, 0, 3.25],
      gemi: [-7.8, 0, -3.15],
      gpt: [0, 0, -3.15],
      vox: [7.8, 0, -3.15],
    } as Record<string, [number, number, number]>,
  },

  lounge: {
    center: [6.4, 0, -8.35] as [number, number, number],
    size: [9.8, 5.0] as [number, number],
    sideCorridorX: 11.45,
    rearWalkZ: -8.15,
    sofa: {
      left: [4.55, 0, -8.55] as [number, number, number],
      right: [6.25, 0, -8.55] as [number, number, number],
    },
    snacks: [10.15, 0, -7.15] as [number, number, number],
    window: [7.6, 0, -9.75] as [number, number, number],
    beanbagA: [2.15, 0, -8.25] as [number, number, number],
    beanbagB: [2.55, 0, -9.55] as [number, number, number],
  },

  movement: {
    walkSpeed: 1.82,
    speedVariance: 0.12,
    turnDamping: 9.5,
    positionDamping: 11,
    separationRadius: 0.95,
    separationStrength: 0.34,
    waypointRadius: 0.11,
    pathSamples: 24,

    anticipateDuration: 0.42,
    standUpDuration: 0.92,
    sitDownDuration: 0.92,
    arriveDuration: 0.55,

    breakDurationMin: 5,
    breakDurationMax: 12,

    firstBreakDelay: 10,
    breakWaveInterval: 26,
    breakStartSpacing: 7,
    maxSimultaneousBreaks: 2,
  },

  idle: {
    breathingHz: 0.24,
    breathingAmplitude: 0.026,
    headTurnAmplitude: 0.22,
    headNodAmplitude: 0.06,
    typingSpeed: 6.1,
    typingAmplitude: 0.040,
    microMinSeconds: 4,
    microMaxSeconds: 12,

    probabilities: {
      stretch: 0.18,
      scratch: 0.13,
      drink: 0.15,
      lean: 0.19,
      shift: 0.18,
      look: 0.17,
    },
  },

  walking: {
    strideSpeed: 9.4,
    footSwing: 0.54,
    armSwing: 0.30,
    bobAmplitude: 0.038,
    lean: 0.07,
    accelerationFraction: 0.16,
    decelerationFraction: 0.20,
  },

  visual: {
    monitorPulseSpeed: 2.6,
    cursorSpeed: 0.72,
    labelHeight: 3.02,
    selectedRingY: 0.022,
  },

  easing: {
    smooth: (t: number) => t * t * (3 - 2 * t),
    smoother: (t: number) => {
      const x = Math.min(1, Math.max(0, t));
      return x * x * x * (x * (x * 6 - 15) + 10);
    },
    easeInOut: (t: number) => {
      const x = Math.min(1, Math.max(0, t));
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
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

export type SeatTransform = {
  seatPosition: [number, number, number];
  chairPosition: [number, number, number];
  pulledChairPosition: [number, number, number];
  approachPosition: [number, number, number];
  rotationY: number;
};

// All desks use this helper. The chair is rotated PI so its local front (+Z)
// points toward the monitor at world -Z and the backrest stays behind the worker.
export function getSeatTransform(desk: [number, number, number]): SeatTransform {
  const [x, y, z] = desk;
  const seatZ = z + OFFICE_CONFIG.desks.chairOffsetZ;
  return {
    seatPosition: [x, y, seatZ],
    chairPosition: [x, y, seatZ],
    pulledChairPosition: [x, y, seatZ + OFFICE_CONFIG.desks.chairPullOut],
    approachPosition: [x, y, seatZ + OFFICE_CONFIG.desks.chairPullOut + OFFICE_CONFIG.desks.approachExtraZ],
    rotationY: Math.PI,
  };
}
