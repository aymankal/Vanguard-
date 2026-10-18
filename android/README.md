# Scout Desk for Android

The native Android app for the Scout Desk. It opens the live desk full screen with the white V icon and keeps you signed in. The Import file picker and the back button work. Links to anything outside the desk (LinkedIn, decks, websites) open in the phone's browser.

Because it loads the live site, every web update reaches the app straight away. Rebuild the APK only when the app shell changes.

## Download
https://github.com/aymankal/Vanguard-/releases/latest/download/ScoutDesk.apk

On the phone: download it, open it, allow installs from the browser if Android asks, then tap Install.

## Builds
`.github/workflows/android.yml` builds on every change to `android/` (or run it by hand from Actions → Android app). It publishes a release with `ScoutDesk.apk`.

## Signing
Without secrets, builds are signed with Android's debug key, cached between runs so updates install over each other. That's fine for sideloading to the team.

Before the Play Store, create your own upload key and add these repository secrets:
`SCOUT_DESK_KEYSTORE_BASE64` (the keystore, base64), `SCOUT_DESK_KEYSTORE_PASSWORD`, `SCOUT_DESK_KEY_ALIAS`, `SCOUT_DESK_KEY_PASSWORD`.
Switching keys means people uninstall the old build once. Never commit a keystore: the repo is public.
