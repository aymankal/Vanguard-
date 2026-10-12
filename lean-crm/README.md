# Lean CRM

A CRM that a solo seller or small sales team can use in five minutes, with no training.
It has five screens, one command bar, and Claude built in.

## Setup

1. `cd lean-crm && npm install`
2. `cp .env.example .env`, then paste your key from [console.anthropic.com](https://console.anthropic.com/settings/keys) as `ANTHROPIC_API_KEY`
3. `npm run dev`
4. Open http://localhost:5173

On first run it loads sample data: 10 companies, 20 contacts, 12 deals, plus tasks and timeline history.
To start fresh, delete `data/lean-crm.db`. The CRM works without a key; only the AI features need one.

## Screens

| Screen | What it's for |
|---|---|
| **Today** (home) | Overdue and due tasks, plus deals with no activity in 7+ days. One click to complete, snooze, log a touch or set a follow-up. |
| **Pipeline** | Drag-and-drop kanban with a value total per stage. Moving a card logs the stage change. |
| **Contacts / Companies** | One searchable table. Click a cell to edit it. CSV import and export. |
| **Record** | Timeline on the left, details on the right, AI panel at the bottom. |
| **Settings** | Pipeline stages, API key check, full data export. |

## Keyboard

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command bar (works on every screen) |
| `g` then `t` / `p` / `c` / `s` | Go to Today / Pipeline / Contacts / Settings |
| `/` | Search contacts |
| `⌘↵` | Confirm proposed changes, or save a note |

## AI

- **Command bar:** type plain English, for example *"Add Sara from Acme, $15k deal in Proposal, follow up Friday"* or *"What's closing this month?"*.
  Claude uses declared tools (`create_contact`, `create_company`, `create_deal`, `update_deal_stage`, `create_task`, `log_note`, `search_records`, `summarize_account`).
  - Write tools never touch the database. They return proposals that are checked against your data and shown on a confirmation card.
  - Nothing is saved until you click **Confirm**. All the changes are then saved together, or none are.
  - Answers stream in as they are written.
- **Research:** the button on every company and contact page. It uses Anthropic's web search tool (`web_search_20260209`), capped by `max_uses`.
  - You get: what they do, size, recent news, pain points, 3 talking points and a first outreach email, with clickable source links.
  - One click saves the result as a note on the record.
- **Next best action:** a one-line suggestion on every deal. It is cached, and it refreshes automatically once the deal's timeline changes.

All Claude calls run on the server. The API key is never sent to the browser.

### Configuration (`server/config.ts`)

| Constant | Default | What it does |
|---|---|---|
| `MODEL` | `claude-sonnet-5-5` | The one model used everywhere |
| `SELLER_PITCH` | Outsourced SDR/support | What you sell. Research uses it to frame pain points and the email draft |
| `RESEARCH_MAX_SEARCHES` | `5` | Most web searches allowed per Research click |
| `STALE_DAYS` | `7` | Days without activity before a deal shows up on Today |

Requests turn on Anthropic's server-side refusal fallback (`fallbacks: "default"`). If the model declines a request, the API retries it on a fallback model in the same call.

### Error messages

The following problems show up as one plain sentence in the app:

- missing or invalid key
- rate limits
- no credits left
- web search not enabled for your organization
- network failures
- Anthropic outages

**Web search** has to be enabled for your organization in the Anthropic Console before Research works.

## Agency Mode

Agency Mode is for BPO and SDR agencies that run outbound for several clients. It is **off by default**: the
single-user app above stays exactly as it is until you switch it on.

### Try it with demo data (1 step)

```
npm run demo
```

This seeds `data/demo.db` with 3 clients, 4 SDRs and 6 weeks of calls, emails, LinkedIn messages and meetings, then starts the app.
Your real database is not touched. Sign in at http://localhost:5173 with password `demo1234`:

| Login | Role | Sees |
|---|---|---|
| `owner@demo.agency` | Owner | Everything, plus the Agency Dashboard |
| `rana@demo.agency` | SDR | Helix Payments, Northstar Freight |
| `karim@demo.agency` | SDR | Helix Payments |
| `lina@demo.agency` | SDR | Northstar Freight, Bloom Dental Group |
| `omar@demo.agency` | SDR | Bloom Dental Group |
| `client@helixpayments.example` | Client | Helix Payments portal only |

The demo data covers every dashboard case:
- **Helix Payments** is healthy.
- **Northstar Freight** has activity down 30% or more and no meetings in 2 weeks.
- **Bloom Dental Group** has no activity in 3+ days.

### Turn it on for real (2 steps)

1. **Settings → Agency Mode → switch on.** Create your owner login. Your existing records move into a workspace called "My workspace". Nothing is deleted.
2. **Settings → Clients → add your clients.** Then use **Team → Invite by email** to invite SDRs (tick their clients) and client logins.

Turning Agency Mode off brings back the open single-user app on "My workspace". Other client workspaces are kept and come back when you turn it on again.

### What each role gets

- **Owner:**
  - All client workspaces, and the **Agency Dashboard** (`g a`).
  - Clients, team, invites and report timezone in Settings.
- **SDR:**
  - Only their assigned clients, in the same Today, Pipeline and Contacts screens.
  - The **Log** bar on every contact, company and deal. Each log is credited to the rep and can be undone.

    | Key | Logs |
    |---|---|
    | `1` | Connected call |
    | `2` | No answer |
    | `3` | Voicemail |
    | `e` | Email |
    | `l` | LinkedIn |
    | `m` then `↵` | Meeting booked |
- **Client:**
  - One read-only page: pipeline created this week and this month, meetings booked (date, prospect, status), a recent activity feed, and the latest weekly report with a PDF download.
  - Internal free-text notes are never shown to clients.

To switch client, use the switcher at the top, or press `⌘K` and type the client's name, then `↓ ↵`. The owner's "All clients" view is a read-only rollup of pipeline and activity per client.

### Scores, flags and reports

Everything tunable lives in **`server/agencyConfig.ts`**.

- **Activity score:** call 1, connected call 3, email 1, meeting booked 10. LinkedIn counts 1; the brief didn't set a value for it, so set it to 0 there if you prefer.
- **Leaderboard:** activity count, connect rate, meetings booked and score per rep, for today or this week.
- **Health flags:** a client is flagged when any of these is true:
  - activity is down 30% or more versus the previous 7 days
  - no meetings booked in 14 days
  - no logged activity in 3 days

  Each flag gets a one-line AI suggestion, cached per day.
- **Weekly report:**
  - **When:** every Monday 08:00 in the report timezone (default `Asia/Beirut`, editable in Settings), a draft is created per active client for the previous Monday–Sunday.
  - **Contents:** calls made, connect rate, emails sent, meetings booked, pipeline created, top 3 wins, blockers, and the plan for next week.
  - **How Claude writes it:** every figure is counted from the database. Claude only writes prose around placeholders like `{{calls}}`; the real values are filled in from the database. If Claude types a number itself, the draft is rejected and rewritten. If that fails twice, a plain template is used.
  - **Sending:** the owner reviews and edits the text, then clicks **Send**. Nothing is sent automatically. The report is emailed with a PDF attached and appears in the client portal.

### Email

| Variable | Purpose |
|---|---|
| `SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465`. Without it, emails (invites, reports) are saved as `.eml` files in `data/outbox/`, and invite links are shown on screen to copy. |
| `MAIL_FROM` | Sender, e.g. `Agency <reports@agency.com>` |
| `APP_URL` | Public address used in invite links (defaults to the address you're using) |

### Data isolation

- Every company, contact, deal, task and activity has a required `client_id`.
- The server builds the active workspace from your session; the browser can't choose a workspace you don't have.
- Every query filters on it, and every linked record is checked to belong to the same client.
- `npm test` proves that SDRs and clients can't read, change or link another client's data, through the API and directly against the data layer.

## Tests

```
npm test            # isolation, scoring, report numbers, timezone, migration (no API key needed)
npm run test:live   # real Claude calls: command bar, Research, next best action, report prose, health tips
```

**GitHub Actions** (`.github/workflows/lean-crm.yml`):
- Runs typecheck, tests and the production build on every push.
- Runs the live Claude checks when the repository secret **`ANTHROPIC_API_KEY`** is set (Settings → Secrets and variables → Actions). The key stays in GitHub and is never printed.

## Production

`npm run build && npm start` serves the app and API on one port (`PORT`, default 3001).

## Code map

```
server/
  config.ts        model + limits         db.ts        schema + versioned migrations
  scope.ts         per-request workspace  repo.ts      all reads (scoped by client_id)
  store.ts         all writes (scoped)    api.ts       REST endpoints
  auth.ts          login, sessions, roles, invites
  ai.ts            chat (SSE), research, next best action
  aiTools.ts       tool schemas, proposal dry-run, apply
  agency.ts        dashboard, clients, team, reports, portal routes
  agencyConfig.ts  score weights, health thresholds, report schedule
  metrics.ts       leaderboard, rollup, health flags, report numbers
  reports.ts       weekly drafts, placeholder guard, PDF, send, scheduler
  seed.ts / seedAgency.ts   sample data / agency demo
  tests/           isolation, scoring, migration, live
src/
  pages/      Today, Pipeline, People, Record, Settings, Agency, Portal, Login
  components/ CommandBar, ClientSwitcher, QuickLog, AiPanels, Editable, Markdown, TaskRow
```
