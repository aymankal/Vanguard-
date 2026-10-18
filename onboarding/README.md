# Vanguard Onboarding (client app)

The app clients use to onboard. Static site, no build step, no server. Installable from Chrome with the Vanguard logo.

## Flow
1. **Intake.** A 9-step wizard built on the onboarding brochure: company and services, the five answers (Business, Goal, Messaging, Systems, People), the ICP, and a readiness checklist. Answers save on the device as the client types. Required fields are checked before each step.
2. **Next steps.** Opens automatically once the intake is sent. It shows a dated timeline (from the kickoff date the client gave), a to-do list built from the checklist items they left unticked, and what we build for each service they picked. **Ava**, the avatar guide, answers questions by text and voice (browser speech). Her answers come only from the brochure. Pricing, security and anything she can't answer get flagged for the Account Lead.
3. **Atlas.** Opens when the client taps "No more questions". An interactive map of Onboard → Run → Grow (Intake, Day 1/3/7, launch gate, Day 10, daily/weekly rhythm, Day 30/60/90). Tap a stop to see what happens, who owns it and the client's part.

## Emails you receive (ayman@vanguard-services.co)
- **New client onboarding: {Company}**: every intake answer in a table, plus the checklist items still open.
- **Onboarding questions: {Company}**: everything the client asked Ava. Items marked "(needs Account Lead)" are the ones she couldn't answer.

Delivery goes through [FormSubmit](https://formsubmit.co), so no backend is needed. **One-time setup:** after the first real submission, FormSubmit emails ayman@vanguard-services.co an *Activate* link. Click it. Submissions before activation don't arrive, and the app offers the client an "Email my answers" fallback instead. To keep the address out of the page source, paste the random alias FormSubmit gives you into `config.js`.

## Settings
Edit `config.js`: recipient, endpoint, an optional `bookingUrl` (Calendly) for a "Book a call" button, phone and email.

## Deploy
Any static host works. On Render: Blueprint → this repo → service `vanguard-onboarding` (see `render.yaml`). Chrome only offers **Install app** over HTTPS.

## Run locally
`cd onboarding && python3 -m http.server 8080`, then open http://localhost:8080
