/* Settings for the client onboarding app. Edit and redeploy; nothing else needs to change. */
window.VG_CONFIG = {
  // Where finished intakes (and the questions clients ask the guide) are sent.
  recipient: "ayman@vanguard-services.co",

  // FormSubmit relays each submission to the recipient as an email. No server or account needed.
  // The very first submission makes FormSubmit email the recipient an "Activate form" link: click it once.
  // After activating, FormSubmit also gives you a random alias (e.g. https://formsubmit.co/ajax/3f9a...);
  // paste it here to keep the address out of the page source.
  endpoint: "https://formsubmit.co/ajax/ayman@vanguard-services.co",

  // Optional: a Calendly (or similar) link. When set, "Book a call" buttons open it.
  bookingUrl: "",

  phone: "+961 78 737 682",
  infoEmail: "info@vanguard-services.co",
  website: "https://vanguard-services.co",
};
