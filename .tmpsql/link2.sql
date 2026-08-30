-- Two entries verified by eye tonight whose claims carry the same fact but not
-- the same string, so the automatic containment rule correctly declined them.
--
--   Duolingo streak: entry "666 days (as of 2026-07-29)" is the claim
--     "666 days" plus the date, which the claim now carries as valid_from.
--   Email: the entry lists both addresses; both now exist as many-valued
--     claims, so the entry adds nothing the claim arm has not got.
--
-- Neither row is deleted and neither value is changed. They stop appearing
-- twice in world_claims, and both keep showing on the profile screens.
UPDATE public.profile_entries p
SET derived_from_claim_id = c.id
FROM public.claims c
WHERE p.contact_id IS NULL
  AND p.derived_from_claim_id IS NULL
  AND c.subject_type = 'self'
  AND (
    (lower(btrim(p.label)) = 'duolingo streak' AND c.attribute = 'duolingo-streak')
    OR (lower(btrim(p.label)) = 'email' AND c.attribute = 'email'
        AND c.value = 'michael@goodlightmag.com')
  );

SELECT p.label, left(p.value,44) AS entry, left(c.value,44) AS claim
FROM public.profile_entries p JOIN public.claims c ON c.id = p.derived_from_claim_id;
