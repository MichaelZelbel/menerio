DROP POLICY IF EXISTS "Users can update own note attachments" ON storage.objects;

CREATE POLICY "Users can update own note attachments"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'note-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'note-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);