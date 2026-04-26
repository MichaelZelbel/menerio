UPDATE public.contacts
SET tags = array_remove(tags, 'temerio-Import')
WHERE 'temerio-Import' = ANY(tags);