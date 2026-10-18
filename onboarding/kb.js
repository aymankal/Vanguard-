/* What the guide knows, and the process the atlas draws. Everything here comes from the
   Vanguard Client Onboarding brochure; anything it doesn't cover goes to the Account Lead. */
(function () {
  const SERVICE_SETUP = {
    "SDR & Lead Generation": {
      build: [
        "We build your target list from your ICP. You approve the filters.",
        "We write email and call scripts. You approve them in writing.",
        "We connect your CRM and calendar and set the booking rule.",
        "We set daily activity quotas and quality checks.",
      ],
      kpis: ["Meetings per week", "Show rate", "Cost per qualified meeting"],
    },
    "Customer Support & Retention": {
      build: [
        "We load your knowledge base and policy rules.",
        "We set response time targets and escalation paths.",
        "We connect your help desk and test with sample tickets.",
        "We agree what agents resolve and what they escalate.",
      ],
      kpis: ["First response time", "Resolution rate", "Satisfaction score"],
    },
    "CRM Setup & Operations": {
      build: [
        "We audit your data: duplicates, missing fields, stale records.",
        "We agree field standards and naming rules with you.",
        "We clean a copy first. You approve before anything goes live.",
        "We set recurring data quality checks.",
      ],
      kpis: ["Records cleaned", "Duplicate rate", "Field completion"],
    },
  };

  const LAUNCH_GATE = [
    "Contract and scope signed",
    "Success metrics written and agreed with you",
    "All system access working and tested",
    "Scripts, templates and rules approved by you in writing",
    "Agents assigned, languages confirmed, training passed",
    "QA scoring sheet ready, first review scheduled",
    "Reporting dashboard and account page set up",
    "Escalation contacts exchanged on both sides",
  ];

  // Stations on the atlas. `day` is counted from kickoff (Day 1).
  const PROCESS = [
    {
      id: "intake", phase: "onboard", day: 0, when: "Before Day 1", title: "Intake",
      what: "You answer the five intake questions: business, goal, messaging, systems and people. We write your answers down and you sign them off, so nobody works from assumptions.",
      owner: ["You"], you: "Submit the intake (done) and sign off the written version your Account Lead sends back.",
    },
    {
      id: "scope", phase: "onboard", day: 1, when: "Day 1", title: "Scope",
      what: "Intake done. Goals, market, KPIs and languages agreed in writing. Your metrics and your definition of a qualified result are signed at kickoff.",
      owner: ["Account Lead", "You"], you: "Join kickoff with your decision maker. Agree the success metrics in writing.",
    },
    {
      id: "setup", phase: "onboard", day: 3, when: "Day 3", title: "Set Up",
      what: "Team assigned. CRM, calendar and reporting connected. We work from a day-by-day access list. If something is late, we escalate to your decision maker on day 5.",
      owner: ["Delivery Lead", "You"], you: "Your technical contact grants system access: CRM or help desk, calendar, email domain, call or ticket tools.",
    },
    {
      id: "calibrate", phase: "onboard", day: 7, when: "Day 7", title: "Calibrate",
      what: "Team trained on your product, tone and scripts. Training is a gate item, not a suggestion. Nobody speaks to your customers until they have passed.",
      owner: ["Delivery Lead", "You"], you: "Your script approver signs off scripts, templates and rules in writing.",
    },
    {
      id: "gate", phase: "onboard", day: 9, when: "Before Day 10", title: "Launch gate",
      what: "Eight checks. No exceptions. Your Account Lead signs the launch gate. If anything is missing, we hold the launch and tell you why. Nobody contacts your prospects or customers before it passes.",
      owner: ["Account Lead"], you: "Exchange escalation contacts and confirm anything still open.", gate: LAUNCH_GATE,
    },
    {
      id: "live", phase: "onboard", day: 10, when: "Day 10", title: "Live",
      what: "Launch gate passed. Team executing on your account, reporting daily.",
      owner: ["Delivery Lead"], you: "Watch the daily numbers and raise anything that looks off.",
    },
    {
      id: "daily", phase: "run", when: "Daily", title: "Daily rhythm",
      what: "Every call or ticket is logged. Team leads check quotas and quality. Blockers are raised the same day.",
      owner: ["Delivery Lead"], you: "Unblock anything we raise on the same day.",
    },
    {
      id: "weekly", phase: "run", when: "Weekly", title: "Weekly report",
      what: "A written report to you every week from week one: activity, results, issues and next week's plan. A sample of calls reviewed and scored. You see the numbers whether they are good or bad.",
      owner: ["Account Lead"], you: "Read the report and reply with feedback.",
    },
    {
      id: "d30", phase: "grow", day: 30, when: "Day 30", title: "Results review",
      what: "Results against your agreed metrics. A fix list. A written decision to go on or adjust.",
      owner: ["Account Lead", "You"], you: "Decide in writing: go on or adjust.",
    },
    {
      id: "d60", phase: "grow", day: 60, when: "Day 60", title: "Next service",
      what: "If targets are met, we show you the next service worth adding. If not, we fix first.",
      owner: ["Account Lead"], you: "Review the recommendation.",
    },
    {
      id: "d90", phase: "grow", day: 90, when: "Day 90 · then every quarter", title: "Business review",
      what: "A review with your decision maker: results, cost per result, plan and renewal. Then every quarter.",
      owner: ["Account Lead", "You"], you: "Bring your decision maker.",
    },
  ];

  const ROLES = [
    { name: "Account Lead", text: "One named owner. Your day-to-day contact from kickoff to the quarterly review." },
    { name: "Delivery Lead", text: "Runs your team, quality checks and daily reporting." },
    { name: "You", text: "A decision maker, a technical contact for access, and one approver for scripts." },
  ];

  const GUARDRAILS = [
    { problem: "A vague definition of success", fix: "Your metrics and your definition of a qualified result are written at intake and signed at kickoff. We measure against them." },
    { problem: "Access and approvals that drag", fix: "A day-by-day access list. If something is late, we escalate to your decision maker on day 5. The launch gate holds until it clears." },
    { problem: "Agents who launch untrained", fix: "Training is a gate item, not a suggestion. Nobody speaks to your customers until they have passed." },
    { problem: "Silence after kickoff", fix: "A written report every week from week one. You see the numbers whether they are good or bad." },
  ];

  /* ---------- Guide answers ---------- */
  // Each entry: keys (word-prefix matches; multi-word keys weigh more), and an answer built from ctx.
  // ctx = { first, company, services, dateOf(day), open (unticked checklist items), contact }
  // Lower-case the first letter for mid-sentence lists, leaving acronyms (QA, CRM) alone.
  const lc = (s) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const list = (items) => items.map(lc).join("; ");
  const dated = (ctx, day) => (ctx.dateOf(day) ? ` (${ctx.dateOf(day)})` : "");

  const ENTRIES = [
    {
      id: "next", chip: "What happens now?",
      keys: ["what happens now", "what happens next", "next step", "now what", "after submit", "what now", "submitted"],
      a: (c) =>
        `Your Account Lead reviews your intake and sends it back to you in writing to sign off. Then kickoff, which is Day 1${dated(c, 1)}. ` +
        (c.open.length
          ? `To keep the 10 days on track, line up these before kickoff: ${list(c.open.slice(0, 4))}.`
          : "Your readiness checklist is complete, so we can move straight to kickoff."),
    },
    {
      id: "timeline", chip: "How long until we're live?",
      keys: ["how long", "timeline", "10 days", "ten days", "when live", "go live", "when will", "when do we start", "launch date", "schedule", "start"],
      a: (c) =>
        `Ten days from kickoff to live. Day 1${dated(c, 1)}: Scope, goals and KPIs agreed in writing. Day 3${dated(c, 3)}: Set Up, team assigned and systems connected. ` +
        `Day 7${dated(c, 7)}: Calibrate, team trained and you approve scripts. Day 10${dated(c, 10)}: Live, once the launch gate passes.`,
    },
    {
      id: "scope", keys: ["day 1", "day one", "scope", "kickoff", "kick off"],
      a: (c) => `Day 1${dated(c, 1)} is Scope. Your intake is done, and goals, market, KPIs and languages are agreed in writing. Your metrics and definition of a qualified result are signed at kickoff, and we measure against them from then on.`,
    },
    {
      id: "setup", keys: ["day 3", "day three", "set up", "setup", "connect", "integration", "assigned"],
      a: (c) => `Day 3${dated(c, 3)} is Set Up. Your team is assigned and your CRM, calendar and reporting are connected. We work from a day-by-day access list, so your technical contact knows exactly what to grant and when.`,
    },
    {
      id: "calibrate", keys: ["day 7", "day seven", "calibrate", "calibration", "training", "train", "trained"],
      a: (c) => `Day 7${dated(c, 7)} is Calibrate. The team is trained on your product, tone and scripts, and you approve them. Training is a gate item, not a suggestion: nobody speaks to your customers until they have passed.`,
    },
    {
      id: "live", keys: ["day 10", "day ten", "go-live", "golive", "launch", "live"],
      a: (c) => `Day 10${dated(c, 10)} is Live. The launch gate has passed and the team is executing on your account, reporting daily.`,
    },
    {
      id: "gate", chip: "What is the launch gate?",
      keys: ["launch gate", "gate", "checks", "checklist", "before go live", "before we go live", "eight", "8 checks", "ready to launch"],
      a: () => `Eight checks, no exceptions, signed by your Account Lead: ${list(LAUNCH_GATE)}. If anything is missing we hold the launch and tell you why.`,
    },
    {
      id: "contactprospects", keys: ["contact my customers", "contact my prospects", "my customers", "my prospects", "calling my", "start calling", "start emailing", "reach out", "before ready", "talk to my customers", "speak to"],
      a: () => "Nobody contacts your prospects or customers before the launch gate passes. That includes training: no agent speaks to your customers until they have passed.",
    },
    {
      id: "reporting", chip: "How will you report to us?",
      keys: ["report", "reporting", "update", "dashboard", "visibility", "numbers", "weekly", "daily", "communication"],
      a: () => "Daily, every call or ticket is logged and team leads check quotas and quality, with blockers raised the same day. Weekly, you get a written report from week one: activity, results, issues and next week's plan, plus a sample of calls reviewed and scored. You also get a reporting dashboard and account page.",
    },
    {
      id: "accountlead", chip: "Who is my point of contact?",
      keys: ["account lead", "point of contact", "who do i contact", "who do i talk", "contact person", "account manager", "my contact", "owner"],
      a: () => "Your Account Lead: one named owner and your day-to-day contact from kickoff to the quarterly review. Behind them, the Delivery Lead runs your team, quality checks and daily reporting. You'll get both names at kickoff.",
    },
    {
      id: "delivery", keys: ["delivery lead", "quality", "qa", "scoring", "team lead", "supervis"],
      a: () => "The Delivery Lead runs your team, the quality checks and daily reporting. A QA scoring sheet is ready before launch, and a sample of calls is reviewed and scored every week.",
    },
    {
      id: "fromme", chip: "What do you need from me?",
      keys: ["need from me", "need from us", "what do i need", "my role", "responsib", "what should i do", "do i need", "prepare", "my side"],
      a: (c) =>
        "Three people on your side: a decision maker, a technical contact for access, and one approver for scripts. " +
        (c.open.length ? `From your checklist, still open: ${list(c.open)}.` : "Your checklist is complete. Thank you."),
    },
    {
      id: "access", keys: ["access", "permission", "login", "credential", "crm", "help desk", "helpdesk", "hubspot", "salesforce", "zendesk", "calendar", "email domain", "tools", "system"],
      a: () => "Your technical contact grants access to your CRM or help desk, calendar, email domain and call or ticket tools, following a day-by-day access list. All access must be working and tested before the launch gate. If something is late, we escalate to your decision maker on day 5.",
    },
    {
      id: "scripts", keys: ["script", "pitch", "messag", "template", "tone", "brand", "approve", "approval", "objection", "never say"],
      a: () => "We write the scripts and templates from your approved pitch, objections, proof points and brand rules. Your one script approver signs them off in writing before launch, including what agents must never say or promise.",
    },
    {
      id: "teamsize", keys: ["how many agents", "team size", "how many people", "headcount", "agents", "scale", "grow the team", "add more"],
      a: () => "Most clients start with two or three agents and grow from there as the results come in. Agents are assigned and languages confirmed before launch.",
    },
    {
      id: "sdr", keys: ["sdr", "lead gen", "lead generation", "outbound", "meetings", "target list", "prospect list", "booking", "appointments", "cold"],
      a: () => `For SDR and lead generation: ${SERVICE_SETUP["SDR & Lead Generation"].build.join(" ")} Day 30 targets are set with you: meetings per week, show rate and cost per qualified meeting.`,
    },
    {
      id: "support", keys: ["support", "tickets", "ticket", "customer service", "retention", "knowledge base", "escalat"],
      a: () => `For customer support and retention: ${SERVICE_SETUP["Customer Support & Retention"].build.join(" ")} Day 30 targets are set with you: first response time, resolution rate and satisfaction score.`,
    },
    {
      id: "crmops", keys: ["crm setup", "crm ops", "data clean", "clean", "duplicates", "dedup", "data quality", "fields", "records"],
      a: () => `For CRM setup and operations: ${SERVICE_SETUP["CRM Setup & Operations"].build.join(" ")} Day 30 targets are set with you: records cleaned, duplicate rate and field completion.`,
    },
    {
      id: "kpis", keys: ["kpi", "target", "metric", "success", "qualified", "goal", "measure"],
      a: () => "Targets are set with you per account, never copied from a template. Your metrics and your written definition of a qualified result are agreed at intake and signed at kickoff. We don't launch until they're written and you've agreed to them.",
    },
    {
      id: "missed", keys: ["miss", "not working", "underperform", "fail", "bad results", "don't hit", "dont hit", "doesn't work", "not happy", "guarantee"],
      a: () => "At Day 30 you get results against your agreed metrics, a fix list and a written decision to go on or adjust. At Day 60, if targets aren't met we fix first before suggesting anything new. And the weekly report shows you the numbers whether they are good or bad.",
    },
    {
      id: "d30", keys: ["day 30", "30 days", "first month", "results review"],
      a: (c) => `Day 30${dated(c, 30)} is the results review: results against your targets, a fix list, and a written decision to go on or adjust.`,
    },
    {
      id: "d60", keys: ["day 60", "60 days", "next service", "add a service", "upsell", "expand"],
      a: (c) => `Day 60${dated(c, 60)}: if targets are met, we show you the next service worth adding. If not, we fix first.`,
    },
    {
      id: "d90", keys: ["day 90", "90 days", "quarter", "business review", "qbr", "renewal", "renew"],
      a: (c) => `Day 90${dated(c, 90)} is the business review with your decision maker: results, cost per result, plan and renewal. Then it repeats every quarter.`,
    },
    {
      id: "delays", keys: ["delay", "late", "stall", "slow", "behind", "hold up", "blocked"],
      a: () => "A vague goal is the most common reason onboarding stalls, which is why we write your metrics down and get them signed. For access and approvals there's a day-by-day list, and anything late is escalated to your decision maker on day 5. The launch gate holds until it clears.",
    },
    {
      id: "languages", keys: ["language", "arabic", "french", "english", "market", "countr", "region", "europe", "mena", "time zone", "timezone"],
      a: () => "We serve the US, Europe and MENA from Beirut. Your languages are agreed in writing at Day 1, and agents' languages are confirmed as part of the launch gate.",
    },
    {
      id: "iso", keys: ["iso", "certif", "standard", "quality management", "accredit"],
      a: () => "Vanguard Services SAL is ISO 9001:2015 certified. Quality is built into the process: a QA scoring sheet before launch, daily quality checks and weekly scored call samples.",
    },
    {
      id: "location", keys: ["where are you", "based", "location", "office", "beirut", "lebanon"],
      a: () => "We're headquartered in Beirut, Lebanon, serving clients in the US, Europe and MENA.",
    },
    {
      id: "edit", keys: ["change my answer", "edit", "change", "update my", "mistake", "wrong", "correct"],
      a: () => "No problem. Your Account Lead sends your answers back in writing for sign-off, so you can correct anything then. You can also tell me here and I'll pass it on with your questions.",
    },
    {
      id: "contact", chip: "How do I reach you?",
      keys: ["phone", "call you", "email you", "reach", "contact", "book a call", "talk to someone", "human", "speak"],
      a: (c) => `Phone ${c.contact.phone}, email ${c.contact.infoEmail}, or ${c.contact.website.replace(/^https?:\/\//, "")}. Once you're onboarded, your Account Lead is your direct line.`,
    },
    {
      id: "pricing", escalate: true, keys: ["price", "pricing", "cost", "invoice", "billing", "pay", "fee", "contract terms", "discount"],
      a: () => "Pricing and billing are set in your contract, so your Account Lead will answer that one directly. I've logged your question and it goes to the team now.",
    },
    {
      id: "security", escalate: true, keys: ["security", "secure", "gdpr", "nda", "confidential", "privacy", "data protection", "compliance"],
      a: () => "That's one for your Account Lead to answer properly, in writing. I've logged your question and it goes to the team now.",
    },
    {
      id: "hello", exact: true, keys: ["hello", "hi", "hey", "good morning", "good afternoon"],
      a: (c) => `Hi ${c.first || "there"}. Ask me anything about your onboarding: the 10 days, what we need from you, reporting, or the launch gate.`,
    },
    {
      id: "thanks", exact: true, keys: ["thank", "thanks", "great", "perfect", "got it", "makes sense"],
      a: () => "Glad that helps. If that's everything, tap “No more questions” to see the full map of how it all runs.",
    },
  ];

  const FALLBACK = "Good question. That one needs your Account Lead, so I've logged it and it goes to the team with your intake. Anything else about the 10 days, reporting or what we need from you?";

  function normalise(s) {
    return " " + String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function answer(question, ctx) {
    const text = normalise(question);
    let best = null;
    let bestScore = 0;
    for (const e of ENTRIES) {
      let score = 0;
      for (const k of e.keys) {
        const re = new RegExp("(^|\\s)" + esc(k.trim()) + (e.exact ? "(?=\\s)" : ""), "i");
        if (re.test(text)) score += k.trim().split(" ").length;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return { id: "fallback", text: FALLBACK, escalate: true };
    return { id: best.id, text: best.a(ctx), escalate: !!best.escalate };
  }

  window.VG_KB = {
    SERVICE_SETUP, LAUNCH_GATE, PROCESS, ROLES, GUARDRAILS,
    chips: ENTRIES.filter((e) => e.chip).map((e) => e.chip),
    answer,
  };
})();
