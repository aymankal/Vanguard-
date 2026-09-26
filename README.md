# Vanguard CRM

<img src="web/logo.png" alt="Vanguard" width="72" />

The CRM for Vanguard Services: pipeline, accounts, meeting notes and an AI **Copilot** that
plans your day, briefs you before calls and updates records when you ask.

## What's inside

**Copilot (AI assistant)** — open it from any page (sidebar, top bar, the Home ask box, `⌘/Ctrl+J`,
or the floating button on phones). It knows which record you're looking at, so "brief me on this
deal" or "log a call: left voicemail" just work.

| Ask | Copilot does |
| --- | --- |
| "What should I focus on today?" | Overdue tasks, follow-ups due, deals going cold, at-risk accounts |
| "Brief me on Northwind" | Health, contract, renewal, people, open deals, last meeting, next best action |
| "Remind me to send Dana pricing tomorrow, urgent" | Creates a high-priority task due tomorrow, linked to Dana |
| "Log a call with Marcus: pilot scope agreed" | Adds the call to the timeline, updates last touch |
| "Move the Ferro deal to negotiation" | Moves the deal (records the stage change) |
| "Follow up with Priya on Friday" | Sets the contact's next follow-up |
| "Draft a follow-up email to Tomás" | Client-ready draft with a copy button |
| "Pipeline", "deals going cold", "accounts at risk", "what's overdue" | Instant reports with links |

Every change shows as a green action card linking to the record, and the page refreshes.

- **With `ANTHROPIC_API_KEY`**: Claude (`claude-opus-5` by default, `CRM_AI_MODEL` to change) runs
  with CRM tools — search, look up contacts/companies/deals, agenda, pipeline, create tasks, log
  activities, set follow-ups, move deals, save notes. It never deletes anything.
- **Without a key**: a built-in assistant handles the requests above, so demos never break.

**CRM** — dashboard with a daily briefing, weighted pipeline, win rate, forecast, renewals and
at-risk accounts; contacts (filters, bulk actions, CSV import from Apollo/HubSpot/LinkedIn,
duplicate warnings); companies with contract value, renewal date and relationship health;
drag-and-drop pipeline; click-to-edit fields; activity timelines; tasks with priorities and due
dates; Undo instead of "are you sure?" dialogs.

**Note taker** — templates (discovery, SDR scoping, QBR, cold call, internal), meeting timer,
timestamps, dictation, `[ ] Send deck @fri !high` checklists that become tasks, one-click
summaries (decisions, risks, action items, next step) and client recap emails.

**Everywhere** — `⌘K` command bar, light and dark themes, installable on Android/iPhone,
sign-in page with 30-day sessions, © Vanguard Services S.A.L 2026.

## Deploy on Render (5 minutes)

1. Render → **New → Blueprint** → pick this repository → **Apply**. Everything (build and start
   commands, disk, region, password) comes from `render.yaml`; nothing to type.
2. Plan: Starter + 1 GB disk (~$7.25/month) so data survives restarts. Set `CRM_SEED_DEMO` to
   `false` before the first deploy to start with an empty CRM.
3. When it's live, open the service → **Environment** → copy `CRM_PASSWORD`. Sign in with
   username `vanguard`.
4. Optional: add `ANTHROPIC_API_KEY` in Environment to switch Copilot to Claude.
5. On your phone: open the URL in Chrome → sign in → tap **Install** on the Home card.

Other hosts: `Dockerfile` works anywhere Docker runs; any Python host works with
`pip install -r requirements.txt` and `sh start.sh`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CRM_PASSWORD` | Turns on sign-in. On Render without it, a temporary password is printed in the logs (and changes on restart). |
| `CRM_USERNAME` | Sign-in username, not case-sensitive (default `vanguard`). |
| `CRM_DB_PATH` | SQLite file (default `crm.db`). Point it at a persistent disk in production. |
| `CRM_SEED_DEMO` | `false` skips sample data on first boot. |
| `ANTHROPIC_API_KEY` | Powers Copilot, note summaries and recaps with Claude. |
| `CRM_AI_MODEL` | Claude model (default `claude-opus-5`). |
| `CRM_AI_DISABLED` | Force the built-in (offline) assistant. |

## Run locally

```bash
pip install -r requirements.txt
python seed.py                      # optional sample data
python -m uvicorn crm.main:app --reload
```

Open http://localhost:8000. Tests: `pip install -r requirements-dev.txt && python -m pytest tests`.

## Layout

```
crm/        FastAPI backend: main.py (API), assistant.py (Copilot), notetaker.py, auth.py, db.py
web/        Frontend: index.html, styles.css (design system), app.js, copilot.js, PWA files
tests/      API and Copilot tests
seed.py     Sample data
```

---

© Vanguard Services S.A.L 2026
