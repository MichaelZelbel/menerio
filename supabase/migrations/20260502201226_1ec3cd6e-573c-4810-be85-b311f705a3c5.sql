-- Backfill metadata.web_clip for existing SingleFile-captured notes whose
-- metadata was wiped by process-note. We re-derive snapshot/hero info from
-- note_attachments by matching on user_id (one-shot recovery; uses the most
-- recent HTML and most recent image attachment per affected user/note pair).
WITH affected AS (
  SELECT
    n.id AS note_id,
    n.user_id,
    n.source_url,
    n.created_at
  FROM public.notes n
  WHERE n.source_app = 'singlefile'
    AND ((n.metadata->'web_clip') IS NULL OR n.metadata->'web_clip' = 'null'::jsonb)
),
snap AS (
  SELECT DISTINCT ON (a.note_id)
    a.note_id,
    a.user_id,
    na.filename,
    na.storage_path,
    na.created_at
  FROM affected a
  JOIN public.note_attachments na
    ON na.user_id = a.user_id
   AND na.source = 'singlefile'
   AND na.mime_type = 'text/html'
   AND na.created_at BETWEEN (a.created_at - interval '5 minutes') AND (a.created_at + interval '5 minutes')
  ORDER BY a.note_id, abs(extract(epoch from (na.created_at - a.created_at)))
),
hero AS (
  SELECT DISTINCT ON (a.note_id)
    a.note_id,
    na.filename,
    na.storage_path
  FROM affected a
  JOIN public.note_attachments na
    ON na.user_id = a.user_id
   AND na.source = 'singlefile'
   AND na.mime_type LIKE 'image/%'
   AND na.created_at BETWEEN (a.created_at - interval '5 minutes') AND (a.created_at + interval '5 minutes')
  ORDER BY a.note_id, abs(extract(epoch from (na.created_at - a.created_at)))
)
UPDATE public.notes n
SET metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_build_object(
  'web_clip', jsonb_strip_nulls(jsonb_build_object(
    'snapshot_attachment', snap.filename,
    'snapshot_storage_path', snap.storage_path,
    'hero_image_attachment', hero.filename,
    'hero_image_storage_path', hero.storage_path,
    'url', n.source_url,
    'hostname', regexp_replace(split_part(n.source_url, '/', 3), '^www\.', '')
  ))
)
FROM snap
LEFT JOIN hero ON hero.note_id = snap.note_id
WHERE n.id = snap.note_id
  AND snap.storage_path IS NOT NULL;