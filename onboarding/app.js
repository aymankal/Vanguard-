/* Vanguard Onboarding: intake → next steps with the guide → process atlas.
   Plain browser JavaScript, no build step. Progress is kept on this device until submitted. */
(function () {
  "use strict";

  const CFG = window.VG_CONFIG;
  const KB = window.VG_KB;
  const STORE = "vg-onboarding-v1";
  const SERVICES = Object.keys(KB.SERVICE_SETUP);

  /* ---------- Intake definition (the brochure's five answers, plus ICP and readiness) ---------- */
  const has = (d, svc) => Array.isArray(d.services) && d.services.includes(svc);
  const READINESS = [
    "Contract and scope signed",
    "Decision maker named and available for kickoff",
    "Technical contact named to grant system access",
    "One script approver named",
    "CRM / help desk access request started",
    "Pitch, objections and proof points ready to share",
    "Escalation contacts agreed on our side",
  ];

  const STEPS = [
    {
      id: "company", num: "00", title: "Your company", intro: "Who you are and what you're starting with.",
      fields: [
        { id: "company", label: "Company name", type: "text", required: true, half: true },
        { id: "website", label: "Website", type: "url", placeholder: "https://", half: true },
        { id: "contactName", label: "Your name", type: "text", required: true, half: true },
        { id: "contactRole", label: "Your role", type: "text", half: true },
        { id: "contactEmail", label: "Work email", type: "email", required: true, half: true },
        { id: "contactPhone", label: "Phone / WhatsApp", type: "tel", half: true },
        { id: "services", label: "Services you're starting with", type: "checks", options: SERVICES, required: true },
        { id: "teamSize", label: "Starting team size", type: "select", half: true,
          options: ["1 agent", "2–3 agents (most clients start here)", "4–6 agents", "7+ agents", "Not sure yet"] },
        { id: "startDate", label: "Target kickoff date (Day 1)", type: "date", half: true,
          help: "We map your 10-day path and reviews from this date." },
      ],
    },
    {
      id: "business", num: "01", title: "Business", intro: "What you sell, to whom, at what price.",
      fields: [
        { id: "offer", label: "What you sell", type: "textarea", required: true, placeholder: "Your product or service in two or three sentences." },
        { id: "price", label: "Price point / average deal size", type: "text", half: true, placeholder: "e.g. $12k per year, $49/seat/month" },
        { id: "salesCycle", label: "Typical sales cycle", type: "select", half: true,
          options: ["Under 2 weeks", "2–6 weeks", "1–3 months", "3–6 months", "6+ months", "Not applicable"] },
        { id: "competitors", label: "Your top three competitors", type: "textarea", rows: 2, placeholder: "One per line" },
      ],
    },
    {
      id: "icp", num: "ICP", title: "Ideal customer profile", intro: "Who we target. This becomes the filters for your list, and you approve them.",
      fields: [
        { id: "industries", label: "Target industries", type: "textarea", rows: 2, required: true, placeholder: "e.g. B2B SaaS, logistics, private clinics" },
        { id: "companySize", label: "Company size (employees)", type: "chips", required: true,
          options: ["1–10", "11–50", "51–200", "201–500", "501–1,000", "1,000–5,000", "5,000+"] },
        { id: "revenue", label: "Annual revenue", type: "chips", options: ["Under $1M", "$1–10M", "$10–50M", "$50–250M", "$250M+"] },
        { id: "buyerTitles", label: "Buyer roles and job titles", type: "textarea", rows: 2, required: true, placeholder: "e.g. Head of Sales, VP Operations, Clinic Owner" },
        { id: "seniority", label: "Seniority", type: "chips", options: ["Owner / Founder", "C-level", "VP", "Director", "Manager", "Individual contributor"] },
        { id: "regions", label: "Countries and regions", type: "chips", required: true,
          options: ["United States", "Canada", "United Kingdom", "European Union", "GCC", "Levant", "North Africa", "Other"] },
        { id: "regionsDetail", label: "Specific countries, states or cities", type: "text", placeholder: "Optional" },
        { id: "languages", label: "Languages", type: "chips", required: true,
          options: ["English", "Arabic", "French", "German", "Spanish", "Italian", "Other"] },
        { id: "triggers", label: "Buying signals", type: "textarea", rows: 2, placeholder: "Hiring sales reps, new funding, opening a branch, using a competitor…" },
        { id: "pains", label: "Main problems you solve for them", type: "textarea", rows: 2 },
        { id: "bestCustomers", label: "Three to five of your best customers", type: "textarea", rows: 2, placeholder: "Names or websites. We use them as lookalikes." },
        { id: "exclusions", label: "Who we must not contact", type: "textarea", rows: 2, placeholder: "Existing customers, partners, competitors, regions…" },
      ],
    },
    {
      id: "goal", num: "02", title: "Goal", intro: "The number that means success. We don't launch until it's written and agreed.",
      fields: [
        { id: "day30", label: "Success at day 30", type: "text", required: true, half: true, placeholder: "e.g. 12 qualified meetings" },
        { id: "day90", label: "Success at day 90", type: "text", required: true, half: true, placeholder: "e.g. 20 meetings a month, 70% show rate" },
        { id: "qualified", label: "Your written definition of a qualified result", type: "textarea", required: true,
          placeholder: "e.g. A meeting with a VP+ at a 50–500 person company in the US, who confirmed budget this year." },
        { id: "afterResult", label: "What happens after we deliver one, and who follows up", type: "textarea", rows: 2, required: true },
        { id: "kpiSdr", label: "Starting targets: meetings per week · show rate · cost per qualified meeting", type: "text",
          showIf: (d) => has(d, SERVICES[0]), placeholder: "Your best guess. We set them with you at kickoff." },
        { id: "kpiSupport", label: "Starting targets: first response time · resolution rate · satisfaction score", type: "text",
          showIf: (d) => has(d, SERVICES[1]), placeholder: "Your best guess. We set them with you at kickoff." },
        { id: "kpiCrm", label: "Starting targets: records cleaned · duplicate rate · field completion", type: "text",
          showIf: (d) => has(d, SERVICES[2]), placeholder: "Your best guess. We set them with you at kickoff." },
      ],
    },
    {
      id: "messaging", num: "03", title: "Messaging", intro: "What agents say, and what they must never say.",
      fields: [
        { id: "pitch", label: "Approved pitch", type: "textarea", placeholder: "Or paste a link to your deck or pitch doc." },
        { id: "objections", label: "Common objections, with your answers", type: "textarea" },
        { id: "proof", label: "Proof points", type: "textarea", rows: 2, placeholder: "Case studies, results, logos, reviews" },
        { id: "neverSay", label: "What agents must never say or promise", type: "textarea", rows: 2, required: true },
        { id: "tone", label: "Tone and brand rules", type: "textarea", rows: 2, placeholder: "Formal or casual, words to use or avoid, sign-off…" },
        { id: "materials", label: "Links to materials", type: "text", placeholder: "Drive / Notion / Dropbox links" },
      ],
    },
    {
      id: "systems", num: "04", title: "Systems", intro: "What we connect, and who grants access.",
      fields: [
        { id: "crm", label: "CRM or help desk", type: "select", half: true,
          options: ["HubSpot", "Salesforce", "Pipedrive", "Zoho", "Zendesk", "Freshdesk", "Intercom", "Other", "None yet"] },
        { id: "crmOther", label: "Other / details", type: "text", half: true, placeholder: "Plan, workspace name…" },
        { id: "calendar", label: "Calendar", type: "select", half: true, options: ["Google Calendar", "Outlook / Microsoft 365", "Calendly", "Other"] },
        { id: "emailDomain", label: "Email domain we send from", type: "text", half: true, placeholder: "e.g. yourcompany.com" },
        { id: "tools", label: "Call, ticket or other tools", type: "text", placeholder: "e.g. Aircall, Apollo, Slack, WhatsApp Business" },
        { id: "techName", label: "Technical contact (grants access)", type: "text", required: true, half: true },
        { id: "techEmail", label: "Technical contact email", type: "email", required: true, half: true },
      ],
    },
    {
      id: "people", num: "05", title: "People", intro: "Who decides, who we talk to daily, and who we escalate to.",
      fields: [
        { id: "dmName", label: "Decision maker", type: "text", required: true, half: true },
        { id: "dmEmail", label: "Decision maker email", type: "email", required: true, half: true },
        { id: "dailyName", label: "Day-to-day contact", type: "text", required: true, half: true },
        { id: "dailyEmail", label: "Day-to-day contact email", type: "email", required: true, half: true },
        { id: "escName", label: "Escalation contact", type: "text", required: true, half: true },
        { id: "escPhone", label: "Escalation phone or email", type: "text", required: true, half: true },
        { id: "approver", label: "Script approver (one person)", type: "text", required: true, half: true },
        { id: "channel", label: "Preferred channel for updates", type: "select", half: true,
          options: ["Email", "WhatsApp", "Slack", "Microsoft Teams", "Phone"] },
        { id: "hours", label: "Update hours and time zone", type: "text", placeholder: "e.g. 9:00–17:00 EST, Monday to Friday" },
      ],
    },
    {
      id: "checklist", num: "✓", title: "Readiness checklist", intro: "Tick what's already in place. Anything open becomes your to-do list on the next screen.",
      fields: [
        { id: "ready", label: "Already in place", type: "checks", options: READINESS },
        { id: "notes", label: "Anything else we should know", type: "textarea", rows: 3 },
        { id: "confirm", label: "I confirm these answers are accurate. Vanguard will send them back in writing for sign-off at kickoff.", type: "check", required: true },
      ],
    },
    { id: "review", num: "→", title: "Review and send", intro: "Check your answers. Edit any section, then send.", fields: [] },
  ];

  /* ---------- State ---------- */
  const blank = () => ({ stage: "intake", step: 0, data: {}, submittedAt: null, sent: false, chat: [], asked: [], qSent: false });
  let S;
  try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { S = blank(); }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} };

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $("#app");
  const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const first = () => String(S.data.contactName || "").trim().split(/\s+/)[0] || "";
  const visible = (f) => !f.showIf || f.showIf(S.data);
  const filled = (v) => (Array.isArray(v) ? v.length > 0 : v === true || (typeof v === "string" && v.trim() !== ""));
  const show = (v) => (Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : String(v ?? ""));

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("on"), 2600);
  }

  function dateOf(day) {
    if (!S.data.startDate || day == null || day < 1) return "";
    const d = new Date(S.data.startDate + "T12:00:00");
    if (isNaN(d)) return "";
    d.setDate(d.getDate() + day - 1);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  const openItems = () => READINESS.filter((r) => !(S.data.ready || []).includes(r));

  /* ---------- Top bar ---------- */
  const STAGES = [["intake", "1", "Intake"], ["next", "2", "Next steps"], ["atlas", "3", "Atlas"]];
  function renderStages() {
    const order = STAGES.map((s) => s[0]);
    const cur = order.indexOf(S.stage);
    const reach = S.submittedAt ? (S.stage === "atlas" || S.reachedAtlas ? 2 : 1) : 0;
    $("#stages").innerHTML = STAGES.map(([id, n, label], i) => {
      const state = i === cur ? "current" : i <= reach ? "done" : "locked";
      const locked = state === "locked" || (id === "intake" && S.submittedAt);
      return `<button class="stage ${state}" data-stage="${id}" ${locked ? "disabled" : ""} aria-current="${i === cur ? "step" : "false"}">
        <span class="n">${i < cur || (id === "intake" && S.submittedAt) ? "✓" : n}</span><span class="l">${label}</span></button>`;
    }).join('<span class="sep" aria-hidden="true"></span>');
    $$("#stages .stage").forEach((b) => b.addEventListener("click", () => go(b.dataset.stage)));
  }

  function go(stage) {
    stopSpeaking();
    S.stage = stage;
    if (stage === "atlas") S.reachedAtlas = true;
    save();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    app.focus({ preventScroll: true });
  }

  function render() {
    renderStages();
    if (S.stage === "intake") renderIntake();
    else if (S.stage === "next") renderNext();
    else renderAtlas();
  }

  /* ---------- Stage 1: intake ---------- */
  function fieldHtml(f) {
    const v = S.data[f.id];
    const req = f.required ? '<span class="req" aria-hidden="true">*</span>' : "";
    const help = f.help ? `<small class="help">${escHtml(f.help)}</small>` : "";
    const cls = `field ${f.half ? "half" : ""}`;
    const a = `id="f-${f.id}" name="${f.id}" ${f.required ? "required aria-required=\"true\"" : ""}`;
    const ph = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : "";
    switch (f.type) {
      case "textarea":
        return `<label class="${cls}"><span class="lab">${escHtml(f.label)}${req}</span><textarea ${a} ${ph} rows="${f.rows || 4}">${escHtml(v)}</textarea>${help}<em class="err"></em></label>`;
      case "select":
        return `<label class="${cls}"><span class="lab">${escHtml(f.label)}${req}</span><select ${a}><option value="">Choose…</option>${f.options
          .map((o) => `<option ${v === o ? "selected" : ""}>${escHtml(o)}</option>`).join("")}</select>${help}<em class="err"></em></label>`;
      case "chips":
      case "checks": {
        const vals = Array.isArray(v) ? v : [];
        return `<fieldset class="${cls} ${f.type}" id="f-${f.id}"><legend class="lab">${escHtml(f.label)}${req}</legend><div class="opts">${f.options
          .map((o) => `<label class="opt"><input type="checkbox" name="${f.id}" value="${escHtml(o)}" ${vals.includes(o) ? "checked" : ""}/><span>${escHtml(o)}</span></label>`)
          .join("")}</div>${help}<em class="err"></em></fieldset>`;
      }
      case "check":
        return `<label class="field confirm" id="f-${f.id}"><input type="checkbox" name="${f.id}" ${v ? "checked" : ""}/><span>${escHtml(f.label)}${req}</span><em class="err"></em></label>`;
      default:
        return `<label class="${cls}"><span class="lab">${escHtml(f.label)}${req}</span><input type="${f.type}" ${a} ${ph} value="${escHtml(v)}" ${
          f.type === "email" ? 'autocomplete="email"' : ""}/>${help}<em class="err"></em></label>`;
    }
  }

  function readStep(step) {
    for (const f of step.fields) {
      if (f.type === "chips" || f.type === "checks") {
        S.data[f.id] = $$(`input[name="${f.id}"]:checked`, app).map((i) => i.value);
      } else if (f.type === "check") {
        const el = $(`input[name="${f.id}"]`, app);
        if (el) S.data[f.id] = el.checked;
      } else {
        const el = $(`[name="${f.id}"]`, app);
        if (el) S.data[f.id] = el.value.trim();
      }
    }
    save();
  }

  function validate(step) {
    let firstBad = null;
    for (const f of step.fields) {
      if (!visible(f)) continue;
      const wrap = $(`#f-${f.id}`, app)?.closest(".field") || $(`#f-${f.id}`, app);
      if (!wrap) continue;
      const v = S.data[f.id];
      let msg = "";
      if (f.required && !filled(v)) msg = f.type === "chips" || f.type === "checks" ? "Pick at least one." : f.type === "check" ? "Please confirm." : "Required.";
      else if (f.type === "email" && filled(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = "Enter a valid email.";
      wrap.classList.toggle("bad", !!msg);
      const err = $(".err", wrap);
      if (err) err.textContent = msg;
      if (msg && !firstBad) firstBad = wrap;
    }
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = $("input,textarea,select", firstBad);
      input && input.focus({ preventScroll: true });
    }
    return !firstBad;
  }

  function stepDone(i) {
    return STEPS[i].fields.every((f) => !visible(f) || !f.required || filled(S.data[f.id]));
  }

  function renderIntake() {
    const i = Math.min(S.step, STEPS.length - 1);
    const step = STEPS[i];
    const pct = Math.round((i / (STEPS.length - 1)) * 100);
    app.innerHTML = `
      <section class="intake">
        <aside class="rail">
          ${i === 0 ? `<div class="hero-mini"><p class="eyebrow">Client onboarding · 2026</p><h1>Live in 10 days.</h1>
            <p>A fixed, tracked path from signed contract to a trained team on your account. It starts with these answers.</p></div>` : ""}
          <ol class="steps">${STEPS.map((s, j) => `<li><button class="${j === i ? "on" : ""} ${stepDone(j) && j < i ? "ok" : ""}" data-step="${j}">
            <span class="num">${s.num}</span><span>${s.title}</span></button></li>`).join("")}</ol>
          <p class="saved">Saved on this device as you type.</p>
        </aside>
        <div class="panel">
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <p class="eyebrow">${step.num === "→" || step.num === "✓" ? "Final step" : `Step ${i + 1} of ${STEPS.length}`}</p>
          <h2>${escHtml(step.title)}</h2>
          <p class="intro">${escHtml(step.intro)}</p>
          ${step.id === "review" ? reviewHtml() : `<form class="grid" novalidate>${step.fields.filter(visible).map(fieldHtml).join("")}</form>`}
          ${step.id === "goal" ? '<p class="callout"><b>Why we insist.</b> A vague goal is the most common reason onboarding stalls. We do not launch until the metrics are written and you have agreed to them.</p>' : ""}
          <div class="actions">
            ${i > 0 ? '<button class="btn ghost" id="back">Back</button>' : "<span></span>"}
            ${step.id === "review" ? '<button class="btn primary" id="send">Send to Vanguard</button>' : '<button class="btn primary" id="next">Continue</button>'}
          </div>
          <div id="sendState"></div>
        </div>
      </section>`;

    const form = $("form", app);
    if (form) {
      form.addEventListener("input", () => readStep(step));
      form.addEventListener("change", () => readStep(step));
      form.addEventListener("submit", (e) => e.preventDefault());
    }
    $$(".steps button", app).forEach((b) =>
      b.addEventListener("click", () => {
        if (form) readStep(step);
        const to = +b.dataset.step;
        // Jump back freely; jump forward only past completed steps.
        if (to > i && !STEPS.slice(0, to).every((_, j) => stepDone(j))) { validate(step); toast("Finish the required fields first."); return; }
        S.step = to; save(); renderIntake(); window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );
    $("#back", app)?.addEventListener("click", () => { if (form) readStep(step); S.step = i - 1; save(); renderIntake(); window.scrollTo({ top: 0 }); });
    $("#next", app)?.addEventListener("click", () => {
      readStep(step);
      if (!validate(step)) return;
      S.step = i + 1; save(); renderIntake(); window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $$("[data-edit]", app).forEach((b) => b.addEventListener("click", () => { S.step = +b.dataset.edit; save(); renderIntake(); window.scrollTo({ top: 0 }); }));
    $("#send", app)?.addEventListener("click", submit);
  }

  function reviewHtml() {
    return STEPS.slice(0, -1).map((s, j) => {
      const rows = s.fields.filter((f) => visible(f) && filled(S.data[f.id]) && f.type !== "check")
        .map((f) => `<div class="row"><dt>${escHtml(f.label)}</dt><dd>${escHtml(show(S.data[f.id]))}</dd></div>`).join("");
      const missing = !stepDone(j);
      return `<section class="review ${missing ? "missing" : ""}"><header><h3><span class="num">${s.num}</span>${escHtml(s.title)}</h3>
        <button class="btn link" data-edit="${j}">${missing ? "Complete" : "Edit"}</button></header>
        ${rows ? `<dl>${rows}</dl>` : '<p class="muted">Nothing entered.</p>'}</section>`;
    }).join("");
  }

  /* ---------- Sending ---------- */
  function payloadFields() {
    const out = {};
    for (const s of STEPS.slice(0, -1)) {
      for (const f of s.fields) {
        if (!visible(f) || !filled(S.data[f.id])) continue;
        out[`${s.num === "✓" ? "Checklist" : s.title} · ${f.label}`] = show(S.data[f.id]);
      }
    }
    const open = openItems();
    out["Checklist · Still open"] = open.length ? open.join(", ") : "Nothing. All ready.";
    return out;
  }

  function plainText(fields) {
    return Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  }

  async function post(subject, fields) {
    const body = Object.assign(
      { _subject: subject, _template: "table", _captcha: "false", email: S.data.contactEmail || "", name: S.data.contactName || "" },
      fields
    );
    const res = await fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || String(json.success) === "false") throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  }

  async function submit() {
    const bad = STEPS.slice(0, -1).findIndex((_, j) => !stepDone(j));
    if (bad !== -1) { S.step = bad; save(); renderIntake(); setTimeout(() => validate(STEPS[bad]), 50); toast("A few required answers are missing."); return; }
    const btn = $("#send", app);
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Sending…';
    const fields = payloadFields();
    const subject = `New client onboarding: ${S.data.company}`;
    try {
      await post(subject, fields);
      S.submittedAt = new Date().toISOString();
      S.sent = true;
      save();
      go("next");
      toast("Sent. Your Account Lead has it.");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Try again";
      const text = `${subject}\n\n${plainText(fields)}`;
      const mailto = `mailto:${CFG.recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.slice(0, 1800) + (text.length > 1800 ? "\n\n[Full copy attached as a file]" : ""))}`;
      $("#sendState", app).innerHTML = `<div class="fail"><b>We couldn't send it automatically.</b> <span class="muted">${escHtml(err.message)}</span>
        <p>Send it by email instead. Your answers are saved here, nothing is lost.</p>
        <div class="row-btns"><a class="btn primary" href="${mailto}" id="mailIt">Email my answers</a>
        <button class="btn ghost" id="dl">Download a copy</button>
        <button class="btn link" id="skip">I've sent it, continue</button></div></div>`;
      $("#dl", app).addEventListener("click", () => download(`${S.data.company || "intake"} - Vanguard onboarding.txt`, text));
      const proceed = () => { S.submittedAt = new Date().toISOString(); S.sent = false; save(); go("next"); };
      $("#skip", app).addEventListener("click", proceed);
      $("#mailIt", app).addEventListener("click", () => setTimeout(() => ($("#skip", app).textContent = "Sent it. Continue to next steps"), 800));
    }
  }

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name.replace(/[\\/:*?"<>|]/g, "-");
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- Stage 2: next steps + guide ---------- */
  const ctx = () => ({
    first: first(), company: S.data.company || "", services: S.data.services || [],
    dateOf, open: openItems(), contact: CFG,
  });

  function renderNext() {
    const svcs = (S.data.services || []).filter((s) => KB.SERVICE_SETUP[s]);
    const open = openItems();
    const days = KB.PROCESS.filter((p) => p.phase === "onboard" && p.id !== "intake" && p.id !== "gate");
    app.innerHTML = `
      <section class="next">
        <div class="next-main">
          <p class="eyebrow">Step 2 · Next steps</p>
          <h1>${S.sent ? "Received" : "Saved"}${first() ? `, ${escHtml(first())}` : ""}. Here's what happens next.</h1>
          <p class="lead">Your Account Lead reviews your answers and sends them back to you in writing to sign off. Nobody works from assumptions.</p>

          <ol class="timeline">
            <li class="done"><span class="dot">✓</span><div><b>Intake submitted</b><p>${new Date(S.submittedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p></div></li>
            <li class="now"><span class="dot"></span><div><b>Written sign-off</b><p>Your answers come back in writing. You correct anything, then sign.</p></div></li>
            ${days.map((d) => `<li><span class="dot"></span><div><b>${d.when}${dateOf(d.day) ? ` · ${dateOf(d.day)}` : ""}: ${d.title}</b><p>${escHtml(d.what.split(". ").slice(0, 2).join(". ").replace(/\.?$/, "."))}</p></div></li>`).join("")}
          </ol>

          <div class="cards">
            <article class="card ${open.length ? "warn" : "ok"}">
              <h3>${open.length ? "Your to-do before kickoff" : "You're ready for kickoff"}</h3>
              ${open.length ? `<ul class="todo">${open.map((o) => `<li>${escHtml(o)}</li>`).join("")}</ul>` : "<p>Every readiness item is in place. That's the fastest route to Day 10.</p>"}
            </article>
            ${svcs.map((s) => `<article class="card"><h3>What we build: ${escHtml(s)}</h3><ul>${KB.SERVICE_SETUP[s].build.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
              <p class="kpis">${KB.SERVICE_SETUP[s].kpis.map((k) => `<span>${escHtml(k)}</span>`).join("")}</p><small class="muted">Day 30 targets, set with you.</small></article>`).join("")}
          </div>
        </div>

        <aside class="guide" aria-label="Onboarding guide">
          <div class="guide-head">
            ${avatarSvg()}
            <div><b>Ava</b><span>Your onboarding guide</span></div>
            <button class="btn ghost small" id="voice" aria-pressed="${S.voice !== false}">${S.voice !== false ? "🔊 Voice on" : "🔈 Voice off"}</button>
          </div>
          <div class="chat" id="chat" aria-live="polite"></div>
          <div class="chips" id="chips"></div>
          <form class="ask" id="ask"><input id="q" placeholder="Ask about your onboarding…" autocomplete="off" aria-label="Your question"/><button class="btn primary" aria-label="Ask">Ask</button></form>
          <button class="btn done-q" id="noMore">No more questions → See how it all works</button>
        </aside>
      </section>`;

    const chat = $("#chat", app);
    if (!S.chat.length) {
      const hi = `Hi${first() ? ` ${first()}` : ""}, I'm Ava. Your intake is with the team. I can explain anything about the next 10 days: timing, what we need from you, reporting or the launch gate. What would you like to know?`;
      S.chat.push({ who: "ava", text: hi });
      save();
      paintChat(chat);
      setTimeout(() => speak(hi), 400);
    } else paintChat(chat);

    paintChips();
    $("#ask", app).addEventListener("submit", (e) => { e.preventDefault(); const q = $("#q", app); ask(q.value); q.value = ""; });
    $("#voice", app).addEventListener("click", (e) => {
      S.voice = S.voice === false; save();
      e.currentTarget.textContent = S.voice ? "🔊 Voice on" : "🔈 Voice off";
      e.currentTarget.setAttribute("aria-pressed", String(S.voice));
      if (!S.voice) stopSpeaking();
    });
    $("#noMore", app).addEventListener("click", () => { sendQuestions(); go("atlas"); });
  }

  function paintChat(chat) {
    chat.innerHTML = S.chat.map((m) => `<div class="msg ${m.who}">${escHtml(m.text)}</div>`).join("");
    chat.scrollTop = chat.scrollHeight;
  }

  function paintChips() {
    const askedIds = new Set(S.chat.filter((m) => m.who === "me").map((m) => m.text));
    $("#chips", app).innerHTML = KB.chips.filter((c) => !askedIds.has(c)).slice(0, 5)
      .map((c) => `<button type="button" class="chip">${escHtml(c)}</button>`).join("");
    $$("#chips .chip", app).forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
  }

  function ask(q) {
    q = String(q || "").trim();
    if (!q) return;
    const chat = $("#chat", app);
    S.chat.push({ who: "me", text: q });
    const r = KB.answer(q, ctx());
    S.asked.push({ q, answered: !r.escalate, at: new Date().toISOString() });
    paintChat(chat);
    const typing = document.createElement("div");
    typing.className = "msg ava typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    chat.appendChild(typing);
    chat.scrollTop = chat.scrollHeight;
    setTimeout(() => {
      S.chat.push({ who: "ava", text: r.text });
      S.qSent = false;
      save();
      paintChat(chat);
      paintChips();
      speak(r.text);
    }, 550);
  }

  // Questions the client asked go to the team, flagged where the guide couldn't answer.
  function sendQuestions() {
    if (!S.asked.length || S.qSent) return;
    const fields = {};
    S.asked.forEach((a, i) => { fields[`Question ${i + 1}${a.answered ? "" : " (needs Account Lead)"}`] = a.q; });
    fields["Client"] = `${S.data.contactName || ""} · ${S.data.company || ""} · ${S.data.contactEmail || ""}`;
    post(`Onboarding questions: ${S.data.company || "client"}`, fields).then(() => { S.qSent = true; save(); }).catch(() => {});
  }

  /* ---------- Avatar voice ---------- */
  let voice = null;
  function pickVoice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    voice = vs.find((v) => /en[-_]/i.test(v.lang) && /female|samantha|google uk english female|aria|jenny|zira|serena/i.test(v.name))
      || vs.find((v) => /en[-_]GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function talking(on) { $$(".avatar").forEach((a) => a.classList.toggle("talking", on)); }
  function speak(text) {
    if (S.voice === false || !window.speechSynthesis) { talking(true); setTimeout(() => talking(false), Math.min(4000, text.length * 25)); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.03;
    u.onstart = () => talking(true);
    u.onend = u.onerror = () => talking(false);
    speechSynthesis.speak(u);
  }
  function stopSpeaking() { if (window.speechSynthesis) speechSynthesis.cancel(); talking(false); }

  function avatarSvg() {
    return `<svg class="avatar" viewBox="0 0 120 120" role="img" aria-label="Ava, onboarding guide">
      <defs><linearGradient id="avBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b7cff"/><stop offset="1" stop-color="#1fd59a"/></linearGradient></defs>
      <circle cx="60" cy="60" r="58" fill="url(#avBg)"/>
      <path d="M22 116c4-22 20-32 38-32s34 10 38 32" fill="#0f1b33"/>
      <path d="M50 82h20v10a10 10 0 0 1-20 0z" fill="#f0c5a3"/>
      <path d="M33 54c0-20 12-32 27-32s27 12 27 32c0 6-1 12-3 16H36c-2-4-3-10-3-16z" fill="#2a1c17"/>
      <ellipse cx="60" cy="58" rx="21" ry="25" fill="#f6d2b4"/>
      <path d="M38 50c4-14 14-20 24-20 9 0 18 6 21 18-9-6-20-7-28-12-4 6-10 11-17 14z" fill="#2a1c17"/>
      <g class="eyes"><ellipse cx="51" cy="58" rx="2.6" ry="3.2" fill="#1b1b2f"/><ellipse cx="69" cy="58" rx="2.6" ry="3.2" fill="#1b1b2f"/></g>
      <path d="M46 51q5-3 9 0M65 51q5-3 9 0" stroke="#2a1c17" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <ellipse class="mouth" cx="60" cy="72" rx="5" ry="1.6" fill="#b4505a"/>
      <circle cx="47" cy="66" r="3" fill="#f3a9a0" opacity=".45"/><circle cx="73" cy="66" r="3" fill="#f3a9a0" opacity=".45"/>
      <path d="M44 100l16 8 16-8" stroke="#1fd59a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /* ---------- Stage 3: atlas ---------- */
  const PHASES = [
    ["onboard", "Onboard", "Signed contract to live: one tracked path, one named owner, a checkpoint at every step."],
    ["run", "Run", "A rhythm you can set your watch to."],
    ["grow", "Grow", "Reviewed against your numbers, then every quarter."],
  ];

  function renderAtlas() {
    const svcs = (S.data.services || []).filter((s) => KB.SERVICE_SETUP[s]);
    app.innerHTML = `
      <section class="atlas">
        <header class="atlas-head">
          <div><p class="eyebrow">Step 3 · Atlas</p><h1>How your onboarding runs</h1>
          <p class="lead">Every client follows the same tracked path. Tap any stop to see what happens, who owns it and what we need from you.</p></div>
          <div class="legend">${KB.ROLES.map((r) => `<span class="role r-${r.name.split(" ")[0].toLowerCase()}">${r.name}</span>`).join("")}</div>
        </header>

        <div class="map" role="list">
          ${PHASES.map(([id, name, sub]) => `
            <div class="phase p-${id}">
              <div class="phase-label"><b>${name}</b><span>${sub}</span></div>
              <div class="line">${KB.PROCESS.filter((p) => p.phase === id).map((p) => `
                <button class="stop ${p.id === "intake" && S.submittedAt ? "passed" : ""} ${p.id === "scope" && S.submittedAt ? "next-up" : ""} ${p.id === "gate" ? "gate" : ""}" data-id="${p.id}" role="listitem">
                  <span class="pin">${p.id === "intake" && S.submittedAt ? "✓" : p.id === "gate" ? "8" : ""}</span>
                  <span class="when">${escHtml(p.when)}</span>
                  <span class="title">${escHtml(p.title)}</span>
                  ${dateOf(p.day) ? `<span class="date">${dateOf(p.day)}</span>` : ""}
                  ${p.id === "intake" && S.submittedAt ? '<span class="here">You are here</span>' : ""}
                </button>`).join("")}
              </div>
            </div>`).join("")}
        </div>

        <article class="detail" id="detail" aria-live="polite"></article>

        <div class="atlas-grid">
          <section class="box"><h3>One team, one set of numbers</h3>
            ${KB.ROLES.map((r) => `<div class="role-row"><span class="role r-${r.name.split(" ")[0].toLowerCase()}">${r.name}</span><p>${escHtml(r.text)}</p></div>`).join("")}</section>
          <section class="box"><h3>Same path, your setup</h3>
            ${(svcs.length ? svcs : SERVICES).map((s) => `<details ${svcs.length ? "open" : ""}><summary>${escHtml(s)}</summary><ul>${KB.SERVICE_SETUP[s].build.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
              <p class="kpis">${KB.SERVICE_SETUP[s].kpis.map((k) => `<span>${escHtml(k)}</span>`).join("")}</p></details>`).join("")}</section>
          <section class="box wide"><h3>We fix what usually breaks</h3><div class="guards">
            ${KB.GUARDRAILS.map((g, i) => `<div class="guard"><span class="gnum">0${i + 1}</span><b>${escHtml(g.problem)}</b><p>${escHtml(g.fix)}</p></div>`).join("")}</div></section>
        </div>

        <section class="cta">
          <div><h2>Questions later?</h2><p>Your Account Lead is your direct line from kickoff. Until then:</p></div>
          <div class="row-btns">
            ${CFG.bookingUrl ? `<a class="btn primary" href="${escHtml(CFG.bookingUrl)}" target="_blank" rel="noopener">Book a call</a>` : ""}
            <a class="btn ${CFG.bookingUrl ? "ghost" : "primary"}" href="mailto:${escHtml(CFG.infoEmail)}">${escHtml(CFG.infoEmail)}</a>
            <a class="btn ghost" href="tel:${escHtml(CFG.phone.replace(/\s/g, ""))}">${escHtml(CFG.phone)}</a>
            <button class="btn link" id="backGuide">Ask Ava something</button>
          </div>
        </section>
        <p class="reset"><button class="btn link" id="reset">Start a new intake on this device</button></p>
      </section>`;

    const select = (id) => {
      const p = KB.PROCESS.find((x) => x.id === id);
      $$(".stop", app).forEach((b) => b.classList.toggle("sel", b.dataset.id === id));
      $("#detail", app).innerHTML = `
        <div class="d-head"><span class="when">${escHtml(p.when)}${dateOf(p.day) ? ` · ${dateOf(p.day)}` : ""}</span><h2>${escHtml(p.title)}</h2>
          <div class="owners">${p.owner.map((o) => `<span class="role r-${o.split(" ")[0].toLowerCase()}">${o}</span>`).join("")}</div></div>
        <p>${escHtml(p.what)}</p>
        ${p.gate ? `<ol class="gate-list">${p.gate.map((g) => `<li>${escHtml(g)}</li>`).join("")}</ol>` : ""}
        <p class="you"><b>Your part:</b> ${escHtml(p.you)}</p>`;
    };
    $$(".stop", app).forEach((b) => b.addEventListener("click", () => {
      select(b.dataset.id);
      if (matchMedia("(max-width: 860px)").matches) $("#detail", app).scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    select(S.submittedAt ? "scope" : "intake");
    $("#backGuide", app).addEventListener("click", () => go("next"));
    $("#reset", app).addEventListener("click", () => {
      if (!confirm("Clear this device's answers and start a new intake?")) return;
      const voicePref = S.voice;
      S = blank(); S.voice = voicePref; save(); go("intake");
    });
  }

  /* ---------- Install (Chrome) ---------- */
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#installBtn").hidden = false; });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    $("#installBtn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; toast("Installed. Find Vanguard on your home screen or app list."); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

  $("#footContact").innerHTML = `<a href="mailto:${escHtml(CFG.infoEmail)}">${escHtml(CFG.infoEmail)}</a> · <a href="tel:${escHtml(CFG.phone.replace(/\s/g, ""))}">${escHtml(CFG.phone)}</a>`;
  render();
})();
