/* Install app: Chrome's own prompt where it exists, step-by-step instructions elsewhere (iPhone, Safari,
   Firefox). Every install button hides once the app runs installed. */
(function () {
  "use strict";
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const inAndroidApp = /VanguardClientAndroid\//.test(ua);
  const APK_URL = "https://github.com/aymankal/Vanguard-/releases/download/vanguard-client-android/VanguardClient.apk";
  const installed = () => inAndroidApp || window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferred = null;

  const buttons = () => document.querySelectorAll("[data-install]");
  const cards = () => document.querySelectorAll("[data-install-card]");
  function paint() {
    const show = !installed();
    buttons().forEach((b) => (b.hidden = !show));
    cards().forEach((c) => (c.hidden = !show));
  }

  const STEP = (html) => { const li = document.createElement("li"); li.innerHTML = html; return li; };
  function steps() {
    if (isIOS && !isSafari) return [
      "Open this page in <b>Safari</b>. iPhone only installs apps from Safari.",
      "Tap <b>Share</b> (the square with an arrow).",
      "Tap <b>Add to Home Screen</b>, then <b>Add</b>.",
    ];
    if (isIOS) return [
      "Tap <b>Share</b> (the square with an arrow) at the bottom of Safari.",
      "Scroll and tap <b>Add to Home Screen</b>.",
      "Tap <b>Add</b>. Vanguard appears on your home screen with the V icon.",
    ];
    if (isAndroid) return [
      "Tap <b>Download the Android app</b> below.",
      "Open <b>VanguardClient.apk</b> from the download notification.",
      "If Android asks, allow installs from your browser, then tap <b>Install</b>. Vanguard appears with the V icon.",
    ];
    if (isSafari) return [
      "In Safari's menu bar, choose <b>File → Add to Dock</b>.",
      "Click <b>Add</b>. Vanguard opens in its own window.",
    ];
    return [
      "Click the <b>install icon</b> at the right end of the address bar, or open the browser menu.",
      "Choose <b>Install Vanguard</b> (Chrome or Edge).",
      "Vanguard opens in its own window and appears with your apps.",
    ];
  }
  function openSheet() {
    const ol = document.getElementById("install-steps");
    ol.textContent = "";
    steps().forEach((s) => ol.append(STEP(s)));
    document.getElementById("install-apk").hidden = !isAndroid;
    document.getElementById("install-sheet").hidden = false;
  }
  function closeSheet() { document.getElementById("install-sheet").hidden = true; }

  async function install() {
    if (isAndroid) { openSheet(); return; }
    if (deferred) {
      const d = deferred; deferred = null;
      d.prompt();
      try { await d.userChoice; } catch (e) {}
      paint();
      return;
    }
    openSheet();
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; paint(); });
  window.addEventListener("appinstalled", () => { deferred = null; closeSheet(); paint(); });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", paint);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-install]")) install();
    else if (e.target.closest("[data-install-close]") || e.target.id === "install-sheet") closeSheet();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  paint();
})();
