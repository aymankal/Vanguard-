/* Vanguard Client Hub. Clients see their own company's reports, pipeline, updates, pilots and chat;
   Vanguard staff see every client, post content and answer chat. Data and roles come from data.js. */
(function () {
  "use strict";
  const D = window.VCData;
  const $ = (id) => document.getElementById(id);

  const STAGES = ["New", "Contacted", "Meeting booked", "Qualified", "Proposal", "Won", "Lost"];
  const PILOT_STEPS = ["Requested", "Scoping", "Live", "Results", "Closed"];
  const SERVICES = ["SDR team", "Sales outsourcing", "Customer support", "Other"];
  const KINDS = ["Update", "Milestone", "Action needed", "News"];
  const METRICS = [
    ["meetings", "Meetings booked"], ["opportunities", "New opportunities"], ["connects", "Conversations"],
    ["calls", "Calls"], ["emails", "Emails sent"], ["pipeline", "Pipeline added ($)"],
  ];

  const S = {
    me: null, staff: false, clients: [], clientId: null,
    reports: [], pipeline: [], updates: [], pilots: [], messages: [],
    stageFilter: "All", tab: "home", unreadChat: 0, seenUpdates: 0,
  };

  /* ---------- helpers ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "on") for (const ev in v) el.addEventListener(ev, v[ev]);
      else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : String(c)); }
    return el;
  }
  const esc = (s) => String(s ?? "");
  function money(n) {
    n = Number(n); if (n == null || isNaN(n)) return "—";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }
  function fmtNum(n) { n = Number(n); return n == null || isNaN(n) ? "—" : n.toLocaleString("en-US"); }
  function day(iso, opts) {
    if (!iso) return ""; const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso); if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", Object.assign({ day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }, opts));
  }
  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago";
    return day(iso);
  }
  function weekLabel(ws) {
    const a = new Date(ws + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 6);
    return "Week of " + a.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – " + b.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function mondayOf(d) { d = new Date(d); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); }
  function nameOf(uid) { const m = D.people.team.get(uid); return m ? (m.name || m.email) : "Vanguard team"; }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
  function fail(err) {
    if (err && err.code === "denied") toast("That isn't allowed for your account.");
    else if (err && err.code === "duplicate") toast("There's already one for that week. Open it to edit.");
    else toast("Couldn't save. Check your connection and try again.");
  }
  const clientName = (id) => (S.clients.find((c) => c.id === id) || {}).name || "";

  /* ---------- sheet (forms and detail) ---------- */
  function openSheet(eyebrow, title, body) {
    $("sheet-eyebrow").textContent = eyebrow; $("sheet-title").textContent = title;
    const b = $("sheet-body"); b.textContent = ""; b.append(body);
    $("sheet").hidden = false; document.body.style.overflow = "hidden";
    const f = b.querySelector("input,select,textarea"); if (f && matchMedia("(min-width:720px)").matches) f.focus();
  }
  function closeSheet() { $("sheet").hidden = true; document.body.style.overflow = ""; }
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

  function field(label, input, opts) {
    const id = "f" + Math.random().toString(36).slice(2, 8); input.id = id;
    return h("div", { class: "field" + (opts && opts.full ? " full" : "") }, h("label", { for: id }, label), input, opts && opts.help ? h("span", { class: "help" }, opts.help) : null);
  }
  const inp = (type, value, extra) => h("input", Object.assign({ type, value: value ?? "" }, extra || {}));
  const ta = (value, rows, ph) => { const t = h("textarea", { rows: rows || 3, placeholder: ph || null }); t.value = value || ""; return t; };
  function sel(options, value) { const s = h("select", null, options.map((o) => h("option", { value: o }, o))); if (value != null) s.value = value; return s; }
  function formFoot(label, extra) {
    const btn = h("button", { class: "btn primary", type: "submit" }, label);
    return { btn, el: h("div", { class: "form-foot" }, btn, extra || null) };
  }
  function sheetForm(build, onSubmit, saveLabel) {
    const form = h("form", { class: "f", novalidate: true });
    const grid = h("div", { class: "grid" }); build(grid, form);
    const foot = formFoot(saveLabel || "Save");
    form.append(grid, foot.el);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); foot.btn.disabled = true;
      try { if ((await onSubmit()) !== false) closeSheet(); } catch (err) { fail(err); } finally { foot.btn.disabled = false; }
    });
    return form;
  }

  /* ---------- data loading ---------- */
  async function loadClients() {
    S.clients = await D.list("vc_clients", { order: "name", asc: true });
    if (!S.staff) S.clientId = D.people.me.client_id;
    else if (!S.clients.some((c) => c.id === S.clientId)) {
      let saved = null; try { saved = localStorage.getItem("vc:client"); } catch (e) {}
      S.clientId = S.clients.some((c) => c.id === saved) ? saved : (S.clients[0] || {}).id || null;
    }
  }
  async function loadClientData() {
    if (!S.clientId) { S.reports = []; S.pipeline = []; S.updates = []; S.pilots = []; S.messages = []; return; }
    const c = S.clientId;
    [S.reports, S.pipeline, S.updates, S.pilots, S.messages] = await Promise.all([
      D.list("vc_reports", { client: c, order: "week_start" }),
      D.list("vc_pipeline", { client: c, order: "updated_at" }),
      D.list("vc_updates", { client: c, includeBroadcast: true, order: "created_at" }),
      D.list("vc_pilots", { client: c, order: "created_at" }),
      D.list("vc_messages", { client: c, order: "created_at", asc: true }),
    ]);
  }

  /* ---------- header ---------- */
  function paintHeader() {
    $("who-name").textContent = S.me.name || S.me.email;
    const r = $("role"); r.textContent = S.staff ? "Vanguard team" : "Client"; r.className = "role " + (S.staff ? "partner" : "scout");
    $("client-name").textContent = clientName(S.clientId) || (S.staff ? "No clients yet" : "");
    $("client-eyebrow").textContent = S.staff ? "Viewing client" : "Your account";
    $("client-pick").hidden = !S.staff;
    $("t-team").hidden = !S.staff;
    document.querySelectorAll(".staff-only").forEach((el) => (el.hidden = !S.staff || !S.clientId));
    if (S.staff) {
      const s = $("client-select"); s.textContent = "";
      S.clients.forEach((c) => s.append(h("option", { value: c.id }, c.name)));
      if (S.clientId) s.value = S.clientId;
    }
    $("chat-sub").textContent = S.staff ? "This thread is between your team and " + (clientName(S.clientId) || "the client") + "." : "Messages go straight to your Vanguard account team.";
  }

  /* ---------- home ---------- */
  function kpiTiles(r, prev) {
    const m = (r && r.metrics) || {}, p = (prev && prev.metrics) || {};
    return h("div", { class: "kpis" }, METRICS.map(([k, label]) => {
      const v = m[k], pv = p[k];
      const delta = v != null && pv != null && pv !== 0 ? Math.round(((v - pv) / pv) * 100) : null;
      return h("div", { class: "kpi" },
        h("b", { class: "num" }, k === "pipeline" ? money(v) : fmtNum(v)),
        h("span", null, label),
        delta != null ? h("em", { class: "delta " + (delta >= 0 ? "up" : "down") }, (delta >= 0 ? "▲ " : "▼ ") + Math.abs(delta) + "% vs last week") : null);
    }));
  }
  function renderHome() {
    const first = (S.me.name || "").split(" ")[0];
    const hr = new Date().getHours();
    $("hello").textContent = (hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + (first ? ", " + first : "");
    const b = $("home-body"); b.textContent = "";
    if (!S.clientId) {
      b.append(h("div", { class: "empty" }, S.staff ? "Create your first client with New client, then post their first weekly report." : "Your account isn't linked to a company yet."));
      return;
    }
    const [latest, prev] = S.reports;
    $("hello-sub").textContent = latest ? weekLabel(latest.week_start) + ". Latest numbers from your team." : "Your first weekly report will appear here.";
    // Latest report
    const rep = h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h3", null, "This week"), latest ? h("button", { class: "btn small", type: "button", on: { click: () => openReport(latest) } }, "Full report") : null),
      latest ? kpiTiles(latest, prev) : h("p", { class: "help" }, "No report yet."),
      latest && latest.summary ? h("p", { class: "prose-plain" }, latest.summary) : null);
    // Pipeline snapshot
    const open = S.pipeline.filter((d) => !["Won", "Lost"].includes(d.stage));
    const won = S.pipeline.filter((d) => d.stage === "Won");
    const pipe = h("div", { class: "card tap", role: "button", tabindex: "0", on: { click: () => go("pipeline"), keydown: (e) => { if (e.key === "Enter") go("pipeline"); } } },
      h("div", { class: "card-head" }, h("h3", null, "Pipeline"), h("span", { class: "help" }, "Open →")),
      h("div", { class: "mini-stats" },
        h("div", null, h("b", { class: "num" }, String(open.length)), h("span", null, "open")),
        h("div", null, h("b", { class: "num" }, money(open.reduce((a, d) => a + (Number(d.value) || 0), 0))), h("span", null, "open value")),
        h("div", null, h("b", { class: "num" }, String(S.pipeline.filter((d) => d.stage === "Meeting booked").length)), h("span", null, "meetings booked")),
        h("div", null, h("b", { class: "num" }, String(won.length)), h("span", null, "won"))));
    // Updates
    const ups = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", null, "Latest updates"), S.updates.length ? h("button", { class: "btn small", type: "button", on: { click: () => go("updates") } }, "All updates") : null),
      S.updates.length ? S.updates.slice(0, 3).map(updateRow) : h("p", { class: "help" }, "Nothing new yet."));
    // Pilot + chat
    const active = S.pilots.find((p) => p.status !== "Closed");
    const pilot = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", null, "Pilot"), h("button", { class: "btn small", type: "button", on: { click: () => go("pilot") } }, active ? "View" : "Start one")),
      active ? [h("p", null, h("b", null, active.service), " · ", active.goal), steps(active.status)] : h("p", { class: "help" }, "Test a Vanguard team on one goal before committing."));
    const lastMsg = S.messages[S.messages.length - 1];
    const chat = h("div", { class: "card tap", role: "button", tabindex: "0", on: { click: () => go("chat"), keydown: (e) => { if (e.key === "Enter") go("chat"); } } },
      h("div", { class: "card-head" }, h("h3", null, "Ask your team"), h("span", { class: "help" }, "Open chat →")),
      lastMsg ? h("p", { class: "help" }, h("b", null, lastMsg.sender === S.me.user_id ? "You" : nameOf(lastMsg.sender)), ": ", lastMsg.body.slice(0, 140)) : h("p", { class: "help" }, "Questions about results, targeting or billing? Message us here."));
    b.append(rep, h("div", { class: "grid2" }, pipe, chat), ups, pilot);
  }

  /* ---------- reports ---------- */
  function renderReports() {
    const list = $("report-list"); list.textContent = "";
    if (!S.reports.length) { list.append(h("div", { class: "empty" }, S.staff ? "No reports yet. Post the first one with New weekly report." : "Your first weekly report will appear here.")); return; }
    S.reports.forEach((r, i) => {
      const m = r.metrics || {};
      list.append(h("button", { class: "rowlink report-row", type: "button", on: { click: () => openReport(r) } },
        h("div", null, h("div", { class: "t" }, weekLabel(r.week_start)), r.summary ? h("div", { class: "help clamp" }, r.summary) : null,
          i === 0 ? h("span", { class: "chip stage", style: "margin-top:8px" }, "Latest") : null),
        h("div", { class: "report-nums" },
          h("div", null, h("b", { class: "num" }, fmtNum(m.meetings)), h("span", null, "meetings")),
          h("div", null, h("b", { class: "num" }, fmtNum(m.opportunities)), h("span", null, "opps")))));
    });
  }
  function openReport(r) {
    const idx = S.reports.indexOf(r), prev = S.reports[idx + 1];
    const body = h("div", { class: "stack" }, kpiTiles(r, prev),
      r.summary ? h("div", { class: "block" }, h("div", { class: "k" }, "Summary"), h("div", { class: "prose" }, r.summary)) : null,
      r.highlights ? h("div", { class: "block" }, h("div", { class: "k" }, "Highlights"), h("div", { class: "prose" }, r.highlights)) : null,
      r.next_steps ? h("div", { class: "block" }, h("div", { class: "k" }, "Next week"), h("div", { class: "prose" }, r.next_steps)) : null,
      h("p", { class: "help" }, "Posted by " + nameOf(r.created_by) + " · " + day(r.updated_at)),
      S.staff ? h("div", { class: "actions" }, h("button", { class: "btn", type: "button", on: { click: () => reportForm(r) } }, "Edit"),
        h("button", { class: "btn bad", type: "button", on: { click: async () => { if (!confirm("Delete this report?")) return; try { await D.remove("vc_reports", r.id); closeSheet(); toast("Report deleted"); } catch (e) { fail(e); } } } }, "Delete")) : null);
    openSheet(clientName(r.client_id), weekLabel(r.week_start), body);
  }
  function reportForm(r) {
    const week = inp("date", r ? r.week_start : mondayOf(new Date()));
    const m = (r && r.metrics) || {};
    const nums = METRICS.map(([k, label]) => [k, inp("number", m[k] ?? "", { min: "0", inputmode: "numeric" }), label]);
    const summary = ta(r && r.summary, 3, "The headline: what happened this week and what it means.");
    const highlights = ta(r && r.highlights, 3, "Wins, notable conversations, what worked.");
    const next = ta(r && r.next_steps, 3, "Focus for next week, anything we need from the client.");
    openSheet(clientName(S.clientId), r ? "Edit report" : "New weekly report", sheetForm((g) => {
      g.append(field("Week starting (Monday)", week, { full: true }));
      nums.forEach(([, el, label]) => g.append(field(label, el)));
      g.append(field("Summary", summary, { full: true }), field("Highlights", highlights, { full: true }), field("Next week", next, { full: true }));
    }, async () => {
      if (!week.value) { toast("Pick the week"); return false; }
      const metrics = {}; nums.forEach(([k, el]) => { if (el.value !== "") metrics[k] = Number(el.value); });
      const row = { client_id: S.clientId, week_start: mondayOf(week.value), metrics, summary: summary.value.trim(), highlights: highlights.value.trim(), next_steps: next.value.trim() };
      if (r) await D.update("vc_reports", r.id, row); else await D.upsertReport(row);
      toast("Report saved. The client sees it now.");
    }, "Publish report"));
  }

  /* ---------- pipeline ---------- */
  function renderPipeline() {
    const strip = $("pipe-strip"); strip.textContent = "";
    for (const s of STAGES) { const n = S.pipeline.filter((d) => d.stage === s).length; strip.append(h("div", { class: n ? "" : "zero" }, h("div", { class: "n num" }, n), h("div", { class: "l" }, s))); }
    const fl = $("pipe-filters"); fl.textContent = "";
    for (const s of ["All", ...STAGES.filter((x) => S.pipeline.some((d) => d.stage === x))]) fl.append(h("button", { class: "pill", type: "button", "aria-pressed": String(S.stageFilter === s), on: { click: () => { S.stageFilter = s; renderPipeline(); } } }, s));
    const list = $("deal-list"); list.textContent = "";
    const shown = S.pipeline.filter((d) => S.stageFilter === "All" || d.stage === S.stageFilter)
      .sort((a, b) => STAGES.indexOf(b.stage === "Lost" ? "New" : b.stage) - STAGES.indexOf(a.stage === "Lost" ? "New" : a.stage) || (Number(b.value) || 0) - (Number(a.value) || 0));
    if (!shown.length) { list.append(h("div", { class: "empty" }, S.pipeline.length ? "Nothing in this stage." : S.staff ? "No opportunities yet. Add the first with Add opportunity." : "Opportunities appear here as your team books them.")); return; }
    for (const d of shown) {
      list.append(h(S.staff ? "button" : "div", { class: "deal deal-card", type: S.staff ? "button" : null, on: S.staff ? { click: () => dealForm(d) } : null },
        h("div", { style: "min-width:0" },
          h("div", { class: "t" }, d.company),
          d.contact ? h("div", { class: "d" }, d.contact) : null,
          h("div", { class: "meta" }, h("span", { class: "chip stage s-" + d.stage.replace(/\s/g, "") }, d.stage), d.next_step ? h("span", null, "Next: " + d.next_step) : null, h("span", null, "Updated " + timeAgo(d.updated_at)))),
        h("div", { class: "side" }, h("span", { class: "fs num" }, d.value != null ? money(d.value) : ""))));
    }
  }
  function dealForm(d) {
    const company = inp("text", d && d.company), contact = inp("text", d && d.contact, { placeholder: "Name, title" });
    const stage = sel(STAGES, d ? d.stage : "New"), value = inp("number", d && d.value, { min: "0", inputmode: "numeric", placeholder: "Estimated deal value" });
    const next = inp("text", d && d.next_step, { placeholder: "e.g. Discovery call Thu 3pm" }), notes = ta(d && d.notes, 3);
    const form = sheetForm((g) => {
      g.append(field("Company", company), field("Contact", contact), field("Stage", stage), field("Value (USD)", value), field("Next step", next, { full: true }), field("Notes (client can see)", notes, { full: true }));
    }, async () => {
      if (!company.value.trim()) { toast("Add the company"); return false; }
      const row = { company: company.value.trim(), contact: contact.value.trim(), stage: stage.value, value: value.value === "" ? null : Number(value.value), next_step: next.value.trim(), notes: notes.value.trim() };
      if (d) await D.update("vc_pipeline", d.id, row); else await D.insert("vc_pipeline", Object.assign({ client_id: S.clientId }, row));
      toast(d ? "Opportunity updated" : "Opportunity added");
    }, d ? "Save" : "Add opportunity");
    if (d) form.append(h("button", { class: "btn small bad", type: "button", style: "align-self:flex-start", on: { click: async () => { if (!confirm("Remove " + d.company + "?")) return; try { await D.remove("vc_pipeline", d.id); closeSheet(); toast("Removed"); } catch (e) { fail(e); } } } }, "Remove opportunity"));
    openSheet(clientName(S.clientId), d ? d.company : "Add opportunity", form);
  }

  /* ---------- updates ---------- */
  function updateRow(u) {
    return h("div", { class: "update" },
      h("div", { class: "meta", style: "margin-top:0" }, h("span", { class: "chip kind-" + u.kind.replace(/\s/g, "") }, u.kind), u.client_id ? null : h("span", { class: "chip" }, "All clients"), h("span", null, timeAgo(u.created_at))),
      h("div", { class: "t" }, u.title), u.body ? h("div", { class: "prose-plain" }, u.body) : null,
      S.staff ? h("button", { class: "linkbtn danger", type: "button", on: { click: async () => { if (!confirm("Delete this update?")) return; try { await D.remove("vc_updates", u.id); toast("Deleted"); } catch (e) { fail(e); } } } }, "Delete") : null);
  }
  function renderUpdates() {
    const list = $("update-list"); list.textContent = "";
    if (!S.updates.length) { list.append(h("div", { class: "empty" }, "No updates yet.")); return; }
    S.updates.forEach((u) => list.append(h("div", { class: "card" }, updateRow(u))));
  }
  function updateForm() {
    const title = inp("text", ""), kind = sel(KINDS, "Update"), body = ta("", 5), all = h("input", { type: "checkbox" });
    openSheet(clientName(S.clientId), "Post update", sheetForm((g) => {
      g.append(field("Title", title, { full: true }), field("Type", kind), h("label", { class: "check full" }, all, h("span", null, "Send to every client")), field("Details", body, { full: true }));
    }, async () => {
      if (!title.value.trim()) { toast("Add a title"); return false; }
      await D.insert("vc_updates", { client_id: all.checked ? null : S.clientId, title: title.value.trim(), kind: kind.value, body: body.value.trim() });
      toast("Update posted");
    }, "Post"));
  }

  /* ---------- pilot ---------- */
  function steps(status) {
    const at = PILOT_STEPS.indexOf(status);
    return h("ol", { class: "steps" }, PILOT_STEPS.map((s, i) => h("li", { class: i < at ? "done" : i === at ? "now" : "" }, s)));
  }
  function renderPilots() {
    const list = $("pilot-list"); list.textContent = "";
    $("pilot-new").hidden = !S.clientId;
    if (!S.pilots.length) {
      list.append(h("div", { class: "card pilot-pitch" },
        h("h3", null, "How a pilot works"),
        h("ol", { class: "how-steps" },
          h("li", null, h("b", null, "Tell us the goal. "), "For example: book 20 qualified meetings with fintech CFOs in the UAE."),
          h("li", null, h("b", null, "We scope it together. "), "Team size, targeting, messaging and how we'll measure it."),
          h("li", null, h("b", null, "We go live. "), "You follow results here and in your weekly reports."),
          h("li", null, h("b", null, "You decide. "), "Scale it, adjust it, or stop. No long commitment.")),
        h("button", { class: "btn primary", type: "button", style: "align-self:flex-start", on: { click: () => pilotForm() } }, "Start a pilot")));
      return;
    }
    for (const p of S.pilots) {
      const card = h("div", { class: "card stack" },
        h("div", { class: "card-head" }, h("h3", null, p.service), h("span", { class: "chip stage" }, p.status)),
        steps(p.status),
        h("p", null, p.goal),
        h("div", { class: "meta", style: "margin-top:0" }, p.audience ? h("span", null, "Audience: " + p.audience) : null, p.seats ? h("span", null, p.seats + (p.seats === 1 ? " rep" : " reps")) : null, p.start_date ? h("span", null, "Start " + day(p.start_date)) : null, h("span", null, "Requested " + day(p.created_at))),
        p.team_note ? h("div", { class: "note" }, h("b", null, "From your team: "), p.team_note) : null);
      if (S.staff) {
        const st = sel(PILOT_STEPS, p.status), note = ta(p.team_note, 2, "Next step or note for the client");
        card.append(h("div", { class: "partner-box" }, h("div", { class: "k" }, "Vanguard team"),
          h("div", { class: "grid" }, field("Status", st), field("Note to client", note, { full: true })),
          h("button", { class: "btn small primary", type: "button", style: "align-self:flex-start", on: { click: async () => { try { await D.update("vc_pilots", p.id, { status: st.value, team_note: note.value.trim() }); toast("Pilot updated"); } catch (e) { fail(e); } } } }, "Save")));
      }
      list.append(card);
    }
  }
  function pilotForm() {
    const service = sel(SERVICES, "SDR team"), goal = ta("", 3, "What should this pilot prove? e.g. 20 qualified meetings with fintech CFOs in 6 weeks.");
    const audience = inp("text", "", { placeholder: "Industry, titles, region" }), seats = inp("number", "", { min: "1", max: "50", inputmode: "numeric" }), start = inp("date", "");
    openSheet(clientName(S.clientId), "Start a pilot", sheetForm((g) => {
      g.append(field("Service", service), field("Team size (reps)", seats), field("Goal", goal, { full: true }), field("Target audience", audience, { full: true }), field("Preferred start", start));
    }, async () => {
      if (!goal.value.trim()) { toast("Describe the goal"); return false; }
      await D.insert("vc_pilots", { client_id: S.clientId, service: service.value, goal: goal.value.trim(), audience: audience.value.trim(), seats: seats.value ? Number(seats.value) : null, start_date: start.value || null });
      toast(S.staff ? "Pilot added" : "Pilot requested. Your team will reach out to scope it.");
    }, "Request pilot"));
  }

  /* ---------- chat ---------- */
  function renderChat(scroll) {
    const log = $("chat-log");
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.textContent = "";
    if (!S.clientId) { log.append(h("div", { class: "empty" }, "Pick a client to see their thread.")); return; }
    if (!S.messages.length) log.append(h("div", { class: "chat-empty" }, h("b", null, "Start the conversation"), h("span", null, S.staff ? "Messages here are visible to everyone at " + clientName(S.clientId) + " and your team." : "Ask about results, targeting, a report or anything else. Your account team gets it right away.")));
    let lastDay = "";
    for (const m of S.messages) {
      const d = new Date(m.created_at).toDateString();
      if (d !== lastDay) { lastDay = d; log.append(h("div", { class: "day-sep" }, day(m.created_at, { weekday: "short" }))); }
      const mine = m.sender === S.me.user_id, fromTeam = (D.people.team.get(m.sender) || {}).role === "staff";
      log.append(h("div", { class: "bubble " + (mine ? "me" : fromTeam ? "team" : "them") },
        mine ? null : h("div", { class: "from" }, nameOf(m.sender), fromTeam && !S.staff ? h("span", { class: "badge-team" }, "Vanguard") : null),
        h("div", { class: "text" }, m.body),
        h("div", { class: "when" }, new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))));
    }
    if (scroll || nearBottom) log.scrollTop = log.scrollHeight;
  }
  const chatInput = $("chat-input");
  chatInput.addEventListener("input", () => { chatInput.style.height = "auto"; chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px"; });
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(min-width:720px)").matches) { e.preventDefault(); $("chat-form").requestSubmit(); } });
  $("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = chatInput.value.trim(); if (!body || !S.clientId) return;
    $("chat-send").disabled = true;
    try {
      const m = await D.insert("vc_messages", { client_id: S.clientId, body });
      if (!S.messages.some((x) => x.id === m.id)) S.messages.push(m);
      chatInput.value = ""; chatInput.style.height = ""; renderChat(true);
    } catch (err) { fail(err); } finally { $("chat-send").disabled = false; }
  });

  /* ---------- team (staff) ---------- */
  function renderTeam() {
    const b = $("team-body"); b.textContent = "";
    if (!S.staff) return;
    const members = [...D.people.team.values()];
    const pending = members.filter((m) => m.role === "pending");
    $("team-count").textContent = pending.length ? String(pending.length) : "";
    const clients = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", null, "Clients"), h("button", { class: "btn small", type: "button", on: { click: addClient } }, "New client")),
      S.clients.length ? h("div", { class: "chips-list" }, S.clients.map((c) => h("button", { class: "pill", type: "button", "aria-pressed": String(c.id === S.clientId), on: { click: () => pickClient(c.id) } },
        c.name + " · " + members.filter((m) => m.client_id === c.id).length))) : h("p", { class: "help" }, "No clients yet."));
    const order = { pending: 0, client: 1, staff: 2 };
    members.sort((a, c) => order[a.role] - order[c.role] || (a.name || a.email).localeCompare(c.name || c.email));
    const tb = h("tbody");
    for (const m of members) {
      const isMe = m.user_id === S.me.user_id;
      const role = sel(["pending", "client", "staff"], m.role); role.disabled = isMe;
      const co = h("select", { "aria-label": "Company" }, h("option", { value: "" }, "Choose company…"), S.clients.map((c) => h("option", { value: c.id }, c.name)));
      co.value = m.client_id || ""; co.hidden = m.role !== "client"; co.disabled = isMe;
      const save = async () => {
        if (role.value === "client" && !co.value) { co.hidden = false; toast("Pick their company"); return; }
        try { await D.setMember(m.user_id, { role: role.value, client_id: role.value === "client" ? co.value : null }); toast((m.name || m.email) + " updated"); } catch (e) { fail(e); }
      };
      role.addEventListener("change", () => { co.hidden = role.value !== "client"; if (role.value !== "client" || co.value) save(); });
      co.addEventListener("change", save);
      tb.append(h("tr", null,
        h("td", null, (m.name || "—") + (isMe ? " (you)" : ""), h("div", { class: "help" }, m.email), m.role === "pending" ? h("span", { class: "chip Pending" }, "New sign-up") : null),
        h("td", { class: "role-cell" }, role, co),
        h("td", null, isMe ? null : h("button", { class: "btn small bad", type: "button", on: { click: async () => { if (!confirm("Remove " + (m.name || m.email) + "?")) return; try { await D.removeMember(m.user_id); toast("Removed"); } catch (e) { fail(e); } } } }, "Remove"))));
    }
    b.append(clients, h("div", { class: "access" }, h("h3", { style: "color:var(--ink)" }, "People"),
      h("p", { style: "margin:6px 0 0" }, "Set a new sign-up to Client and pick their company. Staff see every client and can post. Pending sees nothing."),
      h("div", { class: "table-scroll" }, h("table", null, tb))));
  }
  async function addClient() {
    const name = inp("text", "", { placeholder: "Company name" });
    openSheet("Vanguard team", "New client", sheetForm((g) => g.append(field("Company", name, { full: true })), async () => {
      if (!name.value.trim()) { toast("Add the company name"); return false; }
      const c = await D.insert("vc_clients", { name: name.value.trim() });
      await loadClients(); await pickClient(c.id); toast(c.name + " added");
    }, "Add client"));
  }
  async function pickClient(id) {
    S.clientId = id; try { localStorage.setItem("vc:client", id); } catch (e) {}
    S.stageFilter = "All"; S.unreadChat = 0;
    await loadClientData(); renderAll();
  }
  $("client-select").addEventListener("change", (e) => pickClient(e.target.value));
  $("client-add").addEventListener("click", addClient);
  $("report-new").addEventListener("click", () => reportForm(null));
  $("deal-new").addEventListener("click", () => dealForm(null));
  $("update-new").addEventListener("click", updateForm);
  $("pilot-new").addEventListener("click", () => pilotForm());

  /* ---------- navigation and counters ---------- */
  function go(tab) {
    S.tab = tab;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
    document.querySelectorAll("section.view").forEach((s) => (s.hidden = s.id !== "view-" + tab));
    document.body.classList.toggle("on-chat", tab === "chat");
    window.scrollTo(0, 0);
    if (tab === "chat") { S.unreadChat = 0; renderChat(true); }
    if (tab === "updates") { S.seenUpdates = S.updates.length; try { localStorage.setItem("vc:seen:" + S.clientId, String(S.updates.length)); } catch (e) {} }
    paintCounts(); updateCounter();
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => go(t.dataset.tab)));
  function paintCounts() {
    $("chat-count").textContent = S.unreadChat ? String(S.unreadChat) : "";
    let seen = S.seenUpdates; try { seen = Number(localStorage.getItem("vc:seen:" + S.clientId) || 0); } catch (e) {}
    const fresh = S.tab === "updates" ? 0 : Math.max(0, S.updates.length - seen);
    $("updates-count").textContent = fresh ? String(fresh) : "";
    $("deal-total").textContent = S.pipeline.length ? String(S.pipeline.length) : "";
  }
  let scRaf = 0, scLast = -1;
  function updateCounter() {
    cancelAnimationFrame(scRaf);
    scRaf = requestAnimationFrame(() => {
      const pill = $("scroll-count");
      if (S.tab !== "pipeline") { pill.hidden = true; return; }
      const items = [...document.querySelectorAll("#deal-list .deal-card")];
      if (!items.length) { pill.hidden = true; return; }
      const line = innerHeight * 0.6; let at = 0;
      for (const el of items) { if (el.getBoundingClientRect().top < line) at++; else break; }
      at = Math.max(1, at); pill.hidden = false;
      if (at !== scLast) { scLast = at; $("sc-at").textContent = String(at); pill.classList.remove("tick"); void pill.offsetWidth; pill.classList.add("tick"); }
      $("sc-total").textContent = String(items.length);
      $("sc-noun").textContent = items.length === 1 ? "opportunity" : "opportunities";
    });
  }
  addEventListener("scroll", updateCounter, { passive: true });
  addEventListener("resize", updateCounter);

  function renderAll() {
    paintHeader(); renderHome(); renderReports(); renderPipeline(); renderUpdates(); renderPilots(); renderChat(S.tab === "chat"); renderTeam(); paintCounts(); updateCounter();
  }

  /* ---------- live updates ---------- */
  const TABLE_KEY = { vc_reports: "reports", vc_pipeline: "pipeline", vc_updates: "updates", vc_pilots: "pilots" };
  let reloadT = {};
  function onChange(table, p) {
    const row = p.new && Object.keys(p.new).length ? p.new : p.old || {};
    if (table === "vc_messages") {
      if (row.client_id !== S.clientId) return;
      if (p.eventType === "INSERT" && !S.messages.some((m) => m.id === row.id)) {
        S.messages.push(row);
        if (S.tab !== "chat" && row.sender !== S.me.user_id) S.unreadChat++;
      } else if (p.eventType === "DELETE") S.messages = S.messages.filter((m) => m.id !== row.id);
      renderChat(); renderHome(); paintCounts(); return;
    }
    if (table === "vc_members" || table === "vc_clients") {
      clearTimeout(reloadT.people);
      reloadT.people = setTimeout(async () => {
        await D.loadMembers();
        const me = D.people.me;
        if (!me || me.role !== (S.staff ? "staff" : "client") || (!S.staff && me.client_id !== S.clientId)) { location.reload(); return; }
        await loadClients(); renderAll();
      }, 300);
      return;
    }
    const key = TABLE_KEY[table]; if (!key) return;
    if (row.client_id && row.client_id !== S.clientId) return;
    clearTimeout(reloadT[key]);
    reloadT[key] = setTimeout(async () => {
      const c = S.clientId; if (!c) return;
      const opts = { vc_reports: { client: c, order: "week_start" }, vc_pipeline: { client: c, order: "updated_at" }, vc_updates: { client: c, includeBroadcast: true, order: "created_at" }, vc_pilots: { client: c, order: "created_at" } }[table];
      S[key] = await D.list(table, opts);
      renderAll();
    }, 250);
  }

  /* ---------- boot (called by auth.js once signed in and linked) ---------- */
  async function connect() {
    await D.loadMembers();
    S.me = D.people.me; S.staff = S.me.role === "staff";
    await loadClients(); await loadClientData();
    try { S.seenUpdates = Number(localStorage.getItem("vc:seen:" + S.clientId) || 0); } catch (e) {}
    const hash = (location.hash || "").slice(1);
    renderAll();
    go(["home", "reports", "pipeline", "updates", "pilot", "chat", "team"].includes(hash) && (hash !== "team" || S.staff) ? hash : "home");
    D.watch(["vc_reports", "vc_pipeline", "vc_updates", "vc_pilots", "vc_messages", "vc_members", "vc_clients"], onChange);
  }
  window.AppConnect = connect;
})();
