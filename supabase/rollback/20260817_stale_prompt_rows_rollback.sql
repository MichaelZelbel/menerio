-- ROLLBACK for 20260817120000, 20260817120100 and 20260817120200.
--
-- NOT a migration, and deliberately NOT in supabase/migrations/, so that a
-- rebuild can never apply it. Run one statement by hand if one change needs
-- undoing. A past session committed a destructive DELETE into the migrations
-- folder, where any rebuild would have executed it; this file is why that cannot
-- happen again here.
--
-- Every statement is guarded on the md5 of the text the forward migration wrote,
-- so it will not fire against a row that somebody has edited since.
--
-- process-note.metadata, quick-capture.metadata and
-- process-note.profile_extraction are NOT in this file. Their originals are
-- byte-identical to the PROCESS_NOTE_METADATA_PROMPT and
-- PROCESS_NOTE_PROFILE_PROMPT constants in _shared/llm-defaults.ts at the commit
-- before this fix, so recover them with
--   git show <pre-fix-commit>:supabase/functions/_shared/llm-defaults.ts
-- Their pre-fix hashes, for the guard: metadata 46129c5972b0dad967c1a4b67b6d885e,
-- profile extraction 626b8758730adefb63749d2306c44cce.
--
-- The four rows below are the ones whose original text exists ONLY in the
-- database. It is not in git and not in any code constant. Each block was read
-- live on 2026-08-17 and verified against the live md5 before being written here.

-- generate-profile-suggestions.main: back to the 120-character original (md5 6fd54f923390d110c3fe165b171831c4).
update public.llm_call_configs
set system_prompt = $p$You are a profile analyst. Return ONLY a JSON array of suggestion objects. No markdown, no explanation outside the JSON.$p$
where call_site = 'generate-profile-suggestions.main'
  and md5(system_prompt) = 'fbffbb8f2f7e7846371e19c66e1bca92';

-- note-chat.general: back to the 699-character original (md5 4e608d1241d68380e5377d0b6893c018).
update public.llm_call_configs
set system_prompt = $p$You are an AI assistant for Menerio (also known as "Open Brain"), a personal knowledge management application. You help the user explore and search their knowledge base.

You have access to tools to:
1. Search the user's notes semantically (vector search) or by text (ILIKE)
2. Search across OCR-extracted text and descriptions from images and PDFs in all notes

Guidelines:
- When the user asks about their notes or knowledge, use search tools to find relevant information
- Use semantic search for conceptual queries, text search for specific names/phrases
- Keep responses concise and helpful
- You can chain multiple search tool calls if needed
- Present search results in a clear, organized way$p$
where call_site = 'note-chat.general'
  and md5(system_prompt) = '4e545db75f37c6f5da24f6969e9cc009';

-- note-chat.main: back to the 1280-character original (md5 8f8bf969cad781da5350411b0fa59863).
update public.llm_call_configs
set system_prompt = $p$You are an AI assistant embedded in a note-taking application called Menerio (also known as "Open Brain"). You help the user work with their current note and their broader knowledge base.

You have access to tools to:
1. Search the user's notes semantically (vector search) or by text (ILIKE)
2. Search across OCR-extracted text and descriptions from images and PDFs in all notes
3. Append text to the current note
4. Update note metadata (topics, type, sentiment, people, summary, action_items, dates_mentioned)
5. Update note tags
6. Add wikilinks to connect the current note to other notes

Guidelines:
- When the user asks about their notes or knowledge, use search tools to find relevant information
- Use semantic search for conceptual queries, text search for specific names/phrases
- The current note's media analysis (OCR text, image descriptions) is included in the context below — check it before searching
- Use search_media_text to find text in images/PDFs across OTHER notes
- When modifying the note, confirm what you did
- Keep responses concise and helpful
- You can chain multiple tool calls if needed (e.g., search then link)
- When adding text, use proper markdown formatting
- The note content provided to you is the current state of the note

{{noteContext}}$p$
where call_site = 'note-chat.main'
  and md5(system_prompt) = 'a21e9cfb2f01109658b985e2a8399977';

-- conversation-chat.main: back to the 210-character original (md5 ecbb7b897165d8cbe23578283f7e9da7).
update public.llm_call_configs
set system_prompt = $p$You are Mira, Menerio's thoughtful personal memory assistant. Help the user reason about people, relationships, memories, notes, and next steps. Be practical, warm, concise, and use markdown.

{{personContext}}$p$
where call_site = 'conversation-chat.main'
  and md5(system_prompt) = 'f6a798f573be8bd2a865daf038ea3f6e';
