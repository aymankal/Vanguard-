"""Vanguard Copilot: an assistant that reads and updates the CRM.

With an Anthropic credential it runs Claude with CRM tools (search, look up records,
agenda, pipeline, create tasks, log activities, set follow-ups, move deals, write notes).
Without one it falls back to a built-in intent engine that covers the everyday requests,
so the assistant always answers.
"""

import datetime as dt
import json
import logging
import os
import re
from typing import Any, Callable, Optional

from fastapi import HTTPException

from . import notetaker

log = logging.getLogger("crm.assistant")
MAX_TURNS = 8
HISTORY_LIMIT = 12


def _m():
    from . import main  # imported lazily: main imports this module for its route

    return main


def today() -> dt.date:
    return dt.date.today()


def link(kind: str, rec_id: int, label: str) -> str:
    return f"[{label}](#/{kind}/{rec_id})"


def money(v: float) -> str:
    return f"${v:,.0f}"


# ================================================================ CRM tools
# Each tool returns (json-able result, optional action card for the UI).

def t_search(query: str) -> tuple[Any, None]:
    return _m().search(query), None


def t_get_contact(contact_id: int):
    c = _m().get_contact(int(contact_id))
    c["timeline"] = c["timeline"][:10]
    c["notes"] = [{"id": n["id"], "title": n["title"], "summary": n.get("summary"), "body": n["body"][:600]}
                  for n in c["notes"][:5]]
    return c, None


def t_get_company(company_id: int):
    co = _m().get_company(int(company_id))
    co["timeline"] = co["timeline"][:10]
    return co, None


def t_get_deal(deal_id: int):
    d = _m().get_deal(int(deal_id))
    d["timeline"] = d["timeline"][:10]
    return d, None


def t_agenda():
    s = _m().stats()
    keys = ["overdue_tasks", "due_today", "agenda", "follow_ups", "stale_deals", "at_risk", "renewals",
            "weighted_pipeline", "open_pipeline", "won_this_month"]
    return {k: s[k] for k in keys}, None


def t_pipeline(owner: str = ""):
    m = _m()
    s = m.stats()
    deals = m.list_deals(owner=owner)
    top = [{k: d[k] for k in ("id", "title", "stage", "value", "probability", "close_date", "next_step",
                              "company_name", "stale", "days_since_activity")}
           for d in deals if d["is_open"]][:12]
    return {"by_stage": s["by_stage"], "weighted_pipeline": s["weighted_pipeline"], "open_pipeline": s["open_pipeline"],
            "win_rate": s["win_rate"], "forecast": s["forecast"], "open_deals": top}, None


def t_list_tasks(scope: str = "open"):
    tasks = _m().list_tasks(done=False)
    t = today().isoformat()
    week = (today() + dt.timedelta(days=7)).isoformat()
    pick = {
        "overdue": lambda x: x["due_date"] and x["due_date"] < t,
        "today": lambda x: x["due_date"] == t,
        "week": lambda x: x["due_date"] and x["due_date"] <= week,
    }.get(scope, lambda x: True)
    return [x for x in tasks if pick(x)][:40], None


def t_create_task(text: str, due_date: str = "", priority: str = "", contact_id: Optional[int] = None,
                  deal_id: Optional[int] = None):
    m = _m()
    task = m.create_task(m.TaskIn(text=text, due_date=due_date or "", priority=priority or "",
                                  contact_id=contact_id, deal_id=deal_id))
    due = f" · due {task['due_date']}" if task["due_date"] else ""
    return task, {"kind": "task", "label": f"Task created: {task['text']}{due}", "href": "#/tasks"}


def t_log_activity(type: str, subject: str = "", body: str = "", outcome: str = "",
                   contact_id: Optional[int] = None, deal_id: Optional[int] = None,
                   follow_up_text: str = "", follow_up_date: str = ""):
    m = _m()
    a = m.create_activity(m.ActivityIn(type=type, subject=subject, body=body, outcome=outcome,
                                       contact_id=contact_id, deal_id=deal_id,
                                       follow_up_text=follow_up_text, follow_up_date=follow_up_date))
    href = f"#/contacts/{a['contact_id']}" if a["contact_id"] else (f"#/deals/{a['deal_id']}" if a["deal_id"] else "#/")
    who = f" with {a['contact_name']}" if a["contact_name"] else ""
    return a, {"kind": "activity", "label": f"Logged {type}{who}: {a['subject']}", "href": href}


def t_set_follow_up(contact_id: int, date: str):
    m = _m()
    c = m.update_contact(int(contact_id), m.ContactIn(next_follow_up=date))
    return c, {"kind": "follow_up", "label": f"Follow-up with {c['name']} set for {date}",
               "href": f"#/contacts/{c['id']}"}


def t_move_deal(deal_id: int, stage: str, lost_reason: str = ""):
    m = _m()
    d = m.update_deal(int(deal_id), m.DealIn(stage=stage, lost_reason=lost_reason or None))
    return d, {"kind": "deal", "label": f"{d['title']} → {stage}", "href": f"#/deals/{d['id']}"}


def t_create_note(title: str, body: str, contact_id: Optional[int] = None, deal_id: Optional[int] = None,
                  kind: str = "note"):
    m = _m()
    n = m.create_note(m.NoteIn(title=title, body=body, contact_id=contact_id, deal_id=deal_id, kind=kind))
    return {"id": n["id"], "title": n["title"]}, {"kind": "note", "label": f"Note saved: {n['title']}",
                                                  "href": f"#/notes/{n['id']}"}


def _opt_int(desc: str) -> dict:
    return {"type": "integer", "description": desc}


TOOLS: dict[str, tuple[Callable, dict]] = {
    "search_crm": (t_search, {
        "description": "Search contacts, companies, deals, notes and open tasks by name or keyword. Use this to find ids.",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}),
    "get_contact": (t_get_contact, {
        "description": "Full profile of a contact: details, relationship health with reasons, deals, open tasks, recent timeline and notes.",
        "input_schema": {"type": "object", "properties": {"contact_id": {"type": "integer"}}, "required": ["contact_id"]}}),
    "get_company": (t_get_company, {
        "description": "Company account: contract value, renewal date, health, people, deals, tasks, timeline.",
        "input_schema": {"type": "object", "properties": {"company_id": {"type": "integer"}}, "required": ["company_id"]}}),
    "get_deal": (t_get_deal, {
        "description": "Deal details: stage, value, probability, close date, next step, notes, tasks, timeline.",
        "input_schema": {"type": "object", "properties": {"deal_id": {"type": "integer"}}, "required": ["deal_id"]}}),
    "today_agenda": (t_agenda, {
        "description": "What needs attention now: overdue and due-today tasks, follow-ups due, deals going cold, at-risk accounts, renewals, headline numbers.",
        "input_schema": {"type": "object", "properties": {}}}),
    "pipeline_summary": (t_pipeline, {
        "description": "Pipeline by stage, weighted forecast by month, win rate and the open deals (optionally for one owner).",
        "input_schema": {"type": "object", "properties": {"owner": {"type": "string"}}}}),
    "list_tasks": (t_list_tasks, {
        "description": "Open tasks. scope: overdue, today, week (due within 7 days) or open (all).",
        "input_schema": {"type": "object", "properties": {"scope": {"type": "string", "enum": ["overdue", "today", "week", "open"]}}}}),
    "create_task": (t_create_task, {
        "description": "Create a task. due_date is YYYY-MM-DD. Link it to a contact and/or deal when the user mentions one.",
        "input_schema": {"type": "object", "properties": {
            "text": {"type": "string"}, "due_date": {"type": "string"},
            "priority": {"type": "string", "enum": ["high", "normal", "low"]},
            "contact_id": _opt_int("Contact to link"), "deal_id": _opt_int("Deal to link")}, "required": ["text"]}}),
    "log_activity": (t_log_activity, {
        "description": "Record a call, email, meeting, LinkedIn or SMS touch on the timeline, optionally with a follow-up task.",
        "input_schema": {"type": "object", "properties": {
            "type": {"type": "string", "enum": ["call", "email", "meeting", "linkedin", "sms", "note"]},
            "subject": {"type": "string"}, "body": {"type": "string"},
            "outcome": {"type": "string", "description": "e.g. connected, voicemail, replied, held, meeting booked"},
            "contact_id": _opt_int("Contact"), "deal_id": _opt_int("Deal"),
            "follow_up_text": {"type": "string"}, "follow_up_date": {"type": "string", "description": "YYYY-MM-DD"}},
            "required": ["type"]}}),
    "set_follow_up": (t_set_follow_up, {
        "description": "Set a contact's next follow-up date (YYYY-MM-DD).",
        "input_schema": {"type": "object", "properties": {"contact_id": {"type": "integer"}, "date": {"type": "string"}},
                         "required": ["contact_id", "date"]}}),
    "move_deal": (t_move_deal, {
        "description": "Move a deal to a stage: lead, qualified, proposal, negotiation, won or lost (give lost_reason).",
        "input_schema": {"type": "object", "properties": {
            "deal_id": {"type": "integer"},
            "stage": {"type": "string", "enum": ["lead", "qualified", "proposal", "negotiation", "won", "lost"]},
            "lost_reason": {"type": "string"}}, "required": ["deal_id", "stage"]}}),
    "create_note": (t_create_note, {
        "description": "Save a note. Lines like '[ ] text @YYYY-MM-DD !high' in the body become tasks.",
        "input_schema": {"type": "object", "properties": {
            "title": {"type": "string"}, "body": {"type": "string"},
            "kind": {"type": "string", "enum": ["note", "meeting", "call", "idea"]},
            "contact_id": _opt_int("Contact"), "deal_id": _opt_int("Deal")}, "required": ["title", "body"]}}),
}


def run_tool(name: str, args: dict) -> tuple[str, Optional[dict], bool]:
    """Returns (result text for the model, action card, is_error)."""
    if name not in TOOLS:
        return f"Unknown tool {name}", None, True
    try:
        result, action = TOOLS[name][0](**args)
        return json.dumps(result, default=str)[:30000], action, False
    except HTTPException as exc:
        return f"Error: {exc.detail}", None, True
    except (TypeError, ValueError) as exc:
        return f"Error: bad input ({exc})", None, True


# ============================================================ page context
def describe_context(ctx: dict) -> str:
    view, rec = ctx.get("view"), ctx.get("id")
    try:
        rec = int(rec) if rec else None
    except ValueError:
        rec = None
    m = _m()
    try:
        if view == "contacts" and rec:
            c = m.get_contact(rec)
            return f"The user is viewing contact {c['name']} (contact_id={c['id']}, company {c['company'] or '—'})."
        if view == "companies" and rec:
            co = m.get_company(rec)
            return f"The user is viewing company {co['name']} (company_id={co['id']})."
        if view == "deals" and rec:
            d = m.get_deal(rec)
            return f"The user is viewing deal {d['title']} (deal_id={d['id']}, contact_id={d['contact_id']})."
        if view == "notes" and rec:
            n = m.get_note(rec)
            return f"The user is viewing note \"{n['title']}\" (note_id={n['id']}, contact_id={n['contact_id']})."
    except HTTPException:
        pass
    return f"The user is on the {view or 'dashboard'} page."


# ============================================================ Claude path
def system_prompt(ctx: dict) -> str:
    return (
        "You are Vanguard Copilot, the assistant inside Vanguard Services' CRM. Vanguard is a Beirut-based "
        "outsourcing company selling SDR teams, sales outsourcing and customer support to international "
        "clients. You help account managers and SDRs run their day: prioritise, prep for calls, update the "
        "CRM and draft client communication.\n\n"
        f"Today is {today():%A %Y-%m-%d}. {describe_context(ctx)}\n\n"
        "Rules:\n"
        "- Use the tools for every fact about records; never invent names, numbers or dates.\n"
        "- When the user asks you to change something (task, activity, follow-up, deal stage, note), do it "
        "with the tools, then confirm in one line what changed. Resolve relative dates to YYYY-MM-DD.\n"
        "- If a name matches several records, ask which one instead of guessing.\n"
        "- Be direct and brief: short paragraphs or bullets, lead with the answer. No filler.\n"
        "- Link records as markdown links: contacts [Name](#/contacts/ID), companies [Name](#/companies/ID), "
        "deals [Title](#/deals/ID), notes [Title](#/notes/ID), tasks page [tasks](#/tasks).\n"
        "- Client-facing drafts: plain text, warm and concise, no internal risks or opinions about the client."
    )


def claude_reply(message: str, history: list[dict], ctx: dict) -> Optional[dict]:
    import anthropic

    client = anthropic.Anthropic()
    messages: list[dict] = []
    for turn in history[-HISTORY_LIMIT:]:
        if turn.get("role") in ("user", "assistant") and turn.get("text"):
            if messages and messages[-1]["role"] == turn["role"]:
                messages[-1]["content"] += "\n\n" + turn["text"]
            else:
                messages.append({"role": turn["role"], "content": turn["text"]})
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages.append({"role": "user", "content": message})
    tools = [{"name": name, **spec} for name, (_, spec) in TOOLS.items()]
    actions: list[dict] = []
    try:
        for _ in range(MAX_TURNS):
            response = client.beta.messages.create(
                model=notetaker.AI_MODEL,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=system_prompt(ctx),
                tools=tools,
                messages=messages,
            )
            if response.stop_reason == "refusal":
                return {"reply": "I can't help with that request.", "actions": actions, "engine": "claude"}
            calls = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not calls:
                text = "\n\n".join(b.text for b in response.content if b.type == "text").strip()
                return {"reply": text or "Done.", "actions": actions, "engine": "claude"}
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for call in calls:
                content, action, is_error = run_tool(call.name, dict(call.input or {}))
                if action:
                    actions.append(action)
                results.append({"type": "tool_result", "tool_use_id": call.id, "content": content, "is_error": is_error})
            messages.append({"role": "user", "content": results})
        return {"reply": "That took more steps than I allow in one go. Try a narrower request.",
                "actions": actions, "engine": "claude"}
    except anthropic.APIError as exc:
        log.warning("Copilot fell back to offline mode: %s", exc)
        return None


# =========================================================== offline engine
STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"]
DATE_WORDS = r"(today|tomorrow|tmrw|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d{4}-\d{2}-\d{2}|in \d+ (?:days?|weeks?))"


def parse_when(text: str) -> tuple[str, str]:
    """Find a date phrase; return (iso date or '', text without it)."""
    m = re.search(r"\b(?:on |by |for |due )?" + DATE_WORDS + r"\b", text, re.I)
    if not m:
        return "", text
    phrase = m.group(1).lower()
    n = re.match(r"in (\d+) (day|week)", phrase)
    if n:
        token = f"+{n.group(1)}{'w' if n.group(2) == 'week' else 'd'}"
    else:
        token = {"next week": "nextweek"}.get(phrase, phrase)
    iso = notetaker.resolve_date(token)
    return iso, (text[:m.start()] + text[m.end():]).strip()


def find_entities(text: str) -> dict[str, list[dict]]:
    """Records whose name (or a contact's first name) appears in the text."""
    m = _m()
    low = f" {text.lower()} "
    hits = {"contacts": [], "companies": [], "deals": []}

    def said(phrase: str) -> bool:
        phrase = phrase.lower().strip()
        return len(phrase) >= 3 and re.search(r"(?<![\w])" + re.escape(phrase) + r"(?![\w])", low) is not None

    for c in m.list_contacts():
        if said(c["name"]) or said(c["name"].split()[0]):
            hits["contacts"].append(c)
    for co in m.list_companies():
        if said(co["name"]) or said(co["name"].split()[0]):
            hits["companies"].append(co)
    for d in m.list_deals():
        if said(d["title"]) or said(d["title"].split(" — ")[0]):
            hits["deals"].append(d)
    return hits


def context_record(ctx: dict) -> tuple[str, Optional[int]]:
    try:
        return ctx.get("view") or "", int(ctx["id"]) if ctx.get("id") else None
    except (ValueError, TypeError):
        return ctx.get("view") or "", None


def pick_contact(hits: dict, ctx: dict) -> Optional[dict]:
    if hits["contacts"]:
        return hits["contacts"][0]
    m = _m()
    if hits["companies"]:
        people = m.list_contacts(company_id=hits["companies"][0]["id"])
        if people:
            return people[0]
    if hits["deals"] and hits["deals"][0]["contact_id"]:
        return m.get_contact(hits["deals"][0]["contact_id"])
    view, rec = context_record(ctx)
    if view == "contacts" and rec:
        return m.get_contact(rec)
    if view == "deals" and rec:
        d = m.get_deal(rec)
        return m.get_contact(d["contact_id"]) if d["contact_id"] else None
    if view == "notes" and rec:
        n = m.get_note(rec)
        return m.get_contact(n["contact_id"]) if n["contact_id"] else None
    return None


def pick_deal(hits: dict, ctx: dict) -> Optional[dict]:
    m = _m()
    if hits["deals"]:
        return hits["deals"][0]
    open_for = lambda f: [d for d in m.list_deals() if d["is_open"] and f(d)]  # noqa: E731
    if hits["companies"]:
        found = open_for(lambda d: d["company_id"] == hits["companies"][0]["id"])
        if found:
            return found[0]
    if hits["contacts"]:
        found = open_for(lambda d: d["contact_id"] == hits["contacts"][0]["id"])
        if found:
            return found[0]
    view, rec = context_record(ctx)
    if view == "deals" and rec:
        return m.get_deal(rec)
    if view == "contacts" and rec:
        found = open_for(lambda d: d["contact_id"] == rec)
        return found[0] if found else None
    return None


def task_line(t: dict) -> str:
    who = f" — {link('contacts', t['contact_id'], t['contact_name'])}" if t.get("contact_id") and t.get("contact_name") else ""
    due = f" · due {t['due_date']}" if t.get("due_date") else ""
    flag = " ‼" if t.get("priority") == "high" else ""
    return f"- {t['text']}{flag}{due}{who}"


def o_agenda(_msg, _hits, _ctx):
    s = _m().stats()
    lines = []
    if s["agenda"]:
        lines.append(f"**Tasks due** ({s['overdue_tasks']} overdue, {s['due_today']} today)")
        lines += [task_line(t) for t in s["agenda"][:6]]
    if s["follow_ups"]:
        lines.append("\n**Follow-ups to send**")
        lines += [f"- {link('contacts', c['id'], c['name'])}{' · ' + c['company'] if c['company'] else ''} (due {c['next_follow_up']})"
                  for c in s["follow_ups"][:6]]
    if s["stale_deals"]:
        lines.append("\n**Deals going cold**")
        lines += [f"- {link('deals', d['id'], d['title'])}: {money(d['value'])}, quiet {d['days_since_activity']} days"
                  + (f" — next step: {d['next_step']}" if d["next_step"] else "") for d in s["stale_deals"][:4]]
    risky = [a for a in s["at_risk"] if a["health"]["label"] == "at-risk"]
    if risky:
        lines.append("\n**Accounts at risk**")
        lines += [f"- {link('companies', a['id'], a['name'])}: {a['health']['reasons'][0]}" for a in risky[:4]]
    if not lines:
        return "You're clear: nothing overdue, no follow-ups due, no deals going cold. Good time to prospect.", []
    head = "Here's what needs you today, most urgent first:\n\n"
    return head + "\n".join(lines), []


def o_pipeline(_msg, _hits, _ctx):
    s = _m().stats()
    rows = [f"- **{st}**: {s['by_stage'][st]['count']} · {money(s['by_stage'][st]['value'])}"
            for st in STAGES if s["by_stage"][st]["count"]]
    fc = ", ".join(f"{f['month']}: {money(f['weighted'])}" for f in s["forecast"]) or "no close dates set"
    win = f"{s['win_rate']}%" if s["win_rate"] is not None else "no closed deals yet"
    return (f"**Open pipeline** {money(s['open_pipeline'])} · **weighted** {money(s['weighted_pipeline'])} · "
            f"**win rate** {win}\n\n" + "\n".join(rows) + f"\n\n**Weighted forecast:** {fc}"), []


def o_stale(_msg, _hits, _ctx):
    deals = _m().stats()["stale_deals"]
    if not deals:
        return "No deals are going cold. Every open deal had activity in the last 14 days.", []
    return "These open deals have gone quiet:\n\n" + "\n".join(
        f"- {link('deals', d['id'], d['title'])}: {money(d['value'])}, {d['days_since_activity']} days without activity"
        + (f". Next step: {d['next_step']}" if d["next_step"] else "") for d in deals), []


def o_risk(_msg, _hits, _ctx):
    s = _m().stats()
    lines = [f"- {link('companies', a['id'], a['name'])} ({a['health']['label']}, {a['health']['score']}): "
             + "; ".join(a["health"]["reasons"][:2]) for a in s["at_risk"]]
    if s["renewals"]:
        lines.append("\n**Renewals in the next 90 days**")
        lines += [f"- {link('companies', r['id'], r['name'])}: {r['renewal_date']}"
                  + (f", {money(r['mrr'])}/mo" if r["mrr"] else "") for r in s["renewals"]]
    return ("Accounts needing attention:\n\n" + "\n".join(lines)) if lines else "All accounts look healthy right now.", []


def o_follow_ups(_msg, _hits, _ctx):
    s = _m().stats()
    if not s["follow_ups"]:
        return "No follow-ups are due. You can set one from any contact page or ask me: “follow up with Dana on Friday”.", []
    return "Follow-ups due now:\n\n" + "\n".join(
        f"- {link('contacts', c['id'], c['name'])}{' · ' + c['company'] if c['company'] else ''}, due {c['next_follow_up']}"
        for c in s["follow_ups"]), []


def o_tasks(msg, _hits, _ctx):
    scope = "overdue" if "overdue" in msg else "today" if "today" in msg else "week" if "week" in msg else "open"
    tasks, _ = t_list_tasks(scope)
    label = {"overdue": "overdue", "today": "due today", "week": "due this week", "open": "open"}[scope]
    if not tasks:
        return f"No tasks {label}.", []
    return f"**{len(tasks)} task{'s' if len(tasks) > 1 else ''} {label}:**\n\n" + "\n".join(task_line(t) for t in tasks[:12]), []


def o_create_task(msg, hits, ctx):
    text = re.sub(r"^\s*(please\s+)?(create|add|make|new|set)?\s*(a\s+)?(task|todo|reminder)\s*(to|:|-)?\s*", "", msg, flags=re.I)
    text = re.sub(r"^\s*remind me to\s+", "", text, flags=re.I)
    priority = "high" if re.search(r"\b(urgent|asap|high priority|important)\b", text, re.I) else ""
    text = re.sub(r"\b(urgent|asap|high priority|important)\b", "", text, flags=re.I)
    due, text = parse_when(text)
    text = re.sub(r"\s{2,}", " ", text).strip(" .,:")
    if not text:
        return "What should the task say? For example: “remind me to send Dana the pricing sheet tomorrow”.", []
    contact = pick_contact(hits, ctx) if (hits["contacts"] or hits["companies"] or ctx.get("view") in ("contacts", "deals")) else None
    deal = pick_deal(hits, ctx) if hits["deals"] or ctx.get("view") == "deals" else None
    task, action = t_create_task(text[0].upper() + text[1:], due, priority,
                                 contact["id"] if contact else None, deal["id"] if deal else None)
    where = f" for {link('contacts', contact['id'], contact['name'])}" if contact else ""
    return f"Added **{task['text']}**{where}" + (f", due {task['due_date']}" if task["due_date"] else "") + ".", [action]


def o_log(msg, hits, ctx):
    kind = next((k for k in ("call", "email", "meeting", "linkedin", "sms") if k in msg.lower()), "call")
    contact = pick_contact(hits, ctx)
    if not contact:
        return "Who was it with? Try: “log a call with Marcus: discussed pilot scope”.", []
    body = msg.split(":", 1)[1].strip() if ":" in msg else ""
    outcome = next((o for o in ("voicemail", "no answer", "connected", "replied", "meeting booked", "not interested")
                    if o in msg.lower()), "connected" if kind == "call" else "")
    a, action = t_log_activity(kind, f"{kind.title()} with {contact['name'].split()[0]}", body, outcome,
                               contact_id=contact["id"])
    return f"Logged a {kind} with {link('contacts', contact['id'], contact['name'])}" + (f" ({outcome})" if outcome else "") \
        + ". Their last-touch date is updated.", [action]


def o_set_follow_up(msg, hits, ctx):
    contact = pick_contact(hits, ctx)
    due, _ = parse_when(msg)
    if not contact:
        return "Who should I schedule the follow-up for?", []
    if not due:
        return f"When should you follow up with {contact['name']}? For example “on Friday” or “in 3 days”.", []
    _, action = t_set_follow_up(contact["id"], due)
    return f"Follow-up with {link('contacts', contact['id'], contact['name'])} set for **{due}**.", [action]


def o_move_deal(msg, hits, ctx):
    low = msg.lower()
    stage = next((s for s in STAGES if re.search(rf"\b{s}\b", low)), None)
    if not stage and re.search(r"\b(closed|signed)\b", low):
        stage = "won"
    deal = pick_deal(hits, ctx)
    if not deal:
        return "Which deal? Name the company or open the deal and ask again.", []
    if not stage:
        return f"Which stage should {deal['title']} move to? ({', '.join(STAGES)})", []
    reason = msg.split(":", 1)[1].strip() if stage == "lost" and ":" in msg else ""
    _, action = t_move_deal(deal["id"], stage, reason)
    extra = " Nice work." if stage == "won" else ""
    return f"Moved {link('deals', deal['id'], deal['title'])} to **{stage}**.{extra}", [action]


def contact_brief(c: dict) -> str:
    h = c["health"]
    lines = [f"**{link('contacts', c['id'], c['name'])}**, {c['title'] or 'contact'}"
             + (f" at {link('companies', c['company_id'], c['company'])}" if c["company_id"] else "")
             + f" · {c['status']}",
             f"- Health: **{h['label']}** ({h['score']})" + (f": {'; '.join(h['reasons'][:3])}" if h["reasons"] else ""),
             f"- Last touch: {(c['last_contacted_at'] or 'never')[:10]} · next follow-up: {c['next_follow_up'] or 'not set'}"]
    for d in [d for d in c["deals"] if d["is_open"]][:3]:
        lines.append(f"- Deal {link('deals', d['id'], d['title'])}: {d['stage']}, {money(d['value'])}"
                     + (f", next step: {d['next_step']}" if d["next_step"] else ""))
    open_tasks = [t for t in c["tasks"] if not t["done"]]
    if open_tasks:
        lines.append(f"- Open tasks: " + "; ".join(t["text"] for t in open_tasks[:3]))
    summary = next((json.loads(n["summary"]) for n in c["notes"] if n.get("summary")), None)
    if summary:
        lines.append(f"- Last meeting: {summary['summary']}")
        if summary.get("risks"):
            lines.append(f"- Watch out for: {summary['risks'][0]}")
    if h["actions"]:
        lines.append(f"\n**Suggested next step:** {h['actions'][0]}")
    return "\n".join(lines)


def o_brief(msg, hits, ctx):
    m = _m()
    view, rec = context_record(ctx)
    if hits["contacts"] or (view == "contacts" and rec and not hits["companies"] and not hits["deals"]):
        c = m.get_contact(hits["contacts"][0]["id"] if hits["contacts"] else rec)
        return contact_brief(c), []
    if hits["companies"] or (view == "companies" and rec):
        co = m.get_company(hits["companies"][0]["id"] if hits["companies"] else rec)
        h = co["health"]
        lines = [f"**{link('companies', co['id'], co['name'])}**" + (f" · {co['industry']}" if co["industry"] else ""),
                 f"- Health: **{h['label']}** ({h['score']})" + (f": {'; '.join(h['reasons'][:3])}" if h["reasons"] else ""),
                 f"- Contract: {money(co['mrr'])}/mo" if co["mrr"] else "- No contract value recorded",
                 f"- Renewal: {co['renewal_date'] or 'not set'}",
                 "- People: " + (", ".join(link("contacts", p["id"], p["name"]) for p in co["contacts"]) or "none")]
        for d in [d for d in co["deals"] if d["is_open"]][:3]:
            lines.append(f"- Deal {link('deals', d['id'], d['title'])}: {d['stage']}, {money(d['value'])}")
        if h["actions"]:
            lines.append(f"\n**Suggested next step:** {h['actions'][0]}")
        return "\n".join(lines), []
    deal = pick_deal(hits, ctx)
    if deal:
        d = m.get_deal(deal["id"])
        return (f"**{link('deals', d['id'], d['title'])}**: {d['stage']} · {money(d['value'])} at {d['probability']}% "
                f"(weighted {money(d['weighted_value'])})\n- Close date: {d['close_date'] or 'not set'} · "
                f"{d['days_in_stage']} days in stage · last activity {d['days_since_activity']} days ago\n"
                f"- Next step: {d['next_step'] or 'not set'}"
                + (f"\n- ⚠ Going cold. Advance it today." if d["stale"] else "")), []
    return "Who should I brief you on? Name a contact, company or deal, or open one and ask “brief me”.", []


def o_draft_email(msg, hits, ctx):
    contact = pick_contact(hits, ctx)
    if not contact:
        return "Who is the email for? For example: “draft a follow-up email to Priya”.", []
    c = _m().get_contact(contact["id"])
    first = c["name"].split()[0]
    summary = next((json.loads(n["summary"]) for n in c["notes"] if n.get("summary")), None)
    deal = next((d for d in c["deals"] if d["is_open"]), None)
    if summary:
        body = notetaker.offline_recap("our conversation", c["name"], c["owner"], summary)["body"]
    else:
        step = f" on {deal['title'].split(' — ')[-1]}" if deal else ""
        body = (f"Hi {first},\n\nI wanted to follow up on our last conversation{step}. "
                f"{'The next step on our side is ' + deal['next_step'].lower() + '. ' if deal and deal['next_step'] else ''}"
                f"Would you have 20 minutes this week to align on next steps?\n\nBest,\n{c['owner'] or ''}").rstrip() + "\n"
    subject = f"Following up{' — ' + c['company'] if c['company'] else ''}"
    return (f"Here's a draft for {link('contacts', c['id'], c['name'])}"
            + (f" ({c['email']})" if c["email"] else "") + ":\n\n"
            f"**Subject:** {subject}\n\n```\n{body}```\n\nSay “log it as sent” after you send it."), []


def o_log_sent(_msg, hits, ctx):
    contact = pick_contact(hits, ctx)
    if not contact:
        return "Which contact did you email?", []
    _, action = t_log_activity("email", "Follow-up email", "", "sent", contact_id=contact["id"])
    return f"Logged the email to {link('contacts', contact['id'], contact['name'])}.", [action]


def o_search(msg, _hits, _ctx):
    q = re.sub(r"^\s*(find|search( for)?|look ?up|show( me)?|where is)\s+", "", msg, flags=re.I).strip(" ?.")
    r = _m().search(q)
    lines = [f"- {link('contacts', c['id'], c['name'])}{' · ' + c['company'] if c['company'] else ''}" for c in r["contacts"]]
    lines += [f"- {link('companies', c['id'], c['name'])} (company)" for c in r["companies"]]
    lines += [f"- {link('deals', d['id'], d['title'])} ({d['stage']}, {money(d['value'])})" for d in r["deals"]]
    lines += [f"- {link('notes', n['id'], n['title'])} (note)" for n in r["notes"]]
    if not lines:
        return None
    return f"Found {len(lines)} match{'es' if len(lines) > 1 else ''} for “{q}”:\n\n" + "\n".join(lines[:12]), []


HELP = ("I'm Copilot. I can:\n\n"
        "- **Plan your day**: “what should I focus on today?”\n"
        "- **Brief you** before a call: “brief me on Northwind”\n"
        "- **Update the CRM**: “remind me to send Dana pricing tomorrow”, “log a call with Marcus: pilot scope agreed”, "
        "“move the Ferro deal to negotiation”, “follow up with Priya on Friday”\n"
        "- **Report**: “pipeline”, “deals going cold”, “accounts at risk”, “overdue tasks”\n"
        "- **Draft** client emails: “draft a follow-up to Tomás”")

INTENTS: list[tuple[str, Callable]] = [
    (r"\b(log(ged)? it as sent|mark(ed)? (it )?(as )?sent|i sent it)\b", o_log_sent),
    (r"\b(remind me|create (a )?task|add (a )?task|new task|todo|to-do)\b", o_create_task),
    (r"\blog(ged)?\b.*\b(call|email|meeting|linkedin|sms)\b|\b(i )?(just )?(called|emailed|met with)\b", o_log),
    (r"\b(move|mark|set|change|update)\b.*\b(deal|lead|qualified|proposal|negotiation|won|lost|stage)\b|\b(closed|signed)\b.*\bdeal\b", o_move_deal),
    (r"\bfollow[- ]?up with\b|\bschedule (a )?follow[- ]?up\b", o_set_follow_up),
    (r"\b(draft|write|compose)\b.*\b(email|message|recap|note to)\b|\bemail to\b", o_draft_email),
    (r"\b(brief|prep|prepare|summar|tell me about|who is|what's going on with|status of|how is)\b", o_brief),
    (r"\b(cold|stale|stuck|quiet)\b", o_stale),
    (r"\b(risk|churn|health|renewal)", o_risk),
    (r"\bfollow[- ]?ups?\b", o_follow_ups),
    (r"\b(overdue|my tasks|tasks)\b", o_tasks),
    (r"\b(pipeline|forecast|revenue|win rate|weighted|numbers)\b", o_pipeline),
    (r"\b(today|agenda|focus|priorit|what should i|plan my day|morning|start)\b", o_agenda),
    (r"^\s*(hi|hello|hey|help|what can you do)\b", lambda *_: (HELP, [])),
]


def offline_reply(message: str, ctx: dict) -> dict:
    low = message.lower()
    hits = find_entities(message)
    for pattern, handler in INTENTS:
        if re.search(pattern, low):
            reply, actions = handler(message, hits, ctx)
            return {"reply": reply, "actions": actions, "engine": "offline"}
    if any(hits.values()):
        reply, actions = o_brief(message, hits, ctx)
        return {"reply": reply, "actions": actions, "engine": "offline"}
    found = o_search(message, hits, ctx)
    if found:
        return {"reply": found[0], "actions": [], "engine": "offline"}
    return {"reply": "I didn't catch that. " + HELP, "actions": [], "engine": "offline"}


# ================================================================ entry
def suggestions(ctx: dict) -> list[str]:
    view, rec = context_record(ctx)
    if view == "contacts" and rec:
        return ["Brief me on this contact", "Draft a follow-up email", "Remind me to call them tomorrow", "Log a call: left voicemail"]
    if view == "companies" and rec:
        return ["Brief me on this account", "What's the renewal risk?", "Draft a check-in email"]
    if view == "deals" and rec:
        return ["Brief me on this deal", "Move this deal to negotiation", "Remind me to send the proposal Friday"]
    if view == "pipeline":
        return ["Which deals are going cold?", "Pipeline summary", "What closes this month?"]
    if view == "tasks":
        return ["What's overdue?", "Plan my day", "Remind me to prep the QBR on Thursday"]
    return ["What should I focus on today?", "Which accounts are at risk?", "Pipeline summary", "Who do I need to follow up with?"]


def reply(message: str, history: list[dict], ctx: dict) -> dict:
    message = message.strip()
    if notetaker.ai_available():
        result = claude_reply(message, history, ctx)
        if result is not None:
            return result
    return offline_reply(message, ctx)
