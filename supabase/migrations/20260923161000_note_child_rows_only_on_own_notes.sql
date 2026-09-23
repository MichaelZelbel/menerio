-- Rows that hang off a note may only be written against the writer's own note.
--
-- media_analysis, note_chunks and note_connections each had one FOR ALL policy
-- checking user_id = auth.uid() and nothing else, and their note columns are a
-- plain foreign key to notes(id), which any existing note satisfies. So any
-- signed-in account could insert, straight through PostgREST, a row carrying
-- its own user_id and another account's note id:
--
--  * media_analysis: a "complete" row with attacker-written extracted_text.
--    note-chat and the MCP server read a note's media by note id, so that text
--    reached the victim's AI as the note's own OCR (prompt injection with the
--    victim's edit tools in reach). Those readers now also filter on user_id.
--  * note_chunks: UNIQUE (note_id, chunk_index) and (note_id, content_hash)
--    are not per account, so squatting a victim note's chunk slots made the
--    victim's own indexing of that note fail.
--  * note_connections: UNIQUE (source_note_id, target_note_id, connection_type)
--    is not per account either, the same squatting.
--
-- The attacker needs the victim's note id. Ids are random UUIDs, but they are
-- not treated as secrets anywhere (they sit in every /dashboard/notes/<id>
-- link), so the database must not rely on them being unguessable.
--
-- USING is unchanged, so reading and deleting one's own rows works as before;
-- only the row being written must point at the writer's own note. The service
-- role bypasses RLS and is unaffected.

BEGIN;

DROP POLICY IF EXISTS "Users can manage own media analysis" ON public.media_analysis;
CREATE POLICY "Users can manage own media analysis"
ON public.media_analysis
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = note_id AND n.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users manage own note chunks" ON public.note_chunks;
CREATE POLICY "Users manage own note chunks"
ON public.note_chunks
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = note_id AND n.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can manage own connections" ON public.note_connections;
CREATE POLICY "Users can manage own connections"
ON public.note_connections
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = source_note_id AND n.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = target_note_id AND n.user_id = auth.uid())
);

COMMIT;
