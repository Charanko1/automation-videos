"use client";

import Link from "next/link";
import { Bell, Check, Save, Settings as SettingsIcon, Shield, SlidersHorizontal, Bot, ExternalLink, TestTube2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE, readWorkspace, writeWorkspace, type ProductionSettings, type Workspace } from "../../lib/workspace";

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [form, setForm] = useState<ProductionSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [chatgpt, setChatgpt] = useState<{ connected: boolean; planUsageEnabled: boolean; email?: string | null; error?: string } | null>(null);
  const [chatgptTesting, setChatgptTesting] = useState(false);
  const [chatgptGenerating, setChatgptGenerating] = useState(false);
  const [chatgptResult, setChatgptResult] = useState<string>("");
  const [chatgptPrompt, setChatgptPrompt] = useState("Say exactly: Hello from AI Office.");

  useEffect(() => {
    const current = readWorkspace();
    setWorkspace(current);
    setForm(current.settings);
  }, []);

  useEffect(() => {
    fetch("/api/chatgpt/status")
      .then((response) => response.json())
      .then((data) => setChatgpt(data))
      .catch(() => setChatgpt({ connected: false, planUsageEnabled: false, error: "Status unavailable" }));
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

  const testChatGPT = async () => {
    setChatgptTesting(true);
    setChatgptResult("");
    try {
      const response = await fetch("/api/chatgpt/test", { method: "POST" });
      const data = await response.json();
      setChatgptResult(
        data.ok
          ? `SUCCESS · ${data.message ?? "ChatGPT plan connection accepted."} · ${data.models?.[0]?.displayName ?? "model catalog available"}`
          : `FAILED · ${data.code ?? "unknown"} · ${data.error ?? "request failed"}`,
      );
    } catch {
      setChatgptResult("FAILED · Could not reach the local test endpoint.");
    } finally {
      setChatgptTesting(false);
    }
  };

  const generateChatGPT = async () => {
    const prompt = chatgptPrompt.trim();
    if (!prompt) {
      setChatgptResult("FAILED · Enter a prompt first.");
      return;
    }

    setChatgptGenerating(true);
    setChatgptResult("Generating with your ChatGPT plan…");
    try {
      const response = await fetch("/api/chatgpt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      setChatgptResult(
        data.ok
          ? `SUCCESS · ${data.displayName ?? data.model}\n\n${data.text || "(empty response)"}`
          : `FAILED · ${data.code ?? "unknown"} · ${data.error ?? "generation failed"}`,
      );
    } catch {
      setChatgptResult("FAILED · Could not reach the local inference endpoint.");
    } finally {
      setChatgptGenerating(false);
    }
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
      <div className="card">
        <div className="title"><Bot size={14}/> CHATGPT PLAN CONNECTION</div>
        <div className="muted" style={{lineHeight:1.6,margin:"8px 0 12px"}}>
          Experimental local test for OpenAI's Sign in with ChatGPT flow. It does not use an API key.
          OpenAI's current OSS docs describe ChatGPT plan usage for eligible accounts and Responses API requests; this screen is testing the direct local flow.
        </div>
        <div className="provider-row">
          <div>
            <div className="ename">{chatgpt?.connected ? (chatgpt.email ?? "ChatGPT connected") : "Not connected"}</div>
            <div className="muted">{chatgpt?.planUsageEnabled ? "ChatGPT plan usage permission granted" : "No ChatGPT plan usage permission"}</div>
          </div>
          <span className="provider-state"><span className="state-dot"/>{chatgpt?.planUsageEnabled ? "READY" : "LOCAL TEST"}</span>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
          <a className="ctrl green compact" href="/api/auth/chatgpt/start"><Bot size={14}/> Continue with ChatGPT</a>
          <button className="ctrl blue compact" disabled={!chatgpt?.planUsageEnabled || chatgptTesting} onClick={testChatGPT}><TestTube2 size={14}/>{chatgptTesting ? "Testing…" : "Test ChatGPT connection"}</button>
          <a className="ctrl compact" href="https://developers.openai.com/siwc/token-sharing-open-source" target="_blank" rel="noreferrer"><ExternalLink size={14}/> OpenAI docs</a>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginTop:12}}>
          <textarea
            value={chatgptPrompt}
            onChange={(e) => setChatgptPrompt(e.target.value)}
            rows={3}
            disabled={!chatgpt?.planUsageEnabled || chatgptGenerating}
            placeholder="Enter a prompt for the ChatGPT plan…"
            style={{width:"100%",resize:"vertical",padding:10,borderRadius:10,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.03)",color:"inherit"}}
          />
          <button className="ctrl green compact" style={{alignSelf:"start",height:"fit-content"}} disabled={!chatgpt?.planUsageEnabled || chatgptGenerating} onClick={generateChatGPT}>
            <Sparkles size={14}/>{chatgptGenerating ? "Generating…" : "Generate"}
          </button>
        </div>
        {chatgptResult && <div className="notice" style={{marginTop:10,whiteSpace:"pre-wrap"}}>{chatgptResult}</div>}
        <div className="muted" style={{fontSize:11,marginTop:10}}>Run this test from <b>http://127.0.0.1:3000</b>. Credentials are stored only in a local ignored file during development.</div>
      </div>
      <div className="card"><div className="title"><Shield size={14}/> PROVIDER CONFIGURATION</div>
        {[[ "DeepSeek #1–#3","Research, script, and direction workers"],["Gemini","Image generation worker"],["Video provider","Animation worker"],["TTS provider","Voice generation worker"],["YouTube","Publishing integration"]].map(([name,desc]) => <div className="provider-row" key={name}><div><div className="ename">{name}</div><div className="muted">{desc}</div></div><span className="provider-state"><span className="state-dot"/>Server configuration required</span></div>)}
      </div>
      <div className="card"><div className="title"><Bell size={14}/> OPERATIONS POLICY</div>
        <div className="notice"><Check size={14}/> Provider limits should pause the affected queue on the server. The client Office view only reflects the state supplied by the production engine.</div>
      </div>
    </div>
  </div>;
}
