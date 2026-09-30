"use client";

import Link from "next/link";
import { Bell, Save, Settings as SettingsIcon, Shield, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const [saved,setSaved]=useState(false);
  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><SettingsIcon size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">SETTINGS</div></div></div>
      <nav className="nav">
        <Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><Link className="nav-item" href="/library">Library</Link><Link className="nav-item" href="/analytics">Analytics</Link><span className="nav-item active">Settings</span>
      </nav>
    </header>
    <div style={{padding:22,maxWidth:900,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="card"><div className="title"><SlidersHorizontal size={14}/> PRODUCTION SETTINGS</div>
        <label className="muted">Daily hard ceiling (IDR)</label><input defaultValue="30000" style={input}/>
        <label className="muted">Target videos / day</label><input defaultValue="2" style={input}/>
        <label className="muted">Scenes / video</label><input defaultValue="30" style={input}/>
        <label className="muted">Break max simultaneous agents</label><input defaultValue="2" style={input}/>
        <button className="ctrl green" style={{width:"auto",padding:"10px 15px"}} onClick={()=>setSaved(true)}><Save size={14}/> {saved?"Saved":"Save Settings"}</button>
      </div>
      <div className="card"><div className="title"><Shield size={14}/> PROVIDERS</div>
        <div className="stat"><span>DeepSeek #1–#3</span><b>Configured later</b></div>
        <div className="stat"><span>Gemini</span><b>Image Worker</b></div>
        <div className="stat"><span>GPT</span><b>Video Worker</b></div>
        <div className="stat"><span>TTS</span><b>Voice Worker</b></div>
      </div>
      <div className="card"><div className="title"><Bell size={14}/> REST / LIMIT POLICY</div>
        <div className="muted" style={{lineHeight:1.7}}>When Gemini or GPT reaches a limit, the visual queue pauses. Completed scenes stay محفوظ and the queue resumes from the first unfinished scene when both workers are available again.</div>
      </div>
    </div>
  </div>;
}

const input={display:"block",width:"100%",margin:"7px 0 14px",padding:"10px 11px",borderRadius:10,border:"1px solid #ffffff12",background:"#ffffff06",color:"#fff",outline:"none"} as const;
