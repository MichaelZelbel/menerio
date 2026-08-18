-- Step 1 of 2 in retiring the "hub" connector scope ("every key is a door;
-- the boxes are rooms"). A key carrying "hub" could already reach every MCP
-- tool, so giving it the full data-scope list preserves access, it does not
-- grant anything new. "hub" itself is kept for now so the currently deployed
-- menerio-mcp (which still gates on it) keeps accepting these keys until the
-- new code is live. Step 2 (20260818140000, committed after live
-- verification) removes "hub" everywhere.

-- Keep a restore point: the exact scope arrays as they were before this step.
CREATE TABLE IF NOT EXISTS hub_api_keys_scope_backup_20260818 AS
SELECT id, scopes
FROM hub_api_keys
WHERE 'hub' = ANY (scopes);

UPDATE hub_api_keys
SET scopes = (
  SELECT array_agg(DISTINCT s ORDER BY s)
  FROM unnest(
    scopes || ARRAY['profile','notes','contacts','actions','graph','media','stats','world','lexicon','collections']
  ) AS s
)
WHERE 'hub' = ANY (scopes);
