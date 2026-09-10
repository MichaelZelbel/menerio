-- Give every seeded call site a max_tokens cap without touching admin edits.
--
-- The registry (_shared/llm-defaults.ts) now carries a cap per site, but the
-- admin sync only inserts missing rows and never rewrites max_tokens, so the
-- live rows would have stayed unbounded until someone force-synced (which also
-- overwrites hand-picked models). This fills only NULLs; a cap someone set by
-- hand, and every model/provider choice, stays as it is.
update public.llm_call_configs c set max_tokens = v.cap
from (values
  ('ai-moderate-content.main', 400),
  ('find-connections.main', 800),
  ('analyze-media.text', 800), ('analyze-media.vision', 800),
  ('group-ai.next_step', 1000), ('ingest-thought.metadata', 1000),
  ('group-ai.suggest_members', 1200), ('note-chat.summarize', 1200), ('process-note.metadata', 1200),
  ('quick-capture.metadata', 1200), ('suggest-connections.main', 1200),
  ('draft-event.main', 2500), ('extract-event.main', 2500), ('generate-profile-suggestions.main', 2500),
  ('group-ai.briefing', 2500), ('profile-audit.main', 2500), ('process-note.profile_extraction', 2500),
  ('process-note.moment_extraction', 2500), ('wiki-ingest.group-insights', 2500),
  ('conversation-chat.main', 4000), ('daily-digest.main', 4000), ('note-chat.main', 4000), ('note-chat.general', 4000),
  ('weekly-review.main', 4000), ('wiki-cleanup.main', 4000), ('wiki-restructure.main', 4000),
  ('wiki-ingest.main', 4000), ('wiki-lint.main', 4000)
) as v(call_site, cap)
where c.call_site = v.call_site and c.max_tokens is null;
