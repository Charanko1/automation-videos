# AI Office — YouTube Factory

AI Office is a browser-based workspace for orchestrating AI-assisted video production through a 3D office interface.

## Current release

The application now uses a persistent workspace model instead of hard-coded sample projects, assets, analytics, and settings.

Core flows:
- Create and manage projects from the Projects page.
- Select an active project and resume its scene progress from the Office page.
- Control production state and individual worker break/return commands.
- Persist production settings in the browser workspace.
- Show analytics from workspace project data rather than sample metrics.
- Keep the media library empty until real generated assets are recorded.
- Provide application-level loading, error, and not-found states.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Before release builds:

```bash
npm run typecheck
npm run build
```


## Local AI text provider — OmniRoute

Rhea, Wri, and Dira use the local OmniRoute OpenAI-compatible gateway. OmniRoute itself is free and open-source; the actual quota/cost comes from the upstream provider you connect. OmniRoute documents free providers such as Kiro AI and OpenCode Free, but each provider has its own availability, quotas, and terms.

Install OmniRoute separately on the machine running AI Office:

```bash
npm install -g omniroute
omniroute
```

The dashboard/API runs at `http://127.0.0.1:20128` with the OpenAI-compatible base URL `http://127.0.0.1:20128/v1`. Connect at least one documented free provider from the OmniRoute dashboard, then create/copy the OmniRoute API key from **Dashboard → Endpoints**. Use model `auto` so OmniRoute can route across connected providers.

Add this to `.env.local`:

```env
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=your_omniroute_key
OMNIROUTE_MODEL=auto
```

Then restart AI Office:

```bash
npm run dev
```

AI Office calls OmniRoute only from the server-side production pipeline, so the OmniRoute API key is never exposed to the browser.

## Kids Shorts video pipeline

The Kids Shorts flow is now:

`ChatGPT plan → OmniRoute fallback` for story, screenplay, and Director
→ Gemi for one clean 9:16 source frame per scene
→ GPT Video Artist via OmniRoute `/v1/videos/generations` for image-to-video motion
→ Windows Indonesian TTS
→ FFmpeg subtitles/audio finishing.

Set an image-to-video model in `.env.local` when needed:

```env
OMNIROUTE_VIDEO_MODEL=
```

When the variable is blank, AI Office checks OmniRoute's model catalog and selects a model whose identifier looks I2V-capable. For deterministic behavior, set the exact model exposed by your OmniRoute installation.

The final renderer refuses to create a still-image slideshow for Kids Shorts. Every Director scene must have a generated I2V video before the final MP4 can be assembled. OmniRoute's current API exposes video generation at `POST /v1/videos/generations`; the exact image-input fields are provider-specific, so the selected model must support image-to-video.
## Architecture

- Next.js App Router
- React
- React Three Fiber + Three.js
- Central office configuration in `lib/officeConfig.ts`
- Persistent workspace state in `lib/workspace.ts`

## Production integration boundary

The UI is structured as a release candidate, but external provider execution is not implemented inside this repository yet. DeepSeek, image/video generation, TTS, and YouTube publishing must be connected through server-side adapters before production workloads can be executed or billed.

Client-side pages do not fabricate provider costs or generated assets. Analytics shows only data that exists in the workspace.

## Notes

The 3D office remains a client-rendered scene. Keep provider credentials server-side and never expose API keys through `NEXT_PUBLIC_*` variables.
