BEGIN;
-- A service pull must never follow a sync-log reference across account owners.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.rejected_github_note_links (
 id uuid PRIMARY KEY, original_record jsonb NOT NULL,
 rejected_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL
);
REVOKE ALL ON private.rejected_github_note_links FROM PUBLIC,anon,authenticated;
ALTER TABLE private.rejected_github_note_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own sync log" ON public.github_sync_log;
CREATE POLICY "Users can manage own sync log" ON public.github_sync_log FOR ALL TO authenticated
 USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND (note_id IS NULL OR EXISTS (
  SELECT 1 FROM public.notes n WHERE n.id=note_id AND n.user_id=auth.uid())));
LOCK TABLE public.github_sync_log IN SHARE ROW EXCLUSIVE MODE;
WITH rejected AS (
 DELETE FROM public.github_sync_log s WHERE s.note_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.notes n WHERE n.id=s.note_id AND n.user_id=s.user_id)
 RETURNING s.*
)
INSERT INTO private.rejected_github_note_links(id,original_record,reason)
 SELECT id,to_jsonb(rejected),'note_owner_mismatch' FROM rejected;
ALTER TABLE public.github_sync_log ADD CONSTRAINT github_sync_log_note_owner_fkey
 FOREIGN KEY(note_id,user_id) REFERENCES public.notes(id,user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.github_sync_log VALIDATE CONSTRAINT github_sync_log_note_owner_fkey;
COMMIT;
