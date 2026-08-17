DELETE FROM public.review_queue WHERE source_note_id='2c2ce890-9968-4eb6-be22-67a653f77343';
DELETE FROM public.profile_entries WHERE created_at > '2026-08-17 07:27:00+00' AND contact_id='4d6db96a-f58e-468f-ae90-564eff9892a4';
DELETE FROM public.note_chunks WHERE note_id='2c2ce890-9968-4eb6-be22-67a653f77343';
DELETE FROM public.notes WHERE id='2c2ce890-9968-4eb6-be22-67a653f77343';
DELETE FROM public.hub_api_keys WHERE key_prefix='mnr_b643b7ed';