import csv
import datetime as dt
import io
import json
import os
import re
import secrets
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, notetaker
from .db import init_db, session
from .notetaker import TEMPLATES, extract_tasks, parse_task_line, set_checkbox

STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"]
OPEN_STAGES = STAGES[:4]
STAGE_PROBABILITY = {"lead": 10, "qualified": 25, "proposal": 50, "negotiation": 75, "won": 100, "lost": 0}
STATUSES = ["lead", "prospect", "active", "churned"]
NOTE_KINDS = ["note", "meeting", "call", "idea"]
ACTIVITY_TYPES = ["call", "email", "meeting", "linkedin", "sms", "note"]
TOUCH_TYPES = {"call", "email", "meeting", "linkedin", "sms"}
PRIORITIES = ["high", "normal", "low"]
STALE_DAYS = 14
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")


@asynccontextmanager
async def lifespan(_app):
    init_db()
    with session() as conn:
        backfill_companies(conn)
    yield


app = FastAPI(title="Vanguard CRM", lifespan=lifespan)


# -------------------------------------------------------------------- auth
def ensure_password() -> None:
    """Never serve client data publicly on a cloud host by accident.

    On Render (RENDER is set by the platform) without CRM_PASSWORD, generate one for this
    run and print it to the logs; set CRM_PASSWORD in the dashboard to make it permanent.
    """
    if os.environ.get("CRM_PASSWORD") or not os.environ.get("RENDER"):
        return
    os.environ["CRM_PASSWORD"] = secrets.token_urlsafe(9)
    print(
        "\n" + "=" * 64
        + f"\nCRM_PASSWORD is not set. Temporary login for this run:\n"
        f"  username: {os.environ.get('CRM_USERNAME') or 'vanguard'}\n  password: {os.environ['CRM_PASSWORD']}\n"
        "Set CRM_PASSWORD under Environment to keep a fixed password.\n" + "=" * 64,
        flush=True,
    )


ensure_password()


@app.middleware("http")
async def require_login(request: Request, call_next):
    """When CRM_PASSWORD is set, everything except sign-in and install assets needs a session."""
    if not auth.enabled() or auth.is_public(request.url.path) or auth.authorized(request):
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        # No WWW-Authenticate header: browsers must not pop up their native login box.
        return JSONResponse({"detail": "Sign in required"}, status_code=401)
    return RedirectResponse("/login", status_code=303)


@app.get("/login")
def login_form(request: Request):
    if not auth.enabled() or auth.authorized(request):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(auth.login_page())


@app.post("/login")
async def login_submit(request: Request):
    form = auth.parse_form(await request.body())
    username, next_hash = form.get("username", ""), auth.safe_next(form.get("next", ""))
    wait = auth.locked_for(request)
    if wait:
        return HTMLResponse(auth.login_page(auth.locked_message(wait), username, next_hash), status_code=429)
    if not auth.check_credentials(username, form.get("password", "")):
        auth.record_failure(request)
        return HTMLResponse(auth.login_page(auth.FAILED, username, next_hash), status_code=401)
    auth.clear_failures(request)
    response = RedirectResponse("/" + next_hash, status_code=303)
    secure = request.url.scheme == "https"
    response.headers["set-cookie"] = auth.cookie_header(auth.make_session(), secure, auth.SESSION_DAYS * 86400)
    return response


@app.post("/logout")
def logout(request: Request):
    response = RedirectResponse("/login", status_code=303)
    response.headers["set-cookie"] = auth.cookie_header("", request.url.scheme == "https", 0)
    return response


# ----------------------------------------------------------------- models
class CompanyIn(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    location: Optional[str] = None
    owner: Optional[str] = None
    about: Optional[str] = None
    renewal_date: Optional[str] = None
    mrr: Optional[float] = None


class ContactIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    company_id: Optional[int] = None
    title: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[str] = None
    linkedin: Optional[str] = None
    source: Optional[str] = None
    owner: Optional[str] = None
    next_follow_up: Optional[str] = None
    about: Optional[str] = None


class DealIn(BaseModel):
    title: Optional[str] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    value: Optional[float] = None
    stage: Optional[str] = None
    probability: Optional[int] = None
    close_date: Optional[str] = None
    owner: Optional[str] = None
    next_step: Optional[str] = None
    lost_reason: Optional[str] = None


class NoteIn(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    kind: Optional[str] = None
    contact_id: Optional[int] = None
    deal_id: Optional[int] = None
    company_id: Optional[int] = None
    pinned: Optional[bool] = None
    meeting_date: Optional[str] = None
    attendees: Optional[str] = None
    duration_min: Optional[int] = None
    template: Optional[str] = None


class TaskIn(BaseModel):
    text: str
    done: bool = False
    note_id: Optional[int] = None
    contact_id: Optional[int] = None
    deal_id: Optional[int] = None
    company_id: Optional[int] = None
    due_date: str = ""
    priority: str = ""


class TaskPatch(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    contact_id: Optional[int] = None
    deal_id: Optional[int] = None


class ActivityIn(BaseModel):
    type: str = "call"
    subject: str = ""
    body: str = ""
    outcome: str = ""
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    deal_id: Optional[int] = None
    occurred_at: str = ""
    follow_up_text: str = ""
    follow_up_date: str = ""


class ImportIn(BaseModel):
    csv: str


class BulkIn(BaseModel):
    ids: list[int]
    action: str
    value: str = ""


class ActionIn(BaseModel):
    text: str
    owner: str = ""
    due_date: str = ""


class ActionsIn(BaseModel):
    items: list[ActionIn]


# ---------------------------------------------------------------- helpers
def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def one(conn, table: str, item_id: int) -> dict:
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{table[:-1]} {item_id} not found")
    return dict(row)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def today() -> str:
    return dt.date.today().isoformat()


def normalize_ts(value: str) -> str:
    """Accept `2026-10-01`, `2026-10-01T14:30` or full timestamps; store `YYYY-MM-DD HH:MM:SS`."""
    value = (value or "").strip().replace("T", " ")
    if not value:
        return now()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value + " 12:00:00"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", value):
        return value + ":00"
    return value[:19]


def merged(current: dict, payload: BaseModel) -> dict:
    return {**current, **payload.model_dump(exclude_unset=True, exclude_none=False)}


def update_row(conn, table: str, item_id: int, data: dict, columns: list[str]) -> None:
    clause = ", ".join(f"{c} = :{c}" for c in columns)
    conn.execute(f"UPDATE {table} SET {clause} WHERE id = :id", {**{c: data.get(c) for c in columns}, "id": item_id})


def insert_row(conn, table: str, data: dict, columns: list[str]) -> int:
    cols = [c for c in columns if data.get(c) is not None]
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})"
    return conn.execute(sql, {c: data[c] for c in cols}).lastrowid


def find_or_create_company(conn, name: str) -> Optional[int]:
    name = (name or "").strip()
    if not name:
        return None
    row = conn.execute("SELECT id FROM companies WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        return row["id"]
    return conn.execute("INSERT INTO companies (name) VALUES (?)", (name,)).lastrowid


def backfill_companies(conn) -> None:
    """Link legacy contacts (free-text company) and their deals to company records."""
    for c in rows(conn.execute("SELECT id, company FROM contacts WHERE company_id IS NULL AND company != ''")):
        conn.execute("UPDATE contacts SET company_id = ? WHERE id = ?", (find_or_create_company(conn, c["company"]), c["id"]))
    conn.execute(
        "UPDATE deals SET company_id = (SELECT company_id FROM contacts WHERE contacts.id = deals.contact_id)"
        " WHERE company_id IS NULL AND contact_id IS NOT NULL"
    )
    conn.execute("UPDATE deals SET stage_changed_at = created_at WHERE stage_changed_at IS NULL OR stage_changed_at = ''")
    conn.execute("UPDATE deals SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")


def touch_contact(conn, contact_id: Optional[int], when: str) -> None:
    if contact_id:
        conn.execute(
            "UPDATE contacts SET last_contacted_at = ? WHERE id = ?"
            " AND (last_contacted_at IS NULL OR last_contacted_at = '' OR last_contacted_at < ?)",
            (when, contact_id, when),
        )


def log_activity(conn, type_: str, subject: str, body: str = "", *, outcome: str = "", contact_id=None,
                 company_id=None, deal_id=None, note_id=None, occurred_at: str = "") -> int:
    when = normalize_ts(occurred_at)
    if deal_id and not (contact_id and company_id):
        deal = conn.execute("SELECT contact_id, company_id FROM deals WHERE id = ?", (deal_id,)).fetchone()
        if deal:
            contact_id = contact_id or deal["contact_id"]
            company_id = company_id or deal["company_id"]
    if contact_id and not company_id:
        row = conn.execute("SELECT company_id FROM contacts WHERE id = ?", (contact_id,)).fetchone()
        company_id = row["company_id"] if row else None
    cur = conn.execute(
        "INSERT INTO activities (type, subject, body, outcome, contact_id, company_id, deal_id, note_id, occurred_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (type_, subject, body, outcome, contact_id, company_id, deal_id, note_id, when),
    )
    if type_ in TOUCH_TYPES:
        touch_contact(conn, contact_id, when)
    return cur.lastrowid


# =================================================================== health
HEALTHY, WATCH = 75, 50


def health_signals(conn, key: str) -> dict[int, dict]:
    """Relationship signals per company_id or contact_id, computed in a handful of queries."""
    signals: dict[int, dict] = {}

    def sig(i):
        return signals.setdefault(i, {"last_touch": "", "summary": None, "overdue": 0, "stale": [], "open_deals": 0})

    touch_types = ",".join(f"'{t}'" for t in sorted(TOUCH_TYPES))
    for i, ts in conn.execute(
        f"SELECT {key}, MAX(occurred_at) FROM activities WHERE {key} IS NOT NULL AND type IN ({touch_types}) GROUP BY {key}"
    ):
        sig(i)["last_touch"] = ts or ""
    for i, ts in conn.execute(
        f"SELECT {key}, MAX(COALESCE(NULLIF(meeting_date, ''), created_at)) FROM notes"
        f" WHERE {key} IS NOT NULL AND kind IN ('meeting', 'call') GROUP BY {key}"
    ):
        s = sig(i)
        s["last_touch"] = max(s["last_touch"], normalize_ts(ts))
    for i, summary in conn.execute(
        f"SELECT {key}, summary FROM notes WHERE {key} IS NOT NULL AND summary != '' ORDER BY updated_at DESC"
    ):
        if sig(i)["summary"] is None:
            try:
                sig(i)["summary"] = json.loads(summary)
            except ValueError:
                pass
    for i, n in conn.execute(
        f"SELECT {key}, COUNT(*) FROM tasks WHERE {key} IS NOT NULL AND done = 0 AND due_date != '' AND due_date < ?"
        f" GROUP BY {key}", (today(),)
    ):
        sig(i)["overdue"] = n
    for d in deal_rows(conn, "d.stage NOT IN ('won','lost')"):
        if d[key]:
            s = sig(d[key])
            s["open_deals"] += 1
            if d["stale"]:
                s["stale"].append(d)
    return signals


def score_health(sig: Optional[dict], renewal_date: str = "", status: str = "", next_follow_up: str = "") -> dict:
    sig = sig or {"last_touch": "", "summary": None, "overdue": 0, "stale": [], "open_deals": 0}
    if status == "churned":
        return {"score": 0, "label": "churned", "reasons": [], "actions": []}
    score, reasons, actions = 100, [], []
    t = dt.date.today()
    days = (t - dt.date.fromisoformat(sig["last_touch"][:10])).days if sig["last_touch"] else None
    if days is None:
        score -= 30
        reasons.append("Never contacted")
        actions.append("Make first contact")
    elif days > 45:
        score -= 40
        reasons.append(f"No touch in {days} days")
        actions.append("Re-engage: call or send a value-add email")
    elif days > 30:
        score -= 30
        reasons.append(f"No touch in {days} days")
        actions.append("Reach out this week")
    elif days > 14:
        score -= 15
        reasons.append(f"No touch in {days} days")
    summary = sig["summary"] or {}
    if summary.get("sentiment") == "negative":
        score -= 25
        reasons.append("Last conversation was negative")
        actions.append("Schedule a check-in to address concerns")
    risks = summary.get("risks") or []
    if risks:
        score -= min(20, 10 * len(risks))
        reasons.append(f"Open risk: {risks[0]}")
    if sig["overdue"]:
        score -= min(20, 10 * sig["overdue"])
        reasons.append(f"{sig['overdue']} overdue task{'s' if sig['overdue'] > 1 else ''}")
        actions.append("Clear overdue tasks — promises kept build trust")
    for d in sig["stale"][:2]:
        score -= 15
        reasons.append(f"“{d['title']}” quiet for {d['days_since_activity']} days")
        actions.append(f"Advance “{d['title']}”" + (f": {d['next_step']}" if d["next_step"] else ""))
    if renewal_date:
        until = (dt.date.fromisoformat(renewal_date) - t).days
        if 0 <= until <= 60:
            if days is None or days > 14:
                score -= 20
                reasons.append(f"Renewal in {until} days with no recent touch")
                actions.append("Book a renewal conversation")
            else:
                reasons.append(f"Renewal in {until} days")
                actions.append("Prep the renewal: results recap, scope and pricing")
        elif until < 0:
            score -= 15
            reasons.append(f"Renewal date passed {-until} days ago")
            actions.append("Confirm renewal status")
    if next_follow_up:
        if next_follow_up < t.isoformat():
            late = (t - dt.date.fromisoformat(next_follow_up)).days
            score -= 10
            reasons.append(f"Follow-up overdue by {late} day{'s' if late > 1 else ''}")
            actions.insert(0, "Follow up now — it's overdue")
        elif next_follow_up == t.isoformat():
            actions.insert(0, "Follow-up due today")
    elif status in ("prospect", "active", "lead"):
        actions.append("Set a next follow-up date")
    score = max(0, score)
    label = "healthy" if score >= HEALTHY else "watch" if score >= WATCH else "at-risk"
    return {"score": score, "label": label, "reasons": reasons, "actions": actions[:4]}


# ================================================================ companies
COMPANY_COLUMNS = ["name", "domain", "industry", "size", "location", "owner", "about", "renewal_date", "mrr"]


@app.get("/api/companies")
def list_companies(q: str = ""):
    sql = (
        "SELECT co.*,"
        " (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count,"
        " (SELECT COUNT(*) FROM deals d WHERE d.company_id = co.id AND d.stage NOT IN ('won','lost')) AS open_deals,"
        " (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.company_id = co.id AND d.stage NOT IN ('won','lost')) AS open_value,"
        " (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.company_id = co.id AND d.stage = 'won') AS won_value,"
        " (SELECT MAX(occurred_at) FROM activities a WHERE a.company_id = co.id) AS last_activity_at"
        " FROM companies co WHERE 1=1"
    )
    args: list = []
    if q:
        sql += " AND (co.name LIKE ? OR co.domain LIKE ? OR co.industry LIKE ?)"
        args += [f"%{q}%"] * 3
    sql += " ORDER BY co.name COLLATE NOCASE"
    with session() as conn:
        data = rows(conn.execute(sql, args))
        signals = health_signals(conn, "company_id")
        for c in data:
            c["health"] = score_health(signals.get(c["id"]), c["renewal_date"] or "")
        return data


@app.post("/api/companies")
def create_company(payload: CompanyIn):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    with session() as conn:
        data = {c: getattr(payload, c) or ("" if c != "mrr" else 0) for c in COMPANY_COLUMNS}
        return one(conn, "companies", insert_row(conn, "companies", data, COMPANY_COLUMNS))


@app.api_route("/api/companies/{company_id}", methods=["PUT", "PATCH"])
def update_company(company_id: int, payload: CompanyIn):
    with session() as conn:
        data = merged(one(conn, "companies", company_id), payload)
        update_row(conn, "companies", company_id, data, COMPANY_COLUMNS)
        conn.execute("UPDATE contacts SET company = ? WHERE company_id = ?", (data["name"], company_id))
        return one(conn, "companies", company_id)


@app.delete("/api/companies/{company_id}")
def delete_company(company_id: int):
    with session() as conn:
        one(conn, "companies", company_id)
        conn.execute("DELETE FROM companies WHERE id = ?", (company_id,))
        return {"ok": True}


@app.get("/api/companies/{company_id}")
def get_company(company_id: int):
    with session() as conn:
        company = one(conn, "companies", company_id)
        company["contacts"] = rows(conn.execute(
            "SELECT * FROM contacts WHERE company_id = ? ORDER BY name COLLATE NOCASE", (company_id,)))
        company["deals"] = deal_rows(conn, "d.company_id = ?", [company_id])
        company["tasks"] = task_rows(conn, "(t.company_id = ? OR c.company_id = ?)", [company_id, company_id])
        company["timeline"] = timeline(conn, "company_id", company_id)
        company["health"] = score_health(health_signals(conn, "company_id").get(company_id), company["renewal_date"] or "")
        return company


# ================================================================= contacts
CONTACT_COLUMNS = ["name", "email", "phone", "company", "company_id", "title", "status", "tags",
                   "linkedin", "source", "owner", "next_follow_up", "about"]


def contact_select(where: str = "1=1") -> str:
    return (
        "SELECT c.*,"
        " (SELECT COUNT(*) FROM deals d WHERE d.contact_id = c.id) AS deal_count,"
        " (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('won','lost')) AS open_value,"
        " (SELECT COUNT(*) FROM notes n WHERE n.contact_id = c.id) AS note_count,"
        " (SELECT COUNT(*) FROM tasks t WHERE t.contact_id = c.id AND t.done = 0) AS open_tasks"
        f" FROM contacts c WHERE {where}"
    )


def resolve_contact_company(conn, data: dict) -> dict:
    if data.get("company_id"):
        company = conn.execute("SELECT name FROM companies WHERE id = ?", (data["company_id"],)).fetchone()
        if company is None:
            raise HTTPException(status_code=400, detail="company not found")
        data["company"] = company["name"]
    else:
        data["company_id"] = find_or_create_company(conn, data.get("company") or "")
    return data


def check_status(status: Optional[str]) -> None:
    if status and status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")


@app.get("/api/contacts")
def list_contacts(q: str = "", status: str = "", owner: str = "", tag: str = "", company_id: Optional[int] = None):
    where, args = ["1=1"], []
    if q:
        where.append("(c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.tags LIKE ? OR c.title LIKE ?)")
        args += [f"%{q}%"] * 5
    if status:
        where.append("c.status = ?")
        args.append(status)
    if owner:
        where.append("c.owner = ?")
        args.append(owner)
    if tag:
        where.append("(',' || REPLACE(c.tags, ' ', '') || ',') LIKE ?")
        args.append(f"%,{tag.strip()},%")
    if company_id:
        where.append("c.company_id = ?")
        args.append(company_id)
    with session() as conn:
        data = rows(conn.execute(contact_select(" AND ".join(where)) + " ORDER BY c.name COLLATE NOCASE", args))
        signals = health_signals(conn, "contact_id")
        for c in data:
            c["health"] = score_health(signals.get(c["id"]), status=c["status"], next_follow_up=c["next_follow_up"] or "")
        return data


@app.post("/api/contacts")
def create_contact(payload: ContactIn):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    check_status(payload.status)
    with session() as conn:
        data = {c: getattr(payload, c) for c in CONTACT_COLUMNS}
        data = {k: ("" if v is None and k != "company_id" else v) for k, v in data.items()}
        data["status"] = data["status"] or "lead"
        data = resolve_contact_company(conn, data)
        contact_id = insert_row(conn, "contacts", data, CONTACT_COLUMNS)
        return one(conn, "contacts", contact_id)


@app.api_route("/api/contacts/{contact_id}", methods=["PUT", "PATCH"])
def update_contact(contact_id: int, payload: ContactIn):
    check_status(payload.status)
    with session() as conn:
        current = one(conn, "contacts", contact_id)
        data = merged(current, payload)
        if "company" in payload.model_fields_set and "company_id" not in payload.model_fields_set:
            data["company_id"] = None
        data = resolve_contact_company(conn, data)
        update_row(conn, "contacts", contact_id, data, CONTACT_COLUMNS)
        return one(conn, "contacts", contact_id)


@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int):
    with session() as conn:
        one(conn, "contacts", contact_id)
        conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
        return {"ok": True}


@app.get("/api/contacts/export.csv")
def export_contacts():
    with session() as conn:
        data = rows(conn.execute("SELECT * FROM contacts ORDER BY name COLLATE NOCASE"))
    fields = ["name", "email", "phone", "company", "title", "status", "tags", "linkedin", "source",
              "owner", "next_follow_up", "last_contacted_at", "created_at"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(data)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="contacts.csv"'})


HEADER_ALIASES = {
    "name": ["name", "full name", "contact", "contact name"],
    "first": ["first name", "firstname", "first"],
    "last": ["last name", "lastname", "last", "surname"],
    "email": ["email", "email address", "work email", "e-mail"],
    "phone": ["phone", "phone number", "mobile", "direct phone", "work direct phone", "corporate phone"],
    "company": ["company", "company name", "account", "organization", "organisation"],
    "title": ["title", "job title", "position", "role"],
    "status": ["status", "lifecycle stage"],
    "tags": ["tags", "labels", "lists"],
    "linkedin": ["linkedin", "linkedin url", "person linkedin url", "linkedin profile"],
    "source": ["source", "lead source"],
    "owner": ["owner", "contact owner", "account owner"],
}


@app.post("/api/contacts/import")
def import_contacts(payload: ImportIn):
    """Import a CSV (Apollo, HubSpot or LinkedIn exports work as-is). Existing emails are updated."""
    reader = csv.DictReader(io.StringIO(payload.csv.lstrip("﻿")))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    lookup = {h.strip().lower(): h for h in reader.fieldnames if h}
    column = {key: next((lookup[a] for a in aliases if a in lookup), None) for key, aliases in HEADER_ALIASES.items()}
    created = updated = skipped = 0
    with session() as conn:
        for raw in reader:
            get = lambda k: (raw.get(column[k]) or "").strip() if column[k] else ""  # noqa: E731
            name = get("name") or " ".join(p for p in (get("first"), get("last")) if p)
            if not name:
                skipped += 1
                continue
            status = get("status").lower()
            data = {
                "name": name, "email": get("email"), "phone": get("phone"), "company": get("company"),
                "title": get("title"), "status": status if status in STATUSES else "lead",
                "tags": get("tags"), "linkedin": get("linkedin"), "source": get("source") or "import",
                "owner": get("owner"), "next_follow_up": "", "about": "", "company_id": None,
            }
            data = resolve_contact_company(conn, data)
            existing = conn.execute(
                "SELECT * FROM contacts WHERE email != '' AND email = ? COLLATE NOCASE", (data["email"],)
            ).fetchone() if data["email"] else None
            if existing:
                keep = {k: v for k, v in data.items() if v not in ("", None)}
                update_row(conn, "contacts", existing["id"], {**dict(existing), **keep}, CONTACT_COLUMNS)
                updated += 1
            else:
                insert_row(conn, "contacts", data, CONTACT_COLUMNS)
                created += 1
    return {"created": created, "updated": updated, "skipped": skipped}


@app.get("/api/contacts/duplicates")
def contact_duplicates(email: str = "", name: str = "", exclude: Optional[int] = None):
    """Possible duplicates for the contact form: same email, or same name."""
    clauses, args = [], []
    if email.strip():
        clauses.append("(email != '' AND email = ? COLLATE NOCASE)")
        args.append(email.strip())
    if name.strip():
        clauses.append("name = ? COLLATE NOCASE")
        args.append(name.strip())
    if not clauses:
        return []
    sql = f"SELECT id, name, email, company FROM contacts WHERE ({' OR '.join(clauses)})"
    if exclude:
        sql += " AND id != ?"
        args.append(exclude)
    with session() as conn:
        return rows(conn.execute(sql + " LIMIT 5", args))


BULK_ACTIONS = ["status", "owner", "add_tag", "remove_tag", "follow_up", "delete"]


@app.post("/api/contacts/bulk")
def bulk_contacts(payload: BulkIn):
    if payload.action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"action must be one of {BULK_ACTIONS}")
    if payload.action == "status":
        check_status(payload.value)
    value = payload.value.strip()
    with session() as conn:
        for cid in payload.ids:
            row = conn.execute("SELECT * FROM contacts WHERE id = ?", (cid,)).fetchone()
            if row is None:
                continue
            if payload.action == "delete":
                conn.execute("DELETE FROM contacts WHERE id = ?", (cid,))
            elif payload.action in ("add_tag", "remove_tag"):
                tags = [t.strip() for t in (row["tags"] or "").split(",") if t.strip()]
                if payload.action == "add_tag" and value and value not in tags:
                    tags.append(value)
                if payload.action == "remove_tag":
                    tags = [t for t in tags if t != value]
                conn.execute("UPDATE contacts SET tags = ? WHERE id = ?", (",".join(tags), cid))
            else:
                column = {"status": "status", "owner": "owner", "follow_up": "next_follow_up"}[payload.action]
                conn.execute(f"UPDATE contacts SET {column} = ? WHERE id = ?", (value, cid))
    return {"updated": len(payload.ids)}


@app.get("/api/contacts/{contact_id}")
def get_contact(contact_id: int):
    with session() as conn:
        contact = one(conn, "contacts", contact_id)
        contact["company_record"] = (
            one(conn, "companies", contact["company_id"]) if contact.get("company_id") else None
        )
        contact["deals"] = deal_rows(conn, "d.contact_id = ?", [contact_id])
        contact["notes"] = rows(conn.execute(
            "SELECT * FROM notes WHERE contact_id = ? ORDER BY pinned DESC, updated_at DESC", (contact_id,)))
        contact["tasks"] = task_rows(conn, "t.contact_id = ?", [contact_id])
        contact["timeline"] = timeline(conn, "contact_id", contact_id)
        renewal = (contact["company_record"] or {}).get("renewal_date") or ""
        contact["health"] = score_health(health_signals(conn, "contact_id").get(contact_id), renewal,
                                         contact["status"], contact["next_follow_up"] or "")
        return contact


# ==================================================================== deals
DEAL_COLUMNS = ["title", "contact_id", "company_id", "value", "stage", "probability", "close_date",
                "owner", "next_step", "lost_reason"]


def deal_rows(conn, where: str = "1=1", args: Optional[list] = None) -> list[dict]:
    data = rows(conn.execute(
        "SELECT d.*, c.name AS contact_name, co.name AS company_name,"
        " NULLIF(MAX(COALESCE((SELECT MAX(occurred_at) FROM activities a WHERE a.deal_id = d.id), ''),"
        "   COALESCE((SELECT MAX(updated_at) FROM notes n WHERE n.deal_id = d.id), '')), '') AS last_activity_at"
        " FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id"
        " LEFT JOIN companies co ON co.id = d.company_id"
        f" WHERE {where} ORDER BY d.value DESC",
        args or [],
    ))
    today_date = dt.date.today()
    for d in data:
        prob = d["probability"] if d["probability"] is not None else STAGE_PROBABILITY.get(d["stage"], 0)
        d["probability"] = prob
        d["weighted_value"] = round((d["value"] or 0) * prob / 100, 2)
        since = (d.get("stage_changed_at") or d["created_at"])[:10]
        d["days_in_stage"] = (today_date - dt.date.fromisoformat(since)).days
        last = (d["last_activity_at"] or d.get("updated_at") or d["created_at"])[:10]
        d["days_since_activity"] = (today_date - dt.date.fromisoformat(last)).days
        d["is_open"] = d["stage"] in OPEN_STAGES
        d["stale"] = d["is_open"] and d["days_since_activity"] >= STALE_DAYS
        d["overdue_close"] = d["is_open"] and bool(d["close_date"]) and d["close_date"] < today_date.isoformat()
    return data


def check_stage(stage: Optional[str]) -> None:
    if stage is not None and stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"stage must be one of {STAGES}")


def fill_deal_company(conn, data: dict) -> None:
    if data.get("contact_id") and not data.get("company_id"):
        row = conn.execute("SELECT company_id FROM contacts WHERE id = ?", (data["contact_id"],)).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="contact not found")
        data["company_id"] = row["company_id"]


@app.get("/api/deals")
def list_deals(owner: str = "", stage: str = "", contact_id: Optional[int] = None):
    where, args = ["1=1"], []
    if owner:
        where.append("d.owner = ?")
        args.append(owner)
    if stage:
        where.append("d.stage = ?")
        args.append(stage)
    if contact_id:
        where.append("d.contact_id = ?")
        args.append(contact_id)
    with session() as conn:
        return deal_rows(conn, " AND ".join(where), args)


def get_deal_row(conn, deal_id: int) -> dict:
    found = deal_rows(conn, "d.id = ?", [deal_id])
    if not found:
        raise HTTPException(status_code=404, detail=f"deal {deal_id} not found")
    return found[0]


@app.post("/api/deals")
def create_deal(payload: DealIn):
    if not (payload.title or "").strip():
        raise HTTPException(status_code=400, detail="title is required")
    check_stage(payload.stage)
    with session() as conn:
        data = payload.model_dump()
        data.update(stage=data["stage"] or "lead", value=data["value"] or 0)
        for key in ("close_date", "owner", "next_step", "lost_reason"):
            data[key] = data[key] or ""
        fill_deal_company(conn, data)
        deal_id = insert_row(conn, "deals", data, DEAL_COLUMNS)
        conn.execute("UPDATE deals SET stage_changed_at = ?, updated_at = ? WHERE id = ?", (now(), now(), deal_id))
        log_activity(conn, "deal", f"Deal created: {data['title']}", deal_id=deal_id,
                     contact_id=data["contact_id"], company_id=data["company_id"])
        return get_deal_row(conn, deal_id)


@app.api_route("/api/deals/{deal_id}", methods=["PUT", "PATCH"])
def update_deal(deal_id: int, payload: DealIn):
    check_stage(payload.stage)
    with session() as conn:
        current = one(conn, "deals", deal_id)
        data = merged(current, payload)
        if "contact_id" in payload.model_fields_set and "company_id" not in payload.model_fields_set:
            data["company_id"] = None
        fill_deal_company(conn, data)
        if data["stage"] != "lost":
            data["lost_reason"] = ""
        update_row(conn, "deals", deal_id, data, DEAL_COLUMNS)
        conn.execute("UPDATE deals SET updated_at = ? WHERE id = ?", (now(), deal_id))
        if data["stage"] != current["stage"]:
            if "probability" not in payload.model_fields_set:
                conn.execute("UPDATE deals SET probability = NULL WHERE id = ?", (deal_id,))
            conn.execute("UPDATE deals SET stage_changed_at = ? WHERE id = ?", (now(), deal_id))
            detail = f" — {data['lost_reason']}" if data["stage"] == "lost" and data.get("lost_reason") else ""
            log_activity(conn, "stage", f"{current['stage']} → {data['stage']}{detail}", deal_id=deal_id)
            if data["stage"] == "won" and data.get("contact_id"):
                conn.execute("UPDATE contacts SET status = 'active' WHERE id = ?", (data["contact_id"],))
        return get_deal_row(conn, deal_id)


@app.delete("/api/deals/{deal_id}")
def delete_deal(deal_id: int):
    with session() as conn:
        one(conn, "deals", deal_id)
        conn.execute("DELETE FROM deals WHERE id = ?", (deal_id,))
        return {"ok": True}


@app.get("/api/deals/export.csv")
def export_deals():
    with session() as conn:
        data = deal_rows(conn)
    fields = ["title", "company_name", "contact_name", "stage", "value", "probability", "weighted_value",
              "close_date", "owner", "next_step", "lost_reason", "days_in_stage", "created_at"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(data)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="deals.csv"'})


@app.get("/api/deals/{deal_id}")
def get_deal(deal_id: int):
    with session() as conn:
        deal = get_deal_row(conn, deal_id)
        deal["notes"] = rows(conn.execute("SELECT * FROM notes WHERE deal_id = ? ORDER BY updated_at DESC", (deal_id,)))
        deal["tasks"] = task_rows(conn, "t.deal_id = ?", [deal_id])
        deal["timeline"] = timeline(conn, "deal_id", deal_id)
        return deal


# =============================================================== activities
def activity_select(where: str) -> str:
    return (
        "SELECT a.*, c.name AS contact_name, co.name AS company_name, d.title AS deal_title"
        " FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id"
        " LEFT JOIN companies co ON co.id = a.company_id LEFT JOIN deals d ON d.id = a.deal_id"
        f" WHERE {where} ORDER BY a.occurred_at DESC, a.id DESC"
    )


def timeline(conn, key: str, value: int) -> list[dict]:
    """Activities plus notes for a record, newest first."""
    if key == "company_id":
        act_where = "(a.company_id = ? OR a.contact_id IN (SELECT id FROM contacts WHERE company_id = ?))"
        note_where = "(n.company_id = ? OR n.contact_id IN (SELECT id FROM contacts WHERE company_id = ?))"
        args = [value, value]
    else:
        act_where, note_where, args = f"a.{key} = ?", f"n.{key} = ?", [value]
    items = rows(conn.execute(activity_select(act_where) + " LIMIT 200", args))
    for i in items:
        i["entry"] = "activity"
    for n in rows(conn.execute(
        "SELECT n.id, n.title, n.kind, n.body, n.summary, n.contact_id, c.name AS contact_name,"
        " COALESCE(NULLIF(n.meeting_date, ''), n.created_at) AS occurred_at"
        f" FROM notes n LEFT JOIN contacts c ON c.id = n.contact_id WHERE {note_where}", args,
    )):
        items.append({**n, "entry": "note", "type": n["kind"], "subject": n["title"],
                      "occurred_at": normalize_ts(n["occurred_at"])})
    items.sort(key=lambda i: i["occurred_at"] or "", reverse=True)
    return items


@app.get("/api/activities")
def list_activities(contact_id: Optional[int] = None, deal_id: Optional[int] = None,
                    company_id: Optional[int] = None, type: str = "", limit: int = 50):
    where, args = ["1=1"], []
    for col, val in (("contact_id", contact_id), ("deal_id", deal_id), ("company_id", company_id)):
        if val:
            where.append(f"a.{col} = ?")
            args.append(val)
    if type:
        where.append("a.type = ?")
        args.append(type)
    with session() as conn:
        return rows(conn.execute(activity_select(" AND ".join(where)) + " LIMIT ?", [*args, min(limit, 500)]))


@app.post("/api/activities")
def create_activity(payload: ActivityIn):
    if payload.type not in ACTIVITY_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {ACTIVITY_TYPES}")
    with session() as conn:
        activity_id = log_activity(
            conn, payload.type, payload.subject or payload.type.title(), payload.body,
            outcome=payload.outcome, contact_id=payload.contact_id, company_id=payload.company_id,
            deal_id=payload.deal_id, occurred_at=payload.occurred_at,
        )
        activity = dict(conn.execute(activity_select("a.id = ?"), (activity_id,)).fetchone())
        if payload.follow_up_text.strip():
            item = parse_task_line(payload.follow_up_text)
            conn.execute(
                "INSERT INTO tasks (text, contact_id, deal_id, company_id, due_date, priority) VALUES (?, ?, ?, ?, ?, ?)",
                (item["text"], activity["contact_id"], activity["deal_id"], activity["company_id"],
                 payload.follow_up_date or item["due_date"], item["priority"]),
            )
            if activity["contact_id"] and (payload.follow_up_date or item["due_date"]):
                conn.execute("UPDATE contacts SET next_follow_up = ? WHERE id = ?",
                             (payload.follow_up_date or item["due_date"], activity["contact_id"]))
        return activity


@app.delete("/api/activities/{activity_id}")
def delete_activity(activity_id: int):
    with session() as conn:
        one(conn, "activities", activity_id)
        conn.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
        return {"ok": True}


# ==================================================================== notes
NOTE_COLUMNS = ["title", "body", "kind", "contact_id", "deal_id", "company_id", "pinned",
                "meeting_date", "attendees", "duration_min"]


def sync_note_tasks(conn, note: dict) -> None:
    """Mirror `[ ]` checklist lines in a note body into the tasks table."""
    parsed = extract_tasks(note["body"])
    existing = {r["text"]: dict(r) for r in conn.execute("SELECT * FROM tasks WHERE note_id = ?", (note["id"],))}
    links = (note["contact_id"], note["deal_id"], note["company_id"])
    seen = set()
    for item in parsed:
        if item["text"] in seen:
            continue
        seen.add(item["text"])
        row = existing.get(item["text"])
        if row:
            completed = row["completed_at"] if item["done"] and row["done"] else (now() if item["done"] else "")
            conn.execute(
                "UPDATE tasks SET done = ?, contact_id = ?, deal_id = ?, company_id = ?, due_date = ?,"
                " priority = ?, completed_at = ? WHERE id = ?",
                (int(item["done"]), *links, item["due_date"] or row["due_date"],
                 item["priority"] if item["priority"] != "normal" else row["priority"] or "normal",
                 completed, row["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO tasks (text, done, note_id, contact_id, deal_id, company_id, due_date, priority, completed_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item["text"], int(item["done"]), note["id"], *links, item["due_date"], item["priority"],
                 now() if item["done"] else ""),
            )
    for text, row in existing.items():
        if text not in seen:
            conn.execute("DELETE FROM tasks WHERE id = ?", (row["id"],))


def note_row(conn, note_id: int) -> dict:
    row = conn.execute(
        "SELECT n.*, c.name AS contact_name, d.title AS deal_title, co.name AS company_name FROM notes n"
        " LEFT JOIN contacts c ON c.id = n.contact_id LEFT JOIN deals d ON d.id = n.deal_id"
        " LEFT JOIN companies co ON co.id = n.company_id WHERE n.id = ?", (note_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"note {note_id} not found")
    return dict(row)


def normalize_note(conn, data: dict) -> dict:
    if data.get("kind") and data["kind"] not in NOTE_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {NOTE_KINDS}")
    if data.get("deal_id") and not data.get("contact_id"):
        deal = conn.execute("SELECT contact_id FROM deals WHERE id = ?", (data["deal_id"],)).fetchone()
        data["contact_id"] = deal["contact_id"] if deal else None
    if data.get("contact_id") and not data.get("company_id"):
        row = conn.execute("SELECT company_id FROM contacts WHERE id = ?", (data["contact_id"],)).fetchone()
        data["company_id"] = row["company_id"] if row else None
    data["pinned"] = int(bool(data.get("pinned")))
    return data


def after_note_save(conn, note: dict) -> None:
    sync_note_tasks(conn, note)
    if note["kind"] in ("meeting", "call") and note["contact_id"]:
        touch_contact(conn, note["contact_id"], normalize_ts(note["meeting_date"] or note["created_at"]))


@app.get("/api/notes")
def list_notes(q: str = "", contact_id: Optional[int] = None, deal_id: Optional[int] = None,
               company_id: Optional[int] = None, kind: str = ""):
    sql = (
        "SELECT n.*, c.name AS contact_name, d.title AS deal_title, co.name AS company_name,"
        " (SELECT COUNT(*) FROM tasks t WHERE t.note_id = n.id AND t.done = 0) AS open_tasks"
        " FROM notes n LEFT JOIN contacts c ON c.id = n.contact_id LEFT JOIN deals d ON d.id = n.deal_id"
        " LEFT JOIN companies co ON co.id = n.company_id WHERE 1=1"
    )
    args: list = []
    if q:
        sql += " AND (n.title LIKE ? OR n.body LIKE ? OR n.attendees LIKE ? OR c.name LIKE ? OR co.name LIKE ?)"
        args += [f"%{q}%"] * 5
    for col, val in (("contact_id", contact_id), ("deal_id", deal_id), ("company_id", company_id)):
        if val:
            sql += f" AND n.{col} = ?"
            args.append(val)
    if kind:
        sql += " AND n.kind = ?"
        args.append(kind)
    sql += " ORDER BY n.pinned DESC, n.updated_at DESC"
    with session() as conn:
        return rows(conn.execute(sql, args))


@app.get("/api/templates")
def list_templates():
    return TEMPLATES


@app.post("/api/notes")
def create_note(payload: NoteIn):
    with session() as conn:
        data = payload.model_dump()
        template = next((t for t in TEMPLATES if t["id"] == payload.template), None)
        if payload.template and template is None:
            raise HTTPException(status_code=400, detail="unknown template")
        data["title"] = data["title"] or (template["name"] if template else "Untitled note")
        data["body"] = data["body"] if data["body"] is not None else (template["body"] if template else "")
        data["kind"] = data["kind"] or (template["kind"] if template else "note")
        data["meeting_date"] = data["meeting_date"] or ""
        data["attendees"] = data["attendees"] or ""
        data["duration_min"] = data["duration_min"] or 0
        data = normalize_note(conn, data)
        note_id = insert_row(conn, "notes", data, NOTE_COLUMNS)
        note = note_row(conn, note_id)
        after_note_save(conn, note)
        return note


@app.get("/api/notes/{note_id}")
def get_note(note_id: int):
    with session() as conn:
        note = note_row(conn, note_id)
        note["tasks"] = task_rows(conn, "t.note_id = ?", [note_id])
        return note


@app.api_route("/api/notes/{note_id}", methods=["PUT", "PATCH"])
def update_note(note_id: int, payload: NoteIn):
    with session() as conn:
        current = one(conn, "notes", note_id)
        data = merged(current, payload)
        if "contact_id" in payload.model_fields_set and "company_id" not in payload.model_fields_set:
            data["company_id"] = None
        data = normalize_note(conn, data)
        data["title"] = data["title"] or "Untitled note"
        update_row(conn, "notes", note_id, data, NOTE_COLUMNS)
        conn.execute("UPDATE notes SET updated_at = ? WHERE id = ?", (now(), note_id))
        note = note_row(conn, note_id)
        after_note_save(conn, note)
        return note


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int):
    with session() as conn:
        one(conn, "notes", note_id)
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        return {"ok": True}


@app.post("/api/notes/{note_id}/summarize")
def summarize_note(note_id: int):
    with session() as conn:
        note = note_row(conn, note_id)
    if not note["body"].strip():
        raise HTTPException(status_code=400, detail="note is empty")
    context = "\n".join(filter(None, [
        f"Title: {note['title']}",
        f"Type: {note['kind']}",
        f"Meeting date: {note['meeting_date'] or note['created_at'][:10]}",
        f"Today: {today()}",
        note["contact_name"] and f"Contact: {note['contact_name']}",
        note["company_name"] and f"Company: {note['company_name']}",
        note["deal_title"] and f"Deal: {note['deal_title']}",
        note["attendees"] and f"Attendees: {note['attendees']}",
    ]))
    result = notetaker.summarize(note["body"], context)
    result["generated_at"] = now()
    with session() as conn:
        conn.execute("UPDATE notes SET summary = ? WHERE id = ?", (json.dumps(result), note_id))
    return result


@app.post("/api/notes/{note_id}/recap")
def recap_note(note_id: int):
    """Draft the client-facing follow-up email for a meeting note."""
    with session() as conn:
        note = note_row(conn, note_id)
        contact = one(conn, "contacts", note["contact_id"]) if note["contact_id"] else {}
        sender = contact.get("owner") or ""
    if not note["body"].strip():
        raise HTTPException(status_code=400, detail="note is empty")
    summary = json.loads(note["summary"]) if note.get("summary") else notetaker.heuristic_summary(note["body"])
    context = f"Meeting: {note['title']}\nDate: {note['meeting_date'] or note['created_at'][:10]}\nToday: {today()}"
    email = notetaker.recap_email(note["body"], context, note["title"], contact.get("name", ""), sender, summary)
    return {**email, "to": contact.get("email", ""), "contact_id": note["contact_id"], "deal_id": note["deal_id"]}


@app.post("/api/notes/{note_id}/actions")
def add_note_actions(note_id: int, payload: ActionsIn):
    """Append action items (e.g. from a summary) to the note as checklist lines."""
    with session() as conn:
        note = one(conn, "notes", note_id)
        present = {t["text"] for t in extract_tasks(note["body"])}
        lines = []
        for item in payload.items:
            text = " ".join(item.text.split())
            if not text or text in present:
                continue
            present.add(text)
            owner = f" ({item.owner})" if item.owner else ""
            due = f" @{item.due_date}" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", item.due_date or "") else ""
            lines.append(f"[ ] {text}{owner}{due}")
        if lines:
            body = note["body"].rstrip() + ("\n\n## Action items\n" if "## Action items" not in note["body"] else "\n")
            conn.execute("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
                         (body + "\n".join(lines) + "\n", now(), note_id))
        updated = note_row(conn, note_id)
        after_note_save(conn, updated)
        return {"added": len(lines), "note": updated}


@app.get("/api/notes/{note_id}/export.md")
def export_note(note_id: int):
    with session() as conn:
        note = note_row(conn, note_id)
    meta = [f"- **Type:** {note['kind']}"]
    for label, key in (("Date", "meeting_date"), ("Contact", "contact_name"), ("Company", "company_name"),
                       ("Deal", "deal_title"), ("Attendees", "attendees")):
        if note.get(key):
            meta.append(f"- **{label}:** {note[key]}")
    text = f"# {note['title']}\n\n" + "\n".join(meta) + "\n\n" + note["body"]
    if note.get("summary"):
        s = json.loads(note["summary"])
        text += "\n\n---\n## Summary\n" + s.get("summary", "")
        if s.get("decisions"):
            text += "\n\n### Decisions\n" + "\n".join(f"- {d}" for d in s["decisions"])
        if s.get("next_step"):
            text += f"\n\n**Next step:** {s['next_step']}"
    slug = re.sub(r"[^a-z0-9]+", "-", note["title"].lower()).strip("-") or "note"
    return Response(text, media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="{slug}.md"'})


# ==================================================================== tasks
def task_rows(conn, where: str = "1=1", args: Optional[list] = None) -> list[dict]:
    return rows(conn.execute(
        "SELECT t.*, c.name AS contact_name, n.title AS note_title, d.title AS deal_title FROM tasks t"
        " LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN notes n ON n.id = t.note_id"
        " LEFT JOIN deals d ON d.id = t.deal_id"
        f" WHERE {where}"
        " ORDER BY t.done, t.due_date = '', t.due_date,"
        " CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC",
        args or [],
    ))


@app.get("/api/tasks")
def list_tasks(done: Optional[bool] = None, contact_id: Optional[int] = None, deal_id: Optional[int] = None):
    where, args = ["1=1"], []
    if done is not None:
        where.append("t.done = ?")
        args.append(int(done))
    for col, val in (("contact_id", contact_id), ("deal_id", deal_id)):
        if val:
            where.append(f"t.{col} = ?")
            args.append(val)
    with session() as conn:
        return task_rows(conn, " AND ".join(where), args)


def check_priority(priority: Optional[str]) -> None:
    if priority and priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of {PRIORITIES}")


@app.post("/api/tasks")
def create_task(payload: TaskIn):
    check_priority(payload.priority)
    item = parse_task_line(payload.text)
    if not item["text"]:
        raise HTTPException(status_code=400, detail="text is required")
    with session() as conn:
        company_id = payload.company_id
        if payload.contact_id and not company_id:
            row = conn.execute("SELECT company_id FROM contacts WHERE id = ?", (payload.contact_id,)).fetchone()
            company_id = row["company_id"] if row else None
        cur = conn.execute(
            "INSERT INTO tasks (text, done, note_id, contact_id, deal_id, company_id, due_date, priority, completed_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (item["text"], int(payload.done), payload.note_id, payload.contact_id, payload.deal_id, company_id,
             payload.due_date or item["due_date"], payload.priority or item["priority"],
             now() if payload.done else ""),
        )
        return task_rows(conn, "t.id = ?", [cur.lastrowid])[0]


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: int, payload: TaskPatch):
    check_priority(payload.priority)
    with session() as conn:
        current = one(conn, "tasks", task_id)
        updates = payload.model_dump(exclude_unset=True)
        if "text" in updates and current["note_id"] and updates["text"] != current["text"]:
            raise HTTPException(status_code=400, detail="edit this action item in its note")
        if "done" in updates:
            updates["done"] = int(bool(updates["done"]))
            if updates["done"] != current["done"]:
                updates["completed_at"] = now() if updates["done"] else ""
                if updates["done"] and current["contact_id"]:
                    log_activity(conn, "task", f"Completed: {current['text']}", contact_id=current["contact_id"],
                                 deal_id=current["deal_id"])
        if updates:
            clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(f"UPDATE tasks SET {clause} WHERE id = :id", {**updates, "id": task_id})
        if "done" in updates and current["note_id"]:
            note = one(conn, "notes", current["note_id"])
            conn.execute("UPDATE notes SET body = ? WHERE id = ?",
                         (set_checkbox(note["body"], current["text"], bool(updates["done"])), note["id"]))
        return task_rows(conn, "t.id = ?", [task_id])[0]


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    with session() as conn:
        task = one(conn, "tasks", task_id)
        if task["note_id"]:
            note = one(conn, "notes", task["note_id"])
            kept = [line for line in note["body"].splitlines()
                    if not (notetaker.CHECKBOX.match(line)
                            and parse_task_line(notetaker.CHECKBOX.match(line).group(2))["text"] == task["text"])]
            conn.execute("UPDATE notes SET body = ? WHERE id = ?", ("\n".join(kept), note["id"]))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return {"ok": True}


# ================================================================ dashboard
@app.get("/api/stats")
def stats():
    t = today()
    month = t[:7]
    week_ago = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    with session() as conn:
        deals = deal_rows(conn)
        count = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731
        by_stage = {s: {"count": 0, "value": 0.0, "weighted": 0.0} for s in STAGES}
        for d in deals:
            b = by_stage.setdefault(d["stage"], {"count": 0, "value": 0.0, "weighted": 0.0})
            b["count"] += 1
            b["value"] += d["value"] or 0
            b["weighted"] += d["weighted_value"]
        won = [d for d in deals if d["stage"] == "won"]
        lost = [d for d in deals if d["stage"] == "lost"]
        open_deals = [d for d in deals if d["is_open"]]
        forecast: dict[str, float] = {}
        for d in open_deals:
            key = (d["close_date"] or "")[:7] or "unscheduled"
            if key != "unscheduled" and key < month:
                key = "overdue"
            forecast[key] = forecast.get(key, 0) + d["weighted_value"]
        activity_counts = dict(conn.execute(
            "SELECT type, COUNT(*) FROM activities WHERE occurred_at >= ? AND type IN (%s) GROUP BY type"
            % ",".join("?" * len(TOUCH_TYPES)), (week_ago, *sorted(TOUCH_TYPES)),
        ).fetchall())
        activity_counts["notes"] = count(
            "SELECT COUNT(*) FROM notes WHERE kind IN ('meeting','call') AND created_at >= ?", week_ago)
        company_signals = health_signals(conn, "company_id")
        accounts = []
        for co in rows(conn.execute("SELECT id, name, renewal_date, mrr, owner FROM companies")):
            sig = company_signals.get(co["id"])
            if sig is None and not co["renewal_date"]:
                continue  # no relationship yet
            accounts.append({**co, "health": score_health(sig, co["renewal_date"] or "")})
        horizon = (dt.date.today() + dt.timedelta(days=90)).isoformat()
        return {
            "at_risk": sorted((a for a in accounts if a["health"]["label"] in ("at-risk", "watch")),
                              key=lambda a: a["health"]["score"])[:6],
            "renewals": sorted((a for a in accounts if a["renewal_date"] and a["renewal_date"] <= horizon),
                               key=lambda a: a["renewal_date"])[:6],
            "activities_total": count("SELECT COUNT(*) FROM activities WHERE type IN ('call','email','meeting','linkedin','sms')"),
            "summaries": count("SELECT COUNT(*) FROM notes WHERE summary != ''"),
            "contacts": count("SELECT COUNT(*) FROM contacts"),
            "companies": count("SELECT COUNT(*) FROM companies"),
            "notes": count("SELECT COUNT(*) FROM notes"),
            "open_tasks": count("SELECT COUNT(*) FROM tasks WHERE done = 0"),
            "overdue_tasks": count("SELECT COUNT(*) FROM tasks WHERE done = 0 AND due_date != '' AND due_date < ?", t),
            "due_today": count("SELECT COUNT(*) FROM tasks WHERE done = 0 AND due_date = ?", t),
            "open_pipeline": sum(d["value"] for d in open_deals),
            "weighted_pipeline": round(sum(d["weighted_value"] for d in open_deals), 2),
            "open_deals": len(open_deals),
            "won": sum(d["value"] for d in won),
            "won_this_month": sum(d["value"] for d in won if (d["stage_changed_at"] or "")[:7] == month),
            "win_rate": round(100 * len(won) / (len(won) + len(lost))) if won or lost else None,
            "avg_won": round(sum(d["value"] for d in won) / len(won)) if won else 0,
            "by_stage": by_stage,
            "forecast": [{"month": k, "weighted": round(v, 2)} for k, v in sorted(forecast.items())],
            "stale_deals": sorted((d for d in open_deals if d["stale"]), key=lambda d: -d["value"])[:8],
            "follow_ups": rows(conn.execute(
                "SELECT id, name, company, next_follow_up, owner FROM contacts"
                " WHERE next_follow_up != '' AND next_follow_up <= ? AND status != 'churned'"
                " ORDER BY next_follow_up LIMIT 12", (t,))),
            "agenda": task_rows(conn, "t.done = 0 AND t.due_date != '' AND t.due_date <= ?", [t])[:15],
            "activity_7d": activity_counts,
            "recent_activity": rows(conn.execute(activity_select("1=1") + " LIMIT 12")),
        }


@app.get("/api/meta")
def meta():
    with session() as conn:
        owners = sorted({r[0] for r in conn.execute(
            "SELECT owner FROM contacts UNION SELECT owner FROM deals UNION SELECT owner FROM companies"
        ) if r[0]})
        tags = sorted({t.strip() for (raw,) in conn.execute("SELECT tags FROM contacts") for t in (raw or "").split(",") if t.strip()})
    return {
        "stages": STAGES, "stage_probability": STAGE_PROBABILITY, "statuses": STATUSES,
        "note_kinds": NOTE_KINDS, "activity_types": ACTIVITY_TYPES, "priorities": PRIORITIES,
        "owners": owners, "tags": tags, "ai_enabled": notetaker.ai_available(),
        "ai_model": notetaker.AI_MODEL, "today": today(),
    }


@app.get("/api/search")
def search(q: str):
    like = f"%{q}%"
    with session() as conn:
        notes = rows(conn.execute(
            "SELECT id, title, body FROM notes WHERE title LIKE ? OR body LIKE ? OR attendees LIKE ?"
            " ORDER BY updated_at DESC LIMIT 8", (like, like, like)))
        for n in notes:
            idx = n["body"].lower().find(q.lower())
            n["snippet"] = n.pop("body")[max(0, idx - 30): idx + 60].replace("\n", " ") if idx >= 0 else ""
        return {
            "contacts": rows(conn.execute(
                "SELECT id, name, company, title FROM contacts WHERE name LIKE ? OR company LIKE ? OR email LIKE ?"
                " OR phone LIKE ? OR tags LIKE ? LIMIT 8", (like,) * 5)),
            "companies": rows(conn.execute(
                "SELECT id, name, industry FROM companies WHERE name LIKE ? OR domain LIKE ? LIMIT 6", (like, like))),
            "deals": rows(conn.execute(
                "SELECT id, title, value, stage FROM deals WHERE title LIKE ? OR next_step LIKE ? LIMIT 8", (like, like))),
            "notes": notes,
            "tasks": rows(conn.execute(
                "SELECT id, text, due_date, done FROM tasks WHERE text LIKE ? AND done = 0 LIMIT 6", (like,))),
        }


class AssistantIn(BaseModel):
    message: str
    history: list[dict] = []
    context: dict = {}


@app.post("/api/assistant")
def assistant_reply(payload: AssistantIn):
    from . import assistant

    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="message is empty")
    return assistant.reply(payload.message, payload.history, payload.context)


@app.get("/api/assistant/suggestions")
def assistant_suggestions(view: str = "", id: str = ""):
    from . import assistant

    return assistant.suggestions({"view": view, "id": id})


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(os.path.join(FRONTEND_DIR, "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    # Served from the root so the worker controls the whole app.
    return FileResponse(os.path.join(FRONTEND_DIR, "sw.js"), media_type="text/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
