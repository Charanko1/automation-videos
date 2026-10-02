"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, BarChart3, Bot, CalendarDays, FolderKanban, Gauge, Image as ImageIcon, LayoutDashboard, Pause, Play, Settings, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type AIProduction, type Workspace } from "../lib/workspace";

const OfficeWorld = dynamic(() => import("../components/OfficeWorld"), { ssr: false });

const people = [
  { id: "rhea", name: "Rhea", role: "Researcher", provider: "OmniRoute · Free Provider Router", dept: "research", color: "#73a5ff" },
  { id: "wri", name: "Wri", role: "Scriptwriter", provider: "OmniRoute · Free Provider Router", dept: "script", color: "#f0bc68" },
  { id: "dira", name: "Dira", role: "Director", provider: "OmniRoute · Free Provider Router", dept: "director", color: "#c58aff" },
  { id: "gemi", name: "Gemi", role: "Image Artist", provider: "Cloudflare Workers AI", dept: "image", color: "#68dcae" },
  { id: "gpt", name: "GPT", role: "Video Artist", provider: "ChatGPT Go", dept: "video", color: "#72c7ff" },
  { id: "vox", name: "Vox", role: "Narrator", provider: "ChatGPT Go", dept: "tts", color: "#ff8b94" },
];

const pipe = [
  ["Research", "Find topics"], ["Script", "Write narrative"], ["Director", "Plan shots"], ["Images", "Generate art"],
  ["Video", "Animate art"], ["TTS", "Create voice"], ["Editing", "Render final"], ["Upload", "Publish"],
];

const aiPhaseLabel: Record<string, string> = {
  IDLE: "Ready",
  RESEARCH: "Rhea · Researching",
  SCRIPT: "Wri · Writing",
  DIRECTOR: "Dira · Planning",
  IMAGES: "Gemi · Generating scene images",
  COMPLETED: "Pre-production + Gemi images complete",
  FAILED: "Pipeline failed",
};

type WorkerCommand = { workerId: string; type: "BREAK" | "RETURN"; nonce: number };

function projectStage(scene: number, total: number, preProductionComplete = false) {
  if (total <= 0) return 0;
  if (!preProductionComplete) {
    return Math.min(3, Math.floor((scene / total) * 4));
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
    setToast("Rhea is researching the project with OmniRoute · Free Provider Router.");
    updateActiveAI({ phase: "RESEARCH", error: undefined });
    updateActiveProject({ status: "PRODUCING" });

    try {
      const researchResponse = await fetch("/api/production/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "research", title: activeProject.title, format: activeProject.type }),
      });
      const researchData = await researchResponse.json();
      if (!researchResponse.ok || !researchData.ok) {
        throw new Error(researchData.error ?? "Research stage failed.");
      }

      updateActiveAI({
        phase: "SCRIPT",
        research: researchData.text,
        model: researchData.model,
        error: undefined,
      });
      setToast("Rhea finished. Wri is writing the script with OmniRoute · Free Provider Router.");

      const scriptResponse = await fetch("/api/production/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "script",
          title: activeProject.title,
          format: activeProject.type,
          research: researchData.text,
        }),
      });
      const scriptData = await scriptResponse.json();
      if (!scriptResponse.ok || !scriptData.ok) {
        throw new Error(scriptData.error ?? "Script stage failed.");
      }

      updateActiveAI({
        phase: "DIRECTOR",
        script: scriptData.text,
        model: scriptData.model ?? researchData.model,
        error: undefined,
      });
      setToast("Wri finished. Dira is turning the script into a scene plan with OmniRoute.");

      const directorResponse = await fetch("/api/production/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "director",
          title: activeProject.title,
          format: activeProject.type,
          script: scriptData.text,
        }),
      });
      const directorData = await directorResponse.json();
      if (!directorResponse.ok || !directorData.ok) {
        throw new Error(directorData.error ?? "Director stage failed.");
      }

      const directorScenes = Array.isArray(directorData.scenes) ? directorData.scenes : [];
      if (directorScenes.length === 0) {
        throw new Error("Dira returned no production scenes.");
      }

      updateActiveAI({
        phase: "IMAGES",
        director: directorData.text,
        characterBible: directorData.characterBible ?? "",
        imageAssets: [],
        model: directorData.model ?? scriptData.model ?? researchData.model,
        error: undefined,
      });

      updateActiveProject({
        status: "PRODUCING",
        currentScene: 0,
        totalScenes: directorScenes.length,
      });
      setScene(0);
      setToast(`Dira finished. Gemi is generating ${directorScenes.length} scene images with Cloudflare Workers AI.`);

      const generatedAssets: NonNullable<AIProduction["imageAssets"]> = [];
      for (let index = 0; index < directorScenes.length; index += 1) {
        const scenePlan = directorScenes[index];
        setToast(`Gemi · Scene ${index + 1}/${directorScenes.length} · Generating image…`);

        const imageResponse = await fetch("/api/production/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProject.id,
            sceneId: scenePlan.sceneId,
            prompt: scenePlan.visualPrompt,
            characterBible: directorData.characterBible ?? "",
          }),
        });
        const imageData = await imageResponse.json().catch(() => ({}));
        if (!imageResponse.ok || !imageData.ok) {
          throw new Error(imageData.error ?? `Image generation failed for ${scenePlan.sceneId}.`);
        }

        generatedAssets.push({
          sceneId: scenePlan.sceneId,
          assetUrl: imageData.assetUrl,
          model: imageData.model,
          narrationExcerpt: scenePlan.narrationExcerpt,
          generatedAt: new Date().toISOString(),
        });
        updateActiveAI({
          phase: "IMAGES",
          imageAssets: [...generatedAssets],
          error: undefined,
        });
      }

      // AI pre-production is now complete: the project has a scene plan plus real image assets.
      updateActiveAI({
        phase: "COMPLETED",
        imageAssets: generatedAssets,
        director: directorData.text,
        characterBible: directorData.characterBible ?? "",
        model: directorData.model ?? scriptData.model ?? researchData.model,
        error: undefined,
      });

      // Hand the image-complete project to the normal production loop.
      updateActiveProject({ status: "PRODUCING", currentScene: 0 });
      setScene(0);
      setRunning(true);
      setResting(false);
      setToast("AI pipeline complete. Research → Script → Director → Gemi Images → Production started.");
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
    setToast("Local renderer: generating narration and assembling the video…");
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
          imageAssets: activeProject.ai.imageAssets ?? [],
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
      setToast("Video rendered successfully. Open Library or preview it below.");
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
    if (scene >= activeProject.totalScenes) {
      setToast("This project is already completed.");
      return;
    }

    const needsAI =
      (activeProject.ai?.phase ?? "IDLE") !== "COMPLETED" ||
      (activeProject.ai?.imageAssets?.length ?? 0) === 0;
    if (needsAI) {
      const completed = await runAIPipeline();
      if (!completed) return;
    }

    updateActiveProject({ status: "PRODUCING" });
    setRunning(true);
    setResting(false);
    setToast("Production started after the OmniRoute Free + Cloudflare Workers AI pipeline.");
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
      const aiStage = { research: "RESEARCH", script: "SCRIPT", director: "DIRECTOR", image: "IMAGES" }[dept];
      if (aiStage === aiPhase) return "Working";
      return "Idle";
    }
    if (resting || !running || !activeProject) return resting ? "Resting" : "Idle";
    const deptStage = { research: 0, script: 1, director: 2, image: 3, video: 4, tts: 5 }[dept as keyof Record<string, number>];
    return deptStage === stage ? "Working" : "Idle";
  };

  const workerTask = (person: (typeof people)[number]) => {
    if (aiRunning) {
      if (person.dept === "research" && aiPhase === "RESEARCH") return "Researching project";
      if (person.dept === "script" && aiPhase === "SCRIPT") return "Writing YouTube script";
      if (person.dept === "director" && aiPhase === "DIRECTOR") return "Planning production scenes";
      if (person.dept === "image" && aiPhase === "IMAGES") {
        const count = activeProject?.ai?.imageAssets?.length ?? 0;
        const total = activeProject?.totalScenes ?? 0;
        return total ? `Generating scene images · ${count}/${total}` : "Generating scene images";
      }
      return "Standing by";
    }
    if (person.dept === "research") return stage === 0 && running ? "Finding topics" : "Standing by";
    if (person.dept === "script") return stage === 1 && running ? "Writing narrative" : "Standing by";
    if (person.dept === "director") return stage === 2 && running ? "Planning shots" : "Standing by";
    if (person.dept === "image") return stage === 3 && running ? "Generating scene images" : "Standing by";
    if (person.dept === "video") return stage === 4 && running ? "Animating scenes" : "Standing by";
    if (person.dept === "tts") return stage === 5 && running ? "Generating voice-over" : "Standing by";
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
        <div className="card"><div className="mini">Office status</div><div style={{fontSize:12,fontWeight:900,marginTop:6}}><span style={{display:"inline-block",width:8,height:8,borderRadius:99,background:resting?"#ffbe65":aiRunning?"#8db8ff":running?"#64dfa1":"#7f8791",marginRight:7}}/>{aiRunning ? "AI PRE-PRODUCTION" : resting?"REST MODE":running?"PRODUCTION ACTIVE":"IDLE"}</div><div className="muted" style={{lineHeight:1.5}}>{aiRunning ? aiPhaseLabel[aiPhase] : "Worker movement follows the active production state. OmniRoute · Free Provider Router handles research, scripts, and direction; Gemi uses Cloudflare Workers AI for scene images."}</div></div>
      </aside>

      <section className="world">
        <OfficeWorld people={people.map((person) => ({ ...person, state: status(person.dept) }))} running={officeActive} resting={resting} selected={selected} onSelect={setSelected} workerCommand={workerCommand} maxBreaks={workspace.settings.maxBreaks}/>
        <div className="hud"><div className="toast"><Activity size={13}/>{toast}</div><div className="tip">Drag = rotate · Wheel = zoom · Shift + drag = pan</div></div>
      </section>

      <aside className="side right">
        <div className="card"><div className="title"><Gauge size={14}/> Production Pipeline</div>
          {pipe.map((item, i) => {
            const aiStageIndex = { RESEARCH: 0, SCRIPT: 1, DIRECTOR: 2, IMAGES: 3 }[aiPhase as "RESEARCH" | "SCRIPT" | "DIRECTOR" | "IMAGES"];
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
          <div className="muted" style={{lineHeight:1.5,marginBottom:10}}>OmniRoute handles Research → Script → Director. Gemi then turns Dira&apos;s scene prompts into real 16:9 images with Cloudflare Workers AI.</div>
          <div className="stat"><span>AI status</span><b>{aiPhaseLabel[aiPhase]}</b></div>
          <div className="stat"><span>Model</span><b>{activeProject?.ai?.model ?? "GPT account model"}</b></div>
          <button className="ctrl green" disabled={!activeProject || aiRunning} onClick={runAIPipeline}><Sparkles size={14}/>{aiRunning ? aiPhaseLabel[aiPhase] : "Run Full AI Pre-Production"}</button>
          {activeProject?.ai?.error && <div className="notice" style={{marginTop:10}}>FAILED · {activeProject.ai.error}</div>}
        </div>

        {activeProject?.ai?.phase === "COMPLETED" && <div className="card">
          <div className="title"><Bot size={14}/> AI Artifacts</div>
          <details><summary className="mini">Research brief</summary><div className="notice" style={{marginTop:8,whiteSpace:"pre-wrap",maxHeight:220,overflow:"auto"}}>{activeProject.ai.research}</div></details>
          <details style={{marginTop:8}}><summary className="mini">Script</summary><div className="notice" style={{marginTop:8,whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"}}>{activeProject.ai.script}</div></details>
          <details style={{marginTop:8}}><summary className="mini">Director scene plan</summary><div className="notice" style={{marginTop:8,whiteSpace:"pre-wrap",maxHeight:280,overflow:"auto"}}>{activeProject.ai.director}</div></details>
          {activeProject.ai.imageAssets && activeProject.ai.imageAssets.length > 0 && <div style={{marginTop:12}}>
            <div className="mini" style={{marginBottom:8}}>Gemi scene images · {activeProject.ai.imageAssets.length}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
              {activeProject.ai.imageAssets.map((asset) => (
                <a key={asset.sceneId} href={asset.assetUrl} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none"}}>
                  <img src={asset.assetUrl} alt={asset.sceneId} style={{width:"100%",aspectRatio:"16/9",objectFit:"cover",borderRadius:10,border:"1px solid rgba(255,255,255,.08)"}} />
                  <div className="muted" style={{fontSize:10,marginTop:4}}>{asset.sceneId}</div>
                </a>
              ))}
            </div>
          </div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            <button className="ctrl green compact" onClick={renderFinalVideo} disabled={rendering}>
              <Sparkles size={14}/>{rendering ? "Rendering video…" : activeProject.ai.render?.status === "READY" ? "Render again" : "Render Final Video"}
            </button>
            {activeProject.ai.render?.status === "READY" && activeProject.ai.render.videoUrl && (
              <a className="ctrl blue compact" href={activeProject.ai.render.videoUrl} target="_blank" rel="noreferrer">▶ Open MP4</a>
            )}
            {activeProject.ai.render?.status === "READY" && activeProject.ai.render.thumbnailUrl && (
              <a className="ctrl compact" href={activeProject.ai.render.thumbnailUrl} target="_blank" rel="noreferrer">Open thumbnail</a>
            )}
          </div>
          {activeProject.ai.render?.status === "RENDERING" && <div className="notice" style={{marginTop:10}}>Rendering locally with Windows Speech Synthesis + FFmpeg. This creates a real MP4 with narration and subtitles.</div>}
          {activeProject.ai.render?.status === "FAILED" && <div className="notice" style={{marginTop:10}}>FAILED · {activeProject.ai.render.error}</div>}
          {activeProject.ai.render?.status === "READY" && <div className="notice" style={{marginTop:10}}>READY · MP4 created locally with narration, subtitles, and the generated Gemi scene images when available.</div>}
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
