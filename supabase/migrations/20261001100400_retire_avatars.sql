-- Profile pictures are gone from the app. No new uploads, no reads; the files
-- are removed through the Storage API (scripts/oneoff/empty-avatars-bucket.mjs),
-- because Supabase refuses direct deletes from storage tables. The column and
-- the bucket go in 20261008100000, once cached app shells have updated.
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
UPDATE storage.buckets SET public = false WHERE id = 'avatars';
UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url IS NOT NULL;

-- Sign-up no longer copies a provider photo URL into the profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'free');
  RETURN NEW;
END;
$$;
