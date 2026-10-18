/* Frontier Scout Desk. Data and roles come from Supabase through data.js. */
(function(){
"use strict";
/* ---------- constants ---------- */
const SCOUTS=["Nour","Mohammad"];
const SECTORS=["B2B AI","Fintech","SaaS","Cybersecurity","Tech-enabled Services","Other"];
const INV_SECTORS=["B2B AI","Fintech","SaaS","Cybersecurity","Tech-enabled Services","Generalist"];
const STAGES=["Pre-seed","Seed","Series A","Series B+"];
const PIPE=["Sourced","Qualified","First Call","Diligence","IC Review","Term Sheet","Invested","Passed"];
const GEOS=["MENA","Europe","North America","Asia","LatAm","Africa","Global"];
const SOURCES=["Founder Referral","Boardy","VC Lab AI","LvlUp","Decile","LinkedIn","Inbound","Other"];
const STATUSES=["Pending","Approved","Needs info","Rejected"];
const RATINGS=[
  ["domain","Domain expertise","Knows the market from the inside"],
  ["fmf","Founder-market fit","Why this person, for this problem"],
  ["technical","Technical ability","Can build, or has built, the product"],
  ["gtm","Sales and GTM","Has sold and can keep selling"],
  ["leadership","Leadership and hiring","Attracts and keeps strong people"],
  ["coach","Coachability","Takes feedback and updates views"],
  ["comms","Communication","Clear, concise, straight answers"]
];
const SECTOR_PTS={"B2B AI":25,"Fintech":25,"SaaS":25,"Tech-enabled Services":22,"Cybersecurity":22};
const STAGE_PTS={"Pre-seed":20,"Seed":20,"Series A":12,"Series B+":4};

/* ---------- forms ---------- */
const FORMS={
 startup:[
  {title:"Company",hint:"What they build, in one breath.",fields:[
   {id:"sourcedByLabel",label:"Submitted by",type:"select",options:SCOUTS,req:1,full:1,help:"Your name goes on this entry as a colored tag."},
   {id:"name",label:"Startup name",type:"text",req:1},
   {id:"website",label:"Website",type:"url",ph:"https://"},
   {id:"oneLiner",label:"One-liner",type:"textarea",req:1,full:1,rows:2,ph:"Who they sell to, the problem, how they solve it."},
   {id:"sector",label:"Sector",type:"select",options:SECTORS,req:1},
   {id:"stage",label:"Stage",type:"select",options:STAGES,req:1},
   {id:"geography",label:"Primary market",type:"select",options:GEOS,req:1},
   {id:"hq",label:"HQ city",type:"text"},
   {id:"founded",label:"Founded (year)",type:"number"},
   {id:"teamSize",label:"Team size",type:"number"}]},
  {title:"Traction",hint:"Numbers as the founder stated them. Say what you verified.",fields:[
   {id:"arr",label:"ARR (USD)",type:"money"},
   {id:"growth",label:"Monthly revenue growth (%)",type:"number"},
   {id:"customers",label:"Paying customers or active users",type:"number"},
   {id:"revenueVerified",label:"Revenue status",type:"select",options:["Verified with documents","Founder-stated only","Pre-revenue"],req:1},
   {id:"tractionNotes",label:"Other traction",type:"textarea",full:1,rows:2,ph:"Pilots, LOIs, retention, notable logos."}]},
  {title:"Round",fields:[
   {id:"raise",label:"Raising (USD)",type:"money",req:1},
   {id:"valuation",label:"Pre-money valuation (USD)",type:"money"},
   {id:"instrument",label:"Instrument",type:"select",options:["SAFE","Priced equity","Convertible note","Unknown"]},
   {id:"committed",label:"Already committed (USD)",type:"money"},
   {id:"coInvestors",label:"Other investors in the round",type:"text",full:1}]},
  {title:"Founder",fields:[
   {id:"founderName",label:"Lead founder",type:"text",req:1},
   {id:"founderEmail",label:"Founder email",type:"email"},
   {id:"founderLinkedin",label:"Founder LinkedIn",type:"url",ph:"https://linkedin.com/in/"},
   {id:"cofounders",label:"Number of co-founders",type:"number"}]},
  {title:"Source and case",fields:[
   {id:"source",label:"Source",type:"select",options:SOURCES,req:1},
   {id:"sourceDetail",label:"How you found them",type:"text"},
   {id:"deckLink",label:"Pitch deck link",type:"url",ph:"DocSend, Drive, Dropbox"},
   {id:"thesis",label:"Why Frontier I should look",type:"textarea",req:1,full:1,rows:3,ph:"Sector and stage fit, why a $25K–$35K check makes sense, what could make this a breakout."}]}
 ],
 investor:[
  {title:"Fund",hint:"Log each fund separately. A firm running three funds is three entries.",fields:[
   {id:"sourcedByLabel",label:"Submitted by",type:"select",options:SCOUTS,req:1,full:1,help:"Your name goes on this entry as a colored tag."},
   {id:"fundName",label:"Fund name",type:"text",req:1,ph:"e.g. Example Ventures Fund II"},
   {id:"firm",label:"Firm",type:"text",req:1},
   {id:"fundSize",label:"Fund size (USD)",type:"money"},
   {id:"vintage",label:"Vintage year",type:"number"},
   {id:"checkMin",label:"Check size min (USD)",type:"money",req:1},
   {id:"checkMax",label:"Check size max (USD)",type:"money",req:1},
   {id:"stages",label:"Stages they invest in",type:"chips",options:STAGES,req:1,full:1},
   {id:"sectors",label:"Sectors",type:"chips",options:INV_SECTORS,req:1,full:1},
   {id:"geography",label:"Geography",type:"select",options:GEOS},
   {id:"leadFollow",label:"Leads or follows",type:"select",options:["Lead","Follow","Both"]}]},
  {title:"Contact",fields:[
   {id:"partnerName",label:"Partner contact",type:"text"},
   {id:"partnerEmail",label:"Partner email",type:"email"},
   {id:"partnerLinkedin",label:"Partner LinkedIn",type:"url"},
   {id:"relationship",label:"Relationship",type:"select",options:["Cold","Warm intro available","Existing relationship"],req:1}]},
  {title:"Fit",fields:[
   {id:"source",label:"Source",type:"select",options:SOURCES},
   {id:"coinvestFit",label:"Co-invest fit with Frontier I",type:"select",options:["High","Medium","Low"],req:1},
   {id:"notes",label:"Notes",type:"textarea",full:1,rows:3,ph:"Recent deals, thesis, portfolio overlap."}]}
 ],
 activity:[
  {title:"Log activity",hint:"Calls, intros and meetings on a startup already in the system.",fields:[
   {id:"sourcedByLabel",label:"Submitted by",type:"select",options:SCOUTS,req:1,full:1,help:"Your name goes on this entry as a colored tag."},
   {id:"dealId",label:"Startup",type:"deal",req:1,full:1},
   {id:"type",label:"Type",type:"select",options:["Call","Email","Meeting","Intro","Note"],req:1},
   {id:"date",label:"Date",type:"date",req:1},
   {id:"summary",label:"What happened",type:"textarea",req:1,full:1,rows:3},
   {id:"nextStep",label:"Next step",type:"text"},
   {id:"due",label:"Next step due",type:"date"}]}
 ],
 vetting:[
  {title:"Founder basics",fields:[
   {id:"sourcedByLabel",label:"Submitted by",type:"select",options:SCOUTS,req:1,full:1,help:"Your name goes on this entry as a colored tag."},
   {id:"dealId",label:"Startup",type:"deal",req:1,full:1},
   {id:"founderName",label:"Founder name",type:"text",req:1},
   {id:"role",label:"Role",type:"select",options:["CEO","CTO","COO","CPO","Other"],req:1},
   {id:"linkedin",label:"LinkedIn",type:"url"},
   {id:"basedIn",label:"Based in",type:"text"},
   {id:"fullTime",label:"Full-time on the startup",type:"select",options:["Yes","No","Unknown"],req:1},
   {id:"cofounders",label:"Number of co-founders",type:"number"},
   {id:"equity",label:"Founder equity (%)",type:"number"},
   {id:"yearsExp",label:"Years of relevant experience",type:"number",req:1}]},
  {title:"Background",fields:[
   {id:"priorRoles",label:"Prior companies and roles",type:"textarea",req:1,full:1,rows:3,ph:"Company, role, years, what they owned."},
   {id:"priorFounder",label:"Prior founder experience",type:"select",options:["First-time founder","Prior startup, no exit","Prior exit","Serial founder with exits"],req:1},
   {id:"education",label:"Education",type:"textarea",full:1,rows:2}]},
  {title:"Scorecard",hint:"Rate 1–10. 5 is average for founders we meet. 8+ means top decile.",fields:[
   {id:"ratings",type:"ratings",req:1,full:1}]},
  {title:"Diligence",fields:[
   {id:"problem",label:"Problem being solved",type:"textarea",full:1,rows:2},
   {id:"whyWins",label:"Why this founder wins",type:"textarea",req:1,full:1,rows:3},
   {id:"tractionClaimed",label:"Traction claimed",type:"textarea",full:1,rows:2,ph:"Revenue, users, pilots, LOIs as the founder stated them."},
   {id:"tractionVerified",label:"Traction verified",type:"select",options:["Verified with documents","Partially verified","Not verified","Contradicted"],req:1},
   {id:"capTable",label:"Cap table",type:"select",options:["Clean","Concerns","Unknown"],req:1},
   {id:"prevFunding",label:"Previous fundraising",type:"textarea",full:1,rows:2,ph:"Rounds, amounts, lead investors."},
   {id:"refsDone",label:"Reference checks done",type:"number",req:1},
   {id:"refNotes",label:"Reference notes",type:"textarea",full:1,rows:3,ph:"Who you spoke to, their relationship to the founder, what they said."},
   {id:"publicRecord",label:"Public professional record",type:"textarea",full:1,rows:2,help:"Professional only: press, company litigation, prior company outcomes. Nothing about their personal life."}]},
  {title:"Signals",fields:[
   {id:"greenFlags",label:"Green flags",type:"textarea",full:1,rows:2},
   {id:"redFlags",label:"Red flags",type:"textarea",req:1,full:1,rows:2,help:"Write \"None found\" if you found none."},
   {id:"risks",label:"Key risks",type:"textarea",full:1,rows:2}]},
  {title:"Evidence",fields:[
   {id:"interviewNotes",label:"Interview notes",type:"textarea",full:1,rows:4},
   {id:"recording",label:"Call recording link",type:"url"},
   {id:"docsLink",label:"Supporting documents link",type:"url"}]},
  {title:"Scout verdict",fields:[
   {id:"recommendation",label:"Recommendation",type:"select",options:["Strong Yes","Yes","Maybe","No"],req:1},
   {id:"rationale",label:"Rationale",type:"textarea",req:1,full:1,rows:3},
   {id:"confirm",label:"This vetting contains professional information only and stays inside Vanguard.",type:"check",req:1,full:1}]}
 ]
};

/* ---------- state ---------- */
const S={db:null,user:null,me:null,role:"offline",deals:[],investors:[],vettings:[],activity:[],reviews:{},notes:{},
  sector:"All",includePending:false,invStage:"All",invQuery:"",vetFilter:"All",dealQuery:"",vetQuery:"",sheet:null,who:"All",invWho:"All"};

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
function h(tag,props,...kids){
  const el=document.createElement(tag);
  if(props) for(const k in props){const v=props[k]; if(v==null||v===false) continue;
    if(k==="class") el.className=v;
    else if(k==="on") for(const ev in v) el.addEventListener(ev,v[ev]);
    else if(k==="html") el.innerHTML=v;
    else if(k==="value"||k==="checked"||k==="disabled"||k==="hidden") el[k]=v;
    else el.setAttribute(k,v===true?"":v);}
  for(const c of kids.flat(Infinity)){ if(c==null||c===false) continue; el.append(c instanceof Node?c:String(c)); }
  return el;
}
function money(n){ n=Number(n); if(!n&&n!==0||isNaN(n)) return "—"; if(n>=1e6) return "$"+(n/1e6).toFixed(n%1e6?1:0)+"M"; if(n>=1e3) return "$"+Math.round(n/1e3)+"K"; return "$"+n; }
function day(iso){ if(!iso) return ""; const d=new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:d.getFullYear()!==new Date().getFullYear()?"numeric":undefined}); }
function safeUrl(u){ return typeof u==="string"&&/^https?:\/\//i.test(u.trim())?u.trim():null; }
function link(u,label){ const s=safeUrl(u); return s?h("a",{href:s,target:"_blank",rel:"noopener noreferrer"},label||s.replace(/^https?:\/\/(www\.)?/,"").slice(0,48)):null; }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
let toastT; function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,3400); }
function lsGet(k){ try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null} }
function lsSet(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)) }catch(e){} }
const isPartner=()=>S.role==="partner";
const canSubmit=()=>S.db&&S.role!=="viewer";

function review(key){ return S.reviews[key]||{status:"Pending"}; }
function statusChip(st){ const cls=st==="Needs info"?"Needs":st; return h("span",{class:"chip "+cls},st); }
function dealStage(d){ return review("deal-"+d.id).stage||"Sourced"; }
function tractionPts(d){ const arr=Number(d.arr)||0; return arr>=100000?20:arr>=25000?17:arr>0?14:((Number(d.customers)>0||d.tractionNotes)?8:3); }
function founderAvg(dealId,approvedOnly){
  const vs=S.vettings.filter(v=>v.dealId===dealId && typeof v.founderScore==="number" && (approvedOnly?review("vet-"+v.id).status==="Approved":review("vet-"+v.id).status!=="Rejected"));
  if(!vs.length) return null; return Math.round(vs.reduce((a,v)=>a+v.founderScore,0)/vs.length*10)/10;
}
function fit(d){ const s=SECTOR_PTS[d.sector]??(d.sector?10:0), st=STAGE_PTS[d.stage]??0, t=tractionPts(d), fa=founderAvg(d.id,true), f=fa==null?10:Math.round(10+fa*2.5); return {total:s+st+t+f,s,st,t,f,fa}; }
function ring(score,size){ size=size||52; const r=(size-7)/2,c=2*Math.PI*r,p=Math.max(0,Math.min(100,score))/100;
  const col=score>=65?"var(--good)":score>=45?"var(--brass)":"var(--faint)";
  return h("span",{class:"ring",html:`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Fit score ${score} of 100"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="5"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c*p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="${Math.round(size*.34)}">${score}</text></svg>`}); }
function who(uid,fallback){ if(!uid) return h("span",null,fallback||"Partner desk"); return h("span",{"data-uid":uid},"…"); }
async function resolveNames(){
  if(!S.user) { document.querySelectorAll("[data-uid]").forEach(e=>e.textContent="Scout"); return; }
  const ids=[...new Set([...document.querySelectorAll("[data-uid]")].map(e=>e.dataset.uid))]; if(!ids.length) return;
  const ps=await S.user.profiles(ids);
  document.querySelectorAll("[data-uid]").forEach(e=>{ const p=ps[e.dataset.uid]; e.textContent=p?(p.isMe?"You":(p.name||"Scout")):"Scout"; });
}
const CONTRIB={Nour:{cls:"nour",full:"Nour Abouel Najja"},Mohammad:{cls:"mohammad",full:"Mohammad Siblany"},Ayman:{cls:"ayman",full:"Ayman"}};
function tagsOf(d){ return [...new Set([d&&d.sourcedByLabel,...((d&&d.contributors)||[])].filter(Boolean))]; }
function tag(name){ const c=CONTRIB[name]; return h("span",{class:"tag "+(c?c.cls:""),title:c?c.full:name},name); }
function tagRow(d){ return tagsOf(d).map(tag); }
function whoFilter(list,key,rerender,elId){
  const names=[...new Set(list.flatMap(tagsOf))].sort((a,b)=>(a==="Ayman")-(b==="Ayman")||a.localeCompare(b));
  const fl=$(elId); fl.textContent=""; if(!names.length||(names.length<2&&list.every(x=>tagsOf(x).length))) return;
  fl.append(h("span",{class:"lead"},"Contributor"));
  for(const n of ["All",...names]) fl.append(h("button",{class:"pill tagpill "+(CONTRIB[n]?.cls||""),type:"button","aria-pressed":String(S[key]===n),on:{click:()=>{S[key]=n;rerender();}}},n==="All"?"Everyone":n));
}
function dealName(id){ const d=S.deals.find(x=>x.id===id); return d?d.name:"Unknown startup"; }

/* ---------- form builder ---------- */
function buildForm(key){
  const schema=FORMS[key];
  const form=h("form",{class:"f",id:"form-"+key,novalidate:true});
  for(const sec of schema){
    const grid=h("div",{class:"grid"});
    for(const f of sec.fields) grid.append(buildField(key,f));
    form.append(h("fieldset",null,h("legend",null,sec.title),sec.hint?h("p",{class:"fs-hint"},sec.hint):null,grid));
  }
  const btn=h("button",{class:"btn primary",type:"submit",id:"submit-"+key},key==="vetting"?"Submit vetting":key==="activity"?"Log activity":"Submit for review");
  const foot=h("div",{class:"form-foot"},btn,h("span",{class:"help",id:"foot-"+key},"Fields marked * are required."),h("button",{class:"btn small",type:"button",on:{click:()=>{resetForm(key);lsSet("draft:"+key,null);toast("Form cleared");}}},"Clear"));
  if(key==="vetting") form.insertBefore(h("div",{class:"live",id:"vet-live"},h("span",null,"Founder score"),h("b",{id:"vet-live-score",class:"num"},"–"),h("span",{class:"help"},"Average of the 7 ratings. Worth up to 35 of the 100 Fit Score points.")),form.children[3]);
  form.append(foot);
  form.addEventListener("submit",e=>onSubmit(e,key));
  let t; const save=()=>{clearTimeout(t);t=setTimeout(()=>lsSet("draft:"+key,collect(key).vals),500);};
  form.addEventListener("input",save); form.addEventListener("click",e=>{ if(e.target.closest(".chips,.rate")) save(); });
  return form;
}
function buildField(key,f){
  const id=key+"-"+f.id, cls="field"+(f.full?" full":"");
  const star=f.req?h("span",{class:"req","aria-hidden":"true"},"*"):null;
  const help=f.help?h("span",{class:"help"},f.help):null;
  if(f.type==="ratings"){
    const wrap=h("div",{class:"ratings",id:id,"data-field":f.id});
    for(const [rid,label,hint] of RATINGS){
      const rate=h("div",{class:"rate",role:"radiogroup","aria-label":label,"data-rid":rid});
      for(let i=1;i<=10;i++) rate.append(h("button",{type:"button",role:"radio","aria-checked":"false","data-v":i,on:{click:e=>{ rate.dataset.value=i; rate.querySelectorAll("button").forEach(b=>b.setAttribute("aria-checked",String(+b.dataset.v===i))); updateLive(); }}},i));
      wrap.append(h("div",{class:"rrow"},h("div",null,h("span",{class:"lbl"},label,h("span",{class:"req","aria-hidden":"true"},"*")),h("span",{class:"help"},hint)),rate));
    }
    return h("div",{class:cls,"data-wrap":f.id},wrap);
  }
  if(f.type==="check") return h("div",{class:cls,"data-wrap":f.id},h("label",{class:"check"},h("input",{type:"checkbox",id:id}),h("span",null,f.label,star)));
  if(f.type==="chips"){
    const chips=h("div",{class:"chips",id:id,role:"group","aria-label":f.label});
    for(const o of f.options) chips.append(h("button",{type:"button","aria-pressed":"false","data-v":o,on:{click:e=>{const b=e.currentTarget;b.setAttribute("aria-pressed",b.getAttribute("aria-pressed")==="true"?"false":"true");}}},o));
    return h("div",{class:cls,"data-wrap":f.id},h("span",{class:"lbl"},f.label,star),chips,help);
  }
  let input;
  if(f.type==="select"||f.type==="deal"){ input=h("select",{id:id,"data-deal":f.type==="deal"?"1":null},h("option",{value:""},"Choose…"),(f.options||[]).map(o=>h("option",{value:o},o))); }
  else if(f.type==="textarea") input=h("textarea",{id:id,rows:f.rows||3,placeholder:f.ph||null});
  else if(f.type==="money") input=h("div",{class:"money"},h("span",null,"$"),h("input",{type:"number",id:id,inputmode:"numeric",min:"0",step:"any",placeholder:"0"}));
  else input=h("input",{type:f.type==="number"?"number":f.type,id:id,placeholder:f.ph||null,inputmode:f.type==="number"?"decimal":null,value:(f.type==="date"&&f.id==="date")?today():null});
  return h("div",{class:cls,"data-wrap":f.id},h("label",{for:id},f.label,star),input,help);
}
function fieldsOf(key){ return FORMS[key].flatMap(s=>s.fields); }
function collect(key){
  const vals={},missing=[];
  for(const f of fieldsOf(key)){
    const id=key+"-"+f.id, el=$(id); let v=null;
    if(f.type==="ratings"){ v={}; let miss=false; el.querySelectorAll(".rate").forEach(r=>{ const n=Number(r.dataset.value)||null; v[r.dataset.rid]=n; if(!n) miss=true; }); if(f.req&&miss) missing.push(f.id); }
    else if(f.type==="chips"){ v=[...el.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.dataset.v); if(f.req&&!v.length) missing.push(f.id); }
    else if(f.type==="check"){ v=el.checked; if(f.req&&!v) missing.push(f.id); }
    else if(f.type==="number"||f.type==="money"){ v=el.value===""?null:Number(el.value); if(f.req&&(v==null||isNaN(v))) missing.push(f.id); }
    else { v=el.value.trim(); if(f.req&&!v) missing.push(f.id); if(!v) v=null; }
    vals[f.id]=v;
  }
  return {vals,missing};
}
function setField(key,f,v){
  const el=$(key+"-"+f.id); if(!el||v==null) return;
  if(f.type==="ratings"){ el.querySelectorAll(".rate").forEach(r=>{ const n=v[r.dataset.rid]; if(n){ r.dataset.value=n; r.querySelectorAll("button").forEach(b=>b.setAttribute("aria-checked",String(+b.dataset.v===n))); } }); }
  else if(f.type==="chips"){ el.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(v.includes(b.dataset.v)))); }
  else if(f.type==="check") el.checked=!!v;
  else { if(f.type==="deal"){ el.dataset.pending=v; } el.value=v; }
}
function resetForm(key){
  const form=$("form-"+key); const keep=$(key+"-sourcedByLabel")?.value; form.reset(); if(keep) $(key+"-sourcedByLabel").value=keep;
  form.querySelectorAll(".rate").forEach(r=>{ delete r.dataset.value; r.querySelectorAll("button").forEach(b=>b.setAttribute("aria-checked","false")); });
  form.querySelectorAll(".chips button").forEach(b=>b.setAttribute("aria-pressed","false"));
  form.querySelectorAll(".invalid").forEach(e=>e.classList.remove("invalid"));
  const d=$(key+"-date"); if(d) d.value=today();
  if(key==="vetting") updateLive();
}
function restoreDraft(key){ const d=lsGet("draft:"+key); if(!d) return; for(const f of fieldsOf(key)) setField(key,f,d[f.id]); if(key==="vetting") updateLive(); $("foot-"+key).textContent="Restored your unsent draft. Fields marked * are required."; }
function ratingsAvg(r){ const ns=Object.values(r||{}).filter(Boolean); if(ns.length<RATINGS.length) return null; return Math.round(ns.reduce((a,b)=>a+b,0)/ns.length*10)/10; }
function updateLive(){ const el=$("vetting-ratings"); if(!el) return; const r={}; el.querySelectorAll(".rate").forEach(x=>r[x.dataset.rid]=Number(x.dataset.value)||null); const n=Object.values(r).filter(Boolean); const avg=n.length?Math.round(n.reduce((a,b)=>a+b,0)/n.length*10)/10:null; $("vet-live-score").textContent=avg==null?"–":avg+" / 10"+(n.length<7?` (${n.length}/7 rated)`:""); }
function refreshDealSelects(){
  const sorted=[...S.deals].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  document.querySelectorAll("select[data-deal]").forEach(sel=>{
    const cur=sel.value||sel.dataset.pending||""; sel.textContent="";
    sel.append(h("option",{value:""},sorted.length?"Choose a startup…":"No startups yet. Submit one first."));
    for(const d of sorted){ const st=review("deal-"+d.id).status; sel.append(h("option",{value:d.id},d.name+(st!=="Approved"?` (${st.toLowerCase()})`:""))); }
    if(cur&&sorted.some(d=>d.id===cur)){ sel.value=cur; delete sel.dataset.pending; }
  });
}

async function onSubmit(e,key){
  e.preventDefault();
  const form=e.currentTarget; form.querySelectorAll(".invalid").forEach(x=>x.classList.remove("invalid"));
  const {vals,missing}=collect(key);
  if(missing.length){ missing.forEach(id=>form.querySelector(`[data-wrap="${id}"]`)?.classList.add("invalid")); form.querySelector(".invalid")?.scrollIntoView({behavior:"smooth",block:"center"}); toast(`${missing.length} required field${missing.length>1?"s":""} missing`); return; }
  if(!S.db){ toast("Not connected. Sign in to submit."); return; }
  if(S.role==="viewer"){ toast("Your access is view-only. Ask a partner to make you a Scout."); return; }
  const btn=$("submit-"+key); btn.disabled=true;
  const base={submittedBy:S.me?.id||null,createdAt:new Date().toISOString()};
  try{
    if(key==="startup") await S.db.collection("deals").doc().set({...vals,...base});
    else if(key==="investor") await S.db.collection("investors").doc().set({...vals,...base});
    else if(key==="activity") await S.db.collection("activity").doc().set({...vals,...base});
    else if(key==="vetting"){ const {confirm,...rest}=vals; await S.db.collection("vettings").doc().set({...rest,founderScore:ratingsAvg(vals.ratings),...base}); }
    if(vals.sourcedByLabel){ lsSet("scout",vals.sourcedByLabel); ["startup","investor","activity","vetting"].forEach(k=>{const s=$(k+"-sourcedByLabel"); if(s&&!s.value) s.value=vals.sourcedByLabel;}); }
    resetForm(key); lsSet("draft:"+key,null); $("foot-"+key).textContent="Fields marked * are required.";
    toast(key==="activity"?"Activity logged":"Submitted. A partner will review it.");
    if(key==="vetting") $("form-vetting-wrap").hidden=true;
  }catch(err){ writeError(err); }
  finally{ btn.disabled=false; }
}
function writeError(err){
  const c=err&&err.code;
  if(c==="invalid_argument"){ S.role="viewer"; paintRole(); toast("That save was refused. Your access may have changed. Ask a partner to check your role."); }
  else if(c==="quota_exceeded") toast("The desk's storage is full. Ask a partner to archive old entries.");
  else if(c==="resource_exhausted") toast("Too many saves at once. Wait a few seconds and try again.");
  else toast("Connection dropped. Try again.");
}

/* ---------- search ---------- */
const DEAL_FIELDS=[["name","Name"],["oneLiner","Pitch"],["founderName","Founder"],["coInvestors","Investors"],["hq","HQ"],["geography","Market"],["sector","Sector"],["stage","Stage"],["website","Website"],["tractionNotes","Traction"],["thesis","Case"],["sourceDetail","Source"],["sourcedByLabel","Sourced by"],["contribText","Contributors"]];
function norm(s){ return String(s??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase(); }
function terms(q){ return norm(q).split(/\s+/).filter(Boolean); }
function matchDeal(d,ts){
  if(!ts.length) return {ok:true,hit:null};
  d.contribText=tagsOf(d).join(" ");
  const hay=DEAL_FIELDS.map(([k])=>norm(d[k])).join(" \u0001 ")+" "+norm(dealStage(d));
  if(!ts.every(t=>hay.includes(t))) return {ok:false};
  // first matching field the card does not already show
  const shown=new Set(["name","oneLiner","sector","stage","geography"]);
  for(const [k,label] of DEAL_FIELDS){ if(shown.has(k)||!d[k]) continue; const v=norm(d[k]); if(ts.some(t=>v.includes(t))) return {ok:true,hit:[label,String(d[k])]}; }
  return {ok:true,hit:null};
}
function mark(text,ts){
  text=String(text??""); if(!ts.length||!text) return text;
  const n=norm(text); const spans=[];
  for(const t of ts){ let i=0; while((i=n.indexOf(t,i))>-1){ spans.push([i,i+t.length]); i+=t.length; } }
  if(!spans.length) return text;
  spans.sort((a,b)=>a[0]-b[0]); const merged=[];
  for(const s of spans){ const l=merged[merged.length-1]; if(l&&s[0]<=l[1]) l[1]=Math.max(l[1],s[1]); else merged.push([...s]); }
  const out=[]; let p=0;
  for(const [a,b] of merged){ if(a>p) out.push(text.slice(p,a)); out.push(h("mark",null,text.slice(a,b))); p=b; }
  if(p<text.length) out.push(text.slice(p)); return out;
}
function snippet(text,ts,len){
  len=len||140; const n=norm(text); let at=-1;
  for(const t of ts){ const i=n.indexOf(t); if(i>-1&&(at<0||i<at)) at=i; }
  if(at<0||text.length<=len) return text.length>len?text.slice(0,len)+"…":text;
  const start=Math.max(0,at-40); const s=text.slice(start,start+len);
  return (start>0?"…":"")+s+(start+len<text.length?"…":"");
}
function wireSearch(inputId,clearId,key,render){
  const inp=$(inputId), clr=$(clearId);
  inp.addEventListener("input",()=>{ S[key]=inp.value; clr.hidden=!inp.value; render(); });
  inp.addEventListener("keydown",e=>{ if(e.key==="Escape"&&inp.value){ e.stopPropagation(); inp.value=""; S[key]=""; clr.hidden=true; render(); } });
  clr.addEventListener("click",()=>{ inp.value=""; S[key]=""; clr.hidden=true; render(); inp.focus(); });
}

/* ---------- pipeline ---------- */
function visibleDeals(){ return S.deals.filter(d=>{ const st=review("deal-"+d.id).status; return st==="Approved"||(isPartner()&&S.includePending&&st!=="Rejected"); }); }
function renderPipeline(){
  const deals=visibleDeals();
  const strip=$("strip"); strip.textContent="";
  for(const p of PIPE){ const n=deals.filter(d=>dealStage(d)===p).length; strip.append(h("div",{class:n?"":"zero"},h("div",{class:"n num"},n),h("div",{class:"l"},p))); }
  const fl=$("sector-filters"); fl.textContent="";
  for(const s of ["All",...SECTORS.filter(x=>deals.some(d=>d.sector===x))]) fl.append(h("button",{class:"pill",type:"button","aria-pressed":String(S.sector===s),on:{click:()=>{S.sector=s;renderPipeline();}}},s));
  if(isPartner()) fl.append(h("label",{class:"toggle"},h("input",{type:"checkbox",id:"inc-pending",checked:S.includePending,on:{change:e=>{S.includePending=e.target.checked;renderPipeline();}}}),"Include pending"));
  whoFilter(deals,"who",renderPipeline,"who-filters");
  const list=$("deal-list"); list.textContent="";
  const ts=terms(S.dealQuery);
  const inSector=deals.filter(d=>(S.sector==="All"||d.sector===S.sector)&&(S.who==="All"||tagsOf(d).includes(S.who)));
  const shown=inSector.map(d=>({d,m:matchDeal(d,ts)})).filter(x=>x.m.ok).map(x=>({d:x.d,m:x.m,f:fit(x.d)})).sort((a,b)=>b.f.total-a.f.total);
  if(ts.length){
    const note=h("div",{class:"result-note"},h("b",null,String(shown.length))," of "+inSector.length+" deals match “"+S.dealQuery.trim()+"”"+(S.sector!=="All"?" in "+S.sector:""));
    if(!shown.length&&S.sector!=="All"&&deals.some(d=>matchDeal(d,ts).ok)) note.append(". ",h("button",{class:"btn small",type:"button",on:{click:()=>{S.sector="All";renderPipeline();}}},"Search all sectors"));
    list.append(note);
  }
  if(!shown.length){ if(!ts.length) list.append(h("div",{class:"empty"},S.db?"No approved deals here yet. Submissions appear once a partner approves them.":"Loading the pipeline…")); else list.append(h("div",{class:"empty"},"No deals match. Try a founder's surname, a city, or an investor name.")); return; }
  for(const {d,f,m} of shown){
    const st=review("deal-"+d.id);
    list.append(h("button",{class:"deal",type:"button",on:{click:()=>openDeal(d.id)}},
      ring(f.total),
      h("div",{style:"min-width:0"},h("div",{class:"t"},mark(d.name||"Untitled",ts)),h("div",{class:"d"},mark(d.oneLiner||"",ts)),
        m.hit?h("div",{class:"hit"},h("span",{class:"k"},m.hit[0]),mark(snippet(m.hit[1],ts),ts)):null,
        h("div",{class:"meta"},tagRow(d),h("span",{class:"chip stage"},dealStage(d)),d.sector?h("span",{class:"chip"},d.sector):null,h("span",null,d.stage||""),d.geography?h("span",null,d.geography):null,st.status!=="Approved"?statusChip(st.status):null)),
      h("div",{class:"side"},h("span",null,"ARR ",h("span",{class:"fs num"},money(d.arr))),h("span",null,"Founder ",h("span",{class:"fs num"},f.fa==null?"unvetted":f.fa+"/10")),st.nextStep?h("span",null,"Next: "+st.nextStep):null)));
  }
}

/* ---------- investors ---------- */
function renderInvestors(){
  const inv=S.investors.filter(i=>review("inv-"+i.id).status==="Approved"||isPartner()&&review("inv-"+i.id).status!=="Rejected");
  const fl=$("inv-filters"); fl.textContent="";
  for(const s of ["All",...STAGES]) fl.append(h("button",{class:"pill",type:"button","aria-pressed":String(S.invStage===s),on:{click:()=>{S.invStage=s;renderInvestors();}}},s==="All"?"All stages":s));
  whoFilter(inv,"invWho",renderInvestors,"inv-who-filters");
  const q=S.invQuery.toLowerCase();
  const shown=inv.filter(i=>(S.invWho==="All"||tagsOf(i).includes(S.invWho))&&(S.invStage==="All"||(i.stages||[]).includes(S.invStage))&&(!q||[i.fundName,i.firm,i.partnerName].join(" ").toLowerCase().includes(q)));
  const list=$("inv-list"); list.textContent="";
  if(!shown.length){ list.append(h("div",{class:"empty"},inv.length?"No funds match.":"No approved investors yet. Add funds from Submit → Investor.")); return; }
  for(const i of shown){
    const st=review("inv-"+i.id).status;
    list.append(h("div",{class:"inv"},
      h("div",{class:"inv-top"},h("div",null,h("div",{class:"t"},i.fundName),h("div",{class:"help"},i.firm+(i.fundSize?" · "+money(i.fundSize)+" fund":"")+(i.vintage?" · "+i.vintage:""))),h("div",{style:"text-align:right"},h("div",{class:"check-size num"},money(i.checkMin)+"–"+money(i.checkMax)),h("div",{class:"help"},"check size"))),
      h("div",{class:"meta",style:"margin-top:0"},tagRow(i),(i.stages||[]).map(s=>h("span",{class:"chip stage"},s)),(i.sectors||[]).map(s=>h("span",{class:"chip"},s)),i.leadFollow?h("span",null,i.leadFollow):null,i.geography?h("span",null,i.geography):null,st!=="Approved"?statusChip(st):null),
      h("div",{class:"meta",style:"margin-top:0"},i.partnerName?h("span",null,"Contact: "+i.partnerName):null,i.partnerEmail?h("span",{class:"copy"},h("code",null,i.partnerEmail)):null,link(i.partnerLinkedin,"LinkedIn"),h("span",null,i.relationship||""),i.coinvestFit?h("span",null,"Co-invest fit: "+i.coinvestFit):null),
      i.notes?h("div",{class:"help"},i.notes):null));
  }
}

/* ---------- vetting list ---------- */
function renderVettings(){
  const fl=$("vet-filters"); fl.textContent="";
  for(const s of ["All",...STATUSES]) fl.append(h("button",{class:"pill",type:"button","aria-pressed":String(S.vetFilter===s),on:{click:()=>{S.vetFilter=s;renderVettings();}}},s));
  const list=$("vet-list"); list.textContent="";
  const vts=terms(S.vetQuery);
  const vs=[...S.vettings].filter(v=>S.vetFilter==="All"||review("vet-"+v.id).status===S.vetFilter).filter(v=>{ if(!vts.length) return true; const hay=norm([v.founderName,dealName(v.dealId),v.role,v.basedIn,v.recommendation,v.priorRoles].join(" ")); return vts.every(t=>hay.includes(t)); }).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  if(!vs.length){ list.append(h("div",{class:"empty"},vts.length?"No vettings match “"+S.vetQuery.trim()+"”.":S.vettings.length?"No vettings with this status.":"No founder vettings yet. Start one with New founder vetting.")); return; }
  for(const v of vs){
    const st=review("vet-"+v.id).status;
    list.append(h("button",{class:"rowlink",type:"button",on:{click:()=>openVetting(v.id)}},
      h("div",null,h("div",{style:"font-weight:700"},(v.founderName||"Founder")+" · "+dealName(v.dealId)),h("div",{class:"meta",style:"margin-top:4px"},tagRow(v),statusChip(st),h("span",null,v.recommendation||""),h("span",null,"by "),who(v.submittedBy),h("span",null,day(v.createdAt)))),
      h("div",{style:"text-align:right"},h("div",{style:"font-family:var(--f-display);font-weight:700;font-size:20px",class:"num"},v.founderScore??"–"),h("div",{class:"help"},"of 10"))));
  }
}

/* ---------- queue ---------- */
function queueItems(){
  const out=[];
  S.deals.forEach(d=>out.push({kind:"deal",key:"deal-"+d.id,col:"deals",doc:d,title:d.name,desc:[d.sector,d.stage,d.geography,d.raise?"raising "+money(d.raise):null].filter(Boolean).join(" · ")}));
  S.investors.forEach(i=>out.push({kind:"investor",key:"inv-"+i.id,col:"investors",doc:i,title:i.fundName,desc:[i.firm,money(i.checkMin)+"–"+money(i.checkMax)+" checks",(i.stages||[]).join("/")].filter(Boolean).join(" · ")}));
  S.vettings.forEach(v=>out.push({kind:"vetting",key:"vet-"+v.id,col:"vettings",doc:v,title:(v.founderName||"Founder")+" · "+dealName(v.dealId),desc:"Founder score "+(v.founderScore??"–")+"/10 · "+(v.recommendation||"")}));
  return out;
}
function pendingCount(){ const waiting=[...window.ScoutData.people.team.values()].filter(m=>m.role==="pending").length; return waiting+queueItems().filter(q=>{const s=review(q.key).status;return s==="Pending";}).length; }
function renderQueue(){
  const body=$("queue-body"); body.textContent="";
  if(isPartner()){
    $("queue-title").textContent="Review queue"; $("queue-sub").textContent="Approve to publish into the pipeline. Needs info sends a note back to the scout.";
    const items=queueItems().filter(q=>["Pending","Needs info"].includes(review(q.key).status));
    const groups=[["deal","Startups"],["vetting","Founder vettings"],["investor","Investors"]];
    if(!items.length) body.append(h("div",{class:"empty"},"Queue is clear. Nothing waiting for review."));
    for(const [k,label] of groups){ const g=items.filter(q=>q.kind===k).sort((a,b)=>(a.doc.createdAt||"").localeCompare(b.doc.createdAt||"")); if(!g.length) continue;
      body.append(h("div",{class:"qgroup"},h("div",{class:"qhead"},h("h3",null,label),h("span",{class:"c"},g.length+" waiting")),g.map(qItem))); }
    body.append(accessBlock());
  } else {
    $("queue-title").textContent="My submissions"; $("queue-sub").textContent="Track what you sent in. If a partner asks for more info, answer here.";
    const mine=S.me?.id?queueItems().filter(q=>q.doc.submittedBy===S.me.id).sort((a,b)=>(b.doc.createdAt||"").localeCompare(a.doc.createdAt||"")):[];
    if(!mine.length) body.append(h("div",{class:"empty"},S.db?"You haven't submitted anything yet.":"Loading your submissions…"));
    else body.append(h("div",{class:"qgroup"},mine.map(qItem)));
  }
  resolveNames();
}
function qItem(q){
  const r=review(q.key), d=q.doc;
  const wrap=h("div",{class:"qitem"});
  wrap.append(h("div",{class:"qtop"},h("div",null,h("div",{class:"t"},q.title||"Untitled"),h("div",{class:"d"},q.desc)),h("div",{class:"meta",style:"margin-top:0"},statusChip(r.status),h("span",{class:"chip"},q.kind==="deal"?"Startup":q.kind==="vetting"?"Vetting":"Investor"))));
  wrap.append(h("div",{class:"meta",style:"margin-top:0"},tagRow(d),d.submittedBy?h("span",null,"Submitted by "):null,d.submittedBy?who(d.submittedBy):null,h("span",null,day(d.createdAt))));
  if(r.note) wrap.append(h("div",{class:"note"},h("b",null,"Partner note: "),r.note));
  (d.scoutUpdates||[]).forEach(u=>wrap.append(h("div",{class:"note",style:"background:var(--accent-soft)"},h("b",{style:"color:var(--accent)"},"Scout update "+day(u.at)+": "),u.text)));
  const acts=h("div",{class:"actions"});
  if(q.kind==="deal") acts.append(h("button",{class:"btn small",type:"button",on:{click:()=>openDeal(d.id)}},"Open file"));
  if(q.kind==="vetting") acts.append(h("button",{class:"btn small",type:"button",on:{click:()=>openVetting(d.id)}},"Open vetting"));
  const inline=h("div",{class:"inline",hidden:true});
  if(isPartner()){
    acts.append(h("button",{class:"btn small good",type:"button",on:{click:()=>setReview(q.key,{status:"Approved",note:null,...(q.kind==="deal"&&!r.stage?{stage:"Sourced"}:{})},"Approved")}},"Approve"),
      h("button",{class:"btn small warn",type:"button",on:{click:()=>{inline.hidden=!inline.hidden; inline.querySelector("textarea")?.focus();}}},"Needs info"),
      h("button",{class:"btn small bad",type:"button",on:{click:()=>setReview(q.key,{status:"Rejected"},"Rejected")}},"Reject"));
    const ta=h("textarea",{rows:2,id:"note-"+q.key,placeholder:"What does the scout need to add?"});
    inline.append(ta,h("div",null,h("button",{class:"btn small primary",type:"button",on:{click:()=>{ if(!ta.value.trim()) return toast("Write the note first"); setReview(q.key,{status:"Needs info",note:ta.value.trim()},"Sent back to scout"); }}},"Send note")));
  } else if(r.status==="Needs info"||r.status==="Pending"){
    acts.append(h("button",{class:"btn small",type:"button",on:{click:()=>{inline.hidden=!inline.hidden;}}},"Add info"));
    const ta=h("textarea",{rows:2,id:"upd-"+q.key,placeholder:"Answer the partner's question or add what changed."});
    inline.append(ta,h("div",null,h("button",{class:"btn small primary",type:"button",on:{click:async()=>{ const t=ta.value.trim(); if(!t) return toast("Write your update first"); try{ await S.db.doc(q.col+"/"+d.id).update({scoutUpdates:[...(d.scoutUpdates||[]),{text:t,at:new Date().toISOString(),by:S.me?.id||null}]}); toast("Update sent"); }catch(err){ writeError(err); } }}},"Send update")));
  }
  wrap.append(acts,inline);
  return wrap;
}
async function setReview(key,patch,msg){
  if(!S.db) return toast("Not connected");
  const cur=S.reviews[key]||{};
  const next={...cur,...patch,reviewedBy:S.me?.id||null,reviewedAt:new Date().toISOString()};
  Object.keys(next).forEach(k=>next[k]==null&&delete next[k]);
  try{ await S.db.doc("reviews/"+key).set(next); if(msg) toast(msg); }catch(err){ writeError(err); }
}
const ROLE_LABEL={partner:"Partner",scout:"Scout",viewer:"Viewer",pending:"Waiting for approval"};
function accessBlock(){
  const D=window.ScoutData; const team=[...D.people.team.values()];
  const box=h("div",{class:"access"},h("h3",{style:"color:var(--ink)"},"Team"),
    h("p",{style:"margin:6px 0 0"},"Partners approve and move deals and see notes and terms. Scouts submit and see the approved pipeline. Viewers read only. New sign-ups wait here until you give them a role."));
  const order={pending:0,partner:1,scout:2,viewer:3};
  team.sort((a,b)=>order[a.role]-order[b.role]||(a.name||a.email).localeCompare(b.name||b.email));
  const tb=h("tbody");
  for(const m of team){
    const isMe=S.me&&m.user_id===S.me.id;
    const sel=h("select",{"aria-label":"Role for "+(m.name||m.email),disabled:isMe},["partner","scout","viewer","pending"].map(r=>h("option",{value:r},ROLE_LABEL[r])));
    sel.value=m.role;
    sel.addEventListener("change",async()=>{ try{ await D.setRole(m.user_id,sel.value); toast((m.name||m.email)+" is now "+ROLE_LABEL[sel.value].toLowerCase()); }catch(err){ sel.value=m.role; writeError(err); } });
    const rm=isMe?null:h("button",{class:"btn small bad",type:"button",on:{click:async()=>{ if(!confirm("Remove "+(m.name||m.email)+" from the desk?")) return; try{ await D.removeMember(m.user_id); toast("Removed"); }catch(err){ writeError(err); } }}},"Remove");
    tb.append(h("tr",null,h("td",null,(m.name||"—")+(isMe?" (you)":""),h("div",{class:"help"},m.email)),h("td",{style:"min-width:150px"},sel),h("td",null,rm)));
  }
  box.append(h("table",null,tb));
  const file=h("input",{type:"file",accept:"application/json,.json",hidden:true});
  const status=h("span",{class:"help"});
  file.addEventListener("change",async()=>{
    const f=file.files[0]; file.value=""; if(!f) return;
    try{
      status.textContent="Reading "+f.name+"…";
      const n=await D.importDocs(JSON.parse(await f.text()),(done,total)=>{ status.textContent="Imported "+done+" of "+total+"…"; });
      status.textContent=""; toast("Imported "+n+" records");
    }catch(err){ status.textContent=""; if(err instanceof SyntaxError||err.code==="empty") toast("That file isn't a Scout Desk export"); else writeError(err); }
  });
  box.append(h("div",{class:"actions",style:"margin-top:14px;align-items:center"},h("button",{class:"btn small",type:"button",on:{click:()=>file.click()}},"Import desk data"),status,file));
  return box;
}

/* ---------- sheets ---------- */
function openSheet(){ $("sheet").hidden=false; document.body.style.overflow="hidden"; }
function closeSheet(){ $("sheet").hidden=true; document.body.style.overflow=""; S.sheet=null; }
function facts(pairs){ return h("div",{class:"facts"},pairs.filter(p=>p[1]!=null&&p[1]!==""&&p[1]!=="—").map(([k,v])=>h("div",null,h("div",{class:"fk"},k),h("div",{class:"fv"},v)))); }
function block(k,...kids){ const c=kids.flat().filter(Boolean); if(!c.length) return null; return h("div",{class:"block"},h("div",{class:"k"},k),c); }
function prose(t){ return t?h("div",{class:"prose"},t):null; }

function openDeal(id){ S.sheet={kind:"deal",id}; renderSheet(true); openSheet(); }
function openVetting(id){ S.sheet={kind:"vetting",id}; renderSheet(true); openSheet(); }
function renderSheet(fresh){
  if(!S.sheet) return;
  if(S.sheet.kind==="deal") renderDealSheet(fresh); else renderVetSheet();
  resolveNames();
}
function renderDealSheet(fresh){
  const d=S.deals.find(x=>x.id===S.sheet.id); if(!d){ closeSheet(); return; }
  const f=fit(d), r=review("deal-"+d.id), pendingAvg=founderAvg(d.id,false);
  $("sheet-eyebrow").textContent="Startup file"; $("sheet-title").textContent=d.name||"Untitled";
  const m=$("sheet-meta"); m.textContent=""; m.append(tagRow(d),h("span",{class:"chip stage"},dealStage(d)),statusChip(r.status),h("span",null,[d.sector,d.stage,d.geography,d.hq].filter(Boolean).join(" · ")));
  const b=$("sheet-body"); b.textContent="";
  const bar=(label,v,max)=>h("div",{class:"bar"},h("span",null,label),h("div",{class:"track"},h("div",{class:"fill",style:`width:${Math.round(v/max*100)}%`})),h("span",{class:"v"},v+"/"+max));
  b.append(h("div",{class:"score-card"},ring(f.total,84),h("div",{class:"bars"},bar("Sector",f.s,25),bar("Stage",f.st,20),bar("Traction",f.t,20),bar("Founder",f.f,35),
    f.fa==null?h("div",{class:"help"},pendingAvg!=null?`Pending vetting averages ${pendingAvg}/10. It counts once a partner approves it.`:"No approved founder vetting yet. Founder points stay at the 10 baseline until one is approved."):null)));
  if(r.note) b.append(h("div",{class:"note"},h("b",null,"Partner note: "),r.note));
  b.append(block("Snapshot",prose(d.oneLiner)));
  b.append(block("Numbers",facts([["ARR",money(d.arr)],["Monthly growth",d.growth!=null?d.growth+"%":null],["Customers / users",d.customers],["Revenue status",d.revenueVerified],["Raising",money(d.raise)],["Pre-money",money(d.valuation)],["Instrument",d.instrument],["Committed",money(d.committed)],["Founded",d.founded],["Team size",d.teamSize]]),d.coInvestors?h("div",{class:"help"},"Other investors: "+d.coInvestors):null,prose(d.tractionNotes)));
  b.append(block("Scout's case",prose(d.thesis),h("div",{class:"meta",style:"margin-top:0"},h("span",null,"Sourced by "),d.sourcedByLabel?tag(d.sourcedByLabel):who(d.submittedBy),(d.contributors||[]).length?h("span",null,"· research by"):null,(d.contributors||[]).map(tag),h("span",null,"via "+(d.source||"—")+(d.sourceDetail?" ("+d.sourceDetail+")":"")),h("span",null,day(d.createdAt)))));
  b.append(block("Founder",facts([["Lead founder",d.founderName],["Co-founders",d.cofounders]]),h("div",{class:"linkrow"},d.founderEmail?h("span",{class:"copy"},h("code",null,d.founderEmail),h("button",{class:"btn small",type:"button",on:{click:()=>copy(d.founderEmail)}},"Copy")):null,link(d.founderLinkedin,"LinkedIn profile"))));
  b.append(block("Links",h("div",{class:"linkrow"},link(d.website,"Website"),link(d.deckLink,"Pitch deck"))));
  const vs=S.vettings.filter(v=>v.dealId===d.id);
  b.append(h("div",{class:"block"},h("div",{class:"k"},"Founder vettings ("+vs.length+")"),vs.length?vs.map(v=>h("button",{class:"rowlink",type:"button",on:{click:()=>openVetting(v.id)}},h("span",null,h("b",null,v.founderName||"Founder")," · "+(v.recommendation||"")),h("span",{class:"meta",style:"margin-top:0"},statusChip(review("vet-"+v.id).status),h("b",{class:"num"},(v.founderScore??"–")+"/10")))):h("div",{class:"help"},"None yet."),
    canSubmit()?h("button",{class:"btn small",type:"button",style:"align-self:flex-start",on:{click:()=>{closeSheet();go("vetting");showVetForm(d.id);}}},"Vet a founder"):null));
  const acts=S.activity.filter(a=>a.dealId===d.id).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  b.append(h("div",{class:"block"},h("div",{class:"k"},"Activity"),acts.length?h("div",{class:"timeline"},acts.map(a=>h("div",{class:"tl"},h("div",{class:"when"},day(a.date)+" · "+a.type+" · ",a.sourcedByLabel?tag(a.sourcedByLabel):who(a.submittedBy)),h("div",null,a.summary),a.nextStep?h("div",{class:"help"},"Next: "+a.nextStep+(a.due?" by "+day(a.due):"")):null))):h("div",{class:"help"},"No activity logged."),
    canSubmit()?h("button",{class:"btn small",type:"button",style:"align-self:flex-start",on:{click:()=>{closeSheet();go("submit");pickForm("activity");const s=$("activity-dealId");s.value=d.id;}}},"Log activity"):null));
  if(fresh) renderPartnerBox(d);
}
function renderPartnerBox(d){
  const box=$("sheet-partner"); box.textContent="";
  if(!isPartner()) return;
  const r=review("deal-"+d.id), n=S.notes[d.id]||{};
  const sel=(id,opts,val)=>h("select",{id},opts.map(o=>h("option",{value:o},o))).valueOf();
  const stSel=sel("p-status",STATUSES), stageSel=sel("p-stage",PIPE);
  stSel.value=r.status||"Pending"; stageSel.value=r.stage||"Sourced";
  const next=h("input",{type:"text",id:"p-next",value:r.nextStep||"",placeholder:"e.g. Request data room"});
  const due=h("input",{type:"date",id:"p-due",value:r.due||""});
  const notes=h("textarea",{id:"p-notes",rows:3,placeholder:"IC thoughts, concerns, context. Partners only."}); notes.value=n.internalNotes||"";
  const terms=h("textarea",{id:"p-terms",rows:3,placeholder:"Check size, valuation cap, instrument, pro-rata. Partners only."}); terms.value=n.dealTerms||"";
  const save=h("button",{class:"btn primary",type:"button",on:{click:async()=>{
    save.disabled=true;
    try{
      const cur=S.reviews["deal-"+d.id]||{};
      const nr={...cur,status:stSel.value,stage:stageSel.value,nextStep:next.value.trim()||null,due:due.value||null,reviewedBy:S.me?.id||null,reviewedAt:new Date().toISOString()};
      Object.keys(nr).forEach(k=>nr[k]==null&&delete nr[k]);
      await S.db.doc("reviews/deal-"+d.id).set(nr);
      await S.db.doc("partner/desk/notes/"+d.id).set({internalNotes:notes.value.trim(),dealTerms:terms.value.trim(),updatedAt:new Date().toISOString(),updatedBy:S.me?.id||null});
      toast("Saved");
    }catch(err){ writeError(err); } finally{ save.disabled=false; }
  }}},"Save partner changes");
  const fld=(label,el)=>h("div",{class:"field"},h("label",{for:el.id},label),el);
  box.append(h("div",{class:"partner-box"},h("div",{class:"k",style:"font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase"},"Partners only · hidden from scouts"),
    h("div",{class:"grid"},fld("Review status",stSel),fld("Pipeline stage",stageSel),fld("Next step",next),fld("Due",due)),
    fld("Internal notes",notes),fld("Deal terms",terms),h("div",null,save),
    n.updatedAt?h("div",{class:"help"},"Last saved "+day(n.updatedAt)+" by ",who(n.updatedBy)):null));
}
function renderVetSheet(){
  const v=S.vettings.find(x=>x.id===S.sheet.id); if(!v){ closeSheet(); return; }
  const r=review("vet-"+v.id);
  $("sheet-eyebrow").textContent="Founder vetting"; $("sheet-title").textContent=v.founderName||"Founder";
  const m=$("sheet-meta"); m.textContent=""; m.append(tagRow(v),statusChip(r.status),h("span",null,(v.role||"")+" · "+dealName(v.dealId)),h("span",null,"by "),who(v.submittedBy),h("span",null,day(v.createdAt)));
  const b=$("sheet-body"); b.textContent="";
  const bars=RATINGS.map(([id,label])=>{ const n=v.ratings?.[id]||0; return h("div",{class:"bar",style:"grid-template-columns:150px 1fr 40px"},h("span",null,label),h("div",{class:"track"},h("div",{class:"fill",style:`width:${n*10}%`})),h("span",{class:"v"},n+"/10")); });
  b.append(h("div",{class:"score-card"},h("div",{style:"text-align:center"},h("div",{style:"font-family:var(--f-display);font-size:34px;font-weight:700;line-height:1",class:"num"},v.founderScore??"–"),h("div",{class:"help"},"founder score")),h("div",{class:"bars"},bars)));
  if(r.note) b.append(h("div",{class:"note"},h("b",null,"Partner note: "),r.note));
  b.append(block("Verdict",facts([["Recommendation",v.recommendation],["Traction verified",v.tractionVerified],["Cap table",v.capTable],["References",v.refsDone]]),prose(v.rationale)));
  b.append(block("Profile",facts([["Full-time",v.fullTime],["Based in",v.basedIn],["Experience",v.yearsExp!=null?v.yearsExp+" yrs":null],["Founder history",v.priorFounder],["Co-founders",v.cofounders],["Equity",v.equity!=null?v.equity+"%":null]]),link(v.linkedin,"LinkedIn profile")));
  b.append(block("Prior companies and roles",prose(v.priorRoles)));
  b.append(block("Education",prose(v.education)));
  b.append(block("Why this founder wins",prose(v.whyWins)));
  b.append(block("Problem",prose(v.problem)));
  b.append(block("Traction claimed",prose(v.tractionClaimed)));
  b.append(block("Previous fundraising",prose(v.prevFunding)));
  b.append(block("Reference notes",prose(v.refNotes)));
  b.append(block("Public professional record",prose(v.publicRecord)));
  b.append(block("Green flags",prose(v.greenFlags)));
  b.append(block("Red flags",prose(v.redFlags)));
  b.append(block("Key risks",prose(v.risks)));
  b.append(block("Interview notes",prose(v.interviewNotes)));
  b.append(block("Evidence",h("div",{class:"linkrow"},link(v.recording,"Call recording"),link(v.docsLink,"Documents"))));
  const box=$("sheet-partner"); box.textContent="";
  if(isPartner()) box.append(h("div",{class:"partner-box"},h("div",{class:"k",style:"font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase"},"Partner decision"),
    h("div",{class:"actions"},h("button",{class:"btn small good",type:"button",on:{click:()=>setReview("vet-"+v.id,{status:"Approved",note:null},"Vetting approved. Fit Score updated.")}},"Approve vetting"),h("button",{class:"btn small bad",type:"button",on:{click:()=>setReview("vet-"+v.id,{status:"Rejected"},"Vetting rejected")}},"Reject"))));
}
function copy(t){ try{ navigator.clipboard.writeText(t).then(()=>toast("Copied"),()=>toast("Select the address to copy it")); }catch(e){ toast("Select the address to copy it"); } }

/* ---------- scroll counter ---------- */
// Floating "12 of 98" pill on Pipeline and Investors: the total, plus how far down the list you are.
const COUNTED={pipeline:{list:"deal-list",item:".deal",total:"deal-total",one:"startup",many:"startups"},
  investors:{list:"inv-list",item:".inv",total:"inv-total",one:"investor",many:"investors"}};
let scRaf=0, scHide=0, scLast=-1;
function currentTab(){ const v=[...document.querySelectorAll("section.view")].find(s=>!s.hidden); return v?v.id.replace("view-",""):""; }
function updateCounter(){
  cancelAnimationFrame(scRaf);
  scRaf=requestAnimationFrame(()=>{
    for(const k in COUNTED){ const c=COUNTED[k], n=document.querySelectorAll("#"+c.list+" "+c.item).length; $(c.total).textContent=n?String(n):""; }
    const pill=$("scroll-count"), c=COUNTED[currentTab()];
    if(!c){ pill.hidden=true; return; }
    const items=[...document.querySelectorAll("#"+c.list+" "+c.item)];
    if(!items.length){ pill.hidden=true; return; }
    const line=window.innerHeight*0.6; let at=0;
    for(const el of items){ if(el.getBoundingClientRect().top<line) at++; else break; }
    at=Math.max(1,at);
    pill.hidden=false;
    if(at!==scLast){ scLast=at; $("sc-at").textContent=String(at); pill.classList.remove("tick"); void pill.offsetWidth; pill.classList.add("tick"); }
    $("sc-total").textContent=String(items.length);
    $("sc-noun").textContent=items.length===1?c.one:c.many;
    pill.classList.add("active"); clearTimeout(scHide); scHide=setTimeout(()=>pill.classList.remove("active"),1200);
  });
}
window.addEventListener("scroll",updateCounter,{passive:true});
window.addEventListener("resize",updateCounter);
for(const k in COUNTED) new MutationObserver(updateCounter).observe($(COUNTED[k].list),{childList:true});

/* ---------- navigation ---------- */
function go(tab){
  document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected",String(t.dataset.tab===tab)));
  document.querySelectorAll("section.view").forEach(s=>s.hidden=s.id!=="view-"+tab);
  window.scrollTo(0,0);
  scLast=-1; updateCounter();
}
function pickForm(k){
  document.querySelectorAll(".seg button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.form===k)));
  ["startup","investor","activity"].forEach(x=>$("form-"+x+"-wrap").hidden=x!==k);
}
function showVetForm(dealId){ const w=$("form-vetting-wrap"); w.hidden=false; if(dealId){ const s=$("vetting-dealId"); s.value=dealId; } w.scrollIntoView({behavior:"smooth",block:"start"}); }

/* ---------- role & render ---------- */
function paintRole(){
  const el=$("role"); el.className="role "+S.role;
  el.textContent={partner:"Partner",scout:"Scout",viewer:"View only",offline:"Connecting…"}[S.role];
  $("queue-label").textContent=isPartner()?"Queue":"Mine";
  const ban=$("banner");
  if(S.role==="offline"){ ban.hidden=false; ban.textContent="Connecting to the desk…"; }
  else if(S.role==="viewer"){ ban.hidden=false; ban.textContent="You have view-only access. Ask a partner to make you a Scout to submit deals and vettings."; }
  else ban.hidden=true;
  document.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=S.role==="viewer");
}
let raf=0;
function renderData(){
  cancelAnimationFrame(raf);
  raf=requestAnimationFrame(()=>{
    renderPipeline(); renderInvestors(); renderVettings(); renderQueue(); refreshDealSelects();
    const c=isPartner()?pendingCount():(S.me?.id?queueItems().filter(q=>q.doc.submittedBy===S.me.id&&review(q.key).status==="Needs info").length:0);
    $("queue-count").textContent=c?String(c):"";
    if(S.sheet) renderSheet(false);
    resolveNames();
  });
}

/* ---------- boot ---------- */
for(const k of ["startup","investor","activity","vetting"]) $("form-"+k+"-wrap").append(buildForm(k));
refreshDealSelects();
{ const sc=lsGet("scout"); if(SCOUTS.includes(sc)) ["startup","investor","activity","vetting"].forEach(k=>{const s=$(k+"-sourcedByLabel"); if(s) s.value=sc;}); }
for(const k of ["startup","investor","activity","vetting"]) restoreDraft(k);
if(lsGet("draft:vetting")) $("form-vetting-wrap").hidden=false;
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>go(t.dataset.tab)));
document.querySelectorAll(".seg button").forEach(b=>b.addEventListener("click",()=>pickForm(b.dataset.form)));
$("new-vetting").addEventListener("click",()=>{ const w=$("form-vetting-wrap"); if(w.hidden) showVetForm(); else w.hidden=true; });
$("inv-search").addEventListener("input",e=>{S.invQuery=e.target.value;renderInvestors();});
wireSearch("deal-search","deal-search-clear","dealQuery",renderPipeline);
wireSearch("vet-search","vet-search-clear","vetQuery",renderVettings);
document.addEventListener("keydown",e=>{
  if(e.key!=="/"||e.metaKey||e.ctrlKey||e.altKey) return;
  const t=e.target; if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if(!$("sheet").hidden) return;
  const view=[...document.querySelectorAll("section.view")].find(s=>!s.hidden);
  const target={"view-pipeline":"deal-search","view-vetting":"vet-search","view-investors":"inv-search"}[view?.id];
  if(target){ e.preventDefault(); $(target).focus(); }
});
$("sheet-close").addEventListener("click",closeSheet);
$("sheet").addEventListener("click",e=>{ if(e.target.id==="sheet") closeSheet(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("sheet").hidden) closeSheet(); });
const hash=(location.hash||"").slice(1); if(["pipeline","submit","vetting","investors","queue","about"].includes(hash)) go(hash);
paintRole(); renderData();

async function connect(){
  const D=window.ScoutData;
  S.user=D.user; S.db=D.db;
  S.me=await D.user.me();
  await D.loadTeam();
  $("who-name").textContent=S.me.name||S.me.email||"";
  S.role=S.me.role==="partner"?"partner":S.me.role==="scout"?"scout":"viewer";
  paintRole();
  const onErr=e=>{ if(e&&e.code==="revoked"){ S.db=null; S.role="viewer"; paintRole(); } };
  const sub=(col,fn)=>db.collection(col).onSnapshot(snap=>{ fn(snap.docs.map(d=>({id:d.id,...d.data()}))); renderData(); },onErr);
  const db=D.db;
  sub("deals",x=>S.deals=x);
  sub("investors",x=>S.investors=x);
  sub("vettings",x=>S.vettings=x);
  sub("activity",x=>S.activity=x);
  sub("reviews",x=>{ const m={}; x.forEach(r=>{ const {id,...rest}=r; m[id]=rest; }); S.reviews=m; });
  if(isPartner()) sub("partner/desk/notes",x=>{ const m={}; x.forEach(n=>{ const {id,...rest}=n; m[id]=rest; }); S.notes=m; });
  D.watchTeam(()=>{ const r=D.people.me.role; const now=r==="partner"?"partner":r==="scout"?"scout":r==="viewer"?"viewer":"gone"; if(now!==S.role){ location.reload(); return; } renderData(); });
}
window.DeskConnect=connect;
})();
