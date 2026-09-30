"use client";

import Link from "next/link";
import { Bell, Check, Save, Settings as SettingsIcon, Shield, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type ProductionSettings, type Workspace } from "../../lib/workspace";

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [form, setForm] = useState<ProductionSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const current = readWorkspace();
    setWorkspace(current);
    setForm(current.settings);
  }, []);

  const update = <K extends keyof ProductionSettings>(key: K, value: number) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    const next: Workspace = {
      ...workspace,
      settings: {
        dailyCeiling: Math.max(0, Math.round(form.dailyCeiling)),
        targetVideos: Math.max(1, Math.round(form.targetVideos)),
        scenesPerVideo: Math.max(1, Math.min(500, Math.round(form.scenesPerVideo))),
        maxBreaks: Math.max(1, Math.min(6, Math.round(form.maxBreaks))),
      },
    };
    setWorkspace(next);
    setForm(next.settings);
    writeWorkspace(next);
    setSaved(true);
  };

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><SettingsIcon size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">SETTINGS</div></div></div>
      <nav className="nav"><Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><Link className="nav-item" href="/library">Library</Link><Link className="nav-item" href="/analytics">Analytics</Link><span className="nav-item active">Settings</span></nav>
    </header>
    <div style={{padding:22,maxWidth:900,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="page-head"><div><div className="eyebrow">CONFIGURATION</div><h1 className="page-title">Settings</h1><div className="muted">Workspace configuration is stored locally and reused by the Office and Projects pages.</div></div></div>
      <div className="card"><div className="title"><SlidersHorizontal size={14}/> PRODUCTION SETTINGS</div>
        <label className="setting-label"><span className="mini">Daily budget ceiling (IDR)</span><input type="number" min="0" value={form.dailyCeiling} onChange={(e) => update("dailyCeiling", Number(e.target.value))} /></label>
        <label className="setting-label"><span className="mini">Target completed projects / day</span><input type="number" min="1" value={form.targetVideos} onChange={(e) => update("targetVideos", Number(e.target.value))} /></label>
        <label className="setting-label"><span className="mini">Scenes per project</span><input type="number" min="1" max="500" value={form.scenesPerVideo} onChange={(e) => update("scenesPerVideo", Number(e.target.value))} /></label>
        <label className="setting-label"><span className="mini">Maximum concurrent break workers</span><input type="number" min="1" max="6" value={form.maxBreaks} onChange={(e) => update("maxBreaks", Number(e.target.value))} /></label>
        <button className="ctrl green compact" onClick={save}><Save size={14}/> {saved ? "Settings Saved" : "Save Settings"}</button>
      </div>
      <div className="card"><div className="title"><Shield size={14}/> PROVIDER CONFIGURATION</div>
        {[["DeepSeek #1–#3","Research, script, and direction workers"],["Gemini","Image generation worker"],["Video provider","Animation worker"],["TTS provider","Voice generation worker"],["YouTube","Publishing integration"]].map(([name,desc]) => <div className="provider-row" key={name}><div><div className="ename">{name}</div><div className="muted">{desc}</div></div><span className="provider-state"><span className="state-dot"/>Server configuration required</span></div>)}
      </div>
      <div className="card"><div className="title"><Bell size={14}/> OPERATIONS POLICY</div>
        <div className="notice"><Check size={14}/> Provider limits should pause the affected queue on the server. The client Office view only reflects the state supplied by the production engine.</div>
      </div>
    </div>
  </div>;
}
