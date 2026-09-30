// Centralized tuning for the office/game world.
// Positions are intentionally kept in world coordinates so the scene is easy to tweak.
export const OFFICE_CONFIG = {
  room: { width: 18, depth: 14 },
  desks: {
    x: [-5.6, 0, 5.6],
    z: [2.05, -2.65],
    chairOffsetZ: 0.95,
    rowGap: 4.7,
  },
  breakSpots: {
    sofaLeft: [-3.0, 0, 4.85] as [number, number, number],
    sofaRight: [0.4, 0, 4.85] as [number, number, number],
    snacks: [6.6, 0, 4.15] as [number, number, number],
    window: [-6.1, 0, 4.8] as [number, number, number],
  },
  movement: {
    walkSpeed: 2.05,
    turnSpeed: 7.0,
    leaveDuration: 1.2,
    breakActivityDuration: 7.0,
    breakStart: 12.0,
    breakStartSpacing: 8.0,
    cycleLength: 48.0,
    maxSimultaneousBreaks: 2,
  },
  visual: {
    typingSpeed: 7.0,
    breatheSpeed: 2.0,
    walkBobSpeed: 10.0,
    footSwing: 0.7,
  },
  labels: {
    visibleDistance: 13,
  },
} as const;

export const WORKER_DESK_IDS = ["rhea", "wri", "dira", "gemi", "gpt", "vox"] as const;

export type BreakSpotId = keyof typeof OFFICE_CONFIG.breakSpots;
