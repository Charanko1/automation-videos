"use client";

import Link from "next/link";
import { ArrowLeft, Clapperboard, MoreHorizontal, Play } from "lucide-react";

const projects = [
  { title:"Misteri Kota Bawah Laut", type:"Documentary", progress:40, scene:"12/30", status:"Producing", cost:"Rp 8.360" },
  { title:"5 AI Tools yang Wajib Dicoba", type:"Tech", progress:100, scene:"30/30", status:"Ready to Upload", cost:"Rp 11.420" },
  { title:"Kenapa Robot Belajar?", type:"Explainer", progress:18, scene:"6/32", status:"Queued", cost:"Rp 2.980" },
];

export default function ProjectsPage() {
  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><Clapperboard size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">PROJECTS</div></div></div>
      <nav className="nav">
        <Link className="nav-item" href="/"><ArrowLeft size={14}/> Office</Link>
        <span className="nav-item active">Projects</span>
        <Link className="nav-item" href="/library">Library</Link>
        <Link className="nav-item" href="/analytics">Analytics</Link>
        <Link className="nav-item" href="/settings">Settings</Link>
      </nav>
      <div className="topRight"><div className="chip"><small>Daily Budget</small><b>Rp 8.360 <span>/ 30K</span></b><div className="bar"><i style={{width:"27.9%"}} /></div></div></div>
    </header>
    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="card">
        <div className="title">PROJECTS <span style={{marginLeft:"auto",color:"#ffffff55",fontSize:9}}>3 PROJECTS</span></div>
        {projects.map((p,i)=><div key={p.title} style={{display:"grid",gridTemplateColumns:"minmax(260px,1fr) 160px 120px 88px",gap:14,alignItems:"center",padding:"14px 0",borderTop:i?"1px solid #ffffff0b":"0"}}>
          <div>
            <div className="projectName">{p.title}</div><div className="muted">{p.type} · {p.scene}</div>
            <div className="prog"><i style={{width:p.progress+"%"}} /></div>
          </div>
          <div><div className="mini">Status</div><div style={{fontSize:11,fontWeight:800,marginTop:4}}>{p.status}</div></div>
          <div><div className="mini">Cost</div><div style={{fontSize:11,fontWeight:800,marginTop:4}}>{p.cost}</div></div>
          <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
            <button className="ctrl blue" style={{width:"auto",padding:"8px 10px"}}><Play size={13}/></button>
            <button className="ctrl" style={{width:"auto",padding:"8px 10px",background:"#ffffff09",border:"1px solid #ffffff12",color:"#fff"}}><MoreHorizontal size={14}/></button>
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}
