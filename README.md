# Vanguard Docs

<img src="web/logo.png" alt="Vanguard" width="72" />

Document control for Vanguard Services, built as an app you install on your phone. It holds
contracts, licences, HR files and filings, with expiry tracking and a restricted **Case File**.

## What it does

- **Modules** such as Client Contracts (CON) or HR (HR). Every document gets a permanent
  reference number from its module code, for example `VG-CON-0007`. A number is never issued twice,
  even after a delete or a move.
- **Register** with search, status filter and sorting. On a phone it shows as cards.
- **Saved views:** *Expiring in 30 days* (renewals and overdue items) and *Missing file*
  (records with no file and no link).
- **Files** up to 25 MB each: PDF, photos, Word, Excel, PowerPoint, CSV and text. On a phone you
  can open, download or share a file (share sends it to WhatsApp, Mail and similar apps).
- **Case File:** restricted records behind a **second passcode** (`CASE_PASSWORD`), enforced
  on the server. While the Case File is locked, its records don't show up in search, counts,
  exports or file links. Unlocking lasts 8 hours on that device. Without `CASE_PASSWORD` the
  Case File is switched off.
- **Export and import** the register as JSON from the More menu. Exports are for backups, and
  import is how you move over from the claude.ai version.
- Light, dark and system themes. The app shell opens offline.

## Deploy on Render (5 minutes)

1. In Render, choose **New → Blueprint**, pick this repository and click **Apply**. All settings
   come from `render.yaml`.
2. The plan is Starter with a 5 GB disk (about $8.25/month), so documents and files survive
   restarts. You can raise the disk size later in the dashboard.
3. When the service is live, open **Environment** and copy `APP_PASSWORD` (the username is
   `vanguard`) and `CASE_PASSWORD` (the Case File passcode). Change both to values you choose if you prefer.
4. **Install on your phone:**
   - **iPhone:** open the URL in Safari, sign in, then tap Share → **Add to Home Screen**.
   - **Android:** open the URL in Chrome, sign in, then tap ⋮ → **Install app** (or More → Install app inside the app).

## Moving over from the claude.ai version

Files can't be exported from claude.ai, so the steps are:

1. Get a JSON export of the old register (modules, documents, Case File).
2. In the app, unlock the Case File first if the export contains Case File records.
3. Choose **More → Import register…** and pick the JSON file. Modules are matched on code and
   documents on reference number, so importing twice adds nothing. Reference numbers carry over.
4. Re-attach files to each record. **Missing file** lists every record that still needs one.

## Configuration

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | Turns on sign-in. On Render without it, a temporary password is printed in the logs (and changes on every restart). |
| `APP_USERNAME` | Sign-in username, not case-sensitive (default `vanguard`). |
| `CASE_PASSWORD` | Passcode for the Case File. Leave it unset to switch the Case File off. |
| `APP_DATA_DIR` | Where the database (`docs.db`) and uploaded files (`files/`) live. Point it at a persistent disk. |

## Run locally

```bash
pip install -r requirements.txt
APP_PASSWORD=dev CASE_PASSWORD=dev python -m uvicorn vanguard.main:app --reload
```

Open http://localhost:8000. Tests: `pip install -r requirements-dev.txt && python -m pytest tests`.

Other hosts: the `Dockerfile` works anywhere Docker runs (mount a volume at `/data`).

## Layout

```
vanguard/   FastAPI backend: main.py (API), auth.py (sign-in, Case File lock), db.py (SQLite)
web/        Frontend: index.html, styles.css, app.js, PWA manifest, service worker, icons
tests/      API tests
```

---

© Vanguard Services S.A.L 2026
