-- Rollback for 20260901093000_profile_entries_are_derived.sql
--
-- Removes the display-layer columns. No profile entry is deleted and no value
-- changes: this migration only ever added columns and set a boolean flag.
--
-- After this, get_user_profile has no way to tell a curated entry from any
-- other, so it goes back to handing all 51 items to every LLM call. Roll the
-- MCP server's scope parameter back at the same time or it will filter on a
-- column that no longer exists.
DROP INDEX IF EXISTS public.profile_entries_show_to_agent_idx;

ALTER TABLE public.profile_entries
  DROP COLUMN IF EXISTS derived_from_claim_id,
  DROP COLUMN IF EXISTS show_to_agent;
