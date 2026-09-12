# Receipt Splitter — handoff

Turns a grocery/restaurant receipt into a shareable link where any number of
people can be assigned items, see what they owe (tax included), and pay each
other via Venmo, Cash App, Zelle, Apple Pay, or cash — all link-based, no
login. This doc is the full build scope. Code for the app itself is already
written below; what's left is provisioning + deploy + polish.

## What's already built (in this folder)

- `src/App.jsx` — full React app: add/remove people, add items (one at a
  time or pasted in bulk), assign any item to any subset of people, tax
  entered as a dollar amount and split proportionally, live totals per
  person, a photo upload (stored in Supabase Storage, shown for reference
  only — not OCR'd), and per-person payment cards with a Request/Send
  toggle that builds Venmo/Cash App/Zelle/Apple Pay links plus prefilled
  text/email share links.
- `src/App.css` — all styling, ported from the working prototype.
- `src/supabaseClient.js` — Supabase JS client, reads keys from env vars.
- `supabase/schema.sql` — full schema: `rs_receipts`, `rs_people`, `rs_items`,
  `rs_item_assignments`, with RLS policies open enough for a link-based MVP.
- `.env.example` — the two env vars the app needs.

This was hand-written outside a real Node environment, so **treat it as a
strong first draft, not tested code** — run `npm install` and `npm run dev`
first and expect to fix small issues (import paths, a missed prop, etc.)
before it's production-ready.

## Deployed 2026-09-12

Tables live in the `life-command-center` Supabase project (prefixed `rs_`), storage bucket `receipt-photos`, repo `agentiksolutions/receipt-splitter`, hosted on Vercel. The anon role also needed explicit table GRANTs in that project; both migrations are recorded in Supabase.

## Original handoff steps (done)

### 1. Provision Supabase
- Create a new Supabase project.
- Run `supabase/schema.sql` in the SQL editor.
- Create a public Storage bucket named `receipt-photos` (Storage → New
  bucket → Public bucket).
- Copy the project URL and anon public key into `.env` (see
  `.env.example`).

### 2. Install and smoke-test locally
```bash
npm install
npm run dev
```
Open the local URL, confirm you can add people/items, assign, see totals
update, and that a fresh visit to the same `?receipt=<uuid>` URL in another
browser tab shows the same state (proves Supabase read/write works).

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "Initial receipt splitter"
gh repo create receipt-splitter --public --source=. --push
```
(or push manually to a repo you've already created — no GitHub connector
was available in the chat session that produced this handoff, so this step
was never run).

### 4. Deploy to Vercel
- Import the GitHub repo in Vercel.
- Framework preset: Vite.
- Add the two env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in
  Vercel's project settings.
- Deploy. Every new receipt gets its own shareable
  `https://your-app.vercel.app/?receipt=<uuid>` link.

### 5. Known gaps worth closing
- **No auth / open RLS.** Anyone with a receipt's link can read and edit
  it. Fine for splitting a grocery bill with friends; not fine for
  anything sensitive. If that matters, add Supabase Auth and scope RLS
  policies to a `created_by` column.
- **No realtime sync.** Two people open the same link and edit
  simultaneously, the state can go stale until a refresh. Supabase
  Realtime subscriptions on the four tables would fix this — worth adding
  if this gets used live at the table.
- **Payment links are best-effort.** Venmo supports amount-prefilled
  request (`txn=charge`) and pay (`txn=pay`) links. Cash App only supports
  amount-prefilled *send* links (`cash.app/$user/amount`) — a "request"
  from Cash App falls back to a prefilled text. Zelle and Apple Pay have
  no amount-in-link support at all in either direction, so both always
  fall back to a prefilled text with the number in it. This is a platform
  limitation, not a bug — flag it in the UI if it confuses testers.
- **Photo isn't attached to texts/emails.** `mailto:`/`sms:` links can't
  carry attachments. The photo lives in Supabase Storage and is shown in
  the app for reference, but sharing it elsewhere means sending the
  Storage URL or the app link itself, not an attachment.
- **No delete-a-receipt / list-my-receipts view.** Currently a receipt is
  only reachable via its exact link. A "my receipts" view would need
  auth first.
- **No tests.** Given the small surface area, a handful of component
  tests (add/remove item, assignment math, tax split) would catch
  regressions cheaply.

## Tech stack
Vite + React (no framework needed, no server code — Supabase is the only
backend), Supabase (Postgres + Storage), Vercel (static hosting + env
vars). No auth library, no CSS framework — plain CSS in `App.css`.
