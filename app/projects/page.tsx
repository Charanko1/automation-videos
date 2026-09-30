"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clapperboard, Play, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { createProject, EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type Workspace } from "../../lib/workspace";

export default function ProjectsPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Documentary");
  const [scenes, setScenes] = useState("30");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const current = readWorkspace();
    setWorkspace(current);
  }, []);

  const persist = (next: Workspace) => {
    setWorkspace(next);
    writeWorkspace(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const sceneCount = Math.max(1, Number(scenes) || workspace.settings.scenesPerVideo);
    if (!title.trim()) return;
    const project = createProject(title, type, sceneCount);
    persist({
      ...workspace,
      projects: [...workspace.projects, project],
      activeProjectId: workspace.activeProjectId ?? project.id,
    });
    setTitle("");
    setType("Documentary");
    setScenes(String(workspace.settings.scenesPerVideo));
    setShowForm(false);
  };

  const activate = (id: string) => {
    persist({ ...workspace, activeProjectId: id });
  };

  const remove = (id: string) => {
    const remaining = workspace.projects.filter((project) => project.id !== id);
    persist({
      ...workspace,
      projects: remaining,
      activeProjectId: workspace.activeProjectId === id ? (remaining[0]?.id ?? null) : workspace.activeProjectId,
    });
  };

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><Clapperboard size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">PROJECTS</div></div></div>
      <nav className="nav"><Link className="nav-item" href="/"><ArrowLeft size={14}/> Office</Link><span className="nav-item active">Projects</span><Link className="nav-item" href="/library">Library</Link><Link className="nav-item" href="/analytics">Analytics</Link><Link className="nav-item" href="/settings">Settings</Link></nav>
      <div className="topRight"><div className="chip"><small>Projects</small><b>{workspace.projects.length}</b></div></div>
    </header>

    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="page-head"><div><div className="eyebrow">WORKSPACE</div><h1 className="page-title">Projects</h1><div className="muted">Create projects, choose the active production queue, and resume completed work.</div></div><button className="ctrl green compact" onClick={() => setShowForm((value) => !value)}><Plus size={14}/> New Project</button></div>

      {showForm && <form className="card project-form" onSubmit={submit}>
        <div className="title">CREATE PROJECT</div>
        <div className="form-grid">
          <label><span className="mini">Project name</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mystery of the Deep Ocean" autoFocus required /></label>
          <label><span className="mini">Format</span><select value={type} onChange={(e) => setType(e.target.value)}><option>Documentary</option><option>Explainer</option><option>Tech</option><option>Education</option><option>News</option><option>General</option></select></label>
          <label><span className="mini">Scenes</span><input type="number" min="1" max="500" value={scenes} onChange={(e) => setScenes(e.target.value)} required /></label>
        </div>
        <button className="ctrl blue compact" type="submit">Create project</button>
      </form>}

      <div className="card">
        <div className="title">PROJECT QUEUE <span style={{marginLeft:"auto",color:"#ffffff55",fontSize:9}}>{workspace.projects.length} PROJECTS</span></div>
        {workspace.projects.length === 0 ? <div className="empty-page"><div className="empty-icon">⌁</div><div className="ename">No projects yet</div><div className="muted">Create the first project to make it available in the Office production queue.</div></div> : workspace.projects.map((project) => {
          const active = project.id === workspace.activeProjectId;
          const progress = Math.round((project.currentScene / Math.max(project.totalScenes, 1)) * 100);
          return <div className={`project-row ${active ? "active-row" : ""}`} key={project.id}>
            <div className="project-main"><div className="projectName">{project.title}</div><div className="muted">{project.type} · {project.totalScenes} scenes</div><div className="prog"><i style={{width: progress+"%"}} /></div></div>
            <div><div className="mini">Status</div><div className={`status-text ${project.status.toLowerCase()}`}>{project.status === "COMPLETED" ? "Completed" : project.status === "PRODUCING" ? "Producing" : "Draft"}</div></div>
            <div><div className="mini">Progress</div><div style={{fontSize:11,fontWeight:800,marginTop:4}}>{project.currentScene}/{project.totalScenes} · {progress}%</div></div>
            <div className="project-actions">
              <button className="worker-action" onClick={() => activate(project.id)}>{active ? <><CheckCircle2 size={13}/> Active</> : <><Play size={13}/> Use</>}</button>
              <Link className="worker-action" href="/" onClick={() => activate(project.id)} style={{textDecoration:"none",justifyContent:"center"}}>Open</Link>
              <button className="worker-action danger" onClick={() => remove(project.id)} aria-label={`Delete ${project.title}`}><Trash2 size={13}/></button>
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
