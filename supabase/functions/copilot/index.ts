// Vanguard Copilot: an agentic assistant for the document register, powered by Azure OpenAI
// (Azure AI Foundry). It runs a tool-calling loop, but every tool runs AS THE SIGNED-IN USER, so
// the database's row-level security decides what is allowed. The Case File is never exposed.
//
// Read tools run immediately. Write tools are paused and returned as `pending` so the person
// approves them in the app, then the app calls back with `decisions`.
//
// Secrets (supabase secrets set ...):
//   AZURE_OPENAI_ENDPOINT     https://<resource>.openai.azure.com
//   AZURE_OPENAI_API_KEY      key from Azure AI Foundry / Azure portal
//   AZURE_OPENAI_DEPLOYMENT   the deployment name of your chat model
//   AZURE_OPENAI_API_VERSION  optional, defaults to 2024-10-21
//   AZURE_CONTENT_SAFETY_ENDPOINT / AZURE_CONTENT_SAFETY_KEY
//                             optional. When set, every turn passes Azure AI Content Safety
//                             Prompt Shields first (blocks jailbreaks and instructions hidden
//                             inside document text).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const STATUSES = ["Draft", "Active", "In review", "Expired", "Archived"];
const READ = new Set(["list_modules", "search_documents", "get_document", "register_overview"]);
const WRITE = new Set(["create_module", "create_company", "create_document", "update_document", "update_module", "bulk_update_documents"]);
const MAX_STEPS = 8;

// deno-lint-ignore no-explicit-any
type Args = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Msg = Record<string, any>;

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const docFields = {
  status: { type: "string", enum: STATUSES },
  party: { type: "string", description: "Counterparty, client, employee or authority. Max 120 chars." },
  expiry: { type: "string", description: "Expiry or renewal date, YYYY-MM-DD." },
  tags: { type: "array", items: { type: "string" }, description: "Up to 12 short lowercase tags." },
  link: { type: "string", description: "External https link." },
  notes: { type: "string", description: "Key terms, signatories, where the original is kept. Max 4000 chars." },
};
const TOOLS = [
  fn("list_modules", "List every module (folder) with its code and how many documents it holds.", {}),
  fn("search_documents", "Search the register. Combine filters freely. Returns newest first.", {
    query: { type: "string", description: "Matches title, reference or counterparty." },
    status: { type: "string", enum: STATUSES },
    module_code: { type: "string", description: "e.g. CON" },
    expiring_within_days: { type: "integer", description: "Only documents expiring (or already expired) within N days." },
    limit: { type: "integer", description: "Max 50, default 25." },
  }),
  fn("register_overview", "One-call health check of the register: totals by status and module, overdue, expiring in 30 days, and records with no file or link. Use it for \"how are we doing\" questions and before suggesting clean-up.", {}),
  fn("get_document", "Get the full record of one document by reference, e.g. VG-CON-0007.", {
    ref: { type: "string" },
  }, ["ref"]),
  fn("create_module", "Create a module (a folder with a 2 to 4 letter code that prefixes reference numbers).", {
    name: { type: "string" },
    code: { type: "string", description: "2 to 4 letters, unique. Never CASE." },
    description: { type: "string" },
  }, ["name", "code"]),
  fn("create_company", "Set up a company or client workspace in one step: a module named after it, plus optional starter documents (filed as Draft with the company as counterparty). Use this when asked to add a new company, client or partner.", {
    name: { type: "string", description: "Company name." },
    code: { type: "string", description: "Optional 2 to 4 letter code. Chosen automatically if omitted." },
    description: { type: "string" },
    starter_documents: {
      type: "array", maxItems: 10, description: "e.g. NDA, Master Services Agreement, Onboarding checklist.",
      items: { type: "object", properties: { title: { type: "string" }, status: { type: "string", enum: STATUSES }, expiry: { type: "string" }, notes: { type: "string" } }, required: ["title"] },
    },
  }, ["name"]),
  fn("update_module", "Rename a module or change its description. The code never changes, so existing references stay valid.", {
    code: { type: "string" }, name: { type: "string" }, description: { type: "string" },
  }, ["code"]),
  fn("bulk_update_documents", "Apply the same change (status, expiry, or tags to add) to up to 25 documents by reference. Use it for clean-ups such as archiving expired records.", {
    refs: { type: "array", items: { type: "string" }, maxItems: 25 },
    status: { type: "string", enum: STATUSES },
    expiry: { type: "string", description: "YYYY-MM-DD" },
    add_tags: { type: "array", items: { type: "string" } },
  }, ["refs"]),
  fn("create_document", "Create a document record in a module. A reference number is issued automatically. Files are attached by people in the app, not by you.", {
    title: { type: "string" },
    module_code: { type: "string" },
    ...docFields,
  }, ["title", "module_code"]),
  fn("update_document", "Change fields on an existing document, or move it to another module with module_code. Only pass fields that change.", {
    ref: { type: "string" },
    title: { type: "string" },
    module_code: { type: "string" },
    ...docFields,
  }, ["ref"]),
];
function fn(name: string, description: string, properties: Args, required: string[] = []) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

const system = (role: string) => `You are Vanguard Copilot, the assistant inside Vanguard Docs, the document register of Vanguard Services S.A.L, a Beirut-based outsourcing company. The signed-in user's role is "${role}". Today is ${new Date().toISOString().slice(0, 10)}.

You find, create and organise records by calling tools. You do not guess.
- Look things up with tools before answering. Never invent references, dates or counts.
- To create or change anything, call the write tool directly. The person sees an approval card and confirms, so do not ask "shall I?" first.
- A module is a folder with a 2 to 4 letter code. A new company, client or partner means create_company.
- For broad questions ("how are we doing", "what needs attention"), call register_overview first, then drill into the worst items and propose concrete next steps. Offer clean-ups with bulk_update_documents.
- You can chain several tool calls in one turn. Finish the whole job before replying.
- Choose sensible defaults: new unsigned items are "Draft", signed ones "Active". Ask one short question only when a required detail is truly missing.
- You cannot delete anything, attach files, or touch the restricted Case File. If asked, say so in one line.
- Viewers can only read. If a viewer asks for a change, say an owner must upgrade them.
- Answer in short, plain sentences. No filler, no em dashes. Use a short list only when comparing several records. Give references like VG-CON-0007 and dates as 12 Oct 2026.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const endpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const apiKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  const deployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT");
  const version = Deno.env.get("AZURE_OPENAI_API_VERSION") || "2024-10-21";
  if (!endpoint || !apiKey || !deployment) {
    return json({ error: "The copilot isn't set up yet. An admin needs to add the Azure OpenAI secrets to the copilot function." }, 500);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: ue } = await sb.auth.getUser(token);
  if (ue || !u?.user) return json({ error: "Sign in again." }, 401);
  if (jwtAal(token) !== "aal2") return json({ error: "Finish two-step sign-in first." }, 403);
  const { data: me } = await sb.from("members").select("role").eq("user_id", u.user.id).maybeSingle();
  const role = me?.role as string | undefined;
  if (!role || !["owner", "editor", "viewer"].includes(role)) return json({ error: "You don't have access yet." }, 403);
  const canWrite = role === "owner" || role === "editor";

  let body: Args;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const msgs = clean(body.messages);
  const decisions: Args = body.decisions && typeof body.decisions === "object" ? body.decisions : {};
  const last = msgs[msgs.length - 1];
  if (!last || !(last.role === "user" || (last.role === "assistant" && last.tool_calls?.length))) {
    return json({ error: "Nothing to answer." }, 400);
  }
  const tools = canWrite ? TOOLS : TOOLS.filter((t) => READ.has(t.function.name));

  try {
    let wrote = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const tail = msgs[msgs.length - 1];
      if (tail.role === "assistant" && tail.tool_calls?.length) {
        // Plan first: nothing runs until every write in this batch has a decision.
        const plan = tail.tool_calls.map((tc: Msg) => {
          let args: Args = {};
          let bad = false;
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { bad = true; }
          return { id: tc.id as string, name: tc.function.name as string, args, bad };
        });
        const pending = plan.filter((p: Msg) => !p.bad && WRITE.has(p.name) && canWrite && !decisions[p.id])
          .map((p: Msg) => ({ id: p.id, name: p.name, args: p.args, summary: describe(p.name, p.args) }));
        if (pending.length) return json({ messages: msgs, pending, wrote });

        for (const p of plan) {
          let out: unknown;
          if (p.bad) out = { error: "Arguments were not valid JSON." };
          else if (READ.has(p.name)) out = await run(sb, p.name, p.args);
          else if (WRITE.has(p.name) && canWrite) {
            if (decisions[p.id] === "approve") { out = await run(sb, p.name, p.args); if (!(out as Args).error) wrote = true; }
            else out = { rejected: true, note: "The user declined this action. Do not retry it." };
          } else out = { error: canWrite ? "Unknown tool." : "Viewers can't make changes." };
          msgs.push({ role: "tool", tool_call_id: p.id, content: JSON.stringify(out).slice(0, 12000) });
        }
      }

      if (await shielded(msgs)) {
        return json({ error: "Blocked by the safety check. Rephrase the request, or review the document text it points at." }, 400);
      }
      const reply = await chat(endpoint, deployment, version, apiKey, [{ role: "system", content: system(role) }, ...msgs], tools);
      const m: Msg = { role: "assistant", content: reply.content ?? null };
      if (reply.tool_calls?.length) {
        m.tool_calls = reply.tool_calls.map((tc: Msg) => ({
          id: String(tc.id), type: "function", function: { name: String(tc.function?.name), arguments: String(tc.function?.arguments ?? "{}") },
        }));
      }
      msgs.push(m);
      if (!m.tool_calls) return json({ messages: msgs, reply: m.content ?? "", wrote });
    }
    return json({ messages: msgs, reply: "I hit my step limit. Tell me where to pick up.", wrote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "The copilot failed. Try again." }, 502);
  }
});

function jwtAal(token: string): string {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(p.aal ?? "");
  } catch { return ""; }
}

// Azure AI Content Safety Prompt Shields: checks the latest user message and any document text the
// tools returned (where hidden instructions would live). Off unless both secrets are set.
async function shielded(msgs: Msg[]): Promise<boolean> {
  const ep = Deno.env.get("AZURE_CONTENT_SAFETY_ENDPOINT");
  const key = Deno.env.get("AZURE_CONTENT_SAFETY_KEY");
  if (!ep || !key) return false;
  const userPrompt = String([...msgs].reverse().find((m) => m.role === "user")?.content ?? "").slice(0, 9000);
  const documents = msgs.filter((m) => m.role === "tool").slice(-5).map((m) => String(m.content).slice(0, 1800));
  const r = await fetch(`${ep.replace(/\/+$/, "")}/contentsafety/text:shieldPrompt?api-version=2024-09-01`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ userPrompt: userPrompt || " ", documents }),
  });
  if (!r.ok) throw new Error(`The safety check is unavailable (${r.status}).`);
  const d = await r.json();
  return !!d?.userPromptAnalysis?.attackDetected || (d?.documentsAnalysis ?? []).some((x: Msg) => x?.attackDetected);
}

// Keep only well-formed turns, cap the history, and never start mid tool-call.
function clean(input: unknown): Msg[] {
  if (!Array.isArray(input)) return [];
  const out: Msg[] = [];
  for (const m of input.slice(-40)) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user") out.push({ role: "user", content: str(m.content, 8000) });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: str(m.tool_call_id, 100), content: str(m.content, 12000) });
    else if (m.role === "assistant") {
      const a: Msg = { role: "assistant", content: m.content == null ? null : str(m.content, 8000) };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        a.tool_calls = m.tool_calls.slice(0, 8).map((tc: Msg) => ({
          id: str(tc?.id, 100), type: "function", function: { name: str(tc?.function?.name, 60), arguments: str(tc?.function?.arguments, 8000) },
        }));
      }
      out.push(a);
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function chat(endpoint: string, deployment: string, version: string, key: string, messages: Msg[], tools: unknown[]): Promise<Msg> {
  const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools, tool_choice: "auto", max_completion_tokens: 2000 }),
  });
  if (!r.ok) throw new Error(`Azure OpenAI returned ${r.status}. ${(await r.text()).slice(0, 240)}`);
  const data = await r.json();
  const m = data?.choices?.[0]?.message;
  if (!m) throw new Error("Azure OpenAI sent an empty reply.");
  return m;
}

function describe(name: string, a: Args): string {
  switch (name) {
    case "create_module": return `Create module ${str(a.code, 4).toUpperCase()} · ${str(a.name, 60)}`;
    case "create_company": {
      const n = Array.isArray(a.starter_documents) ? a.starter_documents.length : 0;
      return `Set up company "${str(a.name, 60)}"${a.code ? ` (${str(a.code, 4).toUpperCase()})` : ""} with ${n} starter document${n === 1 ? "" : "s"}`;
    }
    case "create_document": return `Add "${str(a.title, 160)}" to ${str(a.module_code, 4).toUpperCase()}${a.status ? ` as ${a.status}` : ""}${a.expiry ? `, expires ${a.expiry}` : ""}`;
    case "update_module": return `Update module ${str(a.code, 4).toUpperCase()}: ${Object.keys(a).filter((k) => k !== "code").join(", ") || "no changes"}`;
    case "bulk_update_documents": {
      const n = Array.isArray(a.refs) ? a.refs.length : 0;
      return `Change ${n} document${n === 1 ? "" : "s"}${a.status ? ` to ${a.status}` : ""}${a.expiry ? `, expiry ${a.expiry}` : ""}${a.add_tags?.length ? `, add tags ${a.add_tags.join(", ")}` : ""}`;
    }
    case "update_document": {
      const keys = Object.keys(a).filter((k) => k !== "ref");
      return `Update ${str(a.ref, 30)}: ${keys.length ? keys.join(", ") : "no changes"}`;
    }
    default: return name;
  }
}

/* ------------------------------------------------------------------ tools */
async function run(sb: SupabaseClient, name: string, a: Args): Promise<Args> {
  try {
    switch (name) {
      case "list_modules": return await listModules(sb);
      case "search_documents": return await searchDocuments(sb, a);
      case "get_document": return await getDocument(sb, a);
      case "register_overview": return await registerOverview(sb);
      case "update_module": return await updateModule(sb, a);
      case "bulk_update_documents": return await bulkUpdate(sb, a);
      case "create_module": return await createModule(sb, a);
      case "create_company": return await createCompany(sb, a);
      case "create_document": return await createDocument(sb, a);
      case "update_document": return await updateDocument(sb, a);
      default: return { error: "Unknown tool." };
    }
  } catch (e) {
    return { error: friendly(e) };
  }
}
function friendly(e: unknown): string {
  const x = e as Args;
  const m = String(x?.message ?? e);
  if (x?.code === "23505") return "That code or reference is already in use.";
  if (x?.code === "42501" || /row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  return m.slice(0, 300);
}
async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

async function modulesByCode(sb: SupabaseClient) {
  const rows = await ok(sb.from("modules").select("id,name,code,description,sort_order").order("sort_order"));
  return rows as Args[];
}
async function moduleFor(sb: SupabaseClient, code: unknown) {
  const c = str(code, 8).toUpperCase();
  const m = (await modulesByCode(sb)).find((x) => x.code === c);
  if (!m) throw new Error(`No module with code ${c || "(none)"}. Use list_modules to see the codes.`);
  return m;
}
async function listModules(sb: SupabaseClient) {
  const mods = await modulesByCode(sb);
  const docs = await ok(sb.from("documents").select("module_id").eq("is_case", false)) as Args[];
  const n = new Map<number, number>();
  docs.forEach((d) => n.set(d.module_id, (n.get(d.module_id) ?? 0) + 1));
  return { modules: mods.map((m) => ({ code: m.code, name: m.name, description: m.description, documents: n.get(m.id) ?? 0 })) };
}
async function searchDocuments(sb: SupabaseClient, a: Args) {
  const mods = await modulesByCode(sb);
  const byId = new Map(mods.map((m) => [m.id, m.code]));
  let q = sb.from("documents").select("ref,title,status,party,expiry,tags,link,file_name,module_id,updated_at")
    .eq("is_case", false).order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(Number(a.limit) || 25, 1), 50));
  if (a.status && STATUSES.includes(a.status)) q = q.eq("status", a.status);
  if (a.module_code) q = q.eq("module_id", (await moduleFor(sb, a.module_code)).id);
  if (a.expiring_within_days != null && Number.isFinite(Number(a.expiring_within_days))) {
    const to = new Date(Date.now() + Number(a.expiring_within_days) * 86400000).toISOString().slice(0, 10);
    q = q.not("expiry", "is", null).lte("expiry", to).neq("status", "Archived");
  }
  const term = str(a.query, 80).replace(/[,()%*\\]/g, " ").trim();
  if (term) q = q.or(`title.ilike.%${term}%,ref.ilike.%${term}%,party.ilike.%${term}%`);
  const rows = await ok(q) as Args[];
  return {
    count: rows.length,
    documents: rows.map((d) => ({
      ref: d.ref, title: d.title, module: byId.get(d.module_id), status: d.status, party: d.party,
      expiry: d.expiry, tags: d.tags, has_file: !!d.file_name, link: d.link || undefined,
    })),
  };
}
async function getDocument(sb: SupabaseClient, a: Args) {
  const mods = await modulesByCode(sb);
  const d = await ok(sb.from("documents").select("*").eq("ref", str(a.ref, 30).toUpperCase()).eq("is_case", false).maybeSingle()) as Args | null;
  if (!d) return { error: `No document ${str(a.ref, 30)}.` };
  return {
    ref: d.ref, title: d.title, module: mods.find((m) => m.id === d.module_id)?.code, status: d.status, party: d.party,
    expiry: d.expiry, tags: d.tags, link: d.link, notes: d.notes, file: d.file_name || null, created_at: d.created_at, updated_at: d.updated_at,
  };
}

function docRow(a: Args, partial = false): Args {
  const row: Args = {};
  if (!partial || a.title !== undefined) {
    row.title = str(a.title, 160);
    if (!row.title) throw new Error("A document needs a title.");
  }
  if (a.status !== undefined) {
    if (!STATUSES.includes(a.status)) throw new Error(`Status must be one of ${STATUSES.join(", ")}.`);
    row.status = a.status;
  }
  if (a.party !== undefined) row.party = str(a.party, 120);
  if (a.expiry !== undefined) {
    if (a.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(a.expiry)) throw new Error("Expiry must be YYYY-MM-DD.");
    row.expiry = a.expiry || null;
  }
  if (a.tags !== undefined) {
    row.tags = [...new Set((Array.isArray(a.tags) ? a.tags : []).map((t: unknown) => str(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12);
  }
  if (a.link !== undefined) {
    if (a.link && !/^https?:\/\//i.test(a.link)) throw new Error("Links must start with https://");
    row.link = str(a.link, 500);
  }
  if (a.notes !== undefined) row.notes = str(a.notes, 4000);
  return row;
}

async function createModule(sb: SupabaseClient, a: Args) {
  const name = str(a.name, 60);
  const code = str(a.code, 8).toUpperCase();
  if (!name) throw new Error("A module needs a name.");
  if (!/^[A-Z]{2,4}$/.test(code) || code === "CASE") throw new Error("The code must be 2 to 4 letters and not CASE.");
  const mods = await modulesByCode(sb);
  if (mods.some((m) => m.code === code)) throw new Error(`Code ${code} is already used by ${mods.find((m) => m.code === code)!.name}.`);
  const row = await ok(sb.from("modules").insert({
    name, code, description: str(a.description, 160), sort_order: Math.max(0, ...mods.map((m) => m.sort_order ?? 0)) + 1,
  }).select().single()) as Args;
  return { created: "module", code: row.code, name: row.name };
}

function codeCandidates(name: string): string[] {
  const words = name.toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  const letters = words.join("");
  const c: string[] = [];
  if (words.length > 1) c.push(words.map((w) => w[0]).join("").slice(0, 4));
  c.push(letters.slice(0, 3), letters.slice(0, 4), letters.slice(0, 2));
  for (let i = 1; i < letters.length - 1; i++) c.push(letters[0] + letters.slice(i, i + 2));
  return [...new Set(c)].filter((x) => /^[A-Z]{2,4}$/.test(x) && x !== "CASE");
}
async function createCompany(sb: SupabaseClient, a: Args) {
  const name = str(a.name, 60);
  if (!name) throw new Error("A company needs a name.");
  const mods = await modulesByCode(sb);
  const used = new Set(mods.map((m) => m.code));
  let code = str(a.code, 8).toUpperCase();
  if (code) {
    if (!/^[A-Z]{2,4}$/.test(code) || code === "CASE") throw new Error("The code must be 2 to 4 letters and not CASE.");
    if (used.has(code)) throw new Error(`Code ${code} is already used. Pick another.`);
  } else {
    code = codeCandidates(name).find((c) => !used.has(c)) ?? "";
    if (!code) throw new Error("Couldn't derive a free code from that name. Give me a 2 to 4 letter code.");
  }
  const starters = (Array.isArray(a.starter_documents) ? a.starter_documents : []).slice(0, 10);
  const rows = starters.map((s: Args) => ({ ...docRow({ status: "Draft", ...s, party: name }), }));
  const mod = await ok(sb.from("modules").insert({
    name, code, description: str(a.description, 160) || `Documents for ${name}.`, sort_order: Math.max(0, ...mods.map((m) => m.sort_order ?? 0)) + 1,
  }).select().single()) as Args;
  const refs: string[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    try {
      const d = await ok(sb.from("documents").insert({ ...r, module_id: mod.id, is_case: false }).select("ref").single()) as Args;
      refs.push(`${d.ref} ${r.title}`);
    } catch (e) { failed.push(`${r.title}: ${friendly(e)}`); }
  }
  return { created: "company", module: { code: mod.code, name: mod.name }, documents: refs, failed: failed.length ? failed : undefined };
}
async function createDocument(sb: SupabaseClient, a: Args) {
  const mod = await moduleFor(sb, a.module_code);
  const row = docRow({ status: "Active", ...a });
  const d = await ok(sb.from("documents").insert({ ...row, module_id: mod.id, is_case: false }).select("ref,title,status").single()) as Args;
  return { created: "document", ref: d.ref, title: d.title, status: d.status, module: mod.code };
}
async function updateDocument(sb: SupabaseClient, a: Args) {
  const ref = str(a.ref, 30).toUpperCase();
  const row = docRow(a, true);
  if (a.module_code) row.module_id = (await moduleFor(sb, a.module_code)).id;
  if (!Object.keys(row).length) throw new Error("Nothing to change.");
  const d = await ok(sb.from("documents").update(row).eq("ref", ref).eq("is_case", false).select("ref,title,status").maybeSingle()) as Args | null;
  if (!d) throw new Error(`No document ${ref}, or you can't change it.`);
  return { updated: d.ref, title: d.title, status: d.status, moved_to: a.module_code ? str(a.module_code, 4).toUpperCase() : undefined, note: a.module_code ? "Moving to another module issues a new reference number." : undefined };
}

async function registerOverview(sb: SupabaseClient) {
  const mods = await modulesByCode(sb);
  const docs = await ok(sb.from("documents").select("ref,title,status,expiry,module_id,file_path,link").eq("is_case", false)) as Args[];
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const live = docs.filter((d) => d.status !== "Archived");
  const brief = (d: Args) => ({ ref: d.ref, title: d.title, status: d.status, expiry: d.expiry });
  const byStatus: Record<string, number> = {};
  docs.forEach((d) => { byStatus[d.status] = (byStatus[d.status] ?? 0) + 1; });
  return {
    total: docs.length,
    by_status: byStatus,
    by_module: mods.map((m) => ({ code: m.code, name: m.name, documents: docs.filter((d) => d.module_id === m.id).length })),
    overdue: live.filter((d) => d.expiry && d.expiry < today).slice(0, 15).map(brief),
    expiring_30_days: live.filter((d) => d.expiry && d.expiry >= today && d.expiry <= soon).slice(0, 15).map(brief),
    missing_file_and_link: live.filter((d) => !d.file_path && !d.link).slice(0, 15).map(brief),
    still_draft: docs.filter((d) => d.status === "Draft").length,
  };
}
async function updateModule(sb: SupabaseClient, a: Args) {
  const mod = await moduleFor(sb, a.code);
  const row: Args = {};
  if (a.name !== undefined) { row.name = str(a.name, 60); if (!row.name) throw new Error("A module needs a name."); }
  if (a.description !== undefined) row.description = str(a.description, 160);
  if (!Object.keys(row).length) throw new Error("Nothing to change.");
  const m = await ok(sb.from("modules").update(row).eq("id", mod.id).select("code,name").single()) as Args;
  return { updated_module: m.code, name: m.name };
}
async function bulkUpdate(sb: SupabaseClient, a: Args) {
  const refs = [...new Set((Array.isArray(a.refs) ? a.refs : []).map((r: unknown) => str(r, 30).toUpperCase()).filter(Boolean))].slice(0, 25);
  if (!refs.length) throw new Error("No references given.");
  const row = docRow({ status: a.status, expiry: a.expiry }, true);
  if (a.add_tags?.length) {
    const cur = await ok(sb.from("documents").select("ref,tags").in("ref", refs).eq("is_case", false)) as Args[];
    let n = 0;
    for (const d of cur) {
      const tags = docRow({ tags: [...(d.tags ?? []), ...a.add_tags] }, true).tags;
      await ok(sb.from("documents").update({ ...row, tags }).eq("ref", d.ref).eq("is_case", false).select("ref"));
      n++;
    }
    return { updated: n, refs: cur.map((d) => d.ref) };
  }
  if (!Object.keys(row).length) throw new Error("Nothing to change.");
  const done = await ok(sb.from("documents").update(row).in("ref", refs).eq("is_case", false).select("ref")) as Args[];
  return { updated: done.length, refs: done.map((d) => d.ref), not_found: refs.filter((r) => !done.some((d) => d.ref === r)) };
}
