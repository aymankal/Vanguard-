-- Scout Desk (Vanguard Frontier): pipeline, founder vetting and investor database.
--
-- Same Supabase project as Vanguard Docs, separate tables and roles. Joining one app gives no access
-- to the other.
--
-- Access model (all enforced here, never in the browser):
--   partner  reads everything, approves submissions, moves stages, keeps partner-only notes and
--            deal terms, and manages the team.
--   scout    reads the desk (not partner notes), submits startups, investors, vettings and
--            activity, and adds updates to their own submissions.
--   viewer   reads the desk (not partner notes).
--   pending  signed up but not yet approved by a partner: sees nothing.
-- The first person to join becomes a partner. Everyone after that starts as pending.
--
-- Records are JSON documents grouped by collection, so the app keeps one flexible shape per form.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------------ team
create type public.scout_role as enum ('partner', 'scout', 'viewer', 'pending');

create table public.scout_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  role public.scout_role not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scout_members enable row level security;

create or replace function private.scout_role()
returns public.scout_role
language sql stable security definer set search_path = ''
as $$ select role from public.scout_members where user_id = auth.uid() $$;

create or replace function private.scout_can_read()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.scout_role() in ('partner', 'scout', 'viewer'), false) $$;

create or replace function private.scout_can_submit()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.scout_role() in ('partner', 'scout'), false) $$;

create or replace function private.scout_is_partner()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.scout_role() = 'partner', false) $$;

create policy "scout_members: see yourself, members see the team" on public.scout_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.scout_can_read()));
create policy "scout_members: partners change roles" on public.scout_members
  for update to authenticated
  using ((select private.scout_is_partner()) and user_id <> (select auth.uid()))
  with check ((select private.scout_is_partner()) and user_id <> (select auth.uid()));
create policy "scout_members: partners remove people" on public.scout_members
  for delete to authenticated
  using ((select private.scout_is_partner()) and user_id <> (select auth.uid()));

-- Only role and name may change through updates; email and ids stay as joined.
create or replace function private.guard_scout_members()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.email <> old.email or new.created_at <> old.created_at then
    raise exception 'Only role and name can change';
  end if;
  return new;
end $$;
create trigger guard_scout_members before update on public.scout_members
  for each row execute function private.guard_scout_members();

-- Called by the app after sign-in. Adds the caller to the team (pending, or partner if the team is
-- empty) and returns their row. Safe to call on every sign-in.
create or replace function public.scout_join(p_name text default '')
returns public.scout_members
language plpgsql security definer set search_path = ''
as $$
declare
  me public.scout_members;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext('scout_join'));
  insert into public.scout_members (user_id, email, name, role)
  select auth.uid(),
         coalesce((select email from auth.users where id = auth.uid()), ''),
         left(coalesce(nullif(trim(p_name), ''), split_part(coalesce((select email from auth.users where id = auth.uid()), ''), '@', 1)), 80),
         case when exists (select 1 from public.scout_members) then 'pending'::public.scout_role else 'partner'::public.scout_role end
  on conflict (user_id) do nothing;
  select * into me from public.scout_members where user_id = auth.uid();
  return me;
end $$;
revoke all on function public.scout_join(text) from public, anon;
grant execute on function public.scout_join(text) to authenticated;

-- ------------------------------------------------------------------ records
create table public.scout_docs (
  collection text not null
    check (collection in ('deals', 'investors', 'vettings', 'activity', 'reviews', 'partner_notes')),
  id text not null default replace(gen_random_uuid()::text, '-', '')
    check (id ~ '^[A-Za-z0-9_.:@+~-]{1,200}$'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.scout_docs enable row level security;
alter table public.scout_docs replica identity full;

create or replace function private.touch_scout_doc()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger touch_scout_doc before insert or update on public.scout_docs
  for each row execute function private.touch_scout_doc();

create policy "scout_docs: members read, partner notes are partners only" on public.scout_docs
  for select to authenticated
  using ((select private.scout_can_read()) and (collection <> 'partner_notes' or (select private.scout_is_partner())));

create policy "scout_docs: scouts submit, partners review" on public.scout_docs
  for insert to authenticated
  with check (
    (collection in ('deals', 'investors', 'vettings', 'activity')
      and (select private.scout_can_submit()) and created_by = (select auth.uid()))
    or (collection in ('reviews', 'partner_notes') and (select private.scout_is_partner()))
  );

create policy "scout_docs: partners edit anything, scouts their own submissions" on public.scout_docs
  for update to authenticated
  using (
    (select private.scout_is_partner())
    or (collection in ('deals', 'investors', 'vettings', 'activity')
        and (select private.scout_can_submit()) and created_by = (select auth.uid()))
  )
  with check (
    (select private.scout_is_partner())
    or (collection in ('deals', 'investors', 'vettings', 'activity')
        and (select private.scout_can_submit()) and created_by = (select auth.uid()))
  );

create policy "scout_docs: partners delete" on public.scout_docs
  for delete to authenticated using ((select private.scout_is_partner()));

-- Merge fields into a document (the app's "update"). Runs as the caller, so the policies above apply.
create or replace function public.scout_merge(p_collection text, p_id text, p_patch jsonb)
returns void
language sql security invoker set search_path = ''
as $$
  update public.scout_docs set data = data || p_patch
  where collection = p_collection and id = p_id
$$;
revoke all on function public.scout_merge(text, text, jsonb) from public, anon;
grant execute on function public.scout_merge(text, text, jsonb) to authenticated;

grant select, insert, update, delete on public.scout_docs to authenticated;
grant select, update, delete on public.scout_members to authenticated;

-- Live updates: Realtime applies the select policy per subscriber.
alter publication supabase_realtime add table public.scout_docs;
alter publication supabase_realtime add table public.scout_members;
