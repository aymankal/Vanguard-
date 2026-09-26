  /* ------------------------------------------- Copilot (port of crm/assistant.py offline engine) */
  const call = (method, path, body = {}) => {
    const u = new URL(path, "https://demo.local");
    const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
    if (!r) throw new HttpError(404, "Not found");
    return JSON.parse(JSON.stringify(r.fn({ p: u.pathname.match(r.re).groups || {}, q: u.searchParams, body })));
  };
  const CP_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
  const lnk = (kind, id, label) => `[${label}](#/${kind}/${id})`;
  const usd = (v) => "$" + Math.round(v || 0).toLocaleString("en-US");
  const DATE_WORDS = "(today|tomorrow|tmrw|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\\d{4}-\\d{2}-\\d{2}|in \\d+ (?:days?|weeks?))";

  function parseWhen(text) {
    const m = text.match(new RegExp("\\b(?:on |by |for |due )?" + DATE_WORDS + "\\b", "i"));
    if (!m) return ["", text];
    const phrase = m[1].toLowerCase();
    const n = phrase.match(/in (\d+) (day|week)/);
    const token = n ? `+${n[1]}${n[2] === "week" ? "w" : "d"}` : phrase === "next week" ? "nextweek" : phrase;
    return [resolveDate(token), (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()];
  }

  function findEntities(text) {
    const low = ` ${text.toLowerCase()} `;
    const said = (phrase) => {
      phrase = (phrase || "").toLowerCase().trim();
      return phrase.length >= 3 && new RegExp("(?<![\\w])" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])").test(low);
    };
    return {
      contacts: call("GET", "/contacts").filter((c) => said(c.name) || said(c.name.split(" ")[0])),
      companies: call("GET", "/companies").filter((c) => said(c.name) || said(c.name.split(" ")[0])),
      deals: call("GET", "/deals").filter((d) => said(d.title) || said(d.title.split(" — ")[0])),
    };
  }
  const ctxRec = (ctx) => [ctx.view || "", ctx.id ? Number(ctx.id) : null];

  function pickContact(hits, ctx) {
    if (hits.contacts.length) return hits.contacts[0];
    if (hits.companies.length) {
      const people = call("GET", "/contacts").filter((c) => c.company_id === hits.companies[0].id);
      if (people.length) return people[0];
    }
    if (hits.deals.length && hits.deals[0].contact_id) return call("GET", `/contacts/${hits.deals[0].contact_id}`);
    const [view, rec] = ctxRec(ctx);
    if (view === "contacts" && rec) return call("GET", `/contacts/${rec}`);
    if (view === "deals" && rec) { const d = call("GET", `/deals/${rec}`); return d.contact_id ? call("GET", `/contacts/${d.contact_id}`) : null; }
    if (view === "notes" && rec) { const n = call("GET", `/notes/${rec}`); return n.contact_id ? call("GET", `/contacts/${n.contact_id}`) : null; }
    return null;
  }
  function pickDeal(hits, ctx) {
    if (hits.deals.length) return hits.deals[0];
    const open = (f) => call("GET", "/deals").filter((d) => d.is_open && f(d));
    if (hits.companies.length) { const f = open((d) => d.company_id === hits.companies[0].id); if (f.length) return f[0]; }
    if (hits.contacts.length) { const f = open((d) => d.contact_id === hits.contacts[0].id); if (f.length) return f[0]; }
    const [view, rec] = ctxRec(ctx);
    if (view === "deals" && rec) return call("GET", `/deals/${rec}`);
    if (view === "contacts" && rec) { const f = open((d) => d.contact_id === rec); return f[0] || null; }
    return null;
  }
  const taskLine = (t) => `- ${t.text}${t.priority === "high" ? " ‼" : ""}${t.due_date ? ` · due ${t.due_date}` : ""}${t.contact_id && t.contact_name ? ` — ${lnk("contacts", t.contact_id, t.contact_name)}` : ""}`;

  function oAgenda() {
    const s = call("GET", "/stats");
    const lines = [];
    if (s.agenda.length) { lines.push(`**Tasks due** (${s.overdue_tasks} overdue, ${s.due_today} today)`); lines.push(...s.agenda.slice(0, 6).map(taskLine)); }
    if (s.follow_ups.length) { lines.push("", "**Follow-ups to send**"); lines.push(...s.follow_ups.slice(0, 6).map((c) => `- ${lnk("contacts", c.id, c.name)}${c.company ? " · " + c.company : ""} (due ${c.next_follow_up})`)); }
    if (s.stale_deals.length) { lines.push("", "**Deals going cold**"); lines.push(...s.stale_deals.slice(0, 4).map((d) => `- ${lnk("deals", d.id, d.title)}: ${usd(d.value)}, quiet ${d.days_since_activity} days${d.next_step ? ` — next step: ${d.next_step}` : ""}`)); }
    const risky = s.at_risk.filter((a) => a.health.label === "at-risk");
    if (risky.length) { lines.push("", "**Accounts at risk**"); lines.push(...risky.slice(0, 4).map((a) => `- ${lnk("companies", a.id, a.name)}: ${a.health.reasons[0]}`)); }
    return [lines.length ? "Here's what needs you today, most urgent first:\n\n" + lines.join("\n") : "You're clear: nothing overdue, no follow-ups due, no deals going cold. Good time to prospect.", []];
  }
  function oPipeline() {
    const s = call("GET", "/stats");
    const rows = CP_STAGES.filter((st) => s.by_stage[st].count).map((st) => `- **${st}**: ${s.by_stage[st].count} · ${usd(s.by_stage[st].value)}`);
    const fc = s.forecast.map((f) => `${f.month}: ${usd(f.weighted)}`).join(", ") || "no close dates set";
    return [`**Open pipeline** ${usd(s.open_pipeline)} · **weighted** ${usd(s.weighted_pipeline)} · **win rate** ${s.win_rate == null ? "no closed deals yet" : s.win_rate + "%"}\n\n${rows.join("\n")}\n\n**Weighted forecast:** ${fc}`, []];
  }
  function oStale() {
    const d = call("GET", "/stats").stale_deals;
    return [d.length ? "These open deals have gone quiet:\n\n" + d.map((x) => `- ${lnk("deals", x.id, x.title)}: ${usd(x.value)}, ${x.days_since_activity} days without activity${x.next_step ? `. Next step: ${x.next_step}` : ""}`).join("\n") : "No deals are going cold. Every open deal had activity in the last 14 days.", []];
  }
  function oRisk() {
    const s = call("GET", "/stats");
    const lines = s.at_risk.map((a) => `- ${lnk("companies", a.id, a.name)} (${a.health.label}, ${a.health.score}): ${a.health.reasons.slice(0, 2).join("; ")}`);
    if (s.renewals.length) { lines.push("", "**Renewals in the next 90 days**"); lines.push(...s.renewals.map((r) => `- ${lnk("companies", r.id, r.name)}: ${r.renewal_date}${r.mrr ? `, ${usd(r.mrr)}/mo` : ""}`)); }
    return [lines.length ? "Accounts needing attention:\n\n" + lines.join("\n") : "All accounts look healthy right now.", []];
  }
  function oFollowUps() {
    const f = call("GET", "/stats").follow_ups;
    return [f.length ? "Follow-ups due now:\n\n" + f.map((c) => `- ${lnk("contacts", c.id, c.name)}${c.company ? " · " + c.company : ""}, due ${c.next_follow_up}`).join("\n") : "No follow-ups are due.", []];
  }
  function oTasks(msg) {
    const scope = /overdue/.test(msg) ? "overdue" : /today/.test(msg) ? "today" : /week/.test(msg) ? "week" : "open";
    const t0 = today(), wk = iso(addDays(new Date(), 7));
    const pick = { overdue: (x) => x.due_date && x.due_date < t0, today: (x) => x.due_date === t0, week: (x) => x.due_date && x.due_date <= wk, open: () => true }[scope];
    const tasks = call("GET", "/tasks?done=false").filter(pick);
    const label = { overdue: "overdue", today: "due today", week: "due this week", open: "open" }[scope];
    return [tasks.length ? `**${tasks.length} task${tasks.length > 1 ? "s" : ""} ${label}:**\n\n` + tasks.slice(0, 12).map(taskLine).join("\n") : `No tasks ${label}.`, []];
  }
  function oCreateTask(msg, hits, ctx) {
    let text = msg.replace(/^\s*(please\s+)?(create|add|make|new|set)?\s*(a\s+)?(task|todo|reminder)\s*(to|:|-)?\s*/i, "").replace(/^\s*remind me to\s+/i, "");
    const priority = /\b(urgent|asap|high priority|important)\b/i.test(text) ? "high" : "";
    text = text.replace(/\b(urgent|asap|high priority|important)\b/gi, "");
    let due; [due, text] = parseWhen(text);
    text = text.replace(/\s{2,}/g, " ").trim().replace(/^[ .,:]+|[ .,:]+$/g, "");
    if (!text) return ["What should the task say? For example: “remind me to send Dana the pricing sheet tomorrow”.", []];
    const contact = hits.contacts.length || hits.companies.length || ["contacts", "deals"].includes(ctx.view) ? pickContact(hits, ctx) : null;
    const deal = hits.deals.length || ctx.view === "deals" ? pickDeal(hits, ctx) : null;
    const task = call("POST", "/tasks", { text: text[0].toUpperCase() + text.slice(1), due_date: due, priority, contact_id: contact?.id ?? null, deal_id: deal?.id ?? null });
    return [`Added **${task.text}**${contact ? ` for ${lnk("contacts", contact.id, contact.name)}` : ""}${task.due_date ? `, due ${task.due_date}` : ""}.`,
      [{ kind: "task", label: `Task created: ${task.text}${task.due_date ? " · due " + task.due_date : ""}`, href: "#/tasks" }]];
  }
  function oLog(msg, hits, ctx) {
    const kind = ["call", "email", "meeting", "linkedin", "sms"].find((k) => msg.toLowerCase().includes(k)) || "call";
    const c = pickContact(hits, ctx);
    if (!c) return ["Who was it with? Try: “log a call with Marcus: discussed pilot scope”.", []];
    const body = msg.includes(":") ? msg.split(":").slice(1).join(":").trim() : "";
    const outcome = ["voicemail", "no answer", "connected", "replied", "meeting booked", "not interested"].find((o) => msg.toLowerCase().includes(o)) || (kind === "call" ? "connected" : "");
    const a = call("POST", "/activities", { type: kind, subject: `${kind[0].toUpperCase() + kind.slice(1)} with ${c.name.split(" ")[0]}`, body, outcome, contact_id: c.id });
    return [`Logged a ${kind} with ${lnk("contacts", c.id, c.name)}${outcome ? ` (${outcome})` : ""}. Their last-touch date is updated.`,
      [{ kind: "activity", label: `Logged ${kind} with ${c.name}: ${a.subject}`, href: `#/contacts/${c.id}` }]];
  }
  function oFollowUp(msg, hits, ctx) {
    const c = pickContact(hits, ctx);
    const [due] = parseWhen(msg);
    if (!c) return ["Who should I schedule the follow-up for?", []];
    if (!due) return [`When should you follow up with ${c.name}? For example “on Friday” or “in 3 days”.`, []];
    call("PATCH", `/contacts/${c.id}`, { next_follow_up: due });
    return [`Follow-up with ${lnk("contacts", c.id, c.name)} set for **${due}**.`, [{ kind: "follow_up", label: `Follow-up with ${c.name} set for ${due}`, href: `#/contacts/${c.id}` }]];
  }
  function oMoveDeal(msg, hits, ctx) {
    const low = msg.toLowerCase();
    let stage = CP_STAGES.find((s) => new RegExp(`\\b${s}\\b`).test(low)) || (/\b(closed|signed)\b/.test(low) ? "won" : null);
    const d = pickDeal(hits, ctx);
    if (!d) return ["Which deal? Name the company or open the deal and ask again.", []];
    if (!stage) return [`Which stage should ${d.title} move to? (${CP_STAGES.join(", ")})`, []];
    const reason = stage === "lost" && msg.includes(":") ? msg.split(":").slice(1).join(":").trim() : "";
    call("PATCH", `/deals/${d.id}`, { stage, lost_reason: reason || null });
    return [`Moved ${lnk("deals", d.id, d.title)} to **${stage}**.${stage === "won" ? " Nice work." : ""}`, [{ kind: "deal", label: `${d.title} → ${stage}`, href: `#/deals/${d.id}` }]];
  }
  function contactBrief(c) {
    const h = c.health;
    const lines = [`**${lnk("contacts", c.id, c.name)}**, ${c.title || "contact"}${c.company_id ? ` at ${lnk("companies", c.company_id, c.company)}` : ""} · ${c.status}`,
      `- Health: **${h.label}** (${h.score})${h.reasons.length ? ": " + h.reasons.slice(0, 3).join("; ") : ""}`,
      `- Last touch: ${(c.last_contacted_at || "never").slice(0, 10)} · next follow-up: ${c.next_follow_up || "not set"}`];
    c.deals.filter((d) => d.is_open).slice(0, 3).forEach((d) => lines.push(`- Deal ${lnk("deals", d.id, d.title)}: ${d.stage}, ${usd(d.value)}${d.next_step ? `, next step: ${d.next_step}` : ""}`));
    const open = c.tasks.filter((t) => !t.done);
    if (open.length) lines.push("- Open tasks: " + open.slice(0, 3).map((t) => t.text).join("; "));
    const sn = c.notes.find((n) => n.summary);
    if (sn) { const s = JSON.parse(sn.summary); lines.push(`- Last meeting: ${s.summary}`); if (s.risks?.length) lines.push(`- Watch out for: ${s.risks[0]}`); }
    if (h.actions.length) lines.push("", `**Suggested next step:** ${h.actions[0]}`);
    return lines.join("\n");
  }
  function oBrief(msg, hits, ctx) {
    const [view, rec] = ctxRec(ctx);
    if (hits.contacts.length || (view === "contacts" && rec && !hits.companies.length && !hits.deals.length)) return [contactBrief(call("GET", `/contacts/${hits.contacts[0]?.id ?? rec}`)), []];
    if (hits.companies.length || (view === "companies" && rec)) {
      const co = call("GET", `/companies/${hits.companies[0]?.id ?? rec}`), h = co.health;
      const lines = [`**${lnk("companies", co.id, co.name)}**${co.industry ? " · " + co.industry : ""}`,
        `- Health: **${h.label}** (${h.score})${h.reasons.length ? ": " + h.reasons.slice(0, 3).join("; ") : ""}`,
        co.mrr ? `- Contract: ${usd(co.mrr)}/mo` : "- No contract value recorded", `- Renewal: ${co.renewal_date || "not set"}`,
        "- People: " + (co.contacts.map((p) => lnk("contacts", p.id, p.name)).join(", ") || "none")];
      co.deals.filter((d) => d.is_open).slice(0, 3).forEach((d) => lines.push(`- Deal ${lnk("deals", d.id, d.title)}: ${d.stage}, ${usd(d.value)}`));
      if (h.actions.length) lines.push("", `**Suggested next step:** ${h.actions[0]}`);
      return [lines.join("\n"), []];
    }
    const deal = pickDeal(hits, ctx);
    if (deal) {
      const d = call("GET", `/deals/${deal.id}`);
      return [`**${lnk("deals", d.id, d.title)}**: ${d.stage} · ${usd(d.value)} at ${d.probability}% (weighted ${usd(d.weighted_value)})\n- Close date: ${d.close_date || "not set"} · ${d.days_in_stage} days in stage · last activity ${d.days_since_activity} days ago\n- Next step: ${d.next_step || "not set"}${d.stale ? "\n- ⚠ Going cold. Advance it today." : ""}`, []];
    }
    return ["Who should I brief you on? Name a contact, company or deal, or open one and ask “brief me”.", []];
  }
  function oDraft(msg, hits, ctx) {
    const pc = pickContact(hits, ctx);
    if (!pc) return ["Who is the email for? For example: “draft a follow-up email to Priya”.", []];
    const c = call("GET", `/contacts/${pc.id}`);
    const first = c.name.split(" ")[0];
    const sn = c.notes.find((n) => n.summary);
    const deal = c.deals.find((d) => d.is_open);
    const body = sn ? offlineRecap("our conversation", c.name, c.owner, JSON.parse(sn.summary)).body
      : `Hi ${first},\n\nI wanted to follow up on our last conversation${deal ? " on " + deal.title.split(" — ").pop() : ""}. ${deal && deal.next_step ? "The next step on our side is " + deal.next_step.toLowerCase() + ". " : ""}Would you have 20 minutes this week to align on next steps?\n\nBest,\n${c.owner || ""}\n`;
    return [`Here's a draft for ${lnk("contacts", c.id, c.name)}${c.email ? ` (${c.email})` : ""}:\n\n**Subject:** Following up${c.company ? " — " + c.company : ""}\n\n\`\`\`\n${body}\`\`\`\n\nSay “log it as sent” after you send it.`, []];
  }
  function oLogSent(msg, hits, ctx) {
    const c = pickContact(hits, ctx);
    if (!c) return ["Which contact did you email?", []];
    call("POST", "/activities", { type: "email", subject: "Follow-up email", outcome: "sent", contact_id: c.id });
    return [`Logged the email to ${lnk("contacts", c.id, c.name)}.`, [{ kind: "activity", label: `Logged email to ${c.name}`, href: `#/contacts/${c.id}` }]];
  }
  function oSearch(msg) {
    const q = msg.replace(/^\s*(find|search( for)?|look ?up|show( me)?|where is)\s+/i, "").replace(/[ ?.]+$/, "");
    const r = call("GET", `/search?q=${encodeURIComponent(q)}`);
    const lines = [...r.contacts.map((c) => `- ${lnk("contacts", c.id, c.name)}${c.company ? " · " + c.company : ""}`),
      ...r.companies.map((c) => `- ${lnk("companies", c.id, c.name)} (company)`),
      ...r.deals.map((d) => `- ${lnk("deals", d.id, d.title)} (${d.stage}, ${usd(d.value)})`),
      ...r.notes.map((n) => `- ${lnk("notes", n.id, n.title)} (note)`)];
    return lines.length ? [`Found ${lines.length} match${lines.length > 1 ? "es" : ""} for “${q}”:\n\n` + lines.slice(0, 12).join("\n"), []] : null;
  }
  const HELP = "I'm Copilot. I can:\n\n- **Plan your day**: “what should I focus on today?”\n- **Brief you** before a call: “brief me on Northwind”\n- **Update the CRM**: “remind me to send Dana pricing tomorrow”, “log a call with Marcus: pilot scope agreed”, “move the Ferro deal to negotiation”, “follow up with Priya on Friday”\n- **Report**: “pipeline”, “deals going cold”, “accounts at risk”, “overdue tasks”\n- **Draft** client emails: “draft a follow-up to Tomás”";
  const INTENTS = [
    [/\b(log(ged)? it as sent|mark(ed)? (it )?(as )?sent|i sent it)\b/, oLogSent],
    [/\b(remind me|create (a )?task|add (a )?task|new task|todo|to-do)\b/, oCreateTask],
    [/\blog(ged)?\b.*\b(call|email|meeting|linkedin|sms)\b|\b(i )?(just )?(called|emailed|met with)\b/, oLog],
    [/\b(move|mark|set|change|update)\b.*\b(deal|lead|qualified|proposal|negotiation|won|lost|stage)\b|\b(closed|signed)\b.*\bdeal\b/, oMoveDeal],
    [/\bfollow[- ]?up with\b|\bschedule (a )?follow[- ]?up\b/, oFollowUp],
    [/\b(draft|write|compose)\b.*\b(email|message|recap|note to)\b|\bemail to\b/, oDraft],
    [/\b(brief|prep|prepare|summar|tell me about|who is|what's going on with|status of|how is)/, oBrief],
    [/\b(cold|stale|stuck|quiet)\b/, oStale],
    [/\b(risk|churn|health|renewal)/, oRisk],
    [/\bfollow[- ]?ups?\b/, oFollowUps],
    [/\b(overdue|my tasks|tasks)\b/, oTasks],
    [/\b(pipeline|forecast|revenue|win rate|weighted|numbers)\b/, oPipeline],
    [/\b(today|agenda|focus|priorit|what should i|plan my day|morning|start)/, oAgenda],
    [/^\s*(hi|hello|hey|help|what can you do)\b/, () => [HELP, []]],
  ];
  on("POST", "/assistant", ({ body }) => {
    const message = (body.message || "").trim();
    if (!message) bad("message is empty");
    const ctx = body.context || {};
    const low = message.toLowerCase();
    const hits = findEntities(message);
    for (const [re, fn] of INTENTS) {
      if (re.test(low)) { const [reply, actions] = fn(message, hits, ctx); return { reply, actions, engine: "offline" }; }
    }
    if (hits.contacts.length || hits.companies.length || hits.deals.length) { const [reply, actions] = oBrief(message, hits, ctx); return { reply, actions, engine: "offline" }; }
    const found = oSearch(message);
    return found ? { reply: found[0], actions: [], engine: "offline" } : { reply: "I didn't catch that. " + HELP, actions: [], engine: "offline" };
  });
  on("GET", "/assistant/suggestions", ({ q }) => {
    const view = q.get("view") || "", id = q.get("id");
    if (view === "contacts" && id) return ["Brief me on this contact", "Draft a follow-up email", "Remind me to call them tomorrow", "Log a call: left voicemail"];
    if (view === "companies" && id) return ["Brief me on this account", "What's the renewal risk?", "Draft a check-in email"];
    if (view === "deals" && id) return ["Brief me on this deal", "Move this deal to negotiation", "Remind me to send the proposal Friday"];
    if (view === "pipeline") return ["Which deals are going cold?", "Pipeline summary", "What closes this month?"];
    if (view === "tasks") return ["What's overdue?", "Plan my day", "Remind me to prep the QBR on Thursday"];
    return ["What should I focus on today?", "Which accounts are at risk?", "Pipeline summary", "Who do I need to follow up with?"];
  });

