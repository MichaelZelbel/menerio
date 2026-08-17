-- Step 7 of "One key for Menerio": switch off the old connector token.
--
-- Runs only after a full day of the single API key working, so the way back
-- stays open until then. Deliberately NOT in supabase/migrations/ until that
-- day has passed — see supabase/deferred/README.md.
--
-- The token is found by the SHA-256 fingerprint the table already stores, so no
-- token value appears in this file and no other user's token is touched.
--
-- Idempotent: re-running it changes nothing.

update public.mcp_api_tokens
set revoked_at = now()
where token_hash = '2935e79892b93e29d434f9f49ac6a82ba431ab5b8346a398cf74ce831cc92d41'
  and revoked_at is null;

do $$
begin
  if not exists (
    select 1 from public.mcp_api_tokens
    where token_hash = '2935e79892b93e29d434f9f49ac6a82ba431ab5b8346a398cf74ce831cc92d41'
      and revoked_at is not null
  ) then
    raise exception 'one-key: the legacy MCP token was not found or not revoked';
  end if;
end $$;
