# AI Office — Full Repair / Character + Break System

This build implements the latest office-game requirements from the refactor prompt.

## What changed
- Kept the office as a true WebGL 3D scene with Three.js + React Three Fiber.
- Reorganized the 6 workstations into a clean 2 x 3 grid with consistent alignment and a central walking corridor.
- Removed the obstructing center round meeting table from the movement path.
- Moved the rest area to the rear/right zone: sofa, snacks machine, plant/window area and aquarium.
- Characters are more stylized and game-like: rounded blocky heads, hair, face, torso, collar, shoes and role accessories.
- Distinct character accessories: headsets, tablet, robot badge, different hair/outfit colors.
- Sitting pose is anchored to the chair position rather than standing in front of it.
- Added state machine:
  WORKING -> LEAVING_DESK -> WALKING_TO_BREAK -> BREAK_ACTIVITY -> WALKING_BACK -> WORKING
- Working animation: breathing, subtle head/body motion and typing arm loop.
- Walking animation: alternating legs/arms, body bob and smooth quaternion turn toward each waypoint.
- Break activities: sofa, snacks machine and window/plant.
- Break scheduling is staggered by worker index; at most two break windows overlap, with different break spots to avoid stacking.
- Waypoint graph is used instead of A* because the office layout is fixed and predictable. Routes use the open corridors around furniture.
- Nameplates follow each character and update between `working`, `walking` and `break`.
- Centralized tweakable constants live in `lib/officeConfig.ts`.
- Daily hard cap remains Rp30,000; the cap is a ceiling, not a spending target.
- Tailwind/PostCSS was removed to avoid the previous dependency/build issue.
- Dependency versions are pinned.

## Run
```bash
npm install
npm run dev
```
Open http://localhost:3000

## Important
This is the production UI/game shell. The real DeepSeek, Gemini, GPT/video, TTS and YouTube API adapters are not connected yet.
