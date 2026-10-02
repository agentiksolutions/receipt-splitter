---
title: supabase
purpose: Database schema and Edge Function for Halfsies
last_updated: 2026-10-01
status: active
---

# supabase

## What goes in

`schema.sql`, the whole schema for the `rs_*` tables, kept in step with what is live. `functions/read-receipt/`, the Edge Function that sends a receipt photo to Claude and returns the line items.

## What comes out

`schema.sql` is run only against a fresh project. The Edge Function is deployed to the `life-command-center` Supabase project, and the app calls it when someone photographs a receipt.

## What stays out

Keys, including the `ANTHROPIC_API_KEY`, which lives in the Edge Function secrets. Application code goes in `src/`.
