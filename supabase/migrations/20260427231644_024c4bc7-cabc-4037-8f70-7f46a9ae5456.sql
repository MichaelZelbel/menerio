-- Remove anonymous public read access to user profiles.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Ensure admins still have controlled profile visibility.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Admins can view all profiles'
  ) THEN
    CREATE POLICY "Admins can view all profiles"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (public.is_admin(auth.uid()));
  END IF;
END $$;

-- Make note attachments private and owner-scoped.
UPDATE storage.buckets
SET public = false
WHERE id = 'note-attachments';

DROP POLICY IF EXISTS "Public read access for note attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own attachments" ON storage.objects;

CREATE POLICY "Users can view own attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'note-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Store connected-app API keys as hashes instead of plaintext.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.connected_apps
  ADD COLUMN IF NOT EXISTS key_hash text,
  ADD COLUMN IF NOT EXISTS key_prefix text;

UPDATE public.connected_apps
SET
  key_hash = encode(digest(api_key, 'sha256'), 'hex'),
  key_prefix = left(api_key, 12),
  api_key = left(api_key, 12)
WHERE key_hash IS NULL
  AND api_key IS NOT NULL
  AND length(api_key) > 12;

CREATE UNIQUE INDEX IF NOT EXISTS connected_apps_key_hash_idx
ON public.connected_apps (key_hash)
WHERE key_hash IS NOT NULL;

-- Keep the legacy api_key column from storing full new secrets.
ALTER TABLE public.connected_apps
  ADD CONSTRAINT connected_apps_api_key_prefix_only
  CHECK (api_key IS NULL OR length(api_key) <= 16)
  NOT VALID;

ALTER TABLE public.connected_apps
  VALIDATE CONSTRAINT connected_apps_api_key_prefix_only;

-- Ensure only admins can access moderation stopwords; RLS default denies everyone else.
DROP POLICY IF EXISTS "Admins can manage moderation stopwords" ON public.moderation_stopwords;
CREATE POLICY "Admins can manage moderation stopwords"
ON public.moderation_stopwords
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));