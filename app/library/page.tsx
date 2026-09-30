"use client";

import Link from "next/link";
import { FolderOpen, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, type Workspace } from "../../lib/workspace";

export default function LibraryPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);

  useEffect(() => {
    setWorkspace(readWorkspace());
  }, []);

  const activeProjects = workspace.projects.filter((project) => project.status !== "DRAFT");

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><FolderOpen size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">LIBRARY</div></div></div>
      <nav className="nav"><Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><span className="nav-item active">Library</span><Link className="nav-item" href="/analytics">Analytics</Link><Link className="nav-item" href="/settings">Settings</Link></nav>
      <div className="topRight"><div className="chip"><small>Assets</small><b>0</b></div></div>
    </header>
    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="page-head"><div><div className="eyebrow">MEDIA</div><h1 className="page-title">Library</h1><div className="muted">Generated images, video, audio, and thumbnails will appear here after provider integrations are connected.</div></div></div>
      <div className="card">
        <div className="title"><FolderOpen size={14}/> ASSET LIBRARY</div>
        <div className="empty-page"><div className="empty-icon"><ImageIcon size={28}/></div><div className="ename">No generated assets</div><div className="muted">{activeProjects.length ? "The workspace has production projects, but no generated media has been recorded yet." : "Start by creating a project and running a production workflow."}</div><Link href={activeProjects.length ? "/" : "/projects"} className="ctrl blue compact" style={{textDecoration:"none",marginTop:12}}>{activeProjects.length ? "Open Office" : "Create Project"}</Link></div>
      </div>
    </div>
  </div>;
}
