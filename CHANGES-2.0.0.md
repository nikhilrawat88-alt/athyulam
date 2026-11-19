# Athulyam Guest Manager 2.0.0 (includes everything in 1.9.1)

## What changed

**New look**
- Proper line icons everywhere (bottom bar, menus, buttons). They are part of the app, so they work offline.
- Fonts are now part of the app (Playfair Display for headings, Inter for text and numbers), so every phone and laptop looks the same.
- Laptop and desktop: a left sidebar with the logo, all sections, New booking, Housekeeping and Cash close. Wider pages, 4 money tiles in a row, a full-width calendar.
- Header: logo (or "A" monogram) and a sync dot. Green = synced, red = last sync failed (tap to retry), gold = syncing, grey = offline or not set up.
- Dark mode follows the phone's setting. Invoices and PDFs stay white.
- Smoother screen changes, loading placeholders, status chips with a dot, a short buzz after important saves (Android).

**Home screen**
- Opens with today: Arrivals, Departures, In-house (swipe on the phone).
- Money: revenue this month vs last month, collected today, owed to you, profit.
- Housekeeping and cash close cards.
- Pipeline tiles hide when they have nothing to show. Only the 2 most urgent alerts show; "Show more alerts" opens the rest.

**Room calendar**
- Each stay is one bar with the guest's name. Weekends shaded, past nights hatched, a gold line marks today, plus a Today button.
- Tap an empty night, then tap the last night → Book (dates and room filled in). With a mouse, drag across the nights.
- 4BHK row: two of its rooms booked by different guests is no longer shown as a clash. A clash still shows when the 4BHK itself is booked over a room booking.

**Housekeeping board (Rooms → Housekeeping)**
- Every room is Dirty, Cleaning or Ready, with who is in it, who arrives and who leaves today.
- Rooms with a guest arriving and not Ready go to the top in red; Home shows a red alert.
- Check-out marks the rooms Dirty by itself (all 3 rooms when the 4BHK checks out).
- The 4BHK is not on the board (it is its 3 rooms).

**Daily cash close (Reports, Home or sidebar)**
- Shows what the app recorded for the day: cash, UPI, card, bank, cash expenses.
- Enter cash counted (and cash taken out or deposited): the app shows Matches / Short ₹x / Extra ₹x.
- Optional: UPI total from your UPI app and bank credits, compared the same way.
- Opening cash = cash counted at the previous close. Last 14 closes listed.

**Booking form**
- Jump bar at the top (Guest · Stay · Food · Bill · Payment · Notes).
- A bar at the bottom always shows nights, total, paid and due, with a Save button.

**Returning and premium guests**
- New booking: type the mobile number and, if the guest has stayed before, a card shows the number of stays, total billed, paid, pending, the latest booking and the last payment.
- "Fill guest details" fills name, email, nationality, gender, address and ID from the most recent stays. The ID stays masked.
- Booking cards and the booking page show **Returning** or **Premium**. The booking page also shows the guest's history.
- Premium = 3 or more stays, or ₹25,000 billed in total. These two numbers are a starting proposal: change them in More → Settings → Guest IDs & documents.
- Guests are matched by mobile number (last 10 digits). The same guest with a different number counts as new.

**Guest ID privacy**
- ID, passport and visa numbers now show only as the last 4 (e.g. •••• 9012) on the booking form, guest screen, guest list and Form C screen.
- "Show" reveals the full number for 1 minute. With an app PIN set, it asks for the PIN first.
- Leaving the box empty keeps the saved number. Typing replaces it.
- CSV exports from Backup show the last 4 only. The encrypted backup and the Sheet still keep the full number (needed for Form C and the guest register).

**ID photos under 50 KB**
- New ID, passport and visa photos are shrunk to under 50 KB before they are saved. Real ID photos came out at about 30–40 KB at 1400 px, so the text stays readable.
- Food-bill photos are kept sharper (up to about 450 KB), because the app reads their text.
- PDFs and photos already saved are not changed.

## Files to upload to GitHub
- index.html, app.js, sw.js, manifest.json
- the new **fonts** folder (3 files)
- logic.js, xlsx.js and Code.gs: **no change**

## Known limits
- Housekeeping status and cash closes are saved in Settings. If both phones change Settings before syncing, the newer one wins, as before.
- Not tested against your live Google Sheet (needs your Apps Script link). The Sheet should keep the new Settings fields, as it does for room links today. Check once after the first sync on the second device.
- The property switch (Ranipokhri / Mini Villa) is not in this version. It needs every report and screen to filter by property.

## Tested (headless Chrome, phone and laptop sizes, light and dark)
- No page errors on Home, Rooms, Housekeeping, Cash close, New booking, More, Reports, Bookings.
- ID masking: full number not in the page, Show works, wrong PIN refused, right PIN reveals, saving with an empty box keeps the number, typing replaces it (booking form and guest screen).
- Photos: a 4000×3000 ID-style photo saved at 32 KB (1400×1050). A worst-case noise photo saved at 40 KB.
- Housekeeping: Cleaning / Ready save correctly. Check-out marks the room Dirty.
- Cash close: expected cash, Matches / Short, saved record, next day's opening = last count.
- Returning guests: card, totals, fill from earlier stays (ID kept masked), Premium tag, Settings fields.
- Form C screen masks passport and visa numbers.
- Calendar: tap-tap (touch and mouse) and drag pick the right nights. Book opens the form with those dates. No false 4BHK clashes.
