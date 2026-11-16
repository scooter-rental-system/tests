# User acceptance test scripts

Manual scripts for the client and project supervisor to run on the **staging or production site over HTTPS**. They
follow the SDS sequence diagrams (4.1 to 4.4) and the features delivered in the backend and frontend repositories.

**Status of every case: Not executed.** No UAT session has been run and no client sign-off has been recorded. Fill in
the Result, Tester and Date columns during the session; do not mark a case as passed unless it was run.

## Before the session

- The site is served over HTTPS (browsers refuse location sharing on plain HTTP, so UAT-07 cannot pass without it).
- Stripe is in **test mode** with a webhook endpoint pointing at `https://<site>/api/webhooks/stripe`; use Stripe's
  documented test cards only.
- One admin account and one fresh customer account per tester. Use a phone with location enabled for UAT-07.
- Record the backend and frontend commit hashes that were deployed.

| Item | Value |
| --- | --- |
| Site URL | |
| Backend commit | |
| Frontend commit | |
| Infra commit | |
| Session date | |

## Cases

| ID | Feature | Steps | Expected result | Result | Tester | Date |
| --- | --- | --- | --- | --- | --- | --- |
| UAT-01 | Registration | Register with name, email, phone, a Sri Lankan NIC and consent. | Account created, dashboard shown; a NIC in the wrong format is refused with a clear message. | | | |
| UAT-02 | Sign in / out | Sign in, reload the page, sign out. Try a wrong password six times. | Session survives reload; sign-out returns to the home page; repeated failures are rate-limited. | | | |
| UAT-03 | Password reset | Use "Forgot password" and follow the emailed link. | Email arrives (SES configured); the new password works; the link cannot be reused. | | | |
| UAT-04 | Browse and quote | Open the scooter list, choose a scooter, add gear, check the quote. | Prices match the published hourly/daily and gear rates; unavailable scooters cannot be booked. | | | |
| UAT-05 | Agreement | Create a booking and sign the rental agreement with the account name. | Payment stays locked until the agreement is signed; a different name is refused. | | | |
| UAT-06 | Card payment (Stripe test mode) | Pay the initial charge with a Stripe test card; repeat with a declining test card. | Success: booking shows "Ready for pickup" within a minute (webhook received). Decline: clear failure message, booking still payable. | | | |
| UAT-07 | Rider GPS | Admin records the handover; customer confirms the start on a phone and allows location. Ride a short distance. | "Location tracking active." shown; the admin Live GPS page shows the scooter moving; the rental's GPS history lists the route. | | | |
| UAT-08 | Speed alert | (Tracker device or test route) report speeds above 60 km/h. | Admin receives an in-app speed-violation notification; the dashboard lists it. | | | |
| UAT-09 | Return and final bill | Admin enters the return odometer. | Final bill uses time and odometer distance; the balance is charged to the saved card, or shown as due. | | | |
| UAT-10 | QR / bank transfer | Choose bank transfer, upload a receipt; admin approves it. Repeat with a rejection. | Approved: booking confirmed. Rejected: customer sees the reason and can upload again. | | | |
| UAT-11 | Cash at the counter | Pay the balance in cash; admin records it. | Booking completes; the invoice shows cash. | | | |
| UAT-12 | Cancellation and refund | Cancel a paid booking within the allowed window. | Refund is issued (Stripe) or recorded (manual), and the customer is notified. | | | |
| UAT-13 | Repairs | During a rental, report a breakdown with photos; admin resolves it. | Report with photos visible to the admin; status updates reach the customer. | | | |
| UAT-14 | Notifications | Check in-app notifications after booking, payment and return. | Each event creates one notification; "mark all read" works. | | | |
| UAT-15 | Admin fleet and gear | Add, edit, retire and restore a scooter; edit gear stock. | Changes appear immediately in the customer catalogue. | | | |
| UAT-16 | Reports | Open reports for a date range and export bookings CSV. | Totals match the bookings in the range; the CSV opens in a spreadsheet. | | | |
| UAT-17 | Accessibility and mobile | Use the booking flow on a phone (375 px) and with the keyboard only. | Every step usable; focus visible; no horizontal scrolling. | | | |

## Sign-off

| Role | Name | Decision (Accepted / Accepted with issues / Rejected) | Signature | Date |
| --- | --- | --- | --- | --- |
| Client | | | | |
| Project supervisor | | | | |

Issues found during UAT are raised in the repository they belong to (backend, frontend or infra) and listed here.

| Case | Issue link | Severity | Resolved |
| --- | --- | --- | --- |
| | | | |
