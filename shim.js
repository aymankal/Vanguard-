/* Scout Desk standalone runtime.
   Gives the desk page the same window.claude.use(...) API it had inside Claude,
   backed by Supabase: db, user, downloads, and sample (Copilot, optional). */
(function () {
  const cfg = window.SD_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) { console.warn("Scout Desk: config.js is missing Supabase details."); return; }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  window.SD_SB = sb;

  const E = (code, msg) => Object.assign(new Error(msg || code), { code });
  const mapErr = e => {
    if (!e) return E("unavailable");
    if (e.code === "42501" || /row-level security|permission denied/i.test(e.message || "")) return E("invalid_argument", e.message);
    if (String(e.code) === "429" || e.status === 429) return E("resource_exhausted", e.message);
    return E("unavailable", e.message);
  };
  const rid = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (const x of crypto.getRandomValues(new Uint8Array(20))) s += a[x % 36]; return s; };
  const split = p => { const i = p.lastIndexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };

  /* ---------- db ---------- */
  async function upsert(col, id, data) {
    const { error } = await sb.from("docs").upsert({ collection: col, id, data, updated_at: new Date().toISOString() });
    if (error) throw mapErr(error);
  }
  function docRef(col, id) {
    return {
      id,
      async set(data) { await upsert(col, id, data); },
      async update(patch) {
        const { data, error } = await sb.from("docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
        if (error) throw mapErr(error);
        if (!data) throw E("not_found");
        await upsert(col, id, { ...data.data, ...patch });
      },
      async delete() { const { error } = await sb.from("docs").delete().eq("collection", col).eq("id", id); if (error) throw mapErr(error); }
    };
  }
  const db = {
    doc(path) { const [c, i] = split(path); return docRef(c, i); },
    collection(col) {
      return {
        doc(id) { return docRef(col, id || rid()); },
        onSnapshot(fn, onErr) {
          const map = new Map(); let ready = false;
          const emit = () => fn({ docs: [...map.values()].map(r => ({ id: r.id, data: () => r.data })) });
          const ch = sb.channel("docs-" + col.replace(/\W/g, "-") + "-" + rid())
            .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
              const row = p.eventType === "DELETE" ? p.old : p.new;
              if (!row || row.collection !== col) return;
              if (p.eventType === "DELETE") map.delete(row.id); else map.set(row.id, { id: row.id, data: row.data });
              if (ready) emit();
            }).subscribe();
          (async () => {
            for (let from = 0; ; from += 1000) {
              const { data, error } = await sb.from("docs").select("id,data").eq("collection", col).order("id").range(from, from + 999);
              if (error) { onErr && onErr(mapErr(error)); return; }
              data.forEach(r => map.set(r.id, r));
              if (data.length < 1000) break;
            }
            ready = true; emit();
          })();
          return () => sb.removeChannel(ch);
        }
      };
    }
  };

  /* ---------- user ---------- */
  let session = null, profile = null;
  const user = {
    async me() {
      return { id: session.user.id, name: profile.name || session.user.email, email: session.user.email,
        avatarUrl: profile.avatar_url || null, canEdit: profile.role === "partner", isOwner: false };
    },
    async can(p) { return p === "data.write" ? profile.role === "scout" || profile.role === "partner" : false; },
    async profiles(ids) {
      const { data } = await sb.from("profiles").select("id,name,email").in("id", ids);
      const m = {}; (data || []).forEach(p => m[p.id] = { name: p.name || (p.email || "").split("@")[0], isMe: p.id === session.user.id });
      return m;
    }
  };

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  };

  /* ---------- Copilot (optional, needs the copilot edge function) ---------- */
  async function ai(messages, json, signal) {
    const { data, error } = await sb.functions.invoke("copilot", { body: { messages, json } });
    if (signal && signal.aborted) throw E("cancelled");
    if (error || !data || data.error) throw E("unavailable", (data && data.error) || (error && error.message));
    return data;
  }
  const sample = async (turns, o = {}) => { const d = await ai(turns, false, o.signal); o.onText && o.onText({ text: d.text }); return d; };
  sample.json = async (prompt, o = {}) => {
    const d = await ai([{ role: "user", content: prompt }], true, o.signal);
    const t = String(d.text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(t); } catch (e) { const m = t.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]); throw E("invalid_output"); }
  };

  /* ---------- sign-in gate ---------- */
  const css = document.createElement("style");
  css.textContent = `#sd-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(245,243,238,.96);font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c1b19;padding:20px}
#sd-gate .card{background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:32px;max-width:380px;width:100%}
#sd-gate h1{font-size:22px;margin:0 0 6px}#sd-gate p{margin:0 0 18px;color:#6b6760;line-height:1.45}
#sd-gate input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d9d5cc;border-radius:12px;font:inherit;margin-bottom:12px}
#sd-gate button{width:100%;padding:12px;border:0;border-radius:12px;background:#1c1b19;color:#fff;font:inherit;font-weight:600;cursor:pointer}
#sd-gate button.ghost{background:none;color:#6b6760;font-weight:500;margin-top:8px}#sd-gate .msg{margin-top:12px;font-size:14px;color:#6b6760}
#sd-out{margin-left:8px}`;
  document.head.append(css);
  function gate(kind) {
    let g = document.getElementById("sd-gate");
    if (!g) { g = document.createElement("div"); g.id = "sd-gate"; document.body.append(g); }
    if (kind === "hide") { g.remove(); return; }
    if (kind === "pending") {
      g.innerHTML = `<div class="card"><h1>Access pending</h1><p>You're signed in as <b>${session.user.email}</b>. A partner needs to approve your access before the desk opens.</p><button class="ghost" id="sd-g-out">Sign out</button></div>`;
      g.querySelector("#sd-g-out").onclick = () => sb.auth.signOut().then(() => location.reload());
      return;
    }
    g.innerHTML = `<div class="card"><h1>Scout Desk</h1><p>Sign in with your email. We'll send you a link.</p>
      <form id="sd-g-form"><input type="email" id="sd-g-email" placeholder="you@company.com" required autocomplete="email"><button type="submit">Send sign-in link</button></form><div class="msg" id="sd-g-msg"></div></div>`;
    g.querySelector("#sd-g-form").onsubmit = async e => {
      e.preventDefault();
      const email = g.querySelector("#sd-g-email").value.trim(), msg = g.querySelector("#sd-g-msg");
      msg.textContent = "Sending…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      msg.textContent = error ? "Could not send the link. " + error.message : "Check your inbox for the sign-in link.";
    };
  }
  function addSignOut() {
    if (document.getElementById("sd-out")) return;
    const who = document.querySelector("header .who"); if (!who) return;
    if (profile.role === "partner") {
      const f = document.createElement("input"); f.type = "file"; f.accept = ".xlsx"; f.hidden = true;
      const ib = document.createElement("button"); ib.className = "btn small"; ib.type = "button"; ib.textContent = "Import Excel";
      ib.title = "Load a Scout Desk Excel export (needs the Raw data sheet)";
      ib.onclick = () => f.click();
      f.onchange = async () => {
        const file = f.files[0]; f.value = ""; if (!file) return;
        ib.disabled = true; ib.textContent = "Importing…";
        try {
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const ws = wb.Sheets["Raw data"];
          if (!ws) throw new Error('This file has no "Raw data" sheet. Export it again from the old desk as a partner.');
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
          const docs = []; let bad = 0;
          for (const r of rows) { try { docs.push({ collection: String(r.Collection), id: String(r.ID), data: JSON.parse(r.JSON), updated_at: new Date().toISOString() }); } catch (e) { bad++; } }
          for (let i = 0; i < docs.length; i += 300) {
            const { error } = await sb.from("docs").upsert(docs.slice(i, i + 300));
            if (error) throw new Error(error.message);
            ib.textContent = "Importing… " + Math.min(i + 300, docs.length) + "/" + docs.length;
          }
          alert("Imported " + docs.length + " records." + (bad ? " Skipped " + bad + " broken rows." : "") + " The page will reload.");
          location.reload();
        } catch (e) { alert("Import failed. " + (e.message || e)); }
        finally { ib.disabled = false; ib.textContent = "Import Excel"; }
      };
      who.append(f, ib);
    }
    const b = document.createElement("button"); b.className = "btn small"; b.id = "sd-out"; b.type = "button"; b.textContent = "Sign out";
    b.onclick = () => sb.auth.signOut().then(() => location.reload());
    who.append(b);
  }

  const ready = new Promise(resolve => {
    let done = false;
    const start = async s => {
      if (done) return;
      session = s;
      if (!s) { gate("login"); return; }
      const { data } = await sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
      profile = data || { role: "pending" };
      if (profile.role === "pending") { gate("pending"); return; }
      done = true; gate("hide"); addSignOut(); resolve();
    };
    sb.auth.getSession().then(({ data }) => start(data.session));
    sb.auth.onAuthStateChange((_e, s) => { if (s) start(s); });
  });

  window.claude = {
    use(name) {
      if (name === "db") return ready.then(() => db);
      if (name === "user") return ready.then(() => user);
      if (name === "downloads") return Promise.resolve(downloads);
      if (name === "sample") return cfg.copilot ? ready.then(() => sample) : Promise.resolve(null);
      return Promise.resolve(null);
    }
  };
})();
