-- Sign-ups failed: the CASE expression in on_new_user() yields text, which Postgres will not
-- put into the member_role column. Cast it explicitly.
-- Also index documents.created_by so removing a user doesn't scan the whole register.

create or replace function private.on_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('vg-members'));
  insert into public.members (user_id, email, role)
  values (new.id, coalesce(new.email, ''),
          (case when exists (select 1 from public.members where role = 'owner')
                then 'pending' else 'owner' end)::public.member_role)
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function private.on_new_user() from public, anon, authenticated;

create index if not exists documents_created_by_idx on public.documents (created_by);
