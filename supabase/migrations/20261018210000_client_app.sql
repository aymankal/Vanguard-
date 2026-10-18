-- Vanguard Client app: weekly reports, pipeline, updates, pilots and team chat for each client.
--
-- Same Supabase project as Vanguard Docs and the Scout Desk, separate tables and roles.
--
-- Access model (all enforced here, never in the browser):
--   staff    the Vanguard team. Sees every client, posts reports, pipeline, updates and pilot
--            status, answers chat, and assigns people to clients.
--   client   belongs to one client company. Reads that company's reports, pipeline, updates and
--            pilots, starts pilots and chats with the team. Never sees another client.
--   pending  signed up, not yet assigned to a client by staff: sees nothing.
-- The first person to join becomes staff. Everyone after that starts as pending.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------------ clients and people
create table public.vc_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.vc_clients enable row level security;

create type public.vc_role as enum ('staff', 'client', 'pending');

create table public.vc_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  role public.vc_role not null default 'pending',
  client_id uuid references public.vc_clients (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vc_client_needs_company check (role <> 'client' or client_id is not null)
);
alter table public.vc_members enable row level security;

create or replace function private.vc_role()
returns public.vc_role
language sql stable security definer set search_path = ''
as $$ select role from public.vc_members where user_id = auth.uid() $$;

create or replace function private.vc_is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.vc_role() = 'staff', false) $$;

create or replace function private.vc_my_client()
returns uuid
language sql stable security definer set search_path = ''
as $$ select client_id from public.vc_members where user_id = auth.uid() and role = 'client' $$;

-- Staff see everything; a client user sees rows for their own company.
create or replace function private.vc_can_see(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.vc_is_staff() or (p_client is not null and p_client = private.vc_my_client()) $$;

create policy "vc_clients: staff all, clients their own" on public.vc_clients
  for select to authenticated using ((select private.vc_can_see(id)));
create policy "vc_clients: staff add" on public.vc_clients
  for insert to authenticated with check ((select private.vc_is_staff()));
create policy "vc_clients: staff rename" on public.vc_clients
  for update to authenticated using ((select private.vc_is_staff())) with check ((select private.vc_is_staff()));
create policy "vc_clients: staff remove" on public.vc_clients
  for delete to authenticated using ((select private.vc_is_staff()));

-- Clients see themselves and the Vanguard staff (names for chat); staff see everyone.
create policy "vc_members: yourself, staff see all, clients see staff" on public.vc_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.vc_is_staff()) or role = 'staff');
create policy "vc_members: staff assign" on public.vc_members
  for update to authenticated
  using ((select private.vc_is_staff()) and user_id <> (select auth.uid()))
  with check ((select private.vc_is_staff()) and user_id <> (select auth.uid()));
create policy "vc_members: staff remove" on public.vc_members
  for delete to authenticated
  using ((select private.vc_is_staff()) and user_id <> (select auth.uid()));

create or replace function private.guard_vc_members()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.email <> old.email or new.created_at <> old.created_at then
    raise exception 'Only role, client and name can change';
  end if;
  if new.role <> 'client' then new.client_id := null; end if;
  return new;
end $$;
create trigger guard_vc_members before update on public.vc_members
  for each row execute function private.guard_vc_members();

-- Called by the app after sign-in: adds the caller (pending, or staff if nobody has joined yet).
create or replace function public.vc_join(p_name text default '')
returns public.vc_members
language plpgsql security definer set search_path = ''
as $$
declare
  me public.vc_members;
  em text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext('vc_join'));
  select coalesce(email, '') into em from auth.users where id = auth.uid();
  insert into public.vc_members (user_id, email, name, role)
  values (auth.uid(), em,
          left(coalesce(nullif(trim(p_name), ''), split_part(em, '@', 1)), 80),
          case when exists (select 1 from public.vc_members) then 'pending'::public.vc_role else 'staff'::public.vc_role end)
  on conflict (user_id) do nothing;
  select * into me from public.vc_members where user_id = auth.uid();
  return me;
end $$;
revoke all on function public.vc_join(text) from public, anon;
grant execute on function public.vc_join(text) to authenticated;

-- ------------------------------------------------------------------ content
create or replace function private.vc_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; new.created_by := old.created_by; end if;
  return new;
end $$;

-- Weekly reports: one per client per week.
create table public.vc_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.vc_clients (id) on delete cascade,
  week_start date not null,
  summary text not null default '',
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  highlights text not null default '',
  next_steps text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, week_start)
);

-- Pipeline: the opportunities Vanguard is working for the client.
create table public.vc_pipeline (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.vc_clients (id) on delete cascade,
  company text not null check (length(trim(company)) between 1 and 160),
  contact text not null default '',
  stage text not null default 'New'
    check (stage in ('New', 'Contacted', 'Meeting booked', 'Qualified', 'Proposal', 'Won', 'Lost')),
  value numeric(14, 2) check (value is null or value >= 0),
  next_step text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updates: announcements to one client, or to every client when client_id is null.
create table public.vc_updates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.vc_clients (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  body text not null default '',
  kind text not null default 'Update' check (kind in ('Update', 'Milestone', 'Action needed', 'News')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pilots: a client starts one; staff move it through its stages.
create table public.vc_pilots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.vc_clients (id) on delete cascade,
  service text not null check (service in ('SDR team', 'Sales outsourcing', 'Customer support', 'Other')),
  goal text not null check (length(trim(goal)) between 1 and 2000),
  audience text not null default '',
  seats int check (seats is null or seats between 1 and 50),
  start_date date,
  status text not null default 'Requested'
    check (status in ('Requested', 'Scoping', 'Live', 'Results', 'Closed')),
  team_note text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chat: one thread per client between that client and the Vanguard team.
create table public.vc_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.vc_clients (id) on delete cascade,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['vc_reports', 'vc_pipeline', 'vc_updates', 'vc_pilots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger vc_touch before insert or update on public.%I for each row execute function private.vc_touch()', t);
    execute format('create policy "%s: staff and the client read" on public.%I for select to authenticated using ((select private.vc_can_see(client_id)))', t, t);
    execute format('create policy "%s: staff write" on public.%I for all to authenticated using ((select private.vc_is_staff())) with check ((select private.vc_is_staff()))', t, t);
  end loop;
end $$;

-- Updates with no client go to every client.
create policy "vc_updates: everyone reads broadcasts" on public.vc_updates
  for select to authenticated
  using (client_id is null and (select private.vc_role()) in ('staff', 'client'));

-- Clients may start a pilot for their own company (status starts at Requested).
create policy "vc_pilots: clients request" on public.vc_pilots
  for insert to authenticated
  with check (client_id = (select private.vc_my_client()) and status = 'Requested' and team_note = '');

alter table public.vc_messages enable row level security;
create policy "vc_messages: staff and the client read" on public.vc_messages
  for select to authenticated using ((select private.vc_can_see(client_id)));
create policy "vc_messages: staff and the client send as themselves" on public.vc_messages
  for insert to authenticated
  with check (sender = (select auth.uid()) and (select private.vc_can_see(client_id)));
create policy "vc_messages: staff delete" on public.vc_messages
  for delete to authenticated using ((select private.vc_is_staff()));

create index vc_reports_client_week on public.vc_reports (client_id, week_start desc);
create index vc_pipeline_client on public.vc_pipeline (client_id);
create index vc_updates_client on public.vc_updates (client_id, created_at desc);
create index vc_pilots_client on public.vc_pilots (client_id);
create index vc_messages_client on public.vc_messages (client_id, created_at);

grant select, insert, update, delete on public.vc_clients, public.vc_reports, public.vc_pipeline,
  public.vc_updates, public.vc_pilots, public.vc_messages to authenticated;
grant select, update, delete on public.vc_members to authenticated;

do $$
declare t text;
begin
  foreach t in array array['vc_reports', 'vc_pipeline', 'vc_updates', 'vc_pilots', 'vc_messages', 'vc_members', 'vc_clients'] loop
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;
