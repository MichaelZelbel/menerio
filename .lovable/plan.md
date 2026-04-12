

## Fix: Profile Facts Not Being Extracted from Notes

### Root Cause (confirmed via edge function logs)

The `process-note` function IS running successfully for the Lucy note. The contact IS matched (`matched_people: [{name: "Lucy", contact_id: "872f6c89..."}]`). But the log shows:

```
No profile facts extracted from note 33be1047...
```

Two issues cause the LLM to return empty results:

1. **HTML content sent to LLM**: The note body contains raw HTML (`<p>She is Xihui's best friend</p><p>Living in Beijing.</p>...`). The profile extraction prompt receives this HTML directly, which confuses the model and causes it to return zero facts despite rich content.

2. **Possible JSON format mismatch**: The `response_format: { type: "json_object" }` forces the model to return a JSON object (not array). The code handles `parsed.facts` but the model might use a different wrapper key (e.g. `{"results": []}`, `{"data": []}`, `{"profile_facts": []}`). Without debug logging, we can't see what the model actually returns.

### Plan

**File: `supabase/functions/process-note/index.ts`**

1. **Strip HTML tags before sending to profile extraction LLM** — Add a simple HTML-to-text helper (strip tags, decode entities) and use it when building the `userPrompt` for `generateProfileSuggestions`. This ensures the LLM sees clean plain text.

2. **Handle all possible JSON wrapper keys** — Update the parsing at line 330 to check for any array value in the parsed object (not just `parsed.facts`), so regardless of what key the model wraps the array in, we extract it.

3. **Add debug logging** — Log the raw LLM response content so we can diagnose future issues without guessing.

4. **Redeploy the edge function**.

### Scope
- Single file: `supabase/functions/process-note/index.ts`
- Add ~10 lines for HTML stripping utility
- Modify `generateProfileSuggestions` function (~5 lines changed)

