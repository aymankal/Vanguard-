/* Vanguard Client data layer on Supabase. Every permission is enforced by row-level security in the
   database (see supabase/migrations/20261018210000_client_app.sql); this file only shapes requests. */
(function () {
  "use strict";
  const CFG = window.VC_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  function fail(error) {
    if (!error) return;
    const e = new Error(error.message || "Request failed");
    e.code = error.code === "42501" || /row-level security|permission denied/i.test(error.message || "")
      ? "denied" : error.code === "23505" ? "duplicate" : "unavailable";
    throw e;
  }

  const people = { me: null, team: new Map() };

  async function join(name) {
    const { data, error } = await sb.rpc("vc_join", { p_name: name || "" });
    fail(error);
    people.me = data;
    return data;
  }

  async function loadMembers() {
    const { data, error } = await sb.from("vc_members").select("user_id,name,email,role,client_id,created_at").order("created_at");
    fail(error);
    people.team = new Map(data.map((m) => [m.user_id, m]));
    if (people.me && people.team.has(people.me.user_id)) people.me = people.team.get(people.me.user_id);
    return data;
  }

  async function list(table, opts) {
    let q = sb.from(table).select("*");
    if (opts && opts.client !== undefined) {
      q = opts.includeBroadcast ? q.or(`client_id.eq.${opts.client},client_id.is.null`) : q.eq("client_id", opts.client);
    }
    if (opts && opts.order) q = q.order(opts.order, { ascending: !!opts.asc });
    const { data, error } = await q.limit(opts && opts.limit ? opts.limit : 1000);
    fail(error);
    return data;
  }

  async function insert(table, row) {
    const { data, error } = await sb.from(table).insert(row).select().single();
    fail(error);
    return data;
  }
  async function update(table, id, patch) {
    const { error } = await sb.from(table).update(patch).eq("id", id);
    fail(error);
  }
  async function remove(table, id) {
    const { error } = await sb.from(table).delete().eq("id", id);
    fail(error);
  }
  async function upsertReport(row) {
    const { error } = await sb.from("vc_reports").upsert(row, { onConflict: "client_id,week_start" });
    fail(error);
  }

  async function setMember(userId, patch) {
    const { error } = await sb.from("vc_members").update(patch).eq("user_id", userId);
    fail(error);
  }
  async function removeMember(userId) {
    const { error } = await sb.from("vc_members").delete().eq("user_id", userId);
    fail(error);
  }

  // Calls onChange whenever any of the listed tables changes. Realtime applies each table's read policy,
  // so a client only hears about their own company's rows.
  let seq = 0;
  function watch(tables, onChange) {
    const ch = sb.channel("vc-" + ++seq);
    tables.forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => onChange(t, p)));
    ch.subscribe();
    return () => sb.removeChannel(ch);
  }

  window.VCData = { sb, people, join, loadMembers, list, insert, update, remove, upsertReport, setMember, removeMember, watch };
})();
