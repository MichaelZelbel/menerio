-- One key for Menerio: give Mission Control's existing API key the three scopes it needs.
--
-- `godspeed` is the new scope that lets an API key open the MCP connector door, so the
-- same key works in Claude, ChatGPT, OpenCode and Mission Control's own scripts. `notes`
-- and `world` are what Mission Control's two sync scripts read and write.
--
-- The key is found by the SHA-256 fingerprint the table already stores, so no key
-- value appears in this file and no other user's key is touched.
--
-- Idempotent: re-running it changes nothing.

-- Fail loudly if the fingerprint matches nothing, rather than passing silently.
do $$
begin
  if not exists (
    select 1 from public.godspeed_api_keys
    where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
  ) then
    raise exception 'one-key: no godspeed_api_keys row matches the expected fingerprint';
  end if;
end $$;

update public.godspeed_api_keys
set scopes = scopes
  || (case when 'godspeed'   = any(scopes) then '{}'::text[] else array['godspeed']::text[]   end)
  || (case when 'notes' = any(scopes) then '{}'::text[] else array['notes']::text[] end)
  || (case when 'world' = any(scopes) then '{}'::text[] else array['world']::text[] end)
where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
  and not (scopes @> array['godspeed', 'notes', 'world']::text[]);

-- Prove the outcome instead of assuming it.
do $$
begin
  if not exists (
    select 1 from public.godspeed_api_keys
    where key_hash = '83231e9672c8d5187b474b9bd6845079c46d71f1dc43edf8284ce52fdbb20523'
      and is_active
      and scopes @> array['godspeed', 'notes', 'world']::text[]
  ) then
    raise exception 'one-key: the key did not end up active with godspeed, notes and world';
  end if;
end $$;
