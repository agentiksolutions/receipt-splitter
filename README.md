# Halfsies

Split a receipt with friends. Free.

Photograph the receipt, tap who had what, and everyone gets their own number
with tax and tip worked in. Send one link and each person opens it on their own
phone, sees what they owe, and gets a button that opens Venmo, Cash App, PayPal,
Zelle or Apple Cash with the amount already in it. Nobody signs up, nobody
downloads anything, and nobody does arithmetic.

Vite 5, React 18, Supabase, plain CSS. No server code beyond one Supabase Edge
Function that reads the photo.

## Running it

```bash
npm install
npm run dev
```

`.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. See `.env.example`.

`supabase/schema.sql` is the whole schema and mirrors what is live. Run it only
against a fresh project. It also needs a storage bucket named `receipt-photos`
and the `read-receipt` Edge Function deployed with an `ANTHROPIC_API_KEY` in its
secrets.

## The shape of the thing

One scrolling page, five sections, each one live the moment it appears. Nothing
navigates; the only movement is a scroll.

1. **What are you splitting.** Name, date, a category, and an optional trip. The
   database row is written on the first keystroke of the name, so the URL
   becomes shareable immediately and Back still goes home.
2. **Who's in.** You are added automatically with your saved payment handles.
   Add the others by name. Tap a name to change it, tap the x to remove them.
3. **How are you splitting.** Halfsies for two people, evenly for a crowd, or by
   what each person had. The choice lives on the receipt row, so everyone
   holding the link sees the same answer.
4. **The receipt.** Photograph it, type the lines, or enter one total. Tax and
   tip take a dollar amount or a percentage, and the tip has 18, 20 and 22
   percent chips.
5. **Settle up.** Who paid, what everyone owes, and one button per person that
   opens the way they are most likely to pay.

A sticky bar at the bottom always holds exactly one primary action, so on a
390x844 phone the next thing to do is never below the fold. Before the split is
finished the bar names what is missing and scrolls to it.

## Reading the photo

`supabase/functions/read-receipt` sends the image to Claude and gets back the
merchant, date, time, line items, subtotal, tax, tip and total. Photos are
downscaled to 1600px in the browser first, because a phone photo runs 4 to 12 MB
and the function caps its payload at 6 MB.

The merchant, date and time go onto the receipt, and the merchant becomes the
title if the split has not been named yet. A quantity line arrives as the line
total, so "3 at 12.41" becomes three separate rows whose cents still sum to
12.41.

Under the draft is a reconciliation line comparing what was read against what
the receipt printed:

> Items read $58.10. Receipt says $61.74. $3.64 not accounted for.

It turns green and reads "Matches the receipt" when the two agree to the cent.
That gap is almost always one line the reader skipped, and it is the difference
between catching it now and finding it after everyone has paid.

## The arithmetic

All money is integer cents, in `src/lib/money.js`. Floats appear at two edges
only: parsing a typed price and formatting for display.

The invariant everything rests on:

```
sum(perPerson[i].totalCents) === grandCents
grandCents === assignedCents + allocatedTaxCents + allocatedTipCents
```

Tax and tip are split in proportion to what each person ordered, so somebody who
ordered nothing pays nothing toward either. Leftover cents go to the largest
share first, breaking ties by the order people were added, so the result is
stable across renders.

Lines nobody has claimed are held out of every person's total and flagged. With
lines on the receipt and nobody assigned to any of them, the total shown is the
bill, not zero, with one line reading "Nobody is charged yet". A zero sitting
above a real tax line reads as a free meal, so no screen prints one.

## Paying

Each person's handles for Venmo, Cash App, PayPal, Zelle, phone and email save
to the database as you leave each field. Your own handles live in Your profile
and go onto every split you start.

| Service | Asking someone to pay you | Paying someone else |
|---|---|---|
| Venmo | text with a `venmo.com/u/<you>` link | opens their profile, app first |
| Cash App | text with a `cash.app/$<you>` link | link carrying the amount |
| PayPal | text with a `paypal.me/<you>` link | link carrying the amount |
| Zelle | text with the amount written in | text with the amount written in |
| Apple Cash | text with the amount written in | text with the amount written in |

Zelle and Apple Cash cannot carry an amount in a link in either direction, so
both open a message with the amount in the body. Venmo cannot carry one either
when it opens a profile, so those buttons come with a chip that copies the
amount. This is a platform limit and the interface says so.

`venmo.com/?txn=` is not a universal link and will not open the app.
`venmo.com/u/<user>` is, and `venmo://paycharge` opens the charge screen with the
amount already filled in on the phones that support it.

Tapping a payment button nobody has a handle for opens a one-field sheet asking
for that one handle. In an asking-for-money card the missing handle is yours; in
a paying-someone card it is theirs, and the sheet says which.

A person card shows only the avatar, the name, the amount, one pay button and
Mark as paid. Everything else, the other services, the itemized breakdown, the
QR code, the handle fields, sits behind one More row.

## Trips

Several splits group into a trip: a weekend away, a conference, a night out. The
trip page rolls up every split, nets who owes whom across all of them, and
reduces it to the fewest payments that settle everybody. Somebody who owes on
Friday and is owed on Saturday makes one payment, not two.

Names are matched on a normalised key, so "casey" and "Casey " are one person.

## Statements

`src/lib/statement-pdf.js` builds a PDF with jsPDF: the whole split, or one
person's share, or a whole trip. `buildStatementPdf` is deliberately
synchronous, with no await between the tap and the share sheet, because iOS only
opens the share sheet from the gesture that asked for it.

## Who can do what

There is no sign-in. Anyone with a link can read the split and edit it. That is
the point, since people at a table are not going to make accounts, and it means
the link is the only thing protecting the bill.

Deleting is the exception. The device that creates a receipt or a trip generates
a random 32-character token, keeps it in localStorage, and stores only its
sha256 on the row. There is no delete policy on `rs_receipts` or `rs_trips`, so
no client can delete either row directly. Deletion runs through
`rs_delete_receipt` and `rs_delete_trip`, which compare the token they are handed
against the stored hash. A friend holding the link has no token, sees no delete
control, and could not delete the bill by calling the function themselves.

Once set, the owner hash cannot be changed from the client. A split that never
got one can neither be deleted nor claimed by anybody.

That token is also what marks a split as yours, which is why opening somebody
else's link never adds you to their bill.

Receipt photos are stored as a path and read through a signed URL good for a
week, so the bucket does not have to serve permanent public URLs. Rows written
before that change hold an `http` URL and are used as they stand.

## Storage on your phone

Everything the app remembers about you is in this browser's localStorage. No
account, no server-side profile.

| Key | What it holds |
|---|---|
| `rs.history` | splits this browser has opened, newest first |
| `rs.archived` | splits hidden from the list on this device |
| `rs.trips`, `rs.trips.archived` | the same, for trips |
| `rs.profile` | your name and payment handles |
| `rs.me` | the same name again, for anything written before the profile existed |
| `rs.tokens` | the delete token per receipt and trip |
| `rs.mine` | which person row is you, per split |
| `rs.viewer` | who you said you were, when your name matched nobody |
| `rs.me.removed.<id>` | you took yourself off this split |
| `rs.unit.tax`, `rs.unit.tip` | dollars or percent, remembered |

Clearing site data clears all of it. The splits stay in the database, and the
delete tokens do not come back.

## Tests

Plain node, no framework. Each file fails loudly and exits non-zero.

```bash
npm run lint                 # eslint 9, react-hooks, no-shadow as an error
node src/lib/money.test.js   # cent reconciliation, totals, the read gap, the bulk parser
node src/lib/trip.test.js    # netting, settle-up across a trip, which row is you
node src/lib/pay.test.js     # link shapes and the exact request wording
node src/lib/owner.test.js   # the delete token, its digest, and who may delete
```

`owner.test.js` pins the sha256 of a known string against the value Postgres
computes for the same input. If the browser and the database ever disagree on
that digest, every owner silently loses the ability to delete their own split
and nothing else in the app notices.

`pay.test.js` pins the payment link shapes because they were checked against
Venmo's and Cash App's own universal-link files and against a real iPhone. A
silent change there sends somebody's money to the wrong place. It also pins
which side of a request each handle comes from, after a charge link named the
person doing the asking and opened Venmo asking them to pay themselves.

## Known limits

History is per device. Open the same link on a second phone and it joins that
phone's list, with no way to see the first phone's.

A signed photo URL is better than a permanent public one, but it is not a wall.
Anyone holding the anon key and a receipt id can still sign one. Closing that
needs a real notion of who is asking, which this app does not have.

An email link cannot carry an attachment, so Send PDF downloads the file on any
device that cannot share files directly.

## Deployment

Tables live in the `life-command-center` Supabase project, prefixed `rs_`.
Storage bucket `receipt-photos`. Edge Function `read-receipt`. Repo
`agentiksolutions/receipt-splitter`, hosted on Vercel.

Last updated 2026-09-13.
