-- Defect 2: the fiction guard was switched off in production.
--
-- process-note.metadata and quick-capture.metadata were seeded on 2026-06-01 with
-- a nine-line stub that never asked the model for "content_mode". The code
-- defaults that field to "personal" when it is absent, which left BOTH fiction
-- gates dead: the primary one (skipPersonSuggestions) and the heuristic backup,
-- which is itself gated on contentMode !== "personal". A cast of characters became
-- a list of contacts.
--
-- This writes the real prompt, carrying the fictional-character exclusion policy,
-- "mentioned_works" and "content_mode". The field contract also travels in
-- runChat's systemSuffix from 2026-08-17, so the guard no longer depends on this
-- text being current; this update stops the row contradicting it.
--
-- The guard is the exact md5 of the stub as read live on 2026-08-17, so a
-- hand-edited row is never touched, and on a fresh database (seeded with the new
-- default from llm-defaults.ts) it matches nothing and does nothing.
--
-- Rollback: supabase/rollback/20260817_stale_prompt_rows_rollback.sql
--
-- Applied by the Lovable agent on 2026-08-17 as this file. The identical SQL was
-- authored as 20260817120000_metadata_prompt_fiction_guard.sql, generated from the code
-- constants rather than typed by hand; that duplicate is removed so one file
-- carries both the statement and the reason. Verified byte-identical before
-- consolidating.
--
update public.llm_call_configs
set system_prompt = $p$Extract metadata from the user's note. Return JSON with:
- "title": If the first line of the note is 10 words or fewer and reads like a natural title or heading, use it verbatim. Otherwise, generate a concise title (max 8 words) that captures the essence of the note.
- "people": array of names of REAL human beings the note author actually knows of or interacts with (real individuals — first name, full name, or known alias). Do NOT include:
    * companies, products, apps, projects, tools, libraries, websites, brands, domains, or open-source repos, even if the name sounds personal.
    * fictional characters from novels, light novels, manga, anime, visual novels, video games, films, TV series, comics, plays, or any other work of fiction — even if the note lists them by name. This applies EVEN when the surrounding note is a personal profile or journal that only references media in passing. Examples that must be EXCLUDED:
        - "favorite actor Lee Junyoung as Geum Sung-je" → exclude "Geum Sung-je" (that's the fictional role, not a person the author knows).
        - "the character I remind you of? Spiderman?" → exclude "Spiderman" (fictional superhero).
        - "currently watching Weak Hero, love the protagonist" / "cast: A, B, C" / "playing Chocola in NEKOPARA" → exclude character names.
      Real actors, directors, authors, streamers, or creators the author actually follows or knows MAY be included — but the fictional role they play must not.
    * mythological, religious, or folkloric figures presented as characters.
  When in doubt (a single capitalized word with no clearly human context, or a name that only appears as part of describing a story/game/show), leave it out.
- "mentioned_works": array of titles of creative works discussed in the note (novels, manga, anime, games, films, shows, albums, etc.). Empty if none.
- "content_mode": one of "personal" (default — a personal note, journal entry, meeting note, task, idea, etc.), "review_of_fiction" (the primary subject is a work of fiction — reviewing/summarizing/discussing a novel, anime, manga, game, film, TV show, etc.), "review_of_nonfiction" (primary subject is a non-fiction book, article, documentary, course), or "reference" (a reference/how-to/documentation clip). Choose "review_of_fiction" whenever the note is mainly ABOUT a fictional work, regardless of length.
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.$p$
where call_site in ('process-note.metadata', 'quick-capture.metadata')
  and md5(system_prompt) = '46129c5972b0dad967c1a4b67b6d885e';