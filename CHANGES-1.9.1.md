# Athulyam Guest Manager 1.9.1 (includes everything in 1.9.0)

## What changed

**Emails**
- Reminder emails go to the Email in the app (More → Settings → Email). If that is empty, they go to Setup!B4 in the Sheet, then to the Sheet owner.
- No more empty emails. The arrivals email is skipped when there are no arrivals, departures, Form C or next-day arrivals. The payments email is skipped when everything is paid.
- Unticking "Email reminders on" stops all reminder emails. (The Sheet script already obeyed this switch.)
- Emails are still sent from the Google account that owns the Sheet. Only the recipient changes.

**Invoice numbers (bug fix)**
- Cause of the duplicate numbers: after the Sheet gave a stay its invoice number, a phone that had not synced yet could send back its own copy of the booking, which had no number. That copy won the merge, and the Sheet gave the stay a new number.
- Fix: once a booking has an invoice number, it keeps it, on both the Sheet and the phone.
- Numbers already used up: INV-000002–003 (ATH-000264, now INV-000004), INV-000009–012 (ATH-000267, now INV-000013) and INV-000023 (ATH-000277, now INV-000024). Tell your CA these numbers were never issued or were cancelled. Old PDFs are not changed.

**Airbnb, Booking.com and MakeMyTrip calendars (iCal)**
- New screen: More → Airbnb, Booking.com & MMT calendars.
- For every room and every platform there are two links:
  1. **The app's link.** Paste it into that platform's listing. Nights booked in the app or on the other platforms then show as unavailable there.
  2. **The platform's link.** Paste it into the app. The Sheet reads it every hour and at every sync.
- 4BHK: its link shows nights booked in any of its 3 rooms. Each room's link shows nights the 4BHK is booked. This holds for bookings in the app and on the platforms.
- Room calendar: nights blocked on a platform show in purple with A, B or M. A clash between those nights and a booking in the app shows in red.
- Home screen warns about a possible double booking, or a platform link the Sheet could not read.
- Booking form: warns when the dates are blocked on a platform, and asks before saving. A booking whose source, room and dates match a platform block (the same booking, entered in the app) is not flagged.
- The links share dates only: no names, phones or amounts.
- Airbnb's "Not available" entries are ignored. Those are Airbnb's own rules (booking window, preparation time). Block dates in the app instead.
- If a platform link fails, the dates it showed last time are kept, and the screen shows the error.

## Limits (not instant)
- Airbnb reads calendars about every 3 hours. Booking.com reads every 30 to 60 minutes. The Sheet reads every hour.
- A booking made on two sites within that gap can still clash. Real-time blocking needs a paid channel manager.
- MakeMyTrip: not verified that every account offers iCal import/export. If your MMT extranet has no "sync calendar / iCal" option, MMT cannot be covered this way.

## Files
- App (GitHub): index.html, app.js, logic.js, sw.js
- Google Sheet: Code.gs (replaces the old one; Logic file in Apps Script does not need changing)

## Tested
- Sheet script in a simulated Google environment, on a scratch copy of the 18 Nov backup: 32 checks. Covered feeds per room and platform, the 4BHK links, the Mini Villa staying separate, and no guest data in the links. Also covered reading platform calendars (folded lines, times, cancelled events, failing links, login pages), invoice numbers kept, email recipient, no empty emails, and the off switch. The same checks also passed with the older Logic file.
- App in headless Chrome, with Google mocked: 17 checks. Covered the link screen, saving links and sending them to the Sheet, the Home warnings, the calendar colours, the booking form warning and confirmation, and no page errors.
- Not tested: real Airbnb, Booking.com or MMT servers reading the Apps Script link. This can only be tried live (see step 4 of the guide).
