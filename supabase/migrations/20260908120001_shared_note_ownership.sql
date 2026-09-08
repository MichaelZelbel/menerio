-- Fail closed before inspecting historic rows. Keep valid tokens unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_shared_note_by_token(p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('title', n.title, 'content', n.content, 'tags', n.tags,
    'entity_type', n.entity_type, 'created_at', n.created_at, 'updated_at', n.updated_at)
  FROM public.shared_notes s JOIN public.notes n ON n.id=s.note_id AND n.user_id=s.user_id
  WHERE s.share_token=p_token AND s.is_active=true
$$;
DROP POLICY IF EXISTS "Users can manage own shared notes" ON public.shared_notes;
CREATE POLICY "Users can manage own shared notes" ON public.shared_notes
FOR ALL TO authenticated
USING (user_id=auth.uid() AND EXISTS (
  SELECT 1 FROM public.notes n WHERE n.id=note_id AND n.user_id=auth.uid()))
WITH CHECK (user_id=auth.uid() AND EXISTS (
  SELECT 1 FROM public.notes n WHERE n.id=note_id AND n.user_id=auth.uid()));

-- Private audit holds the original record, without copying any note content.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.rejected_note_shares (
  id uuid PRIMARY KEY, note_id uuid NOT NULL, user_id uuid NOT NULL,
  share_token text NOT NULL, is_active boolean NOT NULL DEFAULT false CHECK (NOT is_active),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL
);
REVOKE ALL ON private.rejected_note_shares FROM PUBLIC, anon, authenticated;
ALTER TABLE private.rejected_note_shares ENABLE ROW LEVEL SECURITY;
LOCK TABLE public.shared_notes IN SHARE ROW EXCLUSIVE MODE;
WITH rejected AS (
  DELETE FROM public.shared_notes s WHERE NOT EXISTS (
    SELECT 1 FROM public.notes n WHERE n.id=s.note_id AND n.user_id=s.user_id)
  RETURNING s.*
)
INSERT INTO private.rejected_note_shares
  (id,note_id,user_id,share_token,is_active,created_at,updated_at,reason)
SELECT id,note_id,user_id,share_token,false,created_at,updated_at,'owner_mismatch' FROM rejected;

ALTER TABLE public.notes ADD CONSTRAINT notes_id_user_id_key UNIQUE (id,user_id);
ALTER TABLE public.shared_notes ADD CONSTRAINT shared_notes_note_owner_fkey
  FOREIGN KEY (note_id,user_id) REFERENCES public.notes(id,user_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.shared_notes VALIDATE CONSTRAINT shared_notes_note_owner_fkey;
COMMIT;
