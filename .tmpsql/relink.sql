UPDATE public.profile_entries SET derived_from_claim_id = NULL WHERE derived_from_claim_id IS NOT NULL;

-- Suppress a profile entry ONLY when the claim fully covers it.
-- The first version tested containment in either direction, which let a
-- one-value claim hide a two-value entry: the Email row holds two addresses
-- and the claim held one, so the second would have vanished from the mirror
-- with nothing reporting it. A subset may never hide its superset.
UPDATE public.profile_entries p
SET derived_from_claim_id = c.id
FROM public.claims c
WHERE p.derived_from_claim_id IS NULL
  AND p.contact_id IS NULL
  AND c.user_id = p.user_id
  AND c.subject_type = 'self'
  AND lower(regexp_replace(btrim(p.label), '\s+', '-', 'g')) = lower(btrim(c.attribute))
  AND position(lower(btrim(p.value)) in lower(btrim(c.value))) > 0;

SELECT p.label, left(p.value, 44) AS entry_value, left(c.value, 44) AS claim_value
FROM public.profile_entries p JOIN public.claims c ON c.id = p.derived_from_claim_id;
