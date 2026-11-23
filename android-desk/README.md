# Scout Desk AI for Android

The Scout Desk **Claude artifact** (https://claude.ai/artifact/QUCz4AfkMXFKdqJbQhnVxs) as an Android app with the V icon.

It opens the artifact full screen in a Chrome Custom Tab, which shares Chrome's claude.ai sign-in. That keeps everything the artifact depends on working: the shared database, who is viewing, and the Crunchbase lookups. (A plain in-app WebView can't do this: Google blocks sign-in inside WebViews.)

**Edits made in Claude publish to the same artifact link, so they show up the next time you open the app. No reinstall.** Rebuild the APK only if the shell (this folder) changes.

This is separate from the team app in `android/` (package `co.vanguardservices.scoutdesk`), which runs the Supabase copy of the desk at `/scout-desk/`. Both can be installed side by side.

## Download
https://github.com/aymankal/Vanguard-/releases/download/scout-desk-ai-android/ScoutDeskAI.apk

On the phone: open the link in Chrome, download, open the file, allow installs from Chrome if asked, tap Install. First open: sign in to claude.ai in Chrome if you aren't already.

## Builds
`.github/workflows/android-desk.yml` builds on every push that touches `android-desk/` (or run it by hand from Actions) and replaces `ScoutDeskAI.apk` in the `scout-desk-ai-android` release, so the link above always serves the newest build. Signing uses the same secrets as the team app when present, otherwise a cached debug key.
