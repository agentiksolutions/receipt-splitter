-- Receipt Splitter schema, v2.
--
-- This mirrors what is already live in the Supabase project. It is here so a
-- fresh project can be stood up from one file. Do not re-run it against the
-- live project.
--
-- Access model: a receipt is reachable by its link, and anyone holding the
-- link can read and edit it. That is the point, since people at the table are
-- not going to make accounts. There is no sign-in. The app keeps its history
-- in the browser's localStorage instead.
--
-- owner_id and the owner-only delete policy below are still in the live
-- database but the app no longer writes or relies on them. With nobody ever
-- signed in, auth.uid() is null, so no client can delete a receipt row. Rows
-- for people, items and assignments are still deletable by anyone with the
-- link.

create extension if not exists "pgcrypto";

-- --- tables ----------------------------------------------------------------

create table rs_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null default 'Untitled receipt',
  event_date date default current_date,
  tax_amount numeric not null default 0,
  tip_amount numeric not null default 0,
  photo_url text,
  payer_name text,
  owner_id uuid references auth.users(id) on delete set null
);

create table rs_people (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references rs_receipts(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  venmo text,
  cashapp text,
  zelle text,
  phone text,
  email text,
  settled boolean not null default false,
  settled_via text
);

create table rs_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references rs_receipts(id) on delete cascade,
  name text not null,
  price numeric not null,
  created_at timestamptz default now()
);

create table rs_item_assignments (
  item_id uuid not null references rs_items(id) on delete cascade,
  person_id uuid not null references rs_people(id) on delete cascade,
  primary key (item_id, person_id)
);

create index on rs_people (receipt_id);
create index on rs_items (receipt_id);
create index on rs_item_assignments (person_id);

-- --- grants ----------------------------------------------------------------
-- The app talks to Postgres as the anon role. RLS decides what it may do, but
-- the role still needs the underlying table privilege.

grant select, insert, update, delete on rs_receipts, rs_people, rs_items, rs_item_assignments to anon, authenticated;

-- --- row level security ----------------------------------------------------

alter table rs_receipts enable row level security;
alter table rs_people enable row level security;
alter table rs_items enable row level security;
alter table rs_item_assignments enable row level security;

-- Anyone with the link can read a receipt and edit its totals. The delete
-- policy is owner-scoped and, with no sign-in, matches nothing.
create policy "public read rs_receipts" on rs_receipts for select using (true);
create policy "public insert rs_receipts" on rs_receipts for insert with check (true);
create policy "public update rs_receipts" on rs_receipts for update using (true);
create policy "owner delete rs_receipts" on rs_receipts for delete using (owner_id = auth.uid());

create policy "public read rs_people" on rs_people for select using (true);
create policy "public insert rs_people" on rs_people for insert with check (true);
create policy "public update rs_people" on rs_people for update using (true);
create policy "public delete rs_people" on rs_people for delete using (true);

create policy "public read rs_items" on rs_items for select using (true);
create policy "public insert rs_items" on rs_items for insert with check (true);
create policy "public delete rs_items" on rs_items for delete using (true);

create policy "public read assignments" on rs_item_assignments for select using (true);
create policy "public insert assignments" on rs_item_assignments for insert with check (true);
create policy "public delete assignments" on rs_item_assignments for delete using (true);

-- --- realtime --------------------------------------------------------------
-- Two phones at the same table watch the same rows.

alter publication supabase_realtime add table rs_receipts;
alter publication supabase_realtime add table rs_people;
alter publication supabase_realtime add table rs_items;
alter publication supabase_realtime add table rs_item_assignments;

-- --- storage ---------------------------------------------------------------
-- Create a PUBLIC bucket named receipt-photos in the dashboard, then:

-- create policy "public read receipt photos" on storage.objects
--   for select using (bucket_id = 'receipt-photos');
-- create policy "public insert receipt photos" on storage.objects
--   for insert with check (bucket_id = 'receipt-photos');
-- create policy "public update receipt photos" on storage.objects
--   for update using (bucket_id = 'receipt-photos');
