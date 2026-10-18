# Scout Desk (app)

Installable app for **Vanguard Frontier**, the venture arm of Vanguard Services. It carries the Vanguard V as its icon and an About section on the fund.

The desk itself (pipeline, submissions, founder vetting, investors, review queue) runs as a Claude artifact, which holds the shared data and the partner / scout / viewer roles. This app is the home-screen front door to it: tap **Open Scout Desk** and sign in with your Claude account. The desk link lives in `config.js`.

## Install
- **Android / desktop Chrome:** open the site, tap **Install app** (or the install icon in the address bar).
- **iPhone:** open in Safari, Share → Add to Home Screen.

Chrome only offers install over HTTPS.

## Deploy
Published with the GitHub Pages preview at `/scout-desk/` (see `.github/workflows/preview.yml`), or on Render as the `vanguard-scout-desk` static service in `render.yaml`.

## Run locally
`cd scout-desk && python3 -m http.server 8080`, then open http://localhost:8080
