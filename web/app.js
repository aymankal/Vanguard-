/* Vanguard Services CRM — dependency-free SPA with hash routing. */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("vcrm:" + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("vcrm:" + key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  meta: null,
  stats: null,
  contacts: [],
  companies: [],
  deals: [],
  templates: [],
  notesFilter: store.get("notesFilter", { q: "", kind: "" }),
  contactFilter: store.get("contactFilter", { q: "", status: "", owner: "", tag: "", sort: "name", dir: 1 }),
  pipelineOwner: store.get("pipelineOwner", ""),
  hideClosed: store.get("hideClosed", false),
  selected: new Set(),
  route: { view: "dashboard", id: null },
};
const persistFilters = () => {
  store.set("notesFilter", state.notesFilter);
  store.set("contactFilter", state.contactFilter);
  store.set("pipelineOwner", state.pipelineOwner);
  store.set("hideClosed", state.hideClosed);
};

/* ------------------------------------------------------------ helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "style" && typeof v === "string") node.style.cssText = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
};
const money = (n) => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const kmoney = (n) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : money(n));
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const localDay = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

function relTime(s) {
  if (!s) return "never";
  const d = localDay(s);
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 0 && days < 30) return `${days}d ago`;
  if (days < 0 && days > -30) return `in ${-days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 300 || days < -300 ? "numeric" : undefined });
}
const fmtDate = (s) => (s ? new Date(s.slice(0, 10) + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const daysSince = (s) => (s ? Math.round((new Date(todayIso()) - new Date(s.slice(0, 10))) / 86400000) : Infinity);

let inflight = 0;
function loading(delta) {
  inflight = Math.max(0, inflight + delta);
  document.body.classList.toggle("is-loading", inflight > 0);
}

async function api(path, options = {}) {
  loading(1);
  try {
    return await request(path, options);
  } finally {
    loading(-1);
  }
}

async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && !window.__SEED__) {
    // Session expired or signed out elsewhere: go to sign-in and come back to this page.
    location.href = "/login" + (location.hash.startsWith("#/") ? location.hash : "");
    throw new Error("Sign in required");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    toast(msg, "error");
    throw new Error(msg);
  }
  return res.json();
}

function toast(message, kind = "ok", { action, duration } = {}) {
  const ms = duration || (action ? 6000 : 2800);
  const t = el("div", { className: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, [el("span", { textContent: message })]);
  if (action) {
    t.append(
      el("button", {
        className: "toast-action",
        textContent: action.label,
        onclick: () => {
          t.remove();
          action.fn();
        },
      })
    );
  }
  $("#toasts").append(t);
  setTimeout(() => t.classList.add("out"), ms - 300);
  setTimeout(() => t.remove(), ms);
  return t;
}

/* Delete with an Undo window instead of a blocking confirm(): the row disappears at once and
   the API call only fires if the user does not undo within a few seconds. */
function deferredDelete(label, node, doDelete, after) {
  let undone = false;
  node?.classList.add("removing");
  const timer = setTimeout(async () => {
    if (undone) return;
    await doDelete();
    after?.();
  }, 5500);
  toast(`${label} deleted`, "ok", {
    duration: 5500,
    action: {
      label: "Undo",
      fn: () => {
        undone = true;
        clearTimeout(timer);
        node?.classList.remove("removing");
      },
    },
  });
}

function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = el("div", { className: "confetti", "aria-hidden": "true" });
  const colors = ["#6c8cff", "#37d39b", "#ffb057", "#ff6b6b", "#c792ea"];
  for (let i = 0; i < 60; i++) {
    layer.append(
      el("i", {
        style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.4}s;animation-duration:${1.4 + Math.random()}s;transform:rotate(${Math.random() * 360}deg)`,
      })
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2800);
}

/* Theme: system by default, user choice persisted. */
function applyTheme(theme) {
  // Only clear a theme this app set, so a host page's own data-theme is respected.
  const root = document.documentElement;
  if (theme === "system") {
    if (root.dataset.appTheme) {
      delete root.dataset.theme;
      delete root.dataset.appTheme;
    }
  } else {
    root.dataset.theme = theme;
    root.dataset.appTheme = "1";
  }
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = { system: "◐ System", light: "☀ Light", dark: "☾ Dark" }[theme];
}
applyTheme(store.get("theme", "system"));

async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed — select and copy manually", "error");
  }
}

/* Click-to-edit value used on detail pages. */
function editable(value, onSave, { type = "text", options, display, placeholder = "Add…", list } = {}) {
  const wrap = el("span", { className: "editable", tabIndex: 0, role: "button", title: "Click to edit" });
  const show = () => {
    wrap.innerHTML = "";
    const shown = display ? display(value) : value;
    if (shown == null || shown === "") wrap.append(el("span", { className: "placeholder", textContent: placeholder }));
    else wrap.append(...[].concat(shown).map((x) => (x?.nodeType ? x : document.createTextNode(String(x)))));
  };
  const edit = () => {
    if (wrap.querySelector("input, select, textarea")) return;
    let input;
    if (options) {
      input = el("select", {}, options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return el("option", { value: v, textContent: l, selected: String(v) === String(value ?? "") });
      }));
    } else if (type === "textarea") {
      input = el("textarea", { value: value ?? "", rows: 3 });
    } else {
      input = el("input", { type, value: value ?? "" });
      if (list) input.setAttribute("list", list);
    }
    let done = false;
    const commit = async (save) => {
      if (done) return;
      done = true;
      const next = input.value;
      if (save && String(next) !== String(value ?? "")) {
        try {
          await onSave(next);
          value = next;
        } catch {}
      }
      show();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter" && type !== "textarea") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.stopPropagation(); commit(false); }
    };
    input.onblur = () => commit(true);
    if (options || type === "date") input.onchange = () => commit(true);
    wrap.innerHTML = "";
    wrap.append(input);
    input.focus();
    input.select?.();
  };
  wrap.onclick = (e) => {
    if (e.target.closest("a")) return;
    edit();
  };
  wrap.onkeydown = (e) => {
    if (e.target === wrap && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); edit(); }
  };
  show();
  return wrap;
}

const HEALTH_LABEL = { healthy: "Healthy", watch: "Watch", "at-risk": "At risk", churned: "Churned" };
function healthBadge(h, { withScore = false } = {}) {
  if (!h) return null;
  return el("span", {
    className: `health h-${h.label}`,
    title: h.reasons.length ? h.reasons.join("\n") : "No issues",
    textContent: HEALTH_LABEL[h.label] + (withScore && h.label !== "churned" ? ` · ${h.score}` : ""),
  });
}

const pill = (value, extra = "") => el("span", { className: `pill ${value} ${extra}`, textContent: value });
const link = (href, text, cls = "") => el("a", { href, textContent: text, className: cls });
const iconBtn = (text, title, onclick, cls = "ghost sm") =>
  el("button", { className: `btn ${cls}`, textContent: text, title: title || null, "aria-label": title && text.length < 3 ? title : null, onclick });
const card = (title, children = [], actions) =>
  el("div", { className: "card" }, [
    title ? el("div", { className: "card-head" }, [el("h3", { textContent: title }), actions || null]) : null,
    ...[].concat(children),
  ]);
const empty = (text) => el("div", { className: "empty", textContent: text });

/* ------------------------------------------------------------- modals */
let lastFocus = null;
function closeModal() {
  const root = $("#modal-root");
  if (!root.children.length) return false;
  root.innerHTML = "";
  lastFocus?.focus?.();
  lastFocus = null;
  return true;
}

function openModal(content, { wide = false, label = "" } = {}) {
  if (!$("#modal-root").children.length) lastFocus = document.activeElement;
  $("#modal-root").innerHTML = "";
  const box = el("div", { className: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": label || null }, content);
  const backdrop = el("div", { className: "modal-backdrop" }, [box]);
  backdrop.onmousedown = (e) => e.target === backdrop && closeModal();
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = [...box.querySelectorAll("a[href], button:not([disabled]), input, select, textarea, [tabindex='0']")].filter((n) => n.offsetParent);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $("#modal-root").append(backdrop);
  (box.querySelector("[autofocus]") || box.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea, button"))?.focus();
  return box;
}

function field(f) {
  let input;
  if (f.type === "select") {
    input = el("select");
    for (const opt of f.options) {
      const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
      input.append(el("option", { value, textContent: label, selected: String(value) === String(f.value ?? "") }));
    }
  } else if (f.type === "textarea") {
    input = el("textarea", { value: f.value ?? "", rows: f.rows || 4, placeholder: f.placeholder || "" });
  } else {
    input = el("input", { type: f.type || "text", value: f.value ?? "", placeholder: f.placeholder || "" });
    if (f.list) input.setAttribute("list", f.list);
    if (f.required) input.required = true;
  }
  input.name = f.name;
  return el("div", { className: "field" + (f.full ? " full" : "") }, [el("label", { textContent: f.label }), input]);
}

function formModal(title, fields, onSubmit, { onDelete, submitLabel = "Save" } = {}) {
  const form = el("form", { className: "form-grid" }, fields.map(field));
  const actions = el("div", { className: "row full", style: "margin-top:6px" }, [
    el("button", { className: "btn", type: "submit", textContent: submitLabel }),
    el("button", { className: "btn ghost", type: "button", textContent: "Cancel", onclick: closeModal }),
    el("div", { className: "spacer" }),
    onDelete
      ? armedButton("Delete", async () => {
          await onDelete();
          closeModal();
        })
      : null,
  ]);
  form.append(actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    await onSubmit(data);
    closeModal();
  };
  openModal([el("h2", { textContent: title }), form], { label: title });
  return form;
}

/* In-page replacements for confirm()/prompt(): native dialogs are blocked in embedded
   viewers and look out of place on mobile. */
function askConfirm(title, message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const box = openModal([
      el("h2", { textContent: title }),
      el("p", { className: "muted", style: "margin:0 0 16px", textContent: message }),
      el("div", { className: "row" }, [
        el("button", { className: "btn danger", textContent: confirmLabel, onclick: () => finish(true) }),
        el("button", { className: "btn ghost", textContent: "Cancel", autofocus: true, onclick: () => finish(false) }),
      ]),
    ], { label: title });
    new MutationObserver((_, obs) => { if (!box.isConnected) { obs.disconnect(); finish(false); } }).observe($("#modal-root"), { childList: true });
  });
}

function askText(title, label, value = "", submitLabel = "Save") {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(v);
    };
    const input = el("input", { value, id: "ask-text" });
    const form = el("form", {}, [
      el("div", { className: "field" }, [el("label", { textContent: label, htmlFor: "ask-text" }), input]),
      el("div", { className: "row" }, [
        el("button", { className: "btn", type: "submit", textContent: submitLabel }),
        el("button", { className: "btn ghost", type: "button", textContent: "Cancel", onclick: () => finish(null) }),
      ]),
    ]);
    form.onsubmit = (e) => { e.preventDefault(); finish(input.value); };
    const box = openModal([el("h2", { textContent: title }), form], { label: title });
    new MutationObserver((_, obs) => { if (!box.isConnected) { obs.disconnect(); finish(null); } }).observe($("#modal-root"), { childList: true });
  });
}

/* Two-step destructive button: first tap arms it, second tap within 4s runs the action. */
function armedButton(label, run, cls = "btn danger") {
  const btn = el("button", { className: cls, type: "button", textContent: label });
  let timer = null;
  btn.onclick = async () => {
    if (!timer) {
      btn.textContent = "Tap again to delete";
      btn.classList.add("armed");
      timer = setTimeout(() => { timer = null; btn.textContent = label; btn.classList.remove("armed"); }, 4000);
      return;
    }
    clearTimeout(timer);
    await run();
  };
  return btn;
}

const optionalId = (v) => (v ? Number(v) : null);
const contactOptions = () => [["", "— none —"], ...state.contacts.map((c) => [c.id, c.company ? `${c.name} · ${c.company}` : c.name])];
const companyOptions = () => [["", "— none —"], ...state.companies.map((c) => [c.id, c.name])];
const dealOptions = (contactId) => [
  ["", "— none —"],
  ...state.deals.filter((d) => !contactId || d.contact_id === Number(contactId)).map((d) => [d.id, d.title]),
];

function datalists() {
  const owners = el("datalist", { id: "owners" }, (state.meta?.owners || []).map((o) => el("option", { value: o })));
  const companies = el("datalist", { id: "company-names" }, state.companies.map((c) => el("option", { value: c.name })));
  document.querySelectorAll("datalist").forEach((d) => d.remove());
  document.body.append(owners, companies);
}

async function loadLookups() {
  const [meta, contacts, companies, deals, templates] = await Promise.all([
    api("/meta"),
    api("/contacts"),
    api("/companies"),
    api("/deals"),
    state.templates.length ? state.templates : api("/templates"),
  ]);
  Object.assign(state, { meta, contacts, companies, deals, templates });
  datalists();
}

async function refreshCounts() {
  const s = await api("/stats");
  state.stats = s;
  $("#c-contacts").textContent = s.contacts;
  $("#c-companies").textContent = s.companies;
  $("#c-deals").textContent = s.open_deals;
  $("#c-notes").textContent = s.notes;
  const due = s.overdue_tasks + s.due_today;
  $("#c-tasks").textContent = due ? due : s.open_tasks;
  $("#c-tasks").classList.toggle("alert", s.overdue_tasks > 0);
}

/* ---------------------------------------------------------- entity forms */
function contactModal(contact, after, defaults = {}) {
  const m = state.meta;
  const v = (k) => contact?.[k] ?? defaults[k];
  const form = formModal(
    contact ? "Edit contact" : "New contact",
    [
      { name: "name", label: "Name", value: v("name"), required: true },
      { name: "title", label: "Title", value: v("title") },
      { name: "company", label: "Company", value: v("company"), list: "company-names" },
      { name: "status", label: "Status", type: "select", options: m.statuses, value: v("status") || "lead" },
      { name: "email", label: "Email", type: "email", value: v("email") },
      { name: "phone", label: "Phone", value: v("phone") },
      { name: "linkedin", label: "LinkedIn URL", value: v("linkedin") },
      { name: "owner", label: "Owner", value: v("owner"), list: "owners" },
      { name: "source", label: "Source", value: v("source"), placeholder: "apollo, referral, inbound…" },
      { name: "next_follow_up", label: "Next follow-up", type: "date", value: v("next_follow_up") },
      { name: "tags", label: "Tags (comma separated)", value: v("tags"), full: true },
      { name: "about", label: "Background", type: "textarea", value: v("about"), full: true, rows: 3 },
    ],
    async (data) => {
      const saved = contact
        ? await api(`/contacts/${contact.id}`, { method: "PATCH", body: data })
        : await api("/contacts", { method: "POST", body: data });
      toast(contact ? "Contact saved" : `${saved.name} added`, "ok", contact ? {} : { action: { label: "Log a touch", fn: () => logActivityModal({ contact_id: saved.id }) } });
      await loadLookups();
      after ? after(saved) : navigate(`#/contacts/${saved.id}`);
    },
    {
      onDelete:
        contact &&
        (async () => {
          await api(`/contacts/${contact.id}`, { method: "DELETE" });
          toast("Contact deleted");
          navigate("#/contacts");
        }),
    }
  );
  watchDuplicates(form, contact?.id);
}

/* Warn about likely duplicates while the contact form is being filled in. */
function watchDuplicates(form, excludeId) {
  const warn = el("div", { className: "dup-warning full", role: "status" });
  form.prepend(warn);
  const check = async () => {
    const params = new URLSearchParams({ email: form.elements.namedItem("email").value, name: form.elements.namedItem("name").value });
    if (excludeId) params.set("exclude", excludeId);
    const dupes = await api(`/contacts/duplicates?${params}`);
    warn.innerHTML = "";
    if (!dupes.length) return;
    warn.append(
      "Possible duplicate: ",
      ...dupes.flatMap((d, i) => [i ? ", " : "", el("a", { href: `#/contacts/${d.id}`, textContent: `${d.name}${d.company ? " (" + d.company + ")" : ""}`, onclick: closeModal })])
    );
  };
  form.elements.namedItem("name").addEventListener("blur", check);
  form.elements.namedItem("email").addEventListener("blur", check);
}

function companyModal(company, after) {
  formModal(
    company ? "Edit company" : "New company",
    [
      { name: "name", label: "Name", value: company?.name, required: true },
      { name: "domain", label: "Domain", value: company?.domain, placeholder: "acme.com" },
      { name: "industry", label: "Industry", value: company?.industry },
      { name: "size", label: "Size", value: company?.size, placeholder: "50-200" },
      { name: "location", label: "Location", value: company?.location },
      { name: "owner", label: "Account owner", value: company?.owner, list: "owners" },
      { name: "mrr", label: "Monthly contract value ($)", type: "number", value: company?.mrr || "" },
      { name: "renewal_date", label: "Contract renewal", type: "date", value: company?.renewal_date },
      { name: "about", label: "About", type: "textarea", value: company?.about, full: true, rows: 3 },
    ],
    async (data) => {
      data.mrr = Number(data.mrr || 0);
      const saved = company
        ? await api(`/companies/${company.id}`, { method: "PATCH", body: data })
        : await api("/companies", { method: "POST", body: data });
      toast("Company saved");
      await loadLookups();
      after ? after(saved) : navigate(`#/companies/${saved.id}`);
    },
    {
      onDelete:
        company &&
        (async () => {
          await api(`/companies/${company.id}`, { method: "DELETE" });
          toast("Company deleted");
          navigate("#/companies");
        }),
    }
  );
}

function dealModal(deal, defaults = {}, after) {
  const m = state.meta;
  formModal(
    deal ? "Edit deal" : "New deal",
    [
      { name: "title", label: "Deal", value: deal?.title, required: true, full: true },
      { name: "contact_id", label: "Contact", type: "select", options: contactOptions(), value: deal?.contact_id ?? defaults.contact_id },
      { name: "value", label: "Value ($)", type: "number", value: deal?.value ?? "" },
      { name: "stage", label: "Stage", type: "select", options: m.stages, value: deal?.stage || defaults.stage || "lead" },
      { name: "probability", label: "Win probability % (blank = stage default)", type: "number", value: deal?.probability ?? "" },
      { name: "close_date", label: "Expected close", type: "date", value: deal?.close_date },
      { name: "owner", label: "Owner", value: deal?.owner, list: "owners" },
      { name: "next_step", label: "Next step", value: deal?.next_step, full: true },
      { name: "lost_reason", label: "Lost reason", value: deal?.lost_reason, full: true },
    ],
    async (data) => {
      const body = {
        ...data,
        value: Number(data.value || 0),
        contact_id: optionalId(data.contact_id),
        probability: data.probability === "" ? null : Number(data.probability),
      };
      // Changing stage without touching the probability resets it to the new stage's default.
      if (deal && data.stage !== deal.stage && body.probability === deal.probability) delete body.probability;
      const saved = deal
        ? await api(`/deals/${deal.id}`, { method: "PATCH", body })
        : await api("/deals", { method: "POST", body });
      toast("Deal saved");
      await loadLookups();
      after ? after(saved) : route();
    },
    {
      onDelete:
        deal &&
        (async () => {
          await api(`/deals/${deal.id}`, { method: "DELETE" });
          toast("Deal deleted");
          await loadLookups();
          navigate("#/pipeline");
        }),
    }
  );
}

async function moveDeal(deal, stage) {
  if (deal.stage === stage) return;
  const body = { stage };
  if (stage === "lost") {
    const reason = await askText(`Mark “${deal.title}” as lost`, "Why was this deal lost?", deal.lost_reason || "", "Mark as lost");
    if (reason === null) return;
    body.lost_reason = reason;
  }
  const previous = { stage: deal.stage, probability: deal.probability };
  await api(`/deals/${deal.id}`, { method: "PATCH", body });
  if (stage === "won") celebrate();
  toast(stage === "won" ? `${deal.title} won 🎉` : `Moved to ${stage}`, "ok", {
    action: {
      label: "Undo",
      fn: async () => {
        await api(`/deals/${deal.id}`, { method: "PATCH", body: { stage: previous.stage } });
        await loadLookups();
        route();
      },
    },
  });
  await loadLookups();
  route();
}

const OUTCOMES = {
  call: ["connected", "voicemail", "no answer", "gatekeeper", "wrong number", "not interested", "meeting booked"],
  email: ["sent", "replied", "bounced", "no reply"],
  meeting: ["held", "no-show", "rescheduled", "cancelled"],
  linkedin: ["connection sent", "connection accepted", "message sent", "replied"],
  sms: ["sent", "replied"],
  note: [""],
};

function activityComposer(links, onDone) {
  let type = "call";
  const tabs = el("div", { className: "tabs" });
  const subject = el("input", { placeholder: "Subject (optional)" });
  const outcome = el("select");
  const body = el("textarea", { rows: 3, placeholder: "What happened? Key points, objections, next steps…" });
  const when = el("input", { type: "datetime-local", value: nowLocal() });
  const followText = el("input", { placeholder: "Follow-up task (optional) — e.g. Send deck @fri !high" });
  const followDate = el("input", { type: "date" });
  const people = links.company_id
    ? [["", "— contact (optional) —"], ...state.contacts.filter((c) => c.company_id === links.company_id).map((c) => [c.id, c.name])]
    : contactOptions();
  const contactSel = links.contact_id
    ? null
    : el("select", { "aria-label": "Contact" }, people.map(([v, l]) => el("option", { value: v, textContent: l })));

  const setType = (t) => {
    type = t;
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.type === t));
    outcome.innerHTML = "";
    OUTCOMES[t].forEach((o) => outcome.append(el("option", { value: o, textContent: o || "—" })));
    outcome.style.display = t === "note" ? "none" : "";
  };
  for (const t of ["call", "email", "meeting", "linkedin", "sms"]) {
    tabs.append(el("button", { type: "button", textContent: t, dataset: { type: t }, onclick: () => setType(t) }));
  }
  setType("call");

  const quick = el("div", { className: "chips" }, [
    ["Tomorrow", 1],
    ["In 3 days", 3],
    ["Next week", 7],
    ["In 2 weeks", 14],
  ].map(([label, n]) => el("button", { type: "button", className: "chip", textContent: label, onclick: () => (followDate.value = addDays(n)) })));

  const save = async () => {
    const payload = {
      ...links,
      type,
      subject: subject.value,
      outcome: outcome.value,
      body: body.value,
      occurred_at: when.value,
      follow_up_text: followText.value,
      follow_up_date: followDate.value,
    };
    if (contactSel) payload.contact_id = optionalId(contactSel.value);
    await api("/activities", { method: "POST", body: payload });
    toast(`${type} logged`);
    subject.value = body.value = followText.value = followDate.value = "";
    when.value = nowLocal();
    onDone?.();
  };
  body.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") save();
  };

  return el("div", { className: "composer" }, [
    tabs,
    el("div", { className: "row wrap" }, [contactSel, subject, outcome, when]),
    body,
    el("div", { className: "row wrap" }, [followText, followDate, quick]),
    el("div", { className: "row" }, [
      el("span", { className: "hint", textContent: "Ctrl+Enter to save · follow-up creates a task and sets the contact’s next follow-up" }),
      el("div", { className: "spacer" }),
      el("button", { className: "btn", type: "button", textContent: "Log activity", onclick: save }),
    ]),
  ]);
}

function logActivityModal(links = {}) {
  const box = openModal([el("h2", { textContent: "Log activity" }), activityComposer(links, () => { closeModal(); route(); })], { wide: true });
  box.querySelector("textarea").focus();
}

async function newNote(opts = {}) {
  const note = await api("/notes", { method: "POST", body: { ...opts, meeting_date: opts.meeting_date ?? todayIso() } });
  navigate(`#/notes/${note.id}`);
}

function templatePicker(opts = {}) {
  const list = el("div", { className: "template-list" }, [
    el("button", { className: "template", onclick: () => { closeModal(); newNote({ ...opts, kind: opts.kind || "note" }); } }, [
      el("strong", { textContent: "Blank note" }),
      el("span", { textContent: "Start from scratch" }),
    ]),
    ...state.templates.map((t) =>
      el("button", { className: "template", onclick: () => { closeModal(); newNote({ ...opts, template: t.id }); } }, [
        el("strong", { textContent: t.name }),
        el("span", { textContent: t.body.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3)).slice(0, 4).join(" · ") }),
      ])
    ),
  ]);
  openModal([el("h2", { textContent: "New note" }), list]);
}

/* ---------------------------------------------------------------- views */
function kpi(label, value, sub, cls = "") {
  return el("div", { className: "card stat " + cls }, [
    el("div", { className: "label", textContent: label }),
    el("div", { className: "value", textContent: value }),
    sub ? el("div", { className: "sub", textContent: sub }) : null,
  ]);
}

function taskRow(t, onChange, { showSource = true } = {}) {
  const overdue = !t.done && t.due_date && t.due_date < todayIso();
  const due = el("input", {
    type: "date",
    value: t.due_date || "",
    className: "due" + (overdue ? " overdue" : ""),
    title: "Due date",
    onchange: async (e) => {
      await api(`/tasks/${t.id}`, { method: "PATCH", body: { due_date: e.target.value } });
      onChange?.();
    },
  });
  const source = [];
  if (showSource) {
    if (t.contact_name) source.push(link(`#/contacts/${t.contact_id}`, t.contact_name));
    if (t.deal_title) source.push(link(`#/deals/${t.deal_id}`, t.deal_title));
    if (t.note_title) source.push(link(`#/notes/${t.note_id}`, "✎ " + t.note_title));
  }
  const li = el("li", { className: (t.done ? "done " : "") + `prio-${t.priority || "normal"}` });
  const setDone = async (done, { undo = true } = {}) => {
    li.classList.toggle("done", done);
    box.checked = done;
    await api(`/tasks/${t.id}`, { method: "PATCH", body: { done } });
    t.done = done ? 1 : 0;
    refreshCounts().catch(() => {});
    if (done && undo) toast(`Done: ${t.text}`, "ok", { action: { label: "Undo", fn: () => setDone(false, { undo: false }) } });
    setTimeout(() => onChange?.(), 450);
  };
  const box = el("input", {
    type: "checkbox",
    checked: !!t.done,
    "aria-label": `Mark “${t.text}” ${t.done ? "not done" : "done"}`,
    onchange: (e) => setDone(e.target.checked),
  });
  li.append(
    box,
    el("span", { className: "prio", title: `${t.priority} priority`, "aria-hidden": "true" }),
    el("div", { className: "task-main" }, [
      el("span", { className: "txt", textContent: t.text }),
      source.length ? el("span", { className: "src" }, source.flatMap((s, i) => (i ? [" · ", s] : [s]))) : null,
    ]),
    due,
    el("button", {
      className: "icon",
      title: "Delete task",
      "aria-label": "Delete task",
      textContent: "×",
      onclick: () => deferredDelete("Task", li, () => api(`/tasks/${t.id}`, { method: "DELETE" }), onChange),
    })
  );
  return li;
}

function quickAddTask(links, onDone) {
  const input = el("input", { className: "quick-add", placeholder: "Add a task… (e.g. Call Dana @tomorrow !high) — Enter to add" });
  input.onkeydown = async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    await api("/tasks", { method: "POST", body: { text: input.value, ...links } });
    input.value = "";
    onDone?.();
  };
  return input;
}

function activityIcon(type) {
  return { call: "☎", email: "✉", meeting: "👥", linkedin: "in", sms: "💬", note: "✎", idea: "💡", stage: "⇢", deal: "◆", task: "✓" }[type] || "•";
}

function timelineView(items, { showContact = false } = {}) {
  if (!items.length) return empty("No activity yet. Log a call, email or meeting to start the history.");
  const list = el("div", { className: "timeline" });
  for (const i of items) {
    const isNote = i.entry === "note";
    let summary = "";
    if (isNote && i.summary) {
      try {
        summary = JSON.parse(i.summary).summary;
      } catch {}
    }
    const bodyText = isNote ? summary || i.body.slice(0, 220) : i.body;
    const deletable = !isNote && ["call", "email", "meeting", "linkedin", "sms", "note"].includes(i.type);
    list.append(
      el("div", { className: `tl-item t-${i.type}` + (isNote ? " clickable" : ""), onclick: isNote ? () => navigate(`#/notes/${i.id}`) : null }, [
        el("div", { className: "tl-icon", textContent: activityIcon(i.type) }),
        el("div", { className: "tl-body" }, [
          el("div", { className: "tl-head" }, [
            el("div", { className: "tl-title" }, [
              el("strong", { textContent: isNote ? i.subject : i.subject || i.type }),
              i.outcome ? pill(i.outcome, "outcome") : null,
              el("span", { className: "muted", textContent: [isNote ? `${i.kind} note` : i.type, showContact && i.contact_name, i.deal_title].filter(Boolean).join(" · ") }),
            ]),
            el("span", { className: "muted tl-time", title: i.occurred_at, textContent: relTime(i.occurred_at) }),
            deletable
              ? el("button", {
                  className: "icon",
                  title: "Delete activity",
                  textContent: "×",
                  "aria-label": "Delete activity",
                  onclick: (e) => {
                    e.stopPropagation();
                    const node = e.target.closest(".tl-item");
                    deferredDelete("Activity", node, () => api(`/activities/${i.id}`, { method: "DELETE" }));
                  },
                })
              : null,
          ]),
          bodyText ? el("div", { className: "tl-text", textContent: bodyText }) : null,
        ]),
      ])
    );
  }
  return list;
}

/* ----- dashboard */
async function renderDashboard(root) {
  await refreshCounts();
  const s = state.stats;
  setActions([
    iconBtn("Log activity", "L", () => logActivityModal(), "ghost"),
    iconBtn("New note", "N", () => templatePicker(), ""),
  ]);
  const touches = Object.entries(s.activity_7d).reduce((a, [, v]) => a + v, 0);
  root.append(...[briefing(s), askCard(), installCard(), onboarding(s)].filter(Boolean));
  root.append(
    el("div", { className: "grid stats" }, [
      kpi("Weighted pipeline", kmoney(s.weighted_pipeline), `${money(s.open_pipeline)} open · ${s.open_deals} deals`),
      kpi("Won this month", kmoney(s.won_this_month), `${money(s.won)} all-time`),
      kpi("Win rate", s.win_rate == null ? "—" : `${s.win_rate}%`, s.avg_won ? `avg won ${kmoney(s.avg_won)}` : "no closed deals yet"),
      kpi("Due now", String(s.overdue_tasks + s.due_today), `${s.overdue_tasks} overdue · ${s.due_today} today`, s.overdue_tasks ? "alert" : ""),
      kpi("Touches (7d)", String(touches), Object.entries(s.activity_7d).map(([k, v]) => `${v} ${k}`).join(" · ") || "log calls & emails"),
    ])
  );

  const agenda = el("ul", { className: "tasklist" }, s.agenda.map((t) => taskRow(t, () => route())));
  const followUps = el(
    "div",
    { className: "list" },
    s.follow_ups.map((c) =>
      el("a", { className: "list-row", href: `#/contacts/${c.id}` }, [
        el("span", { textContent: c.name }),
        el("span", { className: "muted", textContent: c.company || "" }),
        el("div", { className: "spacer" }),
        el("span", { className: c.next_follow_up < todayIso() ? "bad" : "warn", textContent: relTime(c.next_follow_up) }),
      ])
    )
  );
  const attention = el(
    "div",
    { className: "list" },
    s.stale_deals.map((d) =>
      el("a", { className: "list-row", href: `#/deals/${d.id}` }, [
        el("span", { textContent: d.title }),
        el("div", { className: "spacer" }),
        el("span", { className: "muted", textContent: money(d.value) }),
        el("span", { className: "bad", textContent: `${d.days_since_activity}d quiet` }),
      ])
    )
  );

  const maxF = Math.max(1, ...s.forecast.map((f) => f.weighted));
  const forecast = el(
    "div",
    { className: "bars" },
    s.forecast.map((f) =>
      el("div", { className: "bar-row" }, [
        el("span", { className: "bar-label", textContent: /^\d{4}-\d{2}$/.test(f.month) ? new Date(f.month + "-01T12:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : f.month }),
        el("div", { className: "bar-track" }, [el("div", { className: "bar-fill" + (f.month === "overdue" ? " bad" : ""), style: `width:${(100 * f.weighted) / maxF}%` })]),
        el("span", { className: "bar-value", textContent: kmoney(f.weighted) }),
      ])
    )
  );
  const maxS = Math.max(1, ...state.meta.stages.map((st) => s.by_stage[st].value));
  const funnel = el(
    "div",
    { className: "bars" },
    state.meta.stages.map((st) =>
      el("a", { className: "bar-row", href: "#/pipeline" }, [
        el("span", { className: "bar-label" }, [pill(st)]),
        el("div", { className: "bar-track" }, [el("div", { className: `bar-fill st-${st}`, style: `width:${(100 * s.by_stage[st].value) / maxS}%` })]),
        el("span", { className: "bar-value", textContent: `${s.by_stage[st].count} · ${kmoney(s.by_stage[st].value)}` }),
      ])
    )
  );

  root.append(
    el("div", { className: "grid cols3" }, [
      card("Due today & overdue", s.agenda.length ? agenda : empty("Nothing due. Nice."), link("#/tasks", "All tasks →", "muted")),
      card("Follow-ups due", s.follow_ups.length ? followUps : empty("No follow-ups due.")),
      card("Deals going cold", s.stale_deals.length ? attention : empty("Every open deal touched in the last 14 days.")),
    ]),
    el("div", { className: "grid cols3" }, [
      card("Accounts needing attention", s.at_risk.length ? accountList(s.at_risk) : empty("All active accounts look healthy.")),
      card("Upcoming renewals (90 days)", s.renewals.length ? renewalList(s.renewals) : empty("Add contract renewal dates to companies to track them here.")),
      card("Pipeline by stage", funnel),
    ]),
    el("div", { className: "grid cols3" }, [
      card("Weighted forecast by close month", s.forecast.length ? forecast : empty("Add close dates to open deals.")),
      card("Recent activity", timelineView(s.recent_activity.filter((a) => a.type !== "deal").map((a) => ({ ...a, entry: "activity" })), { showContact: true })),
    ])
  );
}

/* Stable per-name avatar colours drawn from the brand family. */
const AVATAR_HUES = [["#2f6bff", "#14c9a8"], ["#7c4dff", "#2f6bff"], ["#0b8fbf", "#2ed3b7"], ["#e0548b", "#7c4dff"], ["#f08a24", "#e0548b"], ["#12925c", "#0b8fbf"]];
function avatarStyle(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_HUES[h % AVATAR_HUES.length];
  return `background: linear-gradient(135deg, ${a}, ${b})`;
}

function askCard() {
  if (window.__NO_COPILOT__) return null;
  const input = el("input", { id: "ask-input", placeholder: "Ask Copilot — “brief me on Northwind”, “remind me to call Dana Friday”…", "aria-label": "Ask Copilot" });
  const ask = (text) => text.trim() && window.Copilot?.ask(text.trim());
  const form = el("form", { onsubmit: (e) => { e.preventDefault(); ask(input.value); input.value = ""; } }, [
    el("span", { innerHTML: '<svg aria-hidden="true"><use href="#i-spark"/></svg>' }),
    input,
    el("button", { className: "btn sm", type: "submit", textContent: "Ask" }),
    el("div", { className: "chips" }, ["What should I focus on today?", "Which accounts are at risk?", "Pipeline summary"].map((q) =>
      el("button", { type: "button", className: "chip", textContent: q, onclick: () => ask(q) }))),
  ]);
  return el("div", { className: "ask-card" }, [form]);
}

function briefing(s) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const items = [];
  if (s.overdue_tasks) items.push(el("a", { href: "#/tasks", className: "brief bad" }, `${s.overdue_tasks} overdue task${s.overdue_tasks > 1 ? "s" : ""}`));
  if (s.due_today) items.push(el("a", { href: "#/tasks", className: "brief warn" }, `${s.due_today} due today`));
  if (s.follow_ups.length) items.push(el("span", { className: "brief warn" }, `${s.follow_ups.length} follow-up${s.follow_ups.length > 1 ? "s" : ""} to send`));
  if (s.stale_deals.length) items.push(el("span", { className: "brief" }, `${s.stale_deals.length} deal${s.stale_deals.length > 1 ? "s" : ""} going cold`));
  const risky = s.at_risk.filter((a) => a.health.label === "at-risk").length;
  if (risky) items.push(el("span", { className: "brief bad" }, `${risky} account${risky > 1 ? "s" : ""} at risk`));
  const soon = s.renewals.filter((r) => r.renewal_date <= addDays(30)).length;
  if (soon) items.push(el("span", { className: "brief" }, `${soon} renewal${soon > 1 ? "s" : ""} in 30 days`));
  return el("div", { className: "briefing" }, [
    el("div", { className: "brief-title" }, [
      el("strong", { textContent: `${hello}.` }),
      " ",
      items.length ? `${items.length} thing${items.length > 1 ? "s" : ""} need${items.length > 1 ? "" : "s"} you today:` : "You're all caught up — a good time to prospect.",
    ]),
    items.length ? el("div", { className: "brief-items" }, items) : null,
  ]);
}

/* ------------------------------------------------------ install as an app */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // show our own button instead of the mini-infobar
  installPrompt = e;
  document.querySelectorAll(".install-card").forEach((n) => n.classList.add("ready"));
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  document.querySelectorAll(".install-card").forEach((n) => n.remove());
  toast("Installed — open Vanguard CRM from your home screen");
});
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome !== "accepted") toast("Install cancelled — you can install any time from here");
    return;
  }
  installHelp();
}

function installHelp() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const inApp = /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|LinkedInApp|GSA\//.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const insecure = location.protocol !== "https:" && location.hostname !== "localhost";
  const steps = insecure
    ? ["Open the https:// address of the CRM. Apps only install from a secure (https) address."]
    : inApp
    ? ["You're in an app's built-in browser, which can't install apps.", "Tap ⋮ (or the share icon) → Open in Chrome.", "In Chrome, tap ⋮ → Install app (or Add to Home screen)."]
    : ios
    ? ["Open this page in Safari.", "Tap the Share button.", "Choose Add to Home Screen, then Add."]
    : samsung
    ? ["Tap the ≡ menu at the bottom.", "Tap Add page to → Home screen.", "Or open the page in Chrome and use ⋮ → Install app."]
    : ["Tap ⋮ at the top right of Chrome.", "Tap Install app (or Add to Home screen).", "Confirm with Install. The CRM opens full-screen from your home screen."];
  openModal([
    el("h2", { textContent: "Install Vanguard CRM" }),
    el("ol", { className: "install-steps" }, steps.map((t) => el("li", { textContent: t }))),
    el("p", { className: "muted small", textContent: "Already installed? Open it from your home screen or app drawer. If Chrome shows Open instead of Install, it's installed." }),
    el("div", { className: "row" }, [el("button", { className: "btn", textContent: "Got it", onclick: closeModal })]),
  ], { label: "Install Vanguard CRM" });
}

function installCard() {
  if (isInstalled() || window.__SEED__ || store.get("installDismissed", false)) return null;
  const box = el("div", { className: "card install-card" + (installPrompt ? " ready" : "") }, [
    el("img", { src: "/static/icon-192.png", alt: "", width: 40, height: 40 }),
    el("div", { className: "install-text" }, [
      el("strong", { textContent: "Install Vanguard CRM on this device" }),
      el("span", { className: "muted small", textContent: "Home-screen icon, full-screen, quick shortcuts to Today, Notes and Pipeline." }),
    ]),
    el("button", { className: "btn sm", textContent: "Install", onclick: installApp }),
    el("button", { className: "icon", textContent: "×", title: "Hide", "aria-label": "Hide install suggestion", onclick: () => { store.set("installDismissed", true); box.remove(); } }),
  ]);
  return box;
}

function onboarding(s) {
  if (store.get("onboardingDone", false)) return null;
  const steps = [
    ["Add or import your contacts", s.contacts > 0, () => navigate("#/contacts")],
    ["Log a call, email or meeting", s.activities_total > 0, () => logActivityModal()],
    ["Take a meeting note from a template", s.notes > 0, () => templatePicker()],
    ["Summarize a note into next steps", s.summaries > 0, () => navigate("#/notes")],
    ["Add a deal to the pipeline", s.open_deals + s.by_stage.won.count + s.by_stage.lost.count > 0, () => dealModal()],
  ];
  const done = steps.filter((x) => x[1]).length;
  if (done === steps.length) return null;
  const box = el("div", { className: "card onboarding" }, [
    el("div", { className: "card-head" }, [
      el("h3", { textContent: `Get set up · ${done}/${steps.length}` }),
      el("button", { className: "icon", textContent: "×", title: "Hide", "aria-label": "Hide setup checklist", onclick: () => { store.set("onboardingDone", true); box.remove(); } }),
    ]),
    el("div", { className: "progress" }, [el("div", { style: `width:${(100 * done) / steps.length}%` })]),
    el("div", { className: "steps" }, steps.map(([label, ok, go]) =>
      el("button", { className: "step" + (ok ? " ok" : ""), onclick: go, disabled: ok }, [el("span", { className: "tick", textContent: ok ? "✓" : "" }), label])
    )),
  ]);
  return box;
}

function accountList(accounts) {
  return el("div", { className: "list" }, accounts.map((a) =>
    el("a", { className: "list-row", href: `#/companies/${a.id}`, title: a.health.reasons.join("\n") }, [
      el("span", { textContent: a.name }),
      el("span", { className: "muted small ellipsis", textContent: a.health.reasons[0] || "" }),
      el("div", { className: "spacer" }),
      healthBadge(a.health),
    ])
  ));
}

function renewalList(accounts) {
  return el("div", { className: "list" }, accounts.map((a) =>
    el("a", { className: "list-row", href: `#/companies/${a.id}` }, [
      el("span", { textContent: a.name }),
      a.mrr ? el("span", { className: "muted small", textContent: `${kmoney(a.mrr)}/mo` }) : null,
      el("div", { className: "spacer" }),
      healthBadge(a.health),
      el("span", { className: a.renewal_date < addDays(30) ? "warn" : "muted", textContent: relTime(a.renewal_date) }),
    ])
  ));
}

/* Health card + next-best-action banner for contact and company pages. */
function healthPanel(h, actions = {}) {
  if (!h || h.label === "churned") return null;
  const suggestions = h.actions.map((a) => {
    let fn = null;
    if (/follow[- ]up|reach out|re-engage|first contact|check-in|renewal/i.test(a)) fn = actions.log;
    else if (/overdue tasks/i.test(a)) fn = () => navigate("#/tasks");
    else if (/next follow-up date/i.test(a)) fn = actions.followUp;
    else if (/advance/i.test(a)) fn = actions.deal;
    return fn ? el("button", { className: "nba", onclick: fn }, [el("span", { textContent: "→" }), a]) : el("div", { className: "nba static" }, [el("span", { textContent: "→" }), a]);
  });
  return el("div", { className: `card health-card h-${h.label}` }, [
    el("div", { className: "card-head" }, [
      el("h3", { textContent: "Relationship health" }),
      healthBadge(h, { withScore: true }),
    ]),
    el("div", { className: "meter", role: "meter", "aria-valuenow": h.score, "aria-valuemin": 0, "aria-valuemax": 100 }, [el("div", { style: `width:${h.score}%` })]),
    h.reasons.length ? el("ul", { className: "reasons" }, h.reasons.map((r) => el("li", { textContent: r }))) : el("div", { className: "muted small", textContent: "Engaged recently, nothing overdue." }),
    suggestions.length ? el("div", { className: "sum-label", style: "margin-top:10px", textContent: "Next best action" }) : null,
    ...suggestions,
  ]);
}

/* ----- contacts */
async function renderContacts(root) {
  await loadLookups();
  const f = state.contactFilter;
  const sel = state.selected;
  const ids = new Set(state.contacts.map((c) => c.id));
  [...sel].forEach((id) => ids.has(id) || sel.delete(id));
  const fileInput = el("input", {
    type: "file",
    accept: ".csv,text/csv",
    style: "display:none",
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = await api("/contacts/import", { method: "POST", body: { csv: await file.text() } });
      toast(`Imported ${r.created} new · ${r.updated} updated · ${r.skipped} skipped`);
      route();
    },
  });
  const importCsv = () => fileInput.click();
  setActions([
    fileInput,
    iconBtn("Import CSV", "Apollo, HubSpot and LinkedIn exports work as-is", importCsv, "ghost"),
    el("a", { className: "btn ghost", href: "/api/contacts/export.csv", textContent: "Export" }),
    iconBtn("New contact", "", () => contactModal(), ""),
  ]);

  if (!state.contacts.length) {
    root.append(el("div", { className: "card hero-empty" }, [
      el("h2", { textContent: "Bring in your contacts" }),
      el("p", { className: "muted", textContent: "Import a CSV straight from Apollo, HubSpot or LinkedIn — columns are matched automatically and duplicates merged by email. Or add people one by one." }),
      el("div", { className: "row", style: "justify-content:center" }, [iconBtn("Import CSV", "", importCsv, ""), iconBtn("Add a contact", "", () => contactModal(), "ghost")]),
    ]));
    return;
  }

  const rerender = () => {
    persistFilters();
    const cursor = document.activeElement?.name;
    root.innerHTML = "";
    draw();
    if (cursor) root.querySelector(`[name=${cursor}]`)?.focus();
  };
  const select = (name, value, options, set) =>
    el("select", { name, "aria-label": name, onchange: (e) => { set(e.target.value); rerender(); } },
      options.map(([v, l]) => el("option", { value: v, textContent: l, selected: v === value })));
  const active = f.q || f.status || f.owner || f.tag;
  const filterBar = () =>
    el("div", { className: "filters" }, [
      el("input", { name: "q", type: "search", "aria-label": "Filter contacts", placeholder: "Filter by name, company, email, tag…", value: f.q, oninput: (e) => { f.q = e.target.value; rerender(); } }),
      select("status", f.status, [["", "All statuses"], ...state.meta.statuses.map((x) => [x, x])], (v) => (f.status = v)),
      select("owner", f.owner, [["", "All owners"], ...state.meta.owners.map((x) => [x, x])], (v) => (f.owner = v)),
      select("tag", f.tag, [["", "All tags"], ...state.meta.tags.map((x) => [x, x])], (v) => (f.tag = v)),
      active ? el("button", { className: "btn ghost sm", textContent: "Clear filters", onclick: () => { Object.assign(f, { q: "", status: "", owner: "", tag: "" }); rerender(); } }) : null,
    ]);

  const bulk = async (action, value = "") => {
    const list = [...sel];
    if (action === "delete" && !(await askConfirm(`Delete ${list.length} contact${list.length > 1 ? "s" : ""}?`, "Their activity history, tasks and note links are removed too. This can't be undone."))) return;
    await api("/contacts/bulk", { method: "POST", body: { ids: list, action, value } });
    toast(`${list.length} contact${list.length > 1 ? "s" : ""} updated`);
    if (action === "delete") sel.clear();
    route();
  };
  const bulkBar = () => {
    if (!sel.size) return null;
    const pick = (label, options, action) =>
      el("select", { "aria-label": label, onchange: (e) => e.target.value && bulk(action, e.target.value) },
        [el("option", { value: "", textContent: label }), ...options.map((o) => el("option", { value: o, textContent: o }))]);
    const tagInput = el("input", { placeholder: "Add tag…", style: "width:120px", onkeydown: (e) => e.key === "Enter" && e.target.value.trim() && bulk("add_tag", e.target.value.trim()) });
    const follow = el("input", { type: "date", "aria-label": "Set follow-up", title: "Set next follow-up", onchange: (e) => e.target.value && bulk("follow_up", e.target.value) });
    return el("div", { className: "bulk-bar", role: "toolbar", "aria-label": "Bulk actions" }, [
      el("strong", { textContent: `${sel.size} selected` }),
      pick("Set status…", state.meta.statuses, "status"),
      pick("Assign owner…", state.meta.owners, "owner"),
      tagInput,
      el("label", { className: "muted small" }, ["Follow-up ", follow]),
      el("div", { className: "spacer" }),
      el("button", { className: "btn ghost sm", textContent: "Clear", onclick: () => { sel.clear(); rerender(); } }),
      el("button", { className: "btn danger sm", textContent: "Delete", onclick: () => bulk("delete") }),
    ]);
  };

  const columns = [
    ["name", "Name"],
    ["company", "Company"],
    ["status", "Status"],
    ["health", "Health"],
    ["owner", "Owner"],
    ["last_contacted_at", "Last touch"],
    ["next_follow_up", "Follow-up"],
    ["open_value", "Open deals"],
    ["open_tasks", "Tasks"],
  ];
  const sortValue = (c, key) => (key === "health" ? c.health.score : c[key] ?? "");

  function draw() {
    const q = f.q.toLowerCase();
    let list = state.contacts.filter(
      (c) =>
        (!q || `${c.name} ${c.company} ${c.email} ${c.tags} ${c.title}`.toLowerCase().includes(q)) &&
        (!f.status || c.status === f.status) &&
        (!f.owner || c.owner === f.owner) &&
        (!f.tag || (c.tags || "").split(",").map((t) => t.trim()).includes(f.tag))
    );
    list = list.sort((a, b) => {
      const x = sortValue(a, f.sort), y = sortValue(b, f.sort);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * f.dir;
    });
    const allChecked = list.length && list.every((c) => sel.has(c.id));
    const table = el("table", { className: "table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { className: "check" }, [el("input", { type: "checkbox", checked: allChecked, "aria-label": "Select all", onchange: (e) => { list.forEach((c) => (e.target.checked ? sel.add(c.id) : sel.delete(c.id))); rerender(); } })]),
          ...columns.map(([key, label]) =>
            el("th", {
              className: "sortable" + (f.sort === key ? " sorted" : ""),
              tabIndex: 0,
              "aria-sort": f.sort === key ? (f.dir > 0 ? "ascending" : "descending") : null,
              textContent: label + (f.sort === key ? (f.dir > 0 ? " ↑" : " ↓") : ""),
              onclick: () => { f.dir = f.sort === key ? -f.dir : 1; f.sort = key; rerender(); },
              onkeydown: (e) => e.key === "Enter" && e.target.click(),
            })
          ),
        ]),
      ]),
      el("tbody", {}, list.map((c) => {
        const stale = daysSince(c.last_contacted_at);
        return el("tr", { className: sel.has(c.id) ? "selected" : "", onclick: () => navigate(`#/contacts/${c.id}`) }, [
          el("td", { className: "check", onclick: (e) => e.stopPropagation() }, [el("input", { type: "checkbox", checked: sel.has(c.id), "aria-label": `Select ${c.name}`, onchange: (e) => { e.target.checked ? sel.add(c.id) : sel.delete(c.id); rerender(); } })]),
          el("td", {}, [el("a", { className: "strong", href: `#/contacts/${c.id}`, textContent: c.name }), el("div", { className: "muted small", textContent: c.title || c.email || "" })]),
          el("td", {}, c.company_id ? [link(`#/companies/${c.company_id}`, c.company)] : []),
          el("td", {}, [pill(c.status)]),
          el("td", {}, [healthBadge(c.health)]),
          el("td", { textContent: c.owner || "—", className: "muted" }),
          el("td", { className: stale > 30 && c.status !== "churned" ? "bad" : "", textContent: relTime(c.last_contacted_at) }),
          el("td", { className: c.next_follow_up && c.next_follow_up <= todayIso() ? "warn" : "muted", textContent: c.next_follow_up ? relTime(c.next_follow_up) : "—" }),
          el("td", { textContent: c.open_value ? money(c.open_value) : "—" }),
          el("td", { textContent: c.open_tasks || "—" }),
        ]);
      })),
    ]);
    table.querySelectorAll("tbody a").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
    root.append(
      filterBar(),
      bulkBar() || "",
      el("div", { className: "card flush" }, [table, list.length ? null : empty("No contacts match these filters.")]),
      el("div", { className: "muted small", style: "margin-top:8px", textContent: `${list.length} of ${state.contacts.length} contacts` })
    );
  }
  draw();
}

function detailRow(label, value) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  return el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), el("span", { className: "v" }, [].concat(value))]);
}

function tagsView(tags) {
  const list = (tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  return list.length ? list.map((t) => el("span", { className: "tag", textContent: t })) : null;
}

function dealMini(d) {
  return el("a", { className: "list-row", href: `#/deals/${d.id}` }, [
    el("span", { textContent: d.title }),
    el("div", { className: "spacer" }),
    pill(d.stage),
    el("span", { className: "muted", textContent: money(d.value) }),
  ]);
}

function editRow(label, node) {
  return el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), el("span", { className: "v" }, [node])]);
}

function followUpModal(contact, after) {
  const set = async (date) => {
    await api(`/contacts/${contact.id}`, { method: "PATCH", body: { next_follow_up: date } });
    toast(date ? `Follow-up set for ${fmtDate(date)}` : "Follow-up cleared");
    closeModal();
    after?.();
  };
  const custom = el("input", { type: "date", value: contact.next_follow_up || "", onchange: (e) => set(e.target.value) });
  openModal([
    el("h2", { textContent: `Follow up with ${contact.name.split(" ")[0]}` }),
    el("div", { className: "chips big" }, [
      ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7], ["In 2 weeks", 14], ["Next month", 30],
    ].map(([label, n]) => el("button", { className: "chip", textContent: label, onclick: () => set(addDays(n)) }))),
    el("div", { className: "row", style: "margin-top:12px" }, [el("span", { className: "muted", textContent: "Or pick a date" }), custom]),
  ], { label: "Set follow-up" });
}

function focusComposer() {
  const box = $(".composer textarea");
  box?.scrollIntoView({ behavior: "smooth", block: "center" });
  box?.focus();
}

async function renderContact(root, id) {
  await loadLookups();
  const c = await api(`/contacts/${id}`);
  $("#view-title").textContent = c.name;
  const reload = () => route();
  setActions([
    iconBtn("+ Deal", "", () => dealModal(null, { contact_id: c.id }, reload), "ghost"),
    iconBtn("Edit all", "", () => contactModal(c, reload), "ghost"),
    iconBtn("New note", "", () => templatePicker({ contact_id: c.id }), ""),
  ]);
  const save = (field, { refresh = false } = {}) => async (value) => {
    await api(`/contacts/${c.id}`, { method: "PATCH", body: { [field]: value } });
    c[field] = value;
    toast("Saved");
    if (refresh) reload();
    else if (field === "name") $("#view-title").textContent = value;
  };
  const initials = c.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const phoneHref = (c.phone || "").replace(/[^\d+]/g, "");

  const profile = card(null, [
    el("div", { className: "profile-head" }, [
      el("div", { className: "avatar", textContent: initials, "aria-hidden": "true", style: avatarStyle(c.name) }),
      el("div", { style: "min-width:0" }, [
        el("div", { className: "profile-name" }, [editable(c.name, save("name"), { placeholder: "Name" })]),
        el("div", { className: "muted" }, [c.title || "", c.title && c.company ? " at " : "", c.company_id ? link(`#/companies/${c.company_id}`, c.company) : c.company || ""]),
      ]),
    ]),
    el("div", { className: "quick-links" }, [
      c.email ? el("a", { className: "btn ghost sm", href: `mailto:${c.email}`, textContent: "✉ Email" }) : null,
      c.phone ? el("a", { className: "btn ghost sm", href: `tel:${phoneHref}`, textContent: "☎ Call" }) : null,
      c.phone ? el("a", { className: "btn ghost sm", href: `https://wa.me/${phoneHref.replace("+", "")}`, target: "_blank", rel: "noopener", textContent: "WhatsApp" }) : null,
      c.linkedin ? el("a", { className: "btn ghost sm", href: c.linkedin, target: "_blank", rel: "noopener", textContent: "in LinkedIn" }) : null,
    ]),
    editRow("Status", editable(c.status, save("status", { refresh: true }), { options: state.meta.statuses, display: (v) => pill(v) })),
    editRow("Next follow-up", el("span", { className: "row" }, [
      el("button", {
        className: "linkish" + (c.next_follow_up && c.next_follow_up <= todayIso() ? " bad" : ""),
        textContent: c.next_follow_up ? `${fmtDate(c.next_follow_up)} · ${relTime(c.next_follow_up)}` : "Set follow-up…",
        onclick: () => followUpModal(c, reload),
      }),
    ])),
    editRow("Last touch", document.createTextNode(relTime(c.last_contacted_at))),
    editRow("Title", editable(c.title, save("title"))),
    editRow("Company", editable(c.company, save("company", { refresh: true }), { list: "company-names" })),
    editRow("Email", el("span", { className: "row" }, [editable(c.email, save("email"), { type: "email" }), c.email ? iconBtn("⧉", "Copy email", () => copyText(c.email, "Email copied"), "icon") : null])),
    editRow("Phone", el("span", { className: "row" }, [editable(c.phone, save("phone"), { type: "tel" }), c.phone ? iconBtn("⧉", "Copy phone", () => copyText(c.phone, "Phone copied"), "icon") : null])),
    editRow("LinkedIn", editable(c.linkedin, save("linkedin", { refresh: true }), { type: "url", display: (v) => (v ? v.replace(/^https?:\/\/(www\.)?/, "") : "") })),
    editRow("Owner", editable(c.owner, save("owner"), { list: "owners" })),
    editRow("Source", editable(c.source, save("source"))),
    editRow("Tags", editable(c.tags, save("tags"), { display: tagsView, placeholder: "Add tags…" })),
    editRow("Background", editable(c.about, save("about"), { type: "textarea", placeholder: "Add context…" })),
    el("div", { className: "muted small", style: "margin-top:8px", textContent: `Added ${fmtDate(c.created_at)}` }),
  ]);

  const openTasks = c.tasks.filter((t) => !t.done);
  const firstOpenDeal = c.deals.find((d) => d.stale) || c.deals.find((d) => d.is_open);
  const left = el("div", { className: "stack" }, [
    profile,
    card("Deals", c.deals.length ? el("div", { className: "list" }, c.deals.map(dealMini)) : empty("No deals yet."), iconBtn("+", "New deal", () => dealModal(null, { contact_id: c.id }, reload))),
    card(`Tasks${openTasks.length ? ` (${openTasks.length})` : ""}`, [
      quickAddTask({ contact_id: c.id }, reload),
      el("ul", { className: "tasklist" }, openTasks.map((t) => taskRow(t, reload, { showSource: false }))),
    ]),
  ]);
  const right = el("div", { className: "stack" }, [
    healthPanel(c.health, {
      log: focusComposer,
      followUp: () => followUpModal(c, reload),
      deal: firstOpenDeal ? () => navigate(`#/deals/${firstOpenDeal.id}`) : null,
    }),
    card("Log activity", activityComposer({ contact_id: c.id }, reload)),
    card(`Timeline (${c.timeline.length})`, timelineView(c.timeline)),
  ]);
  root.append(el("div", { className: "detail-layout" }, [left, right]));
}

/* ----- companies */
async function renderCompanies(root) {
  await loadLookups();
  setActions([iconBtn("New company", "", () => companyModal(), "")]);
  let q = "";
  let sort = store.get("companySort", "name");
  const body = el("tbody");
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    health: (a, b) => a.health.score - b.health.score,
    renewal: (a, b) => (a.renewal_date || "9999").localeCompare(b.renewal_date || "9999"),
    mrr: (a, b) => (b.mrr || 0) - (a.mrr || 0),
  };
  const draw = () => {
    body.innerHTML = "";
    state.companies
      .filter((c) => !q || `${c.name} ${c.domain} ${c.industry} ${c.location}`.toLowerCase().includes(q))
      .sort(sorters[sort])
      .forEach((c) =>
        body.append(
          el("tr", { onclick: () => navigate(`#/companies/${c.id}`) }, [
            el("td", {}, [el("a", { className: "strong", href: `#/companies/${c.id}`, textContent: c.name }), el("div", { className: "muted small", textContent: [c.industry, c.location].filter(Boolean).join(" · ") })]),
            el("td", {}, [healthBadge(c.health)]),
            el("td", { textContent: c.mrr ? `${money(c.mrr)}/mo` : "—" }),
            el("td", { className: c.renewal_date && c.renewal_date <= addDays(60) ? "warn" : "muted", textContent: c.renewal_date ? `${fmtDate(c.renewal_date)} · ${relTime(c.renewal_date)}` : "—" }),
            el("td", { textContent: c.owner || "—", className: "muted" }),
            el("td", { textContent: c.contact_count }),
            el("td", { textContent: c.open_deals ? `${c.open_deals} · ${money(c.open_value)}` : "—" }),
            el("td", { textContent: relTime(c.last_activity_at), className: "muted" }),
          ])
        )
      );
  };
  draw();
  if (!state.companies.length) {
    root.append(el("div", { className: "card hero-empty" }, [
      el("h2", { textContent: "No companies yet" }),
      el("p", { className: "muted", textContent: "Companies are created automatically when you add contacts with a company name — or add one now to track contract value and renewal." }),
      iconBtn("Add a company", "", () => companyModal(), ""),
    ]));
    return;
  }
  root.append(
    el("div", { className: "filters" }, [
      el("input", { type: "search", "aria-label": "Filter companies", placeholder: "Filter companies…", oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }),
      el("select", { "aria-label": "Sort companies", onchange: (e) => { sort = e.target.value; store.set("companySort", sort); draw(); } },
        [["name", "Sort: name"], ["health", "Sort: health (worst first)"], ["renewal", "Sort: renewal date"], ["mrr", "Sort: contract value"]].map(([v, l]) => el("option", { value: v, textContent: l, selected: v === sort }))),
    ]),
    el("div", { className: "card flush" }, [
      el("table", { className: "table" }, [
        el("thead", {}, [el("tr", {}, ["Company", "Health", "Contract", "Renewal", "Owner", "Contacts", "Open pipeline", "Last activity"].map((h) => el("th", { textContent: h })))]),
        body,
      ]),
    ])
  );
}

async function renderCompany(root, id) {
  await loadLookups();
  const co = await api(`/companies/${id}`);
  $("#view-title").textContent = co.name;
  const reload = () => route();
  setActions([
    iconBtn("+ Contact", "", () => contactModal(null, reload, { company: co.name, owner: co.owner }), "ghost"),
    iconBtn("Edit all", "", () => companyModal(co, reload), "ghost"),
    iconBtn("New note", "", () => templatePicker({ company_id: co.id }), ""),
  ]);
  const save = (field, { refresh = false } = {}) => async (value) => {
    await api(`/companies/${co.id}`, { method: "PATCH", body: { [field]: field === "mrr" ? Number(value || 0) : value } });
    co[field] = value;
    toast("Saved");
    if (refresh) reload();
  };
  const openValue = co.deals.filter((d) => d.is_open).reduce((a, d) => a + d.value, 0);
  const won = co.deals.filter((d) => d.stage === "won").reduce((a, d) => a + d.value, 0);
  const staleDeal = co.deals.find((d) => d.stale) || co.deals.find((d) => d.is_open);
  const left = el("div", { className: "stack" }, [
    card(null, [
      el("div", { className: "profile-head" }, [
        el("div", { className: "avatar square", textContent: co.name.slice(0, 2).toUpperCase(), "aria-hidden": "true", style: avatarStyle(co.name) }),
        el("div", { style: "min-width:0" }, [
          el("div", { className: "profile-name" }, [editable(co.name, save("name"))]),
          el("div", { className: "muted", textContent: [co.industry, co.size && `${co.size} employees`].filter(Boolean).join(" · ") }),
        ]),
      ]),
      el("div", { className: "mini-stats" }, [
        el("div", {}, [el("strong", { textContent: co.mrr ? kmoney(co.mrr) : "—" }), el("span", { textContent: "per month" })]),
        el("div", {}, [el("strong", { textContent: kmoney(openValue) }), el("span", { textContent: "open pipeline" })]),
        el("div", {}, [el("strong", { textContent: kmoney(won) }), el("span", { textContent: "won" })]),
      ]),
      editRow("Contract / mo", editable(co.mrr || "", save("mrr", { refresh: true }), { type: "number", display: (v) => (Number(v) ? money(v) : "") })),
      editRow("Renewal", editable(co.renewal_date, save("renewal_date", { refresh: true }), { type: "date", display: (v) => (v ? `${fmtDate(v)} · ${relTime(v)}` : "") })),
      editRow("Website", editable(co.domain, save("domain"), { display: (v) => (v ? el("a", { href: `https://${v.replace(/^https?:\/\//, "")}`, target: "_blank", rel: "noopener", textContent: v }) : "") })),
      editRow("Industry", editable(co.industry, save("industry"))),
      editRow("Size", editable(co.size, save("size"))),
      editRow("Location", editable(co.location, save("location"))),
      editRow("Owner", editable(co.owner, save("owner"), { list: "owners" })),
      editRow("About", editable(co.about, save("about"), { type: "textarea", placeholder: "What they do, how we help…" })),
    ]),
    card(`People (${co.contacts.length})`, co.contacts.length
      ? el("div", { className: "list" }, co.contacts.map((c) => el("a", { className: "list-row", href: `#/contacts/${c.id}` }, [el("span", { textContent: c.name }), el("span", { className: "muted small", textContent: c.title }), el("div", { className: "spacer" }), pill(c.status)])))
      : empty("No contacts yet."), iconBtn("+", "Add contact", () => contactModal(null, reload, { company: co.name, owner: co.owner }))),
    card("Deals", co.deals.length ? el("div", { className: "list" }, co.deals.map(dealMini)) : empty("No deals.")),
    card("Open tasks", el("ul", { className: "tasklist" }, co.tasks.filter((t) => !t.done).map((t) => taskRow(t, reload)))),
  ]);
  const right = el("div", { className: "stack" }, [
    healthPanel(co.health, { log: focusComposer, deal: staleDeal ? () => navigate(`#/deals/${staleDeal.id}`) : null }),
    card("Log activity", activityComposer({ company_id: co.id }, reload)),
    card(`Timeline (${co.timeline.length})`, timelineView(co.timeline, { showContact: true })),
  ]);
  root.append(el("div", { className: "detail-layout" }, [left, right]));
}

/* ----- pipeline */
async function renderPipeline(root) {
  await loadLookups();
  setActions([
    el("select", { className: "inline-select", onchange: (e) => { state.pipelineOwner = e.target.value; persistFilters(); route(); } },
      [["", "All owners"], ...state.meta.owners.map((o) => [o, o])].map(([v, l]) => el("option", { value: v, textContent: l, selected: v === state.pipelineOwner }))),
    el("label", { className: "toggle" }, [el("input", { type: "checkbox", checked: state.hideClosed, onchange: (e) => { state.hideClosed = e.target.checked; persistFilters(); route(); } }), " Hide won/lost"]),
    el("a", { className: "btn ghost", href: "/api/deals/export.csv", textContent: "Export" }),
    iconBtn("New deal", "", () => dealModal(), ""),
  ]);
  const deals = state.deals.filter((d) => !state.pipelineOwner || d.owner === state.pipelineOwner);
  const stages = state.meta.stages.filter((s) => !state.hideClosed || !["won", "lost"].includes(s));
  const open = deals.filter((d) => d.is_open);
  root.append(
    el("div", { className: "pipeline-summary" }, [
      el("span", {}, [el("strong", { textContent: money(open.reduce((a, d) => a + d.value, 0)) }), " open"]),
      el("span", {}, [el("strong", { textContent: money(open.reduce((a, d) => a + d.weighted_value, 0)) }), " weighted"]),
      el("span", {}, [el("strong", { textContent: open.filter((d) => d.stale).length }), " going cold"]),
      el("span", {}, [el("strong", { textContent: open.filter((d) => d.overdue_close).length }), " past close date"]),
    ])
  );
  const board = el("div", { className: "board", style: `grid-template-columns:repeat(${stages.length}, minmax(170px, 1fr))` });
  for (const stage of stages) {
    const inStage = deals.filter((d) => d.stage === stage);
    const col = el("div", { className: `col st-${stage}` }, [
      el("div", { className: "col-head" }, [
        el("div", { className: "row between" }, [el("strong", { textContent: stage }), el("span", { className: "muted", textContent: `${inStage.length}` })]),
        el("div", { className: "muted small", textContent: `${money(inStage.reduce((a, d) => a + d.value, 0))} · ${state.meta.stage_probability[stage]}%` }),
      ]),
    ]);
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("drag-over"); };
    col.ondragleave = () => col.classList.remove("drag-over");
    col.ondrop = (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const deal = state.deals.find((d) => d.id === Number(e.dataTransfer.getData("text/plain")));
      if (deal) moveDeal(deal, stage);
    };
    for (const d of inStage) {
      const flags = [];
      if (d.stale) flags.push(el("span", { className: "flag bad", textContent: `${d.days_since_activity}d quiet` }));
      if (d.overdue_close) flags.push(el("span", { className: "flag warn", textContent: "past close" }));
      const c = el("div", { className: "deal", draggable: true, onclick: () => navigate(`#/deals/${d.id}`) }, [
        el("div", { className: "title", textContent: d.title }),
        el("div", { className: "meta" }, [el("span", { textContent: d.company_name || d.contact_name || "Unassigned" }), el("strong", { textContent: money(d.value) })]),
        d.next_step && d.is_open ? el("div", { className: "next", textContent: "→ " + d.next_step }) : null,
        d.stage === "lost" && d.lost_reason ? el("div", { className: "next", textContent: "✕ " + d.lost_reason }) : null,
        el("div", { className: "meta" }, [
          el("span", { textContent: [d.close_date && `close ${fmtDate(d.close_date)}`, d.is_open && `${d.days_in_stage}d in stage`].filter(Boolean).join(" · ") }),
          el("span", { textContent: d.owner || "" }),
        ]),
        flags.length ? el("div", { className: "flags" }, flags) : null,
        el("select", {
          className: "move",
          "aria-label": `Move ${d.title} to stage`,
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => moveDeal(d, e.target.value),
        }, state.meta.stages.map((st) => el("option", { value: st, textContent: st === d.stage ? `Stage: ${st}` : `Move to ${st}`, selected: st === d.stage }))),
      ]);
      c.ondragstart = (e) => e.dataTransfer.setData("text/plain", String(d.id));
      col.append(c);
    }
    col.append(el("button", { className: "add-card", textContent: "+ Add deal", onclick: () => dealModal(null, { stage }) }));
    board.append(col);
  }
  root.append(board);
}

async function renderDeal(root, id) {
  await loadLookups();
  const d = await api(`/deals/${id}`);
  $("#view-title").textContent = d.title;
  const reload = () => route();
  const save = (field, refresh = false) => async (value) => {
    const body = { [field]: ["value", "probability"].includes(field) ? (value === "" ? null : Number(value)) : value };
    await api(`/deals/${d.id}`, { method: "PATCH", body });
    toast("Saved");
    if (refresh) reload();
  };
  setActions([
    iconBtn("Edit", "", () => dealModal(d, {}, reload), "ghost"),
    iconBtn("New note", "", () => templatePicker({ deal_id: d.id, contact_id: d.contact_id }), ""),
  ]);
  const stageBar = el("div", { className: "stage-bar" }, state.meta.stages.map((s) =>
    el("button", {
      className: "stage-step" + (s === d.stage ? " current" : "") + (state.meta.stages.indexOf(s) < state.meta.stages.indexOf(d.stage) && d.stage !== "lost" ? " passed" : "") + ` st-${s}`,
      textContent: s,
      onclick: () => moveDeal(d, s),
    })
  ));
  const left = el("div", { className: "stack" }, [
    card(null, [
      el("div", { className: "profile-name" }, [editable(d.value, save("value", true), { type: "number", display: (v) => money(v) })]),
      el("div", { className: "muted", textContent: `${d.probability}% · weighted ${money(d.weighted_value)}` }),
      editRow("Deal", editable(d.title, save("title"))),
      editRow("Next step", editable(d.next_step, save("next_step"), { placeholder: "What happens next?" })),
      editRow("Expected close", editable(d.close_date, save("close_date", true), { type: "date", display: (v) => (v ? `${fmtDate(v)} · ${relTime(v)}` : "") })),
      editRow("Probability", editable(d.probability, save("probability", true), { type: "number", display: (v) => `${v}%` })),
      editRow("Owner", editable(d.owner, save("owner"), { list: "owners" })),
      detailRow("Contact", d.contact_id ? link(`#/contacts/${d.contact_id}`, d.contact_name) : null),
      detailRow("Company", d.company_id ? link(`#/companies/${d.company_id}`, d.company_name) : null),
      detailRow("In stage", `${d.days_in_stage} days`),
      detailRow("Last activity", relTime(d.last_activity_at)),
      d.stage === "lost" ? editRow("Lost reason", editable(d.lost_reason, save("lost_reason"))) : null,
    ]),
    card("Tasks", [
      quickAddTask({ deal_id: d.id, contact_id: d.contact_id }, reload),
      el("ul", { className: "tasklist" }, d.tasks.filter((t) => !t.done).map((t) => taskRow(t, reload, { showSource: false }))),
    ]),
    card("Notes", d.notes.length ? el("div", { className: "list" }, d.notes.map((n) => el("a", { className: "list-row", href: `#/notes/${n.id}` }, [el("span", { textContent: n.title }), el("div", { className: "spacer" }), el("span", { className: "muted", textContent: relTime(n.updated_at) })]))) : empty("No notes.")),
  ]);
  const right = el("div", { className: "stack" }, [
    stageBar,
    card("Log activity", activityComposer({ deal_id: d.id, contact_id: d.contact_id }, reload)),
    card("Timeline", timelineView(d.timeline)),
  ]);
  root.append(el("div", { className: "detail-layout" }, [left, right]));
}

/* ----- notes */
function renderMarkdown(text) {
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/(^|\s)#([A-Za-z][\w-]*)/g, '$1<span class="tag">#$2</span>')
      .replace(/(^|\s)(@\S+|!high|!urgent|!low)/g, '$1<span class="token">$2</span>')
      .replace(/^\[(\d{1,2}:\d{2})\]/, '<span class="stamp">$1</span>');
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of escapeHtml(text).split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*(?:[-*]\s*)?\[( |x|X)\]\s*(.+)$/))) {
      closeList();
      const done = m[1].toLowerCase() === "x";
      out.push(`<div class="md-task ${done ? "done" : ""}">${done ? "☑" : "☐"} ${inline(m[2])}</div>`);
    } else if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      closeList();
      out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      out.push("<hr />");
    } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if (!line.trim()) {
      closeList();
      out.push('<div class="md-gap"></div>');
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

let noteSaver = null; // flush pending autosave before navigating away

async function renderNotes(root, id) {
  await loadLookups();
  const f = state.notesFilter;
  setActions([iconBtn("New note", "N", () => templatePicker(), "")]);
  const notes = await api(`/notes?q=${encodeURIComponent(f.q)}&kind=${f.kind}`);
  const activeId = id ? Number(id) : notes[0]?.id;
  if (!id && activeId) return navigate(`#/notes/${activeId}`, true);

  const listWrap = el("div", { className: "note-list" });
  const drawList = (items) => {
    listWrap.innerHTML = "";
    if (!items.length) listWrap.append(empty("No notes found."));
    for (const n of items) {
      listWrap.append(
        el("a", { className: "note-item" + (n.id === activeId ? " active" : ""), href: `#/notes/${n.id}` }, [
          el("div", { className: "t" }, [n.pinned ? "★ " : "", n.title]),
          el("div", { className: "s" }, [
            el("span", { className: `kind k-${n.kind}`, textContent: n.kind }),
            " " + [n.contact_name || n.company_name || "", relTime(n.meeting_date || n.updated_at)].filter(Boolean).join(" · "),
            n.open_tasks ? el("span", { className: "badge", textContent: `${n.open_tasks} open` }) : null,
          ]),
          el("div", { className: "s preview", textContent: n.body.replace(/[#\[\]x*]/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "Empty" }),
        ])
      );
    }
  };
  drawList(notes);
  let searchTimer;
  const side = el("div", { className: "notes-side" }, [
    el("div", { className: "filters compact" }, [
      el("input", {
        name: "noteq",
        placeholder: "Search notes…",
        value: f.q,
        oninput: (e) => {
          f.q = e.target.value;
          persistFilters();
          clearTimeout(searchTimer);
          searchTimer = setTimeout(async () => drawList(await api(`/notes?q=${encodeURIComponent(f.q)}&kind=${f.kind}`)), 200);
        },
      }),
      el("select", { "aria-label": "Note type", onchange: (e) => { f.kind = e.target.value; persistFilters(); route(); } }, [["", "All"], ...state.meta.note_kinds.map((k) => [k, k])].map(([v, l]) => el("option", { value: v, textContent: l, selected: v === f.kind }))),
    ]),
    listWrap,
  ]);

  const layout = el("div", { className: "notes-layout" }, [side]);
  root.append(layout);
  if (!activeId) {
    layout.append(el("div", { className: "card" }, [empty("No notes yet."), el("div", { style: "text-align:center" }, [iconBtn("Create your first note", "", () => templatePicker(), "")])]));
    return;
  }
  const note = await api(`/notes/${activeId}`);
  layout.append(noteEditor(note, (updated) => {
    const item = notes.find((n) => n.id === updated.id);
    if (item) Object.assign(item, updated);
    drawList(notes);
  }));
}

function noteEditor(note, onSaved) {
  let dirty = false;
  let timer;
  const status = el("span", { className: "hint save-status", textContent: `Saved ${relTime(note.updated_at)}` });
  const title = el("input", { className: "note-title", value: note.title, placeholder: "Title" });
  const kind = el("select", {}, state.meta.note_kinds.map((k) => el("option", { value: k, textContent: k, selected: k === note.kind })));
  const contact = el("select", {}, contactOptions().map(([v, l]) => el("option", { value: v, textContent: l, selected: String(v) === String(note.contact_id ?? "") })));
  const deal = el("select");
  const fillDeals = () => {
    const current = deal.value || note.deal_id;
    deal.innerHTML = "";
    dealOptions(contact.value).forEach(([v, l]) => deal.append(el("option", { value: v, textContent: l, selected: String(v) === String(current ?? "") })));
  };
  fillDeals();
  const date = el("input", { type: "date", value: note.meeting_date || "" });
  const attendees = el("input", { value: note.attendees || "", placeholder: "Dana, Sam (procurement)…" });
  const body = el("textarea", {
    className: "note-body",
    value: note.body,
    spellcheck: true,
    placeholder: "Type notes… \n\n## Headings, - bullets, **bold**\n[ ] Action item @fri !high  → becomes a task\n#tags  ·  Alt+T inserts a timestamp",
  });
  const preview = el("div", { className: "md-preview" });
  const drawPreview = () => (preview.innerHTML = renderMarkdown(body.value) || '<span class="hint">Nothing yet.</span>');
  drawPreview();

  const payload = () => ({
    title: title.value || "Untitled note",
    body: body.value,
    kind: kind.value,
    contact_id: optionalId(contact.value),
    deal_id: optionalId(deal.value),
    meeting_date: date.value,
    attendees: attendees.value,
  });
  const save = async () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    status.textContent = "Saving…";
    try {
      const saved = await api(`/notes/${note.id}`, { method: "PATCH", body: payload() });
      Object.assign(note, saved);
      status.textContent = "Saved";
      onSaved?.(saved);
      drawTasks();
    } catch {
      dirty = true;
      status.textContent = "Save failed — retrying on next edit";
    }
  };
  noteSaver = save;
  const changed = (delay = 700) => {
    dirty = true;
    status.textContent = "Editing…";
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  };
  title.oninput = () => changed();
  attendees.oninput = () => changed();
  body.oninput = () => {
    drawPreview();
    changed();
  };
  [kind, deal, date].forEach((i) => (i.onchange = () => changed(0)));
  contact.onchange = () => {
    fillDeals();
    changed(0);
  };

  const insertAtCursor = (text) => {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const before = value.slice(0, s);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    body.value = before + prefix + text + value.slice(e);
    const pos = (before + prefix + text).length;
    body.setSelectionRange(pos, pos);
    body.focus();
    drawPreview();
    changed();
  };
  const stamp = () => insertAtCursor(`[${new Date().toTimeString().slice(0, 5)}] `);
  body.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      dirty = true;
      save();
    } else if (e.altKey && (e.key === "t" || e.key === "†")) {
      e.preventDefault();
      stamp();
    } else if (e.key === "Enter" && !e.shiftKey) {
      // continue checklists and bullets on Enter
      const lineStart = body.value.lastIndexOf("\n", body.selectionStart - 1) + 1;
      const line = body.value.slice(lineStart, body.selectionStart);
      const m = line.match(/^(\s*)(\[[ xX]\]\s|[-*]\s)(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[3].trim()) {
          body.setRangeText("", lineStart, body.selectionStart, "end");
          insertAtCursor("");
        } else {
          body.setRangeText("\n" + m[1] + (m[2].startsWith("[") ? "[ ] " : m[2]), body.selectionStart, body.selectionEnd, "end");
          drawPreview();
          changed();
        }
      }
    }
  };

  /* meeting timer */
  let timerStart = null;
  let tick;
  const timerBtn = el("button", { className: "btn ghost sm", textContent: "⏱ Start meeting" });
  timerBtn.onclick = () => {
    if (!timerStart) {
      timerStart = Date.now();
      if (!date.value) date.value = todayIso();
      insertAtCursor(`[${new Date().toTimeString().slice(0, 5)}] Meeting started`);
      tick = setInterval(() => {
        const s = Math.floor((Date.now() - timerStart) / 1000);
        timerBtn.textContent = `■ ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);
      timerBtn.classList.add("recording");
    } else {
      clearInterval(tick);
      const mins = Math.max(1, Math.round((Date.now() - timerStart) / 60000));
      insertAtCursor(`[${new Date().toTimeString().slice(0, 5)}] Meeting ended (${mins} min)`);
      api(`/notes/${note.id}`, { method: "PATCH", body: { duration_min: mins } });
      timerStart = null;
      timerBtn.textContent = "⏱ Start meeting";
      timerBtn.classList.remove("recording");
    }
  };

  /* dictation (Web Speech API) */
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = el("button", { className: "btn ghost sm", textContent: "🎙 Dictate", disabled: !Speech, title: Speech ? "Dictate into the note (browser speech recognition)" : "Dictation needs Chrome, Edge or Safari" });
  let recognizer = null;
  const interim = el("div", { className: "interim" });
  micBtn.onclick = () => {
    if (recognizer) {
      recognizer.stop();
      return;
    }
    recognizer = new Speech();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = navigator.language || "en-US";
    recognizer.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) {
          const sentence = text.charAt(0).toUpperCase() + text.slice(1);
          insertAtCursor(`${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`);
        } else pending += text + " ";
      }
      interim.textContent = pending;
    };
    recognizer.onend = () => {
      recognizer = null;
      interim.textContent = "";
      micBtn.textContent = "🎙 Dictate";
      micBtn.classList.remove("recording");
    };
    recognizer.onerror = (e) => toast(`Dictation: ${e.error}`, "error");
    recognizer.start();
    micBtn.textContent = "■ Stop dictation";
    micBtn.classList.add("recording");
  };

  /* view mode */
  let mode = (() => { try { return localStorage.getItem("noteMode"); } catch { return null; } })() || "write";
  const bodyWrap = el("div", { className: "note-panes" }, [body, preview]);
  const modeTabs = el("div", { className: "tabs small" });
  const setMode = (m) => {
    mode = m;
    try { localStorage.setItem("noteMode", m); } catch {}
    bodyWrap.dataset.mode = m;
    modeTabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  };
  ["write", "split", "preview"].forEach((m) => modeTabs.append(el("button", { type: "button", textContent: m, dataset: { mode: m }, onclick: () => setMode(m) })));
  setMode(mode);

  const pinBtn = el("button", {
    className: "btn ghost sm",
    textContent: note.pinned ? "★ Pinned" : "☆ Pin",
    onclick: async () => {
      const saved = await api(`/notes/${note.id}`, { method: "PATCH", body: { pinned: !note.pinned } });
      note.pinned = saved.pinned;
      pinBtn.textContent = note.pinned ? "★ Pinned" : "☆ Pin";
      onSaved?.(saved);
    },
  });

  const editor = el("div", { className: "card editor" }, [
    el("div", { className: "row" }, [title, status]),
    el("div", { className: "note-meta" }, [
      el("label", {}, ["Type", kind]),
      el("label", {}, ["Contact", contact]),
      el("label", {}, ["Deal", deal]),
      el("label", {}, ["Date", date]),
      el("label", { className: "wide" }, ["Attendees", attendees]),
    ]),
    el("div", { className: "row wrap toolbar" }, [
      timerBtn,
      micBtn,
      iconBtn("⌚ Timestamp", "Alt+T", stamp),
      iconBtn("☐ Action item", "", () => insertAtCursor("[ ] ")),
      el("div", { className: "spacer" }),
      modeTabs,
    ]),
    interim,
    bodyWrap,
    el("div", { className: "row wrap", style: "margin-top:10px" }, [
      el("span", { className: "hint", textContent: "“[ ] Send deck @fri !high” → task with due date & priority. Ctrl+S saves." }),
      el("div", { className: "spacer" }),
      pinBtn,
      el("a", { className: "btn ghost sm", href: `/api/notes/${note.id}/export.md`, textContent: "⤓ Export" }),
      armedButton("Delete", async () => {
        dirty = false;
        await api(`/notes/${note.id}`, { method: "DELETE" });
        toast("Note deleted");
        navigate("#/notes");
      }, "btn danger sm"),
    ]),
  ]);

  /* right panel: AI summary + action items */
  const tasksBox = el("ul", { className: "tasklist" });
  async function drawTasks() {
    const mine = (await api(`/notes/${note.id}`)).tasks;
    tasksBox.innerHTML = "";
    if (!mine.length) tasksBox.append(el("li", { className: "muted small", textContent: "Checklist lines in the note appear here." }));
    mine.forEach((t) =>
      tasksBox.append(
        taskRow(t, async () => {
          const n = await api(`/notes/${note.id}`);
          body.value = n.body;
          drawPreview();
          drawTasks();
        }, { showSource: false })
      )
    );
  }
  drawTasks();

  const summaryBox = el("div", { className: "summary" });
  const drawSummary = (s) => {
    summaryBox.innerHTML = "";
    if (!s) {
      summaryBox.append(el("div", { className: "muted small", textContent: "Generate a summary with decisions, risks, action items and the next step." }));
      return;
    }
    const section = (label, items) =>
      items?.length ? el("div", { className: "sum-sec" }, [el("div", { className: "sum-label", textContent: label }), el("ul", {}, items.map((i) => el("li", { textContent: i })))]) : null;
    const picks = s.action_items.map((a) => ({ a, box: el("input", { type: "checkbox", checked: true }) }));
    summaryBox.append(
      el("div", { className: "row" }, [pill(s.sentiment), el("span", { className: "muted small", textContent: `${s.engine === "claude" ? "Claude" : "Offline"} · ${relTime(s.generated_at)}` })]),
      el("p", { className: "sum-text", textContent: s.summary }),
      s.next_step ? el("div", { className: "next-step" }, [el("span", { className: "sum-label", textContent: "Next step" }), el("div", { textContent: s.next_step })]) : null,
      section("Decisions", s.decisions),
      section("Risks & objections", s.risks),
      picks.length
        ? el("div", { className: "sum-sec" }, [
            el("div", { className: "sum-label", textContent: "Suggested action items" }),
            ...picks.map(({ a, box }) =>
              el("label", { className: "pick" }, [box, el("span", { textContent: a.text + (a.owner ? ` (${a.owner})` : "") + (a.due_date ? ` · ${fmtDate(a.due_date)}` : "") })])
            ),
            el("button", {
              className: "btn sm",
              textContent: "Add selected to note as tasks",
              onclick: async () => {
                await save();
                const items = picks.filter((p) => p.box.checked).map((p) => p.a);
                const r = await api(`/notes/${note.id}/actions`, { method: "POST", body: { items } });
                body.value = r.note.body;
                drawPreview();
                drawTasks();
                toast(r.added ? `${r.added} action item(s) added` : "Already in the note");
              },
            }),
          ])
        : null
    );
  };
  let existing = null;
  try {
    existing = note.summary ? JSON.parse(note.summary) : null;
  } catch {}
  drawSummary(existing);
  const aiLabel = state.meta.ai_enabled ? "✨ Summarize with Claude" : "✨ Summarize";
  const sumBtn = el("button", {
    className: "btn sm",
    textContent: aiLabel,
    onclick: async () => {
      dirty = true;
      await save();
      sumBtn.disabled = true;
      sumBtn.textContent = "Summarizing…";
      try {
        drawSummary(await api(`/notes/${note.id}/summarize`, { method: "POST" }));
      } finally {
        sumBtn.disabled = false;
        sumBtn.textContent = aiLabel;
      }
    },
  });

  const recapBtn = el("button", {
    className: "btn ghost sm",
    textContent: "✉ Draft client recap",
    title: "Client-facing follow-up email built from this note",
    onclick: async () => {
      dirty = true;
      await save();
      recapBtn.disabled = true;
      recapBtn.textContent = "Drafting…";
      try {
        recapModal(note, await api(`/notes/${note.id}/recap`, { method: "POST" }));
      } finally {
        recapBtn.disabled = false;
        recapBtn.textContent = "✉ Draft client recap";
      }
    },
  });
  const panel = el("div", { className: "stack note-panel" }, [
    card("Summary", summaryBox, sumBtn),
    card("Follow through", [
      el("p", { className: "muted small", style: "margin:0 0 8px", textContent: "Send the recap while the meeting is fresh — same-day recaps keep deals moving." }),
      el("div", { className: "row wrap" }, [
        recapBtn,
        note.contact_id ? iconBtn("Open contact →", "", () => navigate(`#/contacts/${note.contact_id}`)) : null,
      ]),
    ]),
    card("Action items", tasksBox),
  ]);

  return el("div", { className: "note-main" }, [editor, panel]);
}

function recapModal(note, draft) {
  const to = el("input", { type: "email", value: draft.to || "", placeholder: "client@company.com" });
  const subject = el("input", { value: draft.subject });
  const body = el("textarea", { value: draft.body, rows: 14, className: "recap-body" });
  const mailto = () =>
    `mailto:${encodeURIComponent(to.value)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
  const logSent = async () => {
    await api("/activities", {
      method: "POST",
      body: { type: "email", subject: subject.value, body: body.value, outcome: "sent", contact_id: draft.contact_id, deal_id: draft.deal_id },
    });
    toast("Recap logged on the timeline");
    closeModal();
  };
  openModal([
    el("h2", { textContent: "Client recap email" }),
    el("div", { className: "muted small", style: "margin-bottom:10px", textContent: draft.engine === "claude" ? "Drafted by Claude from your notes — internal risks and opinions are left out. Review before sending." : "Drafted from your notes and summary — internal risks are left out. Review before sending." }),
    el("div", { className: "field" }, [el("label", { textContent: "To" }), to]),
    el("div", { className: "field" }, [el("label", { textContent: "Subject" }), subject]),
    el("div", { className: "field" }, [el("label", { textContent: "Message" }), body]),
    el("div", { className: "row wrap" }, [
      el("a", { className: "btn", href: "#", textContent: "Open in email app", onclick: (e) => { e.preventDefault(); window.location.href = mailto(); } }),
      iconBtn("Copy text", "", () => copyText(`Subject: ${subject.value}\n\n${body.value}`, "Recap copied"), "ghost"),
      el("div", { className: "spacer" }),
      draft.contact_id ? iconBtn("Mark as sent", "Log this email on the contact's timeline", logSent, "ghost") : null,
    ]),
  ], { wide: true, label: "Client recap email" });
}

/* ----- tasks */
async function renderTasks(root) {
  await loadLookups();
  setActions([iconBtn("Log activity", "L", () => logActivityModal(), "ghost")]);
  const tasks = await api("/tasks");
  const t0 = todayIso();
  const week = addDays(7);
  const open = tasks.filter((t) => !t.done);
  const groups = [
    ["Overdue", open.filter((t) => t.due_date && t.due_date < t0), "bad"],
    ["Today", open.filter((t) => t.due_date === t0), "warn"],
    ["Next 7 days", open.filter((t) => t.due_date > t0 && t.due_date <= week), ""],
    ["Later", open.filter((t) => t.due_date > week), ""],
    ["No date", open.filter((t) => !t.due_date), ""],
    ["Completed", tasks.filter((t) => t.done).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")).slice(0, 25), "muted"],
  ];
  const reload = () => route();
  const contactSel = el("select", { className: "inline-select" }, contactOptions().map(([v, l]) => el("option", { value: v, textContent: v ? l : "No contact" })));
  const add = el("div", { className: "card" }, [
    el("div", { className: "row" }, [
      el("input", {
        className: "quick-add",
        placeholder: "Add a task… “Call Marcus @tomorrow !high”, “Send SOW @2026-10-12”, “Prep QBR @fri” — Enter to add",
        onkeydown: async (e) => {
          if (e.key !== "Enter" || !e.target.value.trim()) return;
          await api("/tasks", { method: "POST", body: { text: e.target.value, contact_id: optionalId(contactSel.value) } });
          toast("Task added");
          reload();
        },
      }),
      contactSel,
    ]),
  ]);
  root.append(add);
  for (const [label, items, cls] of groups) {
    if (!items.length && !["Today", "Overdue"].includes(label)) continue;
    root.append(
      el("div", { className: "card task-group" }, [
        el("div", { className: "card-head" }, [el("h3", { className: cls, textContent: `${label}` }), el("span", { className: "muted", textContent: items.length })]),
        items.length ? el("ul", { className: "tasklist" }, items.map((t) => taskRow(t, reload))) : el("div", { className: "muted small", textContent: label === "Overdue" ? "Nothing overdue." : "Nothing due today." }),
      ])
    );
  }
}

/* --------------------------------------------------------------- router */
const VIEWS = {
  dashboard: { title: "Home", render: renderDashboard },
  contacts: { title: "Contacts", render: renderContacts, detail: renderContact },
  companies: { title: "Companies", render: renderCompanies, detail: renderCompany },
  pipeline: { title: "Pipeline", render: renderPipeline },
  deals: { title: "Deal", render: renderPipeline, detail: renderDeal, nav: "pipeline" },
  notes: { title: "Notes", render: renderNotes, detail: renderNotes },
  tasks: { title: "Today & tasks", render: renderTasks },
};

function setActions(nodes) {
  const box = $("#top-actions");
  box.innerHTML = "";
  nodes.filter(Boolean).forEach((n) => box.append(n));
}

function navigate(hash, replace = false) {
  if (replace) {
    try {
      history.replaceState(null, "", hash);
    } catch {
      return void location.replace(hash);
    }
  }
  else if (location.hash !== hash) return void (location.hash = hash);
  route();
}

let routing = 0;
async function route() {
  const token = ++routing;
  if (noteSaver) {
    const flush = noteSaver;
    noteSaver = null;
    await flush();
  }
  const [, view = "", id = null] = (location.hash || "#/").split("/");
  const name = VIEWS[view] ? view : "dashboard";
  const cfg = VIEWS[name];
  state.route = { view: name, id };
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === (cfg.nav || name)));
  $("#view-title").textContent = cfg.title;
  const root = el("div", { className: `view view-${name}` });
  try {
    if (!state.meta) await loadLookups();
    if (id && cfg.detail) await cfg.detail(root, id);
    else await cfg.render(root);
  } catch (err) {
    console.error(err);
    root.append(empty(`Could not load this page: ${err.message}`));
  }
  if (token !== routing) return;
  if (id && ["contacts", "companies", "deals", "notes"].includes(name)) {
    const kind = { contacts: "Contact", companies: "Company", deals: "Deal", notes: "Note" }[name];
    const label = name === "notes" ? $(".note-title", root)?.value : $("#view-title").textContent;
    if (label) rememberRecent(`#/${name}/${id}`, label, kind);
  }
  const content = $("#content");
  content.innerHTML = "";
  content.append(root);
  content.focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("crm:route", { detail: { ...state.route } }));
  window.scrollTo(0, 0);
  refreshCounts().catch(() => {});
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => noteSaver?.());

/* ------------------------------------------------------- command palette */
function rememberRecent(href, label, kind) {
  const recent = store.get("recent", []).filter((r) => r.href !== href);
  recent.unshift({ href, label, kind });
  store.set("recent", recent.slice(0, 6));
}

function cycleTheme() {
  const order = ["system", "light", "dark"];
  const next = order[(order.indexOf(store.get("theme", "system")) + 1) % order.length];
  store.set("theme", next);
  applyTheme(next);
  toast(`Theme: ${next}`);
}

function paletteActions() {
  const { view, id } = state.route;
  const links = view === "contacts" && id ? { contact_id: Number(id) } : view === "deals" && id ? { deal_id: Number(id) } : view === "companies" && id ? { company_id: Number(id) } : {};
  return [
    ["Ask Copilot", "⌘J", () => window.Copilot?.open()],
    ["New note from template", "N", () => templatePicker(links)],
    ["Log call / email / meeting", "L", () => logActivityModal(links)],
    ["New contact", "", () => contactModal()],
    ["New deal", "", () => dealModal(null, links)],
    ["New company", "", () => companyModal()],
    ["Go to Dashboard", "G D", () => navigate("#/")],
    ["Go to Today & tasks", "G T", () => navigate("#/tasks")],
    ["Go to Notes", "G N", () => navigate("#/notes")],
    ["Go to Pipeline", "G P", () => navigate("#/pipeline")],
    ["Go to Contacts", "G C", () => navigate("#/contacts")],
    ["Go to Companies", "G O", () => navigate("#/companies")],
    ["Import contacts from CSV", "", () => navigate("#/contacts")],
    ["Switch theme (system / light / dark)", "", cycleTheme],
    ["Keyboard shortcuts", "?", () => shortcutsHelp()],
    ...(isInstalled() || window.__SEED__ ? [] : [["Install the app on this device", "", installApp]]),
    ...(window.__SEED__ ? [] : [["Sign out", "", signOut]]),
  ].map(([label, hint, run]) => ({ label, hint, run, group: "Actions" }));
}

function openPalette() {
  const input = el("input", { type: "search", className: "palette-input", placeholder: "Type a name, company, deal, note — or a command…", "aria-label": "Search or run a command", autocomplete: "off" });
  const list = el("div", { className: "palette-list", role: "listbox" });
  let items = [];
  let active = 0;
  let timer;
  let seq = 0;

  const draw = () => {
    list.innerHTML = "";
    let group = null;
    items.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        list.append(el("div", { className: "group", textContent: group }));
      }
      list.append(
        el("button", {
          className: "palette-item" + (i === active ? " active" : ""),
          role: "option",
          "aria-selected": String(i === active),
          onmousemove: () => { if (active !== i) { active = i; draw(); } },
          onclick: () => run(item),
        }, [
          el("span", { className: "p-label", textContent: item.label }),
          item.sub ? el("span", { className: "muted small p-sub", textContent: item.sub }) : null,
          el("div", { className: "spacer" }),
          item.hint ? el("kbd", { textContent: item.hint }) : null,
        ])
      );
    });
    if (!items.length) list.append(el("div", { className: "group", textContent: "No matches — try a different spelling" }));
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  const run = (item) => {
    closeModal();
    item.href ? navigate(item.href) : item.run();
  };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    const actions = paletteActions().filter((a) => !q || a.label.toLowerCase().includes(q));
    if (!q) {
      const recent = store.get("recent", []).map((r) => ({ label: r.label, sub: r.kind, href: r.href, group: "Recently viewed" }));
      items = [...recent, ...actions];
      active = 0;
      return draw();
    }
    items = actions.slice(0, 4);
    active = 0;
    draw();
    clearTimeout(timer);
    const mine = ++seq;
    timer = setTimeout(async () => {
      const r = await api(`/search?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      const found = [
        ...r.contacts.map((c) => ({ label: c.name, sub: [c.title, c.company].filter(Boolean).join(" · "), href: `#/contacts/${c.id}`, group: "Contacts" })),
        ...r.companies.map((c) => ({ label: c.name, sub: c.industry, href: `#/companies/${c.id}`, group: "Companies" })),
        ...r.deals.map((d) => ({ label: d.title, sub: `${d.stage} · ${money(d.value)}`, href: `#/deals/${d.id}`, group: "Deals" })),
        ...r.notes.map((n) => ({ label: n.title, sub: n.snippet && `…${n.snippet}…`, href: `#/notes/${n.id}`, group: "Notes" })),
        ...r.tasks.map((t) => ({ label: t.text, sub: t.due_date && `due ${fmtDate(t.due_date)}`, href: "#/tasks", group: "Tasks" })),
      ];
      items = [...found, ...actions];
      active = 0;
      draw();
    }, 120);
  };
  input.oninput = update;
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); run(items[active]); }
  };
  const box = openModal([input, list, el("div", { className: "palette-foot muted small" }, [el("kbd", { textContent: "↑↓" }), " navigate  ", el("kbd", { textContent: "Enter" }), " open  ", el("kbd", { textContent: "Esc" }), " close"])], { label: "Command palette" });
  box.classList.add("palette");
  box.parentElement.classList.add("top");
  input.focus();
  update();
}

$("#search").onclick = openPalette;
$("#theme-toggle").onclick = cycleTheme;
applyTheme(store.get("theme", "system"));

/* ------------------------------------------------------------ shortcuts */
function shortcutsHelp() {
  const rows = [
    ["⌘/Ctrl + K  or  /", "Search & command bar"],
    ["N", "New note (pick a template)"],
    ["L", "Log a call / email / meeting"],
    ["G then D / T / N / P / C / O", "Go to Dashboard / Tasks / Notes / Pipeline / Contacts / Companies"],
    ["Ctrl + S", "Save note now"],
    ["Alt + T", "Insert timestamp in a note"],
    ["Ctrl + Enter", "Save activity"],
    ["Esc", "Close dialog"],
  ];
  openModal([el("h2", { textContent: "Keyboard shortcuts" }), el("div", { className: "list" }, rows.map(([k, v]) => el("div", { className: "list-row" }, [el("kbd", { textContent: k }), el("div", { className: "spacer" }), el("span", { textContent: v })])))]);
}

let gPending = false;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!closeModal()) openPalette();
    return;
  }
  if (e.key === "Escape") return closeModal();
  if ($("#modal-root").children.length) return;
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (gPending) {
    gPending = false;
    const dest = { d: "#/", t: "#/tasks", n: "#/notes", p: "#/pipeline", c: "#/contacts", o: "#/companies" }[key];
    if (dest) navigate(dest);
    return;
  }
  if (key === "g") {
    gPending = true;
    setTimeout(() => (gPending = false), 1200);
  } else if (key === "n") {
    e.preventDefault();
    templatePicker();
  } else if (key === "l") {
    e.preventDefault();
    const { view, id } = state.route;
    const links = view === "contacts" && id ? { contact_id: Number(id) } : view === "deals" && id ? { deal_id: Number(id) } : view === "companies" && id ? { company_id: Number(id) } : {};
    logActivityModal(links);
  } else if (key === "?") {
    shortcutsHelp();
  } else if (key === "/") {
    e.preventDefault();
    openPalette();
  }
});

route();

/* Installable app (PWA): register the service worker when served by the CRM itself. */
const canInstall = location.protocol === "https:" || location.hostname === "localhost";
if ("serviceWorker" in navigator && canInstall && !window.__SEED__) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function signOut() {
  await fetch("/logout", { method: "POST" }).catch(() => {});
  location.href = "/login";
}
