-- A higher cap (20260916140000) was not enough on its own: with 8,000
-- completion tokens allowed, deepseek/deepseek-v4-flash spent all 8,000 on
-- reasoning for a 5,277-token profile-extraction prompt and never wrote the
-- JSON (finish_reason "length", reasoning_tokens 8000, content empty). The
-- five sites that only extract structured JSON from a note now run the model
-- with reasoning off, the way the two relationship sites have since
-- 2026-08-09. The registry in _shared/llm-defaults.ts carries the same option.

update public.llm_call_configs
set extra_options = coalesce(extra_options, '{}'::jsonb) || '{"reasoning": {"enabled": false}}'::jsonb
where call_site in (
  'process-note.metadata', 'process-note.profile_extraction', 'process-note.moment_extraction',
  'quick-capture.metadata', 'ingest-thought.metadata'
)
and model like 'deepseek/%';

-- A reply cut off by the cap is not a result worth replaying.
delete from public.note_ai_stage_results
where result->'raw'->'choices'->0->>'finish_reason' = 'length';
