"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, BarChart3, Bot, CalendarDays, FolderKanban, Gauge, Image as ImageIcon, LayoutDashboard, Pause, Play, Settings, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type AIProduction, type Workspace } from "../lib/workspace";

const OfficeWorld = dynamic(() => import("../components/OfficeWorld"), { ssr: false });

const people = [
  { id: "rhea", name: "Rhea", role: "Kids Story Designer", provider: "OmniRoute → ChatGPT fallback", dept: "research", color: "#73a5ff" },
  { id: "wri", name: "Wri", role: "Kids Storyboard Writer", provider: "ChatGPT plan → OmniRoute fallback", dept: "script", color: "#f0bc68" },
  { id: "dira", name: "Dira", role: "Kids Prompt Director", provider: "ChatGPT plan → OmniRoute fallback", dept: "director", color: "#c58aff" },
  { id: "gemi", name: "Gemi", role: "3D Character & Scene Artist", provider: "ChatGPT Image → OmniRoute → Cloudflare", dept: "image", color: "#68dcae" },
  { id: "gpt", name: "GPT", role: "Video Artist", provider: "OmniRoute I2V · configurable model", dept: "video", color: "#72c7ff" },
  { id: "vox", name: "Vox", role: "Indonesian Dialogue Voice", provider: "Windows Speech Synthesis · id-ID", dept: "tts", color: "#ff8b94" },
];

const pipe = [
  ["Story", "Build world + cast"], ["Screenplay", "Write short dialogue"], ["Director", "Block actors"], ["Characters", "Generate 9:16 keyframes"],
  ["Video", "Animate art"], ["TTS", "Create voices"], ["Editing", "Render Short"], ["Upload", "Publish"],
];

const aiPhaseLabel: Record<string, string> = {
  IDLE: "Ready",
  RESEARCH: "Rhea · Building story",
  SCRIPT: "Wri · Writing screenplay",
  DIRECTOR: "Dira · Blocking scenes",
  IMAGES: "Gemi · Generating character keyframes",
  VIDEO: "GPT · Animating scenes",
  COMPLETED: "Kids Short pre-production complete",
  FAILED: "Pipeline failed",
};

type WorkerCommand = { workerId: string; type: "BREAK" | "RETURN"; nonce: number };

function projectStage(scene: number, total: number, preProductionComplete = false) {
  if (total <= 0) return 0;
  if (!preProductionComplete) {
    return Math.min(4, Math.floor((scene / total) * 5));
  }
  return Math.min(pipe.length - 1, 4 + Math.floor((scene / total) * 4));
}

export default function Page() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [resting, setResting] = useState(false);
  const [scene, setScene] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState("Workspace ready.");
  const [workerCommand, setWorkerCommand] = useState<WorkerCommand | null>(null);
  const [rendering, setRendering] = useState(false);

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? null,
    [workspace],
  );
  const totalScenes = activeProject?.totalScenes ?? workspace.settings.scenesPerVideo;
  const pct = activeProject ? Math.round((scene / Math.max(totalScenes, 1)) * 100) : 0;
  const completedVideos = workspace.projects.filter((project) => project.status === "COMPLETED").length;
  const aiPhase = activeProject?.ai?.phase ?? "IDLE";
  const stage = projectStage(scene, totalScenes, aiPhase === "COMPLETED");
  const officeActive = running || aiRunning;

  useEffect(() => {
    const current = readWorkspace();
    setWorkspace(current);
    setScene(current.projects.find((project) => project.id === current.activeProjectId)?.currentScene ?? 0);
    setReady(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "ai-office.workspace.v1") return;
      const next = readWorkspace();
      setWorkspace(next);
      if (!running && !aiRunning) setScene(next.projects.find((project) => project.id === next.activeProjectId)?.currentScene ?? 0);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [running, aiRunning]);

  useEffect(() => {
    if (!ready) return;
    const nextScene = activeProject?.currentScene ?? 0;
    setScene(nextScene);
    if (!aiRunning) {
      setRunning(false);
      setResting(false);
    }
  }, [activeProject?.id]);

  useEffect(() => {
    if (!ready || !running || aiRunning || resting || !activeProject) return;
    const timer = window.setInterval(() => {
      setScene((current) => {
        const next = Math.min(current + 1, totalScenes);
        setWorkspace((currentWorkspace) => {
          const updated: Workspace["projects"] = currentWorkspace.projects.map((project): Workspace["projects"][number] =>
            project.id === activeProject.id
              ? {
                  ...project,
                  currentScene: next,
                  status: next >= project.totalScenes ? ("COMPLETED" as const) : ("PRODUCING" as const),
                  updatedAt: new Date().toISOString(),
                }
              : project,
          );
          const updatedWorkspace: Workspace = { ...currentWorkspace, projects: updated };
          writeWorkspace(updatedWorkspace);
          return updatedWorkspace;
        });
        if (next >= totalScenes) {
          setRunning(false);
          setResting(false);
          setToast("Production completed.");
        }
        return next;
      });
    }, 2100);
    return () => window.clearInterval(timer);
  }, [activeProject?.id, activeProject?.totalScenes, aiRunning, ready, resting, running, totalScenes]);

  const updateActiveProject = (patch: Partial<Workspace["projects"][number]>) => {
    if (!activeProject) return;
    setWorkspace((current) => {
      const updatedWorkspace = {
        ...current,
        projects: current.projects.map((project) =>
          project.id === activeProject.id
            ? { ...project, ...patch, updatedAt: new Date().toISOString() }
            : project,
        ),
      };
      writeWorkspace(updatedWorkspace);
      return updatedWorkspace;
    });
  };

  const updateActiveAI = (patch: Partial<AIProduction>) => {
    if (!activeProject) return;
    setWorkspace((current) => {
      const now = new Date().toISOString();
      const updatedWorkspace = {
        ...current,
        projects: current.projects.map((project) =>
          project.id === activeProject.id
            ? {
                ...project,
                ai: { phase: "IDLE" as const, ...(project.ai ?? {}), ...patch, updatedAt: now },
                updatedAt: now,
              }
            : project,
        ),
      };
      writeWorkspace(updatedWorkspace);
      return updatedWorkspace;
    });
  };

  const runAIPipeline = async (): Promise<boolean> => {
    if (!activeProject || aiRunning) return false;

    setAiRunning(true);
    setResting(false);
    setToast("Checking existing Kids Shorts stages before spending another AI call…");

    const requestedSceneCount = Math.min(8, Math.max(5, activeProject.totalScenes));
    // Kids Shorts artifacts are reusable regardless of which text brain produced them.
    // OmniRoute is preferred now; ChatGPT plan remains a fallback when OmniRoute is unavailable.
    const kidsArtifacts =
      activeProject.ai?.pipelineVersion === "kids-shorts-v1";
    let researchText = kidsArtifacts ? activeProject.ai?.research?.trim() ?? "" : "";
    let scriptText = kidsArtifacts ? activeProject.ai?.script?.trim() ?? "" : "";
    let directorText = kidsArtifacts ? activeProject.ai?.director?.trim() ?? "" : "";
    let characterBible = kidsArtifacts ? activeProject.ai?.characterBible?.trim() ?? "" : "";
    let directorScenes = kidsArtifacts && Array.isArray(activeProject.ai?.scenePlans) ? activeProject.ai.scenePlans : [];
    let generatedAssets: NonNullable<AIProduction["imageAssets"]> = kidsArtifacts && Array.isArray(activeProject.ai?.imageAssets)
      ? [...activeProject.ai.imageAssets]
      : [];
    let generatedVideoAssets: NonNullable<AIProduction["videoAssets"]> = kidsArtifacts && Array.isArray(activeProject.ai?.videoAssets)
      ? [...activeProject.ai.videoAssets]
      : [];

    try {
      updateActiveProject({ status: "PRODUCING" });

      if (!researchText) {
        setToast("Rhea is building the story world and character cast with OmniRoute.");
        updateActiveAI({ phase: "RESEARCH", error: undefined });

        const response = await fetch("/api/production/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "research",
            title: activeProject.title,
            format: activeProject.type,
            sceneCount: requestedSceneCount,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Research stage failed.");
        }

        researchText = typeof data.text === "string" ? data.text.trim() : "";
        if (!researchText) throw new Error("Rhea returned an empty story foundation.");

        updateActiveAI({
          phase: "SCRIPT",
          pipelineVersion: "kids-shorts-v1",
          research: researchText,
          model: data.model,
          textProvider: data.provider === "ChatGPT plan" ? "ChatGPT plan" : "OmniRoute",
          error: undefined,
        });
      } else {
        setToast("Rhea already completed. Reusing the existing story foundation.");
      }

      if (!scriptText) {
        setToast("Wri is writing the screenplay and dialogue.");
        updateActiveAI({ phase: "SCRIPT", error: undefined });

        const response = await fetch("/api/production/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "script",
            title: activeProject.title,
            format: activeProject.type,
            sceneCount: requestedSceneCount,
            research: researchText,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Script stage failed.");
        }

        scriptText = typeof data.text === "string" ? data.text.trim() : "";
        if (!scriptText) throw new Error("Wri returned an empty screenplay.");

        updateActiveAI({
          phase: "DIRECTOR",
          pipelineVersion: "kids-shorts-v1",
          script: scriptText,
          model: data.model ?? activeProject.ai?.model,
          textProvider: data.provider === "ChatGPT plan" ? "ChatGPT plan" : "OmniRoute",
          error: undefined,
        });
      } else {
        setToast("Wri already completed. Reusing the existing screenplay.");
      }

      const directorIsUsable =
        Boolean(directorText) &&
        Boolean(characterBible) &&
        directorScenes.length === requestedSceneCount &&
        directorScenes.every((scenePlan) => scenePlan?.sceneId && scenePlan?.visualPrompt);

      if (!directorIsUsable) {
        setToast("Dira is planning simple playful kids scenes.");
        updateActiveAI({ phase: "DIRECTOR", error: undefined });

        const response = await fetch("/api/production/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "director",
            title: activeProject.title,
            format: activeProject.type,
            sceneCount: requestedSceneCount,
            script: scriptText,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Director stage failed.");
        }

        directorText = typeof data.text === "string" ? data.text.trim() : "";
        characterBible = typeof data.characterBible === "string" ? data.characterBible.trim() : "";
        directorScenes = Array.isArray(data.scenes) ? data.scenes : [];

        if (!directorText) throw new Error("Dira returned an empty director plan.");
        if (!characterBible) {
          throw new Error(
            "Dira output is missing the character bible. The Director response must contain character_bible before image generation.",
          );
        }
        if (directorScenes.length !== requestedSceneCount) {
          throw new Error(
            `Dira returned ${directorScenes.length} scenes, but exactly ${requestedSceneCount} were requested.`,
          );
        }

        const silentScenes = directorScenes.filter(
          (scenePlan: { dialogue?: unknown[] }) => !Array.isArray(scenePlan.dialogue) || scenePlan.dialogue.length === 0,
        );
        if (silentScenes.length > 0) {
          throw new Error(
            `Dira returned ${silentScenes.length} scene(s) without dialogue. Every scene must contain at least one character line.`,
          );
        }

        // A new Director plan changes scene identity, prompts, and continuity, so old images are not safe to reuse.
        generatedAssets = [];
        generatedVideoAssets = [];

        updateActiveAI({
          phase: "IMAGES",
          director: directorText,
          characterBible,
          scenePlans: directorScenes,
          imageAssets: [],
          model: data.model ?? activeProject.ai?.model,
          error: undefined,
        });

        updateActiveProject({
          status: "PRODUCING",
          currentScene: 0,
          totalScenes: directorScenes.length,
        });
        setScene(0);
      } else {
        setToast("Dira already completed. Reusing the existing kids director plan and character bible.");
      }

      updateActiveAI({
        phase: "IMAGES",
        pipelineVersion: "kids-shorts-v1",
        director: directorText,
        characterBible,
        scenePlans: directorScenes,
        imageAssets: generatedAssets,
        error: undefined,
      });

      updateActiveProject({
        status: "PRODUCING",
        totalScenes: directorScenes.length,
      });

      for (let index = 0; index < directorScenes.length; index += 1) {
        const scenePlan = directorScenes[index];
        const existing = generatedAssets.find((asset) => asset.sceneId === scenePlan.sceneId);

        if (existing?.assetUrl) {
          let assetStillExists = false;
          try {
            const assetCheck = await fetch(existing.assetUrl, { method: "HEAD", cache: "no-store" });
            assetStillExists = assetCheck.ok;
          } catch {
            assetStillExists = false;
          }

          if (assetStillExists) {
            setToast(`Gemi · Scene ${index + 1}/${directorScenes.length} · Reusing existing keyframe.`);
            continue;
          }

          generatedAssets = generatedAssets.filter((asset) => asset.sceneId !== scenePlan.sceneId);
        }

        setToast(`Gemi · Scene ${index + 1}/${directorScenes.length} · Generating image…`);

        const imageResponse = await fetch("/api/production/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProject.id,
            sceneId: scenePlan.sceneId,
            prompt: scenePlan.visualPrompt,
            characterBible,
            referenceCharacterIds: scenePlan.referenceCharacterIds ?? [],
            charactersPresent: scenePlan.charactersPresent ?? [],
            emotionalBeat: scenePlan.emotionalBeat ?? "",
            cameraAndComposition: "static locked-off shot, no zoom, no pan, no camera movement",
            characterActions: scenePlan.characterActions ?? "",
            motion: scenePlan.motion ?? "",
          }),
        });
        const imageData = await imageResponse.json().catch(() => ({}));

        if (!imageResponse.ok || !imageData.ok) {
          const detail =
            typeof imageData.error === "string" && imageData.error.trim()
              ? imageData.error.trim()
              : `HTTP ${imageResponse.status} ${imageResponse.statusText || ""}`.trim();
          throw new Error(
            detail || `Image generation failed for ${scenePlan.sceneId}.`,
          );
        }

        generatedAssets.push({
          sceneId: scenePlan.sceneId,
          assetUrl: imageData.assetUrl,
          model: imageData.model,
          narrationExcerpt: scenePlan.narrationExcerpt,
          generatedAt: new Date().toISOString(),
        });
        generatedVideoAssets = generatedVideoAssets.filter(
          (asset) => asset.sceneId !== scenePlan.sceneId,
        );

        updateActiveAI({
          phase: "IMAGES",
          imageAssets: [...generatedAssets],
          error: undefined,
        });
      }

      updateActiveAI({
        phase: "VIDEO",
        pipelineVersion: "kids-shorts-v1",
        director: directorText,
        characterBible,
        scenePlans: directorScenes,
        imageAssets: generatedAssets,
        videoAssets: generatedVideoAssets,
        model: activeProject.ai?.model,
        textProvider: activeProject.ai?.textProvider ?? "ChatGPT plan",
        error: undefined,
      });

      updateActiveProject({
        status: "PRODUCING",
        currentScene: 0,
        totalScenes: directorScenes.length,
      });
      setScene(0);

      for (let index = 0; index < directorScenes.length; index += 1) {
        const scenePlan = directorScenes[index];
        const sourceImage = generatedAssets.find((asset) => asset.sceneId === scenePlan.sceneId);

        if (!sourceImage?.assetUrl) {
          throw new Error(`GPT Video Artist cannot animate ${scenePlan.sceneId}: the Gemi source image is missing.`);
        }

        const existingVideo = generatedVideoAssets.find((asset) => asset.sceneId === scenePlan.sceneId);
        if (existingVideo?.assetUrl) {
          let videoStillExists = false;
          try {
            const assetCheck = await fetch(existingVideo.assetUrl, { method: "HEAD", cache: "no-store" });
            videoStillExists = assetCheck.ok;
          } catch {
            videoStillExists = false;
          }

          if (videoStillExists) {
            setToast(`GPT · Scene ${index + 1}/${directorScenes.length} · Reusing existing I2V video.`);
            continue;
          }

          generatedVideoAssets = generatedVideoAssets.filter((asset) => asset.sceneId !== scenePlan.sceneId);
        }

        const motionPrompt = [
          "Animate the supplied first frame as a single continuous preschool 3D animation.",
          "Keep the exact character identity, clothing, proportions, environment, props, lighting, and composition from the source image.",
          "Camera must stay completely static: static locked-off shot, no zoom, no pan, no camera movement.",
          "All visible motion must come from the characters and simple props.",
          "Start moving at 0 seconds; do not hold a frozen pose before acting.",
          "Follow this exact timed motion plan:",
          scenePlan.motion ?? scenePlan.characterActions ?? "Bimo performs one clear, cheerful physical action.",
          "No new characters, no scene changes, no collage, no text, no watermark, no scary or dangerous action.",
          "Output a clean vertical 9:16 video for children ages 2–7.",
        ].join("\n");

        const durationSeconds = 5;

        setToast(`GPT · Scene ${index + 1}/${directorScenes.length} · Generating I2V motion…`);

        const videoResponse = await fetch("/api/production/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProject.id,
            sceneId: scenePlan.sceneId,
            sourceAssetUrl: sourceImage.assetUrl,
            prompt: motionPrompt,
            durationSeconds,
          }),
        });

        const videoData = await videoResponse.json().catch(() => ({}));
        if (!videoResponse.ok || !videoData.ok) {
          const detail =
            typeof videoData.error === "string" && videoData.error.trim()
              ? videoData.error.trim()
              : `HTTP ${videoResponse.status} ${videoResponse.statusText || ""}`.trim();
          throw new Error(detail || `I2V generation failed for ${scenePlan.sceneId}.`);
        }

        generatedVideoAssets.push({
          sceneId: scenePlan.sceneId,
          assetUrl: videoData.assetUrl,
          model: videoData.model,
          durationSeconds,
          generatedAt: new Date().toISOString(),
        });

        updateActiveAI({
          phase: "VIDEO",
          videoAssets: [...generatedVideoAssets],
          imageAssets: generatedAssets,
          error: undefined,
        });
      }

      updateActiveAI({
        phase: "COMPLETED",
        pipelineVersion: "kids-shorts-v1",
        research: researchText,
        script: scriptText,
        director: directorText,
        characterBible,
        scenePlans: directorScenes,
        imageAssets: generatedAssets,
        videoAssets: generatedVideoAssets,
        model: activeProject.ai?.model,
        textProvider: activeProject.ai?.textProvider ?? "ChatGPT plan",
        error: undefined,
      });

      updateActiveProject({
        status: "PRODUCING",
        currentScene: 0,
        totalScenes: directorScenes.length,
      });
      setScene(0);
      setRunning(true);
      setResting(false);
      setToast("AI pipeline complete. Reused completed stages where possible; production started.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI pipeline failed.";
      updateActiveAI({ phase: "FAILED", error: message });
      setToast(`AI pipeline failed: ${message}`);
      return false;
    } finally {
      setAiRunning(false);
    }
  };

  const renderFinalVideo = async () => {
    if (!activeProject?.ai?.script || !activeProject.ai.director || rendering) return;
    setRendering(true);
    setToast("Vox + FFmpeg · assembling generated I2V scenes into the Kids Short…");
    updateActiveAI({ render: { status: "RENDERING", error: undefined } });

    try {
      const response = await fetch("/api/production/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          title: activeProject.title,
          script: activeProject.ai.script,
          director: activeProject.ai.director,
          model: activeProject.ai.model,
          videoAssets: activeProject.ai.videoAssets ?? [],
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Local render failed.");

      updateActiveAI({
        render: {
          status: "READY",
          videoUrl: data.videoUrl,
          thumbnailUrl: data.thumbnailUrl,
          generatedAt: new Date().toISOString(),
        },
      });
      setToast("Video rendered successfully with Indonesian character voices.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local render failed.";
      updateActiveAI({ render: { status: "FAILED", error: message } });
      setToast("Render failed: " + message);
    } finally {
      setRendering(false);
    }
  };

  const startProduction = async () => {
    if (!activeProject) {
      setToast("Create or activate a project before starting production.");
      return;
    }
    const needsAI =
      (activeProject.ai?.phase ?? "IDLE") !== "COMPLETED" ||
      (activeProject.ai?.imageAssets?.length ?? 0) < activeProject.totalScenes ||
      (activeProject.ai?.videoAssets?.length ?? 0) < activeProject.totalScenes;

    if (scene >= activeProject.totalScenes && !needsAI) {
      setToast("This project is already completed.");
      return;
    }

    if (needsAI) {
      const completed = await runAIPipeline();
      if (!completed) return;
    }

    updateActiveProject({ status: "PRODUCING" });
    setRunning(true);
    setResting(false);
    setToast("Production started after the Kids Shorts pipeline.");
  };

  const toggleRest = () => {
    if (!activeProject) {
      setToast("No active project.");
      return;
    }
    if (!running && !resting) {
      setToast("Start production before using rest mode.");
      return;
    }
    setResting((current) => !current);
    setToast(resting ? "Production resumed." : "Rest mode enabled.");
  };

  const stopProduction = () => {
    setRunning(false);
    setResting(false);
    if (activeProject && activeProject.status !== "COMPLETED") updateActiveProject({ status: "DRAFT" });
    setToast("Production stopped.");
  };

  const issueWorkerCommand = (type: "BREAK" | "RETURN") => {
    if (!selected) return;
    if (type === "BREAK" && (!officeActive || resting || aiRunning)) {
      setToast("Finish the AI pre-production pipeline or start production before sending a worker to break.");
      return;
    }
    const worker = people.find((person) => person.id === selected);
    setWorkerCommand((current) => ({ workerId: selected, type, nonce: (current?.nonce ?? 0) + 1 }));
    setToast(type === "BREAK" ? `${worker?.name ?? "Worker"} sent to break.` : `${worker?.name ?? "Worker"} called back to desk.`);
  };

  const status = (dept: string) => {
    if (aiRunning) {
      const aiStage = { research: "RESEARCH", script: "SCRIPT", director: "DIRECTOR", image: "IMAGES", video: "VIDEO" }[dept];
      if (aiStage === aiPhase) return "Working";
      return "Idle";
    }
    if (resting || !running || !activeProject) return resting ? "Resting" : "Idle";
    const deptStage = { research: 0, script: 1, director: 2, image: 3, video: 4, tts: 5 }[dept as keyof Record<string, number>];
    return deptStage === stage ? "Working" : "Idle";
  };

  const workerTask = (person: (typeof people)[number]) => {
    if (aiRunning) {
      if (person.dept === "research" && aiPhase === "RESEARCH") return "Building story world";
      if (person.dept === "script" && aiPhase === "SCRIPT") return "Writing screenplay dialogue";
      if (person.dept === "director" && aiPhase === "DIRECTOR") return "Blocking actors + camera";
      if (person.dept === "image" && aiPhase === "IMAGES") {
        const count = activeProject?.ai?.imageAssets?.length ?? 0;
        const total = activeProject?.totalScenes ?? 0;
        return total ? `Generating kids 9:16 keyframes · ${count}/${total}` : "Generating 9:16 kids keyframes";
      }
      if (person.dept === "video" && aiPhase === "VIDEO") {
        const count = activeProject?.ai?.videoAssets?.length ?? 0;
        const total = activeProject?.totalScenes ?? 0;
        return total ? `Animating scenes with I2V · ${count}/${total}` : "Animating scene motion with I2V";
      }
      return "Standing by";
    }
    if (person.dept === "research") return stage === 0 && running ? "Developing story" : "Standing by";
    if (person.dept === "script") return stage === 1 && running ? "Writing screenplay" : "Standing by";
    if (person.dept === "director") return stage === 2 && running ? "Blocking shots" : "Standing by";
    if (person.dept === "image") return stage === 3 && running ? "Generating character keyframes" : "Standing by";
    if (person.dept === "video") return stage === 4 && running ? "Preparing scene motion" : "Standing by";
    if (person.dept === "tts") return stage === 5 && running ? "Generating character dialogue" : "Standing by";
    return "Standing by";
  };

  if (!ready) return <div className="app" style={{ placeItems: "center" }}><div className="muted">Loading workspace…</div></div>;

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><Bot size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">YOUTUBE FACTORY</div></div></div>
      <nav className="nav"><Link className="nav-item active" href="/"><LayoutDashboard size={14}/> Office</Link><Link className="nav-item" href="/projects"><FolderKanban size={14}/> Projects</Link><Link className="nav-item" href="/library"><ImageIcon size={14}/> Library</Link><Link className="nav-item" href="/analytics"><BarChart3 size={14}/> Analytics</Link><Link className="nav-item" href="/settings"><Settings size={14}/> Settings</Link></nav>
      <div className="topRight">
        <div className="chip"><small>Budget ceiling</small><b>Rp {workspace.settings.dailyCeiling.toLocaleString("id-ID")}</b></div>
        <div className="chip"><small>Completed</small><b><CalendarDays size={12} style={{verticalAlign:"-2px"}}/> {completedVideos} / {workspace.settings.targetVideos}</b></div>
      </div>
    </header>

    <div className="layout">
      <aside className="side left">
        <div className="title"><Users size={14}/> Employees</div>
        {people.map((person) => {
          const st = status(person.dept);
          return <button key={person.id} className={`emp ${selected === person.id ? "sel" : ""}`} onClick={() => setSelected(person.id)}>
            <div className="avatar" style={{background:`linear-gradient(145deg,${person.color},#fff)`}}>{person.name[0]}</div>
            <div><div className="ename">{person.name}</div><div className="erole">{person.role}</div><div className={`estate ${st.toLowerCase()}`}><span className="dot"/>{st} · {person.provider}</div></div>
          </button>;
        })}
        <Link className="hire" href="/projects">+ Create Project</Link>
        <div className="card"><div className="mini">Active project</div><div className="projectName">{activeProject?.title ?? "No active project"}</div><div className="muted">{activeProject ? `${activeProject.type} · ${activeProject.totalScenes} scenes` : "Create a project to start production."}</div><div className="prog"><i style={{width:`${pct}%`}}/></div><div className="projectFoot"><span>Scene {scene}/{totalScenes}</span><b>{pct}%</b></div></div>
        <div className="card"><div className="mini">Office status</div><div style={{fontSize:12,fontWeight:900,marginTop:6}}><span style={{display:"inline-block",width:8,height:8,borderRadius:99,background:resting?"#ffbe65":aiRunning?"#8db8ff":running?"#64dfa1":"#7f8791",marginRight:7}}/>{aiRunning ? "KIDS SHORTS PRE-PRODUCTION" : resting?"REST MODE":running?"PRODUCTION ACTIVE":"IDLE"}</div><div className="muted" style={{lineHeight:1.5}}>{aiRunning ? aiPhaseLabel[aiPhase] : "ChatGPT plan handles the story pipeline with OmniRoute fallback. Gemi creates the clean 9:16 keyframes, then GPT uses OmniRoute I2V to animate each scene."}</div></div>
      </aside>

      <section className="world">
        <OfficeWorld people={people.map((person) => ({ ...person, state: status(person.dept) }))} running={officeActive} resting={resting} selected={selected} onSelect={setSelected} workerCommand={workerCommand} maxBreaks={workspace.settings.maxBreaks}/>
        <div className="hud"><div className="toast"><Activity size={13}/>{toast}</div><div className="tip">Drag = rotate · Wheel = zoom · Shift + drag = pan</div></div>
      </section>

      <aside className="side right">
        <div className="card"><div className="title"><Gauge size={14}/> Production Pipeline</div>
          {pipe.map((item, i) => {
            const aiStageIndex = { RESEARCH: 0, SCRIPT: 1, DIRECTOR: 2, IMAGES: 3, VIDEO: 4 }[aiPhase as "RESEARCH" | "SCRIPT" | "DIRECTOR" | "IMAGES" | "VIDEO"];
            const done = activeProject
              ? aiRunning
                ? i < (aiStageIndex ?? -1)
                : i < stage && (scene > 0 || aiPhase === "COMPLETED")
              : false;
            const active = Boolean(
              activeProject &&
              ((aiRunning && i === aiStageIndex) || (running && i === stage))
            );
            return <div className="pipelineRow" key={item[0]}><div className={`node ${done ? "done" : active ? "active" : ""}`}>{done ? "✓" : i + 1}</div><div><div className="pname">{item[0]}</div><div className="pdetail">{item[1]}</div></div></div>;
          })}
        </div>

        <div className="card"><div className="title"><Sparkles size={14}/> OmniRoute AI Brain</div>
          <div className="muted" style={{lineHeight:1.5,marginBottom:10}}>ChatGPT plan handles Story → Screenplay → Director first; OmniRoute is the text fallback. Gemi creates the source keyframes, then GPT sends each scene to OmniRoute I2V for real character motion.</div>
          <div className="stat"><span>AI status</span><b>{aiPhaseLabel[aiPhase]}</b></div>
          <div className="stat"><span>Model</span><b>{activeProject?.ai?.model ?? "GPT account model"}</b></div>
          <button className="ctrl green" disabled={!activeProject || aiRunning} onClick={runAIPipeline}><Sparkles size={14}/>{aiRunning ? aiPhaseLabel[aiPhase] : "Run Full AI Pre-Production"}</button>
          {activeProject?.ai?.error && <div className="notice" style={{marginTop:10}}>FAILED · {activeProject.ai.error}</div>}
        </div>

        {activeProject?.ai?.phase === "COMPLETED" && <div className="card">
          <div className="title"><Bot size={14}/> AI Artifacts</div>
          <details><summary className="mini">Research brief</summary><div className="notice" style={{marginTop:8,whiteSpace:"pre-wrap",maxHeight:220,overflow:"auto"}}>{activeProject.ai.research}</div></details>
          <details style={{marginTop:8}}><summary className="mini">Script</summary><div className="notice" style={{marginTop:8,whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"}}>{activeProject.ai.script}</div></details>
          <details style={{marginTop:8}}><summary className="mini">Director scene plan · Kids Shorts</summary>
            <div className="notice" style={{marginTop:8,maxHeight:360,overflow:"auto"}}>
              {(activeProject.ai.scenePlans ?? []).map((scenePlan) => (
                <div key={scenePlan.sceneId} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
                  <div style={{fontWeight:800,fontSize:11}}>{scenePlan.sceneId} · {scenePlan.emotionalBeat ?? "kid-friendly beat"}</div>
                  <div className="muted" style={{fontSize:10,marginTop:4}}>{scenePlan.charactersPresent?.join(" + ") || "characters pending"} · static locked-off shot</div>
                  <div className="muted" style={{fontSize:10,marginTop:4}}>{scenePlan.motion ?? "timed character motion pending"}</div>
                  {(scenePlan.dialogue ?? []).map((line, lineIndex) => (
                    <div key={lineIndex} style={{marginTop:6,fontSize:11}}>
                      <b>{line.speaker}:</b> {line.line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
          {activeProject.ai.imageAssets && activeProject.ai.imageAssets.length > 0 && <div style={{marginTop:12}}>
            <div className="mini" style={{marginBottom:8}}>Gemi scene images · {activeProject.ai.imageAssets.length}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
              {activeProject.ai.imageAssets.map((asset) => (
                <a key={asset.sceneId} href={asset.assetUrl} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none"}}>
                  <img src={asset.assetUrl} alt={asset.sceneId} style={{width:"100%",aspectRatio:"9/16",objectFit:"cover",borderRadius:10,border:"1px solid rgba(255,255,255,.08)"}} />
                  <div className="muted" style={{fontSize:10,marginTop:4}}>{asset.sceneId}</div>
                </a>
              ))}
            </div>
          </div>}
          {activeProject.ai.videoAssets && activeProject.ai.videoAssets.length > 0 && <div style={{marginTop:12}}>
            <div className="mini" style={{marginBottom:8}}>GPT I2V scene videos · {activeProject.ai.videoAssets.length}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
              {activeProject.ai.videoAssets.map((asset) => (
                <a key={asset.sceneId} href={asset.assetUrl} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none"}}>
                  <video src={asset.assetUrl} muted playsInline controls preload="metadata" style={{display:"block",width:"100%",aspectRatio:"9/16",objectFit:"cover",borderRadius:10,border:"1px solid rgba(255,255,255,.08)"}} />
                  <div className="muted" style={{fontSize:10,marginTop:4}}>{asset.sceneId} · {asset.model ?? "I2V"}</div>
                </a>
              ))}
            </div>
          </div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            <button
              className="ctrl green compact"
              onClick={renderFinalVideo}
              disabled={rendering || (activeProject.ai?.videoAssets?.length ?? 0) < activeProject.totalScenes}
              title={(activeProject.ai?.videoAssets?.length ?? 0) < activeProject.totalScenes ? "Finish GPT Video Artist I2V generation first." : undefined}
            >
              <Sparkles size={14}/>{rendering ? "Rendering video…" : activeProject.ai.render?.status === "READY" ? "Render again" : "Render Final Video"}
            </button>
            {activeProject.ai.render?.status === "READY" && activeProject.ai.render.videoUrl && (
              <a className="ctrl blue compact" href={activeProject.ai.render.videoUrl} target="_blank" rel="noreferrer">▶ Open MP4</a>
            )}
            {activeProject.ai.render?.status === "READY" && activeProject.ai.render.thumbnailUrl && (
              <a className="ctrl compact" href={activeProject.ai.render.thumbnailUrl} target="_blank" rel="noreferrer">Open thumbnail</a>
            )}
          </div>
          {activeProject.ai.render?.status === "RENDERING" && <div className="notice" style={{marginTop:10}}>Combining GPT I2V scene videos with Windows Indonesian Speech Synthesis, subtitles, and FFmpeg.</div>}
          {activeProject.ai.render?.status === "FAILED" && <div className="notice" style={{marginTop:10}}>FAILED · {activeProject.ai.render.error}</div>}
          {activeProject.ai.render?.status === "READY" && <div className="notice" style={{marginTop:10}}>READY · MP4 created from generated Gemi keyframes plus real GPT I2V scene motion, Indonesian dialogue, subtitles, and FFmpeg finishing.</div>}
        </div>}

        <div className="card"><div className="title"><Sparkles size={14}/> Office Controls</div>
          <button className="ctrl green" onClick={startProduction} disabled={aiRunning}><Play size={14}/>{aiPhase === "COMPLETED" ? "Start Production" : "AI Pipeline → Start Production"}</button>
          <button className="ctrl blue" onClick={toggleRest} disabled={!activeProject || aiRunning}><Pause size={14}/> {resting ? "Resume" : "Pause / Rest"}</button>
          <button className="ctrl red" onClick={stopProduction} disabled={!running || aiRunning}>■ Stop</button>
          <div className="stat" style={{marginTop:12}}><span>Current scene</span><b>{scene}/{totalScenes}</b></div>
          <div className="stat"><span>Progress</span><b>{pct}%</b></div>
          <div className="stat"><span>Budget ceiling</span><b>Rp {workspace.settings.dailyCeiling.toLocaleString("id-ID")}</b></div>
        </div>

        <div className="card worker-detail">
          <div className="title"><Users size={14}/> Selected Worker</div>
          {selected ? (() => {
            const person = people.find((item) => item.id === selected);
            if (!person) return <div className="muted">Worker not found.</div>;
            const st = status(person.dept);
            const task = workerTask(person);
            return <div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}><div className="avatar avatar-lg" style={{background:"linear-gradient(145deg,"+person.color+",#fff)"}}>{person.name[0]}</div><div><div className="ename">{person.name}</div><div className="erole">{person.role}</div><div className="detail-provider">{person.provider}</div></div></div>
              <div className="detail-status"><span className={"detail-pill "+st.toLowerCase()}>{st.toLowerCase()}</span><span className="muted">Scene {scene}/{totalScenes}</span></div>
              <div className="detail-block"><div className="mini">Current task</div><div className="detail-value">{task}</div></div>
              <div className="worker-actions">
                <button className="worker-action amber" disabled={!running || resting || aiRunning} onClick={() => issueWorkerCommand("BREAK")}>☕ Send to break</button>
                <button className="worker-action" onClick={() => issueWorkerCommand("RETURN")}>↩ Call to desk</button>
              </div>
            </div>;
          })() : <div className="empty-detail"><div className="empty-icon">⌁</div><div className="ename">No worker selected</div><div className="muted">Select a character in the office or choose an employee on the left.</div></div>}
        </div>
      </aside>
    </div>
  </div>;
}
