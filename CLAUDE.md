# CLAUDE.md: receipt-splitter

This repo is Halfsies, a free receipt-splitting web app, live at
https://receipt-splitter-seven-chi.vercel.app. `README.md` covers how it works. This file
covers what a session gets wrong here.

Before working in a folder, read its README.md.

## Branches

Test changes on the `staging` branch. Merging `staging` into `main` is Phil's call, never a
session's.

## Database

The `rs_*` tables and the `receipt-photos` storage bucket live in the `life-command-center`
Supabase project. That project has no default
grants: a new table needs explicit GRANT statements, `service_role` included, or every query
against it fails.

Deletes go through the `rs_delete_receipt` and `rs_delete_trip` functions, which check the
owner token. Never write a direct DELETE against `rs_receipts` or `rs_trips`.

## Scope

No login, no payment processor and no custom domain. Phil decided all three. Do not add them.
