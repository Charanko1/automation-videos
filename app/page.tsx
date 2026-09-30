"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, BarChart3, Bot, CalendarDays, FolderKanban, Gauge, Image as ImageIcon, LayoutDashboard, Pause, Play, Settings, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type Workspace } from "../lib/workspace";

const OfficeWorld = dynamic(() => import("../components/OfficeWorld"), { ssr: false });

const people = [
  { id: "rhea", name: "Rhea", role: "Researcher", provider: "DeepSeek #1", dept: "research", color: "#73a5ff" },
  { id: "wri", name: "Wri", role: "Scriptwriter", provider: "DeepSeek #2", dept: "script", color: "#f0bc68" },
  { id: "dira", name: "Dira", role: "Director", provider: "DeepSeek #3", dept: "director", color: "#c58aff" },
  { id: "gemi", name: "Gemi", role: "Image Artist", provider: "Gemini", dept: "image", color: "#68dcae" },
  { id: "gpt", name: "GPT", role: "Video Artist", provider: "GPT", dept: "video", color: "#72c7ff" },
  { id: "vox", name: "Vox", role: "Narrator", provider: "TTS", dept: "tts", color: "#ff8b94" },
];

const pipe = [
  ["Research", "Find topics"], ["Script", "Write narrative"], ["Director", "Plan shots"], ["Images", "Generate art"],
  ["Video", "Animate art"], ["TTS", "Create voice"], ["Editing", "Render final"], ["Upload", "Publish"],
];

type WorkerCommand = { workerId: string; type: "BREAK" | "RETURN"; nonce: number };

function projectStage(scene: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(pipe.length - 1, Math.floor((scene / total) * pipe.length));
}

export default function Page() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [resting, setResting] = useState(false);
  const [scene, setScene] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState("Workspace ready.");
  const [workerCommand, setWorkerCommand] = useState<WorkerCommand | null>(null);

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? null,
    [workspace],
  );
  const totalScenes = activeProject?.totalScenes ?? workspace.settings.scenesPerVideo;
  const pct = activeProject ? Math.round((scene / Math.max(totalScenes, 1)) * 100) : 0;
  const completedVideos = workspace.projects.filter((project) => project.status === "COMPLETED").length;
  const stage = projectStage(scene, totalScenes);

  useEffect(() => {
    const current = readWorkspace();
    setWorkspace(current);
    setScene(current.projects.find((project) => project.id === current.activeProjectId)?.currentScene ?? 0);
    setReady(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "ai-office.workspace.v1") return;
      const next = readWorkspace();
      setWorkspace(next);
      if (!running) setScene(next.projects.find((project) => project.id === next.activeProjectId)?.currentScene ?? 0);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [running]);

  useEffect(() => {
    if (!ready) return;
    const nextScene = activeProject?.currentScene ?? 0;
    setScene(nextScene);
    setRunning(false);
    setResting(false);
  }, [activeProject?.id]);

  useEffect(() => {
    if (!ready || !running || resting || !activeProject) return;
    const timer = window.setInterval(() => {
      setScene((current) => {
        const next = Math.min(current + 1, totalScenes);
        setWorkspace((currentWorkspace) => {
          const updated = currentWorkspace.projects.map((project) =>
            project.id === activeProject.id
              ? {
                  ...project,
                  currentScene: next,
                  status: next >= project.totalScenes ? "COMPLETED" : "PRODUCING",
                  updatedAt: new Date().toISOString(),
                }
              : project,
          );
          const updatedWorkspace = { ...currentWorkspace, projects: updated };
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
  }, [activeProject?.id, activeProject?.totalScenes, ready, resting, running, totalScenes]);

  const updateActiveProject = (patch: Partial<Workspace["projects"][number]>) => {
    if (!activeProject) return;
    setWorkspace((current) => {
      const updatedWorkspace = {
        ...current,
        projects: current.projects.map((project) => project.id === activeProject.id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project),
      };
      writeWorkspace(updatedWorkspace);
      return updatedWorkspace;
    });
  };

  const startProduction = () => {
    if (!activeProject) {
      setToast("Create or activate a project before starting production.");
      return;
    }
    if (scene >= activeProject.totalScenes) {
      setToast("This project is already completed.");
      return;
    }
    updateActiveProject({ status: "PRODUCING" });
    setRunning(true);
    setResting(false);
    setToast("Production started.");
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
    if (type === "BREAK" && (!running || resting)) {
      setToast("Start production before sending a worker to break.");
      return;
    }
    const worker = people.find((person) => person.id === selected);
    setWorkerCommand((current) => ({ workerId: selected, type, nonce: (current?.nonce ?? 0) + 1 }));
    setToast(type === "BREAK" ? `${worker?.name ?? "Worker"} sent to break.` : `${worker?.name ?? "Worker"} called back to desk.`);
  };

  const status = (dept: string) => {
    if (resting || !running || !activeProject) return resting ? "Resting" : "Idle";
    const deptStage = { research: 0, script: 1, director: 2, image: 3, video: 4, tts: 5 }[dept as keyof Record<string, number>];
    return deptStage === stage ? "Working" : "Idle";
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
        <div className="card"><div className="mini">Office status</div><div style={{fontSize:12,fontWeight:900,marginTop:6}}><span style={{display:"inline-block",width:8,height:8,borderRadius:99,background:resting?"#ffbe65":running?"#64dfa1":"#7f8791",marginRight:7}}/>{resting?"REST MODE":running?"PRODUCTION ACTIVE":"IDLE"}</div><div className="muted" style={{lineHeight:1.5}}>Worker movement follows the active production state. Provider usage and billing are tracked by the server integration.</div></div>
      </aside>

      <section className="world">
        <OfficeWorld people={people.map((person) => ({ ...person, state: status(person.dept) }))} running={running} resting={resting} selected={selected} onSelect={setSelected} workerCommand={workerCommand} maxBreaks={workspace.settings.maxBreaks}/>
        <div className="hud"><div className="toast"><Activity size={13}/>{toast}</div><div className="tip">Drag = rotate · Wheel = zoom · Shift + drag = pan</div></div>
      </section>

      <aside className="side right">
        <div className="card"><div className="title"><Gauge size={14}/> Production Pipeline</div>
          {pipe.map((item, i) => {
            const done = activeProject ? i < stage && scene > 0 : false;
            const active = Boolean(activeProject && running && i === stage);
            return <div className="pipelineRow" key={item[0]}><div className={`node ${done ? "done" : active ? "active" : ""}`}>{done ? "✓" : i + 1}</div><div><div className="pname">{item[0]}</div><div className="pdetail">{item[1]}</div></div></div>;
          })}
        </div>
        <div className="card"><div className="title"><Sparkles size={14}/> Office Controls</div>
          <button className="ctrl green" onClick={startProduction}><Play size={14}/> Start Production</button>
          <button className="ctrl blue" onClick={toggleRest} disabled={!activeProject}><Pause size={14}/> {resting ? "Resume" : "Pause / Rest"}</button>
          <button className="ctrl red" onClick={stopProduction} disabled={!running && !resting}>■ Stop</button>
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
            const task = person.dept === "research" ? (stage === 0 && running ? "Finding topics" : "Standing by") : person.dept === "script" ? (stage === 1 && running ? "Writing narrative" : "Standing by") : person.dept === "director" ? (stage === 2 && running ? "Planning shots" : "Standing by") : person.dept === "image" ? (stage === 3 && running ? "Generating scene images" : "Standing by") : person.dept === "video" ? (stage === 4 && running ? "Animating scenes" : "Standing by") : person.dept === "tts" ? (stage === 5 && running ? "Generating voice-over" : "Standing by") : "Standing by";
            return <div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}><div className="avatar avatar-lg" style={{background:"linear-gradient(145deg,"+person.color+",#fff)"}}>{person.name[0]}</div><div><div className="ename">{person.name}</div><div className="erole">{person.role}</div><div className="detail-provider">{person.provider}</div></div></div>
              <div className="detail-status"><span className={"detail-pill "+st.toLowerCase()}>{st.toLowerCase()}</span><span className="muted">Scene {scene}/{totalScenes}</span></div>
              <div className="detail-block"><div className="mini">Current task</div><div className="detail-value">{task}</div></div>
              <div className="worker-actions">
                <button className="worker-action amber" disabled={!running || resting} onClick={() => issueWorkerCommand("BREAK")}>☕ Send to break</button>
                <button className="worker-action" onClick={() => issueWorkerCommand("RETURN")}>↩ Call to desk</button>
              </div>
            </div>;
          })() : <div className="empty-detail"><div className="empty-icon">⌁</div><div className="ename">No worker selected</div><div className="muted">Select a character in the office or choose an employee on the left.</div></div>}
        </div>
      </aside>
    </div>
  </div>;
}
