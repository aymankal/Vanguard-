# Frontier Alliance landing page

Static landing page for **Frontier Alliance**, the event series of Vanguard Frontier Fund I.
All registration happens on **Luma**. This site has no backend, no forms, no database and no
Luma API calls.

| File | What it is |
|---|---|
| `config.js` | **The only file you edit for events.** Calendar URL and the event list. |
| `index.html` | Page copy, SEO and Open Graph tags. |
| `app.js` | Renders events from `config.js`, wires the Register buttons, loads Luma's script. |
| `styles.css` | Styles (Scout Desk tokens, light and dark). |
| `og.png` | 1200×630 social preview image. |

## Before first deploy: fill in three values

`config.js` ships with placeholders (`REPLACE-…`). Until you replace them, the buttons point at
Luma URLs that don't exist.

1. `calendarUrl`: the Frontier Alliance calendar on Luma (calendar page → **Share** → copy link).
2. For each event, `id` (`evt-…`) and `url` (see below).
3. If the site will not live at `https://vanguard-alliance.onrender.com`, replace that URL in
   `index.html` (canonical, `og:url`, `og:image`, `twitter:image`, JSON-LD), `robots.txt` and
   `sitemap.xml`.

## Add or replace an event

Edit `config.js` only. Each event is one block:

```js
{
  id: "evt-AbC123xYz",                        // Luma event ID
  url: "https://luma.com/abc123",             // public Luma event page (fallback link)
  title: "Frontier Alliance: Fintech Night",
  date: "2026-12-04T19:00:00+02:00",          // start time WITH its UTC offset
  tz: "Asia/Beirut",                          // time zone shown on the card
  city: "Beirut",
  venue: "Optional venue line"
}
```

Where to find the values in Luma:

- **`id`**: open the event → **Manage** → **More** tab → **Embed Registration Button**. The
  snippet contains `data-luma-event-id="evt-…"`. Copy that value.
- **`url`**: the event's public page link (**Share** → copy link).

Rules the page applies on its own:

- Events are sorted by date. The earliest upcoming one becomes the hero **Register** button.
- An event stays listed until 6 hours after its start, then hides. You don't need to delete old
  entries, but you can.
- An entry with a non-`evt-` id, a non-Luma URL or a bad date is skipped and logged in the
  browser console.
- With no upcoming events, the hero button changes to "See upcoming events" (the calendar) and the
  events section shows a "Subscribe to the calendar" prompt.

Commit and push to the branch Render deploys from. The change is live within about a minute.
`config.js` is served with `Cache-Control: no-cache`, so visitors get the new list straight away.

## How the Register buttons work

Each Register button is Luma's official checkout button, as documented in Luma's help center
("Embed Luma on Your Website") and in [luma-team/examples](https://github.com/luma-team/examples):

```html
<a href="https://luma.com/your-event" class="luma-checkout--button"
   data-luma-action="checkout" data-luma-event-id="evt-…">Register</a>
<script id="luma-checkout" src="https://embed.lu.ma/checkout-button.js"></script>
```

`app.js` builds the buttons from `config.js`, loads the script once, then calls
`window.luma.initCheckout()` (Luma's documented hook for buttons added by JavaScript). Clicking
opens Luma's registration modal on this page. If the script is blocked or fails to load, the
button is still a normal link and opens the Luma event page instead. Registrations are tagged
`utm_source=frontier-alliance-site` in Luma's event insights.

## Deploy on Render

The service is declared in the root `render.yaml` as **`vanguard-alliance`** (static site,
publish path `./alliance`, no build command).

1. Render dashboard → **Blueprints** → open the existing blueprint for this repo (or **New →
   Blueprint** → pick `aymankal/Vanguard-`) → **Sync** / **Apply**. Render creates
   `vanguard-alliance`.
2. Set the service's branch to the one you deploy from (Settings → Build & Deploy → Branch).
3. Open `https://vanguard-alliance.onrender.com` (or the URL Render assigns). If it differs, do
   step 3 of "Before first deploy".
4. Optional custom domain: Settings → Custom Domains → add, e.g. `alliance.yourdomain.com`, then
   create the CNAME it shows. Update the URLs in step 3 of "Before first deploy".
5. Smoke test on your phone: click every Register button and confirm the Luma modal opens.

The CSP in `render.yaml` allows scripts, frames and requests only from this site and Luma
(`lu.ma`, `luma.com`). If the modal doesn't open, check the browser console for a CSP error and
add the blocked Luma host to `render.yaml`.

## Notifications checklist (manual, in Luma)

The site sends no email. Luma does. Do this for **every** Frontier Alliance event:

- [ ] **a) Host/admin.** `khalilayman2406@gmail.com` is an admin of the Frontier Alliance
      calendar (Calendar → Settings → Admins) **and** a host on the event (Manage event →
      Overview → Hosts). Events created inside the calendar inherit calendar admins; check
      anyway for events created elsewhere and added later.
- [ ] **b) Registration emails ON.** Signed in to Luma as `khalilayman2406@gmail.com`: Settings →
      Notifications (or **Manage event → Hosts → your row → email notifications**) → turn on
      the email for new registrations / guest registered.
- [ ] **c) Approval emails (if the event requires approval).** If Manage event → Registration
      has **Require approval** on, also turn on the notification for guests pending approval,
      so requests don't sit unseen.
- [ ] **d) Test registration.** From the live site, click Register on the event, register with a
      second email address, and confirm the notification arrives at
      `khalilayman2406@gmail.com` (check Promotions/Spam). Then remove the test guest from the
      Luma guest list.

Luma moves these settings around. If a menu name above doesn't match, search Luma's help center
for "notifications" and turn on every new-registration and approval email for that host.

## Done when

- [ ] Page is live on Render with real values in `config.js`.
- [ ] Every Register button opens the Luma modal (falls back to the Luma page).
- [ ] A test registration emails `khalilayman2406@gmail.com`.
