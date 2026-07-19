
-- 1) Folders table (single-parent hierarchy, scoped per collection).
CREATE TABLE public.collection_item_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  parent_folder_id uuid NULL REFERENCES public.collection_item_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_item_folders_user_collection_idx
  ON public.collection_item_folders (user_id, collection_id);
CREATE INDEX collection_item_folders_parent_idx
  ON public.collection_item_folders (parent_folder_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_item_folders TO authenticated;
GRANT ALL ON public.collection_item_folders TO service_role;

ALTER TABLE public.collection_item_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own collection folders"
  ON public.collection_item_folders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER collection_item_folders_set_updated_at
  BEFORE UPDATE ON public.collection_item_folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Cycle + same-collection guard on the folder hierarchy.
CREATE OR REPLACE FUNCTION public.guard_collection_item_folder_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_id uuid;
  parent_collection_id uuid;
  depth int := 0;
BEGIN
  IF NEW.parent_folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_folder_id = NEW.id THEN
    RAISE EXCEPTION 'A folder cannot be its own parent';
  END IF;

  SELECT collection_id INTO parent_collection_id
    FROM public.collection_item_folders
    WHERE id = NEW.parent_folder_id;

  IF parent_collection_id IS DISTINCT FROM NEW.collection_id THEN
    RAISE EXCEPTION 'Parent folder must belong to the same collection';
  END IF;

  current_id := NEW.parent_folder_id;
  WHILE current_id IS NOT NULL AND depth < 1000 LOOP
    IF current_id = NEW.id THEN
      RAISE EXCEPTION 'Folder hierarchy cannot contain a cycle';
    END IF;
    SELECT parent_folder_id INTO current_id
      FROM public.collection_item_folders WHERE id = current_id;
    depth := depth + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_item_folders_guard_parent
  BEFORE INSERT OR UPDATE ON public.collection_item_folders
  FOR EACH ROW EXECUTE FUNCTION public.guard_collection_item_folder_parent();

-- 2) Add folder_id, is_favorite, last_viewed_at on items.
ALTER TABLE public.collection_items
  ADD COLUMN folder_id uuid NULL REFERENCES public.collection_item_folders(id) ON DELETE SET NULL,
  ADD COLUMN is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN last_viewed_at timestamptz NULL;

CREATE INDEX collection_items_folder_idx ON public.collection_items (folder_id);
CREATE INDEX collection_items_user_favorite_idx
  ON public.collection_items (user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX collection_items_user_last_viewed_idx
  ON public.collection_items (user_id, last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL;

-- Cross-collection guard: folder_id must belong to the same collection as the item.
CREATE OR REPLACE FUNCTION public.guard_collection_item_folder_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  folder_collection_id uuid;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT collection_id INTO folder_collection_id
    FROM public.collection_item_folders
    WHERE id = NEW.folder_id;

  IF folder_collection_id IS DISTINCT FROM NEW.collection_id THEN
    RAISE EXCEPTION 'Folder must belong to the same collection as the item';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_items_guard_folder_scope
  BEFORE INSERT OR UPDATE OF folder_id, collection_id ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_collection_item_folder_scope();
