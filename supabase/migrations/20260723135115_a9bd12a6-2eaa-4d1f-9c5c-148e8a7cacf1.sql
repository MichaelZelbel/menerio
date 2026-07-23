CREATE UNIQUE INDEX IF NOT EXISTS profile_normalization_runs_owner_unique
ON public.profile_normalization_runs (user_id)
WHERE subject_type = 'owner' AND contact_id IS NULL;