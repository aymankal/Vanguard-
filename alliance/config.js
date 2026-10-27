/* Frontier Alliance: the only file you edit to change events.
   Registration happens on Luma. This page never collects data.

   calendarUrl  Public URL of the Luma calendar (Calendar → Share → copy link).
   events       One entry per event. Past events hide themselves; the earliest upcoming one
                drives the hero "Register" button.
     id     Luma event ID, starts with "evt-" (Manage event → More → Embed Registration Button).
     url    Public Luma event page (Manage event → Share → copy link). Used as the fallback link
            if Luma's script fails to load, so it must be the real event page.
     title  Shown on the card.
     date   Start time with its UTC offset, e.g. "2026-11-20T18:30:00+02:00".
     tz     IANA time zone the date is shown in, e.g. "Asia/Beirut", "Europe/London".
     city   City, or "Online".
     venue  Optional. Short venue line.
*/
window.ALLIANCE = {
  calendarUrl: "https://luma.com/REPLACE-WITH-CALENDAR-SLUG",
  events: [
    {
      id: "evt-REPLACE-ME",
      url: "https://luma.com/REPLACE-WITH-EVENT-SLUG",
      title: "Frontier Alliance: Founders × Investors Evening",
      date: "2026-11-20T18:30:00+02:00",
      tz: "Asia/Beirut",
      city: "Beirut",
      venue: ""
    }
  ]
};
