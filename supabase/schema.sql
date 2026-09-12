-- Receipt Splitter schema
-- Run this in the Supabase SQL editor for a new project.

create extension if not exists "pgcrypto";

create table rs_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  tax_amount numeric not null default 0,
  photo_url text
);

create table rs_people (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references rs_receipts(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
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

-- Storage bucket for receipt photos (create via dashboard or this policy-only
-- approach assumes a public bucket named "receipt-photos" already exists).

-- RLS: this MVP is link-based with no auth, so anyone with a receipt's UUID
-- (an unguessable link) can read/write it. That's fine for splitting a
-- grocery bill with friends, but do NOT use this schema as-is for anything
-- sensitive. Enable auth + row ownership before that.

alter table rs_receipts enable row level security;
alter table rs_people enable row level security;
alter table rs_items enable row level security;
alter table rs_item_assignments enable row level security;

create policy "public read rs_receipts" on rs_receipts for select using (true);
create policy "public insert rs_receipts" on rs_receipts for insert with check (true);
create policy "public update rs_receipts" on rs_receipts for update using (true);

create policy "public read rs_people" on rs_people for select using (true);
create policy "public insert rs_people" on rs_people for insert with check (true);
create policy "public delete rs_people" on rs_people for delete using (true);

create policy "public read rs_items" on rs_items for select using (true);
create policy "public insert rs_items" on rs_items for insert with check (true);
create policy "public delete rs_items" on rs_items for delete using (true);

create policy "public read assignments" on rs_item_assignments for select using (true);
create policy "public insert assignments" on rs_item_assignments for insert with check (true);
create policy "public delete assignments" on rs_item_assignments for delete using (true);
