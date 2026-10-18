# Scout Desk (app)

The Vanguard Frontier deal desk as an installable app with the Vanguard V icon. Everything happens inside the app: sign in, pipeline, submissions, founder vetting, investors, review queue and the About section on the VC arm. There's no hop out to a browser.

Data lives in **Supabase**, in the same project as Vanguard Docs but in its own tables (`scout_docs`, `scout_members`) with its own roles. Every permission is enforced in the database with row-level security, so the publishable key in `config.js` can't read anything on its own. Changes show up live for everyone.

## Roles
- **Partner:** approves submissions, moves stages, keeps partner-only notes and deal terms, and manages the team (Queue → Team).
- **Scout:** submits startups, investors, vettings and activity, and sees the approved pipeline.
- **Viewer:** read-only.
- **Waiting for approval:** new sign-ups see nothing until a partner gives them a role.

The first person to join becomes a partner, so sign up yourself before sharing the link.

## Set up (once)
1. Run `supabase/migrations/20261018120000_scout_desk.sql` in the Supabase SQL editor.
2. In Supabase → Authentication → URL configuration, add the app's address (for example `https://aymankal.github.io/Vanguard-/scout-desk/`) to the redirect URLs, so confirmation and password-reset emails come back to the app.
3. Open the app, tap **Join**, and create your account. You become the first partner.
4. Share the link. Approve people from **Queue → Team**.

## Install
- **Android / desktop Chrome:** open the site and use **Install app** in the address bar or menu.
- **iPhone:** open in Safari, then Share → Add to Home Screen.

Chrome only offers install over HTTPS.

## Deploy
Published with the GitHub Pages preview at `/scout-desk/` (see `.github/workflows/preview.yml`), or on Render as the `vanguard-scout-desk` static service in `render.yaml`.

## Run locally
`cd scout-desk && python3 -m http.server 8080`, then open http://localhost:8080
