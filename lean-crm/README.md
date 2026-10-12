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

## Production

`npm run build && npm start` serves the app and API on one port (`PORT`, default 3001).

## Code map

```
server/
  config.ts   model + limits        db.ts      schema, queries
  store.ts    all writes            api.ts     REST endpoints
  ai.ts       chat (SSE), research, next best action
  aiTools.ts  tool schemas, read tools, proposal dry-run, apply
  errors.ts   plain-language Claude errors
  seed.ts     sample data
src/
  pages/      Today, Pipeline, People, Record, Settings
  components/ CommandBar, AiPanels, Editable, Markdown, TaskRow
```
