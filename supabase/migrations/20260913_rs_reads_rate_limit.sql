-- Rate limiting for the receipt reader.
--
-- The reader is an edge function that spends money per call on a metered
-- Anthropic request. It has no login in front of it, by design, and its only
-- credential is the publishable key that ships inside the public bundle, so
-- anyone who opens the site can read that key out and call the function. There
-- was no ceiling of any kind on what that could bill.
--
-- This table is the ceiling. The function writes one row per accepted call and
-- refuses when either count is already spent. It is written and read ONLY by
-- the function, through the service role, so it gets no anon grant. A client
-- that could write here could raise its own limit.
create table if not exists rs_reads (
  id bigserial primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);

create index if not exists rs_reads_at_idx on rs_reads (at desc);
create index if not exists rs_reads_ip_at_idx on rs_reads (ip_hash, at desc);

alter table rs_reads enable row level security;
-- No policies on purpose. RLS with zero policies denies everything to anon and
-- authenticated; the service role bypasses RLS and is the only caller.

revoke all on rs_reads from anon, authenticated;
revoke all on sequence rs_reads_id_seq from anon, authenticated;

-- service_role bypasses RLS but NOT table grants, and this project has no
-- default grants at all, so without this the function was refused by its own
-- table and every read returned 503. This line is the whole fix.
grant select, insert on rs_reads to service_role;
grant usage, select on sequence rs_reads_id_seq to service_role;
