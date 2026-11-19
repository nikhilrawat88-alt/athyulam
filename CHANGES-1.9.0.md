# Athulyam Guest Manager 1.9.0 — safety update (19-11-2026)

1. 4BHK Ranipokhri blocks Deluxe Double, Deluxe King Suite and Family Suite again (the link was empty in live data). Applied once on each device; spreads to the Sheet at the next sync. Also re-applied after restoring an old backup.
2. Double bookings are refused. The "save anyway" box is gone — change dates/room or edit/cancel the other booking.
3. "Not recorded" is no longer offered as a booking source for new entries (old bookings keep it).
4. GST switched off on a bill shows a warning, and saving asks for confirmation when the room is above ₹1,000/night.
5. A booking with payments, an invoice, or a check-in/out cannot be deleted — cancel it instead. Payments of an invoiced stay cannot be deleted — record a refund.
6. Backups are encrypted with a password you choose (AES-256). Old unencrypted backups still restore.

Tested on the real 18-11-2026 backup (279 bookings): re-link, clash refusals, free-night save, delete refusal, encrypted export, wrong/right password restore, old-backup restore, GST warning. No browser errors.
