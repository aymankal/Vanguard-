/* Frontier Alliance: the only file you edit to change events.
   Registration happens on Luma. This page never collects data.

   calendarUrl  Public URL of the Luma calendar (Calendar → Share → copy link). Leave "" to hide
                the "Subscribe to the calendar" buttons.
   events       One entry per event. Past events hide themselves; the earliest upcoming one
                drives the hero "Register" button.
     url    Required. Public Luma event page (Manage event → Share → copy link).
     id     Luma event ID, starts with "evt-" (Manage event → More → Embed Registration Button).
            With it, Register opens Luma's registration window on this page. Without it,
            Register opens the Luma event page.
     title  Shown on the card.
     date   Start time with its UTC offset, e.g. "2026-11-20T18:30:00+02:00". Leave "" until
            confirmed; the card then says the details are on Luma.
     tz     IANA time zone the date is shown in, e.g. "Asia/Beirut", "Europe/London".
     city   City, or "Online". Optional.
     venue  Optional. Short venue line.
*/
window.ALLIANCE = {
  calendarUrl: "",
  events: [
    {
      url: "https://luma.com/ie1bq0rh",
      id: "",
      title: "Next Frontier Alliance event",
      date: "",
      tz: "Asia/Beirut",
      city: "",
      venue: ""
    }
  ]
};
