/* Vanguard Docs: document-control register on Supabase.
   Every permission (roles, Case File, files) is enforced by row-level security in the database;
   this file only decides what to show. */
const CFG = window.VG_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});
const BUCKET = "documents";
const MAX_FILE = 25 * 1048576;
const CASE = { id:"case", name:"Case File", code:"CASE", description:"Shareholder dispute dossier, evidence and counsel material. Owners only, behind its own passcode, enforced in the database.", locked:true };
const STATUSES = ["Draft","Active","In review","Expired","Archived"];
const FILE_TYPES = { pdf:"application/pdf", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", heic:"image/heic",
  csv:"text/csv", md:"text/markdown", json:"application/json", txt:"text/plain",
  doc:"application/msword", xls:"application/vnd.ms-excel", ppt:"application/vnd.ms-powerpoint",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const S = { vault:[], modules:[], docs:[], caseInfo:{enabled:false,unlocked:false,hours:8}, role:null, user:null,
  view:"all", q:"", status:"", sort:"updated", openId:null, loaded:false, editDoc:null, editMod:null, authMode:"signin" };
let installEvt = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDate = d => d ? new Date(d + (d.length===10?"T00:00:00":"")).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "";
const fmtSize = b => !b ? "" : b < 1024*1024 ? Math.max(1, Math.round(b/1024))+" KB" : (b/1048576).toFixed(1)+" MB";
const today = () => { const t=new Date(); t.setHours(0,0,0,0); return t; };
const daysTo = d => d ? Math.round((new Date(d+"T00:00:00") - today())/86400000) : null;
const stamp = d => d ? Date.parse(d) || 0 : 0;
const canWrite = () => S.role==="owner" || S.role==="editor";
const isOwner = () => S.role==="owner";
const caseOpen = () => isOwner() && S.caseInfo.unlocked;
const modById = id => id === "case" ? (isOwner() ? CASE : undefined) : S.modules.find(m => m.id === id);
const findDoc = id => S.docs.find(x=>x.id===id) || S.vault.find(x=>x.id===id);
const sClass = s => "s-" + String(s).replace(/\s/g,"");
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2800); }
function notice(msg){ const n=$("notice"); n.textContent=msg; n.hidden=!msg; }

/* ---------- data ---------- */
function friendly(e){
  const m = String(e?.message || e || "");
  if (e?.code === "23505" && /code/.test(m)) return "That code is already used by another module.";
  if (e?.code === "23503") return "Move or delete this module's documents first.";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) return "You don't have permission to do that. Ask an owner for access.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "You're offline. Check your connection and try again.";
  if (/JWT expired|invalid JWT/i.test(m)) return "Your session expired. Sign in again.";
  return m || "Something went wrong. Try again.";
}
async function q(promise){ const { data, error } = await promise; if (error) throw error; return data; }
const modOut = r => ({ id:String(r.id), name:r.name, code:r.code, description:r.description, order:r.sort_order });
const docOut = r => ({ id:String(r.id), moduleId: r.is_case ? "case" : String(r.module_id), ref:r.ref, seq:r.seq, title:r.title, status:r.status,
  party:r.party, expiry:r.expiry || "", tags:r.tags || [], link:r.link, notes:r.notes, hasFile:!!r.file_path, filePath:r.file_path,
  fileName:r.file_name, fileType:r.file_type, fileSize:r.file_size, createdAt:r.created_at, updatedAt:r.updated_at });

async function load(){
  const [cs, mods, docs] = await Promise.all([
    q(sb.rpc("case_status")),
    q(sb.from("modules").select("*").order("sort_order").order("name")),
    q(sb.from("documents").select("*")),
  ]);
  S.role = cs.role; S.caseInfo = cs;
  if (!["owner","editor","viewer"].includes(S.role)) return showPending();
  S.modules = mods.map(modOut);
  const all = docs.map(docOut);
  S.docs = all.filter(d => d.moduleId !== "case"); S.vault = all.filter(d => d.moduleId === "case");
  S.loaded = true;
  if (!["all","expiring","nofile"].includes(S.view) && !modById(S.view)) S.view = "all";
  if (S.view === "case" && !caseOpen()) S.view = "all";
  if (S.openId && !findDoc(S.openId)) S.openId = null;
  showApp();
  render();
}
const upsert = (list, d) => { const i = list.findIndex(x=>x.id===d.id); i<0 ? list.push(d) : list.splice(i,1,d); };
function putDoc(d){ S.docs = S.docs.filter(x=>x.id!==d.id); S.vault = S.vault.filter(x=>x.id!==d.id); upsert(d.moduleId==="case"?S.vault:S.docs, d); }

STATUSES.forEach(s => { $("f-status").insertAdjacentHTML("beforeend", `<option>${s}</option>`); $("d-status").insertAdjacentHTML("beforeend", `<option>${s}</option>`); });

/* ---------- screens ---------- */
function showApp(){
  $("auth").hidden = true; $("pending").hidden = true; $("app").hidden = false;
  const w = canWrite();
  $("btn-add").hidden = !w; $("btn-module").hidden = !w; $("m-import").hidden = !w;
  $("m-team").hidden = !isOwner(); $("m-lockcase").hidden = !caseOpen(); $("m-passcode").hidden = !(isOwner() && S.caseInfo.enabled);
  $("m-who").textContent = `${S.user?.email || ""} · ${S.role}`;
  notice(S.role === "viewer" ? "You have view access. Ask an owner to make you an editor to file documents." : "");
}
function showPending(){
  $("app").hidden = true; $("auth").hidden = true; $("pending").hidden = false;
  $("pending-email").textContent = S.user?.email || "";
}
function showAuth(mode, msg){
  S.authMode = mode || "signin";
  $("app").hidden = true; $("pending").hidden = true; $("auth").hidden = false;
  const m = S.authMode;
  const titles = { signin:"Sign in", signup:"Create an account", forgot:"Reset your password", reset:"Choose a new password" };
  const go = { signin:"Sign in", signup:"Create account", forgot:"Send reset link", reset:"Save password" };
  $("auth-title").textContent = titles[m]; $("auth-go").textContent = go[m]; $("auth-go").disabled = false;
  $("auth-email-l").hidden = m === "reset"; $("auth-pass-l").hidden = m === "forgot";
  $("auth-pass").autocomplete = m === "signin" ? "current-password" : "new-password";
  $("auth-links").innerHTML = m === "signin"
    ? `<button type="button" class="link" data-auth="forgot">Forgot password?</button><button type="button" class="link" data-auth="signup">Create an account</button>`
    : m === "reset" ? "" : `<button type="button" class="link" data-auth="signin">Back to sign in</button>`;
  $("auth-err").hidden = true; $("auth-msg").hidden = !msg; $("auth-msg").textContent = msg || "";
}
document.addEventListener("click", e => { const a = e.target.closest("[data-auth]"); if (a) showAuth(a.dataset.auth); });
$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  const m = S.authMode, email = $("auth-email").value.trim(), password = $("auth-pass").value;
  const err = msg => { $("auth-err").textContent = msg; $("auth-err").hidden = false; $("auth-go").disabled = false; };
  if (m !== "reset" && !/^\S+@\S+\.\S+$/.test(email)) return err("Enter your email address.");
  if (m !== "forgot" && password.length < 8) return err("Passwords are at least 8 characters.");
  $("auth-go").disabled = true; $("auth-err").hidden = true;
  const back = location.origin + location.pathname;
  try {
    if (m === "signin") await q(sb.auth.signInWithPassword({ email, password }));
    else if (m === "signup"){
      const r = await q(sb.auth.signUp({ email, password, options:{ emailRedirectTo: back } }));
      if (!r.session) return showAuth("signin", `Check ${email} for a confirmation link, then sign in.`);
    }
    else if (m === "forgot"){ await q(sb.auth.resetPasswordForEmail(email, { redirectTo: back })); return showAuth("signin", `If ${email} has an account, a reset link is on its way.`); }
    else if (m === "reset"){ await q(sb.auth.updateUser({ password })); recovering = false; toast("Password updated"); await boot(); }
  } catch(x){ err(/Invalid login/i.test(x.message) ? "Wrong email or password." : /Email not confirmed/i.test(x.message) ? "Confirm your email first: open the link we sent you." : friendly(x)); }
});

/* ---------- derived ---------- */
function expiringSoon(d){ const n=daysTo(d.expiry); return n!==null && n<=30 && d.status!=="Archived"; }
function visibleDocs(){
  let list = S.view==="case" ? S.vault.slice() : S.docs.slice();
  if (S.view==="case") {}
  else if (S.view==="expiring") list = list.filter(expiringSoon);
  else if (S.view==="nofile") list = list.filter(d => !d.hasFile && !d.link);
  else if (S.view!=="all") list = list.filter(d => d.moduleId===S.view);
  if (S.status) list = list.filter(d => d.status===S.status);
  if (S.q){ const ql=S.q.toLowerCase(); list = list.filter(d => [d.title,d.ref,d.party,(d.tags||[]).join(" "),d.notes,d.fileName].join(" ").toLowerCase().includes(ql)); }
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
  h += `<h3>Modules ${canWrite()?`<button type="button" data-act="newmod">+ Add</button>`:""}</h3>`;
  if (!S.modules.length) h += `<div class="empty">${S.loaded?"No modules yet.":"Loading modules…"}</div>`;
  S.modules.slice().sort((a,b)=>(a.order??999)-(b.order??999) || a.name.localeCompare(b.name)).forEach(m => h += nav(m.id,m.name,count(m.id),m.code));
  if (isOwner()) h += `<h3>Restricted</h3>` + `<button class="nav lockednav ${S.view==="case"?"on":""}" data-view="case" type="button"><span class="code">CASE</span><span class="name">Case File <span class="lock ${caseOpen()?"":"off"}">${!S.caseInfo.enabled?"Set up":caseOpen()?"Unlocked":"Locked"}</span></span><span class="n">${caseOpen()?S.vault.length:""}</span></button>`;
  if (canWrite()) h += `<button class="btn addmod" type="button" data-act="newmod">+ Module</button>`;
  $("rail").innerHTML = h;
}
function renderHead(){
  const m = modById(S.view);
  const titles = { all:["All documents","Every record across every module."], expiring:["Expiring in 30 days","Contracts, licences and filings that need renewal or action soon."], nofile:["Missing file","Records with no file and no link attached. Close these gaps."] };
  const [t,s] = m ? [m.name, m.description || `Documents filed under ${m.code}.`] : (titles[S.view]||titles.all);
  $("view-title").textContent = t; $("view-sub").textContent = s;
  $("btn-editmod").hidden = !m || !!m.locked || !canWrite();
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
      : m ? [`${m.name} is empty`, canWrite() ? "Add the first document to this module." : "Nothing has been filed here yet."]
      : S.view==="expiring" ? ["Nothing expiring","No document has an expiry date in the next 30 days."]
      : S.view==="nofile" ? ["Every record has a file","Nothing to chase here."]
      : !S.modules.length ? ["Start with a module", canWrite() ? "Create a module like Client Contracts or HR, then file documents into it. Moving from the claude.ai version? Use More → Import register." : "An editor needs to set up the first module."]
      : ["No documents yet","Each document gets a reference number from its module code."];
    const cta = canWrite() && !(S.q||S.status) && S.view!=="expiring" && S.view!=="nofile" ? (S.modules.length||S.view==="case"?`<button class="btn primary" type="button" data-act="add">Add document</button>`:`<button class="btn primary" type="button" data-act="newmod">New module</button>`) : "";
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
      ${d.hasFile ? `<div class="filebox">${isImg?`<img id="preview" alt="${esc(d.fileName)}" hidden>`:""}
        <div class="row"><span class="ftype">${esc(fileExt(d))}</span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(d.fileName)}</span><span class="mono" style="color:var(--muted)">${fmtSize(d.fileSize)}</span></div>
        <div class="row"><button class="btn" type="button" data-act="openfile">Open file</button><button class="btn" type="button" data-act="download">Download</button>${navigator.canShare?`<button class="btn" type="button" data-act="share">Share</button>`:""}</div></div>` : ""}
      ${d.link ? `<div class="filebox"><div class="row"><span class="ftype">link</span><a href="${esc(d.link)}" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere">${esc(d.link)}</a></div></div>` : ""}
      ${!d.hasFile && !d.link ? `<div class="filebox" style="color:var(--bad)">No file or link attached.</div>` : ""}
      ${d.notes ? `<div><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Notes</div><div class="notes">${esc(d.notes)}</div></div>` : ""}
    </div>
    ${canWrite() && (d.moduleId!=="case" || caseOpen()) ? `<footer><button class="btn primary" type="button" data-act="edit">Edit</button><button class="btn danger" type="button" data-act="delete">Delete</button></footer>` : ""}
  </aside>`;
  if (isImg && d.hasFile) signedUrl(d).then(u => { const img=$("preview"); if (img && S.openId===d.id){ img.src=u; img.hidden=false; } }).catch(()=>{});
}
function render(){ renderRail(); renderHead(); renderStats(); renderList(); renderDrawer(); }

/* ---------- events ---------- */
document.addEventListener("click", e => {
  if (!e.target.closest(".menu-wrap")) closeMenu();
  const v = e.target.closest("[data-view]");
  if (v){ const view=v.dataset.view; if (view==="case" && !caseOpen()) return openCaseDialog(S.caseInfo.enabled ? "unlock" : "setup"); S.view=view; render(); scrollTo({top:0}); return; }
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
  else if (act==="openfile") openFile(false);
  else if (act==="download") openFile(true);
  else if (act==="share") shareDoc();
  else if (act==="export") exportRegister();
  else if (act==="lockcase") lockCase();
  else if (act==="passcode"){ closeMenu(); openCaseDialog("change"); }
  else if (act==="team") openTeam();
  else if (act==="theme") cycleTheme();
  else if (act==="logout"){ closeMenu(); sb.auth.signOut(); }
  else if (act==="recheck") boot();
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

/* ---------- files ---------- */
async function signedUrl(d, download){
  const r = await q(sb.storage.from(BUCKET).createSignedUrl(d.filePath, 300, download ? { download: d.fileName || true } : undefined));
  return r.signedUrl;
}
async function openFile(download){
  const d = findDoc(S.openId); if (!d?.hasFile) return;
  // Open the tab inside the tap so phone browsers don't block it, then point it at the file.
  const win = download ? null : window.open("", "_blank");
  try {
    const url = await signedUrl(d, download);
    if (win) win.location.href = url; else location.href = url;
  } catch(x){ if (win) win.close(); toast(friendly(x)); }
}
async function shareDoc(){
  const d = findDoc(S.openId); if (!d?.hasFile) return;
  try {
    const res = await fetch(await signedUrl(d)); if (!res.ok) throw 0;
    const file = new File([await res.blob()], d.fileName || "document", {type: d.fileType || "application/octet-stream"});
    if (!navigator.canShare({files:[file]})) throw 0;
    await navigator.share({files:[file], title:d.title});
  } catch(x){ if (x?.name!=="AbortError") toast("Sharing isn't available here. Use Download instead."); }
}
// XHR rather than supabase-js so the save button can show upload progress.
async function uploadFile(docId, file, onProgress){
  const ext = (file.name.split(".").pop()||"").toLowerCase(), type = FILE_TYPES[ext];
  if (!type) throw new Error("That file type can't be stored. Use PDF, a photo, Word, Excel, PowerPoint, CSV or text.");
  const safe = file.name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-120) || `file.${ext}`;
  const path = `${docId}/${crypto.randomUUID()}-${safe}`;
  const { data:{ session } } = await sb.auth.getSession();
  await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${CFG.supabaseUrl}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`);
    x.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
    x.setRequestHeader("apikey", CFG.supabaseKey);
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { if (x.status < 300) return resolve(); let m=""; try{ m=JSON.parse(x.responseText).message; }catch(e){}
      reject(new Error(/size/i.test(m) ? "That file is over 25 MB. Compress it or add a link instead." : /mime|type/i.test(m) ? "That file type can't be stored." : /security|unauthor/i.test(m) ? "You don't have permission to upload here." : m || "Upload failed. Try again.")); };
    x.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    x.send(file);
  });
  return { file_path:path, file_name:file.name, file_type:type, file_size:file.size };
}
async function removeObject(path){ if (path) await sb.storage.from(BUCKET).remove([path]).catch(()=>{}); }

/* ---------- documents ---------- */
function moduleOptions(){
  return S.modules.slice().sort((a,b)=>(a.order??999)-(b.order??999)).map(m=>`<option value="${esc(m.id)}">${esc(m.code)} · ${esc(m.name)}</option>`).join("")
    + (caseOpen()?`<option value="case">CASE · Case File (restricted)</option>`:"");
}
function openDocDialog(d){
  if (!canWrite()) return;
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
  $("file-hint").textContent = d?.fileName ? `Current file: ${d.fileName}. Choose a new one to replace it.` : "Up to 25 MB. PDF, photos, Word, Excel, PowerPoint, CSV or text.";
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
  if (f && f.size > MAX_FILE) return err("That file is over 25 MB. Compress it or add a link instead.");
  if (f && !FILE_TYPES[(f.name.split(".").pop()||"").toLowerCase()]) return err("That file type can't be stored. Use PDF, a photo, Word, Excel, PowerPoint, CSV or text.");
  const prev = S.editDoc, moduleId = $("d-module").value, isCase = moduleId === "case";
  const tags = [...new Set($("d-tags").value.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean))].slice(0,12);
  const row = { title, module_id: isCase ? null : Number(moduleId), is_case: isCase, status:$("d-status").value, party:$("d-party").value.trim(),
    expiry:$("d-expiry").value || null, tags, link, notes:$("d-notes").value.trim() };
  setSaving(true);
  let saved;
  try {
    const r = prev ? await q(sb.from("documents").update(row).eq("id", prev.id).select().single())
                   : await q(sb.from("documents").insert(row).select().single());
    saved = docOut(r); putDoc(saved);
  } catch(x){ return err(friendly(x)); }
  if (f){
    $("doc-progress").hidden=false; const bar=$("doc-progress").firstElementChild; bar.style.width="0";
    try {
      const meta = await uploadFile(saved.id, f, p => { bar.style.width = Math.round(p*100)+"%"; setSaving(true, `Uploading ${Math.round(p*100)}%`); });
      const old = saved.filePath;
      saved = docOut(await q(sb.from("documents").update(meta).eq("id", saved.id).select().single())); putDoc(saved);
      removeObject(old);
    } catch(x){ S.editDoc = saved; S.openId = saved.id; render(); $("doc-dlg-title").textContent="Edit document"; return err(`Record saved as ${saved.ref}, but the file didn't upload: ${friendly(x)}`); }
  }
  S.openId = saved.id;
  if (modById(S.view) && S.view !== saved.moduleId) S.view = saved.moduleId;
  $("dlg-doc").close(); render(); toast(prev ? "Document updated" : `Filed as ${saved.ref}`);
});
async function deleteDoc(btn){
  const d = findDoc(S.openId); if (!d) return;
  if (!btn.classList.contains("armed")){ btn.classList.add("armed"); btn.textContent="Confirm delete"; setTimeout(()=>{ if(btn.isConnected){btn.classList.remove("armed");btn.textContent="Delete";} },4000); return; }
  try {
    await removeObject(d.filePath);
    await q(sb.from("documents").delete().eq("id", d.id));
    S.docs=S.docs.filter(x=>x.id!==d.id); S.vault=S.vault.filter(x=>x.id!==d.id); S.openId=null; render(); toast(`Deleted ${d.ref||"document"}`);
  } catch(x){ toast(friendly(x)); }
}

/* ---------- modules ---------- */
function openModDialog(m){
  if (!canWrite()) return;
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
  if (code.length<2 || code.length>4) return err("Use a 2 to 4 letter code.");
  if (code === "CASE") return err("CASE is reserved for the Case File.");
  if (S.modules.some(m => m.code===code && m.id!==S.editMod?.id)) return err(`Code ${code} is already used by another module.`);
  const body = {name, code, description:$("m-desc").value.trim()};
  try {
    if (S.editMod){
      const m = modOut(await q(sb.from("modules").update(body).eq("id", S.editMod.id).select().single())); upsert(S.modules, m);
      toast(code !== S.editMod.code ? "Module saved. Existing reference numbers keep their original code." : "Module saved");
    } else {
      body.sort_order = Math.max(0, ...S.modules.map(m=>m.order||0)) + 1;
      const m = modOut(await q(sb.from("modules").insert(body).select().single())); S.modules.push(m); S.view = m.id; toast(`${name} created`);
    }
    $("dlg-mod").close(); render();
  } catch(x){ err(friendly(x)); }
});
$("mod-delete").addEventListener("click", async e => {
  const m = S.editMod; if (!m) return;
  const n = S.docs.filter(d=>d.moduleId===m.id).length;
  if (n){ $("mod-err").textContent = `Move or delete its ${n} document${n>1?"s":""} first.`; $("mod-err").hidden=false; return; }
  const b = e.currentTarget;
  if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Confirm delete"; return; }
  try { await q(sb.from("modules").delete().eq("id", m.id)); S.modules=S.modules.filter(x=>x.id!==m.id); $("dlg-mod").close(); S.view="all"; toast(`${m.name} deleted`); render(); }
  catch(x){ $("mod-err").textContent=friendly(x); $("mod-err").hidden=false; }
});

/* ---------- case file ---------- */
let caseMode = "unlock";
function openCaseDialog(mode){
  if (!isOwner()) return;
  caseMode = mode;
  const setup = mode !== "unlock";
  $("case-title").textContent = mode==="setup" ? "Set up the Case File" : mode==="change" ? "Change Case File passcode" : "Unlock Case File";
  $("c-cur-l").hidden = mode !== "change"; $("c-pass2-l").hidden = !setup;
  $("c-pass-label").textContent = setup ? "New passcode (8+ characters)" : "Case File passcode";
  $("c-pass").autocomplete = setup ? "new-password" : "off";
  $("case-go").textContent = setup ? "Save passcode" : "Unlock";
  $("case-note").textContent = mode==="setup" ? "This passcode is separate from your sign-in. It's stored hashed; if it's lost, it can only be reset from the Supabase dashboard."
    : mode==="change" ? "Changing it locks the Case File everywhere." : `Stays unlocked for ${S.caseInfo.hours} hours, then locks again.`;
  ["c-pass","c-pass2","c-cur"].forEach(id => $(id).value=""); $("case-err").hidden=true; $("case-go").disabled=false;
  $("dlg-case").showModal(); (mode==="change" ? $("c-cur") : $("c-pass")).focus();
}
$("form-case").addEventListener("submit", async e => {
  e.preventDefault();
  const err = msg => { $("case-err").textContent=msg; $("case-err").hidden=false; $("case-go").disabled=false; };
  const pass = $("c-pass").value;
  if (caseMode !== "unlock"){
    if (pass.length < 8) return err("Use at least 8 characters.");
    if (pass !== $("c-pass2").value) return err("The two passcodes don't match.");
  }
  $("case-go").disabled=true;
  try {
    if (caseMode === "unlock"){
      const r = await q(sb.rpc("unlock_case", { passcode: pass }));
      if (!r.ok) return err(r.error);
      $("dlg-case").close(); S.view="case"; await load(); toast("Case File unlocked");
    } else {
      const r = await q(sb.rpc("set_case_passcode", { new_passcode: pass, current_passcode: $("c-cur").value }));
      if (!r.ok) return err(r.error);
      $("dlg-case").close(); await load(); toast(caseMode==="setup" ? "Passcode saved. Unlock the Case File to use it." : "Passcode changed. The Case File is locked.");
    }
  } catch(x){ err(friendly(x)); }
});
async function lockCase(){
  closeMenu();
  try { await q(sb.rpc("lock_case")); } catch(x){}
  S.vault=[]; if (S.view==="case") S.view="all"; S.openId=null; await load().catch(()=>render()); toast("Case File locked");
}

/* ---------- team ---------- */
async function openTeam(){
  closeMenu(); $("team-err").hidden = true; $("team-list").innerHTML = `<div class="unlock-note">Loading…</div>`;
  if (!$("dlg-team").open) $("dlg-team").showModal();
  try {
    const rows = await q(sb.from("members").select("*").order("created_at"));
    const roles = ["pending","viewer","editor","owner"];
    $("team-list").innerHTML = rows.map(r => `<div class="row ${r.role==="pending"?"pend":""}"><div class="who">${esc(r.email)}<small>${r.user_id===S.user.id?"You":`Joined ${new Date(r.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}`}</small></div>
      <select data-member="${esc(r.user_id)}" aria-label="Role for ${esc(r.email)}" ${r.user_id===S.user.id?"disabled":""}>${roles.map(x=>`<option ${x===r.role?"selected":""}>${x}</option>`).join("")}</select></div>`).join("");
  } catch(x){ $("team-err").textContent = friendly(x); $("team-err").hidden = false; }
}
$("team-list").addEventListener("change", async e => {
  const sel = e.target.closest("select[data-member]"); if (!sel) return;
  try { await q(sb.from("members").update({ role: sel.value }).eq("user_id", sel.dataset.member)); toast("Access updated"); sel.closest(".row").classList.toggle("pend", sel.value==="pending"); }
  catch(x){ $("team-err").textContent = friendly(x); $("team-err").hidden = false; openTeam(); }
});

/* ---------- import and export ---------- */
function exportRegister(){
  closeMenu();
  const strip = d => { const { hasFile, filePath, ...rest } = d; return rest; };
  const data = { exportedAt: new Date().toISOString(), modules: S.modules, documents: S.docs.map(strip), vault: caseOpen() ? S.vault.map(strip) : [] };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}));
  a.download = `vanguard-register-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Accepts an export from this app or from the claude.ai version. Modules match on code and
// documents on reference number, so importing the same file twice adds nothing.
$("import-file").addEventListener("change", async e => {
  closeMenu();
  const f = e.target.files[0]; e.target.value=""; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch(x){ return toast("That isn't a register export (.json)."); }
  if (data.vault?.length && !caseOpen()) return toast("This export includes Case File records. Unlock the Case File first, then import again.");
  const added = { modules:0, documents:0, skipped:0 };
  try {
    const idMap = {};
    for (const m of (data.modules||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0))){
      const code = String(m.code||"").toUpperCase().replace(/[^A-Z]/g,"");
      if (code.length<2 || code.length>4 || code==="CASE") continue;
      let mine = S.modules.find(x => x.code===code);
      if (!mine){
        mine = modOut(await q(sb.from("modules").insert({ name:String(m.name||code).slice(0,60), code, description:String(m.description||"").slice(0,160),
          sort_order: Math.max(0, ...S.modules.map(x=>x.order||0)) + 1 }).select().single()));
        S.modules.push(mine); added.modules++;
      }
      idMap[String(m.id)] = mine.id;
    }
    const known = new Set([...S.docs, ...S.vault].map(d => d.ref));
    for (const d of [...(data.documents||[]), ...(data.vault||[]).map(v => ({...v, moduleId:"case"}))]){
      const isCase = d.moduleId === "case", mid = isCase ? null : idMap[String(d.moduleId)];
      if ((!isCase && !mid) || !String(d.title||"").trim() || (d.ref && known.has(d.ref))){ added.skipped++; continue; }
      const row = { title:String(d.title).trim().slice(0,160), module_id: mid ? Number(mid) : null, is_case:isCase,
        status: STATUSES.includes(d.status) ? d.status : "Active", party:String(d.party||"").slice(0,120),
        expiry: /^\d{4}-\d{2}-\d{2}$/.test(d.expiry||"") ? d.expiry : null,
        tags:[...new Set((Array.isArray(d.tags)?d.tags:String(d.tags||"").split(",")).map(t=>String(t).trim().toLowerCase()).filter(Boolean))].slice(0,12),
        link: /^https?:\/\//i.test(d.link||"") ? d.link : "", notes:String(d.notes||"").slice(0,4000), ref: d.ref || "" };
      try { await q(sb.from("documents").insert(row)); added.documents++; if (d.ref) known.add(d.ref); }
      catch(x){ added.skipped++; }
    }
    await load();
    toast(`Imported ${added.documents} document${added.documents===1?"":"s"} and ${added.modules} module${added.modules===1?"":"s"}${added.skipped?`, skipped ${added.skipped}`:""}`);
  } catch(x){ toast(friendly(x)); load().catch(()=>{}); }
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
let recovering = false;
async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (!S.user) return showAuth(S.authMode === "reset" ? "signin" : S.authMode);
  if (recovering) return showAuth("reset");
  try { await load(); }
  catch(x){ showApp(); S.loaded = true; render(); notice(friendly(x)); }
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY"){ recovering = true; S.user = session?.user || null; return showAuth("reset"); }
  if (event === "SIGNED_OUT"){ Object.assign(S, { user:null, role:null, docs:[], vault:[], modules:[], loaded:false, openId:null, view:"all" }); renderDrawer(); return showAuth("signin"); }
  // Defer: supabase-js must not be called from inside this callback.
  if (event === "SIGNED_IN" && (!S.user || S.user.id !== session?.user?.id)){ S.user = session.user; setTimeout(() => !recovering && boot(), 0); }
});
boot();
// Another device may have changed the register: refresh when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => { if (document.visibilityState==="visible" && S.user && !recovering && !document.querySelector("dialog[open]")) load().catch(()=>{}); });
