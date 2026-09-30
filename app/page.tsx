"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {Activity, BarChart3, Bot, CalendarDays, Clapperboard, FolderKanban, Gauge, Image as ImageIcon, LayoutDashboard, Pause, Play, Settings, Sparkles, Users, Video, Volume2} from "lucide-react";
import {useEffect, useMemo, useState} from "react";

const OfficeWorld = dynamic(()=>import("../components/OfficeWorld"),{ssr:false});

const people=[
  {id:"rhea",name:"Rhea",role:"Researcher",provider:"DeepSeek #1",dept:"research",color:"#73a5ff"},
  {id:"wri",name:"Wri",role:"Scriptwriter",provider:"DeepSeek #2",dept:"script",color:"#f0bc68"},
  {id:"dira",name:"Dira",role:"Director",provider:"DeepSeek #3",dept:"director",color:"#c58aff"},
  {id:"gemi",name:"Gemi",role:"Image Artist",provider:"Gemini",dept:"image",color:"#68dcae"},
  {id:"gpt",name:"GPT",role:"Video Artist",provider:"GPT",dept:"video",color:"#72c7ff"},
  {id:"vox",name:"Vox",role:"Narrator",provider:"TTS",dept:"tts",color:"#ff8b94"}
];

const pipe=[
  ["Research","Find topics"],["Script","Write narrative"],["Director","Plan shots"],["Images","Generate art"],
  ["Video","Animate art"],["TTS","Create voice"],["Editing","Render final"],["Upload","Publish"]
];

export default function Page(){
  const [running,setRunning]=useState(false);
  const [resting,setResting]=useState(false);
  const [scene,setScene]=useState(12);
  const [selected,setSelected]=useState<string | null>(null);
  const [toast,setToast]=useState("Office ready.");
  const [limited,setLimited]=useState<Record<string,boolean>>({});
  const [limitResetAt,setLimitResetAt]=useState<Record<string,number>>({});
  const [now,setNow]=useState(Date.now());

  useEffect(()=>{ const timer=setInterval(()=>setNow(Date.now()),1000); return()=>clearInterval(timer); },[]);

  useEffect(()=>{
    if(!running||resting||scene>=30)return;
    const t=setInterval(()=>{
      setScene(v=>{
        if(v>=30){setRunning(false);setToast("Video finished.");return 30;}
        return v+1
      })
    },2100);
    return()=>clearInterval(t);
  },[running,resting,scene]);

  const cost=Math.min(30000,6200+scene*180);
  const pct=Math.round(scene/30*100);
  const toggleSelectedLimit=()=>{
    if(!selected)return;
    const next=!limited[selected];
    setLimited(v=>({...v,[selected]:next}));
    if(next)setLimitResetAt(v=>({...v,[selected]:Date.now()+90000}));
    else setLimitResetAt(v=>{const n={...v};delete n[selected];return n;});
    const name=people.find(p=>p.id===selected)?.name||"Worker";
    setToast(name+" limit "+(next?"triggered":"reset")+".");
  };

  const status=(dept:string,id?:string)=>{
    if(id && limited[id]) return "Limit";
    if(resting)return "Resting";
    if(!running)return "Idle";
    if(dept==="image"&&scene>=12)return "Working";
    if(dept==="video"&&scene>=14)return "Working";
    if(dept==="tts"&&scene>=18)return "Working";
    if(dept==="research"&&scene<4)return "Working";
    if(dept==="script"&&scene<8)return "Working";
    if(dept==="director"&&scene<12)return "Working";
    return "Idle";
  };

  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><Bot size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">YOUTUBE FACTORY</div></div></div>
      <nav className="nav"><Link className="nav-item active" href="/"><LayoutDashboard size={14}/> Office</Link><Link className="nav-item" href="/projects"><FolderKanban size={14}/> Projects</Link><Link className="nav-item" href="/library"><ImageIcon size={14}/> Library</Link><Link className="nav-item" href="/analytics"><BarChart3 size={14}/> Analytics</Link><Link className="nav-item" href="/settings"><Settings size={14}/> Settings</Link></nav>
      <div className="topRight">
        <div className="chip"><small>Daily Budget</small><b>Rp {cost.toLocaleString("id-ID")} <span style={{color:"#ffffff55"}}>/ 30K</span></b><div className="bar"><i style={{width:`${cost/300}%`}}/></div></div>
        <div className="chip"><small>Today</small><b><CalendarDays size={12} style={{verticalAlign:"-2px"}}/> 0 / 2 videos</b></div>
      </div>
    </header>

    <div className="layout">
      <aside className="side left">
        <div className="title"><Users size={14}/> Employees</div>
        {people.map(p=>{
          const st=status(p.dept,p.id);
          return <button key={p.id} className={`emp ${selected===p.id?"sel":""}`} onClick={()=>setSelected(p.id)}>
            <div className="avatar" style={{background:`linear-gradient(145deg,${p.color},#fff)`}}>{p.name[0]}</div>
            <div><div className="ename">{p.name}</div><div className="erole">{p.role}</div><div className={`estate ${st.toLowerCase()}`}><span className="dot"/>{st} · {p.provider}</div></div>
          </button>
        })}
        <button className="hire"><Users size={14}/> Hire Agent</button>
        <div className="card"><div className="mini">Current Project</div><div className="projectName">Misteri Kota Bawah Laut</div><div className="muted">8–10 min · Documentary</div><div className="prog"><i style={{width:`${pct}%`}}/></div><div className="projectFoot"><span>Scene {scene}/30</span><b>{pct}%</b></div></div>
        <div className="card"><div className="mini">Office Status</div><div style={{fontSize:12,fontWeight:900,marginTop:6}}><span style={{display:"inline-block",width:8,height:8,borderRadius:99,background:resting?"#ffbe65":running?"#64dfa1":"#7f8791",marginRight:7}}/>{resting?"REST MODE":running?"PRODUCTION ACTIVE":"IDLE"}</div><div className="muted" style={{lineHeight:1.5}}>If Gemini or GPT reaches a limit, pause the visual queue and resume from the last finished scene.</div></div>
      </aside>

      <section className="world">
        <OfficeWorld people={people.map(p=>({...p,state:status(p.dept,p.id)}))} running={running} resting={resting} selected={selected} onSelect={setSelected}/>
        <div className="hud"><div className="toast"><Activity size={13}/>{toast}</div><div className="tip">Drag = rotate · Wheel = zoom · Shift + drag = pan</div></div>
      </section>

      <aside className="side right">
        <div className="card"><div className="title"><Gauge size={14}/> Production Pipeline</div>
          {pipe.map((p,i)=>{
            const done=i<Math.floor(scene/5);
            const active=(scene>=12&&i===4)||(running&&i===Math.min(7,Math.floor(scene/4)));
            return <div className="pipelineRow" key={p[0]}><div className={`node ${done?"done":active?"active":""}`}>{done?"✓":i+1}</div><div><div className="pname">{p[0]}</div><div className="pdetail">{p[1]}</div></div></div>
          })}
        </div>
        <div className="card"><div className="title"><Sparkles size={14}/> Office Controls</div>
          <button className="ctrl green" onClick={()=>{setRunning(true);setResting(false);setToast("Production started. Workers online.");}}><Play size={14}/> Start Production</button>
          <button className="ctrl blue" onClick={()=>{setResting(v=>!v);setToast(!resting?"REST MODE activated.":"Production resumed.")}}><Pause size={14}/> {resting?"Resume":"Pause / Rest"}</button>
          <button className="ctrl red" onClick={()=>{setRunning(false);setResting(false);setToast("Production stopped.");}}>■ Stop</button>
          <button className="ctrl purple" disabled={!selected} onClick={toggleSelectedLimit}>{selected&&limited[selected]?"↻ Reset Limit":"⚠ Trigger Limit"}</button>
          <div className="stat" style={{marginTop:12}}><span>Current scene</span><b>{scene}/30</b></div>
          <div className="stat"><span>Daily cost</span><b>Rp {cost.toLocaleString("id-ID")}</b></div>
          <div className="stat"><span>Hard ceiling</span><b>Rp 30.000</b></div>
        </div>
        <div className="card worker-detail">
          <div className="title"><Users size={14}/> Selected Worker</div>
          {selected ? (()=>{const p=people.find(x=>x.id===selected); if(!p)return <div className="muted">Worker not found.</div>; const st=status(p.dept,p.id); const task=p.dept==="research"?(scene<4?"Finding trending topics":"Standing by"):p.dept==="script"?(scene<8?"Writing narrative":"Standing by"):p.dept==="director"?(scene<12?"Planning shots":"Standing by"):p.dept==="image"?(scene>=12&&scene<14?"Generating scene images":"Standing by"):p.dept==="video"?(scene>=14&&scene<18?"Animating scene":"Standing by"):p.dept==="tts"?(scene>=18&&scene<22?"Generating voice-over":"Standing by"):"Standing by"; const remaining=Math.max(0,(limitResetAt[p.id]||0)-now); const countdown=remaining?Math.ceil(remaining/1000)+"s":"—"; return <div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}><div className="avatar avatar-lg" style={{background:"linear-gradient(145deg,"+p.color+",#fff)"}}>{p.name[0]}</div><div><div className="ename">{p.name}</div><div className="erole">{p.role}</div><div className="detail-provider">{p.provider}</div></div></div>
            <div className="detail-status"><span className={"detail-pill "+st.toLowerCase()}>{st.toLowerCase()}</span><span className="muted">Scene {scene}/30</span></div>
            <div className="detail-block"><div className="mini">Current task</div><div className="detail-value">{task}</div></div>
            {st==="Limit"&&<div className="detail-block"><div className="mini">Mock reset</div><div className="detail-value">{countdown}</div></div>}
            <div className="worker-actions">
              <button className="worker-action amber" onClick={()=>setToast(p.name+" was asked to take a break (mock).")}>☕ Suruh istirahat</button>
              <button className="worker-action" onClick={()=>setToast(p.name+" was called back to their desk (mock).")}>↩ Panggil ke meja</button>
              <button className="worker-action purple" onClick={()=>{setLimited(v=>({...v,[p.id]:!v[p.id]})); if(!limited[p.id])setLimitResetAt(v=>({...v,[p.id]:Date.now()+90000})); else setLimitResetAt(v=>{const n={...v};delete n[p.id];return n;}); setToast(p.name+" limit "+(limited[p.id]?"reset":"triggered")+"." );}}>{limited[p.id]?"↻ Reset limit":"⚠ Picu limit"}</button>
            </div>
          </div>})() : <div className="empty-detail"><div className="empty-icon">⌁</div><div className="ename">No worker selected</div><div className="muted">Klik karakter di office 3D atau pilih employee di kiri.</div></div>}
        </div>
      </aside>
    </div>
  </div>
}
