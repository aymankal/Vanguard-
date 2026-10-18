# Vanguard Client Hub

The app Vanguard clients use, with the white V icon. Everything is per client company, and a client never sees another company.

| Tab | Clients | Vanguard team |
|---|---|---|
| **Home** | This week's numbers (with change vs last week), pipeline snapshot, latest updates, pilot status, last chat message | Same, for the client picked in the header |
| **Reports** | Weekly reports: meetings, opportunities, conversations, calls, emails, pipeline added, summary, highlights, next week | Publish or edit the week's report |
| **Pipeline** | Every opportunity by stage, with a live scroll counter | Add and move opportunities |
| **Updates** | News, milestones and action-needed notices (badge for new ones) | Post to one client or all clients |
| **Pilot** | Start a pilot (service, goal, audience, team size, start) and follow it: Requested → Scoping → Live → Results → Closed | Move the stage and leave a note |
| **Chat** | One thread with the Vanguard team, live | Answer each client's thread |
| **Team** | (hidden) | Add clients, connect new sign-ups to their company, set roles |

## Roles
- **Staff:** the Vanguard team. The first person to join becomes staff.
- **Client:** linked to one company.
- **Pending:** new sign-ups. They see a "your account manager will connect you" screen until staff link them in **Team**.

All of this is enforced in the database with row-level security (`supabase/migrations/20261018210000_client_app.sql`), not just in the app.

## Set up (once)
1. Run `supabase/migrations/20261018210000_client_app.sql` in the Supabase SQL editor.
2. Add `https://aymankal.github.io/Vanguard-/client/` to Supabase → Authentication → URL Configuration → Redirect URLs.
3. Open the app and **Join** first, so you become staff. Add your clients under Team.
4. Send clients the link (or the Android app). When they join, link them to their company in Team.

## Apps
- Web: https://aymankal.github.io/Vanguard-/client/ (installable on any phone)
- Android: https://github.com/aymankal/Vanguard-/releases/latest/download/VanguardClient.apk

## Run locally
`cd client && python3 -m http.server 8080`, then open http://localhost:8080
