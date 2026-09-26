import datetime as dt
import importlib
import json

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
        co = c.post("/api/companies", json={"name": "Northwind Analytics", "renewal_date": day(20), "mrr": 8000}).json()
        dana = c.post("/api/contacts", json={"name": "Dana Whitfield", "email": "dana@nw.io", "company_id": co["id"],
                                             "status": "active", "owner": "Ayman"}).json()
        c.post("/api/contacts", json={"name": "Marcus Oyelaran", "company": "Brightloop", "status": "prospect"})
        c.post("/api/deals", json={"title": "Northwind — SDR renewal", "contact_id": dana["id"], "value": 96000,
                                   "stage": "proposal", "next_step": "Finance sign-off"})
        c.post("/api/tasks", json={"text": "Send QBR deck", "due_date": day(-1), "contact_id": dana["id"]})
        yield c


def day(offset):
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


def ask(c, message, **context):
    r = c.post("/api/assistant", json={"message": message, "context": context})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "offline"
    return body


def test_agenda_lists_overdue_work(client):
    r = ask(client, "What should I focus on today?")
    assert "Send QBR deck" in r["reply"] and "(#/contacts/" in r["reply"]


def test_create_task_resolves_date_priority_and_contact(client):
    r = ask(client, "remind me to send Dana the pricing sheet tomorrow urgent")
    assert r["actions"] and r["actions"][0]["kind"] == "task"
    task = next(t for t in client.get("/api/tasks").json() if "pricing" in t["text"])
    assert task["due_date"] == day(1) and task["priority"] == "high"
    assert task["contact_name"] == "Dana Whitfield"


def test_log_call_uses_page_context(client):
    dana = client.get("/api/contacts").json()[0]
    r = ask(client, "Log a call: left voicemail", view="contacts", id=str(dana["id"]))
    assert "voicemail" in r["reply"]
    timeline = client.get(f"/api/contacts/{dana['id']}").json()["timeline"]
    assert timeline[0]["type"] == "call" and timeline[0]["outcome"] == "voicemail"


def test_move_deal_and_follow_up(client):
    r = ask(client, "move the Northwind deal to negotiation")
    assert "negotiation" in r["reply"]
    assert client.get("/api/deals").json()[0]["stage"] == "negotiation"
    r = ask(client, "follow up with Marcus in 3 days")
    marcus = next(c for c in client.get("/api/contacts").json() if c["name"].startswith("Marcus"))
    assert marcus["next_follow_up"] == day(3) and r["actions"][0]["kind"] == "follow_up"


def test_brief_draft_and_reports(client):
    brief = ask(client, "brief me on Northwind")["reply"]
    assert "Northwind Analytics" in brief and "Renewal" in brief
    draft = ask(client, "draft a follow-up email to Dana")["reply"]
    assert "Hi Dana," in draft and "```" in draft
    assert "Open pipeline" in ask(client, "pipeline summary")["reply"]
    assert "Accounts needing attention" in ask(client, "which accounts are at risk?")["reply"] \
        or "healthy" in ask(client, "which accounts are at risk?")["reply"]
    assert "overdue" in ask(client, "what's overdue")["reply"]
    assert "Copilot" in ask(client, "hello")["reply"]


def test_unknown_message_searches_then_helps(client):
    assert "Marcus" in ask(client, "Brightloop")["reply"]
    assert "I didn't catch that" in ask(client, "zzzz qqqq")["reply"]
    assert client.post("/api/assistant", json={"message": "  "}).status_code == 400


def test_suggestions_follow_the_page(client):
    assert "Brief me on this deal" in client.get("/api/assistant/suggestions", params={"view": "deals", "id": "1"}).json()
    assert client.get("/api/assistant/suggestions").json()


def test_claude_tools_run_and_report_errors(client):
    from crm import assistant

    text, action, err = assistant.run_tool("create_task", {"text": "Call Dana", "due_date": day(2)})
    assert not err and action["kind"] == "task" and json.loads(text)["due_date"] == day(2)
    text, action, err = assistant.run_tool("get_contact", {"contact_id": 999})
    assert err and "not found" in text
    text, action, err = assistant.run_tool("move_deal", {"deal_id": 1, "stage": "bogus"})
    assert err
    assert assistant.run_tool("nope", {})[2]
    # every tool has a name, description and object schema for the API
    for name, (_, spec) in assistant.TOOLS.items():
        assert spec["description"] and spec["input_schema"]["type"] == "object", name


def test_claude_loop_runs_tools(client, monkeypatch):
    """Drive claude_reply with a fake client: one tool call, then a final answer."""
    from types import SimpleNamespace as NS

    from crm import assistant

    calls = []

    class FakeMessages:
        def create(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return NS(stop_reason="tool_use", content=[
                    NS(type="text", text="Let me add that."),
                    NS(type="tool_use", id="t1", name="create_task", input={"text": "Prep QBR", "due_date": day(4)})])
            return NS(stop_reason="end_turn", content=[NS(type="text", text="Added **Prep QBR**.")])

    class FakeClient:
        def __init__(self, *a, **k):
            self.beta = NS(messages=FakeMessages())

    import anthropic

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    out = assistant.claude_reply("add a task to prep the QBR", [{"role": "assistant", "text": "hi"}], {"view": "tasks"})
    assert out["reply"] == "Added **Prep QBR**." and out["actions"][0]["kind"] == "task"
    assert calls[0]["messages"][0]["role"] == "user", "history must start with a user turn"
    assert calls[1]["messages"][-1]["content"][0]["type"] == "tool_result"
    assert any(t["text"] == "Prep QBR" for t in client.get("/api/tasks").json())
