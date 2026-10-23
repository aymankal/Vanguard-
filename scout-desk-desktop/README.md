# Scout Desk (desktop)

<img src="build/icon.png" alt="Scout Desk" width="72" />

The Vanguard Frontier Scout Desk as a desktop app for Windows, macOS and Linux, with the blue and white V icon. It opens the live desk in its own window and keeps you signed in. Links to anything outside the desk (LinkedIn, decks, websites) open in your normal browser.

Because it loads the live site, every Scout Desk update reaches the app on the next open. Rebuild the installers only when the app shell (`main.js`, the icon) changes.

## Download

| System  | Installer |
| ------- | --------- |
| Windows | [ScoutDesk-Setup.exe](https://github.com/aymankal/Vanguard-/releases/download/scout-desk-desktop/ScoutDesk-Setup.exe) |
| macOS   | [ScoutDesk-mac.dmg](https://github.com/aymankal/Vanguard-/releases/download/scout-desk-desktop/ScoutDesk-mac.dmg) (Apple Silicon and Intel) |
| Linux   | [ScoutDesk-linux.AppImage](https://github.com/aymankal/Vanguard-/releases/download/scout-desk-desktop/ScoutDesk-linux.AppImage) |
| Android | [ScoutDesk.apk](https://github.com/aymankal/Vanguard-/releases/latest/download/ScoutDesk.apk) (see [android](../android/README.md)) |

The installers aren't code-signed yet: on Windows click **More info → Run anyway**; on macOS right-click the app → **Open** the first time. The desk's own **Install** button links to the right installer for each computer.

## Builds
`.github/workflows/scout-desk-desktop.yml` builds all three on every change to `scout-desk-desktop/` (or run it by hand from Actions → Scout Desk desktop) and replaces the files in the `scout-desk-desktop` release, so the links above always point at the newest build.

## Run locally
```bash
cd scout-desk-desktop && npm install && npm start
```
`npm test` checks which links stay in the app. `npm run dist:linux` (or `dist:win`, `dist:mac`) builds an installer into `dist/`.
