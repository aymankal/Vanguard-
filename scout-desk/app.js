/* Scout Desk launcher: points the Open button at the live desk and offers Chrome's install prompt. */
(function () {
  "use strict";
  const cfg = window.SCOUT_DESK_CONFIG || {};
  const open = document.getElementById("openDesk");
  if (cfg.deskUrl) open.href = cfg.deskUrl;

  const installBtn = document.getElementById("installBtn");
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (isIOS && !standalone) {
    document.getElementById("installHint").textContent +=
      " On iPhone: tap Share, then Add to Home Screen to get the app.";
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
