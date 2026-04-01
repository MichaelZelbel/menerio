
CREATE TABLE public.media_analysis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  note_id uuid REFERENCES public.notes(id) ON DELETE CASCADE NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL,
  page_number integer,
  original_filename text,
  extracted_text text,
  description text,
  topics text[] DEFAULT '{}',
  raw_analysis jsonb DEFAULT '{}',
  embedding extensions.vector(1536),
  analysis_status text DEFAULT 'pending' NOT NULL,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_media_note ON public.media_analysis(note_id);
CREATE INDEX idx_media_user ON public.media_analysis(user_id);
CREATE INDEX idx_media_status ON public.media_analysis(analysis_status);
CREATE INDEX idx_media_embedding ON public.media_analysis USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.media_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own media analysis"
ON public.media_analysis
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all media analysis"
ON public.media_analysis
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_media_analysis_updated_at
BEFORE UPDATE ON public.media_analysis
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
