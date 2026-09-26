"""Populate the database with a small demo dataset."""

import datetime as dt
import os

from crm.db import init_db, session


def day(offset: int) -> str:
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


# name, domain, industry, size, location, owner, renewal offset (days), monthly contract value
COMPANIES = [
    ("Northwind Analytics", "northwind.io", "SaaS", "200-500", "San Francisco, US", "Ayman", 20, 8000),
    ("Brightloop", "brightloop.com", "Logistics", "50-200", "New York, US", "Rami", None, 0),
    ("Ferro Labs", "ferrolabs.dev", "Dev tools", "50-200", "London, UK", "Ayman", 55, 4500),
    ("Cedar Point", "cedarpoint.co", "E-commerce", "10-50", "Dubai, UAE", "Rami", None, 0),
    ("Quilt", "quilt.app", "Fintech", "50-200", "Chicago, US", "Ayman", None, 0),
]

# name, email, phone, company ref, title, status, tags, source, owner, next follow-up offset
CONTACTS = [
    ("Dana Whitfield", "dana@northwind.io", "+1 415 555 0132", 1, "VP Sales", "active", "enterprise,champion", "referral", "Ayman", 2),
    ("Marcus Oyelaran", "marcus@brightloop.com", "+1 646 555 0177", 2, "Head of Ops", "prospect", "inbound,support", "website", "Rami", 0),
    ("Priya Raman", "priya@ferrolabs.dev", "+44 20 7946 0102", 3, "CRO", "active", "expansion", "apollo", "Ayman", 7),
    ("Tomás Iglesias", "tomas@cedarpoint.co", "", 4, "Founder", "lead", "referral,mena", "linkedin", "Rami", -1),
    ("Hannah Berg", "hannah@quilt.app", "+1 312 555 0119", 5, "RevOps Lead", "churned", "winback", "apollo", "Ayman", None),
]

# title, contact ref, value, stage, close offset, owner, next step
DEALS = [
    ("Northwind — SDR team renewal (4 reps)", 1, 96000, "negotiation", 20, "Ayman", "Finance sign-off on 12-month term"),
    ("Brightloop — support desk pilot", 2, 18000, "qualified", 35, "Rami", "Send pilot scope"),
    ("Ferro Labs — EMEA SDR expansion", 3, 54000, "proposal", 45, "Ayman", "Proposal review call"),
    ("Cedar Point — Arabic outbound starter", 4, 9000, "lead", 60, "Rami", "Discovery call"),
    ("Quilt — winback", 5, 24000, "lost", None, "Ayman", ""),
    ("Northwind — appointment-setting add-on", 1, 15000, "won", -25, "Ayman", ""),
]

NOTES = [
    (
        "Northwind renewal call",
        "## Attendees\nDana, Sam (procurement)\n\n"
        "Renewal is tracking well. Dana is happy with meeting volume from the 4-rep pod.\n"
        "Budget approval sits with finance, decision expected mid-October. #renewal\n\n"
        "## Decisions\n- Agreed to move to a 12-month term if we hold current pricing\n\n"
        "## Risks\n- Procurement is benchmarking a cheaper offshore vendor\n\n"
        "## Next steps\n"
        f"[ ] Send updated pricing sheet to Dana @{day(1)} !high\n"
        f"[ ] Share Q3 results deck @{day(3)}\n"
        "[x] Share Q3 usage report\n",
        "call", 1, 1,
    ),
    (
        "Brightloop discovery",
        "Marcus is replacing an in-house support team of 6 that cannot cover US evenings.\n"
        "Main pain: 40% of tickets wait more than 12 hours. Timeline is next quarter. #discovery\n\n"
        "## Qualification (BANT)\n- Budget: ~$6k/month approved\n- Authority: Marcus + CFO\n"
        "- Need: evening + weekend coverage\n- Timeline: Q1 start\n\n"
        f"[ ] Draft pilot scope doc @{day(-1)} !high\n",
        "meeting", 2, 2,
    ),
    (
        "Ferro Labs — expansion signals",
        "Priya mentioned two new EMEA markets opening in November and wants French-speaking reps.\n"
        "Good candidate for expansion before the annual true-up. #expansion\n\n"
        f"[ ] Pull meetings-booked numbers by rep @{day(4)}\n",
        "note", 3, 3,
    ),
    (
        "Ideas: onboarding checklist",
        "Standardise the first-30-days checklist so notes from kickoff calls\n"
        "auto-create the same action items every time. #ops\n",
        "idea", None, None,
    ),
]

# type, subject, body, outcome, contact ref, deal ref, days ago
ACTIVITIES = [
    ("email", "Sent renewal proposal", "Attached 12-month pricing.", "sent", 1, 1, 3),
    ("call", "Check-in with Dana", "Confirmed finance meeting date.", "connected", 1, 1, 1),
    ("linkedin", "Connection accepted", "", "", 4, 4, 6),
    ("call", "Cold call", "Left voicemail.", "voicemail", 4, 4, 2),
    ("meeting", "Proposal walkthrough", "Priya looped in her Head of Sales.", "held", 3, 3, 16),
    ("email", "Winback offer", "No reply after 2 follow-ups.", "no reply", 5, 5, 30),
]


def main() -> None:
    # Seed summaries with the offline extractor: fast, free and deterministic.
    os.environ["CRM_AI_DISABLED"] = "1"
    init_db()
    from crm import main as app

    with session() as conn:
        if conn.execute("SELECT COUNT(*) c FROM contacts").fetchone()["c"]:
            print("database already seeded")
            return

    company_ids = {
        i: app.create_company(app.CompanyIn(
            name=n, domain=d, industry=ind, size=sz, location=loc, owner=o,
            renewal_date=day(renew) if renew is not None else "", mrr=mrr,
        ))["id"]
        for i, (n, d, ind, sz, loc, o, renew, mrr) in enumerate(COMPANIES, start=1)
    }
    contact_ids = {}
    for i, (name, email, phone, co, title, status, tags, source, owner, follow) in enumerate(CONTACTS, start=1):
        contact_ids[i] = app.create_contact(app.ContactIn(
            name=name, email=email, phone=phone, company_id=company_ids[co], title=title, status=status,
            tags=tags, source=source, owner=owner, next_follow_up=day(follow) if follow is not None else "",
        ))["id"]
    deal_ids = {}
    for i, (title, ref, value, stage, close, owner, step) in enumerate(DEALS, start=1):
        deal_ids[i] = app.create_deal(app.DealIn(
            title=title, contact_id=contact_ids[ref], value=value, stage="lead",
            close_date=day(close) if close is not None else "", owner=owner, next_step=step,
        ))["id"]
        if stage != "lead":
            app.update_deal(deal_ids[i], app.DealIn(
                stage=stage, lost_reason="Chose cheaper vendor" if stage == "lost" else None))
    for title, body, kind, contact_ref, deal_ref in NOTES:
        app.create_note(app.NoteIn(
            title=title, body=body, kind=kind, meeting_date=day(-2) if kind != "idea" else "",
            contact_id=contact_ids.get(contact_ref), deal_id=deal_ids.get(deal_ref),
        ))
    for type_, subject, body, outcome, contact_ref, deal_ref, ago in ACTIVITIES:
        app.create_activity(app.ActivityIn(
            type=type_, subject=subject, body=body, outcome=outcome, contact_id=contact_ids[contact_ref],
            deal_id=deal_ids[deal_ref], occurred_at=day(-ago),
        ))
    # Summaries give the health score sentiment and risk signals.
    for note in app.list_notes():
        if note["body"].strip() and note["kind"] != "idea":
            app.summarize_note(note["id"])
    # Make one open deal look stale so the dashboard has something to flag.
    with session() as conn:
        old = (dt.date.today() - dt.timedelta(days=18)).isoformat() + " 10:00:00"
        conn.execute("UPDATE deals SET updated_at = ?, stage_changed_at = ? WHERE id = ?", (old, old, deal_ids[3]))
        conn.execute("UPDATE activities SET occurred_at = ? WHERE deal_id = ?", (old, deal_ids[3]))
        conn.execute("UPDATE notes SET updated_at = ? WHERE deal_id = ?", (old, deal_ids[3]))
    print("seeded demo data")


if __name__ == "__main__":
    main()
