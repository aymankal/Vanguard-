# Vanguard Client Hub for Android

The Android app clients install. It opens the live Client Hub (`client/`) full screen with the white V icon and keeps them signed in. Separate from the Scout Desk app: its own package (`co.vanguardservices.client`), its own build and its own download.

Because it loads the live site, every Client Hub update reaches the app straight away. Rebuild only when this shell changes.

## Download
https://github.com/aymankal/Vanguard-/releases/download/vanguard-client-android/VanguardClient.apk

## Builds
`.github/workflows/client-android.yml` builds on every change to `android-client/` and replaces the APK on the `vanguard-client-android` release. It never touches the Scout Desk release.

## Signing
Same approach as the Scout Desk: a cached debug key until you add `VANGUARD_CLIENT_KEYSTORE_BASE64`, `VANGUARD_CLIENT_KEYSTORE_PASSWORD`, `VANGUARD_CLIENT_KEY_ALIAS` and `VANGUARD_CLIENT_KEY_PASSWORD` as repository secrets (needed for the Play Store). Never commit a keystore.
