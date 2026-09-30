"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, BarChart3, DollarSign, PlayCircle } from "lucide-react";

const cards = [
  ["Videos completed","18","↑ 3 this week",PlayCircle],
  ["Avg. cost / video","Rp 12.840","↓ 8% vs last week",DollarSign],
  ["Scenes generated","524","↑ 71 this week",Activity],
  ["Upload queue","2","Ready",ArrowUpRight],
];

export default function AnalyticsPage() {
  return <div className="app">
    <header className="top">
      <div className="brand"><div className="brandIcon"><BarChart3 size={21}/></div><div><div className="brandTitle">AI OFFICE</div><div className="brandSub">ANALYTICS</div></div></div>
      <nav className="nav">
        <Link className="nav-item" href="/">Office</Link><Link className="nav-item" href="/projects">Projects</Link><Link className="nav-item" href="/library">Library</Link><span className="nav-item active">Analytics</span><Link className="nav-item" href="/settings">Settings</Link>
      </nav>
    </header>
    <div style={{padding:22,maxWidth:1200,width:"100%",margin:"0 auto",overflow:"auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
        {cards.map(([a,b,c,I])=><div className="card" key={a as string}><div className="title"><I size={14}/>{a}</div><div style={{fontSize:26,fontWeight:900}}>{b}</div><div className="muted">{c}</div></div>)}
      </div>
      <div className="card"><div className="title"><BarChart3 size={14}/> DAILY PRODUCTION</div>
        <div style={{height:270,display:"flex",alignItems:"end",gap:9,padding:"20px 10px"}}>
          {[18,38,28,52,45,68,60,78,55,72,88,64,94,73].map((h,i)=><div key={i} style={{flex:1,height:h+"%",background:"linear-gradient(180deg,#7787ff,#4d5ad0)",borderRadius:"7px 7px 2px 2px",minWidth:8}} />)}
        </div>
        <div className="muted">Production output over the last 14 sessions</div>
      </div>
    </div>
  </div>;
}
