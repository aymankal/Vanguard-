/* Vanguard Docs: document-control register. Talks to the app's own API (/api/...). */
const CASE = { id:"case", name:"Case File", code:"CASE", description:"Shareholder dispute dossier, evidence and counsel material. Behind a separate passcode, enforced on the server.", locked:true };
const S = { statuses:["Draft","Active","In review","Expired","Archived"], vault:[], modules:[], docs:[], caseInfo:{enabled:false,unlocked:false,hours:8},
  auth:false, maxFile:25*1048576, view:"all", q:"", status:"", sort:"updated", openId:null, loaded:false, editDoc:null, editMod:null };
let installEvt = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDate = d => d ? new Date(d + (d.length===10?"T00:00:00":"")).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "";
const fmtSize = b => !b ? "" : b < 1024*1024 ? Math.max(1, Math.round(b/1024))+" KB" : (b/1048576).toFixed(1)+" MB";
const today = () => { const t=new Date(); t.setHours(0,0,0,0); return t; };
const daysTo = d => d ? Math.round((new Date(d+"T00:00:00") - today())/86400000) : null;
const stamp = d => d ? Date.parse(d) || 0 : 0;
const caseOpen = () => S.caseInfo.enabled && S.caseInfo.unlocked;
const modById = id => id === "case" ? (S.caseInfo.enabled ? CASE : undefined) : S.modules.find(m => m.id === id);
const findDoc = id => S.docs.find(x=>x.id===id) || S.vault.find(x=>x.id===id);
const sClass = s => "s-" + String(s).replace(/\s/g,"");
const fileUrl = (d, dl) => `/api/documents/${encodeURIComponent(d.id)}/file${dl?"?download=1":""}`;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
function notice(msg){ const n=$("notice"); n.textContent=msg; n.hidden=!msg; }

/* ---------- api ---------- */
class ApiError extends Error { constructor(msg, status){ super(msg); this.status=status; } }
async function api(path, opts={}){
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined){ init.headers["Content-Type"]="application/json"; init.body=JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); } catch(e){ throw new ApiError("You're offline. Check your connection and try again.", 0); }
  if (res.status === 401 && !path.startsWith("/api/case/")){ location.href = "/login" + location.hash; throw new ApiError("Sign in required", 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data.detail === "string" ? data.detail : "Something went wrong. Try again.", res.status);
  return data;
}
function uploadFile(docId, file, onProgress){
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `/api/documents/${encodeURIComponent(docId)}/file?name=${encodeURIComponent(file.name)}`);
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d={}; try{ d=JSON.parse(x.responseText); }catch(e){}
      x.status < 300 ? resolve(d) : reject(new ApiError(typeof d.detail==="string" ? d.detail : "Upload failed. Try again in a moment.", x.status)); };
    x.onerror = () => reject(new ApiError("Upload failed. Check your connection and try again.", 0));
    x.send(file);
  });
}
async function load(){
  const st = await api("/api/state");
  S.modules = st.modules; S.docs = st.documents; S.vault = st.vault; S.caseInfo = st.case; S.auth = st.auth; S.maxFile = st.maxFileBytes;
  S.loaded = true;
  if (!["all","expiring","nofile"].includes(S.view) && !modById(S.view)) S.view = "all";
  if (S.view === "case" && !caseOpen()) S.view = "all";
  if (S.openId && !findDoc(S.openId)) S.openId = null;
  $("m-logout").hidden = !S.auth; $("m-lockcase").hidden = !caseOpen();
  notice(S.auth ? "" : "Sign-in is off: anyone who can reach this address can see the register. Set APP_PASSWORD on the server.");
  render();
}
const upsert = (list, d) => { const i = list.findIndex(x=>x.id===d.id); i<0 ? list.push(d) : list.splice(i,1,d); };
function putDoc(d){ S.docs = S.docs.filter(x=>x.id!==d.id); S.vault = S.vault.filter(x=>x.id!==d.id); upsert(d.moduleId==="case"?S.vault:S.docs, d); }

S.statuses.forEach(s => { $("f-status").insertAdjacentHTML("beforeend", `<option>${s}</option>`); $("d-status").insertAdjacentHTML("beforeend", `<option>${s}</option>`); });

/* ---------- derived ---------- */
function expiringSoon(d){ const n=daysTo(d.expiry); return n!==null && n<=30 && d.status!=="Archived"; }
function visibleDocs(){
  let list = S.view==="case" ? S.vault.slice() : S.docs.slice();
  if (S.view==="case") {}
  else if (S.view==="expiring") list = list.filter(expiringSoon);
  else if (S.view==="nofile") list = list.filter(d => !d.hasFile && !d.link);
  else if (S.view!=="all") list = list.filter(d => d.moduleId===S.view);
  if (S.status) list = list.filter(d => d.status===S.status);
  if (S.q){ const q=S.q.toLowerCase(); list = list.filter(d => [d.title,d.ref,d.party,(d.tags||[]).join(" "),d.notes,d.fileName].join(" ").toLowerCase().includes(q)); }
  const by = { updated:(a,b)=>stamp(b.updatedAt)-stamp(a.updatedAt), title:(a,b)=>String(a.title).localeCompare(b.title), ref:(a,b)=>String(a.ref).localeCompare(b.ref),
    expiry:(a,b)=>(a.expiry||"9999").localeCompare(b.expiry||"9999") };
  return list.sort(by[S.sort]);
}

/* ---------- render ---------- */
function renderRail(){
  const count = id => S.docs.filter(d=>d.moduleId===id).length;
  const exp = S.docs.filter(expiringSoon).length;
  const nav = (v,label,n,code="") => `<button class="nav ${S.view===v?"on":""}" data-view="${esc(v)}" type="button">${code?`<span class="code">${esc(code)}</span>`:""}<span class="name">${esc(label)}</span><span class="n">${n}</span></button>`;
  let h = `<h3>Register</h3>` + nav("all","All documents",S.docs.length) + nav("expiring","Expiring in 30 days",exp) + nav("nofile","Missing file",S.docs.filter(d=>!d.hasFile&&!d.link).length);
  h += `<h3>Modules <button type="button" data-act="newmod">+ Add</button></h3>`;
  if (!S.modules.length) h += `<div class="empty">${S.loaded?"No modules yet.":"Loading modules…"}</div>`;
  S.modules.slice().sort((a,b)=>(a.order??999)-(b.order??999) || a.name.localeCompare(b.name)).forEach(m => h += nav(m.id,m.name,count(m.id),m.code));
  if (S.caseInfo.enabled) h += `<h3>Restricted</h3>` + `<button class="nav lockednav ${S.view==="case"?"on":""}" data-view="case" type="button"><span class="code">CASE</span><span class="name">Case File <span class="lock ${caseOpen()?"":"off"}">${caseOpen()?"Unlocked":"Locked"}</span></span><span class="n">${caseOpen()?S.vault.length:""}</span></button>`;
  h += `<button class="btn addmod" type="button" data-act="newmod">+ Module</button>`;
  $("rail").innerHTML = h;
}
function renderHead(){
  const m = modById(S.view);
  const titles = { all:["All documents","Every record across every module."], expiring:["Expiring in 30 days","Contracts, licences and filings that need renewal or action soon."], nofile:["Missing file","Records with no file and no link attached. Close these gaps."] };
  const [t,s] = m ? [m.name, m.description || `Documents filed under ${m.code}.`] : (titles[S.view]||titles.all);
  $("view-title").textContent = t; $("view-sub").textContent = s;
  $("btn-editmod").hidden = !m || !!m.locked;
  $("lockbar").hidden = S.view !== "case";
}
function renderStats(){
  const scope = S.view==="case" ? S.vault : modById(S.view) ? S.docs.filter(d=>d.moduleId===S.view) : S.docs;
  const items = [
    ["Documents", scope.length, "all", ""],
    ["Active", scope.filter(d=>d.status==="Active").length, "active", ""],
    ["Expiring ≤30 days", scope.filter(expiringSoon).length, "expiring", scope.some(expiringSoon)?"warn":""],
    ["In review", scope.filter(d=>d.status==="In review").length, "review", ""],
  ];
  $("stats").innerHTML = items.map(([l,n,k,c]) => `<button class="stat ${c}" type="button" data-stat="${k}"><small>${l}</small><b>${n}</b></button>`).join("");
}
function dueCell(d){
  const n = daysTo(d.expiry); if (n===null) return `<span style="color:var(--muted)">No expiry</span>`;
  const cls = n<0 ? "due-past" : n<=30 ? "due-soon" : "";
  const extra = n<0 ? ` · ${-n}d overdue` : n<=30 ? ` · ${n}d` : "";
  return `<span class="mono ${cls}">${fmtDate(d.expiry)}${extra}</span>`;
}
function fileExt(d){ return d.fileName ? d.fileName.split(".").pop().slice(0,4) : d.link ? "link" : ""; }
function renderList(){
  const list = visibleDocs();
  if (!S.loaded){ $("list").innerHTML = `<div class="tablewrap"><div class="blank"><b>Connecting to the register</b>Loading modules and documents.</div></div>`; return; }
  if (!list.length){
    const m = modById(S.view);
    const msg = S.q||S.status ? ["No matches","Clear the search or status filter to see more."]
      : m ? [`${m.name} is empty`,"Add the first document to this module."]
      : S.view==="expiring" ? ["Nothing expiring","No document has an expiry date in the next 30 days."]
      : S.view==="nofile" ? ["Every record has a file","Nothing to chase here."]
      : !S.modules.length ? ["Start with a module","Create a module like Client Contracts or HR, then file documents into it. Moving from the claude.ai version? Use More → Import register."]
      : ["No documents yet","Add the first one. Each gets a reference number from its module code."];
    const cta = !(S.q||S.status) && S.view!=="expiring" && S.view!=="nofile" ? (S.modules.length||S.view==="case"?`<button class="btn primary" type="button" data-act="add">Add document</button>`:`<button class="btn primary" type="button" data-act="newmod">New module</button>`) : "";
    $("list").innerHTML = `<div class="tablewrap"><div class="blank"><b>${esc(msg[0])}</b>${esc(msg[1])}<br>${cta}</div></div>`; return;
  }
  const showMod = !modById(S.view);
  $("list").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Ref</th><th>Document</th>${showMod?"<th>Module</th>":""}<th>Status</th><th>Expiry</th><th>File</th><th>Updated</th></tr></thead><tbody>${
    list.map(d => { const m=modById(d.moduleId); return `<tr data-doc="${esc(d.id)}" tabindex="0">
      <td class="mono c-ref">${esc(d.ref||"")}</td>
      <td class="title">${esc(d.title)}${d.party?`<small>${esc(d.party)}</small>`:""}${(d.tags||[]).length?`<div>${d.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`:""}</td>
      ${showMod?`<td class="c-mod">${m?esc(m.name):"<em style='color:var(--muted)'>Unfiled</em>"}</td>`:""}
      <td class="c-status"><span class="pill ${sClass(d.status)}">${esc(d.status)}</span></td>
      <td class="c-exp">${dueCell(d)}</td>
      <td class="c-file">${fileExt(d)?`<span class="ftype">${esc(fileExt(d))}</span>`:`<span style="color:var(--bad);font-size:12px">Missing</span>`}</td>
      <td class="mono c-upd" style="color:var(--muted)">${d.updatedAt?new Date(d.updatedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""}</td></tr>`; }).join("")
  }</tbody></table></div>`;
}
function renderDrawer(){
  const root = $("drawer-root");
  const d = findDoc(S.openId);
  if (!d){ root.innerHTML=""; document.body.style.overflow=""; return; }
  document.body.style.overflow="hidden";
  const m = modById(d.moduleId);
  const isImg = /^image\/(png|jpeg|webp|gif)$/.test(d.fileType||"");
  root.innerHTML = `<div class="scrim" data-act="close"></div>
  <aside class="drawer" role="dialog" aria-label="Document record">
    <header><div class="t"><span class="mono" style="color:var(--muted);font-size:12px">${esc(d.ref||"")}</span><h2>${esc(d.title)}</h2></div><button class="btn ghost" type="button" data-act="close" aria-label="Close">Close</button></header>
    <div class="body">
      <dl class="kv">
        <dt>Status</dt><dd><span class="pill ${sClass(d.status)}">${esc(d.status)}</span></dd>
        <dt>Module</dt><dd>${m?esc(m.name):"Unfiled"}</dd>
        <dt>Counterparty</dt><dd>${esc(d.party||"None")}</dd>
        <dt>Expiry</dt><dd>${dueCell(d)}</dd>
        <dt>Tags</dt><dd>${(d.tags||[]).length?d.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join(""):"None"}</dd>
        <dt>Added</dt><dd>${d.createdAt?new Date(d.createdAt).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):""}</dd>
      </dl>
      ${d.hasFile ? `<div class="filebox">${isImg?`<img src="${esc(fileUrl(d))}" alt="${esc(d.fileName)}">`:""}
        <div class="row"><span class="ftype">${esc(fileExt(d))}</span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(d.fileName)}</span><span class="mono" style="color:var(--muted)">${fmtSize(d.fileSize)}</span></div>
        <div class="row"><a href="${esc(fileUrl(d))}" target="_blank" rel="noopener">Open file</a><a class="btn" href="${esc(fileUrl(d,true))}" download>Download</a>${navigator.canShare?`<button class="btn" type="button" data-act="share">Share</button>`:""}</div></div>` : ""}
      ${d.link ? `<div class="filebox"><div class="row"><span class="ftype">link</span><a href="${esc(d.link)}" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere">${esc(d.link)}</a></div></div>` : ""}
      ${!d.hasFile && !d.link ? `<div class="filebox" style="color:var(--bad)">No file or link attached.</div>` : ""}
      ${d.notes ? `<div><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Notes</div><div class="notes">${esc(d.notes)}</div></div>` : ""}
    </div>
    <footer><button class="btn primary" type="button" data-act="edit">Edit</button><button class="btn danger" type="button" data-act="delete">Delete</button></footer>
  </aside>`;
}
function render(){ renderRail(); renderHead(); renderStats(); renderList(); renderDrawer(); }

/* ---------- events ---------- */
document.addEventListener("click", e => {
  if (!e.target.closest(".menu-wrap")) closeMenu();
  const v = e.target.closest("[data-view]");
  if (v){ const view=v.dataset.view; if (view==="case" && !caseOpen()) return openCaseDialog(); S.view=view; render(); scrollTo({top:0}); return; }
  const st = e.target.closest("[data-stat]");
  if (st){ const k=st.dataset.stat; if(k==="expiring"){ if(S.view!=="case") S.view="expiring"; S.status=""; } else { S.status = k==="active"?"Active":k==="review"?"In review":""; } $("f-status").value=S.status; render(); return; }
  const row = e.target.closest("tr[data-doc]"); if (row){ S.openId=row.dataset.doc; renderDrawer(); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act==="close"){ S.openId=null; renderDrawer(); }
  else if (act==="add") openDocDialog();
  else if (act==="newmod"){ closeMenu(); openModDialog(); }
  else if (act==="edit") openDocDialog(findDoc(S.openId));
  else if (act==="delete") deleteDoc(a);
  else if (act==="share") shareDoc();
  else if (act==="export"){ closeMenu(); location.href="/api/export.json"; }
  else if (act==="lockcase") lockCase();
  else if (act==="theme") cycleTheme();
  else if (act==="logout") $("logout-form").submit();
  else if (act==="install") installApp();
});
document.addEventListener("keydown", e => {
  if (e.key==="Enter" && e.target.matches("tr[data-doc]")){ S.openId=e.target.dataset.doc; renderDrawer(); }
  if (e.key==="Escape" && S.openId && !document.querySelector("dialog[open]")){ S.openId=null; renderDrawer(); }
});
let qT; $("q").addEventListener("input", e => { clearTimeout(qT); qT=setTimeout(()=>{ S.q=e.target.value.trim(); renderList(); },120); });
$("f-status").addEventListener("change", e => { S.status=e.target.value; renderStats(); renderList(); });
$("f-sort").addEventListener("change", e => { S.sort=e.target.value; renderList(); });
$("btn-add").addEventListener("click", () => openDocDialog());
$("btn-module").addEventListener("click", () => openModDialog());
$("btn-editmod").addEventListener("click", () => openModDialog(modById(S.view)));
$("doc-cancel").addEventListener("click", () => $("dlg-doc").close());
$("mod-cancel").addEventListener("click", () => $("dlg-mod").close());
$("case-cancel").addEventListener("click", () => $("dlg-case").close());
$("btn-menu").addEventListener("click", () => { const m=$("menu"); m.hidden=!m.hidden; $("btn-menu").setAttribute("aria-expanded", String(!m.hidden)); });
function closeMenu(){ $("menu").hidden=true; $("btn-menu").setAttribute("aria-expanded","false"); }

/* ---------- documents ---------- */
function moduleOptions(){
  return S.modules.slice().sort((a,b)=>(a.order??999)-(b.order??999)).map(m=>`<option value="${esc(m.id)}">${esc(m.code)} · ${esc(m.name)}</option>`).join("")
    + (caseOpen()?`<option value="case">CASE · Case File (restricted)</option>`:"");
}
function openDocDialog(d){
  if (!S.modules.length && !caseOpen()) return openModDialog();
  S.editDoc = d || null;
  $("doc-dlg-title").textContent = d ? "Edit document" : "Add document";
  $("d-module").innerHTML = moduleOptions();
  $("d-title").value = d?.title || "";
  $("d-module").value = d?.moduleId || (modById(S.view)?S.view:(S.modules[0]?.id||"case"));
  $("d-status").value = d?.status || "Active";
  $("d-party").value = d?.party || "";
  $("d-expiry").value = d?.expiry || "";
  $("d-tags").value = (d?.tags||[]).join(", ");
  $("d-link").value = d?.link || "";
  $("d-notes").value = d?.notes || "";
  $("d-file").value = "";
  const limit = `Up to ${Math.round(S.maxFile/1048576)} MB. PDF, photos, Word, Excel, PowerPoint, CSV or text.`;
  $("file-hint").textContent = d?.fileName ? `Current file: ${d.fileName}. Choose a new one to replace it.` : limit;
  $("doc-err").hidden = true; $("doc-progress").hidden = true; setSaving(false);
  $("dlg-doc").showModal(); if (matchMedia("(min-width:641px)").matches) $("d-title").focus();
}
function setSaving(on, label){ $("doc-save").disabled=on; $("doc-save").textContent = on ? (label||"Saving…") : "Save document"; }
$("form-doc").addEventListener("submit", async e => {
  e.preventDefault();
  const err = msg => { $("doc-err").textContent=msg; $("doc-err").hidden=false; setSaving(false); $("doc-progress").hidden=true; };
  const title = $("d-title").value.trim(); if (!title) return err("Give the document a title.");
  const link = $("d-link").value.trim(); if (link && !/^https?:\/\//i.test(link)) return err("Links must start with https://");
  const f = $("d-file").files[0];
  if (f && f.size > S.maxFile) return err(`That file is over ${Math.round(S.maxFile/1048576)} MB. Compress it or add a link instead.`);
  const prev = S.editDoc;
  const body = { title, moduleId:$("d-module").value, status:$("d-status").value, party:$("d-party").value.trim(), expiry:$("d-expiry").value || "",
    tags:$("d-tags").value.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean).slice(0,12), link, notes:$("d-notes").value.trim() };
  setSaving(true);
  let saved;
  try { saved = await api(prev ? `/api/documents/${prev.id}` : "/api/documents", { method: prev ? "PATCH" : "POST", body }); putDoc(saved); }
  catch(x){ return err(x.message); }
  if (f){
    $("doc-progress").hidden=false; const bar=$("doc-progress").firstElementChild; bar.style.width="0";
    try { saved = await uploadFile(saved.id, f, p => { bar.style.width = Math.round(p*100)+"%"; setSaving(true, `Uploading ${Math.round(p*100)}%`); }); putDoc(saved); }
    catch(x){ S.editDoc = saved; S.openId = saved.id; render(); $("doc-dlg-title").textContent="Edit document"; return err(`Record saved as ${saved.ref}, but the file didn't upload: ${x.message}`); }
  }
  S.openId = saved.id;
  if (modById(S.view) && S.view !== saved.moduleId) S.view = saved.moduleId;
  $("dlg-doc").close(); render(); toast(prev ? "Document updated" : `Filed as ${saved.ref}`);
});
async function deleteDoc(btn){
  const d = findDoc(S.openId); if (!d) return;
  if (!btn.classList.contains("armed")){ btn.classList.add("armed"); btn.textContent="Confirm delete"; setTimeout(()=>{ if(btn.isConnected){btn.classList.remove("armed");btn.textContent="Delete";} },4000); return; }
  try { await api(`/api/documents/${d.id}`, {method:"DELETE"}); S.docs=S.docs.filter(x=>x.id!==d.id); S.vault=S.vault.filter(x=>x.id!==d.id); S.openId=null; render(); toast(`Deleted ${d.ref||"document"}`); }
  catch(x){ toast(x.message); }
}
async function shareDoc(){
  const d = findDoc(S.openId); if (!d?.hasFile) return;
  try {
    const res = await fetch(fileUrl(d,true)); if (!res.ok) throw 0;
    const file = new File([await res.blob()], d.fileName || "document", {type: d.fileType || "application/octet-stream"});
    if (!navigator.canShare({files:[file]})) throw 0;
    await navigator.share({files:[file], title:d.title});
  } catch(x){ if (x?.name!=="AbortError") toast("Sharing isn't available here. Use Download instead."); }
}

/* ---------- modules ---------- */
function openModDialog(m){
  S.editMod = m || null;
  $("mod-dlg-title").textContent = m ? "Edit module" : "New module";
  $("m-name").value = m?.name || ""; $("m-code").value = m?.code || ""; $("m-desc").value = m?.description || "";
  $("mod-delete").hidden = !m; $("mod-delete").classList.remove("armed"); $("mod-delete").textContent="Delete module";
  $("mod-err").hidden = true; $("dlg-mod").showModal(); $("m-name").focus();
}
$("form-mod").addEventListener("submit", async e => {
  e.preventDefault();
  const err = msg => { $("mod-err").textContent=msg; $("mod-err").hidden=false; };
  const name = $("m-name").value.trim(); const code = $("m-code").value.trim().toUpperCase().replace(/[^A-Z]/g,"");
  if (!name) return err("Name the module.");
  if (code.length<2) return err("Use a 2 to 4 letter code.");
  if (S.modules.some(m => m.code===code && m.id!==S.editMod?.id)) return err(`Code ${code} is already used by another module.`);
  const body = {name, code, description:$("m-desc").value.trim()};
  try {
    if (S.editMod){
      const m = await api(`/api/modules/${S.editMod.id}`, {method:"PATCH", body}); upsert(S.modules, m);
      toast(code !== S.editMod.code ? "Module saved. Existing reference numbers keep their original code." : "Module saved");
    } else {
      const m = await api("/api/modules", {method:"POST", body}); S.modules.push(m); S.view = m.id; toast(`${name} created`);
    }
    $("dlg-mod").close(); render();
  } catch(x){ err(x.message); }
});
$("mod-delete").addEventListener("click", async e => {
  const m = S.editMod; if (!m) return;
  const n = S.docs.filter(d=>d.moduleId===m.id).length;
  if (n){ $("mod-err").textContent = `Move or delete its ${n} document${n>1?"s":""} first.`; $("mod-err").hidden=false; return; }
  const b = e.currentTarget;
  if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Confirm delete"; return; }
  try { await api(`/api/modules/${m.id}`, {method:"DELETE"}); S.modules=S.modules.filter(x=>x.id!==m.id); $("dlg-mod").close(); S.view="all"; toast(`${m.name} deleted`); render(); }
  catch(x){ $("mod-err").textContent=x.message; $("mod-err").hidden=false; }
});

/* ---------- case file ---------- */
function openCaseDialog(){
  $("c-pass").value=""; $("case-err").hidden=true; $("case-go").disabled=false;
  $("case-note").textContent = `Stays unlocked on this device for ${S.caseInfo.hours} hours, then locks again.`;
  $("dlg-case").showModal(); $("c-pass").focus();
}
$("form-case").addEventListener("submit", async e => {
  e.preventDefault(); $("case-go").disabled=true;
  try { await api("/api/case/unlock", {method:"POST", body:{password:$("c-pass").value}}); $("dlg-case").close(); S.view="case"; await load(); toast("Case File unlocked"); }
  catch(x){ $("case-err").textContent=x.message; $("case-err").hidden=false; $("case-go").disabled=false; $("c-pass").select(); }
});
async function lockCase(){
  closeMenu();
  try { await api("/api/case/lock", {method:"POST"}); } catch(x){}
  S.vault=[]; if (S.view==="case") S.view="all"; S.openId=null; await load().catch(()=>render()); toast("Case File locked");
}

/* ---------- import ---------- */
$("import-file").addEventListener("change", async e => {
  closeMenu();
  const f = e.target.files[0]; e.target.value=""; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch(x){ return toast("That isn't a register export (.json)."); }
  if (data.vault?.length && !caseOpen()) return toast("This export includes Case File records. Unlock the Case File first, then import again.");
  try {
    const r = await api("/api/import", {method:"POST", body:{modules:data.modules||[], documents:data.documents||[], vault:data.vault||[]}});
    await load(); toast(`Imported ${r.documents} document${r.documents===1?"":"s"} and ${r.modules} module${r.modules===1?"":"s"}${r.skipped?`, skipped ${r.skipped}`:""}`);
  } catch(x){ toast(x.message); }
});

/* ---------- theme + install ---------- */
const THEMES = ["system","light","dark"];
function applyTheme(t){
  if (t==="system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  $("theme-name").textContent = t[0].toUpperCase()+t.slice(1);
}
function cycleTheme(){
  let cur="system"; try{ cur=localStorage.getItem("vg-theme")||"system"; }catch(e){}
  const next = THEMES[(THEMES.indexOf(cur)+1)%THEMES.length];
  try{ localStorage.setItem("vg-theme", next); }catch(e){}
  applyTheme(next);
}
try{ applyTheme(localStorage.getItem("vg-theme")||"system"); }catch(e){ applyTheme("system"); }
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("m-install").hidden = false; });
async function installApp(){ closeMenu(); if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(()=>{}); installEvt=null; $("m-install").hidden=true; }
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(()=>{}));

/* ---------- boot ---------- */
{ const h = location.hash.replace(/^#\/?/, ""); if (["expiring","nofile"].includes(h)) S.view = h; }
render();
load().catch(x => { S.loaded=true; notice(x.message || "Couldn't load the register."); render(); });
// Another device may have changed the register: refresh when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => { if (document.visibilityState==="visible" && !document.querySelector("dialog[open]")) load().catch(()=>{}); });
