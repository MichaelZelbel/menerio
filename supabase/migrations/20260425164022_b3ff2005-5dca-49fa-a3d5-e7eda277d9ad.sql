ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notes_user_folder_path
ON public.notes (user_id, folder_path)
WHERE is_trashed = false;

CREATE TABLE IF NOT EXISTS public.note_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT note_folders_path_not_blank CHECK (length(trim(path)) > 0),
  CONSTRAINT note_folders_unique_user_path UNIQUE (user_id, path)
);

ALTER TABLE public.note_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own note folders"
ON public.note_folders
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_note_folders_user_parent
ON public.note_folders (user_id, parent_path, sort_order, name);

DROP TRIGGER IF EXISTS update_note_folders_updated_at ON public.note_folders;
CREATE TRIGGER update_note_folders_updated_at
BEFORE UPDATE ON public.note_folders
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();