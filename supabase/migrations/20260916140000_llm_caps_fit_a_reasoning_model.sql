-- The completion caps set on 2026-09-11 (llm_call_configs_max_tokens) did not
-- account for a reasoning model. deepseek/deepseek-v4-flash counts its
-- thinking as completion tokens: successful process-note.metadata replies used
-- up to 6,769 completion tokens, 6,606 of them reasoning, for at most 1,047
-- characters of JSON. Against a cap of 1,200 the model was cut off before it
-- wrote the answer (finish_reason "length", 32 of 137 metadata calls in 30
-- days), the truncated reply was checkpointed as the paid result, and the
-- analysis job failed as "permanent" on every retry. Found 2026-09-16 while
-- re-running the jobs the same day's audit had unstuck for another reason.
--
-- Caps only go up here, and only for the reasoning-model sites; a hand-set
-- higher value and every provider/model choice stay as they are. The registry
-- in _shared/llm-defaults.ts carries the same numbers.

update public.llm_call_configs c set max_tokens = greatest(coalesce(c.max_tokens, 0), v.cap)
from (values
  ('ai-moderate-content.main', 3000),
  ('find-connections.main', 4000),
  ('process-note.metadata', 6000), ('quick-capture.metadata', 6000), ('note-chat.summarize', 6000),
  ('group-ai.suggest_members', 6000), ('suggest-connections.main', 6000),
  ('ingest-thought.metadata', 6000), ('group-ai.next_step', 6000),
  ('process-note.profile_extraction', 8000), ('process-note.moment_extraction', 8000),
  ('draft-event.main', 8000), ('extract-event.main', 8000), ('generate-profile-suggestions.main', 8000),
  ('group-ai.briefing', 8000), ('wiki-ingest.group-insights', 8000),
  ('daily-digest.main', 8000), ('weekly-review.main', 8000), ('wiki-cleanup.main', 8000),
  ('wiki-ingest.main', 8000), ('wiki-lint.main', 8000), ('wiki-restructure.main', 8000)
) as v(call_site, cap)
where c.call_site = v.call_site
  and c.model like 'deepseek/%';

-- A reply cut off by the old cap is not a result worth replaying: the stage
-- protocol would hand the same truncated text back on every retry.
delete from public.note_ai_stage_results
where result->'raw'->'choices'->0->>'finish_reason' = 'length';
