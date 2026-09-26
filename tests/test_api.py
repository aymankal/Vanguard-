import base64
import datetime as dt
import importlib
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CRM_DB_PATH", str(tmp_path / "crm.db"))
    monkeypatch.setenv("CRM_AI_DISABLED", "1")
    monkeypatch.delenv("CRM_PASSWORD", raising=False)
    from crm import db, main

    importlib.reload(db)
    importlib.reload(main)
    with TestClient(main.app) as c:
        yield c


def day(offset):
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


def test_contact_creates_and_links_company(client):
    c = client.post("/api/contacts", json={"name": "Dana", "company": "Northwind"}).json()
    assert c["company_id"]
    again = client.post("/api/contacts", json={"name": "Sam", "company": "northwind"}).json()
    assert again["company_id"] == c["company_id"]
    company = client.get(f"/api/companies/{c['company_id']}").json()
    assert {x["name"] for x in company["contacts"]} == {"Dana", "Sam"}
    assert client.post("/api/contacts", json={"name": "X", "status": "bogus"}).status_code == 400


def test_partial_update_keeps_other_fields(client):
    c = client.post("/api/contacts", json={"name": "Dana", "email": "d@x.io", "owner": "Ayman"}).json()
    updated = client.patch(f"/api/contacts/{c['id']}", json={"status": "active"}).json()
    assert updated["email"] == "d@x.io" and updated["owner"] == "Ayman" and updated["status"] == "active"


def test_note_checklist_syncs_tasks_with_due_dates_and_priority(client):
    c = client.post("/api/contacts", json={"name": "Dana"}).json()
    note = client.post("/api/notes", json={
        "title": "Call", "kind": "call", "contact_id": c["id"],
        "body": "[ ] Send pricing @2030-01-15 !high\n[x] Share report\n- [ ] Book demo @tomorrow",
    }).json()
    tasks = {t["text"]: t for t in client.get("/api/tasks").json()}
    assert tasks["Send pricing"]["due_date"] == "2030-01-15"
    assert tasks["Send pricing"]["priority"] == "high"
    assert tasks["Share report"]["done"] == 1
    assert tasks["Book demo"]["due_date"] == day(1)
    assert tasks["Book demo"]["contact_id"] == c["id"]

    # ticking in the task list updates the note, and unticking reverts it
    tid = tasks["Send pricing"]["id"]
    client.patch(f"/api/tasks/{tid}", json={"done": True})
    body = client.get(f"/api/notes/{note['id']}").json()["body"]
    assert "[x] Send pricing @2030-01-15 !high" in body
    client.patch(f"/api/tasks/{tid}", json={"done": False})
    assert "[ ] Send pricing" in client.get(f"/api/notes/{note['id']}").json()["body"]

    # removing the line removes the task; deleting a task removes the line
    client.patch(f"/api/notes/{note['id']}", json={"body": "[ ] Book demo"})
    assert [t["text"] for t in client.get("/api/tasks").json()] == ["Book demo"]
    remaining = client.get("/api/tasks").json()[0]
    assert remaining["due_date"] == day(1), "due date survives when the token is dropped"
    client.delete(f"/api/tasks/{remaining['id']}")
    assert "Book demo" not in client.get(f"/api/notes/{note['id']}").json()["body"]


def test_meeting_note_updates_last_contacted(client):
    c = client.post("/api/contacts", json={"name": "Dana"}).json()
    client.post("/api/notes", json={"kind": "meeting", "contact_id": c["id"], "meeting_date": "2026-01-02"})
    assert client.get(f"/api/contacts/{c['id']}").json()["last_contacted_at"].startswith("2026-01-02")


def test_templates(client):
    templates = client.get("/api/templates").json()
    note = client.post("/api/notes", json={"template": templates[0]["id"]}).json()
    assert note["title"] == templates[0]["name"] and "## " in note["body"]
    assert client.get("/api/tasks").json(), "template next steps become tasks"
    assert client.post("/api/notes", json={"template": "nope"}).status_code == 400


def test_deal_stage_change_logs_activity_and_probability(client):
    c = client.post("/api/contacts", json={"name": "Dana", "company": "Northwind"}).json()
    deal = client.post("/api/deals", json={"title": "Pod", "contact_id": c["id"], "value": 1000}).json()
    assert deal["company_id"] == c["company_id"]
    assert deal["probability"] == 10 and deal["weighted_value"] == 100
    moved = client.patch(f"/api/deals/{deal['id']}", json={"stage": "proposal"}).json()
    assert moved["probability"] == 50 and moved["title"] == "Pod"
    timeline = client.get(f"/api/deals/{deal['id']}").json()["timeline"]
    assert any(i["type"] == "stage" and "lead → proposal" in i["subject"] for i in timeline)
    client.patch(f"/api/deals/{deal['id']}", json={"stage": "won"})
    assert client.get(f"/api/contacts/{c['id']}").json()["status"] == "active"
    assert client.post("/api/deals", json={"title": "x", "stage": "nope"}).status_code == 400


def test_activity_with_follow_up(client):
    c = client.post("/api/contacts", json={"name": "Dana"}).json()
    a = client.post("/api/activities", json={
        "type": "call", "subject": "Intro", "outcome": "connected", "contact_id": c["id"],
        "occurred_at": "2026-03-04T10:30", "follow_up_text": "Send deck", "follow_up_date": "2030-02-01",
    }).json()
    assert a["occurred_at"] == "2026-03-04 10:30:00"
    contact = client.get(f"/api/contacts/{c['id']}").json()
    assert contact["last_contacted_at"] == "2026-03-04 10:30:00"
    assert contact["next_follow_up"] == "2030-02-01"
    assert contact["tasks"][0]["text"] == "Send deck"
    assert contact["timeline"][0]["subject"] == "Intro"
    assert client.post("/api/activities", json={"type": "fax"}).status_code == 400


def test_summary_offline_and_apply_actions(client):
    note = client.post("/api/notes", json={
        "title": "Discovery",
        "body": "They need weekend coverage. Budget is approved.\n\n## Decisions\n- Start with a 2-rep pilot\n\n"
                "## Risks\n- Competitor quoted lower\n\nTODO: send SOW",
    }).json()
    s = client.post(f"/api/notes/{note['id']}/summarize").json()
    assert s["engine"] == "offline"
    assert "weekend coverage" in s["summary"]
    assert s["decisions"] == ["Start with a 2-rep pilot"]
    assert s["risks"] == ["Competitor quoted lower"]
    assert s["action_items"][0]["text"] == "send SOW"
    added = client.post(f"/api/notes/{note['id']}/actions", json={"items": s["action_items"]}).json()
    assert added["added"] == 1
    again = client.post(f"/api/notes/{note['id']}/actions", json={"items": s["action_items"]}).json()
    assert again["added"] == 0
    assert [t["text"] for t in client.get("/api/tasks").json()] == ["send SOW"]
    md = client.get(f"/api/notes/{note['id']}/export.md")
    assert md.status_code == 200 and "## Summary" in md.text


def test_csv_import_dedupes_by_email(client):
    csv_text = (
        "First Name,Last Name,Email,Company Name,Title,Person Linkedin Url\n"
        "Dana,Whitfield,dana@nw.io,Northwind,VP Sales,https://linkedin.com/in/dana\n"
        ",,,,,\n"
    )
    assert client.post("/api/contacts/import", json={"csv": csv_text}).json() == {"created": 1, "updated": 0, "skipped": 1}
    again = "Email,Name,Phone\ndana@nw.io,Dana Whitfield,+1 555\n"
    assert client.post("/api/contacts/import", json={"csv": again}).json()["updated"] == 1
    contacts = client.get("/api/contacts").json()
    assert len(contacts) == 1
    assert contacts[0]["phone"] == "+1 555" and contacts[0]["title"] == "VP Sales"
    assert contacts[0]["company"] == "Northwind" and contacts[0]["source"] == "import"
    exported = client.get("/api/contacts/export.csv").text
    assert "dana@nw.io" in exported


def test_stats_and_search(client):
    c = client.post("/api/contacts", json={"name": "Dana", "next_follow_up": day(-1)}).json()
    client.post("/api/deals", json={"title": "Big", "contact_id": c["id"], "value": 1000, "stage": "proposal",
                                    "close_date": day(10)})
    client.post("/api/tasks", json={"text": "Overdue thing", "due_date": day(-2)})
    s = client.get("/api/stats").json()
    assert s["open_pipeline"] == 1000 and s["weighted_pipeline"] == 500
    assert s["overdue_tasks"] == 1 and s["agenda"][0]["text"] == "Overdue thing"
    assert s["follow_ups"][0]["name"] == "Dana"
    assert s["forecast"][0]["weighted"] == 500
    r = client.get("/api/search", params={"q": "big"}).json()
    assert r["deals"][0]["title"] == "Big"
    meta = client.get("/api/meta").json()
    assert meta["ai_enabled"] is False and "negotiation" in meta["stages"]


def test_basic_auth(client, monkeypatch):
    monkeypatch.setenv("CRM_PASSWORD", "s3cret")
    assert client.get("/api/stats").status_code == 401
    assert client.get("/healthz").status_code == 200
    token = base64.b64encode(b"admin:s3cret").decode()
    assert client.get("/api/stats", headers={"Authorization": f"Basic {token}"}).status_code == 200
    bad = base64.b64encode(b"admin:nope").decode()
    assert client.get("/api/stats", headers={"Authorization": f"Basic {bad}"}).status_code == 401


def test_legacy_database_is_migrated(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT DEFAULT '',
            phone TEXT DEFAULT '', company TEXT DEFAULT '', title TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'lead',
            tags TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE deals (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, contact_id INTEGER,
            value REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'lead', close_date TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO contacts (name, company) VALUES ('Dana', 'Northwind');
        INSERT INTO deals (title, contact_id, value, stage) VALUES ('Old deal', 1, 500, 'proposal');
    """)
    conn.commit()
    conn.close()
    monkeypatch.setenv("CRM_DB_PATH", str(path))
    monkeypatch.setenv("CRM_AI_DISABLED", "1")
    from crm import db, main

    importlib.reload(db)
    importlib.reload(main)
    with TestClient(main.app) as c:
        deal = c.get("/api/deals").json()[0]
        assert deal["company_name"] == "Northwind" and deal["weighted_value"] == 250
        assert c.get("/api/companies").json()[0]["name"] == "Northwind"


def test_health_score_and_actions(client):
    co = client.post("/api/companies", json={"name": "Northwind", "renewal_date": day(20), "mrr": 8000}).json()
    c = client.post("/api/contacts", json={"name": "Dana", "company_id": co["id"], "status": "active"}).json()
    health = client.get(f"/api/contacts/{c['id']}").json()["health"]
    assert health["label"] in ("watch", "at-risk") and "Never contacted" in health["reasons"]
    assert "Set a next follow-up date" in health["actions"]
    company = client.get(f"/api/companies/{co['id']}").json()
    assert any("Renewal in 20 days" in r for r in company["health"]["reasons"])
    stats = client.get("/api/stats").json()
    assert stats["renewals"][0]["name"] == "Northwind"
    assert stats["at_risk"][0]["name"] == "Northwind"

    client.post("/api/activities", json={"type": "call", "contact_id": c["id"]})
    client.patch(f"/api/contacts/{c['id']}", json={"next_follow_up": day(5)})
    health = client.get(f"/api/contacts/{c['id']}").json()["health"]
    assert health["label"] == "healthy" and health["score"] == 100

    note = client.post("/api/notes", json={"contact_id": c["id"], "kind": "meeting",
                                           "body": "They are unhappy and worried about churn.\n\n## Risks\n- Budget cut"}).json()
    client.post(f"/api/notes/{note['id']}/summarize")
    health = client.get(f"/api/contacts/{c['id']}").json()["health"]
    assert "Last conversation was negative" in health["reasons"]
    assert health["score"] < 75
    churned = client.patch(f"/api/contacts/{c['id']}", json={"status": "churned"})
    assert client.get(f"/api/contacts/{c['id']}").json()["health"]["label"] == "churned"


def test_recap_email(client):
    c = client.post("/api/contacts", json={"name": "Dana Whitfield", "email": "dana@nw.io", "owner": "Ayman"}).json()
    note = client.post("/api/notes", json={
        "title": "Renewal call", "contact_id": c["id"],
        "body": "Renewal is on track.\n\n## Decisions\n- Move to 12 months\n\n## Risks\n- Competitor is cheaper\n\n"
                "[ ] Send pricing @2030-01-15",
    }).json()
    r = client.post(f"/api/notes/{note['id']}/recap").json()
    assert r["to"] == "dana@nw.io" and r["subject"] == "Recap: Renewal call"
    assert r["body"].startswith("Hi Dana,") and "Move to 12 months" in r["body"]
    assert "Send pricing by" in r["body"] and r["body"].rstrip().endswith("Ayman")
    assert "Competitor" not in r["body"], "internal risks never go to the client"


def test_bulk_and_duplicates(client):
    a = client.post("/api/contacts", json={"name": "Dana", "email": "d@x.io", "tags": "vip"}).json()
    b = client.post("/api/contacts", json={"name": "Sam"}).json()
    dupes = client.get("/api/contacts/duplicates", params={"email": "D@X.IO", "name": "sam"}).json()
    assert {d["id"] for d in dupes} == {a["id"], b["id"]}
    assert client.get("/api/contacts/duplicates", params={"email": "d@x.io", "exclude": a["id"]}).json() == []
    ids = [a["id"], b["id"]]
    client.post("/api/contacts/bulk", json={"ids": ids, "action": "owner", "value": "Rami"})
    client.post("/api/contacts/bulk", json={"ids": ids, "action": "add_tag", "value": "q4"})
    client.post("/api/contacts/bulk", json={"ids": ids, "action": "remove_tag", "value": "vip"})
    contacts = {c["name"]: c for c in client.get("/api/contacts").json()}
    assert contacts["Dana"]["owner"] == "Rami" and contacts["Dana"]["tags"] == "q4"
    assert client.post("/api/contacts/bulk", json={"ids": ids, "action": "status", "value": "x"}).status_code == 400
    client.post("/api/contacts/bulk", json={"ids": ids, "action": "delete"})
    assert client.get("/api/contacts").json() == []


def test_installable_app_assets(client, monkeypatch):
    monkeypatch.setenv("CRM_PASSWORD", "s3cret")
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200 and manifest.headers["content-type"].startswith("application/manifest+json")
    assert manifest.json()["display"] == "standalone"
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "javascript" in sw.headers["content-type"]
    assert client.get("/static/icon-192.png").status_code == 200
    # Everything else, including the app shell and its data, still needs a sign-in.
    assert client.get("/", follow_redirects=False).headers["location"] == "/login"
    assert client.get("/static/app.js", follow_redirects=False).status_code == 303


def test_cloud_host_without_password_gets_one(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("CRM_DB_PATH", str(tmp_path / "crm.db"))
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("CRM_PASSWORD", raising=False)
    from crm import db, main

    importlib.reload(db)
    importlib.reload(main)
    try:
        assert "password:" in capsys.readouterr().out
        with TestClient(main.app) as c:
            assert c.get("/api/stats").status_code == 401
    finally:
        monkeypatch.delenv("CRM_PASSWORD", raising=False)


def test_login_page_flow(client, monkeypatch):
    monkeypatch.setenv("CRM_USERNAME", "vanguard")
    monkeypatch.setenv("CRM_PASSWORD", "s3cret ")  # a stray space pasted into the dashboard
    page = client.get("/", follow_redirects=True)
    assert page.url.path == "/login" and "Sign in" in page.text
    api = client.get("/api/stats")
    assert api.status_code == 401 and "www-authenticate" not in api.headers  # no native pop-up

    bad = client.post("/login", data={"username": "vanguard", "password": "nope"}, follow_redirects=False)
    assert bad.status_code == 401 and "Wrong username or password" in bad.text
    # Phone keyboards capitalise the username; spaces sneak in. Both are accepted.
    ok = client.post("/login", data={"username": " Vanguard ", "password": "s3cret", "next": "#/tasks"},
                     follow_redirects=False)
    assert ok.status_code == 303 and ok.headers["location"] == "/#/tasks"
    assert "HttpOnly" in ok.headers["set-cookie"] and "Max-Age=2592000" in ok.headers["set-cookie"]
    assert client.get("/api/stats").status_code == 200
    assert client.get("/login", follow_redirects=False).headers["location"] == "/"

    # Off-site redirects are ignored.
    evil = client.post("/login", data={"username": "vanguard", "password": "s3cret", "next": "https://evil.test"},
                       follow_redirects=False)
    assert evil.headers["location"] == "/#/"

    client.post("/logout")
    assert client.get("/api/stats").status_code == 401

    # Changing the password signs everyone out.
    client.post("/login", data={"username": "vanguard", "password": "s3cret"})
    monkeypatch.setenv("CRM_PASSWORD", "rotated")
    assert client.get("/api/stats").status_code == 401


def test_login_throttles_guessing(client, monkeypatch):
    from crm import auth

    auth._failures.clear()
    monkeypatch.setenv("CRM_PASSWORD", "s3cret")
    for _ in range(auth.MAX_FAILURES):
        client.post("/login", data={"username": "vanguard", "password": "guess"})
    locked = client.post("/login", data={"username": "vanguard", "password": "s3cret"})
    assert locked.status_code == 429 and "Too many attempts" in locked.text
    auth._failures.clear()
