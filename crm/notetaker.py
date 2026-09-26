"""Note-taking intelligence: action-item parsing, templates and meeting summaries.

Summaries use Claude when ANTHROPIC_API_KEY (or another Anthropic credential) is
configured and fall back to a deterministic, offline extractor otherwise, so the
feature always works.
"""

import datetime as dt
import logging
import os
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

log = logging.getLogger("crm.notetaker")

AI_MODEL = os.environ.get("CRM_AI_MODEL", "claude-opus-5")

# ------------------------------------------------------------ action items
CHECKBOX = re.compile(r"^\s*(?:[-*]\s*)?\[( |x|X)\]\s*(.+?)\s*$")
DUE_TOKEN = re.compile(r"(?:^|\s)(?:@|due:)(\S+)", re.I)
PRIORITY_TOKEN = re.compile(r"(?:^|\s)!(high|urgent|low)\b", re.I)
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def resolve_date(token: str, today: Optional[dt.date] = None) -> str:
    """Turn `2026-10-01`, `today`, `tomorrow`, `fri`, `+3d`, `nextweek` into ISO dates."""
    today = today or dt.date.today()
    t = token.lower().strip(".,;")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
        return t
    if t in ("today", "tod"):
        return today.isoformat()
    if t in ("tomorrow", "tmr", "tmrw"):
        return (today + dt.timedelta(days=1)).isoformat()
    if t in ("nextweek", "next-week"):
        return (today + dt.timedelta(days=7 - today.weekday())).isoformat()
    m = re.fullmatch(r"\+(\d+)([dw])", t)
    if m:
        n = int(m.group(1)) * (7 if m.group(2) == "w" else 1)
        return (today + dt.timedelta(days=n)).isoformat()
    for i, day in enumerate(WEEKDAYS):
        if t.startswith(day):
            ahead = (i - today.weekday()) % 7 or 7
            return (today + dt.timedelta(days=ahead)).isoformat()
    return ""


def parse_task_line(text: str, today: Optional[dt.date] = None) -> dict:
    """Split `Send pricing @fri !high` into clean text, due date and priority."""
    due = ""
    for m in DUE_TOKEN.finditer(text):
        resolved = resolve_date(m.group(1), today)
        if resolved:
            due = resolved
            text = text.replace(m.group(0), " ", 1)
    priority = "normal"
    m = PRIORITY_TOKEN.search(text)
    if m:
        priority = "low" if m.group(1).lower() == "low" else "high"
        text = text.replace(m.group(0), " ", 1)
    return {"text": " ".join(text.split()), "due_date": due, "priority": priority}


def extract_tasks(body: str) -> list[dict]:
    found = []
    for line in body.splitlines():
        m = CHECKBOX.match(line)
        if m:
            item = parse_task_line(m.group(2))
            if item["text"]:
                item["done"] = m.group(1).lower() == "x"
                found.append(item)
    return found


def set_checkbox(body: str, text: str, done: bool) -> str:
    """Tick or untick the checklist line whose cleaned text matches `text`."""
    out = []
    for line in body.splitlines():
        m = CHECKBOX.match(line)
        if m and parse_task_line(m.group(2))["text"] == text:
            start = m.start(1)
            line = line[:start] + ("x" if done else " ") + line[start + 1 :]
        out.append(line)
    return "\n".join(out)


# --------------------------------------------------------------- templates
TEMPLATES = [
    {
        "id": "discovery",
        "name": "Discovery call",
        "kind": "call",
        "body": (
            "## Context\nWho they are, how they found us.\n\n"
            "## Pain\nWhat is broken today? Cost of doing nothing?\n\n"
            "## Current setup\nIn-house team / other vendor / nothing.\n\n"
            "## Qualification (BANT)\n- Budget: \n- Authority: \n- Need: \n- Timeline: \n\n"
            "## Objections\n\n"
            "## Decisions\n\n"
            "## Next steps\n[ ] Send recap + proposal @+2d !high\n[ ] Book follow-up call @nextweek\n"
        ),
    },
    {
        "id": "sdr-scoping",
        "name": "SDR team scoping",
        "kind": "meeting",
        "body": (
            "## ICP & markets\nIndustries, geos (US / EU / MENA), languages (EN / FR / AR).\n\n"
            "## Volume targets\n- Meetings / month: \n- Headcount: \n- Ramp date: \n\n"
            "## Tooling\nCRM, sequencer (Apollo / Outreach), dialer, data source.\n\n"
            "## Commercials\nPricing model, contract length, pilot scope.\n\n"
            "## Decisions\n\n"
            "## Next steps\n[ ] Draft SOW @+3d !high\n[ ] Share candidate profiles @nextweek\n"
        ),
    },
    {
        "id": "qbr",
        "name": "Client check-in / QBR",
        "kind": "meeting",
        "body": (
            "## Results since last review\n- Meetings booked: \n- Pipeline created: \n- Show rate: \n\n"
            "## What is working\n\n## What is not\n\n"
            "## Risks\nChurn signals, stakeholder changes, budget.\n\n"
            "## Expansion opportunities\n\n"
            "## Decisions\n\n"
            "## Next steps\n[ ] Send QBR deck + recap @+1d\n"
        ),
    },
    {
        "id": "cold-call",
        "name": "Cold call log",
        "kind": "call",
        "body": (
            "Outcome: connected / voicemail / gatekeeper / not interested\n\n"
            "## Notes\n\n"
            "## Objection\n\n"
            "## Next steps\n[ ] Follow-up email @today\n"
        ),
    },
    {
        "id": "internal",
        "name": "Internal meeting",
        "kind": "meeting",
        "body": "## Agenda\n1. \n\n## Discussion\n\n## Decisions\n\n## Action items\n[ ] \n",
    },
]


# --------------------------------------------------------------- summaries
class ActionItem(BaseModel):
    text: str = Field(description="Imperative, specific action, e.g. 'Send pricing sheet to Dana'")
    owner: str = Field(description="Person responsible, or empty string if unknown")
    due_date: str = Field(description="YYYY-MM-DD if a date is stated or clearly implied, else empty string")


class NoteSummary(BaseModel):
    summary: str = Field(description="2-4 sentence executive summary of the conversation")
    decisions: list[str] = Field(description="Decisions or agreements reached")
    action_items: list[ActionItem] = Field(description="Concrete follow-ups")
    risks: list[str] = Field(description="Objections, risks, blockers or churn signals")
    next_step: str = Field(description="The single most important next step")
    sentiment: Literal["positive", "neutral", "negative"]


SYSTEM_PROMPT = (
    "You are the note-taker inside a B2B sales CRM used by an outsourcing company that "
    "sells SDR teams, sales outsourcing and customer support. Turn raw meeting or call "
    "notes into a crisp record a sales manager can act on. Only use facts present in the "
    "notes; never invent names, numbers or dates. Resolve relative dates against the "
    "meeting date given. Keep every item short. Leave lists empty when nothing applies."
)

POSITIVE = ("great", "excited", "love", "agreed", "approved", "on track", "strong", "happy", "signed", "yes")
NEGATIVE = ("concern", "worried", "unhappy", "churn", "cancel", "risk", "blocker", "delay", "no budget", "frustrat", "not interested", "competitor")
DECISION_PREFIX = re.compile(r"^\s*(?:[-*]\s*)?(decisions?|decided|agreed|approved)\b", re.I)
DECISION_LABEL = re.compile(r"^(decisions?|decided)\s*[:\-]\s*", re.I)
ACTION_PREFIX = re.compile(r"^\s*(?:[-*]\s*)?(todo|action|ai|follow[- ]up|next step)\s*[:\-]\s*", re.I)
RISK_WORDS = ("concern", "risk", "objection", "blocker", "worried", "competitor", "churn", "delay", "cheaper")
SKIP_SECTIONS = ("attendee", "agenda", "participants")


def _sections(body: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"": []}
    current = ""
    for line in body.splitlines():
        heading = re.match(r"^\s*#{1,6}\s+(.+?)\s*$", line)
        if heading:
            current = heading.group(1).lower()
            sections.setdefault(current, [])
        elif line.strip():
            sections[current].append(line.strip())
    return sections


def _clean(line: str) -> str:
    return re.sub(r"^\s*(?:[-*\d.]+\s+)", "", line).strip()


def heuristic_summary(body: str) -> dict:
    sections = _sections(body)
    decisions, actions, risks, prose = [], [], [], []
    for heading, lines in sections.items():
        roster = any(k in heading for k in SKIP_SECTIONS)
        for line in lines:
            if roster and not re.search(r"[.!?]\s*(#\w+\s*)*$", line):
                continue
            checkbox = CHECKBOX.match(line)
            if checkbox:
                if checkbox.group(1) == " ":
                    item = parse_task_line(checkbox.group(2))
                    if item["text"]:
                        actions.append({"text": item["text"], "owner": "", "due_date": item["due_date"]})
                continue
            if "decision" in heading or DECISION_PREFIX.match(line):
                text = DECISION_LABEL.sub("", _clean(line)).strip()
                if text:
                    decisions.append(text)
                continue
            if ACTION_PREFIX.match(line) or "next step" in heading or "action" in heading:
                text = ACTION_PREFIX.sub("", _clean(line)).strip()
                if text:
                    actions.append({"text": text, "owner": "", "due_date": ""})
                continue
            if "risk" in heading or "objection" in heading or any(w in line.lower() for w in RISK_WORDS):
                risks.append(_clean(line))
                if "risk" in heading or "objection" in heading:
                    continue
            if not re.search(r":\s*$", line) and not re.match(r"^[-*]\s", line):
                prose.append(_clean(line))
    text = " ".join(prose)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    summary = " ".join(s for s in sentences[:3] if s).strip()
    lower = body.lower()
    score = sum(lower.count(w) for w in POSITIVE) - sum(lower.count(w) for w in NEGATIVE)
    return {
        "summary": summary or "No narrative content yet.",
        "decisions": decisions[:8],
        "action_items": actions[:12],
        "risks": list(dict.fromkeys(risks))[:6],
        "next_step": actions[0]["text"] if actions else "",
        "sentiment": "positive" if score > 0 else "negative" if score < 0 else "neutral",
    }


def ai_available() -> bool:
    if os.environ.get("CRM_AI_DISABLED"):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def claude_parse(schema: type[BaseModel], system: str, content: str) -> Optional[dict]:
    """One structured Claude call; returns None on any failure so callers can fall back."""
    import anthropic

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.parse(
            model=AI_MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=schema,
        )
    except anthropic.APIError as exc:
        log.warning("Claude call failed, using offline fallback: %s", exc)
        return None
    if response.stop_reason == "refusal" or response.parsed_output is None:
        log.warning("Claude result unavailable (stop_reason=%s)", response.stop_reason)
        return None
    return response.parsed_output.model_dump()


def claude_summary(body: str, context: str) -> Optional[dict]:
    return claude_parse(NoteSummary, SYSTEM_PROMPT, f"{context}\n\n<notes>\n{body}\n</notes>")


def summarize(body: str, context: str = "") -> dict:
    if ai_available():
        result = claude_summary(body, context)
        if result is not None:
            return {**result, "engine": "claude"}
    return {**heuristic_summary(body), "engine": "offline"}


# ------------------------------------------------------------ recap email
class RecapEmail(BaseModel):
    subject: str = Field(description="Short, specific subject line")
    body: str = Field(description="Plain-text email body, greeting through sign-off")


RECAP_PROMPT = (
    "You write the follow-up email a salesperson sends a client right after a meeting. "
    "Write in plain text, warm but brief (under 180 words), in the language the notes are "
    "written in. Structure: thank them, 2-4 bullet recap of what was discussed, what was "
    "agreed, next steps with owners and dates, then a sign-off with the sender's name. "
    "This goes to the client: never include internal-only content such as risks, objections, "
    "competitor names, sentiment, pricing strategy or opinions about the client. Only use "
    "facts from the notes."
)


def first_name(name: str) -> str:
    return (name or "").split(" ")[0] or "there"


def offline_recap(title: str, contact_name: str, sender: str, summary: dict) -> dict:
    lines = [f"Hi {first_name(contact_name)},", "", "Thanks for your time today. A quick recap of what we covered:", ""]
    if summary.get("summary"):
        lines += [summary["summary"], ""]
    if summary.get("decisions"):
        lines += ["What we agreed:"] + [f"- {d}" for d in summary["decisions"]] + [""]
    items = summary.get("action_items") or []
    if items:
        lines.append("Next steps:")
        for a in items:
            due = ""
            if a.get("due_date"):
                try:
                    due = " by " + dt.date.fromisoformat(a["due_date"]).strftime("%a %b %-d")
                except ValueError:
                    due = ""
            lines.append(f"- {a['text']}{due}")
        lines.append("")
    lines += ["Let me know if I missed anything.", "", "Best,", sender or ""]
    return {"subject": f"Recap: {title}", "body": "\n".join(lines).rstrip() + "\n"}


def recap_email(body: str, context: str, title: str, contact_name: str, sender: str, summary: dict) -> dict:
    if ai_available():
        result = claude_parse(
            RecapEmail, RECAP_PROMPT,
            f"{context}\nRecipient: {contact_name or 'the client'}\nSender: {sender or 'the account owner'}"
            f"\n\n<notes>\n{body}\n</notes>",
        )
        if result is not None:
            return {**result, "engine": "claude"}
    return {**offline_recap(title, contact_name, sender, summary), "engine": "offline"}
