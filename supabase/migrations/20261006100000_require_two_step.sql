-- OPTIONAL hardening. Apply only after every member has set up two-step sign-in in the app.
--
-- The app already blocks anyone without a verified second step from reaching the register. This
-- makes the database refuse too: a restrictive policy is ANDed with every existing policy, so a
-- session that only has a password (aal1) reads and writes nothing, even straight through the API.
-- Run this once all accounts show as enrolled, or anyone who hasn't enrolled will be locked out.

create policy "two-step required" on public.members       as restrictive for all to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2') with check (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
create policy "two-step required" on public.modules       as restrictive for all to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2') with check (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
create policy "two-step required" on public.documents     as restrictive for all to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2') with check (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
create policy "two-step required" on public.profiles      as restrictive for all to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2') with check (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
create policy "two-step required" on storage.objects      as restrictive for all to authenticated
  using (bucket_id not in ('documents', 'avatars') or coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2')
  with check (bucket_id not in ('documents', 'avatars') or coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
