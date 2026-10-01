"use client";

import Link from "next/link";
import { FolderOpen, Image as ImageIcon, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, type Workspace } from "../../lib/workspace";

type Asset = {
  id: string;
  title: string;
  model?: string | null;
  generatedAt?: string | null;
  durationSeconds?: number | null;
  videoUrl: string;
  thumbnailUrl: string;
  manifestUrl: string;
};

export default function LibraryPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/library");
      const data = await response.json();
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWorkspace(readWorkspace());
    load();
  }, []);

  const activeProjects = workspace.projects.filter((project) => project.status !== "DRAFT");

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><FolderOpen size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">LIBRARY</div></div></div>
      <nav className="nav"><Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><span className="nav-item active">Library</span><Link className="nav-item" href="/analytics">Analytics</Link><Link className="nav-item" href="/settings">Settings</Link></nav>
      <div className="topRight"><div className="chip"><small>Assets</small><b>{assets.length}</b></div></div>
    </header>

    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="page-head">
        <div><div className="eyebrow">MEDIA</div><h1 className="page-title">Library</h1><div className="muted">Locally rendered videos, narration, subtitles, thumbnails, and production manifests.</div></div>
        <button className="ctrl compact" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="card">
        <div className="title"><FolderOpen size={14}/> RENDERED ASSETS</div>
        {assets.length === 0 ? (
          <div className="empty-page">
            <div className="empty-icon"><ImageIcon size={28}/></div>
            <div className="ename">No rendered assets</div>
            <div className="muted">{activeProjects.length ? "Run Render Final Video from the Office AI Artifacts panel." : "Create a project, run the ChatGPT Go pipeline, then render the final video."}</div>
            <Link href={activeProjects.length ? "/" : "/projects"} className="ctrl blue compact" style={{textDecoration:"none",marginTop:12}}>{activeProjects.length ? "Open Office" : "Create Project"}</Link>
          </div>
        ) : assets.map((asset) => (
          <div className="project-row" key={asset.id} style={{gridTemplateColumns:"150px 1fr auto",alignItems:"center"}}>
            <a href={asset.videoUrl} target="_blank" rel="noreferrer" style={{display:"block",width:140,height:80,overflow:"hidden",borderRadius:10,background:"#10141b"}}>
              <img src={asset.thumbnailUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            </a>
            <div>
              <div className="projectName">{asset.title}</div>
              <div className="muted">{asset.model ?? "ChatGPT Go"} · {asset.durationSeconds ? asset.durationSeconds.toFixed(1) + "s" : "duration unknown"}</div>
              <div className="muted">{asset.generatedAt ? new Date(asset.generatedAt).toLocaleString() : "render time unknown"}</div>
            </div>
            <div className="project-actions">
              <a className="worker-action" href={asset.videoUrl} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}><Play size={13}/> Open MP4</a>
              <a className="worker-action" href={asset.manifestUrl} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Manifest</a>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="title">LOCAL RENDER NOTE</div>
        <div className="notice">This library is populated from the local <b>public/generated</b> folder. The current renderer uses ChatGPT-generated text plus Windows Speech Synthesis and FFmpeg; it does not call external AI image, video, or TTS providers.</div>
      </div>
    </div>
  </div>;
}
