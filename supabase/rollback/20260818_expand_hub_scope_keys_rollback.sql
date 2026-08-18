-- Restores the scope arrays captured by 20260818130000_expand_hub_scope_keys.sql.
-- Safe to run any time before the backup table is dropped.

UPDATE hub_api_keys k
SET scopes = b.scopes
FROM hub_api_keys_scope_backup_20260818 b
WHERE k.id = b.id;

DROP TABLE IF EXISTS hub_api_keys_scope_backup_20260818;
