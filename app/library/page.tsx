"use client";

import Link from "next/link";
import { FolderOpen, Image as ImageIcon, Video } from "lucide-react";

const assets = [
  ["scene_01.png","Image","Misteri Kota Bawah Laut","1.8 MB"],
  ["scene_12.png","Image","Misteri Kota Bawah Laut","2.1 MB"],
  ["scene_01.mp4","Video","5 AI Tools yang Wajib Dicoba","14.4 MB"],
  ["thumbnail_02.png","Image","Kenapa Robot Belajar?","0.9 MB"],
];

export default function LibraryPage() {
  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><FolderOpen size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">LIBRARY</div></div></div>
      <nav className="nav">
        <Link className="nav-item" href="/">Office</Link>
        <Link className="nav-item" href="/projects">Projects</Link>
        <span className="nav-item active">Library</span>
        <Link className="nav-item" href="/analytics">Analytics</Link>
        <Link className="nav-item" href="/settings">Settings</Link>
      </nav>
    </header>
    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div className="card"><div className="title"><FolderOpen size={14}/> ASSET LIBRARY</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:12}}>
          {assets.map(a=><div key={a[0]} style={{border:"1px solid #ffffff0d",borderRadius:12,overflow:"hidden",background:"#ffffff03"}}>
            <div style={{height:120,display:"grid",placeItems:"center",background:"linear-gradient(145deg,#202632,#11151c)"}}>{a[1]==="Video"?<Video size={32}/>:<ImageIcon size={32}/>}</div>
            <div style={{padding:11}}><div style={{fontSize:11,fontWeight:900}}>{a[0]}</div><div className="muted">{a[2]}</div><div className="muted">{a[3]}</div></div>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}
