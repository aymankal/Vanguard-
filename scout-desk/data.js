/* Scout Desk data layer on Supabase.
   Gives the desk the same small API it used inside Claude (collections of JSON documents with live
   snapshots, plus who-is-who), backed by the scout_docs and scout_members tables. Every permission is
   enforced by row-level security in the database; this file only shapes requests. */
(function () {
  "use strict";
  const CFG = window.SCOUT_DESK_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // The desk addresses partner notes as "partner/desk/notes"; the table calls them partner_notes.
  const COL = (c) => (c === "partner/desk/notes" ? "partner_notes" : c);
  function splitPath(path) {
    const i = path.lastIndexOf("/");
    return [COL(path.slice(0, i)), path.slice(i + 1)];
  }
  function fail(error) {
    if (!error) return;
    const e = new Error(error.message || "Request failed");
    // RLS refusals surface as the "invalid_argument" code the desk already handles as view-only.
    e.code = error.code === "42501" || /row-level security|permission denied/i.test(error.message || "")
      ? "invalid_argument" : error.code === "PGRST301" || error.status === 401 ? "revoked" : "unavailable";
    throw e;
  }
  function newId() {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  }

  async function setDoc(col, id, data) {
    const { error } = await sb.from("scout_docs").upsert({ collection: col, id, data }, { onConflict: "collection,id" });
    fail(error);
  }
  async function mergeDoc(col, id, patch) {
    const { error } = await sb.rpc("scout_merge", { p_collection: col, p_id: id, p_patch: patch });
    fail(error);
  }
  function docRef(col, id) {
    return { id, set: (d) => setDoc(col, id, d), update: (p) => mergeDoc(col, id, p) };
  }

  let chanSeq = 0;
  function onSnapshot(col, cb, onErr) {
    const docs = new Map();
    const emit = () => cb({ docs: [...docs.values()].map((r) => ({ id: r.id, data: () => r.data })) });
    let alive = true;
    (async () => {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from("scout_docs").select("id,data").eq("collection", col)
          .order("id").range(from, from + PAGE - 1);
        if (error) { onErr && onErr({ code: "revoked" }); return; }
        data.forEach((r) => docs.set(r.id, r));
        if (data.length < PAGE) break;
      }
      if (alive) emit();
    })();
    const ch = sb.channel("scout-" + col + "-" + ++chanSeq)
      .on("postgres_changes", { event: "*", schema: "public", table: "scout_docs", filter: "collection=eq." + col }, (p) => {
        if (p.eventType === "DELETE") docs.delete(p.old.id);
        else docs.set(p.new.id, { id: p.new.id, data: p.new.data });
        emit();
      })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }

  const db = {
    collection(c) {
      const col = COL(c);
      return { doc: (id) => docRef(col, id || newId()), onSnapshot: (cb, onErr) => onSnapshot(col, cb, onErr) };
    },
    doc(path) { const [col, id] = splitPath(path); return docRef(col, id); },
  };

  /* ---------- people ---------- */
  const people = { me: null, team: new Map() };
  async function loadTeam() {
    const { data } = await sb.from("scout_members").select("user_id,name,email,role,created_at").order("created_at");
    people.team = new Map((data || []).map((m) => [m.user_id, m]));
    return [...people.team.values()];
  }
  const user = {
    async me() {
      const m = people.me;
      return { id: m.user_id, name: m.name, email: m.email, role: m.role, avatarUrl: null,
        canEdit: m.role === "partner", isOwner: m.role === "partner" };
    },
    async can(what) { return what === "data.write" ? ["partner", "scout"].includes(people.me && people.me.role) : false; },
    async profiles(ids) {
      if (ids.some((id) => !people.team.has(id))) await loadTeam();
      const out = {};
      for (const id of ids) { const m = people.team.get(id); if (m) out[id] = { name: m.name || m.email, isMe: id === people.me.user_id }; }
      return out;
    },
  };

  /* ---------- team management (partners) ---------- */
  async function setRole(userId, role) { const { error } = await sb.from("scout_members").update({ role }).eq("user_id", userId); fail(error); }
  async function removeMember(userId) { const { error } = await sb.from("scout_members").delete().eq("user_id", userId); fail(error); }
  function watchTeam(cb) {
    const ch = sb.channel("scout-team-" + ++chanSeq)
      .on("postgres_changes", { event: "*", schema: "public", table: "scout_members" }, async (p) => {
        await loadTeam();
        if (people.me && p.new && p.new.user_id === people.me.user_id) people.me = { ...people.me, ...p.new };
        cb();
      })
      .subscribe();
    return () => sb.removeChannel(ch);
  }

  /* ---------- auth ---------- */
  async function join(name) {
    const { data, error } = await sb.rpc("scout_join", { p_name: name || "" });
    fail(error);
    people.me = data;
    return data;
  }

  window.ScoutData = { sb, db, user, people, loadTeam, setRole, removeMember, watchTeam, join };
})();
