-- Vanguard Docs: document-control register on Supabase.
--
-- Access model (all enforced here, never in the browser):
--   owner   reads and writes the register, manages the team, and is the only role that can
--           open the Case File, and only after unlocking it with the Case File passcode.
--   editor  reads and writes the register.
--   viewer  reads the register.
--   pending signed up but not yet approved by an owner: sees nothing.
-- The first account ever created becomes the owner. Everyone after that starts as pending.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------------ team
create type public.member_role as enum ('owner', 'editor', 'viewer', 'pending');

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  role public.member_role not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;

create or replace function private.my_role()
returns public.member_role
language sql stable security definer set search_path = ''
as $$ select role from public.members where user_id = auth.uid() $$;

create or replace function private.can_read()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() in ('owner', 'editor', 'viewer'), false) $$;

create or replace function private.can_write()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() in ('owner', 'editor'), false) $$;

create or replace function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'owner', false) $$;

create policy "members: see yourself, owners see everyone" on public.members
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_owner()));
create policy "members: owners change roles" on public.members
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy "members: owners remove people" on public.members
  for delete to authenticated using ((select private.is_owner()) and user_id <> (select auth.uid()));

-- Only the role column may change, and the last owner can never be demoted.
create or replace function private.guard_members()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  -- auth.uid() is null for dashboard and admin deletes, which may remove anyone.
  if old.role = 'owner' and auth.uid() is not null and (tg_op = 'DELETE' or new.role <> 'owner')
     and (select count(*) from public.members where role = 'owner') <= 1 then
    raise exception 'The register needs at least one owner.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger guard_members before update or delete on public.members
  for each row execute function private.guard_members();

-- Every new account gets a membership row. The very first one becomes the owner.
create or replace function private.on_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('vg-members'));
  insert into public.members (user_id, email, role)
  values (new.id, coalesce(new.email, ''),
          case when exists (select 1 from public.members where role = 'owner') then 'pending' else 'owner' end)
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_new_user();

-- ------------------------------------------------------------- register
create table public.modules (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  code text not null unique check (code ~ '^[A-Z]{2,4}$' and code <> 'CASE'),
  description text not null default '' check (char_length(description) <= 160),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.modules enable row level security;

create policy "modules: members read" on public.modules
  for select to authenticated using ((select private.can_read()));
create policy "modules: editors add" on public.modules
  for insert to authenticated with check ((select private.can_write()));
create policy "modules: editors edit" on public.modules
  for update to authenticated using ((select private.can_write())) with check ((select private.can_write()));
create policy "modules: editors delete" on public.modules
  for delete to authenticated using ((select private.can_write()));

create table public.documents (
  id bigint generated always as identity primary key,
  module_id bigint references public.modules (id) on delete restrict,
  is_case boolean not null default false,
  seq integer not null default 0,
  ref text not null default '',
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status text not null default 'Active' check (status in ('Draft', 'Active', 'In review', 'Expired', 'Archived')),
  party text not null default '' check (char_length(party) <= 120),
  expiry date,
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  link text not null default '' check (link = '' or link ~* '^https?://'),
  notes text not null default '' check (char_length(notes) <= 4000),
  file_path text not null default '',
  file_name text not null default '',
  file_type text not null default '',
  file_size bigint not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_case_or_module check (is_case = (module_id is null))
);
create unique index documents_ref_key on public.documents (ref);
create index documents_module_idx on public.documents (module_id);
alter table public.documents enable row level security;

-- Last sequence number issued per module ("case" for the Case File). It never goes down,
-- so a reference number is never issued twice, even after deletes or moves.
create table public.ref_counters (
  scope text primary key,
  last_seq integer not null default 0
);
alter table public.ref_counters enable row level security; -- no policies: only the trigger touches it

-- ------------------------------------------------------------ case file
create table private.case_secret (
  id boolean primary key default true check (id),
  passcode_hash text not null,
  updated_at timestamptz not null default now()
);
create table private.case_unlocks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);
create table private.case_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index case_attempts_user_idx on private.case_attempts (user_id, at);
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.case_open()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_owner()
     and exists (select 1 from private.case_unlocks where user_id = auth.uid() and expires_at > now())
$$;

create policy "documents: read" on public.documents
  for select to authenticated
  using (case when is_case then (select private.case_open()) else (select private.can_read()) end);
create policy "documents: add" on public.documents
  for insert to authenticated
  with check (case when is_case then (select private.case_open()) else (select private.can_write()) end);
create policy "documents: edit" on public.documents
  for update to authenticated
  using (case when is_case then (select private.case_open()) else (select private.can_write()) end)
  with check (case when is_case then (select private.case_open()) else (select private.can_write()) end);
create policy "documents: delete" on public.documents
  for delete to authenticated
  using (case when is_case then (select private.case_open()) else (select private.can_write()) end);

-- Issues reference numbers and keeps system columns out of the client's hands.
create or replace function private.document_refs()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
  v_scope text;
  v_next integer;
  v_given integer;
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    if new.module_id is not distinct from old.module_id and new.is_case = old.is_case then
      new.seq := old.seq;
      new.ref := old.ref;
      return new;
    end if;
  else
    new.created_at := now();
    new.updated_at := now();
    new.created_by := auth.uid();
  end if;

  if new.is_case then
    v_code := 'CASE';
    v_scope := 'case';
  else
    select code into v_code from public.modules where id = new.module_id;
    if v_code is null then
      raise exception 'That module no longer exists.';
    end if;
    v_scope := 'm' || new.module_id;
  end if;

  insert into public.ref_counters (scope, last_seq) values (v_scope, 0) on conflict (scope) do nothing;
  select last_seq into v_next from public.ref_counters where scope = v_scope for update;
  v_next := greatest(v_next, coalesce((
    select max(seq) from public.documents
    where (v_scope = 'case' and is_case) or module_id = new.module_id), 0)) + 1;

  -- An import may bring its existing reference number along, if it fits this module and is free.
  if tg_op = 'INSERT' and new.ref ~ ('^VG-' || v_code || '-[0-9]{4,7}$')
     and not exists (select 1 from public.documents where ref = new.ref) then
    v_given := substring(new.ref from '[0-9]+$')::integer;
    new.seq := v_given;
    update public.ref_counters set last_seq = greatest(last_seq, v_given) where scope = v_scope;
  else
    new.seq := v_next;
    new.ref := 'VG-' || v_code || '-' || lpad(v_next::text, 4, '0');
    update public.ref_counters set last_seq = v_next where scope = v_scope;
  end if;
  return new;
end $$;
create trigger document_refs before insert or update on public.documents
  for each row execute function private.document_refs();

-- Unlock state for the signed-in user.
create or replace function public.case_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'role', private.my_role(),
    'enabled', exists (select 1 from private.case_secret),
    'unlocked', private.case_open(),
    'expiresAt', (select expires_at from private.case_unlocks where user_id = auth.uid() and expires_at > now()),
    'hours', 8)
$$;

-- Wrong passcodes are answered, not raised, so the failed attempt is recorded.
create or replace function public.unlock_case(passcode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
  v_fails integer;
  v_until timestamptz;
begin
  if not private.is_owner() then
    return jsonb_build_object('ok', false, 'error', 'Only an owner can open the Case File.');
  end if;
  select passcode_hash into v_hash from private.case_secret;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'Set a Case File passcode first.');
  end if;
  select count(*) into v_fails from private.case_attempts
    where user_id = auth.uid() and at > now() - interval '15 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong passcodes. Try again in 15 minutes.');
  end if;
  if extensions.crypt(coalesce(passcode, ''), v_hash) <> v_hash then
    insert into private.case_attempts (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'Wrong Case File passcode.');
  end if;
  delete from private.case_attempts where user_id = auth.uid();
  v_until := now() + interval '8 hours';
  insert into private.case_unlocks (user_id, expires_at) values (auth.uid(), v_until)
    on conflict (user_id) do update set expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'expiresAt', v_until);
end $$;

create or replace function public.lock_case()
returns void
language sql security definer set search_path = ''
as $$ delete from private.case_unlocks where user_id = auth.uid() $$;

-- Sets the passcode the first time; changing it needs the current one. Locks every session.
create or replace function public.set_case_passcode(new_passcode text, current_passcode text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  if not private.is_owner() then
    return jsonb_build_object('ok', false, 'error', 'Only an owner can set the Case File passcode.');
  end if;
  if char_length(coalesce(new_passcode, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Use at least 8 characters.');
  end if;
  select passcode_hash into v_hash from private.case_secret;
  if v_hash is not null and extensions.crypt(coalesce(current_passcode, ''), v_hash) <> v_hash then
    insert into private.case_attempts (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'The current passcode is wrong.');
  end if;
  insert into private.case_secret (id, passcode_hash, updated_at)
    values (true, extensions.crypt(new_passcode, extensions.gen_salt('bf', 10)), now())
    on conflict (id) do update set passcode_hash = excluded.passcode_hash, updated_at = now();
  delete from private.case_unlocks;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.case_status(), public.unlock_case(text), public.lock_case(),
  public.set_case_passcode(text, text) from public, anon;
grant execute on function public.case_status(), public.unlock_case(text), public.lock_case(),
  public.set_case_passcode(text, text) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.my_role(), private.can_read(), private.can_write(),
  private.is_owner(), private.case_open() to authenticated;

-- ---------------------------------------------------------------- files
-- Objects live at <document id>/<random>-<file name>. Access follows the document's own rules,
-- so a locked Case File record's file can't be read, listed or replaced either.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
  'text/csv', 'text/markdown', 'application/json', 'text/plain',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy "document files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents'
         and exists (select 1 from public.documents d where d.id::text = (storage.foldername(name))[1]));
create policy "document files: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select private.can_write())
              and exists (select 1 from public.documents d where d.id::text = (storage.foldername(name))[1]));
create policy "document files: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select private.can_write())
         and exists (select 1 from public.documents d where d.id::text = (storage.foldername(name))[1]));
