-- Profiles: a display name and a profile picture for every account.
--
-- Pictures live in a private bucket at <user id>/<random>.jpg and are opened through short-lived
-- signed links. Anyone who can read the register can see teammates' pictures; only the owner of a
-- picture can add, replace or remove it. Pending sign-ups can set their own, and see only their own.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_path text not null default '',
  updated_at timestamptz not null default now(),
  constraint profiles_avatar_in_own_folder
    check (avatar_path = '' or avatar_path like user_id::text || '/%')
);
alter table public.profiles enable row level security;

create policy "profiles: read own, members read all" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_read()));
create policy "profiles: add own" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles: edit own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function private.touch_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch_profile before insert or update on public.profiles
  for each row execute function private.touch_profile();

-- ------------------------------------------------------------- pictures
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars: read own, members read all" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.can_read())));
create policy "avatars: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
