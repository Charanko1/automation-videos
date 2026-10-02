"use client";

import Link from "next/link";
import { FolderOpen, Image as ImageIcon, Play, RefreshCw, Film, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_WORKSPACE, readWorkspace, type AIImageAsset, type Project, type Workspace } from "../../lib/workspace";

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

type ProjectImageGroup = {
  project: Project;
  images: AIImageAsset[];
};

export default function LibraryPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all">("all");

  const load = async () => {
    setLoading(true);

    // Scene images are the same AI imageAssets used by the Office sidebar.
    // Keep localStorage as the source of truth for those scene assets.
    setWorkspace(readWorkspace());

    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      const data = await response.json();
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "ai-office.workspace.v1") return;
      setWorkspace(readWorkspace());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const imageGroups = useMemo<ProjectImageGroup[]>(() => {
    return workspace.projects
      .map((project) => ({
        project,
        images: Array.isArray(project.ai?.imageAssets) ? project.ai.imageAssets : [],
      }))
      .filter((group) => group.images.length > 0);
  }, [workspace]);

  const visibleGroups = useMemo(() => {
    if (selectedProjectId === "all") return imageGroups;
    return imageGroups.filter((group) => group.project.id === selectedProjectId);
  }, [imageGroups, selectedProjectId]);

  const totalSceneImages = imageGroups.reduce((sum, group) => sum + group.images.length, 0);
  const activeProjects = workspace.projects.filter((project) => project.status !== "DRAFT");

  return <div className="app">
    <header className="top">
      <div className="brand">
        <div className="brandIcon"><FolderOpen size={21}/></div>
        <div>
          <div className="brandTitle">AI OFFICE</div>
          <div className="brandSub">LIBRARY</div>
        </div>
      </div>

      <nav className="nav">
        <Link className="nav-item" href="/">Office</Link>
        <Link className="nav-item" href="/projects">Projects</Link>
        <span className="nav-item active">Library</span>
        <Link className="nav-item" href="/analytics">Analytics</Link>
        <Link className="nav-item" href="/settings">Settings</Link>
      </nav>

      <div className="topRight">
        <div className="chip"><small>Scene images</small><b>{totalSceneImages}</b></div>
        <div className="chip"><small>Rendered videos</small><b>{assets.length}</b></div>
      </div>
    </header>

    <div style={{ padding: 22, maxWidth: 1280, width: "100%", margin: "0 auto", overflow: "auto" }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">MEDIA</div>
          <h1 className="page-title">Library</h1>
          <div className="muted">
            Scene images are synced with the same assets shown in Gemi&apos;s Office sidebar.
          </div>
        </div>

        <button className="ctrl compact" onClick={load} disabled={loading}>
          <RefreshCw size={14}/>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="card">
        <div className="title"><ImageIcon size={14}/> GEMI SCENE IMAGES</div>

        {imageGroups.length === 0 ? (
          <div className="empty-page">
            <div className="empty-icon"><ImageIcon size={28}/></div>
            <div className="ename">No scene images yet</div>
            <div className="muted">
              Run the AI pre-production pipeline from Office. Once Gemi generates images, they appear here automatically.
            </div>
            <Link href="/" className="ctrl blue compact" style={{ textDecoration: "none", marginTop: 12 }}>
              Open Office
            </Link>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 16px" }}>
              <button
                className={"ctrl compact " + (selectedProjectId === "all" ? "blue" : "")}
                onClick={() => setSelectedProjectId("all")}
              >
                All projects · {totalSceneImages}
              </button>

              {imageGroups.map(({ project, images }) => (
                <button
                  key={project.id}
                  className={"ctrl compact " + (selectedProjectId === project.id ? "blue" : "")}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  {project.title} · {images.length}
                </button>
              ))}
            </div>

            {visibleGroups.map(({ project, images }) => (
              <section key={project.id} style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", marginBottom: 10 }}>
                  <div>
                    <div className="mini">{project.type}</div>
                    <div className="projectName">{project.title}</div>
                  </div>
                  <div className="muted">{images.length} scene image{images.length === 1 ? "" : "s"}</div>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
                  gap: 12,
                }}>
                  {images.map((image) => (
                    <article key={project.id + "-" + image.sceneId} style={{
                      overflow: "hidden",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,.08)",
                      background: "#10141b",
                    }}>
                      <a href={image.assetUrl} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                        <img
                          src={image.assetUrl}
                          alt={project.title + " " + image.sceneId}
                          style={{
                            width: "100%",
                            aspectRatio: "16/9",
                            objectFit: "cover",
                            display: "block",
                            background: "#0b0f14",
                          }}
                        />
                      </a>

                      <div style={{ padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <div className="ename">{image.sceneId}</div>
                          <a
                            href={image.assetUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={"Open " + image.sceneId}
                            style={{ color: "inherit", opacity: 0.75 }}
                          >
                            <ExternalLink size={13}/>
                          </a>
                        </div>
                        <div className="muted" style={{ fontSize: 10, marginTop: 5 }}>
                          {image.model ?? "Image model"}
                        </div>
                        <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                          {image.generatedAt ? new Date(image.generatedAt).toLocaleString() : "Generation time unknown"}
                        </div>
                        {image.narrationExcerpt && (
                          <div className="notice" style={{
                            marginTop: 8,
                            fontSize: 10,
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                          }}>
                            {image.narrationExcerpt}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <div className="title"><Film size={14}/> RENDERED VIDEOS</div>

        {assets.length === 0 ? (
          <div className="empty-page">
            <div className="empty-icon"><Film size={28}/></div>
            <div className="ename">No rendered videos</div>
            <div className="muted">
              {activeProjects.length
                ? "Run Render Final Video from the Office AI Artifacts panel."
                : "Create a project, run the AI pipeline, then render the final video."}
            </div>
            <Link
              href={activeProjects.length ? "/" : "/projects"}
              className="ctrl blue compact"
              style={{ textDecoration: "none", marginTop: 12 }}
            >
              {activeProjects.length ? "Open Office" : "Create Project"}
            </Link>
          </div>
        ) : (
          assets.map((asset) => (
            <div
              className="project-row"
              key={asset.id}
              style={{ gridTemplateColumns: "150px 1fr auto", alignItems: "center" }}
            >
              <a
                href={asset.videoUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  width: 140,
                  height: 80,
                  overflow: "hidden",
                  borderRadius: 10,
                  background: "#10141b",
                }}
              >
                <img
                  src={asset.thumbnailUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </a>

              <div>
                <div className="projectName">{asset.title}</div>
                <div className="muted">
                  {asset.model ?? "Local renderer"} · {asset.durationSeconds ? asset.durationSeconds.toFixed(1) + "s" : "duration unknown"}
                </div>
                <div className="muted">
                  {asset.generatedAt ? new Date(asset.generatedAt).toLocaleString() : "render time unknown"}
                </div>
              </div>

              <div className="project-actions">
                <a className="worker-action" href={asset.videoUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  <Play size={13}/> Open MP4
                </a>
                <a className="worker-action" href={asset.manifestUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  Manifest
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="title">SYNC NOTE</div>
        <div className="notice">
          Gemi&apos;s scene images come from <b>workspace.projects[].ai.imageAssets</b>, the same data source
          used by the Office sidebar. Rendered videos remain sourced from <b>public/generated</b>.
        </div>
      </div>
    </div>
  </div>;
}
