// Centralized game/animation tuning. Keep world geometry and behavior knobs here.
export const OFFICE_CONFIG = {
  room: { width: 18, depth: 14 },

  desks: {
    positions: {
      rhea: [-5.6, 0, 2.15],
      wri: [0, 0, 2.15],
      dira: [5.6, 0, 2.15],
      gemi: [-5.6, 0, -2.65],
      gpt: [0, 0, -2.65],
      vox: [5.6, 0, -2.65],
    } as Record<string, [number, number, number]>,
    width: 2.6,
    depth: 1.2,
    chairOffsetZ: 0.96,
    chairPullOut: 0.42,
    chairTurn: 0.10,
  },

  corridors: {
    leftX: -7.25,
    rightX: 7.25,
    frontZ: 3.05,
    backZ: -1.70,
    rearZ: -4.10,
    minVisualWidth: 1.5,
  },

  breakZone: {
    center: [4.65, 0, -5.05] as [number, number, number],
    size: [7.0, 2.8] as [number, number],
  },

  breakSpots: {
    sofaLeft: {
      pos: [3.55, 0, -5.05] as [number, number, number],
      facing: Math.PI,
      activity: "SOFA" as const,
    },
    sofaRight: {
      pos: [5.20, 0, -5.05] as [number, number, number],
      facing: Math.PI,
      activity: "SOFA" as const,
    },
    snacks: {
      pos: [7.05, 0, -3.95] as [number, number, number],
      facing: -Math.PI / 2,
      activity: "SNACK" as const,
    },
    window: {
      pos: [3.90, 0, -5.95] as [number, number, number],
      facing: Math.PI,
      activity: "WINDOW" as const,
    },
  },

  movement: {
    walkSpeed: 1.75,
    speedVariance: 0.13,
    turnDamping: 9.0,
    moveDamping: 9.0,
    pathPointCount: 18,
    waypointRadius: 0.10,

    anticipateDuration: 0.45,
    standUpDuration: 0.78,
    arriveDuration: 0.50,
    breakDurationMin: 5.0,
    breakDurationMax: 12.0,
    sitDownDuration: 0.78,

    firstBreakDelay: 8.0,
    breakWaveInterval: 26.0,
    maxSimultaneousBreaks: 2,
  },

  idle: {
    breathingHz: 0.24,
    breathingAmplitude: 0.028,
    headTurnAmplitude: 0.24,
    headNodAmplitude: 0.075,
    typingSpeed: 6.0,
    typingAmplitude: 0.045,
    microMinSeconds: 4.0,
    microMaxSeconds: 12.0,

    probabilities: {
      stretch: 0.18,
      scratch: 0.13,
      drink: 0.16,
      lean: 0.22,
      shift: 0.18,
      look: 0.13,
    },
  },

  walking: {
    bobAmplitude: 0.040,
    strideSpeed: 9.0,
    footSwing: 0.56,
    armSwing: 0.34,
    lean: 0.075,
    accelerationFraction: 0.14,
    decelerationFraction: 0.18,
    separationRadius: 0.85,
    separationStrength: 0.42,
  },

  visual: {
    screenPulseSpeed: 2.8,
    screenCursorSpeed: 0.9,
    labelHeight: 2.95,
    selectedRingY: 0.025,
  },

  easing: {
    linear: (t: number) => t,
    smooth: (t: number) => t * t * (3 - 2 * t),
    smoother: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
    easeInOut: (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  },
} as const;

export const WORKER_DESK_IDS = ["rhea", "wri", "dira", "gemi", "gpt", "vox"] as const;
export type WorkerDeskId = typeof WORKER_DESK_IDS[number];
export type BreakSpotId = keyof typeof OFFICE_CONFIG.breakSpots;
