-- One key for Menerio: give the hub's existing API key the three scopes it needs.
--
-- `hub` is the new scope that lets an API key open the MCP connector door, so the
-- same key works in Claude, ChatGPT, OpenCode and the hub's own scripts. `notes`
-- and `world` are what the hub's two sync scripts read and write.
--
-- The key is found by the SHA-256 fingerprint the table already stores, so no key
-- value appears in this file and no other user's key is touched.
--
-- Idempotent: re-running it changes nothing.

-- Fail loudly if the fingerprint matches nothing, rather than passing silently.
do $$
begin
  if not exists (
    select 1 from public.hub_api_keys
    where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
  ) then
    raise exception 'one-key: no hub_api_keys row matches the expected fingerprint';
  end if;
end $$;

update public.hub_api_keys
set scopes = scopes
  || (case when 'hub'   = any(scopes) then '{}'::text[] else array['hub']::text[]   end)
  || (case when 'notes' = any(scopes) then '{}'::text[] else array['notes']::text[] end)
  || (case when 'world' = any(scopes) then '{}'::text[] else array['world']::text[] end)
where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
  and not (scopes @> array['hub', 'notes', 'world']::text[]);

-- Prove the outcome instead of assuming it.
do $$
begin
  if not exists (
    select 1 from public.hub_api_keys
    where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
      and is_active
      and scopes @> array['hub', 'notes', 'world']::text[]
  ) then
    raise exception 'one-key: the key did not end up active with hub, notes and world';
  end if;
end $$;
