# Receipt Splitter

Type in what a table ordered, tap who had what, and everyone gets their own
number with tax and tip worked in. Send the link and the other people can
claim their own items from their phones. Each person gets payment links and a
QR code so the money can move without anyone doing arithmetic.

Vite + React + Supabase. No server code.

## What v2 added

**A landing page with history.** Visiting the app with no `?receipt=` parameter
now shows a hero, a form to name and date a new split, and a history of every
receipt this browser created or opened (kept in localStorage, no account),
newest first with the title, date, item count, total, and a paid or open pill
per person. The remove button only drops it from this phone's list.

**Titles and dates.** A receipt is "Nashville trip dinner", not a UUID. Both
fields are editable in place at the top of the page.

**Tip, alongside tax.** Both are entered as dollar amounts and split in
proportion to what each person ordered. Somebody who ordered nothing pays
nothing toward either.

**Arithmetic that closes.** All math runs in integer cents in `src/lib/money.js`.
The per-person totals sum to the displayed total exactly, with any residual cent
going to the largest share. Items nobody has claimed are held out of every
total and flagged, and if nothing is claimed at all the tax and tip appear on
their own line rather than disappearing into a total nobody owes.

**Who paid.** Pick the payer and the summary reads "Lee, Dana owe Phil $87.49
between them". The payer's own card shows their share with no request buttons,
because they are not collecting from themselves.

**Payment cards.** Each person's handles for Venmo, Cash App, Zelle, phone and
email save to the database as you leave each field. A Request or Send toggle
flips the direction of every link. There is a QR code per person, and marking
someone settled records which method they used and mutes their card.

**Realtime.** Two phones open on the same receipt stay in step. The app watches
all four tables and refetches when any of them changes.

**A visual design.** Plain CSS in `src/App.css`, mobile-first, one accent, dark
mode through `prefers-color-scheme`.

## Setup

```bash
npm install
npm run dev
```

`.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. See `.env.example`.

`supabase/schema.sql` is the whole schema, matching what is live. Run it only
against a fresh project. It also needs a public storage bucket named
`receipt-photos`, created from the dashboard.

## Checking the math

```bash
node src/lib/money.test.js
```

Plain node, no test framework. It asserts that per-person totals reconcile to
the cent across odd splits, unclaimed items, zero-share people, and crowds of
two to nine. If the reconciliation ever breaks, this fails.

## What the payment links can and cannot do

| App | Request | Send |
|---|---|---|
| Venmo | link with the amount and note | link with the amount and note |
| Cash App | prefilled text | link with the amount |
| Zelle | prefilled text | prefilled text |
| Apple Pay | prefilled text | prefilled text |

Zelle and Apple Pay have no way to carry an amount in a link in either
direction, so both open a text message with the amount written into it. That is
a platform limit, not a bug, and the interface says so on each card.

The QR code on a person's card encodes their Venmo link when they have a Venmo
username, so somebody across the table can scan it and land on a prefilled
payment. Without a Venmo username it encodes the receipt link instead.

## Known limits

Anyone with a receipt link can read and edit it. That is deliberate, since
people at a table are not going to make accounts, but it means the link is the
only thing protecting a receipt.

History is per device. Open the same link on a second phone and it joins that
phone's list, with no way to see the first phone's list. Clearing site data
clears the list, and the receipts themselves stay in the database.

Nothing deletes a receipt row. The delete rule live on `rs_receipts` matches no
client this app can be, so removing a row from the list only forgets it on this
device. People, items and assignments can still be deleted by anyone with the
link. See the comments in `supabase/schema.sql` for the exact rule.

The photo is a visual reference and is not read for text. It cannot ride along
on a text or email either, because `sms:` and `mailto:` links carry no
attachments.

## Deployed 2026-09-12

Tables live in the `life-command-center` Supabase project (prefixed `rs_`), storage bucket `receipt-photos`, repo `agentiksolutions/receipt-splitter`, hosted on Vercel. The anon role also needed explicit table GRANTs in that project; both migrations are recorded in Supabase.
