-- The scout-copilot edge function reads its model key from Vault when no AI_API_KEY secret is set.
-- Store it once with: select vault.create_secret('<token>', 'scout_ai_api_key');
-- Only the service role may call this; signed-in users and anonymous visitors cannot.
create or replace function public.scout_ai_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'scout_ai_api_key' limit 1
$$;
revoke all on function public.scout_ai_key() from public, anon, authenticated;
grant execute on function public.scout_ai_key() to service_role;
