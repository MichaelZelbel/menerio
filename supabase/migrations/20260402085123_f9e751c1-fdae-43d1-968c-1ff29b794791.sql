
-- Create shared_notes table
CREATE TABLE public.shared_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  share_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT shared_notes_note_id_key UNIQUE (note_id),
  CONSTRAINT shared_notes_share_token_key UNIQUE (share_token)
);

-- Index for fast token lookups
CREATE INDEX idx_shared_notes_token ON public.shared_notes (share_token) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.shared_notes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can manage their own shared notes
CREATE POLICY "Users can manage own shared notes"
  ON public.shared_notes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Security-definer function for anonymous token lookup
CREATE OR REPLACE FUNCTION public.get_shared_note_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'title', n.title,
    'content', n.content,
    'tags', n.tags,
    'entity_type', n.entity_type,
    'created_at', n.created_at,
    'updated_at', n.updated_at
  )
  INTO v_result
  FROM shared_notes s
  JOIN notes n ON n.id = s.note_id
  WHERE s.share_token = p_token
    AND s.is_active = true;

  RETURN v_result;
END;
$$;
