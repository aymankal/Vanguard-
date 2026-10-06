# Vanguard Docs (v0.9.0 beta)

<img src="web/logo.png" alt="Vanguard" width="72" />

Document control for Vanguard Services, built as an app you install on your phone. It holds
contracts, licences, HR files and filings, with expiry tracking and a restricted **Case File**.

There is no server to run. The app is a static site, and **Supabase** provides sign-in, the database
and file storage. Every permission is enforced inside the database with row-level security, so
the public key in `web/config.js` can't read anything on its own.

## What it does

- **Modules** such as Client Contracts (CON) or HR (HR). Each document gets a permanent
  reference number from its module code, for example `VG-CON-0007`. The database issues the
  numbers and never reuses one, even after a delete or a move.
- **Register** with search, a status filter and sorting. On a phone it shows as cards. The
  *Expiring in 30 days* and *Missing file* views list what needs attention.
- **Files** up to 25 MB each: PDF, photos, Word, Excel, PowerPoint, CSV and text. They're kept in
  a private bucket and opened through links that expire after 5 minutes. You can open, download
  or share a file (share sends it to WhatsApp, Mail and similar apps).
- **Team** with one account per person:
  - **Owner:** everything, plus the Team screen and the Case File.
  - **Editor:** adds and changes records.
  - **Viewer:** read-only.
  - **Pending:** new sign-ups see nothing until an owner approves them.
- **Case File:** owners only, and only after entering a separate Case File passcode. The
  passcode is stored hashed. 8 wrong tries locks it for 15 minutes, and unlocking lasts 8 hours.
  While it's locked, Case File records and files can't be read in any way.
- **Export and import** the register as JSON from the More menu. Import also accepts the
  claude.ai version's data.

- **Copilot:** a tool-using AI agent (GitHub Models or any OpenAI-compatible model; Azure optional) built into the app. It
  searches the register, reports what's expiring, sets up a new company (a module plus starter
  documents), files and updates documents, reviews the whole register (overdue, expiring, missing files) and runs bulk clean-ups such as archiving expired records. Reads run straight away; every change waits for your
  approval. It runs as you, so database permissions still decide what it may do, and it never
  touches the Case File or deletes anything.
- **Secure sign-in:** every account needs a second step (an authenticator app such as Microsoft
  Authenticator) before the register loads. Passwords are 12+ characters, idle sessions sign out
  after 30 minutes, and the Copilot functions refuse sessions without the second step. An optional
  migration (`20261006100000_require_two_step.sql`) makes the database enforce it on every table.
- **Auto-fill from file** (your AI model; Azure Document Intelligence optional for PDFs and images): open a record with a file,
  tap Auto-fill, and it proposes the counterparty, expiry, status, tags and a short summary in the
  edit form. Nothing saves until you do.
- **Themes:** ten, picked under **More → Appearance** (Auto, Daylight, Night, Midnight, Emerald,
  Violet, Sunset, Rose, Sand, Contrast). Remembered per device.
- **Profile pictures:** set a display name and picture under **More → Profile and picture**.
  Pictures are cropped square and shrunk on your device, kept in a private bucket, and shown in
  the top bar and the Team list.

## Set up

### 1. Database (once)

The database lives in the Supabase project `vanguard-docs` (Frankfurt).

1. Open the project's SQL editor and run
   `supabase/migrations/20261005180000_document_control.sql`. You can also use
   `supabase db push` with the Supabase CLI.
2. In **Authentication → URL Configuration**, set **Site URL** to the app's address, for example
   `https://vanguard-docs.onrender.com`. Confirmation and password-reset emails link there.

### 1b. Profiles and Copilot (once)

The Copilot works with no AI key at all: a built-in assistant understands plain commands (overview, what expires in 60 days, archive expired, add company X, find X, list modules) and uses the same approval cards. Add a model below only if you want free-form chat.

1. Run `supabase/migrations/20261006090000_profiles_avatars.sql` the same way as step 1. Until you
   do, the app works but profile pictures are off.
2. Deploy the Copilot function and give it a model. No Azure needed: GitHub Models runs on your
   GitHub account. Create a personal access token (github.com/settings/personal-access-tokens)
   with the **Models: read** permission, then:

```bash
supabase secrets set \
  AI_BASE_URL=https://models.github.ai/inference \
  AI_API_KEY=<github token> \
  AI_MODEL=openai/gpt-4.1
supabase functions deploy copilot
supabase functions deploy extract
```

   Any OpenAI-compatible endpoint works the same way (OpenAI, OpenRouter, ...): change the three
   values. The model must support function calling. Azure OpenAI is still supported as an
   alternative (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`).

   Auto-fill reads plain text files with the same model. For PDFs, Word files and images, add an
   optional Azure AI Document Intelligence resource (`AZURE_DOC_INTELLIGENCE_ENDPOINT`,
   `AZURE_DOC_INTELLIGENCE_KEY`). To screen the Copilot for jailbreaks, add the optional Azure AI
   Content Safety pair `AZURE_CONTENT_SAFETY_ENDPOINT` and `AZURE_CONTENT_SAFETY_KEY`. Unset, both
   are simply off. Keys stay in Supabase and never reach the browser.

### 2. Hosting (free)

In Render, choose **New → Blueprint**, pick this repository and click **Apply**. `render.yaml`
publishes `web/` as a free static site with the security headers already set.

Any static host works: Netlify, Vercel, Cloudflare Pages or GitHub Pages. Publish the `web/`
folder, then update the Supabase address in the `Content-Security-Policy` header if you change projects.

### 3. Your account

1. Open the app and choose **Create an account**. Confirm your email, then sign in. **The first
   account becomes the owner**, so do this before you share the link.
2. Open the **Case File** and set its passcode.
3. Teammates create their own accounts, then appear under **More → Team** as *pending*. Give
   each one a role.
4. Once your team is in, you can turn off **Allow new users to sign up** under Authentication →
   Providers. Strangers who sign up see nothing anyway, but this stops the sign-ups entirely.

### 4. Install on your phone

- **iPhone:** open the app in Safari, then tap Share → **Add to Home Screen**.
- **Android:** open it in Chrome, then tap ⋮ → **Install app** (or More → Install app inside the app).

## Moving over from the claude.ai version

1. Get a JSON export of the old register.
2. Unlock the Case File first if the export contains Case File records.
3. Choose **More → Import register…** and pick the file. Reference numbers carry over, and
   importing twice adds nothing.
4. Re-attach files. The **Missing file** view lists every record that still needs one.

## Costs

The Supabase free plan includes 1 GB of files and 500 MB of database. A free project pauses after
a week with no activity. For real use, Supabase Pro ($25/month) gives 100 GB of files, daily
backups and no pausing. Static hosting on Render is free.

## Run locally

```bash
cd web && python3 -m http.server 8000
```

Open http://localhost:8000. It runs against the Supabase project in `web/config.js`. Add
`http://localhost:8000` to the redirect URLs in Supabase if you test email links locally.

## Layout

```
supabase/migrations/   Database schema, row-level security, Case File functions, storage buckets, profiles
supabase/functions/    copilot: the AI agent (Deno edge function)
web/                   The app: index.html, styles.css, app.js, config.js, PWA files, icons
web/vendor/            supabase-js 2.117.2 (bundled so the app shell opens offline)
render.yaml            Free static hosting with security headers
```

---

© Vanguard Services S.A.L 2026
