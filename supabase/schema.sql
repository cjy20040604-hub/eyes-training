-- Binocular Vision Explorer: cloud sync storage (Supabase / Postgres).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Table name is prefixed (bv_) so the app can share a Supabase project with other apps.
--
-- One row per account: the user's whole data bundle, gzip-compressed and encrypted on the
-- device (AES-256-GCM, key from the user's sync passphrase). The server only ever stores
-- ciphertext, the random salt and a version number. Row-level security lets each signed-in
-- user read and write only their own row.

create table if not exists public.bv_vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    bigint      not null check (version >= 1),
  salt       text        not null,
  iterations integer     not null check (iterations >= 100000),
  iv         text        not null,
  data       text        not null,
  device     text        not null default '',
  updated_at timestamptz not null default now()
);

alter table public.bv_vaults enable row level security;

drop policy if exists "bv vault: read own" on public.bv_vaults;
drop policy if exists "bv vault: create own" on public.bv_vaults;
drop policy if exists "bv vault: update own" on public.bv_vaults;
drop policy if exists "bv vault: delete own" on public.bv_vaults;

create policy "bv vault: read own" on public.bv_vaults
  for select using (auth.uid() = user_id);
create policy "bv vault: create own" on public.bv_vaults
  for insert with check (auth.uid() = user_id);
create policy "bv vault: update own" on public.bv_vaults
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bv vault: delete own" on public.bv_vaults
  for delete using (auth.uid() = user_id);

-- Keep encrypted bundles to a sensible size (about 8 MB of base64).
alter table public.bv_vaults drop constraint if exists bv_vaults_data_size;
alter table public.bv_vaults add constraint bv_vaults_data_size check (length(data) <= 8000000);

-- Only signed-in users reach the table (and then only their own row, via the policies above).
revoke all on public.bv_vaults from anon;
grant select, insert, update, delete on public.bv_vaults to authenticated;
