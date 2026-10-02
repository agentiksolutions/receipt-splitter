---
title: src
purpose: Application code for Halfsies
last_updated: 2026-10-01
status: active
---

# src

## What goes in

The React app: `main.jsx`, `App.jsx`, `App.css`, `supabaseClient.js`, the screens in `components/`, and the logic in `lib/`. All money math is integer cents in `lib/money.js`. Each logic file in `lib/` has a plain node test beside it (`*.test.js`).

## What comes out

`vite build` bundles this folder into `dist/`, which Vercel deploys. `npm run lint` and the `node src/lib/*.test.js` files check it.

## What stays out

SQL and the Edge Function go in `supabase/`. Files served at a fixed URL go in `public/`. Keys go in `.env`, never in code.
