/* In-browser port of backend/main.py for the static demo build.
   Same endpoints and rules as the FastAPI app; data lives in memory and is saved to
   localStorage so a demo survives a reload on the same device. */
(function () {
  const SEED = window.__SEED__;
  const KEY = "vanguard-crm-demo-v1";
  const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
  const OPEN_STAGES = STAGES.slice(0, 4);
  const STAGE_PROBABILITY = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
  const STATUSES = ["lead", "prospect", "active", "churned"];
  const NOTE_KINDS = ["note", "meeting", "call", "idea"];
  const ACTIVITY_TYPES = ["call", "email", "meeting", "linkedin", "sms", "note"];
  const TOUCH = new Set(["call", "email", "meeting", "linkedin", "sms"]);
  const PRIORITIES = ["high", "normal", "low"];
  const STALE_DAYS = 14;
  const TABLES = ["companies", "contacts", "deals", "notes", "tasks", "activities"];

  /* ------------------------------------------------------------ dates */
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = () => iso(new Date());
  const now = () => { const d = new Date(); return `${iso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  function normalizeTs(v) {
    v = (v || "").trim().replace("T", " ");
    if (!v) return now();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + " 12:00:00";
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return v + ":00";
    return v.slice(0, 19);
  }

  /* ------------------------------------------------------------ store */
  let db;
  function fresh() {
    // Shift every seeded date so the demo always looks current.
    const shift = daysBetween(SEED.base_date, today());
    const move = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? iso(addDays(parseDay(v), shift)) + v.slice(10) : v);
    const data = { seq: {} };
    for (const t of TABLES) {
      data[t] = SEED[t].map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, move(v)])));
      data.seq[t] = Math.max(0, ...data[t].map((r) => r.id));
    }
    return data;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
  }
  db = load();
  window.__resetDemo = () => { db = fresh(); save(); };

  class HttpError extends Error { constructor(status, detail) { super(detail); this.status = status; this.detail = detail; } }
  const bad = (detail) => { throw new HttpError(400, detail); };
  const byId = (t, id) => db[t].find((r) => r.id === Number(id));
  function one(t, id) {
    const r = byId(t, id);
    if (!r) throw new HttpError(404, `${t.slice(0, -1)} ${id} not found`);
    return r;
  }
  function insert(t, row) {
    const id = ++db.seq[t];
    const rec = { id, created_at: now(), ...row };
    db[t].push(rec);
    return rec;
  }
  function remove(t, id) {
    db[t] = db[t].filter((r) => r.id !== Number(id));
    // Mirror the SQLite foreign keys: cascade where the schema cascades, else SET NULL.
    const fk = { contacts: "contact_id", companies: "company_id", deals: "deal_id", notes: "note_id" }[t];
    if (!fk) return;
    const cascade = { activities: ["contact_id", "company_id", "deal_id", "note_id"], tasks: ["note_id"] };
    for (const other of TABLES) {
      if (other === t) continue;
      if ((cascade[other] || []).includes(fk)) db[other] = db[other].filter((r) => r[fk] !== Number(id));
      else db[other].forEach((r) => { if (r[fk] === Number(id)) r[fk] = null; });
    }
  }
  const lc = (s) => (s || "").toLowerCase();
  const like = (q, ...vals) => vals.some((v) => lc(v).includes(lc(q)));

  /* ------------------------------------------------------- note taker */
  const CHECKBOX = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s*(.+?)\s*$/;
  const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  function resolveDate(token) {
    const t = token.toLowerCase().replace(/[.,;]+$/, "");
    const d = new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t === "today" || t === "tod") return iso(d);
    if (["tomorrow", "tmr", "tmrw"].includes(t)) return iso(addDays(d, 1));
    const wd = (d.getDay() + 6) % 7;
    if (t === "nextweek" || t === "next-week") return iso(addDays(d, 7 - wd));
    const m = t.match(/^\+(\d+)([dw])$/);
    if (m) return iso(addDays(d, Number(m[1]) * (m[2] === "w" ? 7 : 1)));
    for (let i = 0; i < 7; i++) if (t.startsWith(WEEKDAYS[i])) return iso(addDays(d, (i - wd + 7) % 7 || 7));
    return "";
  }
  function parseTaskLine(text) {
    let due = "";
    text = text.replace(/(^|\s)(?:@|due:)(\S+)/gi, (all, sp, tok) => {
      const r = resolveDate(tok);
      if (r) { due = r; return " "; }
      return all;
    });
    let priority = "normal";
    text = text.replace(/(^|\s)!(high|urgent|low)\b/i, (all, sp, p) => { priority = p.toLowerCase() === "low" ? "low" : "high"; return " "; });
    return { text: text.split(/\s+/).filter(Boolean).join(" "), due_date: due, priority };
  }
  function extractTasks(body) {
    const out = [];
    for (const line of body.split("\n")) {
      const m = line.match(CHECKBOX);
      if (m) {
        const item = parseTaskLine(m[2]);
        if (item.text) out.push({ ...item, done: m[1].toLowerCase() === "x" });
      }
    }
    return out;
  }
  function setCheckbox(body, text, done) {
    return body.split("\n").map((line) => {
      const m = line.match(CHECKBOX);
      if (m && parseTaskLine(m[2]).text === text) {
        const i = line.indexOf("[") + 1;
        return line.slice(0, i) + (done ? "x" : " ") + line.slice(i + 1);
      }
      return line;
    }).join("\n");
  }

  const POSITIVE = ["great", "excited", "love", "agreed", "approved", "on track", "strong", "happy", "signed", "yes"];
  const NEGATIVE = ["concern", "worried", "unhappy", "churn", "cancel", "risk", "blocker", "delay", "no budget", "frustrat", "not interested", "competitor"];
  const RISK_WORDS = ["concern", "risk", "objection", "blocker", "worried", "competitor", "churn", "delay", "cheaper"];
  const DECISION_PREFIX = /^\s*(?:[-*]\s*)?(decisions?|decided|agreed|approved)\b/i;
  const DECISION_LABEL = /^(decisions?|decided)\s*[:\-]\s*/i;
  const ACTION_PREFIX = /^\s*(?:[-*]\s*)?(todo|action|ai|follow[- ]up|next step)\s*[:\-]\s*/i;
  const clean = (l) => l.replace(/^\s*(?:[-*\d.]+\s+)/, "").trim();
  const count = (hay, needle) => hay.split(needle).length - 1;
  function heuristicSummary(body) {
    const sections = [["", []]];
    for (const line of body.split("\n")) {
      const h = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
      if (h) sections.push([h[1].toLowerCase(), []]);
      else if (line.trim()) sections[sections.length - 1][1].push(line.trim());
    }
    const decisions = [], actions = [], risks = [], prose = [];
    for (const [heading, lines] of sections) {
      const roster = ["attendee", "agenda", "participants"].some((k) => heading.includes(k));
      for (const line of lines) {
        if (roster && !/[.!?]\s*(#\w+\s*)*$/.test(line)) continue;
        const cb = line.match(CHECKBOX);
        if (cb) {
          if (cb[1] === " ") {
            const item = parseTaskLine(cb[2]);
            if (item.text) actions.push({ text: item.text, owner: "", due_date: item.due_date });
          }
          continue;
        }
        if (heading.includes("decision") || DECISION_PREFIX.test(line)) {
          const t = clean(line).replace(DECISION_LABEL, "").trim();
          if (t) decisions.push(t);
          continue;
        }
        if (ACTION_PREFIX.test(line) || heading.includes("next step") || heading.includes("action")) {
          const t = clean(line).replace(ACTION_PREFIX, "").trim();
          if (t) actions.push({ text: t, owner: "", due_date: "" });
          continue;
        }
        const riskHeading = heading.includes("risk") || heading.includes("objection");
        if (riskHeading || RISK_WORDS.some((w) => lc(line).includes(w))) {
          risks.push(clean(line));
          if (riskHeading) continue;
        }
        if (!/:\s*$/.test(line) && !/^[-*]\s/.test(line)) prose.push(clean(line));
      }
    }
    const sentences = prose.join(" ").split(/(?<=[.!?])\s+/);
    const summary = sentences.slice(0, 3).filter(Boolean).join(" ").trim();
    const low = lc(body);
    const score = POSITIVE.reduce((a, w) => a + count(low, w), 0) - NEGATIVE.reduce((a, w) => a + count(low, w), 0);
    return {
      summary: summary || "No narrative content yet.",
      decisions: decisions.slice(0, 8),
      action_items: actions.slice(0, 12),
      risks: [...new Set(risks)].slice(0, 6),
      next_step: actions[0]?.text || "",
      sentiment: score > 0 ? "positive" : score < 0 ? "negative" : "neutral",
    };
  }
  function offlineRecap(title, contactName, sender, s) {
    const first = (contactName || "").split(" ")[0] || "there";
    const lines = [`Hi ${first},`, "", "Thanks for your time today. A quick recap of what we covered:", ""];
    if (s.summary) lines.push(s.summary, "");
    if (s.decisions?.length) lines.push("What we agreed:", ...s.decisions.map((d) => `- ${d}`), "");
    if (s.action_items?.length) {
      lines.push("Next steps:");
      for (const a of s.action_items) {
        const due = a.due_date ? " by " + parseDay(a.due_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "") : "";
        lines.push(`- ${a.text}${due}`);
      }
      lines.push("");
    }
    lines.push("Let me know if I missed anything.", "", "Best,", sender || "");
    return { subject: `Recap: ${title}`, body: lines.join("\n").trimEnd() + "\n" };
  }

  /* ---------------------------------------------------------- helpers */
  function touchContact(contactId, when) {
    const c = byId("contacts", contactId);
    if (c && (!c.last_contacted_at || c.last_contacted_at < when)) c.last_contacted_at = when;
  }
  function logActivity(type, subject, body = "", o = {}) {
    let { contact_id = null, company_id = null, deal_id = null, note_id = null, outcome = "", occurred_at = "" } = o;
    const when = normalizeTs(occurred_at);
    if (deal_id && !(contact_id && company_id)) {
      const d = byId("deals", deal_id);
      if (d) { contact_id = contact_id || d.contact_id; company_id = company_id || d.company_id; }
    }
    if (contact_id && !company_id) company_id = byId("contacts", contact_id)?.company_id ?? null;
    const a = insert("activities", { type, subject, body, outcome, contact_id, company_id, deal_id, note_id, occurred_at: when });
    if (TOUCH.has(type)) touchContact(contact_id, when);
    return a;
  }
  function findOrCreateCompany(name) {
    name = (name || "").trim();
    if (!name) return null;
    const c = db.companies.find((x) => lc(x.name) === lc(name));
    if (c) return c.id;
    return insert("companies", { name, domain: "", industry: "", size: "", location: "", owner: "", about: "", renewal_date: "", mrr: 0 }).id;
  }

  /* ------------------------------------------------------------ deals */
  function dealRow(d) {
    const c = byId("contacts", d.contact_id), co = byId("companies", d.company_id);
    const acts = db.activities.filter((a) => a.deal_id === d.id).map((a) => a.occurred_at);
    const notes = db.notes.filter((n) => n.deal_id === d.id).map((n) => n.updated_at);
    const last = [...acts, ...notes].sort().pop() || null;
    const prob = d.probability ?? STAGE_PROBABILITY[d.stage] ?? 0;
    const t = today();
    const since = daysBetween((d.stage_changed_at || d.created_at).slice(0, 10), t);
    const quiet = daysBetween((last || d.updated_at || d.created_at).slice(0, 10), t);
    const isOpen = OPEN_STAGES.includes(d.stage);
    return {
      ...d, contact_name: c?.name ?? null, company_name: co?.name ?? null, last_activity_at: last,
      probability: prob, weighted_value: Math.round((d.value || 0) * prob) / 100,
      days_in_stage: since, days_since_activity: quiet, is_open: isOpen,
      stale: isOpen && quiet >= STALE_DAYS, overdue_close: isOpen && !!d.close_date && d.close_date < t,
    };
  }
  const dealRows = (f = () => true) => db.deals.filter(f).map(dealRow).sort((a, b) => b.value - a.value);

  /* ----------------------------------------------------------- health */
  function healthSignals(key) {
    const sig = {};
    const get = (i) => (sig[i] ||= { last_touch: "", summary: null, overdue: 0, stale: [], open_deals: 0 });
    for (const a of db.activities) if (a[key] && TOUCH.has(a.type)) { const s = get(a[key]); if (a.occurred_at > s.last_touch) s.last_touch = a.occurred_at; }
    for (const n of db.notes) if (n[key] && (n.kind === "meeting" || n.kind === "call")) { const s = get(n[key]); const ts = normalizeTs(n.meeting_date || n.created_at); if (ts > s.last_touch) s.last_touch = ts; }
    for (const n of [...db.notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      if (n[key] && n.summary && get(n[key]).summary === null) { try { get(n[key]).summary = JSON.parse(n.summary); } catch {} }
    }
    const t = today();
    for (const k of db.tasks) if (k[key] && !k.done && k.due_date && k.due_date < t) get(k[key]).overdue++;
    for (const d of dealRows((d) => OPEN_STAGES.includes(d.stage))) if (d[key]) { const s = get(d[key]); s.open_deals++; if (d.stale) s.stale.push(d); }
    return sig;
  }
  function scoreHealth(sig, renewal = "", status = "", follow = "") {
    sig = sig || { last_touch: "", summary: null, overdue: 0, stale: [], open_deals: 0 };
    if (status === "churned") return { score: 0, label: "churned", reasons: [], actions: [] };
    let score = 100;
    const reasons = [], actions = [];
    const t = today();
    const days = sig.last_touch ? daysBetween(sig.last_touch.slice(0, 10), t) : null;
    if (days === null) { score -= 30; reasons.push("Never contacted"); actions.push("Make first contact"); }
    else if (days > 45) { score -= 40; reasons.push(`No touch in ${days} days`); actions.push("Re-engage: call or send a value-add email"); }
    else if (days > 30) { score -= 30; reasons.push(`No touch in ${days} days`); actions.push("Reach out this week"); }
    else if (days > 14) { score -= 15; reasons.push(`No touch in ${days} days`); }
    const s = sig.summary || {};
    if (s.sentiment === "negative") { score -= 25; reasons.push("Last conversation was negative"); actions.push("Schedule a check-in to address concerns"); }
    if (s.risks?.length) { score -= Math.min(20, 10 * s.risks.length); reasons.push(`Open risk: ${s.risks[0]}`); }
    if (sig.overdue) { score -= Math.min(20, 10 * sig.overdue); reasons.push(`${sig.overdue} overdue task${sig.overdue > 1 ? "s" : ""}`); actions.push("Clear overdue tasks — promises kept build trust"); }
    for (const d of sig.stale.slice(0, 2)) { score -= 15; reasons.push(`“${d.title}” quiet for ${d.days_since_activity} days`); actions.push(`Advance “${d.title}”` + (d.next_step ? `: ${d.next_step}` : "")); }
    if (renewal) {
      const until = daysBetween(t, renewal);
      if (until >= 0 && until <= 60) {
        if (days === null || days > 14) { score -= 20; reasons.push(`Renewal in ${until} days with no recent touch`); actions.push("Book a renewal conversation"); }
        else { reasons.push(`Renewal in ${until} days`); actions.push("Prep the renewal: results recap, scope and pricing"); }
      } else if (until < 0) { score -= 15; reasons.push(`Renewal date passed ${-until} days ago`); actions.push("Confirm renewal status"); }
    }
    if (follow) {
      if (follow < t) { const late = daysBetween(follow, t); score -= 10; reasons.push(`Follow-up overdue by ${late} day${late > 1 ? "s" : ""}`); actions.unshift("Follow up now — it's overdue"); }
      else if (follow === t) actions.unshift("Follow-up due today");
    } else if (["prospect", "active", "lead"].includes(status)) actions.push("Set a next follow-up date");
    score = Math.max(0, score);
    return { score, label: score >= 75 ? "healthy" : score >= 50 ? "watch" : "at-risk", reasons, actions: actions.slice(0, 4) };
  }

  /* ------------------------------------------------------ views/joins */
  function activityRow(a) {
    return { ...a, contact_name: byId("contacts", a.contact_id)?.name ?? null, company_name: byId("companies", a.company_id)?.name ?? null, deal_title: byId("deals", a.deal_id)?.title ?? null };
  }
  const sortActs = (list) => list.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id);
  function timeline(key, id) {
    id = Number(id);
    const inCompany = (cid) => byId("contacts", cid)?.company_id === id;
    const actMatch = key === "company_id" ? (a) => a.company_id === id || inCompany(a.contact_id) : (a) => a[key] === id;
    const items = sortActs(db.activities.filter(actMatch).map(activityRow)).slice(0, 200).map((a) => ({ ...a, entry: "activity" }));
    for (const n of db.notes.filter(key === "company_id" ? (n) => n.company_id === id || inCompany(n.contact_id) : (n) => n[key] === id)) {
      items.push({ id: n.id, title: n.title, kind: n.kind, body: n.body, summary: n.summary, contact_id: n.contact_id, contact_name: byId("contacts", n.contact_id)?.name ?? null, entry: "note", type: n.kind, subject: n.title, occurred_at: normalizeTs(n.meeting_date || n.created_at) });
    }
    return items.sort((a, b) => (b.occurred_at || "").localeCompare(a.occurred_at || ""));
  }
  const PRIO = { high: 0, normal: 1, low: 2 };
  function taskRows(f = () => true) {
    return db.tasks.filter(f).map((t) => ({ ...t, contact_name: byId("contacts", t.contact_id)?.name ?? null, note_title: byId("notes", t.note_id)?.title ?? null, deal_title: byId("deals", t.deal_id)?.title ?? null }))
      .sort((a, b) => a.done - b.done || (a.due_date === "") - (b.due_date === "") || (a.due_date || "").localeCompare(b.due_date || "") || PRIO[a.priority || "normal"] - PRIO[b.priority || "normal"] || b.id - a.id);
  }
  function contactRow(c, sig) {
    const deals = db.deals.filter((d) => d.contact_id === c.id);
    return {
      ...c,
      deal_count: deals.length,
      open_value: deals.filter((d) => OPEN_STAGES.includes(d.stage)).reduce((a, d) => a + d.value, 0),
      note_count: db.notes.filter((n) => n.contact_id === c.id).length,
      open_tasks: db.tasks.filter((t) => t.contact_id === c.id && !t.done).length,
      health: scoreHealth(sig[c.id], "", c.status, c.next_follow_up || ""),
    };
  }
  function noteRow(n) {
    return { ...n, contact_name: byId("contacts", n.contact_id)?.name ?? null, deal_title: byId("deals", n.deal_id)?.title ?? null, company_name: byId("companies", n.company_id)?.name ?? null };
  }
  function syncNoteTasks(n) {
    const parsed = extractTasks(n.body);
    const existing = new Map(db.tasks.filter((t) => t.note_id === n.id).map((t) => [t.text, t]));
    const seen = new Set();
    for (const item of parsed) {
      if (seen.has(item.text)) continue;
      seen.add(item.text);
      const row = existing.get(item.text);
      const links = { contact_id: n.contact_id, deal_id: n.deal_id, company_id: n.company_id };
      if (row) {
        Object.assign(row, links, {
          completed_at: item.done && row.done ? row.completed_at : item.done ? now() : "",
          done: item.done ? 1 : 0,
          due_date: item.due_date || row.due_date,
          priority: item.priority !== "normal" ? item.priority : row.priority || "normal",
        });
      } else {
        insert("tasks", { text: item.text, done: item.done ? 1 : 0, note_id: n.id, ...links, due_date: item.due_date, priority: item.priority, completed_at: item.done ? now() : "" });
      }
    }
    db.tasks = db.tasks.filter((t) => t.note_id !== n.id || seen.has(t.text));
  }
  function normalizeNote(d) {
    if (d.kind && !NOTE_KINDS.includes(d.kind)) bad(`kind must be one of ${NOTE_KINDS}`);
    if (d.deal_id && !d.contact_id) d.contact_id = byId("deals", d.deal_id)?.contact_id ?? null;
    if (d.contact_id && !d.company_id) d.company_id = byId("contacts", d.contact_id)?.company_id ?? null;
    d.pinned = d.pinned ? 1 : 0;
    return d;
  }
  function afterNoteSave(n) {
    syncNoteTasks(n);
    if ((n.kind === "meeting" || n.kind === "call") && n.contact_id) touchContact(n.contact_id, normalizeTs(n.meeting_date || n.created_at));
  }
  function resolveContactCompany(d) {
    if (d.company_id) {
      const co = byId("companies", d.company_id);
      if (!co) bad("company not found");
      d.company = co.name;
    } else d.company_id = findOrCreateCompany(d.company);
    return d;
  }
  function fillDealCompany(d) {
    if (d.contact_id && !d.company_id) {
      const c = byId("contacts", d.contact_id);
      if (!c) bad("contact not found");
      d.company_id = c.company_id;
    }
  }

  /* ------------------------------------------------------------- CSV */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  const ALIASES = {
    name: ["name", "full name", "contact", "contact name"], first: ["first name", "firstname", "first"], last: ["last name", "lastname", "last", "surname"],
    email: ["email", "email address", "work email", "e-mail"], phone: ["phone", "phone number", "mobile", "direct phone", "work direct phone", "corporate phone"],
    company: ["company", "company name", "account", "organization", "organisation"], title: ["title", "job title", "position", "role"],
    status: ["status", "lifecycle stage"], tags: ["tags", "labels", "lists"], linkedin: ["linkedin", "linkedin url", "person linkedin url", "linkedin profile"],
    source: ["source", "lead source"], owner: ["owner", "contact owner", "account owner"],
  };

  /* ------------------------------------------------------------ routes */
  const CONTACT_FIELDS = ["name", "email", "phone", "company", "company_id", "title", "status", "tags", "linkedin", "source", "owner", "next_follow_up", "about"];
  const COMPANY_FIELDS = ["name", "domain", "industry", "size", "location", "owner", "about", "renewal_date", "mrr"];
  const DEAL_FIELDS = ["title", "contact_id", "company_id", "value", "stage", "probability", "close_date", "owner", "next_step", "lost_reason"];
  const NOTE_FIELDS = ["title", "body", "kind", "contact_id", "deal_id", "company_id", "pinned", "meeting_date", "attendees", "duration_min"];
  const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));
  const checkStatus = (s) => s && !STATUSES.includes(s) && bad(`status must be one of ${STATUSES}`);
  const checkStage = (s) => s != null && !STAGES.includes(s) && bad(`stage must be one of ${STAGES}`);

  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

  on("GET", "/meta", () => {
    const owners = [...new Set([...db.contacts, ...db.deals, ...db.companies].map((r) => r.owner).filter(Boolean))].sort();
    const tags = [...new Set(db.contacts.flatMap((c) => (c.tags || "").split(",").map((t) => t.trim()).filter(Boolean)))].sort();
    return { stages: STAGES, stage_probability: STAGE_PROBABILITY, statuses: STATUSES, note_kinds: NOTE_KINDS, activity_types: ACTIVITY_TYPES, priorities: PRIORITIES, owners, tags, ai_enabled: false, ai_model: "", today: today() };
  });
  on("GET", "/templates", () => SEED.templates);

  // companies
  on("GET", "/companies", ({ q }) => {
    const sig = healthSignals("company_id");
    return db.companies.filter((c) => !q.get("q") || like(q.get("q"), c.name, c.domain, c.industry))
      .map((co) => {
        const deals = db.deals.filter((d) => d.company_id === co.id);
        const open = deals.filter((d) => OPEN_STAGES.includes(d.stage));
        return {
          ...co, contact_count: db.contacts.filter((c) => c.company_id === co.id).length, open_deals: open.length,
          open_value: open.reduce((a, d) => a + d.value, 0), won_value: deals.filter((d) => d.stage === "won").reduce((a, d) => a + d.value, 0),
          last_activity_at: db.activities.filter((a) => a.company_id === co.id).map((a) => a.occurred_at).sort().pop() || null,
          health: scoreHealth(sig[co.id], co.renewal_date || ""),
        };
      }).sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
  });
  on("POST", "/companies", ({ body }) => {
    if (!(body.name || "").trim()) bad("name is required");
    const data = Object.fromEntries(COMPANY_FIELDS.map((f) => [f, body[f] || (f === "mrr" ? 0 : "")]));
    return insert("companies", data);
  });
  const updateCompany = ({ p, body }) => {
    const co = one("companies", p.id);
    Object.assign(co, pick(body, COMPANY_FIELDS));
    db.contacts.forEach((c) => { if (c.company_id === co.id) c.company = co.name; });
    return co;
  };
  on("PATCH", "/companies/:id", updateCompany);
  on("PUT", "/companies/:id", updateCompany);
  on("DELETE", "/companies/:id", ({ p }) => { one("companies", p.id); remove("companies", p.id); return { ok: true }; });
  on("GET", "/companies/:id", ({ p }) => {
    const co = one("companies", p.id), id = co.id;
    return {
      ...co,
      contacts: db.contacts.filter((c) => c.company_id === id).sort((a, b) => lc(a.name).localeCompare(lc(b.name))),
      deals: dealRows((d) => d.company_id === id),
      tasks: taskRows((t) => t.company_id === id || byId("contacts", t.contact_id)?.company_id === id),
      timeline: timeline("company_id", id),
      health: scoreHealth(healthSignals("company_id")[id], co.renewal_date || ""),
    };
  });

  // contacts
  on("GET", "/contacts/duplicates", ({ q }) => {
    const email = (q.get("email") || "").trim(), name = (q.get("name") || "").trim(), ex = Number(q.get("exclude") || 0);
    if (!email && !name) return [];
    return db.contacts.filter((c) => c.id !== ex && ((email && c.email && lc(c.email) === lc(email)) || (name && lc(c.name) === lc(name))))
      .slice(0, 5).map(({ id, name, email, company }) => ({ id, name, email, company }));
  });
  on("GET", "/contacts", () => {
    const sig = healthSignals("contact_id");
    return db.contacts.map((c) => contactRow(c, sig)).sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
  });
  on("POST", "/contacts", ({ body }) => {
    if (!(body.name || "").trim()) bad("name is required");
    checkStatus(body.status);
    const d = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, f === "company_id" ? body[f] ?? null : body[f] ?? ""]));
    d.status = d.status || "lead";
    d.last_contacted_at = "";
    return insert("contacts", resolveContactCompany(d));
  });
  const updateContact = ({ p, body }) => {
    checkStatus(body.status);
    const c = one("contacts", p.id);
    const d = { ...c, ...pick(body, CONTACT_FIELDS) };
    if ("company" in body && !("company_id" in body)) d.company_id = null;
    Object.assign(c, resolveContactCompany(d));
    return c;
  };
  on("PATCH", "/contacts/:id", updateContact);
  on("PUT", "/contacts/:id", updateContact);
  on("DELETE", "/contacts/:id", ({ p }) => { one("contacts", p.id); remove("contacts", p.id); return { ok: true }; });
  on("POST", "/contacts/bulk", ({ body }) => {
    const actions = ["status", "owner", "add_tag", "remove_tag", "follow_up", "delete"];
    if (!actions.includes(body.action)) bad(`action must be one of ${actions}`);
    if (body.action === "status") checkStatus(body.value);
    const value = (body.value || "").trim();
    for (const id of body.ids) {
      const c = byId("contacts", id);
      if (!c) continue;
      if (body.action === "delete") remove("contacts", id);
      else if (body.action === "add_tag" || body.action === "remove_tag") {
        let tags = (c.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
        if (body.action === "add_tag" && value && !tags.includes(value)) tags.push(value);
        if (body.action === "remove_tag") tags = tags.filter((t) => t !== value);
        c.tags = tags.join(",");
      } else c[{ status: "status", owner: "owner", follow_up: "next_follow_up" }[body.action]] = value;
    }
    return { updated: body.ids.length };
  });
  on("POST", "/contacts/import", ({ body }) => {
    const rows = parseCsv(body.csv.replace(/^﻿/, ""));
    if (!rows.length) bad("CSV has no header row");
    const header = rows.shift().map((h) => lc(h.trim()));
    const col = Object.fromEntries(Object.entries(ALIASES).map(([k, al]) => [k, header.findIndex((h) => al.includes(h))]));
    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.length === 1 && !r[0]) continue;
      const get = (k) => (col[k] >= 0 ? (r[col[k]] || "").trim() : "");
      const name = get("name") || [get("first"), get("last")].filter(Boolean).join(" ");
      if (!name) { skipped++; continue; }
      const status = lc(get("status"));
      const d = resolveContactCompany({ name, email: get("email"), phone: get("phone"), company: get("company"), title: get("title"), status: STATUSES.includes(status) ? status : "lead", tags: get("tags"), linkedin: get("linkedin"), source: get("source") || "import", owner: get("owner"), next_follow_up: "", about: "", company_id: null });
      const existing = d.email && db.contacts.find((c) => c.email && lc(c.email) === lc(d.email));
      if (existing) { Object.entries(d).forEach(([k, v]) => { if (v !== "" && v != null) existing[k] = v; }); updated++; }
      else { insert("contacts", { ...d, last_contacted_at: "" }); created++; }
    }
    return { created, updated, skipped };
  });
  on("GET", "/contacts/:id", ({ p }) => {
    const c = one("contacts", p.id), id = c.id;
    const company = c.company_id ? byId("companies", c.company_id) : null;
    return {
      ...c, company_record: company,
      deals: dealRows((d) => d.contact_id === id),
      notes: db.notes.filter((n) => n.contact_id === id).sort((a, b) => b.pinned - a.pinned || b.updated_at.localeCompare(a.updated_at)),
      tasks: taskRows((t) => t.contact_id === id),
      timeline: timeline("contact_id", id),
      health: scoreHealth(healthSignals("contact_id")[id], company?.renewal_date || "", c.status, c.next_follow_up || ""),
    };
  });

  // deals
  const getDeal = (id) => dealRow(one("deals", id));
  on("GET", "/deals", () => dealRows());
  on("POST", "/deals", ({ body }) => {
    if (!(body.title || "").trim()) bad("title is required");
    checkStage(body.stage);
    const d = Object.fromEntries(DEAL_FIELDS.map((f) => [f, body[f] ?? null]));
    Object.assign(d, { stage: d.stage || "lead", value: d.value || 0, close_date: d.close_date || "", owner: d.owner || "", next_step: d.next_step || "", lost_reason: d.lost_reason || "" });
    fillDealCompany(d);
    const rec = insert("deals", { ...d, stage_changed_at: now(), updated_at: now() });
    logActivity("deal", `Deal created: ${d.title}`, "", { deal_id: rec.id, contact_id: d.contact_id, company_id: d.company_id });
    return getDeal(rec.id);
  });
  const updateDeal = ({ p, body }) => {
    checkStage(body.stage);
    const cur = one("deals", p.id);
    const d = { ...cur, ...pick(body, DEAL_FIELDS) };
    if ("contact_id" in body && !("company_id" in body)) d.company_id = null;
    fillDealCompany(d);
    if (d.stage !== "lost") d.lost_reason = "";
    const prevStage = cur.stage;
    Object.assign(cur, d, { updated_at: now() });
    if (cur.stage !== prevStage) {
      if (!("probability" in body)) cur.probability = null;
      cur.stage_changed_at = now();
      const detail = cur.stage === "lost" && cur.lost_reason ? ` — ${cur.lost_reason}` : "";
      logActivity("stage", `${prevStage} → ${cur.stage}${detail}`, "", { deal_id: cur.id });
      if (cur.stage === "won" && cur.contact_id) { const c = byId("contacts", cur.contact_id); if (c) c.status = "active"; }
    }
    return getDeal(cur.id);
  };
  on("PATCH", "/deals/:id", updateDeal);
  on("PUT", "/deals/:id", updateDeal);
  on("DELETE", "/deals/:id", ({ p }) => { one("deals", p.id); remove("deals", p.id); return { ok: true }; });
  on("GET", "/deals/:id", ({ p }) => {
    const d = getDeal(p.id);
    return { ...d, notes: db.notes.filter((n) => n.deal_id === d.id), tasks: taskRows((t) => t.deal_id === d.id), timeline: timeline("deal_id", d.id) };
  });

  // activities
  on("POST", "/activities", ({ body }) => {
    const type = body.type || "call";
    if (!ACTIVITY_TYPES.includes(type)) bad(`type must be one of ${ACTIVITY_TYPES}`);
    const a = activityRow(logActivity(type, body.subject || type[0].toUpperCase() + type.slice(1), body.body || "", body));
    if ((body.follow_up_text || "").trim()) {
      const item = parseTaskLine(body.follow_up_text);
      const due = body.follow_up_date || item.due_date;
      insert("tasks", { text: item.text, done: 0, note_id: null, contact_id: a.contact_id, deal_id: a.deal_id, company_id: a.company_id, due_date: due, priority: item.priority, completed_at: "" });
      if (a.contact_id && due) byId("contacts", a.contact_id).next_follow_up = due;
    }
    return a;
  });
  on("DELETE", "/activities/:id", ({ p }) => { one("activities", p.id); remove("activities", p.id); return { ok: true }; });

  // notes
  on("GET", "/notes", ({ q }) => {
    const text = q.get("q") || "", kind = q.get("kind") || "";
    return db.notes.map(noteRow)
      .filter((n) => (!text || like(text, n.title, n.body, n.attendees, n.contact_name, n.company_name)) && (!kind || n.kind === kind))
      .map((n) => ({ ...n, open_tasks: db.tasks.filter((t) => t.note_id === n.id && !t.done).length }))
      .sort((a, b) => b.pinned - a.pinned || b.updated_at.localeCompare(a.updated_at));
  });
  on("POST", "/notes", ({ body }) => {
    const tpl = body.template ? SEED.templates.find((t) => t.id === body.template) : null;
    if (body.template && !tpl) bad("unknown template");
    const d = normalizeNote({
      title: body.title || tpl?.name || "Untitled note",
      body: body.body ?? tpl?.body ?? "",
      kind: body.kind || tpl?.kind || "note",
      contact_id: body.contact_id ?? null, deal_id: body.deal_id ?? null, company_id: body.company_id ?? null,
      pinned: body.pinned, meeting_date: body.meeting_date || "", attendees: body.attendees || "", duration_min: body.duration_min || 0,
    });
    const n = insert("notes", { ...d, summary: "", updated_at: now() });
    afterNoteSave(n);
    return noteRow(n);
  });
  on("GET", "/notes/:id", ({ p }) => ({ ...noteRow(one("notes", p.id)), tasks: taskRows((t) => t.note_id === Number(p.id)) }));
  const updateNote = ({ p, body }) => {
    const n = one("notes", p.id);
    const d = { ...n, ...pick(body, NOTE_FIELDS) };
    if ("contact_id" in body && !("company_id" in body)) d.company_id = null;
    normalizeNote(d);
    d.title = d.title || "Untitled note";
    Object.assign(n, d, { updated_at: now() });
    afterNoteSave(n);
    return noteRow(n);
  };
  on("PATCH", "/notes/:id", updateNote);
  on("PUT", "/notes/:id", updateNote);
  on("DELETE", "/notes/:id", ({ p }) => { one("notes", p.id); remove("notes", p.id); return { ok: true }; });
  on("POST", "/notes/:id/summarize", ({ p }) => {
    const n = one("notes", p.id);
    if (!n.body.trim()) bad("note is empty");
    const result = { ...heuristicSummary(n.body), engine: "offline", generated_at: now() };
    n.summary = JSON.stringify(result);
    return result;
  });
  on("POST", "/notes/:id/recap", ({ p }) => {
    const n = one("notes", p.id);
    if (!n.body.trim()) bad("note is empty");
    const c = byId("contacts", n.contact_id) || {};
    const s = n.summary ? JSON.parse(n.summary) : heuristicSummary(n.body);
    return { ...offlineRecap(n.title, c.name || "", c.owner || "", s), engine: "offline", to: c.email || "", contact_id: n.contact_id, deal_id: n.deal_id };
  });
  on("POST", "/notes/:id/actions", ({ p, body }) => {
    const n = one("notes", p.id);
    const present = new Set(extractTasks(n.body).map((t) => t.text));
    const lines = [];
    for (const item of body.items) {
      const text = (item.text || "").split(/\s+/).filter(Boolean).join(" ");
      if (!text || present.has(text)) continue;
      present.add(text);
      const owner = item.owner ? ` (${item.owner})` : "";
      const due = /^\d{4}-\d{2}-\d{2}$/.test(item.due_date || "") ? ` @${item.due_date}` : "";
      lines.push(`[ ] ${text}${owner}${due}`);
    }
    if (lines.length) {
      const head = n.body.includes("## Action items") ? "\n" : "\n\n## Action items\n";
      n.body = n.body.trimEnd() + head + lines.join("\n") + "\n";
      n.updated_at = now();
    }
    afterNoteSave(n);
    return { added: lines.length, note: noteRow(n) };
  });

  // tasks
  on("GET", "/tasks", ({ q }) => {
    const done = q.get("done");
    return taskRows((t) => done == null || String(!!t.done) === done);
  });
  on("POST", "/tasks", ({ body }) => {
    if (body.priority && !PRIORITIES.includes(body.priority)) bad(`priority must be one of ${PRIORITIES}`);
    const item = parseTaskLine(body.text || "");
    if (!item.text) bad("text is required");
    const company = body.company_id || (body.contact_id ? byId("contacts", body.contact_id)?.company_id : null) || null;
    const t = insert("tasks", { text: item.text, done: body.done ? 1 : 0, note_id: body.note_id ?? null, contact_id: body.contact_id ?? null, deal_id: body.deal_id ?? null, company_id: company, due_date: body.due_date || item.due_date, priority: body.priority || item.priority, completed_at: body.done ? now() : "" });
    return taskRows((x) => x.id === t.id)[0];
  });
  on("PATCH", "/tasks/:id", ({ p, body }) => {
    if (body.priority && !PRIORITIES.includes(body.priority)) bad(`priority must be one of ${PRIORITIES}`);
    const t = one("tasks", p.id);
    if ("text" in body && t.note_id && body.text !== t.text) bad("edit this action item in its note");
    const prev = t.done;
    if ("done" in body) {
      const done = body.done ? 1 : 0;
      if (done !== prev) {
        t.completed_at = done ? now() : "";
        if (done && t.contact_id) logActivity("task", `Completed: ${t.text}`, "", { contact_id: t.contact_id, deal_id: t.deal_id });
      }
      t.done = done;
      if (t.note_id) { const n = byId("notes", t.note_id); if (n) n.body = setCheckbox(n.body, t.text, !!done); }
    }
    for (const k of ["text", "due_date", "priority", "contact_id", "deal_id"]) if (k in body) t[k] = body[k];
    return taskRows((x) => x.id === t.id)[0];
  });
  on("DELETE", "/tasks/:id", ({ p }) => {
    const t = one("tasks", p.id);
    if (t.note_id) {
      const n = byId("notes", t.note_id);
      if (n) n.body = n.body.split("\n").filter((l) => { const m = l.match(CHECKBOX); return !(m && parseTaskLine(m[2]).text === t.text); }).join("\n");
    }
    remove("tasks", p.id);
    return { ok: true };
  });

  // dashboard + search
  on("GET", "/stats", () => {
    const t = today(), month = t.slice(0, 7), weekAgo = iso(addDays(new Date(), -7));
    const deals = dealRows();
    const byStage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0, weighted: 0 }]));
    for (const d of deals) { const b = byStage[d.stage]; b.count++; b.value += d.value || 0; b.weighted += d.weighted_value; }
    const won = deals.filter((d) => d.stage === "won"), lost = deals.filter((d) => d.stage === "lost"), open = deals.filter((d) => d.is_open);
    const forecast = {};
    for (const d of open) {
      let k = (d.close_date || "").slice(0, 7) || "unscheduled";
      if (k !== "unscheduled" && k < month) k = "overdue";
      forecast[k] = (forecast[k] || 0) + d.weighted_value;
    }
    const act7 = {};
    for (const a of db.activities) if (TOUCH.has(a.type) && a.occurred_at >= weekAgo) act7[a.type] = (act7[a.type] || 0) + 1;
    act7.notes = db.notes.filter((n) => (n.kind === "meeting" || n.kind === "call") && n.created_at >= weekAgo).length;
    const sig = healthSignals("company_id");
    const accounts = db.companies.filter((co) => sig[co.id] || co.renewal_date).map(({ id, name, renewal_date, mrr, owner }) => ({ id, name, renewal_date, mrr, owner, health: scoreHealth(sig[id], renewal_date || "") }));
    const horizon = iso(addDays(new Date(), 90));
    const sum = (list, f) => list.reduce((a, d) => a + f(d), 0);
    return {
      at_risk: accounts.filter((a) => a.health.label === "at-risk" || a.health.label === "watch").sort((a, b) => a.health.score - b.health.score).slice(0, 6),
      renewals: accounts.filter((a) => a.renewal_date && a.renewal_date <= horizon).sort((a, b) => a.renewal_date.localeCompare(b.renewal_date)).slice(0, 6),
      activities_total: db.activities.filter((a) => TOUCH.has(a.type)).length,
      summaries: db.notes.filter((n) => n.summary).length,
      contacts: db.contacts.length, companies: db.companies.length, notes: db.notes.length,
      open_tasks: db.tasks.filter((x) => !x.done).length,
      overdue_tasks: db.tasks.filter((x) => !x.done && x.due_date && x.due_date < t).length,
      due_today: db.tasks.filter((x) => !x.done && x.due_date === t).length,
      open_pipeline: sum(open, (d) => d.value), weighted_pipeline: Math.round(sum(open, (d) => d.weighted_value) * 100) / 100,
      open_deals: open.length, won: sum(won, (d) => d.value),
      won_this_month: sum(won.filter((d) => (d.stage_changed_at || "").slice(0, 7) === month), (d) => d.value),
      win_rate: won.length + lost.length ? Math.round((100 * won.length) / (won.length + lost.length)) : null,
      avg_won: won.length ? Math.round(sum(won, (d) => d.value) / won.length) : 0,
      by_stage: byStage,
      forecast: Object.entries(forecast).sort(([a], [b]) => a.localeCompare(b)).map(([month, w]) => ({ month, weighted: Math.round(w * 100) / 100 })),
      stale_deals: open.filter((d) => d.stale).sort((a, b) => b.value - a.value).slice(0, 8),
      follow_ups: db.contacts.filter((c) => c.next_follow_up && c.next_follow_up <= t && c.status !== "churned").sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up)).slice(0, 12).map(({ id, name, company, next_follow_up, owner }) => ({ id, name, company, next_follow_up, owner })),
      agenda: taskRows((x) => !x.done && x.due_date && x.due_date <= t).slice(0, 15),
      activity_7d: act7,
      recent_activity: sortActs(db.activities.map(activityRow)).slice(0, 12),
    };
  });
  on("GET", "/search", ({ q }) => {
    const s = q.get("q") || "";
    return {
      contacts: db.contacts.filter((c) => like(s, c.name, c.company, c.email, c.phone, c.tags)).slice(0, 8).map(({ id, name, company, title }) => ({ id, name, company, title })),
      companies: db.companies.filter((c) => like(s, c.name, c.domain)).slice(0, 6).map(({ id, name, industry }) => ({ id, name, industry })),
      deals: db.deals.filter((d) => like(s, d.title, d.next_step)).slice(0, 8).map(({ id, title, value, stage }) => ({ id, title, value, stage })),
      notes: db.notes.filter((n) => like(s, n.title, n.body, n.attendees)).slice(0, 8).map((n) => {
        const i = lc(n.body).indexOf(lc(s));
        return { id: n.id, title: n.title, snippet: i >= 0 ? n.body.slice(Math.max(0, i - 30), i + 60).replace(/\n/g, " ") : "" };
      }),
      tasks: db.tasks.filter((t) => !t.done && like(s, t.text)).slice(0, 6).map(({ id, text, due_date, done }) => ({ id, text, due_date, done })),
    };
  });

  /* ------------------------------------------------------- fetch shim */
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api/")) return realFetch(input, init);
    const u = new URL(url, "https://demo.local");
    const path = u.pathname.slice(4);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    let status = 200, payload;
    try {
      const route = routes.find((r) => r.method === method && r.re.test(path));
      if (!route) throw new HttpError(404, "Not found");
      payload = route.fn({ p: path.match(route.re).groups || {}, q: u.searchParams, body });
      if (method !== "GET") save();
      payload = JSON.parse(JSON.stringify(payload));
    } catch (err) {
      status = err.status || 500;
      payload = { detail: err.detail || String(err.message || err) };
      if (!err.status) console.error(err);
    }
    await new Promise((r) => setTimeout(r, 40));
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
})();
