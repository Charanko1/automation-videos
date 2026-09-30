"use client";

import Link from "next/link";
import { Activity, BarChart3, CheckCircle2, DollarSign, PlayCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, type Workspace } from "../../lib/workspace";

export default function AnalyticsPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);

  useEffect(() => {
    setWorkspace(readWorkspace());
  }, []);

  const stats = useMemo(() => {
    const completed = workspace.projects.filter((project) => project.status === "COMPLETED").length;
    const producing = workspace.projects.filter((project) => project.status === "PRODUCING").length;
    const scenes = workspace.projects.reduce((sum, project) => sum + project.currentScene, 0);
    const totalScenes = workspace.projects.reduce((sum, project) => sum + project.totalScenes, 0);
    return { completed, producing, scenes, totalScenes };
  }, [workspace]);

  const statCards = [
    { label: "Completed projects", value: stats.completed, icon: CheckCircle2 },
    { label: "Active production", value: stats.producing, icon: PlayCircle },
    { label: "Scenes processed", value: stats.scenes, icon: Activity },
    { label: "Scene capacity", value: stats.totalScenes, icon: BarChart3 },
  ];

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><BarChart3 size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">ANALYTICS</div></div></div>
      <nav className="nav"><Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><Link className="nav-item" href="/library">Library</Link><span className="nav-item active">Analytics</span><Link className="nav-item" href="/settings">Settings</Link></nav>
    </header>
    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="page-head"><div><div className="eyebrow">OPERATIONS</div><h1 className="page-title">Analytics</h1><div className="muted">Metrics are derived from the projects stored in this workspace.</div></div></div>
      <div className="analytics-grid">
        {statCards.map(({ label, value, icon: Icon }) => <div className="card" key={label}><div className="title"><Icon size={14}/>{label}</div><div style={{fontSize:26,fontWeight:900}}>{value}</div><div className="muted">Workspace total</div></div>)}
      </div>
      <div className="card">
        <div className="title"><BarChart3 size={14}/> PROJECT PROGRESS</div>
        {workspace.projects.length === 0 ? <div className="empty-page"><div className="empty-icon"><Activity size={28}/></div><div className="ename">No analytics yet</div><div className="muted">Production metrics will appear after projects are created and processed.</div></div> : workspace.projects.map((project) => {
          const progress = Math.round((project.currentScene / Math.max(project.totalScenes, 1)) * 100);
          return <div key={project.id} className="analytics-row"><div style={{minWidth:220}}><div className="projectName">{project.title}</div><div className="muted">{project.type}</div></div><div className="prog"><i style={{width:progress+"%"}} /></div><div className="analytics-value">{progress}%</div></div>;
        })}
      </div>
      <div className="card">
        <div className="title"><DollarSign size={14}/> COST TELEMETRY</div>
        <div className="notice">Provider billing is not estimated on the client. Actual usage and cost should be supplied by the server integration.</div>
      </div>
    </div>
  </div>;
}
