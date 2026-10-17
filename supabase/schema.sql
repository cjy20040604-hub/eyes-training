-- Binocular Vision Explorer: cloud sync storage (Supabase / Postgres).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per account: the user's whole data bundle, gzip-compressed and encrypted on the
-- device (AES-256-GCM, key from the user's sync passphrase). The server only ever stores
-- ciphertext, the random salt and a version number. Row-level security lets each signed-in
-- user read and write only their own row.

create table if not exists public.vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    bigint      not null check (version >= 1),
  salt       text        not null,
  iterations integer     not null check (iterations >= 100000),
  iv         text        not null,
  data       text        not null,
  device     text        not null default '',
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

drop policy if exists "vault: read own" on public.vaults;
drop policy if exists "vault: create own" on public.vaults;
drop policy if exists "vault: update own" on public.vaults;
drop policy if exists "vault: delete own" on public.vaults;

create policy "vault: read own" on public.vaults
  for select using (auth.uid() = user_id);
create policy "vault: create own" on public.vaults
  for insert with check (auth.uid() = user_id);
create policy "vault: update own" on public.vaults
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vault: delete own" on public.vaults
  for delete using (auth.uid() = user_id);

-- Keep encrypted bundles to a sensible size (about 8 MB of base64).
alter table public.vaults drop constraint if exists vaults_data_size;
alter table public.vaults add constraint vaults_data_size check (length(data) <= 8000000);
