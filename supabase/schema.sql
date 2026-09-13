-- Receipt Splitter (Halfsies) schema, v3.
--
-- This mirrors what is already live in the Supabase project, so a fresh project
-- can be stood up from one file. Do not re-run it against the live project.
--
-- Access model: a split is reachable by its link, and anyone holding the link
-- can read and edit it. That is the point, since people at the table are not
-- going to make accounts. There is no sign-in, and the app keeps its history in
-- the browser's localStorage.
--
-- Deleting is the one thing a link does not buy you. The device that creates a
-- receipt or a trip generates a random token, keeps it in localStorage under
-- rs.tokens, and stores only its sha256 on the row. There is no delete policy
-- on rs_receipts or rs_trips, so no client can delete either directly; deletion
-- goes through the SECURITY DEFINER functions at the bottom, which compare the
-- token they are handed against the stored hash. A friend with the link holds
-- no token, is shown no delete control, and could not delete the bill even by
-- calling the function themselves.

create extension if not exists "pgcrypto";

-- --- tables ----------------------------------------------------------------

-- A trip groups several splits: a weekend away, a conference, a night out.
-- Which trips a device knows about lives in its localStorage, same as splits.
create table rs_trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  start_date date default current_date,
  -- sha256 hex of the creating device's token, set on insert and never again.
  -- A row without one can neither be deleted nor claimed by anybody.
  owner_token_hash text
);

create table rs_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  -- The app writes '' rather than inventing a name; every reader shows
  -- "Untitled split" for a blank one. The default is only for rows inserted
  -- without the column at all.
  title text not null default 'Untitled receipt',
  event_date date default current_date,
  tax_amount numeric not null default 0,
  tip_amount numeric not null default 0,
  -- A storage PATH inside the receipt-photos bucket, read through a signed URL.
  -- Older rows hold a public http URL and are used as they stand.
  photo_url text,
  -- Who paid. payer_id is what the app reads; payer_name rides along for the
  -- PDF header, which has no people table to look an id up in, and is the only
  -- clue on a row made before payer_id existed.
  payer_id uuid,
  payer_name text,
  trip_id uuid references rs_trips(id) on delete set null,
  -- food | drinks | groceries | transportation | lodging | activities | other
  category text not null default 'food',
  -- halfsies | evenly | items. On the row rather than in localStorage, so
  -- everyone holding the link sees the same split.
  split_mode text not null default 'items',
  -- What the photo reader saw on the receipt itself, kept whatever the split
  -- ends up being called.
  merchant text,
  receipt_time time,
  -- Set on insert and never again; see rs_protect_owner_hash below.
  owner_token_hash text,
  -- Left from v1. Nothing reads or writes it; there is no sign-in.
  owner_id uuid references auth.users(id) on delete set null
);

create table rs_people (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references rs_receipts(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  venmo text,
  -- A venmo.com/code?user_id=... profile link scanned off somebody's QR, used
  -- when there is no username to build a link from.
  venmo_link text,
  cashapp text,
  -- the PayPal.Me name, so the link is paypal.me/<paypal>/<amount>USD
  paypal text,
  zelle text,
  phone text,
  email text,
  -- Which services this person actually takes, as
  -- {venmo, cashapp, paypal, zelle, applecash} booleans. Null means "no answer
  -- given", which shows every option; an all-false map would read as "takes no
  -- payment at all" and the app never writes one.
  accepts jsonb,
  -- One of the accepts keys, shown first.
  preferred text,
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

create index on rs_receipts (trip_id);
create index on rs_people (receipt_id);
create index on rs_items (receipt_id);
create index on rs_item_assignments (person_id);

-- --- grants ----------------------------------------------------------------
-- The app talks to Postgres as the anon role. RLS decides what it may do, but
-- the role still needs the underlying table privilege.

grant select, insert, update, delete on rs_trips, rs_receipts, rs_people, rs_items, rs_item_assignments to anon, authenticated;

-- --- row level security ----------------------------------------------------

alter table rs_trips enable row level security;
alter table rs_receipts enable row level security;
alter table rs_people enable row level security;
alter table rs_items enable row level security;
alter table rs_item_assignments enable row level security;

-- Note what is NOT here: rs_trips and rs_receipts have no delete policy, so a
-- client cannot delete either row however it asks. Deleting runs through the
-- functions below.
create policy "rs public read" on rs_trips for select using (true);
create policy "rs public insert" on rs_trips for insert with check (true);
create policy "rs public update" on rs_trips for update using (true);

create policy "rs public read" on rs_receipts for select using (true);
create policy "rs public insert" on rs_receipts for insert with check (true);
create policy "rs public update" on rs_receipts for update using (true);

create policy "rs public read" on rs_people for select using (true);
create policy "rs public insert" on rs_people for insert with check (true);
create policy "rs public update" on rs_people for update using (true);
create policy "rs public delete" on rs_people for delete using (true);

create policy "rs public read" on rs_items for select using (true);
create policy "rs public insert" on rs_items for insert with check (true);
create policy "rs public delete" on rs_items for delete using (true);

create policy "rs public read" on rs_item_assignments for select using (true);
create policy "rs public insert" on rs_item_assignments for insert with check (true);
create policy "rs public delete" on rs_item_assignments for delete using (true);

-- --- deleting --------------------------------------------------------------
-- The client sends the RAW token it kept in localStorage. Only the hash was
-- ever stored, and only these functions can remove the row.

-- Supabase's linter flags both of these as SECURITY DEFINER functions the anon
-- role can call. That is accepted and deliberate: anon calling them IS the
-- delete mechanism, since nobody ever signs in. Revoking EXECUTE would turn
-- deletion off for everyone. Do not "fix" this on a later scan.

create or replace function public.rs_delete_receipt(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare h text := encode(sha256(convert_to(coalesce(p_token,''), 'utf8')), 'hex');
begin
  delete from rs_receipts where id = p_id and owner_token_hash is not null and owner_token_hash = h;
  return found;
end $$;

create or replace function public.rs_delete_trip(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare h text := encode(sha256(convert_to(coalesce(p_token,''), 'utf8')), 'hex');
begin
  if not exists (select 1 from rs_trips where id = p_id and owner_token_hash is not null and owner_token_hash = h) then
    return false;
  end if;
  delete from rs_receipts where trip_id = p_id and owner_token_hash = h;
  -- Somebody else's split in your trip is not yours to delete. It comes out of
  -- the trip and is left alone.
  update rs_receipts set trip_id = null where trip_id = p_id;
  delete from rs_trips where id = p_id;
  return true;
end $$;

-- A link holder can update a receipt, which without this could mean blanking
-- the hash and deleting somebody else's bill, or setting one on a row that had
-- none and claiming it. The column is insert-only.
create or replace function public.rs_protect_owner_hash()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.owner_token_hash is distinct from old.owner_token_hash then
    raise exception 'owner_token_hash cannot be changed after insert';
  end if;
  return new;
end $$;

-- The detach step inside rs_delete_trip fires this once per row. It only sets
-- trip_id, so the hash is unchanged and the guard passes.
create trigger rs_receipts_protect_owner
  before update on public.rs_receipts
  for each row execute function rs_protect_owner_hash();

create trigger rs_trips_protect_owner
  before update on public.rs_trips
  for each row execute function rs_protect_owner_hash();

-- --- realtime --------------------------------------------------------------
-- Two phones at the same table watch the same rows.

alter publication supabase_realtime add table rs_receipts;
alter publication supabase_realtime add table rs_people;
alter publication supabase_realtime add table rs_items;
alter publication supabase_realtime add table rs_item_assignments;

-- --- storage ---------------------------------------------------------------
-- Create a bucket named receipt-photos in the dashboard and mark it PRIVATE.
-- Private only turns off the permanent /object/public/ route; the policies
-- below still decide who may touch an object, and createSignedUrl signs as the
-- anon role, so the select policy has to stay or signing fails.

-- create policy "rs photos public read" on storage.objects
--   for select using (bucket_id = 'receipt-photos');
-- create policy "rs photos public upload" on storage.objects
--   for insert with check (bucket_id = 'receipt-photos');
-- create policy "rs photos public update" on storage.objects
--   for update using (bucket_id = 'receipt-photos');
-- All three are already live under those names, so the bucket can be flipped
-- private without touching them and without breaking a photo.

-- What that buys, stated plainly: a photo stops being reachable at a permanent
-- guessable URL and is reachable only through a link the app signs for a week.
-- It is not a wall. Anyone holding the anon key and a receipt id can still sign
-- one. Closing that needs per-object policies and a real notion of who is
-- asking, which this app does not have.
