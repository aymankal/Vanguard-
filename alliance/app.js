/* Frontier Alliance: renders events from config.js, points every CTA at Luma, then loads
   Luma's checkout script so "Register" opens the Luma modal. Every CTA is a real link to the
   Luma event or calendar page, so the page still works if Luma's script is blocked. */
(function () {
  "use strict";
  var cfg = window.ALLIANCE || { calendarUrl: "", events: [] };
  var LUMA_HOST = /^https:\/\/(([a-z0-9-]+\.)*lu\.ma|([a-z0-9-]+\.)*luma\.com)\//i;
  var LUMA_SCRIPT = "https://embed.lu.ma/checkout-button.js";

  function isLuma(u) { return typeof u === "string" && LUMA_HOST.test(u); }
  function warn(msg) { if (window.console) console.warn("[Frontier Alliance] " + msg); }

  var calendarUrl = isLuma(cfg.calendarUrl) ? cfg.calendarUrl : "";
  if (!calendarUrl) warn("calendarUrl in config.js is missing or not a Luma URL.");

  var now = Date.now();
  var events = (cfg.events || []).filter(function (e) {
    var ok = e && /^evt-[A-Za-z0-9]+/.test(e.id || "") && isLuma(e.url) && !isNaN(Date.parse(e.date));
    if (!ok) warn("Skipping event with a bad id, url or date: " + JSON.stringify(e));
    return ok;
  }).filter(function (e) {
    // Keep an event listed until 6 hours after it starts.
    return Date.parse(e.date) + 6 * 3600 * 1000 > now;
  }).sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });

  function fmt(e, opts) {
    try { return new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: e.tz || undefined }, opts)).format(new Date(e.date)); }
    catch (_) { return new Intl.DateTimeFormat("en-GB", opts).format(new Date(e.date)); }
  }

  // Turns an <a> into a Luma checkout button. href stays as the fallback.
  function makeRegister(a, e) {
    a.href = e.url;
    a.className += " luma-checkout--button";
    a.setAttribute("data-luma-action", "checkout");
    a.setAttribute("data-luma-event-id", e.id);
    a.setAttribute("data-luma-utm-source", "frontier-alliance-site");
  }

  // Calendar links.
  document.querySelectorAll("[data-cta='calendar']").forEach(function (a) {
    if (calendarUrl) a.href = calendarUrl; else a.hidden = true;
  });

  // Hero: next event, or the calendar when nothing is scheduled.
  var next = events[0];
  var heroBtn = document.getElementById("hero-register");
  var heroNext = document.getElementById("hero-next");
  if (next) {
    makeRegister(heroBtn, next);
    heroBtn.textContent = "Register for the next event";
    heroNext.textContent = "Next: " + next.title + " · " + fmt(next, { weekday: "short", day: "numeric", month: "short" }) + " · " + next.city;
    heroNext.hidden = false;
  } else if (calendarUrl) {
    heroBtn.href = calendarUrl;
    heroBtn.textContent = "See upcoming events";
  } else {
    heroBtn.hidden = true;
  }

  // Event cards.
  var list = document.getElementById("event-list");
  var empty = document.getElementById("event-empty");
  list.textContent = "";
  events.forEach(function (e) {
    var li = document.createElement("li");
    li.className = "event";
    var when = document.createElement("div");
    when.className = "event-date";
    when.innerHTML = "<span class='m'></span><span class='d'></span>";
    when.querySelector(".m").textContent = fmt(e, { month: "short" });
    when.querySelector(".d").textContent = fmt(e, { day: "numeric" });
    var body = document.createElement("div");
    body.className = "event-body";
    var h = document.createElement("h3");
    h.textContent = e.title;
    var meta = document.createElement("p");
    meta.className = "event-meta";
    meta.textContent = fmt(e, { weekday: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) + " · " + e.city + (e.venue ? " · " + e.venue : "");
    body.appendChild(h);
    body.appendChild(meta);
    var a = document.createElement("a");
    a.className = "btn primary";
    a.textContent = "Register";
    makeRegister(a, e);
    li.appendChild(when);
    li.appendChild(body);
    li.appendChild(a);
    list.appendChild(li);
  });
  empty.hidden = events.length > 0;

  // Buttons exist now; load Luma's script once. If it fails, the hrefs above still work.
  if (events.length) {
    var s = document.createElement("script");
    s.id = "luma-checkout";
    s.src = LUMA_SCRIPT;
    s.async = true;
    s.onload = function () { if (window.luma && window.luma.initCheckout) window.luma.initCheckout(); };
    s.onerror = function () { warn("Luma checkout script did not load; Register buttons open the Luma event page instead."); };
    document.body.appendChild(s);
  }

  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
